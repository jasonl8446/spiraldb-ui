import { describe, expect, it } from 'vitest';

import { applyEdits } from '@shared/document';
import { buildQuestScaffold } from '@shared/quest/scaffold';

import {
  DEFAULT_DRAFT_FILTER,
  draftDisplayName,
  draftEditorPath,
  draftsRequestPath,
  draftsSummary,
  namingPrefill,
  pendingBySource,
  planSuggestionAccept,
  REWARD_OBSERVATION_REASON,
  REWARDS_PATH,
  suggestionTab,
  suggestionValueText,
  type Suggestion,
} from '../../client/src/lib/suggestions';

/**
 * Story p7-08 (task 7.7): the pure rules behind `/drafts` and the inline suggestions —
 * `client/src/lib/suggestions.ts`. The components only render these answers, so the queue's query,
 * a row's destination and what Accept writes are pinned here without a browser.
 */

function suggestion(overrides: Partial<Suggestion>): Suggestion {
  return {
    id: 1,
    path: 'm_questTitle',
    value: 'QuestTitle_1ED8D',
    source: 'evidence-title',
    confidence: 1,
    evidence_ref: null,
    status: 'pending',
    created_at: null,
    decided_at: null,
    ...overrides,
  };
}

const skeleton = buildQuestScaffold({ name: 'FX-Q-C01-001', link: { kind: 'none' } });

describe('p7-08 — the draft queue', () => {
  it('turns every filter into a server query parameter and nothing else', () => {
    expect(draftsRequestPath(DEFAULT_DRAFT_FILTER)).toBe('/api/drafts');
    expect(
      draftsRequestPath({ named: false, hasFile: true, source: 'evidence-goals', all: true }),
    ).toBe('/api/drafts?named=0&has_file=1&source=evidence-goals&all=1');
    expect(draftsRequestPath({ ...DEFAULT_DRAFT_FILTER, named: true })).toBe('/api/drafts?named=1');
  });

  it('opens a file as itself, a missing named quest on its skeleton, an unnamed id on its own', () => {
    expect(draftEditorPath({ quest_name: 'A-B-C01-001', catalog_id: 5, has_definition: 1 })).toBe(
      '/quests/A-B-C01-001',
    );
    expect(
      draftEditorPath({ quest_name: 'A-B-C01-001', catalog_id: null, has_definition: 0 }),
    ).toBe('/drafts/quest/A-B-C01-001');
    expect(draftEditorPath({ quest_name: null, catalog_id: 128004, has_definition: 0 })).toBe(
      '/drafts/id/128004',
    );
  });

  it('shows the name pair, with the id as the unnamed tier’s technical half', () => {
    expect(
      draftDisplayName({ quest_name: 'DM-GRAVE-MAIN-008', catalog_id: 1, title: 'Stakes' }),
    ).toBe('Stakes (DM-GRAVE-MAIN-008)');
    expect(draftDisplayName({ quest_name: 'X-1', catalog_id: null, title: 'X-1' })).toBe('X-1');
    expect(
      draftDisplayName({ quest_name: null, catalog_id: 128004, title: 'The Lost Lantern' }),
    ).toBe('The Lost Lantern (#128004)');
    expect(draftDisplayName({ quest_name: null, catalog_id: 7, title: null })).toBe('#7');
  });

  it('says both numbers as text, and the hidden count only while hidden', () => {
    expect(draftsSummary({ total: 1840, hidden_zero_evidence: 4412 }, false)).toBe(
      '1,840 drafts with evidence · 4,412 with none hidden',
    );
    expect(draftsSummary({ total: 1, hidden_zero_evidence: 0 }, true)).toBe(
      '1 draft, zero-evidence drafts included',
    );
  });
});

describe('p7-08 — Accept as an edit of the in-memory document', () => {
  it('sets a top-level field with one set edit', () => {
    const plan = planSuggestionAccept(skeleton, suggestion({}));
    expect(plan).toEqual({
      kind: 'accept',
      edit: { op: 'set', path: ['m_questTitle'], value: 'QuestTitle_1ED8D' },
    });
  });

  it('disables a field inside a container the document does not have yet, naming it', () => {
    const location = suggestion({ path: 'm_goals[0].m_locationName', value: 'ZoneLocName_X' });
    const plan = planSuggestionAccept(skeleton, location);
    expect(plan).toEqual({
      kind: 'disabled',
      reason: 'Accept m_goals first: this value fills a field inside it.',
    });
    const withGoal = applyEdits(skeleton, [
      { op: 'set', path: ['m_goals'], value: [{ m_goalName: 'Goal', m_locationName: '' }] },
    ]);
    expect(planSuggestionAccept(withGoal, location).kind).toBe('accept');
  });

  it('appends a reward result, and shows a null result as an observation that cannot be accepted (D159)', () => {
    const spell = suggestion({
      path: REWARDS_PATH,
      source: 'capture-rewards',
      value: {
        kind: 'spell',
        templateId: 42,
        result: { $type: 'ResLearnSpell', m_templateID: 42 },
      },
    });
    const planned = planSuggestionAccept(skeleton, spell);
    expect(planned).toEqual({
      kind: 'accept',
      edit: {
        op: 'insert',
        path: ['m_endResults', 'm_results'],
        index: 0,
        value: { $type: 'ResLearnSpell', m_templateID: 42 },
      },
    });
    const gold = suggestion({
      path: REWARDS_PATH,
      source: 'capture-rewards',
      value: { kind: 'gold', amount: 120, result: null },
    });
    expect(planSuggestionAccept(skeleton, gold)).toEqual({
      kind: 'disabled',
      reason: REWARD_OBSERVATION_REASON,
    });
    expect(suggestionValueText(gold)).toBe('gold: amount 120');
  });

  it('places each suggestion in the tab that holds its field', () => {
    expect(suggestionTab('m_questTitle')).toBe('Info');
    expect(suggestionTab('m_goals')).toBe('Goals');
    expect(suggestionTab('m_goals[2].m_locationName')).toBe('Goals');
    expect(suggestionTab('m_goalLogic')).toBe('Goal Logic');
    expect(suggestionTab('m_requirements')).toBe('Requirements');
    expect(suggestionTab(REWARDS_PATH)).toBe('Results');
    expect(suggestionTab('m_dialogList')).toBe('Dialog');
  });

  it('groups pending suggestions by source in the server’s source order', () => {
    const groups = pendingBySource([
      suggestion({ id: 1, source: 'evidence-location' }),
      suggestion({ id: 2, source: 'evidence-title' }),
      suggestion({ id: 3, source: 'evidence-title', status: 'rejected' }),
      suggestion({ id: 4, source: 'evidence-location' }),
    ]);
    expect(groups.map(([source, list]) => [source, list.map((s) => s.id)])).toEqual([
      ['evidence-title', [2]],
      ['evidence-location', [1, 4]],
    ]);
  });

  it('pre-fills an unnamed draft’s name from its title key, never from nothing (D137)', () => {
    expect(namingPrefill(skeleton, [suggestion({ value: 'QuestTitle_1F404' })])).toBe(
      'QuestTitle_1F404',
    );
    const accepted = applyEdits(skeleton, [
      { op: 'set', path: ['m_questTitle'], value: 'QuestTitle_ABC' },
    ]);
    expect(namingPrefill(accepted, [suggestion({ value: 'QuestTitle_1F404' })])).toBe(
      'QuestTitle_ABC',
    );
    expect(namingPrefill(skeleton, [])).toBe('');
  });
});
