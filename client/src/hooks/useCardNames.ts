import { useQueries } from '@tanstack/react-query';

import { getName, getNames, nameLookupQueryKey, namesQueryKey } from '../lib/api';
import { cardNamesFromRows, type CardNames } from '../lib/card-titles';
import type { NameRow, NamesType } from '../lib/display';

/**
 * `useCardNames(types, stringKeys)` — the resolved names a card title reads (task 7.10, D178).
 *
 * The bulk tables come through the same `['names', type]` queries `useNames` and the validation pass
 * already run (`staleTime: Infinity`), so a page that mounts cards adds no request the quest page
 * does not already make. `strings` is never bulk-loaded (D39 item 4): each key a title reads is one
 * single lookup, and a miss or an error leaves the key unresolved, which the title renders as its
 * fallback. A table that has not answered yet is absent from the result, so a title degrades and
 * then upgrades in place.
 */
export function useCardNames(
  types: readonly NamesType[],
  stringKeys: readonly string[] = [],
): CardNames {
  const keys = [...new Set(stringKeys)];
  return useQueries({
    queries: [
      ...types.map((type) => ({
        queryKey: namesQueryKey(type),
        queryFn: () => getNames(type),
        staleTime: Infinity,
        gcTime: Infinity,
      })),
      ...keys.map((key) => ({
        queryKey: nameLookupQueryKey('strings', key),
        queryFn: () => getName('strings', key),
        staleTime: Infinity,
        retry: false,
      })),
    ],
    combine: (results) => {
      const rows: { -readonly [T in NamesType]?: NameRow[] } = {};
      types.forEach((type, index) => {
        const data = results[index].data as NameRow[] | undefined;
        if (data !== undefined) {
          rows[type] = data;
        }
      });
      const strings: NameRow[] = [];
      keys.forEach((_key, index) => {
        const data = results[types.length + index].data as NameRow | undefined;
        if (data !== undefined) {
          strings.push(data);
        }
      });
      if (strings.length > 0) {
        rows.strings = strings;
      }
      return cardNamesFromRows(rows);
    },
  });
}
