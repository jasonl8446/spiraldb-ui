import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  mockQuestsApi,
  MOCK_COVERAGE,
  MOCK_COVERAGE_HEADLINE,
  type QuestsMockRecorded,
} from './quests-mocks';

/**
 * Tier-1 catalog spec (plan task 6.10 / story p6-11; decision D23 tier 1 / D40).
 *
 * Drives the real `/quests/catalog` and `/quests` pages in headless chromium with every route
 * mocked, and covers what a hermetic browser run can prove:
 *
 * - **ac1 — the header equals the response.** The rendered sentence is asserted against
 *   `MOCK_COVERAGE_HEADLINE`, the mock's own sentence, and against the response the page fetched
 *   (`coverageRequests === 1`). The last assertion is the falsification: a **second** run overrides
 *   the coverage payload with different numbers and the header must follow, so a page holding a
 *   constant cannot pass both arms. The same header is asserted on the Quests list page.
 * - **ac2 — the missing-only filter.** Checking the box re-requests `?missing_only=1` (the request
 *   URL is recorded, so the assertion is about the request, not about the page filtering rows) and
 *   the row set narrows to `has_definition = 0`. The filter's own wording is the spec's.
 * - **D85 — the numbers are text.** The `Defined` cell reads "defined"/"missing" as text and its
 *   glyph is `aria-hidden`; the header is a text node; nothing means something by colour alone.
 * - **the row links.** A defined row's action is an `Evidence` link whose `href` is
 *   `/quests/<name>?panel=evidence` (p6-08's entry point) and which really opens that panel; a
 *   missing row's action is a `Scaffold` button that POSTs the name (p6-09) and lands on the same
 *   editor. The nav item exists and points at the route.
 *
 * What is deliberately **not** here: the file write, the commit and the sync. The scaffold's own
 * write is proven by `tests/unit/quest-scaffold.test.ts` against a temp repository; this spec
 * proves the payload the page sent and where it navigated.
 */

/** The four fixture row names, and the two the filter keeps. */
const DEFINED_ROW = 'DS-ACAD1-C01-001';
const SECOND_DEFINED_ROW = 'KT-CRYHub-C01-004';
const MISSING_ROW = 'DM-GRAVE-MAIN-008';
const SECOND_MISSING_ROW = 'WC-UNICORN-MAIN-004';

function catalogRow(page: Page, questName: string): Locator {
  return page.getByTestId(`catalog-row-${questName}`);
}

function actionLink(page: Page, questName: string): Locator {
  return page.getByRole('link', { name: `Evidence ${questName}` });
}

function scaffoldButton(page: Page, questName: string): Locator {
  return page.getByRole('button', { name: `Scaffold ${questName}` });
}

test.describe('the coverage header', () => {
  test('renders the response, not a constant (ac1)', async ({ page }) => {
    const recorded: QuestsMockRecorded = await mockQuestsApi(page);

    await page.goto('/quests/catalog');

    await expect(page.getByTestId('coverage-headline')).toHaveText(MOCK_COVERAGE_HEADLINE);
    await expect(page.getByTestId('coverage-percent')).toHaveText('18.8%');
    // The header fetched the view; it did not compute a number of its own.
    expect(recorded.coverageRequests).toBe(1);
  });

  test('a changed coverage response changes the header — the falsification arm', async ({
    page,
  }) => {
    // Deliberately *different* numbers, none of them the spec's illustrative 1,447/4,830.
    await mockQuestsApi(page, {
      coverage: {
        nameable: 11,
        id_space: 5,
        defined: 4,
        missing: 7,
        references: 2,
        corpus: { spiraldb_path: '/mock/owner-fork', quest_files: 4 },
      },
    });

    await page.goto('/quests/catalog');

    await expect(page.getByTestId('coverage-headline')).toHaveText(
      '4 defined of 11 nameable of ~5 quests the client holds text for' +
        ' — corpus: /mock/owner-fork (4 quest files)',
    );
    // The two arms genuinely disagree — a page holding a constant could not pass both.
    expect(MOCK_COVERAGE.nameable).not.toBe(11);
  });

  test('the same header is on the Quests list page (spec §10)', async ({ page }) => {
    await mockQuestsApi(page);

    await page.goto('/quests');

    await expect(page.getByTestId('coverage-headline')).toHaveText(MOCK_COVERAGE_HEADLINE);
  });
});

test.describe('the missing-only filter', () => {
  test('narrows the list by re-requesting has_definition = 0 (ac2)', async ({ page }) => {
    const recorded = await mockQuestsApi(page);

    await page.goto('/quests/catalog');

    await expect(page.getByTestId(/^catalog-row-/)).toHaveCount(4);
    expect(recorded.catalogUrls).toEqual(['/api/quests/catalog']);
    await expect(catalogRow(page, MISSING_ROW)).toBeVisible();
    await expect(catalogRow(page, DEFINED_ROW)).toBeVisible();

    await page.getByRole('checkbox', { name: 'missing only' }).check();

    // The filter travelled as a query parameter — the predicate is the server's.
    await expect
      .poll(() => recorded.catalogUrls[recorded.catalogUrls.length - 1])
      .toBe('/api/quests/catalog?missing_only=1');
    await expect(page.getByTestId(/^catalog-row-/)).toHaveCount(2);
    await expect(catalogRow(page, MISSING_ROW)).toBeVisible();
    await expect(catalogRow(page, SECOND_MISSING_ROW)).toBeVisible();
    await expect(catalogRow(page, DEFINED_ROW)).toHaveCount(0);
    await expect(catalogRow(page, SECOND_DEFINED_ROW)).toHaveCount(0);
    // The count line is text too (D85), and it agrees with the rows on screen.
    await expect(page.getByTestId('catalog-count')).toHaveText('2 missing');
  });

  test('unchecking it returns the whole catalog', async ({ page }) => {
    const recorded = await mockQuestsApi(page);
    await page.goto('/quests/catalog');

    await page.getByRole('checkbox', { name: 'missing only' }).check();
    await expect(page.getByTestId(/^catalog-row-/)).toHaveCount(2);

    await page.getByRole('checkbox', { name: 'missing only' }).uncheck();

    await expect
      .poll(() => recorded.catalogUrls[recorded.catalogUrls.length - 1])
      .toBe('/api/quests/catalog');
    await expect(page.getByTestId(/^catalog-row-/)).toHaveCount(4);
  });
});

test.describe('the numbers and states are text (D85)', () => {
  test('the Defined cell says "defined"/"missing", with the glyph as decoration only', async ({
    page,
  }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/catalog');

    const defined = page.getByTestId(`catalog-defined-${DEFINED_ROW}`);
    const missing = page.getByTestId(`catalog-defined-${MISSING_ROW}`);

    await expect(defined).toHaveText('defined');
    await expect(missing).toHaveText('missing');
    // The icon carries no meaning of its own: it is hidden from assistive tech, so the word is the
    // whole statement (WCAG 1.4.1 — never colour-only, never glyph-only).
    await expect(defined.locator('svg')).toHaveAttribute('aria-hidden', 'true');
    await expect(missing.locator('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  test('an inferred title carries its labelled badge', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/catalog');

    await expect(
      catalogRow(page, DEFINED_ROW).getByText('inferred', { exact: true }),
    ).toBeVisible();
    await expect(catalogRow(page, MISSING_ROW).getByText('inferred', { exact: true })).toHaveCount(
      0,
    );
  });
});

test.describe('each row links into the evidence panel or the scaffold action', () => {
  test('a defined row links to the evidence panel and really opens it', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/catalog');

    const link = actionLink(page, DEFINED_ROW);
    await expect(link).toHaveAttribute('href', `/quests/${DEFINED_ROW}?panel=evidence`);

    await link.click();

    await expect(page).toHaveURL(new RegExp(`/quests/${DEFINED_ROW}\\?panel=evidence$`));
    // The rail the catalog promised (p6-08's one aside, on its Evidence tab).
    await expect(page.getByRole('complementary', { name: 'Quest evidence' })).toBeVisible();
  });

  test('a missing row carries the scaffold action, which posts the name and opens the editor', async ({
    page,
  }) => {
    const recorded = await mockQuestsApi(page);
    await page.goto('/quests/catalog');

    await scaffoldButton(page, MISSING_ROW).click();

    await expect(page).toHaveURL(new RegExp(`/quests/${MISSING_ROW}\\?panel=evidence$`));
    expect(recorded.scaffoldPosts).toEqual([{ quest_name: MISSING_ROW }]);
  });
});

test.describe('the shell wiring', () => {
  test('the QUESTS nav item points at the catalog route', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/catalog');

    await expect(page.getByRole('link', { name: 'Catalog' })).toHaveAttribute(
      'href',
      '/quests/catalog',
    );
    // …and it is the active item, not the Browse Quests item it would shadow without the
    // static-before-dynamic rule.
    await expect(page.getByRole('link', { name: 'Catalog' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('an empty catalog says it needs a sync and offers the action, never a bare zero', async ({
    page,
  }) => {
    await mockQuestsApi(page, {
      coverage: {
        nameable: 0,
        id_space: 0,
        defined: 0,
        missing: 0,
        references: 0,
        corpus: { spiraldb_path: '', quest_files: 0 },
      },
      catalogRows: [],
    });

    await page.goto('/quests/catalog');

    await expect(page.getByText('The quest catalog is empty', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Settings and sync' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  /**
   * The **filtered** empty state — the sibling of the arm above, and the one the page holds its
   * second coverage query for: `nameable > 0` with an empty row set means "every catalog quest has
   * a definition", not "there is no catalog". It was rendered by nothing until now, because the
   * only empty-state arm also zeroed `coverage.nameable`.
   */
  test('a filter that matched nothing says so, and offers no sync (CATALOG_NO_MISSING)', async ({
    page,
  }) => {
    const recorded = await mockQuestsApi(page, { catalogRows: [] });

    await page.goto('/quests/catalog');
    await page.getByRole('checkbox', { name: 'missing only' }).check();

    // The read really was the filtered one, so this is the state being asserted.
    await expect
      .poll(() => recorded.catalogUrls[recorded.catalogUrls.length - 1])
      .toBe('/api/quests/catalog?missing_only=1');
    await expect(
      page.getByText('Every catalog quest has a definition', { exact: false }),
    ).toBeVisible();
    // The sync action belongs to the empty **tier**, not to a filter that matched nothing.
    await expect(page.getByRole('link', { name: 'Open Settings and sync' })).toHaveCount(0);
  });

  /**
   * The **identity row** — a quest whose `title` fell back to its `quest_name`, the catalog's
   * common shape for an unlinked quest. No shared fixture carries it (`MOCK_CATALOG_ROWS` is
   * consumed by other specs and one of them pins its name set), so the row is declared here, in the
   * arm that needs it. Name and Title are separate columns, so the Title cell must be the em dash
   * rather than a second copy of the Name cell.
   */
  test('a row whose title fell back to its name shows the em dash in Title, not the name twice', async ({
    page,
  }) => {
    await mockQuestsApi(page, {
      catalogRows: [
        {
          quest_name: 'WC-UNICORN-MAIN-004',
          title: 'WC-UNICORN-MAIN-004',
          title_source: 'none',
          has_definition: 1,
          reference_count: 3,
        },
      ],
    });

    await page.goto('/quests/catalog');

    const row = catalogRow(page, 'WC-UNICORN-MAIN-004');
    await expect(row.locator('td').nth(0)).toHaveText('WC-UNICORN-MAIN-004');
    await expect(row.locator('td').nth(1)).toHaveText('—');
  });
});
