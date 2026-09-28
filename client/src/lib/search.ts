import type { SearchResponse, SearchResultRow } from './api';
import { activityHref } from './dashboard';
import { serverMessage } from './extract';

/**
 * The ⌘K palette's pure half (plan task 5.2, story p5-02).
 *
 * Everything the palette *decides* lives here in plain functions: what the trigger and the
 * input are called, the row's identity and its detail route, the five state names and the
 * ladder between them, and the three sentences the empty / truncated / unlinked arms print.
 * The React half (`components/layout/SearchPalette.tsx`) moves state and pixels only, so
 * every rule below is asserted in plain node (D10).
 *
 * ## The click-through is NOT re-implemented here
 *
 * `searchResultHref` **calls `activityHref`** — the D4 mapping (`objectDetailPath` for the
 * seven generic families, `/quests/:name` for the one route outside that table) that the
 * dashboard feed already uses. The mapping itself stays in `lib/dashboard.ts` and
 * `lib/objects.ts`: this function only gives the palette a name for the call, and deleting
 * `activityHref` breaks the feed and the palette together. There is deliberately no second
 * table of `object_type → route` anywhere in the client (D51/D76's one-shared-unit rule),
 * which is also why a friendly-name hit on an item/spell/NPC row resolves to `null`: the
 * endpoint sends `object_type: null` for those rows, `activityHref` answers `null` for a
 * null type, and the palette prints "— not linked" instead of opening a route that does not
 * exist.
 */

/* ------------------------------------------------------------------- copy */

/** The trigger's accessible name (the visible text is decorative, so the name cannot drift). */
export const SEARCH_TRIGGER_LABEL = 'Search all objects';

/** The dialog's title — visually hidden, and the name assistive tech announces. */
export const SEARCH_TITLE = 'Search all objects';

/** The dialog's description, which Radix requires alongside a title. */
export const SEARCH_DESCRIPTION =
  'Type to search every object key and the friendly name tables. Results are grouped by type.';

/** The input's accessible name. */
export const SEARCH_INPUT_LABEL = 'Search query';

/** The input's placeholder — the types a user can expect, not a claim about the ranking. */
export const SEARCH_PLACEHOLDER = 'Search quests, drop tables, items…';

/** Shown while the endpoint is answering (locally measured at ~10–25 ms, so it rarely shows). */
export const SEARCH_LOADING_MESSAGE = 'Searching…';

/** Shown when the palette is open with nothing typed: the endpoint is not called at all. */
export const SEARCH_IDLE_MESSAGE = 'Type a name or a key to search every object type.';

/**
 * The suffix a row with no detail route carries.
 *
 * Verbatim the dashboard feed's own words for the same situation (`ActivityFeed.tsx`'s
 * "— not linked"), because it is the same fact: this row names something the app has no
 * page for.
 */
export const SEARCH_NOT_LINKED_SUFFIX = '— not linked';

/** The keyboard hint the trigger shows, verbatim from the plan's "⌘K/Ctrl+K". */
export const SEARCH_SHORTCUT_HINT = '⌘K';

/* ------------------------------------------------------------------ the row */

/**
 * A row's identity within the response — the React key and cmdk's item `value`.
 *
 * The group prefix is load-bearing: an `items` row and a `spells` row can carry the same
 * friendly name *and* the same numeric id, so neither the name nor the id alone is unique
 * across the response. An object row is identified by its type + key (unique by D4's
 * `UNIQUE(object_type, object_key)`), and a routeless row by its group + friendly id, with
 * the name as a last resort for a row the server sent without one.
 */
export function searchResultKey(groupType: string, row: SearchResultRow): string {
  if (row.object_type !== null && row.object_key !== null) {
    return `object:${row.object_type}:${row.object_key}`;
  }
  return `name:${groupType}:${row.source_id ?? row.label}`;
}

/**
 * The detail route of one search row, or `null` when there is no page to open.
 *
 * A direct call to `activityHref` — see the module doc-comment: this is not a second
 * mapping. `null` is the honest answer for the endpoint's `object_type: null` rows (every
 * items/spells/npcs name hit), not a missing case.
 */
export function searchResultHref(
  row: Pick<SearchResultRow, 'object_type' | 'object_key'>,
): string | null {
  return activityHref(row);
}

/**
 * The secondary text a row shows beside its label: the friendlier title when the endpoint
 * sent one, else nothing.
 *
 * `null` rather than the label itself, so a routeless name row (whose label *is* its name)
 * does not print the same string twice.
 */
export function searchResultSecondary(row: SearchResultRow): string | null {
  return row.name !== null && row.name !== row.label ? row.name : null;
}

/* ------------------------------------------------------------------ the state */

/** Which of the palette's five states to render. */
export type SearchPaletteState = 'idle' | 'loading' | 'error' | 'empty' | 'ready';

/**
 * The palette's state, from the query text and the request's flags.
 *
 * Declared as one ladder so the order is asserted rather than re-derived in JSX:
 *
 * 1. **idle** — nothing typed. The endpoint is not called (`enabled` is false), so an open
 *    palette must not show a spinner for work nobody asked for, and must not show "no
 *    results" for a query that was never made;
 * 2. **loading** — a request is in flight;
 * 3. **error** — a failure, or a read that produced no data at all. **Checked before
 *    empty** for the reason `lib/dashboard.ts`'s feed ladder records: an errored query has
 *    `data === undefined`, so an empty-first ladder would render the friendly no-results
 *    sentence over a broken request — the criterion's own failure mode;
 * 4. **empty** — a *successful* read that matched nothing;
 * 5. **ready** — at least one group.
 */
export function searchPaletteState(query: {
  q: string;
  isPending: boolean;
  isError: boolean;
  data: SearchResponse | undefined;
}): SearchPaletteState {
  if (query.q === '') {
    return 'idle';
  }
  if (query.isPending) {
    return 'loading';
  }
  if (query.isError || query.data === undefined) {
    return 'error';
  }
  return query.data.groups.length === 0 ? 'empty' : 'ready';
}

/* ------------------------------------------------------------- the sentences */

/** The no-results line, naming what was searched for. */
export function searchEmptyMessage(q: string): string {
  return `No results for “${q}”. Try a shorter substring of a name or a key.`;
}

/**
 * The one-line notice for rows the palette cannot open.
 *
 * Singular and plural are both written out — "1 results" would be its own defect — and the
 * count comes from the endpoint's `unresolved`, the same field, and the same sentence shape,
 * the dashboard feed's `unresolvedActivityMessage` uses.
 */
export function unresolvedSearchMessage(count: number): string {
  if (count === 1) {
    return '1 result has no page to open — it is a friendly name in a table without a detail view, so it is shown without a link.';
  }
  return `${String(count)} results have no page to open — they are friendly names in tables without a detail view, so they are shown without links.`;
}

/**
 * The line that says the cap was reached.
 *
 * `limit` is per group, so the honest sentence names that: a broad query shows the first N
 * of *each* type, not the first N overall.
 */
export function truncatedSearchMessage(limit: number): string {
  return `Showing the first ${String(limit)} matches of each type.`;
}

/** The failure line, preferring the server's own message. */
export function searchErrorMessage(error: unknown): string {
  return serverMessage(error, 'Could not search.');
}

/* ------------------------------------------------------------- the shortcut */

/** The event fields the shortcut rule reads — so the rule is testable without a DOM. */
export interface SearchShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * `true` for the palette's keyboard shortcut: **⌘K or Ctrl+K** (the plan's own words), and
 * nothing else.
 *
 * `altKey`/`shiftKey` are excluded because they make the combination a *different* shortcut
 * on both platforms (⌘⇧K and Ctrl+Shift+K belong to the browser), and hijacking those would
 * take a key away from the user. The key comparison is case-folded because a keyboard layout
 * may report `K`.
 */
export function isSearchShortcut(event: SearchShortcutEvent): boolean {
  return (
    event.key.toLowerCase() === 'k' &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}
