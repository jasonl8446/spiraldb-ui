import { describe, expect, it } from 'vitest';

import { applyEdits, hasAtPath, type DocEdit, type JsonDocument } from '@shared/document';
import { GOAL_TYPES, GOAL_TYPE_VALUES } from '@shared/quest/typeConstants';

import {
  addGoalEdits,
  defaultGoalName,
  deleteGoalEdit,
  goalBadgeClass,
  goalBooleanFieldEdit,
  goalBountyTypeOptions,
  goalFieldDisplay,
  goalName,
  goalNumberFieldEdit,
  goalPath,
  goalSelectOptions,
  goalSelectValue,
  goalShortTypeName,
  goalSummaryLines,
  goalTagsFieldEdit,
  goalTextFieldEdit,
  goalTitleKey,
  goalTypeFields,
  goalTypeSelectOptions,
  goalTypeSpecForGoal,
  goalTypeSpecForTypeString,
  GOAL_BASE_FIELDS,
  GOAL_COMPLEX_FIELDS,
  GOAL_EDITABLE_BASE_FIELDS,
  GOAL_TYPE_BADGE_FALLBACK,
  GOAL_TYPE_SPECS,
  isStartGoal,
  KNOWN_GOAL_KEYS,
  moveGoalEdits,
  newGoalObject,
  npcNameSuggestions,
  rawGoalFields,
  startGoalNames,
  toggleStartGoalEdits,
  unmodelledGoalKeys,
} from '../../client/src/lib/quest-goals';

/**
 * The Goals tab's pure rules (plan task 3.4 / story p3-04).
 *
 * Everything asserted here is a rule a browser cannot state more clearly: the 5-type
 * table keyed to the corpus `$type` strings, the 24-key partition, and the edit builders
 * whose edge cases (a minority `m_goalType`, an absent key, a sparse goal, a NaN number)
 * are exactly where a form silently corrupts a document. Every builder is applied to a
 * document with `applyEdits`, so the assertions are about real documents.
 */

/**
 * The `null`-carrying builders answer "no edit at all" for an empty value on an absent key
 * (module header rule 2, D59(c)) — a state these cases are deliberately not in, so `must`
 * states the intent instead of loosening the model's contract.
 */
function must(edit: DocEdit | null): DocEdit {
  if (edit === null) {
    throw new Error('expected an edit, received null (that means "no edit at all")');
  }
  return edit;
}

/**
 * The fixture's own shape. `JsonDocument` is deliberately `unknown` (`shared/document.ts`
 * L37: a document is whatever was parsed), so this test states what *it* knows about the
 * fixture it built.
 */
interface QuestFixture {
  m_questName: string;
  m_startGoals: string[];
  m_goals: Array<Record<string, unknown>>;
}

/** A minimal but corpus-shaped quest document: the fixture the builders are applied to. */
function questDoc(): QuestFixture {
  return {
    m_questName: 'DS-ACAD1-C01-001',
    m_startGoals: ['1_WizardQuestGoals_00000058'],
    m_goals: [
      {
        $type: GOAL_TYPES.WaypointGoalTemplate,
        m_goalName: '1_WizardQuestGoals_00000058',
        m_goalType: 'GOAL_TYPE_WAYPOINT',
        m_zoneTag: 'DragonSpire/DS_A3_Kings/DS_A3Z1_CrystalGrove',
        m_zoneEntry: true,
        m_zoneExit: false,
        m_proximityTag: '',
        m_clientTags: ['CollectCrystal3', 'Ddl_CollectCrystal_Grove1'],
        m_displayImage1: 'GUI/QuestButtons/Use_crystal_sample.dds',
      },
      {
        $type: GOAL_TYPES.BountyGoalTemplate,
        m_goalName: '2_WizardQuestGoals_00000067',
        m_goalType: 'GOAL_TYPE_BOUNTY',
        m_bountyTotal: 3,
        m_legacyUnmodelledKey: { nested: [1, 2, 3] },
      },
    ],
  };
}

/** The `m_goals` array of an applied document. */
function goalsOf(doc: JsonDocument): Array<Record<string, unknown>> {
  return (doc as { m_goals: Array<Record<string, unknown>> }).m_goals;
}

describe('the 5 goal types', () => {
  it('takes every $type from the p3-01 constant table, never a re-typed string', () => {
    expect(GOAL_TYPE_SPECS.map((spec) => [spec.shortName, spec.$type])).toStrictEqual([
      ['Waypoint', GOAL_TYPES.WaypointGoalTemplate],
      ['Persona', GOAL_TYPES.PersonaGoalTemplate],
      ['Bounty', GOAL_TYPES.BountyGoalTemplate],
      ['Scavenge', GOAL_TYPES.ScavengeGoalTemplate],
      ['AchieveRank', GOAL_TYPES.AchieveRankGoalTemplate],
    ]);
    // The corpus spelling, character for character (assembly-qualified, AC#8).
    expect(GOAL_TYPE_SPECS[0].$type).toBe(
      'Imcodec.ObjectProperty.TypeCache.WaypointGoalTemplate, Imcodec.ObjectProperty',
    );
  });

  it('carries the measured majority m_goalType and the spec badge colour for each type', () => {
    expect(GOAL_TYPE_SPECS.map((spec) => [spec.shortName, spec.defaultGoalType])).toStrictEqual([
      ['Waypoint', 'GOAL_TYPE_WAYPOINT'],
      ['Persona', 'GOAL_TYPE_PERSONA'],
      ['Bounty', 'GOAL_TYPE_BOUNTYCOLLECT'],
      ['Scavenge', 'GOAL_TYPE_SCAVENGE'],
      ['AchieveRank', 'GOAL_TYPE_ACHIEVERANK'],
    ]);
    // Every default is one of the 7 measured values — nothing invented.
    for (const spec of GOAL_TYPE_SPECS) {
      expect(GOAL_TYPE_VALUES).toContain(spec.defaultGoalType);
    }
    expect(GOAL_TYPE_SPECS.map((spec) => spec.badgeClass)).toStrictEqual([
      'border-blue-500 bg-blue-500/15 text-blue-300',
      'border-purple-500 bg-purple-500/15 text-purple-300',
      'border-red-500 bg-red-500/15 text-red-300',
      'border-amber-500 bg-amber-500/15 text-amber-300',
      'border-emerald-500 bg-emerald-500/15 text-emerald-300',
    ]);
  });

  it('offers each type its own fields, including the ones the corpus rarely fills', () => {
    const fields = Object.fromEntries(
      GOAL_TYPE_SPECS.map((spec) => [spec.shortName, spec.fields.map((field) => field.key)]),
    );
    expect(fields).toStrictEqual({
      Waypoint: ['m_zoneTag', 'm_zoneEntry', 'm_zoneExit', 'm_proximityTag'],
      Persona: ['m_personaName', 'm_usePatron'],
      Bounty: ['m_npcAdjectives', 'm_bountyTotal', 'm_bountyType'],
      // `m_itemAdjectives` is absent from all 47 Scavenge goals in the corpus and is
      // still offered, because §3.4 requires every type-specific field to be editable.
      Scavenge: ['m_itemAdjectives', 'm_itemTotal'],
      AchieveRank: ['m_rank'],
    });
  });

  it('resolves a goal class from $type first and from m_goalType only as a fallback', () => {
    expect(goalTypeSpecForGoal({ $type: GOAL_TYPES.ScavengeGoalTemplate })?.shortName).toBe(
      'Scavenge',
    );
    // `$type` wins over a contradicting m_goalType — the value Imlight deserializes on.
    expect(
      goalTypeSpecForGoal({
        $type: GOAL_TYPES.PersonaGoalTemplate,
        m_goalType: 'GOAL_TYPE_WAYPOINT',
      })?.shortName,
    ).toBe('Persona');
    // An unknown $type falls back to the majority m_goalType.
    expect(
      goalTypeSpecForGoal({ $type: 'SomethingElse', m_goalType: 'GOAL_TYPE_SCAVENGE' })?.shortName,
    ).toBe('Scavenge');
    // The minority variants are NOT a confirmed pairing for a class: no guessing.
    expect(goalTypeSpecForGoal({ m_goalType: 'GOAL_TYPE_BOUNTY' })).toBeUndefined();
    expect(goalTypeSpecForGoal({ m_goalType: 'GOAL_TYPE_USAGE' })).toBeUndefined();
    expect(goalTypeSpecForTypeString('nonsense')).toBeUndefined();
  });

  it('names the type for display, falling back to the raw m_goalType, never to a guess', () => {
    expect(goalShortTypeName({ $type: GOAL_TYPES.AchieveRankGoalTemplate })).toBe(
      'AchieveRankGoalTemplate',
    );
    expect(goalShortTypeName({ $type: 'TotallyUnknown' })).toBe('TotallyUnknown');
    expect(goalShortTypeName({ m_goalType: 'GOAL_TYPE_USAGE' })).toBe('GOAL_TYPE_USAGE');
    expect(goalShortTypeName({})).toBe('unknown');
  });

  it('colours a badge by the resolved type and falls back for an unknown goal', () => {
    expect(goalBadgeClass({ $type: GOAL_TYPES.BountyGoalTemplate })).toBe(
      'border-red-500 bg-red-500/15 text-red-300',
    );
    expect(goalBadgeClass({ $type: 'Nothing' })).toBe(GOAL_TYPE_BADGE_FALLBACK);
    expect(goalBadgeClass(null)).toBe(GOAL_TYPE_BADGE_FALLBACK);
    expect(goalTypeFields({ $type: GOAL_TYPES.AchieveRankGoalTemplate })).toHaveLength(1);
    expect(goalTypeFields({ $type: 'Nothing' })).toStrictEqual([]);
  });
});

describe('the shared base field partition', () => {
  it('is exactly the 24 spec keys: 17 editable + 7 complex, none dropped or duplicated', () => {
    expect(GOAL_BASE_FIELDS).toHaveLength(24);
    expect(new Set(GOAL_BASE_FIELDS).size).toBe(24);
    const modelled = [
      ...GOAL_EDITABLE_BASE_FIELDS.map((field) => field.key),
      ...GOAL_COMPLEX_FIELDS.map((field) => field.key),
    ];
    expect(modelled).toHaveLength(24);
    expect(new Set(modelled)).toStrictEqual(new Set(GOAL_BASE_FIELDS));
    // The partition keeps the spec table's order inside each half.
    expect(GOAL_EDITABLE_BASE_FIELDS.map((field) => field.key)).toStrictEqual([
      'm_goalName',
      'm_goalNameID',
      'm_goalTitle',
      'm_goalUnderway',
      'm_hyperlink',
      'm_completeText',
      'm_locationName',
      'm_displayImage1',
      'm_displayImage2',
      'm_clientTags',
      'm_autoQualify',
      'm_autoComplete',
      'm_destinationZone',
      'm_goalType',
      'm_noQuestHelper',
      'm_petOnlyQuest',
      'm_hideGoalFloatyText',
    ]);
    expect(GOAL_COMPLEX_FIELDS.map((field) => field.key)).toStrictEqual([
      'm_completeResults',
      'm_goalRequirements',
      'm_tallyCounter',
      'm_genericEvents',
      'm_dialogList',
      'm_activateResults',
      'm_behaviors',
    ]);
  });

  it('knows $type + the 24 base fields + the 12 type-specific keys', () => {
    expect(KNOWN_GOAL_KEYS).toHaveLength(1 + 24 + 12);
    expect(KNOWN_GOAL_KEYS).toContain('$type');
    expect(KNOWN_GOAL_KEYS).toContain('m_zoneTag');
    expect(KNOWN_GOAL_KEYS).toContain('m_rank');
    expect(KNOWN_GOAL_KEYS).not.toContain('m_legacyUnmodelledKey');
  });

  it('names the complex fields no Phase-3 tab owns', () => {
    const unowned = GOAL_COMPLEX_FIELDS.filter((field) => field.owner === null).map(
      (field) => field.key,
    );
    expect(unowned).toStrictEqual(['m_tallyCounter', 'm_genericEvents', 'm_behaviors']);
  });
});

describe('creating a goal of each type', () => {
  it('writes the right $type, the majority m_goalType and the type-specific fields', () => {
    const expected: Array<[string, string, string, Record<string, unknown>]> = [
      [
        'Waypoint',
        GOAL_TYPES.WaypointGoalTemplate,
        'GOAL_TYPE_WAYPOINT',
        { m_zoneTag: '', m_zoneEntry: false, m_zoneExit: false, m_proximityTag: '' },
      ],
      [
        'Persona',
        GOAL_TYPES.PersonaGoalTemplate,
        'GOAL_TYPE_PERSONA',
        { m_personaName: '', m_usePatron: false },
      ],
      [
        'Bounty',
        GOAL_TYPES.BountyGoalTemplate,
        'GOAL_TYPE_BOUNTYCOLLECT',
        { m_npcAdjectives: [], m_bountyTotal: 0, m_bountyType: '' },
      ],
      [
        'Scavenge',
        GOAL_TYPES.ScavengeGoalTemplate,
        'GOAL_TYPE_SCAVENGE',
        { m_itemAdjectives: [], m_itemTotal: 0 },
      ],
      ['AchieveRank', GOAL_TYPES.AchieveRankGoalTemplate, 'GOAL_TYPE_ACHIEVERANK', { m_rank: 0 }],
    ];

    for (const [type, $type, goalType, fields] of expected) {
      const doc = applyEdits({ m_questName: 'Q', m_goals: [] }, addGoalEdits(type as never, [], 0));
      const goals = goalsOf(doc);
      expect(goals, type).toHaveLength(1);
      expect(goals[0].$type, type).toBe($type);
      expect(goals[0].m_goalType, type).toBe(goalType);
      for (const [key, value] of Object.entries(fields)) {
        expect(goals[0][key], `${type}.${key}`).toStrictEqual(value);
      }
      // The corpus-shaped base keys are all there (759 of 772 measured goals).
      for (const key of GOAL_BASE_FIELDS) {
        expect(Object.keys(goals[0]), `${type}.${key}`).toContain(key);
      }
      expect(goals[0].m_goalName).toBe('1_WizardQuestGoals_00000000');
      expect(goals[0].m_startGoals).toBeUndefined();
    }
  });

  it('appends to m_goals and leaves the existing goals byte-identical', () => {
    const before = questDoc();
    const after = applyEdits(before, addGoalEdits('AchieveRank', ['x'], 2));
    const goals = goalsOf(after);
    expect(goals).toHaveLength(3);
    expect(goals[2].$type).toBe(GOAL_TYPES.AchieveRankGoalTemplate);
    // The two original goals are untouched, key order included.
    expect(JSON.stringify(goals[0])).toBe(
      JSON.stringify((before as { m_goals: unknown[] }).m_goals[0]),
    );
    expect(JSON.stringify(goals[1])).toBe(
      JSON.stringify((before as { m_goals: unknown[] }).m_goals[1]),
    );
    expect((after as { m_questName: string }).m_questName).toBe('DS-ACAD1-C01-001');
  });

  it('generates a unique default name in the corpus shape', () => {
    expect(defaultGoalName(0, [])).toBe('1_WizardQuestGoals_00000000');
    expect(defaultGoalName(6, [])).toBe('7_WizardQuestGoals_00000000');
    // Uniqueness within the quest: the serial is bumped past a taken name.
    expect(defaultGoalName(0, ['1_WizardQuestGoals_00000000'])).toBe('1_WizardQuestGoals_00000001');
    const taken = ['3_WizardQuestGoals_00000000', '3_WizardQuestGoals_00000001'];
    expect(defaultGoalName(2, taken)).toBe('3_WizardQuestGoals_00000002');
  });

  it('builds the new goal object with the type fields last, in the type field order', () => {
    const goal = newGoalObject('Waypoint', 'x');
    expect(Object.keys(goal).slice(0, 2)).toStrictEqual(['$type', 'm_goalName']);
    expect(Object.keys(goal).slice(-4)).toStrictEqual([
      'm_zoneTag',
      'm_zoneEntry',
      'm_zoneExit',
      'm_proximityTag',
    ]);
    expect(() => newGoalObject('Nope' as never, 'x')).toThrow(/unknown goal type/);
  });
});

describe('an existing goal is never normalised', () => {
  it('preserves a minority m_goalType through an unrelated edit and a start toggle', () => {
    const before = questDoc();
    // Goal 1 carries the minority GOAL_TYPE_BOUNTY (4 of 100 Bounty goals).
    expect(goalsOf(before)[1].m_goalType).toBe('GOAL_TYPE_BOUNTY');
    const after = applyEdits(
      before,
      [
        goalNumberFieldEdit(1, 'm_bountyTotal', true, '9'),
        ...toggleStartGoalEdits('2_WizardQuestGoals_00000067', before.m_startGoals),
      ].flatMap((edit) => (edit === null ? [] : [edit])),
    );
    const goal = goalsOf(after)[1];
    expect(goal.m_bountyTotal).toBe(9);
    expect(goal.m_goalType).toBe('GOAL_TYPE_BOUNTY');
    expect(goal.$type).toBe(GOAL_TYPES.BountyGoalTemplate);
    // Adding a NEW Bounty goal still writes the majority value.
    const withNew = applyEdits(after, addGoalEdits('Bounty', [], 2));
    expect(goalsOf(withNew)[2].m_goalType).toBe('GOAL_TYPE_BOUNTYCOLLECT');
  });

  it('keeps an absent key absent when another field of the goal is edited', () => {
    const doc: JsonDocument = {
      m_goals: [{ $type: GOAL_TYPES.WaypointGoalTemplate, m_goalName: 'a', m_zoneEntry: false }],
    };
    const after = applyEdits(doc, [goalBooleanFieldEdit(0, 'm_autoQualify', true)]);
    const goal = goalsOf(after)[0];
    expect(goal.m_autoQualify).toBe(true);
    expect('m_zoneTag' in goal).toBe(false);
    expect('m_proximityTag' in goal).toBe(false);
    expect(Object.keys(goal)).toStrictEqual([
      '$type',
      'm_goalName',
      'm_zoneEntry',
      'm_autoQualify',
    ]);
    // And clearing the field that was never there is no edit at all.
    expect(goalTextFieldEdit(0, 'm_zoneTag', false, '')).toBeNull();
  });

  it('leaves a sparse (14-key, extracted) goal sparse through an edit', () => {
    // The 13 sparse goals in the corpus come from this tool's own extraction output:
    // 14 or 15 base keys, the complex ones (and sometimes m_goalUnderway and friends)
    // simply absent. Editing a present field must not pad it out to 24 keys.
    const sparse: Record<string, unknown> = {
      $type: GOAL_TYPES.PersonaGoalTemplate,
      m_goalName: '1_WizardQuestGoals_00000015',
      m_goalNameID: 0,
      m_goalTitle: '',
      m_locationName: '',
      m_displayImage1: '',
      m_displayImage2: null,
      m_autoQualify: false,
      m_autoComplete: false,
      m_destinationZone: '',
      m_goalType: 'GOAL_TYPE_PERSONA',
      m_noQuestHelper: false,
      m_petOnlyQuest: false,
      m_hideGoalFloatyText: false,
      m_personaName: 'WC-HUB-NPC01',
    };
    const before = Object.keys(sparse);
    const doc: JsonDocument = { m_questName: 'Q', m_goals: [sparse] };
    const after = applyEdits(doc, [goalBooleanFieldEdit(0, 'm_autoComplete', true)]);
    const goal = goalsOf(after)[0];
    expect(Object.keys(goal)).toStrictEqual(before);
    expect(goal.m_autoComplete).toBe(true);
    expect(goal.m_personaName).toBe('WC-HUB-NPC01');
    // None of the 24-key pad keys appeared.
    for (const key of GOAL_BASE_FIELDS) {
      expect(Object.keys(goal).includes(key), key).toBe(before.includes(key));
    }
  });

  it('preserves unmodelled keys and reports them for the disclosure', () => {
    const doc = questDoc();
    const after = applyEdits(doc, [must(goalNumberFieldEdit(1, 'm_bountyTotal', true, '5'))]);
    expect(goalsOf(after)[1].m_legacyUnmodelledKey).toStrictEqual({ nested: [1, 2, 3] });
    expect(unmodelledGoalKeys(goalsOf(doc)[1])).toStrictEqual(['m_legacyUnmodelledKey']);
    expect(unmodelledGoalKeys({ $type: 'x', m_goalName: 'y' })).toStrictEqual([]);
    expect(unmodelledGoalKeys(null)).toStrictEqual([]);
  });

  it('collects the complex fields and the unmodelled keys, in the goal key order', () => {
    const goal = {
      $type: GOAL_TYPES.BountyGoalTemplate,
      m_goalName: 'a',
      m_completeResults: {},
      m_behaviors: null,
      m_legacyThing: 1,
      m_bountyTotal: 2,
    };
    expect(rawGoalFields(goal)).toStrictEqual({
      m_completeResults: {},
      m_behaviors: null,
      m_legacyThing: 1,
    });
    // Absent complex fields are not invented.
    expect(rawGoalFields({ m_goalName: 'a' })).toStrictEqual({});
    expect(rawGoalFields(null)).toStrictEqual({});
  });
});

describe('deleting, moving and start membership', () => {
  it('deletes one goal and leaves every other element (and key order) alone', () => {
    const before = questDoc();
    const after = applyEdits(before, [deleteGoalEdit(0)]);
    const goals = goalsOf(after);
    expect(goals).toHaveLength(1);
    expect(goals[0].m_goalName).toBe('2_WizardQuestGoals_00000067');
    expect(JSON.stringify(goals[0])).toBe(
      JSON.stringify((before as { m_goals: unknown[] }).m_goals[1]),
    );
    // Deliberately no cascade: the dangling start reference is the state plan §3.9's
    // validation criterion is written against.
    expect((after as { m_startGoals: string[] }).m_startGoals).toStrictEqual([
      '1_WizardQuestGoals_00000058',
    ]);
  });

  it('moves a goal: delete-then-insert yields arrayMove semantics, key order intact', () => {
    const doc: JsonDocument = {
      m_goals: [{ n: 'A' }, { n: 'B' }, { n: 'C' }],
    };
    const names = (d: JsonDocument): string[] => goalsOf(d).map((goal) => String(goal.n));

    // Forward and backward moves, both against arrayMove's own answer.
    expect(names(applyEdits(doc, moveGoalEdits(0, 2, { n: 'A' })))).toStrictEqual(['B', 'C', 'A']);
    expect(names(applyEdits(doc, moveGoalEdits(2, 0, { n: 'C' })))).toStrictEqual(['C', 'A', 'B']);
    expect(names(applyEdits(doc, moveGoalEdits(0, 1, { n: 'A' })))).toStrictEqual(['B', 'A', 'C']);
    expect(names(applyEdits(doc, moveGoalEdits(1, 0, { n: 'B' })))).toStrictEqual(['B', 'A', 'C']);
    // A no-op move edits nothing at all.
    expect(moveGoalEdits(1, 1, { n: 'B' })).toStrictEqual([]);
    expect(applyEdits(doc, moveGoalEdits(1, 1, { n: 'B' }))).toBe(doc);
  });

  it('keeps every goal object byte-identical (key order included) across a reorder', () => {
    const before = questDoc();
    const goals = goalsOf(before);
    const after = applyEdits(before, moveGoalEdits(0, 1, goals[0]));
    expect(goalsOf(after).map((goal) => goal.m_goalName)).toStrictEqual([
      '2_WizardQuestGoals_00000067',
      '1_WizardQuestGoals_00000058',
    ]);
    expect(JSON.stringify(goalsOf(after)[0])).toBe(JSON.stringify(goals[1]));
    expect(JSON.stringify(goalsOf(after)[1])).toBe(JSON.stringify(goals[0]));
  });

  it('toggles a start name: append, then remove that one element', () => {
    const before = questDoc();
    expect(isStartGoal(goalsOf(before)[0], before.m_startGoals)).toBe(true);
    expect(isStartGoal(goalsOf(before)[1], before.m_startGoals)).toBe(false);
    // Add the second goal to the start list (appended, existing entry untouched). The
    // builder addresses the document's own array length, so the fixture's existing
    // entry stays first — nothing is rebuilt and nothing is reordered.
    const added = applyEdits(before, toggleStartGoalEdits('2_WizardQuestGoals_00000067', ['1_a']));
    expect((added as { m_startGoals: string[] }).m_startGoals).toStrictEqual([
      '1_WizardQuestGoals_00000058',
      '2_WizardQuestGoals_00000067',
    ]);
    // Remove it again: a single-element delete of the matching element, not a rebuilt
    // array (the fixture's first entry keeps its place).
    const removed = applyEdits(
      added,
      toggleStartGoalEdits('2_WizardQuestGoals_00000067', [
        '1_WizardQuestGoals_00000058',
        '2_WizardQuestGoals_00000067',
      ]),
    );
    expect((removed as { m_startGoals: string[] }).m_startGoals).toStrictEqual([
      '1_WizardQuestGoals_00000058',
    ]);
    // A missing list is created only when Start is turned ON.
    expect(toggleStartGoalEdits('a', undefined)).toStrictEqual([
      { op: 'set', path: ['m_startGoals'], value: ['a'] },
    ]);
    expect(toggleStartGoalEdits('a', null)).toStrictEqual([
      { op: 'set', path: ['m_startGoals'], value: ['a'] },
    ]);
    expect(toggleStartGoalEdits('a', ['a'])).toStrictEqual([
      { op: 'delete', path: ['m_startGoals', 0] },
    ]);
    // An unnamed goal cannot be a start goal: no edits.
    expect(toggleStartGoalEdits('', [])).toStrictEqual([]);
    expect(startGoalNames(['a', 7, null, 'b'])).toStrictEqual(['a', 'b']);
    expect(startGoalNames(null)).toStrictEqual([]);
  });
});

describe('the scalar field edits', () => {
  it('sets a non-empty string and deletes on empty only when the key exists', () => {
    expect(goalTextFieldEdit(1, 'm_zoneTag', true, 'A/B')).toStrictEqual({
      op: 'set',
      path: ['m_goals', 1, 'm_zoneTag'],
      value: 'A/B',
    });
    expect(goalTextFieldEdit(1, 'm_zoneTag', true, '')).toStrictEqual({
      op: 'delete',
      path: ['m_goals', 1, 'm_zoneTag'],
    });
    expect(goalTextFieldEdit(1, 'm_zoneTag', false, '')).toBeNull();
    expect(goalPath(2)).toStrictEqual(['m_goals', 2]);
    expect(goalPath(2, 'm_rank')).toStrictEqual(['m_goals', 2, 'm_rank']);
  });

  it('writes numbers exactly as parsed and refuses a non-finite intermediate', () => {
    expect(goalNumberFieldEdit(0, 'm_bountyTotal', true, '3')).toStrictEqual({
      op: 'set',
      path: ['m_goals', 0, 'm_bountyTotal'],
      value: 3,
    });
    expect(goalNumberFieldEdit(0, 'm_bountyTotal', true, '2.5')).toStrictEqual({
      op: 'set',
      path: ['m_goals', 0, 'm_bountyTotal'],
      value: 2.5,
    });
    expect(goalNumberFieldEdit(0, 'm_bountyTotal', true, '1e')).toBeNull();
    expect(goalNumberFieldEdit(0, 'm_bountyTotal', true, '-')).toBeNull();
    expect(goalNumberFieldEdit(0, 'm_bountyTotal', true, 'abc')).toBeNull();
    expect(goalNumberFieldEdit(0, 'm_bountyTotal', true, '')).toStrictEqual({
      op: 'delete',
      path: ['m_goals', 0, 'm_bountyTotal'],
    });
    expect(goalNumberFieldEdit(0, 'm_bountyTotal', false, '  ')).toBeNull();
  });

  it('parses tags without reordering, deduplicating or normalising', () => {
    expect(goalTagsFieldEdit(0, 'm_npcAdjectives', true, 'mob, boss')).toStrictEqual({
      op: 'set',
      path: ['m_goals', 0, 'm_npcAdjectives'],
      value: ['mob', 'boss'],
    });
    expect(goalTagsFieldEdit(0, 'm_npcAdjectives', true, 'b, a, b')).toStrictEqual({
      op: 'set',
      path: ['m_goals', 0, 'm_npcAdjectives'],
      value: ['b', 'a', 'b'],
    });
    expect(goalTagsFieldEdit(0, 'm_npcAdjectives', true, '')).toStrictEqual({
      op: 'delete',
      path: ['m_goals', 0, 'm_npcAdjectives'],
    });
    expect(goalTagsFieldEdit(0, 'm_npcAdjectives', false, '   ')).toBeNull();
  });

  it('writes a checkbox state as a real boolean', () => {
    expect(goalBooleanFieldEdit(3, 'm_usePatron', true)).toStrictEqual({
      op: 'set',
      path: ['m_goals', 3, 'm_usePatron'],
      value: true,
    });
    expect(goalBooleanFieldEdit(3, 'm_usePatron', false)).toStrictEqual({
      op: 'set',
      path: ['m_goals', 3, 'm_usePatron'],
      value: false,
    });
  });

  it('applies a whole field edit to the right goal of a real document', () => {
    const after = applyEdits(questDoc(), [
      must(goalTextFieldEdit(1, 'm_hyperlink', false, 'http://x')),
    ]);
    expect(hasAtPath(after, ['m_goals', 1, 'm_hyperlink'])).toBe(true);
    expect(hasAtPath(after, ['m_goals', 0, 'm_hyperlink'])).toBe(false);
    expect(goalsOf(after)[1].m_hyperlink).toBe('http://x');
  });
});

describe('the goal selects', () => {
  it('offers the 7 measured m_goalType values and keeps an unlisted one selected', () => {
    expect(goalTypeSelectOptions('GOAL_TYPE_BOUNTY').map((option) => option.value)).toStrictEqual([
      ...GOAL_TYPE_VALUES,
    ]);
    const unlisted = goalTypeSelectOptions('GOAL_TYPE_FUTURE');
    expect(unlisted.at(-1)).toStrictEqual({
      value: 'GOAL_TYPE_FUTURE',
      label: 'GOAL_TYPE_FUTURE',
      unlisted: true,
    });
    expect(goalSelectValue('GOAL_TYPE_FUTURE')).toBe('GOAL_TYPE_FUTURE');
    // No usable value: one leading unset option, never a snap to a listed value.
    expect(goalSelectOptions(null, ['a'])[0]).toStrictEqual({
      value: '',
      label: '—',
      unlisted: false,
    });
    expect(goalSelectValue(null)).toBe('');
    expect(goalSelectValue(7)).toBe('');
  });

  it('offers the one measured m_bountyType value', () => {
    expect(goalBountyTypeOptions('BT_MOB_KILL').map((option) => option.value)).toStrictEqual([
      'BT_MOB_KILL',
    ]);
    expect(goalBountyTypeOptions('BT_FUTURE').map((option) => option.value)).toStrictEqual([
      'BT_MOB_KILL',
      'BT_FUTURE',
    ]);
  });
});

describe('the card summary and the person A name suggestions', () => {
  it('renders a Waypoint card as the spec ASCII does', () => {
    const goal = goalsOf(questDoc())[0];
    expect(goalSummaryLines(goal)).toStrictEqual([
      { label: 'Zone', value: 'DragonSpire/DS_A3_Kings/DS_A3Z1_CrystalGrove' },
      { label: 'Entry', value: '✓' },
      { label: 'Exit', value: '✗' },
      { label: 'Proximity Tag', value: '(empty)' },
      { label: 'Client Tags', value: 'CollectCrystal3, Ddl_CollectCrystal_Grove1' },
      { label: 'Display Image', value: 'GUI/QuestButtons/Use_crystal_sample.dds' },
    ]);
  });

  it('omits the Client Tags and Display Image lines when the goal has neither', () => {
    expect(
      goalSummaryLines({ $type: GOAL_TYPES.AchieveRankGoalTemplate, m_rank: 4 }),
    ).toStrictEqual([{ label: 'Rank', value: '4' }]);
    // An unknown class still yields the two shared lines, so nothing is hidden.
    expect(
      goalSummaryLines({ $type: 'Nothing', m_clientTags: ['a'], m_displayImage1: 'x.dds' }),
    ).toStrictEqual([
      { label: 'Client Tags', value: 'a' },
      { label: 'Display Image', value: 'x.dds' },
    ]);
  });

  it('renders booleans and empty values honestly', () => {
    const field = { key: 'm_zoneTag', kind: 'zone' as const, label: 'Zone', help: '' };
    expect(goalFieldDisplay(field, 'A/B')).toBe('A/B');
    expect(goalFieldDisplay(field, null)).toBe('(empty)');
    expect(goalFieldDisplay(field, '')).toBe('(empty)');
    const flag = { key: 'm_zoneEntry', kind: 'boolean' as const, label: 'Entry', help: '' };
    expect(goalFieldDisplay(flag, true)).toBe('✓');
    expect(goalFieldDisplay(flag, false)).toBe('✗');
    expect(goalFieldDisplay(flag, undefined)).toBe('—');
    const tags = { key: 'm_clientTags', kind: 'tags' as const, label: 'Tags', help: '' };
    expect(goalFieldDisplay(tags, null)).toBe('(empty)');
    expect(goalFieldDisplay(tags, ['a'])).toBe('a');
  });

  it('suggests npc names with the current value first, filtered and capped', () => {
    const rows = [
      { name: 'WC-HUB-NPC01' },
      { name: 'WC-GTW-Registrar' },
      { name: null },
      { name: '' },
    ];
    expect(npcNameSuggestions(rows, 'WC-UNLISTED', '')).toStrictEqual([
      'WC-UNLISTED',
      'WC-HUB-NPC01',
      'WC-GTW-Registrar',
    ]);
    expect(npcNameSuggestions(rows, '', 'registrar')).toStrictEqual(['WC-GTW-Registrar']);
    expect(npcNameSuggestions(rows, '', '')).toStrictEqual(['WC-HUB-NPC01', 'WC-GTW-Registrar']);
    expect(npcNameSuggestions(rows, '', '', 1)).toStrictEqual(['WC-HUB-NPC01']);
  });

  it('reads the goal name and the string-table title key, tolerating the empty key', () => {
    expect(goalName({ m_goalName: '1_a' })).toBe('1_a');
    expect(goalName({ m_goalName: '' })).toBeNull();
    expect(goalName(null)).toBeNull();
    expect(goalTitleKey({ m_goalTitle: 'WizardQuestGoals_UseItem' })).toBe(
      'WizardQuestGoals_UseItem',
    );
    // 26 corpus goals carry `m_goalTitle: ""`: no lookup may be requested for it.
    expect(goalTitleKey({ m_goalTitle: '' })).toBeNull();
    expect(goalTitleKey({ m_goalTitle: null })).toBeNull();
    expect(goalTitleKey({})).toBeNull();
  });
});
