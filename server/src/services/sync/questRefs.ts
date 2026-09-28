import type { Db } from '../../db.js';

/**
 * Quest reference + id-link extractor — task 6.3
 * ([plan-phase-6-quest-catalog.md](../../../../docs/plan-phase-6-quest-catalog.md) L227–235).
 *
 * Consumes task 6.2's NDJSON (`wad-scan extract`, one compact row per selected entry:
 * `{wad, entry, class, hash, object}`) and produces, per quest name, the referencing
 * `{wad, entry, class}` provenance, the goal gates that reference it, and the id link —
 * direct (`m_entryName` + `m_displayName`) or inferred from anchored neighbours (P6-11).
 *
 * Pure: the only inputs are the parsed rows, an injected {@link QuestIdLookups}, and
 * optionally injected anchor pairs. **No database, no file system, no clock** — so every unit
 * test injects fakes ([quest_refs_sample.ndjson](../../../test/fixtures/quest_refs_sample.ndjson)
 * holds the committed real rows). {@link createQuestIdLookups} is the one DB-backed adapter and
 * takes the connection as an argument; it is never constructed here.
 *
 * ## Measured on this host (2026-09-28, `/tmp/p6/lead-extract2.ndjson`, 6,733 rows)
 *
 * | Reading | Result |
 * |---|---|
 * | Nested nodes carrying any quest field | **5,282** (3,003 with a non-empty `m_questName`, 1,754 empty-string, 525 key-absent) |
 * | Distinct quest names (`m_questName` non-empty) | **1,447** |
 * | Names with a goal name + `m_requiredStatus` | **873** |
 * | Direct pairs (`m_entryName` `_Complete` + `m_displayName` an existing `QuestTitle_*` key) | **313 rows / 286 names** |
 * | … of which the name is not in the 1,447 set | 2 (`KM-KCITY-MAIN-012`, `KM-BLACK-MAIN-001`) |
 * | Nodes nested under a zone payload with a `$type` | **0** — the requirement class is not serialized |
 *
 * ## Three readings the NDJSON forces, and how this module handles them
 *
 * 1. **The requirement class is inferred from the key set, never read.** No nested node carries
 *    `$type` (0 of 5,282), so {@link questRequirementClass} names a node `ReqHasEntry` when it
 *    carries the entry trio (`m_entryName`/`m_displayName`/`m_isQuestRegistry`) and `ReqHasQuest`
 *    when it carries `m_questName` without it — the key sets the repo's own taxonomy declares
 *    ([requirements.ts](../../../../shared/quest/requirements.ts) L25-26). `class` on every row
 *    is the **NDJSON row's** class (`WizZoneData`/`WizZoneTriggers`) — the provenance triple ac1
 *    asks for — and `requirement_class` + `requirement_keys` carry the nested object's identity
 *    without inventing a name for a key set the repo does not name.
 * 2. **`m_displayName` is not always a key.** 423 pair rows carry a non-empty `m_displayName`;
 *    313 of them are `QuestTitle_*`, **110 are literal title text** ("To Tame a Tempest" ×20).
 *    Only the 313 whose **exact key exists** in the string table are direct links — the criterion
 *    that yields ac1's 286. (Measured separately, 83 of the 84 literal names *would* resolve
 *    through a `QuestTitle_*` **value** lookup; that second path is not this story's criterion and
 *    is deliberately not taken here — see the story report.)
 * 3. **A `ReqHasEntry` row is not a quest reference.** It doubles as the global-registry check
 *    (`m_entryName: "Halloween"`, `m_questName: ""`), so ac3 counts it as a **registry check** and
 *    it is never emitted as a reference. The direct link *is* read from those rows (that is where
 *    `m_entryName` + `m_displayName` live) — so the 423 direct-pair rows are **inside** the
 *    registry-check count (2,279 measured: 1,754 with `m_questName: ""` + 525 with no key), which
 *    is the intended reading of ac3: counted, never emitted as a reference.
 *
 * ## One row shape the writer must know about
 *
 * References are per **referencing object**, not per file: 3,003 measured rows collapse to 2,796
 * distinct `(quest_name, wad, entry, class, goal_name)` tuples — 207 rows share a tuple with
 * another row (a zone repeats one requirement object in several places; the worst repeats four
 * times). That is exactly the spec's `UNIQUE(quest_name, wad, entry, class, goal_name)`, so the
 * catalog stage must insert idempotently (p6-05's job). `duplicate_references` in the report is
 * this number, and it is why a raw row count is not the table's row count.
 *
 * ## The id link
 *
 * `direct` — the pair's `m_displayName` is a `QuestTitle_*` key that exists. `inferred` — the name
 * has a preceding **and** a following anchor in its {@link questGroupKey} group, and the
 * neighbours' midpoint id has a `QuestTitle_*` key **and** a non-empty `WizQst<id>_*` table; the
 * row then carries {@link QuestIdLink.basis}, which names both anchors and both conditions.
 * Anchors are the direct links plus any `options.anchors` (the sync's corpus `(name, id)` pairs —
 * the corpus stage runs first, so passing them in is what makes a world-only name inferable).
 * A rejected candidate emits **no** link (`kind: 'none'`) and is counted in the result.
 */

/* ------------------------------------------------------------------ inputs */

/** One NDJSON row as `wad-scan extract` writes it (`hash` is not consulted here). */
export interface QuestRefSourceRow {
  wad: string;
  entry: string;
  class: string;
  object?: unknown;
}

/**
 * The id-tier lookups, injected. The three methods exist because the string table's spelling is
 * **not derivable from the id**: the 5,959 `QuestTitle_*` keys map to 5,959 distinct ids and both
 * `QuestTitle_1ED8D` and `QuestTitle_00002173` are stored keys, while `QuestTitle_2173` and
 * `QuestTitle_0001ED8D` do not exist (measured 0 rows each). An id→key resolver is therefore the
 * only honest way to answer "does the candidate id have a `QuestTitle_*` key".
 */
export interface QuestIdLookups {
  /** Exact stored-key test — `'QuestTitle_1ED8D'`, the spelling as written. */
  hasTitleKey(key: string): boolean;
  /** The stored `QuestTitle_*` key for a numeric id, or `null` when the id has none. */
  titleKeyFor(questId: number): string | null;
  /** Rows in the quest's own `WizQst<id>_*` tables — `0` when the table is absent or empty. */
  countQuestTextRows(questId: number): number;
}

/** A known `(name, id)` pair the interpolation may anchor on (the sync's corpus rows). */
export interface QuestIdPair {
  quest_name: string;
  quest_id: number;
}

/* ------------------------------------------------------------------ output */

/** The requirement classes the repo names; assigned by key set (the NDJSON carries no `$type`). */
export type QuestRequirementClass = 'ReqHasQuest' | 'ReqHasEntry';

/** How a quest's id was obtained. `none` is a name the world references without any link. */
export type QuestLinkKind = 'direct' | 'inferred' | 'none';

/** The referencing object's identity — the `{wad, entry, class}` provenance ac1 requires. */
export interface QuestRefProvenance {
  /** WAD file path as the NDJSON row names it. */
  wad: string;
  /** Entry inside the WAD (`gamedata.bin` / `triggers.xml`). */
  entry: string;
  /** The NDJSON row's class (`WizZoneData` / `WizZoneTriggers`) — never empty, never invented. */
  class: string;
  /** The nested requirement object's class, inferred from its key set. */
  requirement_class: QuestRequirementClass;
  /** The quest-relevant keys the nested object actually carries, sorted — its honest description. */
  requirement_keys: string[];
}

/** One world reference to a quest, with the goal gate it carries when it has one. */
export interface QuestRefRow extends QuestRefProvenance {
  goal_name: string | null;
  required_status: string | null;
}

/** A distinct `(m_goalName, m_requiredStatus)` gate on a quest's references. */
export interface QuestGoalGate {
  goal_name: string;
  required_status: string;
}

/** The quest's id link. `basis` is non-null only for `inferred` (p6-04-ac2). */
export interface QuestIdLink {
  kind: QuestLinkKind;
  quest_id: number | null;
  title_key: string | null;
  basis: string | null;
}

/** One catalog row: a world-named quest, its references, its goal gates, and its id link. */
export interface QuestCatalogRecord {
  quest_name: string;
  references: QuestRefRow[];
  goal_names: QuestGoalGate[];
  link: QuestIdLink;
}

/**
 * ac3's registry checks: `ReqHasEntry`-shaped nodes whose `m_questName` is empty. The criterion's
 * wording covers the explicit empty string; the key-absent shape (525 nodes, all
 * `m_entryName` + `m_numericValue`) is counted **separately** so a reader can choose.
 */
export interface QuestRegistryChecks {
  total: number;
  /** `m_questName: ""` — the shape ac3's wording names. */
  empty_quest_name: number;
  /** No `m_questName` key at all. */
  absent_quest_name: number;
  /** How many of `total` carry a non-empty `m_entryName` (the registry-entry shape). */
  with_entry_name: number;
}

export interface QuestRefsResult {
  /** One record per catalog name, sorted by `quest_name` for a deterministic sync write. */
  records: QuestCatalogRecord[];
  registry_checks: QuestRegistryChecks;
  /** Nested nodes that carry any quest field — 5,282 on the measured tree. */
  nodes_scanned: number;
  /** `_Complete` rows whose `m_displayName` is non-empty (423 measured). */
  direct_candidates: number;
  /** `_Complete` rows accepted as direct pairs (313 measured). */
  direct_pairs: number;
  /** Names whose **only** world trace is a direct-link row (2 measured: `KM-KCITY-MAIN-012`, `KM-BLACK-MAIN-001`). */
  link_only_names: number;
  /** Names an id was established for (direct links + injected anchors). */
  anchored_names: number;
  /** Names with both a before- and an after-neighbour in their group — the interpolation candidates. */
  inference_gaps: number;
  /** Candidates whose midpoint id failed one of the two conditions (no link emitted). */
  inference_rejected: number;
  /** A name seen with two different ids — a corpus conflict, counted rather than silently won. */
  link_conflicts: number;
}

/* ------------------------------------------------------------------ constants */

/**
 * The keys that make a nested node a requirement node, and the ones whose presence is recorded as
 * `requirement_keys`. The last four are the world's extras (`m_goalName`/`m_requiredStatus` are the
 * goal gate; `m_numericValue`/`m_operatorType`/`m_value` describe the entry-value shape).
 */
export const REQUIREMENT_KEYS = [
  'm_questName',
  'm_goalName',
  'm_requiredStatus',
  'm_entryName',
  'm_displayName',
  'm_isQuestRegistry',
  'm_applyNOT',
  'm_operator',
  'm_quest',
  'm_numericValue',
  'm_operatorType',
  'm_value',
] as const;

/** The suffix a quest-completion registry row carries on `m_entryName`. */
export const QUEST_COMPLETE_SUFFIX = '_Complete';

/** The key prefix of a quest title in the string table. */
export const QUEST_TITLE_PREFIX = 'QuestTitle_';

/** The named hold-out protocol (see {@link computeHoldoutAccuracy}). */
export const HOLD_OUT_METHOD = 'neighbour-midpoint';

/** The named inference protocol (see {@link extractQuestRefs}). */
export const INFERENCE_METHOD = 'neighbour-midpoint';

/* ------------------------------------------------------------------ helpers */

function stringField(node: Record<string, unknown>, key: string): string | null {
  const value = node[key];
  return typeof value === 'string' ? value : null;
}

/** Every plain object in a payload, depth-first, arrays included. */
function walkObjects(node: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (node === null || typeof node !== 'object') {
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      walkObjects(item, visit);
    }
    return;
  }
  const record = node as Record<string, unknown>;
  visit(record);
  for (const value of Object.values(record)) {
    walkObjects(value, visit);
  }
}

/**
 * The nested requirement object's class, from its key set.
 *
 * Measured: **0 of 5,282** quest-bearing nodes carry `$type`, so the class cannot be read. The two
 * key sets the repo's taxonomy declares are disjoint in the real tree (`ReqHasEntry` carries the
 * entry trio, `ReqHasQuest` only `m_questName` + the operator pair), which is what makes this safe:
 * a node with any of the entry trio is `ReqHasEntry`, any other quest node is `ReqHasQuest`.
 */
export function questRequirementClass(node: Record<string, unknown>): QuestRequirementClass {
  const entryShaped =
    'm_entryName' in node || 'm_displayName' in node || 'm_isQuestRegistry' in node;
  return entryShaped ? 'ReqHasEntry' : 'ReqHasQuest';
}

/** The quest-relevant keys present on a node, sorted. */
export function requirementKeys(node: Record<string, unknown>): string[] {
  return REQUIREMENT_KEYS.filter((key) => key in node).sort();
}

/**
 * `'QuestTitle_00002173'` → `0x2173`, or `null` when the text is not a safe-integer hex id.
 *
 * Two of the 5,959 stored keys are 11 and 14 hex digits — beyond `Number.MAX_SAFE_INTEGER` — and
 * get `null` here rather than a rounded number that could collide with another id.
 */
export function parseQuestTitleKey(key: string): number | null {
  if (!key.startsWith(QUEST_TITLE_PREFIX)) {
    return null;
  }
  const token = key.slice(QUEST_TITLE_PREFIX.length);
  if (!/^[0-9a-fA-F]+$/.test(token)) {
    return null;
  }
  const questId = Number.parseInt(token, 16);
  return Number.isSafeInteger(questId) ? questId : null;
}

/**
 * The quest's **group** key: the name up to its last `-<digits>` suffix
 * (`AQ-GARD-C01-002` → `AQ-GARD-C01`).
 *
 * Measured against the corpus, this is the grouping under which sibling ids are contiguous:
 * 59 groups hold ≥ 2 known pairs, 51 of them ascend with name order and 38 are fully contiguous —
 * the fingerprint the findings doc records (51/59, 38/59), which is what makes a neighbour
 * interpolation defensible rather than a guess.
 */
export function questGroupKey(questName: string): string {
  const match = /^(.*)-\d+$/.exec(questName);
  return match?.[1] ?? questName;
}

/* ------------------------------------------------------------------ extraction */

export interface ExtractQuestRefsOptions {
  /**
   * Extra `(name, id)` anchors — the sync passes its corpus rows here. Direct links always win a
   * name they already claimed; an injected pair never overwrites one.
   */
  anchors?: readonly QuestIdPair[];
}

/**
 * The streaming collector: `add` walks **one** NDJSON row, `finish` resolves the links.
 *
 * Streaming matters: the real NDJSON is 97.7 MB across 6,733 rows, so neither the file nor a
 * materialised array of its parsed rows is held in memory by the caller
 * ([quest-refs-report.ts](../../../../scripts/quest-refs-report.ts) feeds it line by line).
 * `extractQuestRefs` is the array-in convenience wrapper over the same collector.
 */
export class QuestRefsCollector {
  private readonly references = new Map<string, QuestRefRow[]>();
  private readonly goals = new Map<string, Map<string, QuestGoalGate>>();
  /** `<name>_Complete` rows with a non-empty `m_displayName`; the lookup runs in `finish`. */
  private readonly directRows: Array<{ name: string; titleKey: string }> = [];
  private readonly registry: QuestRegistryChecks = {
    total: 0,
    empty_quest_name: 0,
    absent_quest_name: 0,
    with_entry_name: 0,
  };
  private nodesScanned = 0;
  private directCandidates = 0;

  /** Walks one row's payload depth-first and records every quest-bearing node it holds. */
  add(row: QuestRefSourceRow): void {
    const provenance = { wad: row.wad, entry: row.entry, class: row.class };

    walkObjects(row.object, (node) => {
      const questName = stringField(node, 'm_questName');
      const entryName = stringField(node, 'm_entryName') ?? '';
      const displayName = stringField(node, 'm_displayName') ?? '';
      const hasQuestNameKey = 'm_questName' in node;
      const entryShaped =
        'm_entryName' in node || 'm_displayName' in node || 'm_isQuestRegistry' in node;

      if (!hasQuestNameKey && !entryShaped) {
        return;
      }
      this.nodesScanned += 1;

      if (questName !== null && questName !== '') {
        const goalName = stringField(node, 'm_goalName');
        const requiredStatus = stringField(node, 'm_requiredStatus');
        const carriesGate = goalName !== null && goalName !== '' && requiredStatus !== null;
        const reference: QuestRefRow = {
          ...provenance,
          requirement_class: questRequirementClass(node),
          requirement_keys: requirementKeys(node),
          goal_name: carriesGate ? goalName : null,
          required_status: carriesGate ? requiredStatus : null,
        };
        const list = this.references.get(questName);
        if (list === undefined) {
          this.references.set(questName, [reference]);
        } else {
          list.push(reference);
        }
        if (carriesGate) {
          const gates = this.goals.get(questName) ?? new Map<string, QuestGoalGate>();
          gates.set(`${goalName}\u0000${requiredStatus}`, {
            goal_name: goalName,
            required_status: requiredStatus,
          });
          this.goals.set(questName, gates);
        }
      } else {
        // ac3: a ReqHasEntry row with an empty/absent m_questName is a registry check.
        this.registry.total += 1;
        if (hasQuestNameKey) {
          this.registry.empty_quest_name += 1;
        } else {
          this.registry.absent_quest_name += 1;
        }
        if (entryName !== '') {
          this.registry.with_entry_name += 1;
        }
      }

      // The only direct name->id path: <QuestName>_Complete + a QuestTitle_* key that exists.
      // The key lookup is deferred to `finish`, so `add` never touches the injected lookups —
      // one database round trip per candidate would otherwise sit inside the walk.
      if (!entryName.endsWith(QUEST_COMPLETE_SUFFIX) || displayName === '') {
        return;
      }
      this.directCandidates += 1;
      this.directRows.push({
        name: entryName.slice(0, -QUEST_COMPLETE_SUFFIX.length),
        titleKey: displayName,
      });
    });
  }

  /**
   * Resolves the id links and returns the catalog.
   *
   * The **catalog name set** is the union of the names a reference carries (`m_questName`
   * non-empty — ac1's 1,447) and the names a direct pair carries (ac1's 286, of which 2 are not in
   * the 1,447: `KM-KCITY-MAIN-012`, `KM-BLACK-MAIN-001`). The second set is included because the
   * world *names* those quests; the spec's `nameable` is `count(*)` on `quests` and is `>= 1,447`
   * for exactly this reason ([spec-data-model.md](../../../../docs/spec-data-model.md) L193-197).
   */
  finish(lookups: QuestIdLookups, options: ExtractQuestRefsOptions = {}): QuestRefsResult {
    const { references, goals } = this;

    // Direct pairs: the row's m_displayName must be an existing QuestTitle_* key (exact spelling).
    const directLinks = new Map<string, { questId: number; titleKey: string }>();
    let directPairs = 0;
    let linkConflicts = 0;
    for (const candidate of this.directRows) {
      if (!candidate.titleKey.startsWith(QUEST_TITLE_PREFIX)) {
        continue;
      }
      if (!lookups.hasTitleKey(candidate.titleKey)) {
        continue;
      }
      const questId = parseQuestTitleKey(candidate.titleKey);
      if (questId === null) {
        continue;
      }
      directPairs += 1;
      const existing = directLinks.get(candidate.name);
      if (existing === undefined) {
        directLinks.set(candidate.name, { questId, titleKey: candidate.titleKey });
      } else if (existing.titleKey !== candidate.titleKey) {
        linkConflicts += 1;
      }
    }

    // Anchors: direct links first (they are measured from the same NDJSON), then injected pairs.
    const anchors = new Map<string, QuestIdPair>();
    for (const [name, link] of directLinks) {
      anchors.set(name, { quest_name: name, quest_id: link.questId });
    }
    for (const pair of options.anchors ?? []) {
      if (!anchors.has(pair.quest_name)) {
        anchors.set(pair.quest_name, pair);
      }
    }

    // Anchors grouped by quest group, sorted by name — the interpolation's neighbourhood.
    const anchorsByGroup = new Map<string, QuestIdPair[]>();
    for (const anchor of anchors.values()) {
      const group = questGroupKey(anchor.quest_name);
      const list = anchorsByGroup.get(group);
      if (list === undefined) {
        anchorsByGroup.set(group, [anchor]);
      } else {
        list.push(anchor);
      }
    }
    for (const list of anchorsByGroup.values()) {
      list.sort((a, b) => compareText(a.quest_name, b.quest_name));
    }

    const names = new Set<string>(references.keys());
    for (const name of directLinks.keys()) {
      names.add(name);
    }

    let inferenceGaps = 0;
    let inferenceRejected = 0;
    let linkOnlyNames = 0;

    const records: QuestCatalogRecord[] = [];
    for (const questName of [...names].sort()) {
      const recordReferences = (references.get(questName) ?? []).slice().sort(compareReferences);
      const gates = goals.get(questName);

      let link: QuestIdLink;
      const direct = directLinks.get(questName);
      if (direct !== undefined) {
        link = {
          kind: 'direct',
          quest_id: direct.questId,
          title_key: direct.titleKey,
          basis: null,
        };
      } else {
        const inferred = inferQuestId(questName, anchorsByGroup, lookups);
        if (inferred.attempted) {
          inferenceGaps += 1;
          if (inferred.link === null) {
            inferenceRejected += 1;
          }
        }
        link = inferred.link ?? NO_LINK;
      }

      if (recordReferences.length === 0) {
        linkOnlyNames += 1;
      }

      records.push({
        quest_name: questName,
        references: recordReferences,
        goal_names: gates === undefined ? [] : [...gates.values()].sort(compareGates),
        link,
      });
    }

    return {
      records,
      registry_checks: this.registry,
      nodes_scanned: this.nodesScanned,
      direct_candidates: this.directCandidates,
      direct_pairs: directPairs,
      link_only_names: linkOnlyNames,
      anchored_names: anchors.size,
      inference_gaps: inferenceGaps,
      inference_rejected: inferenceRejected,
      link_conflicts: linkConflicts,
    };
  }
}

/** The array-in convenience wrapper: collects every row, then resolves the links. */
export function extractQuestRefs(
  rows: Iterable<QuestRefSourceRow>,
  lookups: QuestIdLookups,
  options: ExtractQuestRefsOptions = {},
): QuestRefsResult {
  const collector = new QuestRefsCollector();
  for (const row of rows) {
    collector.add(row);
  }
  return collector.finish(lookups, options);
}

function compareReferences(a: QuestRefRow, b: QuestRefRow): number {
  return (
    compareText(a.wad, b.wad) ||
    compareText(a.entry, b.entry) ||
    compareText(a.class, b.class) ||
    compareText(a.goal_name ?? '', b.goal_name ?? '')
  );
}

function compareGates(a: QuestGoalGate, b: QuestGoalGate): number {
  return compareText(a.goal_name, b.goal_name) || compareText(a.required_status, b.required_status);
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The basis of an inferred link: both anchors, the candidate, and the two conditions it passed.
 *
 * Deterministic `JSON.stringify` over a fixed key order — the string a unit test pins and the
 * evidence the spec's `quest_ids.inference_basis` column stores
 * ([spec-data-model.md](../../../../docs/spec-data-model.md) L206-212).
 */
export function formatInferenceBasis(input: {
  group: string;
  before: QuestIdPair;
  after: QuestIdPair;
  candidate: number;
  titleKey: string;
  textRows: number;
}): string {
  return JSON.stringify({
    method: INFERENCE_METHOD,
    group: input.group,
    before: { quest_name: input.before.quest_name, quest_id: input.before.quest_id },
    after: { quest_name: input.after.quest_name, quest_id: input.after.quest_id },
    candidate_id: input.candidate,
    conditions: { title_key: input.titleKey, text_rows: input.textRows },
  });
}

const NO_LINK: QuestIdLink = { kind: 'none', quest_id: null, title_key: null, basis: null };

/**
 * The interpolation for one name.
 *
 * Protocol, in full: the name's group is {@link questGroupKey}; its neighbourhood is the anchors in
 * that group ordered by name; the candidate is the **midpoint** `floor((before.id + after.id) / 2)`
 * of the nearest anchor before and the nearest anchor after. It is accepted only when the candidate
 * id has a `QuestTitle_*` key **and** a non-empty `WizQst` table (p6-04-ac2). A name with a
 * neighbour on only one side is **not** extrapolated — `attempted` stays false and the record keeps
 * `kind: 'none'`, because the measured protocol interpolates between anchors and never beyond them.
 */
function inferQuestId(
  questName: string,
  anchorsByGroup: Map<string, QuestIdPair[]>,
  lookups: QuestIdLookups,
): { attempted: boolean; link: QuestIdLink | null } {
  const siblings = anchorsByGroup.get(questGroupKey(questName));
  if (siblings === undefined) {
    return { attempted: false, link: null };
  }

  let before: QuestIdPair | null = null;
  let after: QuestIdPair | null = null;
  for (const anchor of siblings) {
    if (anchor.quest_name < questName) {
      before = anchor;
    } else if (anchor.quest_name > questName) {
      after = anchor;
      break;
    } else {
      // The name itself is an anchor; the direct path in `finish` already answered it.
      return { attempted: false, link: null };
    }
  }
  if (before === null || after === null) {
    return { attempted: false, link: null };
  }

  const candidate = Math.floor((before.quest_id + after.quest_id) / 2);
  const titleKey = lookups.titleKeyFor(candidate);
  if (titleKey === null) {
    return { attempted: true, link: null };
  }
  const textRows = lookups.countQuestTextRows(candidate);
  if (textRows === 0) {
    return { attempted: true, link: null };
  }

  return {
    attempted: true,
    link: {
      kind: 'inferred',
      quest_id: candidate,
      title_key: titleKey,
      basis: formatInferenceBasis({
        group: questGroupKey(questName),
        before,
        after,
        candidate,
        titleKey,
        textRows,
      }),
    },
  };
}

/* ------------------------------------------------------------------ hold-out */

export interface HoldoutOptions {
  /** The corpus the pairs came from — always named, the phase's rule for two corpora. */
  corpus?: string | null;
  /**
   * Optional lookups. When supplied, the report also counts how many held-out cases the
   * **accept rule** (key + non-empty table) would have kept, and how many of those were hits —
   * the figure the sync's inferred links actually carry.
   */
  lookups?: QuestIdLookups;
}

export interface HoldoutReport {
  corpus: string | null;
  method: typeof HOLD_OUT_METHOD;
  /** Distinct `(name, id)` pairs the corpus supplied. */
  pairs: number;
  /** Groups holding ≥ 2 pairs — the fingerprint the findings doc records as 59. */
  groups: number;
  /** Groups holding ≥ 3 pairs (a middle element exists). */
  groups_with_gap: number;
  /** Groups whose ids ascend with name order. */
  groups_ascending: number;
  /** Groups whose ids are fully contiguous. */
  groups_contiguous: number;
  /** Held-out elements: every element with both neighbours in its group. */
  cases: number;
  hits: number;
  misses: number;
  /** `hits / cases`, or 0 for zero cases. */
  accuracy: number;
  /** Cases whose interpolated candidate passes the accept rule (with `lookups`), else `cases`. */
  accepted_cases: number;
  /** Hits among `accepted_cases`. */
  accepted_hits: number;
}

/**
 * The hold-out: how well the interpolation predicts an id it was not shown.
 *
 * Protocol, named and complete: the known `(name, id)` pairs are grouped by {@link questGroupKey};
 * within each group ordered by name, every element that has **both** a preceding and a following
 * element is held out (so a group of *n* contributes *n − 2* cases); its id is interpolated as the
 * midpoint of its two neighbours' ids; a case is a **hit** when the interpolated id equals the
 * held-out id exactly. The accuracy is raw interpolation accuracy — the accept rule is *not*
 * applied to it (the doc's "the misses are outliers that also pollute their anchors" is why the
 * accept rule exists), but the accepted subset is reported alongside when lookups are supplied.
 *
 * Measured under this protocol (2026-09-28): **59 groups, 51 ascending, 38 contiguous, 168 cases,
 * 131 hits = 78.0%** on both corpora (the owner fork's 321 pairs and the D17 clone's 315) — the
 * findings doc's structural fingerprint **exactly** (59 / 51 / 38) and its **37 misses exactly**.
 *
 * Its `128 hit / 37 miss of 165` is `+3` hits and `-3` cases from this protocol's result. The
 * residual is reported, not tuned away: the 165-case set *is* reproducible by a different
 * restriction — hold out only cases whose two **anchors** both have a non-empty `WizQst` table —
 * but that restriction yields 34 misses, and applying the accept rule to the *candidate* yields
 * 136 cases / 131 hits. So the doc's case count and its miss count are each reachable, under two
 * different restrictions, and no single restriction reproduces both. 78% is reproduced.
 */
export function computeHoldoutAccuracy(
  pairs: readonly QuestIdPair[],
  options: HoldoutOptions = {},
): HoldoutReport {
  const distinct = new Map<string, number>();
  for (const pair of pairs) {
    if (!distinct.has(pair.quest_name)) {
      distinct.set(pair.quest_name, pair.quest_id);
    }
  }

  const groups = new Map<string, QuestIdPair[]>();
  for (const [quest_name, quest_id] of distinct) {
    const group = questGroupKey(quest_name);
    const list = groups.get(group);
    if (list === undefined) {
      groups.set(group, [{ quest_name, quest_id }]);
    } else {
      list.push({ quest_name, quest_id });
    }
  }
  for (const list of groups.values()) {
    list.sort((a, b) => compareText(a.quest_name, b.quest_name));
  }

  let groupCount = 0;
  let groupsWithGap = 0;
  let groupsAscending = 0;
  let groupsContiguous = 0;
  let cases = 0;
  let hits = 0;
  let acceptedCases = 0;
  let acceptedHits = 0;

  for (const list of groups.values()) {
    if (list.length < 2) {
      continue;
    }
    groupCount += 1;
    let ascending = true;
    let contiguous = true;
    for (let index = 1; index < list.length; index += 1) {
      const previous = list[index - 1];
      const current = list[index];
      if (previous === undefined || current === undefined) {
        continue;
      }
      if (current.quest_id <= previous.quest_id) {
        ascending = false;
      }
      if (current.quest_id !== previous.quest_id + 1) {
        contiguous = false;
      }
    }
    if (ascending) {
      groupsAscending += 1;
    }
    if (contiguous) {
      groupsContiguous += 1;
    }
    if (list.length < 3) {
      continue;
    }
    groupsWithGap += 1;
    for (let index = 1; index < list.length - 1; index += 1) {
      const before = list[index - 1];
      const held = list[index];
      const after = list[index + 1];
      if (before === undefined || held === undefined || after === undefined) {
        continue;
      }
      cases += 1;
      const candidate = Math.floor((before.quest_id + after.quest_id) / 2);
      const hit = candidate === held.quest_id;
      if (hit) {
        hits += 1;
      }
      if (options.lookups === undefined) {
        acceptedCases += 1;
        if (hit) {
          acceptedHits += 1;
        }
        continue;
      }
      const titleKey = options.lookups.titleKeyFor(candidate);
      if (titleKey !== null && options.lookups.countQuestTextRows(candidate) > 0) {
        acceptedCases += 1;
        if (hit) {
          acceptedHits += 1;
        }
      }
    }
  }

  return {
    corpus: options.corpus ?? null,
    method: HOLD_OUT_METHOD,
    pairs: distinct.size,
    groups: groupCount,
    groups_with_gap: groupsWithGap,
    groups_ascending: groupsAscending,
    groups_contiguous: groupsContiguous,
    cases,
    hits,
    misses: cases - hits,
    accuracy: cases === 0 ? 0 : hits / cases,
    accepted_cases: acceptedCases,
    accepted_hits: acceptedHits,
  };
}

/* ------------------------------------------------------------------ report */

export interface QuestRefsReport {
  corpus: string | null;
  /** ac1's "1,447 distinct quest names": names carrying at least one reference. */
  distinct_quest_names: number;
  /** Catalog rows emitted — the 1,447 plus the direct-link-only names (2 measured). */
  catalog_rows: number;
  /** ac1's 286. */
  direct_links: number;
  inferred_links: number;
  no_link: number;
  /** ac1's 873. */
  with_goal_names: number;
  references: number;
  /** Distinct `(quest_name, wad, entry, class, goal_name)` tuples — the table's UNIQUE key. */
  reference_keys: number;
  /** Rows beyond that count, which the UNIQUE absorbs on insert (207 measured). */
  duplicate_references: number;
  /** ac1's "0 rows without provenance" — a reference missing `wad`, `entry` or `class`. */
  rows_without_provenance: number;
  registry_checks: QuestRegistryChecks;
  nodes_scanned: number;
  direct_candidates: number;
  direct_pairs: number;
  link_only_names: number;
  anchored_names: number;
  inference_gaps: number;
  inference_rejected: number;
  link_conflicts: number;
  holdout: HoldoutReport | null;
}

export interface SummarizeOptions {
  corpus?: string | null;
  holdout?: HoldoutReport | null;
}

/** The numbers ac1/ac2 name, in one place, for p6-05's sync to report. */
export function summarizeQuestRefs(
  result: QuestRefsResult,
  options: SummarizeOptions = {},
): QuestRefsReport {
  let references = 0;
  let rowsWithoutProvenance = 0;
  const referenceKeys = new Set<string>();
  let withGoalNames = 0;
  let directLinks = 0;
  let inferredLinks = 0;
  let noLink = 0;
  let distinctQuestNames = 0;

  for (const record of result.records) {
    references += record.references.length;
    if (record.references.length > 0) {
      distinctQuestNames += 1;
    }
    if (record.goal_names.length > 0) {
      withGoalNames += 1;
    }
    if (record.link.kind === 'direct') {
      directLinks += 1;
    } else if (record.link.kind === 'inferred') {
      inferredLinks += 1;
    } else {
      noLink += 1;
    }
    for (const reference of record.references) {
      if (reference.wad === '' || reference.entry === '' || reference.class === '') {
        rowsWithoutProvenance += 1;
      }
      referenceKeys.add(
        [
          record.quest_name,
          reference.wad,
          reference.entry,
          reference.class,
          reference.goal_name ?? '',
        ].join('\u0000'),
      );
    }
  }

  return {
    corpus: options.corpus ?? null,
    distinct_quest_names: distinctQuestNames,
    catalog_rows: result.records.length,
    direct_links: directLinks,
    inferred_links: inferredLinks,
    no_link: noLink,
    with_goal_names: withGoalNames,
    references,
    reference_keys: referenceKeys.size,
    duplicate_references: references - referenceKeys.size,
    rows_without_provenance: rowsWithoutProvenance,
    registry_checks: result.registry_checks,
    nodes_scanned: result.nodes_scanned,
    direct_candidates: result.direct_candidates,
    direct_pairs: result.direct_pairs,
    link_only_names: result.link_only_names,
    anchored_names: result.anchored_names,
    inference_gaps: result.inference_gaps,
    inference_rejected: result.inference_rejected,
    link_conflicts: result.link_conflicts,
    holdout: options.holdout ?? null,
  };
}

/* ------------------------------------------------------------------ the DB adapter */

/**
 * The string-table adapter — the only place this module touches a database, and the connection is
 * passed in. Both indexes are loaded **once, lazily**, on first use: 5,959 `QuestTitle_*` keys and
 * 66,203 `WizQst*` rows, which is cheaper than one `LIKE` scan per candidate.
 *
 * The `WizQst` index is keyed by the **numeric** id parsed from the table name, so
 * `countQuestTextRows` answers for `WizQst<hex>_*` in any case. The four non-numeric tables in the
 * corpus (`WizQstFire`, `WizQstIce`, `WizQstLife`, `WizQstBGH`) have no numeric id and are not
 * reachable by id — measured 4,823 numeric ids of the 4,830 tables.
 *
 * Read-only by construction: it issues `SELECT`s only, so it is safe against the live database.
 */
export function createQuestIdLookups(db: Db): QuestIdLookups {
  let titleKeys: Map<number, string> | null = null;
  let textRows: Map<number, number> | null = null;

  const loadTitleKeys = (): Map<number, string> => {
    if (titleKeys === null) {
      titleKeys = new Map();
      const statement = db.prepare(
        "SELECT key FROM string_table WHERE key LIKE 'QuestTitle\\_%' ESCAPE '\\'",
      );
      for (const row of statement.all() as Array<{ key: string }>) {
        const questId = parseQuestTitleKey(row.key);
        if (questId !== null && !titleKeys.has(questId)) {
          titleKeys.set(questId, row.key);
        }
      }
    }
    return titleKeys;
  };

  const loadTextRows = (): Map<number, number> => {
    if (textRows === null) {
      textRows = new Map();
      const statement = db.prepare("SELECT key FROM string_table WHERE key LIKE 'WizQst%'");
      for (const row of statement.all() as Array<{ key: string }>) {
        const match = /^WizQst([0-9A-Fa-f]+)_/.exec(row.key);
        if (match === null) {
          continue;
        }
        const questId = Number.parseInt(match[1] ?? '', 16);
        if (!Number.isSafeInteger(questId)) {
          continue;
        }
        textRows.set(questId, (textRows.get(questId) ?? 0) + 1);
      }
    }
    return textRows;
  };

  return {
    hasTitleKey: (key) => {
      const questId = parseQuestTitleKey(key);
      return questId !== null && loadTitleKeys().get(questId) === key;
    },
    titleKeyFor: (questId) => loadTitleKeys().get(questId) ?? null,
    countQuestTextRows: (questId) => loadTextRows().get(questId) ?? 0,
  };
}
