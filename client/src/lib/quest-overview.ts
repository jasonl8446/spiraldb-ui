import {
  goalCardTitle,
  requirementCardTitle,
  resultCardTitle,
  resultDropTableName,
  type CardNames,
} from './card-titles';
import { goalName, startGoalNames } from './quest-goals';
import {
  goalLogicEntries,
  goalLogicEntryCompletes,
  goalLogicEntryNames,
  goalLogicEntryRequiredORCount,
  goalsOf,
} from './quest-goal-logic';
import {
  requirementApplyNOT,
  requirementEffectiveOperator,
  requirementGroupChildren,
  requirementNodeIsGroup,
} from './requirement-tree';

/**
 * The Overview tab's story (task 7.13, D133, D181): a quest document plus resolved names, read as
 * plain language. Pure and read-only: nothing here writes, and nothing reads React or the network,
 * so the tab renders the same text a unit test pins.
 *
 * **Step order (D61 semantics, D181).** Where `m_goalLogic` holds entries the steps follow it: the
 * start goals first (in `m_startGoals` order), then each entry, in stored order, the first time all
 * of its `m_goalsAND` goals and `m_requiredORCount` of its `m_goalsOR` goals are already placed —
 * placing that entry's `m_goalsToAdd` goals not yet placed. The scan repeats until nothing changes,
 * so a branch (two goals added by one entry) lists in the entry's own order and a goal with two
 * prerequisites waits for them. A goal the scan never reaches (a loop, or a prerequisite that does
 * not exist) is listed last in `m_goals` order and says so. Where `m_goalLogic` is absent, `null` or
 * empty, the order is `m_goals` order and the tab says so ({@link ORDER_AS_STORED}).
 */

/** The tab's statement when a quest has no goal logic (spec-ui-design, Overview Tab). */
export const ORDER_AS_STORED = 'Order shown as stored: this quest has no goal logic.';

/** The tab's statement when the steps follow the goal logic. */
export const ORDER_BY_LOGIC = 'Order follows the goal logic.';

/** What an empty section says (a section is never omitted). */
export const NO_REQUIREMENTS = 'No requirements';
export const NO_REWARDS = 'No rewards';
export const NO_STEPS = 'This quest defines no goals';

export interface OverviewStep {
  /** 1-based position in the list. */
  number: number;
  /** The readable card title (`goalCardTitle`), never the generated goal id. */
  title: string;
  /** The goal's own name, secondary text: it is what the goal logic references. */
  goalName: string | null;
  /** When this step opens, in words (`from the start`, `after step 1`, `not reached`). */
  when: string;
}

export interface OverviewRequirementLine {
  depth: number;
  text: string;
}

export interface QuestOverview {
  /** `Given by X (the Prep dialog speaker)`, or the sentence saying there is none. */
  giver: string;
  /** {@link ORDER_AS_STORED} or {@link ORDER_BY_LOGIC}. */
  order: string;
  steps: OverviewStep[];
  /** Sentences about goals the ordering could not place (a loop, a missing prerequisite). */
  stepNotes: string[];
  /** `Completes when: step 3 is complete`. */
  completes: string;
  /** `Completion dialog: spoken by X`, or the sentence saying there is none. */
  completionDialog: string;
  requirements: OverviewRequirementLine[];
  rewards: string[];
  /** Per reward, the drop table it names (`ResDropTable`) or `null` — for the view to link (D187). */
  rewardDropTables: Array<string | null>;
}

/** The `m_goalLogic` entry keys the story reads, all tolerant of a missing or non-array value. */
interface Rule {
  and: string[];
  or: string[];
  requiredOr: number;
  add: string[];
  completes: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function rulesOf(doc: unknown): Rule[] {
  return goalLogicEntries(doc)
    .filter(isRecord)
    .map((entry) => {
      const required = goalLogicEntryRequiredORCount(entry);
      return {
        and: goalLogicEntryNames(entry, 'm_goalsAND'),
        or: goalLogicEntryNames(entry, 'm_goalsOR'),
        requiredOr: required !== null && required > 0 ? required : 1,
        add: goalLogicEntryNames(entry, 'm_goalsToAdd'),
        completes: goalLogicEntryCompletes(entry),
      };
    });
}

/** `1`, `1 and 2`, `1, 2 and 3`. */
function joinAnd(items: readonly (string | number)[]): string {
  const text = items.map(String);
  return text.length <= 1 ? text.join('') : `${text.slice(0, -1).join(', ')} and ${text.at(-1)}`;
}

/** A rule's prerequisites in words: `step 1`, `steps 1 and 2`, `any 1 of steps 2, 3`. */
function prerequisiteText(rule: Rule, numberOf: ReadonlyMap<string, number>): string | null {
  const numbers = (names: readonly string[]): number[] =>
    names.flatMap((name) => numberOf.get(name) ?? []);
  const all = numbers(rule.and);
  const any = numbers(rule.or);
  const parts: string[] = [];
  if (all.length > 0) {
    parts.push(`${all.length === 1 ? 'step' : 'steps'} ${joinAnd(all)}`);
  }
  if (any.length > 0) {
    parts.push(`any ${rule.requiredOr} of steps ${any.join(', ')}`);
  }
  return parts.length === 0 ? null : parts.join(' and ');
}

/** The goal names in story order, plus what the ordering could not place. */
function orderGoals(
  names: readonly string[],
  startGoals: readonly string[],
  rules: readonly Rule[],
): { order: string[]; unreached: string[] } {
  const known = new Set(names);
  const placed: string[] = [];
  const seen = new Set<string>();
  const place = (name: string): void => {
    if (known.has(name) && !seen.has(name)) {
      seen.add(name);
      placed.push(name);
    }
  };
  startGoals.forEach(place);
  const fired = new Set<number>();
  let changed = true;
  while (changed) {
    changed = false;
    rules.forEach((rule, index) => {
      const conditions = rule.and.length + rule.or.length;
      if (fired.has(index) || conditions === 0) {
        return;
      }
      const orDone = rule.or.filter((name) => seen.has(name)).length;
      if (
        rule.and.every((name) => seen.has(name)) &&
        orDone >= Math.min(rule.requiredOr, rule.or.length)
      ) {
        fired.add(index);
        rule.add.forEach(place);
        changed = true;
      }
    });
  }
  return { order: placed, unreached: names.filter((name) => !seen.has(name)) };
}

/** A tag group's first speaker: the resolved NPC of an entry, else the first persona name. */
function tagSpeaker(doc: unknown, tag: string, names: CardNames): string | null {
  const list = isRecord(doc) && isRecord(doc.m_dialogList) ? doc.m_dialogList : null;
  const group = arrayOf(list?.m_dialogs).find(
    (candidate) => isRecord(candidate) && candidate.m_dialogTag === tag,
  );
  const entries = arrayOf(isRecord(group) ? group.m_dialogEntries : undefined).filter(isRecord);
  for (const entry of entries) {
    const id = entry.m_actorTemplateID;
    const resolved = typeof id === 'number' && id > 0 ? names.npcs?.get(String(id)) : undefined;
    if (resolved !== undefined) {
      return resolved;
    }
  }
  for (const entry of entries) {
    const persona = entry.m_personaName;
    if (typeof persona === 'string' && persona.trim() !== '') {
      return persona;
    }
  }
  for (const entry of entries) {
    const id = entry.m_actorTemplateID;
    if (typeof id === 'number' && id > 0) {
      return `NPC ${id}`;
    }
  }
  return null;
}

/** A requirement tree as indented lines: a group says how its children combine. */
function requirementLines(
  node: unknown,
  names: CardNames,
  depth: number,
): OverviewRequirementLine[] {
  if (!requirementNodeIsGroup(node)) {
    return [{ depth, text: requirementCardTitle(node, names) }];
  }
  const children = requirementGroupChildren(node);
  const negated = requirementApplyNOT(node);
  // A plain AND group of one condition reads as the condition itself.
  if (children.length === 1 && !negated) {
    return requirementLines(children[0], names, depth);
  }
  const all = requirementEffectiveOperator(node) === 'ROP_AND';
  const heading = negated
    ? `Not: ${all ? 'all' : 'any'} of these`
    : `${all ? 'All' : 'Any one'} of these`;
  return [
    { depth, text: `${heading}:` },
    ...children.flatMap((child) => requirementLines(child, names, depth + 1)),
  ];
}

/** The quest document plus resolved names, as the Overview's story. */
export function buildQuestOverview(doc: unknown, names: CardNames): QuestOverview {
  const goals = goalsOf(doc);
  const rules = rulesOf(doc);
  const byName = new Map<string, unknown>();
  for (const goal of goals) {
    const name = goalName(goal);
    if (name !== null && !byName.has(name)) {
      byName.set(name, goal);
    }
  }
  const named = [...byName.keys()];
  const logic = rules.length > 0;
  const startGoals = startGoalNames(isRecord(doc) ? doc.m_startGoals : undefined);

  let sequence: unknown[];
  let unreached = new Set<string>();
  if (logic) {
    const ordered = orderGoals(named, startGoals, rules);
    unreached = new Set(ordered.unreached);
    sequence = [...ordered.order, ...ordered.unreached].map((name) => byName.get(name));
    // A goal with no name cannot be referenced by the logic, so it trails, in stored order.
    sequence.push(...goals.filter((goal) => goalName(goal) === null));
  } else {
    sequence = goals;
  }

  const numberOf = new Map<string, number>();
  sequence.forEach((goal, index) => {
    const name = goalName(goal);
    if (name !== null && !numberOf.has(name)) {
      numberOf.set(name, index + 1);
    }
  });

  const steps: OverviewStep[] = sequence.map((goal, index) => {
    const name = goalName(goal);
    let when = '';
    if (logic) {
      if (name === null || unreached.has(name)) {
        when = 'not reached from the start goals';
      } else if (startGoals.includes(name)) {
        when = 'from the start';
      } else {
        const ways = rules
          .filter((rule) => rule.add.includes(name))
          .flatMap((rule) => prerequisiteText(rule, numberOf) ?? []);
        when =
          ways.length === 0
            ? 'not reached from the start goals'
            : `after ${ways.join(', or after ')}`;
      }
    }
    return { number: index + 1, title: goalCardTitle(goal, names), goalName: name, when };
  });

  const stepNotes: string[] = [];
  if (logic && unreached.size > 0) {
    stepNotes.push(
      `${unreached.size} goal${unreached.size === 1 ? ' is' : 's are'} never reached from the start goals (a loop, or a prerequisite the quest does not define); listed last, in stored order.`,
    );
  }
  if (logic && named.length !== goals.length) {
    stepNotes.push('Goals without a name cannot be ordered by the goal logic; listed last.');
  }

  let completes: string;
  if (!logic) {
    completes = 'Completes when: not stated, because this quest has no goal logic.';
  } else {
    const ways = rules
      .filter((rule) => rule.completes)
      .map((rule) => prerequisiteText(rule, numberOf));
    completes =
      ways.length === 0
        ? 'Completes when: no goal-logic entry completes the quest.'
        : `Completes when: ${ways.map((way) => (way === null ? 'the goal logic says so' : `${way} ${/^step /.test(way) ? 'is' : 'are'} complete`)).join(', or ')}.`;
  }

  const giver = tagSpeaker(doc, 'Prep', names);
  const closer = tagSpeaker(doc, 'Completion', names);
  const requirementRoot = isRecord(doc) ? doc.m_requirements : undefined;
  const requirements =
    isRecord(requirementRoot) &&
    (requirementNodeIsGroup(requirementRoot)
      ? requirementGroupChildren(requirementRoot).length > 0
      : true)
      ? requirementLines(requirementRoot, names, 0)
      : [];
  const results = arrayOf(
    isRecord(doc) && isRecord(doc.m_endResults) ? doc.m_endResults.m_results : undefined,
  );

  return {
    giver:
      giver === null ? 'No Prep dialog speaker' : `Given by ${giver} (the Prep dialog speaker)`,
    order: logic ? ORDER_BY_LOGIC : ORDER_AS_STORED,
    steps,
    stepNotes,
    completes,
    completionDialog:
      closer === null ? 'No completion dialog' : `Completion dialog: spoken by ${closer}`,
    requirements,
    rewards: results.map((result) => resultCardTitle(result, names)),
    rewardDropTables: results.map(resultDropTableName),
  };
}
