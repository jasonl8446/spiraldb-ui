import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import json5 from 'json5';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { objectTypeConfig } from '@shared/objectTypes';
import { applyEdits, type DocPath } from '@shared/document';
import {
  addToList,
  containsId,
  moveInList,
  NPC_DROP_TABLE_CORPUS,
  NPC_DROP_TABLE_FIELDS,
  NPC_DROP_TABLE_KEY_FIELD,
  NPC_DROP_TABLE_LIST_KEY,
  numberIdFromRaw,
  readStringList,
  removeAtIndex,
  replaceListEdit,
  textIdFromRaw,
} from '@shared/simpleObjects';
import { DEFAULT_SPIRALDB_PATH, MEMORY_DB, openDb, writeSettings, type Db } from '@server/db';
import {
  createPathFor,
  listObjects,
  objectRuntimeFor,
  saveObjectEntry,
  type ObjectRuntime,
} from '@server/services/objects';
import { readSpiraldbJson } from '@server/services/spiraldbFiles';
import { getStatusEntry } from '@server/services/status';
import {
  commitSubjects,
  createTempGitRepo,
  removeTempGitRepo,
  repoFileExists,
  writeRepoFile,
  type TempRepo,
} from '../helpers/temp-git-repo';

/**
 * Story p4-06's model + save-path test — plan task 4.6, `NpcDropTable`
 * (docs/spec-domain-reference.md L166-181) and the two facts the story turns on:
 *
 * 1. **`NpcDropTable/` does not exist** in the fork, so this family has no corpus files and its
 *    editor is schema-driven. The live arm below re-measures the absence (and, when the synced
 *    database is on disk, the 317↔317 bijection between the `drop_tables` table and the
 *    `DropTables` corpus) rather than asserting a count about a directory nobody wrote.
 * 2. **The first save creates the directory and the convention file inside it** (AC1/P4 AC#8).
 *    That is proven twice, on purpose: in-process here against a throwaway `git init` repository
 *    (D17 — the fork is never written by a test), and live against the D17 clone in the story's
 *    evidence run.
 *
 * The other two arms are the shared vocabulary this family added or generalised: the string list
 * primitives (duplicates preserved, removal index-addressed) and the text control boundary
 * (`textIdFromRaw` verbatim, blank refused). Every numeric primitive is re-checked unchanged.
 *
 * **D68**: nothing eager runs at collection time. The guards are `existsSync` booleans; the
 * corpus and the database are read inside the tests that need them, and the skip is provable by
 * pointing `SPIRALDB_SIMPLE_OBJECTS_ROOT` at a path with no `DropTables/` directory.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CORPUS_ROOT = process.env.SPIRALDB_SIMPLE_OBJECTS_ROOT ?? DEFAULT_SPIRALDB_PATH;
const DB_PATH = path.join(ROOT, 'data', 'spiraldb-ui.db');

/** The one fixture document used by every save-path arm: two real DropTable names. */
const SAMPLE_NAMES = ['WC-UNICORN-MAIN-007', 'WC-UNICORN-BONUS-001'];

const OPEN_DBS: Db[] = [];
const REPOS: TempRepo[] = [];

// D68: booleans only — no readdir/readFile/DB handle at module scope.
const FORK_PRESENT = fs.existsSync(CORPUS_ROOT);
const DROP_TABLES_CORPUS_PRESENT = fs.existsSync(path.join(CORPUS_ROOT, 'DropTables'));
const DB_PRESENT = fs.existsSync(DB_PATH);

if (!DROP_TABLES_CORPUS_PRESENT) {
  console.log(
    `[p4-06 corpus] live sweeps skipped — no DropTables/ under ${CORPUS_ROOT} (CI has no sibling ` +
      'SpiralDB checkout, D40). The fixtures below carry every primitive.',
  );
}
if (!DB_PRESENT) {
  console.log(
    `[p4-06 corpus] resolution sweeps skipped — no ${DB_PATH}. The name source is still pinned by ` +
      'the fixtures.',
  );
}

afterEach(() => {
  while (REPOS.length > 0) {
    const repo = REPOS.pop();
    if (repo !== undefined) {
      removeTempGitRepo(repo);
    }
  }
});

afterAll(() => {
  for (const db of OPEN_DBS) {
    db.close();
  }
  while (REPOS.length > 0) {
    const repo = REPOS.pop();
    if (repo !== undefined) {
      removeTempGitRepo(repo);
    }
  }
});

/* ---------------------------------------------------------------- the save harness */

const USER = 'P4-06 Tester';

interface Harness {
  repo: TempRepo;
  root: string;
  db: Db;
  runtime: ObjectRuntime;
}

/**
 * A throwaway repository holding **no** `NpcDropTable/` directory — the fork's measured state —
 * so every arm below starts from the absent-directory reality AC1 is about.
 */
function harness(): Harness {
  const repo = createTempGitRepo('npc-drop-table-');
  REPOS.push(repo);
  // A sibling file, so "the directory is created" cannot be satisfied by the repo root.
  writeRepoFile(
    repo,
    'DropTables/droptables_wc-unicorn-main-007.json',
    '{"Name":"WC-UNICORN-MAIN-007"}',
  );
  repo.git(['add', '--all']);
  repo.git(['commit', '-m', 'measured legacy shapes']);

  const db = openDb({ file: MEMORY_DB });
  OPEN_DBS.push(db);
  writeSettings(db, { spiraldb_path: repo.dir, user_name: USER, git_branch: '' });

  const runtime = objectRuntimeFor(db, repo.dir);
  runtime.index.rebuild();
  return { repo, root: repo.dir, db, runtime };
}

const NPC_DROP_TABLE = objectTypeConfig('npcdroptable');

/** The files of the family's directory, sorted (empty when it does not exist). */
function familyFiles(root: string): string[] {
  const dir = path.join(root, NPC_DROP_TABLE.directory);
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

/** Saves one document and returns the result. */
function save(h: Harness, object: Record<string, unknown>): ReturnType<typeof saveObjectEntry> {
  return saveObjectEntry({
    db: h.db,
    config: NPC_DROP_TABLE,
    index: h.runtime.index,
    pipeline: h.runtime.pipeline,
    body: { object },
  });
}

/* ---------------------------------------------------------- the string-list vocabulary */

describe('readStringList and the string list primitives (the text half of the vocabulary)', () => {
  it('reads a list in document order and [] for every "no list here" shape', () => {
    expect(readStringList({ DropTableNames: ['A', 'B', 'C'] }, 'DropTableNames')).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(readStringList({ DropTableNames: [] }, 'DropTableNames')).toEqual([]);
    expect(readStringList({}, 'DropTableNames')).toEqual([]);
    expect(readStringList({ DropTableNames: null }, 'DropTableNames')).toEqual([]);
    expect(readStringList({ DropTableNames: 'A,B' }, 'DropTableNames')).toEqual([]);
    expect(readStringList({ DropTableNames: { 0: 'A' } }, 'DropTableNames')).toEqual([]);
  });

  it('drops a non-string value and keeps the rest in order (the measured-impossible case)', () => {
    expect(
      readStringList(
        { DropTableNames: ['A', 7, null, 'B', ['C'], { name: 'D' }, 'E'] },
        'DropTableNames',
      ),
    ).toEqual(['A', 'B', 'E']);
  });

  it('keeps an empty string: it is a string, and dropping it would delete a real value', () => {
    // An empty name is not a name — but the reader is not a normaliser (D57). The chip renders
    // the value, the user removes it, and the array edit replaces the list whole.
    expect(readStringList({ DropTableNames: ['A', '', 'B'] }, 'DropTableNames')).toEqual([
      'A',
      '',
      'B',
    ]);
  });

  it('adds a name, and does nothing when it is already there — with a fresh array either way', () => {
    const values = ['A', 'B'];
    const added = addToList(values, 'C');
    expect(added).toEqual(['A', 'B', 'C']);
    expect(added).not.toBe(values);

    const refused = addToList(values, 'A');
    expect(refused).toEqual(['A', 'B']);
    expect(refused).not.toBe(values);

    expect(containsId(values, 'A')).toBe(true);
    expect(containsId(values, 'Z')).toBe(false);
    // The rendered list is never touched by a refused add.
    expect(values).toEqual(['A', 'B']);
  });

  it('removes exactly the clicked index, so a duplicate name survives', () => {
    const values = ['A', 'B', 'A'];
    expect(removeAtIndex(values, 2)).toEqual(['A', 'B']);
    // The *first* A is a different chip from the third and must survive both removals.
    expect(removeAtIndex(removeAtIndex(values, 2), 0)).toEqual(['B']);
    expect(values).toEqual(['A', 'B', 'A']);

    // An index that cannot be expressed is a no-op, never a throw.
    expect(removeAtIndex(values, 3)).toEqual(values);
    expect(removeAtIndex(values, -1)).toEqual(values);
    expect(removeAtIndex(values, 1.5)).toEqual(values);
  });

  it('moves an element to a destination index and no-ops on an impossible move', () => {
    expect(moveInList(['A', 'B', 'C'], 2, 0)).toEqual(['C', 'A', 'B']);
    expect(moveInList(['A', 'B', 'C'], 0, 0)).toEqual(['A', 'B', 'C']);
    expect(moveInList(['A', 'B', 'C'], 3, 0)).toEqual(['A', 'B', 'C']);
    // A name list is ordered data like a deck, so the C→A move is expressible and reversible.
    expect(moveInList(moveInList(['A', 'B', 'C'], 2, 0), 0, 2)).toEqual(['A', 'B', 'C']);
  });

  it('replaces the array whole, never aliasing the rendered list', () => {
    const path: DocPath = [NPC_DROP_TABLE_LIST_KEY];
    const rendered = ['A', 'B'];
    const edit = replaceListEdit(path, rendered);
    rendered.push('C');
    expect(edit).toEqual({ op: 'set', path, value: ['A', 'B'] });

    const doc = { TemplateID: 1, DropTableNames: ['X'] };
    const next = applyEdits(doc, [replaceListEdit(path, ['A', 'B'])]) as Record<string, unknown>;
    expect(next.DropTableNames).toEqual(['A', 'B']);
    // The untouched document is not aliased into the edit either.
    expect(doc.DropTableNames).toEqual(['X']);
  });

  it('leaves every numeric primitive unchanged (the generalisation is not a fork)', () => {
    expect(addToList([1, 2], 3)).toEqual([1, 2, 3]);
    expect(addToList([1, 2], 2)).toEqual([1, 2]);
    expect(removeAtIndex([1, 2, 1], 2)).toEqual([1, 2]);
    expect(moveInList([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(containsId([1, 2], 2)).toBe(true);
  });
});

describe('textIdFromRaw — the text control boundary', () => {
  it('hands back a real name verbatim', () => {
    expect(textIdFromRaw('WC-UNICORN-MAIN-007')).toBe('WC-UNICORN-MAIN-007');
    expect(textIdFromRaw('DS-ACAD-C01-001')).toBe('DS-ACAD-C01-001');
    // The spec's own unreachable example is still a storable value.
    expect(textIdFromRaw('WC-UNICORN-BONUS-001')).toBe('WC-UNICORN-BONUS-001');
  });

  it('never normalises: padding and case are the user\u2019s, not the editor\u2019s', () => {
    expect(textIdFromRaw(' WC-A ')).toBe(' WC-A ');
    expect(textIdFromRaw('wc-a')).toBe('wc-a');
  });

  it('refuses a blank string and every non-string — no edit, no invented value', () => {
    expect(textIdFromRaw('')).toBeUndefined();
    expect(textIdFromRaw('   ')).toBeUndefined();
    expect(textIdFromRaw('\t\n')).toBeUndefined();
    expect(textIdFromRaw(42)).toBeUndefined();
    expect(textIdFromRaw(null)).toBeUndefined();
    expect(textIdFromRaw(undefined)).toBeUndefined();
    expect(textIdFromRaw(['A'])).toBeUndefined();
    expect(textIdFromRaw({ name: 'A' })).toBeUndefined();
  });

  it('leaves the numeric conversion alone (one helper per kind, neither changed)', () => {
    expect(numberIdFromRaw('01001')).toBe(1001);
    expect(numberIdFromRaw('')).toBeUndefined();
    expect(numberIdFromRaw('WC-A')).toBeUndefined();
    expect(numberIdFromRaw('-1')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ the field inventory */

describe('the field inventory agrees with the schema and the corpus reality', () => {
  it('names exactly the schema\u2019s two keys, in the schema\u2019s order', () => {
    expect(NPC_DROP_TABLE_FIELDS.map((field) => field.key)).toEqual([
      ...NPC_DROP_TABLE_CORPUS.topLevelKeys,
    ]);
    expect(NPC_DROP_TABLE_CORPUS.topLevelKeys).toEqual(['TemplateID', 'DropTableNames']);
    expect(NPC_DROP_TABLE_KEY_FIELD).toBe('TemplateID');
    expect(NPC_DROP_TABLE_LIST_KEY).toBe('DropTableNames');
  });

  it('is the client form and the server route\u2019s own row: ulong key, no audit, NpcDropTable/', () => {
    expect(NPC_DROP_TABLE.fileType).toBe('npcdroptable');
    expect(NPC_DROP_TABLE.urlPath).toBe('/api/npc-drop-tables');
    expect(NPC_DROP_TABLE.directory).toBe('NpcDropTable');
    expect(NPC_DROP_TABLE.keyField).toBe(NPC_DROP_TABLE_KEY_FIELD);
    expect(NPC_DROP_TABLE.keyType).toBe('ulong');
    expect(NPC_DROP_TABLE.objectType).toBe('npc_drop_table');
    expect(NPC_DROP_TABLE.routeType).toBe('npc_drop_tables');
    // D69(b): this family carries no audit quartet, so the form renders exactly two controls.
    expect(NPC_DROP_TABLE.audit).toBe('none');
  });

  it('marks both fields required and declares the two names tables the AC needs', () => {
    for (const field of NPC_DROP_TABLE_FIELDS) {
      expect(field.required).toBe(true);
      // The family has no corpus, so every presence count is 0 — stated, not omitted.
      expect(field.corpusPresence).toBe(0);
    }
    expect(NPC_DROP_TABLE_FIELDS.map((field) => field.kind)).toEqual([
      'npc-select',
      'drop-table-multi-select',
    ]);
    expect(NPC_DROP_TABLE_FIELDS.map((field) => field.namesType)).toEqual(['npcs', 'drop_tables']);
    // No other kind appears: this family is one select and one text-keyed multi-select.
    expect(NPC_DROP_TABLE_FIELDS).toHaveLength(2);
  });

  it('records the absence as data rather than pretending to a file count', () => {
    expect(NPC_DROP_TABLE_CORPUS.files).toBe(0);
    expect(NPC_DROP_TABLE_CORPUS.statusRows).toBe(0);
    expect(NPC_DROP_TABLE_CORPUS.dropTableNames).toBe(317);
    expect(NPC_DROP_TABLE_CORPUS.distinctDropTableNames).toBe(317);
  });
});

/* -------------------------------------------------------------------- the live corpus dump */

describe.runIf(FORK_PRESENT)(
  'the live fork, re-measured (AC1\u2019s absent-directory clause)',
  () => {
    it('has no NpcDropTable/ directory and no npc_drop_table status rows', () => {
      // The whole story rests on this: a family with no corpus files. A later round that creates
      // the directory must update NPC_DROP_TABLE_CORPUS instead of quietly invalidating it.
      expect(fs.existsSync(path.join(CORPUS_ROOT, 'NpcDropTable'))).toBe(false);
    });

    it.runIf(DB_PRESENT)(
      'sources its names from drop_tables, whose 317 names are exactly the DropTables corpus',
      () => {
        const db = new Database(DB_PATH, { readonly: true });
        try {
          const rows = db
            .prepare('SELECT name FROM drop_tables')
            .all()
            .map((row) => (row as { name: string }).name);
          expect(rows).toHaveLength(NPC_DROP_TABLE_CORPUS.dropTableNames);
          expect(new Set(rows).size).toBe(NPC_DROP_TABLE_CORPUS.distinctDropTableNames);
          expect(rows.filter((name) => name === null || name.trim() === '')).toHaveLength(
            NPC_DROP_TABLE_CORPUS.blankDropTableNames,
          );

          const dir = path.join(CORPUS_ROOT, 'DropTables');
          const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
          expect(files).toHaveLength(NPC_DROP_TABLE_CORPUS.dropTableFiles);

          const corpusNames = files
            .map(
              (file) =>
                json5.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Record<
                  string,
                  unknown
                >,
            )
            .map((doc) => doc.Name)
            .filter((name): name is string => typeof name === 'string');
          expect(new Set(corpusNames).size).toBe(NPC_DROP_TABLE_CORPUS.distinctDropTableKeys);

          // The bijection the editor's searchable multi-select rests on: nothing in the corpus is
          // missing from the table, and the table invents nothing.
          const table = new Set(rows);
          const corpus = new Set(corpusNames);
          expect(corpusNames.filter((name) => !table.has(name))).toHaveLength(
            NPC_DROP_TABLE_CORPUS.namesMissingFromTable,
          );
          expect(rows.filter((name) => !corpus.has(name))).toHaveLength(
            NPC_DROP_TABLE_CORPUS.tableNamesMissingFromCorpus,
          );

          // The spec's own second example is *not* in either: an unreachable-but-storable name.
          expect(rows.filter((name) => name.includes('BONUS'))).toHaveLength(
            NPC_DROP_TABLE_CORPUS.namesContainingBonus,
          );
          expect(corpusNames).not.toContain('WC-UNICORN-BONUS-001');

          const lengths = rows.map((name) => name.length);
          expect(Math.min(...lengths)).toBe(NPC_DROP_TABLE_CORPUS.shortestNameLength);
          expect(Math.max(...lengths)).toBe(NPC_DROP_TABLE_CORPUS.longestNameLength);
        } finally {
          db.close();
        }
      },
    );
  },
);

/* ------------------------------------------------- the save path: bootstrap, payload, D19 */

describe('POST /api/npc-drop-tables: the create that bootstraps the directory', () => {
  it('lists an absent directory as an empty list instead of failing', async () => {
    const h = harness();
    expect(fs.existsSync(path.join(h.root, 'NpcDropTable'))).toBe(false);

    const before = listObjects({ db: h.db, config: NPC_DROP_TABLE, spiraldbPath: h.root });
    expect(before.objects).toEqual([]);
    expect(before.missing_directory).toBe(true);
    expect(before.summary).toEqual({ total: 0, extracted: 0, reviewed: 0, verified: 0 });
    expect(before.skipped).toEqual([]);

    // After the create the same call reads one row, and the notice goes away.
    await save(h, { TemplateID: 4242, DropTableNames: SAMPLE_NAMES });

    const after = listObjects({ db: h.db, config: NPC_DROP_TABLE, spiraldbPath: h.root });
    expect(after.missing_directory).toBe(false);
    expect(after.objects.map((row) => row.key)).toEqual(['4242']);
    expect(after.objects[0].title).toBe('4242');
  });

  it('creates NpcDropTable/npcdroptable_<TemplateID>.json with exactly the schema\u2019s two keys', async () => {
    const h = harness();
    const before = familyFiles(h.root);
    expect(before).toEqual([]);
    expect(createPathFor(h.root, NPC_DROP_TABLE, '4242')).toBe(
      path.join(h.root, 'NpcDropTable/npcdroptable_4242.json'),
    );

    const result = await save(h, { TemplateID: 4242, DropTableNames: SAMPLE_NAMES });

    expect(result).toMatchObject({
      key: '4242',
      file_type: 'npcdroptable',
      object_type: 'npc_drop_table',
      outcome: 'created',
      action: 'create',
      file: 'NpcDropTable/npcdroptable_4242.json',
      commit_message: 'spiraldb: create npc_drop_table 4242',
      status_created: true,
    });

    // The directory and the file exist in the repository, and the directory holds only it.
    expect(fs.existsSync(path.join(h.root, 'NpcDropTable'))).toBe(true);
    expect(repoFileExists(h.repo, 'NpcDropTable/npcdroptable_4242.json')).toBe(true);
    expect(familyFiles(h.root)).toEqual(['npcdroptable_4242.json']);

    // The payload: a JSON number key and a string array — no third key, key order preserved.
    const written = readSpiraldbJson(
      path.join(h.root, 'NpcDropTable/npcdroptable_4242.json'),
    ) as Record<string, unknown>;
    expect(Object.keys(written)).toEqual(['TemplateID', 'DropTableNames']);
    expect(written).toEqual({ TemplateID: 4242, DropTableNames: SAMPLE_NAMES });
    expect(typeof written.TemplateID).toBe('number');
    expect(Array.isArray(written.DropTableNames)).toBe(true);
    expect(written.DropTableNames).toEqual([...SAMPLE_NAMES]);

    // The commit and the status row (AC3: the key as text in entry_status).
    expect(commitSubjects(h.repo)[0]).toBe('spiraldb: create npc_drop_table 4242');
    const entry = getStatusEntry(h.db, 'npc_drop_table', '4242');
    expect(entry?.status).toBe('extracted');
    expect(result.status?.object_key).toBe('4242');
  });

  it('keeps an empty name list as [] rather than null or a dropped key', async () => {
    const h = harness();
    await save(h, { TemplateID: 777, DropTableNames: [] });
    const raw = fs.readFileSync(path.join(h.root, 'NpcDropTable/npcdroptable_777.json'), 'utf8');
    // The key is present and empty — not `null`, not absent (the writer pretty-prints, so the
    // assertion tolerates whitespace but pins the [] itself).
    expect(raw).toMatch(/"DropTableNames":\s*\[\]/);
    expect(raw).not.toMatch(/"DropTableNames":\s*null/);
    expect(readSpiraldbJson(path.join(h.root, 'NpcDropTable/npcdroptable_777.json'))).toEqual({
      TemplateID: 777,
      DropTableNames: [],
    });
  });

  it('writes an update back to the created file — for this family the created name IS the convention (D19)', async () => {
    const h = harness();
    const created = await save(h, { TemplateID: 4242, DropTableNames: SAMPLE_NAMES });

    // The user removes the *second* chip (a name the synced table does not hold) by index.
    const list = readStringList({ DropTableNames: SAMPLE_NAMES }, 'DropTableNames');
    const updated = await save(h, {
      TemplateID: 4242,
      DropTableNames: removeAtIndex(list, 1),
    });

    expect(updated.outcome).toBe('updated');
    expect(updated.action).toBe('update');
    // D19: resolution is index-based and an update writes the original path — here the file the
    // create chose, because no legacy file exists to keep a name for.
    expect(updated.file).toBe(created.file);
    expect(familyFiles(h.root)).toEqual(['npcdroptable_4242.json']);
    expect(commitSubjects(h.repo)[0]).toBe('spiraldb: update npc_drop_table 4242');
    expect(readSpiraldbJson(path.join(h.root, 'NpcDropTable/npcdroptable_4242.json'))).toEqual({
      TemplateID: 4242,
      DropTableNames: ['WC-UNICORN-MAIN-007'],
    });
  });

  it('round-trips an unmodified reload byte-identically (no save adds a key)', async () => {
    const h = harness();
    await save(h, { TemplateID: 4242, DropTableNames: SAMPLE_NAMES });
    const file = path.join(h.root, 'NpcDropTable/npcdroptable_4242.json');
    const first = fs.readFileSync(file, 'utf8');

    await save(h, readSpiraldbJson(file) as Record<string, unknown>);
    expect(fs.readFileSync(file, 'utf8')).toBe(first);
  });
});
