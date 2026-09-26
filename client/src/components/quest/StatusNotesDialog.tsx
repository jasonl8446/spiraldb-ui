import { Loader2 } from 'lucide-react';

import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import {
  NOTES_HINT,
  NOTES_LABEL,
  NOTES_PLACEHOLDER,
  transitionConfirmLabel,
  transitionDialogDescription,
  transitionDialogTitle,
  type TransitionTarget,
} from '../../lib/status-transition';

/**
 * The status-transition notes dialog (plan §2.8, story p2-09).
 *
 * One dialog for both surfaces: it only renders the question and reports the
 * answer. The identity gate has already run by the time this opens
 * (`useStatusTransition.request` awaits it first), so this component never has to
 * know about `user_name`, and the `PATCH`, the optimistic badge and the toast stay
 * in the hook.
 *
 * It **names the quest and the target status** — the title is the action label
 * verbatim ("Mark Reviewed") and the description is `Mark {quest} as {status}?` —
 * and the notes field is explicitly optional, with the hint that notes are shown in
 * the history.
 *
 * While the request is in flight both buttons are disabled and the confirm button
 * shows a spinner, so the request cannot be issued twice. On failure the caller
 * keeps this dialog open and passes the error in: the typed notes survive and the
 * retry is one click.
 *
 * Radix dialog semantics (focus trap, Escape, scroll lock) come from the vendored
 * `ui/dialog` primitive; there is no textarea primitive to reuse (D39 ships only
 * what first needed it), so the field carries the input primitive's own classes. A
 * close request while the PATCH is in flight is ignored by the hook, which is why
 * this component passes `onOpenChange` straight through.
 */
export interface StatusNotesDialogProps {
  open: boolean;
  /** The quest the transition applies to. */
  questName: string;
  target: TransitionTarget;
  notes: string;
  /** True while the PATCH is in flight. */
  submitting: boolean;
  /** The last failure, kept on screen until the next confirm. */
  error: string | null;
  onNotesChange: (notes: string) => void;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export default function StatusNotesDialog({
  open,
  questName,
  target,
  notes,
  submitting,
  error,
  onNotesChange,
  onOpenChange,
  onConfirm,
}: StatusNotesDialogProps): JSX.Element {
  const confirmLabel = transitionConfirmLabel(target);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{transitionDialogTitle(target)}</DialogTitle>
          <DialogDescription>{transitionDialogDescription(questName, target)}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="status-notes" className="text-sm font-medium text-zinc-300">
            {NOTES_LABEL}
          </label>
          <textarea
            id="status-notes"
            name="status-notes"
            rows={3}
            value={notes}
            disabled={submitting}
            placeholder={NOTES_PLACEHOLDER}
            onChange={(event) => onNotesChange(event.target.value)}
            className="flex w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-50 shadow-sm transition-colors placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <p className="text-xs text-zinc-500">{NOTES_HINT}</p>
        </div>

        {error === null ? null : (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {submitting ? 'Saving…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
