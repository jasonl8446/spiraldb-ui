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

export function notifyWarning(message: string): void {
  toast.warning(message, { duration: TOAST_WARNING_DURATION_MS });
}
