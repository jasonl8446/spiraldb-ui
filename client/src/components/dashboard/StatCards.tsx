import { STATUS_META } from '../StatusBadge';
import { Card, CardContent } from '../ui/card';
import { formatPercent, type DashboardCard } from '../../lib/dashboard';
import { cn } from '../../lib/utils';

/**
 * The four stat cards (docs/spec-ui-design.md L135-146, plan task 5.1).
 *
 * `grid-cols-4` desktop / `2` tablet / stacked mobile, per the spec's own line and the
 * phase's breakpoint table (L516-522: tablet 768–1279, desktop ≥1280 — so `md` and
 * `xl`, not `lg`).
 *
 * Each card is the spec's anatomy exactly: `zinc-900` (the `Card` primitive's own
 * surface), the label in `text-sm text-zinc-400`, the number in `text-3xl font-bold`,
 * a status-coloured bar, and the percentage in `text-xs text-zinc-500`.
 *
 * The **Total** card is the one the spec draws differently: it carries "all objects"
 * instead of a bar and a percentage. A bar there would be the Verified card's bar
 * repeated (the only share a total can show), which is why `lib/dashboard.ts` gives
 * that card `percent: null` and this component renders the hint.
 *
 * The bar is `aria-hidden`: it is a second rendering of the percentage text beside it,
 * and the spec's rule is that status is conveyed by colour **and** text (L545) — the
 * text is the accessible half.
 */
export interface StatCardsProps {
  cards: readonly DashboardCard[];
}

export default function StatCards({ cards }: StatCardsProps): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.key}>
          <CardContent className="flex flex-col gap-2 p-5">
            <p className="text-sm text-zinc-400">{card.label}</p>
            {/*
              `data-stat` is the stat card's stable hook, the `data-consolidation`
              precedent: the number is assertable as an exact string without depending
              on the card's surrounding copy. It is the raw integer (never
              locale-formatted), so a spec comparing it to `GET /api/dashboard` needs
              no parsing.
            */}
            <p className="text-3xl font-bold text-zinc-50" data-stat={card.key}>
              {String(card.value)}
            </p>
            {card.key === 'total' ? (
              <p className="text-xs text-zinc-500">{card.hint}</p>
            ) : (
              <>
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-zinc-800"
                  aria-hidden="true"
                >
                  <div
                    className={cn('h-full rounded-full', STATUS_META[card.status].dotClass)}
                    style={{ width: `${String(card.percent)}%` }}
                  />
                </div>
                <p className="text-xs text-zinc-500" data-stat-percent={card.key}>
                  {formatPercent(card.percent)}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
