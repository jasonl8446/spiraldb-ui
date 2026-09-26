import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ChevronDown, ChevronUp, ChevronsUpDown, Pencil } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import type { QuestListRow, StatusValue } from '../../lib/api';
import { relativeTime } from '../../lib/display';
import {
  DEFAULT_QUEST_SORT,
  EDIT_ACTION_LABEL,
  EDIT_DISABLED_TOOLTIP,
  QUEST_COLUMNS,
  QUEST_SORT_KEYS,
  questStatus,
  type QuestColumnId,
  type QuestSort,
  type QuestSortKey,
} from '../../lib/quests';
import type { TransitionTarget } from '../../lib/status-transition';
import { cn } from '../../lib/utils';
import { STATUS_META } from '../StatusBadge';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import StatusMenu from './StatusMenu';

/**
 * `QuestBrowseTable` — the desktop browse table (plan task 2.7,
 * docs/spec-ui-design.md L250-266).
 *
 * The seven columns, their widths and their sortability come from
 * {@link QUEST_COLUMNS} (the spec's own table, kept as data); **TanStack Table**
 * (spec L16) renders them and owns the header sort toggles. Sorting itself is
 * `manualSorting`: the pure comparators in `lib/quests.ts` do the ordering, so the
 * filtered/searched/sorted derivation stays unit-testable in node.
 *
 * The row is clickable (spec L264) *and* the quest name is a real link, so
 * keyboard users get the navigation through the link while a mouse user can click
 * anywhere on the row. The Actions cell stops propagation — its buttons must not
 * navigate.
 *
 * `table-fixed` is deliberate: the spec fixes six of the seven columns in px, and
 * fixed layout is what makes those widths exact (the flex Quest Name column
 * absorbs the remainder) instead of browser-adjusted to the text.
 */
export interface QuestBrowseTableProps {
  /** The rows of the current page. */
  rows: QuestListRow[];
  sort: QuestSort;
  onSortChange: (sort: QuestSort) => void;
  onRowActivate: (row: QuestListRow) => void;
  /** Step 1 of a transition: the page gates the user, then opens the notes dialog. */
  onTransition: (row: QuestListRow, target: TransitionTarget) => void;
  /** True while a transition is in flight; every row's status menu is disabled. */
  transitionPending?: boolean;
  className?: string;
}

/** `true` for a column id that is one of the six sort keys. */
function isQuestSortKey(id: string): id is QuestSortKey {
  return (QUEST_SORT_KEYS as readonly string[]).includes(id);
}

/** The column's fixed px width, or `undefined` for the flex Quest Name column. */
function widthStyle(id: QuestColumnId): { width: number } | undefined {
  const width = QUEST_COLUMNS.find((column) => column.id === id)?.widthPx;
  return width === null || width === undefined ? undefined : { width };
}

/** The colour dot the Status column shows (spec L256: "Color dot only"). */
function StatusDot({ status }: { status: StatusValue }): JSX.Element {
  const meta = STATUS_META[status];
  return (
    <span className="inline-flex items-center" title={meta.label}>
      <span className={cn('h-2.5 w-2.5 rounded-full', meta.dotClass)} aria-hidden="true" />
      <span className="sr-only">Status: {meta.label}</span>
    </span>
  );
}

/** The header's sort affordance: unsorted / ascending / descending. */
function SortIcon({ direction }: { direction: 'asc' | 'desc' | false }): JSX.Element {
  if (direction === 'asc') {
    return <ChevronUp className="h-3 w-3" aria-hidden="true" />;
  }
  if (direction === 'desc') {
    return <ChevronDown className="h-3 w-3" aria-hidden="true" />;
  }
  return <ChevronsUpDown className="h-3 w-3 text-zinc-600" aria-hidden="true" />;
}

export default function QuestBrowseTable({
  rows,
  sort,
  onSortChange,
  onRowActivate,
  onTransition,
  transitionPending = false,
  className,
}: QuestBrowseTableProps): JSX.Element {
  const sorting = useMemo<SortingState>(
    () => [{ id: sort.key, desc: sort.direction === 'desc' }],
    [sort],
  );

  const columns = useMemo<Array<ColumnDef<QuestListRow>>>(
    () => [
      {
        id: 'status',
        header: QUEST_COLUMNS[0].header,
        accessorFn: (row) => questStatus(row),
        cell: ({ row }) => <StatusDot status={questStatus(row.original)} />,
      },
      {
        id: 'quest_name',
        header: QUEST_COLUMNS[1].header,
        accessorFn: (row) => row.quest_name,
        cell: ({ row }) => (
          // The truncation + tooltip the spec's Quest Name column asks for (L257).
          <Link
            to={`/quests/${encodeURIComponent(row.original.quest_name)}`}
            className="block truncate font-mono text-sm text-zinc-100 hover:text-blue-400"
            title={row.original.quest_name}
            onClick={(event) => event.stopPropagation()}
          >
            {row.original.quest_name}
          </Link>
        ),
      },
      {
        id: 'level',
        header: QUEST_COLUMNS[2].header,
        accessorFn: (row) => row.level,
        cell: ({ row }) => <Badge variant="secondary">{row.original.level ?? '—'}</Badge>,
      },
      {
        id: 'goal_count',
        header: QUEST_COLUMNS[3].header,
        accessorFn: (row) => row.goal_count,
        cell: ({ row }) => <span className="tabular-nums">{row.original.goal_count}</span>,
      },
      {
        id: 'is_mainline',
        header: QUEST_COLUMNS[4].header,
        accessorFn: (row) => row.is_mainline,
        cell: ({ row }) =>
          row.original.is_mainline ? (
            // "Checkmark or empty" (L260): the checkmark carries the word for
            // assistive tech, and the title makes it reachable by hover and by test.
            <span className="inline-flex items-center text-emerald-400" title="Mainline quest">
              <span aria-hidden="true">✓</span>
              <span className="sr-only">Mainline</span>
            </span>
          ) : null,
      },
      {
        id: 'modified_at',
        header: QUEST_COLUMNS[5].header,
        accessorFn: (row) => row.modified_at,
        cell: ({ row }) => (
          <span className="text-zinc-400">{relativeTime(row.original.modified_at)}</span>
        ),
      },
      {
        id: 'actions',
        header: QUEST_COLUMNS[6].header,
        // Not sortable (L262) — the spec's one non-sortable column.
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions row={row.original} disabled={transitionPending} onTransition={onTransition} />
        ),
      },
    ],
    [onTransition, transitionPending],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      const head = next[0];
      if (head === undefined || !isQuestSortKey(head.id)) {
        // A third click on the sorted column removes the sort; fall back to the
        // page's own default rather than leaving the table order undefined.
        onSortChange(DEFAULT_QUEST_SORT);
        return;
      }
      onSortChange({ key: head.id, direction: head.desc ? 'desc' : 'asc' });
    },
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    // Every column's first click sorts ascending. TanStack's default is "auto":
    // ascending for string cells and **descending** for numbers/booleans, so Level
    // would start at 20 and Mainline at "checked" while Status started at
    // `extracted` — a direction the user cannot predict, decided by the JS type of
    // an accessor it cannot see (measured in the tier-1 spec). The spec is silent on
    // direction (L254-262), so it is pinned here instead of left to the library.
    sortDescFirst: false,
  });

  return (
    <Table className={cn('table-fixed', className)}>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id} className="hover:bg-transparent">
            {headerGroup.headers.map((header) => {
              const id = header.column.id as QuestColumnId;
              const sorted = header.column.getIsSorted();
              return (
                <TableHead
                  key={header.id}
                  style={widthStyle(id)}
                  className={cn(id === 'actions' && 'px-2')}
                  aria-sort={
                    sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined
                  }
                >
                  {header.column.getCanSort() ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-sm text-xs font-medium uppercase tracking-wide transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                        sorted === false ? 'text-zinc-400' : 'text-zinc-100',
                      )}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <SortIcon direction={sorted} />
                    </button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row, index) => (
          <TableRow
            key={row.id}
            // Spec L264: alternating zinc-900 / zinc-900/50, hover zinc-800/50 (the
            // latter is the TableRow primitive's own).
            className={cn('cursor-pointer', index % 2 === 0 ? 'bg-zinc-900' : 'bg-zinc-900/50')}
            onClick={() => onRowActivate(row.original)}
          >
            {row.getVisibleCells().map((cell) => {
              const id = cell.column.id as QuestColumnId;
              return (
                <TableCell
                  key={cell.id}
                  style={widthStyle(id)}
                  className={cn(
                    id === 'status' && 'px-3',
                    id === 'actions' && 'px-2',
                    id === 'is_mainline' && 'text-center',
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * The Actions cell: the disabled Edit action (Phase 3) and the real status menu
 * (story p2-09, which replaces p2-08's disabled placeholder).
 *
 * The Edit action is icon-only because the spec's Actions column is 80px (L262) —
 * two labelled buttons do not fit — and it keeps `aria-disabled` + a native
 * `title` rather than the `disabled` attribute so its tooltip still fires and it
 * stays focusable (D51(b)). The status menu is `StatusMenu`, which owns its own
 * popover; both stop propagation so an action never navigates the row.
 */
function RowActions({
  row,
  disabled,
  onTransition,
}: {
  row: QuestListRow;
  disabled: boolean;
  onTransition: (row: QuestListRow, target: TransitionTarget) => void;
}): JSX.Element {
  return (
    <span className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        aria-label={`${EDIT_ACTION_LABEL}: ${row.quest_name}`}
        aria-disabled="true"
        title={EDIT_DISABLED_TOOLTIP}
        onClick={(event) => event.stopPropagation()}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
      <StatusMenu
        questName={row.quest_name}
        status={questStatus(row)}
        disabled={disabled}
        onSelect={(target) => onTransition(row, target)}
      />
    </span>
  );
}
