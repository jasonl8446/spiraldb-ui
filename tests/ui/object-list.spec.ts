import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Story p4-01's tier-1 UI spec (decision D40/D44): the generic object list and
 * detail surfaces, driven for the one family the scaffolding is wired end to end for
 * — **NpcInventory** — against route-mocked API responses.
 *
 * Hermetic by construction: every request the pages make is fulfilled from the
 * fixtures below, so the run reaches neither the dev stack's SQLite file nor the D17
 * clone. The wire contracts are copied literally (the same reason `quests-mocks.ts`
 * copies them): a fixture that imported `client/src/lib/objects.ts` could only prove
 * the client agrees with itself.
 *
 * What is asserted: the filter tabs' live count badges, the TanStack table's columns,
 * the `Showing 1-50 of 215` pagination and its two pages, the client-side search (with
 * the request count pinned so "no extra request" is evidence rather than a claim), the
 * per-filter empty state, the **missing-directory** empty state (the server's
 * `missing_directory: true` with zero rows, `NpcDropTable/`'s real situation), the
 * detail page's status badge, its Edit → form → Save round-trip with the exact POST
 * body, and the JSON panel toggle.
 *
 * **Story p4-03 rewrote this file's Inventory assertions, and that is a phase transition
 * rather than a weakened test** (the reasoning D59(a) records for the same kind of move): the
 * `Inventory` control is now the multi-select AC1 asks for, so the chips render item **names**
 * from the mocked `items` table, the chip list is named `item chips`, and the add box is the
 * shared `RawIdAddControl`'s (`Add an item id` + `Add id`). The two behaviours the old
 * assertions pinned — the POST body, and an unresolved id surviving as a raw value — are still
 * asserted, the second of them more strongly than before (the raw id is what the chip *shows*).
 */

/** One `objects[]` row of `GET /api/npc-inventories`. */
interface MockObjectRow {
  key: string;
  title: string;
  modified_at: string | null;
  status: 'extracted' | 'reviewed' | 'verified' | null;
}

/** The default corpus: the three statuses plus the two keys the search spec types. */
const TOTAL_ROWS = 215;
const EXTRACTED_ROWS = 45;
const REVIEWED_ROWS = 120;
/**
 * The two keys the pagination and search assertions hang off.
 *
 * Keys are strings and the list's default sort is by key ascending, so the filler
 * keys start at 2000 and the search row is `1000` — the **first** row of page one.
 * The 51st row overall is therefore `2050`: the natural key of index 50, i.e. the
 * first row of page two.
 */
const SEARCH_KEY = '1000';
const SECOND_PAGE_KEY = '2050';

function mockRows(total: number = TOTAL_ROWS): MockObjectRow[] {
  const now = Date.now();
  const rows: MockObjectRow[] = [];
  for (let index = 0; index < total; index += 1) {
    const key = index === 0 ? SEARCH_KEY : String(2000 + index);
    rows.push({
      key,
      title: key,
      modified_at: new Date(now - (index + 1) * 60 * 60 * 1000).toISOString(),
      status:
        index < EXTRACTED_ROWS
          ? 'extracted'
          : index < EXTRACTED_ROWS + REVIEWED_ROWS
            ? 'reviewed'
            : 'verified',
    });
  }
  return rows;
}

/** The `GET /api/npc-inventories` body for a row set (summary counts the rows, D49). */
function listBody(rows: MockObjectRow[], missingDirectory = false): Record<string, unknown> {
  return {
    objects: rows,
    summary: {
      total: rows.length,
      extracted: rows.filter((row) => row.status === 'extracted').length,
      reviewed: rows.filter((row) => row.status === 'reviewed').length,
      verified: rows.filter((row) => row.status === 'verified').length,
    },
    skipped: [],
    missing_directory: missingDirectory,
    duplicate_keys: [],
  };
}

/** The document `GET /api/npc-inventories/:key` answers with. */
const MOCK_DOCUMENT = { TemplateID: 2001, Inventory: [160936, 160943] };

interface ObjectMockOptions {
  rows?: MockObjectRow[];
  /** Replaces the list answer entirely. */
  onList?: (route: Route) => Promise<void> | void;
  /** The document the detail route answers with. */
  document?: Record<string, unknown>;
  /** The entry's status in `GET /api/status/npc_inventories`. */
  status?: 'extracted' | 'reviewed' | 'verified';
  /** Answers the detail route with this status instead (for the 404 case). */
  detailStatus?: number;
}

interface ObjectMockRecorded {
  /** How many times the list route was hit — the client-side-search assertion. */
  listRequests: number;
  /** The bodies of every `POST /api/npc-inventories`, in order. */
  savePosts: Array<Record<string, unknown>>;
  /** How many detail reads were made. */
  detailRequests: number;
}

async function mockObjectsApi(
  page: Page,
  options: ObjectMockOptions = {},
): Promise<ObjectMockRecorded> {
  const recorded: ObjectMockRecorded = {
    listRequests: 0,
    savePosts: [],
    detailRequests: 0,
  };
  const rows = options.rows ?? mockRows();
  let settings: Record<string, string> = {
    aurorium_path: '/mock/aurorium',
    imcodec_path: '/mock/imcodec',
    spiraldb_path: '/mock/spiraldb',
    user_name: 'Mock Reviewer',
    git_branch: 'content/2026-09-26',
  };

  // The shell's own boot reads (Header, the identity gate, the import toast) — mocked
  // so no request in this spec can reach the dev stack's database.
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
  // The NPC friendly-name dropdown's list read (rendered as soon as Edit is pressed).
  await page.route('**/api/names/npcs*', (route) => route.fulfill({ json: { npcs: [] } }));
  // The Inventory multi-select's names table (story p4-03 replaced the raw-id chips with a
  // searchable multi-select over `items`, so this read now happens on mount). `160999` — the id
  // the Edit test adds — is deliberately absent, so that chip must show the raw id: the same
  // miss-safe behaviour the 42 real misses get (D60(c)/D63(c)). The component resolves every
  // chip label from this one cached list, so an unresolved id issues no extra request at all.
  await page.route('**/api/names/items', (route) =>
    route.fulfill({
      json: {
        items: [
          { gid: 160936, name: 'Black Mantle' },
          { gid: 160943, name: 'Spiral Wand' },
        ],
      },
    }),
  );

  await page.route('**/api/status/npc_inventories', (route) =>
    route.fulfill({
      json: {
        entries:
          options.status === undefined
            ? []
            : [
                {
                  object_type: 'npc_inventory',
                  object_key: String(MOCK_DOCUMENT.TemplateID),
                  status: options.status,
                  extracted_at: '2026-06-01T00:00:00.000Z',
                  reviewed_at: null,
                  verified_at: null,
                  latest_notes: null,
                },
              ],
        summary: { total: 1, extracted: 0, reviewed: 0, verified: 1 },
      },
    }),
  );

  await page.route('**/api/npc-inventories', async (route) => {
    if (route.request().method() === 'POST') {
      recorded.savePosts.push((route.request().postDataJSON() ?? {}) as Record<string, unknown>);
      const body = (route.request().postDataJSON() ?? {}) as { object?: { TemplateID?: unknown } };
      const key = String(body.object?.TemplateID ?? '2001');
      await route.fulfill({
        json: {
          key,
          file_type: 'npcinventory',
          object_type: 'npc_inventory',
          outcome: 'updated',
          action: 'update',
          commit: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
          branch: settings.git_branch,
          commit_message: `spiraldb: update npc_inventory ${key}`,
          file: `NpcInventory/NPCInventories_${key}-A.json`,
          status: null,
          status_created: false,
          warnings: [],
        },
      });
      return;
    }
    recorded.listRequests += 1;
    if (options.onList !== undefined) {
      await options.onList(route);
      return;
    }
    // An explicitly empty row set mocks the absent directory, which is what the
    // missing-directory spec asserts; the default corpus is a present directory.
    await route.fulfill({
      json: listBody(rows, options.rows !== undefined && rows.length === 0),
    });
  });

  await page.route('**/api/npc-inventories/*', async (route) => {
    recorded.detailRequests += 1;
    if (options.detailStatus !== undefined) {
      await route.fulfill({
        status: options.detailStatus,
        json: { error: 'Unknown NPC Inventories entry "2001"' },
      });
      return;
    }
    await route.fulfill({ json: options.document ?? MOCK_DOCUMENT });
  });

  return recorded;
}

test.describe('the generic object list (NpcInventory)', () => {
  test('tabs count the rows, the table sorts and paginates, search filters client-side', async ({
    page,
  }) => {
    const recorded = await mockObjectsApi(page);
    await page.goto('/npc-inventories');

    // The four tabs, with the counts of the returned rows (not the status table's).
    const tablist = page.getByRole('main').getByRole('tablist');
    await expect(tablist.getByRole('tab', { name: /^All/ })).toContainText('215');
    await expect(tablist.getByRole('tab', { name: /^Extracted/ })).toContainText('45');
    await expect(tablist.getByRole('tab', { name: /^Reviewed/ })).toContainText('120');
    await expect(tablist.getByRole('tab', { name: /^Verified/ })).toContainText('50');

    // The generic table's columns and the first page's window.
    await expect(page.getByRole('columnheader', { name: 'NPC' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Modified' })).toBeVisible();
    await expect(page.getByRole('link', { name: SEARCH_KEY, exact: true })).toBeVisible();
    await expect(page.getByText('Showing 1-50 of 215')).toBeVisible();

    // Page two: 51-100, and the row that only exists there.
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText('Showing 51-100 of 215')).toBeVisible();
    await expect(page.getByRole('link', { name: SECOND_PAGE_KEY, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Previous' })).toBeEnabled();

    // A filter tab narrows the rows; the counts stay the response's own.
    await tablist.getByRole('tab', { name: /^Extracted/ }).click();
    await expect(page.getByText('Showing 1-45 of 45')).toBeVisible();

    // The client-side search: one more row set, and **no** extra list request (D12's
    // per-request scan is what the assertion protects).
    const before = recorded.listRequests;
    await page.getByPlaceholder('Search NPC inventories...').fill(SEARCH_KEY);
    await expect(page.getByRole('link', { name: SEARCH_KEY, exact: true })).toBeVisible();
    await expect(page.getByText('Showing 1-1 of 1')).toBeVisible();
    expect(recorded.listRequests).toBe(before);
  });

  test('renders the corpus-empty and per-filter empty states, including the missing directory', async ({
    page,
  }) => {
    // 1. A family whose directory does not exist: zero rows and the server's own flag.
    await mockObjectsApi(page, { rows: [] });
    await page.goto('/npc-inventories');
    await expect(page.getByText('No NPC inventories found.')).toBeVisible();
    await expect(
      page.getByText(/The NpcInventory\/ directory does not exist in this SpiralDB repository yet/),
    ).toBeVisible();
    await expect(page.getByText('Showing 0-0 of 0')).toBeVisible();
  });

  test('a per-filter empty state names the filter that is empty', async ({ page }) => {
    const rows = mockRows().filter((row) => row.status === 'extracted');
    await mockObjectsApi(page, { rows });
    await page.goto('/npc-inventories');
    await page
      .getByRole('main')
      .getByRole('tab', { name: /^Verified/ })
      .click();
    await expect(page.getByText('No Verified NPC inventories found.')).toBeVisible();
  });

  test('below md the rows are cards with a status badge, not a table', async ({ page }) => {
    await mockObjectsApi(page);
    await page.setViewportSize({ width: 480, height: 900 });
    await page.goto('/npc-inventories');

    await expect(page.getByRole('columnheader', { name: 'NPC' })).toHaveCount(0);
    const cards = page.getByRole('main').getByRole('list', { name: 'NPC inventories' });
    await expect(cards).toBeVisible();
    await expect(cards.getByRole('link', { name: new RegExp(SEARCH_KEY) })).toBeVisible();
    await expect(cards.getByText('Extracted').first()).toBeVisible();
  });
});

test.describe('the generic object detail (NpcInventory)', () => {
  test('renders the header, the status badge and the read-only form', async ({ page }) => {
    await mockObjectsApi(page, { status: 'reviewed' });
    await page.goto('/npc-inventories/2001');

    await expect(page.getByRole('link', { name: /Back to NPC Inventories/ })).toBeVisible();
    await expect(
      page.getByRole('main').getByText('NPC Inventories', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('main').getByText('2001', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('main').getByText('Reviewed', { exact: true })).toBeVisible();

    // View mode: the inventory entries as chips over item NAMES (story p4-03 — p4-01's chips
    // showed raw ids and this spec asserted them), and no add control at all.
    await expect(
      page.getByRole('list', { name: 'item chips' }).getByText('Black Mantle'),
    ).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'item chips' }).getByText('Spiral Wand'),
    ).toBeVisible();
    await expect(page.getByLabel('Add an item id')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('Edit → form → Save posts the live document, and the JSON panel follows it', async ({
    page,
  }) => {
    const recorded = await mockObjectsApi(page, { status: 'extracted' });
    await page.goto('/npc-inventories/2001');

    // The JSON panel is the same toggle the quest detail uses, titled per family.
    await page.getByRole('button', { name: 'Toggle JSON panel' }).click();
    await expect(page.getByLabel('NPC Inventories JSON')).toBeVisible();

    // Edit swaps the read-only fields for real controls.
    await page.getByRole('button', { name: 'Edit' }).click();
    const addInput = page.getByLabel('Add an item id');
    await expect(addInput).toBeVisible();

    await addInput.fill('160999');
    await page.getByRole('button', { name: 'Add id' }).click();
    // No synced name for 160999, so the chip shows the raw id and invents nothing.
    await expect(page.getByRole('list', { name: 'item chips' }).getByText('160999')).toBeVisible();

    // Editing makes the document dirty, which is what enables Save.
    const save = page.getByRole('button', { name: 'Save' });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();

    expect(recorded.savePosts).toHaveLength(1);
    // Story p4-08 added `key`: the save envelope carries the route key the client opened, which
    // is what the server's family validator uses to forgive the entry's own name (the DropTable
    // duplicate rule). See `client/src/pages/ObjectDetailPage.tsx` and
    // `tests/unit/object-status-pipeline.test.ts`.
    expect(recorded.savePosts[0]).toEqual({
      object: { TemplateID: 2001, Inventory: [160936, 160943, 160999] },
      key: '2001',
    });
  });

  test('a 404 renders the not-found state with the back link intact', async ({ page }) => {
    await mockObjectsApi(page, { detailStatus: 404 });
    await page.goto('/npc-inventories/2001');
    await expect(
      page.getByRole('heading', { name: 'NPC Inventories entry not found' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /Back to NPC Inventories/ })).toBeVisible();
  });
});
