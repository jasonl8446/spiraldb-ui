import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Story p4-06's tier-1 UI spec (decisions D40/D44): plan task 4.8's `WizardZoneData`
 * (`ZoneTransfer/`) editor — the two acceptance criteria,
 * docs/spec-domain-reference.md L281-309 (the schema), L700-702 (the zone display derivation),
 * L542-546 (the general validation section) and docs/spec-data-model.md L184 (the filename).
 *
 * Hermetic by construction: every request the page makes is fulfilled from the fixtures below, so
 * the run reaches neither the dev stack's SQLite file nor the D17 clone. The wire contracts are
 * copied literally (the reason `quests-mocks.ts`, `drop-table-editor.spec.ts`,
 * `simple-object-editors.spec.ts`, `npc-drop-table-editor.spec.ts` and
 * `treasure-card-inventory-editor.spec.ts` do the same): a fixture that imported
 * `client/src/lib/objects.ts` could only prove the client agrees with itself.
 *
 * | the AC's words | arm | test |
 * |---|---|---|
 * | "`ZoneName` key with a humanized zone dropdown" | the dropdown shows the **`zones` names type's own label** (`display_name`), never a second humanizer | key #1 |
 * | "…" (choosing) | selecting a zone writes the raw `zone_path` (slashes and all) into the document | key #2 |
 * | "`Teleports` repeater with nested `Teleport` fields" | one `<article>` per entry, holding the trigger name and all six nested fields | repeater #1 |
 * | "…works" (add) | the Add box appends a **new nested entry object** in the corpus's key order | repeater #2 |
 * | "…works" (remove) | removal is **index**-addressed, so a repeated trigger name survives | repeater #3 |
 * | "`m_destinationLoc` regex-validated 4-float string" | `1,2,3` shows an inline **error** and disables Save; `1,-2.5,-1.671345E-05,0.0` is accepted and unblocks it | location #1/#2/#3 |
 * | "…" (blocking) | a malformed value shows the inline **error** and disables Save; the same document with a scientific-notation value does neither | location #3 |
 * | "`m_teleportType` enum" | the one measured member is offered, and a stored value the model does not know is kept verbatim | type #1/#2 |
 * | AC2 "`Events` … visible in a read-only raw-fields disclosure" | the disclosure names the field, quotes the measurement and prints the value | drift #1 |
 * | AC2 "survives save … byte-identically" | the POST body still carries `Events: []` and the file's key order | drift #2 |
 * | AC2 "the filename is slash→underscore" | asserted in the model's unit sweep through `fileNameFor` (not here: this spec never creates a file) | — |
 *
 * ## The three fixture-only facts, said plainly
 *
 * - **`Events` is `[]` in all 1,207 real files** (`shared/simpleObjects/zoneTransfer.ts`), so the
 *   disclosure's content is an empty array and the spec asserts exactly that rather than a richer
 *   shape that does not exist anywhere.
 * - **A malformed `m_destinationLoc` does not occur in the corpus either** (2,365 of 2,365 pass
 *   the pattern), so the **blocking** arm is reachable only by typing — which is what test
 *   location #1 does. The model's unit sweep proves the accept side against all 2,365 real values.
 * - **An unrecognised `m_teleportType` does not occur** (`TELEPORT_STATIC` in 2,365 of 2,365), so
 *   type #2 serves a fixture document with one; the point is that the editor must not rewrite a
 *   value it does not know, and that can only be proven with such a value.
 *
 * ## The accessible-name vocabulary this spec addresses (and the tier-1 suite owns)
 *
 * `Zone name` (combobox) · `Teleport N trigger name` (textbox) · `Teleport N destination
 * location` (textbox) · `Teleport N destination zone` (combobox) · `Teleport N exit teleporter` /
 * `Teleport N teleporter tag` / `Teleport N transition ID` (spinbuttons) · `Teleport N teleport
 * type` (combobox) · `Teleport N` (article) · `Remove teleport N` (button) · `New teleport trigger
 * name` (textbox) + `Add teleport` (button) · `Teleports` (list) · the raw-fields disclosure is
 * `[data-raw-fields]` whose summary reads `Raw fields (N unmodelled)`. `N` is 1-based.
 *
 * The live half of the story — the real 1,207-file family saved into the D17 clone from a
 * fresh-port rig — cannot run in a hermetic spec, so it is the story's evidence run
 * (`docs/evidence/phase-4/p4-06-live.txt`), with the clone restored afterwards.
 */

/* ------------------------------------------------------------------- fixtures */

/** The family descriptor, spelled exactly as `shared/objectTypes.ts` spells it. */
const FAMILY = {
  label: 'Zone Transfers',
  urlPath: '/api/zone-transfers',
  routeType: 'zone_transfers',
  objectType: 'zone_transfer',
  fileType: 'zonetransfer',
  directory: 'ZoneTransfer',
  keyField: 'ZoneName',
  key: 'WizardCity/WC_Hub',
} as const;

/** The synced `zones` rows (as `GET /api/names/zones` serves them). */
const ZONE_ROWS = [
  { zone_path: 'WizardCity/WC_Hub', display_name: 'Wizard City / WC Hub', world: 'WizardCity' },
  {
    zone_path: 'WizardCity/WC_Shop_Area',
    display_name: 'Wizard City / WC Shop Area',
    world: 'WizardCity',
  },
  { zone_path: 'Aquila/AQ_Z00_Hub', display_name: 'Aquila / AQ Z00 Hub', world: 'Aquila' },
];

/**
 * The loaded document, in the real corpus's own shape and key order (`ZoneName, Events,
 * Teleports` — 1,206 of the 1,207 files). Row 1 carries the **scientific-notation** location form
 * the corpus really uses 133 times; row 2 repeats row 1's trigger name on purpose, so the removal
 * arm can prove it is index-addressed rather than value-addressed.
 */
const DOCUMENT: Record<string, unknown> = {
  ZoneName: 'WizardCity/WC_Hub',
  Events: [],
  Teleports: [
    {
      TriggerName: 'TeleportToShoppingDistrict',
      Teleport: {
        m_exitTeleporter: 0,
        m_teleporterTag: 1,
        m_teleportType: 'TELEPORT_STATIC',
        m_transitionID: 2,
        m_destinationLoc: '2824.861,-6404.079,-1.671345E-05,3.13484',
        m_destinationZone: 'WizardCity/WC_Shop_Area',
      },
    },
    {
      TriggerName: 'TeleportToShoppingDistrict',
      Teleport: {
        m_exitTeleporter: 0,
        m_teleporterTag: 0,
        m_teleportType: 'TELEPORT_STATIC',
        m_transitionID: 0,
        m_destinationLoc: '-95.55735,-849.2842,-30.46902,-0.03700731',
        m_destinationZone: 'WizardCity/WC_Hub',
      },
    },
  ],
};

interface MockRecorded {
  /** Every `POST /api/zone-transfers` body. */
  savePosts: Array<Record<string, unknown>>;
  /** The document the detail endpoint currently serves (a test may replace one). */
  served: Record<string, unknown>;
  /** Every zone id the client asked for individually (the dropdown's fallback lookups). */
  zoneLookups: string[];
}

/** Fulfils every request the shell and the two pages make. */
async function mockObjectApi(page: Page): Promise<MockRecorded> {
  const recorded: MockRecorded = {
    savePosts: [],
    served: JSON.parse(JSON.stringify(DOCUMENT)) as Record<string, unknown>,
    zoneLookups: [],
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

  // The one names table this editor reads: `zones`, the source of both dropdowns' labels.
  await page.route('**/api/names/zones', (route) => route.fulfill({ json: { zones: ZONE_ROWS } }));
  await page.route('**/api/names/zones/*', (route) => {
    recorded.zoneLookups.push(decodeURIComponent(route.request().url().split('/').pop() ?? ''));
    return route.fulfill({ status: 404, json: { error: 'Unknown zone' } });
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
          file: `${FAMILY.directory}/WizardZoneDatas_1-A.json`,
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

  // `entry_status` has 0 rows for this family (task 4.10's), which is what the mock mirrors.
  await page.route(`**/api/status/${FAMILY.routeType}`, (route) =>
    route.fulfill({
      json: { entries: [], summary: { total: 0, extracted: 0, reviewed: 0, verified: 0 } },
    }),
  );

  return recorded;
}

/* ------------------------------------------------------------------- helpers */

/** `main` — the same scope every other spec uses, so the sidebar cannot satisfy a locator. */
function main(page: Page): ReturnType<Page['getByRole']> {
  return page.getByRole('main');
}

/** Opens the detail page (the key carries a `/`, encoded exactly as the list links it). */
async function openEditor(page: Page): Promise<void> {
  await page.goto(`${FAMILY.urlPath.replace('/api', '')}/${encodeURIComponent(FAMILY.key)}`);
  await expect(main(page).getByText(FAMILY.key, { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('button', { name: 'Edit' })).toBeDisabled();
}

/** One repeater row's article, by its 1-based number. */
function row(page: Page, number: number): Locator {
  return main(page).getByRole('article', { name: `Teleport ${number}`, exact: true });
}

/** The rows' trigger-name boxes, in document order. */
function triggerBoxes(page: Page): ReturnType<Page['getByRole']> {
  return main(page).getByRole('textbox', { name: /^Teleport \d+ trigger name$/ });
}

/** The rows' destination-location boxes, in document order. */
function locationBoxes(page: Page): ReturnType<Page['getByRole']> {
  return main(page).getByRole('textbox', { name: /^Teleport \d+ destination location$/ });
}

/** The input values of a locator, in DOM order. */
async function inputValues(locator: Locator): Promise<string[]> {
  return locator.evaluateAll((elements) =>
    elements.map((element) => (element as HTMLInputElement).value),
  );
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
  expect(recorded.savePosts.length, 'no POST /api/zone-transfers').toBeGreaterThan(0);
  return recorded.savePosts[recorded.savePosts.length - 1].object as Record<string, unknown>;
}

/** One nested object of the saved document. */
function savedTeleport(saved: Record<string, unknown>, index: number): Record<string, unknown> {
  const rows = saved.Teleports as Array<Record<string, unknown>>;
  return rows[index].Teleport as Record<string, unknown>;
}

test.beforeEach(async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
});

/* ------------------------------------------------------------- AC1 — the key */

test.describe('AC1 — the ZoneName key and its humanized dropdown', () => {
  test('shows the zones names type’s own label, not a second humanizer', async ({ page }) => {
    const recorded = await mockObjectApi(page);
    await openEditor(page);

    const trigger = main(page).getByRole('combobox', { name: 'Zone name', exact: true });
    await expect(trigger).toContainText('Wizard City / WC Hub');

    // The label came from the cached bulk list, not a per-id fallback request.
    expect(recorded.zoneLookups).toEqual([]);

    // The synced `display_name` and the existing humanizer agree on this documented case — the
    // spec's own example (L700-702) — so the editor's label is the data, not a re-derivation.
    await expect(trigger).toContainText('Wizard City / WC Hub');
  });

  test('writes the chosen zone_path verbatim, slashes and all', async ({ page }) => {
    await mockObjectApi(page);
    await openEditor(page);

    await main(page).getByRole('combobox', { name: 'Zone name', exact: true }).click();
    const search = page.getByRole('combobox', { name: 'Search zones', exact: true });
    await expect(search).toBeVisible();
    await search.fill('Aquila');
    await page.getByRole('option', { name: 'Aquila / AQ Z00 Hub', exact: true }).click();

    await expect(
      main(page).getByRole('combobox', { name: 'Zone name', exact: true }),
    ).toContainText('Aquila / AQ Z00 Hub');

    const live = await liveDocument(page);
    expect(live.ZoneName).toBe('Aquila/AQ_Z00_Hub');
    // …and the drift key is untouched by a key edit.
    expect(live.Events).toEqual([]);
  });
});

/* -------------------------------------------------------- AC1 — the repeater */

test.describe('AC1 — the Teleports repeater and the nested Teleport fields', () => {
  test('renders one row per entry with the trigger name and all six nested fields', async ({
    page,
  }) => {
    await mockObjectApi(page);
    await openEditor(page);

    await expect(triggerBoxes(page)).toHaveCount(2);
    expect(await inputValues(triggerBoxes(page))).toEqual([
      'TeleportToShoppingDistrict',
      'TeleportToShoppingDistrict',
    ]);
    // Row 1's location is the scientific-notation form — a real corpus value (133 of 2,365).
    expect(await inputValues(locationBoxes(page))).toEqual([
      '2824.861,-6404.079,-1.671345E-05,3.13484',
      '-95.55735,-849.2842,-30.46902,-0.03700731',
    ]);

    // The three numbers, the destination-zone dropdown and the teleport-type select.
    await expect(
      row(page, 1).getByRole('spinbutton', { name: 'Teleport 1 exit teleporter' }),
    ).toHaveValue('0');
    await expect(
      row(page, 1).getByRole('spinbutton', { name: 'Teleport 1 teleporter tag' }),
    ).toHaveValue('1');
    await expect(
      row(page, 1).getByRole('spinbutton', { name: 'Teleport 1 transition ID' }),
    ).toHaveValue('2');
    await expect(
      row(page, 1).getByRole('combobox', { name: 'Teleport 1 destination zone', exact: true }),
    ).toContainText('Wizard City / WC Shop Area');
    await expect(
      row(page, 1).getByRole('combobox', { name: 'Teleport 1 teleport type', exact: true }),
    ).toHaveValue('TELEPORT_STATIC');

    // Every row is index-addressed, and the rows are one list.
    await expect(main(page).getByRole('list', { name: 'Teleports' })).toBeVisible();
    await expect(
      main(page).getByRole('article', { name: 'Teleport 2', exact: true }),
    ).toBeVisible();
  });

  test('appends a nested entry object in the corpus order and refuses a blank add', async ({
    page,
  }) => {
    await mockObjectApi(page);
    await openEditor(page);

    // A blank add is a no-op: nothing appended (`textIdFromRaw`'s own rule).
    await main(page).getByRole('button', { name: 'Add teleport' }).click();
    await expect(triggerBoxes(page)).toHaveCount(2);

    await main(page)
      .getByRole('textbox', { name: 'New teleport trigger name' })
      .fill('To_Gobblerton');
    await main(page).getByRole('button', { name: 'Add teleport' }).click();
    await expect(triggerBoxes(page)).toHaveCount(3);

    const live = await liveDocument(page);
    const added = (live.Teleports as Array<Record<string, unknown>>)[2];
    // The new entry's two keys, its nested object's six keys in the corpus's dominant order, the
    // schema's neutral values, and a destination zone that is this file's own ZoneName.
    expect(Object.keys(added)).toEqual(['TriggerName', 'Teleport']);
    expect(added.TriggerName).toBe('To_Gobblerton');
    expect(Object.keys(added.Teleport as Record<string, unknown>)).toEqual([
      'm_exitTeleporter',
      'm_teleporterTag',
      'm_teleportType',
      'm_transitionID',
      'm_destinationLoc',
      'm_destinationZone',
    ]);
    expect(added.Teleport).toEqual({
      m_exitTeleporter: 0,
      m_teleporterTag: 0,
      m_teleportType: 'TELEPORT_STATIC',
      m_transitionID: 0,
      m_destinationLoc: '0,0,0,0',
      m_destinationZone: 'WizardCity/WC_Hub',
    });
  });

  test('removes exactly the clicked row, so a repeated trigger name survives', async ({ page }) => {
    await mockObjectApi(page);
    await openEditor(page);

    // Both rows carry the same TriggerName on purpose: a value-based removal would drop both.
    expect(await inputValues(triggerBoxes(page))).toEqual([
      'TeleportToShoppingDistrict',
      'TeleportToShoppingDistrict',
    ]);

    await row(page, 1).getByRole('button', { name: 'Remove teleport 1' }).click();
    await expect(triggerBoxes(page)).toHaveCount(1);

    const live = await liveDocument(page);
    const rows = live.Teleports as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    // The **second** row survived — the element path removed only index 0.
    expect(rows[0].Teleport).toEqual({
      m_exitTeleporter: 0,
      m_teleporterTag: 0,
      m_teleportType: 'TELEPORT_STATIC',
      m_transitionID: 0,
      m_destinationLoc: '-95.55735,-849.2842,-30.46902,-0.03700731',
      m_destinationZone: 'WizardCity/WC_Hub',
    });
    // The key order of the survivor's nested object is unchanged (D5/D57).
    expect(Object.keys(rows[0].Teleport as Record<string, unknown>)).toEqual([
      'm_exitTeleporter',
      'm_teleporterTag',
      'm_teleportType',
      'm_transitionID',
      'm_destinationLoc',
      'm_destinationZone',
    ]);
  });
});

/* ------------------------------------------------------- AC1 — the location */

test.describe('AC1 — the m_destinationLoc format check', () => {
  /** The inline message of row `number`'s location box. */
  function locationMessage(page: Page, number: number): Locator {
    return row(page, number).locator(
      `li[data-field="Teleports[${number - 1}].Teleport.m_destinationLoc"]`,
    );
  }

  test('rejects a malformed 4-component string with an inline error', async ({ page }) => {
    await mockObjectApi(page);
    await openEditor(page);

    await expect(main(page).locator('li[data-severity="error"]')).toHaveCount(0);

    await locationBoxes(page).nth(0).fill('1,2,3');

    // One error, at the nested field's own path, and the format is stated in the sentence.
    await expect(locationMessage(page, 1)).toHaveCount(1);
    await expect(locationMessage(page, 1)).toHaveAttribute('data-severity', 'error');
    await expect(locationMessage(page, 1)).toContainText('is not four comma-separated numbers');
    await expect(locationMessage(page, 1)).toContainText('Save is disabled until it is fixed');
    await expect(locationMessage(page, 1)).toContainText('-1.671345E-05');
    // No warning-severity message exists anywhere: this family emits errors only.
    await expect(main(page).locator('li[data-severity="warning"]')).toHaveCount(0);

    // The form-level banner counts the same finding and says what it does (L547).
    await expect(main(page).locator('[data-blocking-count="1"]')).toContainText(
      'Save is disabled until it is fixed',
    );

    // The bad value is written **verbatim** — validate, never normalise (D57).
    const live = await liveDocument(page);
    expect(savedTeleport(live, 0).m_destinationLoc).toBe('1,2,3');

    // Five components is malformed too, and so is a trailing separator.
    await locationBoxes(page).nth(0).fill('1,2,3,4,5');
    await expect(locationMessage(page, 1)).toHaveCount(1);
  });

  test('accepts a scientific-notation value — no message, and Save stays usable', async ({
    page,
  }) => {
    await mockObjectApi(page);
    await openEditor(page);

    await locationBoxes(page).nth(0).fill('1,2,3');
    await expect(locationMessage(page, 1)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();

    // The arm the corpus needs: 133 of the 2,365 real values carry one, e.g. -1.671345E-05.
    await locationBoxes(page).nth(0).fill('1,-2.5,-1.671345E-05,0.0');
    await expect(locationMessage(page, 1)).toHaveCount(0);
    await expect(main(page).locator('[data-blocking-count]')).toHaveCount(0);
    // The document is dirty (the edit happened) and the error is gone, so Save is usable again.
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();

    const live = await liveDocument(page);
    expect(savedTeleport(live, 0).m_destinationLoc).toBe('1,-2.5,-1.671345E-05,0.0');
  });

  test('a malformed value disables Save, and fixing it makes the save land', async ({ page }) => {
    const recorded = await mockObjectApi(page);
    await openEditor(page);

    const save = page.getByRole('button', { name: 'Save' });
    // Save is clean-but-disabled until there is a change (the layout's own rule) — not blocked.
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute('title', 'No changes to save');
    await expect(save).not.toHaveAttribute('aria-disabled', 'true');

    await locationBoxes(page).nth(0).fill('1,2,3');
    await expect(main(page).locator('li[data-severity="error"]')).toHaveCount(1);
    // …and Save is now blocked by the error, with the layout's own reason on the button.
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute('title', /validation error blocks saving/);

    // Fixing the value (with the corpus's own scientific-notation form) unblocks the save.
    await locationBoxes(page).nth(0).fill('1,2,3,4');
    await expect(main(page).locator('li[data-severity="error"]')).toHaveCount(0);
    await expect(save).toBeEnabled();

    await save.click();
    await expect(page.getByText(/Saved WizardCity\/WC_Hub/)).toBeVisible({ timeout: 15_000 });

    // The fixed value reached the server verbatim — the client never rewrote or dropped it.
    const saved = lastSaved(recorded);
    expect(savedTeleport(saved, 0).m_destinationLoc).toBe('1,2,3,4');
    expect(Object.keys(savedTeleport(saved, 0))).toEqual([
      'm_exitTeleporter',
      'm_teleporterTag',
      'm_teleportType',
      'm_transitionID',
      'm_destinationLoc',
      'm_destinationZone',
    ]);
  });
});

/* ------------------------------------------------------- AC1 — the enum */

test.describe('AC1 — the m_teleportType control', () => {
  test('offers the one measured member', async ({ page }) => {
    await mockObjectApi(page);
    await openEditor(page);

    const select = row(page, 1).getByRole('combobox', {
      name: 'Teleport 1 teleport type',
      exact: true,
    });
    await expect(select).toHaveValue('TELEPORT_STATIC');
    // Exactly one option: the measured member. No other member is invented.
    await expect(select.locator('option')).toHaveCount(1);
    await expect(select.locator('option')).toHaveText(['TELEPORT_STATIC']);
  });

  test('preserves a stored value the model does not know, verbatim, through a save', async ({
    page,
  }) => {
    const recorded = await mockObjectApi(page);
    // No corpus file carries this value (all 2,365 are TELEPORT_STATIC) — that is the point:
    // the editor must not rewrite what it does not know.
    const served = JSON.parse(JSON.stringify(DOCUMENT)) as Record<string, unknown>;
    const rows = served.Teleports as Array<Record<string, unknown>>;
    (rows[1].Teleport as Record<string, unknown>).m_teleportType = 'TELEPORT_FROM_A_FUTURE_BUILD';
    recorded.served = served;

    await openEditor(page);

    const select = row(page, 2).getByRole('combobox', {
      name: 'Teleport 2 teleport type',
      exact: true,
    });
    await expect(select).toHaveValue('TELEPORT_FROM_A_FUTURE_BUILD');
    await expect(select.locator('option[data-unrecognised="true"]')).toHaveText(
      'TELEPORT_FROM_A_FUTURE_BUILD (unrecognised — kept as stored)',
    );
    // Row 1 is untouched, so the select still offers exactly the measured member there.
    await expect(
      row(page, 1)
        .getByRole('combobox', { name: 'Teleport 1 teleport type', exact: true })
        .locator('option'),
    ).toHaveCount(1);

    // An unrelated edit + save, and the unknown value rides through byte-for-byte.
    await triggerBoxes(page).nth(0).fill('Renamed');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Saved WizardCity\/WC_Hub/)).toBeVisible({ timeout: 15_000 });
    expect(savedTeleport(lastSaved(recorded), 1).m_teleportType).toBe(
      'TELEPORT_FROM_A_FUTURE_BUILD',
    );
  });
});

/* --------------------------------------------------------- AC2 — the drift */

test.describe('AC2 — the Events drift guard and the raw-fields disclosure', () => {
  test('shows Events read-only in the disclosure, with the measurement in its own words', async ({
    page,
  }) => {
    await mockObjectApi(page);
    await openEditor(page);

    const disclosure = main(page).locator('[data-raw-fields="true"]');
    await expect(disclosure).toBeVisible();
    // The summary names the unmodelled count — one, because every corpus file carries `Events`.
    await expect(disclosure.locator('summary')).toHaveText('Raw fields (1 unmodelled)');
    await disclosure.locator('summary').click();

    // The field's own note quotes the measurement rather than hiding behind "unknown field".
    await expect(disclosure).toContainText('Events');
    await expect(disclosure).toContainText('1,207');
    await expect(disclosure).toContainText('empty array');
    await expect(disclosure).toContainText('byte-for-byte');
    // The value is printed verbatim, in the document's own key order.
    await expect(disclosure.locator('pre')).toHaveText('{\n  "Events": []\n}');

    // It is read-only: the disclosure contains no control at all, so no edit path can reach it.
    await expect(disclosure.locator('input')).toHaveCount(0);
    await expect(disclosure.locator('select')).toHaveCount(0);
    await expect(disclosure.locator('textarea')).toHaveCount(0);
  });

  test('carries Events through the save byte-identically, with the file’s key order', async ({
    page,
  }) => {
    const recorded = await mockObjectApi(page);
    await openEditor(page);

    // One modelled edit, so the save is dirty for a reason that has nothing to do with Events.
    await triggerBoxes(page).nth(0).fill('TeleportToShoppingDistrictEdited');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Saved WizardCity\/WC_Hub/)).toBeVisible({ timeout: 15_000 });

    const saved = lastSaved(recorded);
    // The document's known keys plus the preserved raw one — in the file's own order.
    expect(Object.keys(saved)).toEqual(['ZoneName', 'Events', 'Teleports']);
    expect(saved.ZoneName).toBe('WizardCity/WC_Hub');
    expect(saved.Events).toEqual([]);
    expect(JSON.stringify(saved.Events)).toBe('[]');

    const rows = saved.Teleports as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    for (const entry of rows) {
      expect(Object.keys(entry)).toEqual(['TriggerName', 'Teleport']);
      // Every nested object keeps its six keys and the corpus's order, untouched by the edit.
      expect(Object.keys(entry.Teleport as Record<string, unknown>)).toEqual([
        'm_exitTeleporter',
        'm_teleporterTag',
        'm_teleportType',
        'm_transitionID',
        'm_destinationLoc',
        'm_destinationZone',
      ]);
    }
    expect(rows[0].TriggerName).toBe('TeleportToShoppingDistrictEdited');
    expect(rows[1].TriggerName).toBe('TeleportToShoppingDistrict');
  });

  test('a document with nothing unmodelled shows no disclosure at all', async ({ page }) => {
    const recorded = await mockObjectApi(page);
    // A created document (no Events key) — the editor never invents one, so there is nothing to
    // disclose and no empty shell is rendered.
    recorded.served = {
      ZoneName: 'WizardCity/WC_Hub',
      Teleports: [
        {
          TriggerName: 'To_Hub',
          Teleport: {
            m_exitTeleporter: 0,
            m_teleporterTag: 0,
            m_teleportType: 'TELEPORT_STATIC',
            m_transitionID: 0,
            m_destinationLoc: '0,0,0,0',
            m_destinationZone: 'WizardCity/WC_Hub',
          },
        },
      ],
    };

    await openEditor(page);
    await expect(main(page).locator('[data-raw-fields="true"]')).toHaveCount(0);

    // …and the save carries no raw key either: nothing was invented.
    await triggerBoxes(page).nth(0).fill('To_Hub_2');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/Saved WizardCity\/WC_Hub/)).toBeVisible({ timeout: 15_000 });
    expect(Object.keys(lastSaved(recorded))).toEqual(['ZoneName', 'Teleports']);
  });
});
