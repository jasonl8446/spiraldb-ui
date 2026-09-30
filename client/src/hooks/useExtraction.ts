import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

import { extractQuests, type ExtractCensus, type QuestObject } from '../lib/api';
import {
  extractErrorMessage,
  EXTRACTING_TOAST_MESSAGE,
  suggestionsStoreNotice,
} from '../lib/extract';
import { dismissNotification, notifyError, notifyInfo } from '../lib/notify';

/**
 * The extraction controller (plan task 2.6, story p2-07).
 *
 * Owns the one state machine the page needs:
 *
 * ```
 * idle ──start(file)──▶ extracting ──200──▶ results ──discard()/cancel()──▶ idle
 *                          │
 *                          └──failure──▶ idle (+error, +error toast)
 * ```
 *
 * **Cancel really aborts (decision D9/D47).** `cancel()` aborts the `AbortSignal`
 * it passed into the fetch; the server's `res.on('close')` then kills the CLI
 * child and deletes the temp capture. The UI returns to `idle` immediately.
 *
 * **A late response cannot resurrect the run.** Every start takes an epoch; the
 * promise callbacks and `cancel`/`discard` only apply their result when their
 * epoch is still the current one, so a mocked (or merely slow) response that
 * lands after the user cancelled — or after a second start — is dropped. That is
 * also why `status` is driven here rather than by a TanStack mutation: a mutation
 * has no notion of "this result belongs to a superseded request".
 *
 * **The "Extracting quests..." notice ends with the extraction (D183).** It is a
 * progress notice, so it is taken down the moment the run settles (results, failure,
 * cancel, discard or unmount) instead of outliving it for the rest of its 5 s. Left up,
 * it sat bottom-right over the results' `Save All to SpiralDB` / `Save Selected`
 * buttons, and a pointer resting on it pauses sonner's timer, so the stale notice
 * could cover the page's next action indefinitely (measured in p7-16).
 */
export type ExtractionStatus = 'idle' | 'extracting' | 'results';

export interface ExtractionState {
  status: ExtractionStatus;
  /** The parsed quests of the last successful extraction (empty until then). */
  quests: QuestObject[];
  /** `count` as the API returned it — informational; `quests.length` is rendered. */
  count: number;
  /** The packet census of the capture (D139), when the server answered with one. */
  census: ExtractCensus | undefined;
  /** What became of the capture suggestions, when there is something to say (review 9a/9d). */
  suggestionsNotice: string | null;
  /** The capture being extracted (or the last one tried), for the file card. */
  file: File | null;
  /**
   * The failure message shown inline under the drop zone. An error always returns
   * the page to the upload phase — it must never strand the spinner.
   */
  error: string | null;
}

export interface ExtractionController extends ExtractionState {
  /** Starts extracting `file`, aborting any run already in flight. */
  start: (file: File) => void;
  /** Aborts the in-flight extraction and returns to the upload phase. */
  cancel: () => void;
  /** Drops the results (or the failed file) and returns to the upload phase. */
  discard: () => void;
}

/** Takes down the run's "Extracting quests..." notice, if it is still up. */
function endExtractingNotice(notice: MutableRefObject<string | number | null>): void {
  if (notice.current !== null) {
    dismissNotification(notice.current);
    notice.current = null;
  }
}

const INITIAL: ExtractionState = {
  status: 'idle',
  quests: [],
  count: 0,
  census: undefined,
  suggestionsNotice: null,
  file: null,
  error: null,
};

export function useExtraction(): ExtractionController {
  const [state, setState] = useState<ExtractionState>(INITIAL);
  const controllerRef = useRef<AbortController | null>(null);
  /** Bumped by every start/cancel/discard; results with a stale epoch are dropped. */
  const epochRef = useRef(0);
  const noticeRef = useRef<string | number | null>(null);

  // Leaving the page mid-extraction must not leave a CLI child running, so the
  // unmount behaves like Cancel (the server sees the closed response).
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      endExtractingNotice(noticeRef);
    },
    [],
  );

  const start = useCallback((file: File): void => {
    const epoch = (epochRef.current += 1);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    setState({
      status: 'extracting',
      quests: [],
      count: 0,
      census: undefined,
      suggestionsNotice: null,
      file,
      error: null,
    });
    endExtractingNotice(noticeRef);
    noticeRef.current = notifyInfo(EXTRACTING_TOAST_MESSAGE);

    extractQuests(file, { signal: controller.signal })
      .then((result) => {
        if (epoch !== epochRef.current) {
          return; // superseded by a cancel or a newer start
        }
        controllerRef.current = null;
        endExtractingNotice(noticeRef);
        setState({
          status: 'results',
          quests: result.quests,
          count: result.count,
          census: result.census,
          suggestionsNotice: suggestionsStoreNotice(
            result.suggestions_store,
            // A pre-task-7.5 body (and the older tier-1 mocks) carries no `suggestions`.
            (result.suggestions ?? []).length,
          ),
          file,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (epoch !== epochRef.current || controller.signal.aborted) {
          return; // a cancel is not a failure, and it must not toast
        }
        controllerRef.current = null;
        endExtractingNotice(noticeRef);
        const message = extractErrorMessage(error);
        setState({
          status: 'idle',
          quests: [],
          count: 0,
          census: undefined,
          suggestionsNotice: null,
          file: null,
          error: message,
        });
        notifyError(message);
      });
  }, []);

  const cancel = useCallback((): void => {
    epochRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    endExtractingNotice(noticeRef);
    setState(INITIAL);
  }, []);

  const discard = useCallback((): void => {
    epochRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    endExtractingNotice(noticeRef);
    setState(INITIAL);
  }, []);

  return { ...state, start, cancel, discard };
}
