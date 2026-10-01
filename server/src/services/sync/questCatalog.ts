import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

import type { Db } from '../../db.js';
import {
  QuestRefsCollector,
  computeHoldoutAccuracy,
  createQuestIdLookups,
  parseQuestTitleKey,
  parseWizQstKey,
  summarizeQuestRefs,
  type HoldoutReport,
  type QuestCatalogRecord,
  type QuestIdPair,
  type QuestLinkKind,
  type QuestRefsReport,
  type QuestRefSourceRow,
} from './questRefs.js';
import { runWadScan, type RunWadScanOptions, type WadScanResult } from './wadscan.js';

/**
 * Quest catalog sync stage — task 6.4
 * ([plan-phase-6-quest-catalog.md](../../../../docs/plan-phase-6-quest-catalog.md) L237–249,
 * [spec-data-model.md](../../../../docs/spec-data-model.md) L137–220).
 *
 * ## Where this stage sits in the sync's transaction
 *
 * The spec's staging rule (L214-220): *corpus rows are written first, then catalog rows are
 * merged, then `quest_catalog_refs` and `quest_ids` are replaced, then
 * `has_definition`/`link_kind`/`title_source`/`reference_count` are recomputed from what was
 * merged.* Everything after "corpus rows are written" happens inside the **existing**
 * transaction, so this module is split in two halves that meet at that boundary:
 *
 * | Half | Runs | Touches |
 * |---|---|---|
 * | {@link collectQuestCatalog} | **before** the transaction, async | the `wad-scan` child process and a temp NDJSON — no database |
 * | {@link writeQuestCatalog} | **inside** the transaction, sync | `quests`, `quest_catalog_refs`, `quest_ids` |
 *
 * The split is not cosmetic. `QuestRefsCollector.finish()` resolves every id link against the
 * string table (`QuestTitle_*` keys and `WizQst<id>_*` row counts), and the string table is
 * **replaced by the same transaction**: on a fresh database the pre-sync string table is empty,
 * so resolving links before the transaction would yield zero links, zero ids — and two
 * consecutive syncs would disagree (the first linkless, the second linked). `finish()` therefore
 * runs after `string_table` has been written, and the collector accumulates rows without touching
 * the database (`add()` is pure — see questRefs.ts).
 *
 * ## The skipped path (p6-03-ac4, D55)
 *
 * A missing `tools/bin/wad-scan` is an ordinary state of the world, not a failure: the run
 * reports `{ status: 'skipped', message }` from {@link runWadScan} and the transaction still
 * commits the corpus rows with `has_definition = 1`. CI has no .NET SDK, so this path must stay
 * green.
 *
 * `quest_catalog_refs` and `quest_ids` are **replaced in both cases** — they are emptied as part
 * of the transaction and re-filled only when the tool ran. Two reasons, both structural:
 *
 * 1. `quests` is one of the seven transactionally replaced tables, so catalog-only rows cannot
 *    survive a run; leaving their refs behind would be stale data.
 * 2. `quest_catalog_refs.quest_name REFERENCES quests(quest_name)` has no `ON DELETE` clause and
 *    `openDb` turns `foreign_keys` on, so `DELETE FROM quests` with refs still pointing at it
 *    would fail the whole transaction. The deletes are therefore ordered refs → ids → quests.
 *
 * A skipped run consequently leaves `quests` holding exactly the corpus rows (every one with
 * `has_definition = 1`) and both catalog tables empty. That is measured, not assumed — see the
 * p6-05 evidence.
 *
 * ## What each id tier means (read before trusting `coverage`)
 *
 * `quest_ids` holds the ids the **client holds text for**: every numeric id with at least one
 * `WizQst<id>_*` row in `string_table` (measured 4,823 here — the ~4,830 of D97/D98). It is not
 * the union with the 5,957 `QuestTitle_*` keys: 1,782 ids carry a title and no text, and those
 * are excluded because the tier's definition is "the id space the client holds text for"
 * ([spec-data-model.md](../../../../docs/spec-data-model.md) L171-180). `coverage.id_space` is
 * `count(*)` on this table, so the two can never drift.
 */

/** The `--select` globs task 6.3's extractor was measured on (`gamedata.bin,triggers.xml`). */
export const CATALOG_EXTRACT_SELECT: readonly string[] = ['gamedata.bin', 'triggers.xml'];

/** The stage's own outcome. `not-run` is the failure path (the pipeline threw before it). */
export type QuestCatalogStatus = 'ok' | 'skipped' | 'not-run';

/**
 * The injectable half of the stage: one process invoker. Tests inject a fake so no test builds or
 * spawns a .NET binary.
 */
export interface QuestCatalogDeps {
  runWadScan: (options: RunWadScanOptions) => Promise<WadScanResult>;
}

export const defaultQuestCatalogDeps: QuestCatalogDeps = { runWadScan };

/* ------------------------------------------------------------------ phase A: collect */

export interface CollectQuestCatalogOptions {
  /** The revision's `Data/GameData` — what `wad-scan extract --gamedata` reads. */
  gamedataDir: string;
  /** Temp directory for the NDJSON; a fresh `mkdtemp` is created and removed when omitted. */
  tmpDir?: string;
  /** Injected process runner (tests). */
  deps?: Partial<QuestCatalogDeps>;
}

/**
 * The extract's outcome plus the still-unresolved collector.
 *
 * `collector` is deliberately **not** finished here: `finish()` needs the post-write string table
 * (see the module doc-comment), so the caller finishes it inside the transaction.
 */
export interface CollectedQuestCatalog {
  status: Extract<QuestCatalogStatus, 'ok' | 'skipped'>;
  reason: string | null;
  /** The tool's own message on the skipped path (it already names the path and the build command). */
  message: string | null;
  binaryPath: string | null;
  collector: QuestRefsCollector | null;
  /** NDJSON rows read (0 on the skipped path). */
  rows: number;
  /** `wad-scan extract` wall clock. */
  extractMs: number;
  /** Reading + walking the NDJSON wall clock. */
  collectMs: number;
  /** Where the NDJSON was written. It is removed before this returns (it is only an audit trail). */
  ndjsonPath: string | null;
}

/** The "nothing was collected" value — the failure path's and a caller's default. */
export const NOT_COLLECTED: CollectedQuestCatalog = {
  status: 'skipped',
  reason: 'not-run',
  message: null,
  binaryPath: null,
  collector: null,
  rows: 0,
  extractMs: 0,
  collectMs: 0,
  ndjsonPath: null,
};

/** Feeds one NDJSON file into the collector, line by line (the real file is 97.7 MB). */
async function readNdjsonInto(file: string, collector: QuestRefsCollector): Promise<number> {
  const stream = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });
  let rows = 0;
  for await (const line of stream) {
    if (line === '') {
      continue;
    }
    collector.add(JSON.parse(line) as QuestRefSourceRow);
    rows += 1;
  }
  return rows;
}

/**
 * Phase A: run `wad-scan extract` over the revision's `Data/GameData` and walk the NDJSON into a
 * {@link QuestRefsCollector}.
 *
 * Never throws for a missing binary (that is the typed `skipped` result); a run that *happened*
 * and failed still throws `WadScanError` out of {@link runWadScan}, which fails the sync loudly.
 * The temp directory is always removed, including on a throw, so the stage leaves no file behind.
 */
export async function collectQuestCatalog(
  options: CollectQuestCatalogOptions,
): Promise<CollectedQuestCatalog> {
  const deps: QuestCatalogDeps = { ...defaultQuestCatalogDeps, ...options.deps };
  const ownsTmpDir = options.tmpDir === undefined;
  const tmpDir = options.tmpDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'spiraldb-ui-catalog-'));
  const ndjsonPath = path.join(tmpDir, 'quest-refs.ndjson');
  const extractStarted = Date.now();

  try {
    const scan = await deps.runWadScan({
      request: {
        command: 'extract',
        gamedataDir: options.gamedataDir,
        select: CATALOG_EXTRACT_SELECT,
        outPath: ndjsonPath,
      },
    });
    const extractMs = Date.now() - extractStarted;

    if (scan.status === 'skipped') {
      return {
        status: 'skipped',
        reason: scan.reason,
        message: scan.message,
        binaryPath: scan.binaryPath,
        collector: null,
        rows: 0,
        extractMs,
        collectMs: 0,
        ndjsonPath: null,
      };
    }

    const collector = new QuestRefsCollector();
    const collectStarted = Date.now();
    const rows = await readNdjsonInto(ndjsonPath, collector);

    return {
      status: 'ok',
      reason: null,
      message: null,
      binaryPath: scan.binaryPath,
      collector,
      rows,
      extractMs,
      collectMs: Date.now() - collectStarted,
      ndjsonPath,
    };
  } finally {
    if (ownsTmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

/* ------------------------------------------------------------------ phase B: write */

/** One corpus row's `(name, id)` anchor material — the two fields this stage reads. */
export interface QuestCatalogCorpusRow {
  quest_name: string;
  titleKey: string | null;
}

export interface WriteQuestCatalogOptions {
  db: Db;
  collected: CollectedQuestCatalog;
  /** The corpus rows the transaction just wrote — the anchors and the hold-out's pair set. */
  corpusRows: readonly QuestCatalogCorpusRow[];
  /** The corpus the counts belong to, always named (the phase's rule for two corpora). */
  corpus: string | null;
}

/** Every number the stage reports. `coverage`'s three denominators appear here as `*_rows`. */
export interface QuestCatalogCounts {
  /** Corpus rows the transaction wrote (one per `QuestTemplates/*.json`, `has_definition = 1`). */
  corpus_rows: number;
  /** Catalog rows the extractor emitted (1,449 measured on the owner tree). */
  catalog_rows: number;
  /** Catalog names that had no corpus row (inserted with `has_definition = 0`). */
  catalog_only_rows: number;
  /** Catalog names that already existed as corpus rows (merged, `has_definition` untouched). */
  merged_rows: number;
  /** `count(*)` on `quests` after the merge — `coverage.nameable`. */
  quests_rows: number;
  /** `count(*) FROM quests WHERE has_definition = 1` — `coverage.defined`. */
  has_definition_rows: number;
  /** Raw reference rows the extractor produced (3,003 measured). */
  reference_rows_raw: number;
  /** Rows in `quest_catalog_refs` — distinct referencing objects under the table's UNIQUE (2,796). */
  references: number;
  /**
   * Raw rows the insert did **not** keep: `reference_rows_raw - references`.
   *
   * It is the measured absorption of the real statement, not p6-04's
   * `(quest_name, wad, entry, class, goal_name)` key-space difference — the two disagree because
   * **SQLite's UNIQUE treats a NULL `goal_name` as distinct**, so two references without a goal
   * gate never collide. Measured on this tree: 3,003 raw rows → 2,855 table rows (148 absorbed),
   * while the key space with a NULL read as `''` is 2,796 (207 difference).
   */
  duplicate_references: number;
  /**
   * p6-04's key space, `(quest_name, wad, entry, class, goal_name)` with a NULL `goal_name` read
   * as `''` — {@link summarizeQuestRefs}' `reference_keys`. Reported beside {@link references} so
   * the two readings can never be silently substituted for one another.
   */
  distinct_reference_keys: number;
  /**
   * Distinct `(quest_name, wad, entry)` triples — the **narrower** reading of the
   * `reference_count` column comment ("referencing {wad, entry} pairs"), reported so the two
   * readings can never be confused. `reference_count` itself uses the UNIQUE's tuple.
   */
  distinct_wad_entry_pairs: number;
  /** Rows in `quest_ids` — `coverage.id_space`. */
  ids: number;
  /** `quest_ids` rows carrying a `matched_quest_name`. */
  ids_linked: number;
  /**
   * Links whose id is **not** in the text tier — a direct link only needs a `QuestTitle_*` key,
   * so its id can have no `WizQst<id>_*` rows and therefore no `quest_ids` row (the tier is
   * text-driven, see the module doc-comment). Measured on the D17 clone: 286 direct + 6 inferred
   * links, 175 ids in the tier, so 117 links point outside it.
   */
  linked_ids_without_text: number;
  /**
   * **Losing NAMES** — names that claimed an id another name already owns. They keep their title
   * but their `link_kind`/`title_source` is `none`, because `quest_ids` is keyed by `quest_id` and
   * can record exactly one name per id (see {@link resolveIdOwnership}).
   *
   * The unit is a *name*, not an id: `id_collision_ids` is the other unit, and the two differ
   * whenever one id is claimed by three or more names (D73(e): a measurement quoted without its
   * unit is a misleading one).
   */
  id_collision_names: number;
  /** Distinct ids with more than one claimant — the other unit of the same conflict. */
  id_collision_ids: number;
  /** Losing names whose established link was `direct` — they explain `direct − recorded direct`. */
  links_lost_direct: number;
  /** Losing names whose established link was `inferred` — they explain `inferred − recorded inferred`. */
  links_lost_inferred: number;
  /** Up to five losers, `'<name> (<kind>) lost id <id> to <owner>'`, for the report. */
  id_collision_samples: string[];
}

export const ZERO_QUEST_CATALOG_COUNTS: QuestCatalogCounts = {
  corpus_rows: 0,
  catalog_rows: 0,
  catalog_only_rows: 0,
  merged_rows: 0,
  quests_rows: 0,
  has_definition_rows: 0,
  reference_rows_raw: 0,
  references: 0,
  duplicate_references: 0,
  distinct_reference_keys: 0,
  distinct_wad_entry_pairs: 0,
  ids: 0,
  ids_linked: 0,
  linked_ids_without_text: 0,
  id_collision_names: 0,
  id_collision_ids: 0,
  links_lost_direct: 0,
  links_lost_inferred: 0,
  id_collision_samples: [],
};

export interface QuestCatalogReport {
  status: QuestCatalogStatus;
  reason: string | null;
  message: string | null;
  binary_path: string | null;
  /** NDJSON rows read. */
  rows_read: number;
  extract_ms: number;
  collect_ms: number;
  write_ms: number;
  counts: QuestCatalogCounts;
  /** p6-04's ac1/ac2 numbers, computed from the same pass — `null` when the stage was skipped. */
  quests: QuestRefsReport | null;
  /** The hold-out, computed **at sync time** (p6-04's ac2 wording) — `null` when skipped. */
  holdout: HoldoutReport | null;
}

/** The report a run that never reached the stage (or a caller with nothing collected) sees. */
export function notRunQuestCatalogReport(reason: string, message: string): QuestCatalogReport {
  return {
    status: 'not-run',
    reason,
    message,
    binary_path: null,
    rows_read: 0,
    extract_ms: 0,
    collect_ms: 0,
    write_ms: 0,
    counts: { ...ZERO_QUEST_CATALOG_COUNTS },
    quests: null,
    holdout: null,
  };
}

/**
 * The corpus's `(name, id)` pairs — the interpolation anchors and the hold-out's known set.
 *
 * The id is the numeric form of `m_questTitle` (`QuestTitle_1ED8A` → `0x1ED8A`), the same rule the
 * extractor uses (`parseQuestTitleKey`); a row whose title key is missing or not a safe-integer hex
 * token contributes nothing.
 */
export function corpusQuestIdPairs(rows: readonly QuestCatalogCorpusRow[]): QuestIdPair[] {
  const pairs: QuestIdPair[] = [];
  for (const row of rows) {
    if (row.titleKey === null) {
      continue;
    }
    const questId = parseQuestTitleKey(row.titleKey);
    if (questId === null) {
      continue;
    }
    pairs.push({ quest_name: row.quest_name, quest_id: questId });
  }
  return pairs;
}

/** The id tier read from the freshly written `string_table`. */
interface QuestIdTier {
  /** id → rows in its `WizQst<id>_*` tables (the row set the table holds). */
  textRows: Map<number, number>;
  /** id → its stored `QuestTitle_*` key and value, first spelling wins. */
  titles: Map<number, { key: string; value: string }>;
}

function readQuestIdTier(db: Db): QuestIdTier {
  const textRows = new Map<number, number>();
  const rows = db.prepare("SELECT key FROM string_table WHERE key LIKE 'WizQst%'").all() as Array<{
    key: string;
  }>;
  for (const row of rows) {
    // `parseWizQstKey` is the one home of this spelling (task 6.6 also reads the id off a
    // `WizQst` key); the rule is unchanged — a safe-integer hex id, anything else skipped.
    const questId = parseWizQstKey(row.key);
    if (questId === null) {
      continue;
    }
    textRows.set(questId, (textRows.get(questId) ?? 0) + 1);
  }

  const titles = new Map<number, { key: string; value: string }>();
  const titleRows = db
    .prepare("SELECT key, value FROM string_table WHERE key LIKE 'QuestTitle\\_%' ESCAPE '\\'")
    .all() as Array<{ key: string; value: string }>;
  for (const row of titleRows) {
    const questId = parseQuestTitleKey(row.key);
    if (questId !== null && !titles.has(questId)) {
      titles.set(questId, { key: row.key, value: row.value });
    }
  }

  return { textRows, titles };
}

/** How many collision samples the report carries (the count itself is unbounded). */
export const MAX_ID_COLLISION_SAMPLES = 5;

/** Who owns each claimed id, and who lost one. */
export interface IdOwnership {
  /** `quest_id` → the name that records it in `quest_ids`. */
  linked: Map<number, { name: string; kind: string; basis: string | null }>;
  /** Losing name → the id it claimed, the name that owns it, and the loser's own kind. */
  losers: Map<string, { quest_id: number; owner: string; kind: QuestLinkKind }>;
  /** How many catalog names carried a `quest_id` at all. */
  recordsWithId: number;
  /** **Losing names** (the unit). */
  collisionNames: number;
  /** Distinct ids with more than one claimant (the other unit). */
  collisionIds: number;
  /** Losing names by the kind of link they had established. */
  lostDirect: number;
  lostInferred: number;
  samples: string[];
}

/**
 * Decides which name records each `quest_id`.
 *
 * `quest_ids.quest_id` is the primary key, so **one name per id** is a structural fact, not a
 * preference — and the lead's read of the first build found the consequence of ignoring it:
 * `quests.link_kind = 'inferred'` was 6 while `quest_ids` held 5 inferred rows, because two names
 * interpolated the same candidate id and the id-keyed writer silently kept one. That is a conflict
 * to resolve and count, never to hide.
 *
 * The rule, in order:
 *
 * 1. **stronger evidence wins**: a `direct` claim (a measured `<name>_Complete` + `QuestTitle_*`
 *    pair) beats an `inferred` one (a 78%-accurate interpolation);
 * 2. **then name order**, so the outcome is deterministic and independent of row order;
 * 3. every later claimer is a **loser**: it is counted in `id_collision_names` (losing **names**;
 *    `id_collision_ids` is the distinct-id unit), sampled in `id_collision_samples`, and its
 *    `quests.link_kind`/`title_source` is written as `none`.
 *
 * **Deterministic by construction.** The order is a *total* order — `quest_name` is unique across
 * records (the extractor's catalog names come from a `Set`) — compared byte-wise with `<`, never
 * with a locale collator, and `Array.prototype.sort` is stable (ES2019). Shuffling the input
 * therefore cannot change a winner, and `tests/unit/quest-catalog.test.ts` asserts exactly that.
 */
export function resolveIdOwnership(records: readonly QuestCatalogRecord[]): IdOwnership {
  const claims = records.filter((record) => record.link.quest_id !== null);
  const ordered = claims.slice().sort((a, b) => {
    const rank = (record: QuestCatalogRecord): number => (record.link.kind === 'direct' ? 0 : 1);
    return (
      rank(a) - rank(b) || (a.quest_name < b.quest_name ? -1 : a.quest_name > b.quest_name ? 1 : 0)
    );
  });

  const linked: IdOwnership['linked'] = new Map();
  const losers: IdOwnership['losers'] = new Map();
  const claimants = new Map<number, number>();
  const samples: string[] = [];
  let lostDirect = 0;
  let lostInferred = 0;
  for (const record of ordered) {
    const questId = record.link.quest_id as number;
    claimants.set(questId, (claimants.get(questId) ?? 0) + 1);
    const owner = linked.get(questId);
    if (owner !== undefined) {
      losers.set(record.quest_name, {
        quest_id: questId,
        owner: owner.name,
        kind: record.link.kind,
      });
      if (record.link.kind === 'direct') {
        lostDirect += 1;
      } else if (record.link.kind === 'inferred') {
        lostInferred += 1;
      }
      if (samples.length < MAX_ID_COLLISION_SAMPLES) {
        // The kind is attached to the LOSER, where a reader needs it: this name had a `direct`
        // claim (or an `inferred` one) and could not record it.
        samples.push(
          `${record.quest_name} (${record.link.kind}) lost id ${questId} to ${owner.name}`,
        );
      }
      continue;
    }
    linked.set(questId, {
      name: record.quest_name,
      kind: record.link.kind,
      basis: record.link.basis,
    });
  }

  return {
    linked,
    losers,
    recordsWithId: claims.length,
    collisionNames: losers.size,
    collisionIds: [...claimants.values()].filter((count) => count > 1).length,
    lostDirect,
    lostInferred,
    samples,
  };
}

/**
 * Phase B: merge the catalog into `quests`, replace `quest_catalog_refs` and `quest_ids`, and
 * recompute the four derived columns — all inside the caller's transaction.
 *
 * The caller has already inserted the corpus rows (`has_definition = 1`) and the seven replaced
 * tables, so:
 *
 * 1. both catalog tables are emptied (refs → ids → quests is the FK-safe order, done by the
 *    caller for `quests`),
 * 2. the collector is finished against the **new** string table, with the corpus pairs as
 *    anchors (this is what makes a world-only name inferable),
 * 3. each catalog record is merged into `quests` (`ON CONFLICT` touches only
 *    `link_kind`/`title_source`, never a corpus row's title/level/mainline/`has_definition`),
 * 4. its references are inserted with `ON CONFLICT ... DO NOTHING`, so the 207 raw rows the
 *    UNIQUE absorbs cannot grow the table on a second sync,
 * 5. `reference_count` is recomputed for **every** row from `quest_catalog_refs` (so it is the
 *    table's own count of distinct referencing objects, never the extractor's raw row count),
 * 6. `quest_ids` is written from the string table's id tier, linked to the catalog names.
 */
export function writeQuestCatalog(options: WriteQuestCatalogOptions): QuestCatalogReport {
  const { db, collected } = options;
  const started = Date.now();

  /** One `count(*)`-shaped read. Declared once for both returns below. */
  const scalar = (sql: string): number => (db.prepare(sql).get() as { value: number }).value;

  // Replaced unconditionally: a skipped stage must not leave rows pointing at quests that the
  // transaction is about to delete (the FK has no ON DELETE clause).
  db.prepare('DELETE FROM quest_catalog_refs').run();
  db.prepare('DELETE FROM quest_ids').run();

  if (collected.status !== 'ok' || collected.collector === null) {
    // The two denominators that describe what the transaction *did* write are still measured:
    // a skipped stage leaves every corpus row defined, which is a fact worth reporting.
    return {
      status: 'skipped',
      reason: collected.reason,
      message: collected.message,
      binary_path: collected.binaryPath,
      rows_read: collected.rows,
      extract_ms: collected.extractMs,
      collect_ms: collected.collectMs,
      write_ms: Date.now() - started,
      counts: {
        ...ZERO_QUEST_CATALOG_COUNTS,
        corpus_rows: options.corpusRows.length,
        quests_rows: scalar('SELECT count(*) AS value FROM quests'),
        has_definition_rows: scalar(
          'SELECT count(*) AS value FROM quests WHERE has_definition = 1',
        ),
      },
      quests: null,
      holdout: null,
    };
  }

  const pairs = corpusQuestIdPairs(options.corpusRows);
  const lookups = createQuestIdLookups(db);
  const result = collected.collector.finish(lookups, { anchors: pairs });
  const holdout = computeHoldoutAccuracy(pairs, { corpus: options.corpus, lookups });
  const summary = summarizeQuestRefs(result, { corpus: options.corpus, holdout });

  const insertQuest = db.prepare(
    `INSERT INTO quests
       (quest_name, title, level, is_mainline, has_definition, link_kind, title_source, reference_count, title_key)
     VALUES (?, ?, NULL, NULL, 0, ?, ?, 0, ?)
     ON CONFLICT(quest_name) DO UPDATE SET
       link_kind = excluded.link_kind,
       title_source = excluded.title_source,
       -- A file with no title key of its own keeps the link's key AND its text (D182): the
       -- linked (direct or inferred, labelled by title_source) title, not a fallback to the name.
       -- A file that has its own key is never touched.
       title = CASE WHEN quests.title_key IS NULL AND excluded.title_key IS NOT NULL
                    THEN excluded.title ELSE quests.title END,
       title_key = COALESCE(quests.title_key, excluded.title_key)`,
  );
  const insertReference = db.prepare(
    `INSERT INTO quest_catalog_refs (quest_name, wad, entry, class, goal_name, required_status)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(quest_name, wad, entry, class, goal_name) DO NOTHING`,
  );
  const findQuest = db.prepare('SELECT 1 AS present FROM quests WHERE quest_name = ?');
  const titleValue = db.prepare('SELECT value FROM string_table WHERE key = ?');

  // The id tier is keyed by `quest_id`, so an id can carry **one** name. Ownership is therefore
  // decided before anything is written: a name that loses its id to another name keeps no
  // `link_kind`/`title_source`, because those columns must never claim a link the id tier cannot
  // record (found by the lead: `quests.link_kind = 'inferred'` was 6 while `quest_ids` held 5).
  const tier = readQuestIdTier(db);
  const ownership = resolveIdOwnership(result.records);

  let catalogOnly = 0;
  let merged = 0;
  for (const record of result.records) {
    const lost = ownership.losers.get(record.quest_name);
    const kind = lost === undefined ? record.link.kind : 'none';
    const stored =
      record.link.title_key === null || (kind === 'none' && record.link.kind === 'inferred')
        ? undefined
        : (titleValue.get(record.link.title_key) as { value: string } | undefined);
    // NOT NULL column: a linked record takes its resolved title text, an unlinked one the name
    // itself — the same convention `buildQuestRows` uses for a row whose title key is missing.
    // An inferred loser deliberately falls back to the name too: its title is a *guess*, and
    // showing a guessed title beside `link_kind = 'none'` would display inferred material
    // without its label (the phase's never-unlabelled rule).
    const title = stored?.value ?? record.quest_name;
    // The key is kept only alongside the text it resolved to, so a row never holds a key whose
    // title is not the row's title (an inferred loser stores neither).
    const titleKey = stored === undefined ? null : record.link.title_key;
    const existed = findQuest.get(record.quest_name) !== undefined;
    insertQuest.run(record.quest_name, title, kind, kind, titleKey);
    if (existed) {
      merged += 1;
    } else {
      catalogOnly += 1;
    }
    for (const reference of record.references) {
      insertReference.run(
        record.quest_name,
        reference.wad,
        reference.entry,
        reference.class,
        reference.goal_name,
        reference.required_status,
      );
    }
  }

  // Recompute, for every row, from what was merged: the table's own count per quest.
  db.prepare(
    `UPDATE quests SET reference_count =
       (SELECT count(*) FROM quest_catalog_refs AS refs WHERE refs.quest_name = quests.quest_name)`,
  ).run();

  const linked = ownership.linked;

  const insertId = db.prepare(
    `INSERT INTO quest_ids (quest_id, title_key, title, text_rows, matched_quest_name, link_kind, inference_basis)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  let idsLinked = 0;
  for (const questId of [...tier.textRows.keys()].sort((a, b) => a - b)) {
    const title = tier.titles.get(questId);
    const match = linked.get(questId);
    if (match !== undefined) {
      idsLinked += 1;
    }
    insertId.run(
      questId,
      title?.key ?? null,
      title?.value ?? null,
      tier.textRows.get(questId) ?? 0,
      match?.name ?? null,
      match?.kind ?? 'none',
      match?.basis ?? null,
    );
  }

  const tableReferences = scalar('SELECT count(*) AS value FROM quest_catalog_refs');

  return {
    status: 'ok',
    reason: null,
    message: null,
    binary_path: collected.binaryPath,
    rows_read: collected.rows,
    extract_ms: collected.extractMs,
    collect_ms: collected.collectMs,
    write_ms: Date.now() - started,
    counts: {
      corpus_rows: options.corpusRows.length,
      catalog_rows: result.records.length,
      catalog_only_rows: catalogOnly,
      merged_rows: merged,
      quests_rows: scalar('SELECT count(*) AS value FROM quests'),
      has_definition_rows: scalar('SELECT count(*) AS value FROM quests WHERE has_definition = 1'),
      reference_rows_raw: summary.references,
      references: tableReferences,
      // What the real UNIQUE absorbed (raw − table), not p6-04's key-space difference.
      duplicate_references: summary.references - tableReferences,
      distinct_reference_keys: summary.reference_keys,
      distinct_wad_entry_pairs: scalar(
        'SELECT count(*) AS value FROM (SELECT DISTINCT quest_name, wad, entry FROM quest_catalog_refs)',
      ),
      ids: scalar('SELECT count(*) AS value FROM quest_ids'),
      ids_linked: idsLinked,
      linked_ids_without_text: ownership.recordsWithId - idsLinked - ownership.collisionNames,
      id_collision_names: ownership.collisionNames,
      id_collision_ids: ownership.collisionIds,
      links_lost_direct: ownership.lostDirect,
      links_lost_inferred: ownership.lostInferred,
      id_collision_samples: ownership.samples,
    },
    quests: summary,
    holdout,
  };
}
