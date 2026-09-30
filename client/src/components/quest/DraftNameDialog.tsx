import { useEffect, useRef, useState, type FormEvent } from 'react';

import { NAME_DIALOG_TITLE } from '../../lib/suggestions';

/**
 * The D137 name dialog: an unnamed-tier draft's first Save asks for its quest name
 * (docs/spec-ui-design.md §12; task 7.7).
 *
 * The field is **pre-filled** from the draft's evidence (its title key where one exists) and never
 * submitted on the user's behalf. Only a blank name is refused here; uniqueness and path safety are
 * the server's (the scaffold's own guard, D142), and its refusal is shown inline via `error` with
 * nothing written. Built like `UserNameDialog` (D38's verified behaviour: focus into the input,
 * Escape cancels, Enter submits, `role="dialog"` + `aria-modal`).
 */
export interface DraftNameDialogProps {
  open: boolean;
  prefill: string;
  catalogId: number;
  /** The server's refusal of the last attempt (a duplicate or unsafe name), shown inline. */
  error: string | null;
  submitting: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

const TITLE_ID = 'draft-name-dialog-title';
const HELPER_ID = 'draft-name-dialog-helper';

const BUTTON_FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950';

export default function DraftNameDialog({
  open,
  prefill,
  catalogId,
  error,
  submitting,
  onSubmit,
  onCancel,
}: DraftNameDialogProps): JSX.Element | null {
  const [value, setValue] = useState(prefill);
  const inputRef = useRef<HTMLInputElement>(null);

  // Every open starts from the evidence's pre-fill with the caret in the field.
  useEffect(() => {
    if (!open) {
      return;
    }
    setValue(prefill);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open, prefill]);

  if (!open) {
    return null;
  }

  const trimmed = value.trim();

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (trimmed !== '') {
      onSubmit(trimmed);
    }
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
          {NAME_DIALOG_TITLE}
        </h2>
        <p id={HELPER_ID} className="mt-2 text-sm text-zinc-400">
          Quest id #{catalogId} has no quest name yet. Its file, its catalog row and its commit are
          created under the name you choose; it must be new and must not contain a path separator.
        </p>

        <form className="mt-5" onSubmit={handleSubmit} noValidate>
          <label htmlFor="draft-quest-name" className="block text-sm font-medium text-zinc-300">
            Quest name
          </label>
          <input
            id="draft-quest-name"
            ref={inputRef}
            type="text"
            value={value}
            disabled={submitting}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error !== null}
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-50 placeholder:text-zinc-400 focus-visible:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            onChange={(event) => setValue(event.target.value)}
          />
          {error !== null ? (
            <p role="alert" className="mt-2 text-sm text-red-400">
              {error}
            </p>
          ) : (
            <p className="mt-2 text-xs text-zinc-400">
              Pre-filled from the draft&apos;s evidence; nothing is named until you save.
            </p>
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
              disabled={trimmed === '' || submitting}
              className={`rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-zinc-50 hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON_FOCUS}`}
            >
              {submitting ? 'Saving…' : 'Name and save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
