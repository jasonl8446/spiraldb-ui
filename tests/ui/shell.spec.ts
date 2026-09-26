import { expect, test as base, type Locator, type Page } from '@playwright/test';

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
 * `/api/settings`, `/api/sync/status`, `/api/sync/history` and the three bulk name
 * tables (the stub pages mount the shared-components panel, which would otherwise
 * pull 79,835 real item rows) with fixed values. These specs test **our UI** —
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
 * The 12 sidebar items, copied from `docs/spec-ui-design.md` L73-93 on purpose:
 * a spec that imported `client/src/lib/routes.ts` could not catch a wrong nav
 * table, only a UI that disagreed with it.
 *
 * `phase` is the "Arrives in Phase N" text a stub route renders (Dashboard 5, the
 * eight data types 4, `/quests` 2 — `client/src/lib/routes.ts`). `/settings`
 * (p1-08), `/quests/extract` (p2-07) and `/quests` (p2-08) are real pages, so the
 * loop below asserts their own content instead of the stub text.
 */
const NAV_ITEMS = [
  { label: 'Dashboard', path: '/', title: 'Dashboard', phase: '5' },
  { label: 'Extract Quests', path: '/quests/extract', title: 'Extract Quests', phase: '2' },
  { label: 'Browse Quests', path: '/quests', title: 'Browse Quests', phase: '2' },
  { label: 'Drop Tables', path: '/drop-tables', title: 'Drop Tables', phase: '4' },
  { label: 'NPC Inventories', path: '/npc-inventories', title: 'NPC Inventories', phase: '4' },
  {
    label: 'NPC Spell Inventories',
    path: '/npc-spell-inventories',
    title: 'NPC Spell Inventories',
    phase: '4',
  },
  {
    label: 'Creature Spellbooks',
    path: '/creature-spellbooks',
    title: 'Creature Spellbooks',
    phase: '4',
  },
  { label: 'NPC Drop Tables', path: '/npc-drop-tables', title: 'NPC Drop Tables', phase: '4' },
  {
    label: 'Treasure Card Inventory',
    path: '/treasure-card-inventories',
    title: 'Treasure Card Inventory',
    phase: '4',
  },
  { label: 'Zone Transfers', path: '/zone-transfers', title: 'Zone Transfers', phase: '4' },
  { label: 'Global Registry', path: '/global-registry', title: 'Global Registry', phase: '4' },
  { label: 'Sync Friendly Names', path: '/settings', title: 'Settings', phase: '1' },
] as const;

/**
 * Collects every `console.error` and uncaught page error so the automatic
 * `afterEach` below can fail the test: the Phase-1 shell criterion is "no console
 * errors on the shell pages", and silently ignoring a category would hide exactly
 * the kind of breakage this suite exists to catch.
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

  // The stub pages mount `SharedComponentsPreview`, which bulk-loads these three
  // tables; unmocked they would return the developer's real synced rows.
  await page.route('**/api/names/items', (route) =>
    route.fulfill({ json: { items: [{ gid: 1001, name: 'Mock Item' }] } }),
  );
  await page.route('**/api/names/spells', (route) =>
    route.fulfill({ json: { spells: [{ template_id: 2002, name: 'Mock Spell' }] } }),
  );
  await page.route('**/api/names/npcs', (route) =>
    route.fulfill({ json: { npcs: [{ template_id: 3003, name: 'Mock NPC' }] } }),
  );

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

      // No dead stubs: every route renders real content — the Settings page and
      // the extraction page here, and for the rest the card that names the route
      // and the phase that builds it.
      if (item.path === '/settings') {
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
      } else {
        await expect(
          page.getByRole('main').getByText(`Arrives in Phase ${item.phase}`),
        ).toBeVisible();
        await expect(page.getByRole('main').getByText(item.path, { exact: true })).toBeVisible();
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
      page.getByRole('main').getByRole('heading', { level: 1, name: 'DS-ACAD-C01-001' }),
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
    await expect(page.getByRole('main').getByText('Arrives in Phase 4')).toBeVisible();
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
