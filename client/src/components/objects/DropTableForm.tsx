import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useCallback, useId, useMemo } from 'react';

import type { DocEdit, DocPath } from '@shared/document';
import {
  DROP_TABLE_AUDIT_KEYS,
  DROP_TABLE_ITEM_FIELDS,
  canonicalItemId,
  dropTableFieldSpec,
  dropTableFieldsInSection,
  dropTableHasField,
  itemIdLookupValue,
  newDropItemRow,
  type DropTableFieldSpec,
} from '@shared/dropTable';

import type { QuestDocumentState } from '../../hooks/useQuestDocument';
import { getNames, namesQueryKey } from '../../lib/api';
import { dropTableBannerModel } from '../../lib/drop-table-validation';
import { booleanFieldEdit, numberFieldEdit, textFieldEdit } from '../../lib/quest-info';
import { withValidationBorder } from '../../lib/quest-validation';
import type { FieldValidationMessage } from '../../lib/validation-message';
import FriendlyNameDropdown from '../FriendlyNameDropdown';
import { FieldMessages, fieldAriaInvalid, useFieldMessages } from '../shared/FieldValidation';
import RequirementTreeEditor from '../shared/RequirementTreeEditor';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';

/**
 * The DropTable editor — plan task 4.2's form (story p4-02), on task 4.1's generic detail
 * scaffolding. The second form the scaffolding carries (NpcInventory was the first).
 *
 * The four sections are docs/spec-ui-design.md L471-477 — **Basic** (Name, Description,
 * RollChance slider 0–1, Weight, NoneChance slider 0–1, plus the plan's PityCounter),
 * **Rewards** (MinGold/MaxGold, ExperienceAmount, TrainingPoints, GrantsPotionSlot),
 * **Items** (the repeater) and **Audit** (the read-only quartet). The field list, the kinds
 * and the defaults are not restated here: they are `shared/dropTable/model.ts`'s inventory,
 * which the test pins against L77-91 and against the measured corpus.
 *
 * ## What this form deliberately does not do
 *
 * - **It writes nothing on load.** A control the user has not touched produces no edit, so an
 *   absent key stays absent: 282 of the 317 corpus files carry no `GrantsPotionSlot` and one
 *   carries no audit block, and a save of such a file must not pad them (D57). The only
 *   writers of a default are the Add-row button (`newDropItemRow`) and the requirement tree's
 *   explicit "Add Condition" — both user actions.
 * - **It never stamps the audit block.** The section is read-only and renders only what the
 *   file already holds, absent keys included (D69(b): a save refreshes no `ModifiedAt`/
 *   `ModifiedBy` and adds no key).
 * - **It does not re-implement the requirement tree.** Each item row mounts the shared
 *   `RequirementTreeEditor` at `['Items', i, 'Requirements']` — the untyped
 *   `{m_requirements, m_applyNOT, m_operator}` wrapper the 65 real item trees already
 *   round-trip through it (D62(f), docs/spec-domain-reference.md L708-709).
 * - **It does not validate by itself.** The rules are the shared engine; this form renders the
 *   messages the page produced and shows the form-level banner. Save is the page's button.
 * - **It does not clamp a number.** A chance typed as `1.5` is written verbatim and the engine
 *   reports it (D57: validate, never normalise). That is why each chance has a slider **and**
 *   an editable number box: a range input cannot express an out-of-range value at all, so a
 *   slider-only control could never show the rule it exists to enforce.
 *
 * ## The ItemId → ItemName autofill (P4 AC#7), and the measured trap
 *
 * All 72 corpus `ItemId` values are JSON **strings** (`"1001"`) while the synced `items` table
 * keys on integer `gid`s: compared as raw values, **0 of 72** resolve; canonicalised, **64 of
 * 72** do (`shared/dropTable/model.ts`'s `canonicalItemId`, the single conversion). So the
 * dropdown's value and the label lookup both go through that helper — `itemIdLookupValue` is
 * what is handed to `FriendlyNameDropdown`, which is also what its own single-id fallback
 * request sends, so a stored string id still resolves.
 *
 * The name is written **only** when the synced table has a non-empty name for the id
 * (`useItemNameIndex` skips NULL names). An unresolved id — the 8 measured misses, e.g. `1000`
 * — therefore keeps its raw value, keeps whatever `ItemName` the file already had, and never
 * gets an invented name (the D60(c)/D63(c) miss-safe rule the story names as a failure mode).
 *
 * ## Accessible-name vocabulary (reported; the tier-1 spec addresses these)
 *
 * | element | accessible name |
 * |---|---|
 * | a section | `Basic` / `Rewards` / `Items` / `Audit` (`<section aria-label>`) |
 * | a top-level field control | its visible label (`Name`, `Description`, …) via `<label htmlFor>` |
 * | a chance's slider / number box | `Roll chance` (visible label) / `Roll chance value` (`aria-label`) |
 * | an item row | `Item 1`, `Item 2`, … (`<article aria-label>`) |
 * | a row's ItemId dropdown | `Item 1 item id` (`aria-label`) |
 * | a row's read-only name box | `Item 1 item name` (`aria-label`) |
 * | a row's Notes box | its `<label htmlFor>` `Notes` |
 * | a row's tree | `Requirements for item 1` (the tree's `label` prop) |
 * | tree nodes | `ReqHasQuest Items[0].Requirements[0]` (the shared editor's own addressing) |
 * | Add / Remove row | `Add item row` / `Remove item 1` |
 */
export interface DropTableFormProps {
  /** The live document (the page's baseline-aware model). */
  document: Record<string, unknown>;
  /** `view` renders the same controls disabled/read-only; `edit` renders them live. */
  mode: 'view' | 'edit';
  /** The D58 mutation contract every shared editor takes. */
  state: QuestDocumentState;
  /** The page's validation messages for the live document (used by the banner). */
  messages: readonly FieldValidationMessage[];
  disabled?: boolean;
}

/** The control style the Info/Dialog editors use, reused so the two forms look alike. */
const CONTROL_CLASS =
  'min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-60';

/** A scalar as the text a control shows: `''` for absent/`null`, JSON for structured values. */
function scalarText(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

export default function DropTableForm({
  document,
  mode,
  state,
  messages,
  disabled = false,
}: DropTableFormProps): JSX.Element {
  const editing = mode === 'edit' && !disabled;
  const banner = dropTableBannerModel(messages);

  return (
    <div className="flex flex-col gap-4" data-edit-mode={editing ? 'edit' : 'view'}>
      {banner.errorHeadline === null ? null : (
        <p
          role="alert"
          className="rounded-md border border-red-500/60 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          {banner.errorHeadline}
        </p>
      )}

      <section aria-label="Basic" className="flex flex-col gap-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Basic</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {dropTableFieldsInSection('basic').map((field) => (
              <ScalarField
                key={field.key}
                field={field}
                document={document}
                state={state}
                editing={editing}
              />
            ))}
          </CardContent>
        </Card>
      </section>

      <section aria-label="Rewards" className="flex flex-col gap-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Rewards</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <GoldRange document={document} state={state} editing={editing} />
            {dropTableFieldsInSection('rewards')
              .filter((field) => field.key !== 'MinGold' && field.key !== 'MaxGold')
              .map((field) => (
                <ScalarField
                  key={field.key}
                  field={field}
                  document={document}
                  state={state}
                  editing={editing}
                />
              ))}
          </CardContent>
        </Card>
      </section>

      <ItemsSection document={document} state={state} editing={editing} />

      <AuditSection document={document} />
    </div>
  );
}

/**
 * One scalar control, driven by its inventory row: text → `<Input>`, textarea → `<textarea>`,
 * number → a numeric `<Input>`, slider → `<input type="range">` plus an editable number box,
 * checkbox → a checkbox. The whole `Basic` section is one card; the two sections are named
 * `<section aria-label>` so the tier-1 spec can scope to them.
 *
 * The edit always comes from the shared scalar builders (`lib/quest-info.ts`), so "emptying a
 * present key deletes it, and an absent key stays absent" is one rule, not a second copy.
 */
function ScalarField({
  field,
  document,
  state,
  editing,
}: {
  field: DropTableFieldSpec;
  document: Record<string, unknown>;
  state: QuestDocumentState;
  editing: boolean;
}): JSX.Element {
  const generated = useId();
  const id = `droptable-${field.key}-${generated}`;
  const valueId = `${id}-value`;
  const messagesId = `${id}-messages`;
  const messages = useFieldMessages([field.key]);
  const present = dropTableHasField(document, field.key);
  const value = document[field.key];
  const describedBy = messages.length === 0 ? undefined : messagesId;
  const invalid = fieldAriaInvalid(messages);
  const className = withValidationBorder(CONTROL_CLASS, messages);
  const commit = (raw: string): void => state.edit(numberFieldEdit(field.key, present, raw));

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs text-zinc-400">
        {field.label}
      </label>

      {field.kind === 'textarea' ? (
        <textarea
          id={id}
          rows={3}
          value={scalarText(value)}
          readOnly={!editing}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={className}
          onChange={(event) => state.edit(textFieldEdit(field.key, present, event.target.value))}
        />
      ) : field.kind === 'slider' ? (
        <div className="flex items-center gap-3">
          <input
            id={id}
            type="range"
            min={field.min ?? 0}
            max={field.max ?? 1}
            step={field.step ?? 0.05}
            value={typeof value === 'number' ? value : '0'}
            disabled={!editing}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className="h-2 w-full accent-blue-500"
            onChange={(event) => commit(event.target.value)}
          />
          <Input
            id={valueId}
            value={scalarText(value)}
            readOnly={!editing}
            inputMode="decimal"
            aria-label={`${field.label} value`}
            aria-invalid={invalid}
            aria-describedby={describedBy}
            className={`${className} w-20`}
            onChange={(event) => commit(event.target.value)}
          />
        </div>
      ) : field.kind === 'checkbox' ? (
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          disabled={!editing}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-blue-500"
          onChange={(event) => state.edit(booleanFieldEdit(field.key, event.target.checked))}
        />
      ) : (
        <Input
          id={id}
          value={scalarText(value)}
          readOnly={!editing}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className={className}
          onChange={(event) =>
            state.edit(
              field.kind === 'number'
                ? numberFieldEdit(field.key, present, event.target.value)
                : textFieldEdit(field.key, present, event.target.value),
            )
          }
        />
      )}

      {field.help === undefined ? null : <p className="text-xs text-zinc-400">{field.help}</p>}
      {field.presenceSensitive ? (
        <p className="text-xs text-zinc-400">
          {Object.prototype.hasOwnProperty.call(document, field.key)
            ? 'Present in this file; it is written only if you change it.'
            : `Absent in this file (present in ${field.corpusPresence} of 317 corpus files); it stays absent unless you change it.`}
        </p>
      ) : null}
      <FieldMessages messages={messages} id={messagesId} />
    </div>
  );
}

/**
 * The gold pair as one group: two number boxes and **one** message line beneath them.
 *
 * `MinGold ≤ MaxGold` is one rule with one finding, placed at `MaxGold` (the endpoint that has
 * to move); the group shows the messages of both paths and borders both controls, so "which of
 * the two is wrong" needs no special case in the engine and no guessed path in the form.
 */
function GoldRange({
  document,
  state,
  editing,
}: {
  document: Record<string, unknown>;
  state: QuestDocumentState;
  editing: boolean;
}): JSX.Element {
  const generated = useId();
  const minMessages = useFieldMessages(['MinGold']);
  const maxMessages = useFieldMessages(['MaxGold']);
  const messages = useMemo(() => [...minMessages, ...maxMessages], [minMessages, maxMessages]);
  const messagesId = `droptable-gold-${generated}-messages`;
  const describedBy = messages.length === 0 ? undefined : messagesId;

  return (
    <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
      <span className="text-xs text-zinc-400">Gold range</span>
      <div className="flex items-center gap-2">
        {(['MinGold', 'MaxGold'] as const).map((key) => {
          const spec = dropTableFieldSpec(key);
          const id = `droptable-${key}-${generated}`;
          return (
            <div key={key} className="flex min-w-0 flex-1 items-center gap-2">
              <label htmlFor={id} className="w-8 text-xs text-zinc-400">
                {key === 'MinGold' ? 'Min' : 'Max'}
              </label>
              <Input
                id={id}
                value={scalarText(document[key])}
                readOnly={!editing}
                aria-invalid={fieldAriaInvalid(messages)}
                aria-describedby={describedBy}
                aria-label={spec?.label}
                className={withValidationBorder(CONTROL_CLASS, messages)}
                onChange={(event) =>
                  state.edit(
                    numberFieldEdit(key, dropTableHasField(document, key), event.target.value),
                  )
                }
              />
            </div>
          );
        })}
      </div>
      <FieldMessages messages={messages} id={messagesId} />
    </div>
  );
}

/* ------------------------------------------------------------------------- items */

/**
 * The Items repeater: one row per `Items[i]`, each with the friendly-name ItemId dropdown, the
 * auto-filled read-only ItemName, Notes, and the inline shared requirement tree.
 *
 * Deleting and adding are single array edits (`delete` at the index / `insert` at the end),
 * never a rebuild of the array: the rows the user did not touch keep their own key order,
 * their explicit `null`s and any key the inventory does not model (D5/D57).
 */
function ItemsSection({
  document,
  state,
  editing,
}: {
  document: Record<string, unknown>;
  state: QuestDocumentState;
  editing: boolean;
}): JSX.Element {
  const raw = document.Items;
  const items = Array.isArray(raw) ? raw : [];
  const present = dropTableHasField(document, 'Items');
  const labelFor = useItemNameIndex(editing);

  function addRow(): void {
    const row = newDropItemRow();
    state.edit(
      present
        ? { op: 'insert', path: ['Items'], index: items.length, value: row }
        : { op: 'set', path: ['Items'], value: [row] },
    );
  }

  return (
    <section aria-label="Items" className="flex flex-col gap-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm">Items</CardTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!editing}
            aria-label="Add item row"
            onClick={addRow}
          >
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Add row
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {items.length === 0 ? (
            <p className="text-xs text-zinc-400">This drop table has no item rows.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((row, index) => (
                <ItemRow
                  key={index}
                  index={index}
                  row={isObject(row) ? row : {}}
                  state={state}
                  editing={editing}
                  labelFor={labelFor}
                  onRemove={() => state.edit({ op: 'delete', path: ['Items', index] })}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/** `true` for a non-null, non-array object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ItemRow({
  index,
  row,
  state,
  editing,
  labelFor,
  onRemove,
}: {
  index: number;
  row: Record<string, unknown>;
  state: QuestDocumentState;
  editing: boolean;
  labelFor: (rawId: unknown) => string | undefined;
  onRemove: () => void;
}): JSX.Element {
  const generated = useId();
  const notesId = `droptable-item-notes-${generated}`;
  const nameId = `droptable-item-name-${generated}`;
  const base: DocPath = ['Items', index];
  const [itemIdField, itemNameField, notesField] = DROP_TABLE_ITEM_FIELDS;

  /** The user picked an id: write it, and the synced name only when one actually exists. */
  function select(rawId: string): void {
    const edits: DocEdit[] = [{ op: 'set', path: [...base, itemIdField.key], value: rawId }];
    const name = labelFor(rawId);
    if (name !== undefined) {
      edits.push({ op: 'set', path: [...base, itemNameField.key], value: name });
    }
    state.editAll(edits);
  }

  return (
    <li>
      <article
        aria-label={`Item ${index + 1}`}
        className="flex flex-col gap-3 rounded-md border border-zinc-800 p-3"
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-xs text-zinc-400">{itemIdField.label}</span>
            <FriendlyNameDropdown
              type="items"
              name={`Items[${index}].ItemId`}
              value={itemIdLookupValue(row[itemIdField.key]) ?? ''}
              onChange={select}
              disabled={!editing}
              aria-label={`Item ${index + 1} item id`}
              placeholder="Select an item…"
            />
            <span className="font-mono text-xs text-zinc-400">
              stored as {JSON.stringify(row[itemIdField.key] ?? null)}
            </span>
          </div>

          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={nameId} className="text-xs text-zinc-400">
              {itemNameField.label}
            </label>
            <Input
              id={nameId}
              value={scalarText(row[itemNameField.key])}
              readOnly
              aria-label={`Item ${index + 1} item name`}
              className={CONTROL_CLASS}
            />
            <span className="text-xs text-zinc-400">
              Filled from the synced items table; an unresolved id keeps this value as it is.
            </span>
          </div>

          <div className="flex min-w-0 flex-col gap-1 sm:col-span-2">
            <label htmlFor={notesId} className="text-xs text-zinc-400">
              {notesField.label}
            </label>
            <Input
              id={notesId}
              value={scalarText(row[notesField.key])}
              readOnly={!editing}
              className={CONTROL_CLASS}
              onChange={(event) =>
                state.edit(
                  textFieldEdit(
                    [...base, notesField.key],
                    Object.prototype.hasOwnProperty.call(row, notesField.key),
                    event.target.value,
                  ),
                )
              }
            />
          </div>
        </div>

        {/* View mode is the host's business (the tree's own doc says so): a disabled fieldset
            reaches every control inside it, so the tree needs no second read-only renderer. */}
        <fieldset disabled={!editing} className="min-w-0 border-0 p-0">
          <RequirementTreeEditor
            state={state}
            path={[...base, 'Requirements']}
            label={`Requirements for item ${index + 1}`}
          />
        </fieldset>

        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!editing}
            aria-label={`Remove item ${index + 1}`}
            onClick={onRemove}
          >
            <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Remove
          </Button>
        </div>
      </article>
    </li>
  );
}

/**
 * The synced `items` table as `canonical id → name`, for the autofill.
 *
 * It reads the **same** TanStack query key `useNames('items')` uses, so the list is fetched once
 * per session and shared with the dropdowns on this page; it is `enabled` only while editing, so
 * merely opening the detail page in view mode costs nothing.
 *
 * Only rows with a **non-empty name** enter the map. That is the miss-safe rule made
 * structural: an id whose `items.name` is NULL can never autofill, and neither can the 8 ids the
 * table does not carry at all — both keep the raw id and the file's own `ItemName`.
 */
function useItemNameIndex(enabled: boolean): (rawId: unknown) => string | undefined {
  const query = useQuery({
    queryKey: namesQueryKey('items'),
    queryFn: () => getNames('items'),
    staleTime: Infinity,
    gcTime: Infinity,
    enabled,
  });

  const byId = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of query.data ?? []) {
      const candidate = row as { gid?: unknown; name?: unknown };
      const id = canonicalItemId(candidate.gid);
      if (id !== undefined && typeof candidate.name === 'string' && candidate.name.trim() !== '') {
        map.set(id, candidate.name);
      }
    }
    return map;
  }, [query.data]);

  return useCallback(
    (rawId: unknown): string | undefined => {
      const id = canonicalItemId(rawId);
      return id === undefined ? undefined : byId.get(id);
    },
    [byId],
  );
}

/* ------------------------------------------------------------------------- audit */

/**
 * The Audit section: the four embedded audit fields, **read-only and never written**
 * (docs/spec-data-model.md L189-191, D69(b)).
 *
 * It renders every key of the quartet, whether the file carries it or not, and says which — the
 * `droptables_wc-unicorn-side-001.json` shape (no audit block at all) is a fact the user should
 * see rather than a blank the form hides. Nothing here edits, so a save cannot refresh
 * `ModifiedAt`/`ModifiedBy` or add the block to the one file that lacks it.
 */
function AuditSection({ document }: { document: Record<string, unknown> }): JSX.Element {
  const anyPresent = DROP_TABLE_AUDIT_KEYS.some((key) => dropTableHasField(document, key));

  return (
    <section aria-label="Audit" className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Audit</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-xs text-zinc-400">
            Embedded audit fields. This editor shows them and never writes them, so a save leaves
            them exactly as the file had them.
          </p>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {DROP_TABLE_AUDIT_KEYS.map((key) => {
              const present = dropTableHasField(document, key);
              return (
                <div key={key} className="flex min-w-0 flex-col">
                  <dt className="text-xs text-zinc-400">{dropTableFieldSpec(key)?.label ?? key}</dt>
                  <dd className="truncate font-mono text-sm text-zinc-200">
                    {present ? scalarText(document[key]) : '— not present in this file'}
                  </dd>
                </div>
              );
            })}
          </dl>
          {anyPresent ? null : (
            <p className="text-xs text-amber-300">
              This file carries no audit block at all — a save keeps it that way.
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
