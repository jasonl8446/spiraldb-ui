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
  UNSAVED_CHANGES_MESSAGE,
  UNSAVED_CHANGES_TITLE,
  UNSAVED_LEAVE_LABEL,
  UNSAVED_STAY_LABEL,
} from '../../lib/quest-edit';

/**
 * The unsaved-changes confirmation (plan task 3.10: "navigation/close with unsaved changes →
 * confirm dialog").
 *
 * It renders the question and reports the answer; the interception, the pending destination and
 * the navigation itself are `useUnsavedChangesGuard`'s. The safe action is the default-looking
 * one and comes first (`Stay`), the destructive one is red (`Discard changes`) — the guard must
 * never lose work to a stray Enter.
 *
 * Radix dialog semantics (focus trap, Escape, scroll lock) come from the vendored `ui/dialog`
 * primitive; Escape and an overlay click route through `onOpenChange(false)`, which the hook
 * treats as "stay".
 */
export interface UnsavedChangesDialogProps {
  open: boolean;
  /** `false` for Escape, the close button and an overlay click — all of them mean "stay". */
  onOpenChange: (open: boolean) => void;
  /** Leave the page, discarding the edits. */
  onDiscard: () => void;
}

export default function UnsavedChangesDialog({
  open,
  onOpenChange,
  onDiscard,
}: UnsavedChangesDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-zinc-50">{UNSAVED_CHANGES_TITLE}</DialogTitle>
          <DialogDescription className="text-zinc-400">{UNSAVED_CHANGES_MESSAGE}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {UNSAVED_STAY_LABEL}
          </Button>
          <Button type="button" variant="destructive" onClick={onDiscard}>
            {UNSAVED_LEAVE_LABEL}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
