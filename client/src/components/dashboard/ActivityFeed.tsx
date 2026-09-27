import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

import { STATUS_META } from '../StatusBadge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import {
  ACTIVITY_DEFAULT_LIMIT,
  activityQueryKey,
  getActivity,
  type ActivityEntry,
} from '../../lib/api';
import {
  ACTIVITY_SECTION_TITLE,
  activityErrorMessage,
  activityFeedState,
  activityHref,
  activityRowLabel,
  EMPTY_ACTIVITY_CTA,
  EMPTY_ACTIVITY_CTA_PATH,
  EMPTY_ACTIVITY_MESSAGE,
  unresolvedActivityMessage,
} from '../../lib/dashboard';
import { relativeTime } from '../../lib/display';
import { hasHistoryNotes, historyActionText } from '../../lib/status-transition';
import { cn } from '../../lib/utils';
import { useApiErrorToast } from '../../hooks/useApiErrorToast';

/**
 * "Recent Activity" — the dashboard's timeline feed (docs/spec-ui-design.md
 * L162-179, plan task 5.1; endpoint decision D27, story p5-01 deliverable D2).
 *
 * Owns its own `GET /api/activity?limit=10` read, exactly as `StatusHistoryPanel`
 * owns its history read, and reuses that panel's anatomy verbatim: a coloured dot in
 * the **new** status's colour, the object key in monospace, the action text from
 * `historyActionText` (the same function the detail page's timeline uses, so "marked
 * verified" cannot be spelled two ways), the relative timestamp from `relativeTime`,
 * and the notes in italic `text-zinc-400`.
 *
 * Four states, and the ladder is `lib/dashboard.ts`'s (asserted in plain node):
 *
 * - **loading** — skeletons, the same shape the history panel shows;
 * - **error** — the server's own message with a retry, `role="alert"`;
 * - **empty** — the spec's shield/checkmark illustration, "No activity yet. Extract
 *   some quests to get started." and the "Extract Quests" button (L179). Reached
 *   **only from a successful read with zero rows**, never from a failure;
 * - **ready** — the timeline.
 *
 * **Unlinkable rows are shown, and said out loud.** A history row whose
 * `entry_status` parent is gone (or whose type is outside D4's eight) has no route to
 * open; the feed renders it with its key (or "Unknown object"), marks it `not linked`,
 * and — when the API reported any — prints the count above the list. Dropping it
 * silently would make the feed's "10 most recent" claim false, and linking it to a
 * guessed route would 404.
 *
 * Each entry's headline (key · action · time) is the click target, an ordinary
 * `<Link>` to the row's detail route built by `activityHref` — the D4 mapping through
 * the same `objectDetailPath` the list pages use, so a feed link and a list link are
 * the same string by construction.
 */
export default function ActivityFeed(): JSX.Element {
  const activity = useQuery({
    queryKey: activityQueryKey(ACTIVITY_DEFAULT_LIMIT),
    queryFn: () => getActivity(ACTIVITY_DEFAULT_LIMIT),
  });

  // The API-error toast with its retry action (AC3, spec L533) — the same wiring the dashboard
  // page uses, with the retry bound to this feed's own read.
  useApiErrorToast(activity, 'Could not load the recent activity.');

  const state = activityFeedState(activity);
  const entries = activity.data?.activity ?? [];
  const unresolved = activity.data?.unresolved ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {ACTIVITY_SECTION_TITLE}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {state === 'loading' ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <span className="sr-only">Loading recent activity…</span>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        ) : state === 'error' ? (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-sm text-red-400">
              {activityErrorMessage(activity.error)}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void activity.refetch();
              }}
            >
              Try again
            </Button>
          </div>
        ) : state === 'empty' ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <ShieldCheck className="h-12 w-12 text-emerald-400" aria-hidden="true" />
            <p className="max-w-md text-sm text-zinc-300">{EMPTY_ACTIVITY_MESSAGE}</p>
            <Button asChild>
              <Link to={EMPTY_ACTIVITY_CTA_PATH}>{EMPTY_ACTIVITY_CTA}</Link>
            </Button>
          </div>
        ) : (
          <>
            {unresolved > 0 ? (
              <p data-unresolved={unresolved} className="mb-4 text-xs text-amber-400">
                {unresolvedActivityMessage(unresolved)}
              </p>
            ) : null}
            <ol className="flex flex-col gap-5" aria-label={ACTIVITY_SECTION_TITLE}>
              {entries.map((entry) => (
                <ActivityRowItem key={entry.id} entry={entry} />
              ))}
            </ol>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** One timeline entry — the panel's anatomy plus the click-through. */
function ActivityRowItem({ entry }: { entry: ActivityEntry }): JSX.Element {
  const href = activityHref(entry);
  const label = activityRowLabel(entry);

  // The headline line, identical in both the linked and the unlinkable case: the key
  // is monospace, the action text is `historyActionText`'s, and a real space between
  // them (not flex gap) so the rendered text is the spec's own sentence.
  const headline = (
    <>
      <span className="text-sm text-zinc-200">
        <span className="font-mono text-zinc-100">{label}</span>{' '}
        <span>{historyActionText(entry)}</span>
        {href === null ? <span className="text-xs text-zinc-500"> — not linked</span> : null}
      </span>
      <time
        className="shrink-0 whitespace-nowrap text-xs text-zinc-500"
        dateTime={entry.changed_at ?? undefined}
      >
        {relativeTime(entry.changed_at)}
      </time>
    </>
  );

  return (
    <li data-activity-id={entry.id} className="flex gap-3">
      <span
        className={cn(
          'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full',
          STATUS_META[entry.new_status].dotClass,
        )}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {href === null ? (
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">{headline}</div>
        ) : (
          <Link
            to={href}
            className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            {headline}
          </Link>
        )}
        {entry.changed_by === null || entry.changed_by === '' ? null : (
          <p className="text-xs text-zinc-500">by {entry.changed_by}</p>
        )}
        {hasHistoryNotes(entry) ? (
          <p className="text-sm italic text-zinc-400">{entry.notes}</p>
        ) : null}
      </div>
    </li>
  );
}
