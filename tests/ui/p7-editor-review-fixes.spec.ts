import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

import { mockQuestsApi, type QuestsMockRecorded } from './quests-mocks';

/**
 * PR #14 review — the quest editor's save and suggestion fixes (3, 9f, 9g; D195). Hermetic (D40):
 * every read and write is route-mocked, nothing reaches the harness server.
 *
 * | criterion | test |
 * |---|---|
 * | 3 — a double-click on Save sends exactly one POST; Save is disabled while it is in flight | `a double-click …` |
 * | 3 — a 400 for a no-longer-pending id drops that claim, so the retry is not refused again | `a failed save …` |
 * | 3 — a draft's first save refused because its file now exists offers the file's editor | `a draft whose file …` |
 * | 9f — a failed suggestions read is an error with a retry, not an empty list | `a failed suggestions read …` |
 * | 9g — Accept is disabled while the same row's Reject is in flight | `Accept waits …` |
 */

const NAME = 'DS-ACAD1-C01-001';
const WAYPOINT = 'Imcodec.ObjectProperty.TypeCache.WaypointGoalTemplate, Imcodec.ObjectProperty';

/** Violates no blocking rule, so Save is genuinely available; its title is empty to accept into. */
const CLEAN_QUEST: Record<string, unknown> = {
  m_questName: NAME,
  m_questTitle: '',
  m_questLevel: 7,
  m_goals: [
    { $type: WAYPOINT, m_goalName: '1_Start', m_goalType: 'GOAL_TYPE_WAYPOINT', m_goalNameID: 1 },
  ],
  m_startGoals: ['1_Start'],
  m_goalLogic: [
    {
      m_goalsAND: ['1_Start'],
      m_goalsOR: [],
      m_goalsToAdd: [],
      m_completeQuest: true,
      m_requiredORCount: 1,
    },
  ],
  m_endResults: { m_results: [] },
};

const TITLE_SUGGESTION = {
  id: 501,
  path: 'm_questTitle',
  value: 'QuestTitle_ABCDE',
  source: 'evidence-title',
  confidence: 1,
  evidence_ref: 'quest_ids:501',
  status: 'pending',
  created_at: null,
  decided_at: null,
};

function saveButton(page: Page): Locator {
  return page.getByRole('main').getByRole('button', { name: 'Save', exact: true });
}

function successBody(name: string): Record<string, unknown> {
  return {
    quest_name: name,
    outcome: 'updated',
    action: 'update',
    commit: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    branch: 'content/2026-09-26',
    commit_message: `spiraldb: update quest ${name}`,
    file: `QuestTemplates/questtemplates_${name}.json`,
    metadata: `QuestMetadatas/questmetadata_${name}.json`,
    metadata_outcome: 'updated',
    status: {
      object_type: 'quest',
      object_key: name,
      status: 'extracted',
      extracted_at: '2026-09-26T12:00:00.000Z',
      reviewed_at: null,
      verified_at: null,
      latest_notes: null,
    },
    warnings: [],
    accepted_suggestions: [],
  };
}

/** The quest editor on the Info tab with one pending title suggestion; `pending` is mutable. */
async function openWithSuggestion(
  page: Page,
  onSave: (route: Route) => Promise<void>,
  pending: { rows: object[] },
): Promise<QuestsMockRecorded> {
  const recorded = await mockQuestsApi(page, { detail: CLEAN_QUEST, onSave });
  for (const type of ['zones', 'npcs', 'spells', 'drop_tables', 'quests']) {
    await page.route(`**/api/names/${type}`, (route) =>
      route.fulfill({ json: { [type]: [] } satisfies Record<string, unknown[]> }),
    );
  }
  await page.route(`**/api/quests/${NAME}/suggestions*`, (route) =>
    route.fulfill({ json: { quest_name: NAME, catalog_id: null, suggestions: pending.rows } }),
  );
  await page.goto(`/quests/${NAME}`);
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Accept m_questTitle from evidence-title' })
    .click();
  await expect(page.getByTestId('suggestion-501')).toHaveAttribute('data-applied', 'true');
  return recorded;
}

test('a double-click on Save sends exactly one POST, and Save is disabled while it is in flight', async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = { rows: [TITLE_SUGGESTION] as object[] };
  const recorded = await openWithSuggestion(
    page,
    async (route) => {
      await held;
      pending.rows = [];
      await route.fulfill({ json: { ...successBody(NAME), accepted_suggestions: [501] } });
    },
    pending,
  );

  await saveButton(page).dblclick();
  await expect(saveButton(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(saveButton(page)).toHaveAttribute('aria-busy', 'true');
  // A third click while it is still in flight changes nothing either. `force`: Playwright would
  // (rightly) refuse to click an aria-disabled button, and this click proves the handler ignores it.
  await saveButton(page).click({ force: true });

  release();
  await expect(page.getByText(`Quest ${NAME} saved and committed`)).toBeVisible();
  await expect(saveButton(page)).toHaveAttribute('aria-disabled', 'false');
  expect(recorded.savePosts).toHaveLength(1);
  expect(recorded.savePosts[0].accepted_suggestions).toEqual([501]);
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0);
});

test('a failed save drops the accepted ids the server no longer holds as pending, so the retry succeeds', async ({
  page,
}) => {
  const pending = { rows: [TITLE_SUGGESTION] as object[] };
  let answers = 0;
  const recorded = await openWithSuggestion(
    page,
    async (route) => {
      answers += 1;
      if (answers === 1) {
        // The row was flipped by an earlier save whose answer was lost (or rejected meanwhile).
        pending.rows = [];
        await route.fulfill({
          status: 400,
          json: { error: 'Suggestion 501 is not a pending suggestion of this quest' },
        });
        return;
      }
      await route.fulfill({ json: successBody(NAME) });
    },
    pending,
  );

  await saveButton(page).click();
  await expect(
    page.locator('[data-sonner-toast][data-type="warning"]').filter({
      hasText: '1 accepted suggestion is no longer pending',
    }),
  ).toBeVisible();
  // The value stays in the document; only the claim on the dead id went.
  // Since 8.1 (D186) the title is a picker that keeps the stored key in its hidden input.
  await expect(
    page.getByRole('main').locator('input[type="hidden"][name="m_questTitle"]'),
  ).toHaveValue('QuestTitle_ABCDE');

  await saveButton(page).click();
  await expect(page.getByText(`Quest ${NAME} saved and committed`)).toBeVisible();
  expect(recorded.savePosts).toHaveLength(2);
  expect(recorded.savePosts[0].accepted_suggestions).toEqual([501]);
  expect(recorded.savePosts[1].accepted_suggestions).toEqual([]);
  expect((recorded.savePosts[1].quest as Record<string, unknown>).m_questTitle).toBe(
    'QuestTitle_ABCDE',
  );
});

test('a draft whose file now exists offers to open it instead of a dead-end 409', async ({
  page,
}) => {
  const DRAFT = 'FX-P714-SAVED-001';
  await mockQuestsApi(page, {
    detail: { ...CLEAN_QUEST, m_questName: DRAFT },
    onScaffold: (route) =>
      route.fulfill({
        status: 409,
        json: {
          error: `"${DRAFT}" already has a definition in QuestTemplates/. Open it in the editor instead.`,
        },
      }),
  });
  for (const type of ['zones', 'npcs', 'spells', 'drop_tables', 'quests']) {
    await page.route(`**/api/names/${type}`, (route) =>
      route.fulfill({ json: { [type]: [] } satisfies Record<string, unknown[]> }),
    );
  }
  await page.route(`**/api/quests/${DRAFT}/scaffold`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          json: {
            quest_name: DRAFT,
            link_kind: 'none',
            title_key: null,
            quest: { ...CLEAN_QUEST, m_questName: DRAFT },
          },
        })
      : route.fallback(),
  );
  await page.route(`**/api/quests/${DRAFT}/suggestions*`, (route) =>
    route.fulfill({ json: { quest_name: DRAFT, catalog_id: null, suggestions: [] } }),
  );

  await page.goto(`/drafts/quest/${DRAFT}`);
  await expect(page.getByRole('main').locator('[data-draft="missing"]')).toBeVisible();
  await saveButton(page).click();

  const toast = page
    .locator('[data-sonner-toast][data-type="error"]')
    .filter({ hasText: 'already has a file' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Open the saved quest' }).click();
  await expect(page).toHaveURL(new RegExp(`/quests/${DRAFT}$`));
});

test('a failed suggestions read is shown with a retry, never as "nothing to accept" (review 9f)', async ({
  page,
}) => {
  let reads = 0;
  await mockQuestsApi(page, { detail: CLEAN_QUEST });
  await page.route(`**/api/quests/${NAME}/suggestions*`, (route) => {
    reads += 1;
    return reads === 1
      ? route.fulfill({ status: 500, json: { error: 'database is locked' } })
      : route.fulfill({
          json: { quest_name: NAME, catalog_id: null, suggestions: [TITLE_SUGGESTION] },
        });
  });
  await page.goto(`/quests/${NAME}`);

  const alert = page.getByTestId('suggestions-read-error');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('database is locked');
  await expect(page.getByTestId('suggestions-accept-all')).toHaveCount(0);

  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByTestId('suggestions-accept-all')).toContainText('1 pending suggestion');
});

test('Accept waits while the same row’s Reject is in flight (review 9g)', async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockQuestsApi(page, { detail: CLEAN_QUEST });
  await page.route(`**/api/quests/${NAME}/suggestions*`, (route) =>
    route.fulfill({
      json: { quest_name: NAME, catalog_id: null, suggestions: [TITLE_SUGGESTION] },
    }),
  );
  await page.route('**/api/suggestions/501/reject', async (route) => {
    await held;
    await route.fulfill({ json: { ...TITLE_SUGGESTION, status: 'rejected' } });
  });
  await page.goto(`/quests/${NAME}`);
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
  const main = page.getByRole('main');
  const accept = main.getByRole('button', { name: 'Accept m_questTitle from evidence-title' });
  await expect(accept).toHaveAttribute('aria-disabled', 'false');

  await main.getByRole('button', { name: 'Reject m_questTitle from evidence-title' }).click();
  await expect(accept).toHaveAttribute('aria-disabled', 'true');
  // A click now does nothing (forced past Playwright's own actionability refusal).
  await accept.click({ force: true });
  await expect(page.getByTestId('suggestion-501')).toHaveAttribute('data-applied', 'false');
  await expect(main.getByRole('button', { name: /^Accept m_questTitle/ })).toBeVisible();
  release();
});
