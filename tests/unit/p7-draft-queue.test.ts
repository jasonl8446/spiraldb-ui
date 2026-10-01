import { describe, expect, it } from 'vitest';

import { applyEdits } from '@shared/document';
import { buildQuestScaffold } from '@shared/quest/scaffold';

import {
  DEFAULT_DRAFT_FILTER,
  draftDisplayName,
  draftEditorPath,
  draftsRequestPath,
  draftsEmptyState,
  draftsSummary,
  isDraftAlreadySaved,
  namingPrefill,
  pendingBySource,
  planSuggestionAccept,
  reconcileApplied,
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
    // The Goals tab owns the start goals (QUEST_OTHER_TAB_FIELDS); the wrapper emits this path
    // (WC-TUT-C05-001's capture-order sidecar) — PR #14 review 8.
    expect(suggestionTab('m_startGoals')).toBe('Goals');
    expect(suggestionTab('m_prepRequirements')).toBe('Requirements');
    expect(suggestionTab('m_startResults')).toBe('Results');
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

describe('PR #14 review 3 — a failed save reconciles the accepted ids with the server', () => {
  it('keeps the ids still pending and drops the rest, so a retry cannot loop on the 400', () => {
    // 11 was flipped by a save whose answer was lost; 12 was rejected meanwhile (the D168 race);
    // 13 is still pending. The document keeps every value: only the claim on the ids goes.
    const applied = new Map([
      [11, 'm_questTitle'],
      [12, 'm_goals'],
      [13, 'm_requirements'],
    ]);
    const { kept, dropped } = reconcileApplied(applied, [13, 99]);
    expect([...kept]).toEqual([[13, 'm_requirements']]);
    expect(dropped).toEqual([11, 12]);
    // Nothing to drop: the same map back, unchanged.
    const unchanged = reconcileApplied(kept, [13]);
    expect(unchanged.dropped).toEqual([]);
    expect([...unchanged.kept]).toEqual([[13, 'm_requirements']]);
  });

  it('recognises a draft first save refused because its file now exists', () => {
    const refusal = Object.assign(
      new Error(
        '"FX-1" already has a definition in QuestTemplates/. Open it in the editor instead',
      ),
      { status: 409 },
    );
    expect(isDraftAlreadySaved(refusal)).toBe(true);
    // A duplicate *name* for an unnamed draft is the user's to change, not this recovery (D137).
    const duplicate = Object.assign(new Error('"FX-1" is already a quest name.'), { status: 409 });
    expect(isDraftAlreadySaved(duplicate)).toBe(false);
    expect(isDraftAlreadySaved(Object.assign(new Error('dirty'), { status: 409 }))).toBe(false);
    expect(isDraftAlreadySaved(new Error('already has a definition'))).toBe(false);
  });
});

describe('PR #14 review 9e — the /drafts empty state says which empty it is', () => {
  const catalog = { nameable: 1717, id_space: 6365 };
  it('never claims an empty catalog while coverage is loading or failed', () => {
    expect(draftsEmptyState(DEFAULT_DRAFT_FILTER, 'pending')).toBe('coverage-pending');
    expect(draftsEmptyState(DEFAULT_DRAFT_FILTER, 'error')).toBe('coverage-error');
  });

  it('tells no match (a filter is set) from no catalog and no suggestions', () => {
    expect(draftsEmptyState({ ...DEFAULT_DRAFT_FILTER, source: 'evidence-title' }, 'pending')).toBe(
      'no-match',
    );
    expect(draftsEmptyState({ ...DEFAULT_DRAFT_FILTER, named: false }, catalog)).toBe('no-match');
    expect(draftsEmptyState(DEFAULT_DRAFT_FILTER, { nameable: 0, id_space: 0 })).toBe('no-catalog');
    expect(draftsEmptyState(DEFAULT_DRAFT_FILTER, catalog)).toBe('no-suggestions');
    // The D130 toggle alone is not a filter: with it on, an empty queue is still "no suggestions".
    expect(draftsEmptyState({ ...DEFAULT_DRAFT_FILTER, all: true }, catalog)).toBe(
      'no-suggestions',
    );
  });
});

describe('PR #14 review 9i — the suggestion sources have one home', () => {
  it('is the same list on the client and the server, not a copy that can drift', async () => {
    const client = await import('../../client/src/lib/suggestions');
    const server = await import('@server/services/drafts');
    const shared = await import('@shared/suggestions');
    expect(client.SUGGESTION_SOURCES).toBe(shared.SUGGESTION_SOURCES);
    expect(server.SUGGESTION_SOURCES).toBe(shared.SUGGESTION_SOURCES);
  });
});
