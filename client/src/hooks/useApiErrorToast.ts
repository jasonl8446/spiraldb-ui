import { isRetryableApiError } from '../lib/api';
import { serverMessage } from '../lib/extract';
import { notifyErrorWithRetry } from '../lib/notify';
import { useEffect, useRef } from 'react';

/**
 * The API-error toast with a retry action (story p5-04, AC3; spec-ui-design L533).
 *
 * > API error: Toast notification + retry option in toast
 *
 * Wired into the read surfaces that already render an inline failure state, so a failed read
 * both explains itself in place **and** offers the one action that can fix it. The toast is the
 * shared one (`lib/notify.ts`'s `notifyErrorWithRetry`), its message is the existing
 * `serverMessage` helper's (the server's own sentence when there is one), and the retry action
 * calls **this query's** `refetch` — the same key and the same query function that just failed,
 * never a replayed response or a stale request body.
 *
 * ## Two deliberate limits
 *
 * - **Only genuinely retryable failures toast.** A 4xx is the request working correctly — a
 *   validation error, or the 404 the detail pages render as their "not found" state — and
 *   retrying it would repeat the same answer, so `isRetryableApiError` (in `lib/api.ts`, where it
 *   is unit-tested without React) declines a 4xx and leaves the page's own inline state as the
 *   whole story. Transport failures (no status) and 5xx do toast.
 * - **Once per failure, not once per render.** TanStack re-renders an errored query many times
 *   (and `retry: 1` in `App.tsx` means one error object can be observed repeatedly); the
 *   `lastError` ref keys on the error's identity so one failure produces exactly one toast, and
 *   a later failure of the same query produces a new one.
 */

/** The part of a TanStack query result this hook needs — structural, so tests can fake it. */
export interface RetryableQueryLike {
  isError: boolean;
  error: unknown;
  /** Re-runs the query that failed. */
  refetch: () => unknown;
}

export function useApiErrorToast(query: RetryableQueryLike, fallback: string): void {
  const lastError = useRef<unknown>(null);
  const refetch = useRef(query.refetch);

  useEffect(() => {
    refetch.current = query.refetch;
  }, [query.refetch]);

  useEffect(() => {
    if (!query.isError) {
      lastError.current = null;
      return;
    }
    if (query.error === lastError.current || !isRetryableApiError(query.error)) {
      return;
    }
    lastError.current = query.error;
    notifyErrorWithRetry(serverMessage(query.error, fallback), () => {
      void refetch.current();
    });
  }, [query.isError, query.error, fallback]);
}
