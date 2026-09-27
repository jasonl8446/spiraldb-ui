import { expect, test, type Page } from '@playwright/test';

/**
 * Story p4-03's tier-1 UI spec (decisions D40/D44): the three simple editors of plan tasks
 * 4.3–4.5, driven against route-mocked API responses.
 *
 * Hermetic by construction: every request the pages make is fulfilled from the fixtures below,
 * so the run reaches neither the dev stack's SQLite file nor the D17 clone. The wire contracts
 * are copied literally (the reason `quests-mocks.ts` and `drop-table-editor.spec.ts` do the same):
 * a fixture that imported `client/src/lib/objects.ts` could only prove the client agrees with
 * itself.
 *
 * The three acceptance criteria, and where each arm is asserted:
 *
 * | AC | arm | test |
 * |---|---|---|
 * | AC1 | the NPC dropdown + chips over item **names**, a raw id staying raw | `AC1` #1 |
 * | AC1 | the multi-select is **searchable** and adds the picked item | `AC1` #2 |
 * | AC1 | chips are removable, and `Inventory` is replaced whole | `AC1` #3 |
 * | AC1 | an empty array renders its empty state and **saves as `[]`** | `AC1` #4 |
 * | AC1 | the save goes through the pipeline (exactly two keys, no invented key) | `AC1` #5 |
 * | AC2 | the repeater renders, and `none (0)` is the label for a stored `0` | `AC2` #1 |
 * | AC2 | **no `GET /api/names/spells/0`** is ever issued for the sentinel | `AC2` #1 |
 * | AC2 | picking `none (0)` stores `0` | `AC2` #2 |
 * | AC2 | `Level` accepts **0** (no `min`, written verbatim) | `AC2` #3 |
 * | AC2 | adding a spell appends the corpus's 3-key entry shape | `AC2` #4 |
 * | AC2 | removing a row leaves the later rows' own values | `AC2` #5 |
 * | AC2 | the save carries exactly two keys and 3-key entries | `AC2` #6 |
 * | AC3 | `DeckName` loads as the key, and a miss stays raw | `AC3` #1 |
 * | AC3 | **reorder changes the array order** | `AC3` #2 |
 * | AC3 | remove then re-add the measured miss by raw id | `AC3` #3 |
 * | AC3 | an empty list renders its empty state and saves as `[]` | `AC3` #4 |
 * | AC3 | the save carries exactly two keys | `AC3` #5 |
 */

/* ------------------------------------------------------------------- fixtures */

/**
 * The three families' descriptors, spelled exactly as `shared/objectTypes.ts` spells them
 * (the same row the server mounts from).
 */
const FAMILIES = {
  npcInventory: {
    urlPath: '/api/npc-inventories',
    routeType: 'npc_inventories',
    objectType: 'npc_inventory',
    fileType: 'npcinventory',
    label: 'NPC Inventories',
    directory: 'NpcInventory',
    keyField: 'TemplateID',
  },
  npcSpellInventory: {
    urlPath: '/api/npc-spell-inventories',
    routeType: 'npc_spell_inventories',
    objectType: 'npc_spell_inventory',
    fileType: 'npcspellinventory',
    label: 'NPC Spell Inventories',
    directory: 'NpcSpellInventory',
    keyField: 'TemplateID',
  },
  creatureSpellbook: {
    urlPath: '/api/creature-spellbooks',
    routeType: 'creature_spellbooks',
    objectType: 'creature_spellbook',
    fileType: 'creaturespellbook',
    label: 'Creature Spellbooks',
    directory: 'CreatureSpellbook',
    keyField: 'DeckName',
  },
} as const;

type FamilyId = keyof typeof FAMILIES;

/** The synced `npcs` rows (integer `template_id`s, as `GET /api/names/npcs` serves them). */
const NPC_ROWS = [
  { template_id: 87112, name: 'Bob the Vendor' },
  { template_id: 1452231, name: 'Trainer Malorn' },
  { template_id: 1025, name: 'Lucky the Merchant' },
];

/**
 * The synced `items` rows. `136239` — one of the corpus's 42 measured misses — is deliberately
 * **absent**, so a chip for it must show the raw id and invent no name.
 */
const ITEM_ROWS = [
  { gid: 1001, name: 'Black Mantle' },
  { gid: 126913, name: 'Spiral Wand' },
  { gid: 126914, name: 'Spiral Shield' },
];

/**
 * The synced `spells` rows. `213674121` is the corpus's single measured spellbook miss
 * (`shared/simpleObjects/creatureSpellbook.ts`) and is deliberately absent here.
 */
const SPELL_ROWS = [
  { template_id: 84361, name: 'Firecat' },
  { template_id: 2106466410, name: 'Sunbird' },
  { template_id: 409737272, name: 'Stormzilla' },
  { template_id: 603728324, name: 'Snow Serpent' },
];

/** The loaded documents, one per family — the real corpus shapes, verbatim key order. */
function defaultDocuments(): Record<FamilyId, Record<string, unknown>> {
  return {
    // One resolvable id and one measured miss; the NPC key resolves too.
    npcInventory: { TemplateID: 87112, Inventory: [1001, 136239] },
    // Level 0 on the first entry (34 real entries carry it) and a real prerequisite on the second.
    npcSpellInventory: {
      TemplateID: 1452231,
      Spells: [
        { TemplateID: 84361, RequiredSpellID: 0, Level: 0 },
        { TemplateID: 2106466410, RequiredSpellID: 84361, Level: 5 },
      ],
    },
    // The middle id is the corpus's real miss.
    creatureSpellbook: {
      DeckName: 'Mdeck-D-R2',
      SpellTemplateIds: [409737272, 213674121, 603728324],
    },
  };
}

interface MockObjectRow {
  key: string;
  title: string;
  modified_at: string | null;
  status: 'extracted' | 'reviewed' | 'verified' | null;
}

function rowsFor(family: FamilyId): MockObjectRow[] {
  switch (family) {
    case 'npcInventory':
      return [
        {
          key: '87112',
          title: '87112',
          modified_at: '2026-06-01T00:00:00.000Z',
          status: 'reviewed',
        },
      ];
    case 'npcSpellInventory':
      return [
        {
          key: '1452231',
          title: '1452231',
          modified_at: '2026-06-01T00:00:00.000Z',
          status: 'extracted',
        },
      ];
    case 'creatureSpellbook':
      return [
        {
          key: 'Mdeck-D-R2',
          title: 'Mdeck-D-R2',
          modified_at: '2026-06-01T00:00:00.000Z',
          status: 'verified',
        },
      ];
  }
}

/** The route key of the loaded document of each family. */
const KEYS: Record<FamilyId, string> = {
  npcInventory: '87112',
  npcSpellInventory: '1452231',
  creatureSpellbook: 'Mdeck-D-R2',
};

interface MockRecorded {
  /** Every `POST /api/<family>` body, with the family it went to. */
  savePosts: Array<{ family: FamilyId; body: Record<string, unknown> }>;
  /** The ids a single-id `GET /api/names/items/:id` fallback asked for. */
  itemLookups: string[];
  /** The ids a single-id `GET /api/names/spells/:id` fallback asked for. */
  spellLookups: string[];
  /** The document each family's detail endpoint currently serves (a test may replace one). */
  served: Record<FamilyId, Record<string, unknown>>;
}

async function mockObjectApi(page: Page): Promise<MockRecorded> {
  const recorded: MockRecorded = {
    savePosts: [],
    itemLookups: [],
    spellLookups: [],
    served: defaultDocuments(),
  };
  let settings: Record<string, string> = {
    aurorium_path: '/mock/aurorium',
    imcodec_path: '/mock/imcodec',
    spiraldb_path: '/mock/spiraldb',
    user_name: 'Mock Reviewer',
    git_branch: 'content/2026-09-26',
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

  // The three names tables the controls search, and their single-id fallbacks.
  await page.route('**/api/names/npcs', (route) => route.fulfill({ json: { npcs: NPC_ROWS } }));
  await page.route('**/api/names/npcs/*', (route) =>
    route.fulfill({ status: 404, json: { error: 'Unknown npcs id' } }),
  );
  await page.route('**/api/names/items', (route) => route.fulfill({ json: { items: ITEM_ROWS } }));
  await page.route('**/api/names/items/*', async (route) => {
    recorded.itemLookups.push(route.request().url().split('/').pop() ?? '');
    await route.fulfill({ status: 404, json: { error: 'Unknown items id' } });
  });
  await page.route('**/api/names/spells', (route) =>
    route.fulfill({ json: { spells: SPELL_ROWS } }),
  );
  await page.route('**/api/names/spells/*', async (route) => {
    recorded.spellLookups.push(route.request().url().split('/').pop() ?? '');
    await route.fulfill({ status: 404, json: { error: 'Unknown spells id' } });
  });

  // Per family: the status join, the list + POST endpoint, and the detail endpoint.
  for (const family of Object.keys(FAMILIES) as FamilyId[]) {
    const config = FAMILIES[family];
    const rows = rowsFor(family);

    await page.route(`**${config.urlPath}`, async (route) => {
      if (route.request().method() === 'POST') {
        const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
        recorded.savePosts.push({ family, body });
        const object = body.object as Record<string, unknown> | undefined;
        const key = String(object?.[config.keyField] ?? KEYS[family]);
        await route.fulfill({
          json: {
            key,
            file_type: config.fileType,
            object_type: config.objectType,
            outcome: 'updated',
            action: 'update',
            commit: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
            branch: settings.git_branch,
            commit_message: `spiraldb: update ${config.objectType} ${key}`,
            file: `${config.directory}/legacy_${key}.json`,
            status: null,
            status_created: false,
            warnings: [],
          },
        });
        return;
      }

      await route.fulfill({
        json: {
          objects: rows,
          summary: {
            total: rows.length,
            extracted: rows.filter((row) => row.status === 'extracted').length,
            reviewed: rows.filter((row) => row.status === 'reviewed').length,
            verified: rows.filter((row) => row.status === 'verified').length,
          },
          skipped: [],
          missing_directory: false,
          duplicate_keys: [],
        },
      });
    });

    await page.route(`**${config.urlPath}/*`, (route) =>
      route.fulfill({ json: recorded.served[family] }),
    );

    await page.route(`**/api/status/${config.routeType}`, (route) =>
      route.fulfill({
        json: {
          entries: rows.map((row) => ({
            object_type: config.objectType,
            object_key: row.key,
            status: row.status ?? 'extracted',
            extracted_at: '2026-06-01T00:00:00.000Z',
            reviewed_at: null,
            verified_at: null,
            latest_notes: null,
          })),
          summary: {
            total: rows.length,
            extracted: rows.filter((row) => row.status === 'extracted').length,
            reviewed: rows.filter((row) => row.status === 'reviewed').length,
            verified: rows.filter((row) => row.status === 'verified').length,
          },
        },
      }),
    );
  }

  return recorded;
}

/* ------------------------------------------------------------------- helpers */

/** `main` — the same scope every other spec uses, so the sidebar cannot satisfy a locator. */
function main(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('main');
}

/** Opens one family's detail page and presses Edit. */
async function openEditor(page: Page, family: FamilyId): Promise<void> {
  await page.goto(`${FAMILIES[family].urlPath.replace('/api', '')}/${KEYS[family]}`);
  await expect(main(page).getByText(KEYS[family], { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('button', { name: 'Edit' })).toBeDisabled();
}

/** The live document, read through the JSON panel's own `[Copy]` affordance (key order included). */
async function liveDocument(page: Page, family: FamilyId): Promise<Record<string, unknown>> {
  const panel = page.getByRole('complementary', { name: `${FAMILIES[family].label} JSON` });
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

/** The document the last save POSTed for one family (the pipeline payload). */
function lastSaved(recorded: MockRecorded, family: FamilyId): Record<string, unknown> {
  const posts = recorded.savePosts.filter((post) => post.family === family);
  expect(posts.length, `no POST /api route for ${family}`).toBeGreaterThan(0);
  return posts[posts.length - 1].body.object as Record<string, unknown>;
}

/** The chips of a multi-select, as text (one entry per chip, document order). */
async function chipTexts(page: Page, name: string): Promise<string[]> {
  return main(page).getByRole('list', { name }).getByRole('listitem').allInnerTexts();
}

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
});

/* --------------------------------------------------------------------- AC1 */

test.describe('AC1 — NpcInventory', () => {
  test('renders the NPC dropdown and chips over item names, leaving a miss raw', async ({
    page,
  }) => {
    await mockObjectApi(page);
    await mockObjectApi(page);
    await openEditor(page, 'npcInventory');

    // The NPC select is the friendly-name dropdown, showing `Name (TemplateID)`.
    await expect(main(page).getByRole('combobox', { name: 'NPC TemplateID' })).toContainText(
      'Bob the Vendor (87112)',
    );

    // The chips render item NAMES, and the unresolved id renders itself (no invented name).
    expect(await chipTexts(page, 'item chips')).toEqual(['Black Mantle', '136239']);
    await expect(main(page).getByRole('button', { name: 'Remove Black Mantle (1)' })).toBeVisible();
    await expect(main(page).getByRole('button', { name: 'Remove 136239 (2)' })).toBeVisible();
  });

  test('adds an item through the searchable multi-select', async ({ page }) => {
    await mockObjectApi(page);
    await openEditor(page, 'npcInventory');

    await main(page).getByRole('combobox', { name: 'Add item' }).click();
    // The popover is PORTALLED (Radix `PopoverPrimitive.Portal`), so its input and options are
    // outside `main` — the same scoping `drop-table-editor.spec.ts` uses for `Search items`.
    await page.getByRole('combobox', { name: 'Search items', exact: true }).fill('Spiral');
    // Searching by name narrows the 79,835-row table to the two Spiral rows.
    await page.getByRole('option', { name: 'Spiral Wand', exact: true }).click();
    // The popover stays open (multi-select) and the picked id is now disabled.
    await page.getByRole('combobox', { name: 'Search items', exact: true }).fill('Spiral Shield');
    await page.getByRole('option', { name: 'Spiral Shield', exact: true }).click();
    await page.keyboard.press('Escape');

    expect(await chipTexts(page, 'item chips')).toEqual([
      'Black Mantle',
      '136239',
      'Spiral Wand',
      'Spiral Shield',
    ]);
    // The document really grew, in the order the chips render (already-selected ids are refused).
    const live = await liveDocument(page, 'npcInventory');
    expect(live.Inventory).toEqual([1001, 136239, 126913, 126914]);
  });

  test('removes exactly the clicked chip and saves Inventory whole', async ({ page }) => {
    const recorded = await mockObjectApi(page);
    await openEditor(page, 'npcInventory');

    await main(page).getByRole('button', { name: 'Remove Black Mantle (1)' }).click();
    expect(await chipTexts(page, 'item chips')).toEqual(['136239']);

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Saved 87112/)).toBeVisible({
      timeout: 15_000,
    });

    const saved = lastSaved(recorded, 'npcInventory');
    // The unresolved id the user kept is still there, raw, and no other key was invented.
    expect(Object.keys(saved)).toEqual(['TemplateID', 'Inventory']);
    expect(saved).toEqual({ TemplateID: 87112, Inventory: [136239] });
  });

  test('renders an empty array as its empty state and saves [] after the last chip goes', async ({
    page,
  }) => {
    const recorded = await mockObjectApi(page);
    // The corpus really has this shape (1 file carries []).
    recorded.served.npcInventory = { TemplateID: 1025, Inventory: [] };
    await page.goto('/npc-inventories/1025');
    await expect(main(page).getByText(/carries an empty Inventory array/)).toBeVisible();

    // A save needs an edit, so prove the empty-array arm from a one-chip file: removing the
    // last chip leaves `[]` and the empty state.
    recorded.served.npcInventory = { TemplateID: 1025, Inventory: [1001] };
    await openEditor(page, 'npcInventory');
    await main(page).getByRole('button', { name: 'Remove Black Mantle (1)' }).click();
    await expect(main(page).getByText(/carries an empty Inventory array/)).toBeVisible();

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Saved 1025/)).toBeVisible({ timeout: 15_000 });

    const saved = lastSaved(recorded, 'npcInventory');
    expect(Object.keys(saved)).toEqual(['TemplateID', 'Inventory']);
    expect(saved.Inventory).toEqual([]);
    // Not null, not a dropped key.
    expect(JSON.stringify(saved)).toContain('"Inventory":[]');
  });
});

/* --------------------------------------------------------------------- AC2 */

test.describe('AC2 — NpcSpellInventory', () => {
  test('renders the repeater, labels a stored 0 "none (0)", and never looks up spell 0', async ({
    page,
  }) => {
    const recorded = await mockObjectApi(page);
    await openEditor(page, 'npcSpellInventory');

    await expect(main(page).getByRole('combobox', { name: 'NPC TemplateID' })).toContainText(
      'Trainer Malorn (1452231)',
    );

    // Row 1: spell resolved by name; RequiredSpellID 0 shows the AC's own label.
    await expect(main(page).getByRole('combobox', { name: 'Spell 1 template' })).toContainText(
      'Firecat',
    );
    await expect(
      main(page).getByRole('combobox', { name: 'Spell 1 required spell' }),
    ).toContainText('none (0)');
    // Row 2: a real prerequisite resolves too.
    await expect(
      main(page).getByRole('combobox', { name: 'Spell 2 required spell' }),
    ).toContainText('Firecat');
    await expect(main(page).getByRole('spinbutton', { name: 'Spell 1 level' })).toHaveValue('0');

    // The sentinel is offered as an **option of its own**, with the AC's exact text — asserted
    // on the option itself, because the trigger would show the placeholder even if the option
    // were mislabelled. (The falsification run is what found that gap.)
    await main(page).getByRole('combobox', { name: 'Spell 1 required spell' }).click();
    await expect(page.getByRole('option', { name: 'none (0)', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    // The sentinel produced no request at all — no `GET /api/names/spells/0`.
    expect(recorded.spellLookups).not.toContain('0');
  });

  test('picking none (0) stores 0 for the row it belongs to', async ({ page }) => {
    const recorded = await mockObjectApi(page);
    await openEditor(page, 'npcSpellInventory');

    await main(page).getByRole('combobox', { name: 'Spell 2 required spell' }).click();
    // Portalled content: the option is outside `main` (as above).
    await page.getByRole('option', { name: 'none (0)', exact: true }).click();

    await expect(
      main(page).getByRole('combobox', { name: 'Spell 2 required spell' }),
    ).toContainText('none (0)');
    const live = await liveDocument(page, 'npcSpellInventory');
    expect((live.Spells as Array<Record<string, unknown>>)[1].RequiredSpellID).toBe(0);
    // Row 1 is untouched, and still no lookup for the sentinel.
    expect((live.Spells as Array<Record<string, unknown>>)[0]).toEqual({
      TemplateID: 84361,
      RequiredSpellID: 0,
      Level: 0,
    });
    expect(recorded.spellLookups).not.toContain('0');
  });

  test('accepts Level 0 and writes it verbatim', async ({ page }) => {
    await mockObjectApi(page);
    await openEditor(page, 'npcSpellInventory');

    // The control carries no `min` at all: 0 is a measured real level.
    const level = main(page).getByRole('spinbutton', { name: 'Spell 2 level' });
    // No `min` attribute at all — a `min={1}` would reject a measured real level.
    expect(await level.getAttribute('min')).toBeNull();

    await level.fill('0');
    const live = await liveDocument(page, 'npcSpellInventory');
    expect((live.Spells as Array<Record<string, unknown>>)[1]).toEqual({
      TemplateID: 2106466410,
      RequiredSpellID: 84361,
      Level: 0,
    });
  });

  test('appends a corpus-shaped entry when a spell is picked, and removes by row', async ({
    page,
  }) => {
    await mockObjectApi(page);
    await openEditor(page, 'npcSpellInventory');

    await main(page).getByRole('combobox', { name: 'Add spell' }).click();
    // Portalled content: the option is outside `main` (as above).
    await page.getByRole('option', { name: 'Snow Serpent', exact: true }).click();

    let live = await liveDocument(page, 'npcSpellInventory');
    expect(live.Spells).toEqual([
      { TemplateID: 84361, RequiredSpellID: 0, Level: 0 },
      { TemplateID: 2106466410, RequiredSpellID: 84361, Level: 5 },
      // The new entry is the corpus's exact three-key shape, in the corpus's order.
      { TemplateID: 603728324, RequiredSpellID: 0, Level: 1 },
    ]);
    expect(Object.keys((live.Spells as Array<Record<string, unknown>>)[2])).toEqual([
      'TemplateID',
      'RequiredSpellID',
      'Level',
    ]);

    // Removing row 2 leaves row 3's own values in row 2's place.
    await main(page).getByRole('button', { name: 'Remove spell 2' }).click();
    live = await liveDocument(page, 'npcSpellInventory');
    expect(live.Spells).toEqual([
      { TemplateID: 84361, RequiredSpellID: 0, Level: 0 },
      { TemplateID: 603728324, RequiredSpellID: 0, Level: 1 },
    ]);
  });

  test('saves exactly two document keys and three entry keys', async ({ page }) => {
    const recorded = await mockObjectApi(page);
    await openEditor(page, 'npcSpellInventory');

    await main(page).getByRole('spinbutton', { name: 'Spell 1 level' }).fill('7');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Saved 1452231/)).toBeVisible({ timeout: 15_000 });

    const saved = lastSaved(recorded, 'npcSpellInventory');
    expect(Object.keys(saved)).toEqual(['TemplateID', 'Spells']);
    const entries = saved.Spells as Array<Record<string, unknown>>;
    expect(entries.length).toBe(2);
    for (const entry of entries) {
      expect(Object.keys(entry)).toEqual(['TemplateID', 'RequiredSpellID', 'Level']);
    }
    expect(entries[0].Level).toBe(7);
    expect(entries[1]).toEqual({ TemplateID: 2106466410, RequiredSpellID: 84361, Level: 5 });
  });
});

/* --------------------------------------------------------------------- AC3 */

test.describe('AC3 — CreatureSpellbook', () => {
  test('renders DeckName as the key and leaves the one miss raw', async ({ page }) => {
    const recorded = await mockObjectApi(page);
    await openEditor(page, 'creatureSpellbook');

    await expect(main(page).getByRole('textbox', { name: 'Deck name' })).toHaveValue('Mdeck-D-R2');
    // Row 2 is the corpus's measured miss: the single-id fallback 404s and the raw id shows.
    await expect(main(page).getByRole('combobox', { name: 'Spell 2' })).toContainText('213674121');
    expect(recorded.spellLookups).toContain('213674121');
    await expect(main(page).getByRole('combobox', { name: 'Spell 3' })).toContainText(
      'Snow Serpent',
    );
  });

  test('reorders the list, changing the array order', async ({ page }) => {
    await mockObjectApi(page);
    await openEditor(page, 'creatureSpellbook');

    // The ends are disabled, so a move can never be a no-op by accident.
    await expect(main(page).getByRole('button', { name: 'Move spell 1 up' })).toBeDisabled();
    await expect(main(page).getByRole('button', { name: 'Move spell 3 down' })).toBeDisabled();

    await main(page).getByRole('button', { name: 'Move spell 1 down' }).click();
    let live = await liveDocument(page, 'creatureSpellbook');
    expect(live.SpellTemplateIds).toEqual([213674121, 409737272, 603728324]);
    // The rendered order followed the array.
    await expect(main(page).getByRole('combobox', { name: 'Spell 1' })).toContainText('213674121');
    await expect(main(page).getByRole('combobox', { name: 'Spell 2' })).toContainText('Stormzilla');

    await main(page).getByRole('button', { name: 'Move spell 2 up' }).click();
    live = await liveDocument(page, 'creatureSpellbook');
    expect(live.SpellTemplateIds).toEqual([409737272, 213674121, 603728324]);
  });

  test('removes a row and re-adds the miss by its raw id', async ({ page }) => {
    await mockObjectApi(page);
    await openEditor(page, 'creatureSpellbook');

    await main(page).getByRole('button', { name: 'Remove spell 2' }).click();
    let live = await liveDocument(page, 'creatureSpellbook');
    expect(live.SpellTemplateIds).toEqual([409737272, 603728324]);

    // The name search cannot reach the miss, so the raw-id box is the only way back.
    await main(page).getByLabel('Add a spell id').fill('213674121');
    await main(page).getByRole('button', { name: 'Add id' }).click();
    live = await liveDocument(page, 'creatureSpellbook');
    expect(live.SpellTemplateIds).toEqual([409737272, 603728324, 213674121]);
  });

  test('renders an empty list as its empty state and saves [] after the last one goes', async ({
    page,
  }) => {
    const recorded = await mockObjectApi(page);
    // The corpus really has this shape (9 files carry []).
    recorded.served.creatureSpellbook = { DeckName: 'Mdeck-Empty', SpellTemplateIds: [] };
    await page.goto('/creature-spellbooks/Mdeck-Empty');
    await expect(main(page).getByText(/carries an empty SpellTemplateIds array/)).toBeVisible();

    // A save needs an edit, so prove the [] arm from a one-spell deck.
    recorded.served.creatureSpellbook = { DeckName: 'Mdeck-One', SpellTemplateIds: [409737272] };
    await page.goto('/creature-spellbooks/Mdeck-One');
    await page.getByRole('button', { name: 'Edit' }).click();
    await main(page).getByRole('button', { name: 'Remove spell 1' }).click();
    await expect(main(page).getByText(/carries an empty SpellTemplateIds array/)).toBeVisible();

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Saved Mdeck-One/)).toBeVisible({ timeout: 15_000 });

    const saved = lastSaved(recorded, 'creatureSpellbook');
    expect(Object.keys(saved)).toEqual(['DeckName', 'SpellTemplateIds']);
    expect(saved.SpellTemplateIds).toEqual([]);
    expect(JSON.stringify(saved)).toContain('"SpellTemplateIds":[]');
  });

  test('saves exactly two document keys, with the reordered array', async ({ page }) => {
    const recorded = await mockObjectApi(page);
    await openEditor(page, 'creatureSpellbook');

    await main(page).getByRole('button', { name: 'Move spell 3 up' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Saved Mdeck-D-R2/)).toBeVisible({ timeout: 15_000 });

    const saved = lastSaved(recorded, 'creatureSpellbook');
    expect(Object.keys(saved)).toEqual(['DeckName', 'SpellTemplateIds']);
    expect(saved).toEqual({
      DeckName: 'Mdeck-D-R2',
      SpellTemplateIds: [409737272, 603728324, 213674121],
    });
  });
});
