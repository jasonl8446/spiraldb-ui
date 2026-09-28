import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Db } from '../db.js';
import { isStatusObjectType, STATUS_OBJECT_TYPES, type StatusObjectType } from './status.js';
import { isPlainObject, parseJsonLenient } from './sync/json.js';

/**
 * Adopting the existing SpiralDB corpus into `entry_status` (task 1.6,
 * docs/spec-data-model.md L254-279, plus D82(a)'s idempotent backfill).
 *
 * Two modes, one path, because both are the same operation — "make the tracked
 * table cover the corpus" — and because a growing corpus is the owner's normal
 * workflow (D82(a)):
 *
 * - **first adoption** (`entry_status` is empty): the spec's first-startup
 *   import. Every corpus key is adopted as `status='extracted'` in ONE
 *   transaction, the count is surfaced to the UI as the spec's once-only toast
 *   ("Imported {n} existing entries from SpiralDB", L260), and **no**
 *   `status_history` row is written — the whole table appears at once, which is
 *   an origin rather than a transition.
 * - **reconcile** (`entry_status` has rows): D82(a)'s idempotent backfill. The
 *   first-startup-only version left every file that arrived later invisible to
 *   `entry_status` — and therefore to the search palette and to any status
 *   write, which 404s on a key with no row. Every corpus key that has no row is
 *   adopted exactly as above, **plus** one `status_history` row recording where
 *   it came from; a later arrival *is* a change to a dataset that already
 *   existed, and it gets the same five-column creation row the tool's other two
 *   creation paths write (`savePipeline.ts`'s insert, with notes from
 *   `captureSourceNote` / `CREATED_VIA_UI_NOTE`).
 *
 * **ADDITIVE ONLY.** This function never deletes, never re-statuses and never
 * re-writes a row that already exists, and it never restamps a timestamp: a
 * human's `reviewed` status, its note and its history must survive a backfill
 * untouched (D69(b)'s invisible-second-writer failure). The guarantee is
 * structural rather than careful — the only statements below are `SELECT`,
 * `INSERT OR IGNORE INTO entry_status`, `INSERT INTO status_history` for a row
 * this call just inserted, and one `COUNT`-shaped read: there is no `UPDATE`,
 * no `DELETE` and no `INSERT OR REPLACE` in the file, and an already-tracked key
 * is filtered out *before* any insert is attempted.
 *
 * **Cost.** Cost is paid at every startup (the reconcile must look, or it cannot
 * find later files); it is bounded by the corpus, not by the table — one read of
 * the tracked keys, eight directory reads, and one lenient parse per `.json`
 * file (measured on the owner's 2,279-file corpus: **76-133 ms**, and **zero**
 * INSERT statements when nothing is missing, which is the steady state). A
 * cached "already scanned" marker was rejected on purpose: a stale marker is the
 * failure class D82(b) names for this run, and it would make the backfill
 * silently stop running when a database is copied or a corpus restored.
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

export interface RunCorpusImportOptions {
  db: Db;
  /** `settings.spiraldb_path` — the SpiralDB repository root to scan. */
  spiraldbPath: string;
  /** Timestamp written to every `extracted_at`; injectable for tests. */
  now?: () => string;
  /** Filesystem hooks; tests replace them to simulate read failures. */
  deps?: ImportDeps;
}

export interface ImportTypeCounts {
  /** Rows this run inserted into `entry_status`. */
  imported: number;
  /**
   * Candidate files that yielded no usable key, plus duplicates and non-JSON.
   *
   * A file whose key the table **already tracks** is deliberately not counted
   * here: it yielded a usable key, so it is not "skipped" in the sense above, and
   * counting it would report every corpus file as skipped on every steady-state
   * startup. `imported + skipped + failed` therefore equals the files that
   * needed a decision, not every file the scan read.
   */
  skipped: number;
  /** Files that could not be read or parsed as JSON. */
  failed: number;
  /** Keys seen more than once within this type (the first file wins). */
  duplicates: string[];
  /** `true` when the directory does not exist in this repository. */
  directoryMissing: boolean;
}

export interface ImportResult {
  /**
   * `true` when this process adopted rows from the corpus: the table was empty
   * (the spec's first-startup import, which "runs" even when the corpus holds
   * nothing) or the reconcile backfilled at least one later-arriving key. `false`
   * when the table already covered the corpus and this run wrote nothing — the
   * client's once-only toast keys off this (D37).
   */
  ran: boolean;
  imported: number;
  skipped: number;
  failed: number;
  /** All eight singular types, zeros included. */
  byType: Record<StatusObjectType, ImportTypeCounts>;
  /**
   * The single `extracted_at` written to every row this run adopted; `null` when
   * it adopted none.
   */
  importedAt: string | null;
}

/** One scanned file: its key, and the corpus-relative path its history note names. */
export interface ScannedCorpusEntry {
  key: string;
  /**
   * `<Directory>/<file>.json` — the provenance the backfill's history note
   * records. Composed with `/` rather than `path.join` so a note written on one
   * platform reads the same on another (the corpus stores `/`).
   */
  file: string;
}

/**
 * The `status_history.changed_by` a corpus adoption records.
 *
 * A literal, not `settings.user_name`: nobody asked for this write at the moment
 * it happens, and attributing an automatic adoption to the configured human
 * would be a false audit trail (the live database's `user_name` is `""` as well,
 * which would record nothing at all). The two paths that *are* user-driven pass
 * the resolved user; this one names the writer.
 */
export const CORPUS_IMPORT_ACTOR = 'corpus import';

/**
 * The `status_history.notes` a corpus adoption records — the counterpart of
 * `captureSourceNote` ("Imported from packet capture {file}") for the corpus
 * rather than for a capture, and the answer to "where did this row come from?".
 */
export function corpusImportNote(file: string): string {
  return `Imported from SpiralDB corpus ${file}`;
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
): ScannedCorpusEntry[] {
  const directory = path.join(root, spec.directory);

  let entries: ImportDirectoryEntry[];
  try {
    entries = readDirectory(directory);
  } catch {
    // A directory that is not there (NpcDropTable/ today) contributes nothing:
    // absent is zero work, never an error.
    counts.directoryMissing = true;
    return [];
  }

  const keys: ScannedCorpusEntry[] = [];
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
    keys.push({ key, file: `${spec.directory}/${entry.name}` });
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

/** Every `(object_type, object_key)` the table already holds, grouped by type. */
interface TrackedKeys {
  /** Rows in `entry_status`, whatever their type — the first-adoption test. */
  total: number;
  byType: Record<StatusObjectType, Set<string>>;
}

/**
 * Reads the tracked keys once for the whole reconcile — ONE statement, and the
 * only reason a steady-state startup needs the database at all.
 *
 * A row whose `object_type` is outside the eight tracked types (a hand-written
 * `global_registry` row, say) still counts toward `total`: it is a row the
 * spec's first-startup import must not run against, even though this scan has no
 * directory for it.
 */
function readTrackedKeys(db: Db): TrackedKeys {
  const rows = db
    .prepare<[], { object_type: string; object_key: string }>(
      'SELECT object_type, object_key FROM entry_status',
    )
    .all();

  const byType = Object.fromEntries(
    STATUS_OBJECT_TYPES.map((objectType) => [objectType, new Set<string>()]),
  ) as Record<StatusObjectType, Set<string>>;

  for (const row of rows) {
    if (isStatusObjectType(row.object_type)) {
      byType[row.object_type].add(row.object_key);
    }
  }

  return { total: rows.length, byType };
}

/**
 * Makes `entry_status` cover the SpiralDB corpus: the spec's first-startup
 * import when the table is empty, D82(a)'s idempotent backfill when it is not.
 *
 * The two modes share one scan and one insert path so a key adopted at first
 * startup and a key adopted later are the same row shape; they differ in exactly
 * one place, the history row (see the module doc).
 *
 * All inserts happen in ONE transaction, so a failure leaves the table exactly as
 * it was — the next startup then retries instead of adopting half of the corpus.
 * The reconcile's steady state (nothing missing) executes **no** write
 * statement at all and returns `ran: false` with the scan's real per-type
 * accounting.
 */
export function runCorpusImport(options: RunCorpusImportOptions): ImportResult {
  const { db, spiraldbPath } = options;
  const now = options.now ?? (() => new Date().toISOString());
  const readDirectory = options.deps?.readdir ?? readDirectoryEntries;
  const readFile = options.deps?.readFile ?? ((file: string) => readFileSync(file, 'utf8'));

  const byType = emptyByType();
  const tracked = readTrackedKeys(db);
  // "Empty" is about the whole table, not the eight tracked types: a database
  // that holds rows this scan does not know about is still a database the spec's
  // first-startup import must not run against.
  const firstAdoption = tracked.total === 0;

  const candidates: Array<[StatusObjectType, ScannedCorpusEntry]> = [];
  for (const spec of IMPORT_TYPE_SPECS) {
    const counts = byType[spec.objectType];
    const trackedKeys = tracked.byType[spec.objectType];
    for (const entry of scanType(spiraldbPath, spec, counts, readDirectory, readFile)) {
      // Already tracked: not a candidate, and not counted (see ImportTypeCounts).
      // This is the ADDITIVE-ONLY filter: the insert below is never even
      // attempted for a key that has a row, so nothing about that row — status,
      // notes, timestamps, history — is in reach of this function.
      if (trackedKeys.has(entry.key)) {
        continue;
      }
      candidates.push([spec.objectType, entry]);
    }
  }

  const skipped = STATUS_OBJECT_TYPES.reduce((sum, type) => sum + byType[type].skipped, 0);
  const failed = STATUS_OBJECT_TYPES.reduce((sum, type) => sum + byType[type].failed, 0);

  if (!firstAdoption && candidates.length === 0) {
    // The steady state: the corpus is fully tracked. Every statement above was a
    // read; report no work rather than a zero-row import.
    const steady: ImportResult = {
      ran: false,
      imported: 0,
      skipped,
      failed,
      byType,
      importedAt: null,
    };
    recordImportResult(steady);
    return steady;
  }

  const importedAt = now();
  const insertEntry = db.prepare(
    `INSERT OR IGNORE INTO entry_status (object_type, object_key, status, extracted_at)
     VALUES (?, ?, 'extracted', ?)`,
  );
  const insertHistory = db.prepare(
    `INSERT INTO status_history (entry_status_id, old_status, new_status, notes, changed_by, changed_at)
     VALUES (?, NULL, 'extracted', ?, ?, ?)`,
  );

  const adoptAll = db.transaction((batch: Array<[StatusObjectType, ScannedCorpusEntry]>): void => {
    for (const [objectType, entry] of batch) {
      const counts = byType[objectType];
      const info = insertEntry.run(objectType, entry.key, importedAt);
      if (info.changes === 0) {
        // Only reachable through a UNIQUE conflict this read missed — another
        // process adopted the key between the read and this insert. Its row (and
        // whatever history it already had) is left alone and no second history
        // row is written for it.
        counts.skipped += 1;
        counts.duplicates.push(entry.key);
        continue;
      }
      counts.imported += 1;
      if (!firstAdoption) {
        insertHistory.run(
          info.lastInsertRowid,
          corpusImportNote(entry.file),
          CORPUS_IMPORT_ACTOR,
          importedAt,
        );
      }
    }
  });

  adoptAll(candidates);

  const imported = STATUS_OBJECT_TYPES.reduce((sum, type) => sum + byType[type].imported, 0);
  // A first adoption "ran" even when the corpus yielded nothing (the spec's
  // import of an empty/absent corpus is a completed import, not a skip); the
  // reconcile ran only if it actually adopted a row.
  const ran = firstAdoption || imported > 0;

  const result: ImportResult = {
    ran,
    imported,
    skipped: STATUS_OBJECT_TYPES.reduce((sum, type) => sum + byType[type].skipped, 0),
    failed: STATUS_OBJECT_TYPES.reduce((sum, type) => sum + byType[type].failed, 0),
    byType,
    importedAt: ran ? importedAt : null,
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
