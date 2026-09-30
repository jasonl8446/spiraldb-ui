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
 * - the spec's two columns (docs/spec-ui-design.md §"Tabbed Sections"): `m_questName`
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
 *
 * Wiped **first** and then polled (final-review gate 2, S1), which is the shape the
 * sibling specs use and this helper did not: every arm here reads the document twice
 * (before and after an edit), so without the wipe the "after" read could be the
 * pre-edit text still on the clipboard — and the single un-awaited `readText` could
 * also catch the async `writeText` empty. With the wipe, only the click that follows
 * can have written the clipboard, and the poll waits for it.
 */
async function copyPanelDocument(page: Page): Promise<Record<string, unknown>> {
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await page.getByRole('button', { name: 'Copy' }).click();
  let text = '';
  await expect
    .poll(async () => {
      text = await page.evaluate(() => navigator.clipboard.readText());
      return text.trim().startsWith('{');
    })
    .toBe(true);
  return JSON.parse(text) as Record<string, unknown>;
}

/**
 * p7-14 (D133): the quest page now lands on Overview, so every test that reads the Info editor
 * opens the Info tab first. This click is the one added step, after each `goto`.
 */
async function openInfoTab(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Info', exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
});

test.describe('the two-column form', () => {
  test('renders every field of spec L296-298 with its kind', async ({ page }) => {
    await mockQuestsApi(page, { names: { QuestTitle_1ED8D: 'Quest for Perfection' } });
    await page.goto('/quests/DS-ACAD1-C01-001');
    await openInfoTab(page);

    const form = editor(page);
    await expect(form).toBeVisible();

    // Left column, in the spec's order.
    const name = form.getByLabel('Quest (m_questName)', { exact: true });
    await expect(name).toHaveValue('DS-ACAD1-C01-001');
    await expect(name).toHaveAttribute('readonly', '');

    // The title is a picker (D186): its trigger shows the resolved pair, and the hidden field
    // carries the stored key.
    const title = form.getByRole('combobox', { name: 'Quest title (m_questTitle)', exact: true });
    await expect(title).toHaveText('Quest for Perfection (QuestTitle_1ED8D)');
    await expect(form.locator('input[type="hidden"][name="m_questTitle"]')).toHaveValue(
      'QuestTitle_1ED8D',
    );

    await expect(form.getByLabel('Quest level (m_questLevel)', { exact: true })).toHaveAttribute(
      'type',
      'number',
    );
    await expect(form.getByLabel('Quest level (m_questLevel)', { exact: true })).toHaveValue('7');

    await expect(form.getByLabel('Mainline (m_mainline)', { exact: true })).toHaveAttribute(
      'type',
      'checkbox',
    );
    await expect(form.getByLabel('Mainline (m_mainline)', { exact: true })).toBeChecked();
    await expect(form.getByLabel('Hidden (m_isHidden)', { exact: true })).toHaveAttribute(
      'type',
      'checkbox',
    );
    await expect(form.getByLabel('Hidden (m_isHidden)', { exact: true })).not.toBeChecked();

    await expect(form.getByLabel('Repeatability (m_questRepeat)', { exact: true })).toHaveAttribute(
      'type',
      'number',
    );
    await expect(form.getByLabel('Repeatability (m_questRepeat)', { exact: true })).toHaveValue(
      '0',
    );

    const activity = form.getByLabel('Activity type (m_activityType)', { exact: true });
    await expect(activity).toHaveJSProperty('tagName', 'SELECT');
    // The fixture carries no `m_activityType`: the select falls back to the unset
    // option rather than inventing `ACTIVITY_NotActivity`.
    await expect(activity).toHaveValue('');

    // Right column.
    await expect(
      form.getByLabel('Start script (m_onStartQuestScript)', { exact: true }),
    ).toBeVisible();
    await expect(form.getByLabel('End script (m_onEndQuestScript)', { exact: true })).toBeVisible();
    await expect(form.getByLabel('Client Tags (m_clientTags)', { exact: true })).toBeVisible();
    // The fixture carries `m_clientTags: null` (as all 328 corpus files do — re-measured at
    // the owner's current baseline: 328 files, 328 `null`, 0 absent, 0 any other value), so
    // the tag input is empty rather than pre-filled.
    await expect(form.getByLabel('Client Tags (m_clientTags)', { exact: true })).toHaveValue('');

    // The spec's read-only timestamps (L298) — the browse row's own `modified_at`.
    await expect(form.getByText('Modified')).toBeVisible();
  });

  test('the two columns are laid out side by side above md', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');
    await openInfoTab(page);

    const nameBox = await editor(page)
      .getByLabel('Quest (m_questName)', { exact: true })
      .boundingBox();
    const scriptBox = await editor(page)
      .getByLabel('Start script (m_onStartQuestScript)', { exact: true })
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
    await openInfoTab(page);

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
    await details.getByLabel('No Quest Helper (m_noQuestHelper)', { exact: true }).check();
    await expect(
      details.getByLabel('No Quest Helper (m_noQuestHelper)', { exact: true }),
    ).toBeChecked();
  });

  test('does not inject a key merely by opening the section', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');
    await openInfoTab(page);
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

test.describe('the string-table title picker', () => {
  const titleTrigger = (page: Page): Locator =>
    editor(page).getByRole('combobox', { name: 'Quest title (m_questTitle)', exact: true });

  test('a hit renders the resolved pair, from one lookup, without opening the list', async ({
    page,
  }) => {
    const recorded = await mockQuestsApi(page, {
      names: { QuestTitle_1ED8D: 'Quest for Perfection' },
    });
    await page.goto('/quests/DS-ACAD1-C01-001');
    await openInfoTab(page);

    await expect(titleTrigger(page)).toHaveText('Quest for Perfection (QuestTitle_1ED8D)');
    expect(recorded.nameLookups).toEqual(['QuestTitle_1ED8D']);
    // The list is a server search that only runs while the picker is open.
    expect(recorded.nameSearches).toEqual([]);
  });

  test('a miss renders the raw key verbatim, untouched and with no warning', async ({ page }) => {
    // `{}` = every key 404s, which is the corpus's own fallback path.
    const recorded = await mockQuestsApi(page, { names: {} });
    await page.goto('/quests/DS-ACAD1-C01-001');
    await openInfoTab(page);
    await openJson(page);

    await expect(titleTrigger(page)).toHaveText('QuestTitle_1ED8D');
    expect(recorded.nameLookups).toEqual(['QuestTitle_1ED8D']);
    // D57: showing an unknown key (and opening the picker on it) never rewrites it.
    await titleTrigger(page).click();
    await page.keyboard.press('Escape');
    const doc = await copyPanelDocument(page);
    expect(doc.m_questTitle).toBe('QuestTitle_1ED8D');
    // No error surface *for this field*: an unresolvable key is expected content, not a
    // failure. Scoped to the Info editor and to `m_questTitle` on purpose (story p3-09): the
    // page-level validation banner is a different surface, and this fixture's final
    // goal-logic entry does not set `m_completeQuest`, which the validation engine reports as
    // a blocking finding outside the editor. The narrow, still-strong fact is that the title
    // control is clean — no `aria-invalid`, no inline message list of its own.
    await expect(titleTrigger(page)).not.toHaveAttribute('aria-invalid', 'true');
    await expect(editor(page).getByRole('list', { name: 'Validation messages' })).toHaveCount(0);
    await expect(editor(page).getByRole('alert')).toHaveCount(0);
  });

  test('the empty key is never looked up, and shows a placeholder', async ({ page }) => {
    const recorded = await mockQuestsApi(page, {
      detail: { ...MOCK_QUEST, m_questTitle: '' },
    });
    await page.goto('/quests/DS-ACAD1-C01-001');
    await openInfoTab(page);

    await expect(titleTrigger(page)).toHaveText('No title set');
    // The load-bearing guard: `/api/names/strings/` is the LIST route and answers
    // 24,077,358 bytes (measured against the live database), so the client must not
    // ask at all.
    expect(recorded.nameLookups).toEqual([]);
  });

  test('typing searches either half, and choosing writes exactly that key (D186)', async ({
    page,
  }) => {
    const recorded = await mockQuestsApi(page, {
      names: { QuestTitle_1ED8D: 'Quest for Perfection' },
      titleRows: [
        { key: 'QuestTitle_1ED8D', value: 'Quest for Perfection' },
        { key: 'QuestTitle_17318F', value: 'The Bear Truth' },
        { key: 'QuestTitle_ABCDE', value: 'Bear Necessities' },
      ],
    });
    await page.goto('/quests/DS-ACAD1-C01-001');
    await openInfoTab(page);
    await openJson(page);
    const before = await copyPanelDocument(page);

    await titleTrigger(page).click();
    const search = page.getByRole('combobox', { name: 'Search quest titles' });

    // The title half…
    await search.fill('bear');
    await expect(page.getByRole('listbox').getByRole('option')).toHaveText([
      'None (remove the title)',
      'Bear Necessities (QuestTitle_ABCDE)',
      'The Bear Truth (QuestTitle_17318F)',
    ]);
    // …and the key half.
    await search.fill('17318f');
    await expect(page.getByRole('option', { name: /QuestTitle_17318F/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Bear Necessities/ })).toHaveCount(0);
    // Every list read was the category-restricted server search — never the bare table.
    expect(recorded.nameSearches.length).toBeGreaterThan(0);
    for (const url of recorded.nameSearches) {
      expect(url).toContain('category=QuestTitle');
      expect(url).toContain('limit=50');
    }

    await page.getByRole('option', { name: 'The Bear Truth (QuestTitle_17318F)' }).click();

    await expect(titleTrigger(page)).toHaveText('The Bear Truth (QuestTitle_17318F)');
    const after = await copyPanelDocument(page);
    expect(after.m_questTitle).toBe('QuestTitle_17318F');
    // Only that one key changed.
    expect({ ...after, m_questTitle: before.m_questTitle }).toStrictEqual(before);
  });

  test('fits a 375px viewport with the list open and no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await mockQuestsApi(page, {
      names: { QuestTitle_1ED8D: 'Quest for Perfection' },
      titleRows: [
        { key: 'QuestTitle_17318F', value: 'A very long quest title that has to truncate' },
      ],
    });
    await page.goto('/quests/DS-ACAD1-C01-001');
    await openInfoTab(page);
    await titleTrigger(page).click();
    await expect(page.getByRole('option', { name: /QuestTitle_17318F/ })).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('is operable from the keyboard alone', async ({ page }) => {
    await mockQuestsApi(page, {
      names: { QuestTitle_1ED8D: 'Quest for Perfection' },
      titleRows: [
        { key: 'QuestTitle_1ED8D', value: 'Quest for Perfection' },
        { key: 'QuestTitle_17318F', value: 'The Bear Truth' },
      ],
    });
    await page.goto('/quests/DS-ACAD1-C01-001');
    await openInfoTab(page);
    await openJson(page);

    await titleTrigger(page).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.type('truth');
    await expect(page.getByRole('option', { name: /QuestTitle_17318F/ })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(titleTrigger(page)).toHaveText('The Bear Truth (QuestTitle_17318F)');
    expect((await copyPanelDocument(page)).m_questTitle).toBe('QuestTitle_17318F');
  });

  test('a stored key missing from the table stays shown while other titles are searched', async ({
    page,
  }) => {
    await mockQuestsApi(page, {
      names: {},
      titleRows: [{ key: 'QuestTitle_17318F', value: 'The Bear Truth' }],
    });
    await page.goto('/quests/DS-ACAD1-C01-001');
    await openInfoTab(page);
    await openJson(page);

    await titleTrigger(page).click();
    await page.getByRole('combobox', { name: 'Search quest titles' }).fill('bear');
    await expect(page.getByRole('option', { name: /QuestTitle_17318F/ })).toBeVisible();
    await page.keyboard.press('Escape');

    // Searching is not choosing: the unknown stored key is still what the trigger shows and what
    // the document holds (D57).
    await expect(titleTrigger(page)).toHaveText('QuestTitle_1ED8D');
    expect((await copyPanelDocument(page)).m_questTitle).toBe('QuestTitle_1ED8D');
  });
});

test.describe('edits and the JSON panel', () => {
  test('a number edit shows up in the panel with no refresh, and nothing else moves', async ({
    page,
  }) => {
    await mockQuestsApi(page, { names: { QuestTitle_1ED8D: 'Quest for Perfection' } });
    await page.goto('/quests/DS-ACAD1-C01-001');
    await openInfoTab(page);

    await openJson(page);
    const before = await copyPanelDocument(page);
    expect(before.m_questLevel).toBe(7);

    // No reload, no refetch: the same page instance.
    await editor(page).getByLabel('Quest level (m_questLevel)', { exact: true }).fill('4242');

    const after = await copyPanelDocument(page);
    expect(after.m_questLevel).toBe(4242);
    // Everything else is exactly as it was — including the keys no Info-tab field
    // owns (`m_goals`, `m_goalLogic`, `m_requirements`, `m_dialogList`, …).
    expect({ ...after, m_questLevel: 7 }).toStrictEqual(before);
  });

  test('a checkbox edit writes a boolean and leaves the other keys alone', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');
    await openInfoTab(page);
    await openJson(page);
    const before = await copyPanelDocument(page);

    await editor(page).getByLabel('Hidden (m_isHidden)', { exact: true }).check();
    const after = await copyPanelDocument(page);

    expect(after.m_isHidden).toBe(true);
    expect({ ...after, m_isHidden: false }).toStrictEqual(before);
  });

  test('a tag edit writes an array, and clearing it deletes the key', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');
    await openInfoTab(page);
    await openJson(page);

    await editor(page)
      .getByLabel('Client Tags (m_clientTags)', { exact: true })
      .fill('event,  seasonal');
    let doc = await copyPanelDocument(page);
    expect(doc.m_clientTags).toStrictEqual(['event', 'seasonal']);

    // Emptying a field that exists DELETES the key (D57: never write `''`/undefined).
    await editor(page).getByLabel('Client Tags (m_clientTags)', { exact: true }).fill('');
    doc = await copyPanelDocument(page);
    expect('m_clientTags' in doc).toBe(false);
  });

  test('clearing a string field deletes it, and clearing an absent one is a no-op', async ({
    page,
  }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');
    await openInfoTab(page);
    await openJson(page);

    // `m_questTitle` exists in the fixture.
    await editor(page)
      .getByRole('combobox', { name: 'Quest title (m_questTitle)', exact: true })
      .click();
    await page.getByRole('option', { name: 'None (remove the title)' }).click();
    let doc = await copyPanelDocument(page);
    expect('m_questTitle' in doc).toBe(false);

    // `m_onStartQuestScript` does not: clearing it must not create it.
    await editor(page).getByLabel('Start script (m_onStartQuestScript)', { exact: true }).fill('');
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
    await openInfoTab(page);

    const select = editor(page).getByLabel('Activity type (m_activityType)', { exact: true });
    await expect(select).toHaveValue('ACTIVITY_Crafting');
    // The authoritative six (Imcodec's generated `ActivityType` enum).
    const options = await select.locator('option').allTextContents();
    expect(options).toHaveLength(6);
    expect(options).toContain('Not an activity (ACTIVITY_NotActivity)');
    expect(options).toContain('Crafting activity (ACTIVITY_Crafting)');
    expect(options).toContain('Pet activity (ACTIVITY_Pet)');

    // A value the enum has never heard of stays selectable and selected — real
    // content is never silently rewritten to a listed option.
    await mockQuestsApi(page, {
      detail: { ...MOCK_QUEST, m_activityType: 'ACTIVITY_FutureThing' },
    });
    await page.reload();
    await openInfoTab(page);
    const selectAgain = editor(page).getByLabel('Activity type (m_activityType)', { exact: true });
    await expect(selectAgain).toHaveValue('ACTIVITY_FutureThing');
    await expect(selectAgain.locator('option')).toHaveCount(7);
    await expect(selectAgain.locator('option:checked')).toHaveText(
      'ACTIVITY_FutureThing (unlisted)',
    );
  });
});

test.describe('the detail page’s tabs are all live editors', () => {
  test('mounts every editor, and the one tab whose controls are conditional renders none until used', async ({
    page,
  }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');
    await openInfoTab(page);

    // The Info tab is the editor…
    await expect(editor(page).locator('input').first()).toBeVisible();

    // …the Goals tab is the second live editor as of story p3-04 (its own spec,
    // `quests-goals-editor.spec.ts`, drives it)…
    await main_(page).getByRole('tab', { name: 'Goals' }).click();
    await expect(main_(page).getByRole('region', { name: 'Quest goals editor' })).toBeVisible();

    // …and the Requirements tab is the fourth as of story p3-06 (its own spec,
    // `quests-requirements-editor.spec.ts`, drives it)…
    await main_(page).getByRole('tab', { name: 'Requirements' }).click();
    await expect(
      main_(page).getByRole('region', { name: 'Quest requirements editor' }),
    ).toBeVisible();

    // …and the Results tab is the fifth as of story p3-07 (its own spec,
    // `quests-results-editor.spec.ts`, drives it)…
    await main_(page).getByRole('tab', { name: 'Results' }).click();
    await expect(main_(page).getByRole('region', { name: 'Quest results editor' })).toBeVisible();

    // …and the Dialog tab is the sixth as of story p3-08 (its own spec,
    // `quests-dialog-editor.spec.ts`, drives it). Before p3-08 this test's loop also covered
    // Dialog; the loop is now a single tab, and the reason it stays is a real property rather
    // than a phase boundary: the Goal Logic flowchart (p3-05) is a live editor but renders no
    // plain form control until a node or an edge is opened.
    await main_(page).getByRole('tab', { name: 'Dialog' }).click();
    await expect(main_(page).getByRole('region', { name: 'Quest dialog editor' })).toBeVisible();
    await expect(
      main_(page).getByRole('region', { name: 'Quest dialog list', exact: true }),
    ).toBeVisible();

    for (const tab of ['Goal Logic'] as const) {
      await main_(page).getByRole('tab', { name: tab }).click();
      await expect(
        main_(page).getByRole('tabpanel').locator('input, select, textarea'),
        `${tab} has no plain control until a node is opened`,
      ).toHaveCount(0);
    }
  });

  test('the header Edit button is the real view/edit toggle (story p3-10)', async ({ page }) => {
    await mockQuestsApi(page);
    await page.goto('/quests/DS-ACAD1-C01-001');
    await openInfoTab(page);

    const edit = main_(page).getByRole('button', { name: 'Edit' });
    // Until p3-10 this asserted the opposite (`toBeDisabled()` plus the "Editing arrives in
    // Phase 3" title): the toggle is real now, and edit mode is the load state, so it starts
    // pressed. What the two modes render is `quests-edit-mode.spec.ts`'s subject.
    await expect(edit).toBeEnabled();
    await expect(edit).toHaveAttribute('aria-pressed', 'true');
    await expect(edit).toHaveAttribute('title', 'Switch to view mode');
    await expect(main_(page).getByRole('region', { name: 'Quest info editor' })).toBeVisible();
  });
});
