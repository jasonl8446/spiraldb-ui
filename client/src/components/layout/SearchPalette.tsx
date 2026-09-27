import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  searchObjects,
  searchQueryKey,
  SEARCH_DEFAULT_LIMIT,
  type SearchResultRow,
} from '../../lib/api';
import {
  searchEmptyMessage,
  searchErrorMessage,
  searchPaletteState,
  searchResultHref,
  searchResultKey,
  searchResultSecondary,
  SEARCH_DESCRIPTION,
  SEARCH_IDLE_MESSAGE,
  SEARCH_INPUT_LABEL,
  SEARCH_LOADING_MESSAGE,
  SEARCH_NOT_LINKED_SUFFIX,
  SEARCH_PLACEHOLDER,
  SEARCH_TITLE,
  truncatedSearchMessage,
  unresolvedSearchMessage,
} from '../../lib/search';
import { StatusDot } from '../objects/ObjectTable';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';

/**
 * The ⌘K / Ctrl+K global search palette (plan task 5.2, story p5-02 deliverable D2).
 *
 * One `GET /api/search?q=&limit=20` read, grouped by type, over the vendored
 * `ui/command.tsx` primitive — `cmdk@1.1.1` was already a dependency (D39 vendored the
 * wrapper), so this story adds no dependency and `CommandDialog` stays unvendored (it is
 * composed here from the same `ui/dialog.tsx` Radix shell the mobile navigation overlay
 * uses, which is what brings the focus trap, Escape-to-close and the scroll lock).
 *
 * ## The rules this component does NOT own
 *
 * Every decision lives in `lib/search.ts` and is asserted there in plain node (D10): the
 * accessible-name vocabulary, the row's identity, its detail route (**`activityHref`, the
 * D4 mapping — not a second one**), the five-state ladder, and the three notice sentences.
 * This file moves state and pixels: it opens, it types, it renders the state the ladder
 * names, and it navigates to the href the pure function returned.
 *
 * ## The states, and why the loading one is honest
 *
 * `idle` (nothing typed; **the endpoint is not called**, so an open palette scans nothing),
 * `loading`, `error`, `empty`, `ready`. The error arm is reached before the empty one — an
 * errored query has no data, and a no-results sentence printed over a failed request is the
 * one lie this palette must not tell. `lib/search.ts` owns that ladder.
 *
 * ## Non-navigable rows
 *
 * A friendly-name hit on an item, a spell or an NPC has **no detail route** — there is no
 * `/items/:gid` page and this palette will not invent one. Such a row is rendered from the
 * endpoint's own `object_type: null` with no dot, the "— not linked" suffix, and a select
 * handler that does nothing (the row stays reachable for keyboard users and for screen
 * readers rather than being `disabled`, which would remove it from the tab order of the
 * list). The count is printed above the results, exactly as the dashboard feed prints its
 * own `unresolved` count.
 *
 * ## Accessible-name vocabulary (the tier-1 spec addresses it)
 *
 * dialog `Search all objects` (Radix `role="dialog"`, title + description both visually
 * hidden) · input `role="combobox"` named `Search query` (cmdk's own `<label>`, which is why
 * no `aria-label` is set on the input — `aria-labelledby` would win anyway) · list
 * `role="listbox"` named `Search results` · each group `role="group"` headed by the
 * endpoint's `label` (`Quests`, `Drop Tables`, `Items`, …) · each result `role="option"`
 * whose text is `<label> <name?> <status label?> [— not linked]`, with `StatusDot`'s
 * sr-only "Status: Reviewed" supplying the status word · `[data-search-group]`,
 * `[data-search-result]`, `[data-search-unresolved]`, `[data-search-truncated]`,
 * `[data-search-empty]`, `[data-search-loading]`, `[data-search-idle]`, `[data-search-error]`.
 *
 * The dots are `StatusDot` — the very component the list pages and the dashboard feed use —
 * so a search row's dot cannot drift from a list row's.
 */
export interface SearchPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SearchPalette({ open, onOpenChange }: SearchPaletteProps): JSX.Element {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const trimmed = query.trim();

  const search = useQuery({
    queryKey: searchQueryKey(trimmed, SEARCH_DEFAULT_LIMIT),
    queryFn: () => searchObjects(trimmed, SEARCH_DEFAULT_LIMIT),
    // The just-opened palette asks nothing: a blank or absent `q` is answered by the server
    // without touching the database, but the client does not even send it.
    enabled: open && trimmed !== '',
  });

  const state = searchPaletteState({
    q: trimmed,
    isPending: search.isPending,
    isError: search.isError,
    data: search.data,
  });

  const groups = search.data?.groups ?? [];
  const unresolved = search.data?.unresolved ?? 0;
  const truncated = search.data?.truncated ?? false;
  const limit = search.data?.limit ?? SEARCH_DEFAULT_LIMIT;

  /** Closing forgets the query, so reopening never shows a stale result set. */
  const handleOpenChange = (next: boolean): void => {
    if (!next) {
      setQuery('');
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="h-[26rem] max-w-2xl gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">{SEARCH_TITLE}</DialogTitle>
        <DialogDescription className="sr-only">{SEARCH_DESCRIPTION}</DialogDescription>
        <Command label={SEARCH_INPUT_LABEL} shouldFilter={false} className="rounded-lg">
          <CommandInput value={query} onValueChange={setQuery} placeholder={SEARCH_PLACEHOLDER} />

          {state === 'ready' && (unresolved > 0 || truncated) ? (
            <div className="border-b border-zinc-800 px-3 py-2 text-xs text-amber-400">
              {unresolved > 0 ? (
                <p data-search-unresolved={unresolved}>{unresolvedSearchMessage(unresolved)}</p>
              ) : null}
              {truncated ? (
                <p data-search-truncated={limit}>{truncatedSearchMessage(limit)}</p>
              ) : null}
            </div>
          ) : null}

          {/*
            `label`, not `aria-label`: cmdk's List destructures `label = "Suggestions"` and sets
            `aria-label` from it *after* spreading the caller's props, so an `aria-label` here is
            silently overridden. Measured in the browser (the list's accessible name came back as
            "Suggestions"), and pinned by the tier-1 spec for that reason.
          */}
          <CommandList label="Search results" className="max-h-none flex-1">
            {state === 'idle' ? (
              <p data-search-idle="" className="px-3 py-6 text-center text-sm text-zinc-400">
                {SEARCH_IDLE_MESSAGE}
              </p>
            ) : null}

            {state === 'loading' ? (
              <p
                data-search-loading=""
                role="status"
                className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-zinc-400"
              >
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {SEARCH_LOADING_MESSAGE}
              </p>
            ) : null}

            {state === 'error' ? (
              <p
                data-search-error=""
                role="alert"
                className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-red-400"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {searchErrorMessage(search.error)}
              </p>
            ) : null}

            {state === 'empty' ? (
              <CommandEmpty data-search-empty="">{searchEmptyMessage(trimmed)}</CommandEmpty>
            ) : null}

            {state === 'ready'
              ? groups.map((group) => (
                  <CommandGroup
                    key={group.type}
                    data-search-group={group.type}
                    heading={group.label}
                  >
                    {group.results.map((row) => (
                      <SearchResultItem
                        key={searchResultKey(group.type, row)}
                        groupType={group.type}
                        row={row}
                        onActivate={(href) => {
                          handleOpenChange(false);
                          void navigate(href);
                        }}
                      />
                    ))}
                  </CommandGroup>
                ))
              : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/** One `role="option"` row: dot, key or name, the friendly title, and the no-route suffix. */
function SearchResultItem({
  groupType,
  row,
  onActivate,
}: {
  groupType: string;
  row: SearchResultRow;
  onActivate: (href: string) => void;
}): JSX.Element {
  const href = searchResultHref(row);
  const secondary = searchResultSecondary(row);
  const value = searchResultKey(groupType, row);

  return (
    <CommandItem
      value={value}
      data-search-result={value}
      // A row with no route is still selectable — it must stay reachable on the keyboard —
      // but activating it does nothing, because there is no page to open.
      onSelect={() => {
        if (href !== null) {
          onActivate(href);
        }
      }}
      className="items-center gap-2"
    >
      {row.status === null ? (
        // Reserved gutter, so a dotless row's text aligns with a dotted row's.
        <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0" />
      ) : (
        <StatusDot status={row.status} />
      )}
      <span className="truncate font-mono text-sm text-zinc-100">{row.label}</span>
      {secondary === null ? null : (
        <span className="truncate text-xs text-zinc-400">{secondary}</span>
      )}
      {href === null ? (
        <span className="ml-auto shrink-0 text-xs text-zinc-500">{SEARCH_NOT_LINKED_SUFFIX}</span>
      ) : null}
    </CommandItem>
  );
}
