import { numberIdFromRaw, NPC_INVENTORY_LIST_KEY, readNumberList } from '@shared/simpleObjects';

import type { QuestDocumentState } from '../../hooks/useQuestDocument';
import FriendlyNameDropdown from '../FriendlyNameDropdown';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import ObjectIdMultiSelect from './ObjectIdMultiSelect';

/**
 * The NpcInventory editor — plan task 4.3's form (story p4-01 built the first version, story
 * p4-03 closed AC1's remaining gap).
 *
 * ## What p4-01 already had, and what this story added
 *
 * AC1 asks for two controls and a save path. p4-01's version already delivered the first and the
 * *frame* of the second:
 *
 * | AC1's words | p4-01 | now |
 * |---|---|---|
 * | "NPC `FriendlyNameDropdown`" | ✅ over `npcs`, raw id in a hidden field | unchanged |
 * | "**searchable multi-select over item names**" | ❌ chips showed **raw numeric ids** and the only way to add one was a numeric text box — there was no search over the 79,835 items at all | ✅ `ObjectIdMultiSelect`: a cmdk search over `items` names **and** ids, chips showing the **name** |
 * | "rendered as removable chips" | ✅ removable, raw id per chip | ✅ removable by **index** (so a pre-existing duplicate survives), chip text = name, or the raw id for the 42 measured misses |
 * | "renders, edits, saves via the pipeline" | ✅ mounted on task 4.1's generic detail page ⇒ `POST /api/npc-inventories` | unchanged — the pipeline is the page's; `ObjectDetailPage` owns the save |
 *
 * The numeric add box p4-01 had is **kept inside the multi-select** rather than dropped: 42 of
 * the corpus's 3,205 distinct item ids have no synced name, so the name search cannot reach them
 * and typing an id is the only way to put one back (D60(c)/D63(c)).
 *
 * ## The shape it edits
 *
 * The document is `{TemplateID, Inventory}` and **nothing else** (215/215 files — see
 * `shared/simpleObjects/npcInventory.ts`, which also carries the other measured numbers). It
 * edits through `DocPath`s and `state.edit` rather than spreading the object: D58 makes the
 * shared document primitives the editors' mutation contract, so key order and unknown keys
 * survive (D5/D57) and the layout's baseline/dirty machinery keeps working.
 *
 * `Inventory` is replaced **whole** on every change (add, remove, "Add id"): membership is the
 * editor's, and the server's D5 merge takes the incoming array — so "remove the third chip" is
 * one unambiguous edit, and the one file that carries `[]` still saves `[]`.
 */
export interface NpcInventoryFormProps {
  /** The live document (the layout's baseline-aware model). */
  document: Record<string, unknown>;
  /** `view` renders the same fields read-only; `edit` renders the controls. */
  mode: 'view' | 'edit';
  /**
   * The live document state — the D58 mutation contract (`edit`/`editAll`) rather than a
   * bespoke setter, so a form that mounts a shared editor needs no adapter.
   */
  state: QuestDocumentState;
  disabled?: boolean;
}

export default function NpcInventoryForm({
  document,
  mode,
  state,
  disabled = false,
}: NpcInventoryFormProps): JSX.Element {
  const editing = mode === 'edit' && !disabled;
  const templateId = document.TemplateID;
  const inventory = readNumberList(document, NPC_INVENTORY_LIST_KEY);

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
                // The one raw-id conversion (`shared/ulong.ts` through the model): the document
                // must carry a JSON number, never the control's string. An unparsable id writes
                // nothing, so the key keeps the value it had.
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
              <span className="text-xs text-zinc-400">TemplateID (the key of this file)</span>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Inventory</CardTitle>
        </CardHeader>
        <CardContent>
          <ObjectIdMultiSelect
            type="items"
            idKind="number"
            noun="item"
            idPrefix="npc-inventory"
            values={inventory}
            disabled={!editing}
            emptyText="This NPC's inventory is empty (the file carries an empty Inventory array)."
            rawIdLabel="Add an item id"
            help="42 of the corpus's 3,205 distinct item ids have no synced name and show as raw ids."
            onChange={(next) => {
              state.edit({ op: 'set', path: [NPC_INVENTORY_LIST_KEY], value: next });
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
