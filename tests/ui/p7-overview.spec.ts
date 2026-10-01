import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { MOCK_EVIDENCE } from './quests-mocks';

/**
 * Story p7-14's tier-1 specs (plan task 7.13; D133, D144, D181), on a real clone quest. Its
 * document is a committed copy of the clone-backed server's body (CI has no `data/`, D55; gate-7
 * measured all three tests failing there when it was read live), and the string-table-dependent
 * evidence read and the suggestions read are mocked, as the other p7 specs do.
 *
 * | criterion | test |
 * |---|---|
 * | 1 — Overview is the first tab and the landing tab in edit and in view mode, read-only | `lands on Overview …` |
 * | 1 — the pending-suggestion badge opens the tab holding the first pending field (D144) | `the badge …` |
 */

const QUEST = 'WC-CYCLOPS-MAIN-003';

const DOC = (
  JSON.parse(
    readFileSync(path.resolve('tests/unit/fixtures/clone-quest-WC-CYCLOPS-MAIN-003.json'), 'utf8'),
  ) as { quest: unknown }
).quest;

function suggestion(id: number, pathName: string, status = 'pending'): object {
  return {
    id,
    path: pathName,
    value: null,
    source: 'evidence-title',
    confidence: 0.5,
    evidence_ref: null,
    status,
    created_at: null,
    decided_at: null,
  };
}

async function open(page: Page, suggestions: object[]): Promise<void> {
  await page.route(`**/api/quests/${QUEST}`, (route) => route.fulfill({ json: DOC }));
  await page.route(`**/api/quests/${QUEST}/evidence`, (route) =>
    route.fulfill({ json: { ...MOCK_EVIDENCE, quest_name: QUEST } }),
  );
  await page.route(`**/api/quests/${QUEST}/suggestions`, (route) =>
    route.fulfill({ json: { quest_name: QUEST, catalog_id: null, suggestions } }),
  );
  await page.goto(`/quests/${QUEST}`);
  await expect(page.getByRole('main').locator('[data-edit-mode]')).toBeVisible();
}

test('lands on Overview, the first tab, in edit mode and in view mode, and only reads', async ({
  page,
}) => {
  await open(page, []);
  const main = page.getByRole('main');
  const tabs = main.getByRole('tab');
  await expect(tabs.first()).toHaveText('Overview');
  await expect(tabs).toHaveText([
    'Overview',
    'Info',
    'Goals',
    'Goal Logic',
    'Requirements',
    'Results',
    'Dialog',
  ]);
  await expect(main.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(main.locator('[data-edit-mode="true"]')).toBeVisible();

  const overview = main.getByRole('region', { name: 'Quest overview' });
  await expect(overview.getByTestId('overview-giver')).toContainText('Given by');
  await expect(overview.getByTestId('overview-order')).toHaveText('Order follows the goal logic.');
  await expect(overview.getByTestId('overview-steps').getByRole('listitem').first()).toContainText(
    '1. ',
  );
  await expect(overview.getByTestId('overview-completes')).toContainText('Completes when:');
  await expect(overview.getByRole('heading', { name: 'Requires' })).toBeVisible();
  await expect(overview.getByRole('heading', { name: 'Rewards' })).toBeVisible();
  // Read-only: no field, no button (no suggestions are pending here).
  await expect(overview.locator('input, textarea, select, button')).toHaveCount(0);
  const before = await overview.innerText();

  // View mode: the same tab, the same story.
  await main.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(main.locator('[data-edit-mode="false"]')).toBeVisible();
  await expect(main.getByRole('tab').first()).toHaveText('Overview');
  await expect(main.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(overview).toBeVisible();
  expect(await overview.innerText()).toBe(before);
});

test('the badge counts pending suggestions and opens the tab of the first pending field', async ({
  page,
}) => {
  await open(page, [
    suggestion(1, 'm_goals', 'accepted'),
    suggestion(2, 'm_dialogList'),
    suggestion(3, 'm_questTitle'),
  ]);
  const main = page.getByRole('main');
  const badge = main.getByTestId('overview-suggestions-badge');
  await expect(badge).toHaveText('2 suggestions');
  await badge.click();
  await expect(main.getByRole('tab', { name: 'Dialog' })).toHaveAttribute('aria-selected', 'true');
  await expect(main.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'false',
  );
});

test('the badge also shows in view mode and opens the same tab', async ({ page }) => {
  await open(page, [suggestion(7, 'm_requirements')]);
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(main.locator('[data-edit-mode="false"]')).toBeVisible();
  const badge = main.getByTestId('overview-suggestions-badge');
  await expect(badge).toHaveText('1 suggestion');
  await badge.click();
  await expect(main.getByRole('tab', { name: 'Requirements' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
