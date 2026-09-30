import { AlertTriangle } from 'lucide-react';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { DocPath } from '@shared/document';

import {
  fieldHasError,
  indexFieldMessages,
  pathKey,
  type FieldValidationMessage,
} from '../../lib/validation-message';
import { cn } from '../../lib/utils';

// Re-exported so a host can name the message type from the component it mounts it with.
export type { FieldValidationMessage };

/**
 * `FieldValidation` — the generic inline-message plumbing every editor mounts
 * (story p3-09; [spec-domain-reference.md] L547: "Validation errors shown inline per field
 * (red border + message below). Form-level errors shown as banner at top of form. Save button
 * disabled while validation errors exist.").
 *
 * It lives in `components/shared/` and is **host-agnostic on purpose**, exactly like the
 * requirement-tree, result-list and dialog-list editors (D62(f)): it depends on a structural
 * message shape and no quest hook, no document state and no fetch. A host mounts
 * {@link FieldValidationProvider} once with the messages its own validation produced; a shared
 * editor just asks for the messages at the path it already renders. Without a provider the
 * lookups return nothing.
 *
 * {@link FieldValidationMessage} is that structural shape. It is declared **here** rather
 * than imported from `lib/quest-validation.ts` for the reason the header states: a Phase-4
 * host's findings have a different `kind` vocabulary (`lib/drop-table-validation.ts`), and a
 * component that only reads `severity`/`path`/`field`/`text` must not require the quest
 * union. The quest message type stays assignable to this one (its `kind` is a narrower
 * string), so the quest editors are unchanged.
 *
 * The pieces:
 *
 * | piece | what it does |
 * |---|---|
 * | {@link FieldValidationProvider} | indexes the messages by rendered path and publishes them |
 * | {@link useFieldMessages} | the messages **at** one path — a field's own errors |
 * | {@link useFieldMessagesUnder} | the messages at a path **or any descendant** — a node card's summary |
 * | {@link FieldMessages} | the inline list: a red line per error, an amber warning icon + line per warning |
 * | {@link fieldBorder} | the red/amber border class a control adds to its own classes |
 *
 * The list is a real `<ul>` with one `<li>` per message, each carrying `data-severity`,
 * `data-kind` and `data-field`: a screen reader reads the sentence, and the tier-1 spec can
 * address a specific field's message without depending on a CSS class.
 */

export interface FieldValidationValue {
  /** The messages at exactly one path, in engine order. */
  at: (path: DocPath) => readonly FieldValidationMessage[];
  /** The messages at `path` or any descendant — a node's own plus its fields'. */
  under: (path: DocPath) => readonly FieldValidationMessage[];
}

const EMPTY: readonly FieldValidationMessage[] = [];

const FieldValidationContext = createContext<FieldValidationValue>({
  at: () => EMPTY,
  under: () => EMPTY,
});

/** The rendered path of a message or query, using the one shared formatter. */
function keyOf(path: DocPath): string {
  return pathKey(path);
}

/** `true` when `candidate` is `prefix` or sits below it (`m_goals[0].m_goalName` under `m_goals[0]`). */
function isAtOrUnder(candidate: string, prefix: string): boolean {
  return (
    candidate === prefix || candidate.startsWith(`${prefix}.`) || candidate.startsWith(`${prefix}[`)
  );
}

export function FieldValidationProvider({
  messages,
  children,
}: {
  /** The messages of one validation pass (empty for a document with no findings). */
  messages: readonly FieldValidationMessage[];
  children: ReactNode;
}): JSX.Element {
  const value = useMemo<FieldValidationValue>(() => {
    const index = indexFieldMessages(messages);
    return {
      at: (path) => index.get(keyOf(path)) ?? EMPTY,
      under: (path) => {
        const prefix = keyOf(path);
        const collected: FieldValidationMessage[] = [];
        for (const [key, list] of index) {
          if (isAtOrUnder(key, prefix)) {
            collected.push(...list);
          }
        }
        return collected;
      },
    };
  }, [messages]);

  return (
    <FieldValidationContext.Provider value={value}>{children}</FieldValidationContext.Provider>
  );
}

/** The messages at exactly {@link path}. */
export function useFieldMessages(path: DocPath): readonly FieldValidationMessage[] {
  return useContext(FieldValidationContext).at(path);
}

/** The messages at {@link path} or any of its descendants. */
export function useFieldMessagesUnder(path: DocPath): readonly FieldValidationMessage[] {
  return useContext(FieldValidationContext).under(path);
}

/** `true` when any of {@link paths} has a message: what keeps an Advanced disclosure open. */
export function useAnyFieldMessages(paths: readonly DocPath[]): boolean {
  const { at } = useContext(FieldValidationContext);
  return paths.some((path) => at(path).length > 0);
}

/**
 * The border class a control adds to its own classes for a set of messages: red when any is
 * blocking, amber for warnings only, nothing when there are none. Exported as a function rather
 * than a hook so a control can compute its `className` in the same expression it already uses.
 */
export function fieldBorder(messages: readonly FieldValidationMessage[]): string | null {
  if (messages.length === 0) {
    return null;
  }
  return fieldHasError(messages) ? 'border-red-500' : 'border-amber-500';
}

/**
 * The inline message list for one field, or `null` when the field is clean. Render it directly
 * below the control (L547): the message belongs to the control above it, and `id` is what the
 * control's `aria-describedby` points at.
 */
export function FieldMessages({
  messages,
  id,
  className,
}: {
  messages: readonly FieldValidationMessage[];
  /** The `id` the control's `aria-describedby` names. */
  id?: string;
  className?: string;
}): JSX.Element | null {
  if (messages.length === 0) {
    return null;
  }
  return (
    <ul id={id} aria-label="Validation messages" className={cn('flex flex-col gap-1', className)}>
      {messages.map((message) => (
        <li
          key={`${message.field}:${message.kind}:${message.text}`}
          data-severity={message.severity}
          data-kind={message.kind}
          data-field={message.field}
          className={cn(
            'flex items-start gap-1 text-xs',
            message.severity === 'error' ? 'text-red-400' : 'text-amber-300',
          )}
        >
          {message.severity === 'warning' ? (
            // The AC's warning icon: present for a warning, absent for an error (an error has
            // the red border and the banner instead). `aria-hidden` because the sentence next
            // to it is the accessible content; the icon is the visual shorthand.
            <AlertTriangle
              data-testid="validation-warning-icon"
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400"
              aria-hidden="true"
            />
          ) : null}
          <span>{message.text}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A control's `aria-invalid`, or `undefined` when clean — `undefined` rather than `false` so a
 * clean control carries no attribute at all (the pre-p3-09 DOM).
 */
export function fieldAriaInvalid(messages: readonly FieldValidationMessage[]): boolean | undefined {
  return fieldHasError(messages) ? true : undefined;
}

/**
 * The `aria-describedby` of a control that has messages: the message list's id, or `undefined`
 * when clean (the help text's own id stays the caller's business).
 */
export function fieldDescribedBy(
  messages: readonly FieldValidationMessage[],
  messageId: string,
  helpId?: string,
): string | undefined {
  const ids = [
    ...(messages.length === 0 ? [] : [messageId]),
    ...(helpId === undefined ? [] : [helpId]),
  ];
  return ids.length === 0 ? undefined : ids.join(' ');
}
