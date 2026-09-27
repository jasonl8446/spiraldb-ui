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
 * Back/Forward could not move between filters. All eight views now read and write the
 * one param this hook owns (`?filter=Extracted`), through **one** mechanism rather
 * than eight call sites (D51/D76: name the shared unit once): the pure spelling rules
 * live beside the tab vocabulary in `lib/object-list.ts`, and this file is the only
 * React half. `useSearchParams` is the app's **only** query-param call site.
 *
 * Three properties the AC and the pinned route table need:
 *
 * - **The default is absent.** `All` renders no param at all (`objectFilterParam`
 *   returns `null` for it), so `/quests` stays `/quests` — not `/quests?filter=All` —
 *   and `tests/ui/shell.spec.ts`'s pinned path set is untouched. A query suffix
 *   leaves `pathname` alone, so a non-default filter is compatible with it too.
 * - **Push, not replace.** A filter change is a history entry, which is what makes the
 *   browser's Back/Forward move between filters; `replace` would make the param
 *   survive a reload but silently drop the Back half of the requirement.
 * - **Other params are preserved.** The update is written over the previous
 *   `URLSearchParams`, so a future param on these routes is not clobbered.
 *
 * An unknown or absent value parses to `All` (`parseObjectFilter`), so a stale or
 * hand-edited URL still renders a list instead of failing.
 *
 * ## Measured note: the write is a router *transition*, and the URL stays the only source
 *
 * `App.tsx` renders a plain `<BrowserRouter future={{ v7_startTransition: true }}>`, so
 * react-router commits **every** location change inside `React.startTransition`
 * (`react-router-dom/dist/index.js`: `v7_startTransition && startTransitionImpl ?
 * startTransitionImpl(() => setStateImpl(newState)) : setStateImpl(newState)`). Measured
 * consequence: a tab click updates the URL at once (the push is synchronous) while the
 * row set narrows on the transition's schedule, so a reader inspecting the table in the
 * *same* event as the click can still see the previous filter's rows.
 * `setSearchParams(next, { flushSync: true })` does **not** change that — the option is
 * consumed by the data router's `setState`, a path `<BrowserRouter>` never takes
 * (confirmed: with it set, the URL read `?filter=Reviewed` while the first row was still
 * the unfiltered one).
 *
 * This hook therefore keeps the URL as the **single** source of truth and does not shadow
 * it with local state. A mirror whose effect re-derived from the URL was tried: it fixed
 * the same-event read but **broke Back on the object list views** (measured:
 * `/npc-inventories` stayed on the previous filter indefinitely after `goBack()` while the
 * quests page settled correctly) — a duplicated-state hazard of exactly the kind D76 warns
 * about. Anything that needs the narrowed rows awaits the render (`await expect(…)`),
 * which is what the p5-03 specs do.
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
