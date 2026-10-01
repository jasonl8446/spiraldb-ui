import type { ReactNode } from 'react';

import { STATUS_META } from '../StatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { formatPercent, TYPE_SECTION_TITLE, type TypeProgressRow } from '../../lib/dashboard';
import { cn } from '../../lib/utils';

/**
 * "Verification Progress by Type" (docs/spec-ui-design.md L149-160, plan task 5.1).
 *
 * One row per tracked type: the label on the left, a segmented bar
 * (extracted/reviewed/verified in amber/blue/emerald) and the right-aligned
 * `verified/total (percent)` — the spec's own example is `157/322 (48.8%)` against
 * `{total: 322, verified: 157}`, so the fraction's numerator is `verified`.
 *
 * All **eight** tracked types are drawn, zeros included, because that is why the
 * endpoint carries zero buckets at all (D37: "all eight singular keys always present
 * (zeros included, so the UI table is stable)"). GlobalRegistry is not among them
 * (Q1) — the row list comes from `DASHBOARD_TYPE_REFS`, which drops the one table row
 * with no `object_type`.
 *
 * Bars are 8px (`h-2`) and `rounded-full`, per the spec. The bar is `aria-hidden`:
 * the fraction and percentage text beside it carry the same information, and the
 * spec's rule is that status is conveyed by colour **and** text (L545).
 */
export interface TypeProgressSectionProps {
  rows: readonly TypeProgressRow[];
  /** Right-aligned in the title row — the dashboard's Rebuild drafts button (D144). */
  action?: ReactNode;
}

export default function TypeProgressSection({
  rows,
  action,
}: TypeProgressSectionProps): JSX.Element {
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        {/* Same heading idiom as `StatusHistoryPanel`: CardTitle is a styled div, so the
            section attaches the heading semantics where it is used. */}
        <CardTitle role="heading" aria-level={2}>
          {TYPE_SECTION_TITLE}
        </CardTitle>
        {action}
      </CardHeader>
      <CardContent className="pt-4">
        <ul className="flex flex-col gap-4" aria-label={TYPE_SECTION_TITLE}>
          {rows.map((row) => (
            <li
              key={row.objectType}
              // The D4 singular type is the row's hook, so a spec can assert one family's
              // fraction and percentage without depending on the label's wording.
              data-type={row.objectType}
              className="flex flex-col gap-1.5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm text-zinc-200">{row.label}</span>
                {/* One text node for the whole fraction, exactly as the spec writes it. */}
                <span className="text-xs text-zinc-400" data-type-summary={row.objectType}>
                  {`${row.fraction} (${formatPercent(row.percent)})`}
                </span>
              </div>
              <div
                className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-800"
                aria-hidden="true"
              >
                {row.segments.map((segment) => (
                  <div
                    key={segment.status}
                    data-segment={segment.status}
                    className={cn('h-full', STATUS_META[segment.status].dotClass)}
                    style={{ width: `${String(segment.percent)}%` }}
                  />
                ))}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
