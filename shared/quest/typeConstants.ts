/**
 * The corpus-driven `$type` constant table — task 3.1 (p3-01), acceptance criterion #1.
 *
 * `$type` is Imcodec's `TypeNameHandling.Auto` annotation ([spec-domain-reference.md]
 * L715-716) and the value is the **assembly-qualified** .NET type name:
 *
 * ```
 * Imcodec.ObjectProperty.TypeCache.<ShortName>, Imcodec.ObjectProperty
 * ```
 *
 * The strings below are transcribed **verbatim** from the corpus grep
 * (`grep -rho '"$type": *"[^"]*"' /home/jason/Documents/git-projects/spiraldb/QuestTemplates/`),
 * never composed from the short name at runtime: criterion #8 requires a saved `$type`
 * to match the corpus "character-for-character", and p3-09 validates against this table.
 * `tests/unit/quest-type-constants.test.ts` re-runs that grep against the live corpus
 * (and against the committed recording of it) and fails if the measured set is no longer
 * a subset of {@link KNOWN_TYPE_STRINGS}.
 *
 * **Measured corpus reality (2026-09-26, 322 files in the real SpiralDB
 * `QuestTemplates/`):** 26 distinct `$type` strings, 7,956 occurrences, and **no top-level
 * `$type`** on a quest (322/322). The table is therefore a flat union of the polymorphic nodes
 * that occur *inside* a quest: 5 goal types, 14 result types, 3 requirement nodes + the
 * recursive `RequirementList` wrapper, `ActorDialogList` / `NPCDialogEntry`, and the madlib
 * argument `MadlibArgT_ByteString` — 3,685 occurrences, the commonest `$type` in the corpus
 * (1,605 inside quest-level dialogs, 2,080 inside goal dialogs) and one no plan or spec list
 * mentions. The audit exists to catch exactly that class of omission.
 *
 * Counts are corpus-specific and quoted with their source, because they are not
 * interchangeable: the real checkout measures 7,956 occurrences and the D17 test clone
 * (`data/test-spiraldb`) measures 7,911, since this tool's own save pipeline rewrote two
 * templates there from the reader's null-stripped output. Both have the same 26 strings.
 *
 * `ReqIsSchool` is the one spec-listed type the corpus does not contain
 * ([spec-domain-reference.md] L432-434), so it lives in
 * {@link SPEC_ONLY_TYPE_STRINGS}; it is still part of the requirement union (the spec's
 * 4-type enumeration) and of {@link KNOWN_TYPE_STRINGS} (a superset of the grep is
 * correct for the audit — the audit asserts `grep ⊆ constants`, not equality). It is also
 * the repository's 27th distinct `$type` overall, and it occurs outside the quest tree (in
 * `DropTables/droptables_test.json`), which is why a `QuestTemplates/` grep never sees it.
 */

/** The `$type` prefix every corpus `$type` string carries. */
export const TYPE_CACHE_PREFIX = 'Imcodec.ObjectProperty.TypeCache.';

/** The assembly-qualified suffix every corpus `$type` string carries. */
export const TYPE_ASSEMBLY_SUFFIX = ', Imcodec.ObjectProperty';

/** Builds the assembly-qualified spelling for a short Imcodec type name. */
export function assemblyQualifiedType(shortName: string): string {
  return `${TYPE_CACHE_PREFIX}${shortName}${TYPE_ASSEMBLY_SUFFIX}`;
}

/**
 * The 26 `$type` strings measured in the corpus, keyed by short type name.
 *
 * Every value is the full assembly-qualified string — copy it into `z.literal(...)` or
 * write it to a document; never shorten it (D5/AC#8: Imlight deserializes on the exact
 * string, and a short name silently fails to resolve server-side).
 */
export const CORPUS_TYPE_STRINGS = {
  // --- goals (5 types, 772 goal nodes) -----------------------------------------
  WaypointGoalTemplate:
    'Imcodec.ObjectProperty.TypeCache.WaypointGoalTemplate, Imcodec.ObjectProperty',
  PersonaGoalTemplate:
    'Imcodec.ObjectProperty.TypeCache.PersonaGoalTemplate, Imcodec.ObjectProperty',
  BountyGoalTemplate: 'Imcodec.ObjectProperty.TypeCache.BountyGoalTemplate, Imcodec.ObjectProperty',
  ScavengeGoalTemplate:
    'Imcodec.ObjectProperty.TypeCache.ScavengeGoalTemplate, Imcodec.ObjectProperty',
  AchieveRankGoalTemplate:
    'Imcodec.ObjectProperty.TypeCache.AchieveRankGoalTemplate, Imcodec.ObjectProperty',

  // --- results (14 types, 461 result nodes) ------------------------------------
  ResDropTable: 'Imcodec.ObjectProperty.TypeCache.ResDropTable, Imcodec.ObjectProperty',
  ResModifyEntry: 'Imcodec.ObjectProperty.TypeCache.ResModifyEntry, Imcodec.ObjectProperty',
  ResAddDynaMod: 'Imcodec.ObjectProperty.TypeCache.ResAddDynaMod, Imcodec.ObjectProperty',
  ResLearnSpell: 'Imcodec.ObjectProperty.TypeCache.ResLearnSpell, Imcodec.ObjectProperty',
  ResPostEvent: 'Imcodec.ObjectProperty.TypeCache.ResPostEvent, Imcodec.ObjectProperty',
  ResAddHealth: 'Imcodec.ObjectProperty.TypeCache.ResAddHealth, Imcodec.ObjectProperty',
  ResAddMana: 'Imcodec.ObjectProperty.TypeCache.ResAddMana, Imcodec.ObjectProperty',
  ResAddSpell: 'Imcodec.ObjectProperty.TypeCache.ResAddSpell, Imcodec.ObjectProperty',
  ResDespawn: 'Imcodec.ObjectProperty.TypeCache.ResDespawn, Imcodec.ObjectProperty',
  ResDrawHand: 'Imcodec.ObjectProperty.TypeCache.ResDrawHand, Imcodec.ObjectProperty',
  ResGiveSpell: 'Imcodec.ObjectProperty.TypeCache.ResGiveSpell, Imcodec.ObjectProperty',
  ResPlaySound: 'Imcodec.ObjectProperty.TypeCache.ResPlaySound, Imcodec.ObjectProperty',
  ResTeleport: 'Imcodec.ObjectProperty.TypeCache.ResTeleport, Imcodec.ObjectProperty',
  ResWait: 'Imcodec.ObjectProperty.TypeCache.ResWait, Imcodec.ObjectProperty',

  // --- requirements (3 leaves + the recursive wrapper) -------------------------
  ReqHasQuest: 'Imcodec.ObjectProperty.TypeCache.ReqHasQuest, Imcodec.ObjectProperty',
  ReqHasEntry: 'Imcodec.ObjectProperty.TypeCache.ReqHasEntry, Imcodec.ObjectProperty',
  ReqSchoolOfFocus: 'Imcodec.ObjectProperty.TypeCache.ReqSchoolOfFocus, Imcodec.ObjectProperty',
  RequirementList: 'Imcodec.ObjectProperty.TypeCache.RequirementList, Imcodec.ObjectProperty',

  // --- dialog (blocks, entries, madlib arguments) ------------------------------
  ActorDialogList: 'Imcodec.ObjectProperty.TypeCache.ActorDialogList, Imcodec.ObjectProperty',
  NPCDialogEntry: 'Imcodec.ObjectProperty.TypeCache.NPCDialogEntry, Imcodec.ObjectProperty',
  MadlibArgT_ByteString:
    'Imcodec.ObjectProperty.TypeCache.MadlibArgT_ByteString, Imcodec.ObjectProperty',
} as const;

/**
 * Spec-listed types the corpus does **not** contain (measured: `ReqIsSchool` 0 occurrences
 * in the 322 quest files; it is the repository's 27th distinct `$type` and lives in
 * `DropTables/droptables_test.json`). Kept apart from {@link CORPUS_TYPE_STRINGS} so "the
 * constant table is corpus-measured" stays a checkable claim, while the requirement union can
 * still offer the spec's 4th type ([spec-domain-reference.md] L416-438) with the correct
 * `$type` spelling the editor must write when a user adds one.
 */
export const SPEC_ONLY_TYPE_STRINGS = {
  ReqIsSchool: 'Imcodec.ObjectProperty.TypeCache.ReqIsSchool, Imcodec.ObjectProperty',
} as const;

/**
 * Every known `$type` string: the 26 corpus-measured ones plus the spec-only
 * `ReqIsSchool`. This is the table the criterion-#1 audit checks (`grep ⊆ this`).
 */
export const TYPE_STRINGS = { ...CORPUS_TYPE_STRINGS, ...SPEC_ONLY_TYPE_STRINGS } as const;

/** Short name of a known `$type` (key of {@link TYPE_STRINGS}). */
export type KnownTypeName = keyof typeof TYPE_STRINGS;

/** A known assembly-qualified `$type` string. */
export type KnownTypeString = (typeof TYPE_STRINGS)[KnownTypeName];

/** Every known `$type` string, in table order (corpus first, spec-only last). */
export const KNOWN_TYPE_STRINGS: readonly string[] = Object.values(TYPE_STRINGS);

const TYPE_NAME_BY_STRING = new Map<string, KnownTypeName>(
  (Object.keys(TYPE_STRINGS) as KnownTypeName[]).map((name) => [TYPE_STRINGS[name], name]),
);

/** `true` when `value` is one of {@link KNOWN_TYPE_STRINGS}. */
export function isKnownTypeString(value: string): boolean {
  return TYPE_NAME_BY_STRING.has(value);
}

/**
 * The short type name for an assembly-qualified `$type`, or `undefined` when the string is
 * not in the table. Used by the validation engine (p3-09) and by tests to name a failing
 * node; it never guesses (an unknown string is unknown).
 */
export function shortTypeName(value: string): KnownTypeName | undefined {
  return TYPE_NAME_BY_STRING.get(value);
}

/* ------------------------------------------------------------------ sub-tables */

/** The 5 goal `$type`s ([spec-domain-reference.md] L316-334). */
export const GOAL_TYPES = {
  WaypointGoalTemplate: TYPE_STRINGS.WaypointGoalTemplate,
  PersonaGoalTemplate: TYPE_STRINGS.PersonaGoalTemplate,
  BountyGoalTemplate: TYPE_STRINGS.BountyGoalTemplate,
  ScavengeGoalTemplate: TYPE_STRINGS.ScavengeGoalTemplate,
  AchieveRankGoalTemplate: TYPE_STRINGS.AchieveRankGoalTemplate,
} as const;

/** The 14 result `$type`s ([spec-domain-reference.md] L354-412). */
export const RESULT_TYPES = {
  ResDropTable: TYPE_STRINGS.ResDropTable,
  ResModifyEntry: TYPE_STRINGS.ResModifyEntry,
  ResAddDynaMod: TYPE_STRINGS.ResAddDynaMod,
  ResLearnSpell: TYPE_STRINGS.ResLearnSpell,
  ResPostEvent: TYPE_STRINGS.ResPostEvent,
  ResAddHealth: TYPE_STRINGS.ResAddHealth,
  ResAddMana: TYPE_STRINGS.ResAddMana,
  ResAddSpell: TYPE_STRINGS.ResAddSpell,
  ResDespawn: TYPE_STRINGS.ResDespawn,
  ResDrawHand: TYPE_STRINGS.ResDrawHand,
  ResGiveSpell: TYPE_STRINGS.ResGiveSpell,
  ResPlaySound: TYPE_STRINGS.ResPlaySound,
  ResTeleport: TYPE_STRINGS.ResTeleport,
  ResWait: TYPE_STRINGS.ResWait,
} as const;

/**
 * The 4 requirement `$type`s ([spec-domain-reference.md] L416-438). `ReqHasGoal` and
 * `ReqEntryValue` are deliberately **absent** (L436: they do not appear in SpiralDB data
 * and must not be implemented).
 */
export const REQUIREMENT_TYPES = {
  ReqHasQuest: TYPE_STRINGS.ReqHasQuest,
  ReqHasEntry: TYPE_STRINGS.ReqHasEntry,
  ReqSchoolOfFocus: TYPE_STRINGS.ReqSchoolOfFocus,
  ReqIsSchool: TYPE_STRINGS.ReqIsSchool,
} as const;

/** The recursive requirement-group `$type` ([spec-domain-reference.md] L440). */
export const REQUIREMENT_LIST_TYPE = TYPE_STRINGS.RequirementList;

/** Dialog-node `$type`s: the list wrapper, the entry and the madlib argument. */
export const DIALOG_TYPES = {
  ActorDialogList: TYPE_STRINGS.ActorDialogList,
  NPCDialogEntry: TYPE_STRINGS.NPCDialogEntry,
  MadlibArgT_ByteString: TYPE_STRINGS.MadlibArgT_ByteString,
} as const;

/* ---------------------------------------------------------------------- enums */

/**
 * The 7 `m_goalType` values measured across all 322 quests: `GOAL_TYPE_PERSONA` 405,
 * `GOAL_TYPE_WAYPOINT` 194, `GOAL_TYPE_BOUNTYCOLLECT` 96, `GOAL_TYPE_SCAVENGE` 43,
 * `GOAL_TYPE_ACHIEVERANK` 26, `GOAL_TYPE_BOUNTY` 4, `GOAL_TYPE_USAGE` 4.
 *
 * `m_goalType` is a **separate axis** from the goal `$type` class — `GOAL_TYPE_BOUNTY` and
 * `GOAL_TYPE_BOUNTYCOLLECT` are distinct values, and `GOAL_TYPE_USAGE` has no matching
 * goal class in this corpus — so this enum must never be derived from
 * {@link GOAL_TYPES}.
 */
export const GOAL_TYPE_VALUES = [
  'GOAL_TYPE_PERSONA',
  'GOAL_TYPE_WAYPOINT',
  'GOAL_TYPE_BOUNTYCOLLECT',
  'GOAL_TYPE_SCAVENGE',
  'GOAL_TYPE_ACHIEVERANK',
  'GOAL_TYPE_BOUNTY',
  'GOAL_TYPE_USAGE',
] as const;

/** `m_goalType` value ([spec-domain-reference.md] L344-350 is silent on the list). */
export type GoalTypeValue = (typeof GOAL_TYPE_VALUES)[number];

/**
 * The shared requirement operator enum ([spec-domain-reference.md] L438: both values are
 * defined). Measured: `ROP_AND` in every one of the 673 requirement nodes; `ROP_OR` never
 * occurs — the enum still carries both because the wire format does.
 */
export const REQUIREMENT_OPERATORS = ['ROP_AND', 'ROP_OR'] as const;

/** `m_operator` value. */
export type RequirementOperator = (typeof REQUIREMENT_OPERATORS)[number];

/** The 7 magic schools ([spec-domain-reference.md] L430) — all 7 measured, 3× each. */
export const MAGIC_SCHOOLS = ['Fire', 'Ice', 'Storm', 'Balance', 'Life', 'Death', 'Myth'] as const;

/** `m_magicSchool` value. */
export type MagicSchool = (typeof MAGIC_SCHOOLS)[number];

/**
 * The distinct `m_dialogTag` values measured across 739 dialog blocks: `Completion` 418,
 * `Prep` 316 and the empty string 5. The tag is deliberately **not** an enum: the corpus
 * proves tags outside `Prep`/`Completion` exist, and D53(b) records 4 quest-level dialog tags
 * outside `Prep`/`Completion` among the 141 quests the synthetic capture generator refused —
 * a closed enum would reject documents the game itself ships.
 */
export const KNOWN_DIALOG_TAGS = ['Prep', 'Completion', ''] as const;
