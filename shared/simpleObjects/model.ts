import { ULong } from '../ulong.js';
import type { DocEdit, DocPath } from '../document.js';

/**
 * The shared vocabulary of the "one key + one list" families — plan tasks 4.3/4.4/4.5 (story
 * p4-03) and 4.6 (story p4-06, NpcDropTable).
 *
 * Two things live here rather than in a per-type module, because every family that uses them
 * needs them and a second copy would be the divergence §4's risk table names:
 *
 * 1. **`SimpleFieldSpec`** — the field inventory as *data* (D59(b)'s rule: a form does not
 *    restate what a module can state). These families have no validation rules at all (the spec
 *    fixes none beyond the schema), so the inventory is small: a key, a label, the control kind,
 *    the names table it searches, and how many of the measured corpus files carry it.
 * 2. **The list primitives** — every edit these families make is "replace this array whole",
 *    "append this id", "remove the id at this index", or "move this element". `shared/document.ts`
 *    is the mutation contract (D58); these are the list-shaped builders on top of it, so no form
 *    invents its own `splice`.
 *
 * ## Two value kinds: a **numeric** list and a **text** list
 *
 * `Inventory` / `Spells` / `SpellTemplateIds` are JSON numbers; NpcDropTable's `DropTableNames`
 * is a **list of DropTable names** (`["WC-UNICORN-MAIN-007", "WC-UNICORN-BONUS-001"]`,
 * docs/spec-domain-reference.md L166-181) — the names table keyed on text
 * (`drop_tables.idColumn = 'name'`, `idKind: 'text'`), so the two lists differ in the *value*
 * and in nothing else. The primitives below are therefore **generic over the element type**
 * (`addToList<T>`, `removeAtIndex<T>`, `moveInList<T>`, `replaceListEdit<T>`) rather than
 * duplicated per kind, and the two readers are one implementation with two predicates
 * ({@link readNumberList} / {@link readStringList}). One multi-select
 * (`client/src/components/objects/ObjectIdMultiSelect.tsx`) carries the kind the same way —
 * D71(i) forbids a second chips implementation, and a Phase-4 sibling family (4.7's
 * TreasureCardInventory) is numeric again, so the kind must be a parameter and not a fork.
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
 * ## All three numeric families store JSON numbers
 *
 * Unlike the DropTable's `ItemId` (a JSON string in 72 of 72 rows, D70(e)), every value inside
 * the three numeric families is a JSON **number** (measured: 3,785 + 560×3 + 1,267 values, 0 of
 * them strings). The string↔number trap therefore does not appear *inside* a document — but it
 * does appear at the **control boundary**: `FriendlyNameDropdown` hands back the raw id as a
 * string (`onChange: (rawId: string) => void`) and the names API's `NameOption.id` is a string.
 * {@link numberIdFromRaw} is the one conversion, delegating to `ULong.toJson` (the shared helper
 * `shared/ulong.ts` already owns), so no call site writes `Number(x)`.
 *
 * For a **text**-keyed list the control boundary needs the mirror image: the option's id is
 * already the value, so nothing is converted — but a blank string is not a name any document can
 * reference, and {@link textIdFromRaw} is the one place that says so.
 */

/** The names tables these families search. A subset of `lib/display.ts`'s `NamesType`. */
export type SimpleNamesType = 'npcs' | 'items' | 'spells' | 'drop_tables';

/**
 * The value kind of one of these lists: a JSON **number** (`Inventory`, `Spells`,
 * `SpellTemplateIds`) or a **string** (`NpcDropTable.DropTableNames`).
 *
 * It is a parameter of the shared multi-select rather than a reason to fork it (D71(i)), so the
 * vocabulary lives here — next to the two readers and the two raw-id conversions that are the
 * kind's real consequences.
 */
export type SimpleListIdKind = 'number' | 'text';

/** How a field renders — the whole vocabulary these families use. */
export type SimpleFieldKind =
  /** `FriendlyNameDropdown` over `npcs` (a `TemplateID` key). */
  | 'npc-select'
  /** `FriendlyNameDropdown` over `spells`. */
  | 'spell-select'
  /** A spell select whose `0` is the explicit `none (0)` option (`NPCSpellEntry.RequiredSpellID`). */
  | 'spell-select-none'
  /** The searchable multi-select over `items` names, rendered as removable chips. */
  | 'item-multi-select'
  /** The searchable multi-select over **`drop_tables` names** (`NpcDropTable.DropTableNames`). */
  | 'drop-table-multi-select'
  /** The spell-entry repeater (`NPCSpellEntry[]`). */
  | 'spell-entry-list'
  /** The reorderable spell list (`SpellTemplateIds`). */
  | 'spell-order-list'
  /** A plain text control (`DeckName`). */
  | 'text';

/** One field of one of these documents, as data. */
export interface SimpleFieldSpec {
  /** The document key, verbatim. */
  readonly key: string;
  /** The control's visible label. */
  readonly label: string;
  readonly kind: SimpleFieldKind;
  /** Which names table the control searches (absent for `text`). */
  readonly namesType?: SimpleNamesType;
  /**
   * `true` for every field of every family: each schema marks both of its fields `yes`, and the
   * measured corpus is unanimous where a corpus exists (215/215, 77/77, 134/134; NpcDropTable has
   * **0** files — its two keys are the schema's, docs/spec-domain-reference.md L166-181).
   * Recorded as a literal so a future optional field has to change this type, not sneak in.
   */
  readonly required: true;
  /**
   * Files of the measured corpus carrying the key — `0` for a family whose directory does not
   * exist yet (NpcDropTable). The denominator is the family's own constant.
   */
  readonly corpusPresence: number;
  /** One line of help under the control, where the measured reality needs saying. */
  readonly help?: string;
}

/** `true` when a value is a finite JSON number — the only kind a numeric list may contain. */
function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** `true` when a value is a JSON string — the only kind a text list may contain. */
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/** The array at `key`, filtered to the values `keep` accepts, in document order. */
function readList<T>(
  document: Record<string, unknown>,
  key: string,
  keep: (value: unknown) => value is T,
): T[] {
  const raw = document[key];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(keep);
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
  return readList(document, key, isNumber);
}

/**
 * The array at `key` as strings, in document order — the text-list reader of the same shape
 * (`NpcDropTable.DropTableNames`, docs/spec-domain-reference.md L166-181).
 *
 * `[]` for a key that is absent, `null`, or not an array. A non-string value is dropped for the
 * same reason a non-number is: it cannot be rendered as a chip, and the edit replaces the array
 * whole. **An empty string is kept**, not dropped — it is a string, and dropping it would delete
 * a value the file really carries (D57: validate and never normalise; the reader's refusal of a
 * non-string is about renderability, not tidiness). Measured 2026-09-27: the family has **0**
 * corpus files (`NpcDropTable/` does not exist), so no shape here is corpus-derived — the schema
 * is (`string[]`), and the live sweep in `tests/unit/npc-drop-table-model.test.ts` re-measures
 * the absence rather than pretending to a count.
 */
export function readStringList(document: Record<string, unknown>, key: string): string[] {
  return readList(document, key, isString);
}

/** `true` when `id` already appears in the list (the picker's duplicate guard). */
export function containsId<T>(values: readonly T[], id: T): boolean {
  return values.includes(id);
}

/**
 * The list with `id` appended, or the same list unchanged when it is already there.
 *
 * A no-op returns a **new** array, so a caller that always writes the result still writes the
 * same bytes (the no-op-edit rule: an untouched list produces no diff).
 */
export function addToList<T>(values: readonly T[], id: T): T[] {
  return values.includes(id) ? values.slice() : [...values, id];
}

/**
 * The list without the element at `index`. Out-of-range indices return the list unchanged
 * (a UI index can move under a click, and a removal that cannot be expressed must not throw).
 *
 * Index-addressed on purpose — see the module header: 18 numeric-corpus files carry a duplicate
 * value, and a value-based removal would collapse them. The same rule applies to a **text** list
 * for a reason that needs no measurement: a value-based "remove the third chip" is not even
 * expressible, and `DropTableNames` may legitimately repeat a name (the schema is `string[]`,
 * docs/spec-domain-reference.md L178).
 */
export function removeAtIndex<T>(values: readonly T[], index: number): T[] {
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
export function moveInList<T>(values: readonly T[], from: number, to: number): T[] {
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
  copy.splice(to, 0, moved as T);
  return copy;
}

/**
 * The edit that replaces the whole list — what the multi-select and the reorderable list both
 * write (the p4-02 precedent: membership and order are the editor's, so one `set` is one
 * unambiguous edit and the server's D5 merge takes the incoming array).
 *
 * The array is copied, so the rendered list a caller holds is never aliased into the document.
 */
export function replaceListEdit<T>(path: DocPath, values: readonly T[]): DocEdit {
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

/**
 * The raw value a dropdown handed back for a **text**-keyed list, as the string the document must
 * store — or `undefined` for anything that is not a non-blank string.
 *
 * Verbatim: no `trim`, no case folding, no unicode normalisation (the reader's rule above, D57's
 * "validate, never normalise"). A name is the document's own value, so the only thing this
 * function refuses is a value no document can reference — `''` and `'   '`, which are not names,
 * and a non-string. `' WC-A '` is *kept* exactly as given: it is a (probably wrong) name the user
 * typed, and silently rewriting it would be the editor inventing a value.
 */
export function textIdFromRaw(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return undefined;
  }
  return raw;
}
