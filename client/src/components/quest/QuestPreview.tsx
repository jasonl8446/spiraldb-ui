import { useEffect, useId, useState } from 'react';

import type { QuestObject } from '../../lib/api';
import {
  goalCount,
  PREVIEW_TABS,
  primitiveFields,
  shortTypeName,
  type PreviewTab,
} from '../../lib/extract';
import { cn } from '../../lib/utils';
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
}

export default function QuestPreview({ quest, className }: QuestPreviewProps): JSX.Element {
  const [tab, setTab] = useState<PreviewTab>('Info');
  const panelId = useId();

  // A new quest starts on Info, so the pane never shows a stale section of the
  // previous quest while appearing to describe this one.
  useEffect(() => {
    setTab('Info');
  }, [quest]);

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div
        role="tablist"
        aria-label="Quest preview sections"
        className="flex flex-wrap gap-1 border-b border-zinc-800 px-3 pt-2"
      >
        {PREVIEW_TABS.map((name) => {
          const selected = name === tab;
          return (
            <button
              key={name}
              type="button"
              role="tab"
              id={`${panelId}-tab-${name}`}
              aria-selected={selected}
              aria-controls={`${panelId}-panel`}
              onClick={() => setTab(name)}
              className={cn(
                'border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
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
        aria-labelledby={`${panelId}-tab-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto p-4"
      >
        {renderPanel(tab, quest)}
      </div>
    </div>
  );
}

/** One tab's body. Kept as a plain function so no tab pays for the others' hooks. */
function renderPanel(tab: PreviewTab, quest: QuestObject): JSX.Element {
  switch (tab) {
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
  const fields: Array<[string, string]> = [
    ['m_goals (count)', String(goalCount(quest))],
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
            <span className="font-mono text-sm text-zinc-100">
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
  const type = shortTypeName(fieldText(goal, '$type')) ?? fieldText(goal, 'm_goalType');
  return type === null ? null : <Badge variant="outline">{type}</Badge>;
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
      <p className="text-xs text-zinc-500">
        Read-only JSON — the structured requirement tree arrives with the Phase 3 editor.
      </p>
      <JsonBlock label="m_requirements" value={quest.m_requirements} />
      <JsonBlock label="m_prepRequirements" value={quest.m_prepRequirements} />
      <JsonBlock label="m_pruneRequirements" value={quest.m_pruneRequirements} />
    </section>
  );
}

function ResultsPanel({ quest }: { quest: QuestObject }): JSX.Element {
  const endResults = arrayOf(nested(quest.m_endResults, 'm_results'));
  return (
    <section aria-label="Results" className="flex flex-col gap-4">
      {endResults.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {endResults.map((result, index) => (
            <li key={index}>
              <Badge variant="secondary">
                {shortTypeName(nested(result, '$type')) ?? `Result ${index + 1}`}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      <JsonBlock label="m_startResults" value={quest.m_startResults} />
      <JsonBlock label="m_endResults" value={quest.m_endResults} />
    </section>
  );
}

function DialogPanel({ quest }: { quest: QuestObject }): JSX.Element {
  return (
    <section aria-label="Dialog" className="flex flex-col gap-4">
      <p className="text-xs text-zinc-500">
        Read-only JSON — the full dialog editor arrives in Phase 3.
      </p>
      <JsonBlock label="m_dialogList" value={quest.m_dialogList} />
    </section>
  );
}

function Empty({ text }: { text: string }): JSX.Element {
  return <p className="text-sm text-zinc-500">{text}</p>;
}

/** A definition list of primitive fields; never renders `[object Object]`. */
function FieldList({ fields }: { fields: Array<[string, string]> }): JSX.Element {
  if (fields.length === 0) {
    return <p className="text-sm text-zinc-500">No scalar fields.</p>;
  }
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {fields.map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="font-mono text-xs text-zinc-500">{key}</dt>
          <dd className="truncate text-sm text-zinc-200" title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A labelled read-only JSON block — the honest fallback for the Phase 3 editors. */
function JsonBlock({ label, value }: { label: string; value: unknown }): JSX.Element {
  return (
    <div className="min-w-0">
      <p className="mb-1 font-mono text-xs text-zinc-500">{label}</p>
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
