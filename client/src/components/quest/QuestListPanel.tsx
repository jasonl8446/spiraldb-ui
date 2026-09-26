import type { QuestObject } from '../../lib/api';
import { goalCount, NEW_BADGE_LABEL, questLevel, questName } from '../../lib/extract';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';

/**
 * `QuestListPanel` — the extracted-quests list (plan task 2.6,
 * docs/spec-ui-design.md L224).
 *
 * Pure and prop-driven: the page owns which row is selected, this renders rows
 * and reports clicks. Each row carries exactly the four things the spec names —
 * quest name (mono), level badge, goal count and the `new` status badge — and the
 * selected row is `blue-600/10`.
 *
 * Real listbox semantics (`role="listbox"` / `role="option"` /
 * `aria-selected`) so the selection is announced and so the spec can drive it by
 * role rather than by CSS class.
 */
export interface QuestListPanelProps {
  quests: readonly QuestObject[];
  /** Index into `quests`; `-1` means nothing is selected. */
  selectedIndex: number;
  onSelect: (index: number) => void;
  className?: string;
}

export default function QuestListPanel({
  quests,
  selectedIndex,
  onSelect,
  className,
}: QuestListPanelProps): JSX.Element {
  if (quests.length === 0) {
    return (
      <p className={cn('p-4 text-sm text-zinc-500', className)}>
        No quests were found in this packet capture.
      </p>
    );
  }

  return (
    <ul
      role="listbox"
      aria-label="Extracted quests"
      className={cn('flex flex-col gap-1 overflow-y-auto p-2', className)}
    >
      {quests.map((quest, index) => {
        const selected = index === selectedIndex;
        const level = questLevel(quest);
        const goals = goalCount(quest);
        return (
          <li key={`${questName(quest, index)}-${index}`}>
            <button
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => onSelect(index)}
              className={cn(
                'flex w-full flex-col gap-1.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-zinc-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                selected && 'bg-blue-600/10',
              )}
            >
              <span className="truncate font-mono text-sm text-zinc-50">
                {questName(quest, index)}
              </span>
              <span className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <Badge variant="secondary">Level {level ?? '—'}</Badge>
                <span>
                  {goals} {goals === 1 ? 'goal' : 'goals'}
                </span>
                <Badge variant="outline" className="border-blue-500/40 text-blue-400">
                  {NEW_BADGE_LABEL}
                </Badge>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
