import fs from 'node:fs';

import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NOT_FOUND_MESSAGE } from '@shared/index';
import { MEMORY_DB, openDb, type Db } from '@server/db';
import { createDashboardRouter } from '@server/routes/dashboard';
import { createStatusRouter } from '@server/routes/status';
import type { ImportResult } from '@server/services/import';
import {
  applyStatusChange,
  percentVerified,
  STATUS_ALL,
  STATUS_OBJECT_TYPES,
  STATUS_REQUEST_TYPES,
  STATUS_ROUTE_BY_TYPE,
  STATUS_TYPE_BY_ROUTE,
  STATUS_TYPES,
  STATUS_VALUES,
  type StatusObjectType,
} from '@server/services/status';

/**
 * Task 1.6 acceptance for the status lifecycle + dashboard (docs/spec-api.md
 * L48-164, plan task 1.6), including the D4 mapping in both directions, the
 * exact response shapes, the pre-filter `summary` semantics, D15's
 * any-direction transitions and their audit trail, and the dashboard rounding.
 *
 * Every database here is `:memory:` — the real `data/spiraldb-ui.db` is never
 * opened (decision D17); the last suite asserts exactly that for a bare import.
 */

/** The D4 mapping, re-typed by hand from the lead's decision — not derived. */
const EXPECTED_TYPE_BY_ROUTE: Record<string, StatusObjectType> = {
  quests: 'quest',
  drop_tables: 'drop_table',
  npc_inventories: 'npc_inventory',
  npc_spell_inventories: 'npc_spell_inventory',
  creature_spellbooks: 'creature_spellbook',
  npc_drop_tables: 'npc_drop_table',
  treasure_card_inventories: 'treasure_card_inventory',
  zone_transfers: 'zone_transfer',
};

/** The valid-types list inside the unknown-type 404 message, in spec order. */
const VALID_TYPES_MESSAGE = [...STATUS_TYPES, STATUS_ALL].join(', ');

const ENTRY_KEYS = [
  'object_type',
  'object_key',
  'status',
  'extracted_at',
  'reviewed_at',
  'verified_at',
  'latest_notes',
];

const HISTORY_KEYS = ['old_status', 'new_status', 'notes', 'changed_by', 'changed_at'];
const SUMMARY_KEYS = ['total', 'extracted', 'reviewed', 'verified'];

const OPEN: Db[] = [];

afterEach(() => {
  while (OPEN.length > 0) {
    OPEN.pop()?.close();
  }
});

/** A `:memory:` database with the owner's name seeded (the `changed_by` default). */
function memoryDb(userName = 'jason'): Db {
  const db = openDb({ file: MEMORY_DB });
  OPEN.push(db);
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('user_name', userName);
  return db;
}

interface EntrySeed {
  objectType: StatusObjectType;
  objectKey: string;
  status?: string;
  extractedAt?: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  verifiedAt?: string | null;
  verifiedBy?: string | null;
}

function insertEntries(db: Db, seeds: EntrySeed[]): void {
  const insert = db.prepare(
    `INSERT INTO entry_status
       (object_type, object_key, status, extracted_at, reviewed_at, reviewed_by, verified_at, verified_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const seed of seeds) {
    insert.run(
      seed.objectType,
      seed.objectKey,
      seed.status ?? 'extracted',
      seed.extractedAt ?? '2026-01-01T00:00:00.000Z',
      seed.reviewedAt ?? null,
      seed.reviewedBy ?? null,
      seed.verifiedAt ?? null,
      seed.verifiedBy ?? null,
    );
  }
}

/** One entry per tracked type, plus a second quest, so `all` is observable. */
function seedCorpus(db: Db): void {
  insertEntries(db, [
    { objectType: 'quest', objectKey: 'DS-ACAD-C01-001', status: 'extracted' },
    {
      objectType: 'quest',
      objectKey: 'DS-ACAD-C01-002',
      status: 'reviewed',
      reviewedAt: '2026-02-02T00:00:00.000Z',
      reviewedBy: 'jason',
    },
    {
      objectType: 'quest',
      objectKey: 'DS-ACAD-C01-003',
      status: 'verified',
      reviewedAt: '2026-02-02T00:00:00.000Z',
      reviewedBy: 'jason',
      verifiedAt: '2026-03-03T00:00:00.000Z',
      verifiedBy: 'jason',
    },
    { objectType: 'drop_table', objectKey: 'DS-ACAD1-C01-001', status: 'extracted' },
    { objectType: 'npc_inventory', objectKey: '164320', status: 'reviewed' },
    { objectType: 'npc_spell_inventory', objectKey: '38226', status: 'verified' },
    { objectType: 'creature_spellbook', objectKey: 'Mdeck-D-R2', status: 'extracted' },
    { objectType: 'treasure_card_inventory', objectKey: '38214', status: 'extracted' },
    { objectType: 'zone_transfer', objectKey: 'WizardCity/WC_Hub', status: 'reviewed' },
  ]);
}

/** The router mounted exactly where `routes/index.ts` puts it. */
function setup(seed: (db: Db) => void = () => {}, readLastImport?: () => ImportResult | null) {
  const db = memoryDb();
  seed(db);

  const app: Express = express();
  app.use(express.json());
  app.use(
    '/api/status',
    readLastImport === undefined
      ? createStatusRouter({ db })
      : createStatusRouter({ db, readLastImport }),
  );
  app.use('/api/dashboard', createDashboardRouter({ db }));
  // The app-level JSON 404 for unmatched /api paths, as in app.ts.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: NOT_FOUND_MESSAGE });
  });

  return { db, app };
}

function insertHistory(
  db: Db,
  objectType: StatusObjectType,
  objectKey: string,
  rows: Array<{ old: string | null; next: string; notes: string | null; by: string | null }>,
): void {
  const entry = db
    .prepare('SELECT id FROM entry_status WHERE object_type = ? AND object_key = ?')
    .get(objectType, objectKey) as { id: number };
  const insert = db.prepare(
    `INSERT INTO status_history (entry_status_id, old_status, new_status, notes, changed_by)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const row of rows) {
    insert.run(entry.id, row.old, row.next, row.notes, row.by);
  }
}

describe('D4 type mapping', () => {
  it('maps every plural route to its singular column and back, by hand-checked values', () => {
    expect(STATUS_TYPES).toHaveLength(8);
    expect(Object.keys(STATUS_TYPE_BY_ROUTE)).toEqual([...STATUS_TYPES]);

    for (const route of STATUS_TYPES) {
      expect(STATUS_TYPE_BY_ROUTE[route]).toBe(EXPECTED_TYPE_BY_ROUTE[route]);
      expect(STATUS_ROUTE_BY_TYPE[STATUS_TYPE_BY_ROUTE[route]]).toBe(route);
    }

    // The inverse is a total bijection over the eight singular values.
    expect(STATUS_OBJECT_TYPES).toHaveLength(8);
    expect([...STATUS_OBJECT_TYPES].sort()).toEqual(
      [...Object.values(EXPECTED_TYPE_BY_ROUTE)].sort(),
    );
    for (const objectType of STATUS_OBJECT_TYPES) {
      expect(STATUS_ROUTE_BY_TYPE[objectType]).toBe(
        Object.keys(EXPECTED_TYPE_BY_ROUTE).find(
          (route) => EXPECTED_TYPE_BY_ROUTE[route] === objectType,
        ),
      );
    }
  });

  it('accepts the eight route types plus the `all` aggregate, and nothing else', () => {
    expect([...STATUS_REQUEST_TYPES]).toEqual([...STATUS_TYPES, STATUS_ALL]);
    expect(STATUS_VALUES).toEqual(['extracted', 'reviewed', 'verified']);
    expect(STATUS_REQUEST_TYPES).not.toContain('npc');
    expect(STATUS_OBJECT_TYPES).not.toContain('all');
  });
});

describe('GET /api/status/:type', () => {
  it.each(STATUS_TYPES)('serves %s with exactly { entries, summary }', async (type) => {
    const { app } = setup(seedCorpus);

    const res = await request(app).get(`/api/status/${type}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(Object.keys(res.body)).toEqual(['entries', 'summary']);
    expect(Object.keys(res.body.summary)).toEqual(SUMMARY_KEYS);
  });

  it('serves the documented row shape, singular object_type included', async () => {
    const { app } = setup((db) => {
      seedCorpus(db);
      insertHistory(db, 'quest', 'DS-ACAD-C01-001', [
        {
          old: null,
          next: 'extracted',
          notes: 'Imported from packet capture',
          by: 'quest_builder',
        },
      ]);
    });

    const res = await request(app).get('/api/status/quests');

    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([
      {
        object_type: 'quest',
        object_key: 'DS-ACAD-C01-001',
        status: 'extracted',
        extracted_at: '2026-01-01T00:00:00.000Z',
        reviewed_at: null,
        verified_at: null,
        latest_notes: 'Imported from packet capture',
      },
      {
        object_type: 'quest',
        object_key: 'DS-ACAD-C01-002',
        status: 'reviewed',
        extracted_at: '2026-01-01T00:00:00.000Z',
        reviewed_at: '2026-02-02T00:00:00.000Z',
        verified_at: null,
        latest_notes: null,
      },
      {
        object_type: 'quest',
        object_key: 'DS-ACAD-C01-003',
        status: 'verified',
        extracted_at: '2026-01-01T00:00:00.000Z',
        reviewed_at: '2026-02-02T00:00:00.000Z',
        verified_at: '2026-03-03T00:00:00.000Z',
        latest_notes: null,
      },
    ]);
    expect(Object.keys(res.body.entries[0])).toEqual(ENTRY_KEYS);
  });

  it('summarises every entry of the type: total = extracted + reviewed + verified', async () => {
    const { app } = setup(seedCorpus);

    const res = await request(app).get('/api/status/quests');

    expect(res.body.summary).toEqual({
      total: 3,
      extracted: 1,
      reviewed: 1,
      verified: 1,
    });
    const { total, extracted, reviewed, verified } = res.body.summary;
    expect(total).toBe(extracted + reviewed + verified);
  });

  it('orders entries by object_key ascending', async () => {
    const { app } = setup(seedCorpus);

    const res = await request(app).get('/api/status/all');

    const keys = res.body.entries.map((row: { object_key: string }) => row.object_key);
    expect(keys).toEqual([...keys].sort());
  });

  it('is deterministic: the same request twice returns byte-identical bodies', async () => {
    const { app } = setup(seedCorpus);

    const first = await request(app).get('/api/status/all');
    const second = await request(app).get('/api/status/all');

    expect(first.text).toBe(second.text);
  });
});

describe('GET /api/status/:type?status=', () => {
  it.each(STATUS_VALUES)('filters entries to %s', async (status) => {
    const { app } = setup(seedCorpus);

    const res = await request(app).get(`/api/status/quests?status=${status}`);

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0].status).toBe(status);
  });

  it('counts the summary BEFORE the filter (the spec total is pre-filter)', async () => {
    const { app } = setup(seedCorpus);

    const unfiltered = await request(app).get('/api/status/quests');
    const filtered = await request(app).get('/api/status/quests?status=verified');

    expect(filtered.body.entries).toHaveLength(1);
    // The three buckets still describe the whole type, not the filtered page.
    expect(filtered.body.summary).toEqual(unfiltered.body.summary);
    expect(filtered.body.summary).toEqual({ total: 3, extracted: 1, reviewed: 1, verified: 1 });
  });

  it('returns an empty entries list (not a 404) when the filter matches nothing', async () => {
    const { app } = setup((db) => {
      insertEntries(db, [{ objectType: 'quest', objectKey: 'Q-1' }]);
    });

    const res = await request(app).get('/api/status/quests?status=verified');

    expect(res.status).toBe(200);
    expect(res.body.entries).toEqual([]);
    expect(res.body.summary).toEqual({ total: 1, extracted: 1, reviewed: 0, verified: 0 });
  });

  it.each([['bogus'], [''], ['extracted&status=verified'], ['Extracted'], ['null']])(
    'rejects status=%s with 400 { error }',
    async (query) => {
      const { app } = setup(seedCorpus);

      const res = await request(app).get(`/api/status/quests?status=${query}`);

      expect(res.status).toBe(400);
      expect(Object.keys(res.body)).toEqual(['error']);
      expect(res.body.error).toContain('extracted, reviewed, verified');
      expect(res.body.entries).toBeUndefined();
    },
  );
});

describe('GET /api/status/all', () => {
  it('aggregates every type, singular object_type included, with a summed summary', async () => {
    const { app } = setup(seedCorpus);

    const res = await request(app).get('/api/status/all');

    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(9);
    // Entries of the eight types are interleaved by object_key (the documented
    // ordering), so the distinct type set is compared unordered.
    const distinctTypes = [
      ...new Set(res.body.entries.map((row: { object_type: string }) => row.object_type)),
    ].sort();
    expect(distinctTypes).toEqual(
      [
        'quest',
        'drop_table',
        'npc_inventory',
        'npc_spell_inventory',
        'creature_spellbook',
        'treasure_card_inventory',
        'zone_transfer',
      ].sort(),
    );
    expect(res.body.summary).toEqual({ total: 9, extracted: 4, reviewed: 3, verified: 2 });
  });

  it('honours the status filter while keeping the aggregate summary', async () => {
    const { app } = setup(seedCorpus);

    const res = await request(app).get('/api/status/all?status=extracted');

    expect(res.body.entries).toHaveLength(4);
    expect(res.body.summary).toEqual({ total: 9, extracted: 4, reviewed: 3, verified: 2 });
  });
});

describe('latest_notes', () => {
  it('is the notes of the most recent history row', async () => {
    const { app } = setup((db) => {
      insertEntries(db, [{ objectType: 'quest', objectKey: 'Q-1' }]);
      insertHistory(db, 'quest', 'Q-1', [
        { old: null, next: 'extracted', notes: 'first', by: 'quest_builder' },
        { old: 'extracted', next: 'reviewed', notes: 'second', by: 'jason' },
        { old: 'reviewed', next: 'verified', notes: 'third', by: 'jason' },
      ]);
    });

    const res = await request(app).get('/api/status/quests');

    expect(res.body.entries[0].latest_notes).toBe('third');
  });

  it('is null when the entry has no history at all (an imported entry)', async () => {
    const { app } = setup(seedCorpus);

    const res = await request(app).get('/api/status/quests');

    const entry = res.body.entries.find(
      (row: { object_key: string }) => row.object_key === 'DS-ACAD-C01-001',
    );
    expect(entry.latest_notes).toBeNull();
  });

  it('is null for a history row whose notes are NULL', async () => {
    const { app } = setup((db) => {
      insertEntries(db, [{ objectType: 'quest', objectKey: 'Q-1' }]);
      insertHistory(db, 'quest', 'Q-1', [{ old: null, next: 'extracted', notes: null, by: null }]);
    });

    const res = await request(app).get('/api/status/quests');

    expect(res.body.entries[0].latest_notes).toBeNull();
  });
});

describe('unknown type (404)', () => {
  it.each([
    ['get', '/api/status/widgets'],
    ['patch', '/api/status/widgets/KEY'],
    ['get', '/api/status/widgets/KEY/history'],
    ['patch', '/api/status/all/KEY'],
  ])('%s %s answers 404 { error } listing every valid type', async (method, path) => {
    const { app } = setup(seedCorpus);

    const res =
      method === 'get'
        ? await request(app).get(path)
        : await request(app).patch(path).send({ status: 'reviewed' });

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({
      error: `Unknown status type "${path.split('/')[3]}". Valid types: ${VALID_TYPES_MESSAGE}`,
    });
  });

  it('reports the unknown type before a malformed ?status= value', async () => {
    const { app } = setup(seedCorpus);

    const res = await request(app).get('/api/status/widgets?status=bogus');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Unknown status type');
  });
});

describe('PATCH /api/status/:type/:key', () => {
  it('answers 200 with the updated entry row, bare, latest_notes included', async () => {
    const { app } = setup((db) => {
      insertEntries(db, [{ objectType: 'quest', objectKey: 'DS-ACAD-C01-001' }]);
    });

    const res = await request(app)
      .patch('/api/status/quests/DS-ACAD-C01-001')
      .send({ status: 'reviewed', notes: 'Goal logic chain looks correct.', changed_by: 'jason' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(Object.keys(res.body)).toEqual(ENTRY_KEYS);
    expect(res.body).toMatchObject({
      object_type: 'quest',
      object_key: 'DS-ACAD-C01-001',
      status: 'reviewed',
      reviewed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      verified_at: null,
      latest_notes: 'Goal logic chain looks correct.',
    });
    // The row is not wrapped in an envelope.
    expect(res.body.entries).toBeUndefined();
  });

  it('sets the reviewed pair and leaves the verified pair untouched', async () => {
    const { db, app } = setup((database) => {
      insertEntries(database, [{ objectType: 'quest', objectKey: 'Q-1' }]);
    });

    await request(app).patch('/api/status/quests/Q-1').send({ status: 'reviewed', notes: 'r1' });

    const row = db.prepare('SELECT * FROM entry_status WHERE object_key = ?').get('Q-1') as Record<
      string,
      unknown
    >;
    expect(row.status).toBe('reviewed');
    expect(row.reviewed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.reviewed_by).toBe('jason');
    expect(row.verified_at).toBeNull();
    expect(row.verified_by).toBeNull();
  });

  it('sets the verified pair when moving forward and never clears the reviewed pair', async () => {
    const { db, app } = setup((database) => {
      insertEntries(database, [
        {
          objectType: 'quest',
          objectKey: 'Q-1',
          status: 'reviewed',
          reviewedAt: '2026-02-02T00:00:00.000Z',
          reviewedBy: 'reviewer',
        },
      ]);
    });

    const res = await request(app)
      .patch('/api/status/quests/Q-1')
      .send({ status: 'verified', notes: 'Tested on Imlight r806919.', changed_by: 'jason' });

    expect(res.status).toBe(200);
    const row = db.prepare('SELECT * FROM entry_status WHERE object_key = ?').get('Q-1') as Record<
      string,
      unknown
    >;
    expect(row.status).toBe('verified');
    expect(row.verified_by).toBe('jason');
    // The historical record of the earlier review survives the forward move.
    expect(row.reviewed_at).toBe('2026-02-02T00:00:00.000Z');
    expect(row.reviewed_by).toBe('reviewer');
  });

  it('allows a backwards transition (verified → reviewed) and keeps the verified pair (D15)', async () => {
    const { db, app } = setup((database) => {
      insertEntries(database, [
        {
          objectType: 'quest',
          objectKey: 'Q-1',
          status: 'verified',
          reviewedAt: '2026-02-02T00:00:00.000Z',
          reviewedBy: 'reviewer',
          verifiedAt: '2026-03-03T00:00:00.000Z',
          verifiedBy: 'verifier',
        },
      ]);
    });

    const res = await request(app).patch('/api/status/quests/Q-1').send({
      status: 'reviewed',
      notes: 'Regression: goal 3 no longer triggers.',
      changed_by: 'jason',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('reviewed');

    const row = db.prepare('SELECT * FROM entry_status WHERE object_key = ?').get('Q-1') as Record<
      string,
      unknown
    >;
    expect(row.status).toBe('reviewed');
    // Only the new status' pair is written; the verified pair is untouched.
    expect(row.reviewed_by).toBe('jason');
    expect(row.reviewed_at).not.toBe('2026-02-02T00:00:00.000Z');
    expect(row.verified_at).toBe('2026-03-03T00:00:00.000Z');
    expect(row.verified_by).toBe('verifier');
  });

  it('writes no extra timestamp for an extracted transition', async () => {
    const { db, app } = setup((database) => {
      insertEntries(database, [{ objectType: 'quest', objectKey: 'Q-1', status: 'verified' }]);
    });

    await request(app).patch('/api/status/quests/Q-1').send({ status: 'extracted' });

    const row = db.prepare('SELECT * FROM entry_status WHERE object_key = ?').get('Q-1') as Record<
      string,
      unknown
    >;
    expect(row.status).toBe('extracted');
    expect(row.reviewed_at).toBeNull();
    expect(row.verified_at).toBeNull();
  });

  it('appends exactly one history row per transition with old/new/notes/changed_by (D15)', async () => {
    const { db, app } = setup((database) => {
      insertEntries(database, [{ objectType: 'quest', objectKey: 'Q-1' }]);
    });

    await request(app)
      .patch('/api/status/quests/Q-1')
      .send({ status: 'reviewed', notes: 'first', changed_by: 'alice' });
    await request(app)
      .patch('/api/status/quests/Q-1')
      .send({ status: 'verified', notes: 'second', changed_by: 'bob' });
    await request(app).patch('/api/status/quests/Q-1').send({ status: 'reviewed', notes: 'third' });

    const rows = db
      .prepare('SELECT old_status, new_status, notes, changed_by FROM status_history ORDER BY id')
      .all();
    expect(rows).toEqual([
      { old_status: 'extracted', new_status: 'reviewed', notes: 'first', changed_by: 'alice' },
      { old_status: 'reviewed', new_status: 'verified', notes: 'second', changed_by: 'bob' },
      // The third call omitted changed_by, so it defaults to settings.user_name.
      { old_status: 'verified', new_status: 'reviewed', notes: 'third', changed_by: 'jason' },
    ]);
  });

  it('defaults changed_by to settings.user_name', async () => {
    const { db, app } = setup((database) => {
      insertEntries(database, [{ objectType: 'quest', objectKey: 'Q-1' }]);
    });

    await request(app).patch('/api/status/quests/Q-1').send({ status: 'reviewed' });

    const row = db.prepare('SELECT changed_by FROM status_history').get() as { changed_by: string };
    expect(row.changed_by).toBe('jason');
  });

  it('defaults notes to NULL when the body omits it', async () => {
    const { app } = setup((db) => {
      insertEntries(db, [{ objectType: 'quest', objectKey: 'Q-1' }]);
    });

    const res = await request(app).patch('/api/status/quests/Q-1').send({ status: 'reviewed' });

    expect(res.body.latest_notes).toBeNull();
  });

  it.each([
    [{}],
    [{ status: 'bogus' }],
    [{ status: '' }],
    [{ status: null }],
    [{ status: 7 }],
    [{ status: 'Extracted' }],
    [{ notes: 'no status' }],
    [{ status: 'reviewed', notes: 5 }],
    [{ status: 'reviewed', changed_by: 5 }],
    [[]],
  ])('rejects the body %j with 400 { error }', async (body) => {
    const { db, app } = setup((database) => {
      insertEntries(database, [{ objectType: 'quest', objectKey: 'Q-1' }]);
    });

    const res = await request(app)
      .patch('/api/status/quests/Q-1')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(['error']);
    // Nothing was written.
    expect(db.prepare('SELECT COUNT(*) AS count FROM status_history').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT status FROM entry_status').get()).toEqual({ status: 'extracted' });
  });

  it.each([['quests/NOPE'], ['drop_tables/NOPE'], ['zone_transfers/WizardCity%2FNOPE']])(
    'answers an unknown key (%s) with 404 { error }',
    async (path) => {
      const { app } = setup(seedCorpus);

      const res = await request(app).patch(`/api/status/${path}`).send({ status: 'reviewed' });

      expect(res.status).toBe(404);
      expect(Object.keys(res.body)).toEqual(['error']);
      expect(res.body.error).toContain('NOPE');
    },
  );

  it('never clears a previously set pair, and the full trail stays in history', async () => {
    const { app } = setup((db) => {
      insertEntries(db, [{ objectType: 'quest', objectKey: 'Q-1' }]);
    });

    await request(app).patch('/api/status/quests/Q-1').send({ status: 'reviewed', notes: 'a' });
    await request(app).patch('/api/status/quests/Q-1').send({ status: 'verified', notes: 'b' });
    await request(app).patch('/api/status/quests/Q-1').send({ status: 'reviewed', notes: 'c' });

    const res = await request(app).get('/api/status/quests/Q-1/history');

    expect(
      res.body.history.map((row: { old_status: string; new_status: string }) => [
        row.old_status,
        row.new_status,
      ]),
    ).toEqual([
      ['extracted', 'reviewed'],
      ['reviewed', 'verified'],
      ['verified', 'reviewed'],
    ]);
  });
});

describe('applyStatusChange (service)', () => {
  it('writes the injected timestamp to the new pair and the history row', () => {
    const db = memoryDb();
    insertEntries(db, [{ objectType: 'quest', objectKey: 'Q-1' }]);

    const row = applyStatusChange(db, {
      objectType: 'quest',
      objectKey: 'Q-1',
      status: 'verified',
      notes: 'n',
      changedBy: 'jason',
      now: '2026-09-26T05:00:00.000Z',
    });

    expect(row).toEqual({
      object_type: 'quest',
      object_key: 'Q-1',
      status: 'verified',
      extracted_at: '2026-01-01T00:00:00.000Z',
      reviewed_at: null,
      verified_at: '2026-09-26T05:00:00.000Z',
      latest_notes: 'n',
    });
    expect(db.prepare('SELECT changed_at FROM status_history').get()).toEqual({
      changed_at: '2026-09-26T05:00:00.000Z',
    });
  });

  it('returns undefined for an unknown key and writes nothing', () => {
    const db = memoryDb();

    expect(
      applyStatusChange(db, { objectType: 'quest', objectKey: 'NOPE', status: 'reviewed' }),
    ).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS count FROM status_history').get()).toEqual({ count: 0 });
  });

  it('is atomic: a failing history insert rolls the status update back', () => {
    const db = memoryDb();
    insertEntries(db, [{ objectType: 'quest', objectKey: 'Q-1' }]);
    // A real SQLite abort inside the transaction — the UPDATE before it must not
    // survive, because both writes are one transaction.
    db.exec(
      `CREATE TRIGGER block_history BEFORE INSERT ON status_history
       BEGIN SELECT RAISE(ABORT, 'blocked'); END`,
    );

    expect(() =>
      applyStatusChange(db, { objectType: 'quest', objectKey: 'Q-1', status: 'reviewed' }),
    ).toThrow(/blocked/);

    expect(db.prepare('SELECT status, reviewed_at FROM entry_status').get()).toEqual({
      status: 'extracted',
      reviewed_at: null,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM status_history').get()).toEqual({ count: 0 });
  });
});

describe('GET /api/status/:type/:key/history', () => {
  it('serves the five documented keys, oldest → newest', async () => {
    const { app } = setup((db) => {
      insertEntries(db, [{ objectType: 'quest', objectKey: 'Q-1', status: 'verified' }]);
      insertHistory(db, 'quest', 'Q-1', [
        {
          old: null,
          next: 'extracted',
          notes: 'Imported from packet capture',
          by: 'quest_builder',
        },
        {
          old: 'extracted',
          next: 'reviewed',
          notes: 'Goal logic chain looks correct.',
          by: 'jason',
        },
        { old: 'reviewed', next: 'verified', notes: 'Tested on Imlight r806919.', by: 'jason' },
      ]);
    });

    const res = await request(app).get('/api/status/quests/Q-1/history');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['history']);
    expect(res.body.history).toEqual([
      {
        old_status: null,
        new_status: 'extracted',
        notes: 'Imported from packet capture',
        changed_by: 'quest_builder',
        changed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2} /),
      },
      {
        old_status: 'extracted',
        new_status: 'reviewed',
        notes: 'Goal logic chain looks correct.',
        changed_by: 'jason',
        changed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2} /),
      },
      {
        old_status: 'reviewed',
        new_status: 'verified',
        notes: 'Tested on Imlight r806919.',
        changed_by: 'jason',
        changed_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2} /),
      },
    ]);
    expect(Object.keys(res.body.history[0])).toEqual(HISTORY_KEYS);
  });

  it('answers 200 with an empty history for an entry that was never patched', async () => {
    const { app } = setup(seedCorpus);

    const res = await request(app).get('/api/status/quests/DS-ACAD-C01-001/history');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ history: [] });
  });

  it('reflects the PATCH trail (old/new pairs in order)', async () => {
    const { app } = setup((db) => {
      insertEntries(db, [{ objectType: 'quest', objectKey: 'Q-1' }]);
    });

    await request(app)
      .patch('/api/status/quests/Q-1')
      .send({ status: 'reviewed', notes: 'one', changed_by: 'jason' });
    await request(app)
      .patch('/api/status/quests/Q-1')
      .send({ status: 'verified', notes: 'two', changed_by: 'jason' });

    const res = await request(app).get('/api/status/quests/Q-1/history');

    expect(
      res.body.history.map(
        (row: { old_status: string; new_status: string; notes: string; changed_by: string }) => [
          row.old_status,
          row.new_status,
          row.notes,
          row.changed_by,
        ],
      ),
    ).toEqual([
      ['extracted', 'reviewed', 'one', 'jason'],
      ['reviewed', 'verified', 'two', 'jason'],
    ]);
  });

  it.each([
    ['quests/NOPE', 'Unknown quests entry "NOPE"'],
    ['drop_tables/NOPE', 'Unknown drop_tables entry "NOPE"'],
    // A zone key contains a slash, so its encoded form is a single segment and
    // the 404 echoes the decoded key.
    ['zone_transfers/WizardCity%2FNOPE', 'Unknown zone_transfers entry "WizardCity/NOPE"'],
  ])('answers an unknown key (%s) with 404 { error }', async (path, message) => {
    const { app } = setup(seedCorpus);

    const res = await request(app).get(`/api/status/${path}/history`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: message });
  });

  it('resolves an entry key that contains a slash when it is URL-encoded', async () => {
    const { app } = setup(seedCorpus);

    const res = await request(app).get('/api/status/zone_transfers/WizardCity%2FWC_Hub/history');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ history: [] });
  });
});

describe('GET /api/dashboard', () => {
  it('lists all eight types with zeros on an empty database and overall 0', async () => {
    const { app } = setup();

    const res = await request(app).get('/api/dashboard');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['types', 'overall']);
    expect(Object.keys(res.body.types)).toEqual([...STATUS_OBJECT_TYPES]);
    for (const objectType of STATUS_OBJECT_TYPES) {
      expect(res.body.types[objectType]).toEqual({
        total: 0,
        extracted: 0,
        reviewed: 0,
        verified: 0,
      });
    }
    expect(res.body.overall).toEqual({
      total: 0,
      extracted: 0,
      reviewed: 0,
      verified: 0,
      percent_verified: 0,
    });
    expect(Number.isNaN(res.body.overall.percent_verified)).toBe(false);
    expect(res.body.overall.percent_verified).not.toBeNull();
  });

  it('matches the spec example exactly: 272/597 → percent_verified 45.6', async () => {
    const { app } = setup((db) => {
      seedCounts(db, 'quest', { extracted: 45, reviewed: 120, verified: 157 });
      seedCounts(db, 'drop_table', { extracted: 30, reviewed: 80, verified: 70 });
      seedCounts(db, 'npc_inventory', { extracted: 10, reviewed: 40, verified: 45 });
    });

    const res = await request(app).get('/api/dashboard');

    expect(res.body.types.quest).toEqual({
      total: 322,
      extracted: 45,
      reviewed: 120,
      verified: 157,
    });
    expect(res.body.types.drop_table).toEqual({
      total: 180,
      extracted: 30,
      reviewed: 80,
      verified: 70,
    });
    expect(res.body.types.npc_inventory).toEqual({
      total: 95,
      extracted: 10,
      reviewed: 40,
      verified: 45,
    });
    expect(res.body.overall).toEqual({
      total: 597,
      extracted: 85,
      reviewed: 240,
      verified: 272,
      percent_verified: 45.6,
    });
    // The five types with no seeded rows still appear, with zeros.
    expect(res.body.types.npc_drop_table).toEqual({
      total: 0,
      extracted: 0,
      reviewed: 0,
      verified: 0,
    });
  });

  it('sums the per-type totals into the overall totals', async () => {
    const { app } = setup(seedCorpus);

    const res = await request(app).get('/api/dashboard');
    const buckets = Object.values(res.body.types) as Array<{ total: number }>;

    expect(buckets.reduce((sum, bucket) => sum + bucket.total, 0)).toBe(res.body.overall.total);
    expect(res.body.overall).toEqual({
      total: 9,
      extracted: 4,
      reviewed: 3,
      verified: 2,
      percent_verified: 22.2,
    });
  });

  it.each([
    [1, 3, 33.3],
    [2, 3, 66.7],
    [272, 597, 45.6],
    [1, 1, 100],
    [0, 1, 0],
    [0, 0, 0],
    [1, 8, 12.5],
    [1, 7, 14.3],
  ])('rounds %i/%i to %f', (verified, total, expected) => {
    expect(percentVerified(verified, total)).toBe(expected);
  });
});

describe('GET /api/status/_import', () => {
  it('reports "nothing imported" before any import has run in this process', async () => {
    const { app } = setup(seedCorpus, () => null);

    const res = await request(app).get('/api/status/_import');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['ran', 'imported', 'imported_at']);
    expect(res.body).toEqual({ ran: false, imported: 0, imported_at: null });
  });

  it('refuses to be shadowed by /:type and reflects the recorded import', async () => {
    const recorded: ImportResult = {
      ran: true,
      imported: 2271,
      skipped: 3,
      failed: 0,
      byType: {} as ImportResult['byType'],
      importedAt: '2026-09-26T05:00:00.000Z',
    };
    const { app, db } = setup(
      (database) => {
        insertEntries(database, [{ objectType: 'quest', objectKey: 'Q-1' }]);
      },
      () => recorded,
    );

    const res = await request(app).get('/api/status/_import');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ran: true,
      imported: 2271,
      imported_at: '2026-09-26T05:00:00.000Z',
    });
    // Not the status list, and not an unknown-type 404.
    expect(res.body.entries).toBeUndefined();
    expect(db.prepare('SELECT COUNT(*) AS count FROM entry_status').get()).toEqual({ count: 1 });
  });
});

/**
 * Seeds a type with `extracted` / `reviewed` / `verified` rows so the dashboard
 * rounding is checked against the spec's own 272/597 example.
 */
function seedCounts(
  db: Db,
  objectType: StatusObjectType,
  counts: { extracted: number; reviewed: number; verified: number },
): void {
  const insert = db.prepare(
    'INSERT INTO entry_status (object_type, object_key, status) VALUES (?, ?, ?)',
  );
  const seed = db.transaction((): void => {
    let index = 0;
    for (const status of STATUS_VALUES) {
      for (let i = 0; i < counts[status]; i += 1) {
        insert.run(objectType, `${objectType}-${String(index).padStart(4, '0')}`, status);
        index += 1;
      }
    }
  });
  seed();
}

describe('lazy mount (decision D32)', () => {
  it('does not open the real database when the registry and app are merely imported', async () => {
    const { defaultDbFile } = await import('@server/db');
    const dbFile = defaultDbFile();
    const existed = fs.existsSync(dbFile);
    const before = existed ? fs.statSync(dbFile).mtimeMs : 0;

    vi.resetModules();
    const dbModule = await import('@server/db');
    const getDbSpy = vi.spyOn(dbModule, 'getDb');

    // Static imports at the top of this file would run before the spy exists, so
    // the registry and the app are imported *after* it is installed.
    await import('@server/routes/index');
    await import('@server/app');

    expect(getDbSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(dbFile)).toBe(existed);
    if (existed) {
      expect(fs.statSync(dbFile).mtimeMs).toBe(before);
    }

    getDbSpy.mockRestore();
  });

  it('control: a status request and a dashboard request really do go through the lazy mount', async () => {
    vi.resetModules();
    const dbModule = await import('@server/db');
    const getDbSpy = vi.spyOn(dbModule, 'getDb').mockImplementation(() => {
      throw new Error('getDb reached');
    });
    const { app } = await import('@server/app');

    const status = await request(app).get('/api/status/quests');
    const dashboard = await request(app).get('/api/dashboard');

    expect(getDbSpy).toHaveBeenCalledTimes(2);
    expect(status.status).toBe(500);
    expect(dashboard.status).toBe(500);
    expect(status.body).toEqual({ error: 'getDb reached' });

    getDbSpy.mockRestore();
  });
});
