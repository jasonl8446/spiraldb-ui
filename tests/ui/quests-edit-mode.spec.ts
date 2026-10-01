import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockQuestsApi, type QuestsMockRecorded } from './quests-mocks';

/**
 * Tier-1 edit-mode spec (plan task 3.10 / story p3-10, decision D23 tier 1 / D40).
 *
 * Drives the real `/quests/:questName` page in headless chromium with every route mocked, and
 * covers the three acceptance criteria that can be proven hermetically:
 *
 * - **AC2** — the JSON side panel live-updates from the form on every edit with no manual
 *   refresh, the `{ }` toggle and the mobile full-screen overlay work, and **`[Copy]` and
 *   `[Wrap]` are both present** with `[Wrap]` a real toggle (wrapped text versus a horizontal
 *   scrollbar), not a disabled decoration;
 * - **AC3** — the unsaved-changes guard stays off on a clean document, fires on an in-app
 *   navigation while dirty, `Stay` keeps the edits, `Discard changes` leaves, the header's
 *   **Discard** restores the loaded document exactly, and `beforeunload` is prevented only while
 *   dirty;
 * - **AC4** — Save posts the **live document** to `POST /api/quests`, toasts
 *   `Quest {name} saved and committed` verbatim, and does not touch the verification status
 *   (no `PATCH /api/status` is issued at all).
 *
 * **AC1 is not here on purpose.** "Real-quest edit isolation" needs a real corpus file, a real
 * save pipeline and a real `git diff` in the D17 clone, which a hermetic tier-1 spec cannot do
 * (D40); it is proven by `tests/unit/quest-edit-isolation.test.ts`, and the mode toggle that spec
 * does *not* cover (`Edit` swapping the editors for the read-only bodies) is the first test here.
 *
 * The fixture is written out rather than imported from another spec: it is the same clean shape
 * `quests-validation.spec.ts` uses for its clean case, and sharing it would only let the two
 * specs agree with each other.
 */

const WAYPOINT = 'Imcodec.ObjectProperty.TypeCache.WaypointGoalTemplate, Imcodec.ObjectProperty';
const PERSONA = 'Imcodec.ObjectProperty.TypeCache.PersonaGoalTemplate, Imcodec.ObjectProperty';

/** The loaded title, and the distinctive new one the edits type in. */
const TITLE = 'QuestTitle_1ED8D';
const NEW_TITLE = 'QuestTitle_P310';

/**
 * A quest that violates none of the six blocking rules (so Save is genuinely available — the
 * shared `MOCK_QUEST` carries a deliberately blocking finding and would make every save
 * assertion vacuous).
 */
const CLEAN_QUEST: Record<string, unknown> = {
  m_questName: 'DS-ACAD1-C01-001',
  m_questTitle: TITLE,
  m_questLevel: 7,
  m_mainline: true,
  m_goals: [
    {
      $type: WAYPOINT,
      m_goalName: '1_Start',
      m_goalType: 'GOAL_TYPE_WAYPOINT',
      m_goalNameID: 111,
    },
    {
      $type: PERSONA,
      m_goalName: '2_Mid',
      m_goalType: 'GOAL_TYPE_PERSONA',
      m_goalNameID: 222,
    },
  ],
  m_startGoals: ['1_Start'],
  m_goalLogic: [
    {
      m_goalsAND: ['1_Start'],
      m_goalsOR: [],
      m_goalsToAdd: ['2_Mid'],
      m_completeQuest: true,
      m_requiredORCount: 1,
    },
  ],
  m_endResults: { m_results: [] },
};

/* ------------------------------------------------------------------ helpers */

/** The `<main>` region — the page, without the shell's sidebar/header. */
function main_(page: Page): Locator {
  return page.getByRole('main');
}

/** The page's mode markers (story p3-10): `data-edit-mode` + `data-dirty` on the page root. */
function root(page: Page): Locator {
  return main_(page).locator('[data-edit-mode]');
}

function editToggle(page: Page): Locator {
  return main_(page).getByRole('button', { name: 'Edit' });
}

function saveButton(page: Page): Locator {
  return main_(page).getByRole('button', { name: 'Save', exact: true });
}

function discardButton(page: Page): Locator {
  return main_(page).getByRole('button', { name: 'Discard', exact: true });
}

function jsonToggle(page: Page): Locator {
  return page.getByRole('button', { name: 'Toggle JSON panel' });
}

function sidePanel(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Quest JSON' });
}

function unsavedDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Unsaved changes' });
}

/** The rendered JSON tree's own element — the wrap marker's inner container. */
function jsonContainer(scope: Locator): Locator {
  return scope.locator('[data-wrap] > div').first();
}

/** Opens the detail page with the whole quests/names surface mocked and a clean fixture. */
async function openCleanQuest(
  page: Page,
  options: Parameters<typeof mockQuestsApi>[1] = {},
): Promise<QuestsMockRecorded> {
  const recorded = await mockQuestsApi(page, { detail: CLEAN_QUEST, ...options });
  // The five bulk reference tables the validation engine injects (D65(c)); empty on purpose, so
  // the engine treats every reference as absent instead of warning about real ids.
  for (const type of ['zones', 'npcs', 'spells', 'drop_tables', 'quests']) {
    await page.route(`**/api/names/${type}`, (route) =>
      route.fulfill({ json: { [type]: [] } satisfies Record<string, unknown[]> }),
    );
  }
  await page.goto('/quests/DS-ACAD1-C01-001');
  // p7-14 (D133): the page lands on Overview; these specs drive the Info editor, so open it.
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  return recorded;
}

/* ------------------------------------------------------------------ the mode */

test.describe('view/edit mode', () => {
  test('edit mode is the load state and Edit swaps in the read-only bodies', async ({ page }) => {
    await openCleanQuest(page);

    // Edit mode: the six live editors, Save, and no Discard on a clean document.
    await expect(root(page)).toHaveAttribute('data-edit-mode', 'true');
    await expect(root(page)).toHaveAttribute('data-dirty', 'false');
    await expect(main_(page).getByRole('region', { name: 'Quest info editor' })).toBeVisible();
    await expect(saveButton(page)).toBeVisible();
    await expect(saveButton(page)).toHaveAttribute('data-save-wired', 'true');
    await expect(discardButton(page)).toHaveCount(0);
    await expect(editToggle(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(editToggle(page)).toHaveAttribute('title', 'Switch to view mode');

    // View mode: the same tabs, rendered by p2-07's read-only bodies; no Save affordance at all.
    await editToggle(page).click();
    await expect(root(page)).toHaveAttribute('data-edit-mode', 'false');
    await expect(main_(page).getByRole('region', { name: 'Quest info editor' })).toHaveCount(0);
    await expect(
      main_(page).getByRole('region', { name: 'Quest info', exact: true }),
    ).toBeVisible();
    await expect(saveButton(page)).toHaveCount(0);
    await expect(editToggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(editToggle(page)).toHaveAttribute('title', 'Switch to edit mode');

    // …and back, so the toggle is a toggle and not a one-way latch.
    await editToggle(page).click();
    await expect(root(page)).toHaveAttribute('data-edit-mode', 'true');
    await expect(main_(page).getByRole('region', { name: 'Quest info editor' })).toBeVisible();
  });
});

/* -------------------------------------------------------------------- AC2 */

test.describe('the JSON side panel (AC2)', () => {
  test('reflects a form edit with no manual refresh', async ({ page }) => {
    await openCleanQuest(page);
    await jsonToggle(page).click();

    const panel = sidePanel(page);
    const tree = panel.getByRole('tree');
    await expect(tree).toContainText(TITLE);
    await expect(tree).not.toContainText(NEW_TITLE);

    // One form edit, no re-fetch, no refresh: the panel is fed the editor's live document.
    await main_(page).getByLabel('m_questTitle').fill(NEW_TITLE);
    await expect(root(page)).toHaveAttribute('data-dirty', 'true');
    await expect(tree).toContainText(NEW_TITLE);
    await expect(tree).not.toContainText(TITLE);
  });

  test('carries both [Copy] and [Wrap], and Wrap really changes the rendering', async ({
    page,
  }) => {
    await openCleanQuest(page);
    await jsonToggle(page).click();
    const panel = sidePanel(page);

    await expect(panel.getByRole('button', { name: 'Copy' })).toBeVisible();
    const wrap = panel.getByRole('button', { name: 'Wrap' });
    await expect(wrap).toBeVisible();

    // Wrapped is the default (the panel's behaviour before p3-10 was wrap-always).
    await expect(wrap).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('[data-wrap]')).toHaveAttribute('data-wrap', 'true');
    await expect(jsonContainer(panel)).toHaveClass(/whitespace-pre-wrap/);

    // Unwrapped: `white-space: pre` plus a horizontal scroll container — a real control.
    await wrap.click();
    await expect(wrap).toHaveAttribute('aria-pressed', 'false');
    await expect(panel.locator('[data-wrap]')).toHaveAttribute('data-wrap', 'false');
    await expect(jsonContainer(panel)).toHaveClass(/whitespace-pre\b/);
    await expect(jsonContainer(panel)).not.toHaveClass(/whitespace-pre-wrap/);

    await wrap.click();
    await expect(wrap).toHaveAttribute('aria-pressed', 'true');
    await expect(jsonContainer(panel)).toHaveClass(/whitespace-pre-wrap/);
  });

  test('the mobile full-screen overlay carries the same toolbar and a working Wrap', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await openCleanQuest(page);
    await jsonToggle(page).click();

    // Full screen instead of a 400px pane (spec L340) — and no pane beside it.
    await expect(sidePanel(page)).toHaveCount(0);
    const dialog = page.getByRole('dialog', { name: 'Quest JSON' });
    await expect(dialog).toBeVisible();

    await expect(dialog.getByRole('button', { name: 'Copy' })).toBeVisible();
    const wrap = dialog.getByRole('button', { name: 'Wrap' });
    await wrap.click();
    await expect(dialog.locator('[data-wrap]')).toHaveAttribute('data-wrap', 'false');
    await expect(jsonContainer(dialog)).toHaveClass(/whitespace-pre\b/);
  });
});

/* -------------------------------------------------------------------- AC3 */

test.describe('the unsaved-changes guard (AC3)', () => {
  test('stays off on a clean document: the back link navigates straight away', async ({ page }) => {
    await openCleanQuest(page);
    await root(page).waitFor();

    // A guard that fires on a clean document would make every navigation a question.
    await main_(page).getByRole('link', { name: 'Back to Quests' }).click();
    await expect(unsavedDialog(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/quests$/);
  });

  test('blocks an in-app navigation while dirty, and Stay keeps the edit', async ({ page }) => {
    await openCleanQuest(page);
    await main_(page).getByLabel('m_questTitle').fill(NEW_TITLE);
    await expect(root(page)).toHaveAttribute('data-dirty', 'true');

    await main_(page).getByRole('link', { name: 'Back to Quests' }).click();

    const dialog = unsavedDialog(page);
    await expect(dialog).toBeVisible();
    // Nothing navigated: the URL and the page are untouched.
    await expect(page).toHaveURL(/\/quests\/DS-ACAD1-C01-001$/);

    await dialog.getByRole('button', { name: 'Stay' }).click();
    await expect(unsavedDialog(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/quests\/DS-ACAD1-C01-001$/);
    // The typed value and the dirty marker survived the cancelled navigation.
    await expect(main_(page).getByLabel('m_questTitle')).toHaveValue(NEW_TITLE);
    await expect(root(page)).toHaveAttribute('data-dirty', 'true');
  });

  test('Discard changes leaves for the destination', async ({ page }) => {
    await openCleanQuest(page);
    await main_(page).getByLabel('m_questTitle').fill(NEW_TITLE);

    await main_(page).getByRole('link', { name: 'Back to Quests' }).click();
    await unsavedDialog(page).getByRole('button', { name: 'Discard changes' }).click();

    await expect(page).toHaveURL(/\/quests$/);
    await expect(unsavedDialog(page)).toHaveCount(0);
  });

  test('the header Discard restores the loaded document exactly', async ({ page }) => {
    await openCleanQuest(page);
    await jsonToggle(page).click();
    const panel = sidePanel(page);
    const before = await jsonContainer(panel).innerText();

    await main_(page).getByLabel('m_questTitle').fill(NEW_TITLE);
    await main_(page).getByLabel('m_questLevel').fill('42');
    await expect(root(page)).toHaveAttribute('data-dirty', 'true');
    await expect(jsonContainer(panel)).not.toHaveText(before);

    // Discard is offered only while there is something to discard.
    await discardButton(page).click();

    await expect(root(page)).toHaveAttribute('data-dirty', 'false');
    await expect(discardButton(page)).toHaveCount(0);
    await expect(main_(page).getByLabel('m_questTitle')).toHaveValue(TITLE);
    await expect(main_(page).getByLabel('m_questLevel')).toHaveValue('7');
    // The whole document's rendering is back to the loaded one — key order included, since the
    // tree draws the serialized document.
    expect(await jsonContainer(panel).innerText()).toBe(before);
  });

  test('beforeunload is prevented only while the document is dirty', async ({ page }) => {
    await openCleanQuest(page);

    // Synthetic dispatch: the handler is the product code either way, and a real window close
    // cannot be asserted from inside the page.
    const clean = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(clean).toBe(false);

    await main_(page).getByLabel('m_questTitle').fill(NEW_TITLE);
    await expect(root(page)).toHaveAttribute('data-dirty', 'true');

    const dirty = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(dirty).toBe(true);
  });
});

/* -------------------------------------------------------------------- AC4 */

test.describe('the save pipeline (AC4)', () => {
  test('posts the live document, toasts exactly once and leaves the status alone', async ({
    page,
  }) => {
    const recorded = await openCleanQuest(page);

    // The clean fixture really is unblocked (a drifting fixture must fail loudly here, not make
    // this test vacuous).
    await expect(saveButton(page)).toHaveAttribute('data-blocked', 'false');
    await expect(main_(page).getByLabel('Status: Extracted')).toBeVisible();

    await main_(page).getByLabel('m_questTitle').fill(NEW_TITLE);
    await main_(page).getByLabel('m_questLevel').fill('42');
    await expect(root(page)).toHaveAttribute('data-dirty', 'true');

    await saveButton(page).click();

    // The payload is the live document: the two edited fields, and an untouched one intact.
    await expect(page.getByText('Quest DS-ACAD1-C01-001 saved and committed')).toBeVisible();
    expect(recorded.savePosts).toHaveLength(1);
    const sent = recorded.savePosts[0].quest as Record<string, unknown>;
    expect(sent.m_questTitle).toBe(NEW_TITLE);
    expect(sent.m_questLevel).toBe(42);
    expect(sent.m_questName).toBe('DS-ACAD1-C01-001');
    expect(sent.m_mainline).toBe(true);

    // The status never moves: no transition request was made, and the badge is unchanged.
    expect(recorded.patches).toHaveLength(0);
    await expect(main_(page).getByLabel('Status: Extracted')).toBeVisible();

    // The save adopted the written document: the session is clean again, so the guard is off.
    await expect(root(page)).toHaveAttribute('data-dirty', 'false');
    await main_(page).getByRole('link', { name: 'Back to Quests' }).click();
    await expect(unsavedDialog(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/quests$/);
  });

  test('a blocked document never posts (the gate is the validator, not the button)', async ({
    page,
  }) => {
    // The shared `MOCK_QUEST` carries a blocking finding deliberately (its final logic entry does
    // not complete the quest), so this is the state the p3-09 gate exists for.
    const recorded = await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');

    const save = saveButton(page);
    await expect(save).toHaveAttribute('data-blocked', 'true');
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    await save.click({ force: true });

    expect(recorded.savePosts).toHaveLength(0);
  });

  test('a failed save reports the server message and keeps the guard armed', async ({ page }) => {
    const failure = 'Cannot save to SpiralDB: settings.user_name is empty.';
    await openCleanQuest(page, {
      onSave: (route) => route.fulfill({ status: 500, json: { error: failure } }),
    });

    await main_(page).getByLabel('m_questTitle').fill(NEW_TITLE);
    await saveButton(page).click();

    await expect(page.getByText(failure)).toBeVisible();
    // Nothing was written, so the edits are still unsaved and the guard must still fire.
    await expect(root(page)).toHaveAttribute('data-dirty', 'true');
    await main_(page).getByRole('link', { name: 'Back to Quests' }).click();
    await expect(unsavedDialog(page)).toBeVisible();
  });
});
