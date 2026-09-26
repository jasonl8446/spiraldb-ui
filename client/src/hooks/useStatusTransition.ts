/**
 * `useStatusTransition` — one transition flow, shared by both surfaces (plan task
 * 2.8, story p2-09; decisions D38/D43, D51(e), D51(f)).
 *
 * The flow, in order, is the acceptance criterion's own:
 *
 * 1. **The identity gate fires first.** `request()` awaits the existing
 *    `requireUserName()` (never a re-implementation — the extraction page is the
 *    reference caller) *before* it opens the notes dialog, so with an empty
 *    `settings.user_name` the identity modal is the first thing the user sees and
 *    the transition resumes once a name is persisted (D38: the pending action
 *    continues by itself). A dismissed dialog rejects with
 *    `UserNameCancelledError` and nothing at all is attempted.
 * 2. **The notes dialog** collects the optional notes and confirms.
 * 3. **The PATCH** optimistically rewrites the row in the cached
 *    `GET /api/quests` payload — the one status source both the `StatusBadge` and
 *    the browse table read (D51(e)) — toasts on success, and on failure rolls the
 *    cache back and surfaces the error **in the still-open dialog**, so the typed
 *    notes survive and the user can retry.
 *
 * `changed_by` is never sent (the server attributes from the persisted name), and
 * blank notes are omitted rather than sent as `""` — both decided in
 * `lib/status-transition.ts` and asserted there.
 *
 * One hook instance per page: the browse page opens one dialog for whichever row's
 * menu was used, instead of one mutation per row.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import {
  patchStatus,
  QUESTS_QUERY_KEY,
  STATUS_HISTORY_QUERY_KEY,
  type QuestsListResult,
  type StatusEntry,
  type StatusRouteType,
} from '../lib/api';
import { serverMessage } from '../lib/extract';
import { notifyError, notifySuccess } from '../lib/notify';
import {
  applyOptimisticQuestStatus,
  transitionErrorMessage,
  transitionPatch,
  transitionSuccessMessage,
  type TransitionTarget,
} from '../lib/status-transition';
import { UserNameCancelledError } from '../lib/user-name';
import { useUserNameGate } from './useUserNameGate';

/** The entry a confirmed dialog will transition. */
export interface PendingTransition {
  /** The object key — the quest name; the dialog names it. */
  key: string;
  target: TransitionTarget;
}

/** Everything `<StatusNotesDialog>` needs, so a page spreads it in one line. */
export interface StatusTransitionDialogProps {
  open: boolean;
  questName: string;
  target: TransitionTarget;
  notes: string;
  submitting: boolean;
  error: string | null;
  onNotesChange: (notes: string) => void;
  /** Opening/closing; a close while the PATCH is in flight is ignored. */
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export interface StatusTransitionController {
  /**
   * Step 1 + 2: gate first, then open the notes dialog for `target`.
   *
   * Fire-and-forget (the gate is asynchronous); callers do not await it.
   */
  request: (key: string, target: TransitionTarget) => void;
  /** The notes dialog's props. */
  dialog: StatusTransitionDialogProps;
  /** True while the PATCH is in flight — the actions disable themselves. */
  isPending: boolean;
}

export function useStatusTransition(type: StatusRouteType = 'quests'): StatusTransitionController {
  const client = useQueryClient();
  const { requireUserName } = useUserNameGate();
  const [pending, setPending] = useState<PendingTransition | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const transition = useMutation<
    StatusEntry,
    Error,
    PendingTransition & { notes: string },
    { previous: QuestsListResult | undefined }
  >({
    mutationFn: ({ key, target, notes: entered }) =>
      patchStatus(type, key, transitionPatch(target, entered)),
    onMutate: ({ key, target }) => {
      // The pre-mutation cache, for the rollback. Captured before the write.
      const previous = client.getQueryData<QuestsListResult>(QUESTS_QUERY_KEY);
      applyOptimisticQuestStatus(client, key, target);
      return { previous };
    },
    onError: (caught, _variables, context) => {
      // Roll back to exactly what the badge showed before the optimistic write,
      // then keep the dialog open with the actionable message (D51(f): a never
      // tracked entry 404s and must say so instead of looking like a generic
      // failure).
      if (context?.previous !== undefined) {
        client.setQueryData(QUESTS_QUERY_KEY, context.previous);
      }
      setError(transitionErrorMessage(caught));
    },
    onSuccess: (_updated, { key, target }) => {
      setPending(null);
      setNotes('');
      setError(null);
      notifySuccess(transitionSuccessMessage(key, target));
    },
    onSettled: async () => {
      // The transition moved three things: the list rows, the status table and the
      // entry's history. Only the list was written optimistically; the other two
      // are re-read on settle.
      await client.invalidateQueries({ queryKey: QUESTS_QUERY_KEY });
      await client.invalidateQueries({ queryKey: ['status'] });
      await client.invalidateQueries({ queryKey: STATUS_HISTORY_QUERY_KEY });
    },
  });

  const request = useCallback(
    (key: string, target: TransitionTarget): void => {
      void requireUserName()
        .then(() => {
          setNotes('');
          setError(null);
          setPending({ key, target });
        })
        .catch((caught: unknown) => {
          // Dismissing the identity dialog is not a failure: nothing was attempted
          // and nothing may claim otherwise (D38).
          if (caught instanceof UserNameCancelledError) {
            return;
          }
          notifyError(serverMessage(caught, 'Could not read your user name.'));
        });
    },
    [requireUserName],
  );

  const confirm = useCallback((): void => {
    if (pending === null) {
      return;
    }
    transition.mutate({ ...pending, notes });
  }, [pending, notes, transition]);

  const onOpenChange = useCallback(
    (open: boolean): void => {
      // Radix reports Escape/overlay/close-button as `false`; while the PATCH is in
      // flight the dialog stays up so its error and the typed notes are not lost.
      if (!open && !transition.isPending) {
        setPending(null);
        setError(null);
      }
    },
    [transition.isPending],
  );

  return {
    request,
    isPending: transition.isPending,
    dialog: {
      open: pending !== null,
      questName: pending?.key ?? '',
      target: pending?.target ?? 'reviewed',
      notes,
      submitting: transition.isPending,
      error,
      onNotesChange: setNotes,
      onOpenChange,
      onConfirm: confirm,
    },
  };
}
