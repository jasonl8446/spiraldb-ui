import { Plus, X } from 'lucide-react';
import { useState } from 'react';

import {
  addTreasureCardEdit,
  newTreasureCardEntry,
  numberIdFromRaw,
  PRICE_ZERO_HINT,
  priceShowsBaseCostHint,
  readTreasureCards,
  removeTreasureCardEdit,
  textIdFromRaw,
  TREASURE_CARD_INVENTORY_LIST_KEY,
  treasureCardFieldPath,
  treasureCardPriceEdit,
  treasureCardSpellNameEdit,
} from '@shared/simpleObjects';

import type { QuestDocumentState } from '../../hooks/useQuestDocument';
import {
  SPELL_NAMES_NOT_LOADED_NOTE,
  treasureCardWarningCount,
  treasureCardWarningHeadline,
} from '../../lib/treasure-card-validation';
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
 * The TreasureCardInventory editor — plan task 4.7 / story p4-05 AC1,
 * docs/spec-domain-reference.md L183-208 and the warn-not-block rule of L542-546.
 *
 * The document is `{TemplateID, TreasureCards}` and each entry is exactly
 * `{SpellName, Price}` — see `shared/simpleObjects/treasureCardInventory.ts` for every measured
 * number, the literal-match decision and the `" TC"` finding. The two controls are the two the
 * criterion names:
 *
 * | AC1's words | here |
 * |---|---|
 * | "NPC dropdown" | `FriendlyNameDropdown` over `npcs` on the document's `TemplateID`, the raw id through the one conversion |
 * | "the `{SpellName, Price}` repeater" | one `<article>` per row, keyed by the row's **document index**; `SpellName` is a text box and `Price` a number box, both writing through the model's builders |
 * | "Price 0 = … (hint text)" | the row renders {@link PRICE_ZERO_HINT} under its Price box exactly when `priceShowsBaseCostHint(price)` — a **hint**, never a finding (the corpus has no 0 at all) |
 * | "SpellName not present in synced spells → warning (not blocking)" | the page's engine emits one warning per row and the Save gate only ever looks at `severity === 'error'`; the row shows the sentence inline through the shared `FieldValidation` plumbing |
 *
 * ## The repeater's two addressing rules
 *
 * A row is addressed by its **index** in the document array — `['TreasureCards', index,
 * 'SpellName']` — never by its value: a repeater can repeat a name, and this file's 71
 * distinct names are a measurement, not a contract (D71(a)). The row key is the index too, and
 * a row holds no local state, so a removal never moves another row's values.
 *
 * The Add box appends a **new entry object** from a typed name. That is deliberately not
 * `RawIdAddControl`, which appends an id to an **id list** (and `ObjectIdMultiSelect`, which
 * renders chips) — this list holds objects, so the control is this form's own, named once
 * here, and it reuses the shared `textIdFromRaw` guard: a blank typed name is refused (it is
 * not a name) and a name is stored **verbatim**, so a name the synced table does not hold —
 * the case the warning exists for — can be typed in directly. The appended row starts at the
 * corpus's most frequent price (`NEW_TREASURE_CARD_PRICE`, 36 of 71), and the row is then the
 * user's to edit; nothing writes a placeholder name.
 *
 * ## Edits go through the document state
 *
 * Every write is a `DocEdit` through `state.edit` (D58's mutation contract), so key order and
 * unknown keys survive (D5/D57), a removal writes the element path (`delete` → splice) rather
 * than one of its fields, and an emptied Price box writes the schema's own `0` instead of
 * deleting a required key (the model's entry-shape rule).
 */
export interface TreasureCardInventoryFormProps {
  /** The live document (the layout's baseline-aware model). */
  document: Record<string, unknown>;
  /** `view` renders the same fields read-only; `edit` renders the controls. */
  mode: 'view' | 'edit';
  /** The D58 mutation contract (`edit`/`editAll`). */
  state: QuestDocumentState;
  /** The page's validation messages for the live document (the warning summary's input). */
  messages: readonly FieldValidationMessage[];
  /**
   * `true` when the synced `spells` table was available, so the name match really ran. The page
   * knows it (its engine result's `referenceUsed`); with `false` the form says the check did not
   * happen instead of showing an empty summary (D65(c)).
   */
  referenceUsed: boolean;
  disabled?: boolean;
}

export default function TreasureCardInventoryForm({
  document,
  mode,
  state,
  messages,
  referenceUsed,
  disabled = false,
}: TreasureCardInventoryFormProps): JSX.Element {
  const editing = mode === 'edit' && !disabled;
  const templateId = document.TemplateID;
  const rows = readTreasureCards(document);
  const hasCards = Object.prototype.hasOwnProperty.call(document, TREASURE_CARD_INVENTORY_LIST_KEY);
  /** The Add box's typed name — the only local state, so a row's value is always the document's. */
  const [newName, setNewName] = useState('');
  const warningCount = treasureCardWarningCount(messages);
  const warningHeadline = treasureCardWarningHeadline(warningCount);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">NPC</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {editing ? (
            <FriendlyNameDropdown
              type="npcs"
              name="TemplateID"
              value={typeof templateId === 'number' ? templateId : null}
              onChange={(rawId) => {
                // The one raw-id conversion: the document must carry a JSON number, never the
                // control's string. An unparsable id writes nothing.
                const parsed = numberIdFromRaw(rawId);
                if (parsed !== undefined) {
                  state.edit({ op: 'set', path: ['TemplateID'], value: parsed });
                }
              }}
              aria-label="NPC TemplateID"
              placeholder="Select an NPC…"
            />
          ) : (
            <>
              <span className="font-mono text-sm text-zinc-100">
                {templateId === undefined || templateId === null ? '—' : String(templateId)}
              </span>
              <span className="text-xs text-zinc-500">TemplateID (the key of this file)</span>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Treasure cards</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {warningHeadline === null ? null : (
            <p data-warning-count={warningCount} className="text-xs text-amber-300">
              {warningHeadline}
            </p>
          )}
          {referenceUsed ? null : (
            <p data-reference-used="false" className="text-xs text-zinc-500">
              {SPELL_NAMES_NOT_LOADED_NOTE}
            </p>
          )}

          {rows.length === 0 ? (
            <p className="text-xs text-zinc-500">
              {hasCards
                ? 'This NPC sells no treasure cards (the file carries an empty TreasureCards array).'
                : 'This file carries no TreasureCards key yet.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-3" aria-label="Treasure cards">
              {rows.map(({ index, entry }) => (
                <li key={index}>
                  <TreasureCardRow index={index} entry={entry} editing={editing} state={state} />
                </li>
              ))}
            </ul>
          )}

          {editing ? (
            // `flex-wrap` is story p4-10's mobile fix (the same one `ZoneTransferForm`'s add row
            // takes): the `w-56` name box is 224px, so at 375px the box, the Add button and the
            // price hint do not fit on one line — without wrapping the controls' right edge
            // measured 414 of 375 and the page scrolled sideways.
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-zinc-400" htmlFor="treasure-card-new-name">
                  Add a card
                </label>
                <Input
                  id="treasure-card-new-name"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  aria-label="New treasure card name"
                  placeholder="Spell name…"
                  className="w-56"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Add treasure card"
                onClick={() => {
                  // A blank is not a name (`textIdFromRaw`'s own rule), so a blank add is a
                  // no-op; everything else is stored verbatim, suffix and all.
                  const name = textIdFromRaw(newName);
                  if (name === undefined) {
                    return;
                  }
                  state.edit(
                    addTreasureCardEdit(hasCards, rows.length, newTreasureCardEntry(name)),
                  );
                  setNewName('');
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Add card
              </Button>
              <span className="pb-2 text-xs text-zinc-500">
                a new card starts at price {newTreasureCardEntry('x').Price as number}
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

/** One repeater row: the name box, the price box, the `Price 0` hint, and its own messages. */
function TreasureCardRow({
  index,
  entry,
  editing,
  state,
}: {
  index: number;
  entry: Record<string, unknown>;
  editing: boolean;
  state: QuestDocumentState;
}): JSX.Element {
  const messages: readonly FieldValidationMessage[] = useFieldMessages(
    treasureCardFieldPath(index, 'SpellName'),
  );
  const nameId = `treasure-card-${index}-name`;
  const priceId = `treasure-card-${index}-price`;
  const priceHelpId = `treasure-card-${index}-price-help`;
  const priceHintId = `treasure-card-${index}-price-hint`;
  const messagesId = `treasure-card-${index}-name-messages`;
  const price = entry.Price;
  const showsHint = priceShowsBaseCostHint(price);

  return (
    <article
      aria-label={`Treasure card ${index + 1}`}
      className="flex flex-col gap-2 rounded-md border border-zinc-800 p-3"
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-400" htmlFor={nameId}>
          Spell name
        </label>
        <Input
          id={nameId}
          value={typeof entry.SpellName === 'string' ? entry.SpellName : ''}
          readOnly={!editing}
          aria-label={`Treasure card ${index + 1} spell name`}
          aria-invalid={fieldAriaInvalid(messages)}
          aria-describedby={messages.length === 0 ? undefined : messagesId}
          className={`w-72 ${fieldBorder(messages) ?? ''}`.trim()}
          onChange={(event) => state.edit(treasureCardSpellNameEdit(index, event.target.value))}
        />
        <FieldMessages messages={messages} id={messagesId} />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-zinc-400" htmlFor={priceId}>
          Price
        </label>
        <Input
          id={priceId}
          // No `min` and no `max`: the spec prints no bound for Price, so the control accepts
          // whatever the document may hold and the editor invents no rule (D57).
          type="number"
          inputMode="numeric"
          value={typeof price === 'number' ? String(price) : ''}
          readOnly={!editing}
          aria-label={`Treasure card ${index + 1} price`}
          aria-describedby={showsHint ? `${priceHelpId} ${priceHintId}` : priceHelpId}
          className="w-32"
          onChange={(event) => state.edit(treasureCardPriceEdit(index, event.target.value))}
        />
        <span id={priceHelpId} className="text-xs text-zinc-500">
          Gold. The corpus’s prices are 100, 150, 200 and 250.
        </span>
        {showsHint ? (
          // The AC's hint: data, shown only for a price of exactly 0 — and no corpus file
          // carries one, which is why it is proven by a fixture in the story's spec.
          <p id={priceHintId} data-price-hint="base-cost" className="text-xs text-zinc-400">
            {PRICE_ZERO_HINT}
          </p>
        ) : null}
      </div>

      {editing ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          aria-label={`Remove treasure card ${index + 1}`}
          onClick={() => state.edit(removeTreasureCardEdit(index))}
        >
          <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Remove
        </Button>
      ) : null}
    </article>
  );
}
