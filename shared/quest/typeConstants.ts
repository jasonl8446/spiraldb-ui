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
 * **Measured corpus reality (re-measured on the owner's fork at `f9a1055`, D79; the
 * 2026-09-26 322-file baseline is in the parentheses):** 29 distinct `$type` strings over
 * 8,746 occurrences in the real SpiralDB `QuestTemplates/` (328 quest files; was 26 / 7,956 /
 * 322), and **no top-level `$type`** on a quest (328/328). The table is therefore a flat union
 * of the polymorphic nodes that occur *inside* a quest: 5 goal types, 15 result types (the
 * spec's 14 plus the corpus-only `ResActorDialog`), 4 requirement nodes + the recursive
 * `RequirementList` wrapper, `ActorDialogList` / `NPCDialogEntry`, the typed dialog block
 * `ActorDialog`, and the madlib argument `MadlibArgT_ByteString` — 4,175 occurrences, the
 * commonest `$type` in the corpus (1,675 inside quest-level dialogs, 2,500 inside goal
 * dialogs) and one no plan or spec list mentions. The audit exists to catch exactly that
 * class of omission.
 *
 * Counts are corpus-specific and quoted with their source, because they are not
 * interchangeable: the real checkout measures 8,746 occurrences and the D17 test clone
 * (`data/test-spiraldb`, **not** re-cloned for this baseline) still holds the 322-file era at
 * 7,911 occurrences / 26 strings, because this tool's own save pipeline rewrote two templates
 * there from the reader's null-stripped output. The audit asserts `grep ⊆ constants` everywhere
 * and count equality only against the recorded corpus path.
 *
 * `ReqIsSchool` **moved from spec-only to corpus-measured at this baseline.** On the 322-file
 * corpus it was the one spec-listed type the corpus did not contain
 * ([spec-domain-reference.md] L432-434), so it lived in {@link SPEC_ONLY_TYPE_STRINGS} and was
 * the repository's 27th distinct `$type` (it occurred outside the quest tree, in
 * `DropTables/droptables_test.json`). The owner's 328-file baseline carries it **7 times** —
 * once per `WC-COMMONS-MAIN-002-*` quest, each a `{$type, m_magicSchoolName, m_applyNOT,
 * m_operator}` node — so it is a corpus-measured requirement type now and
 * {@link SPEC_ONLY_TYPE_STRINGS} is empty. The audit's assertion is unchanged
 * (`grep ⊆ constants`), and the table carries exactly the 29 measured strings.
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
 * The 29 `$type` strings measured in the corpus, keyed by short type name.
 *
 * Every value is the full assembly-qualified string — copy it into `z.literal(...)` or
 * write it to a document; never shorten it (D5/AC#8: Imlight deserializes on the exact
 * string, and a short name silently fails to resolve server-side).
 *
 * The three additions at the owner's `f9a1055` baseline (D79) are `ResActorDialog` (5),
 * `ActorDialog` (5) and the moved `ReqIsSchool` (7); each is transcribed from the same grep,
 * never composed, and each carries its measured occurrence count beside it.
 */
export const CORPUS_TYPE_STRINGS = {
  // --- goals (5 types, 796 goal nodes; was 772) --------------------------------
  WaypointGoalTemplate:
    'Imcodec.ObjectProperty.TypeCache.WaypointGoalTemplate, Imcodec.ObjectProperty',
  PersonaGoalTemplate:
    'Imcodec.ObjectProperty.TypeCache.PersonaGoalTemplate, Imcodec.ObjectProperty',
  BountyGoalTemplate: 'Imcodec.ObjectProperty.TypeCache.BountyGoalTemplate, Imcodec.ObjectProperty',
  ScavengeGoalTemplate:
    'Imcodec.ObjectProperty.TypeCache.ScavengeGoalTemplate, Imcodec.ObjectProperty',
  AchieveRankGoalTemplate:
    'Imcodec.ObjectProperty.TypeCache.AchieveRankGoalTemplate, Imcodec.ObjectProperty',

  // --- results (15 types: the spec's 14 + the corpus-only ResActorDialog; 386 measured
  // result nodes, was 381) ------------------------------------------------------
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
  /**
   * Not in the spec's 14-class result list ([spec-domain-reference.md] L354-412) and absent
   * from the 322-file corpus: the owner's `f9a1055` baseline carries it **5 times** (3 quests),
   * always as `{$type, m_dialog}` where `m_dialog` is an {@link ActorDialog}. Its shape is
   * modelled by `shared/quest/results.ts`'s `ResActorDialogSchema`; the results module gives it
   * a class with no editable fields so its nested dialog is disclosed read-only rather than
   * silently editable (the D57 rule: acknowledge, never normalise).
   */
  ResActorDialog: 'Imcodec.ObjectProperty.TypeCache.ResActorDialog, Imcodec.ObjectProperty',

  // --- requirements (4 leaves + the recursive wrapper) -------------------------
  ReqHasQuest: 'Imcodec.ObjectProperty.TypeCache.ReqHasQuest, Imcodec.ObjectProperty',
  ReqHasEntry: 'Imcodec.ObjectProperty.TypeCache.ReqHasEntry, Imcodec.ObjectProperty',
  ReqSchoolOfFocus: 'Imcodec.ObjectProperty.TypeCache.ReqSchoolOfFocus, Imcodec.ObjectProperty',
  RequirementList: 'Imcodec.ObjectProperty.TypeCache.RequirementList, Imcodec.ObjectProperty',
  /**
   * Measured **7 times** on the owner's baseline (was 0 — see the module header): one
   * `{$type, m_magicSchoolName, m_applyNOT, m_operator}` node per `WC-COMMONS-MAIN-002-*` quest.
   * It stayed the spec's 4th requirement type throughout; only its corpus membership changed.
   */
  ReqIsSchool: 'Imcodec.ObjectProperty.TypeCache.ReqIsSchool, Imcodec.ObjectProperty',

  // --- dialog (blocks, entries, madlib arguments) ------------------------------
  ActorDialogList: 'Imcodec.ObjectProperty.TypeCache.ActorDialogList, Imcodec.ObjectProperty',
  NPCDialogEntry: 'Imcodec.ObjectProperty.TypeCache.NPCDialogEntry, Imcodec.ObjectProperty',
  /**
   * The **typed** form of a dialog block: measured **5 times**, always as `ResActorDialog`'s
   * `m_dialog`, with `{$type, m_dialogTag, m_dialogEntries, m_madlibs, m_dialogEvents,
   * m_noAggroWhileDialogIsUp, m_noAggroNoDelay}` — the same six value keys an untagged
   * `ActorDialogList.m_dialogs[]` block carries, plus the tag. Absent from the 322-file
   * baseline; modelled by `shared/quest/dialog.ts`'s `ActorDialogSchema`.
   */
  ActorDialog: 'Imcodec.ObjectProperty.TypeCache.ActorDialog, Imcodec.ObjectProperty',
  MadlibArgT_ByteString:
    'Imcodec.ObjectProperty.TypeCache.MadlibArgT_ByteString, Imcodec.ObjectProperty',
} as const;

/**
 * Spec-listed types the corpus does **not** contain — **empty at the owner's `f9a1055`
 * baseline**.
 *
 * The table existed for `ReqIsSchool` (the spec's 4th requirement type,
 * [spec-domain-reference.md] L432-434), which occurred 0 times in the 322 quest files. The
 * 328-file baseline carries it 7 times, so it is now in {@link CORPUS_TYPE_STRINGS} and nothing
 * else was ever spec-only. The export is kept (rather than deleted) so that "the corpus table
 * is exactly the corpus measurement" and "there is no spec-only type at this baseline" are both
 * checkable claims, and so `TYPE_STRINGS` keeps its corpus-then-spec-only reading order.
 */
export const SPEC_ONLY_TYPE_STRINGS = {} as const;

/**
 * Every known `$type` string: the 29 corpus-measured ones (no spec-only type at this
 * baseline). This is the table the criterion-#1 audit checks (`grep ⊆ this`).
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

/**
 * The 15 result `$type`s: the spec's 14 ([spec-domain-reference.md] L354-412) **plus**
 * `ResActorDialog`, which the owner's `f9a1055` baseline carries 5 times and the spec's list
 * does not mention. The spec list stays readable as the first 14 (the union's own order is the
 * reference's, with the corpus-only class appended), and the p3-07 corpus sweep asserts the
 * result table and the corpus's result classes are the same set.
 */
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
  ResActorDialog: TYPE_STRINGS.ResActorDialog,
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

/**
 * Dialog-node `$type`s: the list wrapper, the entry, the **typed block** (`ActorDialog`,
 * measured 5 times as `ResActorDialog.m_dialog` on the owner's baseline) and the madlib
 * argument.
 */
export const DIALOG_TYPES = {
  ActorDialogList: TYPE_STRINGS.ActorDialogList,
  NPCDialogEntry: TYPE_STRINGS.NPCDialogEntry,
  ActorDialog: TYPE_STRINGS.ActorDialog,
  MadlibArgT_ByteString: TYPE_STRINGS.MadlibArgT_ByteString,
} as const;

/* ---------------------------------------------------------------------- enums */

/**
 * The 7 `m_goalType` values measured across all 328 quests (re-measured at `f9a1055`; the
 * 322-file counts are in the parentheses): `GOAL_TYPE_PERSONA` 429 (405),
 * `GOAL_TYPE_WAYPOINT` 183 (194), `GOAL_TYPE_BOUNTYCOLLECT` 89 (96), `GOAL_TYPE_SCAVENGE`
 * 36 (43), `GOAL_TYPE_ACHIEVERANK` 26 (26), `GOAL_TYPE_BOUNTY` 18 (4), `GOAL_TYPE_USAGE`
 * 15 (4) — 796 goal types over 796 goals (was 772).
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
 * defined). Re-measured at `f9a1055`: `ROP_AND` on 691 of the 698 operator-carrying nodes and
 * **`ROP_OR` on 7** — the 322-file baseline had `ROP_OR` on 0 of 673, so the second member is
 * no longer a wire-format formality: the corpus exercises it. Both are enum members either way.
 */
export const REQUIREMENT_OPERATORS = ['ROP_AND', 'ROP_OR'] as const;

/** `m_operator` value. */
export type RequirementOperator = (typeof REQUIREMENT_OPERATORS)[number];

/** The 7 magic schools ([spec-domain-reference.md] L430) — all 7 measured, 3× each (21 nodes);
 * plus 1 more each as `ReqIsSchool.m_magicSchoolName` on the owner's baseline. */
export const MAGIC_SCHOOLS = ['Fire', 'Ice', 'Storm', 'Balance', 'Life', 'Death', 'Myth'] as const;

/** `m_magicSchool` value. */
export type MagicSchool = (typeof MAGIC_SCHOOLS)[number];

/**
 * The distinct `m_dialogTag` values measured across 774 dialog blocks at `f9a1055`:
 * `Completion` 442, `Prep` 322, the empty string 5 and **`Hyperlink` 5** (the 322-file
 * baseline had 739 blocks: `Completion` 418, `Prep` 316, empty 5). The tag is deliberately
 * **not** an enum: the corpus proves tags outside `Prep`/`Completion` exist (`Hyperlink` is one,
 * and D53(b) records 4 quest-level tags outside the pair among the 141 quests the synthetic
 * capture generator refused) — a closed enum would reject documents the game itself ships.
 */
export const KNOWN_DIALOG_TAGS = ['Prep', 'Completion', 'Hyperlink', ''] as const;
