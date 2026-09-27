# p5-04 D3 — AC1's live sequence, the tier-1 proof, and the gate (story p5-04 / plan task 5.4)

## 1. The rig (nothing of the owner's was touched)

| piece | value |
|---|---|
| Express | port **3001** (the Vite proxy's fixed target — a different port would have made the proxy the subject rather than the server), `NODE_ENV=test`, `SPIRALDB_UI_DB=$PWD/data/p5-04-rig.db`, `SPIRALDB_UI_SKIP_IMPORT=1` |
| Vite | port **5191** (`VITE_PORT=5191`, a port this story owns) |
| Browser | the Playwright MCP browser, `http://localhost:5191/` |
| Database | a **throwaway file this story created**; the rig only ever *read* (dashboard, activity, quests, settings). No save, no PATCH, no sync was issued, so there is **nothing to restore** — stated rather than assumed. The file was deleted at the end (`data/` is gitignored) |
| Moved nothing else | the owner's sibling checkout still holds `[::1]:5173` — verified listening **after** every kill/restart below (D78(b)) |

`GET /api/health` through the proxy answered **500** with Express dead and **200** with it up: Vite's
proxy returns a 5xx rather than rejecting the socket, which is exactly the signal `lib/api.ts`
reports as a failure (and why the detector keys on "rejected fetch **or** 5xx", not on the fetch
rejection alone).

The browser was instrumented before the run: a `fetch` wrapper recording `{url, status, t}` per
request, and a `MutationObserver` on `document.body` recording when the banner enters and leaves
the DOM — both on the page's own `performance.now()` clock, so the numbers below are one timeline.

## 2. Kill → banner (the appear half)

**Killed by PID**, nothing else: `kill 3302932` (the `node … server/src/index.ts` child) plus
`3302921` (its `tsx watch` supervisor, so it could not linger). Verified afterwards: port 3001
`free`, Vite still answering `200`, the proxy answering `500`.

With the UI open on `/quests` and the fetch log reset, the browser then clicked the Dashboard link
(`a[href="/"]` — a client-side navigation, **no reload**) and the observer-poll recorded:

| t (ms, from the click) | event |
|---|---|
| 0 | click; `location.pathname` becomes `/` |
| 29 | `GET /api/activity?limit=10` → **500** |
| 30 | `GET /api/dashboard` → **500** (the first failed request of the page's cycle) |
| 44 | `GET /api/health` → **500** — the probe the failed request triggered |
| **70** | **banner in the DOM** (`[data-testid="offline-banner"]`, `role="alert"`, `aria-label="Connection status"`) |
| 1049 / 1061 | the two page queries retry once each (`retry: 1`, `App.tsx`) → 500 again |
| 2045, 4045, 6045 … | `/api/health` every **2000 ms** while offline |

**What "one failed request cycle" meant in this run:** the first request that failed *is* the whole
cycle — one `/api/quests` (earlier pass) or `/api/dashboard` + `/api/activity` (this pass) that
answered 500 → **one** triggered health probe → the banner, **26 ms after the first failure** and
74–36 ms after the click across the two measured passes. No refresh, no reload, no polling
interval to wait out: the probe is fired by the failure, not by a timer. A document counter
confirmed exactly **1** document load.

Banner text as rendered (the deviation from the spec's second sentence is D2's record):

```
Connection lost. Loaded data may be out of date, and saving will fail until the server is back.
```

## 3. Restart → cleared **and refreshed** (the clear half)

Express was restarted by hand (`npm run dev:server`, same DB). The probe then noticed on its own —
nothing was clicked, nothing was reloaded:

| t (ms, same clock) | event |
|---|---|
| 26045 | `GET /api/health` → 500 (the last failing probe) |
| **28045** | `GET /api/health` → **200** ← the probe that found the server back |
| **28063** | **banner leaves the DOM** (18 ms after the successful probe) |
| 28060 | `GET /api/status/_import` → 200, `GET /api/settings` → 200, **`GET /api/dashboard` → 200** — the recovery's `invalidateQueries()` re-fetching the failed read |
| 28072 | `GET /api/activity?limit=10` → 200 |

DOM read after the recovery: banner absent, **no** "Could not load the dashboard." text, and the
four stat cards (`Total`, `Extracted`, `Reviewed`, `Verified`) rendered. The banner was up for
27.99 s and the restart clearance landed inside one probe interval (the server came back between
the 26045 and 28045 ticks, i.e. ≤ 2 s before the banner cleared).

A second observation from the earlier pass measured the same mechanism on the quests list: after the
recovery, `/api/quests` was re-fetched (200) and **50 table rows** rendered where the page had shown
the load-failure state.

**A rig hazard worth recording (my own near-miss):** the first cleanup attempt built its kill list
with `pgrep -f "<the pattern>"` while that pattern sat in the killer's own command line, so the
shell matched and killed itself. Every kill after that used explicit PIDs. A rig that kills by
pattern can kill its own driver.

## 4. (b) The hermetic tier-1 spec, and the two existing specs it required

`tests/ui/p5-04-error-surfaces.spec.ts` — **4 arms, all route-mocked (D81)**, `4 passed` alone and
inside both full runs:

1. the banner appears within one failed request cycle, **without a reload** (a document counter proves
   one load), carries the first sentence verbatim, does **not** contain `saved locally`, clears when
   the mocked API returns, and the dashboard's failed read is re-fetched (`dashboardRequests > 1`);
2. **the negative**: a 400-only page never raises the banner and never even starts the probe
   (`healthProbes === 0`);
3. the API-error toast carries a **Retry** that re-issues the failed request
   (`dashboardRequests` strictly grows) and the data then renders;
4. a 400 **field map** is summarised at the top of the form with one line per field, and the summary's
   `y` is strictly above the first field control's.

Two **existing** specs needed adapting, both because the new surfaces are intentional and neither
adaptation weakens an assertion (D71(h)'s precedent):

| spec | why | change |
|---|---|---|
| `quests-browse.spec.ts:416` | the API-error toast deliberately repeats the server's sentence, so an unscoped `getByText('SpiralDB path is not configured.')` resolved to **2** elements (strict-mode violation) | scope that one assertion to `main` (the page's own inline state); the toast's own copy and retry are asserted in arm 3 of the new spec |
| `search-palette.spec.ts:513` | that arm deliberately fails `/api/search`, so the app legitimately probed health, which was unmocked and landed in its `recorded.unmocked` guard | mock `/api/health` as up in `mockSearchApi` — D81's own rule ("a spec whose assertions depend on an endpoint must mock it") |

## 5. The carried flake, attributed by name and **not** fixed

Full run 1: 319 passed / **2 failed** — both were this story's regressions, fixed as above.
Full run 2: 320 passed / **1 failed** — `tests/ui/extraction.spec.ts:1069`, *"identity gate
(D38/D43) › a blank user_name opens the dialog, the name is saved, and the pending save resumes"*:
the pre-existing extraction **info** toast (`data-type="info"`, `border-l-blue-500`) stayed over the
`Save Selected` button and **intercepted the pointer for the whole 60 s test timeout**.

Attribution, by evidence rather than by convenience:

- the intercepting element is the p2-07 **info** toast — this story adds only **error** toasts, and
  only for a rejected `fetch`/5xx;
- the arm's mock (`mockApi(page, { userName: '' })`) contains **no 5xx at all** (grep: the two
  `status: 500` mocks are at lines 608 and 1015, in other arms), so no toast of mine can fire in it;
- it **passes 3/3 in isolation** (3.9 s / 4.1 s / 4.4 s), which is the short-passes-in-isolation
  signature D69(h) recorded for this file;
- it is a **different line and a different symptom** from D77(d)'s named arm (a 10 s `expect`
  timeout at :774/:807/:825/:880): this one is pointer interception at :1069.

It is therefore carried to the lead as the **D69(h)/D77(d) extraction.spec.ts flake family**, by
name, unpatched — exactly as instructed. Full run 3 on the unchanged tree: **321 passed, rc=0**.

## 6. Gate

`docs/evidence/phase-5/p5-04-gate.txt` — all seven commands with their rcs:

`npm test` rc=0 (64 files / 1444 tests) · `npm run lint` rc=0 · `npm run typecheck:tests` rc=0 ·
`tsc -p server` rc=0 · `tsc -p client` rc=0 · `npm run build` rc=0 · `npm run test:ui` (no
`--config`) **rc=0, 321 passed**.

The full-UI-run PNG side effect: `object-mobile.spec.ts` rewrote **4** of the committed phase-4
PNGs this round (the count varies per run — D83(d) measured 15). Restored with
`git checkout -- docs/evidence/phase-4/` and verified **two ways**: `git status --porcelain
docs/evidence/phase-4/` → 0 lines, and every one of the **22** PNGs' md5 compared against
`git show HEAD:<path>` → 22 checked, **0 mismatches**.

## 7. Honest limits

- The live sequence was driven with the Playwright MCP browser, not the tier-1 suite (by
  definition: the suite route-mocks the failure; AC1's "kill the server" cannot be mocked). The
  numbers above are single-run measurements on this host under peak-hour load; the *mechanism*
  (failure → immediate probe → banner; probe success → clear + invalidate) is separately pinned
  hermetically by the tier-1 spec, which is what makes the live run's evidence a confirmation
  rather than the only witness.
- The rig's `/api/status/_import` answered `ran:false` (the import was skipped). Nothing else in
  the rig wrote.
- `npm run test:ui` was run three times in total this story; the gate cites run 3 (rc=0) with runs
  1–2 recorded as the evidence for the two spec adaptations and the carried flake.