import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockQuestsApi, type QuestsMockRecorded } from './quests-mocks';

/**
 * Tier-1 **cross-cutting editor-shell** spec — plan phase 3 AC#13 / story p3-11
 * (decision D23 tier 1 / D40, harness isolation D44).
 *
 * This is the one spec that chains an interaction through the **editor shell** and reads the
 * result back through the surface the acceptance criterion names: the **JSON side panel**.
 * Each of the four interactions already has per-story coverage — do not read this file as a
 * second copy of them, and do not "fix" a drift here without checking the owned spec:
 *
 * | chain | interaction | owned by |
 * |---|---|---|
 * | 1 | a goal field edit reaches the panel | `quests-goals-editor.spec.ts` (p3-04) |
 * | 2 | deleting a referenced start goal → inline error + banner + Save disabled | `quests-validation.spec.ts` (p3-09) |
 * | 3 | adding a requirement leaf serializes into the document | `quests-requirements-editor.spec.ts` (p3-06) |
 * | 4 | adding a `GoalLogicEntry` from the flowchart toolbar | `quests-goal-logic.spec.ts` (p3-05) |
 *
 * What this file adds is the **chain**: the real `/quests/:questName` page in edit mode
 * (`EDIT_MODE_ON_LOAD` is `true`, D66 — the editors are live without a click), one interaction
 * driven through the shipped control, then the document read back through the panel's own
 * `[Copy]` affordance. Deliberately short: it re-asserts only the leaf facts a chain needs
 * (the interaction landed in the right place and nothing else moved), never the 66 dialog
 * fields, the 14 result types or the 5 goal types' full field sets — those belong to their
 * stories' specs, which are referenced in the chain comments below.
 *
 * **The panel read-back is `[Copy]`, not the rendered tree.** `QuestJsonPanel` draws
 * `react-json-view-lite` with `collapseAllNested`: the top-level keys are visible and every
 * nested node starts collapsed, so a goal field (inside `m_goals`) is a click away in the tree
 * while `[Copy]` serializes the **whole live document** the editors mutated
 * (`JSON.stringify(quest, null, 2)`). The four per-story specs read it exactly this way; the
 * clipboard is wiped before each read and polled after it, because the write is async and a
 * straight read can catch the previous document.
 *
 * **Fixture.** One compact quest, written out in full — a spec that imported the app's own
 * fixture could only prove the app agrees with itself. It is clean by construction, so chain 2's
 * "before" state is genuinely unblocked: three goals, one start goal, a unique `m_goalName` per
 * goal, and a goal-logic chain whose final entry carries `m_completeQuest: true` — i.e. it
 * violates none of the six blocking kinds `shared/quest/validation.ts` emits
 * (`quest-name-missing`, `start-goal-unknown`, `duplicate-goal-name`, `goal-logic-not-completing`,
 * `unknown-type`, `template-id-not-positive`). Nothing here needs the corpus, the D17 clone or a
 * synced database: `/api/quests`, the names tables and the status surface are all route-mocked.
 */

/* ------------------------------------------------------------------- fixtures */

const WAYPOINT = 'Imcodec.ObjectProperty.TypeCache.WaypointGoalTemplate, Imcodec.ObjectProperty';
const PERSONA = 'Imcodec.ObjectProperty.TypeCache.PersonaGoalTemplate, Imcodec.ObjectProperty';

/** The requirement `$type`s the "Add Condition" control writes (p3-06's new-node shape). */
const REQ_HAS_QUEST = 'Imcodec.ObjectProperty.TypeCache.ReqHasQuest, Imcodec.ObjectProperty';
const REQUIREMENT_LIST = 'Imcodec.ObjectProperty.TypeCache.RequirementList, Imcodec.ObjectProperty';

const QUEST_NAME = 'DS-ACAD1-C01-001';
const START_GOAL = '1_Start';
const MID_GOAL = '2_Mid';
const END_GOAL = '3_End';

/** The new proximity tag chain 1 types into the start goal. */
const NEW_PROXIMITY = 'CrystalGrove';

/** A goal in the corpus's shape; `extra` is the type's own fields. */
function goal(
  name: string,
  type: string,
  goalType: string,
  nameId: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    $type: type,
    m_goalName: name,
    m_goalType: goalType,
    m_goalNameID: nameId,
    m_goalTitle: name,
    m_clientTags: [],
    m_displayImage1: '',
    ...extra,
  };
}

/** One `m_goalLogic` entry, in the corpus's own key order. */
function entry(and: string[], toAdd: string[], complete: boolean): Record<string, unknown> {
  return {
    m_goalsAND: and,
    m_goalsOR: [],
    m_goalsToAdd: toAdd,
    m_completeQuest: complete,
    m_requiredORCount: 1,
  };
}

/**
 * The fixture quest, freshly built per call (a saved reference could only leak between tests).
 *
 * Chain 1's goal, `1_Start`, is the **start goal** and a Waypoint: it carries the
 * `m_proximityTag` chain 1 edits, and it is the goal chain 2 deletes so `m_startGoals` is left
 * dangling (p3-04's delete deliberately does not cascade — that reference is the point).
 * `m_requirements` is `null`, the corpus's own 8-of-322 empty slot chain 3 writes into.
 */
function quest(): Record<string, unknown> {
  return {
    m_questName: QUEST_NAME,
    m_questTitle: 'QuestTitle_1ED8D',
    m_questLevel: 7,
    m_mainline: true,
    m_goals: [
      goal(START_GOAL, WAYPOINT, 'GOAL_TYPE_WAYPOINT', 111, {
        m_zoneEntry: true,
        m_zoneExit: false,
        m_proximityTag: '',
      }),
      goal(MID_GOAL, PERSONA, 'GOAL_TYPE_PERSONA', 222),
      goal(END_GOAL, WAYPOINT, 'GOAL_TYPE_WAYPOINT', 333),
    ],
    m_startGoals: [START_GOAL],
    m_goalLogic: [
      entry([START_GOAL], [MID_GOAL], false),
      entry([MID_GOAL], [END_GOAL], false),
      entry([END_GOAL], [], true),
    ],
    m_requirements: null,
    m_startResults: { m_results: [] },
    m_endResults: { m_results: [] },
  };
}

/* --------------------------------------------------------------------- helpers */

/** The `<main>` region — the page, without the shell's sidebar/header. */
function main_(page: Page): Locator {
  return page.getByRole('main');
}

/** The Goals tab's editor, so a label lookup cannot escape into another tab. */
function goalsEditor(page: Page): Locator {
  return main_(page).getByRole('region', { name: 'Quest goals editor' });
}

/** The Goal Logic tab's editor (the toolbar lives here). */
function logicEditor(page: Page): Locator {
  return main_(page).getByRole('region', { name: 'Quest goal logic editor' });
}

/** The JSON side panel (desktop pane; the harness runs at Desktop Chrome's viewport). */
function jsonPanel(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Quest JSON' });
}

/** The header Save affordance whose `aria-disabled`/`data-blocked` follow validation. */
function saveButton(page: Page): Locator {
  return main_(page).getByRole('button', { name: 'Save', exact: true });
}

/** The form-level banner of a page with blocking findings (`role="alert"`). */
function blockingBanner(page: Page): Locator {
  return page.getByRole('alert', { name: 'Quest validation' });
}

/** The inline message list of a field, by the field's rendered document path. */
function fieldMessages(page: Page, field: string): Locator {
  return page.locator(`li[data-field="${field}"]`);
}

/** Opens the JSON side panel if it is not already up (a second read must not toggle it shut). */
async function openJson(page: Page): Promise<Locator> {
  if (!(await jsonPanel(page).isVisible())) {
    await page.getByRole('button', { name: 'Toggle JSON panel' }).click();
  }
  await expect(jsonPanel(page)).toBeVisible();
  return jsonPanel(page);
}

/**
 * The live document's text, read through the JSON panel's own `[Copy]` affordance.
 *
 * Wiped **first** so a second read in one test is a real read rather than a re-read of the
 * first; polled after, because the click starts an async serialize-then-write (`copyQuestJson`).
 */
async function copyPanelText(page: Page): Promise<string> {
  await openJson(page);
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.getByRole('button', { name: 'Copy' }).click();
  let text = '';
  await expect
    .poll(async () => {
      text = await page.evaluate(() => navigator.clipboard.readText());
      return text.trim().startsWith('{');
    })
    .toBe(true);
  return text;
}

/** {@link copyPanelText} parsed back, so a key can be compared exactly. */
async function copyPanelDocument(page: Page): Promise<Record<string, unknown>> {
  return JSON.parse(await copyPanelText(page)) as Record<string, unknown>;
}

/** `doc.m_goals` as the panel serialized it. */
function goalsOf(doc: Record<string, unknown>): Array<Record<string, unknown>> {
  return doc.m_goals as Array<Record<string, unknown>>;
}

/** The `m_goalName` of every goal the panel serialized, in document order. */
function goalNames(doc: Record<string, unknown>): unknown[] {
  return goalsOf(doc).map((goal_) => goal_.m_goalName);
}

/** `doc.m_goalLogic` as the panel serialized it. */
function entriesOf(doc: Record<string, unknown>): Array<Record<string, unknown>> {
  return doc.m_goalLogic as Array<Record<string, unknown>>;
}

/**
 * Opens the detail page in edit mode with the whole data surface mocked, and returns what the
 * mock recorded plus the document it served.
 *
 * The five bulk reference tables the validation engine injects (D65(c)) are mocked **empty**, so
 * the reference rules treat every non-empty path/id as absent — deterministic in CI, where the
 * isolated database's contents are not a fixture (`quests-edit-mode.spec.ts`'s own choice). The
 * single-id lookups 404, the documented miss, so nothing reaches the dev stack's database.
 */
async function openQuest(page: Page): Promise<{
  recorded: QuestsMockRecorded;
  served: Record<string, unknown>;
}> {
  const served = quest();
  const recorded = await mockQuestsApi(page, { detail: served });
  for (const type of ['zones', 'npcs', 'spells', 'drop_tables', 'quests']) {
    await page.route(`**/api/names/${type}`, (route) =>
      route.fulfill({ json: { [type]: [] } satisfies Record<string, unknown[]> }),
    );
    await page.route(`**/api/names/${type}/*`, (route) =>
      route.fulfill({ status: 404, json: { error: `Unknown ${type} id` } }),
    );
  }
  await page.goto(`/quests/${QUEST_NAME}`);
  return { recorded, served };
}

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
});

/* ---------------------------------------------------- chain 1 — a goal field edit */

test.describe('AC#13 chain 1 — a goal field edit reaches the JSON panel', () => {
  /**
   * The AC's first clause ("edit a goal field → JSON side panel reflects it"), driven as a
   * chain: load the detail page in edit mode, expand the start goal's card, type into its
   * `m_proximityTag` (a Waypoint type field, p3-04's own control — the per-type field sets are
   * asserted in `quests-goals-editor.spec.ts`), then read the panel back.
   */
  test('editing m_proximityTag on the start goal card shows up in the panel document', async ({
    page,
  }) => {
    const { served } = await openQuest(page);

    // The panel is live from the start: it draws the document the page loaded.
    const panel = await openJson(page);
    await expect(panel.getByRole('tree')).toContainText(QUEST_NAME);
    expect(goalsOf(await copyPanelDocument(page))[0].m_proximityTag).toBe('');

    // One interaction through the shipped control, no refresh and no re-fetch.
    await main_(page).getByRole('tab', { name: 'Goals' }).click();
    const card = goalsEditor(page).getByRole('article').first();
    await card.getByRole('button', { name: 'Edit' }).click();
    await card.getByLabel('Proximity Tag (m_proximityTag)', { exact: true }).fill(NEW_PROXIMITY);

    const doc = await copyPanelDocument(page);
    const goals = goalsOf(doc);
    expect(goals[0].m_proximityTag).toBe(NEW_PROXIMITY);
    // The chain's own "nothing else moved" clause: the edited goal's other keys and the two
    // goals the user did not touch are byte-identical to what the page served.
    expect(goals[0].m_goalName).toBe(START_GOAL);
    expect(goals[0].m_zoneEntry).toBe(true);
    expect(JSON.stringify(goals[1])).toBe(JSON.stringify((served.m_goals as unknown[])[1]));
    expect(JSON.stringify(goals[2])).toBe(JSON.stringify((served.m_goals as unknown[])[2]));
    expect(doc.m_questName).toBe(QUEST_NAME);
  });
});

/* ------------------------------------- chain 2 — a referenced start goal goes dangling */

test.describe('AC#13 chain 2 — deleting a referenced start goal blocks the save', () => {
  /**
   * The AC's second clause ("delete a referenced start goal → inline error + Save disabled"),
   * all three named states, plus the document behind them read through the panel.
   *
   * This is the same fault `quests-validation.spec.ts` owns (p3-09's AC1); here it is reached
   * from a clean load through the shell and the panel read is what this spec adds — the dangling
   * reference is visible in the document, not inferred from the UI state.
   */
  test('shows the inline error and banner, disables Save, and the panel shows the dangling name', async ({
    page,
  }) => {
    await openQuest(page);
    await main_(page).getByRole('tab', { name: 'Goals' }).click();
    await expect(goalsEditor(page)).toBeVisible();

    // A genuinely clean start: the banner would make every "Save is blocked" claim vacuous.
    await expect(page.getByTestId('start-goals-validation')).toHaveCount(0);
    await expect(blockingBanner(page)).toHaveCount(0);
    await expect(saveButton(page)).toHaveAttribute('data-blocked', 'false');

    // The start goal's own Delete (p3-04) — it deliberately leaves `m_startGoals` alone.
    await goalsEditor(page)
      .getByRole('article')
      .first()
      .getByRole('button', { name: `Delete ${START_GOAL}` })
      .click();

    // 1. The inline error on the `m_startGoals` surface (the field's own red-bordered strip).
    const inline = page.getByTestId('start-goals-validation');
    await expect(inline).toBeVisible();
    await expect(inline).toContainText('m_startGoals');
    await expect(inline).toContainText(`The start goal "${START_GOAL}" is not defined in m_goals.`);
    await expect(fieldMessages(page, 'm_startGoals[0]')).toHaveCount(1);
    await expect(fieldMessages(page, 'm_startGoals[0]')).toHaveAttribute('data-severity', 'error');

    // 2. The form-level banner names the kind that blocks.
    await expect(blockingBanner(page)).toContainText('Unknown start goal');

    // 3. Save is disabled, and explains itself through the banner.
    const save = saveButton(page);
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    await expect(save).toHaveAttribute('data-blocked', 'true');
    await expect(save).toHaveAttribute('aria-describedby', 'quest-validation-banner');

    // The document behind those states: the goal is gone from `m_goals` while `m_startGoals`
    // still names it. Byte-compare the survivors so "only the deleted goal moved" is asserted.
    const doc = await copyPanelDocument(page);
    expect(doc.m_startGoals).toEqual([START_GOAL]);
    expect(goalNames(doc)).toEqual([MID_GOAL, END_GOAL]);
    expect(JSON.stringify(goalsOf(doc)[0])).toBe(
      JSON.stringify(goal(MID_GOAL, PERSONA, 'GOAL_TYPE_PERSONA', 222)),
    );
  });
});

/* ------------------------------------------ chain 3 — a new requirement leaf serializes */

test.describe('AC#13 chain 3 — adding a requirement leaf serializes into the panel', () => {
  /**
   * The AC's third clause ("add a requirement leaf → serialized shape asserted via the panel").
   *
   * The leaf itself, the four-type selector and the AND/OR/NOT controls are p3-06's coverage;
   * what this chain asserts is that one "Add Condition" click on the real page lands the
   * corpus's **wrapper shape** in the document and that the panel serializes it in the
   * corpus's key order (`$type` first on both nodes) — order is what deep equality cannot see.
   */
  test('one Add Condition click writes the wrapper + ReqHasQuest leaf the panel reports', async ({
    page,
  }) => {
    await openQuest(page);
    await main_(page).getByRole('tab', { name: 'Requirements' }).click();
    const editor = main_(page).getByRole('region', {
      name: 'Quest requirements editor',
      exact: true,
    });
    await expect(editor).toBeVisible();

    // The empty slot the corpus carries in 8 of its 322 quests; merely opening writes nothing.
    expect((await copyPanelDocument(page)).m_requirements).toBeNull();

    const tree = editor.getByRole('region', { name: 'Requirements', exact: true });
    await tree.getByRole('button', { name: 'Add Condition to Requirements', exact: true }).click();

    const doc = await copyPanelDocument(page);
    const wrapper = doc.m_requirements as Record<string, unknown>;
    expect(wrapper).toEqual({
      $type: REQUIREMENT_LIST,
      m_applyNOT: false,
      m_operator: 'ROP_AND',
      m_requirements: [
        { $type: REQ_HAS_QUEST, m_applyNOT: false, m_operator: 'ROP_AND', m_questName: '' },
      ],
    });
    // The serialized shape's key order, node by node (corpus order, not the fixture's).
    expect(Object.keys(wrapper)).toEqual(['$type', 'm_applyNOT', 'm_operator', 'm_requirements']);
    expect(Object.keys((wrapper.m_requirements as unknown[])[0] as object)).toEqual([
      '$type',
      'm_applyNOT',
      'm_operator',
      'm_questName',
    ]);
    // The visible tree agrees with the document it wrote.
    await expect(
      tree.getByRole('article', {
        name: 'Requires quest (ReqHasQuest) Requirements 1',
        exact: true,
      }),
    ).toBeVisible();
  });
});

/* ---------------------------------------- chain 4 — a GoalLogicEntry from the flowchart */

test.describe('AC#13 chain 4 — a GoalLogicEntry from the toolbar reaches the panel', () => {
  /**
   * The AC's fourth clause ("add a GoalLogicEntry via flowchart toolbar → appears in the JSON
   * panel"). p3-05 owns the canvas, the edges and the inspector; this chain asserts the toolbar
   * click appends the corpus's five-key entry, key order included, and that the inspector's own
   * list shows it (the UI half of "appears").
   */
  test('the toolbar appends the corpus five-key entry and the panel carries it', async ({
    page,
  }) => {
    const { served } = await openQuest(page);
    await main_(page).getByRole('tab', { name: 'Goal Logic' }).click();
    const editor = logicEditor(page);
    await expect(editor).toBeVisible();
    // React Flow measures its container on mount: three goal nodes plus the Complete node.
    const canvas = editor.getByRole('group', { name: 'Goal logic flowchart' });
    await expect(canvas.locator('.react-flow__node')).toHaveCount(4);

    expect(entriesOf(await copyPanelDocument(page))).toHaveLength(3);

    await editor.getByRole('button', { name: 'Add GoalLogicEntry', exact: true }).click();

    const entries = entriesOf(await copyPanelDocument(page));
    expect(entries).toHaveLength(4);
    // The whole five-key shape, in the corpus's own key order.
    expect(Object.keys(entries[3])).toEqual([
      'm_goalsAND',
      'm_goalsOR',
      'm_goalsToAdd',
      'm_completeQuest',
      'm_requiredORCount',
    ]);
    expect(entries[3]).toEqual({
      m_goalsAND: [],
      m_goalsOR: [],
      m_goalsToAdd: [],
      m_completeQuest: false,
      m_requiredORCount: 1,
    });
    // The chain's "nothing else moved" clause: the three served entries survive key for key.
    expect(JSON.stringify(entries.slice(0, 3))).toBe(JSON.stringify(served.m_goalLogic));

    // …and the entry is listed and selected in the inspector, right away.
    await expect(editor.getByRole('button', { name: 'Entry 4: (no conditions)' })).toBeVisible();
    await expect(editor.getByRole('group', { name: 'Goal logic entry inspector' })).toBeVisible();
  });
});
