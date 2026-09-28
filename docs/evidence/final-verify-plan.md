# final-verify — plan, method, and the 33-step inventory

Gate 3/3 of the ultragoal final gate (`final-deslop` → `final-review` → `final-verify`).
Written **before** any step was re-run, so the inventory below is not fitted to the results.

- `HEAD` at start: `f7e7004f3b36a01f113fc3355c72ba4df1e96f02` ("final-review second pass: APPROVE,
  with the fixes verified independently"), branch `main`.
- `git status --porcelain` **before** the sweep: empty (no tracked or untracked change).
- Environment: node `v24.21.0`, npm `11.19.0`, dotnet `9.0.318`.
- **D84(a) honoured**: nothing is committed and no git write beyond reading was performed. The
  new `docs/evidence/final-verify-*` files are left as untracked working-tree artifacts for the
  next gate to decide about.

## How each step is reported

For every step: the **command or action**, its **raw output** (a file under `docs/evidence/`
named `final-verify-…`), and a verdict of **pass** / **fail** / **not-reproducible** with the
reason. A step that could not be run is **reported, never ticked**. Where the only support for a
step is an earlier story's claim, that is said and the step is marked **re-read**, not re-run.

Every `rc` is captured **on the command itself**, never on a pipeline's tail. Where a command is
a pipeline, the transcript carries the producer's own `rc=$?` line before the pipe is read, so a
failing arm cannot be flattened into a `0` by `tee`/`tail`.

## The 33 steps, read from each plan's own Verification Steps section

Counts: **P1 7 + P2 8 + P3 6 + P4 6 + P5 6 = 33**.

| # | Step (verbatim gist) | Evidence file |
|---|---|---|
| P1-1 | `rm -rf data && npm run sync` → counts; `sqlite3 … select count(*) from items` etc. | `final-verify-p1.txt` |
| P1-2 | `curl -s localhost:3001/api/names/items \| head -c 400` → shape | `final-verify-p1.txt` |
| P1-3 | `curl -s localhost:3001/api/status/all \| jq .summary` → totals vs file counts | `final-verify-p1.txt` |
| P1-4 | PATCH then history via curl; verify `status_history` row | `final-verify-p1.txt` |
| P1-5 | `npm test` → all unit tests green | `final-verify-p1.txt` |
| P1-6 | UI walkthrough via playwright-mcp (shell → settings → sync → toast; dropdown smoke) | `final-verify-p1-ui.md` |
| P1-7 | `npm run test:ui` → shell spec green headless | `final-verify-p1.txt` |
| P2-1 | `dotnet --version` → 9.x; `npm run build:cli && npm run build:fixturegen` → binaries exist | `final-verify-p2.txt` |
| P2-2 | `fixturegen … --output /tmp/cap.json`; `imview-packet-reader --input … \| jq 'length'` → round trip | `final-verify-p2.txt` |
| P2-3 | `curl -F "file=@…" localhost:3001/api/extract/quests \| jq .count` | `final-verify-p2.txt` |
| P2-4 | UI: upload → results → Save All (2 quests) → confirm | `final-verify-p2.md` / `.txt` |
| P2-5 | test clone: `git branch --show-current`; `git log --format='%s (%an)' -2`; `ls …` | `final-verify-p2.txt` |
| P2-6 | `node -e JSON.parse(…)` → no throw (clean JSON) | `final-verify-p2.txt` |
| P2-7 | `curl …/api/status/quests/{name}/history \| jq` → extracted row with capture note | `final-verify-p2.txt` |
| P2-8 | `npm test` green; browser walkthrough upload → browse → detail → mark reviewed | `final-verify-p2.md` |
| P3-1 | `grep -rho '"\$type": *"[^"]*"' …QuestTemplates/ \| sort \| uniq -c` vs `typeConstants.ts` | `final-verify-p3.txt` |
| P3-2 | `npm test` → round-trip suite reports `322 passed` | `final-verify-p3.txt` |
| P3-3 | Manual: edit → save → `git -C data/test-spiraldb diff HEAD~1 -- …` → only intended fields | `final-verify-p3.txt` |
| P3-4 | Manual: load the saved quest back → form state identical | `final-verify-p3.txt` |
| P3-5 | Validation negatives via UI and curl | `final-verify-p3.txt` |
| P3-6 | Flowchart/requirement/dialog walkthrough on 2–3 diverse real quests via Playwright MCP | `final-verify-p3-ui.md` |
| P4-1 | `npm test` → extended round-trip suites green per type (counts vs `ls \| wc -l`) | `final-verify-p4.txt` |
| P4-2 | Per-type smoke loop: list → open → edit → save → `git log -1` → `diff --stat` | `final-verify-p4.txt` |
| P4-3 | Create-one-new-entry loop per type; filenames vs data-model L173–187 | `final-verify-p4.txt` |
| P4-4 | Validation negatives (curl 400s + UI inline errors) for the DropTable cases | `final-verify-p4.txt` |
| P4-5 | GlobalRegistry merged output vs editor table; `git status` shows only the merge | `final-verify-p4.txt` |
| P4-6 | Playwright viewport passes 375/768 + `npm run test:ui` green | `final-verify-p4.txt` |
| P5-1 | `npm test` → all suites (regression + envelope audit) green | `final-verify-p5.txt` |
| P5-2 | Two-browser session: status change in one, feed/dashboard updates in the other | `final-verify-p5-two-browser.txt` |
| P5-3 | `npm run build && npm start` → `curl localhost:3001/quests` returns index.html | `final-verify-p5.txt` |
| P5-4 | Playwright viewport passes 375/768/1440 across the route checklist | `final-verify-p5.txt` |
| P5-5 | Playwright-driven axe scan on the four named pages | `final-verify-p5.txt` |
| P5-6 | Fresh-clone dry run in `/tmp` per 5.8, timed | `final-verify-p5-fresh-clone.txt` |

## Rig hygiene (no new dependency, no stray listener)

- Ports are taken from the repository's own harness where one exists (`playwright.config.ts`
  fixes `5181`; `tests/ui/p4-10-altport.config.ts` and `p4-09-live.config.ts` name theirs) and
  otherwise chosen fresh and recorded.
- Every rig is killed **by explicit PID**. `pgrep -f` with the pattern on my own command line is
  never used.
- `[::1]:5173` is the **owner's** Vite dev server and is never touched. `:3001` is only used by
  the harness's own dev stack (which binds the isolated `SPIRALDB_UI_DB`).
- No dependency is added.

## The carried intermittent families (attributed, carried, never patched)

1. the extraction toast/pointer overlap,
2. the drag/spec family — residual is the S1 **false red** (remedy recorded, not applied),
3. a 60 s filechooser wait,
4. a dev-stack death, which is **discarded and re-run**, never reported as a failure.

## One fix this sweep carries

`tests/ui/a11y-reduced-motion.spec.ts` writes its six screenshots into the **tracked**
`docs/evidence/phase-5/`, so an official `npm run test:ui` modifies committed files. Fixed the
same way `object-mobile.spec.ts` was fixed (a gitignored output path), and proven by a
before/after snapshot of every tracked evidence path. **The already-committed PNGs stay
committed and byte-identical** — the fix redirects future writes, it does not gitignore history.

## Two smaller findings (non-blocking)

- `server/src/services/savePipeline.ts` — the `written` ledger is appended after a successful
  write, so an ENOSPC-class failure rethrows bare. Disposition in `final-verify-findings.md`.
- `server/src/services/git.ts` — `slice(0, 255)` can split a surrogate pair. Disposition in
  `final-verify-findings.md`.

## Explicitly **not** mine to fix (recorded so the ledger is complete)

- the **pre-existing** duplicate-target warning emitted *before* the save, so a failing save
  still claims it updated;
- the S1 drag-arm residual — a **false red** whose false-pass path is already closed, remedy
  recorded in `final-verify-findings.md` (wait on the panel's own success toast before reading
  the clipboard; assert the copied text contains the edit under test; **do not** raise the
  card-order poll).