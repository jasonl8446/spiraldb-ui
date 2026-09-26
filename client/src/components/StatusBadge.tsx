import { cn } from '../lib/utils';
import type { StatusValue } from '../lib/api';

/**
 * `StatusBadge` — the verification lifecycle at a glance (task 1.8).
 *
 * Status is conveyed by **colour and text** (docs/spec-ui-design.md L545): the
 * dot is decorative (`aria-hidden`) and the label always says the status word, so
 * the badge still means something without colour vision (WCAG AA, spec L544).
 *
 * The three colours are the spec's status palette (L21-24): extracted amber-500,
 * reviewed blue-500, verified emerald-500.
 */
export const STATUS_META: Record<
  StatusValue,
  { label: string; dotClass: string; textClass: string }
> = {
  extracted: {
    label: 'Extracted',
    dotClass: 'bg-amber-500',
    textClass: 'text-amber-400',
  },
  reviewed: {
    label: 'Reviewed',
    dotClass: 'bg-blue-500',
    textClass: 'text-blue-400',
  },
  verified: {
    label: 'Verified',
    dotClass: 'bg-emerald-500',
    textClass: 'text-emerald-400',
  },
};

export interface StatusBadgeProps {
  status: StatusValue;
  className?: string;
}

export default function StatusBadge({ status, className }: StatusBadgeProps): JSX.Element {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-xs font-medium',
        meta.textClass,
        className,
      )}
      aria-label={`Status: ${meta.label}`}
    >
      <span className={cn('h-2 w-2 shrink-0 rounded-full', meta.dotClass)} aria-hidden="true" />
      {meta.label}
    </span>
  );
}
