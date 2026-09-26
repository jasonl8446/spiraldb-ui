import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  activeNavGroupId,
  activeNavPath,
  APP_ROUTES,
  matchRoute,
  NAV_GROUPS,
  NAV_ITEMS,
  pageTitleForPath,
  type NavIconName,
} from '../../client/src/lib/routes';
import {
  formatNameRow,
  formatNameValue,
  humanizeZone,
  nameRowId,
  NAMES_TYPES,
  npcDisplayName,
  toNameOptions,
  type NameRow,
} from '../../client/src/lib/display';
import {
  filterNameOptions,
  MAX_NAME_OPTIONS,
  truncationHint,
} from '../../client/src/lib/filter-names';
import {
  importSummaryMessage,
  SETTINGS_SAVED_MESSAGE,
  settingsSaveErrorMessage,
  syncErrorMessage,
  syncSuccessMessage,
  SYNC_SUCCESS_ICON_MS,
  TOAST_ACCENT_CLASSES,
  TOAST_ACCENT_WIDTH,
  TOAST_DURATIONS,
  TOASTER_CLASS_NAMES,
  TOASTER_POSITION,
  TOASTER_VISIBLE_TOASTS,
  type ToastAccentType,
} from '../../client/src/lib/toast';
import {
  SWIPE_CLOSE_THRESHOLD_PX,
  SWIPE_MAX_VERTICAL_DRIFT_PX,
  swipeShouldClose,
} from '../../client/src/lib/swipe';
import {
  formatHistoryCounts,
  formatLocalTimestamp,
  historyCounts,
  syncOutcome,
} from '../../client/src/lib/sync-view';
import {
  getNames,
  getName,
  getSyncHistory,
  namesQueryKey,
  postSync,
  SYNC_HISTORY_QUERY_KEY,
  SYNC_STATUS_QUERY_KEY,
  type SyncHistoryEntry,
} from '../../client/src/lib/api';
import {
  BULK_NAME_TYPES,
  isBulkNameType,
  selectedId,
  STRING_MIN_QUERY_LENGTH,
  STRING_SEARCH_LIMIT,
  STREAMED_NAME_TYPE,
} from '../../client/src/hooks/useNames';

/**
 * Story p1-10 (plan task 1.8) — the pure half of the UI shell.
 *
 * Locked here: the nav/route tables against `docs/spec-ui-design.md` L73-93 and
 * `docs/spec-api.md` L325-350, the display formats of
 * `docs/spec-domain-reference.md` L694-702, the toast policy of
 * `docs/spec-ui-design.md` L111-123, the cmdk truncation rule of decision D8, the
 * swipe-to-close threshold, and the string-table rule that `strings` is never
 * bulk-loaded (decision D39 item 4).
 *
 * No jsdom, no React rendering (decision D10): everything below is a pure
 * function, a constant, or a mocked `fetch`.
 */

/* ------------------------------------------------------------------ routes */

/** Every route the spec-api L325-350 table lists, verbatim. */
const SPEC_ROUTES = [
  '/',
  '/quests',
  '/quests/extract',
  '/quests/:questName',
  '/drop-tables',
  '/drop-tables/:name',
  '/npc-inventories',
  '/npc-inventories/:id',
  '/npc-spell-inventories',
  '/npc-spell-inventories/:id',
  '/creature-spellbooks',
  '/creature-spellbooks/:name',
  '/npc-drop-tables',
  '/npc-drop-tables/:id',
  '/treasure-card-inventories',
  '/treasure-card-inventories/:id',
  '/zone-transfers',
  '/zone-transfers/:name',
  '/global-registry',
  '/settings',
] as const;

describe('route table', () => {
  it('contains every route from the spec-api L325-350 table, and nothing else', () => {
    expect(APP_ROUTES.map((route) => route.path).sort()).toEqual([...SPEC_ROUTES].sort());
  });

  it('gives every route a title', () => {
    for (const route of APP_ROUTES) {
      expect(route.title.trim(), route.path).not.toBe('');
    }
  });

  it('maps stub phases per lead decision 7', () => {
    const phase = (path: string): number | undefined =>
      APP_ROUTES.find((route) => route.path === path)?.phase;

    expect(phase('/')).toBe(5);
    expect(phase('/quests')).toBe(2);
    expect(phase('/quests/extract')).toBe(2);
    expect(phase('/quests/:questName')).toBe(2);
    for (const path of [
      '/drop-tables',
      '/drop-tables/:name',
      '/npc-inventories',
      '/npc-inventories/:id',
      '/npc-spell-inventories',
      '/npc-spell-inventories/:id',
      '/creature-spellbooks',
      '/creature-spellbooks/:name',
      '/npc-drop-tables',
      '/npc-drop-tables/:id',
      '/treasure-card-inventories',
      '/treasure-card-inventories/:id',
      '/zone-transfers',
      '/zone-transfers/:name',
      '/global-registry',
    ]) {
      expect(phase(path), path).toBe(4);
    }
    // Settings is the one page this story builds.
    expect(phase('/settings')).toBe(1);
  });

  it('orders static patterns before the dynamic ones that could shadow them', () => {
    const indexOf = (path: string): number => APP_ROUTES.findIndex((route) => route.path === path);
    expect(indexOf('/quests/extract')).toBeLessThan(indexOf('/quests/:questName'));
    expect(indexOf('/quests')).toBeLessThan(indexOf('/quests/:questName'));
  });

  it('matches concrete paths, including dynamic detail routes', () => {
    expect(pageTitleForPath('/')).toBe('Dashboard');
    expect(pageTitleForPath('/settings')).toBe('Settings');
    expect(pageTitleForPath('/quests/extract')).toBe('Extract Quests');
    expect(pageTitleForPath('/quests/DS-ACAD1-C01-001')).toBe('Quest Detail');
    expect(pageTitleForPath('/npc-spell-inventories/12345')).toBe('NPC Spell Inventory Detail');
    expect(pageTitleForPath('/zone-transfers/Aquila%2FAQ_Z00_Hub')).toBe('Zone Transfer Detail');
  });

  it('answers "Not found" for an unknown path', () => {
    expect(pageTitleForPath('/does-not-exist')).toBe('Not found');
    expect(matchRoute('/does-not-exist').route).toBeUndefined();
  });

  it('tolerates a trailing slash but not a partial segment match', () => {
    expect(pageTitleForPath('/settings/')).toBe('Settings');
    expect(pageTitleForPath('/setting')).toBe('Not found');
    expect(pageTitleForPath('/drop-tables-extra')).toBe('Not found');
  });
});

describe('navigation table', () => {
  it('has the four spec groups, in order', () => {
    expect(NAV_GROUPS.map((group) => group.label)).toEqual([
      'OVERVIEW',
      'QUESTS',
      'DATA',
      'SETTINGS',
    ]);
  });

  it('lists the exact items of the spec sidebar', () => {
    const byGroup = Object.fromEntries(
      NAV_GROUPS.map((group) => [group.label, group.items.map((item) => item.label)]),
    );

    expect(byGroup.OVERVIEW).toEqual(['Dashboard']);
    expect(byGroup.QUESTS).toEqual(['Extract Quests', 'Browse Quests']);
    expect(byGroup.DATA).toEqual([
      'Drop Tables',
      'NPC Inventories',
      'NPC Spell Inventories',
      'Creature Spellbooks',
      'NPC Drop Tables',
      'Treasure Card Inventory',
      'Zone Transfers',
      'Global Registry',
    ]);
    expect(byGroup.SETTINGS).toEqual(['Sync Friendly Names']);
  });

  it('points every nav item at a real route and a known icon', () => {
    const knownIcons: readonly string[] = [
      'bar-chart-3',
      'swords',
      'package',
      'settings',
      'layout-dashboard',
      'upload',
      'list-checks',
      'backpack',
      'sparkles',
      'book-open',
      'boxes',
      'layers',
      'map',
      'globe',
      'refresh-cw',
    ] satisfies readonly NavIconName[];

    for (const item of NAV_ITEMS) {
      expect(
        APP_ROUTES.map((route) => route.path),
        item.path,
      ).toContain(item.path);
      expect(knownIcons, item.label).toContain(item.icon);
    }
  });

  it('highlights the nav item a detail route belongs to', () => {
    expect(activeNavPath('/')).toBe('/');
    expect(activeNavPath('/settings')).toBe('/settings');
    expect(activeNavPath('/quests/extract')).toBe('/quests/extract');
    expect(activeNavPath('/quests/DS-ACAD1-C01-001')).toBe('/quests');
    expect(activeNavPath('/drop-tables/Some_Table')).toBe('/drop-tables');
    expect(activeNavPath('/unknown')).toBeUndefined();
  });

  it('reports the active group so it can be expanded', () => {
    expect(activeNavGroupId('/')).toBe('overview');
    expect(activeNavGroupId('/npc-drop-tables/12')).toBe('data');
    expect(activeNavGroupId('/settings')).toBe('settings');
    expect(activeNavGroupId('/quests/DS-1')).toBe('quests');
  });
});

/* --------------------------------------------------------------- display */

describe('NPC display format', () => {
  it('always renders "Name (TemplateID)"', () => {
    expect(npcDisplayName('Judge Eddie', 12345)).toBe('Judge Eddie (12345)');
    expect(formatNameRow('npcs', { template_id: 12345, name: 'Judge Eddie' })).toBe(
      'Judge Eddie (12345)',
    );
    expect(formatNameRow('npcs', { template_id: 7, name: 'Pet Raid Accompany' })).toBe(
      'Pet Raid Accompany (7)',
    );
  });

  it('falls back to the bare id when the name is missing', () => {
    expect(npcDisplayName(null, 42)).toBe('42');
    expect(npcDisplayName('   ', 42)).toBe('42');
  });
});

describe('zone humanization', () => {
  it('renders the spec example exactly', () => {
    expect(humanizeZone('WizardCity/WC_Hub')).toBe('Wizard City / WC Hub');
  });

  it('humanizes a single-segment zone and multi-word paths', () => {
    expect(humanizeZone('WizardCity')).toBe('Wizard City');
    expect(humanizeZone('Aquila/AQ_Z00_Hub')).toBe('Aquila / AQ Z00 Hub');
    expect(humanizeZone('Marleybone/MB_Scotland_Yard')).toBe('Marleybone / MB Scotland Yard');
  });

  it('prefers the cached display_name and falls back to the path', () => {
    expect(
      formatNameRow('zones', {
        zone_path: 'WizardCity/WC_Hub',
        display_name: 'Wizard City Commons',
        world: null,
      }),
    ).toBe('Wizard City Commons');
    expect(
      formatNameRow('zones', { zone_path: 'WizardCity/WC_Hub', display_name: null, world: null }),
    ).toBe('Wizard City / WC Hub');
  });
});

describe('per-type display formats (lead decision 5)', () => {
  it('shows the name for items, spells and drop tables', () => {
    expect(formatNameRow('items', { gid: 4808, name: 'Twice Stitched Boots' })).toBe(
      'Twice Stitched Boots',
    );
    expect(formatNameRow('spells', { template_id: 100, name: 'Pixie' })).toBe('Pixie');
    expect(formatNameRow('drop_tables', { name: 'DS_ACAD1_C01_001', description: null })).toBe(
      'DS_ACAD1_C01_001',
    );
  });

  it('shows the resolved quest title, falling back to the quest name', () => {
    expect(
      formatNameRow('quests', {
        quest_name: 'DS-ACAD1-C01-001',
        title: 'A Trip to the Library',
        level: 1,
        is_mainline: 1,
      }),
    ).toBe('A Trip to the Library');
    expect(
      formatNameRow('quests', {
        quest_name: 'DS-ACAD1-C01-001',
        title: null,
        level: 1,
        is_mainline: 1,
      }),
    ).toBe('DS-ACAD1-C01-001');
  });

  it('shows a string value and falls back to its raw key', () => {
    expect(
      formatNameRow('strings', {
        key: 'QuestTitle_1ED8D',
        value: 'The Missing Gem',
        category: 'QuestTitle',
      }),
    ).toBe('The Missing Gem');
    expect(
      formatNameRow('strings', { key: 'QuestTitle_1ED8D', value: null, category: 'QuestTitle' }),
    ).toBe('QuestTitle_1ED8D');
  });

  it('renders the raw key/id as-is on a lookup miss, never an error', () => {
    expect(formatNameValue('strings', 'QuestTitle_1ED8D', undefined)).toBe('QuestTitle_1ED8D');
    expect(formatNameValue('items', 999999, undefined)).toBe('999999');
    expect(formatNameValue('items', 4808, { gid: 4808, name: 'Twice Stitched Boots' })).toBe(
      'Twice Stitched Boots',
    );
  });

  it('reads the id-like field of every type', () => {
    const rows: Record<string, { row: NameRow; id: string }> = {
      items: { row: { gid: 1, name: 'A' }, id: '1' },
      spells: { row: { template_id: 2, name: 'B' }, id: '2' },
      npcs: { row: { template_id: 3, name: 'C' }, id: '3' },
      quests: {
        row: { quest_name: 'Q-1', title: 'T', level: null, is_mainline: 0 },
        id: 'Q-1',
      },
      zones: { row: { zone_path: 'A/B', display_name: null, world: null }, id: 'A/B' },
      drop_tables: { row: { name: 'DT', description: null }, id: 'DT' },
      strings: { row: { key: 'K', value: null, category: null }, id: 'K' },
    };

    for (const type of NAMES_TYPES) {
      expect(nameRowId(type, rows[type].row), type).toBe(rows[type].id);
    }
  });

  it('builds searchable options that include the raw id', () => {
    const options = toNameOptions('npcs', [{ template_id: 12345, name: 'Judge Eddie' }]);
    expect(options).toEqual([
      { id: '12345', label: 'Judge Eddie (12345)', keywords: 'judge eddie (12345) 12345' },
    ]);
  });
});

/* ----------------------------------------------------------- name filter */

describe('cmdk option filtering (decision D8/D39 item 3)', () => {
  const options = toNameOptions(
    'items',
    Array.from({ length: 380 }, (_value, index) => ({
      gid: index + 1,
      name: `Item ${String(index + 1).padStart(3, '0')}`,
    })),
  );

  it('caps the rendered options and reports the true total', () => {
    const result = filterNameOptions(options, 'Item 1', MAX_NAME_OPTIONS);
    // "Item 1" also matches Item 100-199, so the cap really bites here.
    expect(result.total).toBe(100);
    expect(result.items).toHaveLength(MAX_NAME_OPTIONS);
    expect(result.truncated).toBe(true);
    expect(truncationHint(result)).toBe('showing 50 of 100 matches — keep typing');
  });

  it('shows the first page when the query is empty', () => {
    const result = filterNameOptions(options, '  ');
    expect(result.items).toHaveLength(MAX_NAME_OPTIONS);
    expect(result.total).toBe(380);
    expect(result.truncated).toBe(true);
    expect(truncationHint(result)).toBe('showing 50 of 380 matches — keep typing');
  });

  it('does not claim truncation when everything matched is shown', () => {
    const result = filterNameOptions(options, 'Item 007');
    expect(result.total).toBe(1);
    expect(result.items.map((option) => option.label)).toEqual(['Item 007']);
    expect(result.truncated).toBe(false);
    expect(truncationHint(result)).toBeNull();
  });

  it('matches on the raw id too', () => {
    const result = filterNameOptions(options, '250');
    expect(result.items.map((option) => option.id)).toEqual(['250']);
  });

  it('is case-insensitive', () => {
    const result = filterNameOptions(options, 'item 00');
    expect(result.total).toBe(9);
  });

  it('returns nothing for a query that matches nothing', () => {
    const result = filterNameOptions(options, 'zzzz');
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.truncated).toBe(false);
  });
});

/* ------------------------------------------------- useNames bulk policy */

describe('useNames data path policy (decision D39 item 4)', () => {
  it('bulk-loads exactly the six small types and never strings', () => {
    expect([...BULK_NAME_TYPES]).toEqual([
      'items',
      'spells',
      'npcs',
      'quests',
      'zones',
      'drop_tables',
    ]);
    expect(STREAMED_NAME_TYPE).toBe('strings');
    expect(BULK_NAME_TYPES as readonly string[]).not.toContain('strings');
  });

  it('classifies types correctly', () => {
    expect(isBulkNameType('items')).toBe(true);
    expect(isBulkNameType('npcs')).toBe(true);
    expect(isBulkNameType('strings')).toBe(false);
  });

  it('requires a typed query before server-side string search', () => {
    expect(STRING_MIN_QUERY_LENGTH).toBeGreaterThanOrEqual(2);
    expect(STRING_SEARCH_LIMIT).toBe(MAX_NAME_OPTIONS);
  });

  it('normalizes a selected value to the raw id string', () => {
    expect(selectedId(12345)).toBe('12345');
    expect(selectedId('A/B')).toBe('A/B');
    expect(selectedId(null)).toBe('');
    expect(selectedId(undefined)).toBe('');
    expect(selectedId('')).toBe('');
  });
});

/* ------------------------------------------------------------- toast policy */

describe('toast policy (docs/spec-ui-design.md L111-123)', () => {
  it('stacks bottom-right with at most 3 visible', () => {
    expect(TOASTER_POSITION).toBe('bottom-right');
    expect(TOASTER_VISIBLE_TOASTS).toBe(3);
  });

  it('uses 5s/10s/5s auto-dismiss durations', () => {
    expect(TOAST_DURATIONS).toEqual({ success: 5000, error: 10000, info: 5000 });
  });

  it('gives each spec type its exact left border (spec L115-117)', () => {
    expect(TOAST_ACCENT_WIDTH).toBe('border-l-4');
    expect(TOAST_ACCENT_CLASSES.success).toBe('border-l-4 border-l-emerald-500');
    expect(TOAST_ACCENT_CLASSES.error).toBe('border-l-4 border-l-red-500');
    expect(TOAST_ACCENT_CLASSES.info).toBe('border-l-4 border-l-blue-500');
  });

  it('accent-covers every type sonner can emit — no silent gap', () => {
    // sonner's own `ToastClassnames` keys (node_modules/sonner/dist/index.d.ts).
    const SONNER_TOAST_TYPES = [
      'success',
      'error',
      'info',
      'warning',
      'loading',
      'default',
    ] as const satisfies readonly ToastAccentType[];

    expect(Object.keys(TOAST_ACCENT_CLASSES).sort()).toEqual([...SONNER_TOAST_TYPES].sort());
    for (const type of SONNER_TOAST_TYPES) {
      expect(TOAST_ACCENT_CLASSES[type], type).toContain('border-l-4 ');
      // A real Tailwind colour token, not just the width.
      expect(TOAST_ACCENT_CLASSES[type], type).toMatch(
        /border-l-(emerald|red|blue|amber|zinc)-\d00$/,
      );
    }
  });

  it('wires the accents into sonner so no two colours can share one toast', () => {
    // The width is on `toast` (sonner adds it to every toast); each type key adds
    // only its colour, so no element ever carries two competing colour utilities.
    expect(TOASTER_CLASS_NAMES.toast).toBe(TOAST_ACCENT_WIDTH);
    // `default` is deliberately absent — sonner merges `classNames.default` into
    // every toast, typed or not, so a colour there would fight the type colour.
    expect(Object.keys(TOASTER_CLASS_NAMES)).toEqual([
      'toast',
      'success',
      'error',
      'info',
      'warning',
      'loading',
    ]);

    for (const type of ['success', 'error', 'info', 'warning', 'loading'] as const) {
      // The wired colour is exactly the one the accent map holds for that type.
      expect(TOASTER_CLASS_NAMES[type], type).toBe(
        TOAST_ACCENT_CLASSES[type].replace(`${TOAST_ACCENT_WIDTH} `, ''),
      );
    }
  });

  it('keeps the success checkmark visible briefly', () => {
    expect(SYNC_SUCCESS_ICON_MS).toBeGreaterThanOrEqual(1000);
    expect(SYNC_SUCCESS_ICON_MS).toBeLessThan(TOAST_DURATIONS.success);
  });

  it('reports the real returned counts in the sync success toast', () => {
    expect(
      syncSuccessMessage({
        items: 79835,
        spells: 18173,
        npcs: 23033,
        quests: 322,
        zones: 1241,
      }),
    ).toBe('Sync complete: 79,835 items · 18,173 spells · 23,033 NPCs · 322 quests · 1,241 zones');
  });

  it('defaults missing counts to zero instead of printing NaN', () => {
    expect(syncSuccessMessage({ items: 0, spells: 0, npcs: 0, quests: 0, zones: 0 })).toBe(
      'Sync complete: 0 items · 0 spells · 0 NPCs · 0 quests · 0 zones',
    );
  });

  it('surfaces the server message on failure', () => {
    expect(syncErrorMessage(new Error('Aurorium path not found'))).toBe(
      'Sync failed: Aurorium path not found',
    );
    expect(syncErrorMessage('boom')).toBe('Sync failed');
    expect(syncErrorMessage(new Error('   '))).toBe('Sync failed');
  });

  it('has an actionable settings-save error and a plain success message', () => {
    expect(
      settingsSaveErrorMessage(new Error('aurorium_path "/nope" is not an existing directory')),
    ).toBe('Could not save settings: aurorium_path "/nope" is not an existing directory');
    expect(SETTINGS_SAVED_MESSAGE).toBe('Settings saved');
  });

  it('words the first-startup import toast like the plan', () => {
    expect(importSummaryMessage(2271)).toBe('Imported 2,271 existing entries from SpiralDB');
  });
});

/* --------------------------------------------------------------- swipe */

describe('swipe-to-close helper', () => {
  it('closes on a long enough leftward swipe', () => {
    expect(swipeShouldClose(200, 300, 200 - SWIPE_CLOSE_THRESHOLD_PX, 300)).toBe(true);
    expect(swipeShouldClose(200, 300, 20, 320)).toBe(true);
  });

  it('ignores a short swipe and a rightward swipe', () => {
    expect(swipeShouldClose(200, 300, 200 - SWIPE_CLOSE_THRESHOLD_PX + 1, 300)).toBe(false);
    expect(swipeShouldClose(200, 300, 400, 300)).toBe(false);
  });

  it('ignores a vertical scroll that happens to drift left', () => {
    expect(swipeShouldClose(200, 300, 20, 300 + SWIPE_MAX_VERTICAL_DRIFT_PX + 1)).toBe(false);
  });

  it('honours a custom threshold', () => {
    expect(swipeShouldClose(100, 0, 60, 0, 40)).toBe(true);
    expect(swipeShouldClose(100, 0, 80, 0, 40)).toBe(false);
  });
});

/* ---------------------------------------------------------- sync history view */

const FAILED_SYNC: SyncHistoryEntry = {
  id: 3,
  sync_timestamp: '2026-09-18T09:00:00Z',
  revision: null,
  items_count: null,
  spells_count: null,
  npcs_count: null,
  quests_count: null,
  zones_count: null,
  status: 'failed',
  error_message: 'Aurorium path not found',
};

describe('sync history view helpers', () => {
  const failed = FAILED_SYNC;

  it('renders NULL counts as zeros', () => {
    expect(historyCounts(failed)).toEqual({ items: 0, spells: 0, npcs: 0, quests: 0, zones: 0 });
    expect(formatHistoryCounts(failed)).toBe('0 items · 0 spells · 0 NPCs · 0 quests · 0 zones');
  });

  it('maps every stored status to a text label', () => {
    expect(syncOutcome('success')).toEqual({ label: 'Success', ok: true });
    expect(syncOutcome('partial')).toEqual({ label: 'Partial', ok: false });
    expect(syncOutcome('failed')).toEqual({ label: 'Failed', ok: false });
    expect(syncOutcome(null)).toEqual({ label: 'Unknown', ok: false });
    expect(syncOutcome('weird')).toEqual({ label: 'weird', ok: false });
  });

  it('formats a local timestamp and the never-synced state', () => {
    expect(formatLocalTimestamp(null)).toBe('Never');
    expect(formatLocalTimestamp('')).toBe('Never');
    expect(formatLocalTimestamp('not-a-date')).toBe('not-a-date');

    const shown = formatLocalTimestamp('2026-09-25T15:30:00Z');
    expect(shown).toContain('2026');
    expect(shown).toContain(' at ');
  });
});

/* ------------------------------------------------------------------- api */

describe('names + sync client wrappers', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  function json(body: unknown, init: ResponseInit = {}): Response {
    return new Response(JSON.stringify(body), {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  }

  function calledUrl(index = 0): string {
    return String((fetchMock.mock.calls[index] as [string, RequestInit])[0]);
  }

  function calledInit(index = 0): RequestInit {
    return (fetchMock.mock.calls[index] as [string, RequestInit])[1];
  }

  it('unwraps the { "<type>": [...] } envelope', async () => {
    fetchMock.mockResolvedValue(json({ items: [{ gid: 4808, name: 'Twice Stitched Boots' }] }));
    await expect(getNames('items')).resolves.toEqual([{ gid: 4808, name: 'Twice Stitched Boots' }]);
    expect(calledUrl()).toBe('/api/names/items');
  });

  it('sends ?q= and ?limit= for the strings path', async () => {
    fetchMock.mockResolvedValue(json({ strings: [] }));
    await getNames('strings', { q: 'Quest Title', limit: 50 });
    const url = calledUrl();
    expect(url.startsWith('/api/names/strings?')).toBe(true);
    expect(url).toContain('q=Quest+Title');
    expect(url).toContain('limit=50');
  });

  it('rejects a body without the expected envelope', async () => {
    fetchMock.mockResolvedValue(json({ items: 'nope' }));
    await expect(getNames('items')).rejects.toThrow(/envelope/);
  });

  it('percent-encodes a slash-bearing id (zones)', async () => {
    fetchMock.mockResolvedValue(
      json({ zone_path: 'Aquila/AQ_Z00_Hub', display_name: null, world: null }),
    );
    await getName('zones', 'Aquila/AQ_Z00_Hub');
    expect(calledUrl()).toBe('/api/names/zones/Aquila%2FAQ_Z00_Hub');
  });

  it('POSTs a sync and returns the counts', async () => {
    fetchMock.mockResolvedValue(
      json({
        status: 'success',
        synced: { items: 1, spells: 2, npcs: 3, quests: 4, zones: 5 },
        timestamp: 't',
      }),
    );
    await expect(postSync()).resolves.toMatchObject({ status: 'success' });
    expect(calledUrl()).toBe('/api/sync');
    expect(calledInit().method).toBe('POST');
  });

  it('unwraps the sync history envelope', async () => {
    fetchMock.mockResolvedValue(json({ history: [FAILED_SYNC] }));
    await expect(getSyncHistory()).resolves.toEqual([FAILED_SYNC]);
  });

  it('exposes stable query keys', () => {
    expect(namesQueryKey('npcs')).toEqual(['names', 'npcs']);
    expect(namesQueryKey('strings', { q: 'ab', limit: 50 })).toEqual([
      'names',
      'strings',
      { q: 'ab', limit: 50 },
    ]);
    expect(SYNC_STATUS_QUERY_KEY).toEqual(['sync', 'status']);
    expect(SYNC_HISTORY_QUERY_KEY).toEqual(['sync', 'history']);
  });
});
