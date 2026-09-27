import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_TYPES,
  activityTypeOptions,
  activityTypeSelectValue,
  booleanFieldEdit,
  clientTagsEdit,
  clientTagsToText,
  numberFieldEdit,
  parseClientTags,
  QUEST_ADVANCED_FIELDS,
  QUEST_OTHER_TAB_FIELDS,
  QUEST_TOP_LEVEL_KEYS,
  QUEST_VISIBLE_FIELDS,
  questTitleDisplay,
  shouldLookupStringKey,
  textFieldEdit,
} from '../../client/src/lib/quest-info';

/**
 * The Info tab's pure rules (plan task 3.3 / story p3-03).
 *
 * Everything asserted here is a rule a browser cannot state more clearly: the field
 * inventory that makes "none dropped" checkable, and the edit/display helpers whose
 * edge cases (an empty key, a NaN number, an unlisted enum value, a `null` tag list)
 * are exactly where a form quietly corrupts a document.
 */

describe('the field inventory covers all 36 top-level keys', () => {
  it('partitions them into visible / Advanced / other-tab with nothing left over', () => {
    // The corpus-measured key list: all 322 QuestTemplates carry exactly these 36
    // keys (docs/spec-domain-reference.md L240-279).
    expect(QUEST_TOP_LEVEL_KEYS).toHaveLength(36);
    expect(new Set(QUEST_TOP_LEVEL_KEYS).size).toBe(36);

    const modelled = [
      ...QUEST_VISIBLE_FIELDS.map((field) => field.key),
      ...QUEST_ADVANCED_FIELDS.map((field) => field.key),
      ...QUEST_OTHER_TAB_FIELDS.map((field) => field.key),
    ];

    // No key is missing, none is duplicated, and none is invented: the three groups
    // partition the 36. Compared as sets because the groups are ordered as the view
    // reads (spec columns, then Advanced, then the other tabs) while
    // `QUEST_TOP_LEVEL_KEYS` keeps the corpus/spec-table order.
    expect(new Set(modelled)).toStrictEqual(new Set(QUEST_TOP_LEVEL_KEYS));
    expect(modelled).toHaveLength(36);
    expect(new Set(modelled).size).toBe(36);
  });

  it('splits them 10 visible + 12 Advanced + 14 owned by another tab', () => {
    expect(QUEST_VISIBLE_FIELDS).toHaveLength(10);
    expect(QUEST_ADVANCED_FIELDS).toHaveLength(12);
    expect(QUEST_OTHER_TAB_FIELDS).toHaveLength(14);
  });

  it('lists the visible fields in the spec order with the spec kinds (L296-298)', () => {
    expect(
      QUEST_VISIBLE_FIELDS.map((field) => [field.key, field.kind, field.column]),
    ).toStrictEqual([
      ['m_questName', 'readonly', 'left'],
      ['m_questTitle', 'text', 'left'],
      ['m_questLevel', 'number', 'left'],
      ['m_mainline', 'boolean', 'left'],
      ['m_isHidden', 'boolean', 'left'],
      ['m_questRepeat', 'number', 'left'],
      ['m_activityType', 'select', 'left'],
      ['m_onStartQuestScript', 'text', 'right'],
      ['m_onEndQuestScript', 'text', 'right'],
      ['m_clientTags', 'tags', 'right'],
    ]);
  });

  it('keeps the five object-typed keys no Phase-3 task owns listed as such', () => {
    const unowned = QUEST_OTHER_TAB_FIELDS.filter((field) => field.owner === null).map(
      (field) => field.key,
    );
    expect(unowned).toStrictEqual([
      'm_missionDoors',
      'm_dynaMods',
      'm_defaultDialogAnimation',
      'm_questEffectInfoList',
      'm_behaviors',
    ]);
  });
});

describe('the string-table title lookup', () => {
  it('only asks for a non-empty key', () => {
    expect(shouldLookupStringKey('QuestTitle_1ED8D')).toBe(true);
    // The empty key's URL (`/api/names/strings/`) is the LIST route: 24,077,358 bytes.
    expect(shouldLookupStringKey('')).toBe(false);
    expect(shouldLookupStringKey(null)).toBe(false);
    expect(shouldLookupStringKey(undefined)).toBe(false);
    expect(shouldLookupStringKey(7)).toBe(false);
  });

  it('shows the resolved value on a hit and the raw key on a miss', () => {
    const row = { key: 'QuestTitle_1ED8D', value: 'Quest for Perfection', category: 'QuestTitle' };
    expect(questTitleDisplay('QuestTitle_1ED8D', row)).toBe('Quest for Perfection');
    // Miss (a 404 leaves the row undefined): the raw key, verbatim, no warning.
    expect(questTitleDisplay('QuestTitle_1ED8D', undefined)).toBe('QuestTitle_1ED8D');
    // A row whose value is null is still a miss for display purposes.
    expect(questTitleDisplay('QuestTitle_1ED8D', { ...row, value: null })).toBe('QuestTitle_1ED8D');
  });

  it('renders nothing for an absent or empty key, never "undefined"', () => {
    expect(questTitleDisplay('', undefined)).toBe('');
    expect(questTitleDisplay(null, undefined)).toBe('');
    expect(questTitleDisplay(undefined, undefined)).toBe('');
  });
});

describe('the activity select', () => {
  it("offers exactly Imcodec's six generated enum values", () => {
    expect(ACTIVITY_TYPES).toStrictEqual([
      'ACTIVITY_NotActivity',
      'ACTIVITY_Spell',
      'ACTIVITY_Crafting',
      'ACTIVITY_Fishing',
      'ACTIVITY_Gardening',
      'ACTIVITY_Pet',
    ]);
  });

  it('adds an unset option when the document has no usable value', () => {
    const options = activityTypeOptions(null);
    expect(options).toHaveLength(7);
    expect(options[0]).toStrictEqual({ value: '', label: '—', unlisted: false });
    expect(activityTypeSelectValue(null)).toBe('');
    expect(activityTypeSelectValue(undefined)).toBe('');
    expect(activityTypeSelectValue('')).toBe('');
  });

  it('selects a known value without adding anything', () => {
    expect(activityTypeOptions('ACTIVITY_Crafting')).toHaveLength(6);
    expect(activityTypeSelectValue('ACTIVITY_Crafting')).toBe('ACTIVITY_Crafting');
  });

  it('keeps an unlisted value selectable and selected rather than rewriting it', () => {
    const options = activityTypeOptions('ACTIVITY_FutureThing');
    expect(options).toHaveLength(7);
    expect(options.at(-1)).toStrictEqual({
      value: 'ACTIVITY_FutureThing',
      label: 'ACTIVITY_FutureThing',
      unlisted: true,
    });
    // The select's value is the document's own value: no silent snap to a listed one.
    expect(activityTypeSelectValue('ACTIVITY_FutureThing')).toBe('ACTIVITY_FutureThing');
  });
});

describe('the tag input', () => {
  it('renders null and absent as empty, and an array as comma-separated text', () => {
    expect(clientTagsToText(null)).toBe('');
    expect(clientTagsToText(undefined)).toBe('');
    expect(clientTagsToText('not-an-array')).toBe('');
    expect(clientTagsToText([])).toBe('');
    expect(clientTagsToText(['event', 'seasonal'])).toBe('event, seasonal');
  });

  it('parses commas without reordering, deduplicating or normalising', () => {
    expect(parseClientTags('event, seasonal')).toStrictEqual(['event', 'seasonal']);
    expect(parseClientTags('  spaced  , ,two')).toStrictEqual(['spaced', 'two']);
    expect(parseClientTags('b, a, b')).toStrictEqual(['b', 'a', 'b']);
    expect(parseClientTags('')).toStrictEqual([]);
  });

  it('deletes the key when cleared if it exists, and does nothing when it does not', () => {
    expect(clientTagsEdit('m_clientTags', true, '')).toStrictEqual({
      op: 'delete',
      path: ['m_clientTags'],
    });
    expect(clientTagsEdit('m_clientTags', false, '  ')).toBeNull();
    expect(clientTagsEdit('m_clientTags', false, 'event')).toStrictEqual({
      op: 'set',
      path: ['m_clientTags'],
      value: ['event'],
    });
  });
});

describe('the scalar edits', () => {
  it('sets a non-empty string and deletes on empty only when the key exists', () => {
    expect(textFieldEdit('m_questTitle', true, 'QuestTitle_1ED8D')).toStrictEqual({
      op: 'set',
      path: ['m_questTitle'],
      value: 'QuestTitle_1ED8D',
    });
    expect(textFieldEdit('m_questTitle', true, '')).toStrictEqual({
      op: 'delete',
      path: ['m_questTitle'],
    });
    // Clearing an absent field must not create it.
    expect(textFieldEdit('m_questTitle', false, '')).toBeNull();
  });

  it('writes numbers exactly as parsed, and refuses a non-finite intermediate', () => {
    expect(numberFieldEdit('m_questLevel', true, '7')).toStrictEqual({
      op: 'set',
      path: ['m_questLevel'],
      value: 7,
    });
    // No rounding or truncation (D57: validate, never normalise).
    expect(numberFieldEdit('m_questLevel', true, '7.5')).toStrictEqual({
      op: 'set',
      path: ['m_questLevel'],
      value: 7.5,
    });
    expect(numberFieldEdit('m_questLevel', true, '-3')).toStrictEqual({
      op: 'set',
      path: ['m_questLevel'],
      value: -3,
    });
    // The browser hands through partial input like `1e` and `-` while typing: that
    // must produce no edit rather than a NaN in the document.
    expect(numberFieldEdit('m_questLevel', true, '1e')).toBeNull();
    expect(numberFieldEdit('m_questLevel', true, '-')).toBeNull();
    expect(numberFieldEdit('m_questLevel', true, 'abc')).toBeNull();
    // Emptying a number field deletes it, like a string field.
    expect(numberFieldEdit('m_questLevel', true, '')).toStrictEqual({
      op: 'delete',
      path: ['m_questLevel'],
    });
    expect(numberFieldEdit('m_questLevel', false, '')).toBeNull();
  });

  it('writes a checkbox state as a real boolean', () => {
    expect(booleanFieldEdit('m_mainline', true)).toStrictEqual({
      op: 'set',
      path: ['m_mainline'],
      value: true,
    });
    expect(booleanFieldEdit('m_mainline', false)).toStrictEqual({
      op: 'set',
      path: ['m_mainline'],
      value: false,
    });
  });
});
