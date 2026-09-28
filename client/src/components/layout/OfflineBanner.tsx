import { WifiOff } from 'lucide-react';

/**
 * The persistent offline banner (story p5-04, AC1; spec-ui-design L535).
 *
 * ## The copy is a deliberate, recorded deviation from the spec
 *
 * The spec (L535) gives the sentence **"Connection lost. Changes will be saved locally."** The
 * first sentence is kept verbatim. The second is **not**, because it is false in this
 * application: nothing is queued, buffered or replayed — there is no local persistence layer at
 * all, so a save attempted while the API is unreachable **fails** and the edit is lost. A banner
 * that promises the user their work is safe when it is not is exactly the class of defect this
 * run exists to catch (a UI claiming more than the system does), so the banner says what is
 * true instead: the data on screen may be stale and saving will fail until the server is back.
 *
 * The deviation, its reason and the exact replacement sentence are recorded in
 * `docs/evidence/phase-5/p5-04-d2-surfaces.md` and in the story report.
 *
 * ## Shape
 *
 * `role="alert"` (an outage is the one status a screen-reader user must hear without asking for
 * it) and `aria-live="assertive"` is implied by the role. Not dismissible: the condition is not
 * a notification, and hiding it would hide the fact that saves are failing.
 */

/** The spec's first sentence, verbatim — the part that is true. */
export const OFFLINE_BANNER_TEXT = 'Connection lost.';

/**
 * What replaces the spec's second sentence. States the two consequences the user has to know
 * before clicking Save, and promises nothing the app cannot do.
 */
export const OFFLINE_BANNER_DETAIL =
  'Loaded data may be out of date, and saving will fail until the server is back.';

/** Test/`aria` anchors. */
export const OFFLINE_BANNER_TESTID = 'offline-banner';
export const OFFLINE_BANNER_LABEL = 'Connection status';

export default function OfflineBanner({ offline }: { offline: boolean }): JSX.Element | null {
  if (!offline) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-label={OFFLINE_BANNER_LABEL}
      data-testid={OFFLINE_BANNER_TESTID}
      className="flex items-start gap-2 border-b border-red-500/40 bg-red-950/60 px-4 py-2 text-sm md:px-6"
    >
      <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
      <p className="text-red-200">
        <span className="font-medium">{OFFLINE_BANNER_TEXT}</span>{' '}
        <span className="text-red-300">{OFFLINE_BANNER_DETAIL}</span>
      </p>
    </div>
  );
}
