import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

/**
 * Story p4-10's **`tests/ui/object-editors.spec.ts`** — the Phase-4 AC#14 chain (plan task 4.12;
 * decisions D23 tier 1, D40/D44, D57, D70(e), D71(a)/(i), D76(e), D77).
 *
 * The file the plan names and p4-04 deliberately deferred here (D70(g)) — one committed,
 * hermetic, headless spec carrying the AC's own sentence for **two representative types**:
 * **DropTable** (the items repeater) and **NpcInventory** (the multi-select chips).
 *
 * | AC#14's words | arm |
 * |---|---|
 * | "list → detail → edit → save" | each type's chain test opens the **list page**, follows the row link to the detail page, presses Edit, drives one real control and saves |
 * | "success toast" | the sonner `li[data-sonner-toast][data-type="success"]` carrying `Saved {key} (updated) — spiraldb: update {object_type} {key}` (`ObjectDetailPage`'s own `notifySuccess`) |
 * | "**StatusBadge unchanged**" | the badge still reads `Status: Reviewed` after the save, and **no** `PATCH /api/status/…` was issued (the status list was read, so the badge is a real join) |
 * | "the DropTable items repeater add/remove rows" | `Add item row` appends a row that is then filled through the ItemId dropdown (ItemName auto-filled), `Remove item 1` deletes the row that was **first**, and the POSTed `Items` proves both |
 * | "the NpcInventory multi-select chips add/remove" | a pick from the searchable multi-select, a raw-id add, and an index-addressed removal; the POSTed `Inventory` is the proof |
 * | (D71(a), pinned here because the AC's "remove" has no unambiguous meaning otherwise) | removal is **index-addressed**: a fixture with the same id **twice** keeps its surviving duplicate |
 *
 * ## What is new here, what is consolidated, and what stays where it is
 *
 * This file does **not** fork an existing arm; it names the overlap instead.
 *
 * - **New.** (a) Both AC#14 chains — no existing spec opens the **list** page, saves, and then
 *   asserts the **toast and the unchanged badge together** (nor that a save issues no status
 *   PATCH: a save is not a transition, D76(e)). (b) The DropTable repeater's `Add item row` /
 *   `Remove item N` **interactions** — `drop-table-editor.spec.ts` mounts the repeater and pins
 *   its field-level contract (the string↔number `ItemId`, the miss-safe `ItemName`, the D57
 *   one-field diff, the inline requirement tree) but never clicks either button. (c) The
 *   duplicate-value index-addressed removal (D71(a)): no existing fixture carries a repeated id.
 * - **Consolidated (referenced, not re-implemented).** The chips' *field-level* detail — that a
 *   chip renders the item **name**, that an unresolved id stays raw, that the array is replaced
 *   whole, the empty-array edge — is owned by `simple-object-editors.spec.ts` (its AC1 #1–#3) and
 *   `object-list.spec.ts`. Those assertions stay there; this file drives the same shared
 *   `ObjectIdMultiSelect` only as the AC's chain step, and never re-asserts their copy.
 * - **Stays where it is.** `drop-table-editor.spec.ts` (DropTable field detail),
 *   `status-integration.spec.ts` (the transitions themselves: Mark Reviewed → PATCH → history →
 *   list dot → tab counts), `object-create-and-counts.spec.ts` (the create path).
 *
 * ## Hermetic (D40)
 *
 * One dispatcher fulfils every `/api/**` request from the fixtures below, so the run reaches
 * neither the dev stack's SQLite file nor the D17 clone. The wire contracts are copied literally
 * (the reason `object-list.spec.ts` and `status-integration.spec.ts` do the same): a fixture that
 * imported `client/src/lib/objects.ts` could only prove the client agrees with itself. The
 * status surface is **stateful** only to the extent of recording `PATCH`es — this spec's claim is
 * that a save issues none.
 */

/* ------------------------------------------------------------------- fixtures */

type Status = 'extracted' | 'reviewed' | 'verified';

const DROP_A = 'DS-ACAD1-C01-001';
const DROP_B = 'DS-ACAD1-C01-002';

/** The DropTable the chain opens: two item rows, both ids resolvable in the names table. */
function dropTableDocument(): Record<string, unknown> {
  return {
    Name: DROP_A,
    Description: 'Test table',
    RollChance: 1,
    Weight: 100,
    NoneChance: 0,
    MinGold: 0,
    MaxGold: 0,
    Items: [
      { ItemId: '1001', ItemName: 'Black Mantle', Notes: 'first', Requirements: null },
      { ItemId: '1002', ItemName: 'Twice Stitched Boots', Notes: 'second', Requirements: null },
    ],
  };
}

/** The NpcInventory the chain opens; the duplicate fixture is built from this by the last test. */
function npcInventoryDocument(inventory: readonly number[]): Record<string, unknown> {
  return { TemplateID: 1025, Inventory: [...inventory] };
}

/** The synced rows the two forms read (`GET /api/names/:type`, D36's shapes). */
const ITEM_ROWS = [
  { gid: 1001, name: 'Black Mantle' },
  { gid: 1002, name: 'Twice Stitched Boots' },
  { gid: 160936, name: 'Black Mantle' },
  { gid: 160943, name: 'Spiral Wand' },
];
const NPC_ROWS = [{ template_id: 1025, name: 'Lucky the Merchant' }];

interface Recorded {
  /** The `POST /api/<type>` bodies, in order, with the family that received them. */
  readonly savePosts: Array<{ family: string; body: Record<string, unknown> }>;
  /** Every `PATCH /api/status/…` body — AC#14's "badge unchanged" means this stays empty. */
  readonly patches: Array<Record<string, unknown>>;
  /** Every `/api/status/…` URL read, so "the badge is a real join" is checkable. */
  readonly statusReads: string[];
}

interface MockOptions {
  /** The NpcInventory document the detail route answers with (the duplicate fixture). */
  readonly inventory?: readonly number[];
}

/**
 * One dispatcher for the whole `/api/**` surface: the shell's boot reads, the names tables, both
 * families' list + detail + save, and the status list / history / PATCH.
 *
 * The statuses are fixed (`DROP_A` and `1025` are `reviewed`) rather than mutable: this spec
 * asserts that a **save leaves them alone**, which a mutable store would make unfalsifiable.
 */
async function mockApi(page: Page, options: MockOptions = {}): Promise<Recorded> {
  const recorded: Recorded = { savePosts: [], patches: [], statusReads: [] };
  const settings: Record<string, string> = {
    aurorium_path: '/mock/aurorium',
    imcodec_path: '/mock/imcodec',
    spiraldb_path: '/mock/spiraldb',
    user_name: 'Mock Reviewer',
    git_branch: 'content/2026-09-27',
  };

  const dropRows = [DROP_A, DROP_B];
  const npcRows = ['1025', '1026'];
  const dropDocument = dropTableDocument();
  const npcDocument = npcInventoryDocument(options.inventory ?? [160936]);

  const statusOf = (key: string): Status =>
    key === DROP_A || key === '1025' ? 'reviewed' : 'extracted';

  const listBody = (rows: readonly string[], statuses: boolean): Record<string, unknown> => {
    const objects = rows.map((key) => ({
      key,
      title: key,
      modified_at: '2026-06-01T00:00:00.000Z',
      status: statuses ? statusOf(key) : null,
    }));
    const counted = objects.filter((row) => row.status !== null);
    return {
      objects,
      summary: statuses
        ? {
            total: counted.length,
            extracted: counted.filter((row) => row.status === 'extracted').length,
            reviewed: counted.filter((row) => row.status === 'reviewed').length,
            verified: counted.filter((row) => row.status === 'verified').length,
          }
        : null,
      skipped: [],
      missing_directory: false,
      duplicate_keys: [],
    };
  };

  await page.route(/\/api\//, async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const json = (body: unknown): Promise<void> => route.fulfill({ json: body });

    // The shell's own boot reads (Header, the identity gate, the import toast).
    if (path === '/api/settings') {
      await json(settings);
      return;
    }
    if (path === '/api/sync/status') {
      await json({ last_sync: null, revision: null, status: 'never' });
      return;
    }
    if (path === '/api/sync/history') {
      await json({ history: [] });
      return;
    }
    if (path === '/api/status/_import') {
      await json({ ran: false, imported: 0, imported_at: null });
      return;
    }
    if (path.startsWith('/api/names/')) {
      const segments = path.slice('/api/names/'.length).split('/');
      const type = segments[0] ?? '';
      if (segments.length === 1) {
        const rows = type === 'items' ? ITEM_ROWS : type === 'npcs' ? NPC_ROWS : ([] as unknown[]);
        await json({ [type]: rows });
      } else {
        await route.fulfill({ status: 404, json: { error: `Unknown ${type} id` } });
      }
      return;
    }

    /* ------------------------------------------------------------ the status API */
    if (path.startsWith('/api/status/')) {
      recorded.statusReads.push(path);
      const segments = path.slice('/api/status/'.length).split('/');
      const routeType = segments[0];
      const rows =
        routeType === 'drop_tables' ? dropRows : routeType === 'npc_inventories' ? npcRows : [];
      if (rows.length === 0) {
        await route.fulfill({ status: 404, json: { error: `Unknown status type "${routeType}"` } });
        return;
      }
      if (segments.length === 1) {
        const entries = rows.map((key) => ({
          object_type: routeType === 'drop_tables' ? 'drop_table' : 'npc_inventory',
          object_key: key,
          status: statusOf(key),
          extracted_at: '2026-06-01T00:00:00.000Z',
          reviewed_at: null,
          verified_at: null,
          latest_notes: null,
        }));
        await json({
          entries,
          summary: {
            total: entries.length,
            extracted: entries.filter((row) => row.status === 'extracted').length,
            reviewed: entries.filter((row) => row.status === 'reviewed').length,
            verified: entries.filter((row) => row.status === 'verified').length,
          },
        });
        return;
      }
      if (segments.length === 3 && segments[2] === 'history') {
        await json({ history: [] });
        return;
      }
      if (segments.length === 2 && method === 'PATCH') {
        // Reached only if a save (wrongly) moved the status — the assertion the chain rests on.
        recorded.patches.push((request.postDataJSON() ?? {}) as Record<string, unknown>);
        await json({});
        return;
      }
      await route.fulfill({ status: 404, json: { error: `unmocked status ${method} ${path}` } });
      return;
    }

    /* ----------------------------------------------------------- the family routes */
    if (path === '/api/drop-tables' || path.startsWith('/api/drop-tables/')) {
      if (path === '/api/drop-tables') {
        if (method === 'POST') {
          const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
          recorded.savePosts.push({ family: 'droptable', body });
          await json(saveEnvelope(DROP_A, 'drop_table', settings.git_branch));
          return;
        }
        await json(listBody(dropRows, true));
        return;
      }
      const key = decodeURIComponent(path.slice('/api/drop-tables/'.length));
      if (key !== DROP_A) {
        await route.fulfill({ status: 404, json: { error: `Unknown entry "${key}"` } });
        return;
      }
      await json(dropDocument);
      return;
    }
    if (path === '/api/npc-inventories' || path.startsWith('/api/npc-inventories/')) {
      if (path === '/api/npc-inventories') {
        if (method === 'POST') {
          const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
          recorded.savePosts.push({ family: 'npcinventory', body });
          await json(saveEnvelope('1025', 'npc_inventory', settings.git_branch));
          return;
        }
        await json(listBody(npcRows, true));
        return;
      }
      const key = decodeURIComponent(path.slice('/api/npc-inventories/'.length));
      if (key !== '1025') {
        await route.fulfill({ status: 404, json: { error: `Unknown entry "${key}"` } });
        return;
      }
      await json(npcDocument);
      return;
    }

    await route.fulfill({ status: 404, json: { error: `unmocked ${method} ${path}` } });
  });

  return recorded;
}

/** The save envelope `server/src/services/objects.ts` answers with (one shape for both types). */
function saveEnvelope(key: string, objectType: string, branch: string): Record<string, unknown> {
  return {
    key,
    file_type: objectType,
    object_type: objectType,
    outcome: 'updated',
    action: 'update',
    commit: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
    branch,
    commit_message: `spiraldb: update ${objectType} ${key}`,
    file: `${objectType}/${key}.json`,
    status: null,
    status_created: false,
    warnings: [],
  };
}

/* -------------------------------------------------------------------- helpers */

const main = (page: Page): Locator => page.getByRole('main');

/** One sonner toast, matched by its text (`extraction.spec.ts`'s own locator). */
const toast = (page: Page, text: string): Locator =>
  page.locator('li[data-sonner-toast]').filter({ hasText: text });

/** The chip texts of a multi-select, in document order. */
async function chipTexts(page: Page, name: string): Promise<string[]> {
  return main(page).getByRole('list', { name }).getByRole('listitem').allInnerTexts();
}

/** The body of the last save for a family, as `{ object, key }`. */
function lastSave(recorded: Recorded, family: string): Record<string, unknown> {
  const posts = recorded.savePosts.filter((post) => post.family === family);
  expect(posts.length, `no save POST for ${family}`).toBeGreaterThan(0);
  return posts[posts.length - 1]!.body;
}

interface ChainFixture {
  readonly fileType: 'droptable' | 'npcinventory';
  readonly listPath: string;
  readonly detailPath: string;
  readonly key: string;
  readonly objectType: string;
  /** The one control the chain's edit step drives, and the value it carries away. */
  readonly edit: (page: Page) => Promise<void>;
  /** What the drive must have done to the POSTed document (the one changed field). */
  readonly expectedObject: Record<string, unknown>;
}

/**
 * The AC#14 chain, in the AC's own order, for one representative type — the shared four steps
 * plus the two assertions under test (toast, unchanged badge, no PATCH).
 */
async function runChain(page: Page, recorded: Recorded, fixture: ChainFixture): Promise<void> {
  // 1. the list page, as the user reaches the entry.
  await page.goto(fixture.listPath);
  await expect(page.getByRole('link', { name: fixture.key, exact: true }).first()).toBeVisible();

  // 2. the detail page, opened from the list row (not by typing the URL).
  await page.getByRole('link', { name: fixture.key, exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`${fixture.listPath}/`));
  await expect(main(page).getByLabel('Status: Reviewed')).toBeVisible();

  // 3. edit: one real control, driven; Save becomes enabled (the drive reached the model).
  await page.getByRole('button', { name: 'Edit' }).click();
  await fixture.edit(page);
  const save = page.getByRole('button', { name: 'Save' });
  await expect(save).toBeEnabled();

  // 4. save: the success toast, the disabled Save, and the unchanged badge.
  await save.click();
  await expect(
    toast(
      page,
      `Saved ${fixture.key} (updated) — spiraldb: update ${fixture.objectType} ${fixture.key}`,
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('li[data-sonner-toast][data-type="success"]')).toHaveCount(1);
  await expect(save).toBeDisabled();

  // AC#14's "StatusBadge unchanged": still the entry's own status ...
  await expect(main(page).getByLabel('Status: Reviewed')).toBeVisible();
  // ... and the save moved nothing on the status surface: the list was read (so the badge is a
  // real join) and **no** PATCH was issued — an edit is not a transition (D76e).
  expect(recorded.statusReads).toContain(
    `/api/status/${fixture.objectType === 'drop_table' ? 'drop_tables' : 'npc_inventories'}`,
  );
  expect(recorded.patches).toEqual([]);

  // The wire body: the document, and the envelope's `key` (shared/objectSave.ts — the one home).
  const body = lastSave(recorded, fixture.fileType);
  expect(Object.keys(body).sort()).toEqual(['key', 'object']);
  expect(body.key).toBe(fixture.key);
  expect(body.object).toEqual(fixture.expectedObject);
}

/* ------------------------------------------------------- AC#14: DropTable chain */

test.describe('AC#14 — DropTable: the list → detail → edit → save chain, and the items repeater', () => {
  test('the chain saves and shows the success toast with the StatusBadge unchanged', async ({
    page,
  }) => {
    const recorded = await mockApi(page);
    await runChain(page, recorded, {
      fileType: 'droptable',
      listPath: '/drop-tables',
      detailPath: `/drop-tables/${DROP_A}`,
      key: DROP_A,
      objectType: 'drop_table',
      edit: async (actor) => {
        await main(actor)
          .getByRole('textbox', { name: 'Description', exact: true })
          .fill('p4-10 chain edit');
      },
      expectedObject: { ...dropTableDocument(), Description: 'p4-10 chain edit' },
    });
  });

  test('the items repeater adds a filled row and removes the first row by index', async ({
    page,
  }) => {
    const recorded = await mockApi(page);
    await page.goto(`/drop-tables/${DROP_A}`);
    await page.getByRole('button', { name: 'Edit' }).click();

    // Two rows from the fixture, each an `<article aria-label="Item N">`.
    await expect(main(page).getByRole('article', { name: 'Item 1' })).toBeVisible();
    await expect(main(page).getByRole('article', { name: 'Item 2' })).toBeVisible();

    // "add rows": the button appends a third row with the field defaults.
    await main(page).getByRole('button', { name: 'Add item row' }).click();
    const third = main(page).getByRole('article', { name: 'Item 3' });
    await expect(third).toBeVisible();

    // The appended row is really editable: pick through the ItemId dropdown ...
    await third.getByRole('combobox', { name: 'Item 3 item id', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search items', exact: true }).fill('Spiral');
    await page.getByRole('option', { name: 'Spiral Wand', exact: true }).click();
    // ... the read-only ItemName is auto-filled from the synced table ...
    await expect(third.getByLabel('Item 3 item name', { exact: true })).toHaveValue('Spiral Wand');
    // ... and the row's own Notes box takes text.
    await third.getByLabel('Notes', { exact: true }).fill('p4-10 added');

    // "remove rows": `Remove item 1` deletes Items[0], so the old Items[1] becomes Item 1 —
    // index-addressed, which is what makes the removal unambiguous (never value-based).
    await main(page).getByRole('button', { name: 'Remove item 1', exact: true }).click();
    await expect(main(page).getByRole('article', { name: 'Item 3' })).toHaveCount(0);
    await expect(
      main(page)
        .getByRole('article', { name: 'Item 1' })
        .getByRole('combobox', { name: 'Item 1 item id', exact: true }),
    ).toContainText('Twice Stitched Boots');

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      toast(page, `Saved ${DROP_A} (updated) — spiraldb: update drop_table ${DROP_A}`),
    ).toBeVisible({ timeout: 15_000 });

    const object = lastSave(recorded, 'droptable').object as Record<string, unknown>;
    expect(object.Items).toEqual([
      { ItemId: '1002', ItemName: 'Twice Stitched Boots', Notes: 'second', Requirements: null },
      { ItemId: '160943', ItemName: 'Spiral Wand', Notes: 'p4-10 added', Requirements: null },
    ]);
  });
});

/* ---------------------------------------------------- AC#14: NpcInventory chain */

test.describe('AC#14 — NpcInventory: the chain, and the multi-select chips add/remove', () => {
  test('the chain saves and shows the success toast with the StatusBadge unchanged', async ({
    page,
  }) => {
    const recorded = await mockApi(page);
    await runChain(page, recorded, {
      fileType: 'npcinventory',
      listPath: '/npc-inventories',
      detailPath: '/npc-inventories/1025',
      key: '1025',
      objectType: 'npc_inventory',
      edit: async (actor) => {
        // The AC's own second control type, driven the plain way: the raw-id add box (the
        // searchable picker's own arm is the next test).
        await main(actor).getByLabel('Add an item id', { exact: true }).fill('160999');
        await main(actor).getByRole('button', { name: 'Add id', exact: true }).click();
      },
      expectedObject: { TemplateID: 1025, Inventory: [160936, 160999] },
    });
  });

  test('the multi-select chips add (pick and raw) and remove by index', async ({ page }) => {
    const recorded = await mockApi(page);
    await page.goto('/npc-inventories/1025');
    await page.getByRole('button', { name: 'Edit' }).click();

    expect(await chipTexts(page, 'item chips')).toEqual(['Black Mantle']);

    // Add 1/2 — the searchable multi-select: the popover is portalled, so the search box and the
    // option live outside `main` (the scoping `simple-object-editors.spec.ts` documents).
    await main(page).getByRole('combobox', { name: 'Add item', exact: true }).click();
    await page.getByRole('combobox', { name: 'Search items', exact: true }).fill('Spiral');
    await page.getByRole('option', { name: 'Spiral Wand', exact: true }).click();
    // The popover stays open (that is what "multi" means); Escape closes it.
    await page.keyboard.press('Escape');
    expect(await chipTexts(page, 'item chips')).toEqual(['Black Mantle', 'Spiral Wand']);

    // Add 2/2 — the raw-id box, for the 42 of 3,205 corpus ids with no synced name; the chip
    // shows the raw value and invents nothing.
    await main(page).getByLabel('Add an item id', { exact: true }).fill('160999');
    await main(page).getByRole('button', { name: 'Add id', exact: true }).click();
    expect(await chipTexts(page, 'item chips')).toEqual(['Black Mantle', 'Spiral Wand', '160999']);

    // Remove — the first chip, by its index-addressed label.
    await main(page).getByRole('button', { name: 'Remove Black Mantle (1)', exact: true }).click();
    expect(await chipTexts(page, 'item chips')).toEqual(['Spiral Wand', '160999']);

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      toast(page, 'Saved 1025 (updated) — spiraldb: update npc_inventory 1025'),
    ).toBeVisible({ timeout: 15_000 });

    const object = lastSave(recorded, 'npcinventory').object as Record<string, unknown>;
    expect(Object.keys(object)).toEqual(['TemplateID', 'Inventory']);
    expect(object).toEqual({ TemplateID: 1025, Inventory: [160943, 160999] });
  });

  test('removal is index-addressed: the surviving duplicate of a repeated id stays', async ({
    page,
  }) => {
    // 14 real NpcInventory files carry the same value twice (D71a), so a fixture with a repeat is
    // the honest shape — and a value-based removal would silently collapse it.
    const recorded = await mockApi(page, { inventory: [160936, 160936, 160943] });
    await page.goto('/npc-inventories/1025');
    await page.getByRole('button', { name: 'Edit' }).click();

    expect(await chipTexts(page, 'item chips')).toEqual([
      'Black Mantle',
      'Black Mantle',
      'Spiral Wand',
    ]);

    await main(page).getByRole('button', { name: 'Remove Black Mantle (1)', exact: true }).click();
    expect(await chipTexts(page, 'item chips')).toEqual(['Black Mantle', 'Spiral Wand']);

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      toast(page, 'Saved 1025 (updated) — spiraldb: update npc_inventory 1025'),
    ).toBeVisible({ timeout: 15_000 });

    expect(lastSave(recorded, 'npcinventory').object).toEqual({
      TemplateID: 1025,
      Inventory: [160936, 160943],
    });
  });
});
