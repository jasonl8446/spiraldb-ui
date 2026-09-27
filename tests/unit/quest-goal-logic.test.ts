import { describe, expect, it } from 'vitest';

import {
  applyEdits,
  hasAtPath,
  serializeDoc,
  setAtPath,
  type DocEdit,
  type JsonDocument,
} from '@shared/document';
import { GOAL_TYPES } from '@shared/quest/typeConstants';

import { deleteGoalEdit } from '../../client/src/lib/quest-goals';

import {
  COMPLETE_NODE_ID,
  COMPLETE_NODE_LABEL,
  NODE_HEIGHT,
  NODE_WIDTH,
  addGoalLogicEntryEdits,
  buildGoalLogicGraph,
  connectGoalsEdits,
  deleteGoalLogicEntryEdits,
  disconnectEdgeEdits,
  goalLogicEntries,
  goalLogicEntryNames,
  goalLogicEntryPath,
  goalLogicEntrySummary,
  goalNamesOf,
  goalNodeId,
  hasGoalLogicKey,
  isBannerFinding,
  layoutGoalLogicGraph,
  newGoalLogicEntry,
  parseGoalLogicNames,
  setStartGoalEdits,
  updateGoalLogicEntryEdits,
  validateGoalLogic,
  type GoalLogicEdge,
} from '../../client/src/lib/quest-goal-logic';

/* ------------------------------------------------------------------ fixtures */

const WAYPOINT = GOAL_TYPES.WaypointGoalTemplate;
const PERSONA = GOAL_TYPES.PersonaGoalTemplate;

/** A goal in the corpus's own shape, reduced to what the model reads. */
function goal(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $type: WAYPOINT,
    m_goalName: name,
    m_goalType: 'GOAL_TYPE_WAYPOINT',
    m_clientTags: [],
    m_displayImage1: '',
    ...overrides,
  };
}

/**
 * The story's own subject: a start goal, a spine that fans out into two branches, a dashed OR
 * join and a completing entry — a multi-goal quest with solid AND edges, dashed OR edges and
 * the Complete node, exactly what AC1 asks the flowchart to draw. The real corpus is a linear
 * AND chain (`m_goalsOR` is empty in all 742 entries), so the OR arm is deliberately synthetic (zero corpus
 * instances) while the AND/complete arms are the corpus's own shape.
 *
 * The spine is load-bearing for one test: deleting `2_Spine` (the node context menu's Delete)
 * strands everything downstream, which is the disconnect the warning banner is specified for.
 */
function logicQuest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    m_questName: 'DS-TEST-C01-001',
    m_startGoals: ['1_Start'],
    m_goals: [
      goal('1_Start'),
      goal('2_Spine'),
      goal('3_Left'),
      goal('4_Right'),
      goal('5_Join'),
      goal('6_End'),
    ],
    m_goalLogic: [
      {
        m_goalsAND: ['1_Start'],
        m_goalsOR: [],
        m_goalsToAdd: ['2_Spine'],
        m_completeQuest: false,
        m_requiredORCount: 1,
      },
      {
        m_goalsAND: ['2_Spine'],
        m_goalsOR: [],
        m_goalsToAdd: ['3_Left'],
        m_completeQuest: false,
        m_requiredORCount: 1,
      },
      {
        m_goalsAND: ['2_Spine'],
        m_goalsOR: [],
        m_goalsToAdd: ['4_Right'],
        m_completeQuest: false,
        m_requiredORCount: 1,
      },
      {
        m_goalsAND: [],
        m_goalsOR: ['3_Left', '4_Right'],
        m_goalsToAdd: ['5_Join'],
        m_completeQuest: false,
        m_requiredORCount: 1,
      },
      {
        m_goalsAND: ['5_Join'],
        m_goalsOR: [],
        m_goalsToAdd: ['6_End'],
        m_completeQuest: false,
        m_requiredORCount: 1,
      },
      {
        m_goalsAND: ['6_End'],
        m_goalsOR: [],
        m_goalsToAdd: [],
        m_completeQuest: true,
        m_requiredORCount: 1,
      },
    ],
    ...overrides,
  };
}

/** Applies one possibly-null edit, so a "no edit" case cannot be applied by accident. */
function applied(doc: JsonDocument, edit: DocEdit | null): JsonDocument {
  expect(edit).not.toBeNull();
  return applyEdits(doc, [edit as DocEdit]);
}

/** The `m_goalLogic` entries of a document, typed for assertions. */
function entriesOf(doc: JsonDocument): Array<Record<string, unknown>> {
  return goalLogicEntries(doc) as Array<Record<string, unknown>>;
}

/* --------------------------------------------------------------------- reads */

describe('the read helpers', () => {
  it('read an absent, null, empty and populated m_goalLogic without writing anything', () => {
    expect(goalLogicEntries({})).toEqual([]);
    expect(goalLogicEntries({ m_goalLogic: null })).toEqual([]);
    expect(goalLogicEntries({ m_goalLogic: [] })).toEqual([]);
    expect(goalLogicEntries({ m_goalLogic: 'nonsense' })).toEqual([]);
    expect(goalLogicEntries({ m_goalLogic: [newGoalLogicEntry()] })).toHaveLength(1);

    expect(hasGoalLogicKey({})).toBe(false);
    expect(hasGoalLogicKey({ m_goalLogic: null })).toBe(true);
    expect(hasGoalLogicKey({ m_goalLogic: [] })).toBe(true);
  });

  it('reads the named goals in m_goals order and skips unnamed ones', () => {
    const doc = { m_goals: [goal('A'), { m_goalType: 'GOAL_TYPE_WAYPOINT' }, goal('B')] };
    expect(goalNamesOf(doc)).toEqual(['A', 'B']);
  });

  it('reads an entry field leniently and parses a comma-separated name list', () => {
    const entry = { m_goalsAND: ['A'], m_goalsOR: null, m_completeQuest: null };
    expect(goalLogicEntryNames(entry, 'm_goalsAND')).toEqual(['A']);
    expect(goalLogicEntryNames(entry, 'm_goalsOR')).toEqual([]);
    expect(goalLogicEntryNames(entry, 'm_goalsToAdd')).toEqual([]);
    expect(parseGoalLogicNames(' A , , B ')).toEqual(['A', 'B']);
    expect(parseGoalLogicNames('')).toEqual([]);
  });

  it('summarises an entry for reading, without producing the banner copy', () => {
    const entries = goalLogicEntries(logicQuest());
    expect(goalLogicEntrySummary(entries[0], 0)).toBe('Entry 1: AND 1_Start → 2_Spine');
    expect(goalLogicEntrySummary(entries[3], 3)).toBe(
      'Entry 4: OR 3_Left | 4_Right (need 1) → 5_Join',
    );
    expect(goalLogicEntrySummary(entries[5], 5)).toBe('Entry 6: AND 6_End → ✓ Complete');
    expect(goalLogicEntrySummary({}, 6)).toBe('Entry 7: (no conditions)');
  });
});

/* --------------------------------------------------------------------- graph */

describe('the graph builder', () => {
  it('makes one node per goal plus the Complete node', () => {
    const graph = buildGoalLogicGraph(logicQuest());
    expect(graph.nodes.map((node) => node.id)).toEqual([
      goalNodeId('1_Start'),
      goalNodeId('2_Spine'),
      goalNodeId('3_Left'),
      goalNodeId('4_Right'),
      goalNodeId('5_Join'),
      goalNodeId('6_End'),
      COMPLETE_NODE_ID,
    ]);
    const complete = graph.nodes[6];
    expect(complete.kind).toBe('complete');
    expect(complete.name).toBe(COMPLETE_NODE_LABEL);
    expect(complete.goalIndex).toBeNull();
  });

  it('carries the Goals tab’s own type text, colour and start membership', () => {
    const doc = logicQuest({
      m_goals: [goal('1_Start'), goal('2_Spine', { $type: PERSONA })],
    });
    const [start, second] = buildGoalLogicGraph(doc).nodes;
    expect(start.typeName).toBe('WaypointGoalTemplate');
    expect(start.badgeClass).toContain('border-blue-500');
    expect(start.isStart).toBe(true);
    expect(second.typeName).toBe('PersonaGoalTemplate');
    expect(second.badgeClass).toContain('border-purple-500');
    expect(second.isStart).toBe(false);
  });

  it('draws solid AND edges, dashed OR edges and the edge into Complete', () => {
    const graph = buildGoalLogicGraph(logicQuest());
    expect(
      graph.edges.map((edge) => [
        edge.source,
        edge.target,
        edge.kind,
        edge.dashed,
        edge.entryIndex,
      ]),
    ).toEqual([
      [goalNodeId('1_Start'), goalNodeId('2_Spine'), 'and', false, 0],
      [goalNodeId('2_Spine'), goalNodeId('3_Left'), 'and', false, 1],
      [goalNodeId('2_Spine'), goalNodeId('4_Right'), 'and', false, 2],
      [goalNodeId('3_Left'), goalNodeId('5_Join'), 'or', true, 3],
      [goalNodeId('4_Right'), goalNodeId('5_Join'), 'or', true, 3],
      [goalNodeId('5_Join'), goalNodeId('6_End'), 'and', false, 4],
      [goalNodeId('6_End'), COMPLETE_NODE_ID, 'complete', false, 5],
    ]);
    expect(graph.edges[3].sourceName).toBe('3_Left');
    expect(graph.edges[4].listIndex).toBe(1);
  });

  it('gives every edge a unique id derived from its entry and list position', () => {
    const ids = buildGoalLogicGraph(logicQuest()).edges.map((edge) => edge.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps a duplicate prerequisite as two edges with distinct ids', () => {
    const doc = logicQuest({
      m_goalLogic: [
        {
          m_goalsAND: ['1_Start', '1_Start'],
          m_goalsOR: [],
          m_goalsToAdd: ['2_Spine'],
          m_completeQuest: false,
          m_requiredORCount: 1,
        },
      ],
    });
    const edges = buildGoalLogicGraph(doc).edges;
    expect(edges).toHaveLength(2);
    expect(edges[0].id).not.toBe(edges[1].id);
  });

  it('draws no edge to a node that does not exist, and none from an empty condition', () => {
    const doc = logicQuest({
      m_goalLogic: [
        {
          m_goalsAND: ['1_Start'],
          m_goalsOR: [],
          m_goalsToAdd: ['MissingGoal'],
          m_completeQuest: false,
          m_requiredORCount: 1,
        },
        {
          m_goalsAND: [],
          m_goalsOR: [],
          m_goalsToAdd: [],
          m_completeQuest: true,
          m_requiredORCount: 1,
        },
      ],
    });
    expect(buildGoalLogicGraph(doc).edges).toEqual([]);
  });

  it('reads an absent m_goalLogic as a graph of goals and nothing else', () => {
    const graph = buildGoalLogicGraph({ m_goals: [goal('A')] });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toEqual([]);
  });
});

/* -------------------------------------------------------------------- layout */

describe('the dagre layout', () => {
  it('positions every node and is deterministic', () => {
    const graph = buildGoalLogicGraph(logicQuest());
    const first = layoutGoalLogicGraph(graph);
    const second = layoutGoalLogicGraph(graph);
    expect(Object.keys(first).sort()).toEqual(graph.nodes.map((node) => node.id).sort());
    expect(first).toEqual(second);
    for (const position of Object.values(first)) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
    }
  });

  it('lays every edge out left to right and finishes at the Complete node', () => {
    const graph = buildGoalLogicGraph(logicQuest());
    const positions = layoutGoalLogicGraph(graph);
    for (const edge of graph.edges) {
      expect(positions[edge.target].x, `${edge.id} points right to left`).toBeGreaterThan(
        positions[edge.source].x,
      );
    }
    // The two branches are siblings: same column, different rows.
    expect(positions[goalNodeId('3_Left')].x).toBe(positions[goalNodeId('4_Right')].x);
    expect(positions[goalNodeId('3_Left')].y).not.toBe(positions[goalNodeId('4_Right')].y);
    // The Complete node is the sink, in the last column.
    expect(positions[COMPLETE_NODE_ID].x).toBeGreaterThan(positions[goalNodeId('6_End')].x);
  });

  it('produces boxes that do not overlap — the readable-DAG claim', () => {
    const graph = buildGoalLogicGraph(logicQuest());
    const positions = Object.entries(layoutGoalLogicGraph(graph));
    for (let a = 0; a < positions.length; a += 1) {
      for (let b = a + 1; b < positions.length; b += 1) {
        const [idA, boxA] = positions[a];
        const [idB, boxB] = positions[b];
        const overlaps =
          boxA.x < boxB.x + NODE_WIDTH &&
          boxB.x < boxA.x + NODE_WIDTH &&
          boxA.y < boxB.y + NODE_HEIGHT &&
          boxB.y < boxA.y + NODE_HEIGHT;
        expect(overlaps, `${idA} overlaps ${idB}`).toBe(false);
      }
    }
  });

  it('honours the rank direction option', () => {
    const graph = buildGoalLogicGraph(logicQuest());
    const topDown = layoutGoalLogicGraph(graph, { rankdir: 'TB' });
    expect(topDown[goalNodeId('1_Start')].y).toBeLessThan(topDown[COMPLETE_NODE_ID].y);
  });
});

/* ----------------------------------------------------------------- validator */

describe('the validator', () => {
  it('finds nothing on a clean chain and reports what it reached', () => {
    const result = validateGoalLogic(logicQuest());
    expect(result.findings).toEqual([]);
    expect(result.unreachable).toEqual([]);
    expect(result.reachable).toEqual([
      '1_Start',
      '2_Spine',
      '3_Left',
      '4_Right',
      '5_Join',
      '6_End',
    ]);
    expect(result.completeReachable).toBe(true);
    expect(result.hasGraphShapeFinding).toBe(false);
  });

  it('reports every goal the start set cannot reach, one finding each', () => {
    // Drop the entry that activates 2_Spine: the whole spine downstream of it dies.
    const doc = logicQuest();
    (doc.m_goalLogic as unknown[]).splice(0, 1);
    const result = validateGoalLogic(doc);
    expect(result.unreachable).toEqual(['2_Spine', '3_Left', '4_Right', '5_Join', '6_End']);
    expect(result.findings).toEqual([
      expect.objectContaining({
        kind: 'disconnected-goal',
        goalName: '2_Spine',
        entryIndices: [],
      }),
      expect.objectContaining({ kind: 'disconnected-goal', goalName: '3_Left' }),
      expect.objectContaining({ kind: 'disconnected-goal', goalName: '4_Right' }),
      expect.objectContaining({ kind: 'disconnected-goal', goalName: '5_Join' }),
      expect.objectContaining({ kind: 'disconnected-goal', goalName: '6_End' }),
    ]);
    expect(result.completeReachable).toBe(false);
    expect(result.hasGraphShapeFinding).toBe(true);
    expect(isBannerFinding({ ...result.findings[0], kind: 'disconnected-goal' })).toBe(true);
    expect(isBannerFinding({ ...result.findings[0], kind: 'duplicate-goal-name' })).toBe(false);
  });

  it('reports the goals a deleted goal strands — the node menu’s Delete', () => {
    // `deleteGoalEdit` is the Goals tab's own p3-04 primitive: deleting the spine goal
    // leaves its dependants referencing a name no `m_goals` element carries.
    const next = applyEdits(logicQuest(), [deleteGoalEdit(1)]);
    const result = validateGoalLogic(next);
    expect(result.unreachable).toEqual(['3_Left', '4_Right', '5_Join', '6_End']);
    expect(result.hasGraphShapeFinding).toBe(true);
    expect(
      result.findings.filter((finding) => finding.kind === 'unknown-goal-reference'),
    ).toHaveLength(3);
  });

  it('treats a quest with no start goals as fully disconnected', () => {
    const result = validateGoalLogic(logicQuest({ m_startGoals: [] }));
    expect(result.reachable).toEqual([]);
    expect(result.unreachable).toEqual([
      '1_Start',
      '2_Spine',
      '3_Left',
      '4_Right',
      '5_Join',
      '6_End',
    ]);
  });

  it('reports no findings at all for a quest with no goals and no logic', () => {
    expect(validateGoalLogic({}).findings).toEqual([]);
    expect(validateGoalLogic({ m_goals: [], m_goalLogic: [] }).findings).toEqual([]);
  });

  it('reports a dependency cycle once per component', () => {
    const doc = {
      m_startGoals: ['A'],
      m_goals: [goal('A'), goal('B'), goal('C')],
      m_goalLogic: [
        {
          m_goalsAND: ['A'],
          m_goalsOR: [],
          m_goalsToAdd: ['B'],
          m_completeQuest: false,
          m_requiredORCount: 1,
        },
        {
          m_goalsAND: ['B'],
          m_goalsOR: [],
          m_goalsToAdd: ['C'],
          m_completeQuest: false,
          m_requiredORCount: 1,
        },
        {
          m_goalsAND: ['C'],
          m_goalsOR: [],
          m_goalsToAdd: ['B'],
          m_completeQuest: false,
          m_requiredORCount: 1,
        },
      ],
    };
    const cycles = validateGoalLogic(doc).findings.filter((finding) => finding.kind === 'cycle');
    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycle).toEqual(['B', 'C']);
    expect(cycles[0].goalName).toBe('B');
  });

  it('reports a self-loop as a cycle', () => {
    const doc = {
      m_startGoals: ['A'],
      m_goals: [goal('A')],
      m_goalLogic: [
        {
          m_goalsAND: ['A'],
          m_goalsOR: [],
          m_goalsToAdd: ['A'],
          m_completeQuest: false,
          m_requiredORCount: 1,
        },
      ],
    };
    const cycles = validateGoalLogic(doc).findings.filter((finding) => finding.kind === 'cycle');
    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycle).toEqual(['A']);
  });

  it('reports a duplicate goal name once, naming the goal', () => {
    const doc = logicQuest({ m_goals: [goal('1_Start'), goal('1_Start')] });
    const duplicates = validateGoalLogic(doc).findings.filter(
      (finding) => finding.kind === 'duplicate-goal-name',
    );
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].goalName).toBe('1_Start');
    expect(duplicates[0].detail).toContain('2 goals');
  });

  it('reports unknown references per entry, across all three lists', () => {
    const doc = logicQuest({
      m_goalLogic: [
        {
          m_goalsAND: ['1_Start', 'Nope'],
          m_goalsOR: ['AlsoNope'],
          m_goalsToAdd: ['2_BranchLeft'],
          m_completeQuest: false,
          m_requiredORCount: 1,
        },
      ],
    });
    const result = validateGoalLogic(doc);
    const unknown = result.findings.filter((finding) => finding.kind === 'unknown-goal-reference');
    expect(unknown).toHaveLength(1);
    expect(unknown[0].entryIndices).toEqual([0]);
    expect(unknown[0].detail).toContain('Nope');
    expect(unknown[0].detail).toContain('AlsoNope');
    // The AND condition can never be met, so its target is unreachable too.
    expect(result.unreachable).toContain('2_Spine');
  });

  it('reports an OR count that can never be met and does not fire the entry', () => {
    const doc = {
      m_startGoals: ['A'],
      m_goals: [goal('A'), goal('B'), goal('C')],
      m_goalLogic: [
        {
          m_goalsAND: [],
          m_goalsOR: ['A'],
          m_goalsToAdd: ['B'],
          m_completeQuest: false,
          m_requiredORCount: 3,
        },
      ],
    };
    const result = validateGoalLogic(doc);
    expect(result.findings.map((finding) => finding.kind)).toEqual([
      'unsatisfiable-or-count',
      'disconnected-goal',
      'disconnected-goal',
    ]);
    expect(result.unreachable).toEqual(['B', 'C']);
  });

  it('fires an OR entry once enough alternatives are reachable', () => {
    const doc = {
      m_startGoals: ['A', 'B'],
      m_goals: [goal('A'), goal('B'), goal('C')],
      m_goalLogic: [
        {
          m_goalsAND: [],
          m_goalsOR: ['A', 'B'],
          m_goalsToAdd: ['C'],
          m_completeQuest: true,
          m_requiredORCount: 2,
        },
      ],
    };
    const result = validateGoalLogic(doc);
    expect(result.findings).toEqual([]);
    expect(result.reachable).toEqual(['A', 'B', 'C']);
    expect(result.completeReachable).toBe(true);
  });

  it('reads a missing OR count as satisfied and an empty condition as satisfied', () => {
    const doc = {
      m_startGoals: ['A'],
      m_goals: [goal('A'), goal('B'), goal('C')],
      m_goalLogic: [
        { m_goalsAND: [], m_goalsOR: ['A'], m_goalsToAdd: ['B'], m_completeQuest: false },
        { m_goalsAND: [], m_goalsOR: [], m_goalsToAdd: ['C'], m_completeQuest: true },
      ],
    };
    const result = validateGoalLogic(doc);
    expect(result.reachable).toEqual(['A', 'B', 'C']);
    expect(result.completeReachable).toBe(true);
  });
});

/* -------------------------------------------------------------- edit builders */

describe('the edit builders', () => {
  it('builds a corpus-shaped entry: the five keys in the corpus order, count 1', () => {
    expect(newGoalLogicEntry()).toEqual({
      m_goalsAND: [],
      m_goalsOR: [],
      m_goalsToAdd: [],
      m_completeQuest: false,
      m_requiredORCount: 1,
    });
    expect(Object.keys(newGoalLogicEntry())).toEqual([
      'm_goalsAND',
      'm_goalsOR',
      'm_goalsToAdd',
      'm_completeQuest',
      'm_requiredORCount',
    ]);
  });

  it('inserts an entry at the end of an existing array', () => {
    const doc = { m_goalLogic: [newGoalLogicEntry()] };
    const next = applyEdits(
      doc,
      addGoalLogicEntryEdits((doc as { m_goalLogic: unknown }).m_goalLogic),
    );
    expect(entriesOf(next)).toHaveLength(2);
    expect(entriesOf(next)[0]).toEqual(newGoalLogicEntry());
  });

  it('creates m_goalLogic only when the user asked for an entry', () => {
    const absent = { m_questName: 'X' };
    expect(hasGoalLogicKey(absent)).toBe(false);
    const created = applyEdits(absent, addGoalLogicEntryEdits(undefined));
    expect(hasGoalLogicKey(created)).toBe(true);
    expect(serializeDoc(absent)).toBe('{\n  "m_questName": "X"\n}\n');

    const nulled = { m_goalLogic: null };
    const replaced = applyEdits(nulled, addGoalLogicEntryEdits(null));
    expect(entriesOf(replaced)).toHaveLength(1);
    expect(serializeDoc(nulled)).toBe('{\n  "m_goalLogic": null\n}\n');
  });

  it('deletes one entry and leaves the array (never the key) in place', () => {
    const doc = logicQuest();
    const next = applyEdits(doc, deleteGoalLogicEntryEdits(3));
    expect(entriesOf(next)).toHaveLength(5);
    expect(hasGoalLogicKey(next)).toBe(true);
    expect(goalLogicEntryNames(entriesOf(next)[3], 'm_goalsAND')).toEqual(['5_Join']);
    expect(goalLogicEntryNames(entriesOf(next)[3], 'm_goalsToAdd')).toEqual(['6_End']);
    // The input document was not touched (D58: every primitive returns a new document).
    expect(goalLogicEntries(doc)).toHaveLength(6);
  });

  it('updates each of the five fields, deleting an emptied key and skipping an absent one', () => {
    const doc = logicQuest();
    const and = applied(doc, updateGoalLogicEntryEdits(0, 'm_goalsAND', true, 'A, B'));
    expect(goalLogicEntryNames(entriesOf(and)[0], 'm_goalsAND')).toEqual(['A', 'B']);
    const or = applied(doc, updateGoalLogicEntryEdits(0, 'm_goalsOR', true, 'X'));
    expect(goalLogicEntryNames(entriesOf(or)[0], 'm_goalsOR')).toEqual(['X']);
    const add = applied(doc, updateGoalLogicEntryEdits(0, 'm_goalsToAdd', true, 'C'));
    expect(goalLogicEntryNames(entriesOf(add)[0], 'm_goalsToAdd')).toEqual(['C']);

    const cleared = applied(doc, updateGoalLogicEntryEdits(0, 'm_goalsAND', true, ''));
    expect(hasAtPath(cleared, goalLogicEntryPath(0, 'm_goalsAND'))).toBe(false);
    expect(hasAtPath(cleared, goalLogicEntryPath(0, 'm_goalsToAdd'))).toBe(true);
    // An absent key plus an emptied input is no edit at all.
    expect(updateGoalLogicEntryEdits(0, 'm_goalsOR', false, '')).toBeNull();

    const count = applied(doc, updateGoalLogicEntryEdits(0, 'm_requiredORCount', true, '2'));
    expect(entriesOf(count)[0]).toMatchObject({ m_requiredORCount: 2 });
    // A non-finite intermediate writes nothing rather than a NaN.
    expect(updateGoalLogicEntryEdits(0, 'm_requiredORCount', true, '1e')).toBeNull();
    expect(updateGoalLogicEntryEdits(0, 'm_requiredORCount', false, '')).toBeNull();

    const complete = applied(doc, updateGoalLogicEntryEdits(3, 'm_completeQuest', true, 'false'));
    expect(entriesOf(complete)[3]).toMatchObject({ m_completeQuest: false });
    expect(updateGoalLogicEntryEdits(0, 'm_unknownKey', true, 'x')).toBeNull();
  });

  it('keeps an unmodelled entry key, the entry key order and a null sibling (D57)', () => {
    const doc: JsonDocument = {
      m_goalLogic: [
        {
          $type: 'Imcodec.ObjectProperty.TypeCache.GoalLogicEntry, Imcodec.ObjectProperty',
          m_goalsAND: ['1_Start'],
          m_goalsOR: [],
          m_goalsToAdd: [],
          m_completeQuest: false,
          m_requiredORCount: 1,
          mLegacyKey: { kept: true },
        },
      ],
      m_goalNameUnrelated: null,
    };
    const next = applied(doc, updateGoalLogicEntryEdits(0, 'm_goalsToAdd', true, 'A'));
    expect(serializeDoc(next)).toBe(
      '{\n' +
        '  "m_goalLogic": [\n' +
        '    {\n' +
        '      "$type": "Imcodec.ObjectProperty.TypeCache.GoalLogicEntry, Imcodec.ObjectProperty",\n' +
        '      "m_goalsAND": [\n' +
        '        "1_Start"\n' +
        '      ],\n' +
        '      "m_goalsOR": [],\n' +
        '      "m_goalsToAdd": [\n' +
        '        "A"\n' +
        '      ],\n' +
        '      "m_completeQuest": false,\n' +
        '      "m_requiredORCount": 1,\n' +
        '      "mLegacyKey": {\n' +
        '        "kept": true\n' +
        '      }\n' +
        '    }\n' +
        '  ],\n' +
        '  "m_goalNameUnrelated": null\n' +
        '}\n',
    );
  });

  it('leaves a sparse goal and a missing m_goalLogic byte-identical under an unrelated edit', () => {
    const doc: JsonDocument = {
      m_questName: 'WC-CYCLOPS-MAIN-002',
      m_goalLogic: [
        {
          m_goalsAND: ['1_Start'],
          m_goalsOR: [],
          m_goalsToAdd: [],
          m_completeQuest: false,
          m_requiredORCount: 1,
        },
      ],
      m_goals: [{ $type: WAYPOINT, m_goalName: '1_Start', m_zoneTag: null }],
      m_startGoals: ['1_Start'],
    };
    const before = serializeDoc(doc);
    const next = applied(doc, updateGoalLogicEntryEdits(0, 'm_completeQuest', true, 'true'));
    expect(serializeDoc(doc)).toBe(before);

    // The sparse goal keeps exactly its three keys, and its explicit null stays a null.
    const sparse = (next as { m_goals: Array<Record<string, unknown>> }).m_goals[0];
    expect(Object.keys(sparse)).toEqual(['$type', 'm_goalName', 'm_zoneTag']);
    expect(sparse.m_zoneTag).toBeNull();
    expect(sparse).not.toHaveProperty('m_goalTitle');

    // A quest with no m_goalLogic at all never grows the key from an unrelated edit.
    const noLogic: JsonDocument = { m_questName: 'Tutorial_Intro', m_goals: [] };
    const untouched = setAtPath(noLogic, ['m_questName'], 'Tutorial_Intro_2');
    expect(hasGoalLogicKey(untouched)).toBe(false);
    expect(serializeDoc(untouched)).not.toContain('m_goalLogic');
  });

  it('connects into an existing host entry instead of inventing one', () => {
    const doc = logicQuest();
    const edits = connectGoalsEdits(doc, '4_Right', '3_Left', 'and');
    expect(edits).toHaveLength(1);
    const next = applyEdits(doc, edits);
    expect(entriesOf(next)).toHaveLength(6);
    expect(goalLogicEntryNames(entriesOf(next)[1], 'm_goalsAND')).toEqual(['2_Spine', '4_Right']);
    // Connecting twice is a no-op, and a self-connection never happens.
    expect(connectGoalsEdits(next, '4_Right', '3_Left', 'and')).toEqual([]);
    expect(connectGoalsEdits(doc, '3_Left', '3_Left', 'and')).toEqual([]);
    expect(connectGoalsEdits(doc, '', '3_Left', 'and')).toEqual([]);
  });

  it('connects with a new OR entry when no entry activates the target', () => {
    const doc: JsonDocument = { m_goals: [goal('A'), goal('New')], m_goalLogic: [] };
    const next = applyEdits(doc, connectGoalsEdits(doc, 'A', 'New', 'or'));
    expect(entriesOf(next)[0]).toEqual({
      m_goalsAND: [],
      m_goalsOR: ['A'],
      m_goalsToAdd: ['New'],
      m_completeQuest: false,
      m_requiredORCount: 1,
    });
    expect(buildGoalLogicGraph(next).edges).toContainEqual(
      expect.objectContaining({
        source: goalNodeId('A'),
        target: goalNodeId('New'),
        kind: 'or',
        dashed: true,
        entryIndex: 0,
      }),
    );
  });

  it('disconnects one element of a condition list, and the key when it was the last', () => {
    const doc = logicQuest();
    const graph = buildGoalLogicGraph(doc);
    const orEdge = graph.edges.find((edge) => edge.kind === 'or') as GoalLogicEdge;
    expect(orEdge.listIndex).toBe(0);

    const oneLeft = applyEdits(doc, disconnectEdgeEdits(orEdge, 2));
    expect(goalLogicEntryNames(entriesOf(oneLeft)[3], 'm_goalsOR')).toEqual(['4_Right']);

    // A single-element list loses its key, and the entry becomes unconditional — an entry
    // with no condition at all fires vacuously (all-of-none is true), so the target stays
    // reachable. Disconnecting a condition can only make an entry *easier* to satisfy.
    const aloneDoc: JsonDocument = {
      m_startGoals: ['1_Start'],
      m_goals: [goal('1_Start'), goal('2_Target')],
      m_goalLogic: [
        {
          m_goalsAND: [],
          m_goalsOR: ['1_Start'],
          m_goalsToAdd: ['2_Target'],
          m_completeQuest: false,
          m_requiredORCount: 1,
        },
      ],
    };
    const aloneEdge = buildGoalLogicGraph(aloneDoc).edges[0];
    const cleared = applyEdits(aloneDoc, disconnectEdgeEdits(aloneEdge, 1));
    expect(hasAtPath(cleared, goalLogicEntryPath(0, 'm_goalsOR'))).toBe(false);
    expect(validateGoalLogic(cleared).unreachable).toEqual([]);
    expect(validateGoalLogic(cleared).hasGraphShapeFinding).toBe(false);

    // An AND list with two elements loses exactly one of them.
    const twoConditionDoc: JsonDocument = {
      m_startGoals: ['1_Start', '2_AlsoStart'],
      m_goals: [goal('1_Start'), goal('2_AlsoStart'), goal('3_Target')],
      m_goalLogic: [
        {
          m_goalsAND: ['1_Start', '2_AlsoStart'],
          m_goalsOR: [],
          m_goalsToAdd: ['3_Target'],
          m_completeQuest: false,
          m_requiredORCount: 1,
        },
      ],
    };
    const andEdge = buildGoalLogicGraph(twoConditionDoc).edges[0];
    const andTrimmed = applyEdits(twoConditionDoc, disconnectEdgeEdits(andEdge, 2));
    expect(goalLogicEntryNames(entriesOf(andTrimmed)[0], 'm_goalsAND')).toEqual(['2_AlsoStart']);
    const andCleared = applyEdits(twoConditionDoc, disconnectEdgeEdits(andEdge, 1));
    expect(hasAtPath(andCleared, goalLogicEntryPath(0, 'm_goalsAND'))).toBe(false);
  });

  it('disconnects a complete edge by un-setting m_completeQuest', () => {
    const doc = logicQuest();
    const completeEdge = buildGoalLogicGraph(doc).edges.find(
      (edge) => edge.kind === 'complete',
    ) as GoalLogicEdge;
    const next = applyEdits(doc, disconnectEdgeEdits(completeEdge, 1));
    expect(entriesOf(next)[5]).toMatchObject({ m_completeQuest: false });
    expect(validateGoalLogic(next).completeReachable).toBe(false);
    // Every goal is still reachable; only the completion went away.
    expect(validateGoalLogic(next).unreachable).toEqual([]);
  });

  it('routes Set as Start Goal through the p3-04 toggle', () => {
    const added = applyEdits(logicQuest(), setStartGoalEdits('6_End', ['1_Start']));
    expect((added as { m_startGoals: string[] }).m_startGoals).toEqual(['1_Start', '6_End']);
    const removed = applyEdits(added, setStartGoalEdits('6_End', ['1_Start', '6_End']));
    expect((removed as { m_startGoals: string[] }).m_startGoals).toEqual(['1_Start']);
    // The p3-04 toggle ignores an empty name rather than writing one into the list.
    expect(setStartGoalEdits('', ['1_Start'])).toEqual([]);
  });

  it('expresses every builder only through shared/document primitives', () => {
    const batches: DocEdit[][] = [
      addGoalLogicEntryEdits(undefined),
      deleteGoalLogicEntryEdits(0),
      connectGoalsEdits(logicQuest(), '4_Right', '3_Left', 'and'),
      disconnectEdgeEdits(buildGoalLogicGraph(logicQuest()).edges[0], 1),
      setStartGoalEdits('A', []),
    ];
    for (const batch of batches) {
      for (const edit of batch) {
        expect(['set', 'delete', 'insert']).toContain(edit.op);
        expect(Array.isArray(edit.path)).toBe(true);
      }
    }
  });
});
