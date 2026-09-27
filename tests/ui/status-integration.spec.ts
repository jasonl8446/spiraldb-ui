import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

/**
 * Story p4-08's tier-1 UI spec (plan task 4.10; decisions D40/D44, D51(e), D52, D71(i), D75(j)):
 * **status integration for every object type** — AC1's sentence ("Mark Reviewed with notes on a
 * DropTable → the history endpoint + the list-page dot + the filter-tab counts all update") and
 * the half of AC1 that says **every detail page** carries a `StatusBadge` + mark actions +
 * history panel.
 *
 * Hermetic by construction: one dispatcher fulfils every `/api/**` request from the fixtures
 * below, so the run reaches neither the dev stack's SQLite file nor the D17 clone. The wire
 * contracts are copied literally (the reason `object-list.spec.ts`, `quests-status.spec.ts` and
 * `global-registry-editor.spec.ts` do the same): a fixture that imported `client/src/lib/
 * status-transition.ts` could only prove the client agrees with itself.
 *
 * | the AC's words | arm | test |
 * |---|---|---|
 * | AC1 "Mark Reviewed with notes on a DropTable" | header action → notes dialog → PATCH with `{status, notes}` and **no `changed_by`** | AC1 flow #1 |
 * | AC1 "the history endpoint … update[s]" | the `GET …/history` re-read happens and its note renders in the panel | AC1 flow #1 |
 * | AC1 "list-page dot … update[s]" | same family, also on a family whose detail page never reads the list (NpcInventory) | AC1 flow #1/#2 |
 * | AC1 "filter-tab counts … update" | the Reviewed tab goes 0 → 1 and Extracted 2 → 1 after the refetch | AC1 flow #1 |
 * | AC1 "**every** detail page has a StatusBadge + mark actions + history panel" | one test per tracked family | presence (×7) |
 * | D75(j)/p4-07 AC3 "`global_registry` … body in `STATUS_OBJECT_TYPES`" | no badge, no action, no panel, **zero** status requests | absence |
 *
 * ## What this spec proves, and what it cannot
 *
 * The mocked status surface is **stateful**: the PATCH handler moves the entry in the fixture's
 * own store and appends the history row, so the list and the history the page re-reads really
 * carry the new status. What that proves is the **client** half — that a transition invalidates
 * and re-reads the two surfaces that must move (the row's dot, the summary the tabs count) —
 * plus the exact request bodies. The **server** half (the `entry_status`/`status_history` rows
 * really written, per family) is `tests/unit/object-status-pipeline.test.ts`, which drives the
 * real routers over a throwaway repo.
 *
 * ## The accessible-name vocabulary this spec addresses
 *
 * `Mark Reviewed` / `Mark Verified` (buttons, `aria-disabled` on the entry's own status) ·
 * `Status: {Extracted|Reviewed|Verified}` (the badge's `aria-label` and the table dot's sr-only
 * text) · the notes dialog `Mark Reviewed|Mark Verified` (role=dialog, description `Mark {key}
 * as {status}?`, `Notes (optional)`, confirm labelled with the action) · `Status History`
 * (heading level 2) · filter tabs `All|Extracted|Reviewed|Verified` (accessible name = label +
 * count badge) · `Back to {label}`.
 */

/* ------------------------------------------------------------------- fixtures */

type Status = 'extracted' | 'reviewed' | 'verified';

interface FamilyFixture {
  readonly fileType: string;
  readonly label: string;
  readonly urlPath: string;
  /** D4 plural status route, or `null` for the editor-only family (Q1/D75(j)). */
  readonly routeType: string | null;
  /** D4 singular `entry_status.object_type`, or `null`. */
  readonly objectType: string | null;
  readonly listPath: string;
  readonly detailPath: string;
  readonly key: string;
  /** Every row the list serves; `key` is the entry the detail route opens. */
  readonly rows: readonly string[];
  readonly document: Record<string, unknown>;
}

const DROP_A = 'DS-ACAD1-C01-001';
const DROP_B = 'DS-ACAD1-C01-002';

/** The eight families, spelled exactly as `shared/objectTypes.ts` spells them. */
const FAMILIES: readonly FamilyFixture[] = [
  {
    fileType: 'droptable',
    label: 'Drop Tables',
    urlPath: '/api/drop-tables',
    routeType: 'drop_tables',
    objectType: 'drop_table',
    listPath: '/drop-tables',
    detailPath: `/drop-tables/${DROP_A}`,
    key: DROP_A,
    rows: [DROP_A, DROP_B],
    document: { Name: DROP_A, Description: '', RollChance: 1.0, Items: [] },
  },
  {
    fileType: 'npcinventory',
    label: 'NPC Inventories',
    urlPath: '/api/npc-inventories',
    routeType: 'npc_inventories',
    objectType: 'npc_inventory',
    listPath: '/npc-inventories',
    detailPath: '/npc-inventories/1025',
    key: '1025',
    rows: ['1025', '1026'],
    document: { TemplateID: 1025, Inventory: [160936] },
  },
  {
    fileType: 'npcspellinventory',
    label: 'NPC Spell Inventories',
    urlPath: '/api/npc-spell-inventories',
    routeType: 'npc_spell_inventories',
    objectType: 'npc_spell_inventory',
    listPath: '/npc-spell-inventories',
    detailPath: '/npc-spell-inventories/1057',
    key: '1057',
    rows: ['1057'],
    document: { TemplateID: 1057, Spells: [] },
  },
  {
    fileType: 'creaturespellbook',
    label: 'Creature Spellbooks',
    urlPath: '/api/creature-spellbooks',
    routeType: 'creature_spellbooks',
    objectType: 'creature_spellbook',
    listPath: '/creature-spellbooks',
    detailPath: '/creature-spellbooks/p4-08-deck',
    key: 'p4-08-deck',
    rows: ['p4-08-deck'],
    document: { DeckName: 'p4-08-deck', SpellTemplateIds: [] },
  },
  {
    fileType: 'npcdroptable',
    label: 'NPC Drop Tables',
    urlPath: '/api/npc-drop-tables',
    routeType: 'npc_drop_tables',
    objectType: 'npc_drop_table',
    listPath: '/npc-drop-tables',
    detailPath: '/npc-drop-tables/12345',
    key: '12345',
    rows: ['12345'],
    document: { TemplateID: 12345, DropTableNames: [] },
  },
  {
    fileType: 'treasurecardinventory',
    label: 'Treasure Card Inventories',
    urlPath: '/api/treasure-card-inventories',
    routeType: 'treasure_card_inventories',
    objectType: 'treasure_card_inventory',
    listPath: '/treasure-card-inventories',
    detailPath: '/treasure-card-inventories/2019',
    key: '2019',
    rows: ['2019'],
    document: { TemplateID: 2019, TreasureCards: [] },
  },
  {
    fileType: 'zonetransfer',
    label: 'Zone Transfers',
    urlPath: '/api/zone-transfers',
    routeType: 'zone_transfers',
    objectType: 'zone_transfer',
    listPath: '/zone-transfers',
    detailPath: '/zone-transfers/WizardCity%2FWC_Hub',
    key: 'WizardCity/WC_Hub',
    rows: ['WizardCity/WC_Hub'],
    document: { ZoneName: 'WizardCity/WC_Hub', Teleports: [] },
  },
  {
    fileType: 'globalregistry',
    label: 'Global Registry',
    urlPath: '/api/global-registry',
    routeType: null,
    objectType: null,
    listPath: '/global-registry',
    detailPath: '/global-registry',
    // The unkeyed family's "key" is the convention file name the save writes
    // (`GLOBAL_REGISTRY_FILE_NAME`), not a URL segment — there is nothing to select
    // (docs/spec-api.md L474, p4-07). The list's rows are file **stems**, hence `rows` below.
    key: 'globalregistry.json',
    rows: ['globalregistry'],
    document: { GlobalRegistryValues: { Christmas: 0, Halloween: 0 } },
  },
];

const TRACKED = FAMILIES.filter(
  (family): family is FamilyFixture & { routeType: string; objectType: string } =>
    family.routeType !== null && family.objectType !== null,
);

interface HistoryRow {
  old_status: Status | null;
  new_status: Status;
  notes: string | null;
  changed_by: string | null;
  changed_at: string | null;
}

interface Recorded {
  /** Every `PATCH /api/status/…` body, in order. */
  readonly patches: Array<Record<string, unknown>>;
  readonly patchPaths: string[];
  /** Every `/api/status/…` URL the pages asked for (AC3's absence arm reads this). */
  readonly statusRequests: string[];
  readonly historyRequests: string[];
  /** How many times each family's list endpoint was hit. */
  readonly listRequests: Record<string, number>;
}

interface MockOptions {
  /** The store's initial status, per `${objectType}:${key}`; default `extracted`. */
  readonly statuses?: Record<string, Status>;
}

interface MockState {
  readonly recorded: Recorded;
  /** The live status per `${objectType}:${key}` — the PATCH moves it. */
  readonly statuses: Map<string, Status>;
  readonly history: Map<string, HistoryRow[]>;
}

/**
 * One dispatcher for the whole `/api/**` surface: settings, sync, the import probe, the names
 * tables, each family's list + detail, and the status list / PATCH / history. A single handler
 * (rather than a dozen `page.route` calls) is what makes the statefulness obvious — the PATCH
 * writes the same maps the list and the history read.
 */
async function mockApi(page: Page, options: MockOptions = {}): Promise<MockState> {
  const statuses = new Map<string, Status>();
  for (const [id, status] of Object.entries(options.statuses ?? {})) {
    statuses.set(id, status);
  }
  const history = new Map<string, HistoryRow[]>();
  const recorded: Recorded = {
    patches: [],
    patchPaths: [],
    statusRequests: [],
    historyRequests: [],
    listRequests: {},
  };
  const state: MockState = { recorded, statuses, history };

  let settings: Record<string, string> = {
    aurorium_path: '/mock/aurorium',
    imcodec_path: '/mock/imcodec',
    spiraldb_path: '/mock/spiraldb',
    user_name: 'Mock Reviewer',
    git_branch: 'content/2026-09-27',
  };

  const statusOf = (family: FamilyFixture, key: string): Status =>
    statuses.get(`${family.objectType}:${key}`) ?? 'extracted';

  const entryRow = (family: FamilyFixture, key: string): Record<string, unknown> => ({
    object_type: family.objectType,
    object_key: key,
    status: statusOf(family, key),
    extracted_at: '2026-06-01T00:00:00.000Z',
    reviewed_at: null,
    verified_at: null,
    latest_notes: null,
  });

  const listBody = (family: FamilyFixture): Record<string, unknown> => {
    const rows = family.rows.map((key) => ({
      key,
      title: key,
      modified_at: '2026-06-01T00:00:00.000Z',
      status: family.objectType === null ? null : statusOf(family, key),
    }));
    const counted = rows.filter((row) => row.status !== null);
    return {
      objects: rows,
      summary:
        family.objectType === null
          ? null
          : {
              total: counted.length,
              extracted: counted.filter((row) => row.status === 'extracted').length,
              reviewed: counted.filter((row) => row.status === 'reviewed').length,
              verified: counted.filter((row) => row.status === 'verified').length,
            },
      skipped: [],
      missing_directory: false,
      duplicate_keys: [],
    };
  };

  await page.route(/\/api\//, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body: unknown): Promise<void> => route.fulfill({ json: body });

    // The shell's own boot reads (Header, the identity gate, the import toast).
    if (path === '/api/settings') {
      if (method === 'PUT') {
        settings = { ...settings, ...((request.postDataJSON() ?? {}) as Record<string, string>) };
      }
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
    // The synced names tables the forms' dropdowns read (empty: tier-1 has no WAD data, D44).
    if (path.startsWith('/api/names/')) {
      const segments = path.slice('/api/names/'.length).split('/');
      if (segments.length === 1) {
        await json({ [segments[0] as string]: [] });
      } else {
        await route.fulfill({ status: 404, json: { error: 'no such name' } });
      }
      return;
    }

    /* ----------------------------------------------------------- the status API */
    if (path.startsWith('/api/status/')) {
      recorded.statusRequests.push(path);
      const segments = path.slice('/api/status/'.length).split('/');
      const routeType = segments[0] ?? '';
      const family = FAMILIES.find((row) => row.routeType === routeType);
      if (family === undefined || family.routeType === null) {
        // `global_registry` (or anything unknown): the route does not exist (D75(j)).
        await route.fulfill({ status: 404, json: { error: `Unknown status type "${routeType}"` } });
        return;
      }
      if (segments.length === 1) {
        const all = family.rows.map((key) => entryRow(family, key));
        await json({
          entries: all,
          summary: {
            total: all.length,
            extracted: all.filter((row) => row.status === 'extracted').length,
            reviewed: all.filter((row) => row.status === 'reviewed').length,
            verified: all.filter((row) => row.status === 'verified').length,
          },
        });
        return;
      }
      const key = decodeURIComponent(segments[1] ?? '');
      if (segments.length === 3 && segments[2] === 'history') {
        recorded.historyRequests.push(path);
        await json({ history: history.get(key) ?? [] });
        return;
      }
      if (segments.length === 2 && method === 'PATCH') {
        const body = (request.postDataJSON() ?? {}) as { status: Status; notes?: string };
        recorded.patches.push(body as Record<string, unknown>);
        recorded.patchPaths.push(path);
        statuses.set(`${family.objectType}:${key}`, body.status);
        const rows = history.get(key) ?? [];
        rows.push({
          old_status: 'extracted',
          new_status: body.status,
          notes: body.notes ?? null,
          changed_by: settings.user_name ?? null,
          changed_at: '2026-09-27T00:00:00.000Z',
        });
        history.set(key, rows);
        await json(entryRow(family, key));
        return;
      }
      await route.fulfill({ status: 404, json: { error: `unmocked status ${method} ${path}` } });
      return;
    }

    /* --------------------------------------------------------- the family routes */
    const family = FAMILIES.find(
      (row) => path === row.urlPath || path.startsWith(`${row.urlPath}/`),
    );
    if (family === undefined) {
      await route.fulfill({ status: 404, json: { error: `unmocked ${method} ${path}` } });
      return;
    }
    if (path === family.urlPath) {
      recorded.listRequests[family.fileType] = (recorded.listRequests[family.fileType] ?? 0) + 1;
      if (method === 'POST') {
        await json({
          key: family.key,
          file_type: family.fileType,
          object_type: family.objectType,
          outcome: 'updated',
          action: 'update',
          commit: 'a'.repeat(40),
          branch: settings.git_branch,
          commit_message: `spiraldb: update ${family.objectType ?? family.fileType} ${family.key}`,
          file: `${family.label}/${family.key}.json`,
          status: null,
          status_created: false,
          warnings: [],
        });
        return;
      }
      await json(listBody(family));
      return;
    }
    const key = decodeURIComponent(path.slice(`${family.urlPath}/`.length));
    if (key !== family.key) {
      await route.fulfill({ status: 404, json: { error: `Unknown entry "${key}"` } });
      return;
    }
    await json(family.document);
  });

  return state;
}

/* ------------------------------------------------------------------ locators */

const main = (page: Page): Locator => page.getByRole('main');

const badge = (page: Page, status: Status): Locator => main(page).getByLabel(`Status: ${status}`);

/** The notes dialog, named by its title (the action label verbatim). */
const notesDialog = (page: Page, title: string): Locator =>
  page.getByRole('dialog', { name: title });

/** One filter tab of the generic list page (its accessible name is the label + the count). */
function filterTab(page: Page, nounPlural: string, label: string): Locator {
  return page
    .getByRole('tablist', { name: `Filter ${nounPlural} by status` })
    .getByRole('tab', { name: new RegExp(`^${label} `) });
}

/** The first data row of the generic table. */
const firstRow = (page: Page): Locator => page.locator('tbody tr').first();

const BADGE: Record<Status, string> = {
  extracted: 'Status: Extracted',
  reviewed: 'Status: Reviewed',
  verified: 'Status: Verified',
};

/* -------------------------------------------------------------------- AC1 flow */

test.describe('AC1: Mark Reviewed with notes on a DropTable moves the entry, its history and its list', () => {
  test('the dialog, the PATCH body, the history note, the row dot and the tab counts', async ({
    page,
  }) => {
    const state = await mockApi(page);
    await page.goto('/drop-tables');

    // Before: two extracted rows, so the counts have somewhere to move to.
    await expect(filterTab(page, 'drop tables', 'Extracted')).toContainText('2');
    await expect(filterTab(page, 'drop tables', 'Reviewed')).toContainText('0');
    await expect(firstRow(page)).toContainText('Status: Extracted');

    // Into the detail page through the row's own link (the AC's own route).
    await page.getByRole('link', { name: DROP_A, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/drop-tables/${DROP_A}$`));
    await expect(badge(page, 'extracted')).toBeVisible();
    await expect(main(page).getByRole('heading', { name: 'Status History' })).toBeVisible();

    // The mark action is available for a status the entry is not in.
    const markReviewed = main(page).getByRole('button', { name: 'Mark Reviewed' });
    await expect(markReviewed).toHaveAttribute('aria-disabled', 'false');
    await expect(main(page).getByRole('button', { name: 'Mark Verified' })).toHaveAttribute(
      'aria-disabled',
      'false',
    );

    await markReviewed.click();
    const dialog = notesDialog(page, 'Mark Reviewed');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(`Mark ${DROP_A} as reviewed?`)).toBeVisible();
    await expect(dialog.getByLabel('Notes (optional)')).toBeVisible();
    await dialog.getByLabel('Notes (optional)').fill('Checked the roll table by hand.');
    await dialog.getByRole('button', { name: 'Mark Reviewed' }).click();

    // The list surface's own state before the write: one hit, from the list page.
    const listRequestsBeforePatch = state.recorded.listRequests.droptable ?? 0;

    // The wire: the route, the exact body (no `changed_by` — the server attributes from the
    // session's `user_name`, D37/D38), and the note the entry carries into its history.
    await expect.poll(() => state.recorded.patches.length).toBe(1);
    expect(state.recorded.patchPaths).toEqual([`/api/status/drop_tables/${DROP_A}`]);
    expect(state.recorded.patches[0]).toEqual({
      status: 'reviewed',
      notes: 'Checked the roll table by hand.',
    });

    // The history endpoint is re-read after the transition, and the panel shows the note.
    await expect.poll(() => state.recorded.historyRequests.length).toBeGreaterThan(1);
    await expect(main(page).getByText('marked reviewed')).toBeVisible();
    await expect(main(page).getByText('Checked the roll table by hand.')).toBeVisible();
    await expect(main(page).getByText('by Mock Reviewer')).toBeVisible();

    // The badge moved, and the entry's own status action is now the unavailable one.
    await expect(badge(page, 'reviewed')).toBeVisible();
    await expect(main(page).getByRole('button', { name: 'Mark Reviewed' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    // The list surface refetched **because of the transition** (its query was invalidated) —
    // here right on the detail page, because this family's own duplicate-name rule keeps the
    // same list query active (`DropTableDetailPage`'s corpus read). The next test proves the
    // other path: a family whose detail page has no such read, so the invalidated query is
    // refetched when the list page mounts again.
    // The REFETCH is the claim; the patience is not. A stricter timeout here was flaky under the
    // full parallel suite at peak host load: this family's detail page reads the 317-row corpus
    // list itself (the duplicate-name rule), so the invalidated refetch can queue behind many
    // workers and exceed the 10s configured expect timeout while the assertion itself is correct.
    // Raised rather than relaxed (D67(d)): the assertion still requires a refetch that did not
    // happen before the transition.
    await expect
      .poll(() => state.recorded.listRequests.droptable ?? 0, { timeout: 30_000 })
      .toBeGreaterThan(listRequestsBeforePatch);

    // Back to the list: the dot and the counts render the payload the refetch replaced.
    await page.getByRole('link', { name: /Back to Drop Tables/ }).click();
    await expect(page).toHaveURL(/\/drop-tables$/);
    await expect(firstRow(page)).toContainText('Status: Reviewed');
    await expect(filterTab(page, 'drop tables', 'Reviewed')).toContainText('1');
    await expect(filterTab(page, 'drop tables', 'Extracted')).toContainText('1');
  });

  test('a family whose detail page never reads its list still refetches it on return', async ({
    page,
  }) => {
    // NpcInventory: `ObjectDetailPage` fetches only the document and the status, so the list
    // query is *not* active while its dot is marked — the invalidation is the only thing that
    // can make the list page reload it, which is exactly AC1's claim.
    const state = await mockApi(page);
    await page.goto('/npc-inventories');
    await expect(filterTab(page, 'NPC inventories', 'Reviewed')).toContainText('0');

    await page.getByRole('link', { name: '1025', exact: true }).click();
    await expect(page).toHaveURL(/\/npc-inventories\/1025$/);
    await main(page).getByRole('button', { name: 'Mark Reviewed' }).click();
    const dialog = notesDialog(page, 'Mark Reviewed');
    await dialog.getByLabel('Notes (optional)').fill('inventory rows match the vendor list');
    await dialog.getByRole('button', { name: 'Mark Reviewed' }).click();
    await expect.poll(() => state.recorded.patches.length).toBe(1);
    expect(state.recorded.patches[0]).toEqual({
      status: 'reviewed',
      notes: 'inventory rows match the vendor list',
    });

    const listRequestsBefore = state.recorded.listRequests.npcinventory ?? 0;
    await page.getByRole('link', { name: /Back to NPC Inventories/ }).click();
    await expect
      .poll(() => state.recorded.listRequests.npcinventory ?? 0)
      .toBeGreaterThan(listRequestsBefore);
    await expect(firstRow(page)).toContainText('Status: Reviewed');
    await expect(filterTab(page, 'NPC inventories', 'Reviewed')).toContainText('1');
    await expect(filterTab(page, 'NPC inventories', 'Extracted')).toContainText('1');
  });
});

/* --------------------------------------------------- AC1: every tracked detail page */

test.describe('AC1: every tracked detail page has the badge, the mark actions and the history panel', () => {
  for (const family of TRACKED) {
    test(`${family.label} (/${family.fileType})`, async ({ page }) => {
      const state = await mockApi(page);
      await page.goto(family.detailPath);

      await expect(main(page).getByLabel(BADGE.extracted)).toBeVisible();
      await expect(main(page).getByRole('button', { name: 'Mark Reviewed' })).toBeVisible();
      await expect(main(page).getByRole('button', { name: 'Mark Verified' })).toBeVisible();
      await expect(main(page).getByRole('heading', { name: 'Status History' })).toBeVisible();

      // The two reads the panel and the badge depend on: the family's own status route and the
      // entry's history. A family absent from here is a family with no lifecycle surface.
      expect(state.recorded.statusRequests).toContain(`/api/status/${family.routeType}`);
      expect(state.recorded.statusRequests).toContain(
        `/api/status/${family.routeType}/${encodeURIComponent(family.key)}/history`,
      );
    });
  }

  test('global_registry: no badge, no mark actions, no history panel, no status request', async ({
    page,
  }) => {
    const state = await mockApi(page);
    await page.goto('/global-registry');

    // The editor itself is there (p4-07's document), so "absent" means absent, not "empty page".
    await expect(main(page).getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(main(page).getByRole('button', { name: 'Mark Reviewed' })).toHaveCount(0);
    await expect(main(page).getByRole('button', { name: 'Mark Verified' })).toHaveCount(0);
    await expect(main(page).getByRole('heading', { name: 'Status History' })).toHaveCount(0);
    await expect(page.locator('[aria-label^="Status:"]')).toHaveCount(0);
    // The failure mode this pins: `global_registry` must stay out of `STATUS_OBJECT_TYPES`
    // (Q1, D75(j)) — so the page must not even ask.
    expect(state.recorded.statusRequests).toEqual([]);
  });
});
