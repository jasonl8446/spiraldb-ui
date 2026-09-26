import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_AURORIUM_PATH,
  DEFAULT_IMCODEC_PATH,
  DEFAULT_SPIRALDB_PATH,
  MEMORY_DB,
  buildSeedSettings,
  closeDb,
  formatLocalDate,
  initSchema,
  openDb,
  readSettings,
  resolveRepoRoot,
  seedSettings,
  testSpiraldbPath,
  type Db,
} from '@server/db';

/**
 * Task 1.2 acceptance: the migration matches docs/spec-data-model.md L21-162
 * column-for-column (11 tables, 3 named indexes, the entry_status UNIQUE
 * constraint), the `settings` seed matches L164-169 with the env/NODE_ENV
 * precedence from the lead's decisions, and both steps are idempotent.
 *
 * Every test uses `:memory:` or a throwaway file under `data/` (gitignored) —
 * never the real `data/spiraldb-ui.db` (decision D17).
 */

/** Independently re-typed from the spec — deliberately not imported from db.ts. */
const EXPECTED_TABLES = [
  'drop_tables',
  'entry_status',
  'items',
  'npcs',
  'quests',
  'settings',
  'spells',
  'status_history',
  'string_table',
  'sync_history',
  'zones',
];

const EXPECTED_INDEXES = [
  'idx_entry_status_key',
  'idx_entry_status_status',
  'idx_entry_status_type',
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
  it('creates exactly the 11 tables from the spec, on a fresh in-memory database', () => {
    const db = open();

    expect(listTables(db)).toHaveLength(11);
    expect(listTables(db)).toEqual(EXPECTED_TABLES);
  });

  it('creates the 3 named entry_status indexes from the spec', () => {
    const db = open();

    expect(listIndexes(db)).toHaveLength(3);
    expect(listIndexes(db)).toEqual(EXPECTED_INDEXES);
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
  it('re-running initSchema keeps 11 tables, 3 indexes and the seeded rows', () => {
    const db = open();
    seedSettings(db, { env: {}, now: FIXED_NOW, repoRoot: '/repo' });

    expect(() => initSchema(db)).not.toThrow();
    expect(() => initSchema(db)).not.toThrow();

    expect(listTables(db)).toHaveLength(11);
    expect(listTables(db)).toEqual(EXPECTED_TABLES);
    expect(listIndexes(db)).toHaveLength(3);
    expect(listIndexes(db)).toEqual(EXPECTED_INDEXES);
    expect(readSettings(db)).toEqual({
      aurorium_path: DEFAULT_AURORIUM_PATH,
      imcodec_path: DEFAULT_IMCODEC_PATH,
      user_name: '',
      spiraldb_path: DEFAULT_SPIRALDB_PATH,
      git_branch: 'content/2026-09-26',
    });
  });

  it('re-opening an existing file database is idempotent', () => {
    const file = path.join(makeTempDir(), 'restart.db');

    const first = open(file);
    seedSettings(first, { env: {}, now: FIXED_NOW, repoRoot: '/repo' });
    first.close();
    openConnections.pop();

    const second = open(file);
    seedSettings(second, { env: { USER_NAME: 'ignored' }, now: FIXED_NOW, repoRoot: '/repo' });

    expect(listTables(second)).toEqual(EXPECTED_TABLES);
    expect(listIndexes(second)).toEqual(EXPECTED_INDEXES);
    expect(readSettings(second).user_name).toBe('');
  });
});

describe('repo root resolution', () => {
  it('finds the project root and the default/test-spiraldb paths under it', () => {
    const repoRoot = resolveRepoRoot();

    expect(fs.existsSync(path.join(repoRoot, 'package.json'))).toBe(true);
    expect(path.basename(repoRoot)).toBe('spiraldb-ui');
    expect(testSpiraldbPath(repoRoot)).toBe(path.join(repoRoot, 'data', 'test-spiraldb'));
  });
});
