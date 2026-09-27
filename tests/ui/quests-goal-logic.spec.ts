import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockQuestsApi } from './quests-mocks';

/**
 * Tier-1 Goal Logic flowchart spec (plan task 3.5 / story p3-05, decision D23 tier 1 / D40).
 *
 * Drives the real `/quests/:questName` page in headless chromium with the API route-mocked,
 * exactly like `quests-goals-editor.spec.ts`. Nothing here needs the corpus or a database.
 *
 * What this file proves, clause by clause of the story's acceptance criterion:
 *
 * - the canvas renders one node per goal plus the synthetic **Complete** node, and every
 *   goal's name is on its own node;
 * - the AND dependencies are solid and the OR dependencies are dashed (asserted on the
 *   rendered `stroke-dasharray`, not on a class name), and each edge carries its condition
 *   type as a label;
 * - the dagre layout is left-to-right: a prerequisite's node is left of everything it
 *   activates, siblings share a column, and no two nodes overlap — and the `Auto-layout`
 *   control restores those positions after a node has been dragged off its rank;
 * - adding a `GoalLogicEntry` from the toolbar writes a corpus-shaped entry into the live
 *   `m_goalLogic`, read back through the JSON panel's own `[Copy]` affordance;
 * - deleting a goal from a node's context menu strands its dependants and raises the
 *   warning banner with the spec's verbatim sentence (spec-ui-design.md L384);
 * - deleting a *dependency edge* (select + `Delete`) rewrites the entry's own condition
 *   list — and, honestly, does **not** raise the banner: removing a condition can only make
 *   an entry easier to satisfy, never strand a goal (see the module header of
 *   `lib/quest-goal-logic.ts` on vacuous entries);
 * - the node context menu lists exactly `Edit Goal` / `Delete` / `Set as Start Goal`, the
 *   third item follows the goal's membership, and `Edit Goal` really hands the user to the
 *   Goals tab.
 *
 * **Fixture-only facts, stated plainly.** The real corpus has `m_goalsOR: []` and
 * `m_requiredORCount: 1` in all 742 entries (measured; see the model's module header), so the
 * dashed OR edges and the multi-prerequisite entry below are hand-written to exercise a path
 * the corpus never takes. The solid AND chain, the completing entry, the Complete node and
 * the disconnected banner are the corpus's own shape.
 *
 * The fixture strings are written out in full rather than imported from the app: a spec that
 * imported the copy it asserts could only prove the app agrees with itself.
 */

const WAYPOINT = 'Imcodec.ObjectProperty.TypeCache.WaypointGoalTemplate, Imcodec.ObjectProperty';

/** The banner's sentence, verbatim from docs/spec-ui-design.md L384. */
const BANNER_TEXT =
  '⚠️ Goal logic has disconnected nodes. All goals must be reachable from start goals.';

/** The goals, in `m_goals` order. `2_Spine` is load-bearing: deleting it strands four goals. */
const NAMES = ['1_Start', '2_Spine', '3_Left', '4_Right', '5_Join', '6_End'];

/** A goal in the corpus's own shape, reduced to what the flowchart reads. */
function goal(name: string): Record<string, unknown> {
  return {
    $type: WAYPOINT,
    m_goalName: name,
    m_goalType: 'GOAL_TYPE_WAYPOINT',
    m_goalTitle: name,
    m_locationName: '',
    m_clientTags: [],
  };
}

/** The five-key entry shape every corpus entry carries, in the corpus's key order. */
function entry(
  and: string[],
  or: string[],
  toAdd: string[],
  complete: boolean,
  requiredORCount = 1,
): Record<string, unknown> {
  return {
    m_goalsAND: and,
    m_goalsOR: or,
    m_goalsToAdd: toAdd,
    m_completeQuest: complete,
    m_requiredORCount: requiredORCount,
  };
}

/**
 * A six-goal quest: a start goal, a spine that fans into two branches, a dashed OR join and a
 * completing entry — AC1's multi-goal shape. All six goals are reachable from `1_Start`.
 */
const LOGIC_QUEST: Record<string, unknown> = {
  m_questName: 'DS-ACAD1-C01-001',
  m_questTitle: 'QuestTitle_1ED8D',
  m_questLevel: 7,
  m_mainline: true,
  m_isHidden: false,
  m_questRepeat: 0,
  m_startGoals: ['1_Start'],
  m_goals: NAMES.map(goal),
  m_goalLogic: [
    entry(['1_Start'], [], ['2_Spine'], false),
    entry(['2_Spine'], [], ['3_Left'], false),
    entry(['2_Spine'], [], ['4_Right'], false),
    entry([], ['3_Left', '4_Right'], ['5_Join'], false),
    entry(['5_Join'], [], ['6_End'], false),
    entry(['6_End'], [], [], true),
  ],
  m_startResults: { m_results: [] },
  m_endResults: { m_results: [] },
  m_dialogList: { m_dialogEntries: [] },
};

/* --------------------------------------------------------------------- helpers */

/** The `<main>` region — the page, without the shell's sidebar/header. */
function main_(page: Page): Locator {
  return page.getByRole('main');
}

/** The Goal Logic editor's own section, so a label lookup cannot escape into another tab. */
function editor(page: Page): Locator {
  return main_(page).getByRole('region', { name: 'Quest goal logic editor' });
}

/** The canvas container — the accessible name the story asks the canvas to carry. */
function canvas(page: Page): Locator {
  return editor(page).getByRole('group', { name: 'Goal logic flowchart' });
}

/** The node whose text contains `name` (one node per goal, so this is unambiguous). */
function nodeNamed(page: Page, name: string): Locator {
  return canvas(page).locator('.react-flow__node').filter({ hasText: name });
}

/** Every rendered edge. */
function flowEdges(page: Page): Locator {
  return canvas(page).locator('.react-flow__edge');
}

/** The edges React Flow drew dashed — the OR dependencies. */
function dashedEdges(page: Page): Locator {
  return flowEdges(page).filter({
    has: page.locator('.react-flow__edge-path[style*="stroke-dasharray"]'),
  });
}

/** Opens the JSON side panel. */
async function openJson(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Toggle JSON panel' }).click();
  const panel = page.getByRole('complementary', { name: 'Quest JSON' });
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * The live document, read through the JSON panel's own `[Copy]` affordance (the panel's
 * serialization of the document the editors mutated), parsed back so a key can be compared
 * exactly instead of by substring.
 */
async function copyPanelDocument(page: Page): Promise<Record<string, unknown>> {
  await page.getByRole('button', { name: 'Copy' }).click();
  // The click starts an async serialize-then-write; reading the clipboard straight after can
  // catch it empty (or the previous document). Poll until the panel's JSON is there.
  let text = '';
  await expect
    .poll(async () => {
      text = await page.evaluate(() => navigator.clipboard.readText());
      return text.trim().startsWith('{');
    })
    .toBe(true);
  return JSON.parse(text) as Record<string, unknown>;
}

/** `doc.m_goalLogic` as the panel serialized it. */
function entriesOf(doc: Record<string, unknown>): Array<Record<string, unknown>> {
  return doc.m_goalLogic as Array<Record<string, unknown>>;
}

/** Opens the Goal Logic tab on the fixture quest. */
async function openGoalLogic(page: Page): Promise<void> {
  await mockQuestsApi(page, { detail: LOGIC_QUEST });
  await page.goto('/quests/DS-ACAD1-C01-001');
  await main_(page).getByRole('tab', { name: 'Goal Logic' }).click();
  await expect(editor(page)).toBeVisible();
  // React Flow measures its container on mount; the nodes appear once it has a size.
  await expect(canvas(page).locator('.react-flow__node')).toHaveCount(NAMES.length + 1);
}

/** A node's box, in page coordinates (the canvas is fit-to-view, so this is screen space). */
async function boxOf(
  page: Page,
  name: string,
): Promise<{ x: number; y: number; w: number; h: number }> {
  const box = await nodeNamed(page, name).boundingBox();
  if (box === null) {
    throw new Error(`no box for node ${name}`);
  }
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

/** Opens a node's context menu and returns it. */
async function openMenu(page: Page, name: string): Promise<Locator> {
  await nodeNamed(page, name).click({ button: 'right' });
  const menu = canvas(page).getByRole('menu', { name: 'Goal node actions' });
  await expect(menu).toBeVisible();
  return menu;
}

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
});

/* ------------------------------------------------------------------ the canvas */

test.describe('the flowchart canvas', () => {
  test('draws one node per goal plus the Complete node', async ({ page }) => {
    await openGoalLogic(page);

    for (const name of NAMES) {
      await expect(nodeNamed(page, name)).toHaveCount(1);
    }
    // The goal names are the node text, and no node is a ghost: one per goal and one more.
    await expect(canvas(page).locator('.react-flow__node')).toHaveCount(NAMES.length + 1);
    await expect(canvas(page).getByText('✓ Complete')).toHaveCount(1);
    // The type text is the `$type`'s TypeName (D60h), the same text the Goals tab shows.
    await expect(nodeNamed(page, '1_Start')).toContainText('WaypointGoalTemplate');
    // `1_Start` is the only start goal, so the Start badge is on exactly one node.
    await expect(canvas(page).getByText('Start', { exact: true })).toHaveCount(1);
  });

  test('draws solid AND edges, dashed OR edges and the completing edge into Complete', async ({
    page,
  }) => {
    await openGoalLogic(page);

    // Five solid (four AND + the completing edge) and two dashed (the OR pair).
    await expect(flowEdges(page)).toHaveCount(7);
    await expect(dashedEdges(page)).toHaveCount(2);

    // Each edge is labelled with its condition type.
    await expect(canvas(page).getByText('AND', { exact: true })).toHaveCount(4);
    await expect(canvas(page).getByText('OR', { exact: true })).toHaveCount(2);
    await expect(canvas(page).getByText('Complete', { exact: true })).toHaveCount(1);

    // The direction is real: React Flow names each edge by its endpoints (source → target),
    // which is what makes the arrow readable to a screen reader and not only by eye.
    await expect(
      canvas(page).getByRole('group', { name: 'Edge from goal:1_Start to goal:2_Spine' }),
    ).toHaveCount(1);
    await expect(
      canvas(page).getByRole('group', { name: 'Edge from goal:6_End to goal-logic:complete' }),
    ).toHaveCount(1);
  });

  test('lays the graph out left to right, in ranks, without overlaps', async ({ page }) => {
    await openGoalLogic(page);

    const boxes = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const name of NAMES) {
      boxes.set(name, await boxOf(page, name));
    }
    const at = (name: string) => boxes.get(name) as { x: number; y: number; w: number; h: number };

    // Every prerequisite is left of what it activates (rankdir LR), one rank at a time.
    expect(at('1_Start').x).toBeLessThan(at('2_Spine').x);
    expect(at('2_Spine').x).toBeLessThan(at('3_Left').x);
    expect(at('2_Spine').x).toBeLessThan(at('4_Right').x);
    expect(at('5_Join').x).toBeGreaterThan(at('3_Left').x);
    expect(at('6_End').x).toBeGreaterThan(at('5_Join').x);
    const complete = await canvas(page)
      .locator('.react-flow__node')
      .filter({ hasText: '✓ Complete' })
      .boundingBox();
    expect(complete).not.toBeNull();
    expect((complete as { x: number }).x).toBeGreaterThan(at('6_End').x);

    // Siblings share a column and differ in row.
    expect(Math.abs(at('3_Left').x - at('4_Right').x)).toBeLessThan(1);
    expect(Math.abs(at('3_Left').y - at('4_Right').y)).toBeGreaterThan(1);

    // A readable DAG: no two boxes overlap.
    const all = [...boxes.entries()];
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        const [nameA, a] = all[i];
        const [nameB, b] = all[j];
        const disjoint =
          a.x + a.w <= b.x + 1 ||
          b.x + b.w <= a.x + 1 ||
          a.y + a.h <= b.y + 1 ||
          b.y + b.h <= a.y + 1;
        expect(disjoint, `${nameA} overlaps ${nameB}`).toBe(true);
      }
    }
  });

  test('Auto-layout puts a dragged node back on its rank', async ({ page }) => {
    await openGoalLogic(page);

    const before = await boxOf(page, '3_Left');
    const sibling = await boxOf(page, '4_Right');
    // Drag the left branch 70px to the right, off its column.
    await page.mouse.move(before.x + before.w / 2, before.y + before.h / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.w / 2 + 70, before.y + before.h / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await boxOf(page, '3_Left')).x).toBeGreaterThan(before.x + 40);

    await page.getByRole('button', { name: 'Auto-layout' }).click();
    await expect
      .poll(async () => Math.abs((await boxOf(page, '3_Left')).x - sibling.x))
      .toBeLessThan(2);
  });
});

/* ------------------------------------------------------------- adding entries */

test.describe('the toolbar', () => {
  test('adds a corpus-shaped GoalLogicEntry to the live m_goalLogic', async ({ page }) => {
    await openGoalLogic(page);
    await openJson(page);

    await expect(editor(page).getByRole('button', { name: 'Add GoalLogicEntry' })).toBeVisible();
    await editor(page).getByRole('button', { name: 'Add GoalLogicEntry' }).click();

    const doc = await copyPanelDocument(page);
    const entries = entriesOf(doc);
    expect(entries).toHaveLength(7);
    // The whole five-key shape, in the corpus's own key order.
    expect(Object.keys(entries[6])).toEqual([
      'm_goalsAND',
      'm_goalsOR',
      'm_goalsToAdd',
      'm_completeQuest',
      'm_requiredORCount',
    ]);
    expect(entries[6]).toEqual({
      m_goalsAND: [],
      m_goalsOR: [],
      m_goalsToAdd: [],
      m_completeQuest: false,
      m_requiredORCount: 1,
    });
    // The six original entries are untouched, key for key.
    expect(entries[0]).toEqual(entry(['1_Start'], [], ['2_Spine'], false));

    // The new entry is listed and selected, so its five fields are editable right away.
    await expect(
      editor(page).getByRole('button', { name: 'Entry 7: (no conditions)' }),
    ).toBeVisible();
    await expect(
      editor(page).getByRole('group', { name: 'Goal logic entry inspector' }),
    ).toBeVisible();
  });

  test('edits an entry field through the inspector', async ({ page }) => {
    await openGoalLogic(page);
    await openJson(page);

    await editor(page).getByRole('button', { name: 'Entry 1: AND 1_Start → 2_Spine' }).click();
    const inspector = editor(page).getByRole('group', { name: 'Goal logic entry inspector' });
    await expect(inspector).toBeVisible();

    // Commas survive typing: the draft is local, the document is parsed (see the component).
    await inspector.getByLabel('m_goalsAND').fill('1_Start, 3_Left');
    const doc = await copyPanelDocument(page);
    expect(entriesOf(doc)[0].m_goalsAND).toEqual(['1_Start', '3_Left']);

    await inspector.getByLabel('m_completeQuest').check();
    const completed = await copyPanelDocument(page);
    expect(entriesOf(completed)[0].m_completeQuest).toBe(true);

    await inspector.getByLabel('m_requiredORCount').fill('2');
    const counted = await copyPanelDocument(page);
    expect(entriesOf(counted)[0].m_requiredORCount).toBe(2);
  });
});

/* ------------------------------------------------------------------- the menu */

test.describe('the node context menu', () => {
  test('offers Edit Goal, Delete and Set as Start Goal, and Edit Goal opens the Goals tab', async ({
    page,
  }) => {
    await openGoalLogic(page);

    const menu = await openMenu(page, '2_Spine');
    await expect(menu.getByRole('menuitem')).toHaveText([
      'Edit Goal',
      'Delete',
      'Set as Start Goal',
    ]);

    await menu.getByRole('menuitem', { name: 'Edit Goal' }).click();
    await expect(menu).toHaveCount(0);
    await expect(main_(page).getByRole('tab', { name: 'Goals' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(main_(page).getByRole('region', { name: 'Quest goals editor' })).toBeVisible();
  });

  test('Set as Start Goal toggles m_startGoals, and the item follows the membership', async ({
    page,
  }) => {
    await openGoalLogic(page);
    await openJson(page);

    const menu = await openMenu(page, '5_Join');
    await expect(menu.getByRole('menuitem', { name: 'Set as Start Goal' })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Set as Start Goal' }).click();

    let doc = await copyPanelDocument(page);
    expect(doc.m_startGoals).toEqual(['1_Start', '5_Join']);
    // The Start badge lands on the node without a reload.
    await expect(nodeNamed(page, '5_Join').getByText('Start', { exact: true })).toHaveCount(1);

    // The item now offers the inverse, because the primitive is a toggle.
    const reopened = await openMenu(page, '5_Join');
    await expect(reopened.getByRole('menuitem', { name: 'Unset as Start Goal' })).toBeVisible();
    await reopened.getByRole('menuitem', { name: 'Unset as Start Goal' }).click();
    doc = await copyPanelDocument(page);
    expect(doc.m_startGoals).toEqual(['1_Start']);
  });

  test('Delete on a spine goal strands its dependants and raises the warning banner', async ({
    page,
  }) => {
    await openGoalLogic(page);
    await openJson(page);

    await expect(page.getByText(BANNER_TEXT)).toHaveCount(0);
    const menu = await openMenu(page, '2_Spine');
    await menu.getByRole('menuitem', { name: 'Delete' }).click();

    // The banner is the spec's verbatim sentence (L384), and the details name the goals.
    await expect(page.getByText(BANNER_TEXT)).toBeVisible();
    const details = editor(page).getByRole('list', { name: 'Goal logic validation details' });
    await expect(details.getByRole('listitem').filter({ hasText: '3_Left' })).toHaveCount(1);
    await expect(details.getByRole('listitem').filter({ hasText: '6_End' })).toHaveCount(1);

    // The goal is gone from the document and the node is gone from the canvas.
    await expect(canvas(page).locator('.react-flow__node')).toHaveCount(NAMES.length);
    await expect(nodeNamed(page, '2_Spine')).toHaveCount(0);
    const doc = await copyPanelDocument(page);
    expect((doc.m_goals as Array<Record<string, unknown>>).map((item) => item.m_goalName)).toEqual([
      '1_Start',
      '3_Left',
      '4_Right',
      '5_Join',
      '6_End',
    ]);
    // D57: the entries are untouched — nothing is normalised, repaired or dropped for us.
    expect(entriesOf(doc)).toHaveLength(6);
    expect(entriesOf(doc)[1]).toEqual(entry(['2_Spine'], [], ['3_Left'], false));
  });
});

/* ------------------------------------------------------- disconnecting an edge */

test('selecting a dashed edge and pressing Delete rewrites the entry’s OR list', async ({
  page,
}) => {
  await openGoalLogic(page);
  await openJson(page);

  await dashedEdges(page).first().click();
  await page.keyboard.press('Delete');

  // One of the two OR prerequisites is gone from the entry, and from the canvas.
  await expect(dashedEdges(page)).toHaveCount(1);
  const doc = await copyPanelDocument(page);
  expect((entriesOf(doc)[3].m_goalsOR as string[]).length).toBe(1);
  expect(entriesOf(doc)[3].m_goalsToAdd).toEqual(['5_Join']);

  // Honestly: no banner. Removing a condition only makes an entry easier to fire — an entry
  // with no condition at all fires vacuously — so only deleting a *goal* can strand one.
  await expect(page.getByText(BANNER_TEXT)).toHaveCount(0);
  await expect(nodeNamed(page, '5_Join')).toHaveCount(1);
});
