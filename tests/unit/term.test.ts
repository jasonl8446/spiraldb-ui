import { describe, expect, it } from 'vitest';

import {
  docPathWords,
  fieldAddressText,
  fieldValueText,
  termText,
} from '../../client/src/lib/term';

/**
 * `lib/term.ts` — the text form of the glossary pair (story p7-10, task 7.9; D131, D135): what a
 * native `<option>` and an `aria-label` carry where `<TermLabel />` cannot go, and the words that
 * replace a document path in an accessible name.
 */

describe('termText — the pair as text', () => {
  it('renders a field, a class and an enum literal as `Friendly (technical)`', () => {
    expect(termText({ field: 'm_questLevel' })).toBe('Quest level (m_questLevel)');
    expect(termText({ type: 'ReqHasQuest' })).toBe('Requires quest (ReqHasQuest)');
    expect(
      termText({ type: 'Imcodec.ObjectProperty.TypeCache.ReqHasQuest, Imcodec.ObjectProperty' }),
    ).toBe('Requires quest (ReqHasQuest)');
    expect(termText({ enum: 'ActivityType', value: 'ACTIVITY_NotActivity' })).toBe(
      'Not an activity (ACTIVITY_NotActivity)',
    );
  });

  it('collapses identical halves (D135) and never guesses a missing entry', () => {
    expect(termText({ enum: 'MagicSchool', value: 'Fire' })).toBe('Fire');
    expect(termText({ field: 'm_notAKey' })).toBe('m_notAKey');
  });
});

describe('fieldValueText — a select option of an enum-valued field', () => {
  it('pairs a value of an enum field and leaves any other value as itself', () => {
    expect(fieldValueText('m_goalType', 'GOAL_TYPE_PERSONA')).toBe('Persona (GOAL_TYPE_PERSONA)');
    expect(fieldValueText('m_operator', 'ROP_OR')).toBe('OR (ROP_OR)');
    expect(fieldValueText('m_goalType', 'GOAL_TYPE_FUTURE')).toBe('GOAL_TYPE_FUTURE');
    expect(fieldValueText('m_zoneTag', 'WizardCity/WC_Hub')).toBe('WizardCity/WC_Hub');
  });
});

describe('docPathWords — a document path in words, for an accessible name', () => {
  it('names each key by its glossary label and each index 1-based', () => {
    expect(docPathWords(['m_startResults', 'm_results', 0])).toBe('Start results › Results 1');
    expect(docPathWords(['m_goals', 2, 'm_goalRequirements'])).toBe('Goals 3 › Goal requirements');
    expect(docPathWords(['m_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 1])).toBe(
      'Dialog list › Dialog blocks 1 › Dialog entries 2',
    );
  });

  it('drops a wrapper key that repeats the previous label, and opens a step per nested index', () => {
    expect(docPathWords(['m_requirements'])).toBe('Requirements');
    expect(docPathWords(['m_requirements', 'm_requirements', 0])).toBe('Requirements 1');
    expect(docPathWords(['m_requirements', 'm_requirements', 1, 'm_requirements', 0])).toBe(
      'Requirements 2 › 1',
    );
    expect(docPathWords(['Items', 0, 'Requirements', 'm_requirements', 1])).toBe(
      'Items 1 › Requirements 2',
    );
  });

  it('keeps distinct paths distinct', () => {
    const paths = [
      ['m_requirements', 'm_requirements', 0],
      ['m_requirements', 'm_requirements', 1],
      ['m_requirements', 'm_requirements', 1, 'm_requirements', 0],
      ['m_prepRequirements', 'm_requirements', 0],
      ['m_goals', 0, 'm_goalRequirements', 'm_requirements', 0],
      ['m_goals', 1, 'm_goalRequirements', 'm_requirements', 0],
    ];
    const words = paths.map(docPathWords);
    expect(new Set(words).size).toBe(paths.length);
    for (const text of words) {
      expect(text).not.toMatch(/m_|\[/);
    }
  });
});

describe('fieldAddressText — a field and its place', () => {
  it('reads the field pair, then where it sits', () => {
    expect(fieldAddressText(['m_goals', 2, 'm_goalText'])).toBe(
      'Goal text (m_goalText) in Goals 3',
    );
    expect(fieldAddressText(['m_questTitle'])).toBe('Quest title (m_questTitle)');
    expect(fieldAddressText(['m_goals', 0])).toBe('Goals 1');
  });
});
