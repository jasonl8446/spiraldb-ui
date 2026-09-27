/**
 * `ObjectStatusActions` — the **one** shared mark-actions unit for the seven tracked object
 * families (story p4-08, plan task 4.10; decisions D52, D71(i), D75(j)).
 *
 * Before this file the quest detail page was the only surface that could move a status: it
 * wired `useStatusTransition` into its own header by hand. The seven generic families all go
 * through `ObjectDetailLayout` (`ObjectDetailPage`), so this unit is mounted **there**, once,
 * and every tracked family gets the same two actions and the same notes dialog from one place
 * — no per-page copy of the wiring (the story's named failure mode).
 *
 * It renders, in the header's action cluster, next to the `StatusBadge`:
 *
 * - **Mark Reviewed** and **Mark Verified**, from `STATUS_TRANSITIONS` (shared with the quest
 *   header and the browse table's status menu), with the action for the status the entry
 *   already has carrying `aria-disabled` rather than `disabled` — the same affordance rule the
 *   quest header uses (a natively disabled control leaves the tab order and stops explaining
 *   itself), re-checked in the handler so the attribute describes the behaviour.
 * - the `<StatusNotesDialog>` the transition opens, spread from `transition.dialog` — so the
 *   identity gate (D38) runs **before** the dialog is shown, exactly as it does for quests.
 *
 * ## What stayed behind (and why)
 *
 * - **The history panel**: `components/quest/StatusHistoryPanel.tsx` was generalised in place
 *   (it takes `type`/`objectKey`/`noun` now) instead of being copied or moved.
 *   `ObjectDetailLayout` mounts it for the tracked families. The one unit that did not exist
 *   for object pages — the mark actions — is this file.
 * - **The quest detail page's header JSX**: unchanged. Its DOM is pinned by the committed
 *   Phase-2/3 UI specs, it renders the actions inline plus an `h1`, and its own
 *   `useStatusTransition('quests')` call already resolved to the quest scope this story made
 *   explicit. Re-mounting the unit there would be a DOM change for no new behaviour.
 * - **The browse-page status menu** (`QuestsPage`): the status menu is a quest-table affordance
 *   from p2-09 and the object list deliberately shows a dot only (spec L256), so nothing generic
 *   mounts the menu.
 *
 * ## The type is a *required* prop, not read from the config here
 *
 * `global_registry` has no status route (Q1, D75(j)) and no `entry_status` row, so the unit
 * must never be mounted for it. The gate lives in the caller (`ObjectDetailLayout` renders this
 * component only when `config.routeType !== null && status !== null`), which is also what lets
 * `type` be a plain `StatusRouteType` with no unreachable branch and no conditional hook here.
 */

import { useMemo } from 'react';

import type { ObjectTypeConfig } from '@shared/objectTypes';

import { type StatusRouteType, type StatusValue } from '../../lib/api';
import { objectStatusScope } from '../../lib/object-status';
import { STATUS_TRANSITIONS, isCurrentStatus } from '../../lib/status-transition';
import { cn } from '../../lib/utils';
import { useStatusTransition } from '../../hooks/useStatusTransition';
import StatusNotesDialog from '../quest/StatusNotesDialog';
import { Button } from '../ui/button';

export interface ObjectStatusActionsProps {
  /** One row of `shared/objectTypes.ts` — supplies the family's list query key. */
  config: ObjectTypeConfig;
  /** The D4 plural route the PATCH targets; the layout only passes it for a tracked family. */
  type: StatusRouteType;
  /** The entry's canonical key (`entry_status.object_key`). */
  objectKey: string;
  /** The entry's current status, so the matching action can disable itself. */
  status: StatusValue;
  /** Singular family noun for the untracked copy (`'drop table'`); defaults to the label. */
  noun?: string;
}

export default function ObjectStatusActions({
  config,
  type,
  objectKey,
  status,
  noun,
}: ObjectStatusActionsProps): JSX.Element {
  const scope = useMemo(() => objectStatusScope(config, noun), [config, noun]);
  const transition = useStatusTransition(type, scope);

  return (
    <>
      {STATUS_TRANSITIONS.map((action) => {
        const current = isCurrentStatus(status, action.status);
        const unavailable = current || transition.isPending;
        return (
          <Button
            key={action.status}
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={unavailable}
            title={current ? `Already ${action.status}` : undefined}
            className={cn(
              'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
              current ? null : 'border-blue-600/60 text-blue-300 hover:text-blue-200',
            )}
            onClick={() => {
              if (!unavailable) {
                transition.request(objectKey, action.status);
              }
            }}
          >
            {action.label}
          </Button>
        );
      })}
      <StatusNotesDialog {...transition.dialog} />
    </>
  );
}
