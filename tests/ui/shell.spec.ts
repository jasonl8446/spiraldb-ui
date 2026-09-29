import { expect, test as base, type Locator, type Page } from '@playwright/test';

import { MOCK_COVERAGE } from './quests-mocks';

/**
 * Tier-1 shell spec (plan task 1.10, decision D23 tier 1).
 *
 * Drives the real app in headless chromium against the dev stack the config
 * auto-starts (`npm run dev`, `SPIRALDB_UI_SKIP_IMPORT=1`). It asserts the five
 * things task 1.10 names: every sidebar route is reachable, active nav
 * highlighting follows navigation, group collapse toggles, the header Sync button
 * shows a spinner and then a toast, and Settings renders its values.
 *
 * ## Every data call below is route-mocked on purpose — do not "fix" it into a real request
 *
 * CI has no sibling repositories, no `data/spiraldb-ui.db` and no WAD data, so the
 * specs may not depend on the developer's corpus: `mockShellApi()` fulfils
 * `/api/settings`, `/api/sync/status`, `/api/sync/history` and every route-specific
 * endpoint the pages below read, with fixed values. These specs test **our UI** —
 * layout, routing, highlighting, collapse, spinner/toast — not the sync engine or
 * the corpus: the real ~22 s sync is covered by the tier-2 browser evidence in
 * `docs/evidence/phase-1/story-p1-10.md` and by the sync unit tests.
 *
 * The one request deliberately left un-mocked is `GET /api/status/_import`: it is
 * asserted only to answer 200, which proves the Vite proxy and the Express half of
 * the dev stack are really up.
 */

/** Fixed values the mocked API answers with (counts chosen to be unambiguous in `toLocaleString`). */
const MOCK_SETTINGS = {
  aurorium_path: '/mock/aurorium',
  imcodec_path: '/mock/imcodec',
  spiraldb_path: '/mock/spiraldb',
  user_name: 'Mock Reviewer',
  git_branch: 'content/2026-09-26',
} as const;

const MOCK_SYNC_COUNTS = { items: 1234, spells: 56, npcs: 78, quests: 9, zones: 10 } as const;

/** `lib/toast.ts` `formatSyncCounts` output for {@link MOCK_SYNC_COUNTS}. */
const MOCK_COUNTS_LINE = '1,234 items · 56 spells · 78 NPCs · 9 quests · 10 zones';

const MOCK_SYNC_REVISION = 'V_r806919.Wizard_1_610';

/** The one row the mocked `GET /api/quests` answers with (story p2-08's pages). */
const MOCK_QUEST_ROW = {
  quest_name: 'DS-ACAD-C01-001',
  title: 'Mock Quest',
  title_key: null,
  title_source: 'rawKey',
  level: 1,
  goal_count: 2,
  is_mainline: true,
  modified_at: '2026-09-26T09:04:09.008Z',
  status: 'extracted',
} as const;

/**
 * The 13 sidebar items, copied from `docs/spec-ui-design.md` L73-93 on purpose:
 * a spec that imported `client/src/lib/routes.ts` could not catch a wrong nav
 * table, only a UI that disagreed with it.
 *
 * Every one of the 13 writes a real page now, and the loop below asserts each page's own
 * content: `/` (p5-01, the dashboard — the last stub to fall), `/settings` (p1-08),
 * `/quests/extract` (p2-07), `/quests` (p2-08), `/quests/catalog` (p6-11, the worklist),
 * `/npc-inventories` (p4-01), `/drop-tables`
 * (p4-02), `/npc-spell-inventories` + `/creature-spellbooks` (p4-03), `/npc-drop-tables` +
 * `/treasure-card-inventories` + `/zone-transfers` (p4-04…p4-06) and `/global-registry`
 * (p4-07, the editor itself).
 *
 * The rows used to carry the `phase` the stub would announce. They no longer do: no route
 * renders "Arrives in Phase N" any more, so the branch that read it became unreachable (and
 * TypeScript narrows it to `never`), the per-page assertions below are exhaustive by path,
 * and `phase` lives only in `APP_ROUTES` — where `tests/unit/ui-shell.test.ts` pins it.
 */
const NAV_ITEMS = [
  { label: 'Dashboard', path: '/', title: 'Dashboard' },
  { label: 'Extract Quests', path: '/quests/extract', title: 'Extract Quests' },
  { label: 'Browse Quests', path: '/quests', title: 'Browse Quests' },
  // Story p6-11 added the Catalog item to the QUESTS group (spec-ui-design.md L148-152), so the
  // list the loop below walks is extended with it rather than silently stopping at 12 pages.
  { label: 'Catalog', path: '/quests/catalog', title: 'Quest Catalog' },
  { label: 'Drop Tables', path: '/drop-tables', title: 'Drop Tables' },
  { label: 'NPC Inventories', path: '/npc-inventories', title: 'NPC Inventories' },
  {
    label: 'NPC Spell Inventories',
    path: '/npc-spell-inventories',
    title: 'NPC Spell Inventories',
  },
  { label: 'Creature Spellbooks', path: '/creature-spellbooks', title: 'Creature Spellbooks' },
  { label: 'NPC Drop Tables', path: '/npc-drop-tables', title: 'NPC Drop Tables' },
  {
    label: 'Treasure Card Inventory',
    path: '/treasure-card-inventories',
    title: 'Treasure Card Inventory',
  },
  { label: 'Zone Transfers', path: '/zone-transfers', title: 'Zone Transfers' },
  { label: 'Global Registry', path: '/global-registry', title: 'Global Registry' },
  { label: 'Sync Friendly Names', path: '/settings', title: 'Settings' },
] as const;

/**
 * Collects every `console.error` and uncaught page error so the automatic
 * `afterEach` below can fail the test: the Phase-1 shell criterion is "no console
 * errors on the shell pages", and silently ignoring a category would hide exactly
 * the kind of breakage this suite exists to catch.
 *
 * **How to read a failure here (p5-05's attribution of the console output the lead's
 * AC#9 axe run counted).** Two things on the editor pages are `console.error`-shaped and
 * are *not* defects; know them before blaming a new one on the shell:
 *
 * 1. `Failed to load resource: the server responded with a status of 404` — Chromium logs
 *    every non-2xx HTTP response this way, and three of them are **designed fallbacks**:
 *    `GET /api/names/strings/:key` miss (the raw-key title fallback, D59's documented 404),
 *    `GET /api/names/items/:id` miss (the single-id lookup for an id the synced list cannot
 *    resolve — 8 of the corpus's ids, D69), and `GET /api/status/:type/:key/history` for an
 *    entry with no tracking row yet. Measured on this suite's own pages: the shell routes it
 *    walks mock those endpoints, so **none of them appears here** — a 404 failing this guard
 *    on a shell route is a real new one, not a known fallback.
 * 2. `React Router Future Flag Warning: React Router will begin wrapping state updates in
 *    React.startTransition in v7 …` — a **warning**, so it does not trip this `type ===
 *    'error'` collector, but it is the only other thing these pages log.
 *
 * No allowlist is applied on purpose: the collector's own self-check (below) proves it can
 * fail, and adding a filter for responses this spec never makes would turn a strict guard
 * into a guessing game. Measure with `page.on('response', …)` before adding one.
 */
const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(`console.error: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    await use(errors);
  },
});

test.afterEach(async ({ page, consoleErrors }) => {
  // Console messages arrive asynchronously over CDP, so a page that logs at the very
  // end of a test body would land *after* this assertion without this round-trip
  // (measured: `page.evaluate(() => console.error('x'))` resolves before the message
  // is dispatched, and the array was still empty here). Flush, then assert.
  await page.evaluate(() => undefined).catch(() => undefined);
  expect(consoleErrors, 'the shell must log no console errors').toEqual([]);
});

/** The desktop navigation rail (the mobile copy only mounts while its dialog is open). */
function sidebarOf(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Sidebar' });
}

/** Every nav link the shell currently marks active (`blue-600/10` + `blue-400`). */
function activeNavLinks(sidebar: Locator): Locator {
  // Attribute substring, not a CSS class selector: the Tailwind class contains a
  // `/`, which CSS would require escaping.
  return sidebar.locator('a[class*="bg-blue-600/10"]');
}

/** One nav link, by its visible label. */
function navLink(sidebar: Locator, label: string): Locator {
  return sidebar.getByRole('link', { name: label, exact: true });
}

/**
 * One computed colour of a nav link. Assertions on it must poll: the item animates
 * from its idle colour (`transition-colors`), so a single sample taken right after
 * the click can catch an interpolated value.
 */
function computedColour(link: Locator, property: 'backgroundColor' | 'color'): Promise<string> {
  return link.evaluate((element, name) => getComputedStyle(element)[name], property);
}

/** Fixed answers for everything the shell reads as data (see the header comment). */
async function mockShellApi(page: Page): Promise<void> {
  await page.route('**/api/settings', (route) => route.fulfill({ json: MOCK_SETTINGS }));

  await page.route('**/api/sync/status', (route) =>
    route.fulfill({
      json: {
        last_sync: '2026-09-26T12:00:00.000Z',
        revision: MOCK_SYNC_REVISION,
        status: 'success',
      },
    }),
  );

  await page.route('**/api/sync/history', (route) =>
    route.fulfill({
      json: {
        history: [
          {
            id: 1,
            sync_timestamp: '2026-09-26T12:00:00.000Z',
            revision: MOCK_SYNC_REVISION,
            items_count: MOCK_SYNC_COUNTS.items,
            spells_count: MOCK_SYNC_COUNTS.spells,
            npcs_count: MOCK_SYNC_COUNTS.npcs,
            quests_count: MOCK_SYNC_COUNTS.quests,
            zones_count: MOCK_SYNC_COUNTS.zones,
            status: 'success',
            error_message: null,
          },
        ],
      },
    }),
  );

  // Story p5-08 removed the three `/api/names/{items,spells,npcs}` mocks that used to live
  // here. They existed for one reason only: the `SharedComponentsPreview` panel that the
  // "Arrives in Phase N" stub pages mounted, which bulk-loaded all three tables. Story p5-08
  // deleted both (no route renders a stub any more, so the panel was reachable from nowhere).
  // Nothing this file visits reads those tables: the only components that do are the detail
  // and editor forms, behind a `FriendlyNameDropdown`, and this file's routes are the 12
  // sidebar list routes plus `/`, `/quests/extract`, `/quests/:questName` and `/settings`.
  // The mocks' absence is observable in this file's own run rather than assumed.

  // Story p2-08 replaced the `/quests` and `/quests/:questName` stubs with real
  // pages: the browse list reads `GET /api/quests` and the detail page reads one
  // quest. Both are mocked here so the shell spec keeps its D23-tier-1 promise of
  // never touching the corpus. The browse page's own contract is
  // `tests/ui/quests-browse.spec.ts`; this file only needs the pages to render.
  await page.route('**/api/quests', (route) =>
    route.fulfill({
      json: {
        quests: [MOCK_QUEST_ROW],
        summary: { total: 1, extracted: 1, reviewed: 0, verified: 0 },
        skipped: [],
      },
    }),
  );
  await page.route('**/api/quests/*', (route) =>
    route.fulfill({
      json: { m_questName: 'DS-ACAD-C01-001', m_questLevel: 1, m_mainline: true },
    }),
  );

  // Story p6-11 gave the browse page and `/quests/catalog` a coverage header that reads
  // `GET /api/quests/coverage`, plus a catalog worklist read. Both are registered **after** the
  // `**/api/quests/*` branch above, whose glob would otherwise answer them with a bare quest
  // document (D81: mock every endpoint the page reads, not only the ones the assertions name).
  await page.route('**/api/quests/coverage', (route) => route.fulfill({ json: MOCK_COVERAGE }));
  await page.route('**/api/quests/catalog*', (route) =>
    route.fulfill({
      json: {
        quests: [
          {
            quest_name: 'DS-ACAD-C01-001',
            title: 'Wizard Tours',
            title_source: 'inferred',
            has_definition: 1,
            reference_count: 6,
          },
          {
            quest_name: 'DM-GRAVE-MAIN-008',
            title: 'Stakes and Stones',
            title_source: 'direct',
            has_definition: 0,
            reference_count: 19,
          },
        ],
        total: 2,
        missing_only: false,
        corpus: { spiraldb_path: '/mock/spiraldb', quest_files: 322 },
      },
    }),
  );

  // Story p4-05 replaced `/treasure-card-inventories`' stub with the real generic object list
  // (plan task 4.7), and this branch mocks the family's own endpoints — unlike the earlier
  // object families, whose branches read whatever the D17 clone happens to hold. The fixtures
  // are the real corpus's one entry (TemplateID 38214, the legacy file) plus its status row, so
  // the assertion below is the same on a developer's machine and on CI, where no clone exists.
  // The page's own contract is `tests/ui/treasure-card-inventory-editor.spec.ts`.
  await page.route('**/api/drop-tables', (route) =>
    route.fulfill({
      json: {
        objects: [
          {
            key: 'DS-ACAD-C01-001',
            title: 'DS-ACAD-C01-001',
            modified_at: '2026-09-24T15:22:00.000Z',
            status: 'extracted',
          },
        ],
        summary: { total: 1, extracted: 1, reviewed: 0, verified: 0 },
        skipped: [],
        missing_directory: false,
        duplicate_keys: [],
      },
    }),
  );
  await page.route('**/api/npc-inventories', (route) =>
    route.fulfill({
      json: {
        objects: [
          {
            key: '87112',
            title: '87112',
            modified_at: '2026-09-24T15:22:00.000Z',
            status: 'extracted',
          },
        ],
        summary: { total: 1, extracted: 1, reviewed: 0, verified: 0 },
        skipped: [],
        missing_directory: false,
        duplicate_keys: [],
      },
    }),
  );
  await page.route('**/api/npc-spell-inventories', (route) =>
    route.fulfill({
      json: {
        objects: [
          {
            key: '99002',
            title: '99002',
            modified_at: '2026-09-24T15:22:00.000Z',
            status: 'extracted',
          },
        ],
        summary: { total: 1, extracted: 1, reviewed: 0, verified: 0 },
        skipped: [],
        missing_directory: false,
        duplicate_keys: [],
      },
    }),
  );
  await page.route('**/api/creature-spellbooks', (route) =>
    route.fulfill({
      json: {
        objects: [
          {
            key: 'Mdeck-L-BR-DS-SylviaDrake-A-50',
            title: 'Mdeck-L-BR-DS-SylviaDrake-A-50',
            modified_at: '2026-09-24T15:22:00.000Z',
            status: 'extracted',
          },
        ],
        summary: { total: 1, extracted: 1, reviewed: 0, verified: 0 },
        skipped: [],
        missing_directory: false,
        duplicate_keys: [],
      },
    }),
  );
  // The four object families below (plus the absent-directory one) are mocked for the same reason
  // the treasure-card and zone families are: the shell spec must not depend on the developer's
  // corpus. `/api/drop-tables` asserted a real table header while reading the REAL endpoint, which
  // passes on a machine with the 317-file corpus and fails on CI (no corpus -> empty state -> no
  // header). Found by gate-4's CI run.
  await page.route('**/api/npc-drop-tables', (route) =>
    route.fulfill({
      json: {
        objects: [],
        summary: { total: 0, extracted: 0, reviewed: 0, verified: 0 },
        skipped: [],
        missing_directory: true,
        duplicate_keys: [],
      },
    }),
  );
  await page.route('**/api/treasure-card-inventories', (route) =>
    route.fulfill({
      json: {
        objects: [
          {
            key: '38214',
            title: '38214',
            modified_at: '2026-09-24T15:22:00.000Z',
            status: 'extracted',
          },
        ],
        summary: { total: 1, extracted: 1, reviewed: 0, verified: 0 },
        skipped: [],
        missing_directory: false,
        duplicate_keys: [],
      },
    }),
  );
  await page.route('**/api/status/treasure_card_inventories', (route) =>
    route.fulfill({
      json: {
        entries: [
          {
            object_type: 'treasure_card_inventory',
            object_key: '38214',
            status: 'extracted',
            extracted_at: '2026-09-24T15:22:00.000Z',
            reviewed_at: null,
            verified_at: null,
            latest_notes: null,
          },
        ],
        summary: { total: 1, extracted: 1, reviewed: 0, verified: 0 },
      },
    }),
  );

  // Story p4-06 replaced `/zone-transfers`' stub with the real generic object list (plan task
  // 4.8) and this branch mocks the family's own list + status endpoints (D73(g)): the rows are
  // the real corpus's shape — a `ZoneName` key with a slash. The real status route answers the
  // **1,205** `entry_status` rows the first-startup corpus import created (all `extracted`; the
  // brief said 0 rows for this family and that is measurably wrong — see the model's
  // `ZONE_TRANSFER_CORPUS.statusRows`), so the summary mirrors `total: 1205` and the two listed
  // keys carry their real status. Same on a developer's machine and on CI, where no clone exists.
  // The editor's own contract is `tests/ui/zone-transfer-editor.spec.ts`.
  await page.route('**/api/zone-transfers', (route) =>
    route.fulfill({
      json: {
        objects: [
          {
            key: 'WizardCity/WC_Hub',
            title: 'WizardCity/WC_Hub',
            modified_at: '2026-09-24T15:22:00.000Z',
            status: 'extracted',
          },
          {
            key: 'Karamelle/Interiors/KM_Z10_GobblertonFactory',
            title: 'Karamelle/Interiors/KM_Z10_GobblertonFactory',
            modified_at: '2026-09-24T15:22:00.000Z',
            status: 'extracted',
          },
        ],
        summary: { total: 2, extracted: 2, reviewed: 0, verified: 0 },
        skipped: [],
        missing_directory: false,
        duplicate_keys: [],
      },
    }),
  );
  await page.route('**/api/status/zone_transfers', (route) =>
    route.fulfill({
      json: {
        entries: [
          {
            object_type: 'zone_transfer',
            object_key: 'WizardCity/WC_Hub',
            status: 'extracted',
            extracted_at: '2026-09-24T15:22:00.000Z',
            reviewed_at: null,
            verified_at: null,
            latest_notes: null,
          },
          {
            object_type: 'zone_transfer',
            object_key: 'Karamelle/Interiors/KM_Z10_GobblertonFactory',
            status: 'extracted',
            extracted_at: '2026-09-24T15:22:00.000Z',
            reviewed_at: null,
            verified_at: null,
            latest_notes: null,
          },
        ],
        summary: { total: 1205, extracted: 1205, reviewed: 0, verified: 0 },
      },
    }),
  );

  // Story p4-07 replaced `/global-registry`' stub with the real **editor** (plan task 4.9) —
  // docs/spec-api.md L474 gives this family one route and it is the editor, because the directory
  // is one merged dictionary rather than a collection. So there is no list page to assert here:
  // the branch below asserts the editor's own chrome. Both endpoints are mocked (the family's
  // list — one row per FILE, keyed by the file stem — and the merged detail), so the assertion is
  // the same on a developer's machine and on CI, where no clone exists. The merged document is
  // the real corpus's shape: the wrapper plus its 23 mixed-case integer values, of which two are
  // shown. The editor's own contract is `tests/ui/global-registry-editor.spec.ts`.
  await page.route('**/api/global-registry', (route) =>
    route.fulfill({
      json: {
        objects: [
          {
            key: 'GlobalRegistryModels_1-A',
            title: 'GlobalRegistryModels_1-A',
            modified_at: '2026-09-24T15:22:00.000Z',
            status: null,
          },
        ],
        summary: null,
        skipped: [],
        missing_directory: false,
        duplicate_keys: [],
      },
    }),
  );
  await page.route('**/api/global-registry/*', (route) =>
    route.fulfill({
      json: {
        GlobalRegistryValues: { Localization: 1, Christmas: 0, Halloween: 0 },
      },
    }),
  );

  // Story p5-01 replaced `/`'s stub with the real dashboard (plan task 5.1), and both of
  // its reads are mocked here — the D81 rule this file already follows for every other
  // family. The dashboard is the one page that aggregates the **tool's own database**, so
  // an unmocked assertion would read 2,271 imported rows locally and nothing on CI.
  //
  // The fixture is the spec's own worked example (docs/spec-api.md L148-163): its
  // percentages are the ones the spec prints (`157/322 (48.8%)`, `70/180 (38.9%)`,
  // `45/95 (47.4%)`, overall `272/597 → 45.6`), which is what makes the branch's literals
  // independent of this file's own arithmetic. Seven type buckets are present because the
  // API always carries all eight (zeros included, D37) — the eighth is spelled out as
  // zeros so the assertion covers the "no rows yet" shape too.
  // The page's own contract is `tests/ui/dashboard.spec.ts`.
  await page.route('**/api/dashboard', (route) =>
    route.fulfill({
      json: {
        types: {
          quest: { total: 322, extracted: 45, reviewed: 120, verified: 157 },
          drop_table: { total: 180, extracted: 30, reviewed: 80, verified: 70 },
          npc_inventory: { total: 95, extracted: 10, reviewed: 40, verified: 45 },
          npc_spell_inventory: { total: 0, extracted: 0, reviewed: 0, verified: 0 },
          creature_spellbook: { total: 0, extracted: 0, reviewed: 0, verified: 0 },
          npc_drop_table: { total: 0, extracted: 0, reviewed: 0, verified: 0 },
          treasure_card_inventory: { total: 0, extracted: 0, reviewed: 0, verified: 0 },
          zone_transfer: { total: 0, extracted: 0, reviewed: 0, verified: 0 },
        },
        overall: {
          total: 597,
          extracted: 85,
          reviewed: 240,
          verified: 272,
          percent_verified: 45.6,
        },
      },
    }),
  );
  // One resolved row and one the join could not resolve, so the branch sees the feed's
  // real anatomy (dot, monospace key, action text, relative time, italic notes) *and* the
  // unresolved notice the server reports.
  await page.route('**/api/activity**', (route) =>
    route.fulfill({
      json: {
        activity: [
          {
            id: 3,
            object_type: 'quest',
            object_key: 'DS-ACAD-C01-001',
            old_status: 'extracted',
            new_status: 'reviewed',
            notes: 'Gate-1 acceptance re-run',
            changed_by: 'Mock Reviewer',
            changed_at: '2026-09-26T06:26:25.798Z',
          },
          {
            id: 1,
            object_type: null,
            object_key: null,
            old_status: 'extracted',
            new_status: 'reviewed',
            notes: 'gate-1 attempt before identity',
            changed_by: '',
            changed_at: '2026-09-23T06:23:17.332Z',
          },
        ],
        unresolved: 1,
      },
    }),
  );
}

test.beforeEach(async ({ page }) => {
  await mockShellApi(page);
});

test.describe('sidebar navigation', () => {
  test('every route is reachable, renders a real page, and highlights its item', async ({
    page,
  }) => {
    await page.goto('/');
    const sidebar = sidebarOf(page);

    for (const item of NAV_ITEMS) {
      await navLink(sidebar, item.label).click();

      await expect.poll(() => new URL(page.url()).pathname).toBe(item.path);
      await expect(page.getByRole('heading', { name: item.title, exact: true })).toBeVisible();

      // No dead stubs: every route renders real content. Each branch below asserts the
      // page's own literals, copied on purpose, with every endpoint the assertion depends
      // on mocked (D81) — so the branch passes on CI, where the tool's database is empty,
      // exactly as it does against a developer's corpus.
      if (item.path === '/') {
        // Story p5-01 replaced this route's stub with the real dashboard (plan task 5.1) —
        // the same phase transition p4-01…p4-07 recorded, so `phase` in the row above still
        // means the phase that *owns* the page. This is the last stub to fall: after it, no
        // route renders "Arrives in Phase N". Both of the dashboard's reads are mocked (see
        // `mockShellApi`), and the literals come from the spec's worked example
        // (docs/spec-api.md L148-163, spec-ui-design L135-179): the Total card's number, the
        // quest bar's fraction + one-decimal percentage, the feed's action text and its
        // unresolved notice. The page's own contract is `tests/ui/dashboard.spec.ts`.
        const main = page.getByRole('main');
        await expect(main.locator('[data-stat="total"]')).toHaveText('597');
        await expect(main.locator('[data-stat="verified"]')).toHaveText('272');
        await expect(main.locator('[data-stat-percent="verified"]')).toHaveText('45.6%');
        await expect(main.locator('[data-type-summary="quest"]')).toHaveText('157/322 (48.8%)');
        await expect(
          main.getByRole('heading', { name: 'Verification Progress by Type', exact: true }),
        ).toBeVisible();
        await expect(
          main.getByRole('heading', { name: 'Recent Activity', exact: true }),
        ).toBeVisible();
        await expect(main.getByText('DS-ACAD-C01-001 marked reviewed')).toBeVisible();
        await expect(main.getByText('1 status change in this feed')).toBeVisible();
      } else if (item.path === '/settings') {
        await expect(page.getByRole('main').getByText('Friendly Name Sync')).toBeVisible();
      } else if (item.path === '/quests/extract') {
        // Story p2-07 replaced this route's stub with the real page. The literal
        // is copied on purpose (see NAV_ITEMS above); `tests/ui/extraction.spec.ts`
        // owns the page's full contract.
        await expect(
          page.getByRole('main').getByText('Supported format: JSON packet capture files (.json)'),
        ).toBeVisible();
      } else if (item.path === '/quests') {
        // Story p2-08 replaced this route's stub with the real browse page. The
        // literals are copied on purpose; `tests/ui/quests-browse.spec.ts` owns the
        // page's full contract (columns, tabs, search, pagination, mobile).
        await expect(page.getByRole('main').getByPlaceholder('Search quests...')).toBeVisible();
        await expect(
          page.getByRole('main').getByRole('columnheader', { name: 'Quest Name' }),
        ).toBeVisible();
      } else if (item.path === '/quests/catalog') {
        // Story p6-11 replaced this route's placeholder with the worklist over the catalog. The
        // literals are copied on purpose; `tests/ui/quests-catalog.spec.ts` owns the page's full
        // contract (coverage header, filter, row actions). Both endpoints it reads are mocked in
        // `mockShellApi`, so this branch passes on CI where the catalog is empty (D81).
        await expect(page.getByRole('main').getByTestId('coverage-headline')).toHaveText(
          '322 defined of 1,717 nameable of ~4,823 quests the client holds text for' +
            ' — corpus: /mock/spiraldb (322 quest files)',
        );
        await expect(
          page.getByRole('main').getByRole('columnheader', { name: 'Defined' }),
        ).toBeVisible();
        await expect(
          page.getByRole('main').getByRole('checkbox', { name: 'missing only' }),
        ).toBeVisible();
      } else if (item.path === '/drop-tables') {
        // Story p4-02 replaced this route's stub with the real generic object list for
        // the DropTable family. The literals are copied on purpose;
        // `tests/ui/drop-table-editor.spec.ts` owns the detail editor's contract.
        await expect(
          page.getByRole('main').getByPlaceholder('Search drop tables...'),
        ).toBeVisible();
        await expect(
          page.getByRole('main').getByRole('columnheader', { name: 'Drop table' }),
        ).toBeVisible();
      } else if (item.path === '/npc-inventories') {
        // Story p4-01 replaced this route's stub with the real generic object list
        // (the one family the scaffolding is wired end to end for). The literals are
        // copied on purpose; `tests/ui/object-list.spec.ts` owns the page's full
        // contract (tabs, counts, search, pagination, cards, missing-directory empty
        // state).
        await expect(
          page.getByRole('main').getByPlaceholder('Search NPC inventories...'),
        ).toBeVisible();
        await expect(
          page.getByRole('main').getByRole('columnheader', { name: 'NPC' }),
        ).toBeVisible();
      } else if (item.path === '/npc-spell-inventories' || item.path === '/creature-spellbooks') {
        // Story p4-03 replaced these two routes' stubs with the real generic object
        // lists (plan tasks 4.4/4.5). Same shape as the branch above: the list page is
        // one component, so the literals are per-family props, and
        // `tests/ui/simple-object-editors.spec.ts` owns the detail editors' contracts.
        const expected =
          item.path === '/npc-spell-inventories'
            ? { placeholder: 'Search NPC spell inventories...', column: 'NPC' }
            : { placeholder: 'Search creature spellbooks...', column: 'Deck name' };
        await expect(page.getByRole('main').getByPlaceholder(expected.placeholder)).toBeVisible();
        await expect(
          page.getByRole('main').getByRole('columnheader', { name: expected.column }),
        ).toBeVisible();
      } else if (item.path === '/npc-drop-tables') {
        // Story p4-06 replaced this route's stub with the real generic object list for the
        // family whose directory genuinely does not exist (plan task 4.6) — the same phase
        // transition p4-02/p4-03 recorded, and `phase` in the row above still means the phase
        // that owns the page. The search field renders whatever the row set is, so it is the
        // branch's stable literal; with no `NpcDropTable/` in the clone there are no rows, so
        // the page renders its empty state instead of a table and says why (AC1's clause, here
        // against the real stack rather than a mock). `tests/ui/npc-drop-table-editor.spec.ts`
        // owns the editor's contract.
        await expect(
          page.getByRole('main').getByPlaceholder('Search NPC drop tables...'),
        ).toBeVisible();
        await expect(page.getByRole('main').getByText('No NPC drop tables found.')).toBeVisible();
        await expect(
          page.getByRole('main').getByText(/The NpcDropTable\/ directory does not exist/),
        ).toBeVisible();
      } else if (item.path === '/treasure-card-inventories') {
        // Story p4-05 replaced this route's stub with the real generic object list (plan task
        // 4.7) — the phase transition p4-02/p4-03/p4-06 recorded, so `phase` in the row above
        // still means the phase that *owns* the page. Unlike those branches this one is fully
        // mocked (see `mockShellApi`), so it asserts the populated shape rather than whatever
        // the D17 clone holds: the family's own search field, its key column, and the one real
        // entry's key. `tests/ui/treasure-card-inventory-editor.spec.ts` owns the editor.
        await expect(
          page.getByRole('main').getByPlaceholder('Search treasure card inventories...'),
        ).toBeVisible();
        await expect(
          page.getByRole('main').getByRole('columnheader', { name: 'NPC' }),
        ).toBeVisible();
        await expect(
          page.getByRole('main').getByRole('link', { name: '38214', exact: true }),
        ).toBeVisible();
      } else if (item.path === '/zone-transfers') {
        // Story p4-06 replaced this route's stub with the real generic object list (plan task
        // 4.8) — the same phase transition p4-02/p4-03/p4-04/p4-05 recorded, so `phase` in the
        // row above still means the phase that *owns* the page. Like the p4-05 branch it mocks
        // its own endpoints (D73(g)), so it asserts the populated shape rather than whatever the
        // D17 clone holds: the family's search field, its key column and both real-shaped keys —
        // one of them carrying the `/` the filename convention writes as `_`.
        // `tests/ui/zone-transfer-editor.spec.ts` owns the editor's contract.
        await expect(
          page.getByRole('main').getByPlaceholder('Search zone transfers...'),
        ).toBeVisible();
        await expect(
          page.getByRole('main').getByRole('columnheader', { name: 'Zone' }),
        ).toBeVisible();
        await expect(
          page.getByRole('main').getByRole('link', { name: 'WizardCity/WC_Hub', exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('main').getByRole('link', {
            name: 'Karamelle/Interiors/KM_Z10_GobblertonFactory',
            exact: true,
          }),
        ).toBeVisible();
      } else if (item.path === '/global-registry') {
        // Story p4-07 replaced this route's stub with the real **editor** (plan task 4.9) — the
        // same phase transition p4-01…p4-06 recorded, so `phase` in the row above still means the
        // phase that *owns* the page. It is the one family whose route is the editor rather than
        // a list (docs/spec-api.md L474), so this branch asserts the editor's own literals: the
        // merged table and the pre-save disclosure naming the file the save replaces. Like the
        // p4-05/p4-06 branches it mocks its own endpoints (D73(g)).
        // `tests/ui/global-registry-editor.spec.ts` owns the editor's contract.
        await expect(
          page.getByRole('main').getByRole('list', { name: 'Registry values' }),
        ).toBeVisible();
        await expect(page.getByRole('main').locator('[data-consolidation="1"]')).toContainText(
          'GlobalRegistryModels_1-A.json',
        );
      } else {
        // Unreachable, and that is the assertion's point: every sidebar route has a branch
        // above (`item` is narrowed to `never` in this position — a missing branch is a
        // compile error, not a runtime surprise). Story p5-01 removed the last stub page, so
        // the guard below now asserts the *absence* of stub text: a future sidebar entry added
        // without its own branch fails here loudly instead of passing on the heading alone.
        await expect(page.getByRole('main').getByText(/Arrives in Phase \d/)).toHaveCount(0);
      }

      // Exactly one item is highlighted, and it is the one that was clicked — the
      // highlight is `activeNavPath(pathname)`, a single value, so a prefix match can
      // never light up a second item (`/quests/extract` used to light up `/quests` too;
      // see the nested-route test below for the regression cover).
      await expect(activeNavLinks(sidebar)).toHaveCount(1);
      const active = navLink(sidebar, item.label);
      await expect(active).toHaveClass(/bg-blue-600\/10/);
      await expect(active).toHaveClass(/text-blue-400/);

      // …and the colour really is the spec's blue-600/10 + blue-400, not only a class.
      await expect
        .poll(() => computedColour(active, 'backgroundColor'), {
          message: `${item.label} background`,
        })
        .toMatch(/rgba?\(37, ?99, ?235/);
      await expect
        .poll(() => computedColour(active, 'color'), { message: `${item.label} text colour` })
        .toMatch(/rgb\(96, ?165, ?250\)/);
    }
  });

  test('collapsing a group hides its items and flips aria-expanded', async ({ page }) => {
    await page.goto('/');
    const sidebar = sidebarOf(page);
    const dataGroup = sidebar.getByRole('button', { name: 'DATA', exact: true });
    const dropTables = navLink(sidebar, 'Drop Tables');

    await expect(dataGroup).toHaveAttribute('aria-expanded', 'true');
    await expect(dropTables).toBeVisible();

    await dataGroup.click();
    await expect(dataGroup).toHaveAttribute('aria-expanded', 'false');
    // The list is unmounted, not merely hidden.
    await expect(dropTables).toHaveCount(0);
    // Other groups are untouched.
    await expect(navLink(sidebar, 'Dashboard')).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'OVERVIEW', exact: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    await dataGroup.click();
    await expect(dataGroup).toHaveAttribute('aria-expanded', 'true');
    await expect(dropTables).toBeVisible();
  });

  test('a nested route highlights exactly one item — itself, or the list item that owns it', async ({
    page,
  }) => {
    // Regression cover for the defect story p1-13 found and pinned: the sidebar used
    // react-router's `NavLink`, whose `isActive` prefix-matches, so `/quests/extract`
    // highlighted `/quests/extract` **and** `/quests`. `docs/spec-ui-design.md` L85-89
    // describes one active item, so that was a genuine shell defect. The highlight now
    // comes from `activeNavPath(pathname)`.
    //
    // Both halves matter, because the fix must not be "add `end` everywhere": a detail
    // route has no nav item of its own and has to keep highlighting the list item it
    // belongs to.
    await page.goto('/quests/extract');
    const sidebar = sidebarOf(page);

    // An exact nav-path match owns the pathname…
    await expect(activeNavLinks(sidebar)).toHaveCount(1);
    await expect(navLink(sidebar, 'Extract Quests')).toHaveClass(/bg-blue-600\/10/);
    await expect(navLink(sidebar, 'Browse Quests')).not.toHaveClass(/bg-blue-600\/10/);
    // …and only that one item carries the `aria-current` the highlight reflects.
    await expect(navLink(sidebar, 'Extract Quests')).toHaveAttribute('aria-current', 'page');
    await expect(navLink(sidebar, 'Browse Quests')).not.toHaveAttribute('aria-current', 'page');

    // A quest detail route is owned by the list item it belongs to — exactly one active.
    await page.goto('/quests/DS-ACAD-C01-001');
    await expect(page.getByRole('heading', { name: 'Quest Detail', exact: true })).toBeVisible();
    // …and story p2-08's real detail page renders for that URL (its own contract is
    // in `tests/ui/quests-detail.spec.ts`); the heading above is the shell's.
    await expect(
      page.getByRole('main').getByRole('heading', { level: 2, name: 'DS-ACAD-C01-001' }),
    ).toBeVisible();

    await expect(activeNavLinks(sidebar)).toHaveCount(1);
    await expect(navLink(sidebar, 'Browse Quests')).toHaveClass(/bg-blue-600\/10/);
    await expect(navLink(sidebar, 'Extract Quests')).not.toHaveClass(/bg-blue-600\/10/);
    await expect(navLink(sidebar, 'Browse Quests')).toHaveAttribute('aria-current', 'page');
    await expect(navLink(sidebar, 'Extract Quests')).not.toHaveAttribute('aria-current', 'page');
  });

  test('a non-root deep link is served the SPA shell, and an unknown path is the SPA 404', async ({
    page,
  }) => {
    // A hard navigation (not a client-side click) straight to a non-root route:
    // the dev server must answer 200 with the SPA shell, never a server 404.
    const response = await page.goto('/drop-tables');
    expect(response?.status()).toBe(200);

    const sidebar = sidebarOf(page);
    await expect(sidebar).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Drop Tables', exact: true })).toBeVisible();
    // Story p4-02 replaced this route's stub with the real list page.
    await expect(page.getByRole('main').getByPlaceholder('Search drop tables...')).toBeVisible();
    await expect(activeNavLinks(sidebar)).toHaveCount(1);
    await expect(navLink(sidebar, 'Drop Tables')).toHaveClass(/bg-blue-600\/10/);

    // A genuinely unknown path is the SPA's own 404 page, not a server error.
    const missing = await page.goto('/definitely-not-a-route');
    expect(missing?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Not found', exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByText('No route matches this path.')).toBeVisible();
  });
});

test.describe('header sync', () => {
  test('the Sync button spins while the request is in flight, then toasts the counts', async ({
    page,
  }) => {
    // Hold the mocked request open so the in-flight state is asserted
    // deterministically rather than raced against a timer.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/sync', async (route) => {
      await held;
      await route.fulfill({
        json: {
          status: 'success',
          synced: MOCK_SYNC_COUNTS,
          timestamp: '2026-09-26T12:00:00.000Z',
        },
      });
    });

    await page.goto('/');
    const sync = page.getByRole('button', { name: 'Sync friendly names' });
    await expect(sync).toBeEnabled();

    await sync.click();

    // In flight: disabled, "Syncing…", and the animated loader icon (spec L108).
    await expect(sync).toBeDisabled();
    await expect(sync).toContainText('Syncing…');
    await expect(sync.locator('svg.lucide-loader-circle.animate-spin')).toBeVisible();

    release();

    // Done: the success toast carries the counts the API returned…
    await expect(page.getByText(`Sync complete: ${MOCK_COUNTS_LINE}`)).toBeVisible();
    // …and the button swaps the spinner for the success checkmark.
    await expect(sync.locator('svg.lucide-check')).toHaveClass(/text-emerald-400/);
  });
});

test.describe('settings', () => {
  test('renders the settings values, the last sync and the history', async ({ page }) => {
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByLabel('Aurorium Path')).toHaveValue(MOCK_SETTINGS.aurorium_path);
    await expect(page.getByLabel('Imcodec Path')).toHaveValue(MOCK_SETTINGS.imcodec_path);
    await expect(page.getByLabel('SpiralDB Path')).toHaveValue(MOCK_SETTINGS.spiraldb_path);
    await expect(page.getByLabel('User Name')).toHaveValue(MOCK_SETTINGS.user_name);
    // The same mocked `settings` feeds the header's user area.
    await expect(page.getByText(MOCK_SETTINGS.user_name, { exact: true })).toBeVisible();

    // Last Sync reads `GET /api/sync/status`; the Results line and the history
    // table both read the mocked history row.
    await expect(page.getByText(MOCK_SYNC_REVISION).first()).toBeVisible();
    await expect(page.getByText(MOCK_COUNTS_LINE).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Success' })).toBeVisible();
  });

  test('shows git_branch as a read-only information row (story p2-09, D42)', async ({ page }) => {
    const puts: Array<Record<string, unknown>> = [];
    // Registered after the shared mock, so it wins for this test's settings calls.
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() === 'PUT') {
        puts.push((route.request().postDataJSON() ?? {}) as Record<string, unknown>);
      }
      await route.fulfill({ json: MOCK_SETTINGS });
    });

    await page.goto('/settings');

    // D42: `git_branch` is returned by `GET /api/settings` (D32) but the Phase 1 UI
    // rendered nothing for it. Story p2-09 surfaces it — **read-only**, because the
    // save pipeline generates it (`content/YYYY-MM-DD`, spec-data-model L206-214) and
    // a hand-edited value would redirect every following commit off that strategy.
    const branch = page.getByLabel('Git Branch');
    await expect(branch).toHaveValue(MOCK_SETTINGS.git_branch);
    await expect(branch).toHaveAttribute('readonly', '');
    await expect(
      page.getByText(/Set automatically when a save creates this session's/),
    ).toBeVisible();
    await expect(page.getByText('content/YYYY-MM-DD')).toBeVisible();

    // Read-only in fact, not only in appearance: the row never joins `edits`, so
    // saving the editable fields cannot carry `git_branch` into the `PUT` body.
    await page.getByLabel('User Name').fill('Someone Else');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => puts.length).toBe(1);
    expect(puts[0]).toEqual({ user_name: 'Someone Else' });
  });
});

test('the dev stack answers a real API request through the Vite proxy', async ({ page }) => {
  // `_import` is the one endpoint left un-mocked (see the header comment): a 200
  // here means Vite, its `/api` proxy and Express are all up.
  const answered = page.waitForResponse(
    (response) => new URL(response.url()).pathname === '/api/status/_import',
  );
  await page.goto('/');
  const response = await answered;
  expect(response.status()).toBe(200);
  expect(response.request().method()).toBe('GET');

  // **A 200 is not an identity.** The unattended review (DR-12) parked a decoy HTTP server on
  // `3001` answering `{"decoy":true}` to everything: this arm passed against it, and eleven
  // readiness polls plus six real API reads from the running UI were served by the decoy while the
  // whole suite stayed green. So this arm now also asserts *this app's* body: with
  // `SPIRALDB_UI_SKIP_IMPORT=1` (the harness's own env) the import cannot have run, and the
  // endpoint reports that plus the counters. Any other listener fails here.
  const body = (await response.json()) as { ran?: unknown; imported?: unknown };
  expect(body.ran, 'the real import-status body, not any 200-answering listener').toBe(false);
  expect(typeof body.imported, 'the import counter the real route reports').toBe('number');
});
test.describe('harness self-check', () => {
  test('the console-error guard itself is live', async ({ page, consoleErrors }) => {
    // Guards the guard: if the fixture wiring or the CDP flush in the afterEach
    // above ever stopped working, every test in this file would silently stop
    // checking console errors — a deliberate one must be caught.
    await page.goto('/');
    await page.evaluate(() => {
      console.error('guard self-check');
    });
    await expect.poll(() => [...consoleErrors]).toContain('console.error: guard self-check');
    // Consume it, so the shared afterEach assertion stays meaningful for this test.
    consoleErrors.length = 0;
  });
});
