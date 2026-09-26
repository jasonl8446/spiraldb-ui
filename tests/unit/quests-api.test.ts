import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { MEMORY_DB, openDb, writeSettings, type Db } from '@server/db';
import { createQuestsRouter } from '@server/routes/quests';
import { createStatusRouter } from '@server/routes/status';
import { countQuestGoals, buildQuestRows } from '@server/services/sync/corpus';
import { runFirstStartupImport } from '@server/services/import';
import {
  listQuests,
  QuestRequestError,
  readQuest,
  saveQuest,
  type QuestListResult,
} from '@server/services/quests';
import {
  type SaveObjectRequest,
  type SaveObjectResult,
  type SavePipeline,
} from '@server/services/savePipeline';
import { createSpiraldbIndex } from '@server/services/spiraldbIndex';
import { applyStatusChange, listStatus } from '@server/services/status';
import {
  commitSubjects,
  createTempGitRepo,
  readRepoFile,
  removeTempGitRepo,
  repoFileExists,
  type TempRepo,
} from '../helpers/temp-git-repo';

/**
 * Task 2.5 / story p2-06 — the quests API (docs/plan-phase-2-quest-extraction.md
 * §2.5, docs/spec-api.md L164-180).
 *
 * Hermetic by construction: a temp corpus directory under `data/__test-scratch__/`
 * (or `os.tmpdir()`), an in-memory database, throwaway `git init` repositories from
 * the p2-05 helper, and injected fakes where a real pipeline would be redundant.
 * The disposable clone, the owner's fork and the network are never touched (D17).
 */

const FIXTURES = fileURLToPath(new URL('../../server/test/fixtures/', import.meta.url));
const TEMP_DIRS: string[] = [];
const OPEN_DBS: Db[] = [];
const REPOS: TempRepo[] = [];
const USER = 'P2-06 Tester';

afterEach(() => {
  while (TEMP_DIRS.length > 0) {
    const dir = TEMP_DIRS.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
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
  for (const repo of REPOS) {
    removeTempGitRepo(repo);
  }
});

function memoryDb(): Db {
  const db = openDb({ file: MEMORY_DB });
  OPEN_DBS.push(db);
  return db;
}

/** An empty temp corpus root. */
function corpusRoot(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'spiraldb-quests-'));
  TEMP_DIRS.push(dir);
  return dir;
}

/** A throwaway git repository (p2-05 helper) registered for cleanup. */
function gitRepo(): TempRepo {
  const created = createTempGitRepo('quests-api-');
  REPOS.push(created);
  return created;
}

interface QuestShape {
  title?: string | null;
  level?: number | null;
  mainline?: boolean;
  goals?: number;
  /** Injects a trailing comma so the file is legal JSON5 but illegal JSON. */
  trailingComma?: boolean;
}

/** A quest document shaped like the corpus (explicit nulls, array of goals). */
function questText(name: string, shape: QuestShape = {}): string {
  const doc: Record<string, unknown> = { m_questName: name, m_questInfo: null, m_questPrep: null };
  if (shape.title !== null) {
    doc.m_questTitle = shape.title ?? 'QuestTitle_1ED8A';
  }
  doc.m_questLevel = shape.level === undefined ? 1 : shape.level;
  doc.m_mainline = shape.mainline ?? false;
  doc.m_goals = Array.from({ length: shape.goals ?? 2 }, (_, index) => ({
    $type: 'Imcodec.ObjectProperty.TypeCache.WaypointGoalTemplate, Imcodec.ObjectProperty',
    m_goalName: `${index + 1}_Goal`,
    m_targets: null,
  }));

  const text = JSON.stringify(doc, null, 2);
  return shape.trailingComma === true ? `${text.replace(/\n\}$/, ',\n}\n')}\n` : `${text}\n`;
}

/** Writes a `QuestTemplates/<file>` (or any relative path) into a root. */
function writeFile(root: string, relative: string, content: string): string {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
  return target;
}

function seedString(db: Db, key: string, value: string): void {
  db.prepare('INSERT INTO string_table (key, value, category) VALUES (?, ?, ?)').run(
    key,
    value,
    'QuestTitle',
  );
}

function seedStatus(db: Db, key: string, status: 'extracted' | 'reviewed' | 'verified'): void {
  db.prepare(
    "INSERT INTO entry_status (object_type, object_key, status, extracted_at) VALUES ('quest', ?, ?, '2026-09-26T00:00:00.000Z')",
  ).run(key, status);
}

interface Harness {
  db: Db;
  app: Express;
  root: string;
}

/** The real composition: the quests router at `/api/quests` over an injected DB. */
function harness(options: { root?: string; user?: string; spiraldbPath?: string } = {}): Harness {
  const root = options.root ?? corpusRoot();
  const db = memoryDb();
  writeSettings(db, {
    spiraldb_path: options.spiraldbPath ?? root,
    user_name: options.user ?? USER,
    git_branch: '',
  });

  const app = express();
  app.use(express.json());
  app.use('/api/quests', createQuestsRouter({ db }));
  app.use('/api/status', createStatusRouter({ db }));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return { db, app, root };
}

describe('GET /api/quests — the browse list (ac1)', () => {
  it('returns every table column the UI needs, resolving titles through the string table', async () => {
    const root = corpusRoot();
    const modified = new Date('2026-04-03T07:00:36.265Z');
    const questFile = writeFile(
      root,
      'QuestTemplates/questtemplates_DS-P206-A-001.json',
      questText('DS-P206-A-001', {
        title: 'QuestTitle_1ED8A',
        level: 12,
        mainline: true,
        goals: 3,
      }),
    );
    utimesSync(questFile, modified, modified);
    writeFile(
      root,
      'QuestTemplates/questtemplates_DS-P206-B-002.json',
      questText('DS-P206-B-002', {
        title: 'QuestTitle_MISSING_KEY',
        level: null,
        goals: 1,
        trailingComma: true,
      }),
    );

    const h = harness({ root });
    seedString(h.db, 'QuestTitle_1ED8A', 'Forged in Fire');
    seedStatus(h.db, 'DS-P206-B-002', 'reviewed');

    const res = await request(h.app).get('/api/quests').expect(200);
    const body = res.body as QuestListResult;

    expect(body.quests).toHaveLength(2);
    expect(body.quests[0]).toEqual({
      quest_name: 'DS-P206-A-001',
      title: 'Forged in Fire',
      title_key: 'QuestTitle_1ED8A',
      title_source: 'resolved',
      level: 12,
      goal_count: 3,
      is_mainline: true,
      modified_at: modified.toISOString(),
      status: 'extracted',
    });
    // Legacy trailing comma parses; no entry_status row ⇒ the schema default.
    expect(body.quests[1]).toEqual({
      quest_name: 'DS-P206-B-002',
      title: 'QuestTitle_MISSING_KEY',
      title_key: 'QuestTitle_MISSING_KEY',
      title_source: 'rawKey',
      level: null,
      goal_count: 1,
      is_mainline: false,
      modified_at: expect.any(String),
      status: 'reviewed',
    });
    expect(body.skipped).toEqual([]);
  });

  it('falls back to the raw key with no string-table rows and to m_questName without m_questTitle', async () => {
    const root = corpusRoot();
    writeFile(
      root,
      'QuestTemplates/a.json',
      questText('NO-TABLE-001', { title: 'QuestTitle_DEADBEEF', goals: 0 }),
    );
    writeFile(root, 'QuestTemplates/b.json', questText('NO-TITLE-001', { title: null, goals: 8 }));

    const h = harness({ root });
    // A :memory: database with an empty string_table must degrade, never throw.
    const res = await request(h.app).get('/api/quests').expect(200);
    const body = res.body as QuestListResult;

    const byName = new Map(body.quests.map((row) => [row.quest_name, row]));
    expect(byName.get('NO-TABLE-001')).toMatchObject({
      title: 'QuestTitle_DEADBEEF',
      title_source: 'rawKey',
      goal_count: 0,
    });
    expect(byName.get('NO-TITLE-001')).toMatchObject({
      title: 'NO-TITLE-001',
      title_key: null,
      title_source: 'missing',
      goal_count: 8,
    });
  });

  it('shows a quest with no entry_status row and its summary equals GET /api/status/quests', async () => {
    const root = corpusRoot();
    for (const name of ['DS-P206-S-001', 'DS-P206-S-002', 'DS-P206-S-003']) {
      writeFile(root, `QuestTemplates/${name}.json`, questText(name, { goals: 2 }));
    }

    const h = harness({ root });
    // The real first-startup import (the boot path) populates entry_status.
    const imported = runFirstStartupImport({ db: h.db, spiraldbPath: root });
    expect(imported.imported).toBe(3);
    applyStatusChange(h.db, {
      objectType: 'quest',
      objectKey: 'DS-P206-S-001',
      status: 'reviewed',
    });
    applyStatusChange(h.db, {
      objectType: 'quest',
      objectKey: 'DS-P206-S-002',
      status: 'verified',
    });

    const list = await request(h.app).get('/api/quests').expect(200);
    const status = await request(h.app).get('/api/status/quests').expect(200);

    expect((list.body as QuestListResult).summary).toEqual({
      total: 3,
      extracted: 1,
      reviewed: 1,
      verified: 1,
    });
    expect((list.body as QuestListResult).summary).toEqual(status.body.summary);
    expect(listStatus(h.db, ['quest']).summary).toEqual(status.body.summary);
  });

  it('reports the corpus tally as the rows actually returned (a file added outside the tool shows as extracted)', async () => {
    const root = corpusRoot();
    writeFile(root, 'QuestTemplates/a.json', questText('DS-P206-E-001'));
    const h = harness({ root });
    runFirstStartupImport({ db: h.db, spiraldbPath: root });
    // A quest file the tool never imported — the one documented divergence.
    writeFile(root, 'QuestTemplates/b.json', questText('DS-P206-E-002'));

    const list = await request(h.app).get('/api/quests').expect(200);
    const status = await request(h.app).get('/api/status/quests').expect(200);

    expect((list.body as QuestListResult).summary).toEqual({
      total: 2,
      extracted: 2,
      reviewed: 0,
      verified: 0,
    });
    expect(status.body.summary).toEqual({ total: 1, extracted: 1, reviewed: 0, verified: 0 });
  });

  it('skips an unparsable file and still answers 200, reporting the file', async () => {
    const root = corpusRoot();
    writeFile(root, 'QuestTemplates/good.json', questText('DS-P206-G-001'));
    writeFile(root, 'QuestTemplates/broken.json', '{ "m_questName": "DS-P206-G-002", nope }\n');

    const h = harness({ root });
    const res = await request(h.app).get('/api/quests').expect(200);
    const body = res.body as QuestListResult;

    expect(body.quests.map((row) => row.quest_name)).toEqual(['DS-P206-G-001']);
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0].file).toBe(path.join('QuestTemplates', 'broken.json'));
    expect(body.skipped[0].message).not.toBe('');
  });

  it('is a 400 while spiraldb_path is not configured (rather than an empty list)', async () => {
    const root = corpusRoot();
    const h = harness({ root, spiraldbPath: '' });
    const res = await request(h.app).get('/api/quests').expect(400);
    expect((res.body as { error: string }).error).toContain('spiraldb_path');
  });

  it('serves the whole payload D12 requires a client-side search to filter', async () => {
    const root = corpusRoot();
    writeFile(root, 'QuestTemplates/a.json', questText('WC-UNICORN-MAIN-001', { goals: 4 }));
    writeFile(root, 'QuestTemplates/b.json', questText('DS-ACAD1-C01-001', { goals: 2 }));
    const h = harness({ root });

    const res = await request(h.app).get('/api/quests').expect(200);
    const quests = (res.body as QuestListResult).quests;
    // p2-08 wires the table; the contract is only that the loaded list contains the
    // substring and status data a client-side filter needs.
    expect(quests.filter((row) => row.quest_name.includes('UNICORN'))).toHaveLength(1);
    expect(quests.filter((row) => row.status === 'extracted')).toHaveLength(2);
  });
});

describe('GET /api/quests/:name — detail (ac2, D19)', () => {
  it('returns a legacy trailing-comma file fully parsed', async () => {
    const root = corpusRoot();
    const legacy = readFileSync(path.join(FIXTURES, 'quest_DS-ACAD-C01-003.json'), 'utf8');
    expect(() => JSON.parse(legacy)).toThrow();
    writeFile(root, 'QuestTemplates/questtemplates_DS-ACAD-C01-003.json', legacy);

    const h = harness({ root });
    const res = await request(h.app).get('/api/quests/DS-ACAD-C01-003').expect(200);

    const quest = res.body as Record<string, unknown>;
    expect(quest.m_questName).toBe('DS-ACAD-C01-003');
    expect(quest.m_questTitle).toBe('QuestTitle_1ED8A');
    expect(Array.isArray(quest.m_goals)).toBe(true);
    expect((quest.m_goals as unknown[]).length).toBeGreaterThan(0);
    expect(Object.keys(quest).length).toBe(
      Object.keys(JSON.parse(legacy.replace(/,\s*([}\]])/g, '$1')) as object).length,
    );
  });

  it('resolves an off-convention legacy filename through the content-keyed index', async () => {
    const root = corpusRoot();
    writeFile(
      root,
      'QuestTemplates/legacy_off_convention.json',
      questText('OFF-CONVENTION-1', { goals: 5, trailingComma: true }),
    );

    const h = harness({ root });
    const res = await request(h.app).get('/api/quests/OFF-CONVENTION-1').expect(200);
    expect((res.body as { m_questName: string }).m_questName).toBe('OFF-CONVENTION-1');
    expect((res.body as { m_goals: unknown[] }).m_goals).toHaveLength(5);
  });

  it('404s an unknown name with the {error} envelope', async () => {
    const h = harness();
    const res = await request(h.app).get('/api/quests/NOPE-1').expect(404);
    expect(res.body).toEqual({ error: 'Unknown quest "NOPE-1"' });
  });

  it('500s (not 200) when the resolved file is not a JSON object', async () => {
    const root = corpusRoot();
    const index = createSpiraldbIndex(root);
    writeFile(root, 'QuestTemplates/array.json', '[1, 2, 3]\n');
    index.rebuild();

    // The index keys on `m_questName`, so an array is unreachable by key; drive the
    // service's own guard directly with a stubbed index.
    const stub = { ...index, pathFor: () => path.join(root, 'QuestTemplates/array.json') };
    expect(() => readQuest({ index: stub as typeof index, name: 'X' })).toThrow(
      /is not a JSON object/,
    );
  });
});

describe('POST /api/quests — save pipeline (ac3)', () => {
  function recordingPipeline(
    overrides: Partial<SaveObjectResult> = {},
  ): SavePipeline & { requests: SaveObjectRequest[] } {
    const requests: SaveObjectRequest[] = [];
    const base: SaveObjectResult = {
      fileType: 'questtemplates',
      key: 'X',
      outcome: 'created',
      action: 'extract',
      filePath: '/repo/QuestTemplates/questtemplates_X.json',
      relativePath: 'QuestTemplates/questtemplates_X.json',
      metadataPath: '/repo/QuestMetadatas/questmetadata_X.json',
      metadataRelativePath: 'QuestMetadatas/questmetadata_X.json',
      metadataOutcome: 'created',
      commit: 'sha-1',
      branch: 'content/2026-09-26',
      commitMessage: 'spiraldb: extract quest X',
      status: null,
    };

    async function saveObject(request: SaveObjectRequest): Promise<SaveObjectResult> {
      requests.push(request);
      // Like the real pipeline: an explicit key wins, otherwise the family's key field.
      const key = request.key ?? String((request.data as { m_questName?: unknown }).m_questName);
      return { ...base, key, ...overrides };
    }

    return {
      root: '/repo',
      requests,
      saveObject,
      saveAll: async (list) => Promise.all(list.map(saveObject)),
    };
  }

  it('calls the pipeline with the quest, the extract action and the notes', async () => {
    const root = corpusRoot();
    const h = harness({ root });
    const index = createSpiraldbIndex(root);
    index.rebuild();
    const pipeline = recordingPipeline({ commit: 'deadbeef', outcome: 'created' });

    const quest = { m_questName: 'PIPE-1', m_questInfo: null, m_goals: [] };
    const result = await saveQuest({
      db: h.db,
      index,
      pipeline,
      body: { quest, notes: 'from the packet capture' },
    });

    expect(pipeline.requests).toEqual([
      {
        fileType: 'questtemplates',
        data: quest,
        action: 'extract',
        notes: 'from the packet capture',
      },
    ]);
    expect(result).toMatchObject({
      quest_name: 'PIPE-1',
      outcome: 'created',
      action: 'extract',
      commit: 'deadbeef',
      warnings: [],
    });
  });

  it('maps an existing key to action update', async () => {
    const root = corpusRoot();
    const h = harness({ root });
    const index = createSpiraldbIndex(root);
    index.rebuild();
    const pipeline = recordingPipeline({ outcome: 'updated', action: 'update' });

    const result = await saveQuest({
      db: h.db,
      index,
      pipeline,
      body: { quest: { m_questName: 'PIPE-1' } },
    });
    expect(result.outcome).toBe('updated');
    expect(result.action).toBe('update');
  });

  it.each([
    ['a non-object body', 'nope'],
    ['a body without quest', {}],
    ['a quest that is not an object', { quest: 'nope' }],
    ['a quest with no m_questName', { quest: { m_questLevel: 1 } }],
    ['a quest with an empty m_questName', { quest: { m_questName: '' } }],
    ['non-string notes', { quest: { m_questName: 'X' }, notes: 5 }],
  ])('400s %s before the pipeline is reached', async (_label, body) => {
    const root = corpusRoot();
    const h = harness({ root });
    const index = createSpiraldbIndex(root);
    index.rebuild();
    const pipeline = recordingPipeline();

    await expect(saveQuest({ db: h.db, index, pipeline, body })).rejects.toBeInstanceOf(
      QuestRequestError,
    );
    expect(pipeline.requests).toEqual([]);

    const res = await request(h.app)
      .post('/api/quests')
      .send(body as object)
      .expect(400);
    expect((res.body as { error: string }).error).not.toBe('');
  });

  it('creates the file, the metadata, the commit and the extracted row (real pipeline)', async () => {
    const repo = gitRepo();
    const quest = {
      m_questName: 'DS-P206-NEW-001',
      m_questInfo: null,
      m_goals: [{ m_goalName: '1_A' }],
    };

    const h = harness({ root: repo.dir, spiraldbPath: repo.dir });
    const res = await request(h.app)
      .post('/api/quests')
      .send({ quest, notes: 'Imported from packet capture session.json' })
      .expect(200);

    expect(res.body).toMatchObject({
      quest_name: 'DS-P206-NEW-001',
      outcome: 'created',
      action: 'extract',
      commit_message:
        'spiraldb: extract quest DS-P206-NEW-001\n\nImported from packet capture session.json',
      metadata_outcome: 'created',
      warnings: [],
    });
    expect((res.body as { commit: string }).commit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(repoFileExists(repo, 'QuestTemplates/questtemplates_DS-P206-NEW-001.json')).toBe(true);
    expect(repoFileExists(repo, 'QuestMetadatas/questmetadata_DS-P206-NEW-001.json')).toBe(true);
    expect(commitSubjects(repo)[0]).toBe('spiraldb: extract quest DS-P206-NEW-001');
    expect((res.body as { status: { status: string } }).status.status).toBe('extracted');
  });

  it('round-trips GET → POST unmodified with no field loss (explicit nulls preserved)', async () => {
    const repo = gitRepo();
    const legacy = readFileSync(path.join(FIXTURES, 'quest_DS-ACAD-C01-003.json'), 'utf8');
    writeFile(repo.dir, 'QuestTemplates/legacy_off_convention.json', legacy);
    repo.git(['add', '.']);
    repo.git(['commit', '-m', 'legacy quest corpus']);

    const h = harness({ root: repo.dir, spiraldbPath: repo.dir });
    const detail = await request(h.app).get('/api/quests/DS-ACAD-C01-003').expect(200);
    const before = detail.body as Record<string, unknown>;

    const saved = await request(h.app).post('/api/quests').send({ quest: before }).expect(200);
    expect(saved.body).toMatchObject({
      quest_name: 'DS-ACAD-C01-003',
      outcome: 'updated',
      action: 'update',
    });

    // The update wrote back to the ORIGINAL path — never a convention filename (D19).
    expect(repoFileExists(repo, 'QuestTemplates/legacy_off_convention.json')).toBe(true);
    expect(repoFileExists(repo, 'QuestTemplates/questtemplates_DS-ACAD-C01-003.json')).toBe(false);

    const after = JSON.parse(
      readRepoFile(repo, 'QuestTemplates/legacy_off_convention.json'),
    ) as Record<string, unknown>;
    expect(after).toEqual(before);
    expect(after.m_questInfo).toBeNull();
    expect(Object.keys(after)).toEqual(Object.keys(before));
    // Formatting normalisation only: the trailing comma is gone and JSON.parse
    // now succeeds on the committed file.
    expect(readRepoFile(repo, 'QuestTemplates/legacy_off_convention.json')).not.toMatch(
      /,\s*[}\]]/,
    );
  });

  it('never resets a non-extracted status on a re-save', async () => {
    const repo = gitRepo();
    writeFile(
      repo.dir,
      'QuestTemplates/questtemplates_DS-P206-V-001.json',
      questText('DS-P206-V-001'),
    );
    repo.git(['add', '.']);
    repo.git(['commit', '-m', 'corpus']);

    const h = harness({ root: repo.dir, spiraldbPath: repo.dir });
    seedStatus(h.db, 'DS-P206-V-001', 'verified');

    const res = await request(h.app)
      .post('/api/quests')
      .send({ quest: JSON.parse(questText('DS-P206-V-001')) as object })
      .expect(200);

    expect((res.body as { status: { status: string } }).status.status).toBe('verified');
    const row = h.db
      .prepare(
        "SELECT status FROM entry_status WHERE object_type='quest' AND object_key='DS-P206-V-001'",
      )
      .get() as { status: string };
    expect(row.status).toBe('verified');
  });

  it('409s a dirty SpiralDB tree (D14) and writes nothing', async () => {
    const repo = gitRepo();
    writeFile(
      repo.dir,
      'QuestTemplates/questtemplates_DS-P206-D-001.json',
      questText('DS-P206-D-001'),
    );
    repo.git(['add', '.']);
    repo.git(['commit', '-m', 'corpus']);
    // Dirty it: an uncommitted edit the pipeline must refuse to work around.
    writeFile(repo.dir, 'README.md', 'dirty\n');

    const h = harness({ root: repo.dir, spiraldbPath: repo.dir });
    const res = await request(h.app)
      .post('/api/quests')
      .send({ quest: { m_questName: 'DS-P206-D-002' } })
      .expect(409);

    expect((res.body as { error: string }).error).toContain('uncommitted changes');
    expect(repoFileExists(repo, 'QuestTemplates/questtemplates_DS-P206-D-002.json')).toBe(false);
    expect(repo.git(['branch', '--list', 'content/*']).trim()).toBe('');
  });

  it("500s a pipeline failure that is not the caller's body (empty user_name, D38)", async () => {
    const repo = gitRepo();
    const h = harness({ root: repo.dir, spiraldbPath: repo.dir, user: '' });
    // The route logs the thrown value for a 500 (like the app-level middleware).
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await request(h.app)
        .post('/api/quests')
        .send({ quest: { m_questName: 'DS-P206-U-001' } })
        .expect(500);
      expect((res.body as { error: string }).error).toContain('user_name');
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  it('reports the D48(d) duplicate-Name ambiguity and still saves deterministically', async () => {
    const repo = gitRepo();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      writeFile(repo.dir, 'QuestTemplates/questtemplates_DUP-1.json', questText('DUP-1'));
      writeFile(
        repo.dir,
        'QuestMetadatas/a_legacy.json',
        `${JSON.stringify({ Name: 'DUP-1', CreatedAt: 'x' }, null, 2)}\n`,
      );
      writeFile(
        repo.dir,
        'QuestMetadatas/b_legacy.json',
        `${JSON.stringify({ Name: 'DUP-1', CreatedAt: 'y' }, null, 2)}\n`,
      );
      repo.git(['add', '.']);
      repo.git(['commit', '-m', 'corpus with a duplicate metadata Name']);

      const h = harness({ root: repo.dir, spiraldbPath: repo.dir });
      const res = await request(h.app)
        .post('/api/quests')
        .send({ quest: JSON.parse(questText('DUP-1')) as object })
        .expect(200);

      const warnings = (res.body as { warnings: string[] }).warnings;
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('2 files whose "Name" is "DUP-1"');
      expect(warnings[0]).toContain(path.join('QuestMetadatas', 'a_legacy.json'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('DUP-1'));

      // Deterministic: the first file in name order is the one refreshed.
      expect((res.body as { metadata_outcome: string }).metadata_outcome).toBe('updated');
      expect(readRepoFile(repo, 'QuestMetadatas/a_legacy.json')).toContain(USER);
      expect(readRepoFile(repo, 'QuestMetadatas/b_legacy.json')).not.toContain(USER);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('lazy mount (decision D32)', () => {
  it('control: a quests request really goes through the lazy mount', async () => {
    // Proves `/quests` is mounted in the registry at all, and that the mount is the
    // lazy one: `getDb()` is reached on the first request, never at import time.
    vi.resetModules();
    const dbModule = await import('@server/db');
    const getDbSpy = vi.spyOn(dbModule, 'getDb').mockImplementation(() => {
      throw new Error('getDb reached');
    });
    const { app } = await import('@server/app');

    const res = await request(app).get('/api/quests');

    expect(getDbSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'getDb reached' });

    getDbSpy.mockRestore();
  });
});

describe('corpus detail collection (task 2.5 extension of buildQuestRows)', () => {
  it('counts goals across the array and $values spellings, defaulting to 0', () => {
    expect(countQuestGoals({ m_goals: [{}, {}] })).toBe(2);
    expect(countQuestGoals({ m_goals: { $values: [{}, {}, {}] } })).toBe(3);
    expect(countQuestGoals({ m_goals: [] })).toBe(0);
    expect(countQuestGoals({ m_goals: null })).toBe(0);
    expect(countQuestGoals({ m_goals: {} })).toBe(0);
    expect(countQuestGoals({})).toBe(0);
  });

  it('adds goalCount/modifiedAt/sourceFile only when collectDetails is on', async () => {
    const root = corpusRoot();
    const file = writeFile(root, 'q.json', questText('DETAIL-1', { goals: 4 }));
    const mtime = new Date('2026-01-02T03:04:05.000Z');
    utimesSync(file, mtime, mtime);

    const plain = await buildQuestRows({ questTemplatesDir: root });
    expect(plain.rows[0]).not.toHaveProperty('goalCount');
    expect(plain.rows[0]).not.toHaveProperty('modifiedAt');

    const detailed = await buildQuestRows({ questTemplatesDir: root, collectDetails: true });
    expect(detailed.rows[0]).toMatchObject({
      quest_name: 'DETAIL-1',
      goalCount: 4,
      modifiedAt: mtime.toISOString(),
      sourceFile: file,
    });
  });

  it('listQuests reads a corpus directory and joins status rows directly', async () => {
    const root = corpusRoot();
    writeFile(root, 'QuestTemplates/q1.json', questText('DIRECT-1', { goals: 2 }));
    writeFile(root, 'QuestTemplates/q2.json', questText('DIRECT-2', { goals: 1 }));
    const db = memoryDb();
    seedStatus(db, 'DIRECT-2', 'reviewed');

    const result = await listQuests({ db, spiraldbPath: root });
    expect(result.quests.map((row) => [row.quest_name, row.status])).toEqual([
      ['DIRECT-1', 'extracted'],
      ['DIRECT-2', 'reviewed'],
    ]);
    expect(result.summary).toEqual({ total: 2, extracted: 1, reviewed: 1, verified: 0 });
  });
});
