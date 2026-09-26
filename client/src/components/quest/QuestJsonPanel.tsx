import { collapseAllNested, darkStyles, JsonView } from 'react-json-view-lite';
import type { Props as JsonViewProps } from 'react-json-view-lite';

import type { QuestObject } from '../../lib/api';
import {
  JSON_COPIED_MESSAGE,
  JSON_COPY_ERROR,
  JSON_COPY_LABEL,
  JSON_PANEL_GLYPH,
  JSON_PANEL_TITLE,
  JSON_PANEL_WIDTH_PX,
} from '../../lib/quests';
import { notifyError, notifySuccess } from '../../lib/notify';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';

// react-json-view-lite ships its syntax colours as hashed CSS classes, so the
// stylesheet is part of the component, not an optional nicety.
import 'react-json-view-lite/dist/index.css';

/**
 * The quest JSON side panel — desktop pane and mobile overlay (plan task 2.7,
 * docs/spec-ui-design.md L324-340).
 *
 * `react-json-view-lite` is the plan's choice (L64) over `@monaco-editor/react`
 * "for lightness": Monaco is a multi-megabyte editor for a read-only 400px
 * viewer. It is the **fetch-free** view of the quest object the detail page
 * already has, exactly like `QuestPreview`, so it takes the object as a prop.
 *
 * - {@link QuestJsonPanel} is the 400px desktop `<aside>` (spec L326), sliding in
 *   from the right;
 * - {@link QuestJsonOverlay} is the same content as a **full-screen dialog** below
 *   `md` (spec L340) instead of a squeezed side panel.
 *
 * The page mounts exactly one of them (`useIsMobile`, the same breakpoint as `md:`),
 * so a phone never has a focus-trapping dialog hidden beside a visible pane.
 *
 * Known-and-recorded deviation: the spec's ASCII diagram also shows `[Wrap]`. That
 * affordance belongs to the Monaco option; `react-json-view-lite` wraps text
 * unconditionally, so there is nothing to toggle and the panel ships `[Copy]` only.
 */

/**
 * The library's Solarized-dark container colour replaced with the app's own
 * surfaces (`zinc-950` well, mono, pre-wrap) — the syntax colours of `darkStyles`
 * are kept. The `style` prop is a map of class-name strings, so this is a class
 * merge, not a theme fork.
 */
const JSON_STYLE: NonNullable<JsonViewProps['style']> = {
  ...darkStyles,
  container:
    'overflow-x-hidden whitespace-pre-wrap break-words bg-zinc-950 p-3 font-mono text-xs leading-relaxed',
};

/** Copies the quest's pretty-printed JSON, reporting either outcome as a toast. */
async function copyQuestJson(quest: QuestObject): Promise<void> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(quest, null, 2));
    notifySuccess(JSON_COPIED_MESSAGE);
  } catch {
    notifyError(JSON_COPY_ERROR);
  }
}

/** The syntax-highlighted tree: top level expanded, nested nodes collapsed. */
function QuestJsonTree({ quest }: { quest: QuestObject }): JSX.Element {
  return <JsonView data={quest} style={JSON_STYLE} shouldExpandNode={collapseAllNested} />;
}

/** The panel's own toolbar: the `{ }` mark and the spec's `[Copy]`. */
function QuestJsonToolbar({
  quest,
  className,
}: {
  quest: QuestObject;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <span className="font-mono text-xs text-zinc-500" aria-hidden="true">
        {JSON_PANEL_GLYPH}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          void copyQuestJson(quest);
        }}
      >
        {JSON_COPY_LABEL}
      </Button>
    </div>
  );
}

export interface QuestJsonPanelProps {
  quest: QuestObject;
  className?: string;
}

/** The desktop side panel: exactly {@link JSON_PANEL_WIDTH_PX} wide, slides in. */
export function QuestJsonPanel({ quest, className }: QuestJsonPanelProps): JSX.Element {
  return (
    <aside
      aria-label={JSON_PANEL_TITLE}
      style={{ width: JSON_PANEL_WIDTH_PX }}
      className={cn(
        'flex shrink-0 animate-in flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 duration-200 slide-in-from-right',
        className,
      )}
    >
      <QuestJsonToolbar quest={quest} className="border-b border-zinc-800 px-3 py-2" />
      <div className="min-h-0 flex-1 overflow-auto">
        <QuestJsonTree quest={quest} />
      </div>
    </aside>
  );
}

export interface QuestJsonOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quest: QuestObject;
}

/** The mobile full-screen overlay (< 768px) carrying the same toolbar + tree. */
export function QuestJsonOverlay({
  open,
  onOpenChange,
  quest,
}: QuestJsonOverlayProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="inset-0 flex h-full w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 sm:rounded-none">
        <DialogHeader className="border-b border-zinc-800 p-3 pr-12">
          <DialogTitle className="font-mono text-sm font-semibold text-zinc-50">
            {JSON_PANEL_TITLE}
          </DialogTitle>
          <DialogDescription className="sr-only">Read-only JSON of this quest.</DialogDescription>
        </DialogHeader>
        <QuestJsonToolbar quest={quest} className="border-b border-zinc-800 px-3 py-2" />
        <div className="min-h-0 flex-1 overflow-auto">
          <QuestJsonTree quest={quest} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
