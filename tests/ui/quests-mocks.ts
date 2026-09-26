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

/**
 * One `status_history` row of `GET /api/status/quests/:key/history`, copied from
 * `docs/spec-api.md` L113-141 (oldest → newest, D37).
 */
export interface MockHistoryRow {
  old_status: 'extracted' | 'reviewed' | 'verified' | null;
  new_status: 'extracted' | 'reviewed' | 'verified';
  notes: string | null;
  changed_by: string | null;
  changed_at: string | null;
}

/**
 * The spec's own history example (`docs/spec-api.md` L113-141): the initial
 * `extracted` row plus a `reviewed` and a `verified` transition, one day apart.
 *
 * `changed_at` is computed from `Date.now()` at call time so the timeline's
 * relative timestamps are deterministic ("2 days ago", "1 day ago", "right now")
 * without touching the clock.
 */
export function mockHistoryRows(): MockHistoryRow[] {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  return [
    {
      old_status: null,
      new_status: 'extracted',
      notes: 'Imported from packet capture session_2026-09-24.json',
      changed_by: 'quest_builder',
      changed_at: new Date(now - 2 * DAY).toISOString(),
    },
    {
      old_status: 'extracted',
      new_status: 'reviewed',
      notes: 'Goal logic chain verified against live game',
      changed_by: 'jason',
      changed_at: new Date(now - DAY).toISOString(),
    },
    {
      old_status: 'reviewed',
      new_status: 'verified',
      notes: 'Tested on r806919, all goals trigger correctly',
      changed_by: 'jason',
      changed_at: new Date(now - 30 * 1000).toISOString(),
    },
  ];
}

export interface QuestsMockOptions {
  /** Replaces the 322-row corpus (use `[]` for the empty state). */
  rows?: MockQuestRow[];
  /** Replaces the `GET /api/quests` answer entirely (for 400/500 cases). */
  onList?: RouteHandler;
  /** Replaces the `GET /api/quests/:name` answer entirely (for 404/500 cases). */
  onDetail?: RouteHandler;
  /** The quest object the detail endpoint answers with. */
  detail?: unknown;
  /**
   * `settings.user_name`. `''` is the D38/D43 "not asked yet" state, which makes the
   * identity gate open **before** the notes dialog.
   */
  userName?: string;
  /** `GET /api/status/quests/:key/history` rows; `[]` when omitted. */
  history?: MockHistoryRow[];
  /**
   * Answers the history route with the D51(f) untracked 404 instead of rows.
   *
   * A **successful** default `PATCH` mutates the mocked `rows` and appends to
   * `history` (see the handler), so the client's post-transition invalidation sees a
   * server that agrees with what it just did. The `onPatch` override bypasses both.
   */
  historyUntracked?: boolean;
  /** Replaces the `PATCH /api/status/quests/:key` answer entirely (for 404/500). */
  onPatch?: RouteHandler;
  /**
   * Holds every PATCH response open for this long. The optimistic badge flip must be
   * observable while the request is still in flight, i.e. before the settle
   * invalidation can refetch anything.
   */
  patchDelayMs?: number;
}

/** What the mocked API recorded, so a spec can assert what was *not* requested. */
export interface QuestsMockRecorded {
  /** `GET /api/quests` calls — the browse list and the detail header's status read. */
  listRequests: number;
  /** `GET /api/quests/:name` calls. */
  detailRequests: number;
  /** The request URLs in order, for the client-side-search assertion. */
  urls: string[];
  /** The parsed bodies of every `PATCH /api/status/quests/:key`, in order. */
  patches: Array<Record<string, unknown>>;
  /** The `PATCH` request paths, in order (the path is part of the contract). */
  patchPaths: string[];
  /**
   * How many `PATCH` handlers have started answering. While this is still `0` the
   * request is in flight and nothing can have settled — the window in which an
   * on-screen status change can only be the optimistic write.
   */
  patchResponses: number;
  /** How many `GET .../history` reads were made. */
  historyRequests: number;
  /** The put bodies of every `PUT /api/settings` (the identity gate persists here). */
  settingsPuts: Array<Record<string, unknown>>;
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
  const recorded: QuestsMockRecorded = {
    listRequests: 0,
    detailRequests: 0,
    urls: [],
    patches: [],
    patchPaths: [],
    patchResponses: 0,
    historyRequests: 0,
    settingsPuts: [],
  };
  const rows = options.rows ?? mockQuestRows();
  const history = options.history ?? [];

  // Mutable so a `PUT /api/settings` answers with the merged map, exactly like the
  // server (D32) — the identity gate writes the name and reads it back.
  let settings: Record<string, string> = {
    aurorium_path: '/mock/aurorium',
    imcodec_path: '/mock/imcodec',
    spiraldb_path: '/mock/spiraldb',
    user_name: options.userName ?? 'Mock Reviewer',
    git_branch: 'content/2026-09-26',
  };
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() === 'PUT') {
      const patch = (route.request().postDataJSON() ?? {}) as Record<string, string>;
      recorded.settingsPuts.push(patch);
      settings = { ...settings, ...patch };
      await route.fulfill({ json: settings });
      return;
    }
    await route.fulfill({ json: settings });
  });
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

  // The whole status surface of one entry, one handler: `GET .../history` and
  // `PATCH /api/status/quests/:key` share a prefix, and Playwright runs the most
  // recently registered matching route first, so branching on method + suffix inside
  // one handler is less fragile than ordering two overlapping globs.
  await page.route('**/api/status/quests/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'PATCH') {
      recorded.patches.push((request.postDataJSON() ?? {}) as Record<string, unknown>);
      recorded.patchPaths.push(path);
      // Recorded before the delay, so the body is assertable while the request is
      // still open (the optimistic-flip window).
      if (options.patchDelayMs !== undefined && options.patchDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, options.patchDelayMs));
      }
      recorded.patchResponses += 1;
      if (options.onPatch !== undefined) {
        await options.onPatch(route);
        return;
      }
      // The default PATCH behaves like the server: it moves the row and appends one
      // `status_history` row, so the settle refetch — which the client invalidates
      // after every transition — agrees with the optimistic write instead of
      // reverting it, and the history timeline really shows the transition.
      const body = recorded.patches[recorded.patches.length - 1];
      const key = decodeURIComponent(path.split('/').pop() ?? '');
      const target = body.status as MockQuestRow['status'];
      const row = rows.find((candidate) => candidate.quest_name === key);
      const previous = row?.status ?? null;
      if (row !== undefined) {
        row.status = target;
      }
      history.push({
        old_status: previous,
        new_status: target,
        notes: (body.notes as string | undefined) ?? null,
        changed_by: settings.user_name,
        changed_at: new Date().toISOString(),
      });
      await route.fulfill({
        json: {
          object_type: 'quest',
          object_key: key,
          status: target,
          extracted_at: '2026-09-26T12:00:00.000Z',
          reviewed_at: null,
          verified_at: null,
          latest_notes: (body.notes as string | undefined) ?? null,
        },
      });
      return;
    }

    if (path.endsWith('/history')) {
      recorded.historyRequests += 1;
      if (options.historyUntracked === true) {
        const key = decodeURIComponent(path.split('/').slice(-2)[0] ?? '');
        await route.fulfill({
          status: 404,
          json: { error: `Unknown quests entry "${key}"` },
        });
        return;
      }
      await route.fulfill({ json: { history } });
      return;
    }

    // Nothing else on this surface is part of the client: answer loudly instead of
    // continuing to the dev stack's database (the tier-1 suite stays hermetic, D40).
    await route.fulfill({ status: 404, json: { error: `Unmocked status route: ${path}` } });
  });

  return recorded;
}
