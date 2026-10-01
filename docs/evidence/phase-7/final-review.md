# final-review (Phase 7 final gate 2/3): the independent review, recorded RAW

**Reviewer:** a fresh-context `code-reviewer` subagent (opus), read-only, on branch `final-gate-7` at `cad7281`, 2026-10-01.
**Round 1 verdict:** CHANGES REQUIRED (M1, M2, M3). The text below is the reviewer's report, verbatim. The fix work
and the re-review follow in later sections.

---

## Round 1: the reviewer's report (verbatim)

## Code Review Summary — `final-review` (Phase 7 final gate 2/3)

**Scope reviewed:** `git diff 3451c88..HEAD` (HEAD `cad7281`, 432 files), the security-touching server/shared/script/client paths, `docs/evidence/phase-7/{pr14-review-fixes,gate-7,final-deslop}.md`, D141/D163/D168/D195. Nothing edited, committed or pushed.

**Method:** reproductions with the real modules (real routers via supertest, `createSavePipeline`/`createGitService` against real `git init` repos, an in-memory DB). Repro files: `/tmp/claude-1000/-home-jason-Documents-git-projects-spiraldb-ui/02fd355f-842d-451a-968b-024163d5c555/scratchpad/repro/` (`scaffold.test.ts`, `concurrent.test.ts`, `csrf.test.ts`, `detached.test.ts`). Also ran 10 security-touching project suites (p7-drafts, write-route-branch-guard, p7-accept, git-service, save-pipeline, naming, quests-api, census-service, extract-api, server-security-posture): **10 files / 244 tests passed**. Ports 3001/5173 and 3181/5181 untouched; the D17 clone untouched.

### Issues by severity
- CRITICAL: 0
- MAJOR: 3 (all block approval)
- MINOR: 3
- NIT: 2

### MAJOR

**[MAJOR] M1 — `POST /api/quests/scaffold` silently overwrites a quest that was authored since it was scaffolded.**
File: `server/src/services/questScaffold.ts:456`. The non-naming branch refuses only on `catalogRow.has_definition === 1`, a sync-owned column that stays `0` until the next sync. The naming branch (`:433`) and `GET /:name/scaffold` (`server/src/routes/quests.ts:325-330`) also check `index.pathFor`; this branch does not.
Confidence: HIGH (reproduced).
Scenario: Catalog → Scaffold `X`, edit and save `X` in the editor (`m_questLevel: 42`, a title), then (no sync in between; the Catalog still lists `X` as missing with its Scaffold button) Scaffold `X` again. The server answers `200 {"outcome":"created","action":"update","msg":"spiraldb: update quest FX-REVIEW-001"}`, and the file afterwards holds `m_questLevel 0`, `m_questTitle null`: the authored values are replaced by skeleton defaults and committed. The old content survives only in git history. The same gap turns a draft's first save that is POSTed to `/scaffold` with a `quest` document (a second tab, or a retry after a lost response) into an update; that is not fatal, because the document is the same. It also makes the D195(c) client branch (which assumes the server says 409 here; the comment at `client/src/pages/QuestDetailPage.tsx:538` "can only be refused again") false until a sync. The response's hardcoded `outcome: 'created'` (`questScaffold.ts:537`) misreports it.
Fix: in the non-naming branch, refuse 409 when `index.pathFor('questtemplates', name) !== undefined`, exactly as `:433` and the GET route do (optionally make the pipeline refuse `action:'create'` when the key is already indexed), and report `result.outcome`.
Note: the bare-scaffold gap predates Phase 7 (Phase 6), but Phase 7's draft saves and the D195(c) recovery depend on it.

**[MAJOR] M2 — Concurrent saves are not serialised: one commit swallows another save's files, and the second save reports success with an empty sha.**
File: `server/src/services/savePipeline.ts:476` (`assertClean`) → `server/src/services/git.ts:501-505`. There is no mutex around guard → write → `git add` → `git commit`, and `client.commit(message)` commits the whole index rather than this save's paths. `result.commit` is never checked.
Confidence: HIGH on the mechanism (reproduced 7/7 trials); MEDIUM on frequency (it needs two overlapping saves: two tabs, or a Catalog scaffold while the editor saves).
Reproduction: `Promise.all` of two `POST /api/quests/scaffold` (FX-C-001, FX-C-002). Both answer 200. There is one commit, `spiraldb: create quest FX-C-001`, containing all four files (both templates and both metadatas). B answers `commit: ""` with `commit_message: "spiraldb: create quest FX-C-002"`, a commit that does not exist, and B's `accepted_suggestions` would be flipped anyway.
Impact: breaks D13 (one commit per object). History no longer matches its files, and the API reports a commit that does not exist. With a different interleaving (B's `git add` while A's commit holds `index.lock`), B ends in `UncommittedSaveError` on a tree the user did not dirty. The scaffold CLI run against a live server races the same way.
Fix: a per-root async mutex around `saveObject` (from `assertClean` through the commit), plus commit only this save's paths (`git commit --only -- <paths>`, or check the staged set), and treat an empty `result.commit` as a failure.
Note: predates Phase 7 (Phase 2), but it is squarely the "can a route forge commit content / leave the repo half-written" criterion, and Phase 7 multiplied the write entry points.

**[MAJOR] M3 — Phase 7's two bodiless write routes are cross-origin drivable, defeating D88's premise.**
Files: `server/src/routes/drafts.ts:192` (`POST /api/suggestions/:id/reject`) and `:171` (`POST /api/drafts/rebuild`).
Confidence: HIGH on the server side (reproduced); MEDIUM on browser reachability (Firefox has no local-network gate; Chromium's Local Network Access gating varies by version).
D88 says no CORS is safe because the browser "refuses to send the non-simple `application/json` request" (`server/src/app.ts:23-33`). These two routes read no body, so a foreign page sends them as simple requests (`fetch(url,{method:'POST',mode:'no-cors'})` or a `<form>`) with no preflight.
Reproduced with `Origin: https://evil.example`, `Content-Type: text/plain`: reject → `200`, row status `rejected`, no `Access-Control-*` header (unreadable to the attacker, but the side effect is done); rebuild → `200`, the rebuilder ran. Re-inserting the same proposal afterwards gives `{"inserted":0,"unchanged":1}`.
Impact: the D163 decision guard makes a forged reject permanent. Ids are sequential, so a page the owner visits can loop over ~5.5k ids and suppress the evidence queue for good (only manual SQL undoes it). A rebuild blocks the event loop synchronously for ~6 s per request.
Same class (older routes): the multipart `POST /api/extract/quests` (pre-existing, now writes `quest_suggestions`) and the bodiless `POST /api/sync` (Phase 1).
Fix: a small middleware on non-GET `/api` that refuses when `Origin` is present and not same-origin, or when `Sec-Fetch-Site` is `cross-site`. It also covers part of the D94(c) residual. Add a `server-security-posture.test.ts` arm that POSTs a foreign-origin simple request to every write route and expects no side effect.

### MINOR

**[MINOR] m1 — Saves on a detached HEAD commit off-branch and store a sha as `git_branch`.**
File: `server/src/services/git.ts:444` (`branchLocal().current`), `savePipeline.ts:487-499`. Confidence: HIGH (reproduced).
With a blank `git_branch` and a tree on `git checkout --detach`, two scaffolds both answer 200 with `branch: "85fee1d"`. The setting is persisted as `'85fee1d'`, HEAD has moved to `c892f03`, and `git branch` shows only `main`. The commits are on no branch, reachable only through the reflog until gc. The D119 guard exists to prevent exactly this stranding.
Fix: treat a detached HEAD as a refusal (`git symbolic-ref -q HEAD` fails → `BranchMismatchError`).
Unverified variant: the CLI's `rev-parse --abbrev-ref HEAD` returns `HEAD` in that state, so it would follow a branch literally named `HEAD`. It probably fails closed at `checkoutBranch`; not reproduced.

**[MINOR] m2 — A rebuild during a save's commit leaves the file committed but answers 400 and deletes the accepted row.**
File: `server/src/services/quests.ts:438`, the `questScaffold.ts` post-commit transaction, `server/src/routes/quests.ts:174-178`. Confidence: MEDIUM (traced through the code, not timed live).
The rebuild is synchronous and runs between the save's `await`s. The file is already on disk, so `removeStale` deletes the pending row for the now-filled field. `acceptSuggestions` then throws `SuggestionDecisionError` → 400 after the commit, and the route maps that with a comment saying "refused before anything was written". This is the documented D168 residual widened from reject to rebuild: D168 says the ids stay pending, but here the row is deleted. For a naming save the whole post-commit transaction rolls back, so the file exists with no `quests` row or link, and a retry gets 409 "already a quest name".
Fix: a post-commit decision failure should answer 200 with a warning (the commit is real), or take the same mutex as M2 for the rebuild.

**[MINOR] m3 — The empty-corpus fix (PR #14 major 1) closes the zero-file case only.**
File: `server/src/services/drafts.ts` `buildDrafts`. Confidence: HIGH.
A partial `QuestTemplates/` root still deletes pending evidence rows (the PR #14 reviewer measured 147 removed on a 1-file root). D195(a) records this honestly ("a partial corpus is not detectable this way"), and the rows are re-proposed with new ids on a correct rebuild. Listed only so the gate record shows the fix is partial by design.

### NIT
- **[NIT] n1:** `scripts/imlight-boot.ts` `--save-cmd` runs `sh -c` with no timeout, its stderr is discarded on success, and "it must write into the D17 clone" is documented but not enforced. An operator-only flag, not a vulnerability.
- **[NIT] n2:** Path symlinks: `writeSpiraldbJson` follows a committed symlink in `QuestTemplates/` (an untracked one trips D14). The PR #14 review accepted this as operator-owned; recorded for completeness.

### Verdict per security surface
1. **Git automation: CHANGES REQUIRED (M1, M2; m1).**
   - Holds: the branch guard (D119/D195). With the tree on `main` and `git_branch` naming an existing `content/old`, the save answers 409 "already exists, so committing to it checks it out…", and the tree and main-only file stay put. Commit-message building also holds: `sanitizeCommitNotes` collapses control characters with a code-point cap, and `fileNameFor` refuses U+0000-U+001F and U+007F, so the subject cannot be forged. `UncommittedSaveError` covers a commit failure after the write.
   - Does not hold: the stale `has_definition` overwrites authored content (M1), unserialised saves merge commits (M2), and a detached HEAD strands commits (m1).
2. **File writes: PASS apart from M1.** `questTemplateTargetPath` requires the parent to be `QuestTemplates/` (so `..`, separators, NUL and control characters are refused), and `createTargetPath`/`fileNameFor` stays the single naming home. `removePaths` is root-confined and never equal to the written file. The glossary and evidence scripts write only `shared/glossary.ts` (a dev script), and the upload name is a random UUID.
3. **Subprocess CLI: PASS.** Every spawn is `execFile` with argv (no shell). The capture path is a server UUID, and `--suggestions` points into a `mkdtemp` directory removed in `finally` (the `--output` retry directory too). For D47 abort, the child is spawned synchronously inside `start()` before `res.on('close')`, and the registry kills late arrivals. Census rows are validated and the child is released in `finally`. Output is bounded by `maxBuffer` plus the `--output` retry. Suggestion paths are constants inside `Suggestions.cs`, never taken from the capture, and the shared document setters are `hasOwnProperty`-guarded. Residual: the census runs with `timeout: 0`, like the reader (D-documented).
4. **Suggestion accept path: CHANGES REQUIRED (M2, m2).** An id cannot be accepted for the wrong quest: `assertAcceptableSuggestions` requires a matching `quest_name`, or `catalog_id` for unnamed rows (the p7-accept suites pass, and foreign, decided or unknown ids give 400). An id cannot be accepted twice through the route alone, thanks to the pre-check plus the post-commit transaction re-check. But concurrency allows a flip on `commit:""` (M2). Resurrection is impossible: the guard blocks re-insertion, and `removeStale` deletes only pending rows. The decision itself is forgeable cross-origin (M3).
5. **Loopback/CORS: CHANGES REQUIRED (M3).** The `127.0.0.1` bind and the no-CORS rule hold for every new mount (the posture suite passes), but the new bodiless POSTs fall outside D88's "non-simple JSON" premise.

### The three PR #14 merge blockers, spot-reproduced
- (1) The empty-corpus rebuild guard `DraftCorpusError` is present (`drafts.ts` `buildDrafts`) and its suite passes. It is zero-file only (m3).
- (2) The branch exemption narrowed to the create path reproduces green against a real repo (409, tree unchanged).
- (3) The Save in-flight guard: the synchronous `saving` ref is in `submitSave` (`QuestDetailPage.tsx:572-577`), `aria-disabled`/`aria-busy` are on the button, and `reconcileAfterFailure` drops dead ids. Its 409 "Open the saved quest" branch is unreachable before a sync (M1).

### Evidence sampled against RAW (7 of 7 match)
| Claim | Raw |
|---|---|
| `npm test` 2178 | `gate-7-freeze-and-gates.txt:22,80` |
| `test:ui` 455 | `gate-7-freeze-and-gates.txt:60,118` |
| audit 314/322 | `gate-7-p7-3-audit-corpus.txt:37` |
| verify:captures 5/55 | `gate-7-p7-3-verify-captures.txt:83` |
| drafts run 2: inserted 0 / unchanged 5458, reconcile all 1, ids without a draft 0 | `gate-7-p7-4-drafts.txt:53-54,106,110` |
| live boot 322 + 1 = 323 PASS | `gate-7-p7-5-live-boot.txt:146-148` |
| census 72 planted / 0 missing; 9 identical goldens | `gate-7-p7-1-census.txt:22`; 9 identical lines in `gate-7-p7-2-reader.txt` |
| CI sim run 4: 2076 passed / 102 skipped; 449 passed / 6 skipped | `gate-7-ci-sim.txt:268-269,314-315` |

The final-deslop K8/K21/K23 and PR #14 9b/9h/9k/9o deferrals are as stated; none was found worse than recorded.

### Positive observations
- The write order (file, metadata, one commit, then status/flip), `UncommittedSaveError`, and the root-confinement of `removePaths` are careful and well commented.
- The branch-guard helper is one shared home for both the CLI and the pipeline, and it fails closed on `requestedExists: undefined`.
- `sanitizeCommitNotes` caps by code points (the lone-surrogate case is measured), and control characters are refused at the naming single home.
- The extraction temp-directory lifecycle and the abort registry are correct, and the census output is now validated.
- The evidence discipline is strong: every claim sampled matched its raw artifact, and the residuals (D168, D195(a)) are stated rather than hidden.

### Recommendation: CHANGES REQUIRED
Blocking approval:
1. **M1:** refuse `POST /api/quests/scaffold` with 409 when the quest file already exists in the index (the `questScaffold.ts:456` branch), and report the pipeline's real `outcome`.
2. **M2:** serialise `saveObject` per root (a mutex from `assertClean` through the commit), commit only this save's paths, and fail on an empty commit sha.
3. **M3:** a cross-origin write guard (`Origin`/`Sec-Fetch-Site`) covering at least `POST /api/suggestions/:id/reject` and `POST /api/drafts/rebuild`, with a posture-test arm.

The MINORs (m1 detached HEAD, m2 post-commit 400) are strongly recommended in the same pass but are not blocking on their own. Happy to re-review the fix commit.

---

## Round 1 fix work

**Executor:** fix pass on `final-gate-7` (uncommitted; the lead commits), 2026-09-30. D-items: **D196** (M3) and
**D197** (M1, M2, m1, m2) in `docs/plan-overview.md`. Every regression test is built on the reviewer's repro files
(`scaffold.test.ts`, `concurrent.test.ts`, `csrf.test.ts`, `detached.test.ts`) and runs the real modules against
throwaway `git init` repositories under `data/__test-scratch__/` and in-memory databases. RAW red: the production
files were stashed (`git stash push -- <the 8 production files>`), the new arms run against the `cad7281` code, the
stash popped: `final-review-round1-red.txt` (**14 failed | 10 passed**, every new arm red). RAW green:
`final-review-round1-green.txt` (**3 files, 40 passed**). No assertion was loosened; the only edits to existing tests
move the D119 suite's route enumeration into `tests/helpers/write-routes.ts` (shared with the D196 arm, unchanged
logic) and add `VITE_PORT=5181` to the opt-in alt-port config.

| Finding | Fix | Files | Test | RAW red → green |
|---|---|---|---|---|
| **M1** scaffold overwrites a file authored since its first scaffold | The catalog branch refuses `409` "already has a definition" when `index.pathFor('questtemplates', name)` finds a file (as the naming branch and `GET /:name/scaffold` do); the pipeline repeats the refusal **under the lock** (`mustCreate` → `ObjectExistsError` → the same `409`), so a concurrent scaffold of one name commits once; the response reports `result.outcome`. D195(c)'s "Open the saved quest" branch is reachable before a sync, so its comment ("can only be refused again") is now true. The pipeline does **not** refuse every `action:'create'` on an indexed key: `create` is also what an editor update requests (an existing key always wins with `update`), so the refusal is the opt-in `mustCreate`, used by the scaffold only. | `server/src/services/questScaffold.ts`, `server/src/services/savePipeline.ts` | `save-write-safety.test.ts` › M1 (3 arms: authored-then-rescaffold, draft POSTed with a document after the file exists, two concurrent same-name scaffolds) | red: `"outcome":"created","action":"update"` → 200 (the reviewer's overwrite), `expected 200 to be 409`, `expected [200,200] to deeply equal [200,409]` → green |
| **M2** concurrent saves merge into one commit; second answers `commit: ""` | `withCorpusLock` (one promise chain per physical root, every pipeline instance in the process) spans `assertClean` → branch → write → add → commit → status upsert; `commitObject` commits `--only` its own paths (+ tracked D22 deletions); an empty sha after a commit attempt is an `UncommittedSaveError`. An **unchanged re-save** (identical bytes; pinned by existing suites — `save-pipeline`, `npc-drop-table-model`, `simple-object-list-validation` went red on the first cut) is detected *before* the commit by `git status --porcelain -- <paths>` and answers `commit: ""` with no commit, as before. Post-commit flips run synchronously right after `saveObject` resolves (a microtask continuation; no request can interleave); they are not inside the lock. | `server/src/services/savePipeline.ts`, `server/src/services/git.ts` | `save-write-safety.test.ts` › M2 (the reviewer's `Promise.all` repro: two commits, each exactly its own two files, both 40-hex shas, distinct; a stranger's staged file stays out of the commit; an empty sha rejects with `UncommittedSaveError`) | red: `expected 2 to be 3` (one commit for two saves), `expected [ …(3) ] to deeply equal [ …(2) ]`, `promise resolved … instead of rejecting` → green |
| **m1** detached HEAD commits off-branch | `GitService.isDetached` (`git symbolic-ref -q HEAD`, read by its output — measured: simple-git answers git's silent exit 1 as an empty success, so the exit code alone let a detached tree through); `resolveScaffoldBranch({ detached })` refuses first → `BranchMismatchError` → `409`; the scaffold CLI passes `detached` too, so it can no longer move `git_branch` to `HEAD`. | `server/src/services/git.ts`, `server/src/services/savePipeline.ts`, `scripts/scaffold-quest.ts` | `save-write-safety.test.ts` › m1 (route: 409, HEAD/tree/setting unchanged; the shared helper refuses) | red: 200 with `"branch":"76cee96"`, `expected 'use' to be 'refuse'` → green |
| **m2** post-commit decision failure answers 400 and rolls a naming back | Chosen: **answer success with a warning** (the lock was not taken for the rebuild: a promise-chain hand-off is microtask-ordered and could not guarantee the flips run before a queued rebuild). `acceptCommittedSuggestions` keeps D141's all-or-none flip; on `SuggestionDecisionError` after the commit it returns `accepted_suggestions: []` and a warning naming every id left undecided (both save routes; the client already toasts `warnings`, now typed on `scaffoldDraft`). A naming save writes its catalog row / id link / suggestion names in their own transaction before the flips. | `server/src/services/drafts.ts`, `server/src/services/quests.ts`, `server/src/services/questScaffold.ts`, `client/src/lib/api.ts` | `save-write-safety.test.ts` › m2 (the row is deleted / rejected inside the git layer's commit slot — the rebuild's window — for `POST /api/quests` and for a naming scaffold) | red: `SuggestionDecisionError: Suggestion 1 is not a pending suggestion of this quest` (both) → green |
| **M3** bodiless/multipart writes are cross-origin drivable | `refuseCrossOriginWrites` on `/api`, ahead of the body parser and every router: non-`GET`/`HEAD`/`OPTIONS` with an `Origin` outside `appOrigins()` (`http://{localhost,127.0.0.1,[::1]}:{PORT??3001, VITE_PORT??5173}`) or `Sec-Fetch-Site: cross-site` → `403 { error }`. No `Origin` passes (curl, CLI, supertest). | `server/src/app.ts`, `tests/ui/p4-10-altport.config.ts` | `server-security-posture.test.ts` › D196 (every enumerated non-GET route — ≥16, reject and rebuild named — answers 403 from `https://evil.example` with `text/plain`, **no `/api` router reached**; `Sec-Fetch-Site: cross-site` and `Origin: null` refused; a foreign reject leaves the row pending while 5173-origin, 3001-origin and no-Origin rejects succeed; same-origin `PUT /api/settings` 200, foreign 403, value unchanged) | red: `patch /api/status/:type/:key from https://evil.example: expected 404 to be 403`, `expected 200 to be 403` (×3) → green |

### What Origin the browser sends (measured, not assumed)

`final-review-round1-origin-probe.txt`: a throwaway stack on owned ports (`PORT=12369`, `VITE_PORT=12500`, a
scratch DB; stopped afterwards). Headless Chromium on the Vite page (`http://localhost:12500`, through the `/api`
proxy with `changeOrigin`) and on the built server's page (`http://localhost:12369`) both POST `reject` and get the
route's own `404 Unknown suggestion` — the guard passed, so the proxied `Origin` is the page's own. curl with
`Origin: http://localhost:8080` (another loopback port) → `403`; curl with no `Origin` → `404` (passes). The
`about:blank` `no-cors` probe was blocked by Chromium itself (`Failed to fetch`), so the foreign-page proof is the
curl line and the posture arm. The FULL tier-1 suite (browser `Origin: http://localhost:5181` via the proxy) is
green: **471 passed**.

### Residuals and items left as recorded

- **Cross-process (M2):** the lock is in-process. The scaffold CLI against a root a live server also writes is
  serialised only by git's `index.lock` (the colliding command fails loudly → `UncommittedSaveError`); `--only`
  keeps either commit from carrying the other's files, and the empty-sha check keeps a swallowed save from
  answering success. A lock file was not added (a stale lock after a crash would refuse every save — not cheap
  to make safe).
- **D196 reads:** `GET` is not checked; the DNS-rebinding read case (a `Host` allowlist) stays D94(c)'s owner
  decision. An operator serving the client on another port sets `PORT`/`VITE_PORT` to match.
- **m3** (partial-corpus rebuild), **n1** (`--save-cmd`), **n2** (committed symlinks): left as recorded, no code
  (per the brief; D195(a) already states m3).

### Files changed

`server/src/app.ts`, `server/src/services/{git,savePipeline,questScaffold,quests,drafts}.ts`,
`scripts/scaffold-quest.ts`, `client/src/lib/api.ts`, `tests/unit/save-write-safety.test.ts` (new),
`tests/helpers/write-routes.ts` (new), `tests/unit/server-security-posture.test.ts`,
`tests/unit/write-route-branch-guard.test.ts`, `tests/ui/p4-10-altport.config.ts`, `docs/plan-overview.md`
(D196, D197), this file, and sidecars `final-review-round1-{red,green,origin-probe,gates}.txt`.

### Final gates (RAW tails; full output in `final-review-round1-gates.txt`)

```
$ npm test
 Test Files  108 passed (108)
      Tests  2215 passed (2215)
   Duration  90.05s (transform 1.88s, setup 0ms, collect 7.86s, tests 64.92s, environment 14ms, prepare 4.64s)

$ npm run lint
> eslint . && prettier --check .
Checking formatting...
All matched files use Prettier code style!

$ npm run typecheck:tests
> tsc -p tests/tsconfig.json --noEmit
(exit 0)

$ npm run typecheck:scripts
> tsc -p scripts/tsconfig.json --noEmit
(exit 0)

$ npm run build
> tsc -p server/tsconfig.json && node scripts/copy-server-assets.mjs
> tsc -p client/tsconfig.json --noEmit && vite build --config client/vite.config.ts
✓ built in 3.98s

$ npm run test:ui   (FULL tier-1)
  ✓  471 [chromium] › tests/ui/responsive.spec.ts:932:5 › §7 P5 additions: the ⌘K palette fits every breakpoint › 1440px: the palette is centred and inside the viewport (712ms)
  471 passed (4.1m)
```

The D17 clone is untouched (`git -C data/test-spiraldb status --short` empty, `18dc924`, `content/2026-09-27`); the
owner's dev server on 3001/5173 was not stopped (its `tsx watch` reloads the changed server sources); ports
12369/12500 were released.
