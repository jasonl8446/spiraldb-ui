import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { coverageHeadline, groupDigits } from '../../client/src/lib/quest-catalog';
import { MEMORY_DB, openDb, writeSettings, type Db } from '@server/db';
import { createQuestsRouter } from '@server/routes/quests';
import {
  COVERAGE_VIEW_SELECT,
  listQuestCatalog,
  parseCatalogQ,
  parseMissingOnly,
  QuestCatalogQueryError,
  readCoverage,
  type CoverageRow,
} from '@server/services/questCoverage';

/**
 * Task 6.10 / story **p6-11** — the coverage read and the catalog worklist served over HTTP.
 *
 * The criterion (ac1) is *"the header equals the `coverage` view (asserted, not recomputed)"*, so
 * the assertions below are built to make a hard-coded number impossible rather than merely absent:
 *
 * 1. the API's five axes are compared against the view row the **test itself** selects — spelled
 *    out here (`SELECT * FROM coverage`), not through the service's own constant, so the check is
 *    not the function agreeing with itself (D90(c));
 * 2. the header is built from the **API response** and each of its numbers is asserted to be the
 *    view's, grouped exactly as `groupDigits` groups them;
 * 3. the catalog is then **changed** (more rows, one more definition) and the header is rebuilt —
 *    a constant would survive that, a read cannot. The old digits are asserted **absent**.
 *
 * The corpus clause is asserted the same way: ac1's third clause is that the header names the
 * corpus it measured, so a temp root with a known file count is what the assertion uses — and the
 * *other* five axes are deliberately five **distinct** values, so an axis read from the wrong
 * column cannot pass by coincidence.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CLIENT_SRC = path.join(ROOT, 'client', 'src');

const OPEN_DBS: Db[] = [];
const TEMP_DIRS: string[] = [];

afterEach(() => {
  while (OPEN_DBS.length > 0) {
    OPEN_DBS.pop()?.close();
  }
  while (TEMP_DIRS.length > 0) {
    fs.rmSync(TEMP_DIRS.pop() as string, { recursive: true, force: true });
  }
});

/** A fresh in-memory database with every migration applied (the view included). */
function memoryDb(): Db {
  const db = openDb({ file: MEMORY_DB });
  OPEN_DBS.push(db);
  return db;
}

/** A temp SpiralDB root holding `jsonFiles` `QuestTemplates/*.json` files. */
function tempCorpus(jsonFiles: number): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p6-11-coverage-'));
  TEMP_DIRS.push(root);
  fs.mkdirSync(path.join(root, 'QuestTemplates'), { recursive: true });
  for (let index = 0; index < jsonFiles; index += 1) {
    fs.writeFileSync(path.join(root, 'QuestTemplates', `questtemplates_Q${index}.json`), '{}');
  }
  // A non-JSON sibling: the count must be `*.json`, not "files in the directory".
  fs.writeFileSync(path.join(root, 'QuestTemplates', 'README.txt'), 'not a quest');
  return root;
}

/**
 * The five axes, deliberately distinct: 7 nameable (3 defined + 4 missing), 11 ids, 5 references.
 * A service that read `defined` from the wrong column could not produce these.
 */
function seedCatalog(db: Db, corpusRoot: string): void {
  const insertQuest = db.prepare(
    `INSERT INTO quests (quest_name, title, has_definition, link_kind, title_source, reference_count)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (let index = 0; index < 7; index += 1) {
    const defined = index < 3 ? 1 : 0;
    insertQuest.run(
      `Q-${index}`,
      `Title ${index}`,
      defined,
      index === 0 ? 'direct' : 'none',
      index === 0 ? 'direct' : 'none',
      index,
    );
  }
  const insertId = db.prepare(
    'INSERT INTO quest_ids (quest_id, title_key, title, text_rows) VALUES (?, ?, ?, ?)',
  );
  for (let id = 0; id < 11; id += 1) {
    insertId.run(id, `QuestTitle_${id.toString(16)}`, `Id title ${id}`, 1);
  }
  const insertRef = db.prepare(
    `INSERT INTO quest_catalog_refs (quest_name, wad, entry, class, goal_name, required_status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (let index = 0; index < 5; index += 1) {
    insertRef.run(
      `Q-${index}`,
      'Aquila-AQ_Z00_Hub.wad',
      `entry-${index}`,
      'ReqHasQuest',
      null,
      null,
    );
  }
  writeSettings(db, { spiraldb_path: corpusRoot });
}

/** The test's own read of the view — deliberately not the service's constant. */
function viewRow(db: Db): CoverageRow {
  return db
    .prepare('SELECT nameable, id_space, defined, missing, "references" FROM coverage')
    .get() as CoverageRow;
}

function app(db: Db): Express {
  const server = express();
  server.use(express.json());
  server.use('/api/quests', createQuestsRouter({ db }));
  return server;
}

/* --------------------------------------------------------------- the service */

describe('readCoverage — the five axes come from the view', () => {
  it('equals the view row and names the corpus it measured', () => {
    const db = memoryDb();
    const corpus = tempCorpus(3);
    seedCatalog(db, corpus);

    const coverage = readCoverage(db);

    expect(coverage).toMatchObject(viewRow(db));
    expect(viewRow(db)).toEqual({
      nameable: 7,
      id_space: 11,
      defined: 3,
      missing: 4,
      references: 5,
    });
    expect(coverage.corpus).toEqual({ spiraldb_path: corpus, quest_files: 3 });
    // The service's own statement reads the same row: the exported constant is the *one* home of
    // the view's columns, and it is asserted here rather than assumed.
    expect(db.prepare(COVERAGE_VIEW_SELECT).get()).toEqual(viewRow(db));
  });

  it('reports an unset SpiralDB path as no corpus rather than throwing', () => {
    const db = memoryDb();
    seedCatalog(db, tempCorpus(0));
    writeSettings(db, { spiraldb_path: '' });

    expect(readCoverage(db).corpus).toEqual({ spiraldb_path: '', quest_files: 0 });
  });
});

/* ------------------------------------------------------------------ the API */

describe('GET /api/quests/coverage', () => {
  it('serves the view row, asserted against a read the test makes itself', async () => {
    const db = memoryDb();
    const corpus = tempCorpus(3);
    seedCatalog(db, corpus);

    const response = await request(app(db)).get('/api/quests/coverage').expect(200);
    const body = response.body as CoverageRow & {
      corpus: { spiraldb_path: string; quest_files: number };
    };

    expect(body.nameable).toBe(viewRow(db).nameable);
    expect(body.id_space).toBe(viewRow(db).id_space);
    expect(body.defined).toBe(viewRow(db).defined);
    expect(body.missing).toBe(viewRow(db).missing);
    expect(body.references).toBe(viewRow(db).references);
    expect(body.corpus).toEqual({ spiraldb_path: corpus, quest_files: 3 });

    // ac1: the header is built from this response, and every number in it is the view's.
    const headline = coverageHeadline(body);
    expect(headline).toContain(`${groupDigits(viewRow(db).defined)} defined`);
    expect(headline).toContain(`of ${groupDigits(viewRow(db).nameable)} nameable`);
    expect(headline).toContain(
      `of ~${groupDigits(viewRow(db).id_space)} quests the client holds text for`,
    );
    expect(headline).toContain(`corpus: ${corpus} (3 quest files)`);
  });

  it('is registered before /:name, so "coverage" is never read as a quest name', async () => {
    const db = memoryDb();
    seedCatalog(db, tempCorpus(0));

    // A quest literally named `coverage` exists; the static route still answers the view.
    db.prepare('INSERT INTO quests (quest_name, title, has_definition) VALUES (?, ?, ?)').run(
      'coverage',
      'A quest called coverage',
      1,
    );

    const response = await request(app(db)).get('/api/quests/coverage').expect(200);
    expect(response.body.nameable).toBe(viewRow(db).nameable);
    expect(response.body.corpus).toBeDefined();
  });

  it('changes with the view — a changed catalog changes the header, so neither is a constant', async () => {
    const db = memoryDb();
    seedCatalog(db, tempCorpus(0));

    const before = (await request(app(db)).get('/api/quests/coverage').expect(200)).body;
    const headlineBefore = coverageHeadline(before);

    // One more definition and four more catalog-only rows: the view moves, so the header must.
    db.prepare('UPDATE quests SET has_definition = 1 WHERE quest_name = ?').run('Q-3');
    const insertQuest = db.prepare(
      'INSERT INTO quests (quest_name, title, has_definition) VALUES (?, ?, 0)',
    );
    for (let index = 0; index < 4; index += 1) {
      insertQuest.run(`Q-extra-${index}`, `Extra ${index}`);
    }

    const after = (await request(app(db)).get('/api/quests/coverage').expect(200)).body;
    const headlineAfter = coverageHeadline(after);

    expect(before.defined).toBe(3);
    expect(after.defined).toBe(4);
    expect(before.nameable).toBe(7);
    expect(after.nameable).toBe(11);
    expect(headlineAfter).toContain('4 defined');
    expect(headlineAfter).toContain('of 11 nameable');
    // The stale digits are gone: the header is a read of the view, not a remembered number.
    expect(headlineAfter).not.toContain('3 defined');
    expect(headlineAfter).not.toContain('7 nameable');
    expect(headlineAfter).not.toBe(headlineBefore);
  });
});

/* -------------------------------------------------------------- the worklist */

describe('GET /api/quests/catalog', () => {
  it('lists every catalog row, most-gated first', async () => {
    const db = memoryDb();
    seedCatalog(db, tempCorpus(0));

    const response = await request(app(db)).get('/api/quests/catalog').expect(200);

    expect(response.body.total).toBe(7);
    expect(response.body.missing_only).toBe(false);
    expect(response.body.quests.map((row: { quest_name: string }) => row.quest_name)).toEqual([
      'Q-6',
      'Q-5',
      'Q-4',
      'Q-3',
      'Q-2',
      'Q-1',
      'Q-0',
    ]);
    expect(response.body.quests[0]).toMatchObject({
      title: 'Title 6',
      has_definition: 0,
      reference_count: 6,
    });
  });

  it('the missing-only filter is a predicate over the catalog, and its count equals the view', async () => {
    const db = memoryDb();
    seedCatalog(db, tempCorpus(0));

    const response = await request(app(db)).get('/api/quests/catalog?missing_only=1').expect(200);

    expect(response.body.missing_only).toBe(true);
    expect(response.body.quests).toHaveLength(4);
    expect(
      response.body.quests.every((row: { has_definition: number }) => row.has_definition === 0),
    ).toBe(true);
    // The filter's count and the view's `missing` are the same quantity, reached two ways.
    expect(response.body.total).toBe(viewRow(db).missing);
    expect(response.body.total).toBe(4);
  });

  it('?q= narrows by name or title in SQL, case-insensitively (D186)', async () => {
    const db = memoryDb();
    seedCatalog(db, tempCorpus(0));

    const byName = await request(app(db)).get('/api/quests/catalog?q=q-3').expect(200);
    expect(byName.body.quests.map((row: { quest_name: string }) => row.quest_name)).toEqual([
      'Q-3',
    ]);
    expect(byName.body.total).toBe(1);
    expect(byName.body.q).toBe('q-3');

    // `TITLE 5` is only in the title (`Title 5`), never in a name.
    const byTitle = await request(app(db)).get('/api/quests/catalog?q=TITLE%205').expect(200);
    expect(byTitle.body.quests.map((row: { quest_name: string }) => row.quest_name)).toEqual([
      'Q-5',
    ]);

    const all = await request(app(db)).get('/api/quests/catalog?q=title').expect(200);
    expect(all.body.total).toBe(7);

    const none = await request(app(db)).get('/api/quests/catalog?q=zzz').expect(200);
    expect(none.body.quests).toEqual([]);
    expect(none.body.total).toBe(0);
  });

  it('?q= is a literal substring (LIKE metacharacters escaped) and blank means no search', async () => {
    const db = memoryDb();
    seedCatalog(db, tempCorpus(0));

    const percent = await request(app(db)).get('/api/quests/catalog?q=%25').expect(200);
    expect(percent.body.total).toBe(0);
    const underscore = await request(app(db)).get('/api/quests/catalog?q=_').expect(200);
    expect(underscore.body.total).toBe(0);

    const blank = await request(app(db)).get('/api/quests/catalog?q=%20%20').expect(200);
    expect(blank.body.total).toBe(7);
    expect(blank.body.q).toBe('');
  });

  it('?q= combines with missing_only (AND) and the combined count is the intersection', async () => {
    const db = memoryDb();
    seedCatalog(db, tempCorpus(0));

    // Q-0..Q-2 are defined, Q-3..Q-6 missing; `Title` matches all seven.
    const both = await request(app(db)).get('/api/quests/catalog?missing_only=1&q=Q-').expect(200);
    expect(both.body.quests.map((row: { quest_name: string }) => row.quest_name)).toEqual([
      'Q-6',
      'Q-5',
      'Q-4',
      'Q-3',
    ]);
    const defined = await request(app(db))
      .get('/api/quests/catalog?missing_only=1&q=Q-1')
      .expect(200);
    expect(defined.body.total).toBe(0);
  });

  it('refuses a malformed ?q= (repeated, or over the length cap)', async () => {
    const db = memoryDb();
    seedCatalog(db, tempCorpus(0));

    const repeated = await request(app(db)).get('/api/quests/catalog?q=a&q=b').expect(400);
    expect(repeated.body.error).toBe('Query parameter "q" must be a single string value');
    const long = await request(app(db))
      .get(`/api/quests/catalog?q=${'x'.repeat(201)}`)
      .expect(400);
    expect(long.body.error).toBe('Invalid q: at most 200 characters');
    expect(() => parseCatalogQ(['a'])).toThrow(QuestCatalogQueryError);
    expect(parseCatalogQ(undefined)).toBe('');
    expect(parseCatalogQ('  hi ')).toBe('hi');
  });

  it('refuses a malformed filter instead of clamping it', async () => {
    const db = memoryDb();
    seedCatalog(db, tempCorpus(0));

    const response = await request(app(db)).get('/api/quests/catalog?missing_only=yes').expect(400);
    expect(response.body.error).toBe('Invalid missing_only "yes": expected 1/0 (or true/false).');
  });

  it('accepts the documented values and rejects an unknown one', () => {
    expect(parseMissingOnly(undefined)).toBe(false);
    expect(parseMissingOnly('')).toBe(false);
    expect(parseMissingOnly('1')).toBe(true);
    expect(parseMissingOnly('true')).toBe(true);
    expect(parseMissingOnly('0')).toBe(false);
    expect(parseMissingOnly('false')).toBe(false);
    expect(() => parseMissingOnly('2')).toThrow(QuestCatalogQueryError);
  });

  it('listQuestCatalog carries the corpus block, so the view names what it measured', () => {
    const db = memoryDb();
    const corpus = tempCorpus(2);
    seedCatalog(db, corpus);

    expect(listQuestCatalog(db).corpus).toEqual({ spiraldb_path: corpus, quest_files: 2 });
  });
});

/* ------------------------------------------- the "no hard-coded constant" check */

/**
 * The header path's own sources. A literal `1,447`/`322`/… anywhere in them is exactly what ac1
 * forbids, and the scan is the instrument; its **negative control** below proves it can see one.
 */
const HEADER_SOURCES = [
  'lib/quest-catalog.ts',
  'components/quest/CoverageHeader.tsx',
  'pages/QuestCatalogPage.tsx',
  'pages/QuestsPage.tsx',
] as const;

/** The constants the plan/spec quote as *examples* — none may be in the header path. */
const FORBIDDEN_DIGITS = ['1447', '1717', '322', '4823', '4830', '2855', '1395'] as const;

/**
 * Removes comments while respecting string literals, so the scan measures **code** rather than
 * prose. A measurement quoted in a doc comment (this module's own neighbour does quote the two
 * corpus counts, on purpose) cannot reach the rendered header, and a detector that could not tell
 * a comment from a constant would force documentation to avoid its own evidence. The negative
 * control below keeps the stripped detector honest: it places the deliberate constant in code.
 */
function stripComments(text: string): string {
  let out = '';
  let index = 0;
  let quote: string | null = null;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (quote !== null) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        index += 2;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') {
        index += 1;
      }
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

/**
 * Every occurrence of one of the corpus figures in a source text, with or without thousands
 * separators (both `1447` and `1,447` are the same constant to a reader, so both must be found).
 * The neighbour guard keeps `322` from matching inside `3220` or `3.22`.
 */
function hardCodedConstants(text: string): string[] {
  const flattened = stripComments(text).replace(/,/g, '');
  const hits: string[] = [];
  for (const digits of FORBIDDEN_DIGITS) {
    const pattern = new RegExp(`(?<![\\d.])${digits}(?![\\d.])`, 'g');
    for (const match of flattened.matchAll(pattern)) {
      hits.push(match[0]);
    }
  }
  return hits.sort();
}

describe('the coverage header holds no hard-coded corpus number', () => {
  it('finds none in the four sources that build or render it', () => {
    for (const relative of HEADER_SOURCES) {
      const text = fs.readFileSync(path.join(CLIENT_SRC, relative), 'utf8');
      expect(hardCodedConstants(text), relative).toEqual([]);
    }
  });

  it('negative control: the same scan finds a deliberate constant', () => {
    // A line that a careless implementation would plausibly write — the detector must see it, or
    // the clean result above would prove nothing (D90(c)).
    const scratch = [
      "export const HEADLINE = '322 defined of 1,447 nameable of ~4,830 quests the client holds text for';",
      'const total = 1395; // missing',
    ].join('\n');
    expect(hardCodedConstants(scratch)).toEqual(['1395', '1447', '322', '4830']);
    // …and the same detector must not fire on the words alone.
    expect(hardCodedConstants('/* 322 and 1,447 live in this comment */')).toEqual([]);
  });

  it('the header is built from the response — the four sources read it and pass it in', () => {
    const lib = fs.readFileSync(path.join(CLIENT_SRC, 'lib/quest-catalog.ts'), 'utf8');
    expect(lib).toContain('coverage.corpus.spiraldb_path');
    expect(lib).toContain('groupDigits(coverage.defined)');
    expect(lib).toContain('groupDigits(coverage.nameable)');
    expect(lib).toContain('groupDigits(coverage.id_space)');
  });
});
