import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button } from '../ui/button';
import { ApiError, postDraftsRebuild, type DraftRebuildResult } from '../../lib/api';
import { notifyError, notifyInfo, notifySuccessWithAction } from '../../lib/notify';

/** The button's visible label (spec-ui-design "Rebuild Drafts"). */
export const REBUILD_DRAFTS_LABEL = 'Rebuild drafts';

/**
 * `"Drafts rebuilt: 12 new suggestions, 0 removed (6,365 drafts)"` — the inserted count first,
 * then the pending rows the run deleted (PR #14 review 1: a rebuild that drops rows says so).
 */
export function draftsRebuiltMessage(result: DraftRebuildResult): string {
  const drafts = result.drafts.named_missing + result.drafts.named_defined + result.drafts.unnamed;
  const noun = result.inserted === 1 ? 'suggestion' : 'suggestions';
  return `Drafts rebuilt: ${result.inserted.toLocaleString('en-US')} new ${noun}, ${result.removed.toLocaleString('en-US')} removed (${drafts.toLocaleString('en-US')} drafts)`;
}

/** The server's `409` for a rebuild already running; its other `409` refuses an unreadable root. */
const REBUILD_RUNNING = /already running/;

/**
 * **Rebuild drafts** (task 7.6; D143, D144) — a secondary button on the dashboard's progress
 * section title row. `POST /api/drafts/rebuild` is synchronous, so the button shows a spinner and
 * stays disabled until the run answers; success is a toast with the inserted count and a link to
 * `/drafts`, and a `409` (a rebuild already running) is an info toast rather than an error. The
 * other `409` — the root read no quest file while evidence rows are pending (D195) — is an error
 * toast carrying the server's message, which names the directory it could not read.
 */
export default function RebuildDraftsButton(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const rebuild = useMutation<DraftRebuildResult, Error>({
    mutationFn: postDraftsRebuild,
    onSuccess: (result) => {
      // The `/drafts` header mounts this button too (task 7.7): its queue re-reads the new rows.
      void queryClient.invalidateQueries({ queryKey: ['drafts'] });
      notifySuccessWithAction(draftsRebuiltMessage(result), 'Open drafts', () => {
        navigate('/drafts');
      });
    },
    onError: (error) => {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        REBUILD_RUNNING.test(error.message)
      ) {
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
