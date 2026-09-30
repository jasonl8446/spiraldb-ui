import { expect, test, type Page } from '@playwright/test';

import { mockQuestsApi, MOCK_QUEST } from './quests-mocks';

/**
 * Story p7-15's tier-1 spec (plan task 7.14; D112, D144): **the NPC page** `/npcs/:npcId` over the
 * existing `GET /api/npcs/:id`, and its two entry points.
 *
 * | criterion | arm |
 * |---|---|
 * | aliases, personas, dialogs, quests and inventories, with counts | the page shows every section; each heading's count equals the rows listed and the response's own `counts` |
 * | reached from a search row (D144) | the palette's `npc` row opens `/npcs/<alias key>` and is not "— not linked" |
 * | reached from a speaker name in the Evidence panel (D144) | the resolved speaker is a link to `/npcs/<template id>` |
 * | an unknown NPC | the server's 404 sentence is shown, with a retry |
 *
 * Hermetic (D40/D81): the corpus and the synced tables are mocked, so every number here comes from
 * the fixture below. What the endpoint's counts equal on real data is measured against a direct
 * query and recorded in `docs/evidence/phase-7/p7-15.md`; the endpoint itself is unit-tested in
 * `tests/unit/quest-evidence.test.ts` ("the NPC view").
 */

const NPC = {
  npc_key: 'WC-NPCs_00000003',
  template_id: 44169,
  display_name: 'Gretta Darkkettle',
  aliases: ['Gretta Darkkettle', 'Gretta'],
  personas: [
    {
      persona_key: 'WC_RAV-NPC02_Persona',
      first: 'Gretta',
      last: 'Darkkettle',
      template_id: 44169,
    },
  ],
  dialogs: [
    { quest_name: 'WC-CYCLOPS-MAIN-002', index: 0, text: 'Welcome to the Ravenwood.' },
    { quest_name: 'WC-CYCLOPS-MAIN-002', index: 4, text: null },
    { quest_name: 'WC-UNICORN-MAIN-004', index: 1, text: 'Mind the kettle.' },
  ],
  quests: ['WC-CYCLOPS-MAIN-002', 'WC-UNICORN-MAIN-004'],
  inventories: {
    npc_inventories: [{ key: '44169', file: 'NpcInventory/NPCInventories_44169-A.json' }],
    npc_spell_inventories: [],
    npc_drop_tables: [],
  },
  counts: { aliases: 2, personas: 1, dialogs: 3, quests: 2 },
  notes: [
    'inventories.npc_drop_tables is empty because NpcDropTable/ does not exist in this corpus, not because no row matched',
  ],
};

async function mockNpcs(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route('**/api/npcs/*', async (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
    asked.push(id);
    if (id === 'WC-NPCs_00000003' || id === '44169') {
      await route.fulfill({ json: { npc: NPC } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: `Unknown NPC "${id}"` } });
  });
  return asked;
}

test.describe('the NPC page (task 7.14)', () => {
  test('shows aliases, personas, dialogs, quests and inventories, each count equal to its rows', async ({
    page,
  }) => {
    await mockQuestsApi(page);
    const asked = await mockNpcs(page);
    await page.goto('/npcs/WC-NPCs_00000003');

    await expect(page.getByTestId('npc-name')).toHaveText('Gretta Darkkettle');
    await expect(page.getByTestId('npc-page')).toContainText('WC-NPCs_00000003');
    await expect(page.getByTestId('npc-page')).toContainText('44169');

    const sections = [
      ['npc-aliases', 'npc-alias', NPC.counts.aliases],
      ['npc-personas', 'npc-persona', NPC.counts.personas],
      ['npc-dialogs', 'npc-dialog', NPC.counts.dialogs],
      ['npc-quests', 'npc-quest', NPC.counts.quests],
    ] as const;
    for (const [section, row, expected] of sections) {
      await expect(page.getByTestId(`${section}-count`)).toHaveText(String(expected));
      await expect(page.getByTestId(row)).toHaveCount(expected);
    }
    // Inventories: one NPC Inventory row (a link to its detail page), the other two empty.
    await expect(page.getByTestId('npc-inventories-count')).toHaveText('1');
    await expect(page.getByTestId('npc-inventory-list-count')).toHaveText('1');
    await expect(page.getByTestId('npc-inventory-list-row')).toHaveCount(1);
    await expect(page.getByTestId('npc-inventory-list-row').getByRole('link')).toHaveAttribute(
      'href',
      '/npc-inventories/44169',
    );
    await expect(page.getByTestId('npc-spell-inventory-list-count')).toHaveText('0');
    await expect(page.getByTestId('npc-drop-table-list-count')).toHaveText('0');

    // A dialog line links its quest, and a line with no resolved text says so.
    await expect(page.getByTestId('npc-dialog').first().getByRole('link')).toHaveAttribute(
      'href',
      '/quests/WC-CYCLOPS-MAIN-002',
    );
    await expect(page.getByTestId('npc-dialog').nth(1)).toContainText(
      'No text resolves for this line.',
    );
    // The endpoint's own note explains the arm it could not populate.
    await expect(page.getByTestId('npc-notes')).toContainText('NpcDropTable/ does not exist');
    expect(asked).toEqual(['WC-NPCs_00000003']);
  });

  test('answers a template id as well as an alias key', async ({ page }) => {
    await mockQuestsApi(page);
    await mockNpcs(page);
    await page.goto('/npcs/44169');
    await expect(page.getByTestId('npc-name')).toHaveText('Gretta Darkkettle');
  });

  test('says what the server said for an unknown NPC, and offers a retry', async ({ page }) => {
    await mockQuestsApi(page);
    await mockNpcs(page);
    await page.goto('/npcs/no-such-npc');
    await expect(page.getByTestId('npc-error')).toHaveText('Unknown NPC "no-such-npc"');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });

  test('a search row for an NPC opens its page (D144)', async ({ page }) => {
    await mockQuestsApi(page);
    await mockNpcs(page);
    await page.route('**/api/search*', (route) =>
      route.fulfill({
        json: {
          query: 'gretta',
          limit: 20,
          total: 1,
          truncated: false,
          // The endpoint counts an npc row (`object_type: null`) as unresolved; the palette must
          // not call it "not linked" now that the row has a page.
          unresolved: 1,
          groups: [
            {
              type: 'npc',
              label: 'NPCs',
              results: [
                {
                  object_type: null,
                  object_key: null,
                  label: 'Gretta Darkkettle',
                  name: 'Gretta Darkkettle',
                  source_id: 'WC-NPCs_00000003',
                  status: null,
                  matched_on: 'name',
                  aliases: ['Gretta', 'Gretta Darkkettle'],
                },
              ],
            },
          ],
        },
      }),
    );
    await page.goto('/quests');
    await page.locator('header').getByRole('button', { name: 'Search all objects' }).click();
    await page.getByRole('combobox', { name: 'Search query' }).fill('gretta');
    const row = page.getByRole('option').filter({ hasText: 'Gretta Darkkettle' });
    await expect(row).toBeVisible();
    await expect(row).not.toContainText('not linked');
    await expect(page.locator('[data-search-unresolved]')).toHaveCount(0);
    await row.click();
    await expect(page).toHaveURL('/npcs/WC-NPCs_00000003');
    await expect(page.getByTestId('npc-name')).toHaveText('Gretta Darkkettle');
  });

  test('a resolved speaker name in the Evidence panel opens that NPC (D144)', async ({ page }) => {
    await mockQuestsApi(page);
    await mockNpcs(page);
    await page.goto(`/quests/${MOCK_QUEST.m_questName}?panel=evidence`);
    const link = page.getByTestId('evidence-speaker-link-0');
    await expect(link).toHaveText('Cyrus Drake');
    await expect(link).toHaveAttribute('href', '/npcs/9002');
  });
});
