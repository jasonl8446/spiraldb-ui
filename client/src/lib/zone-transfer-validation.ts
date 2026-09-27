import { formatDocPath } from '@shared/document';
import {
  validateZoneTransfer,
  type ZoneTransferFinding,
  type ZoneTransferValidationResult,
} from '@shared/simpleObjects';

import type { FieldValidationMessage } from './validation-message';

/**
 * The client-side view model of a `ZoneTransfer` validation pass — story p4-06's presentation
 * half (docs/spec-domain-reference.md L542-547, D73(a)).
 *
 * Pure data, no React and no fetch: `/zone-transfers/:name`'s branch in `App.tsx` passes
 * {@link validateZoneTransferDocument} to the generic `ObjectDetailPage` and the **shared**
 * engine (`shared/simpleObjects/zoneTransfer.ts`) runs there, so the form renders one
 * inline message per malformed `m_destinationLoc` through the shared `FieldValidation` plumbing
 * and the Save gate keeps its single rule (`fieldHasError` → `severity === 'error'`, which this
 * family's finding **is**: a malformed location disables Save, L542-546).
 *
 * ## Why the sentence lives here, and not in `shared/`
 *
 * `shared/dropTable/validation-messages.ts` puts the DropTable sentences in `shared/` because
 * **two** sides must say the same thing: the client's inline text and the server's 400 field map.
 * This family has no server-side claim — the shared engine's finding is blocking, but the router
 * mounts without the `validate` seam DropTable alone uses, so no POST is rejected and there is no
 * field map to keep in sync (the p4-05 split, unchanged: L542-547 is about a *form's* Save
 * button). The sentence lives with its one reader and the engine stays sentence-free (it returns
 * `kind`, `value`, `path`, `detail`).
 *
 * The **path key** still comes from the shared `formatDocPath`, so the message a tier-1 spec
 * addresses by `data-field` is the document's own path
 * (`Teleports[1].Teleport.m_destinationLoc`) and the form places it by the provider's own lookup —
 * there is no second parser and no hand-built string.
 */

/** The one sentence for a finding. Total over every kind, so a new kind is a type error here. */
export function zoneTransferFindingMessage(finding: ZoneTransferFinding): string {
  switch (finding.kind) {
    case 'destination-loc-not-four-numbers':
      return `${finding.detail}. The format is four comma-separated numbers and scientific notation counts (e.g. -1.671345E-05 appears in 133 real corpus values), so this is an error: Save is disabled until it is fixed.`;
  }
}

/** One finding's rendered path (`Teleports[1].Teleport.m_destinationLoc`) — what places it. */
export function zoneTransferFindingField(finding: ZoneTransferFinding): string {
  return formatDocPath(finding.path);
}

/** One finding as a UI message. */
export function toZoneTransferValidationMessage(
  finding: ZoneTransferFinding,
): FieldValidationMessage {
  return {
    severity: finding.severity,
    kind: finding.kind,
    path: finding.path,
    field: zoneTransferFindingField(finding),
    text: zoneTransferFindingMessage(finding),
  };
}

/** Every finding, in document order, as UI messages. */
export function toZoneTransferValidationMessages(
  result: ZoneTransferValidationResult,
): FieldValidationMessage[] {
  return result.findings.map(toZoneTransferValidationMessage);
}

/**
 * The whole pass in one call — what `App.tsx`'s `/zone-transfers/:name` branch hands the generic
 * `ObjectDetailPage` as its `validate` prop.
 *
 * Module-level and pure, so it is a **stable reference**: the page's `useMemo(() => validate(doc),
 * [validate, document])` re-runs when the document changes and never because a new closure was
 * created. Because the family needs no injected reference table (there is no zone-path rule), no
 * page component of its own is needed — the p4-05 reason for one (a hook) does not apply here.
 */
export function validateZoneTransferDocument(
  document: Record<string, unknown>,
): readonly FieldValidationMessage[] {
  return toZoneTransferValidationMessages(validateZoneTransfer(document));
}

/** How many of a message list block (`severity === 'error'`) — the form banner's own input. */
export function zoneTransferBlockingCount(messages: readonly FieldValidationMessage[]): number {
  return messages.filter((message) => message.severity === 'error').length;
}

/**
 * The form-level summary sentence for a blocking count, or `null` when there are none.
 *
 * L547 puts a **banner** on the form for errors, and it says what the error does — Save is
 * disabled while it is present — rather than repeating the per-field sentence. It is a small
 * sentence because only an edited document can trip it: **0 of 2,365 real values** fail the
 * format, so no corpus file produces a banner at all.
 */
export function zoneTransferBlockingHeadline(count: number): string | null {
  if (count === 0) {
    return null;
  }
  return `${count} ${count === 1 ? 'destination location is' : 'destination locations are'} not four comma-separated numbers — Save is disabled until ${count === 1 ? 'it is' : 'they are'} fixed.`;
}
