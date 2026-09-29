import { formatDocPath, type DocPath } from '../document.js';
import type { SimpleFieldKind, SimpleFieldSpec } from './model.js';

/**
 * The **null/absent list-element** rule of the "one key + one list" families — the validation
 * gap the final-review verify pass measured on `NpcDropTable.DropTableNames`: a direct
 * `POST {TemplateID, DropTableNames: [null]}` answered **200** and committed a file carrying
 * `"DropTableNames": [ null ]`.
 *
 * ## Why a null element needs its own rule
 *
 * Every reader in this vocabulary **drops** an element it cannot render
 * (`readNumberList`/`readStringList`, `readTreasureCards`, `readTeleports`, the spell-entry
 * reader): a chip or a row needs a value. But a save writes the **loaded document** verbatim
 * (D5/D57) rather than the rendered list, so a null the reader dropped is still written back as
 * `null`. The editors cannot produce one — removal is index-addressed and the pickers only
 * append real values — so this is an **API-only** shape, and the refusal belongs on the server's
 * `POST`, in the field map the other blocking rules use (D65).
 *
 * ## One rule, both list shapes — and the shape it deliberately does **not** cover
 *
 * The rule is about an element's **presence**, not its type, so it is one implementation for
 * the lists of values (`Inventory` numbers, `DropTableNames` names, `SpellTemplateIds` numbers)
 * and the lists of entries (`Spells`, `TreasureCards`, `Teleports`). What differs between those
 * shapes is the element's **type** — a string, a finite number, an entry object with its own
 * fields — and that difference is **not** forced into a shared predicate here: each family's
 * element type is its own business (and the entry families carry their own rules for the fields
 * an entry holds). A future per-kind type rule belongs beside the family that owns the kind, not
 * in this module.
 *
 * ## The measured corpus cannot be refused by it
 *
 * Measured 2026-09-29 across the five present families (NpcDropTable's directory does not
 * exist): **7,851** list values — 3,785 `Inventory`, 560 `Spells`, 1,267 `SpellTemplateIds`, 71
 * `TreasureCards`, 2,368 `Teleports` — with **0** null/absent elements and **0** elements of the
 * wrong kind. So this guard refuses no real document; `tests/unit/simple-object-list-
 * validation.test.ts` re-measures the same sweep whenever the checkout is on disk.
 *
 * ## What it deliberately leaves alone
 *
 * The **whole field** being `null`/absent/not an array is a different shape: the readers render
 * it as the empty state and D57's "validate, never normalise" keeps it as the file wrote it. This
 * rule fires on elements of a list that **is** an array, and nothing else.
 */

/**
 * The `SimpleFieldKind`s whose value is an array of list elements — the six list controls of the
 * vocabulary. Spelled as data so a family's own field inventory says which fields this rule
 * guards; a new list kind must be added here rather than the guard silently skipping it.
 */
export const SIMPLE_LIST_FIELD_KINDS = [
  /** `NpcInventory.Inventory` — item ids. */
  'item-multi-select',
  /** `NpcDropTable.DropTableNames` — DropTable names. */
  'drop-table-multi-select',
  /** `CreatureSpellbook.SpellTemplateIds` — spell ids, reorderable. */
  'spell-order-list',
  /** `NpcSpellInventory.Spells` — `NPCSpellEntry` objects. */
  'spell-entry-list',
  /** `TreasureCardInventory.TreasureCards` — `{SpellName, Price}` objects. */
  'treasure-card-list',
  /** `WizardZoneData.Teleports` — `{TriggerName, Teleport}` objects. */
  'zone-teleport-list',
] as const satisfies readonly SimpleFieldKind[];

/** `true` when `field` renders a list — the fields this rule reads. */
export function isSimpleListField(field: SimpleFieldSpec): boolean {
  return (SIMPLE_LIST_FIELD_KINDS as readonly SimpleFieldKind[]).includes(field.kind);
}

/** The one finding kind this rule emits. */
export type SimpleListElementFindingKind = 'list-element-null';

/** One offending element, as data — never a sentence. */
export interface SimpleListElementFinding {
  kind: SimpleListElementFindingKind;
  /** The only severity a null element can have: it blocks (the family's normal 400). */
  severity: 'error';
  /** The element's exact path: `['DropTableNames', 0]`. */
  path: DocPath;
  /** The document key of the list, verbatim. */
  key: string;
  /** The element's position in the list — what keys the field map. */
  index: number;
  /** The offending element, verbatim: always `null` (JSON) or `undefined` (in-process). */
  value: unknown;
}

/**
 * Every null/absent element in the document's list fields, in field order then element order.
 *
 * `fields` is the family's own inventory (`NPC_DROP_TABLE_FIELDS`, …), so "which fields are
 * lists" is read from the one place that already states it. A field that is absent, `null`, or
 * not an array produces nothing (see the module doc-comment).
 */
export function nullListElementFindings(
  fields: readonly SimpleFieldSpec[],
  document: Record<string, unknown>,
): SimpleListElementFinding[] {
  const findings: SimpleListElementFinding[] = [];
  for (const field of fields) {
    if (!isSimpleListField(field)) {
      continue;
    }
    const raw = document[field.key];
    if (!Array.isArray(raw)) {
      continue;
    }
    for (let index = 0; index < raw.length; index += 1) {
      const value: unknown = raw[index];
      if (value === null || value === undefined) {
        findings.push({
          kind: 'list-element-null',
          severity: 'error',
          path: [field.key, index],
          key: field.key,
          index,
          value,
        });
      }
    }
  }
  return findings;
}

/** The human name of the finding kind — the 400 `error` line's summary vocabulary. */
export const LIST_ELEMENT_NULL_LABEL = 'Null list element';

/**
 * The one sentence for a finding.
 *
 * It names the offending value and not the path, like every other message table in the project:
 * the field map's *key* is the rendered path (`DropTableNames[0]`), and the client's summary
 * prints `key: sentence`, so a path inside the sentence would duplicate it.
 */
export function simpleListElementMessage(finding: SimpleListElementFinding): string {
  const value = finding.value === undefined ? 'absent' : 'null';
  return `The list element is ${value}. Every element must be present — remove the empty element from the document before saving.`;
}

/** A finding's rendered path — what keys the server's per-field error map. */
export function simpleListElementField(finding: SimpleListElementFinding): string {
  return formatDocPath(finding.path);
}

/**
 * The per-field error map: path key → messages, in finding order. A second null in the same list
 * gets its own key (`DropTableNames[1]`), never a joined string.
 */
export function simpleListElementFieldErrorMap(
  findings: readonly SimpleListElementFinding[],
): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const finding of findings) {
    const field = simpleListElementField(finding);
    const messages = map[field];
    if (messages === undefined) {
      map[field] = [simpleListElementMessage(finding)];
    } else {
      messages.push(simpleListElementMessage(finding));
    }
  }
  return map;
}

/**
 * The `error` sentence for a blocking-findings set — the 400 body's `error` line, mirroring
 * `dropTableBlockingSummary`. `label` is the family's own `ObjectTypeConfig.label`.
 */
export function simpleListElementSummary(
  findings: readonly SimpleListElementFinding[],
  label: string,
): string {
  return `${label} validation failed with ${findings.length} validation ${
    findings.length === 1 ? 'error' : 'errors'
  } (${LIST_ELEMENT_NULL_LABEL}).`;
}
