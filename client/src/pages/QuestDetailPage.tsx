import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Braces, Pencil } from 'lucide-react';
import { useState, lazy, Suspense, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';

import QuestDialogEditor from '../components/quest/QuestDialogEditor';
import QuestGoalsEditor from '../components/quest/QuestGoalsEditor';
import QuestInfoEditor from '../components/quest/QuestInfoEditor';
import QuestPreview from '../components/quest/QuestPreview';
import QuestRequirementsEditor from '../components/quest/QuestRequirementsEditor';
import QuestResultsEditor from '../components/quest/QuestResultsEditor';
import QuestSaveButton from '../components/quest/QuestSaveButton';
import ValidationSummary from '../components/shared/ValidationSummary';
import QuestValidationBanner, {
  VALIDATION_BANNER_ID,
} from '../components/quest/QuestValidationBanner';
import { FieldValidationProvider } from '../components/shared/FieldValidation';
import { QuestJsonOverlay, QuestJsonPanel } from '../components/quest/QuestJsonPanel';
import StatusHistoryPanel from '../components/quest/StatusHistoryPanel';
import StatusNotesDialog from '../components/quest/StatusNotesDialog';
import StatusBadge from '../components/StatusBadge';
import { namePairDistinct } from '../lib/display';
import UnsavedChangesDialog from '../components/quest/UnsavedChangesDialog';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import { useIsMobile } from '../hooks/useIsMobile';
import { useApiErrorToast } from '../hooks/useApiErrorToast';
import { useServerValidation } from '../hooks/useServerValidation';
import { useQuestDocument } from '../hooks/useQuestDocument';
import { useQuestValidation } from '../hooks/useQuestValidation';
import { useStatusTransition } from '../hooks/useStatusTransition';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { useUserNameGate } from '../hooks/useUserNameGate';

/**
 * The flowchart is loaded on demand, so the React Flow + dagre bundle (+95 kB gzip, measured)
 * stays out of the entry chunk every other page shares. Story p3-05's own cost, contained by
 * the story rather than deferred: the Goal Logic tab is one of six, and the canvas is only
 * reachable by opening it.
 */
const QuestGoalLogicEditor = lazy(() => import('../components/quest/QuestGoalLogicEditor'));
import {
  getQuest,
  listQuests,
  questDetailQueryKey,
  QUESTS_QUERY_KEY,
  saveQuest,
  type QuestListRow,
  type QuestObject,
  type SaveQuestResult,
  type StatusValue,
} from '../lib/api';
import { savedMessage, serverMessage } from '../lib/extract';
import { notifyError, notifySuccess, notifyWarning } from '../lib/notify';
import { UserNameCancelledError } from '../lib/user-name';
import {
  BACK_TO_QUESTS_LABEL,
  isNotFoundError,
  JSON_PANEL_LABEL,
  QUEST_LOAD_ERROR,
  QUEST_LOADING,
  QUEST_NOT_FOUND_TITLE,
  questFriendlyTitle,
  questStatus,
} from '../lib/quests';
import {
  DISCARD_LABEL,
  DISCARD_TOOLTIP,
  EDIT_MODE_ON_LOAD,
  EDIT_OFF_TOOLTIP,
  EDIT_ON_TOOLTIP,
  EDIT_TOGGLE_LABEL,
  SAVE_FAILED_FALLBACK,
} from '../lib/quest-edit';
import {
  isCurrentStatus,
  STATUS_TRANSITIONS,
  type TransitionTarget,
} from '../lib/status-transition';
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
 *
 * **Transitions and history (story p2-09).** The header carries the two lifecycle
 * actions next to the `StatusBadge`, and the history timeline sits under the
 * preview. The actions run through the shared `useStatusTransition` flow — identity
 * gate first, then the notes dialog, then the PATCH — and the optimistically
 * rewritten row (D51(e)) is the same list row this page's badge reads, so the badge
 * flips without waiting for a refetch. No seventh tab was added.
 *
 * **Editing (stories p3-03 to p3-10).** All six tabs are live editors — Info, Goals,
 * Goal Logic, Requirements, Results and Dialog — and story p3-10 added the header **Edit** toggle
 * that swaps them for the Phase-2 read-only bodies, the unsaved-changes guard and the Save
 * pipeline. The loaded body therefore lives in {@link LoadedQuest},
 * which holds the **one**
 * editable document: `useQuestDocument` turns the fetched quest into local document state,
 * both editors mutate it through `shared/document.ts`, and the same live document feeds the
 * JSON panel — so a form edit appears in the panel with no refetch and no manual refresh.
 * There is exactly one `useQuestDocument` instance for the page; all six panels are
 * constructed from it (`QuestPreview`'s `panels` map). The hook mounts only here, never in the page,
 * because `loadDoc` rightly throws on "no document yet" (loading and error are not documents).
 *
 * The read-only timestamp the Info tab shows (spec L298) is the list row's
 * `modified_at` — the same row the badge already reads (D51(e)), not a new API field.
 */
export default function QuestDetailPage(): JSX.Element {
  const { questName = '' } = useParams<{ questName: string }>();

  const quest = useQuery({
    queryKey: questDetailQueryKey(questName),
    queryFn: () => getQuest(questName),
    retry: false,
  });
  // The API-error toast with a retry action (AC3, spec L533). The 404 that renders the
  // "not found" state is declined by the hook, so it never produces a toast.
  useApiErrorToast(quest, QUEST_LOAD_ERROR);
  const list = useQuery({
    queryKey: QUESTS_QUERY_KEY,
    queryFn: listQuests,
    staleTime: Infinity,
  });

  if (quest.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <BackBar />
        {/*
          The skeleton matches the loaded page's two bands (story p5-04's layout audit):
          `QuestHeader` — back link, quest name, status badge, the action group — and then
          `QuestPreview`, whose own body is exactly `h-[70vh]` (`QuestPreview quest className=
          "h-[70vh]"` below). The previous single 70vh block stood in for the panel only, so the
          page jumped down by a header row when the data arrived.
        */}
        <div aria-busy="true" className="flex flex-col gap-4">
          <span className="sr-only">{QUEST_LOADING}</span>
          <Skeleton className="h-10 w-full" />
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
            {/* `h2`, not `h1`: the shell header owns this document's single `h1` (p5-05). */}
            <h2 className="text-lg font-semibold text-zinc-100">
              {notFound ? QUEST_NOT_FOUND_TITLE : QUEST_LOAD_ERROR}
            </h2>
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

  const row = list.data?.quests.find((entry) => entry.quest_name === questName);

  return (
    <LoadedQuest quest={quest.data} questName={questName} status={questStatus(row)} row={row} />
  );
}

/**
 * The loaded body: the mode toggle, the six tabs (editors in edit mode, the Phase-2 read-only
 * bodies in view mode), the JSON surfaces, the dirty guard, the history panel and the notes
 * dialog.
 *
 * Separate from the page so the editable document is created exactly once the quest
 * data exists — {@link useQuestDocument} is called with a real document, never with
 * `undefined`.
 */
function LoadedQuest({
  quest,
  questName,
  status,
  row,
}: {
  quest: QuestObject;
  questName: string;
  status: StatusValue;
  row: QuestListRow | undefined;
}): JSX.Element {
  const isMobile = useIsMobile();
  const [jsonOpen, setJsonOpen] = useState(false);
  /**
   * The view/edit mode (plan task 3.10). `QuestPreview`'s `panels` record **is** the mode:
   * present → the 3.3-3.8 editors, absent → the p2-07 read-only bodies, with no second copy of
   * either. See `EDIT_MODE_ON_LOAD` for why a freshly opened quest starts in edit mode.
   */
  const [editMode, setEditMode] = useState(EDIT_MODE_ON_LOAD);
  const transition = useStatusTransition('quests');
  const document = useQuestDocument(quest);
  // One validation pass over the one document state (story p3-09): the same findings feed the
  // form-level banner, every inline message, and the Save affordance's disabled state.
  const validation = useQuestValidation(document.doc);
  // The server's own findings for the last failed save (AC3's validation summary). The client
  // engine above cannot produce them — the pipeline's field map is what a rejected document
  // returns (D65).
  const serverValidation = useServerValidation();
  // The unsaved-changes guard (story p3-10): in-app navigation + window close, only while dirty.
  const guard = useUnsavedChangesGuard(document.dirty);
  const queryClient = useQueryClient();
  const { requireUserName } = useUserNameGate();
  /**
   * The live document, for the save's response handler only. A save is asynchronous and the
   * editors stay editable while it runs, so "did the user change something after the request
   * left?" has to be answered against the document as it is *now* — the mutation's own options
   * are rebuilt per render, and a ref is the one place the latest value is not stale.
   */
  const liveDocRef = useRef(document.doc);
  useEffect(() => {
    liveDocRef.current = document.doc;
  }, [document.doc]);

  /**
   * Save one quest: the identity gate (D38), then `POST /api/quests` — the Phase-2 pipeline
   * writes the file, refreshes the metadata's `ModifiedAt`/`ModifiedBy` and commits
   * `spiraldb: update quest {name}` (D49(a)) — then the spec's toast (spec-ui-design L120) and
   * the D48(d) warnings.
   *
   * The body is the **live document** (`document.doc`), never a rebuild: D57/D58 make the
   * editor's own object the payload, so an untouched key cannot be rewritten on the way out.
   *
   * The status is deliberately untouched: this mutation never turns into a `PATCH
   * /api/status/...`, and it passes no `status` to the pipeline, so a `reviewed`/`verified`
   * entry stays exactly where it was (plan §3.10's last clause). Invalidating the list only
   * refetches the badge, which cannot move without a status change.
   */
  const save = useMutation({
    mutationFn: async (questToSave: QuestObject): Promise<SaveQuestResult> => {
      await requireUserName();
      return saveQuest({ quest: questToSave });
    },
    onSuccess: async (result, sent) => {
      serverValidation.clear();
      notifySuccess(savedMessage(result.quest_name));
      for (const warning of result.warnings) {
        notifyWarning(warning);
      }
      // The baseline advances only when the saved document is still the live one: an edit made
      // while the request was in flight is *not* on disk, so it must keep the guard armed.
      if (liveDocRef.current === sent) {
        document.markSaved();
      }
      await queryClient.invalidateQueries({ queryKey: QUESTS_QUERY_KEY });
    },
    onError: (error) => {
      // A dismissed identity dialog is not a failure: nothing was written and nothing may
      // claim otherwise.
      if (error instanceof UserNameCancelledError) {
        return;
      }
      // The save pipeline's 400 carries a field map (D65); keep it for the validation summary.
      serverValidation.capture(error);
      notifyError(serverMessage(error, SAVE_FAILED_FALLBACK));
    },
  });

  const panels = editMode
    ? {
        Info: <QuestInfoEditor state={document} modifiedAt={row?.modified_at ?? null} />,
        Goals: <QuestGoalsEditor state={document} modifiedAt={row?.modified_at ?? null} />,
        'Goal Logic': (
          <Suspense
            fallback={
              <p role="status" className="p-4 text-sm text-zinc-400">
                Loading flowchart…
              </p>
            }
          >
            <QuestGoalLogicEditor state={document} modifiedAt={row?.modified_at ?? null} />
          </Suspense>
        ),
        Requirements: (
          <QuestRequirementsEditor state={document} modifiedAt={row?.modified_at ?? null} />
        ),
        Results: <QuestResultsEditor state={document} modifiedAt={row?.modified_at ?? null} />,
        Dialog: <QuestDialogEditor state={document} modifiedAt={row?.modified_at ?? null} />,
      }
    : undefined;

  return (
    // The two mode markers, so the state is observable without inferring it from the editors
    // (a tier-1 spec and the browser evidence both read them).
    <div className="flex flex-col gap-4" data-edit-mode={editMode} data-dirty={document.dirty}>
      <QuestHeader
        quest={quest}
        questName={questName}
        questTitle={row === undefined ? null : questFriendlyTitle(row)}
        status={status}
        jsonOpen={jsonOpen}
        onToggleJson={() => setJsonOpen((open) => !open)}
        transitionPending={transition.isPending}
        onTransition={(target) => transition.request(questName, target)}
        saveBlocked={validation.blocked}
        onSave={() => save.mutate(document.doc as QuestObject)}
        editMode={editMode}
        onToggleEdit={() => setEditMode((on) => !on)}
        dirty={document.dirty}
        onDiscard={document.reset}
      />

      <QuestValidationBanner banner={validation.banner} />

      {/* L537's "summary at top of form if multiple errors" for the save pipeline's own 400 field
          map (D64/D65) — findings the client's engine cannot produce. */}
      <ValidationSummary messages={serverValidation.messages} />

      <div className="flex min-h-0 gap-4">
        <div className="min-w-0 flex-1 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40">
          <FieldValidationProvider messages={validation.messages}>
            <QuestPreview quest={quest} className="h-[70vh]" panels={panels} />
          </FieldValidationProvider>
        </div>
        {/* Exactly one of the two JSON surfaces is mounted (see `QuestJsonPanel`). */}
        {jsonOpen && !isMobile ? <QuestJsonPanel quest={document.doc} /> : null}
      </div>

      {isMobile ? (
        <QuestJsonOverlay open={jsonOpen} onOpenChange={setJsonOpen} quest={document.doc} />
      ) : null}

      <StatusHistoryPanel type="quests" objectKey={questName} noun="quest" />
      <StatusNotesDialog {...transition.dialog} />
      <UnsavedChangesDialog
        open={guard.blocked}
        onOpenChange={(open) => {
          // Escape, the close button and an overlay click all mean "stay": only the dialog's own
          // destructive button leaves, and it calls `guard.discard` directly.
          if (!open) {
            guard.stay();
          }
        }}
        onDiscard={guard.discard}
      />
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
      className="inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {BACK_TO_QUESTS_LABEL}
    </Link>
  );
}

/**
 * The spec's header bar (L281): back link, mono name, StatusBadge, the two status
 * actions (story p2-09), Edit + `{ }`, and — in edit mode — Save (and Discard while dirty).
 *
 * The action for the status the entry already has is `aria-disabled` rather than
 * natively disabled, exactly like the Save affordance: a natively disabled
 * control leaves the tab order and stops explaining itself, so the pair stays
 * focusable and its `title` still works. The handler re-checks the condition, so the
 * attribute describes the behaviour instead of being the only guard.
 *
 * **Edit is the real mode toggle as of story p3-10** (it was an inert `aria-disabled`
 * placeholder carrying "Editing arrives in Phase 3", D59(a)'s documented 3.3/3.10 split). It is a
 * labelled toggle — same visible name in both modes, `aria-pressed` carrying the state, `title`
 * explaining what pressing it does — rather than two buttons, so "Edit" keeps its one meaning.
 * The Save affordance is rendered only in edit mode: view mode is the Phase-2 read-only
 * rendering, and a Save button there would have nothing to save.
 */
function QuestHeader({
  quest,
  questName,
  questTitle,
  status,
  jsonOpen,
  onToggleJson,
  transitionPending,
  onTransition,
  saveBlocked,
  onSave,
  editMode,
  onToggleEdit,
  dirty,
  onDiscard,
}: {
  quest: QuestObject;
  questName: string;
  /**
   * The resolved title from the list row, or `null` when the list has not answered or
   * answered with a raw key / the name itself (`questFriendlyTitle` owns that rule). It is
   * the friendly half of the QuestTemplate pair (D105/P6-16).
   */
  questTitle: string | null;
  status: StatusValue;
  jsonOpen: boolean;
  onToggleJson: () => void;
  transitionPending: boolean;
  onTransition: (target: TransitionTarget) => void;
  /** Story p3-09: the validation gate the Save affordance follows. */
  saveBlocked: boolean;
  /** Story p3-10: the save action — `POST /api/quests` (D65(f)'s single-prop seam). */
  onSave: () => void;
  /** Story p3-10: `true` while the tabs render the editors instead of the read-only bodies. */
  editMode: boolean;
  onToggleEdit: () => void;
  /** Story p3-10: `true` when the live document differs from the loaded one. */
  dirty: boolean;
  /** Story p3-10: discard the edits and restore the loaded document byte for byte. */
  onDiscard: () => void;
}): JSX.Element {
  const questKey = typeof quest.m_questName === 'string' ? quest.m_questName : questName;
  // The QuestTemplate pair: `Wizard Tours (DS-ACAD-C01-001)`, collapsed to the name
  // alone when the title lookup fell back to the name itself (or has not answered).
  const displayName = namePairDistinct(questTitle, questKey);
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 pb-3">
      <BackLink />

      {/*
        `h2`, not `h1`: the shell header owns this document's single `h1` (p5-05), and the
        quest name sits *below* the page title, not above it.
      */}
      <h2
        className="min-w-0 truncate text-xl font-mono font-semibold text-zinc-50"
        title={displayName}
      >
        {displayName}
      </h2>
      <StatusBadge status={status} />

      {/*
        `flex-wrap` is the same fix story p4-10 applied to `ObjectDetailLayout`'s action group,
        mirrored here because the **quest** detail page was outside that story's scope. The
        actions together are ~500px wide, so at a 375px viewport the group's right edge sat at
        **524 of 375** (+149px — the page scrolled sideways) and at 768px at **784 of 768**
        (+16px, where the sidebar leaves only a 460px column). Wrapping lets the group shrink to
        its widest single button and lay the rest on following lines; the outer header already
        wraps (`flex flex-wrap items-center gap-3`), so at mobile the group drops to its own line.
        On desktop nothing wraps and the row is unchanged.
      */}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {STATUS_TRANSITIONS.map((transition) => {
          const current = isCurrentStatus(status, transition.status);
          const unavailable = current || transitionPending;
          return (
            <Button
              key={transition.status}
              type="button"
              variant="outline"
              aria-disabled={unavailable}
              title={current ? `Already ${transition.status}` : undefined}
              className={cn(
                'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
                current ? null : 'border-blue-600/60 text-blue-300 hover:text-blue-200',
              )}
              onClick={() => {
                if (!unavailable) {
                  onTransition(transition.status);
                }
              }}
            >
              {transition.label}
            </Button>
          );
        })}
        {/*
          The mode toggle. `aria-pressed` (not a changing label) so the control's name stays
          "Edit" in both modes; the `title` carries the action, and the blue accent marks the
          active state the way the status buttons already do.
        */}
        <Button
          type="button"
          variant="outline"
          aria-pressed={editMode}
          title={editMode ? EDIT_ON_TOOLTIP : EDIT_OFF_TOOLTIP}
          className={cn(
            editMode ? 'border-blue-600/60 text-blue-300 hover:text-blue-200' : undefined,
          )}
          onClick={onToggleEdit}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          {EDIT_TOGGLE_LABEL}
        </Button>
        {editMode ? (
          <>
            {/*
              Only while there is something to discard: a clean edit session shows exactly the
              spec's `[Edit] [Save] [{}]`, and the guard's dialog covers the leaving case.
            */}
            {dirty ? (
              <Button type="button" variant="ghost" title={DISCARD_TOOLTIP} onClick={onDiscard}>
                {DISCARD_LABEL}
              </Button>
            ) : null}
            {/*
              The validation-driven Save affordance (story p3-09), wired by story p3-10: the
              disabled state stays the engine's `blocked` and is **not** re-derived here (D65(f)),
              and the pipeline behind the click is `LoadedQuest`'s mutation.
            */}
            <QuestSaveButton
              blocked={saveBlocked}
              describedBy={VALIDATION_BANNER_ID}
              onSave={onSave}
            />
          </>
        ) : null}
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
