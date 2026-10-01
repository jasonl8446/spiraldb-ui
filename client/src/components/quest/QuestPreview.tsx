import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react';

import type { TermRef } from '@shared/glossary';

import type { QuestObject } from '../../lib/api';
import {
  goalCount,
  PREVIEW_TABS,
  primitiveFields,
  shortTypeName,
  type PreviewTab,
} from '../../lib/extract';
import { goalCardTitle, NO_CARD_NAMES } from '../../lib/card-titles';
import { nextTabIndex } from '../../lib/tablist';
import { termText, valueTermOf } from '../../lib/term';
import { cn } from '../../lib/utils';
import TermLabel from '../TermLabel';
import { Badge } from '../ui/badge';

/**
 * `QuestPreview` — the read-only tabbed preview of one extracted quest
 * (plan task 2.6, docs/spec-ui-design.md L226, L274-340).
 *
 * **Prop-driven and fetch-free by contract**: it takes the quest object and
 * renders it. The extraction page needs it for the results pane, the mobile
 * overlay needs it again, and p2-08's detail page needs the same six tabs — so
 * nothing here may reach the network, and the caller decides the frame (pane or
 * dialog).
 *
 * The six tabs are the Phase 3 edit view's own (`Info / Goals / Goal Logic /
 * Requirements / Results / Dialog`), rendered non-editable. `Goal Logic` shows
 * the structured entries rather than a flowchart — the flowchart is Phase 3
 * (plan task 2.7 says the same for the detail page).
 *
 * Untrusted input: the object arrives from the CLI and is *not* schema-validated
 * here, so every reader tolerates a missing or wrongly-typed field instead of
 * throwing (see `lib/extract.ts`).
 */
export interface QuestPreviewProps {
  quest: QuestObject;
  className?: string;
  /**
   * Replaces any tab's read-only body with a live editor (plan task 3.3/3.4, stories
   * p3-03/p3-04).
   *
   * The extraction page and the mobile overlay pass nothing, so they keep the read-only
   * tabs the Phase-2 specs pin; the detail page passes `{ Info, Goals }`. A **map** rather
   * than one prop per tab (p3-03 shipped `infoPanel`) because p3-05..p3-08 each add their
   * own entry: a missing key falls back to that tab's read-only body, so a caller never
   * has to know the tab list.
   */
  panels?: Partial<Record<QuestTab, ReactNode>>;
}

/**
 * A tab of the quest detail page: the extraction preview's six plus the Overview (task 7.13, D133),
 * which exists only where a caller supplies its panel — the detail page, in view and edit mode —
 * and is then the first tab and the landing tab.
 */
export type QuestTab = 'Overview' | PreviewTab;

/**
 * How a panel asks this component to switch tabs.
 *
 * A tab's editor sometimes has to hand the user to another tab — the Goal Logic flowchart's
 * `Edit Goal` context item means "open the Goals tab, that is where a goal's fields live"
 * (story p3-05) — and the tab state is `QuestPreview`'s own. The context is the smallest
 * channel that does not add a second tab state or a second document: the provider wraps the
 * panel and the value is `useState`'s own stable setter. `null` outside a preview, so a panel
 * rendered on its own (a unit-style render, a future reuse) degrades to doing nothing rather
 * than throwing.
 */
export const PreviewTabSelectContext = createContext<((tab: QuestTab) => void) | null>(null);

/** The tab switch, or `null` when no preview is above this panel. */
export function usePreviewTabSelect(): ((tab: QuestTab) => void) | null {
  return useContext(PreviewTabSelectContext);
}

/**
 * The DOM id of one tab button — the panel's `useId` plus the tab name with its whitespace
 * replaced by a hyphen.
 *
 * The replacement is **load-bearing, not cosmetic**. `Goal Logic` is the one two-word tab, and
 * an HTML `id` must not contain a space — while `aria-labelledby` is a *space-separated list of
 * ids*. The un-slugged form produced `id=":r1:-tab-Goal Logic"` and a tabpanel labelled
 * `aria-labelledby=":r1:-tab-Goal Logic"`, which a browser parses as **two** ids
 * (`:r1:-tab-Goal` and `Logic`), neither of which exists — so that pane had no accessible name
 * at all. axe reports exactly that as the `aria-valid-attr-value` "element ID does not exist"
 * *incomplete* (`tests/ui/a11y.spec.ts`, the `quest-detail:Goal Logic` arm). Both the `id` and
 * every lookup go through this one function, so the two can never drift.
 */
function tabDomId(panelId: string, name: QuestTab): string {
  return `${panelId}-tab-${name.replace(/\s+/g, '-')}`;
}

export default function QuestPreview({ quest, className, panels }: QuestPreviewProps): JSX.Element {
  const tabs: readonly QuestTab[] =
    panels?.Overview === undefined ? PREVIEW_TABS : ['Overview', ...PREVIEW_TABS];
  const [tab, setTab] = useState<QuestTab>(tabs[0]);
  const panelId = useId();

  // A new quest starts on its first tab (Overview where there is one, else Info), so the pane
  // never shows a stale section of the previous quest while appearing to describe this one.
  useEffect(() => {
    setTab(tabs[0]);
  }, [quest]);

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div
        role="tablist"
        aria-label="Quest preview sections"
        className="flex flex-wrap gap-1 border-b border-zinc-800 px-3 pt-2"
      >
        {tabs.map((name, index) => {
          const selected = name === tab;
          return (
            <button
              key={name}
              type="button"
              role="tab"
              id={tabDomId(panelId, name)}
              aria-selected={selected}
              aria-controls={`${panelId}-panel`}
              onClick={() => setTab(name)}
              // APG tablist keys, the same automatic activation the click performs; the
              // rule is shared with the list pages' filter tabs (`lib/tablist.ts`).
              onKeyDown={(event) => {
                const next = nextTabIndex(event.key, index, tabs.length);
                if (next === null) {
                  return;
                }
                event.preventDefault();
                const target = tabs[next];
                setTab(target);
                document.getElementById(tabDomId(panelId, target))?.focus();
              }}
              className={cn(
                'border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
                selected
                  ? 'border-blue-500 font-medium text-zinc-50'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200',
              )}
            >
              {name}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${panelId}-panel`}
        aria-labelledby={tabDomId(panelId, tab)}
        className="min-h-0 flex-1 overflow-y-auto p-4"
      >
        <PreviewTabSelectContext.Provider value={setTab}>
          {renderPanel(tab, quest, panels)}
        </PreviewTabSelectContext.Provider>
      </div>
    </div>
  );
}

/**
 * One tab's body. Kept as a plain function so no tab pays for the others' hooks —
 * and so a tab with a caller-supplied editor renders it instead of the read-only list.
 * A tab absent from {@link QuestPreviewProps.panels} gets its own p2-07 body.
 */
function renderPanel(
  tab: QuestTab,
  quest: QuestObject,
  panels?: Partial<Record<QuestTab, ReactNode>>,
): JSX.Element {
  const editor = panels?.[tab];
  if (editor !== undefined) {
    return <>{editor}</>;
  }
  switch (tab) {
    case 'Overview':
      // Only reachable when a caller supplies the panel; nothing here reads the network.
      return <Empty text="No overview." />;
    case 'Info':
      return <InfoPanel quest={quest} />;
    case 'Goals':
      return <GoalsPanel quest={quest} />;
    case 'Goal Logic':
      return <GoalLogicPanel quest={quest} />;
    case 'Requirements':
      return <RequirementsPanel quest={quest} />;
    case 'Results':
      return <ResultsPanel quest={quest} />;
    case 'Dialog':
      return <DialogPanel quest={quest} />;
  }
}

function InfoPanel({ quest }: { quest: QuestObject }): JSX.Element {
  const fields: FieldRow[] = [
    ['m_goals', String(goalCount(quest)), '(count)'],
    ...primitiveFields(quest),
  ];
  return (
    <section aria-label="Quest info">
      <FieldList fields={fields} />
    </section>
  );
}

function GoalsPanel({ quest }: { quest: QuestObject }): JSX.Element {
  const goals = arrayOf(quest.m_goals);
  if (goals.length === 0) {
    return <Empty text="This quest defines no goals." />;
  }
  return (
    <section aria-label="Quest goals" className="flex flex-col gap-3">
      {goals.map((goal, index) => (
        <article key={index} className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
          <header className="mb-2 flex flex-wrap items-center gap-2">
            {/* Fetch-free by contract: no resolved names, so a title falls back as far as it must. */}
            <span className="text-sm font-medium text-zinc-100">
              {goalCardTitle(goal, NO_CARD_NAMES)}
            </span>
            <span className="font-mono text-xs text-zinc-400">
              {fieldText(goal, 'm_goalName') ?? `Goal ${index + 1}`}
            </span>
            <GoalTypeBadge goal={goal} />
          </header>
          <FieldList fields={primitiveFields(goal)} />
        </article>
      ))}
    </section>
  );
}

function GoalTypeBadge({ goal }: { goal: unknown }): JSX.Element | null {
  const typeString = fieldText(goal, '$type');
  const goalType = fieldText(goal, 'm_goalType');
  const term: TermRef | null =
    typeString !== null && shortTypeName(typeString) !== null
      ? { type: typeString }
      : goalType === null
        ? null
        : { enum: 'GoalType', value: goalType };
  return term === null ? null : (
    <Badge variant="outline">
      <TermLabel term={term} />
    </Badge>
  );
}

function GoalLogicPanel({ quest }: { quest: QuestObject }): JSX.Element {
  const entries = arrayOf(quest.m_goalLogic);
  if (entries.length === 0) {
    return <Empty text="This quest has no goal logic entries." />;
  }
  return (
    <section aria-label="Goal logic" className="flex flex-col gap-3">
      {entries.map((entry, index) => (
        <article key={index} className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
          <header className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-sm text-zinc-100">Entry {index + 1}</span>
            {fieldText(entry, 'm_completeQuest') === 'true' ? (
              <Badge variant="success">completes quest</Badge>
            ) : null}
          </header>
          <FieldList fields={primitiveFields(entry)} />
        </article>
      ))}
    </section>
  );
}

function RequirementsPanel({ quest }: { quest: QuestObject }): JSX.Element {
  return (
    <section aria-label="Requirements" className="flex flex-col gap-4">
      <p className="text-xs text-zinc-400">
        Read-only JSON — this preview is the extraction page's; the structured requirement tree is
        edited in the Requirements tab of the quest detail page.
      </p>
      <JsonBlock fieldKey="m_requirements" value={quest.m_requirements} />
      <JsonBlock fieldKey="m_prepRequirements" value={quest.m_prepRequirements} />
      <JsonBlock fieldKey="m_pruneRequirements" value={quest.m_pruneRequirements} />
    </section>
  );
}

function ResultsPanel({ quest }: { quest: QuestObject }): JSX.Element {
  const endResults = arrayOf(nested(quest.m_endResults, 'm_results'));
  return (
    <section aria-label="Results" className="flex flex-col gap-4">
      <p className="text-xs text-zinc-400">
        Read-only JSON — this preview is the extraction page's; the structured result editor is in
        the Results tab of the quest detail page.
      </p>
      {endResults.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {endResults.map((result, index) => (
            <li key={index}>
              <Badge variant="secondary">
                {typeof nested(result, '$type') === 'string' &&
                shortTypeName(nested(result, '$type')) !== null ? (
                  <TermLabel term={{ type: nested(result, '$type') as string }} />
                ) : (
                  `Result ${index + 1}`
                )}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      <JsonBlock fieldKey="m_startResults" value={quest.m_startResults} />
      <JsonBlock fieldKey="m_endResults" value={quest.m_endResults} />
    </section>
  );
}

function DialogPanel({ quest }: { quest: QuestObject }): JSX.Element {
  return (
    <section aria-label="Dialog" className="flex flex-col gap-4">
      <p className="text-xs text-zinc-400">
        Read-only JSON — this preview is the extraction page’s; the structured dialog editor is in
        the Dialog tab of the quest detail page.
      </p>
      <JsonBlock fieldKey="m_dialogList" value={quest.m_dialogList} />
    </section>
  );
}

function Empty({ text }: { text: string }): JSX.Element {
  return <p className="text-sm text-zinc-400">{text}</p>;
}

/** One row of a {@link FieldList}: the document key, its display value and an optional note. */
type FieldRow = [key: string, value: string, note?: string];

/**
 * A definition list of primitive fields; never renders `[object Object]`. Each key renders as its
 * glossary pair (task 7.9), and so does a value that is a class or an enum literal.
 */
function FieldList({ fields }: { fields: FieldRow[] }): JSX.Element {
  if (fields.length === 0) {
    return <p className="text-sm text-zinc-400">No scalar fields.</p>;
  }
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {fields.map(([key, value, note]) => {
        const term = valueTermOf(key, value);
        return (
          <div key={key} className="min-w-0">
            <dt className="text-xs text-zinc-400">
              <TermLabel term={{ field: key }} />
              {note === undefined ? null : ` ${note}`}
            </dt>
            <dd
              className="truncate text-sm text-zinc-200"
              title={term === null ? value : termText(term)}
            >
              {term === null ? value : <TermLabel term={term} />}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** A labelled read-only JSON block — the honest fallback for the Phase 3 editors. */
function JsonBlock({ fieldKey, value }: { fieldKey: string; value: unknown }): JSX.Element {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs text-zinc-400">
        <TermLabel term={{ field: fieldKey }} />
      </p>
      <pre className="max-h-72 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-300">
        {value === undefined ? 'undefined' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/* ------------------------------------------------- untrusted-object readers */

/** `value` as an array, or `[]`. */
function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** `container[key]` — `undefined` for a non-object container. */
function nested(container: unknown, key: string): unknown {
  if (typeof container !== 'object' || container === null) {
    return undefined;
  }
  return (container as Record<string, unknown>)[key];
}

/** A primitive `container[key]` as text, or `null`. */
function fieldText(container: unknown, key: string): string | null {
  const value = nested(container, key);
  if (typeof value === 'string' && value.trim() !== '') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}
