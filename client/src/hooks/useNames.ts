import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getNames, namesQueryKey } from '../lib/api';
import { toNameOptions, type NameOption, type NameRow, type NamesType } from '../lib/display';
import { filterNameOptions, MAX_NAME_OPTIONS, truncationHint } from '../lib/filter-names';

/**
 * `useNames(type)` — the cached friendly-name list behind
 * `FriendlyNameDropdown` (plan task 1.8 / decision D8, extended by D39 item 3).
 *
 * Two different data paths, on purpose:
 *
 * - **Bulk, six types.** `items` / `spells` / `npcs` / `quests` / `zones` /
 *   `drop_tables` load once through `GET /api/names/:type`
 *   (`staleTime: Infinity`, query key `['names', type]`) and are filtered
 *   client-side in a cmdk combobox, capped at {@link MAX_NAME_OPTIONS} with an
 *   explicit truncation hint.
 * - **Never bulk for `strings`.** 216,991 rows ≈ 24 MB must not be fetched on
 *   page load (decision D39 item 4), so `strings` uses the server-side `?q=` /
 *   `?limit=` extensions from D36 instead: the list query only runs once the user
 *   has typed at least {@link STRING_MIN_QUERY_LENGTH} characters, and a bulk
 *   fetch for this type is impossible through this hook.
 *
 * Both paths answer the same shape, so a dropdown does not care which one it got.
 */

/** Types whose full table is small enough to cache and filter in the browser. */
export const BULK_NAME_TYPES = [
  'items',
  'spells',
  'npcs',
  'quests',
  'zones',
  'drop_tables',
] as const;

/** The type that must never be bulk-loaded (24 MB / 216,991 rows). */
export const STREAMED_NAME_TYPE = 'strings' as const;

/** Rows requested per `strings` search. */
export const STRING_SEARCH_LIMIT = MAX_NAME_OPTIONS;

/** Characters needed before a `strings` search hits the server. */
export const STRING_MIN_QUERY_LENGTH = 2;

/** `true` when a type may be loaded in full. */
export function isBulkNameType(type: NamesType): type is (typeof BULK_NAME_TYPES)[number] {
  return (BULK_NAME_TYPES as readonly string[]).includes(type);
}

export interface NamesResult {
  /** The page of options to render (at most {@link MAX_NAME_OPTIONS}). */
  options: NameOption[];
  /** Total matches for the current query, before the cap. */
  total: number;
  /** `true` when more matched than are rendered — show {@link hint}. */
  truncated: boolean;
  /** `"showing 50 of 12,431 matches — keep typing"`, or `null`. */
  hint: string | null;
  /** The list query is in flight. */
  isLoading: boolean;
  /** The list query failed (an `Error`, usually an `ApiError`). */
  error: Error | null;
  /** `true` for the six bulk types, `false` for the server-searched `strings`. */
  isBulk: boolean;
  /** `true` when typing is required before anything can be fetched (`strings`). */
  needsQuery: boolean;
  /**
   * The label for a raw id already in the list, or `undefined` when the id is not
   * in it (then the caller resolves it with a single lookup — or shows the raw id).
   */
  labelFromList: (id: string) => string | undefined;
}

/**
 * Reads one friendly-name list.
 *
 * @param type   one of the seven names types
 * @param search the current combobox text; for `strings` it is sent to the server,
 *               for the bulk types it only filters the cached list
 */
export function useNames(type: NamesType, search = ''): NamesResult {
  const bulk = isBulkNameType(type);
  const query = search.trim();

  // The bulk query is keyed only by type: typing must never refetch 79,835 rows.
  // `staleTime: Infinity` keeps it for the whole session; a sync invalidates the
  // `['names']` prefix explicitly (decision D8).
  const bulkQuery = useQuery({
    queryKey: namesQueryKey(type),
    queryFn: () => getNames(type),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: bulk,
  });

  // `strings`: server-side `?q=`/`?limit=` only (decision D39 item 4).
  const streamQuery = useQuery({
    queryKey: namesQueryKey(type, { q: query, limit: STRING_SEARCH_LIMIT }),
    queryFn: () => getNames(type, { q: query, limit: STRING_SEARCH_LIMIT }),
    staleTime: Infinity,
    enabled: !bulk && query.length >= STRING_MIN_QUERY_LENGTH,
  });

  const active = bulk ? bulkQuery : streamQuery;
  const rows = active.data as NameRow[] | undefined;

  const allOptions = useMemo(
    () => (rows === undefined ? [] : toNameOptions(type, rows)),
    [rows, type],
  );

  const byId = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of allOptions) {
      map.set(option.id, option.label);
    }
    return map;
  }, [allOptions]);

  return useMemo<NamesResult>(() => {
    if (!bulk) {
      // The server already applied `q` and `limit`; what came back is what matched.
      const truncated = rows !== undefined && rows.length === STRING_SEARCH_LIMIT;
      return {
        options: allOptions,
        total: allOptions.length,
        truncated,
        hint: truncated ? `showing the first ${STRING_SEARCH_LIMIT} matches — keep typing` : null,
        isLoading: active.isLoading,
        error: (active.error as Error | null) ?? null,
        isBulk: false,
        needsQuery: query.length < STRING_MIN_QUERY_LENGTH,
        labelFromList: (id: string) => byId.get(id),
      };
    }

    const filtered = filterNameOptions(allOptions, query, MAX_NAME_OPTIONS);
    return {
      options: filtered.items,
      total: filtered.total,
      truncated: filtered.truncated,
      hint: truncationHint(filtered),
      isLoading: active.isLoading,
      error: (active.error as Error | null) ?? null,
      isBulk: true,
      needsQuery: false,
      labelFromList: (id: string) => byId.get(id),
    };
  }, [active.error, active.isLoading, allOptions, bulk, byId, query, rows]);
}

/**
 * The id of the row a `FriendlyNameDropdown` value refers to, as a string —
 * `''` for "nothing selected".
 */
export function selectedId(value: string | number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}
