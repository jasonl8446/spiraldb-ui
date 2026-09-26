/**
 * Quest browse + detail — the pure half (plan task 2.7, story p2-08;
 * docs/spec-ui-design.md L238-340).
 *
 * Everything the two pages derive from `GET /api/quests` lives here in plain
 * functions: the filter tabs and their count badges, the client-side search, the
 * six sortable columns' comparators, the 50-row pagination and the per-filter
 * empty-state copy. The React halves (`pages/QuestsPage.tsx`,
 * `pages/QuestDetailPage.tsx`) only move state and pixels, so this module and the
 * exact column spec below are asserted in plain node with no jsdom (decision D10).
 *
 * The column table at {@link QUEST_COLUMNS} is the spec's own table (L254-262) —
 * width, sortability and header text — kept as data rather than as JSX so the
 * widths cannot drift between the desktop table and the tests that pin them.
 */

import { ApiError, type QuestListRow, type StatusValue } from './api';

/* -------------------------------------------------------------- the columns */

/** The seven column ids of the browse table, in spec order (L254-262). */
export const QUEST_COLUMN_IDS = [
  'status',
  'quest_name',
  'level',
  'goal_count',
  'is_mainline',
  'modified_at',
  'actions',
] as const;

export type QuestColumnId = (typeof QUEST_COLUMN_IDS)[number];

/** One column of `docs/spec-ui-design.md` L254-262. */
export interface QuestColumnSpec {
  id: QuestColumnId;
  /** Header text, exactly as the spec writes it. */
  header: string;
  /** Fixed width in px; `null` for the `flex` Quest Name column. */
  widthPx: number | null;
  sortable: boolean;
}

/**
 * The browse table's exact column spec (`docs/spec-ui-design.md` L254-262): Status
 * 40px sortable / Quest Name flex sortable (monospace, truncated with tooltip) /
 * Level 60px badge / Goals 60px count / Mainline 40px check / Modified 120px
 * relative time / Actions 80px **not** sortable.
 */
export const QUEST_COLUMNS: readonly QuestColumnSpec[] = [
  { id: 'status', header: 'Status', widthPx: 40, sortable: true },
  { id: 'quest_name', header: 'Quest Name', widthPx: null, sortable: true },
  { id: 'level', header: 'Level', widthPx: 60, sortable: true },
  { id: 'goal_count', header: 'Goals', widthPx: 60, sortable: true },
  { id: 'is_mainline', header: 'Mainline', widthPx: 40, sortable: true },
  { id: 'modified_at', header: 'Modified', widthPx: 120, sortable: true },
  { id: 'actions', header: 'Actions', widthPx: 80, sortable: false },
];

/* ------------------------------------------------------------- filter tabs */

/** The four filter tabs, in spec order (L245). */
export const QUEST_FILTERS = ['All', 'Extracted', 'Reviewed', 'Verified'] as const;

export type QuestFilter = (typeof QUEST_FILTERS)[number];

/** The status a tab selects; `All` selects everything. */
export const QUEST_FILTER_STATUS: Record<QuestFilter, StatusValue | null> = {
  All: null,
  Extracted: 'extracted',
  Reviewed: 'reviewed',
  Verified: 'verified',
};

/** The `summary` shape `GET /api/quests` carries (D49). */
export interface QuestSummary {
  total: number;
  extracted: number;
  reviewed: number;
  verified: number;
}

/** One tab: its label and the count badge it renders. */
export interface QuestFilterTab {
  filter: QuestFilter;
  count: number;
}

/**
 * The four tabs and their count badges, from the list's own `summary` — so a tab
 * counts exactly what the table holds (D49: the summary counts the rows of this
 * response, not the status table's own totals).
 */
export function questFilterTabs(summary: QuestSummary): QuestFilterTab[] {
  return [
    { filter: 'All', count: summary.total },
    { filter: 'Extracted', count: summary.extracted },
    { filter: 'Reviewed', count: summary.reviewed },
    { filter: 'Verified', count: summary.verified },
  ];
}

/** The rows one filter tab selects. */
export function filterQuests(rows: readonly QuestListRow[], filter: QuestFilter): QuestListRow[] {
  const status = QUEST_FILTER_STATUS[filter];
  return status === null ? [...rows] : rows.filter((row) => questStatus(row) === status);
}

/* ------------------------------------------------------------------ search */

/** The search input's placeholder, verbatim from `docs/spec-ui-design.md` L248. */
export const QUESTS_SEARCH_PLACEHOLDER = 'Search quests...';

/** The accessible name of the search field (the placeholder is not one). */
export const QUESTS_SEARCH_LABEL = 'Search quests';

/**
 * The **client-side** search (plan §2.7: no extra requests, D12).
 *
 * Case-insensitive substring over the three text fields a row actually has — the
 * monospace quest name the column shows, the resolved title, and the raw string
 * key — so searching for a title the user read on the detail page finds the row.
 */
export function searchQuests(rows: readonly QuestListRow[], query: string): QuestListRow[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [...rows];
  }
  return rows.filter((row) =>
    [row.quest_name, row.title, row.title_key ?? ''].some((field) =>
      field.toLowerCase().includes(needle),
    ),
  );
}

/* ----------------------------------------------------------------- sorting */

/** The six sortable keys, in column order (the Actions column has none). */
export const QUEST_SORT_KEYS = [
  'status',
  'quest_name',
  'level',
  'goal_count',
  'is_mainline',
  'modified_at',
] as const;

export type QuestSortKey = (typeof QUEST_SORT_KEYS)[number];

export type QuestSortDirection = 'asc' | 'desc';

export interface QuestSort {
  key: QuestSortKey;
  direction: QuestSortDirection;
}

/** A fresh page starts sorted by quest name ascending. */
export const DEFAULT_QUEST_SORT: QuestSort = { key: 'quest_name', direction: 'asc' };

/** `null` sorts last in both directions (an absent level or mtime is not "small"). */
function compareNullable(a: number | string | null, b: number | string | null): number {
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

/** One row's value for a sort key. */
function sortValue(row: QuestListRow, key: QuestSortKey): string | number | null {
  switch (key) {
    case 'status':
      // The lifecycle order is alphabetical too (extracted → reviewed → verified).
      return row.status;
    case 'quest_name':
      return row.quest_name;
    case 'level':
      return row.level;
    case 'goal_count':
      return row.goal_count;
    case 'is_mainline':
      // Mainline first when ascending: `true` must sort before `false`.
      return row.is_mainline ? 0 : 1;
    case 'modified_at':
      return row.modified_at;
  }
}

/**
 * Sorts a copy of `rows` (never mutates), tie-broken by quest name ascending so
 * equal keys keep a stable, deterministic order across renders and pagination.
 */
export function sortQuests(rows: readonly QuestListRow[], sort: QuestSort): QuestListRow[] {
  const direction = sort.direction === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const primary = compareNullable(sortValue(a, sort.key), sortValue(b, sort.key)) * direction;
    if (primary !== 0) {
      return primary;
    }
    return a.quest_name < b.quest_name ? -1 : a.quest_name > b.quest_name ? 1 : 0;
  });
}

/** Filter → search → sort: the complete client-side derivation of one page's rows. */
export interface QuestDerivation {
  filter: QuestFilter;
  query: string;
  sort: QuestSort;
}

/** The full filtered/searched/sorted row set, before pagination. */
export function deriveQuests(
  rows: readonly QuestListRow[],
  { filter, query, sort }: QuestDerivation,
): QuestListRow[] {
  return sortQuests(searchQuests(filterQuests(rows, filter), query), sort);
}

/* -------------------------------------------------------------- pagination */

/** Rows per page — the spec's "Showing 1-50 of 322" (L266). */
export const QUESTS_PAGE_SIZE = 50;

/** One page of rows plus everything the pagination bar renders. */
export interface QuestPage {
  /** The rows of this page. */
  items: QuestListRow[];
  /** The clamped, 1-based page number this slice came from. */
  page: number;
  /** Total pages; at least 1, so an empty list is "page 1 of 1". */
  pageCount: number;
  /** 1-based index of the first row on this page; 0 when the list is empty. */
  first: number;
  /** 1-based index of the last row on this page; 0 when the list is empty. */
  last: number;
  /** Rows before pagination. */
  total: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

/**
 * Slices one page and clamps `page` into range, so a filter that shrinks the list
 * (or a stale page number) can never show an empty page of a non-empty list.
 */
export function paginateQuests(
  rows: readonly QuestListRow[],
  page: number,
  pageSize: number = QUESTS_PAGE_SIZE,
): QuestPage {
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

/**
 * The pagination string, exactly the spec's shape (L266): `Showing 1-50 of 322`.
 *
 * An empty list reads `Showing 0-0 of 0` — one shape for every empty case
 * (filter, search and the empty corpus) instead of a second sentence the spec does
 * not have.
 */
export function paginationLabel(page: Pick<QuestPage, 'first' | 'last' | 'total'>): string {
  return `Showing ${page.first}-${page.last} of ${page.total}`;
}

/* ------------------------------------------------------------- empty states */

/**
 * The per-filter empty state, from the spec's own template (L268):
 * `No {status} quests found.`
 *
 * The `All` tab interpolates to `No All quests found.`, which is not English, so
 * `All` — the one tab with no status — reads `No quests found.`. This is the one
 * spec-silent point in the sentence and it is recorded in the story evidence.
 */
export function emptyStateMessage(filter: QuestFilter): string {
  return filter === 'All' ? 'No quests found.' : `No ${filter} quests found.`;
}

/** The suggestion the spec pairs with every empty state (L268: "change filter or extract more"). */
export const EMPTY_STATE_HINT =
  'Try a different filter or search, or extract more quests from a packet capture.';

/* --------------------------------------------------------- page-level copy */

/**
 * The disabled Edit button's tooltip (plan §2.7).
 *
 * A **native `title` attribute**, not a tooltip primitive: the vendored primitives
 * under `client/src/components/ui/` have no tooltip (D39 ships only what the shell
 * used), and a `title` plus `aria-disabled` is the honest small-diff choice. The
 * button keeps `aria-disabled="true"` rather than the `disabled` attribute so the
 * tooltip still fires on hover and the control stays focusable and announced —
 * a `disabled` button is removed from the tab order and never explains itself.
 */
export const EDIT_DISABLED_TOOLTIP = 'Editing arrives in Phase 3';

/** The browse row's Edit action's accessible name (it is icon-only — see the 80px column). */
export const EDIT_ACTION_LABEL = 'Edit quest';

/**
 * The status-menu placeholder's accessible name and tooltip.
 *
 * The status menu is task 2.8 / story **p2-09** (plan §2.8), still in Phase 2 — so
 * the placeholder says so instead of borrowing the Edit button's Phase 3 sentence.
 * p2-08 must not implement transitions, and a placeholder that is visually marked
 * and documented is the smallest honest thing to ship in its place.
 */
export const STATUS_MENU_PLACEHOLDER_TOOLTIP = 'Status transitions arrive with story p2-09';
export const STATUS_MENU_PLACEHOLDER_LABEL = 'Change status (arrives with story p2-09)';

/** The browse list's failure line. */
export const QUESTS_LOAD_ERROR = 'Could not load the quest list.';

/** The detail page's failure line. */
export const QUEST_LOAD_ERROR = 'Could not load this quest.';

/** The detail page's not-found heading (the server's 404 body is shown under it). */
export const QUEST_NOT_FOUND_TITLE = 'Quest not found';

/** Loading announcements, for the `aria-busy` skeletons. */
export const QUESTS_LOADING = 'Loading quests…';
export const QUEST_LOADING = 'Loading quest…';

/** The back link both detail states render (spec L281: "← Back to Quests"). */
export const BACK_TO_QUESTS_LABEL = 'Back to Quests';

/** The detail header's JSON-panel toggle: accessible name and the spec's `{ }` glyph. */
export const JSON_PANEL_LABEL = 'Toggle JSON panel';
export const JSON_PANEL_GLYPH = '{ }';

/** The JSON panel's accessible name (the desktop `<aside>` and the mobile dialog). */
export const JSON_PANEL_TITLE = 'Quest JSON';

/** The panel's width on desktop — `docs/spec-ui-design.md` L326. */
export const JSON_PANEL_WIDTH_PX = 400;

/** The JSON panel's copy button (spec L336's `[Copy]`). */
export const JSON_COPY_LABEL = 'Copy';
export const JSON_COPIED_MESSAGE = 'Quest JSON copied to the clipboard';
export const JSON_COPY_ERROR = 'Could not copy the quest JSON to the clipboard.';

/**
 * The JSON panel's `[Wrap]` affordance is deliberately **not** shipped: the spec's
 * `[Copy] [Wrap]` diagram (L336) comes from the `@monaco-editor/react` option of
 * L326, where wrapping is a toggle. `react-json-view-lite` renders wrapping text
 * unconditionally (its own container CSS is `white-space: pre-wrap`), so there is
 * nothing to toggle — recorded in the story evidence as the one panel deviation.
 */

/* ------------------------------------------------------------- row readers */

/**
 * One row's status, defaulting to `extracted` — the same default the server
 * applies to a quest with no `entry_status` row (D49), and the guard that keeps
 * `STATUS_META[status]` from throwing on an unexpected value.
 */
export function questStatus(row: Pick<QuestListRow, 'status'> | undefined): StatusValue {
  const status = row?.status;
  return status === 'reviewed' || status === 'verified' ? status : 'extracted';
}

/** `true` for the one failure the detail page renders as "not found" (D49's 404). */
export function isNotFoundError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
