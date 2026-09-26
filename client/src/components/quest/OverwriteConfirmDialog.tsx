import { OVERWRITE_TITLE, overwriteConfirmMessage } from '../../lib/extract';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

/**
 * The Save Selected overwrite confirmation (plan §2.4's last bullet: "Existing
 * file with same key → action `update` (overwrite) … UI confirms before
 * overwriting an existing quest (small confirm dialog listing the name)").
 *
 * Save Selected asks **only** when the selected quest's name is already in
 * SpiralDB — the page decides that from `GET /api/quests` — so saving a freshly
 * extracted quest keeps its one-click behaviour. The dialog names the quest in its
 * description and its action button says what it does ("Overwrite"), which is the
 * point: the user confirms *this* quest's file being replaced before the POST.
 *
 * As with the Save All confirm, the decision belongs to the caller: this component
 * renders the question and reports the answer.
 */
export interface OverwriteConfirmDialogProps {
  open: boolean;
  /** The existing quest's name, listed in the sentence. */
  name: string;
  /** True while the save is in flight; both buttons are disabled. */
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export default function OverwriteConfirmDialog({
  open,
  name,
  saving,
  onOpenChange,
  onConfirm,
}: OverwriteConfirmDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{OVERWRITE_TITLE}</DialogTitle>
          <DialogDescription>{overwriteConfirmMessage(name)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={saving}>
            {saving ? 'Saving…' : 'Overwrite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
