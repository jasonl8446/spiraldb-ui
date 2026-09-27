import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, Menu, RefreshCw, Search } from 'lucide-react';
import { useLocation } from 'react-router-dom';

import { getSettings, SETTINGS_QUERY_KEY } from '../../lib/api';
import { pageTitleForPath } from '../../lib/routes';
import { SEARCH_SHORTCUT_HINT, SEARCH_TRIGGER_LABEL } from '../../lib/search';
import { useSync } from '../../hooks/useSync';
import { Button } from '../ui/button';

/**
 * Sticky header (docs/spec-ui-design.md L99-109): 56px tall, `zinc-900` on a
 * `zinc-800` bottom border, showing the current route's page title on the left
 * and the Search trigger + Sync button + user avatar on the right.
 *
 * - the **Search button** is story p5-02's ⌘K palette trigger (plan task 5.2). Its
 *   accessible name is `Search all objects`; the visible "Search" word and the `⌘K`
 *   hint are `aria-hidden`, so the name cannot drift into "Search ⌘K" and the visible
 *   label still satisfies WCAG 2.5.3 (the name contains the visible text). The button
 *   lives in the header because the header is on every route, which is what "reachable
 *   from every route" means here — the palette itself is mounted by `AppLayout`;
 * - the Sync button is the shared `useSync()` controller: spinner while the
 *   blocking `POST /api/sync` runs, checkmark for a moment on success, and a live
 *   region so the state is announced and not only shown as an icon (spec L545);
 * - the user name comes from `settings` through the same query the identity gate
 *   (task 1.7) keeps warm, so a name just entered in the gate appears here without
 *   a refetch;
 * - the hamburger only exists below `md`, where the sidebar is an overlay.
 */
export interface HeaderProps {
  /** Opens the mobile navigation overlay. */
  onOpenNav: () => void;
  /** Opens the global search palette (story p5-02). */
  onOpenSearch: () => void;
}

export default function Header({ onOpenNav, onOpenSearch }: HeaderProps): JSX.Element {
  const { pathname } = useLocation();
  const title = pageTitleForPath(pathname);
  const { sync, isPending, justSucceeded } = useSync();
  const settings = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: getSettings,
    staleTime: Infinity,
  });

  const userName = settings.data?.user_name ?? '';
  const initial = userName.trim() === '' ? '?' : userName.trim().charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-4">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Open navigation"
        className="md:hidden"
        onClick={onOpenNav}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </Button>

      {/*
        The page title is the document's **one** `h1` (p5-05, from the lead's AC#9 axe run:
        `page-has-heading-one` fired as a moderate finding on Dashboard, Quest list and
        DropTable detail because every page's heading lived in a section `h2` and nothing was
        an `h1`). Promoting this one element fixes every route at once and cannot fight the
        sections' `h2`s — it *is* the level above them. The quest detail page's two headings
        were demoted to `h2` in the same change, so that route keeps exactly one `h1` too.
      */}
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-zinc-50">{title}</h1>

      <span role="status" aria-live="polite" className="sr-only">
        {isPending
          ? 'Friendly name sync in progress'
          : justSucceeded
            ? 'Friendly name sync complete'
            : ''}
      </span>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onOpenSearch}
        aria-label={SEARCH_TRIGGER_LABEL}
        className="text-zinc-400"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span aria-hidden="true" className="hidden sm:inline">
          Search
        </span>
        <kbd
          aria-hidden="true"
          className="hidden rounded border border-zinc-700 px-1 font-sans text-[10px] leading-4 text-zinc-400 lg:inline"
        >
          {SEARCH_SHORTCUT_HINT}
        </kbd>
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={sync}
        disabled={isPending}
        aria-label="Sync friendly names"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : justSucceeded ? (
          <Check className="h-4 w-4 text-emerald-400" aria-hidden="true" />
        ) : (
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        )}
        <span className="hidden sm:inline">{isPending ? 'Syncing…' : 'Sync'}</span>
      </Button>

      <div className="flex items-center gap-2" aria-label="Current user">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-zinc-50"
        >
          {initial}
        </span>
        <span className="hidden max-w-[10rem] truncate text-sm text-zinc-300 sm:inline">
          {userName.trim() === '' ? 'No name set' : userName}
        </span>
      </div>
    </header>
  );
}
