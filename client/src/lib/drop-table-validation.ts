import type { DropTableFindingKind, DropTableValidationResult } from '@shared/dropTable/validation';
import {
  dropTableFindingField,
  dropTableFindingMessage,
  dropTableKindLabel,
} from '@shared/dropTable/validation-messages';

import type { FieldValidationMessage } from './validation-message';
import { joinKinds } from './validation-message';

/**
 * The client-side view model of a DropTable validation pass — plan task 4.2's presentation
 * half (story p4-02; [spec-domain-reference.md] L547).
 *
 * Pure data, no React and no fetch: `DropTableDetailPage` runs the **shared** engine
 * (`shared/dropTable/validation.ts`) with the corpus injected and hands the result here, and
 * this module turns findings into the two things the UI renders — the inline message list per
 * field path ({@link FieldValidationMessage}, the same shape the quest editors use, so the
 * shared `FieldValidation` component places them without knowing what a drop table is), and
 * the form-level banner model.
 *
 * The sentences come from `shared/dropTable/validation-messages.ts` — the one copy table the
 * server's 400 body also uses — and the *path key* comes from the shared `formatDocPath`, so a
 * message the client renders under the `MaxGold` control and the same message in the server's
 * `fields` map cannot be about different fields.
 *
 * There is no warning severity today: all four rules block, so {@link dropTableBannerModel}'s
 * warning headline is always `null`. It is kept because the interface mirrors the quest
 * banner's and a future warn-not-block rule (the spec's L542-546 "references should warn")
 * would land here without touching the renderer.
 */

/** One finding as a message. */
export function toDropTableValidationMessage(
  finding: DropTableValidationResult['findings'][number],
): FieldValidationMessage {
  return {
    severity: finding.severity,
    kind: finding.kind,
    path: finding.path,
    field: dropTableFindingField(finding),
    text: dropTableFindingMessage(finding),
  };
}

/** Every finding, in engine order, as UI messages. */
export function toDropTableValidationMessages(
  result: DropTableValidationResult,
): FieldValidationMessage[] {
  return result.findings.map(toDropTableValidationMessage);
}

/** The form-level banner's model: counts and kind labels, or `null`s when there is nothing to say. */
export interface DropTableBannerModel {
  /** `1 validation error blocks saving: Missing name.` / `3 validation errors block saving: …`. */
  errorHeadline: string | null;
  /** Always `null` today (no DropTable rule warns without blocking). */
  warningHeadline: string | null;
  errorCount: number;
  warningCount: number;
  errorKinds: string[];
}

/**
 * The banner's headline — counts and kinds, never the per-field copy (that is the inline list's job).
 *
 * Both headlines are **count-agreeing**, the same shapes `quest-validation.ts`'s `bannerModel`
 * builds: the singular arm carries the verb's `-s` (`1 validation error blocks saving`) and the
 * plural arm does not (`3 validation errors block saving`). Only the noun was singularised
 * before, so a single blocking finding read `1 validation error block saving` — the sentence a
 * user reads when a save is blocked, inconsistent with the quest editor one page over.
 */
export function dropTableBannerModel(
  messages: readonly FieldValidationMessage[],
): DropTableBannerModel {
  const errors = messages.filter((message) => message.severity === 'error');
  const warnings = messages.filter((message) => message.severity === 'warning');
  const kinds: string[] = [];
  for (const message of errors) {
    // Safe cast: this module is the only producer of DropTable messages, so `kind` is always a
    // `DropTableFindingKind` even though the structural message carries `string` (D62(f)).
    const label = dropTableKindLabel(message.kind as DropTableFindingKind);
    if (!kinds.includes(label)) {
      kinds.push(label);
    }
  }
  return {
    errorHeadline:
      errors.length === 0
        ? null
        : `${errors.length} validation ${errors.length === 1 ? 'error blocks' : 'errors block'} saving: ${joinKinds(kinds)}. Fix them and Save enables again.`,
    warningHeadline:
      warnings.length === 0
        ? null
        : `${warnings.length} ${warnings.length === 1 ? 'warning does not' : 'warnings do not'} block saving.`,
    errorCount: errors.length,
    warningCount: warnings.length,
    errorKinds: kinds,
  };
}
