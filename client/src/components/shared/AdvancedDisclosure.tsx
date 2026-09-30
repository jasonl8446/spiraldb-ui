import { useEffect, useState, type ReactNode } from 'react';

import { cn } from '../../lib/utils';

/**
 * The one Basic/Advanced disclosure (task 7.11, D132): a native `<details>` labelled
 * `Advanced (n)`, collapsed unless an advanced field holds a value (`mustOpen`) and open — and
 * held open — while one has a validation error (`hasError`), so no value or error is ever hidden.
 * The check is reactive: an error that appears while it is closed opens it. Opening or closing
 * it never touches the document.
 */
export function useAutoOpen(
  mustOpen: boolean,
  hasError: boolean,
  openByDefault = false,
): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(openByDefault || mustOpen || hasError);
  useEffect(() => {
    if (mustOpen || hasError) {
      setOpen(true);
    }
  }, [mustOpen, hasError]);
  return [open || hasError, (next) => setOpen(next || hasError)];
}

export default function AdvancedDisclosure({
  count,
  mustOpen,
  hasError,
  className,
  children,
}: {
  /** How many advanced fields the disclosure holds. */
  count: number;
  /** An advanced field differs from its default. */
  mustOpen: boolean;
  /** An advanced field has a validation message. */
  hasError: boolean;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  const [open, setOpen] = useAutoOpen(mustOpen, hasError);
  return (
    <details
      open={open}
      data-testid="advanced-disclosure"
      className={cn('rounded-md border border-zinc-800 bg-zinc-950/40', className)}
      onToggle={(event) => {
        const details = event.currentTarget;
        if (!details.open && hasError) {
          // An error is showing inside: closing would hide it.
          details.open = true;
          return;
        }
        setOpen(details.open);
      }}
    >
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950">
        Advanced ({count})
      </summary>
      <div className="border-t border-zinc-800 p-3">{children}</div>
    </details>
  );
}
