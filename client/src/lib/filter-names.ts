/**
 * cmdk option filtering — the client half of decision D8.
 *
 * `items` holds 79,835 rows and cmdk does not virtualize, so an uncapped option
 * list would freeze the (or at least jank) the UI on every keystroke. The rules
 * here are therefore explicit and measured rather than implicit in cmdk:
 *
 * - filter case-insensitively over `"<label> <id>"`, so a typed id finds a row;
 * - return at most `limit` (50) options;
 * - also return the total match count, so the dropdown can say
 *   "showing 50 of 12,431 matches — keep typing" instead of silently lying.
 *
 * Pure and dependency-free: measured by a script against the real synced items
 * list and unit-tested in node.
 */
import type { NameOption } from './display';

/** Options rendered at once. Truncation is reported, never hidden. */
export const MAX_NAME_OPTIONS = 50;

/** One filtered result page. */
export interface NameFilterResult {
  /** The options to render, at most `limit` of them. */
  items: NameOption[];
  /** How many options matched in total (may exceed `items.length`). */
  total: number;
  /** `true` when `total > items.length` — the caller must show the hint. */
  truncated: boolean;
}

/**
 * Filters one type's cached options.
 *
 * An empty query means "show the first page": cmdk's popover always has content,
 * and typing narrows it. Order is the list order (the server already sorts by
 * display column then key, decision D36), so the 50 shown are stable.
 */
export function filterNameOptions(
  options: readonly NameOption[],
  query: string,
  limit: number = MAX_NAME_OPTIONS,
): NameFilterResult {
  const needle = query.trim().toLowerCase();
  const cap = limit > 0 ? limit : 0;

  if (needle === '') {
    const items = cap === 0 ? [] : options.slice(0, cap);
    return { items, total: options.length, truncated: options.length > items.length };
  }

  const items: NameOption[] = [];
  let total = 0;
  for (const option of options) {
    if (!option.keywords.includes(needle)) {
      continue;
    }
    total += 1;
    if (items.length < cap) {
      items.push(option);
    }
  }

  return { items, total, truncated: total > items.length };
}

/** The truncation hint, or `null` when everything matched is already shown. */
export function truncationHint(result: NameFilterResult): string | null {
  if (!result.truncated) {
    return null;
  }
  return `showing ${result.items.length} of ${result.total.toLocaleString('en-US')} matches — keep typing`;
}
