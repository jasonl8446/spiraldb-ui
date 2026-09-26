/**
 * User identity — the pure half of the one-time `user_name` gate (task 1.7,
 * docs/spec-data-model.md L225-232).
 *
 * The React plumbing lives in `hooks/useUserNameGate.tsx`; every *decision* it
 * makes is computed here, so the gate's behaviour is testable in plain node with
 * no jsdom and no React (decision D10: the test stack is Vitest + Supertest, and
 * `@playwright/test` does not exist until p1-13).
 */

/** Longest accepted name. The dialog validates the same value it displays. */
export const USER_NAME_MAX_LENGTH = 64;

/** Trimmed, non-blank, at most `USER_NAME_MAX_LENGTH` characters. */
export type UserNameValidation = { ok: true; name: string } | { ok: false; error: string };

/**
 * Validates one entered value and yields the name to persist.
 *
 * The trimmed value is what gets stored and used as `changed_by`, so a name of
 * `"  jason  "` is recorded as `jason` and the gate can never resolve with the
 * surrounding whitespace that made it look blank.
 */
export function validateUserName(raw: string): UserNameValidation {
  const name = raw.trim();
  if (name.length === 0) {
    return { ok: false, error: 'Enter your name to continue.' };
  }
  if (name.length > USER_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `Name must be ${USER_NAME_MAX_LENGTH} characters or fewer.`,
    };
  }
  return { ok: true, name };
}

/**
 * What the gate decided to do.
 *
 * - `resolved`  a usable name is in hand — the caller continues straight away.
 *                `prompted` records whether it came from this dialog or was
 *                already in `settings.user_name`.
 * - `prompt`    the name is missing, so the dialog must open.
 * - `invalid`   the user submitted something unusable; show the error, no request.
 * - `cancelled` the user dismissed the dialog; the caller aborts the action.
 */
export type UserNameAction =
  | { kind: 'resolved'; name: string; prompted: boolean }
  | { kind: 'prompt' }
  | { kind: 'invalid'; error: string }
  | { kind: 'cancelled' };

/**
 * The gate's state machine, as one pure function.
 *
 * `currentName` is `settings.user_name` as the app knows it. `entered` is:
 *
 * - omitted / `undefined` — the dialog has not been answered yet. A blank
 *   `currentName` therefore means "prompt"; a non-blank one short-circuits and
 *   the dialog is never opened.
 * - `null` — the dialog was dismissed → `cancelled`.
 * - a string — the value the user submitted → validated into `resolved`/`invalid`.
 */
export function resolveUserNameAction(
  currentName: string | null | undefined,
  entered?: string | null,
): UserNameAction {
  // Short-circuit first: once a name exists the gate never prompts again, no
  // matter what the dialog was doing.
  const current = validateUserName(currentName ?? '');
  if (current.ok) {
    return { kind: 'resolved', name: current.name, prompted: false };
  }

  if (entered === undefined) {
    return { kind: 'prompt' };
  }
  if (entered === null) {
    return { kind: 'cancelled' };
  }

  const enteredName = validateUserName(entered);
  if (!enteredName.ok) {
    return { kind: 'invalid', error: enteredName.error };
  }
  return { kind: 'resolved', name: enteredName.name, prompted: true };
}

/**
 * Rejection raised when the gate is dismissed, so a caller can abort its pending
 * action (the button click) without applying it — and tell a real cancel apart
 * from a network failure.
 */
export class UserNameCancelledError extends Error {
  constructor() {
    super('The name prompt was cancelled');
    this.name = 'UserNameCancelledError';
  }
}
