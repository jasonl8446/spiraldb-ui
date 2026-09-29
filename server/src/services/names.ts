import type { QuestValidationReferences } from '../../../shared/quest/validation.js';
import type { Db } from '../db.js';

/**
 * Names data access — the seven friendly-name lookups behind `GET /api/names/:type`
 * and `GET /api/names/:type/:id` (task 1.5, docs/spec-api.md L5-44).
 *
 * The spec only exemplifies `items`; for the other six types the requested shape
 * is the lead's table-driven mapping — the table's primary-key column as the
 * id-like field plus its human-readable column(s) — copied from
 * `server/migrations/0001_init.sql`. Everything here is driven by
 * `NAMES_TYPE_SPECS`, so no table name, column name or identifier ever reaches
 * SQL from a request: only *values* are bound.
 *
 * Two optional LIST extensions sit on top of the spec shape (a bare URL is
 * byte-identical to the spec): `?q=<substring>` filters case-insensitively and
 * `?limit=<n>` caps the rows. Neither changes the envelope — `{ "<type>": [...] }`
 * — or the single-lookup body.
 */

/** The seven name types a client may request (docs/spec-api.md L13). */
export const NAMES_TYPES = [
  'items',
  'spells',
  'npcs',
  'quests',
  'zones',
  'drop_tables',
  'strings',
] as const;

export type NamesType = (typeof NAMES_TYPES)[number];

/** How a `:id` path segment is validated *before* it becomes a bound value. */
export type NamesIdKind = 'integer' | 'text';

export interface NamesTypeSpec {
  /** SQLite table holding the rows (`strings` reads `string_table`). */
  table: string;
  /** Primary-key column — the id-like field of every returned row. */
  idColumn: string;
  /** Response row columns, in the documented key order. */
  selectColumns: readonly string[];
  /**
   * Column the list is ordered by, and the one `?q=` matches (unless
   * `searchColumns` widens that).
   *
   * For six of the seven types this is the table's human-readable column. For
   * `drop_tables` it is `name`, not `description`: `description` is NULL in
   * 316 of the 317 rows in the live database, so ordering/filtering on it would
   * be a dead column (measured 2026-09-26, task 1.5).
   */
  labelColumn: string;
  /**
   * Columns `?q=` matches.
   *
   * **Widened by D105/P6-16 (story p6-06) to the id column as well** — "every
   * search matches either the friendly or the technical value" (spec-api L55-67).
   * Typing `12` finds the item whose `gid` is 12 *and* an item named `12…`, and
   * `DragonSpire` finds the zone whose `zone_path` starts with it even though its
   * `display_name` humanised the path into `Dragon Spire / …` with spaces.
   *
   * `drop_tables` is the one type whose id **is** its label (`name`), so it adds no
   * column — a second entry for the same column could only duplicate the match.
   * `strings` already matched both in Phase 1.
   */
  searchColumns: readonly string[];
  /** Integer ids are coerced; anything else 404s instead of reaching SQL. */
  idKind: NamesIdKind;
}

/** type → table/columns, exactly as documented by the lead's task-1.5 decision. */
export const NAMES_TYPE_SPECS: Record<NamesType, NamesTypeSpec> = {
  items: {
    table: 'items',
    idColumn: 'gid',
    selectColumns: ['gid', 'name'],
    labelColumn: 'name',
    searchColumns: ['gid', 'name'],
    idKind: 'integer',
  },
  spells: {
    table: 'spells',
    idColumn: 'template_id',
    selectColumns: ['template_id', 'name'],
    labelColumn: 'name',
    searchColumns: ['template_id', 'name'],
    idKind: 'integer',
  },
  npcs: {
    table: 'npcs',
    idColumn: 'template_id',
    selectColumns: ['template_id', 'name'],
    labelColumn: 'name',
    searchColumns: ['template_id', 'name'],
    idKind: 'integer',
  },
  quests: {
    table: 'quests',
    idColumn: 'quest_name',
    selectColumns: ['quest_name', 'title', 'level', 'is_mainline'],
    labelColumn: 'title',
    searchColumns: ['quest_name', 'title'],
    idKind: 'text',
  },
  zones: {
    table: 'zones',
    idColumn: 'zone_path',
    selectColumns: ['zone_path', 'display_name', 'world'],
    labelColumn: 'display_name',
    searchColumns: ['zone_path', 'display_name'],
    idKind: 'text',
  },
  drop_tables: {
    table: 'drop_tables',
    idColumn: 'name',
    selectColumns: ['name', 'description'],
    labelColumn: 'name',
    // The id *is* the label — no column to add (spec-api L66). Listed once so a
    // duplicate entry cannot silently double the bound parameters.
    searchColumns: ['name'],
    idKind: 'text',
  },
  strings: {
    table: 'string_table',
    idColumn: 'key',
    selectColumns: ['key', 'value', 'category'],
    labelColumn: 'value',
    searchColumns: ['key', 'value'],
    idKind: 'text',
  },
};

/**
 * The friendly source of one object family (`shared/objectTypes.ts`'s `friendlyNamesType`) —
 * `NAMES_TYPE_SPECS` plus the rows the names API deliberately does not serve.
 *
 * **Why a second map exists at all.** D112 freezes `spec-api.md` L13's seven types and
 * `tests/unit/names.test.ts` with them, so `decks` (task 6.9) must not join `NAMES_TYPE_SPECS`.
 * The object list's `friendly_name` and the search arm's name join still need one home for
 * "where does this family's name live", so this map is that home: its `npcs`/`zones`/`quests`
 * entries are **the very same objects** `NAMES_TYPE_SPECS` holds (referentially, asserted by a
 * unit test), and `decks` is the one extra row. A second *spelling* of `npcs`/`zones` cannot
 * appear here without failing that assertion.
 */
export type ObjectFriendlySourceType = 'npcs' | 'zones' | 'decks';

export const FRIENDLY_SOURCE_SPECS: Record<ObjectFriendlySourceType, NamesTypeSpec> = {
  npcs: NAMES_TYPE_SPECS.npcs,
  zones: NAMES_TYPE_SPECS.zones,
  // `deck_name` is the technical value `CreatureSpellbook.DeckName` holds (`DeckTemplate`'s
  // `m_name`), so it is the join key; `name` is the label the pair is built from.
  decks: {
    table: 'decks',
    idColumn: 'deck_name',
    selectColumns: ['deck_name', 'name'],
    labelColumn: 'name',
    searchColumns: ['deck_name', 'name'],
    idKind: 'text',
  },
};

/** One response row: the column names above, verbatim. */
export type NamesRow = Record<string, unknown>;

export function isNamesType(value: string): value is NamesType {
  return (NAMES_TYPES as readonly string[]).includes(value);
}

/** 404 body for an unknown `:type` — actionable, so a caller can self-correct. */
export function unknownNamesTypeMessage(type: string): string {
  return `Unknown name type "${type}". Valid types: ${NAMES_TYPES.join(', ')}`;
}

export interface ListNamesOptions {
  /** Case-insensitive literal substring filter (`''` and absent mean "no filter"). */
  q?: string;
  /** Row cap; a positive integer. */
  limit?: number;
}

export type ListNamesQueryResult =
  { ok: true; options: ListNamesOptions } | { ok: false; error: string };

/**
 * Validates `?q=` / `?limit=` (lead decision: malformed values are a 400, and an
 * absent/empty `q` leaves the spec shape untouched).
 *
 * Repeated parameters (`?limit=1&limit=2`) arrive as arrays and are rejected with
 * the same message as any other malformed value.
 */
export function parseListNamesQuery(query: Record<string, unknown> = {}): ListNamesQueryResult {
  const options: ListNamesOptions = {};

  const rawQ = query.q;
  if (rawQ !== undefined) {
    if (typeof rawQ !== 'string') {
      return { ok: false, error: 'Query parameter "q" must be a single string value' };
    }
    if (rawQ !== '') {
      options.q = rawQ;
    }
  }

  const rawLimit = query.limit;
  if (rawLimit !== undefined) {
    if (
      typeof rawLimit !== 'string' ||
      !/^\d+$/.test(rawLimit) ||
      Number(rawLimit) < 1 ||
      !Number.isSafeInteger(Number(rawLimit))
    ) {
      return {
        ok: false,
        error:
          typeof rawLimit === 'string'
            ? `Invalid limit "${rawLimit}": limit must be a positive integer`
            : 'Query parameter "limit" must be a single positive integer',
      };
    }
    options.limit = Number(rawLimit);
  }

  return { ok: true, options };
}

/**
 * Escapes the LIKE metacharacters so `?q=` is a *literal* substring match:
 * `?q=%25` searches for a percent sign instead of matching every row.
 *
 * Exported because cross-type search (`services/search.ts`, task 5.2) needs exactly this
 * rule over three more tables — one implementation, two callers, so `?q=%` cannot be a
 * literal on `/api/names` and a wildcard on `/api/search`.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * `ORDER BY` columns: the label first, then the primary key as the deterministic
 * tiebreak (79,835 items share 4,395 duplicate names, so the label alone is not
 * a total order).
 */
function orderColumns(spec: NamesTypeSpec): string[] {
  return spec.labelColumn === spec.idColumn ? [spec.idColumn] : [spec.labelColumn, spec.idColumn];
}

/**
 * Reads the rows of one type, ordered deterministically.
 *
 * Case folding is ASCII-only (`lower()` + LIKE are ASCII by default in SQLite);
 * every friendly-name category in the live database is ASCII.
 */
export function listNames(db: Db, type: NamesType, options: ListNamesOptions = {}): NamesRow[] {
  const spec = NAMES_TYPE_SPECS[type];
  const params: Array<string | number> = [];
  let sql = `SELECT ${spec.selectColumns.join(', ')} FROM ${spec.table}`;

  if (options.q !== undefined) {
    const pattern = `%${escapeLike(options.q.toLowerCase())}%`;
    const matches = spec.searchColumns.map((column) => `lower(${column}) LIKE ? ESCAPE '\\'`);
    sql += ` WHERE (${matches.join(' OR ')})`;
    params.push(...spec.searchColumns.map(() => pattern));
  }

  sql += ` ORDER BY ${orderColumns(spec).join(', ')}`;

  if (options.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }

  return db.prepare<Array<string | number>, NamesRow>(sql).all(...params);
}

/**
 * Coerces a `:id` path segment for one type, or `undefined` when it cannot be a
 * valid id (a non-numeric `items` id must 404, never 500).
 */
export function coerceNamesId(spec: NamesTypeSpec, rawId: string): string | number | undefined {
  if (spec.idKind === 'text') {
    return rawId;
  }
  if (!/^\d+$/.test(rawId)) {
    return undefined;
  }
  const value = Number(rawId);
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * The friendly-name tables as the validation engine's injected reference sets (story p3-09).
 *
 * The engine is pure and cannot reach SQLite, so the server hands it `Set<string>`s built from
 * the **same** `NAMES_TYPE_SPECS` mapping the names API serves — table and column names come
 * from that table, never from a request, and only values are bound. `items` and `strings` are
 * deliberately excluded: no quest field references an `items.gid` (measured: 0 of 79,835
 * values occur in the 322 quests) and `string_table` is a key/value display table, not a
 * reference domain.
 *
 * An **empty** table is not a reference set and is left out, exactly as the client does: a
 * database whose friendly names were never synced must not make every zone path and every id
 * look unknown. The consequence is documented on the engine's own rules — an absent namespace
 * disables that rule.
 *
 * Read fresh on every call (five `SELECT`s over ~42k rows, tens of milliseconds) rather than
 * cached, because a save is already dominated by the file write and the commit, and a cache
 * would go stale silently after a sync (D8 repopulates these tables).
 */
export function loadValidationReferences(db: Db): QuestValidationReferences {
  const references: QuestValidationReferences = {};
  for (const type of ['zones', 'npcs', 'spells', 'drop_tables', 'quests'] as const) {
    const spec = NAMES_TYPE_SPECS[type];
    const rows = db
      .prepare<[], { value: unknown }>(`SELECT ${spec.idColumn} AS value FROM ${spec.table}`)
      .all();
    if (rows.length === 0) {
      continue;
    }
    references[type] = new Set(rows.map((row) => String(row.value)));
  }
  return references;
}

export type NameLookup = { found: true; row: NamesRow } | { found: false; error: string };

/**
 * Single-row lookup by the type's primary key.
 *
 * Both failure modes are a 404 with an actionable message: an id that cannot be
 * valid for the type ("Invalid items id …") and a well-formed id that matches
 * nothing ("Unknown items id …").
 */
export function lookupName(db: Db, type: NamesType, rawId: string): NameLookup {
  const spec = NAMES_TYPE_SPECS[type];
  const id = coerceNamesId(spec, rawId);
  if (id === undefined) {
    return {
      found: false,
      error: `Invalid ${type} id "${rawId}": ${spec.idColumn} must be an integer`,
    };
  }

  const row = db
    .prepare<[string | number], NamesRow>(
      `SELECT ${spec.selectColumns.join(', ')} FROM ${spec.table} WHERE ${spec.idColumn} = ?`,
    )
    .get(id);

  if (row === undefined) {
    return { found: false, error: `Unknown ${type} id "${rawId}"` };
  }

  return { found: true, row };
}
