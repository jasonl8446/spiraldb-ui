import { Save } from 'lucide-react';

import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

/**
 * `QuestSaveButton` — the Save affordance whose **disabled state follows validation** (plan
 * task 3.9's AC clause: "Save disabled while validation errors exist"; story p3-09).
 *
 * **The seam with task 3.10, stated in the UI rather than hidden.** This story owns the gate,
 * not the pipeline: the button is `aria-disabled` exactly when a blocking finding exists, and
 * clicking it calls `onSave` **if a caller supplied one**. The detail page supplies none yet, so
 * a ready button explains itself — `title` says saving is wired in task 3.10 — and
 * `data-saved-wired="false"` marks that honestly for the tier-1 spec. 3.10 replaces the no-op
 * with `POST /api/quests`, the toast and the dirty guard; it does not have to re-derive the
 * disabled state.
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

/** The tooltip a ready Save shows until task 3.10 wires the pipeline. */
export const SAVE_UNWIRED_TOOLTIP =
  'Validation allows saving. The save pipeline (file, metadata and commit) arrives in task 3.10.';

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
  /** The save action; omitted until task 3.10 (the documented no-op seam). */
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
      title={blocked ? SAVE_BLOCKED_TOOLTIP : SAVE_UNWIRED_TOOLTIP}
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
