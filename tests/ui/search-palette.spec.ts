import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Story p5-02's tier-1 UI spec (plan task 5.2; decisions D40/D44, D27, D51, D81, P5 AC#4):
 * **the ⌘K global search palette** — the header trigger, the shortcut, the results grouped by
 * type with their dots, the click-through, the non-navigable friendly-name rows, the
 * no-results state and the `limit=20` request.
 *
 * | the AC's words | arm | test |
 * |---|---|---|
 * | "typing a substring of a known quest name and of a known DropTable name returns both" | `DS-ACAD` → a Quests group **and** a Drop Tables group | results |
 * | "grouped by type" | two `role="group"` regions named `Quests` / `Drop Tables` | results |
 * | "status dots correct" | each row's `StatusDot` — its colour class **and** its sr-only `Status: Reviewed` / `Status: Extracted` | results |
 * | "selecting a result lands on its detail page" | click the NPC Inventory row → `/npc-inventories/87112` **and** the detail page's back bar; click the quest row → `/quests/DS-ACAD-C01-001` | click-through |
 * | "`limit=20` respected" | every `/api/search` request carries `limit=20` | limit |
 * | "search over 15k+ name rows responds < 300ms locally" | **not here** — a mocked endpoint can prove nothing about latency; measured on the real tables in `docs/evidence/phase-5/p5-02-d3-proof.md` (D3) | — |
 *
 * ## Hermetic by construction (D81)
 *
 * One dispatcher answers every `/api/**` request from the fixtures below, so the run reaches
 * neither the dev stack's SQLite file nor the D17 clone — and the palette's read is
 * `/api/search`, which on a developer's machine would scan 123,640 real rows and on CI would
 * scan an empty database. Every sentence and every dot this spec asserts comes from a mock.
 *
 * The dispatcher **records any path it did not mock and answers it with a 404**, and the last
 * assertion of every arm is that nothing was unmocked. That is D81's rule made mechanical: a
 * spec that walks the app must mock every endpoint its assertions depend on, and a run that
 * silently leans on the corpus (or on whatever happens to be listening) fails here instead of
 * on the CI runner.
 *
 * The filter below is written by hand, in the spec, on purpose: what this file proves is the
 * **client** half (grouping, dots, links, states, the request it sends). The server half —
 * the real arms, the ranking, the per-group cap and the ladder — is `tests/unit/search.test.ts`,
 * and a fixture that imported the client's own module could only prove the client agrees with
 * itself.
 *
 * ## The accessible-name vocabulary this spec addresses
 *
 * trigger button `Search all objects` (scoped to `<header>`) · the shortcut `⌘K` / `Ctrl+K` ·
 * dialog `role="dialog"` named `Search all objects` · input `role="combobox"` named
 * `Search query` · list `role="listbox"` named `Search results` · groups `role="group"` named
 * after the endpoint's own label (`Quests`, `Drop Tables`, `NPC Inventories`, `Items`) ·
 * each result `role="option"` whose text is `<label> <friendly name?> <status label?> [— not linked]` ·
 * `[data-search-result]` = the row's identity · `[data-search-group]` · `[data-search-unresolved]` ·
 * `[data-search-truncated]` · `[data-search-empty]` · `[data-search-idle]` ·
 * `[data-search-loading]` · `[data-search-error]`.
 */

/* ------------------------------------------------------------------- fixtures */

type Status = 'extracted' | 'reviewed' | 'verified';

interface FixtureRow {
  /** The group the row belongs to — a D4 singular type, or `item` for a routeless name row. */
  group: string;
  groupLabel: string;
  object_type: string | null;
  object_key: string | null;
  label: string;
  name: string | null;
  source_id: string | null;
  status: Status | null;
  matched_on: 'key' | 'name';
}

/**
 * The four rows the palette can be made to show, in the endpoint's own group order
 * (`quest` first, then the generic families in `shared/objectTypes.ts` order, then the
 * name-only families). Rows 1 and 2 are the acceptance criterion's own example: one
 * substring, two types — exactly what the owner's corpus does, where a quest's drop table
 * is named after the quest.
 */
const ROWS: readonly FixtureRow[] = [
  {
    group: 'quest',
    groupLabel: 'Quests',
    object_type: 'quest',
    object_key: 'DS-ACAD-C01-001',
    label: 'DS-ACAD-C01-001',
    name: 'Wizard Tours',
    source_id: null,
    status: 'reviewed',
    matched_on: 'key',
  },
  {
    group: 'drop_table',
    groupLabel: 'Drop Tables',
    object_type: 'drop_table',
    object_key: 'DS-ACAD-C01-002',
    label: 'DS-ACAD-C01-002',
    name: null,
    source_id: null,
    status: 'extracted',
    matched_on: 'key',
  },
  {
    group: 'npc_inventory',
    groupLabel: 'NPC Inventories',
    object_type: 'npc_inventory',
    object_key: '87112',
    label: '87112',
    name: null,
    source_id: null,
    status: 'verified',
    matched_on: 'key',
  },
  {
    // No detail route exists for an item, so the endpoint sends `null` for both route fields
    // and the palette must say so rather than link somewhere.
    group: 'item',
    groupLabel: 'Items',
    object_type: null,
    object_key: null,
    label: 'Obsidian Amulet',
    name: 'Obsidian Amulet',
    source_id: '4',
    status: null,
    matched_on: 'name',
  },
];

/** The group order, written as the endpoint's own table spells it. */
const GROUP_ORDER = ['quest', 'drop_table', 'npc_inventory', 'item'];

/** What the mocked `/api/search` answers for one query — a hand-written miniature of the arms. */
function searchBody(q: string, limit: number): Record<string, unknown> {
  const needle = q.toLowerCase();
  const matched = ROWS.filter(
    (row) =>
      row.label.toLowerCase().includes(needle) || (row.name ?? '').toLowerCase().includes(needle),
  );

  const groups = GROUP_ORDER.flatMap((group) => {
    const results = matched
      .filter((row) => row.group === group)
      .slice(0, limit)
      .map((row) => ({
        object_type: row.object_type,
        object_key: row.object_key,
        label: row.label,
        name: row.name,
        source_id: row.source_id,
        status: row.status,
        matched_on: row.matched_on,
      }));
    if (results.length === 0) {
      return [];
    }
    const first = matched.find((row) => row.group === group) as FixtureRow;
    return [{ type: group, label: first.groupLabel, results }];
  });

  const total = groups.reduce<number>((sum, group) => sum + group.results.length, 0);
  return {
    query: q,
    limit,
    total,
    truncated: false,
    unresolved: groups.flatMap((group) => group.results).filter((row) => row.object_type === null)
      .length,
    groups,
  };
}

/** The NPC Inventory document the click-through lands on (task 4.1's own shape). */
const NPC_DOCUMENT = { TemplateID: 87112, Inventory: [] };

/** The quest document the quest click-through lands on (task 2.7's shape). */
const QUEST_DOCUMENT = {
  m_questName: 'DS-ACAD-C01-001',
  m_questLevel: 1,
  m_mainline: true,
  m_goals: [],
};

interface Recorded {
  /** Every `/api/search` request's `q`, in order. */
  queries: string[];
  /** Every `/api/search` request's `limit`, in order — the `limit=20` arm reads this. */
  limits: string[];
  /** Every request path the dispatcher had no fixture for (must stay empty). */
  unmocked: string[];
}

/** One dispatcher for the whole `/api/**` surface (D81). */
async function mockSearchApi(page: Page): Promise<Recorded> {
  const recorded: Recorded = { queries: [], limits: [], unmocked: [] };

  await page.route(/\/api\//, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (payload: unknown): Promise<void> => route.fulfill({ json: payload });

    // ---- the shell's own boot reads (Header, the identity gate, the import toast).
    if (path === '/api/settings') {
      return json({
        aurorium_path: '',
        imcodec_path: '',
        user_name: 'Palette Tester',
        spiraldb_path: '',
        git_branch: '',
      });
    }
    if (path === '/api/status/_import') {
      return json({ ran: false, imported: 0, imported_at: null });
    }
    // Story p5-04's offline detector probes the liveness route whenever a request fails — and
    // this function's own failure arm deliberately fails one (`/api/search` → 500). Mocked as the
    // API being up, so the probe settles the connection and that arm stays about the search error
    // itself; unmocked, the probe would land in `recorded.unmocked` and break the D81 guard.
    if (path === '/api/health') {
      return json({ status: 'ok' });
    }

    // ---- the search endpoint: the one this story adds.
    if (path === '/api/search') {
      const q = url.searchParams.get('q') ?? '';
      const limit = Number(url.searchParams.get('limit') ?? '20');
      recorded.queries.push(q);
      recorded.limits.push(url.searchParams.get('limit') ?? '');
      return json(searchBody(q, limit));
    }

    // ---- '/' — the dashboard (story p5-01), which the shell renders under the palette.
    if (path === '/api/dashboard') {
      const bucket = (total: number, extracted: number, reviewed: number, verified: number) => ({
        total,
        extracted,
        reviewed,
        verified,
      });
      return json({
        types: {
          quest: bucket(1, 0, 1, 0),
          drop_table: bucket(1, 1, 0, 0),
          npc_inventory: bucket(1, 0, 0, 1),
          npc_spell_inventory: bucket(0, 0, 0, 0),
          creature_spellbook: bucket(0, 0, 0, 0),
          npc_drop_table: bucket(0, 0, 0, 0),
          treasure_card_inventory: bucket(0, 0, 0, 0),
          zone_transfer: bucket(0, 0, 0, 0),
        },
        overall: { total: 3, extracted: 1, reviewed: 1, verified: 1, percent_verified: 33.3 },
      });
    }
    if (path === '/api/activity') {
      return json({ activity: [], unresolved: 0 });
    }

    // ---- the detail route the click-through lands on, and its status join.
    if (path === '/api/npc-inventories/87112') {
      return json(NPC_DOCUMENT);
    }
    if (path === '/api/npc-inventories') {
      return json({
        objects: [{ key: '87112', title: '87112', modified_at: null, status: 'verified' }],
        summary: { total: 1, extracted: 0, reviewed: 0, verified: 1 },
        skipped: [],
        missing_directory: false,
        duplicate_keys: [],
      });
    }
    if (path === '/api/status/npc_inventories') {
      return json({
        entries: [
          {
            object_type: 'npc_inventory',
            object_key: '87112',
            status: 'verified',
            extracted_at: null,
            reviewed_at: null,
            verified_at: null,
            latest_notes: null,
          },
        ],
        summary: { total: 1, extracted: 0, reviewed: 0, verified: 1 },
      });
    }
    // Every detail page the click-through lands on mounts the shared status panel, which reads
    // the entry's own history. The unmocked-path guard at the end of that arm is what found
    // these two reads.
    if (/^\/api\/status\/[^/]+\/[^/]+\/history$/.test(path)) {
      return json({ history: [] });
    }

    // ---- the quest detail route (the criterion's own example), kept minimal: the arm that
    // uses it asserts the URL and the shell's route title, not the quest page's internals.
    if (path === '/api/quests/DS-ACAD-C01-001') {
      return json(QUEST_DOCUMENT);
    }
    if (path === '/api/quests') {
      return json({
        quests: [
          {
            quest_name: 'DS-ACAD-C01-001',
            title: 'Wizard Tours',
            level: 1,
            is_mainline: true,
            goal_count: 0,
            status: 'reviewed',
          },
        ],
        summary: { total: 1, extracted: 0, reviewed: 1, verified: 0 },
        skipped: [],
      });
    }
    if (path.startsWith('/api/names/')) {
      return json({ items: [], spells: [], npcs: [], quests: [], zones: [], drop_tables: [] });
    }

    // An endpoint this spec does not know about: recorded, and answered with a 404 so the
    // unmocked-dependency assertion at the end of each arm can see it.
    recorded.unmocked.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { error: `unmocked ${path}` } });
  });

  return recorded;
}

/** The header's search trigger — scoped to `<header>`, where the shell puts it. */
function trigger(page: Page) {
  return page.locator('header').getByRole('button', { name: 'Search all objects' });
}

/** The palette's input. */
function searchInput(page: Page) {
  return page.getByRole('combobox', { name: 'Search query' });
}

/** Opens the palette with the header trigger. */
async function openPalette(page: Page): Promise<void> {
  await trigger(page).click();
  await expect(page.getByRole('dialog', { name: 'Search all objects' })).toBeVisible();
}

/* ------------------------------------------------------------------- the arms */

test.describe('p5-02 the global search palette', () => {
  test('the header trigger opens it from the dashboard and from another route', async ({
    page,
  }) => {
    const recorded = await mockSearchApi(page);
    await page.goto('/');
    await expect(trigger(page)).toBeVisible();

    await openPalette(page);
    // Nothing typed: no request is made at all (the endpoint would scan 123,640 rows).
    await expect(page.locator('[data-search-idle]')).toBeVisible();
    expect(recorded.queries).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Search all objects' })).toBeHidden();

    // Reachable from another route too — the palette lives in the shell (`AppLayout`), not
    // on a page, so the same trigger is there.
    await page.goto('/npc-inventories');
    await expect(trigger(page)).toBeVisible();
    await openPalette(page);

    expect(recorded.unmocked).toEqual([]);
  });

  test('Ctrl+K opens it, and typing returns both example results grouped by type with their dots', async ({
    page,
  }) => {
    const recorded = await mockSearchApi(page);
    await page.goto('/');

    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Search all objects' });
    await expect(dialog).toBeVisible();
    // The input's name comes from cmdk's own `<label>` (the `Command` `label` prop) and the
    // list's from cmdk's `label` prop on `CommandList` **only** — an `aria-label` there is
    // silently overridden by the primitive, which is why both are pinned here.
    await expect(page.getByRole('listbox', { name: 'Search results' })).toBeVisible();

    await searchInput(page).fill('DS-ACAD');

    // Grouped by type: two named regions, in the endpoint's order.
    const quests = page.getByRole('group', { name: 'Quests' });
    const dropTables = page.getByRole('group', { name: 'Drop Tables' });
    await expect(quests).toBeVisible();
    await expect(dropTables).toBeVisible();

    const questRow = quests.getByRole('option', { name: /DS-ACAD-C01-001/ });
    const dropRow = dropTables.getByRole('option', { name: /DS-ACAD-C01-002/ });
    await expect(questRow).toBeVisible();
    await expect(dropRow).toBeVisible();

    // The friendly title the endpoint joined in, shown beside the key.
    await expect(questRow).toContainText('Wizard Tours');

    // "Status dots correct": the dot is `StatusDot`, so its colour class and its sr-only
    // status word both come from the same shared unit the list pages use.
    await expect(questRow.locator('span.bg-blue-500')).toHaveCount(1);
    await expect(questRow.getByText('Status: Reviewed')).toHaveCount(1);
    await expect(dropRow.locator('span.bg-amber-500')).toHaveCount(1);
    await expect(dropRow.getByText('Status: Extracted')).toHaveCount(1);

    // A navigable row carries no "not linked" suffix.
    await expect(questRow.getByText('— not linked')).toHaveCount(0);

    expect(recorded.queries).toEqual(['DS-ACAD']);
    expect(recorded.unmocked).toEqual([]);
  });

  test('sends limit=20 with every query', async ({ page }) => {
    const recorded = await mockSearchApi(page);
    await page.goto('/');
    await openPalette(page);

    await searchInput(page).fill('DS-ACAD');
    await expect(page.getByRole('group', { name: 'Quests' })).toBeVisible();

    await searchInput(page).fill('obsidian');
    await expect(page.getByRole('group', { name: 'Items' })).toBeVisible();

    expect(recorded.queries).toEqual(['DS-ACAD', 'obsidian']);
    expect(recorded.limits).toEqual(['20', '20']);

    // The endpoint answers a cap, not a page count: the truncation notice is the client's,
    // and it only appears when the server said `truncated`. This fixture never does.
    await expect(page.locator('[data-search-truncated]')).toHaveCount(0);
    expect(recorded.unmocked).toEqual([]);
  });

  test('selecting a result lands on its detail page, and the palette closes', async ({ page }) => {
    const recorded = await mockSearchApi(page);
    await page.goto('/');
    await openPalette(page);

    await searchInput(page).fill('87112');
    const row = page
      .getByRole('group', { name: 'NPC Inventories' })
      .getByRole('option', { name: /87112/ });
    await expect(row).toBeVisible();
    await row.click();

    await expect(page).toHaveURL(/\/npc-inventories\/87112$/);
    await expect(page.getByRole('dialog', { name: 'Search all objects' })).toBeHidden();
    // The detail page itself mounted — not just the URL changed: its own back bar and key.
    await expect(page.getByRole('link', { name: 'Back to NPC Inventories' })).toBeVisible();
    await expect(page.locator('span[title="87112"]')).toHaveText('87112');

    // And the alias the endpoint's `object_type` selects is the D4 route: a quest row goes to
    // `/quests/<key>`, the one route outside `shared/objectTypes.ts`.
    await openPalette(page);
    await searchInput(page).fill('Wizard Tours');
    await page
      .getByRole('group', { name: 'Quests' })
      .getByRole('option', { name: /DS-ACAD-C01-001/ })
      .click();

    await expect(page).toHaveURL(/\/quests\/DS-ACAD-C01-001$/);
    // The shell's own route table matched the detail pattern (a wrong path would read
    // "Not found"), and the palette is still reachable from that detail route.
    await expect(
      page.locator('header').getByRole('heading', { name: 'Quest Detail' }),
    ).toBeVisible();
    await expect(trigger(page)).toBeVisible();

    expect(recorded.unmocked).toEqual([]);
  });

  test('a friendly-name hit says it is not linked, and the count is printed', async ({ page }) => {
    const recorded = await mockSearchApi(page);
    await page.goto('/');
    await openPalette(page);

    await searchInput(page).fill('obsidian');

    const items = page.getByRole('group', { name: 'Items' });
    await expect(items).toBeVisible();
    const row = items.getByRole('option', { name: /Obsidian Amulet/ });
    await expect(row).toBeVisible();
    await expect(row.getByText('— not linked')).toHaveCount(1);
    // No dot: the endpoint sends `status: null` for a row with no lifecycle.
    await expect(row.locator('span.bg-blue-500')).toHaveCount(0);
    await expect(row.locator('span.bg-amber-500')).toHaveCount(0);
    await expect(row.locator('span.bg-emerald-500')).toHaveCount(0);
    await expect(row.getByText(/^Status:/)).toHaveCount(0);

    // The count, the same treatment the dashboard feed gives its own unresolvable rows.
    await expect(page.locator('[data-search-unresolved="1"]')).toBeVisible();
    await expect(page.locator('[data-search-unresolved="1"]')).toContainText(
      '1 result has no page to open',
    );

    // Selecting it does nothing — there is no page to open — and the palette stays open.
    await row.click();
    await expect(page.getByRole('dialog', { name: 'Search all objects' })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    expect(recorded.unmocked).toEqual([]);
  });

  test('the no-results state renders, and a failure is not mistaken for it', async ({ page }) => {
    const recorded = await mockSearchApi(page);
    await page.goto('/');
    await openPalette(page);

    await searchInput(page).fill('zzzz-no-such-thing');

    const empty = page.locator('[data-search-empty]');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText('No results for “zzzz-no-such-thing”');
    await expect(page.getByRole('group')).toHaveCount(0);

    // The failure arm: a 500 must NOT render the friendly no-results sentence (the
    // criterion's own failure mode), it must render the server's message.
    await page.route('**/api/search**', (route) =>
      route.fulfill({ status: 500, json: { error: 'search is down' } }),
    );
    await searchInput(page).fill('DS-ACAD');
    await expect(page.locator('[data-search-error]')).toBeVisible();
    await expect(page.locator('[data-search-error]')).toContainText('search is down');
    await expect(page.locator('[data-search-empty]')).toHaveCount(0);

    expect(recorded.unmocked).toEqual([]);
  });

  test('closing forgets the query, and the keyboard shortcut is ⌘K/Ctrl+K only', async ({
    page,
  }) => {
    const recorded = await mockSearchApi(page);
    await page.goto('/');
    await openPalette(page);

    await searchInput(page).fill('DS-ACAD');
    await expect(page.getByRole('group', { name: 'Quests' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Search all objects' })).toBeHidden();

    // Reopening is clean — no stale result set from the previous session.
    await openPalette(page);
    await expect(searchInput(page)).toHaveValue('');
    await expect(page.locator('[data-search-idle]')).toBeVisible();
    expect(recorded.queries).toEqual(['DS-ACAD']);

    // The shortcut toggles, and a plain `k` types into the page instead of opening it.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Shift+k');
    await expect(page.getByRole('dialog', { name: 'Search all objects' })).toBeHidden();
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Search all objects' })).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Search all objects' })).toBeHidden();

    expect(recorded.unmocked).toEqual([]);
  });
});
