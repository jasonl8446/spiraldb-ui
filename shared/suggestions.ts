/**
 * The suggestion-source vocabulary (D140) — **one home** for the server's store and the client's
 * Source filter (PR #14 review 9i). Both used to hold their own copy; a source added on one side
 * would have silently dropped out of the other's filter and order.
 */

/** Every source a suggestion may carry (D140), in the order responses list them. */
export const SUGGESTION_SOURCES = [
  'evidence-title',
  'evidence-dialogue',
  'evidence-goals',
  'evidence-location',
  'evidence-requirements',
  'capture-order',
  'capture-rewards',
] as const;

export type SuggestionSource = (typeof SUGGESTION_SOURCES)[number];
