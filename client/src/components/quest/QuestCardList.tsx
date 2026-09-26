import { Link } from 'react-router-dom';

import type { QuestListRow } from '../../lib/api';
import { relativeTime } from '../../lib/display';
import { questStatus } from '../../lib/quests';
import StatusBadge from '../StatusBadge';

/**
 * `QuestCardList` — the browse table as a card list below `md`
 * (docs/spec-ui-design.md L270: "Table becomes card list. Each card shows name,
 * level, status badge, modified date.").
 *
 * The four spec fields, exactly: monospace name, level, `StatusBadge` (which
 * carries both the colour and the status word — spec L545), and the relative
 * modified date. The whole card is a `<Link>`, so the tap target is the card and
 * keyboard navigation works without a handler.
 *
 * Mounted **instead of** the table rather than hidden beside it (the page decides
 * with `useIsMobile`, the same breakpoint Tailwind's `md:` uses), so the table's
 * seven columns cannot be reached by assistive tech on a phone.
 */
export interface QuestCardListProps {
  rows: QuestListRow[];
  className?: string;
}

export default function QuestCardList({ rows, className }: QuestCardListProps): JSX.Element {
  return (
    <ul className={className} aria-label="Quests">
      {rows.map((row) => (
        <li key={row.quest_name}>
          <Link
            to={`/quests/${encodeURIComponent(row.quest_name)}`}
            className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 transition-colors hover:bg-zinc-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <span className="truncate font-mono text-sm text-zinc-100">{row.quest_name}</span>
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-400">Level {row.level ?? '—'}</span>
              <StatusBadge status={questStatus(row)} />
              <span className="text-xs text-zinc-500">{relativeTime(row.modified_at)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
