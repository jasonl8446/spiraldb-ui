# Story p1-12 — CI pipeline live for real (plan task 1.9, D24-amended)

Commit `4e84ce1` (`.github/workflows/ci.yml`). The Phase-1 PR's **own** check run
does not exist until the PR opens at the `gate-1` story, so this story (a) makes the
workflow provably correct and (b) produces the strongest available local proxy: a
fresh clone that simulates a GitHub runner (no `node_modules`, no `data/`, no
`tools/.playwright-browsers` — all gitignored, exactly like a runner). The lead
treats the simulation below as p1-12's evidence; the real check run confirms it at
`gate-1`.

## Machine-readable validation

A YAML syntax error produces **no check run at all**, so the required `ci` check
would simply never appear and a gate story would poll forever. Parsed with
`python3 -c "yaml.safe_load"` (pyyaml 6.0.3):

```
top-level keys : ['name', True, 'concurrency', 'jobs']
trigger        : ['pull_request']
jobs keys      : ['ci']
job[ci] runs-on   : ubuntu-24.04
job[ci] has name? : False    <- must be False: the context is the job key
job[ci] steps     :
    1. uses: actions/checkout@v4
    2. Detect Node project
    3. uses: actions/setup-node@v4
    4. Install dependencies
    5. Unit tests
    6. Build
    7. Lint and formatting
    8. Typecheck tests
    9. Install headless chromium
   10. UI tests
concurrency    : {'group': 'ci-${{ github.ref }}', 'cancel-in-progress': True}
```

`top-level keys` shows `True` where `on` should be: pyyaml implements YAML 1.1,
where the bare key `on` is the boolean `true`. That is a parser quirk, not a file
defect — GitHub's own parser reads `on` as the literal string and the trigger is
`pull_request`. Anything keyed off it must read `d[True] or d['on']`.

**No job `name:` — verified.** Branch protection's required context is literally
`ci`; GitHub derives the context from the job key when the job declares no `name:`.
A job-level `name:` would silently change the context, no check run would ever
satisfy the protection, and every gate-story merge would fail with HTTP 405
forever. The parser prints `job[ci] has name? : False` and the file itself carries
the warning comment.

## Clone simulation (the core evidence)

Two runs. Run 2 is the runner-faithful one; run 1 is why it had to be repeated.

```bash
BASE=/tmp/p1-12-sim-$(date +%s)          # run 2
CLONE=$BASE/spiraldb-ui                  # basename == repo name (run 2, see below)
git clone --local --branch phase-1-foundation . "$CLONE"
```

Run 2's clone path mirrors `actions/checkout`, which places the repo at
`$GITHUB_WORKSPACE` = `/home/runner/work/spiraldb-ui/spiraldb-ui` — the **directory
basename equals the repo name**. Run 1 used `/tmp/ci-sim-<epoch>` and hit a
location-dependent test assertion (below), so run 2 reproduces the runner's layout
to give every step a fair verdict.

Clone preflight, run 2 — `git status --short` empty, HEAD `4e84ce1`, 151 tracked
files, and the runner-like absences proven rather than assumed:

```
ABSENT  (as on a runner): node_modules
ABSENT  (as on a runner): data
ABSENT  (as on a runner): tools
ABSENT  (as on a runner): tools/.playwright-browsers
ABSENT  (as on a runner): .npm-cache
ls: cannot access 'data': No such file or directory
```

`server/src/db.ts` L121 `fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })`
makes the missing `data/` fine — **proven in the clone**, not assumed, twice over:

1. The green `npm test` (510 passed) recreated it: `tests/unit/db.test.ts:66` and
   `settings.test.ts:65` both compute
   `SCRATCH_ROOT = path.join(resolveRepoRoot(), 'data', '__test-scratch__')` and
   `fs.mkdirSync(SCRATCH_ROOT, { recursive: true })` — against the **clone's**
   `resolveRepoRoot()`, i.e. into a `data/` directory that did not exist.
2. The UI run's webServer opened the real database in the clone, verbatim from
   `11-test-ui-workaround.log`:

   ```
   [WebServer] [server] [spiraldb-ui] database ready at /tmp/p1-12-sim-1790402563/spiraldb-ui/data/spiraldb-ui.db
   [WebServer] [server] [spiraldb-ui] API listening on http://localhost:3001
   ```

   `data/` did not exist in the preflight `ls`, and the server still opened
   `<clone>/data/spiraldb-ui.db` — only possible because L121's `mkdirSync`
   created the directory first. `SPIRALDB_UI_SKIP_IMPORT=1` (the webServer command)
   is what keeps that database empty instead of triggering the 22 s first-startup
   import against an absent sibling `spiraldb` repo (D37 / D40).

| # | step (`ci.yml` name) | command | exit | wall | result |
|---|---|---|---|---|---|
| 01 | — | preflight (`git status`, `ls`) | 0 | 23 ms | clean tree, no `node_modules`/`data/`/`tools/` |
| 03 | Install dependencies | `npm ci` | 0 | 21.8 s | `added 492 packages, and audited 493 packages in 22s` |
| 04 | Unit tests | `npm test` | 0 | 1.5 s | `Test Files 20 passed (20)` · `Tests 510 passed (510)` |
| 05 | Build | `npm run build` | 0 | 4.1 s | `tsc -p server` + `tsc -p client --noEmit` + `vite build` |
| 06 | Lint and formatting | `npm run lint` | 0 | 2.8 s | `eslint .` 0 · `All matched files use Prettier code style!` |
| 07 | Typecheck tests | `npm run typecheck:tests` | 0 | 1.5 s | `tsc -p tests/tsconfig.json --noEmit` 0 |
| 08 | Install headless chromium | `npm run test:ui:install` | 0 | 107.4 s | `Chrome Headless Shell 153.0.8010.12 (playwright chromium-headless-shell v1243) downloaded to $CLONE/tools/.playwright-browsers/chromium_headless_shell-1243` |
| 09 | — | `ls -d tools/.playwright-browsers/*` | 0 | 43 ms | workspace-local destination proven |
| 10 | UI tests (as CI) | `CI=true npm run test:ui` | 1 | 6.2 s | `8 failed` — host-only, see below |
| 11 | UI tests (host workaround) | `CI=true npm run test:ui` | 0 | 9.4 s | `8 passed (9.0s)` |
| 12 | — | `ss -ltn \| grep -E ':(3001\|5173)'` | 0 | 1.0 s | ports free |

Whole run 2: 02:02:43 → 02:05:22 (2 min 39 s, of which the chromium download is
107 s).

`npm ci` details: the lockfile was **not** modified (`git status --short
package-lock.json package.json` empty afterwards), and the committed `.npmrc`'s
workspace-local cache was created fresh and populated (`60M $CLONE/.npm-cache` —
expected in a clone, and the proof the committed `.npmrc` works where `$HOME` is
not writable). npm 11.19 also printed `npm warn install-scripts 3 packages have
install scripts not yet covered by allowScripts` (`better-sqlite3`,
`esbuild@0.21.5`, `esbuild@0.28.2`) — informational, not a failure: the very next
step's 510 tests open real SQLite databases, and `npm run build` runs `vite build`
through esbuild. `npm audit` reports 6 pre-existing advisories (5 moderate, 1 high)
which this story does not touch (dependency changes are out of scope).

### Destination proof: the browsers went to the workspace path

```
--- ls -d tools/.playwright-browsers/* ---
tools/.playwright-browsers/chromium-1243
tools/.playwright-browsers/chromium_headless_shell-1243
tools/.playwright-browsers/ffmpeg-1011
--- destination proof ---
OK: binary is at $PWD/tools/.playwright-browsers (workspace-local, not ~/.cache/ms-playwright)
/home/jason/.cache/ms-playwright
WARNING: ~/.cache/ms-playwright exists
--- fresh (unpatched) RUNPATH ---
RUNPATH: <none>
```

`~/.cache/ms-playwright` **does** exist on this host (from an unrelated install),
and the fresh clone's browser still landed in `$PWD/tools/.playwright-browsers`:
the npm scripts really are the single source of truth, and a stray default-path
cache cannot shadow them (D40 item 2). The freshly downloaded binary carries
`RUNPATH: <none>` — the workspace copy's is a host patch (below).

## The host-only launch failure, exact and labelled

**RUN A — the step exactly as CI runs it** (`CI=true`, no workaround), exit 1:

```
[pid=1273272][err] /tmp/p1-12-sim-1790402563/spiraldb-ui/tools/.playwright-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell: error while loading shared libraries: libglib-2.0.so.0: cannot open shared object file: No such file or directory
    Error: browserType.launch: Target page, context or browser has been closed
  8 failed
```

(all 8 specs failed, and each was retried once because `retries: CI ? 1 : 0`.)

**The workaround**, then **RUN B — same step, same command**, exit 0:

```
Running 8 tests using 1 worker
  ✓  1 [chromium] › tests/ui/shell.spec.ts:189:3 › sidebar navigation › every route is reachable, renders a real page, and highlights its item (5.4s)
  ✓  2 [chromium] › tests/ui/shell.spec.ts:233:3 › sidebar navigation › collapsing a group hides its items and flips aria-expanded (329ms)
  ✓  3 [chromium] › tests/ui/shell.spec.ts:258:3 › sidebar navigation › a nested route highlights exactly one item — itself, or the list item that owns it (441ms)
  ✓  4 [chromium] › tests/ui/shell.spec.ts:292:3 › sidebar navigation › a non-root deep link is served the SPA shell, and an unknown path is the SPA 404 (431ms)
  ✓  5 [chromium] › tests/ui/shell.spec.ts:316:3 › header sync › the Sync button spins while the request is in flight, then toasts the counts (349ms)
  ✓  6 [chromium] › tests/ui/shell.spec.ts:357:3 › settings › renders the settings values, the last sync and the history (287ms)
  ✓  7 [chromium] › tests/ui/shell.spec.ts:376:1 › the dev stack answers a real API request through the Vite proxy (248ms)
  ✓  8 [chromium] › tests/ui/shell.spec.ts:388:3 › harness self-check › the console-error guard itself is live (231ms)
  8 passed (9.0s)
```

The workaround replicates the **workspace commit's** host patch onto the clone's
download only: read the workspace tree for every file whose `readelf -d` RUNPATH
contains `/nix/store/` (11 files, listed below), then `patchelf --set-rpath <same>`
each corresponding file **in the clone**. The lead's gitignored
`tools/.playwright-browsers/` tree was never written to — its
`chrome-headless-shell` mtime is still `2026-09-26 01:38:26`, the pre-run value:

```
chromium-1243/chrome-linux64/{chrome,chrome_crashpad_handler,libEGL.so,libGLESv2.so,libvk_swiftshader.so,libvulkan.so.1}
chromium_headless_shell-1243/chrome-headless-shell-linux64/{chrome-headless-shell,libEGL.so,libGLESv2.so,libvk_swiftshader.so,libvulkan.so.1}
```

This is a **host artifact**: CI's `ubuntu-24.04` ships those libraries, and the
unpatched RUN A is what a runner does *not* look like. README L80 documents it.

## Defect the simulation found (loudly, not silently fixed)

Run 1 (`/tmp/ci-sim-<epoch>`) failed a **unit** step for a non-host reason:

```
 FAIL  tests/unit/db.test.ts > repo root resolution > finds the project root and the default/test-spiraldb paths under it
AssertionError: expected 'ci-sim-1790402356' to be 'spiraldb-ui' // Object.is equality
 ❯ tests/unit/db.test.ts:369:37
    369|     expect(path.basename(repoRoot)).toBe('spiraldb-ui');

 Test Files  1 failed | 19 passed (20)
      Tests  1 failed | 509 passed (510)
```

Root cause: `server/src/db.ts` `resolveRepoRoot()` walks up until it finds a
`package.json` whose `name === 'spiraldb-ui'` — content-based and
location-independent, which is correct. The **test** then asserts an incidental
property of where the checkout happens to live: the containing directory's
basename.

Measured twice, on two different path shapes:

| checkout path | basename | `tests/unit/db.test.ts:369` |
|---|---|---|
| `…/git-projects/spiraldb-ui` (this repo) | `spiraldb-ui` | pass |
| `/tmp/p1-12-sim-<ts>/spiraldb-ui` (run 2) | `spiraldb-ui` | pass |
| `/tmp/ci-sim-<epoch>` (run 1) | `ci-sim-1790402356` | **fail** |
| `<tmp>/.omd/worktrees/run-abc12345` (run 3) | `run-abc12345` | **fail** |

Run 3 used a plain local clone at the c5 team-run-tree path shape (no git worktree
was created — `git worktree list` still shows only the main worktree, and the repo
was untouched).

**Impact.** On the real runner it passes. `actions/checkout` "checks-out your
repository under `$GITHUB_WORKSPACE`" and its `path` input defaults to `''` (i.e.
`$GITHUB_WORKSPACE` itself) — [actions/checkout README](https://raw.githubusercontent.com/actions/checkout/refs/heads/main/README.md)
— and on a GitHub-hosted runner `$GITHUB_WORKSPACE` is
`/home/runner/work/<repo>/<repo>`, so the basename is `spiraldb-ui` and the
`gate-1` check run is not blocked by this. That last step is the hosted-runner
convention rather than something the action's README states, and it is the one
link in this chain that only the real check run can confirm.

But the assertion fails for *any* checkout whose directory is not named
`spiraldb-ui` — a second clone (`spiraldb-ui-2`), and notably the **c5
worktree-isolation scheme**, which creates `.omd/worktrees/{run-id}` (measured:
run 3 above): a team run would go red on `npm test` for a reason that has nothing
to do with its change.

Scope for this story is `.github/workflows/ci.yml` (+ this evidence file) with
"**no** app/server/test/client changes", and the brief says to report an app/test
defect loudly rather than fix it silently because the lead decides. So it is
**reported, not fixed**: `tests/unit/db.test.ts:369` should assert something the
code guarantees (e.g. that `repoRoot` contains the expected relative paths, or
that the manifest's `name` is `spiraldb-ui`) rather than the directory's basename.

## What else was considered and not added

- **`actions/checkout` `fetch-depth: 0`** — not needed: no workflow step reads git
  history (no `simple-git`/`git log`/`git rev-parse` use in `tests/**` or
  `server/src/**`), and the default depth-1 clone was enough for every step above.
- **`timeout-minutes`** — not needed: the full simulated run is 2 min 39 s against
  GitHub's default 360-minute job timeout.
- **`permissions: contents: read`** — upstream `actions/checkout` *recommends* it
  ("Recommended permissions" in its README), so it was a real candidate; it is not
  applied here because no step needs it to pass, the brief allowed exactly one
  optional hardening, and a token-permission change is a separate decision. Flagged
  as a follow-up, not silently added.
- **A second job / a matrix / coverage / deploy** — explicitly out of scope.

## Cleanup

Each run's clone reached `979M` (`node_modules` + `.npm-cache` + the browser
download), and was removed: `du -sh` taken first, `rm -rf` after, then
`ls -d /tmp/p1-12-sim-*` verified no clone directory survives. Ports were free
after both UI runs (`ss -ltn | grep -E ':(3001|5173)'` empty, checked again a
second later), no dev-stack process was left behind, the lead's gitignored
`tools/.playwright-browsers/` tree is intact (`659M`, mtime unchanged), and
`/tmp/wad-spike` + `/tmp/wad-raw` were not touched.

## Reproduce

```bash
BASE=/tmp/p1-12-sim-$(date +%s); CLONE=$BASE/spiraldb-ui
git clone --local --branch phase-1-foundation . "$CLONE"   # basename == repo name, like a runner
cd "$CLONE"
npm ci && npm test && npm run build && npm run lint && npm run typecheck:tests
npm run test:ui:install        # -> tools/.playwright-browsers (gitignored, workspace-local)
npm run test:ui                # on NixOS this doc's host workaround is required; CI needs none
```
## Certification status (lead, D41)

The **deliverable** is complete and pre-verified: `ci.yml` enforces the full gate
list (the AC's five steps in order plus `npm run lint` and
`npm run typecheck:tests`), the job key stays bare `ci` (no job-level `name:` — it
would silently change the required check-run context), `runs-on` is pinned to
`ubuntu-24.04`, and the runner-faithful clone simulation above is green on every
step except the documented NixOS host library artifact.

The AC's named evidence is **the Phase-1 PR's own check run**, which cannot exist
until the `gate-1` story opens that PR. Per D41 the ledger entry therefore stays
**open** until that run is green; `gate-1` records the run here as this story's
evidence *before* merging, and no story is certified on a local proxy.

The simulation also exposed a real defect, fixed in `5498fe1`: `tests/unit/db.test.ts`
asserted `path.basename(resolveRepoRoot()) === 'spiraldb-ui'` although
`resolveRepoRoot` matches on manifest content — it would have failed `npm test` for
every story run from the c5 worktree layout (`.omd/worktrees/{run-id}`). Verified:
1 failed before → 20 passed after in a differently-named clone, and 20 passed in the
worktree shape.
