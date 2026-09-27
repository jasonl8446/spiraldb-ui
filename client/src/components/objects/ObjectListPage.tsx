import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import type { ObjectTypeConfig } from '@shared/objectTypes';

import { useIsMobile } from '../../hooks/useIsMobile';
import { relativeTime } from '../../lib/display';
import { serverMessage } from '../../lib/extract';
import {
  DEFAULT_OBJECT_SORT,
  OBJECT_EMPTY_STATE_HINT,
  objectEmptyStateMessage,
  objectFilterLabel,
  objectFilterTabs,
  objectLoadError,
  objectLoadingLabel,
  objectSearchLabel,
  objectSearchPlaceholder,
  paginateRows,
  paginationLabel,
  sortRows,
  filterByStatus,
  searchRows,
  type ObjectFilter,
  type ObjectSort,
  type ObjectStatusSummary,
} from '../../lib/object-list';
import {
  listObjects,
  objectDetailPath,
  objectListQueryKey,
  type ObjectListResponse,
  type ObjectListRow,
} from '../../lib/objects';
import { cn } from '../../lib/utils';
import NewObjectControl from './NewObjectControl';
import ObjectCardList from './ObjectCardList';
import ObjectTable, { type ObjectListColumn } from './ObjectTable';
import StatusBadge from '../StatusBadge';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { Input } from '../ui/input';
import { Skeleton } from '../ui/skeleton';

/**
 * `ObjectListPage` — the generic object browse page (task 4.1), generalised from the
 * quest browse (plan task 2.7 / story p2-08; docs/spec-ui-design.md L238-271):
 * status filter tabs with live count badges, client-side search, a TanStack table on
 * desktop and a card list below `md`, 50-row pagination, per-filter empty states —
 * and, for these eight families, the two corpus realities the acceptance criteria
 * name: a **missing directory** (`NpcDropTable/` does not exist) reads as an empty
 * list with its own sentence, and files that could not be parsed are reported above
 * the table instead of failing the request.
 *
 * One `GET /api/<type>` per page (D12: the endpoint rescans the corpus per request)
 * and everything else is client-side, so typing a search never issues a request. The
 * tab counts come from the response's own `summary` (D49), so a tab counts exactly
 * what the table holds.
 *
 * Story p4-09 adds the one create affordance this page was missing (`NewObjectControl`): a
 * `New <type>` button beside the search box that opens the shared create dialog for every tracked
 * family. It lives here rather than on seven pages because the seven families share this page
 * (AC3; D71(i)); GlobalRegistry is the one family that does not render this page (its single route
 * *is* its editor, D75(a)) and it has no create form — its dictionary gains a row, not an entry.
 *
 * The **quest** page keeps its own JSX (`pages/QuestsPage.tsx`): its DOM is pinned by
 * 170 committed UI specs, and "quests keep their tabbed page" is the plan's own
 * instruction (task 4.1). The *logic* is shared — `lib/quests.ts` delegates its tabs,
 * filter, search, pagination and labels to `lib/object-list.ts`, the module this page
 * uses — so the two surfaces cannot drift in what they compute.
 */

export interface ObjectListPageProps {
  /** One row of `shared/objectTypes.ts`. */
  config: ObjectTypeConfig;
  /** Plural noun used in every sentence (`NPC inventories`). */
  nounPlural: string;
  /** The key column's header (`NPC`). */
  keyHeader: string;
  /** Per-type columns rendered between the key column and Actions. */
  extraColumns?: readonly ObjectListColumn[];
  className?: string;
}

/** The skeleton rows while the list loads. */
const SKELETON_ROWS = 8;
const NO_ROWS: readonly ObjectListRow[] = [];
const NO_SUMMARY: ObjectStatusSummary = { total: 0, extracted: 0, reviewed: 0, verified: 0 };

export default function ObjectListPage({
  config,
  nounPlural,
  keyHeader,
  extraColumns,
  className,
}: ObjectListPageProps): JSX.Element {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const idPrefix = config.fileType;

  const [filter, setFilter] = useState<ObjectFilter>('All');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ObjectSort>(DEFAULT_OBJECT_SORT);
  const [page, setPage] = useState(1);

  // A filter or a search changes the row set, so a page number from the previous set
  // would be meaningless (`paginateRows` also clamps — this is the convenience half).
  useEffect(() => {
    setPage(1);
  }, [filter, search]);

  const query = useQuery({
    queryKey: objectListQueryKey(config),
    queryFn: () => listObjects(config),
    staleTime: Infinity,
  });

  const rows = query.data?.objects ?? NO_ROWS;
  const summary = query.data?.summary ?? NO_SUMMARY;
  const tabs = objectFilterTabs(summary);
  const derived = useMemo(
    () =>
      sortRows(
        searchRows(
          filterByStatus(rows, filter, (row) => row.status ?? 'extracted'),
          search,
          (row) => [row.key, row.title],
        ),
        sort,
        (row, key) => (key === 'key' ? row.key : key === 'status' ? row.status : row.modified_at),
        (row) => row.key,
      ),
    [rows, filter, search, sort],
  );
  const current = paginateRows(derived, page);

  const activateRow = useCallback(
    (row: ObjectListRow) => {
      navigate(objectDetailPath(config, row.key));
    },
    [config, navigate],
  );

  const href = useCallback(
    (row: ObjectListRow): string => objectDetailPath(config, row.key),
    [config],
  );
  const loading = objectLoadingLabel(nounPlural);
  const loadError = objectLoadError(nounPlural);

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div
          role="tablist"
          aria-label={objectFilterLabel(nounPlural)}
          className="flex flex-wrap gap-1 border-b border-zinc-800"
        >
          {tabs.map((tab) => {
            const active = tab.filter === filter;
            return (
              <button
                key={tab.filter}
                type="button"
                role="tab"
                id={`${idPrefix}-filter-${tab.filter}`}
                aria-selected={active}
                aria-controls={`${idPrefix}-results`}
                onClick={() => setFilter(tab.filter)}
                className={cn(
                  '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  active
                    ? 'border-blue-500 text-white'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200',
                )}
              >
                {tab.filter}
                <Badge variant={active ? 'default' : 'secondary'}>{tab.count}</Badge>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative md:w-64">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={objectSearchPlaceholder(nounPlural)}
              aria-label={objectSearchLabel(nounPlural)}
              className="pl-9"
            />
          </div>
          {/* Story p4-09 (AC3): the one shared create affordance, mounted here so every tracked
              family's list page has it and none of them owns a variant (D71(i)). */}
          <NewObjectControl config={config} nounPlural={nounPlural} />
        </div>
      </div>

      {query.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">{loading}</span>
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden="true" />
            <p role="alert" className="text-sm text-zinc-200">
              {loadError}
            </p>
            <p className="text-sm text-zinc-500">{serverMessage(query.error, loadError)}</p>
            <Button
              variant="outline"
              onClick={() => {
                void query.refetch();
              }}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div
          id={`${idPrefix}-results`}
          role="tabpanel"
          aria-labelledby={`${idPrefix}-filter-${filter}`}
          className="flex flex-col gap-3"
        >
          <CorpusNotices result={query.data} directory={config.directory} />

          {current.items.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <p className="text-sm text-zinc-200">
                  {objectEmptyStateMessage(filter, nounPlural)}
                </p>
                <p className="text-sm text-zinc-500">{OBJECT_EMPTY_STATE_HINT}</p>
              </CardContent>
            </Card>
          ) : isMobile ? (
            <ObjectCardList
              rows={current.items}
              title={(row) => row.title}
              status={(row) => (row.status === null ? null : <StatusBadge status={row.status} />)}
              modified={(row) => relativeTime(row.modified_at)}
              href={href}
              ariaLabel={nounPlural}
              className="flex flex-col gap-2"
            />
          ) : (
            <ObjectTable
              rows={current.items}
              keyHeader={keyHeader}
              href={href}
              sort={sort}
              onSortChange={setSort}
              onRowActivate={activateRow}
              extraColumns={extraColumns}
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
    </div>
  );
}

/**
 * The two corpus notices: the absent directory and the files the scan could not key.
 *
 * `NpcDropTable/` does not exist in the fork, so its empty list says why (and that
 * the first save creates it) instead of looking like an empty corpus; and a legacy
 * file with trailing-comma damage or a missing key field is named, because a row the
 * user cannot see is exactly the thing worth saying out loud.
 */
function CorpusNotices({
  result,
  directory,
}: {
  result: ObjectListResponse | undefined;
  directory: string;
}): JSX.Element | null {
  if (result === undefined) {
    return null;
  }
  const notices: string[] = [];
  if (result.missing_directory) {
    notices.push(
      `The ${directory}/ directory does not exist in this SpiralDB repository yet — ` +
        `the first save creates it.`,
    );
  }
  if (result.skipped.length > 0) {
    notices.push(
      `${result.skipped.length} file(s) could not be listed: ` +
        result.skipped.map((row) => row.file).join(', '),
    );
  }
  if (result.duplicate_keys.length > 0) {
    notices.push(
      `Duplicate keys (first file in name order wins): ${result.duplicate_keys.join(', ')}`,
    );
  }
  if (notices.length === 0) {
    return null;
  }
  return (
    <ul className="flex flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2">
      {notices.map((notice) => (
        <li key={notice} className="text-xs text-zinc-400">
          {notice}
        </li>
      ))}
    </ul>
  );
}
