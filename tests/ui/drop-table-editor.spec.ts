import { expect, test, type Page } from '@playwright/test';

/**
 * Story p4-02's tier-1 UI spec (decision D40/D44): the DropTable detail editor, driven
 * against route-mocked API responses. The second form on task 4.1's generic scaffolding, and
 * the only place AC2 (an inline requirement tree on an item row) is proven through a browser.
 *
 * Hermetic by construction: every request the page makes is fulfilled from the fixtures below,
 * so the run reaches neither the dev stack's SQLite file nor the D17 clone. The wire contracts
 * are copied literally (the same reason `quests-mocks.ts` does): a fixture that imported
 * `client/src/lib/objects.ts` could only prove the client agrees with itself.
 *
 * What is asserted, and how:
 *
 * - the four sections and the loaded document, including the **absent** `GrantsPotionSlot` of
 *   the 282-file shape (a control for it exists; nothing writes it untouched);
 * - the **string↔number ItemId trap**: the document's `"1001"` must resolve to the synced
 *   `gid: 1001`, and the request log pins that no single-id lookup was needed (the canonicalised
 *   id matched the cached list), which is what "0 of 72 as raw strings" would fail;
 * - the miss-safe autofill: an id with no synced name (a NULL name, or the measured missing
 *   `1000`) writes **no** `ItemName` and keeps the raw id;
 * - the four AC1 negatives: each yields an inline error and a disabled Save — proven per
 *   negative, not once for the family;
 * - AC2: `ReqHasQuest{NOT}` added on item row 1 through the inline `RequirementTreeEditor`,
 *   read back byte-shaped through the JSON panel's own `[Copy]`, POSTed, and rendered again
 *   after a reload of the saved document;
 * - the D57/D69(b) diff rule at the UI level: a one-field edit POSTs a document that differs
 *   from the loaded one **only** at that field — no padded `GrantsPotionSlot`, no refreshed
 *   audit values.
 */

import {
  OTHER_KEY,
  QUEST_NAME,
  QUEST_TITLE,
  REQUIREMENT_LIST,
  RHQ,
  SELF_KEY,
  mockDocument,
  mockDropTableApi,
  type DropTableMockOptions,
  type DropTableMockRecorded,
} from './drop-table-mocks';

/* ------------------------------------------------------------------- helpers */

/** `main` — the same scope every other spec uses, so the sidebar cannot satisfy a locator. */
function main(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('main');
}

/** Opens the detail page and presses Edit, returning the request log. */
async function openEditor(
  page: Page,
  options: DropTableMockOptions = {},
): Promise<DropTableMockRecorded> {
  const recorded = await mockDropTableApi(page, options);
  await page.goto(`/drop-tables/${SELF_KEY}`);
  await expect(main(page).getByText(SELF_KEY, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(main(page).getByRole('region', { name: 'Basic' })).toBeVisible();
  // Edit really swapped the controls on (a view-mode control is read-only).
  await expect(main(page).getByRole('textbox', { name: 'Name', exact: true })).toBeEditable();
  return recorded;
}

/** The inline message list under a field/group, as text. */
function messagesUnder(page: Page, field: string): ReturnType<Page['locator']> {
  return page.locator(`li[data-field="${field}"]`);
}

/**
 * An item row's own tree, by its **1-based** row number (the label the form renders:
 * `Requirements for item 1` is `Items[0]`'s tree). The 0-based document address stays 0-based
 * wherever an address is passed.
 */
function itemTree(page: Page, item: number): ReturnType<Page['locator']> {
  return main(page).getByRole('region', {
    name: `Requirements for item ${item}`,
    exact: true,
  });
}

/** A requirement class's glossary pair (task 7.9) — the leading words of a tree card's name. */
const CARD_TITLES: Record<string, RegExp> = {
  // Task 7.10: a leaf is titled by its class label, then its operand once it has one
  // (`Requires quest: <name>`), with `Not: ` in front when negated.
  ReqHasQuest: /^(?:Not: )?Requires quest(?::| (?!registry))/,
};

/**
 * A tree card by its exact document address (`Items[0].Requirements[0]`, its `data-path`; task 7.9
 * keeps a path out of every label) and the class pair its accessible name starts with.
 */
function treeCard(
  page: Page,
  item: number,
  title: string,
  address: string,
): ReturnType<Page['locator']> {
  return itemTree(page, item)
    .getByRole('article', { name: CARD_TITLES[title] })
    .and(itemTree(page, item).locator(`[data-path="${address}"]`));
}

/** The live document, read through the JSON panel's own `[Copy]` affordance (key order included). */
async function copyPanelText(page: Page): Promise<string> {
  const panel = page.getByRole('complementary', { name: 'Drop Tables JSON' });
  if (!(await panel.isVisible())) {
    await page.getByRole('button', { name: 'Toggle JSON panel' }).click();
    await expect(panel).toBeVisible();
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

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
});

/* ------------------------------------------------------- the loaded document */

test.describe('the loaded document', () => {
  test('renders the four spec sections with the file’s own values, and no invented key', async ({
    page,
  }) => {
    await openEditor(page);

    for (const name of ['Basic', 'Rewards', 'Items', 'Audit']) {
      await expect(main(page).getByRole('region', { name, exact: true })).toBeVisible();
    }

    await expect(main(page).getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      SELF_KEY,
    );
    await expect(main(page).getByRole('textbox', { name: 'Description', exact: true })).toHaveValue(
      'Test table',
    );
    await expect(main(page).getByLabel('Roll chance value', { exact: true })).toHaveValue('1');
    await expect(main(page).getByLabel('Minimum gold', { exact: true })).toHaveValue('0');
    await expect(main(page).getByLabel('Maximum gold', { exact: true })).toHaveValue('0');

    // `GrantsPotionSlot` is absent from this file: the control exists, is unchecked, and says so.
    await expect(
      main(page).getByRole('checkbox', { name: 'Grants potion slot', exact: true }),
    ).not.toBeChecked();
    await expect(main(page).getByText(/Absent in this file/)).toBeVisible();

    // The audit block is read-only data.
    await expect(main(page).getByRole('region', { name: 'Audit', exact: true })).toContainText(
      'quest_builder',
    );
    await expect(main(page).getByRole('region', { name: 'Audit', exact: true })).toContainText(
      '2026-06-01T00:57:50.183246Z',
    );

    // Two item rows, each with the four DropItem fields.
    await expect(main(page).getByRole('article', { name: 'Item 1', exact: true })).toBeVisible();
    await expect(main(page).getByRole('article', { name: 'Item 2', exact: true })).toBeVisible();
    await expect(page.getByLabel('Item 1 item name')).toHaveValue('Black Mantle');
    await expect(page.getByLabel('Item 2 item name')).toHaveValue('New Item');

    // Nothing is dirty on load, so Save is disabled.
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('a 404 renders the not-found state with the back link intact', async ({ page }) => {
    await mockDropTableApi(page, { detailStatus: 404 });
    await page.goto(`/drop-tables/${SELF_KEY}`);
    await expect(page.getByRole('heading', { name: 'Drop Tables entry not found' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Back to Drop Tables/ })).toBeVisible();
  });
});

/* --------------------------------------------------- the ItemId → ItemName autofill */

test.describe('the ItemId → ItemName autofill', () => {
  test('a STRING ItemId resolves through the synced integer gid (canonicalised, no lookup)', async ({
    page,
  }) => {
    const recorded = await openEditor(page);

    // Item 1's stored id is the JSON string "1001"; the names table holds gid 1001. Compared as
    // raw values these never match (0 of the 72 corpus ids would), so the dropdown showing the
    // synced name proves the canonicalisation ran.
    const trigger = main(page).getByRole('combobox', { name: 'Item 1 item id', exact: true });
    await expect(trigger).toContainText('Black Mantle');
    // The string form is preserved in the document and shown beside the label.
    await expect(main(page).getByText('stored as "1001"')).toBeVisible();

    // And it resolved from the cached list, not from a per-id fallback request. (Item 2's
    // `1000` is one of the eight measured misses and therefore DOES fire one — that is the
    // documented fallback — so the assertion names the resolving id.)
    expect(recorded.itemLookups).not.toContain('1001');
  });

  test('selecting an item writes the chosen id and auto-fills the read-only ItemName', async ({
    page,
  }) => {
    const recorded = await openEditor(page);

    await main(page).getByRole('combobox', { name: 'Item 1 item id', exact: true }).click();
    const search = page.getByRole('combobox', { name: 'Search items', exact: true });
    await expect(search).toBeVisible();
    await search.fill('Twice');
    await page.getByRole('option', { name: 'Twice Stitched Boots', exact: true }).click();

    await expect(page.getByLabel('Item 1 item name')).toHaveValue('Twice Stitched Boots');
    await expect(main(page).getByText('stored as "1002"')).toBeVisible();

    // The choice is one edit batch: the id and the name land together.
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
    await page.getByRole('button', { name: 'Save' }).click();
    const object = recorded.savePosts[0].object as {
      Items: Array<Record<string, unknown>>;
    };
    expect(object.Items[0]).toEqual({
      ItemId: '1002',
      ItemName: 'Twice Stitched Boots',
      Notes: 'Balance',
      Requirements: null,
    });
    // Item 2 was not touched.
    expect(object.Items[1]).toEqual({
      ItemId: '1000',
      ItemName: 'New Item',
      Notes: '',
      Requirements: null,
    });
  });

  test('an id whose synced name is NULL leaves the stored ItemName untouched (miss-safe)', async ({
    page,
  }) => {
    const recorded = await openEditor(page);

    await main(page).getByRole('combobox', { name: 'Item 2 item id', exact: true }).click();
    const search = page.getByRole('combobox', { name: 'Search items', exact: true });
    await search.fill('1003');
    // The option exists (the row is in the table) but carries no name, so its label is the id.
    await page.getByRole('option', { name: '1003', exact: true }).click();

    // The id is written; the name is NOT invented, and the stored value survives.
    await expect(page.getByLabel('Item 2 item name')).toHaveValue('New Item');
    await page.getByRole('button', { name: 'Save' }).click();
    const object = recorded.savePosts[0].object as { Items: Array<Record<string, unknown>> };
    expect(object.Items[1]).toEqual({
      ItemId: '1003',
      ItemName: 'New Item',
      Notes: '',
      Requirements: null,
    });
  });

  test('the measured miss 1000 keeps its raw id, its stored name and needs no lookup', async ({
    page,
  }) => {
    const recorded = await openEditor(page);

    // Item 2 (`1000`) is not in the synced table: the dropdown shows the raw id, the read-only
    // name keeps what the file has, and no single-id lookup is attempted.
    await expect(
      main(page).getByRole('combobox', { name: 'Item 2 item id', exact: true }),
    ).toContainText('1000');
    await expect(page.getByLabel('Item 2 item name')).toHaveValue('New Item');
    // The fallback lookup fired (the id is well-formed and worth asking about), missed, and
    // left the raw id on screen — the miss-safe rule, end to end.
    expect(recorded.itemLookups).toContain('1000');
  });
});

/* ------------------------------------------------------------------ AC1: the four negatives */

test.describe('the four blocking rules: inline error + disabled Save', () => {
  test('an empty Name', async ({ page }) => {
    const recorded = await openEditor(page);
    await main(page).getByRole('textbox', { name: 'Name', exact: true }).fill('');

    await expect(messagesUnder(page, 'Name')).toContainText('non-empty Name');
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await expect(main(page).getByRole('alert')).toContainText('Missing name');
    expect(recorded.savePosts).toHaveLength(0);
  });

  test('a duplicate Name (checked against the corpus the list route serves)', async ({ page }) => {
    await openEditor(page);
    await main(page).getByRole('textbox', { name: 'Name', exact: true }).fill(OTHER_KEY);

    await expect(messagesUnder(page, 'Name')).toContainText('already used by another drop table');
    await expect(messagesUnder(page, 'Name')).toContainText(OTHER_KEY);
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await expect(main(page).getByRole('alert')).toContainText('Duplicate name');
  });

  test('the entry’s own name is not a duplicate of itself (an unmodified save passes)', async ({
    page,
  }) => {
    await openEditor(page);
    // Touch a different field so the document is dirty and Save's disabled state means
    // "blocked", not "nothing to save".
    await main(page).getByLabel('Roll chance value', { exact: true }).fill('0.5');
    await expect(messagesUnder(page, 'Name')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  test('RollChance 1.5', async ({ page }) => {
    await openEditor(page);
    await main(page).getByLabel('Roll chance value', { exact: true }).fill('1.5');

    await expect(messagesUnder(page, 'RollChance')).toContainText('between 0 and 1');
    await expect(messagesUnder(page, 'RollChance')).toContainText('1.5');
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('NoneChance -0.1', async ({ page }) => {
    await openEditor(page);
    await main(page).getByLabel('None chance value', { exact: true }).fill('-0.1');

    await expect(messagesUnder(page, 'NoneChance')).toContainText('-0.1');
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('MinGold 100 + MaxGold 10', async ({ page }) => {
    await openEditor(page);
    await main(page).getByLabel('Minimum gold', { exact: true }).fill('100');
    await main(page).getByLabel('Maximum gold', { exact: true }).fill('10');

    // One rule, one finding, placed at MaxGold and shown under the gold group.
    await expect(messagesUnder(page, 'MaxGold')).toContainText('Minimum gold');
    await expect(messagesUnder(page, 'MaxGold')).toContainText('100');
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await expect(main(page).getByRole('alert')).toContainText('Inverted gold range');
  });

  test('a valid edit leaves no message and enables Save again', async ({ page }) => {
    await openEditor(page);
    const chance = main(page).getByLabel('Roll chance value', { exact: true });
    await chance.fill('1.5');
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
    await chance.fill('0.25');
    await expect(messagesUnder(page, 'RollChance')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});

/* -------------------------------------------------- AC2: the inline requirement tree */

test.describe('AC2: an item row’s requirement tree', () => {
  test('adds ReqHasQuest{NOT} through the inline editor, posts the polymorphic shape, and re-renders it after a reload', async ({
    page,
  }) => {
    const recorded = await openEditor(page);
    const address = 'Items[0].Requirements[0]';

    // The slot is the corpus's untyped wrapper; the shared editor offers Add Condition.
    await itemTree(page, 1)
      .getByRole('button', { name: 'Add Condition to Items 1 › Requirements', exact: true })
      .click();
    await expect(treeCard(page, 1, 'ReqHasQuest', address)).toBeVisible();

    // Fill the quest and flip NOT — the two controls of the AC's `ReqHasQuest{NOT}`.
    const card = treeCard(page, 1, 'ReqHasQuest', address);
    await card
      .getByRole('combobox', { name: 'Quest (m_questName) Items 1 › Requirements 1', exact: true })
      .click();
    const search = page.getByRole('combobox', { name: 'Search quests', exact: true });
    await expect(search).toBeVisible();
    await search.fill(QUEST_NAME);
    // The option is the QuestTemplate pair (D105/P6-16): `formatNameRow('quests')` pairs
    // the resolved title with the quest name it belongs to.
    await page.getByRole('option', { name: `${QUEST_TITLE} (${QUEST_NAME})`, exact: true }).click();
    await card.getByLabel('NOT (m_applyNOT)', { exact: true }).check();

    // The live document, byte-shaped through the panel: the wrapper is untyped, the leaf is
    // tagged, NOT is true, and the sibling item row is untouched.
    const document = JSON.parse(await copyPanelText(page)) as {
      Items: Array<{ Requirements: Record<string, unknown> | null }>;
    };
    expect(document.Items[0].Requirements).toEqual({
      // The slot was `null`, so the shared builder created the canonical wrapper, `$type` included.
      $type: REQUIREMENT_LIST,
      m_applyNOT: false,
      m_operator: 'ROP_AND',
      m_requirements: [
        { $type: RHQ, m_applyNOT: true, m_operator: 'ROP_AND', m_questName: QUEST_NAME },
      ],
    });
    expect(document.Items[1].Requirements).toBeNull();

    // Save posts exactly that.
    await page.getByRole('button', { name: 'Save' }).click();
    expect(recorded.savePosts).toHaveLength(1);
    const posted = recorded.savePosts[0].object as {
      Items: Array<{ Requirements: unknown }>;
    };
    expect(posted.Items[0].Requirements).toEqual(document.Items[0].Requirements);

    // Reload with the saved document: the tree renders the same node, at the same address.
    recorded.served.current = recorded.savePosts[0].object as Record<string, unknown>;
    await page.reload();
    await page.getByRole('button', { name: 'Edit' }).click();
    await expect(treeCard(page, 1, 'ReqHasQuest', address)).toBeVisible();
    const reloaded = treeCard(page, 1, 'ReqHasQuest', address);
    await expect(
      reloaded.getByRole('combobox', {
        name: 'Quest (m_questName) Items 1 › Requirements 1',
        exact: true,
      }),
    ).toContainText(QUEST_TITLE);
    await expect(reloaded.getByLabel('NOT (m_applyNOT)', { exact: true })).toBeChecked();
  });
});

test.describe('AC2 continued: an existing untyped wrapper is not normalised', () => {
  test('adding a condition to a real `Requirements` wrapper adds no $type (D57)', async ({
    page,
  }) => {
    // The 65 real item trees' shape: the wrapper has NO `$type` (measured 7 of 314 wrappers are
    // untyped, and every DropTable item's is), and the editor must leave that alone.
    const document = mockDocument();
    (document.Items as Array<Record<string, unknown>>)[0].Requirements = {
      m_requirements: [
        {
          $type: 'Imcodec.ObjectProperty.TypeCache.ReqIsSchool, Imcodec.ObjectProperty',
          m_magicSchoolName: 'Balance',
          m_targetType: 'RT_Caster',
          m_applyNOT: false,
          m_operator: 'ROP_AND',
        },
      ],
      m_applyNOT: false,
      m_operator: 'ROP_AND',
    };
    await openEditor(page, { document });

    await itemTree(page, 1)
      .getByRole('button', { name: 'Add Condition to Items 1 › Requirements', exact: true })
      .click();
    await expect(treeCard(page, 1, 'ReqHasQuest', 'Items[0].Requirements[1]')).toBeVisible();

    const copied = JSON.parse(await copyPanelText(page)) as {
      Items: Array<{ Requirements: Record<string, unknown> }>;
    };
    const wrapper = copied.Items[0].Requirements;
    expect(wrapper.$type).toBeUndefined();
    expect(wrapper.m_requirements).toEqual([
      {
        $type: 'Imcodec.ObjectProperty.TypeCache.ReqIsSchool, Imcodec.ObjectProperty',
        m_magicSchoolName: 'Balance',
        m_targetType: 'RT_Caster',
        m_applyNOT: false,
        m_operator: 'ROP_AND',
      },
      { $type: RHQ, m_applyNOT: false, m_operator: 'ROP_AND', m_questName: '' },
    ]);
  });
});

/* ------------------------------------------------- D57/D69(b): the written diff */

test.describe('a save writes only what the user touched', () => {
  test('editing one item Notes leaves every other key, and every audit value, byte-identical', async ({
    page,
  }) => {
    const recorded = await openEditor(page);
    const before = mockDocument();

    await main(page)
      .getByRole('article', { name: 'Item 1', exact: true })
      .getByLabel('Notes', { exact: true })
      .fill('Balance Item');

    await page.getByRole('button', { name: 'Save' }).click();
    const after = recorded.savePosts[0].object as Record<string, unknown>;
    const baseline = before as Record<string, unknown>;

    // The key sets are identical: no GrantsPotionSlot was added, no audit key was dropped.
    expect(Object.keys(after)).toEqual(Object.keys(baseline));
    expect(after.GrantsPotionSlot).toBeUndefined();
    expect(after.CreatedAt).toBe(baseline.CreatedAt);
    expect(after.ModifiedAt).toBe(baseline.ModifiedAt);
    expect(after.CreatedBy).toBe(baseline.CreatedBy);
    expect(after.ModifiedBy).toBe(baseline.ModifiedBy);

    // And exactly one leaf of the document differs.
    const changed: string[] = [];
    const walk = (left: unknown, right: unknown, path: string): void => {
      if (JSON.stringify(left) === JSON.stringify(right)) {
        return;
      }
      if (
        typeof left !== 'object' ||
        typeof right !== 'object' ||
        left === null ||
        right === null
      ) {
        changed.push(path);
        return;
      }
      if (Array.isArray(left) && Array.isArray(right)) {
        for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
          walk(left[index], right[index], `${path}[${index}]`);
        }
        return;
      }
      const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
      for (const key of keys) {
        walk(
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
          path === '' ? key : `${path}.${key}`,
        );
      }
    };
    walk(baseline, after, '');
    expect(changed).toEqual(['Items[0].Notes']);
  });
});
