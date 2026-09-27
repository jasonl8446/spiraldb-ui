import type { QuestDocumentState } from '../../hooks/useQuestDocument';
import { goalName, NO_GOALS_TEXT } from '../../lib/quest-goals';
import {
  GOAL_REQUIREMENTS_PATH,
  PREP_REQUIREMENTS_PATH,
  PRUNE_REQUIREMENTS_PATH,
  REQUIREMENTS_PATH,
} from '../../lib/requirement-tree';
import RequirementTreeEditor from '../shared/RequirementTreeEditor';

/**
 * `QuestRequirementsEditor` — the Requirements tab's body (plan task 3.6, story p3-06).
 *
 * It is a **thin host**: every slot mounts the shared
 * {@link RequirementTreeEditor} with nothing but a document path, which is the whole
 * argument for that component living in `components/shared/`. Four slots, because the
 * existing inventories already assign all four to this tab and leaving one out would make
 * an owner label a lie:
 *
 * | slot | path | owner label it satisfies | measured corpus |
 * |---|---|---|---|
 * | `m_requirements` | `['m_requirements']` | `lib/quest-info.ts` L194 | non-null in 314 of 322 quests |
 * | `m_prepRequirements` | `['m_prepRequirements']` | `lib/quest-info.ts` L195 | **null in all 322** |
 * | `m_pruneRequirements` | `['m_pruneRequirements']` | `lib/quest-info.ts` L196 | null in 320, absent in 2 |
 * | `m_goalRequirements` (per goal) | `['m_goals', i, 'm_goalRequirements']` | `lib/quest-goals.ts` L406 | **null in all 772 goals** |
 *
 * The two corpus-empty slots are the story's fixture-only territory and are labelled as
 * such in the UI: a quest's own tree contains only `ReqHasQuest`/`ReqHasEntry` in the whole
 * corpus, `m_goalRequirements` is null in every one of the 772 measured goals, and nothing
 * here claims otherwise.
 *
 * Nothing in this file writes: the panel only decides which paths are mounted and what
 * each one is called, and every tree writes nothing until the user acts (D57) — so merely
 * opening the tab leaves `m_prepRequirements: null` `null`.
 */
export interface QuestRequirementsEditorProps {
  /** The live document + its mutations (`useQuestDocument`). */
  state: QuestDocumentState;
  /** Present for symmetry with the other live panels; the tree has no timestamp row. */
  modifiedAt?: string | null;
}

/** The panel's accessible name (the tier-1 spec scopes to it). */
export const REQUIREMENTS_EDITOR_LABEL = 'Quest requirements editor';

/** The three quest-level trees' accessible names. */
export const REQUIREMENTS_TREE_LABEL = 'Requirements';
export const PREP_REQUIREMENTS_TREE_LABEL = 'Preparation requirements';
export const PRUNE_REQUIREMENTS_TREE_LABEL = 'Prune requirements';

/** The per-goal section's accessible name; each goal's own tree is named after the goal. */
export const GOAL_REQUIREMENTS_SECTION_LABEL = 'Goal requirements';

/** The slot hint for a field that is the corpus's `null` — the honest "nothing invented" note. */
export const PREP_REQUIREMENTS_NOTE =
  'm_prepRequirements is null in all 322 corpus quests — it stays null until you add something here.';
export const PRUNE_REQUIREMENTS_NOTE =
  'm_pruneRequirements is null in 320 of the 322 corpus quests (absent in the other 2).';
export const GOAL_REQUIREMENTS_NOTE =
  'm_goalRequirements is null in all 772 corpus goals, so anything edited here is new content.';

export default function QuestRequirementsEditor({
  state,
  modifiedAt,
}: QuestRequirementsEditorProps): JSX.Element {
  const goalsValue = state.value(['m_goals']);
  const goals = Array.isArray(goalsValue) ? goalsValue : [];

  return (
    <section aria-label={REQUIREMENTS_EDITOR_LABEL} className="flex flex-col gap-6">
      <Slot
        state={state}
        fieldKey={REQUIREMENTS_PATH}
        path={[REQUIREMENTS_PATH]}
        label={REQUIREMENTS_TREE_LABEL}
      />
      <Slot
        state={state}
        fieldKey={PREP_REQUIREMENTS_PATH}
        path={[PREP_REQUIREMENTS_PATH]}
        label={PREP_REQUIREMENTS_TREE_LABEL}
        note={PREP_REQUIREMENTS_NOTE}
      />
      <Slot
        state={state}
        fieldKey={PRUNE_REQUIREMENTS_PATH}
        path={[PRUNE_REQUIREMENTS_PATH]}
        label={PRUNE_REQUIREMENTS_TREE_LABEL}
        note={PRUNE_REQUIREMENTS_NOTE}
      />

      <section aria-label={GOAL_REQUIREMENTS_SECTION_LABEL} className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="font-mono text-xs text-zinc-400">{GOAL_REQUIREMENTS_PATH}</h2>
          <p className="text-xs text-zinc-400">{GOAL_REQUIREMENTS_NOTE}</p>
        </div>
        {goals.length === 0 ? (
          <p className="text-sm text-zinc-400">{NO_GOALS_TEXT}</p>
        ) : (
          <ul className="flex min-w-0 flex-col gap-4">
            {goals.map((goal, index) => {
              const name = goalName(goal) ?? `Goal ${index + 1}`;
              return (
                <li key={`m_goals:${index}`} className="flex min-w-0 flex-col gap-2">
                  <h3 className="font-mono text-xs text-zinc-400">{name}</h3>
                  <RequirementTreeEditor
                    state={state}
                    path={['m_goals', index, GOAL_REQUIREMENTS_PATH]}
                    label={`Goal requirements for ${name}`}
                    modifiedAt={modifiedAt}
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

/** One quest-level slot: its mono key, its honest corpus note, and the shared tree. */
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
  note?: string;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-col gap-1">
        <h2 className="font-mono text-xs text-zinc-400">{fieldKey}</h2>
        {note === undefined ? null : <p className="text-xs text-zinc-400">{note}</p>}
      </div>
      <RequirementTreeEditor state={state} path={path} label={label} />
    </div>
  );
}
