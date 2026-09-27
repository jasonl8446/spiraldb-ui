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
import {
  compareNullable,
  filterByStatus,
  objectEmptyStateMessage,
  objectFilterTabs,
  paginateRows,
  paginationLabel as genericPaginationLabel,
  searchRows,
} from './object-list';

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
  { id: 'status', header: 'Status', widthPx: 104, sortable: true },
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
  // The rule itself lives in `lib/object-list.ts`, which the eight Phase-4 list
  // pages use too (task 4.1) — one implementation, two surfaces.
  return objectFilterTabs(summary);
}

/** The rows one filter tab selects. */
export function filterQuests(rows: readonly QuestListRow[], filter: QuestFilter): QuestListRow[] {
  return filterByStatus(rows, filter, questStatus);
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
  return searchRows(rows, query, (row) => [row.quest_name, row.title, row.title_key]);
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
  // The slice-and-clamp rule is `lib/object-list.ts`'s `paginateRows` (shared with
  // the Phase-4 lists); `QuestPage` stays the exported shape this page's tests pin.
  return paginateRows(rows, page, pageSize);
}

/**
 * The pagination string, exactly the spec's shape (L266): `Showing 1-50 of 322`.
 *
 * An empty list reads `Showing 0-0 of 0` — one shape for every empty case
 * (filter, search and the empty corpus) instead of a second sentence the spec does
 * not have.
 */
export function paginationLabel(page: Pick<QuestPage, 'first' | 'last' | 'total'>): string {
  return genericPaginationLabel(page);
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
  return objectEmptyStateMessage(filter, 'quests');
}

/** The suggestion the spec pairs with every empty state (L268: "change filter or extract more"). */
export const EMPTY_STATE_HINT =
  'Try a different filter or search, or extract more quests from a packet capture.';

/* --------------------------------------------------------- page-level copy */

/**
 * The **browse row's** Edit action tooltip (plan §2.7).
 *
 * A **native `title` attribute**, not a tooltip primitive: the vendored primitives
 * under `client/src/components/ui/` have no tooltip (D39 ships only what the shell
 * used), and a `title` plus `aria-disabled` is the honest small-diff choice. The
 * button keeps `aria-disabled="true"` rather than the `disabled` attribute so the
 * tooltip still fires on hover and the control stays focusable and announced —
 * a `disabled` button is removed from the tab order and never explains itself.
 *
 * **Story p3-10 changed what this constant covers, and the copy is now stale on purpose.**
 * Until 3.10 it was the wording of *both* Edit affordances (D59(a)'s documented 3.3/3.10 split);
 * 3.10 replaced the **detail page's** button with the real view/edit toggle
 * (`lib/quest-edit.ts`'s `EDIT_TOGGLE_LABEL`), so this sentence is left describing only the
 * browse table's still-disabled placeholder row action. Making that row action navigate, and
 * retiring this sentence, is recorded as a follow-up rather than done here: p2-08's spec pins the
 * placeholder and the 80px Actions column is not edit-mode wiring.
 */
export const EDIT_DISABLED_TOOLTIP = 'Editing arrives in Phase 3';

/** The browse row's Edit action's accessible name (it is icon-only — see the 80px column). */
export const EDIT_ACTION_LABEL = 'Edit quest';

/*
 * p2-08 shipped the status menu as a documented, disabled placeholder here
 * (`STATUS_MENU_PLACEHOLDER_TOOLTIP` / `STATUS_MENU_PLACEHOLDER_LABEL`). Story p2-09
 * built the real menu, so both constants and every assertion on them are **gone** —
 * the menu's own copy now lives with its logic in `lib/status-transition.ts`.
 */

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

/**
 * The panel's width on **desktop** (≥1280px) — `docs/spec-ui-design.md` L326/L520.
 *
 * The width is a breakpoint rule, not one number, so `QuestJsonPanel` applies it the way this
 * codebase applies every other breakpoint (`Sidebar`'s `w-[200px] xl:w-[260px]`): Tailwind
 * classes. These two constants are the numbers' home of record and
 * `tests/ui/responsive.spec.ts` asserts the rendered `<aside>` against them at both tiers, so a
 * class edited away from its constant fails a test rather than drifting silently.
 */
export const JSON_PANEL_WIDTH_PX = 400;

/** The panel's width on **tablet** (768–1279px) — `docs/spec-ui-design.md` L518. Story p5-06:
 * it was 400px at every width above `md` before, so the spec's tablet width did not exist. */
export const JSON_PANEL_TABLET_WIDTH_PX = 300;

/** The JSON panel's copy button (spec L336's `[Copy]`). */
export const JSON_COPY_LABEL = 'Copy';
export const JSON_COPIED_MESSAGE = 'Quest JSON copied to the clipboard';
export const JSON_COPY_ERROR = 'Could not copy the quest JSON to the clipboard.';

/**
 * The JSON panel's `[Wrap]` toggle (spec L336's `[Copy] [Wrap]`; plan task 3.10's AC2).
 *
 * The note that stood here recorded `[Wrap]` as deliberately **not** shipped ("the spec draws it
 * as a Monaco option and the chosen viewer wraps unconditionally"). Story **p3-10 supersedes
 * it**: the AC requires the control, and the wrap state is the panel's own container class either
 * way (`whitespace-pre-wrap break-words` versus `whitespace-pre` + horizontal scroll), so it is a
 * working toggle rather than a disabled decoration.
 */
export const JSON_WRAP_LABEL = 'Wrap';
/** The Wrap toggle's tooltip in each state (the button's `aria-pressed` carries the state). */
export const JSON_WRAP_ON_TOOLTIP =
  'Wrap long values in the panel (pressing it scrolls sideways instead)';
export const JSON_WRAP_OFF_TOOLTIP = 'Wrap long values in the panel instead of scrolling sideways';

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
