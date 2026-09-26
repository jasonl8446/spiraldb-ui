import { AlertTriangle } from 'lucide-react';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { DocPath } from '@shared/document';
import { formatDocPath } from '@shared/document';

import { hasError, messageIndex, type ValidationMessage } from '../../lib/quest-validation';
import { cn } from '../../lib/utils';

/**
 * `FieldValidation` — the generic inline-message plumbing every editor mounts
 * (story p3-09; [spec-domain-reference.md] L547: "Validation errors shown inline per field
 * (red border + message below). Form-level errors shown as banner at top of form. Save button
 * disabled while validation errors exist.").
 *
 * It lives in `components/shared/` and is **host-agnostic on purpose**, exactly like the
 * requirement-tree, result-list and dialog-list editors (D62(f)): it imports a structural
 * message shape and no quest hook, no document state and no fetch. A host mounts
 * {@link FieldValidationProvider} once with the messages its own validation produced; a shared
 * editor just asks for the messages at the path it already renders. Without a provider the
 * lookups return nothing, so a Phase-4 DropTable host that mounts the same editor and has no
 * validation gets the previous behaviour and no crash.
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
  at: (path: DocPath) => readonly ValidationMessage[];
  /** The messages at `path` or any descendant — a node's own plus its fields'. */
  under: (path: DocPath) => readonly ValidationMessage[];
}

const EMPTY: readonly ValidationMessage[] = [];

const FieldValidationContext = createContext<FieldValidationValue>({
  at: () => EMPTY,
  under: () => EMPTY,
});

/** The rendered path of a message or query, using the one shared formatter. */
function keyOf(path: DocPath): string {
  return formatDocPath(path);
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
  messages: readonly ValidationMessage[];
  children: ReactNode;
}): JSX.Element {
  const value = useMemo<FieldValidationValue>(() => {
    const index = messageIndex(messages);
    return {
      at: (path) => index.get(keyOf(path)) ?? EMPTY,
      under: (path) => {
        const prefix = keyOf(path);
        const collected: ValidationMessage[] = [];
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

/** The provider's own value — what a host (or a banner) can read without re-deriving it. */
export function useFieldValidation(): FieldValidationValue {
  return useContext(FieldValidationContext);
}

/** The messages at exactly {@link path}. */
export function useFieldMessages(path: DocPath): readonly ValidationMessage[] {
  return useContext(FieldValidationContext).at(path);
}

/** The messages at {@link path} or any of its descendants. */
export function useFieldMessagesUnder(path: DocPath): readonly ValidationMessage[] {
  return useContext(FieldValidationContext).under(path);
}

/**
 * The border class a control adds to its own classes for a set of messages: red when any is
 * blocking, amber for warnings only, nothing when there are none. Exported as a function rather
 * than a hook so a control can compute its `className` in the same expression it already uses.
 */
export function fieldBorder(messages: readonly ValidationMessage[]): string | null {
  if (messages.length === 0) {
    return null;
  }
  return hasError(messages) ? 'border-red-500' : 'border-amber-500';
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
  messages: readonly ValidationMessage[];
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
export function fieldAriaInvalid(messages: readonly ValidationMessage[]): boolean | undefined {
  return hasError(messages) ? true : undefined;
}

/**
 * The `aria-describedby` of a control that has messages: the message list's id, or `undefined`
 * when clean (the help text's own id stays the caller's business).
 */
export function fieldDescribedBy(
  messages: readonly ValidationMessage[],
  messageId: string,
  helpId?: string,
): string | undefined {
  const ids = [
    ...(messages.length === 0 ? [] : [messageId]),
    ...(helpId === undefined ? [] : [helpId]),
  ];
  return ids.length === 0 ? undefined : ids.join(' ');
}
