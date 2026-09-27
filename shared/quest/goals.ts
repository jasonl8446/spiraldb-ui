import { z } from 'zod';

import { ActorDialogListFieldSchema } from './dialog.js';
import { RequirementListFieldSchema } from './requirements.js';
import { ResultListSchema, TallyCounterSchema } from './results.js';
import { opaqueArray, opaqueObject, passthroughObject } from './schemaKit.js';
import { GOAL_TYPE_VALUES, TYPE_STRINGS } from './typeConstants.js';

/**
 * Goal types — [spec-domain-reference.md] L312-338, task 3.1.
 *
 * A 5-member union discriminated on the assembly-qualified `$type` (`Waypoint`, `Persona`,
 * `Bounty`, `Scavenge`, `AchieveRank`) over the 24 shared base fields (L336-338). Measured
 * across the corpus: 772 goal nodes, and **all 24 base fields present in every one of them**
 * (`m_goalUnderway`, `m_hyperlink`, `m_completeText`, `m_goalRequirements`, `m_behaviors`,
 * `m_tallyCounter` and `m_dialogList` carry explicit nulls where unused).
 *
 * Two measured gaps against the spec's prose worth knowing:
 *
 * - `m_tallyCounter`, `m_completeResults`, `m_activateResults` are documented as goal fields
 *   and are present on all 772 goals (the spec also calls `m_tallyCounter` a Bounty/Scavenge
 *   type-specific field — it lives in the base shape because every goal carries the key).
 * - Only **4** of the 47 Scavenge goals carry `m_itemAdjectives`/`m_itemTotal`, and only 5
 *   of the 100 Bounty goals carry `m_npcAdjectives`/`m_bountyType`; the other 95 Bounty goals
 *   carry only `m_bountyTotal`. Both are therefore optional here — requiring them would
 *   reject the corpus.
 *
 * `m_goalType` is a **separate axis** from `$type` and is deliberately *not* a closed parse
 * enum: the 7 measured values live in {@link GOAL_TYPE_VALUES} / {@link GoalTypeEnumSchema}
 * for the editor's select, but the document's field accepts any string so a quest from the
 * far larger live game (D52(i): the corpus is not the game's total) cannot be rejected by
 * this tool for carrying a goal type this repository has never seen. `$type` — the value
 * Imlight actually deserializes on — stays a strict literal.
 */

/** The 24 shared goal base fields ([spec-domain-reference.md] L336-338). */
const goalBaseShape = {
  m_goalName: z.string().nullish(),
  m_goalNameID: z.number().nullish(),
  m_goalTitle: z.string().nullish(),
  m_goalUnderway: z.string().nullish(),
  m_hyperlink: z.string().nullish(),
  m_completeText: z.string().nullish(),
  m_completeResults: ResultListSchema.nullish(),
  m_goalRequirements: RequirementListFieldSchema,
  m_tallyCounter: TallyCounterSchema.nullish(),
  m_locationName: z.string().nullish(),
  m_displayImage1: z.string().nullish(),
  m_displayImage2: z.string().nullish(),
  m_clientTags: z.array(z.string()).nullish(),
  m_genericEvents: opaqueArray.nullish(),
  m_autoQualify: z.boolean().nullish(),
  m_autoComplete: z.boolean().nullish(),
  m_destinationZone: z.string().nullish(),
  m_dialogList: ActorDialogListFieldSchema,
  m_goalType: z.string().nullish(),
  m_noQuestHelper: z.boolean().nullish(),
  m_petOnlyQuest: z.boolean().nullish(),
  m_activateResults: ResultListSchema.nullish(),
  m_hideGoalFloatyText: z.boolean().nullish(),
  m_behaviors: opaqueObject.nullish(),
};

/**
 * The closed 7-value goal-type enum, measured (see {@link GOAL_TYPE_VALUES}). Exported for
 * the goal editor's type select and for tests; the parsed field above stays open.
 */
export const GoalTypeEnumSchema = z.enum(GOAL_TYPE_VALUES);

export const WaypointGoalTemplateSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.WaypointGoalTemplate),
  ...goalBaseShape,
  m_zoneEntry: z.boolean().nullish(),
  m_zoneTag: z.string().nullish(),
  m_proximityTag: z.string().nullish(),
  m_zoneExit: z.boolean().nullish(),
});

export const PersonaGoalTemplateSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.PersonaGoalTemplate),
  ...goalBaseShape,
  m_personaName: z.string().nullish(),
  m_usePatron: z.boolean().nullish(),
});

export const BountyGoalTemplateSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.BountyGoalTemplate),
  ...goalBaseShape,
  m_npcAdjectives: z.array(z.string()).nullish(),
  m_bountyTotal: z.number().nullish(),
  m_bountyType: z.string().nullish(),
});

export const ScavengeGoalTemplateSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ScavengeGoalTemplate),
  ...goalBaseShape,
  m_itemAdjectives: z.array(z.string()).nullish(),
  m_itemTotal: z.number().nullish(),
});

export const AchieveRankGoalTemplateSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.AchieveRankGoalTemplate),
  ...goalBaseShape,
  m_rank: z.number().nullish(),
});

/**
 * The 5-goal discriminated union on `$type`.
 *
 * An unknown or missing `$type` is an `invalid_discriminator` failure — loud at the
 * boundary (the POST route answers 400), never a silent fall-through to some member.
 */
export const GoalTemplateSchema = z.discriminatedUnion('$type', [
  WaypointGoalTemplateSchema,
  PersonaGoalTemplateSchema,
  BountyGoalTemplateSchema,
  ScavengeGoalTemplateSchema,
  AchieveRankGoalTemplateSchema,
]);

/** One goal (`m_goals[]` element). */
export type GoalTemplate = z.infer<typeof GoalTemplateSchema>;

/** A parsed waypoint goal. */
export type WaypointGoalTemplate = z.infer<typeof WaypointGoalTemplateSchema>;
/** A parsed persona goal. */
export type PersonaGoalTemplate = z.infer<typeof PersonaGoalTemplateSchema>;
/** A parsed bounty goal. */
export type BountyGoalTemplate = z.infer<typeof BountyGoalTemplateSchema>;
/** A parsed scavenge goal. */
export type ScavengeGoalTemplate = z.infer<typeof ScavengeGoalTemplateSchema>;
/** A parsed achieve-rank goal. */
export type AchieveRankGoalTemplate = z.infer<typeof AchieveRankGoalTemplateSchema>;
