import { toast } from 'sonner';

import { TOAST_DURATIONS } from './toast';

/**
 * The three toast styles, in one place (task 1.8, decision D39 item 8).
 *
 * Every caller uses these instead of `toast.*` directly so the durations from
 * `docs/spec-ui-design.md` L118-121 cannot drift per screen, and so the error
 * toast keeps its "click to dismiss" close button (sonner's per-toast
 * `closeButton`).
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
