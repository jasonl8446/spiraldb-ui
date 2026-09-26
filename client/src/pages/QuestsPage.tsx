import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import QuestBrowseTable from '../components/quest/QuestBrowseTable';
import QuestCardList from '../components/quest/QuestCardList';
import StatusNotesDialog from '../components/quest/StatusNotesDialog';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { useIsMobile } from '../hooks/useIsMobile';
import { useStatusTransition } from '../hooks/useStatusTransition';
import { listQuests, QUESTS_QUERY_KEY, type QuestListRow } from '../lib/api';
import { serverMessage } from '../lib/extract';
import {
  DEFAULT_QUEST_SORT,
  deriveQuests,
  EMPTY_STATE_HINT,
  emptyStateMessage,
  paginateQuests,
  paginationLabel,
  QUESTS_LOAD_ERROR,
  QUESTS_LOADING,
  QUESTS_SEARCH_LABEL,
  QUESTS_SEARCH_PLACEHOLDER,
  questFilterTabs,
  type QuestFilter,
  type QuestSort,
  type QuestSummary,
} from '../lib/quests';
import { cn } from '../lib/utils';

/** Stable empties, so the derivations' memos do not recompute every render. */
const NO_ROWS: readonly QuestListRow[] = [];
const NO_SUMMARY: QuestSummary = { total: 0, extracted: 0, reviewed: 0, verified: 0 };

/** The skeleton rows while the list loads. */
const SKELETON_ROWS = 8;

/**
 * Quest browse list — `/quests` (plan task 2.7, story p2-08;
 * docs/spec-ui-design.md L238-271).
 *
 * One `GET /api/quests` per page (D12: the endpoint rescans the corpus per
 * request), and **everything else is client-side** — the filter tabs, the search
 * box, the sorting and the pagination all run over that one payload, so typing a
 * search never issues a request (plan §2.7).
 *
 * The filter tabs' count badges come from the response's own `summary` (D49), so a
 * tab counts exactly what the table holds.
 *
 * Below `md` the table is replaced by the card list and the whole page — tabs,
 * search and pagination included — stays usable (spec L270).
 *
 * **The status menu (story p2-09).** Each row's Actions cell opens the real status
 * menu, and the page owns the one transition flow (`useStatusTransition`) so a
 * single notes dialog serves every row. The moved status is written optimistically
 * into this page's own `QUESTS_QUERY_KEY` payload, so the row's colour dot and the
 * filter tabs' count badges both move with it.
 */
export default function QuestsPage(): JSX.Element {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const transition = useStatusTransition('quests');

  const [filter, setFilter] = useState<QuestFilter>('All');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<QuestSort>(DEFAULT_QUEST_SORT);
  const [page, setPage] = useState(1);

  // A filter or a search changes the row set, so a page number from the previous
  // set would be meaningless. `paginateQuests` also clamps, so this is the
  // convenience half of the same guarantee.
  useEffect(() => {
    setPage(1);
  }, [filter, search]);

  const quests = useQuery({
    queryKey: QUESTS_QUERY_KEY,
    queryFn: listQuests,
    staleTime: Infinity,
  });

  const rows = quests.data?.quests ?? NO_ROWS;
  const tabs = questFilterTabs(quests.data?.summary ?? NO_SUMMARY);
  const derived = useMemo(
    () => deriveQuests(rows, { filter, query: search, sort }),
    [rows, filter, search, sort],
  );
  const current = paginateQuests(derived, page);

  function openQuest(row: QuestListRow): void {
    navigate(`/quests/${encodeURIComponent(row.quest_name)}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div
          role="tablist"
          aria-label="Filter quests by status"
          className="flex flex-wrap gap-1 border-b border-zinc-800"
        >
          {tabs.map((tab) => {
            const active = tab.filter === filter;
            return (
              <button
                key={tab.filter}
                type="button"
                role="tab"
                id={`quest-filter-${tab.filter}`}
                aria-selected={active}
                aria-controls="quests-results"
                onClick={() => setFilter(tab.filter)}
                className={cn(
                  '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  active
                    ? 'border-blue-500 text-white'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200',
                )}
              >
                {tab.filter}
                {/* Spec L245: the count badge is the tab's parenthetical count. */}
                <Badge variant={active ? 'default' : 'secondary'}>{tab.count}</Badge>
              </button>
            );
          })}
        </div>

        <div className="relative md:w-64">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={QUESTS_SEARCH_PLACEHOLDER}
            aria-label={QUESTS_SEARCH_LABEL}
            className="pl-9"
          />
        </div>
      </div>

      {quests.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">{QUESTS_LOADING}</span>
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : quests.isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden="true" />
            <p role="alert" className="text-sm text-zinc-200">
              {QUESTS_LOAD_ERROR}
            </p>
            <p className="text-sm text-zinc-500">
              {serverMessage(quests.error, QUESTS_LOAD_ERROR)}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                void quests.refetch();
              }}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div
          id="quests-results"
          role="tabpanel"
          aria-labelledby={`quest-filter-${filter}`}
          className="flex flex-col gap-3"
        >
          {current.items.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <p className="text-sm text-zinc-200">{emptyStateMessage(filter)}</p>
                <p className="text-sm text-zinc-500">{EMPTY_STATE_HINT}</p>
              </CardContent>
            </Card>
          ) : isMobile ? (
            <QuestCardList rows={current.items} className="flex flex-col gap-2" />
          ) : (
            <QuestBrowseTable
              rows={current.items}
              sort={sort}
              onSortChange={setSort}
              onRowActivate={openQuest}
              onTransition={(row, target) => transition.request(row.quest_name, target)}
              transitionPending={transition.isPending}
            />
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="text-xs text-zinc-400">{paginationLabel(current)}</span>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!current.hasPrevious}
                onClick={() => setPage(current.page - 1)}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!current.hasNext}
                onClick={() => setPage(current.page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* One dialog for every row's menu; the hook owns the PATCH and the optimistic dot. */}
      <StatusNotesDialog {...transition.dialog} />
    </div>
  );
}
