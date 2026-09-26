/**
 * Toast policy (task 1.8, decision D39 item 8; docs/spec-ui-design.md L111-123).
 *
 * Bottom-right corner, stack upward, **max 3 visible**; success auto-dismisses
 * after 5 s, error after 10 s and is click-dismissible, info after 5 s; each type
 * carries its own 4px coloured left border (spec L115-117).
 *
 * The numbers, the message builders and the per-type border accents live here —
 * not inline in components — so they are unit-testable without rendering
 * anything, and so the Settings page and the header Sync button cannot drift
 * apart.
 */

import type { ToastClassnames } from 'sonner';

/** Where sonner renders the stack and how tall it may grow. */
export const TOASTER_POSITION = 'bottom-right' as const;
export const TOASTER_VISIBLE_TOASTS = 3;
export const TOASTER_CLOSE_BUTTON = false;
/** The app is dark-only (spec-ui-design L19). */
export const TOASTER_THEME = 'dark' as const;

/** Auto-dismiss durations in milliseconds (spec L118-121). */
export const TOAST_DURATIONS = {
  success: 5000,
  error: 10000,
  info: 5000,
} as const;

/**
 * How long a **warning** toast stays (story p2-07).
 *
 * The spec defines only the three types above (L115-117); warnings are the
 * extraction UI's addition for the D48(d) duplicate-metadata report, and they
 * re-use the error's 10 s because the message is long and must be readable
 * (`TOAST_ACCENT_CLASSES.warning` already gives them the amber left border).
 * Kept out of {@link TOAST_DURATIONS} so that map still says exactly what the
 * spec fixes.
 */
export const TOAST_WARNING_DURATION_MS = 10000;

/**
 * The toast `type` values sonner can put on an element (`data-type`), i.e. the
 * ones a left-border accent has to cover (spec L115-117: "Success: Green left
 * border … Error: Red left border … Info: Blue left border").
 *
 * `success`/`error`/`info` are reached by `toast.success/error/info`,
 * `loading`/`warning` by `toast.loading`/`toast.warning` and the loading phase of
 * `toast.promise`, and `default` by an untyped `toast()` call — sonner's
 * `dist/index.d.ts` `ToastClassnames` lists exactly these keys.
 */
export type ToastAccentType = 'success' | 'error' | 'info' | 'warning' | 'loading' | 'default';

/** The 4px left edge the spec gives every toast type (spec L115-117). */
export const TOAST_ACCENT_WIDTH = 'border-l-4';

/**
 * The per-type left border, as plain data so it is unit-testable without
 * rendering anything (decision D10) and so Tailwind's content scanner sees the
 * literals — `client/tailwind.config.js` globs `./client/src/**\/*.{ts,tsx}`, and a
 * class that existed only as a runtime-computed string would be purged from the
 * built CSS.
 *
 * `success`/`error`/`info` are the spec's own tokens (emerald-500/red-500/
 * blue-500). `warning`/`loading`/`default` have no colour in the spec; they are
 * filled in from the same palette comment (`client/tailwind.config.js` L4-8)
 * so no sonner type can ever silently fall back to a neutral border.
 */
export const TOAST_ACCENT_CLASSES: Record<ToastAccentType, string> = {
  success: 'border-l-4 border-l-emerald-500',
  error: 'border-l-4 border-l-red-500',
  info: 'border-l-4 border-l-blue-500',
  warning: 'border-l-4 border-l-amber-500',
  loading: 'border-l-4 border-l-zinc-400',
  default: 'border-l-4 border-l-zinc-600',
};

/**
 * Exactly what `<Toaster toastOptions={{ classNames: … }}>` receives, typed
 * against sonner's own `ToastClassnames` so a key that sonner does not read
 * cannot compile.
 *
 * Shape rule: the width sits on `toast` (which sonner adds to every toast) and
 * each type key contributes only its colour, so two colour utilities can never
 * land on the same element — Tailwind would resolve that clash by stylesheet
 * order rather than by this map.
 *
 * `default` is deliberately not wired: sonner's Toaster merges
 * `classNames.default` into *every* toast, typed or not (`dist/index.mjs`:
 * `cn(…, classNames.toast, classNames.default, classNames[type])`), so a colour
 * under that key would sit next to the `success`/`error`/`info` one. Nothing in
 * this app calls the untyped `toast()` — `lib/notify.ts` is the only caller — so
 * untyped toasts keep sonner's own neutral border.
 */
export const TOASTER_CLASS_NAMES = {
  toast: TOAST_ACCENT_WIDTH,
  success: 'border-l-emerald-500',
  error: 'border-l-red-500',
  info: 'border-l-blue-500',
  warning: 'border-l-amber-500',
  loading: 'border-l-zinc-400',
} satisfies ToastClassnames;

/**
 * How long the header Sync button keeps its success checkmark before returning to
 * the idle icon (spec L108: "Shows spinner during sync, checkmark on success").
 */
export const SYNC_SUCCESS_ICON_MS = 2500;

/** Counts returned by `POST /api/sync` (spec-api L239-252). */
export interface SyncCounts {
  items: number;
  spells: number;
  npcs: number;
  quests: number;
  zones: number;
}

/** `79835` → `79,835`; an absent count renders `0` rather than throw. */
function count(value: number | null | undefined): string {
  return (typeof value === 'number' ? value : 0).toLocaleString('en-US');
}

/** `"79,835 items · 18,173 spells · 23,033 NPCs · 322 quests · 1,241 zones"`. */
export function formatSyncCounts(counts: SyncCounts): string {
  return [
    `${count(counts.items)} items`,
    `${count(counts.spells)} spells`,
    `${count(counts.npcs)} NPCs`,
    `${count(counts.quests)} quests`,
    `${count(counts.zones)} zones`,
  ].join(' · ');
}

/** The success toast body for a completed sync (spec L121). */
export function syncSuccessMessage(counts: SyncCounts): string {
  return `Sync complete: ${formatSyncCounts(counts)}`;
}

/** The error toast body for a failed sync — the server's own `{error}` message. */
export function syncErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return `Sync failed: ${error.message}`;
  }
  return 'Sync failed';
}

/** The Settings "Save" success toast. */
export const SETTINGS_SAVED_MESSAGE = 'Settings saved';

/** Settings save failure — again the server's actionable message. */
export function settingsSaveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return `Could not save settings: ${error.message}`;
  }
  return 'Could not save settings';
}

/**
 * The once-only first-startup import toast (decision D37): `GET /api/status/_import`
 * reports what the current server process imported, and the message matches the
 * plan's wording.
 */
export function importSummaryMessage(imported: number): string {
  return `Imported ${count(imported)} existing entries from SpiralDB`;
}
