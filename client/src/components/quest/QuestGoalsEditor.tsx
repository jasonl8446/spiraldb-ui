import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';

import type { QuestDocumentState } from '../../hooks/useQuestDocument';
import { getNames, getName, nameLookupQueryKey, namesQueryKey } from '../../lib/api';
import type { NameRowMap } from '../../lib/display';
import { clientTagsToText, questTitleDisplay, shouldLookupStringKey } from '../../lib/quest-info';
import {
  ADD_GOAL_LABEL,
  ADD_GOAL_TYPE_LABEL,
  DELETE_GOAL_LABEL,
  EDIT_GOAL_LABEL,
  GOALS_EDITOR_LABEL,
  GOALS_PATH,
  GOAL_EDITABLE_BASE_FIELDS,
  GOAL_TYPE_SPECS,
  NO_GOALS_TEXT,
  RAW_FIELDS_LABEL,
  REORDER_HANDLE_LABEL,
  SET_START_GOAL_LABEL,
  SHARED_BASE_FIELDS_LABEL,
  START_GOALS_PATH,
  START_GOAL_BADGE_LABEL,
  UNSET_START_GOAL_LABEL,
  addGoalEdits,
  complexFieldOwner,
  deleteGoalEdit,
  goalBadgeClass,
  goalBooleanFieldEdit,
  goalName,
  goalNumberFieldEdit,
  goalScalarText,
  goalSelectOptions,
  goalSelectValue,
  goalShortTypeName,
  goalSummaryLines,
  goalTagsFieldEdit,
  goalTextFieldEdit,
  goalTypeFields,
  isStartGoal,
  moveGoalEdits,
  npcNameSuggestions,
  rawGoalFields,
  toggleStartGoalEdits,
  unmodelledGoalKeys,
  type GoalFieldSpec,
  type GoalShortTypeName,
} from '../../lib/quest-goals';
import {
  FieldMessages,
  fieldAriaInvalid,
  useFieldMessages,
  useFieldMessagesUnder,
} from '../shared/FieldValidation';
import type { ValidationMessage } from '../../lib/quest-validation';
import { withValidationBorder } from '../../lib/quest-validation';
import { cn } from '../../lib/utils';
import FriendlyNameDropdown from '../FriendlyNameDropdown';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

/**
 * `QuestGoalsEditor` — the Goals tab's editor (plan task 3.4, story p3-04;
 * docs/spec-ui-design.md L300-314, docs/spec-domain-reference.md L312-338).
 *
 * Every rule and every field lives in `lib/quest-goals.ts`; this component only decides
 * how a `GoalFieldSpec` renders and routes each change through {@link QuestDocumentState}
 * — `shared/document.ts`'s primitives (D58). No control here spreads a document, writes a
 * Zod parse output back, or injects a default.
 *
 * Five deliberate behaviours, all recorded in the story report:
 *
 * 1. **Reordering is `@dnd-kit/sortable` over the document.** `DndContext` +
 *    `SortableContext` + `useSortable` give the drag and the keyboard sensor
 *    (`sortableKeyboardCoordinates`, so the handle works without a mouse), and the drop
 *    is applied with the model's `moveGoalEdits` — one `delete` then one `insert`
 *    through `shared/document.ts`, with `arrayMove`'s own semantics (pinned by the unit
 *    tests) — rather than `arrayMove` + a rewritten array, which D58 forbids.
 * 2. **The drag handle is a real labelled `<button>`**, not the card itself: dnd-kit's
 *    `attributes`/`listeners` go on the handle (via `setActivatorNodeRef`) and only
 *    `setNodeRef` on the `<article>`, so the card keeps its `article` role and a
 *    keyboard user gets a focusable control.
 * 3. **Card ids are positional** (`m_goals:0`, `m_goals:1`, …) because `m_goalName` is
 *    editable — a name-keyed React key would remount the card on every keystroke. The
 *    open card is therefore collapsed when a drop lands, so the panel can never be
 *    showing the goal that used to be at that index.
 * 4. **The Start badge is an indicator, the toggle is a labelled button**
 *    (`Set as Start Goal` / `Unset as Start Goal`, the plan's own wording, §3.4). A
 *    button whose only label was the badge could not say what it does.
 * 5. **The raw-fields disclosure is always on the card**, not only in the expanded
 *    editor: a complex field (`m_completeResults`, `m_goalRequirements`, `m_dialogList`,
 *    …) or a legacy key the model has never heard of must be visible without the user
 *    discovering Edit first.
 *
 * The `modifiedAt` prop is accepted and unused on purpose: the detail page constructs
 * both live panels from one props shape (see `QuestInfoEditor`), and the Goals tab's spec
 * ASCII (L300-314) has no timestamp line, so there is nowhere honest to put it.
 */
export interface QuestGoalsEditorProps {
  /** The live document + its mutations (`useQuestDocument`). */
  state: QuestDocumentState;
  /** Present for symmetry with `QuestInfoEditor`; the Goals card has no timestamp row. */
  modifiedAt?: string | null;
}

export default function QuestGoalsEditor({ state }: QuestGoalsEditorProps): JSX.Element {
  const goals = arrayOf(state.value([GOALS_PATH]));
  const startGoals = state.value([START_GOALS_PATH]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [newType, setNewType] = useState<GoalShortTypeName>('Waypoint');

  // Positional ids: `m_goalName` is editable, so a name-keyed id would remount a card
  // (and lose focus) on every keystroke in the base-fields section.
  const ids = goals.map((_, index) => `${GOALS_PATH}:${index}`);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (over === null) {
      return;
    }
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0 || from === to) {
      return;
    }
    // A drop collapses the open card: indices are about to shift under it.
    setExpanded(null);
    state.editAll(moveGoalEdits(from, to, goals[from]));
  }

  return (
    <section aria-label={GOALS_EDITOR_LABEL} className="flex flex-col gap-3">
      <StartGoalsValidation />
      {goals.length === 0 ? (
        <p className="text-sm text-zinc-500">{NO_GOALS_TEXT}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col gap-3">
              {goals.map((goal, index) => (
                <GoalCard
                  key={ids[index]}
                  id={ids[index]}
                  index={index}
                  goal={goal}
                  startGoals={startGoals}
                  state={state}
                  expanded={expanded === index}
                  onToggleEdit={() => setExpanded(expanded === index ? null : index)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <AddGoalControl
        type={newType}
        onTypeChange={setNewType}
        onAdd={() => {
          const taken = goals
            .map((goal) => goalName(goal))
            .filter((name): name is string => name !== null);
          state.editAll(addGoalEdits(newType, taken, goals.length));
          // The new goal is the last card; open nothing — the summary lines are enough
          // to confirm what was added, and the Edit button is right there.
          setExpanded(null);
        }}
      />
    </section>
  );
}

/**
 * The `m_startGoals` field's inline surface (story p3-09's AC clause).
 *
 * The Goals tab has no per-entry control for `m_startGoals` — membership is toggled from a goal
 * card's `Set as Start Goal` button — so the *field* has no control to underline. This strip is
 * the field's own surface: every finding under `m_startGoals` renders as a red-bordered inline
 * error naming the dangling name (AC1: "m_startGoals entry referencing a deleted goal → inline
 * error + form banner + Save disabled"). It renders nothing when every start goal resolves,
 * which is the state of all 322 corpus quests.
 */
function StartGoalsValidation(): JSX.Element | null {
  const messages = useFieldMessagesUnder([START_GOALS_PATH]);
  if (messages.length === 0) {
    return null;
  }
  return (
    <div
      role="group"
      aria-label={START_GOALS_PATH}
      data-testid="start-goals-validation"
      className="flex flex-col gap-1 rounded-md border border-red-500/60 bg-red-950/20 p-2"
    >
      <p className="font-mono text-xs text-red-300">{START_GOALS_PATH}</p>
      <FieldMessages messages={messages} />
    </div>
  );
}

/** One goal card: handle, name, badges, summary lines, actions, inline editor. */
function GoalCard({
  id,
  index,
  goal,
  startGoals,
  state,
  expanded,
  onToggleEdit,
}: {
  id: string;
  index: number;
  goal: unknown;
  startGoals: unknown;
  state: QuestDocumentState;
  expanded: boolean;
  onToggleEdit: () => void;
}): JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const name = goalName(goal);
  const start = isStartGoal(goal, startGoals);
  // The finding about the goal itself (its own path), not its fields: `goal-unreachable` is the
  // only rule whose subject is the node, and this card is the node's surface.
  const nodeMessages = useFieldMessages([GOALS_PATH, index]);

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
  };

  return (
    <li ref={setNodeRef} style={style} className={cn(isDragging && 'opacity-70')}>
      <article className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
        <header className="flex flex-wrap items-center gap-2">
          {/*
            The drag handle is the only element carrying dnd-kit's listeners and
            attributes (`setActivatorNodeRef`): the card stays an `article` and the
            handle stays a focusable, labelled button.
          */}
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`${REORDER_HANDLE_LABEL} ${name ?? index + 1}`}
            className="cursor-grab rounded-md border border-zinc-700 px-2 py-1 text-sm text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:cursor-grabbing"
          >
            ☰
          </button>

          <span className="font-mono text-sm text-zinc-100">{name ?? `Goal ${index + 1}`}</span>

          <Badge variant="outline" className={goalBadgeClass(goal)}>
            {goalShortTypeName(goal)}
          </Badge>
          {start ? <Badge variant="success">{START_GOAL_BADGE_LABEL}</Badge> : null}

          <div className="ml-auto flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onToggleEdit}>
              {EDIT_GOAL_LABEL}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`${DELETE_GOAL_LABEL} ${name ?? index + 1}`}
              onClick={() => state.edit(deleteGoalEdit(index))}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </header>

        <FieldMessages messages={nodeMessages} className="mt-2" />

        <GoalSummary goal={goal} />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-pressed={start}
            aria-label={start ? UNSET_START_GOAL_LABEL : SET_START_GOAL_LABEL}
            onClick={() => {
              const goalNameValue = goalName(goal);
              if (goalNameValue !== null) {
                state.editAll(toggleStartGoalEdits(goalNameValue, startGoals));
              }
            }}
          >
            {start ? UNSET_START_GOAL_LABEL : SET_START_GOAL_LABEL}
          </Button>
        </div>

        {expanded ? <GoalEditPanel index={index} goal={goal} state={state} /> : null}

        <RawFieldsDisclosure goal={goal} />
      </article>
    </li>
  );
}

/** The spec ASCII's summary lines (L305-309). */
function GoalSummary({ goal }: { goal: unknown }): JSX.Element | null {
  const lines = goalSummaryLines(goal);
  if (lines.length === 0) {
    return null;
  }
  return (
    <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
      {lines.map((line) => (
        <div key={line.label} className="flex min-w-0 gap-2">
          <dt className="shrink-0 text-zinc-500">{line.label}:</dt>
          <dd className="truncate text-zinc-300" title={line.value}>
            {line.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The inline editor (no modal — the plan allows either, and an inline panel keeps the
 * card, its summary and its JSON in one view): the type's own fields, then the shared
 * base fields in a collapsible `<details>`, then the raw disclosure (on the card).
 */
function GoalEditPanel({
  index,
  goal,
  state,
}: {
  index: number;
  goal: unknown;
  state: QuestDocumentState;
}): JSX.Element {
  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-zinc-800 pt-3">
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 md:grid-cols-2">
        {goalTypeFields(goal).map((field) => (
          <GoalFieldControl key={field.key} index={index} field={field} state={state} />
        ))}
      </div>

      <details className="rounded-md border border-zinc-800 bg-zinc-950/40">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          {SHARED_BASE_FIELDS_LABEL}
        </summary>
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 border-t border-zinc-800 p-3 md:grid-cols-2">
          {GOAL_EDITABLE_BASE_FIELDS.map((field) => (
            <GoalFieldControl key={field.key} index={index} field={field} state={state} />
          ))}
        </div>
      </details>
    </div>
  );
}

/** One field: its raw-key label, its control and its one-line help. */
function GoalFieldControl({
  index,
  field,
  state,
}: {
  index: number;
  field: GoalFieldSpec;
  state: QuestDocumentState;
}): JSX.Element {
  const path = [GOALS_PATH, index, field.key];
  const value = state.value(path);
  const present = state.has(path);
  // Story p3-09: this field's findings — a duplicate/absent `m_goalName`, an unknown `$type`,
  // a bad TemplateID, or one of the general rules' warnings (the real data: an unlisted zone
  // path). `<GoalFieldMessages>` renders them below the control.
  const messages = useFieldMessages(path);
  const messagesId = `${GOALS_PATH}-${index}-${field.key}-messages`;
  const inputClass = withValidationBorder(
    'min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
    messages,
  );
  const ariaInvalid = fieldAriaInvalid(messages);

  // `select` is the only kind that is not an `<input>`/checkbox; every other kind is a
  // labelled form control (or the zone combobox, labelled with `aria-label` because a
  // `<button>` cannot be named by `htmlFor`).
  if (field.kind === 'select') {
    const id = `${GOALS_PATH}-${index}-${field.key}`;
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={id} className="font-mono text-xs text-zinc-400">
          {field.key}
        </label>
        <select
          id={id}
          aria-invalid={ariaInvalid}
          value={goalSelectValue(value)}
          className={inputClass}
          onChange={(event) =>
            state.edit(goalTextFieldEdit(index, field.key, present, event.target.value))
          }
        >
          {goalSelectOptions(value, field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.unlisted ? `${option.label} (unlisted)` : option.label}
            </option>
          ))}
        </select>
        <GoalFieldMessages messages={messages} id={messagesId} help={field.help} />
      </div>
    );
  }

  if (field.kind === 'zone') {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-mono text-xs text-zinc-400">{field.key}</span>
        {/*
          FriendlyNameDropdown reads/writes the `zones` table's `zone_path`. Measured:
          only 112 of the 149 distinct zone paths the corpus references exist in that
          table (the misses are interior variants such as
          `DragonSpire/DS_A3_Kings/Interiors/DS_School_Fire`), so the control's miss path
          is load-bearing — an unlisted path keeps displaying itself and is never
          rewritten.
        */}
        <FriendlyNameDropdown
          type="zones"
          name={`${GOALS_PATH}-${index}-${field.key}`}
          aria-label={field.key}
          value={typeof value === 'string' ? value : null}
          allowEmpty
          invalid={ariaInvalid}
          onChange={(rawId) => state.edit(goalTextFieldEdit(index, field.key, present, rawId))}
        />
        <GoalFieldMessages messages={messages} id={messagesId} help={field.help} />
      </div>
    );
  }

  if (field.kind === 'npcName') {
    return (
      <NpcNameField
        index={index}
        field={field}
        state={state}
        value={value}
        present={present}
        messages={messages}
        messagesId={messagesId}
      />
    );
  }

  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="font-mono text-xs text-zinc-400">
        {field.key}
      </label>
      {field.kind === 'boolean' ? (
        <input
          id={id}
          aria-invalid={ariaInvalid}
          type="checkbox"
          checked={value === true}
          className="h-4 w-4 accent-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          onChange={(event) =>
            state.edit(goalBooleanFieldEdit(index, field.key, event.target.checked))
          }
        />
      ) : field.kind === 'number' ? (
        <input
          id={id}
          aria-invalid={ariaInvalid}
          type="number"
          value={goalScalarText(value)}
          className={inputClass}
          onChange={(event) =>
            state.edit(goalNumberFieldEdit(index, field.key, present, event.target.value))
          }
        />
      ) : field.kind === 'tags' ? (
        <input
          id={id}
          aria-invalid={ariaInvalid}
          type="text"
          value={clientTagsToText(value)}
          placeholder="comma, separated, tags"
          className={inputClass}
          onChange={(event) =>
            state.edit(goalTagsFieldEdit(index, field.key, present, event.target.value))
          }
        />
      ) : (
        <input
          id={id}
          aria-invalid={ariaInvalid}
          type="text"
          value={goalScalarText(value)}
          className={inputClass}
          onChange={(event) =>
            state.edit(goalTextFieldEdit(index, field.key, present, event.target.value))
          }
        />
      )}
      {field.key === 'm_goalTitle' ? <GoalTitleResolution value={value} /> : null}
      <GoalFieldMessages messages={messages} id={messagesId} help={field.help} />
    </div>
  );
}

/**
 * A goal field's help text and its inline validation messages, in that order — the one place
 * the Goals tab renders a field's findings (L547's "message below" the control).
 */
function GoalFieldMessages({
  messages,
  id,
  help,
}: {
  messages: readonly ValidationMessage[];
  id: string;
  help: string;
}): JSX.Element {
  return (
    <>
      {help === '' ? null : <p className="text-xs text-zinc-500">{help}</p>}
      <FieldMessages messages={messages} id={id} />
    </>
  );
}

/**
 * `m_personaName` — a **free-text** input with `<datalist>` suggestions, deliberately not
 * a closed select. Measured: `m_personaName` holds an NPC *name* (`WC-HUB-NPC01`), not a
 * template id, and all 8 distinct corpus values resolve in neither names table (0 of 8 in
 * `npcs.name` over all 23,033 rows, 0 of 8 as `string_table` keys), so a closed list would
 * mark every real value unlisted and would tempt a rewrite. The value written is exactly
 * what the user typed; an unlisted name stays selected.
 *
 * The list query uses `namesQueryKey('npcs')` — the same cache entry `useNames('npcs')`
 * fills — so mounting this control never starts a second fetch of the NPC table.
 */
function NpcNameField({
  index,
  field,
  state,
  value,
  present,
  messages,
  messagesId,
}: {
  index: number;
  field: GoalFieldSpec;
  state: QuestDocumentState;
  value: unknown;
  present: boolean;
  messages: readonly ValidationMessage[];
  messagesId: string;
}): JSX.Element {
  const id = useId();
  const [query, setQuery] = useState('');
  const npcs = useQuery({
    queryKey: namesQueryKey('npcs'),
    queryFn: () => getNames('npcs'),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const rows = (npcs.data ?? []) as NameRowMap['npcs'][];
  const current = typeof value === 'string' ? value : '';
  const suggestions = npcNameSuggestions(rows, current, query);
  const listId = `${id}-npc-names`;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="font-mono text-xs text-zinc-400">
        {field.key}
      </label>
      <input
        id={id}
        type="text"
        list={listId}
        value={current}
        placeholder="NPC name"
        aria-invalid={fieldAriaInvalid(messages)}
        className={withValidationBorder(
          'min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
          messages,
        )}
        onChange={(event) => {
          setQuery(event.target.value);
          state.edit(goalTextFieldEdit(index, field.key, present, event.target.value));
        }}
      />
      <datalist id={listId}>
        {suggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <GoalFieldMessages messages={messages} id={messagesId} help={field.help} />
    </div>
  );
}

/**
 * The resolved `m_goalTitle`: one `GET /api/names/strings/:key` read, enabled only for a
 * non-empty key, a miss rendering the raw key verbatim, and **no request at all** for the
 * empty key 26 corpus goals carry (the empty URL is the LIST route: 24,077,358 bytes).
 */
function GoalTitleResolution({ value }: { value: unknown }): JSX.Element | null {
  const lookupKey = shouldLookupStringKey(value) ? value : null;
  const lookup = useQuery({
    queryKey: nameLookupQueryKey('strings', lookupKey ?? ''),
    queryFn: () => getName('strings', lookupKey ?? ''),
    enabled: lookupKey !== null,
    retry: false,
  });
  if (lookupKey === null) {
    return null;
  }
  const display = questTitleDisplay(lookupKey, lookup.data);
  return (
    <p className="truncate text-xs text-zinc-400" title={display}>
      {display}
    </p>
  );
}

/**
 * The read-only raw-fields disclosure: the complex fields another Phase-3 task owns and
 * any key the model does not know, rendered as JSON. Absent keys are never invented, so a
 * goal with neither shows `{}` and a goal with legacy content shows all of it.
 */
function RawFieldsDisclosure({ goal }: { goal: unknown }): JSX.Element {
  const raw = rawGoalFields(goal);
  const unmodelled = unmodelledGoalKeys(goal);
  const complex = Object.keys(raw).filter((key) => !unmodelled.includes(key));
  /*
    The counts are reported separately because they are different claims: `other-tab` means
    a later Phase-3 task owns an editor for the key, `unowned` means no Phase-3 task does
    (`GOAL_COMPLEX_FIELDS`'s `owner: null`), and `unmodelled` means the key is not in the
    model at all. Lumping them together would claim an owner that does not exist.
  */
  const owned = complex.filter((key) => Boolean(complexFieldOwner(key)));
  const unowned = complex.filter((key) => !complexFieldOwner(key));
  const counts = [
    owned.length === 0 ? null : `${owned.length} other-tab`,
    unowned.length === 0 ? null : `${unowned.length} unowned`,
    unmodelled.length === 0 ? null : `${unmodelled.length} unmodelled`,
  ].filter((part): part is string => part !== null);
  return (
    <details className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/40">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
        {RAW_FIELDS_LABEL} ({counts.join(', ')})
      </summary>
      <div className="border-t border-zinc-800 p-3">
        {unmodelled.length === 0 ? null : (
          <p className="mb-2 text-xs text-amber-400">
            Keys this editor does not model — preserved untouched: {unmodelled.join(', ')}
          </p>
        )}
        {complex.length === 0 ? null : (
          <p className="mb-2 text-xs text-zinc-500">
            Not edited in this tab:{' '}
            {complex
              .map((key) => `${key} (${complexFieldOwner(key) ?? 'no Phase-3 editor'})`)
              .join(', ')}
          </p>
        )}
        <pre className="max-h-72 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-300">
          {JSON.stringify(raw, null, 2)}
        </pre>
      </div>
    </details>
  );
}

/** The bottom "Add Goal" control and its five-type selector. */
function AddGoalControl({
  type,
  onTypeChange,
  onAdd,
}: {
  type: GoalShortTypeName;
  onTypeChange: (next: GoalShortTypeName) => void;
  onAdd: () => void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={id} className="font-mono text-xs text-zinc-400">
          {ADD_GOAL_TYPE_LABEL}
        </label>
        <select
          id={id}
          value={type}
          className="min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          onChange={(event) => onTypeChange(event.target.value as GoalShortTypeName)}
        >
          {GOAL_TYPE_SPECS.map((spec) => (
            <option key={spec.shortName} value={spec.shortName}>
              {spec.shortName}
            </option>
          ))}
        </select>
      </div>
      <Button type="button" size="sm" onClick={onAdd}>
        <Plus className="h-4 w-4" aria-hidden="true" />
        {ADD_GOAL_LABEL}
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------- helpers */

/** `value` as an array, or `[]` (an absent `m_goals` is not an array). */
function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
