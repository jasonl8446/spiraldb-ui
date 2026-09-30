/**
 * The Goals tab's field model and every pure rule behind it (plan task 3.4, story
 * p3-04; docs/spec-ui-design.md L300-314, docs/spec-domain-reference.md L312-338).
 *
 * Like `lib/quest-info.ts` this module is **data and rules, not JSX**: the five goal
 * types ({@link GOAL_TYPE_SPECS}), the 24 shared base fields partitioned into
 * {@link GOAL_EDITABLE_BASE_FIELDS} (17 the Goals tab owns) and
 * {@link GOAL_COMPLEX_FIELDS} (7 object/array-valued fields owned by other Phase-3
 * tasks and shown read-only), and the edit builders every control calls. A unit test
 * walks the partition and asserts it is exactly the 24 keys of the spec table, so
 * "none dropped" is a checkable property rather than a promise.
 *
 * **Measured corpus facts this model is built on** (all 322 `QuestTemplates/*.json` in
 * `data/test-spiraldb`, 772 goal objects in 311 quests; measured 2026-09-26 by the story
 * lead — quoted here because they decide rules, and every one of them is asserted by
 * `tests/unit/quest-goals.test.ts`):
 *
 * - `$type` is the **assembly-qualified** string and is taken from
 *   `shared/quest/typeConstants.ts`'s `GOAL_TYPES` table — never re-typed here, so
 *   criterion #8's character-for-character match has one home.
 * - **`$type` and `m_goalType` are not 1:1**: Persona→`GOAL_TYPE_PERSONA` 405,
 *   Waypoint→`GOAL_TYPE_WAYPOINT` 194, Bounty→`GOAL_TYPE_BOUNTYCOLLECT` 96 **or**
 *   `GOAL_TYPE_BOUNTY` 4, Scavenge→`GOAL_TYPE_SCAVENGE` 43 **or** `GOAL_TYPE_USAGE` 4,
 *   AchieveRank→`GOAL_TYPE_ACHIEVERANK` 26. Creating a goal writes the **majority**
 *   value ({@link GoalTypeSpec.defaultGoalType}); an **existing** goal whose
 *   `m_goalType` is the minority variant is never rewritten (D57: validate, never
 *   normalise) — the two axes stay independent and the trailing "raw" select option
 *   keyed by {@link goalTypeSelectOptions} keeps a value this table has never seen.
 * - **Base keys are genuinely optional.** Key-presence per goal (measured, not value
 *   counts — the two differ because a present key can hold an explicit `null`): 759 of
 *   the 772 goals carry all 24 base keys and **13 are sparse** — 5 carry 14 base keys and
 *   8 carry 15. All 13 come from `questtemplates_WC-CYCLOPS-MAIN-002.json`, i.e. from this
 *   tool's own extraction pipeline, which writes a sparser goal shape than the
 *   game-authored files do; the absent keys are the complex ones plus, in some goals,
 *   `m_goalUnderway`/`m_hyperlink`/`m_completeText`/`m_tallyCounter`/`m_clientTags`/
 *   `m_dialogList`. A sparse goal must stay sparse: every builder here writes exactly one
 *   key on `setAtPath`/`deleteAtPath` and never pads a goal out to a 24-key shape. A
 *   Waypoint missing `m_zoneTag`/`m_proximityTag` (193 of 194 carry them) is the same
 *   rule one level down — absent stays absent.
 *   (`shared/quest/goals.ts`'s header still claims all 24 are present in all 772 goals;
 *   the lead recorded that as a documentation defect there — the schema's `.nullish()`
 *   fields make absence valid — and it is deliberately not fixed from this story.)
 * - `m_itemAdjectives` is absent from the **entire** corpus (0 of 47 Scavenge goals);
 *   `m_bountyType` occurs on 5 of 100 Bounty goals with exactly one distinct value
 *   (`BT_MOB_KILL`); `m_itemTotal` on 4 of 47. They are still offered as fields because
 *   `docs/plan-phase-3-quest-editing.md` §3.4 requires every type-specific field to be
 *   editable, but a document that does not carry one keeps not carrying it.
 * - `m_personaName` holds an NPC **name** (`WC-HUB-NPC01`), not a template id, and can
 *   be `''`. The 8 distinct values in the corpus resolve in **neither** names table —
 *   0 of 8 are in `npcs.name` (all 23,033 rows) and 0 of 8 are `string_table` keys — so
 *   a closed `<select>` over `npcs.name` would mark every real value "unlisted". The
 *   control is therefore a free-text input with a `<datalist>` of suggestions drawn from
 *   `npcs.name` ({@link npcNameSuggestions}); the value is whatever the user typed.
 * - `m_zoneTag` / `m_destinationZone` hold zone **paths** (the `zones` table's
 *   `zone_path`), so `FriendlyNameDropdown type="zones"` is the right control — but only
 *   **112 of the 149 distinct corpus zone paths exist in the `zones` table** (the misses
 *   are interior variants like `DragonSpire/DS_A3_Kings/Interiors/DS_School_Fire`), so
 *   the dropdown's miss path (raw id stays displayed, no error) is load-bearing, not
 *   defensive.
 * - `m_goalTitle` is a string-table key (`WizardQuestGoals_UseItem` → `"Use"`) and **26
 *   corpus goals carry `m_goalTitle: ""`** — the same empty-key hazard p3-03 handled, so
 *   this module reuses {@link shouldLookupStringKey} from `quest-info.ts` (imported, not
 *   copied) and never requests `/api/names/strings/` (the LIST route: 24,077,358 bytes).
 *
 * Three rules decisions of this story, each recorded in the story report:
 *
 * 1. **A delete does not cascade into `m_startGoals`.** Removing `m_goals[i]` leaves a
 *    start-name reference dangling when one exists. That is deliberate: plan §3.9's
 *    acceptance criteria ("delete a referenced start goal → inline error + Save
 *    disabled") require the dangling state to be constructible through the UI, and
 *    silently rewriting `m_startGoals` on delete would be normalisation (D57).
 * 2. **Emptying an editable field deletes its key when it is there and produces no edit
 *    when it is not** (D59(c), the rule p3-03 shipped) — see {@link goalTextFieldEdit},
 *    {@link goalNumberFieldEdit}, {@link goalTagsFieldEdit}.
 * 3. **A new goal is corpus-shaped**: all 24 base fields plus the type's own fields, with
 *    the corpus's own null/empty convention (the three "rich-only" strings are `null`,
 *    `m_clientTags`/`m_genericEvents` are `[]`, `m_completeResults`/`m_activateResults`
 *    are `{}`) — the shape 759 of the 772 measured goals carry. Building that object is
 *    new content for an *insert*: it never rewrites an existing goal (a sparse goal keeps
 *    its missing keys, see the presence bullet above), and `m_goalNameID` is `0` because
 *    an editor cannot compute the client's hash (recorded as a choice in the report).
 */

import type { DocEdit, DocPath } from '@shared/document';
import { fieldLabel } from '@shared/glossary';
import {
  GOAL_TYPES,
  GOAL_TYPE_VALUES,
  shortTypeName,
  type GoalTypeValue,
} from '@shared/quest/typeConstants';

import { clientTagsToText, parseClientTags, shouldLookupStringKey } from './quest-info';
import { shortTypeName as lenientShortTypeName } from './extract';

/* ------------------------------------------------------------------ constants */

/** The document key holding the goal array. */
export const GOALS_PATH = 'm_goals';

/** The document key holding the start-goal **name** list. */
export const START_GOALS_PATH = 'm_startGoals';

/** The `m_goals[]` element path, optionally with the goal's own key appended. */
export function goalPath(index: number, key?: string): DocPath {
  return key === undefined ? [GOALS_PATH, index] : [GOALS_PATH, index, key];
}

/** The `$type` values of the five goal classes, derived from the constant table. */
export type GoalTypeString = (typeof GOAL_TYPES)[keyof typeof GOAL_TYPES];

/** The five goal types' short names — the select's own values. */
export type GoalShortTypeName = 'Waypoint' | 'Persona' | 'Bounty' | 'Scavenge' | 'AchieveRank';

/** How one goal field renders, and what an edit of it means. */
export type GoalFieldKind = 'text' | 'number' | 'boolean' | 'tags' | 'zone' | 'npcName' | 'select';

/** One editable (or read-only) goal field: a type-specific one, or a base scalar. */
export interface GoalFieldSpec {
  /** The goal key this field owns. */
  key: string;
  kind: GoalFieldKind;
  /** The card/summary label — the spec ASCII's own wording where it has one (L305-309). */
  label: string;
  /**
   * The one-line explanation under the control. Where `docs/spec-domain-reference.md`
   * L316-334 documents the field its own words are used; the measured presence counts
   * (193/194, 5/100, …) live in the module header, not in user-facing copy.
   */
  help: string;
  /** For `select`: the listed values. An unlisted current value is appended, never lost. */
  options?: readonly string[];
}

/** One of the five goal classes: its `$type`, its default `m_goalType`, its fields. */
export interface GoalTypeSpec {
  shortName: GoalShortTypeName;
  /** The assembly-qualified `$type`, taken from `shared/quest/typeConstants.ts`. */
  $type: GoalTypeString;
  /** The majority `m_goalType` measured for this class — what a **new** goal is given. */
  defaultGoalType: GoalTypeValue;
  /**
   * The spec's badge colour (docs/spec-ui-design.md L360-365) as a literal Tailwind
   * class string. Literal on purpose: a composed class name is invisible to Tailwind's
   * scanner and would render unstyled.
   */
  badgeClass: string;
  /** The type's own fields, in the order the card's summary lines read. */
  fields: readonly GoalFieldSpec[];
}

/**
 * The five goal classes (docs/spec-domain-reference.md L316-334), with each type's own
 * fields. `$type` comes from the constant table; `defaultGoalType` is the measured
 * majority from {@link GOAL_TYPE_VALUES}'s provenance comment.
 */
export const GOAL_TYPE_SPECS: readonly GoalTypeSpec[] = [
  {
    shortName: 'Waypoint',
    $type: GOAL_TYPES.WaypointGoalTemplate,
    defaultGoalType: 'GOAL_TYPE_WAYPOINT',
    badgeClass: 'border-blue-500 bg-blue-500/15 text-blue-300',
    // Ordered as the card's summary lines read (plan §3.4 L35: zone / entry / exit /
    // proximity tag), not as the domain reference lists them.
    fields: [
      {
        key: 'm_zoneTag',
        kind: 'zone',
        label: fieldLabel('m_zoneTag'),
        help: 'Zone path (the zones table’s zone_path)',
      },
      {
        key: 'm_zoneEntry',
        kind: 'boolean',
        label: fieldLabel('m_zoneEntry'),
        help: 'Counts entering the zone',
      },
      {
        key: 'm_zoneExit',
        kind: 'boolean',
        label: fieldLabel('m_zoneExit'),
        help: 'Counts leaving the zone',
      },
      {
        key: 'm_proximityTag',
        kind: 'text',
        label: fieldLabel('m_proximityTag'),
        help: 'Proximity trigger tag',
      },
    ],
  },
  {
    shortName: 'Persona',
    $type: GOAL_TYPES.PersonaGoalTemplate,
    defaultGoalType: 'GOAL_TYPE_PERSONA',
    badgeClass: 'border-purple-500 bg-purple-500/15 text-purple-300',
    fields: [
      {
        key: 'm_personaName',
        kind: 'npcName',
        label: fieldLabel('m_personaName'),
        help: 'NPC name (a name, not a template id; free text with npc-name suggestions)',
      },
      {
        key: 'm_usePatron',
        kind: 'boolean',
        label: fieldLabel('m_usePatron'),
        help: 'Requires the patron interaction',
      },
    ],
  },
  {
    shortName: 'Bounty',
    $type: GOAL_TYPES.BountyGoalTemplate,
    defaultGoalType: 'GOAL_TYPE_BOUNTYCOLLECT',
    badgeClass: 'border-red-500 bg-red-500/15 text-red-300',
    fields: [
      {
        key: 'm_npcAdjectives',
        kind: 'tags',
        label: fieldLabel('m_npcAdjectives'),
        help: 'Mob tags this bounty counts',
      },
      {
        key: 'm_bountyTotal',
        kind: 'number',
        label: fieldLabel('m_bountyTotal'),
        help: 'Number of mobs to kill',
      },
      {
        key: 'm_bountyType',
        kind: 'select',
        label: fieldLabel('m_bountyType'),
        help: 'Bounty classification (measured: BT_MOB_KILL only)',
        options: ['BT_MOB_KILL'],
      },
    ],
  },
  {
    shortName: 'Scavenge',
    $type: GOAL_TYPES.ScavengeGoalTemplate,
    defaultGoalType: 'GOAL_TYPE_SCAVENGE',
    badgeClass: 'border-amber-500 bg-amber-500/15 text-amber-300',
    fields: [
      {
        key: 'm_itemAdjectives',
        kind: 'tags',
        label: fieldLabel('m_itemAdjectives'),
        help: 'Item tags this goal counts',
      },
      {
        key: 'm_itemTotal',
        kind: 'number',
        label: fieldLabel('m_itemTotal'),
        help: 'Number of items to collect',
      },
    ],
  },
  {
    shortName: 'AchieveRank',
    $type: GOAL_TYPES.AchieveRankGoalTemplate,
    defaultGoalType: 'GOAL_TYPE_ACHIEVERANK',
    badgeClass: 'border-emerald-500 bg-emerald-500/15 text-emerald-300',
    fields: [{ key: 'm_rank', kind: 'number', label: fieldLabel('m_rank'), help: 'Required rank' }],
  },
];

/** The badge class for a type this table does not know — never a colour it guessed. */
export const GOAL_TYPE_BADGE_FALLBACK = 'border-zinc-700 bg-zinc-800/60 text-zinc-300';

/** The label of the no-value option in a goal select. */
export const GOAL_SELECT_UNSET_LABEL = '—';

/**
 * The 24 shared base fields in the spec table's own order
 * (docs/spec-domain-reference.md L336-338), partitioned below into the 17 the Goals tab
 * edits and the 7 complex ones it shows read-only.
 */
export const GOAL_BASE_FIELDS: readonly string[] = [
  'm_goalName',
  'm_goalNameID',
  'm_goalTitle',
  'm_goalUnderway',
  'm_hyperlink',
  'm_completeText',
  'm_completeResults',
  'm_goalRequirements',
  'm_tallyCounter',
  'm_locationName',
  'm_displayImage1',
  'm_displayImage2',
  'm_clientTags',
  'm_genericEvents',
  'm_autoQualify',
  'm_autoComplete',
  'm_destinationZone',
  'm_dialogList',
  'm_goalType',
  'm_noQuestHelper',
  'm_petOnlyQuest',
  'm_activateResults',
  'm_hideGoalFloatyText',
  'm_behaviors',
];

/**
 * The 17 base fields the Goals tab owns, in the spec's order. `m_goalName` is editable:
 * goal names are unique within a quest (measured) but a typo has to be fixable
 * somewhere, and plan §3.9 owns the dangling-reference error a rename can create
 * (the Goals tab does not silently rewrite `m_startGoals`/`m_goalLogic`).
 */
export const GOAL_EDITABLE_BASE_FIELDS: readonly GoalFieldSpec[] = [
  {
    key: 'm_goalName',
    kind: 'text',
    label: fieldLabel('m_goalName'),
    help: 'Unique goal name within this quest',
  },
  {
    key: 'm_goalNameID',
    kind: 'number',
    label: fieldLabel('m_goalNameID'),
    help: 'Hashed goal name ID (may be 0)',
  },
  {
    key: 'm_goalTitle',
    kind: 'text',
    label: fieldLabel('m_goalTitle'),
    help: 'String table key for the goal title',
  },
  {
    key: 'm_goalUnderway',
    kind: 'text',
    label: fieldLabel('m_goalUnderway'),
    help: 'In-progress description',
  },
  {
    key: 'm_hyperlink',
    kind: 'text',
    label: fieldLabel('m_hyperlink'),
    help: 'Help link shown in the quest log',
  },
  {
    key: 'm_completeText',
    kind: 'text',
    label: fieldLabel('m_completeText'),
    help: 'Completion text',
  },
  {
    key: 'm_locationName',
    kind: 'text',
    label: fieldLabel('m_locationName'),
    help: 'String table key for the location',
  },
  {
    key: 'm_displayImage1',
    kind: 'text',
    label: fieldLabel('m_displayImage1'),
    help: 'Quest helper image path',
  },
  {
    key: 'm_displayImage2',
    kind: 'text',
    label: fieldLabel('m_displayImage2'),
    help: 'Second quest helper image path',
  },
  {
    key: 'm_clientTags',
    kind: 'tags',
    label: fieldLabel('m_clientTags'),
    help: 'Tags for client UI filtering',
  },
  {
    key: 'm_autoQualify',
    kind: 'boolean',
    label: fieldLabel('m_autoQualify'),
    help: 'Qualifies the goal automatically',
  },
  {
    key: 'm_autoComplete',
    kind: 'boolean',
    label: fieldLabel('m_autoComplete'),
    help: 'Completes the goal automatically',
  },
  {
    key: 'm_destinationZone',
    kind: 'zone',
    label: fieldLabel('m_destinationZone'),
    help: 'Zone path (zone_path)',
  },
  {
    key: 'm_goalType',
    kind: 'select',
    label: fieldLabel('m_goalType'),
    help: 'Quest-log classification (independent of $type; unknown values are kept)',
    options: GOAL_TYPE_VALUES,
  },
  {
    key: 'm_noQuestHelper',
    kind: 'boolean',
    label: fieldLabel('m_noQuestHelper'),
    help: 'Disables the quest helper arrow',
  },
  {
    key: 'm_petOnlyQuest',
    kind: 'boolean',
    label: fieldLabel('m_petOnlyQuest'),
    help: 'Pet-play mode flag',
  },
  {
    key: 'm_hideGoalFloatyText',
    kind: 'boolean',
    label: fieldLabel('m_hideGoalFloatyText'),
    help: 'Hides the on-screen goal text',
  },
];

/**
 * The 7 base fields this tab must **not** deeply edit: each is an object/array structure
 * owned by another Phase-3 task (Results §3.7, Requirements §3.6, Dialog §3.8) or by no
 * task at all. They are listed so the partition is checkable and so the card's raw-fields
 * disclosure can name their owner instead of silently hiding them.
 *
 * `owner: null` means **no Phase-3 task names an editor for this field** — mirroring
 * `quest-info.ts`'s `QUEST_OTHER_TAB_FIELDS` convention. The plan's §3.4 text mentions
 * `m_tallyCounter` while listing Bounty/Scavenge fields, but assigns it to no editor; the
 * field stays reachable through the raw-JSON disclosure, which is the honest fallback.
 */
export interface GoalComplexFieldSpec {
  key: string;
  owner: 'Results' | 'Requirements' | 'Dialog' | null;
  help: string;
}

export const GOAL_COMPLEX_FIELDS: readonly GoalComplexFieldSpec[] = [
  { key: 'm_completeResults', owner: 'Results', help: 'Results granted when the goal completes' },
  { key: 'm_goalRequirements', owner: 'Requirements', help: 'Requirement tree gating the goal' },
  { key: 'm_tallyCounter', owner: null, help: 'Tally counter state' },
  { key: 'm_genericEvents', owner: null, help: 'Generic event list' },
  { key: 'm_dialogList', owner: 'Dialog', help: 'Actor dialog list for this goal' },
  { key: 'm_activateResults', owner: 'Results', help: 'Results granted when the goal activates' },
  { key: 'm_behaviors', owner: null, help: 'Behaviour overrides' },
];

/**
 * Every key the model knows: `$type`, the 24 base fields and the union of the five
 * types' own fields (12 keys). Anything else on a goal is **unmodelled** and surfaced by
 * the raw-fields disclosure; it is never rewritten and never removed.
 */
export const KNOWN_GOAL_KEYS: readonly string[] = [
  '$type',
  ...GOAL_BASE_FIELDS,
  ...GOAL_TYPE_SPECS.flatMap((spec) => spec.fields.map((field) => field.key)),
];

/* --------------------------------------------------------------- UI copy */

/** The editor section's accessible name (the tier-1 spec scopes to it). */
export const GOALS_EDITOR_LABEL = 'Quest goals editor';
/** The bottom "Add Goal" control. */
export const ADD_GOAL_LABEL = 'Add Goal';
/** The Add Goal type selector's label. */
export const ADD_GOAL_TYPE_LABEL = 'New goal type';
/** The badge shown on a goal that is in `m_startGoals`. */
export const START_GOAL_BADGE_LABEL = 'Start';
/** The start-membership toggle's two accessible names. */
export const SET_START_GOAL_LABEL = 'Set as Start Goal';
export const UNSET_START_GOAL_LABEL = 'Unset as Start Goal';
/** The card's per-goal actions. */
export const EDIT_GOAL_LABEL = 'Edit';
export const DELETE_GOAL_LABEL = 'Delete';
/** The drag handle's accessible name prefix (an ordinal and the goal name follow). */
export const REORDER_HANDLE_LABEL = 'Reorder goal';
/** The collapsible base-field section inside the inline editor. */
export const SHARED_BASE_FIELDS_LABEL = 'Shared base fields';
/** The read-only disclosure of complex + unmodelled keys. */
export const RAW_FIELDS_LABEL = 'Raw fields';
/** The empty-list message. */
export const NO_GOALS_TEXT = 'This quest defines no goals.';

/* ------------------------------------------------------------------ lookups */

/** `true` for a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `container[key]` — `undefined` for a non-object container. */
export function goalField(goal: unknown, key: string): unknown {
  return isPlainObject(goal) ? goal[key] : undefined;
}

/** The `$type` spec for an assembly-qualified string, or `undefined`. */
export function goalTypeSpecForTypeString(typeString: unknown): GoalTypeSpec | undefined {
  if (typeof typeString !== 'string') {
    return undefined;
  }
  const name = shortTypeName(typeString);
  if (name === undefined) {
    return undefined;
  }
  return GOAL_TYPE_SPECS.find((spec) => spec.$type === typeString) ?? findSpecByName(name);
}

/** The spec for one of the five short names. */
export function findSpecByName(name: string): GoalTypeSpec | undefined {
  return GOAL_TYPE_SPECS.find((spec) => spec.shortName === name);
}

/**
 * The goal's class: `$type` first (the value Imlight deserializes on), then the
 * default `m_goalType` of a spec as a fallback for a document with an unknown `$type`.
 * A minority `m_goalType` such as `GOAL_TYPE_BOUNTY` deliberately resolves to nothing
 * through this path when the `$type` is unknown as well — the module never guesses a
 * class from an m_goalType the measured pairing does not confirm.
 */
export function goalTypeSpecForGoal(goal: unknown): GoalTypeSpec | undefined {
  const byType = goalTypeSpecForTypeString(goalField(goal, '$type'));
  if (byType !== undefined) {
    return byType;
  }
  const goalType = goalField(goal, 'm_goalType');
  if (typeof goalType !== 'string' || goalType === '') {
    return undefined;
  }
  return GOAL_TYPE_SPECS.find((spec) => spec.defaultGoalType === goalType);
}

/**
 * The goal's short type name for display: the `$type`'s own short name when the constant
 * table knows it, the raw `m_goalType` when it does not, the `$type`'s literal tail as the
 * last resort (the lenient reader `lib/extract.ts` already uses for the read-only Goals
 * panel, so an unknown class still shows *which* class it is), and `'unknown'` only when
 * there is nothing at all to show.
 */
export function goalShortTypeName(goal: unknown): string {
  const typeString = goalField(goal, '$type');
  const fromType = typeof typeString === 'string' ? shortTypeName(typeString) : undefined;
  if (fromType !== undefined) {
    return fromType;
  }
  const goalType = goalField(goal, 'm_goalType');
  if (typeof goalType === 'string' && goalType !== '') {
    return goalType;
  }
  return lenientShortTypeName(typeString) ?? 'unknown';
}

/** The badge class for a goal — the spec's colour, or the neutral fallback. */
export function goalBadgeClass(goal: unknown): string {
  return goalTypeSpecForGoal(goal)?.badgeClass ?? GOAL_TYPE_BADGE_FALLBACK;
}

/** The type's own fields (empty for a goal whose class the model does not know). */
export function goalTypeFields(goal: unknown): readonly GoalFieldSpec[] {
  return goalTypeSpecForGoal(goal)?.fields ?? [];
}

/** The goal's `m_goalName` as a non-empty string, or `null`. */
export function goalName(goal: unknown): string | null {
  const name = goalField(goal, 'm_goalName');
  return typeof name === 'string' && name !== '' ? name : null;
}

/** The goal's `m_goalTitle` key as a non-empty string, or `null`. */
export function goalTitleKey(goal: unknown): string | null {
  return shouldLookupStringKey(goalField(goal, 'm_goalTitle'))
    ? (goalField(goal, 'm_goalTitle') as string)
    : null;
}

/** The `m_startGoals` value as a name list — `[]` for a missing or non-array value. */
export function startGoalNames(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((name): name is string => typeof name === 'string')
    : [];
}

/** `true` when this goal's name is in `m_startGoals` (by name, never by index). */
export function isStartGoal(goal: unknown, startGoals: unknown): boolean {
  const name = goalName(goal);
  return name !== null && startGoalNames(startGoals).includes(name);
}

/**
 * The keys present on a goal that the model does not know — the raw-fields disclosure's
 * reason to exist. `$type`, the 24 base fields and the union of the types' own fields are
 * known; everything else is legacy content that must survive every edit (D5).
 */
export function unmodelledGoalKeys(goal: unknown): string[] {
  if (!isPlainObject(goal)) {
    return [];
  }
  return Object.keys(goal).filter((key) => !KNOWN_GOAL_KEYS.includes(key));
}

/**
 * The goal's read-only raw fields, in the goal's own key order: the complex fields this
 * tab does not edit and every unmodelled key. Absent keys are not invented; the result is
 * `{}` for a goal that has neither.
 */
export function rawGoalFields(goal: unknown): Record<string, unknown> {
  if (!isPlainObject(goal)) {
    return {};
  }
  const complex = GOAL_COMPLEX_FIELDS.map((field) => field.key);
  const wanted = new Set([...complex, ...unmodelledGoalKeys(goal)]);
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(goal)) {
    if (wanted.has(key)) {
      raw[key] = goal[key];
    }
  }
  return raw;
}

/** The owner label of a complex field, for the disclosure's help text. */
export function complexFieldOwner(key: string): GoalComplexFieldSpec['owner'] | undefined {
  return GOAL_COMPLEX_FIELDS.find((field) => field.key === key)?.owner;
}

/* -------------------------------------------------------------- display */

/** A scalar document value as text — `null`/absent render empty (p3-03's rule). */
export function goalScalarText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

/** One field's card-summary display: `✓`/`✗`, the joined tags, or the scalar text. */
export function goalFieldDisplay(field: GoalFieldSpec, value: unknown): string {
  if (field.kind === 'boolean') {
    return value === true ? '✓' : value === false ? '✗' : '—';
  }
  if (field.kind === 'tags') {
    const text = clientTagsToText(value);
    return text === '' ? '(empty)' : text;
  }
  const text = goalScalarText(value);
  return text === '' ? '(empty)' : text;
}

/** One summary line of a goal card. */
export interface GoalSummaryLine {
  label: string;
  value: string;
}

/**
 * The card's summary lines (docs/spec-ui-design.md L305-309): every type-specific field
 * in order, then Client Tags and Display Image when the goal actually carries them. A
 * goal whose class is unknown yields only the two shared lines — the card still shows the
 * mono name and the neutral badge, so nothing is hidden.
 */
export function goalSummaryLines(goal: unknown): GoalSummaryLine[] {
  const lines: GoalSummaryLine[] = goalTypeFields(goal).map((field) => ({
    label: field.label,
    value: goalFieldDisplay(field, goalField(goal, field.key)),
  }));
  const tags = clientTagsToText(goalField(goal, 'm_clientTags'));
  if (tags !== '') {
    lines.push({ label: fieldLabel('m_clientTags'), value: tags });
  }
  const image = goalField(goal, 'm_displayImage1');
  if (typeof image === 'string' && image !== '') {
    lines.push({ label: 'Display Image', value: image });
  }
  return lines;
}

/* --------------------------------------------------------------- selects */

/** The select's value for a document value: the string itself, `''` otherwise. */
export function goalSelectValue(current: unknown): string {
  return typeof current === 'string' && current !== '' ? current : '';
}

/** One `<option>` of a goal select. */
export interface GoalSelectOption {
  value: string;
  label: string;
  /** `true` for the document's own value when the listed values do not include it. */
  unlisted: boolean;
}

/**
 * The options a goal select offers, mirroring `activityTypeOptions` in `quest-info.ts`:
 * the listed values, plus (a) a leading unset option when the document has no usable
 * value, or (b) the document's own value appended when the list has never heard of it.
 * Real content is never silently snapped to a listed option, and the select's value is
 * always the document's own ({@link goalSelectValue}).
 */
export function goalSelectOptions(current: unknown, listed: readonly string[]): GoalSelectOption[] {
  const options: GoalSelectOption[] = listed.map((value) => ({
    value,
    label: value,
    unlisted: false,
  }));
  const raw = goalSelectValue(current);
  if (raw === '') {
    return [{ value: '', label: GOAL_SELECT_UNSET_LABEL, unlisted: false }, ...options];
  }
  if (!listed.includes(raw)) {
    return [...options, { value: raw, label: raw, unlisted: true }];
  }
  return options;
}

/** The 7 measured `m_goalType` values, with an unlisted value preserved. */
export function goalTypeSelectOptions(current: unknown): GoalSelectOption[] {
  return goalSelectOptions(current, GOAL_TYPE_VALUES);
}

/** The measured `m_bountyType` values, with an unlisted value preserved. */
export function goalBountyTypeOptions(current: unknown): GoalSelectOption[] {
  return goalSelectOptions(current, ['BT_MOB_KILL']);
}

/* ------------------------------------------------------------ new goals */

/**
 * The default `m_goalName` for a new goal at `index`: `"<ordinal>_WizardQuestGoals_00000000"`,
 * in the corpus's own shape (`1_WizardQuestGoals_UseItem`, `2_WizardQuestGoals_00000067`).
 * The editor has no string-table key to point at, so it uses the numeric form, and the
 * numeric suffix is bumped until the name is unused **within the quest** — the uniqueness
 * the corpus guarantees and plan §3.9 validates.
 */
export function defaultGoalName(index: number, takenNames: readonly string[]): string {
  const taken = new Set(takenNames);
  const ordinal = index + 1;
  for (let serial = 0; ; serial += 1) {
    const candidate = `${ordinal}_WizardQuestGoals_${String(serial).padStart(8, '0')}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * A brand-new goal in the corpus's shape: `$type`, the majority `m_goalType` for the
 * type, the type's own fields and all 24 base fields (see the module header's rule 3).
 */
export function newGoalObject(type: GoalShortTypeName, name: string): Record<string, unknown> {
  const spec = findSpecByName(type);
  if (spec === undefined) {
    throw new Error(`unknown goal type "${type}"`);
  }
  const goal: Record<string, unknown> = {
    $type: spec.$type,
    m_goalName: name,
    m_goalNameID: 0,
    m_goalTitle: '',
    m_goalUnderway: null,
    m_hyperlink: null,
    m_completeText: null,
    m_completeResults: {},
    m_goalRequirements: null,
    m_tallyCounter: null,
    m_locationName: '',
    m_displayImage1: '',
    m_displayImage2: null,
    m_clientTags: [],
    m_genericEvents: [],
    m_autoQualify: false,
    m_autoComplete: false,
    m_destinationZone: '',
    m_dialogList: null,
    m_goalType: spec.defaultGoalType,
    m_noQuestHelper: false,
    m_petOnlyQuest: false,
    m_activateResults: {},
    m_hideGoalFloatyText: false,
    m_behaviors: null,
  };
  for (const field of spec.fields) {
    goal[field.key] = newGoalFieldValue(field);
  }
  return goal;
}

/** The neutral default of one type-specific field of a new goal. */
function newGoalFieldValue(field: GoalFieldSpec): unknown {
  switch (field.kind) {
    case 'boolean':
      return false;
    case 'number':
      return 0;
    case 'tags':
      return [];
    default:
      return '';
  }
}

/* ---------------------------------------------------------- edit builders */

/**
 * Adding a goal: one `insert` of a corpus-shaped object at the end of `m_goals`
 * ({@link newGoalObject}). `goalCount` is the current array length — the insert index
 * **and** the ordinal of the generated name.
 */
export function addGoalEdits(
  type: GoalShortTypeName,
  takenNames: readonly string[],
  goalCount: number,
): DocEdit[] {
  const name = defaultGoalName(goalCount, takenNames);
  return [{ op: 'insert', path: [GOALS_PATH], index: goalCount, value: newGoalObject(type, name) }];
}

/**
 * Deleting a goal: one `delete` of `m_goals[index]`. Deliberately **not** cascading into
 * `m_startGoals` (module header rule 1): the dangling start reference is the state plan
 * §3.9's validation criterion is written against, and rewriting the list here would be the
 * normalisation D57 forbids. Because deletion shifts later indices, the caller applies
 * this edit on its own, never batched with another index-addressed edit.
 */
export function deleteGoalEdit(index: number): DocEdit {
  return { op: 'delete', path: goalPath(index) };
}

/**
 * Moving a goal from `from` to `to` (`arrayMove` semantics; `to` is the element's final
 * index). Two primitives, in this order: **delete then insert** — removing first is what
 * makes `to` the final index, and passing `value` (the element the caller read out of the
 * document) is what keeps the move from rebuilding or duplicating content. A no-op move
 * produces no edits at all.
 */
export function moveGoalEdits(from: number, to: number, value: unknown): DocEdit[] {
  if (from === to) {
    return [];
  }
  return [
    { op: 'delete', path: goalPath(from) },
    { op: 'insert', path: [GOALS_PATH], index: to, value },
  ];
}

/**
 * Toggling a goal's Start membership: remove the one matching element when it is there
 * (leaving every other entry's order alone), append the name when it is not. A document
 * with no `m_startGoals` (or a non-array value) gets a one-element array when the user
 * turns Start **on** — that is a requested write — and no edits at all when turning it off.
 */
export function toggleStartGoalEdits(goalNameValue: string, current: unknown): DocEdit[] {
  if (goalNameValue === '') {
    return [];
  }
  const names = Array.isArray(current) ? current : null;
  if (names === null) {
    return [{ op: 'set', path: [START_GOALS_PATH], value: [goalNameValue] }];
  }
  const at = names.indexOf(goalNameValue);
  if (at >= 0) {
    return [{ op: 'delete', path: [START_GOALS_PATH, at] }];
  }
  return [{ op: 'set', path: [START_GOALS_PATH, names.length], value: goalNameValue }];
}

/* ----------------------------------------------------------- field edits */

/**
 * The edit a text-like control (text input, zone dropdown, NPC name input, select)
 * produces on goal `index`'s `key`. Emptying the control deletes the key when it exists
 * and produces **no** edit when it does not (module header rule 2).
 */
export function goalTextFieldEdit(
  index: number,
  key: string,
  present: boolean,
  raw: string,
): DocEdit | null {
  if (raw === '') {
    return present ? { op: 'delete', path: goalPath(index, key) } : null;
  }
  return { op: 'set', path: goalPath(index, key), value: raw };
}

/**
 * The edit a number input produces on goal `index`'s `key`. `''` behaves like
 * {@link goalTextFieldEdit}; a non-finite intermediate (`1e`, `-`) produces no edit rather
 * than a `NaN` in the document, and the parsed number is written exactly as parsed — no
 * rounding, no truncation (D57: validate, never normalise).
 */
export function goalNumberFieldEdit(
  index: number,
  key: string,
  present: boolean,
  raw: string,
): DocEdit | null {
  if (raw.trim() === '') {
    return present ? { op: 'delete', path: goalPath(index, key) } : null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  return { op: 'set', path: goalPath(index, key), value };
}

/**
 * The edit a tag input produces on goal `index`'s `key` (comma-separated, trimmed, empty
 * pieces dropped, order and duplicates kept — never normalised). Emptying the input
 * deletes the key when it exists.
 */
export function goalTagsFieldEdit(
  index: number,
  key: string,
  present: boolean,
  text: string,
): DocEdit | null {
  if (text.trim() === '') {
    return present ? { op: 'delete', path: goalPath(index, key) } : null;
  }
  return { op: 'set', path: goalPath(index, key), value: parseClientTags(text) };
}

/**
 * The edit a checkbox produces on goal `index`'s `key`. A checkbox can only express
 * `true`/`false`, and it only calls this when the user toggles it — an absent or `null`
 * value renders unchecked and stays untouched until then.
 */
export function goalBooleanFieldEdit(index: number, key: string, checked: boolean): DocEdit {
  return { op: 'set', path: goalPath(index, key), value: checked };
}

/* ------------------------------------------------------------- NPC names */

/** The minimum shape this module needs from an `npcs` row. */
export interface NpcNameRowLike {
  name: string | null;
}

/**
 * The `<datalist>` suggestions for `m_personaName`: the document's current value first
 * (so the browser shows it too), then the NPC **names** that contain `query`
 * case-insensitively, deduplicated and capped. `m_personaName` is a name, not a template
 * id, so `npcs.name` is the only column that can suggest anything; a name the table has
 * never seen is not an error and the free-text input keeps it (module header).
 */
export function npcNameSuggestions(
  rows: readonly NpcNameRowLike[],
  current: string,
  query: string,
  limit = 50,
): string[] {
  const needle = query.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (name: string): void => {
    if (out.length < limit && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  };
  if (current !== '') {
    push(current);
  }
  for (const row of rows) {
    const name = row?.name;
    if (typeof name !== 'string' || name === '') {
      continue;
    }
    if (needle !== '' && !name.toLowerCase().includes(needle)) {
      continue;
    }
    push(name);
  }
  return out;
}
