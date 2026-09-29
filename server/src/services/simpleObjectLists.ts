import type { ObjectFileType } from '../../../shared/naming.js';
import {
  CREATURE_SPELLBOOK_FIELDS,
  NPC_DROP_TABLE_FIELDS,
  NPC_INVENTORY_FIELDS,
  NPC_SPELL_INVENTORY_FIELDS,
  TREASURE_CARD_INVENTORY_FIELDS,
  ZONE_TRANSFER_FIELDS,
} from '../../../shared/simpleObjects/index.js';
import {
  nullListElementFindings,
  simpleListElementFieldErrorMap,
  simpleListElementSummary,
} from '../../../shared/simpleObjects/listValidation.js';
import type { SimpleFieldSpec } from '../../../shared/simpleObjects/model.js';
import { ObjectRequestError, type ObjectSaveValidationContext } from './objects.js';
import { isPlainObject } from './sync/json.js';

/**
 * The save validator of the six "one key + one list" families — the final-review F3 guard
 * (`nullListElementFindings`, the rule and its copy in `shared/simpleObjects/listValidation.ts`).
 *
 * This module is **wiring, not rules**, exactly like `dropTables.ts`: the rule is pure and lives
 * in `shared/`, and this is the one place that maps a family to the field inventory the client
 * already renders from, so "which fields are lists" has one home rather than a second hand-list
 * (D59(b)). A family in no row here is left to the generic router's own checks.
 *
 * Why the guard is server-side: only a direct `POST` can produce the shape. The editors'
 * removal is index-addressed and their pickers only append real values, so a null element is
 * unreachable from the UI — while a save writes the loaded document verbatim (D5/D57), so what
 * the API caller sent is what the file gets. Measured: 0 of the 7,851 list values in the five
 * present families are null or of the wrong kind, so no real document is refused.
 *
 * The rejection is the family's **normal 400 field map** (D65): `ObjectRequestError` with
 * `fields` = `simpleListElementFieldErrorMap(findings)` — `DropTableNames[0]` → the sentence,
 * the same shape `dropTables.ts` builds and `routes/objects.ts` puts in the 400 body.
 *
 * The element-**type** difference between the families (a DropTable name is a string, an
 * `Inventory` value a number, a `Teleport` an object) is deliberately not a shared predicate —
 * see the rule module's doc-comment. This guard is the same for every list because it checks
 * presence, not type.
 */

/** A family's own field inventory, as the routing table between a mount and a rule. */
export const SIMPLE_OBJECT_FIELDS: Partial<Record<ObjectFileType, readonly SimpleFieldSpec[]>> = {
  creaturespellbook: CREATURE_SPELLBOOK_FIELDS,
  npcdroptable: NPC_DROP_TABLE_FIELDS,
  npcinventory: NPC_INVENTORY_FIELDS,
  npcspellinventory: NPC_SPELL_INVENTORY_FIELDS,
  treasurecardinventory: TREASURE_CARD_INVENTORY_FIELDS,
  zonetransfer: ZONE_TRANSFER_FIELDS,
};

/**
 * The six families' blocking validation: every element of a list field must be present.
 *
 * A body that is not the documented `{ object }` envelope is left to the generic router's own
 * checks, and a family outside {@link SIMPLE_OBJECT_FIELDS} returns immediately — the same
 * "reports nothing about a body it never saw a document in" contract `validateDropTableSave`
 * carries.
 *
 * @throws {ObjectRequestError} with the per-field error map → the route answers 400.
 */
export function validateSimpleObjectSave(context: ObjectSaveValidationContext): void {
  const fields = SIMPLE_OBJECT_FIELDS[context.config.fileType];
  if (fields === undefined) {
    return;
  }
  const body = context.body;
  if (!isPlainObject(body) || !isPlainObject(body.object)) {
    return;
  }

  const findings = nullListElementFindings(fields, body.object);
  if (findings.length === 0) {
    return;
  }
  throw new ObjectRequestError(
    simpleListElementSummary(findings, context.config.label),
    simpleListElementFieldErrorMap(findings),
  );
}
