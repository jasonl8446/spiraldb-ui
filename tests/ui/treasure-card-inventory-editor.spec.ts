import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Story p4-05's tier-1 UI spec (decisions D40/D44): plan task 4.7's `TreasureCardInventory`
 * editor and the one warn-not-block rule the phase's AC#11 names
 * (docs/spec-domain-reference.md L183-208, L542-546).
 *
 * Hermetic by construction: every request the page makes is fulfilled from the fixtures below,
 * so the run reaches neither the dev stack's SQLite file nor the D17 clone. The wire contracts
 * are copied literally (the reason `quests-mocks.ts`, `drop-table-editor.spec.ts`,
 * `simple-object-editors.spec.ts` and `npc-drop-table-editor.spec.ts` do the same): a fixture
 * that imported `client/src/lib/objects.ts` could only prove the client agrees with itself.
 *
 * | AC1's words | arm | test |
 * |---|---|---|
 * | "NPC dropdown" | the friendly-name select shows `Name (TemplateID)` | repeater #1 |
 * | "the `{SpellName, Price}` repeater" | one row per entry, its own name box and price box | repeater #1 |
 * | "…works" (add) | the Add box appends a **new entry object** at the corpus's common price | repeater #2 |
 * | "…works" (add) | a blank typed name is refused (nothing appended) | repeater #2 |
 * | "…works" (remove) | removal is **index**-addressed, so a repeated name survives | repeater #3 |
 * | "Price 0 shows the … `m_baseCost` hint" | the hint appears exactly for `Price 0` | hint #1 |
 * | "Price 0 …" | typing `0` into a price box makes it appear; typing another price removes it | hint #2 |
 * | "SpellName not present in synced spells → warning" | one warning on the offending row, none on a matching row | warning #1 |
 * | "…(not blocking); Save succeeds" | Save is **enabled** with the warning present and the save lands | warning #2 |
 * | "Save succeeds" (matching names) | no warning, no summary, and the save still lands | warning #3 |
 * | the save body | exactly the document's two keys and each row's two keys | save #1 |
 *
 * ## The two fixture-only arms, said plainly
 *
 * - **`Price 0` never occurs in the corpus.** All 71 real prices are in {100, 150, 200, 250}
 *   (`shared/simpleObjects/treasureCardInventory.ts`), so both hint arms are exercised by a
 *   fixture and the fact is asserted here as a fixture note, never as corpus data.
 * - **A matching name against the real corpus would be a 0-row case.** The one real file's 71
 *   names are all `"… TC"` variants, so with the real `spells` table the editor shows 71
 *   warnings (the unit sweep measures exactly that). This spec's fixture spells table holds the
 *   **base** names, which is what makes a matching-name arm reachable: it proves the rule
 *   compares literally (a base name matches, its `" TC"` variant does not) without pretending
 *   the corpus has such a row.
 *
 * The live half of the story — 71 warnings on the real file, none blocking, saved into the D17
 * clone from a fresh-port rig — cannot run in a hermetic spec, so it is the story's evidence
 * run (`docs/evidence/phase-4/p4-05-live-*.txt`), with the clone restored afterwards.
 */

/* ------------------------------------------------------------------- fixtures */

/** The family descriptor, spelled exactly as `shared/objectTypes.ts` spells it. */
const FAMILY = {
  label: 'Treasure Card Inventories',
  urlPath: '/api/treasure-card-inventories',
  routeType: 'treasure_card_inventories',
  objectType: 'treasure_card_inventory',
  fileType: 'treasurecardinventory',
  directory: 'TreasureCardInventory',
  keyField: 'TemplateID',
  key: '38214',
} as const;

/** The synced `npcs` rows (as `GET /api/names/npcs` serves them). */
const NPC_ROWS = [{ template_id: 38214, name: 'Bob the Vendor' }];

/**
 * The synced `spells` rows — the reference set the warn rule matches against, and the reason a
 * *matching* name is reachable in this spec: these are the **base** names, and the corpus's own
 * `"… TC"` variant is deliberately absent from them (0 of the 18,173 real rows ends in `" TC"`).
 */
const SPELL_ROWS = [
  { template_id: 84361, name: 'Fire Shield' },
  { template_id: 2106466410, name: 'Fire Cat' },
  { template_id: 409737272, name: 'Meteor Strike' },
];

/**
 * The loaded document: two matching names and one row that exercises the AC's two cases at
 * once — a name no synced spell carries (`"Fire Shield TC"`, the real file's own variant form)
 * and `Price 0`, which no corpus file has.
 */
const DOCUMENT: Record<string, unknown> = {
  TemplateID: 38214,
  TreasureCards: [
    { SpellName: 'Fire Shield', Price: 100 },
    { SpellName: 'Fire Cat', Price: 150 },
    { SpellName: 'Fire Shield TC', Price: 0 },
  ],
};

interface MockRecorded {
  /** Every `POST /api/treasure-card-inventories` body. */
  savePosts: Array<Record<string, unknown>>;
  /** The document the detail endpoint currently serves (a test may replace one). */
  served: Record<string, unknown>;
}

/** Fulfils every request the shell and the two pages make. */
async function mockObjectApi(page: Page): Promise<MockRecorded> {
  const recorded: MockRecorded = {
    savePosts: [],
    served: JSON.parse(JSON.stringify(DOCUMENT)) as Record<string, unknown>,
  };
  let settings: Record<string, string> = {
    aurorium_path: '/mock/aurorium',
    imcodec_path: '/mock/imcodec',
    spiraldb_path: '/mock/spiraldb',
    user_name: 'Mock Reviewer',
    git_branch: 'content/2026-09-27',
  };

  // The shell's own boot reads (Header, the identity gate, the import toast).
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() === 'PUT') {
      settings = {
        ...settings,
        ...((route.request().postDataJSON() ?? {}) as Record<string, string>),
      };
    }
    await route.fulfill({ json: settings });
  });
  await page.route('**/api/sync/status', (route) =>
    route.fulfill({ json: { last_sync: null, revision: null, status: 'never' } }),
  );
  await page.route('**/api/sync/history', (route) => route.fulfill({ json: { history: [] } }));
  await page.route('**/api/status/_import', (route) =>
    route.fulfill({ json: { ran: false, imported: 0, imported_at: null } }),
  );

  // The two names tables the page reads (the NPC dropdown and the warn rule's reference set).
  await page.route('**/api/names/npcs', (route) => route.fulfill({ json: { npcs: NPC_ROWS } }));
  await page.route('**/api/names/npcs/*', (route) =>
    route.fulfill({ status: 404, json: { error: 'Unknown npcs id' } }),
  );
  await page.route('**/api/names/spells', (route) =>
    route.fulfill({ json: { spells: SPELL_ROWS } }),
  );

  // The family's list + POST endpoint.
  await page.route(`**${FAMILY.urlPath}`, async (route) => {
    if (route.request().method() === 'POST') {
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      recorded.savePosts.push(body);
      const object = body.object as Record<string, unknown> | undefined;
      const key = String(object?.[FAMILY.keyField] ?? FAMILY.key);
      await route.fulfill({
        json: {
          key,
          file_type: FAMILY.fileType,
          object_type: FAMILY.objectType,
          outcome: 'updated',
          action: 'update',
          commit: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
          branch: settings.git_branch,
          commit_message: `spiraldb: update ${FAMILY.objectType} ${key}`,
          file: `${FAMILY.directory}/NpcTreasureCards_2019-A.json`,
          status: null,
          status_created: false,
          warnings: [],
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        objects: [
          {
            key: FAMILY.key,
            title: FAMILY.key,
            modified_at: '2026-09-24T15:22:00.000Z',
            status: 'extracted',
          },
        ],
        summary: { total: 1, extracted: 1, reviewed: 0, verified: 0 },
        skipped: [],
        missing_directory: false,
        duplicate_keys: [],
      },
    });
  });

  await page.route(`**${FAMILY.urlPath}/*`, (route) => route.fulfill({ json: recorded.served }));

  await page.route(`**/api/status/${FAMILY.routeType}`, (route) =>
    route.fulfill({
      json: {
        entries: [
          {
            object_type: FAMILY.objectType,
            object_key: FAMILY.key,
            status: 'extracted',
            extracted_at: '2026-09-24T15:22:00.000Z',
            reviewed_at: null,
            verified_at: null,
            latest_notes: null,
          },
        ],
        summary: { total: 1, extracted: 1, reviewed: 0, verified: 0 },
      },
    }),
  );

  return recorded;
}

/* ------------------------------------------------------------------- helpers */

/** `main` — the same scope every other spec uses, so the sidebar cannot satisfy a locator. */
function main(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('main');
}

/** Opens the detail page and presses Edit (the object pages load in view mode). */
async function openEditor(page: Page): Promise<void> {
  await page.goto(`${FAMILY.urlPath.replace('/api', '')}/${FAMILY.key}`);
  await expect(main(page).getByText(FAMILY.key, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('button', { name: 'Edit' })).toBeDisabled();
}

/** The live document, read through the JSON panel's own `[Copy]` affordance (key order included). */
async function liveDocument(page: Page): Promise<Record<string, unknown>> {
  const panel = page.getByRole('complementary', { name: `${FAMILY.label} JSON` });
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
  return JSON.parse(text) as Record<string, unknown>;
}

/** The one save body the mocked POST received. */
function lastSaved(recorded: MockRecorded): Record<string, unknown> {
  expect(recorded.savePosts.length, 'no POST /api/treasure-card-inventories').toBeGreaterThan(0);
  return recorded.savePosts[recorded.savePosts.length - 1].object as Record<string, unknown>;
}

/** The inline validation messages of one row's name box. */
function rowMessage(page: Page, index: number): ReturnType<Page['locator']> {
  return main(page)
    .getByRole('article', { name: `Treasure card ${index}` })
    .locator('li[data-field="TreasureCards[' + (index - 1) + '].SpellName"]');
}

/** The rows' name boxes, in document order. */
function nameBoxes(page: Page): ReturnType<Page['getByRole']> {
  return main(page).getByRole('textbox', { name: /^Treasure card \d+ spell name$/ });
}

/** The rows' price boxes, in document order. */
function priceBoxes(page: Page): ReturnType<Page['getByRole']> {
  return main(page).getByRole('spinbutton', { name: /^Treasure card \d+ price$/ });
}

/** The input values of a locator, in DOM order. */
async function inputValues(locator: Locator): Promise<string[]> {
  return locator.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLInputElement).value),
  );
}

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
});

/* ------------------------------------------------------------------- the repeater */

test.describe('AC1 — the TreasureCards repeater', () => {
  test('renders the NPC dropdown and one row per entry, each with its own two controls', async ({
    page,
  }) => {
    await mockObjectApi(page);
    await openEditor(page);

    await expect(main(page).getByRole('combobox', { name: 'NPC TemplateID' })).toContainText(
      'Bob the Vendor (38214)',
    );

    // Three rows, in document order, with the document's own values (no trim, no normalising).
    await expect(nameBoxes(page)).toHaveCount(3);
    await expect(priceBoxes(page)).toHaveCount(3);
    expect(await inputValues(nameBoxes(page))).toEqual([
      'Fire Shield',
      'Fire Cat',
      'Fire Shield TC',
    ]);
    expect(await inputValues(priceBoxes(page))).toEqual(['100', '150', '0']);

    // The rows' accessible names are index-addressed, so a spec (or a screen reader) can reach
    // one row without depending on its value.
    await expect(main(page).getByRole('article', { name: 'Treasure card 2' })).toBeVisible();
    await expect(main(page).getByRole('button', { name: 'Remove treasure card 3' })).toBeVisible();
  });

  test('appends a typed name as a new entry object, and refuses a blank add', async ({ page }) => {
    await mockObjectApi(page);
    await openEditor(page);

    // A blank add is a no-op: nothing appended (`textIdFromRaw`'s own rule).
    await main(page).getByRole('button', { name: 'Add treasure card' }).click();
    await expect(nameBoxes(page)).toHaveCount(3);

    // A typed name is stored VERBATIM — including one no synced spell carries, which is the
    // case the warning exists for.
    await main(page).getByRole('textbox', { name: 'New treasure card name' }).fill('Meteor Strike');
    await main(page).getByRole('button', { name: 'Add treasure card' }).click();

    await expect(nameBoxes(page)).toHaveCount(4);
    expect(await inputValues(nameBoxes(page))).toEqual([
      'Fire Shield',
      'Fire Cat',
      'Fire Shield TC',
      'Meteor Strike',
    ]);
    // The appended row carries the corpus's most frequent price and the corpus's exact key order.
    const live = await liveDocument(page);
    const entries = live.TreasureCards as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(4);
    expect(Object.keys(entries[3])).toEqual(['SpellName', 'Price']);
    expect(entries[3]).toEqual({ SpellName: 'Meteor Strike', Price: 100 });
    // The Add box cleared itself, and the new row matches (no warning for it).
    await expect(main(page).getByRole('textbox', { name: 'New treasure card name' })).toHaveValue(
      '',
    );
  });

  test('removes the clicked row by index, so a repeated name survives', async ({ page }) => {
    const recorded = await mockObjectApi(page);
    // A repeater can repeat a name: a value-based removal would collapse the duplicate. This
    // fixture repeats row 1's name in row 3, which is what makes the distinction observable.
    recorded.served = {
      TemplateID: 38214,
      TreasureCards: [
        { SpellName: 'Fire Shield', Price: 100 },
        { SpellName: 'Fire Cat', Price: 150 },
        { SpellName: 'Fire Shield', Price: 250 },
      ],
    };
    await openEditor(page);

    await main(page).getByRole('button', { name: 'Remove treasure card 3' }).click();

    // Rows 1 and 2 keep their own values: index 2 went, index 0 stayed.
    await expect(nameBoxes(page)).toHaveCount(2);
    expect(await inputValues(nameBoxes(page))).toEqual(['Fire Shield', 'Fire Cat']);
    expect(await inputValues(priceBoxes(page))).toEqual(['100', '150']);

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Saved 38214/)).toBeVisible({ timeout: 15_000 });
    const saved = lastSaved(recorded);
    expect((saved.TreasureCards as unknown[]).length).toBe(2);
    expect(saved.TreasureCards).toEqual([
      { SpellName: 'Fire Shield', Price: 100 },
      { SpellName: 'Fire Cat', Price: 150 },
    ]);
  });
});

/* ---------------------------------------------------------------- the Price 0 hint */

test.describe('AC1 — the Price 0 hint', () => {
  test('shows the m_baseCost hint on a 0 row and on that row only', async ({ page }) => {
    await mockObjectApi(page);
    await openEditor(page);

    // Row 3 carries the fixture-only Price 0 — the corpus's 71 prices are 100/150/200/250.
    const hint = main(page).getByText(/uses the spell template’s m_baseCost/);
    await expect(hint).toHaveCount(1);
    await expect(
      main(page)
        .getByRole('article', { name: 'Treasure card 3' })
        .getByText(/uses the spell template’s m_baseCost/),
    ).toBeVisible();
    // Rows 1 and 2 are priced, and show the price's own help text instead of the hint.
    await expect(
      main(page).getByRole('article', { name: 'Treasure card 1' }).locator('[data-price-hint]'),
    ).toHaveCount(0);
    await expect(main(page).getByText(/The corpus’s prices are 100, 150, 200 and 250/)).toHaveCount(
      3,
    );
  });

  test('appears when a price is set to 0 and disappears when it is not', async ({ page }) => {
    await mockObjectApi(page);
    await openEditor(page);

    // Row 1 starts at 100: no hint.
    await expect(
      main(page).getByRole('article', { name: 'Treasure card 1' }).locator('[data-price-hint]'),
    ).toHaveCount(0);

    await priceBoxes(page).nth(0).fill('0');
    await expect(
      main(page)
        .getByRole('article', { name: 'Treasure card 1' })
        .getByText(/uses the spell template’s m_baseCost/),
    ).toBeVisible();
    await expect(main(page).getByText(/uses the spell template’s m_baseCost/)).toHaveCount(2);

    await priceBoxes(page).nth(0).fill('120');
    await expect(main(page).getByText(/uses the spell template’s m_baseCost/)).toHaveCount(1);

    // An emptied price box writes the schema's own 0 (the two-key entry shape is 71/71), so the
    // hint appears rather than the key disappearing.
    await priceBoxes(page).nth(1).fill('');
    await expect(main(page).getByText(/uses the spell template’s m_baseCost/)).toHaveCount(2);
    const live = await liveDocument(page);
    const entries = live.TreasureCards as Array<Record<string, unknown>>;
    expect(entries[1]).toEqual({ SpellName: 'Fire Cat', Price: 0 });
    expect(Object.keys(entries[1])).toEqual(['SpellName', 'Price']);
  });
});

/* ------------------------------------------------------------- the warn-not-block rule */

test.describe('AC1 — a name no synced spell carries warns, and does not block', () => {
  test('warns on the offending row and only there', async ({ page }) => {
    await mockObjectApi(page);
    await openEditor(page);

    // Exactly one warning, on row 3's name box, carrying the finding's own kind and severity.
    const warnings = main(page).locator('li[data-severity="warning"]');
    await expect(warnings).toHaveCount(1);
    await expect(warnings.first()).toHaveAttribute('data-kind', 'spell-name-not-in-spells');
    await expect(warnings.first()).toHaveAttribute('data-field', 'TreasureCards[2].SpellName');
    await expect(warnings.first()).toContainText('"Fire Shield TC" is not a synced spell name');
    await expect(warnings.first()).toContainText('not an error');
    await expect(
      main(page)
        .getByRole('article', { name: 'Treasure card 3' })
        .getByText(/is not a synced/),
    ).toBeVisible();
    // The rows whose names match are clean.
    await expect(rowMessage(page, 1)).toHaveCount(0);
    await expect(rowMessage(page, 2)).toHaveCount(0);
    // The form-level summary counts the same findings and says they do not block.
    await expect(main(page).locator('[data-warning-count="1"]')).toContainText(
      '1 row warns and none of them blocks saving.',
    );
    // …and no error-severity message exists anywhere, which is what "not blocking" means.
    await expect(main(page).locator('li[data-severity="error"]')).toHaveCount(0);
  });

  test('the Save button stays enabled with the warning present, and the save succeeds', async ({
    page,
  }) => {
    const recorded = await mockObjectApi(page);
    await openEditor(page);

    // The warning is on the loaded document, before any edit.
    await expect(main(page).locator('li[data-severity="warning"]')).toHaveCount(1);

    // Save is clean-but-disabled until there is a change (the layout's own rule) — not blocked.
    const save = page.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute('title', 'No changes to save');
    await expect(save).not.toHaveAttribute('aria-disabled', 'true');

    // One unrelated edit (a matching row's price) makes the document dirty…
    await priceBoxes(page).nth(0).fill('120');
    // …and Save is still enabled, with the warning still shown: the warning does not block.
    await expect(main(page).locator('li[data-severity="warning"]')).toHaveCount(1);
    await expect(save).toBeEnabled();
    await expect(save).not.toHaveAttribute('aria-disabled', 'true');

    await save.click();
    await expect(page.getByText(/Saved 38214/)).toBeVisible({ timeout: 15_000 });

    // The save landed with the offending name written verbatim (never renamed, never dropped).
    const saved = lastSaved(recorded);
    const entries = saved.TreasureCards as Array<Record<string, unknown>>;
    expect(entries[2]).toEqual({ SpellName: 'Fire Shield TC', Price: 0 });
  });

  test('a matching name shows no warning at all, and the save still lands', async ({ page }) => {
    const recorded = await mockObjectApi(page);
    // Every row matches the synced spells, and none is priced 0 (the corpus's own shape).
    recorded.served = {
      TemplateID: 38214,
      TreasureCards: [
        { SpellName: 'Fire Shield', Price: 100 },
        { SpellName: 'Fire Cat', Price: 150 },
        { SpellName: 'Meteor Strike', Price: 250 },
      ],
    };
    await openEditor(page);

    await expect(main(page).locator('li[data-severity="warning"]')).toHaveCount(0);
    await expect(main(page).locator('[data-warning-count]')).toHaveCount(0);
    await expect(main(page).getByText(/rows warn and none of them blocks/)).toHaveCount(0);

    await priceBoxes(page).nth(2).fill('260');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Saved 38214/)).toBeVisible({ timeout: 15_000 });
    expect((lastSaved(recorded).TreasureCards as Array<Record<string, unknown>>)[2]).toEqual({
      SpellName: 'Meteor Strike',
      Price: 260,
    });
  });

  test('says so when the synced spells table is not available, instead of showing a clean pass', async ({
    page,
  }) => {
    // The D65(c) arm: an empty/unimported table means "this side cannot check", and the form
    // says the match did not run rather than implying every name is fine.
    await page.route('**/api/settings', (route) =>
      route.fulfill({
        json: {
          aurorium_path: '/mock/aurorium',
          imcodec_path: '/mock/imcodec',
          spiraldb_path: '/mock/spiraldb',
          user_name: 'Mock Reviewer',
          git_branch: 'content/2026-09-27',
        },
      }),
    );
    await page.route('**/api/sync/status', (route) =>
      route.fulfill({ json: { last_sync: null, revision: null, status: 'never' } }),
    );
    await page.route('**/api/sync/history', (route) => route.fulfill({ json: { history: [] } }));
    await page.route('**/api/status/_import', (route) =>
      route.fulfill({ json: { ran: false, imported: 0, imported_at: null } }),
    );
    await page.route('**/api/names/npcs', (route) => route.fulfill({ json: { npcs: NPC_ROWS } }));
    await page.route('**/api/names/spells', (route) => route.fulfill({ json: { spells: [] } }));
    await page.route(`**${FAMILY.urlPath}`, (route) =>
      route.fulfill({
        json: {
          objects: [],
          summary: { total: 0, extracted: 0, reviewed: 0, verified: 0 },
          skipped: [],
          missing_directory: false,
          duplicate_keys: [],
        },
      }),
    );
    await page.route(`**${FAMILY.urlPath}/*`, (route) =>
      route.fulfill({ json: DOCUMENT as unknown as Record<string, unknown> }),
    );
    await page.route(`**/api/status/${FAMILY.routeType}`, (route) =>
      route.fulfill({
        json: { entries: [], summary: { total: 0, extracted: 0, reviewed: 0, verified: 0 } },
      }),
    );

    await openEditor(page);

    await expect(main(page).locator('li[data-severity="warning"]')).toHaveCount(0);
    await expect(main(page).locator('[data-reference-used="false"]')).toContainText(
      'The synced spells table is not loaded, so spell names were not checked.',
    );
  });
});

/* ---------------------------------------------------------------------- the save body */

test.describe('AC1 — the save payload', () => {
  test('carries exactly two top-level keys and each row\u2019s two keys', async ({ page }) => {
    const recorded = await mockObjectApi(page);
    await openEditor(page);

    await nameBoxes(page).nth(0).fill('Fire Shield TC');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Saved 38214/)).toBeVisible({ timeout: 15_000 });

    const saved = lastSaved(recorded);
    expect(Object.keys(saved)).toEqual(['TemplateID', 'TreasureCards']);
    expect(typeof saved.TemplateID).toBe('number');
    const entries = saved.TreasureCards as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(3);
    for (const entry of entries) {
      expect(Object.keys(entry)).toEqual(['SpellName', 'Price']);
      expect(typeof entry.SpellName).toBe('string');
      expect(typeof entry.Price).toBe('number');
    }
    // The edited name is written verbatim, and the untouched rows are unchanged (key order too).
    expect(entries).toEqual([
      { SpellName: 'Fire Shield TC', Price: 100 },
      { SpellName: 'Fire Cat', Price: 150 },
      { SpellName: 'Fire Shield TC', Price: 0 },
    ]);
  });
});
