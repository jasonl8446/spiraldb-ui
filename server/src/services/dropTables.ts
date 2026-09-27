import { otherDropTableNames } from '../../../shared/dropTable/model.js';
import { validateDropTable } from '../../../shared/dropTable/validation.js';
import {
  dropTableBlockingSummary,
  dropTableFieldErrorMap,
} from '../../../shared/dropTable/validation-messages.js';
import { ObjectRequestError, type ObjectSaveValidationContext } from './objects.js';
import { isPlainObject } from './sync/json.js';

/**
 * The DropTable save validator — plan task 4.2's "server-checked against the corpus" half
 * (story p4-02, docs/spec-domain-reference.md L536-540).
 *
 * This module is **wiring, not rules**: the four rules are the shared engine
 * (`shared/dropTable/validation.ts`) that the client form runs too, and this is the one
 * place that injects what only the server has — the corpus, as the D19 index already holds
 * it in memory (no second directory scan; the index was just rebuilt for this save).
 *
 * ## The duplicate rule's identity, and why `body.key` is its input
 *
 * `Name` is a drop table's key, so a plain `"is this Name in the corpus?"` test would 400
 * **every** save of an existing entry against itself. The entry being saved is therefore
 * identified by `body.key` — the route key the client opened, which the form sends back
 * unchanged — and `otherDropTableNames` forgives exactly that one occurrence. The arms:
 *
 * | request | corpus | `body.key` | document `Name` | result |
 * |---|---|---|---|---|
 * | unmodified edit of `X` | `X`,`Y` | `X` | `X` | passes |
 * | edit of `X` renamed onto `Y` | `X`,`Y` | `X` | `Y` | **400** duplicate |
 * | direct POST, no key | `X`,`Y` | — | `X` | **400** duplicate |
 * | direct POST, no key, new name | `X`,`Y` | — | `Z` | passes |
 *
 * The last two rows are why the rule is server-side and not only in the form: a caller that
 * never touched the UI still gets the 400, with the same field map the client renders.
 *
 * ## What a rejection looks like
 *
 * {@link ObjectRequestError} with `fields` = `dropTableFieldErrorMap(blocking)` — `Name`,
 * `RollChance`, `NoneChance` or `MaxGold` → the sentence(s) — which
 * `server/src/routes/objects.ts` puts in the 400 body beside `error` (D65's field-map
 * shape, the same one `QuestRequestError` carries). A body that is not the documented
 * `{ object, notes?, key? }` envelope is left to the generic router's own checks: this
 * validator reports no second message for a body it never saw a document in.
 */
export function validateDropTableSave(context: ObjectSaveValidationContext): void {
  const body = context.body;
  if (!isPlainObject(body) || !isPlainObject(body.object)) {
    return;
  }

  const ownCurrentName = typeof body.key === 'string' && body.key.trim() !== '' ? body.key : null;
  const otherNames = otherDropTableNames(
    context.index.keys(context.config.fileType),
    ownCurrentName,
  );

  const result = validateDropTable(body.object, { otherNames });
  if (!result.blocked) {
    return;
  }
  throw new ObjectRequestError(
    dropTableBlockingSummary(result.blocking),
    dropTableFieldErrorMap(result.blocking),
  );
}
