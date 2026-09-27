import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Story p5-04 (AC1 and AC3) — the offline banner and the API-error surfaces, in a real browser.
 *
 * **Hermetic by construction (D81):** every endpoint this spec's assertions depend on is
 * route-mocked. The harness's dev stack therefore needs no corpus and no developer database — the
 * banner's trigger is a mocked 5xx, the recovery is a mocked health answer, and the "data
 * refreshed" arm is a mocked dashboard body. Nothing here asserts anything a real server
 * happened to answer.
 *
 * The AC1 **live** sequence (kill the Express process, restart it) cannot be route-mocked by
 * definition, and it is not attempted here: it is run against a real rig and recorded as text in
 * `docs/evidence/phase-5/p5-04-d3-proof.md`. This spec proves the *mechanism* — one failed request
 * cycle is enough, nothing needs a reload, and a returning API clears the banner and refreshes
 * the page.
 */

const SETTINGS = {
  aurorium_path: '/mock/aurorium',
  imcodec_path: '/mock/imcodec',
  spiraldb_path: '/mock/spiraldb',
  user_name: 'Mock Reviewer',
  git_branch: 'content/2026-09-27',
} as const;

/** `lib/connection.ts`'s banner copy — the spec's first sentence, and no local-save promise. */
const BANNER_HEADLINE = 'Connection lost.';
const BANNER_DETAIL =
  'Loaded data may be out of date, and saving will fail until the server is back.';

const NPC_KEY = '1025';
const NPC_DOCUMENT = { TemplateID: 1025, Inventory: [160936] };
const ITEM_ROWS = [{ gid: 160936, name: 'Black Mantle' }];

/** The eight tracked buckets, all zero — enough for `dashboardCards` to render four cards. */
const DASHBOARD_TYPES = Object.fromEntries(
  [
    'quest',
    'drop_table',
    'npc_inventory',
    'npc_spell_inventory',
    'creature_spellbook',
    'npc_drop_table',
    'treasure_card_inventory',
    'zone_transfer',
  ].map((type) => [type, { total: 0, extracted: 0, reviewed: 0, verified: 0 }]),
);

const DASHBOARD_BODY = {
  types: DASHBOARD_TYPES,
  overall: { total: 0, extracted: 0, reviewed: 0, verified: 0, percent_verified: 0 },
};

/** Mutable knobs the tests flip between steps; the dispatcher reads them per request. */
interface Control {
  /** Status `GET /api/dashboard` answers with. */
  dashboardStatus: number;
  /** Status `GET /api/health` answers with — the probe's only input. */
  healthStatus: number;
  /** Status `POST /api/npc-inventories` answers with. */
  saveStatus: number;
  /** The 400 field map the save answers with when `saveStatus` is 400. */
  saveFieldMap: Record<string, string[]> | undefined;
  dashboardRequests: number;
  healthProbes: number;
  savePosts: number;
}

function control(): Control {
  return {
    dashboardStatus: 200,
    healthStatus: 200,
    saveStatus: 200,
    saveFieldMap: undefined,
    dashboardRequests: 0,
    healthProbes: 0,
    savePosts: 0,
  };
}

/**
 * One dispatcher for the mocked `/api/**` surface: the shell's boot reads, the dashboard and its
 * feed, the liveness probe, the two names tables the NpcInventory form reads, the status list and
 * the family's list/detail/save.
 *
 * The fallback is a **404 naming the path**, so an endpoint this spec forgot to mock fails loudly
 * instead of silently answering an empty body that would make an assertion vacuous.
 */
async function mockApi(page: Page, state: Control): Promise<void> {
  await page.route(/\/api\//, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (payload: unknown, status = 200): Promise<void> =>
      route.fulfill({ status, json: payload });

    if (path === '/api/settings') {
      await json(SETTINGS);
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
    if (path === '/api/health') {
      state.healthProbes += 1;
      if (state.healthStatus !== 200) {
        await json({ error: 'Not found' }, state.healthStatus);
        return;
      }
      await json({ status: 'ok' });
      return;
    }
    if (path === '/api/dashboard') {
      state.dashboardRequests += 1;
      if (state.dashboardStatus !== 200) {
        await json({ error: 'The dashboard read failed' }, state.dashboardStatus);
        return;
      }
      await json(DASHBOARD_BODY);
      return;
    }
    if (path === '/api/activity') {
      await json({ activity: [], unresolved: 0 });
      return;
    }
    if (path === '/api/names/items') {
      await json({ items: ITEM_ROWS });
      return;
    }
    if (path === '/api/names/npcs') {
      await json({ npcs: [{ template_id: 1025, name: 'Lucky the Merchant' }] });
      return;
    }
    if (path === '/api/status/npc_inventories') {
      await json({
        entries: [
          {
            object_type: 'npc_inventory',
            object_key: NPC_KEY,
            status: 'reviewed',
            extracted_at: '2026-06-01T00:00:00.000Z',
            reviewed_at: '2026-06-02T00:00:00.000Z',
            verified_at: null,
            latest_notes: null,
          },
        ],
        summary: { total: 1, extracted: 0, reviewed: 1, verified: 0 },
      });
      return;
    }
    if (path === '/api/npc-inventories' && method === 'POST') {
      state.savePosts += 1;
      if (state.saveStatus !== 200) {
        await json(
          {
            error: '1 validation error blocks saving',
            ...(state.saveFieldMap === undefined ? {} : { fields: state.saveFieldMap }),
          },
          state.saveStatus,
        );
        return;
      }
      await json({
        key: NPC_KEY,
        file_type: 'npcinventory',
        object_type: 'npc_inventory',
        outcome: 'updated',
        action: 'update',
        commit: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
        branch: SETTINGS.git_branch,
        commit_message: `spiraldb: update npc_inventory ${NPC_KEY}`,
        file: `NpcInventory/${NPC_KEY}.json`,
        status: null,
        metadata: null,
        metadata_outcome: null,
        warnings: [],
      });
      return;
    }
    if (path === '/api/npc-inventories') {
      await json({ objects: [], summary: { total: 0, extracted: 0, reviewed: 0, verified: 0 } });
      return;
    }
    if (path === `/api/npc-inventories/${NPC_KEY}`) {
      await json(NPC_DOCUMENT);
      return;
    }

    await json({ error: `unmocked ${method} ${path}` }, 404);
  });
}

test.describe('p5-04 — the offline banner (AC1)', () => {
  test('appears within one failed request cycle, without a reload, and clears with fresh data', async ({
    page,
  }) => {
    const state = control();
    // Both the page's own read and the liveness probe are down: Express is gone, so nothing
    // answers — which is exactly what the store requires before it declares an outage.
    state.dashboardStatus = 500;
    state.healthStatus = 500;
    await mockApi(page, state);
    // Counts documents: a client-side update creates none, so "no reload happened" is measurable.
    await page.addInitScript(() => {
      const scope = window as unknown as { __p5_04Loads?: number };
      scope.__p5_04Loads = (scope.__p5_04Loads ?? 0) + 1;
    });

    await page.goto('/');

    const banner = page.getByTestId('offline-banner');
    // The banner must not need a manual refresh, and must not wait for a polling tick: the failed
    // request is what triggers the probe. `toBeVisible` is the timing assertion (5 s ceiling).
    await expect(banner).toBeVisible({ timeout: 5000 });
    await expect(banner).toContainText(BANNER_HEADLINE);
    await expect(banner).toContainText(BANNER_DETAIL);
    // The spec's second sentence is deliberately not there — nothing is saved locally (see
    // `components/layout/OfflineBanner.tsx` for the deviation and its reason).
    await expect(banner).not.toContainText('saved locally');
    expect(
      await page.evaluate(() => (window as unknown as { __p5_04Loads?: number }).__p5_04Loads),
    ).toBe(1);

    // The API comes back. No reload, no click: the probe has to notice on its own.
    state.healthStatus = 200;
    state.dashboardStatus = 200;
    await expect(banner).toBeHidden({ timeout: 10_000 });

    // …and the page refreshed itself: the dashboard's failed read was re-fetched by the recovery.
    await expect(page.getByText('Total', { exact: true })).toBeVisible();
    expect(state.dashboardRequests).toBeGreaterThan(1);
    expect(
      await page.evaluate(() => (window as unknown as { __p5_04Loads?: number }).__p5_04Loads),
    ).toBe(1);
  });

  test('a validation 400 alone never raises it — a rejected request is not an outage', async ({
    page,
  }) => {
    const state = control();
    // The dashboard answers, but with a client error: the server is talking to us.
    state.dashboardStatus = 400;
    await mockApi(page, state);

    await page.goto('/');

    // Wait for the request to have happened and been accounted for, then assert the negative.
    await expect(
      page.getByRole('alert').filter({ hasText: 'dashboard read failed' }),
    ).toBeVisible();
    await expect(page.getByTestId('offline-banner')).toBeHidden();
    // The probe is `offline`-gated; a 4xx must not even start it.
    expect(state.healthProbes).toBe(0);
  });
});

test.describe('p5-04 — the API-error toast with a retry action (AC3)', () => {
  test('offers Retry, and Retry re-runs the failed request rather than replaying an answer', async ({
    page,
  }) => {
    const state = control();
    state.dashboardStatus = 500;
    state.healthStatus = 200; // the API is up: only this one read fails
    await mockApi(page, state);

    await page.goto('/');

    const toast = page.locator('li[data-sonner-toast][data-type="error"]');
    await expect(toast).toBeVisible();
    await expect(toast).toContainText('The dashboard read failed');

    const requestsBefore = state.dashboardRequests;
    // The read works again (a transient failure), so the retry has something to prove.
    state.dashboardStatus = 200;
    // The retry the AC asks for, clicked where the spec puts it: in the toast.
    await toast.getByRole('button', { name: 'Retry', exact: true }).click();

    // The request really was re-issued (a newer response, not a cached or replayed one)…
    await expect
      .poll(() => state.dashboardRequests, { timeout: 10_000 })
      .toBeGreaterThan(requestsBefore);
    // …and the page now shows the data.
    await expect(page.getByText('Total', { exact: true })).toBeVisible();
  });
});

test.describe('p5-04 — the validation summary atop a multi-error form (AC3)', () => {
  test('a 400 field map is summarised at the top of the form, naming every field', async ({
    page,
  }) => {
    const state = control();
    state.saveStatus = 400;
    state.saveFieldMap = {
      Inventory: ['Item id 999999 is not in the synced items table.'],
      TemplateID: ['This NPC template id is already used by another inventory.'],
    };
    await mockApi(page, state);

    await page.goto(`/npc-inventories/${NPC_KEY}`);
    await page.getByRole('button', { name: 'Edit' }).click();
    // Save is dirty-gated: the one edit below is what arms it.
    await page.getByLabel('Add an item id', { exact: true }).fill('160999');
    await page.getByRole('button', { name: 'Add id', exact: true }).click();
    await page.getByRole('button', { name: 'Save' }).click();

    const summary = page.getByTestId('validation-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('2 validation errors must be fixed before saving.');
    // One line per field, each naming the field and carrying the server's sentence.
    await expect(summary).toContainText('Inventory');
    await expect(summary).toContainText('Item id 999999 is not in the synced items table.');
    await expect(summary).toContainText('TemplateID');
    await expect(summary).toContainText(
      'This NPC template id is already used by another inventory.',
    );
    expect(state.savePosts).toBe(1);

    // "Atop the form": the summary sits above the form body, not below it.
    const summaryBox = await summary.boundingBox();
    const chipBox = await page.getByLabel('Remove Black Mantle (1)', { exact: true }).boundingBox();
    expect(summaryBox).not.toBeNull();
    expect(chipBox).not.toBeNull();
    expect(summaryBox!.y).toBeLessThan(chipBox!.y);
  });
});
