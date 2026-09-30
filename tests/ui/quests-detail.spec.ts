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
 *   font-semibold`, a `StatusBadge`, and the Edit control — a **disabled placeholder** when
 *   p2-08 wrote this spec, the real view/edit toggle since story p3-10 (whose own spec,
 *   `quests-edit-mode.spec.ts`, drives both modes and the Save pipeline);
 * - the six tabs `[Info][Goals][Goal Logic][Requirements][Results][Dialog]`,
 *   rendered by p2-07's `QuestPreview` rather than a copy of it: **three read-only, with
 *   Info (story p3-03), Goals (story p3-04) and Goal Logic (story p3-05) the live editors**
 *   (whose own specs, `quests-info-editor.spec.ts` / `quests-goals-editor.spec.ts` /
 *   `quests-goal-logic.spec.ts`, assert the forms; this file pins that the other three
 *   never grow a control);
 * - the JSON side panel: toggled by the header's `{ }` button, exactly 400px wide,
 *   syntax-highlighted (`react-json-view-lite`), with the spec's `[Copy]` **and `[Wrap]`**
 *   (`[Wrap]` was a recorded deviation until story p3-10 shipped it);
 * - the same panel as a **full-screen overlay** below 768px, with no side panel
 *   beside it;
 * - loading, failure and the unknown-name 404, none of which strands the UI.
 *
 * The strings are written out in full rather than imported from the app: a spec
 * that imported the copy it asserts could only prove the app agrees with itself.
 */

const SIX_TABS = ['Info', 'Goals', 'Goal Logic', 'Requirements', 'Results', 'Dialog'] as const;

/**
 * The Edit toggle's tooltip in edit mode — the load state (`EDIT_MODE_ON_LOAD`). It replaced
 * p2-08's 'Editing arrives in Phase 3', which story p3-10 retired from the detail page.
 */
const EDIT_TOOLTIP = 'Switch to view mode';

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
    const name = main.getByRole('heading', { level: 2, name: 'DS-ACAD1-C01-001' });
    await expect(name).toBeVisible();
    await expect(name).toHaveClass(/text-xl/);
    await expect(name).toHaveClass(/font-mono/);
    await expect(name).toHaveClass(/font-semibold/);

    // The status comes from the browse list's row (the detail body has none), and
    // the fixture's first row is `extracted`.
    await expect(main.getByLabel('Status: Extracted')).toBeVisible();

    const edit = main.getByRole('button', { name: 'Edit' });
    // The real toggle since p3-10: enabled, pressed in edit mode (the load state), with the
    // action in `title` rather than a changing label.
    await expect(edit).toBeEnabled();
    await expect(edit).toHaveAttribute('aria-pressed', 'true');
    await expect(edit).toHaveAttribute('title', EDIT_TOOLTIP);

    // The `{ }` toggle lives in the same header bar and starts unpressed.
    await expect(jsonToggle(page)).toHaveAttribute('aria-pressed', 'false');
  });

  test('carries the two lifecycle actions next to the badge (story p2-09)', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');

    const main = page_(page);
    // The spec's exact button labels (docs/spec-data-model.md L16-17). The fixture
    // row is `extracted`, so neither action is the entry's own status and both are
    // available; the disabled-own-status case is asserted in `quests-status.spec.ts`.
    await expect(main.getByRole('button', { name: 'Mark Reviewed' })).toBeEnabled();
    await expect(main.getByRole('button', { name: 'Mark Verified' })).toBeEnabled();
    // The history timeline is a section of the page, not a seventh tab.
    await expect(main.getByRole('tab')).toHaveCount(SIX_TABS.length);
    await expect(main.getByRole('heading', { level: 2, name: 'Status History' })).toBeVisible();
  });
});

test.describe('tabs', () => {
  test('renders the six tabs through QuestPreview, all six live editors', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');

    const main = page_(page);
    for (const tab of SIX_TABS) {
      await expect(main.getByRole('tab', { name: tab }), `${tab} tab`).toBeVisible();
    }

    // Info is the landing tab and, since p3-03, the live editor; the other five became live
    // editors in p3-04 (Goals), p3-05 (Goal Logic), p3-06 (Requirements), p3-07 (Results) and
    // p3-08 (Dialog) — so no tab on the detail page is read-only any more. The extraction
    // page's preview keeps the read-only bodies and `extraction.spec.ts` still asserts that.
    await expect(main.getByRole('tab', { name: 'Info' })).toHaveAttribute('aria-selected', 'true');
    await expect(main.getByRole('region', { name: 'Quest info editor' })).toBeVisible();

    // The Goals tab is the second live editor (story p3-04): its own spec drives the
    // editing, so this only pins that the detail page really mounts it, that the card
    // sketch's own elements are there, and that a collapsed card adds no stray input.
    await main.getByRole('tab', { name: 'Goals' }).click();
    await expect(main.getByRole('region', { name: 'Quest goals editor' })).toBeVisible();
    // Scoped to the goal's own card: the name is also one of that goal's
    // `m_goalName` fields, so a bare text match would hit two real elements.
    const goal = main.getByRole('article').filter({ hasText: '1_WizardQuestGoals_GotoZone' });
    await expect(goal).toHaveCount(1);
    await expect(goal).toContainText('Waypoint');
    await expect(goal.getByRole('button', { name: 'Set as Start Goal' })).toBeVisible();

    // The Goal Logic tab is the third live editor (story p3-05): its own spec drives the
    // canvas, the toolbar and the node menu, so this only pins that the detail page really
    // mounts it — and that the read-only field list it replaced is gone, which is what the
    // old `m_goalsAND` text assertion here used to check.
    await main.getByRole('tab', { name: 'Goal Logic' }).click();
    await expect(main.getByRole('region', { name: 'Quest goal logic editor' })).toBeVisible();
    await expect(main.getByRole('group', { name: 'Goal logic flowchart' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Add GoalLogicEntry' })).toBeVisible();
    // This fixture's entry is **sparse** by design (`m_goalsAND` and `m_completeQuest`
    // only), and the summary is read straight out of it: nothing is padded in, and no
    // missing `m_goalsToAdd` is invented as a target.
    await expect(
      main.getByRole('button', { name: 'Entry 1: AND 1_WizardQuestGoals_GotoZone' }),
    ).toBeVisible();
    await expect(main.getByText('m_goalsAND', { exact: true })).toHaveCount(0);

    // The Requirements tab is the fourth live editor (story p3-06): its own spec
    // (`quests-requirements-editor.spec.ts`) drives the tree, so this pins that the detail
    // page really mounts it — and that each of the three quest-level slots is on screen
    // under its own mono key (the JSON block it replaced is gone, which is what the old
    // `m_requirements` text assertion here used to check).
    await main.getByRole('tab', { name: 'Requirements' }).click();
    await expect(main.getByRole('region', { name: 'Quest requirements editor' })).toBeVisible();
    // `exact`: five other regions on this tab carry a name containing "Requirements"
    // (the prep/prune/goal slots), which is what the substring match would hit.
    await expect(main.getByRole('region', { name: 'Requirements', exact: true })).toBeVisible();
    await expect(main.getByText('m_requirements', { exact: true })).toBeVisible();
    await expect(main.getByText('m_prepRequirements', { exact: true })).toBeVisible();
    await expect(main.getByText('m_pruneRequirements', { exact: true })).toBeVisible();

    // The Results tab is the fifth live editor (story p3-07): its own spec
    // (`quests-results-editor.spec.ts`) drives the 14-type forms, so this pins that the
    // detail page really mounts it — and that the seeded end result's raw drop-table id is
    // on screen. That id resolves in no names table this spec mocks, so the trigger shows
    // the id itself, which is the documented miss path rather than an error.
    await main.getByRole('tab', { name: 'Results' }).click();
    await expect(main.getByRole('region', { name: 'Quest results editor' })).toBeVisible();
    await expect(main.getByRole('region', { name: 'End results', exact: true })).toBeVisible();
    // The card by its address (`data-path`) and its class pair (task 7.9: the accessible name
    // reads the address in words and starts with the class's glossary pair).
    await expect(
      main.locator(
        'article[data-path="m_endResults.m_results[0]"][aria-label^="Reward: drop table (ResDropTable) "]',
      ),
    ).toBeVisible();
    await expect(main.getByText('WC-UNICORN-MAIN-007')).toBeVisible();

    await main.getByRole('tab', { name: 'Dialog' }).click();
    await expect(
      main.getByRole('heading', { name: 'Dialog list (m_dialogList)', exact: true }),
    ).toBeVisible();

    // The Dialog tab became the sixth live editor in p3-08, which is why the "Dialog is
    // read-only" loop that stood here has been replaced rather than weakened: its own spec
    // (`quests-dialog-editor.spec.ts`) drives the tag sections and the accordions, so this
    // pins that the detail page really mounts it and that the shared list editor rendered.
    // The extraction page's preview still renders the read-only `m_dialogList` JSON block.
    await expect(main.getByRole('region', { name: 'Quest dialog editor' })).toBeVisible();
    await expect(
      main.getByRole('region', { name: 'Quest dialog list', exact: true }),
    ).toBeVisible();
    await expect(
      main
        .getByRole('region', { name: 'Quest dialog list', exact: true })
        .getByRole('button', { name: 'Add Dialog Tag', exact: true }),
    ).toBeVisible();
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

    // Spec L326: 400px wide. Polled, because the panel slides in: an immediate
    // boundingBox() can land mid-transition and report a different width (p3-11).
    await expect.poll(async () => (await panel.boundingBox())?.width).toBe(400);

    // Syntax-highlighted JSON: the tree carries the field names and values...
    const tree = panel.getByRole('tree');
    await expect(tree).toContainText(MOCK_QUEST.m_questName);
    await expect(tree).toContainText('m_questLevel');
    // ...and the library's own colour classes (not plain text).
    expect(await tree.innerHTML()).toMatch(/color:rgb|class="_/);

    // The spec's `[Copy]` affordance works, and `[Wrap]` is a real toggle since story p3-10
    // (see `quests-edit-mode.spec.ts` for its wrapped/unwrapped rendering assertions).
    await panel.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByText('Quest JSON copied to the clipboard')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Wrap' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

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
      page_(page).getByRole('heading', { level: 2, name: 'DS-ACAD1-C01-001' }),
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
    await expect(main.getByRole('heading', { level: 2, name: 'DS-ACAD1-C01-001' })).toBeVisible();
    await expect(main.getByRole('tab', { name: 'Info' })).toBeVisible();
  });
});
