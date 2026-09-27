import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { objectTypeConfig } from '@shared/objectTypes';
import { openDb, MEMORY_DB, writeSettings, type Db } from '@server/db';
import { createObjectRouter } from '@server/routes/objects.js';
import { validateDropTableSave } from '@server/services/dropTables';
import { createSavePipeline, type SavePipeline } from '@server/services/savePipeline';
import { createSpiraldbIndex, type SpiraldbIndex } from '@server/services/spiraldbIndex';
import {
  createTempGitRepo,
  removeTempGitRepo,
  repoFileExists,
  writeRepoFile,
  type TempRepo,
} from '../helpers/temp-git-repo';

/**
 * Story p4-02's **server half of AC1** — the direct-POST 400 proof for the four DropTable
 * negatives, by an **in-process route call** (`supertest` against an `express()` instance
 * mounting the real `createObjectRouter({ db, config, validate: validateDropTableSave })`).
 *
 * Why in-process rather than curl: the rule under test is "the shared engine rejects a bad
 * document with a field-keyed 400", and an HTTP call over the wire adds a second process, a
 * port and a `settings` table to the evidence without touching that claim. The router, the
 * validator, the pipeline and the response body are all the real ones; only the transport is
 * in-process. (D3 of the story's brief allows either and asks which.)
 *
 * Hermetic by construction (D17/D40): a throwaway `git init` repository under
 * `data/__test-scratch__/` carrying three real-shaped drop tables, an in-memory database, and
 * no read of the owner's fork or the D17 clone.
 *
 * The two arms that make this test worth having:
 *
 * 1. **Every negative is a 400 with the field map** — `{ error, fields: { Name: [...] } }` etc.,
 *    keyed by the shared `formatDocPath` the client renders inline. A client-only check cannot
 *    produce this, which is the story's named failure mode.
 * 2. **An unmodified save of an existing entry is NOT a 400.** `Name` is the key, so a naive
 *    "is this name in the corpus?" test would reject every edit of an existing entry against
 *    itself. The client sends the route key back as `body.key`, and the validator forgives
 *    exactly that one occurrence.
 */

const USER = 'P4-02 Tester';
const OPEN_DBS: Db[] = [];
const REPOS: TempRepo[] = [];

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

/** Three real-shaped drop tables: two names, one of them with the absent-key shapes. */
const FIXTURE: Record<string, string> = {
  'DropTables/droptables_ds-acad1-c01-001.json': JSON.stringify({
    Name: 'DS-ACAD1-C01-001',
    Description: '',
    RollChance: 1.0,
    Weight: 100,
    NoneChance: 0.0,
    PityCounter: 0.0,
    MinGold: 0,
    MaxGold: 0,
    ExperienceAmount: 0,
    TrainingPoints: 0,
    Items: [],
    CreatedAt: '2026-06-01T00:57:50.183246Z',
    ModifiedAt: '2026-06-01T00:57:50.183246Z',
    CreatedBy: 'quest_builder',
    ModifiedBy: 'quest_builder',
  }),
  // No GrantsPotionSlot and no audit block — the 282-file / 1-file shapes.
  'DropTables/droptables_ds-acad1-c01-002.json': JSON.stringify({
    Name: 'DS-ACAD1-C01-002',
    RollChance: 1.0,
    NoneChance: 0.0,
    MinGold: 0,
    MaxGold: 0,
    Items: [],
  }),
  'DropTables/droptables_wc-commons-main-004.json': JSON.stringify({
    Name: 'WC-COMMONS-MAIN-004',
    RollChance: 1.0,
    NoneChance: 0.0,
    MinGold: 10,
    MaxGold: 20,
    Items: [],
  }),
};

interface Harness {
  repo: TempRepo;
  root: string;
  db: Db;
  index: SpiraldbIndex;
  pipeline: SavePipeline;
}

function harness(): Harness {
  const repo = createTempGitRepo('droptable-save-');
  REPOS.push(repo);
  for (const [relative, content] of Object.entries(FIXTURE)) {
    writeRepoFile(repo, relative, content);
  }
  repo.git(['add', '--all']);
  repo.git(['commit', '-m', 'three real-shaped drop tables']);

  const db = openDb({ file: MEMORY_DB });
  OPEN_DBS.push(db);
  writeSettings(db, { spiraldb_path: repo.dir, user_name: USER, git_branch: '' });

  const index = createSpiraldbIndex(repo.dir);
  index.rebuild();
  const pipeline = createSavePipeline({ db, spiraldbPath: repo.dir, index });
  return { repo, root: repo.dir, db, index, pipeline };
}

/** The real router, with the real drop-table validator injected (routes/index.ts's wiring). */
function appFor(h: Harness): Express {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/drop-tables',
    createObjectRouter({
      db: h.db,
      config: objectTypeConfig('droptable'),
      validate: validateDropTableSave,
    }),
  );
  return app;
}

/** A valid document to mutate one rule at a time. */
function document(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    Name: 'P4-02-NEW-TABLE',
    Description: '',
    RollChance: 1.0,
    Weight: 100,
    NoneChance: 0.0,
    PityCounter: 0.0,
    MinGold: 0,
    MaxGold: 0,
    ExperienceAmount: 0,
    TrainingPoints: 0,
    Items: [],
    ...patch,
  };
}

describe('POST /api/drop-tables: the four blocking rules answer 400 with a field map', () => {
  it('AC1 negative 1: an empty Name is 400 with fields.Name', async () => {
    const h = harness();
    const res = await request(appFor(h))
      .post('/api/drop-tables')
      .send({ object: document({ Name: '' }) })
      .expect(400);
    expect(res.body.error).toContain('DropTable validation failed');
    expect(res.body.error).toContain('Missing name');
    expect(Object.keys(res.body.fields)).toEqual(['Name']);
    expect(res.body.fields.Name).toHaveLength(1);
    expect(res.body.fields.Name[0]).toContain('non-empty Name');
    // Nothing was written.
    expect(repoFileExists(h.repo, 'DropTables/droptable_P4-02-NEW-TABLE.json')).toBe(false);
  });

  it('AC1 negative 2: a Name the corpus already holds is 400 with fields.Name (no key sent)', async () => {
    const h = harness();
    const res = await request(appFor(h))
      .post('/api/drop-tables')
      .send({ object: document({ Name: 'DS-ACAD1-C01-001' }) })
      .expect(400);
    expect(Object.keys(res.body.fields)).toEqual(['Name']);
    expect(res.body.fields.Name[0]).toContain('already used by another drop table');
    expect(res.body.fields.Name[0]).toContain('DS-ACAD1-C01-001');
  });

  it('AC1 negative 2, renaming an existing entry onto another one: still 400 (the key is forgiven, the target is not)', async () => {
    const h = harness();
    const res = await request(appFor(h))
      .post('/api/drop-tables')
      // The entry being edited is DS-ACAD1-C01-001; the document renames it onto -002's name.
      .send({ object: document({ Name: 'DS-ACAD1-C01-002' }), key: 'DS-ACAD1-C01-001' })
      .expect(400);
    expect(Object.keys(res.body.fields)).toEqual(['Name']);
  });

  it('AC1 negative 3: RollChance 1.5 is 400 with fields.RollChance', async () => {
    const h = harness();
    const res = await request(appFor(h))
      .post('/api/drop-tables')
      .send({ object: document({ RollChance: 1.5 }) })
      .expect(400);
    expect(Object.keys(res.body.fields)).toEqual(['RollChance']);
    expect(res.body.fields.RollChance[0]).toContain('between 0 and 1');
  });

  it('AC1 negative 4: NoneChance -0.1 is 400 with fields.NoneChance', async () => {
    const h = harness();
    const res = await request(appFor(h))
      .post('/api/drop-tables')
      .send({ object: document({ NoneChance: -0.1 }) })
      .expect(400);
    expect(Object.keys(res.body.fields)).toEqual(['NoneChance']);
    expect(res.body.fields.NoneChance[0]).toContain('-0.1');
  });

  it('AC1 negative 5: MinGold 100 + MaxGold 10 is 400 with fields.MaxGold', async () => {
    const h = harness();
    const res = await request(appFor(h))
      .post('/api/drop-tables')
      .send({ object: document({ MinGold: 100, MaxGold: 10 }) })
      .expect(400);
    expect(Object.keys(res.body.fields)).toEqual(['MaxGold']);
    expect(res.body.fields.MaxGold[0]).toContain('Minimum gold');
    expect(res.body.fields.MaxGold[0]).toContain('100');
  });

  it('a document with several violations carries one entry per field', async () => {
    const h = harness();
    const res = await request(appFor(h))
      .post('/api/drop-tables')
      .send({
        object: document({ Name: '', RollChance: 2, NoneChance: -1, MinGold: 9, MaxGold: 1 }),
      })
      .expect(400);
    expect(Object.keys(res.body.fields).sort()).toEqual([
      'MaxGold',
      'Name',
      'NoneChance',
      'RollChance',
    ]);
    expect(res.body.error).toContain('4 validation errors');
  });
});

describe('POST /api/drop-tables: what must NOT be a 400', () => {
  it('an unmodified save of an existing entry passes — the entry is forgiven its own name', async () => {
    const h = harness();
    const existing = JSON.parse(FIXTURE['DropTables/droptables_ds-acad1-c01-001.json']) as Record<
      string,
      unknown
    >;
    const res = await request(appFor(h))
      .post('/api/drop-tables')
      .send({ object: existing, key: 'DS-ACAD1-C01-001' })
      .expect(200);
    expect(res.body.outcome).toBe('updated');
    expect(res.body.action).toBe('update');
    expect(res.body.file).toBe('DropTables/droptables_ds-acad1-c01-001.json');
  });

  it('a create with a brand-new name passes and lands on the convention filename (singular droptable_)', async () => {
    const h = harness();
    const res = await request(appFor(h))
      .post('/api/drop-tables')
      .send({ object: document({}) })
      .expect(200);
    expect(res.body.outcome).toBe('created');
    expect(res.body.file).toBe('DropTables/droptable_P4-02-NEW-TABLE.json');
    expect(repoFileExists(h.repo, res.body.file)).toBe(true);
  });

  it('the 8-measured-miss shape (an ItemId the names table does not carry) does not block a save', async () => {
    const h = harness();
    const res = await request(appFor(h))
      .post('/api/drop-tables')
      .send({
        object: document({
          Items: [
            { ItemId: '1000', ItemName: 'New Item', Notes: '', Requirements: null },
            { ItemId: '533943727', ItemName: 'Black Mantle', Notes: '', Requirements: null },
          ],
        }),
      })
      .expect(200);
    expect(res.body.outcome).toBe('created');
    // The write keeps the string ids and the ItemName the file carried (miss-safe, D57).
    const written = JSON.parse(h.repo.git(['show', `HEAD:${res.body.file}`])) as {
      Items: Array<{ ItemId: unknown; ItemName: string }>;
    };
    expect(written.Items.map((row) => row.ItemId)).toEqual(['1000', '533943727']);
    expect(written.Items.map((row) => row.ItemName)).toEqual(['New Item', 'Black Mantle']);
  });

  it('a JSON5-legacy file with a trailing comma still saves (the reader is shared with the writer)', async () => {
    const h = harness();
    writeRepoFile(
      h.repo,
      'DropTables/droptables_legacy-trailing.json',
      '{\n  "Name": "LEGACY-TRAILING",\n  "RollChance": 1.0,\n  "NoneChance": 0.0,\n  "MinGold": 0,\n  "MaxGold": 0,\n  "Items": [],\n}\n',
    );
    h.repo.git(['add', '--all']);
    h.repo.git(['commit', '-m', 'legacy trailing comma']);

    const res = await request(appFor(h))
      .post('/api/drop-tables')
      .send({
        object: {
          Name: 'LEGACY-TRAILING',
          RollChance: 1.0,
          NoneChance: 0.0,
          MinGold: 0,
          MaxGold: 0,
          Items: [],
        },
        key: 'LEGACY-TRAILING',
      })
      .expect(200);
    expect(res.body.outcome).toBe('updated');
  });

  it('the body-shape 400 carries no fields (the pre-4.2 contract is unchanged)', async () => {
    const h = harness();
    const res = await request(appFor(h)).post('/api/drop-tables').send({}).expect(400);
    expect(res.body.fields).toBeUndefined();
    expect(typeof res.body.error).toBe('string');
  });
});
