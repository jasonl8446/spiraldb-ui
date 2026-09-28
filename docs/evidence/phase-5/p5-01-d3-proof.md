# p5-01 D3 — the proof (story p5-01, plan task 5.1; D40, D44, D67(d), D76(b), D77(d), D78(b), D81, Q1)

Three parts: **(a)** the hermetic tier-1 spec, **(b)** AC3 proven on a **scratch DB**, and
**(c)** the rendered dashboard checked against the **live** API on this machine. Then the
six-check gate and the full UI suite.

---

## (a) The hermetic tier-1 spec — `tests/ui/dashboard.spec.ts` (960 lines, 7 arms)

Every endpoint the arms depend on is mocked by one dispatcher (D81): the dashboard aggregates
the **tool's own database**, which holds 2,271 rows here and none on CI. The mocked surface is
stateful — the PATCH moves the entry in the fixture's store and prepends a feed row — so the
re-read the page does carries the new change.

| arm | what it pins |
|---|---|
| AC1 cards | the four `[data-stat]` numbers equal the mocked `overall` (1874 / 1099 / 366 / 409) and the three percentages are `58.6% / 19.5% / 21.8%`, each matching `/^\d+\.\d%$/`; exactly **one** `GET /api/dashboard` feeds all four cards and all eight bars |
| AC1 bars | eight rows in D4 order, each `[data-type-summary]` equal to a **hand-typed** `verified/total (d.d%)`, one quest row's three `[data-segment]` widths at 14 / 37.3 / 48.8 %, and `[data-type="global_registry"]` + the text "Global Registry" both absent (Q1) |
| AC2 feed | `?limit=10` is the only activity request; 12 seeded rows → exactly 10 rendered, ids `12…3` in order; `<time>` texts `2 hours ago`, `12 hours ago`, `1 day ago`, `2 days ago`; both action spellings (`marked reviewed`, bare `extracted`); notes italic and absent when null; the two unresolvable rows shown with the `[data-unresolved="2"]` notice and no link |
| AC2 click-through | all eight rows' `href` equal the hand-typed D4 detail route, plus **two real clicks**: `/npc-inventories/87112` and the slash-bearing `/zone-transfers/WizardCity%2FWC_Hub` (which resolves to the right entry, not a 404) |
| AC2 update | mark `87112` reviewed on its detail page → back to `/` **via the sidebar link** → the fed row is id 13 with the typed note and `just now`, the cards moved (1099 → 1098, 366 → 367), the dashboard re-read grew, and a document-load counter (`addInitScript`) is **still 1** — no full reload |
| AC3 empty | `{activity: [], unresolved: 0}` → the sentence + the `Extract Quests` link to `/quests/extract`, zero feed rows, no notice; the cards still render |
| AC3 failure mode | a 500 on `/api/activity` → `role="alert"` with the server's message + `Try again`, and the empty-state sentence/CTA **absent** |

```
$ PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers \
  npx playwright test --config tests/ui/p4-10-altport.config.ts dashboard.spec.ts shell.spec.ts
 16 passed (10.6s)     # 7 dashboard arms + 9 shell arms
```

The `shell.spec.ts` `/` branch is the phase transition: it asserts this page's own literals
(the Total card's `597`, the Verified percentage `45.6%`, the quest bar's `157/322 (48.8%)`,
the heading `Verification Progress by Type`, the feed's `DS-ACAD-C01-001 marked reviewed` and
the `1 status change in this feed` notice) against the two endpoints mocked in `mockShellApi`.

---

## (b) AC3 on a genuine scratch DB (not in-process, not mocked)

A **production** stack (`npm run build` → `node server/dist/server/src/index.js`) on a spare
port, pointed at a database created from nothing. The identity of the server is asserted
**before** any probe from its boot log (`database ready at /tmp/p5-01/scratch.db`) and from the
app's own readiness route; nothing in the run can touch the developer's database or the corpus
(`SPIRALDB_UI_SKIP_IMPORT=1`, `SPIRALDB_PATH=/tmp/p5-01/no-corpus`).

```
$ rm -f /tmp/p5-01/scratch.db
$ PORT=5199 SPIRALDB_UI_DB=/tmp/p5-01/scratch.db SPIRALDB_UI_SKIP_IMPORT=1 \
  SPIRALDB_PATH=/tmp/p5-01/no-corpus node server/dist/server/src/index.js
  [spiraldb-ui] database ready at /tmp/p5-01/scratch.db      <- identity
  [spiraldb-ui] API listening on http://localhost:5199
  [spiraldb-ui] serving built client from …/client/dist

$ curl -s localhost:5199/api/status/_import   -> {"ran":false,"imported":0,"imported_at":null}
$ curl -s localhost:5199/api/dashboard        -> all eight buckets 0, overall 0, percent_verified 0
$ curl -s "localhost:5199/api/activity?limit=10" -> {"activity":[],"unresolved":0}
$ node -e "…count rows…"                      -> entry_status 0  status_history 0
```

And in the browser, on that same stack (the probe reads the rendered DOM *and* fetches both
endpoints from inside the page):

```
headings   ["Verification Progress by Type","Recent Activity"]
cards      {"total":"0","extracted":"0","reviewed":"0","verified":"0"}
percents   {"extracted":"0.0%","reviewed":"0.0%","verified":"0.0%"}
types      [[quest,"0/0 (0.0%)"], …  eight rows …]
feed rows  0        emptyState true        unresolved notice null
consoleErrors []
```

So the empty state is reached from a **successful** read of an empty history — never from an
error, and never from a developer's database.

**Nothing was left listening**: the server was killed by PID and
`ss -ltn | grep 5199` is empty afterwards (`no rig servers running`). No clone was touched and
no corpus was written, so the D76(b) clone-restore ritual does not apply to this rig.

---

## (c) The four cards equal the live API, on this machine

The same production stack, restarted against the **live** database
(`SPIRALDB_UI_DB=$PWD/data/spiraldb-ui.db`) — a read-only use of it. The probe compares the
rendered text with `GET /api/dashboard` / `GET /api/activity` fetched from within the page.

```
--- CARDS vs GET /api/dashboard overall ---
PASS card total      rendered "2271" api 2271
PASS card extracted  rendered "2270" api 2270
PASS card reviewed   rendered "1"    api 1
PASS card verified   rendered "0"    api 0
PASS percent extracted rendered "100.0%" expected 100.0%     (2270/2271 = 99.956 -> 100.0)
PASS percent reviewed  rendered "0.0%"   expected 0.0%
PASS percent verified  rendered "0.0%"   expected 0.0%        (the API's own percent_verified)

--- PER-TYPE bars vs types[object_type] ---
PASS quest                    rendered "0/322 (0.0%)"
PASS drop_table               rendered "0/317 (0.0%)"
PASS npc_inventory            rendered "0/215 (0.0%)"
PASS npc_spell_inventory      rendered "0/77 (0.0%)"
PASS creature_spellbook       rendered "0/134 (0.0%)"
PASS npc_drop_table           rendered "0/0 (0.0%)"
PASS treasure_card_inventory  rendered "0/1 (0.0%)"
PASS zone_transfer            rendered "0/1205 (0.0%)"
total FAIL 0

--- FEED vs GET /api/activity ---
api rows 3   rendered 3   unresolved 0   notice null
feed 3  linked=true href=/quests/DS-ACAD-C01-001  "DS-ACAD-C01-001 marked reviewed | 1 day ago | by Jason | Gate-1 acceptance re-run: …"
feed 2  linked=true href=/quests/DS-ACAD-C01-001  "DS-ACAD-C01-001 marked extracted | 1 day ago | by Jason | gate-1: backwards transition …"
feed 1  linked=true href=/quests/DS-ACAD-C01-001  "DS-ACAD-C01-001 marked reviewed | 1 day ago | gate-1 attempt before identity"
consoleErrors []
```

No GlobalRegistry row appears in either section — the eight rows are exactly D4's eight, and
the live DB holds 2,271 tracked entries across them.

Raw captures: `p5-01-d3-probes.txt`; screenshots (1440×1200, whole page)
`p5-01-d3b-scratch-empty.png` and `p5-01-d3c-live-dashboard.png`. **Limitation:** this model
cannot view images, so the screenshots are captured for the lead's visual check — every
numeric claim above is the DOM text the probe returned, not a reading of a picture.

---

## The six-check gate (every rc measured, `p5-01-gate.txt`)

| # | command | result | rc |
|---|---|---|---|
| 1 | `npm test` | **59 files / 1351 tests passed** | 0 |
| 2 | `npm run lint` | eslint clean, `prettier --check .` clean | 0 |
| 3 | `npm run typecheck:tests` | clean | 0 |
| 4 | `npx tsc -p server/tsconfig.json --noEmit` | clean | 0 |
| 5 | `npx tsc -p client/tsconfig.json --noEmit` | clean | 0 |
| 6 | `npm run build` | server tsc + copied migration + Vite build (2327 modules, 3.11 s) | 0 |

`npx prettier --write` was run on every file this story touched **before** lint (rc=0), and
`npm run lint` after it (rc=0).

## The full UI suite — `npm run test:ui`'s equivalent on the alt-port config

The official command cannot boot while the owner's other project holds `[::1]:5173` (D78(b)),
so the suite ran on `tests/ui/p4-10-altport.config.ts` (identical except the port):

```
$ PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers \
  npx playwright test --config tests/ui/p4-10-altport.config.ts
  305 passed (1.6m) / 1 failed      rc=1
```

**The one failure is carried, not fixed (D77(d)):** `tests/ui/extraction.spec.ts:774`
"results phase › Save All asks for confirmation with the exact copy, and only then POSTs — one
toast per quest", failing at `:780` because a sonner toast (`<li … data-sonner-toast>`) **intercepts
pointer events** — the recorded `extraction.spec.ts` toast-overlay family (D69(h),
D77(d)). It is in a file this story did not touch (`git status` lists only
`tests/ui/shell.spec.ts` modified and `tests/ui/dashboard.spec.ts` added under `tests/ui/`),
and it **passes in isolation in 8.6 s**:

```
$ … --config tests/ui/p4-10-altport.config.ts extraction.spec.ts --grep "one toast per quest"
  ✓  1 [chromium] › tests/ui/extraction.spec.ts:774:3 › … (7.3s)
  1 passed (8.6s)
```

All seven `dashboard.spec.ts` arms and all nine `shell.spec.ts` arms passed **inside** that
full run (see `p5-01-uish-full.txt`).

---

## Honest limits

- **The endpoint's `?limit` ceiling is not exercised live**: the tier-1 arms assert the page
  asks for `limit=10`, and the 400 ladder lives in `tests/unit/activity.test.ts` — no arm sends
  `?limit=101` to the real server.
- **The `d3c` rig opened the live database read-only** (the dashboard is a pure read) and was
  killed by PID; the run wrote nothing to it, to the D17 clone or to the owner's fork.
- **Screenshots are unviewed by me** (see above); the numbers are DOM text.
- **The `unresolved` arm is synthetic**: no history row in any real database has a missing
  parent — the case is constructed with `PRAGMA foreign_keys = OFF` in the unit test and by a
  fixture in the spec, because an orphan can only come from a writer that ignored the FK.
- **CI parity**: the two specs mock every endpoint they read, so they behave the same with an
  empty corpus. The scratch-DB probe was run against a built client on a spare port, which is
  the same condition CI's empty database presents.