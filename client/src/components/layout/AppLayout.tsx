import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';

import { getImportReport, IMPORT_REPORT_QUERY_KEY } from '../../lib/api';
import { notifySuccess } from '../../lib/notify';
import { isSearchShortcut } from '../../lib/search';
import { importSummaryMessage } from '../../lib/toast';
import { useConnection } from '../../hooks/useConnection';
import Header from './Header';
import OfflineBanner from './OfflineBanner';
import SearchPalette from './SearchPalette';
import Sidebar from './Sidebar';

/**
 * The application shell (docs/spec-ui-design.md L45-109): a fixed sidebar — **200px on tablet
 * (768–1279px), 260px on desktop (≥1280px)**, per L516-522 — a 56px sticky header and a `p-6`
 * content column, with every route rendering through `<Outlet />`.
 *
 * The one-time "Imported N existing entries from SpiralDB" toast (decision D37) is
 * also owned here: the server reports the current process's first-startup import,
 * and a module-level flag keeps StrictMode's double-mount from showing it twice.
 *
 * Story p5-02's **global search palette** is mounted here too, and for the same structural
 * reason: this component wraps every route, so the palette is reachable from all of them
 * without any page knowing it exists. Its open state and the ⌘K/Ctrl+K listener live here
 * because two places need them (the header's trigger and the palette itself); the shortcut
 * rule is `lib/search.ts`'s pure `isSearchShortcut`, and `preventDefault` is what stops the
 * browser's own Ctrl+K (search-in-page) from fighting the palette.
 *
 * Story p5-04's **offline banner** is the third thing that belongs to the shell rather than to
 * a page: the failures it reacts to happen in every page (they are reported by `lib/api.ts`),
 * while the banner sits at the top of every page, so `useConnection()` is called once here.
 * Nothing below it knows the feature exists.
 */
let importToastShown = false;

export default function AppLayout(): JSX.Element {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  // The one call site of the offline detector (story p5-04): a request failure reported by
  // `lib/api.ts` from anywhere in the app becomes the banner at the top of the shell, and a
  // recovery invalidates every query so the stale page refreshes itself.
  const { offline } = useConnection();
  const importReport = useQuery({
    queryKey: IMPORT_REPORT_QUERY_KEY,
    queryFn: getImportReport,
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    const report = importReport.data;
    if (importToastShown || report === undefined || !report.ran || report.imported <= 0) {
      return;
    }
    importToastShown = true;
    notifySuccess(importSummaryMessage(report.imported));
  }, [importReport.data]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isSearchShortcut(event)) {
        return;
      }
      event.preventDefault();
      setSearchOpen((open) => !open);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950">
      <Sidebar mobileOpen={mobileOpen} onMobileOpenChange={setMobileOpen} />
      {/* The rail's own width has to be mirrored here as padding: 200px on tablet, 260px on
          desktop (spec L516-522; story p5-06 added the tablet tier — `md:pl-[260px]` alone put
          the content column 60px too far right at every width from 768 to 1279). */}
      <div className="md:pl-[200px] xl:pl-[260px]">
        {/* Above the header: the spec's "persistent banner at top" (L535), rendered only while
            the health probe says the API is unreachable. */}
        <OfflineBanner offline={offline} />
        <Header onOpenNav={() => setMobileOpen(true)} onOpenSearch={() => setSearchOpen(true)} />
        <main className="p-6">
          <Outlet />
        </main>
      </div>
      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
