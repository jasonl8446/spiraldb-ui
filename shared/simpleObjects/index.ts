/**
 * The "one key + one list" editors of plan tasks 4.3–4.5 (story p4-03), 4.6 (story p4-04) and
 * 4.7 (story p4-05), extended by task 4.8 (story p4-06): `NpcInventory` (AC1),
 * `NpcSpellInventory` (AC2), `CreatureSpellbook` (AC3), `NpcDropTable`, `TreasureCardInventory`
 * and `WizardZoneData` (the `ZoneTransfer/` family).
 *
 * (Story ids corrected by story p4-06: several comments in this directory spelled NpcDropTable's
 * story as `p4-06`. It is **`p4-04`** — `docs/evidence/phase-4/p4-04.md` is titled "NpcDropTable
 * editor + directory bootstrap (task 4.6)". `p4-06` is task 4.8, this story. Evidence files
 * carry the story id, per D72(g)/D73, so the collision was worth naming rather than copying.)
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
 * | `./treasureCardInventory.js` | task 4.7: the `{TemplateID, TreasureCards[{SpellName, Price}]}` shape, **the object-list reader and its edit builders**, the `Price 0` hint as data, and the phase's first **warn-not-block** engine (the literal `spells.name` match), with the 1-file corpus facts and the `" TC"` suffix finding |
 * | `./zoneTransfer.js` | task 4.8 / story p4-06: the `{ZoneName, Teleports[{TriggerName, Teleport}]}` shape, **the first nested-object repeater's reader and edit builders**, the `m_destinationLoc` regex with its proven scientific-notation arm, the `m_teleportType` known-member/preserved-value decision, the `Events` drift guard and the raw-fields disclosure's data, with the 1,207-file corpus facts |
 * | `./globalRegistry.js` | task 4.9 / story p4-07: the `{GlobalRegistryValues: {key: value}}` wrapper, **the merge rule with an injected file order** (case-sensitive keys, later wins), the key→value **map** row model (key-addressed, not index-addressed), and the consolidation plan (which files one save replaces, D22), with the 1-file corpus facts and the `GlobalRegistryModels_1-A.json` legacy name |
 * | `./listValidation.js` | the final-review F3 rule: a **null/absent element** in a list field blocks a save (API-only — the editors cannot produce the shape), as typed findings plus the 400 field map the server answers with |
 *
 * Usage is the same on both halves of the app, like `shared/dropTable/index.ts`:
 *
 * ```ts
 * import { ZONE_TRANSFER_FIELDS, readTeleports } from '@shared/simpleObjects';
 * ```
 *
 * The server imports the compiled relative path (`shared/simpleObjects/index.js`) because its
 * tsconfig uses NodeNext; the client and the tests use the `@shared/*` alias.
 *
 * (Corrected by story p4-05: this header said "none of these families has a validation rule
 * beyond the schema … so there is no rules module". That is now false for exactly two — and they
 * are **opposite severities**, which is the point. `./treasureCardInventory.js` carries
 * `validateTreasureCardInventory`, a pure engine that emits warnings and **never** a blocking
 * finding (D73(a)); story p4-06's `./zoneTransfer.js` carries `validateZoneTransfer`, the AC1
 * `m_destinationLoc` **format** check, which emits `severity: 'error'` and **does** block
 * (L542-546) — safely, because it has zero corpus violations (2,365 of 2,365 values pass).
 * Neither module imports a `zod`: nothing here validates by schema. The other four modules remain
 * rule-free, and there is no zone-reference rule in either direction — 1,069 of 1,069 real
 * references resolve.)
 *
 * (Extended by final-review F3: `./listValidation.js` is a **fifth** rule module, and unlike the
 * two above it is not a per-family engine — it is the one presence rule all six families are
 * guarded by on the server, because a null list element is a shape only a direct POST can
 * produce. The four rule-free modules therefore stay rule-free for their own fields.)
 */

export * from './model.js';
export * from './npcInventory.js';
export * from './npcSpellInventory.js';
export * from './creatureSpellbook.js';
export * from './npcDropTable.js';
export * from './treasureCardInventory.js';
export * from './zoneTransfer.js';
export * from './globalRegistry.js';
export * from './listValidation.js';
