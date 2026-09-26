import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';

import type { StatusValue } from '../../lib/api';
import {
  isCurrentStatus,
  STATUS_MENU_LABEL,
  STATUS_MENU_TOOLTIP,
  STATUS_TRANSITIONS,
  type TransitionTarget,
} from '../../lib/status-transition';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

/**
 * The browse table's status menu (plan §2.8, story p2-09; spec-ui-design.md L262
 * "Edit button, status menu").
 *
 * This replaces p2-08's disabled placeholder (the dashed button whose tooltip said
 * "Status transitions arrive with story p2-09") — the placeholder is **gone**, and
 * its two exported constants with it.
 *
 * It is a **Radix `Popover`**, not a dropdown menu: the vendored primitives are
 * dialog/popover/command/slot (D39 ships only what real code first needed), and
 * there is no dropdown-menu primitive to use. The popover is therefore a labelled
 * group of two real buttons rather than a `role="menu"` — claiming menu semantics
 * without arrow-key roving focus would be worse than not claiming them. Escape,
 * outside-click and focus return all come from Radix; the trigger carries a native
 * `title` because there is no tooltip primitive either (D51(b)).
 *
 * Both actions are always listed and the one the entry already has is `disabled`
 * with a "Current" marker, so the menu also answers "what status is this row in?".
 * Both the trigger and the popover content stop click propagation: the whole table
 * row is a navigation target, and Radix's portal still bubbles through the React
 * tree, so a status action must not reach the row.
 */
export interface StatusMenuProps {
  /** The quest the menu acts on — the trigger's accessible name and the dialog's subject. */
  questName: string;
  /** The row's current status; that action is disabled. */
  status: StatusValue;
  /** True while a transition is in flight anywhere on the page. */
  disabled?: boolean;
  onSelect: (target: TransitionTarget) => void;
}

export default function StatusMenu({
  questName,
  status,
  disabled = false,
  onSelect,
}: StatusMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);

  function choose(target: TransitionTarget): void {
    setOpen(false);
    onSelect(target);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={`${STATUS_MENU_LABEL}: ${questName}`}
          title={STATUS_MENU_TOOLTIP}
          disabled={disabled}
          onClick={(event) => event.stopPropagation()}
        >
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-56 p-1"
        aria-label={`${STATUS_MENU_LABEL}: ${questName}`}
        // Radix portals this content to `document.body`, but React still bubbles the
        // click through the **React** tree — where the popover is a descendant of the
        // table row. Without this, choosing an action would also activate the row and
        // navigate away from the table. (The trigger needs its own stopPropagation for
        // the same reason.) Verified by `quests-status.spec.ts`.
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col">
          {STATUS_TRANSITIONS.map((transition) => {
            const current = isCurrentStatus(status, transition.status);
            return (
              <button
                key={transition.status}
                type="button"
                disabled={current}
                onClick={() => choose(transition.status)}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  current
                    ? 'cursor-not-allowed text-zinc-500'
                    : 'text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50',
                )}
              >
                {transition.label}
                {current ? <span className="text-xs text-zinc-500">Current</span> : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
