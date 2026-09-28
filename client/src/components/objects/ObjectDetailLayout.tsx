import { ArrowLeft, Braces, Pencil, Save } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { ObjectTypeConfig } from '@shared/objectTypes';

import { useIsMobile } from '../../hooks/useIsMobile';
import type { StatusValue } from '../../lib/api';
import { namePair } from '../../lib/display';
import { JSON_PANEL_LABEL } from '../../lib/quests';
import { cn } from '../../lib/utils';
import StatusBadge from '../StatusBadge';
import { QuestJsonOverlay, QuestJsonPanel } from '../quest/QuestJsonPanel';
import StatusHistoryPanel from '../quest/StatusHistoryPanel';
import { Button } from '../ui/button';
import ObjectStatusActions from './ObjectStatusActions';

/**
 * `ObjectDetailLayout` — the generic detail header + shell of task 4.1, generalised
 * from the quest detail page's header (docs/spec-ui-design.md L462-469):
 *
 * ```
 * Header: ← Back    {Object Type}    [StatusBadge]    [Edit] [Save]
 * Content: Single form (no tabs needed for simple types)
 *          Optional JSON side panel (same toggle as quests)
 * ```
 *
 * It is deliberately **presentational**: the page owns the fetch, the document model
 * and the save; this component owns the header, the edit/save affordances and the
 * JSON panel, so all eight families render the same chrome. The JSON panel is the
 * same `QuestJsonPanel` the quest detail uses — the 400px desktop `<aside>` and the
 * full-screen overlay below `md` — because it renders **any** JSON document (its prop
 * is typed `unknown`); only its title differs per family.
 *
 * `StatusBadge` is omitted when the family has no lifecycle (`status === null`,
 * GlobalRegistry per Q1). The Edit/Save pair is hidden for such a family **unless**
 * {@link ObjectDetailLayoutProps.editable} says otherwise: a lifecycle badge is about the
 * `entry_status` row, not about whether the document may be edited, and story p4-07's
 * GlobalRegistry editor is exactly the document that must be editable without one. The flag is
 * explicit rather than inferred, so a future lifecycle-free family cannot silently become
 * editable.
 */
export interface ObjectDetailLayoutProps {
  /** One row of `shared/objectTypes.ts` — the type name in the header. */
  config: ObjectTypeConfig;
  /** The entry's canonical key, shown beside the type name. */
  objectKey: string;
  /**
   * The entry's friendly name from `useObjectFriendlyName`, or `null` when the family
   * (or this key) has none. The header renders `namePair(friendlyName, objectKey)`
   * through `display.ts`'s ONE rule — `Merle Ambrose (38168)` — and the technical
   * value alone when it is null.
   */
  friendlyName?: string | null;
  /**
   * The entry's lifecycle status; `null` renders no badge, no mark actions and no history
   * panel (GlobalRegistry, Q1).
   */
  status: StatusValue | null;
  /**
   * Singular family noun for the status copy (`'drop table'`, `'NPC inventory'`). Only used
   * when the family is tracked; omitted falls back to the config label, which is correct but
   * capitalized.
   */
  noun?: string;
  /**
   * Show the Edit/Save pair anyway. Defaults to `status !== null`; GlobalRegistry (story p4-07)
   * is the only caller that passes it, because its document is editable while it has no
   * `entry_status` row at all (Q1).
   */
  editable?: boolean;
  /** Where the Back link goes and what it says (`Back to NPC Inventories`). */
  backTo: string;
  backLabel: string;
  mode: 'view' | 'edit';
  onEdit: () => void;
  onSave: () => void;
  /** True while the save request is in flight. */
  saving?: boolean;
  /** True when the live document differs from the loaded one (byte comparison, D66). */
  dirty?: boolean;
  /**
   * True when the family's blocking validation rejects the live document (task 4.2's four
   * DropTable rules): Save is disabled and {@link blockReason} is its title, so the reason is
   * never only a colour.
   */
  saveBlocked?: boolean;
  /** The sentence the Save button carries while `saveBlocked` (the form's banner says the same). */
  blockReason?: string;
  /** The document the JSON panel draws — the live one, so an edit shows up immediately. */
  document: unknown;
  /** The form. */
  children: ReactNode;
  className?: string;
}

export default function ObjectDetailLayout({
  config,
  objectKey,
  friendlyName = null,
  status,
  editable: editableProp,
  noun,
  backTo,
  backLabel,
  mode,
  onEdit,
  onSave,
  saving = false,
  dirty = false,
  saveBlocked = false,
  blockReason,
  document,
  children,
  className,
}: ObjectDetailLayoutProps): JSX.Element {
  const isMobile = useIsMobile();
  const [jsonOpen, setJsonOpen] = useState(false);
  // A lifecycle badge means the entry has a status to move; an explicit `editable` overrides it
  // for a document-editable family with no lifecycle (GlobalRegistry, story p4-07).
  const editable = editableProp ?? status !== null;
  /**
   * The one gate every status surface hangs off (story p4-08): a family is *tracked* when it has
   * both a D4 status route and a joined status. `global_registry` has neither (Q1/D75(j)) — it
   * has no route and `statusForEntry` returns `null` — so it renders no badge, no mark actions
   * and no history panel, and issues no status request at all.
   */
  const tracked = status !== null && config.routeType !== null;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={backTo}
          className="inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-zinc-100"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {backLabel}
        </Link>

        <span className="text-sm font-medium text-zinc-200">{config.label}</span>
        {/*
          The pair, through the one display rule. When `friendlyName` is null the
          technical value stands alone and the tooltip says which of the two states the
          family is in (`config.friendlyNameNote` for DropTable/GlobalRegistry/
          CreatureSpellbook) rather than leaving a blank label (spec-ui-design L65-69).
        */}
        <span
          className="truncate font-mono text-sm text-zinc-400"
          title={friendlyName === null ? (config.friendlyNameNote ?? objectKey) : undefined}
        >
          {namePair(friendlyName, objectKey)}
        </span>

        {status === null ? null : <StatusBadge status={status} />}

        {/*
          `flex-wrap` is story p4-10's mobile fix: at 375px the five actions
          (`Mark Reviewed` / `Mark Verified` / `{ }` / `Edit` / `Save`) are ~460px wide
          together, so without wrapping the group's right edge sat 86px past the viewport and
          the page scrolled sideways (measured: `right=461` of 375). Wrapping lets the group
          shrink to its widest single button and lay the rest on following lines; on desktop
          nothing wraps, so the row is unchanged.
        */}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/*
            The mark actions and their notes dialog, from the one shared unit (story p4-08).
            Mounted only for a tracked family, which is what keeps `global_registry` free of
            them by construction rather than by a comment.
          */}
          {tracked ? (
            <ObjectStatusActions
              config={config}
              type={config.routeType}
              objectKey={objectKey}
              status={status}
              {...(noun === undefined ? {} : { noun })}
            />
          ) : null}

          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={JSON_PANEL_LABEL}
            aria-pressed={jsonOpen}
            onClick={() => setJsonOpen((open) => !open)}
          >
            <Braces className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {'{ }'}
          </Button>

          {editable ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onEdit}
                disabled={mode === 'edit'}
                aria-pressed={mode === 'edit'}
              >
                <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Edit
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onSave}
                disabled={saving || !dirty || saveBlocked}
                aria-disabled={saveBlocked || undefined}
                title={saveBlocked ? blockReason : dirty ? undefined : 'No changes to save'}
              >
                <Save className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex min-h-0 flex-col gap-4 md:flex-row">
        <div className="min-w-0 flex-1">{children}</div>

        {jsonOpen && !isMobile ? (
          <QuestJsonPanel quest={document} title={`${config.label} JSON`} />
        ) : null}
      </div>

      {/*
        The history timeline, for a tracked family only. It is the panel `StatusHistoryPanel`
        already was (p2-09), generalised to take the family's route; the quest page keeps
        mounting it itself.
      */}
      {tracked ? (
        <StatusHistoryPanel
          type={config.routeType}
          objectKey={objectKey}
          {...(noun === undefined ? {} : { noun })}
        />
      ) : null}

      {isMobile ? (
        <QuestJsonOverlay
          open={jsonOpen}
          onOpenChange={setJsonOpen}
          quest={document}
          title={`${config.label} JSON`}
          description="Read-only JSON of this entry."
        />
      ) : null}
    </div>
  );
}
