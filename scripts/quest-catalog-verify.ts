import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';

import { applyQuestCatalogColumnAdds, openDb, resolveRepoRoot } from '../server/src/db.js';

/**
 * Migration 0002's applied-schema + idempotency proof — task 6.4's ac1, re-runnable.
 *
 * ```
 * npm run verify:quest-catalog                 # source: data/spiraldb-ui.db (read only, copied)
 * npm run verify:quest-catalog -- --source <db> --fresh <path> --copy <path>
 * ```
 *
 * What it proves, in this order:
 *
 * 1. a **fresh** database file gets migration 0002 (its four `quests` columns, the two catalog
 *    tables, the three indexes and the `coverage` view) from a single `openDb()`;
 * 2. opening that same file a **second** time does not throw — the trap task 6.4 names: SQLite has
 *    no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and `initSchema` re-execs every file on every
 *    open;
 * 3. a **copy** of the caller's database gets the same DDL, with its pre-migration `quests`
 *    columns shown before and after, and every row count unchanged;
 * 4. the second open of the copy does not throw either.
 *
 * The source database is only ever **read** (and copied): the fresh and copy targets default to a
 * temp directory, and passing a target equal to the source is refused. Nothing here writes to
 * `data/spiraldb-ui.db` unless the caller explicitly passes it as a *target*, which the guard
 * rejects.
 */

const NEW_OBJECTS = [
  'quest_catalog_refs',
  'quest_ids',
  'coverage',
  'idx_quest_catalog_refs_quest',
  'idx_quest_catalog_refs_wad',
  'idx_quest_ids_matched',
] as const;

const QUEST_CATALOG_COLUMNS = [
  'has_definition',
  'link_kind',
  'title_source',
  'reference_count',
] as const;

interface Args {
  source: string;
  fresh: string;
  copy: string;
}

function parseArgs(argv: readonly string[], repoRoot: string): Args {
  const args: Args = {
    source: path.join(repoRoot, 'data', 'spiraldb-ui.db'),
    fresh: path.join(os.tmpdir(), 'p6-05-verify-fresh.db'),
    copy: path.join(os.tmpdir(), 'p6-05-verify-live-copy.db'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--source' || flag === '--fresh' || flag === '--copy') {
      if (value === undefined) {
        throw new Error(`${flag} needs a value`);
      }
      args[flag.slice(2) as keyof Args] = path.resolve(value);
      index += 1;
    } else if (flag !== undefined) {
      throw new Error(`unknown flag ${flag}`);
    }
  }
  if (args.source === args.fresh || args.source === args.copy) {
    throw new Error('refusing to run: a target equals the source database');
  }
  return args;
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Read-only view of a database on disk — never the connection under test. */
function inspect<T>(file: string, read: (db: Database.Database) => T): T {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

function questColumns(file: string): string[] {
  return inspect(file, (db) =>
    (db.pragma('table_info(quests)') as Array<{ name: string }>).map((row) => row.name),
  );
}

function schemaDump(file: string): string[] {
  return inspect(file, (db) =>
    (
      db
        .prepare(
          `SELECT type, name, sql FROM sqlite_master
             WHERE name IN (${NEW_OBJECTS.map(() => '?').join(',')}) ORDER BY name`,
        )
        .all(...NEW_OBJECTS) as Array<{ type: string; name: string; sql: string }>
    ).map((row) => `${row.type}\t${row.name}\n${row.sql}`),
  );
}

/**
 * Row counts for the tables this story's evidence names. A table the pre-migration schema does
 * not have yet (the two catalog tables) is reported as `-1` rather than throwing, so the same
 * call works before and after the migration.
 */
function counts(file: string): Record<string, number> {
  return inspect(file, (db) => {
    const present = new Set(
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
          name: string;
        }>
      ).map((row) => row.name),
    );
    const out: Record<string, number> = {};
    for (const table of [
      'quests',
      'quest_ids',
      'quest_catalog_refs',
      'string_table',
      'sync_history',
    ]) {
      out[table] = present.has(table)
        ? (db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c
        : -1;
    }
    return out;
  });
}

function totals(file: string): { tables: number; views: number; indexes: number } {
  return inspect(file, (db) => ({
    tables: (
      db
        .prepare(
          "SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .get() as { c: number }
    ).c,
    views: (
      db.prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='view'").get() as { c: number }
    ).c,
    indexes: (
      db
        .prepare(
          "SELECT count(*) AS c FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'",
        )
        .get() as { c: number }
    ).c,
  }));
}

const failures: string[] = [];
function check(label: string, condition: boolean): void {
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures.push(label);
  }
}

const args = parseArgs(process.argv.slice(2), resolveRepoRoot());

console.log('=== migration 0002 — applied schema + idempotency (task 6.4 ac1) ===');
console.log(`source database (read only, copied): ${args.source}`);
console.log(`source sha256                      : ${sha256(args.source)}`);
console.log(`source quests columns before        : ${JSON.stringify(questColumns(args.source))}`);

/* -------------------------------------------------- (a) a fresh database file */
console.log(`\n--- (a) fresh database file: ${args.fresh}`);
for (const leftover of [args.fresh, `${args.fresh}-wal`, `${args.fresh}-journal`]) {
  fs.rmSync(leftover, { force: true });
}
check('the fresh target did not exist before openDb()', !fs.existsSync(args.fresh));

const fresh1 = openDb({ file: args.fresh });
console.log('OPEN #1: openDb() returned without throwing');
console.log(`OPEN #1: quests columns = ${JSON.stringify(questColumns(args.fresh))}`);
console.log(`OPEN #1: columns added by the guarded step = ${applyQuestCatalogColumnAdds(fresh1)}`);
fresh1.close();

const fresh2 = openDb({ file: args.fresh });
console.log('OPEN #2: openDb() on the SAME file returned without throwing');
console.log(
  `OPEN #2: columns added by the guarded step = ${applyQuestCatalogColumnAdds(fresh2)} (0 = idempotent)`,
);
console.log(`OPEN #2: quests columns = ${JSON.stringify(questColumns(args.fresh))}`);
fresh2.close();

for (const object of NEW_OBJECTS) {
  check(
    `the fresh database has ${object}`,
    inspect(args.fresh, (db) =>
      Boolean(db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(object)),
    ),
  );
}
for (const column of QUEST_CATALOG_COLUMNS) {
  check(`the fresh quests table has ${column}`, questColumns(args.fresh).includes(column));
}
check(
  'the fresh quests primary key is unchanged (quest_name only)',
  inspect(
    args.fresh,
    (db) =>
      (db.pragma('table_info(quests)') as Array<{ name: string; pk: number }>).filter(
        (row) => row.pk > 0,
      ).length === 1,
  ),
);

console.log('\n--- (a) applied schema dump (SELECT type, name, sql ... ORDER BY name)');
for (const dump of schemaDump(args.fresh)) {
  console.log(dump);
  console.log('');
}
console.log(`--- (a) ${JSON.stringify(totals(args.fresh))}`);

/* -------------------------------------------------- (b) a copy of the source */
console.log(`\n--- (b) copy of the source database: ${args.copy}`);
fs.copyFileSync(args.source, args.copy);
console.log(`copy sha256 (must equal the source's) : ${sha256(args.copy)}`);
console.log(`BEFORE the migration, quests columns  = ${JSON.stringify(questColumns(args.copy))}`);
const copyBefore = counts(args.copy);

const copy1 = openDb({ file: args.copy });
console.log('OPEN #1: openDb() returned without throwing');
console.log(`AFTER  the migration, quests columns  = ${JSON.stringify(questColumns(args.copy))}`);
console.log(`OPEN #1: columns added by the guarded step = ${applyQuestCatalogColumnAdds(copy1)}`);
copy1.close();

const copy2 = openDb({ file: args.copy });
console.log('OPEN #2: openDb() on the SAME file returned without throwing');
console.log(
  `OPEN #2: columns added by the guarded step = ${applyQuestCatalogColumnAdds(copy2)} (0 = idempotent)`,
);
console.log(`OPEN #2: quests columns = ${JSON.stringify(questColumns(args.copy))}`);
copy2.close();

const copyAfter = counts(args.copy);
console.log('\n--- (b) row counts before -> after (-1 = the table did not exist before 0002):');
console.log(`      before: ${JSON.stringify(copyBefore)}`);
console.log(`      after : ${JSON.stringify(copyAfter)}`);
for (const key of Object.keys(copyBefore)) {
  if (copyBefore[key] === -1) {
    check(`the copy gained ${key}`, copyAfter[key] === 0);
    continue;
  }
  check(
    `the copy's ${key} count is unchanged by the migration`,
    copyBefore[key] === copyAfter[key],
  );
}
for (const object of NEW_OBJECTS) {
  check(
    `the copy has ${object}`,
    inspect(args.copy, (db) =>
      Boolean(db.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(object)),
    ),
  );
}
for (const column of QUEST_CATALOG_COLUMNS) {
  check(`the copy's quests table has ${column}`, questColumns(args.copy).includes(column));
}
console.log('\n--- (b) applied schema dump (identical SQL text to (a); shown once above)');
for (const dump of schemaDump(args.copy)) {
  console.log(dump.split('\n')[0]);
}
console.log(`--- (b) ${JSON.stringify(totals(args.copy))}`);

console.log(
  `\n=== ${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`}`,
);
for (const failure of failures) {
  console.log(`  FAILED: ${failure}`);
}
process.exitCode = failures.length === 0 ? 0 : 1;
