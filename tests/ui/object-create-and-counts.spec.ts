import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Story p4-09's tier-1 UI spec (decisions D40/D44/D23-tier-1): plan task 4.11's AC1 (the six list
 * counts + NpcDropTable's empty state) and AC3 (create an entry via UI).
 *
 * Hermetic by construction: every request is fulfilled from the fixtures below, so the run reaches
 * neither the dev stack's SQLite file nor the D17 clone. The wire contracts are copied literally
 * (the reason `object-list.spec.ts`, `quests-mocks.ts` and `simple-object-editors.spec.ts` do the
 * same): a fixture that imported the client's own modules could only prove the client agrees with
 * itself.
 *
 * | AC | arm |
 * |---|---|
 * | AC1 | per family: the All tab badge and the pagination line carry the family's verified count |
 * | AC1 | ZoneTransfer: the list answers its **1205 rows** — `1207` is the *file* count (AC1's own unit), proved by `tests/unit/object-list-counts.test.ts` and the D1 sweep — and the page renders the two collapsed duplicate keys as a notice |
 * | AC1 | NpcDropTable: `missing_directory: true` + 0 rows renders the empty state and the absent-directory notice, with **no** table header (D72f) |
 * | AC3 | per family: `New <singular>` → the key control → `Will create <exact fileNameFor name>` → Create posts **exactly** `{ object }` (no `key`) → the success toast names the `spiraldb: create …` commit → the app lands on the new entry's detail route |
 *
 * What this spec deliberately does **not** claim: that the server really commits. The POST is
 * mocked here (that is what "hermetic tier-1" means), so the create's live half — the file at the
 * convention name, the `create` commit, the `extracted` status row — is the story's fresh-port
 * clone run, and D76(a)'s rule (a write AC needs an arm driving the client's own body through the
 * **real** route) is satisfied there by the same shared builder this dialog calls.
 */

/* ------------------------------------------------------------------ the family fixtures */

interface FamilyFixture {
  /** Frontend route of the list page. */
  readonly routePath: string;
  /** The family's API base path. */
  readonly apiPath: string;
  /** The D4 plural status route (the detail page's status read). */
  readonly statusRoute: string;
  /** The D4 singular `entry_status.object_type` (the commit message). */
  readonly objectType: string;
  /** The `New <singular>` button's accessible name. */
  readonly newButton: string;
  /** The key control's accessible name — `shared/objectCreate.ts`'s `keyLabel`. */
  readonly keyLabel: string;
  /** The key typed into the dialog. */
  readonly keyInput: string;
  /** The canonical key the server would answer with. */
  readonly createdKey: string;
  /** The exact `fileNameFor` name the preview must show. */
  readonly fileName: string;
  /** The document the POST body must carry, literally. */
  readonly document: Record<string, unknown>;
  /** The list's row count (what the tab badge and pagination show). */
  readonly listRows: number;
  /** `missing_directory` in the list response (NpcDropTable only). */
  readonly missingDirectory?: boolean;
  /** `duplicate_keys` in the list response (ZoneTransfer only). */
  readonly duplicateKeys?: readonly string[];
  /** The directory named in the absent-directory notice. */
  readonly directory: string;
  /** The empty state's sentence (`No NPC inventories found.`). */
  readonly emptyState: string;
}

const FAMILIES: readonly FamilyFixture[] = [
  {
    routePath: '/drop-tables',
    apiPath: '/api/drop-tables',
    statusRoute: 'drop_tables',
    objectType: 'drop_table',
    newButton: 'New drop table',
    keyLabel: 'Drop table name',
    keyInput: 'WC-UNICORN-MAIN-007',
    createdKey: 'WC-UNICORN-MAIN-007',
    fileName: 'droptable_WC-UNICORN-MAIN-007.json',
    document: {
      Name: 'WC-UNICORN-MAIN-007',
      Description: '',
      RollChance: 1,
      Weight: 100,
      NoneChance: 0,
      PityCounter: 0,
      MinGold: 0,
      MaxGold: 0,
      ExperienceAmount: 0,
      TrainingPoints: 0,
      Items: [],
    },
    listRows: 317,
    directory: 'DropTables',
    emptyState: 'No drop tables found.',
  },
  {
    routePath: '/npc-inventories',
    apiPath: '/api/npc-inventories',
    statusRoute: 'npc_inventories',
    objectType: 'npc_inventory',
    newButton: 'New NPC inventory',
    keyLabel: 'NPC TemplateID',
    keyInput: '01025',
    createdKey: '1025',
    fileName: 'npcinventory_1025.json',
    document: { TemplateID: 1025, Inventory: [] },
    listRows: 215,
    directory: 'NpcInventory',
    emptyState: 'No NPC inventories found.',
  },
  {
    routePath: '/npc-spell-inventories',
    apiPath: '/api/npc-spell-inventories',
    statusRoute: 'npc_spell_inventories',
    objectType: 'npc_spell_inventory',
    newButton: 'New NPC spell inventory',
    keyLabel: 'NPC TemplateID',
    keyInput: '1452231',
    createdKey: '1452231',
    fileName: 'npcspellinventory_1452231.json',
    document: { TemplateID: 1452231, Spells: [] },
    listRows: 77,
    directory: 'NpcSpellInventory',
    emptyState: 'No NPC spell inventories found.',
  },
  {
    routePath: '/creature-spellbooks',
    apiPath: '/api/creature-spellbooks',
    statusRoute: 'creature_spellbooks',
    objectType: 'creature_spellbook',
    newButton: 'New creature spellbook',
    keyLabel: 'Deck name',
    keyInput: 'Mdeck-L-BR-DS-SylviaDrake-A-50',
    createdKey: 'Mdeck-L-BR-DS-SylviaDrake-A-50',
    fileName: 'creaturespellbook_Mdeck-L-BR-DS-SylviaDrake-A-50.json',
    document: { DeckName: 'Mdeck-L-BR-DS-SylviaDrake-A-50', SpellTemplateIds: [] },
    listRows: 134,
    directory: 'CreatureSpellbook',
    emptyState: 'No creature spellbooks found.',
  },
  {
    routePath: '/npc-drop-tables',
    apiPath: '/api/npc-drop-tables',
    statusRoute: 'npc_drop_tables',
    objectType: 'npc_drop_table',
    newButton: 'New NPC drop table',
    keyLabel: 'NPC TemplateID',
    keyInput: '87112',
    createdKey: '87112',
    fileName: 'npcdroptable_87112.json',
    document: { TemplateID: 87112, DropTableNames: [] },
    // The directory does not exist: 0 rows and the server's own flag (D72a/D72f).
    listRows: 0,
    missingDirectory: true,
    directory: 'NpcDropTable',
    emptyState: 'No NPC drop tables found.',
  },
  {
    routePath: '/treasure-card-inventories',
    apiPath: '/api/treasure-card-inventories',
    statusRoute: 'treasure_card_inventories',
    objectType: 'treasure_card_inventory',
    newButton: 'New treasure card inventory',
    keyLabel: 'NPC TemplateID',
    keyInput: '38214',
    createdKey: '38214',
    fileName: 'treasurecardinventory_38214.json',
    document: { TemplateID: 38214, TreasureCards: [] },
    listRows: 1,
    directory: 'TreasureCardInventory',
    emptyState: 'No treasure card inventories found.',
  },
  {
    routePath: '/zone-transfers',
    apiPath: '/api/zone-transfers',
    statusRoute: 'zone_transfers',
    objectType: 'zone_transfer',
    newButton: 'New zone transfer',
    keyLabel: 'Zone name',
    keyInput: 'WizardCity/WC_Hub',
    createdKey: 'WizardCity/WC_Hub',
    fileName: 'zonetransfer_WizardCity_WC_Hub.json',
    document: { ZoneName: 'WizardCity/WC_Hub', Teleports: [] },
    // AC1's 1207 is the FILE count (D1's sweep asserts it); the list endpoint answers 1205 rows
    // because two ZoneName keys are duplicated (D69's 1205-vs-1207 collapse).
    listRows: 1205,
    duplicateKeys: [
      'ZoneTransfer/WizardCity/Tutorial_Exterior',
      'ZoneTransfer/WizardCity/Tutorial_Interior',
    ],
    directory: 'ZoneTransfer',
    emptyState: 'No zone transfers found.',
  },
];

/** The `objects[]` rows a list response carries: `count` rows, all `extracted`. */
function mockRows(count: number): Array<Record<string, unknown>> {
  const now = new Date('2026-09-27T00:00:00.000Z').toISOString();
  return Array.from({ length: count }, (_, index) => ({
    key: `KEY-${String(index).padStart(5, '0')}`,
    title: `KEY-${String(index).padStart(5, '0')}`,
    modified_at: now,
    status: 'extracted',
  }));
}

interface FamilyMockRecorded {
  /** Every `POST <apiPath>` body, in order — the create arm's evidence. */
  readonly posts: Array<Record<string, unknown>>;
  /** How many list reads happened. */
  listRequests: number;
}

async function mockFamily(page: Page, family: FamilyFixture): Promise<FamilyMockRecorded> {
  const recorded: FamilyMockRecorded = { posts: [], listRequests: 0 };

  // The shell's own boot reads (Header, identity gate, import toast), so nothing in this spec can
  // reach the dev stack's database.
  const settings: Record<string, string> = {
    aurorium_path: '/mock/aurorium',
    imcodec_path: '/mock/imcodec',
    spiraldb_path: '/mock/spiraldb',
    user_name: 'Mock Reviewer',
    git_branch: 'content/2026-09-27',
  };
  await page.route('**/api/settings', (route) => route.fulfill({ json: settings }));
  await page.route('**/api/sync/status', (route) =>
    route.fulfill({ json: { last_sync: null, revision: null, status: 'never' } }),
  );
  await page.route('**/api/sync/history', (route) => route.fulfill({ json: { history: [] } }));
  await page.route('**/api/status/_import', (route) =>
    route.fulfill({ json: { ran: false, imported: 0, imported_at: null } }),
  );

  // The detail page's status reads (mounted for every tracked family after the create navigates).
  await page.route(`**/api/status/${family.statusRoute}`, (route) =>
    route.fulfill({
      json: { entries: [], summary: { total: 0, extracted: 0, reviewed: 0, verified: 0 } },
    }),
  );
  await page.route(`**/api/status/${family.statusRoute}/*/history`, (route) =>
    route.fulfill({ json: [] }),
  );

  // The detail read the create's navigation triggers — answered with the created document.
  await page.route(`**${family.apiPath}/*`, (route) => route.fulfill({ json: family.document }));

  await page.route(`**${family.apiPath}`, async (route: Route) => {
    if (route.request().method() === 'POST') {
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      recorded.posts.push(body);
      await route.fulfill({
        json: {
          key: family.createdKey,
          file_type: family.objectType,
          object_type: family.objectType,
          outcome: 'created',
          action: 'create',
          commit: 'c0ffee0123456789abcdef0123456789abcdef01',
          branch: settings.git_branch,
          commit_message: `spiraldb: create ${family.objectType} ${family.createdKey}`,
          file: `${family.directory}/${family.fileName}`,
          status: 'extracted',
          status_created: true,
          warnings: [],
        },
      });
      return;
    }
    recorded.listRequests += 1;
    await route.fulfill({
      json: {
        objects: mockRows(family.listRows),
        summary: {
          total: family.listRows,
          extracted: family.listRows,
          reviewed: 0,
          verified: 0,
        },
        skipped: [],
        missing_directory: family.missingDirectory ?? false,
        duplicate_keys: family.duplicateKeys ?? [],
      },
    });
  });

  return recorded;
}

/* ----------------------------------------------------------------------------- AC1: counts */

test.describe('p4-09 ac1 — every list page shows its verified corpus count', () => {
  for (const family of FAMILIES) {
    test(`${family.routePath} — ${family.listRows} rows`, async ({ page }) => {
      await mockFamily(page, family);
      await page.goto(family.routePath);

      const tablist = page.getByRole('main').getByRole('tablist');
      await expect(tablist.getByRole('tab', { name: /^All/ })).toContainText(
        String(family.listRows),
      );

      // The pagination line is the second, independent rendering of the same scan (D49).
      const first = family.listRows === 0 ? 0 : 1;
      const last = Math.min(50, family.listRows);
      await expect(page.getByText(`Showing ${first}-${last} of ${family.listRows}`)).toBeVisible();

      if (family.missingDirectory === true) {
        // AC1's NpcDropTable clause: the empty state **and** why the directory is empty, with no
        // table header at all (D72f: a `columnheader` assertion here would be wrong).
        await expect(page.getByText(family.emptyState)).toBeVisible();
        await expect(
          page.getByText(
            new RegExp(
              `The ${family.directory}/ directory does not exist in this SpiralDB repository yet`,
            ),
          ),
        ).toBeVisible();
        await expect(page.getByRole('columnheader')).toHaveCount(0);
      } else {
        await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
      }

      if (family.duplicateKeys !== undefined) {
        // The 1205-vs-1207 collapse is surfaced, not hidden: the page names the two pairs.
        await expect(
          page.getByText(new RegExp(`Duplicate keys \\(first file in name order wins\\)`)),
        ).toBeVisible();
        await expect(page.getByText(new RegExp('WizardCity/Tutorial_Exterior'))).toBeVisible();
      }
    });
  }
});

/* ---------------------------------------------------------------------------- AC3: create */

test.describe('p4-09 ac3 — create an entry from the family list page', () => {
  for (const family of FAMILIES) {
    test(`${family.newButton} posts the client's own body and lands on the new entry`, async ({
      page,
    }) => {
      const recorded = await mockFamily(page, family);
      await page.goto(family.routePath);

      await page.getByRole('button', { name: family.newButton, exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('heading', { name: family.newButton })).toBeVisible();

      // The key control is one labelled input, and the preview is `fileNameFor`'s output — the
      // D26 singular `droptable_` and the zone slash→underscore transform are visible here.
      await dialog.getByLabel(family.keyLabel).fill(family.keyInput);
      await expect(dialog.getByText(`Will create ${family.fileName}`)).toBeVisible();

      await dialog.getByRole('button', { name: 'Create', exact: true }).click();

      // The client's own body: exactly `{ object }` — no `key` (that field belongs to the update
      // path's duplicate forgiveness, D70(b)/D76(a)) and no third key.
      // Byte-for-byte, key order included: the recorded body must be this document and
      // nothing else.
      expect(JSON.stringify(recorded.posts[0])).toBe(JSON.stringify({ object: family.document }));
      // The commit message the server answered with is what the success toast shows. Addressed
      // the house way (`li[data-sonner-toast]`, extraction.spec.ts's idiom): sonner also mirrors
      // the text into an aria-live region, so a bare `getByText` matches twice under load and
      // trips strict mode.
      await expect(
        page
          .locator('li[data-sonner-toast][data-type="success"]')
          .filter({ hasText: `spiraldb: create ${family.objectType}` }),
      ).toContainText(`spiraldb: create ${family.objectType}`);
      // The app navigates to the new entry's detail route.
      await expect(page).toHaveURL(new RegExp(`${family.routePath}/`));
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  }

  test('a key the server rejects stays in the dialog with the server\u2019s own message', async ({
    page,
  }) => {
    const dropTable = FAMILIES[0] as FamilyFixture;
    await mockFamily(page, dropTable);
    // Replace the POST arm with the duplicate 400 the real validator answers for a taken name.
    await page.route(`**${dropTable.apiPath}`, async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 400,
          json: {
            error: 'DropTable validation failed with 1 validation error (Duplicate name)',
            fields: { Name: ['already used by another drop table'] },
          },
        });
        return;
      }
      await route.fulfill({
        json: {
          objects: mockRows(1),
          summary: { total: 1, extracted: 1, reviewed: 0, verified: 0 },
          skipped: [],
          missing_directory: false,
          duplicate_keys: [],
        },
      });
    });

    await page.goto(dropTable.routePath);
    await page.getByRole('button', { name: dropTable.newButton, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(dropTable.keyLabel).fill('DS-ACAD1-C01-001');
    await dialog.getByRole('button', { name: 'Create', exact: true }).click();

    await expect(
      page
        .locator('li[data-sonner-toast][data-type="error"]')
        .filter({ hasText: /Duplicate name/ }),
    ).toContainText('Duplicate name');
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('an unusable key disables Create and says why, before any request', async ({ page }) => {
    // Real vocabulary, real defect class: the five key kinds the server would reject are refused
    // inline. The ulong family's blank key is the first arm; a path separator is the second.
    const npcInventory = FAMILIES[1] as FamilyFixture;
    const recorded = await mockFamily(page, npcInventory);
    await page.goto(npcInventory.routePath);
    await page.getByRole('button', { name: npcInventory.newButton, exact: true }).click();
    const dialog = page.getByRole('dialog');
    const create = dialog.getByRole('button', { name: 'Create', exact: true });
    const key = dialog.getByLabel(npcInventory.keyLabel);

    // Empty: the message names the field; Create is disabled.
    await expect(dialog.getByRole('alert')).toHaveText('NPC TemplateID is required.');
    await expect(create).toBeDisabled();

    // A non-digit ulong: still refused, still no request.
    await key.fill('12a');
    await expect(dialog.getByRole('alert')).toContainText('must be an unsigned integer');
    await expect(create).toBeDisabled();

    // A usable key re-enables it and shows the preview.
    await key.fill('87112');
    await expect(create).toBeEnabled();
    await expect(dialog.getByText('Will create npcinventory_87112.json')).toBeVisible();
    expect(recorded.posts).toEqual([]);
  });
});
