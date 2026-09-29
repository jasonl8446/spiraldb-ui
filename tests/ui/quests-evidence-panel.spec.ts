import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockQuestsApi, MOCK_EVIDENCE, type QuestsMockRecorded } from './quests-mocks';

/**
 * Tier-1 evidence-panel spec (plan task 6.7 / story p6-08; decision D23 tier 1 / D40).
 *
 * Drives the real `/quests/:questName` page in headless chromium with every route mocked, and
 * covers what a hermetic browser run can prove about the panel:
 *
 * - **one right rail, two tabs** (spec L417-421): `?panel=evidence` and the header's evidence
 *   affordance both open the *same* `<aside>` the JSON panel owns, on the Evidence tab — in **edit
 *   and view mode alike**;
 * - **grouped by field, split used/available** (L437-441): the used row appears under the field it
 *   already fills, the available rows under the available heading;
 * - **one-click insert per row, into the field it belongs to** (L442-444): an available row inserts
 *   the focused goal's `m_goalText`, focusing the goal's `m_locationName` retargets the insert, and
 *   a dialogue row inserts the focused dialog entry's `m_dialog` — each asserted against the
 *   **whole live document** read back through the JSON panel's own `[Copy]`, with a one-path delta;
 * - **nothing inserts automatically / the panel never writes**: no insert action exists until a
 *   field is focused, a refusal is stated in words rather than silently ignored, and the mocked API
 *   records **no** `POST /api/quests` for any of it (the unit suite proves the same at the source
 *   level, `tests/unit/evidence-panel.test.ts`);
 * - **the inferred badge** (L448-450): visible for `title_source: 'inferred'`, absent for `direct`.
 *
 * What is deliberately **not** here: the file write, the `git diff` and the pipeline. The tier-1
 * harness is hermetic (D40 — a route-mocked browser and a throwaway database), so "the saved file
 * shows only that field" is proven by `tests/unit/quest-evidence-insert-isolation.test.ts` against
 * the D17 clone, with the raw `git diff`; this spec proves the payload and the interaction.
 */

const PERSONA = 'Imcodec.ObjectProperty.TypeCache.PersonaGoalTemplate, Imcodec.ObjectProperty';
const WAYPOINT = 'Imcodec.ObjectProperty.TypeCache.WaypointGoalTemplate, Imcodec.ObjectProperty';

const QUEST_NAME = 'DS-ACAD1-C01-001';

/** The available row the insert tests use, and its body — the key is what must land. */
const AVAILABLE_KEY = 'WizQst1A2B_00000004';
const AVAILABLE_TEXT = 'Fixture line available to this file.';
/** The dialogue row's key: the sibling-table line `MOCK_EVIDENCE.dialogue[0]` names. */
const DIALOGUE_KEY = 'WizQst1A2B_00000000';
/** The focused dialog entry's key before the insert — deliberately not the dialogue row's. */
const ENTRY_BEFORE = 'WizQst1A2B_00000001';

/**
 * The quest: two goals, the first holding a `m_locationName` and a goal-level dialog entry whose
 * `m_dialog` differs from the evidence dialogue row's key (so the insert's effect is visible), plus
 * a quest-level dialog list for the second card.
 */
const QUEST: Record<string, unknown> = {
  m_questName: QUEST_NAME,
  m_questTitle: 'QuestTitle_1ED8D',
  m_questLevel: 7,
  m_startGoals: ['1_Start'],
  m_goals: [
    {
      $type: PERSONA,
      m_goalName: '1_Start',
      m_goalNameID: 111,
      m_locationName: 'ZoneLocName_9140',
      m_dialogList: {
        m_dialogs: [
          {
            m_dialogTag: 'Prep',
            m_dialogEntries: [{ m_dialog: ENTRY_BEFORE }],
          },
        ],
      },
    },
    {
      $type: WAYPOINT,
      m_goalName: '2_Mid',
      m_goalNameID: 222,
      m_destinationZone: 'DragonSpire/DS_A3_Kings',
    },
  ],
  m_dialogList: {
    m_dialogs: [{ m_dialogTag: 'Prep', m_dialogEntries: [{ m_dialog: 'WizQst1A2B_00000002' }] }],
  },
};

/* ------------------------------------------------------------------ locators */

function main_(page: Page): Locator {
  return page.getByRole('main');
}

/** The one rail (the JSON panel's `<aside>`), named by whichever tab is active. */
function rail(page: Page, name: 'Quest evidence' | 'Quest JSON'): Locator {
  return page.getByRole('complementary', { name });
}

/** The evidence body's target line: the field the next insert will write. */
function targetLine(page: Page): Locator {
  return rail(page, 'Quest evidence').getByTestId('evidence-target');
}

/** The section the row lives in, so a key lookup cannot escape into another section. */
function section(page: Page, heading: string): Locator {
  return rail(page, 'Quest evidence').getByRole('region', { name: heading });
}

function insertButton(page: Page, key: string): Locator {
  return rail(page, 'Quest evidence').getByRole('button', { name: `Insert ${key}` });
}

/**
 * The insert button for `key` **inside `heading`'s section**. Scoped because one key can legitimately
 * appear twice — a `WizQst…` row can be both a used text row and the file's own dialogue line — and
 * an unscoped locator would then be ambiguous rather than wrong.
 */
function sectionInsertButton(page: Page, heading: string, key: string): Locator {
  return section(page, heading).getByRole('button', { name: `Insert ${key}` });
}

/** The goals editor's section and the card at `index`. */
function goalsEditor(page: Page): Locator {
  return main_(page).getByRole('region', { name: 'Quest goals editor' });
}

function goalCard(page: Page, index: number): Locator {
  return goalsEditor(page).getByRole('article').nth(index);
}

/** The goal-level dialog section, then the entry card inside it. */
function goalDialogSection(page: Page): Locator {
  return main_(page).getByRole('region', { name: 'Goal dialog lists' });
}

/** The focused entry's own `m_dialog` input (the field the dialogue insert writes). */
function goalDialogInput(page: Page, goalIndex: number): Locator {
  return goalDialogSection(page)
    .getByRole('article')
    .nth(goalIndex)
    .getByLabel('m_dialog', { exact: true });
}

/** The two rail tabs. */
function tab(page: Page, name: 'Evidence' | 'JSON'): Locator {
  return page.getByRole('tab', { name });
}

/* -------------------------------------------------------------- the document half */

/** Opens the fixture quest with every route mocked. */
async function openQuest(
  page: Page,
  options: { search?: string; evidence?: unknown } = {},
): Promise<QuestsMockRecorded> {
  const recorded = await mockQuestsApi(page, {
    detail: QUEST,
    evidence: options.evidence ?? MOCK_EVIDENCE,
    names: { QuestTitle_1ED8D: 'Quest for Perfection' },
  });
  await page.goto(`/quests/${QUEST_NAME}${options.search ?? ''}`);
  return recorded;
}

/** One scalar path → value, for the "exactly one path moved" comparison. */
function leaves(value: unknown, path = ''): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (Array.isArray(value)) {
    out.set(`${path}[]`, value.length);
    value.forEach((element, index) => {
      for (const [key, leaf] of leaves(element, `${path}[${index}]`)) {
        out.set(key, leaf);
      }
    });
    return out;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      for (const [childKey, leaf] of leaves(child, path === '' ? key : `${path}.${key}`)) {
        out.set(childKey, leaf);
      }
    }
    return out;
  }
  out.set(path, value);
  return out;
}

/** The paths whose value differs between two documents, with both values. */
function changedPaths(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Array<{ path: string; before: unknown; after: unknown }> {
  const a = leaves(before);
  const b = leaves(after);
  const paths = new Set([...a.keys(), ...b.keys()]);
  const changed: Array<{ path: string; before: unknown; after: unknown }> = [];
  for (const path of paths) {
    if (a.get(path) !== b.get(path)) {
      changed.push({ path, before: a.get(path), after: b.get(path) });
    }
  }
  return changed.sort((left, right) => (left.path < right.path ? -1 : 1));
}

/**
 * The live document, read through the JSON panel's own `[Copy]` (the same instrument
 * `quests-goals-editor.spec.ts` uses). The clipboard is wiped first, so the assertion can only be
 * about this document and not about a predecessor's leftover.
 */
async function copyDocument(page: Page): Promise<Record<string, unknown>> {
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await rail(page, 'Quest JSON').getByRole('button', { name: 'Copy' }).click();
  let text = '';
  await expect
    .poll(async () => {
      text = await page.evaluate(() => navigator.clipboard.readText());
      return text.trim().startsWith('{');
    })
    .toBe(true);
  return JSON.parse(text) as Record<string, unknown>;
}

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
});

/* ------------------------------------------------------------------- the rail */

test.describe('one right rail, two tabs', () => {
  test('the evidence affordance and ?panel=evidence open the same rail on the Evidence tab', async ({
    page,
  }) => {
    await openQuest(page);
    // Closed at first: neither rail and neither tab strip exists.
    await expect(rail(page, 'Quest evidence')).toHaveCount(0);
    await expect(rail(page, 'Quest JSON')).toHaveCount(0);
    await expect(tab(page, 'Evidence')).toHaveCount(0);

    await page.getByRole('button', { name: 'Toggle evidence panel' }).click();
    const evidence = rail(page, 'Quest evidence');
    await expect(evidence).toBeVisible();
    await expect(evidence.getByRole('tab', { name: 'Evidence' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(evidence.getByRole('tab', { name: 'JSON' })).toHaveAttribute(
      'aria-selected',
      'false',
    );

    // The same `<aside>`: switching to JSON renames it and swaps the body, it does not add a panel.
    await evidence.getByRole('tab', { name: 'JSON' }).click();
    await expect(rail(page, 'Quest JSON')).toBeVisible();
    await expect(rail(page, 'Quest evidence')).toHaveCount(0);
    // …and the APG tablist keys move between them (plan task 5.5 AC#8's model).
    await page.keyboard.press('ArrowLeft');
    await expect(rail(page, 'Quest evidence')).toBeVisible();

    // The `{ }` toggle moves the same rail to the JSON tab — a positive partner for the count-0
    // arms, so "the evidence rail is gone" cannot pass on an unmounted rail (D77(b)).
    await page.getByRole('button', { name: 'Toggle JSON panel' }).click();
    await expect(rail(page, 'Quest evidence')).toHaveCount(0);
    await expect(rail(page, 'Quest JSON')).toBeVisible();
    // Pressing it again (already on JSON) closes the rail, and its `aria-pressed` says so.
    await page.getByRole('button', { name: 'Toggle JSON panel' }).click();
    await expect(rail(page, 'Quest JSON')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Toggle JSON panel' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('?panel=evidence opens it straight away — the catalog entry’s link', async ({ page }) => {
    const recorded = await openQuest(page, { search: '?panel=evidence' });
    await expect(rail(page, 'Quest evidence')).toBeVisible();
    // The panel fetched its own surface from task 6.6's endpoint, for this quest.
    await expect.poll(() => recorded.evidenceUrls.length).toBeGreaterThan(0);
    expect(recorded.evidenceUrls[0]).toBe(`/api/quests/${QUEST_NAME}/evidence`);
  });

  test('the evidence read stays lazy: no rail, no evidence request', async ({ page }) => {
    const recorded = await openQuest(page);
    await expect(rail(page, 'Quest evidence')).toHaveCount(0);
    // The page has settled (its editors are on screen) and the panel's route was never hit. The
    // preview opens on Info, so that is the settled marker here.
    await expect(main_(page).getByRole('tab', { name: 'Info' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(recorded.evidenceRequests).toBe(0);
    await expect(main_(page).getByText('Title inferred')).toHaveCount(0);
  });
});

/* --------------------------------------------------------------- the panel body */

test.describe('the panel body', () => {
  test('splits the quest’s own rows used/available and groups the used ones by field', async ({
    page,
  }) => {
    await openQuest(page, { search: '?panel=evidence' });

    const used = section(page, 'Used by this file');
    await expect(used).toContainText(MOCK_EVIDENCE.text_rows[0]?.key ?? '');
    // Grouped by field: the used row is attributed to the field it already fills.
    await expect(used).toContainText('m_questTitle');

    const available = section(page, 'Available');
    await expect(available).toContainText(AVAILABLE_KEY);
    await expect(available).toContainText('WizQst1A2B_00000005');
    await expect(available).not.toContainText(MOCK_EVIDENCE.text_rows[0]?.key ?? '');

    // Every section the spec's ASCII draws, plus 6.6's two extra surfaces.
    await expect(section(page, 'Dialogue')).toContainText('Cyrus Drake');
    await expect(section(page, 'World gates')).toContainText('WC-UNICORN-MAIN-004_Complete');
    await expect(section(page, 'References')).toContainText('DragonSpire/DS_A3_Kings');
    await expect(section(page, 'Warnings')).toContainText('No evidence miss');
  });

  test('marks an inferred title and not a direct one', async ({ page }) => {
    await openQuest(page, { search: '?panel=evidence' });
    await expect(rail(page, 'Quest evidence').getByText('Title inferred')).toBeVisible();
    // An inferred link never travels alone: its basis is on screen beside the badge.
    await expect(rail(page, 'Quest evidence')).toContainText(MOCK_EVIDENCE.quest.inference_basis);

    await page.getByRole('button', { name: 'Toggle evidence panel' }).click();
    await openQuest(page, {
      search: '?panel=evidence',
      evidence: {
        ...MOCK_EVIDENCE,
        quest: {
          ...MOCK_EVIDENCE.quest,
          link_kind: 'direct',
          title_source: 'direct',
          inference_basis: null,
        },
      },
    });
    await expect(rail(page, 'Quest evidence')).toBeVisible();
    await expect(rail(page, 'Quest evidence').getByText('Title inferred')).toHaveCount(0);
  });

  test('offers no insert action until a field is focused, and says why', async ({ page }) => {
    await openQuest(page, { search: '?panel=evidence' });
    await expect(targetLine(page)).toContainText('nothing focused');
    await expect(insertButton(page, AVAILABLE_KEY)).toHaveCount(0);
    // The reason, in words — never a silent no-op.
    await expect(section(page, 'Available')).toContainText(
      'Nothing is focused — click into a goal, a goal’s location name, or a dialog entry, then insert.',
    );
  });
});

/* ------------------------------------------------------------------- the inserts */

test.describe('one-click insert, into the field it belongs to', () => {
  test('an available row inserts into the focused goal and moves nothing else', async ({
    page,
  }) => {
    const recorded = await openQuest(page, { search: '?panel=evidence' });
    // The baseline document first (via the JSON tab), then back to Evidence: the focus report is
    // page state, so the round trip is safe — and it is asserted below rather than assumed.
    await page.getByRole('tab', { name: 'JSON' }).click();
    const before = await copyDocument(page);

    // Focus a goal card: the plan's "goal text into the focused goal". Clicking the card's own
    // control is the focus the editor reports (the card captures it).
    await page.getByRole('tab', { name: 'Evidence' }).click();
    await page.getByRole('tab', { name: 'Goals' }).click();
    await goalCard(page, 0).getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('tab', { name: 'Evidence' }).click();
    await expect(targetLine(page)).toContainText('m_goals[0].m_goalText');

    const insert = sectionInsertButton(page, 'Available', AVAILABLE_KEY);
    await expect(insert).toBeVisible();
    await insert.click();

    // The confirmation says exactly what did *not* happen: nothing is written until Save.
    await expect(
      page.getByText('Inserted into the focused field — Save to write it to the file.'),
    ).toBeVisible();
    // The document is dirty now, and no save was issued by the panel.
    await expect(main_(page).locator('[data-dirty]')).toHaveAttribute('data-dirty', 'true');
    expect(recorded.savePosts).toHaveLength(0);
    expect(recorded.urls.filter((url) => url.endsWith('/api/quests'))).toHaveLength(1);

    // The whole document, read back through the JSON panel: one path added, its value the KEY.
    await page.getByRole('tab', { name: 'JSON' }).click();
    const after = await copyDocument(page);
    expect(changedPaths(before, after)).toEqual([
      { path: 'm_goals[0].m_goalText', before: undefined, after: AVAILABLE_KEY },
    ]);
    // The row's TEXT is nowhere in the document: the file stores string-table keys.
    expect(JSON.stringify(after)).not.toContain(AVAILABLE_TEXT);
  });

  test('focusing a goal’s location name retargets the insert to m_locationName', async ({
    page,
  }) => {
    await openQuest(page, { search: '?panel=evidence' });
    await page.getByRole('tab', { name: 'Goals' }).click();
    await goalCard(page, 0).getByRole('button', { name: 'Edit' }).click();
    // The shared base fields are a collapsed disclosure; opening it reveals m_locationName.
    await goalCard(page, 0).getByText('Shared base fields').click();
    await goalCard(page, 0).getByLabel('m_locationName', { exact: true }).click();

    // Read the document first: the rail's JSON tab swaps the *body* only, so the focus report
    // survives the round trip — asserted, not assumed.
    await page.getByRole('tab', { name: 'JSON' }).click();
    const before = await copyDocument(page);
    await page.getByRole('tab', { name: 'Evidence' }).click();
    await expect(targetLine(page)).toContainText('m_goals[0].m_locationName');

    await sectionInsertButton(page, 'Available', AVAILABLE_KEY).click();

    await page.getByRole('tab', { name: 'JSON' }).click();
    const after = await copyDocument(page);
    expect(changedPaths(before, after)).toEqual([
      { path: 'm_goals[0].m_locationName', before: 'ZoneLocName_9140', after: AVAILABLE_KEY },
    ]);
  });

  test('a dialogue row inserts the focused dialog entry’s m_dialog', async ({ page }) => {
    const recorded = await openQuest(page, { search: '?panel=evidence' });
    await page.getByRole('tab', { name: 'Dialog' }).click();
    // Focus the goal-level entry card: reading its m_dialog input is also the assertion target.
    await goalDialogInput(page, 0).click();
    await page.getByRole('tab', { name: 'Evidence' }).click();
    await expect(targetLine(page)).toContainText(
      'm_goals[0].m_dialogList.m_dialogs[0].m_dialogEntries[0].m_dialog',
    );

    await expect(section(page, 'Dialogue')).toContainText('Cyrus Drake');
    // The same key is also this file's *used* text row, so the click is scoped to the Dialogue
    // section: one row, one button, no ambiguity.
    await sectionInsertButton(page, 'Dialogue', DIALOGUE_KEY).click();

    await page.getByRole('tab', { name: 'Dialog' }).click();
    await expect(goalDialogInput(page, 0)).toHaveValue(DIALOGUE_KEY);
    expect(recorded.savePosts).toHaveLength(0);
  });

  test('a dialogue row is refused while a goal field is focused, with the reason on screen', async ({
    page,
  }) => {
    await openQuest(page, { search: '?panel=evidence' });
    await page.getByRole('tab', { name: 'Goals' }).click();
    await goalCard(page, 0).getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('tab', { name: 'Evidence' }).click();
    await expect(targetLine(page)).toContainText('m_goals[0].m_goalText');

    // The dialogue section carries no button at all in this state…
    const dialogue = section(page, 'Dialogue');
    await expect(dialogue.getByRole('button', { name: /^Insert / })).toHaveCount(0);
    // …and says why, per row.
    await expect(dialogue).toContainText(
      'A dialogue line can only fill a dialog entry’s m_dialog; the focused field is a goal field.',
    );
    // The same row is accepted the moment the focused field is a dialog entry.
    await page.getByRole('tab', { name: 'Dialog' }).click();
    await goalDialogInput(page, 0).click();
    await page.getByRole('tab', { name: 'Evidence' }).click();
    await expect(sectionInsertButton(page, 'Dialogue', DIALOGUE_KEY)).toBeVisible();
  });
});

/* ------------------------------------------------------------------ view mode */

test.describe('view mode', () => {
  test('the panel is still there, with no insert actions and the reason stated', async ({
    page,
  }) => {
    const recorded = await openQuest(page, { search: '?panel=evidence' });
    await main_(page).getByRole('button', { name: 'Edit' }).click();
    await expect(main_(page).locator('[data-edit-mode]')).toHaveAttribute(
      'data-edit-mode',
      'false',
    );

    const evidence = rail(page, 'Quest evidence');
    await expect(evidence).toBeVisible();
    // The evidence surface is the same in both modes: the rows are all there…
    await expect(section(page, 'Available')).toContainText(AVAILABLE_KEY);
    // …and there is nothing to insert into, because view mode has no editable document.
    await expect(evidence.getByRole('button', { name: /^Insert / })).toHaveCount(0);
    await expect(evidence).toContainText(
      'View mode shows a read-only document — switch to Edit to insert.',
    );
    await expect(targetLine(page)).toContainText('nothing focused');
    expect(recorded.savePosts).toHaveLength(0);

    // Back in edit mode the actions return once a field is focused.
    await main_(page).getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('tab', { name: 'Goals' }).click();
    await goalCard(page, 0).getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('tab', { name: 'Evidence' }).click();
    await expect(insertButton(page, AVAILABLE_KEY)).toBeVisible();
  });
});
