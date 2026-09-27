import { Plus, X } from 'lucide-react';

import {
  addSpellEntryEdit,
  NONE_REQUIRED_SPELL_LABEL,
  NPC_SPELL_INVENTORY_LIST_KEY,
  numberIdFromRaw,
  readSpellEntries,
  removeSpellEntryEdit,
  requiredSpellEdit,
  requiredSpellIsNone,
  spellEntryLevelEdit,
} from '@shared/simpleObjects';

import type { QuestDocumentState } from '../../hooks/useQuestDocument';
import FriendlyNameDropdown from '../FriendlyNameDropdown';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';

/**
 * The NpcSpellInventory editor — plan task 4.4 / story p4-03 AC2, docs/spec-domain-reference.md
 * L138-164 and the `NPCSpellEntry` table.
 *
 * The document is `{TemplateID, Spells}` (77/77 files) and each entry is exactly
 * `{TemplateID, RequiredSpellID, Level}` (560/560) — see `shared/simpleObjects/npcSpellInventory.ts`
 * for every measured number. The field table is that module's `NPC_SPELL_ENTRY_FIELDS`, not a
 * second list here.
 *
 * ## AC2's own words, one by one
 *
 * | AC2's words | how |
 * |---|---|
 * | "NPC dropdown" | `FriendlyNameDropdown type="npcs"` on the document's `TemplateID` (unchanged in kind from NpcInventory) |
 * | "`TemplateID` spell dropdown" | `FriendlyNameDropdown type="spells"` per row; the raw id goes through `numberIdFromRaw` because the document stores a JSON number |
 * | "`RequiredSpellID` with explicit **`none (0)`** option" | the row's second dropdown passes `allowEmpty emptyLabel="none (0)"` — the option's text is exactly `none (0)` — and `requiredSpellEdit` maps the clear back to the stored sentinel `0` |
 * | "`Level` number" | a number box with **no `min`**: the corpus really has `Level: 0` (34 entries) and the measured range is 0–420, so a `min={1}` would make real content unsaveable |
 * | "renders, edits, saves" | mounted on `ObjectDetailPage` ⇒ `POST /api/npc-spell-inventories` |
 *
 * ## The `RequiredSpellID: 0` trap, and how it is avoided structurally
 *
 * `0` means "no prerequisite" in **239 of the 560** real entries — it is not a spell, and
 * `GET /api/names/spells/0` would 404. `requiredSpellIsNone(value)` is the one predicate that
 * says so, and the row hands `FriendlyNameDropdown` **`null`** when it is true: `selectedId(null)`
 * is `''`, which is the dropdown's documented "nothing selected" state, so it issues no lookup
 * and shows the `none (0)` placeholder. The value the dropdown would otherwise carry is never
 * sent anywhere.
 *
 * ## A new row is picked, not invented
 *
 * `TemplateID: 0` occurs nowhere in the corpus, so "Add spell" is itself a spell dropdown: it
 * appends `newSpellEntry(pickedId)` — the corpus's exact three-key shape with
 * `RequiredSpellID: 0` and `Level: 1` — only once the user picks a real spell. Nothing writes a
 * placeholder id, and no lookup for `0` is issued on the add path either.
 *
 * ## Rows are keyed by index
 *
 * One corpus file carries the same offered spell twice, so the row key is the document index
 * (safe here: a row holds no local state — every value is read from the live document). Every
 * edit addresses `['Spells', index, field]`, so removing row 2 leaves row 3's values with row 3.
 */
export interface NpcSpellInventoryFormProps {
  /** The live document (the layout's baseline-aware model). */
  document: Record<string, unknown>;
  /** `view` renders the same fields read-only; `edit` renders the controls. */
  mode: 'view' | 'edit';
  /** The D58 mutation contract (`edit`/`editAll`). */
  state: QuestDocumentState;
  disabled?: boolean;
}

export default function NpcSpellInventoryForm({
  document,
  mode,
  state,
  disabled = false,
}: NpcSpellInventoryFormProps): JSX.Element {
  const editing = mode === 'edit' && !disabled;
  const templateId = document.TemplateID;
  const rows = readSpellEntries(document);
  const hasSpells = Object.prototype.hasOwnProperty.call(document, NPC_SPELL_INVENTORY_LIST_KEY);

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
          <CardTitle className="text-sm">Spells</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {rows.length === 0 ? (
            <p className="text-xs text-zinc-500">
              This trainer offers no spells (the file carries an empty Spells array).
            </p>
          ) : (
            <ul className="flex flex-col gap-3" aria-label="Spell entries">
              {rows.map(({ index, entry }) => {
                const required = entry.RequiredSpellID;
                return (
                  <li key={index}>
                    <article
                      aria-label={`Spell ${index + 1}`}
                      className="flex flex-col gap-2 rounded-md border border-zinc-800 p-3"
                    >
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-zinc-400">Spell</span>
                        <FriendlyNameDropdown
                          type="spells"
                          name={`Spells.${index}.TemplateID`}
                          value={typeof entry.TemplateID === 'number' ? entry.TemplateID : null}
                          disabled={!editing}
                          aria-label={`Spell ${index + 1} template`}
                          onChange={(rawId) => {
                            const parsed = numberIdFromRaw(rawId);
                            if (parsed !== undefined) {
                              state.edit({
                                op: 'set',
                                path: ['Spells', index, 'TemplateID'],
                                value: parsed,
                              });
                            }
                          }}
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-zinc-400">Required spell</span>
                        <FriendlyNameDropdown
                          type="spells"
                          name={`Spells.${index}.RequiredSpellID`}
                          // The sentinel is "nothing", so the dropdown gets `null` and never
                          // looks up spell 0 (see the module header).
                          value={requiredSpellIsNone(required) ? null : (required as number)}
                          onChange={(rawId) => state.edit(requiredSpellEdit(index, rawId))}
                          // The AC's own words: the explicit option reads `none (0)`, and the
                          // stored value stays 0 (`requiredSpellEdit` maps '' back to it).
                          allowEmpty
                          emptyLabel={NONE_REQUIRED_SPELL_LABEL}
                          placeholder={NONE_REQUIRED_SPELL_LABEL}
                          disabled={!editing}
                          aria-label={`Spell ${index + 1} required spell`}
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-zinc-400" htmlFor={`spell-${index}-level`}>
                          Level
                        </label>
                        <Input
                          id={`spell-${index}-level`}
                          // No `min`: Level 0 is real (34 corpus entries) and the measured
                          // range is 0–420, so the control must accept 0 and never clamp (D57).
                          type="number"
                          inputMode="numeric"
                          value={typeof entry.Level === 'number' ? String(entry.Level) : ''}
                          readOnly={!editing}
                          aria-label={`Spell ${index + 1} level`}
                          className="w-24"
                          onChange={(event) =>
                            state.edit(spellEntryLevelEdit(index, event.target.value))
                          }
                        />
                      </div>

                      {editing ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-fit"
                          aria-label={`Remove spell ${index + 1}`}
                          onClick={() => state.edit(removeSpellEntryEdit(index))}
                        >
                          <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                          Remove
                        </Button>
                      ) : null}
                    </article>
                  </li>
                );
              })}
            </ul>
          )}

          {editing ? (
            <div className="flex items-end gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-zinc-400">Add spell</span>
                <FriendlyNameDropdown
                  type="spells"
                  name={`Spells.${rows.length}.addition`}
                  // Always `null`: this control only ever *picks* (picking appends a row and the
                  // dropdown resets with it), so a stale value can never be re-submitted.
                  value={null}
                  aria-label="Add spell"
                  placeholder="Add a spell…"
                  onChange={(rawId) => {
                    const parsed = numberIdFromRaw(rawId);
                    if (parsed !== undefined) {
                      state.edit(addSpellEntryEdit(hasSpells, rows.length, parsed));
                    }
                  }}
                />
              </div>
              <span className="pb-2 text-xs text-zinc-500">
                <Plus className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                picking a spell appends a row
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
