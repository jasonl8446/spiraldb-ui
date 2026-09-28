import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import {
  addRegistryRowEdit,
  consolidationPlan,
  GLOBAL_REGISTRY_FILE_NAME,
  GLOBAL_REGISTRY_WRAPPER_KEY,
  NEW_REGISTRY_VALUE,
  readRegistryRows,
  registryHasWrapper,
  registryValueEdit,
  registryValueIsNumber,
  removeRegistryRowEdit,
  renameRegistryRowEdits,
} from '@shared/simpleObjects';

import type { QuestDocumentState } from '../../hooks/useQuestDocument';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';

/**
 * The GlobalRegistry editor — plan task 4.9 / story p4-07 AC1 + AC2,
 * docs/spec-domain-reference.md **L102-119** (the wrapper and the merge rule) and **L711-712**
 * (a single merged view, "display in a key-value table editor"), plus `docs/plan-overview.md`
 * **D22** (consolidate-and-replace, whose review surface is the PR diff) and **D5/D57**
 * (merge-not-replace; never normalise).
 *
 * The document is `{GlobalRegistryValues: {key: value}}` and the table is one row per **key** —
 * see `shared/simpleObjects/globalRegistry.ts` for every measured number, the merge rule and the
 * key-addressed builders. Three things this component owns:
 *
 * | AC1's words | here |
 * |---|---|
 * | "the merged view equals the manual merge of all `GlobalRegistry/*.json`" | the document arrives already merged from the server (`GET /api/global-registry/:key`); this form only renders it, one row per key in document order |
 * | "a key→float table" | a Key text box and a Value number box per row, plus Remove |
 * | "supports add/edit/remove rows" | the Add row (key + value + Add), a row's Value box, a row's Key box (committed on blur or Enter) and Remove |
 * | AC2's "one file afterwards" | the pre-save disclosure below names exactly which files the commit replaces, and that git history is the undo |
 *
 * ## A row's key is its identity, so the Key box edits on blur, not per keystroke
 *
 * Every row is keyed by its document key. Renaming on each keystroke would change the React key
 * every character, remount the row and drop focus — so the box holds local text and commits one
 * rename on blur/Enter. The rename appends the key at the end of the table (the shared document
 * model has no key-reorder operation), which the module documents.
 *
 * ## The value box never normalises, and an empty box is not an edit
 *
 * A stored integer round-trips as an integer (`1`, never `1.0`); a value the user did not touch
 * is never rewritten; an emptied box produces **no** edit (writing `''` into a `float` dictionary
 * would be type corruption — removing a row is the dictionary's own way to delete a flag). A
 * value that is present but **not** a number is shown as such and kept verbatim unless the user
 * types over it (D5/D57).
 *
 * ## Add refuses what the dictionary cannot hold
 *
 * A blank key is not a key and a duplicate key would silently overwrite a row; the Add button is
 * disabled in both cases, with the reason stated in text rather than only by colour. The **typed**
 * key is trimmed before it is stored (`" Easter "` adds `Easter`) — that is user-input hygiene at
 * the control boundary, never a normalisation of what is on disk: a key read from a file is shown
 * and written back exactly as it is (D57), and so is a value.
 */
export interface GlobalRegistryFormProps {
  /** The live merged document (`{GlobalRegistryValues: …}`). */
  document: Record<string, unknown>;
  /** `view` renders the same table read-only; `edit` renders the controls. */
  mode: 'view' | 'edit';
  /** The D58 mutation contract (`edit`/`editAll`). */
  state: QuestDocumentState;
  /**
   * Every `GlobalRegistry/*.json` file the directory holds right now, from the family's list
   * endpoint — what the next save replaces. `undefined` while the list is in flight or failed,
   * which renders no disclosure rather than a guess.
   */
  files: readonly string[] | undefined;
  /** The file names the list reported as unreadable (`skipped[]`), named in the disclosure. */
  unreadableFiles?: readonly string[];
  disabled?: boolean;
}

export default function GlobalRegistryForm({
  document,
  mode,
  state,
  files,
  unreadableFiles = [],
  disabled = false,
}: GlobalRegistryFormProps): JSX.Element {
  const editing = mode === 'edit' && !disabled;
  const rows = readRegistryRows(document);
  const hasWrapper = registryHasWrapper(document);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState(String(NEW_REGISTRY_VALUE));

  const plan = files === undefined ? undefined : consolidationPlan(files);
  const knownKeys = new Set(rows.map((row) => row.key));
  const trimmedNewKey = newKey.trim();
  const newKeyProblem =
    trimmedNewKey === ''
      ? newKey === ''
        ? 'A key is required.'
        : 'A key cannot be only spaces.'
      : knownKeys.has(trimmedNewKey)
        ? `"${trimmedNewKey}" is already a row — edit that row instead.`
        : null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Registry values</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {rows.length === 0 ? (
            <p className="text-xs text-zinc-400">
              {hasWrapper
                ? 'This registry holds no values yet — add a row below.'
                : `This registry has no ${GLOBAL_REGISTRY_WRAPPER_KEY} object yet — the first row creates it.`}
            </p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Registry values">
              {rows.map((row) => (
                <RegistryRow
                  key={row.key}
                  rowKey={row.key}
                  value={row.value}
                  editing={editing}
                  state={state}
                />
              ))}
            </ul>
          )}

          {editing ? (
            <div className="flex flex-wrap items-end gap-2 border-t border-zinc-800 pt-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-zinc-400" htmlFor="registry-new-key">
                  New key
                </label>
                <Input
                  id="registry-new-key"
                  aria-label="New registry key"
                  className="w-56 font-mono"
                  value={newKey}
                  onChange={(event) => setNewKey(event.target.value)}
                  placeholder="Localization"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-zinc-400" htmlFor="registry-new-value">
                  Value
                </label>
                <Input
                  id="registry-new-value"
                  aria-label="New registry value"
                  className="w-28 font-mono"
                  type="number"
                  step="any"
                  value={newValue}
                  onChange={(event) => setNewValue(event.target.value)}
                />
              </div>
              <Button
                type="button"
                size="sm"
                disabled={newKeyProblem !== null}
                title={newKeyProblem ?? undefined}
                onClick={() => {
                  const parsed = Number(newValue);
                  state.edit(
                    addRegistryRowEdit(
                      hasWrapper,
                      trimmedNewKey,
                      Number.isFinite(parsed) ? parsed : NEW_REGISTRY_VALUE,
                    ),
                  );
                  setNewKey('');
                  setNewValue(String(NEW_REGISTRY_VALUE));
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Add row
              </Button>
              {newKeyProblem === null ? null : (
                <p data-add-problem="true" className="text-xs text-zinc-400">
                  {newKeyProblem}
                </p>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ConsolidationNotice plan={plan} unreadableFiles={unreadableFiles} />
    </div>
  );
}

/** One row: the Key box (committed on blur/Enter), the Value box and Remove. */
function RegistryRow({
  rowKey,
  value,
  editing,
  state,
}: {
  rowKey: string;
  value: unknown;
  editing: boolean;
  state: QuestDocumentState;
}): JSX.Element {
  // Local text for the key only — committing per keystroke would remount the row and drop focus.
  const [keyText, setKeyText] = useState(rowKey);

  if (!editing) {
    return (
      <li className="flex items-center gap-2">
        <span className="w-64 truncate font-mono text-sm text-zinc-100" title={rowKey}>
          {rowKey}
        </span>
        <span className="font-mono text-sm text-zinc-300">
          {registryValueIsNumber(value) ? String(value) : JSON.stringify(value)}
        </span>
        {registryValueIsNumber(value) ? null : (
          <span className="text-xs text-amber-300">not a number — kept as stored</span>
        )}
      </li>
    );
  }

  const commitKey = (): void => {
    const next = keyText.trim();
    if (next === rowKey || next === '') {
      setKeyText(rowKey);
      return;
    }
    state.editAll(renameRegistryRowEdits(rowKey, next, value));
  };

  return (
    <li className="flex flex-wrap items-center gap-2">
      <Input
        aria-label={`Registry key ${rowKey}`}
        className="w-64 font-mono"
        value={keyText}
        onChange={(event) => setKeyText(event.target.value)}
        onBlur={commitKey}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commitKey();
          }
        }}
      />
      <Input
        aria-label={`Registry value ${rowKey}`}
        className="w-32 font-mono"
        type="number"
        step="any"
        value={registryValueIsNumber(value) ? String(value) : ''}
        onChange={(event) => {
          const edit = registryValueEdit(rowKey, event.target.value);
          if (edit !== null) {
            state.edit(edit);
          }
        }}
      />
      {registryValueIsNumber(value) ? null : (
        <span className="text-xs text-amber-300">
          {`stored value ${JSON.stringify(value)} is not a number — typing here replaces it`}
        </span>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={`Remove registry row ${rowKey}`}
        onClick={() => {
          state.edit(removeRegistryRowEdit(rowKey));
        }}
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </li>
  );
}

/**
 * The pre-save disclosure (AC2 / D22): the save replaces N files with one, **named**, in a single
 * commit — and git history is the undo. D22's own rationale is that the PR diff is the review
 * surface, so the editor says this *before* the save rather than only reporting it after.
 *
 * It renders nothing when there is nothing to consolidate (one file, already the convention name)
 * and nothing while the list is unknown (`plan === undefined`) — never a guess.
 */
function ConsolidationNotice({
  plan,
  unreadableFiles,
}: {
  plan: ReturnType<typeof consolidationPlan> | undefined;
  unreadableFiles: readonly string[];
}): JSX.Element | null {
  if (plan === undefined) {
    return null;
  }
  const replaced = [GLOBAL_REGISTRY_FILE_NAME, ...plan.remove];
  if (plan.remove.length === 0) {
    return (
      <p data-consolidation="none" className="text-xs text-zinc-400">
        {`Saving writes ${GLOBAL_REGISTRY_FILE_NAME} — the directory already holds exactly that one file.`}
      </p>
    );
  }
  return (
    <div
      data-consolidation={plan.remove.length}
      className="flex flex-col gap-1 rounded-md border border-zinc-800 p-3"
    >
      <p className="text-sm text-zinc-200">
        {`Saving replaces ${replaced.length} files with one: ${plan.remove.join(', ')} and this editor's new ${GLOBAL_REGISTRY_FILE_NAME}.`}
      </p>
      <p className="text-xs text-zinc-400">
        One commit does both — the new file and the deletions. The game loads these files in an
        unspecified order, so afterwards `GlobalRegistry/` deterministically holds only{' '}
        {GLOBAL_REGISTRY_FILE_NAME}. Git history is the undo.
      </p>
      {unreadableFiles.length === 0 ? null : (
        <p className="text-xs text-amber-300">
          {`The list could not read ${unreadableFiles.join(', ')} — a save leaves those files in place and reports them.`}
        </p>
      )}
    </div>
  );
}
