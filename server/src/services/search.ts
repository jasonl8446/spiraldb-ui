import { OBJECT_TYPES, type ObjectTypeConfig } from '../../../shared/objectTypes.js';

import type { Db } from '../db.js';
import { escapeLike } from './names.js';
import { searchNpcEntities } from './npcNames.js';
import { isStatusValue, type StatusObjectType, type StatusValue } from './status.js';

/**
 * Cross-type search — `GET /api/search?q=&limit=20`, the ⌘K palette's read
 * (plan task 5.2, story p5-02; endpoint decision D27, docs/plan-overview.md L117).
 *
 * The plan's own sentence for this endpoint is the whole contract: *"matching
 * `entry_status.object_key` (all types) plus friendly-name tables (items/spells/npcs/
 * quests by name); results grouped by type with status dots; Enter/click navigates to
 * the owning route"*. This module is the read; `routes/search.ts` is the HTTP shell.
 *
 * ## The two arms, and which of them can be linked
 *
 * **Arm 1 — object keys.** Every one of D4's eight `entry_status.object_type` values is
 * searched on `object_key`. Those rows *are* the objects the app has detail routes for,
 * so each carries `object_type` + `object_key` + `status`: the palette's dot and its
 * link both come from here, through the client's existing D4 mapping
 * (`client/src/lib/dashboard.ts`'s `activityHref` → `objectDetailPath`) rather than a
 * second one.
 *
 * **Arm 2 — friendly names.** The plan names four tables. Three of them
 * (`items`, `spells`, `npcs`) hold entities the app has **no** detail route for — there
 * is no `/items/:gid` page and this endpoint must not invent one — so those rows come
 * back with `object_type: null` / `object_key: null` and are counted in `unresolved`:
 * the same vocabulary, and the same "shown but not linked" treatment, that p5-01 gave
 * the activity feed's unresolvable rows.
 *
 * The fourth named table is `quests`, and it is the one case where the friendly name is
 * also a route key: `quests.title` is the quest's human name ("Headless Rider") while
 * `quests.quest_name` ("DS-ACAD-C01-002") is exactly the `entry_status.object_key` the
 * quest detail route takes. So the quest group's query **left-joins** `quests` and
 * matches the title as well, and a title hit is returned as a normal, navigable quest
 * row (`matched_on: 'name'`). Searching `quests.quest_name` a second time is
 * deliberately not done: it is the string arm 1 already matched, so a second pass could
 * only return the same quest twice.
 *
 * **Phase 6 widens arm 2 selectively (D105/P6-16, story p6-06).** Every object group
 * whose family has a friendly source gains a `nameJoin`, and the join is *derived from
 * the same field the object list resolves `friendly_name` from*
 * (`shared/objectTypes.ts`'s `friendlyNamesType`) rather than hand-listed here:
 *
 * - the four `TemplateID` families join **`npcs`** on `CAST(template_id AS TEXT) =
 *   es.object_key`, so a quest-giver's name finds the rows keyed by his template id —
 *   and the CAST is load-bearing, because SQLite orders every integer below every text
 *   value and `template_id = object_key` is false for all 289 corpus rows;
 * - `zone_transfer` joins **`zones`** on `zone_path`, so `DS_A2_Battle` in a
 *   humanised label finds the row whose path arm 1 cannot match;
 * - `drop_table` gains **no** arm: `drop_tables.name` is byte-identical to the object
 *   key (the fork names each quest's drop table after the quest), so it could only
 *   duplicate arm 1 — and for the same reason the family has no friendly source in the
 *   per-family table (spec-ui-design L62);
 * - `creature_spellbook` gains none either: its friendly source is a `decks` table that
 *   task 6.9 populates, so until then the row is its technical value alone.
 *
 * **The `npc` group is not a `npcs` name list** (P6-17/D112): it is the alias-keyed NPC
 * **namespace** (`services/npcNames.ts`), so `Gretta` and `Gretta Darkkettle` — one
 * person, two string-table rows — come back as one row carrying both strings. A hit
 * there is name-matched by construction (the group searches aliases and template names,
 * never the template id) and stays informational: the application has no `/npcs/:id`
 * **page**, so `object_type`/`object_key` are `null` and the row counts in `unresolved`.
 *
 * ## Nothing is interpolated from a request
 *
 * Every table, column and type name below comes from a module-level constant
 * (`SEARCH_GROUPS`, which is derived from `shared/objectTypes.ts` wherever it can be) or
 * from D4's `STATUS_OBJECT_TYPES`. Only `q` and the limit are bound parameters — the
 * same rule `services/names.ts` follows for `?q=`.
 */

/* ------------------------------------------------------------------ constants */

/**
 * `?limit=` default — the palette length the AC names (`limit=20 respected`, plan task
 * 5.2 / P5 AC#4).
 */
export const SEARCH_DEFAULT_LIMIT = 20;

/**
 * `?limit=` ceiling. A palette shows one screen of results per type; the ceiling exists
 * so `?limit=1000000` cannot turn one keystroke into a full-table response, and a value
 * above it is a **400**, not a silent clamp (the same ladder `?limit=` follows on
 * `GET /api/activity` and `GET /api/names/:type`).
 */
export const SEARCH_MAX_LIMIT = 50;

/**
 * **`limit` is a PER-GROUP cap** — at most `limit` results in each `groups[]` element, so
 * a `?limit=20` response can carry at most `20 × SEARCH_GROUPS.length` = 220 rows.
 *
 * This is the position the acceptance criterion itself forces, and it was measured rather
 * than assumed. The criterion's example is *"typing a substring of a known quest name and
 * of a known DropTable name returns both, grouped by type"* — and in the owner's corpus
 * the drop table for a quest is named after the quest, so one substring naturally matches
 * both families: `DS-ACAD` matches **26 quests and 26 drop tables**. Under a single shared
 * cap, the Quests group is first in the order, consumes all twenty rows, and the Drop
 * Tables group never appears at all — the criterion's own sentence would be false while
 * the endpoint looked correct. A per-group cap is what makes "grouped by type" true for
 * *every* type that matched instead of only for the first one.
 *
 * `limit=20` is still respected in the sense that bounds a caller: **no group is ever
 * longer than `limit`**, and a query whose matches live in one type is answered with
 * exactly `limit` rows (the "filled to exactly 20" demonstration in the story's D3).
 *
 * The constant itself stays the ceiling; the cap's *default* is
 * {@link SEARCH_DEFAULT_LIMIT} and both are documented on {@link searchAll}.
 */

/* --------------------------------------------------------------------- groups */

/** The three name-only groups' keys (they are not D4 object types). */
export type SearchNameGroupType = 'item' | 'spell' | 'npc';

/** Every group key: D4's eight singular types, or one of the three name-only keys. */
export type SearchGroupType = StatusObjectType | SearchNameGroupType;

/** The friendly table joined into a group's query so a hit there can reach a route. */
interface SearchNameJoin {
  table: string;
  /** The joined table's column that names the object key. */
  keyColumn: string;
  /** The joined table's human-name column, which the search matches as well. */
  nameColumn: string;
  /**
   * `true` when `keyColumn` is an **INTEGER** column while `entry_status.object_key`
   * is TEXT (the four `TemplateID` families). SQLite's type ordering puts every
   * integer *below* every text value, so `template_id = object_key` is false for
   * every row and the join needs `CAST(… AS TEXT)`. Without it those four groups
   * match nothing at all — measured four times in this run, most recently as a probe
   * that reported 0/289 resolved because it keyed integers against strings.
   */
  keyIsInteger: boolean;
}

/** One group backed by `entry_status` — every row is navigable. */
interface SearchObjectGroupSpec {
  kind: 'object';
  type: StatusObjectType;
  /** The palette's group heading. */
  label: string;
  /**
   * The friendly table carrying this group's human names, or `null` when none does —
   * which is itself derived from the family's `friendlyNamesType` (see
   * {@link nameJoinFor}).
   */
  nameJoin: SearchNameJoin | null;
}

/** One group backed by a friendly-name table whose entities have no detail route. */
interface SearchNamesGroupSpec {
  kind: 'names';
  type: SearchNameGroupType;
  label: string;
  table: string;
  /** The table's own primary key, reported as `source_id`. */
  idColumn: string;
}

/**
 * The NPC group (P6-17/D112): the alias-keyed namespace, whose rows are NPC entities
 * rather than rows of one table — one entity per NPC, its name strings as aliases.
 */
interface SearchNpcGroupSpec {
  kind: 'npc';
  type: 'npc';
  label: string;
}

type SearchGroupSpec = SearchObjectGroupSpec | SearchNamesGroupSpec | SearchNpcGroupSpec;

/** `quests`' friendly-name table: the one join that reaches a route (module doc-comment). */
const QUEST_NAME_JOIN: SearchNameJoin = {
  table: 'quests',
  keyColumn: 'quest_name',
  nameColumn: 'title',
  keyIsInteger: false,
};

/** The four `TemplateID` families' friendly table — an INTEGER key against a text key. */
const NPC_NAME_JOIN: SearchNameJoin = {
  table: 'npcs',
  keyColumn: 'template_id',
  nameColumn: 'name',
  keyIsInteger: true,
};

/** ZoneTransfer's friendly table — a zone path is TEXT on both sides. */
const ZONE_NAME_JOIN: SearchNameJoin = {
  table: 'zones',
  keyColumn: 'zone_path',
  nameColumn: 'display_name',
  keyIsInteger: false,
};

/**
 * The join a family's row carries, from the **same** `friendlyNamesType` the object
 * list resolves `friendly_name` from (`shared/objectTypes.ts`) — so the search arm
 * and the list row cannot be given different friendly sources, and a family that gains
 * a friendly source in a later task (CreatureSpellbook's `decks`) gains both at once.
 */
function nameJoinFor(config: ObjectTypeConfig): SearchNameJoin | null {
  switch (config.friendlyNamesType) {
    case 'npcs':
      return NPC_NAME_JOIN;
    case 'zones':
      return ZONE_NAME_JOIN;
    default:
      return null;
  }
}

/**
 * The group order — **Quests first**, then the seven generic families in
 * `shared/objectTypes.ts` order (the order `GET /api/dashboard` and
 * `GET /api/status/:type` already use), then the three name-only families.
 *
 * It is one table, and the seven rows are *derived* from `OBJECT_TYPES` rather than
 * hand-written, so a family can never acquire a search group with the wrong type or
 * label — the same construction `client/src/lib/dashboard.ts`'s `DASHBOARD_TYPE_REFS`
 * uses for its eight rows.
 */
export const SEARCH_GROUPS: readonly SearchGroupSpec[] = [
  { kind: 'object', type: 'quest', label: 'Quests', nameJoin: QUEST_NAME_JOIN },
  ...OBJECT_TYPES.flatMap<SearchObjectGroupSpec>((config) =>
    config.objectType === null
      ? []
      : [
          {
            kind: 'object',
            type: config.objectType,
            label: config.label,
            nameJoin: nameJoinFor(config),
          },
        ],
  ),
  { kind: 'names', type: 'item', label: 'Items', table: 'items', idColumn: 'gid' },
  { kind: 'names', type: 'spell', label: 'Spells', table: 'spells', idColumn: 'template_id' },
  // The namespace, not a name list: one row per NPC, its strings as aliases (D112).
  { kind: 'npc', type: 'npc', label: 'NPCs' },
];

/**
 * The group keys, in order — the only values a `groups[]` element's `type` can hold.
 * Exported so the unit test can assert the wire's own vocabulary without re-spelling it.
 */
export const SEARCH_GROUP_TYPES: readonly SearchGroupType[] = SEARCH_GROUPS.map(
  (group) => group.type,
);

/* ------------------------------------------------------------------ the wire */

/**
 * One `results[]` row.
 *
 * `object_type` and `object_key` are non-null **exactly when the row has a detail
 * route** — they are the two values the client's `objectDetailPath` mapping consumes, so
 * "no route" is expressed by their absence and never by a guessed path. The palette's
 * dot reads `status`, which is non-null exactly in the same cases (a routeless friendly
 * name has no lifecycle).
 */
export interface SearchResultRow {
  /** D4 singular object type; `null` when no detail route exists for this row. */
  object_type: StatusObjectType | null;
  /** The route's key; `null` when no detail route exists for this row. */
  object_key: string | null;
  /**
   * The row's primary text: the object key for a navigable row, the friendly name for a
   * routeless one. It is what the palette shows in monospace.
   */
  label: string;
  /**
   * The friendly name known for this row, or `null` when none is. A quest row carries
   * its title whenever the `quests` table has one — whether the key or the title was
   * what matched — so a hit on `DS-ACAD-C01-002` can say "Headless Rider".
   */
  name: string | null;
  /**
   * The friendly table row's own primary key as text (`items.gid`, `spells.template_id`,
   * `npcs.template_id`); `null` for an object row.
   *
   * It is carried because **the friendly tables' names are not unique** — 79,835 items
   * share 4,395 duplicate names (the measurement in `services/names.ts`) — so the name
   * alone cannot identify a row, and the palette needs an identity for its React key and
   * for cmdk's `value`.
   */
  source_id: string | null;
  /** The lifecycle status; `null` for a routeless friendly-name row. */
  status: StatusValue | null;
  /** Which column matched: the object key (`'key'`) or a friendly name (`'name'`). */
  matched_on: 'key' | 'name';
  /**
   * The NPC group's name strings, one per row (P6-17/D112) — `["Gretta",
   * "Gretta Darkkettle"]` for the one entity both strings belong to. Absent for every
   * other group, which carries at most one friendly name in `name`.
   */
  aliases?: string[];
}

/** One `groups[]` element. */
export interface SearchGroup {
  /** A group key from {@link SEARCH_GROUP_TYPES}. */
  type: SearchGroupType;
  /** The heading the palette renders (e.g. `Drop Tables`). */
  label: string;
  results: SearchResultRow[];
}

/** The `GET /api/search` envelope. */
export interface SearchResult {
  /**
   * The trimmed query that was actually searched. `''` is the blank query, which
   * returns an empty result without touching the database.
   */
  query: string;
  /** The row cap applied **to each group** (the request's `limit`, or the default). */
  limit: number;
  /** How many rows the response carries — the sum of every group's `results.length`. */
  total: number;
  /**
   * `true` when at least one group matched more rows than the cap allowed.
   *
   * It is a "there are more" flag, not a count. Detecting it costs one extra row per
   * group: every group is read with `LIMIT limit + 1`, so an overflow is *observed* rather
   * than assumed, and a group that returned exactly `limit` rows with no extra is known
   * to be complete.
   */
  truncated: boolean;
  /**
   * How many returned rows have no detail route (the friendly-name hits on items,
   * spells and NPCs). The palette prints this rather than dropping the rows or linking
   * one to a route that does not exist — p5-01's `unresolved` contract, same word, same
   * meaning.
   */
  unresolved: number;
  /** The groups that matched, in {@link SEARCH_GROUPS} order; empty when nothing matched. */
  groups: SearchGroup[];
}

/* ------------------------------------------------------------------- the query */

/** The `ESCAPE` clause the `LIKE` patterns use, so `?q=%` is a literal percent sign. */
const ESCAPE = `ESCAPE '\\'`;

/** The `ORDER BY` a match-rank uses: exact match, then prefix, then substring. */
const RANK_OBJECT_KEY = `CASE
    WHEN lower(es.object_key) = ? THEN 0
    WHEN lower(es.object_key) LIKE ? ${ESCAPE} THEN 1
    ELSE 2
  END`;

/**
 * The rank of a group whose joined friendly column may be what matched: a name hit is
 * ranked by the name, so "headless rider" puts the quest titled exactly that first, and
 * a template-id hit by the key. Shared by the quest group and every `nameJoin` group
 * (the four `TemplateID` families and ZoneTransfer) — one rank expression, not one per
 * family.
 *
 * `qualifiedNameColumn` is always one the caller already bound into the same statement
 * (`j.${join.nameColumn}`, from a module constant) — never a request value.
 */
function rankKeyOrName(qualifiedNameColumn: string): string {
  return `CASE
    WHEN lower(es.object_key) = ? THEN 0
    WHEN lower(es.object_key) LIKE ? ${ESCAPE} THEN 1
    WHEN lower(${qualifiedNameColumn}) = ? THEN 0
    WHEN lower(${qualifiedNameColumn}) LIKE ? ${ESCAPE} THEN 1
    ELSE 2
  END`;
}

/** The name groups' rank, over the friendly-name column. */
const RANK_NAME = `CASE
    WHEN lower(t.name) = ? THEN 0
    WHEN lower(t.name) LIKE ? ${ESCAPE} THEN 1
    ELSE 2
  END`;

/** One arm's raw row, before the wire shape is built. */
interface RawRow {
  object_key: string | null;
  status: string | null;
  name: string | null;
  source_id: string | null;
  /** The NPC group's aliases; absent for every other group. */
  aliases?: string[];
}

/** The object arm's columns for a group without a name join. */
const OBJECT_COLUMNS = 'es.object_key AS object_key, es.status AS status, NULL AS name';

/**
 * Reads up to `limit` rows of one group.
 *
 * Ordering is **`rank, then the identifier`**: the rank is exact-match → prefix →
 * substring (case-folded), and the tiebreak is the row's own identifier ascending —
 * `object_key` for an object group (the same value D37 orders `GET /api/status/:type`'s
 * rows by, and unique within one type, so the order is total) and `name, id` for a name
 * group (a name is **not** unique: 4,395 item names repeat, which is exactly the
 * "`latest_notes` by `id`" tiebreak reason D37 records).
 */
function searchGroup(db: Db, group: SearchGroupSpec, q: string, limit: number): RawRow[] {
  const pattern = `%${escapeLike(q)}%`;
  const prefix = `${escapeLike(q)}%`;

  if (group.kind === 'npc') {
    // The alias-keyed namespace: one row per NPC, its strings as aliases (D112). The
    // ranking, the tie-break and the `limit + 1` overflow probe are the module's own,
    // so this group obeys the same byte-level contract as the SQL ones.
    return searchNpcEntities(db, q, limit).map<RawRow>((entity) => ({
      object_key: null,
      status: null,
      name: entity.display_name,
      source_id: entity.npc_key,
      aliases: entity.aliases,
    }));
  }

  if (group.kind === 'object') {
    const join = group.nameJoin;
    if (join === null) {
      return db
        .prepare<Array<string | number>, RawRow>(
          `SELECT ${OBJECT_COLUMNS}
           FROM entry_status es
           WHERE es.object_type = ? AND lower(es.object_key) LIKE ? ${ESCAPE}
           ORDER BY ${RANK_OBJECT_KEY}, es.object_key
           LIMIT ?`,
        )
        .all(group.type, pattern, q, prefix, limit);
    }
    // The CAST is required for the INTEGER key columns — see {@link SearchNameJoin}.
    const on = join.keyIsInteger
      ? `CAST(j.${join.keyColumn} AS TEXT) = es.object_key`
      : `j.${join.keyColumn} = es.object_key`;
    return db
      .prepare<Array<string | number>, RawRow>(
        `SELECT es.object_key AS object_key, es.status AS status, j.${join.nameColumn} AS name
         FROM entry_status es
         LEFT JOIN ${join.table} j ON ${on}
         WHERE es.object_type = ?
           AND (lower(es.object_key) LIKE ? ${ESCAPE} OR lower(j.${join.nameColumn}) LIKE ? ${ESCAPE})
         ORDER BY ${rankKeyOrName(`j.${join.nameColumn}`)}, es.object_key
         LIMIT ?`,
      )
      .all(group.type, pattern, pattern, q, prefix, q, prefix, limit);
  }

  return db
    .prepare<Array<string | number>, RawRow>(
      `SELECT t.name AS name, CAST(t.${group.idColumn} AS TEXT) AS source_id,
              NULL AS object_key, NULL AS status
       FROM ${group.table} t
       WHERE lower(t.name) LIKE ? ${ESCAPE}
       ORDER BY ${RANK_NAME}, t.name, t.${group.idColumn}
       LIMIT ?`,
    )
    .all(pattern, q, prefix, limit);
}

/** A non-empty string, or `null` — the wire never carries `''` where "absent" is meant. */
function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Builds one group's wire rows. `q` is already lower-cased. */
function rowsFor(group: SearchGroupSpec, raw: RawRow[], q: string): SearchResultRow[] {
  if (group.kind === 'npc') {
    // Informational by construction: the app has no `/npcs/:id` page, so the row is
    // shown without a link and counted in `unresolved` (spec-api L537-539). The label
    // is the NPC's full name; `aliases` carries every string that resolves to it.
    return raw.map((row) => {
      const label = row.name ?? '';
      return {
        object_type: null,
        object_key: null,
        label,
        name: label,
        source_id: textOrNull(row.source_id),
        status: null,
        matched_on: 'name' as const,
        aliases: row.aliases ?? [],
      };
    });
  }

  if (group.kind === 'names') {
    // No detail route exists for these entities, so `object_type`/`object_key` are
    // null and the row is informational (module doc-comment).
    return raw.map((row) => {
      const label = row.name ?? '';
      return {
        object_type: null,
        object_key: null,
        label,
        name: label,
        source_id: textOrNull(row.source_id),
        status: null,
        matched_on: 'name',
      };
    });
  }

  return raw.map((row) => {
    const objectKey = row.object_key ?? '';
    // A row is matched on its key unless the key does not contain the query but the
    // joined name does — the only two ways the WHERE can have admitted it.
    const matchedOn: 'key' | 'name' = objectKey.toLowerCase().includes(q) ? 'key' : 'name';
    return {
      object_type: group.type,
      object_key: objectKey,
      label: objectKey,
      name: textOrNull(row.name),
      source_id: null,
      status: isStatusValue(row.status) ? row.status : null,
      matched_on: matchedOn,
    };
  });
}

export interface SearchOptions {
  /**
   * The query. Trimmed here; a blank (or all-whitespace) value is the **blank query**,
   * which returns the empty envelope **without preparing a statement** — a palette that
   * opens with no query must not scan the ~121k name rows behind this endpoint.
   */
  q: string;
  /** Per-group row cap; validated by the caller ({@link parseSearchLimit}), default 20. */
  limit?: number;
}

/**
 * `GET /api/search`'s read.
 *
 * Every group in {@link SEARCH_GROUPS} is read once, in order, with `LIMIT limit + 1`
 * rows — the extra row is how an overflow is *observed* rather than assumed — and the
 * first `limit` of them become that group's `results`. A group that matched nothing is
 * omitted entirely, so `groups` says exactly which types matched and in which order.
 */
export function searchAll(db: Db, options: SearchOptions): SearchResult {
  const q = options.q.trim();
  const limit = options.limit ?? SEARCH_DEFAULT_LIMIT;

  if (q === '') {
    return {
      query: '',
      limit,
      total: 0,
      truncated: false,
      unresolved: 0,
      groups: [],
    };
  }

  const needle = q.toLowerCase();
  const groups: SearchGroup[] = [];
  let truncated = false;
  let unresolved = 0;
  let total = 0;

  for (const group of SEARCH_GROUPS) {
    const raw = searchGroup(db, group, needle, limit + 1);
    if (raw.length > limit) {
      truncated = true;
    }
    const taken = rowsFor(group, raw.slice(0, limit), needle);
    if (taken.length === 0) {
      continue;
    }
    for (const row of taken) {
      if (row.object_type === null) {
        unresolved += 1;
      }
    }
    total += taken.length;
    groups.push({ type: group.type, label: group.label, results: taken });
  }

  return { query: q, limit, total, truncated, unresolved, groups };
}

/* ------------------------------------------------------------- the limit ladder */

export type ParseSearchLimitResult = { ok: true; limit: number } | { ok: false; error: string };

/**
 * Validates `?limit=`.
 *
 * Absent → {@link SEARCH_DEFAULT_LIMIT}. Everything else must be a single string of
 * digits forming a positive integer within the ceiling: `""`, `"abc"`, `"1.5"`, `"-1"`,
 * `"0"`, `" 1"`, `"+1"`, `"1e3"`, a repeated parameter (an array) and a value above the
 * ceiling are all **400**s that name what was wrong — never a silent clamp. This is
 * `parseActivityLimit`'s ladder verbatim (p5-01), because a caller that asked for 5,000
 * rows deserves to know it got 20.
 */
export function parseSearchLimit(raw: unknown): ParseSearchLimitResult {
  if (raw === undefined) {
    return { ok: true, limit: SEARCH_DEFAULT_LIMIT };
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: 'Query parameter "limit" must be a single positive integer' };
  }
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) {
    return {
      ok: false,
      error: `Invalid limit "${raw}": limit must be a positive integer (1-${SEARCH_MAX_LIMIT})`,
    };
  }
  const limit = Number(raw);
  if (limit > SEARCH_MAX_LIMIT) {
    return {
      ok: false,
      error: `Invalid limit "${raw}": limit must be at most ${SEARCH_MAX_LIMIT}`,
    };
  }
  return { ok: true, limit };
}

export type ParseSearchQueryResult =
  { ok: true; q: string; limit: number } | { ok: false; error: string };

/**
 * Validates `?q=` and `?limit=` together.
 *
 * `q` is optional and may be blank: **an absent or blank query is not an error** — it is
 * the state a palette is in the moment it opens, so it answers `200` with the empty
 * envelope (see {@link searchAll}) instead of forcing the client to treat "no query yet"
 * as a failure. A repeated parameter (`?q=a&q=b`, which arrives as an array) is a 400,
 * because silently searching one of the two values would answer a question nobody asked.
 *
 * The returned `q` is trimmed: `?q=%20acad%20` searches `acad` and echoes `acad`, so the
 * response's `query` is exactly the string that was matched against.
 */
export function parseSearchQuery(query: Record<string, unknown> = {}): ParseSearchQueryResult {
  const rawQ = query.q;
  if (rawQ !== undefined && typeof rawQ !== 'string') {
    return { ok: false, error: 'Query parameter "q" must be a single string value' };
  }

  const parsedLimit = parseSearchLimit(query.limit);
  if (!parsedLimit.ok) {
    return { ok: false, error: parsedLimit.error };
  }

  return { ok: true, q: (rawQ ?? '').trim(), limit: parsedLimit.limit };
}
