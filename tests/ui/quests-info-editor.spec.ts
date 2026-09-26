import { expect, test, type Locator, type Page } from '@playwright/test';

import { MOCK_QUEST, mockQuestsApi } from './quests-mocks';

/**
 * Tier-1 Info-tab editor spec (plan task 3.3 / story p3-03, decision D23 tier 1 /
 * D40).
 *
 * Drives the real `/quests/:questName` page in headless chromium with the API
 * route-mocked, exactly like `quests-detail.spec.ts`. Nothing here needs the corpus
 * or a synced database.
 *
 * What this file proves, clause by clause of `p3-03-ac1`:
 *
 * - the spec's two columns (docs/spec-ui-design.md L296-298): `m_questName`
 *   read-only, `m_questTitle` as a string-table key with the resolved string beside
 *   it, `m_questLevel` and `m_questRepeat` as number inputs, `m_mainline` /
 *   `m_isHidden` as checkboxes, `m_activityType` as a select, the two script inputs,
 *   the tag input, and the read-only timestamp;
 * - the collapsible "Advanced" section holding the remaining twelve top-level
 *   scalars, each editable;
 * - the string-table lookup: a hit shows the resolved string, a miss shows the raw
 *   key verbatim, and the empty key is **never requested** (its URL would answer the
 *   24 MB list body);
 * - edits reach the JSON side panel with no refresh, while untouched keys — including
 *   the ones no Info-tab field owns — are byte-identical;
 * - emptying an editable field **deletes** its key rather than writing `''`;
 * - the Info tab is the only *editable* tab this spec owns: the Goals tab became the
 *   second live editor in story p3-04 (`quests-goals-editor.spec.ts`), and the remaining
 *   four stay read-only.
 *
 * The strings are written out in full rather than imported from the app: a spec that
 * imported the copy it asserts could only prove the app agrees with itself. The one
 * exception is the quest fixture itself, which the shared mock already owns.
 */

/** The page's `<main>` region. */
function main_(page: Page): Locator {
  return page.getByRole('main');
}

/** The JSON side panel (desktop). */
function sidePanel(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Quest JSON' });
}

async function openJson(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Toggle JSON panel' }).click();
  const panel = sidePanel(page);
  await expect(panel).toBeVisible();
  return panel;
}

/** The Info editor's section, so a label lookup cannot escape into another tab. */
function editor(page: Page): Locator {
  return main_(page).getByRole('region', { name: 'Quest info editor' });
}

/** The Advanced disclosure's body. */
function advanced(page: Page): Locator {
  return editor(page).locator('details');
}

/**
 * The document the JSON panel currently shows, read through its own `[Copy]`
 * affordance. This is the strongest available check: it is the panel's serialization
 * of the live document, parsed back, so an untouched key can be compared exactly
 * instead of by substring.
 */
async function copyPanelDocument(page: Page): Promise<Record<string, unknown>> {
  await page.getByRole('button', { name: 'Copy' }).click();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  return JSON.parse(text) as Record<string, unknown>;
}

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
});

test.describe('the two-column form', () => {
  test('renders every field of spec L296-298 with its kind', async ({ page }) => {
    await mockQuestsApi(page, { names: { QuestTitle_1ED8D: 'Quest for Perfection' } });
    await page.goto('/quests/DS-ACAD1-C01-001');

    const form = editor(page);
    await expect(form).toBeVisible();

    // Left column, in the spec's order.
    const name = form.getByLabel('m_questName', { exact: true });
    await expect(name).toHaveValue('DS-ACAD1-C01-001');
    await expect(name).toHaveAttribute('readonly', '');

    const title = form.getByLabel('m_questTitle', { exact: true });
    await expect(title).toHaveValue('QuestTitle_1ED8D');
    // The resolved string sits beside the key (the lookup is asserted on its own below).
    await expect(form.getByText('Quest for Perfection')).toBeVisible();

    await expect(form.getByLabel('m_questLevel', { exact: true })).toHaveAttribute(
      'type',
      'number',
    );
    await expect(form.getByLabel('m_questLevel', { exact: true })).toHaveValue('7');

    await expect(form.getByLabel('m_mainline', { exact: true })).toHaveAttribute(
      'type',
      'checkbox',
    );
    await expect(form.getByLabel('m_mainline', { exact: true })).toBeChecked();
    await expect(form.getByLabel('m_isHidden', { exact: true })).toHaveAttribute(
      'type',
      'checkbox',
    );
    await expect(form.getByLabel('m_isHidden', { exact: true })).not.toBeChecked();

    await expect(form.getByLabel('m_questRepeat', { exact: true })).toHaveAttribute(
      'type',
      'number',
    );
    await expect(form.getByLabel('m_questRepeat', { exact: true })).toHaveValue('0');

    const activity = form.getByLabel('m_activityType', { exact: true });
    await expect(activity).toHaveJSProperty('tagName', 'SELECT');
    // The fixture carries no `m_activityType`: the select falls back to the unset
    // option rather than inventing `ACTIVITY_NotActivity`.
    await expect(activity).toHaveValue('');

    // Right column.
    await expect(form.getByLabel('m_onStartQuestScript', { exact: true })).toBeVisible();
    await expect(form.getByLabel('m_onEndQuestScript', { exact: true })).toBeVisible();
    await expect(form.getByLabel('m_clientTags', { exact: true })).toBeVisible();
    // The fixture carries `m_clientTags: null` (as all 322 corpus files do), so the
    // tag input is empty rather than pre-filled.
    await expect(form.getByLabel('m_clientTags', { exact: true })).toHaveValue('');

    // The spec's read-only timestamps (L298) — the browse row's own `modified_at`.
    await expect(form.getByText('Modified')).toBeVisible();
  });

  test('the two columns are laid out side by side above md', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');

    const nameBox = await editor(page).getByLabel('m_questName', { exact: true }).boundingBox();
    const scriptBox = await editor(page)
      .getByLabel('m_onStartQuestScript', { exact: true })
      .boundingBox();
    expect(nameBox).not.toBeNull();
    expect(scriptBox).not.toBeNull();
    // Left column starts left of the right column and roughly level with it.
    expect(nameBox!.x).toBeLessThan(scriptBox!.x);
    expect(Math.abs(nameBox!.y - scriptBox!.y)).toBeLessThan(40);
  });
});

test.describe('the Advanced section', () => {
  test('is collapsed by default and holds the twelve remaining scalars, editable', async ({
    page,
  }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');

    const details = advanced(page);
    await expect(details).toHaveCount(1);
    // Native `<details>`: closed unless the `open` attribute is set.
    await expect(details).not.toHaveAttribute('open', '');

    await details.locator('summary').click();
    await expect(details).toHaveAttribute('open', '');

    // The plan's own examples plus the rest of the remaining scalars (12 keys).
    const advancedKeys = [
      'm_questNameID',
      'm_questInfo',
      'm_questPrep',
      'm_questUnderway',
      'm_questComplete',
      'm_noQuestHelper',
      'm_prepAlways',
      'm_forceInteraction',
      'm_checkInventoryForCrafting',
      'm_playAsYourPetNPC',
      'm_outdated',
      'm_skipQHAutoSelect',
    ] as const;
    for (const key of advancedKeys) {
      await expect(details.getByLabel(key), `${key} in Advanced`).toBeVisible();
    }

    // Each is editable, and one is exercised here: the fixture has no
    // `m_noQuestHelper`, so checking it writes the key (and nothing else).
    await details.getByLabel('m_noQuestHelper', { exact: true }).check();
    await expect(details.getByLabel('m_noQuestHelper', { exact: true })).toBeChecked();
  });

  test('does not inject a key merely by opening the section', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');
    const before = await (async () => {
      await openJson(page);
      return copyPanelDocument(page);
    })();

    await advanced(page).locator('summary').click();

    const after = await copyPanelDocument(page);
    expect(after).toStrictEqual(before);
    expect('m_noQuestHelper' in after).toBe(false);
  });
});

test.describe('the string-table title lookup', () => {
  test('a hit renders the resolved string beside the raw key', async ({ page }) => {
    const recorded = await mockQuestsApi(page, {
      names: { QuestTitle_1ED8D: 'Quest for Perfection' },
    });
    await page.goto('/quests/DS-ACAD1-C01-001');

    await expect(editor(page).getByText('Quest for Perfection')).toBeVisible();
    // The key itself stays visible and editable — this is a lookup display, not a
    // replacement of the stored value.
    await expect(editor(page).getByLabel('m_questTitle', { exact: true })).toHaveValue(
      'QuestTitle_1ED8D',
    );
    expect(recorded.nameLookups).toEqual(['QuestTitle_1ED8D']);
  });

  test('a miss renders the raw key verbatim, with no warning', async ({ page }) => {
    // `{}` = every key 404s, which is the corpus's own fallback path.
    const recorded = await mockQuestsApi(page, { names: {} });
    await page.goto('/quests/DS-ACAD1-C01-001');

    await expect(editor(page).getByText('QuestTitle_1ED8D', { exact: true })).toBeVisible();
    expect(recorded.nameLookups).toEqual(['QuestTitle_1ED8D']);
    // No error surface: an unresolvable key is expected content, not a failure.
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('the empty key is never looked up', async ({ page }) => {
    const recorded = await mockQuestsApi(page, {
      detail: { ...MOCK_QUEST, m_questTitle: '' },
    });
    await page.goto('/quests/DS-ACAD1-C01-001');

    await expect(editor(page).getByLabel('m_questTitle', { exact: true })).toHaveValue('');
    // The load-bearing guard: `/api/names/strings/` is the LIST route and answers
    // 24,077,358 bytes (measured against the live database), so the client must not
    // ask at all.
    expect(recorded.nameLookups).toEqual([]);
  });
});

test.describe('edits and the JSON panel', () => {
  test('a number edit shows up in the panel with no refresh, and nothing else moves', async ({
    page,
  }) => {
    await mockQuestsApi(page, { names: { QuestTitle_1ED8D: 'Quest for Perfection' } });
    await page.goto('/quests/DS-ACAD1-C01-001');

    await openJson(page);
    const before = await copyPanelDocument(page);
    expect(before.m_questLevel).toBe(7);

    // No reload, no refetch: the same page instance.
    await editor(page).getByLabel('m_questLevel', { exact: true }).fill('4242');

    const after = await copyPanelDocument(page);
    expect(after.m_questLevel).toBe(4242);
    // Everything else is exactly as it was — including the keys no Info-tab field
    // owns (`m_goals`, `m_goalLogic`, `m_requirements`, `m_dialogList`, …).
    expect({ ...after, m_questLevel: 7 }).toStrictEqual(before);
  });

  test('a checkbox edit writes a boolean and leaves the other keys alone', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');
    await openJson(page);
    const before = await copyPanelDocument(page);

    await editor(page).getByLabel('m_isHidden', { exact: true }).check();
    const after = await copyPanelDocument(page);

    expect(after.m_isHidden).toBe(true);
    expect({ ...after, m_isHidden: false }).toStrictEqual(before);
  });

  test('a tag edit writes an array, and clearing it deletes the key', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');
    await openJson(page);

    await editor(page).getByLabel('m_clientTags', { exact: true }).fill('event,  seasonal');
    let doc = await copyPanelDocument(page);
    expect(doc.m_clientTags).toStrictEqual(['event', 'seasonal']);

    // Emptying a field that exists DELETES the key (D57: never write `''`/undefined).
    await editor(page).getByLabel('m_clientTags', { exact: true }).fill('');
    doc = await copyPanelDocument(page);
    expect('m_clientTags' in doc).toBe(false);
  });

  test('clearing a string field deletes it, and clearing an absent one is a no-op', async ({
    page,
  }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');
    await openJson(page);

    // `m_questTitle` exists in the fixture.
    await editor(page).getByLabel('m_questTitle', { exact: true }).fill('');
    let doc = await copyPanelDocument(page);
    expect('m_questTitle' in doc).toBe(false);

    // `m_onStartQuestScript` does not: clearing it must not create it.
    await editor(page).getByLabel('m_onStartQuestScript', { exact: true }).fill('');
    doc = await copyPanelDocument(page);
    expect('m_onStartQuestScript' in doc).toBe(false);

    // Both deletions left every other key alone.
    expect(doc.m_questName).toBe('DS-ACAD1-C01-001');
    expect(doc.m_questLevel).toBe(7);
    expect(Array.isArray(doc.m_goals)).toBe(true);
  });

  test('the activity select offers the enum values and keeps an unlisted one', async ({ page }) => {
    await mockQuestsApi(page, {
      detail: { ...MOCK_QUEST, m_activityType: 'ACTIVITY_Crafting' },
    });
    await page.goto('/quests/DS-ACAD1-C01-001');

    const select = editor(page).getByLabel('m_activityType', { exact: true });
    await expect(select).toHaveValue('ACTIVITY_Crafting');
    // The authoritative six (Imcodec's generated `ActivityType` enum).
    const options = await select.locator('option').allTextContents();
    expect(options).toHaveLength(6);
    expect(options).toContain('Not Activity');
    expect(options).toContain('Crafting');
    expect(options).toContain('Pet');

    // A value the enum has never heard of stays selectable and selected — real
    // content is never silently rewritten to a listed option.
    await mockQuestsApi(page, {
      detail: { ...MOCK_QUEST, m_activityType: 'ACTIVITY_FutureThing' },
    });
    await page.reload();
    const selectAgain = editor(page).getByLabel('m_activityType', { exact: true });
    await expect(selectAgain).toHaveValue('ACTIVITY_FutureThing');
    await expect(selectAgain.locator('option')).toHaveCount(7);
    await expect(selectAgain.locator('option:checked')).toHaveText(
      'ACTIVITY_FutureThing (unlisted)',
    );
  });
});

test.describe('the other tabs stay read-only', () => {
  test('the four not-yet-editable tabs render no control at all', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');

    // The Info tab is the editor…
    await expect(editor(page).locator('input').first()).toBeVisible();

    // …the Goals tab is the second live editor as of story p3-04 (its own spec,
    // `quests-goals-editor.spec.ts`, drives it)…
    await main_(page).getByRole('tab', { name: 'Goals' }).click();
    await expect(main_(page).getByRole('region', { name: 'Quest goals editor' })).toBeVisible();

    // …and the remaining four are still the read-only preview (p2-08's contract).
    for (const tab of ['Goal Logic', 'Requirements', 'Results', 'Dialog'] as const) {
      await main_(page).getByRole('tab', { name: tab }).click();
      await expect(
        main_(page).getByRole('tabpanel').locator('input, select, textarea'),
        `${tab} is read-only`,
      ).toHaveCount(0);
    }
  });

  test('the header Edit button keeps its Phase-3 tooltip (the toggle is task 3.10)', async ({
    page,
  }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');

    const edit = main_(page).getByRole('button', { name: 'Edit' });
    await expect(edit).toBeDisabled();
    await expect(edit).toHaveAttribute('title', 'Editing arrives in Phase 3');
  });
});
