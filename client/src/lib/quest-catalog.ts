import { MISSING_ONLY_PARAM, QUEST_CATALOG_PATH, QUEST_COVERAGE_PATH } from '@shared/quest/catalog';

import type { EvidenceTitleSource } from './api';
import { RAIL_TAB_EVIDENCE, RAIL_TAB_QUERY_PARAM } from './quests';

/**
 * The quest catalog's pure half — task 6.10 / story **p6-11**
 * ([spec-ui-design.md](../../../docs/spec-ui-design.md) L639-679, [spec-api.md](../../../docs/spec-api.md) L442-464).
 *
 * Three things, each in one home so the Quests-page header and the Catalog view cannot disagree:
 *
 * 1. **The header sentence** — {@link coverageHeadline}. It is built from the numbers the
 *    `coverage` view returned, never from a constant: the plan's literal 1,447 is the
 *    **world-named tier**, a different quantity from the view's `nameable` (1,717 measured), and
 *    printing it would be both a second definition and a stale number (P6-15/D110). The corpus
 *    is named in the same sentence, because `defined` reads 322 against the D17 clone and 328
 *    against the owner's fork and neither number may be quoted for the other (D80(c)).
 * 2. **The missing-only query** — {@link catalogQuery} / {@link catalogRequestPath}. The filter is
 *    a predicate over the catalog (`has_definition = 0`, applied in SQL); the query builder is the
 *    pure part a unit test can pin, and the numbers themselves are never re-derived on the client
 *    (that would be a second definition of "missing").
 * 3. **The row's action** — {@link catalogRowAction}: a defined row links straight to the evidence
 *    panel `?panel=evidence` (the p6-08 entry point, built from p6-10's own constants), a missing
 *    row carries the scaffold action. Nothing else is offered, so a row cannot look actionable and
 *    do nothing.
 *
 * **The numbers are text (D85, WCAG 1.4.1).** Every count below is a string this module returns,
 * and the component renders it as text: colour and icons decorate a meaning that is already in
 * words ("✓ defined" / "✗ missing", the header sentence, the percentage).
 */

/* --------------------------------------------------------------- wire types */

/** Which corpus the numbers were measured against — the API's `corpus` object. */
export interface CoverageCorpus {
  spiraldb_path: string;
  quest_files: number;
}

/** `GET /api/quests/coverage`'s body — the `coverage` view's five axes plus the corpus. */
export interface QuestCoverage {
  nameable: number;
  id_space: number;
  defined: number;
  missing: number;
  references: number;
  corpus: CoverageCorpus;
}

/** One catalog worklist row. */
export interface QuestCatalogRow {
  quest_name: string;
  title: string;
  /** The catalog link's provenance (`direct` | `inferred` | `none`) — `quests.title_source`. */
  title_source: EvidenceTitleSource;
  /** `1` when a corpus file exists. */
  has_definition: 0 | 1;
  reference_count: number;
}

/** `GET /api/quests/catalog`'s body. */
export interface QuestCatalogResult {
  quests: QuestCatalogRow[];
  total: number;
  missing_only: boolean;
  corpus: CoverageCorpus;
}

/** The two paths, re-exported so a caller never spells one itself. */
export const CATALOG_PATH = QUEST_CATALOG_PATH;
export const COVERAGE_PATH = QUEST_COVERAGE_PATH;

/* -------------------------------------------------------------- the header */

/** The column/label words the spec's ASCII uses, as constants. */
export const CATALOG_NAME_HEADER = 'Name';
export const CATALOG_TITLE_HEADER = 'Title';
export const CATALOG_DEFINED_HEADER = 'Defined';
export const CATALOG_REFS_HEADER = 'Refs';

/** The defined cell's text — the D85 half: the state is a word, and the glyph only decorates it. */
export const CATALOG_DEFINED_TEXT = 'defined';
export const CATALOG_MISSING_TEXT = 'missing';

/** The row's action labels (the spec's `[Evidence]` / `[Scaffold]`). */
export const CATALOG_EVIDENCE_ACTION = 'Evidence';
export const CATALOG_SCAFFOLD_ACTION = 'Scaffold';
/**
 * The scaffold button's text while its write is in flight. The idle label never renames — a button
 * that says "Create quest" while writing would be a second name for the action the spec calls
 * `[Scaffold]` in its own ASCII.
 */
export const CATALOG_SCAFFOLDING_LABEL = 'Creating…';

/** The filter's own label — `missing only`, the spec's checkbox text. */
export const CATALOG_MISSING_ONLY_LABEL = 'missing only';

/** The states, in words so a page is never a bare zero or a bare spinner. */
export const CATALOG_LOADING = 'Loading the quest catalog…';
export const CATALOG_LOAD_ERROR = 'Could not load the quest catalog.';
export const CATALOG_EMPTY =
  'The quest catalog is empty — it needs a sync to be built from the game files.';
export const CATALOG_EMPTY_ACTION = 'Open Settings and sync';
export const CATALOG_NO_MISSING = 'Every catalog quest has a definition. Nothing is missing.';

/** The label on the corpus clause of the header — the words a reader needs to know what was measured. */
export const CATALOG_CORPUS_PREFIX = 'corpus';
export const CATALOG_CORPUS_UNKNOWN = 'not configured';

/** The `Title` cell's fallback when the world linked no title (the name stands alone). */
export const CATALOG_NO_TITLE = '—';
/** The inferred-title badge's text (D106: the label travels with the guess). */
export const CATALOG_INFERRED_BADGE = 'inferred';

/**
 * Thousands separators, computed here rather than through `toLocaleString`, so the rendered
 * bytes are identical in every runtime (a locale-dependent separator would make the header's own
 * text untestable and could differ between the server-rendered first paint and the browser).
 */
export function groupDigits(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  const negative = value < 0;
  const digits = String(Math.trunc(Math.abs(value)));
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return negative ? `-${grouped}` : grouped;
}

/**
 * The coverage header sentence, in the spec's own words:
 * *"n defined of 1,447 nameable of ~4,830 quests the client holds text for"* — with every number
 * taken from the view and the corpus named beside them (ac1's three clauses).
 *
 * The `~` before `id_space` is the spec's own approximation marker: the id tier is a count of
 * `QuestTitle_*` keyed ids whose *number* is exact but whose meaning is "the client holds text
 * for these", not "these are quests". `defined` and `nameable` are exact counts and carry no mark.
 */
export function coverageHeadline(
  coverage: Pick<QuestCoverage, 'defined' | 'nameable' | 'id_space' | 'corpus'>,
): string {
  const path = coverage.corpus.spiraldb_path.trim();
  const corpus = path === '' ? CATALOG_CORPUS_UNKNOWN : path;
  return (
    `${groupDigits(coverage.defined)} ${CATALOG_DEFINED_TEXT}` +
    ` of ${groupDigits(coverage.nameable)} nameable` +
    ` of ~${groupDigits(coverage.id_space)} quests the client holds text for` +
    ` — ${CATALOG_CORPUS_PREFIX}: ${corpus} (${groupDigits(coverage.corpus.quest_files)} quest files)`
  );
}

/**
 * `defined / nameable`, or `null` when a fraction would be a claim the data does not support
 * (a non-finite or non-positive denominator).
 *
 * The **one** place that decides whether a coverage fraction is meaningful: the header's label and
 * its bar both read this, so the `nameable > 0` guard cannot exist twice and drift (the bar used to
 * re-derive it while the label went through its own copy).
 */
export function coverageRatio(defined: number, nameable: number): number | null {
  if (!Number.isFinite(defined) || !Number.isFinite(nameable) || nameable <= 0) {
    return null;
  }
  return defined / nameable;
}

/**
 * The header's progress label: `defined / nameable` as a one-decimal percentage, or an em dash
 * when {@link coverageRatio} says there is no ratio to show (a percentage of nothing is not a
 * number). Text, like the counts.
 */
export function coveragePercentLabel(defined: number, nameable: number): string {
  const ratio = coverageRatio(defined, nameable);
  return ratio === null ? '—' : `${(ratio * 100).toFixed(1)}%`;
}

/* ------------------------------------------------------------ the filter (ac2) */

/** The filter's state, as one value a caller can pass around. */
export interface CatalogFilter {
  missingOnly: boolean;
}

/**
 * The query string the missing-only filter builds — `''` (no filter, no parameter at all) or
 * `?missing_only=1`. The parameter's name comes from `shared/quest/catalog.ts`, the one home the
 * server's `parseMissingOnly` also reads, so the two halves cannot spell the wire differently.
 */
export function catalogQuery(filter: CatalogFilter): string {
  return filter.missingOnly ? `?${MISSING_ONLY_PARAM}=1` : '';
}

/** `GET /api/quests/catalog` with the filter applied — what the read requests. */
export function catalogRequestPath(filter: CatalogFilter): string {
  return `${CATALOG_PATH}${catalogQuery(filter)}`;
}

/* --------------------------------------------------------------- the rows */

/** A row's action: a link into the evidence panel, or the scaffold action. */
export type CatalogRowAction =
  { kind: 'evidence'; label: string; to: string } | { kind: 'scaffold'; label: string };

/**
 * The quest detail path with the evidence panel open — built from the constants p6-10 owns
 * (`?panel=evidence`), so a rename of the tab or the parameter cannot leave a dead link behind.
 */
export function questEvidencePath(questName: string): string {
  return `/quests/${encodeURIComponent(questName)}?${RAIL_TAB_QUERY_PARAM}=${RAIL_TAB_EVIDENCE}`;
}

/**
 * What a row offers. A quest that has a file is read (the evidence panel beside the editor); one
 * that does not is scaffolded (p6-09's action, which the page performs and then navigates from).
 * There is no third state: `has_definition` is `0 | 1` by the schema.
 */
export function catalogRowAction(
  row: Pick<QuestCatalogRow, 'quest_name' | 'has_definition'>,
): CatalogRowAction {
  if (row.has_definition === 1) {
    return {
      kind: 'evidence',
      label: CATALOG_EVIDENCE_ACTION,
      to: questEvidencePath(row.quest_name),
    };
  }
  return { kind: 'scaffold', label: CATALOG_SCAFFOLD_ACTION };
}

/** The `Defined` cell's word for a row — `defined` / `missing`, never a bare glyph. */
export function definedCellText(row: Pick<QuestCatalogRow, 'has_definition'>): string {
  return row.has_definition === 1 ? CATALOG_DEFINED_TEXT : CATALOG_MISSING_TEXT;
}

/**
 * The `Title` cell: the **linked** title, or the em-dash fallback when the world linked none.
 *
 * The identity case is collapsed for the same reason `display.ts` collapses it: the sync writes
 * `title = record.quest_name` when a quest has no direct title, so an unlinked row's `title` *is*
 * its name — printing both columns the same string, and leaving `CATALOG_NO_TITLE` unreachable,
 * which is the one state it exists for. The cell is a column of the table (the spec's ASCII shows
 * Name and Title separately), so "no linked title" has to be sayable.
 */
export function catalogTitleText(row: Pick<QuestCatalogRow, 'title' | 'quest_name'>): string {
  const title = row.title.trim();
  return title === '' || title === row.quest_name ? CATALOG_NO_TITLE : title;
}

/** `true` when the row's title is an interpolated one and must carry the labelled badge (D106). */
export function catalogTitleIsInferred(row: Pick<QuestCatalogRow, 'title_source'>): boolean {
  return row.title_source === 'inferred';
}
