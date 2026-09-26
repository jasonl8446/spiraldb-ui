import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  postSync,
  SYNC_HISTORY_QUERY_KEY,
  SYNC_STATUS_QUERY_KEY,
  type SyncResult,
} from '../lib/api';
import { notifyError, notifySuccess } from '../lib/notify';
import { syncErrorMessage, syncSuccessMessage, SYNC_SUCCESS_ICON_MS } from '../lib/toast';

/**
 * The one sync controller the header button and the Settings page share
 * (task 1.8, decision D39 item 9).
 *
 * `POST /api/sync` is synchronous-blocking (~20 s for a fresh unpack), so:
 *
 * - the caller renders a spinner for the whole mutation (`isPending`);
 * - on success the toast carries the **real returned counts**;
 * - the name lists, the single-value lookups, the sync status/history and the
 *   dashboard are invalidated, so every screen showing synced data refetches;
 * - `justSucceeded` stays true for {@link SYNC_SUCCESS_ICON_MS} so the button can
 *   show a checkmark, then resets — the timer runs from the click handler (never
 *   from an effect), so StrictMode's double-render cannot double-fire a sync.
 */
export interface SyncController {
  /** Starts a sync. Safe to call from a click handler only. */
  sync: () => void;
  /** A sync request is in flight. */
  isPending: boolean;
  /** A sync completed this session recently — show the checkmark. */
  justSucceeded: boolean;
}

export function useSync(): SyncController {
  const client = useQueryClient();
  const [justSucceeded, setJustSucceeded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const mutation = useMutation<SyncResult, Error>({
    mutationFn: postSync,
    onSuccess: async (result) => {
      notifySuccess(syncSuccessMessage(result.synced));
      setJustSucceeded(true);
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => setJustSucceeded(false), SYNC_SUCCESS_ICON_MS);

      // Prefix invalidation: every cached name list and every selected-value
      // lookup is now stale (decision D8: "invalidated after sync").
      await client.invalidateQueries({ queryKey: ['names'] });
      await client.invalidateQueries({ queryKey: ['name-lookup'] });
      await client.invalidateQueries({ queryKey: SYNC_STATUS_QUERY_KEY });
      await client.invalidateQueries({ queryKey: SYNC_HISTORY_QUERY_KEY });
      await client.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error) => {
      notifyError(syncErrorMessage(error));
    },
  });

  const { mutate, isPending } = mutation;
  const sync = useCallback((): void => {
    mutate();
  }, [mutate]);

  return { sync, isPending, justSucceeded };
}
