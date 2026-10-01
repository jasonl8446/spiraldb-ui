import { expect, test, type Page, type Route } from '@playwright/test';

import { mockQuestRows, mockQuestsApi } from './quests-mocks';

/**
 * Story p5-03's tier-1 spec (plan task 5.3; decision D23 tier 1 / D40): the status
 * filter as a **URL param**, on an object family **and** on the quests page.
 *
 * The AC it covers (the Phase 5 plan, §"Acceptance Criteria"):
 *
 * > *Every list view: four filter tabs with counts equal to the status API summary;
 * > filter survives reload via URL param; empty state per filter.*
 *
 * What is asserted, for **both** surfaces:
 *
 * 1. the four tabs and their count badges;
 * 2. a filter selecting a genuine subset (the pagination line, not just the tab state);
 * 3. the URL param **appearing** on a tab click and **surviving a hard reload**;
 * 4. the default (`All`) writing **no** param at all;
 * 5. the browser's Back returning to the previous filter (why the write is a push);
 * 6. the per-filter empty state, naming the filter that is empty.
 *
 * **Hermetic by construction (D81).** Every request both pages make is fulfilled from
 * the fixtures here or from `quests-mocks.ts`, so the run reaches neither the dev
 * stack's SQLite file nor the developer's corpus: CI has no SpiralDB checkout and no
 * `QuestTemplates/` files, and a spec that read them could not run there. The tab
 * counts' **source** is pinned by a route that records hits and must stay at zero —
 * the badges are counted from the **list payload's own `summary`** (D49), and a
 * `GET /api/status/<type>` request from either page would mean the count had silently
 * moved to the other derivation (which is exactly the pair `p5-03-d1-audit.md`
 * cross-checks).
 *
 * The wire literals are copied from `docs/spec-api.md` rather than imported from the
 * client modules the page reads: a fixture that imported them could only prove the
 * client agrees with itself.
 */

/* ------------------------------------------------------- the object family */

/** One `objects[]` row of `GET /api/npc-inventories` (the shape `lib/objects.ts` reads). */
interface MockObjectRow {
  key: string;
  title: string;
  modified_at: string | null;
  status: 'extracted' | 'reviewed' | 'verified';
}

/** `1001`–`1003` extracted, `1004`–`1005` reviewed, `1006` verified. */
const OBJECT_ROWS: MockObjectRow[] = [
  { key: '1001', status: 'extracted' },
  { key: '1002', status: 'extracted' },
  { key: '1003', status: 'extracted' },
  { key: '1004', status: 'reviewed' },
  { key: '1005', status: 'reviewed' },
  { key: '1006', status: 'verified' },
].map((row) => ({
  key: row.key,
  title: row.key,
  modified_at: '2026-09-26T12:00:00.000Z',
  status: row.status as MockObjectRow['status'],
}));

/** The `GET /api/npc-inventories` body; its `summary` counts the rows it returns (D49). */
function objectListBody(rows: MockObjectRow[]): Record<string, unknown> {
  const count = (status: MockObjectRow['status']): number =>
    rows.filter((row) => row.status === status).length;
  return {
    objects: rows,
    summary: {
      total: rows.length,
      extracted: count('extracted'),
      reviewed: count('reviewed'),
      verified: count('verified'),
    },
    skipped: [],
    missing_directory: false,
    duplicate_keys: [],
  };
}

interface ObjectMockRecorded {
  /** `GET /api/npc-inventories` calls — must not grow while only the filter moves. */
  listRequests: number;
  /** `GET /api/status/npc_inventories` calls — must stay `0` (the D49 source assertion). */
  statusRequests: number;
}

async function mockNpcInventoryApi(
  page: Page,
  rows: MockObjectRow[] = OBJECT_ROWS,
): Promise<ObjectMockRecorded> {
  const recorded: ObjectMockRecorded = { listRequests: 0, statusRequests: 0 };

  // The shell's own boot reads (Header, the identity gate, the import toast).
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
    route.fulfill({ json: { last_sync: null, revision: null, status: 'never' } }),
  );
  await page.route('**/api/sync/history', (route) => route.fulfill({ json: { history: [] } }));
  await page.route('**/api/status/_import', (route) =>
    route.fulfill({ json: { ran: false, imported: 0, imported_at: null } }),
  );

  // The other derivation, watched rather than used: a hit here would prove the badges
  // had moved off the list payload (the `p5-03-d1-audit.md` cross-check's two sides).
  await page.route('**/api/status/npc_inventories', (route) => {
    recorded.statusRequests += 1;
    return route.fulfill({
      json: {
        entries: [],
        summary: {
          total: rows.length,
          extracted: rows.filter((row) => row.status === 'extracted').length,
          reviewed: rows.filter((row) => row.status === 'reviewed').length,
          verified: rows.filter((row) => row.status === 'verified').length,
        },
      },
    });
  });

  await page.route('**/api/npc-inventories', (route: Route) => {
    recorded.listRequests += 1;
    return route.fulfill({ json: objectListBody(rows) });
  });

  return recorded;
}

/** The object page's tab list, by its own accessible name (`objectFilterLabel`). */
function objectTabs(page: Page) {
  return page.getByRole('main').getByRole('tablist', { name: 'Filter NPC inventories by status' });
}

/* ------------------------------------------------------------ the quests page */

/** The quests page's tab list, by its own accessible name. */
function questTabs(page: Page) {
  return page.getByRole('main').getByRole('tablist', { name: 'Filter quests by status' });
}

/**
 * `mockQuestsApi` plus the one route it deliberately leaves alone: `GET /api/status/quests`
 * (the quests page never calls it — the tabs read the list payload — so this records hits
 * and must stay at zero, exactly like the object family's handler above).
 */
async function mockQuestsWithStatusWatch(
  page: Page,
  rows: ReturnType<typeof mockQuestRows>,
): Promise<{ statusRequests: number }> {
  const watched = { statusRequests: 0 };
  await page.route('**/api/status/quests', (route) => {
    watched.statusRequests += 1;
    return route.fulfill({
      json: { entries: [], summary: { total: 0, extracted: 0, reviewed: 0, verified: 0 } },
    });
  });
  await mockQuestsApi(page, { rows });
  return watched;
}

/** The current URL's query string, without the leading `?` (`''` when there is none). */
function searchOf(page: Page): string {
  return new URL(page.url()).search;
}

/* ============================================================ the object family */

test.describe('the status filter as a URL param — the NPC inventory list', () => {
  test('four tabs count the list payload, a filter selects a subset, and the URL carries it across a reload', async ({
    page,
  }) => {
    const recorded = await mockNpcInventoryApi(page);
    await page.goto('/npc-inventories');

    const tabs = objectTabs(page);
    // 1. The four tabs, with the count badges of the rows the list returned (D49).
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole('tab')).toHaveCount(4);
    await expect(tabs.getByRole('tab', { name: /^All / })).toContainText('6');
    await expect(tabs.getByRole('tab', { name: /^Extracted / })).toContainText('3');
    await expect(tabs.getByRole('tab', { name: /^Reviewed / })).toContainText('2');
    await expect(tabs.getByRole('tab', { name: /^Verified / })).toContainText('1');
    await expect(page.getByText('Showing 1-6 of 6')).toBeVisible();

    // 4. The default is clean: `All` writes no param, so the path is unchanged (the
    //    `tests/ui/shell.spec.ts` route pin only reads a pathname — this keeps it bare).
    await expect(tabs.getByRole('tab', { name: /^All / })).toHaveAttribute('aria-selected', 'true');
    expect(searchOf(page)).toBe('');

    // 3. A tab click writes the param, and the filter really narrows the rows.
    await tabs.getByRole('tab', { name: /^Reviewed / }).click();
    await expect(page).toHaveURL(/\/npc-inventories\?filter=Reviewed$/);
    await expect(page.getByText('Showing 1-2 of 2')).toBeVisible();
    await expect(page.getByRole('link', { name: '1004', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '1001', exact: true })).toHaveCount(0);

    // 3. A hard reload keeps it — the clause a `useState` cannot satisfy.
    await page.reload();
    await expect(page.getByText('Showing 1-2 of 2')).toBeVisible();
    await expect(tabs.getByRole('tab', { name: /^Reviewed / })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(searchOf(page)).toBe('?filter=Reviewed');

    // 4. Going back to the default removes the param rather than spelling it out.
    await tabs.getByRole('tab', { name: /^All / }).click();
    await expect(page).toHaveURL(/\/npc-inventories$/);
    expect(searchOf(page)).toBe('');

    // 2/5. Two filters, then the browser's Back: one step per click, so the write is a
    //      push (a `replace` would leave Back on the bare list and fail here).
    await tabs.getByRole('tab', { name: /^Extracted / }).click();
    expect(searchOf(page)).toBe('?filter=Extracted');
    await expect(page.getByText('Showing 1-3 of 3')).toBeVisible();
    await tabs.getByRole('tab', { name: /^Verified / }).click();
    expect(searchOf(page)).toBe('?filter=Verified');
    await expect(page.getByText('Showing 1-1 of 1')).toBeVisible();
    await page.goBack();
    expect(searchOf(page)).toBe('?filter=Extracted');
    await expect(page.getByText('Showing 1-3 of 3')).toBeVisible();
    await expect(tabs.getByRole('tab', { name: /^Extracted / })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // The counts' source: the badges are the list payload's `summary` (D49), so moving
    // the filter must not re-read the list and must never touch the status endpoint.
    expect(recorded.statusRequests).toBe(0);
    expect(recorded.listRequests).toBe(2); // the initial load + the reload
  });

  test('a per-filter empty state names the filter that is empty', async ({ page }) => {
    // An empty corpus, so both the `Verified` tab and the `All` tab have nothing to
    // show — the AC's clause for a filter, and the one spec-silent case the `All` tab
    // needs (its message has no status to interpolate; D51(d)).
    await mockNpcInventoryApi(page, []);
    // The param is read on a **cold** load too — not only followed from a click.
    await page.goto('/npc-inventories?filter=Verified');

    // 6. The message is the spec's `No {status} {noun} found.` template (L268) with the
    //    filter interpolated, so it says *which* filter is empty.
    await expect(page.getByText('No Verified NPC inventories found.')).toBeVisible();
    await expect(page.getByText('Try a different filter or search.')).toBeVisible();
    await expect(page.getByText('Showing 0-0 of 0')).toBeVisible();
    await expect(objectTabs(page).getByRole('tab', { name: /^Verified / })).toContainText('0');

    // …and the `All` tab is the one tab with no status: it reads the noun alone
    //    rather than the template's literal "No All …" (D51(d)).
    await objectTabs(page).getByRole('tab', { name: /^All / }).click();
    await expect(page.getByText('No NPC inventories found.')).toBeVisible();
  });
});

/* ============================================================= the quests page */

test.describe('the status filter as a URL param — the quest list', () => {
  test('four tabs count the list payload, a filter selects a subset, and the URL carries it across a reload', async ({
    page,
  }) => {
    // The default 322-row fixture: 45 extracted / 120 reviewed / 157 verified.
    const watched = await mockQuestsWithStatusWatch(page, mockQuestRows());
    await page.goto('/quests');

    const tabs = questTabs(page);
    await expect(tabs).toBeVisible();
    await expect(tabs.getByRole('tab')).toHaveCount(4);
    await expect(tabs.getByRole('tab', { name: /^All / })).toContainText('322');
    await expect(tabs.getByRole('tab', { name: /^Extracted / })).toContainText('45');
    await expect(tabs.getByRole('tab', { name: /^Reviewed / })).toContainText('120');
    await expect(tabs.getByRole('tab', { name: /^Verified / })).toContainText('157');
    await expect(page.getByText('Showing 1-50 of 322')).toBeVisible();

    // The default is clean.
    expect(searchOf(page)).toBe('');

    // A tab click writes the param and narrows the rows.
    await tabs.getByRole('tab', { name: /^Reviewed / }).click();
    await expect(page).toHaveURL(/\/quests\?filter=Reviewed$/);
    await expect(page.getByText('Showing 1-50 of 120')).toBeVisible();

    // A hard reload keeps it.
    await page.reload();
    await expect(page.getByText('Showing 1-50 of 120')).toBeVisible();
    await expect(tabs.getByRole('tab', { name: /^Reviewed / })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(searchOf(page)).toBe('?filter=Reviewed');

    // Back to the default removes the param.
    await tabs.getByRole('tab', { name: /^All / }).click();
    await expect(page).toHaveURL(/\/quests$/);
    expect(searchOf(page)).toBe('');

    // Browser Back moves between filters, one step per click.
    await tabs.getByRole('tab', { name: /^Extracted / }).click();
    await tabs.getByRole('tab', { name: /^Verified / }).click();
    expect(searchOf(page)).toBe('?filter=Verified');
    await expect(page.getByText('Showing 1-50 of 157')).toBeVisible();
    await page.goBack();
    expect(searchOf(page)).toBe('?filter=Extracted');
    // 45 rows is one short of a full page, so the line reads `1-45 of 45`.
    await expect(page.getByText('Showing 1-45 of 45')).toBeVisible();
    await expect(tabs.getByRole('tab', { name: /^Extracted / })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // The quests page reads the list payload's `summary` for its badges and never the
    // status endpoint — the one surface where the two derivations can disagree in the
    // owner's corpus (the six D82 quests; see `p5-03-d1-audit.md` §2). Zero hits here.
    expect(watched.statusRequests).toBe(0);
  });

  test('a per-filter empty state names the filter that is empty', async ({ page }) => {
    // An empty corpus, so the `All` tab is empty too (the same one case the object
    // family's test covers).
    await mockQuestsWithStatusWatch(page, []);
    await page.goto('/quests?filter=Verified');

    await expect(page.getByText('No Verified quests found.')).toBeVisible();
    await expect(
      page.getByText(
        'Try a different filter or search, or extract more quests from a packet capture.',
      ),
    ).toBeVisible();
    await expect(page.getByText('Showing 0-0 of 0')).toBeVisible();

    await questTabs(page).getByRole('tab', { name: /^All / }).click();
    await expect(page.getByText('No quests found.')).toBeVisible();
  });
});
