import { z } from 'zod';

import { RequirementListFieldSchema } from './requirements.js';
import { passthroughObject } from './schemaKit.js';
import { TYPE_STRINGS } from './typeConstants.js';

/**
 * Result types — [spec-domain-reference.md] L354-412, task 3.1.
 *
 * All 14 types measured in the corpus (461 result nodes), each with the field set the spec
 * documents. Every field is optional (the document may omit it, and the CLI output drops
 * every null-valued key before it reaches this tool — decision D48) and unknown keys pass
 * through (D5). `m_zoneName` is the one result field the corpus stores as an explicit
 * `null` (7×), so it is `.nullish()`.
 *
 * The list wrapper `m_startResults` / `m_endResults` (and every `m_tallyResults`) carries
 * **no `$type`** — measured 2,206/2,206 occurrences hold exactly one key, `m_results`
 * (772 `m_completeResults` + 772 `m_activateResults` + 322 `m_startResults` + 322
 * `m_endResults` + 18 `m_tallyResults`) — so
 * the wrapper accepts an absent `$type` and preserves any `$type` it does not know instead
 * of dropping it.
 */

/** `m_router` on `ResPlaySound` ([spec-domain-reference.md] L402). */
export const SoundRouterSchema = passthroughObject({
  m_locX: z.number().nullish(),
  m_locY: z.number().nullish(),
  m_locZ: z.number().nullish(),
  m_routingType: z.string().nullish(),
  m_useLocation: z.boolean().nullish(),
  m_useTriggerLocation: z.boolean().nullish(),
});

export const ResDropTableSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ResDropTable),
  m_tableName: z.string().nullish(),
  m_maxRolls: z.number().nullish(),
});

export const ResModifyEntrySchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ResModifyEntry),
  m_questName: z.string().nullish(),
  m_entryName: z.string().nullish(),
  m_isQuestRegistry: z.boolean().nullish(),
  m_value: z.number().nullish(),
});

export const ResAddDynaModSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ResAddDynaMod),
  m_dynaModClientTag: z.string().nullish(),
  m_dynaModRemove: z.boolean().nullish(),
  m_useQuestAsOriginator: z.boolean().nullish(),
  m_dynaModState: z.string().nullish(),
  // The only null-valued result field in the corpus (7 occurrences).
  m_zoneName: z.string().nullish(),
});

export const ResLearnSpellSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ResLearnSpell),
  m_templateID: z.number().nullish(),
  m_requirements: RequirementListFieldSchema,
});

export const ResPostEventSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ResPostEvent),
  m_eventName: z.string().nullish(),
});

/** No fields beyond `$type` ([spec-domain-reference.md] L378-379). */
export const ResAddHealthSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ResAddHealth),
});

/** No fields beyond `$type` ([spec-domain-reference.md] L381-382). */
export const ResAddManaSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ResAddMana),
});

export const ResAddSpellSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ResAddSpell),
  m_templateID: z.number().nullish(),
});

export const ResDespawnSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ResDespawn),
  m_spawnID: z.number().nullish(),
  m_despawnEffect: z.boolean().nullish(),
  m_templateID: z.number().nullish(),
});

export const ResDrawHandSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ResDrawHand),
  m_templateID: z.number().nullish(),
});

export const ResGiveSpellSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ResGiveSpell),
  m_templateID: z.number().nullish(),
  m_spellID: z.number().nullish(),
});

export const ResPlaySoundSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ResPlaySound),
  m_router: SoundRouterSchema.nullish(),
  m_soundName: z.string().nullish(),
  m_blocking: z.boolean().nullish(),
  m_reinteractTime: z.number().nullish(),
});

export const ResTeleportSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ResTeleport),
  m_destinationLoc: z.string().nullish(),
  m_destinationZone: z.string().nullish(),
  m_exitTeleporter: z.number().nullish(),
  m_teleporterTag: z.number().nullish(),
  // "string enum" per the spec; only `TELEPORT_STATIC` occurs (1 node), so the schema
  // accepts any string rather than inventing a closed enum from one sample.
  m_teleportType: z.string().nullish(),
  m_transitionID: z.number().nullish(),
});

export const ResWaitSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ResWait),
  m_secondsToWait: z.number().nullish(),
});

/** The 14-member result union, discriminated on the assembly-qualified `$type`. */
export const ResultTemplateSchema = z.discriminatedUnion('$type', [
  ResDropTableSchema,
  ResModifyEntrySchema,
  ResAddDynaModSchema,
  ResLearnSpellSchema,
  ResPostEventSchema,
  ResAddHealthSchema,
  ResAddManaSchema,
  ResAddSpellSchema,
  ResDespawnSchema,
  ResDrawHandSchema,
  ResGiveSpellSchema,
  ResPlaySoundSchema,
  ResTeleportSchema,
  ResWaitSchema,
]);

/** One result (`m_results[]` element). */
export type ResultTemplate = z.infer<typeof ResultTemplateSchema>;

/**
 * `ResultList` — the wrapper of `m_startResults`, `m_endResults`, every goal's
 * `m_completeResults` / `m_activateResults` and `TallyCounter.m_tallyResults`.
 *
 * `m_results` is optional so `{ "m_results": [] }` and `{}` both parse; absent stays absent.
 */
export const ResultListSchema = passthroughObject({
  m_results: z.array(ResultTemplateSchema).nullish(),
});

/** A parsed result list. */
export type ResultList = z.infer<typeof ResultListSchema>;

/**
 * `m_tallyCounter` — a goal field ([spec-domain-reference.md] L326/L330 says "object")
 * whose measured shape is `m_count, m_descriptor, m_descriptor2, m_percentChance,
 * m_tallyResults` (18 occurrences, all on Bounty/Scavenge goals that carry a tally), with
 * `m_tallyResults` itself a {@link ResultListSchema}. `null` in 754 of 772 goals.
 */
export const TallyCounterSchema = passthroughObject({
  m_count: z.number().nullish(),
  m_descriptor: z.string().nullish(),
  m_descriptor2: z.string().nullish(),
  m_percentChance: z.number().nullish(),
  m_tallyResults: ResultListSchema.nullish(),
});

/** A parsed tally counter. */
export type TallyCounter = z.infer<typeof TallyCounterSchema>;
