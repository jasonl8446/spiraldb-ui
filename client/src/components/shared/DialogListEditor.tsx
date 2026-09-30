import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useId, useState } from 'react';

import type { DocEdit, DocPath } from '@shared/document';

import { hasAdvancedValue } from '../../lib/advanced';
import { getName, nameLookupQueryKey } from '../../lib/api';
import {
  ADD_DIALOG_ENTRY_LABEL,
  ADD_DIALOG_TAG_LABEL,
  DELETE_ENTRY_LABEL,
  DIALOG_ACCORDIONS,
  DIALOG_LIST_EDITOR_LABEL,
  DUPLICATE_ENTRY_LABEL,
  NO_DIALOG_ENTRIES_TEXT,
  NO_DIALOG_LIST_TEXT,
  NO_DIALOG_TAGS_TEXT,
  RAW_FIELDS_LABEL,
  REQUIREMENTS_FIXTURE_NOTE,
  STRING_LIST_NOTE,
  TAG_NOTE,
  UNREADABLE_ENTRY_TEXT,
  UNREADABLE_GROUP_TEXT,
  addDialogEntryEdits,
  addDialogTagEdits,
  deleteEntryEdits,
  dialogFieldsInAccordion,
  dialogGroupsPath,
  dialogNumberOptions,
  dialogNumberSelectValue,
  dialogScalarText,
  dialogSelectOptions,
  duplicateEntryEdits,
  rawEntryFields,
  readDialogList,
  setDialogTagEdit,
  setEntryBooleanFieldEdit,
  setEntryIdFieldEdit,
  setEntryNumberFieldEdit,
  setEntryNumberSelectEdit,
  setEntryStringListEdit,
  setEntryTextFieldEdit,
  stringKeyDisplay,
  stringListToText,
  type DialogAccordionSpec,
  type DialogEntryFieldView,
  type DialogEntryView,
  type DialogFieldSpec,
  type DialogGroupView,
} from '../../lib/quest-dialog';
import { shouldLookupStringKey } from '../../lib/quest-info';
import { docPathWords, termText } from '../../lib/term';
import { cn } from '../../lib/utils';
import { useEvidenceCardFocus } from '../quest/EvidenceFocus';
import FriendlyNameDropdown from '../FriendlyNameDropdown';
import TermLabel from '../TermLabel';
import { withValidationBorder } from '../../lib/quest-validation';
import { useAutoOpen } from './AdvancedDisclosure';
import {
  FieldMessages,
  useAnyFieldMessages,
  useFieldMessages,
  type FieldValidationMessage,
} from './FieldValidation';
import { Button } from '../ui/button';
import RequirementTreeEditor from './RequirementTreeEditor';

/**
 * `DialogListEditor` — one `m_dialogList`'s tag sections and entry cards (plan task 3.8, story
 * p3-08; docs/spec-ui-design.md L420-454, docs/spec-domain-reference.md L444-523).
 *
 * It lives in `components/shared/` for the same reason `ResultListEditor` and
 * `RequirementTreeEditor` do: it is **host-agnostic**. Its props are a {@link DocPath} — an
 * `ActorDialogList` wrapper — plus a document state, and it never sees a "quest". Two levels
 * mount it in this repository already (a quest's `m_dialogList`, present in 322/322 corpus
 * files, and each goal's, present in 445 of the 772 with 327 explicit `null`s), and a Phase-4
 * host can mount it again with nothing but a different path.
 *
 * Every rule and every label is in `lib/quest-dialog.ts`; this component only decides how a
 * tag section and an entry card render and routes each change through the state's
 * `edit`/`editAll` — the `shared/document.ts` primitives (D58). **No control here spreads a
 * document, rebuilds an entry, or injects a default**: the builders return `DocEdit`s, and an
 * edit of one field is one `set`/`delete` of one key, which is what keeps an existing corpus
 * entry's key order, explicit `null`s, unmodelled keys and absent keys exactly as they were
 * (D57). The one exception is *Add Dialog Tag*, which writes a whole new group — including the
 * one default entry the lead's D57-consistency decision requires, because 0 of the 739 corpus
 * groups has an empty `m_dialogEntries`.
 *
 * Eight deliberate behaviours, all recorded in the story report:
 *
 * 1. **Nothing is written on mount.** Merely opening the tab mounts the sections and the
 *    controls; every builder fires only from a user action (D57).
 * 2. **The field keys are the labels, as glossary pairs.** Each control's visible label and
 *    accessible name is the document key's `Friendly (technical)` pair (`Dialog text (m_dialog)`,
 *    D131, task 7.9), and the card's own name disambiguates the repeats — the same habit
 *    `ResultListEditor` and `QuestGoalsEditor` have.
 * 3. **The five accordions are the spec's `[Basic][Camera][Sound][Animation][Advanced]`**, with
 *    Basic open by default and the other four collapsed (spec L554). They are real disclosure
 *    buttons (`aria-expanded` + `aria-controls`), not `<details>`, so their state is
 *    assertable. Each renders the fields of its domain groups in the corpus's own key order.
 * 4. **A friendly-name field is a real dropdown per declared source** (npcs for the two
 *    template ids, zones for `m_cameraZoneName`), and an unresolved value — `0` on 330 corpus
 *    entries, an interior zone variant on 14 of 87 paths, a template id no table knows — stays
 *    displayed, selected and **byte-identical** (AGENTS.md rule 5 + the D60(c) miss-safe rule).
 * 5. **A string-key field is a text input with the resolved string beside it** (the p3-03
 *    pattern), and an empty or `null` key issues **no** request at all — the D59(d) hazard,
 *    because `GET /api/names/strings/` answers the whole 216,991-row table.
 * 6. **`m_requirements` mounts the shared `RequirementTreeEditor`**, never a second tree, with
 *    an honest note that the corpus never carries one (null in 1706/1706 — fixture-only here).
 * 7. **The string lists are one encoded element per line**, written back verbatim; the help
 *    text shows the corpus's own encoding and nothing is decomposed, reordered or reformatted.
 * 8. **A legacy key is surfaced in the card's raw-fields disclosure** and a legacy group key in
 *    the section's group-fields disclosure, so nothing is silently hidden (D5/AC2).
 *
 * **Accessibility vocabulary** (every control has a real accessible name; the tier-1 spec
 * addresses the same names):
 *
 * | element | accessible name | how |
 * |---|---|---|
 * | the list's container | the `label` prop (default `Dialog list editor`) | `<section aria-label>` → a `region` |
 * | a tag section | `Dialog tag <n> <words>` (`Dialog tag 1 Dialog list › Dialog blocks 1`) | `<section aria-label>` + `data-path` (the address) |
 * | the tag control | `Dialog tag (m_dialogTag)` | a real `<label htmlFor>` |
 * | an entry card | `Entry <n> <words>` | `<article aria-label>` + `data-path` |
 * | an accordion | `Basic` / `Camera` / `Sound` / `Animation` / `Advanced` | the button's own text + `aria-expanded` |
 * | an accordion's body | `<label> fields` (`Basic fields`) | `role="group" aria-label` |
 * | a text/number/boolean/select field | its glossary pair (`Dialog text (m_dialog)`), via a real `<label htmlFor>` | see {@link DialogFieldControl} |
 * | a friendly-name field | its glossary pair | `aria-label` on the combobox (a `<button>` cannot be named by `htmlFor`) |
 * | the requirement slot | `Requirements for <words>` | the shared tree's `<section aria-label>` |
 * | duplicate | `Duplicate <words>` | `aria-label` + `data-path` on a button |
 * | delete | `Delete <words>` | `aria-label` + `data-path` on a button |
 * | Add Dialog Entry | `Add Dialog Entry` (scoped to its tag section) | button text |
 * | Add Dialog Tag / its selector | `Add Dialog Tag` / `New dialog tag` | button text + a real `<label htmlFor>` |
 * | the raw-fields disclosure | `Raw fields (N unmodelled)` | `<summary>` |
 * | the group-fields disclosure | `Group fields (N unmodelled)` | `<summary>` |
 */
export interface DialogListEditorProps {
  /**
   * The document state this list mutates: a structural subset of `useQuestDocument`'s
   * `QuestDocumentState`, declared here so a Phase-4 host (or a unit render) can satisfy it
   * without importing the quest hook.
   */
  state: DialogListDocumentState;
  /** The absolute path of the `m_dialogList` wrapper this editor owns. */
  path: DocPath;
  /** The container's accessible name. Defaults to `Dialog list editor`. */
  label?: string;
  /** Present for symmetry with the other live panels; a dialog tag has no timestamp row. */
  modifiedAt?: string | null;
  className?: string;
}

/** The four mutations the list needs — `shared/document.ts`'s contract, nothing more. */
export interface DialogListDocumentState {
  /** `true` when {@link path} exists (never throws). */
  has: (path: DocPath) => boolean;
  /** The value at {@link path}, or `undefined` when it does not exist. */
  value: (path: DocPath) => unknown;
  /** Applies one edit; `null` is a no-op. */
  edit: (edit: DocEdit | null) => void;
  /** Applies several edits in order. */
  editAll: (edits: readonly DocEdit[]) => void;
}

export default function DialogListEditor({
  state,
  path,
  label = DIALOG_LIST_EDITOR_LABEL,
  className,
}: DialogListEditorProps): JSX.Element {
  const view = readDialogList(path, state.value(path));
  const dialogsValue = state.value(dialogGroupsPath(path));

  return (
    <section aria-label={label} className={cn('flex min-w-0 flex-col gap-3', className)}>
      {!view.readable ? (
        <p className="text-sm text-zinc-400">{NO_DIALOG_LIST_TEXT}</p>
      ) : view.groups.length === 0 ? (
        <p className="text-sm text-zinc-400">{NO_DIALOG_TAGS_TEXT}</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-4">
          {view.groups.map((group) => (
            <DialogTagSection key={group.address} state={state} view={group} />
          ))}
        </ul>
      )}

      <AddDialogTagControl
        state={state}
        path={path}
        presence={{ list: view.readable, dialogs: Array.isArray(dialogsValue) }}
        count={view.groups.length}
      />
    </section>
  );
}

/** One tag section: its tag control, its entry cards, its group fields and its Add control. */
function DialogTagSection({
  state,
  view,
}: {
  state: DialogListDocumentState;
  view: DialogGroupView;
}): JSX.Element {
  return (
    <li className="min-w-0">
      <section
        aria-label={`Dialog tag ${view.index + 1} ${docPathWords(view.path)}`}
        data-path={view.address}
        className="min-w-0 rounded-md border border-zinc-800 border-l-4 border-l-blue-500 bg-zinc-900/30 p-3"
      >
        <header className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-zinc-400">{view.index + 1}</span>
          <span className="rounded bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-200">
            {view.tagLabel}
          </span>
          <span className="text-xs text-zinc-400">
            {view.entries.length === 1 ? '1 entry' : `${view.entries.length} entries`}
          </span>
        </header>

        <div className="mt-3 flex min-w-0 flex-col gap-1">
          <label htmlFor={`${view.address}-tag`} className="text-xs text-zinc-400">
            <TermLabel term={{ field: 'm_dialogTag' }} />
          </label>
          <input
            id={`${view.address}-tag`}
            type="text"
            value={view.tag ?? ''}
            className={CONTROL_CLASS}
            onChange={(event) =>
              state.edit(setDialogTagEdit(view.listPath, view.index, event.target.value))
            }
          />
          <p className="text-xs text-zinc-400">{TAG_NOTE}</p>
        </div>

        {!view.readable ? (
          <div className="mt-3 flex min-w-0 flex-col gap-1">
            <p className="text-xs text-amber-400">{UNREADABLE_GROUP_TEXT}</p>
            <pre className="max-h-72 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-300">
              {JSON.stringify(view.value, null, 2)}
            </pre>
          </div>
        ) : view.entries.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-400">{NO_DIALOG_ENTRIES_TEXT}</p>
        ) : (
          <ul className="mt-3 flex min-w-0 flex-col gap-3">
            {view.entries.map((entry) => (
              <DialogEntryCard key={entry.address} state={state} view={entry} />
            ))}
          </ul>
        )}

        <GroupFieldsDisclosure view={view} />

        <div className="mt-3">
          <Button
            type="button"
            size="sm"
            onClick={() =>
              state.editAll(
                addDialogEntryEdits(view.listPath, view.index, view.entries.length, {
                  entries: view.entriesPresent,
                }),
              )
            }
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {ADD_DIALOG_ENTRY_LABEL}
          </Button>
        </div>
      </section>
    </li>
  );
}

/**
 * The group's four untouched sibling keys (`m_madlibs`, `m_dialogEvents`, the two aggro flags)
 * and any key the model does not know, shown read-only so nothing is silently hidden. The
 * corpus's `m_madlibs` is real content (an array in 705 groups), so the disclosure is not
 * decoration.
 */
function GroupFieldsDisclosure({ view }: { view: DialogGroupView }): JSX.Element | null {
  const raw = {
    m_madlibs: view.madlibs,
    m_dialogEvents: view.dialogEvents,
    ...Object.fromEntries(
      view.unmodelledKeys.map((key) => [key, (view.value as Record<string, unknown>)[key]]),
    ),
  };
  return (
    <details className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/40">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950">
        {`Group fields (${view.unmodelledKeys.length} unmodelled)`}
      </summary>
      <div className="border-t border-zinc-800 p-3">
        <p className="mb-2 text-xs text-zinc-400">
          Read-only — this editor never writes m_madlibs, m_dialogEvents, the two aggro flags or a
          key it does not know.
        </p>
        <pre className="max-h-72 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-300">
          {JSON.stringify(raw, null, 2)}
        </pre>
      </div>
    </details>
  );
}

/** One entry card: its header, its five accordions and its raw-fields disclosure. */
function DialogEntryCard({
  state,
  view,
}: {
  state: DialogListDocumentState;
  view: DialogEntryView;
}): JSX.Element {
  /**
   * The evidence panel's focus channel (story p6-08): focusing anything in this card reports the
   * entry as focused, so an evidence dialogue row's insert writes **this** entry's `m_dialog` —
   * the plan's "dialogue into the focused `m_dialog`". The entry is the right granularity (that is
   * what a user focuses), and the target follows from its own path. No provider is mounted in a
   * unit render or a Phase-4 host, and the channel is a no-op there.
   */
  const evidenceCardFocus = useEvidenceCardFocus([...view.path, 'm_dialog']);
  return (
    <li className="min-w-0">
      <article
        aria-label={`Entry ${view.index + 1} ${docPathWords(view.path)}`}
        data-path={view.address}
        className="min-w-0 rounded-md border border-zinc-800 bg-zinc-900/40 p-3"
        {...evidenceCardFocus}
      >
        <header className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-zinc-400">{view.ordinal}</span>
          {view.personaName === null ? (
            <TermLabel term={{ type: 'NPCDialogEntry' }} className="text-sm text-zinc-100" />
          ) : (
            <span className="font-mono text-sm text-zinc-100">{view.personaName}</span>
          )}
          {view.typeString === null ? (
            <span className="text-xs text-amber-400">no $type — kept absent</span>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label={`${DUPLICATE_ENTRY_LABEL} ${docPathWords(view.path)}`}
              data-path={view.address}
              onClick={() =>
                state.editAll(
                  duplicateEntryEdits(view.listPath, view.groupIndex, view.index, view.value),
                )
              }
            >
              {DUPLICATE_ENTRY_LABEL}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`${DELETE_ENTRY_LABEL} ${docPathWords(view.path)}`}
              data-path={view.address}
              onClick={() =>
                state.editAll(deleteEntryEdits(view.listPath, view.groupIndex, view.index))
              }
            >
              ×
            </Button>
          </div>
        </header>

        {view.readable ? (
          <div className="mt-3 flex min-w-0 flex-col gap-2">
            {DIALOG_ACCORDIONS.map((accordion) => (
              <EntryAccordion key={accordion.id} accordion={accordion} state={state} view={view}>
                <div className="grid grid-cols-1 gap-x-6 gap-y-3 p-3 sm:grid-cols-2">
                  {dialogFieldsInAccordion(accordion).map((field) => (
                    <DialogFieldControl
                      key={field.key}
                      state={state}
                      view={view}
                      field={field}
                      fieldView={
                        view.fields.find(
                          (entry) => entry.spec.key === field.key,
                        ) as DialogEntryFieldView
                      }
                    />
                  ))}
                </div>
              </EntryAccordion>
            ))}
            <RawFieldsDisclosure view={view} />
          </div>
        ) : (
          <div className="mt-3 flex min-w-0 flex-col gap-1">
            <p className="text-xs text-amber-400">{UNREADABLE_ENTRY_TEXT}</p>
            <pre className="max-h-72 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-300">
              {JSON.stringify(view.value, null, 2)}
            </pre>
          </div>
        )}
      </article>
    </li>
  );
}

/**
 * One accordion: a real disclosure button plus its body. The body is always rendered and simply
 * `hidden` when collapsed, so `aria-controls` always points at a real element and a spec can
 * assert the collapsed state directly; Basic starts open (spec L554).
 */
function EntryAccordion({
  accordion,
  state,
  view,
  children,
}: {
  accordion: DialogAccordionSpec;
  state: DialogListDocumentState;
  view: DialogEntryView;
  children: JSX.Element;
}): JSX.Element {
  // Task 7.11 (D132): a non-Basic accordion opens on load when one of its fields differs from the
  // skeleton default, and opens (and stays open) when one has a validation error, so neither a
  // value nor an error is ever hidden. Basic is open by default.
  const paths = dialogFieldsInAccordion(accordion).map((field) => [...view.path, field.key]);
  const hasError = useAnyFieldMessages(paths);
  const mustOpen = accordion.id !== 'Basic' && hasAdvancedValue(state, paths);
  const [open, setOpen] = useAutoOpen(mustOpen, hasError, accordion.openByDefault);
  const id = useId();
  const panelId = `${id}-panel`;
  return (
    <div className="min-w-0 rounded-md border border-zinc-800 bg-zinc-950/40">
      <button
        type="button"
        id={`${id}-button`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
        <TermLabel term={{ group: accordion.id }} />
      </button>
      <div
        id={panelId}
        role="group"
        aria-label={`${accordion.label} fields`}
        hidden={!open}
        className="border-t border-zinc-800"
      >
        {children}
      </div>
    </div>
  );
}

/** One field of a card, rendered by its spec's `kind` (see `lib/quest-dialog.ts`). */
function DialogFieldControl({
  state,
  view,
  field,
  fieldView,
}: {
  state: DialogListDocumentState;
  view: DialogEntryView;
  field: DialogFieldSpec;
  fieldView: DialogEntryFieldView;
}): JSX.Element {
  const id = useId();
  const describedBy = `${id}-help`;
  const messagesId = `${id}-messages`;
  const path = fieldView.path;
  // Story p3-09: this field's findings at its own path — the real data here is the 31 unlisted
  // `m_cameraZoneName` values in the corpus, plus an unknown `m_actorTemplateID`. They render
  // below the control (L547) and never block the save.
  const messages = useFieldMessages(path);
  // A red border on the offending input, a warning's amber one when nothing blocks (the same
  // split the inline list shows).
  const controlClass = withValidationBorder(CONTROL_CLASS, messages);
  const ariaInvalid = messages.some((message) => message.severity === 'error') ? true : undefined;

  if (field.kind === 'friendly-name') {
    const sources = field.nameSources ?? [];
    const raw =
      typeof fieldView.value === 'string' || typeof fieldView.value === 'number'
        ? String(fieldView.value)
        : '';
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
          type={sources[0] ?? 'npcs'}
          name={`${view.address}-${field.key}`}
          aria-label={termText({ field: field.key })}
          value={raw === '' ? null : raw}
          allowEmpty
          invalid={ariaInvalid}
          onChange={(rawId) =>
            state.edit(
              setEntryIdFieldEdit(
                view.listPath,
                view.groupIndex,
                view.index,
                field,
                fieldView.present,
                rawId,
              ),
            )
          }
        />
      </Labelled>
    );
  }

  if (field.kind === 'requirements') {
    return (
      <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
        <span className="text-xs text-zinc-400">
          <TermLabel term={{ field: field.key }} />
        </span>
        <RequirementTreeEditor
          state={state}
          path={path}
          label={`Requirements for ${docPathWords(view.path)}`}
        />
        <p id={describedBy} className="text-xs text-zinc-400">
          {REQUIREMENTS_FIXTURE_NOTE}
        </p>
      </div>
    );
  }

  if (field.kind === 'raw-object') {
    return (
      <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
        <span className="text-xs text-zinc-400">
          <TermLabel term={{ field: field.key }} />
        </span>
        <pre className="max-h-40 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-300">
          {fieldView.present ? JSON.stringify(fieldView.value, null, 2) : 'absent'}
        </pre>
        <p id={describedBy} className="text-xs text-zinc-400">
          {field.help}
        </p>
      </div>
    );
  }

  if (field.kind === 'string-list') {
    return (
      <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
        <label htmlFor={id} className="text-xs text-zinc-400">
          <TermLabel term={{ field: field.key }} />
        </label>
        <textarea
          id={id}
          aria-describedby={describedBy}
          rows={3}
          value={stringListToText(fieldView.value)}
          className={CONTROL_CLASS}
          onChange={(event) =>
            state.edit(
              setEntryStringListEdit(
                view.listPath,
                view.groupIndex,
                view.index,
                field.key,
                fieldView.present,
                event.target.value,
              ),
            )
          }
        />
        <p id={describedBy} className="text-xs text-zinc-400">
          {`${field.help} ${STRING_LIST_NOTE}`}
        </p>
      </div>
    );
  }

  if (field.kind === 'string-key') {
    return (
      <StringKeyField
        state={state}
        view={view}
        field={field}
        fieldView={fieldView}
        describedBy={describedBy}
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
      {field.kind === 'boolean' ? (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={ariaInvalid}
          type="checkbox"
          checked={fieldView.value === true}
          className="h-4 w-4 accent-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          onChange={(event) =>
            state.edit(
              setEntryBooleanFieldEdit(
                view.listPath,
                view.groupIndex,
                view.index,
                field.key,
                event.target.checked,
              ),
            )
          }
        />
      ) : field.kind === 'number-select' ? (
        <select
          id={id}
          aria-describedby={describedBy}
          aria-invalid={ariaInvalid}
          value={dialogNumberSelectValue(fieldView.value)}
          className={controlClass}
          onChange={(event) =>
            state.edit(
              setEntryNumberSelectEdit(
                view.listPath,
                view.groupIndex,
                view.index,
                field.key,
                fieldView.present,
                event.target.value,
              ),
            )
          }
        >
          {dialogNumberOptions(fieldView.value, (field.options ?? []) as number[]).map((option) => (
            <option key={String(option.value)} value={option.value}>
              {option.unlisted ? `${option.label} (unlisted)` : option.label}
            </option>
          ))}
        </select>
      ) : field.kind === 'number' ? (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={ariaInvalid}
          type="number"
          value={dialogScalarText(fieldView.value)}
          className={controlClass}
          onChange={(event) =>
            state.edit(
              setEntryNumberFieldEdit(
                view.listPath,
                view.groupIndex,
                view.index,
                field.key,
                fieldView.present,
                event.target.value,
              ),
            )
          }
        />
      ) : (
        <input
          id={id}
          aria-describedby={describedBy}
          aria-invalid={ariaInvalid}
          type="text"
          value={dialogScalarText(fieldView.value)}
          className={controlClass}
          onChange={(event) =>
            state.edit(
              setEntryTextFieldEdit(
                view.listPath,
                view.groupIndex,
                view.index,
                field.key,
                fieldView.present,
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
 * A string-key field: the raw key as a text input (with the measured suggestions offered
 * through a `datalist` where the corpus has some — `m_nameSTKey`'s two format keys) plus the
 * resolved string beside it.
 *
 * The lookup is one `GET /api/names/strings/:key` and is **enabled only for a non-empty key**:
 * the empty-key guard is load-bearing, because `/api/names/strings/` falls through Express's
 * `/:type/:id` match to the LIST route and answers the whole 216,991-row table (D59(d)). A miss
 * (a 404) shows the raw key verbatim; nothing is rewritten by rendering.
 */
function StringKeyField({
  state,
  view,
  field,
  fieldView,
  describedBy,
}: {
  state: DialogListDocumentState;
  view: DialogEntryView;
  field: DialogFieldSpec;
  fieldView: DialogEntryFieldView;
  describedBy: string;
}): JSX.Element {
  const id = useId();
  const listId = `${id}-keys`;
  const key = shouldLookupStringKey(fieldView.value) ? fieldView.value : null;
  const lookup = useQuery({
    queryKey: nameLookupQueryKey('strings', key ?? ''),
    queryFn: () => getName('strings', key ?? ''),
    enabled: key !== null,
    retry: false,
  });
  const options = (field.options ?? []) as string[];

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs text-zinc-400">
        <TermLabel term={{ field: field.key }} />
      </label>
      <input
        id={id}
        aria-describedby={describedBy}
        type="text"
        list={options.length > 0 ? listId : undefined}
        value={dialogScalarText(fieldView.value)}
        className={CONTROL_CLASS}
        onChange={(event) =>
          state.edit(
            setEntryTextFieldEdit(
              view.listPath,
              view.groupIndex,
              view.index,
              field.key,
              fieldView.present,
              event.target.value,
            ),
          )
        }
      />
      {options.length > 0 ? (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}
      {key !== null ? (
        <p className="truncate text-xs text-zinc-400" title={stringKeyDisplay(key, lookup.data)}>
          {stringKeyDisplay(key, lookup.data)}
        </p>
      ) : null}
      <p id={describedBy} className="text-xs text-zinc-400">
        {field.help}
      </p>
    </div>
  );
}

/**
 * The read-only disclosure of the keys this model does not know. Unlike p3-06's `ReqHasEntry`,
 * **no corpus entry carries an unmodelled key** (all 66 distinct keys are modelled), so this
 * only ever appears for a genuine legacy key — and a key that appears here survives every edit
 * because nothing writes over it.
 */
function RawFieldsDisclosure({ view }: { view: DialogEntryView }): JSX.Element | null {
  if (view.unmodelledKeys.length === 0) {
    return null;
  }
  return (
    <details className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/40">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950">
        {`${RAW_FIELDS_LABEL} (${view.unmodelledKeys.length} unmodelled)`}
      </summary>
      <div className="border-t border-zinc-800 p-3">
        <p className="mb-2 text-xs text-amber-400">
          Keys this editor does not model — preserved untouched: {view.unmodelledKeys.join(', ')}
        </p>
        <pre className="max-h-72 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-300">
          {JSON.stringify(rawEntryFields(view.value), null, 2)}
        </pre>
      </div>
    </details>
  );
}

/** The bottom "Add Dialog Tag" control and its two-value tag selector. */
function AddDialogTagControl({
  state,
  path,
  presence,
  count,
}: {
  state: DialogListDocumentState;
  path: DocPath;
  presence: { list: boolean; dialogs: boolean };
  count: number;
}): JSX.Element {
  const id = useId();
  const [tag, setTag] = useState('Prep');
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={id} className="font-mono text-xs text-zinc-400">
          New dialog tag
        </label>
        <select
          id={id}
          value={tag}
          className={CONTROL_CLASS}
          onChange={(event) => setTag(event.target.value)}
        >
          {dialogSelectOptions(tag, ['Prep', 'Completion']).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <Button
        type="button"
        size="sm"
        onClick={() => state.editAll(addDialogTagEdits(path, count, presence, tag))}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {ADD_DIALOG_TAG_LABEL}
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
  /** Story p3-09: this field's findings, rendered below the control (L547). */
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

/** The shared input/select styling (the same classes the other live panels use). */
const CONTROL_CLASS =
  'min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950';
