import { useMutation } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button } from '../ui/button';
import { ApiError, postDraftsRebuild, type DraftRebuildResult } from '../../lib/api';
import { notifyError, notifyInfo, notifySuccessWithAction } from '../../lib/notify';

/** The button's visible label (spec-ui-design "Rebuild Drafts"). */
export const REBUILD_DRAFTS_LABEL = 'Rebuild drafts';

/** `"Drafts rebuilt: 12 new suggestions (6,365 drafts)"` — the inserted count first. */
export function draftsRebuiltMessage(result: DraftRebuildResult): string {
  const drafts = result.drafts.named_missing + result.drafts.named_defined + result.drafts.unnamed;
  const noun = result.inserted === 1 ? 'suggestion' : 'suggestions';
  return `Drafts rebuilt: ${result.inserted.toLocaleString('en-US')} new ${noun} (${drafts.toLocaleString('en-US')} drafts)`;
}

/**
 * **Rebuild drafts** (task 7.6; D143, D144) — a secondary button on the dashboard's progress
 * section title row. `POST /api/drafts/rebuild` is synchronous, so the button shows a spinner and
 * stays disabled until the run answers; success is a toast with the inserted count and a link to
 * `/drafts`, and a `409` (a rebuild already running) is an info toast rather than an error.
 */
export default function RebuildDraftsButton(): JSX.Element {
  const navigate = useNavigate();
  const rebuild = useMutation<DraftRebuildResult, Error>({
    mutationFn: postDraftsRebuild,
    onSuccess: (result) => {
      notifySuccessWithAction(draftsRebuiltMessage(result), 'Open drafts', () => {
        navigate('/drafts');
      });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        notifyInfo('A draft rebuild is already running.');
        return;
      }
      notifyError(`Could not rebuild drafts: ${error.message}`);
    },
  });

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => rebuild.mutate()}
      disabled={rebuild.isPending}
      aria-busy={rebuild.isPending}
    >
      {rebuild.isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      )}
      {REBUILD_DRAFTS_LABEL}
    </Button>
  );
}
