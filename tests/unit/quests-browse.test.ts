import { describe, expect, it } from 'vitest';

import { ApiError, type QuestListRow } from '../../client/src/lib/api';
import { RELATIVE_TIME_FALLBACK, relativeTime } from '../../client/src/lib/display';
import {
  DEFAULT_QUEST_SORT,
  deriveQuests,
  EDIT_DISABLED_TOOLTIP,
  EMPTY_STATE_HINT,
  emptyStateMessage,
  filterQuests,
  isNotFoundError,
  JSON_PANEL_WIDTH_PX,
  paginateQuests,
  paginationLabel,
  QUEST_COLUMNS,
  QUEST_FILTERS,
  QUEST_FILTER_STATUS,
  questFilterTabs,
  questStatus,
  QUESTS_PAGE_SIZE,
  QUESTS_SEARCH_PLACEHOLDER,
  searchQuests,
  sortQuests,
  type QuestFilter,
} from '../../client/src/lib/quests';

/**
 * Story p2-08's pure logic (plan task 2.7, decision D10): the relative-time
 * helper the Modified column renders, the exact column spec the table builds from,
 * and the filter/search/sort/pagination derivations the browse page runs over one
 * `GET /api/quests` payload.
 *
 * Plain node, no jsdom, no React: the React halves only move state and pixels, so
 * every rule that decides what a user sees is asserted here.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A row factory: every field defaulted, each test overriding what it cares about. */
function row(overrides: Partial<QuestListRow> & { quest_name: string }): QuestListRow {
  return {
    title: `Title ${overrides.quest_name}`,
    title_key: null,
    title_source: 'rawKey',
    level: 1,
    goal_count: 0,
    is_mainline: false,
    modified_at: '2026-09-26T12:00:00.000Z',
    status: 'extracted',
    ...overrides,
  };
}

const NOW = Date.parse('2026-09-26T12:00:00.000Z');

describe('relativeTime', () => {
  it('renders the sub-minute window (and clock skew) as "just now"', () => {
    expect(relativeTime(new Date(NOW).toISOString(), NOW)).toBe('just now');
    expect(relativeTime(new Date(NOW - 44 * SECOND).toISOString(), NOW)).toBe('just now');
    // A file whose mtime is in the browser's future is not "-5 minutes ago".
    expect(relativeTime(new Date(NOW + 5 * MINUTE).toISOString(), NOW)).toBe('just now');
  });

  it('steps minutes → hours → days → months → years at the documented thresholds', () => {
    expect(relativeTime(new Date(NOW - 45 * SECOND).toISOString(), NOW)).toBe('1 minute ago');
    expect(relativeTime(new Date(NOW - 5 * MINUTE).toISOString(), NOW)).toBe('5 minutes ago');
    expect(relativeTime(new Date(NOW - 59 * MINUTE).toISOString(), NOW)).toBe('59 minutes ago');
    // The unit changes at the whole unit, never later: 60 minutes is `1 hour ago`
    // and 90 minutes is not `90 minutes ago`.
    expect(relativeTime(new Date(NOW - 60 * MINUTE).toISOString(), NOW)).toBe('1 hour ago');
    expect(relativeTime(new Date(NOW - 90 * MINUTE).toISOString(), NOW)).toBe('1 hour ago');
    expect(relativeTime(new Date(NOW - 23 * HOUR).toISOString(), NOW)).toBe('23 hours ago');
    expect(relativeTime(new Date(NOW - 24 * HOUR).toISOString(), NOW)).toBe('1 day ago');
    expect(relativeTime(new Date(NOW - 35 * HOUR).toISOString(), NOW)).toBe('1 day ago');
    expect(relativeTime(new Date(NOW - 10 * DAY).toISOString(), NOW)).toBe('10 days ago');
    expect(relativeTime(new Date(NOW - 29 * DAY).toISOString(), NOW)).toBe('29 days ago');
    expect(relativeTime(new Date(NOW - 30 * DAY).toISOString(), NOW)).toBe('1 month ago');
    expect(relativeTime(new Date(NOW - 364 * DAY).toISOString(), NOW)).toBe('12 months ago');
    expect(relativeTime(new Date(NOW - 365 * DAY).toISOString(), NOW)).toBe('1 year ago');
    expect(relativeTime(new Date(NOW - 800 * DAY).toISOString(), NOW)).toBe('2 years ago');
  });

  it('never invents a date for a missing, empty or unparsable mtime', () => {
    // `modified_at` is `null` when the corpus file vanished before the server stat'ed it.
    expect(relativeTime(null, NOW)).toBe(RELATIVE_TIME_FALLBACK);
    expect(relativeTime(undefined, NOW)).toBe(RELATIVE_TIME_FALLBACK);
    expect(relativeTime('', NOW)).toBe(RELATIVE_TIME_FALLBACK);
    expect(relativeTime('   ', NOW)).toBe(RELATIVE_TIME_FALLBACK);
    expect(relativeTime('not-a-timestamp', NOW)).toBe(RELATIVE_TIME_FALLBACK);
  });
});

describe('the column spec', () => {
  it('is the spec table verbatim — seven columns, widths, sortability (L254-262)', () => {
    expect(QUEST_COLUMNS).toEqual([
      { id: 'status', header: 'Status', widthPx: 40, sortable: true },
      { id: 'quest_name', header: 'Quest Name', widthPx: null, sortable: true },
      { id: 'level', header: 'Level', widthPx: 60, sortable: true },
      { id: 'goal_count', header: 'Goals', widthPx: 60, sortable: true },
      { id: 'is_mainline', header: 'Mainline', widthPx: 40, sortable: true },
      { id: 'modified_at', header: 'Modified', widthPx: 120, sortable: true },
      { id: 'actions', header: 'Actions', widthPx: 80, sortable: false },
    ]);
  });

  it('fixes six of the seven widths, leaving only Quest Name as the flex column', () => {
    expect(QUEST_COLUMNS.filter((column) => column.widthPx === null).map((c) => c.id)).toEqual([
      'quest_name',
    ]);
    expect(QUEST_COLUMNS.filter((column) => !column.sortable).map((c) => c.id)).toEqual([
      'actions',
    ]);
  });
});

describe('filter tabs', () => {
  it('carries the four filters in spec order and their statuses', () => {
    expect(QUEST_FILTERS).toEqual(['All', 'Extracted', 'Reviewed', 'Verified']);
    expect(QUEST_FILTER_STATUS).toEqual({
      All: null,
      Extracted: 'extracted',
      Reviewed: 'reviewed',
      Verified: 'verified',
    });
  });

  it('reads its count badges from the response summary (D49)', () => {
    expect(questFilterTabs({ total: 322, extracted: 45, reviewed: 120, verified: 157 })).toEqual([
      { filter: 'All', count: 322 },
      { filter: 'Extracted', count: 45 },
      { filter: 'Reviewed', count: 120 },
      { filter: 'Verified', count: 157 },
    ]);
  });

  it('selects rows by status, and everything for All', () => {
    const rows = [
      row({ quest_name: 'A', status: 'extracted' }),
      row({ quest_name: 'B', status: 'reviewed' }),
      row({ quest_name: 'C', status: 'verified' }),
      row({ quest_name: 'D', status: 'reviewed' }),
    ];
    expect(filterQuests(rows, 'All').map((r) => r.quest_name)).toEqual(['A', 'B', 'C', 'D']);
    expect(filterQuests(rows, 'Extracted').map((r) => r.quest_name)).toEqual(['A']);
    expect(filterQuests(rows, 'Reviewed').map((r) => r.quest_name)).toEqual(['B', 'D']);
    expect(filterQuests(rows, 'Verified').map((r) => r.quest_name)).toEqual(['C']);
    // A copy, never the caller's array.
    expect(filterQuests(rows, 'All')).not.toBe(rows);
  });

  it('defaults an unexpected status to extracted, like the server does (D49)', () => {
    expect(questStatus(row({ quest_name: 'A', status: 'verified' }))).toBe('verified');
    expect(questStatus(row({ quest_name: 'A', status: 'reviewed' }))).toBe('reviewed');
    expect(questStatus(undefined)).toBe('extracted');
    expect(questStatus({ status: 'nonsense' as QuestListRow['status'] })).toBe('extracted');
  });
});

describe('searchQuests', () => {
  const rows = [
    row({
      quest_name: 'DS-ACAD1-C01-001',
      title: 'Quest for Perfection',
      title_key: 'QuestTitle_1ED8D',
    }),
    row({ quest_name: 'WC-UNICORN-MAIN-004', title: 'Unicorn Ride', title_key: null }),
  ];

  it('searches the name, the title and the raw title key, case-insensitively', () => {
    expect(searchQuests(rows, 'acad1').map((r) => r.quest_name)).toEqual(['DS-ACAD1-C01-001']);
    expect(searchQuests(rows, 'PERFECTION').map((r) => r.quest_name)).toEqual(['DS-ACAD1-C01-001']);
    expect(searchQuests(rows, 'questtitle_1ed8d').map((r) => r.quest_name)).toEqual([
      'DS-ACAD1-C01-001',
    ]);
    expect(searchQuests(rows, 'unicorn').map((r) => r.quest_name)).toEqual(['WC-UNICORN-MAIN-004']);
  });

  it('treats a blank query as no filter and a miss as empty — never as an error', () => {
    expect(searchQuests(rows, '')).toHaveLength(2);
    expect(searchQuests(rows, '   ')).toHaveLength(2);
    expect(searchQuests(rows, 'nothing-matches-this')).toEqual([]);
  });

  it('exposes the spec’s placeholder verbatim', () => {
    expect(QUESTS_SEARCH_PLACEHOLDER).toBe('Search quests...');
  });
});

describe('sortQuests', () => {
  const rows = [
    row({
      quest_name: 'B',
      level: 3,
      goal_count: 1,
      is_mainline: false,
      modified_at: '2026-01-02T00:00:00.000Z',
    }),
    row({ quest_name: 'A', level: null, goal_count: 9, is_mainline: true, modified_at: null }),
    row({
      quest_name: 'C',
      level: 1,
      goal_count: 1,
      is_mainline: true,
      modified_at: '2026-01-01T00:00:00.000Z',
    }),
  ];

  it('sorts quest names ascending by default and descending on request', () => {
    expect(sortQuests(rows, DEFAULT_QUEST_SORT).map((r) => r.quest_name)).toEqual(['A', 'B', 'C']);
    expect(
      sortQuests(rows, { key: 'quest_name', direction: 'desc' }).map((r) => r.quest_name),
    ).toEqual(['C', 'B', 'A']);
  });

  it('sorts numerically for Level and Goals, with a null level sorted last', () => {
    expect(sortQuests(rows, { key: 'level', direction: 'asc' }).map((r) => r.level)).toEqual([
      1,
      3,
      null,
    ]);
    expect(
      sortQuests(rows, { key: 'goal_count', direction: 'desc' }).map((r) => r.goal_count),
    ).toEqual([9, 1, 1]);
  });

  it('puts mainline rows first when ascending and last when descending', () => {
    expect(
      sortQuests(rows, { key: 'is_mainline', direction: 'asc' }).map((r) => r.is_mainline),
    ).toEqual([true, true, false]);
    expect(
      sortQuests(rows, { key: 'is_mainline', direction: 'desc' }).map((r) => r.is_mainline),
    ).toEqual([false, true, true]);
  });

  it('sorts Modified by time, with a missing mtime last', () => {
    expect(
      sortQuests(rows, { key: 'modified_at', direction: 'asc' }).map((r) => r.quest_name),
    ).toEqual(['C', 'B', 'A']);
  });

  it('is stable through a quest-name tie-break and never mutates the input', () => {
    const tied = [
      row({ quest_name: 'Z', goal_count: 5 }),
      row({ quest_name: 'A', goal_count: 5 }),
      row({ quest_name: 'M', goal_count: 5 }),
    ];
    expect(
      sortQuests(tied, { key: 'goal_count', direction: 'asc' }).map((r) => r.quest_name),
    ).toEqual(['A', 'M', 'Z']);
    expect(tied.map((r) => r.quest_name)).toEqual(['Z', 'A', 'M']);
  });

  it('sorts statuses in lifecycle order (which is also alphabetical)', () => {
    const statuses = [
      row({ quest_name: 'C', status: 'verified' }),
      row({ quest_name: 'A', status: 'extracted' }),
      row({ quest_name: 'B', status: 'reviewed' }),
    ];
    expect(sortQuests(statuses, { key: 'status', direction: 'asc' }).map((r) => r.status)).toEqual([
      'extracted',
      'reviewed',
      'verified',
    ]);
  });
});

describe('deriveQuests', () => {
  it('filters, then searches, then sorts — one client-side derivation', () => {
    const rows = [
      row({ quest_name: 'DS-1', status: 'extracted', level: 9 }),
      row({ quest_name: 'DS-2', status: 'reviewed', level: 2 }),
      row({ quest_name: 'WC-3', status: 'reviewed', level: 4 }),
    ];
    const derived = deriveQuests(rows, {
      filter: 'Reviewed',
      query: 'ds',
      sort: { key: 'level', direction: 'asc' },
    });
    expect(derived.map((r) => r.quest_name)).toEqual(['DS-2']);
  });
});

describe('paginateQuests', () => {
  const rows = Array.from({ length: 322 }, (_, index) => row({ quest_name: `Q-${index + 1}` }));

  it('slices 50 rows a page and labels the first page the spec’s way', () => {
    const page = paginateQuests(rows, 1);
    expect(page.items).toHaveLength(QUESTS_PAGE_SIZE);
    expect(page.items[0].quest_name).toBe('Q-1');
    expect(page.pageCount).toBe(7);
    expect(page.first).toBe(1);
    expect(page.last).toBe(50);
    expect(page.total).toBe(322);
    expect(page.hasPrevious).toBe(false);
    expect(page.hasNext).toBe(true);
    expect(paginationLabel(page)).toBe('Showing 1-50 of 322');
  });

  it('labels the last, partial page and the boundaries correctly', () => {
    const last = paginateQuests(rows, 7);
    expect(last.items).toHaveLength(22);
    expect(last.first).toBe(301);
    expect(last.last).toBe(322);
    expect(last.hasPrevious).toBe(true);
    expect(last.hasNext).toBe(false);
    expect(paginationLabel(last)).toBe('Showing 301-322 of 322');
  });

  it('clamps an out-of-range page instead of rendering an empty page', () => {
    // A filter that shrinks the list while page 7 is selected must not strand the user.
    expect(paginateQuests(rows, 99).page).toBe(7);
    expect(paginateQuests(rows, 0).page).toBe(1);
    expect(paginateQuests(rows, -3).page).toBe(1);
    expect(paginateQuests(rows, Number.NaN).page).toBe(1);
  });

  it('reads an empty list as Showing 0-0 of 0 with both buttons disabled', () => {
    const empty = paginateQuests([], 1);
    expect(empty.items).toEqual([]);
    expect(empty.pageCount).toBe(1);
    expect(paginationLabel(empty)).toBe('Showing 0-0 of 0');
    expect(empty.hasPrevious).toBe(false);
    expect(empty.hasNext).toBe(false);
  });
});

describe('empty states and page copy', () => {
  it('names each filter, with the one spec-silent All case', () => {
    const expected: Record<QuestFilter, string> = {
      All: 'No quests found.',
      Extracted: 'No Extracted quests found.',
      Reviewed: 'No Reviewed quests found.',
      Verified: 'No Verified quests found.',
    };
    for (const filter of QUEST_FILTERS) {
      expect(emptyStateMessage(filter)).toBe(expected[filter]);
    }
    // The spec's template is `No {status} quests found.`; `All` has no status, so it
    // reads as English instead of the literal "No All quests found." (recorded).
    expect(EMPTY_STATE_HINT).toContain('extract more quests');
  });

  it('carries the mandated copy and geometry the pages render', () => {
    expect(EDIT_DISABLED_TOOLTIP).toBe('Editing arrives in Phase 3');
    // p2-08's `STATUS_MENU_PLACEHOLDER_TOOLTIP` assertion stood here. Story p2-09
    // built the real status menu, so the placeholder constant is gone and this test
    // no longer pins "Status transitions arrive with story p2-09" — the menu's own
    // copy and availability are asserted in `status-transition.test.ts` and the
    // tier-1 `quests-status.spec.ts`.
    expect(JSON_PANEL_WIDTH_PX).toBe(400);
    expect(QUESTS_PAGE_SIZE).toBe(50);
  });
});

describe('isNotFoundError', () => {
  it('is true for the D49 unknown-name 404 and false for everything else', () => {
    expect(isNotFoundError(new ApiError(404, 'Unknown quest "NOPE"'))).toBe(true);
    expect(isNotFoundError(new ApiError(500, 'boom'))).toBe(false);
    expect(isNotFoundError(new Error('Unknown quest "NOPE"'))).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
    expect(isNotFoundError('404')).toBe(false);
  });
});
