import type { QuestDocumentState } from '../../hooks/useQuestDocument';
import { goalName, NO_GOALS_TEXT } from '../../lib/quest-goals';
import {
  ACTIVATE_RESULTS_PATH,
  COMPLETE_RESULTS_PATH,
  END_RESULTS_PATH,
  START_RESULTS_PATH,
  TALLY_COUNTER_PATH,
  TALLY_RESULTS_PATH,
} from '../../lib/quest-results';
import ResultListEditor from '../shared/ResultListEditor';
import TermLabel from '../TermLabel';

/**
 * `QuestResultsEditor` — the Results tab's body (plan task 3.7, story p3-07;
 * docs/spec-ui-design.md L320).
 *
 * It is a **thin host**: every wrapper mounts the shared {@link ResultListEditor} with
 * nothing but a document path, which is the whole argument for that component living in
 * `components/shared/`.
 *
 * **Placement, decided from the existing owner labels rather than invented.** All four of
 * the corpus's quest-level and goal-level result homes are already labelled `Results` by
 * the shipped field inventories — `lib/quest-info.ts` L192-193 owns `m_startResults` /
 * `m_endResults`, and `lib/quest-goals.ts` L405/L410 owns `m_completeResults` /
 * `m_activateResults` — so this tab mounts five wrappers and no owner label is left false:
 *
 * | slot | path | owner label it satisfies | measured corpus |
 * |---|---|---|---|
 * | `m_startResults` | `['m_startResults']` | `lib/quest-info.ts` L192 | `m_results` empty in **321 of 322** quests |
 * | `m_endResults` | `['m_endResults']` | `lib/quest-info.ts` L193 | non-empty in **316 of 322** quests (331 nodes) |
 * | `m_completeResults` (per goal) | `['m_goals', i, 'm_completeResults']` | `lib/quest-goals.ts` L405 | empty in **747 of 772** goals (45 nodes) |
 * | `m_activateResults` (per goal) | `['m_goals', i, 'm_activateResults']` | `lib/quest-goals.ts` L410 | empty in **771 of 772** goals (1 node) |
 * | `m_tallyResults` (per goal) | `['m_goals', i, 'm_tallyCounter', 'm_tallyResults']` | `lib/quest-goals.ts` L405-410's sibling — D60(d) names task 3.7 as its owner | present and empty in **all 18** goals that carry a tally counter |
 *
 * The fifth row is the one addition beyond the story's four homes, and it is deliberate:
 * D60(d) recorded that `m_tallyCounter.m_tallyResults` is a results container **task 3.7
 * owns** ("if 3.7 does not pick it up it stays a documented gap"), so picking it up keeps
 * the ownership claim true instead of leaving it a gap. It is mounted **only for a goal
 * whose `m_tallyCounter` is an object** (18 of the 772) — the other 754 carry
 * `m_tallyCounter: null`, and mounting a tree under a `null` parent would offer controls
 * whose first write the document primitives must reject (they never invent an intermediate
 * object). Those 754 goals state that fact in the panel instead.
 *
 * Nothing in this file writes: the panel only decides which paths are mounted and what each
 * one is called, and every list writes nothing until the user acts (D57).
 */
export interface QuestResultsEditorProps {
  /** The live document + its mutations (`useQuestDocument`). */
  state: QuestDocumentState;
  /** Present for symmetry with the other live panels; a result list has no timestamp row. */
  modifiedAt?: string | null;
}

/** The panel's accessible name (the tier-1 spec scopes to it). */
export const RESULTS_EDITOR_LABEL = 'Quest results editor';

/** The two quest-level wrappers' accessible names. */
export const START_RESULTS_LABEL = 'Start results';
export const END_RESULTS_LABEL = 'End results';

/** The per-goal section's accessible name (each goal's lists are named after the goal). */
export const GOAL_RESULTS_SECTION_LABEL = 'Goal results';

/** The measured presence notes — the honest corpus coverage, not a promise. */
export const START_RESULTS_NOTE = 'm_results is empty in 321 of the 322 corpus quests.';
export const END_RESULTS_NOTE =
  'm_results holds results in 316 of the 322 corpus quests (331 nodes, all ResDropTable-heavy).';
export const GOAL_RESULTS_NOTE =
  'm_completeResults is empty in 747 of the 772 corpus goals (45 nodes in 25 goals); ' +
  'm_activateResults is empty in 771 (1 node).';
export const TALLY_RESULTS_NOTE =
  'm_tallyResults is present and empty in all 18 goals that carry a tally counter.';
export const NO_TALLY_COUNTER_NOTE =
  'No tally counter on this goal (m_tallyCounter is null in 754 of the 772), so there is no ' +
  'm_tallyResults slot to edit.';

export default function QuestResultsEditor({ state }: QuestResultsEditorProps): JSX.Element {
  const goalsValue = state.value(['m_goals']);
  const goals = Array.isArray(goalsValue) ? goalsValue : [];

  return (
    <section aria-label={RESULTS_EDITOR_LABEL} className="flex flex-col gap-6">
      <Slot
        state={state}
        fieldKey={START_RESULTS_PATH}
        path={[START_RESULTS_PATH]}
        label={START_RESULTS_LABEL}
        note={START_RESULTS_NOTE}
      />
      <Slot
        state={state}
        fieldKey={END_RESULTS_PATH}
        path={[END_RESULTS_PATH]}
        label={END_RESULTS_LABEL}
        note={END_RESULTS_NOTE}
      />

      <section aria-label={GOAL_RESULTS_SECTION_LABEL} className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2
            className="text-xs text-zinc-400"
            data-path={`m_goals[].${COMPLETE_RESULTS_PATH} / m_goals[].${ACTIVATE_RESULTS_PATH}`}
          >
            <TermLabel term={{ field: COMPLETE_RESULTS_PATH }} /> /{' '}
            <TermLabel term={{ field: ACTIVATE_RESULTS_PATH }} />
          </h2>
          <p className="text-xs text-zinc-400">{GOAL_RESULTS_NOTE}</p>
        </div>
        {goals.length === 0 ? (
          <p className="text-sm text-zinc-400">{NO_GOALS_TEXT}</p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-6">
            {goals.map((goal, index) => {
              const name = goalName(goal) ?? `Goal ${index + 1}`;
              const tally = state.value(['m_goals', index, TALLY_COUNTER_PATH]);
              const hasTallyCounter = isPlainObject(tally);
              return (
                <li key={`m_goals:${index}`} className="flex min-w-0 flex-col gap-4">
                  <h3 className="font-mono text-xs text-zinc-300">{name}</h3>
                  <ResultListEditor
                    state={state}
                    path={['m_goals', index, COMPLETE_RESULTS_PATH]}
                    label={`Complete results for ${name}`}
                  />
                  <ResultListEditor
                    state={state}
                    path={['m_goals', index, ACTIVATE_RESULTS_PATH]}
                    label={`Activate results for ${name}`}
                  />
                  {hasTallyCounter ? (
                    <div className="flex min-w-0 flex-col gap-2">
                      <p className="text-xs text-zinc-400">{TALLY_RESULTS_NOTE}</p>
                      <ResultListEditor
                        state={state}
                        path={['m_goals', index, TALLY_COUNTER_PATH, TALLY_RESULTS_PATH]}
                        label={`Tally results for ${name}`}
                      />
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-400">{NO_TALLY_COUNTER_NOTE}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}

/** One quest-level wrapper: its mono key, its honest corpus note, and the shared list. */
function Slot({
  state,
  fieldKey,
  path,
  label,
  note,
}: {
  state: QuestDocumentState;
  fieldKey: string;
  path: readonly string[];
  label: string;
  note: string;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h2 className="text-xs text-zinc-400">
          <TermLabel term={{ field: fieldKey }} />
        </h2>
        <p className="text-xs text-zinc-400">{note}</p>
      </div>
      <ResultListEditor state={state} path={path} label={label} />
    </div>
  );
}

/** `true` for a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
