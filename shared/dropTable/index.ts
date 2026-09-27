/**
 * The DropTable domain — the field inventory and the four blocking rules (plan task 4.2,
 * story p4-02).
 *
 * | module | contents |
 * |---|---|
 * | `./model.js` | the 16 top-level fields + the 4 item-row fields as data (kind, spec default, measured corpus presence), `canonicalItemId` (the one string↔number conversion), `otherDropTableNames` |
 * | `./validation.js` | the four rules of docs/spec-domain-reference.md L536-540 as structured findings |
 * | `./validation-messages.js` | the one copy table both the client's inline errors and the server's 400 field map use |
 *
 * Usage is the same on both halves of the app, like `shared/quest/index.ts`:
 *
 * ```ts
 * import { validateDropTable, otherDropTableNames } from '@shared/dropTable';
 * ```
 *
 * The server imports the compiled relative path (`shared/dropTable/index.js`) because its
 * tsconfig uses NodeNext; the client and the tests use the `@shared/*` alias. Nothing here
 * imports `zod` (the drop table has no request schema — the generic object router's body
 * contract is two fields wide), so keeping it out of any barrel that does not need it
 * matters less than for quests, but the discipline is the same.
 */

export * from './model.js';
export * from './validation.js';
export * from './validation-messages.js';
