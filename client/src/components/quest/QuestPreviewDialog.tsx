import type { QuestObject } from '../../lib/api';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog';
import QuestPreview from './QuestPreview';

/**
 * The mobile preview overlay (plan task 2.6, docs/spec-ui-design.md L234).
 *
 * Below `md` the list takes the full width, so tapping a quest opens the preview
 * as a **real modal** — Radix dialog, i.e. focus trap + scroll lock + Escape —
 * rather than as a squeezed side pane. The desktop pane and this overlay render
 * the same prop-driven {@link QuestPreview}; only one of them is mounted at a time
 * (the page decides with `useIsMobile`), so nothing is ever hidden-but-modal.
 */
export interface QuestPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quest: QuestObject;
  /** Display name for the dialog title (already resolved by the caller). */
  name: string;
}

export default function QuestPreviewDialog({
  open,
  onOpenChange,
  quest,
  name,
}: QuestPreviewDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-md flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-zinc-800 p-4 pr-12">
          <DialogTitle className="truncate font-mono text-sm font-semibold">{name}</DialogTitle>
          <DialogDescription className="sr-only">
            Read-only preview of the selected quest.
          </DialogDescription>
        </DialogHeader>
        <QuestPreview quest={quest} className="min-h-0 flex-1" />
      </DialogContent>
    </Dialog>
  );
}
