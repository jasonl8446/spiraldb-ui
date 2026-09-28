import type { QuestDocumentState } from '../../hooks/useQuestDocument';
import { DIALOG_LIST_KEY } from '../../lib/quest-dialog';
import { goalName, NO_GOALS_TEXT } from '../../lib/quest-goals';
import DialogListEditor from '../shared/DialogListEditor';

/**
 * `QuestDialogEditor` — the Dialog tab's body (plan task 3.8, story p3-08;
 * docs/spec-ui-design.md L420-454).
 *
 * It is a **thin host**: both levels mount the shared {@link DialogListEditor} with nothing but
 * a document path, which is the whole argument for that component living in
 * `components/shared/`.
 *
 * **Placement, decided from the existing owner labels rather than invented.** Both homes are
 * already labelled `Dialog` by the shipped field inventories — `lib/quest-info.ts` L198 owns
 * the quest-level `m_dialogList` and `lib/quest-goals.ts` L409 owns the per-goal one — so this
 * tab mounts both and no owner label is left false:
 *
 * | slot | path | owner label it satisfies | measured corpus |
 * |---|---|---|---|
 * | quest `m_dialogList` | `['m_dialogList']` | `lib/quest-info.ts` L198 | present in **322/322** quests, `m_dialogs` empty in 7 |
 * | goal `m_dialogList` | `['m_goals', i, 'm_dialogList']` | `lib/quest-goals.ts` L409 | an object in **445 of 772** goals, an explicit `null` in 327, absent in 0; empty `m_dialogs` in 36 |
 *
 * The goal-level slot is mounted for **every** goal, including the 327 whose value is `null`:
 * unlike p3-07's tally slot (whose *parent* is `null`, so a write would be rejected by the
 * document primitives), a goal's `m_dialogList` sits directly under the goal object, so the
 * first *Add Dialog Tag* legally replaces the `null` with the corpus's own
 * `{$type, m_dialogs}` shape. Those goals get the honest absent-or-null sentence instead of a
 * silently missing section.
 *
 * Nothing in this file writes: the panel only decides which paths are mounted and what each one
 * is called, and every list writes nothing until the user acts (D57).
 */
export interface QuestDialogEditorProps {
  /** The live document + its mutations (`useQuestDocument`). */
  state: QuestDocumentState;
  /** Present for symmetry with the other live panels; a dialog list has no timestamp row. */
  modifiedAt?: string | null;
}

/** The panel's accessible name (the tier-1 spec scopes to it). */
export const DIALOG_EDITOR_LABEL = 'Quest dialog editor';

/** The quest-level wrapper's accessible name. */
export const QUEST_DIALOG_LIST_LABEL = 'Quest dialog list';

/** The per-goal section's accessible name (each goal's list is named after the goal). */
export const GOAL_DIALOG_SECTION_LABEL = 'Goal dialog lists';

/** The measured presence notes — the honest corpus coverage, not a promise. */
export const QUEST_DIALOG_NOTE =
  'm_dialogList is present in all 322 corpus quests (m_dialogs empty in 7); a tag group is ' +
  '{m_dialogTag, m_dialogEntries, m_madlibs, m_dialogEvents, m_noAggroWhileDialogIsUp, m_noAggroNoDelay}.';
export const GOAL_DIALOG_NOTE =
  'm_dialogList is an object in 445 of the 772 corpus goals and an explicit null in 327 ' +
  '(m_dialogs empty in 36); the first Add Dialog Tag on a null slot writes the list.';

export default function QuestDialogEditor({ state }: QuestDialogEditorProps): JSX.Element {
  const goalsValue = state.value(['m_goals']);
  const goals = Array.isArray(goalsValue) ? goalsValue : [];

  return (
    <section aria-label={DIALOG_EDITOR_LABEL} className="flex flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="font-mono text-xs text-zinc-400">{DIALOG_LIST_KEY}</h2>
          <p className="text-xs text-zinc-400">{QUEST_DIALOG_NOTE}</p>
        </div>
        <DialogListEditor state={state} path={[DIALOG_LIST_KEY]} label={QUEST_DIALOG_LIST_LABEL} />
      </div>

      <section aria-label={GOAL_DIALOG_SECTION_LABEL} className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-mono text-xs text-zinc-400">{`m_goals[].${DIALOG_LIST_KEY}`}</h2>
          <p className="text-xs text-zinc-400">{GOAL_DIALOG_NOTE}</p>
        </div>
        {goals.length === 0 ? (
          <p className="text-sm text-zinc-400">{NO_GOALS_TEXT}</p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-6">
            {goals.map((goal, index) => {
              const name = goalName(goal) ?? `Goal ${index + 1}`;
              return (
                <li key={`m_goals:${index}`} className="flex min-w-0 flex-col gap-2">
                  <h3 className="font-mono text-xs text-zinc-300">{name}</h3>
                  <DialogListEditor
                    state={state}
                    path={['m_goals', index, DIALOG_LIST_KEY]}
                    label={`Dialog list for ${name}`}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}
