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
 *
 * That 322 is the **UI-design spec's example**, not a measurement of the owner's
 * fork — which held **328** quest files at `f9a1055` when this was last re-measured.
 * The two numbers must not be conflated: the mocks below are a fixture for the wire
 * contract, so a corpus move must never be "fixed" by editing these rows, and a
 * failure here is never evidence about the corpus. Corpus-facing counts live in the
 * unit suites and in the specs' own measured comments.
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

/**
 * The default `GET /api/quests/:name/evidence` body (story p6-08).
 *
 * Shape copied from `docs/spec-api.md` L424-469 literally, like every other fixture in this file:
 * a fixture that imported the server's own types could only prove the client agrees with itself.
 * The quest name is {@link MOCK_QUEST}'s, and the two text rows are one **used** row (with the
 * provenance path the panel groups it under) and one **available** row (`field: null`) — the split
 * the spec's ASCII draws and the insert covers.
 */
export const MOCK_EVIDENCE = {
  quest: {
    quest_name: MOCK_QUEST.m_questName,
    quest_id: 126861,
    has_definition: true,
    link_kind: 'inferred',
    title: 'Wizard Tours',
    title_source: 'inferred',
    inference_basis: 'neighbour midpoint between QuestTitle_1ED8D and QuestTitle_1ED8F',
  },
  text_rows: [
    {
      key: 'WizQst1A2B_00000000',
      value: 'Fixture line used by this file.',
      category: 'WizQst1A2B',
      used_by_this_file: true,
      field: 'm_questTitle',
    },
    {
      key: 'WizQst1A2B_00000004',
      value: 'Fixture line available to this file.',
      category: 'WizQst1A2B',
      used_by_this_file: false,
      field: null,
    },
    {
      key: 'WizQst1A2B_00000005',
      value: 'A second available fixture line.',
      category: 'WizQst1A2B',
      used_by_this_file: false,
      field: null,
    },
  ],
  goal_gates: [
    {
      goal_name: 'WC-UNICORN-MAIN-004_Complete',
      required_status: 'Completed',
      refs: [{ wad: 'WizardCity.wad', entry: 'Gate_1', class: 'ReqHasQuest' }],
    },
  ],
  dialogue: [
    {
      index: 0,
      field: 'm_dialogList.m_dialogs[0].m_dialogEntries[0]',
      dialog_key: 'WizQst1A2B_00000000',
      own_table: true,
      text: 'Fixture line used by this file.',
      speaker: {
        name: 'Cyrus Drake',
        source: 'composed',
        persona: 'WC-RAV-NPC02_Persona',
        override_key: null,
        st_key: 'NPCFormats_First_Last',
        template_id: 9002,
      },
      portrait: null,
      sound: null,
      camera_name: 'LOCATION',
      actor_template_id: 9002,
    },
  ],
  references: [
    {
      field: 'm_goals[0].m_destinationZone',
      value: 'DragonSpire/DS_A3_Kings',
      key: 'm_destinationZone',
      sources: ['zones'],
      kind: 'zones',
      resolved: { label: 'DS_A3_Kings', display: 'DragonSpire/DS_A3_Kings (DS_A3_Kings)' },
    },
  ],
  warnings: [],
};

/**
 * The `GET /api/quests/coverage` body (story p6-11).
 *
 * Shape copied from `docs/spec-api.md` L446-456 literally. The numbers are the ones the scratch
 * clone's `coverage` view holds — `(1717, 4823, 322, 1395, 2855)` — **not** the spec's
 * illustrative `1,447`, so the header assertion is about the response rather than about a
 * constant that could have been typed into the page. `corpus` names the mock root and its count,
 * which is ac1's third clause rendered rather than implied.
 */
export const MOCK_COVERAGE = {
  nameable: 1717,
  id_space: 4823,
  defined: 322,
  missing: 1395,
  references: 2855,
  corpus: { spiraldb_path: '/mock/spiraldb', quest_files: 322 },
};

/** The header sentence {@link MOCK_COVERAGE} must produce, verbatim. */
export const MOCK_COVERAGE_HEADLINE =
  '322 defined of 1,717 nameable of ~4,823 quests the client holds text for' +
  ' — corpus: /mock/spiraldb (322 quest files)';

/** One `GET /api/quests/catalog` row (story p6-11). */
export interface MockCatalogRow {
  quest_name: string;
  title: string;
  title_source: 'direct' | 'inferred' | 'none';
  has_definition: 0 | 1;
  reference_count: number;
}

/**
 * The default catalog worklist: two defined rows and two missing ones, so the missing-only filter
 * has something to narrow and the two row actions are both exercised. The names are the corpus's
 * own, and the order is the API's (most-gated first).
 */
export const MOCK_CATALOG_ROWS: MockCatalogRow[] = [
  {
    quest_name: 'DM-GRAVE-MAIN-008',
    title: 'Stakes and Stones',
    title_source: 'direct',
    has_definition: 0,
    reference_count: 19,
  },
  {
    quest_name: 'DS-ACAD1-C01-001',
    title: 'Wizard Tours',
    title_source: 'inferred',
    has_definition: 1,
    reference_count: 6,
  },
  {
    quest_name: 'WC-UNICORN-MAIN-004',
    title: 'Unicorn Way',
    title_source: 'direct',
    has_definition: 0,
    reference_count: 3,
  },
  {
    quest_name: 'KT-CRYHub-C01-004',
    title: 'Temple Dweller',
    title_source: 'none',
    has_definition: 1,
    reference_count: 3,
  },
];

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
   * The string-table rows `GET /api/names/strings/:key` answers with (story p3-03's
   * title lookup). A key that is **absent** 404s, which is the raw-key fallback path.
   *
   * Default `{}`: the Info editor's lookup resolves to the raw key, and — like every
   * other route here — nothing reaches the dev server, so the tier-1 run stays
   * hermetic (D40).
   */
  names?: Record<string, string>;
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
  /** Replaces the `POST /api/quests` answer entirely (for the 400/500 cases, story p3-10). */
  onSave?: RouteHandler;
  /**
   * The `GET /api/quests/:name/evidence` payload (story p6-08's panel). Defaults to
   * {@link MOCK_EVIDENCE}, whose quest name is {@link MOCK_QUEST}'s so the panel beside the editor
   * describes the quest on screen.
   */
  evidence?: unknown;
  /** Replaces the evidence answer entirely (for the 404/500 arms). */
  onEvidence?: RouteHandler;
  /**
   * The `GET /api/quests/coverage` payload (story p6-11's header). Defaults to
   * {@link MOCK_COVERAGE}, whose numbers are the **measured scratch-clone** ones — not the spec's
   * illustrative 1,447 — so a header that rendered a spec constant would visibly disagree.
   */
  coverage?: unknown;
  /** Replaces the coverage answer entirely (for the 404/500 arms). */
  onCoverage?: RouteHandler;
  /**
   * The `GET /api/quests/catalog` rows (story p6-11's worklist). Defaults to
   * {@link MOCK_CATALOG_ROWS}; the handler applies `?missing_only=1` to them exactly like the
   * server's SQL does, so the spec proves the *request* carried the filter.
   */
  catalogRows?: MockCatalogRow[];
  /** Replaces the catalog answer entirely (for the 404/500 arms). */
  onCatalog?: RouteHandler;
  /** Replaces the `POST /api/quests/scaffold` answer entirely. */
  onScaffold?: RouteHandler;
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
  /**
   * Every `GET /api/names/strings/:key` id, in order (story p3-03).
   *
   * Load-bearing for one assertion: a quest whose `m_questTitle` is `''` must produce
   * **no** entry here, because the empty-key URL falls through to the LIST route and
   * answers 24 MB (measured against the live database).
   */
  nameLookups: string[];
  /**
   * The bodies of every `POST /api/quests`, in order (`{ quest, notes?, source? }` — the save
   * contract of task 2.4 / D49(a), which story p3-10's Save drives).
   *
   * The `quest` object is the **live document** the editor sent, so a spec asserts the exact
   * payload that one form edit produced — including that nothing else moved.
   */
  savePosts: Array<Record<string, unknown>>;
  /**
   * How many evidence reads were made (story p6-08). Zero unless the Evidence tab was opened: the
   * panel's query is `enabled: railTab === 'evidence'`, so an unrelated spec never reaches this
   * route at all (D40).
   */
  evidenceRequests: number;
  /** The evidence request paths, in order — the quest the panel asked about. */
  evidenceUrls: string[];
  /** `GET /api/quests/coverage` calls (story p6-11). */
  coverageRequests: number;
  /** `GET /api/quests/catalog` request paths, in order — the filter is the query string. */
  catalogUrls: string[];
  /** The parsed bodies of every `POST /api/quests/scaffold`, in order (story p6-09/p6-11). */
  scaffoldPosts: Array<Record<string, unknown>>;
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
    nameLookups: [],
    savePosts: [],
    evidenceRequests: 0,
    evidenceUrls: [],
    coverageRequests: 0,
    catalogUrls: [],
    scaffoldPosts: [],
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

  // The single string-table lookup the Info editor issues for `m_questTitle`
  // (story p3-03). The id is the last path segment; the encoded form is decoded so a
  // key containing a space or a slash matches the map verbatim.
  await page.route('**/api/names/strings/*', async (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
    recorded.nameLookups.push(id);
    const value = options.names?.[id];
    if (value === undefined) {
      await route.fulfill({
        status: 404,
        json: { error: `Unknown strings id "${id}"` },
      });
      return;
    }
    await route.fulfill({ json: { key: id, value, category: 'QuestTitle' } });
  });

  await page.route('**/api/quests', async (route) => {
    // `POST /api/quests` is the same path as the list read (docs/spec-api.md §"Quests"), so the
    // handler branches on the method. Story p3-10's Save is the only caller; the answer is the
    // Phase-2 pipeline outcome shape (D49(a)) with the row's own status echoed back, which is
    // what makes "an edit+save does not change the verification status" assertable.
    if (route.request().method() === 'POST') {
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      recorded.savePosts.push(body);
      if (options.onSave !== undefined) {
        await options.onSave(route);
        return;
      }
      const quest = (body.quest ?? {}) as Record<string, unknown>;
      const name = typeof quest.m_questName === 'string' ? quest.m_questName : 'UNKNOWN';
      await route.fulfill({
        json: {
          quest_name: name,
          outcome: 'updated',
          action: 'update',
          commit: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
          branch: settings.git_branch,
          commit_message: `spiraldb: update quest ${name}`,
          file: `QuestTemplates/questtemplates_${name}.json`,
          metadata: `QuestMetadatas/questmetadata_${name}.json`,
          metadata_outcome: 'updated',
          status: {
            object_type: 'quest',
            object_key: name,
            status: rows.find((row) => row.quest_name === name)?.status ?? 'extracted',
            extracted_at: '2026-09-26T12:00:00.000Z',
            reviewed_at: null,
            verified_at: null,
            latest_notes: null,
          },
          warnings: [],
        },
      });
      return;
    }

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

  /**
   * `GET /api/quests/:name/evidence` (task 6.6, read by story p6-08's panel).
   *
   * Registered **after** the detail route on purpose: the detail route's glob stops at the next
   * `/`, so it cannot match this longer path, and Playwright runs the most recently registered
   * matching route first anyway — this handler owns the path without any ordering question.
   */
  await page.route('**/api/quests/*/evidence', async (route) => {
    recorded.evidenceRequests += 1;
    recorded.urls.push(route.request().url());
    recorded.evidenceUrls.push(new URL(route.request().url()).pathname);
    if (options.onEvidence !== undefined) {
      await options.onEvidence(route);
      return;
    }
    await route.fulfill({ json: options.evidence ?? MOCK_EVIDENCE });
  });

  /**
   * `GET /api/quests/coverage` (task 6.10, read by story p6-11's header).
   *
   * Registered after the detail route (whose `**\/api/quests/*` glob matches this path) so the
   * most-recently-registered-match rule gives this handler the path — the same ordering the
   * evidence route above documents. The URL is recorded, so a spec can assert the header fetched
   * rather than rendered a constant.
   */
  await page.route('**/api/quests/coverage', async (route) => {
    recorded.coverageRequests += 1;
    recorded.urls.push(route.request().url());
    if (options.onCoverage !== undefined) {
      await options.onCoverage(route);
      return;
    }
    await route.fulfill({ json: options.coverage ?? MOCK_COVERAGE });
  });

  /**
   * `GET /api/quests/catalog` (task 6.10's worklist).
   *
   * The handler applies `?missing_only=1` to {@link MOCK_CATALOG_ROWS} exactly like the server's
   * SQL predicate does — the fixture is the *answer*, so the spec's narrowing assertion is about
   * the request the page made, not about the page filtering rows it already held.
   */
  await page.route('**/api/quests/catalog*', async (route) => {
    const url = new URL(route.request().url());
    recorded.catalogUrls.push(`${url.pathname}${url.search}`);
    recorded.urls.push(route.request().url());
    if (options.onCatalog !== undefined) {
      await options.onCatalog(route);
      return;
    }
    const missingOnly = url.searchParams.get('missing_only') === '1';
    const catalogRows = options.catalogRows ?? MOCK_CATALOG_ROWS;
    const filtered = missingOnly
      ? catalogRows.filter((row) => row.has_definition === 0)
      : catalogRows;
    await route.fulfill({
      json: {
        quests: filtered,
        total: filtered.length,
        missing_only: missingOnly,
        corpus: MOCK_COVERAGE.corpus,
      },
    });
  });

  /**
   * `POST /api/quests/scaffold` (task 6.8, driven by story p6-11's row action).
   *
   * Registered after `**\/api/quests` so it owns its own path; the body's outcome shape is the one
   * `docs/spec-api.md` L420-441 fixes, with the navigable `quest` skeleton.
   */
  await page.route('**/api/quests/scaffold', async (route) => {
    recorded.scaffoldPosts.push((route.request().postDataJSON() ?? {}) as Record<string, unknown>);
    if (options.onScaffold !== undefined) {
      await options.onScaffold(route);
      return;
    }
    const body = recorded.scaffoldPosts[recorded.scaffoldPosts.length - 1];
    const questName = typeof body.quest_name === 'string' ? body.quest_name : 'UNKNOWN';
    await route.fulfill({
      json: {
        quest_name: questName,
        link_kind: 'direct',
        title_key: null,
        has_definition_before: 0,
        outcome: 'created',
        action: 'create',
        file: `QuestTemplates/questtemplates_${questName}.json`,
        metadata: `QuestMetadatas/questmetadata_${questName}.json`,
        commit: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
        branch: settings.git_branch,
        commit_message: `spiraldb: scaffold quest ${questName}`,
        quest: { ...MOCK_QUEST, m_questName: questName },
      },
    });
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
