import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../../lib/utils';

/**
 * Badge primitive — vendored from shadcn/ui (task 1.8 decision D39).
 *
 * `success` and `warning` are local additions: the verification lifecycle has
 * three status colors (amber-500 / blue-500 / emerald-500,
 * docs/spec-ui-design.md L21-24) and the sync-history table needs a text-carrying
 * success/failure badge, not a border variant.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-950',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-blue-600 text-zinc-50',
        secondary: 'border-transparent bg-zinc-800 text-zinc-200',
        destructive: 'border-transparent bg-red-600 text-zinc-50',
        success: 'border-transparent bg-emerald-600 text-zinc-50',
        warning: 'border-transparent bg-amber-500 text-zinc-950',
        outline: 'border-zinc-700 text-zinc-200',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps): JSX.Element {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
