import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { MEMORY_DB, openDb, type Db } from '@server/db';
import { createSyncRouter } from '@server/routes/sync';
import type { RunSyncResult, SyncRunner } from '@server/services/sync/execute';

/**
 * Task 1.4g — the three sync endpoints (docs/spec-api.md L235-287).
 *
 * Follows the lazy-mount pattern's test shape: a fresh app mounts the router
 * under `/api/sync` (exactly where `routes/index.ts` puts it) with an injected
 * orchestrator, against a `:memory:` database — importing `app.ts` would open
 * the real `data/spiraldb-ui.db` on the first request.
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

const SUCCESS: RunSyncResult = {
  status: 'success',
  revision: 'V_r806919.Wizard_1_610',
  counts: {
    items: 12,
    spells: 3,
    npcs: 4,
    quests: 5,
    zones: 6,
    drop_tables: 7,
    string_table: 8,
  },
  deduplicated: { items: 0, spells: 0, npcs: 0 },
  durationMs: 42,
  timestamp: '2026-09-25T15:30:00Z',
  reused: false,
  treeDir: '/tmp/x',
  timings: { unpackMs: 17, scanMs: 2, writeMs: 3 },
};

function setup(runner?: SyncRunner): { db: Db; app: Express } {
  const db = memoryDb();
  const app = express();
  app.use(express.json());
  app.use(
    '/api/sync',
    createSyncRouter({
      db,
      runSync: runner ?? (async () => SUCCESS),
    }),
  );
  return { db, app };
}

describe('POST /api/sync', () => {
  it('answers exactly the spec shape on success (no extra synced keys)', async () => {
    const { app } = setup();

    const res = await request(app).post('/api/sync').send();

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(Object.keys(res.body).sort()).toEqual(['status', 'synced', 'timestamp']);
    expect(res.body.status).toBe('success');
    expect(res.body.timestamp).toBe('2026-09-25T15:30:00Z');
    expect(Object.keys(res.body.synced).sort()).toEqual([
      'items',
      'npcs',
      'quests',
      'spells',
      'zones',
    ]);
    expect(res.body.synced).toEqual({ items: 12, spells: 3, npcs: 4, quests: 5, zones: 6 });
  });

  it('passes the connection and treeDir through to the orchestrator', async () => {
    const { db } = setup();
    const seen: unknown[] = [];
    const app = express();
    app.use(express.json());
    app.use(
      '/api/sync',
      createSyncRouter({
        db,
        runSync: async (options) => {
          seen.push(options);
          return SUCCESS;
        },
      }),
    );

    await request(app).post('/api/sync').send();

    expect(seen).toHaveLength(1);
    const options = seen[0] as { db: Db; treeDir?: string };
    expect(options.db).toBe(db);
    expect(options.treeDir).toBeUndefined();
  });

  it('answers 500 {"error"} when the orchestrator reports a failed run', async () => {
    const { db } = setup();
    const app = express();
    app.use(express.json());
    app.use(
      '/api/sync',
      createSyncRouter({
        db,
        runSync: async () => ({
          ...SUCCESS,
          status: 'failed',
          errorMessage: 'imcodec wad unpack failed',
        }),
      }),
    );

    const res = await request(app).post('/api/sync').send();

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'imcodec wad unpack failed' });
  });

  it('answers 500 {"error"} when the orchestrator throws', async () => {
    const { app } = setup(async () => {
      throw new Error('boom');
    });

    const res = await request(app).post('/api/sync').send();

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});

describe('GET /api/sync/status', () => {
  it('reports a sensible first-run state with no history', async () => {
    const { app } = setup();

    const res = await request(app).get('/api/sync/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ last_sync: null, revision: null, status: 'never' });
  });

  it('reports the most recent row, including a failure', async () => {
    const { db, app } = setup();
    db.prepare(`INSERT INTO sync_history (sync_timestamp, revision, status) VALUES (?, ?, ?)`).run(
      '2026-09-25T15:30:00Z',
      'V_r806919.Wizard_1_610',
      'success',
    );
    db.prepare(
      `INSERT INTO sync_history (sync_timestamp, revision, status, error_message) VALUES (?, ?, ?, ?)`,
    ).run('2026-09-26T09:00:00Z', 'V_r806919.Wizard_1_610', 'failed', 'unpack failed');

    const res = await request(app).get('/api/sync/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      last_sync: '2026-09-26T09:00:00Z',
      revision: 'V_r806919.Wizard_1_610',
      status: 'failed',
    });
  });
});

describe('GET /api/sync/history', () => {
  it('returns an empty array with no history', async () => {
    const { app } = setup();

    const res = await request(app).get('/api/sync/history');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ history: [] });
  });

  it('returns every sync_history column, newest first', async () => {
    const { db, app } = setup();
    db.prepare(
      `INSERT INTO sync_history
         (sync_timestamp, revision, items_count, spells_count, npcs_count, quests_count, zones_count, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      '2026-09-25T15:30:00Z',
      'V_r806919.Wizard_1_610',
      15234,
      8456,
      3210,
      1847,
      432,
      'success',
      null,
    );
    db.prepare(
      `INSERT INTO sync_history (sync_timestamp, revision, status, error_message)
       VALUES (?, ?, ?, ?)`,
    ).run('2026-09-26T09:00:00Z', 'V_r806919.Wizard_1_610', 'failed', 'unpack failed');

    const res = await request(app).get('/api/sync/history');

    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(2);
    expect(res.body.history[0]).toEqual({
      id: 2,
      sync_timestamp: '2026-09-26T09:00:00Z',
      revision: 'V_r806919.Wizard_1_610',
      items_count: null,
      spells_count: null,
      npcs_count: null,
      quests_count: null,
      zones_count: null,
      status: 'failed',
      error_message: 'unpack failed',
    });
    expect(res.body.history[1]).toMatchObject({
      items_count: 15234,
      spells_count: 8456,
      npcs_count: 3210,
      quests_count: 1847,
      zones_count: 432,
      status: 'success',
      error_message: null,
    });
    expect(Object.keys(res.body.history[1]).sort()).toEqual([
      'error_message',
      'id',
      'items_count',
      'npcs_count',
      'quests_count',
      'revision',
      'spells_count',
      'status',
      'sync_timestamp',
      'zones_count',
    ]);
  });
});
