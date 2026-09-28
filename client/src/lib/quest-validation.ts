import type { DocPath } from '@shared/document';
import type { QuestFinding, QuestValidationResult } from '@shared/quest/validation';
import { findingField, findingMessage, kindLabel } from '@shared/quest/validation-messages';

import { joinKinds } from './validation-message';

/**
 * The client-side view model of a validation pass — plan task 3.9's presentation half
 * (story p3-09; [spec-domain-reference.md] L547).
 *
 * Pure data, no React and no fetch: `useQuestValidation` runs the engine and hands the result
 * here, and this module turns findings into the three things the UI renders — an inline message
 * list per field path, a form-level banner model, and the boolean the Save affordance follows.
 * The sentences come from `shared/quest/validation-messages.ts` (the one copy table the server's
 * 400 body also uses), and the *path key* comes from the shared `formatDocPath`, so a message
 * the client renders inline and the same message the server returns in its `fields` map cannot
 * be about different fields.
 *
 * The severity split is the engine's own: **only** `error` blocks Save
 * ({@link QuestValidationResult.blocked}); a `warning` is shown and never blocks — the AC's
 * "unknown item ID → warning icon, Save still enabled".
 */

/** One finding as the UI reads it: where it goes, how loud it is, and what it says. */
export interface ValidationMessage {
  severity: 'error' | 'warning';
  kind: QuestFinding['kind'];
  /** The document path of the offending field — what places the message. */
  path: DocPath;
  /** The same path rendered (`m_startGoals[0]`) — the inline/spec-facing key. */
  field: string;
  /** The sentence (`shared/quest/validation-messages.ts`). */
  text: string;
}

/** One finding as a message. */
export function toValidationMessage(finding: QuestFinding): ValidationMessage {
  return {
    severity: finding.severity,
    kind: finding.kind,
    path: finding.path,
    field: findingField(finding),
    text: findingMessage(finding),
  };
}

/** Every finding, in engine order, as UI messages. */
export function toValidationMessages(result: QuestValidationResult): ValidationMessage[] {
  return result.findings.map(toValidationMessage);
}

/** The message list for one path, keyed by the path's rendered form. */
export type ValidationMessageIndex = ReadonlyMap<string, readonly ValidationMessage[]>;

/** Groups messages by their rendered path — the lookup every control uses. */
export function messageIndex(messages: readonly ValidationMessage[]): ValidationMessageIndex {
  const index = new Map<string, ValidationMessage[]>();
  for (const message of messages) {
    const existing = index.get(message.field);
    if (existing === undefined) {
      index.set(message.field, [message]);
    } else {
      existing.push(message);
    }
  }
  return index;
}

/**
 * The minimum a message must carry for the border helpers below: they read severity and
 * nothing else, so any host's message type fits (`components/shared/FieldValidation.tsx`'s
 * `FieldValidationMessage`, a quest `ValidationMessage`, a DropTable message). Deliberately
 * structural rather than the quest type: a Phase-4 host must be able to colour its own
 * controls with the same two classes without importing the quest vocabulary.
 */
export interface SeverityCarrier {
  severity: 'error' | 'warning';
}

/** `true` when any message in the list is blocking. */
export function hasError(messages: readonly SeverityCarrier[]): boolean {
  return messages.some((message) => message.severity === 'error');
}

/**
 * The border class an invalid control takes (L547's "red border" for an error). A warning-only
 * field gets the amber border: the value is worth a look but the save is not blocked, and the
 * two states must not look identical.
 */
export function validationBorderClass(messages: readonly SeverityCarrier[]): string | null {
  if (messages.length === 0) {
    return null;
  }
  return hasError(messages) ? 'border-red-500' : 'border-amber-500';
}

/** A control's classes with the validation border applied when the field has messages. */
export function withValidationBorder(base: string, messages: readonly SeverityCarrier[]): string {
  const border = validationBorderClass(messages);
  return border === null ? base : `${base} ${border}`;
}

/** The form-level banner's model: two headlines, or `null` when there is nothing to say. */
export interface ValidationBannerModel {
  /** `N validation errors block saving: Kind A, Kind B.` — `null` when nothing is blocking. */
  errorHeadline: string | null;
  /** `M warnings: Kind A, Kind B. These do not block saving.` — `null` when there are none. */
  warningHeadline: string | null;
  /** How many findings are blocking. */
  errorCount: number;
  /** How many findings are warnings. */
  warningCount: number;
  /** Distinct blocking kinds, in finding order — the banner's own vocabulary. */
  errorKinds: string[];
  /** Distinct warning kinds, in finding order. */
  warningKinds: string[];
}

/** The distinct kind labels of a message list, in order. */
function distinctKinds(messages: readonly ValidationMessage[]): string[] {
  const kinds: string[] = [];
  for (const message of messages) {
    const label = kindLabel(message.kind);
    if (!kinds.includes(label)) {
      kinds.push(label);
    }
  }
  return kinds;
}

/**
 * The banner's two sentences — **counts and kinds**, never the per-field copy (that is the
 * inline messages' job; the brief asks the banner to summarise rather than repeat).
 */
export function bannerModel(result: QuestValidationResult): ValidationBannerModel {
  const messages = toValidationMessages(result);
  const errors = messages.filter((message) => message.severity === 'error');
  const warnings = messages.filter((message) => message.severity === 'warning');
  const errorKinds = distinctKinds(errors);
  const warningKinds = distinctKinds(warnings);
  return {
    errorCount: errors.length,
    warningCount: warnings.length,
    errorKinds,
    warningKinds,
    errorHeadline:
      errors.length === 0
        ? null
        : `${errors.length} validation ${errors.length === 1 ? 'error blocks' : 'errors block'} saving: ${joinKinds(errorKinds)}.`,
    warningHeadline:
      warnings.length === 0
        ? null
        : `${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}: ${joinKinds(warningKinds)}. Warnings never block saving.`,
  };
}

/**
 * The Save affordance's disabled state: **only** blocking findings, exactly as the engine's
 * `blocked` says. Exported as a named function so the tier-1 spec's "Save still enabled" case
 * has one obvious home, and so nothing in the UI can re-derive it from a warning count.
 */
export function saveBlocked(result: QuestValidationResult): boolean {
  return result.blocked;
}
