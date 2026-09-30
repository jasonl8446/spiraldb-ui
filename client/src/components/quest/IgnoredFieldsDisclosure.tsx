import type { ExtractCensus } from '../../lib/api';
import { ignoredByReaderLabel, ignoredCensusRows } from '../../lib/extract';

/**
 * "Ignored by the reader (n)" — the extraction result's census disclosure (task 7.2, D139).
 *
 * Lists every message/field the uploaded capture carries that neither QuestBuilder nor the wrapper
 * reads, so a real capture's gaps are visible on first upload. Native `<details>` for the same reason
 * as the quest editor's Advanced disclosure: it carries the keyboard and screen-reader behaviour.
 * When the census could not run (binary not built, D55) it says so instead of showing nothing, so an
 * empty list is never mistaken for "everything was read".
 */
export default function IgnoredFieldsDisclosure({
  census,
}: {
  census: ExtractCensus | undefined;
}): JSX.Element | null {
  if (census === undefined) {
    return null;
  }

  if ('skipped' in census) {
    return (
      <p className="text-xs text-zinc-400" data-testid="census-skipped">
        Packet census unavailable: {census.skipped}
      </p>
    );
  }

  const ignored = ignoredCensusRows(census);

  return (
    <details
      className="rounded-md border border-zinc-800 bg-zinc-950/40"
      data-testid="ignored-fields"
    >
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950">
        {ignoredByReaderLabel(ignored.length)}
      </summary>
      <div className="border-t border-zinc-800 p-3">
        {ignored.length === 0 ? (
          <p className="text-sm text-zinc-400">
            Every field in this capture ({census.messages} messages) is read.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-zinc-400">
                  <th scope="col" className="pb-1 pr-4 font-medium">
                    Message
                  </th>
                  <th scope="col" className="pb-1 pr-4 font-medium">
                    Field
                  </th>
                  <th scope="col" className="pb-1 text-right font-medium">
                    Messages
                  </th>
                </tr>
              </thead>
              <tbody>
                {ignored.map((row) => (
                  <tr key={`${row.message}.${row.field}`} className="border-t border-zinc-800/60">
                    <td className="py-1 pr-4 font-mono text-xs text-zinc-300">{row.message}</td>
                    <td className="py-1 pr-4 font-mono text-xs text-zinc-300">{row.field}</td>
                    <td className="py-1 text-right tabular-nums text-zinc-400">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}
