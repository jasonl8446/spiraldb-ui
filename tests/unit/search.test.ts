import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { OBJECT_TYPES } from '@shared/objectTypes';
import { MEMORY_DB, openDb, type Db } from '@server/db';
import { createSearchRouter } from '@server/routes/search';
import {
  parseSearchLimit,
  parseSearchQuery,
  searchAll,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_GROUPS,
  SEARCH_GROUP_TYPES,
  SEARCH_MAX_LIMIT,
  type SearchResult,
  type SearchResultRow,
} from '@server/services/search';

/**
 * Story p5-02 deliverable D1 — `GET /api/search?q=&limit=20`, the ⌘K palette's read
 * (plan task 5.2, decision D27, P5 AC#4).
 *
 * Every database here is `:memory:` (decision D17): the real `data/spiraldb-ui.db` — and
 * through it the owner's 79,835-row `items` table — is never opened, so nothing in this
 * suite can read or disturb it. The **performance** half of the AC is deliberately not
 * asserted here (a timing assertion is not a proof); it is measured against the real
 * tables and printed in `docs/evidence/phase-5/p5-02-d3-proof.md`.
 *
 * | the AC's words | arm | test |
 * |---|---|---|
 * | "typing a substring of a known quest name and of a known DropTable name returns both" | `DS-ACAD-C01-00` → one quest **and** one drop table | the criterion's own example |
 * | "grouped by type" | two named groups, in `SEARCH_GROUPS` order, labels verbatim | grouping |
 * | "status dots correct" | each row's `status` equals the seeded lifecycle value | the criterion's own example |
 * | "selecting a result lands on its detail page" | `object_type` + `object_key` are non-null exactly when a route exists | navigability |
 * | "`limit=20` respected" | no group exceeds `limit`; a one-type query is filled to exactly 20 | the limit |
 * | "< 300ms locally" | not here — measured on the real tables (D3) | — |
 *
 * The rest of the suite guards the hazards the story's brief names: a bad `limit` that is
 * clamped instead of 400'd, a palette-open (blank) query that scans ~121k rows, a
 * friendly-name row linked to a route that does not exist, and a `?q=%` that matches every
 * row instead of a percent sign.
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

/** Inserts one `entry_status` row. */
function seedEntry(db: Db, objectType: string, objectKey: string, status = 'extracted'): void {
  db.prepare('INSERT INTO entry_status (object_type, object_key, status) VALUES (?, ?, ?)').run(
    objectType,
    objectKey,
    status,
  );
}

/** Inserts one `quests` friendly-name row. */
function seedQuestName(db: Db, questName: string, title: string): void {
  db.prepare('INSERT INTO quests (quest_name, title) VALUES (?, ?)').run(questName, title);
}

/** Inserts one friendly-name row into `items` / `spells` / `npcs`. */
function seedName(db: Db, table: 'items' | 'spells' | 'npcs', id: number, name: string): void {
  const idColumn = table === 'items' ? 'gid' : 'template_id';
  db.prepare(`INSERT INTO ${table} (${idColumn}, name) VALUES (?, ?)`).run(id, name);
}

/**
 * The eight-row D4 vocabulary, hand-typed: the search's `groups[].type` must be exactly
 * this plus the three name-only keys, and the group order must start with `quest`.
 */
const D4_SINGULAR = [
  'quest',
  'drop_table',
  'npc_inventory',
  'npc_spell_inventory',
  'creature_spellbook',
  'npc_drop_table',
  'treasure_card_inventory',
  'zone_transfer',
];

/** The three name-only group keys, hand-typed (they are not D4 object types). */
const NAME_ONLY_GROUPS = ['item', 'spell', 'npc'];

/** The envelope's keys, hand-typed from the story's D1 record (never derived from the type). */
const ENVELOPE_KEYS = ['query', 'limit', 'total', 'truncated', 'unresolved', 'groups'];

/** One `results[]` row's keys, hand-typed for the same reason. */
const ROW_KEYS = [
  'object_type',
  'object_key',
  'label',
  'name',
  'source_id',
  'status',
  'matched_on',
];

/** Every row of every group, flattened — the assertions are about the row set as a whole. */
function allRows(result: SearchResult): SearchResultRow[] {
  return result.groups.flatMap((group) => group.results);
}

/** The `groups[].type` values, in order. */
function groupTypes(result: SearchResult): string[] {
  return result.groups.map((group) => group.type);
}

/** A bare Express app mounting only the search router — no `getDb()`, so no real database. */
function searchApp(db: Db): Express {
  const app = express();
  app.use('/api/search', createSearchRouter({ db }));
  return app;
}

/* ------------------------------------------------------------- the criterion */

describe('the acceptance criterion’s own example', () => {
  it('returns a quest and a DropTable for one substring, grouped, with the seeded statuses', () => {
    const db = memoryDb();
    seedEntry(db, 'quest', 'DS-ACAD-C01-001', 'reviewed');
    seedEntry(db, 'quest', 'DS-ACAD-C01-002', 'extracted');
    seedEntry(db, 'drop_table', 'DS-ACAD-C01-002', 'extracted');
    seedQuestName(db, 'DS-ACAD-C01-001', 'Wizard Tours');
    seedQuestName(db, 'DS-ACAD-C01-002', 'Headless Rider');

    const result = searchAll(db, { q: 'DS-ACAD-C01-00', limit: 20 });

    // Both families, in the fixed group order (Quests first) — the criterion's
    // "returns both, grouped by type" read literally.
    expect(groupTypes(result)).toEqual(['quest', 'drop_table']);
    expect(result.groups[0]?.label).toBe('Quests');
    expect(result.groups[1]?.label).toBe('Drop Tables');

    const quests = result.groups[0]?.results ?? [];
    expect(quests.map((row) => row.object_key)).toEqual(['DS-ACAD-C01-001', 'DS-ACAD-C01-002']);
    // Every quest row is navigable and carries its dot's value.
    expect(quests.map((row) => row.object_type)).toEqual(['quest', 'quest']);
    expect(quests.map((row) => row.status)).toEqual(['reviewed', 'extracted']);
    // The title joined in, so the palette can show it beside the key.
    expect(quests.map((row) => row.name)).toEqual(['Wizard Tours', 'Headless Rider']);
    expect(quests.every((row) => row.matched_on === 'key')).toBe(true);

    const dropTables = result.groups[1]?.results ?? [];
    expect(dropTables).toHaveLength(1);
    expect(dropTables[0]).toMatchObject({
      object_type: 'drop_table',
      object_key: 'DS-ACAD-C01-002',
      label: 'DS-ACAD-C01-002',
      name: null,
      source_id: null,
      status: 'extracted',
      matched_on: 'key',
    });

    expect(result.query).toBe('DS-ACAD-C01-00');
    expect(result.limit).toBe(20);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.unresolved).toBe(0);
  });

  it('reads the same quest out of two tables without returning it twice', () => {
    const db = memoryDb();
    seedEntry(db, 'quest', 'DS-ACAD-C01-002', 'extracted');
    seedQuestName(db, 'DS-ACAD-C01-002', 'DS-ACAD-C01-002 Headless Rider');

    // The query matches BOTH the key and the joined title, which the one query's
    // `WHERE (… OR …)` admits once — there is no second table to dedupe against.
    const result = searchAll(db, { q: 'DS-ACAD-C01-002', limit: 20 });

    expect(result.total).toBe(1);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.results[0]?.matched_on).toBe('key');
  });
});

/* ---------------------------------------------------------------- the groups */

describe('grouping', () => {
  it('is the fixed order: Quests, the seven generic families, then the name-only three', () => {
    expect([...SEARCH_GROUP_TYPES]).toEqual([...D4_SINGULAR, ...NAME_ONLY_GROUPS]);
    expect(SEARCH_GROUPS.map((group) => group.label)).toEqual([
      'Quests',
      'Drop Tables',
      'NPC Inventories',
      'NPC Spell Inventories',
      'Creature Spellbooks',
      'NPC Drop Tables',
      'Treasure Card Inventories',
      'Zone Transfers',
      'Items',
      'Spells',
      'NPCs',
    ]);
  });

  it('omits a group that matched nothing, and keeps the matched groups in that order', () => {
    const db = memoryDb();
    seedName(db, 'items', 4, 'Obsidian Amulet');
    seedEntry(db, 'zone_transfer', 'WizardCity/Amulet_Hub');
    seedEntry(db, 'quest', 'Amulet-C01-001');

    const result = searchAll(db, { q: 'amulet', limit: 20 });

    expect(groupTypes(result)).toEqual(['quest', 'zone_transfer', 'item']);
    // The group's own label travels with it, so the client needs no second table.
    expect(result.groups.map((group) => group.label)).toEqual([
      'Quests',
      'Zone Transfers',
      'Items',
    ]);
  });

  it('carries the envelope’s and a row’s exact wire keys', () => {
    const db = memoryDb();
    seedEntry(db, 'npc_inventory', '87112', 'reviewed');

    const result = searchAll(db, { q: '8711', limit: 20 });
    const row = allRows(result)[0];

    expect(Object.keys(result)).toEqual(ENVELOPE_KEYS);
    expect(row).toBeDefined();
    expect(Object.keys(row as object)).toEqual(ROW_KEYS);
  });
});

/* ------------------------------------------------------- the friendly-name arm */

describe('the friendly-name arm', () => {
  it('returns items/spells/npcs rows as informational — no type, no key, no status', () => {
    const db = memoryDb();
    seedName(db, 'items', 4, 'Obsidian Amulet');
    seedName(db, 'spells', 5001, 'Amulet Ward');
    seedName(db, 'npcs', 9001, 'Amulet Vendor');

    const result = searchAll(db, { q: 'amulet', limit: 20 });

    expect(groupTypes(result)).toEqual(['item', 'spell', 'npc']);
    const rows = allRows(result);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      // The whole point: there is no `/items/:gid` page, so a name hit claims no route.
      expect(row.object_type).toBeNull();
      expect(row.object_key).toBeNull();
      expect(row.status).toBeNull();
      expect(row.matched_on).toBe('name');
      expect(row.label).toBe(row.name);
      expect(row.source_id).toBeTypeOf('string');
    }
    expect(rows.map((row) => row.source_id)).toEqual(['4', '5001', '9001']);
    // Every one of them is counted, so the palette can say "shown without a link".
    expect(result.unresolved).toBe(3);
  });

  it('identifies a row by its own id, because friendly names are not unique', () => {
    const db = memoryDb();
    seedName(db, 'items', 7, 'Obsidian Amulet');
    seedName(db, 'items', 4, 'Obsidian Amulet');

    const result = searchAll(db, { q: 'obsidian amulet', limit: 20 });

    expect(result.groups[0]?.results.map((row) => row.source_id)).toEqual(['4', '7']);
    expect(result.total).toBe(2);
  });

  it('does not count a navigable quest-title hit as unresolved', () => {
    const db = memoryDb();
    seedEntry(db, 'quest', 'DS-ACAD-C01-002', 'extracted');
    seedQuestName(db, 'DS-ACAD-C01-002', 'Headless Rider');
    seedName(db, 'npcs', 9002, 'Headless Horseman');

    const result = searchAll(db, { q: 'headless', limit: 20 });

    const quest = result.groups[0]?.results[0];
    expect(quest).toMatchObject({
      object_type: 'quest',
      object_key: 'DS-ACAD-C01-002',
      label: 'DS-ACAD-C01-002',
      name: 'Headless Rider',
      status: 'extracted',
      matched_on: 'name',
    });
    // The quest is reachable; only the NPC name is not.
    expect(result.unresolved).toBe(1);
  });

  it('matches the quests table’s title, not only the object key', () => {
    const db = memoryDb();
    seedEntry(db, 'quest', 'WC-TUT-C03-001', 'verified');
    seedQuestName(db, 'WC-TUT-C03-001', 'Tutorial Time');

    const result = searchAll(db, { q: 'tutorial time', limit: 20 });

    expect(groupTypes(result)).toEqual(['quest']);
    expect(result.groups[0]?.results[0]).toMatchObject({
      object_key: 'WC-TUT-C03-001',
      name: 'Tutorial Time',
      status: 'verified',
      matched_on: 'name',
    });
  });

  it('never returns a quest that has no entry_status row — its route and dot both come from one', () => {
    const db = memoryDb();
    // A `quests` row with no parent: the file may or may not exist, and there is no
    // lifecycle value to put in the dot. The search's row set is the tracked spine.
    seedQuestName(db, 'WC-COMMONS-MAIN-002-BALANCE', 'To Ravenwood!');

    const result = searchAll(db, { q: 'ravenwood', limit: 20 });

    expect(result.groups).toEqual([]);
    expect(result.total).toBe(0);
  });
});

/* ----------------------------------------------------------------- the limit */

describe('the limit', () => {
  /** 25 quests and 25 drop tables all matching `zz`, so both groups overflow 20. */
  function seedOverflow(db: Db): void {
    for (let i = 1; i <= 25; i += 1) {
      const key = `ZZ-${String(i).padStart(3, '0')}`;
      seedEntry(db, 'quest', key);
      seedEntry(db, 'drop_table', key);
    }
  }

  it('caps each group, so every matching type survives a query two types match', () => {
    const db = memoryDb();
    seedOverflow(db);

    const result = searchAll(db, { q: 'zz', limit: 20 });

    expect(groupTypes(result)).toEqual(['quest', 'drop_table']);
    expect(result.groups.map((group) => group.results.length)).toEqual([20, 20]);
    expect(result.total).toBe(40);
    expect(result.truncated).toBe(true);
    // Ordering inside the group is the key ascending (rank is uniform here).
    expect(result.groups[0]?.results[0]?.object_key).toBe('ZZ-001');
    expect(result.groups[0]?.results[19]?.object_key).toBe('ZZ-020');
  });

  it('fills a one-type query to exactly 20 and reports no truncation when it is complete', () => {
    const db = memoryDb();
    for (let i = 1; i <= 25; i += 1) {
      seedName(db, 'items', i, `Amulet ${String(i).padStart(3, '0')}`);
    }

    const capped = searchAll(db, { q: 'amulet', limit: 20 });
    expect(capped.total).toBe(20);
    expect(capped.groups.map((group) => group.results.length)).toEqual([20]);
    // 25 matched and only 20 are shown, so the client can say "showing the first 20".
    expect(capped.truncated).toBe(true);

    // The positive partner of the same arm: a complete result is NOT truncated, which is
    // what stops `truncated` from being permanently true.
    expect(searchAll(db, { q: 'amulet 025', limit: 20 }).truncated).toBe(false);
    expect(searchAll(db, { q: 'amulet', limit: 30 }).total).toBe(25);
    expect(searchAll(db, { q: 'amulet', limit: 30 }).truncated).toBe(false);
  });

  it('defaults to 20 when no limit is given, and echoes the applied cap', () => {
    const db = memoryDb();
    for (let i = 1; i <= 25; i += 1) {
      seedName(db, 'items', i, `Amulet ${String(i).padStart(3, '0')}`);
    }

    const result = searchAll(db, { q: 'amulet' });
    expect(result.limit).toBe(SEARCH_DEFAULT_LIMIT);
    expect(SEARCH_DEFAULT_LIMIT).toBe(20);
    expect(result.total).toBe(20);
    expect(searchAll(db, { q: 'amulet', limit: 3 }).limit).toBe(3);
  });

  it('accepts a value up to the ceiling and rejects one above it by name', () => {
    expect(parseSearchLimit('50')).toEqual({ ok: true, limit: 50 });
    expect(SEARCH_MAX_LIMIT).toBe(50);
    expect(parseSearchLimit('51')).toEqual({
      ok: false,
      error: `Invalid limit "51": limit must be at most ${SEARCH_MAX_LIMIT}`,
    });
  });

  it.each(['', 'abc', '1.5', '-1', '0', ' 1', '+1', '1e3', '20.0', '0x10'])(
    'rejects the malformed limit %j with a 400-shaped error, never a clamp',
    (raw) => {
      const parsed = parseSearchLimit(raw);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error).toContain(`Invalid limit "${raw}"`);
      }
    },
  );

  it('rejects a repeated limit parameter (an array) as a 400', () => {
    expect(parseSearchLimit(['1', '2'])).toEqual({
      ok: false,
      error: 'Query parameter "limit" must be a single positive integer',
    });
  });
});

/* -------------------------------------------------------------- the query text */

describe('the query', () => {
  it('returns an empty envelope for an absent or blank query, and prepares no statement', () => {
    const db = memoryDb();
    seedName(db, 'items', 4, 'Obsidian Amulet');

    // A `Db` that explodes the moment a statement is prepared: the assertion is that a
    // palette opening with no query does **zero** database work (the real tables behind
    // this endpoint hold 123,640 rows). The cast is confined to this one probe.
    let preparations = 0;
    const counting = {
      prepare(sql: string): never {
        preparations += 1;
        throw new Error(`a blank query prepared a statement: ${sql}`);
      },
    } as unknown as Db;

    for (const q of ['', '   ', '\t\n ']) {
      const result = searchAll(counting, { q });
      expect(result).toEqual({
        query: '',
        limit: SEARCH_DEFAULT_LIMIT,
        total: 0,
        truncated: false,
        unresolved: 0,
        groups: [],
      });
    }
    expect(preparations).toBe(0);

    // The positive partner: the same probe DOES prepare for a real query, so the
    // zero above is the guard working rather than the probe being inert.
    expect(() => searchAll(counting, { q: 'amulet' })).toThrow(/prepared a statement/);
    expect(preparations).toBe(1);

    // And the endpoint answers 200 for the blank query rather than an error.
    expect(searchAll(db, { q: '' }).groups).toEqual([]);
  });

  it('trims the query and echoes what it actually searched', () => {
    const db = memoryDb();
    seedEntry(db, 'quest', 'DS-ACAD-C01-001');

    expect(searchAll(db, { q: '  DS-ACAD-C01-001  ' }).query).toBe('DS-ACAD-C01-001');
    expect(searchAll(db, { q: '  DS-ACAD-C01-001  ' }).total).toBe(1);
  });

  it('matches case-insensitively, in both arms, in every direction', () => {
    const db = memoryDb();
    seedEntry(db, 'quest', 'DS-ACAD-C01-001', 'reviewed');
    seedQuestName(db, 'DS-ACAD-C01-001', 'Wizard Tours');
    seedName(db, 'items', 4, 'Obsidian Amulet');

    for (const q of ['DS-ACAD', 'ds-acad', 'Ds-AcAd']) {
      expect(searchAll(db, { q }).groups[0]?.results[0]?.object_key).toBe('DS-ACAD-C01-001');
    }
    for (const q of ['wizard tours', 'WIZARD TOURS']) {
      expect(searchAll(db, { q }).groups[0]?.results[0]?.matched_on).toBe('name');
    }
    expect(searchAll(db, { q: 'oBsIdIaN aMuLeT' }).groups[0]?.results[0]?.source_id).toBe('4');
  });

  it('treats LIKE’s metacharacters as literals', () => {
    const db = memoryDb();
    seedName(db, 'items', 1, '100% Pure Mana');
    seedName(db, 'items', 2, 'Plain Mana');
    seedName(db, 'items', 3, 'Under_scored Mana');

    // `%` is the wildcard that would match every row if it were not escaped.
    const percent = searchAll(db, { q: '%' });
    expect(percent.total).toBe(1);
    expect(percent.groups[0]?.results[0]?.source_id).toBe('1');

    const underscore = searchAll(db, { q: '_' });
    expect(underscore.total).toBe(1);
    expect(underscore.groups[0]?.results[0]?.source_id).toBe('3');

    // The positive partner: a literal `Mana` does match all three, so the two above are
    // narrow because `%`/`_` were literals, not because the arm is broken.
    expect(searchAll(db, { q: 'mana' }).total).toBe(3);
  });

  it('answers an empty result set — not an error — when nothing matches', () => {
    const db = memoryDb();
    seedEntry(db, 'quest', 'DS-ACAD-C01-001');
    seedName(db, 'items', 4, 'Obsidian Amulet');

    const result = searchAll(db, { q: 'zzzz-no-such-thing' });

    expect(result).toEqual({
      query: 'zzzz-no-such-thing',
      limit: SEARCH_DEFAULT_LIMIT,
      total: 0,
      truncated: false,
      unresolved: 0,
      groups: [],
    });
  });
});

/* ----------------------------------------------------------------- ordering */

describe('ordering inside a group', () => {
  it('ranks an exact match, then a prefix, then a substring, then the key ascending', () => {
    const db = memoryDb();
    for (const key of ['XX-AB', 'AB-XX', 'AB', 'AB-YY']) {
      seedEntry(db, 'quest', key);
    }

    const result = searchAll(db, { q: 'ab' });

    expect(result.groups[0]?.results.map((row) => row.object_key)).toEqual([
      'AB',
      'AB-XX',
      'AB-YY',
      'XX-AB',
    ]);
  });

  it('breaks a name-group tie on the name and then the id, because names repeat', () => {
    const db = memoryDb();
    seedName(db, 'spells', 30, 'Amulet Ward');
    seedName(db, 'spells', 10, 'Amulet Ward');
    seedName(db, 'spells', 20, 'Amulet');

    const result = searchAll(db, { q: 'amulet' });

    expect(result.groups[0]?.results.map((row) => [row.label, row.source_id])).toEqual([
      ['Amulet', '20'],
      ['Amulet Ward', '10'],
      ['Amulet Ward', '30'],
    ]);
  });
});

/* ------------------------------------------------------------------ the route */

describe('GET /api/search through the router', () => {
  it('answers the envelope with 200', async () => {
    const db = memoryDb();
    seedEntry(db, 'quest', 'DS-ACAD-C01-001', 'reviewed');
    seedEntry(db, 'drop_table', 'DS-ACAD-C01-001', 'extracted');

    const response = await request(searchApp(db)).get('/api/search?q=DS-ACAD-C01-001');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      query: 'DS-ACAD-C01-001',
      limit: 20,
      total: 2,
      truncated: false,
      unresolved: 0,
    });
    expect(response.body.groups.map((group: { type: string }) => group.type)).toEqual([
      'quest',
      'drop_table',
    ]);
  });

  it('applies ?limit= and echoes it', async () => {
    const db = memoryDb();
    for (let i = 1; i <= 5; i += 1) {
      seedEntry(db, 'quest', `AB-${String(i)}`);
    }

    const response = await request(searchApp(db)).get('/api/search?q=ab&limit=2');

    expect(response.status).toBe(200);
    expect(response.body.limit).toBe(2);
    expect(response.body.total).toBe(2);
    expect(response.body.truncated).toBe(true);
  });

  it.each([
    ['limit=51', 'at most 50'],
    ['limit=0', 'positive integer'],
    ['limit=abc', 'positive integer'],
    ['limit=', 'positive integer'],
    ['limit=1&limit=2', 'single positive integer'],
  ])('answers 400 with the { error } envelope for ?%s', async (query, fragment) => {
    const db = memoryDb();

    const response = await request(searchApp(db)).get(`/api/search?q=ab&${query}`);

    expect(response.status).toBe(400);
    expect(Object.keys(response.body)).toEqual(['error']);
    expect(response.body.error).toContain(fragment);
    // A 400 body has no results at all — nothing was clamped and returned.
    expect(response.body.groups).toBeUndefined();
  });

  it('answers 400 for a repeated q, and 200 for a blank one', async () => {
    const db = memoryDb();
    seedEntry(db, 'quest', 'AB-1');
    const app = searchApp(db);

    const repeated = await request(app).get('/api/search?q=a&q=b');
    expect(repeated.status).toBe(400);
    expect(repeated.body.error).toBe('Query parameter "q" must be a single string value');

    const blank = await request(app).get('/api/search?q=');
    expect(blank.status).toBe(200);
    expect(blank.body).toMatchObject({ query: '', total: 0, groups: [] });

    const absent = await request(app).get('/api/search');
    expect(absent.status).toBe(200);
    expect(absent.body).toMatchObject({ query: '', total: 0, groups: [] });
  });
});

/* ------------------------------------------------------------- the parsing unit */

describe('parseSearchQuery', () => {
  it('defaults q to blank and limit to 20', () => {
    expect(parseSearchQuery()).toEqual({ ok: true, q: '', limit: SEARCH_DEFAULT_LIMIT });
    expect(parseSearchQuery({ q: '  acad  ' })).toEqual({ ok: true, q: 'acad', limit: 20 });
    expect(parseSearchQuery({ q: 'acad', limit: '5' })).toEqual({ ok: true, q: 'acad', limit: 5 });
  });

  it('reports the limit’s own error verbatim', () => {
    const parsed = parseSearchQuery({ q: 'acad', limit: '999' });
    expect(parsed).toEqual({
      ok: false,
      error: `Invalid limit "999": limit must be at most ${SEARCH_MAX_LIMIT}`,
    });
  });

  it('rejects a non-string q rather than searching one of its values', () => {
    expect(parseSearchQuery({ q: ['a', 'b'] })).toEqual({
      ok: false,
      error: 'Query parameter "q" must be a single string value',
    });
  });
});

/* -------------------------------- the widened name arm (story p6-06, D105/P6-16) */

/** Inserts one `zones` friendly-name row. */
function seedZone(db: Db, zonePath: string, displayName: string): void {
  db.prepare('INSERT INTO zones (zone_path, display_name) VALUES (?, ?)').run(
    zonePath,
    displayName,
  );
}

/** Inserts one `string_table` row (`WC-NPCs_…` and the persona components). */
function seedString(db: Db, key: string, value: string, category: string): void {
  db.prepare('INSERT INTO string_table (key, value, category) VALUES (?, ?, ?)').run(
    key,
    value,
    category,
  );
}

/** The one group of a type, or `undefined` when it did not match. */
function group(result: SearchResult, type: string) {
  return result.groups.find((entry) => entry.type === type);
}

/**
 * `SEARCH_GROUPS` gains a `nameJoin` for every family that has a friendly source — the
 * four `TemplateID` families (`npcs`), ZoneTransfer (`zones`) and CreatureSpellbook
 * (`decks`, added by task 6.9) — and for no other family, because the join is *derived*
 * from `shared/objectTypes.ts`'s `friendlyNamesType` rather than hand-listed
 * (spec-api L769-785).
 */
describe('the join table is the friendly-name table, per family', () => {
  it('is non-null exactly for the families whose friendlyNamesType is set', () => {
    for (const group of SEARCH_GROUPS) {
      if (group.kind !== 'object' || group.type === 'quest') {
        continue;
      }
      const config = OBJECT_TYPES.find((row) => row.objectType === group.type);
      expect(config, group.type).toBeDefined();
      if (config?.friendlyNamesType === null || config === undefined) {
        expect(group.nameJoin, `${group.type} has no friendly source`).toBeNull();
      } else {
        expect(group.nameJoin?.table, `${group.type} joins ${config.friendlyNamesType}`).toBe(
          config.friendlyNamesType,
        );
      }
    }
    // Hand-typed: quest (joined since p5-02) plus the six Phase 6 joins — CreatureSpellbook's
    // `decks` join arrived with task 6.9 — and the families deliberately left out (drop_table,
    // and the unkeyed global_registry, which has no search group at all).
    const joined = SEARCH_GROUPS.filter(
      (group) => group.kind === 'object' && group.nameJoin !== null,
    ).map((group) => group.type);
    expect(joined.sort()).toEqual([
      'creature_spellbook',
      'npc_drop_table',
      'npc_inventory',
      'npc_spell_inventory',
      'quest',
      'treasure_card_inventory',
      'zone_transfer',
    ]);
  });

  it('matches a template id by key and the NPC name by name, on the same family', () => {
    const db = memoryDb();
    seedEntry(db, 'npc_inventory', '38168', 'reviewed');
    seedName(db, 'npcs', 38168, 'Merle Ambrose');

    // The key arm: the CAST is what makes this row visible at all (SQLite orders every
    // integer below every text value, so `template_id = object_key` matches nothing).
    const byKey = group(searchAll(db, { q: '38168', limit: 20 }), 'npc_inventory');
    expect(byKey?.results).toEqual([
      {
        object_type: 'npc_inventory',
        object_key: '38168',
        label: '38168',
        name: 'Merle Ambrose',
        source_id: null,
        status: 'reviewed',
        matched_on: 'key',
      },
    ]);

    // The name arm, and the same row is still *navigable* — a real object key.
    const byName = group(searchAll(db, { q: 'merle', limit: 20 }), 'npc_inventory');
    expect(byName?.results).toEqual([
      {
        object_type: 'npc_inventory',
        object_key: '38168',
        label: '38168',
        name: 'Merle Ambrose',
        source_id: null,
        status: 'reviewed',
        matched_on: 'name',
      },
    ]);
  });

  it('does the same for the other three TemplateID families and ZoneTransfer', () => {
    const db = memoryDb();
    for (const [type, key] of [
      ['npc_spell_inventory', '38169'],
      ['npc_drop_table', '38170'],
      ['treasure_card_inventory', '38214'],
    ] as const) {
      seedEntry(db, type, key);
    }
    seedName(db, 'npcs', 38169, 'Dworgyn');
    seedName(db, 'npcs', 38170, 'Mindy Pixiecrown');
    seedName(db, 'npcs', 38214, 'Harold Argleston');
    seedEntry(db, 'zone_transfer', 'DragonSpire/DS_A2_Battle/DS_A2Z3_Detention');
    seedZone(
      db,
      'DragonSpire/DS_A2_Battle/DS_A2Z3_Detention',
      'Dragon Spire / DS A2 Battle / DS A2Z3 Detention',
    );

    for (const [type, key, name] of [
      ['npc_spell_inventory', '38169', 'Dworgyn'],
      ['npc_drop_table', '38170', 'Mindy Pixiecrown'],
      ['treasure_card_inventory', '38214', 'Harold Argleston'],
    ] as const) {
      const hit = group(searchAll(db, { q: name, limit: 20 }), type)?.results ?? [];
      expect(hit, `${type} by name`).toEqual([
        {
          object_type: type,
          object_key: key,
          label: key,
          name,
          source_id: null,
          status: 'extracted',
          matched_on: 'name',
        },
      ]);
      const byKey = group(searchAll(db, { q: key, limit: 20 }), type)?.results ?? [];
      expect(byKey[0]?.matched_on, `${type} by key`).toBe('key');
    }

    // ZoneTransfer: the label's own spaces make the name arm discriminating — the query
    // `Dragon Spire` cannot match the `DragonSpire/…` path.
    const zoneByKey = group(searchAll(db, { q: 'DS_A2Z3_Detention', limit: 20 }), 'zone_transfer');
    expect(zoneByKey?.results[0]?.matched_on).toBe('key');
    expect(zoneByKey?.results[0]?.name).toBe('Dragon Spire / DS A2 Battle / DS A2Z3 Detention');
    const zoneByName = group(searchAll(db, { q: 'Dragon Spire', limit: 20 }), 'zone_transfer');
    expect(zoneByName?.results[0]?.matched_on).toBe('name');
    expect(zoneByName?.results[0]?.object_key).toBe('DragonSpire/DS_A2_Battle/DS_A2Z3_Detention');
  });

  it('gives drop_table no name arm, on purpose, and CreatureSpellbook one from `decks`', () => {
    const db = memoryDb();
    // A drop table whose key is its name — `description` is NULL in 316 of 317 rows, so a
    // name arm over the key could only duplicate the key arm (spec-api L781-783).
    seedEntry(db, 'drop_table', 'WC-UNICORN-MAIN-007');
    db.prepare('INSERT INTO drop_tables (name, description) VALUES (?, ?)').run(
      'WC-UNICORN-MAIN-007',
      'Pesky Pirates quest reward',
    );
    expect(group(searchAll(db, { q: 'Pesky Pirates', limit: 20 }), 'drop_table')).toBeUndefined();
    expect(
      group(searchAll(db, { q: 'WC-UNICORN', limit: 20 }), 'drop_table')?.results,
    ).toHaveLength(1);

    // CreatureSpellbook joins `decks` (task 6.9). The deck name arm is the only way a row
    // whose `DeckName` is not the whole label becomes findable by name…
    seedEntry(db, 'creature_spellbook', 'Polymorph Gobbler');
    db.prepare(
      'INSERT INTO decks (template_id, deck_name, name, source_path) VALUES (?, ?, ?, ?)',
    ).run(
      4242,
      'Polymorph Gobbler',
      'Polymorph Gobbler',
      'Decks/Polymorph Decks/Polymorph Gobbler.xml',
    );
    const deck = group(searchAll(db, { q: 'Polymorph', limit: 20 }), 'creature_spellbook');
    expect(deck?.results[0]?.name).toBe('Polymorph Gobbler');
    // …and the deck arm is what a key-only row still answers to.
    seedEntry(db, 'creature_spellbook', 'Mdeck-D-R2');
    const unmapped = group(searchAll(db, { q: 'Mdeck-D', limit: 20 }), 'creature_spellbook');
    expect(unmapped?.results[0]?.name).toBeNull();
    expect(unmapped?.results[0]?.matched_on).toBe('key');
  });
});

/* ---------------------------------------------------- the NPC namespace (P6-17) */

/**
 * The `npc` group is the alias-keyed namespace, not a `npcs` name list: one row per NPC,
 * its strings as aliases. The measured pair (`Gretta` / `Gretta Darkkettle`) is the
 * negative control for the failure the plan names — "one NPC carries several name strings
 * at different granularities … a search for Gretta returns duplicates".
 */
describe('the npc group: one row per NPC, its strings as aliases', () => {
  function grettaDb(): Db {
    const db = memoryDb();
    seedName(db, 'npcs', 38098, 'Gretta Darkkettle');
    seedString(db, 'WC-NPCs_00000003', 'Gretta Darkkettle', 'WC-NPCs');
    seedString(db, 'WC-NPCs_00000009', 'Gretta', 'WC-NPCs');
    seedString(db, 'Persona,First_00000019', 'Gretta', 'Persona,First');
    return db;
  }

  it('returns exactly one row for Gretta, carrying both strings', () => {
    const db = grettaDb();
    const npc = group(searchAll(db, { q: 'Gretta', limit: 20 }), 'npc');
    expect(npc?.results).toHaveLength(1);
    expect(npc?.results[0]).toEqual({
      object_type: null,
      object_key: null,
      label: 'Gretta Darkkettle',
      name: 'Gretta Darkkettle',
      source_id: 'WC-NPCs_00000003',
      status: null,
      matched_on: 'name',
      aliases: ['Gretta', 'Gretta Darkkettle'],
    });
    // The informational contract is unchanged: the app has no `/npcs/:id` page, so the
    // row is counted as unresolved rather than linked.
    const result = searchAll(db, { q: 'Gretta', limit: 20 });
    expect(result.unresolved).toBe(1);
    expect(result.total).toBe(1);
  });

  it('is one row whichever granularity matched, and the alias is the display name', () => {
    const db = grettaDb();
    for (const q of ['Gretta Darkkettle', 'gretta', 'Darkkettle']) {
      const npc = group(searchAll(db, { q, limit: 20 }), 'npc');
      expect(npc?.results.length, q).toBe(1);
      expect(npc?.results[0]?.name, q).toBe('Gretta Darkkettle');
      expect(npc?.results[0]?.aliases, q).toContain('Gretta');
    }
  });

  it('matches a template name as well as an alias, and never the template id', () => {
    const db = grettaDb();
    // `Zarek` exists only as a template name (no alias row at all).
    seedName(db, 'npcs', 126322, 'Zarek Pickmaster');
    const zarek = group(searchAll(db, { q: 'Zarek', limit: 20 }), 'npc');
    expect(zarek?.results[0]?.name).toBe('Zarek Pickmaster');
    expect(zarek?.results[0]?.source_id).toBe('126322');
    // The spec's group matches aliases and template names, not the id (spec-api L537-539);
    // the id is the four families' join arm and the names API's search.
    expect(group(searchAll(db, { q: '126322', limit: 20 }), 'npc')).toBeUndefined();
  });

  it('adds `aliases` to the npc row and to no other row', () => {
    const db = grettaDb();
    seedEntry(db, 'quest', 'DS-ACAD-C01-001');
    seedQuestName(db, 'DS-ACAD-C01-001', 'Gretta Tours');
    const result = searchAll(db, { q: 'Gretta', limit: 20 });
    for (const row of allRows(result)) {
      const keys = Object.keys(row);
      if (keys.includes('aliases')) {
        expect(row.object_type, 'only the npc group carries aliases').toBeNull();
        expect(row.aliases?.length).toBeGreaterThan(0);
      } else {
        expect([...ROW_KEYS].sort(), 'the other groups keep their exact wire shape').toEqual(
          [...keys].sort(),
        );
      }
    }
  });
});
