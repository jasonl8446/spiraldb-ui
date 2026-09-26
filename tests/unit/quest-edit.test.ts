import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import JSON5 from 'json5';
import { describe, expect, it } from 'vitest';

import { applyEdits, serializeDoc, type DocEdit, type JsonDocument } from '@shared/document';
import {
  DISCARD_LABEL,
  documentsEqual,
  EDIT_MODE_ON_LOAD,
  EDIT_TOGGLE_LABEL,
  editQuestDocument,
  isQuestDocumentDirty,
  loadQuestDocument,
  markQuestDocumentSaved,
  resetQuestDocument,
  UNSAVED_CHANGES_TITLE,
  UNSAVED_LEAVE_LABEL,
  UNSAVED_STAY_LABEL,
} from '../../client/src/lib/quest-edit';

/**
 * Story p3-10, D1 — the edit session's model: the baseline, the dirty predicate and the
 * byte-exact reset (plan task 3.10's dirty guard; D5's "keep the parsed original", D57's
 * "validate, never normalise").
 *
 * The four claims the story rests on are asserted directly: an untouched document is not
 * dirty, one edit makes it dirty, `reset` restores the loaded document **byte-identically
 * including key order** (whole-document `JSON.stringify` equality), and a second reset is a
 * no-op.
 *
 * The key-order cases use a real corpus file (`quest_DS-ACAD-C01-003.json`, 36 top-level keys,
 * legacy trailing commas) because key order is exactly what a synthetic three-key object
 * cannot prove.
 */

const FIXTURES = fileURLToPath(new URL('../../server/test/fixtures/', import.meta.url));

/** The real legacy fixture: 36 top-level keys, trailing commas, mixed key order. */
function realQuest(): JsonDocument {
  return JSON5.parse(readFileSync(path.join(FIXTURES, 'quest_DS-ACAD-C01-003.json'), 'utf8'));
}

/** A tiny document whose key order is deliberate and observable. */
function orderedDoc(): JsonDocument {
  return { alpha: 1, m_questName: 'DS-ORDER-001', zeta: null, m_goals: [{ m_goalName: 'g1' }] };
}

describe('the loaded session (D5: keep the parsed original)', () => {
  it('starts clean, holding the same object as both baseline and live document', () => {
    const source = orderedDoc();
    const model = loadQuestDocument(source);

    expect(model.baseline).toBe(source);
    expect(model.doc).toBe(source);
    expect(isQuestDocumentDirty(model)).toBe(false);
  });

  it('refuses a non-document source rather than treating it as an empty one', () => {
    expect(() => loadQuestDocument(undefined)).toThrow(TypeError);
    expect(() => loadQuestDocument('a string')).toThrow(TypeError);
    expect(() => loadQuestDocument(null)).toThrow(TypeError);
  });

  it('is still clean after an edit that produces no edit at all', () => {
    const model = loadQuestDocument(orderedDoc());
    const unchanged = editQuestDocument(model, []);

    // The empty batch is the identity — not a copy that merely compares equal.
    expect(unchanged).toBe(model);
    expect(isQuestDocumentDirty(unchanged)).toBe(false);
  });
});

describe('dirty is a byte comparison, not an "an edit happened" flag', () => {
  it('one edit makes it dirty and leaves the baseline untouched', () => {
    const source = orderedDoc();
    const model = loadQuestDocument(source);
    const before = serializeDoc(source);

    const edited = editQuestDocument(model, [
      { op: 'set', path: ['m_questName'], value: 'DS-ORDER-002' },
    ]);

    expect(isQuestDocumentDirty(edited)).toBe(true);
    expect(edited.doc).not.toBe(source);
    // D5: the primitives never write in place, which is what makes the reset exact.
    expect(edited.baseline).toBe(source);
    expect(serializeDoc(source)).toBe(before);
  });

  it('is clean again when a field is edited back to its loaded value', () => {
    const model = loadQuestDocument(orderedDoc());
    const edited = editQuestDocument(model, [
      { op: 'set', path: ['m_questName'], value: 'DS-ORDER-002' },
    ]);
    const reverted = editQuestDocument(edited, [
      { op: 'set', path: ['m_questName'], value: 'DS-ORDER-001' },
    ]);

    // A different object, the same bytes: leaving now loses nothing, so the guard stays off.
    expect(reverted.doc).not.toBe(model.baseline);
    expect(documentsEqual(reverted.baseline, reverted.doc)).toBe(true);
    expect(isQuestDocumentDirty(reverted)).toBe(false);
    expect(resetQuestDocument(reverted).doc).toBe(model.baseline);
  });

  it('a key deleted and re-added keeps the same values but counts as dirty, because order moved', () => {
    const model = loadQuestDocument(orderedDoc());
    const moved = editQuestDocument(model, [{ op: 'delete', path: ['m_questName'] }]);
    const restored = editQuestDocument(moved, [
      { op: 'set', path: ['m_questName'], value: 'DS-ORDER-001' },
    ]);

    // Same 4 keys, same values — different bytes.
    expect(Object.keys(restored.doc as Record<string, unknown>)).toEqual([
      'alpha',
      'zeta',
      'm_goals',
      'm_questName',
    ]);
    expect(restored.doc).toEqual(model.baseline);
    expect(isQuestDocumentDirty(restored)).toBe(true);
  });
});

describe('reset restores the loaded document byte for byte', () => {
  it('restores the whole real 36-key quest, key order included', () => {
    const source = realQuest();
    const loaded = serializeDoc(source);
    const model = loadQuestDocument(source);

    const edits: DocEdit[] = [
      { op: 'set', path: ['m_questLevel'], value: 42 },
      { op: 'set', path: ['m_questName'], value: 'DS-RENAMED' },
      { op: 'delete', path: ['m_isHidden'] },
    ];
    const edited = editQuestDocument(model, edits);
    expect(isQuestDocumentDirty(edited)).toBe(true);
    expect(serializeDoc(edited.doc)).not.toBe(loaded);

    const reset = resetQuestDocument(edited);
    // The AC's own wording: byte-identical, including key order — over the whole document.
    expect(JSON.stringify(reset.doc)).toBe(JSON.stringify(source));
    expect(serializeDoc(reset.doc)).toBe(loaded);
    expect(isQuestDocumentDirty(reset)).toBe(false);
    expect(reset.baseline).toBe(source);
  });

  it('is idempotent: the second reset is the same model, not a second write', () => {
    const model = loadQuestDocument(orderedDoc());
    const edited = editQuestDocument(model, [{ op: 'set', path: ['alpha'], value: 2 }]);

    const once = resetQuestDocument(edited);
    const twice = resetQuestDocument(once);

    expect(once.doc).toBe(model.baseline);
    expect(twice).toBe(once);
    expect(isQuestDocumentDirty(twice)).toBe(false);
  });

  it('is a no-op on a clean session', () => {
    const model = loadQuestDocument(orderedDoc());
    expect(resetQuestDocument(model)).toBe(model);
  });
});

describe('a save adopts the live document as the baseline', () => {
  it('leaves the session clean after the save, with the written document as the new baseline', () => {
    const model = loadQuestDocument(orderedDoc());
    const edited = editQuestDocument(model, [
      { op: 'set', path: ['m_questName'], value: 'DS-ORDER-002' },
    ]);

    const saved = markQuestDocumentSaved(edited);
    expect(isQuestDocumentDirty(saved)).toBe(false);
    expect(saved.baseline).toBe(edited.doc);
    // …and the edits are still there: a save is not a reset.
    expect((saved.doc as Record<string, unknown>).m_questName).toBe('DS-ORDER-002');
    // Idempotent, like the reset.
    expect(markQuestDocumentSaved(saved)).toBe(saved);
  });

  it('closes the guard window opened by the edit', () => {
    const model = loadQuestDocument(orderedDoc());
    const edited = editQuestDocument(model, [{ op: 'delete', path: ['zeta'] }]);

    expect(isQuestDocumentDirty(edited)).toBe(true);
    expect(isQuestDocumentDirty(markQuestDocumentSaved(edited))).toBe(false);
  });
});

describe('the mode and guard copy is one home', () => {
  it('exposes the strings the header and the tier-1 spec assert', () => {
    expect(EDIT_TOGGLE_LABEL).toBe('Edit');
    expect(DISCARD_LABEL).toBe('Discard');
    expect(UNSAVED_CHANGES_TITLE).toBe('Unsaved changes');
    expect(UNSAVED_STAY_LABEL).toBe('Stay');
    expect(UNSAVED_LEAVE_LABEL).toBe('Discard changes');
    // Recorded choice, not an accident: a freshly opened quest is editable (see the constant's
    // own doc comment for why), and view mode is one click away.
    expect(EDIT_MODE_ON_LOAD).toBe(true);
  });

  it('subject the model to the same primitives the editors use', () => {
    const model = loadQuestDocument(orderedDoc());
    const direct = applyEdits(model.doc, [{ op: 'set', path: ['alpha'], value: 9 }]);
    const throughModel = editQuestDocument(model, [{ op: 'set', path: ['alpha'], value: 9 }]);

    expect(serializeDoc(throughModel.doc)).toBe(serializeDoc(direct));
  });
});
