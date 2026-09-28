# p5-02 D3 — the proof (story p5-02, plan task 5.2; P5 AC#4)

Three parts: (a) the hermetic tier-1 spec, (b) the `< 300 ms` claim **measured and printed**,
(c) `limit=20` demonstrated. Then the six-check gate.

---

## (a) The hermetic tier-1 spec (D40/D81)

`tests/ui/search-palette.spec.ts` — 546 lines, 7 arms, one dispatcher mocking **every**
`/api/**` path the run touches, and an **unmocked-path guard** that records any path it had no
fixture for, answers it 404, and is asserted empty at the end of every arm.

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

| the AC's words | the arm | how it is asserted |
|---|---|---|
| "typing a substring of a known quest name and of a known DropTable name returns both" | 2 | `DS-ACAD` → `role="group"` `Quests` **and** `Drop Tables`, each with its row |
| "grouped by type" | 2 | two named group regions, in the endpoint's own order |
| "status dots correct" | 2 | `span.bg-blue-500` + `Status: Reviewed` on the quest row; `span.bg-amber-500` + `Status: Extracted` on the drop-table row (i.e. `StatusDot`'s colour class **and** its sr-only word) |
| "selecting a result lands on its detail page" | 4 | click → `/npc-inventories/87112` **and** the detail page's own `Back to NPC Inventories` link + its `title="87112"` key; then click the quest row → `/quests/DS-ACAD-C01-001` and the shell's route title `Quest Detail` |
| "`limit=20` respected" | 3 | every `/api/search` request's `limit` param recorded: `['20','20']` |
| "over 15k+ name rows responds < 300ms" | — | **not assertable against a mock**; part (b) below |
| the non-navigable treatment | 5 | the item row shows `— not linked`, carries no dot, `[data-search-unresolved="1"]` prints the count, and clicking it leaves the palette open and the URL unchanged |
| the no-results state | 6 | `[data-search-empty]` with `No results for “zzzz-no-such-thing”`, and a 500 renders `[data-search-error]` with the server's message and **no** empty state |

### Hermetic by construction, and the guard paid for itself

The first run **failed**, and the failure is the evidence that the guard works:

```
Error: expect(received).toEqual(expected) // deep equality
- Array []
+ Array [
+   "GET /api/status/npc_inventories/87112/history",
+   "GET /api/status/quests/DS-ACAD-C01-001/history",
+ ]
```

Two reads the spec did not know about — the shared status panel every detail page mounts. Both
are mocked now. This is exactly the class of defect gate-4 caught on `shell.spec.ts` (D81): a
spec that walks the app must mock every endpoint its assertions depend on.

### Falsification (D67(d)) — three deliberate breaks, each caught by the arm that owns it

| break | arm | result |
|---|---|---|
| the result dot is a hard-coded `bg-blue-500` span instead of `StatusDot` | 2 | **FAIL** — `toHaveCount` expected 1, received 0 (the drop table's amber dot) |
| `searchPath` drops `&limit=` | 3 | **FAIL** — the recorded `limits` array differed from `['20','20']` |
| `searchResultHref` returns `/items/<source_id>` for a routeless row (i.e. invents a route) | 5 | **FAIL** — `— not linked` expected 1, received 0 |
| (the click-through arm 4 stays green under that third break, correctly: it clicks a quest and an NPC row, both of which still go through the D4 mapping) | 4 | pass (expected) |

The run was **5 failed / 2 passed** in total: the three above, plus arms 6 and 7, whose failures
were the harness rather than the claim — arm 6 timed out waiting for the header trigger and arm 7
got `net::ERR_CONNECTION_REFUSED`, i.e. the dev stack under it had stopped answering (peak-hour
load on this host). Recorded honestly: the two extra failures carry no assertion evidence, and the
**clean** build passes 7/7 and again in the full-suite run (below).

---

## (b) `< 300 ms` — measured, not asserted

Two measurements, because the criterion says "locally" and a palette's latency is
service + HTTP + JSON. Both on this machine, this database.

### The rows it searched (the "15k+" the AC names is really ~121k)

```
$ npx tsx /tmp/p5-02/measure.mjs          # opens data/spiraldb-ui.db READ-ONLY
database:  data/spiraldb-ui.db  (38,268,928 bytes, mtime 2026-09-27T16:19:09Z)
git HEAD:  713e86d (d561ab4 + the lead's D82 docs commit)
rows the search spans:
  entry_status     2271
  items           79835
  spells          18173
  npcs            23033
  quests            328
  TOTAL          123640
```

`zones` / `drop_tables` / `string_table` are **not** in that total: the story's design searches
`entry_status` (all eight D4 types) plus the four friendly-name tables the plan names
(`items`, `spells`, `npcs`, `quests`); `drop_tables.name` repeats the object key and `zones` is
outside the plan's list — both recorded in `p5-02-d1-search.md`.

### Measurement 1 — the service, `searchAll` (the function the route calls)

**Method:** warm — one process, one read-only connection, **1 untimed run per query then 25
timed runs**, `searchAll(db, { q, limit: 20 })` directly (no HTTP). 11 queries including the
worst cases available (a one-character query that matches in 7 of the 11 groups).

```
query                 rows  groups  trunc  min      median   p90      worst
"DS-ACAD"               42       3  true      9.8ms   11.4ms   14.5ms   14.8ms
"DS-ACAD-C01-00"        10       2  false    10.0ms   10.8ms   19.5ms   19.9ms
"acad"                  63       6  true     10.8ms   11.8ms   12.5ms   14.2ms
"KT-"                   86       5  true      9.4ms   10.2ms   12.5ms   19.1ms
"necklace"              20       1  true     10.0ms   10.6ms   11.4ms   11.9ms
"obsidian"              44       4  true     10.8ms   11.6ms   13.1ms   21.0ms
"amulet"                22       3  true     11.2ms   12.1ms   13.7ms   15.9ms
"headless rider"         1       1  false     9.7ms   10.5ms   11.5ms   13.8ms
"a"                    140       7  true     18.8ms   20.9ms   29.4ms   38.4ms
"e"                    140       7  true     19.3ms   19.9ms   20.8ms   26.7ms
"zzzz-no-such-thing"     0       0  false     8.2ms    8.7ms    9.1ms    9.4ms

WORST SINGLE RUN over all 11 queries x 25 runs: 38.4 ms
runs at or above 300 ms: 0
cold (a fresh connection per run, q="e", limit=20): 21.2, 20.9, 20.7, 21.1, 21.2 ms (worst 21.2 ms)
```

### Measurement 2 — the wire, through the real server (includes Express, HTTP, JSON)

**Method:** a **scratch copy** of the database (`/tmp/p5-02/live/live.db` — the owner's
`data/spiraldb-ui.db`, and through it the fork, are never opened by this rig), the real server on
a **fresh port 5199** with `SPIRALDB_UI_SKIP_IMPORT=1`, its identity asserted **before** any
probe (`/api/status/_import` → `{"ran":false,…}` and the boot line
`database ready at /tmp/p5-02/live/live.db`; the listener on 5199 was this process,
`pid=3003616`). `curl -s -o /dev/null -w '%{time_total}'`, 1 warm-up then **20 timed runs per
query**.

```
query                       min   median      p90      worst
DS-ACAD                   14.6ms    16.8ms    21.4ms      24.0ms
DS-ACAD-C01-00            11.2ms    16.4ms    21.3ms      21.8ms
necklace                  11.4ms    17.3ms    20.0ms      22.1ms
obsidian                  16.1ms    19.3ms    23.5ms      23.5ms
a                         21.9ms    25.0ms    30.5ms      31.8ms
e                         20.9ms    25.0ms    30.0ms      30.2ms
zzzz                      10.3ms    14.0ms    14.9ms      14.9ms

blank query (q=), wire level:  1.02 ms, 0.62 ms, 1.07 ms   ← no statement is prepared
```

Rig torn down by PID (`kill -TERM -<setsid pgid>`), and **proved** dead: `ss -ltnp | grep 5199`
→ nothing listening, `pgrep -af 'server/src/index.ts'` → nothing, `curl :5199` → refused.

### The claim

**PASS, with margin.** The worst single observation anywhere in the two measurements is
**38.4 ms** (the service under a one-character query), and the worst *wire* observation is
**31.8 ms**; the median for a realistic substring is **10–17 ms** (service) / **16–25 ms**
(wire). That is roughly **8× under the 300 ms budget** at the worst case and ~20× at the median,
over **123,640 rows** rather than the 15k+ the criterion names.

**What would be indexed if it exceeded 300 ms** (stated rather than left implicit): the
substring arm is `lower(col) LIKE '%q%'`, which no B-tree index can serve — the plan's
mitigation ("LIMIT 20 + SQLite indexes exist on name tables' PKs") bounds the *sort*, not the
*scan*, and the order-by tiebreak is what the PK index serves. The next lever would be an
**FTS5 external-content table** (or a trigram index) over `items.name` / `spells.name` /
`npcs.name` / `entry_status.object_key`, refreshed by the same sync that fills those tables —
NOT a cache of results, because the corpus changes under the tool on every save. It is not
needed today: 123,640 rows scan in ~20 ms on this host.

---

## (c) `limit=20` demonstrated

`limit` is a **per-group** cap (`p5-02-d1-search.md` §3 records why the AC's own example forces
it: `DS-ACAD` matches 26 quests *and* 26 drop tables, so one shared cap would let Quests consume
all twenty and never show Drop Tables).

**Filled to exactly 20, at the wire** — a query whose matches live in one type:
`necklace` matches 124 items and nothing else in any of the 11 groups:

```
?q=necklace&limit=20  → {"total":20,"truncated":true,"groups":[{"type":"item","results":[20 rows]}]}
?q=necklace&limit=5   → {"total":5, "limit":5, "groups":[{"type":"item","results":[5 rows]}]}
```

**And no group ever exceeds the cap** — the two-type example:

```
?q=DS-ACAD&limit=20   → total 42, truncated true, groups [('quest',20), ('drop_table',20), ('npc',2)]
?q=DS-ACAD&limit=50   → total 54, truncated false, groups [quest 26, drop_table 26, npc 2]
```

The ladder, at the wire (`status  body`):

```
?q=                                      200  {"query":"","limit":20,"total":0,"truncated":false,"unresolved":0,"groups":[]}
?                                        200  {"query":"","limit":20,…}          (q absent)
?q=DS-ACAD&limit=                        400  {"error":"Invalid limit \"\": limit must be a positive integer (1-50)"}
?q=DS-ACAD&limit=abc                     400  {"error":"Invalid limit \"abc\": …"}
?q=DS-ACAD&limit=0                       400  {"error":"Invalid limit \"0\": …"}
?q=DS-ACAD&limit=-1                      400  {"error":"Invalid limit \"-1\": …"}
?q=DS-ACAD&limit=1.5                     400  {"error":"Invalid limit \"1.5\": …"}
?q=DS-ACAD&limit=%201                    400  {"error":"Invalid limit \" 1\": …"}
?q=DS-ACAD&limit=%2B1                    400  {"error":"Invalid limit \"+1\": …"}
?q=DS-ACAD&limit=1e3                     400  {"error":"Invalid limit \"1e3\": …"}
?q=DS-ACAD&limit=51                      400  {"error":"Invalid limit \"51\": limit must be at most 50"}
?q=DS-ACAD&limit=1&limit=2               400  {"error":"Query parameter \"limit\" must be a single positive integer"}
?q=a&q=b                                 400  {"error":"Query parameter \"q\" must be a single string value"}
```

The AC's own example, at the wire:

```
?q=DS-ACAD-C01-00  → query 'DS-ACAD-C01-00' limit 20 total 10 truncated false unresolved 0
  group quest      'Quests'      rows 5   e.g. DS-ACAD-C01-001 status reviewed matched_on key
  group drop_table 'Drop Tables' rows 5   e.g. DS-ACAD-C01-001 status extracted matched_on key
```

The friendly-name arm and the quest-title arm, at the wire:

```
?q=obsidian        → total 44 unresolved 43
  quest   DS-NEC2-C01-009  navigable, matched_on 'name' (its joined title contains "obsidian")
  item    (no type) → label 'Obsidian Amulet', source_id 4, status null, matched_on name
  spell   (no type) → 'Obsidian Colossus', source_id 198656403, unresolved
  npc     (no type) → 'Obsidian Beak', source_id 684217, unresolved
?q=headless rider  → quest DS-ACAD-C01-002 name 'Headless Rider' matched_on name status extracted
```

The three routeless rows carry `object_type: null` / `object_key: null` / `status: null` and are
counted in `unresolved` — which is what makes the palette's "— not linked" and its count come
from the endpoint rather than from a client-side guess.

---

## The six-check gate (every rc)

Every line below ran on the **final** tree; the full transcript is `p5-02-executor-gate.txt`.

| check | rc | result |
|---|---|---|
| `npm test` | 0 | `Test Files 61 passed (61)` / `Tests 1410 passed (1410)` — both new suites in it (`search.test.ts 43 tests`, `search-ui.test.ts 16 tests`); p5-01's boundary was 59 files / 1351 tests, so this story adds exactly 2 files and 59 tests |
| `npm run lint` | 0 | `eslint .` clean and `All matched files use Prettier code style!` |
| `npm run typecheck:tests` | 0 | silent |
| `npx tsc -p server/tsconfig.json --noEmit` | 0 | silent |
| `npx tsc -p client/tsconfig.json --noEmit` | 0 | silent |
| `npm run build` | 0 | `✓ built in 6.21s`; client index chunk `756.75 kB` (p5-01) → **`761.37 kB`**, i.e. **+4.62 kB** for the palette because cmdk was already bundled (D39) |
| `npm run test:ui -- --config tests/ui/p4-10-altport.config.ts` | 0 | **313 passed (1.0m)**, this story's 7 arms included — the **alt-port** config, not the official one: `[::1]:5173` is the owner's other project and is not ours to kill (D78(b)) |

**No new dependency**: `package.json` and `package-lock.json` are untouched (`p5-02-executor-gate.txt` §9).
`tests/ui/search-palette.spec.ts` adds no package either.

**The full `test:ui` run rewrote committed phase-4 evidence, and it was repaired.** The run
modified **15** committed PNGs under `docs/evidence/phase-4/` — the 375 px screenshots
`object-mobile.spec.ts` writes — which is another phase's binary noise in this story's working
tree. `git checkout -- docs/evidence/phase-4/` restored them, and the repair is verified two ways:
`git status --porcelain docs/evidence/phase-4/` → `0` files, and the md5sum of **all 22** PNGs in
that directory matches the committed bytes. (The run this story's brief flagged expected 7 files;
the measured number is 15.)

## The one defect the bespoke live pass found (D23) — recorded because no assertion saw it

Reading the rendered accessibility tree rather than the code showed the results listbox named
**`Suggestions`**, because `cmdk`'s `CommandList` applies its own `aria-label` *after* spreading
the caller's props — so the `aria-label="Search results"` in the code was silently discarded. Fixed
by passing cmdk's `label` prop; the tier-1 spec now pins the list's accessible name; the reason is
inline in the component. Every functional arm passed **before** the fix. Full record, plus the
live geometry (dialog exactly 26 rem centred, list `375/392` scroll, zero horizontal overflow, a
row's dot and label sharing a vertical centre) and the two screenshots:
`p5-02-d2-palette.md`.