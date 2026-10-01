import { createContext, useContext, type ReactNode } from 'react';

import { Button } from '../ui/button';
import type { PreviewTab } from '../../lib/extract';
import {
  confidenceText,
  pendingBySource,
  planSuggestionAccept,
  suggestionTab,
  suggestionValueText,
  SUGGESTION_ACCEPT_LABEL,
  SUGGESTION_APPLIED_LABEL,
  SUGGESTION_REJECT_LABEL,
  type Suggestion,
} from '../../lib/suggestions';

/**
 * The inline suggestions of task 7.7 (docs/spec-ui-design.md §4 "Inline suggestions"; D129, D144,
 * D165).
 *
 * Two surfaces over one channel:
 *
 * - {@link SuggestionsAcceptAll} sits **above the form** (D144): the pending count and one
 *   "Accept all from this source" action per source.
 * - {@link TabSuggestions} sits at the top of the tab that holds each field (D165), one line per
 *   suggestion: `Suggested: <value> · <source> · <confidence> [Accept] [Reject]`.
 *
 * Neither writes. Accept goes through the page's `onAccept` — the document state's own edit — and
 * Reject through `onReject` (`POST /api/suggestions/:id/reject`). The context exists so the tabs'
 * panels need no new prop through `QuestPreview`'s `panels` map, the same reason the evidence
 * focus channel is a context.
 */
export interface SuggestionsChannel {
  /** The draft's pending suggestions, in the server's order (path, source, id). */
  suggestions: readonly Suggestion[];
  /** Ids applied to the in-memory document since the last save or discard. */
  applied: ReadonlySet<number>;
  /** The live document the Accept plans are made against. */
  doc: unknown;
  onAccept: (suggestions: readonly Suggestion[]) => void;
  onReject: (suggestion: Suggestion) => void;
  /** The id whose reject request is in flight, if any. */
  rejecting: number | null;
}

const SuggestionsContext = createContext<SuggestionsChannel | null>(null);

export function SuggestionsProvider({
  value,
  children,
}: {
  value: SuggestionsChannel;
  children: ReactNode;
}): JSX.Element {
  return <SuggestionsContext.Provider value={value}>{children}</SuggestionsContext.Provider>;
}

/** Above the form: the pending count and "Accept all from this source" per source (D144). */
export function SuggestionsAcceptAll(): JSX.Element | null {
  const channel = useContext(SuggestionsContext);
  if (channel === null) {
    return null;
  }
  const groups = pendingBySource(channel.suggestions);
  if (groups.length === 0) {
    return null;
  }
  const pending = groups.reduce((sum, [, list]) => sum + list.length, 0);
  return (
    <section
      aria-label="Suggestions"
      data-testid="suggestions-accept-all"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-600/40 bg-amber-950/20 px-3 py-2"
    >
      <span className="text-sm text-amber-200">
        {pending} pending suggestion{pending === 1 ? '' : 's'} — nothing is written until Save
      </span>
      <span className="ml-auto flex flex-wrap gap-2">
        {groups.map(([source, list]) => {
          // A row whose Reject is in flight is not accepted by "all" either (review 9g).
          const open = list.filter(
            (suggestion) =>
              !channel.applied.has(suggestion.id) && suggestion.id !== channel.rejecting,
          );
          return (
            <Button
              key={source}
              type="button"
              variant="outline"
              size="sm"
              disabled={open.length === 0}
              onClick={() => channel.onAccept(open)}
            >
              Accept all from {source} ({open.length})
            </Button>
          );
        })}
      </span>
    </section>
  );
}

/** At the top of a tab: the pending suggestions whose field this tab holds (D165). */
export function TabSuggestions({ tab }: { tab: PreviewTab }): JSX.Element | null {
  const channel = useContext(SuggestionsContext);
  if (channel === null) {
    return null;
  }
  const mine = channel.suggestions.filter(
    (suggestion) => suggestion.status === 'pending' && suggestionTab(suggestion.path) === tab,
  );
  if (mine.length === 0) {
    return null;
  }
  return (
    <ul
      aria-label={`Suggestions for ${tab}`}
      className="flex flex-col gap-1 border-b border-zinc-800 bg-zinc-950/40 px-4 py-2"
    >
      {mine.map((suggestion) => (
        <SuggestionLine key={suggestion.id} suggestion={suggestion} channel={channel} />
      ))}
    </ul>
  );
}

function SuggestionLine({
  suggestion,
  channel,
}: {
  suggestion: Suggestion;
  channel: SuggestionsChannel;
}): JSX.Element {
  const applied = channel.applied.has(suggestion.id);
  // Accept waits while this row's Reject is in flight (PR #14 review 9g): an accepted id the server
  // is rejecting would be claimed by the next Save and refused.
  const rejecting = channel.rejecting === suggestion.id;
  const plan = planSuggestionAccept(channel.doc, suggestion);
  const reasonId = `suggestion-${suggestion.id}-reason`;
  return (
    <li
      data-testid={`suggestion-${suggestion.id}`}
      data-applied={applied}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
    >
      <span className="font-mono text-xs text-zinc-400">{suggestion.path}</span>
      <span className="min-w-0 text-zinc-200">
        Suggested: <span className="font-mono">{suggestionValueText(suggestion)}</span>
        <span className="text-zinc-400">
          {' '}
          · {suggestion.source} · {confidenceText(suggestion.confidence)}
        </span>
      </span>
      <span className="ml-auto flex items-center gap-2">
        {applied ? (
          <span className="text-xs text-emerald-400">{SUGGESTION_APPLIED_LABEL}</span>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-disabled={plan.kind === 'disabled' || rejecting}
            aria-describedby={plan.kind === 'disabled' ? reasonId : undefined}
            title={plan.kind === 'disabled' ? plan.reason : undefined}
            aria-label={`${SUGGESTION_ACCEPT_LABEL} ${suggestion.path} from ${suggestion.source}`}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={() => {
              if (plan.kind === 'accept' && !rejecting) {
                channel.onAccept([suggestion]);
              }
            }}
          >
            {SUGGESTION_ACCEPT_LABEL}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={rejecting || applied}
          aria-label={`${SUGGESTION_REJECT_LABEL} ${suggestion.path} from ${suggestion.source}`}
          onClick={() => channel.onReject(suggestion)}
        >
          {SUGGESTION_REJECT_LABEL}
        </Button>
      </span>
      {plan.kind === 'disabled' && !applied ? (
        <span id={reasonId} className="w-full text-xs text-zinc-400">
          {plan.reason}
        </span>
      ) : null}
    </li>
  );
}
