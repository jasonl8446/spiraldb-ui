import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockQuestsApi, type QuestsMockRecorded } from './quests-mocks';

/**
 * Tier-1 Goals-tab editor spec (plan task 3.4 / story p3-04, decision D23 tier 1 / D40).
 *
 * Drives the real `/quests/:questName` page in headless chromium with the API
 * route-mocked, exactly like `quests-info-editor.spec.ts`. Nothing here needs the corpus
 * or a synced database.
 *
 * What this file proves, clause by clause of the story's acceptance criterion:
 *
 * - adding each of the 5 goal types writes the right assembly-qualified `$type`, the
 *   majority `m_goalType` and that type's own fields into the live document, read back
 *   through the JSON side panel's own `[Copy]` affordance;
 * - a `@dnd-kit/sortable` reorder changes the `m_goals` array order — driven both by the
 *   keyboard sensor (deterministic) and by a real pointer drag;
 * - the Start toggle changes `m_startGoals` membership and the Start badge follows it;
 * - a goal carrying a key the editor does not model keeps it byte-identical, and the
 *   raw-fields disclosure shows it (D5);
 * - a **sparse** goal — the 13 goals in the corpus whose base key set is 14–15 keys, all
 *   from this tool's own extraction output — stays sparse: editing one field never pads
 *   it out to a 24-key shape;
 * - a goal whose `m_goalTitle` is `''` issues **no** string-table lookup (the empty URL
 *   is the 24 MB LIST route), while a hit shows the resolved string and a miss shows the
 *   raw key verbatim;
 * - an unlisted zone path keeps displaying itself and survives an unrelated edit (only
 *   112 of the corpus's 149 zone paths exist in the `zones` table), and an unlisted
 *   `m_personaName` is kept by the free-text NPC control (`m_personaName` holds a name,
 *   not a template id, and 0 of the 8 corpus values resolve in `npcs.name`);
 * - the ID-referencing zone field is a real `zones` friendly-name dropdown whose
 *   selection writes the `zone_path`.
 *
 * The fixture strings are written out in full rather than imported from the app: a spec
 * that imported the copy it asserts could only prove the app agrees with itself.
 *
 * **The badge's text is the `$type`'s TypeName** (`WaypointGoalTemplate`) — the same text
 * the shipped read-only Goals panel shows (`extraction.spec.ts` pins it) — while the
 * friendly `Waypoint` vocabulary belongs to the "New goal type" selector, which is about
 * *creating* a goal of a class. The UI spec pins the badge *colours*, which the unit tests
 * assert exactly.
 */

/** The `$type` strings, spelled out as the corpus spells them (AC#8). */
const WAYPOINT = 'Imcodec.ObjectProperty.TypeCache.WaypointGoalTemplate, Imcodec.ObjectProperty';
const PERSONA = 'Imcodec.ObjectProperty.TypeCache.PersonaGoalTemplate, Imcodec.ObjectProperty';
const BOUNTY = 'Imcodec.ObjectProperty.TypeCache.BountyGoalTemplate, Imcodec.ObjectProperty';
const SCAVENGE = 'Imcodec.ObjectProperty.TypeCache.ScavengeGoalTemplate, Imcodec.ObjectProperty';
const ACHIEVE_RANK =
  'Imcodec.ObjectProperty.TypeCache.AchieveRankGoalTemplate, Imcodec.ObjectProperty';

/** The zone path no `zones` row carries — the documented 37-of-149 interior miss. */
const UNLISTED_ZONE = 'DragonSpire/DS_A3_Kings/Interiors/DS_School_Fire';
/** The zone path the mocked `zones` table does carry. */
const LISTED_ZONE = 'DragonSpire/DS_A3_Kings/DS_A3Z1_CrystalGrove';
/** The persona name no `npcs` row carries (the corpus's own real value). */
const UNLISTED_PERSONA = 'WC-HUB-NPC01';

/**
 * The three fixture goals, shaped like the corpus: a Waypoint start goal with an
 * unmodelled legacy key and an unlisted zone; a Bounty goal with the **minority**
 * `m_goalType` (`GOAL_TYPE_BOUNTY`, 4 of 100 measured Bounty goals) and an empty
 * `m_goalTitle`; and a sparse Persona goal (14 base keys — the
 * `questtemplates_WC-CYCLOPS-MAIN-002.json` shape) with an unlisted persona name.
 */
const FIXTURE_GOALS: Array<Record<string, unknown>> = [
  {
    $type: WAYPOINT,
    m_goalName: '1_WizardQuestGoals_00000058',
    m_goalNameID: 0,
    m_goalTitle: 'WizardQuestGoals_00000058',
    m_goalUnderway: null,
    m_hyperlink: null,
    m_completeText: null,
    m_completeResults: {},
    m_goalRequirements: null,
    m_tallyCounter: null,
    m_locationName: 'ZoneLocName_818312',
    m_displayImage1: 'GUI/QuestButtons/Use_crystal_sample.dds',
    m_displayImage2: null,
    m_clientTags: ['CollectCrystal3', 'Ddl_CollectCrystal_Grove1'],
    m_genericEvents: [],
    m_autoQualify: false,
    m_autoComplete: false,
    m_destinationZone: '',
    m_dialogList: null,
    m_goalType: 'GOAL_TYPE_WAYPOINT',
    m_noQuestHelper: false,
    m_petOnlyQuest: false,
    m_activateResults: {},
    m_hideGoalFloatyText: false,
    m_behaviors: null,
    m_zoneTag: UNLISTED_ZONE,
    m_zoneEntry: true,
    m_zoneExit: false,
    m_proximityTag: '',
    m_legacyUnmodelledKey: { nested: [1, 2, 3] },
  },
  {
    $type: BOUNTY,
    m_goalName: '2_WizardQuestGoals_00000067',
    m_goalNameID: 3,
    m_goalTitle: '',
    m_goalUnderway: null,
    m_hyperlink: null,
    m_completeText: null,
    m_completeResults: {},
    m_goalRequirements: null,
    m_tallyCounter: null,
    m_locationName: '',
    m_displayImage1: '',
    m_displayImage2: null,
    m_clientTags: [],
    m_genericEvents: [],
    m_autoQualify: false,
    m_autoComplete: false,
    m_destinationZone: '',
    m_dialogList: null,
    m_goalType: 'GOAL_TYPE_BOUNTY',
    m_noQuestHelper: false,
    m_petOnlyQuest: false,
    m_activateResults: {},
    m_hideGoalFloatyText: false,
    m_behaviors: null,
    m_npcAdjectives: ['Mob_Undead'],
    m_bountyTotal: 3,
    m_bountyType: 'BT_MOB_KILL',
  },
  {
    // Sparse on purpose: 14 base keys + $type + the two Persona fields.
    $type: PERSONA,
    m_goalName: '3_WizardQuestGoals_00000070',
    m_goalNameID: 4,
    m_goalTitle: 'WizardQuestGoals_Missing',
    m_locationName: '',
    m_displayImage1: '',
    m_displayImage2: null,
    m_clientTags: [],
    m_autoQualify: false,
    m_autoComplete: false,
    m_destinationZone: '',
    m_goalType: 'GOAL_TYPE_PERSONA',
    m_noQuestHelper: false,
    m_petOnlyQuest: false,
    m_hideGoalFloatyText: false,
    m_personaName: UNLISTED_PERSONA,
    m_usePatron: false,
  },
];

/** The quest document: the fixture goals inside a corpus-shaped quest. */
const GOALS_QUEST: Record<string, unknown> = {
  m_questName: 'DS-ACAD1-C01-001',
  m_questTitle: 'QuestTitle_1ED8D',
  m_questLevel: 7,
  m_mainline: true,
  m_isHidden: false,
  m_questRepeat: 0,
  m_startGoals: ['1_WizardQuestGoals_00000058'],
  m_goals: FIXTURE_GOALS,
  m_goalLogic: [],
  m_startResults: { m_results: [] },
  m_endResults: { m_results: [] },
  m_dialogList: { m_dialogEntries: [] },
};

/** The mocked `zones` table rows — one listed zone, `zone_path` being the raw id. */
const ZONES = [
  { zone_path: LISTED_ZONE, display_name: 'Crystal Grove', world: 'DragonSpire' },
  { zone_path: 'WizardCity/WC_Hub', display_name: null, world: 'WizardCity' },
];

/** The mocked `npcs` rows — names only; `UNLISTED_PERSONA` is deliberately absent. */
const NPCS = [
  { template_id: 1, name: 'WC-ST01-NPC04' },
  { template_id: 2, name: 'WC-GTW-Registrar' },
  { template_id: 3, name: 'Unrelated Shopkeeper' },
];

/** The `<main>` region — the page, without the shell's sidebar/header. */
function main_(page: Page): Locator {
  return page.getByRole('main');
}

/** The Goals editor's own section, so a label lookup cannot escape into another tab. */
function editor(page: Page): Locator {
  return main_(page).getByRole('region', { name: 'Quest goals editor' });
}

/** The goal card at `index` (the section holds only goal cards). */
function card(page: Page, index: number): Locator {
  return editor(page).getByRole('article').nth(index);
}

/** The goal card whose text contains `name` — used when the index is what is under test. */
function cardNamed(page: Page, name: string): Locator {
  return editor(page).getByRole('article').filter({ hasText: name });
}

/** Opens the JSON side panel and returns it. */
async function openJson(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Toggle JSON panel' }).click();
  const panel = page.getByRole('complementary', { name: 'Quest JSON' });
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * The live document, read through the JSON panel's own `[Copy]` affordance: the panel's
 * serialization of the document the editors mutated, parsed back, so a key can be
 * compared exactly instead of by substring.
 */
async function copyPanelDocument(page: Page): Promise<Record<string, unknown>> {
  await page.getByRole('button', { name: 'Copy' }).click();
  // The click starts an async serialize-then-write; reading the clipboard straight after
  // can catch it empty (or the previous document). Poll until the panel's JSON is there.
  let text = '';
  await expect
    .poll(async () => {
      text = await page.evaluate(() => navigator.clipboard.readText());
      return text.trim().startsWith('{');
    })
    .toBe(true);
  return JSON.parse(text) as Record<string, unknown>;
}

/** `doc.m_goals` as the panel serialized it. */
function goalsOf(doc: Record<string, unknown>): Array<Record<string, unknown>> {
  return doc.m_goals as Array<Record<string, unknown>>;
}

/** Opens the Goals tab (and the JSON panel) on the fixture quest. */
async function openGoals(page: Page): Promise<QuestsMockRecorded> {
  const recorded = await mockQuestsApi(page, {
    detail: GOALS_QUEST,
    names: {
      QuestTitle_1ED8D: 'Quest for Perfection',
      WizardQuestGoals_00000058: 'Collect',
    },
  });
  // `mockQuestsApi` owns the strings/quests/status surface; the two name lists the goal
  // fields need are this spec's own (registered later, so they win the match).
  await page.route('**/api/names/npcs', (route) => route.fulfill({ json: { npcs: NPCS } }));
  await page.route('**/api/names/zones', (route) => route.fulfill({ json: { zones: ZONES } }));
  // The single-id lookups for a value that is not in the cached list: a 404 is the
  // documented miss (the raw id keeps displaying itself).
  await page.route('**/api/names/zones/*', (route) =>
    route.fulfill({ status: 404, json: { error: 'Unknown zones id' } }),
  );
  await page.route('**/api/names/npcs/*', (route) =>
    route.fulfill({ status: 404, json: { error: 'Unknown npcs id' } }),
  );

  await page.goto('/quests/DS-ACAD1-C01-001');
  await main_(page).getByRole('tab', { name: 'Goals' }).click();
  await expect(editor(page)).toBeVisible();
  return recorded;
}

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
});

/**
 * The card's summary is a `<dl>` whose `<dt>Label:</dt>` and `<dd>value</dd>` are separate
 * flex items, so the colon-space the design ASCII draws (spec-ui-design.md L305–309) is a
 * **gap**, not a character in `textContent`. Match label and value with optional whitespace
 * between them rather than pinning a space the DOM does not contain — the readable pairing
 * is what the spec asks for, and a `<dl>` already announces it as a pair.
 */
function summary(label: string, value: string): RegExp {
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escape(label)}:\\s*${escape(value)}`);
}

/**
 * dnd-kit's keyboard sensor and its drop both settle over a frame or two: the sortable's
 * `over` target is updated by `requestAnimationFrame`, and `onDragEnd` mutates the document
 * only after the drop. Pressing Space/ArrowDown/Space back to back reads the order before
 * either has happened (the reorder then never occurs), so the drag steps are paced and the
 * DOM order is waited for rather than sampled.
 */
async function cardOrder(page: Page): Promise<string[]> {
  return editor(page).locator('article .font-mono').allTextContents();
}

/** dnd-kit's accessibility announcements, the only signal a keyboard drag exposes. */
async function liveAnnouncements(page: Page): Promise<string> {
  return page.$$eval('[aria-live]', (els) =>
    els.map((element) => element.textContent ?? '').join(' '),
  );
}

test.describe('the goal cards', () => {
  test('render the name, the type badge and the spec summary lines', async ({ page }) => {
    await openGoals(page);

    const waypoint = card(page, 0);
    await expect(
      waypoint.locator('.font-mono', { hasText: '1_WizardQuestGoals_00000058' }),
    ).toBeVisible();
    // The badge is the `$type`'s TypeName — the same text the read-only Goals panel
    // shows for the same quest (`extraction.spec.ts` pins it there), not the type
    // selector's friendlier `Waypoint` vocabulary.
    await expect(waypoint.getByText('WaypointGoalTemplate', { exact: true })).toBeVisible();
    // The type badge is the spec's colour (docs/spec-ui-design.md L360-365).
    expect(
      await waypoint.getByText('WaypointGoalTemplate', { exact: true }).getAttribute('class'),
    ).toContain('border-blue-500');
    // In `m_startGoals` → the Start badge, and the toggle says what it would do.
    await expect(waypoint.getByText('Start', { exact: true })).toBeVisible();
    await expect(waypoint.getByRole('button', { name: 'Unset as Start Goal' })).toBeVisible();

    // The spec ASCII's summary lines (L305-309); the zone is the unlisted interior path.
    await expect(waypoint).toContainText(summary('Zone', UNLISTED_ZONE));
    await expect(waypoint).toContainText(summary('Entry', '✓'));
    await expect(waypoint).toContainText(summary('Exit', '✗'));
    await expect(waypoint).toContainText(summary('Proximity Tag', '(empty)'));
    await expect(waypoint).toContainText(
      summary('Client Tags', 'CollectCrystal3, Ddl_CollectCrystal_Grove1'),
    );
    await expect(waypoint).toContainText(
      summary('Display Image', 'GUI/QuestButtons/Use_crystal_sample.dds'),
    );

    const bounty = card(page, 1);
    await expect(bounty.getByText('BountyGoalTemplate', { exact: true })).toBeVisible();
    expect(
      await bounty.getByText('BountyGoalTemplate', { exact: true }).getAttribute('class'),
    ).toContain('border-red-500');
    await expect(bounty).toContainText(summary('Bounty Total', '3'));
    await expect(bounty).toContainText(summary('Bounty Type', 'BT_MOB_KILL'));
    // Not a start goal: no Start badge, and the toggle offers to add it.
    await expect(bounty.getByText('Start', { exact: true })).toHaveCount(0);
    await expect(bounty.getByRole('button', { name: 'Set as Start Goal' })).toBeVisible();

    const persona = card(page, 2);
    await expect(persona.getByText('PersonaGoalTemplate', { exact: true })).toBeVisible();
    expect(
      await persona.getByText('PersonaGoalTemplate', { exact: true }).getAttribute('class'),
    ).toContain('border-purple-500');
    await expect(persona).toContainText(summary('Persona', UNLISTED_PERSONA));
  });

  test('Edit expands the card inline into its type fields and the shared base section', async ({
    page,
  }) => {
    await openGoals(page);

    const waypoint = card(page, 0);
    await expect(waypoint.getByText('Shared base fields')).toHaveCount(0);
    await waypoint.getByRole('button', { name: 'Edit' }).click();

    // Inline, in the card — not a modal.
    await expect(waypoint.getByText('Shared base fields')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The type's own fields, labelled with the raw keys.
    await expect(waypoint.getByLabel('m_zoneTag', { exact: true })).toBeVisible();
    await expect(waypoint.getByLabel('m_zoneEntry', { exact: true })).toBeChecked();
    await expect(waypoint.getByLabel('m_zoneExit', { exact: true })).not.toBeChecked();
    await expect(waypoint.getByLabel('m_proximityTag', { exact: true })).toHaveValue('');

    // The base fields live behind the collapsible section: present in the DOM, not
    // visible, until the user opens it (`exact` matters when they are: `m_goalName`
    // also matches `m_goalNameID` by substring).
    await expect(waypoint.getByLabel('m_goalName', { exact: true })).toBeHidden();
    await waypoint.getByText('Shared base fields').click();
    await expect(waypoint.getByLabel('m_goalName', { exact: true })).toBeVisible();
    await expect(waypoint.getByLabel('m_goalName', { exact: true })).toHaveValue(
      '1_WizardQuestGoals_00000058',
    );
    await expect(waypoint.getByLabel('m_goalNameID', { exact: true })).toHaveValue('0');
    await expect(waypoint.getByLabel('m_goalType', { exact: true })).toHaveValue(
      'GOAL_TYPE_WAYPOINT',
    );
    await expect(waypoint.getByLabel('m_autoQualify', { exact: true })).not.toBeChecked();
  });

  test('the drag handle is a labelled button, not the card', async ({ page }) => {
    await openGoals(page);
    const handle = card(page, 0).getByRole('button', {
      name: 'Reorder goal 1_WizardQuestGoals_00000058',
    });
    await expect(handle).toBeVisible();
    // The card keeps its own role: dnd-kit's attributes live on the handle only.
    await expect(editor(page).getByRole('article')).toHaveCount(3);
  });
});

test.describe('adding goals', () => {
  test('each of the 5 types lands with the right $type and its own fields', async ({ page }) => {
    await openGoals(page);
    await openJson(page);

    // [selector label, card badge, $type, m_goalType, the type's own fields]
    const expected: Array<[string, string, string, string, Record<string, unknown>]> = [
      [
        'Waypoint',
        'WaypointGoalTemplate',
        WAYPOINT,
        'GOAL_TYPE_WAYPOINT',
        { m_zoneTag: '', m_zoneEntry: false, m_zoneExit: false, m_proximityTag: '' },
      ],
      [
        'Persona',
        'PersonaGoalTemplate',
        PERSONA,
        'GOAL_TYPE_PERSONA',
        { m_personaName: '', m_usePatron: false },
      ],
      [
        'Bounty',
        'BountyGoalTemplate',
        BOUNTY,
        'GOAL_TYPE_BOUNTYCOLLECT',
        { m_npcAdjectives: [], m_bountyTotal: 0, m_bountyType: '' },
      ],
      [
        'Scavenge',
        'ScavengeGoalTemplate',
        SCAVENGE,
        'GOAL_TYPE_SCAVENGE',
        { m_itemAdjectives: [], m_itemTotal: 0 },
      ],
      [
        'AchieveRank',
        'AchieveRankGoalTemplate',
        ACHIEVE_RANK,
        'GOAL_TYPE_ACHIEVERANK',
        { m_rank: 0 },
      ],
    ];

    for (const [type, badge, $type, goalType, fields] of expected) {
      await editor(page).getByLabel('New goal type').selectOption(type);
      await main_(page).getByRole('button', { name: 'Add Goal' }).click();

      const doc = await copyPanelDocument(page);
      const goals = goalsOf(doc);
      const added = goals[goals.length - 1];
      expect(added.$type, `${type} $type`).toBe($type);
      expect(added.m_goalType, `${type} m_goalType`).toBe(goalType);
      for (const [key, value] of Object.entries(fields)) {
        expect(added[key], `${type}.${key}`).toStrictEqual(value);
      }
      // The type's own fields are not enough: the corpus shape carries the base keys too.
      expect(added.m_goalName).toEqual(expect.stringContaining('_WizardQuestGoals_'));
      expect(Object.keys(added)).toContain('m_clientTags');
      expect(Object.keys(added)).toContain('m_genericEvents');

      // The card is on screen immediately (no refresh), with the type's badge.
      await expect(editor(page).getByRole('article')).toHaveCount(goals.length);
      await expect(card(page, goals.length - 1).getByText(badge, { exact: true })).toBeVisible();
    }

    // Eight goals, eight unique names — the uniqueness plan §3.9 validates.
    const finalDoc = await copyPanelDocument(page);
    const names = goalsOf(finalDoc).map((goal) => goal.m_goalName);
    expect(new Set(names).size).toBe(names.length);
    // …and the three original goals were not touched by the five inserts.
    expect(JSON.stringify(goalsOf(finalDoc).slice(0, 3))).toBe(JSON.stringify(FIXTURE_GOALS));
  });
});

test.describe('reordering', () => {
  test('the keyboard sensor moves a goal and changes m_goals order', async ({ page }) => {
    await openGoals(page);
    await openJson(page);

    const handle = card(page, 0).getByRole('button', {
      name: 'Reorder goal 1_WizardQuestGoals_00000058',
    });
    await handle.focus();
    // Space lifts, ArrowDown steps one sortable down, Space drops (dnd-kit's
    // KeyboardSensor with `sortableKeyboardCoordinates`). Each step is awaited on the
    // effect it produces — dnd-kit announces the sortable the drag is over in its live
    // region, and the drop mutates the document — instead of on a fixed delay: the sensor
    // flushes each step through React a frame later, and a fixed delay that is too short
    // drops the item where it started (the reorder then never happens at all).
    await page.keyboard.press('Space');
    await expect.poll(() => liveAnnouncements(page)).toContain('m_goals:0');
    // The lift is announced before the sensor has armed its arrow handling; a step sent
    // inside that window is dropped and the item never moves, so the announcement is
    // followed by one settle before the arrow.
    await page.waitForTimeout(250);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => liveAnnouncements(page)).toContain('m_goals:1');
    await page.waitForTimeout(250);
    await page.keyboard.press('Space');
    await expect
      .poll(() => cardOrder(page))
      .toStrictEqual([
        '2_WizardQuestGoals_00000067',
        '1_WizardQuestGoals_00000058',
        '3_WizardQuestGoals_00000070',
      ]);

    const doc = await copyPanelDocument(page);
    expect(goalsOf(doc).map((goal) => goal.m_goalName)).toStrictEqual([
      '2_WizardQuestGoals_00000067',
      '1_WizardQuestGoals_00000058',
      '3_WizardQuestGoals_00000070',
    ]);
    // Every goal object is unchanged, key order included — only the array order moved.
    expect(JSON.stringify(goalsOf(doc)[0])).toBe(JSON.stringify(FIXTURE_GOALS[1]));
    expect(JSON.stringify(goalsOf(doc)[1])).toBe(JSON.stringify(FIXTURE_GOALS[0]));
    expect(JSON.stringify(goalsOf(doc)[2])).toBe(JSON.stringify(FIXTURE_GOALS[2]));
  });

  test('a pointer drag with the mouse moves a goal too', async ({ page }) => {
    await openGoals(page);
    await openJson(page);

    const handle = card(page, 0).getByRole('button', {
      name: 'Reorder goal 1_WizardQuestGoals_00000058',
    });
    // The pane scrolls: `boundingBox()` without this can be outside the viewport (or
    // under the tab strip), and a raw `mouse.down` is dispatched at the coordinates
    // whatever is on top of them.
    await handle.scrollIntoViewIfNeeded();
    await handle.hover();
    const source = await handle.boundingBox();
    const target = await card(page, 1).boundingBox();
    expect(source).not.toBeNull();
    expect(target).not.toBeNull();

    await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
    await page.mouse.down();
    // dnd-kit's PointerSensor starts on pointerdown and needs movement for the
    // collision detection to see the card it passes over, so the move is incremental.
    // It ends on the *centre* of the second card: `closestCenter` compares the dragged
    // item's centre with each droppable's, and aiming at the card's bottom edge lands in
    // the third card's half of the gap — the drop then inserts at index 2, not 1.
    await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, {
      steps: 20,
    });
    await page.mouse.up();
    // Await the drop's effect before reading the document: the panel is fed by the same
    // live document, so copying immediately can still capture the pre-drop order.
    await expect
      .poll(() => cardOrder(page))
      .toStrictEqual([
        '2_WizardQuestGoals_00000067',
        '1_WizardQuestGoals_00000058',
        '3_WizardQuestGoals_00000070',
      ]);

    const doc = await copyPanelDocument(page);
    expect(goalsOf(doc).map((goal) => goal.m_goalName)).toStrictEqual([
      '2_WizardQuestGoals_00000067',
      '1_WizardQuestGoals_00000058',
      '3_WizardQuestGoals_00000070',
    ]);
  });
});

test.describe('start membership', () => {
  test('the Start toggle adds and removes the name in m_startGoals', async ({ page }) => {
    await openGoals(page);
    await openJson(page);
    const bounty = cardNamed(page, '2_WizardQuestGoals_00000067');

    await bounty.getByRole('button', { name: 'Set as Start Goal' }).click();
    await expect(bounty.getByText('Start', { exact: true })).toBeVisible();
    let doc = await copyPanelDocument(page);
    expect(doc.m_startGoals).toStrictEqual([
      '1_WizardQuestGoals_00000058',
      '2_WizardQuestGoals_00000067',
    ]);

    await bounty.getByRole('button', { name: 'Unset as Start Goal' }).click();
    await expect(bounty.getByText('Start', { exact: true })).toHaveCount(0);
    doc = await copyPanelDocument(page);
    expect(doc.m_startGoals).toStrictEqual(['1_WizardQuestGoals_00000058']);

    // The Waypoint goal's own membership was never disturbed.
    await expect(card(page, 0).getByText('Start', { exact: true })).toBeVisible();
  });
});

test.describe('preservation (D5/D57)', () => {
  test('an unmodelled key survives byte-identical and shows in the raw disclosure', async ({
    page,
  }) => {
    await openGoals(page);
    await openJson(page);
    const waypoint = card(page, 0);

    // Always visible, without discovering Edit first. The counts are separate claims: 4 of
    // the fixture's 7 complex keys are owned by a later Phase-3 task and 3 are owned by no
    // task at all (`GOAL_COMPLEX_FIELDS`'s `owner: null`).
    await expect(waypoint).toContainText('Raw fields (4 other-tab, 3 unowned, 1 unmodelled)');
    await expect(waypoint).toContainText('preserved untouched: m_legacyUnmodelledKey');
    await expect(waypoint).toContainText('m_completeResults (Results)');

    // Edit an unrelated base field, then compare the goal exactly.
    await waypoint.getByRole('button', { name: 'Edit' }).click();
    await waypoint.getByText('Shared base fields').click();
    await waypoint.getByLabel('m_autoQualify', { exact: true }).check();

    const doc = await copyPanelDocument(page);
    const goal = goalsOf(doc)[0];
    expect(goal.m_legacyUnmodelledKey).toStrictEqual({ nested: [1, 2, 3] });
    expect(goal.m_autoQualify).toBe(true);
    // Byte-identical apart from the one edited key, which is appended (merge semantics).
    expect(JSON.stringify(goal)).toBe(JSON.stringify({ ...FIXTURE_GOALS[0], m_autoQualify: true }));
    // The goals the user did not touch are untouched.
    expect(JSON.stringify(goalsOf(doc)[1])).toBe(JSON.stringify(FIXTURE_GOALS[1]));
    expect(JSON.stringify(goalsOf(doc)[2])).toBe(JSON.stringify(FIXTURE_GOALS[2]));
  });

  test('a sparse goal stays sparse through an edit', async ({ page }) => {
    await openGoals(page);
    await openJson(page);
    const persona = cardNamed(page, '3_WizardQuestGoals_00000070');

    await persona.getByRole('button', { name: 'Edit' }).click();
    await persona.getByLabel('m_usePatron', { exact: true }).check();

    const doc = await copyPanelDocument(page);
    const goal = goalsOf(doc)[2];
    expect(goal.m_usePatron).toBe(true);
    // Same keys, same order: nothing was padded out to the 24-key shape.
    expect(Object.keys(goal)).toStrictEqual(Object.keys(FIXTURE_GOALS[2]));
    expect(Object.keys(goal)).not.toContain('m_completeResults');
    expect(Object.keys(goal)).not.toContain('m_behaviors');
    expect(Object.keys(goal)).not.toContain('m_goalUnderway');
  });

  test('an unlisted zone path keeps displaying itself and survives an unrelated edit', async ({
    page,
  }) => {
    await openGoals(page);
    await openJson(page);
    const waypoint = card(page, 0);

    await waypoint.getByRole('button', { name: 'Edit' }).click();
    // The dropdown cannot resolve the path in the mocked `zones` table (404) and shows
    // the raw path — the miss path 37 of the corpus's 149 paths need.
    const zone = waypoint.getByLabel('m_zoneTag', { exact: true });
    await expect(zone).toContainText(UNLISTED_ZONE);

    // An unrelated edit must not rewrite it.
    await waypoint.getByText('Shared base fields').click();
    await waypoint.getByLabel('m_noQuestHelper', { exact: true }).check();

    await expect(waypoint.getByLabel('m_zoneTag', { exact: true })).toContainText(UNLISTED_ZONE);
    const doc = await copyPanelDocument(page);
    expect(goalsOf(doc)[0].m_zoneTag).toBe(UNLISTED_ZONE);
  });
});

test.describe('string-table lookups on m_goalTitle', () => {
  test('a hit resolves, a miss shows the raw key, and the empty key is never requested', async ({
    page,
  }) => {
    const recorded = await openGoals(page);

    // The Info tab is the landing tab and owns the quest title lookup…
    expect(recorded.nameLookups).toContain('QuestTitle_1ED8D');

    // …the empty `m_goalTitle` (26 corpus goals carry one) must add nothing at all.
    const before = recorded.nameLookups.length;
    await cardNamed(page, '2_WizardQuestGoals_00000067')
      .getByRole('button', { name: 'Edit' })
      .click();
    await expect(card(page, 1).getByLabel('m_goalTitle', { exact: true })).toHaveValue('');
    expect(recorded.nameLookups).toHaveLength(before);
    expect(recorded.nameLookups).not.toContain('');

    // A key the table knows renders the resolved string beside it.
    await card(page, 0).getByRole('button', { name: 'Edit' }).click();
    await card(page, 0).getByText('Shared base fields').click();
    await expect(card(page, 0).getByText('Collect', { exact: true })).toBeVisible();
    expect(recorded.nameLookups).toContain('WizardQuestGoals_00000058');

    // A miss renders the raw key verbatim.
    await cardNamed(page, '3_WizardQuestGoals_00000070')
      .getByRole('button', { name: 'Edit' })
      .click();
    await card(page, 2).getByText('Shared base fields').click();
    await expect(
      card(page, 2).getByText('WizardQuestGoals_Missing', { exact: true }),
    ).toBeVisible();
    expect(recorded.nameLookups).toContain('WizardQuestGoals_Missing');
  });
});

test.describe('the ID-referencing controls', () => {
  test('selecting a zone writes its zone_path', async ({ page }) => {
    await openGoals(page);
    await openJson(page);
    const waypoint = card(page, 0);
    await waypoint.getByRole('button', { name: 'Edit' }).click();

    await waypoint.getByLabel('m_zoneTag', { exact: true }).click();
    // The dropdown's search box is `cmdk`'s input: it carries `role="combobox"` and an
    // `aria-label`, but `getByLabel` does not resolve it (it is not a labelled control),
    // so it is addressed by role — the locator that matches what the element is.
    const zoneSearch = page.getByRole('combobox', { name: 'Search zones' });
    await expect(zoneSearch).toBeVisible();
    await zoneSearch.fill('Crystal');
    await page.getByRole('option', { name: 'Crystal Grove' }).click();

    await expect(waypoint.getByLabel('m_zoneTag', { exact: true })).toContainText('Crystal Grove');
    const doc = await copyPanelDocument(page);
    expect(goalsOf(doc)[0].m_zoneTag).toBe(LISTED_ZONE);
  });

  test('the persona control keeps an unlisted name and suggests npc names', async ({ page }) => {
    await openGoals(page);
    await openJson(page);
    const persona = cardNamed(page, '3_WizardQuestGoals_00000070');
    await persona.getByRole('button', { name: 'Edit' }).click();

    const input = persona.getByLabel('m_personaName', { exact: true });
    // Unlisted (`WC-HUB-NPC01` is in neither names table) — kept, never cleared.
    await expect(input).toHaveValue(UNLISTED_PERSONA);
    // The suggestions are `npcs.name` values, and the unlisted current value is offered.
    const suggestions = await persona
      .locator('datalist option')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    expect(suggestions).toContain('WC-GTW-Registrar');
    expect(suggestions).toContain(UNLISTED_PERSONA);

    // An unrelated edit leaves it alone…
    await persona.getByLabel('m_usePatron', { exact: true }).check();
    await expect(persona.getByLabel('m_personaName', { exact: true })).toHaveValue(
      UNLISTED_PERSONA,
    );
    // …and typing a new name writes exactly what was typed.
    await input.fill('WC-RAV-NPC05');
    const doc = await copyPanelDocument(page);
    expect(goalsOf(doc)[2].m_personaName).toBe('WC-RAV-NPC05');
    expect(goalsOf(doc)[2].m_usePatron).toBe(true);
  });
});
