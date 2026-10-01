import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  QuestOverviewView,
  firstPendingTab,
  suggestionBadgeText,
} from '../../client/src/components/quest/QuestOverview';
import { NO_CARD_NAMES, cardNamesFromRows } from '../../client/src/lib/card-titles';
import {
  ORDER_AS_STORED,
  ORDER_BY_LOGIC,
  buildQuestOverview,
} from '../../client/src/lib/quest-overview';
import type { Suggestion } from '../../client/src/lib/suggestions';
import fixture from './fixtures/card-titles-quests.json';

/**
 * Task 7.13 (p7-14, D133, D181): the Overview tab's text, pinned over one real quest per goal
 * class from the D17 clone (`data/test-spiraldb`, 322 quests) with the names the synced database
 * resolves for the ids they reference. The documents and name rows are p7-11's committed fixture
 * (`fixtures/card-titles-quests.json`), so the pins run in CI, where the clone does not exist.
 */

const names = cardNamesFromRows(fixture.names as never);
const quests = fixture.quests as Record<string, Record<string, unknown>>;

/** The rendered text, one line per list item or paragraph. */
function lines(html: string): string[] {
  return html
    .replace(/<\/(li|p|h3|button)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function render(doc: unknown, pending = 0, resolved = names): string[] {
  return lines(
    renderToStaticMarkup(
      createElement(QuestOverviewView, {
        overview: buildQuestOverview(doc, resolved),
        pending,
      }),
    ),
  );
}

/**
 * Goal classes and what each quest is here for:
 */
const PINNED: Record<string, string[]> = {
  // Waypoint + Persona goals; a chain of five with four start goals; ReqHasQuest under a list
  'DS-ACAD-C01-001': [
    'Given by Ashley (the Prep dialog speaker)',
    'Steps',
    'Order follows the goal logic.',
    '1. Go to Haunted Cave (Waypoint goal) — from the start · 1_WizardQuestGoals_UseItem',
    "2. Go to Biti's Chamber (Waypoint goal) — from the start · 2_WizardQuestGoals_UseItem",
    '3. Go to Shakes Clocktower (Waypoint goal) — from the start · 3_WizardQuestGoals_UseItem',
    '4. Go to Ancient Burial Grounds (Waypoint goal) — from the start · 4_WizardQuestGoals_UseItem',
    '5. Talk to Ashley (Persona goal) — after step 4 · 5_WizardQuestGoals_TalkNPC',
    'Completes when: step 5 is complete.',
    'No completion dialog',
    'Requires',
    'Requires quest: A Tale of Two Brothers',
    'Rewards',
    'Reward: drop table DS-ACAD-C01-001',
  ],
  // Waypoint + Persona goals; a linear chain
  'DS-ACAD-C01-002': [
    'Given by Ashley (the Prep dialog speaker)',
    'Steps',
    'Order follows the goal logic.',
    '1. Go to The Crystal Grove (Waypoint goal) — from the start · 1_WizardQuestGoals_ExploreZone',
    '2. Go to The Crystal Grove (Waypoint goal) — after step 1 · 2_WizardQuestGoals_Explore',
    '3. Talk to Zarek Pickmaster (Persona goal) — after step 2 · 3_WizardQuestGoals_TalkNPC',
    'Completes when: step 3 is complete.',
    'No completion dialog',
    'Requires',
    'Requires quest: Wizard Tours',
    'Rewards',
    'Reward: drop table DS-ACAD-C01-002',
  ],
  // Scavenge (collect) + Persona; a Prep speaker resolved from an NPC id
  'DS-ACAD1-C04-001': [
    'Given by Milaka Jewelbender (the Prep dialog speaker)',
    'Steps',
    'Order follows the goal logic.',
    '1. Collect items in The Crystal Grove (Scavenge goal) — from the start · 1_WizardQuestGoals_KillCollect',
    '2. Talk to Milaka Jewelbender (Persona goal) — after step 1 · 2_WizardQuestGoals_TalkNPC',
    'Completes when: step 2 is complete.',
    'No completion dialog',
    'Requires',
    'Requires quest: Quest for Perfection',
    'Rewards',
    'Reward: drop table DS-ACAD1-C04-001',
  ],
  // Bounty + Persona; a completion dialog; a registry-entry requirement
  'WC-UNICORN-MAIN-001': [
    'Given by Private Connelly (the Prep dialog speaker)',
    'Steps',
    'Order follows the goal logic.',
    '1. Defeat 2 Lost_Soul in Unicorn Way (Bounty goal) — from the start · 1_WizardQuestGoals_Kill',
    '2. Talk to Private Connelly (Persona goal) — after step 1 · 2_WizardQuestGoals_TalkNPC',
    '3. Talk to Ceren Nightchant (Persona goal) — after step 2 · 3_WizardQuestGoals_TalkNPC',
    'Completes when: step 3 is complete.',
    'Completion dialog: spoken by Private Connelly',
    'Requires',
    'Requires quest registry entry: Complete in Unicorn Way',
    'Rewards',
    'Reward: drop table WC-UNICORN-MAIN-001',
  ],
  // Scavenge (use) + Bounty + Waypoint + Persona; NO m_goalLogic key (the fallback)
  'WC-UNICORN-MAIN-004': [
    'Given by Lady Oriel (the Prep dialog speaker)',
    'Steps',
    'Order shown as stored: this quest has no goal logic.',
    '1. Use an object in Unicorn Way (Scavenge goal) · 1_WizardQuestGoals_00000015',
    '2. Use an object in Unicorn Way (Scavenge goal) · 2_WizardQuestGoals_00000015',
    '3. Use an object in Unicorn Way (Scavenge goal) · 3_WizardQuestGoals_00000015',
    '4. Use an object in Unicorn Way (Scavenge goal) · 4_WizardQuestGoals_00000015',
    '5. Defeat 2 enemies in Unicorn Way (Bounty goal) · 5_WizardQuestGoals_KillCollect',
    '6. Go to Unicorn Way (Waypoint goal) · 6_WizardQuestGoals_Explore',
    '7. Talk to Lady Oriel (Persona goal) · 7_WizardQuestGoals_TalkNPC',
    'Completes when: not stated, because this quest has no goal logic.',
    'Completion dialog: spoken by Lady Oriel',
    'Requires',
    'No requirements',
    'Rewards',
    'No rewards',
  ],
  // a persona no NPC row resolves
  'WC-COMMONS-MAIN-003': [
    'Given by Merle Ambrose (the Prep dialog speaker)',
    'Steps',
    'Order follows the goal logic.',
    '1. Talk to WC-ST02-NPC01_Persona (Persona goal) — from the start · 1_WizardQuestGoals_TalkNPC',
    'Completes when: step 1 is complete.',
    'No completion dialog',
    'Requires',
    'Requires quest registry entry: Complete in To Ravenwood!',
    'Rewards',
    'Reward: drop table WC-COMMONS-MAIN-003',
  ],
  // Waypoint + Persona; a completion dialog
  'WC-COMMONS-MAIN-001': [
    'Given by Merle Ambrose (the Prep dialog speaker)',
    'Steps',
    'Order follows the goal logic.',
    '1. Go to Unicorn Way (Waypoint goal) — from the start · 1_WizardQuestGoals_EncounterExplore',
    '2. Talk to Private Connelly (Persona goal) — after step 1 · 2_WizardQuestGoals_TalkNPC',
    'Completes when: step 2 is complete.',
    'Completion dialog: spoken by Private Connelly',
    'Requires',
    'No requirements',
    'Rewards',
    'Reward: drop table WC-COMMONS-MAIN-001',
  ],
  // AchieveRank goals; m_goalLogic present but empty (the fallback)
  'WC-TUT-C03-001': [
    'No Prep dialog speaker',
    'Steps',
    'Order shown as stored: this quest has no goal logic.',
    '1. Reach rank 1 (Achieve Rank goal) · player damage 1',
    '2. Reach rank 1 (Achieve Rank goal) · CloseDoor',
    '3. Reach rank 1 (Achieve Rank goal) · Clear hand mob 0',
    '4. Reach rank 1 (Achieve Rank goal) · Clear hand mob 1',
    '5. Reach rank 1 (Achieve Rank goal) · mob damage 2',
    '6. Reach rank 1 (Achieve Rank goal) · mob damage 3',
    '7. Reach rank 1 (Achieve Rank goal) · mob damage 4',
    '8. Reach rank 1 (Achieve Rank goal) · mob weakness',
    '9. Reach rank 1 (Achieve Rank goal) · mob damage 5',
    '10. Reach rank 1 (Achieve Rank goal) · mob damage 6',
    '11. Reach rank 1 (Achieve Rank goal) · mob damage 7',
    '12. Reach rank 1 (Achieve Rank goal) · mob damage 8',
    '13. Reach rank 1 (Achieve Rank goal) · player heal',
    '14. Reach rank 1 (Achieve Rank goal) · player damage 2',
    '15. Reach rank 1 (Achieve Rank goal) · player blade',
    '16. Reach rank 1 (Achieve Rank goal) · player damage 3',
    '17. Reach rank 1 (Achieve Rank goal) · Give 3 pips to player',
    '18. Reach rank 1 (Achieve Rank goal) · give 4 pips to player',
    '19. Reach rank 1 (Achieve Rank goal) · Update pips',
    'Completes when: not stated, because this quest has no goal logic.',
    'No completion dialog',
    'Requires',
    'No requirements',
    'Rewards',
    'No rewards',
  ],
  // AchieveRank goals; empty goal logic; a reward
  'WC-TUT-C05-001': [
    'No Prep dialog speaker',
    'Steps',
    'Order shown as stored: this quest has no goal logic.',
    '1. Reach rank 1 (Achieve Rank goal) · Trigger Storm',
    '2. Reach rank 1 (Achieve Rank goal) · Despawn Ambrose Outside',
    '3. Reach rank 1 (Achieve Rank goal) · Trigger Rubble',
    '4. Reach rank 1 (Achieve Rank goal) · Trigger Silhouette',
    '5. Reach rank 1 (Achieve Rank goal) · Walk Ambrose',
    'Completes when: not stated, because this quest has no goal logic.',
    'No completion dialog',
    'Requires',
    'No requirements',
    'Rewards',
    'Reward: drop table TEST',
  ],
  // AchieveRank, a start goal but empty goal logic
  Tutorial_Intro: [
    'No Prep dialog speaker',
    'Steps',
    'Order shown as stored: this quest has no goal logic.',
    '1. Reach rank 1 (Achieve Rank goal) · OnlyGoal',
    'Completes when: not stated, because this quest has no goal logic.',
    'No completion dialog',
    'Requires',
    'No requirements',
    'Rewards',
    'No rewards',
  ],
};

describe('the Overview text of one real quest per goal class', () => {
  for (const [name, expected] of Object.entries(PINNED)) {
    it(`${name}`, () => {
      expect(render(quests[name])).toEqual(expected);
    });
  }

  it('pins every quest of the fixture, and the classes it covers', () => {
    expect(Object.keys(PINNED).sort()).toEqual(Object.keys(quests).sort());
    const classes = new Set(
      Object.values(quests)
        .flatMap((quest) => quest.m_goals as { $type: string }[])
        .map((goal) => goal.$type.split(',')[0].split('.').pop()),
    );
    expect([...classes].sort()).toEqual([
      'AchieveRankGoalTemplate',
      'BountyGoalTemplate',
      'PersonaGoalTemplate',
      'ScavengeGoalTemplate',
      'WaypointGoalTemplate',
    ]);
  });

  it('never shows a generated goal id as a step title', () => {
    for (const quest of Object.values(quests)) {
      for (const line of render(quest).filter((entry) => /^\d+\. /.test(entry))) {
        expect(line).not.toMatch(/^\d+\. \d+_WizardQuestGoals_/);
      }
    }
  });
});

describe('the no-goal-logic fallback', () => {
  it('states array order for an absent, a null and an empty m_goalLogic', () => {
    const real = quests['WC-UNICORN-MAIN-004'];
    expect('m_goalLogic' in real).toBe(false);
    for (const goalLogic of [undefined, null, []]) {
      const doc: Record<string, unknown> = { ...quests['DS-ACAD-C01-002'], m_goalLogic: goalLogic };
      const overview = buildQuestOverview(doc, names);
      expect(overview.order).toBe(ORDER_AS_STORED);
      expect(overview.steps.map((step) => step.goalName)).toEqual(
        (doc.m_goals as { m_goalName: string }[]).map((goal) => goal.m_goalName),
      );
      expect(render(doc)).toContain('Order shown as stored: this quest has no goal logic.');
    }
    expect(render(real)).toContain('Order shown as stored: this quest has no goal logic.');
    expect(render(quests['DS-ACAD-C01-001'])).toContain(ORDER_BY_LOGIC);
  });

  it('keeps the stored order even when start goals are named', () => {
    const doc = quests['Tutorial_Intro'];
    expect(doc.m_startGoals).toEqual(['OnlyGoal']);
    expect(buildQuestOverview(doc, names).steps).toHaveLength(1);
  });
});

/** Synthetic goal logic (the corpus is an OR-free chain, D61(c)): branches, OR, loops. */
describe('goal logic the corpus does not contain (synthetic documents)', () => {
  const goal = (name: string): object => ({
    $type:
      'Imcodec.ObjectProperty.TypeCache.WizardQuestWaypointGoalTemplate, Imcodec.ObjectProperty',
    m_goalName: name,
    m_goalType: 'GOAL_TYPE_WAYPOINT',
  });
  const rule = (and: string[], add: string[], extra: object = {}): object => ({
    m_goalsAND: and,
    m_goalsOR: [],
    m_goalsToAdd: add,
    m_completeQuest: false,
    m_requiredORCount: 1,
    ...extra,
  });
  const doc = (goals: string[], start: string[], logic: object[]): object => ({
    m_goals: goals.map(goal),
    m_startGoals: start,
    m_goalLogic: logic,
  });
  const order = (document: object): string[] =>
    buildQuestOverview(document, NO_CARD_NAMES).steps.map(
      (step) => `${step.goalName}:${step.when}`,
    );

  it('lists a branch in the entry order and a joined goal after both prerequisites', () => {
    const d = doc(
      ['a', 'b', 'c', 'd'],
      ['a'],
      [
        rule(['a'], ['b', 'c']),
        rule(['b', 'c'], ['d']),
        rule(['d'], [], { m_completeQuest: true }),
      ],
    );
    expect(order(d)).toEqual([
      'a:from the start',
      'b:after step 1',
      'c:after step 1',
      'd:after steps 2 and 3',
    ]);
    expect(buildQuestOverview(d, NO_CARD_NAMES).completes).toBe(
      'Completes when: step 4 is complete.',
    );
  });

  it('places an OR goal once enough of its alternatives are placed', () => {
    const d = doc(
      ['a', 'b', 'c'],
      ['a', 'b'],
      [
        rule([], ['c'], { m_goalsOR: ['a', 'b'], m_requiredORCount: 2 }),
        rule([], [], { m_goalsOR: ['a', 'b'], m_requiredORCount: 1, m_completeQuest: true }),
      ],
    );
    expect(order(d)).toEqual([
      'a:from the start',
      'b:from the start',
      'c:after any 2 of steps 1, 2',
    ]);
    expect(buildQuestOverview(d, NO_CARD_NAMES).completes).toBe(
      'Completes when: any 1 of steps 1, 2 are complete.',
    );
  });

  it('lists a loop once, then says which goals were never reached', () => {
    const d = doc(
      ['a', 'b', 'c'],
      ['a'],
      [rule(['a'], ['b']), rule(['c'], ['c']), rule(['b'], ['a'])],
    );
    const overview = buildQuestOverview(d, NO_CARD_NAMES);
    expect(order(d)).toEqual([
      'a:from the start',
      'b:after step 1',
      'c:not reached from the start goals',
    ]);
    expect(overview.stepNotes).toEqual([
      '1 goal is never reached from the start goals (a loop, or a prerequisite the quest does not define); listed last, in stored order.',
    ]);
    expect(overview.completes).toBe('Completes when: no goal-logic entry completes the quest.');
  });

  it('is deterministic: the same document reads the same twice', () => {
    const d = doc(['a', 'b', 'c'], ['a'], [rule(['a'], ['b']), rule(['a'], ['c'])]);
    expect(order(d)).toEqual(order(JSON.parse(JSON.stringify(d))));
  });
});

describe('requirements in words', () => {
  const leaf = (quest: string, not = false): object => ({
    $type: 'Imcodec.ObjectProperty.TypeCache.ReqHasQuest, Imcodec.ObjectProperty',
    m_questName: quest,
    m_applyNOT: not,
  });

  it('spells an OR group, a nested group and a negated leaf', () => {
    const doc = {
      m_requirements: {
        m_operator: 'ROP_OR',
        m_requirements: [
          leaf('Q-A'),
          leaf('Q-B', true),
          { m_operator: 'ROP_AND', m_requirements: [leaf('Q-C'), leaf('Q-D')] },
        ],
      },
    };
    expect(buildQuestOverview(doc, NO_CARD_NAMES).requirements).toEqual([
      { depth: 0, text: 'Any one of these:' },
      { depth: 1, text: 'Requires quest: Q-A' },
      { depth: 1, text: 'Not: Requires quest: Q-B' },
      { depth: 1, text: 'All of these:' },
      { depth: 2, text: 'Requires quest: Q-C' },
      { depth: 2, text: 'Requires quest: Q-D' },
    ]);
  });

  it('says an empty section is empty', () => {
    const lines_ = render({ m_requirements: { m_requirements: [] } });
    expect(lines_).toContain('No requirements');
    expect(lines_).toContain('No rewards');
  });
});

describe('the pending-suggestion badge', () => {
  const suggestion = (
    id: number,
    path: string,
    status: Suggestion['status'] = 'pending',
  ): Suggestion => ({
    id,
    path,
    value: null,
    source: 'evidence-title',
    confidence: null,
    evidence_ref: null,
    status,
    created_at: null,
    decided_at: null,
  });

  it('renders the count, and nothing when none is pending', () => {
    expect(render(quests['DS-ACAD-C01-001'], 3)[0]).toBe('3 suggestions');
    expect(render(quests['DS-ACAD-C01-001'], 1)[0]).toBe('1 suggestion');
    expect(suggestionBadgeText(2)).toBe('2 suggestions');
    expect(render(quests['DS-ACAD-C01-001'], 0)[0]).toBe(
      'Given by Ashley (the Prep dialog speaker)',
    );
  });

  it('opens the tab holding the first pending field (D144)', () => {
    expect(firstPendingTab([])).toBeNull();
    expect(
      firstPendingTab([suggestion(1, 'm_goals', 'accepted'), suggestion(2, 'm_dialogList')]),
    ).toBe('Dialog');
    expect(firstPendingTab([suggestion(3, 'm_requirements'), suggestion(4, 'm_questTitle')])).toBe(
      'Requirements',
    );
    expect(firstPendingTab([suggestion(5, 'm_questTitle')])).toBe('Info');
  });
});

describe('the Overview never writes (D133; the Evidence panel’s D90(c) style)', () => {
  const root = path.resolve(__dirname, '../../client/src');
  const WRITES =
    /useMutation|fetch\(|saveQuest|\.edit\(|onChange|<input|<textarea|<select|acceptSuggestions|rejectSuggestion/;

  it('has no input, no mutation and no request in either file', () => {
    for (const file of ['lib/quest-overview.ts', 'components/quest/QuestOverview.tsx']) {
      expect(readFileSync(path.join(root, file), 'utf8')).not.toMatch(WRITES);
    }
  });

  it('negative control: the detector fires on each write shape', () => {
    for (const sample of [
      'useMutation({})',
      "fetch('/x')",
      '<input value="a" />',
      'onChange={f}',
      'state.edit(x)',
      'rejectSuggestion(1)',
    ]) {
      expect(sample).toMatch(WRITES);
    }
  });
});
