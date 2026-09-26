import type { Page, Route } from '@playwright/test';

/**
 * Shared route mocks for the two quest tier-1 specs (story p2-08, decision D23
 * tier 1 / D40).
 *
 * CI has no SpiralDB corpus and no synced database, so `/api/quests` is fulfilled
 * from the fixtures below — the **wire contract** of `docs/spec-api.md` L190-208 is
 * copied here literally on purpose: a fixture that imported `client/src/lib/api.ts`
 * could only prove the client agrees with itself.
 *
 * The default corpus is the spec's own example (`docs/spec-ui-design.md` L245):
 * 322 quests — 45 extracted, 120 reviewed, 157 verified — so the filter tabs' count
 * badges and the pagination line ("Showing 1-50 of 322") are the documented ones,
 * not invented numbers.
 */

/** One `quests[]` element, copied from `docs/spec-api.md` L190-208. */
export interface MockQuestRow {
  quest_name: string;
  title: string;
  title_key: string | null;
  title_source: 'resolved' | 'rawKey' | 'missing';
  level: number | null;
  goal_count: number;
  is_mainline: boolean;
  modified_at: string | null;
  status: 'extracted' | 'reviewed' | 'verified';
}

/** The three statuses' row counts in the default corpus (spec L245). */
const EXTRACTED_ROWS = 45;
const REVIEWED_ROWS = 120;
const TOTAL_ROWS = 322;

/** The two names the search spec types against, plus the last name when sorting. */
export const ACAD1_NAMES = ['DS-ACAD1-C01-001', 'DS-ACAD1-C01-002'] as const;
export const LAST_NAME = 'WC-UNICORN-MAIN-004';

/** The quest the detail endpoint answers with; the detail spec's subject. */
export const MOCK_QUEST = {
  m_questName: 'DS-ACAD1-C01-001',
  m_questTitle: 'QuestTitle_1ED8D',
  m_questLevel: 7,
  m_mainline: true,
  m_isHidden: false,
  m_questRepeat: 0,
  m_goals: [
    {
      $type: 'Imcodec.ObjectProperty.TypeCache.WaypointGoalTemplate, Imcodec.ObjectProperty',
      m_goalName: '1_WizardQuestGoals_GotoZone',
      m_zoneName: 'DragonSpire/DS_A3_Kings',
    },
    {
      $type: 'Imcodec.ObjectProperty.TypeCache.BountyGoalTemplate, Imcodec.ObjectProperty',
      m_goalName: '2_WizardQuestGoals_KillMobs',
      m_bountyTotal: 3,
    },
  ],
  m_goalLogic: [{ m_goalsAND: ['1_WizardQuestGoals_GotoZone'], m_completeQuest: false }],
  m_requirements: {
    m_requirements: [{ $type: 'ReqHasQuest', m_questName: 'WC-UNICORN-MAIN-004' }],
  },
  m_startResults: { m_results: [] },
  m_endResults: { m_results: [{ $type: 'ResDropTable', m_tableName: 'WC-UNICORN-MAIN-007' }] },
  m_dialogList: { m_dialogEntries: [] },
};

/** The fixed instant the fixtures' mtimes hang off (the relative text is asserted). */
const HOUR_MS = 60 * 60 * 1000;

/**
 * The default 322-row corpus.
 *
 * Rows `0..44` are `extracted`, `45..164` `reviewed` and the rest `verified` — so
 * the summary is exactly the spec's 45/120/157. Row `0` is one hour old, each
 * following row an hour older, which pins the Modified column's relative text
 * without touching the clock.
 */
export function mockQuestRows(total: number = TOTAL_ROWS): MockQuestRow[] {
  const now = Date.now();
  const rows: MockQuestRow[] = [];
  for (let index = 0; index < total; index += 1) {
    const questName =
      index === 0
        ? ACAD1_NAMES[0]
        : index === 1
          ? ACAD1_NAMES[1]
          : index === 2
            ? LAST_NAME
            : `QUEST-${String(index + 1).padStart(3, '0')}`;
    rows.push({
      quest_name: questName,
      title: `Title ${questName}`,
      title_key: null,
      title_source: index === 0 ? 'resolved' : 'rawKey',
      level: ((index + 10) % 20) + 1,
      goal_count: index % 8,
      is_mainline: index % 3 === 0,
      modified_at: new Date(now - (index + 1) * HOUR_MS).toISOString(),
      status:
        index < EXTRACTED_ROWS
          ? 'extracted'
          : index < EXTRACTED_ROWS + REVIEWED_ROWS
            ? 'reviewed'
            : 'verified',
    });
  }
  return rows;
}

/** The `GET /api/quests` body for a row set (summary counts the rows returned, D49). */
export function questListBody(rows: MockQuestRow[]): Record<string, unknown> {
  return {
    quests: rows,
    summary: {
      total: rows.length,
      extracted: rows.filter((row) => row.status === 'extracted').length,
      reviewed: rows.filter((row) => row.status === 'reviewed').length,
      verified: rows.filter((row) => row.status === 'verified').length,
    },
    skipped: [],
  };
}

type RouteHandler = (route: Route) => Promise<void> | void;

export interface QuestsMockOptions {
  /** Replaces the 322-row corpus (use `[]` for the empty state). */
  rows?: MockQuestRow[];
  /** Replaces the `GET /api/quests` answer entirely (for 400/500 cases). */
  onList?: RouteHandler;
  /** Replaces the `GET /api/quests/:name` answer entirely (for 404/500 cases). */
  onDetail?: RouteHandler;
  /** The quest object the detail endpoint answers with. */
  detail?: unknown;
}

/** What the mocked API recorded, so a spec can assert what was *not* requested. */
export interface QuestsMockRecorded {
  /** `GET /api/quests` calls — the browse list and the detail header's status read. */
  listRequests: number;
  /** `GET /api/quests/:name` calls. */
  detailRequests: number;
  /** The request URLs in order, for the client-side-search assertion. */
  urls: string[];
}

/**
 * Fulfils the complete data surface of both pages — the shell's settings/sync
 * reads, the quest list and the quest detail — so nothing reaches the dev server's
 * database or the developer's SpiralDB clone.
 */
export async function mockQuestsApi(
  page: Page,
  options: QuestsMockOptions = {},
): Promise<QuestsMockRecorded> {
  const recorded: QuestsMockRecorded = { listRequests: 0, detailRequests: 0, urls: [] };
  const rows = options.rows ?? mockQuestRows();

  await page.route('**/api/settings', (route) =>
    route.fulfill({
      json: {
        aurorium_path: '/mock/aurorium',
        imcodec_path: '/mock/imcodec',
        spiraldb_path: '/mock/spiraldb',
        user_name: 'Mock Reviewer',
        git_branch: 'content/2026-09-26',
      },
    }),
  );
  await page.route('**/api/sync/status', (route) =>
    route.fulfill({
      json: { last_sync: null, revision: null, status: 'never' },
    }),
  );
  await page.route('**/api/sync/history', (route) => route.fulfill({ json: { history: [] } }));
  // The import report is mocked too: the browse page must not depend on the dev
  // stack's database, and `ran: false` keeps the one-time toast off the screen.
  await page.route('**/api/status/_import', (route) =>
    route.fulfill({ json: { ran: false, imported: 0, imported_at: null } }),
  );

  await page.route('**/api/quests', async (route) => {
    recorded.listRequests += 1;
    recorded.urls.push(route.request().url());
    if (options.onList !== undefined) {
      await options.onList(route);
      return;
    }
    await route.fulfill({ json: questListBody(rows) });
  });

  await page.route('**/api/quests/*', async (route) => {
    recorded.detailRequests += 1;
    recorded.urls.push(route.request().url());
    if (options.onDetail !== undefined) {
      await options.onDetail(route);
      return;
    }
    await route.fulfill({ json: options.detail ?? MOCK_QUEST });
  });

  return recorded;
}
