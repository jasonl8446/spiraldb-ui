import fs from 'node:fs';
import path from 'node:path';

import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_AURORIUM_PATH,
  DEFAULT_IMCODEC_PATH,
  DEFAULT_SPIRALDB_PATH,
  MEMORY_DB,
  openDb,
  readSettings,
  resolveRepoRoot,
  seedSettings,
  type Db,
} from '@server/db';
import {
  createSettingsRouter,
  validateSettingsPatch,
  type PathProbe,
} from '@server/routes/settings';

/**
 * Task 1.3 acceptance: `GET /api/settings` returns the five flat string keys
 * (docs/spec-api.md L291-321), `PUT /api/settings` persists a partial update and
 * answers with the full updated map, and an invalid body is rejected with a 400
 * carrying an actionable message — without persisting any of its good keys.
 *
 * Every database here is `:memory:` or a throwaway file under `data/` (gitignored);
 * the real `data/spiraldb-ui.db` is never opened (decision D17).
 */

/** Independently re-typed from docs/spec-api.md — deliberately not imported from db.ts. */
const EXPECTED_SETTINGS_KEYS = [
  'aurorium_path',
  'git_branch',
  'imcodec_path',
  'spiraldb_path',
  'user_name',
];

/** The allowed-keys list inside a 400 message, in the spec's own key order (L293-321). */
const ALLOWED_KEYS_MESSAGE = 'aurorium_path, imcodec_path, user_name, spiraldb_path, git_branch';

/** Fixed local timestamp: 26 Sep 2026 (month is 0-based). */
const FIXED_NOW = new Date(2026, 8, 26, 10, 30, 0);

/** `env: {}` keeps `NODE_ENV` out of the precedence chain, so the spec defaults win. */
const SEED_OPTIONS = { env: {}, now: FIXED_NOW, repoRoot: '/repo' };

const SEEDED = {
  aurorium_path: DEFAULT_AURORIUM_PATH,
  imcodec_path: DEFAULT_IMCODEC_PATH,
  user_name: '',
  spiraldb_path: DEFAULT_SPIRALDB_PATH,
  git_branch: 'content/2026-09-26',
};

const openConnections: Db[] = [];
const tempDirs: string[] = [];

/** Scratch root inside the workspace (`data/` is gitignored) — never the real DB. */
const SCRATCH_ROOT = path.join(resolveRepoRoot(), 'data', '__test-scratch__');

/** Real directory/file fixtures, so the path-kind checks run against a real disk. */
function makeTempDir(): string {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  const dir = fs.mkdtempSync(path.join(SCRATCH_ROOT, 'settings-'));
  tempDirs.push(dir);
  return dir;
}

function makeTempFile(name = 'imcodec'): string {
  const file = path.join(makeTempDir(), name);
  fs.writeFileSync(file, '#!/bin/sh\n');
  return file;
}

/** A fresh seeded database plus the `/api/settings` app that uses it (no global registry). */
function setup(file: string = MEMORY_DB): { db: Db; app: Express } {
  const db = openDb({ file });
  openConnections.push(db);
  seedSettings(db, SEED_OPTIONS);

  const app = express();
  app.use(express.json());
  // Same mount as the registry (`apiRouter.use('/settings', ...)` under `/api`
  // in routes/index.ts), so the router's own `'/'` paths are what the tests hit.
  app.use('/api/settings', createSettingsRouter({ db }));
  return { db, app };
}

afterEach(() => {
  while (openConnections.length > 0) {
    openConnections.pop()?.close();
  }
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe('GET /api/settings', () => {
  it('returns exactly the five spec keys and the seeded values', async () => {
    const { app } = setup();

    const res = await request(app).get('/api/settings');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(Object.keys(res.body).sort()).toEqual(EXPECTED_SETTINGS_KEYS);
    expect(res.body).toEqual(SEEDED);
    expect(Object.values(res.body).every((value) => typeof value === 'string')).toBe(true);
  });
});

describe('PUT /api/settings', () => {
  it('persists a partial update, answers the full map, and GET reflects it', async () => {
    const { db, app } = setup();

    const put = await request(app).put('/api/settings').send({ user_name: 'jason' });

    expect(put.status).toBe(200);
    expect(put.body).toEqual({ ...SEEDED, user_name: 'jason' });
    expect(readSettings(db).user_name).toBe('jason');

    const get = await request(app).get('/api/settings');
    expect(get.status).toBe(200);
    expect(get.body.user_name).toBe('jason');
    expect(get.body.aurorium_path).toBe(DEFAULT_AURORIUM_PATH);
  });

  it('persists a full update of all five keys', async () => {
    const { db, app } = setup();
    const aurorium = makeTempDir();
    const spiraldb = makeTempDir();
    const imcodec = makeTempFile();
    const body = {
      aurorium_path: aurorium,
      imcodec_path: imcodec,
      user_name: 'jason',
      spiraldb_path: spiraldb,
      git_branch: 'content/2099-01-01',
    };

    const res = await request(app).put('/api/settings').send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(body);
    expect(readSettings(db)).toEqual(body);
  });

  it('accepts an empty user_name as the "not set yet" state', async () => {
    const { db, app } = setup();

    await request(app).put('/api/settings').send({ user_name: 'jason' });
    const res = await request(app).put('/api/settings').send({ user_name: '' });

    expect(res.status).toBe(200);
    expect(res.body.user_name).toBe('');
    expect(readSettings(db).user_name).toBe('');
  });

  it('treats an empty body {} as a 200 no-op (lead decision: no keys, no writes)', async () => {
    const { db, app } = setup();

    const res = await request(app)
      .put('/api/settings')
      .set('Content-Type', 'application/json')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual(SEEDED);
    expect(readSettings(db)).toEqual(SEEDED);
  });

  it('rejects an unknown key with 400 naming it and listing the allowed keys', async () => {
    const { db, app } = setup();

    const res = await request(app).put('/api/settings').send({ nope: 'x' });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body.error).toContain('nope');
    expect(res.body.error).toContain(`Allowed keys: ${ALLOWED_KEYS_MESSAGE}`);
    expect(readSettings(db)).toEqual(SEEDED);
  });

  it('rejects a nonexistent directory with 400, echoing the value, and persists nothing', async () => {
    const { db, app } = setup();
    const missing = path.join(makeTempDir(), 'gone');

    const res = await request(app)
      .put('/api/settings')
      .send({ aurorium_path: missing, user_name: 'jason' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(`aurorium_path "${missing}" is not an existing directory`);
    // Atomic: the valid user_name in the same body was NOT written.
    expect(readSettings(db)).toEqual(SEEDED);
  });

  it('rejects a spiraldb_path that points at a file', async () => {
    const { db, app } = setup();
    const file = makeTempFile('not-a-repo');

    const res = await request(app).put('/api/settings').send({ spiraldb_path: file });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(`spiraldb_path "${file}" is not an existing directory`);
    expect(readSettings(db)).toEqual(SEEDED);
  });

  it('rejects an imcodec_path that is a directory (it must be the executable file)', async () => {
    const { db, app } = setup();
    const dir = makeTempDir();

    const res = await request(app).put('/api/settings').send({ imcodec_path: dir });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(`imcodec_path "${dir}" is not an existing file`);
    expect(readSettings(db)).toEqual(SEEDED);
  });

  it('rejects an imcodec_path that does not exist', async () => {
    const { db, app } = setup();
    const missing = path.join(makeTempDir(), 'imcodec');

    const res = await request(app).put('/api/settings').send({ imcodec_path: missing });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(`imcodec_path "${missing}" is not an existing file`);
    expect(readSettings(db)).toEqual(SEEDED);
  });

  it.each([
    ['number', 42],
    ['null', null],
    ['boolean', true],
    ['array', ['jason']],
    ['object', { nested: true }],
  ])('rejects a %s value with 400 naming the key and persists nothing', async (_label, value) => {
    const { db, app } = setup();

    const res = await request(app).put('/api/settings').send({ user_name: value });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('user_name');
    expect(res.body.error).toContain('expected a string');
    expect(readSettings(db)).toEqual(SEEDED);
  });

  it('rejects a non-object body with 400', async () => {
    const { db, app } = setup();

    const res = await request(app)
      .put('/api/settings')
      .set('Content-Type', 'application/json')
      .send('["user_name"]');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('JSON object');
    expect(readSettings(db)).toEqual(SEEDED);
  });

  it('survives a close/reopen of the database file without re-seeding (D31c)', async () => {
    const file = path.join(makeTempDir(), 'restart.db');
    const { db, app } = setup(file);
    const aurorium = makeTempDir();

    expect((await request(app).put('/api/settings').send({ aurorium_path: aurorium })).status).toBe(
      200,
    );
    db.close();
    openConnections.pop();

    const reopened = openDb({ file });
    openConnections.push(reopened);
    const secondRun = seedSettings(reopened, SEED_OPTIONS);

    expect(secondRun.seeded).toBe(false);
    expect(readSettings(reopened).aurorium_path).toBe(aurorium);
    expect(readSettings(reopened).user_name).toBe('');
  });
});

describe('validateSettingsPatch (pure)', () => {
  /** Fake filesystem: only `/exists` exists, and `/exists/dir` is the only directory. */
  const fakeProbe: PathProbe = {
    existsSync: (candidate) => candidate.startsWith('/exists'),
    isDirectory: (candidate) => candidate === '/exists/dir',
  };

  it('accepts an empty patch and free-text keys', () => {
    expect(validateSettingsPatch({}, fakeProbe)).toBeUndefined();
    expect(validateSettingsPatch({ user_name: '', git_branch: '' }, fakeProbe)).toBeUndefined();
  });

  it('never consults the filesystem for free-text keys', () => {
    const probe = { existsSync: vi.fn(() => true), isDirectory: vi.fn(() => true) };

    expect(
      validateSettingsPatch({ user_name: 'jason', git_branch: 'main' }, probe),
    ).toBeUndefined();
    expect(probe.existsSync).not.toHaveBeenCalled();
    expect(probe.isDirectory).not.toHaveBeenCalled();
  });

  it('names every unknown key and lists the allowed ones', () => {
    expect(validateSettingsPatch({ nope: 'x', other: 'y' }, fakeProbe)).toBe(
      `Unknown settings keys: nope, other. Allowed keys: ${ALLOWED_KEYS_MESSAGE}`,
    );
  });

  it('names the key of a non-string value', () => {
    expect(validateSettingsPatch({ user_name: 42 }, fakeProbe)).toBe(
      'Invalid value for user_name: expected a string but received number',
    );
    expect(validateSettingsPatch({ user_name: null }, fakeProbe)).toBe(
      'Invalid value for user_name: expected a string but received null',
    );
    expect(validateSettingsPatch({ git_branch: [] }, fakeProbe)).toBe(
      'Invalid value for git_branch: expected a string but received array',
    );
  });

  it.each([[null], [[]], ['{"user_name":"jason"}'], [42]])(
    'rejects a non-object patch (%s)',
    (patch) => {
      expect(validateSettingsPatch(patch, fakeProbe)).toContain('JSON object');
    },
  );

  it('checks the expected kind of each path key', () => {
    expect(validateSettingsPatch({ aurorium_path: '/exists/dir' }, fakeProbe)).toBeUndefined();
    expect(validateSettingsPatch({ spiraldb_path: '/exists/dir' }, fakeProbe)).toBeUndefined();
    expect(validateSettingsPatch({ imcodec_path: '/exists/file' }, fakeProbe)).toBeUndefined();

    expect(validateSettingsPatch({ aurorium_path: '/exists/file' }, fakeProbe)).toBe(
      'aurorium_path "/exists/file" is not an existing directory',
    );
    expect(validateSettingsPatch({ imcodec_path: '/exists/dir' }, fakeProbe)).toBe(
      'imcodec_path "/exists/dir" is not an existing file',
    );
    expect(validateSettingsPatch({ spiraldb_path: '/missing' }, fakeProbe)).toBe(
      'spiraldb_path "/missing" is not an existing directory',
    );
  });

  it('reports unknown keys before path problems (deterministic precedence)', () => {
    expect(validateSettingsPatch({ nope: 'x', aurorium_path: '/missing' }, fakeProbe)).toContain(
      'Unknown settings key',
    );
  });
});
