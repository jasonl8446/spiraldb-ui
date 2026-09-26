/**
 * Sync-history view helpers (task 1.8, decision D39 items 8-9) — pure, so the
 * Settings page's formatting rules are unit-tested without rendering anything.
 *
 * The shapes come straight from `GET /api/sync/history` (every `sync_history`
 * column) and `GET /api/sync/status`.
 */
import type { SyncHistoryEntry } from './api';
import { formatSyncCounts, type SyncCounts } from './toast';

/**
 * A `sync_history` row's counts in the shape `formatSyncCounts` takes.
 * A failed sync stores `NULL` counts, which render as `0`.
 */
export function historyCounts(row: SyncHistoryEntry): SyncCounts {
  return {
    items: row.items_count ?? 0,
    spells: row.spells_count ?? 0,
    npcs: row.npcs_count ?? 0,
    quests: row.quests_count ?? 0,
    zones: row.zones_count ?? 0,
  };
}

/** `"79,835 items · 18,173 spells · …"` for one history row. */
export function formatHistoryCounts(row: SyncHistoryEntry): string {
  return formatSyncCounts(historyCounts(row));
}

export interface SyncOutcome {
  /** `Success` / `Failed` / `Partial` — never empty, so the badge always reads. */
  label: string;
  /** `true` only for a clean success. */
  ok: boolean;
}

/**
 * Maps a stored sync status to its badge text.
 *
 * Colour is never the only signal: the table renders this label next to a ✓/✗
 * icon (docs/spec-ui-design.md L545).
 */
export function syncOutcome(status: string | null | undefined): SyncOutcome {
  switch (status) {
    case 'success':
      return { label: 'Success', ok: true };
    case 'partial':
      return { label: 'Partial', ok: false };
    case 'failed':
      return { label: 'Failed', ok: false };
    default:
      return {
        label: status === null || status === undefined || status === '' ? 'Unknown' : status,
        ok: false,
      };
  }
}

/**
 * `"Sep 25, 2026 at 3:30 PM"` in the viewer's local timezone, exactly as the
 * settings mockup shows it (docs/spec-ui-design.md L498).
 *
 * `null`/empty → `"Never"` (the graceful first-run state); an unparsable value is
 * rendered as-is rather than as `Invalid Date`.
 */
export function formatLocalTimestamp(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso.trim() === '') {
    return 'Never';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${date.toLocaleDateString('en-US', { dateStyle: 'medium' })} at ${date.toLocaleTimeString(
    'en-US',
    { timeStyle: 'short' },
  )}`;
}
