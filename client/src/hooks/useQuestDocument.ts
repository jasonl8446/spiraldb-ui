import { useCallback, useState } from 'react';

import {
  applyEdits,
  getAtPath,
  hasAtPath,
  loadDoc,
  type DocEdit,
  type DocPath,
  type JsonDocument,
} from '@shared/document';

/**
 * `useQuestDocument(source)` — the edit-state foundation of the Phase-3 editors
 * (plan task 3.3, story p3-03; decisions D5/D57/D58).
 *
 * It is deliberately the smallest thing that can hold an editable document:
 *
 * - **the loaded original is kept**, exactly as D5 requires
 *   (`loadDoc(source)` returns the parsed object unchanged), so unknown keys,
 *   explicit `null`s and key order survive every edit;
 * - **every edit goes through `shared/document.ts`'s primitives** — `setAtPath` /
 *   `deleteAtPath` / `applyEdits` — because D58 makes those primitives the mutation
 *   contract. Nothing here spreads and rebuilds a document, and nothing injects a
 *   default.
 *
 * It ships no undo stack, no form library and no validation: the dirty-state guard,
 * the Save toggle and validation are task 3.10 / 3.9, and a form library would be a
 * second, competing document model.
 *
 * The document is re-loaded when the **source identity** changes (a new fetch
 * result, or a different quest), using React's documented "adjust state during
 * render" pattern so the very first paint after a navigation already shows the new
 * quest — an effect would paint one frame of the previous quest's document.
 *
 * `source` must be a parsed document (object or array): `loadDoc` throws a
 * `TypeError` otherwise, which is the contract that keeps "no document yet" from
 * silently becoming "an empty document". Callers therefore only mount this hook once
 * the fetch has data — see `QuestDetailPage`'s loaded child.
 */
export interface QuestDocumentState {
  /** The live document: `source` until the first edit, a new object afterwards. */
  doc: JsonDocument;
  /** `true` when {@link path} exists (never throws, unlike `getAtPath`). */
  has: (path: DocPath) => boolean;
  /** The value at {@link path}, or `undefined` when the path does not exist. */
  value: (path: DocPath) => unknown;
  /** Applies one edit; `null` is a no-op (the "nothing to change" case). */
  edit: (edit: DocEdit | null) => void;
  /** Applies several edits in order — the batch entry point. */
  editAll: (edits: readonly DocEdit[]) => void;
}

export function useQuestDocument(source: unknown): QuestDocumentState {
  const [doc, setDoc] = useState<JsonDocument>(() => loadDoc(source));
  const [loadedSource, setLoadedSource] = useState<unknown>(source);

  if (source !== loadedSource) {
    setLoadedSource(source);
    setDoc(loadDoc(source));
  }

  const edit = useCallback((next: DocEdit | null) => {
    if (next === null) {
      return;
    }
    // `JsonDocument` is `unknown`, so the updater's parameter needs an explicit
    // type: `SetStateAction<unknown>` gives the arrow no contextual parameter.
    setDoc((current: JsonDocument) => applyEdits(current, [next]));
  }, []);

  const editAll = useCallback((edits: readonly DocEdit[]) => {
    if (edits.length === 0) {
      return;
    }
    setDoc((current: JsonDocument) => applyEdits(current, edits));
  }, []);

  const has = useCallback((path: DocPath) => hasAtPath(doc, path), [doc]);

  const value = useCallback(
    (path: DocPath) => (hasAtPath(doc, path) ? getAtPath(doc, path) : undefined),
    [doc],
  );

  return { doc, has, value, edit, editAll };
}
