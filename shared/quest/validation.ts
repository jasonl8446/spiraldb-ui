/**
 * The quest validation engine — plan task 3.9 (story p3-09).
 *
 * **Pure by contract**: a document in, structured findings out. No React, no `json5`, no
 * SQLite, no `server/` import, no UI copy. The friendly-name tables the reference rules need
 * are **injected** ([spec-domain-reference.md] L542-546), because `shared/` cannot reach the
 * database and the client gets its rows from `GET /api/names/:type` (D39 item 3's bulk names).
 * The same module is imported by the client (through `@shared/*`) and by the server (through
 * the compiled relative path), so "the server re-runs the same rule validation" is one
 * implementation, not two (plan §3.9).
 *
 * The rules come from [spec-domain-reference.md] L525-546, split by what the corpus shows:
 *
 * | kind | severity | rule (spec line) | real corpus findings |
 * |---|---|---|---|
 * | `quest-name-missing` | error | `m_questName` must be non-empty (L528) | **0** — fixture-only UI path |
 * | `start-goal-unknown` | error | `m_startGoals` must reference existing goal names (L529) | **0** — fixture-only (this is AC1's own example) |
 * | `duplicate-goal-name` | error | every goal must have a unique `m_goalName` (L530) | **0** — fixture-only |
 * | `goal-logic-not-completing` | error | the final goal-logic entry needs `m_completeQuest: true` (L532) | **0** — fixture-only |
 * | `unknown-type` | error | every `$type` must be valid per the 3.1 table (L533) | **0** — fixture-only |
 * | `template-id-not-positive` | error | TemplateID fields are positive integers (L543) | **0** — fixture-only |
 * | `goal-unreachable` | **warning** | goal logic must be reachable from start goals (L531) | **5 quests / 35 goals** |
 * | `zone-not-known` | **warning** | zone paths must match synced zones (L544) | **94 occurrences** |
 * | `reference-not-known` | **warning** | item/spell/NPC refs warn when unknown (L545) | **0** under the dual-source rule (see below) |
 *
 * Counts measured 2026-09-26 across all **322** `QuestTemplates/*.json` of the real SpiralDB
 * checkout plus the live tables (`zones` 1,241 / `npcs` 23,033 / `spells` 18,173 /
 * `drop_tables` 317 / `quests` 322 / `items` 79,835 rows); `tests/unit/quest-validation.test.ts`
 * re-runs the whole sweep against the checkout whenever it is on disk.
 *
 * **Six of the nine kinds have zero corpus instances**, so their inline-error / Save-disabled
 * UI paths are proven by fixtures (unit) and by the direct `POST` (server 400), never by a
 * real quest. The reachability and zone findings are the two kinds real data exercises — the
 * 94 zone warnings are where "unknown reference warns and does not block" is real.
 *
 * ## The two severity decisions this engine makes, and why
 *
 * The spec prints the quest rules and the general rules as unqualified "must"s and shows
 * "warns but does not block" only for item/spell/NPC references (L545). Two of the other
 * rules are nevertheless published as **warnings** here, because the shipped corpus itself
 * violates them and blocking a document the game accepts is the worse failure:
 *
 * 1. **`goal-unreachable` is a warning.** L531 lists reachability under "Quest Validation
 *    (before save)", but **5 of 322 shipped quests** fail it (`WC-CYCLOPS-MAIN-002` 6 stranded
 *    goals, `WC-TRITON-MAIN-008` 4, `WC-TUT-C03-001` 19, `WC-TUT-C05-001` 5, `WC-TUT-C08-001`
 *    1), and p3-05 already presents the same finding as the flowchart's **warning** banner
 *    ([spec-ui-design.md] L384, D61(d) `BANNER_FINDING_KINDS`). Blocking it would make those
 *    five corpus quests permanently unsaveable through this tool for a rule the game ships
 *    violations of. The finding kind is deliberately the same shape as the flowchart's
 *    `disconnected-goal`, and the two share **one** fixpoint ({@link goalLogicReachability});
 *    only their severities differ by surface (banner = warning, Save gate = additive).
 * 2. **`zone-not-known` is a warning** even though L544 says "must match known zones": 94 real
 *    occurrences across 4 fields are interior zone variants (`DragonSpire/DS_A3_Kings/Interiors/…`)
 *    that the 1,241-row `zones` table does not carry, and D60(c) already decided an unlisted
 *    zone path **stays displayed and selected** rather than being rejected. Same reasoning;
 *    the id is kept verbatim (validate-never-normalise, D57).
 *
 * ## Measured details that are load-bearing
 *
 * - **`TemplateID` fields are not uniformly positive.** The corpus's `m_actorTemplateID` carries
 *   `0` in **330** of 1,706 dialog entries and `m_walkAwayNpcTemplateID` carries `0` in **1,675**
 *   of 1,706 (D64(f) records `0` = "none" for the walk-away field). A literal "must be positive"
 *   would raise **2,005** false findings against the corpus, so those two fields admit `0`
 *   (`min: 0`) while the result-node id fields (`m_templateID`, `m_spellID` — 42 and 10
 *   occurrences, all ≥ 35,528) stay `min: 1`. The rule still fires for a non-integer, a
 *   negative, or a `0` on a `min: 1` field.
 * - **`ResDrawHand.m_templateID` belongs to two tables (D63(c)).** Its 8 distinct corpus values
 *   resolve **6 in `spells` and 2 in `npcs`, none in both**, while the domain reference calls it
 *   an NPC field. Its field entry therefore declares **both** sources and resolves if the value
 *   is in *either*; an NPC-only reading would emit 6 false positives against the corpus. This is
 *   the one field with more than one source.
 * - **Empty strings are "no value", not a miss.** `m_destinationZone` is `''` in 423 of 773
 *   corpus occurrences, `m_cameraZoneName` in 840 of 1,706, `m_zoneTag` in 67 of 194: an empty
 *   string is skipped by every reference rule (it names nothing).
 * - **Quests carry no item id at all.** 0 of the 79,835 `items.gid` values appear anywhere in
 *   the 322 quests (`m_itemTotal` is a count, `m_goalNameID`/`m_questNameID`/`m_spawnID`/
 *   `m_transitionID` are not template ids), so the AC's "unknown item ID" arm is exercised by
 *   the spell/NPC/drop-table/quest name references and by fixtures — never by a quest's item
 *   field, which does not exist.
 * - **A missing `$type` is not this engine's job.** D56(b)'s Zod schemas already reject a goal
 *   with no `$type` at the request boundary; `unknown-type` covers a `$type` that is *present*
 *   and not in the 3.1 table (a string the table does not know, or a non-string value).
 * - **The DropTable rules (L536-541: `Name` non-empty and unique, `RollChance`/`NoneChance`
 *   ranges, `MinGold ≤ MaxGold`) are deliberately out of scope here** — they validate
 *   `DropTables/*.json`, not a quest, and belong to the Phase-4 DropTable editor. This module is
 *   shaped so they can be added as their own entry point without touching the quest rules.
 *
 * Findings are **data**: `kind`, `severity`, the exact document `path` (so a per-field error map
 * keeps the field path), the offending `value` verbatim, and the reference namespace / goal name
 * a sentence may need. The words live in `shared/quest/validation-messages.ts`, which is the one
 * copy table both the client's inline messages and the server's 400 body use — this module
 * returns no sentence (D61(d)'s split, and the engine must never bake the UI's copy).
 */

import type { DocPath } from '../document.js';
import { KNOWN_TYPE_STRINGS, shortTypeName } from './typeConstants.js';

/* --------------------------------------------------------------------- types */

/** How bad a finding is. Only `error` blocks a save (L547: "Save button disabled while validation errors exist"). */
export type ValidationSeverity = 'error' | 'warning';

/** Every finding kind this engine emits, one per rule. */
export type QuestFindingKind =
  /** `m_questName` is not a non-empty string (L528). */
  | 'quest-name-missing'
  /** A `m_startGoals` entry names no goal of `m_goals` (L529) — AC1's example. */
  | 'start-goal-unknown'
  /** A `m_goalName` is absent, or shared by two goals (L530). */
  | 'duplicate-goal-name'
  /** The final `m_goalLogic` entry does not carry `m_completeQuest: true` (L532). */
  | 'goal-logic-not-completing'
  /** A present `$type` is not in the 3.1 constant table (L533). */
  | 'unknown-type'
  /** A TemplateID field is not an integer of at least its declared minimum (L543). */
  | 'template-id-not-positive'
  /** A goal of `m_goals` cannot be reached from `m_startGoals` (L531) — warning, see the header. */
  | 'goal-unreachable'
  /** A zone path is not in the injected `zones` table (L544) — warning, see the header. */
  | 'zone-not-known'
  /** An item/spell/NPC/quest reference is not in its injected table (L545) — warning. */
  | 'reference-not-known';

/** The friendly-name namespaces a reference field may resolve in. */
export type ReferenceNamespace = 'zones' | 'npcs' | 'spells' | 'drop_tables' | 'quests';

/** One structured finding. Never a sentence, never a bare string. */
export interface QuestFinding {
  kind: QuestFindingKind;
  severity: ValidationSeverity;
  /** The exact document path of the offending field, node or array element. */
  path: DocPath;
  /** The offending value, verbatim (never a normalised copy). */
  value: unknown;
  /**
   * Which table was searched, for `reference-not-known`. Absent on every other kind.
   * A dual-source field reports only after **both** tables miss.
   */
  namespace?: ReferenceNamespace;
  /**
   * The tables a dual-source field searched (`['spells','npcs']` for `ResDrawHand.m_templateID`),
   * so a sentence can say "in spells or npcs". Only present when more than one was searched.
   */
  searchedNamespaces?: readonly ReferenceNamespace[];
  /** The goal a goal finding is about — absent for a goal whose `m_goalName` does not exist. */
  goalName?: string;
  /**
   * The lowest integer the field accepts, for `template-id-not-positive` only: `1` for a
   * positively-typed id, `0` for the two dialog fields where the corpus measures `0` = "none".
   */
  minimum?: number;
  /** A one-line machine-friendly detail. **Not** the UI's copy. */
  detail: string;
}

/** The injected friendly-name tables. An **absent** namespace disables that reference rule. */
export interface QuestValidationReferences {
  /** `zones.zone_path` values, e.g. `WizardCity/WC_Hub`. */
  zones?: ReadonlySet<string>;
  /** `npcs.template_id`, stringified (the engine compares `String(value)`). */
  npcs?: ReadonlySet<string>;
  /** `spells.template_id`, stringified. */
  spells?: ReadonlySet<string>;
  /** `drop_tables.name`. */
  drop_tables?: ReadonlySet<string>;
  /** `quests.quest_name`. */
  quests?: ReadonlySet<string>;
}

export interface QuestValidationOptions {
  /**
   * The friendly-name tables the reference rules consult. Omitted (or a namespace omitted)
   * means "this side cannot check that namespace" — the reference rules skip rather than
   * reporting every value as unknown. The server always injects all five.
   */
  references?: QuestValidationReferences;
}

export interface QuestValidationResult {
  /** Every finding, in walk order (quest rules first, then document-order field findings). */
  findings: QuestFinding[];
  /** The findings the Save gate follows (`severity: 'error'`). */
  blocking: QuestFinding[];
  /** The non-blocking findings (`severity: 'warning'`). */
  warnings: QuestFinding[];
  /** `true` when at least one blocking finding exists — the Save gate's own boolean. */
  blocked: boolean;
}

/* ------------------------------------------------------------------ readers */

/** `true` for a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `container[key]` — `undefined` for a non-object container. */
function member(container: unknown, key: string): unknown {
  return isPlainObject(container) ? container[key] : undefined;
}

/** The `m_goals` array of a document, or `[]`. */
function goalsOf(document: unknown): unknown[] {
  const value = member(document, 'm_goals');
  return Array.isArray(value) ? value : [];
}

/**
 * A goal's `m_goalName` as a non-empty string, or `null`. Byte-for-byte the rule
 * `client/src/lib/quest-goals.ts`'s `goalName` applies (the graph's identity), restated here
 * because `shared/` cannot import the client module.
 */
export function goalNameOf(goal: unknown): string | null {
  const name = member(goal, 'm_goalName');
  return typeof name === 'string' && name !== '' ? name : null;
}

/** The `m_startGoals` value as a name list — `[]` for a missing or non-array value. */
function startGoalValues(document: unknown): unknown[] {
  const value = member(document, 'm_startGoals');
  return Array.isArray(value) ? value : [];
}

/** One `m_goalLogic` entry's name-list field, as strings. */
function entryNames(entry: unknown, key: string): string[] {
  const value = member(entry, key);
  return Array.isArray(value)
    ? value.filter((name): name is string => typeof name === 'string')
    : [];
}

/** The `m_goalLogic` array of a document, or `[]`. */
function goalLogicEntries(document: unknown): unknown[] {
  const value = member(document, 'm_goalLogic');
  return Array.isArray(value) ? value : [];
}

/* ------------------------------------------------------- goal logic reachability */

/**
 * The reachability fixpoint over `m_goalLogic` — **the one implementation**, shared by the
 * flowchart's banner (`client/src/lib/quest-goal-logic.ts`'s `validateGoalLogic`, story p3-05)
 * and this engine's `goal-unreachable` rule. p3-05's algorithm was lifted here verbatim rather
 * than re-derived, so the banner and the Save gate can never disagree about which goals are
 * stranded.
 *
 * Semantics ([spec-domain-reference.md] L340-351, L531): an entry *fires* once every
 * `m_goalsAND` name is reachable **and** at least `m_requiredORCount` of its `m_goalsOR` names
 * are (a missing/`null` count reads as `0`; an empty OR list is vacuously satisfied; a count
 * above the OR list's length can never be met, so that entry never fires). Firing adds the
 * entry's known `m_goalsToAdd` names, and the loop repeats until the set stops growing.
 *
 * **The no-logic reading, stated.** The seed is `m_startGoals` ∩ the named goals of `m_goals`,
 * and every named goal outside the closure is unreachable. A quest with goals but **no**
 * `m_startGoals` (or none that name a goal) therefore reports *all* of its goals, and a quest
 * with start goals but no `m_goalLogic` at all reports every non-start goal — the domain
 * reference's literal "no disconnected nodes" reading. That is what the corpus exercises:
 * **all 5** failing quests have an empty `m_startGoals`, so the two cases coincide there and
 * no special case is invented. A document with no named goals reports nothing (nothing to
 * reach), and a quest whose `m_startGoals` name every goal reports nothing.
 */
export interface GoalLogicReachability {
  /** Every named goal, in `m_goals` order (unique). */
  goalNames: string[];
  /** The reachable names, in `m_goals` order. */
  reachable: string[];
  /** The unreachable names, in `m_goals` order — one `goal-unreachable` finding each. */
  unreachable: string[];
  /** `true` when some firing entry with `m_completeQuest: true` is reachable. */
  completeReachable: boolean;
}

export function goalLogicReachability(document: unknown): GoalLogicReachability {
  const goalNames: string[] = [];
  const known = new Set<string>();
  for (const goal of goalsOf(document)) {
    const name = goalNameOf(goal);
    if (name !== null && !known.has(name)) {
      known.add(name);
      goalNames.push(name);
    }
  }

  const entries = goalLogicEntries(document);
  const reachable = new Set<string>(
    startGoalValues(document).filter(
      (name): name is string => typeof name === 'string' && known.has(name),
    ),
  );

  let completeReachable = false;
  // At most one entry can add something per pass, so entries.length passes are enough to
  // reach the fixpoint; the `grew` flag makes the common case stop far earlier.
  for (let pass = 0; pass <= entries.length; pass += 1) {
    let grew = false;
    for (const entry of entries) {
      const andNames = entryNames(entry, 'm_goalsAND');
      const orNames = entryNames(entry, 'm_goalsOR');
      const required = member(entry, 'm_requiredORCount');
      const threshold = typeof required === 'number' && Number.isFinite(required) ? required : 0;
      const ready =
        andNames.every((name) => reachable.has(name)) &&
        (orNames.length === 0 || threshold <= orNames.filter((name) => reachable.has(name)).length);
      if (!ready) {
        continue;
      }
      if (member(entry, 'm_completeQuest') === true) {
        completeReachable = true;
      }
      for (const name of entryNames(entry, 'm_goalsToAdd')) {
        if (known.has(name) && !reachable.has(name)) {
          reachable.add(name);
          grew = true;
        }
      }
    }
    if (!grew) {
      break;
    }
  }

  return {
    goalNames,
    reachable: goalNames.filter((name) => reachable.has(name)),
    unreachable: goalNames.filter((name) => !reachable.has(name)),
    completeReachable,
  };
}

/* ------------------------------------------------------- the reference field table */

/**
 * One reference field: the key, the node types that own it, the tables it may resolve in, and
 * the integer rule the TemplateID clause needs.
 *
 * `types` is the corpus-measured owner set (all 322 quests, 2026-09-26) and is deliberately
 * exhaustive rather than `null`/"any": the root quest object carries `m_questName` and
 * `m_zoneName`-shaped keys of its own, and checking those against the tables would report a
 * brand-new quest as an unknown reference to itself.
 */
export interface ReferenceFieldSpec {
  /** The document key. */
  key: string;
  /** The short `$type` names of the nodes this key belongs to. */
  types: readonly string[];
  /** The tables a value may resolve in. More than one = the dual-source field (D63(c)). */
  sources: readonly ReferenceNamespace[];
  /** The key's value domain, which decides how a value is compared. */
  valueType: 'number' | 'string';
  /**
   * The smallest integer the id rule accepts: `1` = a positive id, `0` = `0` is the measured
   * "none" sentinel. `null` when the field is not an integer id field (`m_tableName`).
   */
  min: number | null;
}

/**
 * Every reference/integer-id field a quest carries. Measured owner sets and resolutions are in
 * the module header; the corpus's totals are asserted by the unit test.
 */
export const REFERENCE_FIELDS: readonly ReferenceFieldSpec[] = [
  // --- result-node template ids (all positive in the corpus) ---------------------
  {
    key: 'm_templateID',
    types: ['ResLearnSpell', 'ResAddSpell'],
    sources: ['spells'],
    valueType: 'number',
    min: 1,
  },
  {
    key: 'm_templateID',
    types: ['ResGiveSpell', 'ResDespawn'],
    sources: ['npcs'],
    valueType: 'number',
    min: 1,
  },
  {
    // D63(c): 6 of the 8 corpus values resolve in `spells`, 2 in `npcs`, none in both — a
    // single-source reading emits 6 false positives against the corpus's own data.
    key: 'm_templateID',
    types: ['ResDrawHand'],
    sources: ['spells', 'npcs'],
    valueType: 'number',
    min: 1,
  },
  {
    key: 'm_spellID',
    types: ['ResGiveSpell'],
    sources: ['spells'],
    valueType: 'number',
    min: 1,
  },
  // --- dialog template ids (`0` is the measured "none", 330 + 1,675 occurrences) --
  {
    key: 'm_actorTemplateID',
    types: ['NPCDialogEntry'],
    sources: ['npcs'],
    valueType: 'number',
    min: 0,
  },
  {
    key: 'm_walkAwayNpcTemplateID',
    types: ['NPCDialogEntry'],
    sources: ['npcs'],
    valueType: 'number',
    min: 0,
  },
  // --- drop-table name (the plan's own ID-referencing field on ResDropTable) ------
  {
    key: 'm_tableName',
    types: ['ResDropTable'],
    sources: ['drop_tables'],
    valueType: 'string',
    min: null,
  },
  // --- zone paths (94 real misses: interior variants of the 1,241 synced zones) --
  {
    key: 'm_destinationZone',
    types: [
      'WaypointGoalTemplate',
      'PersonaGoalTemplate',
      'BountyGoalTemplate',
      'ScavengeGoalTemplate',
      'AchieveRankGoalTemplate',
      'ResTeleport',
    ],
    sources: ['zones'],
    valueType: 'string',
    min: null,
  },
  {
    key: 'm_zoneTag',
    types: ['WaypointGoalTemplate'],
    sources: ['zones'],
    valueType: 'string',
    min: null,
  },
  {
    key: 'm_zoneName',
    types: ['ResAddDynaMod'],
    sources: ['zones'],
    valueType: 'string',
    min: null,
  },
  {
    key: 'm_cameraZoneName',
    types: ['NPCDialogEntry'],
    sources: ['zones'],
    valueType: 'string',
    min: null,
  },
  // --- quest-name references (277 ReqHasQuest + 40 ReqHasEntry, all resolving) ----
  {
    key: 'm_questName',
    types: ['ReqHasQuest', 'ReqHasEntry'],
    sources: ['quests'],
    valueType: 'string',
    min: null,
  },
];

/** The specs registered for one field key, or `[]`. */
const FIELDS_BY_KEY: ReadonlyMap<string, readonly ReferenceFieldSpec[]> = (() => {
  const map = new Map<string, ReferenceFieldSpec[]>();
  for (const spec of REFERENCE_FIELDS) {
    const list = map.get(spec.key);
    if (list === undefined) {
      map.set(spec.key, [spec]);
    } else {
      list.push(spec);
    }
  }
  return map;
})();

/* ------------------------------------------------------------------ the engine */

/** A `$type` value that is a known table entry never is an `unknown-type` finding. */
function isKnownTypeString(value: unknown): boolean {
  return typeof value === 'string' && KNOWN_TYPE_STRINGS.includes(value);
}

/** `true` when `value` is a finite integer at least `min` (a type guard, so callers can compare). */
function isIntegerAtLeast(value: unknown, min: number): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= min
  );
}

/** The spec that applies to a scalar field, or `undefined`. */
function specFor(key: string, typeName: string | null): ReferenceFieldSpec | undefined {
  const specs = FIELDS_BY_KEY.get(key);
  if (specs === undefined || typeName === null) {
    return undefined;
  }
  return specs.find((spec) => spec.types.includes(typeName));
}

/**
 * Validates one quest document. Never mutates it (D57: validate, never normalise) — every
 * reader here is a read, and the findings hold references to the original values.
 *
 * Order of findings: the six quest rules first (in spec order), then the document-order walk
 * that produces the general rules. A caller that wants one severity uses
 * {@link QuestValidationResult.blocking} / `.warnings`.
 */
export function validateQuest(
  document: unknown,
  options: QuestValidationOptions = {},
): QuestValidationResult {
  const findings: QuestFinding[] = [];
  const references = options.references ?? {};

  const error = (finding: Omit<QuestFinding, 'severity'>): void => {
    findings.push({ ...finding, severity: 'error' });
  };
  const warn = (finding: Omit<QuestFinding, 'severity'>): void => {
    findings.push({ ...finding, severity: 'warning' });
  };

  /* --- quest rule 1: m_questName must be non-empty (L528) ---------------------- */
  const questName = member(document, 'm_questName');
  if (typeof questName !== 'string' || questName.trim() === '') {
    error({
      kind: 'quest-name-missing',
      path: ['m_questName'],
      value: questName,
      detail: 'm_questName is missing, not a string, or empty',
    });
  }

  /* --- quest rule 2: m_startGoals must reference existing goal names (L529) --- */
  const goalNameSet = new Set<string>();
  for (const goal of goalsOf(document)) {
    const name = goalNameOf(goal);
    if (name !== null) {
      goalNameSet.add(name);
    }
  }

  startGoalValues(document).forEach((entry, index) => {
    if (typeof entry === 'string' && goalNameSet.has(entry)) {
      return;
    }
    error({
      kind: 'start-goal-unknown',
      path: ['m_startGoals', index],
      value: entry,
      detail: `m_startGoals[${index}] does not name a goal of m_goals`,
    });
  });

  /* --- quest rule 3: every goal has a unique m_goalName (L530) ---------------- */
  // One finding per occurrence after the first carrier of a name: the first goal keeps the
  // canonical identity, and every later one gets an inline error at its own `m_goalName`.
  const indicesByName = new Map<string, number[]>();
  const goals = goalsOf(document);
  goals.forEach((goal, index) => {
    const name = goalNameOf(goal);
    if (name === null) {
      error({
        kind: 'duplicate-goal-name',
        path: ['m_goals', index, 'm_goalName'],
        value: member(goal, 'm_goalName'),
        detail: `m_goals[${index}] has no usable m_goalName`,
      });
      return;
    }
    const indices = indicesByName.get(name);
    if (indices === undefined) {
      indicesByName.set(name, [index]);
    } else {
      indices.push(index);
    }
  });
  for (const [name, indices] of indicesByName) {
    for (const index of indices.slice(1)) {
      error({
        kind: 'duplicate-goal-name',
        path: ['m_goals', index, 'm_goalName'],
        value: name,
        goalName: name,
        detail: `Goal name "${name}" is also used by m_goals[${indices[0]}]`,
      });
    }
  }

  /* --- quest rule 4: the final goal-logic entry completes the quest (L532) --- */
  const entries = goalLogicEntries(document);
  if (entries.length > 0) {
    const lastIndex = entries.length - 1;
    if (member(entries[lastIndex], 'm_completeQuest') !== true) {
      error({
        kind: 'goal-logic-not-completing',
        path: ['m_goalLogic', lastIndex, 'm_completeQuest'],
        value: member(entries[lastIndex], 'm_completeQuest'),
        detail: `The final m_goalLogic entry (index ${lastIndex}) does not carry m_completeQuest: true`,
      });
    }
  }

  /* --- the general rules, in document order --------------------------------- */
  walkScalars(document, (node) => {
    /* rule: a present $type must be in the 3.1 table (L533) */
    if (node.key === '$type' && !isKnownTypeString(node.value)) {
      error({
        kind: 'unknown-type',
        path: node.path,
        value: node.value,
        detail: `$type ${JSON.stringify(node.value)} is not in the 3.1 constant table`,
      });
    }

    const spec = specFor(node.key, node.typeName);
    if (spec === undefined) {
      return;
    }

    /* rule: TemplateID fields are integers of at least their declared minimum (L543) */
    if (spec.min !== null && !isIntegerAtLeast(node.value, spec.min)) {
      error({
        kind: 'template-id-not-positive',
        path: node.path,
        value: node.value,
        minimum: spec.min,
        detail:
          spec.min === 1
            ? `${node.key} must be a positive integer`
            : `${node.key} must be a non-negative integer (0 means none)`,
      });
      return;
    }

    /* rules: zone paths and item/spell/NPC/quest references warn, never block (L544-545) */
    const namespaces = spec.sources.filter((namespace) => references[namespace] !== undefined);
    if (namespaces.length === 0) {
      return;
    }
    const raw = node.value;
    let candidate: string;
    if (spec.valueType === 'number') {
      if (typeof raw !== 'number' || !Number.isInteger(raw)) {
        // A non-integer here is the id rule's finding (or nothing when the field has no id
        // rule); a reference rule never double-reports a value it cannot name.
        return;
      }
      if (raw === 0 && spec.min === 0) {
        return; // the measured "none" sentinel
      }
      candidate = String(raw);
    } else {
      if (typeof raw !== 'string' || raw === '') {
        return; // '' names nothing (423 empty m_destinationZone occurrences)
      }
      candidate = raw;
    }
    if (namespaces.some((namespace) => references[namespace]?.has(candidate) === true)) {
      return;
    }
    const namespace = namespaces[0];
    warn({
      kind: namespace === 'zones' ? 'zone-not-known' : 'reference-not-known',
      path: node.path,
      value: raw,
      namespace,
      ...(namespaces.length > 1 ? { searchedNamespaces: namespaces } : {}),
      detail: `${node.key} value ${JSON.stringify(raw)} is not in the ${namespaces.join(' or ')} table`,
    });
  });

  /* --- quest rule 5: reachability from start goals (L531, warning) ----------- */
  const reachability = goalLogicReachability(document);
  const unreachable = new Set(reachability.unreachable);
  goalsOf(document).forEach((goal, index) => {
    const name = goalNameOf(goal);
    if (name === null || !unreachable.has(name)) {
      return;
    }
    warn({
      kind: 'goal-unreachable',
      path: ['m_goals', index],
      value: name,
      goalName: name,
      detail: `Goal "${name}" is not reachable from m_startGoals`,
    });
  });

  return {
    findings,
    blocking: findings.filter((finding) => finding.severity === 'error'),
    warnings: findings.filter((finding) => finding.severity === 'warning'),
    blocked: findings.some((finding) => finding.severity === 'error'),
  };
}

/* --------------------------------------------------------------- document walk */

/** One scalar (or `$type`) occurrence the walker hands to the rules. */
export interface WalkedValue {
  /** The exact document path of this value. */
  path: DocPath;
  /** The key this value sits under (`$type` for a type annotation). */
  key: string;
  /** The value verbatim. */
  value: unknown;
  /**
   * The short name of the nearest enclosing **known** `$type`. `null` at the root and inside
   * an unknown/absent `$type` — the field table then does not apply, and an unknown `$type` is
   * already its own blocking finding.
   */
  typeName: string | null;
}

/**
 * Walks every scalar of the document (objects, arrays and the `$type` annotations included),
 * handing each to `visit` with its exact path and its nearest enclosing known type.
 * Read-only: it builds no copy and mutates nothing.
 *
 * Exported for the evidence API (task 6.6, `server/src/services/questEvidence.ts`), which must
 * resolve `REFERENCE_FIELDS` against **the same walk** the Save gate uses — a second walker would
 * let the panel and the validator disagree about which node owns a field, and the owner set is
 * exactly what decides whether a reference exists at all (`ReferenceFieldSpec.types`).
 */
export function walkScalars(document: unknown, visit: (node: WalkedValue) => void): void {
  function walk(value: unknown, path: DocPath, enclosing: string | null): void {
    if (Array.isArray(value)) {
      value.forEach((element, index) => walk(element, [...path, index], enclosing));
      return;
    }
    if (isPlainObject(value)) {
      const declared = value.$type;
      const own = typeof declared === 'string' ? (shortTypeName(declared) ?? enclosing) : enclosing;
      if (Object.prototype.hasOwnProperty.call(value, '$type')) {
        visit({ path: [...path, '$type'], key: '$type', value: declared, typeName: own });
      }
      for (const [key, child] of Object.entries(value)) {
        if (key === '$type') {
          continue;
        }
        walk(child, [...path, key], own);
      }
      return;
    }
    const key = path.length === 0 ? '' : path[path.length - 1];
    visit({ path, key: typeof key === 'string' ? key : '', value, typeName: enclosing });
  }

  walk(document, [], null);
}
