import { afterEach, describe, expect, it } from 'vitest';

import { MEMORY_DB, openDb, type Db } from '@server/db';
import { scanLangDir, type ScanLangDirResult } from '@server/services/sync/lang';
import { runSync, type SyncDeps, type RunSyncResult } from '@server/services/sync/execute';

/**
 * Task 1.4f — transactional replace + `sync_history` (p1-06-ac1/ac3).
 *
 * Every database here is `:memory:` and every pipeline stage is injected, so no
 * test spawns a real unpack or reads a real path. The `.lang` fixture is parsed
 * by the **real** `scanLangDir` (over a fake filesystem), because the exact-token
 * key rule is precisely what is under test.
 */

const OPEN: Db[] = [];

afterEach(() => {
  while (OPEN.length > 0) {
    OPEN.pop()?.close();
  }
});

function memoryDb(): Db {
  const db = openDb({ file: MEMORY_DB });
  OPEN.push(db);
  return db;
}

/**
 * `QuestTitle.lang` with the measured collision: the decimal token `126346` and
 * the hex token `1ED8A` are the same numeric index with different values, plus a
 * zero-padded decimal token and one named key.
 */
const QUEST_TITLE_LANG = Buffer.from(
  '\uFEFF' +
    '1:QuestTitle\r\n' +
    '126346\r\n\r\nLetters of Light\r\n' +
    '1ED8A\r\n\r\nForged in Fire\r\n' +
    '00001717\r\n\r\nA Padded Key\r\n' +
    'QuestFinder\r\n\r\nQuest Finder\r\n',
  'utf16le',
);

/** The real parser over a fake single-file directory. */
function langScan(): Promise<ScanLangDirResult> {
  return scanLangDir('/fake/Locale/en-US', {
    deps: {
      readdir: async () => ['QuestTitle.lang'],
      readFile: async () => QUEST_TITLE_LANG,
    },
  });
}

const FAKE_TREE = '/nonexistent/spiraldb-test-tree';

/** Every stage injected; `overrides` in the test supply the three paths. */
function fakeDeps(overrides: Partial<SyncDeps> = {}): SyncDeps {
  return {
    resolveRevision: () => ({
      revision: 'V_rTEST.Wizard_1_610',
      dataPath: '/aurorium/data/V_rTEST.Wizard_1_610',
      rootWadPath: '/aurorium/data/V_rTEST.Wizard_1_610/Data/GameData/Root.wad',
      source: 'auto',
    }),
    runUnpack: async () => ({
      tempDir: FAKE_TREE,
      reused: false,
      durationMs: 17,
      removed: false,
      kept: true,
      stdout: '',
    }),
    scanLangDir: () => langScan(),
    scanTemplateTree: async () => ({
      rows: [],
      items: [
        { gid: 22716, name: 'Fire Cat' },
        { gid: 22717, name: 'Fire Cat (Pet)' },
      ],
      spells: [{ template_id: 424, name: 'Firecat' }],
      npcs: [{ template_id: 1749407, name: 'Private Stillson' }],
      counts: {
        item: 2,
        spell: 1,
        npc: 1,
        pet: 0,
        mount: 0,
        scannedFiles: 4,
        skippedClasses: 0,
        parseErrors: 0,
        noName: 0,
        noNameByFamily: { item: 0, spell: 0, npc: 0, pet: 0, mount: 0 },
        noId: 0,
      },
      parseErrors: [],
    }),
    buildQuestRows: async () => ({
      rows: [
        {
          quest_name: 'WC-PreCel-MAIN-001',
          title: 'Forged in Fire',
          level: 5,
          is_mainline: true,
          titleKey: 'QuestTitle_1ED8A',
          titleSource: 'resolved',
        },
        {
          quest_name: 'WC-PreCel-MAIN-002',
          title: 'Letters of Light',
          level: 6,
          is_mainline: false,
          titleKey: 'QuestTitle_126346',
          titleSource: 'resolved',
        },
      ],
      files: 2,
      parseErrors: [],
      resolvedTitles: 2,
      rawKeyFallbacks: 0,
      missingTitles: 0,
    }),
    buildZoneRows: async () => ({
      rows: [
        {
          zone_path: 'WizardCity/WC_Hub',
          display_name: 'Wizard City / WC Hub',
          world: 'WizardCity',
        },
      ],
      files: 1,
      parseErrors: [],
    }),
    buildDropTableRows: async () => ({
      rows: [{ name: 'DS-ACAD1-C01-001', description: null }],
      files: 1,
      parseErrors: [],
    }),
    ...overrides,
  };
}

const OVERRIDES = {
  auroriumPath: '/aurorium',
  imcodecPath: '/imcodec/imcodec',
  spiraldbPath: '/spiraldb',
};

function run(db: Db, deps: SyncDeps = fakeDeps()): Promise<RunSyncResult> {
  return runSync({
    db,
    deps,
    overrides: OVERRIDES,
    now: () => new Date('2026-09-25T15:30:00.000Z'),
  });
}

function count(db: Db, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

const SEVEN_TABLES = [
  'string_table',
  'items',
  'spells',
  'npcs',
  'quests',
  'zones',
  'drop_tables',
] as const;

/** Sentinel rows, so a rollback failure is visible as a changed count. */
function seedSentinels(db: Db): Record<string, number> {
  db.prepare('INSERT INTO string_table (key, value, category) VALUES (?, ?, ?)').run(
    'Old_1',
    'old',
    'Old',
  );
  db.prepare('INSERT INTO items (gid, name) VALUES (?, ?)').run(1, 'Sentinel Item');
  db.prepare('INSERT INTO spells (template_id, name) VALUES (?, ?)').run(1, 'Sentinel Spell');
  db.prepare('INSERT INTO npcs (template_id, name) VALUES (?, ?)').run(1, 'Sentinel Npc');
  db.prepare('INSERT INTO quests (quest_name, title, level, is_mainline) VALUES (?, ?, ?, ?)').run(
    'SENTINEL-001',
    'Sentinel Quest',
    1,
    1,
  );
  db.prepare('INSERT INTO zones (zone_path, display_name) VALUES (?, ?)').run(
    'Sentinel/Zone',
    'Sentinel',
  );
  db.prepare('INSERT INTO drop_tables (name, description) VALUES (?, ?)').run('Sentinel', null);
  return Object.fromEntries(SEVEN_TABLES.map((table) => [table, count(db, table)]));
}

describe('runSync — success path', () => {
  it('replaces all seven tables and writes one success history row', async () => {
    const db = memoryDb();

    const result = await run(db);

    expect(result.status).toBe('success');
    expect(result.revision).toBe('V_rTEST.Wizard_1_610');
    expect(result.reused).toBe(false);
    expect(result.timestamp).toBe('2026-09-25T15:30:00Z');
    expect(result.counts).toEqual({
      items: 2,
      spells: 1,
      npcs: 1,
      quests: 2,
      zones: 1,
      drop_tables: 1,
      string_table: 4,
    });
    for (const table of SEVEN_TABLES) {
      expect(count(db, table)).toBe(result.counts[table]);
    }

    const history = db.prepare('SELECT * FROM sync_history').all() as Array<
      Record<string, unknown>
    >;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      revision: 'V_rTEST.Wizard_1_610',
      items_count: 2,
      spells_count: 1,
      npcs_count: 1,
      quests_count: 2,
      zones_count: 1,
      status: 'success',
      error_message: null,
    });
  });

  it('keeps both lexical forms of one numeric index as distinct rows (D33(e))', async () => {
    const db = memoryDb();

    await run(db);

    const value = (key: string): string | undefined =>
      (
        db.prepare('SELECT value FROM string_table WHERE key = ?').get(key) as
          { value: string } | undefined
      )?.value;

    expect(value('QuestTitle_126346')).toBe('Letters of Light');
    expect(value('QuestTitle_1ED8A')).toBe('Forged in Fire');
    expect(value('QuestTitle_00001717')).toBe('A Padded Key');
    expect(value('QuestTitle_QuestFinder')).toBe('Quest Finder');
  });

  it('is idempotent: a second run leaves identical counts and no duplicates', async () => {
    const db = memoryDb();

    const first = await run(db);
    const second = await run(db);

    expect(second.counts).toEqual(first.counts);
    for (const table of SEVEN_TABLES) {
      expect(count(db, table)).toBe(first.counts[table]);
    }
    const duplicates = db
      .prepare('SELECT key FROM string_table GROUP BY key HAVING COUNT(*) > 1')
      .all();
    expect(duplicates).toEqual([]);
    expect(count(db, 'sync_history')).toBe(2);
    const statuses = db.prepare('SELECT status FROM sync_history ORDER BY id').all();
    expect(statuses).toEqual([{ status: 'success' }, { status: 'success' }]);
  });

  it('round-trips every quest/zone/drop_table column', async () => {
    const db = memoryDb();

    await run(db);

    expect(db.prepare('SELECT * FROM quests ORDER BY quest_name').all()).toEqual([
      {
        quest_name: 'WC-PreCel-MAIN-001',
        title: 'Forged in Fire',
        level: 5,
        is_mainline: 1,
        updated_at: expect.any(String),
      },
      {
        quest_name: 'WC-PreCel-MAIN-002',
        title: 'Letters of Light',
        level: 6,
        is_mainline: 0,
        updated_at: expect.any(String),
      },
    ]);
    expect(db.prepare('SELECT zone_path, display_name, world FROM zones').get()).toEqual({
      zone_path: 'WizardCity/WC_Hub',
      display_name: 'Wizard City / WC Hub',
      world: 'WizardCity',
    });
    expect(db.prepare('SELECT name, description FROM drop_tables').get()).toEqual({
      name: 'DS-ACAD1-C01-001',
      description: null,
    });
  });
});

describe('runSync — failure path', () => {
  it('rolls the whole data transaction back and writes a failed history row', async () => {
    const db = memoryDb();
    const before = seedSentinels(db);

    // Two drop_tables rows with the same PK: the bulk INSERT fails *inside* the
    // transaction, after the DELETE and the six preceding bulk inserts.
    const result = await run(
      db,
      fakeDeps({
        buildDropTableRows: async () => ({
          rows: [
            { name: 'DUPLICATE', description: null },
            { name: 'DUPLICATE', description: 'second' },
          ],
          files: 2,
          parseErrors: [],
        }),
      }),
    );

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBeTruthy();
    expect(result.counts.string_table).toBe(0);
    for (const table of SEVEN_TABLES) {
      expect(count(db, table)).toBe(before[table]);
    }

    const rows = db.prepare('SELECT * FROM sync_history').all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].error_message).toBeTruthy();
    expect(String(rows[0].error_message)).toMatch(/UNIQUE|constraint/i);
    expect(rows[0].revision).toBe('V_rTEST.Wizard_1_610');
  });

  it('keeps previous contents when a scan stage throws', async () => {
    const db = memoryDb();
    const before = seedSentinels(db);

    const result = await run(
      db,
      fakeDeps({
        scanLangDir: async () => {
          throw new Error('synthetic scan failure');
        },
      }),
    );

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toBe('synthetic scan failure');
    for (const table of SEVEN_TABLES) {
      expect(count(db, table)).toBe(before[table]);
    }
    const failed = db.prepare('SELECT status, error_message FROM sync_history').get() as {
      status: string;
      error_message: string;
    };
    expect(failed.status).toBe('failed');
    expect(failed.error_message).toBe('synthetic scan failure');
  });

  it('reports a failed run without touching the tables when a path setting is empty', async () => {
    const db = memoryDb();
    const before = seedSentinels(db);

    const result = await runSync({
      db,
      deps: fakeDeps(),
      overrides: { auroriumPath: '', spiraldbPath: '/spiraldb' },
    });

    expect(result.status).toBe('failed');
    expect(result.errorMessage).toContain('aurorium_path');
    expect(count(db, 'items')).toBe(before.items);
  });

  it('de-duplicates by primary key and reports the dropped rows (measured spells collision)', async () => {
    const db = memoryDb();

    // Spells_00000151 ("Freeze") and Spell_00000151 ("Snow Shield") share the
    // numeric m_displayName index 151 in the real build; the INTEGER PRIMARY KEY
    // can hold only one row, so the second is dropped and counted.
    const result = await run(
      db,
      fakeDeps({
        scanTemplateTree: async () => ({
          rows: [],
          items: [
            { gid: 22716, name: 'Fire Cat' },
            { gid: 22716, name: 'Fire Cat (duplicate)' },
          ],
          spells: [
            { template_id: 151, name: 'Freeze' },
            { template_id: 151, name: 'Snow Shield' },
          ],
          npcs: [{ template_id: 7, name: 'Private Stillson' }],
          counts: {
            item: 2,
            spell: 2,
            npc: 1,
            pet: 0,
            mount: 0,
            scannedFiles: 5,
            skippedClasses: 0,
            parseErrors: 0,
            noName: 0,
            noNameByFamily: { item: 0, spell: 0, npc: 0, pet: 0, mount: 0 },
            noId: 0,
          },
          parseErrors: [],
        }),
      }),
    );

    expect(result.status).toBe('success');
    expect(result.counts.items).toBe(1);
    expect(result.counts.spells).toBe(1);
    expect(result.deduplicated).toEqual({ items: 1, spells: 1, npcs: 0 });
    expect(db.prepare('SELECT name FROM items WHERE gid = 22716').get()).toEqual({
      name: 'Fire Cat',
    });
    expect(db.prepare('SELECT name FROM spells WHERE template_id = 151').get()).toEqual({
      name: 'Freeze',
    });
    expect(
      (db.prepare('SELECT COUNT(*) AS count FROM spells').get() as { count: number }).count,
    ).toBe(1);
  });

  it('skips the unpack entirely when a tree is supplied and reports it as reused', async () => {
    const db = memoryDb();
    let unpackCalls = 0;

    const result = await runSync({
      db,
      treeDir: '/tmp/wad-spike',
      overrides: OVERRIDES,
      deps: fakeDeps({
        runUnpack: async () => {
          unpackCalls += 1;
          throw new Error('unpack must not be called on the reuse path');
        },
      }),
    });

    expect(unpackCalls).toBe(0);
    expect(result.status).toBe('success');
    expect(result.reused).toBe(true);
    expect(result.treeDir).toBe('/tmp/wad-spike');
    expect(result.timings.unpackMs).toBe(0);
  });
});
