# p5-03 D3 — the proof, the regression it caught, and the gate (story p5-03, plan task 5.3)

## 1. The hermetic tier-1 spec

`tests/ui/status-filter-url.spec.ts` (new, 343 lines, 4 arms). **Every endpoint both pages touch is
fulfilled from a fixture (D81)** — the run reaches neither the dev stack's SQLite file nor the
developer's corpus, so it is valid where CI has no `QuestTemplates/`:

| surface | mocked routes |
|---|---|
| shell boot (both surfaces) | `GET /api/settings`, `GET /api/sync/status`, `GET /api/sync/history`, `GET /api/status/_import` |
| NpcInventory list | `GET /api/npc-inventories` (6-row fixture: 3 extracted / 2 reviewed / 1 verified) and `GET /api/status/npc_inventories` |
| quests list | `mockQuestsApi` (whose default fixture is 45/120/157 of 322, the spec's own example) plus its `GET /api/status/quests` |
| deliberately unmocked | nothing: the palette's `GET /api/search` is `enabled: open && q !== ''` so a closed palette issues no request, and no edit form is opened, so no `POST`/names read happens |

The two status routes are registered to **count hits and must stay at `0`**: the badges are counted
from the **list payload's own `summary`** (D49), so a status request from either page would mean the
count had silently moved to the other derivation. Each of the four arms asserts that explicitly.

### What each arm proves, against the AC's three clauses

| arm | four tabs + counts | filter → subset | URL param + hard reload | default clean | Back/Forward | per-filter empty state |
|---|---|---|---|---|---|---|
| `NPC inventory list › four tabs …across a reload` | `All 6 / Extracted 3 / Reviewed 2 / Verified 1` | `Reviewed` → `Showing 1-2 of 2`, link `1004` visible, `1001` gone; `Extracted` → `1-3 of 3`; `Verified` → `1-1 of 1` | `/npc-inventories?filter=Reviewed` then `page.reload()` re-asserts the 2-row set and `aria-selected` | `searchOf(page) === ''` and `toHaveURL(/\/npc-inventories$/)` | `Extracted` → `Verified` → `goBack()` → `?filter=Extracted` + `1-3 of 3` | — |
| `NPC inventory list › a per-filter empty state …` | `Verified 0` | — | cold load `?filter=Verified` (read on mount, not only after a click) | — | — | `No Verified NPC inventories found.` + the hint + `Showing 0-0 of 0`; then `All` → `No NPC inventories found.` |
| `quest list › four tabs …across a reload` | `All 322 / Extracted 45 / Reviewed 120 / Verified 157` | `Reviewed` → `1-50 of 120`; `Verified` → `1-50 of 157`; `Extracted` → `1-45 of 45` | `/quests?filter=Reviewed` + `page.reload()` | `searchOf(page) === ''`, `toHaveURL(/\/quests$/)` | `Extracted` → `Verified` → `goBack()` → `?filter=Extracted` + `1-45 of 45` | — |
| `quest list › a per-filter empty state …` | — | — | cold load `?filter=Verified` | — | — | `No Verified quests found.` + the hint + `Showing 0-0 of 0`; then `All` → `No quests found.` |

Counts are literals copied from the spec's own mockup / `docs/spec-api.md` rather than imported from
the client modules the page reads — a fixture that imported them could only prove the client agrees
with itself.

## 2. THE REGRESSION THIS STORY CAUSED, AND THE FIX (the most important section here)

**Classification: mine, not pre-existing — and the lead's `quests-status.spec.ts:95` failure was
this, not a flake.** A/B measurement, reverting **only** my four production files to `c960cdd` (the
lead's port fix kept, so the harness boots):

```
$ ... npx playwright test tests/ui/quests-status.spec.ts      # pre-story tree (my 4 files reverted)
  13 passed (14.3s)                                           # incl. :95
$ ... npx playwright test tests/ui/quests-status.spec.ts      # my tree
  1 failed — quests-status.spec.ts:95                          # the :95 arm, alone
```

### Root cause, read out of the router and then measured

`App.tsx` renders a plain `<BrowserRouter future={{ v7_startTransition: true }}>`, and
`BrowserRouter` commits **every** history-listener update inside `React.startTransition`:

```js
// node_modules/react-router-dom/dist/index.js (BrowserRouter's own listener)
let setState = React.useCallback(newState => {
  v7_startTransition && startTransitionImpl ? startTransitionImpl(() => setStateImpl(newState)) : setStateImpl(newState);
}, [setStateImpl, v7_startTransition]);
```

My hook turns a filter tab click from a `useState` update into a **navigation**, so the row set
commits on the transition's schedule while the URL changes at once. `quests-status.spec.ts` clicks
the `Reviewed` tab (`:113-115`) and then reads `tbody tr`'s first row **without retrying**
(`:116-117`) — it got the unfiltered row 0, `DS-ACAD1-C01-001` (exactly the label in the lead's
failure), so the menu it opened belonged to an `extracted` row and `Mark Reviewed` was enabled.
Measured directly with a throwaway arm in my own spec:

```
DIAG url=http://localhost:5181/quests?filter=Reviewed firstRow=DS-ACAD1-C01-001
DIAG-B (no prelude) url=http://localhost:5181/quests?filter=Reviewed firstRow=DS-ACAD1-C01-001
```

The Radix/`Escape` prelude in that spec is **irrelevant**: a no-prelude arm reproduced it identically.

### Two false fixes, both measured, both rejected

| # | attempt | measurement | verdict |
|---|---|---|---|
| 1 | `setSearchParams(next, { flushSync: true })` | with it set, the URL read `?filter=Reviewed` and the first row was still unfiltered | **no-op here** — that option is consumed by the *data router*'s `setState` (`if (flushSync) flushSyncSafe(…)`), a path `<BrowserRouter>` never takes |
| 2 | a local `useState` mirror re-derived from the URL by an effect | fixed the same-event read, but `/npc-inventories` stayed on the previous filter **indefinitely** after `goBack()` (8 samples over 4 s) while `/quests` settled correctly | **rejected** — a duplicated-state hazard of exactly the kind D76 warns about |

### The fix: drop `v7_startTransition` from the `<BrowserRouter>` future flags

One line in `client/src/App.tsx`. Measured after it:

- `DIAG: Back after two pushes` on `/npc-inventories` now settles at **t=0**
  (`extractedSelected=true`, first row `Extracted 1001`) — it never settled before.
- `tests/ui/quests-status.spec.ts` → **13 passed**; `tests/ui/shell.spec.ts` → **9 passed**,
  including its own arm "the console-error guard itself is live", so the deprecation notice this
  re-enables does not trip the `console.error` guards.
- the four p5-03 arms → **4 passed**.

**The trade, stated plainly:** with the flag unset, react-router emits its `warnOnce`
`v7_startTransition` future-flag warning once per page load in dev (`console.warn`). In exchange,
every URL-driven control is consistent with its URL within the same event — a correctness property
for a URL-persisted filter rather than a test convenience. Nothing else depends on the flag, and the
comment in `App.tsx` records how to flip it back. The alternative (keep the flag, and reshape that
one p2-09 arm to await the rows instead of reading them in the same event) is the lead's to choose;
that spec was **not** touched.

This section is the honest record of the story's own cost: the AC's URL persistence is only worth
having if the URL and the DOM agree, and the first version of this hook broke that in a way the unit
suite was structurally blind to (the 6 new unit tests exercise the pure helpers, not the hook).

## 3. Falsification — every clause was made to fail on purpose (D67(d))

Three deliberate one-line breaks, each run against the **final** code with
`PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers npx playwright test tests/ui/status-filter-url.spec.ts -g "NPC inventory"`,
and both files restored from backups afterwards (`grep -c BREAK` → `0` and `0`).

**Break A — ignore the URL on read** (`useStatusFilter.ts`: `const filter = 'All' as const;`).
Observed **2 failed**:

```
✘ … four tabs count the list payload, a filter selects a subset, and the URL carries it across a reload
✘ … a per-filter empty state names the filter that is empty
    Locator: getByText('Showing 1-2 of 2')            > 203
    Locator: getByText('No Verified NPC inventories found.')  > 253
```

**Break B — replace instead of push** (`setSearchParams(…, { replace: true })`). Observed
**1 failed / 1 passed**, on exactly the Back arm:

```
✘ … four tabs count the list payload, …
    Expected: "?filter=Extracted"
    Received: ""
    > 230 |     expect(searchOf(page)).toBe('?filter=Extracted');
```

**Break C — spell the default out in the URL** (`objectFilterParam` returns `filter` always).
Observed **1 failed / 1 passed**, on the "default is clean" arm:

```
✘ … four tabs count the list payload, …
    Error: expect(page).toHaveURL(expected) failed
    Expected pattern: /\/npc-inventories$/
    Received string:  "http://localhost:5181/npc-inventories?filter=All"
    > 218 |     await expect(page).toHaveURL(/\/npc-inventories$/)
```

Break A is the one that matters most for this story: it is precisely the defect the lead's
`7697898` accidentally committed (D84), the unit suite cannot see it (the 6 new unit tests exercise
the pure helpers, not the hook), and tier 1 is the only suite that catches it.

## 4. The six-check gate

Transcript: `docs/evidence/phase-5/p5-03-executor-gate.txt` (executor-run, on the settled tree).
Command 7 is the **official** `npm run test:ui` (no `--config`) per D84's port fix.

| # | check | result | rc |
|---|---|---|---|
| 1 | `npm test` | **61 files / 1416 tests passed** | **0** |
| 2 | `npm run lint` | `eslint .` clean; `prettier --check .` → "All matched files use Prettier code style!" | **0** |
| 3 | `npm run typecheck:tests` | `tsc -p tests/tsconfig.json --noEmit` clean | **0** |
| 4 | `npx tsc -p server/tsconfig.json --noEmit` | clean | **0** |
| 5 | `npx tsc -p client/tsconfig.json --noEmit` | clean | **0** |
| 6 | `npm run build` | `✓ built in 3.00s`; `index-CX2mQNyl.js` **762.27 kB** (gzip 225.31 kB), `QuestGoalLogicEditor-DlIq8ZZm.js` 293.44 kB, `index-nExvvXaW.css` 35.07 kB | **0** |
| 7 | `npm run test:ui` (official, no `--config`) | **317 passed / 0 failed** (1.0m) | **0** |

All seven rc = **0**. Raw transcript: `docs/evidence/phase-5/p5-03-executor-gate.txt`.


`npm test` reads **61 files / 1416 tests**, which includes the 6 new unit tests added by this story
(`tests/unit/quests-browse.test.ts` 26 → 32). The UI suite reads **317 passed / 0 failed**: the same
317 arms as the lead's baseline run (313 pre-existing + this story's 4), with **both** of that run's
failures resolved — `quests-status.spec.ts:95` by the `App.tsx` fix in §2 above, and
`extraction.spec.ts:1095` (the D69(h)/D77(d) load-sensitive family, in a file this story does not
touch) passing on this run. It is carried by name rather than claimed fixed.

### The full-run PNG side effect (D83), and its repair

The full `npm run test:ui` run rewrites the committed 375px evidence screenshots
(`tests/ui/object-mobile.spec.ts` writes into `docs/evidence/phase-4/`). **15** files were modified,
not the 7 the story brief predicted, and all 15 were restored:

```
$ git status --short -- docs/evidence/phase-4/ | wc -l
15
$ git checkout -- docs/evidence/phase-4/
$ git status --short -- docs/evidence/phase-4/
   (no output — byte-identical to HEAD again)
```

The final worktree therefore contains **only** the story's own changes:

```
 M client/src/App.tsx                   (the v7_startTransition fix, §2)
 M client/src/hooks/useStatusFilter.ts   (URL-only after the mirror was rejected, §2)
?? docs/evidence/phase-5/p5-03-d2-url-param.md
?? docs/evidence/phase-5/p5-03-d3-proof.md
?? docs/evidence/phase-5/p5-03-executor-gate.txt
```

`client/src/lib/object-list.ts`, `client/src/components/objects/ObjectListPage.tsx`,
`client/src/pages/QuestsPage.tsx`, `tests/ui/status-filter-url.spec.ts` and
`tests/unit/quests-browse.test.ts` are already in HEAD (`cd94bfc`) and unchanged since.

## 5. Honest limits

1. **The URL-only hook means the click's row-set update rides the router's commit**, which is
   synchronous only because §2's `App.tsx` change removed the transition. If someone sets
   `v7_startTransition` again, the same-event read degrades again (the URL stays correct; only *when*
   the table catches up changes). That coupling is stated in both files' comments.
2. **`extraction.spec.ts:1095` passed on this run and is not claimed fixed** — it is the recorded
   D69(h)/D77(d) load-sensitive family in a file this story does not touch.
3. **The detail page's "← Back to Quests" link** navigates to the bare `/quests`, so a filter is not
   carried *through* that link. Outside the AC (which names a reload and browser Back/Forward, both
   of which work) and recorded in `p5-03-d2-url-param.md` rather than silently widened into.
4. **No live-browser walkthrough of the seven object families was made.** The URL mechanism is one
   hook and one shared page component, so four arms (two per surface, one of them the generic page
   and one the quests page) cover it by construction, plus `object-mobile`/`object-create-and-counts`/
   `object-list` in the full run; a per-family screenshot pass would add no assertion the mechanism
   does not already have.
5. **The cross-check in D1 is a measurement of this corpus at this commit** (7 of 8 agree; quests
   differs by the six D82 rows). It is re-runnable rather than a once-true claim, and the quests
   badges deliberately keep tracking the table (the lead's ruling, recorded as D83).
