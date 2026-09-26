/**
 * Status transitions — the pure half (plan task 2.8, story p2-09;
 * docs/spec-data-model.md L9-19, docs/spec-ui-design.md L160-180, decision D37).
 *
 * Everything a transition decides lives here in plain functions: which actions a
 * status offers and what they are called, the notes-dialog copy, the PATCH body
 * (notes present when typed, absent when blank), the history timeline's ordering
 * and action text, the empty/untracked/error states, and the one optimistic cache
 * write the badge and the status filter both read. The React halves
 * (`hooks/useStatusTransition.ts`, the components) only move state and pixels, so
 * every rule that decides what a user sees is asserted in plain node (D10).
 *
 * **The single status source (D51(e)).** The detail page and the browse table both
 * read a row's status from the `GET /api/quests` list through `QUESTS_QUERY_KEY`,
 * never from the bare quest object (which carries no status, D49(a)). The
 * optimistic update therefore rewrites **that** cache entry — the same source the
 * badge reads — so the badge flips without waiting for a refetch.
 */

import type { QueryClient } from '@tanstack/react-query';

import {
  ApiError,
  QUESTS_QUERY_KEY,
  type QuestsListResult,
  type StatusHistoryEntry,
  type StatusValue,
} from './api';
import { serverMessage } from './extract';

/* ------------------------------------------------------------- the actions */

/**
 * The two transition labels, **verbatim** from the lifecycle table
 * (docs/spec-data-model.md L16-17): `reviewed` is set when the user clicks "Mark
 * Reviewed" and `verified` when they click "Mark Verified".
 */
export const MARK_REVIEWED_LABEL = 'Mark Reviewed';
export const MARK_VERIFIED_LABEL = 'Mark Verified';

/** The two statuses a user can transition an entry to. */
export type TransitionTarget = 'reviewed' | 'verified';

/** One transition action. */
export interface StatusTransition {
  status: TransitionTarget;
  label: string;
}

/**
 * Both actions, in lifecycle order — rendered as the detail header's buttons and
 * as the browse table's status menu. The list is complete on purpose: the action
 * for the status the entry already has is *disabled*, not hidden, so the menu
 * still says which status the entry is in.
 */
export const STATUS_TRANSITIONS: readonly StatusTransition[] = [
  { status: 'reviewed', label: MARK_REVIEWED_LABEL },
  { status: 'verified', label: MARK_VERIFIED_LABEL },
];

/** `true` when `target` is the status the entry already has (the disabled action). */
export function isCurrentStatus(current: StatusValue, target: TransitionTarget): boolean {
  return current === target;
}

/** The accessible name of the status menu's trigger button (icon-only in the table). */
export const STATUS_MENU_LABEL = 'Change status';
/** The trigger's native `title`: there is no tooltip primitive (D39, D51(b)). */
export const STATUS_MENU_TOOLTIP = 'Change verification status';

/* ------------------------------------------------------------ the PATCH body */

/**
 * The `PATCH /api/status/:type/:key` body for one transition.
 *
 * **`changed_by` is never sent**: the server attributes the transition to the
 * persisted `settings.user_name` itself (D37, measured in p2-07's real save), so
 * sending it would only add a second, client-side attribution path.
 *
 * **Blank notes are omitted, not sent as `""`**: the notes field is optional
 * (docs/spec-data-model.md L18), and the server's own 400 validation is about the
 * type, so an empty string would be stored as an empty note in `status_history`
 * and render as an empty italic line. Omitted ⇒ the server writes `null`.
 */
export function transitionPatch(
  target: TransitionTarget,
  notes: string,
): { status: TransitionTarget; notes?: string } {
  const trimmed = notes.trim();
  return trimmed === '' ? { status: target } : { status: target, notes: trimmed };
}

/* ------------------------------------------------------------------- copy */

/** The notes textarea's label and hint (notes are optional and land in the history). */
export const NOTES_LABEL = 'Notes (optional)';
export const NOTES_PLACEHOLDER = 'What did you check?';
export const NOTES_HINT = 'Optional — notes are shown in the status history.';

/** The dialog's confirm button, per target; the action label verbatim. */
export function transitionConfirmLabel(target: TransitionTarget): string {
  return target === 'reviewed' ? MARK_REVIEWED_LABEL : MARK_VERIFIED_LABEL;
}

/** The dialog's title: it names the target status. */
export function transitionDialogTitle(target: TransitionTarget): string {
  return transitionConfirmLabel(target);
}

/** The dialog's description: it names the quest and the status it will get. */
export function transitionDialogDescription(questName: string, target: TransitionTarget): string {
  return `Mark ${questName} as ${target}?`;
}

/** The success toast, in the same words the timeline uses (spec L160-180). */
export function transitionSuccessMessage(questName: string, target: TransitionTarget): string {
  return `${questName} marked ${target}`;
}

/* ------------------------------------------------------------------ errors */

/** The generic transition failure line. */
export const TRANSITION_FAILED_MESSAGE = 'Could not update the status.';

/**
 * The D51(f) 404 — the entry has no `entry_status` row.
 *
 * `PATCH` only transitions entries that were imported or saved, so a quest the
 * browse list shows (D49(b) defaults untracked rows to `extracted`) can still 404
 * here. A generic "request failed" would be a dead end, so the message says what to
 * do about it: the transition becomes available the moment the save tracks the
 * entry.
 */
export const UNTRACKED_ENTRY_MESSAGE =
  'This quest is not tracked yet — save or import it first, then mark its status.';

/** The same condition, worded for the history panel. */
export const UNTRACKED_HISTORY_MESSAGE =
  'This quest is not tracked yet. Its history appears once it has been saved or imported.';

/** The history panel's explicit empty state (an imported entry has no history — D37). */
export const EMPTY_HISTORY_MESSAGE = 'No status changes recorded yet.';
export const EMPTY_HISTORY_HINT =
  'Entries imported from SpiralDB have no transition history until their first status change.';

/** `true` for the D51(f) untracked 404 — the only 404 either call can answer with. */
export function isUntrackedError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/**
 * The user-facing message for a failed transition or history read: the actionable
 * untracked line for a 404, and the server's own `{ error }` text (or the fallback)
 * for everything else.
 */
export function transitionErrorMessage(error: unknown): string {
  return isUntrackedError(error)
    ? UNTRACKED_ENTRY_MESSAGE
    : serverMessage(error, TRANSITION_FAILED_MESSAGE);
}

/** The history panel's message for a failed read. */
export function historyErrorMessage(error: unknown): string {
  return isUntrackedError(error)
    ? UNTRACKED_HISTORY_MESSAGE
    : serverMessage(error, 'Could not load the status history.');
}

/* ---------------------------------------------------------------- history */

/**
 * The history **newest first**, for the timeline (spec L173-179 draws the newest
 * entry at the top; the endpoint answers oldest → newest, D37).
 *
 * The order is the array's own (the server's `ORDER BY id`, the only monotonic
 * column — D37 notes `changed_at` can repeat), so the reverse is exactly the
 * server's order and never a re-sort on a nullable timestamp.
 */
export function newestFirst(history: readonly StatusHistoryEntry[]): StatusHistoryEntry[] {
  return [...history].reverse();
}

/**
 * One timeline entry's action text (spec L173-179).
 *
 * A transition reads `marked reviewed` / `marked verified`; the row that first
 * tracked the entry (`old_status: null`) reads just the status word, which is what
 * the spec's own example draws (`DropTable KT-SPH3-C02-003 extracted`).
 */
export function historyActionText(entry: StatusHistoryEntry): string {
  return entry.old_status === null ? entry.new_status : `marked ${entry.new_status}`;
}

/** `true` when one entry has a note worth rendering (a blank note is not one). */
export function hasHistoryNotes(entry: StatusHistoryEntry): boolean {
  return entry.notes !== null && entry.notes.trim() !== '';
}

/** Which of the history panel's five states to render. */
export type HistoryPanelState = 'loading' | 'untracked' | 'error' | 'empty' | 'ready';

/**
 * The history panel's state, from the query's flags — so the ladder
 * (loading → untracked → error → empty → ready) is asserted in plain node rather
 * than re-derived in JSX.
 */
export function historyPanelState(query: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: readonly StatusHistoryEntry[] | undefined;
}): HistoryPanelState {
  if (query.isPending) {
    return 'loading';
  }
  if (query.isError) {
    return isUntrackedError(query.error) ? 'untracked' : 'error';
  }
  return (query.data?.length ?? 0) === 0 ? 'empty' : 'ready';
}

/* -------------------------------------------------- the optimistic update */

/**
 * Rewrites one row's status in the cached `GET /api/quests` payload **and** the
 * payload's own `summary` — the same derivation the server uses (D49(b): the list's
 * summary counts the rows it returned).
 *
 * Keeping the summary in step is what makes the browse page's filter tabs agree
 * with the row they count: flipping a row to `reviewed` without it would leave the
 * Reviewed badge one short and the Extracted badge one over for the moment before
 * the refetch lands.
 *
 * A no-op when the list is not cached (nothing to flip yet); the settle
 * invalidation then paints the truth. Returns `false` in that case so the caller
 * can tell whether it had something to roll back.
 */
export function applyOptimisticQuestStatus(
  client: QueryClient,
  questName: string,
  status: StatusValue,
): boolean {
  const data = client.getQueryData<QuestsListResult>(QUESTS_QUERY_KEY);
  if (data === undefined) {
    return false;
  }
  const quests = data.quests.map((row) =>
    row.quest_name === questName ? { ...row, status } : row,
  );
  client.setQueryData<QuestsListResult>(QUESTS_QUERY_KEY, {
    ...data,
    quests,
    summary: {
      total: quests.length,
      extracted: quests.filter((row) => row.status === 'extracted').length,
      reviewed: quests.filter((row) => row.status === 'reviewed').length,
      verified: quests.filter((row) => row.status === 'verified').length,
    },
  });
  return true;
}
