/**
 * The "one key + one list" editors of plan tasks 4.3–4.5 (story p4-03), 4.6 (story p4-06) and
 * 4.7 (story p4-05): `NpcInventory` (AC1), `NpcSpellInventory` (AC2), `CreatureSpellbook`
 * (AC3), `NpcDropTable` and `TreasureCardInventory`.
 *
 * The files live in `shared/` for the reason D62(f) gives for `RequirementTreeEditor`: the
 * field inventory is data the **form** renders and the **tests** pin against the measured
 * corpus, and a fact stated in two places drifts in one of them. Nothing here imports React,
 * the client tree or the server tree, so both halves can read it.
 *
 * | module | contents |
 * |---|---|
 * | `./model.js` | the shared vocabulary: `SimpleFieldSpec`, and the list primitives every family edits through (`replaceListEdit`, `addToList`, `removeAtIndex`, `moveInList`, `readNumberList`/`readStringList`, `numberIdFromRaw`/`textIdFromRaw`) |
 * | `./npcInventory.js` | AC1: the document shape, the two fields, the 215-file corpus facts |
 * | `./npcSpellInventory.js` | AC2: the shape, the `NPCSpellEntry` field table incl. the `none (0)` option, the entry edit builders, the 77-file corpus facts |
 * | `./creatureSpellbook.js` | AC3: the shape, the two fields, the 134-file corpus facts |
 * | `./npcDropTable.js` | task 4.6: the shape, the two fields, the 0-file corpus facts and the 317-name source |
 * | `./treasureCardInventory.js` | task 4.7: the `{TemplateID, TreasureCards[{SpellName, Price}]}` shape, **the object-list reader and its edit builders**, the `Price 0` hint as data, and the one **warn-not-block** rule of the phase (the literal `spells.name` match), with the 1-file corpus facts and the `" TC"` suffix finding |
 *
 * Usage is the same on both halves of the app, like `shared/dropTable/index.ts`:
 *
 * ```ts
 * import { TREASURE_CARD_INVENTORY_FIELDS, readTreasureCards } from '@shared/simpleObjects';
 * ```
 *
 * The server imports the compiled relative path (`shared/simpleObjects/index.js`) because its
 * tsconfig uses NodeNext; the client and the tests use the `@shared/*` alias.
 *
 * (Corrected by story p4-05: this header said "none of these families has a validation rule
 * beyond the schema … so there is no rules module". That is now false for exactly one rule —
 * `./treasureCardInventory.js` carries `validateTreasureCardInventory`, a pure engine that
 * emits warnings and never a blocking finding, per docs/spec-domain-reference.md L542-546.
 * It still imports no `zod`: nothing here validates by schema, and a warning needs no
 * dependency. The other five modules remain rule-free.)
 */

export * from './model.js';
export * from './npcInventory.js';
export * from './npcSpellInventory.js';
export * from './creatureSpellbook.js';
export * from './npcDropTable.js';
export * from './treasureCardInventory.js';
