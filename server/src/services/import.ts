import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Db } from '../db.js';
import { STATUS_OBJECT_TYPES, type StatusObjectType } from './status.js';
import { isPlainObject, parseJsonLenient } from './sync/json.js';

/**
 * First-startup import of the existing SpiralDB corpus (task 1.6,
 * docs/spec-data-model.md L254-279).
 *
 * Runs only while `entry_status` is empty, then never again: the owner's existing
 * 2.2k entries are adopted as `status='extracted'` exactly once, and the count is
 * surfaced to the UI as the spec's once-only toast ("Imported {n} existing
 * entries from SpiralDB", L260). On every later startup the table has rows, so
 * the function returns `{ ran: false, imported: 0, … }` without touching a file.
 *
 * The reader is the corpus' lenient one (L238-253): most SpiralDB files carry
 * **trailing commas**, so every parse goes through `parseJsonLenient`
 * (strict `JSON.parse` first, JSON5 as the recovery path) and a file that still
 * cannot be parsed is *counted*, never fatal — one broken entry must not stop the
 * owner's first boot.
 *
 * The service is standalone and injectable (no `getDb()`, no console output), so
 * unit tests drive it against a fixture tree and a `:memory:` database. It is
 * called from the real entrypoint (`server/src/index.ts`) after the connection
 * is open — never as a side effect of importing `app.ts` (decision D32).
 */

export interface ImportTypeSpec {
  /** The `entry_status.object_type` value written for this directory. */
  objectType: StatusObjectType;
  /** Directory name under `spiraldb_path` (docs/spec-data-model.md L266-275). */
  directory: string;
  /** Top-level key field parsed out of each file. */
  keyField: string;
}

/**
 * The scan mapping, verbatim from docs/spec-data-model.md L266-275.
 *
 * `NpcDropTable/` is in the mapping even though the directory does not exist in
 * the owner's fork today — a missing directory is normal, not an error.
 */
export const IMPORT_TYPE_SPECS: readonly ImportTypeSpec[] = [
  { objectType: 'quest', directory: 'QuestTemplates', keyField: 'm_questName' },
  { objectType: 'drop_table', directory: 'DropTables', keyField: 'Name' },
  { objectType: 'npc_inventory', directory: 'NpcInventory', keyField: 'TemplateID' },
  { objectType: 'npc_spell_inventory', directory: 'NpcSpellInventory', keyField: 'TemplateID' },
  { objectType: 'creature_spellbook', directory: 'CreatureSpellbook', keyField: 'DeckName' },
  { objectType: 'npc_drop_table', directory: 'NpcDropTable', keyField: 'TemplateID' },
  {
    objectType: 'treasure_card_inventory',
    directory: 'TreasureCardInventory',
    keyField: 'TemplateID',
  },
  { objectType: 'zone_transfer', directory: 'ZoneTransfer', keyField: 'ZoneName' },
];

/**
 * Top-level directories that are deliberately never scanned (L277):
 * `QuestMetadatas/` rides along with each quest but is not an entry of its own,
 * and `GlobalRegistry/` is editor-only with no per-entry lifecycle
 * (docs/plan-overview.md Q1). They are siblings of the eight scanned directories,
 * so the skip is expressed by this list rather than by a filter.
 */
export const IMPORT_SKIPPED_DIRECTORIES = ['QuestMetadatas', 'GlobalRegistry'] as const;

/**
 * The `droptables/` subdirectory inside `QuestTemplates/` is skipped (L277): the
 * scan never descends, and this name is what the skip is documented against.
 */
export const IMPORT_SKIPPED_SUBDIRECTORY = 'droptables';

/** One directory entry, narrowed to what the scan needs (injectable for tests). */
export interface ImportDirectoryEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

export interface ImportDeps {
  /** Reads a directory's entries; a throw means "this directory is missing". */
  readdir?: (directory: string) => ImportDirectoryEntry[];
  /** Reads one file as UTF-8; a throw is counted as a `failed` file. */
  readFile?: (file: string) => string;
}

export interface RunFirstStartupImportOptions {
  db: Db;
  /** `settings.spiraldb_path` — the SpiralDB repository root to scan. */
  spiraldbPath: string;
  /** Timestamp written to every `extracted_at`; injectable for tests. */
  now?: () => string;
  /** Filesystem hooks; tests replace them to simulate read failures. */
  deps?: ImportDeps;
}

export interface ImportTypeCounts {
  /** Rows inserted into `entry_status`. */
  imported: number;
  /** Candidate files that yielded no usable key, plus duplicates and non-JSON. */
  skipped: number;
  /** Files that could not be read or parsed as JSON. */
  failed: number;
  /** Keys seen more than once within this type (the first file wins). */
  duplicates: string[];
  /** `true` when the directory does not exist in this repository. */
  directoryMissing: boolean;
}

export interface ImportResult {
  /** `true` only when the import actually ran (the table was empty). */
  ran: boolean;
  imported: number;
  skipped: number;
  failed: number;
  /** All eight singular types, zeros included. */
  byType: Record<StatusObjectType, ImportTypeCounts>;
  /** The single `extracted_at` written to every row; `null` when skipped. */
  importedAt: string | null;
}

/** Default directory reader: `withFileTypes` narrowed to the fields we use. */
function readDirectoryEntries(directory: string): ImportDirectoryEntry[] {
  return readdirSync(directory, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    isFile: entry.isFile(),
    isDirectory: entry.isDirectory(),
  }));
}

function emptyCounts(): ImportTypeCounts {
  return { imported: 0, skipped: 0, failed: 0, duplicates: [], directoryMissing: false };
}

function emptyByType(): Record<StatusObjectType, ImportTypeCounts> {
  return Object.fromEntries(
    STATUS_OBJECT_TYPES.map((objectType) => [objectType, emptyCounts()]),
  ) as Record<StatusObjectType, ImportTypeCounts>;
}

/**
 * Normalises a parsed key field to the string stored in `entry_status.object_key`.
 *
 * `TemplateID` is numeric in every existing file but the column stores text
 * (docs/spec-data-model.md L270-274), so numbers are stringified; strings pass
 * through unchanged, which also keeps an already-string id verbatim. Anything
 * else (missing, null, empty, object) yields `undefined` and the file is skipped.
 */
export function normalizeImportKey(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value === '' ? undefined : value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

/** `true` when the entry is a candidate file for this scan. */
function isJsonFile(entry: ImportDirectoryEntry): boolean {
  return entry.isFile && entry.name.toLowerCase().endsWith('.json');
}

/**
 * Scans one type's directory and returns the keys to insert.
 *
 * Pure apart from the injected reader: no database, no throw for bad data.
 */
function scanType(
  root: string,
  spec: ImportTypeSpec,
  counts: ImportTypeCounts,
  readDirectory: (directory: string) => ImportDirectoryEntry[],
  readFile: (file: string) => string,
): string[] {
  const directory = path.join(root, spec.directory);

  let entries: ImportDirectoryEntry[];
  try {
    entries = readDirectory(directory);
  } catch {
    // A directory that is not there (NpcDropTable/ today) contributes nothing.
    counts.directoryMissing = true;
    return [];
  }

  const keys: string[] = [];
  const seen = new Set<string>();

  // Sorted by name so the scan — and therefore "the first file wins" for a
  // duplicate key — is reproducible instead of following the filesystem's order.
  for (const entry of [...entries].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    // Non-JSON files and subdirectories are skipped, counted, never descended
    // into — this is what keeps `QuestTemplates/droptables/` out of the import.
    if (!isJsonFile(entry)) {
      counts.skipped += 1;
      continue;
    }

    let document: unknown;
    try {
      document = parseJsonLenient(readFile(path.join(directory, entry.name)));
    } catch {
      counts.failed += 1;
      continue;
    }

    const key = isPlainObject(document) ? normalizeImportKey(document[spec.keyField]) : undefined;

    if (key === undefined) {
      counts.skipped += 1;
      continue;
    }

    if (seen.has(key)) {
      // Duplicate keys within a type (two ZoneTransfer files share one
      // `ZoneName`) must not abort the import; the first file wins and the key
      // is reported. Duplicates *across* types are legitimate — a key is only
      // unique within its type (UNIQUE(object_type, object_key)).
      counts.skipped += 1;
      counts.duplicates.push(key);
      continue;
    }

    seen.add(key);
    keys.push(key);
  }

  return keys;
}

/** The last import performed by this process — the `GET /api/status/_import` source. */
let lastImportResult: ImportResult | null = null;

/** Records the outcome of an import run for the in-memory status endpoint. */
export function recordImportResult(result: ImportResult | null): void {
  lastImportResult = result;
}

/** The outcome of the last import run in this process, or `null` if none ran yet. */
export function getLastImportResult(): ImportResult | null {
  return lastImportResult;
}

/**
 * Imports the existing SpiralDB corpus exactly once.
 *
 * Skips (and records nothing) whenever `entry_status` already has rows. All
 * inserts happen in ONE transaction, so a failure leaves the table exactly as it
 * was — the next startup then retries the import instead of adopting a half of
 * the corpus.
 */
export function runFirstStartupImport(options: RunFirstStartupImportOptions): ImportResult {
  const { db, spiraldbPath } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const readDirectory = options.deps?.readdir ?? readDirectoryEntries;
  const readFile = options.deps?.readFile ?? ((file: string) => readFileSync(file, 'utf8'));

  const byType = emptyByType();
  const shouldRun =
    (db.prepare('SELECT COUNT(*) AS count FROM entry_status').get() as { count: number }).count ===
    0;

  if (!shouldRun) {
    const skipped: ImportResult = {
      ran: false,
      imported: 0,
      skipped: 0,
      failed: 0,
      byType,
      importedAt: null,
    };
    recordImportResult(skipped);
    return skipped;
  }

  const importedAt = now();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO entry_status (object_type, object_key, status, extracted_at)
     VALUES (?, ?, 'extracted', ?)`,
  );

  const rows: Array<[StatusObjectType, string]> = [];
  for (const spec of IMPORT_TYPE_SPECS) {
    const counts = byType[spec.objectType];
    for (const key of scanType(spiraldbPath, spec, counts, readDirectory, readFile)) {
      rows.push([spec.objectType, key]);
    }
  }

  const insertAll = db.transaction((batch: Array<[StatusObjectType, string]>): void => {
    for (const [objectType, objectKey] of batch) {
      const info = insert.run(objectType, objectKey, importedAt);
      const counts = byType[objectType];
      if (info.changes === 0) {
        // Only reachable through a UNIQUE conflict the in-memory dedupe missed.
        counts.skipped += 1;
        counts.duplicates.push(objectKey);
      } else {
        counts.imported += 1;
      }
    }
  });

  insertAll(rows);

  const result: ImportResult = {
    ran: true,
    imported: STATUS_OBJECT_TYPES.reduce((sum, objectType) => sum + byType[objectType].imported, 0),
    skipped: STATUS_OBJECT_TYPES.reduce((sum, objectType) => sum + byType[objectType].skipped, 0),
    failed: STATUS_OBJECT_TYPES.reduce((sum, objectType) => sum + byType[objectType].failed, 0),
    byType,
    importedAt,
  };

  recordImportResult(result);
  return result;
}

/**
 * The `{ ran, imported, imported_at }` body of `GET /api/status/_import`
 * (lead decision 7 — additive, in-memory, no schema change), reflecting the last
 * import this process performed. Before any import has run it reports zeros, so
 * the UI never shows the once-only toast on a process that imported nothing.
 */
export interface ImportStatusBody {
  ran: boolean;
  imported: number;
  imported_at: string | null;
}

export function importStatusBody(
  result: ImportResult | null = getLastImportResult(),
): ImportStatusBody {
  return {
    ran: result?.ran ?? false,
    imported: result?.imported ?? 0,
    imported_at: result?.importedAt ?? null,
  };
}
