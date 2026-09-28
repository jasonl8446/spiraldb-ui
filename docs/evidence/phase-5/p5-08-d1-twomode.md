# p5-08 D1 — the two-mode comparison (AC1, plan task 5.7; P5 AC#14)

"`npm run build && npm start` → app fully functional on :3001 without Vite; **all routes
deep-linkable and refresh-safe via SPA fallback**; **dev proxy and prod serving behave
identically**."

This file records what was compared, on which ports and database, with the numbers. Part 1
(the comparison, below) was measured on the tree at `3f66ff4` with the bundle
`client/dist/index.html` = `43af845f1eee5896b7d1633a9588c1a2167018ff3e21526be4c5ad9dcd4941a2`
(asset `assets/index-CE_xEEtJ.js`, 770,800 B). Part 2 (D1b, appended) re-runs the prod half on
the **final tree** on **:3001**, i.e. the AC's literal port.

## What "the two modes" are, and what was held constant

| | prod | dev |
|---|---|---|
| client served by | Express static (`express.static` + `app.get('*')` → `index.html`) | Vite 5.4.21 dev server (its own history fallback) |
| URL probed | `http://localhost:3031` | `http://localhost:3032` |
| API served by | the same Express process | Vite's `/api` proxy → `http://localhost:3001` (hardcoded in `client/vite.config.ts`) |
| database | `/tmp/p5-08/scritch.db` | `/tmp/p5-08/scritch.db` |
| client code | the **built** bundle from `client/dist` | the **source** through Vite's transform |

**Held constant on purpose: the database.** Both modes ran against one byte-copy of the live
database (`cp data/spiraldb-ui.db /tmp/p5-08/scritch.db`, 38,268,928 B, 2,271 `entry_status`
rows), so a route that rendered different content in the two modes would be a code difference,
never a data difference. Identity was asserted before probing, in both modes:

```
$ curl -s http://localhost:3031/api/settings   # and :3001 — byte-identical
{"aurorium_path":"…/Aurorium","git_branch":"content/2026-09-26",
 "imcodec_path":"…/Imcodec.Cli/bin/Debug/net9.0/linux-x64/imcodec",
 "spiraldb_path":"/home/jason/Documents/git-projects/spiraldb","user_name":"Jason"}

$ cat /tmp/p5-08/prod-3031.log
[spiraldb-ui] database ready at /tmp/p5-08/scritch.db
[spiraldb-ui] first-startup import skipped (entry_status already has rows)
[spiraldb-ui] API listening on http://localhost:3031
[spiraldb-ui] serving built client from /home/jason/Documents/git-projects/spiraldb-ui/client/dist
```

`spiraldb_path` says the owner's fork and `user_name` says `Jason` — neither is the D44 test
database (`data/test-spiraldb` + empty `user_name`), which is how a harness-booted stack is
identified. **A sibling worker's stack was holding :3001 and :5181 when this part ran** (the
p5-07 executor's `npm run test:ui`, its own boot line visible in
`ps -o lstart=`, its `data/test-ui.db` fresh at 20:50) — so this part used **:3031** for prod
and **:3032** for Vite, ports this story owns. See D1b for the :3001 re-run.

## The route set — every one of the 20 routes in `client/src/lib/routes.ts`, instantiated

The spec's table (`docs/spec-api.md` L456-477) lists 20 routes, 8 of them dynamic. A dynamic
route was instantiated with a **real corpus key** fetched from the API, so a page renders real
content rather than an error state; where the corpus has no row (the `NpcDropTable` family —
D71's genuinely absent directory, measured `0` rows), a synthesized key is used and named:

| # | route | instantiated path | key source |
|---|---|---|---|
| 1 | `/` | `/` | — |
| 2 | `/quests/extract` | `/quests/extract` | — |
| 3 | `/quests` | `/quests` | — |
| 4 | `/quests/:questName` | `/quests/DS-ACAD-C01-001` | `GET /api/quests` row 1 of 328 |
| 5 | `/drop-tables` | `/drop-tables` | — |
| 6 | `/drop-tables/:name` | `/drop-tables/DS-ACAD-C01-001` | `GET /api/drop-tables` row 1 of 317 |
| 7 | `/npc-inventories` | `/npc-inventories` | — |
| 8 | `/npc-inventories/:id` | `/npc-inventories/87112` | row 1 of 215 |
| 9 | `/npc-spell-inventories` | `/npc-spell-inventories` | — |
| 10 | `/npc-spell-inventories/:id` | `/npc-spell-inventories/38226` | row 1 of 77 |
| 11 | `/creature-spellbooks` | `/creature-spellbooks` | — |
| 12 | `/creature-spellbooks/:name` | `/creature-spellbooks/Mdeck-L-BR-DS-SylviaDrake-A-50` | row 1 of 134 |
| 13 | `/npc-drop-tables` | `/npc-drop-tables` | — |
| 14 | `/npc-drop-tables/:id` | `/npc-drop-tables/87112` | **synthesized** (0 corpus rows) |
| 15 | `/treasure-card-inventories` | `/treasure-card-inventories` | — |
| 16 | `/treasure-card-inventories/:id` | `/treasure-card-inventories/38214` | row 1 of 1 |
| 17 | `/zone-transfers` | `/zone-transfers` | — |
| 18 | `/zone-transfers/:name` | `/zone-transfers/WizardCity%2FWC_Hub` | row 1 of 1,205 — **URL-encoded**, the key contains a `/` |
| 19 | `/global-registry` | `/global-registry` | — |
| 20 | `/settings` | `/settings` | — |

Five extra paths: one **garbage path** (no route matches → the shell's own 404 page), three
**non-existent path parameters** (the route matches, the data does not), and one **unknown
`/api/` path** (must stay JSON, never the SPA shell).

## 1. Deep-linkable + refresh-safe: the HTTP level (SPA fallback)

A direct `GET` with `Accept: text/html` on every path, in both modes
(`/tmp/p5-08/http-sweep.sh`; the prod column compares the response body **byte-for-byte**
against `client/dist/index.html` with `cmp`, so "returns the shell" is a byte claim, not a
lookalike claim):

```
PATH                                   MODE  STATUS CONTENT-TYPE                    BYTES  SHELL  ==dist/index.html
/                                      PROD  200    text/html; charset=UTF-8        508    YES    YES
/quests/extract                        PROD  200    text/html; charset=UTF-8        508    YES    YES
/quests                                PROD  200    text/html; charset=UTF-8        508    YES    YES
/quests/DS-ACAD-C01-001                PROD  200    text/html; charset=UTF-8        508    YES    YES
/drop-tables                           PROD  200    text/html; charset=UTF-8        508    YES    YES
/drop-tables/DS-ACAD-C01-001           PROD  200    text/html; charset=UTF-8        508    YES    YES
/npc-inventories                       PROD  200    text/html; charset=UTF-8        508    YES    YES
/npc-inventories/87112                 PROD  200    text/html; charset=UTF-8        508    YES    YES
/npc-spell-inventories                 PROD  200    text/html; charset=UTF-8        508    YES    YES
/npc-spell-inventories/38226           PROD  200    text/html; charset=UTF-8        508    YES    YES
/creature-spellbooks                   PROD  200    text/html; charset=UTF-8        508    YES    YES
/creature-spellbooks/Mdeck-L-BR-DS-SylviaDrake-A-50 PROD  200  text/html; charset=UTF-8     508    YES    YES
/npc-drop-tables                       PROD  200    text/html; charset=UTF-8        508    YES    YES
/npc-drop-tables/87112                 PROD  200    text/html; charset=UTF-8        508    YES    YES
/treasure-card-inventories             PROD  200    text/html; charset=UTF-8        508    YES    YES
/treasure-card-inventories/38214       PROD  200    text/html; charset=UTF-8        508    YES    YES
/zone-transfers                        PROD  200    text/html; charset=UTF-8        508    YES    YES
/zone-transfers/WizardCity%2FWC_Hub    PROD  200    text/html; charset=UTF-8        508    YES    YES
/global-registry                       PROD  200    text/html; charset=UTF-8        508    YES    YES
/settings                              PROD  200    text/html; charset=UTF-8        508    YES    YES
/no-such-page-p508                     PROD  200    text/html; charset=UTF-8        508    YES    YES
/quests/__p508_no_such_quest__         PROD  200    text/html; charset=UTF-8        508    YES    YES
/drop-tables/__p508_missing__          PROD  200    text/html; charset=UTF-8        508    YES    YES
/zone-transfers/__p508_missing__       PROD  200    text/html; charset=UTF-8        508    YES    YES
/api/no-such-endpoint-p508             PROD  404    application/json; charset=utf-8 21     no     no
```

Dev (`:3032`), same 25 paths, same order:

```
PATH                                   MODE  STATUS CONTENT-TYPE                    BYTES  SHELL
/ … /zone-transfers/__p508_missing__   DEV   200    text/html                       665    YES   (24/24)
/api/no-such-endpoint-p508             DEV   404    application/json; charset=utf-8 21     no
```

**24/24 non-API paths in both modes: 200 + the SPA shell.** `/api/*` is a JSON 404 in both —
the fallback never swallows the API. The prod body is `cmp`-identical to `client/dist/index.html`
on all 24; the dev body is 665 B of dev HTML (Vite injects `/@vite/client` and the React
refresh preamble), which is why it is not compared to the built file.

Two further prod-only facts the same sweep had to prove, because they are the classic
"works in dev, broken release" pair:

```
$ curl -o /dev/null -w '%{http_code} %{content_type} %{size_download}\n' \
    http://localhost:3031/assets/index-CE_xEEtJ.js http://localhost:3031/assets/index-DBhfluGC.css
200 application/javascript; charset=UTF-8 770800
200 text/css; charset=UTF-8 36094
```

Both asset URLs the built shell references resolve, with the right content types.

## 2. Renders + hard refresh stays there: the browser level

Playwright (D23), per path: `goto` as a **cold deep link**, wait for `h1`, **wait for the page
to settle** (poll until no `Loading …` remains in `<main>`, ≤40×250 ms), record the single `h1`
(`Header`'s `pageTitleForPath`), then `reload()` and record again. Two things to be explicit
about, because getting them wrong would have produced a false result:

- **A cold deep link was used, never a client-side click.** `goto` on an absolute URL is the
  deep-link case: the document request is the one section 1 measured, and the client router
  then resolves it from scratch.
- **The first pass was too early and was discarded.** Sampling immediately after `h1` appeared
  caught list pages mid-skeleton (`/quests` read `All 0 … Loading quests…`, 55 chars). The
  settled poll above is what the numbers below are from; the discarded pass is mentioned here
  because the difference (55 → 2,498 chars) is exactly the shape of a false "prod is broken"
  finding.

Prod, 24/24 (`/tmp/p5-08` holds the same sweep run standalone):

| path | h1 (= expected) | settled `<main>` chars | h1 after reload | URL after reload | 404 `/api/` calls |
|---|---|---|---|---|---|
| `/` | Dashboard | 647 | Dashboard | `/` | 0 |
| `/quests/extract` | Extract Quests | 107 | Extract Quests | same | 0 |
| `/quests` | Browse Quests | 2,848 | Browse Quests | same | 0 |
| `/quests/DS-ACAD-C01-001` | Quest Detail | 933 | Quest Detail | same | 0 |
| `/drop-tables` | Drop Tables | 2,243 | Drop Tables | same | 0 |
| `/drop-tables/DS-ACAD-C01-001` | Drop Table Detail | 1,103 | Drop Table Detail | same | 0 |
| `/npc-inventories` | NPC Inventories | 1,806 | NPC Inventories | same | 0 |
| `/npc-inventories/87112` | NPC Inventory Detail | 464 | NPC Inventory Detail | same | 0 |
| `/npc-spell-inventories` | NPC Spell Inventories | 1,779 | NPC Spell Inventories | same | 0 |
| `/npc-spell-inventories/38226` | NPC Spell Inventory Detail | 1,003 | NPC Spell Inventory Detail | same | 0 |
| `/creature-spellbooks` | Creature Spellbooks | 2,285 | Creature Spellbooks | same | 0 |
| `/creature-spellbooks/Mdeck-L-…-A-50` | Creature Spellbook Detail | 591 | Creature Spellbook Detail | same | 0 |
| `/npc-drop-tables` | NPC Drop Tables | 253 | NPC Drop Tables | same | 0 |
| `/npc-drop-tables/87112` | NPC Drop Table Detail | 95 | NPC Drop Table Detail | same | 2 (expected: no such row) |
| `/treasure-card-inventories` | Treasure Card Inventory | 158 | Treasure Card Inventory | same | 0 |
| `/treasure-card-inventories/38214` | Treasure Card Inventory Detail | 20,305 | Treasure Card Inventory Detail | same | 0 |
| `/zone-transfers` | Zone Transfers | 3,369 | Zone Transfers | same | 0 |
| `/zone-transfers/WizardCity%2FWC_Hub` | Zone Transfer Detail | 6,401 | Zone Transfer Detail | same | 0 |
| `/global-registry` | Global Registry | 751 | Global Registry | same | 0 |
| `/settings` | Settings | 1,736 | Settings | same | 0 |
| `/no-such-page-p508` | Not found | 59 | Not found | same | 0 |
| `/quests/__p508_no_such_quest__` | Quest Detail | 69 | Quest Detail | same | 2 |
| `/drop-tables/__p508_missing__` | Drop Table Detail | 94 | Drop Table Detail | same | 2 |
| `/zone-transfers/__p508_missing__` | Zone Transfer Detail | 103 | Zone Transfer Detail | same | 2 |

- **20/20 routes: `h1` equals the route table's title, `<main>` is visible, the page is not the
  shell's 404, and the refresh lands on the same h1 and the same URL.** Every route renders
  real content — e.g. `/quests` settled at `All 328 Extracted 327 Reviewed 1 Verified 0` with a
  populated table, and `/zone-transfers/WizardCity%2FWC_Hub` at 6,401 chars with the decoded
  key `WizardCity/WC_Hub` in the breadcrumb, i.e. the encoded `%2F` survives the deep link.
- **The garbage path is the shell's own 404** (`Not found` / `No route matches this path.`, 59
  chars) and is stable across a refresh — the SPA fallback does not turn an unknown path into a
  blank page or into an API error.
- **A non-existent path parameter is not the 404 page.** `/quests/__p508_no_such_quest__`
  renders `Quest not found`, `/drop-tables/…` and `/zone-transfers/…` render `entry not found`:
  the route matched and the data did not `—` the correct distinction, and the reason those rows
  show 2 API 404s (the query's `retry: 1`).
- **The only console errors in all 24 paths are those 4 intentional API 404s** (2 requests × 2
  paths × 4 paths). No unexpected error, no failed asset.
- `NpcDropTable`'s zero rows and its absent directory (D71) are visible as `All 0 …` on the
  list route — rendered, not blank.

## 3. Dev vs prod: what was compared, and the difference found

The comparison was made **by the browser, in one session, alternating bases per route** — a
single Playwright run visited each path on `:3031` and then on `:3032`, normalized the settled
`<main>` text (relative times → `<rel>`, ISO timestamps → `<ts>`, whitespace collapsed) and
compared field by field. A human comparing two printed tables can miss a row; this cannot.

```
{"summary": {"routes": 24,
             "h1_match_expected": 24, "h1_equal": 24,
             "settled_text_equal": 24, "refresh_stable": 24,
             "api404_equal": 24, "url_equal": 24}}
```

**Compared, per route, all six equal on all 24 paths:**

1. the `h1` text, in both modes, against the route table's title;
2. the `h1` count (exactly one, both modes — D85's `page-has-heading-one` promotion holds in
   both);
3. the **settled `<main>` text, character for character** (e.g. `/` = 635 chars in both after
   normalization; `/treasure-card-inventories/38214` = 20,305 in both; `/npc-drop-tables` =
   253 in both) — this is the "the page shows the same thing" claim, not just "it returned 200";
4. the URL after the hard refresh, and that the h1 is unchanged by it;
5. the URL/route resolution (no route resolved differently in the two modes);
6. the per-route count of 404 API calls (0, or 2 for the four intentionally missing keys).

Plus, at the wire level, **10 API endpoints fetched through the dev proxy and directly from
prod, compared with `cmp`** (the AC's "dev proxy and prod serving behave identically" is about
the proxy too, not only the client):

```
/api/settings                              prod=   307 dev=   307 IDENTICAL
/api/dashboard                             prod=   679 dev=   679 IDENTICAL
/api/activity?limit=3                      prod=   716 dev=   716 IDENTICAL
/api/search?q=DS-ACAD-C01&limit=5          prod=  1779 dev=  1779 IDENTICAL
/api/search?q=&limit=20                    prod=    78 dev=    78 IDENTICAL
/api/quests?limit=2                        prod= 73207 dev= 73207 IDENTICAL
/api/status/quests?status=reviewed&limit=2 prod=   332 dev=   332 IDENTICAL
/api/names/items?limit=2                   prod=   108 dev=   108 IDENTICAL
/api/sync/status                           prod=    91 dev=    91 IDENTICAL
/api/status/_import                        prod=    45 dev=    45 IDENTICAL
```

10/10 byte-identical, including both endpoints AC3 documents (`/api/activity`, `/api/search`).

### The differences found (named, not glossed)

1. **`Content-Type` on the HTML document**: prod sends `text/html; charset=UTF-8`, Vite sends
   `text/html` with no charset. Same media type; a browser infers UTF-8 for HTML either way (and
   both documents declare `<meta charset="UTF-8">`), so no rendering difference — and none
   appeared in the 24/24 text equality above. This is the **only** wire-level difference found.
2. **The HTML body is not the same bytes**: prod serves the 508 B built shell, dev serves 665 B
   including `/@vite/client` and the React-refresh preamble. That is what the two modes *are*,
   not a behavioural difference; the comparison that matters (settled DOM text) is identical.
3. **The dev stack's Express also serves the built client on :3001** (`serving built client from
   …/client/dist` in `/tmp/p5-08/dev.log`), because a build existed in the tree when the dev
   stack booted. The dev *workflow* is still Vite on its own port, and the harness's official
   config boots the same command. Named because it makes ":3001 in dev" a poor proxy for "Vite
   is down" — the honest test of "without Vite" is that no Vite process was serving the port
   being probed, which is what D1b below records.
4. **Vite's history fallback does not require `Accept: text/html`** — with curl's default
   `Accept: */*` both modes still answered the shell for `/`, `/quests` and
   `/quests/DS-ACAD-C01-001`. Measured rather than assumed, because connect-history-api-fallback
   is widely documented to require that header.

**No functional difference was found in any route, in either direction.**

## Reproducing

```bash
# identity, then the wire sweep, then the browser sweep
cp data/spiraldb-ui.db /tmp/p5-08/scritch.db
PORT=3031 SPIRALDB_UI_DB=/tmp/p5-08/scritch.db npm start &          # prod
PORT=3001 VITE_PORT=3032 SPIRALDB_UI_DB=/tmp/p5-08/scritch.db npm run dev &   # dev
curl -s http://localhost:3031/api/settings      # assert the DB/identity above
/tmp/p5-08/http-sweep.sh http://localhost:3031 prod "$PWD/client/dist" PROD
/tmp/p5-08/http-sweep.sh http://localhost:3032 dev  -                  DEV
# then the in-browser A/B (the run_code block in this story's transcript)
```

PIDs were killed explicitly (never by pattern) and nothing of this story's was left listening.
---

# D1b — the same prod half on the AC's literal port, on the final tree

Part 1 ran prod on `:3031` because a sibling worker's stack held `:3001` (that worker's own
`npm run test:ui` webServer). The AC names `:3001`, so it was re-run **after this story's own
source changes** — the README/docs work plus the two cleanups (the dead-stub deletion and the
mobile spec's screenshot directory) — with `npm start` and **no `PORT`**, so Express took its
default:

```
$ SPIRALDB_UI_DB=/tmp/p5-08/scritch.db npm start          # PORT unset → 3001
[spiraldb-ui] database ready at /tmp/p5-08/scritch.db
[spiraldb-ui] first-startup import skipped (entry_status already has rows)
[spiraldb-ui] API listening on http://localhost:3001
[spiraldb-ui] serving built client from /home/jason/Documents/git-projects/spiraldb-ui/client/dist
```

The final-tree bundle is `client/dist/index.html` =
`8015cdb69b0be931c38bacfb6a0e644c014f348e9557452ec0b3fcaf70b42ade` (asset
`assets/index-NmSPrSJ5.js`, **769,166 B** — 1,634 B smaller than Part 1's, which is the deleted
`StubPage` + `SharedComponentsPreview`; the CSS chunk is unchanged at 36,094 B).

**"Without Vite" is asserted, not assumed.** At the moment of the sweep the only listeners were
`:3001` (this `npm start`, started 21:17:37) and `:5173` — and `:5173` is **not this project**:

```
$ curl -s http://localhost:5173/ | grep -o '<title>[^<]*'
<title>card-gatcha
```

No Vite process served the port under test, and no Vite process was started for this run.

## D1b.1 Deep-link / fallback sweep on :3001 — 24/24

`/tmp/p5-08/http-sweep.sh http://localhost:3001 prod "$PWD/client/dist" PROD`, all 24 non-API
paths: `200 text/html; charset=UTF-8`, 508 B, and `cmp`-identical to `client/dist/index.html`.
Every extra path answers exactly as in Part 1: the garbage path and the three missing path
parameters get the shell (200), and `/api/no-such-endpoint-p508` stays
`404 application/json` (21 B). Both new asset URLs resolve:

```
/assets/index-NmSPrSJ5.js  -> 200 application/javascript; charset=UTF-8 769166
/assets/index-DBhfluGC.css -> 200 text/css; charset=UTF-8 36094
```

## D1b.2 Browser sweep on :3001 — 24/24, and no stub text anywhere

Cold deep link, settle poll, `h1`, `reload()`, re-read:

```
{"summary": {"routes": 24, "h1Exact": 24, "oneH1": 24,
             "refreshStable": 24, "anyStubText": 0}}
```

- 20/20 routes: `h1` exactly the route table's title, exactly one `h1`, refresh lands on the same
  `h1` and the same URL, `<main>` settled (e.g. `/quests` 2,848 chars, `/treasure-card-inventories/38214`
  20,305, `/zone-transfers/WizardCity%2FWC_Hub` 6,401).
- The garbage path is the real 404 page (`Not found`, 59 chars, `spa404: true`); the three missing
  path parameters are the route-specific not-found states (69 / 94 / 103 chars).
- **`anyStubText: 0`** — the string `Arrives in Phase N` appears on no page. That is the cleanup
  measured end to end: `StubPage` and `SharedComponentsPreview` are deleted, and `elementFor`'s
  unreachable `default:` now renders `NotFoundPage`.

The single console error in the run is the expected `404` for the last path's non-existent API
row; no failed asset and no unexpected error appeared.
