import type { StatusValue } from './api';

/**
 * Generic object-list logic — task 4.1 (docs/plan-phase-4-other-object-editors.md §4.1),
 * the generalisation of the quest browse's pure half (`lib/quests.ts`).
 *
 * Everything a list page derives from one `GET /api/<type>` payload lives here as
 * plain functions: the status filter tabs and their count badges, the client-side
 * search, the comparator, the 50-row pagination and the per-filter empty state. No
 * React, no requests — so it is asserted in plain node (decision D10), and so the
 * quest page and the eight object pages share one implementation of each rule
 * (`lib/quests.ts` delegates to this module; the quest page's own exports and
 * behaviour are unchanged).
 *
 * The four filter tabs are the status lifecycle's own names (docs/spec-ui-design.md
 * L245: `All / Extracted / Reviewed / Verified`), and the counts come from the list
 * response's own `summary` — the same decision D49 rule the quests list follows, so
 * a tab counts exactly what the table holds.
 */

/* ------------------------------------------------------------- filter tabs */

export type ObjectFilter = 'All' | 'Extracted' | 'Reviewed' | 'Verified';

/** The four filter tabs, in spec order (docs/spec-ui-design.md L245). */
export const OBJECT_FILTERS: readonly ObjectFilter[] = ['All', 'Extracted', 'Reviewed', 'Verified'];

/** The status a tab selects; `All` selects everything. */
export const OBJECT_FILTER_STATUS: Record<ObjectFilter, StatusValue | null> = {
  All: null,
  Extracted: 'extracted',
  Reviewed: 'reviewed',
  Verified: 'verified',
};

/**
 * The one query-param name a list view's filter is carried in — story p5-03
 * (plan task 5.3; the AC's "filter survives reload via URL param").
 *
 * The tab vocabulary has one home (above), so the **URL spelling of that
 * vocabulary** has the same one home: the hook (`hooks/useStatusFilter.ts`) and
 * both React halves of the pair read and write it through the three helpers below
 * rather than each knowing the string.
 */
export const OBJECT_FILTER_PARAM = 'filter';

/**
 * The filter a list view starts on when the URL says nothing.
 *
 * `All` is the default, and {@link objectFilterParam} renders it as `null` — so a
 * default page's URL stays the bare path (`/quests`, not `/quests?filter=All`).
 * That matters twice over: the pinned route set in `tests/ui/shell.spec.ts` stays
 * exactly the spec's path list plus an optional suffix, and a default written into
 * the URL is history noise rather than state.
 */
export const DEFAULT_OBJECT_FILTER: ObjectFilter = 'All';

/**
 * The filter a query-param value names, defaulting on anything else.
 *
 * Matching is case-insensitive on the way in — a hand-typed `?filter=verified` is
 * a reasonable thing for a person to write, and the tab vocabulary is one word
 * per status — while {@link objectFilterParam} always writes the canonical
 * spelling back, so the URL can only ever hold `All|Extracted|Reviewed|Verified`.
 * An unknown value (or none at all) is the default rather than an error: a URL is
 * not a form, and a stale bookmark should still render a list.
 */
export function parseObjectFilter(value: string | null | undefined): ObjectFilter {
  if (value === null || value === undefined) {
    return DEFAULT_OBJECT_FILTER;
  }
  const match = OBJECT_FILTERS.find((filter) => filter.toLowerCase() === value.toLowerCase());
  return match ?? DEFAULT_OBJECT_FILTER;
}

/**
 * The query-param value for a filter, or `null` when the param should be **absent**.
 *
 * `null` is the default branch: `All` is omitted from the URL rather than spelled
 * out, so `?filter=Extracted` is the only thing a non-default page ever adds.
 */
export function objectFilterParam(filter: ObjectFilter): string | null {
  return filter === DEFAULT_OBJECT_FILTER ? null : filter;
}

/** The `summary` shape `GET /api/<type>` carries (D49). */
export interface ObjectStatusSummary {
  total: number;
  extracted: number;
  reviewed: number;
  verified: number;
}

/** One tab: its label and the count badge it renders. */
export interface ObjectFilterTab<Filter extends string = ObjectFilter> {
  filter: Filter;
  count: number;
}

/** The four tabs and their count badges, from the list's own `summary`. */
export function objectFilterTabs(summary: ObjectStatusSummary): ObjectFilterTab<ObjectFilter>[] {
  return [
    { filter: 'All', count: summary.total },
    { filter: 'Extracted', count: summary.extracted },
    { filter: 'Reviewed', count: summary.reviewed },
    { filter: 'Verified', count: summary.verified },
  ];
}

/**
 * The rows one filter tab selects. `statusOf` resolves a row's status — the quest
 * page passes its own defaulting reader (a row with no row in `entry_status` is
 * `extracted`), an object page can pass the row's own field.
 */
export function filterByStatus<T>(
  rows: readonly T[],
  filter: ObjectFilter,
  statusOf: (row: T) => StatusValue,
): T[] {
  const status = OBJECT_FILTER_STATUS[filter];
  return status === null ? [...rows] : rows.filter((row) => statusOf(row) === status);
}

/* ------------------------------------------------------------------ search */

/**
 * The **client-side** search: a case-insensitive substring over the fields a row
 * actually renders, so typing never issues a request (plan §2.7, D12).
 */
export function searchRows<T>(
  rows: readonly T[],
  query: string,
  fields: (row: T) => readonly (string | null | undefined)[],
): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [...rows];
  }
  return rows.filter((row) =>
    fields(row).some((field) => (field ?? '').toLowerCase().includes(needle)),
  );
}

/* ----------------------------------------------------------------- sorting */

/** `null` sorts last in both directions (an absent value is not "small"). */
export function compareNullable(a: number | string | null, b: number | string | null): number {
  if (a === null && b === null) {
    return 0;
  }
  if (a === null) {
    return 1;
  }
  if (b === null) {
    return -1;
  }
  return typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a) < String(b)
      ? -1
      : String(a) > String(b)
        ? 1
        : 0;
}

/** The three sortable columns every object list has: the key, the status, the mtime. */
export type ObjectSortKey = 'key' | 'status' | 'modified_at';

export type ObjectSortDirection = 'asc' | 'desc';

export interface ObjectSort {
  key: ObjectSortKey;
  direction: ObjectSortDirection;
}

/** A fresh page starts sorted by key ascending. */
export const DEFAULT_OBJECT_SORT: ObjectSort = { key: 'key', direction: 'asc' };

export function isObjectSortKey(value: string): value is ObjectSortKey {
  return value === 'key' || value === 'status' || value === 'modified_at';
}

/**
 * Sorts a copy of `rows` (never mutates), tie-broken by the key ascending so equal
 * values keep a stable, deterministic order across renders and pagination.
 */
export function sortRows<T>(
  rows: readonly T[],
  sort: ObjectSort,
  value: (row: T, key: ObjectSortKey) => string | number | null,
  tieBreak: (row: T) => string,
): T[] {
  const direction = sort.direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const primary = compareNullable(value(a, sort.key), value(b, sort.key)) * direction;
    if (primary !== 0) {
      return primary;
    }
    const aKey = tieBreak(a);
    const bKey = tieBreak(b);
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
}

/* -------------------------------------------------------------- pagination */

/** Rows per page — the spec's "Showing 1-50 of 322" (L266). */
export const OBJECTS_PAGE_SIZE = 50;

/** One page of rows plus everything the pagination bar renders. */
export interface ObjectPage<T> {
  items: T[];
  page: number;
  pageCount: number;
  first: number;
  last: number;
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

/**
 * Slices one page and clamps `page` into range, so a filter that shrinks the list
 * (or a stale page number) can never show an empty page of a non-empty list.
 */
export function paginateRows<T>(
  rows: readonly T[],
  page: number,
  pageSize: number = OBJECTS_PAGE_SIZE,
): ObjectPage<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const clamped = Math.min(Math.max(Math.trunc(page) || 1, 1), pageCount);
  const start = (clamped - 1) * pageSize;
  const items = rows.slice(start, start + pageSize);
  return {
    items,
    page: clamped,
    pageCount,
    first: items.length === 0 ? 0 : start + 1,
    last: start + items.length,
    total,
    hasPrevious: clamped > 1,
    hasNext: clamped < pageCount,
  };
}

/** The pagination string, exactly the spec's shape (L266): `Showing 1-50 of 322`. */
export function paginationLabel(
  page: Pick<ObjectPage<unknown>, 'first' | 'last' | 'total'>,
): string {
  return `Showing ${page.first}-${page.last} of ${page.total}`;
}

/* ------------------------------------------------------------- empty states */

/**
 * The per-filter empty state, from the spec's template (L268): `No {status} {noun}
 * found.` The `All` tab — the one tab with no status — reads `No {noun} found.`
 * rather than the ungrammatical `No All …`.
 */
export function objectEmptyStateMessage(filter: ObjectFilter, nounPlural: string): string {
  return filter === 'All' ? `No ${nounPlural} found.` : `No ${filter} ${nounPlural} found.`;
}

/** The suggestion the generic empty state pairs with the message (spec L268's "change filter"). */
export const OBJECT_EMPTY_STATE_HINT = 'Try a different filter or search.';

/* --------------------------------------------------------- page-level copy */

/** The filter tab bar's accessible name, per type. */
export function objectFilterLabel(nounPlural: string): string {
  return `Filter ${nounPlural} by status`;
}

/** The search field's placeholder, per type (`Search NPC inventories...`). */
export function objectSearchPlaceholder(nounPlural: string): string {
  return `Search ${nounPlural}...`;
}

/** The search field's accessible name (the placeholder is not one). */
export function objectSearchLabel(nounPlural: string): string {
  return `Search ${nounPlural}`;
}

/** The list's failure line. */
export function objectLoadError(nounPlural: string): string {
  return `Could not load ${nounPlural}.`;
}

/** The list's loading announcement. */
export function objectLoadingLabel(nounPlural: string): string {
  return `Loading ${nounPlural}…`;
}

/**
 * The **singular** of a family's plural noun (`'NPC inventories'` → `'NPC inventory'`,
 * `'zone transfers'` → `'zone transfer'`), for the sentences that name one entry.
 *
 * The plural forms are hand-written per route (`App.tsx`) and the only regular one is the
 * trailing `s`, but two of the seven are `…ies` plurals, so the naive `replace(/s$/, '')` this
 * story found in `ObjectDetailPage` produced "NPC inventor". Two rules, both from the strings
 * that actually exist here; a noun with no plural suffix (`'global registry'`) is returned
 * unchanged. Deliberately not a general English pluraliser — an irregular noun would be a
 * wrong word, so a future family must be checked rather than trusted.
 */
export function objectSingularNoun(nounPlural: string): string {
  if (nounPlural.endsWith('ies')) {
    return `${nounPlural.slice(0, -3)}y`;
  }
  return nounPlural.endsWith('s') ? nounPlural.slice(0, -1) : nounPlural;
}
