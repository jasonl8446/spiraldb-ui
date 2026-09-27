import { z } from 'zod';

import { ActorDialogListFieldSchema } from './dialog.js';
import { GoalTemplateSchema } from './goals.js';
import { RequirementListFieldSchema } from './requirements.js';
import { ResultListSchema } from './results.js';
import { opaqueObject, passthroughObject } from './schemaKit.js';

/**
 * `QuestTemplate` — [spec-domain-reference.md] L210-279, task 3.1.
 *
 * The 36 documented top-level fields. Measured corpus reality (322 files):
 *
 * - **No top-level `$type`** — 322/322 quest files carry none, and this schema declares
 *   none. (The object is not part of the polymorphic graph: Imlight loads it by file type,
 *   not by `$type` annotation.) A `$type` that somehow appears passes through untouched
 *   rather than being added or removed.
 * - All 36 keys are present in 320/322 files; the optionality the spec marks with `?` is
 *   expressed as **explicit `null`** (e.g. `m_questInfo`, `m_behaviors`, `m_missionDoors`,
 *   `m_clientTags` all `null` in 320 files), never as an absent key. The other 2 files are
 *   ones *this tool* wrote from a reader's null-stripped output (18 keys, nulls omitted).
 *   Both shapes therefore have to parse, and neither may be normalised: `.nullish()` accepts
 *   absent and `null`, and Zod injects neither — an absent key stays absent, a `null` stays
 *   `null` (see `tests/unit/quest-schemas.test.ts`, which asserts both directions).
 * - `m_requirements` is `null` in 8 files and an object in 314; `m_prepRequirements` /
 *   `m_pruneRequirements` are `null` in all 322.
 *
 * Every field except `m_questName` is optional, so a minimal `{m_questName}` document — what
 * the extraction review view and the existing POST tests send — validates.
 */

/**
 * One quest-progression rule ([spec-domain-reference.md] L340-351). Measured: exactly
 * `m_goalsAND, m_goalsOR, m_goalsToAdd, m_completeQuest, m_requiredORCount` in all 742
 * corpus entries, and **no `$type`** — a `GoalLogicEntry` is not polymorphic.
 */
export const GoalLogicEntrySchema = passthroughObject({
  m_goalsAND: z.array(z.string()).nullish(),
  m_goalsOR: z.array(z.string()).nullish(),
  m_goalsToAdd: z.array(z.string()).nullish(),
  m_completeQuest: z.boolean().nullish(),
  m_requiredORCount: z.number().nullish(),
});

/** One goal-logic entry. */
export type GoalLogicEntry = z.infer<typeof GoalLogicEntrySchema>;

/**
 * A quest document.
 *
 * `m_questName` is the only required field (the corpus, and every endpoint that addresses a
 * quest by name, needs it); it must be a non-empty string.
 */
export const QuestTemplateSchema = passthroughObject({
  m_questName: z.string().min(1),
  m_questNameID: z.number().nullish(),
  m_questTitle: z.string().nullish(),
  m_questInfo: z.string().nullish(),
  m_questPrep: z.string().nullish(),
  m_questUnderway: z.string().nullish(),
  m_questComplete: z.string().nullish(),
  m_startGoals: z.array(z.string()).nullish(),
  m_goals: z.array(GoalTemplateSchema).nullish(),
  m_startResults: ResultListSchema.nullish(),
  m_endResults: ResultListSchema.nullish(),
  m_requirements: RequirementListFieldSchema,
  m_prepRequirements: RequirementListFieldSchema,
  m_pruneRequirements: RequirementListFieldSchema,
  m_goalLogic: z.array(GoalLogicEntrySchema).nullish(),
  m_questLevel: z.number().nullish(),
  m_questRepeat: z.number().nullish(),
  m_onStartQuestScript: z.string().nullish(),
  m_onEndQuestScript: z.string().nullish(),
  m_dialogList: ActorDialogListFieldSchema,
  m_isHidden: z.boolean().nullish(),
  m_mainline: z.boolean().nullish(),
  m_noQuestHelper: z.boolean().nullish(),
  m_clientTags: z.array(z.string()).nullish(),
  m_activityType: z.string().nullish(),
  m_prepAlways: z.boolean().nullish(),
  m_forceInteraction: z.boolean().nullish(),
  m_checkInventoryForCrafting: z.boolean().nullish(),
  m_playAsYourPetNPC: z.boolean().nullish(),
  m_missionDoors: opaqueObject.nullish(),
  m_dynaMods: opaqueObject.nullish(),
  m_outdated: z.boolean().nullish(),
  m_defaultDialogAnimation: opaqueObject.nullish(),
  m_skipQHAutoSelect: z.boolean().nullish(),
  m_questEffectInfoList: opaqueObject.nullish(),
  m_behaviors: opaqueObject.nullish(),
});

/** A parsed quest document. */
export type QuestTemplate = z.infer<typeof QuestTemplateSchema>;

/** The 36 modelled top-level field names, in declaration order. */
export const QUEST_TEMPLATE_FIELDS: readonly string[] = Object.keys(QuestTemplateSchema.shape);
