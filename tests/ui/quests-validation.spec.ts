import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockQuestsApi, type QuestsMockRecorded } from './quests-mocks';

/**
 * Tier-1 validation-engine spec (plan task 3.9 / story p3-09, decision D23 tier 1 / D40).
 *
 * Drives the real `/quests/:questName` page in headless chromium with every route mocked, so
 * nothing reaches the dev stack's database. It is the **presentation** half of the story's
 * acceptance criterion:
 *
 * - a `m_startGoals` entry that references a deleted goal → an inline red-bordered error on the
 *   `m_startGoals` surface, the form-level **banner** (`role="alert"`) naming "Unknown start
 *   goal", and a **Save** whose disabled state follows the blocking findings;
 * - an unknown reference (the corpus-real case is an unlisted zone path) → a **warning icon**,
 *   an inline amber message, and Save **still enabled** — the clause that makes a warning a
 *   warning;
 * - a clean quest → no banner at all, no inline messages, Save enabled;
 * - the findings that have **zero corpus instances** (this story's honesty requirement) are
 *   driven by the shipped edit builders: deleting a goal through its own Delete button is
 *   `deleteGoalEdit`, and a duplicate `m_goalName` is typed into the control the Goals tab
 *   renders. They are labelled fixture-only here because no corpus quest violates them.
 *
 * The names tables are mocked with one row each (`mockQuestsApi` owns the strings/quests/status
 * surface) so the reference rules have something to resolve against; the table rows are written
 * out rather than imported from the app, because a spec that imported the copy it asserts could
 * only prove the app agrees with itself.
 */

/* ------------------------------------------------------------------ fixtures */

const WAYPOINT = 'Imcodec.ObjectProperty.TypeCache.WaypointGoalTemplate, Imcodec.ObjectProperty';
const PERSONA = 'Imcodec.ObjectProperty.TypeCache.PersonaGoalTemplate, Imcodec.ObjectProperty';
const DRAW_HAND = 'Imcodec.ObjectProperty.TypeCache.ResDrawHand, Imcodec.ObjectProperty';

/** The zone path the mocked `zones` table carries. */
const LISTED_ZONE = 'WizardCity/WC_Hub';
/** The zone path no `zones` row carries — the corpus's own 94 real misses (D60(c)). */
const UNLISTED_ZONE = 'DragonSpire/DS_A3_Kings/Interiors/DS_School_Fire';
/** The spell id the mocked `spells` row carries; 987654321 resolves nowhere. */
const LISTED_SPELL = 126321;

const ZONES = [{ zone_path: LISTED_ZONE, display_name: 'Wizard City / Hub', world: 'WizardCity' }];
const SPELLS = [{ template_id: LISTED_SPELL, name: 'Draw a Spell' }];
const NPCS = [{ template_id: 126321, name: 'Hub Guard' }];
const DROP_TABLES = [{ name: 'WC-UNICORN-MAIN-007', description: null }];
const QUEST_ROWS = [{ quest_name: 'DS-VALID-C01-001', title: 'Validation fixture' }];

/** A goal with the fields the rules read. */
function goal(name: string, type: string, extra: Record<string, unknown> = {}): unknown {
  return { $type: type, m_goalName: name, m_goalType: 'GOAL_TYPE_WAYPOINT', ...extra };
}

/**
 * A quest that violates **nothing** when the mocked tables are in play: three goals, one start
 * goal, a two-entry chain whose last entry completes the quest, and a result whose id resolves.
 */
const VALID_QUEST: Record<string, unknown> = {
  m_questName: 'DS-VALID-C01-001',
  m_questTitle: 'QuestTitle_1ED8D',
  m_goals: [
    goal('1_Start', WAYPOINT, { m_destinationZone: LISTED_ZONE }),
    goal('2_Mid', PERSONA),
    goal('3_End', WAYPOINT, { m_destinationZone: LISTED_ZONE }),
  ],
  m_startGoals: ['1_Start'],
  m_goalLogic: [
    {
      m_goalsAND: ['1_Start'],
      m_goalsOR: [],
      m_goalsToAdd: ['2_Mid'],
      m_completeQuest: false,
      m_requiredORCount: 1,
    },
    {
      m_goalsAND: ['2_Mid'],
      m_goalsOR: [],
      m_goalsToAdd: ['3_End'],
      m_completeQuest: true,
      m_requiredORCount: 1,
    },
  ],
  m_endResults: { m_results: [{ $type: DRAW_HAND, m_templateID: LISTED_SPELL }] },
};

/** The same quest with one unlisted zone path and one unknown result id — warnings only. */
const WARNING_QUEST: Record<string, unknown> = {
  ...VALID_QUEST,
  m_goals: [
    goal('1_Start', WAYPOINT, { m_destinationZone: UNLISTED_ZONE }),
    goal('2_Mid', PERSONA),
    goal('3_End', WAYPOINT, { m_destinationZone: UNLISTED_ZONE }),
  ],
  m_endResults: { m_results: [{ $type: DRAW_HAND, m_templateID: 987654321 }] },
};

/* ------------------------------------------------------------------ helpers */

/** The form-level banner of a page that has blocking findings. */
function blockingBanner(page: Page): Locator {
  return page.getByRole('alert', { name: 'Quest validation' });
}

/** The form-level banner of a page that has warnings only. */
function warningBanner(page: Page): Locator {
  return page.getByRole('status', { name: 'Quest validation' });
}

/** The Save affordance whose disabled state follows validation. */
function saveButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Save', exact: true });
}

/** Opens the detail page with the whole names/quests surface mocked. */
async function openQuest(
  page: Page,
  detail: Record<string, unknown> = VALID_QUEST,
): Promise<QuestsMockRecorded> {
  const recorded = await mockQuestsApi(page, {
    detail,
    names: { QuestTitle_1ED8D: 'Quest for Perfection' },
  });

  // The five bulk lists the validation engine injects (the same cached `GET /api/names/:type`
  // reads `FriendlyNameDropdown` uses). Registered after `mockQuestsApi`, so these win.
  await page.route('**/api/names/zones', (route) => route.fulfill({ json: { zones: ZONES } }));
  await page.route('**/api/names/spells', (route) => route.fulfill({ json: { spells: SPELLS } }));
  await page.route('**/api/names/npcs', (route) => route.fulfill({ json: { npcs: NPCS } }));
  await page.route('**/api/names/drop_tables', (route) =>
    route.fulfill({ json: { drop_tables: DROP_TABLES } }),
  );
  await page.route('**/api/names/quests', (route) =>
    route.fulfill({ json: { quests: QUEST_ROWS } }),
  );
  // A single-id lookup for a value that is not in the cached list is the documented miss
  // (spec-domain-reference L693-695) — never a request that reaches the dev stack.
  for (const type of ['zones', 'spells', 'npcs', 'drop_tables', 'quests']) {
    await page.route(`**/api/names/${type}/*`, (route) =>
      route.fulfill({ status: 404, json: { error: `Unknown ${type} id` } }),
    );
  }

  await page.goto('/quests/DS-VALID-C01-001');
  return recorded;
}

/** Opens the Goals tab and returns its region. */
async function openGoals(page: Page): Promise<Locator> {
  await page.getByRole('tab', { name: 'Goals' }).click();
  const region = page.getByRole('region', { name: 'Quest goals editor' });
  await expect(region).toBeVisible();
  return region;
}

/** The goal card whose text contains `name`. */
function cardNamed(region: Locator, name: string): Locator {
  return region.getByRole('article').filter({ hasText: name });
}

/** The inline message list of a field, by the field's rendered document path. */
function fieldMessages(page: Page, field: string): Locator {
  return page.locator(`li[data-field="${field}"]`);
}

/**
 * Opens one goal card's editor. The field controls exist only while a card is expanded
 * (`GoalEditPanel` is conditional), and `m_destinationZone`/`m_goalName` live in the card's
 * collapsed **Shared base fields** disclosure — so both steps are the user's own path to the
 * control whose inline message this spec asserts.
 */
async function expandCard(card: Locator): Promise<void> {
  await card.getByRole('button', { name: 'Edit' }).click();
  await card.getByText('Shared base fields').click();
}

/* -------------------------------------------------------------------- tests */

test.describe('a quest with no validation findings', () => {
  test('renders no banner, no inline message and an enabled Save', async ({ page }) => {
    await openQuest(page);

    await expect(page.getByRole('alert', { name: 'Quest validation' })).toHaveCount(0);
    await expect(page.getByRole('status', { name: 'Quest validation' })).toHaveCount(0);
    await expect(page.getByRole('list', { name: 'Validation messages' })).toHaveCount(0);

    const save = saveButton(page);
    await expect(save).toBeVisible();
    await expect(save).toHaveAttribute('aria-disabled', 'false');
    await expect(save).toHaveAttribute('data-blocked', 'false');
  });
});

test.describe('AC1 — a dangling m_startGoals reference blocks the save', () => {
  test('deleting a referenced start goal shows an inline error, the banner and a disabled Save', async ({
    page,
  }) => {
    await openQuest(page);
    const region = await openGoals(page);

    // A clean page to begin with: no blocking surface at all.
    await expect(blockingBanner(page)).toHaveCount(0);
    await expect(saveButton(page)).toHaveAttribute('data-blocked', 'false');

    // The AC's own flow: the Goals tab deletes the goal `m_startGoals` still names.
    await cardNamed(region, '1_Start').getByRole('button', { name: 'Delete 1_Start' }).click();

    // 1. The inline error, on the `m_startGoals` surface, with a red border (L547).
    const inline = page.getByTestId('start-goals-validation');
    await expect(inline).toBeVisible();
    await expect(inline).toContainText('m_startGoals');
    await expect(inline).toContainText('The start goal "1_Start" is not defined in m_goals.');
    await expect(fieldMessages(page, 'm_startGoals[0]')).toHaveCount(1);
    await expect(fieldMessages(page, 'm_startGoals[0]')).toHaveAttribute('data-severity', 'error');
    // The border is asserted **computed**, not by class name: a red-500 border at 60% alpha.
    const borderColor = await inline.evaluate((node) => getComputedStyle(node).borderTopColor);
    expect(borderColor).toMatch(/rgba?\(239, 68, 68/);

    // 2. The form-level banner, naming the kind and blocking the save.
    const banner = blockingBanner(page);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('validation error');
    await expect(banner).toContainText('Unknown start goal');

    // 3. Save is disabled, and it points at the banner that explains why.
    const save = saveButton(page);
    await expect(save).toHaveAttribute('aria-disabled', 'true');
    await expect(save).toHaveAttribute('data-blocked', 'true');
    await expect(save).toHaveAttribute('aria-describedby', 'quest-validation-banner');

    // An error is not a warning: the error's own line carries no warning icon (the banner may
    // still carry a warning headline, because deleting the start goal also strands downstream
    // goals — a truthful second finding, not a UI accident).
    await expect(
      fieldMessages(page, 'm_startGoals[0]').getByTestId('validation-warning-icon'),
    ).toHaveCount(0);
  });

  test('the same fault typed into a goal name surfaces inline on that field', async ({ page }) => {
    await openQuest(page);
    const region = await openGoals(page);

    // The other zero-corpus blocking rule that the Goals tab can produce from its own controls:
    // a duplicate `m_goalName`. Fixture-only — and re-measured at the owner's 328-quest
    // baseline, not assumed: 328 quests / 796 goals / 0 duplicate `m_goalName`.
    const secondCard = region.getByRole('article').nth(1);
    await expandCard(secondCard);
    // `exact` on purpose: `getByLabel('m_goalName')` is a substring match and also resolves
    // the neighbouring `m_goalNameID` control.
    const nameInput = secondCard.getByLabel('m_goalName', { exact: true });
    await nameInput.fill('1_Start');

    const message = fieldMessages(page, 'm_goals[1].m_goalName');
    await expect(message).toHaveCount(1);
    await expect(message).toHaveAttribute('data-kind', 'duplicate-goal-name');
    await expect(message).toContainText('also used by another goal');
    await expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    await expect(blockingBanner(page)).toContainText('Duplicate goal name');
    await expect(saveButton(page)).toHaveAttribute('data-blocked', 'true');

    // Restoring a unique name clears the block again: the gate follows the document, not a
    // one-way "was ever invalid" latch.
    await nameInput.fill('2_Mid_renamed');
    await expect(fieldMessages(page, 'm_goals[1].m_goalName')).toHaveCount(0);
    await expect(blockingBanner(page)).toHaveCount(0);
    await expect(saveButton(page)).toHaveAttribute('data-blocked', 'false');
  });
});

test.describe('AC1 — an unknown reference warns and never blocks', () => {
  test('an unlisted zone path and an unknown result id warn, and Save stays enabled', async ({
    page,
  }) => {
    await openQuest(page, WARNING_QUEST);
    const region = await openGoals(page);
    // The zone field is a shared base field: it only exists once its card is expanded.
    await expandCard(region.getByRole('article').first());

    // The real corpus data for this rule: an interior zone variant the `zones` table lacks.
    const zoneMessage = fieldMessages(page, 'm_goals[0].m_destinationZone');
    await expect(zoneMessage).toHaveCount(1);
    await expect(zoneMessage).toHaveAttribute('data-severity', 'warning');
    await expect(zoneMessage).toHaveAttribute('data-kind', 'zone-not-known');
    await expect(zoneMessage).toContainText('is not in the synced zones table');

    // The warning affordance: an icon, and no `role="alert"` anywhere on the page.
    await expect(page.getByTestId('validation-warning-icon').first()).toBeVisible();
    await expect(blockingBanner(page)).toHaveCount(0);
    await expect(page.getByRole('alert', { name: 'Quest validation' })).toHaveCount(0);

    // The banner is a status, not an alert, and it says outright that it does not block.
    const banner = warningBanner(page);
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Unknown zone');
    await expect(banner).toContainText('Warnings never block saving');

    // The AC's clause: Save is **still enabled**.
    const save = saveButton(page);
    await expect(save).toHaveAttribute('aria-disabled', 'false');
    await expect(save).toHaveAttribute('data-blocked', 'false');
    await expect(save).not.toHaveAttribute('aria-describedby', 'quest-validation-banner');

    // The other warning family, on the Results tab: the ResDrawHand id is in neither table.
    await page.getByRole('tab', { name: 'Results' }).click();
    const resultMessage = fieldMessages(page, 'm_endResults.m_results[0].m_templateID');
    await expect(resultMessage).toHaveCount(1);
    await expect(resultMessage).toHaveAttribute('data-severity', 'warning');
    await expect(resultMessage).toHaveAttribute('data-kind', 'reference-not-known');
    await expect(resultMessage).toContainText('spells or npcs');
    await expect(saveButton(page)).toHaveAttribute('data-blocked', 'false');
  });
});
