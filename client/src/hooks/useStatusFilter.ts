import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  OBJECT_FILTER_PARAM,
  objectFilterParam,
  parseObjectFilter,
  type ObjectFilter,
} from '../lib/object-list';

/**
 * The list views' status filter, carried in the URL — story p5-03 (plan task 5.3).
 *
 * > *Every list view: four filter tabs … filter survives reload via URL param.*
 *
 * Before this hook both React halves held the filter in a `useState` initialised to
 * `All` (`QuestsPage.tsx`, `ObjectListPage.tsx`), so a hard reload reset it and
 * Back/Forward could not move between filters. All eight views now read and write
 * the one param this hook owns (`?filter=Extracted`), through **one** mechanism
 * rather than eight call sites (D51/D76: name the shared unit once): the pure
 * spelling rules live beside the tab vocabulary in `lib/object-list.ts`, and this
 * file is the only React half.
 *
 * Three properties the AC and the pinned route table need:
 *
 * - **The default is absent.** `All` renders no param at all (`objectFilterParam`
 *   returns `null` for it), so `/quests` stays `/quests` — not `/quests?filter=All`
 *   — and `tests/ui/shell.spec.ts`'s pinned path set is untouched. A query suffix
 *   leaves `pathname` alone, so a non-default filter is compatible with it too.
 * - **Push, not replace.** A filter change is a history entry, which is what makes
 *   the browser's Back/Forward move between filters; `replace` would make the param
 *   survive a reload but silently drop the Back half of the requirement.
 * - **Other params are preserved.** The update is written over the previous
 *   `URLSearchParams`, so a future param on these routes is not clobbered.
 *
 * An unknown or absent value parses to `All` (`parseObjectFilter`), so a stale or
 * hand-edited URL still renders a list instead of failing.
 */
export function useStatusFilter(): [ObjectFilter, (filter: ObjectFilter) => void] {
  const [params, setParams] = useSearchParams();
  const filter = parseObjectFilter(params.get(OBJECT_FILTER_PARAM));

  const setFilter = useCallback(
    (next: ObjectFilter) => {
      setParams((previous) => {
        const updated = new URLSearchParams(previous);
        const value = objectFilterParam(next);
        if (value === null) {
          updated.delete(OBJECT_FILTER_PARAM);
        } else {
          updated.set(OBJECT_FILTER_PARAM, value);
        }
        return updated;
      });
    },
    [setParams],
  );

  return [filter, setFilter];
}
