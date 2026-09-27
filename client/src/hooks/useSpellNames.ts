import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { getNames, namesQueryKey } from '../lib/api';
import type { NameRow, NameRowMap } from '../lib/display';

/**
 * `useSpellNames()` — the synced `spells.name` values the TreasureCardInventory editor's
 * warn-not-block rule matches a document's `SpellName` against (story p4-05, AC#11).
 *
 * The rule is `validateTreasureCardInventory` in `shared/simpleObjects/treasureCardInventory.ts`,
 * which is pure and cannot reach SQLite, so it takes the reference **injected** — the p4-02
 * precedent, and D65(c)'s rule for what an absent table means.
 *
 * ## Why the raw rows, not `useNames`
 *
 * `useNames('spells')` builds the dropdown's option list (`NameOption[]`: an id, a label, a
 * keyword string) for 18,173 rows. This rule needs a **Set of names** — `spells.name`, 4,104
 * distinct values — and the label for a row whose `name` is NULL is the bare `template_id`
 * (`formatNameRow`'s documented fallback), which is not a name and must not enter the set. So
 * this hook reads the same cached query (`namesQueryKey('spells')`, `staleTime: Infinity`, the
 * cache `FriendlyNameDropdown` already fills) and keeps only non-blank `name` values, exactly
 * as `useQuestValidation` keeps ids for the quest reference rules.
 *
 * ## Absent means "no reference table", so the rule is skipped
 *
 * `undefined` in three cases: the query has not answered yet, it failed, or the table is
 * **empty**. D65(c) fixes that reading — an unimported names table (the tier-1 harness boots
 * exactly that database, D44) must not report every row of a real 71-row file as unknown — and
 * the engine implements it: an absent or empty set produces no findings and reports
 * `referenceUsed: false`. The cost is stated rather than hidden: this page loads the 18,173-row
 * `spells` table once per session (it is already in the cache on any page that opened a spell
 * dropdown), and the memo below rebuilds the Set only when the rows change.
 */
export function useSpellNames(): ReadonlySet<string> | undefined {
  const query = useQuery({
    queryKey: namesQueryKey('spells'),
    queryFn: () => getNames('spells'),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  return useMemo(() => {
    const rows = query.data as NameRow[] | undefined;
    if (rows === undefined || rows.length === 0) {
      return undefined;
    }
    const names = new Set<string>();
    for (const row of rows) {
      const name = (row as NameRowMap['spells']).name;
      // A NULL name renders as the bare template id on the dropdown, so it is not a name any
      // document can match; a blank one is refused for the same reason. `staleTime: Infinity`
      // makes the cache the single source, so no normalisation (trim) is applied to the value
      // that *is* kept — the comparison is the literal one the rule documents.
      if (typeof name === 'string' && name.trim() !== '') {
        names.add(name);
      }
    }
    return names.size === 0 ? undefined : names;
  }, [query.data]);
}
