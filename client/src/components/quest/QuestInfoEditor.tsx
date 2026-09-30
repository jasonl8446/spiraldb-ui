import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';

import {
  FieldMessages,
  fieldAriaInvalid,
  fieldDescribedBy,
  useFieldMessages,
  type FieldValidationMessage,
} from '../shared/FieldValidation';
import type { QuestDocumentState } from '../../hooks/useQuestDocument';
import { getName, nameLookupQueryKey } from '../../lib/api';
import { relativeTime } from '../../lib/display';
import {
  activityTypeOptions,
  activityTypeSelectValue,
  clientTagsEdit,
  clientTagsToText,
  booleanFieldEdit,
  numberFieldEdit,
  QUEST_ADVANCED_FIELDS,
  QUEST_TIMESTAMP_LABEL,
  QUEST_VISIBLE_FIELDS,
  questTitleDisplay,
  shouldLookupStringKey,
  textFieldEdit,
  type QuestFieldSpec,
} from '../../lib/quest-info';
import { withValidationBorder } from '../../lib/quest-validation';
import { cn } from '../../lib/utils';
import TermLabel from '../TermLabel';

/**
 * `QuestInfoEditor` — the Info tab's editor (plan task 3.3, story p3-03;
 * docs/spec-ui-design.md L296-298).
 *
 * It renders **two columns** from `lib/quest-info.ts`'s field model and writes every
 * change through {@link QuestDocumentState}, which is `shared/document.ts`'s
 * primitives (D58): no control here spreads a document, and no control injects a
 * default. The inventory lives in the model because that is what makes "none dropped"
 * checkable; this component only decides how each {@link QuestFieldSpec} renders.
 *
 * Three deliberate behaviours, all recorded in the story report:
 *
 * 1. **Emptying an editable field deletes its key** rather than writing `''`: the
 *    model's `*FieldEdit` helpers return `{ op: 'delete' }` when the key was present
 *    and `null` (no edit at all) when it was not, so clearing an already-absent field
 *    can never create one (D57).
 * 2. **A checkbox that renders unchecked is not the same as `false`.** An absent or
 *    `null` boolean renders unchecked and is left untouched until the user actually
 *    toggles it — otherwise merely opening the tab would write `false` over absence.
 * 3. **The title is a text edit of the string-table key with the resolved string
 *    beside it.** Only `m_questName` is read-only in the spec's list; an unresolvable
 *    key shows itself verbatim, and the empty key is never looked up at all
 *    (`shouldLookupStringKey`): `GET /api/names/strings/` falls through to the LIST
 *    route and answers 24 MB.
 *
 * The header's Edit/Save toggle, the dirty-state guard and the save itself are task
 * 3.10 — this component only edits local document state.
 */
export interface QuestInfoEditorProps {
  /** The live document + its mutations (`useQuestDocument`). */
  state: QuestDocumentState;
  /** The browse row's `modified_at` — the spec's read-only "timestamps" (L298). */
  modifiedAt?: string | null;
}

export default function QuestInfoEditor({ state, modifiedAt }: QuestInfoEditorProps): JSX.Element {
  const left = QUEST_VISIBLE_FIELDS.filter((field) => field.column === 'left');
  const right = QUEST_VISIBLE_FIELDS.filter((field) => field.column === 'right');

  return (
    <section aria-label="Quest info editor" className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          {left.map((field) => (
            <FieldEditor key={field.key} field={field} state={state} />
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {right.map((field) => (
            <FieldEditor key={field.key} field={field} state={state} />
          ))}
          <TimestampField modifiedAt={modifiedAt} />
        </div>
      </div>

      {/*
        Native `<details>` rather than a hand-rolled disclosure: it is the element
        that already carries the keyboard and screen-reader behaviour a collapse
        needs, and it needs no state of its own.
      */}
      <details className="rounded-md border border-zinc-800 bg-zinc-950/40">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950">
          Advanced
        </summary>
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 border-t border-zinc-800 p-3 md:grid-cols-2">
          {QUEST_ADVANCED_FIELDS.map((field) => (
            <FieldEditor key={field.key} field={field} state={state} />
          ))}
        </div>
      </details>
    </section>
  );
}

/** One field: its label, its control, and the field table's own one-line help. */
function FieldEditor({
  field,
  state,
}: {
  field: QuestFieldSpec;
  state: QuestDocumentState;
}): JSX.Element {
  const id = useId();
  const helpId = `${id}-help`;
  const messagesId = `${id}-messages`;
  const path = [field.key];
  const value = state.value(path);
  const present = state.has(path);
  // Story p3-09: the field's own findings, at its own document path. Only the six blocking
  // quest rules can target this tab (`m_questName`), and a warning on a scalar here would be
  // the general rules'.
  const messages = useFieldMessages(path);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs text-zinc-400">
        <TermLabel term={{ field: field.key }} />
      </label>
      <FieldControl
        field={field}
        id={id}
        helpId={helpId}
        messagesId={messagesId}
        messages={messages}
        value={value}
        present={present}
        state={state}
      />
      {field.key === 'm_questTitle' ? <TitleResolution value={value} /> : null}
      <FieldMessages messages={messages} id={messagesId} />
      {field.help === '' ? null : (
        <p id={helpId} className="text-xs text-zinc-400">
          {field.help}
        </p>
      )}
    </div>
  );
}

function FieldControl({
  field,
  id,
  helpId,
  messagesId,
  messages,
  value,
  present,
  state,
}: {
  field: QuestFieldSpec;
  id: string;
  helpId: string;
  messagesId: string;
  messages: readonly FieldValidationMessage[];
  value: unknown;
  present: boolean;
  state: QuestDocumentState;
}): JSX.Element {
  const inputClass = withValidationBorder(
    'min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
    messages,
  );
  const describedBy = fieldDescribedBy(
    messages,
    messagesId,
    field.help === '' ? undefined : helpId,
  );
  const ariaInvalid = fieldAriaInvalid(messages);
  const edit = state.edit;

  switch (field.kind) {
    case 'readonly':
      // A read-only `<input>` rather than a `<p>`: it is a labelable element, so the
      // field's own `<label>` still names it (`getByLabel` in the tier-1 specs), and
      // the value stays selectable and copyable like the rest of the form.
      return (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={ariaInvalid}
          type="text"
          readOnly
          value={scalarText(value)}
          className={withValidationBorder(
            'min-w-0 cursor-default rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-sm text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
            messages,
          )}
        />
      );
    case 'boolean':
      return (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={ariaInvalid}
          type="checkbox"
          checked={value === true}
          className="h-4 w-4 accent-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          onChange={(event) => edit(booleanFieldEdit(field.key, event.target.checked))}
        />
      );
    case 'number':
      return (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={ariaInvalid}
          type="number"
          value={scalarText(value)}
          className={inputClass}
          onChange={(event) => edit(numberFieldEdit(field.key, present, event.target.value))}
        />
      );
    case 'select':
      return (
        <select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={ariaInvalid}
          value={activityTypeSelectValue(value)}
          className={inputClass}
          onChange={(event) => edit(textFieldEdit(field.key, present, event.target.value))}
        >
          {activityTypeOptions(value).map((option) => (
            <option key={option.value} value={option.value}>
              {option.unlisted ? `${option.label} (unlisted)` : option.label}
            </option>
          ))}
        </select>
      );
    case 'tags':
      return (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={ariaInvalid}
          type="text"
          value={clientTagsToText(value)}
          placeholder="comma, separated, tags"
          className={inputClass}
          onChange={(event) => edit(clientTagsEdit(field.key, present, event.target.value))}
        />
      );
    case 'text':
      return (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={ariaInvalid}
          type="text"
          value={scalarText(value)}
          className={inputClass}
          onChange={(event) => edit(textFieldEdit(field.key, present, event.target.value))}
        />
      );
  }
}

/**
 * The resolved `m_questTitle`: one `GET /api/names/strings/:key` read (never the
 * list), enabled only for a non-empty key, with a miss rendering the raw key — see
 * the module header's rule 3.
 */
function TitleResolution({ value }: { value: unknown }): JSX.Element | null {
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

/** The spec's read-only "timestamps" — the browse row's own `modified_at`. */
function TimestampField({ modifiedAt }: { modifiedAt?: string | null }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-mono text-xs text-zinc-400">{QUEST_TIMESTAMP_LABEL}</span>
      <p
        className={cn('text-sm', modifiedAt ? 'text-zinc-300' : 'text-zinc-400')}
        title={modifiedAt ?? undefined}
      >
        {modifiedAt ? relativeTime(modifiedAt) : '—'}
      </p>
    </div>
  );
}

/** A scalar document value as an input's text — `null`/absent render empty. */
function scalarText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  // A non-scalar here means the document disagrees with the field table; showing the
  // JSON keeps the content visible instead of blanking it.
  return JSON.stringify(value);
}
