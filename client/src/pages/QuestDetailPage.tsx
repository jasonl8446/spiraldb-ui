import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Braces, Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import QuestPreview from '../components/quest/QuestPreview';
import { QuestJsonOverlay, QuestJsonPanel } from '../components/quest/QuestJsonPanel';
import StatusBadge from '../components/StatusBadge';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { useIsMobile } from '../hooks/useIsMobile';
import {
  getQuest,
  listQuests,
  questDetailQueryKey,
  QUESTS_QUERY_KEY,
  type QuestObject,
  type StatusValue,
} from '../lib/api';
import { serverMessage } from '../lib/extract';
import {
  BACK_TO_QUESTS_LABEL,
  EDIT_DISABLED_TOOLTIP,
  isNotFoundError,
  JSON_PANEL_LABEL,
  QUEST_LOAD_ERROR,
  QUEST_LOADING,
  QUEST_NOT_FOUND_TITLE,
  questStatus,
} from '../lib/quests';
import { cn } from '../lib/utils';

/**
 * Quest detail — `/quests/:questName`, read-only (plan task 2.7, story p2-08;
 * docs/spec-ui-design.md L274-340).
 *
 * Two reads, on purpose:
 *
 * 1. `GET /api/quests/:name` (D49: the **bare quest object**) feeds
 *    `QuestPreview`, the same fetch-free six-tab renderer the extraction page's
 *    results pane uses — p2-07 built it for exactly this reuse, so this page does
 *    not reimplement a tab.
 * 2. `GET /api/quests` supplies the header's `StatusBadge`.
 *
 * **Where the status comes from, and why.** The detail body carries no status
 * field at all (D49's shape is the quest JSON), so the status has to be read
 * somewhere. This page reuses the browse list's row through the shared
 * `QUESTS_QUERY_KEY` cache rather than adding a second status contract:
 * `GET /api/quests` already resolves `entry_status` and already applies D49's
 * "defaults to `extracted` when the quest has no row" rule, it is invalidated by
 * every save (so the badge cannot go stale behind a save), and it is very often
 * already cached from the browse page the user just came from. A failed or absent
 * list read degrades to `extracted` and never blocks the page — the quest itself is
 * what the user asked for.
 *
 * Loading, error and 404 are three distinct states (`retry: false`, because a
 * missing quest is not a transient failure): a 404 renders {@link QUEST_NOT_FOUND_TITLE}
 * with the server's own `Unknown quest "…"` body, any other failure renders the
 * server's message plus a retry, and neither strands the back link.
 */
export default function QuestDetailPage(): JSX.Element {
  const { questName = '' } = useParams<{ questName: string }>();
  const isMobile = useIsMobile();
  const [jsonOpen, setJsonOpen] = useState(false);

  const quest = useQuery({
    queryKey: questDetailQueryKey(questName),
    queryFn: () => getQuest(questName),
    retry: false,
  });
  const list = useQuery({
    queryKey: QUESTS_QUERY_KEY,
    queryFn: listQuests,
    staleTime: Infinity,
  });

  const status = questStatus(list.data?.quests.find((row) => row.quest_name === questName));

  if (quest.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <BackBar />
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">{QUEST_LOADING}</span>
          <Skeleton className="h-[70vh] w-full" />
        </div>
      </div>
    );
  }

  if (quest.isError) {
    const notFound = isNotFoundError(quest.error);
    return (
      <div className="flex flex-col gap-4">
        <BackBar />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden="true" />
            <h1 className="text-lg font-semibold text-zinc-100">
              {notFound ? QUEST_NOT_FOUND_TITLE : QUEST_LOAD_ERROR}
            </h1>
            <p className="text-sm text-zinc-400">
              {serverMessage(
                quest.error,
                notFound ? `No quest named "${questName}" exists in SpiralDB.` : QUEST_LOAD_ERROR,
              )}
            </p>
            {notFound ? null : (
              <Button
                variant="outline"
                onClick={() => {
                  void quest.refetch();
                }}
              >
                Try again
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <QuestHeader
        quest={quest.data}
        questName={questName}
        status={status}
        jsonOpen={jsonOpen}
        onToggleJson={() => setJsonOpen((open) => !open)}
      />

      <div className="flex min-h-0 gap-4">
        <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
          <QuestPreview quest={quest.data} className="h-[70vh]" />
        </div>
        {/* Exactly one of the two JSON surfaces is mounted (see `QuestJsonPanel`). */}
        {jsonOpen && !isMobile ? <QuestJsonPanel quest={quest.data} /> : null}
      </div>

      {isMobile ? (
        <QuestJsonOverlay open={jsonOpen} onOpenChange={setJsonOpen} quest={quest.data} />
      ) : null}
    </div>
  );
}

/** The detail header's back link — shared by every state, so nothing strands the user. */
function BackBar(): JSX.Element {
  return (
    <div className="flex items-center gap-3 border-b border-zinc-800 pb-3">
      <BackLink />
    </div>
  );
}

function BackLink(): JSX.Element {
  return (
    <Link
      to="/quests"
      className="inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {BACK_TO_QUESTS_LABEL}
    </Link>
  );
}

/** The spec's header bar (L281): back link, mono name, StatusBadge, Edit + `{ }`. */
function QuestHeader({
  quest,
  questName,
  status,
  jsonOpen,
  onToggleJson,
}: {
  quest: QuestObject;
  questName: string;
  status: StatusValue;
  jsonOpen: boolean;
  onToggleJson: () => void;
}): JSX.Element {
  const displayName = typeof quest.m_questName === 'string' ? quest.m_questName : questName;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 pb-3">
      <BackLink />

      <h1
        className="min-w-0 truncate text-xl font-mono font-semibold text-zinc-50"
        title={displayName}
      >
        {displayName}
      </h1>
      <StatusBadge status={status} />

      <div className="ml-auto flex items-center gap-2">
        {/*
          Disabled with `aria-disabled` rather than the `disabled` attribute: the
          "Editing arrives in Phase 3" tooltip is a native `title`, and a truly
          disabled control neither shows it in every browser nor stays focusable to
          announce why it is unavailable. There is no tooltip primitive to use —
          see `EDIT_DISABLED_TOOLTIP`.
        */}
        <Button
          type="button"
          variant="outline"
          aria-disabled="true"
          title={EDIT_DISABLED_TOOLTIP}
          className={cn('aria-disabled:cursor-not-allowed aria-disabled:opacity-50')}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Edit
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={JSON_PANEL_LABEL}
          aria-pressed={jsonOpen}
          title={JSON_PANEL_LABEL}
          onClick={onToggleJson}
        >
          <Braces className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
