import { AlertTriangle, OctagonAlert } from 'lucide-react';

import type { ValidationBannerModel } from '../../lib/quest-validation';
import { cn } from '../../lib/utils';

/**
 * `QuestValidationBanner` — the form-level banner of [spec-domain-reference.md] L547 ("Form-level
 * errors shown as banner at top of form"), story p3-09.
 *
 * It **summarises**: a count and the kinds, never a repeat of every field's sentence — the
 * inline messages under the controls are where the detail lives (the story's brief asks for
 * "count + kinds, not a wall of text"). Two states, visually and semantically distinct:
 *
 * - blocking findings → `role="alert"`, a red border, an alert octagon, and the engine's own
 *   consequence named ("block saving");
 * - warnings only → `role="status"`, an amber border, the warning triangle the AC asks for, and
 *   the sentence "Warnings never block saving" so the affordance's state is not a mystery.
 *
 * A document with no findings renders **nothing** — the absence of the banner is the positive
 * signal, and it keeps a clean quest free of a permanent red box.
 *
 * `id` is what the Save affordance's `aria-describedby` points at, so a keyboard user hears
 * *why* Save is unavailable.
 */
export const VALIDATION_BANNER_ID = 'quest-validation-banner';

/** The banner's accessible name; also the assertion anchor for the tier-1 spec. */
export const VALIDATION_BANNER_LABEL = 'Quest validation';

export default function QuestValidationBanner({
  banner,
  id = VALIDATION_BANNER_ID,
  className,
}: {
  banner: ValidationBannerModel;
  id?: string;
  className?: string;
}): JSX.Element | null {
  if (banner.errorHeadline === null && banner.warningHeadline === null) {
    return null;
  }

  const blocking = banner.errorHeadline !== null;
  return (
    <section
      id={id}
      role={blocking ? 'alert' : 'status'}
      aria-label={VALIDATION_BANNER_LABEL}
      data-blocking={blocking}
      className={cn(
        'flex flex-col gap-1 rounded-md border p-3 text-sm',
        blocking ? 'border-red-500/60 bg-red-950/30' : 'border-amber-500/60 bg-amber-950/20',
        className,
      )}
    >
      {banner.errorHeadline === null ? null : (
        <p className="flex items-start gap-2 font-medium text-red-300">
          <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{banner.errorHeadline}</span>
        </p>
      )}
      {banner.warningHeadline === null ? null : (
        <p className="flex items-start gap-2 text-amber-300">
          <AlertTriangle
            data-testid="validation-warning-icon"
            className="mt-0.5 h-4 w-4 shrink-0"
            aria-hidden="true"
          />
          <span>{banner.warningHeadline}</span>
        </p>
      )}
    </section>
  );
}
