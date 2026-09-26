import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockQuestsApi, mockQuestRows, questListBody } from './quests-mocks';

/**
 * Tier-1 quest browse spec (plan task 2.7 / story p2-08, decision D23 tier 1 / D40).
 *
 * Drives the real `/quests` page in headless chromium against the dev stack the
 * config auto-starts, with the whole API route-mocked (`quests-mocks.ts`) — CI has
 * no SpiralDB corpus, so a spec that read the real 322 files could not run there.
 *
 * What this file proves, clause by clause of `p2-08-ac1`:
 *
 * - the exact seven columns of `docs/spec-ui-design.md` L254-262 with their px
 *   widths, and that Actions is the one non-sortable column;
 * - the four filter tabs with the response summary's count badges and the active
 *   tab's `blue-500` underline + white text;
 * - the client-side search: the row set changes and **no further request is made**;
 * - sorting through the column headers (Quest Name, Level);
 * - the pagination line verbatim — "Showing 1-50 of 322" — and the boundary
 *   button states at both ends;
 * - row-click and the name link both navigate to `/quests/:questName`;
 * - the disabled Edit action (native tooltip, no navigation) and the real status
 *   menu (story p2-09, which replaced p2-08's documented placeholder), both inside
 *   the 80px Actions column;
 * - every per-filter empty state, and the empty-corpus case;
 * - the mobile card list at 375px with the four spec fields (L270);
 * - the loading skeleton and the failure state with its retry.
 *
 * The literals below are copied from the spec on purpose (see `quests-mocks.ts`):
 * a spec that imported the strings it asserts could only prove the app agrees with
 * itself — except `EDIT_DISABLED_TOOLTIP`, which is imported nowhere and written
 * out in full in both quest specs.
 */

/** The spec's column table, char for char (L254-262). */
const COLUMNS = [
  { header: 'Status', width: 40 },
  { header: 'Level', width: 60 },
  { header: 'Goals', width: 60 },
  { header: 'Mainline', width: 40 },
  { header: 'Modified', width: 120 },
  { header: 'Actions', width: 80 },
] as const;

/** `docs/spec-ui-design.md` L245's example counts. */
const TAB_COUNTS = [
  { label: 'All', count: '322' },
  { label: 'Extracted', count: '45' },
  { label: 'Reviewed', count: '120' },
  { label: 'Verified', count: '157' },
] as const;

const EMPTY_HINT =
  'Try a different filter or search, or extract more quests from a packet capture.';

/** The data rows (the header row is a `<tr>` too). */
function rows(page: Page): Locator {
  return page.locator('tbody tr');
}

function firstRow(page: Page): Locator {
  return rows(page).first();
}

function firstRowName(page: Page): Locator {
  return firstRow(page).locator('td').nth(1);
}

/** The first row's Level badge cell. */
function firstRowLevel(page: Page): Locator {
  return firstRow(page).locator('td').nth(2);
}

function columnHeader(page: Page, name: string): Locator {
  return page.getByRole('columnheader', { name });
}

function filterTab(page: Page, label: string): Locator {
  return page.getByRole('tablist', { name: 'Filter quests by status' }).getByRole('tab', {
    name: new RegExp(`^${label} `),
  });
}

function searchBox(page: Page): Locator {
  return page.getByPlaceholder('Search quests...');
}

test.describe('columns', () => {
  test('renders the seven spec columns at their exact widths', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests');

    await expect(rows(page)).toHaveCount(50);

    for (const column of COLUMNS) {
      const header = columnHeader(page, column.header);
      await expect(header, `${column.header} header`).toBeVisible();
      const box = await header.boundingBox();
      expect(box?.width, `${column.header} width`).toBe(column.width);
    }

    // Modified is relative time, not a timestamp (the fixture's first row is one
    // hour old at module load, so the unit cannot drift inside a suite run).
    await expect(firstRow(page).locator('td').nth(5)).toHaveText('1 hour ago');

    // Quest Name is the spec's `flex` column: it takes what the six fixed widths
    // leave, so it is the widest column and needs no px of its own.
    const name = await columnHeader(page, 'Quest Name').boundingBox();
    expect(name?.width ?? 0).toBeGreaterThan(400);
  });

  test('every column but Actions sorts, and the header reports the direction', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests');

    for (const name of ['Status', 'Quest Name', 'Level', 'Goals', 'Mainline', 'Modified']) {
      await expect(columnHeader(page, name).getByRole('button'), `${name} sort button`).toHaveCount(
        1,
      );
    }

    // Actions is the spec's one non-sortable column (L262): no button, no aria-sort.
    const actions = columnHeader(page, 'Actions');
    await expect(actions.getByRole('button')).toHaveCount(0);
    expect(await actions.getAttribute('aria-sort')).toBeNull();

    // The default sort is Quest Name ascending, and the header says so.
    await expect(columnHeader(page, 'Quest Name')).toHaveAttribute('aria-sort', 'ascending');
  });
});

test.describe('filter tabs', () => {
  test('the four tabs carry the summary count badges and the active styling', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests');

    for (const tab of TAB_COUNTS) {
      const button = filterTab(page, tab.label);
      await expect(button).toBeVisible();
      await expect(button, `${tab.label} badge`).toContainText(tab.count);
    }

    // Spec L248: active tab `blue-500` underline + white text, inactive `zinc-400`.
    await expect(filterTab(page, 'All')).toHaveAttribute('aria-selected', 'true');
    await expect(filterTab(page, 'All')).toHaveClass(/border-blue-500/);
    await expect(filterTab(page, 'All')).toHaveClass(/text-white/);
    await expect(filterTab(page, 'Reviewed')).toHaveAttribute('aria-selected', 'false');
    await expect(filterTab(page, 'Reviewed')).toHaveClass(/text-zinc-400/);

    // Clicking a tab filters the rows client-side and moves the active styling.
    await filterTab(page, 'Extracted').click();
    await expect(rows(page)).toHaveCount(45);
    await expect(page.getByText('Showing 1-45 of 45')).toBeVisible();
    await expect(filterTab(page, 'Extracted')).toHaveAttribute('aria-selected', 'true');
    await expect(filterTab(page, 'All')).toHaveAttribute('aria-selected', 'false');

    // Every row on the Extracted tab really is extracted (the dot's title says so).
    await expect(firstRow(page).getByTitle('Extracted')).toHaveCount(1);
    await expect(firstRow(page).getByTitle('Reviewed')).toHaveCount(0);
  });
});

test.describe('search', () => {
  test('filters the rows client-side without another request', async ({ page }) => {
    const recorded = await mockQuestsApi(page);
    await page.goto('/quests');
    await expect(rows(page)).toHaveCount(50);
    expect(recorded.listRequests).toBe(1);

    await searchBox(page).fill('acad1');
    // The two DS-ACAD1 names match on the quest name itself.
    await expect(rows(page)).toHaveCount(2);
    await expect(page.getByText('Showing 1-2 of 2')).toBeVisible();
    await expect(firstRowName(page)).toHaveText('DS-ACAD1-C01-001');

    // The resolved title is searched too — spec-silent, but the tile the user read
    // on the detail page has to find its row.
    await searchBox(page).fill('Title QUEST-100');
    await expect(rows(page)).toHaveCount(1);
    await expect(firstRowName(page)).toHaveText('QUEST-100');

    // A miss shows the empty state, then clearing restores the page.
    await searchBox(page).fill('nothing-matches-this');
    await expect(rows(page)).toHaveCount(0);
    await expect(page.getByText('No quests found.')).toBeVisible();
    await expect(page.getByText(EMPTY_HINT)).toBeVisible();

    await searchBox(page).fill('');
    await expect(rows(page)).toHaveCount(50);

    // The guarantee this story is built on: one list request, ever.
    expect(recorded.listRequests).toBe(1);
  });
});

test.describe('sorting', () => {
  test('the Quest Name header toggles ascending → descending → default', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests');

    // Default: name ascending. The first row is the alphabetically first fixture,
    // and page 1 ends at the 50th name of 322 — the W-prefixed name is last in the
    // whole set, so it lives on page 7; the descending assertion below proves that.
    await expect(firstRowName(page)).toHaveText('DS-ACAD1-C01-001');
    await expect(page.locator('tbody tr').last().locator('td').nth(1)).toHaveText('QUEST-051');

    const header = columnHeader(page, 'Quest Name');
    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    await expect(firstRowName(page)).toHaveText('WC-UNICORN-MAIN-004');

    // A third click removes the sort and the page falls back to its default.
    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    await expect(firstRowName(page)).toHaveText('DS-ACAD1-C01-001');
  });

  test('the Level header sorts numerically, and the level shows as a badge', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests');

    // The fixture's first row by name is level 11 — so a numeric sort has to move
    // another row to the top (fixture levels are `((index + 10) % 20) + 1`).
    await expect(firstRowLevel(page)).toHaveText('11');

    await columnHeader(page, 'Level').getByRole('button').click();
    await expect(columnHeader(page, 'Level')).toHaveAttribute('aria-sort', 'ascending');
    await expect(firstRowName(page)).toHaveText('QUEST-011');
    await expect(firstRowLevel(page)).toHaveText('1');
  });
});

test.describe('pagination', () => {
  test('shows the spec string and disables the buttons at both boundaries', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests');

    // Spec L266's own example, verbatim: 322 rows, 50 per page.
    await expect(page.getByText('Showing 1-50 of 322')).toBeVisible();
    await expect(rows(page)).toHaveCount(50);

    const previous = page.getByRole('button', { name: 'Previous', exact: true });
    const next = page.getByRole('button', { name: 'Next', exact: true });
    await expect(previous).toBeDisabled();
    await expect(next).toBeEnabled();

    // Six more pages → the last page, which is a partial one.
    for (let click = 0; click < 6; click += 1) {
      await next.click();
    }
    await expect(page.getByText('Showing 301-322 of 322')).toBeVisible();
    await expect(rows(page)).toHaveCount(22);
    await expect(next).toBeDisabled();
    await expect(previous).toBeEnabled();

    await previous.click();
    await expect(page.getByText('Showing 251-300 of 322')).toBeVisible();
    await expect(rows(page)).toHaveCount(50);
  });

  test('an empty corpus reads Showing 0-0 of 0 with both buttons disabled', async ({ page }) => {
    await mockQuestsApi(page, { rows: [] });
    await page.goto('/quests');

    await expect(page.getByText('No quests found.')).toBeVisible();
    await expect(page.getByText('Showing 0-0 of 0')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await expect(filterTab(page, 'All')).toContainText('0');
  });
});

test.describe('empty states', () => {
  test('every filter has its own empty state', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests');

    // A search that matches nothing, then each tab: the per-filter sentence is the
    // only thing that distinguishes them.
    await searchBox(page).fill('nothing-matches-this');
    const expected = [
      { tab: 'Extracted', message: 'No Extracted quests found.' },
      { tab: 'Reviewed', message: 'No Reviewed quests found.' },
      { tab: 'Verified', message: 'No Verified quests found.' },
      // `All` is the one tab with no status; it reads "No quests found." rather
      // than the template's literal "No All quests found." (see lib/quests.ts).
      { tab: 'All', message: 'No quests found.' },
    ] as const;

    for (const { tab, message } of expected) {
      await filterTab(page, tab).click();
      await expect(page.getByText(message, { exact: true }), `${tab} empty state`).toBeVisible();
      await expect(page.getByText(EMPTY_HINT)).toBeVisible();
      await expect(page.getByText('Showing 0-0 of 0')).toBeVisible();
    }
  });
});

test.describe('navigation', () => {
  test('clicking a row opens that quest, and so does its name link', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests');
    await expect(rows(page)).toHaveCount(50);

    // Anywhere on the row (here: the Modified cell) navigates (spec L264).
    await firstRow(page).locator('td').nth(5).click();
    await expect(page).toHaveURL(/\/quests\/DS-ACAD1-C01-001$/);
    await expect(
      page.getByRole('main').getByRole('heading', { level: 1, name: 'DS-ACAD1-C01-001' }),
    ).toBeVisible();

    // The monospace name is a real link, so the row is reachable by keyboard too.
    await page.goBack();
    await expect(rows(page)).toHaveCount(50);
    await firstRow(page).getByRole('link', { name: 'DS-ACAD1-C01-001' }).click();
    await expect(page).toHaveURL(/\/quests\/DS-ACAD1-C01-001$/);
  });

  test('the disabled Edit action never navigates, and the status menu is the real one', async ({
    page,
  }) => {
    await mockQuestsApi(page);
    await page.goto('/quests');

    const edit = firstRow(page).getByRole('button', { name: 'Edit quest' });
    await expect(edit).toBeDisabled();
    await expect(edit).toHaveAttribute('title', 'Editing arrives in Phase 3');

    // BEFORE (p2-08): a disabled, dashed-border placeholder whose accessible name
    // and tooltip said 'Change status (arrives with story p2-09)' /
    // 'Status transitions arrive with story p2-09'. Story p2-09 built the real
    // Radix popover menu, so that placeholder and both assertions are **replaced** by
    // the real ones: an enabled trigger whose title is the menu's own, and — after a
    // click — the two lifecycle actions. The full flow (dialog → PATCH → toast) lives
    // in `quests-status.spec.ts`.
    const statusMenu = firstRow(page).getByRole('button', {
      name: 'Change status: DS-ACAD1-C01-001',
    });
    await expect(statusMenu).toBeEnabled();
    await expect(statusMenu).toHaveAttribute('title', 'Change verification status');
    await expect(
      page.getByRole('button', { name: 'Change status (arrives with story p2-09)' }),
    ).toHaveCount(0);

    // `dispatchEvent` rather than `click()`: Playwright treats `aria-disabled` as
    // disabled and would refuse to click, so dispatching the real DOM event is what
    // proves the handler goes nowhere.
    await edit.dispatchEvent('click');
    await expect(page).toHaveURL(/\/quests$/);
    await expect(rows(page)).toHaveCount(50);

    // The menu's trigger is not a navigation target either: the row around it is.
    await statusMenu.click();
    await expect(page).toHaveURL(/\/quests$/);
    await expect(rows(page)).toHaveCount(50);
    await expect(
      page.getByLabel('Change status: DS-ACAD1-C01-001').getByRole('button', {
        name: 'Mark Reviewed',
      }),
    ).toBeVisible();
  });
});

test.describe('mobile', () => {
  test('below 768px the table is a card list with the four spec fields', async ({ page }) => {
    await mockQuestsApi(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/quests');

    // Spec L270: the table becomes a card list — it is not merely hidden.
    await expect(page.getByRole('table')).toHaveCount(0);
    const cards = page.getByRole('main').getByRole('list', { name: 'Quests' });
    await expect(cards.getByRole('listitem')).toHaveCount(50);

    const first = cards.getByRole('listitem').first();
    await expect(first).toContainText('DS-ACAD1-C01-001'); // name
    await expect(first).toContainText('Level 11'); // level
    await expect(first).toContainText('Extracted'); // status badge
    await expect(first).toContainText('1 hour ago'); // modified date

    // The tabs, the search and the pagination still work at this width.
    await expect(page.getByText('Showing 1-50 of 322')).toBeVisible();
    await filterTab(page, 'Extracted').click();
    await expect(cards.getByRole('listitem')).toHaveCount(45);
    await searchBox(page).fill('acad1');
    await expect(cards.getByRole('listitem')).toHaveCount(2);

    await cards.getByRole('listitem').first().click();
    await expect(page).toHaveURL(/\/quests\/DS-ACAD1-C01-001$/);
  });
});

test.describe('loading and failure', () => {
  test('the list skeleton is announced while the request is in flight', async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockQuestsApi(page, {
      onList: async (route) => {
        await held;
        await route.fulfill({ json: questListBody(mockQuestRows()) });
      },
    });

    await page.goto('/quests');
    await expect(page.locator('[aria-busy="true"]')).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Filter quests by status' })).toBeVisible();

    release();
    await expect(rows(page)).toHaveCount(50);
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  });

  test('a failed list shows the server message and recovers on Try again', async ({ page }) => {
    let calls = 0;
    await mockQuestsApi(page, {
      onList: async (route) => {
        calls += 1;
        // The QueryClient retries once (App.tsx), so the first two attempts fail.
        if (calls <= 2) {
          await route.fulfill({
            status: 500,
            json: { error: 'SpiralDB path is not configured.' },
          });
          return;
        }
        await route.fulfill({ json: questListBody(mockQuestRows()) });
      },
    });

    await page.goto('/quests');
    await expect(page.getByText('Could not load the quest list.')).toBeVisible();
    await expect(page.getByText('SpiralDB path is not configured.')).toBeVisible();

    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(rows(page)).toHaveCount(50);
  });
});
