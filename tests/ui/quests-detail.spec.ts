import { expect, test, type Locator, type Page } from '@playwright/test';

import { MOCK_QUEST, mockQuestsApi } from './quests-mocks';

/**
 * Tier-1 quest detail spec (plan task 2.7 / story p2-08, decision D23 tier 1 / D40).
 *
 * Drives the real `/quests/:questName` page in headless chromium with the API
 * route-mocked: `GET /api/quests/:name` (the bare quest object, D49) and the
 * `GET /api/quests` list the header reads its status from. Nothing here needs the
 * SpiralDB corpus.
 *
 * What this file proves, clause by clause of `p2-08-ac2`:
 *
 * - the header: back link to `/quests`, the name in `text-xl font-mono
 *   font-semibold`, a `StatusBadge`, and the disabled Edit button carrying the
 *   exact "Editing arrives in Phase 3" tooltip;
 * - the six read-only tabs `[Info][Goals][Goal Logic][Requirements][Results]
 *   [Dialog]`, rendered by p2-07's `QuestPreview` rather than a copy of it;
 * - the JSON side panel: toggled by the header's `{ }` button, exactly 400px wide,
 *   syntax-highlighted (`react-json-view-lite`), with the spec's `[Copy]`;
 * - the same panel as a **full-screen overlay** below 768px, with no side panel
 *   beside it;
 * - loading, failure and the unknown-name 404, none of which strands the UI.
 *
 * The strings are written out in full rather than imported from the app: a spec
 * that imported the copy it asserts could only prove the app agrees with itself.
 */

const SIX_TABS = ['Info', 'Goals', 'Goal Logic', 'Requirements', 'Results', 'Dialog'] as const;

const EDIT_TOOLTIP = 'Editing arrives in Phase 3';

/** The `<main>` region — the page, without the shell's sidebar/header. */
function page_(page: Page): Locator {
  return page.getByRole('main');
}

function jsonToggle(page: Page): Locator {
  return page.getByRole('button', { name: 'Toggle JSON panel' });
}

function sidePanel(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Quest JSON' });
}

test.describe('header', () => {
  test('shows the back link, the mono name, the status badge and the disabled Edit', async ({
    page,
  }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');

    const main = page_(page);
    const back = main.getByRole('link', { name: 'Back to Quests' });
    await expect(back).toBeVisible();
    await expect(back).toHaveAttribute('href', '/quests');

    // Spec L284: `text-xl font-mono font-semibold`.
    const name = main.getByRole('heading', { level: 1, name: 'DS-ACAD1-C01-001' });
    await expect(name).toBeVisible();
    await expect(name).toHaveClass(/text-xl/);
    await expect(name).toHaveClass(/font-mono/);
    await expect(name).toHaveClass(/font-semibold/);

    // The status comes from the browse list's row (the detail body has none), and
    // the fixture's first row is `extracted`.
    await expect(main.getByLabel('Status: Extracted')).toBeVisible();

    const edit = main.getByRole('button', { name: 'Edit' });
    await expect(edit).toBeDisabled();
    await expect(edit).toHaveAttribute('title', EDIT_TOOLTIP);

    // The `{ }` toggle lives in the same header bar and starts unpressed.
    await expect(jsonToggle(page)).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('tabs', () => {
  test('renders the six read-only tabs through QuestPreview', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');

    const main = page_(page);
    for (const tab of SIX_TABS) {
      await expect(main.getByRole('tab', { name: tab }), `${tab} tab`).toBeVisible();
    }

    // Info is the landing tab and shows the quest's own fields.
    await expect(main.getByRole('tab', { name: 'Info' })).toHaveAttribute('aria-selected', 'true');

    // Each tab renders its section read-only (no inputs anywhere in the pane).
    await main.getByRole('tab', { name: 'Goals' }).click();
    // Scoped to the goal's own card: the name is also one of that goal's
    // `m_goalName` fields, so a bare text match would hit two real elements.
    const goal = main.getByRole('article').filter({ hasText: '1_WizardQuestGoals_GotoZone' });
    await expect(goal).toHaveCount(1);
    await expect(goal).toContainText('WaypointGoalTemplate');
    await expect(main.getByRole('tabpanel').locator('input')).toHaveCount(0);

    await main.getByRole('tab', { name: 'Goal Logic' }).click();
    await expect(main.getByText('m_goalsAND', { exact: true })).toBeVisible();

    // `exact` on the field labels: each name also appears inside the read-only JSON
    // block below it, as a key.
    await main.getByRole('tab', { name: 'Requirements' }).click();
    await expect(main.getByText('m_requirements', { exact: true })).toBeVisible();

    await main.getByRole('tab', { name: 'Results' }).click();
    await expect(main.getByText('WC-UNICORN-MAIN-007')).toBeVisible();

    await main.getByRole('tab', { name: 'Dialog' }).click();
    await expect(main.getByText('m_dialogList', { exact: true })).toBeVisible();
  });
});

test.describe('json side panel', () => {
  test('the { } toggle opens exactly 400px of syntax-highlighted JSON', async ({ page }) => {
    await mockQuestsApi(page);
    await page.context().grantPermissions(['clipboard-write']);
    await page.goto('/quests/DS-ACAD1-C01-001');

    await expect(sidePanel(page)).toHaveCount(0);

    await jsonToggle(page).click();
    const panel = sidePanel(page);
    await expect(panel).toBeVisible();
    await expect(jsonToggle(page)).toHaveAttribute('aria-pressed', 'true');

    // Spec L326: 400px wide.
    const box = await panel.boundingBox();
    expect(box?.width).toBe(400);

    // Syntax-highlighted JSON: the tree carries the field names and values...
    const tree = panel.getByRole('tree');
    await expect(tree).toContainText(MOCK_QUEST.m_questName);
    await expect(tree).toContainText('m_questLevel');
    // ...and the library's own colour classes (not plain text).
    expect(await tree.innerHTML()).toMatch(/color:rgb|class="_/);

    // The spec's `[Copy]` affordance works (the `[Wrap]` half is documented as not
    // shipped in `lib/quests.ts`: this library wraps unconditionally).
    await panel.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByText('Quest JSON copied to the clipboard')).toBeVisible();

    await jsonToggle(page).click();
    await expect(sidePanel(page)).toHaveCount(0);
    await expect(jsonToggle(page)).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('json panel on mobile', () => {
  test('below 768px the panel is a full-screen overlay, not a side panel', async ({ page }) => {
    await mockQuestsApi(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/quests/DS-ACAD1-C01-001');

    await jsonToggle(page).click();

    const dialog = page.getByRole('dialog', { name: 'Quest JSON' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('tree')).toContainText('m_questName');

    // Full screen: the overlay settles to the whole viewport. Polled, because the
    // vendored dialog's open animation scales it (`zoom-in-95` in the shared
    // primitive), so a single sample taken mid-flight measures the scaled rect and
    // not the layout one (measured: 356.25 of 375 at the animation's start).
    await expect
      .poll(async () => {
        const box = await dialog.boundingBox();
        return box === null
          ? null
          : { width: Math.round(box.width), height: Math.round(box.height), x: Math.round(box.x) };
      })
      .toEqual({ width: 375, height: 800, x: 0 });

    // And there is no side panel beside it.
    await expect(sidePanel(page)).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
});

test.describe('loading, failure and not found', () => {
  test('the detail skeleton is announced while the quest is loading', async ({ page }) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await mockQuestsApi(page, {
      onDetail: async (route) => {
        await held;
        await route.fulfill({ json: MOCK_QUEST });
      },
    });

    await page.goto('/quests/DS-ACAD1-C01-001');
    // The back link is in every state, so the user is never stranded.
    await expect(page_(page).getByRole('link', { name: 'Back to Quests' })).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toBeVisible();

    release();
    await expect(
      page_(page).getByRole('heading', { level: 1, name: 'DS-ACAD1-C01-001' }),
    ).toBeVisible();
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  });

  test('a 404 renders the not-found state with the server message', async ({ page }) => {
    await mockQuestsApi(page, {
      onDetail: (route) => route.fulfill({ status: 404, json: { error: 'Unknown quest "NOPE"' } }),
    });

    await page.goto('/quests/NOPE');

    const main = page_(page);
    await expect(main.getByRole('heading', { name: 'Quest not found' })).toBeVisible();
    await expect(main.getByText('Unknown quest "NOPE"')).toBeVisible();
    await expect(main.getByRole('link', { name: 'Back to Quests' })).toBeVisible();
    // A missing quest has nothing to edit or to view as JSON.
    await expect(main.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(jsonToggle(page)).toHaveCount(0);
    // Retrying a 404 would be pointless, so only real failures offer it.
    await expect(main.getByRole('button', { name: 'Try again' })).toHaveCount(0);

    // The shell is still alive: the back link really navigates.
    await main.getByRole('link', { name: 'Back to Quests' }).click();
    await expect(page).toHaveURL(/\/quests$/);
  });

  test('a failed detail read shows the server message and retries', async ({ page }) => {
    let calls = 0;
    await mockQuestsApi(page, {
      onDetail: async (route) => {
        calls += 1;
        if (calls === 1) {
          await route.fulfill({
            status: 500,
            json: { error: 'SpiralDB path is not configured.' },
          });
          return;
        }
        await route.fulfill({ json: MOCK_QUEST });
      },
    });

    await page.goto('/quests/DS-ACAD1-C01-001');

    const main = page_(page);
    await expect(main.getByText('Could not load this quest.')).toBeVisible();
    await expect(main.getByText('SpiralDB path is not configured.')).toBeVisible();

    await main.getByRole('button', { name: 'Try again' }).click();
    await expect(main.getByRole('heading', { level: 1, name: 'DS-ACAD1-C01-001' })).toBeVisible();
    await expect(main.getByRole('tab', { name: 'Info' })).toBeVisible();
  });
});
