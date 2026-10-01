/**
 * Client data layer — the typed fetch helper every feature calls (task 1.7).
 *
 * Only relative `/api/...` paths are used: the Vite dev server proxies `/api` to
 * Express on :3001 (`client/vite.config.ts`), and in a production build the same
 * origin serves both halves, so an absolute host would be wrong in both.
 *
 * The wire types below mirror the contracts the server already implements —
 * settings (decision D32) and status (decision D37). They are redeclared here
 * instead of imported because the client tsconfig only sees `src` + `shared`,
 * and the server modules carry Node-only dependencies; `shared/index.ts` is
 * reserved for values both halves genuinely share.
 */

import { reportRequestFailure, reportRequestSuccess } from './connection';
import type { NameRow, NameRowMap, NamesType } from './display';
import {
  catalogRequestPath,
  COVERAGE_PATH,
  type CatalogFilter,
  type QuestCatalogResult,
  type QuestCoverage,
} from './quest-catalog';
import type { SyncCounts } from './toast';
import {
  draftsRequestPath,
  type DraftFilter,
  type DraftList,
  type Suggestion,
  type SuggestionsBody,
} from './suggestions';

/** Body shape of every non-2xx JSON response (docs/spec-api.md L227). */
interface ApiErrorBody {
  error?: string;
  /**
   * The per-field map a **400** may carry beside its message (decisions D64/D65) — `Name`,
   * `RollChance`, … → the blocking sentence(s). It is the multi-error payload that
   * `components/shared/ValidationSummary.tsx` renders at the top of a form.
   */
  fields?: Record<string, string[]>;
}

/**
 * A failed request, carrying the HTTP status and the server's own message so a
 * caller can branch on `status` and still show something actionable.
 */
export class ApiError extends Error {
  readonly status: number;

  /** The 400 field map when the server sent one, `undefined` otherwise (D64). */
  readonly fields?: Record<string, string[]>;

  constructor(status: number, message: string, fields?: Record<string, string[]>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (fields !== undefined) {
      this.fields = fields;
    }
  }
}

/** REQUEST helper: the `Accept` header every call sends. */
const JSON_HEADERS = { Accept: 'application/json' } as const;

/**
 * `true` when retrying a failed request could plausibly give a different answer: a transport
 * failure (the `fetch` rejected, so there is no status at all) or a **5xx**.
 *
 * A 4xx is final — it is the request working correctly (a validation error, or the 404 the
 * detail pages render as their "not found" state), so the retry action of the API-error toast
 * (`lib/notify.ts`) is not offered for one (story p5-04, AC3).
 *
 * It lives here, beside {@link ApiError}, rather than in the hook that uses it: this module has no
 * React entry point, so the predicate is unit-testable in plain node.
 */
export function isRetryableApiError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return error.status >= 500;
  }
  // A non-`ApiError` from `apiFetch` is either a rejected fetch (no HTTP answer) or an
  // unparsable success body — both are worth another try, and neither is a validation verdict.
  return true;
}

/**
 * `true` for a body the browser encodes itself — `FormData` (multipart boundary),
 * `URLSearchParams` (url-encoded) and `Blob` (its own type).
 *
 * Those must never get the JSON `Content-Type` below: a multipart upload whose
 * header says `application/json` has no boundary and the server cannot parse it
 * (decision D47's `POST /api/extract/quests` is the first such request).
 */
function isSelfTypedBody(body: BodyInit | null | undefined): boolean {
  if (body === null || body === undefined || typeof body !== 'object') {
    return false;
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return true;
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return true;
  }
  return typeof Blob !== 'undefined' && body instanceof Blob;
}

/** The parsed pieces of a failed response: the message, and the field map if there is one. */
interface ErrorBody {
  message: string;
  fields?: Record<string, string[]>;
}

/** `true` for the D64 field map: a plain object whose values are string arrays. */
function isFieldMap(value: unknown): value is Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (messages) => Array.isArray(messages) && messages.every((one) => typeof one === 'string'),
  );
}

/** Reads the plain-text body of a failed response before throwing. */
async function readError(response: Response): Promise<ErrorBody> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { message: `Request failed with status ${response.status}` };
  }

  if (text.trim() !== '') {
    try {
      const body = JSON.parse(text) as ApiErrorBody;
      if (typeof body?.error === 'string' && body.error !== '') {
        // The field map rides along only when it has the documented shape; anything else
        // stays out of `ApiError` rather than being rendered as if it were validation.
        return isFieldMap(body.fields)
          ? { message: body.error, fields: body.fields }
          : { message: body.error };
      }
    } catch {
      // Not JSON — fall through to the status text.
    }
    return { message: text };
  }

  return {
    message:
      response.statusText !== ''
        ? response.statusText
        : `Request failed with status ${response.status}`,
  };
}

/**
 * Performs one JSON request and returns the parsed body.
 *
 * A JSON `Content-Type` is added only when a `body` is present, the caller has
 * not set one, and the body is not self-typing (`FormData`/`URLSearchParams`/
 * `Blob` — see {@link isSelfTypedBody}). An empty success body (e.g. 204) resolves
 * to `undefined`, and any other unparsable success body throws rather than
 * resolving to garbage.
 *
 * Every outcome is also reported to the connection store (`lib/connection.ts`), which is how
 * the offline banner learns that a request failed without any page knowing the banner exists.
 * The report is deliberately asymmetric: a **4xx is a success** as far as the transport is
 * concerned (the server answered: a validation error is not an outage), while only a rejected
 * `fetch` or a **5xx** marks the connection suspect.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) {
    headers.set('Accept', JSON_HEADERS.Accept);
  }
  if (init.body !== undefined && !isSelfTypedBody(init.body) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch (error) {
    // No HTTP answer at all: the connection itself is what failed.
    reportRequestFailure();
    throw error;
  }

  if (!response.ok) {
    if (response.status >= 500) {
      reportRequestFailure();
    } else {
      reportRequestSuccess();
    }
    const { message, fields } = await readError(response);
    throw new ApiError(response.status, message, fields);
  }

  reportRequestSuccess();

  const text = await response.text();
  if (text.trim() === '') {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${path} returned a body that is not valid JSON`);
  }
}

/* ------------------------------------------------------------------ settings */

/** The five settings keys the settings API exposes (decision D32). */
export type SettingKey =
  'aurorium_path' | 'imcodec_path' | 'user_name' | 'spiraldb_path' | 'git_branch';

/** `GET`/`PUT /api/settings` response: one flat string map, `user_name` may be `""`. */
export type Settings = Record<SettingKey, string>;

/** TanStack Query key for the settings query, shared by the gate and the shell. */
export const SETTINGS_QUERY_KEY = ['settings'] as const;

/** `GET /api/settings` — the current settings map. */
export function getSettings(): Promise<Settings> {
  return apiFetch<Settings>('/api/settings');
}

/** `PUT /api/settings` — partial update, answers with the full updated map. */
export function putSettings(patch: Partial<Settings>): Promise<Settings> {
  return apiFetch<Settings>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

/* -------------------------------------------------------------------- status */

/** Plural route segments; `all` is read-only and excluded (decision D4/D37). */
export type StatusRouteType =
  | 'quests'
  | 'drop_tables'
  | 'npc_inventories'
  | 'npc_spell_inventories'
  | 'creature_spellbooks'
  | 'npc_drop_tables'
  | 'treasure_card_inventories'
  | 'zone_transfers';

/** Singular `object_type` value the server stores (decision D4/D37). */
export type StatusObjectType =
  | 'quest'
  | 'drop_table'
  | 'npc_inventory'
  | 'npc_spell_inventory'
  | 'creature_spellbook'
  | 'npc_drop_table'
  | 'treasure_card_inventory'
  | 'zone_transfer';

/** The three verification lifecycle values (docs/spec-data-model.md L9-19). */
export type StatusValue = 'extracted' | 'reviewed' | 'verified';

/** One row of `GET /api/status/:type` — also the shape `PATCH` answers with. */
export interface StatusEntry {
  object_type: StatusObjectType;
  object_key: string;
  status: StatusValue;
  extracted_at: string | null;
  reviewed_at: string | null;
  verified_at: string | null;
  latest_notes: string | null;
}

/** Counts for the whole type, computed before the `?status=` filter (D37). */
export interface StatusSummary {
  total: number;
  extracted: number;
  reviewed: number;
  verified: number;
}

/** `GET /api/status/:type` response envelope. */
export interface StatusList {
  entries: StatusEntry[];
  summary: StatusSummary;
}

/** `PATCH /api/status/:type/:key` request body. */
export interface StatusPatchBody {
  status: StatusValue;
  notes?: string | null;
  /** Omitted → the server falls back to `settings.user_name` (D37). */
  changed_by?: string | null;
}

/** TanStack Query key for one status list. */
export function statusQueryKey(type: StatusRouteType): readonly [string, StatusRouteType] {
  return ['status', type] as const;
}

/** Builds the `?status=` query string only when a filter is actually given. */
function statusQuery(options?: { status?: StatusValue }): string {
  return options?.status === undefined ? '' : `?status=${encodeURIComponent(options.status)}`;
}

/** `GET /api/status/:type` — entries plus the pre-filter summary. */
export function getStatus(
  type: StatusRouteType,
  options?: { status?: StatusValue },
): Promise<StatusList> {
  return apiFetch<StatusList>(`/api/status/${type}${statusQuery(options)}`);
}

/**
 * `PATCH /api/status/:type/:key` — one verification transition. Passing
 * `status`/`notes` in the body is the caller's job; `changed_by` should come from
 * the `user_name` gate, though the server defaults it when omitted.
 */
export function patchStatus(
  type: StatusRouteType,
  key: string,
  body: StatusPatchBody,
): Promise<StatusEntry> {
  return apiFetch<StatusEntry>(`/api/status/${type}/${encodeURIComponent(key)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/* ----------------------------------------------------------- status history */

/**
 * One `history[]` element of `GET /api/status/:type/:key/history` (decision D37,
 * docs/spec-api.md L106-141).
 *
 * `old_status` is `null` on the row that first tracked the entry; `changed_at` is
 * nullable because the column is, and `changed_by` is `null` for an unattributed
 * change (D37: only an absent `changed_by` defaults to `settings.user_name`).
 */
export interface StatusHistoryEntry {
  old_status: StatusValue | null;
  new_status: StatusValue;
  notes: string | null;
  changed_by: string | null;
  changed_at: string | null;
}

/**
 * Prefix key of every status-history query, for invalidation.
 *
 * The per-entry key is built by {@link statusHistoryQueryKey} — one prefix so a
 * transition can invalidate the histories without naming each entry (the same
 * prefix/read pattern as `QUESTS_QUERY_KEY` + `questDetailQueryKey`).
 */
export const STATUS_HISTORY_QUERY_KEY = ['status-history'] as const;

/** TanStack Query key for one entry's status history. */
export function statusHistoryQueryKey(
  type: StatusRouteType,
  key: string,
): readonly [string, StatusRouteType, string] {
  return ['status-history', type, key] as const;
}

/**
 * `GET /api/status/:type/:key/history` — **oldest → newest** (the server orders by
 * `status_history.id`; decision D37). The envelope is unwrapped, so callers deal in
 * rows only.
 *
 * An entry with no `entry_status` row answers `404 { error: 'Unknown quests entry
 * "…"' }` — an {@link ApiError} with `status === 404` — which the history panel
 * renders as its untracked state rather than as a failure (`retry: false`).
 */
export async function getStatusHistory(
  type: StatusRouteType,
  key: string,
): Promise<StatusHistoryEntry[]> {
  const body = await apiFetch<{ history: StatusHistoryEntry[] }>(
    `/api/status/${type}/${encodeURIComponent(key)}/history`,
  );
  return body.history;
}

/* ----------------------------------------------------------------- dashboard */

/**
 * Per-type verification counts — one `types[<object_type>]` bucket
 * (docs/spec-api.md L144-164, decision D37).
 *
 * The three buckets always add up to `total` on the wire, and every one of the
 * eight tracked types is present **with zeros included**, which is what lets the
 * dashboard render a stable table on a fresh database.
 */
export interface VerificationBucket {
  total: number;
  extracted: number;
  reviewed: number;
  verified: number;
}

/** The dashboard's `overall` bucket: the four counts plus the server's own percentage. */
export interface DashboardOverall extends VerificationBucket {
  /** `verified / total * 100` to one decimal, `0` when `total` is 0 (D37). */
  percent_verified: number;
}

/**
 * `GET /api/dashboard` response.
 *
 * `types` is keyed by the D4 **singular** `object_type` and holds exactly the eight
 * tracked types — GlobalRegistry is absent by Q1 (it has no `object_type`, no route
 * and no lifecycle), so it can never be a card or a bar.
 */
export interface DashboardResult {
  types: Record<StatusObjectType, VerificationBucket>;
  overall: DashboardOverall;
}

/** TanStack Query key for the dashboard aggregate read. */
export const DASHBOARD_QUERY_KEY = ['dashboard'] as const;

/**
 * `GET /api/dashboard` — the aggregate the four stat cards and the per-type bars
 * read. One request feeds both, so the cards and the bars cannot disagree.
 */
export function getDashboard(): Promise<DashboardResult> {
  return apiFetch<DashboardResult>('/api/dashboard');
}

/* ------------------------------------------------------------------ activity */

/**
 * The feed length `GET /api/activity` defaults to — the spec's "last 10 status
 * changes" (docs/spec-ui-design.md L162-177). The server's own default lives in
 * `server/src/services/status.ts`; this constant is the client's request value, so
 * the two are one decision written once per half (the api.ts convention).
 */
export const ACTIVITY_DEFAULT_LIMIT = 10;

/**
 * One `activity[]` row of `GET /api/activity` (decision D27) — a `status_history`
 * row joined to its entry.
 *
 * `id` is the `status_history` primary key: `changed_at` can repeat, so it is the
 * only safe React key.
 *
 * **`object_type` is `string | null`, not {@link StatusObjectType} | null**, and
 * deliberately so: `null` means the join found no parent, and a value outside the
 * eight tracked types is also possible (nothing prevents a hand-written row).
 * Both cases are unlinkable and the feed must render them without a link rather
 * than assume the union (`lib/dashboard.ts` owns that mapping).
 */
export interface ActivityEntry {
  id: number;
  object_type: string | null;
  object_key: string | null;
  old_status: StatusValue | null;
  /** The status the entry moved to; `null`-free because the column is NOT NULL. */
  new_status: StatusValue;
  notes: string | null;
  changed_by: string | null;
  changed_at: string | null;
}

/** `GET /api/activity` response envelope (the `{ history }` shape of D37). */
export interface ActivityFeed {
  activity: ActivityEntry[];
  /** Rows in this feed the join could not tie to a live, tracked entry. */
  unresolved: number;
}

/** TanStack Query key prefix for every activity read — invalidation targets this. */
export const ACTIVITY_QUERY_KEY = ['activity'] as const;

/** TanStack Query key for one feed length. */
export function activityQueryKey(limit = ACTIVITY_DEFAULT_LIMIT): readonly [string, number] {
  return ['activity', limit] as const;
}

/**
 * `GET /api/activity?limit=` — the newest status changes, newest first.
 *
 * The envelope is kept whole (unlike `getStatusHistory`): `unresolved` is part of
 * the answer the feed must show, not metadata a caller can drop.
 */
export function getActivity(limit = ACTIVITY_DEFAULT_LIMIT): Promise<ActivityFeed> {
  return apiFetch<ActivityFeed>(`/api/activity?limit=${String(limit)}`);
}

/* -------------------------------------------------------------------- search */

/**
 * The `?limit=` the ⌘K palette sends to `GET /api/search` — the length the acceptance
 * criterion names (plan task 5.2 / P5 AC#4). The server's own default lives in
 * `server/src/services/search.ts`; the two are one decision written once per half, the
 * api.ts convention `ACTIVITY_DEFAULT_LIMIT` already follows.
 *
 * It is a **per-group** cap: at most `limit` results in each `groups[]` element, so one
 * substring that matches both a quest key and a DropTable key returns both groups rather
 * than letting the first consume the whole budget. Recorded on the endpoint's own D1 sheet.
 */
export const SEARCH_DEFAULT_LIMIT = 20;

/**
 * One `results[]` row of `GET /api/search` (decision D27).
 *
 * **`object_type` and `object_key` are `string | null`, not the D4 union** — the same
 * deliberate looseness {@link ActivityEntry} documents: they are non-null exactly when the
 * row has a detail route, and the wire could in principle carry a type outside the tracked
 * eight. The palette resolves them through the existing D4 mapping and renders `null` as
 * "no link" rather than assuming the union.
 */
export interface SearchResultRow {
  object_type: string | null;
  object_key: string | null;
  /** Primary text: the object key, or the friendly name of a routeless row. */
  label: string;
  /** The friendly name known for the row (a quest's title), or `null`. */
  name: string | null;
  /** The friendly table row's own id as text; `null` for an object row. */
  source_id: string | null;
  /** `null` for a routeless row — which is exactly when the dot is absent. */
  status: StatusValue | null;
  matched_on: 'key' | 'name';
  /**
   * The NPC group's name strings, one entity per row (P6-17/D112) — both `["Gretta",
   * "Gretta Darkkettle"]` for the one NPC they belong to. Absent for every other group.
   */
  aliases?: string[];
}

/** One `groups[]` element: a type, the heading to render, and its rows. */
export interface SearchGroup {
  /** The group key — a D4 singular type, or `item` / `spell` / `npc`. */
  type: string;
  /** The heading the server decided, so the client needs no second label table. */
  label: string;
  results: SearchResultRow[];
}

/** `GET /api/search` response envelope (the endpoint's own D1 record). */
export interface SearchResponse {
  /** The trimmed query actually searched; `''` for the blank (just-opened) state. */
  query: string;
  /** The per-group cap that was applied. */
  limit: number;
  /** Rows in this response — the sum of every group's `results.length`. */
  total: number;
  /** `true` when at least one group matched more rows than the cap allowed. */
  truncated: boolean;
  /** Rows with no detail route (the items/spells/npcs name hits). */
  unresolved: number;
  groups: SearchGroup[];
}

/** TanStack Query key for one query text. */
export function searchQueryKey(
  q: string,
  limit = SEARCH_DEFAULT_LIMIT,
): readonly [string, string, number] {
  return ['search', q, limit] as const;
}

/**
 * The request path for one search. The query is percent-encoded, so a key containing `&`
 * or `?` cannot change the request's shape.
 */
export function searchPath(q: string, limit = SEARCH_DEFAULT_LIMIT): string {
  return `/api/search?q=${encodeURIComponent(q)}&limit=${String(limit)}`;
}

/** `GET /api/search?q=&limit=` — the palette's read. */
export function searchObjects(q: string, limit = SEARCH_DEFAULT_LIMIT): Promise<SearchResponse> {
  return apiFetch<SearchResponse>(searchPath(q, limit));
}

/* --------------------------------------------------------------------- names */

/** Query-key prefix for every names query; one entry per type. */
export function namesQueryKey(
  type: NamesType,
  options?: { q?: string; limit?: number },
): readonly unknown[] {
  return options === undefined ? ['names', type] : ['names', type, options];
}

/** Query key for the single-value display lookup (`GET /api/names/:type/:id`). */
export function nameLookupQueryKey(type: NamesType, id: string): readonly unknown[] {
  return ['name-lookup', type, id];
}

/** Optional server-side filters (decision D36; required for `strings`). */
export interface NamesListOptions {
  /** Case-insensitive substring over the label (key + value for `strings`). */
  q?: string;
  /** Max rows; the server validates it is a positive integer. */
  limit?: number;
}

/** Builds the `?q=`/`?limit=` query string, if any. */
function namesQueryString(options?: NamesListOptions): string {
  if (options === undefined) {
    return '';
  }
  const params = new URLSearchParams();
  if (options.q !== undefined && options.q !== '') {
    params.set('q', options.q);
  }
  if (options.limit !== undefined) {
    params.set('limit', String(options.limit));
  }
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

/**
 * `GET /api/names/:type` — the rows of one friendly-name table.
 *
 * The wire body is the spec envelope `{ "<type>": [rows] }` (decision D36); the
 * envelope is unwrapped here so callers deal in rows only.
 *
 * **Never call this for `strings` without `options`**: 216,991 rows ≈ 24 MB. The
 * `useNames` hook enforces that rule; `?q=`/`?limit=` are the supported path.
 */
export async function getNames(type: NamesType, options?: NamesListOptions): Promise<NameRow[]> {
  const body = await apiFetch<Record<string, NameRow[]>>(
    `/api/names/${type}${namesQueryString(options)}`,
  );
  const rows = body[type];
  if (!Array.isArray(rows)) {
    throw new Error(`/api/names/${type} did not return the { ${type}: [...] } envelope`);
  }
  return rows;
}

/**
 * `GET /api/names/:type/:id` — one bare row, or an {@link ApiError} with status
 * 404 when the id is unknown. Callers render the raw id on 404, never an error
 * (docs/spec-domain-reference.md L693-695).
 *
 * Generic in the type so a caller that names its type (`getName('strings', key)`,
 * story p3-03's title lookup) gets that type's row instead of the seven-way union; a
 * caller holding a `NamesType` variable still gets the union, exactly as before.
 */
export function getName<T extends NamesType>(type: T, id: string): Promise<NameRowMap[T]> {
  return apiFetch<NameRowMap[T]>(`/api/names/${type}/${encodeURIComponent(id)}`);
}

/* ---------------------------------------------------------------------- sync */

/** `POST /api/sync` success body (docs/spec-api.md L239-252). */
export interface SyncResult {
  status: 'success';
  synced: SyncCounts;
  timestamp: string;
}

/** `GET /api/sync/status` body; `status: 'never'` is the empty-history case. */
export interface SyncStatus {
  last_sync: string | null;
  revision: string | null;
  status: string;
}

/** One `sync_history` row — every column the server exposes. */
export interface SyncHistoryEntry {
  id: number;
  sync_timestamp: string | null;
  revision: string | null;
  items_count: number | null;
  spells_count: number | null;
  npcs_count: number | null;
  quests_count: number | null;
  zones_count: number | null;
  status: string | null;
  error_message: string | null;
}

/** TanStack Query keys for the two sync read endpoints. */
export const SYNC_STATUS_QUERY_KEY = ['sync', 'status'] as const;
export const SYNC_HISTORY_QUERY_KEY = ['sync', 'history'] as const;

/**
 * `POST /api/sync` — **synchronous-blocking**: a fresh unpack takes ~20 s and the
 * response arrives only when the sync is done (decision D39 item 9). The caller
 * shows a spinner for the whole call; there is no job queue to poll.
 */
export function postSync(): Promise<SyncResult> {
  return apiFetch<SyncResult>('/api/sync', { method: 'POST' });
}

/** `GET /api/sync/status` — last sync timestamp, revision and status. */
export function getSyncStatus(): Promise<SyncStatus> {
  return apiFetch<SyncStatus>('/api/sync/status');
}

/** `GET /api/sync/history` — newest first. */
export async function getSyncHistory(): Promise<SyncHistoryEntry[]> {
  const body = await apiFetch<{ history: SyncHistoryEntry[] }>('/api/sync/history');
  return body.history;
}

/** `GET /api/status/_import` — this process's first-startup import report (D37). */
export interface ImportReport {
  ran: boolean;
  imported: number;
  imported_at: string | null;
  /**
   * **Client-side only — the server never sends this.** The shell sets it on the cached
   * report once it has announced the import, so "has this report been announced?" is state
   * the query layer owns rather than a module-level flag (final-deslop, F2).
   */
  announced?: boolean;
}

/** Query key for the once-per-process first-startup import report. */
export const IMPORT_REPORT_QUERY_KEY = ['status', '_import'] as const;

/** Whether this server process imported pre-existing entries, and how many. */
export function getImportReport(): Promise<ImportReport> {
  return apiFetch<ImportReport>('/api/status/_import');
}

/**
 * `true` when this import report still needs announcing (decision D37).
 *
 * The mark rides on the **cached report** ({@link ImportReport.announced}), so the shell's
 * toast has one owner — the query layer — instead of a module-level boolean. Two things
 * follow from that: StrictMode's double-mount and any later remount read the mark back and
 * do not re-announce, and a **second** import in the same process (a new report) is no
 * longer swallowed the way a permanent `let` swallowed it.
 *
 * It deliberately does **not** claim to survive a page load: the query cache is per-document,
 * and this app has no client-side persistence at all, so a reload still re-announces an old
 * import. That remainder is recorded as debt in `docs/evidence/final-deslop-d1-disposition.md`
 * (item 16) rather than papered over here.
 */
export function shouldAnnounceImport(report: ImportReport | undefined): boolean {
  return report !== undefined && report.ran && report.imported > 0 && report.announced !== true;
}

/* ---------------------------------------------------------------- extraction */

/**
 * One quest object exactly as the extraction CLI emits it.
 *
 * The fields named here are the ones the extraction UI reads (name, level, goal
 * count, preview tabs); the index signature keeps the rest — the whole
 * `QuestTemplate` schema of `docs/spec-domain-reference.md` L210-270 — reachable
 * without redeclaring a 50-field type the client only ever renders. Enums are
 * already the corpus's NAMES as of decision D48(a), so nothing is converted.
 */
export interface QuestObject {
  m_questName?: string | number;
  m_questTitle?: string | null;
  m_questLevel?: number;
  m_mainline?: boolean;
  m_goals?: unknown[];
  m_goalLogic?: unknown[];
  m_requirements?: unknown;
  m_prepRequirements?: unknown;
  m_pruneRequirements?: unknown;
  m_startResults?: unknown;
  m_endResults?: unknown;
  m_dialogList?: unknown;
  [key: string]: unknown;
}

/** One `capture-census` row (D139): a message type's field, how many messages carry it, and whether the reader reads it. */
export interface CensusRow {
  message: string;
  field: string;
  count: number;
  consumed: boolean;
}

/** The census of the uploaded capture, or why it could not run (D55 posture). */
export type ExtractCensus = { messages: number; rows: CensusRow[] } | { skipped: string };

/**
 * One inferred value from the wrapper's sidecar (task 7.5, D138): shown and stored as a suggestion, never
 * merged into a quest (D127/D129).
 */
export interface CaptureSuggestion {
  questName: string;
  path: string;
  value: unknown;
  source: 'capture-order' | 'capture-rewards';
  confidence: number;
  note: string;
}

/**
 * Whether the run's capture suggestions were staged as `quest_suggestions` rows (PR #14 review
 * 9a/9d; D195) — present only when the run inferred any.
 */
export type SuggestionsStoreOutcome =
  | { stored: true; inserted: number; unchanged: number; uncatalogued: number }
  | { stored: false; reason: string };

/** `POST /api/extract/quests` success body (docs/spec-api.md, that endpoint's section; `census` only with `?census=1`, D139). */
export interface ExtractQuestsResult {
  quests: QuestObject[];
  count: number;
  /** Always present since task 7.5, `[]` when nothing was inferred. */
  suggestions: CaptureSuggestion[];
  suggestions_store?: SuggestionsStoreOutcome;
  census?: ExtractCensus;
}

/** The extraction endpoint and its multipart field name (docs/spec-api.md L301). */
export const EXTRACT_QUESTS_PATH = '/api/extract/quests';
/** The extraction page always asks for the census (D139), so the upload result can show what was ignored. */
export const EXTRACT_QUESTS_CENSUS_PATH = `${EXTRACT_QUESTS_PATH}?census=1`;
export const EXTRACT_FILE_FIELD = 'file';

/**
 * `POST /api/extract/quests` — upload one `.json` packet capture.
 *
 * The `AbortSignal` is the client half of decision D9: aborting it closes the
 * response, and the server's `res.on('close')` handler kills the CLI child and
 * deletes the temp capture (D47). Cancelling is therefore never a client-only
 * no-op — which is why the signal is threaded through rather than left implicit.
 *
 * The body is `FormData`, so the browser writes `Content-Type:
 * multipart/form-data; boundary=…` itself (see {@link isSelfTypedBody}).
 */
export function extractQuests(
  file: File,
  options: { signal?: AbortSignal } = {},
): Promise<ExtractQuestsResult> {
  const body = new FormData();
  body.append(EXTRACT_FILE_FIELD, file);
  return apiFetch<ExtractQuestsResult>(EXTRACT_QUESTS_CENSUS_PATH, {
    method: 'POST',
    body,
    signal: options.signal,
  });
}

/* ------------------------------------------------------------- quests (list) */

/**
 * Where a row's `title` came from: a string-table hit, the raw `m_questTitle`
 * value, or `m_questName` because the quest has no title (D49).
 */
export type QuestTitleSource = 'resolved' | 'rawKey' | 'missing';

/**
 * One `quests[]` row of `GET /api/quests` (docs/spec-api.md L190-208, decision
 * D49) — the server's own `QuestListRow` mirrored field for field.
 *
 * p2-07 typed only `quest_name` (the field its overwrite check intersects); p2-08's
 * browse table needs all seven columns and the status, so the mirror is completed
 * here rather than left as an index signature that promises nothing.
 */
export interface QuestListRow {
  quest_name: string;
  /** String-table resolved title, raw `m_questTitle` key, or `m_questName`. */
  title: string;
  title_key: string | null;
  title_source: QuestTitleSource;
  level: number | null;
  goal_count: number;
  is_mainline: boolean;
  /** The source file's mtime, ISO 8601; `null` when it vanished before the stat. */
  modified_at: string | null;
  /** `entry_status.status`, defaulting to `extracted` when the quest has no row. */
  status: StatusValue;
}

/** A corpus file the list could not read, reported rather than fatal. */
export interface QuestListSkipped {
  file: string;
  message: string;
}

/** `GET /api/quests` success body. */
export interface QuestsListResult {
  quests: QuestListRow[];
  summary: { total: number; extracted: number; reviewed: number; verified: number };
  skipped: QuestListSkipped[];
}

/**
 * `GET /api/quests` — the SpiralDB quest list (p2-06's endpoint).
 *
 * p2-07 calls this lazily on the first save click (gap A): the extracted names are
 * intersected with these, so the user sees which quests would be overwritten
 * before anything is written. p2-08's browse table and detail header read it
 * through the shared `QUESTS_QUERY_KEY` cache.
 */
export function listQuests(): Promise<QuestsListResult> {
  return apiFetch<QuestsListResult>('/api/quests');
}

/**
 * TanStack Query key for one quest detail read (`GET /api/quests/:name`).
 *
 * The name is part of the key so two detail pages never share a cache entry.
 */
export function questDetailQueryKey(name: string): readonly [string, string] {
  return ['quest-detail', name] as const;
}

/**
 * `GET /api/quests/:name` — **the bare quest object**, not an envelope (D49).
 *
 * An unknown name answers `404 { error: 'Unknown quest "…"' }`, which surfaces as
 * an {@link ApiError} with `status === 404`; the detail page renders its
 * not-found state for exactly that, and an error state for anything else.
 */
export function getQuest(name: string): Promise<QuestObject> {
  return apiFetch<QuestObject>(`/api/quests/${encodeURIComponent(name)}`);
}

/* ---------------------------------------------------------- quests (evidence) */

/**
 * The **catalog link's** provenance (task 6.6, docs/spec-api.md L486-489) — `quests.title_source`
 * / `quest_ids.link_kind`. It is **not** the quests list endpoint's per-file `title_source`
 * (`resolved | rawKey | missing`, spec-data-model L209-214): the two fields share a name and answer
 * different questions, and `lib/evidence-insert.ts`'s badge is keyed on this enum only.
 */
export type EvidenceTitleSource = 'direct' | 'inferred' | 'none';

/** Which rung of the speaker ladder answered for one dialogue line. */
export type EvidenceSpeakerSource = 'override' | 'composed' | 'template' | 'raw';

export interface QuestEvidenceHeader {
  /** `null` on the id tier: an id with no linked catalog name has no name. */
  quest_name: string | null;
  quest_id: number | null;
  has_definition: boolean;
  link_kind: EvidenceTitleSource;
  title: string | null;
  title_source: EvidenceTitleSource;
  /** `quest_ids.inference_basis` when the link is inferred — an inferred link never travels alone. */
  inference_basis: string | null;
}

/** One row of the quest's **own** `WizQst<id>_*` table. */
export interface QuestEvidenceTextRow {
  key: string;
  value: string;
  category: string;
  used_by_this_file: boolean;
  /** The path of the file value that references this key (a formatted `DocPath`), or `null`. */
  field: string | null;
}

export interface QuestEvidenceGoalRef {
  wad: string;
  entry: string;
  class: string;
}

export interface QuestEvidenceGoalGate {
  goal_name: string;
  required_status: string | null;
  refs: QuestEvidenceGoalRef[];
}

export interface QuestEvidenceSpeaker {
  name: string;
  source: EvidenceSpeakerSource;
  persona: string;
  override_key: string | null;
  st_key: string | null;
  /** The persona's manifest id — the NPC page's route param; `null` when the persona is unindexed. */
  template_id: number | null;
}

/** One `NPCDialogEntry` the quest file records. */
export interface QuestEvidenceDialogue {
  index: number;
  /** The entry's path (a formatted `DocPath`). */
  field: string;
  /** The `WizQst<id>_*` key the entry's `m_dialog` names, when it names one. */
  dialog_key: string | null;
  /** `true` when {@link dialog_key} is a row of **this quest's own** table. */
  own_table: boolean;
  text: string | null;
  speaker: QuestEvidenceSpeaker;
  portrait: string | null;
  sound: string | null;
  /** `m_cameraName`, verbatim — a display hint, never the speaker's name. */
  camera_name: string | null;
  actor_template_id: number | null;
}

/** One field `REFERENCE_FIELDS` declares as a reference, resolved against the synced tables. */
export interface QuestEvidenceReference {
  field: string;
  value: unknown;
  key: string;
  sources: string[];
  kind: string | null;
  /** The friendly half and the single display rule's rendering, or `null` on a miss. */
  resolved: { label: string; display: string } | null;
}

/** `GET /api/quests/:name/evidence` — the one shape both evidence endpoints answer. */
export interface QuestEvidence {
  quest: QuestEvidenceHeader;
  text_rows: QuestEvidenceTextRow[];
  goal_gates: QuestEvidenceGoalGate[];
  dialogue: QuestEvidenceDialogue[];
  references: QuestEvidenceReference[];
  /** Misses are counted here, never dropped (spec-api L481-482, L453-454). */
  warnings: string[];
}

/** TanStack Query key for one quest's evidence read (the name is part of the key). */
export function evidenceQueryKey(name: string): readonly [string, string] {
  return ['quest-evidence', name] as const;
}

/**
 * `GET /api/quests/:name/evidence` — task 6.6's per-quest evidence surface, read by the evidence
 * panel (story p6-08). A resolved live join over the indexed tables: there is no materialised
 * evidence table, so an unknown name 404s exactly like the detail read.
 */
export function getQuestEvidence(name: string): Promise<QuestEvidence> {
  return apiFetch<QuestEvidence>(`/api/quests/${encodeURIComponent(name)}/evidence`);
}

/** `GET /api/quest-ids/:id/evidence` — the same shape for an unnamed-tier id (task 6.6). */
export function getQuestIdEvidence(id: number): Promise<QuestEvidence> {
  return apiFetch<QuestEvidence>(`/api/quest-ids/${id}/evidence`);
}

/* ------------------------------------------------------------------- NPC view */

/** One persona of an NPC (`GET /api/npcs/:id`, spec-api "NPC View"). */
export interface NpcViewPersona {
  persona_key: string;
  first: string | null;
  last: string | null;
  template_id: number | null;
}

/** One dialogue line an NPC speaks in a corpus quest file. */
export interface NpcViewDialog {
  quest_name: string;
  index: number;
  text: string | null;
}

/** One NPC-keyed inventory file. */
export interface NpcViewInventoryRow {
  key: string;
  file: string;
}

/** The NPC view: aliases, personas, dialogs, quests and inventories, with matching `counts`. */
export interface NpcView {
  npc_key: string;
  template_id: number | null;
  display_name: string;
  aliases: string[];
  personas: NpcViewPersona[];
  dialogs: NpcViewDialog[];
  quests: string[];
  inventories: {
    npc_inventories: NpcViewInventoryRow[];
    npc_spell_inventories: NpcViewInventoryRow[];
    npc_drop_tables: NpcViewInventoryRow[];
  };
  counts: { aliases: number; personas: number; dialogs: number; quests: number };
  /** Why an arm is empty when the reason is not "there are no rows". */
  notes: string[];
}

/** TanStack Query key for one NPC view (the id, in either accepted form, is part of the key). */
export function npcQueryKey(id: string): readonly [string, string] {
  return ['npc', id] as const;
}

/**
 * `GET /api/npcs/:id` — the NPC view (task 6.6, D112) that the `/npcs/:npcId` page (task 7.14)
 * reads. `id` is a template id or an alias key; an unknown NPC is a 404 whose message is the
 * server's own (`Unknown NPC "…"`).
 */
export async function getNpc(id: string): Promise<NpcView> {
  const response = await apiFetch<{ npc: NpcView }>(`/api/npcs/${encodeURIComponent(id)}`);
  return response.npc;
}

/* ------------------------------------------------------------- quests (save) */

/**
 * `{ created, updated }` — the save pipeline's outcome word for a file and, for
 * quests, for its companion metadata file (server `SaveOutcome`).
 */
export type SaveOutcome = 'created' | 'updated';

/** `POST /api/quests` request body (docs/spec-api.md L236, gap B of story p2-07). */
export interface SaveQuestBody {
  quest: QuestObject;
  /** Optional git commit body; the endpoint records no status note. */
  notes?: string;
  /**
   * The capture file the quest was extracted from (plan §2.4, gap B). The page
   * knows it — the user picked the file — so both save paths send it. The server
   * reduces it to a base name and records
   * `Imported from packet capture {source}` on a **create** only; an update adds
   * no note and never resets the status. Absent ⇒ exactly the old behaviour.
   */
  source?: string;
  /**
   * Task 7.7 (D141): the suggestion ids this document applies. Validated before the write and
   * flipped to `accepted` only after the commit.
   */
  accepted_suggestions?: number[];
}

/** `POST /api/quests` success body (docs/spec-api.md L239-251, decision D49(a)). */
export interface SaveQuestResult {
  quest_name: string;
  outcome: SaveOutcome;
  action: 'extract' | 'update';
  /** This save's single commit sha (D13). */
  commit: string;
  branch: string;
  commit_message: string;
  /** Committed path relative to the SpiralDB root. */
  file: string;
  metadata: string | null;
  metadata_outcome: SaveOutcome | null;
  status: StatusEntry;
  /** The D48(d) duplicate-metadata report; empty when there is none. */
  warnings: string[];
  /** Task 7.7: the ids this save flipped to `accepted` (absent on a pre-7.7 server). */
  accepted_suggestions?: number[];
}

/**
 * Prefix key of the quest browse list (`GET /api/quests`, built by p2-08).
 *
 * Declared here — not in the list page — because a save invalidates it: the list
 * is the screen that must grow by the saved quests, and both halves have to agree
 * on one key.
 */
export const QUESTS_QUERY_KEY = ['quests'] as const;

/**
 * `POST /api/quests` — save one quest: file write + D20 metadata + git commit +
 * status (tasks 2.4/2.5). One request per quest: the endpoint commits per object
 * (D13), so a multi-quest save is a sequence of these calls, not a batch.
 */
export function saveQuest(body: SaveQuestBody): Promise<SaveQuestResult> {
  return apiFetch<SaveQuestResult>('/api/quests', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/* ------------------------------------------------------- quests (scaffold) */

/**
 * `POST /api/quests/scaffold` success body (task 6.8 / story p6-09, D100/D101).
 *
 * `quest` is the skeleton that was written — what the editor is opened on. `link_kind`
 * and `title_key` say what the catalog link contributed: `title_key` is non-null **only**
 * for a direct link that resolved to exactly one `QuestTitle_*` key, so a caller can show
 * the inferred badge without re-deriving anything.
 *
 * `has_definition_before` is the column **as read before the write**: the sync flips it to
 * 1 on its next run, which is why it is named `before` rather than echoed as `true`.
 */
export interface ScaffoldQuestResult {
  quest_name: string;
  link_kind: EvidenceTitleSource;
  title_key: string | null;
  has_definition_before: 0 | 1;
  outcome: 'created';
  action: string;
  file: string;
  metadata: string | null;
  commit: string;
  branch: string;
  commit_message: string;
  quest: QuestObject;
}

/**
 * `POST /api/quests/scaffold` — create the minimal `QuestTemplates/` file for a catalog
 * quest with `has_definition = 0`, through the same save pipeline every other save uses
 * (template + companion metadata + one commit, D100). There is no draft lifecycle.
 *
 * The route's refusals are actionable and typed by status: `404` when the catalog holds no
 * such name, `409` when the quest already has a file, `400` for a name that would write
 * outside `QuestTemplates/`. The **caller** (task 6.10's Catalog view) is the one that
 * navigates to the editor on success — this function only writes.
 */
export function scaffoldQuest(questName: string): Promise<ScaffoldQuestResult> {
  return apiFetch<ScaffoldQuestResult>('/api/quests/scaffold', {
    method: 'POST',
    body: JSON.stringify({ quest_name: questName }),
  });
}

/**
 * Task 7.7 (D142): a draft's first save — the scaffold route with the editor's in-memory document
 * (`quest`), the ids it applies, and for an unnamed draft the `catalog_id` its chosen name is given
 * to. `404`/`409`/`400` keep the scaffold's meanings; a naming refusal writes nothing.
 */
export interface ScaffoldDraftBody {
  quest_name: string;
  quest: QuestObject;
  catalog_id?: number;
  accepted_suggestions: number[];
}

export function scaffoldDraft(
  body: ScaffoldDraftBody,
): Promise<
  ScaffoldQuestResult & { named: boolean; accepted_suggestions: number[]; warnings: string[] }
> {
  return apiFetch('/api/quests/scaffold', { method: 'POST', body: JSON.stringify(body) });
}

/** `GET /api/quests/:name/scaffold` — the unwritten D118 skeleton a missing named draft opens on. */
export interface QuestSkeleton {
  quest_name: string;
  link_kind: EvidenceTitleSource;
  title_key: string | null;
  quest: QuestObject;
}

export function getQuestSkeleton(questName: string): Promise<QuestSkeleton> {
  return apiFetch<QuestSkeleton>(`/api/quests/${encodeURIComponent(questName)}/scaffold`);
}

/* -------------------------------------------------------------- drafts (task 7.6) */

/** TanStack Query key of one draft-queue read; the filter is part of the key. */
export function draftsQueryKey(filter: DraftFilter): readonly unknown[] {
  return ['drafts', filter] as const;
}

/** `GET /api/drafts` — the queue, filtered and ranked by the server (D143). */
export function listDrafts(filter: DraftFilter): Promise<DraftList> {
  return apiFetch<DraftList>(draftsRequestPath(filter));
}

/** The draft whose suggestions are read: a catalog name, or an unnamed-tier id. */
export type SuggestionDraftKey = { questName: string } | { catalogId: number };

/** Prefix key of every suggestion read, so a save or reject can invalidate them all. */
export const SUGGESTIONS_QUERY_KEY = ['suggestions'] as const;

export function suggestionsQueryKey(draft: SuggestionDraftKey): readonly unknown[] {
  return [...SUGGESTIONS_QUERY_KEY, draft] as const;
}

/** `GET /api/quests/:name/suggestions` or `GET /api/quest-ids/:id/suggestions` (pending rows). */
export function getSuggestions(draft: SuggestionDraftKey): Promise<SuggestionsBody> {
  return apiFetch<SuggestionsBody>(
    'questName' in draft
      ? `/api/quests/${encodeURIComponent(draft.questName)}/suggestions`
      : `/api/quest-ids/${draft.catalogId}/suggestions`,
  );
}

/** `POST /api/suggestions/:id/reject` — immediate and durable (D141). */
export function rejectSuggestion(id: number): Promise<Suggestion> {
  return apiFetch<Suggestion>(`/api/suggestions/${id}/reject`, { method: 'POST' });
}

/** `POST /api/drafts/rebuild`'s body (D143) — every count read from the run. */
export interface DraftRebuildResult {
  proposed: number;
  inserted: number;
  unchanged: number;
  removed: number;
  by_source: Record<string, number>;
  drafts: { named_missing: number; named_defined: number; unnamed: number; zero_evidence: number };
  duration_ms: number;
}

/**
 * `POST /api/drafts/rebuild` — runs the draft builder (the same code as `npm run drafts`) and
 * answers when it is done; a `409` means one is already running. Touches only SQLite.
 */
export function postDraftsRebuild(): Promise<DraftRebuildResult> {
  return apiFetch<DraftRebuildResult>('/api/drafts/rebuild', { method: 'POST' });
}

/* ------------------------------------------------- quests (coverage + catalog) */

/**
 * TanStack Query key for the coverage read (`GET /api/quests/coverage`).
 *
 * One key for one definition: the Quests page's header and the Catalog view share it, so a
 * refetch after a scaffold moves both (the invalidation is the caller's, as everywhere else).
 */
export const QUEST_COVERAGE_QUERY_KEY = ['quest-coverage'] as const;

/**
 * `GET /api/quests/coverage` — the `coverage` view's five axes plus the corpus they were
 * measured against (task 6.10, spec-api.md L442-464).
 *
 * The types live in `lib/quest-catalog.ts` beside the header builder, so the sentence and the
 * numbers it is built from are one unit. The header is built from this response and never from
 * a constant — the plan's 1,447 is a different quantity (see `coverageHeadline`).
 */
export function getQuestCoverage(): Promise<QuestCoverage> {
  return apiFetch<QuestCoverage>(COVERAGE_PATH);
}

/** TanStack Query key for one catalog read; the filter is part of the key, so the two lists
 * (all rows, missing-only rows) are separate cache entries rather than one that lies. */
export function questCatalogQueryKey(missingOnly: boolean): readonly [string, boolean] {
  return ['quest-catalog', missingOnly] as const;
}

/**
 * `GET /api/quests/catalog` — the worklist, with `?missing_only=1` applied by the server (task
 * 6.10). The query comes from `catalogQuery`, the pure builder the unit test pins, so the filter
 * is never re-derived on the client.
 */
export function listQuestCatalog(
  filter: CatalogFilter = { missingOnly: false },
): Promise<QuestCatalogResult> {
  return apiFetch<QuestCatalogResult>(catalogRequestPath(filter));
}
