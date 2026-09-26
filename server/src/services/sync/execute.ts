import { rm } from 'node:fs/promises';
import path from 'node:path';

import { readSettings, type Db } from '../../db.js';
import {
  buildDropTableRows,
  buildQuestRows,
  buildZoneRows,
  type BuildResult,
  type DropTableRow,
  type QuestRow,
  type ZoneRow,
} from './corpus.js';
import { createKeyLookup, scanLangDir } from './lang.js';
import {
  EMPTY_MANIFEST_ID_REPORT,
  TEMPLATE_MANIFEST_FILE,
  loadTemplateManifest,
  type ManifestIdReport,
} from './manifest.js';
import { resolveRevision } from './revision.js';
import { buildStringTableRows, type StringTableRow } from './stringtable.js';
import { scanTemplateTree, type ItemRow, type NpcRow, type SpellRow } from './templates.js';
import { runUnpack, UnpackError } from './unpack.js';

/**
 * Sync orchestrator — task 1.4f (transactional replace + `sync_history`),
 * consumed by `POST /api/sync` (1.4g) and `npm run sync`; task 1.4h adds the
 * manifest-driven template identity (D35).
 *
 * Pipeline (each stage injectable so tests never spawn a real unpack and never
 * touch a real database):
 *
 * ```
 * settings → resolveRevision → runUnpack → loadTemplateManifest → scanLangDir ┐
 *                                        ↘ scanTemplateTree(manifest)
 *                                        ↘ buildQuest/Zone/DropTableRows
 *                                        → ONE transaction: DELETE ×7 + bulk INSERT + sync_history
 * ```
 *
 * ## Id provenance (D35)
 *
 * `TemplateManifest_deser.json` is loaded from the tree root and handed to the
 * scanner, which keys every row by the manifest `m_id` for its source path. A
 * tree without the manifest fails loudly rather than silently falling back to the
 * string-table index — that fallback loses 13,003 of 16,474 spell rows.
 *
 * ## Transaction contract
 *
 * All seven friendly-name tables and the `success` `sync_history` row are
 * replaced in **one** better-sqlite3 transaction. Any throw rolls the whole thing
 * back — the previous contents of the seven tables survive untouched — and a
 * **separate** transaction then writes a `failed` `sync_history` row with
 * `error_message`, so `GET /api/sync/status` reports the failure.
 *
 * `status` is `'success'` or `'failed'` only. `'partial'` (the schema's third
 * value) is deliberately not produced: a sync is all-or-nothing per the
 * transaction above, and a "some families succeeded" state cannot be detected
 * once a failure has rolled the replace back.
 *
 * Columns that Root.wad cannot supply — `items.category`, `spells.school`,
 * `npcs.npc_type` — are written as `NULL` rather than invented (D33(a) keeps
 * `npcs` a flat list; no WAD family exposes an item category).
 */

/** Per-table row counts inserted by one sync run. */
export interface SyncCounts {
  items: number;
  spells: number;
  npcs: number;
  quests: number;
  zones: number;
  drop_tables: number;
  string_table: number;
}

export const ZERO_SYNC_COUNTS: SyncCounts = {
  items: 0,
  spells: 0,
  npcs: 0,
  quests: 0,
  zones: 0,
  drop_tables: 0,
  string_table: 0,
};

export type SyncStatus = 'success' | 'failed';

/**
 * Rows the primary keys forced out of the template-derived tables.
 *
 * **Measured 0 / 0 / 0 since task 1.4h (D35).** Every row's id now comes from
 * `TemplateManifest_deser.json`, whose 137,423 ids are distinct — so `items.gid`
 * (79,835), `spells.template_id` (18,173) and `npcs.template_id` (23,033) are all
 * unique in the real build.
 *
 * The counter and the de-duplication stay in place as the loud guard for the
 * situation that created this story: keying `spells` by the string-table index of
 * `m_displayName` (`Spells_*` and `Spell_*` share that index space — index 151 is
 * "Freeze" *and* "Snow Shield") collapsed 16,474 parsed rows onto 3,471 ids and
 * dropped 13,003 of them. If a future id source ever regresses, the summary says
 * so instead of losing rows silently.
 */
export interface SyncDedupe {
  items: number;
  spells: number;
  npcs: number;
}

export const ZERO_SYNC_DEDUPE: SyncDedupe = { items: 0, spells: 0, npcs: 0 };

/** The zeroed id-provenance report (failure path / no manifest read). */
export const ZERO_MANIFEST_REPORT: ManifestIdReport = {
  ...EMPTY_MANIFEST_ID_REPORT,
  mismatchSamples: [],
  missingSamples: [],
};

/** First row per primary key wins; the rest are counted as dropped. */
function dedupeByKey<T>(
  rows: readonly T[],
  key: (row: T) => number,
): { rows: T[]; dropped: number } {
  const seen = new Set<number>();
  const kept: T[] = [];
  let dropped = 0;
  for (const row of rows) {
    const id = key(row);
    if (seen.has(id)) {
      dropped += 1;
      continue;
    }
    seen.add(id);
    kept.push(row);
  }
  return { rows: kept, dropped };
}

/** Explicit settings overrides — tests inject them so no real path is read. */
export interface SyncOverrides {
  /** Settings `aurorium_path`. */
  auroriumPath?: string;
  /** Settings `imcodec_path`. */
  imcodecPath?: string;
  /** Settings `spiraldb_path` (the corpus: quests, zones, drop tables). */
  spiraldbPath?: string;
  /** Revision directory override passed to `resolveRevision`. */
  revision?: string;
}

/** The injectable pipeline stages. Every one defaults to the real implementation. */
export interface SyncDeps {
  resolveRevision: typeof resolveRevision;
  runUnpack: typeof runUnpack;
  loadTemplateManifest: typeof loadTemplateManifest;
  scanLangDir: typeof scanLangDir;
  scanTemplateTree: typeof scanTemplateTree;
  buildQuestRows: typeof buildQuestRows;
  buildZoneRows: typeof buildZoneRows;
  buildDropTableRows: typeof buildDropTableRows;
}

export const defaultSyncDeps: SyncDeps = {
  resolveRevision,
  runUnpack,
  loadTemplateManifest,
  scanLangDir,
  scanTemplateTree,
  buildQuestRows,
  buildZoneRows,
  buildDropTableRows,
};

export interface RunSyncOptions {
  /** Connection to replace the friendly-name tables in. */
  db: Db;
  /** Clock, injectable so the `sync_history` timestamp is deterministic in tests. */
  now?: () => Date;
  /** Explicit settings overrides (tests). Otherwise read from the `settings` table. */
  overrides?: SyncOverrides;
  /** Injected pipeline stages (tests). */
  deps?: Partial<SyncDeps>;
  /**
   * An existing unpack tree to reuse — **skips the unpack entirely** and reports
   * `reused: true` (`npm run sync --tree {dir}` / `SPIRALDB_SYNC_TREE`). A
   * caller-provided tree is never deleted.
   */
  treeDir?: string;
}

/** Where the run's wall clock went — the "unpack vs insert" split the CLI prints. */
export interface SyncTimings {
  /** Unpack spawn; `0` on the reuse path. */
  unpackMs: number;
  /** `.lang` + template + corpus scanning. */
  scanMs: number;
  /** The replace transaction (DELETE + ~217k INSERTs + `sync_history`). */
  writeMs: number;
}

export interface RunSyncResult {
  status: SyncStatus;
  /** Resolved revision, or `null` when resolution itself failed. */
  revision: string | null;
  counts: SyncCounts;
  /** Rows the primary keys forced out (see `SyncDedupe`; 0/0/0 since D35). */
  deduplicated: SyncDedupe;
  /** Manifest id provenance (see `ManifestIdReport`). */
  manifest: ManifestIdReport;
  /** Whole-run wall clock in milliseconds. */
  durationMs: number;
  /** The value written to `sync_history.sync_timestamp` (ISO-8601, `…Z`). */
  timestamp: string;
  /** `true` when an existing tree was used and no process was spawned. */
  reused: boolean;
  /** The unpack tree used (`null` when resolution failed before one existed). */
  treeDir: string | null;
  timings: SyncTimings;
  errorMessage?: string;
}

/** `2026-09-25T15:30:00Z` — the `sync_history` timestamp form (spec-api example). */
export function formatSyncTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The orchestrator's signature — `runSync` itself, or an injected fake. Both the
 * API router and the CLI are typed against this so a test can drive either
 * without a real unpack.
 */
export type SyncRunner = (options: RunSyncOptions) => Promise<RunSyncResult>;

/** Every table the transactional replace owns, in insert order. */
const REPLACED_TABLES = [
  'string_table',
  'items',
  'spells',
  'npcs',
  'quests',
  'zones',
  'drop_tables',
] as const;

interface SyncRows {
  string_table: StringTableRow[];
  items: ItemRow[];
  spells: SpellRow[];
  npcs: NpcRow[];
  quests: QuestRow[];
  zones: ZoneRow[];
  drop_tables: DropTableRow[];
}

/**
 * Replaces the seven friendly-name tables plus the `success` history row inside
 * one transaction. Throws (and therefore rolls back) on the first bad row.
 *
 * Prepared once per run: the bulk `string_table` insert is ~217k rows, so the
 * statement is compiled once and reused, with no per-row string building beyond
 * the key the builder already produced.
 */
function replaceTables(db: Db, rows: SyncRows, revision: string, timestamp: string): void {
  const insertString = db.prepare(
    'INSERT INTO string_table (key, value, category) VALUES (?, ?, ?)',
  );
  const insertItem = db.prepare('INSERT INTO items (gid, name, category) VALUES (?, ?, ?)');
  const insertSpell = db.prepare('INSERT INTO spells (template_id, name, school) VALUES (?, ?, ?)');
  const insertNpc = db.prepare('INSERT INTO npcs (template_id, name, npc_type) VALUES (?, ?, ?)');
  const insertQuest = db.prepare(
    'INSERT INTO quests (quest_name, title, level, is_mainline) VALUES (?, ?, ?, ?)',
  );
  const insertZone = db.prepare(
    'INSERT INTO zones (zone_path, display_name, world) VALUES (?, ?, ?)',
  );
  const insertDropTable = db.prepare('INSERT INTO drop_tables (name, description) VALUES (?, ?)');
  const insertHistory = db.prepare(
    `INSERT INTO sync_history
       (sync_timestamp, revision, items_count, spells_count, npcs_count, quests_count, zones_count, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'success', NULL)`,
  );

  const replace = db.transaction(() => {
    for (const table of REPLACED_TABLES) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    for (const row of rows.string_table) {
      insertString.run(row.key, row.value, row.category);
    }
    for (const row of rows.items) {
      insertItem.run(row.gid, row.name, null);
    }
    for (const row of rows.spells) {
      insertSpell.run(row.template_id, row.name, null);
    }
    for (const row of rows.npcs) {
      insertNpc.run(row.template_id, row.name, null);
    }
    for (const row of rows.quests) {
      insertQuest.run(row.quest_name, row.title, row.level, row.is_mainline ? 1 : 0);
    }
    for (const row of rows.zones) {
      insertZone.run(row.zone_path, row.display_name, row.world);
    }
    for (const row of rows.drop_tables) {
      insertDropTable.run(row.name, row.description);
    }
    insertHistory.run(
      timestamp,
      revision,
      rows.items.length,
      rows.spells.length,
      rows.npcs.length,
      rows.quests.length,
      rows.zones.length,
    );
  });

  replace();
}

/**
 * The failure half of the contract: a **separate** transaction writes the
 * `failed` history row after the data transaction has already rolled back.
 *
 * Never throws: a database too broken to record a failure must not replace the
 * original error, which is what the caller reports.
 */
export function recordSyncFailure(
  db: Db,
  revision: string | null,
  message: string,
  timestamp: string,
): boolean {
  try {
    const write = db.transaction(() => {
      db.prepare(
        `INSERT INTO sync_history
           (sync_timestamp, revision, items_count, spells_count, npcs_count, quests_count, zones_count, status, error_message)
         VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 'failed', ?)`,
      ).run(timestamp, revision, message);
    });
    write();
    return true;
  } catch (error) {
    process.emitWarning(
      `[sync] could not record the failed sync_history row: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs one full sync: resolve → unpack (or reuse) → scan → transactional replace.
 *
 * Resolves its own temp tree and removes it in `finally` (a reused `treeDir` is
 * never removed). Returns a result object for both outcomes — a failed sync is
 * not a thrown exception, because the caller must still answer `status:'failed'`
 * and the failure is already durable in `sync_history`.
 */
export async function runSync(options: RunSyncOptions): Promise<RunSyncResult> {
  const { db } = options;
  const deps: SyncDeps = { ...defaultSyncDeps, ...options.deps };
  const now = options.now ?? (() => new Date());
  const started = Date.now();

  let revision: string | null = null;
  let treeDir: string | null = options.treeDir ?? null;
  let ownsTree = false;
  let reused = options.treeDir !== undefined;
  const timings: SyncTimings = { unpackMs: 0, scanMs: 0, writeMs: 0 };
  let counts: SyncCounts = { ...ZERO_SYNC_COUNTS };
  let deduplicated: SyncDedupe = { ...ZERO_SYNC_DEDUPE };
  let manifestReport: ManifestIdReport = ZERO_MANIFEST_REPORT;

  try {
    // Inside the try: a missing `settings` table (an un-migrated database) must
    // still land as a `failed` history row rather than an unhandled rejection.
    const settings = readSettings(db);
    const auroriumPath = options.overrides?.auroriumPath ?? settings.aurorium_path ?? '';
    const imcodecPath = options.overrides?.imcodecPath ?? settings.imcodec_path ?? '';
    const spiraldbPath = options.overrides?.spiraldbPath ?? settings.spiraldb_path ?? '';

    if (auroriumPath === '') {
      throw new Error(
        'settings.aurorium_path is empty — set it in the Settings page or via the AURORIUM_PATH environment variable before syncing.',
      );
    }
    if (spiraldbPath === '') {
      throw new Error(
        'settings.spiraldb_path is empty — the quests/zones/drop_tables corpus cannot be read. Set it in the Settings page or via SPIRALDB_PATH.',
      );
    }

    const resolved = deps.resolveRevision({
      auroriumPath,
      override: options.overrides?.revision,
    });
    revision = resolved.revision;

    if (options.treeDir === undefined) {
      if (imcodecPath === '') {
        throw new Error(
          'settings.imcodec_path is empty — set it in the Settings page or via the IMCODEC_PATH environment variable before syncing.',
        );
      }
      // `keepTempDir` on purpose: the tree must outlive the spawn so it can be
      // scanned here; this orchestrator removes it in the `finally` below.
      const unpack = await deps.runUnpack({
        imcodecPath,
        rootWadPath: resolved.rootWadPath,
        keepTempDir: true,
      });
      treeDir = unpack.tempDir;
      ownsTree = true;
      reused = unpack.reused;
      timings.unpackMs = unpack.durationMs;
    }

    if (treeDir === null) {
      throw new Error('No unpack tree available — pass `treeDir` or run without one.');
    }

    const scanStarted = Date.now();
    // The manifest is the authoritative id space (D35): read it before the tree
    // scan and let the parse result go as soon as the id↔path maps exist.
    const manifestPath = path.join(treeDir, TEMPLATE_MANIFEST_FILE);
    const manifest = await deps.loadTemplateManifest(manifestPath).catch((error: unknown) => {
      throw new Error(
        `Could not read the template manifest at ${manifestPath} — without it the ` +
          `authoritative spell id space is unavailable and rows would silently lose ` +
          `their ids (${errorMessage(error)}).`,
      );
    });
    const lang = await deps.scanLangDir(path.join(treeDir, 'Locale', 'en-US'));
    const lookup = createKeyLookup(lang.byCategory, lang.namedByCategory);
    const templates = await deps.scanTemplateTree(treeDir, { resolveName: lookup, manifest });
    manifestReport = templates.manifest;
    const quests: BuildResult<QuestRow> = await deps.buildQuestRows({
      questTemplatesDir: path.join(spiraldbPath, 'QuestTemplates'),
      lookupTitle: lookup,
    });
    const zones = await deps.buildZoneRows({
      zoneTransferDir: path.join(spiraldbPath, 'ZoneTransfer'),
    });
    const dropTables = await deps.buildDropTableRows({
      dropTablesDir: path.join(spiraldbPath, 'DropTables'),
    });
    timings.scanMs = Date.now() - scanStarted;

    // The template scanner reports one row per `_deser.json`; the three keyed
    // tables need one row per primary key. With the manifest ids (D35) that is a
    // no-op — the counter stays as the loud guard (see `SyncDedupe`).
    // Corpus-derived tables already de-duplicate inside their builders, so an
    // anomaly there still fails the transaction loudly.
    const items = dedupeByKey(templates.items, (row) => row.gid);
    const spells = dedupeByKey(templates.spells, (row) => row.template_id);
    const npcs = dedupeByKey(templates.npcs, (row) => row.template_id);
    deduplicated = {
      items: items.dropped,
      spells: spells.dropped,
      npcs: npcs.dropped,
    };

    const rows: SyncRows = {
      string_table: buildStringTableRows(lang),
      items: items.rows,
      spells: spells.rows,
      npcs: npcs.rows,
      quests: quests.rows,
      zones: zones.rows,
      drop_tables: dropTables.rows,
    };

    counts = {
      items: rows.items.length,
      spells: rows.spells.length,
      npcs: rows.npcs.length,
      quests: rows.quests.length,
      zones: rows.zones.length,
      drop_tables: rows.drop_tables.length,
      string_table: rows.string_table.length,
    };

    const timestamp = formatSyncTimestamp(now());
    const writeStarted = Date.now();
    replaceTables(db, rows, revision, timestamp);
    timings.writeMs = Date.now() - writeStarted;

    return {
      status: 'success',
      revision,
      counts,
      deduplicated,
      manifest: manifestReport,
      durationMs: Date.now() - started,
      timestamp,
      reused,
      treeDir,
      timings,
    };
  } catch (error) {
    // An unpack that failed after creating its tree leaves it behind
    // (`keepTempDir`), so take ownership of that path for the cleanup below.
    if (!ownsTree && error instanceof UnpackError) {
      treeDir = error.tempDir;
      ownsTree = true;
    }
    const message = errorMessage(error);
    const timestamp = formatSyncTimestamp(now());
    recordSyncFailure(db, revision, message, timestamp);
    return {
      status: 'failed',
      revision,
      counts: { ...ZERO_SYNC_COUNTS },
      deduplicated: { ...ZERO_SYNC_DEDUPE },
      manifest: { ...ZERO_MANIFEST_REPORT, mismatchSamples: [], missingSamples: [] },
      durationMs: Date.now() - started,
      timestamp,
      reused,
      treeDir,
      timings,
      errorMessage: message,
    };
  } finally {
    if (ownsTree && treeDir !== null) {
      await rm(treeDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
