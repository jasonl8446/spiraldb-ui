import { Plus } from 'lucide-react';
import { useId, useState } from 'react';

import type { DocEdit, DocPath } from '@shared/document';

import { useNames } from '../../hooks/useNames';
import type { NamesType } from '../../lib/display';
import {
  ADD_RESULT_LABEL,
  ADD_RESULT_TYPE_LABEL,
  addResultEdits,
  DEFAULT_RESULT_TYPE,
  DELETE_RESULT_LABEL,
  NAME_SOURCE_LABEL,
  NPCS_SOURCE_LABEL,
  NO_RESULTS_TEXT,
  NO_RESULT_WRAPPER_TEXT,
  RAW_FIELDS_LABEL,
  deleteResultEdits,
  readResultCards,
  resultRequirementsPath,
  resultScalarText,
  resultSelectOptions,
  resultSelectValue,
  resultTypeSelectOptions,
  ROUTER_ABSENT_NOTE,
  SOUND_ROUTER_FIELD_SPECS,
  SOUND_ROUTER_KEY,
  soundRouterView,
  SPELLS_SOURCE_LABEL,
  setResultBooleanFieldEdit,
  setResultIdFieldEdit,
  setResultNumberFieldEdit,
  setResultTextFieldEdit,
  setRouterBooleanFieldEdit,
  setRouterFieldEdit,
  unmodelledResultKeys,
  rawResultFields,
  RESULT_LIST_EDITOR_LABEL,
  type ResultCardView,
  type ResultFieldView,
  type ResultSelectOption,
  type ResultShortTypeName,
} from '../../lib/quest-results';
import { docPathWords, fieldValueText, termText } from '../../lib/term';
import { cn } from '../../lib/utils';
import FriendlyNameDropdown from '../FriendlyNameDropdown';
import TermLabel from '../TermLabel';
import { FieldMessages, useFieldMessages, type FieldValidationMessage } from './FieldValidation';
import { Button } from '../ui/button';
import RequirementTreeEditor from './RequirementTreeEditor';

/**
 * `ResultListEditor` — one result-array wrapper's cards (plan task 3.7, story p3-07;
 * docs/spec-ui-design.md L320, docs/spec-domain-reference.md L354-412).
 *
 * It lives in `components/shared/` for the same reason `RequirementTreeEditor` does: it is
 * **host-agnostic**. Its props are a {@link DocPath} — a *result-list wrapper* — plus a
 * document state, and it never sees a "quest". Five wrappers are mounted in this
 * repository already (a quest's `m_startResults` and `m_endResults`, each goal's
 * `m_completeResults` / `m_activateResults`, and a tally counter's `m_tallyResults`), and a
 * Phase-4 host can mount it again with nothing but a different path.
 *
 * Every rule and every label is in `lib/quest-results.ts`; this component only decides how
 * a card renders and routes each change through the state's `edit`/`editAll` — the
 * `shared/document.ts` primitives (D58). **No control here spreads a document**, rebuilds a
 * node, or injects a default: the builders return `DocEdit`s, and an edit of one field is
 * one `set`/`delete` of one key, which is what keeps an existing corpus node's key order,
 * explicit `null`s, unknown keys and absent keys exactly as they were (D57).
 *
 * Six deliberate behaviours, all recorded in the story report:
 *
 * 1. **The wrapper is never tagged.** The corpus's 2206 wrappers each hold exactly one key,
 *    `m_results`, and no `$type` (unlike the requirement wrapper); this component renders
 *    the wrapper and writes into it, and {@link addResultEdits} creates it as
 *    `{m_results: [...]}` when it is missing. Nothing here can add a `$type` to it.
 * 2. **The field keys are the labels, as glossary pairs.** Each control's visible label and
 *    accessible name is the document key's `Friendly (technical)` pair (`Drop table
 *    (m_tableName)`, D131, task 7.9), the same habit `QuestGoalsEditor` has, and the card's own
 *    name disambiguates the repeats across cards.
 * 3. **A friendly-name field is a real dropdown per declared source**, and a **dual-source**
 *    field (`ResDrawHand.m_templateID`, measured 6 of 8 distinct values in `spells` and 2 in
 *    `npcs`) gets a UI-only source toggle: the default is whichever table the current value
 *    resolves in (`npcs` for a value neither table knows — the domain reference's own
 *    claim). The toggle writes nothing; an unlisted value stays displayed and selected and
 *    is never rewritten (AGENTS.md rule 5 + the D60(c) miss-safe rule).
 * 4. **`m_router` is a sub-object with its own six controls**, never a tagged node. When it
 *    is absent the sub-controls render the measured new-router shape and the first edit
 *    writes the whole object ({@link setRouterFieldEdit}), because the document primitives
 *    never invent an intermediate object.
 * 5. **`ResLearnSpell.m_requirements` is the shared tree**, mounted at its own path — not a
 *    second implementation. The wrapper is the corpus's **untyped** one.
 * 6. **A node this model cannot read is kept on screen** with its JSON and a delete button;
 *    an unknown `$type` renders its full value, and an unmodelled key is surfaced in the
 *    card's raw-fields disclosure, so nothing is silently hidden (D5).
 *
 * **Accessibility vocabulary** (every control has a real accessible name; reported because
 * the tier-1 spec addresses the same names):
 *
 * | element | accessible name | how |
 * |---|---|---|
 * | the list's container | the `label` prop (default `Result list editor`) | `<section aria-label>` → a `region` |
 * | a card | `<class pair> <words>` (`Reward: drop table (ResDropTable) Start results › Results 1`) | `<article aria-label>` + `data-path` (the address) |
 * | delete | `Delete <words>` | `aria-label` + `data-path` on a `×` button |
 * | the add selector | `New result type` | a real `<label htmlFor>` |
 * | the add button | `Add Result` | button text |
 * | a text/number/enum/boolean field | its glossary pair (`Max rolls (m_maxRolls)`) | a real `<label htmlFor>` + the card's name for disambiguation |
 * | a friendly-name field | its glossary pair | `aria-label` on the combobox (a `<button>` cannot be named by `htmlFor`) |
 * | the dual-source toggle | `Spells for <pair> <words>` / `NPCs for …` | `aria-label` + `aria-pressed`, inside `role="group" aria-label="source <pair> <words>"` |
 * | the router | `Sound router (m_router)` | `role="group" aria-label`; each sub-control is labelled with its own pair |
 * | the requirement slot | `Requirements for <words>` | the shared tree's `<section aria-label>` |
 *
 * Twelve components are deliberately absent: no undo stack, no reordering, no drag-and-drop,
 * no validation, no new dependency. The header's Save toggle, the dirty guard and validation
 * are tasks 3.09/3.10.
 */
export interface ResultListEditorProps {
  /**
   * The document state this list mutates: a structural subset of `useQuestDocument`'s
   * `QuestDocumentState`, declared here so a Phase-4 host (or a unit render) can satisfy it
   * without importing the quest hook.
   */
  state: ResultListDocumentState;
  /** The absolute path of the result-list wrapper this editor owns. */
  path: DocPath;
  /** The container's accessible name. Defaults to `Result list editor`. */
  label?: string;
  /** Present for symmetry with the other live panels; a result card has no timestamp row. */
  modifiedAt?: string | null;
  className?: string;
}

/** The four mutations the list needs — `shared/document.ts`'s contract, nothing more. */
export interface ResultListDocumentState {
  /** `true` when {@link path} exists (never throws). */
  has: (path: DocPath) => boolean;
  /** The value at {@link path}, or `undefined` when it does not exist. */
  value: (path: DocPath) => unknown;
  /** Applies one edit; `null` is a no-op. */
  edit: (edit: DocEdit | null) => void;
  /** Applies several edits in order. */
  editAll: (edits: readonly DocEdit[]) => void;
}

export default function ResultListEditor({
  state,
  path,
  label = RESULT_LIST_EDITOR_LABEL,
  className,
}: ResultListEditorProps): JSX.Element {
  const wrapper = state.value(path);
  const wrapperIsObject = isPlainObject(wrapper);
  const cards = readResultCards(path, wrapper);
  const items = state.value([...path, 'm_results']);

  return (
    <section aria-label={label} className={cn('flex min-w-0 flex-col gap-3', className)}>
      {!wrapperIsObject ? (
        <p className="text-sm text-zinc-400">{NO_RESULT_WRAPPER_TEXT}</p>
      ) : cards.length === 0 ? (
        <p className="text-sm text-zinc-400">{NO_RESULTS_TEXT}</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-3">
          {cards.map((card) => (
            <ResultCard key={card.address} state={state} card={card} />
          ))}
        </ul>
      )}

      <AddResultControl
        state={state}
        path={path}
        presence={{ wrapper: wrapperIsObject, items: Array.isArray(items) }}
        count={cards.length}
      />
    </section>
  );
}

/** One card: the class title, the delete control, its fields and its raw disclosure. */
function ResultCard({
  state,
  card,
}: {
  state: ResultListDocumentState;
  card: ResultCardView;
}): JSX.Element {
  const typeString =
    isPlainObject(card.value) && typeof card.value.$type === 'string' ? card.value.$type : null;
  return (
    <li className="min-w-0">
      <article
        aria-label={`${card.title} ${docPathWords(card.path)}`}
        data-path={card.address}
        className="min-w-0 rounded-md border border-zinc-800 border-l-4 border-l-blue-500 bg-zinc-900/40 p-3"
      >
        <header className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-zinc-400">{card.index + 1}</span>
          <span className="text-sm text-zinc-100">
            {typeString === null ? card.title : <TermLabel term={{ type: typeString }} />}
          </span>
          {card.spec === null ? (
            <span className="text-xs text-amber-400">
              $type this editor does not model — kept verbatim
            </span>
          ) : null}
          <div className="ml-auto">
            <DeleteButton
              state={state}
              listPath={card.listPath}
              index={card.index}
              path={card.path}
              address={card.address}
            />
          </div>
        </header>

        {card.readable && card.spec !== null ? (
          <>
            <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {card.fields.map((view) => (
                <ResultFieldControl key={view.spec.key} state={state} card={card} view={view} />
              ))}
            </div>
            <RawFieldsDisclosure card={card} />
          </>
        ) : (
          <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-300">
            {JSON.stringify(card.value, null, 2)}
          </pre>
        )}
      </article>
    </li>
  );
}

/** One field of a card, rendered by its spec's `kind` (see `lib/quest-results.ts`). */
function ResultFieldControl({
  state,
  card,
  view,
}: {
  state: ResultListDocumentState;
  card: ResultCardView;
  view: ResultFieldView;
}): JSX.Element {
  const id = useId();
  const describedBy = `${id}-help`;
  const messagesId = `${id}-messages`;
  const field = view.spec;
  // Story p3-09: this field's findings at its own document path — the general rules' warnings
  // (an unknown drop-table name, an id no table holds) and the blocking TemplateID/$type
  // errors. Rendered below the control by `Labelled`.
  const messages = useFieldMessages(view.path);

  if (field.kind === 'friendly-name') {
    return (
      <NameField
        state={state}
        card={card}
        view={view}
        describedBy={describedBy}
        messagesId={messagesId}
      />
    );
  }
  if (field.kind === 'router') {
    return <RouterField state={state} card={card} view={view} describedBy={describedBy} />;
  }
  if (field.kind === 'requirements') {
    return (
      <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
        <span className="text-xs text-zinc-400">
          <TermLabel term={{ field: field.key }} />
        </span>
        <RequirementTreeEditor
          state={state}
          path={resultRequirementsPath(card.listPath, card.index)}
          label={`Requirements for ${docPathWords(card.path)}`}
        />
        <p id={describedBy} className="text-xs text-zinc-400">
          {field.help}
        </p>
      </div>
    );
  }

  return (
    <Labelled
      id={id}
      fieldKey={field.key}
      help={field.help}
      helpId={describedBy}
      messages={messages}
      messagesId={messagesId}
    >
      {field.kind === 'boolean' ? (
        <input
          id={id}
          aria-describedby={describedBy}
          type="checkbox"
          checked={view.value === true}
          className="h-4 w-4 accent-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          onChange={(event) =>
            state.edit(
              setResultBooleanFieldEdit(card.listPath, card.index, field.key, event.target.checked),
            )
          }
        />
      ) : field.kind === 'enum' ? (
        <select
          id={id}
          aria-describedby={describedBy}
          value={resultSelectValue(view.value)}
          className={CONTROL_CLASS}
          onChange={(event) =>
            state.edit(
              setResultTextFieldEdit(
                card.listPath,
                card.index,
                field.key,
                view.present,
                event.target.value,
              ),
            )
          }
        >
          {resultSelectOptions(view.value, field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {optionText(field.key, option)}
            </option>
          ))}
        </select>
      ) : field.kind === 'number' ? (
        <input
          id={id}
          aria-describedby={describedBy}
          type="number"
          value={resultScalarText(view.value)}
          className={CONTROL_CLASS}
          onChange={(event) =>
            state.edit(
              setResultNumberFieldEdit(
                card.listPath,
                card.index,
                field.key,
                view.present,
                event.target.value,
              ),
            )
          }
        />
      ) : (
        <input
          id={id}
          aria-describedby={describedBy}
          type="text"
          value={resultScalarText(view.value)}
          className={CONTROL_CLASS}
          onChange={(event) =>
            state.edit(
              setResultTextFieldEdit(
                card.listPath,
                card.index,
                field.key,
                view.present,
                event.target.value,
              ),
            )
          }
        />
      )}
    </Labelled>
  );
}

/**
 * A friendly-name field.
 *
 * One declared source is the ordinary case: the dropdown reads and writes the raw id and
 * displays the resolved name, and a miss displays the raw id itself (AGENTS.md rule 5,
 * spec-domain-reference L693-695). A field with **two** declared sources is the measured
 * `ResDrawHand.m_templateID` ambiguity, and it gets a source toggle: a UI-only choice,
 * defaulted from where the value actually resolves. The two cases are two components on
 * purpose — the dual one needs both names lists to derive its default, and the ordinary one
 * must not fetch a second table for nothing.
 */
function NameField({
  state,
  card,
  view,
  describedBy,
  messagesId,
}: {
  state: ResultListDocumentState;
  card: ResultCardView;
  view: ResultFieldView;
  describedBy: string;
  messagesId: string;
}): JSX.Element {
  const field = view.spec;
  const sources = field.nameSources ?? [];
  const id = useId();
  const messages = useFieldMessages(view.path);
  const raw =
    typeof view.value === 'string' || typeof view.value === 'number' ? String(view.value) : '';

  if (sources.length === 0) {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-xs text-zinc-400">
          <TermLabel term={{ field: field.key }} />
        </span>
        <p className="text-xs text-zinc-400">{field.help}</p>
      </div>
    );
  }

  if (sources.length > 1) {
    return (
      <DualSourceNameField
        state={state}
        card={card}
        view={view}
        sources={sources}
        raw={raw}
        describedBy={describedBy}
        messagesId={messagesId}
      />
    );
  }

  return (
    <Labelled
      id={id}
      fieldKey={field.key}
      help={field.help}
      helpId={describedBy}
      messages={messages}
      messagesId={messagesId}
    >
      <FriendlyNameDropdown
        type={sources[0]}
        name={`${card.address}-${field.key}`}
        aria-label={termText({ field: field.key })}
        value={raw === '' ? null : raw}
        allowEmpty
        invalid={messages.some((message) => message.severity === 'error')}
        onChange={(rawId) =>
          state.edit(setResultIdFieldEdit(card.listPath, card.index, field, view.present, rawId))
        }
      />
    </Labelled>
  );
}

/**
 * The measured `ResDrawHand.m_templateID`: 6 of 8 distinct corpus values resolve in
 * `spells` and 2 in `npcs`, none in both, so one table would leave most real values
 * nameless. The toggle is UI-only state (never written to the document) and defaults to
 * whichever table the current value resolves in — `npcs`, the domain reference's own claim,
 * when neither does. An unresolved value keeps displaying itself and is never rewritten.
 */
function DualSourceNameField({
  state,
  card,
  view,
  sources,
  raw,
  describedBy,
  messagesId,
}: {
  state: ResultListDocumentState;
  card: ResultCardView;
  view: ResultFieldView;
  sources: readonly NamesType[];
  raw: string;
  describedBy: string;
  messagesId: string;
}): JSX.Element {
  const field = view.spec;
  const messages = useFieldMessages(view.path);
  const [chosen, setChosen] = useState<NamesType | null>(null);
  const spells = useNames('spells');
  const npcs = useNames('npcs');

  // The derived default is stable once the lists have loaded and is never written to the
  // document: switching the source only changes which table's labels the dropdown shows.
  const fallback = sources[1] ?? sources[0];
  const derived: NamesType = spells.isLoading
    ? fallback
    : raw !== '' && spells.labelFromList(raw) !== undefined
      ? (sources[0] ?? fallback)
      : raw !== '' && npcs.labelFromList(raw) !== undefined
        ? fallback
        : fallback;
  const effective = chosen ?? derived;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-zinc-400">
        <TermLabel term={{ field: field.key }} />
      </span>
      <div
        role="group"
        aria-label={`${NAME_SOURCE_LABEL} ${termText({ field: field.key })} ${docPathWords(card.path)}`}
        data-path={card.address}
        className="flex gap-1"
      >
        {sources.map((source) => (
          <Button
            key={source}
            type="button"
            size="sm"
            variant={effective === source ? 'default' : 'outline'}
            aria-pressed={effective === source}
            aria-label={`${sourceLabel(source)} for ${termText({ field: field.key })} ${docPathWords(card.path)}`}
            onClick={() => setChosen(source)}
          >
            {sourceLabel(source)}
          </Button>
        ))}
      </div>
      <FriendlyNameDropdown
        type={effective}
        name={`${card.address}-${field.key}`}
        aria-label={termText({ field: field.key })}
        value={raw === '' ? null : raw}
        allowEmpty
        invalid={messages.some((message) => message.severity === 'error')}
        onChange={(rawId) =>
          state.edit(setResultIdFieldEdit(card.listPath, card.index, field, view.present, rawId))
        }
      />
      <p id={describedBy} className="text-xs text-zinc-400">
        {field.help}
      </p>
      <FieldMessages messages={messages} id={messagesId} />
    </div>
  );
}

/** The visible word of one names table (`spells` → `Spells`). */
function sourceLabel(source: NamesType): string {
  if (source === 'spells') {
    return SPELLS_SOURCE_LABEL;
  }
  if (source === 'npcs') {
    return NPCS_SOURCE_LABEL;
  }
  return source;
}

/**
 * `m_router`'s six sub-controls, in the corpus's own order.
 *
 * The group is labelled with the field's own key and each sub-control with its own key, so
 * `getByLabel('m_locX')` inside a card is unambiguous. When `m_router` is absent the
 * sub-controls render the measured new-router shape ({@link soundRouterView}) with the
 * honest note, and the first edit writes the whole object — no `$type` is ever invented.
 */
function RouterField({
  state,
  card,
  view,
  describedBy,
}: {
  state: ResultListDocumentState;
  card: ResultCardView;
  view: ResultFieldView;
  describedBy: string;
}): JSX.Element {
  const field = view.spec;
  const router = view.value;
  const routerView = soundRouterView(card.value);
  const present = isPlainObject(router);

  return (
    <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
      <span className="text-xs text-zinc-400">
        <TermLabel term={{ field: field.key }} />
      </span>
      <div
        role="group"
        aria-label={termText({ field: SOUND_ROUTER_KEY })}
        className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-md border border-zinc-800 bg-zinc-950/40 p-3 sm:grid-cols-3"
      >
        {SOUND_ROUTER_FIELD_SPECS.map((sub) => {
          const subId = `${card.address}-${sub.key}`;
          const subValue = routerView[sub.key];
          return (
            <div key={sub.key} className="flex min-w-0 flex-col gap-1">
              <label htmlFor={subId} className="text-xs text-zinc-400">
                <TermLabel term={{ field: sub.key }} />
              </label>
              {sub.kind === 'boolean' ? (
                <input
                  id={subId}
                  type="checkbox"
                  checked={subValue === true}
                  className="h-4 w-4 accent-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
                  onChange={(event) =>
                    state.edit(
                      setRouterBooleanFieldEdit(
                        card.listPath,
                        card.index,
                        router,
                        sub,
                        event.target.checked,
                      ),
                    )
                  }
                />
              ) : sub.kind === 'enum' ? (
                <select
                  id={subId}
                  value={resultSelectValue(subValue)}
                  className={CONTROL_CLASS}
                  onChange={(event) =>
                    state.edit(
                      setRouterFieldEdit(
                        card.listPath,
                        card.index,
                        router,
                        sub,
                        present && Object.prototype.hasOwnProperty.call(router, sub.key),
                        event.target.value,
                      ),
                    )
                  }
                >
                  {resultSelectOptions(subValue, sub.options ?? []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {optionText(sub.key, option)}
                    </option>
                  ))}
                </select>
              ) : sub.kind === 'number' ? (
                <input
                  id={subId}
                  type="number"
                  value={resultScalarText(subValue)}
                  className={CONTROL_CLASS}
                  onChange={(event) =>
                    state.edit(
                      setRouterFieldEdit(
                        card.listPath,
                        card.index,
                        router,
                        sub,
                        present && Object.prototype.hasOwnProperty.call(router, sub.key),
                        event.target.value,
                      ),
                    )
                  }
                />
              ) : (
                <input
                  id={subId}
                  type="text"
                  value={resultScalarText(subValue)}
                  className={CONTROL_CLASS}
                  onChange={(event) =>
                    state.edit(
                      setRouterFieldEdit(
                        card.listPath,
                        card.index,
                        router,
                        sub,
                        present && Object.prototype.hasOwnProperty.call(router, sub.key),
                        event.target.value,
                      ),
                    )
                  }
                />
              )}
            </div>
          );
        })}
      </div>
      {present ? null : <p className="text-xs text-zinc-400">{ROUTER_ABSENT_NOTE}</p>}
      <p id={describedBy} className="text-xs text-zinc-400">
        {field.help}
      </p>
    </div>
  );
}

/**
 * The read-only disclosure of the keys this model does not know. The corpus matches the
 * domain reference exactly for all 14 types (no undocumented extras, unlike `ReqHasEntry`),
 * so this only ever appears for a legacy key — and a key that appears here survives every
 * edit because nothing writes over it.
 */
function RawFieldsDisclosure({ card }: { card: ResultCardView }): JSX.Element | null {
  const unmodelled = unmodelledResultKeys(card.value);
  if (unmodelled.length === 0) {
    return null;
  }
  return (
    <details className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/40">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950">
        {`${RAW_FIELDS_LABEL} (${unmodelled.length} unmodelled)`}
      </summary>
      <div className="border-t border-zinc-800 p-3">
        <p className="mb-2 text-xs text-amber-400">
          Keys this editor does not model — preserved untouched: {unmodelled.join(', ')}
        </p>
        <pre className="max-h-72 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-300">
          {JSON.stringify(rawResultFields(card.value), null, 2)}
        </pre>
      </div>
    </details>
  );
}

/** The `×` control on every card. */
function DeleteButton({
  state,
  listPath,
  index,
  path,
  address,
}: {
  state: ResultListDocumentState;
  listPath: DocPath;
  index: number;
  path: DocPath;
  address: string;
}): JSX.Element {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-label={`${DELETE_RESULT_LABEL} ${docPathWords(path)}`}
      data-path={address}
      onClick={() => state.editAll(deleteResultEdits(listPath, index))}
    >
      ×
    </Button>
  );
}

/** The bottom "Add Result" control and its 14-type selector. */
function AddResultControl({
  state,
  path,
  presence,
  count,
}: {
  state: ResultListDocumentState;
  path: DocPath;
  presence: { wrapper: boolean; items: boolean };
  count: number;
}): JSX.Element {
  const id = useId();
  const [type, setType] = useState<ResultShortTypeName>(DEFAULT_RESULT_TYPE);
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={id} className="font-mono text-xs text-zinc-400">
          {ADD_RESULT_TYPE_LABEL}
        </label>
        <select
          id={id}
          value={type}
          className={CONTROL_CLASS}
          onChange={(event) => setType(event.target.value as ResultShortTypeName)}
        >
          {resultTypeSelectOptions().map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <Button
        type="button"
        size="sm"
        onClick={() => state.editAll(addResultEdits(path, count, type, presence))}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {ADD_RESULT_LABEL}
      </Button>
    </div>
  );
}

/**
 * A labelled control: the visible label (the field's glossary pair, task 7.9), the control, and
 * the field's one-line help.
 */
function Labelled({
  id,
  fieldKey,
  help,
  helpId,
  messages = [],
  messagesId,
  children,
}: {
  id: string;
  fieldKey: string;
  help?: string;
  helpId?: string;
  /** Story p3-09: this field's findings, rendered below the control. */
  messages?: readonly FieldValidationMessage[];
  messagesId?: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs text-zinc-400">
        <TermLabel term={{ field: fieldKey }} />
      </label>
      {children}
      {help === undefined || help === '' ? null : (
        <p id={helpId} className="text-xs text-zinc-400">
          {help}
        </p>
      )}
      <FieldMessages messages={messages} id={messagesId} />
    </div>
  );
}

/** A select option's text: an enum value as its glossary pair, an unlisted one marked so. */
function optionText(fieldKey: string, option: ResultSelectOption): string {
  const text = option.value === '' ? option.label : fieldValueText(fieldKey, option.value);
  return option.unlisted ? `${text} (unlisted)` : text;
}

/** The shared input/select styling (the same classes the other live panels use). */
const CONTROL_CLASS =
  'min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950';

/** `true` for a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
