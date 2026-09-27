import { ULong } from '../ulong.js';
import type { DocEdit, DocPath } from '../document.js';

/**
 * The shared vocabulary of the three "one key + one list" families — plan tasks 4.3 (story
 * 4.3), 4.4 and 4.5, story p4-03.
 *
 * Two things live here rather than in a per-type module, because all three families (and the
 * two Phase-4 families still to come, NpcDropTable and TreasureCardInventory) need them and a
 * second copy would be the divergence §4's risk table names:
 *
 * 1. **`SimpleFieldSpec`** — the field inventory as *data* (D59(b)'s rule: a form does not
 *    restate what a module can state). The three families have no validation rules at all (the
 *    spec fixes none beyond the schema), so the inventory is small: a key, a label, the control
 *    kind, the names table it searches, and how many of the measured corpus files carry it.
 * 2. **The list primitives** — every edit these families make is "replace this array whole",
 *    "append this id", "remove the id at this index", or "move this element". `shared/document.ts`
 *    is the mutation contract (D58); these are the list-shaped builders on top of it, so no form
 *    invents its own `splice`.
 *
 * ## Index-addressed removal is not a detail
 *
 * Measured 2026-09-27 in the real fork: **14** `NpcInventory` files and **4**
 * `CreatureSpellbook` files carry a *duplicate* value inside their list (e.g. an item offered
 * twice). A value-based removal (`values.filter(v => v !== id)`) would silently collapse those
 * 18 files' duplicate entries on any unrelated edit, so {@link removeAtIndex} removes exactly
 * the element the user clicked and the forms key their chips/rows by **index**, never by value.
 * {@link addToList} still refuses an id that is already present (the picker cannot create a
 * duplicate), so the editor never *grows* one; it only preserves the ones that exist.
 *
 * ## All three types store JSON numbers
 *
 * Unlike the DropTable's `ItemId` (a JSON string in 72 of 72 rows, D70(e)), every value inside
 * these three types is a JSON **number** (measured: 3,785 + 560×3 + 1,267 values, 0 of them
 * strings). The string↔number trap therefore does not appear *inside* a document — but it does
 * appear at the **control boundary**: `FriendlyNameDropdown` hands back the raw id as a string
 * (`onChange: (rawId: string) => void`) and the names API's `NameOption.id` is a string.
 * {@link numberIdFromRaw} is the one conversion, delegating to `ULong.toJson` (the shared helper
 * `shared/ulong.ts` already owns), so no call site writes `Number(x)`.
 */

/** The names tables these families search. A subset of `lib/display.ts`'s `NamesType`. */
export type SimpleNamesType = 'npcs' | 'items' | 'spells';

/** How a field renders — the whole vocabulary these three families use. */
export type SimpleFieldKind =
  /** `FriendlyNameDropdown` over `npcs` (a `TemplateID` key). */
  | 'npc-select'
  /** `FriendlyNameDropdown` over `spells`. */
  | 'spell-select'
  /** A spell select whose `0` is the explicit `none (0)` option (`NPCSpellEntry.RequiredSpellID`). */
  | 'spell-select-none'
  /** The searchable multi-select over `items` names, rendered as removable chips. */
  | 'item-multi-select'
  /** The spell-entry repeater (`NPCSpellEntry[]`). */
  | 'spell-entry-list'
  /** The reorderable spell list (`SpellTemplateIds`). */
  | 'spell-order-list'
  /** A plain text control (`DeckName`). */
  | 'text';

/** One field of one of the three documents, as data. */
export interface SimpleFieldSpec {
  /** The document key, verbatim. */
  readonly key: string;
  /** The control's visible label. */
  readonly label: string;
  readonly kind: SimpleFieldKind;
  /** Which names table the control searches (absent for `text`). */
  readonly namesType?: SimpleNamesType;
  /**
   * `true` for every field of these three families: all three schemas mark both of their
   * fields `yes`, and the measured corpus is unanimous (215/215, 77/77, 134/134 carry both).
   * Recorded as a literal so a future optional field has to change this type, not sneak in.
   */
  readonly required: true;
  /** Files of the measured corpus carrying the key. The denominator is the family's constant. */
  readonly corpusPresence: number;
  /** One line of help under the control, where the measured reality needs saying. */
  readonly help?: string;
}

/** `true` when a value is a finite JSON number — the only kind these lists may contain. */
function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The array at `key` as numbers, in document order.
 *
 * `[]` for a key that is absent, `null`, or not an array — the three "no list here" shapes a
 * form renders as its empty state, which is also what an **empty array** renders (the corpus
 * really has one: 1 `NpcInventory` and 9 `CreatureSpellbook` files carry `[]`, and D57 requires
 * the key and its `[]` to survive a save).
 *
 * A value that is not a finite number is **not** returned: it cannot be rendered as a chip or a
 * row, and a list edit replaces the array whole. That is a measured-impossible case rather than
 * a defensive one — 0 of the 3,785 `Inventory` values and 0 of the 1,267 `SpellTemplateIds`
 * values are non-numbers — and `tests/unit/simple-objects-model.test.ts` re-measures it against
 * the live corpus, so a corpus that starts carrying one fails a test instead of losing it.
 */
export function readNumberList(document: Record<string, unknown>, key: string): number[] {
  const raw = document[key];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(isNumber);
}

/** `true` when `id` already appears in the list (the picker's duplicate guard). */
export function containsId(values: readonly number[], id: number): boolean {
  return values.includes(id);
}

/**
 * The list with `id` appended, or the same list unchanged when it is already there.
 *
 * A no-op returns a **new** array, so a caller that always writes the result still writes the
 * same bytes (the no-op-edit rule: an untouched list produces no diff).
 */
export function addToList(values: readonly number[], id: number): number[] {
  return values.includes(id) ? values.slice() : [...values, id];
}

/**
 * The list without the element at `index`. Out-of-range indices return the list unchanged
 * (a UI index can move under a click, and a removal that cannot be expressed must not throw).
 *
 * Index-addressed on purpose — see the module header: 18 corpus files carry a duplicate value,
 * and a value-based removal would collapse them.
 */
export function removeAtIndex(values: readonly number[], index: number): number[] {
  if (!Number.isInteger(index) || index < 0 || index >= values.length) {
    return values.slice();
  }
  const copy = values.slice();
  copy.splice(index, 1);
  return copy;
}

/**
 * The list with the element at `from` moved to `to` (`to` is the destination **index in the
 * resulting array**, which is what dnd-kit and an up/down button both produce naturally).
 * Invalid or identical indices return the list unchanged.
 */
export function moveInList(values: readonly number[], from: number, to: number): number[] {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < 0 ||
    from >= values.length ||
    to >= values.length ||
    from === to
  ) {
    return values.slice();
  }
  const copy = values.slice();
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved as number);
  return copy;
}

/**
 * The edit that replaces the whole list — what the multi-select and the reorderable list both
 * write (the p4-02 precedent: membership and order are the editor's, so one `set` is one
 * unambiguous edit and the server's D5 merge takes the incoming array).
 *
 * The array is copied, so the rendered list a caller holds is never aliased into the document.
 */
export function replaceListEdit(path: DocPath, values: readonly number[]): DocEdit {
  return { op: 'set', path, value: values.slice() };
}

/**
 * The raw id a dropdown handed back, as the JSON number the document must store — or
 * `undefined` for `''`, `null`, a non-integer, a negative value, or anything beyond
 * `Number.MAX_SAFE_INTEGER` (`ULong.toJson`'s documented contract, the one conversion).
 */
export function numberIdFromRaw(raw: unknown): number | undefined {
  return ULong.toJson(raw);
}
