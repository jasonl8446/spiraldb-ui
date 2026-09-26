import { Save } from 'lucide-react';

import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

/**
 * `QuestSaveButton` — the Save affordance whose **disabled state follows validation** (plan
 * task 3.9's AC clause: "Save disabled while validation errors exist"; story p3-09).
 *
 * **The seam, and how story p3-10 closed it.** p3-09 owned the gate, not the pipeline: the button
 * shipped with `data-save-wired="false"` and a single `onSave` prop for 3.10 to fill (D65(f)).
 * The detail page now passes `onSave` (`POST /api/quests` + the toast + the dirty-reset), so the
 * ready-state tooltip says what pressing it does and `data-save-wired` is `"true"`. **The disabled
 * state was not touched:** `blocked` is still the validation engine's own answer and the only
 * thing `aria-disabled` follows — 3.10 must not re-derive it.
 *
 * `aria-disabled` rather than the native `disabled` attribute: it is the convention every other
 * header control already follows (the status actions and Edit), it keeps the button focusable so
 * its `title` and `aria-describedby` still explain the block, and the click handler re-checks
 * the condition so the attribute describes the behaviour instead of being the only guard.
 *
 * The accessible name is the visible `Save`; when blocked, `aria-describedby` points at the
 * banner, so a screen reader reaches the reason.
 */
export const SAVE_LABEL = 'Save';

/** The tooltip a blocked Save shows — the banner carries the details. */
export const SAVE_BLOCKED_TOOLTIP = 'Fix the validation errors listed above before saving.';

/** The tooltip a ready Save shows (story p3-10: the pipeline is behind it). */
export const SAVE_READY_TOOLTIP =
  'Save this quest to SpiralDB: the file, its metadata and one commit.';

/** The tooltip a ready Save shows when no caller wired an action (the seam's other half). */
export const SAVE_UNWIRED_TOOLTIP =
  'Validation allows saving, but no save action is wired to this button.';

export default function QuestSaveButton({
  blocked,
  describedBy,
  onSave,
  className,
}: {
  /** `true` when the document has a blocking finding — the engine's `blocked`. */
  blocked: boolean;
  /** The validation banner's id, so a blocked button explains itself. */
  describedBy?: string;
  /** The save action; the detail page's `POST /api/quests` since story p3-10. */
  onSave?: () => void;
  className?: string;
}): JSX.Element {
  const wired = onSave !== undefined;
  return (
    <Button
      type="button"
      variant="outline"
      aria-disabled={blocked}
      aria-describedby={blocked ? describedBy : undefined}
      title={blocked ? SAVE_BLOCKED_TOOLTIP : wired ? SAVE_READY_TOOLTIP : SAVE_UNWIRED_TOOLTIP}
      data-blocked={blocked}
      data-save-wired={wired}
      className={cn(
        'aria-disabled:cursor-not-allowed aria-disabled:opacity-50',
        blocked ? null : 'border-blue-600/60 text-blue-300 hover:text-blue-200',
        className,
      )}
      onClick={() => {
        if (!blocked && onSave !== undefined) {
          onSave();
        }
      }}
    >
      <Save className="h-4 w-4" aria-hidden="true" />
      {SAVE_LABEL}
    </Button>
  );
}
