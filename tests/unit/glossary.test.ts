import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ENUM_OF_FIELD,
  GLOSSARY,
  classTerm,
  enumTerm,
  fieldLabel,
  fieldTerm,
  fieldValueTerm,
  groupTerm,
  resolveTerm,
  shortClassName,
  type GlossaryEntry,
} from '@shared/glossary';
import {
  GOAL_TYPE_VALUES,
  KNOWN_TYPE_STRINGS,
  MAGIC_SCHOOLS,
  REQUIREMENT_OPERATORS,
  shortTypeName,
} from '@shared/quest/typeConstants';

import {
  DIALOG_ENTRY_FIELD_SPECS,
  DIALOG_ACCORDIONS,
  DIALOG_LIST_KEY,
  DIALOGS_KEY,
  KNOWN_GROUP_KEYS,
} from '../../client/src/lib/quest-dialog';
import { GOAL_LOGIC_ENTRY_KEYS, GOAL_LOGIC_PATH } from '../../client/src/lib/quest-goal-logic';
import {
  GOAL_BASE_FIELDS,
  GOAL_EDITABLE_BASE_FIELDS,
  GOAL_TYPE_SPECS,
  GOALS_PATH,
  KNOWN_GOAL_KEYS,
  START_GOALS_PATH,
} from '../../client/src/lib/quest-goals';
import { ACTIVITY_TYPES, QUEST_TOP_LEVEL_KEYS } from '../../client/src/lib/quest-info';
import {
  KNOWN_RESULT_KEYS,
  RESULT_TYPE_SPECS,
  RESULTS_KEY,
  SOUND_ROUTER_FIELD_SPECS,
  SOUND_ROUTER_KEY,
  TALLY_RESULTS_PATH,
} from '../../client/src/lib/quest-results';
import {
  REQUIREMENT_CHILDREN_KEY,
  REQUIREMENT_TYPE_SPECS,
} from '../../client/src/lib/requirement-tree';

/**
 * Story p7-09 (task 7.8) — **the glossary covers every term the quest editor shows**.
 *
 * The coverage sets are built from the editor's own data, never from a hand-typed list: the six
 * quest spec tables' key inventories, `KNOWN_TYPE_STRINGS`, and the option lists the selects
 * render. A second arm scans the six tables' source for every quoted `'m_…'` literal, so a key a
 * table gains without joining an exported list still has to be defined. The negative control is
 * recorded in `docs/evidence/phase-7/p7-09.md`: one entry deleted, this file red.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/** The six quest spec tables' home files (D59: the field inventory as data). */
const SPEC_TABLE_FILES = [
  'client/src/lib/quest-info.ts',
  'client/src/lib/quest-goals.ts',
  'client/src/lib/quest-goal-logic.ts',
  'client/src/lib/requirement-tree.ts',
  'client/src/lib/quest-results.ts',
  'client/src/lib/quest-dialog.ts',
];

/** Every document key the six tables model, by table. */
function tableKeys(): Record<string, readonly string[]> {
  return {
    'quest-info': QUEST_TOP_LEVEL_KEYS,
    'quest-goals': [
      ...KNOWN_GOAL_KEYS,
      ...GOAL_BASE_FIELDS,
      ...GOAL_EDITABLE_BASE_FIELDS.map((field) => field.key),
      GOALS_PATH,
      START_GOALS_PATH,
    ],
    'quest-goal-logic': [...GOAL_LOGIC_ENTRY_KEYS, GOAL_LOGIC_PATH],
    'requirement-tree': [
      '$type',
      'm_applyNOT',
      'm_operator',
      REQUIREMENT_CHILDREN_KEY,
      ...REQUIREMENT_TYPE_SPECS.flatMap((spec) => spec.fields.map((field) => field.key)),
    ],
    'quest-results': [
      ...KNOWN_RESULT_KEYS,
      ...SOUND_ROUTER_FIELD_SPECS.map((field) => field.key),
      SOUND_ROUTER_KEY,
      RESULTS_KEY,
      TALLY_RESULTS_PATH,
    ],
    'quest-dialog': [
      DIALOG_LIST_KEY,
      DIALOGS_KEY,
      ...KNOWN_GROUP_KEYS,
      ...DIALOG_ENTRY_FIELD_SPECS.map((field) => field.key),
    ],
  };
}

/** Every `(enum name, literal)` the editor's selects and toggles render. */
function renderedEnumLiterals(): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const viaField = (key: string, options: readonly unknown[] | undefined): void => {
    for (const option of options ?? []) {
      const enumName = ENUM_OF_FIELD[key];
      pairs.push([enumName ?? `(no enum declared for ${key})`, String(option)]);
    }
  };
  const selects = (
    fields: ReadonlyArray<{ key: string; kind: string; options?: readonly string[] }>,
  ) => fields.filter((field) => field.kind === 'select' || field.kind === 'enum');
  for (const spec of GOAL_TYPE_SPECS) {
    for (const field of selects(spec.fields)) viaField(field.key, field.options);
  }
  for (const field of selects(GOAL_EDITABLE_BASE_FIELDS)) viaField(field.key, field.options);
  for (const spec of REQUIREMENT_TYPE_SPECS) {
    for (const field of selects(spec.fields)) viaField(field.key, field.options);
  }
  for (const spec of RESULT_TYPE_SPECS) {
    for (const field of selects(spec.fields)) viaField(field.key, field.options);
  }
  for (const field of selects(SOUND_ROUTER_FIELD_SPECS)) viaField(field.key, field.options);
  viaField('m_activityType', ACTIVITY_TYPES);
  viaField('m_goalType', GOAL_TYPE_VALUES);
  viaField('m_operator', REQUIREMENT_OPERATORS);
  viaField('m_magicSchool', MAGIC_SCHOOLS);
  return pairs;
}

describe('glossary coverage — every rendered term has an entry', () => {
  it('has an entry for every key of the six quest spec tables', () => {
    const missing: string[] = [];
    for (const [table, keys] of Object.entries(tableKeys())) {
      expect(keys.length, `${table} exports no keys`).toBeGreaterThan(0);
      for (const key of keys) {
        if (fieldTerm(key) === undefined) missing.push(`${table}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('has an entry for every quoted m_ key in the six tables’ source', () => {
    const missing: string[] = [];
    for (const file of SPEC_TABLE_FILES) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      for (const match of text.matchAll(/'(m_[A-Za-z0-9]+)'/g)) {
        if (fieldTerm(match[1]) === undefined) missing.push(`${file}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('has a class entry for every KNOWN_TYPE_STRINGS entry, by string and by short name', () => {
    expect(KNOWN_TYPE_STRINGS.length).toBe(29);
    const missing: string[] = [];
    for (const typeString of KNOWN_TYPE_STRINGS) {
      const short = shortTypeName(typeString);
      if (short === undefined || classTerm(typeString) === undefined) missing.push(typeString);
      else expect(shortClassName(typeString)).toBe(short);
    }
    expect(missing).toEqual([]);
  });

  it('has an enum entry for every literal the editor renders', () => {
    const literals = renderedEnumLiterals();
    expect(literals.length).toBeGreaterThanOrEqual(26);
    const missing = literals.filter(
      ([enumName, literal]) => enumTerm(enumName, literal) === undefined,
    );
    expect(missing).toEqual([]);
    // The two lists the editor shows in full are covered in both directions.
    expect(Object.keys(GLOSSARY.enums.ActivityType).sort()).toEqual([...ACTIVITY_TYPES].sort());
    expect(Object.keys(GLOSSARY.enums.GoalType).sort()).toEqual([...GOAL_TYPE_VALUES].sort());
  });

  it('has a group entry for every dialog section name', () => {
    const names = new Set<string>();
    for (const accordion of DIALOG_ACCORDIONS) {
      names.add(accordion.id);
      for (const group of accordion.groups) names.add(group);
    }
    const missing = [...names].filter((name) => groupTerm(name) === undefined);
    expect(missing).toEqual([]);
  });
});

/** Every entry, addressed by where it lives. */
function everyEntry(): Array<[string, GlossaryEntry]> {
  const rows: Array<[string, GlossaryEntry]> = [];
  for (const [key, entry] of Object.entries(GLOSSARY.fields)) rows.push([`fields.${key}`, entry]);
  for (const [key, entry] of Object.entries(GLOSSARY.classes)) rows.push([`classes.${key}`, entry]);
  for (const [key, entry] of Object.entries(GLOSSARY.groups)) rows.push([`groups.${key}`, entry]);
  for (const [name, table] of Object.entries(GLOSSARY.enums)) {
    for (const [literal, entry] of Object.entries(table))
      rows.push([`enums.${name}.${literal}`, entry]);
  }
  return rows;
}

/** The term a `source` line has to mention. */
function termOf(address: string): string {
  const parts = address.split('.');
  return parts[0] === 'enums' ? parts[2] : parts.slice(1).join('.');
}

/** `m_cameraOffsetY` is described on the line that says `m_cameraOffsetX/Y/Z`. */
const SLASH_GROUP = /^(m_cameraOffset|m_loc)[XYZ]$|^m_(pitch|yaw|roll)$/;

function mentions(line: string, term: string): boolean {
  if (line.includes(term)) return true;
  if (!SLASH_GROUP.test(term)) return false;
  return term.startsWith('m_cameraOffset')
    ? line.includes('m_cameraOffsetX/Y/Z')
    : term.startsWith('m_loc')
      ? line.includes('m_locX/Y/Z')
      : line.includes('m_pitch/yaw/roll');
}

const SIBLING_TREE = /^(Imlight|Imview|Aurorium)\/.+:\d+$/;

describe('glossary entries — shape, help and sources', () => {
  it('holds the counts the plan measured, plus the terms the six tables added', () => {
    expect(Object.keys(GLOSSARY.classes)).toHaveLength(29);
    expect(Object.keys(GLOSSARY.fields).length).toBeGreaterThanOrEqual(165);
    const enumCount = Object.values(GLOSSARY.enums).reduce((n, t) => n + Object.keys(t).length, 0);
    expect(enumCount).toBeGreaterThanOrEqual(19);
  });

  it('gives every entry a label, a meaningful help, a tier and a source', () => {
    const bad: string[] = [];
    for (const [address, entry] of everyEntry()) {
      if (entry.label.trim() === '') bad.push(`${address}: empty label`);
      if (entry.help.trim().length < 12) bad.push(`${address}: help too short`);
      if (entry.tier !== 'basic' && entry.tier !== 'advanced') bad.push(`${address}: tier`);
      if (!/^.+:\d+$/.test(entry.source)) bad.push(`${address}: source is not file:line`);
    }
    expect(bad).toEqual([]);
  });

  it('cites a line that names the term (in-repo sources; sibling trees are checked by the evidence script)', () => {
    const bad: string[] = [];
    let checked = 0;
    for (const [address, entry] of everyEntry()) {
      if (SIBLING_TREE.test(entry.source)) continue;
      const at = entry.source.lastIndexOf(':');
      const file = entry.source.slice(0, at);
      const line = Number(entry.source.slice(at + 1));
      const abs = path.join(ROOT, file);
      if (!fs.existsSync(abs)) {
        bad.push(`${address}: ${file} does not exist`);
        continue;
      }
      const text = fs.readFileSync(abs, 'utf8').split('\n')[line - 1];
      checked += 1;
      if (text === undefined || !mentions(text, termOf(address))) {
        bad.push(`${address}: ${entry.source} does not mention it`);
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(bad).toEqual([]);
  });

  it('never leaves an entry whose spec silence goes unsaid', () => {
    // A term the spec does not describe must say so instead of inventing a meaning.
    for (const key of ['m_displayName', 'm_dialogTag', 'm_madlibs', 'm_noAggroNoDelay']) {
      expect(fieldTerm(key)?.help).toMatch(/Not (documented|described) in the spec/);
    }
  });
});

describe('glossary lookups', () => {
  it('reads a class by short name and by assembly-qualified $type', () => {
    const qualified = 'Imcodec.ObjectProperty.TypeCache.ReqHasQuest, Imcodec.ObjectProperty';
    expect(classTerm(qualified)).toBe(classTerm('ReqHasQuest'));
    expect(classTerm('ReqHasQuest')?.label).toBe('Requires quest');
    expect(classTerm('NotAClass')).toBeUndefined();
  });

  it('reads an enum value through the field that carries it', () => {
    expect(fieldValueTerm('m_goalType', 'GOAL_TYPE_PERSONA')?.label).toBe('Persona');
    expect(fieldValueTerm('m_questLevel', 'x')).toBeUndefined();
  });

  it('answers only own properties (a key named like Object.prototype is not a term)', () => {
    expect(fieldTerm('constructor')).toBeUndefined();
    expect(classTerm('toString')).toBeUndefined();
    expect(fieldLabel('m_notAKey')).toBe('m_notAKey');
  });

  it('resolves a term reference to its entry and its technical half', () => {
    expect(resolveTerm({ field: 'm_questLevel' })).toEqual({
      entry: fieldTerm('m_questLevel'),
      technical: 'm_questLevel',
    });
    expect(resolveTerm({ enum: 'GoalType', value: 'GOAL_TYPE_PERSONA' }).technical).toBe(
      'GOAL_TYPE_PERSONA',
    );
    expect(resolveTerm({ type: 'PersonaGoalTemplate' }).entry?.label).toBe(
      'Talk to an NPC (Persona goal)',
    );
  });
});
