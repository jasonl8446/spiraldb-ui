import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';

import { getImportReport, IMPORT_REPORT_QUERY_KEY } from '../../lib/api';
import { notifySuccess } from '../../lib/notify';
import { isSearchShortcut } from '../../lib/search';
import { importSummaryMessage } from '../../lib/toast';
import Header from './Header';
import SearchPalette from './SearchPalette';
import Sidebar from './Sidebar';

/**
 * The application shell (docs/spec-ui-design.md L45-109): a fixed 260px sidebar,
 * a 56px sticky header and a `p-6` content column, with every route rendering
 * through `<Outlet />`.
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
 */
let importToastShown = false;

export default function AppLayout(): JSX.Element {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
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
      <div className="md:pl-[260px]">
        <Header onOpenNav={() => setMobileOpen(true)} onOpenSearch={() => setSearchOpen(true)} />
        <main className="p-6">
          <Outlet />
        </main>
      </div>
      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}
