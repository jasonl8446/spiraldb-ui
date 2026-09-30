import fs from 'node:fs';
import path from 'node:path';

import {
  CATALOG_Q_MAX_LENGTH,
  CATALOG_Q_PARAM,
  MISSING_ONLY_PARAM,
} from '../../../shared/quest/catalog.js';
import { readSettings, type Db } from '../db.js';
import { escapeLike } from './names.js';
import { collectionSpec } from './spiraldbFiles.js';

/**
 * Quest coverage + the catalog worklist — task 6.10 / story **p6-11**
 * ([plan-phase-6-quest-catalog.md](../../../docs/plan-phase-6-quest-catalog.md) L374-383,
 * [spec-api.md](../../../docs/spec-api.md) L442-464, [spec-ui-design.md](../../../docs/spec-ui-design.md) L639-679).
 *
 * Two reads, both over tables the **sync** owns (the API never counts the corpus itself):
 *
 * | function | reads | serves |
 * |---|---|---|
 * | {@link readCoverage} | the `coverage` **view** + `settings.spiraldb_path` | `GET /api/quests/coverage` |
 * | {@link listQuestCatalog} | `quests` (name, title, link, `has_definition`, `reference_count`) | `GET /api/quests/catalog` |
 *
 * ## Why the coverage view, and never a count of our own
 *
 * The spec's rule is one definition of "how much of the catalog is built", so the Quests-page
 * header and the Catalog view read **the same** numbers instead of each recomputing one
 * (spec-data-model.md L186-203). `readCoverage` therefore issues exactly one
 * `SELECT … FROM coverage` — it never derives `defined` from the file index or `missing` from
 * `nameable - defined`, both of which would be a second definition.
 *
 * ## Why the corpus is named
 *
 * `defined` reads **322** against the D17 clone and **328** against the owner's fork
 * (D80(c) keeps the clone frozen), so a number quoted without its corpus is not a
 * measurement. The response carries `corpus` — the resolved `settings.spiraldb_path` and the
 * `QuestTemplates/*.json` count it just measured — and the UI renders both beside the numbers.
 * The count is a directory listing, not a parse: the browse list already parses all 322 files
 * per request (D12), so this is the cheap half.
 *
 * ## `references` is quoted
 *
 * `references` is a SQLite keyword, so the view declares it as `"references"`
 * (the p6-05 note in spec-data-model.md L194-198). The `SELECT` here quotes it for the same
 * reason; every column name stays byte-identical to the view's contract.
 */

/** The `coverage` view's five axes, exactly its column names. */
export interface CoverageRow {
  /** `count(*) FROM quests` — the catalog tier (≥ 1,447 world-named; 1,717 measured). */
  nameable: number;
  /** `count(*) FROM quest_ids` — the id tier the client holds text for (~4,830). */
  id_space: number;
  /** `count(*) FROM quests WHERE has_definition = 1` — rows with a corpus file. */
  defined: number;
  /** `count(*) FROM quests WHERE has_definition = 0` — the worklist. */
  missing: number;
  /** `count(*) FROM quest_catalog_refs` — world objects that reference a catalog quest. */
  references: number;
}

/** Which corpus the numbers were measured against — never omitted, never assumed. */
export interface CoverageCorpus {
  /** The resolved `settings.spiraldb_path` (`''` when the setting is unset). */
  spiraldb_path: string;
  /** `QuestTemplates/*.json` under that root, counted now; `0` when the root is unusable. */
  quest_files: number;
}

/** `GET /api/quests/coverage`'s body (spec-api.md L446-456). */
export interface CoverageResult extends CoverageRow {
  corpus: CoverageCorpus;
}

/** One catalog worklist row (spec-ui-design.md L660-666's columns). */
export interface QuestCatalogRow {
  quest_name: string;
  /** The catalog title, or the name itself when the world linked none. */
  title: string;
  /** The catalog link's provenance: `direct` | `inferred` | `none` (P6-11). */
  title_source: 'direct' | 'inferred' | 'none';
  /** `1` when a corpus file exists — the worklist's "defined" cell. */
  has_definition: 0 | 1;
  /** `quests.reference_count` — how many world objects gate this quest. */
  reference_count: number;
}

/** `GET /api/quests/catalog`'s body. */
export interface QuestCatalogResult {
  quests: QuestCatalogRow[];
  /**
   * The number of rows the **filter** returned. `missing_only` is echoed so a client can
   * label what it is looking at without remembering what it asked for.
   */
  total: number;
  missing_only: boolean;
  /** The search the rows were narrowed by (`''` when none), echoed like `missing_only`. */
  q: string;
  corpus: CoverageCorpus;
}

/**
 * One row of the `coverage` view, verbatim. Exported because the tier-1/unit assertions read
 * the same view through raw SQL and compare — a test that called this function and compared it
 * with itself would prove nothing (D90(c)).
 */
export const COVERAGE_VIEW_SELECT =
  'SELECT nameable, id_space, defined, missing, "references" FROM coverage';

/** `settings.spiraldb_path`, trimmed; `''` when the row is missing or blank. */
function spiraldbRoot(db: Db): string {
  return (readSettings(db).spiraldb_path ?? '').trim();
}

/**
 * `QuestTemplates/*.json` under one root. A missing/unreadable directory answers `0` rather
 * than throwing: the coverage header must still render on a machine whose clone is absent
 * (CI has no corpus, D23 tier 1), and "0 quest files" is the honest statement then.
 */
export function countQuestFiles(spiraldbPath: string): number {
  if (spiraldbPath === '') {
    return 0;
  }
  try {
    return fs
      .readdirSync(path.join(spiraldbPath, collectionSpec('questtemplates').directory))
      .filter((name) => name.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

/** The corpus block both endpoints carry. */
export function readCorpus(db: Db): CoverageCorpus {
  const spiraldb_path = spiraldbRoot(db);
  return { spiraldb_path, quest_files: countQuestFiles(spiraldb_path) };
}

/**
 * The five axes as the view computes them — the **only** place they are read, so the header
 * cannot drift from the definition (spec-data-model.md L186-203).
 */
export function readCoverage(db: Db): CoverageResult {
  const row = db.prepare(COVERAGE_VIEW_SELECT).get() as CoverageRow;
  return { ...row, corpus: readCorpus(db) };
}

/** `listQuestCatalog`'s options; `missing_only` is the spec's filter. */
export interface ListQuestCatalogOptions {
  /** `true` narrows the query to `has_definition = 0` (spec-ui-design.md L667). */
  missingOnly?: boolean;
  /** Case-insensitive literal substring over `quest_name` or `title` (D186); `''`/absent = none. */
  q?: string;
}

/**
 * The catalog worklist — one row per `quests` row, the filter applied **in SQL**.
 *
 * The predicate is `has_definition = 0`, the column the sync owns; the client never derives
 * "missing" from the coverage numbers (that would be a second definition of the same word, and
 * it would silently disagree the moment a page is partial). Ordering is deterministic —
 * missing-first-by-reference-count is the shape the spec's ASCII draws, so the rows arrive in
 * the order the worklist wants: most-gated first, then the name, so a re-read cannot reorder.
 */
export function listQuestCatalog(
  db: Db,
  options: ListQuestCatalogOptions = {},
): QuestCatalogResult {
  const missingOnly = options.missingOnly === true;
  const q = options.q ?? '';
  const conditions: string[] = [];
  const params: string[] = [];
  if (missingOnly) {
    conditions.push('has_definition = 0');
  }
  if (q !== '') {
    // Either half of the pair, as a literal substring — the same LIKE rule the names API uses.
    const pattern = `%${escapeLike(q.toLowerCase())}%`;
    conditions.push("(lower(quest_name) LIKE ? ESCAPE '\\' OR lower(title) LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT quest_name, title, title_source, has_definition, reference_count
         FROM quests
         ${where}
        ORDER BY reference_count DESC, quest_name ASC`,
    )
    .all(...params) as QuestCatalogRow[];

  return {
    quests: rows.map((row) => ({ ...row, has_definition: row.has_definition === 1 ? 1 : 0 })),
    total: rows.length,
    missing_only: missingOnly,
    q,
    corpus: readCorpus(db),
  };
}

/* ----------------------------------------------------------- query parsing */

/**
 * The one query parameter the catalog read accepts (spec-ui-design.md L667) — re-exported from
 * `shared/quest/catalog.ts`, which is its single home: the client's query builder imports the
 * same constant, so the two halves cannot spell the wire differently.
 */
export { CATALOG_Q_PARAM, MISSING_ONLY_PARAM };

/** A `400`-worthy query value, carrying the message the route returns verbatim. */
export class QuestCatalogQueryError extends Error {}

/**
 * `?missing_only=` → `boolean`. Absent (or `''`) means "no filter"; `1`/`true` and `0`/`false`
 * are accepted; **anything else is a `400`**, following the house rule that a malformed query
 * parameter is refused rather than silently clamped (spec-api.md L976-979's `?limit=` ladder).
 */
export function parseMissingOnly(value: unknown): boolean {
  if (value === undefined || value === '') {
    return false;
  }
  if (value === '1' || value === 'true') {
    return true;
  }
  if (value === '0' || value === 'false') {
    return false;
  }
  throw new QuestCatalogQueryError(
    `Invalid ${MISSING_ONLY_PARAM} "${String(value)}": expected 1/0 (or true/false).`,
  );
}

/**
 * `?q=` → the trimmed search text. Absent, `''` or whitespace-only means "no search"; a repeated
 * parameter (an array) or one over {@link CATALOG_Q_MAX_LENGTH} characters is a `400`, never a
 * silent truncation (D186).
 */
export function parseCatalogQ(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  if (typeof value !== 'string') {
    return rejectQ(`Query parameter "${CATALOG_Q_PARAM}" must be a single string value`);
  }
  const q = value.trim();
  if (q.length > CATALOG_Q_MAX_LENGTH) {
    return rejectQ(`Invalid ${CATALOG_Q_PARAM}: at most ${CATALOG_Q_MAX_LENGTH} characters`);
  }
  return q;
}

function rejectQ(message: string): never {
  throw new QuestCatalogQueryError(message);
}
