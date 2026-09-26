import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import {
  ApiError,
  QUESTS_QUERY_KEY,
  type QuestsListResult,
  type StatusHistoryEntry,
  type StatusValue,
} from '../../client/src/lib/api';
import {
  applyOptimisticQuestStatus,
  EMPTY_HISTORY_HINT,
  EMPTY_HISTORY_MESSAGE,
  hasHistoryNotes,
  historyActionText,
  historyErrorMessage,
  historyPanelState,
  isCurrentStatus,
  isUntrackedError,
  MARK_REVIEWED_LABEL,
  MARK_VERIFIED_LABEL,
  newestFirst,
  NOTES_HINT,
  NOTES_LABEL,
  NOTES_PLACEHOLDER,
  STATUS_MENU_LABEL,
  STATUS_TRANSITIONS,
  transitionConfirmLabel,
  transitionDialogDescription,
  transitionDialogTitle,
  transitionErrorMessage,
  transitionPatch,
  transitionSuccessMessage,
  TRANSITION_FAILED_MESSAGE,
  UNTRACKED_ENTRY_MESSAGE,
  UNTRACKED_HISTORY_MESSAGE,
} from '../../client/src/lib/status-transition';

/**
 * Story p2-09's pure logic (plan task 2.8, decision D10): the transition actions
 * and their labels, the PATCH body rule (notes present when typed, absent when
 * blank), the dialog and toast copy, the 404-vs-everything-else error mapping, the
 * history timeline's ordering/action text/blank-note rule, the panel's five states,
 * and the one optimistic cache write the badge and the filter tabs both read
 * (D51(e)).
 *
 * Plain node, no jsdom, no React: the React halves only move state and pixels.
 */

/** A `status_history` row factory, each test overriding what it cares about. */
function entry(overrides: Partial<StatusHistoryEntry> = {}): StatusHistoryEntry {
  return {
    old_status: 'extracted',
    new_status: 'reviewed',
    notes: null,
    changed_by: 'jason',
    changed_at: '2026-09-26T12:00:00.000Z',
    ...overrides,
  };
}

describe('the transition actions', () => {
  it('uses the lifecycle table`s exact button labels (spec-data-model L16-17)', () => {
    expect(MARK_REVIEWED_LABEL).toBe('Mark Reviewed');
    expect(MARK_VERIFIED_LABEL).toBe('Mark Verified');
    expect(STATUS_TRANSITIONS).toEqual([
      { status: 'reviewed', label: 'Mark Reviewed' },
      { status: 'verified', label: 'Mark Verified' },
    ]);
  });

  it('marks exactly the entry`s own status as the current (disabled) action', () => {
    expect(STATUS_TRANSITIONS.map((t) => isCurrentStatus('reviewed', t.status))).toEqual([
      true,
      false,
    ]);
    expect(STATUS_TRANSITIONS.map((t) => isCurrentStatus('verified', t.status))).toEqual([
      false,
      true,
    ]);
    // A never-reviewed entry offers both; only the exact match is disabled.
    expect(STATUS_TRANSITIONS.map((t) => isCurrentStatus('extracted', t.status))).toEqual([
      false,
      false,
    ]);
  });

  it('confirms with the action label itself and names quest + target in the dialog', () => {
    expect(transitionConfirmLabel('reviewed')).toBe('Mark Reviewed');
    expect(transitionConfirmLabel('verified')).toBe('Mark Verified');
    expect(transitionDialogTitle('verified')).toBe('Mark Verified');
    expect(transitionDialogDescription('DS-ACAD1-C01-001', 'reviewed')).toBe(
      'Mark DS-ACAD1-C01-001 as reviewed?',
    );
    expect(transitionSuccessMessage('DS-ACAD1-C01-001', 'reviewed')).toBe(
      'DS-ACAD1-C01-001 marked reviewed',
    );
  });

  it('carries the notes copy, including that the notes are optional and shown in history', () => {
    expect(NOTES_LABEL).toBe('Notes (optional)');
    expect(NOTES_PLACEHOLDER).toBe('What did you check?');
    expect(NOTES_HINT).toContain('Optional');
    expect(NOTES_HINT).toContain('status history');
    expect(STATUS_MENU_LABEL).toBe('Change status');
  });
});

describe('the PATCH body', () => {
  it('sends the status and the typed notes, and never changed_by (D37)', () => {
    const body = transitionPatch('reviewed', 'Goal logic chain looks correct.');
    expect(body).toEqual({ status: 'reviewed', notes: 'Goal logic chain looks correct.' });
    expect(Object.keys(body).sort()).toEqual(['notes', 'status']);
  });

  it('trims the notes and omits the field entirely when blank', () => {
    expect(transitionPatch('verified', '  r806919 verified  ')).toEqual({
      status: 'verified',
      notes: 'r806919 verified',
    });
    for (const blank of ['', '   ', '\n\t ']) {
      const body = transitionPatch('reviewed', blank);
      expect(body).toEqual({ status: 'reviewed' });
      expect('notes' in body).toBe(false);
    }
  });
});

describe('error mapping: the untracked 404 in particular (D51(f))', () => {
  it('recognises only an ApiError 404 as the untracked entry', () => {
    expect(isUntrackedError(new ApiError(404, 'Unknown quests entry "NOPE"'))).toBe(true);
    expect(isUntrackedError(new ApiError(500, 'boom'))).toBe(false);
    expect(isUntrackedError(new Error('Unknown quests entry "NOPE"'))).toBe(false);
    expect(isUntrackedError(undefined)).toBe(false);
    expect(isUntrackedError('404')).toBe(false);
  });

  it('turns the 404 into the actionable save/import-first message, not a generic failure', () => {
    const message = transitionErrorMessage(new ApiError(404, 'Unknown quests entry "NOPE"'));
    expect(message).toBe(UNTRACKED_ENTRY_MESSAGE);
    expect(message).toContain('save or import');
    expect(message).not.toContain('Could not update the status.');
  });

  it('passes every other failure`s own server message through, with a fallback', () => {
    expect(transitionErrorMessage(new ApiError(400, 'Invalid status "nope"'))).toBe(
      'Invalid status "nope"',
    );
    expect(transitionErrorMessage(new Error('   '))).toBe(TRANSITION_FAILED_MESSAGE);
    expect(transitionErrorMessage(undefined)).toBe(TRANSITION_FAILED_MESSAGE);
    // The history read has its own wording for the same condition.
    expect(historyErrorMessage(new ApiError(404, 'Unknown quests entry "NOPE"'))).toBe(
      UNTRACKED_HISTORY_MESSAGE,
    );
    expect(historyErrorMessage(new ApiError(500, 'boom'))).toBe('boom');
  });
});

describe('the history timeline', () => {
  it('renders newest first by reversing the endpoint`s oldest-first rows (D37)', () => {
    const oldest = entry({ old_status: null, new_status: 'extracted' });
    const middle = entry({ new_status: 'reviewed' });
    const newest = entry({ new_status: 'verified' });
    expect(newestFirst([oldest, middle, newest])).toEqual([newest, middle, oldest]);
    // It never mutates the input (the query cache hands out the same array).
    const rows = [oldest, middle, newest];
    newestFirst(rows);
    expect(rows).toEqual([oldest, middle, newest]);
    expect(newestFirst([])).toEqual([]);
  });

  it('says `marked {status}` for a transition and the bare status for the first row', () => {
    expect(historyActionText(entry({ old_status: 'reviewed', new_status: 'verified' }))).toBe(
      'marked verified',
    );
    // The spec's own example draws `DropTable KT-SPH3-C02-003 extracted` (L177).
    expect(historyActionText(entry({ old_status: null, new_status: 'extracted' }))).toBe(
      'extracted',
    );
  });

  it('treats null and whitespace-only notes as no note', () => {
    expect(hasHistoryNotes(entry({ notes: null }))).toBe(false);
    expect(hasHistoryNotes(entry({ notes: '' }))).toBe(false);
    expect(hasHistoryNotes(entry({ notes: '   ' }))).toBe(false);
    expect(hasHistoryNotes(entry({ notes: 'Verified on r806919' }))).toBe(true);
  });
});

describe('the history panel states', () => {
  const loaded = (data: StatusHistoryEntry[]) => ({
    isPending: false,
    isError: false,
    error: undefined,
    data,
  });

  it('walks loading → untracked → error → empty → ready', () => {
    expect(
      historyPanelState({ isPending: true, isError: false, error: undefined, data: undefined }),
    ).toBe('loading');
    expect(
      historyPanelState({
        isPending: false,
        isError: true,
        error: new ApiError(404, 'Unknown quests entry "NOPE"'),
        data: undefined,
      }),
    ).toBe('untracked');
    expect(
      historyPanelState({
        isPending: false,
        isError: true,
        error: new ApiError(500, 'boom'),
        data: undefined,
      }),
    ).toBe('error');
    expect(historyPanelState(loaded([]))).toBe('empty');
    expect(historyPanelState(loaded([entry()]))).toBe('ready');
    // A loading query still wins over a stale error flag.
    expect(
      historyPanelState({
        isPending: true,
        isError: true,
        error: new ApiError(500, 'boom'),
        data: [],
      }),
    ).toBe('loading');
  });

  it('has explicit copy for the empty case (an imported entry has no history — D37)', () => {
    expect(EMPTY_HISTORY_MESSAGE).toBe('No status changes recorded yet.');
    expect(EMPTY_HISTORY_HINT).toContain('no transition history');
  });
});

describe('the optimistic status write (D51(e))', () => {
  /** A minimal `GET /api/quests` payload with one row per status. */
  function listBody(): QuestsListResult {
    return {
      quests: [
        {
          quest_name: 'A',
          title: 'A',
          title_key: null,
          title_source: 'rawKey',
          level: 1,
          goal_count: 0,
          is_mainline: false,
          modified_at: null,
          status: 'extracted',
        },
        {
          quest_name: 'B',
          title: 'B',
          title_key: null,
          title_source: 'rawKey',
          level: 1,
          goal_count: 0,
          is_mainline: false,
          modified_at: null,
          status: 'extracted',
        },
      ],
      summary: { total: 2, extracted: 2, reviewed: 0, verified: 0 },
      skipped: [],
    };
  }

  function seeded(): QueryClient {
    const client = new QueryClient();
    client.setQueryData(QUESTS_QUERY_KEY, listBody());
    return client;
  }

  function statusOf(client: QueryClient, name: string): StatusValue | undefined {
    return client
      .getQueryData<QuestsListResult>(QUESTS_QUERY_KEY)
      ?.quests.find((row) => row.quest_name === name)?.status;
  }

  it('flips the row the badge reads and keeps the list`s own summary in step (D49(b))', () => {
    const client = seeded();

    expect(applyOptimisticQuestStatus(client, 'A', 'reviewed')).toBe(true);

    expect(statusOf(client, 'A')).toBe('reviewed');
    expect(statusOf(client, 'B')).toBe('extracted');
    expect(client.getQueryData<QuestsListResult>(QUESTS_QUERY_KEY)?.summary).toEqual({
      total: 2,
      extracted: 1,
      reviewed: 1,
      verified: 0,
    });
  });

  it('is a no-op that reports so when the list is not cached (nothing to roll back)', () => {
    const client = new QueryClient();
    expect(applyOptimisticQuestStatus(client, 'A', 'verified')).toBe(false);
    expect(client.getQueryData(QUESTS_QUERY_KEY)).toBeUndefined();
  });

  it('leaves the payload identical for an unknown key', () => {
    const client = seeded();
    const before = client.getQueryData<QuestsListResult>(QUESTS_QUERY_KEY);
    expect(applyOptimisticQuestStatus(client, 'NOPE', 'verified')).toBe(true);
    expect(client.getQueryData<QuestsListResult>(QUESTS_QUERY_KEY)).toEqual(before);
  });
});
