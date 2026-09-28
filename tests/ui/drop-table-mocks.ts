import type { Page } from '@playwright/test';

/**
 * Shared route mocks for the DropTable surfaces (extracted from
 * `drop-table-editor.spec.ts` by story p5-05, so the keyboard-only a11y spec drives the
 * same contract instead of forking a second copy — the D51/D76 "one shared unit" rule).
 *
 * Hermetic by construction (D81): every request the DropTable list/detail pages make is
 * fulfilled from the fixtures below, so a spec using this reaches neither the dev stack's
 * SQLite file nor the D17 clone. The wire contracts are copied literally (as in
 * `quests-mocks.ts`): a fixture that imported `client/src/lib/objects.ts` could only prove
 * the client agrees with itself.
 */

/** The real ReqHasQuest type string (the corpus's assembly-qualified literal). */
export const RHQ = 'Imcodec.ObjectProperty.TypeCache.ReqHasQuest, Imcodec.ObjectProperty';
/**
 * The `RequirementList` literal. A **newly created** wrapper gets one (307 of the 314 corpus
 * wrappers carry it), while the 7 untyped ones are existing values the editor must not
 * normalise (D57) — both facts are asserted below, on the same slot.
 */
export const REQUIREMENT_LIST =
  'Imcodec.ObjectProperty.TypeCache.RequirementList, Imcodec.ObjectProperty';
export const QUEST_NAME = 'WC-UNICORN-MAIN-004';
export const QUEST_TITLE = 'Second Quest';

/** One `objects[]` row of `GET /api/drop-tables` — the corpus the duplicate rule checks. */
export interface MockObjectRow {
  key: string;
  title: string;
  modified_at: string | null;
  status: 'extracted' | 'reviewed' | 'verified' | null;
}

export const SELF_KEY = 'DS-ACAD1-C01-001';
/** The other table the duplicate tests collide with — present in the list, never loaded. */
export const OTHER_KEY = 'WC-COMMONS-MAIN-004';

export function mockRows(): MockObjectRow[] {
  return [
    { key: SELF_KEY, title: SELF_KEY, modified_at: '2026-06-01T00:00:00.000Z', status: 'reviewed' },
    { key: OTHER_KEY, title: OTHER_KEY, modified_at: '2026-06-02T00:00:00.000Z', status: null },
  ];
}

/**
 * The loaded document: the real corpus's key order, two item rows (`1001` resolves, `1000` is
 * one of the eight measured misses), an explicit `null` `Requirements`, no
 * `GrantsPotionSlot` (the 282-file shape) and an audit block (the 316-file shape).
 */
export function mockDocument(): Record<string, unknown> {
  return {
    Name: SELF_KEY,
    Description: 'Test table',
    RollChance: 1.0,
    Weight: 100,
    NoneChance: 0.0,
    PityCounter: 0.0,
    MinGold: 0,
    MaxGold: 0,
    ExperienceAmount: 0,
    TrainingPoints: 0,
    Items: [
      { ItemId: '1001', ItemName: 'Black Mantle', Notes: 'Balance', Requirements: null },
      { ItemId: '1000', ItemName: 'New Item', Notes: '', Requirements: null },
    ],
    CreatedAt: '2026-06-01T00:57:50.183246Z',
    ModifiedAt: '2026-06-01T00:57:50.183246Z',
    CreatedBy: 'quest_builder',
    ModifiedBy: 'quest_builder',
  };
}

/** The synced `items` rows: integer `gid`s, one real name, one NULL name, and no `1000`. */
export const ITEM_ROWS = [
  { gid: 1001, name: 'Black Mantle' },
  { gid: 1002, name: 'Twice Stitched Boots' },
  { gid: 1003, name: null },
];

export const QUEST_ROWS = [
  { quest_name: QUEST_NAME, title: QUEST_TITLE, level: 7, is_mainline: 0 },
];

export interface DropTableMockOptions {
  /** The document the detail route answers with. */
  document?: Record<string, unknown>;
  /** The list rows (the corpus the duplicate rule sees). */
  rows?: MockObjectRow[];
  /** Answer the detail route with this status instead (a 404 case). */
  detailStatus?: number;
}

export interface DropTableMockRecorded {
  /** The bodies of every `POST /api/drop-tables`, in order. */
  savePosts: Array<Record<string, unknown>>;
  /** Single-id label lookups (`GET /api/names/items/:id`) — must stay 0 for a resolvable id. */
  itemLookups: string[];
  /** The object the detail endpoint currently serves; a reload test replaces it. */
  served: { current: Record<string, unknown> };
}

export async function mockDropTableApi(
  page: Page,
  options: DropTableMockOptions = {},
): Promise<DropTableMockRecorded> {
  const recorded: DropTableMockRecorded = {
    savePosts: [],
    itemLookups: [],
    served: { current: options.document ?? mockDocument() },
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

  // The friendly-name lists the ItemId dropdown and the tree's Quest field search. The items
  // list is the CANONICAL id source: integer gids, exactly as `GET /api/names/items` serves.
  await page.route('**/api/names/items', (route) => route.fulfill({ json: { items: ITEM_ROWS } }));
  await page.route('**/api/names/items/*', async (route) => {
    recorded.itemLookups.push(route.request().url().split('/').pop() ?? '');
    // A single-id lookup is the documented fallback; every id the list holds resolves from it.
    await route.fulfill({ status: 404, json: { error: 'Unknown items id' } });
  });
  await page.route('**/api/names/quests', (route) =>
    route.fulfill({ json: { quests: QUEST_ROWS } }),
  );
  await page.route('**/api/names/quests/*', (route) =>
    route.fulfill({ status: 404, json: { error: 'Unknown quests id' } }),
  );

  await page.route('**/api/status/drop_tables', (route) =>
    route.fulfill({
      json: {
        entries: mockRows().map((row) => ({
          object_type: 'drop_table',
          object_key: row.key,
          status: row.status ?? 'extracted',
          extracted_at: '2026-06-01T00:00:00.000Z',
          reviewed_at: null,
          verified_at: null,
          latest_notes: null,
        })),
        summary: { total: 2, extracted: 1, reviewed: 1, verified: 0 },
      },
    }),
  );

  const rows = options.rows ?? mockRows();

  await page.route('**/api/drop-tables', async (route) => {
    if (route.request().method() === 'POST') {
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      recorded.savePosts.push(body);
      const key = String((body.object as { Name?: unknown } | undefined)?.Name ?? SELF_KEY);
      await route.fulfill({
        json: {
          key,
          file_type: 'droptable',
          object_type: 'drop_table',
          outcome: 'updated',
          action: 'update',
          commit: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
          branch: settings.git_branch,
          commit_message: `spiraldb: update drop_table ${key}`,
          file: `DropTables/droptables_${key.toLowerCase()}.json`,
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

  await page.route('**/api/drop-tables/*', async (route) => {
    if (options.detailStatus !== undefined) {
      await route.fulfill({
        status: options.detailStatus,
        json: { error: `Unknown Drop Tables entry "${SELF_KEY}"` },
      });
      return;
    }
    await route.fulfill({ json: recorded.served.current });
  });

  return recorded;
}
