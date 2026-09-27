import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

/**
 * Story p5-01's tier-1 UI spec (plan task 5.1; decisions D40/D44, D27, D37, D81, Q1):
 * **the dashboard** — the four stat cards, the eight per-type progress bars, the activity
 * feed and its empty state.
 *
 * | the AC's words | arm | test |
 * |---|---|---|
 * | AC1 "the four stat cards' numbers equal `GET /api/dashboard` `overall`" | each card's `[data-stat]` equals the mocked body's `overall` | cards |
 * | AC1 "each per-type bar's fraction equals that type's summary" | each `[data-type-summary]` = `verified/total (pct%)`, hand-typed; plus one row's three segment widths | bars |
 * | AC1 "percentages computed to one decimal" | every percentage matches `/^\d+\.\d%$/` | cards + bars |
 * | AC1 / Q1 "GlobalRegistry excluded" | eight rows, no `[data-type="global_registry"]`, no "Global Registry" text | bars |
 * | AC2 "the 10 most recent `status_history` rows" | `?limit=10`, 12 seeded rows, the ten newest rendered in order | feed |
 * | AC2 "correct relative times and notes" | `<time>` text per row, the note in italics | feed |
 * | AC2 "clicking an entry navigates to that object's detail route" | all eight hrefs **and** two real clicks (one slash-bearing key) | click-through |
 * | AC2 "updates after a new status change without a full reload" | PATCH elsewhere → back to `/` → new feed row (document-load counter still 1) | update |
 * | AC3 "empty state renders when `status_history` is empty" | `{activity: [], unresolved: 0}` → shield + sentence + CTA | empty |
 * | AC3's failure mode | a 500 must show the error arm, **not** the empty state | empty-vs-error |
 *
 * ## Hermetic by construction (D81)
 *
 * One dispatcher answers every `/api/**` request from the fixtures below, so the run reaches
 * neither the dev stack's SQLite file nor the D17 clone — and, critically, the dashboard reads
 * the **tool's own database**, which holds 2,271 imported rows on a developer's machine and
 * nothing on CI. Every number and sentence this spec asserts therefore comes from a mock. The
 * wire contracts are copied literally (as in `status-integration.spec.ts`,
 * `object-mobile.spec.ts` and `global-registry-editor.spec.ts`): a fixture that imported
 * `client/src/lib/dashboard.ts` could only prove the client agrees with itself.
 *
 * The mocked surface is **stateful**: the PATCH moves the entry in the fixture's own store and
 * appends a feed row, so the `GET /api/activity` the page re-reads really carries the new
 * change. What that proves is the **client** half — that a transition invalidates and re-reads
 * the dashboard's two queries. The server half (`GET /api/activity`'s join, its limit ladder and
 * its `unresolved` count) is `tests/unit/activity.test.ts`, and the AC3 empty-state proof on a
 * real database is the D3 scratch-DB run recorded in `docs/evidence/phase-5/p5-01-*.md`.
 *
 * ## The accessible-name vocabulary this spec addresses
 *
 * headings level 2 — `Verification Progress by Type`, `Recent Activity` · `[data-stat]` =
 * `total|extracted|reviewed|verified` (the card's number, raw integer text) ·
 * `[data-stat-percent]` (the card's one-decimal percentage) · `[data-type]` / `[data-type-summary]`
 * (the per-type row, keyed by the D4 singular `object_type`) · `[data-segment]` = the three bar
 * segments · `[data-activity-id]` (one feed row) · `[data-unresolved]` (the feed's notice) · each
 * feed row's link is named `<key> <action text> <relative time>` (`DS-ACAD-C01-001 marked
 * reviewed 5 hours ago`) · `Try again` (both error arms) · the empty state's `Extract Quests`
 * link to `/quests/extract`.
 *
 * The two sections' visible labels are asserted through their **headings** rather than through
 * the data hooks, so a page that dropped the title would fail rather than pass on a hook.
 */

/* ------------------------------------------------------------------- fixtures */

type Status = 'extracted' | 'reviewed' | 'verified';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * The clock the fixtures are anchored to. Ages are whole units well away from every
 * `relativeTime` boundary, so the rendered labels are stable for the whole run (`2 hours ago`
 * would only become `3 hours ago` after an hour of test execution).
 */
const NOW = Date.now();
const at = (msAgo: number): string => new Date(NOW - msAgo).toISOString();

interface FamilyFixture {
  readonly objectType: string;
  readonly routeType: string;
  /** The API mount path (`/api/npc-inventories`) — the wire contract, spelled literally. */
  readonly urlPath: string;
  /** The frontend route (`/npc-inventories`) the feed links to and the page is mounted at. */
  readonly listPath: string;
  readonly label: string;
  readonly key: string;
  readonly rows: readonly string[];
  readonly document: Record<string, unknown>;
}

/** The eight tracked families, spelled as `shared/objectTypes.ts` and the URL table spell them. */
const FAMILIES: readonly FamilyFixture[] = [
  {
    objectType: 'quest',
    routeType: 'quests',
    urlPath: '/api/quests',

    listPath: '/quests',
    label: 'Quests',
    key: 'DS-ACAD-C01-001',
    rows: ['DS-ACAD-C01-001', 'DS-ACAD-C01-002'],
    document: { m_questName: 'DS-ACAD-C01-001', m_questLevel: 1, m_mainline: true, m_goals: [] },
  },
  {
    objectType: 'drop_table',
    routeType: 'drop_tables',
    urlPath: '/api/drop-tables',

    listPath: '/drop-tables',
    label: 'Drop Tables',
    key: 'KT-SPH3-C02-003',
    rows: ['KT-SPH3-C02-003'],
    document: { Name: 'KT-SPH3-C02-003', Items: [], Requirements: [] },
  },
  {
    objectType: 'npc_inventory',
    routeType: 'npc_inventories',
    urlPath: '/api/npc-inventories',

    listPath: '/npc-inventories',
    label: 'NPC Inventories',
    key: '87112',
    rows: ['87112'],
    document: { TemplateID: 87112, Inventory: [] },
  },
  {
    objectType: 'npc_spell_inventory',
    routeType: 'npc_spell_inventories',
    urlPath: '/api/npc-spell-inventories',

    listPath: '/npc-spell-inventories',
    label: 'NPC Spell Inventories',
    key: '99002',
    rows: ['99002'],
    document: { TemplateID: 99002, Spells: [] },
  },
  {
    objectType: 'creature_spellbook',
    routeType: 'creature_spellbooks',
    urlPath: '/api/creature-spellbooks',

    listPath: '/creature-spellbooks',
    label: 'Creature Spellbooks',
    key: 'Mdeck-L-BR-DS-SylviaDrake-A-50',
    rows: ['Mdeck-L-BR-DS-SylviaDrake-A-50'],
    document: { DeckName: 'Mdeck-L-BR-DS-SylviaDrake-A-50', SpellTemplateIds: [] },
  },
  {
    objectType: 'npc_drop_table',
    routeType: 'npc_drop_tables',
    urlPath: '/api/npc-drop-tables',

    listPath: '/npc-drop-tables',
    label: 'NPC Drop Tables',
    key: '12345',
    rows: ['12345'],
    document: { TemplateID: 12345, DropTableIds: [] },
  },
  {
    objectType: 'treasure_card_inventory',
    routeType: 'treasure_card_inventories',
    urlPath: '/api/treasure-card-inventories',

    listPath: '/treasure-card-inventories',
    label: 'Treasure Card Inventories',
    key: '38214',
    rows: ['38214'],
    document: { TemplateID: 38214, Spells: [] },
  },
  {
    objectType: 'zone_transfer',
    routeType: 'zone_transfers',
    urlPath: '/api/zone-transfers',

    listPath: '/zone-transfers',
    label: 'Zone Transfers',
    // Slash-bearing: the route encodes it (`WizardCity%2FWC_Hub`), which the click-through arm
    // exercises for real.
    key: 'WizardCity/WC_Hub',
    rows: ['WizardCity/WC_Hub'],
    document: { ZoneName: 'WizardCity/WC_Hub', Teleports: [] },
  },
];

/** The one detail route per family, hand-typed from docs/spec-api.md L456-474. */
const DETAIL_ROUTE: Record<string, string> = {
  quest: '/quests',
  drop_table: '/drop-tables',
  npc_inventory: '/npc-inventories',
  npc_spell_inventory: '/npc-spell-inventories',
  creature_spellbook: '/creature-spellbooks',
  npc_drop_table: '/npc-drop-tables',
  treasure_card_inventory: '/treasure-card-inventories',
  zone_transfer: '/zone-transfers',
};

/**
 * `GET /api/dashboard`'s eight buckets, written by hand. Their sums are the `overall` bucket
 * below (1,099 + 366 + 409 = 1,874), which is what lets the cards' arm claim "equal to the
 * API's `overall`" without the two fixtures being derived from each other.
 */
const TYPE_BUCKETS: Record<
  string,
  { total: number; extracted: number; reviewed: number; verified: number }
> = {
  quest: { total: 322, extracted: 45, reviewed: 120, verified: 157 },
  drop_table: { total: 180, extracted: 30, reviewed: 80, verified: 70 },
  npc_inventory: { total: 95, extracted: 10, reviewed: 40, verified: 45 },
  npc_spell_inventory: { total: 48, extracted: 8, reviewed: 20, verified: 20 },
  creature_spellbook: { total: 20, extracted: 5, reviewed: 5, verified: 10 },
  npc_drop_table: { total: 0, extracted: 0, reviewed: 0, verified: 0 },
  treasure_card_inventory: { total: 4, extracted: 1, reviewed: 1, verified: 2 },
  zone_transfer: { total: 1205, extracted: 1000, reviewed: 100, verified: 105 },
};

/**
 * The expected per-type summary text, one per family — `verified/total (percent%)`, computed by
 * hand (not by the client's function) so the assertion witnesses the spec's rule
 * (`157/322 (48.8%)`, L149-160) rather than restating an implementation.
 */
const TYPE_SUMMARY_TEXT: Record<string, string> = {
  quest: '157/322 (48.8%)',
  drop_table: '70/180 (38.9%)',
  npc_inventory: '45/95 (47.4%)',
  npc_spell_inventory: '20/48 (41.7%)',
  creature_spellbook: '10/20 (50.0%)',
  npc_drop_table: '0/0 (0.0%)',
  treasure_card_inventory: '2/4 (50.0%)',
  zone_transfer: '105/1205 (8.7%)',
};

/** The eight D4 singular types, hand-typed: the rows' order and their exact set. */
const TYPE_ORDER = [
  'quest',
  'drop_table',
  'npc_inventory',
  'npc_spell_inventory',
  'creature_spellbook',
  'npc_drop_table',
  'treasure_card_inventory',
  'zone_transfer',
];

/** The three status card percentages for {@link TYPE_BUCKETS}' overall (1099/366/409 of 1874). */
const CARD_PERCENT_TEXT = {
  extracted: '58.6%',
  reviewed: '19.5%',
  verified: '21.8%',
};

interface FeedSeed {
  readonly id: number;
  readonly objectType: string | null;
  readonly objectKey: string | null;
  readonly oldStatus: Status | null;
  readonly newStatus: Status;
  readonly notes: string | null;
  readonly changedBy: string;
  readonly ageMs: number;
}

/**
 * Twelve history rows, newest first — so `?limit=10` has something to cut (the two oldest) and
 * the feed's "most recent" claim is observable. Rows 4 and 3 are the two the join cannot
 * resolve: one with no parent at all, one whose type is outside D4's eight (Q1's registry, which
 * no route can patch — hand-written rows are the only way it exists).
 */
const FEED_SEEDS: readonly FeedSeed[] = [
  {
    id: 12,
    objectType: 'npc_inventory',
    objectKey: '87112',
    oldStatus: 'extracted',
    newStatus: 'reviewed',
    notes: 'Checked the vendor list.',
    changedBy: 'Mock Reviewer',
    ageMs: 2 * HOUR,
  },
  {
    id: 11,
    objectType: 'quest',
    objectKey: 'DS-ACAD-C01-001',
    oldStatus: 'extracted',
    newStatus: 'reviewed',
    notes: 'Gate-1 acceptance re-run.',
    changedBy: 'Jason',
    ageMs: 5 * HOUR,
  },
  {
    id: 10,
    objectType: 'drop_table',
    objectKey: 'KT-SPH3-C02-003',
    oldStatus: null,
    newStatus: 'extracted',
    notes: 'Imported from packet capture session_2026-09-24.json',
    changedBy: 'Jason',
    ageMs: 8 * HOUR,
  },
  {
    id: 9,
    objectType: 'zone_transfer',
    objectKey: 'WizardCity/WC_Hub',
    oldStatus: 'extracted',
    newStatus: 'reviewed',
    notes: 'Teleport targets verified against the live server.',
    changedBy: 'Mock Reviewer',
    ageMs: 12 * HOUR,
  },
  {
    id: 8,
    objectType: 'npc_spell_inventory',
    objectKey: '99002',
    oldStatus: 'extracted',
    newStatus: 'reviewed',
    notes: null,
    changedBy: 'Mock Reviewer',
    ageMs: 26 * HOUR,
  },
  {
    id: 7,
    objectType: 'creature_spellbook',
    objectKey: 'Mdeck-L-BR-DS-SylviaDrake-A-50',
    oldStatus: 'reviewed',
    newStatus: 'verified',
    notes: 'Deck confirmed in a live duel.',
    changedBy: 'Jason',
    ageMs: 2 * DAY,
  },
  {
    id: 6,
    objectType: 'npc_drop_table',
    objectKey: '12345',
    oldStatus: 'extracted',
    newStatus: 'reviewed',
    notes: null,
    changedBy: 'Mock Reviewer',
    ageMs: 3 * DAY,
  },
  {
    id: 5,
    objectType: 'treasure_card_inventory',
    objectKey: '38214',
    oldStatus: 'extracted',
    newStatus: 'reviewed',
    notes: null,
    changedBy: 'Mock Reviewer',
    ageMs: 4 * DAY,
  },
  {
    id: 4,
    objectType: null,
    objectKey: null,
    oldStatus: 'extracted',
    newStatus: 'verified',
    notes: 'orphaned history row',
    changedBy: 'Jason',
    ageMs: 5 * DAY,
  },
  {
    id: 3,
    objectType: 'global_registry',
    objectKey: 'GlobalRegistryValues',
    oldStatus: 'extracted',
    newStatus: 'reviewed',
    notes: 'hand-written row for an untracked family',
    changedBy: 'Jason',
    ageMs: 5 * DAY + HOUR,
  },
  {
    id: 2,
    objectType: 'quest',
    objectKey: 'DS-ACAD-C01-002',
    oldStatus: 'extracted',
    newStatus: 'extracted',
    notes: null,
    changedBy: 'Jason',
    ageMs: 6 * DAY,
  },
  {
    id: 1,
    objectType: 'drop_table',
    objectKey: 'KT-SPH3-C02-004',
    oldStatus: 'extracted',
    newStatus: 'extracted',
    notes: null,
    changedBy: 'Jason',
    ageMs: 7 * DAY,
  },
];

/* --------------------------------------------------------------------- the mock */

interface Recorded {
  dashboardRequests: number;
  /** Every `?limit=` the feed asked for (the feed must ask for 10). */
  activityLimits: number[];
  /** How many activity rows the last answer carried. */
  activityRowCounts: number[];
  patches: Array<Record<string, unknown>>;
  patchPaths: string[];
}

interface DashboardState {
  readonly recorded: Recorded;
  /** The live status per `${objectType}:${key}` — the PATCH moves it. */
  readonly statuses: Map<string, Status>;
  /** The feed's live rows, newest first — the PATCH prepends one. */
  readonly feed: FeedSeed[];
  /** How many documents the browser created — a full reload would raise this. */
  documentLoads: () => Promise<number>;
}

/** The one-percentage rule the mock's own `overall` uses (D37), written out here on purpose. */
const percent = (part: number, total: number): number =>
  total <= 0 ? 0 : Math.round((part / total) * 1000) / 10;

/**
 * One dispatcher for the whole `/api/**` surface. A single handler (rather than a dozen
 * `page.route` calls) is what makes the statefulness obvious: the PATCH writes the same maps the
 * status list and the feed read.
 */
async function mockDashboardApi(page: Page): Promise<DashboardState> {
  const statuses = new Map<string, Status>();
  const feed: FeedSeed[] = [...FEED_SEEDS];
  const recorded: Recorded = {
    dashboardRequests: 0,
    activityLimits: [],
    activityRowCounts: [],
    patches: [],
    patchPaths: [],
  };
  /** Every status move the PATCH applied, so the buckets can follow it. */
  const moves: Array<{ objectType: string; from: Status; to: Status }> = [];

  const statusOf = (objectType: string, key: string): Status =>
    statuses.get(`${objectType}:${key}`) ?? 'extracted';

  const bucketBody = (): Record<string, unknown> => {
    const types: Record<
      string,
      { total: number; extracted: number; reviewed: number; verified: number }
    > = {};
    for (const [objectType, bucket] of Object.entries(TYPE_BUCKETS)) {
      types[objectType] = { ...bucket };
    }
    for (const move of moves) {
      const bucket = types[move.objectType];
      if (bucket === undefined) {
        continue;
      }
      bucket[move.from] -= 1;
      bucket[move.to] += 1;
    }
    const overall = { total: 0, extracted: 0, reviewed: 0, verified: 0, percent_verified: 0 };
    for (const bucket of Object.values(types)) {
      overall.total += bucket.total;
      overall.extracted += bucket.extracted;
      overall.reviewed += bucket.reviewed;
      overall.verified += bucket.verified;
    }
    overall.percent_verified = percent(overall.verified, overall.total);
    return { types, overall };
  };

  /** A feed row as the wire carries it; `resolvable` mirrors the server's own rule. */
  const feedRow = (seed: FeedSeed): Record<string, unknown> => ({
    id: seed.id,
    object_type: seed.objectType,
    object_key: seed.objectKey,
    old_status: seed.oldStatus,
    new_status: seed.newStatus,
    notes: seed.notes,
    changed_by: seed.changedBy,
    changed_at: at(seed.ageMs),
  });

  /** `true` when the row names an object the client can link to (the server's predicate). */
  const resolvable = (seed: FeedSeed): boolean =>
    seed.objectType !== null &&
    seed.objectKey !== null &&
    FAMILIES.some((family) => family.objectType === seed.objectType);

  const entryRow = (family: FamilyFixture, key: string): Record<string, unknown> => ({
    object_type: family.objectType,
    object_key: key,
    status: statusOf(family.objectType, key),
    extracted_at: '2026-06-01T00:00:00.000Z',
    reviewed_at: null,
    verified_at: null,
    latest_notes: null,
  });

  await page.addInitScript(() => {
    // Runs once per document. A client-side route change (a `<Link>`, `navigate`) creates no new
    // document, which is exactly how the "without a full reload" arm is measured.
    const scope = window as unknown as { __dashboardLoads?: number };
    scope.__dashboardLoads = (scope.__dashboardLoads ?? 0) + 1;
  });

  await page.route(/\/api\//, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const body = (): Record<string, unknown> =>
      (request.postDataJSON() ?? {}) as Record<string, unknown>;
    const json = (payload: unknown): Promise<void> => route.fulfill({ json: payload });

    // ---- the shell's own boot reads (Header, the identity gate, the import toast).
    if (path === '/api/settings') {
      await json({
        aurorium_path: '/mock/aurorium',
        imcodec_path: '/mock/imcodec',
        spiraldb_path: '/mock/spiraldb',
        user_name: 'Mock Reviewer',
        git_branch: 'content/2026-09-27',
      });
      return;
    }
    if (path === '/api/sync/status') {
      await json({ last_sync: null, revision: null, status: 'never' });
      return;
    }
    if (path === '/api/sync/history') {
      await json({ history: [] });
      return;
    }
    if (path === '/api/status/_import') {
      await json({ ran: false, imported: 0, imported_at: null });
      return;
    }
    // The synced name tables the forms' dropdowns read (empty: tier-1 has no WAD data, D44).
    if (path.startsWith('/api/names/')) {
      const segments = path.slice('/api/names/'.length).split('/');
      if (segments.length === 1) {
        await json({ [segments[0] as string]: [] });
      } else {
        await route.fulfill({ status: 404, json: { error: 'no such name' } });
      }
      return;
    }

    // ---- the two reads this story adds to the dashboard.
    if (path === '/api/dashboard') {
      recorded.dashboardRequests += 1;
      await json(bucketBody());
      return;
    }
    if (path === '/api/activity') {
      const limit = Number(url.searchParams.get('limit') ?? '10');
      recorded.activityLimits.push(limit);
      // Newest first, then the window — the server's `changed_at DESC, id DESC` and its LIMIT.
      const window = feed.slice(0, limit);
      recorded.activityRowCounts.push(window.length);
      await json({
        activity: window.map(feedRow),
        unresolved: window.filter((seed) => !resolvable(seed)).length,
      });
      return;
    }

    // ---- the status surface (the detail pages' badges, the history panel, the PATCH).
    if (path.startsWith('/api/status/')) {
      const segments = path.slice('/api/status/'.length).split('/');
      const routeType = segments[0] ?? '';
      const family = FAMILIES.find((row) => row.routeType === routeType);
      if (family === undefined) {
        await route.fulfill({ status: 404, json: { error: `Unknown status type "${routeType}"` } });
        return;
      }
      if (segments.length === 1) {
        const entries = family.rows.map((key) => entryRow(family, key));
        await json({
          entries,
          summary: {
            total: entries.length,
            extracted: entries.filter((row) => row.status === 'extracted').length,
            reviewed: entries.filter((row) => row.status === 'reviewed').length,
            verified: entries.filter((row) => row.status === 'verified').length,
          },
        });
        return;
      }
      const key = decodeURIComponent(segments[1] as string);
      if (segments.length === 3 && segments[2] === 'history') {
        const history = feed
          .filter((seed) => seed.objectType === family.objectType && seed.objectKey === key)
          .slice()
          .reverse()
          .map((seed) => ({
            old_status: seed.oldStatus,
            new_status: seed.newStatus,
            notes: seed.notes,
            changed_by: seed.changedBy,
            changed_at: at(seed.ageMs),
          }));
        await json({ history });
        return;
      }
      if (method === 'PATCH') {
        const next = body().status as Status;
        const previous = statusOf(family.objectType, key);
        recorded.patches.push(body());
        recorded.patchPaths.push(path);
        statuses.set(`${family.objectType}:${key}`, next);
        moves.push({ objectType: family.objectType, from: previous, to: next });
        // The transition appends one `status_history` row: the newest feed entry.
        feed.unshift({
          id: Math.max(...feed.map((seed) => seed.id)) + 1,
          objectType: family.objectType,
          objectKey: key,
          oldStatus: previous,
          newStatus: next,
          notes: typeof body().notes === 'string' ? (body().notes as string) : null,
          changedBy: 'Mock Reviewer',
          ageMs: 0,
        });
        await json(entryRow(family, key));
        return;
      }
      await route.fulfill({ status: 404, json: { error: 'no such route' } });
      return;
    }

    // ---- the object surface: each family's list and one document.
    for (const family of FAMILIES) {
      if (path === family.urlPath) {
        const rows = family.rows.map((key) => ({
          key,
          title: key,
          modified_at: '2026-06-01T00:00:00.000Z',
          status: statusOf(family.objectType, key),
        }));
        await json({
          objects: rows,
          summary: {
            total: rows.length,
            extracted: rows.filter((row) => row.status === 'extracted').length,
            reviewed: rows.filter((row) => row.status === 'reviewed').length,
            verified: rows.filter((row) => row.status === 'verified').length,
          },
          skipped: [],
          missing_directory: false,
          duplicate_keys: [],
        });
        return;
      }
      if (
        path === `${family.urlPath}/${encodeURIComponent(family.key)}` ||
        path === `${family.urlPath}/${family.key}`
      ) {
        await json(family.document);
        return;
      }
    }

    await route.fulfill({ status: 404, json: { error: `unmocked ${method} ${path}` } });
  });

  return {
    recorded,
    statuses,
    feed,
    documentLoads: () =>
      page.evaluate(
        () => (window as unknown as { __dashboardLoads?: number }).__dashboardLoads ?? 0,
      ),
  };
}

/* ------------------------------------------------------------------ locators */

const main = (page: Page): Locator => page.getByRole('main');

/** One stat card's number / percentage. */
const stat = (page: Page, key: string): Locator => main(page).locator(`[data-stat="${key}"]`);
const statPercent = (page: Page, key: string): Locator =>
  main(page).locator(`[data-stat-percent="${key}"]`);

/** One per-type row, its summary text and its three bar segments. */
const typeSummary = (page: Page, objectType: string): Locator =>
  main(page).locator(`[data-type-summary="${objectType}"]`);
const typeRow = (page: Page, objectType: string): Locator =>
  main(page).locator(`[data-type="${objectType}"]`);

/** Every rendered feed row, in DOM order. */
const feedRows = (page: Page): Locator => main(page).locator('[data-activity-id]');

/** The sidebar's Dashboard link (a client-side navigation, never a document load). */
const dashboardNav = (page: Page): Locator =>
  page
    .getByRole('complementary', { name: 'Sidebar' })
    .getByRole('link', { name: 'Dashboard', exact: true });

/* ------------------------------------------------------------------- the arms */

test.describe('AC1 — the four stat cards', () => {
  test('every number equals GET /api/dashboard overall, to one decimal for the percentages', async ({
    page,
  }) => {
    const state = await mockDashboardApi(page);
    await page.goto('/');

    // The four cards carry the API's `overall` bucket, number for number. The fixture's own
    // sums are 1,099 + 366 + 409 = 1,874, asserted below through the cards.
    await expect(stat(page, 'total')).toHaveText('1874');
    await expect(stat(page, 'extracted')).toHaveText('1099');
    await expect(stat(page, 'reviewed')).toHaveText('366');
    await expect(stat(page, 'verified')).toHaveText('409');
    await expect(main(page).getByText('Total', { exact: true })).toBeVisible();
    await expect(main(page).getByText('Extracted', { exact: true })).toBeVisible();
    await expect(main(page).getByText('Reviewed', { exact: true })).toBeVisible();
    await expect(main(page).getByText('Verified', { exact: true })).toBeVisible();

    // …and the percentages are the one-decimal shares of that same total (the Verified card
    // shows the API's own `percent_verified`).
    await expect(statPercent(page, 'extracted')).toHaveText(CARD_PERCENT_TEXT.extracted);
    await expect(statPercent(page, 'reviewed')).toHaveText(CARD_PERCENT_TEXT.reviewed);
    await expect(statPercent(page, 'verified')).toHaveText(CARD_PERCENT_TEXT.verified);

    // Every percentage on the page is `d.d%` — never a whole number, never two decimals.
    const percents = await main(page).locator('[data-stat-percent]').allInnerTexts();
    expect(percents).toHaveLength(3);
    for (const text of percents) {
      expect(text, 'one decimal, always').toMatch(/^\d+\.\d%$/);
    }

    // One read of `GET /api/dashboard` feeds all four cards *and* the eight bars.
    expect(state.recorded.dashboardRequests).toBe(1);
  });
});

test.describe('AC1 — the per-type progress bars', () => {
  test('each bar’s fraction is that type’s own summary, and GlobalRegistry is absent', async ({
    page,
  }) => {
    await mockDashboardApi(page);
    await page.goto('/');

    await expect(
      main(page).getByRole('heading', { name: 'Verification Progress by Type', exact: true }),
    ).toBeVisible();

    // Exactly the eight D4 types, in the spec's drawing order — no ninth row, and in
    // particular no GlobalRegistry card or bar (Q1).
    await expect(main(page).locator('[data-type]')).toHaveCount(8);
    expect(
      await main(page)
        .locator('[data-type]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-type'))),
    ).toEqual(TYPE_ORDER);
    await expect(main(page).locator('[data-type="global_registry"]')).toHaveCount(0);
    await expect(main(page).getByText('Global Registry', { exact: true })).toHaveCount(0);

    for (const objectType of TYPE_ORDER) {
      await expect(typeSummary(page, objectType)).toHaveText(
        TYPE_SUMMARY_TEXT[objectType] as string,
      );
      await expect(
        typeRow(page, objectType).getByText(
          FAMILIES.find((family) => family.objectType === objectType)?.label as string,
          { exact: true },
        ),
      ).toBeVisible();
      // One decimal here too.
      const text = (await typeSummary(page, objectType).innerText()).trim();
      expect(text, objectType).toMatch(/^\d+\/\d+ \(\d+\.\d%\)$/);
    }

    // The bar's own geometry is the same summary: the quest row's three segments are
    // 45/322, 120/322 and 157/322 of the width — hand-computed, not re-derived here.
    await expect(typeRow(page, 'quest').locator('[data-segment="extracted"]')).toHaveAttribute(
      'style',
      /width:\s*14%/,
    );
    await expect(typeRow(page, 'quest').locator('[data-segment="reviewed"]')).toHaveAttribute(
      'style',
      /width:\s*37\.3%/,
    );
    await expect(typeRow(page, 'quest').locator('[data-segment="verified"]')).toHaveAttribute(
      'style',
      /width:\s*48\.8%/,
    );
  });
});

test.describe('AC2 — the activity feed', () => {
  test('asks for 10 rows, shows the ten most recent, with relative times, notes and action text', async ({
    page,
  }) => {
    const state = await mockDashboardApi(page);
    await page.goto('/');

    await expect(
      main(page).getByRole('heading', { name: 'Recent Activity', exact: true }),
    ).toBeVisible();

    // The endpoint's own contract: `?limit=10` (D27) — the page never asks for the whole table.
    expect(state.recorded.activityLimits).toEqual([10]);

    // Twelve rows are seeded; exactly ten render, newest first (ids 12…4 — the two oldest are
    // outside the window).
    await expect(feedRows(page)).toHaveCount(10);
    expect(
      await feedRows(page).evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-activity-id')),
      ),
    ).toEqual(['12', '11', '10', '9', '8', '7', '6', '5', '4', '3']);

    // Relative times come from the row's `changed_at`, never an absolute timestamp.
    const firstTime = feedRows(page).first().locator('time');
    await expect(firstTime).toHaveText('2 hours ago');
    await expect(firstTime).toHaveAttribute('dateTime', at(2 * HOUR));
    await expect(feedRows(page).nth(3).locator('time')).toHaveText('12 hours ago');
    await expect(feedRows(page).nth(4).locator('time')).toHaveText('1 day ago');
    await expect(feedRows(page).nth(5).locator('time')).toHaveText('2 days ago');

    // The action text: `marked <status>` for a transition, the bare status word for the row that
    // first tracked the entry (`old_status: null`).
    await expect(main(page).getByText('DS-ACAD-C01-001 marked reviewed')).toBeVisible();
    await expect(main(page).getByText('KT-SPH3-C02-003 extracted')).toBeVisible();

    // Notes render in italics below the entry; a row whose `notes` is null renders none.
    const note = main(page).getByText('Checked the vendor list.');
    await expect(note).toBeVisible();
    await expect(note).toHaveClass(/italic/);
    await expect(
      main(page).getByText('Imported from packet capture session_2026-09-24.json'),
    ).toBeVisible();
    await expect(main(page).locator('[data-activity-id="8"] p.italic')).toHaveCount(0);
    await expect(main(page).locator('[data-activity-id="12"] p.italic')).toHaveCount(1);

    // Unlinkable rows are shown *and* said out loud (the failure mode this arm exists for).
    await expect(main(page).locator('[data-unresolved="2"]')).toBeVisible();
    await expect(main(page).getByText('2 status changes in this feed')).toBeVisible();
    await expect(main(page).getByText('Unknown object')).toBeVisible();
    await expect(
      main(page).locator('[data-activity-id="4"]').getByText('— not linked'),
    ).toBeVisible();
    await expect(main(page).locator('[data-activity-id="4"]').getByRole('link')).toHaveCount(0);
  });

  test('every resolved row links to its own detail route — including the slash-bearing key', async ({
    page,
  }) => {
    await mockDashboardApi(page);
    await page.goto('/');

    // All eight families' rows carry the D4 route, built from the same `objectDetailPath` the
    // list pages use. Hand-typed expectations, so a guessed mapping fails here.
    for (const family of FAMILIES) {
      const seed = FEED_SEEDS.find((row) => row.objectType === family.objectType) as FeedSeed;
      const row = main(page).locator(`[data-activity-id="${seed.id}"]`);
      await expect(row.getByRole('link')).toHaveAttribute(
        'href',
        `${DETAIL_ROUTE[family.objectType]}/${encodeURIComponent(family.key)}`,
      );
    }

    // A real click on a simple family: the URL is the detail route and that family's page
    // mounted for that key (not a 404).
    await main(page).locator('[data-activity-id="12"]').getByRole('link').click();
    await expect(page).toHaveURL(/\/npc-inventories\/87112$/);
    await expect(main(page).getByRole('link', { name: /Back to NPC Inventories/ })).toBeVisible();
    await expect(main(page).locator('[title="87112"]').first()).toHaveText('87112');
    await expect(main(page).getByLabel('Status: Extracted')).toBeVisible();

    // …and a real click on the slash-bearing one, whose route encodes `/` as `%2F`: the encoded
    // form resolves to the right zone rather than to a 404.
    await dashboardNav(page).click();
    await main(page).locator('[data-activity-id="9"]').getByRole('link').click();
    await expect(page).toHaveURL(/\/zone-transfers\/WizardCity%2FWC_Hub$/);
    await expect(main(page).getByRole('link', { name: /Back to Zone Transfers/ })).toBeVisible();
    await expect(main(page).locator('[title="WizardCity/WC_Hub"]').first()).toHaveText(
      'WizardCity/WC_Hub',
    );
  });

  test('the feed updates after a new status change, without a full reload', async ({ page }) => {
    const state = await mockDashboardApi(page);
    await page.goto('/');
    await expect(feedRows(page)).toHaveCount(10);
    await expect(state.documentLoads()).resolves.toBe(1);

    const dashboardRequestsBefore = state.recorded.dashboardRequests;

    // Mark the npc inventory reviewed from its own detail page (the surface that owns the
    // action), reached through the feed itself.
    await main(page).locator('[data-activity-id="12"]').getByRole('link').click();
    await expect(page).toHaveURL(/\/npc-inventories\/87112$/);
    await main(page).getByRole('button', { name: 'Mark Reviewed' }).click();
    const dialog = page.getByRole('dialog', { name: 'Mark Reviewed' });
    await dialog.getByLabel('Notes (optional)').fill('Feed check after transition');
    await dialog.getByRole('button', { name: 'Mark Reviewed' }).click();
    await expect.poll(() => state.recorded.patches.length).toBe(1);
    expect(state.recorded.patches[0]).toEqual({
      status: 'reviewed',
      notes: 'Feed check after transition',
    });

    // Back to the dashboard **inside the SPA** — the sidebar link, not a goto.
    await dashboardNav(page).click();
    await expect(page).toHaveURL(/\/$/);

    // The new change is in the feed: the appended row is the newest, with the note that was
    // typed. (`unresolved` legitimately drops to 1 here: the window is ten rows and the oldest
    // unresolved row has fallen out of it — a fact about the feed, not a lost row. And the same
    // entry already has an older row two hours down, so these assertions address the *first*
    // row rather than the page: `getByText('87112 marked reviewed')` would legitimately match
    // both, which is the feed working, not a defect.)
    await expect(feedRows(page)).toHaveCount(10);
    const newest = feedRows(page).first();
    await expect(newest).toHaveAttribute('data-activity-id', '13');
    await expect(newest).toContainText('87112 marked reviewed');
    await expect(newest).toContainText('Feed check after transition');
    await expect(newest.locator('time')).toHaveText('just now');

    // The same settle invalidation reached the aggregate read, so the cards moved with it:
    // one row left `extracted` (1099 → 1098) and joined `reviewed` (366 → 367).
    await expect(stat(page, 'extracted')).toHaveText('1098');
    await expect(stat(page, 'reviewed')).toHaveText('367');
    expect(state.recorded.dashboardRequests).toBeGreaterThan(dashboardRequestsBefore);

    // …and none of that reloaded the document.
    expect(await state.documentLoads()).toBe(1);
  });

  test('shows the empty state when status_history is empty — and only then', async ({ page }) => {
    const state = await mockDashboardApi(page);
    // Empty history: the endpoint's own empty answer.
    state.feed.length = 0;
    await page.goto('/');

    await expect(
      main(page).getByText('No activity yet. Extract some quests to get started.'),
    ).toBeVisible();
    await expect(main(page).getByRole('link', { name: 'Extract Quests' })).toHaveAttribute(
      'href',
      '/quests/extract',
    );
    await expect(feedRows(page)).toHaveCount(0);
    await expect(main(page).locator('[data-unresolved]')).toHaveCount(0);
    // The cards and bars still render (a fresh database has zero buckets, not a broken page).
    await expect(stat(page, 'total')).toHaveText('1874');
    expect(await state.documentLoads()).toBe(1);
  });

  test('a failed activity read is an error, never the empty state', async ({ page }) => {
    await mockDashboardApi(page);
    await page.route('**/api/activity**', (route) =>
      route.fulfill({ status: 500, json: { error: 'activity is down' } }),
    );
    await page.goto('/');

    // The error arm, with the server's own message and a retry.
    await expect(main(page).getByRole('alert')).toHaveText('activity is down');
    await expect(main(page).getByRole('button', { name: 'Try again' })).toBeVisible();

    // The empty state's sentence and CTA must NOT stand in for a broken request — an empty feed
    // that only exists because the API failed is the AC's own named failure mode.
    await expect(
      main(page).getByText('No activity yet. Extract some quests to get started.'),
    ).toHaveCount(0);
    await expect(main(page).getByRole('link', { name: 'Extract Quests' })).toHaveCount(0);
    await expect(feedRows(page)).toHaveCount(0);

    // The cards are unaffected: the two reads are independent.
    await expect(stat(page, 'total')).toHaveText('1874');
  });
});
