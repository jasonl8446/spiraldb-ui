import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Story p7-07's tier-1 UI spec (plan task 7.6; D143, D144; spec-ui-design "Rebuild Drafts"):
 * the dashboard's **Rebuild drafts** button.
 *
 * | the spec's words | arm |
 * |---|---|
 * | "in the Per-Type Progress Section's title row, right-aligned" | the button sits in the same header as the section's heading |
 * | "calls `POST /api/drafts/rebuild`" | exactly one POST per click |
 * | "while it runs it shows a spinner and is disabled" | the held request keeps the button disabled and `aria-busy` |
 * | "a toast with the inserted count and a link to `/drafts`" | the toast's text carries the mocked `inserted`; its action navigates to `/drafts` |
 * | "a `409` is an info toast, not an error" | the 409 arm's toast is sonner's `info` type |
 *
 * Hermetic like `dashboard.spec.ts` (D81): one dispatcher answers every `/api/**` request, so the
 * rebuild never reaches the harness's database. The builder itself is proven by
 * `tests/unit/p7-drafts.test.ts` on a fixture catalog.
 */

const REBUILD_BODY = {
  proposed: 5373,
  inserted: 12,
  unchanged: 5361,
  removed: 0,
  by_source: {
    'evidence-title': 4026,
    'evidence-dialogue': 62,
    'evidence-goals': 836,
    'evidence-location': 85,
    'evidence-requirements': 449,
    'capture-order': 0,
    'capture-rewards': 0,
  },
  drafts: { named_missing: 1387, named_defined: 330, unnamed: 4648, zero_evidence: 1360 },
  duration_ms: 5259,
};

const EMPTY_BUCKET = { total: 0, extracted: 0, reviewed: 0, verified: 0 };

interface Recorded {
  rebuilds: number;
}

/**
 * Mocks the shell's boot reads, the dashboard's two reads and the rebuild. `answer` decides the
 * rebuild's reply and may hold it open.
 */
async function mockApi(page: Page, answer: (route: Route) => Promise<void>): Promise<Recorded> {
  const recorded: Recorded = { rebuilds: 0 };
  await page.route(/\/api\//, async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (payload: unknown): Promise<void> => route.fulfill({ json: payload });

    if (path === '/api/settings') {
      await json({
        aurorium_path: '/mock/aurorium',
        imcodec_path: '/mock/imcodec',
        spiraldb_path: '/mock/spiraldb',
        user_name: 'Mock Reviewer',
        git_branch: 'content/2026-09-29',
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
    if (path === '/api/dashboard') {
      const types = Object.fromEntries(
        [
          'quest',
          'drop_table',
          'npc_inventory',
          'npc_spell_inventory',
          'creature_spellbook',
          'npc_drop_table',
          'treasure_card_inventory',
          'zone_transfer',
        ].map((type) => [type, { ...EMPTY_BUCKET }]),
      );
      await json({ types, overall: { ...EMPTY_BUCKET, percent_verified: 0 } });
      return;
    }
    if (path === '/api/activity') {
      await json({ activity: [], unresolved: 0 });
      return;
    }
    if (path === '/api/drafts/rebuild' && request.method() === 'POST') {
      recorded.rebuilds += 1;
      await answer(route);
      return;
    }
    await route.fulfill({ status: 404, json: { error: `unmocked ${request.method()} ${path}` } });
  });
  return recorded;
}

const rebuildButton = (page: Page) =>
  page.getByRole('main').getByRole('button', { name: 'Rebuild drafts' });

test.describe('Rebuild drafts (task 7.6)', () => {
  test('sits in the progress section title row, spins while the rebuild runs, then toasts the inserted count', async ({
    page,
  }) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const recorded = await mockApi(page, async (route) => {
      await held;
      await route.fulfill({ json: REBUILD_BODY });
    });

    await page.goto('/');
    const heading = page.getByRole('heading', { name: 'Verification Progress by Type' });
    await expect(heading).toBeVisible();
    // The button shares the heading's title row (D144): both are children of one header.
    const titleRow = heading.locator('xpath=..');
    await expect(titleRow.getByRole('button', { name: 'Rebuild drafts' })).toBeVisible();

    await rebuildButton(page).click();
    await expect(rebuildButton(page)).toBeDisabled();
    await expect(rebuildButton(page)).toHaveAttribute('aria-busy', 'true');

    release();
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Drafts rebuilt' });
    // `removed` is surfaced too (PR #14 review 1): a rebuild that drops rows says so.
    await expect(toast).toContainText(
      'Drafts rebuilt: 12 new suggestions, 0 removed (6,365 drafts)',
    );
    await expect(toast).toHaveAttribute('data-type', 'success');
    await expect(rebuildButton(page)).toBeEnabled();
    expect(recorded.rebuilds).toBe(1);

    await toast.getByRole('button', { name: 'Open drafts' }).click();
    await expect(page).toHaveURL(/\/drafts$/);
  });

  test('a 409 (a rebuild already running) is an info toast, not an error', async ({ page }) => {
    await mockApi(page, (route) =>
      route.fulfill({ status: 409, json: { error: 'A draft rebuild is already running' } }),
    );

    await page.goto('/');
    await rebuildButton(page).click();

    const toast = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: 'A draft rebuild is already running' });
    await expect(toast).toHaveAttribute('data-type', 'info');
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
    await expect(rebuildButton(page)).toBeEnabled();
  });

  test('a 409 refusing an unreadable corpus is an error toast carrying the server message (PR #14 review 1)', async ({
    page,
  }) => {
    const refusal =
      'The rebuild read no quest file from /mock/spiraldb/QuestTemplates/QuestTemplates (missing ' +
      'or empty), and 5373 pending evidence suggestions would be deleted as "no longer proposed". ' +
      'Nothing was changed.';
    await mockApi(page, (route) => route.fulfill({ status: 409, json: { error: refusal } }));

    await page.goto('/');
    await rebuildButton(page).click();

    const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'read no quest file' });
    await expect(toast).toHaveAttribute('data-type', 'error');
    await expect(toast).toContainText('5373 pending evidence suggestions');
    await expect(page.locator('[data-sonner-toast][data-type="info"]')).toHaveCount(0);
  });
});
