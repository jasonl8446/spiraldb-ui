import { useQuery } from '@tanstack/react-query';

import {
  CATALOG_LOAD_ERROR,
  CATALOG_LOADING,
  coverageHeadline,
  coveragePercentLabel,
  coverageRatio,
  type QuestCoverage,
} from '../../lib/quest-catalog';
import { getQuestCoverage, QUEST_COVERAGE_QUERY_KEY } from '../../lib/api';
import { cn } from '../../lib/utils';

/**
 * The coverage header — task 6.10 / story **p6-11**
 * ([spec-ui-design.md](../../../docs/spec-ui-design.md) L639-679).
 *
 * One component, mounted by the **Quests list page** and the **Catalog view**, so the two cannot
 * disagree about what coverage reads. It reads the `coverage` view through
 * `GET /api/quests/coverage` (one query key, so both pages share the cache entry) and renders the
 * sentence, the progress label and the bar.
 *
 * **The numbers are text (D85, WCAG 1.4.1).** The sentence and the percentage are rendered as
 * text nodes; the bar is `aria-hidden` decoration, so nothing about the coverage meaning depends
 * on colour or on a glyph. The section carries its own accessible name, so the header is findable
 * by assistive tech without the aria-hidden bar being announced twice.
 *
 * **The number is never a constant.** `coverageHeadline` reads `defined`/`nameable`/`id_space` from
 * the response, and the corpus clause names the path the API resolved — the plan's literal 1,447
 * is the world-named tier, a different quantity (see the module header of `lib/quest-catalog.ts`).
 */
export interface CoverageHeaderProps {
  className?: string;
}

export default function CoverageHeader({ className }: CoverageHeaderProps): JSX.Element {
  const query = useQuery<QuestCoverage>({
    queryKey: QUEST_COVERAGE_QUERY_KEY,
    queryFn: getQuestCoverage,
  });

  const coverage = query.data;
  // One ratio, read by the label **and** the bar. The bar previously re-decided `nameable > 0` for
  // itself while the label went through `coveragePercentLabel`'s own copy of the same guard, so the
  // two could disagree about whether the catalog's numbers mean anything.
  const ratio = coverage === undefined ? null : coverageRatio(coverage.defined, coverage.nameable);
  const percent =
    coverage === undefined ? '' : coveragePercentLabel(coverage.defined, coverage.nameable);

  return (
    <section
      aria-label="Quest coverage"
      data-testid="coverage-header"
      /* `min-w-0` so the section can be narrower than its longest unbreakable word — without it a
         flex item floors at its content width and the page overflows instead of the text wrapping
         (the `responsive.spec.ts` §1 arm measures exactly that, with the real corpus path). */
      className={cn('flex min-w-0 flex-col gap-2', className)}
    >
      {query.isLoading ? (
        <p className="break-words text-sm text-zinc-400" data-testid="coverage-headline">
          {CATALOG_LOADING}
        </p>
      ) : null}

      {query.isError || (!query.isLoading && coverage === undefined) ? (
        <p className="break-words text-sm text-red-400" data-testid="coverage-headline">
          {CATALOG_LOAD_ERROR}
        </p>
      ) : null}

      {coverage !== undefined ? (
        <>
          {/* The sentence contains the corpus's absolute path, which has no spaces: `break-words`
              lets it wrap rather than push the page wider than the viewport. */}
          <p className="break-words text-sm text-zinc-200" data-testid="coverage-headline">
            {coverageHeadline(coverage)}
          </p>
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="h-2 w-full max-w-md overflow-hidden rounded-full bg-zinc-800"
            >
              <div
                className="h-full rounded-full bg-blue-500"
                data-testid="coverage-bar"
                style={{
                  width: ratio === null ? '0%' : `${ratio * 100}%`,
                }}
              />
            </div>
            <span className="text-xs text-zinc-400" data-testid="coverage-percent">
              {percent}
            </span>
          </div>
        </>
      ) : null}
    </section>
  );
}
