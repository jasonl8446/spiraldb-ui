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
