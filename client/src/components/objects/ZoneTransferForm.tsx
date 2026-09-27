import { Plus, X } from 'lucide-react';
import { useState } from 'react';

import {
  addTeleportEdit,
  DESTINATION_LOC_HINT,
  NEW_TELEPORT_DESTINATION_LOC,
  newTeleportTriggerEntry,
  RAW_FIELDS_LABEL,
  rawFieldNote,
  rawTopLevelFields,
  readRawTopLevelFields,
  readTeleports,
  removeTeleportEdit,
  textIdFromRaw,
  TELEPORT_NUMBER_KEYS,
  teleportDestinationLocEdit,
  teleportDestinationZoneEdit,
  teleportFieldPath,
  teleportNumberEdit,
  teleportTriggerNameEdit,
  teleportTypeEdit,
  teleportTypeOptions,
  teleportTypeValue,
  ZONE_TRANSFER_LIST_KEY,
} from '@shared/simpleObjects';

import type { QuestDocumentState } from '../../hooks/useQuestDocument';
import {
  zoneTransferBlockingCount,
  zoneTransferBlockingHeadline,
} from '../../lib/zone-transfer-validation';
import type { FieldValidationMessage } from '../../lib/validation-message';
import FriendlyNameDropdown from '../FriendlyNameDropdown';
import {
  FieldMessages,
  fieldAriaInvalid,
  fieldBorder,
  useFieldMessages,
} from '../shared/FieldValidation';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';

/**
 * The `WizardZoneData` editor — plan task 4.8 / story p4-06 AC1 + AC2,
 * docs/spec-domain-reference.md L281-309, L700-702 and L542-546.
 *
 * The document is `{ZoneName, Events, Teleports:[{TriggerName, Teleport:{…six fields}}]}` — see
 * `shared/simpleObjects/zoneTransfer.ts` for every measured number, the `m_destinationLoc` regex
 * (and its proven scientific-notation arm), the `m_teleportType` decision and the `Events` guard.
 * The controls the criterion names:
 *
 * | AC1's words | here |
 * |---|---|
 * | "`ZoneName` key with a humanized zone dropdown" | `FriendlyNameDropdown` over **`zones`** on the document's `ZoneName`; the label is the names type's own (`display_name`, falling back to the existing `humanizeZone`) — this form adds **no** humanizer |
 * | "`Teleports` repeater with nested `Teleport` fields" | one `<article>` per row, keyed by the row's **document index**, holding the trigger name and the six nested fields |
 * | "`m_destinationLoc` regex-validated 4-float string" | a text box writing the typed string verbatim, with {@link DESTINATION_LOC_HINT} under it and the shared engine's **blocking** inline message when the value fails the pattern (Save is disabled while it is present, L542-546; no corpus value fails it, so only an edit can) |
 * | "`m_destinationZone` dropdown" | a second `FriendlyNameDropdown` over `zones` at the nested path |
 * | "`m_exitTeleporter`/`m_teleporterTag`/`m_transitionID` numbers" | three number boxes writing JSON numbers (an emptied box writes `0`, a key the schema requires) |
 * | "`m_teleportType` enum" | a `<select>` offering the **one measured member** plus — verbatim, marked unrecognised — any stored value the model does not know, so an unknown value is never rewritten |
 * | AC2 "visible in a read-only raw-fields disclosure" | the last card: a `<details>` listing every top-level key the model does not edit (here `Events`, `[]` on all 1,207 files) with {@link rawFieldNote}'s measured sentence and the values verbatim |
 *
 * ## The two addressing rules this repeater follows
 *
 * A row is addressed by its **index** in the document array (`['Teleports', index, 'Teleport',
 * 'm_destinationLoc']`), never by its value: a repeater can repeat a trigger name, and the corpus
 * does (two rows of one file share one). The row key is the index, and a row holds no local state,
 * so a removal never moves another row's values and `removeTeleportEdit` deletes the element —
 * the nested object travels with it instead of being left orphaned.
 *
 * The Add box appends a **new entry object** built by `newTeleportTriggerEntry` in the corpus's
 * dominant key order, with the schema's neutral values; its `m_destinationZone` starts at this
 * file's own `ZoneName` when there is one (a new teleport usually points at its own zone), and
 * never at an invented path. `textIdFromRaw` refuses a blank typed name, and the name is stored
 * verbatim.
 *
 * ## Every write is a `DocEdit`
 *
 * Through `state.edit` (D58's mutation contract), so key order and unknown keys survive (D5/D57),
 * a removal writes the element path, and each nested edit writes **one** nested field — the other
 * five keys keep their values *and* the object's own key order. The `Events` key is never an edit
 * target: nothing in this file can write it.
 */
export interface ZoneTransferFormProps {
  /** The live document (the layout's baseline-aware model). */
  document: Record<string, unknown>;
  /** `view` renders the same fields read-only; `edit` renders the controls. */
  mode: 'view' | 'edit';
  /** The D58 mutation contract (`edit`/`editAll`). */
  state: QuestDocumentState;
  /** The page's validation messages for the live document (the error banner's input). */
  messages: readonly FieldValidationMessage[];
  disabled?: boolean;
}

/** The native control classes the shared dialog/result editors use, so a select matches an input. */
const CONTROL_CLASS =
  'min-w-0 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

export default function ZoneTransferForm({
  document,
  mode,
  state,
  messages,
  disabled = false,
}: ZoneTransferFormProps): JSX.Element {
  const editing = mode === 'edit' && !disabled;
  const zoneName = document.ZoneName;
  const rows = readTeleports(document);
  const hasTeleports = Object.prototype.hasOwnProperty.call(document, ZONE_TRANSFER_LIST_KEY);
  /** The Add box's typed trigger name — the only local state, so a row is always the document's. */
  const [newTrigger, setNewTrigger] = useState('');
  const blockingCount = zoneTransferBlockingCount(messages);
  const blockingHeadline = zoneTransferBlockingHeadline(blockingCount);
  const rawFields = readRawTopLevelFields(document);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Zone name</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {editing ? (
            <FriendlyNameDropdown
              type="zones"
              name="ZoneName"
              value={typeof zoneName === 'string' ? zoneName : null}
              onChange={(rawId) => {
                // Verbatim, and a blank is refused: the key of a file is not an empty string
                // (`textIdFromRaw`'s own rule, applied to a single zone value).
                const next = textIdFromRaw(rawId);
                if (next !== undefined) {
                  state.edit({ op: 'set', path: ['ZoneName'], value: next });
                }
              }}
              aria-label="Zone name"
              placeholder="Select a zone…"
            />
          ) : (
            <>
              <span className="font-mono text-sm text-zinc-100">
                {typeof zoneName === 'string' && zoneName !== '' ? zoneName : '—'}
              </span>
              <span className="text-xs text-zinc-500">
                ZoneName (the key of this file — the dropdown shows the synced display name)
              </span>
            </>
          )}
          <span className="text-xs text-zinc-500">
            The dropdown’s label comes from the synced `zones` names type (`display_name`); the
            editor derives no display name of its own.
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Teleports</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {blockingHeadline === null ? null : (
            // L547's form-level banner: this is an error class, so it is red and it says what it
            // does — the Save button below is disabled while it is present.
            <p role="alert" data-blocking-count={blockingCount} className="text-xs text-red-400">
              {blockingHeadline}
            </p>
          )}

          {rows.length === 0 ? (
            <p className="text-xs text-zinc-500">
              {hasTeleports
                ? 'This zone has no teleport triggers (the file carries an empty Teleports array).'
                : 'This file carries no Teleports key yet.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-3" aria-label="Teleports">
              {rows.map(({ index, triggerName, teleport }) => (
                <li key={index}>
                  <TeleportRow
                    index={index}
                    triggerName={triggerName}
                    teleport={teleport}
                    editing={editing}
                    state={state}
                  />
                </li>
              ))}
            </ul>
          )}

          {editing ? (
            // `flex-wrap` is story p4-10's mobile fix: the `w-56` trigger box is 224px, so at
            // 375px the box, the Add button and the trailing hint do not fit on one line —
            // without wrapping the controls' right edge measured 431 of 375.
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-zinc-400" htmlFor="zone-transfer-new-trigger">
                  Add a teleport
                </label>
                <Input
                  id="zone-transfer-new-trigger"
                  value={newTrigger}
                  onChange={(event) => setNewTrigger(event.target.value)}
                  aria-label="New teleport trigger name"
                  placeholder="Trigger name…"
                  className="w-56"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Add teleport"
                onClick={() => {
                  // A blank is not a trigger name (`textIdFromRaw`'s own rule), so a blank add is
                  // a no-op; everything else is stored verbatim.
                  const trigger = textIdFromRaw(newTrigger);
                  if (trigger === undefined) {
                    return;
                  }
                  const destination = textIdFromRaw(zoneName) ?? '';
                  state.edit(
                    addTeleportEdit(
                      hasTeleports,
                      rows.length,
                      newTeleportTriggerEntry(trigger, destination),
                    ),
                  );
                  setNewTrigger('');
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Add teleport
              </Button>
              <span className="pb-2 text-xs text-zinc-500">
                a new row starts at {NEW_TELEPORT_DESTINATION_LOC} and it matches this zone
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <RawFieldsDisclosure document={document} rawFields={rawFields} />
    </div>
  );
}

/**
 * The read-only disclosure of the top-level keys this editor does not model.
 *
 * On every corpus file that is exactly `Events` — the drift field AC2 is about: absent from the
 * spec schema (L281-309) and present, as an empty array, in all 1,207 files. The key is shown with
 * {@link rawFieldNote}'s measured sentence and its value verbatim, so the user sees what the file
 * carries and what a save does with it (nothing). The disclosure also lists any *other* unmodelled
 * key, because "everything the model does not edit" is the rule, not "the `Events` key".
 *
 * Nothing here is a control: there is no input to change a raw field, and no edit path in the form
 * can reach one.
 */
function RawFieldsDisclosure({
  document,
  rawFields,
}: {
  document: Record<string, unknown>;
  rawFields: readonly { key: string; value: unknown }[];
}): JSX.Element | null {
  if (rawFields.length === 0) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Raw fields (read-only)</CardTitle>
      </CardHeader>
      <CardContent>
        <details
          data-raw-fields="true"
          aria-label={RAW_FIELDS_LABEL}
          className="rounded-md border border-zinc-800 bg-zinc-950/40"
        >
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
            {`${RAW_FIELDS_LABEL} (${rawFields.length} unmodelled)`}
          </summary>
          <div className="border-t border-zinc-800 p-3">
            <ul className="mb-2 flex flex-col gap-1">
              {rawFields.map((field) => (
                <li key={field.key} className="text-xs text-amber-400">
                  <span className="font-mono text-zinc-200">{field.key}</span> —{' '}
                  {rawFieldNote(field.key)}
                </li>
              ))}
            </ul>
            <pre className="max-h-72 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs leading-relaxed text-zinc-300">
              {JSON.stringify(rawTopLevelFields(document), null, 2)}
            </pre>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

/** One repeater row: the trigger name and the six nested fields, each addressed by its path. */
function TeleportRow({
  index,
  triggerName,
  teleport,
  editing,
  state,
}: {
  index: number;
  triggerName: unknown;
  teleport: Record<string, unknown> | null;
  editing: boolean;
  state: QuestDocumentState;
}): JSX.Element {
  const number = index + 1;
  const locMessages: readonly FieldValidationMessage[] = useFieldMessages(
    teleportFieldPath(index, 'm_destinationLoc'),
  );
  const triggerId = `zone-transfer-${index}-trigger`;
  const locId = `zone-transfer-${index}-loc`;
  const locHintId = `zone-transfer-${index}-loc-hint`;
  const locMessagesId = `zone-transfer-${index}-loc-messages`;
  const destinationZone = teleport?.m_destinationZone;
  const teleportType = teleport?.m_teleportType;
  const typeOptions = teleportTypeOptions(teleportType);
  const typeValue = teleportTypeValue(teleportType);
  const typeHasValue = typeOptions.some((option) => option.value === typeValue);

  return (
    <article
      aria-label={`Teleport ${number}`}
      className="flex flex-col gap-3 rounded-md border border-zinc-800 p-3"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-400" htmlFor={triggerId}>
          Trigger name
        </label>
        <Input
          id={triggerId}
          value={typeof triggerName === 'string' ? triggerName : ''}
          readOnly={!editing}
          aria-label={`Teleport ${number} trigger name`}
          className="w-72"
          onChange={(event) => state.edit(teleportTriggerNameEdit(index, event.target.value))}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-400" htmlFor={locId}>
          Destination location
        </label>
        <Input
          id={locId}
          value={typeof teleport?.m_destinationLoc === 'string' ? teleport.m_destinationLoc : ''}
          readOnly={!editing}
          aria-label={`Teleport ${number} destination location`}
          aria-invalid={fieldAriaInvalid(locMessages)}
          aria-describedby={locMessages.length === 0 ? locHintId : `${locHintId} ${locMessagesId}`}
          // `w-full md:w-96` is story p4-10's mobile fix: the fixed 384px box (spec-appropriate
          // on desktop, where the row is roomy) is wider than the 327px content column a 375px
          // viewport leaves, so it sat 442px right of the origin and was clipped.
          className={`w-full font-mono md:w-96 ${fieldBorder(locMessages) ?? ''}`.trim()}
          onChange={(event) => state.edit(teleportDestinationLocEdit(index, event.target.value))}
        />
        <span id={locHintId} className="text-xs text-zinc-500">
          {DESTINATION_LOC_HINT}
        </span>
        <FieldMessages messages={locMessages} id={locMessagesId} />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-xs text-zinc-400">Destination zone</span>
        {editing ? (
          <FriendlyNameDropdown
            type="zones"
            name={`Teleports[${index}].Teleport.m_destinationZone`}
            value={typeof destinationZone === 'string' ? destinationZone : null}
            onChange={(rawId) => state.edit(teleportDestinationZoneEdit(index, rawId))}
            aria-label={`Teleport ${number} destination zone`}
            placeholder="Select a zone…"
          />
        ) : (
          <span className="font-mono text-sm text-zinc-100">
            {typeof destinationZone === 'string' && destinationZone !== '' ? destinationZone : '—'}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        {TELEPORT_NUMBER_KEYS.map((key) => {
          const value = teleport?.[key];
          const id = `zone-transfer-${index}-${key}`;
          return (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-xs text-zinc-400" htmlFor={id}>
                {NUMBER_LABELS[key]}
              </label>
              <Input
                id={id}
                type="number"
                inputMode="numeric"
                value={typeof value === 'number' ? String(value) : ''}
                readOnly={!editing}
                aria-label={`Teleport ${number} ${NUMBER_ARIA[key]}`}
                className="w-32"
                onChange={(event) => state.edit(teleportNumberEdit(index, key, event.target.value))}
              />
            </div>
          );
        })}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-zinc-400" htmlFor={`zone-transfer-${index}-type`}>
            Teleport type
          </label>
          <select
            id={`zone-transfer-${index}-type`}
            aria-label={`Teleport ${number} teleport type`}
            value={typeValue}
            disabled={!editing}
            className={CONTROL_CLASS}
            onChange={(event) => state.edit(teleportTypeEdit(index, event.target.value))}
          >
            {typeHasValue ? null : <option value="">— not set —</option>}
            {typeOptions.map((option) => (
              <option
                key={option.value}
                value={option.value}
                data-unrecognised={option.unrecognised ? 'true' : undefined}
              >
                {option.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-zinc-500">
            The corpus carries one member, TELEPORT_STATIC. A value this editor does not know is
            kept exactly as stored and shown as unrecognised.
          </span>
        </div>
      </div>

      {editing ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          aria-label={`Remove teleport ${number}`}
          onClick={() => state.edit(removeTeleportEdit(index))}
        >
          <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Remove
        </Button>
      ) : null}
    </article>
  );
}

/** The three numeric fields' visible labels. */
const NUMBER_LABELS: Record<(typeof TELEPORT_NUMBER_KEYS)[number], string> = {
  m_exitTeleporter: 'Exit teleporter',
  m_teleporterTag: 'Teleporter tag',
  m_transitionID: 'Transition ID',
};

/** The same three fields' accessible-name tails (the visible label, lower-cased). */
const NUMBER_ARIA: Record<(typeof TELEPORT_NUMBER_KEYS)[number], string> = {
  m_exitTeleporter: 'exit teleporter',
  m_teleporterTag: 'teleporter tag',
  m_transitionID: 'transition ID',
};
