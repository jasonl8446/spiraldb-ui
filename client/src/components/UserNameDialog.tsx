import { useEffect, useRef, useState, type FormEvent } from 'react';

import { USER_NAME_MAX_LENGTH, validateUserName } from '../lib/user-name';

/**
 * The one-time name dialog (task 1.7, docs/spec-data-model.md L225-232).
 *
 * Presentational on purpose: it owns the input value and its own validation
 * error, and hands a validated trimmed name to `onSubmit`. The PUT, the gate
 * promise and request errors stay in `hooks/useUserNameGate.tsx`, so this file
 * has no data layer to mock and the shell can restyle it freely.
 *
 * Plain Tailwind against the spec-ui-design dark tokens (L24-30). It stays
 * hand-rolled after task 1.8 on purpose: its behaviour — focus into the input,
 * Escape cancels, Enter submits, an inline error instead of a request — is already
 * verified and evidence-backed by decision D38, while the shell's vendored Radix
 * dialog drives the mobile navigation overlay.
 */
export interface UserNameDialogProps {
  /** Rendered only while true. */
  open: boolean;
  /** Error from the last failed save (the provider owns it). */
  error: string | null;
  /** True while the PUT is in flight; the whole form is disabled. */
  submitting: boolean;
  /** Called with a validated, trimmed name. */
  onSubmit: (name: string) => void;
  /** Escape or Cancel — aborts the pending action. */
  onCancel: () => void;
}

const TITLE_ID = 'user-name-dialog-title';
const HELPER_ID = 'user-name-dialog-helper';

const BUTTON_FOCUS =
  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-950';

export default function UserNameDialog({
  open,
  error,
  submitting,
  onSubmit,
  onCancel,
}: UserNameDialogProps): JSX.Element | null {
  const [value, setValue] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Every open starts from a clean slate with the caret already in the field.
  useEffect(() => {
    if (!open) {
      return;
    }
    setValue('');
    setLocalError(null);
    inputRef.current?.focus();
  }, [open]);

  if (!open) {
    return null;
  }

  const trimmedBlank = value.trim() === '';
  const shownError = localError ?? error;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    // Authoritative check: an unusable value shows an inline error and never
    // reaches the network. Blank is normally unreachable (the button is
    // disabled) but the guard is what makes "no request when blank" true.
    const validation = validateUserName(value);
    if (!validation.ok) {
      setLocalError(validation.error);
      return;
    }
    setLocalError(null);
    onSubmit(validation.name);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/80 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        aria-describedby={HELPER_ID}
        className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl"
      >
        <h2 id={TITLE_ID} className="text-lg font-semibold text-zinc-50">
          What should we call you?
        </h2>
        <p id={HELPER_ID} className="mt-2 text-sm text-zinc-400">
          Stored locally in this app&apos;s settings and used to attribute status changes, metadata
          and commits. We only ask once.
        </p>

        <form className="mt-5" onSubmit={handleSubmit} noValidate>
          <label htmlFor="user-name" className="block text-sm font-medium text-zinc-300">
            Your name
          </label>
          <input
            id="user-name"
            ref={inputRef}
            type="text"
            value={value}
            disabled={submitting}
            autoComplete="off"
            spellCheck={false}
            placeholder="jason"
            aria-invalid={shownError !== null}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-50 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-950"
            onChange={(event) => setValue(event.target.value)}
          />

          {shownError !== null ? (
            <p role="alert" className="mt-2 text-sm text-red-400">
              {shownError}
            </p>
          ) : (
            <p className="mt-2 text-xs text-zinc-400">Up to {USER_NAME_MAX_LENGTH} characters.</p>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className={`rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 ${BUTTON_FOCUS}`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={trimmedBlank || submitting}
              className={`rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-zinc-50 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_FOCUS}`}
            >
              {submitting ? 'Saving…' : 'Save name'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
