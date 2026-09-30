import { useCardNames } from '../../hooks/useCardNames';
import { goalTitleStringKeys } from '../../lib/card-titles';
import type { PreviewTab } from '../../lib/extract';
import { goalsOf } from '../../lib/quest-goal-logic';
import {
  buildQuestOverview,
  NO_REQUIREMENTS,
  NO_REWARDS,
  NO_STEPS,
  type QuestOverview,
} from '../../lib/quest-overview';
import { suggestionTab, type Suggestion } from '../../lib/suggestions';
import DropTableLink from '../shared/DropTableLink';
import { Button } from '../ui/button';
import { usePreviewTabSelect } from './QuestPreview';

/**
 * The Overview tab (task 7.13, D133, D181, spec-ui-design "Overview Tab"): a read-only,
 * plain-language story of the quest. It has no input and never writes; the only control is the
 * pending-suggestion badge, which switches tabs (D144).
 *
 * {@link QuestOverviewView} is the pure rendering (a unit test pins its text); the panel adds the
 * resolved names and the tab switch.
 */

/** The badge's label: `1 suggestion`, `3 suggestions`. */
export function suggestionBadgeText(count: number): string {
  return `${count} suggestion${count === 1 ? '' : 's'}`;
}

/** The tab holding the first pending suggestion's field (D144), or `null` when none is pending. */
export function firstPendingTab(suggestions: readonly Suggestion[]): PreviewTab | null {
  const first = suggestions.find((suggestion) => suggestion.status === 'pending');
  return first === undefined ? null : suggestionTab(first.path);
}

export function QuestOverviewView({
  overview,
  pending,
  onOpenSuggestions,
  dropTables,
}: {
  overview: QuestOverview;
  /** The drop tables the corpus holds; a reward naming one links to its editor (D187). */
  dropTables?: ReadonlyMap<string, string>;
  /** The pending suggestion count; `0` renders no badge. */
  pending: number;
  onOpenSuggestions?: () => void;
}): JSX.Element {
  return (
    <section aria-label="Quest overview" className="flex flex-col gap-4 text-sm text-zinc-200">
      {pending > 0 ? (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="overview-suggestions-badge"
            onClick={onOpenSuggestions}
          >
            {suggestionBadgeText(pending)}
          </Button>
        </div>
      ) : null}
      <p data-testid="overview-giver">{overview.giver}</p>
      <div>
        <h3 className="font-medium text-zinc-100">Steps</h3>
        <p className="text-xs text-zinc-400" data-testid="overview-order">
          {overview.order}
        </p>
        {overview.steps.length === 0 ? (
          <p className="mt-1">{NO_STEPS}</p>
        ) : (
          <ol className="mt-1 flex flex-col gap-1" data-testid="overview-steps">
            {overview.steps.map((step) => (
              <li key={step.number}>
                {step.number}. {step.title}
                {step.when === '' ? null : <span className="text-zinc-400"> — {step.when}</span>}
                {step.goalName === null ? null : (
                  <span className="ml-2 font-mono text-xs text-zinc-400">{` · ${step.goalName}`}</span>
                )}
              </li>
            ))}
          </ol>
        )}
        {overview.stepNotes.map((note) => (
          <p key={note} className="mt-1 text-xs text-amber-300">
            {note}
          </p>
        ))}
      </div>
      <div>
        <p data-testid="overview-completes">{overview.completes}</p>
        <p className="text-zinc-400">{overview.completionDialog}</p>
      </div>
      <div>
        <h3 className="font-medium text-zinc-100">Requires</h3>
        {overview.requirements.length === 0 ? (
          <p>{NO_REQUIREMENTS}</p>
        ) : (
          <ul data-testid="overview-requirements">
            {overview.requirements.map((line, index) => (
              <li key={index} style={{ paddingLeft: `${line.depth * 1.25}rem` }}>
                {line.text}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="font-medium text-zinc-100">Rewards</h3>
        {overview.rewards.length === 0 ? (
          <p>{NO_REWARDS}</p>
        ) : (
          <ul data-testid="overview-rewards">
            {overview.rewards.map((reward, index) => {
              const table = overview.rewardDropTables[index];
              return (
                <li key={index}>
                  {table !== null && table !== undefined && reward.endsWith(table) ? (
                    <>
                      {reward.slice(0, reward.length - table.length)}
                      <DropTableLink name={table} known={dropTables?.has(table) === true} />
                    </>
                  ) : (
                    reward
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/** The live tab: the document, its resolved names and the quest's suggestions. */
export default function QuestOverviewPanel({
  doc,
  suggestions,
}: {
  doc: unknown;
  suggestions: readonly Suggestion[];
}): JSX.Element {
  const names = useCardNames(
    ['npcs', 'spells', 'zones', 'quests', 'drop_tables'],
    goalsOf(doc).flatMap(goalTitleStringKeys),
  );
  const selectTab = usePreviewTabSelect();
  const pending = suggestions.filter((suggestion) => suggestion.status === 'pending');
  const target = firstPendingTab(suggestions);
  return (
    <QuestOverviewView
      overview={buildQuestOverview(doc, names)}
      pending={pending.length}
      dropTables={names.drop_tables}
      onOpenSuggestions={target === null ? undefined : () => selectTab?.(target)}
    />
  );
}
