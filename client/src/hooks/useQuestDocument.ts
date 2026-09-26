import { useCallback, useMemo, useState } from 'react';

import {
  getAtPath,
  hasAtPath,
  type DocEdit,
  type DocPath,
  type JsonDocument,
} from '@shared/document';
import {
  editQuestDocument,
  isQuestDocumentDirty,
  loadQuestDocument,
  markQuestDocumentSaved,
  resetQuestDocument,
  type QuestDocumentModel,
} from '../lib/quest-edit';

/**
 * `useQuestDocument(source)` — the edit-state foundation of the Phase-3 editors
 * (plan task 3.3, story p3-03; decisions D5/D57/D58) and, since story p3-10, the
 * **baseline / dirty / reset** machinery the mode toggle and the unsaved-changes guard need
 * (plan task 3.10).
 *
 * The session itself — the loaded baseline, the live document, the dirty predicate and the
 * byte-exact reset — lives in `lib/quest-edit.ts`, which is pure and unit-tested; this hook is
 * the React state around it:
 *
 * - **the loaded original is kept**, exactly as D5 requires (the baseline is the parsed document
 *   `loadDoc` returned, unchanged), so unknown keys, explicit `null`s and key order survive
 *   every edit — and so {@link QuestDocumentState.reset} restores them byte for byte;
 * - **every edit goes through `shared/document.ts`'s primitives** — `setAtPath` /
 *   `deleteAtPath` / `applyEdits` — because D58 makes those primitives the mutation contract.
 *   Nothing here spreads and rebuilds a document, and nothing injects a default.
 * - **`dirty` is a byte comparison against the baseline**, not an "an edit happened" flag: a field
 *   edited back to its loaded value is not dirty, and a key that moved is.
 *
 * It ships no undo stack and no form library: the guard, the Save toggle and validation are
 * tasks 3.10 / 3.9, and a form library would be a second, competing document model.
 *
 * The document is re-loaded when the **source identity** changes (a new fetch result, or a
 * different quest), using React's documented "adjust state during render" pattern so the very
 * first paint after a navigation already shows the new quest — an effect would paint one frame of
 * the previous quest's document. The baseline moves with it, so a fresh quest is never dirty.
 *
 * `source` must be a parsed document (object or array): `loadDoc` throws a
 * `TypeError` otherwise, which is the contract that keeps "no document yet" from
 * silently becoming "an empty document". Callers therefore only mount this hook once
 * the fetch has data — see `QuestDetailPage`'s loaded child.
 */
export interface QuestDocumentState {
  /** The live document: `source` until the first edit, a new object afterwards. */
  doc: JsonDocument;
  /** The document as loaded — the restore target and the dirty comparison's left side. */
  baseline: JsonDocument;
  /** `true` when the live bytes differ from the loaded bytes (see `lib/quest-edit.ts`). */
  dirty: boolean;
  /** `true` when {@link path} exists (never throws, unlike `getAtPath`). */
  has: (path: DocPath) => boolean;
  /** The value at {@link path}, or `undefined` when the path does not exist. */
  value: (path: DocPath) => unknown;
  /** Applies one edit; `null` is a no-op (the "nothing to change" case). */
  edit: (edit: DocEdit | null) => void;
  /** Applies several edits in order — the batch entry point. */
  editAll: (edits: readonly DocEdit[]) => void;
  /** Discards every edit, restoring the loaded document byte for byte. */
  reset: () => void;
  /** Adopts the live document as the new baseline — what a successful save means. */
  markSaved: () => void;
}

export function useQuestDocument(source: unknown): QuestDocumentState {
  const [model, setModel] = useState<QuestDocumentModel>(() => loadQuestDocument(source));
  const [loadedSource, setLoadedSource] = useState<unknown>(source);

  if (source !== loadedSource) {
    setLoadedSource(source);
    setModel(loadQuestDocument(source));
  }

  const edit = useCallback((next: DocEdit | null) => {
    if (next === null) {
      return;
    }
    setModel((current) => editQuestDocument(current, [next]));
  }, []);

  const editAll = useCallback((edits: readonly DocEdit[]) => {
    setModel((current) => editQuestDocument(current, edits));
  }, []);

  const reset = useCallback(() => {
    setModel(resetQuestDocument);
  }, []);

  const markSaved = useCallback(() => {
    setModel(markQuestDocumentSaved);
  }, []);

  const { doc, baseline } = model;
  const has = useCallback((path: DocPath) => hasAtPath(doc, path), [doc]);
  const value = useCallback(
    (path: DocPath) => (hasAtPath(doc, path) ? getAtPath(doc, path) : undefined),
    [doc],
  );
  // Serializing once per document identity: the predicate is a 36 KB string comparison for a real
  // quest, and only a new document (an edit, a reload, a reset) can change the answer.
  const dirty = useMemo(() => isQuestDocumentDirty(model), [model]);

  return { doc, baseline, dirty, has, value, edit, editAll, reset, markSaved };
}
