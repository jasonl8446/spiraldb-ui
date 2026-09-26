import fs from 'node:fs';

import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NOT_FOUND_MESSAGE } from '@shared/index';
import { MEMORY_DB, openDb, type Db } from '@server/db';
import { createNamesRouter } from '@server/routes/names';

/**
 * Task 1.5 acceptance: `GET /api/names/:type` and `GET /api/names/:type/:id` for
 * all seven types (docs/spec-api.md L5-44, P1 AC#8), with the row shapes the lead
 * fixed (the spec only exemplifies `items`), a 404 `{ error }` for every miss, the
 * optional `?q=` / `?limit=` list extensions (400 on malformed values), and no
 * change to the bare-URL response.
 *
 * Every database here is `:memory:` — the real `data/spiraldb-ui.db` is never
 * opened (decision D17); the last case asserts exactly that for a bare import.
 */

/** The seven types, re-typed from docs/spec-api.md L13 — not imported from the router. */
const NAMES_TYPES = [
  'items',
  'spells',
  'npcs',
  'quests',
  'zones',
  'drop_tables',
  'strings',
] as const;

/** The valid-types list inside the unknown-type 404 message, in spec order. */
const VALID_TYPES_MESSAGE = NAMES_TYPES.join(', ');

/**
 * Expected LIST bodies, re-typed by hand from the lead's row-shape decision.
 * Repeating them literally (rather than deriving them) is what makes the test a
 * contract check for envelope key, row shape *and* deterministic ordering:
 * `ORDER BY <display column>, <primary key>`.
 */
const EXPECTED_LIST: Record<string, unknown[]> = {
  items: [
    { gid: 500, name: 'Fire Cat Robe' },
    { gid: 126913, name: 'Fire Cat Robe' },
    { gid: 4808, name: 'Twice Stitched Boots' },
    { gid: 77, name: 'apple' },
  ],
  spells: [
    { template_id: 5, name: 'Conviction' },
    { template_id: 9, name: 'Stun Block' },
    { template_id: 1143963608, name: 'Stun Block' },
  ],
  npcs: [
    { template_id: 7, name: 'Ambrose' },
    { template_id: 11, name: 'Judge Eddie' },
    { template_id: 1608380, name: 'Judge Eddie' },
  ],
  quests: [
    { quest_name: 'DS-ACAD-C01-003', title: 'The Bear Truth', level: 5, is_mainline: 0 },
    { quest_name: 'ZZ-1', title: 'The Bear Truth', level: 2, is_mainline: 0 },
    { quest_name: 'DS-ACAD-C01-001', title: 'Wizard Tours ', level: 1, is_mainline: 1 },
  ],
  zones: [
    { zone_path: 'Aquila/AQ_Z00_Hub', display_name: 'Aquila / AQ Z00 Hub', world: 'Aquila' },
    {
      zone_path: 'WizardCity/WC_Hub',
      display_name: 'Wizard City / WC Hub',
      world: 'WizardCity',
    },
    {
      zone_path: 'WizardCity/WC_Shop',
      display_name: 'Wizard City / WC Hub',
      world: 'WizardCity',
    },
  ],
  drop_tables: [
    { name: 'DS-ACAD-C01-001', description: null },
    { name: 'DS-ACAD-C01-002', description: null },
    { name: 'WC-UNICORN-SIDE-001', description: 'Pesky Pirates quest reward' },
  ],
  strings: [
    { key: 'Items_0001', value: 'Boots', category: 'Items' },
    { key: 'QuestTitle_1ED8A', value: 'Forged in Fire', category: 'QuestTitle' },
    { key: 'QuestTitle_126346', value: 'Letters of Light', category: 'QuestTitle' },
    { key: 'GUI_0001', value: 'boots', category: 'GUI' },
  ],
};

const OPEN: Db[] = [];

afterEach(() => {
  while (OPEN.length > 0) {
    OPEN.pop()?.close();
  }
});

/**
 * A fresh `:memory:` database seeded with a handful of rows per table — including
 * duplicate display names, so the primary-key tiebreak is observable.
 */
function memoryDb(): Db {
  const db = openDb({ file: MEMORY_DB });
  OPEN.push(db);

  const item = db.prepare('INSERT INTO items (gid, name) VALUES (?, ?)');
  item.run(4808, 'Twice Stitched Boots');
  item.run(126913, 'Fire Cat Robe');
  item.run(500, 'Fire Cat Robe');
  item.run(77, 'apple');

  const spell = db.prepare('INSERT INTO spells (template_id, name) VALUES (?, ?)');
  spell.run(1143963608, 'Stun Block');
  spell.run(9, 'Stun Block');
  spell.run(5, 'Conviction');

  const npc = db.prepare('INSERT INTO npcs (template_id, name) VALUES (?, ?)');
  npc.run(1608380, 'Judge Eddie');
  npc.run(11, 'Judge Eddie');
  npc.run(7, 'Ambrose');

  const quest = db.prepare(
    'INSERT INTO quests (quest_name, title, level, is_mainline) VALUES (?, ?, ?, ?)',
  );
  quest.run('DS-ACAD-C01-001', 'Wizard Tours ', 1, 1);
  quest.run('DS-ACAD-C01-003', 'The Bear Truth', 5, 0);
  quest.run('ZZ-1', 'The Bear Truth', 2, 0);

  const zone = db.prepare('INSERT INTO zones (zone_path, display_name, world) VALUES (?, ?, ?)');
  zone.run('WizardCity/WC_Hub', 'Wizard City / WC Hub', 'WizardCity');
  zone.run('WizardCity/WC_Shop', 'Wizard City / WC Hub', 'WizardCity');
  zone.run('Aquila/AQ_Z00_Hub', 'Aquila / AQ Z00 Hub', 'Aquila');

  const dropTable = db.prepare('INSERT INTO drop_tables (name, description) VALUES (?, ?)');
  dropTable.run('DS-ACAD-C01-001', null);
  dropTable.run('DS-ACAD-C01-002', null);
  dropTable.run('WC-UNICORN-SIDE-001', 'Pesky Pirates quest reward');

  const string = db.prepare('INSERT INTO string_table (key, value, category) VALUES (?, ?, ?)');
  string.run('QuestTitle_1ED8A', 'Forged in Fire', 'QuestTitle');
  string.run('QuestTitle_126346', 'Letters of Light', 'QuestTitle');
  string.run('Items_0001', 'Boots', 'Items');
  string.run('GUI_0001', 'boots', 'GUI');

  return db;
}

/**
 * The router mounted exactly where `routes/index.ts` puts it, plus the app-level
 * JSON 404 for unmatched `/api` paths — so the unencoded two-segment zone URL is
 * observable as the same `{"error":"Not found"}` the real app returns.
 */
function setup(): { db: Db; app: Express } {
  const db = memoryDb();
  const app = express();
  app.use(express.json());
  app.use('/api/names', createNamesRouter({ db }));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: NOT_FOUND_MESSAGE });
  });
  return { db, app };
}

describe('GET /api/names/:type', () => {
  it.each(NAMES_TYPES)(
    'serves %s as { "<type>": [rows] } with the documented row shape and order',
    async (type) => {
      const { app } = setup();

      const res = await request(app).get(`/api/names/${type}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^application\/json/);
      // The envelope key is the requested type name verbatim, and nothing else.
      expect(Object.keys(res.body)).toEqual([type]);
      expect(res.body).toEqual({ [type]: EXPECTED_LIST[type] });
    },
  );

  it.each(NAMES_TYPES)('returns a JSON array for %s', async (type) => {
    const { app } = setup();

    const res = await request(app).get(`/api/names/${type}`);

    expect(Array.isArray(res.body[type])).toBe(true);
  });

  it('is deterministic: the same request twice returns byte-identical bodies', async () => {
    const { app } = setup();

    const first = await request(app).get('/api/names/items');
    const second = await request(app).get('/api/names/strings');

    expect(first.text).toBe((await request(app).get('/api/names/items')).text);
    expect(second.text).toBe((await request(app).get('/api/names/strings')).text);
  });
});

describe('GET /api/names/:type/:id', () => {
  it('returns exactly one row object, never wrapped', async () => {
    const { app } = setup();

    const res = await request(app).get('/api/names/items/4808');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({ gid: 4808, name: 'Twice Stitched Boots' });
    expect(res.body.items).toBeUndefined();
  });

  it.each([
    ['items/4808', { gid: 4808, name: 'Twice Stitched Boots' }],
    ['spells/1143963608', { template_id: 1143963608, name: 'Stun Block' }],
    ['npcs/1608380', { template_id: 1608380, name: 'Judge Eddie' }],
    [
      'quests/DS-ACAD-C01-001',
      { quest_name: 'DS-ACAD-C01-001', title: 'Wizard Tours ', level: 1, is_mainline: 1 },
    ],
    [
      'zones/WizardCity%2FWC_Hub',
      { zone_path: 'WizardCity/WC_Hub', display_name: 'Wizard City / WC Hub', world: 'WizardCity' },
    ],
    [
      'drop_tables/WC-UNICORN-SIDE-001',
      { name: 'WC-UNICORN-SIDE-001', description: 'Pesky Pirates quest reward' },
    ],
    [
      'strings/QuestTitle_1ED8A',
      { key: 'QuestTitle_1ED8A', value: 'Forged in Fire', category: 'QuestTitle' },
    ],
  ])('resolves %s', async (path, expected) => {
    const { app } = setup();

    const res = await request(app).get(`/api/names/${path}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expected);
  });

  it('resolves a drop table row whose description is NULL', async () => {
    const { app } = setup();

    const res = await request(app).get('/api/names/drop_tables/DS-ACAD-C01-001');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'DS-ACAD-C01-001', description: null });
  });

  it.each([
    ['items/999999'],
    ['spells/999999'],
    ['npcs/999999'],
    ['quests/NOPE'],
    ['zones/WizardCity%2FWC_Missing'],
    ['drop_tables/NOPE'],
    ['strings/QuestTitle_MISSING'],
  ])('answers an unknown id (%s) with 404 { error }', async (path) => {
    const { app } = setup();

    const res = await request(app).get(`/api/names/${path}`);

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(Object.keys(res.body)).toEqual(['error']);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('echoes a missing string key in the 404 (the client renders the raw key instead)', async () => {
    const { app } = setup();

    const res = await request(app).get('/api/names/strings/QuestTitle_MISSING');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.stringContaining('QuestTitle_MISSING') });
  });

  it.each([
    ['items/abc'],
    ['spells/4.5'],
    ['npcs/12abc'],
    ['items/-1'],
    ['spells/99999999999999999999'],
  ])('answers an id that cannot be valid (%s) with 404, never 500', async (path) => {
    const { app } = setup();

    const res = await request(app).get(`/api/names/${path}`);

    expect(res.status).toBe(404);
    expect(Object.keys(res.body)).toEqual(['error']);
    expect(typeof res.body.error).toBe('string');
  });

  it('resolves a real text id that looks numeric for a text-keyed type', async () => {
    const { app } = setup();

    // `quests` ids are text: nothing is coerced, so a numeric-looking key still
    // goes through SQL as a string.
    const res = await request(app).get('/api/names/quests/ZZ-1');

    expect(res.status).toBe(200);
    expect(res.body.quest_name).toBe('ZZ-1');
  });
});

describe('unknown type', () => {
  it('answers 404 { error } listing every valid type', async () => {
    const { app } = setup();

    const res = await request(app).get('/api/names/widgets');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: `Unknown name type "widgets". Valid types: ${VALID_TYPES_MESSAGE}`,
    });
  });

  it('rejects an unknown type on the single lookup too', async () => {
    const { app } = setup();

    const res = await request(app).get('/api/names/widgets/1');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain(VALID_TYPES_MESSAGE);
  });

  it('reports the unknown type before a malformed query value', async () => {
    const { app } = setup();

    const res = await request(app).get('/api/names/widgets?limit=nope');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Unknown name type');
  });
});

describe('zone ids containing a slash', () => {
  it('resolves the encoded single segment', async () => {
    const { app } = setup();

    const res = await request(app).get('/api/names/zones/WizardCity%2FWC_Hub');

    expect(res.status).toBe(200);
    expect(res.body.zone_path).toBe('WizardCity/WC_Hub');
  });

  it('does not resolve the unencoded two-segment path (it falls through to the JSON 404)', async () => {
    const { app } = setup();

    const res = await request(app).get('/api/names/zones/WizardCity/WC_Hub');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: NOT_FOUND_MESSAGE });
  });
});

describe('?q= (optional list extension)', () => {
  it('filters items case-insensitively on the display column', async () => {
    const { app } = setup();

    const lower = await request(app).get('/api/names/items?q=fire cat');
    const upper = await request(app).get('/api/names/items?q=FIRE CAT');

    expect(lower.status).toBe(200);
    expect(lower.body).toEqual({
      items: [
        { gid: 500, name: 'Fire Cat Robe' },
        { gid: 126913, name: 'Fire Cat Robe' },
      ],
    });
    expect(upper.body).toEqual(lower.body);
  });

  it('matches strings on the key as well as the value', async () => {
    const { app } = setup();

    const byKey = await request(app).get('/api/names/strings?q=questtitle');
    const byValue = await request(app).get('/api/names/strings?q=boots');

    expect(byKey.status).toBe(200);
    expect(byKey.body.strings.map((row: { key: string }) => row.key)).toEqual([
      'QuestTitle_1ED8A',
      'QuestTitle_126346',
    ]);
    // Case-insensitive over values too: 'Boots' and 'boots' both match.
    expect(byValue.body.strings).toEqual([
      { key: 'Items_0001', value: 'Boots', category: 'Items' },
      { key: 'GUI_0001', value: 'boots', category: 'GUI' },
    ]);
  });

  it('treats the LIKE metacharacters as literals', async () => {
    const { app } = setup();

    const percent = await request(app).get('/api/names/items?q=%25');
    const underscore = await request(app).get('/api/names/items?q=_');

    expect(percent.status).toBe(200);
    expect(percent.body).toEqual({ items: [] });
    expect(underscore.body).toEqual({ items: [] });
  });

  it('returns an empty list (not a 404) when nothing matches', async () => {
    const { app } = setup();

    const res = await request(app).get('/api/names/items?q=nothing-matches-this');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  it('treats an empty q as no filter, exactly like the bare URL', async () => {
    const { app } = setup();

    const bare = await request(app).get('/api/names/items');
    const empty = await request(app).get('/api/names/items?q=');

    expect(empty.status).toBe(200);
    expect(empty.text).toBe(bare.text);
  });

  it('ignores unknown query parameters', async () => {
    const { app } = setup();

    const bare = await request(app).get('/api/names/zones');
    const extra = await request(app).get('/api/names/zones?foo=bar');

    expect(extra.status).toBe(200);
    expect(extra.text).toBe(bare.text);
  });

  it.each([['?q[a]=1'], ['?q=one&q=two']])(
    'rejects a non-single q (%s) with 400',
    async (query) => {
      const { app } = setup();

      const res = await request(app).get(`/api/names/items${query}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('"q"');
    },
  );
});

describe('?limit= (optional list extension)', () => {
  it('caps the rows of an ordered list', async () => {
    const { app } = setup();

    const res = await request(app).get('/api/names/items?limit=2');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [
        { gid: 500, name: 'Fire Cat Robe' },
        { gid: 126913, name: 'Fire Cat Robe' },
      ],
    });
  });

  it('composes with q (filter first, then cap)', async () => {
    const { app } = setup();

    const res = await request(app).get('/api/names/strings?q=questtitle&limit=1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      strings: [{ key: 'QuestTitle_1ED8A', value: 'Forged in Fire', category: 'QuestTitle' }],
    });
  });

  it('accepts a limit larger than the table', async () => {
    const { app } = setup();

    const res = await request(app).get('/api/names/quests?limit=1000');

    expect(res.status).toBe(200);
    expect(res.body.quests).toEqual(EXPECTED_LIST.quests);
  });

  it.each([
    ['limit=0'],
    ['limit=-1'],
    ['limit=abc'],
    ['limit=1.5'],
    ['limit='],
    ['limit=1e3'],
    ['limit=99999999999999999999'],
    ['limit=1&limit=2'],
  ])('rejects a malformed limit (%s) with 400 { error }', async (query) => {
    const { app } = setup();

    const res = await request(app).get(`/api/names/items?${query}`);

    expect(res.status).toBe(400);
    expect(Object.keys(res.body)).toEqual(['error']);
    expect(res.body.error).toContain('limit');
    // A rejected list request never leaks a partial envelope.
    expect(res.body.items).toBeUndefined();
  });

  it('leaves the bare URL response untouched', async () => {
    const { app } = setup();

    const bare = await request(app).get('/api/names/drop_tables');

    expect(bare.status).toBe(200);
    expect(bare.body).toEqual({ drop_tables: EXPECTED_LIST.drop_tables });
  });
});

describe('connection configuration', () => {
  it('sorts in memory, so a large ORDER BY never needs a SQLite temp file', () => {
    // Regression pin: with the default `temp_store = FILE` the 216,991-row
    // `strings` sort spills to /var/tmp and fails with "unable to open database
    // file" wherever that directory is not writable — a 500 on a read endpoint.
    const { db } = setup();

    expect(db.pragma('temp_store', { simple: true })).toBe(2); // 2 = MEMORY
  });
});

describe('lazy mount (decision D32)', () => {
  it('does not open the real database when the registry and app are merely imported', async () => {
    // The real connection on disk (absent on a fresh clone / CI) must not be
    // opened, seeded or touched.
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

  it('control: a names request really does go through the lazy mount', async () => {
    // Proves the assertion above is not vacuous — the spy observes `getDb()` the
    // moment a `/api/names` request reaches the registry. The implementation is
    // replaced, so this never opens the real database.
    vi.resetModules();
    const dbModule = await import('@server/db');
    const getDbSpy = vi.spyOn(dbModule, 'getDb').mockImplementation(() => {
      throw new Error('getDb reached');
    });
    const { app } = await import('@server/app');

    const res = await request(app).get('/api/names/items');

    expect(getDbSpy).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'getDb reached' });

    getDbSpy.mockRestore();
  });
});
