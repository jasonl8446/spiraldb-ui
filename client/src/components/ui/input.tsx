import * as React from 'react';

import { cn } from '../../lib/utils';

/**
 * Input primitive — vendored from shadcn/ui (task 1.8 decision D39).
 *
 * `rounded-md` (6px) with a `zinc-800` border on a `zinc-950` well, per the
 * spec's surfaces and radii (docs/spec-ui-design.md L27-42).
 */
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'flex h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1 text-sm text-zinc-50 shadow-sm transition-colors placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export { Input };
