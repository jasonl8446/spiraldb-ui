import { collapseAllNested, darkStyles, JsonView } from 'react-json-view-lite';
import type { Props as JsonViewProps } from 'react-json-view-lite';
import { useId, useState, type ReactNode } from 'react';

import {
  EVIDENCE_PANEL_TITLE,
  EVIDENCE_TAB_LABEL,
  JSON_COPIED_MESSAGE,
  JSON_COPY_ERROR,
  JSON_COPY_LABEL,
  JSON_PANEL_GLYPH,
  JSON_PANEL_TITLE,
  JSON_TAB_LABEL,
  JSON_WRAP_LABEL,
  JSON_WRAP_OFF_TOOLTIP,
  JSON_WRAP_ON_TOOLTIP,
  QUEST_RAIL_TABLIST_LABEL,
  type QuestRailTab,
} from '../../lib/quests';
import { nextTabIndex } from '../../lib/tablist';
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
 * - {@link QuestJsonPanel} is the side `<aside>` — **300px on tablet (768–1279px), 400px on
 *   desktop (≥1280px)** (spec L518-520, story p5-06) — sliding in from the right;
 * - {@link QuestJsonOverlay} is the same content as a **full-screen dialog** below
 *   `md` (spec L340) instead of a squeezed side panel.
 *
 * The page mounts exactly one of them (`useIsMobile`, the same breakpoint as `md:`),
 * so a phone never has a focus-trapping dialog hidden beside a visible pane.
 *
 * It renders **any** JSON document, not only a fetched quest: story p3-03 feeds it
 * the editor's live document so a form edit shows up here without a refresh (the
 * spec's "JSON side panel" is the edit view's own evidence surface, L324-340). That
 * is why the prop is `unknown` rather than `QuestObject` — the panel never reads a
 * field, it only serialises and draws.
 *
 * **`[Copy] [Wrap]` (story p3-10).** The spec's ASCII diagram shows both controls (L336), and
 * task 3.10's AC makes the Wrap half mandatory, so the p2-07 note that recorded it as "not
 * shipped" is superseded: `react-json-view-lite` does wrap unconditionally, but the wrapping is
 * the container class this file already owns — so the toggle swaps
 * `whitespace-pre-wrap break-words overflow-x-hidden` for `whitespace-pre overflow-x-auto`, i.e.
 * wrapped text versus a horizontal scrollbar. It is a real control, not a disabled one.
 *
 * **One right rail, two tabs (story p6-08, spec L417-421).** This `<aside>` *is* the rail the
 * evidence panel shares: the spec's own reason is that "the JSON side panel above already owns the
 * 400px right rail, and the form plus two rails does not fit at the 1280px desktop breakpoint", so
 * the rail carries an `Evidence │ JSON` tab strip instead of two panels competing for the space.
 * The tabs are **opt-in** (`tab` / `onTabChange` / `children`): the quest detail page passes them,
 * the Phase-4 generic detail layout does not, and a host that omits them gets today's JSON-only
 * panel with the same classes, the same DOM shape and the same accessible name. The header's `{ }`
 * toggle opens the rail on the JSON tab and the header's evidence affordance opens it on
 * `Evidence` — one rail, one `<aside>`, one set of width classes (`tests/ui/responsive.spec.ts`
 * still measures this element).
 */

/**
 * The library's Solarized-dark container colour replaced with the app's own
 * surfaces (`zinc-950` well, mono) — the syntax colours of `darkStyles`
 * are kept. The `style` prop is a map of class-name strings, so this is a class
 * merge, not a theme fork.
 *
 * The two wrap states are the only difference between them: the library's own CSS wraps, and
 * `whitespace-pre-wrap` + `break-words` on a container of a fixed 400px is what "wrapped" means
 * here, while `whitespace-pre` is what lets the panel's scroll container scroll sideways.
 */
function jsonContainerClass(wrap: boolean): string {
  return [
    'bg-zinc-950 p-3 font-mono text-xs leading-relaxed',
    wrap ? 'overflow-x-hidden whitespace-pre-wrap break-words' : 'overflow-x-auto whitespace-pre',
  ].join(' ');
}

/** The document this panel draws: a fetched quest, or the editor's live one. */
export type QuestJsonData = unknown;

/** Copies the document's pretty-printed JSON, reporting either outcome as a toast. */
async function copyQuestJson(quest: QuestJsonData): Promise<void> {
  try {
    await navigator.clipboard.writeText(JSON.stringify(quest, null, 2));
    notifySuccess(JSON_COPIED_MESSAGE);
  } catch {
    notifyError(JSON_COPY_ERROR);
  }
}

/**
 * The two Solarized syntax colours that fail WCAG AA on **this panel's** `zinc-950` well, and
 * their measured replacements (story p5-07's automated scan, `tests/ui/a11y.spec.ts`).
 *
 * `darkStyles` is tuned for the library's own container background `rgb(0, 43, 54)`; the app
 * swaps that for `zinc-950` (`#09090b`, `jsonContainerClass` above), which darkens the
 * background and drops two of the seven syntax colours under the 4.5:1 text floor:
 *
 * | syntax colour | library value | on `#09090b` | replacement | on `#09090b` |
 * |---|---|---|---|---|
 * | string value | `rgb(203, 75, 22)` | **4.32:1** ✗ | `orange-300` `#fdba74` | 11.79:1 ✓ |
 * | number value | `rgb(211, 54, 130)` | **4.38:1** ✗ | `pink-300` `#f9a8d4` | 10.97:1 ✓ |
 *
 * The other five (label/punctuation `18.44`, null `8.66`, boolean `7.00`, other `5.41`) pass
 * and stay the library's. Each entry **replaces** the library class rather than appending to it,
 * so there is no stylesheet-order question about which colour wins — and a Tailwind bump that
 * failed to emit these two utilities could only fall back to the container's light `foreground`,
 * never silently back to the failing Solarized values.
 */
const SYNTAX_OVERRIDES: NonNullable<JsonViewProps['style']> = {
  stringValue: 'text-orange-300',
  numberValue: 'text-pink-300',
};

/** The syntax-highlighted tree: top level expanded, nested nodes collapsed. */
function QuestJsonTree({ quest, wrap }: { quest: QuestJsonData; wrap: boolean }): JSX.Element {
  // The library's own `data` type is a JSON union; `unknown` is the honest input
  // here because the document has not been validated by this component.
  const style: NonNullable<JsonViewProps['style']> = {
    ...darkStyles,
    ...SYNTAX_OVERRIDES,
    container: jsonContainerClass(wrap),
  };
  return (
    <JsonView
      data={quest as JsonViewProps['data']}
      style={style}
      shouldExpandNode={collapseAllNested}
    />
  );
}

/** The panel's own toolbar: the `{ }` mark and the spec's `[Copy] [Wrap]`. */
function QuestJsonToolbar({
  quest,
  wrap,
  onToggleWrap,
  className,
}: {
  quest: QuestJsonData;
  wrap: boolean;
  onToggleWrap: () => void;
  className?: string;
}): JSX.Element {
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      <span className="font-mono text-xs text-zinc-400" aria-hidden="true">
        {JSON_PANEL_GLYPH}
      </span>
      <div className="flex items-center gap-2">
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
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-pressed={wrap}
          title={wrap ? JSON_WRAP_ON_TOOLTIP : JSON_WRAP_OFF_TOOLTIP}
          onClick={onToggleWrap}
        >
          {JSON_WRAP_LABEL}
        </Button>
      </div>
    </div>
  );
}

/** The scrolling body: the same element in both surfaces, tagged with its wrap state. */
function QuestJsonBody({ quest, wrap }: { quest: QuestJsonData; wrap: boolean }): JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-auto" data-wrap={wrap}>
      <QuestJsonTree quest={quest} wrap={wrap} />
    </div>
  );
}

export interface QuestJsonPanelProps {
  quest: QuestJsonData;
  className?: string;
  /**
   * The panel's accessible name. Defaults to the quest copy
   * ({@link JSON_PANEL_TITLE}); task 4.1's generic detail layout passes
   * `` `${label} JSON` `` so an NPC inventory's panel does not claim to be a quest's.
   * The component renders any document either way — only this name differs.
   */
  title?: string;
  /**
   * The rail's active tab (story p6-08's `Evidence │ JSON` rail, spec L417-421). Omitted — the
   * Phase-4 hosts — renders exactly the JSON-only panel they already mount: no tab strip, no
   * second body, the same classes and the same accessible name.
   */
  tab?: QuestRailTab;
  /** Selects a tab; required for the strip to render at all. */
  onTabChange?: (tab: QuestRailTab) => void;
  /**
   * The **Evidence** tab's body (the quest detail page passes its `EvidencePanel`). Rendered
   * instead of the JSON toolbar + tree when {@link tab} is `'evidence'`.
   */
  children?: ReactNode;
}

/** The rail's two tabs, in the spec's order. */
const RAIL_TABS: readonly QuestRailTab[] = ['evidence', 'json'];

/**
 * The `Evidence │ JSON` tab strip (spec L417-421) — the rail is one `<aside>` carrying two tabs
 * rather than two panels competing for the same 400px, because the form plus two rails does not fit
 * at the 1280px breakpoint.
 *
 * It is a real APG tablist: `role="tablist"`/`role="tab"`/`aria-selected`, automatic activation, and
 * the Arrow/Home/End keys through `lib/tablist.ts`'s one rule — the same model `QuestPreview` and
 * the list pages' filter tabs already implement (plan task 5.5 AC#8).
 */
function QuestRailTabs({
  tab,
  onTabChange,
  panelId,
}: {
  tab: QuestRailTab;
  onTabChange: (tab: QuestRailTab) => void;
  panelId: string;
}): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label={QUEST_RAIL_TABLIST_LABEL}
      className="flex items-center gap-1 border-b border-zinc-800 px-3 pt-2"
    >
      {RAIL_TABS.map((name, index) => {
        const selected = name === tab;
        const domId = `${panelId}-tab-${name}`;
        return (
          <button
            key={name}
            type="button"
            role="tab"
            id={domId}
            aria-selected={selected}
            aria-controls={`${panelId}-panel-${name}`}
            onClick={() => onTabChange(name)}
            onKeyDown={(event) => {
              const next = nextTabIndex(event.key, index, RAIL_TABS.length);
              if (next === null) {
                return;
              }
              event.preventDefault();
              const target = RAIL_TABS[next] ?? name;
              onTabChange(target);
              document.getElementById(`${panelId}-tab-${target}`)?.focus();
            }}
            className={cn(
              'border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
              selected
                ? 'border-blue-500 font-medium text-zinc-50'
                : 'border-transparent text-zinc-400 hover:text-zinc-200',
            )}
          >
            {name === 'evidence' ? EVIDENCE_TAB_LABEL : JSON_TAB_LABEL}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The rail body for the active tab: the caller's evidence body, or the JSON toolbar + tree.
 *
 * With the tab strip (`panelId` set) the body is a real `tabpanel` whose id pairs with the tab's
 * `aria-controls`/`aria-labelledby`. Without it — the Phase-4 hosts, which mount a JSON-only panel —
 * the JSON is rendered **directly** rather than inside an orphan `tabpanel` role, which is what
 * keeps those hosts' DOM and their specs unchanged.
 */
function QuestRailBody({
  tab,
  panelId,
  quest,
  wrap,
  onToggleWrap,
  children,
}: {
  tab: QuestRailTab;
  panelId: string | null;
  quest: QuestJsonData;
  wrap: boolean;
  onToggleWrap: () => void;
  children?: ReactNode;
}): JSX.Element {
  const json = (
    <>
      <QuestJsonToolbar
        quest={quest}
        wrap={wrap}
        onToggleWrap={onToggleWrap}
        className="border-b border-zinc-800 px-3 py-2"
      />
      <QuestJsonBody quest={quest} wrap={wrap} />
    </>
  );
  if (panelId === null) {
    return <>{json}</>;
  }
  return (
    <div
      role="tabpanel"
      id={`${panelId}-panel-${tab}`}
      aria-labelledby={`${panelId}-tab-${tab}`}
      className="flex min-h-0 flex-1 flex-col"
    >
      {tab === 'evidence' ? (children ?? null) : json}
    </div>
  );
}

/**
 * The desktop side panel: **300px on tablet (768–1279px), 400px on desktop (≥1280px)** —
 * `docs/spec-ui-design.md` L518-520.
 *
 * Story p5-06 replaced the single inline `width: JSON_PANEL_WIDTH_PX` (400 at every width above
 * `md`) with these two classes, because the width is a breakpoint rule and Tailwind's `xl` is
 * exactly the spec's 1280px desktop line. The two numbers' home of record is
 * `lib/quests.ts`'s `JSON_PANEL_TABLET_WIDTH_PX` / `JSON_PANEL_WIDTH_PX`, and
 * `tests/ui/responsive.spec.ts` asserts the rendered box against both at both tiers.
 */
export function QuestJsonPanel({
  quest,
  className,
  title,
  tab,
  onTabChange,
  children,
}: QuestJsonPanelProps): JSX.Element {
  const [wrap, setWrap] = useState(true);
  const panelId = useId();
  const active: QuestRailTab = tab ?? 'json';
  const withTabs = tab !== undefined && onTabChange !== undefined;
  return (
    <aside
      aria-label={title ?? (active === 'evidence' ? EVIDENCE_PANEL_TITLE : JSON_PANEL_TITLE)}
      className={cn(
        'flex w-[300px] shrink-0 animate-in flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 duration-200 slide-in-from-right xl:w-[400px]',
        className,
      )}
    >
      {withTabs ? <QuestRailTabs tab={active} onTabChange={onTabChange} panelId={panelId} /> : null}
      <QuestRailBody
        tab={active}
        panelId={withTabs ? panelId : null}
        quest={quest}
        wrap={wrap}
        onToggleWrap={() => setWrap((current) => !current)}
      >
        {children}
      </QuestRailBody>
    </aside>
  );
}

export interface QuestJsonOverlayProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quest: QuestJsonData;
  /** The dialog's title; defaults to {@link JSON_PANEL_TITLE}. See {@link QuestJsonPanelProps.title}. */
  title?: string;
  /** The dialog's visually hidden description; defaults to the quest wording. */
  description?: string;
  /** The active tab (see {@link QuestJsonPanelProps.tab}) — the mobile overlay is the same rail. */
  tab?: QuestRailTab;
  /** Selects a tab; omitted by the Phase-4 hosts, which get the JSON-only overlay. */
  onTabChange?: (tab: QuestRailTab) => void;
  /** The **Evidence** tab's body. */
  children?: ReactNode;
}

/** The mobile full-screen overlay (< 768px) carrying the same tabs, toolbar and tree. */
export function QuestJsonOverlay({
  open,
  onOpenChange,
  quest,
  title,
  description,
  tab,
  onTabChange,
  children,
}: QuestJsonOverlayProps): JSX.Element {
  const [wrap, setWrap] = useState(true);
  const panelId = useId();
  const active: QuestRailTab = tab ?? 'json';
  const withTabs = tab !== undefined && onTabChange !== undefined;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="inset-0 flex h-full w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 sm:rounded-none">
        <DialogHeader className="border-b border-zinc-800 p-3 pr-12">
          <DialogTitle className="font-mono text-sm font-semibold text-zinc-50">
            {title ?? (active === 'evidence' ? EVIDENCE_PANEL_TITLE : JSON_PANEL_TITLE)}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {description ?? 'Read-only JSON of this quest.'}
          </DialogDescription>
        </DialogHeader>
        {withTabs ? (
          <QuestRailTabs tab={active} onTabChange={onTabChange} panelId={panelId} />
        ) : null}
        <QuestRailBody
          tab={active}
          panelId={withTabs ? panelId : null}
          quest={quest}
          wrap={wrap}
          onToggleWrap={() => setWrap((current) => !current)}
        >
          {children}
        </QuestRailBody>
      </DialogContent>
    </Dialog>
  );
}
