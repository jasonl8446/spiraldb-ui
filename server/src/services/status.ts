import type { Db } from '../db.js';

/**
 * Verification-status data access — the reads and the single write behind
 * `GET /api/status/:type`, `PATCH /api/status/:type/:key`,
 * `GET /api/status/:type/:key/history` and `GET /api/dashboard`
 * (task 1.6, docs/spec-api.md L48-164).
 *
 * D4 (docs/plan-overview.md L94) is the reason this module exists as a layer
 * rather than inside the router: API routes speak the *plural* type
 * (`quests`) while `entry_status.object_type` stores the *singular* value
 * (`quest`). `STATUS_TYPE_BY_ROUTE` is the single constant holding that
 * mapping; every query here takes the singular form, so the route name never
 * reaches SQL. Nothing in this module is interpolated from a request: only
 * bound values and the singular type names from the mapping above.
 */

/** The eight tracked types, spelled the way the API routes spell them. */
export const STATUS_TYPES = [
  'quests',
  'drop_tables',
  'npc_inventories',
  'npc_spell_inventories',
  'creature_spellbooks',
  'npc_drop_tables',
  'treasure_card_inventories',
  'zone_transfers',
] as const;

export type StatusRouteType = (typeof STATUS_TYPES)[number];

/** The values `entry_status.object_type` stores (docs/spec-data-model.md L32-37). */
export const STATUS_OBJECT_TYPES = [
  'quest',
  'drop_table',
  'npc_inventory',
  'npc_spell_inventory',
  'creature_spellbook',
  'npc_drop_table',
  'treasure_card_inventory',
  'zone_transfer',
] as const;

export type StatusObjectType = (typeof STATUS_OBJECT_TYPES)[number];

/**
 * D4 — the plural-route ↔ singular-column mapping, one constant, read in both
 * directions (the inverse `STATUS_ROUTE_BY_TYPE` is derived from it below, so
 * there is exactly one place to edit).
 */
export const STATUS_TYPE_BY_ROUTE: Record<StatusRouteType, StatusObjectType> = {
  quests: 'quest',
  drop_tables: 'drop_table',
  npc_inventories: 'npc_inventory',
  npc_spell_inventories: 'npc_spell_inventory',
  creature_spellbooks: 'creature_spellbook',
  npc_drop_tables: 'npc_drop_table',
  treasure_card_inventories: 'treasure_card_inventory',
  zone_transfers: 'zone_transfer',
};

/** The singular → plural direction, inverted from `STATUS_TYPE_BY_ROUTE`. */
export const STATUS_ROUTE_BY_TYPE: Record<StatusObjectType, StatusRouteType> = Object.fromEntries(
  STATUS_TYPES.map((route) => [STATUS_TYPE_BY_ROUTE[route], route]),
) as Record<StatusObjectType, StatusRouteType>;

/** The route value that aggregates every tracked type (`type=all`). */
export const STATUS_ALL = 'all';

/** Every accepted `:type` segment, including the `all` aggregate. */
export const STATUS_REQUEST_TYPES = [...STATUS_TYPES, STATUS_ALL] as const;

export type StatusRequestType = (typeof STATUS_REQUEST_TYPES)[number];

/** The three lifecycle values `status` may hold (docs/spec-data-model.md L9-19). */
export const STATUS_VALUES = ['extracted', 'reviewed', 'verified'] as const;

export type StatusValue = (typeof STATUS_VALUES)[number];

export function isStatusRouteType(value: string): value is StatusRouteType {
  return (STATUS_TYPES as readonly string[]).includes(value);
}

export function isStatusRequestType(value: string): value is StatusRequestType {
  return (STATUS_REQUEST_TYPES as readonly string[]).includes(value);
}

export function isStatusValue(value: unknown): value is StatusValue {
  return typeof value === 'string' && (STATUS_VALUES as readonly string[]).includes(value);
}

/** 404 body for an unknown `:type` — actionable, so a caller can self-correct. */
export function unknownStatusTypeMessage(type: string): string {
  return `Unknown status type "${type}". Valid types: ${STATUS_REQUEST_TYPES.join(', ')}`;
}

/** The singular type(s) a request resolves to: one type, or all eight for `all`. */
export function resolveStatusObjectTypes(type: StatusRequestType): StatusObjectType[] {
  return type === STATUS_ALL
    ? STATUS_TYPES.map((route) => STATUS_TYPE_BY_ROUTE[route])
    : [STATUS_TYPE_BY_ROUTE[type]];
}

/**
 * One `entries[]` element — exactly the seven documented keys
 * (docs/spec-api.md L66-75). `reviewed_by` / `verified_by` are deliberately
 * absent: the spec's row shape does not carry them, and `status_history` holds
 * the audit trail.
 */
export interface StatusEntryRow {
  object_type: StatusObjectType;
  object_key: string;
  status: string;
  extracted_at: string | null;
  reviewed_at: string | null;
  verified_at: string | null;
  latest_notes: string | null;
}

export interface StatusSummary {
  total: number;
  extracted: number;
  reviewed: number;
  verified: number;
}

export interface ListStatusResult {
  entries: StatusEntryRow[];
  summary: StatusSummary;
}

/** One `history[]` element — exactly the five documented keys (spec L110-140). */
export interface StatusHistoryRow {
  old_status: string | null;
  new_status: string;
  notes: string | null;
  changed_by: string | null;
  changed_at: string | null;
}

/**
 * `notes` of the most recent `status_history` row for the entry — the newest by
 * `id` (the table has no other monotonic column and `changed_at` can repeat
 * within the same second). `null` when the entry has no history at all, which is
 * every freshly imported entry.
 */
const LATEST_NOTES_SELECT = `(
  SELECT sh.notes FROM status_history sh
  WHERE sh.entry_status_id = es.id
  ORDER BY sh.id DESC
  LIMIT 1
) AS latest_notes`;

const ENTRY_COLUMNS = `es.object_type, es.object_key, es.status,
  es.extracted_at, es.reviewed_at, es.verified_at`;

/** `(?, ?, …, ?)` for an `IN` list — values are always bound, never interpolated. */
function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/** Runs a count query that returns `{ total, extracted, reviewed, verified }`. */
function readSummary(db: Db, types: readonly StatusObjectType[]): StatusSummary {
  const row = db
    .prepare<StatusObjectType[], StatusSummary & { total: number | null }>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'extracted' THEN 1 ELSE 0 END) AS extracted,
              SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END) AS reviewed,
              SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS verified
       FROM entry_status
       WHERE object_type IN (${placeholders(types.length)})`,
    )
    .get(...types);

  // `SUM` over zero rows is NULL, not 0 — a type with no entries must report zeros.
  return {
    total: row?.total ?? 0,
    extracted: row?.extracted ?? 0,
    reviewed: row?.reviewed ?? 0,
    verified: row?.verified ?? 0,
  };
}

export interface ListStatusOptions {
  /** `?status=` filter; already validated by the caller. */
  status?: StatusValue;
}

/**
 * Lists the entries of one type (or all eight for `type=all`) plus the summary.
 *
 * The summary is read **before** the `?status=` filter is applied: it describes
 * the whole requested type (docs/spec-api.md L78-83), and its three buckets add
 * up to `total`.
 *
 * Ordering is `object_key` ascending with `object_type` as the tiebreak. A key
 * is only unique *within* a type — `DS-ACAD1-C01-001` is both a quest and a drop
 * table — so the tiebreak is what makes `type=all` deterministic.
 */
export function listStatus(
  db: Db,
  types: readonly StatusObjectType[],
  options: ListStatusOptions = {},
): ListStatusResult {
  const summary = readSummary(db, types);

  const params: string[] = [...types];
  let sql = `SELECT ${ENTRY_COLUMNS}, ${LATEST_NOTES_SELECT}
    FROM entry_status es
    WHERE es.object_type IN (${placeholders(types.length)})`;

  if (options.status !== undefined) {
    sql += ' AND es.status = ?';
    params.push(options.status);
  }

  sql += ' ORDER BY es.object_key ASC, es.object_type ASC';

  const entries = db.prepare<string[], StatusEntryRow>(sql).all(...params);

  return { entries, summary };
}

/** One entry's row, or `undefined` when the key is unknown for that type. */
export function getStatusEntry(
  db: Db,
  objectType: StatusObjectType,
  objectKey: string,
): StatusEntryRow | undefined {
  return db
    .prepare<[StatusObjectType, string], StatusEntryRow>(
      `SELECT ${ENTRY_COLUMNS}, ${LATEST_NOTES_SELECT}
       FROM entry_status es
       WHERE es.object_type = ? AND es.object_key = ?`,
    )
    .get(objectType, objectKey);
}

export type StatusHistoryResult = { found: true; history: StatusHistoryRow[] } | { found: false };

/**
 * Full status-change history for one entry, oldest → newest (`id` ascending).
 *
 * An entry that exists but was never patched yet (an imported one) is a 200 with
 * an empty array — only an unknown *key* is a 404.
 */
export function getStatusHistory(
  db: Db,
  objectType: StatusObjectType,
  objectKey: string,
): StatusHistoryResult {
  const entry = db
    .prepare<[StatusObjectType, string], { id: number }>(
      'SELECT id FROM entry_status WHERE object_type = ? AND object_key = ?',
    )
    .get(objectType, objectKey);

  if (entry === undefined) {
    return { found: false };
  }

  const history = db
    .prepare<[number], StatusHistoryRow>(
      `SELECT old_status, new_status, notes, changed_by, changed_at
       FROM status_history
       WHERE entry_status_id = ?
       ORDER BY id ASC`,
    )
    .all(entry.id);

  return { found: true, history };
}

export interface StatusChangeInput {
  objectType: StatusObjectType;
  objectKey: string;
  status: StatusValue;
  /** Free-text notes stored on the history row (never on `entry_status`). */
  notes?: string | null;
  /** Already resolved by the caller (`settings.user_name` when the body omits it). */
  changedBy?: string | null;
  /** Timestamp for the new status and the history row; injectable for tests. */
  now?: string;
}

/**
 * Applies one status transition and appends its `status_history` row.
 *
 * D15 (docs/plan-overview.md L105): any direction is allowed and every change is
 * logged. The update sets **only** the timestamp/by pair of the *new* status —
 * `reviewed` touches `reviewed_at`/`reviewed_by`, `verified` touches
 * `verified_at`/`verified_by`, `extracted` touches neither — and never clears a
 * previously set pair: those columns are the historical record of when each
 * milestone was first reached.
 *
 * Both writes happen in ONE transaction (the spec's lifecycle row +
 * `status_history` are consistent or neither happened), and the freshly read row
 * is returned in the `entries[]` shape, `latest_notes` included.
 *
 * Returns `undefined` for an unknown key — the caller turns that into a 404.
 */
export function applyStatusChange(db: Db, input: StatusChangeInput): StatusEntryRow | undefined {
  const now = input.now ?? new Date().toISOString();
  const notes = input.notes ?? null;
  const changedBy = input.changedBy ?? null;

  const findEntry = db.prepare<[StatusObjectType, string], { id: number; status: string }>(
    'SELECT id, status FROM entry_status WHERE object_type = ? AND object_key = ?',
  );
  const updateReviewed = db.prepare(
    'UPDATE entry_status SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?',
  );
  const updateVerified = db.prepare(
    'UPDATE entry_status SET status = ?, verified_at = ?, verified_by = ? WHERE id = ?',
  );
  const updatePlain = db.prepare('UPDATE entry_status SET status = ? WHERE id = ?');
  const insertHistory = db.prepare(
    `INSERT INTO status_history (entry_status_id, old_status, new_status, notes, changed_by, changed_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const existing = findEntry.get(input.objectType, input.objectKey);
  if (existing === undefined) {
    return undefined;
  }

  const transition = db.transaction((entryId: number, oldStatus: string): void => {
    switch (input.status) {
      case 'reviewed':
        updateReviewed.run(input.status, now, changedBy, entryId);
        break;
      case 'verified':
        updateVerified.run(input.status, now, changedBy, entryId);
        break;
      default:
        updatePlain.run(input.status, entryId);
        break;
    }
    insertHistory.run(entryId, oldStatus, input.status, notes, changedBy, now);
  });

  transition(existing.id, existing.status);

  return getStatusEntry(db, input.objectType, input.objectKey);
}

export interface DashboardOverall extends StatusSummary {
  /** `verified / total * 100`, rounded to one decimal; `0` when `total = 0`. */
  percent_verified: number;
}

export interface DashboardResult {
  /** All eight singular keys, zeros included, so the UI table never shifts. */
  types: Record<StatusObjectType, StatusSummary>;
  overall: DashboardOverall;
}

/**
 * Verified share as a percentage with one decimal (docs/spec-api.md L158:
 * `272 / 597 → 45.6`). `total = 0` is `0`, never `NaN`/`null`.
 */
export function percentVerified(verified: number, total: number): number {
  if (total === 0) {
    return 0;
  }
  return Math.round((verified / total) * 1000) / 10;
}

/**
 * Per-type and overall verification counts (docs/spec-api.md L144-164).
 *
 * Read straight from `entry_status`, so the dashboard can never disagree with
 * the list endpoints. Every one of the eight types is present even with no rows.
 */
export function readDashboard(db: Db): DashboardResult {
  const rows = db
    .prepare<[], { object_type: string; status: string; count: number }>(
      `SELECT object_type, status, COUNT(*) AS count
       FROM entry_status
       GROUP BY object_type, status`,
    )
    .all();

  const types = Object.fromEntries(
    STATUS_OBJECT_TYPES.map((objectType) => [
      objectType,
      { total: 0, extracted: 0, reviewed: 0, verified: 0 } satisfies StatusSummary,
    ]),
  ) as Record<StatusObjectType, StatusSummary>;

  for (const row of rows) {
    const bucket = types[row.object_type as StatusObjectType];
    if (bucket === undefined) {
      // A type outside the tracked eight (GlobalRegistry is never tracked) does
      // not appear in the dashboard and is not part of `overall` either.
      continue;
    }
    bucket.total += row.count;
    if (isStatusValue(row.status)) {
      bucket[row.status] += row.count;
    }
  }

  const overall: DashboardOverall = {
    total: 0,
    extracted: 0,
    reviewed: 0,
    verified: 0,
    percent_verified: 0,
  };
  for (const objectType of STATUS_OBJECT_TYPES) {
    const bucket = types[objectType];
    overall.total += bucket.total;
    overall.extracted += bucket.extracted;
    overall.reviewed += bucket.reviewed;
    overall.verified += bucket.verified;
  }
  overall.percent_verified = percentVerified(overall.verified, overall.total);

  return { types, overall };
}
