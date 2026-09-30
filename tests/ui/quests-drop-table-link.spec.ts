import { expect, test, type Locator, type Page } from '@playwright/test';

import { mockDropTableApi, mockDocument } from './drop-table-mocks';
import { MOCK_QUEST, mockQuestsApi } from './quests-mocks';

/**
 * Tier-1 spec for D187: a `ResDropTable` reward names its DropTable, and the name links to that
 * table's editor — in the Results cards (edit mode), the read-only Results tab and the Overview's
 * rewards line. Hermetic (D40/D185): every route is mocked, no clone or data dir is read.
 *
 * - **Hit**: a table the names API holds (`drop_tables`) renders an `<a href="/drop-tables/…">`,
 *   and a click lands on that table's editor route.
 * - **Miss**: a table with no row renders the name as plain text — no link, no dead `href`.
 * - **Guard**: the link is a router link, so a dirty quest editor asks before navigating away.
 */

const RDROP = 'Imcodec.ObjectProperty.TypeCache.ResDropTable, Imcodec.ObjectProperty';
const KNOWN = 'DS-ACAD1-C01-001';
const MISSING = 'NO-SUCH-TABLE-001';

const QUEST = {
  ...MOCK_QUEST,
  m_endResults: {
    m_results: [
      { $type: RDROP, m_tableName: KNOWN, m_maxRolls: 1 },
      { $type: RDROP, m_tableName: MISSING, m_maxRolls: 1 },
    ],
  },
};

async function openQuest(page: Page): Promise<void> {
  await mockQuestsApi(page, { detail: QUEST });
  // The names list the link reads: only KNOWN has a row, so MISSING is a corpus miss.
  await page.route('**/api/names/drop_tables', (route) =>
    route.fulfill({ json: { drop_tables: [{ name: KNOWN, description: null }] } }),
  );
  await page.goto('/quests/DS-ACAD1-C01-001');
}

function main_(page: Page): Locator {
  return page.getByRole('main');
}

async function openTab(page: Page, name: string): Promise<void> {
  await main_(page).getByRole('tab', { name, exact: true }).click();
}

test.describe('a drop-table reward links to its editor (D187)', () => {
  test('the Results card links a known table and leaves a missing one as text', async ({
    page,
  }) => {
    await openQuest(page);
    await openTab(page, 'Results');

    const known = main_(page).getByRole('link', { name: KNOWN, exact: true });
    await expect(known).toHaveAttribute('href', `/drop-tables/${KNOWN}`);
    // The miss is plain text: no link by that name, and no dead href anywhere on the card.
    await expect(main_(page).getByRole('link', { name: MISSING })).toHaveCount(0);
    await expect(
      main_(page).getByTestId('drop-table-name').filter({ hasText: MISSING }),
    ).toBeVisible();
    await expect(main_(page).locator(`a[href*="${MISSING}"]`)).toHaveCount(0);
  });

  test('the link is not nested inside another interactive element', async ({ page }) => {
    await openQuest(page);
    await openTab(page, 'Results');

    const link = main_(page).getByRole('link', { name: KNOWN, exact: true });
    await expect(
      link.locator('xpath=ancestor::*[self::button or self::a or self::summary]'),
    ).toHaveCount(0);
  });

  test('clicking it lands on that DropTable editor', async ({ page }) => {
    await openQuest(page);
    await openTab(page, 'Results');
    const detailRequests: string[] = [];
    await mockDropTableApi(page, { document: { ...mockDocument(), Name: KNOWN } });
    await page.route(`**/api/drop-tables/${KNOWN}`, async (route) => {
      detailRequests.push(route.request().url());
      await route.fulfill({ json: { ...mockDocument(), Name: KNOWN } });
    });

    await main_(page).getByRole('link', { name: KNOWN, exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/drop-tables/${KNOWN}$`));
    await expect.poll(() => detailRequests.length).toBeGreaterThan(0);
  });

  test('a dirty quest editor asks before the link navigates away', async ({ page }) => {
    await openQuest(page);
    await openTab(page, 'Info');
    await main_(page).getByLabel('Quest level (m_questLevel)', { exact: true }).fill('9');
    await openTab(page, 'Results');

    await main_(page).getByRole('link', { name: KNOWN, exact: true }).click();

    await expect(page.getByRole('dialog', { name: 'Unsaved changes' })).toBeVisible();
    await expect(page).toHaveURL(/\/quests\/DS-ACAD1-C01-001$/);
  });

  test('the Overview rewards line links the same table', async ({ page }) => {
    await openQuest(page);

    const rewards = page.getByTestId('overview-rewards');
    await expect(rewards.getByRole('link', { name: KNOWN, exact: true })).toHaveAttribute(
      'href',
      `/drop-tables/${KNOWN}`,
    );
    await expect(rewards.getByRole('link', { name: MISSING })).toHaveCount(0);
    await expect(rewards).toContainText(MISSING);
  });

  test('the read-only view of the Results tab links it too', async ({ page }) => {
    await openQuest(page);
    await main_(page).getByRole('button', { name: 'Edit' }).click();
    await openTab(page, 'Results');

    await expect(main_(page).getByRole('link', { name: KNOWN, exact: true })).toHaveAttribute(
      'href',
      `/drop-tables/${KNOWN}`,
    );
    await expect(main_(page).getByRole('link', { name: MISSING })).toHaveCount(0);
  });
});
