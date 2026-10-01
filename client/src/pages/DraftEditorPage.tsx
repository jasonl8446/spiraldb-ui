import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';

import { buildQuestScaffold } from '@shared/quest/scaffold';

import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import {
  ApiError,
  getQuestSkeleton,
  getSuggestions,
  suggestionsQueryKey,
  type QuestObject,
} from '../lib/api';
import { serverMessage } from '../lib/extract';
import { unnamedDraftKey } from '../lib/suggestions';
import { LoadedQuest } from './QuestDetailPage';

/**
 * A draft with no file, in the quest editor (task 7.7 / story p7-08; spec-ui-design §12; D165).
 *
 * - `/drafts/quest/:questName` — a named catalog quest whose file is missing. The editor opens on
 *   the server's unwritten D118 skeleton (`GET /api/quests/:name/scaffold`, the exact document the
 *   scaffold would write, direct-link title included), so the first Save's diff is the skeleton plus
 *   what was accepted. A quest that already has a file redirects to its own editor.
 * - `/drafts/id/:questId` — an unnamed-tier id (D137). Its skeleton has no name and no link, so it is
 *   built here from the shared builder with the id as a placeholder `m_questName`; the first Save
 *   asks for the real name and the scaffold route writes it.
 *
 * Nothing is written by opening either route: the document lives in memory until Save.
 */
export default function DraftEditorPage(): JSX.Element {
  const { questName, questId } = useParams<{ questName?: string; questId?: string }>();
  return questName !== undefined ? (
    <MissingQuestDraft questName={questName} />
  ) : (
    <UnnamedDraft questId={questId ?? ''} />
  );
}

function MissingQuestDraft({ questName }: { questName: string }): JSX.Element {
  const skeleton = useQuery({
    queryKey: ['quest-skeleton', questName],
    queryFn: () => getQuestSkeleton(questName),
    retry: false,
  });
  if (skeleton.isPending) {
    return <Loading />;
  }
  if (skeleton.isError) {
    if (skeleton.error instanceof ApiError && skeleton.error.status === 409) {
      return <Navigate to={`/quests/${encodeURIComponent(questName)}`} replace />;
    }
    return <Failure message={serverMessage(skeleton.error, 'Could not open this draft.')} />;
  }
  return (
    <LoadedQuest
      quest={skeleton.data.quest}
      questName={questName}
      status="extracted"
      row={undefined}
      draft={{ kind: 'missing', questName }}
    />
  );
}

function UnnamedDraft({ questId }: { questId: string }): JSX.Element {
  const catalogId = /^\d+$/.test(questId) ? Number(questId) : Number.NaN;
  const known = useQuery({
    queryKey: suggestionsQueryKey({ catalogId }),
    queryFn: () => getSuggestions({ catalogId }),
    retry: false,
    enabled: Number.isSafeInteger(catalogId),
  });
  // Built once per id: the editor's document identity must not change under it between renders.
  const skeleton = useMemo<QuestObject>(
    () =>
      buildQuestScaffold({
        name: unnamedDraftKey(catalogId),
        link: { kind: 'none' },
      }) as QuestObject,
    [catalogId],
  );
  if (!Number.isSafeInteger(catalogId)) {
    return <Failure message={`"${questId}" is not a quest id.`} />;
  }
  if (known.isPending) {
    return <Loading />;
  }
  if (known.isError) {
    return <Failure message={serverMessage(known.error, 'Could not open this draft.')} />;
  }
  return (
    <LoadedQuest
      quest={skeleton}
      questName={unnamedDraftKey(catalogId)}
      status="extracted"
      row={undefined}
      draft={{ kind: 'unnamed', catalogId, title: null }}
    />
  );
}

function BackToDrafts(): JSX.Element {
  return (
    <Link
      to="/drafts"
      className="inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to Drafts
    </Link>
  );
}

function Loading(): JSX.Element {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <BackToDrafts />
      <span className="sr-only">Loading draft…</span>
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-[70vh] w-full" />
    </div>
  );
}

function Failure({ message }: { message: string }): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <BackToDrafts />
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-zinc-100">Draft not found</h2>
          <p className="text-sm text-zinc-400">{message}</p>
        </CardContent>
      </Card>
    </div>
  );
}
