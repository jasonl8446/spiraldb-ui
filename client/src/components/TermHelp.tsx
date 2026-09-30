import { resolveTerm, type TermRef } from '@shared/glossary';
import { CircleHelp } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

/**
 * `TermHelp` — the "What does this mean?" button beside a label (task 7.12, D131/D144, D180).
 *
 * A Radix popover: Tab reaches the button, Enter/Space opens it, Escape closes it and returns
 * focus. The panel shows the help, the technical name (mono), the source and a "See in glossary"
 * link. It is a **sibling** of the label, never inside it (D180): a button inside a `<label>`,
 * `<summary>`, `<option>` or another button is nested interactive content. A term with no
 * glossary entry renders nothing, since there is no help to show.
 */
export default function TermHelp({ term }: { term: TermRef }): JSX.Element | null {
  const { entry, technical } = resolveTerm(term);
  if (entry === undefined) {
    return null;
  }
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`What does this mean? ${entry.label}`}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-zinc-400 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
      >
        <CircleHelp aria-hidden="true" className="h-4 w-4" />
      </PopoverTrigger>
      <PopoverContent
        className="flex max-w-[calc(100vw-2rem)] flex-col gap-2 text-sm"
        data-testid="term-help"
      >
        <p className="font-medium text-zinc-50">{entry.label}</p>
        <p className="text-zinc-200">{entry.help}</p>
        <p className="text-xs text-zinc-400">
          Technical name:{' '}
          <span data-term={technical} className="select-text font-mono text-zinc-200">
            {technical}
          </span>
        </p>
        <p className="break-all text-xs text-zinc-400">
          Source: <span className="select-text font-mono">{entry.source}</span>
        </p>
        <Link
          to={`/glossary?term=${encodeURIComponent(technical)}`}
          className="text-xs text-blue-400 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          See in glossary
        </Link>
      </PopoverContent>
    </Popover>
  );
}
