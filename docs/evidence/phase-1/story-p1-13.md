# Story p1-13 — UI test harness, D23 tier 1 (plan task 1.10)

Commits `96cb0bb` (harness + spec + ci.yml install-step fix) and `b57e89f` (the
defect it found, fixed). Lead-verified locally; the PR's own check run is verified
by story p1-12.

```
$ npm run test:ui
Running 8 tests using 1 worker
  ✓ 1 sidebar navigation › every route is reachable, renders a real page, and highlights its item (5.3s)
  ✓ 2 sidebar navigation › collapsing a group hides its items and flips aria-expanded (379ms)
  ✓ 3 sidebar navigation › a nested route highlights exactly one item — itself, or the list item that owns it (457ms)
  ✓ 4 sidebar navigation › a non-root deep link is served the SPA shell, and an unknown path is the SPA 404 (426ms)
  ✓ 5 header sync › the Sync button spins while the request is in flight, then toasts the counts (405ms)
  ✓ 6 settings › renders the settings values, the last sync and the history (273ms)
  ✓ 7 the dev stack answers a real API request through the Vite proxy (232ms)
  ✓ 8 harness self-check › the console-error guard itself is live (256ms)
  8 passed (9.1s)                      # headless chromium, auto-started stack, ports free after
```

Other gates: `npm test` **510 passed** · `npm run lint` 0 · `npm run typecheck:tests`
0 · `tsc -p server` 0 · `tsc -p client` 0 · `npm run build` 0.

## The harness

`playwright.config.ts`: `testDir: tests/ui`, chromium headless only,
`baseURL: http://localhost:5173` (Vite binds `[::1]` only — D38, never 127.0.0.1),
`retries: CI ? 1 : 0`, `trace: on-first-retry`, `list` + html reporters into
`playwright-report/`, and `webServer` = `SPIRALDB_UI_SKIP_IMPORT=1 npm run dev`
with `reuseExistingServer: !CI` (measured boot **0.9 s** against a 120 s timeout).
`@playwright/test` is pinned **exactly** (`1.63.0` → chromium revision 1243).

**One source of truth for the browsers**, because the install and the run must not
disagree:

```
"test:ui":         "PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers playwright test"
"test:ui:install": "PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers playwright install chromium"
```

and `ci.yml`'s install step now calls `npm run test:ui:install`. Before that change
the workflow's bare `npx playwright install chromium` wrote to the *default*
`~/.cache/ms-playwright` while the config pointed Playwright at the workspace path
— `npm run test:ui` in CI would simply have found no browser. That mismatch would
have failed the Phase-1 PR's check run, so it is fixed here rather than discovered
at the gate.

The specs are **hermetic** (D40): `/api/sync` and `/api/settings` are route-mocked,
and the webServer skips the first-startup import, so the suite needs no sibling
repos, no WAD data, no 22 s sync and no pre-existing database. A fresh CI runner is
therefore a supported environment. The real sync path stays covered by
`docs/evidence/phase-1/story-p1-10.md` (tier 2) and the sync unit tests.

## The defect the harness caught — and that the lead missed

`tests/ui/shell.spec.ts` failed on its first real run: on `/quests/extract` **two**
sidebar items were highlighted. Cause: `Sidebar.tsx` took its highlight from
`NavLink`'s prefix `isActive`, so `/quests` matched while on `/quests/extract`; the
already-correct `activeNavPath` helper existed but was never wired in. Adding `end`
to every link would have been wrong — detail routes legitimately highlight their
list item.

Lead re-measurement in a real browser **after** the fix (computed styles, 16
pathnames, `aria-current` checked too):

```
/                                            -> [Dashboard]               (1) aria-current=[Dashboard]
/quests                                      -> [Browse Quests]           (1)
/quests/extract                              -> [Extract Quests]          (1)   # was [Extract Quests, Browse Quests]
/quests/DS-ACAD-C01-001                      -> [Browse Quests]           (1)   # detail route preserved
/drop-tables/ABC                             -> [Drop Tables]             (1)
/zone-transfers/WizardCity%2FWC_Hub          -> [Zone Transfers]          (1)
/settings                                    -> [Sync Friendly Names]     (1)
...
/questsfoo                                   -> []                        (0)   # segment boundary -> "Not found", correct
```

Every real route: exactly one active item **and** exactly one `aria-current`.
Screenshot: [`p1-13-01-one-active-nav.png`](./p1-13-01-one-active-nav.png).

A spec must never pin a known defect as expected, so the `KNOWN DEFECT` test and
its `expectedActive = path === '/quests/extract' ? 2 : 1` special case were deleted
and replaced by an exactly-one-active assertion across every route, plus a nested
regression test covering both `/quests/extract` and a detail route.

## Tests are now typechecked

`tests/tsconfig.json` covers `tests/**` + `playwright.config.ts` with the same
`@shared/*`/`@server/*` aliases the other configs use, exposed as
`npm run typecheck:tests`. `tests/unit/**` had been covered by **no** tsconfig, and
that coverage immediately found **4 genuine type errors** (`naming.test.ts:258,259`,
`unpack.test.ts:121,122`), now fixed behaviour-identically.

Counter-intuitive lesson worth keeping: an *incorrect* ad-hoc tsc invocation
(missing path aliases) reports **106** errors of which those 4 real ones are
**invisible** — unresolvable imports degrade to `any` and mask the defect. Missing
aliases are a noisy **false-negative**, not the false-positive one would assume.

## Host note

On this NixOS host `chromium_headless_shell` fails to launch
(`error while loading shared libraries: libglib-2.0.so.0`). The harness works via a
host-local patch inside the gitignored `tools/.playwright-browsers/` tree; CI
(`ubuntu-latest`) is unaffected, and re-running `npm run test:ui:install` would drop
that local patch. Documented in the README.

## Reproduce

```bash
npm run test:ui:install     # chromium into tools/.playwright-browsers (gitignored)
npm run test:ui             # auto-starts the dev stack, headless chromium
npm test                    # 510 unit tests
```
