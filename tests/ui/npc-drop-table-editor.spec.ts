import { expect, test, type Page } from '@playwright/test';

/**
 * Story p4-06's tier-1 UI spec (decisions D40/D44): plan task 4.6's `NpcDropTable` editor and
 * the list page's genuinely empty state.
 *
 * Hermetic by construction: every request the pages make is fulfilled from the fixtures below, so
 * the run reaches neither the dev stack's SQLite file nor the D17 clone. The wire contracts are
 * copied literally (the reason `quests-mocks.ts`, `drop-table-editor.spec.ts` and
 * `simple-object-editors.spec.ts` do the same): a fixture that imported
 * `client/src/lib/objects.ts` could only prove the client agrees with itself.
 *
 * | AC | arm | test |
 * |---|---|---|
 * | AC1's empty-state clause | `missing_directory: true` + 0 rows renders the notice and the empty state, not a bare table | `empty state` #1 |
 * | AC1's empty-state clause | the same server flag with one row renders the table and drops the notice | `empty state` #2 |
 * | AC1 | the NPC dropdown + chips over **drop_tables names**, a name the table does not hold staying raw | `editor` #1 |
 * | AC1 | the multi-select is **searchable** over the synced names and appends the picked name | `editor` #2 |
 * | AC1 | chips are removable **by index**, and `DropTableNames` is replaced whole | `editor` #3 |
 * | AC1 | the raw-name box puts back a name the table does not hold, and refuses a blank | `editor` #4 |
 * | AC1 | an empty array renders its empty state and saves as `[]` | `editor` #5 |
 * | AC1 | the save carries **exactly two keys** — no third key is invented | `editor` #3, #5 |
 *
 * The live half of AC1 — "the first save creates the `NpcDropTable/` directory in the test clone
 * and the file inside it" — cannot run in a hermetic spec (it needs a real server, a real git
 * clone and a real write), so it is proven in the story's evidence run: a fresh-port server rig
 * booted against the clone, `NpcDropTable/npcdroptable_87112.json` created by a real POST, the
 * commit and the `entry_status` row recorded, and the clone restored to `18dc924` afterwards.
 */

/* ------------------------------------------------------------------- fixtures */

/** The family descriptor, spelled exactly as `shared/objectTypes.ts` spells it. */
const FAMILY = {
  label: 'NPC Drop Tables',
  urlPath: '/api/npc-drop-tables',
  routeType: 'npc_drop_tables',
  objectType: 'npc_drop_table',
  fileType: 'npcdroptable',
  directory: 'NpcDropTable',
  keyField: 'TemplateID',
  key: '87112',
} as const;

/** The synced `npcs` rows (as `GET /api/names/npcs` serves them). */
const NPC_ROWS = [{ template_id: 87112, name: 'Bob the Vendor' }];

/**
 * The synced `drop_tables` rows — the names the multi-select searches. `idColumn` is `name`, so
 * one row is one name; `description` is NULL in 316 of the 317 live rows and is not the label.
 *
 * `WC-UNICORN-BONUS-001` — the **second name of the spec's own NpcDropTable example**
 * (docs/spec-domain-reference.md L174) — is deliberately **absent**, because it has no
 * `DropTables/*.json` file and no `drop_tables` row in the fork (measured: 0 of the 317 names
 * contain `BONUS`). A chip for it must show the name itself and invent nothing, and the raw-name
 * box is the way it comes back after a removal.
 */
const DROP_TABLE_ROWS = [
  { name: 'WC-UNICORN-MAIN-007', description: null },
  { name: 'WC-UNICORN-MAIN-006', description: null },
  { name: 'WC-UNICORN-SIDE-001', description: null },
  { name: 'DS-ACAD-C01-001', description: null },
];

/** The loaded document — the spec's own example, verbatim key order. */
const DOCUMENT: Record<string, unknown> = {
  TemplateID: 87112,
  DropTableNames: ['WC-UNICORN-MAIN-007', 'WC-UNICORN-BONUS-001'],
};

interface MockRecorded {
  /** Every `POST /api/npc-drop-tables` body. */
  savePosts: Array<Record<string, unknown>>;
  /** How many times the list endpoint was fetched. */
  listRequests: number;
  /** The names a single-id `GET /api/names/drop_tables/:name` fallback asked for. */
  nameLookups: string[];
  /** The document the detail endpoint currently serves (a test may replace one). */
  served: Record<string, unknown>;
  /** The list response's `missing_directory` flag (AC1's clause). */
  missingDirectory: boolean;
  /** The list response's rows. */
  rows: MockRow[];
}

interface MockRow {
  key: string;
  title: string;
  modified_at: string | null;
  status: 'extracted' | 'reviewed' | 'verified' | null;
}

/** The one list row a populated family serves. */
function row(): MockRow {
  return {
    key: FAMILY.key,
    title: FAMILY.key,
    modified_at: '2026-06-01T00:00:00.000Z',
    status: 'extracted',
  };
}

/**
 * Fulfils every request the shell and the two pages make.
 *
 * @param options.rows          the list's rows (`[]` is the absent-directory reality)
 * @param options.missingDirectory the server's own flag for an absent `NpcDropTable/`
 */
async function mockObjectApi(
  page: Page,
  options: { rows?: MockRow[]; missingDirectory?: boolean } = {},
): Promise<MockRecorded> {
  const recorded: MockRecorded = {
    savePosts: [],
    listRequests: 0,
    nameLookups: [],
    served: { ...DOCUMENT },
    missingDirectory: options.missingDirectory ?? false,
    rows: options.rows ?? [row()],
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

  // The two names tables the controls search, and their single-id fallbacks.
  await page.route('**/api/names/npcs', (route) => route.fulfill({ json: { npcs: NPC_ROWS } }));
  await page.route('**/api/names/npcs/*', (route) =>
    route.fulfill({ status: 404, json: { error: 'Unknown npcs id' } }),
  );
  await page.route('**/api/names/drop_tables', (route) =>
    route.fulfill({ json: { drop_tables: DROP_TABLE_ROWS } }),
  );
  await page.route('**/api/names/drop_tables/*', async (route) => {
    recorded.nameLookups.push(decodeURIComponent(route.request().url().split('/').pop() ?? ''));
    await route.fulfill({ status: 404, json: { error: 'Unknown drop_tables id' } });
  });

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
          file: `${FAMILY.directory}/npcdroptable_${key}.json`,
          status: null,
          status_created: false,
          warnings: [],
        },
      });
      return;
    }

    recorded.listRequests += 1;
    await route.fulfill({
      json: {
        objects: recorded.rows,
        summary: {
          total: recorded.rows.length,
          extracted: recorded.rows.filter((r) => r.status === 'extracted').length,
          reviewed: recorded.rows.filter((r) => r.status === 'reviewed').length,
          verified: recorded.rows.filter((r) => r.status === 'verified').length,
        },
        skipped: [],
        missing_directory: recorded.missingDirectory,
        duplicate_keys: [],
      },
    });
  });

  // The detail endpoint: the served document.
  await page.route(`**${FAMILY.urlPath}/*`, (route) => route.fulfill({ json: recorded.served }));

  await page.route(`**/api/status/${FAMILY.routeType}`, (route) =>
    route.fulfill({
      json: {
        entries: recorded.rows.map((r) => ({
          object_type: FAMILY.objectType,
          object_key: r.key,
          status: r.status ?? 'extracted',
          extracted_at: '2026-06-01T00:00:00.000Z',
          reviewed_at: null,
          verified_at: null,
          latest_notes: null,
        })),
        summary: {
          total: recorded.rows.length,
          extracted: recorded.rows.filter((r) => r.status === 'extracted').length,
          reviewed: recorded.rows.filter((r) => r.status === 'reviewed').length,
          verified: recorded.rows.filter((r) => r.status === 'verified').length,
        },
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

/** Opens the detail page and presses Edit. */
async function openEditor(page: Page): Promise<void> {
  await page.goto(`/npc-drop-tables/${FAMILY.key}`);
  await expect(main(page).getByText(FAMILY.key, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('button', { name: 'Edit' })).toBeDisabled();
}

/** The chips of the multi-select, as text (one entry per chip, document order). */
async function chipTexts(page: Page): Promise<string[]> {
  return main(page)
    .getByRole('list', { name: 'drop table chips' })
    .getByRole('listitem')
    .allInnerTexts();
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

/** The document the last save POSTed (the pipeline payload). */
function lastSaved(recorded: MockRecorded): Record<string, unknown> {
  expect(recorded.savePosts.length, 'no POST /api/npc-drop-tables route fired').toBeGreaterThan(0);
  const body = recorded.savePosts[recorded.savePosts.length - 1];
  return body.object as Record<string, unknown>;
}

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
});

/* ---------------------------------------------------- AC1: the empty state (list page) */

test.describe('AC1 — the absent-directory empty state', () => {
  test('renders the server’s missing-directory notice, not a bare table', async ({ page }) => {
    await mockObjectApi(page, { rows: [], missingDirectory: true });
    await page.goto('/npc-drop-tables');

    // The page's own sentence and the reason (the AC's "empty state gracefully" clause).
    await expect(main(page).getByPlaceholder('Search NPC drop tables...')).toBeVisible();
    await expect(main(page).getByText('No NPC drop tables found.')).toBeVisible();
    await expect(main(page).getByText('Try a different filter or search.')).toBeVisible();
    await expect(
      main(page).getByText(
        'The NpcDropTable/ directory does not exist in this SpiralDB repository yet — the first save creates it.',
      ),
    ).toBeVisible();

    // The zeros are the response's own, and there is no table and no card list to misread.
    await expect(main(page).getByText('Showing 0-0 of 0')).toBeVisible();
    await expect(main(page).getByRole('columnheader')).toHaveCount(0);
    await expect(main(page).getByRole('tab', { name: /^All/ })).toContainText('0');
  });

  test('with a row, the table renders and the notice is gone', async ({ page }) => {
    const recorded = await mockObjectApi(page);
    await page.goto('/npc-drop-tables');

    await expect(main(page).getByRole('columnheader', { name: 'NPC' })).toBeVisible();
    await expect(main(page).getByRole('link', { name: FAMILY.key, exact: true })).toBeVisible();
    await expect(main(page).getByText(/directory does not exist/)).toHaveCount(0);
    expect(recorded.listRequests).toBe(1);
  });
});

/* ------------------------------------------------------------- AC1: the form editor */

test.describe('AC1 — the NpcDropTable editor', () => {
  test('shows the NPC dropdown and chips over drop_tables names, leaving an unreachable name raw', async ({
    page,
  }) => {
    await mockObjectApi(page);
    await openEditor(page);

    // The NPC select is the friendly-name dropdown, showing `Name (TemplateID)`.
    await expect(main(page).getByRole('combobox', { name: 'NPC TemplateID' })).toContainText(
      'Bob the Vendor (87112)',
    );

    // The chips render the NAMES, and the spec's own unreachable name renders itself.
    expect(await chipTexts(page)).toEqual(['WC-UNICORN-MAIN-007', 'WC-UNICORN-BONUS-001']);
    await expect(
      main(page).getByRole('button', { name: 'Remove WC-UNICORN-MAIN-007 (1)' }),
    ).toBeVisible();
    await expect(
      main(page).getByRole('button', { name: 'Remove WC-UNICORN-BONUS-001 (2)' }),
    ).toBeVisible();
  });

  test('adds a name through the searchable multi-select over the synced names', async ({
    page,
  }) => {
    await mockObjectApi(page);
    await openEditor(page);

    await main(page).getByRole('combobox', { name: 'Add drop table' }).click();
    // The popover is PORTALLED (Radix `PopoverPrimitive.Portal`), so its input and options are
    // outside `main` — the same scoping `simple-object-editors.spec.ts` uses.
    await page
      .getByRole('combobox', { name: 'Search drop_tables', exact: true })
      .fill('WC-UNICORN');
    // Three of the four synced names match; the fourth (`DS-ACAD-C01-001`) does not.
    await expect(page.getByRole('option', { name: 'DS-ACAD-C01-001', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: 'WC-UNICORN-MAIN-006', exact: true }).click();
    await page.keyboard.press('Escape');

    expect(await chipTexts(page)).toEqual([
      'WC-UNICORN-MAIN-007',
      'WC-UNICORN-BONUS-001',
      'WC-UNICORN-MAIN-006',
    ]);
    // The document really grew, appended after the loaded order.
    const live = await liveDocument(page);
    expect(live.DropTableNames).toEqual([
      'WC-UNICORN-MAIN-007',
      'WC-UNICORN-BONUS-001',
      'WC-UNICORN-MAIN-006',
    ]);
  });

  test('removes exactly the clicked chip and saves the list whole with two keys', async ({
    page,
  }) => {
    const recorded = await mockObjectApi(page);
    await openEditor(page);

    await main(page).getByRole('button', { name: 'Remove WC-UNICORN-MAIN-007 (1)' }).click();
    expect(await chipTexts(page)).toEqual(['WC-UNICORN-BONUS-001']);

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Saved 87112/)).toBeVisible({ timeout: 15_000 });

    const saved = lastSaved(recorded);
    // Exactly the schema's two keys — no audit quartet, nothing invented (D69(b)).
    expect(Object.keys(saved)).toEqual(['TemplateID', 'DropTableNames']);
    expect(saved).toEqual({ TemplateID: 87112, DropTableNames: ['WC-UNICORN-BONUS-001'] });
    // The unreachable name the user kept is still there, verbatim.
    expect(typeof saved.TemplateID).toBe('number');
  });

  test('puts back a name the table does not hold through the raw-name box, and refuses a blank', async ({
    page,
  }) => {
    const recorded = await mockObjectApi(page);
    await openEditor(page);

    // Remove the reachable name, leaving only the unreachable one.
    await main(page).getByRole('button', { name: 'Remove WC-UNICORN-MAIN-007 (1)' }).click();
    // Remove the unreachable name too: it is now unreachable by search as well.
    await main(page).getByRole('button', { name: 'Remove WC-UNICORN-BONUS-001 (1)' }).click();
    await expect(main(page).getByText(/empty DropTableNames array/)).toBeVisible();

    // A blank is refused: no chip appears and nothing is written.
    const box = main(page).getByLabel('Add a drop table name');
    await box.fill('   ');
    await main(page).getByRole('button', { name: 'Add name' }).click();
    await expect(main(page).getByText(/empty DropTableNames array/)).toBeVisible();
    await expect(main(page).getByRole('list', { name: 'drop table chips' })).toHaveCount(0);

    // The typed name comes back verbatim — the spec's own unreachable name is storable.
    await box.fill('WC-UNICORN-BONUS-001');
    await main(page).getByRole('button', { name: 'Add name' }).click();
    expect(await chipTexts(page)).toEqual(['WC-UNICORN-BONUS-001']);
    // No name lookup was issued for the miss (the chip's own text is its value).
    expect(recorded.nameLookups).toEqual([]);
  });

  test('renders an empty array as its empty state and saves [] after the last chip goes', async ({
    page,
  }) => {
    const recorded = await mockObjectApi(page);
    recorded.served = { TemplateID: 87112, DropTableNames: [] };
    await page.goto(`/npc-drop-tables/${FAMILY.key}`);
    await expect(main(page).getByText(/empty DropTableNames array/)).toBeVisible();

    // A save needs an edit, so prove the arm from a one-chip file: removing the last chip
    // leaves `[]` and the empty state.
    recorded.served = { TemplateID: 87112, DropTableNames: ['WC-UNICORN-MAIN-007'] };
    await openEditor(page);
    await main(page).getByRole('button', { name: 'Remove WC-UNICORN-MAIN-007 (1)' }).click();
    await expect(main(page).getByText(/empty DropTableNames array/)).toBeVisible();

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Saved 87112/)).toBeVisible({ timeout: 15_000 });

    const saved = lastSaved(recorded);
    expect(Object.keys(saved)).toEqual(['TemplateID', 'DropTableNames']);
    expect(saved.DropTableNames).toEqual([]);
    // Not null, not a dropped key.
    expect(JSON.stringify(saved)).toContain('"DropTableNames":[]');
  });

  test('removes the clicked chip when a name repeats — index-addressed, never value-based', async ({
    page,
  }) => {
    const recorded = await mockObjectApi(page);
    // The schema is `string[]` and nothing forbids a repeat; the accessible name carries the
    // position precisely so the second occurrence is addressable.
    recorded.served = {
      TemplateID: 87112,
      DropTableNames: ['WC-UNICORN-MAIN-007', 'WC-UNICORN-BONUS-001', 'WC-UNICORN-MAIN-007'],
    };
    await openEditor(page);
    expect(await chipTexts(page)).toEqual([
      'WC-UNICORN-MAIN-007',
      'WC-UNICORN-BONUS-001',
      'WC-UNICORN-MAIN-007',
    ]);

    // Remove the THIRD chip — a value-based removal would have taken both MAIN-007 chips.
    await main(page).getByRole('button', { name: 'Remove WC-UNICORN-MAIN-007 (3)' }).click();
    expect(await chipTexts(page)).toEqual(['WC-UNICORN-MAIN-007', 'WC-UNICORN-BONUS-001']);

    // …and now the first, which leaves the middle one untouched.
    await main(page).getByRole('button', { name: 'Remove WC-UNICORN-MAIN-007 (1)' }).click();
    expect(await chipTexts(page)).toEqual(['WC-UNICORN-BONUS-001']);

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Saved 87112/)).toBeVisible({ timeout: 15_000 });

    const saved = lastSaved(recorded);
    expect(Object.keys(saved)).toEqual(['TemplateID', 'DropTableNames']);
    expect(saved).toEqual({ TemplateID: 87112, DropTableNames: ['WC-UNICORN-BONUS-001'] });
  });
});
