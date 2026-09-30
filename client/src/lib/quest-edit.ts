/**
 * The edit session's own model and the edit-mode contract (plan task 3.10, story p3-10;
 * docs/spec-ui-design.md L278-292 "Edit/Save toggle button (switches between view and edit
 * mode)", L324-340).
 *
 * Two rules live here, and nowhere else:
 *
 * 1. **The baseline.** An editing session is a pair — the document as it was **loaded** and the
 *    document as it is **now** (D5: "keep the parsed original"). Every edit produces a new pair
 *    through `shared/document.ts`'s primitives; the loaded document is never written to, which is
 *    what makes {@link resetQuestDocument} a byte-exact restore rather than a best effort.
 * 2. **Dirty means "these bytes are not the loaded bytes".** {@link isQuestDocumentDirty} compares
 *    the serialized document (`serializeDoc` — the one write rule, D58) with the serialized
 *    baseline, so key order counts as much as values do. A document that was edited and then
 *    hand-reverted to the same bytes is **not** dirty: leaving it loses nothing.
 *
 * **Pure and React-free on purpose** (the house habit: `quest-info.ts`, `quest-goals.ts`,
 * `quest-dialog.ts` are data and rules, not JSX). `useQuestDocument` is the thin React wrapper —
 * the repo has no DOM test environment and adding one would be a new dependency, so the model the
 * hook performs is the thing the unit tests exercise directly.
 *
 * The mode copy sits here too: the header's Edit toggle, the dirty guard's dialog and the Discard
 * control must not drift from each other or from the strings the tier-1 spec asserts.
 */

import {
  applyEdits,
  loadDoc,
  serializeDoc,
  type DocEdit,
  type JsonDocument,
} from '@shared/document';

/* --------------------------------------------------------------- the session */

/**
 * One editing session's document state: the loaded baseline and the live document.
 *
 * `doc === baseline` (the same reference) is the normal unedited state and the fast path every
 * function below checks first — it means "no edit has happened", not merely "no byte changed".
 */
export interface QuestDocumentModel {
  /** Exactly the parsed document handed to {@link loadQuestDocument}; never mutated. */
  readonly baseline: JsonDocument;
  /** The live document: `baseline` until the first edit, a new object afterwards. */
  readonly doc: JsonDocument;
}

/**
 * Starts a session on `source` (an already-parsed document — `loadDoc` throws otherwise, which is
 * the contract that keeps "no document yet" from becoming "an empty document").
 *
 * The baseline is the **same object** as the live document: `shared/document.ts` never mutates in
 * place, so holding the reference is holding the pristine loaded document.
 */
export function loadQuestDocument(source: unknown): QuestDocumentModel {
  const baseline = loadDoc(source);
  return { baseline, doc: baseline };
}

/**
 * Applies edits through the D58 primitives. An empty batch is the identity — no new pair, so a
 * caller that computes "nothing to change" cannot make the document dirty by accident.
 */
export function editQuestDocument(
  model: QuestDocumentModel,
  edits: readonly DocEdit[],
): QuestDocumentModel {
  if (edits.length === 0) {
    return model;
  }
  return { baseline: model.baseline, doc: applyEdits(model.doc, edits) };
}

/**
 * Discards every edit: the live document becomes the loaded baseline again, byte for byte — same
 * key order, same explicit `null`s, same unknown keys, because it is literally the same value.
 *
 * Idempotent: once the document **is** the baseline, the model returned is the model passed in
 * (the second reset is a no-op, not a second write).
 */
export function resetQuestDocument(model: QuestDocumentModel): QuestDocumentModel {
  return model.doc === model.baseline ? model : { baseline: model.baseline, doc: model.baseline };
}

/**
 * Adopts the live document as the new baseline — what a successful save means.
 *
 * Without this the guard would fire forever after a save, claiming changes that are already on
 * disk. The baseline advances to the object that was written, not to a re-fetch: `POST
 * /api/quests` answers with the pipeline outcome, not the document (D49(a)).
 */
export function markQuestDocumentSaved(model: QuestDocumentModel): QuestDocumentModel {
  return model.doc === model.baseline ? model : { baseline: model.doc, doc: model.doc };
}

/**
 * Byte equality of two documents, using the app's own write rule so "equal" cannot mean something
 * different from "would be written identically" (key order included).
 *
 * The reference check is the fast path for the unedited session and for the no-op cases above; it
 * is not a behavioural difference (`serializeDoc` of one value equals itself).
 */
export function documentsEqual(a: JsonDocument, b: JsonDocument): boolean {
  return a === b || serializeDoc(a) === serializeDoc(b);
}

/** `true` when leaving now would lose something: the live bytes are not the loaded bytes. */
export function isQuestDocumentDirty(model: QuestDocumentModel): boolean {
  return !documentsEqual(model.baseline, model.doc);
}

/* ------------------------------------------------------------------- the mode */

/**
 * The header Edit button's visible label — the spec's `[Edit]` (docs/spec-ui-design.md L281).
 *
 * One label, two states: the button is a toggle (`aria-pressed`) rather than two buttons, but it
 * never changes its name, so "press Edit" means the same thing in both modes.
 */
export const EDIT_TOGGLE_LABEL = 'Edit';

/** The Edit toggle's tooltip while edit mode is on (pressing it shows the read-only tabs). */
export const EDIT_ON_TOOLTIP = 'Switch to view mode';

/** The Edit toggle's tooltip while edit mode is off. */
export const EDIT_OFF_TOOLTIP = 'Switch to edit mode';

/**
 * `true` when view mode is the **initial** state.
 *
 * The specs draw the toggle but never say which mode a freshly opened quest is in, so this is the
 * story's choice and it is recorded rather than buried: **edit mode is the initial state.**
 *
 * Why: the detail page's whole reason to exist in Phase 3 is editing — six committed tier-1 specs
 * (`quests-detail`, `quests-info-editor`, `quests-goals-editor`, `quests-goal-logic`,
 * `quests-requirements-editor`, `quests-results-editor`, `quests-dialog-editor` and
 * `quests-validation`) pin the editors and the Save gate as what the page shows on load, and view
 * mode is still one click away and still renders the Phase-2 read-only bodies exactly.
 */
export const EDIT_MODE_ON_LOAD = true;

/** The Discard control's label — shown only while the document is dirty. */
export const DISCARD_LABEL = 'Discard';

/** The Discard control's tooltip. */
export const DISCARD_TOOLTIP = 'Discard the unsaved edits and restore the loaded quest';

/* ----------------------------------------------------------- the dirty guard */

/** The guard dialog's heading. */
export const UNSAVED_CHANGES_TITLE = 'Unsaved changes';

/** The guard dialog's body — a navigation attempt with unsaved edits. */
export const UNSAVED_CHANGES_MESSAGE =
  'This quest has unsaved changes. Leaving this page discards them.';

/** The guard dialog's safe action. */
export const UNSAVED_STAY_LABEL = 'Stay';

/** The guard dialog's destructive action: leave the page, discarding the edits. */
export const UNSAVED_LEAVE_LABEL = 'Discard changes';

/**
 * The `beforeunload` prompt's copy. Browsers show their own sentence, so this text is only ever
 * read by an engine that honours `event.returnValue` — it exists so the guard states its reason
 * in one place.
 */
export const UNSAVED_CLOSE_MESSAGE = 'This quest has unsaved changes.';

/* ------------------------------------------------------------------ the save */

/** The Save failure fallback when the server sends no usable message. */
export const SAVE_FAILED_FALLBACK = 'Could not save this quest.';

/** The recovery action of a draft save refused because its file now exists (PR #14 review 3). */
export const OPEN_SAVED_QUEST_LABEL = 'Open the saved quest';

/** The editor's notice when the suggestions read fails (PR #14 review 9f). */
export const SUGGESTIONS_READ_FAILED =
  'Could not load this quest’s suggestions, so none are shown (this is not "nothing to accept").';
