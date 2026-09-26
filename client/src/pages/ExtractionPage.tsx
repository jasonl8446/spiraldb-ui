import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PackageSearch } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import ExtractDropzone from '../components/quest/ExtractDropzone';
import ExtractingCard from '../components/quest/ExtractingCard';
import OverwriteConfirmDialog from '../components/quest/OverwriteConfirmDialog';
import QuestListPanel from '../components/quest/QuestListPanel';
import QuestPreview from '../components/quest/QuestPreview';
import QuestPreviewDialog from '../components/quest/QuestPreviewDialog';
import SaveConfirmDialog from '../components/quest/SaveConfirmDialog';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { useExtraction } from '../hooks/useExtraction';
import { useIsMobile } from '../hooks/useIsMobile';
import { useUserNameGate } from '../hooks/useUserNameGate';
import {
  listQuests,
  QUESTS_QUERY_KEY,
  saveQuest,
  type QuestObject,
  type SaveQuestResult,
} from '../lib/api';
import {
  DISCARD_LABEL,
  existingCheckErrorMessage,
  existingCheckFailedMessage,
  overwriteTargets,
  questName,
  SAVE_ALL_LABEL,
  SAVE_SELECTED_LABEL,
  saveErrorMessage,
  savedMessage,
} from '../lib/extract';
import { notifyError, notifySuccess, notifyWarning } from '../lib/notify';
import { UserNameCancelledError } from '../lib/user-name';

/** No names loaded yet — one shared instance so the memo below is stable. */
const NO_NAMES: ReadonlySet<string> = new Set();

/**
 * Quest extraction page — `/quests/extract` (plan task 2.6, story p2-07;
 * docs/spec-ui-design.md L183-235).
 *
 * Two phases in one component, because the state that separates them is one
 * (`useExtraction`): upload → results, with Cancel returning to upload and
 * Discard dropping the results.
 *
 * The save path is the identity gate's **first real caller** (D38, D43): both
 * Save All and Save Selected `await requireUserName()` before the first write. The
 * gate resolves immediately when `settings.user_name` is set; otherwise it opens
 * the identity dialog and resolves with the entered name, so the pending save
 * resumes on its own. A dismissed dialog rejects with
 * {@link UserNameCancelledError} — the save is abandoned and nothing is toasted.
 *
 * **The overwrite confirmation (gap A, plan §2.4's last bullet).** Before either
 * save path writes anything it asks `GET /api/quests` (p2-06) once per results set
 * — lazily, on the first save click — and intersects the extracted names with the
 * corpus names:
 *
 * - Save All opens its confirm with the AC's sentence *and* the list of names that
 *   would be overwritten; its Save button is disabled until the check has
 *   succeeded.
 * - Save Selected asks first only when the selected name already exists (a new
 *   quest keeps its one-click behaviour).
 *
 * The check is **fail-closed**: a failed `GET /api/quests` saves nothing at all
 * and says so, because an unknown overwrite risk must never become an unconfirmed
 * overwrite. No POST can therefore precede the confirmation on either path.
 *
 * **The capture note (gap B).** Both paths send the selected capture's file name as
 * `source`, so a quest this save *creates* gets the plan's
 * `Imported from packet capture {filename}` history note server-side.
 *
 * Layout note (a deliberate, reported deviation from spec L226): the action bar
 * `[Save All to SpiralDB] [Save Selected] [Discard]` is rendered as the results
 * phase's footer rather than inside the right preview panel, because at < 768px
 * the right panel is not mounted at all (mobile shows the list full width and the
 * preview as an overlay) and a bar inside it would be unreachable on a phone.
 */
export default function ExtractionPage(): JSX.Element {
  const extraction = useExtraction();
  const isMobile = useIsMobile();
  const { requireUserName } = useUserNameGate();
  const client = useQueryClient();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const [checkingExisting, setCheckingExisting] = useState(false);
  const [existingCheckError, setExistingCheckError] = useState<string | null>(null);
  const [existingNames, setExistingNames] = useState<ReadonlySet<string>>(NO_NAMES);
  const [overwriteTarget, setOverwriteTarget] = useState<{
    quest: QuestObject;
    name: string;
  } | null>(null);
  const [overwriteOpen, setOverwriteOpen] = useState(false);
  /** The lazy `GET /api/quests` of this results set; cleared after a save. */
  const namesRequest = useRef<Promise<ReadonlySet<string>> | null>(null);

  const { quests } = extraction;
  // A new extraction replaces the list; start again from the first row — and throw
  // away the previous set's overwrite answer. The clamp keeps a shrinking list from
  // pointing past its end for the one render before this effect runs.
  useEffect(() => {
    setSelectedIndex(0);
    setMobilePreviewOpen(false);
    setExistingNames(NO_NAMES);
    setExistingCheckError(null);
    namesRequest.current = null;
  }, [quests]);

  const clampedIndex =
    quests.length === 0 ? -1 : Math.min(Math.max(selectedIndex, 0), quests.length - 1);
  const selected: QuestObject | undefined = clampedIndex === -1 ? undefined : quests[clampedIndex];
  const displayName = (quest: QuestObject): string => questName(quest, quests.indexOf(quest));
  const overwriteNames = overwriteTargets(quests.map(displayName), existingNames);

  /**
   * The names already in SpiralDB, fetched lazily and reused for this results set.
   *
   * A rejection clears the memo so the next click really retries (the fail-safe path
   * must be recoverable, not sticky), and rethrows for the caller to turn into the
   * refusal message.
   */
  const checkExistingQuests = useCallback((): Promise<ReadonlySet<string>> => {
    const cached = namesRequest.current;
    if (cached !== null) {
      return cached;
    }
    const request = listQuests()
      .then((result) => {
        const names: ReadonlySet<string> = new Set(result.quests.map((row) => row.quest_name));
        setExistingNames(names);
        return names;
      })
      .catch((error: unknown) => {
        // The fail-safe path must be recoverable: a later click re-fetches instead of
        // replaying this rejection.
        namesRequest.current = null;
        throw error;
      });
    namesRequest.current = request;
    return request;
  }, []);

  /**
   * Runs the overwrite check, reporting failure in the dialog and (for Save
   * Selected) as a toast. `null` means "could not check" — the callers then save
   * nothing at all.
   */
  const runExistingCheck = useCallback(async (): Promise<ReadonlySet<string> | null> => {
    setCheckingExisting(true);
    setExistingCheckError(null);
    try {
      return await checkExistingQuests();
    } catch (error) {
      const message = existingCheckFailedMessage(existingCheckErrorMessage(error));
      setExistingCheckError(message);
      notifyError(message);
      return null;
    } finally {
      setCheckingExisting(false);
    }
  }, [checkExistingQuests]);

  /**
   * Save one or more quests, in order.
   *
   * One `POST /api/quests` per quest on purpose: the save pipeline commits per
   * object (D13), and the server's dirty-tree guard (D14) makes concurrent saves a
   * race. Each success toasts the spec's per-quest copy (L120) and surfaces the
   * D48(d) warning when the metadata pairing was ambiguous; a failure stops the
   * sequence and toasts the server's own message (the 409 dirty-tree text, the
   * 500, …), leaving the remaining quests in the results list to retry. The body
   * carries the selected capture's name as `source` (gap B).
   */
  const save = useMutation<SaveQuestResult[], Error, QuestObject[]>({
    mutationFn: async (toSave) => {
      await requireUserName();

      const source = extraction.file?.name;
      const results: SaveQuestResult[] = [];
      for (const quest of toSave) {
        const result = await saveQuest(source === undefined ? { quest } : { quest, source });
        results.push(result);
        notifySuccess(savedMessage(result.quest_name));
        for (const warning of result.warnings) {
          notifyWarning(warning);
        }
      }
      return results;
    },
    onSuccess: async () => {
      // The browse list (p2-08) and every status view now have one more row — and
      // the next overwrite check must see the quests that were just created.
      namesRequest.current = null;
      await client.invalidateQueries({ queryKey: QUESTS_QUERY_KEY });
      await client.invalidateQueries({ queryKey: ['status'] });
    },
    onError: (error) => {
      // A dismissed identity dialog is not a failure: nothing was saved and
      // nothing may claim otherwise.
      if (error instanceof UserNameCancelledError) {
        return;
      }
      notifyError(saveErrorMessage(error));
    },
  });

  function handleSelect(index: number): void {
    setSelectedIndex(index);
    if (isMobile) {
      setMobilePreviewOpen(true);
    }
  }

  function handleSave(questObjects: QuestObject[]): void {
    setMobilePreviewOpen(false);
    save.mutate(questObjects);
  }

  /** Save All: open the confirm, then check what it would overwrite. */
  function handleSaveAllClick(): void {
    setMobilePreviewOpen(false);
    setConfirmOpen(true);
    void runExistingCheck();
  }

  /**
   * Save Selected: check first. An existing name gets the small confirm dialog;
   * a new name saves immediately (today's behaviour); a failed check saves nothing.
   */
  async function handleSaveSelectedClick(): Promise<void> {
    if (selected === undefined) {
      return;
    }
    setMobilePreviewOpen(false);
    const names = await runExistingCheck();
    if (names === null) {
      return;
    }
    const name = displayName(selected);
    if (names.has(name)) {
      setOverwriteTarget({ quest: selected, name });
      setOverwriteOpen(true);
      return;
    }
    handleSave([selected]);
  }

  function handleDiscard(): void {
    setConfirmOpen(false);
    setOverwriteOpen(false);
    setMobilePreviewOpen(false);
    extraction.discard();
  }

  if (extraction.status === 'results') {
    return (
      <div className="flex flex-col gap-4">
        {quests.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <PackageSearch className="h-10 w-10 text-zinc-500" aria-hidden="true" />
              <p className="text-sm text-zinc-200">No quests found in this packet capture.</p>
              <p className="text-sm text-zinc-500">
                The capture was parsed successfully but contained no quest definitions. Discard it
                and try another one.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex min-h-[24rem] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/40 md:h-[70vh] md:flex-row">
            <QuestListPanel
              quests={quests}
              selectedIndex={clampedIndex}
              onSelect={handleSelect}
              className="w-full shrink-0 border-b border-zinc-800 md:h-full md:w-80 md:border-b-0 md:border-r"
            />
            {selected === undefined ? null : (
              <QuestPreview quest={selected} className="hidden min-w-0 flex-1 md:flex" />
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-800 pt-4">
          <Button
            onClick={handleSaveAllClick}
            disabled={save.isPending || checkingExisting || quests.length === 0}
          >
            {SAVE_ALL_LABEL}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              void handleSaveSelectedClick();
            }}
            disabled={save.isPending || checkingExisting || selected === undefined}
          >
            {SAVE_SELECTED_LABEL}
          </Button>
          <Button variant="ghost" onClick={handleDiscard} disabled={save.isPending}>
            {DISCARD_LABEL}
          </Button>
        </div>

        <SaveConfirmDialog
          open={confirmOpen}
          count={quests.length}
          saving={save.isPending}
          existingNames={overwriteNames}
          checking={checkingExisting}
          checkError={existingCheckError}
          onOpenChange={setConfirmOpen}
          onConfirm={() => {
            // The button is disabled until the check has succeeded; the guard keeps
            // the safety property true even if that ever changes (gap A: no POST
            // before the user has seen what would be overwritten).
            if (checkingExisting || existingCheckError !== null) {
              return;
            }
            setConfirmOpen(false);
            handleSave(quests);
          }}
        />

        <OverwriteConfirmDialog
          open={overwriteOpen}
          name={overwriteTarget?.name ?? ''}
          saving={save.isPending}
          onOpenChange={setOverwriteOpen}
          onConfirm={() => {
            setOverwriteOpen(false);
            if (overwriteTarget !== null) {
              handleSave([overwriteTarget.quest]);
            }
          }}
        />

        {selected === undefined ? null : (
          <QuestPreviewDialog
            open={mobilePreviewOpen}
            onOpenChange={setMobilePreviewOpen}
            quest={selected}
            name={displayName(selected)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4">
      {extraction.status === 'extracting' && extraction.file !== null ? (
        <ExtractingCard file={extraction.file} onCancel={extraction.cancel} />
      ) : (
        <ExtractDropzone onFile={extraction.start} />
      )}

      {extraction.error === null ? null : (
        <p role="alert" className="text-sm text-red-400">
          {extraction.error}
        </p>
      )}
    </div>
  );
}
