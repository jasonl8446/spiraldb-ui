import { classTerm, resolveTerm } from '@shared/glossary';

import { shortTypeName } from './extract';
import { friendlyNameOf, nameRowId, type NameRow, type NamesType } from './display';
import { goalField, goalTypeSpecForGoal, goalTypeTerm } from './quest-goals';
import {
  requirementApplyNOT,
  requirementField,
  requirementTypeSpecForTypeString,
} from './requirement-tree';
import { resultField, resultTypeSpecForResult } from './quest-results';
import { termText } from './term';

/**
 * The card titles (task 7.10, D178): what a goal, result or requirement card is **called**, as a pure
 * function of `(document node, resolved names) → string`.
 *
 * The Overview tab (task 7.13) reuses these functions, so nothing here reads React state or the
 * network: the caller resolves the names ({@link CardNames}) and passes them in. A title reads as
 * meaning, `Talk to Olivia Dawnwillow (Persona goal)`, and degrades in two steps, never to a
 * generated id such as `1_WizardQuestGoals_00000058`: an unresolved name reads as its raw id (the
 * Phase 6 miss rule), and a node with nothing to say reads as its glossary class label.
 */

/** The friendly names a title may need: `id → friendly name` per names type. */
export type CardNames = { readonly [T in NamesType]?: ReadonlyMap<string, string> };

/** No names resolved yet (loading, a miss, or a surface with no names): every title falls back. */
export const NO_CARD_NAMES: CardNames = {};

/** `CardNames` from the rows the names API answers, through the one friendly-half rule. */
export function cardNamesFromRows(rows: {
  readonly [T in NamesType]?: readonly NameRow[];
}): CardNames {
  const names: { -readonly [T in NamesType]?: ReadonlyMap<string, string> } = {};
  for (const type of Object.keys(rows) as NamesType[]) {
    const map = new Map<string, string>();
    for (const row of rows[type] ?? []) {
      const friendly = friendlyNameOf(type, row)?.trim();
      if (friendly !== undefined && friendly !== '') {
        map.set(nameRowId(type, row), friendly);
      }
    }
    names[type] = map;
  }
  return names;
}

/** `true` for a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A non-empty string, else `null`. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** A positive number, else `null` (`0` is the corpus's "none"). */
function positive(value: unknown): number | null {
  return typeof value === 'number' && value > 0 ? value : null;
}

/** The friendly name of `id` in `type`'s table, or the raw id when it is not resolved. */
function nameOrId(names: CardNames, type: NamesType, id: string | number): string {
  return names[type]?.get(String(id)) ?? String(id);
}

/** A zone path as its display name, or the raw path on a miss. */
function zoneName(names: CardNames, path: string): string {
  return nameOrId(names, 'zones', path);
}

/**
 * The place a `m_locationName` string key names: the string table holds `World|Place`
 * (`Wizard City|Unicorn Way`), and the place is the half that says where.
 */
function locationPlace(names: CardNames, goal: unknown): string | null {
  const key = text(goalField(goal, 'm_locationName'));
  const value = key === null ? undefined : names.strings?.get(key);
  return value === undefined ? null : (value.split('|').pop() ?? null);
}

/** The string keys a goal's title reads (`m_locationName`), for the caller to resolve. */
export function goalTitleStringKeys(goal: unknown): string[] {
  const key = text(goalField(goal, 'm_locationName'));
  return key === null ? [] : [key];
}

/**
 * The class label of a `$type`: the glossary's friendly half, or the class's own short name (the
 * lenient split `lib/extract.ts` reads, so a `$type` this tool has never heard of still names itself).
 */
function classLabel(typeString: unknown): string {
  if (typeof typeString !== 'string') {
    return termText({ type: 'unknown' });
  }
  return (
    classTerm(typeString)?.label ?? termText({ type: shortTypeName(typeString) ?? typeString })
  );
}

/**
 * The parenthesised noun a glossary class label ends with (`Talk to an NPC (Persona goal)` →
 * `Persona goal`), which is what a title carries after its meaning; `null` for a label without one.
 */
function classNoun(typeString: unknown): string | null {
  const match = /\(([^()]+)\)\s*$/.exec(classLabel(typeString));
  return match === null ? null : match[1];
}

/** `meaning (Persona goal)`. */
function withNoun(meaning: string, typeString: unknown): string {
  const noun = classNoun(typeString);
  return noun === null ? meaning : `${meaning} (${noun})`;
}

/** The first dialog entry of a goal that names a speaker: its resolved NPC, else its persona name. */
function personaSpeaker(goal: unknown, names: CardNames): string | null {
  const dialogList = goalField(goal, 'm_dialogList');
  const dialogs =
    isRecord(dialogList) && Array.isArray(dialogList.m_dialogs) ? dialogList.m_dialogs : [];
  const entries = dialogs.flatMap((dialog) =>
    isRecord(dialog) && Array.isArray(dialog.m_dialogEntries) ? dialog.m_dialogEntries : [],
  );
  for (const entry of entries) {
    const id = isRecord(entry) ? positive(entry.m_actorTemplateID) : null;
    const resolved = id === null ? undefined : names.npcs?.get(String(id));
    if (resolved !== undefined) {
      return resolved;
    }
  }
  const own = text(goalField(goal, 'm_personaName'));
  if (own !== null) {
    return own;
  }
  for (const entry of entries) {
    const persona = isRecord(entry) ? text(entry.m_personaName) : null;
    if (persona !== null) {
      return persona;
    }
  }
  return null;
}

/** ` in <place>` for the goal classes that happen somewhere, or `''`. */
function inPlace(goal: unknown, names: CardNames): string {
  const zone = text(goalField(goal, 'm_destinationZone'));
  const place = zone === null ? locationPlace(names, goal) : zoneName(names, zone);
  return place === null ? '' : ` in ${place}`;
}

/** `2 Lost_Soul`, `2 enemies` — a counted thing, its tags when it has them. */
function counted(total: unknown, tags: unknown, one: string, many: string): string {
  const count = positive(total);
  const tagText = Array.isArray(tags) ? tags.filter((tag) => text(tag) !== null).join(', ') : '';
  if (tagText !== '') {
    return count === null ? tagText : `${count} ${tagText}`;
  }
  return count === null ? many : `${count} ${count === 1 ? one : many}`;
}

/**
 * A goal card's title. The goal's own name (`1_WizardQuestGoals_00000058`) is a generated id, shown
 * on the card as secondary text and never used here (D144).
 */
export function goalCardTitle(goal: unknown, names: CardNames): string {
  const typeString = goalField(goal, '$type');
  const spec = goalTypeSpecForGoal(goal);
  // An unknown `$type` still reads as the glossary's label when the lenient reader can name it.
  const term = spec === undefined ? goalTypeTerm(goal) : { type: spec.$type };
  const fallback = resolveTerm(term).entry?.label ?? termText(term);
  switch (spec?.shortName) {
    case 'Persona': {
      const speaker = personaSpeaker(goal, names);
      return speaker === null ? fallback : withNoun(`Talk to ${speaker}`, typeString);
    }
    case 'Waypoint': {
      const zone = text(goalField(goal, 'm_destinationZone')) ?? text(goalField(goal, 'm_zoneTag'));
      const place = zone === null ? locationPlace(names, goal) : zoneName(names, zone);
      return place === null ? fallback : withNoun(`Go to ${place}`, typeString);
    }
    case 'Bounty':
      return withNoun(
        `Defeat ${counted(goalField(goal, 'm_bountyTotal'), goalField(goal, 'm_npcAdjectives'), 'enemy', 'enemies')}${inPlace(goal, names)}`,
        typeString,
      );
    case 'Scavenge':
      return withNoun(
        goalField(goal, 'm_goalType') === 'GOAL_TYPE_USAGE'
          ? `Use an object${inPlace(goal, names)}`
          : `Collect ${counted(goalField(goal, 'm_itemTotal'), goalField(goal, 'm_itemAdjectives'), 'item', 'items')}${inPlace(goal, names)}`,
        typeString,
      );
    case 'AchieveRank': {
      const rank = goalField(goal, 'm_rank');
      return typeof rank === 'number' ? withNoun(`Reach rank ${rank}`, typeString) : fallback;
    }
    default:
      return fallback;
  }
}

/** The operand of a result, as the words after its class label; `null` when it has none. */
function resultOperand(result: unknown, shortName: string, names: CardNames): string | null {
  const field = (key: string): unknown => resultField(result, key);
  switch (shortName) {
    case 'ResDropTable':
      return text(field('m_tableName'));
    case 'ResLearnSpell':
    case 'ResAddSpell': {
      const id = positive(field('m_templateID'));
      return id === null ? null : nameOrId(names, 'spells', id);
    }
    case 'ResGiveSpell': {
      const npc = positive(field('m_templateID'));
      const spell = positive(field('m_spellID'));
      if (npc === null || spell === null) {
        return null;
      }
      return `${nameOrId(names, 'spells', spell)} for ${nameOrId(names, 'npcs', npc)}`;
    }
    case 'ResDespawn': {
      const id = positive(field('m_templateID'));
      return id === null ? null : nameOrId(names, 'npcs', id);
    }
    case 'ResDrawHand': {
      // The dual-source id (D63(c)): a spell when the spells table has it, else an NPC.
      const id = positive(field('m_templateID'));
      if (id === null) {
        return null;
      }
      return names.spells?.get(String(id)) ?? nameOrId(names, 'npcs', id);
    }
    case 'ResTeleport': {
      const zone = text(field('m_destinationZone'));
      return zone === null ? null : zoneName(names, zone);
    }
    case 'ResAddDynaMod': {
      const zone = text(field('m_zoneName'));
      return zone === null ? text(field('m_dynaModClientTag')) : zoneName(names, zone);
    }
    case 'ResModifyEntry':
      return text(field('m_entryName'));
    case 'ResPostEvent':
      return text(field('m_eventName'));
    case 'ResPlaySound':
      return text(field('m_soundName'));
    case 'ResWait': {
      const seconds = positive(field('m_secondsToWait'));
      return seconds === null ? null : `${seconds} s`;
    }
    default:
      return null;
  }
}

/**
 * A result card's title: the class label and what the result acts on (`Reward: drop table Pesky
 * Pirates`). The label alone when the result has no operand or its class is unknown.
 */
export function resultCardTitle(result: unknown, names: CardNames): string {
  const typeString = isRecord(result) ? result.$type : undefined;
  const label = classLabel(typeString);
  const spec = resultTypeSpecForResult(result);
  const operand = spec === undefined ? null : resultOperand(result, spec.shortName, names);
  if (operand === null) {
    return label;
  }
  // The drop-table label already ends in the noun the table names, so it reads without a colon.
  return spec?.shortName === 'ResDropTable' ? `${label} ${operand}` : `${label}: ${operand}`;
}

/**
 * A requirement leaf's title: the class label and its operand (`Requires quest: Wizard Tours`),
 * `Not: ` in front of a negated one. A group (`RequirementList`) has no operand and keeps its label.
 */
export function requirementCardTitle(node: unknown, names: CardNames): string {
  const typeString = isRecord(node) ? node.$type : undefined;
  const label = classLabel(typeString);
  const spec =
    typeof typeString === 'string' ? requirementTypeSpecForTypeString(typeString) : undefined;
  const field = (key: string): string | null => text(requirementField(node, key));
  let operand: string | null = null;
  switch (spec?.shortName) {
    case 'ReqHasQuest': {
      const quest = field('m_questName');
      operand = quest === null ? null : nameOrId(names, 'quests', quest);
      break;
    }
    case 'ReqHasEntry': {
      const entry = field('m_displayName') ?? field('m_entryName');
      const quest = field('m_questName');
      operand = [entry, quest === null ? null : nameOrId(names, 'quests', quest)]
        .filter((part): part is string => part !== null)
        .join(' in ');
      break;
    }
    case 'ReqSchoolOfFocus':
      operand = field('m_magicSchool');
      break;
    case 'ReqIsSchool':
      operand = field('m_magicSchoolName');
      break;
    default:
      break;
  }
  const title = operand === null || operand === '' ? label : `${label}: ${operand}`;
  return requirementApplyNOT(node) ? `Not: ${title}` : title;
}
