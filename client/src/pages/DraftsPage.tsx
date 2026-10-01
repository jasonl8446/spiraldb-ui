import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import RebuildDraftsButton from '../components/dashboard/RebuildDraftsButton';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Button } from '../components/ui/button';
import { draftsQueryKey, getQuestCoverage, listDrafts, QUEST_COVERAGE_QUERY_KEY } from '../lib/api';
import { serverMessage } from '../lib/extract';
import {
  DEFAULT_DRAFT_FILTER,
  draftDisplayName,
  draftEditorPath,
  draftsSummary,
  DRAFTS_EMPTY_COVERAGE_ERROR,
  DRAFTS_EMPTY_COVERAGE_PENDING,
  DRAFTS_EMPTY_NO_CATALOG,
  DRAFTS_EMPTY_NO_MATCH,
  DRAFTS_EMPTY_NO_SUGGESTIONS,
  draftsEmptyState,
  DRAFTS_SHOW_ALL_LABEL,
  SUGGESTION_SOURCES,
  type DraftFilter,
  type DraftRow,
  type DraftsEmptyState,
} from '../lib/suggestions';

/**
 * Draft Review Queue — `/drafts` (task 7.7 / story p7-08; docs/spec-ui-design.md §12; D129, D130,
 * D137, D143).
 *
 * The worklist of automatically drafted quests over `GET /api/drafts`: every row is one catalog id,
 * named or unnamed, in the **server's** order (evidence richness, then references) — the page never
 * re-sorts and never re-filters. The three filters and the D130 toggle are query parameters of that
 * one read (`draftsRequestPath`), and the toggle's hidden count is the response's
 * `hidden_zero_evidence`, shown as text beside it.
 *
 * A row opens the quest editor (`draftEditorPath`): a file opens as itself, a named quest with no
 * file opens on the D118 skeleton in memory (`/drafts/quest/:questName`) and an unnamed id on its own
 * skeleton (`/drafts/id/:questId`), where the first Save asks for its name (D137).
 */
export default function DraftsPage(): JSX.Element {
  const [filter, setFilter] = useState<DraftFilter>(DEFAULT_DRAFT_FILTER);

  const drafts = useQuery({
    queryKey: draftsQueryKey(filter),
    queryFn: () => listDrafts(filter),
  });
  // Only to tell "no catalog yet" (a sync is needed) from "no suggestions yet" (a rebuild is).
  const coverage = useQuery({ queryKey: QUEST_COVERAGE_QUERY_KEY, queryFn: getQuestCoverage });

  const rows = drafts.data?.drafts ?? [];
  const empty = draftsEmptyState(
    filter,
    coverage.isError ? 'error' : coverage.data === undefined ? 'pending' : coverage.data,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-zinc-200" data-testid="drafts-summary">
          {drafts.data === undefined ? '' : draftsSummary(drafts.data, filter.all)}
        </p>
        <label
          htmlFor="drafts-show-all"
          className="inline-flex cursor-pointer items-center gap-2 text-sm text-zinc-200"
        >
          <input
            id="drafts-show-all"
            type="checkbox"
            checked={filter.all}
            onChange={(event) => setFilter({ ...filter, all: event.target.checked })}
            className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 accent-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          />
          {DRAFTS_SHOW_ALL_LABEL}
          {drafts.data !== undefined && !filter.all
            ? ` (${drafts.data.hidden_zero_evidence.toLocaleString('en-US')} hidden)`
            : ''}
        </label>
        <span className="ml-auto">
          <RebuildDraftsButton />
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect
          id="drafts-named"
          label="Named"
          value={filter.named === null ? '' : filter.named ? '1' : '0'}
          options={[
            ['', 'Any'],
            ['1', 'Named'],
            ['0', 'Unnamed'],
          ]}
          onChange={(value) => setFilter({ ...filter, named: value === '' ? null : value === '1' })}
        />
        <FilterSelect
          id="drafts-has-file"
          label="Has file"
          value={filter.hasFile === null ? '' : filter.hasFile ? '1' : '0'}
          options={[
            ['', 'Any'],
            ['1', 'Has a file'],
            ['0', 'No file'],
          ]}
          onChange={(value) =>
            setFilter({ ...filter, hasFile: value === '' ? null : value === '1' })
          }
        />
        <FilterSelect
          id="drafts-source"
          label="Source"
          value={filter.source ?? ''}
          options={[['', 'Any'], ...SUGGESTION_SOURCES.map((source) => [source, source] as const)]}
          onChange={(value) => setFilter({ ...filter, source: value === '' ? null : value })}
        />
      </div>

      {drafts.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Loading drafts…</span>
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : drafts.isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden="true" />
            <p role="alert" className="text-sm text-zinc-200">
              {serverMessage(drafts.error, 'Could not load the drafts.')}
            </p>
            <Button variant="outline" onClick={() => void drafts.refetch()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-zinc-200" data-testid="drafts-empty" data-empty={empty}>
              {EMPTY_TEXT[empty]}
            </p>
            {empty === 'no-catalog' ? (
              <Button asChild variant="outline">
                <Link to="/settings">Sync friendly names</Link>
              </Button>
            ) : empty === 'coverage-error' ? (
              <Button variant="outline" onClick={() => void coverage.refetch()}>
                Try again
              </Button>
            ) : empty === 'no-suggestions' ? (
              <RebuildDraftsButton />
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quest</TableHead>
                <TableHead>Evidence</TableHead>
                <TableHead>Pending</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Sources</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <DraftTableRow key={`${row.quest_name ?? ''}#${row.catalog_id ?? ''}`} row={row} />
              ))}
            </TableBody>
          </Table>
          {drafts.data !== undefined && drafts.data.total > rows.length ? (
            <p className="mt-2 text-xs text-zinc-400">
              Showing the first {rows.length.toLocaleString('en-US')} of{' '}
              {drafts.data.total.toLocaleString('en-US')}, ranked by evidence.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** The empty queue's sentence, per {@link draftsEmptyState} (PR #14 review 9e). */
const EMPTY_TEXT: Record<DraftsEmptyState, string> = {
  'no-match': DRAFTS_EMPTY_NO_MATCH,
  'coverage-pending': DRAFTS_EMPTY_COVERAGE_PENDING,
  'coverage-error': DRAFTS_EMPTY_COVERAGE_ERROR,
  'no-catalog': DRAFTS_EMPTY_NO_CATALOG,
  'no-suggestions': DRAFTS_EMPTY_NO_SUGGESTIONS,
};

function DraftTableRow({ row }: { row: DraftRow }): JSX.Element {
  const hasFile = row.has_definition === 1;
  const Icon = hasFile ? Check : X;
  const testKey = row.quest_name ?? `id-${row.catalog_id ?? ''}`;
  return (
    <TableRow data-testid={`draft-row-${testKey}`}>
      <TableCell className="text-zinc-100">
        <Link
          to={draftEditorPath(row)}
          className="font-mono hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {draftDisplayName(row)}
        </Link>
        {row.quest_name === null ? (
          <span className="ml-2 text-xs text-amber-200">unnamed</span>
        ) : null}
      </TableCell>
      <TableCell className="text-zinc-300">{row.evidence_richness}</TableCell>
      <TableCell className="text-zinc-300">{row.pending}</TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1 text-sm text-zinc-200">
          <Icon
            aria-hidden="true"
            className={hasFile ? 'h-4 w-4 text-emerald-400' : 'h-4 w-4 text-zinc-400'}
          />
          {hasFile ? 'file' : 'none'}
        </span>
      </TableCell>
      <TableCell className="text-xs text-zinc-300">{row.sources.join(', ')}</TableCell>
    </TableRow>
  );
}

function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      {/* A sibling label, not a wrapping one: a wrapping label's name would include every option. */}
      <label htmlFor={id} className="text-xs text-zinc-400">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </div>
  );
}
