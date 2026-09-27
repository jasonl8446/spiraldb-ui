import { useQuery } from '@tanstack/react-query';

import ActivityFeed from '../components/dashboard/ActivityFeed';
import StatCards from '../components/dashboard/StatCards';
import TypeProgressSection from '../components/dashboard/TypeProgressSection';
import { Button } from '../components/ui/button';
import { Skeleton } from '../components/ui/skeleton';
import { DASHBOARD_QUERY_KEY, getDashboard } from '../lib/api';
import {
  dashboardCards,
  dashboardErrorMessage,
  DASHBOARD_LOADING_MESSAGE,
  typeProgressRows,
} from '../lib/dashboard';

/**
 * The Dashboard — the `/` route (plan task 5.1, story p5-01;
 * docs/spec-ui-design.md L127-180).
 *
 * Three sections stacked vertically, exactly as the spec draws them: the four stat
 * cards, "Verification Progress by Type", and "Recent Activity". The page owns the
 * aggregate read (`GET /api/dashboard`, built in Phase 1/task 1.6) and nothing else —
 * the four cards and the eight per-type rows both come from that **one** response, so
 * the cards can never disagree with the bars, and the feed is its own component with
 * its own `GET /api/activity` read.
 *
 * **This replaces the `/` route's "Arrives in Phase 5" stub** — the phase transition
 * p4-02…p4-10 recorded, so `phase: 5` in `lib/routes.ts` still means the phase that
 * *owns* the page, and `tests/ui/shell.spec.ts`'s `/` branch asserts this page's own
 * literals (with both endpoints mocked, per D81).
 *
 * Every derived number lives in `lib/dashboard.ts`: the four card definitions and
 * their one-decimal percentages, the eight rows (Quests first, then the seven generic
 * families, GlobalRegistry excluded by Q1), and the feed's state ladder. This file is
 * the loading/error shell around them — a `role="alert"` with a retry, never a silent
 * blank page, and never the feed's empty state standing in for a failed request.
 */
export default function DashboardPage(): JSX.Element {
  const dashboard = useQuery({ queryKey: DASHBOARD_QUERY_KEY, queryFn: getDashboard });

  if (dashboard.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-6">
        <span className="sr-only">{DASHBOARD_LOADING_MESSAGE}</span>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-32 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (dashboard.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-red-400">
          {dashboardErrorMessage(dashboard.error)}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void dashboard.refetch();
          }}
        >
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <StatCards cards={dashboardCards(dashboard.data.overall)} />
      <TypeProgressSection rows={typeProgressRows(dashboard.data)} />
      <ActivityFeed />
    </div>
  );
}
