import { toast } from 'sonner';

import { TOAST_DURATIONS, TOAST_WARNING_DURATION_MS } from './toast';

/**
 * The toast styles, in one place (task 1.8, decision D39 item 8; story p2-07).
 *
 * Every caller uses these instead of `toast.*` directly so the durations from
 * `docs/spec-ui-design.md` L118-121 cannot drift per screen, and so the error
 * toast keeps its "click to dismiss" close button (sonner's per-toast
 * `closeButton`).
 *
 * `notifyWarning` is p2-07's addition: the save pipeline's D48(d)
 * duplicate-metadata report is neither a success nor a failure, and the amber
 * accent for it already exists in `TOAST_ACCENT_CLASSES`.
 *
 * These wrap a browser library, so they are covered by the raw browser evidence
 * rather than by node unit tests; the numbers they use are asserted from
 * `lib/toast.ts`.
 */
export function notifySuccess(message: string): void {
  toast.success(message, { duration: TOAST_DURATIONS.success });
}

export function notifyInfo(message: string): void {
  toast.info(message, { duration: TOAST_DURATIONS.info });
}

export function notifyError(message: string): void {
  toast.error(message, {
    duration: TOAST_DURATIONS.error,
    closeButton: true,
  });
}

/** The retry action's label (spec L533: "retry option in toast"). */
export const RETRY_ACTION_LABEL = 'Retry';

/**
 * The error toast **with a retry action** (spec-ui-design L533: "API error: Toast notification +
 * retry option in toast"; story p5-04).
 *
 * Same toast path and same 10 s error duration as {@link notifyError} — this is that function
 * plus sonner's `action`, not a second notification system. `onRetry` must re-run **the request
 * that failed**: `hooks/useApiErrorToast.ts` passes the failed query's own `refetch`, so the
 * retry repeats that query's key and function rather than replaying a captured response or
 * re-issuing a stale body.
 */
export function notifyErrorWithRetry(message: string, onRetry: () => void): void {
  toast.error(message, {
    duration: TOAST_DURATIONS.error,
    closeButton: true,
    action: { label: RETRY_ACTION_LABEL, onClick: onRetry },
  });
}

export function notifyWarning(message: string): void {
  toast.warning(message, { duration: TOAST_WARNING_DURATION_MS });
}

/**
 * A success toast carrying one navigation action — the Rebuild drafts toast's link to `/drafts`
 * (task 7.6, spec-ui-design "Rebuild Drafts"). Same duration as {@link notifySuccess}.
 */
export function notifySuccessWithAction(message: string, label: string, onClick: () => void): void {
  toast.success(message, { duration: TOAST_DURATIONS.success, action: { label, onClick } });
}
