# p5-03 D2 — one shared URL-param mechanism, and nothing else (story p5-03, plan task 5.3)

## What D1 left to do, and what D2 therefore changed

D1 (`p5-03-d1-audit.md`) found the tab bar already consistent — all eight views render the
same four tabs from one vocabulary, all eight already read their counts from the **list
payload's** `summary` (D49), and all eight already had a per-filter empty state naming the
filter. The one real gap was the AC's **second clause**: both React halves held the filter in a
`useState` initialised to `All`, and nothing in `client/src` read or wrote a query parameter
(`grep -rn "useSearchParams\|searchParams" client/src` → **0 hits**).

So D2 is URL persistence, and only URL persistence.

**It is worth naming the defect plainly rather than filing it as a mechanical addition:** because
no `useSearchParams` existed anywhere in the app, a user's chosen status filter was **thrown away
on every reload, on every browser restart, and could not be reached by Back or Forward** — on all
eight list views, since Phase 2 for quests and Phase 4 for the seven object families. Anyone who
filtered `/quests` to `Extracted`, clicked into a quest and pressed Back landed on the unfiltered
list; anyone who reloaded to see fresh data lost the filter they were working under. That is a
small but real usability defect, and p5-03 is the first story to fix it. It is one mechanism
rather than eight — which is also why the fix is 2 production files + 1 new hook + 2 one-line
changes, not eight bespoke parsers.

## The one home for each half

D51/D76's rule — "name the shared unit once" — splits this into a pure half and a React half:

| half | file | what it owns |
|---|---|---|
| pure (node-testable, D10) | `client/src/lib/object-list.ts` | `OBJECT_FILTER_PARAM` (`'filter'`), `DEFAULT_OBJECT_FILTER` (`'All'`), `parseObjectFilter(value)`, `objectFilterParam(filter)` — the **spelling rules of the tab vocabulary**, sitting beside `OBJECT_FILTERS` which is that vocabulary |
| React | `client/src/hooks/useStatusFilter.ts` (new) | the **only** `useSearchParams` call site in the app; returns `[filter, setFilter]` |
| shell | `client/src/App.tsx` | one line: `v7_startTransition` removed from `<BrowserRouter future={…}>` — see §"The regression" below |

The eight call sites therefore have no parsing of their own: `ObjectListPage.tsx` and
`QuestsPage.tsx` each replaced one `useState(...)` line with `const [filter, setFilter] =
useStatusFilter();`, and the seven object views inherit it through the one shared page component.

### The three properties the AC and the pinned route table need

1. **The default is absent from the URL.** `objectFilterParam('All')` returns `null`, and the hook
   deletes the param rather than writing it — so a default page's URL is the bare path
   (`/quests`, not `/quests?filter=All`). A default spelled into the URL would be history noise
   and would visibly change the app's paths.
2. **A tab click is a push, not a replace.** `setSearchParams` is called without navigate options,
   so each filter is a history entry and the browser's **Back/Forward move between filters** —
   the half of "survives … a back/forward" that `replace` would silently drop (proven by
   falsification B in `p5-03-d3-proof.md`, which fails exactly on the Back arm with
   `Expected: "?filter=Extracted" Received: ""`).
3. **Other params are preserved.** The update is written over the previous `URLSearchParams`, so a
   future param on these routes is not clobbered.

Matching on the way **in** is case-insensitive (`?filter=verified` works — a URL is hand-editable)
while the way **out** is always canonical, so the param can only ever hold
`All|Extracted|Reviewed|Verified`; an absent or unknown value parses to `All`, so a stale bookmark
or a typo still renders a list rather than an error.

**The pinned route table is untouched, and this is why.** `tests/ui/shell.spec.ts:526` pins
`new URL(page.url()).pathname` against `spec-api.md`'s path list; a `?filter=` suffix does not
change a `pathname`, and the default writes no suffix at all — so both the default and a filtered
URL satisfy that pin. `p5-03-d3-proof.md` asserts the suffix-free default explicitly.

## The regression this hook caused, and the two false fixes before the real one

This is D2's most important content, and it is told in full (with the A/B classification and the
router source) in `p5-03-d3-proof.md` §2. In short:

- Making a filter tab click a **navigation** turned a previously synchronous `useState` update into
  a `React.startTransition` one, because `App.tsx` set react-router's `v7_startTransition` — so the
  URL changed at once while the row set committed a render later, and that transient URL/DOM
  disagreement broke `tests/ui/quests-status.spec.ts:95`. **Classification: mine** (A/B against
  `c960cdd`: 13/13 pass there, `:95` fails alone here).
- `setSearchParams(next, { flushSync: true })` was tried and is a **no-op** for a plain
  `<BrowserRouter>`; a local `useState` mirror re-derived from the URL was tried and **broke Back on
  the object list views** (a D76-style duplicated-state hazard). Both rejected, both recorded.
- The fix is the root cause: **drop `v7_startTransition` from the `<BrowserRouter>` future flags**, so
  a location change is consistent with the URL within the same event again. One line in `App.tsx`,
  with the trade (`one warnOnce console.warn per page load`) and the way to flip it back written in
  the comment.

## The accessible vocabulary (unchanged, and re-read for this story)

The AC's first clause is about counts, but the bar's accessibility contract is what a filter
control has to get right, and it is the same on all eight views (it was already correct — D2 is
verified not to have disturbed it):

| element | attribute | value |
|---|---|---|
| the bar | `role="tablist"` + `aria-label` | quests: `Filter quests by status`; objects: `Filter {noun} by status` (`objectFilterLabel`) |
| each tab | `role="tab"`, `aria-selected` | the label plus its count badge as the accessible name (`All 6`, `Verified 1`); `id={prefix}-filter-{Filter}` |
| each tab | `aria-controls` | the results panel's id |
| the results | `role="tabpanel"` + `aria-labelledby` | the **active** tab's id, so the panel is named by the filter it shows |
| active state | visual | `border-blue-500 text-white` + `Badge variant="default"`; inactive `text-zinc-400` (spec L248) |
| focus | visual | `focus-visible:ring-2 focus-visible:ring-blue-500` |

The URL vocabulary is the same set of four words in the same order: `All` (absent),
`Extracted`, `Reviewed`, `Verified`.

## File and line counts

```
$ wc -l client/src/lib/object-list.ts client/src/hooks/useStatusFilter.ts \
        client/src/components/objects/ObjectListPage.tsx client/src/pages/QuestsPage.tsx \
        tests/unit/quests-browse.test.ts tests/ui/status-filter-url.spec.ts
  312 client/src/lib/object-list.ts               (262 → 312; +50, the four param helpers)
   82 client/src/hooks/useStatusFilter.ts          (new, 82 — almost all doc comment)
  360 client/src/components/objects/ObjectListPage.tsx  (350 → 360; +10, 1 code line)
  237 client/src/pages/QuestsPage.tsx              (232 → 237; +5, 1 code line)
  421 tests/unit/quests-browse.test.ts             (367 → 421; +54, 6 new tests)
  343 tests/ui/status-filter-url.spec.ts           (new, 343, 4 arms)

$ git diff c960cdd --stat -- client tests
 client/src/App.tsx                               |  21 +-     (the v7_startTransition fix)
 client/src/components/objects/ObjectListPage.tsx |  14 +-
 client/src/hooks/useStatusFilter.ts              |  82 ++++++
 client/src/lib/object-list.ts                    |  50 ++++
 client/src/pages/QuestsPage.tsx                  |   9 +-
 client/vite.config.ts                            |   4 +-      (the LEAD's port fix, not this story)
 tests/ui/status-filter-url.spec.ts               | 343 +++++++++++++++++++++++
 tests/unit/quests-browse.test.ts                 |  54 ++++
 8 files changed, 570 insertions(+), 7 deletions(-)
```

(`client/vite.config.ts` appears in that range because the lead's `VITE_PORT` fix landed inside the
same span; it is not part of p5-03 and is called out here so the stat is not read as mine.)

`client/src/lib/quests.ts` is **unchanged** — the quest page's tab vocabulary already delegated to
`object-list.ts` (D51/D76), so the URL spelling went into the module it already delegates to. No
second implementation was added for quests, and none for the seven object views.

## Typecheck

```
$ npx tsc -p client/tsconfig.json --noEmit
rc=0
```

## What was deliberately NOT changed, and why

- **The quests tab badges.** They keep counting the list payload (328/327 in the owner's corpus),
  not `GET /api/status/quests` (322/321). The lead ruled on this after D1: repointing them would
  print `Extracted 321` above a table rendering **327** rows — the D49 failure mode. The one
  cross-check disagreement is D82's six missing `entry_status` rows and belongs in the import.
- **The empty states.** Already present on all eight views and already naming the filter (D1's
  audit); D2 touched neither.
- **Search, sort and pagination.** They stay local state. The AC asks the *filter* to survive, not
  the whole view state, and adding four more params would be scope the criterion does not name.
- **`GlobalRegistry`.** Not a list view (D75(a)); nothing to audit, nothing to change.
- **The detail pages' "← Back to Quests" link.** It navigates to the bare `/quests`, so the filter
  is not carried *through* that link. That is outside the AC (a reload and browser Back/Forward are
  what it names, and both work) and is recorded as a note rather than silently widened into.