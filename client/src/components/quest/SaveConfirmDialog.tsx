import { saveAllConfirmMessage, CHECKING_EXISTING_MESSAGE } from '../../lib/extract';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import ExistingQuestsNotice from './ExistingQuestsNotice';

/**
 * The Save All confirmation (plan task 2.6, docs/spec-ui-design.md L232; gap A of
 * story p2-07, plan §2.4's last bullet).
 *
 * Save All writes N files and makes N commits, so it asks first — and the
 * sentence it asks with is fixed: `Save {N} quests to SpiralDB? This will create
 * files and auto-commit.` The N is the number of quests about to be saved, and the
 * sentence comes from `lib/extract.ts` so it is unit-tested verbatim.
 *
 * **Gap A**: the same dialog also lists the quests that already exist in SpiralDB
 * ({@link ExistingQuestsNotice}), which is information fetched from `GET
 * /api/quests` while the dialog is open. Until that check has succeeded the Save
 * button stays disabled — with `checking` it is still running, with `checkError`
 * the overwrite risk is unknown and the save is refused (fail-closed). There is
 * therefore no path from this dialog to a `POST /api/quests` that has not shown
 * the existing names first.
 *
 * The decision is the caller's: this component only renders the question and
 * reports the answer (Radix dialog → focus trap, Escape, scroll lock).
 */
export interface SaveConfirmDialogProps {
  open: boolean;
  /** Number of quests the confirmed save would write. */
  count: number;
  /** True while the save is in flight; both buttons are disabled. */
  saving: boolean;
  /** Names of the quests about to be saved that already exist in SpiralDB. */
  existingNames: string[];
  /** True while the overwrite check is in flight. */
  checking: boolean;
  /** The fail-safe message when the overwrite check failed; blocks the confirm. */
  checkError: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export default function SaveConfirmDialog({
  open,
  count,
  saving,
  existingNames,
  checking,
  checkError,
  onOpenChange,
  onConfirm,
}: SaveConfirmDialogProps): JSX.Element {
  const blocked = checking || checkError !== null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save to SpiralDB</DialogTitle>
          <DialogDescription>{saveAllConfirmMessage(count)}</DialogDescription>
        </DialogHeader>

        {checking ? (
          <p role="status" className="text-sm text-zinc-400">
            {CHECKING_EXISTING_MESSAGE}
          </p>
        ) : null}
        {checkError === null ? null : (
          <p role="alert" className="text-sm text-red-400">
            {checkError}
          </p>
        )}
        <ExistingQuestsNotice names={existingNames} />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={saving || blocked}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
