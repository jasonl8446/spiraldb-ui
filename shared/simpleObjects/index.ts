/**
 * The three "one key + one list" editors of plan tasks 4.3–4.5 (story p4-03):
 * `NpcInventory` (AC1), `NpcSpellInventory` (AC2) and `CreatureSpellbook` (AC3).
 *
 * The files live in `shared/` for the reason D62(f) gives for `RequirementTreeEditor`: the
 * field inventory is data the **form** renders and the **tests** pin against the measured
 * corpus, and a fact stated in two places drifts in one of them. Nothing here imports React,
 * the client tree or the server tree, so both halves can read it.
 *
 * | module | contents |
 * |---|---|
 * | `./model.js` | the shared vocabulary: `SimpleFieldSpec`, and the list primitives every one of the three edits through (`replaceListEdit`, `addToList`, `removeAtIndex`, `moveInList`, `numberIdFromRaw`) |
 * | `./npcInventory.js` | AC1: the document shape, the two fields, the 215-file corpus facts |
 * | `./npcSpellInventory.js` | AC2: the shape, the `NPCSpellEntry` field table incl. the `none (0)` option, the entry edit builders, the 77-file corpus facts |
 * | `./creatureSpellbook.js` | AC3: the shape, the two fields, the 134-file corpus facts |
 *
 * Usage is the same on both halves of the app, like `shared/dropTable/index.ts`:
 *
 * ```ts
 * import { NPC_INVENTORY_FIELDS, replaceListEdit } from '@shared/simpleObjects';
 * ```
 *
 * The server imports the compiled relative path (`shared/simpleObjects/index.js`) because its
 * tsconfig uses NodeNext; the client and the tests use the `@shared/*` alias. Nothing here
 * imports `zod`: none of the three families has a validation rule beyond the schema
 * (docs/spec-domain-reference.md fixes none), so there is no rules module to go with them.
 */

export * from './model.js';
export * from './npcInventory.js';
export * from './npcSpellInventory.js';
export * from './creatureSpellbook.js';
