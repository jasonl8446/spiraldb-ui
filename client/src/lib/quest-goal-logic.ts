/**
 * The Goal Logic tab's model: the graph, the dagre layout, the validator and every edit
 * builder behind the flowchart (plan task 3.5, story p3-05; docs/spec-ui-design.md L344-385,
 * docs/spec-domain-reference.md L336-351 and L528-534).
 *
 * Like `lib/quest-goals.ts` this module is **data and rules, not JSX and not React**: it has
 * no React import (the component adapts these structures to React Flow) and the only runtime
 * dependency is `dagre`, which {@link layoutGoalLogicGraph} calls. That split is what lets
 * the graph, the layout, the validator and the edit builders be unit-tested in the node
 * environment while the canvas renders them.
 *
 * **Measured corpus facts this model is built on** (all 322 `QuestTemplates/*.json` of the
 * real `/home/jason/Documents/git-projects/spiraldb/` checkout, 742 entries in 307 quests;
 * measured 2026-09-26 and re-measured from this story):
 *
 * - Every one of the 742 entries carries **exactly the same five keys, in the same order**:
 *   `m_goalsAND`, `m_goalsOR`, `m_goalsToAdd`, `m_completeQuest`, `m_requiredORCount`. There
 *   are no sparse entries — the opposite of the goals array, where 13 of 772 goals are sparse
 *   ({@link newGoalLogicEntry} therefore writes the whole five-key shape, which is *not* the
 *   padding D57 forbids: that rule is about an **existing** object's missing keys, and an
 *   insert has no existing object).
 * - `m_requiredORCount` is `1` in all 742 entries, so that is a new entry's default.
 * - `m_goalsOR` is **empty in every entry** (742 of 742) and `m_goalsAND` holds exactly one
 *   name in 741 of 742 (the 742nd holds five): the real corpus is a linear AND chain. The
 *   OR path therefore has **zero corpus instances** — the dashed OR edge, the
 *   multi-prerequisite entry and the `m_requiredORCount > 1` case are **synthetic but
 *   representable**, provable only from a fixture written by hand. The graph builder is
 *   written from the documented semantics (docs/spec-domain-reference.md L336-351) rather
 *   than from the measured shape, and the unit tests label which of their cases are
 *   fixture-only.
 * - 307 entries carry `m_completeQuest: true` — exactly one per quest that has logic, and each
 *   of those 307 has an empty `m_goalsToAdd`: the chain's last entry depends on the final goal
 *   and completes the quest. No completing entry in the corpus has an empty condition list.
 * - Zero entries reference a goal name absent from `m_goals`, so an unknown-reference finding
 *   is only reachable from edited or hand-written data.
 * - **`m_goalLogic` itself can be absent** (2 of the 322 files in the D17 clone carry no such
 *   key; 0 of the real checkout's do) **or explicit `null`**, and 15 quests carry `[]`. The tab
 *   therefore never injects `m_goalLogic: []` on mount (D57: a key that is absent stays
 *   absent); {@link addGoalLogicEntryEdits} is the only thing that creates the key, and it only
 *   runs because the user asked for an entry.
 *
 * Two semantic rules the graph and the validator share, straight from the domain reference
 * ([spec-domain-reference.md] L340-351): an entry means *"when every `m_goalsAND` goal and at
 * least `m_requiredORCount` of the `m_goalsOR` goals are complete, activate every
 * `m_goalsToAdd` goal"*, and `m_completeQuest: true` means *"satisfying this entry finishes the
 * quest"*. So an edge is directed **prerequisite → activated goal**, one edge per prerequisite
 * name (solid for AND, dashed for OR), and a completing entry adds an edge into the special
 * Complete node.
 *
 * **The banner's verbatim string is deliberately not here.** The model returns structured
 * {@link GoalLogicFinding}s; the UI owns the copy (docs/spec-ui-design.md L384). A model that
 * returned a display string could not be unit-tested per finding kind, and a UI that compared
 * finding kinds by string would break silently on a reword.
 */

import * as dagre from 'dagre';

import type { DocEdit, DocPath } from '@shared/document';

import {
  goalBadgeClass,
  goalName,
  goalShortTypeName,
  goalSummaryLines,
  startGoalNames,
  toggleStartGoalEdits,
  type GoalSummaryLine,
} from './quest-goals';

/* ------------------------------------------------------------------ constants */

/** The document key holding the goal-logic chain. */
export const GOAL_LOGIC_PATH = 'm_goalLogic';

/** The five keys every corpus entry carries, in the corpus's own order. */
export const GOAL_LOGIC_ENTRY_KEYS: readonly string[] = [
  'm_goalsAND',
  'm_goalsOR',
  'm_goalsToAdd',
  'm_completeQuest',
  'm_requiredORCount',
];

/** The three editable name-list fields of an entry, in the inspector's order. */
export const GOAL_LOGIC_NAME_FIELDS: readonly string[] = [
  'm_goalsAND',
  'm_goalsOR',
  'm_goalsToAdd',
];

/**
 * The id of the synthetic Complete node. It is namespaced so a goal literally named
 * `goal-logic:complete` cannot collide with it.
 */
export const COMPLETE_NODE_ID = 'goal-logic:complete';

/** The Complete node's label — the spec's own wording (docs/spec-ui-design.md L372). */
export const COMPLETE_NODE_LABEL = '✓ Complete';

/** The node id prefix every goal node carries — see {@link COMPLETE_NODE_ID}. */
export const GOAL_NODE_PREFIX = 'goal:';

/** The canvas node box, in px: what dagre lays out and what the card renders. */
export const NODE_WIDTH = 232;
export const NODE_HEIGHT = 96;

/** The dagre spacing that makes a chain read left-to-right without touching. */
export const LAYOUT_RANK_SEPARATION = 120;
export const LAYOUT_NODE_SEPARATION = 40;

/* ---------------------------------------------------------------------- reads */

/** `true` for a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The `m_goalLogic` array of a document, or `[]` — an absent key, an explicit `null`, a
 * non-array value and an empty array all read as "no entries". This reader never writes: the
 * absent-vs-`null` distinction survives because nothing here replaces the value.
 */
export function goalLogicEntries(document: unknown): unknown[] {
  if (!isPlainObject(document)) {
    return [];
  }
  const value = document[GOAL_LOGIC_PATH];
  return Array.isArray(value) ? value : [];
}

/** `true` when the document carries an `m_goalLogic` key at all (present, whatever its value). */
export function hasGoalLogicKey(document: unknown): boolean {
  return isPlainObject(document) && Object.prototype.hasOwnProperty.call(document, GOAL_LOGIC_PATH);
}

/** The `m_goals` array of a document, or `[]`. */
export function goalsOf(document: unknown): unknown[] {
  if (!isPlainObject(document)) {
    return [];
  }
  const value = document.m_goals;
  return Array.isArray(value) ? value : [];
}

/** The named goals of a document, in `m_goals` order; a goal without a name is skipped. */
export function goalNamesOf(document: unknown): string[] {
  const names: string[] = [];
  for (const goal of goalsOf(document)) {
    const name = goalName(goal);
    if (name !== null) {
      names.push(name);
    }
  }
  return names;
}

/** The `m_goalLogic[i]` path, optionally with the entry's own key appended. */
export function goalLogicEntryPath(index: number, key?: string): DocPath {
  return key === undefined ? [GOAL_LOGIC_PATH, index] : [GOAL_LOGIC_PATH, index, key];
}

/** `entry[key]` — `undefined` for a non-object entry. */
export function goalLogicEntryField(entry: unknown, key: string): unknown {
  return isPlainObject(entry) ? entry[key] : undefined;
}

/** `true` when `entry` carries `key` at all (present with `null` counts as present). */
export function goalLogicEntryHasKey(entry: unknown, key: string): boolean {
  return isPlainObject(entry) && Object.prototype.hasOwnProperty.call(entry, key);
}

/**
 * The names of one entry's name-list field: the strings, in order, with duplicates kept.
 * A missing field, a `null` field or a non-array field reads as `[]` — never as an error,
 * because the tab has to render a hand-edited or legacy entry without throwing.
 */
export function goalLogicEntryNames(entry: unknown, key: string): string[] {
  const value = goalLogicEntryField(entry, key);
  return Array.isArray(value)
    ? value.filter((name): name is string => typeof name === 'string')
    : [];
}

/** One name-list field's raw text (`, `-joined) — what the inspector's input shows. */
export function goalLogicNamesText(entry: unknown, key: string): string {
  return goalLogicEntryNames(entry, key).join(', ');
}

/** The entry's `m_completeQuest` as a boolean (`true` only for a literal `true`). */
export function goalLogicEntryCompletes(entry: unknown): boolean {
  return goalLogicEntryField(entry, 'm_completeQuest') === true;
}

/** The entry's `m_requiredORCount` as a number, or `null` when it is not a finite number. */
export function goalLogicEntryRequiredORCount(entry: unknown): number | null {
  const value = goalLogicEntryField(entry, 'm_requiredORCount');
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * A comma-separated name list as the inspector's inputs write it: trimmed, empty pieces
 * dropped, order and duplicates kept. The same rule `parseClientTags` uses for tag fields
 * (never normalised, never sorted) — an unlisted goal name typed here is kept verbatim, and
 * is what {@link validateGoalLogic}'s unknown-reference finding is written against.
 */
export function parseGoalLogicNames(text: string): string[] {
  return text
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

/**
 * One entry's one-line description for the entry list: `AND → ToAdd`, `OR (n of m) → ToAdd`,
 * with the completing entry marked. Purely for reading; it is not the banner's copy and not a
 * validation result.
 */
export function goalLogicEntrySummary(entry: unknown, index: number): string {
  const and = goalLogicEntryNames(entry, 'm_goalsAND');
  const or = goalLogicEntryNames(entry, 'm_goalsOR');
  const add = goalLogicEntryNames(entry, 'm_goalsToAdd');
  const conditions: string[] = [];
  if (and.length > 0) {
    conditions.push(`AND ${and.join(' + ')}`);
  }
  if (or.length > 0) {
    const required = goalLogicEntryRequiredORCount(entry);
    conditions.push(`OR ${or.join(' | ')} (need ${required === null ? '?' : String(required)})`);
  }
  const completed = goalLogicEntryCompletes(entry) ? ' → ✓ Complete' : '';
  const targets = add.length > 0 ? ` → ${add.join(', ')}` : '';
  return `Entry ${index + 1}: ${conditions.length === 0 ? '(no conditions)' : conditions.join('; ')}${targets}${completed}`;
}

/* ---------------------------------------------------------------------- graph */

/** Which dependency an edge expresses. `'complete'` is the arrow into the Complete node. */
export type GoalLogicEdgeKind = 'and' | 'or' | 'complete';

/** One node of the flowchart: a goal of `m_goals`, or the synthetic Complete node. */
export interface GoalLogicNode {
  id: string;
  kind: 'goal' | 'complete';
  /** The `m_goals` index, or `null` for the Complete node. */
  goalIndex: number | null;
  /** The goal name, or {@link COMPLETE_NODE_LABEL} — what the card's mono header shows. */
  name: string;
  /** The `$type`'s TypeName for a goal (D60h), or `null` when the class is unknown. */
  typeName: string | null;
  /** The spec's type colour class, or the neutral fallback. */
  badgeClass: string;
  /** `true` when the goal's name is in `m_startGoals`. */
  isStart: boolean;
  /** The card's subtitle lines (the same ones the Goals tab renders). */
  summary: GoalSummaryLine[];
}

/** One directed edge: `source` must be satisfied for `target` to be activated. */
export interface GoalLogicEdge {
  id: string;
  source: string;
  target: string;
  kind: GoalLogicEdgeKind;
  /** `true` for an OR dependency — the dashed style the spec pins. */
  dashed: boolean;
  /** The `m_goalLogic` entry this edge came from. */
  entryIndex: number;
  /** Which name of that entry's condition list produced it (its index in the list). */
  listIndex: number;
  /** The prerequisite goal name the edge is drawn from — the element a disconnect removes. */
  sourceName: string;
}

export interface GoalLogicGraph {
  nodes: GoalLogicNode[];
  edges: GoalLogicEdge[];
}

/** The node id of a goal name. */
export function goalNodeId(name: string): string {
  return `${GOAL_NODE_PREFIX}${name}`;
}

/** The goal name encoded in a goal node id, or `null` for the Complete node / an unknown id. */
export function goalNameFromNodeId(id: string): string | null {
  return id.startsWith(GOAL_NODE_PREFIX) ? id.slice(GOAL_NODE_PREFIX.length) : null;
}

/**
 * Builds the flowchart from a document: one node per named goal (in `m_goals` order), one
 * Complete node, and one edge per prerequisite name of every entry.
 *
 * Direction and style come from the entry semantics: every name of `m_goalsAND` and
 * `m_goalsOR` is a prerequisite of every name of `m_goalsToAdd` (one solid edge per AND name,
 * one dashed edge per OR name), and a completing entry additionally makes each prerequisite a
 * prerequisite of the Complete node. An edge is only created when **both** endpoint nodes
 * exist; a reference to an unknown goal is reported by {@link validateGoalLogic} instead of
 * being drawn to a node that does not exist.
 */
export function buildGoalLogicGraph(document: unknown): GoalLogicGraph {
  const goals = goalsOf(document);
  const startNames = startGoalNames(isPlainObject(document) ? document.m_startGoals : undefined);
  const nodes: GoalLogicNode[] = goals.map((goal, index) => {
    const name = goalName(goal);
    return {
      id: name === null ? `${GOAL_NODE_PREFIX}#${index}` : goalNodeId(name),
      kind: 'goal',
      goalIndex: index,
      name: name ?? `Goal ${index + 1}`,
      typeName: goalShortTypeName(goal),
      badgeClass: goalBadgeClass(goal),
      isStart: name !== null && startNames.includes(name),
      summary: goalSummaryLines(goal),
    };
  });

  nodes.push({
    id: COMPLETE_NODE_ID,
    kind: 'complete',
    goalIndex: null,
    name: COMPLETE_NODE_LABEL,
    typeName: null,
    badgeClass: '',
    isStart: false,
    summary: [],
  });

  const known = new Set(nodes.map((node) => node.id));
  const edges: GoalLogicEdge[] = [];
  goalLogicEntries(document).forEach((entry, entryIndex) => {
    const sources: Array<{ name: string; kind: GoalLogicEdgeKind }> = [
      ...goalLogicEntryNames(entry, 'm_goalsAND').map((name) => ({
        name,
        kind: 'and' as const,
      })),
      ...goalLogicEntryNames(entry, 'm_goalsOR').map((name) => ({ name, kind: 'or' as const })),
    ];
    const targets = goalLogicEntryNames(entry, 'm_goalsToAdd').map(goalNodeId);
    if (goalLogicEntryCompletes(entry)) {
      targets.push(COMPLETE_NODE_ID);
    }
    sources.forEach((source, listIndex) => {
      const sourceId = goalNodeId(source.name);
      if (!known.has(sourceId)) {
        return;
      }
      targets.forEach((targetId) => {
        if (!known.has(targetId)) {
          return;
        }
        const kind: GoalLogicEdgeKind = targetId === COMPLETE_NODE_ID ? 'complete' : source.kind;
        edges.push({
          id: `${entryIndex}:${listIndex}:${sourceId}->${targetId}`,
          source: sourceId,
          target: targetId,
          kind,
          dashed: source.kind === 'or',
          entryIndex,
          listIndex,
          sourceName: source.name,
        });
      });
    });
  });

  return { nodes, edges };
}

/* --------------------------------------------------------------------- layout */

/** A node's top-left position in the canvas, as React Flow wants it. */
export interface GoalLogicPosition {
  x: number;
  y: number;
}

export interface GoalLogicLayoutOptions {
  rankSeparation?: number;
  nodeSeparation?: number;
  rankdir?: 'LR' | 'TB';
}

/**
 * The dagre layout, as a pure function from graph to positions: `rankdir: 'LR'` puts every
 * dependency rank in its own column (left to right), and the Complete node lands in the last
 * column because it is the graph's sink. dagre returns node **centres**; React Flow positions
 * nodes by their top-left corner, so the half-box is subtracted here — the one conversion
 * between the two models, done once.
 *
 * Deterministic for a given graph (dagre's own ordering), which is what lets the tier-1 spec
 * assert that the first paint is already a readable left-to-right DAG.
 */
export function layoutGoalLogicGraph(
  graph: GoalLogicGraph,
  options: GoalLogicLayoutOptions = {},
): Record<string, GoalLogicPosition> {
  const layout = new dagre.graphlib.Graph();
  layout.setGraph({
    rankdir: options.rankdir ?? 'LR',
    ranksep: options.rankSeparation ?? LAYOUT_RANK_SEPARATION,
    nodesep: options.nodeSeparation ?? LAYOUT_NODE_SEPARATION,
    marginx: 8,
    marginy: 8,
  });
  layout.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    layout.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of graph.edges) {
    layout.setEdge(edge.source, edge.target);
  }
  dagre.layout(layout);

  const positions: Record<string, GoalLogicPosition> = {};
  for (const node of graph.nodes) {
    const laidOut = layout.node(node.id) as { x: number; y: number };
    positions[node.id] = {
      x: Math.round(laidOut.x - NODE_WIDTH / 2),
      y: Math.round(laidOut.y - NODE_HEIGHT / 2),
    };
  }
  return positions;
}

/* ----------------------------------------------------------------- validator */

export type GoalLogicFindingKind =
  /** A goal of `m_goals` no entry can ever activate from `m_startGoals`. */
  | 'disconnected-goal'
  /** A dependency cycle among goals: nothing in the cycle can be completed first. */
  | 'cycle'
  /** Two goals of `m_goals` share a `m_goalName` (the names are the graph's identity). */
  | 'duplicate-goal-name'
  /** An entry references a name that is not in `m_goals`. */
  | 'unknown-goal-reference'
  /** `m_requiredORCount` is larger than the entry's OR list, so the entry can never fire. */
  | 'unsatisfiable-or-count';

export interface GoalLogicFinding {
  kind: GoalLogicFindingKind;
  /** The goal the finding is about, or `null` for a finding about the quest as a whole. */
  goalName: string | null;
  /** The `m_goalLogic` entry indices involved, ascending (`[]` when none is). */
  entryIndices: number[];
  /** A one-line machine-friendly detail — **not** the UI banner's copy. */
  detail: string;
  /** The cycle's members, for a `cycle` finding (ascending name order); `[]` otherwise. */
  cycle: string[];
}

export interface GoalLogicValidation {
  findings: GoalLogicFinding[];
  /** Goal names reachable from `m_startGoals` through the entries, in `m_goals` order. */
  reachable: string[];
  /** Goal names not reachable, in `m_goals` order. */
  unreachable: string[];
  /** `true` when some completing entry's conditions are reachable. */
  completeReachable: boolean;
  /** `true` when any finding of a kind the warning banner is specified for is present. */
  hasGraphShapeFinding: boolean;
}

/** The finding kinds the spec's warning banner ("disconnected nodes or cycles") covers. */
export const BANNER_FINDING_KINDS: readonly GoalLogicFindingKind[] = ['disconnected-goal', 'cycle'];

/** `true` when a finding kind is one the spec's warning banner covers. */
export function isBannerFinding(finding: GoalLogicFinding): boolean {
  return BANNER_FINDING_KINDS.includes(finding.kind);
}

/**
 * The validator, returning **structured findings** (never a boolean, never the banner's copy).
 * Four rule families, from docs/spec-domain-reference.md L528-534 and plan §3.5/§3.9:
 *
 * 1. **Reachability.** Starting from the `m_startGoals` names that exist in `m_goals`, an entry
 *    *fires* once every `m_goalsAND` name is reachable **and** at least `m_requiredORCount` of
 *    its `m_goalsOR` names are (a missing/`null` count is read as `0`, an empty OR list is
 *    vacuously satisfied, and a count larger than the OR list can never be met — reported as
 *    `unsatisfiable-or-count`). Firing adds the entry's known `m_goalsToAdd` names to the
 *    reachable set, and the fixpoint repeats until it stops growing. This is the domain's own
 *    "reachable from start goals" rule; it deliberately over-approximates *completability*,
 *    which is the only thing a static graph can answer. Every unreached goal is one
 *    `disconnected-goal` finding.
 * 2. **Cycles.** The same prerequisite→activated arcs, restricted to known goal names, are run
 *    through Tarjan's SCC algorithm; every component of two or more nodes, plus every
 *    self-loop, is one `cycle` finding naming its members. A cycle is reported once per
 *    component, not once per edge.
 * 3. **Duplicate goal names.** The graph's identity is the goal *name* (that is what entries
 *    reference), so a name carried by two `m_goals` elements is one `duplicate-goal-name`
 *    finding.
 * 4. **Unknown references.** Every name in an entry's three lists that is not a `m_goalName` is
 *    reported per entry (one finding per entry, listing all of that entry's unknown names).
 *
 * A document with no goals and no entries produces no findings — "no logic at all" is the
 * measured state of 15 corpus quests, and it is not an error.
 */
export function validateGoalLogic(document: unknown): GoalLogicValidation {
  const goals = goalsOf(document);
  const entries = goalLogicEntries(document);
  const findings: GoalLogicFinding[] = [];

  const goalNameCounts = new Map<string, number>();
  const goalNames: string[] = [];
  for (const goal of goals) {
    const name = goalName(goal);
    if (name === null) {
      continue;
    }
    if (!goalNameCounts.has(name)) {
      goalNames.push(name);
    }
    goalNameCounts.set(name, (goalNameCounts.get(name) ?? 0) + 1);
  }
  const known = new Set(goalNames);
  for (const name of goalNames) {
    if ((goalNameCounts.get(name) ?? 0) > 1) {
      findings.push({
        kind: 'duplicate-goal-name',
        goalName: name,
        entryIndices: [],
        detail: `Goal name "${name}" is carried by ${goalNameCounts.get(name)} goals`,
        cycle: [],
      });
    }
  }

  // Unknown references, one finding per entry that has any.
  entries.forEach((entry, entryIndex) => {
    const unknown: string[] = [];
    for (const key of ['m_goalsAND', 'm_goalsOR', 'm_goalsToAdd']) {
      for (const name of goalLogicEntryNames(entry, key)) {
        if (!known.has(name) && !unknown.includes(name)) {
          unknown.push(name);
        }
      }
    }
    if (unknown.length > 0) {
      findings.push({
        kind: 'unknown-goal-reference',
        goalName: null,
        entryIndices: [entryIndex],
        detail: `Entry ${entryIndex + 1} references unknown goal(s): ${unknown.join(', ')}`,
        cycle: [],
      });
    }
  });

  // Unsatisfiable OR counts: a count above the list can never be met.
  entries.forEach((entry, entryIndex) => {
    const orNames = goalLogicEntryNames(entry, 'm_goalsOR');
    const required = goalLogicEntryRequiredORCount(entry);
    if (orNames.length > 0 && required !== null && required > orNames.length) {
      findings.push({
        kind: 'unsatisfiable-or-count',
        goalName: null,
        entryIndices: [entryIndex],
        detail: `Entry ${entryIndex + 1} requires ${required} of ${orNames.length} OR goals`,
        cycle: [],
      });
    }
  });

  // Reachability fixpoint.
  const reachable = new Set<string>(
    startGoalNames(isPlainObject(document) ? document.m_startGoals : undefined).filter((name) =>
      known.has(name),
    ),
  );
  let completeReachable = false;
  for (let pass = 0; pass <= entries.length; pass += 1) {
    let grew = false;
    entries.forEach((entry) => {
      const andNames = goalLogicEntryNames(entry, 'm_goalsAND');
      const orNames = goalLogicEntryNames(entry, 'm_goalsOR');
      const ready =
        andNames.every((name) => reachable.has(name)) &&
        (orNames.length === 0 ||
          (goalLogicEntryRequiredORCount(entry) ?? 0) <=
            orNames.filter((name) => reachable.has(name)).length);
      if (!ready) {
        return;
      }
      if (goalLogicEntryCompletes(entry)) {
        completeReachable = true;
      }
      for (const name of goalLogicEntryNames(entry, 'm_goalsToAdd')) {
        if (known.has(name) && !reachable.has(name)) {
          reachable.add(name);
          grew = true;
        }
      }
    });
    if (!grew) {
      break;
    }
  }

  const reachableNames = goalNames.filter((name) => reachable.has(name));
  const unreachableNames = goalNames.filter((name) => !reachable.has(name));
  for (const name of unreachableNames) {
    findings.push({
      kind: 'disconnected-goal',
      goalName: name,
      entryIndices: [],
      detail: `Goal "${name}" is not reachable from m_startGoals`,
      cycle: [],
    });
  }

  // Cycles: Tarjan's SCC over prerequisite → activated arcs.
  for (const cycle of stronglyConnectedCycles(entries, known)) {
    findings.push({
      kind: 'cycle',
      goalName: cycle[0],
      entryIndices: [],
      detail: `Goal dependency cycle: ${cycle.join(' → ')}`,
      cycle,
    });
  }

  return {
    findings,
    reachable: reachableNames,
    unreachable: unreachableNames,
    completeReachable,
    hasGraphShapeFinding: findings.some(isBannerFinding),
  };
}

/**
 * The non-trivial strongly connected components of the prerequisite→activated graph, each
 * sorted by name. Iterative Tarjan (no recursion: a 772-goal quest is allowed to be deep
 * without blowing the stack) with the low-link update on the component id, which is enough to
 * report *membership* — the SCC does not need the internal order.
 */
function stronglyConnectedCycles(entries: readonly unknown[], known: Set<string>): string[][] {
  const adjacency = new Map<string, string[]>();
  const addArc = (from: string, to: string): void => {
    const list = adjacency.get(from);
    if (list === undefined) {
      adjacency.set(from, [to]);
    } else if (!list.includes(to)) {
      list.push(to);
    }
  };
  for (const entry of entries) {
    const targets = goalLogicEntryNames(entry, 'm_goalsToAdd').filter((name) => known.has(name));
    for (const key of ['m_goalsAND', 'm_goalsOR']) {
      for (const source of goalLogicEntryNames(entry, key)) {
        if (!known.has(source)) {
          continue;
        }
        if (!adjacency.has(source)) {
          adjacency.set(source, []);
        }
        for (const target of targets) {
          addArc(source, target);
        }
      }
    }
  }

  let nextIndex = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];

  for (const root of known) {
    if (index.has(root)) {
      continue;
    }
    const work: Array<{ node: string; child: number }> = [{ node: root, child: 0 }];
    index.set(root, nextIndex);
    low.set(root, nextIndex);
    nextIndex += 1;
    stack.push(root);
    onStack.add(root);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const children = adjacency.get(frame.node) ?? [];
      if (frame.child < children.length) {
        const child = children[frame.child];
        frame.child += 1;
        if (!index.has(child)) {
          index.set(child, nextIndex);
          low.set(child, nextIndex);
          nextIndex += 1;
          stack.push(child);
          onStack.add(child);
          work.push({ node: child, child: 0 });
        } else if (onStack.has(child)) {
          low.set(frame.node, Math.min(low.get(frame.node) ?? 0, index.get(child) ?? 0));
        }
        continue;
      }

      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        low.set(parent, Math.min(low.get(parent) ?? 0, low.get(frame.node) ?? 0));
      }
      if (low.get(frame.node) === index.get(frame.node)) {
        const component: string[] = [];
        for (;;) {
          const popped = stack.pop();
          if (popped === undefined) {
            break;
          }
          onStack.delete(popped);
          component.push(popped);
          if (popped === frame.node) {
            break;
          }
        }
        const selfLoop =
          component.length === 1 && (adjacency.get(component[0]) ?? []).includes(component[0]);
        if (component.length > 1 || selfLoop) {
          components.push(component.slice().sort());
        }
      }
    }
  }
  return components;
}

/* -------------------------------------------------------------- edit builders */

/**
 * A brand-new entry in the corpus's exact shape: all five keys, in the corpus's order, with
 * `m_requiredORCount: 1` (the value 742 of 742 measured entries carry). Building the whole
 * shape here is an **insert**, not padding: D57's "a key that is absent stays absent" is about
 * existing objects, of which a new entry has none.
 */
export function newGoalLogicEntry(): Record<string, unknown> {
  return {
    m_goalsAND: [],
    m_goalsOR: [],
    m_goalsToAdd: [],
    m_completeQuest: false,
    m_requiredORCount: 1,
  };
}

/**
 * Adds one entry at the end of `m_goalLogic`, creating the key when the document has none.
 *
 * `current` is the document's `m_goalLogic` value (`state.value(['m_goalLogic'])`), and the
 * three cases are deliberate:
 *
 * - an **array** → one `insert` at its length, so nothing else in the array moves;
 * - **absent or `null`** → one `set` of a one-element array. This is the only place the tab
 *   creates the key, and it runs only because the user pressed Add — mounting the tab never
 *   writes (the module header's absent/`null` rule);
 * - **anything else** (a string, an object) → the value is replaced by the one-element array,
 *   because the user asked for an entry and there is no array to insert into. The replaced
 *   value is not modelled anywhere, so it cannot be preserved in place; a document in that
 *   state is outside the domain schema.
 */
export function addGoalLogicEntryEdits(current: unknown): DocEdit[] {
  if (Array.isArray(current)) {
    return [
      { op: 'insert', path: [GOAL_LOGIC_PATH], index: current.length, value: newGoalLogicEntry() },
    ];
  }
  return [{ op: 'set', path: [GOAL_LOGIC_PATH], value: [newGoalLogicEntry()] }];
}

/**
 * Deletes one entry. An emptied `m_goalLogic` stays `m_goalLogic: []` rather than losing its
 * key: `[]` is one of the corpus's own shapes (15 quests carry it), and deleting the key would
 * be a second, unrequested change.
 */
export function deleteGoalLogicEntryEdits(index: number): DocEdit[] {
  return [{ op: 'delete', path: goalLogicEntryPath(index) }];
}

/**
 * The edit one inspector control produces on entry `index`'s `key`, dispatched by field:
 *
 * - a **name list** (`m_goalsAND` / `m_goalsOR` / `m_goalsToAdd`): the text is split on commas;
 *   an emptied input deletes the key when it is present and produces **no** edit when it is not
 *   (the D59(c) rule `quest-goals.ts` ships);
 * - `m_requiredORCount`: the same empty rule, then `Number(raw)`; a non-finite intermediate
 *   (`1e`, `-`) produces no edit rather than a `NaN`;
 * - `m_completeQuest`: a checkbox's `true`/`false`.
 *
 * Any other key produces no edit: this builder only writes the five keys the model knows.
 */
export function updateGoalLogicEntryEdits(
  index: number,
  key: string,
  present: boolean,
  raw: string,
): DocEdit | null {
  const path = goalLogicEntryPath(index, key);
  if (GOAL_LOGIC_NAME_FIELDS.includes(key)) {
    if (raw.trim() === '') {
      return present ? { op: 'delete', path } : null;
    }
    return { op: 'set', path, value: parseGoalLogicNames(raw) };
  }
  if (key === 'm_requiredORCount') {
    if (raw.trim() === '') {
      return present ? { op: 'delete', path } : null;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? { op: 'set', path, value } : null;
  }
  if (key === 'm_completeQuest') {
    return { op: 'set', path, value: raw === 'true' };
  }
  return null;
}

/**
 * Connecting two goals on the canvas (a drawn edge), expressed in `m_goalLogic`:
 *
 * - If some entry already activates `target` (its `m_goalsToAdd` contains the name), the
 *   first such entry gains `source` in its `m_goalsAND` (solid) or `m_goalsOR` (dashed) list —
 *   appended, in the position the user can see, and **not** added twice.
 * - If no entry activates `target`, the connection has no host entry, so one is **appended**:
 *   a corpus-shaped entry whose condition is exactly this one prerequisite and whose only
 *   `m_goalsToAdd` is `target`. That is the entry format's own meaning
 *   ([spec-domain-reference.md] L340-351), not an invented default.
 *
 * A self-connection (`source === target`) produces no edits, and a connection that already
 * exists produces none either. The Complete node is a sink driven by `m_completeQuest` in the
 * inspector, so an edge *into* it is never created here (the canvas marks the node
 * non-connectable).
 */
export function connectGoalsEdits(
  document: unknown,
  source: string,
  target: string,
  kind: 'and' | 'or',
): DocEdit[] {
  if (source === '' || target === '' || source === target) {
    return [];
  }
  const key = kind === 'and' ? 'm_goalsAND' : 'm_goalsOR';
  const entries = goalLogicEntries(document);
  const hostIndex = entries.findIndex((entry) =>
    goalLogicEntryNames(entry, 'm_goalsToAdd').includes(target),
  );
  if (hostIndex < 0) {
    const entry = newGoalLogicEntry();
    entry[key] = [source];
    entry.m_goalsToAdd = [target];
    return [{ op: 'set', path: [GOAL_LOGIC_PATH], value: [...entries, entry] }];
  }
  const names = goalLogicEntryNames(entries[hostIndex], key);
  if (names.includes(source)) {
    return [];
  }
  return [{ op: 'set', path: goalLogicEntryPath(hostIndex, key), value: [...names, source] }];
}

/**
 * Disconnecting the edge the canvas rendered removes exactly the declaration that produced it:
 *
 * - an `and`/`or` edge deletes the one element of that entry's condition list (its `listIndex`),
 *   so the element removed is the element the user saw. `listLength` is the condition list's
 *   current length; when the element was the **last** one the key is deleted instead of being
 *   left as `[]`, matching what emptying the inspector's input does — the two paths cannot
 *   disagree about the same edit;
 * - a `complete` edge sets that entry's `m_completeQuest` to `false`: the boolean is the only
 *   home of "this entry completes the quest", so un-setting it *is* the disconnection.
 */
export function disconnectEdgeEdits(edge: GoalLogicEdge, listLength: number): DocEdit[] {
  if (edge.kind === 'complete') {
    return [
      { op: 'set', path: goalLogicEntryPath(edge.entryIndex, 'm_completeQuest'), value: false },
    ];
  }
  const key = edge.kind === 'and' ? 'm_goalsAND' : 'm_goalsOR';
  if (listLength <= 1) {
    return [{ op: 'delete', path: goalLogicEntryPath(edge.entryIndex, key) }];
  }
  return [{ op: 'delete', path: [...goalLogicEntryPath(edge.entryIndex, key), edge.listIndex] }];
}

/**
 * "Set as Start Goal" from the node context menu: exactly the p3-04 toggle
 * ({@link toggleStartGoalEdits}), so the two tabs cannot disagree about `m_startGoals`. The
 * menu labels the item per the goal's current membership, which is why a toggle is the right
 * primitive rather than an add-only one.
 */
export function setStartGoalEdits(goalNameValue: string, currentStartGoals: unknown): DocEdit[] {
  return toggleStartGoalEdits(goalNameValue, currentStartGoals);
}

/* ------------------------------------------------------------------- re-exports */

/**
 * The glanceable per-node type text is the Goals tab's own reader (D60h), re-exported here so
 * the canvas and the unit test name one implementation instead of two.
 */
export { goalShortTypeName };
