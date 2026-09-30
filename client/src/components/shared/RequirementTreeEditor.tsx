import { useId, type ReactNode } from 'react';

import { formatDocPath, type DocEdit, type DocPath } from '@shared/document';
import { REQUIREMENT_OPERATORS, type RequirementOperator } from '@shared/quest/typeConstants';

import {
  addConditionEdits,
  addGroupEdits,
  DELETE_NODE_LABEL,
  GROUP_LABEL,
  ADD_CONDITION_LABEL,
  ADD_GROUP_LABEL,
  initializeTreeEdits,
  NO_REQUIREMENTS_TEXT,
  readRequirementTree,
  REQUIREMENT_LEAF_BORDER_CLASS,
  REQUIREMENT_OPERATOR_LABELS,
  REQUIREMENT_TREE_EDITOR_LABEL,
  requirementEffectiveOperator,
  requirementField,
  requirementGroupBorderClass,
  requirementSelectOptions,
  requirementSelectValue,
  requirementTypeSelectOptions,
  requirementTypeSelectValue,
  requirementTypeSpecByName,
  setBooleanFieldEdit,
  setLeafFieldEdit,
  setOperatorEdit,
  toggleApplyNOTEdit,
  UNREADABLE_NODE_TEXT,
  changeLeafTypeEdits,
  deleteNodeEdits,
  type RequirementFieldSpec,
  type RequirementNodeView,
  type RequirementSelectOption,
} from '../../lib/requirement-tree';
import { docPathWords, fieldValueText, termText } from '../../lib/term';
import { cn } from '../../lib/utils';
import FriendlyNameDropdown from '../FriendlyNameDropdown';
import TermLabel from '../TermLabel';
import { requirementCardTitle } from '../../lib/card-titles';
import { useCardNames } from '../../hooks/useCardNames';
import { FieldMessages, useFieldMessages } from './FieldValidation';
import { Button } from '../ui/button';

/**
 * `RequirementTreeEditor` — the recursive AND/OR requirement tree (plan task 3.6, story
 * p3-06; docs/spec-ui-design.md L388-416, docs/spec-domain-reference.md L416-440).
 *
 * It lives in `components/shared/` because it is **host-agnostic**: it is addressed by a
 * {@link RequirementTreeEditorProps.path} — a *requirement wrapper slot* — plus a document
 * state, and it never sees a "quest". Three different hosts mount it in this repository
 * already: a quest's `m_requirements` and `m_prepRequirements` (the Requirements tab) and
 * each goal's `m_goalRequirements`, and Phase 4 mounts it again on a DropTable item's
 * `Requirements` ([spec-domain-reference.md] L708-709) with nothing but a different path.
 *
 * Every rule and every label is in `lib/requirement-tree.ts`; this component only decides
 * how a node renders and routes each change through the state's `edit`/`editAll` — the
 * `shared/document.ts` primitives (D58). **No control here spreads a document**, rebuilds
 * a node, or injects a default: the builders return `DocEdit`s, and an edit of one field
 * is one `set`/`delete` of one key, which is what keeps an existing corpus node's key
 * order, explicit `null`s, unmodelled keys and absent keys exactly as they were (D57).
 *
 * Twelve components are deliberately absent: no undo stack, no drag-and-drop, no
 * validation, no new dependency (the tree is plain DOM — the story forbids a new one).
 * The header's Save toggle, the dirty guard and validation are tasks 3.10/3.09.
 *
 * **Accessibility vocabulary** (every control has a real accessible name; reported because
 * the tier-1 spec addresses the same names):
 *
 * | element | accessible name | how |
 * |---|---|---|
 * | the editor's container | the `label` prop (default `Requirement tree editor`) | `<section aria-label>` → a `region` |
 * | a group card | `Group <words>` | `<article aria-label>` + `data-path` |
 * | a leaf card | `<class pair> <words>` (`Requires quest (ReqHasQuest) Requirements 1`) | `<article aria-label>` + `data-path` |
 * | the operator toggle's pair | `AND for <words>` / `OR for <words>` (text `AND`/`OR`) | `aria-label` + `aria-pressed` + `data-path` |
 * | the group toggle's wrapper | `Operator (m_operator) for <words>` | `role="group" aria-label` + `data-path` |
 * | delete | `Delete <words>` | `aria-label` + `data-path` on a `×` button |
 * | add | `Add Condition to <words>` / `Add Group to <words>` | `aria-label` + `data-path` |
 * | a field control | its field's glossary pair (`Quest name (m_questName)`, `Type ($type)`, …) | a real `<label htmlFor>` + unique `id`; the card's name disambiguates the repeats |
 *
 * `<words>` is the node's path in words (`lib/term.ts`'s `docPathWords`: `Requirements 2 › 1`,
 * `Goals 4 › Goal requirements 1`), because a document path never appears in a label (D131, task
 * 7.9). The path itself — {@link RequirementNodeView.address}, the slot's document path plus one
 * `[index]` per level (`m_requirements[1]`, `m_goals[3].m_goalRequirements[0]`), unique across
 * every slot mounted on a page — is the element's `data-path`, which is what a test addresses.
 */
export interface RequirementTreeEditorProps {
  /**
   * The document state this tree mutates: a structural subset of
   * `useQuestDocument`'s `QuestDocumentState`, declared here so a Phase-4 host (or a unit
   * render) can satisfy it without importing the quest hook.
   */
  state: RequirementTreeDocumentState;
  /** The absolute path of the requirement wrapper slot this editor owns. */
  path: DocPath;
  /** The container's accessible name. Defaults to `Requirement tree editor`. */
  label?: string;
  /** Present for symmetry with the other live panels; the tree has no timestamp row. */
  modifiedAt?: string | null;
  className?: string;
}

/** The three mutations the tree needs — `shared/document.ts`'s contract, nothing more. */
export interface RequirementTreeDocumentState {
  /** `true` when {@link path} exists (never throws). */
  has: (path: DocPath) => boolean;
  /** The value at {@link path}, or `undefined` when it does not exist. */
  value: (path: DocPath) => unknown;
  /** Applies one edit; `null` is a no-op. */
  edit: (edit: DocEdit | null) => void;
  /** Applies several edits in order. */
  editAll: (edits: readonly DocEdit[]) => void;
}

export default function RequirementTreeEditor({
  state,
  path,
  label = REQUIREMENT_TREE_EDITOR_LABEL,
  className,
}: RequirementTreeEditorProps): JSX.Element {
  const node = readRequirementTree(path, state.value(path));

  return (
    <section aria-label={label} className={cn('flex min-w-0 flex-col gap-3', className)}>
      {node === null ? (
        <EmptySlot state={state} path={path} />
      ) : (
        <ul className="flex min-w-0 flex-col gap-3">
          <NodeCard state={state} node={node} />
        </ul>
      )}
    </section>
  );
}

/**
 * A slot that holds no wrapper (absent or `null` — `m_prepRequirements` in all 322 corpus
 * quests, `m_goalRequirements` in all 772 goals). It writes **nothing** on mount: the two
 * buttons are the only way an object appears, so merely opening the tab leaves `null`
 * `null` (D57).
 */
function EmptySlot({
  state,
  path,
}: {
  state: RequirementTreeDocumentState;
  path: DocPath;
}): JSX.Element {
  const address = formatDocPath(path);
  const words = docPathWords(path);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-zinc-800 p-3">
      <p className="text-sm text-zinc-400">{NO_REQUIREMENTS_TEXT}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`${ADD_CONDITION_LABEL} to ${words}`}
          data-path={address}
          onClick={() => state.editAll(initializeTreeEdits(path, 'condition'))}
        >
          {`+ ${ADD_CONDITION_LABEL}`}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`${ADD_GROUP_LABEL} to ${words}`}
          data-path={address}
          onClick={() => state.editAll(initializeTreeEdits(path, 'group'))}
        >
          {`+ ${ADD_GROUP_LABEL}`}
        </Button>
      </div>
    </div>
  );
}

/** One node: a group, a leaf, or a value the tree cannot read (kept, never dropped). */
function NodeCard({
  state,
  node,
}: {
  state: RequirementTreeDocumentState;
  node: RequirementNodeView;
}): JSX.Element {
  if (!node.readable) {
    return <UnreadableCard state={state} node={node} />;
  }
  return node.kind === 'group' ? (
    <GroupCard state={state} node={node} />
  ) : (
    <LeafCard state={state} node={node} />
  );
}

/**
 * The findings about a requirement node itself — its path, not its fields.
 *
 * The only rules that reach inside a requirement tree are the general ones (`$type` must be in
 * the 3.1 table; a `ReqHasQuest.m_questName` reference warns when the quest is unknown), and
 * both land on the node's own path, so the node card is where they render (story p3-09). The
 * hook lives in its own component because a card is already a component and a hook cannot be
 * called conditionally inside one.
 */
function NodeMessages({ node }: { node: RequirementNodeView }): JSX.Element {
  const messages = useFieldMessages(node.path);
  return <FieldMessages messages={messages} className="mt-2" />;
}

/**
 * A child the model cannot read as an object (never in the corpus, but the renderer must
 * not swallow it): its JSON stays on screen and it can still be deleted, which is the only
 * honest control for a value the tree does not understand.
 */
function UnreadableCard({
  state,
  node,
}: {
  state: RequirementTreeDocumentState;
  node: RequirementNodeView;
}): JSX.Element {
  const address = node.address;
  return (
    <li className="min-w-0">
      <div className="flex items-start gap-2 rounded-md border border-amber-700/60 bg-amber-950/20 p-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-amber-300">{UNREADABLE_NODE_TEXT}</p>
          <pre className="mt-1 overflow-auto font-mono text-xs text-amber-200/80">
            {JSON.stringify(node.value)}
          </pre>
        </div>
        <DeleteButton state={state} path={node.path} address={address} />
      </div>
    </li>
  );
}

/**
 * A group: the AND/OR toggle, its children (indented, with a connecting line) and the two
 * add controls. Its left border is the operator's colour (blue AND / purple OR).
 */
function GroupCard({
  state,
  node,
}: {
  state: RequirementTreeDocumentState;
  node: RequirementNodeView;
}): JSX.Element {
  const address = node.address;
  const words = docPathWords(node.path);
  return (
    <li className="min-w-0">
      <article
        aria-label={`${GROUP_LABEL} ${words}`}
        data-path={address}
        className={cn(
          'min-w-0 rounded-md border border-zinc-800 border-l-4 bg-zinc-900/50 p-3',
          requirementGroupBorderClass(node.value),
        )}
      >
        <header className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-zinc-400">{GROUP_LABEL}</span>
          <OperatorToggle state={state} node={node} />
          <div className="ml-auto">
            <DeleteButton state={state} path={node.path} address={address} />
          </div>
        </header>

        <NodeMessages node={node} />

        {node.children.length === 0 ? null : (
          <ul className="mt-3 flex min-w-0 flex-col gap-3 border-l border-zinc-700 pl-4">
            {node.children.map((child) => (
              <NodeCard key={child.address} state={state} node={child} />
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`${ADD_CONDITION_LABEL} to ${words}`}
            data-path={address}
            onClick={() => state.editAll(addConditionEdits(node.path, node.children.length))}
          >
            {`+ ${ADD_CONDITION_LABEL}`}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`${ADD_GROUP_LABEL} to ${words}`}
            data-path={address}
            onClick={() => state.editAll(addGroupEdits(node.path, node.children.length))}
          >
            {`+ ${ADD_GROUP_LABEL}`}
          </Button>
        </div>
      </article>
    </li>
  );
}

/**
 * A group's AND/OR toggle: two `aria-pressed` buttons, so the state is announced rather
 * than only coloured. An absent `m_operator` displays as AND
 * ({@link requirementEffectiveOperator}) and is not written until the user picks one.
 */
function OperatorToggle({
  state,
  node,
}: {
  state: RequirementTreeDocumentState;
  node: RequirementNodeView;
}): JSX.Element {
  const words = docPathWords(node.path);
  const current = requirementEffectiveOperator(node.value);
  return (
    <div
      role="group"
      aria-label={`${termText({ field: 'm_operator' })} for ${words}`}
      data-path={node.address}
      className="flex gap-1"
    >
      {REQUIREMENT_OPERATORS.map((operator: RequirementOperator) => (
        <Button
          key={operator}
          type="button"
          size="sm"
          variant={current === operator ? 'default' : 'outline'}
          aria-pressed={current === operator}
          aria-label={`${REQUIREMENT_OPERATOR_LABELS[operator]} for ${words}`}
          data-path={node.address}
          onClick={() => state.edit(setOperatorEdit(node.path, operator))}
        >
          {REQUIREMENT_OPERATOR_LABELS[operator]}
        </Button>
      ))}
    </div>
  );
}

/** A leaf: the type selector, the type's own fields, NOT and the operator. */
function LeafCard({
  state,
  node,
}: {
  state: RequirementTreeDocumentState;
  node: RequirementNodeView;
}): JSX.Element {
  const address = node.address;
  const id = useId();
  // Titled by meaning with the quest's resolved name (task 7.10).
  const title = requirementCardTitle(node.value, useCardNames(['quests']));
  return (
    <li className="min-w-0">
      <article
        aria-label={`${title} ${docPathWords(node.path)}`}
        data-path={address}
        className={cn(
          'min-w-0 rounded-md border border-zinc-800 border-l-4 bg-zinc-900/40 p-3',
          REQUIREMENT_LEAF_BORDER_CLASS,
        )}
      >
        <header className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-zinc-100">{title}</span>
          {node.typeString === null ? null : (
            <span className="text-xs text-zinc-400">
              <TermLabel term={{ type: node.typeString }} />
            </span>
          )}
          <div className="ml-auto">
            <DeleteButton state={state} path={node.path} address={address} />
          </div>
        </header>

        <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Labelled id={`${id}-type`} fieldKey="$type">
            <select
              id={`${id}-type`}
              value={requirementTypeSelectValue(node.value)}
              className={CONTROL_CLASS}
              onChange={(event) => {
                const spec = requirementTypeSpecByName(event.target.value);
                if (spec !== undefined) {
                  state.editAll(changeLeafTypeEdits(node.path, spec.shortName));
                }
              }}
            >
              {requirementTypeSelectOptions(node.value).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Labelled>

          {(node.spec?.fields ?? []).map((field) => (
            <LeafField key={field.key} state={state} node={node} field={field} idPrefix={id} />
          ))}

          {/*
            Only a leaf offers `m_applyNOT` (docs/spec-ui-design.md L388-416 puts NOT on the
            class card). A presumably-checked box for an absent or `null` value stays
            untouched until the user actually toggles it.
          */}
          <Labelled id={`${id}-not`} fieldKey="m_applyNOT">
            <input
              id={`${id}-not`}
              type="checkbox"
              checked={node.applyNOT}
              className="h-4 w-4 accent-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
              onChange={() => state.edit(toggleApplyNOTEdit(node.path, node.value))}
            />
          </Labelled>

          <Labelled id={`${id}-operator`} fieldKey="m_operator">
            <select
              id={`${id}-operator`}
              value={requirementSelectValue(requirementField(node.value, 'm_operator'))}
              className={CONTROL_CLASS}
              onChange={(event) => {
                // `m_operator` is a closed 2-value enum with no "unset" wire value: the `—`
                // option exists only so an absent operator renders coherently, and choosing
                // it is a no-op (nothing is written, so absence stays absence).
                const operator = REQUIREMENT_OPERATORS.find(
                  (value) => value === event.target.value,
                );
                if (operator !== undefined) {
                  state.edit(setOperatorEdit(node.path, operator));
                }
              }}
            >
              {requirementSelectOptions(
                requirementField(node.value, 'm_operator'),
                REQUIREMENT_OPERATORS,
              ).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value === '' ? option.label : fieldValueText('m_operator', option.value)}
                </option>
              ))}
            </select>
          </Labelled>
        </div>
      </article>
    </li>
  );
}

/** One type-specific field of a leaf, rendered by its {@link RequirementFieldSpec.kind}. */
function LeafField({
  state,
  node,
  field,
  idPrefix,
}: {
  state: RequirementTreeDocumentState;
  node: RequirementNodeView;
  field: RequirementFieldSpec;
  idPrefix: string;
}): JSX.Element {
  const id = `${idPrefix}-${field.key}`;
  const value = requirementField(node.value, field.key);
  const present = state.has([...node.path, field.key]);
  const address = node.address;
  const describedBy = `${id}-help`;

  return (
    <Labelled id={id} fieldKey={field.key} help={field.help} helpId={describedBy}>
      <FieldControl
        state={state}
        node={node}
        field={field}
        id={id}
        describedBy={describedBy}
        value={value}
        present={present}
        address={address}
      />
    </Labelled>
  );
}

/** The control for one field kind. */
function FieldControl({
  state,
  node,
  field,
  id,
  describedBy,
  value,
  present,
  address,
}: {
  state: RequirementTreeDocumentState;
  node: RequirementNodeView;
  field: RequirementFieldSpec;
  id: string;
  describedBy: string;
  value: unknown;
  present: boolean;
  address: string;
}): JSX.Element {
  switch (field.kind) {
    case 'quest':
      // AGENTS.md rule 5: an ID-referencing field is a friendly-name dropdown that stores
      // the raw id. `m_questName` is a quest name, so the `quests` table is its list; a
      // reference the table has never seen displays itself and is never rewritten.
      return (
        <FriendlyNameDropdown
          type="quests"
          name={`${address}-${field.key}`}
          aria-label={`${termText({ field: field.key })} ${docPathWords(node.path)}`}
          value={typeof value === 'string' && value !== '' ? value : null}
          allowEmpty
          onChange={(rawId) => state.edit(setLeafFieldEdit(node.path, field.key, present, rawId))}
        />
      );
    case 'enum':
      return (
        <select
          id={id}
          aria-describedby={describedBy}
          value={requirementSelectValue(value)}
          className={CONTROL_CLASS}
          onChange={(event) =>
            state.edit(setLeafFieldEdit(node.path, field.key, present, event.target.value))
          }
        >
          {requirementSelectOptions(value, field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {optionText(field.key, option)}
            </option>
          ))}
        </select>
      );
    case 'boolean':
      return (
        <input
          id={id}
          aria-describedby={describedBy}
          type="checkbox"
          checked={value === true}
          className="h-4 w-4 accent-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          onChange={(event) =>
            state.edit(setBooleanFieldEdit(node.path, field.key, event.target.checked))
          }
        />
      );
    case 'text':
      return (
        <input
          id={id}
          aria-describedby={describedBy}
          type="text"
          value={scalarText(value)}
          className={CONTROL_CLASS}
          onChange={(event) =>
            state.edit(setLeafFieldEdit(node.path, field.key, present, event.target.value))
          }
        />
      );
  }
}

/** The `×` control on every card. */
function DeleteButton({
  state,
  path,
  address,
}: {
  state: RequirementTreeDocumentState;
  path: DocPath;
  address: string;
}): JSX.Element {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-label={`${DELETE_NODE_LABEL} ${docPathWords(path)}`}
      data-path={address}
      onClick={() => state.editAll(deleteNodeEdits(path))}
    >
      ×
    </Button>
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
  children,
}: {
  id: string;
  fieldKey: string;
  help?: string;
  helpId?: string;
  children: ReactNode;
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
    </div>
  );
}

/** A select option's text: an enum value as its glossary pair, an unlisted one marked so. */
function optionText(fieldKey: string, option: RequirementSelectOption): string {
  const text = option.value === '' ? option.label : fieldValueText(fieldKey, option.value);
  return option.unlisted ? `${text} (unlisted)` : text;
}

/** The shared input/select styling (the same classes the Info/Goals editors use). */
const CONTROL_CLASS =
  'min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950';

/** A scalar document value as an input's text — `null`/absent render empty. */
function scalarText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}
