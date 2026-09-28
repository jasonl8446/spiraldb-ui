import type { DocPath } from '@shared/document';
import { formatDocPath } from '@shared/document';

/**
 * The structural validation-message contract shared by every host's findings — story p4-02's
 * small generalisation of the p3-09 plumbing.
 *
 * `components/shared/FieldValidation.tsx` renders messages, `lib/quest-validation.ts` maps
 * quest findings to them, and `lib/drop-table-validation.ts` maps DropTable findings to them.
 * All three need the same four fields, and none of them needs the other's `kind` vocabulary —
 * so the shape lives here (in `lib/`, to which both components and other `lib/` modules may
 * import) instead of in the quest module or the component.
 *
 * A quest `ValidationMessage` (`client/src/lib/quest-validation.ts`) remains assignable to
 * this type: its `kind` is a narrower string union. A DropTable message carries the
 * DropTable kinds. `kind` is therefore `string` here and the component never interprets it —
 * it only passes it to `data-kind` so a tier-1 spec can address one finding.
 */
export interface FieldValidationMessage {
  severity: 'error' | 'warning';
  /** The finding kind — uninterpreted by the renderer; a host may branch on it. */
  kind: string;
  /** The document path of the offending field — what places the message. */
  path: DocPath;
  /** The same path rendered (`Name`, `m_startGoals[0]`) — the inline/spec-facing key. */
  field: string;
  /** The sentence, from the host's shared copy table. */
  text: string;
}

/** `true` when any message in the list is blocking. */
export function fieldHasError(messages: readonly FieldValidationMessage[]): boolean {
  return messages.some((message) => message.severity === 'error');
}

/**
 * `A, B and C` — an English list of the distinct kinds, in finding order.
 *
 * The banner headlines of both hosts use this (`quest-validation.ts`'s
 * `questBannerModel` and `drop-table-validation.ts`'s `dropTableBannerModel`), and
 * final-deslop found the body sitting in both files byte-for-byte. It lives here, in
 * the module this file's header already declares as the shared plumbing for exactly
 * those two mappers, so the sentence shape has one home.
 */
export function joinKinds(kinds: readonly string[]): string {
  if (kinds.length === 1) {
    return kinds[0];
  }
  return `${kinds.slice(0, -1).join(', ')} and ${kinds[kinds.length - 1]}`;
}

/** Groups messages by their rendered path (the shared `formatDocPath`) — the lookup controls use. */
export function indexFieldMessages(
  messages: readonly FieldValidationMessage[],
): ReadonlyMap<string, readonly FieldValidationMessage[]> {
  const index = new Map<string, FieldValidationMessage[]>();
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

/** The rendered path of a path query, using the one shared formatter. */
export function pathKey(path: DocPath): string {
  return formatDocPath(path);
}

/**
 * The `kind` every server-supplied finding carries (story p5-04's validation summary).
 *
 * The client's own findings have host kinds (`duplicate-name`, `roll-chance-out-of-range`, …);
 * a field-map finding has no engine behind it, so it gets its own kind rather than borrowing
 * one it would then lie about. A host may branch on it — `data-kind` is on every `<li>`.
 */
export const SERVER_FINDING_KIND = 'server';

/**
 * The server's **400 field map** (decisions D64/D65) rendered in the shared message vocabulary,
 * so the form-level validation summary can show it without a second renderer.
 *
 * The keys of that map are already rendered paths — `Name`, `RollChance`, `m_startGoals[0]` —
 * produced by the shared engine's own copy table. They are therefore carried as a **single
 * whole segment**: `formatDocPath(['Name'])` is `Name` and `formatDocPath(['m_startGoals[0]'])`
 * is `m_startGoals[0]`, so a message's lookup key is byte-identical to the server's key and an
 * inline control asking for its own path finds it — without this module re-implementing the
 * path grammar that the server half already decided.
 */
export function fieldMapMessages(
  fields: Readonly<Record<string, readonly string[]>>,
): FieldValidationMessage[] {
  const messages: FieldValidationMessage[] = [];
  for (const [field, texts] of Object.entries(fields)) {
    for (const text of texts) {
      messages.push({
        severity: 'error',
        kind: SERVER_FINDING_KIND,
        path: [field],
        field,
        text,
      });
    }
  }
  return messages;
}

/**
 * The validation summary's copy and anchors (story p5-04, AC3).
 *
 * Declared here rather than in `components/shared/ValidationSummary.tsx` so they are
 * unit-testable in plain node: the tests' tsconfig has no `--jsx`, so importing a `.tsx` module
 * into a node test does not typecheck (and rendering one is what `tests/ui/` is for).
 */
export const VALIDATION_SUMMARY_LABEL = 'Validation summary';
export const VALIDATION_SUMMARY_TESTID = 'validation-summary';

/** `1 validation error must be fixed before saving.` / `3 validation errors must be …`. */
export function validationSummaryHeadline(count: number): string {
  return `${String(count)} validation ${count === 1 ? 'error must' : 'errors must'} be fixed before saving.`;
}

/** `true` when a server field map carries at least one message (and so is worth rendering). */
export function hasFieldMapMessages(
  fields: Readonly<Record<string, readonly string[]>> | undefined,
): fields is Record<string, string[]> {
  return fields !== undefined && Object.keys(fields).length > 0;
}
