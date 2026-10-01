import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Story p4-07's tier-1 UI spec (decisions D40/D44): plan task 4.9's `GlobalRegistry` editor — the
 * three acceptance criteria, docs/spec-domain-reference.md **L102-119** (the schema and the merge
 * rule) and **L711-712** (a single merged view in a key-value table editor), docs/spec-api.md
 * **L474** (`/global-registry → GlobalRegistry editor`), and `docs/plan-overview.md` **D22**
 * (consolidate-and-replace, whose review surface is the diff), **D5/D57** (merge-not-replace;
 * never normalise) and **Q1** (editor-only, no tracking).
 *
 * Hermetic by construction: every request the page makes is fulfilled from the fixtures below, so
 * the run reaches neither the dev stack's SQLite file nor the D17 clone. The wire contracts are
 * copied literally (the reason `zone-transfer-editor.spec.ts`, `drop-table-editor.spec.ts`,
 * `simple-object-editors.spec.ts` and `quests-mocks.ts` do the same): a fixture that imported
 * `client/src/lib/objects.ts` could only prove the client agrees with itself.
 *
 * | the AC's words | arm | test |
 * |---|---|---|
 * | AC1 "merged view equals the manual merge … case-sensitive" | the table shows the served merged view, and `Localization`/`localization` are **two rows** | merged #1 |
 * | AC1 "a key→float table supports add/edit/remove rows" | add #1 (new key + value), edit #1 (a value), remove #1 (a row) | rows |
 * | AC1 "…" (a rename) | the Key box commits on blur/Enter and preserves the row's value | rows #4 |
 * | AC1 "the spec says float, the corpus holds integers" | an untouched `1` stays `1`; a typed `0.25` is written as `0.25`; an emptied box is **no** edit | values |
 * | AC2 "one commit … the directory holds exactly one file" | the **pre-save disclosure** names every file the save replaces, before it happens | consolidation #1 |
 * | AC2 "…" (the wire) | the POST carries the **whole merged document** — every key, edited or not | consolidation #2 |
 * | AC2 "…" (afterwards) | the response's `commit_message` is `spiraldb: update global_registry globalregistry` | consolidation #2 |
 * | AC3 "type absent from dashboard totals and status routes" | the editor issues **no** status request and renders no StatusBadge | AC3 |
 *
 * ## The fixture-only facts, said plainly
 *
 * - **The corpus holds ONE file** (23 integer values, `GlobalRegistryModels_1-A.json`), so the
 *   merge is vacuous there and the multi-file arms below are fixtures. The merge rule itself
 *   (later wins, case-sensitivity) is proven in `tests/unit/global-registry-model.test.ts` against
 *   real end-to-end service reads — this spec proves what the **page** does with the result.
 * - **A stored non-integer value occurs nowhere** (23 of 23 are integers), so the float arm is a
 *   typed value and the "not a number" arm is a fixture document.
 * - **A second file in the directory does not exist today**, so the disclosure's N>1 arm is a
 *   fixture. Its N=1 arm (the real shape) is asserted too.
 *
 * ## The accessible-name vocabulary this spec addresses (and the tier-1 suite owns)
 *
 * `Registry values` (list) · `Registry key <KEY>` (textbox) · `Registry value <KEY>` (spinbutton)
 * · `Remove registry row <KEY>` (button) · `New registry key` (textbox) · `New registry value`
 * (spinbutton) + `Add row` (button) · the disclosure is `[data-consolidation="<n|none>"]`.
 *
 * The live half — the real commit in the D17 clone — cannot run in a hermetic spec, so it is the
 * story's evidence run (`docs/evidence/phase-4/p4-07-live.txt`), with the clone restored
 * afterwards.
 */

/* ------------------------------------------------------------------- fixtures */

/** The family descriptor, spelled exactly as `shared/objectTypes.ts` spells it. */
const FAMILY = {
  label: 'Global Registry',
  urlPath: '/api/global-registry',
  objectType: null,
  fileType: 'globalregistry',
  directory: 'GlobalRegistry',
  key: 'globalregistry',
} as const;

/**
 * The served merged view, in the corpus's own shape and key order: the wrapper, then mixed-case
 * keys, `Localization` (an integer `1`) first. Two keys differ only by case on purpose — the
 * merge is **case-sensitive** (L102-119), so they are two rows and never one.
 */
const DOCUMENT: Record<string, unknown> = {
  GlobalRegistryValues: {
    Localization: 1,
    localization: 7,
    Christmas: 0,
    Halloween: 0,
    'KM-Teaser': 0,
  },
};

/** The one real file the directory holds today (its list row is the file **stem**). */
const ONE_FILE = ['GlobalRegistryModels_1-A.json'];

interface MockRecorded {
  /** Every `POST /api/global-registry` body. */
  savePosts: Array<Record<string, unknown>>;
  /** The document the detail endpoint currently serves (a test may replace it). */
  served: Record<string, unknown>;
  /** Every `/api/status/...` URL the page asked for — AC3 asserts this stays empty. */
  statusRequests: string[];
}

/** Fulfils every request the shell and the editor make. */
async function mockObjectApi(
  page: Page,
  options: { files?: string[]; document?: Record<string, unknown>; skipped?: string[] } = {},
): Promise<MockRecorded> {
  const files = options.files ?? ONE_FILE;
  const recorded: MockRecorded = {
    savePosts: [],
    served: JSON.parse(JSON.stringify(options.document ?? DOCUMENT)) as Record<string, unknown>,
    statusRequests: [],
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
  // AC3's probe: the unkeyed family has no lifecycle, so nothing may call a status route.
  //
  // Registered BEFORE the `_import` route on purpose: Playwright checks handlers in reverse
  // registration order, and `_import` is a status URL too — so the specific mock must be the
  // later one, or the import toast would be answered with a status-list shape.
  await page.route('**/api/status/**', (route) => {
    recorded.statusRequests.push(route.request().url());
    return route.fulfill({
      json: { entries: [], summary: { total: 0, extracted: 0, reviewed: 0, verified: 0 } },
    });
  });
  await page.route('**/api/status/_import', (route) =>
    route.fulfill({ json: { ran: false, imported: 0, imported_at: null } }),
  );

  // The family's list (one row per **file**, keyed by the file stem) and its POST.
  await page.route(`**${FAMILY.urlPath}`, async (route) => {
    if (route.request().method() === 'POST') {
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      recorded.savePosts.push(body);
      await route.fulfill({
        json: {
          key: FAMILY.key,
          file_type: FAMILY.fileType,
          object_type: FAMILY.objectType,
          outcome: 'created',
          action: 'update',
          commit: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
          branch: settings.git_branch,
          commit_message: 'spiraldb: update global_registry globalregistry',
          file: `${FAMILY.directory}/globalregistry.json`,
          status: null,
          status_created: false,
          warnings: [
            `Consolidated ${files.length} file(s) into GlobalRegistry/globalregistry.json`,
          ],
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        objects: files.map((name) => ({
          key: name.replace(/\.json$/, ''),
          title: name.replace(/\.json$/, ''),
          modified_at: '2026-09-24T15:22:00.000Z',
          status: null,
        })),
        summary: null,
        skipped: (options.skipped ?? []).map((file) => ({
          file: `${FAMILY.directory}/${file}`,
          message: 'Could not parse this file.',
        })),
        missing_directory: false,
        duplicate_keys: [],
      },
    });
  });

  await page.route(`**${FAMILY.urlPath}/*`, (route) => route.fulfill({ json: recorded.served }));

  return recorded;
}

/** `main` — the same scope every other spec uses, so the sidebar cannot satisfy a locator. */
function main(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('main');
}

/** Opens the editor, which is the family's single route (docs/spec-api.md §"URL Routes (Frontend)"). */
async function openEditor(page: Page): Promise<void> {
  await page.goto(FAMILY.urlPath.replace('/api', ''));
  await expect(main(page).getByRole('list', { name: 'Registry values' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('button', { name: 'Edit' })).toBeDisabled();
}

/** One row's key box / value box / remove button, by the row's key. */
function keyBox(page: Page, key: string): Locator {
  return main(page).getByRole('textbox', { name: `Registry key ${key}`, exact: true });
}
function valueBox(page: Page, key: string): Locator {
  return main(page).getByRole('spinbutton', { name: `Registry value ${key}`, exact: true });
}
function removeButton(page: Page, key: string): Locator {
  return main(page).getByRole('button', { name: `Remove registry row ${key}`, exact: true });
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

/** The wrapper of the live document. */
async function liveValues(page: Page): Promise<Record<string, unknown>> {
  const document = await liveDocument(page);
  return document.GlobalRegistryValues as Record<string, unknown>;
}

/** The one save body the mocked POST received, as the document object. */
function lastSaved(recorded: MockRecorded): Record<string, unknown> {
  expect(recorded.savePosts.length, 'no POST /api/global-registry').toBeGreaterThan(0);
  return recorded.savePosts[recorded.savePosts.length - 1].object as Record<string, unknown>;
}

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
});

/* ------------------------------------------- AC1 — the merged view and the table */

test.describe('AC1 — the merged key→float table', () => {
  test('renders the merged view case-sensitively, integers included', async ({ page }) => {
    await mockObjectApi(page);
    await openEditor(page);

    const values = main(page).getByRole('list', { name: 'Registry values' });
    await expect(values.getByRole('listitem')).toHaveCount(5);

    // Case-sensitive keys: these are TWO rows, never one folded row (L102-119).
    await expect(keyBox(page, 'Localization')).toHaveValue('Localization');
    await expect(keyBox(page, 'localization')).toHaveValue('localization');

    // The corpus's integer shape, rendered as the integer it is (never `1.0`).
    await expect(valueBox(page, 'Localization')).toHaveValue('1');
    await expect(valueBox(page, 'Christmas')).toHaveValue('0');
    // …and the live document still says `1`, not `1.0`.
    const document = await liveDocument(page);
    expect(JSON.stringify(document)).toContain('"Localization":1');
    expect(JSON.stringify(document)).not.toContain('1.0');
  });

  test('adds a row, creating the wrapper when it is absent', async ({ page }) => {
    await mockObjectApi(page, { document: {} });
    await page.goto(FAMILY.urlPath.replace('/api', ''));
    await expect(
      main(page).getByText('This registry has no GlobalRegistryValues object yet'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Edit' }).click();

    await main(page).getByRole('textbox', { name: 'New registry key', exact: true }).fill('Easter');
    await main(page).getByRole('spinbutton', { name: 'New registry value', exact: true }).fill('3');
    await page.getByRole('button', { name: 'Add row' }).click();

    await expect(keyBox(page, 'Easter')).toHaveValue('Easter');
    expect(await liveValues(page)).toEqual({ Easter: 3 });
  });

  test('edits a value verbatim, leaves an untouched integer an integer', async ({ page }) => {
    await mockObjectApi(page);
    await openEditor(page);

    await valueBox(page, 'Christmas').fill('0.25');
    await valueBox(page, 'Christmas').blur();

    const values = await liveValues(page);
    expect(values.Christmas).toBe(0.25);
    expect(values.Localization).toBe(1);
    // The untouched value was never rewritten as a float (`1.0` is the named failure mode).
    expect(JSON.stringify(await liveDocument(page))).not.toContain('1.0');
  });

  test('removes the row the user clicked, not every row with that value', async ({ page }) => {
    // Two rows carrying the SAME value: a value-addressed removal would take both.
    await mockObjectApi(page, {
      document: { GlobalRegistryValues: { Christmas: 0, Halloween: 0, Localization: 1 } },
    });
    await openEditor(page);

    await removeButton(page, 'Halloween').click();

    const values = await liveValues(page);
    expect(values).toEqual({ Christmas: 0, Localization: 1 });
    await expect(keyBox(page, 'Halloween')).toHaveCount(0);
  });

  test('renames a row on blur, preserving its value, and appends it at the end', async ({
    page,
  }) => {
    await mockObjectApi(page);
    await openEditor(page);

    await keyBox(page, 'Christmas').fill('WinterVeil');
    await keyBox(page, 'Christmas').blur();

    const values = await liveValues(page);
    expect(values).toEqual({
      Localization: 1,
      localization: 7,
      Halloween: 0,
      'KM-Teaser': 0,
      WinterVeil: 0,
    });
    // `1` is still `1` — the rename did not touch the value it moved.
    await expect(valueBox(page, 'WinterVeil')).toHaveValue('0');
  });

  test('refuses a blank or duplicate new key, saying why', async ({ page }) => {
    await mockObjectApi(page);
    await openEditor(page);

    const add = main(page).getByRole('button', { name: 'Add row' });
    await expect(add).toBeDisabled();
    await expect(main(page).getByText('A key is required.')).toBeVisible();

    await main(page)
      .getByRole('textbox', { name: 'New registry key', exact: true })
      .fill('Christmas');
    await expect(add).toBeDisabled();
    await expect(
      main(page).getByText('"Christmas" is already a row — edit that row instead.'),
    ).toBeVisible();
  });

  test('an emptied value box is no edit at all, and a non-number is kept as stored', async ({
    page,
  }) => {
    await mockObjectApi(page, {
      document: { GlobalRegistryValues: { Christmas: 0, Weird: 'not-a-number' } },
    });
    await openEditor(page);

    await expect(
      main(page).getByText('stored value "not-a-number" is not a number — typing here replaces it'),
    ).toBeVisible();
    await expect(valueBox(page, 'Weird')).toHaveValue('');

    // Clearing a value box writes nothing: a `''` in a `float` dictionary would be type
    // corruption, and this dictionary's "absent" is a removed row (D57).
    await valueBox(page, 'Christmas').fill('');
    await valueBox(page, 'Christmas').blur();
    const values = await liveValues(page);
    expect(values).toEqual({ Christmas: 0, Weird: 'not-a-number' });
  });
});

/* -------------------------------- AC2 — the pre-save disclosure and the save wire */

test.describe('AC2 — the consolidation, disclosed before it happens', () => {
  test('names every file the save replaces, before the save', async ({ page }) => {
    await mockObjectApi(page, {
      files: ['GlobalRegistryModels_1-A.json', 'GlobalRegistryModels_1-B.json'],
    });
    await page.goto(FAMILY.urlPath.replace('/api', ''));

    const disclosure = main(page).locator('[data-consolidation="2"]');
    await expect(disclosure).toBeVisible();
    await expect(disclosure).toContainText(
      'Saving replaces 3 files with one: GlobalRegistryModels_1-A.json, GlobalRegistryModels_1-B.json',
    );
    await expect(disclosure).toContainText('Git history is the undo');
    // The claim is made before the save, when the page is still clean — Delete/Save have not run.
    expect(
      await page.evaluate(() => document.body.textContent?.includes('globalregistry.json')),
    ).toBe(true);
  });

  test('the one real file today is disclosed as the file being replaced', async ({ page }) => {
    await mockObjectApi(page);
    await page.goto(FAMILY.urlPath.replace('/api', ''));

    const disclosure = main(page).locator('[data-consolidation="1"]');
    await expect(disclosure).toBeVisible();
    await expect(disclosure).toContainText('GlobalRegistryModels_1-A.json');
  });

  test('a directory already holding only the target says so instead', async ({ page }) => {
    await mockObjectApi(page, { files: ['globalregistry.json'] });
    await page.goto(FAMILY.urlPath.replace('/api', ''));

    await expect(main(page).locator('[data-consolidation="none"]')).toContainText(
      'the directory already holds exactly that one file',
    );
  });

  test('a file the list could not read is named as left in place', async ({ page }) => {
    await mockObjectApi(page, { skipped: ['broken.json'] });
    await page.goto(FAMILY.urlPath.replace('/api', ''));

    await expect(main(page).locator('[data-consolidation="1"]')).toContainText(
      'GlobalRegistry/broken.json',
    );
    await expect(main(page).locator('[data-consolidation="1"]')).toContainText(
      'a save leaves those files in place and reports them',
    );
  });

  test('saves the whole merged document as one POST and reports the commit', async ({ page }) => {
    const recorded = await mockObjectApi(page);
    await openEditor(page);

    await valueBox(page, 'Christmas').fill('5');
    await valueBox(page, 'Christmas').blur();
    await page.getByRole('button', { name: 'Save' }).click();

    // The POST carries the WHOLE merged document — the untouched keys included, and the wrapper
    // never flattened (the named failure mode).
    const saved = lastSaved(recorded);
    expect(saved).toEqual({
      GlobalRegistryValues: {
        Localization: 1,
        localization: 7,
        Christmas: 5,
        Halloween: 0,
        'KM-Teaser': 0,
      },
    });
    // The one response the save returns (the mocked wire shape the server really sends).
    await expect(page.getByText('spiraldb: update global_registry globalregistry')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('Save is disabled until the document is dirty (a no-op save is impossible)', async ({
    page,
  }) => {
    await mockObjectApi(page);
    await openEditor(page);

    const save = page.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();
    await valueBox(page, 'Christmas').fill('1');
    await valueBox(page, 'Christmas').blur();
    await expect(save).toBeEnabled();
  });
});

/* --------------------------------------------- AC3 — no tracking, no status route */

test.describe('AC3 — the type is editor-only (Q1)', () => {
  test('renders no status badge and asks no status route', async ({ page }) => {
    const recorded = await mockObjectApi(page);
    await openEditor(page);

    // The editor IS reachable and editable even though the family has no lifecycle (the
    // `editable` override on ObjectDetailLayout): Edit was clicked and is disabled, Save exists.
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    // No StatusBadge: the three lifecycle words appear nowhere in the page chrome.
    for (const word of ['extracted', 'reviewed', 'verified']) {
      await expect(main(page).getByText(word, { exact: true })).toHaveCount(0);
    }
    expect(recorded.statusRequests).toEqual([]);
  });
});
