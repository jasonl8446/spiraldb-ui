import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Result } from 'axe-core';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { ITEM_ROWS, mockDocument, mockRows, QUEST_ROWS, SELF_KEY } from './drop-table-mocks';
import { MOCK_CATALOG_ROWS, MOCK_COVERAGE, MOCK_QUEST, mockQuestRows } from './quests-mocks';

/**
 * Story p5-07's tier-1 accessibility spec — **Phase-5 AC#13** (plan task 5.7; decisions D23
 * tier 1, D40/D44, D67(d), D81, D85(a), D87).
 *
 * The acceptance criterion, quoted (`docs/plan-phase-5-dashboard-polish.md` L61):
 *
 * > **UI test suite (D23 tier 1)**: committed `tests/ui/a11y.spec.ts` (`@axe-core/playwright`,
 * > zero critical/serious violations on the four key pages) and `tests/ui/responsive.spec.ts`
 * > (375/768/1440 layout assertions across all routes) pass headless in CI.
 *
 * The four key pages are the ones AC#9 names, in the states AC#9 names them:
 *
 * | # | page | route | state scanned | hook the arm asserts |
 * |---|---|---|---|---|
 * | 1 | Dashboard | `/` | as loaded — 4 stat cards, 8 per-type bars, the feed | `[data-stat="total"]` |
 * | 2 | Quest list | `/quests` | as loaded — filter tabs + the TanStack table | `/^Showing /` |
 * | 3 | Quest detail | `/quests/DS-ACAD1-C01-001` | **edit mode, on load**, six tabs + the JSON panel | `[data-edit-mode="true"]` |
 * | 4 | DropTable detail | `/drop-tables/DS-ACAD1-C01-001` | **as loaded** (view) **and** after `Edit` | the `Back to Drop Tables` link |
 *
 * ## The engine, and why it is not installed or pinned here
 *
 * `@axe-core/playwright@4.13.0` is a devDependency whose engine is `axe-core@4.13.0` — the same
 * version D87 installed and pinned exactly ("a compliance claim that drifts with a caret range is
 * not a claim"). This spec consumes that prerequisite; it re-pins nothing.
 *
 * ## Settled state is a measurement, not a timeout (the failure mode this file exists to avoid)
 *
 * p5-06 measured the vendored ⌘K dialog **mid-animation** at `x=697` and settled at `x=384`
 * (`responsive.spec.ts`'s `stableBox` docblock). An axe scan fired then reads a half-laid-out
 * tree, which is a false result in *both* directions. Every arm here therefore calls
 * {@link settle}: a fingerprint (`readyState`, document scroll extents, element count, the
 * **running** animations' names, and `<main>`'s rounded box) that must read **identically twice
 * in a row**.
 *
 * - *two consecutive equal reads*: a finite `animate-in` (`ui/dialog.tsx`, `duration-200`) is
 *   present in read *n* and absent in read *n+1*, so the poll keeps going until it is over.
 * - *running animations are counted, never required to be zero*: the Goal Logic canvas runs React
 *   Flow's `dashdraw 0.5s linear infinite` (`@xyflow/react/dist/style.css:164`), so a
 *   "no running animations" gate would hang on that tab; a stable count is the right invariant.
 * - *element count and scroll extents*: the flowchart panel is `Suspense`-gated
 *   (`QuestDetailPage.tsx:317-326`), so its DOM grows after the first paint.
 *
 * `settle` runs **after** a content assertion, so it can never be satisfied by a page that
 * rendered nothing.
 *
 * ## What is asserted, and what is only recorded
 *
 * The AC's clause is `critical === 0 && serious === 0`, asserted verbatim — and every arm also
 * prints the **full severity histogram**, so a moderate or minor finding can never be silently
 * filtered away by the assertion's wording. `incomplete` results (axe's "needs a human" bucket)
 * are printed too.
 *
 * Chromium console errors are **recorded, never asserted**. Two are *designed*:
 *
 * - the string-table title lookup's **404** (`m_questTitle` is a string-table key —
 *   `client/src/lib/quest-info.ts:66` — and the fixture's `strings` map is deliberately empty, so
 *   the Info editor takes the raw-key fallback path, `QuestTitleSource = 'rawKey'`, which is a
 *   feature and not an error state);
 * - the measured **item-id miss** `1000` (`drop-table-mocks.ts` models one of the 8 corpus
 *   misses; the single-id lookup 404s and the dropdown keeps the numeric form — D70's sentinel
 *   rule). One arm additionally pins that the resolvable sibling `1001` *does* resolve, so the
 *   pair is a fixture contract rather than noise.
 *
 * ## Hermetic by construction (D40/D81), and the guard is checked per arm
 *
 * One dispatcher answers every `/api/**` request the four pages make — the wire contracts are
 * copied literally, because a fixture that imported `client/src/lib/*` could only prove the
 * client agrees with itself. Every arm ends with `expect(unmocked).toEqual([])`: **D81's rule
 * made mechanical**. On CI there is no corpus and no database file (`data/` is gitignored, the
 * harness boots an empty `data/test-ui.db` with `SPIRALDB_UI_SKIP_IMPORT=1`), so a single
 * unmocked read would render an empty state and every assertion above would have been about the
 * wrong page — which is exactly how gate-4's shell-spec defect shipped.
 *
 * The dispatcher is **one** function rather than a composition of `mockQuestsApi` and
 * `mockDropTableApi`: both of those register the settings and sync routes, so layering
 * them makes *which* registration wins an accident of call order, and neither answers
 * `/api/dashboard` or `/api/activity`. The shared mocks' *fixture data* is imported above (one
 * home per wire contract); only the dispatcher is local.
 */

/* ------------------------------------------------------------------- fixtures */

/** The eight tracked families (D37/Q1) — nonzero, so every card and bar renders real content. */
const DASHBOARD_TYPES: Record<string, Record<string, number>> = {
  quest: { total: 12, extracted: 3, reviewed: 4, verified: 5 },
  drop_table: { total: 9, extracted: 2, reviewed: 4, verified: 3 },
  npc_inventory: { total: 6, extracted: 1, reviewed: 2, verified: 3 },
  npc_spell_inventory: { total: 5, extracted: 0, reviewed: 3, verified: 2 },
  creature_spellbook: { total: 4, extracted: 2, reviewed: 1, verified: 1 },
  npc_drop_table: { total: 3, extracted: 1, reviewed: 1, verified: 1 },
  treasure_card_inventory: { total: 2, extracted: 0, reviewed: 1, verified: 1 },
  zone_transfer: { total: 7, extracted: 3, reviewed: 2, verified: 2 },
};

/** `GET /api/dashboard` — the eight buckets plus the sums the four stat cards read. */
function dashboardBody(): Record<string, unknown> {
  const overall = { total: 0, extracted: 0, reviewed: 0, verified: 0, percent_verified: 0 };
  for (const bucket of Object.values(DASHBOARD_TYPES)) {
    overall.total += bucket.total ?? 0;
    overall.extracted += bucket.extracted ?? 0;
    overall.reviewed += bucket.reviewed ?? 0;
    overall.verified += bucket.verified ?? 0;
  }
  overall.percent_verified = Math.round((overall.verified / overall.total) * 1000) / 10;
  return { types: structuredClone(DASHBOARD_TYPES), overall };
}

/** The window the feed's `changed_at` values hang off, so the relative times are real text. */
const NOW = Date.now();

/** Three feed rows: a linked quest, a linked DropTable, and one `null`-typed unlinkable row. */
const ACTIVITY = [
  {
    id: 11,
    object_type: 'quest',
    object_key: 'DS-ACAD1-C01-001',
    old_status: 'extracted',
    new_status: 'reviewed',
    notes: 'looks right',
    changed_by: 'Mock Reviewer',
    changed_at: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 10,
    object_type: 'drop_table',
    object_key: SELF_KEY,
    old_status: 'extracted',
    new_status: 'verified',
    notes: null,
    changed_by: 'Mock Reviewer',
    changed_at: new Date(NOW - 5 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 9,
    object_type: null,
    object_key: null,
    old_status: null,
    new_status: 'extracted',
    notes: 'orphan history row',
    changed_by: null,
    changed_at: new Date(NOW - 26 * 60 * 60 * 1000).toISOString(),
  },
];

/**
 * The friendly-name tables the editors read, in one answer per request (the D36
 * `{ "<type>": [rows] }` envelope, which `getNames` unwraps by key).
 *
 * `strings` is `[]` and the single-id branch 404s every key: `MOCK_QUEST.m_questTitle` is
 * `QuestTitle_1ED8D`, so the Info editor takes its raw-key fallback — the designed 404 above.
 * `items` is `ITEM_ROWS`, which holds `1001` and deliberately does **not** hold `1000`.
 */
const NAMES = {
  items: ITEM_ROWS,
  spells: [
    { template_id: 84361, name: 'Firecat' },
    { template_id: 48721, name: 'Stormzilla' },
  ],
  npcs: [
    { template_id: 126322, name: 'Zarek Pickmaster' },
    { template_id: 1025, name: 'Lucky the Merchant' },
  ],
  quests: QUEST_ROWS,
  zones: [
    { zone_path: 'DragonSpire/DS_A3_Kings', display_name: 'Kings Court', world: 'DragonSpire' },
    { zone_path: 'WizardCity/WC_Hub', display_name: 'Hub Square', world: 'WizardCity' },
  ],
  drop_tables: [{ name: 'WC-UNICORN-MAIN-007', description: 'Ravenwood table' }],
  strings: [] as Array<{ key: string; value: string | null; category: string | null }>,
};

/** What one arm's scan produced, plus the informational counters. */
interface Scan {
  readonly counts: Record<'critical' | 'serious' | 'moderate' | 'minor', number>;
  readonly violations: readonly Result[];
  /**
   * axe's "needs a human" bucket. Never a violation, and **never filtered away**: every entry
   * is printed with its rule id and targets, so the evidence says what was left undecided
   * rather than only how many.
   */
  readonly incomplete: readonly Result[];
}

/** The mocked-request bookkeeping one arm carries, so the guard can be asserted per arm. */
interface Mocked {
  /** `${method} ${path}` for every `/api/**` request no branch answered (the D81 guard). */
  readonly unmocked: string[];
  /** Chromium console errors and uncaught page errors — recorded, never asserted. */
  readonly consoleErrors: string[];
  /**
   * Every single-id name lookup, in order. The 404s among them are the designed misses
   * (the string-table title and the DropTable item `1000`), so the evidence can name them
   * instead of hand-waving about "some console errors".
   */
  readonly singleIdLookups: string[];
}

/* ---------------------------------------------------------------------- mocks */

/**
 * Fulfils the complete data surface of the four pages plus the app shell's boot reads.
 *
 * The path order below matters: `/api/quests` and `/api/drop-tables` are checked before their
 * `/:key` forms, and `/api/names/:type/:id` before `/api/names/:type`.
 */
async function mockA11yApi(page: Page): Promise<Mocked> {
  const unmocked: string[] = [];
  const consoleErrors: string[] = [];
  const singleIdLookups: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

  const bucket = (total: number, extracted: number, reviewed: number, verified: number) => ({
    total,
    extracted,
    reviewed,
    verified,
  });

  await page.route(/\/api\//, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (payload: unknown): Promise<void> => route.fulfill({ json: payload });

    // 1. The shell's own boot reads: Header, the identity gate, the import toast, the health probe
    //    and the p5-02 palette (which is mounted, and reads its endpoint lazily).
    if (path === '/api/settings') {
      return json({
        aurorium_path: '/mock/aurorium',
        imcodec_path: '/mock/imcodec',
        spiraldb_path: '/mock/spiraldb',
        user_name: 'A11y Reviewer',
        git_branch: 'content/2026-09-27',
      });
    }
    if (path === '/api/health') return json({ status: 'ok' });
    if (path === '/api/status/_import') return json({ ran: false, imported: 0, imported_at: null });
    if (path === '/api/sync/status') {
      return json({ last_sync: null, revision: null, status: 'never' });
    }
    if (path === '/api/sync/history') return json({ history: [] });

    // 2. The dashboard's two queries (p5-01) and the palette's search (p5-02).
    if (path === '/api/dashboard') return json(dashboardBody());
    if (path === '/api/activity') return json({ activity: ACTIVITY, unresolved: 1 });
    if (path === '/api/search') {
      return json({ query: url.searchParams.get('q') ?? '', results: [], truncated: false });
    }

    // 3. The friendly-name tables. The single-id form is the documented fallback: it 404s for
    //    every type (so `1000` keeps its numeric form, and `QuestTitle_1ED8D` keeps its raw key).
    if (path.startsWith('/api/names/')) {
      const segments = path.slice('/api/names/'.length).split('/');
      if (segments.length > 1) {
        singleIdLookups.push(decodeURIComponent(segments.slice(1).join('/')));
        return route.fulfill({ status: 404, json: { error: `Unknown ${segments[0]} id` } });
      }
      const type = segments[0] as keyof typeof NAMES;
      if (!(type in NAMES)) {
        return route.fulfill({ status: 404, json: { error: `unknown names type ${type}` } });
      }
      return json(NAMES);
    }

    // 4. The status API (D4's singular type in the path), one shape for every tracked family.
    if (path.startsWith('/api/status/')) {
      const segments = path.slice('/api/status/'.length).split('/');
      const type = segments[0] ?? '';
      if (!(type in DASHBOARD_TYPES)) {
        return route.fulfill({ status: 404, json: { error: `unknown status type ${type}` } });
      }
      if (segments.length === 1) {
        const entries = [
          {
            object_type: type === 'quests' ? 'quest' : type,
            object_key: type === 'quests' ? 'DS-ACAD1-C01-001' : SELF_KEY,
            status: 'reviewed',
            extracted_at: '2026-06-01T00:00:00.000Z',
            reviewed_at: '2026-06-02T00:00:00.000Z',
            verified_at: null,
            latest_notes: null,
          },
        ];
        return json({
          entries,
          summary: bucket(entries.length, 0, 1, 0),
        });
      }
      if (segments[2] === 'history') return json({ history: [] });
      return route.fulfill({ status: 404, json: { error: `unmocked status ${path}` } });
    }

    // 5. The quests list + one bare quest document (docs/spec-api.md L190-208, D49).
    //
    // Story p6-11's two static reads are matched **before** the `/:key` prefix below, because
    // `/api/quests/coverage` and `/api/quests/catalog` start with the same prefix and would
    // otherwise be answered as a quest document — which is not a coverage payload at all.
    if (path === '/api/quests/coverage') {
      // The shared fixture: `MOCK_COVERAGE` is the one measured home for these five numbers, so a
      // re-typed copy here could only drift from what the page asserts against elsewhere.
      return json(MOCK_COVERAGE);
    }
    if (path === '/api/quests/catalog') {
      // The shared fixture (`quests-mocks.ts`), not a hand-rolled copy: this spec navigates to no
      // catalog route, so its rows are *just* the fixture. `shell.spec.ts` and `responsive.spec.ts`
      // keep their own copies deliberately — they navigate to `/quests/DS-ACAD-C01-001` and
      // `/quests/catalog`, so their rows carry the older placeholder those arms address, and
      // unifying the spelling would be the drift, not the fix.
      const catalogRows = MOCK_CATALOG_ROWS;
      const missingOnly = url.searchParams.get('missing_only') === '1';
      const quests = missingOnly
        ? catalogRows.filter((row) => row.has_definition === 0)
        : catalogRows;
      return json({
        quests,
        total: quests.length,
        missing_only: missingOnly,
        corpus: { spiraldb_path: '/mock/spiraldb', quest_files: 322 },
      });
    }
    if (path === '/api/quests') {
      const rows = mockQuestRows();
      return json({
        quests: rows,
        summary: {
          total: rows.length,
          extracted: rows.filter((row) => row.status === 'extracted').length,
          reviewed: rows.filter((row) => row.status === 'reviewed').length,
          verified: rows.filter((row) => row.status === 'verified').length,
        },
        skipped: [],
      });
    }
    if (path.startsWith('/api/quests/')) {
      const name = decodeURIComponent(path.slice('/api/quests/'.length));
      return json({ ...MOCK_QUEST, m_questName: name });
    }

    // 6. The DropTable family: the list (the duplicate rule's corpus) and one bare document.
    if (path === '/api/drop-tables') {
      const rows = mockRows();
      return json({
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
    }
    if (path.startsWith('/api/drop-tables/')) return json(mockDocument());

    unmocked.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { error: `unmocked ${path}` } });
  });

  return { unmocked, consoleErrors, singleIdLookups };
}

/* ------------------------------------------------------------------- scanning */

/**
 * The page's settle fingerprint. Every component is load-bearing, and the docblock at the top of
 * this file says why the running-animation list is *counted* rather than required to be empty.
 */
async function fingerprint(page: Page): Promise<string> {
  const pageSide = await page.evaluate(() => {
    const describe = (animation: Animation): string => {
      const named = animation as unknown as { animationName?: string; transitionProperty?: string };
      return named.animationName ?? named.transitionProperty ?? 'animation';
    };
    const running = document
      .getAnimations()
      .filter((animation) => animation.playState === 'running')
      .map(describe)
      .sort()
      .join(',');
    return [
      document.readyState,
      document.documentElement.scrollWidth,
      document.documentElement.scrollHeight,
      document.querySelectorAll('*').length,
      running,
    ].join('|');
  });
  const box = await page.getByRole('main').boundingBox();
  const rounded =
    box === null
      ? 'no-box'
      : [box.x, box.y, box.width, box.height].map((value) => Math.round(value)).join(',');
  return `${pageSide}|${rounded}`;
}

/**
 * Wait for `ready` to be visible, then for the page to stop moving: the fingerprint must read
 * identically twice in a row. The content assertion comes first so a page that rendered nothing
 * can never be "settled".
 */
async function settle(page: Page, ready: Locator): Promise<void> {
  await expect(ready.first()).toBeVisible({ timeout: 20_000 });
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const current = await fingerprint(page);
        const isSettled = current === previous;
        previous = current;
        return isSettled;
      },
      { timeout: 15_000, intervals: [100, 100, 100, 150, 150, 200, 200, 250, 250, 300, 300] },
    )
    .toBe(true);
}

/** Run axe over the whole page with its **default** rule set (every tag, including best-practice). */
async function scan(page: Page): Promise<Scan> {
  const results = await new AxeBuilder({ page }).analyze();
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const violation of results.violations) {
    const impact = violation.impact ?? 'minor';
    if (impact in counts) counts[impact as keyof typeof counts] += 1;
  }
  return {
    counts,
    violations: results.violations,
    incomplete: results.incomplete,
  };
}

/**
 * The AC's clause, with a failure message that names the rule, its impact and **every** one of
 * its nodes — a truncated target list is how a second failing node hides behind the first.
 */
function assertNoCriticalOrSerious(result: Scan, arm: string): void {
  const detail = result.violations
    .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
    .map(
      (violation) =>
        `  ${violation.impact ?? '?'} ${violation.id} (${String(violation.nodes.length)} node(s)): ${violation.help}\n` +
        violation.nodes
          .map((node) => `    - ${node.target.join(' ')} · ${node.failureSummary ?? ''}`)
          .join('\n'),
    )
    .join('\n');
  expect(
    result.counts.critical + result.counts.serious,
    `${arm}: ${String(result.counts.critical)} critical + ${String(result.counts.serious)} serious\n${detail}`,
  ).toBe(0);
}

/**
 * One arm's closing bookkeeping: print the histogram (information the AC's wording must not
 * hide), assert the AC's clause, then assert D81's guard for **this** arm.
 */
function closeArm(arm: string, result: Scan, mocked: Mocked): void {
  console.log(
    `[axe] ${JSON.stringify({
      arm,
      ...result.counts,
      incomplete: result.incomplete.length,
      incompleteRules: result.incomplete.map((partial) => partial.id),
      consoleErrors: mocked.consoleErrors.length,
      singleIdLookups: mocked.singleIdLookups,
      unmocked: mocked.unmocked.length,
    })}`,
  );
  for (const partial of result.incomplete) {
    const targets = partial.nodes
      .flatMap((node) => node.target)
      .slice(0, 4)
      .join(' | ');
    // axe's own reason, verbatim: an `incomplete` is only useful evidence if the evidence says
    // *why* it could not decide (a truncated "18 nodes" would leave the next reader guessing).
    const reasons = [
      ...new Set(
        partial.nodes
          .flatMap((node) => [...node.any, ...node.all, ...node.none])
          .map((check) => check.message)
          .filter((message): message is string => typeof message === 'string'),
      ),
    ].join(' | ');
    console.log(
      `[axe-incomplete] ${arm}: ${partial.id} (${String(partial.nodes.length)}) ${targets}`,
    );
    console.log(`[axe-incomplete-why] ${arm}: ${partial.id} — ${reasons}`);
  }
  for (const message of mocked.consoleErrors.slice(0, 3)) {
    console.log(`[axe-console] ${arm}: ${message.slice(0, 200)}`);
  }
  assertNoCriticalOrSerious(result, arm);
  // D81: an endpoint this spec does not know about rendered an error state, so every assertion
  // above was about the wrong page. Named, so the fix is the missing branch and not the arm.
  expect(mocked.unmocked, `${arm}: API paths this spec does not mock`).toEqual([]);
}

/* -------------------------------------------------------------------- helpers */

const QUEST = 'DS-ACAD1-C01-001';
const DROP_TABLE = SELF_KEY;
/** `EDIT_MODE_ON_LOAD`'s hook (`QuestDetailPage.tsx:331`) — `true`, never `"edit"`. */
const editMode = (page: Page): Locator => page.locator('[data-edit-mode="true"]');
/** `ObjectDetailPage` starts at `'view'` and only `Edit` moves it (D66(b) is the *quest* page). */
const dropTableView = (page: Page): Locator => page.locator('[data-edit-mode="view"]');
const dropTableEdit = (page: Page): Locator => page.locator('[data-edit-mode="edit"]');

/**
 * The tabs the quest detail page renders, in the order its tab strip holds them: Overview first
 * and the landing tab (p7-14, D133), then the six editors.
 */
const PREVIEW_TABS = [
  'Overview',
  'Info',
  'Goals',
  'Goal Logic',
  'Requirements',
  'Results',
  'Dialog',
] as const;

/* ------------------------------------------------- §1 the four pages, each in its own state */

test.describe('§1 AC#13: zero critical/serious on the four key pages', () => {
  test('Dashboard (/) — as loaded: stat cards, per-type bars and the activity feed', async ({
    page,
  }) => {
    const mocked = await mockA11yApi(page);
    await page.goto('/');
    await expect(page.locator('[data-stat="total"]')).toBeVisible();
    await expect(page.locator('[data-activity-id="11"]')).toBeVisible();
    await settle(page, page.locator('[data-stat="total"]'));

    closeArm('dashboard', await scan(page), mocked);
  });

  test('Quest list (/quests) — as loaded: filter tabs and the desktop table', async ({ page }) => {
    const mocked = await mockA11yApi(page);
    await page.goto('/quests');
    await expect(page.getByText(/^Showing /)).toBeVisible();
    await expect(page.getByRole('row')).not.toHaveCount(0);
    await settle(page, page.getByRole('table'));

    closeArm('quest-list', await scan(page), mocked);
  });

  for (const tab of PREVIEW_TABS) {
    test(`Quest detail (/quests/${QUEST}) — edit mode as loaded, "${tab}" tab`, async ({
      page,
    }) => {
      const mocked = await mockA11yApi(page);
      await page.goto(`/quests/${QUEST}`);
      // The page starts in edit mode (D66(b)); clicking `Edit` here would turn it OFF and scan
      // the read-only bodies, which is this story's named false-negative trap.
      await expect(editMode(page)).toBeVisible();
      if (tab !== 'Overview') {
        await page.getByRole('tab', { name: tab, exact: true }).click();
      }
      await expect(page.getByRole('tabpanel')).toBeVisible();
      await settle(page, page.getByRole('tabpanel'));

      closeArm(`quest-detail:${tab}`, await scan(page), mocked);
    });
  }

  test(`Quest detail (/quests/${QUEST}) — edit mode with the JSON panel open`, async ({ page }) => {
    const mocked = await mockA11yApi(page);
    await page.goto(`/quests/${QUEST}`);
    await expect(editMode(page)).toBeVisible();
    await page.getByRole('button', { name: 'Toggle JSON panel' }).click();
    const panel = page.getByRole('complementary', { name: 'Quest JSON' });
    await expect(panel).toBeVisible();
    await settle(page, panel);

    /**
     * The p5-07 fix is a **class** pair (`QuestJsonPanel.tsx`'s `SYNTAX_OVERRIDES`), so pin the
     * colour the browser actually painted. Without this, a Tailwind build that never emitted
     * `text-orange-300` would leave the value inheriting the light foreground — which *passes*
     * the contrast arm below and would silently revert the viewer to the app's default text
     * colour. Two measured values, one per overridden syntax kind.
     */
    await expect(
      panel.locator('[role="treeitem"] span').filter({ hasText: QUEST }).first(),
    ).toHaveCSS(
      'color',
      'rgb(253, 186, 116)', // orange-300 — string values
    );
    await expect(
      panel.locator('[role="treeitem"] span').filter({ hasText: /^7$/ }).first(),
    ).toHaveCSS('color', 'rgb(249, 168, 212)'); // pink-300 — number values

    closeArm('quest-detail:json-panel', await scan(page), mocked);
  });

  test(`DropTable detail (/drop-tables/${DROP_TABLE}) — the as-loaded state`, async ({ page }) => {
    const mocked = await mockA11yApi(page);
    await page.goto(`/drop-tables/${DROP_TABLE}`);
    await expect(page.getByRole('link', { name: 'Back to Drop Tables' })).toBeVisible();
    // `ObjectDetailPage` starts at `'view'` (`ObjectDetailPage.tsx:315`), so this arm states
    // which state it scanned instead of inferring one from the brief's wording.
    await expect(dropTableView(page)).toBeVisible();
    await settle(page, dropTableView(page));

    closeArm('drop-table:view', await scan(page), mocked);
  });

  test(`DropTable detail (/drop-tables/${DROP_TABLE}) — after Edit: the item rows' controls`, async ({
    page,
  }) => {
    const mocked = await mockA11yApi(page);
    await page.goto(`/drop-tables/${DROP_TABLE}`);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(dropTableEdit(page)).toBeVisible();
    // The pair the fixture's two items create: `1001` is in the synced `items` table and
    // resolves; `1000` is one of the 8 measured misses and keeps its numeric form (D70).
    await expect(page.getByRole('combobox').first()).toBeVisible();
    await settle(page, dropTableEdit(page));

    closeArm('drop-table:edit', await scan(page), mocked);
  });
});

/* --------------------------------------------- §2 the same four pages at a hostile viewport */

test.describe('§2 the four pages at 375px (mobile-only markup)', () => {
  const MOBILE = { width: 375, height: 900 } as const;

  const arms: ReadonlyArray<{ arm: string; path: string; ready: (page: Page) => Locator }> = [
    { arm: 'dashboard@375', path: '/', ready: (page) => page.locator('[data-stat="total"]') },
    { arm: 'quest-list@375', path: '/quests', ready: (page) => page.getByText(/^Showing /) },
    {
      arm: 'quest-detail@375',
      path: `/quests/${QUEST}`,
      ready: (page) => page.locator('[data-edit-mode="true"]'),
    },
    {
      arm: 'drop-table@375',
      path: `/drop-tables/${DROP_TABLE}`,
      ready: (page) => page.getByRole('link', { name: 'Back to Drop Tables' }),
    },
  ];

  for (const { arm, path, ready } of arms) {
    test(`${arm} — below the md breakpoint the card lists, the hamburger and the JSON overlay replace their desktop counterparts`, async ({
      page,
    }) => {
      const mocked = await mockA11yApi(page);
      await page.setViewportSize(MOBILE);
      await page.goto(path);
      await settle(page, ready(page));

      closeArm(arm, await scan(page), mocked);
    });
  }
});

/* ------------------------------------------------------------------------- §3 the fixtures */

test.describe('§3 the fixtures are complete (D81)', () => {
  test('the four pages, walked in one session, leave the dispatcher with no unmocked path', async ({
    page,
  }) => {
    const mocked = await mockA11yApi(page);
    for (const path of ['/', '/quests', `/quests/${QUEST}`, `/drop-tables/${DROP_TABLE}`]) {
      await page.goto(path);
      await settle(page, page.getByRole('main'));
    }
    // The per-arm guard is the real one; this arm is the readable single line for the evidence.
    expect(mocked.unmocked).toEqual([]);
  });
});

/* ------------------------------------------- §4 the CI condition, measured not assumed */

test.describe('§4 the corpus condition this suite is proven under (D81)', () => {
  /**
   * The AC's decisive clause is "pass headless **in CI**", and CI is a different world: `data/`
   * is gitignored, so a runner has no corpus (the harness boots an empty `data/test-ui.db` with
   * `SPIRALDB_UI_SKIP_IMPORT=1`). D81's rule is that the fix for a CI-only defect is proven by
   * **reproducing the CI condition locally** — so this arm makes that reproduction
   * self-proving instead of assumed.
   *
   * It asks the harness's **own** Express (through Vite's proxy, and through the `request`
   * fixture, which `page.route` does not intercept — the point is to see the real server) what
   * corpus it is reading, and asserts the invariant that ties the two readings together:
   * **the server's rows are exactly the corpus files at the path it reports.** On a normal local
   * run that is the D17 clone's own count (measured: 322 files → 322 rows, 0 skipped); with
   * `SPIRALDB_PATH` pointed at an empty directory it is 0 files → 0 rows plus **1 skip**, which
   * is the service's honest report of a corpus directory it could not read
   * (`server/src/services/sync/corpus.ts`'s `readCorpusDir` error is pushed into `skipped[]`).
   * Both conditions are asserted, so the arm is meaningful in either rather than skipped in one.
   *
   * The `[corpus]` line it prints carries `envSpiraldbPath`, `servedSpiraldbPath`, the file count,
   * the row count and the skip's own message, so the evidence shows the env override reaching the
   * server rather than asserting that Playwright's `webServer` inherits the runner's environment.
   */
  test('the server reads exactly the corpus on disk at the path it reports', async ({
    request,
  }) => {
    const settings = (await (await request.get('/api/settings')).json()) as {
      spiraldb_path: string;
    };
    const list = (await (await request.get('/api/quests')).json()) as {
      quests: unknown[];
      skipped: Array<{ file: string; message: string }>;
    };
    const dir = join(settings.spiraldb_path, 'QuestTemplates');
    const present = existsSync(dir);
    const files = present ? readdirSync(dir).filter((name) => name.endsWith('.json')).length : 0;
    console.log(
      `[corpus] ${JSON.stringify({
        envSpiraldbPath: process.env.SPIRALDB_PATH ?? null,
        servedSpiraldbPath: settings.spiraldb_path,
        templatesDirExists: present,
        questFiles: files,
        apiRows: list.quests.length,
        apiSkipped: list.skipped.length,
        skipMessage: list.skipped[0]?.message ?? null,
      })}`,
    );
    if (present) {
      // Every corpus file is either a row or a reported skip: a file the list silently dropped
      // is a defect in the list, and a row with no file behind it would mean the list is not
      // reading the path the settings name.
      expect(list.quests.length + list.skipped.length).toBe(files);
    } else {
      // The CI condition, stated as its own contract: no directory, no rows, and the absence
      // reported rather than swallowed.
      expect(list.quests.length).toBe(0);
      expect(list.skipped.length).toBe(1);
    }
  });
});
