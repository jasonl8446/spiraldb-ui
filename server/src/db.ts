import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

/** Instance type of a better-sqlite3 connection. */
export type Db = Database.Database;

/** Database file name, relative to the project root (docs/spec-data-model.md L3). */
export const DB_FILE_NAME = 'spiraldb-ui.db';

/** `:memory:` — the in-memory database used by unit tests. */
export const MEMORY_DB = ':memory:';

/** The five `settings` keys (docs/spec-data-model.md L161, L164-169). */
export const SETTINGS_KEYS = [
  'aurorium_path',
  'imcodec_path',
  'user_name',
  'spiraldb_path',
  'git_branch',
] as const;

export type SettingKey = (typeof SETTINGS_KEYS)[number];

/**
 * Seed defaults (docs/spec-data-model.md L164-169).
 *
 * `imcodec_path` is the verified prebuilt binary from the environment baseline
 * (decision D3) — the sync path needs no .NET SDK. `spiraldb_path` is the owner's
 * fork (decision D17); it stays fully configurable through Settings.
 */
export const DEFAULT_AURORIUM_PATH = '/home/jason/Documents/git-projects/Aurorium';
export const DEFAULT_IMCODEC_PATH =
  '/home/jason/Documents/git-projects/Imview/submodule/Imcodec/src/Imcodec.Cli/bin/Debug/net9.0/linux-x64/imcodec';
export const DEFAULT_SPIRALDB_PATH = '/home/jason/Documents/git-projects/spiraldb';

/** In-workspace disposable clone used whenever `NODE_ENV=test` (decision D17). */
export const TEST_SPIRALDB_RELATIVE_PATH = path.join('data', 'test-spiraldb');

/** Environment variable that overrides each seeded key. */
const ENV_VAR_BY_KEY: Record<SettingKey, string> = {
  aurorium_path: 'AURORIUM_PATH',
  imcodec_path: 'IMCODEC_PATH',
  user_name: 'USER_NAME',
  spiraldb_path: 'SPIRALDB_PATH',
  git_branch: 'GIT_BRANCH',
};

/**
 * Migration files, applied in order. They live next to this module
 * (`server/migrations/`) in dev, and are copied to `server/dist/server/migrations/`
 * by `scripts/copy-server-assets.mjs` after `tsc` — the same relative position in
 * both layouts, so `../migrations/` resolves either way.
 */
const MIGRATION_FILES = ['0001_init.sql'];

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(MODULE_DIR, '..', 'migrations');

/** Root package name used to identify the project root while walking upwards. */
const ROOT_PACKAGE_NAME = 'spiraldb-ui';

/**
 * Walks up from `startDir` until the directory holding the project's `package.json`.
 *
 * The emitted layout is `server/dist/server/src/db.js` while tsx runs
 * `server/src/db.ts`, so a fixed number of `..` segments would be wrong in one of
 * the two modes ([spec-architecture.md](./docs/spec-architecture.md) L150: the db
 * lives at `data/spiraldb-ui.db` **relative to project root**).
 */
export function resolveRepoRoot(startDir: string = MODULE_DIR): string {
  let dir = startDir;
  for (;;) {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { name?: unknown };
        if (parsed.name === ROOT_PACKAGE_NAME) {
          return dir;
        }
      } catch {
        // Unreadable/invalid manifest is not the project root — keep walking.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate the ${ROOT_PACKAGE_NAME} project root above ${startDir}`);
    }
    dir = parent;
  }
}

/** Absolute path of the default database file (`<repo root>/data/spiraldb-ui.db`). */
export function defaultDbFile(repoRoot: string = resolveRepoRoot()): string {
  return path.join(repoRoot, 'data', DB_FILE_NAME);
}

/** Absolute path of the disposable test clone referenced by the `test` default (D17). */
export function testSpiraldbPath(repoRoot: string = resolveRepoRoot()): string {
  return path.join(repoRoot, TEST_SPIRALDB_RELATIVE_PATH);
}

export interface OpenDbOptions {
  /** Database file path, or `:memory:`. Defaults to `data/spiraldb-ui.db`. */
  file?: string;
}

/**
 * Opens (creating the parent directory if missing, [spec-architecture.md]
 * L146-154) and initialises a connection.
 *
 * One synchronous single connection, no pooling ([spec-architecture.md]
 * L156-158). Schema initialisation is idempotent; seeding is deliberately left to
 * the caller (`seedSettings`) so tests can control the environment.
 */
export function openDb(options: OpenDbOptions = {}): Db {
  const file = options.file ?? defaultDbFile();
  if (file !== MEMORY_DB) {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = new Database(file);
  // The schema declares `status_history.entry_status_id REFERENCES entry_status(id)`;
  // SQLite only enforces that with foreign keys switched on.
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

/**
 * Applies every migration file. Idempotent: the DDL is `CREATE ... IF NOT EXISTS`,
 * so running it repeatedly leaves exactly the same 11 tables and 3 indexes.
 */
export function initSchema(db: Db): void {
  for (const file of MIGRATION_FILES) {
    const migrationPath = path.join(MIGRATIONS_DIR, file);
    if (!fs.existsSync(migrationPath)) {
      throw new Error(
        `Migration not found: ${migrationPath}. Run \`npm run build\` (tsc + scripts/copy-server-assets.mjs) so the .sql files are emitted next to the compiled server.`,
      );
    }
    db.exec(fs.readFileSync(migrationPath, 'utf8'));
  }
}

/** Reads every `settings` row as a plain key/value object. */
export function readSettings(db: Db): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings ORDER BY key').all() as Array<{
    key: string;
    value: string;
  }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

/**
 * Upserts a partial settings patch as one transaction: existing rows are
 * UPDATEd, missing ones INSERTed, and a key the patch omits is left alone.
 *
 * The single writer for the `settings` table (task 2.4's save pipeline persists
 * `git_branch` through it; `PUT /api/settings` uses it too). Keys are not
 * validated here — `PUT /api/settings` validates its body before calling, and
 * internal callers pass a `SettingKey` they own.
 *
 * Returns the settings as they are after the write, so a caller never re-reads.
 */
export function writeSettings(db: Db, patch: Record<string, string>): Record<string, string> {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  const upsertAll = db.transaction((entries: Array<[string, string]>) => {
    for (const [key, value] of entries) {
      upsert.run(key, value);
    }
  });
  upsertAll(Object.entries(patch));
  return readSettings(db);
}

/** One-key convenience over `writeSettings` (used by the save pipeline). */
export function writeSetting(db: Db, key: SettingKey, value: string): Record<string, string> {
  return writeSettings(db, { [key]: value });
}

export interface SeedSettingsOptions {
  /**
   * Environment to read overrides from. Injectable so the precedence rules are
   * unit-testable without mutating `process.env`.
   */
  env?: Record<string, string | undefined>;
  /** Timestamp used for the `git_branch` default; injectable for tests. */
  now?: Date;
  /** Project root used to build the `NODE_ENV=test` clone path. */
  repoRoot?: string;
}

/**
 * Resolves the five seed values without touching a database.
 *
 * Precedence per key: explicit env var (`SPIRALDB_PATH`, `AURORIUM_PATH`,
 * `IMCODEC_PATH`, `USER_NAME`, `GIT_BRANCH`; an empty value counts as "not set")
 * > `NODE_ENV=test` test clone for `spiraldb_path` (decision D17: automated tests
 * never point at the owner's fork) > the spec default.
 */
export function buildSeedSettings(options: SeedSettingsOptions = {}): Record<SettingKey, string> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const repoRoot = options.repoRoot ?? resolveRepoRoot();

  const values: Record<SettingKey, string> = {
    aurorium_path: DEFAULT_AURORIUM_PATH,
    imcodec_path: DEFAULT_IMCODEC_PATH,
    user_name: '',
    spiraldb_path: env.NODE_ENV === 'test' ? testSpiraldbPath(repoRoot) : DEFAULT_SPIRALDB_PATH,
    git_branch: `content/${formatLocalDate(now)}`,
  };

  for (const key of SETTINGS_KEYS) {
    const override = env[ENV_VAR_BY_KEY[key]];
    if (override !== undefined && override !== '') {
      values[key] = override;
    }
  }

  return values;
}

/** `YYYY-MM-DD` in local time — `git_branch` is `content/{YYYY-MM-DD}`. */
export function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface SeedSettingsResult {
  /** `true` when this call wrote the defaults, `false` when settings already existed. */
  seeded: boolean;
  /** The settings as they are in the database after the call. */
  settings: Record<string, string>;
}

/**
 * Seeds the `settings` defaults on first run only.
 *
 * Runs exactly once per database: an existing `settings` table (even a partially
 * populated one, e.g. after the owner edited a path) is never overwritten.
 */
export function seedSettings(db: Db, options: SeedSettingsOptions = {}): SeedSettingsResult {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM settings').get() as {
    count: number;
  };
  if (existing.count > 0) {
    return { seeded: false, settings: readSettings(db) };
  }

  const values = buildSeedSettings(options);
  const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  const insertAll = db.transaction((entries: Array<[string, string]>) => {
    for (const [key, value] of entries) {
      insert.run(key, value);
    }
  });
  insertAll(SETTINGS_KEYS.map((key): [string, string] => [key, values[key]]));

  return { seeded: true, settings: readSettings(db) };
}

/**
 * Env override for the application's database file (decision D44). Only the app's
 * own connection honours it — `openDb()` callers keep passing a path explicitly.
 */
export const DB_FILE_ENV_VAR = 'SPIRALDB_UI_DB';

/**
 * The database file the app opens: `SPIRALDB_UI_DB` when set (an empty value counts
 * as unset, the same rule the settings env vars follow), else `data/spiraldb-ui.db`.
 * Pure so the tier-1 harness's isolation is testable without opening either file.
 */
export function resolveDbFile(
  env: NodeJS.ProcessEnv = process.env,
  repoRoot: string = resolveRepoRoot(),
): string {
  return env[DB_FILE_ENV_VAR] || defaultDbFile(repoRoot);
}

/** Process-wide connection (synchronous, single-user tool — no pooling). */
let connection: Db | undefined;

/**
 * The application's single connection to `data/spiraldb-ui.db`, initialised and
 * seeded on first use. Created lazily so importing a router never touches disk.
 *
 * `SPIRALDB_UI_DB` points it at another file: the tier-1 UI harness boots this real
 * server against a throwaway database seeded for tests (decision D44), so a spec can
 * never write to the developer's database and, through its `spiraldb_path`, to the
 * owner's real SpiralDB fork (decision D17).
 */
export function getDb(): Db {
  if (!connection) {
    const db = openDb({ file: resolveDbFile() });
    seedSettings(db);
    connection = db;
  }
  return connection;
}

/** Closes the shared connection, if open. */
export function closeDb(): void {
  if (connection) {
    connection.close();
    connection = undefined;
  }
}

/** Test escape hatch: closes the shared connection so the next `getDb()` reopens it. */
export function resetDbForTests(): void {
  closeDb();
}
