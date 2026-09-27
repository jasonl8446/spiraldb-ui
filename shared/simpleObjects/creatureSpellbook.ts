import type { SimpleFieldSpec } from './model.js';

/**
 * `CreatureSpellbook` — plan task 4.5 (story p4-03, AC3): docs/spec-domain-reference.md L27-42.
 *
 * ```json
 * { "DeckName": "Mdeck-L-BR-DS-SylviaDrake-A-50", "SpellTemplateIds": [409737272, 1321504283, 603728324] }
 * ```
 *
 * ## The measured corpus, 2026-09-27
 *
 * All **134** real `CreatureSpellbook/*.json` files were read:
 *
 * | fact | measured |
 * |---|---|
 * | files | 134 |
 * | documents whose keys are exactly `DeckName` + `SpellTemplateIds` | **134** (both, in that order, in all 134) |
 * | `SpellTemplateIds` values across the corpus | **1,267** |
 * | distinct values | **369** |
 * | files carrying an **empty** `SpellTemplateIds` | **9** |
 * | values that are not JSON numbers | **0** |
 * | distinct values resolving in `spells.template_id` (18,173 rows) | **368** — **1 miss** (`213674121`) |
 * | files with a duplicate value inside one list | **4** |
 * | distinct `DeckName` values (case-insensitively distinct too) | **134 / 134** |
 *
 * ## What the editor must not get wrong
 *
 * - **Order is the data.** `SpellTemplateIds` is a deck: the list is reorderable (AC3), and the
 *   order the user sees is the order written back — one whole-array replacement on every move
 *   (the p4-02 precedent), never an index-by-index rewrite.
 * - **The one miss stays raw.** `213674121` has no synced spell name; its row shows the raw id
 *   and the user can move or remove it (D60(c)/D63(c)).
 * - **The 9 empty arrays are real.** They render the empty state and a save writes `[]` — never
 *   `null`, never a dropped key (D57).
 * - **Exactly two keys.** The loaded document is the write payload (D5); the form renders these
 *   two controls and adds nothing (no audit quartet: `OBJECT_TYPES` records `audit: 'none'` for
 *   this family, D69(b)).
 */

/** The measured corpus facts, as data. */
export const CREATURE_SPELLBOOK_CORPUS = {
  /** `CreatureSpellbook/*.json` files measured. */
  files: 134,
  /** The exact top-level key set, in the corpus's own order. */
  topLevelKeys: ['DeckName', 'SpellTemplateIds'],
  /** `SpellTemplateIds` values across the corpus (all JSON numbers). */
  spellTemplateIds: 1267,
  /** Distinct `SpellTemplateIds` values. */
  distinctSpellIds: 369,
  /** Files carrying an empty `SpellTemplateIds` array — real, and preserved as `[]`. */
  emptyArrays: 9,
  /** Distinct values with no `spells` row (the one miss that must stay raw). */
  unresolvedIds: 1,
  /** The single measured miss, recorded by value so the test names it. */
  unresolvedIdValue: 213674121,
  /** Distinct values that DO resolve in `spells`. */
  resolvableIds: 368,
  /** Files carrying a duplicate value inside their list (index-addressed removal). */
  filesWithDuplicateIds: 4,
  /** Distinct `DeckName` values (134 of 134 files). */
  distinctKeys: 134,
} as const;

/** The document key holding the reorderable list. */
export const CREATURE_SPELLBOOK_LIST_KEY = 'SpellTemplateIds';

/** The document key holding the family's key field. */
export const CREATURE_SPELLBOOK_KEY_FIELD = 'DeckName';

/** The two fields, in corpus order. */
export const CREATURE_SPELLBOOK_FIELDS: readonly SimpleFieldSpec[] = [
  {
    key: CREATURE_SPELLBOOK_KEY_FIELD,
    label: 'Deck name',
    kind: 'text',
    required: true,
    corpusPresence: 134,
    help: 'The key of this file (looked up case-insensitively). All 134 corpus names are unique.',
  },
  {
    key: CREATURE_SPELLBOOK_LIST_KEY,
    label: 'Spells',
    kind: 'spell-order-list',
    namesType: 'spells',
    required: true,
    corpusPresence: 134,
    help: 'Deck order matters: the list is reorderable. 1 of the corpus\u2019s 369 distinct ids has no synced name and shows as a raw id.',
  },
];
