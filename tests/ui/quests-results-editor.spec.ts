import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockQuestsApi } from './quests-mocks';

/**
 * Tier-1 Results-editor spec (plan task 3.7 / story p3-07, decision D23 tier 1 / D40).
 *
 * Drives the real `/quests/:questName` page in headless chromium with the API route-mocked,
 * exactly like `quests-requirements-editor.spec.ts`: nothing here needs the corpus, a
 * database or the dev stack beyond the harness's own.
 *
 * What this file proves, clause by clause of the story's acceptance criteria:
 *
 * - the Add Result selector offers **exactly the 14 creatable** classes, and all 14 can be
 *   **added through the UI with their exact field set** (one control per declared field,
 *   addressed by role) and the **character-for-character** `$type`. The corpus knows **15**
 *   (re-measured at the owner's 328-quest baseline: 421 result nodes, 15 classes, of which
 *   `ResActorDialog` occurs 5× as `{$type, m_dialog}`); the 15th is deliberately **corpus-only**
 *   — this module owns no control for `m_dialog`, so a create would write `{$type}` alone, a
 *   shape the corpus has never had (D79/D80; `corpusOnly` in `lib/quest-results.ts`). The
 *   "known and renderable" half is the unit tier's pin (`tests/unit/quest-results.test.ts`:
 *   "the 15 result classes", "resolves the corpus-only ResActorDialog and discloses its nested
 *   dialog read-only", and the census's `ResActorDialog 5`); **this file's subject is the
 *   offered vocabulary**, i.e. what a create writes;
 * - a saved result's **key order equals the corpus's** for its type — asserted against the
 *   literals written out below, not imported from the app (a spec that imported the copy it
 *   asserts could only prove the app agrees with itself) — and an existing corpus-shaped
 *   node keeps its own order when a field is edited;
 * - the wrapper is `{"m_results": […]}` and **never gains a `$type`**;
 * - the `m_router` sub-object keeps the measured six-key order and gains no `$type`;
 * - `ResLearnSpell.m_requirements` mounts the **shared** requirement tree and an edit there
 *   writes into the corpus's **untyped** wrapper;
 * - a friendly-name dropdown shows the resolved name and stores the **raw id**;
 * - an empty-string/null reference produces **no lookup request** (the D59(c) hazard);
 * - the measured **`ResDrawHand.m_templateID` ambiguity** is dual-source and miss-safe: 6 of
 *   8 corpus values live in `spells`, 2 in `npcs`, and an unknown value stays displayed and
 *   is never rewritten;
 * - delete removes exactly one card, and all five homes mount (including the guarded tally
 *   slot, which is absent for a goal with no tally counter).
 *
 * Coverage honesty: the corpus exercises **5** of the 14 offered forms exactly once, so the
 * fixture values below are largely synthetic — the corpus-shaped nodes the spec seeds (the
 * `ResModifyEntry` with `m_questName: ""`, the `ResAddDynaMod` with `null`/`""` zones, the
 * `ResDrawHand` split) are the real measured shapes. The `$type` strings and key orders are
 * the measured ones. (The "5" is a re-measurement, not a re-pin: at the 322-quest baseline
 * seven forms had exactly one node; the owner's merge took `ResTeleport` 1 → 8 and
 * `ResPlaySound` 1 → 2, leaving `ResAddHealth`, `ResAddMana`, `ResModifyEntry`, `ResDespawn`
 * and `ResWait` as the singletons — 5 of the 14 offered forms, of 421 nodes.)
 */

/* ------------------------------------------------------------------- fixtures */

const RDROP = 'Imcodec.ObjectProperty.TypeCache.ResDropTable, Imcodec.ObjectProperty';
const RMOD = 'Imcodec.ObjectProperty.TypeCache.ResModifyEntry, Imcodec.ObjectProperty';
const RADM = 'Imcodec.ObjectProperty.TypeCache.ResAddDynaMod, Imcodec.ObjectProperty';
const RLEARN = 'Imcodec.ObjectProperty.TypeCache.ResLearnSpell, Imcodec.ObjectProperty';
const REVENT = 'Imcodec.ObjectProperty.TypeCache.ResPostEvent, Imcodec.ObjectProperty';
const RHEALTH = 'Imcodec.ObjectProperty.TypeCache.ResAddHealth, Imcodec.ObjectProperty';
const RMANA = 'Imcodec.ObjectProperty.TypeCache.ResAddMana, Imcodec.ObjectProperty';
const RADDS = 'Imcodec.ObjectProperty.TypeCache.ResAddSpell, Imcodec.ObjectProperty';
const RDESPAWN = 'Imcodec.ObjectProperty.TypeCache.ResDespawn, Imcodec.ObjectProperty';
const RDRAW = 'Imcodec.ObjectProperty.TypeCache.ResDrawHand, Imcodec.ObjectProperty';
const RGIVE = 'Imcodec.ObjectProperty.TypeCache.ResGiveSpell, Imcodec.ObjectProperty';
const RSOUND = 'Imcodec.ObjectProperty.TypeCache.ResPlaySound, Imcodec.ObjectProperty';
const RTELE = 'Imcodec.ObjectProperty.TypeCache.ResTeleport, Imcodec.ObjectProperty';
const RWAIT = 'Imcodec.ObjectProperty.TypeCache.ResWait, Imcodec.ObjectProperty';
const WAYPOINT = 'Imcodec.ObjectProperty.TypeCache.WaypointGoalTemplate, Imcodec.ObjectProperty';

const QUEST_NAME = 'DS-ACAD1-C01-001';
const GOAL_A = '1_WizardQuestGoals_GotoZone';
const GOAL_B = '2_WizardQuestGoals_KillMobs';

/** The ARIA roles the 14 offered classes' fields render as. */
type ControlRole =
  'combobox' | 'spinbutton' | 'textbox' | 'checkbox' | 'region' | 'group' | 'status';

interface TypeCase {
  /** The class's short name — the selector's value and the card's title. */
  name: string;
  /** The assembly-qualified `$type` the saved node must carry, character-for-character. */
  $type: string;
  /** The exact key set, in the corpus's own order (the AC's "exact field set"). */
  order: string[];
  /** The controls the card must render for those fields, as `[key, role]`. */
  controls: Array<[string, ControlRole]>;
}

/** The 14 offered classes, their measured key orders and their rendered controls. */
const TYPES: TypeCase[] = [
  {
    name: 'ResDropTable',
    $type: RDROP,
    order: ['$type', 'm_tableName', 'm_maxRolls'],
    controls: [
      ['m_tableName', 'combobox'],
      ['m_maxRolls', 'spinbutton'],
    ],
  },
  {
    name: 'ResModifyEntry',
    $type: RMOD,
    order: ['$type', 'm_entryName', 'm_isQuestRegistry', 'm_value', 'm_questName'],
    controls: [
      ['m_entryName', 'textbox'],
      ['m_isQuestRegistry', 'checkbox'],
      ['m_value', 'spinbutton'],
      ['m_questName', 'combobox'],
    ],
  },
  {
    name: 'ResAddDynaMod',
    $type: RADM,
    order: [
      '$type',
      'm_dynaModClientTag',
      'm_dynaModRemove',
      'm_useQuestAsOriginator',
      'm_dynaModState',
      'm_zoneName',
    ],
    controls: [
      ['m_dynaModClientTag', 'textbox'],
      ['m_dynaModRemove', 'checkbox'],
      ['m_useQuestAsOriginator', 'checkbox'],
      ['m_dynaModState', 'textbox'],
      ['m_zoneName', 'combobox'],
    ],
  },
  {
    name: 'ResLearnSpell',
    $type: RLEARN,
    order: ['$type', 'm_templateID', 'm_requirements'],
    controls: [
      ['m_templateID', 'combobox'],
      ['m_requirements', 'region'],
    ],
  },
  {
    name: 'ResPostEvent',
    $type: REVENT,
    order: ['$type', 'm_eventName'],
    controls: [['m_eventName', 'textbox']],
  },
  { name: 'ResAddHealth', $type: RHEALTH, order: ['$type'], controls: [] },
  { name: 'ResAddMana', $type: RMANA, order: ['$type'], controls: [] },
  {
    name: 'ResAddSpell',
    $type: RADDS,
    order: ['$type', 'm_templateID'],
    controls: [['m_templateID', 'combobox']],
  },
  {
    name: 'ResDespawn',
    $type: RDESPAWN,
    order: ['$type', 'm_spawnID', 'm_despawnEffect', 'm_templateID'],
    controls: [
      ['m_spawnID', 'spinbutton'],
      ['m_despawnEffect', 'checkbox'],
      ['m_templateID', 'combobox'],
    ],
  },
  {
    name: 'ResDrawHand',
    $type: RDRAW,
    order: ['$type', 'm_templateID'],
    controls: [['m_templateID', 'combobox']],
  },
  {
    name: 'ResGiveSpell',
    $type: RGIVE,
    order: ['$type', 'm_templateID', 'm_spellID'],
    controls: [
      ['m_templateID', 'combobox'],
      ['m_spellID', 'combobox'],
    ],
  },
  {
    name: 'ResPlaySound',
    $type: RSOUND,
    order: ['$type', 'm_router', 'm_soundName', 'm_blocking', 'm_reinteractTime'],
    controls: [
      ['m_router', 'group'],
      ['m_soundName', 'textbox'],
      ['m_blocking', 'checkbox'],
      ['m_reinteractTime', 'spinbutton'],
    ],
  },
  {
    name: 'ResTeleport',
    $type: RTELE,
    order: [
      '$type',
      'm_destinationLoc',
      'm_destinationZone',
      'm_exitTeleporter',
      'm_teleporterTag',
      'm_teleportType',
      'm_transitionID',
    ],
    controls: [
      ['m_destinationLoc', 'textbox'],
      ['m_destinationZone', 'combobox'],
      ['m_exitTeleporter', 'spinbutton'],
      ['m_teleporterTag', 'spinbutton'],
      // A single-legal-value enum renders as read-only text (task 7.11), an `<output>`.
      ['m_teleportType', 'status'],
      ['m_transitionID', 'spinbutton'],
    ],
  },
  {
    name: 'ResWait',
    $type: RWAIT,
    order: ['$type', 'm_secondsToWait'],
    controls: [['m_secondsToWait', 'spinbutton']],
  },
];

/** The corpus's one measured router, verbatim. */
const ROUTER_SAMPLE = {
  m_locX: 0,
  m_locY: 0,
  m_locZ: 0,
  m_routingType: 'ROUTING_ACTOR',
  m_useLocation: false,
  m_useTriggerLocation: false,
};

/** The router's measured key order. */
const ROUTER_ORDER = [
  'm_locX',
  'm_locY',
  'm_locZ',
  'm_routingType',
  'm_useLocation',
  'm_useTriggerLocation',
];

const DROP_TABLES = [
  { name: 'WC-DROP-A', description: null },
  { name: 'WC-DROP-B', description: null },
];
const SPELLS = [
  { template_id: 625720646, name: 'Troll', school: 'Life' },
  { template_id: 1356552154, name: 'Fire Cat', school: 'Fire' },
];
const NPCS = [
  { template_id: 35528, name: 'Draconian', npc_type: null },
  { template_id: 39394, name: 'Lost Soul', npc_type: null },
];
const ZONES = [
  { zone_path: 'WizardCity/WC_Hub', display_name: 'Hub Square', world: 'WizardCity' },
  { zone_path: 'WizardCity/WC_Streets/WC_Unicorn', display_name: null, world: 'WizardCity' },
];
const QUESTS = [
  { quest_name: 'DS-ACAD1-C01-002', title: 'Second Quest', level: 3, is_mainline: 0 },
];

/** The default quest: two goals, empty start/end wrappers. */
function quest(): Record<string, unknown> {
  return {
    m_questName: QUEST_NAME,
    m_questTitle: 'QuestTitle_1ED8D',
    m_goals: [
      { $type: WAYPOINT, m_goalName: GOAL_A, m_goalType: 'GOAL_TYPE_WAYPOINT' },
      { $type: WAYPOINT, m_goalName: GOAL_B, m_goalType: 'GOAL_TYPE_WAYPOINT' },
    ],
    m_startResults: { m_results: [] },
    m_endResults: { m_results: [] },
  };
}

/** A quest whose goals carry results containers (the fifth, guarded home). */
function questWithGoalResults(): Record<string, unknown> {
  return {
    ...quest(),
    m_goals: [
      {
        $type: WAYPOINT,
        m_goalName: GOAL_A,
        m_goalType: 'GOAL_TYPE_WAYPOINT',
        m_completeResults: { m_results: [{ $type: RWAIT, m_secondsToWait: 5 }] },
        m_activateResults: { m_results: [] },
        m_tallyCounter: { m_percentChance: 1, m_count: 0, m_tallyResults: { m_results: [] } },
      },
      {
        $type: WAYPOINT,
        m_goalName: GOAL_B,
        m_goalType: 'GOAL_TYPE_WAYPOINT',
        m_completeResults: { m_results: [] },
        m_activateResults: { m_results: [] },
        m_tallyCounter: null,
      },
    ],
  };
}

/* -------------------------------------------------------------------- helpers */

/** The `<main>` region — the page, without the shell's sidebar/header. */
function main_(page: Page): Locator {
  return page.getByRole('main');
}

/** The panel `QuestDetailPage` mounts in the Results tab. */
function editor(page: Page): Locator {
  return main_(page).getByRole('region', { name: 'Quest results editor', exact: true });
}

/** One mounted wrapper's region, by its accessible name. */
function list(page: Page, label: string): Locator {
  return editor(page).getByRole('region', { name: label, exact: true });
}

/** A class's glossary pair (task 7.9): a card's title, and a type selector option's text. */
const TITLES: Record<string, string> = {
  ResDropTable: 'Reward: drop table (ResDropTable)',
  ResModifyEntry: 'Modify quest registry entry (ResModifyEntry)',
  ResAddDynaMod: 'Add or remove dynamic modifier (ResAddDynaMod)',
  ResLearnSpell: 'Teach spell (ResLearnSpell)',
  ResPostEvent: 'Post game event (ResPostEvent)',
  ResAddHealth: 'Restore health (ResAddHealth)',
  ResAddMana: 'Restore mana (ResAddMana)',
  ResAddSpell: 'Add spell to spellbook (ResAddSpell)',
  ResDespawn: 'Despawn NPC or object (ResDespawn)',
  ResDrawHand: 'Draw hand (ResDrawHand)',
  ResGiveSpell: 'Give spell to NPC (ResGiveSpell)',
  ResPlaySound: 'Play sound (ResPlaySound)',
  ResTeleport: 'Teleport player (ResTeleport)',
  ResWait: 'Wait (ResWait)',
  ReqSchoolOfFocus: 'Requires school of focus (ReqSchoolOfFocus)',
};

/**
 * A card by its **exact** document address (its `data-path`; task 7.9 keeps a path out of every
 * label) and its class. Task 7.10 titles a card by meaning: the class's glossary label, then its
 * operand (`Teach spell: Fireball`, `Reward: drop table Pesky Pirates`), so the accessible name
 * starts with the label, followed by `:` or a space.
 */
function card(scope: Locator, title: string, address: string): Locator {
  const label = (TITLES[title] ?? title).replace(/ \(\w+\)$/, '');
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return scope
    .getByRole('article', { name: new RegExp(`^${escaped}(?::| )`) })
    .and(scope.locator(`[data-path="${address}"]`));
}

/** The glossary pair of each field key a card's control is named by (task 7.9). */
const PAIRS: Record<string, string> = {
  m_blocking: 'Blocking (m_blocking)',
  m_despawnEffect: 'Despawn effect (m_despawnEffect)',
  m_destinationLoc: 'Destination location (m_destinationLoc)',
  m_destinationZone: 'Destination Zone (m_destinationZone)',
  m_dynaModClientTag: 'Modifier client tag (m_dynaModClientTag)',
  m_dynaModRemove: 'Remove modifier (m_dynaModRemove)',
  m_dynaModState: 'Modifier state (m_dynaModState)',
  m_entryName: 'Entry (m_entryName)',
  m_eventName: 'Event name (m_eventName)',
  m_exitTeleporter: 'Exit teleporter (m_exitTeleporter)',
  m_isQuestRegistry: 'Quest Registry (m_isQuestRegistry)',
  m_maxRolls: 'Max rolls (m_maxRolls)',
  m_questName: 'Quest (m_questName)',
  m_reinteractTime: 'Re-interact time (m_reinteractTime)',
  m_requirements: 'Requirements (m_requirements)',
  m_router: 'Sound router (m_router)',
  m_secondsToWait: 'Seconds to wait (m_secondsToWait)',
  m_soundName: 'Sound (m_soundName)',
  m_spawnID: 'Spawn ID (m_spawnID)',
  m_spellID: 'Spell (m_spellID)',
  m_tableName: 'Drop table (m_tableName)',
  m_teleportType: 'Teleport type (m_teleportType)',
  m_teleporterTag: 'Teleporter tag (m_teleporterTag)',
  m_templateID: 'Template ID (m_templateID)',
  m_transitionID: 'Transition ID (m_transitionID)',
  m_useQuestAsOriginator: 'Quest is the originator (m_useQuestAsOriginator)',
  m_value: 'Value (m_value)',
  m_zoneName: 'Zone name (m_zoneName)',
};

/** A start result's address in words — how an accessible name reads `m_startResults.m_results[i]`. */
function startWords(index: number): string {
  return `Start results › Results ${index + 1}`;
}

/** The Add Result selector of one list. */
function addSelector(scope: Locator): Locator {
  return scope.getByLabel('New result type', { exact: true });
}

/** The Add Result button of one list. */
function addButton(scope: Locator): Locator {
  return scope.getByRole('button', { name: 'Add Result', exact: true });
}

/** Adds a result of {@link type} to {@link scope}. */
/**
 * Opens a card's Advanced disclosure unless it opened itself (task 7.11: one holding a value that
 * differs from the default is already open, and a bare click would close it). A card with no
 * advanced field has none.
 */
async function openAdvanced(cardLoc: Locator): Promise<void> {
  const disclosure = cardLoc.getByTestId('advanced-disclosure');
  if ((await disclosure.count()) === 0) {
    return;
  }
  if (!(await disclosure.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await disclosure.locator('summary').click();
  }
  await expect(disclosure).toHaveAttribute('open', '');
}

async function addResult(scope: Locator, type: string): Promise<void> {
  await addSelector(scope).selectOption(type);
  await addButton(scope).click();
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

/** `doc[wrapper].m_results`. */
function itemsOf(doc: Record<string, unknown>, wrapper: string): Array<Record<string, unknown>> {
  const listValue = doc[wrapper] as Record<string, unknown> | undefined;
  return (listValue?.m_results ?? []) as Array<Record<string, unknown>>;
}

/** What the mocked names routes recorded, so a spec can assert what was *not* requested. */
interface NameRecording {
  /** Single-id lookups per type (`/api/names/<type>/<id>`) — a bulk list is not one. */
  lookups: Record<string, string[]>;
}

/**
 * The five bulk names lists this tab mounts (`items`/`strings` are unused here), plus a
 * counting 404 handler for each table's **single-id lookup** route. A value that resolves
 * from the cached list never issues one; the D59(c) hazard is that an empty or `null`
 * reference must not issue one either.
 */
async function mockNames(page: Page): Promise<NameRecording> {
  const recording: NameRecording = { lookups: { spells: [], npcs: [], zones: [], quests: [] } };
  const lists: Array<[string, unknown]> = [
    ['spells', SPELLS],
    ['npcs', NPCS],
    ['zones', ZONES],
    ['quests', QUESTS],
    ['drop_tables', DROP_TABLES],
  ];
  for (const [type, rows] of lists) {
    await page.route(`**/api/names/${type}`, (route) => route.fulfill({ json: { [type]: rows } }));
  }
  for (const type of ['spells', 'npcs', 'zones', 'quests', 'drop_tables']) {
    await page.route(`**/api/names/${type}/*`, (route) => {
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
      (recording.lookups[type] ??= []).push(id);
      return route.fulfill({ status: 404, json: { error: `Unknown ${type} id "${id}"` } });
    });
  }
  return recording;
}

interface OpenResult {
  recorded: NameRecording;
  /** The object the detail endpoint answers with; a reload test can replace it. */
  served: { current: Record<string, unknown> };
}

/** Mounts the page on {@link initial} and opens the Results tab. */
async function openResults(
  page: Page,
  initial: Record<string, unknown> = quest(),
): Promise<OpenResult> {
  const served = { current: initial };
  await mockQuestsApi(page, {
    onDetail: (route) => route.fulfill({ json: served.current }),
  });
  const recorded = await mockNames(page);
  await page.goto(`/quests/${QUEST_NAME}`);
  await main_(page).getByRole('tab', { name: 'Results', exact: true }).click();
  await expect(editor(page)).toBeVisible();
  return { recorded, served };
}

/** Opens a friendly-name dropdown and picks the option whose label is {@link label}. */
async function pickName(
  combobox: Locator,
  search: Locator,
  query: string,
  label: string,
): Promise<void> {
  await combobox.click();
  await expect(search).toBeVisible();
  await search.fill(query);
  await search.page().getByRole('option', { name: label, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
});

/* --------------------------------------------------------------- the selector */

test.describe('the result type selector', () => {
  test('offers exactly the 14 creatable classes, and never the corpus-only ResActorDialog', async ({
    page,
  }) => {
    await openResults(page);
    const options = await addSelector(list(page, 'Start results'))
      .locator('option')
      .allTextContents();
    expect(options).toEqual(TYPES.map((type) => TITLES[type.name]));
    expect(options).toHaveLength(14);
    // The corpus's 15th class is *known* — `ResActorDialog`, 5 nodes at the 328-quest
    // baseline, every one `{$type, m_dialog}` — and it *renders* (the unit suite's
    // "resolves the corpus-only ResActorDialog and discloses its nested dialog read-only").
    // It is never **offered** here: with no control for `m_dialog`, a create would write
    // `{$type}` with no dialog block, a shape the corpus has never had (D79/D80). The deep
    // equality above already excludes it; naming it here is what keeps the decision legible
    // to a reader who only skims the option list.
    expect(options).not.toContain('Actor dialog result (ResActorDialog)');
  });
});

/* --------------------------------------------- AC1: all 14 offered types, fields */

test.describe('AC1 — every one of the 14 offered types', () => {
  test('is addable with its exact field set, its key order and its character-for-character $type', async ({
    page,
  }) => {
    await openResults(page);
    const start = list(page, 'Start results');

    for (const type of TYPES) {
      await addResult(start, type.name);
    }

    // Every card is on screen with its own class title and absolute address.
    for (const [index, type] of TYPES.entries()) {
      const address = `m_startResults.m_results[${index}]`;
      await expect(card(start, type.name, address)).toBeVisible();
      await openAdvanced(card(start, type.name, address));
      for (const [key, role] of type.controls) {
        const name =
          role === 'region' ? `Requirements for ${startWords(index)}` : (PAIRS[key] ?? key);
        await expect(
          card(start, type.name, address).getByRole(role, { name, exact: true }),
        ).toBeVisible();
      }
    }

    // …and the document carries exactly the measured keys, in the measured order, with the
    // literal `$type` — the two claims deep equality cannot make.
    const doc = await copyPanelDocument(page);
    const items = itemsOf(doc, 'm_startResults');
    expect(items).toHaveLength(14);
    for (const [index, type] of TYPES.entries()) {
      const node = items[index] as Record<string, unknown>;
      expect(node.$type, type.name).toBe(type.$type);
      expect(Object.keys(node), type.name).toEqual(type.order);
    }
    // ResModifyEntry's corpus order is deliberately not the domain reference's prose order.
    expect(Object.keys(items[1] as object)).toEqual([
      '$type',
      'm_entryName',
      'm_isQuestRegistry',
      'm_value',
      'm_questName',
    ]);
  });

  test('keeps the wrapper untagged and its single key, and never reorders it', async ({ page }) => {
    await openResults(page);
    const start = list(page, 'Start results');
    await addResult(start, 'ResDropTable');
    await addResult(start, 'ResWait');

    const doc = await copyPanelDocument(page);
    const wrapper = doc.m_startResults as Record<string, unknown>;
    expect(Object.keys(wrapper)).toEqual(['m_results']);
    expect(Object.prototype.hasOwnProperty.call(wrapper, '$type')).toBe(false);
    // The goal-level wrappers are untouched by a start-results write.
    expect(doc.m_endResults).toEqual({ m_results: [] });
  });

  test('gives the two fieldless classes $type and nothing else', async ({ page }) => {
    await openResults(page);
    const start = list(page, 'Start results');
    await addResult(start, 'ResAddHealth');
    await addResult(start, 'ResAddMana');

    const items = itemsOf(await copyPanelDocument(page), 'm_startResults');
    expect(items[0]).toEqual({ $type: RHEALTH });
    expect(items[1]).toEqual({ $type: RMANA });
  });
});

/* --------------------------------------------------- preservation of an edit */

test.describe('an existing corpus node', () => {
  test('keeps its own key order, its empty reference and its unknown keys when a field is edited', async ({
    page,
  }) => {
    const seeded = {
      ...quest(),
      m_endResults: {
        m_results: [
          {
            $type: RMOD,
            m_entryName: 'GainedEnrollment',
            m_isQuestRegistry: false,
            m_value: 1,
            m_questName: '',
            m_legacyKey: 'kept',
          },
        ],
      },
    };
    await openResults(page, seeded);
    const end = list(page, 'End results');
    const wait = card(end, 'ResModifyEntry', 'm_endResults.m_results[0]');

    // One corpus value is visibly re-written; the empty `m_questName` shows the placeholder.
    await wait.getByRole('spinbutton', { name: 'Value (m_value)', exact: true }).fill('2');
    await wait.getByRole('textbox', { name: 'Entry (m_entryName)', exact: true }).fill('Renamed');

    const node = itemsOf(await copyPanelDocument(page), 'm_endResults')[0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(node)).toEqual([
      '$type',
      'm_entryName',
      'm_isQuestRegistry',
      'm_value',
      'm_questName',
      'm_legacyKey',
    ]);
    expect(node.m_value).toBe(2);
    expect(node.m_entryName).toBe('Renamed');
    expect(node.m_questName).toBe('');
    expect(node.m_legacyKey).toBe('kept');
    // …and the unmodelled key is disclosed rather than hidden.
    await wait.getByText(/Raw fields \(1 unmodelled\)/).click();
    await expect(wait.getByText(/preserved untouched: m_legacyKey/)).toBeVisible();
  });

  test('reloads a saved document and re-serializes it to the same bytes', async ({ page }) => {
    const { served } = await openResults(page);
    const start = list(page, 'Start results');
    await addResult(start, 'ResPlaySound');
    await addResult(start, 'ResTeleport');
    // D195: a new ResTeleport's `m_teleportType: 'TELEPORT_STATIC'` is its own default, so its
    // Advanced no longer opens by itself (the generic empty rule read the literal as authored).
    await openAdvanced(card(start, 'ResTeleport', 'm_startResults.m_results[1]'));
    await card(start, 'ResTeleport', 'm_startResults.m_results[1]')
      .getByRole('textbox', { name: 'Destination location (m_destinationLoc)', exact: true })
      .fill('Target location Landing');
    await card(start, 'ResPlaySound', 'm_startResults.m_results[0]')
      .getByRole('textbox', { name: 'Sound (m_soundName)', exact: true })
      .fill('ObjectData/StormStart.xml');

    const saved = await copyPanelText(page);
    expect(JSON.stringify(JSON.parse(saved).m_startResults, null, 2)).toContain('m_soundName');

    served.current = JSON.parse(saved) as Record<string, unknown>;
    await page.reload();
    await main_(page).getByRole('tab', { name: 'Results', exact: true }).click();
    await expect(editor(page)).toBeVisible();

    const again = await copyPanelText(page);
    expect(JSON.parse(again)).toEqual(JSON.parse(saved));
    expect(again).toBe(saved);
  });
});

/* ---------------------------------------------------------------- the router */

test.describe('the m_router sub-object', () => {
  test('renders the measured shape for a new node, keeps the order and gains no $type', async ({
    page,
  }) => {
    await openResults(page);
    const start = list(page, 'Start results');
    await addResult(start, 'ResPlaySound');
    const sound = card(start, 'ResPlaySound', 'm_startResults.m_results[0]');
    await openAdvanced(sound);
    const router = sound.getByRole('group', { name: 'Sound router (m_router)', exact: true });
    await expect(router).toBeVisible();

    // A new node carries the corpus's measured router, so the six controls show it.
    await expect(router.getByLabel('Location X (m_locX)', { exact: true })).toHaveValue('0');
    // One legal value, so it is read-only text rather than a one-option select (task 7.11).
    await expect(router.getByLabel('Routing type (m_routingType)', { exact: true })).toContainText(
      'ROUTING_ACTOR',
    );
    await expect(
      router.getByLabel('Use trigger location (m_useTriggerLocation)', { exact: true }),
    ).not.toBeChecked();
    await expect(sound.getByText(/the first edit writes it/)).toHaveCount(0);

    await router.getByLabel('Location X (m_locX)', { exact: true }).fill('12');
    await router.getByLabel('Use router location (m_useLocation)', { exact: true }).check();
    // `m_reinteractTime` is a result-level field, not a router sub-field.
    await sound
      .getByRole('spinbutton', { name: 'Re-interact time (m_reinteractTime)', exact: true })
      .fill('3');

    const node = itemsOf(await copyPanelDocument(page), 'm_startResults')[0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(node)).toEqual([
      '$type',
      'm_router',
      'm_soundName',
      'm_blocking',
      'm_reinteractTime',
    ]);
    const savedRouter = node.m_router as Record<string, unknown>;
    expect(Object.keys(savedRouter)).toEqual(ROUTER_ORDER);
    expect(Object.prototype.hasOwnProperty.call(savedRouter, '$type')).toBe(false);
    expect(savedRouter.m_locX).toBe(12);
    expect(savedRouter.m_useLocation).toBe(true);
    expect(node.m_reinteractTime).toBe(3);
  });

  test('writes the whole measured router on the first edit when m_router is absent', async ({
    page,
  }) => {
    // The schema makes `m_router` optional, so a document may simply not carry it.
    const seeded = {
      ...quest(),
      m_startResults: { m_results: [{ $type: RSOUND, m_soundName: '', m_blocking: false }] },
    };
    await openResults(page, seeded);
    const sound = card(list(page, 'Start results'), 'ResPlaySound', 'm_startResults.m_results[0]');
    await openAdvanced(sound);
    const router = sound.getByRole('group', { name: 'Sound router (m_router)', exact: true });
    await expect(sound.getByText(/the first edit writes it/)).toBeVisible();
    await expect(router.getByLabel('Location X (m_locX)', { exact: true })).toHaveValue('0');

    await router.getByLabel('Location X (m_locX)', { exact: true }).fill('12');

    const node = itemsOf(await copyPanelDocument(page), 'm_startResults')[0] as Record<
      string,
      unknown
    >;
    // `m_router` was absent, so the first edit creates it as the measured object with one
    // field overridden, and never as a tagged node. The document primitive appends an
    // absent key at the end (`setAtPath`'s documented merge rule) — an existing node's own
    // order is preserved, never rewritten.
    expect(Object.keys(node)).toEqual(['$type', 'm_soundName', 'm_blocking', 'm_router']);
    expect(node.m_router).toEqual({ ...ROUTER_SAMPLE, m_locX: 12 });
    expect(Object.keys(node.m_router as object)).toEqual(ROUTER_ORDER);
    expect(Object.prototype.hasOwnProperty.call(node.m_router, '$type')).toBe(false);
    // Editing a sub-field of an absent router did not disturb the fields that were there.
    expect(node.m_soundName).toBe('');
    expect(node.m_blocking).toBe(false);
  });

  test('keeps a corpus router’s own order when one sub-field is edited', async ({ page }) => {
    const seeded = {
      ...quest(),
      m_endResults: {
        m_results: [
          {
            $type: RSOUND,
            m_router: {
              m_locX: 0,
              m_locY: 0,
              m_locZ: 0,
              m_routingType: 'ROUTING_ACTOR',
              m_useLocation: false,
              m_useTriggerLocation: false,
            },
            m_soundName: '',
            m_blocking: false,
            m_reinteractTime: 0,
          },
        ],
      },
    };
    await openResults(page, seeded);
    const sound = card(list(page, 'End results'), 'ResPlaySound', 'm_endResults.m_results[0]');
    await openAdvanced(sound);
    const router = sound.getByRole('group', { name: 'Sound router (m_router)', exact: true });
    await expect(
      router.getByLabel('Re-interact time (m_reinteractTime)', { exact: true }),
    ).toHaveCount(0);
    await sound
      .getByRole('spinbutton', { name: 'Re-interact time (m_reinteractTime)', exact: true })
      .fill('3');
    await expect(router.getByLabel('Routing type (m_routingType)', { exact: true })).toContainText(
      'ROUTING_ACTOR',
    );

    const node = itemsOf(await copyPanelDocument(page), 'm_endResults')[0] as Record<
      string,
      unknown
    >;
    expect(Object.keys(node)).toEqual([
      '$type',
      'm_router',
      'm_soundName',
      'm_blocking',
      'm_reinteractTime',
    ]);
    // The result-level edit and the router sub-field edit did not disturb each other.
    expect(node.m_reinteractTime).toBe(3);
    expect(Object.keys(node.m_router as object)).toEqual(ROUTER_ORDER);
    expect((node.m_router as Record<string, unknown>).m_routingType).toBe('ROUTING_ACTOR');
    expect((node.m_router as Record<string, unknown>).m_locX).toBe(0);
  });
});

/* --------------------------------------------------- the ResLearnSpell tree */

test.describe('ResLearnSpell’s requirement slot', () => {
  test('mounts the shared tree over the corpus’s untyped wrapper and edits inside it', async ({
    page,
  }) => {
    await openResults(page);
    const start = list(page, 'Start results');
    await addResult(start, 'ResLearnSpell');
    const address = 'm_startResults.m_results[0]';
    const tree = card(start, 'ResLearnSpell', address).getByRole('region', {
      name: `Requirements for ${startWords(0)}`,
      exact: true,
    });
    await expect(tree).toBeVisible();

    // A new node gets the corpus's wrapper: untyped, `m_requirements` first, one
    // ReqSchoolOfFocus leaf.
    const wrapperPath = `${address}.m_requirements`;
    const fresh = itemsOf(await copyPanelDocument(page), 'm_startResults')[0] as Record<
      string,
      unknown
    >;
    const freshWrapper = fresh.m_requirements as Record<string, unknown>;
    expect(Object.keys(freshWrapper)).toEqual(['m_requirements', 'm_applyNOT', 'm_operator']);
    expect(Object.prototype.hasOwnProperty.call(freshWrapper, '$type')).toBe(false);
    expect((freshWrapper.m_requirements as unknown[]).length).toBe(1);

    // Add a condition, retype it and set its school — the shared tree's own vocabulary.
    await tree
      .locator(`button[data-path="${wrapperPath}"][aria-label^="Add Condition to "]`)
      .click();
    await tree
      .locator(`article[data-path="${wrapperPath}[1]"]`)
      .getByLabel('Type ($type)', { exact: true })
      .selectOption('ReqSchoolOfFocus');
    await card(start, 'ReqSchoolOfFocus', `${wrapperPath}[1]`)
      .getByLabel('School (m_magicSchool)', { exact: true })
      .selectOption('Storm');

    const node = itemsOf(await copyPanelDocument(page), 'm_startResults')[0] as Record<
      string,
      unknown
    >;
    const wrapper = node.m_requirements as Record<string, unknown>;
    expect(Object.keys(wrapper)).toEqual(['m_requirements', 'm_applyNOT', 'm_operator']);
    expect(Object.prototype.hasOwnProperty.call(wrapper, '$type')).toBe(false);
    expect(wrapper.m_requirements).toEqual([
      {
        $type: 'Imcodec.ObjectProperty.TypeCache.ReqSchoolOfFocus, Imcodec.ObjectProperty',
        m_magicSchool: '',
        m_applyNOT: false,
        m_operator: 'ROP_AND',
      },
      {
        $type: 'Imcodec.ObjectProperty.TypeCache.ReqSchoolOfFocus, Imcodec.ObjectProperty',
        m_magicSchool: 'Storm',
        m_applyNOT: false,
        m_operator: 'ROP_AND',
      },
    ]);
  });
});

/* ------------------------------------------------------- friendly-name fields */

test.describe('friendly-name dropdowns', () => {
  test('show the resolved name, store the raw id, and delete the key when cleared', async ({
    page,
  }) => {
    await openResults(page);
    const start = list(page, 'Start results');
    await addResult(start, 'ResAddSpell');
    const spell = card(start, 'ResAddSpell', 'm_startResults.m_results[0]');
    const combobox = spell.getByRole('combobox', {
      name: 'Template ID (m_templateID)',
      exact: true,
    });

    // The trigger reads as the spell's name; the document gets the raw template id.
    await pickName(
      combobox,
      page.getByRole('combobox', { name: 'Search spells', exact: true }),
      'Fire',
      'Fire Cat',
    );
    await expect(combobox).toContainText('Fire Cat');
    let node = itemsOf(await copyPanelDocument(page), 'm_startResults')[0] as Record<
      string,
      unknown
    >;
    expect(node.m_templateID).toBe(1356552154);

    // "None" clears the field: the key is deleted, never written as '' or 0.
    await combobox.click();
    await page.getByRole('option', { name: 'None', exact: true }).click();
    node = itemsOf(await copyPanelDocument(page), 'm_startResults')[0] as Record<string, unknown>;
    expect(Object.keys(node)).toEqual(['$type']);
  });

  test('shows a zone’s display name and a miss stays displayed and selected', async ({ page }) => {
    const seeded = {
      ...quest(),
      m_startResults: {
        m_results: [
          { $type: RADM, m_dynaModClientTag: 'T', m_zoneName: 'WizardCity/WC_Hub' },
          { $type: RTELE, m_destinationZone: 'Unknown/Interior/Variant' },
        ],
      },
    };
    await openResults(page, seeded);
    const start = list(page, 'Start results');

    // An id in the zones list displays its display name…
    await expect(
      card(start, 'ResAddDynaMod', 'm_startResults.m_results[0]').getByRole('combobox', {
        name: 'Zone name (m_zoneName)',
        exact: true,
      }),
    ).toContainText('Hub Square');

    // …and an id the table has never seen displays itself, unchanged, with no error.
    const teleport = card(start, 'ResTeleport', 'm_startResults.m_results[1]').getByRole(
      'combobox',
      {
        name: 'Destination Zone (m_destinationZone)',
        exact: true,
      },
    );
    await expect(teleport).toContainText('Unknown/Interior/Variant');
    await expect(teleport).not.toContainText('Select zones');
  });

  test('issues no lookup for an empty or null reference (the D59(c) hazard)', async ({ page }) => {
    const seeded = {
      ...quest(),
      m_endResults: {
        m_results: [
          { $type: RADM, m_dynaModClientTag: 'A', m_zoneName: '' },
          { $type: RADM, m_dynaModClientTag: 'B', m_zoneName: null },
          { $type: RMOD, m_entryName: 'E', m_questName: '' },
        ],
      },
    };
    const { recorded } = await openResults(page, seeded);
    const end = list(page, 'End results');

    // The three empty/null references render as the unset placeholder…
    await expect(
      card(end, 'ResAddDynaMod', 'm_endResults.m_results[0]').getByRole('combobox', {
        name: 'Zone name (m_zoneName)',
        exact: true,
      }),
    ).toContainText('Select zones');
    await expect(
      card(end, 'ResModifyEntry', 'm_endResults.m_results[2]').getByRole('combobox', {
        name: 'Quest (m_questName)',
        exact: true,
      }),
    ).toContainText('Select quests');

    // …and nothing was looked up (the list endpoints are not single-id lookups).
    expect(recorded.lookups.zones).toEqual([]);
    expect(recorded.lookups.quests).toEqual([]);

    // The values themselves are untouched by merely rendering the tab.
    const items = itemsOf(await copyPanelDocument(page), 'm_endResults') as Array<
      Record<string, unknown>
    >;
    expect(items[0]?.m_zoneName).toBe('');
    expect(items[1]?.m_zoneName).toBeNull();
    expect(items[2]?.m_questName).toBe('');
  });
});

/* ------------------------------------------------ the ResDrawHand ambiguity */

test.describe('ResDrawHand’s split template id', () => {
  test('resolves through whichever table knows the value, and never rewrites an unknown one', async ({
    page,
  }) => {
    const seeded = {
      ...quest(),
      m_startResults: {
        m_results: [
          { $type: RDRAW, m_templateID: 625720646 },
          { $type: RDRAW, m_templateID: 35528 },
          { $type: RDRAW, m_templateID: 999999999 },
        ],
      },
    };
    await openResults(page, seeded);
    const start = list(page, 'Start results');
    const addresses = [
      'm_startResults.m_results[0]',
      'm_startResults.m_results[1]',
      'm_startResults.m_results[2]',
    ];
    const spellCard = card(start, 'ResDrawHand', addresses[0] as string);
    const npcCard = card(start, 'ResDrawHand', addresses[1] as string);
    const unknownCard = card(start, 'ResDrawHand', addresses[2] as string);

    // 6 of the 8 corpus values are spells: the default source is Spells.
    await expect(
      spellCard.getByRole('combobox', { name: 'Template ID (m_templateID)', exact: true }),
    ).toContainText('Troll');
    await expect(
      spellCard.getByRole('button', {
        name: `Spells for Template ID (m_templateID) ${startWords(0)}`,
        exact: true,
      }),
    ).toHaveAttribute('aria-pressed', 'true');

    // 2 of the 8 are NPCs — and the NPC label is the documented `Name (TemplateID)`.
    await expect(
      npcCard.getByRole('combobox', { name: 'Template ID (m_templateID)', exact: true }),
    ).toContainText('Draconian (35528)');
    await expect(
      npcCard.getByRole('button', {
        name: `NPCs for Template ID (m_templateID) ${startWords(1)}`,
        exact: true,
      }),
    ).toHaveAttribute('aria-pressed', 'true');

    // A value neither table knows stays displayed and selected — and switching the source
    // does not rewrite it.
    await expect(
      unknownCard.getByRole('combobox', { name: 'Template ID (m_templateID)', exact: true }),
    ).toContainText('999999999');
    await unknownCard
      .getByRole('button', {
        name: `Spells for Template ID (m_templateID) ${startWords(2)}`,
        exact: true,
      })
      .click();
    await expect(
      unknownCard.getByRole('combobox', { name: 'Template ID (m_templateID)', exact: true }),
    ).toContainText('999999999');
    await expect(
      unknownCard.getByRole('button', {
        name: `Spells for Template ID (m_templateID) ${startWords(2)}`,
        exact: true,
      }),
    ).toHaveAttribute('aria-pressed', 'true');

    const items = itemsOf(await copyPanelDocument(page), 'm_startResults');
    expect(items[0]?.m_templateID).toBe(625720646);
    expect(items[1]?.m_templateID).toBe(35528);
    expect(items[2]?.m_templateID).toBe(999999999);
    expect(Object.keys(items[2] as object)).toEqual(['$type', 'm_templateID']);
  });
});

/* ------------------------------------------------------------- delete + homes */

test.describe('delete and the five mounted homes', () => {
  test('delete removes exactly one card', async ({ page }) => {
    await openResults(page);
    const start = list(page, 'Start results');
    await addResult(start, 'ResWait');
    await addResult(start, 'ResDropTable');

    await start
      .getByRole('button', { name: 'Delete Start results › Results 1', exact: true })
      .click();

    await expect(card(start, 'ResWait', 'm_startResults.m_results[0]')).toHaveCount(0);
    await expect(card(start, 'ResDropTable', 'm_startResults.m_results[0]')).toBeVisible();
    const items = itemsOf(await copyPanelDocument(page), 'm_startResults');
    expect(items).toHaveLength(1);
    expect(items[0]?.$type).toBe(RDROP);
  });

  test('mounts start, end and both per-goal wrappers, and the tally slot only where a counter exists', async ({
    page,
  }) => {
    await openResults(page, questWithGoalResults());

    await expect(list(page, 'Start results')).toBeVisible();
    await expect(list(page, 'End results')).toBeVisible();
    await expect(list(page, `Complete results for ${GOAL_A}`)).toBeVisible();
    await expect(list(page, `Activate results for ${GOAL_A}`)).toBeVisible();
    await expect(list(page, `Tally results for ${GOAL_A}`)).toBeVisible();
    await expect(list(page, `Complete results for ${GOAL_B}`)).toBeVisible();
    await expect(list(page, `Activate results for ${GOAL_B}`)).toBeVisible();
    // Goal B carries `m_tallyCounter: null`, so there is nothing to mount — and the panel
    // says so rather than offering a control that could not write.
    await expect(list(page, `Tally results for ${GOAL_B}`)).toHaveCount(0);
    await expect(editor(page).getByText(/No tally counter on this goal/)).toBeVisible();

    // The seeded goal-level node is edited in place, and nothing else moves.
    await card(
      list(page, `Complete results for ${GOAL_A}`),
      'ResWait',
      'm_goals[0].m_completeResults.m_results[0]',
    )
      .getByRole('spinbutton', { name: 'Seconds to wait (m_secondsToWait)', exact: true })
      .fill('7');
    const doc = await copyPanelDocument(page);
    const goals = doc.m_goals as Array<Record<string, unknown>>;
    const complete = goals[0]?.m_completeResults as Record<string, unknown>;
    expect((complete.m_results as Array<Record<string, unknown>>)[0]?.m_secondsToWait).toBe(7);
    expect(Object.keys(complete)).toEqual(['m_results']);
    expect(goals[1]?.m_completeResults).toEqual({ m_results: [] });
    expect(doc.m_startResults).toEqual({ m_results: [] });
  });

  test('adds into an absent wrapper as the corpus’s untagged shape', async ({ page }) => {
    // A goal whose `m_completeResults` key is absent entirely (the schema allows it).
    const seeded = {
      ...quest(),
      m_goals: [{ $type: WAYPOINT, m_goalName: GOAL_A, m_goalType: 'GOAL_TYPE_WAYPOINT' }],
    };
    await openResults(page, seeded);
    const complete = list(page, `Complete results for ${GOAL_A}`);
    await expect(complete.getByText('This list is absent or null.')).toBeVisible();
    await addResult(complete, 'ResAddHealth');

    const doc = await copyPanelDocument(page);
    const goal = (doc.m_goals as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    expect(goal.m_completeResults).toEqual({ m_results: [{ $type: RHEALTH }] });
    expect(Object.keys(goal.m_completeResults as object)).toEqual(['m_results']);
  });
});
