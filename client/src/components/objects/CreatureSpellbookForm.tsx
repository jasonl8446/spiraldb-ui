import { ArrowDown, ArrowUp, X } from 'lucide-react';

import {
  CREATURE_SPELLBOOK_LIST_KEY,
  moveInList,
  numberIdFromRaw,
  readNumberList,
  replaceListEdit,
} from '@shared/simpleObjects';

import type { QuestDocumentState } from '../../hooks/useQuestDocument';
import { textFieldEdit } from '../../lib/quest-info';
import FriendlyNameDropdown from '../FriendlyNameDropdown';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import RawIdAddControl from './RawIdAddControl';

/**
 * The CreatureSpellbook editor — plan task 4.5 / story p4-03 AC3, docs/spec-domain-reference.md
 * L27-42.
 *
 * The document is `{DeckName, SpellTemplateIds}` and nothing else (134/134 files — see
 * `shared/simpleObjects/creatureSpellbook.ts` for the other measured numbers). `DeckName` is the
 * key **and** the only key the corpus looks up case-insensitively; `SpellTemplateIds` is an
 * ordered list of 1,267 real values of which 368 resolve in `spells` and **one**
 * (`213674121`) does not.
 *
 * ## AC3's own words, one by one
 *
 * | AC3's words | how |
 * |---|---|
 * | "`DeckName` key" | the text control, edited through the shared present-aware `textFieldEdit` (p4-02's rule for a string key: emptying it deletes the key, and the server's generic router then refuses the POST with "no usable DeckName") |
 * | "**reorderable**" | `Move up` / `Move down` buttons per row (disabled at the ends) writing one whole-array replacement through `moveInList` — see the note below |
 * | "`SpellTemplateIds` list" | an ordered `<ol>` of rows; the 9 corpus files carrying `[]` render the empty state and save `[]` |
 * | "with spell dropdowns" | every row carries `FriendlyNameDropdown type="spells"`, so a row's spell can be changed as well as moved |
 * | "renders, edits, saves" | mounted on `ObjectDetailPage` ⇒ `POST /api/creature-spellbooks` |
 *
 * ## Why the reorder is buttons rather than a drag handle
 *
 * The library p3-04 pinned for goal reordering (`@dnd-kit/core` + `@dnd-kit/sortable`, D60(f))
 * is available, but a two-button move is: keyboard-operable by construction (no sensor timing
 * window), exact (one destination index per click, no `closestCenter` guess at a card's edge),
 * and it needs no new code path — `moveInList` already returns the destination-indexed array that
 * one whole-array replacement writes. D60(i) records the dnd-kit keyboard-reorder timing problem
 * this avoids; a pointer drag would be a UX addition, not an AC3 requirement, and it can be
 * layered on later through the same `moveInList`/`replaceListEdit` pair.
 *
 * ## Why an added row is a *picked* spell
 *
 * `SpellTemplateIds` holds spell ids, and `TemplateID: 0` is not a spell (0 resolving spell ids
 * is measured). So "Add spell" is a spell dropdown that appends the picked id — no placeholder is
 * invented — and the shared `RawIdAddControl` covers the one measured miss, which no name search
 * can reach.
 */
export interface CreatureSpellbookFormProps {
  /** The live document (the layout's baseline-aware model). */
  document: Record<string, unknown>;
  /** `view` renders the same fields read-only; `edit` renders the controls. */
  mode: 'view' | 'edit';
  /** The D58 mutation contract (`edit`/`editAll`). */
  state: QuestDocumentState;
  disabled?: boolean;
}

export default function CreatureSpellbookForm({
  document,
  mode,
  state,
  disabled = false,
}: CreatureSpellbookFormProps): JSX.Element {
  const editing = mode === 'edit' && !disabled;
  const deckName = document.DeckName;
  const spells = readNumberList(document, CREATURE_SPELLBOOK_LIST_KEY);
  const present = Object.prototype.hasOwnProperty.call(document, CREATURE_SPELLBOOK_LIST_KEY);

  /** The one writer of every list change: replace the array whole (p4-02's list-edit rule). */
  function setSpells(next: number[]): void {
    state.edit(replaceListEdit([CREATURE_SPELLBOOK_LIST_KEY], next));
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Deck</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <label className="text-xs text-zinc-400" htmlFor="creature-spellbook-deck-name">
            Deck name
          </label>
          {editing ? (
            <Input
              id="creature-spellbook-deck-name"
              value={typeof deckName === 'string' ? deckName : ''}
              aria-label="Deck name"
              onChange={(event) =>
                state.edit(textFieldEdit('DeckName', present, event.target.value))
              }
            />
          ) : (
            <span className="font-mono text-sm text-zinc-100">
              {typeof deckName === 'string' && deckName !== '' ? deckName : '—'}
            </span>
          )}
          <span className="text-xs text-zinc-500">
            DeckName (the key of this file; all 134 corpus names are unique)
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Spells</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {spells.length === 0 ? (
            <p className="text-xs text-zinc-500">
              This deck has no spells (the file carries an empty SpellTemplateIds array).
            </p>
          ) : (
            <ol className="flex flex-col gap-2" aria-label="Deck spells">
              {spells.map((id, index) => {
                const position = index + 1;
                return (
                  <li
                    key={index}
                    className="flex flex-wrap items-end gap-2 rounded-md border border-zinc-800 p-2"
                  >
                    <span className="pb-2 font-mono text-xs text-zinc-500">{position}</span>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-zinc-400">Spell</span>
                      <FriendlyNameDropdown
                        type="spells"
                        name={`SpellTemplateIds.${index}`}
                        value={id}
                        disabled={!editing}
                        aria-label={`Spell ${position}`}
                        onChange={(rawId) => {
                          const parsed = numberIdFromRaw(rawId);
                          if (parsed !== undefined) {
                            const next = spells.slice();
                            next[index] = parsed;
                            setSpells(next);
                          }
                        }}
                      />
                    </div>

                    {editing ? (
                      <div className="flex items-center gap-1 pb-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Move spell ${position} up`}
                          disabled={index === 0}
                          onClick={() => setSpells(moveInList(spells, index, index - 1))}
                        >
                          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Move spell ${position} down`}
                          disabled={index === spells.length - 1}
                          onClick={() => setSpells(moveInList(spells, index, index + 1))}
                        >
                          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Remove spell ${position}`}
                          onClick={() => setSpells(spells.filter((_, at) => at !== index))}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}

          {editing ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-zinc-400">Add spell</span>
                <FriendlyNameDropdown
                  type="spells"
                  name={`SpellTemplateIds.${spells.length}.addition`}
                  // Always `null`: picking appends a row, the dropdown never holds a value.
                  value={null}
                  aria-label="Add spell"
                  placeholder="Add a spell…"
                  onChange={(rawId) => {
                    const parsed = numberIdFromRaw(rawId);
                    if (parsed !== undefined && !spells.includes(parsed)) {
                      setSpells([...spells, parsed]);
                    }
                  }}
                />
              </div>

              <RawIdAddControl
                id="creature-spellbook-raw-id"
                label="Add a spell id"
                help="1 of the corpus's 369 distinct spell ids has no synced name and shows as a raw id."
                onAdd={(id) => {
                  if (!spells.includes(id)) {
                    setSpells([...spells, id]);
                  }
                }}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
