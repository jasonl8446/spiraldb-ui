import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';

import {
  NO_CARD_NAMES,
  cardNamesFromRows,
  goalCardTitle,
  requirementCardTitle,
  resultCardTitle,
} from '../../client/src/lib/card-titles';
import { CLONE } from '../helpers/clone-fixture';
import fixture from './fixtures/card-titles-quests.json';

/**
 * Task 7.10 (p7-11, D178): the card titles, pinned over real quests of the D17 clone
 * (`data/test-spiraldb`, 322 quests) with the names the synced database resolves for the ids those
 * quests reference. The documents and the names rows are the committed fixture
 * (`fixtures/card-titles-quests.json`), so the pins run in CI, where the clone does not exist; the
 * whole-corpus scan at the end reads the clone and skips without it.
 */

/** The generated goal id shape the title must never fall back to. */
const GENERATED_GOAL_NAME = /^\d+_WizardQuestGoals_/;

const names = cardNamesFromRows(fixture.names as never);
const quests = fixture.quests as Record<string, Record<string, unknown>>;

interface Node {
  [key: string]: unknown;
}

/** Every result and requirement node of a quest, in document order, with duplicates collapsed. */
function nodeTitles(quest: Node, resolved = names): string[] {
  const titles: string[] = [];
  const goals = (quest.m_goals as Node[]).map((goal) => [
    goal.m_completeResults,
    goal.m_activateResults,
  ]);
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (typeof value === 'object' && value !== null) {
      const node = value as Node;
      if (typeof node.$type === 'string' && !/Goal/.test(node.$type)) {
        const title = /Res/.test(node.$type)
          ? resultCardTitle(node, resolved)
          : requirementCardTitle(node, resolved);
        if (!titles.includes(title)) {
          titles.push(title);
        }
      }
      Object.values(node).forEach(walk);
    }
  };
  walk([quest.m_startResults, quest.m_endResults, quest.m_requirements, goals]);
  return titles;
}

/**
 * One real quest for each goal class, the result classes and the requirement classes. The
 * comment names what each quest is there for; every title is the real document run through the
 * real name rows.
 * - Waypoint, Persona, ReqHasQuest, RequirementList: DS-ACAD-C01-001, DS-ACAD-C01-002
 * - Bounty (BountyCollect) and ReqHasEntry: WC-UNICORN-MAIN-001
 * - Scavenge: DS-ACAD1-C04-001; Scavenge with GOAL_TYPE_USAGE: WC-UNICORN-MAIN-004
 * - AchieveRank and the spell/NPC results: WC-TUT-C03-001, WC-TUT-C05-001, Tutorial_Intro
 * - a persona no NPC row resolves: WC-COMMONS-MAIN-003
 * - teleport, dynamic modifier, registry entry: WC-COMMONS-MAIN-001
 */
const PINNED: Record<string, { goals: [string, string][]; nodes: string[] }> = {
  'DS-ACAD-C01-001': {
    goals: [
      ['1_WizardQuestGoals_UseItem', 'Go to Haunted Cave (Waypoint goal)'],
      ['2_WizardQuestGoals_UseItem', "Go to Biti's Chamber (Waypoint goal)"],
      ['3_WizardQuestGoals_UseItem', 'Go to Shakes Clocktower (Waypoint goal)'],
      ['4_WizardQuestGoals_UseItem', 'Go to Ancient Burial Grounds (Waypoint goal)'],
      ['5_WizardQuestGoals_TalkNPC', 'Talk to Ashley (Persona goal)'],
    ],
    nodes: [
      'Reward: drop table DS-ACAD-C01-001',
      'Requirement group',
      'Requires quest: A Tale of Two Brothers',
    ],
  },
  'DS-ACAD-C01-002': {
    goals: [
      ['1_WizardQuestGoals_ExploreZone', 'Go to The Crystal Grove (Waypoint goal)'],
      ['2_WizardQuestGoals_Explore', 'Go to The Crystal Grove (Waypoint goal)'],
      ['3_WizardQuestGoals_TalkNPC', 'Talk to Zarek Pickmaster (Persona goal)'],
    ],
    nodes: [
      'Reward: drop table DS-ACAD-C01-002',
      'Requirement group',
      'Requires quest: Wizard Tours',
    ],
  },
  'DS-ACAD1-C04-001': {
    goals: [
      ['1_WizardQuestGoals_KillCollect', 'Collect items in The Crystal Grove (Scavenge goal)'],
      ['2_WizardQuestGoals_TalkNPC', 'Talk to Milaka Jewelbender (Persona goal)'],
    ],
    nodes: [
      'Reward: drop table DS-ACAD1-C04-001',
      'Requirement group',
      'Requires quest: Quest for Perfection',
    ],
  },
  'WC-UNICORN-MAIN-001': {
    goals: [
      ['1_WizardQuestGoals_Kill', 'Defeat 2 Lost_Soul in Unicorn Way (Bounty goal)'],
      ['2_WizardQuestGoals_TalkNPC', 'Talk to Private Connelly (Persona goal)'],
      ['3_WizardQuestGoals_TalkNPC', 'Talk to Ceren Nightchant (Persona goal)'],
    ],
    nodes: [
      'Reward: drop table WC-UNICORN-MAIN-001',
      'Requires quest registry entry: Complete in Unicorn Way',
    ],
  },
  'WC-UNICORN-MAIN-004': {
    goals: [
      ['1_WizardQuestGoals_00000015', 'Use an object in Unicorn Way (Scavenge goal)'],
      ['2_WizardQuestGoals_00000015', 'Use an object in Unicorn Way (Scavenge goal)'],
      ['3_WizardQuestGoals_00000015', 'Use an object in Unicorn Way (Scavenge goal)'],
      ['4_WizardQuestGoals_00000015', 'Use an object in Unicorn Way (Scavenge goal)'],
      ['5_WizardQuestGoals_KillCollect', 'Defeat 2 enemies in Unicorn Way (Bounty goal)'],
      ['6_WizardQuestGoals_Explore', 'Go to Unicorn Way (Waypoint goal)'],
      ['7_WizardQuestGoals_TalkNPC', 'Talk to Lady Oriel (Persona goal)'],
    ],
    nodes: [],
  },
  'WC-COMMONS-MAIN-003': {
    goals: [['1_WizardQuestGoals_TalkNPC', 'Talk to WC-ST02-NPC01_Persona (Persona goal)']],
    nodes: [
      'Reward: drop table WC-COMMONS-MAIN-003',
      'Requirement group',
      'Requires quest registry entry: Complete in To Ravenwood!',
    ],
  },
  'WC-COMMONS-MAIN-001': {
    goals: [
      ['1_WizardQuestGoals_EncounterExplore', 'Go to Unicorn Way (Waypoint goal)'],
      ['2_WizardQuestGoals_TalkNPC', 'Talk to Private Connelly (Persona goal)'],
    ],
    nodes: [
      'Add or remove dynamic modifier: WC-FairyCage instance',
      'Add or remove dynamic modifier: WC_Rattlebones_ButterFlyZone instance',
      'Add or remove dynamic modifier: The Commons',
      'Modify quest registry entry: GainedEnrollment',
      'Reward: drop table WC-COMMONS-MAIN-001',
      'Teleport player: Unicorn Way',
    ],
  },
  'WC-TUT-C03-001': {
    goals: [
      ['player damage 1', 'Reach rank 1 (Achieve Rank goal)'],
      ['CloseDoor', 'Reach rank 1 (Achieve Rank goal)'],
      ['Clear hand mob 0', 'Reach rank 1 (Achieve Rank goal)'],
      ['Clear hand mob 1', 'Reach rank 1 (Achieve Rank goal)'],
      ['mob damage 2', 'Reach rank 1 (Achieve Rank goal)'],
      ['mob damage 3', 'Reach rank 1 (Achieve Rank goal)'],
      ['mob damage 4', 'Reach rank 1 (Achieve Rank goal)'],
      ['mob weakness', 'Reach rank 1 (Achieve Rank goal)'],
      ['mob damage 5', 'Reach rank 1 (Achieve Rank goal)'],
      ['mob damage 6', 'Reach rank 1 (Achieve Rank goal)'],
      ['mob damage 7', 'Reach rank 1 (Achieve Rank goal)'],
      ['mob damage 8', 'Reach rank 1 (Achieve Rank goal)'],
      ['player heal', 'Reach rank 1 (Achieve Rank goal)'],
      ['player damage 2', 'Reach rank 1 (Achieve Rank goal)'],
      ['player blade', 'Reach rank 1 (Achieve Rank goal)'],
      ['player damage 3', 'Reach rank 1 (Achieve Rank goal)'],
      ['Give 3 pips to player', 'Reach rank 1 (Achieve Rank goal)'],
      ['give 4 pips to player', 'Reach rank 1 (Achieve Rank goal)'],
      ['Update pips', 'Reach rank 1 (Achieve Rank goal)'],
    ],
    nodes: [
      'Add spell to spellbook: Troll',
      'Add spell to spellbook: Fire Cat',
      'Give spell to NPC: Frost Beetle for Draconian',
      'Give spell to NPC: Scorpion for Draconian',
      'Draw hand: Draconian',
      'Draw hand: Troll',
      'Draw hand: Fire Cat',
      'Give spell to NPC: Tutorial Mob Damage 03 for Draconian',
      'Give spell to NPC: Tutorial Mob Damage 04 for Draconian',
      'Give spell to NPC: Weakness for Draconian',
      'Give spell to NPC: Tutorial Mob Damage 05 for Draconian',
      'Give spell to NPC: Tutorial Mob Damage 06 for Draconian',
      'Give spell to NPC: Tutorial Mob Damage 07 for Draconian',
      'Give spell to NPC: Tutorial Mob Damage 08 for Draconian',
      'Draw hand: Unicorn',
      "Draw hand: Nature's Wrath",
      'Draw hand: Balanceblade',
      'Draw hand: Meteor Strike',
    ],
  },
  'WC-TUT-C05-001': {
    goals: [
      ['Trigger Storm', 'Reach rank 1 (Achieve Rank goal)'],
      ['Despawn Ambrose Outside', 'Reach rank 1 (Achieve Rank goal)'],
      ['Trigger Rubble', 'Reach rank 1 (Achieve Rank goal)'],
      ['Trigger Silhouette', 'Reach rank 1 (Achieve Rank goal)'],
      ['Walk Ambrose', 'Reach rank 1 (Achieve Rank goal)'],
    ],
    nodes: [
      'Reward: drop table TEST',
      'Play sound: ObjectData/StormStart.xml',
      'Add or remove dynamic modifier: Golem Court',
      'Despawn NPC or object: Merle Ambrose',
      'Post game event: WalkAmbrose',
      'Wait: 5 s',
      'Post game event: DespawnA',
    ],
  },
  Tutorial_Intro: {
    goals: [['OnlyGoal', 'Reach rank 1 (Achieve Rank goal)']],
    nodes: [
      'Restore health',
      'Restore mana',
      'Teach spell: Thunder Snake',
      'Requires school of focus: Storm',
      'Teach spell: Frost Beetle',
      'Requires school of focus: Ice',
      'Teach spell: Fire Cat',
      'Requires school of focus: Fire',
      'Teach spell: Dark Sprite',
      'Requires school of focus: Death',
      'Teach spell: Blood Bat',
      'Requires school of focus: Myth',
      'Teach spell: Imp',
      'Requires school of focus: Life',
      'Teach spell: Scarab',
      'Requires school of focus: Balance',
    ],
  },
};

describe('card titles pinned over real D17-clone quests', () => {
  it('pins the goal, result and requirement titles of every fixture quest', () => {
    for (const [name, pinned] of Object.entries(PINNED)) {
      const quest = quests[name] as Node;
      const goals = (quest.m_goals as Node[]).map((goal) => [
        goal.m_goalName,
        goalCardTitle(goal, names),
      ]);
      expect({ quest: name, goals }).toEqual({ quest: name, goals: pinned.goals });
      expect({ quest: name, nodes: nodeTitles(quest) }).toEqual({
        quest: name,
        nodes: pinned.nodes,
      });
    }
  });

  it('covers every goal class, including the Usage and Bounty variants', () => {
    const classes = new Set<string>();
    for (const quest of Object.values(quests)) {
      for (const goal of quest.m_goals as Node[]) {
        classes.add(
          `${String(goal.$type).split(',')[0].split('.').pop()}/${String(goal.m_goalType)}`,
        );
      }
    }
    expect([...classes].sort()).toEqual([
      'AchieveRankGoalTemplate/GOAL_TYPE_ACHIEVERANK',
      'BountyGoalTemplate/GOAL_TYPE_BOUNTY',
      'BountyGoalTemplate/GOAL_TYPE_BOUNTYCOLLECT',
      'PersonaGoalTemplate/GOAL_TYPE_PERSONA',
      'ScavengeGoalTemplate/GOAL_TYPE_SCAVENGE',
      'ScavengeGoalTemplate/GOAL_TYPE_USAGE',
      'WaypointGoalTemplate/GOAL_TYPE_WAYPOINT',
    ]);
  });

  it('never titles a fixture card by the generated goal id, with or without names', () => {
    for (const quest of Object.values(quests)) {
      for (const goal of quest.m_goals as Node[]) {
        expect(goalCardTitle(goal, names)).not.toMatch(GENERATED_GOAL_NAME);
        expect(goalCardTitle(goal, NO_CARD_NAMES)).not.toMatch(GENERATED_GOAL_NAME);
      }
    }
  });
});

describe('the fallbacks', () => {
  const persona = (quests['DS-ACAD-C01-001'].m_goals as Node[]).find((goal) =>
    String(goal.$type).includes('Persona'),
  );
  const waypoint = (quests['DS-ACAD-C01-001'].m_goals as Node[])[0];

  it('falls back to the raw id, then to the glossary class label, when a name is unresolved', () => {
    // No NPC name, but the dialog still names its persona: the raw persona id, never the goal id.
    expect(goalCardTitle(persona, NO_CARD_NAMES)).toBe(
      'Talk to DS-ACAD-NPC01_Persona (Persona goal)',
    );
    // No zone and no location string resolved: the glossary label of the class.
    expect(
      goalCardTitle({ ...waypoint, m_destinationZone: '', m_zoneTag: '' }, NO_CARD_NAMES),
    ).toBe('Reach a zone (Waypoint goal)');
    // A zone path the zones table does not have reads as the raw path.
    expect(goalCardTitle({ ...waypoint, m_destinationZone: 'Nowhere/Zone' }, NO_CARD_NAMES)).toBe(
      'Go to Nowhere/Zone (Waypoint goal)',
    );
    expect(
      resultCardTitle(
        {
          $type: 'Imcodec.ObjectProperty.TypeCache.ResLearnSpell, Imcodec.ObjectProperty',
          m_templateID: 7,
        },
        NO_CARD_NAMES,
      ),
    ).toBe('Teach spell: 7');
  });

  it('titles an unknown class by its glossary label or its own short name', () => {
    expect(
      goalCardTitle(
        { $type: 'X.PersonaGoalTemplate, X', m_goalName: '1_WizardQuestGoals_1' },
        names,
      ),
    ).toBe('Talk to an NPC (Persona goal)');
    expect(
      goalCardTitle({ $type: 'X.NewGoalTemplate, X', m_goalName: '1_WizardQuestGoals_1' }, names),
    ).not.toMatch(GENERATED_GOAL_NAME);
    expect(resultCardTitle({ $type: 'X.ResSomethingNew, X' }, names)).toBe('ResSomethingNew');
    expect(requirementCardTitle({ $type: 'X.ReqSomethingNew, X' }, names)).toBe('ReqSomethingNew');
  });

  it('prefixes a negated requirement', () => {
    expect(
      requirementCardTitle(
        {
          $type: 'Imcodec.ObjectProperty.TypeCache.ReqHasQuest, Imcodec.ObjectProperty',
          m_applyNOT: true,
          m_questName: 'DS-ACAD-C01-001',
        },
        names,
      ),
    ).toBe('Not: Requires quest: Wizard Tours');
  });
});

const QUEST_DIR = path.join(CLONE, 'QuestTemplates');

describe.skipIf(!existsSync(QUEST_DIR))('every goal of the D17 clone (322 quests)', () => {
  it('is titled by meaning, never by its generated goal id', () => {
    let goals = 0;
    for (const file of readdirSync(QUEST_DIR).filter((entry) => entry.endsWith('.json'))) {
      const quest = JSON5.parse(readFileSync(path.join(QUEST_DIR, file), 'utf8')) as Node;
      for (const goal of (quest.m_goals as Node[] | undefined) ?? []) {
        goals += 1;
        expect(goalCardTitle(goal, NO_CARD_NAMES), file).not.toMatch(GENERATED_GOAL_NAME);
        expect(goalCardTitle(goal, names), file).not.toMatch(GENERATED_GOAL_NAME);
      }
      for (const title of nodeTitles(quest, NO_CARD_NAMES)) {
        expect(title, file).not.toMatch(/Imcodec|\$type/);
      }
    }
    expect(goals).toBe(772);
  });
});
