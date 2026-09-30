import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockQuestsApi, type QuestsMockRecorded } from './quests-mocks';

/**
 * Tier-1 Requirements-tree spec (plan task 3.6 / story p3-06, decision D23 tier 1 / D40).
 *
 * Drives the real `/quests/:questName` page in headless chromium with the API route-mocked,
 * exactly like `quests-goals-editor.spec.ts`: nothing here needs the corpus, a database or
 * the dev stack.
 *
 * What this file proves, clause by clause of the story's acceptance criteria:
 *
 * - the type selector offers **exactly the four** allowed classes and neither `ReqHasGoal`
 *   nor `ReqEntryValue` appears anywhere in the tab (spec-domain-reference.md L436);
 * - `AND(ReqHasQuest{NOT}, OR(ReqSchoolOfFocus, ReqHasEntry))` can be **built through the
 *   UI** — add condition, add group, type changes, the quest dropdown, the NOT box, the
 *   operator toggle — and the document it produces equals a **hand-written** expectation
 *   byte-for-byte (the JSON text compare catches key order, which deep equality cannot);
 * - feeding that saved document back through the tree editor (a fresh page load serving
 *   the copied document) renders the same tree and re-serializes to the **same bytes** —
 *   the reload round trip;
 * - the border colours are the spec's: AND blue, OR purple, leaf green;
 * - the NOT checkbox and the operator toggle really reach the document, and a delete
 *   removes exactly one node;
 * - `m_prepRequirements` (null in all 322 corpus quests) stays **null** until the user
 *   acts, and the first act writes the corpus's wrapper shape;
 * - an **untyped** wrapper is never given a `$type` and keeps its key order (the corpus's
 *   7 quest-level wrappers and every DropTable item wrapper);
 * - the per-goal `m_goalRequirements` slot mounts the same shared component at its own
 *   path and writes only into `m_goals[i]`.
 *
 * **Fixture-only, stated three separate ways.** The AC's example tree exists in **no**
 * corpus file: `ROP_OR` never occurs (631/631 measured requirement nodes are `ROP_AND`;
 * `m_operator` is `ROP_AND` everywhere), the corpus never nests a group inside a group
 * (depths 0 and 1 only), and `ReqSchoolOfFocus`/`ReqIsSchool` live in DropTable items and
 * result objects — a quest's own `m_requirements` tree holds only `ReqHasQuest` and
 * `ReqHasEntry` (277 + 40 leaves). The OR group, the nesting and the cross-type mix below
 * are therefore hand-written; the quest fixture's `null` slots and the untyped wrapper are
 * the corpus's own shapes.
 *
 * The fixture strings are written out in full rather than imported from the app: a spec
 * that imported the copy it asserts could only prove the app agrees with itself.
 */

/* ------------------------------------------------------------------- fixtures */

const RL = 'Imcodec.ObjectProperty.TypeCache.RequirementList, Imcodec.ObjectProperty';
const RHQ = 'Imcodec.ObjectProperty.TypeCache.ReqHasQuest, Imcodec.ObjectProperty';
const RHE = 'Imcodec.ObjectProperty.TypeCache.ReqHasEntry, Imcodec.ObjectProperty';
const RSOF = 'Imcodec.ObjectProperty.TypeCache.ReqSchoolOfFocus, Imcodec.ObjectProperty';
const WAYPOINT = 'Imcodec.ObjectProperty.TypeCache.WaypointGoalTemplate, Imcodec.ObjectProperty';

const QUEST_NAME = 'DS-ACAD1-C01-001';
const REFERENCED_QUEST = 'DS-ACAD1-C01-002';
const REFERENCED_TITLE = 'Second Quest';
const GOAL_NAME = '1_WizardQuestGoals_GotoZone';

/** The two quests the `quests` friendly-name list answers with (the dropdown's options). */
const QUEST_NAMES = [
  { quest_name: QUEST_NAME, title: 'First Quest', level: 1, is_mainline: 1 },
  { quest_name: REFERENCED_QUEST, title: REFERENCED_TITLE, level: 3, is_mainline: 0 },
];

/**
 * The quest fixture: a null `m_requirements` (the empty-slot path — the corpus has 8 of
 * them), the always-null prep/prune slots and one goal whose `m_goalRequirements` is null
 * (all 772 corpus goals are).
 */
function quest(): Record<string, unknown> {
  return {
    m_questName: QUEST_NAME,
    m_questTitle: 'QuestTitle_1ED8D',
    m_goals: [
      {
        $type: WAYPOINT,
        m_goalName: GOAL_NAME,
        m_goalType: 'GOAL_TYPE_WAYPOINT',
        m_goalRequirements: null,
      },
    ],
    m_requirements: null,
    m_prepRequirements: null,
    m_pruneRequirements: null,
    m_startResults: { m_results: [] },
    m_endResults: { m_results: [] },
  };
}

/**
 * The corpus's 7 untyped quest wrappers (and every DropTable item wrapper): key order
 * `m_requirements, m_applyNOT, m_operator`, no `$type`. Editing inside it must add none.
 */
function untypedQuest(): Record<string, unknown> {
  return {
    ...quest(),
    m_requirements: {
      m_requirements: [
        { $type: RSOF, m_magicSchool: 'Balance', m_applyNOT: false, m_operator: 'ROP_AND' },
      ],
      m_applyNOT: false,
      m_operator: 'ROP_AND',
    },
  };
}

/**
 * The hand-written expectation for `AND(ReqHasQuest{NOT}, OR(ReqSchoolOfFocus,
 * ReqHasEntry))` — fixture-only (see the header), in the corpus's polymorphic shape:
 * `$type` first on every node, the canonical new-node order for each class, and
 * `m_applyNOT`/`m_operator` on every node. `m_isQuestRegistry: true` is the corpus's own
 * majority (39 of 40 `ReqHasEntry` nodes), i.e. what a new node is given.
 */
const AC1_EXPECTED = {
  $type: RL,
  m_applyNOT: false,
  m_operator: 'ROP_AND',
  m_requirements: [
    { $type: RHQ, m_applyNOT: true, m_operator: 'ROP_AND', m_questName: REFERENCED_QUEST },
    {
      $type: RL,
      m_applyNOT: false,
      m_operator: 'ROP_OR',
      m_requirements: [
        { $type: RSOF, m_magicSchool: 'Fire', m_applyNOT: false, m_operator: 'ROP_AND' },
        {
          $type: RHE,
          m_entryName: 'Complete',
          m_displayName: null,
          m_isQuestRegistry: true,
          m_questName: REFERENCED_QUEST,
          m_applyNOT: false,
          m_operator: 'ROP_AND',
        },
      ],
    },
  ],
};

/** The same value as text: the order-sensitive half of the diff. */
const AC1_EXPECTED_TEXT = `{
  "$type": "${RL}",
  "m_applyNOT": false,
  "m_operator": "ROP_AND",
  "m_requirements": [
    {
      "$type": "${RHQ}",
      "m_applyNOT": true,
      "m_operator": "ROP_AND",
      "m_questName": "${REFERENCED_QUEST}"
    },
    {
      "$type": "${RL}",
      "m_applyNOT": false,
      "m_operator": "ROP_OR",
      "m_requirements": [
        {
          "$type": "${RSOF}",
          "m_magicSchool": "Fire",
          "m_applyNOT": false,
          "m_operator": "ROP_AND"
        },
        {
          "$type": "${RHE}",
          "m_entryName": "Complete",
          "m_displayName": null,
          "m_isQuestRegistry": true,
          "m_questName": "${REFERENCED_QUEST}",
          "m_applyNOT": false,
          "m_operator": "ROP_AND"
        }
      ]
    }
  ]
}`;

/* -------------------------------------------------------------------- helpers */

/** The `<main>` region — the page, without the shell's sidebar/header. */
function main_(page: Page): Locator {
  return page.getByRole('main');
}

/** The panel `QuestDetailPage` mounts in the Requirements tab. */
function editor(page: Page): Locator {
  return main_(page).getByRole('region', { name: 'Quest requirements editor', exact: true });
}

/** The quest's own `m_requirements` tree, so a label lookup cannot escape into another slot. */
function tree(page: Page): Locator {
  return editor(page).getByRole('region', { name: 'Requirements', exact: true });
}

/** The `m_prepRequirements` tree. */
function prepTree(page: Page): Locator {
  return editor(page).getByRole('region', { name: 'Preparation requirements', exact: true });
}

/**
 * A card's title: `Group`, or a class's glossary pair (task 7.9) — the leading words of the card's
 * accessible name.
 */
const CARD_TITLES: Record<string, string> = {
  Group: 'Group',
  ReqHasQuest: 'Requires quest (ReqHasQuest)',
  ReqHasEntry: 'Requires quest registry entry (ReqHasEntry)',
  ReqSchoolOfFocus: 'Requires school of focus (ReqSchoolOfFocus)',
  ReqIsSchool: 'Requires target school (ReqIsSchool)',
};

/**
 * A card by its **exact** document address and its title. The address is the card's `data-path`
 * (task 7.9: a path never appears in a label; the accessible name reads it in words), matched
 * whole, so `m_requirements` cannot match `m_requirements[1]`; the title is the accessible name's
 * leading words, so a card of another class at that address does not match either.
 */
function card(page: Page, title: string, address: string): Locator {
  return tree(page).locator(
    `article[data-path="${address}"][aria-label^="${CARD_TITLES[title] ?? title} "]`,
  );
}

/** A group card. */
function groupCard(page: Page, address: string): Locator {
  return card(page, 'Group', address);
}

/**
 * Whatever card sits at {@link address}, whatever its class — the locator the type selector
 * needs, because changing a leaf's class renames its card.
 */
function cardByAddress(page: Page, address: string): Locator {
  return tree(page).locator(`article[data-path="${address}"]`);
}

/**
 * An `Add Condition` / `Add Group` / `Delete` / `AND` / `OR` control, located inside {@link scope}
 * by its exact `data-path` and the verb its accessible name starts with.
 */
function control(scope: Locator, verb: string, address: string): Locator {
  return scope.locator(`button[data-path="${address}"][aria-label^="${verb} "]`);
}

/** The class's left-border colour assertion (spec-ui-design.md L388-416). */
async function expectBorder(locator: Locator, colour: string): Promise<void> {
  expect(await locator.getAttribute('class')).toContain(colour);
}

/** Opens the JSON side panel. */
async function openJson(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Toggle JSON panel' }).click();
  const panel = page.getByRole('complementary', { name: 'Quest JSON' });
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * The live document's text, read through the JSON panel's own `[Copy]` affordance.
 *
 * The click starts an async serialize-then-write, so reading the clipboard straight after
 * can catch the previous document (or nothing) — hence the poll. The clipboard is wiped
 * **first**, which is what makes a second read in one test a real read rather than a
 * re-read of the first (and, in the reload case, what keeps an unchanged document from
 * passing vacuously).
 */
async function copyPanelText(page: Page): Promise<string> {
  // The panel is the affordance's home, and it is closed on a fresh load: open it if it
  // is not already up (a second call in one test must not toggle it shut).
  if (!(await page.getByRole('complementary', { name: 'Quest JSON' }).isVisible())) {
    await openJson(page);
  }
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

/** The requirement wrapper at `m_requirements` of a copied document. */
function requirementsOf(doc: Record<string, unknown>): Record<string, unknown> {
  return doc.m_requirements as Record<string, unknown>;
}

/** `m_requirements.m_requirements` — the root group's children. */
function rootChildren(doc: Record<string, unknown>): Array<Record<string, unknown>> {
  return requirementsOf(doc).m_requirements as Array<Record<string, unknown>>;
}

interface OpenResult {
  recorded: QuestsMockRecorded;
  /** The object the detail endpoint answers with; a reload test can replace it. */
  served: { current: Record<string, unknown> };
}

/**
 * Mounts the page on {@link initial} with the whole data surface mocked, including the
 * `quests` friendly-name list the `m_questName` dropdown searches (the list route is this
 * spec's own; `mockQuestsApi` owns the rest).
 */
async function openRequirements(
  page: Page,
  initial: Record<string, unknown> = quest(),
): Promise<OpenResult> {
  const served = { current: initial };
  const recorded = await mockQuestsApi(page, {
    onDetail: (route) => route.fulfill({ json: served.current }),
  });
  await page.route('**/api/names/quests', (route) =>
    route.fulfill({ json: { quests: QUEST_NAMES } }),
  );
  // A miss is the documented fallback (the raw id keeps displaying itself).
  await page.route('**/api/names/quests/*', (route) =>
    route.fulfill({ status: 404, json: { error: 'Unknown quests id' } }),
  );

  await page.goto(`/quests/${QUEST_NAME}`);
  await main_(page).getByRole('tab', { name: 'Requirements' }).click();
  await expect(editor(page)).toBeVisible();
  return { recorded, served };
}

/** Changes a leaf's class through its own type selector. */
async function setType(page: Page, address: string, type: string): Promise<void> {
  await cardByAddress(page, address).getByLabel('Type ($type)', { exact: true }).selectOption(type);
}

/** Selects a quest through the `m_questName` friendly-name dropdown. */
async function setQuest(page: Page, address: string, questName: string): Promise<void> {
  await cardByAddress(page, address)
    .getByRole('combobox', { name: /^Quest \(m_questName\) / })
    .click();
  const search = page.getByRole('combobox', { name: 'Search quests', exact: true });
  await expect(search).toBeVisible();
  await search.fill(questName);
  // The option label is the pair — `Second Quest (DS-ACAD1-C01-002)` — because
  // `formatNameRow('quests')` pairs the resolved title with the quest name (D105/P6-16).
  await page
    .getByRole('option', { name: `${REFERENCED_TITLE} (${REFERENCED_QUEST})`, exact: true })
    .click();
}

/**
 * Builds `AND(ReqHasQuest{NOT}, OR(ReqSchoolOfFocus, ReqHasEntry))` through the UI, in the
 * order a user would: add a condition, fill it, add a group, retype its condition, add a
 * second one, then flip the inner operator to OR.
 */
async function buildAc1Tree(page: Page): Promise<void> {
  const root = 'm_requirements';
  const rootLeaf = 'm_requirements[0]';
  const innerGroup = 'm_requirements[1]';
  const innerFirst = 'm_requirements[1][0]';
  const innerSecond = 'm_requirements[1][1]';

  await control(tree(page), 'Add Condition to', root).click();
  await expect(card(page, 'ReqHasQuest', rootLeaf)).toBeVisible();
  await setQuest(page, rootLeaf, REFERENCED_QUEST);
  await card(page, 'ReqHasQuest', rootLeaf).getByLabel('NOT (m_applyNOT)', { exact: true }).check();

  await control(tree(page), 'Add Group to', root).click();
  await expect(groupCard(page, innerGroup)).toBeVisible();

  await setType(page, innerFirst, 'ReqSchoolOfFocus');
  await card(page, 'ReqSchoolOfFocus', innerFirst)
    .getByLabel('School (m_magicSchool)', { exact: true })
    .selectOption('Fire');

  await control(groupCard(page, innerGroup), 'Add Condition to', innerGroup).click();
  await setType(page, innerSecond, 'ReqHasEntry');
  await card(page, 'ReqHasEntry', innerSecond)
    .getByLabel('Entry (m_entryName)', { exact: true })
    .fill('Complete');
  await setQuest(page, innerSecond, REFERENCED_QUEST);

  await control(groupCard(page, innerGroup), 'OR for', innerGroup).click();
  await expect(control(groupCard(page, innerGroup), 'OR for', innerGroup)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
}

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
});

/* -------------------------------------------------------------- the selector */

test.describe('the leaf type selector', () => {
  test('offers exactly the 4 allowed classes, and neither ReqHasGoal nor ReqEntryValue', async ({
    page,
  }) => {
    await openRequirements(page);
    await control(tree(page), 'Add Condition to', 'm_requirements').click();

    const selector = card(page, 'ReqHasQuest', 'm_requirements[0]').getByLabel('Type ($type)', {
      exact: true,
    });
    await expect(selector).toHaveValue('ReqHasQuest');
    expect(await selector.locator('option').allTextContents()).toEqual([
      'Requires quest (ReqHasQuest)',
      'Requires quest registry entry (ReqHasEntry)',
      'Requires school of focus (ReqSchoolOfFocus)',
      'Requires target school (ReqIsSchool)',
    ]);

    // Not just "unused": absent from the tab's text and from every option.
    await expect(editor(page)).not.toContainText('ReqHasGoal');
    await expect(editor(page)).not.toContainText('ReqEntryValue');
  });

  test('replaces the node when the class changes, and writes the new class’s shape', async ({
    page,
  }) => {
    await openRequirements(page);
    await control(tree(page), 'Add Condition to', 'm_requirements').click();
    await setType(page, 'm_requirements[0]', 'ReqIsSchool');

    const leaf = card(page, 'ReqIsSchool', 'm_requirements[0]');
    await expect(leaf).toBeVisible();
    await leaf.getByLabel('Target Type (m_targetType)', { exact: true }).selectOption('RT_Caster');
    await leaf
      .getByLabel('School Name (m_magicSchoolName)', { exact: true })
      .selectOption('Balance');

    const doc = await copyPanelDocument(page);
    expect(rootChildren(doc)[0]).toEqual({
      $type: 'Imcodec.ObjectProperty.TypeCache.ReqIsSchool, Imcodec.ObjectProperty',
      m_magicSchoolName: 'Balance',
      m_targetType: 'RT_Caster',
      m_applyNOT: false,
      m_operator: 'ROP_AND',
    });
  });
});

/* ----------------------------------------------------------- corpus shapes */

test.describe('the corpus’s own shapes', () => {
  test('never gives an untyped wrapper a $type, and keeps its key order', async ({ page }) => {
    await openRequirements(page, untypedQuest());

    // The untyped wrapper is a group even without a `$type` (the corpus's own rule).
    const root = groupCard(page, 'm_requirements');
    await expect(root).toBeVisible();
    await expect(card(page, 'ReqSchoolOfFocus', 'm_requirements[0]')).toBeVisible();
    await expectBorder(root, 'border-l-blue-500');
    await expectBorder(card(page, 'ReqSchoolOfFocus', 'm_requirements[0]'), 'border-l-green-500');

    await card(page, 'ReqSchoolOfFocus', 'm_requirements[0]')
      .getByLabel('NOT (m_applyNOT)', { exact: true })
      .check();

    const doc = await copyPanelDocument(page);
    const wrapper = requirementsOf(doc);
    expect(Object.keys(wrapper)).toEqual(['m_requirements', 'm_applyNOT', 'm_operator']);
    expect(Object.prototype.hasOwnProperty.call(wrapper, '$type')).toBe(false);
    // The edited leaf was a corpus node: its own order is untouched.
    expect(Object.keys(rootChildren(doc)[0] as object)).toEqual([
      '$type',
      'm_magicSchool',
      'm_applyNOT',
      'm_operator',
    ]);
    expect(rootChildren(doc)[0]?.m_applyNOT).toBe(true);
  });

  test('leaves m_prepRequirements null until the user acts', async ({ page }) => {
    await openRequirements(page);
    await openJson(page);

    // Merely opening the tab writes nothing (D57).
    const first = await copyPanelText(page);
    expect((JSON.parse(first) as Record<string, unknown>).m_prepRequirements).toBeNull();

    await control(prepTree(page), 'Add Condition to', 'm_prepRequirements').click();

    const after = await copyPanelDocument(page);
    expect(after.m_prepRequirements).toEqual({
      $type: RL,
      m_applyNOT: false,
      m_operator: 'ROP_AND',
      m_requirements: [{ $type: RHQ, m_applyNOT: false, m_operator: 'ROP_AND', m_questName: '' }],
    });
    // The other three slots are untouched by a write into this one.
    expect(after.m_requirements).toBeNull();
    expect(after.m_pruneRequirements).toBeNull();
  });

  test('mounts a tree per goal for m_goalRequirements and writes only into that goal', async ({
    page,
  }) => {
    await openRequirements(page);

    const goalTree = editor(page).getByRole('region', {
      name: `Goal requirements for ${GOAL_NAME}`,
      exact: true,
    });
    await expect(goalTree).toBeVisible();
    await control(goalTree, 'Add Condition to', 'm_goals[0].m_goalRequirements').click();

    const doc = await copyPanelDocument(page);
    const goal = (doc.m_goals as Array<Record<string, unknown>>)[0];
    expect(goal?.m_goalRequirements).toEqual({
      $type: RL,
      m_applyNOT: false,
      m_operator: 'ROP_AND',
      m_requirements: [{ $type: RHQ, m_applyNOT: false, m_operator: 'ROP_AND', m_questName: '' }],
    });
    expect(doc.m_requirements).toBeNull();
  });
});

/* ----------------------------------------------------------- controls → doc */

test.describe('a control reaches the document', () => {
  test('the NOT checkbox and the operator toggle both write', async ({ page }) => {
    await openRequirements(page);
    await control(tree(page), 'Add Condition to', 'm_requirements').click();

    const leaf = card(page, 'ReqHasQuest', 'm_requirements[0]');
    const not = leaf.getByLabel('NOT (m_applyNOT)', { exact: true });
    await expect(not).not.toBeChecked();
    await not.check();

    const andButton = control(groupCard(page, 'm_requirements'), 'AND for', 'm_requirements');
    const orButton = control(groupCard(page, 'm_requirements'), 'OR for', 'm_requirements');
    await expect(andButton).toHaveAttribute('aria-pressed', 'true');
    await expect(orButton).toHaveAttribute('aria-pressed', 'false');
    await orButton.click();
    await expect(orButton).toHaveAttribute('aria-pressed', 'true');

    const doc = await copyPanelDocument(page);
    expect(requirementsOf(doc).m_operator).toBe('ROP_OR');
    expect(rootChildren(doc)[0]?.m_applyNOT).toBe(true);
  });

  test('the quest dropdown stores the raw quest name', async ({ page }) => {
    await openRequirements(page);
    await control(tree(page), 'Add Condition to', 'm_requirements').click();
    await setQuest(page, 'm_requirements[0]', REFERENCED_QUEST);

    const doc = await copyPanelDocument(page);
    expect(rootChildren(doc)[0]?.m_questName).toBe(REFERENCED_QUEST);
    // The trigger shows the resolved title, the document the id (AGENTS.md rule 5).
    await expect(
      card(page, 'ReqHasQuest', 'm_requirements[0]').getByRole('combobox', {
        name: 'Quest (m_questName) Requirements 1',
        exact: true,
      }),
    ).toContainText(REFERENCED_TITLE);
  });

  test('delete removes exactly one node', async ({ page }) => {
    await openRequirements(page);
    await control(tree(page), 'Add Condition to', 'm_requirements').click();
    await control(tree(page), 'Add Condition to', 'm_requirements').click();
    await setQuest(page, 'm_requirements[1]', REFERENCED_QUEST);

    await control(tree(page), 'Delete', 'm_requirements[0]').click();

    await expect(card(page, 'ReqHasQuest', 'm_requirements[0]')).toBeVisible();
    await expect(tree(page).getByRole('article')).toHaveCount(2); // the group + one leaf
    const doc = await copyPanelDocument(page);
    expect(rootChildren(doc)).toHaveLength(1);
    expect(rootChildren(doc)[0]?.m_questName).toBe(REFERENCED_QUEST);
  });
});

/* ------------------------------------------------------- AC1: build + reload */

test.describe('AC1 — the fixture-only AND(ReqHasQuest{NOT}, OR(...)) tree', () => {
  test('builds the hand-written expectation through the UI', async ({ page }) => {
    await openRequirements(page);
    await buildAc1Tree(page);

    // The spec's colours: AND blue, OR purple, leaf green.
    await expectBorder(groupCard(page, 'm_requirements'), 'border-l-blue-500');
    await expectBorder(groupCard(page, 'm_requirements[1]'), 'border-l-purple-500');
    await expectBorder(card(page, 'ReqHasQuest', 'm_requirements[0]'), 'border-l-green-500');
    await expectBorder(card(page, 'ReqHasEntry', 'm_requirements[1][1]'), 'border-l-green-500');

    const doc = await copyPanelDocument(page);
    expect(requirementsOf(doc)).toEqual(AC1_EXPECTED);
    // The text compare is the one that sees key order (D58e).
    expect(JSON.stringify(requirementsOf(doc), null, 2)).toBe(AC1_EXPECTED_TEXT);
  });

  test('reloads the saved document in the tree editor and diffs it again', async ({ page }) => {
    const { served } = await openRequirements(page);
    await openJson(page);
    await buildAc1Tree(page);

    const saved = await copyPanelText(page);
    expect(JSON.stringify(JSON.parse(saved).m_requirements, null, 2)).toBe(AC1_EXPECTED_TEXT);

    // Feed the saved document back in: the next detail read serves it.
    served.current = JSON.parse(saved) as Record<string, unknown>;
    await page.reload();
    await main_(page).getByRole('tab', { name: 'Requirements' }).click();
    await expect(editor(page)).toBeVisible();

    // The reloaded tree reads the same shape back.
    await expect(groupCard(page, 'm_requirements')).toBeVisible();
    await expect(card(page, 'ReqHasQuest', 'm_requirements[0]')).toBeVisible();
    await expect(card(page, 'ReqSchoolOfFocus', 'm_requirements[1][0]')).toBeVisible();
    await expect(card(page, 'ReqHasEntry', 'm_requirements[1][1]')).toBeVisible();
    await expectBorder(groupCard(page, 'm_requirements[1]'), 'border-l-purple-500');
    await expect(
      card(page, 'ReqHasQuest', 'm_requirements[0]').getByLabel('NOT (m_applyNOT)', {
        exact: true,
      }),
    ).toBeChecked();
    await expect(
      card(page, 'ReqHasEntry', 'm_requirements[1][1]').getByLabel(
        'Quest Registry (m_isQuestRegistry)',
        {
          exact: true,
        },
      ),
    ).toBeChecked();
    await expect(
      card(page, 'ReqHasEntry', 'm_requirements[1][1]').getByLabel('Display Name (m_displayName)', {
        exact: true,
      }),
    ).toHaveValue('');

    // …and re-serializes to the same bytes, deep-equal and order-equal.
    await openJson(page);
    const again = await copyPanelText(page);
    expect(JSON.parse(again)).toEqual(JSON.parse(saved));
    expect(again).toBe(saved);
    expect(JSON.parse(again).m_requirements).toEqual(AC1_EXPECTED);
  });
});
