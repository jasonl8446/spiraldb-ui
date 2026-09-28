import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { MEMORY_DB, openDb, type Db } from '@server/db';
import { createActivityRouter } from '@server/routes/activity';
import {
  ACTIVITY_DEFAULT_LIMIT,
  ACTIVITY_MAX_LIMIT,
  isResolvedActivity,
  listActivity,
  parseActivityLimit,
  type ActivityRow,
} from '@server/services/status';

/**
 * Story p5-01 deliverable D1 — `GET /api/activity?limit=10`, the dashboard feed's
 * `status_history` × `entry_status` join (decision D27, plan task 5.1).
 *
 * Every database here is `:memory:` (decision D17): the real
 * `data/spiraldb-ui.db` is never opened, so nothing in this suite can read or move
 * the owner's own three history rows.
 *
 * The five things the story's brief names are all here: the ordering, the limit
 * (`?limit=` ladder + default + ceiling), the join's fields, an empty history, and
 * the parent-missing case. Two extras guard hazards the same brief names: an
 * `object_type` outside D4's eight (Q1's GlobalRegistry can never be produced by a
 * route — `PATCH /api/status/global_registry/…` is a 404 — but a hand-written row
 * must still not become a dead link), and the exact wire envelope.
 */

const OPEN: Db[] = [];

afterEach(() => {
  while (OPEN.length > 0) {
    OPEN.pop()?.close();
  }
});

/** A `:memory:` database with the schema applied; closed after every test. */
function memoryDb(): Db {
  const db = openDb({ file: MEMORY_DB });
  OPEN.push(db);
  return db;
}

/** The eight service keys of one `activity[]` row, typed by hand (not derived). */
const ACTIVITY_KEYS = [
  'id',
  'object_type',
  'object_key',
  'old_status',
  'new_status',
  'notes',
  'changed_by',
  'changed_at',
];

/** Inserts one `entry_status` row and returns its id. */
function seedEntry(db: Db, objectType: string, objectKey: string, status = 'extracted'): number {
  const info = db
    .prepare('INSERT INTO entry_status (object_type, object_key, status) VALUES (?, ?, ?)')
    .run(objectType, objectKey, status);
  return Number(info.lastInsertRowid);
}

interface HistorySeed {
  old?: string | null;
  new?: string;
  notes?: string | null;
  changedBy?: string | null;
  changedAt?: string | null;
}

/** Inserts one `status_history` row; the caller owns the parent id. */
function seedHistory(db: Db, entryStatusId: number, seed: HistorySeed = {}): number {
  const info = db
    .prepare(
      `INSERT INTO status_history (entry_status_id, old_status, new_status, notes, changed_by, changed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entryStatusId,
      seed.old ?? null,
      seed.new ?? 'reviewed',
      seed.notes ?? null,
      seed.changedBy ?? null,
      seed.changedAt ?? '2026-09-26T00:00:00.000Z',
    );
  return Number(info.lastInsertRowid);
}

/** The router under test, mounted exactly as `routes/index.ts` mounts it. */
function mount(db: Db): Express {
  const app = express();
  app.use('/api/activity', createActivityRouter({ db }));
  return app;
}

describe('listActivity — ordering', () => {
  it('returns the newest first, by changed_at', () => {
    const db = memoryDb();
    const entry = seedEntry(db, 'quest', 'DS-ACAD-C01-001');
    // Deliberately seeded oldest-first, so the assertion cannot pass by insertion order.
    seedHistory(db, entry, { old: null, new: 'extracted', changedAt: '2026-09-20T10:00:00.000Z' });
    seedHistory(db, entry, {
      old: 'extracted',
      new: 'reviewed',
      changedAt: '2026-09-22T10:00:00.000Z',
    });
    seedHistory(db, entry, {
      old: 'reviewed',
      new: 'verified',
      changedAt: '2026-09-24T10:00:00.000Z',
    });

    const { activity } = listActivity(db);

    expect(activity.map((row) => row.new_status)).toEqual(['verified', 'reviewed', 'extracted']);
    // The server's own history read is oldest → newest (D37); this feed is the
    // opposite direction, which is the spec's timeline (L162-177, newest on top).
    expect(activity.map((row) => row.changed_at)).toEqual([
      '2026-09-24T10:00:00.000Z',
      '2026-09-22T10:00:00.000Z',
      '2026-09-20T10:00:00.000Z',
    ]);
  });

  it('breaks a same-timestamp tie by id, so the order is total and repeatable', () => {
    const db = memoryDb();
    const entry = seedEntry(db, 'quest', 'DS-ACAD-C01-001');
    // `changed_at` is allowed to repeat (D37's note on latest_notes): the live
    // database's own rows 2 and 3 are 11 ms apart, and a same-second write is one
    // `INSERT` away. Two rows sharing a timestamp must still have one order.
    const first = seedHistory(db, entry, {
      old: null,
      new: 'extracted',
      changedAt: '2026-09-26T06:26:25.798Z',
    });
    const second = seedHistory(db, entry, {
      old: 'extracted',
      new: 'reviewed',
      changedAt: '2026-09-26T06:26:25.798Z',
    });

    const { activity } = listActivity(db);

    expect(activity.map((row) => row.id)).toEqual([second, first]);
    // …and the same read twice answers the same thing.
    expect(listActivity(db).activity).toEqual(activity);
  });
});

describe('listActivity — the limit', () => {
  /** 12 history rows over two entries, one minute apart, oldest first. */
  function seedTwelve(db: Db): number[] {
    const quest = seedEntry(db, 'quest', 'DS-ACAD-C01-001');
    const dropTable = seedEntry(db, 'drop_table', 'KT-SPH3-C02-003', 'reviewed');
    const ids: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const changedAt = new Date(Date.UTC(2026, 8, 1, 0, i, 0)).toISOString();
      ids.push(
        seedHistory(db, i % 2 === 0 ? quest : dropTable, {
          old: i === 0 ? null : 'extracted',
          new: 'reviewed',
          changedAt,
        }),
      );
    }
    return ids;
  }

  it('defaults to the 10 most recent rows when no limit is given', () => {
    const db = memoryDb();
    const ids = seedTwelve(db);

    expect(ACTIVITY_DEFAULT_LIMIT).toBe(10);

    const { activity } = listActivity(db);

    expect(activity).toHaveLength(10);
    // The ten newest, newest first: ids 12..3 (the two oldest, 1 and 2, are cut).
    expect(activity.map((row) => row.id)).toEqual([...ids].reverse().slice(0, 10));
  });

  it('honours an explicit limit and caps at the requested count', () => {
    const db = memoryDb();
    const ids = seedTwelve(db);

    expect(listActivity(db, { limit: 3 }).activity.map((row) => row.id)).toEqual(
      [...ids].reverse().slice(0, 3),
    );
    expect(listActivity(db, { limit: 12 }).activity).toHaveLength(12);
    expect(listActivity(db, { limit: ACTIVITY_MAX_LIMIT }).activity).toHaveLength(12);
  });
});

describe('parseActivityLimit — the ?limit= ladder', () => {
  it('treats an absent value as the default and accepts 1..max', () => {
    expect(parseActivityLimit(undefined)).toEqual({ ok: true, limit: ACTIVITY_DEFAULT_LIMIT });
    expect(parseActivityLimit('1')).toEqual({ ok: true, limit: 1 });
    expect(parseActivityLimit('10')).toEqual({ ok: true, limit: 10 });
    expect(parseActivityLimit(String(ACTIVITY_MAX_LIMIT))).toEqual({
      ok: true,
      limit: ACTIVITY_MAX_LIMIT,
    });
  });

  it('rejects everything else with a message naming the rule', () => {
    // `""` is rejected rather than treated as absent — the rule `?status=` follows (D37).
    for (const raw of ['', 'abc', '1.5', '-1', '0', '1e3', ' 1', '+1']) {
      const parsed = parseActivityLimit(raw);
      expect(parsed.ok, `limit=${JSON.stringify(raw)} must be rejected`).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error).toContain('limit must be');
      }
    }
  });

  it('rejects a limit above the ceiling instead of silently clamping it', () => {
    const parsed = parseActivityLimit(String(ACTIVITY_MAX_LIMIT + 1));
    expect(parsed).toEqual({
      ok: false,
      error: `Invalid limit "${ACTIVITY_MAX_LIMIT + 1}": limit must be at most ${ACTIVITY_MAX_LIMIT}`,
    });
  });

  it('rejects a repeated parameter (Express hands it over as an array)', () => {
    expect(parseActivityLimit(['1', '2'])).toEqual({
      ok: false,
      error: 'Query parameter "limit" must be a single positive integer',
    });
  });
});

describe('listActivity — the join fields', () => {
  it('carries the parent entry key/type plus the whole history row', () => {
    const db = memoryDb();
    const entry = seedEntry(db, 'drop_table', 'KT-SPH3-C02-003', 'reviewed');
    const id = seedHistory(db, entry, {
      old: 'extracted',
      new: 'reviewed',
      notes: 'Checked the roll table by hand.',
      changedBy: 'Jason',
      changedAt: '2026-09-26T06:26:25.798Z',
    });

    const { activity, unresolved } = listActivity(db);

    expect(activity).toEqual([
      {
        id,
        object_type: 'drop_table',
        object_key: 'KT-SPH3-C02-003',
        old_status: 'extracted',
        new_status: 'reviewed',
        notes: 'Checked the roll table by hand.',
        changed_by: 'Jason',
        changed_at: '2026-09-26T06:26:25.798Z',
      },
    ]);
    // Exactly the eight declared keys — no `entry_status_id` leak, no `status` column.
    expect(Object.keys(activity[0])).toEqual(ACTIVITY_KEYS);
    expect(unresolved).toBe(0);
  });

  it('keeps a null old_status, notes and changed_by as null (never "")', () => {
    const db = memoryDb();
    const entry = seedEntry(db, 'quest', 'DS-ACAD-C01-001');
    seedHistory(db, entry, { old: null, new: 'extracted', changedAt: '2026-09-26T00:00:00.000Z' });

    const [row] = listActivity(db).activity;

    expect(row.old_status).toBeNull();
    expect(row.notes).toBeNull();
    expect(row.changed_by).toBeNull();
  });

  it('returns an empty feed and a zero count for an empty history', () => {
    const db = memoryDb();
    // An entry with no transitions at all is the imported-then-untouched case (D37).
    seedEntry(db, 'quest', 'DS-ACAD-C01-001');

    expect(listActivity(db)).toEqual({ activity: [], unresolved: 0 });
  });
});

describe('listActivity — a history row whose parent is missing', () => {
  /** A history row pointing at an `entry_status` id that does not exist. */
  function seedOrphan(db: Db, changedAt = '2026-09-26T07:00:00.000Z'): number {
    // `openDb` sets `PRAGMA foreign_keys = ON`, so the orphan is written the way a
    // writer that ignored the constraint would have written it: FK enforcement off.
    db.pragma('foreign_keys = OFF');
    const id = seedHistory(db, 999_999, {
      old: 'extracted',
      new: 'verified',
      notes: 'row whose entry_status parent is gone',
      changedBy: 'Jason',
      changedAt,
    });
    db.pragma('foreign_keys = ON');
    return id;
  }

  it('still returns the row (the feed is N history rows, not N resolvable ones) and counts it', () => {
    const db = memoryDb();
    const entry = seedEntry(db, 'quest', 'DS-ACAD-C01-001');
    seedHistory(db, entry, { old: null, new: 'extracted', changedAt: '2026-09-26T06:00:00.000Z' });
    const orphan = seedOrphan(db);

    const { activity, unresolved } = listActivity(db);

    // An INNER JOIN would silently answer one row while claiming "the 2 most recent".
    expect(activity).toHaveLength(2);
    expect(activity[0].id).toBe(orphan);
    expect(activity[0].object_type).toBeNull();
    expect(activity[0].object_key).toBeNull();
    // The history row itself is intact — only the join half is missing.
    expect(activity[0].new_status).toBe('verified');
    expect(activity[0].notes).toBe('row whose entry_status parent is gone');
    expect(activity[0].changed_by).toBe('Jason');
    expect(unresolved).toBe(1);
    // The one resolved row is not counted.
    expect(isResolvedActivity(activity[1])).toBe(true);
    expect(isResolvedActivity(activity[0])).toBe(false);
  });

  it('counts, but never links, an object_type outside the eight tracked types (Q1)', () => {
    const db = memoryDb();
    // No route can create this row — `PATCH /api/status/global_registry/…` is a 404
    // because D4 has no route type for the registry (Q1). A hand-written row is the
    // only way it exists, and it must not become a link to a page that does not exist.
    const entry = seedEntry(db, 'global_registry', 'GlobalRegistryValues', 'extracted');
    seedHistory(db, entry, { old: null, new: 'extracted', changedAt: '2026-09-26T08:00:00.000Z' });

    const { activity, unresolved } = listActivity(db);

    expect(activity).toHaveLength(1);
    // The column value is reported verbatim, not rewritten to null…
    expect(activity[0].object_type).toBe('global_registry');
    expect(activity[0].object_key).toBe('GlobalRegistryValues');
    // …and the row is still flagged as one the UI cannot link.
    expect(unresolved).toBe(1);
  });

  it('counts a parent whose key is blank', () => {
    const db = memoryDb();
    const entry = seedEntry(db, 'quest', '');
    seedHistory(db, entry, { old: null, new: 'extracted', changedAt: '2026-09-26T09:00:00.000Z' });

    const { activity, unresolved } = listActivity(db);

    expect(activity[0].object_key).toBe('');
    expect(unresolved).toBe(1);
  });
});

describe('GET /api/activity', () => {
  it('answers the { activity, unresolved } envelope, newest first', async () => {
    const db = memoryDb();
    const entry = seedEntry(db, 'quest', 'DS-ACAD-C01-001', 'reviewed');
    seedHistory(db, entry, { old: null, new: 'extracted', changedAt: '2026-09-20T10:00:00.000Z' });
    seedHistory(db, entry, {
      old: 'extracted',
      new: 'reviewed',
      notes: 'Gate-1 acceptance re-run',
      changedBy: 'Jason',
      changedAt: '2026-09-26T06:26:25.798Z',
    });

    const res = await request(mount(db)).get('/api/activity');

    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toEqual(['activity', 'unresolved']);
    const rows = res.body.activity as ActivityRow[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      object_type: 'quest',
      object_key: 'DS-ACAD-C01-001',
      old_status: 'extracted',
      new_status: 'reviewed',
      notes: 'Gate-1 acceptance re-run',
      changed_by: 'Jason',
    });
    expect(res.body.unresolved).toBe(0);
  });

  it('respects ?limit and defaults to 10', async () => {
    const db = memoryDb();
    const entry = seedEntry(db, 'quest', 'DS-ACAD-C01-001');
    for (let i = 0; i < 12; i += 1) {
      seedHistory(db, entry, {
        old: i === 0 ? null : 'extracted',
        new: 'reviewed',
        changedAt: new Date(Date.UTC(2026, 8, 1, 0, i, 0)).toISOString(),
      });
    }
    const app = mount(db);

    const byDefault = await request(app).get('/api/activity');
    expect(byDefault.body.activity).toHaveLength(10);

    const three = await request(app).get('/api/activity?limit=3');
    expect(three.body.activity).toHaveLength(3);

    const exact = await request(app).get(`/api/activity?limit=${ACTIVITY_MAX_LIMIT}`);
    expect(exact.body.activity).toHaveLength(12);
  });

  it('answers 400 { error } for a malformed limit, and never 500', async () => {
    const db = memoryDb();
    const app = mount(db);

    for (const query of [
      '?limit=',
      '?limit=abc',
      '?limit=0',
      '?limit=-1',
      `?limit=${ACTIVITY_MAX_LIMIT + 1}`,
    ]) {
      const res = await request(app).get(`/api/activity${query}`);
      expect(res.status, query).toBe(400);
      expect(typeof res.body.error, query).toBe('string');
      expect(res.body.error, query).toContain('limit');
    }

    const repeated = await request(app).get('/api/activity?limit=1&limit=2');
    expect(repeated.status).toBe(400);
    expect(repeated.body).toEqual({
      error: 'Query parameter "limit" must be a single positive integer',
    });
  });

  it('answers an empty feed on a fresh database (the empty-state precondition)', async () => {
    const res = await request(mount(memoryDb())).get('/api/activity');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ activity: [], unresolved: 0 });
  });

  it('never opens the real database (decision D17)', async () => {
    // Same guard as `status.test.ts`: the router takes an injected connection, so a
    // bare mount over a `:memory:` db cannot reach `data/spiraldb-ui.db`.
    const db = memoryDb();
    seedEntry(db, 'quest', 'DS-ACAD-C01-001');
    const res = await request(mount(db)).get('/api/activity');
    expect(res.status).toBe(200);
    expect(res.body.activity).toEqual([]);
  });
});
