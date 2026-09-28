import { describe, expect, it } from 'vitest';

import {
  fieldMapMessages,
  hasFieldMapMessages,
  SERVER_FINDING_KIND,
  validationSummaryHeadline,
  VALIDATION_SUMMARY_LABEL,
  VALIDATION_SUMMARY_TESTID,
} from '../../client/src/lib/validation-message';

/**
 * Story p5-04 (AC3) — the server's 400 field map in the shared validation vocabulary.
 *
 * The component itself is asserted in the browser (`tests/ui/validation-summary.spec.ts`); what
 * is asserted here is the pure half: the wire map becomes `FieldValidationMessage`s whose
 * lookup key is **byte-identical to the server's own key** (that is what would let an inline
 * control find the message), and the summary's headline counts correctly.
 */

describe('fieldMapMessages (the D64/D65 field map → the shared message shape)', () => {
  it('renders one message per field per sentence, all blocking', () => {
    const messages = fieldMapMessages({
      Name: ['A drop table named "X" already exists.'],
      RollChance: ['must be between 0 and 100', 'must be a number'],
    });

    expect(messages).toEqual([
      {
        severity: 'error',
        kind: SERVER_FINDING_KIND,
        path: ['Name'],
        field: 'Name',
        text: 'A drop table named "X" already exists.',
      },
      {
        severity: 'error',
        kind: SERVER_FINDING_KIND,
        path: ['RollChance'],
        field: 'RollChance',
        text: 'must be between 0 and 100',
      },
      {
        severity: 'error',
        kind: SERVER_FINDING_KIND,
        path: ['RollChance'],
        field: 'RollChance',
        text: 'must be a number',
      },
    ]);
  });

  it('keeps a nested key byte-identical to the server’s own rendered path', () => {
    // The server's keys are already rendered paths; carrying one as a whole segment is what
    // makes `formatDocPath(['m_startGoals[0].m_goalName'])` reproduce it exactly, so an inline
    // control asking for its own path finds the message without a second path grammar here.
    const [message] = fieldMapMessages({ 'm_startGoals[0].m_goalName': ['cannot be empty'] });
    expect(message?.field).toBe('m_startGoals[0].m_goalName');
    expect(message?.path).toEqual(['m_startGoals[0].m_goalName']);
  });

  it('is empty for an empty map', () => {
    expect(fieldMapMessages({})).toEqual([]);
  });
});

describe('hasFieldMapMessages', () => {
  it('is false for undefined and for an empty map, true for a populated one', () => {
    expect(hasFieldMapMessages(undefined)).toBe(false);
    expect(hasFieldMapMessages({})).toBe(false);
    expect(hasFieldMapMessages({ Name: ['x'] })).toBe(true);
  });
});

describe('the summary’s copy and anchors', () => {
  it('counts with the right noun', () => {
    expect(validationSummaryHeadline(1)).toBe('1 validation error must be fixed before saving.');
    expect(validationSummaryHeadline(3)).toBe('3 validation errors must be fixed before saving.');
  });

  it('exposes the label and testid the spec asserts on', () => {
    expect(VALIDATION_SUMMARY_LABEL).toBe('Validation summary');
    expect(VALIDATION_SUMMARY_TESTID).toBe('validation-summary');
  });
});
