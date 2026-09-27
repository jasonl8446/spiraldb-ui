import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { ObjectListRow } from '../../lib/objects';

/**
 * `ObjectCardList` — the generic list as cards below `md` (task 4.1),
 * generalised from `QuestCardList` (docs/spec-ui-design.md L270: "Table becomes
 * card list").
 *
 * Each card carries the key (monospace), the status badge and the relative modified
 * time; the whole card is a `<Link>`, so the tap target is the card and keyboard
 * navigation needs no handler. The page mounts this **instead of** the table rather
 * than hidden beside it (the `useIsMobile` breakpoint matches Tailwind's `md:`), so
 * the table's columns are unreachable by assistive tech on a phone.
 */
export interface ObjectCardListProps {
  rows: readonly ObjectListRow[];
  /** The card's primary line: the key, or a friendlier title. */
  title: (row: ObjectListRow) => string;
  /** The status badge element; `null` for a family with no lifecycle. */
  status: (row: ObjectListRow) => ReactNode;
  /** Relative modified time, already formatted by the caller. */
  modified: (row: ObjectListRow) => string;
  href: (row: ObjectListRow) => string;
  ariaLabel: string;
  className?: string;
}

export default function ObjectCardList({
  rows,
  title,
  status,
  modified,
  href,
  ariaLabel,
  className,
}: ObjectCardListProps): JSX.Element {
  return (
    <ul className={className} aria-label={ariaLabel}>
      {rows.map((row) => (
        <li key={row.key}>
          <Link
            to={href(row)}
            className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 transition-colors hover:bg-zinc-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <span className="truncate font-mono text-sm text-zinc-100">{title(row)}</span>
            <span className="flex flex-wrap items-center gap-2">
              {status(row)}
              <span className="text-xs text-zinc-500">{modified(row)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
