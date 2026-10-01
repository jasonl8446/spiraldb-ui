import { resolveTerm, type TermRef } from '@shared/glossary';

import { namePairDistinct } from '../lib/display';
import { cn } from '../lib/utils';

/**
 * `TermLabel` — a glossary term as `Friendly (technical)` (D131, task 7.8).
 *
 * The friendly half comes from `shared/glossary.ts`; the technical half is the document key,
 * class name or enum literal, in a selectable mono span so it can be copied. The wrapper carries
 * `data-term`, the one place a technical string may be visible: the task 7.9 scanner reads visible
 * text outside `[data-term]` subtrees.
 *
 * The pair rule is `display.ts`'s (`namePairDistinct`, D135): a term whose friendly half equals its
 * technical half renders once, and a term with no glossary entry renders its technical half alone
 * (never a humanised guess).
 */
export interface TermLabelProps {
  term: TermRef;
  className?: string;
}

export default function TermLabel({ term, className }: TermLabelProps): JSX.Element {
  const { entry, technical } = resolveTerm(term);
  const friendly = entry?.label;
  const technicalOnly = namePairDistinct(friendly, technical) === technical;
  return (
    <span data-term={technical} className={className}>
      {technicalOnly ? (
        <span className={cn('select-text', friendly === undefined && 'font-mono')}>
          {technical}
        </span>
      ) : (
        <>
          {friendly} (<span className="select-text font-mono">{technical}</span>)
        </>
      )}
    </span>
  );
}
