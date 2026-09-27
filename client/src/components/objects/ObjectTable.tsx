import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { StatusValue } from '../../lib/api';
import { relativeTime } from '../../lib/display';
import type { ObjectListRow } from '../../lib/objects';
import { DEFAULT_OBJECT_SORT, isObjectSortKey, type ObjectSort } from '../../lib/object-list';
import { cn } from '../../lib/utils';
import { STATUS_META } from '../StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

/**
 * `ObjectTable` — the generic desktop list table (task 4.1), generalised from
 * `QuestBrowseTable` (docs/spec-ui-design.md L250-266: TanStack Table, fixed column
 * widths, sortable headers, clickable rows, striped `zinc-900` / `zinc-900/50`).
 *
 * The four standard columns are built here — Status (colour dot only, L256), the
 * key column (monospace, truncated with a tooltip, L257), Modified (relative time)
 * and an Actions cell — and a per-type caller may add columns between them
 * (`extraColumns`). Sorting is `manualSorting`: the pure comparator in
 * `lib/object-list.ts` orders the rows, so the derivation stays unit-testable in
 * node (decision D10) exactly like the quest page's.
 */

/**
 * The default for `extraColumns`.
 *
 * A module-level empty array, not `[]` in the destructuring: a fresh array literal
 * per render would invalidate the `widths`/`columns` memos below on every render, and
 * TanStack Table re-creates its internal options when a column definition array
 * changes identity — the recipe for a render loop (observed as a frozen page in the
 * first tier-1 run of this spec).
 */
const NO_EXTRA_COLUMNS: readonly ObjectListColumn[] = [];

/** The colour dot the Status column shows (spec L256: "Color dot only"). */
export function StatusDot({ status }: { status: StatusValue }): JSX.Element {
  const meta = STATUS_META[status];
  return (
    <span className="inline-flex items-center" title={meta.label}>
      <span className={cn('h-2.5 w-2.5 rounded-full', meta.dotClass)} aria-hidden="true" />
      <span className="sr-only">Status: {meta.label}</span>
    </span>
  );
}

/** One per-type column, rendered between the key column and Actions. */
export interface ObjectListColumn {
  id: string;
  header: string;
  widthPx: number | null;
  sortable: boolean;
  /** Sort value for a sortable column (`null` sorts last). */
  value?: (row: ObjectListRow) => string | number | null;
  cell: (row: ObjectListRow) => ReactNode;
}

export interface ObjectTableProps {
  rows: readonly ObjectListRow[];
  /** The key column's header text (e.g. `NPC`, `Drop Table`). */
  keyHeader: string;
  /** The entry route a row navigates to. */
  href: (row: ObjectListRow) => string;
  sort: ObjectSort;
  onSortChange: (sort: ObjectSort) => void;
  onRowActivate: (row: ObjectListRow) => void;
  extraColumns?: readonly ObjectListColumn[];
  className?: string;
}

/** Fixed px widths for the standard columns (the key column absorbs the remainder). */
const STATUS_WIDTH_PX = 40;
const MODIFIED_WIDTH_PX = 120;
const ACTIONS_WIDTH_PX = 80;

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

export default function ObjectTable({
  rows,
  keyHeader,
  href,
  sort,
  onSortChange,
  onRowActivate,
  extraColumns = NO_EXTRA_COLUMNS,
  className,
}: ObjectTableProps): JSX.Element {
  const sorting = useMemo<SortingState>(
    () => [{ id: sort.key, desc: sort.direction === 'desc' }],
    [sort],
  );

  const widths = useMemo<Record<string, number | null>>(() => {
    const map: Record<string, number | null> = {
      status: STATUS_WIDTH_PX,
      key: null,
      modified_at: MODIFIED_WIDTH_PX,
      actions: ACTIONS_WIDTH_PX,
    };
    for (const column of extraColumns) {
      map[column.id] = column.widthPx;
    }
    return map;
  }, [extraColumns]);

  const columns = useMemo<Array<ColumnDef<ObjectListRow>>>(() => {
    const defs: Array<ColumnDef<ObjectListRow>> = [
      {
        id: 'status',
        header: 'Status',
        accessorFn: (row) => row.status,
        cell: ({ row }) =>
          row.original.status === null ? null : <StatusDot status={row.original.status} />,
      },
      {
        id: 'key',
        header: keyHeader,
        accessorFn: (row) => row.key,
        cell: ({ row }) => (
          // Truncation + tooltip, the spec's own treatment for a long monospace key.
          <Link
            to={href(row.original)}
            className="block truncate font-mono text-sm text-zinc-100 hover:text-blue-400"
            title={row.original.title}
            onClick={(event) => event.stopPropagation()}
          >
            {row.original.title}
          </Link>
        ),
      },
      ...extraColumns.map<ColumnDef<ObjectListRow>>((column) => ({
        id: column.id,
        header: column.header,
        enableSorting: column.sortable,
        accessorFn: (row) => column.value?.(row) ?? null,
        cell: ({ row }) => column.cell(row.original),
      })),
      {
        id: 'modified_at',
        header: 'Modified',
        accessorFn: (row) => row.modified_at,
        cell: ({ row }) => (
          <span className="text-zinc-400">{relativeTime(row.original.modified_at)}</span>
        ),
      },
      {
        id: 'actions',
        header: 'Actions',
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            to={href(row.original)}
            aria-label={`Open ${row.original.key}`}
            className="text-xs text-zinc-400 underline-offset-2 hover:text-blue-400 hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            Open
          </Link>
        ),
      },
    ];
    return defs;
  }, [extraColumns, href, keyHeader]);

  // Stable identities all the way down: `data` is rebuilt only when the row set
  // itself changes, which keeps TanStack's option diff quiet between renders.
  const data = useMemo(() => [...rows], [rows]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      const head = next[0];
      if (head === undefined || !isObjectSortKey(head.id)) {
        // A third click on the sorted column removes the sort; fall back to the
        // page's own default rather than leaving the table order undefined.
        onSortChange(DEFAULT_OBJECT_SORT);
        return;
      }
      onSortChange({ key: head.id, direction: head.desc ? 'desc' : 'asc' });
    },
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    // Every column's first click sorts ascending — TanStack's `auto` default would
    // start numbers and booleans descending, a direction the user cannot predict.
    sortDescFirst: false,
  });

  return (
    <Table className={cn('table-fixed', className)}>
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id} className="hover:bg-transparent">
            {headerGroup.headers.map((header) => {
              const id = header.column.id;
              const sorted = header.column.getIsSorted();
              const width = widths[id];
              return (
                <TableHead
                  key={header.id}
                  style={width === null || width === undefined ? undefined : { width }}
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
            // Spec L264's stripes and hover, as the quest table renders them.
            className={cn('cursor-pointer', index % 2 === 0 ? 'bg-zinc-900' : 'bg-zinc-900/50')}
            onClick={() => onRowActivate(row.original)}
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell
                key={cell.id}
                style={
                  widths[cell.column.id] === null || widths[cell.column.id] === undefined
                    ? undefined
                    : { width: widths[cell.column.id] as number }
                }
                className={cn(
                  cell.column.id === 'status' && 'px-3',
                  cell.column.id === 'actions' && 'px-2',
                )}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
