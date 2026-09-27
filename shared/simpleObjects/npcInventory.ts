import type { SimpleFieldSpec } from './model.js';

/**
 * `NpcInventory` — plan task 4.3 (story p4-03, AC1): docs/spec-domain-reference.md L121-136.
 *
 * ```json
 * { "TemplateID": 87112, "Inventory": [126913, 126914, 126915, 77614, 87237, 4873] }
 * ```
 *
 * ## The measured corpus, 2026-09-27 — the numbers this module encodes
 *
 * All **215** real `NpcInventory/*.json` files of `/home/jason/Documents/git-projects/spiraldb`
 * were read (`tests/unit/simple-objects-model.test.ts` re-runs the same sweep whenever the
 * checkout and the synced database are on disk):
 *
 * | fact | measured |
 * |---|---|
 * | files | 215 |
 * | documents whose keys are exactly `TemplateID` + `Inventory` | **215** (both, in that order, in all 215) |
 * | `Inventory` values across the corpus | **3,785** |
 * | distinct `Inventory` values | **3,205** |
 * | files carrying an **empty** `Inventory` | **1** |
 * | values that are not JSON numbers | **0** |
 * | distinct values resolving in `items.gid` (79,835 rows) | **3,163** — **42 miss** |
 * | files with a duplicate value inside one list | **14** |
 * | distinct `TemplateID` values / missing from `npcs` (23,033 rows) | 215 / **4** |
 *
 * ## What the editor must not get wrong (the AC's own failure modes)
 *
 * - **The 42 misses stay raw.** No name is invented for them (D60(c)/D63(c)): a chip for an
 *   unresolved id shows the id itself and the user can remove or keep it. The dropdown's single
 *   -id fallback request 404s for such an id, which is the same documented lookup D70(e)
 *   records for the DropTable's 8 misses.
 * - **The empty array is real.** The one file with `[]` renders the empty state and a save
 *   writes `[]` — never `null`, never a dropped key (D57).
 * - **No key is added or removed.** The document has exactly two keys, so the form renders
 *   exactly those two controls and the loaded document is the write payload (D5).
 */

/** The measured corpus facts, as data — one home for every number above. */
export const NPC_INVENTORY_CORPUS = {
  /** `NpcInventory/*.json` files measured. */
  files: 215,
  /** The exact top-level key set, in the corpus's own order. */
  topLevelKeys: ['TemplateID', 'Inventory'],
  /** `Inventory` values across the corpus (all JSON numbers). */
  inventoryValues: 3785,
  /** Distinct `Inventory` values. */
  distinctInventoryIds: 3205,
  /** Files carrying an empty `Inventory` array — real, and preserved as `[]`. */
  emptyArrays: 1,
  /** Distinct values with no `items.gid` row (the 42 misses that must stay raw). */
  unresolvedIds: 42,
  /** Distinct values that DO resolve in `items.gid`. */
  resolvableIds: 3163,
  /** Files carrying a duplicate value inside their one list (index-addressed removal). */
  filesWithDuplicateIds: 14,
  /** Distinct `TemplateID` values. */
  distinctKeys: 215,
  /** Distinct `TemplateID` values with no `npcs` row (the key dropdown's own misses). */
  unresolvedKeys: 4,
} as const;

/** The document key holding the list — the one place the form and the tests read it from. */
export const NPC_INVENTORY_LIST_KEY = 'Inventory';

/** The document key holding the family's key field. */
export const NPC_INVENTORY_KEY_FIELD = 'TemplateID';

/**
 * The two fields, in corpus order. The `Inventory` help line names the measured miss count
 * because that is what a user seeing a bare id needs to know (it is the honest label, not a
 * defect) — and it is the only help either control needs.
 */
export const NPC_INVENTORY_FIELDS: readonly SimpleFieldSpec[] = [
  {
    key: NPC_INVENTORY_KEY_FIELD,
    label: 'NPC',
    kind: 'npc-select',
    namesType: 'npcs',
    required: true,
    corpusPresence: 215,
    help: 'The key of this file: the NPC actor template id.',
  },
  {
    key: NPC_INVENTORY_LIST_KEY,
    label: 'Inventory',
    kind: 'item-multi-select',
    namesType: 'items',
    required: true,
    corpusPresence: 215,
    help: 'Item GIDs this vendor offers. 42 of the corpus\u2019s 3,205 distinct ids have no synced name and show as raw ids.',
  },
];
