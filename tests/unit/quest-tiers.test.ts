import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ENUM_OF_FIELD, enums, fields } from '../../shared/glossary';
import { TYPE_STRINGS } from '../../shared/quest/typeConstants';
import AdvancedDisclosure from '../../client/src/components/shared/AdvancedDisclosure';
import ReadOnlyEnumValue from '../../client/src/components/shared/ReadOnlyEnumValue';
import {
  fieldDefault,
  hasAdvancedValue,
  singleLegalValue,
  splitByTier,
} from '../../client/src/lib/advanced';
import {
  DIALOG_ACCORDIONS,
  dialogFieldsInAccordion,
  newDialogEntry,
} from '../../client/src/lib/quest-dialog';
import { GOAL_EDITABLE_BASE_FIELDS, GOAL_TYPE_SPECS } from '../../client/src/lib/quest-goals';
import { GOAL_LOGIC_ENTRY_KEYS } from '../../client/src/lib/quest-goal-logic';
import { QUEST_ADVANCED_FIELDS, QUEST_VISIBLE_FIELDS } from '../../client/src/lib/quest-info';
import { RESULT_TYPE_SPECS, SOUND_ROUTER_FIELD_SPECS } from '../../client/src/lib/quest-results';
import { REQUIREMENT_TYPE_SPECS } from '../../client/src/lib/requirement-tree';

/**
 * Task 7.11 (p7-12, D132, D179): each tab's Basic set is pinned here, derived from the glossary's
 * tier over the tab's own field inventory. A new field, or a tier change in the glossary, turns
 * one of these red until the pin is updated on purpose.
 */

const keys = (list: readonly { key: string }[]): string[] => list.map((field) => field.key);

describe('the tier is glossary data', () => {
  it('every field a tab renders has a glossary entry (an unclassified key would default to basic)', () => {
    const rendered = [
      ...QUEST_VISIBLE_FIELDS,
      ...QUEST_ADVANCED_FIELDS,
      ...GOAL_EDITABLE_BASE_FIELDS,
      ...GOAL_TYPE_SPECS.flatMap((type) => type.fields),
      ...REQUIREMENT_TYPE_SPECS.flatMap((type) => type.fields),
      ...RESULT_TYPE_SPECS.flatMap((type) => type.fields),
      ...SOUND_ROUTER_FIELD_SPECS,
      ...DIALOG_ACCORDIONS.flatMap((accordion) => dialogFieldsInAccordion(accordion)),
    ];
    for (const field of rendered) {
      expect(fields[field.key], field.key).toBeDefined();
    }
  });
});

describe('Info tab', () => {
  const { basic, advanced } = splitByTier([...QUEST_VISIBLE_FIELDS, ...QUEST_ADVANCED_FIELDS]);

  it('pins the basic set', () => {
    expect(keys(basic)).toEqual([
      'm_questName',
      'm_questTitle',
      'm_questLevel',
      'm_mainline',
      'm_isHidden',
      'm_questRepeat',
      'm_activityType',
      'm_onStartQuestScript',
      'm_onEndQuestScript',
      'm_clientTags',
    ]);
  });

  it('agrees with the tab’s own visible/Advanced lists (the glossary follows the existing split)', () => {
    expect(keys(basic)).toEqual(expect.arrayContaining(keys(QUEST_VISIBLE_FIELDS)));
    expect(keys(basic)).toHaveLength(QUEST_VISIBLE_FIELDS.length);
    expect(keys(advanced).sort()).toEqual(keys(QUEST_ADVANCED_FIELDS).sort());
  });
});

describe('Goals tab', () => {
  it('pins each goal class’s basic fields and the shared base fields', () => {
    const basicByClass = Object.fromEntries(
      GOAL_TYPE_SPECS.map((type) => [type.shortName, keys(splitByTier(type.fields).basic)]),
    );
    expect(basicByClass).toEqual({
      Waypoint: ['m_zoneTag', 'm_zoneEntry', 'm_zoneExit', 'm_proximityTag'],
      Persona: ['m_personaName', 'm_usePatron'],
      Bounty: ['m_npcAdjectives', 'm_bountyTotal', 'm_bountyType'],
      Scavenge: ['m_itemAdjectives', 'm_itemTotal'],
      AchieveRank: ['m_rank'],
    });
    for (const type of GOAL_TYPE_SPECS) {
      expect(splitByTier(type.fields).advanced, type.shortName).toEqual([]);
    }
    const base = splitByTier(GOAL_EDITABLE_BASE_FIELDS);
    expect(keys(base.basic)).toEqual([
      'm_goalName',
      'm_goalTitle',
      'm_completeText',
      'm_locationName',
      'm_clientTags',
      'm_destinationZone',
      'm_goalType',
    ]);
    expect(keys(base.advanced)).toEqual([
      'm_goalNameID',
      'm_goalUnderway',
      'm_hyperlink',
      'm_displayImage1',
      'm_displayImage2',
      'm_autoQualify',
      'm_autoComplete',
      'm_noQuestHelper',
      'm_petOnlyQuest',
      'm_hideGoalFloatyText',
    ]);
  });
});

describe('Goal Logic tab', () => {
  it('pins the basic set: all five keys are basic, so it has no Advanced disclosure', () => {
    expect(GOAL_LOGIC_ENTRY_KEYS).toEqual([
      'm_goalsAND',
      'm_goalsOR',
      'm_goalsToAdd',
      'm_completeQuest',
      'm_requiredORCount',
    ]);
    expect(splitByTier(GOAL_LOGIC_ENTRY_KEYS.map((key) => ({ key }))).advanced).toEqual([]);
  });
});

describe('Requirements tab', () => {
  it('pins each requirement class’s basic fields (m_applyNOT and m_operator are basic on every leaf)', () => {
    const basicByClass = Object.fromEntries(
      REQUIREMENT_TYPE_SPECS.map((type) => [type.shortName, keys(splitByTier(type.fields).basic)]),
    );
    expect(basicByClass).toEqual({
      ReqHasQuest: ['m_questName'],
      ReqHasEntry: ['m_entryName', 'm_questName'],
      ReqSchoolOfFocus: ['m_magicSchool'],
      ReqIsSchool: ['m_magicSchoolName', 'm_targetType'],
    });
    expect(keys(splitByTier(REQUIREMENT_TYPE_SPECS[1]!.fields).advanced)).toEqual([
      'm_displayName',
      'm_isQuestRegistry',
    ]);
    expect(fields.m_applyNOT!.tier).toBe('basic');
    expect(fields.m_operator!.tier).toBe('basic');
  });
});

describe('Results tab', () => {
  it('pins each result class’s basic and advanced fields', () => {
    const split = Object.fromEntries(
      RESULT_TYPE_SPECS.map((type) => {
        const { basic, advanced } = splitByTier(type.fields);
        return [type.shortName, [keys(basic), keys(advanced)]];
      }),
    );
    expect(split).toEqual({
      ResDropTable: [['m_tableName', 'm_maxRolls'], []],
      ResModifyEntry: [['m_entryName', 'm_value', 'm_questName'], ['m_isQuestRegistry']],
      ResAddDynaMod: [
        [],
        [
          'm_dynaModClientTag',
          'm_dynaModRemove',
          'm_useQuestAsOriginator',
          'm_dynaModState',
          'm_zoneName',
        ],
      ],
      ResLearnSpell: [['m_templateID', 'm_requirements'], []],
      ResPostEvent: [['m_eventName'], []],
      ResAddHealth: [[], []],
      ResAddMana: [[], []],
      ResAddSpell: [['m_templateID'], []],
      ResDespawn: [['m_templateID'], ['m_spawnID', 'm_despawnEffect']],
      ResDrawHand: [['m_templateID'], []],
      ResGiveSpell: [['m_templateID', 'm_spellID'], []],
      ResPlaySound: [['m_soundName'], ['m_router', 'm_blocking', 'm_reinteractTime']],
      ResTeleport: [
        ['m_destinationZone'],
        [
          'm_destinationLoc',
          'm_exitTeleporter',
          'm_teleporterTag',
          'm_teleportType',
          'm_transitionID',
        ],
      ],
      ResWait: [['m_secondsToWait'], []],
      ResActorDialog: [[], []],
    });
  });
});

describe('Dialog tab', () => {
  const byAccordion = Object.fromEntries(
    DIALOG_ACCORDIONS.map((accordion) => [accordion.id, keys(dialogFieldsInAccordion(accordion))]),
  );

  it('pins the ten basic fields of an entry (D172), all of them glossary-basic', () => {
    expect(byAccordion.Basic).toEqual([
      'm_personaName',
      'm_nameOverride',
      'm_maxTimeSeconds',
      'm_invisible',
      'm_requirements',
      'm_dialog',
      'm_picture',
      'm_soundFile',
      'm_dialogEvent',
      'm_actorTemplateID',
    ]);
    for (const key of byAccordion.Basic!) {
      expect(fields[key]!.tier, key).toBe('basic');
    }
  });

  it('puts every other field in a collapsed accordion, and every one of them is advanced', () => {
    for (const id of ['Camera', 'Sound', 'Animation', 'Advanced']) {
      for (const key of byAccordion[id]!) {
        expect(fields[key]!.tier, `${id}/${key}`).toBe('advanced');
      }
    }
    const total = Object.values(byAccordion).reduce((sum, list) => sum + list.length, 0);
    expect(total).toBe(66);
    expect(new Set(Object.values(byAccordion).flat()).size).toBe(66);
  });
});

describe('the Advanced auto-open rule', () => {
  const doc = (value: unknown) => ({ value: () => value });
  const path = [['m_cameraOffsetX']];
  /** One field of a container of class `$type` (a dialog entry, a requirement leaf, …). */
  const inClass = (classType: string, key: string, value: unknown) => ({
    state: {
      value: (p: readonly unknown[]) =>
        p.length === 1 ? { $type: classType, [key]: value } : value,
    },
    paths: [['node', key]],
  });
  const ENTRY = TYPE_STRINGS.NPCDialogEntry;

  // D195 (PR #14 review 4, owner-approved): "set" is **differs from that field's own default**,
  // derived from the builders — no longer the generic empty set. This block used to pin the old
  // rule ('' / 0 / false / [] never open, anything else opens); each arm below states the new one.

  it('treats null/absent and the field default as not opening Advanced', () => {
    // m_cameraOffsetX: every builder that writes it writes 0.
    expect(fieldDefault('m_cameraOffsetX')).toEqual({ known: true, value: 0 });
    for (const value of [null, undefined, 0]) {
      expect(hasAdvancedValue(doc(value), path), JSON.stringify(value)).toBe(false);
    }
  });

  it('opens on any value other than the field default, including another "empty" one', () => {
    for (const value of [1, -0.5, 'x', true, [1], { m_locX: 3 }, '', false, []]) {
      expect(hasAdvancedValue(doc(value), path), JSON.stringify(value)).toBe(true);
    }
  });

  it('opens an authored false/0 where the field defaults to true/non-zero (the reviewer’s cases)', () => {
    for (const [key, authored] of [
      ['m_bypassCameraOnReview', false],
      ['m_meetsRequirements', false],
      ['m_playMusicIfSpamming', false],
      ['m_cameraFadeTime', 0],
      ['m_spamTime', 0],
      ['m_cameraHidePlayers', 0],
    ] as const) {
      const { state, paths } = inClass(ENTRY, key, authored);
      expect(hasAdvancedValue(state, paths), key).toBe(true);
    }
    // m_isQuestRegistry defaults by class: ReqHasEntry true (so false opens — WC-UNICORN-MAIN-002's
    // second ReqHasEntry, in the D17 clone), ResModifyEntry false (so false stays collapsed).
    const hasEntry = inClass(TYPE_STRINGS.ReqHasEntry, 'm_isQuestRegistry', false);
    expect(hasAdvancedValue(hasEntry.state, hasEntry.paths)).toBe(true);
    const modify = inClass(TYPE_STRINGS.ResModifyEntry, 'm_isQuestRegistry', false);
    expect(hasAdvancedValue(modify.state, modify.paths)).toBe(false);
  });

  it('keeps a freshly added dialog entry collapsed: every value equals its own default', () => {
    const entry = newDialogEntry();
    for (const accordion of DIALOG_ACCORDIONS) {
      const paths = dialogFieldsInAccordion(accordion).map((field) => ['entry', field.key]);
      const state = {
        value: (p: readonly unknown[]) => (p.length === 1 ? entry : entry[p[1] as string]),
      };
      expect(hasAdvancedValue(state, paths), accordion.id).toBe(false);
    }
  });

  it('falls back to the empty rule for a field no builder writes', () => {
    expect(fieldDefault('m_notWrittenByAnyBuilder')).toEqual({ known: false });
    const other = [['m_notWrittenByAnyBuilder']];
    for (const value of [null, '', 0, false, []]) {
      expect(hasAdvancedValue(doc(value), other), JSON.stringify(value)).toBe(false);
    }
    expect(hasAdvancedValue(doc('x'), other)).toBe(true);
  });

  it('renders the disclosure closed, opened by a value, and held open by an error', () => {
    const html = (mustOpen: boolean, hasError: boolean) =>
      renderToStaticMarkup(
        createElement(AdvancedDisclosure, { count: 3, mustOpen, hasError, children: 'body' }),
      );
    expect(html(false, false)).not.toMatch(/<details[^>]* open/);
    expect(html(false, false)).toContain('Advanced (3)');
    expect(html(true, false)).toMatch(/<details[^>]* open/);
    expect(html(false, true)).toMatch(/<details[^>]* open/);
  });
});

describe('single-legal-value enums render as read-only text', () => {
  /** Every `enum`/`select` option list a form offers, by field key. */
  const optionLists: Record<string, readonly string[]> = {};
  for (const type of GOAL_TYPE_SPECS) {
    for (const field of type.fields) {
      if (field.options !== undefined) optionLists[field.key] = field.options;
    }
  }
  for (const type of REQUIREMENT_TYPE_SPECS) {
    for (const field of type.fields) {
      if (field.options !== undefined) optionLists[field.key] = field.options;
    }
  }
  for (const type of RESULT_TYPE_SPECS) {
    for (const field of [...type.fields, ...SOUND_ROUTER_FIELD_SPECS]) {
      if (field.options !== undefined) optionLists[field.key] = field.options;
    }
  }

  it('finds exactly the enums whose glossary lists one literal', () => {
    const single = Object.keys(optionLists)
      .filter((key) => optionLists[key]!.length === 1)
      .sort();
    expect(single).toEqual(['m_bountyType', 'm_routingType', 'm_targetType', 'm_teleportType']);
    for (const key of single) {
      expect(Object.keys(enums[ENUM_OF_FIELD[key]!]!), key).toEqual([...optionLists[key]!]);
    }
  });

  it('shows the read-only text only when the document already holds the one legal value', () => {
    expect(singleLegalValue(['BT_MOB_KILL'], 'BT_MOB_KILL')).toBe('BT_MOB_KILL');
    expect(singleLegalValue(['BT_MOB_KILL'], '')).toBeNull();
    expect(singleLegalValue(['BT_MOB_KILL'], undefined)).toBeNull();
    expect(singleLegalValue(['BT_MOB_KILL'], 'BT_OTHER')).toBeNull();
    expect(singleLegalValue(['A', 'B'], 'A')).toBeNull();
  });

  it('renders the glossary pair as text, not a select', () => {
    const html = renderToStaticMarkup(
      createElement(ReadOnlyEnumValue, {
        id: 'x',
        fieldKey: 'm_bountyType',
        value: 'BT_MOB_KILL',
      }),
    );
    expect(html).toContain('<output');
    expect(html).not.toContain('<select');
    expect(html).toContain('Kill mobs');
    expect(html).toContain('BT_MOB_KILL');
  });
});
