import { Plus, X } from 'lucide-react';
import { useState } from 'react';

import FriendlyNameDropdown from '../FriendlyNameDropdown';
import type { QuestDocumentState } from '../../hooks/useQuestDocument';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';

/**
 * The NpcInventory editor — plan task 4.3's form, mounted on task 4.1's generic
 * detail scaffolding so the scaffolding is **provably used** rather than built and
 * left unwired (the story's own acceptance criterion).
 *
 * The spec's two fields (docs/spec-ui-design.md L479-482): the NPC `TemplateID` as a
 * friendly-name dropdown over the `npcs` table (architecture rule 5 — the raw id is
 * what is stored, and the hidden input carries it), and the `Inventory` as removable
 * chips. The document schema is `docs/spec-domain-reference.md` L121-136.
 *
 * It edits through {@link DocPath}s and `setAtPath` rather than spreading the object:
 * decision D58 makes the shared document primitives the editors' mutation contract,
 * so the baseline/dirty/reset machinery the layout owns keeps working and key order,
 * explicit `null`s and unknown keys survive an edit (D5/D57).
 *
 * `Inventory` is replaced whole (add/remove) rather than mutated by index: an array's
 * membership and order are the editor's, and the server's D5 merge takes the incoming
 * array — so "remove the third chip" is one unambiguous edit.
 */
export interface NpcInventoryFormProps {
  /** The live document (the layout's baseline-aware model). */
  document: Record<string, unknown>;
  /** `view` renders the same fields read-only; `edit` renders the controls. */
  mode: 'view' | 'edit';
  /**
   * The live document state — the D58 mutation contract (`edit`/`editAll`) rather than a
   * bespoke setter, so a form that mounts a shared editor (`RequirementTreeEditor`) needs no
   * adapter. Story p4-02 replaced p4-01's `onSet` with this.
   */
  state: QuestDocumentState;
  disabled?: boolean;
}

/** The `Inventory` array of a document, as numbers (an unparsable entry is dropped). */
function inventoryOf(document: Record<string, unknown>): number[] {
  const raw = document.Inventory;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((value): value is number => typeof value === 'number');
}

export default function NpcInventoryForm({
  document,
  mode,
  state,
  disabled = false,
}: NpcInventoryFormProps): JSX.Element {
  const editing = mode === 'edit' && !disabled;
  const templateId = document.TemplateID;
  const inventory = inventoryOf(document);
  const [pendingItem, setPendingItem] = useState('');

  function addItem(): void {
    const parsed = Number(pendingItem.trim());
    if (!Number.isInteger(parsed) || parsed < 0) {
      return;
    }
    if (!inventory.includes(parsed)) {
      state.edit({ op: 'set', path: ['Inventory'], value: [...inventory, parsed] });
    }
    setPendingItem('');
  }

  function removeItem(item: number): void {
    state.edit({
      op: 'set',
      path: ['Inventory'],
      value: inventory.filter((value) => value !== item),
    });
  }

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
                const parsed = Number(rawId);
                state.edit({
                  op: 'set',
                  path: ['TemplateID'],
                  value: Number.isInteger(parsed) ? parsed : rawId,
                });
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
          <CardTitle className="text-sm">Inventory</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {inventory.length === 0 ? (
            <p className="text-xs text-zinc-500">This NPC's inventory is empty.</p>
          ) : (
            <ul className="flex flex-wrap gap-2" aria-label="Inventory items">
              {inventory.map((item) => (
                <li key={item}>
                  <Badge variant="secondary" className="gap-1 font-mono">
                    {item}
                    {editing ? (
                      <button
                        type="button"
                        aria-label={`Remove item ${item}`}
                        className="rounded-sm text-zinc-400 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        onClick={() => removeItem(item)}
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                      </button>
                    ) : null}
                  </Badge>
                </li>
              ))}
            </ul>
          )}

          {editing ? (
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-zinc-400" htmlFor="npc-inventory-add">
                  Add an item id
                </label>
                <Input
                  id="npc-inventory-add"
                  value={pendingItem}
                  inputMode="numeric"
                  onChange={(event) => setPendingItem(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addItem();
                    }
                  }}
                  className="w-40"
                />
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addItem}>
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                Add
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
