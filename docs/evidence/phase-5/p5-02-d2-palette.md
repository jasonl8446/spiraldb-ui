# p5-02 D2 — the ⌘K / Ctrl+K search palette (story p5-02, plan task 5.2)

## What was built

| file | change |
|---|---|
| `client/src/components/layout/SearchPalette.tsx` | new, 255 lines: the dialog over `ui/command.tsx` + `ui/dialog.tsx`, the one `GET /api/search?q=&limit=20` read, the five states, the rows |
| `client/src/lib/search.ts` | new, 208 lines: the palette's pure half (copy, row identity, click-through, state ladder, sentences, the ⌘K predicate) |
| `client/src/lib/api.ts` | +85: `SEARCH_DEFAULT_LIMIT`, `SearchResultRow` / `SearchGroup` / `SearchResponse`, `SEARCH_QUERY_KEY`, `searchQueryKey`, `searchPath`, `searchObjects` |
| `client/src/components/layout/Header.tsx` | +35: the header trigger (⌘K hint), `HeaderProps.onOpenSearch` |
| `client/src/components/layout/AppLayout.tsx` | +25: the palette is mounted in the shell (every route), with the ⌘K/Ctrl+K listener |
| `tests/unit/search-ui.test.ts` | new, 242 lines / 16 tests (node, D10) |

**No new dependency**: `cmdk@^1.1.1` was already there and `ui/command.tsx` is its vendored
wrapper (D39). `CommandDialog` stays unvendored — the palette composes the same `ui/dialog.tsx`
Radix shell the mobile navigation overlay uses, which is what brings the focus trap,
Escape-to-close and the scroll lock.

## The rules and where they live (D10)

Everything the palette decides is a plain function in `lib/search.ts`, asserted in node:
`searchResultKey`, `searchResultHref`, `searchResultSecondary`, `searchPaletteState`,
`searchEmptyMessage`, `unresolvedSearchMessage`, `truncatedSearchMessage`, `searchErrorMessage`,
`isSearchShortcut`. The component moves state and pixels.

```
$ npx vitest run tests/unit/search-ui.test.ts
 ✓ tests/unit/search-ui.test.ts (16 tests) 10ms
      Tests  16 passed (16)
$ npx tsc -p client/tsconfig.json --noEmit     # rc=0
```

## The click-through reuses the one existing mapping — nothing was written twice

`lib/search.ts`'s `searchResultHref(row)` calls **`activityHref`** (the D4 resolver in
`lib/dashboard.ts`, which itself calls `lib/objects.ts`'s `objectDetailPath` for the seven generic
families and builds `/quests/:name` for the one route outside `shared/objectTypes.ts`), and the
unit suite asserts the two agree **row for row** over eight shapes. There is no second
`object_type → route` table in the client, and a row the endpoint sends with `object_type: null`
resolves to `null` — "no page to open" — rather than to an invented route.

**What stayed behind:** the mapping itself, unchanged, in `lib/dashboard.ts`
(`activityHref`) and `lib/objects.ts` (`objectDetailPath`). `lib/search.ts` adds a name for the
call, nothing else; deleting `activityHref` breaks the dashboard feed and the palette together.

The dots are **`StatusDot`** from `components/objects/ObjectTable.tsx` — the very component the
list pages use (spec L256 "color dot only"), so a search row's dot, its colour class and its
sr-only "Status: Reviewed" cannot drift from a list row's. A routeless row renders a reserved
equal-width spacer instead, so the text of a dotless row aligns with a dotted one.

## The accessible-name vocabulary (the tier-1 spec addresses all of it)

| surface | name | how it is produced |
|---|---|---|
| header trigger | `Search all objects` | `aria-label`; the visible "Search" and the `⌘K` hint are `aria-hidden`, so the name cannot drift and the visible label still satisfies WCAG 2.5.3 |
| dialog | `Search all objects` | Radix `role="dialog"` + `DialogTitle` (`sr-only`); a `sr-only` `DialogDescription` is present so Radix's "missing description" warning cannot fire |
| input | `Search query` | cmdk's own `<label>` from `Command`'s `label` prop — which is why the input carries **no** `aria-label` (`aria-labelledby` would win anyway) |
| results list | `Search results` | `CommandList`'s `aria-label` |
| each group | `Quests`, `Drop Tables`, `Items`, … | the endpoint's own `label`, set as the cmdk group heading; cmdk wires it to the group's `aria-labelledby` |
| each row | `<label> <friendly name?> <status label?> [— not linked]` | the option's text, with `StatusDot`'s `sr-only` supplying the status word |
| states | `Searching…` (`role="status"`), the server's message (`role="alert"`), the idle hint, `No results for “q”.` | `data-search-loading` / `data-search-error` / `data-search-idle` / `data-search-empty` |

Data hooks: `[data-search-result]` (the row's identity from `searchResultKey`),
`[data-search-group]`, `[data-search-unresolved]`, `[data-search-truncated]`.

## The states, and the two decisions inside them

`idle → loading → error → empty → ready`, one ladder in `lib/search.ts`:

- **idle** — an open palette with nothing typed calls the endpoint **not at all**
  (`enabled: open && trimmed !== ''`), so opening the palette scans nothing. The unit test
  asserts the state; the tier-1 spec asserts that **zero** `/api/search` requests were made.
- **error before empty** — an errored query has no data, and a no-results sentence printed over a
  failed request is the criterion's own failure mode. The spec's 500 arm proves the palette shows
  the server's message and **not** the friendly empty state.
- closing **forgets the query**, so reopening never shows a stale result set.
- **no debounce**: the endpoint's local latency is 14–32 ms end to end (D3), so a debounce would
  add a timing window to every keystroke test and buy nothing. Recorded rather than assumed.

A friendly-name hit is rendered **non-navigable**: no dot, the `— not linked` suffix (the
dashboard feed's own words for the same fact), the count printed above the results from the
endpoint's `unresolved`, and an `onSelect` that does nothing. The row is **not** `disabled` — a
`disabled` cmdk item leaves the keyboard's tab order of the list, and the whole point of showing
it is that a user can read it.

## Hermetic proof (D3's part (a), reported here because it is this file's spec)

`tests/ui/search-palette.spec.ts`, 546 lines / 7 arms, all green on the alt-port harness:

```
$ PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers \
    npx playwright test --config tests/ui/p4-10-altport.config.ts tests/ui/search-palette.spec.ts
  ✓ 1 the header trigger opens it from the dashboard and from another route (2.1s)
  ✓ 2 Ctrl+K opens it, and typing returns both example results grouped by type with their dots (482ms)
  ✓ 3 sends limit=20 with every query (490ms)
  ✓ 4 selecting a result lands on its detail page, and the palette closes (1.3s)
  ✓ 5 a friendly-name hit says it is not linked, and the count is printed (548ms)
  ✓ 6 the no-results state renders, and a failure is not mistaken for it (1.7s)
  ✓ 7 closing forgets the query, and the keyboard shortcut is ⌘K/Ctrl+K only (1.1s)
  7 passed (9.1s)
```

The spec mocks **every** endpoint it touches with one dispatcher, **records any path it did not
mock and answers it 404**, and asserts at the end of each arm that nothing was unmocked. That
guard paid for itself immediately: the first run failed with
`["GET /api/status/npc_inventories/87112/history", "GET /api/status/quests/DS-ACAD-C01-001/history"]`
— the two detail pages' shared status panels — which are now mocked. That is D81's rule made
mechanical, and it is the same class of defect gate-4 caught on `shell.spec.ts`.

## The live check that found a real accessibility defect (and what it was)

The bespoke browser pass (D23's "look at it") read the rendered accessibility tree rather than
trusting the code, and the listbox came back named **"Suggestions"** — not the `Search results`
the code appeared to set:

```
ARIA snapshot: listbox "Suggestions" [ref=e270]
```

**Cause, measured in `cmdk`'s source:** `CommandList` destructures `{ children, label =
"Suggestions", ...c }` and then renders `{...c, role: "listbox", "aria-label": label}` — the
primitive's own `aria-label` is applied **after** the caller's props are spread, so an
`aria-label` passed to `CommandList` is silently discarded. The fix is to pass cmdk's own prop
(`label="Search results"`), the tier-1 spec now asserts the list's accessible name for exactly
that reason, and the component carries the reason inline. This is the class of defect a
data-hook-only assertion cannot see: every functional arm passed *before* the fix.

**Geometry, measured on the same live pass** (1440×900, the built client against the real
corpus): dialog `672 × 416` at `(384, 242)` — i.e. exactly the intended 26 rem, centred, fully
inside the viewport, with `scrollHeight == clientHeight` (no internal overflow); the results list
`375` tall with `scrollHeight 392` (it scrolls by 17 px and does not clip); **zero** descendants
sticking out horizontally; and a row's dot and its monospace label share a vertical centre
(`331.2` both) — the status column aligns the way a list row's does.

Screenshots (both saved through playwright-mcp into `~/.cache/playwright-mcp` and copied here, D38):
`p5-02-d2-palette-results.png` (`DS-ACAD-C01-00` → the Quests and Drop Tables groups with their
dots) and `p5-02-d2-palette-notlinked.png` (`obsidian` → the quest row matched on its title with
a dot, the item rows with `— not linked`, and the count notice). The readback that produced them,
at the wire against the real corpus:

```
notice: "43 results have no page to open — they are friendly names in tables without a detail
         view, so they are shown without links."
rows:   object:quest:DS-NEC2-C01-009     "Status: ExtractedDS-NEC2-C01-009Obsidian in Crystal"  (dot)
        name:item:4                      "Obsidian Amulet— not linked"                          (no dot)
        name:item:1421077                "Obsidian Beak— not linked"                             (no dot)
```
## The header trigger does not break the 375 px layouts (measured, not eyeballed)

The trigger adds one icon-sized button to a flex row whose title is
`min-w-0 flex-1 truncate`, so the header should absorb it — and that is checked by an existing
assertion rather than by my reading of the CSS. `tests/ui/object-mobile.spec.ts` (story p4-10)
asserts, for every family's list and detail route, that the **document** has no horizontal
overflow:

```ts
expect(measured.scrollWidth).toBeLessThanOrEqual(measured.clientWidth);   // line 507
```

Both full tier-1 runs of this story (`p5-02-executor-gate.txt` §7, `p5-02-uish-full.txt`) passed **all
313 arms**, that assertion included, with the trigger in the header — so the new button fits at
375 px on every route that spec walks. Task 5.6 owns the responsive pass proper; this is the
side-effect check that keeps this story from being a regression it did not measure.
