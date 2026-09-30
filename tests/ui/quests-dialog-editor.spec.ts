import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockQuestsApi } from './quests-mocks';

/**
 * Tier-1 Dialog-editor spec (plan task 3.8 / story p3-08, decision D23 tier 1 / D40).
 *
 * Drives the real `/quests/:questName` page in headless chromium with the API route-mocked,
 * exactly like `quests-results-editor.spec.ts`: nothing here needs the corpus, a database or the
 * dev stack beyond the harness's own.
 *
 * What this file proves, clause by clause of the story's acceptance criteria:
 *
 * - a corpus-shaped fixture with entries in **two tags** renders every entry (AC1), at the
 *   quest level **and** the per-goal level;
 * - the **five accordions** `[Basic][Camera][Sound][Animation][Advanced]` exist on every card
 *   with **Basic open and the other four collapsed** (AC1, spec L554), and all **seven** domain
 *   field groups are reachable inside them — Basic, Camera, Audio (Sound), Animation & NPC
 *   (Animation), and Duration & Timing + Walk-Away + UI Controls (Advanced);
 * - **Duplicate** and **Delete** work per entry, and **Add Dialog Entry** / **Add Dialog Tag**
 *   work per tag/list (AC1, spec L441-451);
 * - an edit leaves the entry's **`$type` and its 66-key order** exactly as they were, and the
 *   two sparse shapes (**45-key**, and the 65-key null-omitted shape the D17 clone carries)
 *   stay sparse (AC2's sibling clause: never padded);
 * - a **legacy unmodelled key** survives every edit **and** appears in the read-only
 *   raw-fields disclosure (AC2);
 * - the empty tag (`""`), the empty `m_dialogs` array and an absent/`null` list each render
 *   their own honest state rather than being padded;
 * - the two friendly-name fields resolve and store the **raw id**, a `0` template id and an
 *   unlisted zone path stay displayed and are never rewritten, a string-table key shows its
 *   resolved text, and an **empty** key issues **no** lookup (the D59(d) hazard);
 * - the numeric `m_cameraHidePlayers` select keeps an unlisted value selected.
 *
 * Coverage honesty: the fixture's field *values* are largely synthetic (the corpus's own
 * `m_requirements` is null on every one of the 1,882 corpus entries that carry the key (of 1,884 at
 * the owner's f9a1055 baseline; 1,706/1,706 before, D79) and only a handful of fields carry
 * content), while the
 * **key sets, key orders, `$type` literals, tags and the two sparse shapes are the measured
 * ones** and are hand-written below rather than imported from the app.
 */

/* ------------------------------------------------------------------- fixtures */

const ENTRY_TYPE = 'Imcodec.ObjectProperty.TypeCache.NPCDialogEntry, Imcodec.ObjectProperty';
const LIST_TYPE = 'Imcodec.ObjectProperty.TypeCache.ActorDialogList, Imcodec.ObjectProperty';
const WAYPOINT = 'Imcodec.ObjectProperty.TypeCache.WaypointGoalTemplate, Imcodec.ObjectProperty';

const QUEST_NAME = 'DS-ACAD1-C01-001';
const GOAL_A = '1_WizardQuestGoals_GotoZone';

/** The corpus's own 66-key entry order, hand-written (the assertion's independent copy). */
const ENTRY_ORDER = [
  '$type',
  'm_personaName',
  'm_nameOverride',
  'm_nameSTKey',
  'm_guiDisplay',
  'm_maxTimeSeconds',
  'm_invisible',
  'm_requirements',
  'm_dialog',
  'm_picture',
  'm_soundFile',
  'm_action',
  'm_dialogEvent',
  'm_actorTemplateID',
  'm_cameraName',
  'm_interpolationDuration',
  'm_cameraOffsetX',
  'm_cameraOffsetY',
  'm_cameraOffsetZ',
  'm_pitch',
  'm_yaw',
  'm_roll',
  'm_cameraShakeType',
  'm_cameraShakeDuration',
  'm_cameraShakeAmplitude',
  'm_bypassCameraOnReview',
  'm_cameraZoneName',
  'm_duration',
  'm_delay',
  'm_cameraHidePlayers',
  'm_walkAwayNpcTemplateID',
  'm_walkAwayExitDirectionInDegrees',
  'm_walkAwayFadeTime',
  'm_walkAwayUseCurrentFacing',
  'm_standInPlayerTag',
  'm_fadeOutCamera',
  'm_snapCameraToPlayerAtExit',
  'm_secondaryCameraName',
  'm_secondaryInterpolationDuration',
  'm_npcStandInList',
  'm_dialogAnimationList',
  'm_dialogTurningList',
  'm_npcYawOffsetInDegrees',
  'm_allowPlayerToMove',
  'm_soundEffectFile',
  'm_musicFile',
  'm_nonStackableMusic',
  'm_nonRepeatableMusic',
  'm_playMusicAtSFXVolume',
  'm_soundEffectDelay',
  'm_musicDelay',
  'm_musicFadeTime',
  'm_dontReleaseCameraAtExit',
  'm_disableBackButton',
  'm_enableExitButton',
  'm_cameraFadeType',
  'm_cameraFadeTime',
  'm_idleAnimation',
  'm_spamTime',
  'm_playSoundIfSpamming',
  'm_playMusicIfSpamming',
  'm_stopMusicFadeTime',
  'm_restartMusicFadeTime',
  'm_meetsRequirements',
  'm_secondaryCameraInitalDelay',
  'm_displayButtonsOnTimedDialog',
];

/** The 21 keys the 45-key corpus shape omits (everything after `m_soundEffectFile`). */
const MISSING_45 = [
  'm_musicFile',
  'm_nonStackableMusic',
  'm_nonRepeatableMusic',
  'm_playMusicAtSFXVolume',
  'm_soundEffectDelay',
  'm_musicDelay',
  'm_musicFadeTime',
  'm_dontReleaseCameraAtExit',
  'm_disableBackButton',
  'm_enableExitButton',
  'm_cameraFadeType',
  'm_cameraFadeTime',
  'm_idleAnimation',
  'm_spamTime',
  'm_playSoundIfSpamming',
  'm_playMusicIfSpamming',
  'm_stopMusicFadeTime',
  'm_restartMusicFadeTime',
  'm_meetsRequirements',
  'm_secondaryCameraInitalDelay',
  'm_displayButtonsOnTimedDialog',
];

/** The 6-key group order, hand-written. */
const GROUP_ORDER = [
  'm_dialogTag',
  'm_dialogEntries',
  'm_madlibs',
  'm_dialogEvents',
  'm_noAggroWhileDialogIsUp',
  'm_noAggroNoDelay',
];

/**
 * A corpus-shaped entry: every one of the 66 keys in the corpus's order, with the values the
 * tests need. Everything else is an explicit `null`, which is what the corpus uses for "no
 * value" and which the renderer tolerates (empty text, unchecked box, unset select).
 */
function makeEntry(values: Record<string, unknown> = {}): Record<string, unknown> {
  const entry: Record<string, unknown> = {};
  for (const key of ENTRY_ORDER) {
    entry[key] = key === '$type' ? ENTRY_TYPE : null;
  }
  return { ...entry, ...values };
}

/**
 * The 45-key sparse shape: `$type` first and every key up to `m_soundEffectFile`, with the 21
 * audio-tail/`m_idleAnimation`/timing/UI keys **absent** (the corpus's own shape, all six
 * occurrences in `WC-UNICORN-SIDE-001`).
 */
function makeSparse45(values: Record<string, unknown> = {}): Record<string, unknown> {
  const entry: Record<string, unknown> = {};
  for (const key of ENTRY_ORDER) {
    if (MISSING_45.includes(key)) {
      continue;
    }
    entry[key] = key === '$type' ? ENTRY_TYPE : null;
  }
  return { ...entry, ...values };
}

/** The corpus's own 6-key tag group. */
function makeGroup(tag: string, entries: unknown[]): Record<string, unknown> {
  return {
    m_dialogTag: tag,
    m_dialogEntries: entries,
    m_madlibs: null,
    m_dialogEvents: null,
    m_noAggroWhileDialogIsUp: false,
    m_noAggroNoDelay: false,
  };
}

const NPCS = [
  { template_id: 126322, name: 'Zarek Pickmaster', npc_type: null },
  { template_id: 38206, name: 'Sergeant Muldoon', npc_type: null },
];
const ZONES = [
  { zone_path: 'WizardCity/WC_Hub', display_name: 'Hub Square', world: 'WizardCity' },
  { zone_path: 'DragonSpire/DS_A3_Kings', display_name: null, world: 'DragonSpire' },
];
const STRINGS: Record<string, string> = {
  WizQst1ED8D_00000005: 'Oh! My pardon! You are a prospective student?',
  NPCFormats_First_Last: '#1:$NPC_FIRSTNAME$ #2:$NPC_LASTNAME$',
};

/** The default quest: one quest-level list with two tags, plus one goal-level list. */
function quest(): Record<string, unknown> {
  return {
    m_questName: QUEST_NAME,
    m_questTitle: 'QuestTitle_1ED8D',
    m_goals: [
      {
        $type: WAYPOINT,
        m_goalName: GOAL_A,
        m_goalType: 'GOAL_TYPE_WAYPOINT',
        m_dialogList: {
          $type: LIST_TYPE,
          m_dialogs: [
            makeGroup('Completion', [
              makeEntry({
                m_personaName: 'DS-ACAD1-NPC01_Persona',
                m_dialog: 'WizQst1ED8D_00000005',
                m_actorTemplateID: 126322,
                m_cameraHidePlayers: 2,
              }),
            ]),
          ],
        },
      },
    ],
    m_dialogList: {
      $type: LIST_TYPE,
      m_dialogs: [
        makeGroup('Prep', [
          makeEntry({
            m_personaName: 'DS-ACAD1-NPC01_Persona',
            m_nameSTKey: 'NPCFormats_First_Last',
            m_dialog: 'WizQst1ED8D_00000005',
            m_actorTemplateID: 126322,
            m_cameraHidePlayers: 2,
          }),
        ]),
        makeGroup('', [makeSparse45({ m_dialog: 'WizQst1ED8D_00000006' })]),
      ],
    },
  };
}

/* -------------------------------------------------------------------- helpers */

/** The `<main>` region — the page, without the shell's sidebar/header. */
function main_(page: Page): Locator {
  return page.getByRole('main');
}

/** The panel `QuestDetailPage` mounts in the Dialog tab. */
function editor(page: Page): Locator {
  return main_(page).getByRole('region', { name: 'Quest dialog editor', exact: true });
}

/** One mounted list's region, by its accessible name. */
function list(page: Page, label: string): Locator {
  return editor(page).getByRole('region', { name: label, exact: true });
}

/**
 * One tag section by its exact document address (its `data-path`; task 7.9 keeps a path out of
 * every label) and the ordinal its accessible name starts with (`Dialog tag 1 <address in words>`).
 */
function tag(scope: Locator, index: number, address: string): Locator {
  return scope.locator(`section[data-path="${address}"][aria-label^="Dialog tag ${index} "]`);
}

/** One entry card by its exact `data-path` and its ordinal (`Entry 1 <address in words>`). */
function card(scope: Locator, index: number, address: string): Locator {
  return scope.locator(`article[data-path="${address}"][aria-label^="Entry ${index} "]`);
}

/** A card's `Duplicate` / `Delete` action, by its exact `data-path` and its verb. */
function action(scope: Locator, verb: string, address: string): Locator {
  return scope.locator(`button[data-path="${address}"][aria-label^="${verb} "]`);
}

/** An accordion's disclosure button on one card. */
function accordion(cardLoc: Locator, label: string): Locator {
  return cardLoc.getByRole('button', { name: label, exact: true });
}

/**
 * Opens an accordion unless it is already open (task 7.11: one holding a non-default value, or a
 * validation message, opens on its own, so a bare click would close it).
 */
async function reveal(cardLoc: Locator, label: string): Promise<void> {
  const button = accordion(cardLoc, label);
  if ((await button.getAttribute('aria-expanded')) === 'false') {
    await button.click();
  }
  await expect(button).toHaveAttribute('aria-expanded', 'true');
}

/** An accordion's body — `includeHidden` so a collapsed panel is assertable. */
function panel(cardLoc: Locator, label: string): Locator {
  return cardLoc.getByRole('group', { name: `${label} fields`, exact: true, includeHidden: true });
}

const QUEST_LIST = 'Quest dialog list';
const QUEST_ADDRESS = 'm_dialogList.m_dialogs[0].m_dialogEntries[0]';
const EMPTY_TAG_ADDRESS = 'm_dialogList.m_dialogs[1].m_dialogEntries[0]';

/** Opens the JSON side panel. */
async function openJson(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Toggle JSON panel' }).click();
  const panelLocator = page.getByRole('complementary', { name: 'Quest JSON' });
  await expect(panelLocator).toBeVisible();
  return panelLocator;
}

/**
 * The live document's text, read through the JSON panel's own `[Copy]` affordance — the same
 * clipboard wipe + poll `quests-results-editor.spec.ts` uses (the click starts an async
 * serialize-then-write, so a straight read can catch the previous document).
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

/** `doc.m_dialogList.m_dialogs`. */
function groupsOf(doc: Record<string, unknown>): Array<Record<string, unknown>> {
  const listValue = doc.m_dialogList as Record<string, unknown> | undefined;
  return (listValue?.m_dialogs ?? []) as Array<Record<string, unknown>>;
}

/** `doc.m_dialogList.m_dialogs[g].m_dialogEntries[e]`. */
function entryOf(
  doc: Record<string, unknown>,
  groupIndex: number,
  entryIndex: number,
): Record<string, unknown> {
  const group = groupsOf(doc)[groupIndex] as Record<string, unknown>;
  return (group.m_dialogEntries as Array<Record<string, unknown>>)[entryIndex] as Record<
    string,
    unknown
  >;
}

/** What the mocked names routes recorded, so a spec can assert what was *not* requested. */
interface NameRecording {
  /** Single-id lookups per type (`/api/names/<type>/<id>`) — a bulk list is not one. */
  lookups: Record<string, string[]>;
}

/**
 * The three names tables this tab mounts (`npcs` and `zones` for the two dropdowns, `strings`
 * for the two string-table keys), plus a counting handler for each table's **single-id lookup**
 * route. A value that resolves from a cached list never issues one; the D59(d) hazard is that
 * an **empty or null** key must not issue one either — which is what the `strings` recorder is
 * for, because `/api/names/strings/` would answer the whole 216,991-row table.
 */
async function mockNames(page: Page): Promise<NameRecording> {
  const recording: NameRecording = { lookups: { npcs: [], zones: [], strings: [] } };
  await page.route('**/api/names/npcs', (route) => route.fulfill({ json: { npcs: NPCS } }));
  await page.route('**/api/names/zones', (route) => route.fulfill({ json: { zones: ZONES } }));
  for (const type of ['npcs', 'zones']) {
    await page.route(`**/api/names/${type}/*`, (route) => {
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
      (recording.lookups[type] ??= []).push(id);
      return route.fulfill({ status: 404, json: { error: `Unknown ${type} id "${id}"` } });
    });
  }
  // One handler covers `**/api/names/strings**` — the single-id route *and* the bare list
  // route (`/api/names/strings`), because the whole point of the recorder is to prove the
  // list route is never reached (it would answer 216,991 rows / 24 MB).
  await page.route('**/api/names/strings**', (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/names/strings' || pathname === '/api/names/strings/') {
      (recording.lookups.strings ??= []).push('');
      return route.fulfill({
        json: { strings: [{ key: '', value: 'THE WHOLE TABLE', category: null }] },
      });
    }
    const key = decodeURIComponent(pathname.split('/').pop() ?? '');
    (recording.lookups.strings ??= []).push(key);
    const value = STRINGS[key];
    return value === undefined
      ? route.fulfill({ status: 404, json: { error: `Unknown string key "${key}"` } })
      : route.fulfill({ json: { key, value, category: 'QuestText' } });
  });
  return recording;
}

interface OpenResult {
  recorded: NameRecording;
}

/** Mounts the page on {@link initial} and opens the Dialog tab. */
async function openDialog(
  page: Page,
  initial: Record<string, unknown> = quest(),
): Promise<OpenResult> {
  await mockQuestsApi(page, {
    onDetail: (route) => route.fulfill({ json: initial }),
  });
  const recorded = await mockNames(page);
  await page.goto(`/quests/${QUEST_NAME}`);
  await main_(page).getByRole('tab', { name: 'Dialog', exact: true }).click();
  await expect(editor(page)).toBeVisible();
  return { recorded };
}

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
});

/* -------------------------------------------------------- AC1: entries render */

test.describe('AC1 — a corpus quest with m_dialogList', () => {
  test('renders every entry of both tags at the quest and the goal level', async ({ page }) => {
    await openDialog(page);
    const questList = list(page, QUEST_LIST);
    await expect(tag(questList, 1, 'm_dialogList.m_dialogs[0]')).toBeVisible();
    await expect(tag(questList, 2, 'm_dialogList.m_dialogs[1]')).toBeVisible();
    await expect(card(questList, 1, QUEST_ADDRESS)).toBeVisible();
    await expect(card(questList, 1, EMPTY_TAG_ADDRESS)).toBeVisible();
    // The tags themselves are shown, including the measured empty tag.
    await expect(tag(questList, 1, 'm_dialogList.m_dialogs[0]')).toContainText('Prep');
    await expect(tag(questList, 2, 'm_dialogList.m_dialogs[1]')).toContainText('(empty tag)');

    // The second home: the goal-level list is mounted and labelled after its goal.
    const goalList = list(page, `Dialog list for ${GOAL_A}`);
    await expect(goalList).toBeVisible();
    await expect(
      card(goalList, 1, `m_goals[0].m_dialogList.m_dialogs[0].m_dialogEntries[0]`),
    ).toBeVisible();
    await expect(goalList).toContainText('Completion');
  });

  test('gives every card the 5 accordions with Basic open and the other four collapsed', async ({
    page,
  }) => {
    await openDialog(page);
    const questCard = card(list(page, QUEST_LIST), 1, QUEST_ADDRESS);

    for (const label of ['Basic', 'Camera', 'Sound', 'Animation', 'Advanced']) {
      await expect(accordion(questCard, label)).toBeVisible();
    }
    // Spec L554: Basic open by default, the rest collapsed, except an accordion that holds a value
    // differing from the skeleton default (task 7.11): this entry carries `m_cameraHidePlayers: 2`
    // (Camera) and `m_nameSTKey` (Advanced), so those two open on their own.
    await expect(accordion(questCard, 'Basic')).toHaveAttribute('aria-expanded', 'true');
    await expect(panel(questCard, 'Basic')).toBeVisible();
    for (const label of ['Sound', 'Animation']) {
      await expect(accordion(questCard, label)).toHaveAttribute('aria-expanded', 'false');
      await expect(panel(questCard, label)).toBeHidden();
    }
    for (const label of ['Camera', 'Advanced']) {
      await expect(accordion(questCard, label)).toHaveAttribute('aria-expanded', 'true');
      await expect(panel(questCard, label)).toBeVisible();
    }

    // Opening one reveals its fields; closing Basic hides them again.
    await accordion(questCard, 'Sound').click();
    await expect(panel(questCard, 'Sound')).toBeVisible();
    await expect(questCard.getByLabel('Music file (m_musicFile)', { exact: true })).toBeVisible();
    await accordion(questCard, 'Basic').click();
    await expect(panel(questCard, 'Basic')).toBeHidden();
  });

  test('reaches all seven domain field groups through the five accordions', async ({ page }) => {
    await openDialog(page);
    const questCard = card(list(page, QUEST_LIST), 1, QUEST_ADDRESS);

    // Basic (open): the spec's own ASCII list.
    await expect(questCard.getByLabel('Dialog text (m_dialog)', { exact: true })).toBeVisible();
    await expect(
      questCard.getByLabel('Max display time (m_maxTimeSeconds)', { exact: true }),
    ).toBeVisible();
    await expect(
      questCard.getByRole('checkbox', { name: 'Invisible (m_invisible)', exact: true }),
    ).toBeVisible();

    // Camera.
    await reveal(questCard, 'Camera');
    await expect(
      questCard.getByLabel('Camera zone (m_cameraZoneName)', { exact: true }),
    ).toBeVisible();
    await expect(
      questCard.getByRole('combobox', { name: 'Hide players (m_cameraHidePlayers)', exact: true }),
    ).toBeVisible();

    // Audio → the Sound accordion.
    await reveal(questCard, 'Sound');
    await expect(questCard.getByLabel('Music file (m_musicFile)', { exact: true })).toBeVisible();

    // Animation & NPC → the Animation accordion.
    await reveal(questCard, 'Animation');
    await expect(
      questCard.getByLabel('Dialog animations (m_dialogAnimationList)', { exact: true }),
    ).toBeVisible();

    // Duration & Timing + Walk-Away + UI Controls → Advanced.
    await reveal(questCard, 'Advanced');
    await expect(
      questCard.getByLabel('Show buttons on timed dialog (m_displayButtonsOnTimedDialog)', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      questCard.getByLabel('Walk-away fade time (m_walkAwayFadeTime)', { exact: true }),
    ).toBeVisible();
    await expect(
      questCard.getByRole('checkbox', {
        name: 'Meets requirements (m_meetsRequirements)',
        exact: true,
      }),
    ).toBeVisible();
  });

  test('the entry actions are Duplicate, Delete, Add Dialog Entry and Add Dialog Tag', async ({
    page,
  }) => {
    await openDialog(page);
    const questList = list(page, QUEST_LIST);
    const questCard = card(questList, 1, QUEST_ADDRESS);
    await expect(action(questCard, 'Duplicate', QUEST_ADDRESS)).toBeVisible();
    await expect(action(questCard, 'Delete', QUEST_ADDRESS)).toBeVisible();
    await expect(
      tag(questList, 1, 'm_dialogList.m_dialogs[0]').getByRole('button', {
        name: 'Add Dialog Entry',
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      questList.getByRole('button', { name: 'Add Dialog Tag', exact: true }),
    ).toBeVisible();
    await expect(questList.getByLabel('New dialog tag', { exact: true })).toBeVisible();
  });
});

/* ---------------------------------------------------------- the entry actions */

test.describe('the entry actions', () => {
  test('Duplicate copies the entry verbatim, after the original', async ({ page }) => {
    // A legacy key on the duplicated entry proves the copy is byte-for-byte, not a rebuild.
    const seeded = {
      ...quest(),
      m_dialogList: {
        $type: LIST_TYPE,
        m_dialogs: [
          makeGroup('Prep', [
            makeEntry({
              m_personaName: 'DS-ACAD1-NPC01_Persona',
              m_dialog: 'WizQst1ED8D_00000005',
              m_legacyKey: 'kept',
            }),
          ]),
        ],
      },
    };
    await openDialog(page, seeded);
    const questList = list(page, QUEST_LIST);
    await action(card(questList, 1, QUEST_ADDRESS), 'Duplicate', QUEST_ADDRESS).click();

    await expect(card(questList, 2, 'm_dialogList.m_dialogs[0].m_dialogEntries[1]')).toBeVisible();
    const doc = await copyPanelDocument(page);
    const original = entryOf(doc, 0, 0);
    const copy = entryOf(doc, 0, 1);
    expect(Object.keys(copy)).toEqual([...ENTRY_ORDER, 'm_legacyKey']);
    expect(Object.keys(copy)).toEqual(Object.keys(original));
    expect(copy.m_dialog).toBe('WizQst1ED8D_00000005');
    expect(copy.m_legacyKey).toBe('kept');
  });

  test('Delete removes exactly one entry, and Add Dialog Entry writes the corpus’s 66 keys', async ({
    page,
  }) => {
    await openDialog(page);
    const questList = list(page, QUEST_LIST);
    const firstTag = tag(questList, 1, 'm_dialogList.m_dialogs[0]');

    await firstTag.getByRole('button', { name: 'Add Dialog Entry', exact: true }).click();
    await expect(card(questList, 2, 'm_dialogList.m_dialogs[0].m_dialogEntries[1]')).toBeVisible();
    let doc = await copyPanelDocument(page);
    expect(Object.keys(entryOf(doc, 0, 1))).toEqual(ENTRY_ORDER);
    // The new entry is corpus-shaped: m_requirements is written as the null the corpus uses,
    // and the one spec-listed key no corpus entry carries is never invented.
    expect(entryOf(doc, 0, 1).m_requirements).toBeNull();
    expect(Object.keys(entryOf(doc, 0, 1))).not.toContain('m_defaultDialogAnimation');

    await action(card(questList, 1, QUEST_ADDRESS), 'Delete', QUEST_ADDRESS).click();
    // Deleting index 0 shifts the new entry into index 0: the card that remains is the new one,
    // and the deleted entry's persona is gone.
    await expect(card(questList, 1, 'm_dialogList.m_dialogs[0].m_dialogEntries[0]')).toContainText(
      'NPCDialogEntry',
    );
    await expect(questList.getByText('DS-ACAD1-NPC01_Persona', { exact: true })).toHaveCount(0);
    doc = await copyPanelDocument(page);
    expect(groupsOf(doc)[0]?.m_dialogEntries).toHaveLength(1);
    expect(entryOf(doc, 0, 0).m_legacyKey).toBeUndefined();
  });

  test('Add Dialog Tag appends a 6-key group with one entry and the chosen tag', async ({
    page,
  }) => {
    await openDialog(page);
    const questList = list(page, QUEST_LIST);
    await questList.getByLabel('New dialog tag', { exact: true }).selectOption('Completion');
    await questList.getByRole('button', { name: 'Add Dialog Tag', exact: true }).click();

    await expect(tag(questList, 3, 'm_dialogList.m_dialogs[2]')).toBeVisible();
    const doc = await copyPanelDocument(page);
    const group = groupsOf(doc)[2] as Record<string, unknown>;
    expect(Object.keys(group)).toEqual(GROUP_ORDER);
    expect(group.m_dialogTag).toBe('Completion');
    expect(group.m_madlibs).toBeNull();
    expect(group.m_dialogEvents).toBeNull();
    expect(group.m_noAggroWhileDialogIsUp).toBe(false);
    expect(group.m_noAggroNoDelay).toBe(false);
    // 0 of the 774 corpus groups has an empty m_dialogEntries, so a new group carries one entry
    // rather than a shape the corpus has never had.
    expect(Object.keys(entryOf(doc, 2, 0))).toEqual(ENTRY_ORDER);
  });
});

/* ------------------------------------------------- AC2: preservation + raw keys */

test.describe('AC2 — an edit preserves the entry’s shape', () => {
  test('keeps the $type, the 66-key order and every sibling when one field is edited', async ({
    page,
  }) => {
    await openDialog(page);
    const questCard = card(list(page, QUEST_LIST), 1, QUEST_ADDRESS);
    await questCard
      .getByLabel('Dialog text (m_dialog)', { exact: true })
      .fill('WizQst1ED8D_00000009');
    await questCard.getByLabel('Name override (m_nameOverride)', { exact: true }).fill('Renamed');

    const entry = entryOf(await copyPanelDocument(page), 0, 0);
    expect(Object.keys(entry)).toEqual(ENTRY_ORDER);
    expect(Object.keys(entry)).toHaveLength(66);
    expect(entry.$type).toBe(ENTRY_TYPE);
    expect(entry.m_dialog).toBe('WizQst1ED8D_00000009');
    expect(entry.m_nameOverride).toBe('Renamed');
    // Nothing else moved: the corpus's own values and the two untouched nulls are intact.
    expect(entry.m_actorTemplateID).toBe(126322);
    expect(entry.m_cameraHidePlayers).toBe(2);
    expect(entry.m_picture).toBeNull();
    expect(entry.m_requirements).toBeNull();
    const list_ = (await copyPanelDocument(page)).m_dialogList as Record<string, unknown>;
    expect(Object.keys(list_)).toEqual(['$type', 'm_dialogs']);
    expect(list_.$type).toBe(LIST_TYPE);
  });

  test('keeps a legacy key intact and discloses it read-only', async ({ page }) => {
    const seeded = {
      ...quest(),
      m_dialogList: {
        $type: LIST_TYPE,
        m_dialogs: [
          makeGroup('Prep', [makeEntry({ m_dialog: 'WizQst1ED8D_00000005', m_legacyKey: 'kept' })]),
        ],
      },
    };
    await openDialog(page, seeded);
    const questCard = card(list(page, QUEST_LIST), 1, QUEST_ADDRESS);
    // The disclosure is present before any edit…
    await questCard.getByText(/Raw fields \(1 unmodelled\)/).click();
    await expect(questCard.getByText(/preserved untouched: m_legacyKey/)).toBeVisible();
    await expect(questCard.getByText('"kept"')).toBeVisible();

    // …and the key survives an edit to another field.
    await questCard
      .getByLabel('Dialog text (m_dialog)', { exact: true })
      .fill('WizQst1ED8D_00000010');
    const entry = entryOf(await copyPanelDocument(page), 0, 0);
    expect(entry.m_legacyKey).toBe('kept');
    expect(entry.m_dialog).toBe('WizQst1ED8D_00000010');
  });

  test('leaves a 45-key sparse entry sparse when a field it does have is edited', async ({
    page,
  }) => {
    await openDialog(page);
    const questCard = card(list(page, QUEST_LIST), 1, EMPTY_TAG_ADDRESS);
    await questCard
      .getByLabel('Dialog text (m_dialog)', { exact: true })
      .fill('WizQst1ED8D_00000007');

    const entry = entryOf(await copyPanelDocument(page), 1, 0);
    expect(Object.keys(entry)).toHaveLength(45);
    expect(Object.keys(entry)).toEqual(ENTRY_ORDER.filter((key) => !MISSING_45.includes(key)));
    for (const key of MISSING_45) {
      expect(Object.prototype.hasOwnProperty.call(entry, key), key).toBe(false);
    }
    // The field that was edited did change, so the assertion is not vacuous.
    expect(entry.m_dialog).toBe('WizQst1ED8D_00000007');
  });

  test('never writes a missing key into the empty-tag group’s own shape', async ({ page }) => {
    await openDialog(page);
    const questList = list(page, QUEST_LIST);
    const emptyTag = tag(questList, 2, 'm_dialogList.m_dialogs[1]');
    // The measured empty tag is real content: it renders as `(empty tag)` and its control
    // holds the empty string — it is not "fixed", and the key is not deleted.
    await expect(emptyTag.getByLabel('Dialog tag (m_dialogTag)', { exact: true })).toHaveValue('');
    await emptyTag.getByLabel('Dialog tag (m_dialogTag)', { exact: true }).fill('Prep');
    const group = groupsOf(await copyPanelDocument(page))[1] as Record<string, unknown>;
    expect(Object.keys(group)).toEqual(GROUP_ORDER);
    expect(group.m_dialogTag).toBe('Prep');
    await emptyTag.getByLabel('Dialog tag (m_dialogTag)', { exact: true }).fill('');
    const again = groupsOf(await copyPanelDocument(page))[1] as Record<string, unknown>;
    expect(Object.keys(again)).toEqual(GROUP_ORDER);
    expect(again.m_dialogTag).toBe('');
  });
});

/* ------------------------------------------------------------ the empty states */

test.describe('the empty and absent states', () => {
  test('renders the empty m_dialogs array as an empty state, never padded', async ({ page }) => {
    const seeded = { ...quest(), m_dialogList: { $type: LIST_TYPE, m_dialogs: [] } };
    await openDialog(page, seeded);
    const questList = list(page, QUEST_LIST);
    await expect(questList.getByText('This dialog list has no dialog tags.')).toBeVisible();
    await expect(questList.getByRole('article')).toHaveCount(0);
    await expect(
      questList.getByRole('button', { name: 'Add Dialog Tag', exact: true }),
    ).toBeVisible();
    const doc = await copyPanelDocument(page);
    expect((doc.m_dialogList as Record<string, unknown>).m_dialogs).toEqual([]);
  });

  test('renders an absent and a null list with its own sentence, and still offers Add', async ({
    page,
  }) => {
    for (const wrapper of [undefined, null]) {
      // `undefined` is dropped by the JSON response, so the two arms are "absent" and "null".
      const seeded = { m_questName: QUEST_NAME, m_goals: [], m_dialogList: wrapper };
      await openDialog(page, seeded);
      const questList = list(page, QUEST_LIST);
      await expect(questList.getByText('This dialog list is absent or null.')).toBeVisible();
      // The first Add writes the corpus's own {$type, m_dialogs} shape.
      await questList.getByRole('button', { name: 'Add Dialog Tag', exact: true }).click();
      const list_ = (await copyPanelDocument(page)).m_dialogList as Record<string, unknown>;
      expect(Object.keys(list_)).toEqual(['$type', 'm_dialogs']);
      expect(list_.$type).toBe(LIST_TYPE);
    }
  });

  test('a goal whose m_dialogList is null is still mounted and can be filled', async ({ page }) => {
    const seeded = {
      ...quest(),
      m_goals: [
        {
          $type: WAYPOINT,
          m_goalName: GOAL_A,
          m_goalType: 'GOAL_TYPE_WAYPOINT',
          m_dialogList: null,
        },
      ],
    };
    await openDialog(page, seeded);
    const goalList = list(page, `Dialog list for ${GOAL_A}`);
    await expect(goalList.getByText('This dialog list is absent or null.')).toBeVisible();
    await goalList.getByRole('button', { name: 'Add Dialog Tag', exact: true }).click();
    const doc = await copyPanelDocument(page);
    const goal = (doc.m_goals as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    expect(Object.keys(goal.m_dialogList as object)).toEqual(['$type', 'm_dialogs']);
    // The quest-level list is untouched by the goal-level write.
    expect(groupsOf(doc)).toHaveLength(2);
  });
});

/* ------------------------------------------------------------- reference fields */

test.describe('the reference and string-key fields', () => {
  test('the NPC dropdown shows the resolved name, stores the raw id, and a 0 stays a value', async ({
    page,
  }) => {
    const seeded = {
      ...quest(),
      m_dialogList: {
        $type: LIST_TYPE,
        m_dialogs: [
          makeGroup('Prep', [makeEntry({ m_actorTemplateID: 126322, m_walkAwayNpcTemplateID: 0 })]),
        ],
      },
    };
    await openDialog(page, seeded);
    const questCard = card(list(page, QUEST_LIST), 1, QUEST_ADDRESS);
    const combobox = questCard.getByRole('combobox', {
      name: 'Actor template (m_actorTemplateID)',
      exact: true,
    });
    await expect(combobox).toContainText('Zarek Pickmaster (126322)');

    // 0 means "none" in the corpus (1675 entries) and must not become an empty lookup. The
    // field lives in the Walk-Away group, i.e. the Advanced accordion.
    await reveal(questCard, 'Advanced');
    const walkAway = questCard.getByRole('combobox', {
      name: 'Walk-away NPC (m_walkAwayNpcTemplateID)',
      exact: true,
    });
    await expect(walkAway).toContainText('0');

    const entry = entryOf(await copyPanelDocument(page), 0, 0);
    expect(entry.m_actorTemplateID).toBe(126322);
    expect(entry.m_walkAwayNpcTemplateID).toBe(0);
  });

  test('an unlisted zone path stays displayed and selected, and an empty one issues no lookup', async ({
    page,
  }) => {
    const seeded = {
      ...quest(),
      m_dialogList: {
        $type: LIST_TYPE,
        m_dialogs: [
          makeGroup('Prep', [
            makeEntry({ m_cameraZoneName: 'WizardCity/Interiors/WC_Headmistress_House' }),
          ]),
          makeGroup('Completion', [makeEntry({ m_cameraZoneName: '' })]),
        ],
      },
    };
    const { recorded } = await openDialog(page, seeded);
    const questList = list(page, QUEST_LIST);
    // `m_cameraZoneName` lives in the Camera group, so its accordion has to be opened first.
    await reveal(card(questList, 1, QUEST_ADDRESS), 'Camera');
    await reveal(card(questList, 1, EMPTY_TAG_ADDRESS), 'Camera');
    const live = card(questList, 1, QUEST_ADDRESS).getByRole('combobox', {
      name: 'Camera zone (m_cameraZoneName)',
      exact: true,
    });
    // A miss shows the path itself; the fixture's zone list holds only two paths.
    await expect(live).toContainText('WizardCity/Interiors/WC_Headmistress_House');
    await expect(live).not.toContainText('Select zones');

    // An empty reference renders the placeholder and issues no request at all.
    await expect(
      card(questList, 1, EMPTY_TAG_ADDRESS).getByRole('combobox', {
        name: 'Camera zone (m_cameraZoneName)',
        exact: true,
      }),
    ).toContainText('Select zones');
    // The **miss** issues exactly one id lookup (which 404s and leaves the path displayed);
    // the empty reference issues none — that is the D59(c)/D59(d) hazard the recorder proves.
    expect(recorded.lookups.zones).toEqual(['WizardCity/Interiors/WC_Headmistress_House']);

    const doc = await copyPanelDocument(page);
    expect(entryOf(doc, 0, 0).m_cameraZoneName).toBe('WizardCity/Interiors/WC_Headmistress_House');
    expect(entryOf(doc, 1, 0).m_cameraZoneName).toBe('');
  });

  test('a string-table key shows its resolved text, and an empty key issues no lookup', async ({
    page,
  }) => {
    const seeded = {
      ...quest(),
      m_dialogList: {
        $type: LIST_TYPE,
        m_dialogs: [
          makeGroup('Prep', [makeEntry({ m_dialog: 'WizQst1ED8D_00000005', m_nameSTKey: '' })]),
        ],
      },
    };
    const { recorded } = await openDialog(page, seeded);
    const questCard = card(list(page, QUEST_LIST), 1, QUEST_ADDRESS);
    await expect(questCard.getByText(/Oh! My pardon!/)).toBeVisible();
    // The empty m_nameSTKey produces no request (and therefore never the 24 MB list route).
    expect(recorded.lookups.strings).toContain('WizQst1ED8D_00000005');
    expect(recorded.lookups.strings).not.toContain('');

    // Clearing the key deletes it rather than writing '' (D59c).
    await questCard.getByLabel('Dialog text (m_dialog)', { exact: true }).fill('');
    const entry = entryOf(await copyPanelDocument(page), 0, 0);
    expect(Object.prototype.hasOwnProperty.call(entry, 'm_dialog')).toBe(false);
    expect(Object.keys(entry)).toHaveLength(65);
  });

  test('the numeric m_cameraHidePlayers select keeps an unlisted value selected', async ({
    page,
  }) => {
    const seeded = {
      ...quest(),
      m_dialogList: {
        $type: LIST_TYPE,
        m_dialogs: [makeGroup('Prep', [makeEntry({ m_cameraHidePlayers: 7 })])],
      },
    };
    await openDialog(page, seeded);
    const questCard = card(list(page, QUEST_LIST), 1, QUEST_ADDRESS);
    await reveal(questCard, 'Camera');
    const select = questCard.getByRole('combobox', {
      name: 'Hide players (m_cameraHidePlayers)',
      exact: true,
    });
    // The measured domain is 0/1/2/3; 7 is not in it, so it is appended and stays selected.
    await expect(select).toHaveValue('7');
    await expect(select.locator('option[value="7"]')).toHaveText('7 (unlisted)');

    await select.selectOption('3');
    const entry = entryOf(await copyPanelDocument(page), 0, 0);
    expect(entry.m_cameraHidePlayers).toBe(3);
  });

  test('the string lists round-trip one encoded element per line', async ({ page }) => {
    const seeded = {
      ...quest(),
      m_dialogList: {
        $type: LIST_TYPE,
        m_dialogs: [
          makeGroup('Prep', [
            makeEntry({
              m_dialogAnimationList: ['0|126322|Gen_Dial_01|5', '0|126312|Gen_Dial_02|3'],
              m_npcStandInList: [],
            }),
          ]),
        ],
      },
    };
    await openDialog(page, seeded);
    const questCard = card(list(page, QUEST_LIST), 1, QUEST_ADDRESS);
    await reveal(questCard, 'Animation');
    const animations = questCard.getByLabel('Dialog animations (m_dialogAnimationList)', {
      exact: true,
    });
    await expect(animations).toHaveValue('0|126322|Gen_Dial_01|5\n0|126312|Gen_Dial_02|3');

    // A no-op re-set writes the same elements back, in the same order, byte for byte.
    await animations.fill('0|126322|Gen_Dial_01|5\n0|126312|Gen_Dial_02|3');
    const entry = entryOf(await copyPanelDocument(page), 0, 0);
    expect(entry.m_dialogAnimationList).toEqual([
      '0|126322|Gen_Dial_01|5',
      '0|126312|Gen_Dial_02|3',
    ]);
    expect(entry.m_npcStandInList).toEqual([]);
  });
});

/* ------------------------------------------------------------- the requirement slot */

test.describe('the m_requirements slot', () => {
  test('mounts the shared tree and is labelled fixture-only', async ({ page }) => {
    await openDialog(page);
    const questCard = card(list(page, QUEST_LIST), 1, QUEST_ADDRESS);
    const tree = questCard.getByRole('region', {
      name: 'Requirements for Dialog list › Dialog blocks 1 › Dialog entries 1',
      exact: true,
    });
    await expect(tree).toBeVisible();
    await expect(
      questCard.getByText(/null on all 1882 corpus entries that carry the key/),
    ).toBeVisible();

    // The first Add writes the shared tree's own wrapper — the corpus never carries one, so
    // this is the fixture-only path and it must not disturb the entry around it.
    await tree
      .locator(
        `button[data-path="${QUEST_ADDRESS}.m_requirements"][aria-label^="Add Condition to "]`,
      )
      .click();
    const entry = entryOf(await copyPanelDocument(page), 0, 0);
    expect(Object.keys(entry)).toEqual(ENTRY_ORDER);
    const wrapper = entry.m_requirements as Record<string, unknown>;
    expect(Object.keys(wrapper)).toEqual(['$type', 'm_applyNOT', 'm_operator', 'm_requirements']);
  });
});
