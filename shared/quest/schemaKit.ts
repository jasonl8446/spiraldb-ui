import { z } from 'zod';

/**
 * Shared Zod building blocks for the quest domain schemas (task 3.1).
 *
 * The two rules every schema in `shared/quest/` follows:
 *
 * 1. **Unknown keys pass through** ({@link passthroughObject}) — decision **D5**
 *    (merge-not-replace). The spec documents a *subset* of what the corpus holds:
 *    `ReqHasEntry` carries 7 fields in all 40 corpus nodes while
 *    [spec-domain-reference.md] L424-426 lists 4, and `NPCDialogEntry` shows 66 distinct
 *    fields while the spec's list is introduced as "50+". A default `z.object()` **strips**
 *    those keys, which would delete legacy data on a save; `.passthrough()` preserves them
 *    verbatim (they are not validated, they are kept).
 * 2. **No default injection** — `NullValueHandling.Ignore` ([spec-domain-reference.md]
 *    L716) means the serializer omits null/undefined, so a missing optional field must stay
 *    missing. Nothing here uses `.default()`, `.catch()` or `.transform()`. Every optional
 *    field is `.nullish()`: absent and explicit `null` are the same "no value" to the loader,
 *    and the corpus uses both forms for the *same* field — `ReqHasEntry.m_displayName` is
 *    `null` on some nodes and a string on others (measured while validating: accepting only
 *    the string form rejected 37 of 322 corpus quests), `NPCDialogEntry.m_nameSTKey` is
 *    `null` in 105 of 1,706 nodes. Whichever form the file used is the form the parse output
 *    keeps; neither is ever rewritten into the other.
 *
 * Types are deliberately wide (`z.string()`, `z.number()`, `z.unknown()`) on fields the
 * spec does not pin down: a wrong *type* may be rejected, an extra *key* never is.
 */

/**
 * `z.object(shape).passthrough()` — the only object builder this story uses.
 *
 * The returned schema keeps every key it does not know about in its output, so
 * `schema.parse(doc)` never loses a field (D5). It does not keep the input's **key order**
 * (known keys are emitted first, then unknown ones): the round-trip guarantee of task 3.2
 * is deep-equality over the original document, which the p3-02 document model keeps and
 * mutates rather than rebuilding from this parse output.
 */
export function passthroughObject<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).passthrough();
}

/**
 * A field whose inner shape this story does not model (spec-silent objects such as
 * `m_behaviors`, `m_missionDoors`, `m_dynaMods`, `m_defaultDialogAnimation`,
 * `m_questEffectInfoList` — all measured as `null` in 322/322 corpus quests). Accepted
 * verbatim and preserved; never replaced by `{}`.
 */
export const opaqueObject = z.record(z.unknown());

/** A preserved array whose element shape is not modelled (`m_dialogEvents`, `m_genericEvents`). */
export const opaqueArray = z.array(z.unknown());
