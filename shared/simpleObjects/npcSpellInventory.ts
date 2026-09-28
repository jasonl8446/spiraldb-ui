import type { DocEdit, DocPath } from '../document.js';
import { numberIdFromRaw, type SimpleFieldSpec } from './model.js';

/**
 * `NpcSpellInventory` — plan task 4.4 (story p4-03, AC2): docs/spec-domain-reference.md
 * L138-164, including the `NPCSpellEntry` table.
 *
 * ```json
 * {
 *   "TemplateID": 1452231,
 *   "Spells": [
 *     { "TemplateID": 84361, "RequiredSpellID": 0, "Level": 1 },
 *     { "TemplateID": 2106466410, "RequiredSpellID": 84361, "Level": 5 }
 *   ]
 * }
 * ```
 *
 * ## The measured corpus, 2026-09-27
 *
 * All **77** real `NpcSpellInventory/*.json` files were read:
 *
 * | fact | measured |
 * |---|---|
 * | files | 77 |
 * | documents whose keys are exactly `TemplateID` + `Spells` | **77** (both, in that order, in all 77) |
 * | `Spells` entries across the corpus | **560** |
 * | entries whose keys are exactly `TemplateID` + `RequiredSpellID` + `Level` | **560 / 560** (one order only) |
 * | entries whose three values are all JSON numbers | **560 / 560** |
 * | entries with `RequiredSpellID === 0` — the "none" case | **239 (43%)** |
 * | `Level` range / distinct values | **0 – 420** / 52 |
 * | files with a duplicate `TemplateID` among their entries | **1** |
 * | distinct referenced spell ids (`TemplateID`, plus non-zero `RequiredSpellID`) | 506, **0 missing** from `spells` |
 * | distinct top-level `TemplateID` / missing from `npcs` | 77 / **1** |
 *
 * ## The three traps these numbers create
 *
 * 1. **`RequiredSpellID: 0` means "no prerequisite", not "look up spell 0"** (the D64(f)
 *    sentinel-0 class). It is 43% of real entries, it is labelled **`none (0)`** as the AC
 *    requires, and the stored value stays `0`. {@link requiredSpellIsNone} is what makes the
 *    control stop before a `GET /api/names/spells/0` — the route would 404 for a value that is
 *    not a spell in the first place.
 * 2. **`Level: 0` is valid** (34 entries have it). The control has no `min` at all: the spec
 *    prints no bound, and a `min={1}` would make real content unsaveable (D57 — validate, never
 *    normalise; this family has no validator to catch a rewritten value either).
 * 3. **The entry shape is unanimous, so emptying a required number must not delete its key.**
 *    {@link spellEntryLevelEdit} writes `0` for an empty Level box where the top-level scalar
 *    rule (D59(c)) would delete the key: `Level` is one of three required keys in a
 *    fixed-shape record (560/560), and `0` is a measured valid level.
 *
 * ## A new entry is picked, not invented
 *
 * The corpus has **no** entry with `TemplateID === 0`, so the repeater does not create one: the
 * "Add spell" control is a spell dropdown and appends a row only once the user picks a real
 * spell, at which point the row carries the corpus's own shape and order with
 * `RequiredSpellID: 0` (the dominant real value, 239/560) and `Level: 1` (the domain
 * reference's own example value). Nothing writes a placeholder id, and no lookup for `0` is
 * ever issued.
 */

/** The measured corpus facts, as data. */
export const NPC_SPELL_INVENTORY_CORPUS = {
  /** `NpcSpellInventory/*.json` files measured. */
  files: 77,
  /** The exact top-level key set, in the corpus's own order. */
  topLevelKeys: ['TemplateID', 'Spells'],
  /** `Spells` entries across the corpus. */
  spellEntries: 560,
  /** Entries whose `RequiredSpellID` is `0` (the "none" sentinel, 43% of entries). */
  entriesWithRequiredSpellZero: 239,
  /** The lowest measured `Level` — `0`, which is why the control has no `min`. */
  levelMin: 0,
  /** The highest measured `Level`. */
  levelMax: 420,
  /** Distinct measured `Level` values. */
  distinctLevels: 52,
  /** Distinct spell ids referenced by an entry (`TemplateID` or a non-zero `RequiredSpellID`). */
  distinctSpellIds: 506,
  /** Referenced spell ids with no `spells` row (0 — every referenced spell resolves). */
  unresolvedSpellIds: 0,
  /** Distinct top-level `TemplateID` values. */
  distinctKeys: 77,
  /** Distinct top-level `TemplateID` values with no `npcs` row. */
  unresolvedKeys: 1,
  /** Files with a duplicate `TemplateID` among their entries (index-addressed removal). */
  filesWithDuplicateEntries: 1,
} as const;

/** The document key holding the repeater. */
export const NPC_SPELL_INVENTORY_LIST_KEY = 'Spells';
/** The document key holding the family's key field. */
export const NPC_SPELL_INVENTORY_KEY_FIELD = 'TemplateID';

/** The entry's three keys, in the corpus's single measured order (560/560). */
export const NPC_SPELL_ENTRY_KEYS = ['TemplateID', 'RequiredSpellID', 'Level'] as const;

/** The sentinel that means "no prerequisite spell" (`0`, 239 of 560 real entries). */
export const NONE_REQUIRED_SPELL = 0;

/** The label the AC requires for that sentinel — the option text and the trigger alike. */
export const NONE_REQUIRED_SPELL_LABEL = 'none (0)';

/** The `Level` a newly added entry starts from — the domain reference's own example value. */
export const NEW_SPELL_ENTRY_LEVEL = 1;

/** One entry field's spec: a {@link SimpleFieldSpec} plus the `none (0)` option's own data. */
export interface SpellEntryFieldSpec extends SimpleFieldSpec {
  /** The `0` option's label, on the one control that has it (`RequiredSpellID`). */
  readonly noneOption?: string;
  /** The sentinel that option stores (`0`). */
  readonly noneValue?: number;
}

/**
 * The three entry fields, in corpus order. `corpusPresence` is per **entry** (560) rather than
 * per file here, because the only record the numbers describe is the entry.
 */
export const NPC_SPELL_ENTRY_FIELDS: readonly SpellEntryFieldSpec[] = [
  {
    key: 'TemplateID',
    label: 'Spell',
    kind: 'spell-select',
    namesType: 'spells',
    required: true,
    corpusPresence: 560,
  },
  {
    key: 'RequiredSpellID',
    label: 'Required spell',
    kind: 'spell-select-none',
    namesType: 'spells',
    required: true,
    corpusPresence: 560,
    noneOption: NONE_REQUIRED_SPELL_LABEL,
    noneValue: NONE_REQUIRED_SPELL,
    help: 'No prerequisite. 239 of the corpus\u2019s 560 entries store 0 here — it is "none", not a spell to look up.',
  },
  {
    key: 'Level',
    label: 'Level',
    kind: 'text',
    required: true,
    corpusPresence: 560,
    help: 'Minimum wizard level. 0 is a real value in this corpus (34 entries); the measured range is 0\u2013420.',
  },
];

/** The document's two fields, in corpus order. */
export const NPC_SPELL_INVENTORY_FIELDS: readonly SimpleFieldSpec[] = [
  {
    key: NPC_SPELL_INVENTORY_KEY_FIELD,
    label: 'NPC',
    kind: 'npc-select',
    namesType: 'npcs',
    required: true,
    corpusPresence: 77,
    help: 'The key of this file: the trainer NPC actor template id.',
  },
  {
    key: NPC_SPELL_INVENTORY_LIST_KEY,
    label: 'Spells',
    kind: 'spell-entry-list',
    required: true,
    corpusPresence: 77,
    help: 'Spells this trainer offers. Each entry is a spell, an optional prerequisite (none (0)), and a minimum level.',
  },
];

/** One entry's field path: `['Spells', 2, 'Level']`. */
export function spellEntryFieldPath(index: number, key: string): DocPath {
  return [NPC_SPELL_INVENTORY_LIST_KEY, index, key];
}

/** The repeater array's path: `['Spells']`. */
export function spellEntryListPath(): DocPath {
  return [NPC_SPELL_INVENTORY_LIST_KEY];
}

/**
 * A new entry for `templateId`, in the corpus's exact key order (560/560) — `RequiredSpellID`
 * is the dominant real value `0` and `Level` is the domain reference's example value.
 *
 * There is deliberately **no** zero-argument form: the corpus never carries `TemplateID: 0`, so
 * a row cannot exist without a real spell (see the module header).
 */
export function newSpellEntry(templateId: number): Record<string, unknown> {
  return {
    TemplateID: templateId,
    RequiredSpellID: NONE_REQUIRED_SPELL,
    Level: NEW_SPELL_ENTRY_LEVEL,
  };
}

/** One row of the repeater: the entry object and the index every edit path needs. */
export interface SpellEntryView {
  readonly index: number;
  readonly entry: Record<string, unknown>;
}

/**
 * The `Spells` array as renderable rows, in document order.
 *
 * `[]` for a key that is absent, `null` or not an array — the three "no list here" shapes a form
 * renders as its empty state, which is also what an **empty array** renders. An element that is
 * not a plain object is skipped for the same measured-impossible reason
 * `readNumberList` documents: 560 of 560 entries are objects, and a row cannot be built from
 * anything else. The index each row carries is its **position in the document array**, so an
 * edit addresses the element the user sees.
 */
export function readSpellEntries(document: Record<string, unknown>): SpellEntryView[] {
  const raw = document[NPC_SPELL_INVENTORY_LIST_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }
  const rows: SpellEntryView[] = [];
  raw.forEach((entry, index) => {
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      rows.push({ index, entry: entry as Record<string, unknown> });
    }
  });
  return rows;
}

/**
 * The edit that appends an entry for `templateId`. `Spells` is always present in the corpus
 * (77/77), but the edit is still keyed on presence: an `insert` into a key that does not exist
 * would throw (`shared/document.ts` never invents structure), so a document without the key
 * takes one `set` of a one-element array — exactly p3-05's `m_goalLogic` rule.
 */
export function addSpellEntryEdit(
  hasSpells: boolean,
  currentLength: number,
  templateId: number,
): DocEdit {
  const entry = newSpellEntry(templateId);
  if (!hasSpells) {
    return { op: 'set', path: spellEntryListPath(), value: [entry] };
  }
  return { op: 'insert', path: spellEntryListPath(), index: currentLength, value: entry };
}

/**
 * The edit that removes the entry at `index`. The path is the **element**, not one of its
 * fields: `deleteAtPath` on an array index splices (so later rows shift up), while deleting
 * `['Spells', i, 'TemplateID']` would leave a two-key entry behind.
 */
export function removeSpellEntryEdit(index: number): DocEdit {
  return { op: 'delete', path: [NPC_SPELL_INVENTORY_LIST_KEY, index] };
}

/**
 * The edit a row's `Level` box produces: a finite number written verbatim, `0` for an emptied
 * box — never a deleted key, because the three-key entry shape is unanimous (560/560) and `0`
 * is a measured valid level (34 entries). See the module header's trap 3.
 */
export function spellEntryLevelEdit(index: number, raw: string): DocEdit | null {
  if (raw.trim() === '') {
    return { op: 'set', path: spellEntryFieldPath(index, 'Level'), value: 0 };
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  return { op: 'set', path: spellEntryFieldPath(index, 'Level'), value };
}

/**
 * The edit a `RequiredSpellID` dropdown produces: `''` (the `none (0)` option) stores the
 * sentinel `0`, anything else goes through the one raw-id conversion. An unparsable id is a
 * no-op rather than a key deletion — the key is required and its shape is unanimous.
 */
export function requiredSpellEdit(index: number, rawId: string): DocEdit | null {
  if (rawId === '') {
    return {
      op: 'set',
      path: spellEntryFieldPath(index, 'RequiredSpellID'),
      value: NONE_REQUIRED_SPELL,
    };
  }
  const value = numberIdFromRaw(rawId);
  if (value === undefined) {
    return null;
  }
  return { op: 'set', path: spellEntryFieldPath(index, 'RequiredSpellID'), value };
}

/**
 * `true` when `RequiredSpellID` means "no prerequisite" — the stored `0`, or the absent/`null`
 * of a document that does not carry the entry's key at all. This is the predicate the control
 * uses to decide it has **nothing to look up**: under it, `FriendlyNameDropdown` receives
 * `null` and issues no request, which is what stops the `GET /api/names/spells/0` the AC's
 * failure-mode list names.
 */
export function requiredSpellIsNone(value: unknown): boolean {
  return value === undefined || value === null || value === NONE_REQUIRED_SPELL;
}
