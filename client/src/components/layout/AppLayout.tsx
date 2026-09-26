import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';

import { getImportReport, IMPORT_REPORT_QUERY_KEY } from '../../lib/api';
import { notifySuccess } from '../../lib/notify';
import { importSummaryMessage } from '../../lib/toast';
import Header from './Header';
import Sidebar from './Sidebar';

/**
 * The application shell (docs/spec-ui-design.md L45-109): a fixed 260px sidebar,
 * a 56px sticky header and a `p-6` content column, with every route rendering
 * through `<Outlet />`.
 *
 * The one-time "Imported N existing entries from SpiralDB" toast (decision D37) is
 * also owned here: the server reports the current process's first-startup import,
 * and a module-level flag keeps StrictMode's double-mount from showing it twice.
 */
let importToastShown = false;

export default function AppLayout(): JSX.Element {
  const [mobileOpen, setMobileOpen] = useState(false);
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

  return (
    <div className="min-h-screen bg-zinc-950">
      <Sidebar mobileOpen={mobileOpen} onMobileOpenChange={setMobileOpen} />
      <div className="md:pl-[260px]">
        <Header onOpenNav={() => setMobileOpen(true)} />
        <main className="p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
