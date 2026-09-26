/**
 * Toast policy (task 1.8, decision D39 item 8; docs/spec-ui-design.md L111-123).
 *
 * Bottom-right corner, stack upward, **max 3 visible**; success auto-dismisses
 * after 5 s, error after 10 s and is click-dismissible, info after 5 s.
 *
 * The numbers and the message builders live here — not inline in components — so
 * they are unit-testable without rendering anything, and so the Settings page and
 * the header Sync button cannot drift apart.
 */

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
