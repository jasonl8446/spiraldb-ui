import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_AURORIUM_PATH,
  DEFAULT_IMCODEC_PATH,
  DB_FILE_ENV_VAR,
  DEFAULT_SPIRALDB_PATH,
  MEMORY_DB,
  applyQuestCatalogColumnAdds,
  buildSeedSettings,
  closeDb,
  defaultDbFile,
  formatLocalDate,
  initSchema,
  getDb,
  openDb,
  readSettings,
  resolveDbFile,
  resolveRepoRoot,
  resolveSyncDbFile,
  seedSettings,
  testSpiraldbPath,
  type Db,
} from '@server/db';

/**
 * Task 1.2 acceptance: the migration matches docs/spec-data-model.md L21-162
 * column-for-column (the 11 initial tables, 3 named indexes, the entry_status
 * UNIQUE constraint); task 6.4 adds migration 0002 — the quest catalog
 * (docs/spec-data-model.md L137-220): two tables, three indexes, the `coverage`
 * view and four `quests` columns applied by a PRAGMA-guarded step because SQLite
 * has no `ADD COLUMN IF NOT EXISTS` and this runner re-execs every file on every
 * open. Task 6.6 adds migration 0003 — the **persona index** the evidence endpoint's
 * speaker ladder reads (one table, one index; `CREATE ... IF NOT EXISTS` only, so it
 * needs no guarded step). Task 7.6 adds migration 0005 — `quest_suggestions`, its three indexes
 * (one an expression index over the suggestion's identity) and the `quest_drafts` view, again
 * `CREATE ... IF NOT EXISTS` only. The `settings` seed matches L164-169 with the env/NODE_ENV precedence from
 * the lead's decisions, and every step is idempotent.
 *
 * Every test uses `:memory:` or a throwaway file under `data/` (gitignored) —
 * never the real `data/spiraldb-ui.db` (decision D17).
 */

/** Independently re-typed from the spec — deliberately not imported from db.ts. */
const EXPECTED_TABLES = [
  'decks',
  'drop_tables',
  'entry_status',
  'items',
  'npcs',
  'persona_index',
  'quest_catalog_refs',
  'quest_ids',
  'quest_suggestions',
  'quests',
  'recipes',
  'settings',
  'spells',
  'status_history',
  'string_table',
  'sync_history',
  'zones',
];

const EXPECTED_INDEXES = [
  'idx_decks_deck_name',
  'idx_entry_status_key',
  'idx_entry_status_status',
  'idx_entry_status_type',
  'idx_persona_index_template',
  'idx_quest_catalog_refs_quest',
  'idx_quest_catalog_refs_wad',
  'idx_quest_ids_matched',
  'idx_quest_suggestions_catalog',
  'idx_quest_suggestions_identity',
  'idx_quest_suggestions_quest',
];

/** The two views: `coverage` (spec L183-191) and `quest_drafts` (migration 0005, task 7.6). */
const EXPECTED_VIEWS = ['coverage', 'quest_drafts'];

/** The four `quests` columns migration 0002 adds, re-typed from spec L152-155. */
const EXPECTED_QUEST_CATALOG_COLUMNS: Array<[string, string, number, string | null]> = [
  ['has_definition', 'INTEGER', 1, '0'],
  ['link_kind', 'TEXT', 0, null],
  ['title_source', 'TEXT', 0, null],
  ['reference_count', 'INTEGER', 1, '0'],
];

const EXPECTED_SETTINGS_KEYS = [
  'aurorium_path',
  'git_branch',
  'imcodec_path',
  'spiraldb_path',
  'user_name',
];

const openConnections: Db[] = [];
const tempDirs: string[] = [];

/** Scratch root inside the workspace (`data/` is gitignored) — never the real DB. */
const SCRATCH_ROOT = path.join(resolveRepoRoot(), 'data', '__test-scratch__');

function makeTempDir(): string {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(SCRATCH_ROOT, 'db-'));
  tempDirs.push(dir);
  return dir;
}

function open(file: string = MEMORY_DB): Db {
  const db = openDb({ file });
  openConnections.push(db);
  return db;
}

function listTables(db: Db): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function listIndexes(db: Db): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

function listViews(db: Db): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'view' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  return rows.map((row) => row.name);
}

/** Fixed local timestamp: 26 Sep 2026 (month is 0-based). */
const FIXED_NOW = new Date(2026, 8, 26, 10, 30, 0);

afterEach(() => {
  while (openConnections.length > 0) {
    openConnections.pop()?.close();
  }
  closeDb();
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe('schema introspection', () => {
  it('creates exactly the 17 tables from the spec (11 + migrations 0002/0003/0004/0005), on a fresh database', () => {
    const db = open();

    expect(listTables(db)).toHaveLength(17);
    expect(listTables(db)).toEqual(EXPECTED_TABLES);
  });

  it('creates the 11 named indexes from the spec (3 + migrations 0002/0003/0004/0005)', () => {
    const db = open();

    expect(listIndexes(db)).toHaveLength(11);
    expect(listIndexes(db)).toEqual(EXPECTED_INDEXES);
  });

  it('creates the coverage view, whose denominators are count(*) on their own tables', () => {
    const db = open();

    expect(listViews(db)).toEqual(EXPECTED_VIEWS);

    const count = (table: string): number =>
      (db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c;

    db.prepare(
      "INSERT INTO quests (quest_name, title, has_definition) VALUES ('Q-001', 't', 1)",
    ).run();
    db.prepare(
      "INSERT INTO quests (quest_name, title, has_definition) VALUES ('Q-002', 't', 0)",
    ).run();
    db.prepare(
      "INSERT INTO quest_catalog_refs (quest_name, wad, entry, class) VALUES ('Q-002', 'a.wad', 'gamedata.bin', 'WizZoneData')",
    ).run();
    db.prepare('INSERT INTO quest_ids (quest_id, text_rows) VALUES (17, 3)').run();

    const coverage = db.prepare('SELECT * FROM coverage').get() as Record<string, number>;
    // nameable / id_space / references ARE count(*) on their tables — never a second definition.
    expect(coverage.nameable).toBe(count('quests'));
    expect(coverage.id_space).toBe(count('quest_ids'));
    expect(coverage.references).toBe(count('quest_catalog_refs'));
    expect(coverage).toEqual({
      nameable: 2,
      id_space: 1,
      defined: 1,
      missing: 1,
      references: 1,
    });
  });

  it('adds the four migration-0002 columns to quests, keeping the PK unchanged (spec L152-155)', () => {
    const db = open();

    const columns = db.pragma('table_info(quests)') as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;
    expect(columns.map((column) => [column.name, column.type])).toEqual([
      ['quest_name', 'TEXT'],
      ['title', 'TEXT'],
      ['level', 'INTEGER'],
      ['is_mainline', 'BOOLEAN'],
      ['updated_at', 'DATETIME'],
      ['has_definition', 'INTEGER'],
      ['link_kind', 'TEXT'],
      ['title_source', 'TEXT'],
      ['reference_count', 'INTEGER'],
    ]);
    // The existing primary key is unchanged (task 6.4's first bullet).
    expect(columns.filter((column) => column.pk > 0).map((column) => column.name)).toEqual([
      'quest_name',
    ]);
    for (const [name, type, notnull, dflt] of EXPECTED_QUEST_CATALOG_COLUMNS) {
      const column = columns.find((candidate) => candidate.name === name);
      expect([name, column?.type, column?.notnull, column?.dflt_value]).toEqual([
        name,
        type,
        notnull,
        dflt,
      ]);
    }
  });

  /**
   * The measured trap (task 6.4): SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT
   * EXISTS` and `initSchema` `db.exec`s every migration file on every open, so a raw
   * `ADD COLUMN` in 0002 would throw `duplicate column name` on the second open. The
   * guard reads `PRAGMA table_info` and must therefore issue these ALTERs exactly once.
   */
  it('applies the guarded quests column adds exactly once across repeated initSchema calls', () => {
    const db = open();

    expect(applyQuestCatalogColumnAdds(db)).toBe(0);
    expect(() => initSchema(db)).not.toThrow();
    expect(() => initSchema(db)).not.toThrow();
    expect(applyQuestCatalogColumnAdds(db)).toBe(0);
    expect(db.pragma('table_info(quests)')).toHaveLength(9);
  });

  it('matches the spec columns of entry_status, including the UNIQUE constraint', () => {
    const db = open();

    const columns = db.pragma('table_info(entry_status)') as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;
    expect(columns.map((column) => [column.name, column.type])).toEqual([
      ['id', 'INTEGER'],
      ['object_type', 'TEXT'],
      ['object_key', 'TEXT'],
      ['status', 'TEXT'],
      ['extracted_at', 'DATETIME'],
      ['reviewed_at', 'DATETIME'],
      ['verified_at', 'DATETIME'],
      ['reviewed_by', 'TEXT'],
      ['verified_by', 'TEXT'],
    ]);
    expect(columns.find((column) => column.name === 'id')?.pk).toBe(1);
    expect(columns.find((column) => column.name === 'status')?.dflt_value).toBe("'extracted'");
    expect(columns.find((column) => column.name === 'extracted_at')?.dflt_value).toBe(
      'CURRENT_TIMESTAMP',
    );

    // The UNIQUE(object_type, object_key) constraint is really enforced.
    const insert = db.prepare(
      "INSERT INTO entry_status (object_type, object_key) VALUES ('quest', 'DS-ACAD-C01-001')",
    );
    insert.run();
    expect(() => insert.run()).toThrowError(/UNIQUE/i);

    // ...and a different key for the same type is fine.
    expect(() =>
      db
        .prepare(
          "INSERT INTO entry_status (object_type, object_key) VALUES ('quest', 'DS-ACAD-C01-002')",
        )
        .run(),
    ).not.toThrow();
  });

  it('creates the remaining tables with the spec primary keys', () => {
    const db = open();

    const primaryKey = (table: string): string[] =>
      (db.pragma(`table_info(${table})`) as Array<{ name: string; pk: number }>)
        .filter((column) => column.pk > 0)
        .map((column) => column.name);

    expect(primaryKey('items')).toEqual(['gid']);
    expect(primaryKey('spells')).toEqual(['template_id']);
    expect(primaryKey('npcs')).toEqual(['template_id']);
    expect(primaryKey('quests')).toEqual(['quest_name']);
    expect(primaryKey('zones')).toEqual(['zone_path']);
    expect(primaryKey('drop_tables')).toEqual(['name']);
    expect(primaryKey('string_table')).toEqual(['key']);
    expect(primaryKey('settings')).toEqual(['key']);
    expect(db.pragma('foreign_key_list(status_history)')).toEqual([
      expect.objectContaining({ table: 'entry_status', from: 'entry_status_id', to: 'id' }),
    ]);
  });

  it('openDb creates a missing parent directory before opening the file', () => {
    const nested = path.join(makeTempDir(), 'nested', 'deeper', 'x.db');

    const db = open(nested);

    expect(fs.existsSync(nested)).toBe(true);
    expect(listTables(db)).toEqual(EXPECTED_TABLES);
  });
});

describe('settings seed defaults', () => {
  it('seeds exactly the five spec keys with the D3/D17 defaults', () => {
    const db = open();

    const result = seedSettings(db, { env: {}, now: FIXED_NOW, repoRoot: '/repo' });

    expect(result.seeded).toBe(true);
    expect(Object.keys(readSettings(db)).sort()).toEqual(EXPECTED_SETTINGS_KEYS);
    expect(readSettings(db)).toEqual({
      aurorium_path: DEFAULT_AURORIUM_PATH,
      imcodec_path: DEFAULT_IMCODEC_PATH,
      user_name: '',
      spiraldb_path: DEFAULT_SPIRALDB_PATH,
      git_branch: 'content/2026-09-26',
    });
  });

  it('uses the D3 prebuilt Imcodec binary and the D17 owner fork as defaults', () => {
    expect(DEFAULT_IMCODEC_PATH).toBe(
      '/home/jason/Documents/git-projects/Imview/submodule/Imcodec/src/Imcodec.Cli/bin/Debug/net9.0/linux-x64/imcodec',
    );
    expect(DEFAULT_SPIRALDB_PATH).toBe('/home/jason/Documents/git-projects/spiraldb');
    expect(DEFAULT_AURORIUM_PATH).toBe('/home/jason/Documents/git-projects/Aurorium');
  });

  it('formats git_branch from the injected local date', () => {
    expect(formatLocalDate(FIXED_NOW)).toBe('2026-09-26');
    expect(formatLocalDate(new Date(2026, 0, 3))).toBe('2026-01-03');
    expect(formatLocalDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('settings override precedence', () => {
  it('lets an explicit SPIRALDB_PATH env var win over every default', () => {
    const values = buildSeedSettings({
      env: { SPIRALDB_PATH: '/tmp/whatever-dir', NODE_ENV: 'test' },
      now: FIXED_NOW,
      repoRoot: '/repo',
    });

    expect(values.spiraldb_path).toBe('/tmp/whatever-dir');
  });

  it('points spiraldb_path at data/test-spiraldb when NODE_ENV=test', () => {
    const values = buildSeedSettings({
      env: { NODE_ENV: 'test' },
      now: FIXED_NOW,
      repoRoot: '/repo',
    });

    expect(values.spiraldb_path).toBe('/repo/data/test-spiraldb');
    expect(values.spiraldb_path).toBe(testSpiraldbPath('/repo'));
  });

  it('keeps the owner fork when NODE_ENV is not test', () => {
    expect(buildSeedSettings({ env: {}, repoRoot: '/repo' }).spiraldb_path).toBe(
      DEFAULT_SPIRALDB_PATH,
    );
    expect(
      buildSeedSettings({ env: { NODE_ENV: 'production' }, repoRoot: '/repo' }).spiraldb_path,
    ).toBe(DEFAULT_SPIRALDB_PATH);
  });

  it('overrides every key from its documented env var', () => {
    const values = buildSeedSettings({
      env: {
        AURORIUM_PATH: '/tmp/aurorium',
        IMCODEC_PATH: '/tmp/imcodec',
        USER_NAME: 'jason',
        SPIRALDB_PATH: '/tmp/spiraldb',
        GIT_BRANCH: 'content/custom',
      },
      now: FIXED_NOW,
      repoRoot: '/repo',
    });

    expect(values).toEqual({
      aurorium_path: '/tmp/aurorium',
      imcodec_path: '/tmp/imcodec',
      user_name: 'jason',
      spiraldb_path: '/tmp/spiraldb',
      git_branch: 'content/custom',
    });
  });

  it('treats an empty env var as unset', () => {
    const values = buildSeedSettings({
      env: { SPIRALDB_PATH: '' },
      now: FIXED_NOW,
      repoRoot: '/repo',
    });

    expect(values.spiraldb_path).toBe(DEFAULT_SPIRALDB_PATH);
  });

  it('does not overwrite existing settings on a second seeding run', () => {
    const db = open();
    seedSettings(db, { env: {}, now: FIXED_NOW, repoRoot: '/repo' });

    db.prepare("UPDATE settings SET value = ? WHERE key = 'user_name'").run('owner-edited');

    const second = seedSettings(db, {
      env: { USER_NAME: 'from-env', SPIRALDB_PATH: '/tmp/other' },
      now: FIXED_NOW,
      repoRoot: '/repo',
    });

    expect(second.seeded).toBe(false);
    expect(readSettings(db).user_name).toBe('owner-edited');
    expect(readSettings(db).spiraldb_path).toBe(DEFAULT_SPIRALDB_PATH);
    expect(Object.keys(readSettings(db)).sort()).toEqual(EXPECTED_SETTINGS_KEYS);
  });

  it('seeds a partially emptied settings table only when it is completely empty', () => {
    const db = open();
    db.prepare("INSERT INTO settings (key, value) VALUES ('user_name', 'someone')").run();

    const result = seedSettings(db, { env: {}, now: FIXED_NOW, repoRoot: '/repo' });

    expect(result.seeded).toBe(false);
    expect(readSettings(db)).toEqual({ user_name: 'someone' });
  });
});

describe('idempotency', () => {
  it('re-running initSchema keeps 17 tables, 2 views, 11 indexes and the seeded rows', () => {
    const db = open();
    seedSettings(db, { env: {}, now: FIXED_NOW, repoRoot: '/repo' });

    expect(() => initSchema(db)).not.toThrow();
    expect(() => initSchema(db)).not.toThrow();

    expect(listTables(db)).toHaveLength(17);
    expect(listTables(db)).toEqual(EXPECTED_TABLES);
    expect(listViews(db)).toEqual(EXPECTED_VIEWS);
    expect(listIndexes(db)).toHaveLength(11);
    expect(listIndexes(db)).toEqual(EXPECTED_INDEXES);
    expect(readSettings(db)).toEqual({
      aurorium_path: DEFAULT_AURORIUM_PATH,
      imcodec_path: DEFAULT_IMCODEC_PATH,
      user_name: '',
      spiraldb_path: DEFAULT_SPIRALDB_PATH,
      git_branch: 'content/2026-09-26',
    });
  });

  /**
   * Task 6.4-ac1's own proof, in unit form: the migration must be idempotent for a
   * **file** database opened twice, because `openDb` re-execs every migration file
   * on every open. (The real-database evidence re-runs this against a copy of the
   * live file.)
   */
  it('re-opening an existing file database is idempotent', () => {
    const file = path.join(makeTempDir(), 'restart.db');

    const first = open(file);
    seedSettings(first, { env: {}, now: FIXED_NOW, repoRoot: '/repo' });
    first.close();
    openConnections.pop();

    // The second open runs 0001+0002 over a database that already has them — the
    // exact place a raw `ALTER TABLE ADD COLUMN` would throw `duplicate column name`.
    expect(() => open(file)).not.toThrow();
    const second = openConnections[openConnections.length - 1] as Db;

    expect(listTables(second)).toEqual(EXPECTED_TABLES);
    expect(listViews(second)).toEqual(EXPECTED_VIEWS);
    expect(listIndexes(second)).toEqual(EXPECTED_INDEXES);
    expect(
      (second.pragma('table_info(quests)') as Array<{ name: string }>).map((c) => c.name),
    ).toEqual([
      'quest_name',
      'title',
      'level',
      'is_mainline',
      'updated_at',
      'has_definition',
      'link_kind',
      'title_source',
      'reference_count',
    ]);
    expect(readSettings(second).user_name).toBe('');
  });
});

describe('repo root resolution', () => {
  it('finds the project root by its package name, not by the directory name', () => {
    const repoRoot = resolveRepoRoot();

    // Resolution is *content*-based (`resolveRepoRoot` walks up to the
    // `package.json` whose `name` is `spiraldb-ui`), so this must hold for ANY
    // checkout location. Asserting `path.basename(repoRoot)` would instead pin
    // the directory name and fail wherever the checkout is named something else
    // — a differently-named clone, or the c5 team-worktree layout
    // `.omd/worktrees/{run-id}` — while proving nothing about the resolution.
    expect(fs.existsSync(path.join(repoRoot, 'package.json'))).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      name?: unknown;
    };
    expect(manifest.name).toBe('spiraldb-ui');
    // Structural markers only the real root has.
    expect(fs.existsSync(path.join(repoRoot, 'server', 'migrations'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'client', 'src'))).toBe(true);
    expect(testSpiraldbPath(repoRoot)).toBe(path.join(repoRoot, 'data', 'test-spiraldb'));
  });

  it('resolves the same root from any start directory inside the project', () => {
    const repoRoot = resolveRepoRoot();

    // Start-dir independence: the walk-up is driven by the manifest, not by the
    // caller's location, so a nested start directory must not change the answer.
    expect(resolveRepoRoot(path.join(repoRoot, 'server', 'src'))).toBe(repoRoot);
    expect(resolveRepoRoot(path.join(repoRoot, 'client', 'src', 'lib'))).toBe(repoRoot);
    expect(resolveRepoRoot(repoRoot)).toBe(repoRoot);
  });

  it('throws when no package.json with the project name exists above the start directory', () => {
    // `/` is its own parent, so the upward walk terminates there.
    expect(() => resolveRepoRoot('/')).toThrow(/Could not locate the spiraldb-ui project root/);
  });
});

/**
 * Decision D44: the tier-1 UI harness boots the real server against its own
 * throwaway database. The point is the D17 guarantee — a spec that writes must not
 * be able to reach the developer's database, and through its `spiraldb_path` the
 * owner's real SpiralDB fork.
 */
describe('database-file resolution (decision D44)', () => {
  it('prefers SPIRALDB_UI_DB and falls back to the default file', () => {
    expect(resolveDbFile({ [DB_FILE_ENV_VAR]: '/tmp/isolated.db' })).toBe('/tmp/isolated.db');
    // An empty value counts as unset — the same rule the settings env vars follow.
    expect(resolveDbFile({ [DB_FILE_ENV_VAR]: '' })).toBe(defaultDbFile());
    expect(resolveDbFile({})).toBe(defaultDbFile());
    expect(defaultDbFile()).toBe(path.join(resolveRepoRoot(), 'data', 'spiraldb-ui.db'));
  });

  /**
   * Found by p5-08 and fixed by p5-09: `scripts/sync-names.ts` passed only
   * `args.dbFile`, so `SPIRALDB_UI_DB` was ignored and an intended isolation ran
   * against the developer's live database. The ladder is pinned here so the hole
   * cannot reopen, and the flag/env arm `parseSyncArgs` applies comes first.
   */
  it('resolveSyncDbFile honours --db/SPIRALDB_SYNC_DB, then SPIRALDB_UI_DB, then the default', () => {
    const both = { [DB_FILE_ENV_VAR]: '/tmp/app-wide.db' };
    expect(resolveSyncDbFile({ dbFile: '/tmp/flag.db' }, both)).toBe('/tmp/flag.db');
    expect(resolveSyncDbFile({}, both)).toBe('/tmp/app-wide.db');
    expect(resolveSyncDbFile({}, {})).toBe(defaultDbFile());
    expect(resolveSyncDbFile({ dbFile: '' }, {})).toBe(defaultDbFile());
  });

  it('getDb opens the override file and seeds it for tests (clone, not the owner fork)', () => {
    const file = path.join(makeTempDir(), 'test-ui.db');
    const previous = { override: process.env[DB_FILE_ENV_VAR], nodeEnv: process.env.NODE_ENV };
    process.env[DB_FILE_ENV_VAR] = file;
    process.env.NODE_ENV = 'test';

    try {
      const db = getDb();

      expect(fs.existsSync(file)).toBe(true);
      // The two halves of the isolation: a throwaway file, seeded with the D17 clone.
      expect(readSettings(db).spiraldb_path).toBe(testSpiraldbPath());
      expect(readSettings(db).spiraldb_path).not.toBe(DEFAULT_SPIRALDB_PATH);
    } finally {
      if (previous.override === undefined) {
        delete process.env[DB_FILE_ENV_VAR];
      } else {
        process.env[DB_FILE_ENV_VAR] = previous.override;
      }
      if (previous.nodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previous.nodeEnv;
      }
    }
  });
});
