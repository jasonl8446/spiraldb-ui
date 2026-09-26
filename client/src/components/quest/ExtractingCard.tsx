import { FileJson, Loader2 } from 'lucide-react';

import { CANCEL_LABEL, EXTRACTING_MESSAGE, formatFileSize } from '../../lib/extract';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';

/**
 * The selected-file state (plan task 2.6, docs/spec-ui-design.md L206-216).
 *
 * File card (name + human-readable size) + **indeterminate** spinner + a
 * destructive Cancel.
 *
 * Indeterminate on purpose, and that is a contract, not a style choice: the
 * extraction is one blocking CLI subprocess with no progress channel (D47), so a
 * progress bar or a live count would be a fabricated number. `role="status"`
 * announces the text for assistive tech; there is deliberately no
 * `role="progressbar"` and no `aria-valuenow` anywhere in this card.
 */
export interface ExtractingCardProps {
  file: File;
  onCancel: () => void;
}

export default function ExtractingCard({ file, onCancel }: ExtractingCardProps): JSX.Element {
  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <FileJson className="h-8 w-8 shrink-0 text-zinc-500" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-50" title={file.name}>
                {file.name}
              </p>
              <p className="text-xs text-zinc-400">{formatFileSize(file.size)}</p>
            </div>
          </div>
          <Button variant="destructive" onClick={onCancel}>
            {CANCEL_LABEL}
          </Button>
        </div>

        <div role="status" className="flex items-center gap-2 text-sm text-zinc-300">
          <Loader2 className="h-4 w-4 animate-spin text-blue-400" aria-hidden="true" />
          <span>{EXTRACTING_MESSAGE}</span>
        </div>
      </CardContent>
    </Card>
  );
}
