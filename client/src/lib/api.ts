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
 * A JSON `Content-Type` is added only when a `body` is present and the caller
 * has not set one. An empty success body (e.g. 204) resolves to `undefined`, and
 * any other unparsable success body throws rather than resolving to garbage.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) {
    headers.set('Accept', JSON_HEADERS.Accept);
  }
  if (init.body !== undefined && !headers.has('Content-Type')) {
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
