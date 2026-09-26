import { useQuery } from '@tanstack/react-query';

import { STATUS_META } from '../StatusBadge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Skeleton } from '../ui/skeleton';
import { getStatusHistory, statusHistoryQueryKey, type StatusHistoryEntry } from '../../lib/api';
import { relativeTime } from '../../lib/display';
import {
  EMPTY_HISTORY_HINT,
  EMPTY_HISTORY_MESSAGE,
  hasHistoryNotes,
  historyActionText,
  historyErrorMessage,
  historyPanelState,
  newestFirst,
} from '../../lib/status-transition';
import { cn } from '../../lib/utils';

/**
 * The status-history timeline on the quest detail page (plan §2.8, story p2-09;
 * spec-ui-design.md L160-180).
 *
 * One `GET /api/status/quests/:key/history` (oldest → newest, D37) rendered
 * **newest first**, following the spec's entry anatomy exactly: a coloured dot in
 * the new status's own colour, the object key in monospace, the action text
 * (`marked verified`, or the bare status word for the row that first tracked the
 * entry), the relative timestamp, the notes in italic `text-zinc-400` below when
 * present, and `changed_by`.
 *
 * Four states the spec does not draw but this data really has (D51(f)):
 *
 * - **loading** — the skeleton every other read on this page uses;
 * - **untracked** — the endpoint's 404 for an entry with no `entry_status` row; it
 *   says so and how the history starts;
 * - **empty** — an entry that *is* tracked but has never changed status. That is the
 *   normal state for the whole first-startup import: it inserts `entry_status` rows
 *   and no `status_history` rows (D37), so this state is the common case, not an
 *   edge case.
 * - **error** — anything else, with a retry.
 *
 * `retry: false`: a 404 is a fact about the data, not a transient failure.
 *
 * The six read-only tabs and the JSON side panel are untouched — this panel is a
 * section of the page, not a seventh tab.
 */
export interface StatusHistoryPanelProps {
  questName: string;
  className?: string;
}

export default function StatusHistoryPanel({
  questName,
  className,
}: StatusHistoryPanelProps): JSX.Element {
  const history = useQuery({
    queryKey: statusHistoryQueryKey('quests', questName),
    queryFn: () => getStatusHistory('quests', questName),
    retry: false,
  });

  const state = historyPanelState(history);

  return (
    <Card className={className}>
      <CardHeader>
        {/*
          `CardTitle` is a styled `<div>` (its one vendored shape across the app), so
          this section attaches the heading semantics at the call site: the panel is a
          page section and a screen reader should be able to jump to it.
        */}
        <CardTitle role="heading" aria-level={2}>
          Status History
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {state === 'loading' ? (
          <div aria-busy="true" className="flex flex-col gap-3">
            <span className="sr-only">Loading status history…</span>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        ) : state === 'untracked' ? (
          <p className="text-sm text-zinc-400">{historyErrorMessage(history.error)}</p>
        ) : state === 'error' ? (
          <div className="flex flex-col items-start gap-2">
            <p role="alert" className="text-sm text-red-400">
              {historyErrorMessage(history.error)}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void history.refetch();
              }}
            >
              Try again
            </Button>
          </div>
        ) : state === 'empty' ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-zinc-200">{EMPTY_HISTORY_MESSAGE}</p>
            <p className="text-sm text-zinc-500">{EMPTY_HISTORY_HINT}</p>
          </div>
        ) : (
          <Timeline questName={questName} entries={newestFirst(history.data ?? [])} />
        )}
      </CardContent>
    </Card>
  );
}

/** The timeline itself: one `<li>` per entry, newest first. */
function Timeline({
  questName,
  entries,
}: {
  questName: string;
  entries: readonly StatusHistoryEntry[];
}): JSX.Element {
  return (
    <ol className="flex flex-col gap-5" aria-label="Status history">
      {entries.map((entry, index) => (
        <li key={index} className="flex gap-3">
          {/* The dot carries the *new* status's colour (spec L21-24, L177). */}
          <span
            className={cn(
              'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full',
              STATUS_META[entry.new_status].dotClass,
            )}
            aria-hidden="true"
          />
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              {/*
                Plain inline text with a real space — not flex+gap — so the rendered
                text content is the spec's own line (`DS-ACAD1-C01-001 marked
                verified`): a screen reader or a copy-paste gets the space, and the
                timeline's words are assertable as one string.
              */}
              <p className="text-sm text-zinc-200">
                <span className="font-mono text-zinc-100">{questName}</span>{' '}
                <span>{historyActionText(entry)}</span>
              </p>
              <span className="shrink-0 text-xs text-zinc-500">
                {relativeTime(entry.changed_at)}
              </span>
            </div>
            {entry.changed_by === null || entry.changed_by === '' ? null : (
              <p className="text-xs text-zinc-500">by {entry.changed_by}</p>
            )}
            {hasHistoryNotes(entry) ? (
              <p className="text-sm italic text-zinc-400">{entry.notes}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
