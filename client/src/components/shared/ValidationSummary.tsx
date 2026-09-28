import { OctagonAlert } from 'lucide-react';

import {
  VALIDATION_SUMMARY_LABEL,
  VALIDATION_SUMMARY_TESTID,
  validationSummaryHeadline,
  type FieldValidationMessage,
} from '../../lib/validation-message';
import { cn } from '../../lib/utils';

/**
 * `ValidationSummary` — the **form-level summary of a multi-error failure** (story p5-04, AC3;
 * spec-ui-design L537: "Validation error: Inline red text below field. Field border turns red.
 * Summary at top of form if multiple errors.").
 *
 * ## What it is for, and how it differs from the existing banners
 *
 * `QuestValidationBanner` and the DropTable/ZoneTransfer banners summarise the **client's own**
 * validation pass, which the editor re-runs on every keystroke — so their findings are already
 * placed inline next to the fields and the banner only counts them.
 *
 * This component exists for the one case where the client has no findings to place: a **server
 * 400 carrying a field map** (D64/D65). The client-side engine cannot know about it — the
 * DropTable duplicate-name rule is the measured example, because only the server holds the
 * corpus — so those findings have no inline home until they are printed, and dropping them
 * (`ApiError` used to carry the message and nothing else) leaves the user with one generic
 * sentence and no idea which field was rejected.
 *
 * It reuses the same vocabulary: the messages are {@link FieldValidationMessage}s
 * (`lib/validation-message.ts`'s `fieldMapMessages` builds them from the wire map), the visual
 * language is the banner's red alert, and each line is `field: sentence` so a field-map key with
 * three messages reads as three lines rather than one run-on.
 *
 * Renders **nothing** when there are no messages: the absence of the box is the positive signal.
 *
 * Its copy and anchors live in `lib/validation-message.ts` (`VALIDATION_SUMMARY_LABEL`,
 * `validationSummaryHeadline`), where they are unit-testable without React or jsx.
 */
export default function ValidationSummary({
  messages,
  className,
}: {
  /** The findings to summarise — normally the ones a failed save returned. */
  messages: readonly FieldValidationMessage[];
  className?: string;
}): JSX.Element | null {
  if (messages.length === 0) {
    return null;
  }

  return (
    <section
      role="alert"
      aria-label={VALIDATION_SUMMARY_LABEL}
      data-testid={VALIDATION_SUMMARY_TESTID}
      data-count={messages.length}
      className={cn(
        'flex flex-col gap-1 rounded-md border border-red-500/60 bg-red-950/30 p-3 text-sm',
        className,
      )}
    >
      <p className="flex items-start gap-2 font-medium text-red-300">
        <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{validationSummaryHeadline(messages.length)}</span>
      </p>
      <ul className="flex flex-col gap-1 pl-6">
        {messages.map((message) => (
          <li
            key={`${message.field}:${message.kind}:${message.text}`}
            data-severity={message.severity}
            data-kind={message.kind}
            data-field={message.field}
            className="text-red-200"
          >
            <span className="font-mono text-xs text-red-300">{message.field}</span>
            {': '}
            <span>{message.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
