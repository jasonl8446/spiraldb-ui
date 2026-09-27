import { formatDocPath } from '@shared/document';
import type { TreasureCardFinding, TreasureCardValidationResult } from '@shared/simpleObjects';

import type { FieldValidationMessage } from './validation-message';

/**
 * The client-side view model of a TreasureCardInventory validation pass — story p4-05's
 * presentation half (docs/spec-domain-reference.md L542-547).
 *
 * Pure data, no React and no fetch: `TreasureCardInventoryDetailPage` runs the **shared**
 * engine (`shared/simpleObjects/treasureCardInventory.ts`) with the synced `spells` names
 * injected and hands the result here, so the form renders one inline message per offending row
 * through the shared `FieldValidation` plumbing and the Save gate keeps its single rule
 * (`fieldHasError` → `severity === 'error'`, which a warning never satisfies).
 *
 * ## The sentence lives here, and only one side reads it
 *
 * `shared/dropTable/validation-messages.ts` puts the DropTable sentences in `shared/` because
 * **two** sides must say the same thing: the client's inline text and the server's 400 field
 * map. This family has no server-side claim at all — its only finding is a warning, nothing
 * blocks, so no POST is ever rejected and there is no map to keep in sync. A shared copy table
 * would therefore have one reader; the sentence lives with its one reader, and the engine stays
 * sentence-free (it returns `kind`, `value`, `path`). If a later story needs the same words on
 * the server, they move to `shared/simpleObjects/` in one commit — the same shape as p4-02,
 * which is the honest reason this file is not `shared/`.
 *
 * The **path key** still comes from the shared `formatDocPath`, so the message a tier-1 spec
 * addresses by `data-field` is the document's own path and the inline message is placed by the
 * provider's own lookup (no second parser).
 */

/** The one sentence for a finding. Total over every kind, so a new kind is a type error here. */
export function treasureCardFindingMessage(finding: TreasureCardFinding): string {
  switch (finding.kind) {
    case 'spell-name-not-in-spells':
      return `${finding.detail}. This is a warning, not an error — Save stays enabled and the file can still be saved. Check the spelling, or the name may be a treasure-card variant this family uses.`;
  }
}

/** One finding's rendered path (`TreasureCards[3].SpellName`) — what places it and keys it. */
export function treasureCardFindingField(finding: TreasureCardFinding): string {
  return formatDocPath(finding.path);
}

/** One finding as a UI message. */
export function toTreasureCardValidationMessage(
  finding: TreasureCardFinding,
): FieldValidationMessage {
  return {
    severity: finding.severity,
    kind: finding.kind,
    path: finding.path,
    field: treasureCardFindingField(finding),
    text: treasureCardFindingMessage(finding),
  };
}

/** Every finding, in document order, as UI messages. */
export function toTreasureCardValidationMessages(
  result: TreasureCardValidationResult,
): FieldValidationMessage[] {
  return result.findings.map(toTreasureCardValidationMessage);
}

/** How many of a message list warn (`severity === 'warning'`) — the form banner's own input. */
export function treasureCardWarningCount(messages: readonly FieldValidationMessage[]): number {
  return messages.filter((message) => message.severity === 'warning').length;
}

/**
 * The form-level summary sentence for a warning count, or `null` when there are none.
 *
 * `L547` gives a banner to **errors** (this family has none); a warning summary is the same
 * idea for the opposite severity, and it is what makes 71 inline amber lines legible on the one
 * real file. It never says "blocked" — a warning cannot disable Save — and it is spec-silent,
 * reported as such in the story's evidence. The sentence is a function of the **count**, so the
 * page's result and the form's message list cannot word it differently.
 */
export function treasureCardWarningHeadline(count: number): string | null {
  if (count === 0) {
    return null;
  }
  return `${count} ${count === 1 ? 'row warns' : 'rows warn'} and none of them blocks saving.`;
}

/**
 * The sentence shown instead of the summary when the synced `spells` table was **absent or
 * empty**, so the match never ran (D65(c); the engine reports `referenceUsed: false`). Without
 * it a page whose table has not synced would look like a clean bill of health it did not earn.
 */
export const SPELL_NAMES_NOT_LOADED_NOTE =
  'The synced spells table is not loaded, so spell names were not checked.';
