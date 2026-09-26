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

import type { NameRow, NameRowMap, NamesType } from './display';
import type { SyncCounts } from './toast';

/** Body shape of every non-2xx JSON response (docs/spec-api.md L227). */
interface ApiErrorBody {
  error?: string;
}

/**
 * A failed request, carrying the HTTP status and the server's own message so a
 * caller can branch on `status` and still show something actionable.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** REQUEST helper: the `Accept` header every call sends. */
const JSON_HEADERS = { Accept: 'application/json' } as const;

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

/** Reads the plain-text body of a failed response before throwing. */
async function readError(response: Response): Promise<string> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return `Request failed with status ${response.status}`;
  }

  if (text.trim() !== '') {
    try {
      const body = JSON.parse(text) as ApiErrorBody;
      if (typeof body?.error === 'string' && body.error !== '') {
        return body.error;
      }
    } catch {
      // Not JSON — fall through to the status text.
    }
    return text;
  }

  return response.statusText !== ''
    ? response.statusText
    : `Request failed with status ${response.status}`;
}

/**
 * Performs one JSON request and returns the parsed body.
 *
 * A JSON `Content-Type` is added only when a `body` is present, the caller has
 * not set one, and the body is not self-typing (`FormData`/`URLSearchParams`/
 * `Blob` — see {@link isSelfTypedBody}). An empty success body (e.g. 204) resolves
 * to `undefined`, and any other unparsable success body throws rather than
 * resolving to garbage.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) {
    headers.set('Accept', JSON_HEADERS.Accept);
  }
  if (init.body !== undefined && !isSelfTypedBody(init.body) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, { ...init, headers });

  if (!response.ok) {
    throw new ApiError(response.status, await readError(response));
  }

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
 */
export function getName(type: NamesType, id: string): Promise<NameRowMap[NamesType]> {
  return apiFetch<NameRowMap[NamesType]>(`/api/names/${type}/${encodeURIComponent(id)}`);
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
}

/** Query key for the once-per-process first-startup import report. */
export const IMPORT_REPORT_QUERY_KEY = ['status', '_import'] as const;

/** Whether this server process imported pre-existing entries, and how many. */
export function getImportReport(): Promise<ImportReport> {
  return apiFetch<ImportReport>('/api/status/_import');
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

/** `POST /api/extract/quests` success body (docs/spec-api.md L303-307). */
export interface ExtractQuestsResult {
  quests: QuestObject[];
  count: number;
}

/** The extraction endpoint and its multipart field name (docs/spec-api.md L301). */
export const EXTRACT_QUESTS_PATH = '/api/extract/quests';
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
  return apiFetch<ExtractQuestsResult>(EXTRACT_QUESTS_PATH, {
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
