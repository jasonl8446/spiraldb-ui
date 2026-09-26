import { cn } from '../../lib/utils';

/**
 * Skeleton primitive — vendored from shadcn/ui (task 1.8 decision D39).
 *
 * Used for the Settings loading state (docs/spec-ui-design.md L523: "Skeleton
 * screens matching content layout").
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn('animate-pulse rounded-md bg-zinc-800', className)} {...props} />;
}

export { Skeleton };
