import { z } from 'zod';

import { passthroughObject } from './schemaKit.js';
import {
  MAGIC_SCHOOLS,
  REQUIREMENT_LIST_TYPE,
  REQUIREMENT_OPERATORS,
  TYPE_STRINGS,
} from './typeConstants.js';

/**
 * Requirement types — [spec-domain-reference.md] L416-440, task 3.1.
 *
 * Four leaf types (`ReqHasQuest`, `ReqHasEntry`, `ReqSchoolOfFocus`, `ReqIsSchool`) plus the
 * **recursive** `RequirementList` wrapper whose optional `m_requirements` array nests the
 * union again, which is what makes the AND/OR tree of task 3.6 expressible.
 *
 * `ReqHasGoal` and `ReqEntryValue` are deliberately **not implemented** (L436).
 *
 * Measured corpus contract (322 files):
 *
 * | node               | occurrences | measured fields |
 * |--------------------|-------------|-----------------|
 * | `RequirementList`  | 307         | `$type, m_applyNOT, m_operator, m_requirements` |
 * | `ReqHasQuest`      | 277         | `$type, m_applyNOT, m_operator, m_questName` |
 * | `ReqHasEntry`      | 40          | `$type, m_applyNOT, m_displayName, m_entryName, m_isQuestRegistry, m_operator, m_questName` |
 * | `ReqSchoolOfFocus` | 21          | `$type, m_applyNOT, m_magicSchool, m_operator` |
 * | `ReqIsSchool`      | 0           | spec-only (L432-434) |
 *
 * The wrapper's `$type` is **optional**: 28 wrappers occur without one (7 at the quest's
 * top level, 21 inside `ResLearnSpell.m_requirements`), so a typeless wrapper is a legal
 * corpus value. A *present* `$type` must still be the `RequirementList` literal, which is
 * what keeps an unknown `$type` a loud failure instead of silently matching the wrapper.
 */

/** Requirement nodes share these two flags ([spec-domain-reference.md] L438). */
const requirementBaseShape = {
  m_applyNOT: z.boolean().nullish(),
  m_operator: z.enum(REQUIREMENT_OPERATORS).nullish(),
};

export const ReqHasQuestSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ReqHasQuest),
  ...requirementBaseShape,
  m_questName: z.string().nullish(),
});

export const ReqHasEntrySchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ReqHasEntry),
  ...requirementBaseShape,
  m_questName: z.string().nullish(),
  m_entryName: z.string().nullish(),
  // Corpus-only fields the spec's 4-field list omits (measured on 40/40 nodes, D5):
  // `m_displayName` and `m_isQuestRegistry` must survive a save even though nothing
  // edits them yet.
  m_displayName: z.string().nullish(),
  m_isQuestRegistry: z.boolean().nullish(),
});

export const ReqSchoolOfFocusSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ReqSchoolOfFocus),
  ...requirementBaseShape,
  m_magicSchool: z.enum(MAGIC_SCHOOLS).nullish(),
});

/** Spec-only type (absent from the corpus): both its fields stay loosely typed. */
export const ReqIsSchoolSchema = passthroughObject({
  $type: z.literal(TYPE_STRINGS.ReqIsSchool),
  ...requirementBaseShape,
  m_magicSchoolName: z.string().nullish(),
  m_targetType: z.string().nullish(),
});

/** Parsed shape of a requirement leaf. */
export type RequirementLeaf =
  | z.infer<typeof ReqHasQuestSchema>
  | z.infer<typeof ReqHasEntrySchema>
  | z.infer<typeof ReqSchoolOfFocusSchema>
  | z.infer<typeof ReqIsSchoolSchema>;

/**
 * A recursive AND/OR group ([spec-domain-reference.md] L440). `$type` is optional (see the
 * module header) and every field is optional: the corpus's 28 typeless wrappers carry only
 * `m_applyNOT`, `m_operator` and `m_requirements`.
 */
export interface RequirementList {
  $type?: typeof REQUIREMENT_LIST_TYPE | null;
  m_applyNOT?: boolean | null;
  m_operator?: (typeof REQUIREMENT_OPERATORS)[number] | null;
  m_requirements?: Requirement[] | null;
  [key: string]: unknown;
}

/** Any requirement node: a leaf or a nested group. */
export type Requirement = RequirementLeaf | RequirementList;

/** The recursive union (declaration order matters: leaves are tried before the group). */
export const RequirementSchema = z.lazy(() =>
  z.union([
    ReqHasQuestSchema,
    ReqHasEntrySchema,
    ReqSchoolOfFocusSchema,
    ReqIsSchoolSchema,
    RequirementListSchema,
  ]),
) as unknown as z.ZodType<Requirement>;

/** The `m_requirements` wrapper / group node. */
export const RequirementListSchema = z.lazy(() =>
  passthroughObject({
    $type: z.literal(REQUIREMENT_LIST_TYPE).nullish(),
    ...requirementBaseShape,
    m_requirements: z.array(RequirementSchema).nullish(),
  }),
) as unknown as z.ZodType<RequirementList>;

/**
 * A requirement slot in the document: the group wrapper, `null` (the corpus's
 * `m_prepRequirements: null` / `NPCDialogEntry.m_requirements: null`), or absent.
 * `null` is preserved as `null` — it never becomes `{}`.
 */
export const RequirementListFieldSchema = RequirementListSchema.nullish();
