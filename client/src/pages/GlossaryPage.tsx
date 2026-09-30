import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import {
  GLOSSARY_KINDS,
  glossaryRows,
  matchesGlossaryQuery,
  type GlossaryKind,
} from '../lib/glossary-rows';

const KIND_LABEL: Record<GlossaryKind, string> = {
  field: 'Field',
  class: 'Class',
  enum: 'Enum value',
  group: 'Group',
};

/**
 * `/glossary` (task 7.12, D144) — every term of `shared/glossary.ts`, searchable by either half of
 * `Friendly (technical)` and filterable by kind. Each row is a `data-term` element carrying the
 * label, help, technical name, tier and source. `?term=<technical>` (the popover's "See in
 * glossary" link) seeds the search and highlights that row.
 */
export default function GlossaryPage(): JSX.Element {
  const [params] = useSearchParams();
  const selected = params.get('term') ?? '';
  const [query, setQuery] = useState(selected);
  const [kind, setKind] = useState<GlossaryKind | 'all'>('all');
  const all = useMemo(() => glossaryRows(), []);
  const rows = all.filter(
    (row) => (kind === 'all' || row.kind === kind) && matchesGlossaryQuery(row, query),
  );

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor="glossary-search" className="text-xs text-zinc-400">
            Search by name or technical name
          </label>
          <Input
            id="glossary-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="glossary-kind" className="text-xs text-zinc-400">
            Kind
          </label>
          <select
            id="glossary-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as GlossaryKind | 'all')}
            className="h-9 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <option value="all">All kinds</option>
            {GLOSSARY_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-xs text-zinc-400" role="status" data-testid="glossary-count">
        Showing {rows.length} of {all.length} terms
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li
            key={`${row.kind}:${row.technical}`}
            data-term={row.technical}
            data-kind={row.kind}
            data-selected={row.technical === selected ? 'true' : undefined}
            className="flex min-w-0 flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-900 p-3 data-[selected=true]:border-blue-500"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-zinc-50">{row.label}</span>
              {/* D135: a label that *is* the technical name is shown once, as everywhere else
                (PR #14 review 9j — the 17 collapsed pairs read "Basic Basic" here). */}
              {row.label === row.technical ? null : (
                <span className="select-text break-all font-mono text-xs text-zinc-300">
                  {row.technical}
                </span>
              )}
              <Badge variant="secondary">{KIND_LABEL[row.kind]}</Badge>
              <Badge variant="outline">{row.tier === 'basic' ? 'Basic' : 'Advanced'}</Badge>
            </div>
            <p className="text-sm text-zinc-200">{row.help}</p>
            <p className="break-all text-xs text-zinc-400">
              Source: <span className="select-text font-mono">{row.source}</span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
