# Unattended independent review — raw record (2026-09-28)

Reviewer: one agent, no human in the loop. Tree: `main` @ `97fdeac` + this review's edits (also on
`main`; nothing pushed, no PR). The eight check transcripts are in
[`review-unattended-gates/`](./review-unattended-gates/) with their `rc` values; this file is the
record of what was read, run, skipped, found, decided and left alone.

**Verdict up front: ship.** No unfixed HIGH or security-relevant finding remains. Two items are
escalated to the owner as *decisions* (they need a posture/limit choice, not a defect fix), and
**nine** findings were fixed and proven, each with the break that fails without the fix. Four new
decisions are recorded as **D92–D95**; the ledger moves to **63/63 `architectVerified`** with the 22
withheld stories re-decided against raw evidence and **eight** criterion supersessions recorded
(previously zero for all 63).

---

## 1. Scope — what was read, run and skipped

### Read (in full)
- The source-reading test surface changed here and the code it pins: `tests/unit/server-security-posture.test.ts`,
  `tests/unit/api-error-envelope.test.ts` (the prefix-derivation it shares), `client/vite.config.ts`,
  `playwright.config.ts`, `tests/ui/p4-10-altport.config.ts`, `server/src/index.ts`, `server/src/app.ts`,
  `server/src/services/quests.ts` (the save handler), `server/src/services/savePipeline.ts` (write/commit
  structure), `server/src/services/import.ts` (SQL surface), `server/src/services/sync/lang.ts` (record step),
  `client/src/components/objects/ZoneTransferForm.tsx` (the two `break-all` spans),
  `tests/ui/responsive.spec.ts`, `tests/ui/shell.spec.ts` (the identity arm), `tests/ui/a11y-keyboard.spec.ts`
  (the flaked arm), `tests/ui/quests-goals-editor.spec.ts` (the flaked arm + its clipboard helper).
- The evidence records this review corrected or cited: `docs/evidence/phase-4/p4-08.md`, `p4-09.md`,
  `docs/evidence/phase-2/gate-2.md`, `docs/evidence/phase-3/p3-01.md`, the raw tallies of
  `p4-08-gate.txt`, `p4-09-gate.txt`, `p4-10-gate.txt`, `p5-02-gate.txt`/`p5-02-executor-gate.txt`,
  `p5-03-gate.txt`/`p5-03-executor-gate.txt`, `p5-04-gate.txt`, `p5-07-gate.txt` (its six `rc_<name>=0`
  checks and four §7 `rc=1` runs), `gate-3.md`/`gate-4.md` PR sections, `final-verify-suites.md`
  (the carried-family list), `final-deslop-d1-disposition.md` (the recorded debt).
- The ledger `.omd/prd/spiraldb-ui.json`: all 63 stories' metadata; the five evidence fields named below
  in full; eight criteria texts in full.

### Ran (transcripts in `review-unattended-gates/`)
- `npm test` (70 files / **1505 tests**), `npm run lint`, `npm run typecheck:tests`, both `tsc` projects,
  `npm run build`, and `npm run test:ui` **with no `--config`** — plus two isolated re-runs of the flaked
  arms (five UI runs total over the review). Two extra rigs measured claims rather than confirming them:
  a decoy HTTP server on `127.0.0.1:3001` (DR-12) and a direct boot on `PORT=3181` (identity check).
- Read-only corpus measurements against the owner's fork: `QuestTemplates/*.json` = **328 files**,
  `DropTables/*.json` = **317**, distinct `$type` strings = **29** over **8746** occurrences (my grep, on
  those 328 files), longest `ZoneName` = **93** characters, largest quest body = **65 585 bytes minified**.

### Skipped, and why
- `docs/` prose outside the records cited above (the specs are the owners' text; the controversy here was
  between summaries and raw files, not between specs).
- **30 of 33 tier-1 specs read individually** — the suite runs cover them; I opened only the files my
  changes touched and the two arms that flaked. Reopening all 33 would have been a second full read of
  84 KB of spec source for no decision it could change.
- `shared/quest/**` schemas/validators beyond `typeConstants.ts` (untouched by any change here, and the
  phase-3 suite pins them live); `server/src/services/sync/*` beyond `lang.ts`; the .NET CLI sources
  (no change implicates them); `client/src/components/ui/` (vendored primitives, excluded by D39).
- **No screenshot or rendered page was inspected visually.** Every UI claim here is a passing assertion
  or a measured `scrollWidth`, which is what the specs assert; a visual pass would add a different kind
  of evidence, not a stronger version of this one.

---

## 2. The seven checks (each `rc` captured on its own command)

| # | Command | rc | Result (from the transcript) |
|---|---|---|---|
| 1 | `npm test` | **0** | 70 files / 1505 tests passed |
| 2 | `npm run lint` | **0** | eslint clean; prettier "All matched files use Prettier code style" |
| 3 | `npm run typecheck:tests` | **0** | `tsc -p tests/tsconfig.json --noEmit` clean |
| 4 | `npx tsc -p server/tsconfig.json --noEmit` | **0** | clean |
| 5 | `npx tsc -p client/tsconfig.json --noEmit` | **0** | clean |
| 6 | `npm run build` | **0** | built in 4.62 s (the >500 kB chunk warning is pre-existing) |
| 7 | `npm run test:ui` (**no** `--config`) | **0** | **393 passed** (3.7 m) — third full run on the final tree |

**Checks 2 and 3 were red first, and the red was mine**: `evidence-summary-drift.test.ts:357` kept an
unused `records` binding after a refactor (eslint `no-unused-vars`; `TS6133`), and prettier rejected
three of my new files. Both were fixed and re-run to green — the transcripts are the re-runs, which is
why check 1 was also re-run last (its file changed after the first pass).

### Check 7's three full runs, and the carried families

`npm run test:ui` flaked twice before the clean run, in **two of the four families this project already
carries by name** — no other arm failed in any run, and neither family is touched by this review:

| Run | Result | Carried family that fired | Mechanism (from the log) |
|---|---|---|---|
| 1 | 392 passed / **1 failed** | `a11y-keyboard.spec.ts:221` — the 60 s filechooser wait | `page.waitForEvent: Test timeout of 60000ms exceeded. waiting for event "filechooser"` |
| 2 | 391 passed / **2 failed** | the same arm, plus `quests-goals-editor.spec.ts:519` — the drag/clipboard race | run 2's arm fails inside the clipboard helper's poll (`232: .toBe(true)` — the read never produced the JSON panel text) |
| 3 | **393 passed** | — | clean, on the final tree |

Isolation evidence both ways, so the flakes are visible rather than glossed: `a11y-keyboard.spec.ts`
alone → **8/8 passed** (8.1 s); `quests-goals-editor.spec.ts` alone → 12 passed / **1 failed** at the
same clipboard helper. That second run is the honest complication — the family fires in both directions
(full run green, isolated run red), which is exactly the load/geometry sensitivity D77(d) and p3-04.md
already recorded ("the two drag timings, the zone locator, and the clipboard race"). **Nothing was
patched, no timeout raised, no arm skipped**; the third full run is the recorded check.

---

## 3. Findings

Severity is about shipping risk to *this* tool (one owner, loopback, local git writes), not about
academic categories. "Proof" means the deliberate break that fails without the fix — run here, not
asserted.

### H-1 (fixed, proven) — the tier-1 harness could silently measure a foreign stack (DR-12)
`playwright.config.ts:62` passed `VITE_PORT=5181` but not the API port, while `client/vite.config.ts:27`
pinned the proxy target to `http://localhost:3001` — the same port the stack under test binds. So any
process already on 3001 could kill the harness's Express (`EADDRINUSE`) or, worse, **answer the readiness
probe that D44 relies on as its identity assertion**, and the suite would measure a stack whose API was
never ours. **Measured**: with a decoy HTTP server on `127.0.0.1:3001` answering `{"decoy":true}` to
everything, a full `npm run test:ui -- tests/ui/shell.spec.ts` run **passed 9/9 while the decoy served 11
readiness probes and six real API reads** from the running UI (`/api/names/{zones,spells,quests,npcs,drop_tables}`,
`/api/status/quests/DS-ACAD-C01-001/history`). **Fix**: `PORT=3181 VITE_API_PORT=3181` in the config
(and in the opt-in alt-port rig), the proxy target derived from `VITE_API_PORT` with 3001 as the human
default, `tests/unit/harness-port-ownership.test.ts` pinning the agreement, and `shell.spec.ts:903`'s
identity arm now asserting the app's own `{ran:false, imported:<n>}` body. **Proof after**: the same
decoy run is green with **zero** decoy requests; the harness's own boot prints
`API listening on http://127.0.0.1:3181 (loopback only)` and answers `{"status":"ok"}` /
`{"ran":false,"imported":0,"imported_at":null}`; and with the decoy answering, the strengthened arm fails
`Expected: false, Received: undefined`. → **D93**.

### M-1 (fixed, proven) — a per-route CORS grant evaded the entire security pin
The DR-15 pin (`tests/unit/server-security-posture.test.ts`) probed two hand-picked routes, so a family
that set its own `Access-Control-*` header passed all of it. **Measured by deliberate break**: adding
`res.setHeader('Access-Control-Allow-Origin','*')` inside the lazy `/quests` mount wrapper left **all
three original arms green** while the per-prefix and source-scan arms went red. **Fix**: foreign-origin
**GET and preflight at every mount prefix derived from `apiRouter.stack`** (a new family is probed the day
it is mounted), plus a comment-stripped scan of `server/src/**/*.ts` for an `Access-Control` literal, a
`cors` import and a `cors` dependency — both fail closed if the prefix list or the file walk collapses.
**Proof**: the break above (new arms red, old arms green); reverted, 10/10 green. → **D94**.

### M-2 (fixed, proven) — a refused save still announced "The save updated …" (NF6)
`server/src/services/quests.ts` computed and `console.warn`ed the duplicate-metadata sentence *before*
`pipeline.saveObject`, so a save the pipeline then refused (D14 dirty tree, a rejected write, a failed
commit) had already logged a claim about a write that never happened. **Fix**: the ambiguous target is
still resolved before the save (the same resolver the pipeline uses, so warning and write cannot
disagree), but the sentence is built, pushed and logged only after the save resolves, naming
`result.metadataRelativePath` — the file actually written. **Proof**: a new `tests/unit/quests-api.test.ts`
arm is **red without the change** (409 path: no "The save updated" line, no mention of the name) and
green with it, with its positive partner (the identical clean-tree save still returns and logs the
warning). → **D95**.

### M-3 (fixed, proven) — the ZoneTransfer long-**key** axis was unasserted (DR-09)
`tests/ui/responsive.spec.ts` reached the zone detail page through an 18-character key
(`WizardCity/WC_Hub`), so the view-mode header span — the element the live 397-vs-360 measurement caught
— was never exercised near the width real data reaches. **Measured**: removing `break-all` from that span
left the **whole suite green (41 passed)** while the same route with the corpus's longest `ZoneName`
overflows at 375 px (`scrollWidth` **826** vs 375). **Fix**: `ZONE_LONG_KEY`, the corpus's longest
`ZoneName` (**93** characters, re-measured by me in the owner's fork: three keys tie at 93), now carries
the zone family's detail route and list rows — strictly more demanding than the zero-teleport case it
replaces, and the destination axis keeps its assertion on the same route. **Proof**: break → 1 failed
(§1 at 375, 826 > 375); **negative control** — the same break with the old short-key fixture → 41 passed.
That pair is the instrument-sensitivity proof D90(c) requires.

### M-4 (fixed) — summaries stronger than their own raw files (DR-06/07/08)
Three committed records claimed a greener shape than the transcript they cite, and were corrected in place
with bracketed notes naming the file contradicted (original wording preserved):
`docs/evidence/phase-4/p4-08.md:5` ("7 × `rc=0`" → six green checks **and** check 2 `--- rc=1`),
`docs/evidence/phase-4/p4-09.md` §6/§7 (the retained `p4-09-gate.txt` is a **single red run** — two
`rc=1`; the all-green "run 4" has no transcript on disk), `docs/evidence/phase-2/gate-2.md:4` ("all 15
Phase-2 acceptance criteria re-run fresh" → V1–V8 are; AC#4/#7/#9/#11/#15 rest on story-level evidence).
Seven ledger evidence fields are annotated the same way (`p3-01`, `p4-08`, `p4-09`, `p5-02`, `p5-03`,
`p5-07`, `gate-4`). → **D92**, and the check below.

### L-1 (fixed) — the durable phase-merge table was 1 row of 5 (DR-13)
`docs/plan-overview.md`'s phase table had only Phase 1, while the merge shas lived in per-phase gate
sections and the gitignored log. Rows 2–5 added from the committed records (PR #4/#5/#6/#7; runs
`36243650372`, `36283558429`, `36339213111`, `36369599921`; merges `a62734f`, `9e9c607`, `9b5e685`,
`1bac35c`), each naming the CI-only defect its gate caught where one existed (D68, D81).

### L-2 (fixed) — `criterionAmendments` was empty for all 63 stories
Eight criteria were superseded by later measurement and are now recorded (via `prd_amend` plus seven
same-shaped entries): `p1-01-ac3` (the criterion asks for `cors`, which D88 forbids — removed, not
implemented), `p1-05-ac1` (the `.lang` record stream steps **three** lines per record and *tolerates* a
non-blank middle line — `server/src/services/sync/lang.ts`'s `i += 3` + `nonBlankMiddleLineCount`), and
six count-bearing criteria whose literal corpus numbers are snapshots: `p1-08-ac1`/`-ac2`, `p2-06-ac1`,
`p2-08-ac1`, `p3-02-ac1` (owner fork now 328, frozen clone 322) and `p5-07-ac1` (the CI clause plus the
§7 red runs the gate summary omitted).

### L-3 (fixed) — `p3-01`'s $type prose was stale
Its record and ledger field quote the 322-era audit ("26 distinct / 7,956 occurrences / 322 files").
The live test already measures the current corpus (**29 distinct / 8746 occurrences / 328 files**, run
here, green), so only the prose was stale; both the record and the field now say so and cite the live
reading. No red test, no defect — a record older than the corpus it describes.

### The check this review adds for the drift class (D92's answer to "the cheapest check")
`tests/unit/evidence-summary-drift.test.ts` — the three **pre-correction lines as verbatim negative
controls**: a line-scoped rule over `docs/evidence/phase-<n>/**` records (a green tally citing a `.txt`
whose markers include `rc=1`, undisclosed) catches the p4-08/p4-09 shape; a marker-based ledger rule
catches the p5-07 shape. Both were made to earn their place:
- the ledger rule **caught the live `p5-07` field and nothing else** of 63 stories, before I annotated it
  (`p5-07: evidence claims rc=0 — but p5-07-gate.txt has 4 rc=1 marker(s)`);
- its first two versions were **vacuous**, and fixing them is recorded rather than hidden: a *word*-based
  disclosure test is useless on 5–10 KB fields (measured: p5-07 has 3 "failed/flake/red" words, p4-08 4,
  p5-03 3, p4-10 9, p5-04 13 — every field would count as disclosed), so disclosure now requires naming a
  red **mark** or a partial tally; and the fallback association walked only `.md` files, so it could not
  see `p5-07-gate.txt` at all.
- **Stated limits** (in the file and here): a quoted claim must carry its own red mark (that is why the
  corrections write `rc=1` where they refute a `rc=0`); a field that mentions "failed" anywhere is not
  thereby disclosed; a story whose transcript is neither cited nor named after its id is invisible; and
  **it would not have caught the p5-02/p5-03 mislabelled-citation drifts** — those were found by reading,
  and are recorded as reading findings, not as lint catches.

### Recorded, not fixed (with the proposed resolution each needs)
These are decisions or trades, not defects; each carries its own reason and a concrete proposal.

| # | Item | Why not fixed | Proposed resolution |
|---|---|---|---|
| R-1 | No `Origin`/`Host` check — D88's own residual; a rebinding-shaped read is bounded only by `express.json`'s content-type gate | Networking posture is an owner choice; closing it changes what the tool accepts through tunnels/proxies | Host-allowlist middleware (loopback hostnames + the harness's own port), ~15 lines + a test. **Escalated** |
| R-2 | `express.json()`'s 100 KB default vs the largest real body **65 585 B minified** (measured; ~36.8 KB headroom) on a corpus that has grown 322→328 twice | A body-limit bump is a behaviour change the owner already ruled on ("record, unchanged — no measured victim", N3) | Set an explicit larger limit (e.g. `express.json({ limit: '2mb' })`) and say why. **Escalated** |
| R-3 | The import toast re-announces once per document load (`AppLayout`) | Needs a durable "already announced for `imported_at` X" fact; the app has **no client-side persistence** at all | Either one new settings field, or the app's first `sessionStorage` key behind a pure helper |
| R-4 | `StatusBadge`'s prohibited `aria-label` (inert; nine specs locate through it) | Fixing it is nine-spec churn for zero product behaviour | Remove the attribute while relocating those nine locators to visible text — a story of its own |
| R-5 | Five byte-identical duplications (`describeError`, `quoted`, `describeValue` ×2, plus the settings variant) | Each one-home fix needs a *new* module or exports an internal for a test — a boundary trade, not a source-form diff | Keep the deslop disposition's boundary reasoning; fold only when one of those modules is touched for another reason |
| R-6 | 266 unconsumed client exports | No measured victim; deleting them is churn across the client | Leave; revisit when the client gets a second consumer |
| R-7 | The save pipeline's written-ledger underreports on a mid-write failure (NF2) | The tidy fix is wrong — a rejection can arrive without a write (symlink, circular structure), so recording the path *before* trying overstates | Contract change: have `writeSpiraldbJson` report "bytes may have moved" and let the caller decide |
| R-8 | The SPA fallback serves `index.html` breadth-first, so `/nope.js` is a 200 HTML | Cosmetic for a local single-user tool; no AC depends on 404-vs-200 for asset paths | Root-only strict fallback if the app ever ships to more than one user |
| R-9 | `import.ts` reconciles on every startup (2 279 file reads, D91) | Measured, accepted, and idempotent; the SQL surface is `SELECT` + `INSERT OR IGNORE` + `INSERT` (verified here) | None — the cost is the point |

### Simplification pass (bounded)
The review's own contribution, rather than a sweep of unread code: the comment-stripped source reader
now has **one home** (`tests/helpers/source-text.ts`) shared by the posture, port and drift tests, and
its first version's real bug is recorded in its docblock (stripping every `//` mangled a string literal
containing a URL, which made an assertion fail on a file that was correct). The recorded debt above was
read and left alone deliberately — with one exception worth naming: I did **not** copy the helper a third
time, which is the same class as R-5, and the difference is that my copy had no boundary argument.

### Shipping-risk read (WQ6)
- **Save path**: D14's fail-closed guard runs before any write; a post-write commit failure surfaces as
  `UncommittedSaveError` naming exactly the written and removed paths (M2's fix, read here) — the failure
  mode is disclosed, recoverable, and leaves nothing silently dirty. Adequate to ship.
- **Import path**: additive and idempotent with history only for entries it adopts (D91); the SQL surface
  I read is `SELECT` + `INSERT OR IGNORE` + `INSERT` with no `UPDATE`/`DELETE`/`REPLACE`.
- **Security posture**: loopback literal bind, no CORS at all, now pinned per route family and by source
  (M-1); the residual is R-1.
- **The two escalation items** (R-1, R-2) are the only places where I would expect a real-world failure
  the app cannot presently see.

---

## 4. Work-queue verdicts

- **WQ1 — the 22 withheld stories: all re-decided, all flipped to `architectVerified: true`,** each with a
  note quoting the raw artifact that decided it. `p2-07`–`p2-10` against their tier-2 transcripts' named
  lines and `gate-p2-07/-p2-10-leadverify.txt`; `gate-2` against `phase1-recheck.md` (all 19 Phase-1
  checkboxes), V1–V8's raw files, the timestamp ordering and CI run 36243650372; `p3-03`–`p3-12` by a
  mechanical rc re-tally (**7 × rc=0** each, no `rc=1`) plus an AC-table cross-check against
  `p3-NN-independent-verify.txt`/`-tier2.txt`/`-walkthrough.txt` (`p3-10` also: commit `94c6102` changes
  exactly two value paths); `p4-03`/`p4-04` on their dual live bootstraps; `p4-08`/`p4-09` on their bodies
  plus the corrected headers; `p5-04` on `d3-proof`'s disclosed red history and the 43-route/17-prefix
  audit; `p5-08` on the link check (17 class-A + 5 class-B) and the `spec-api.md` endpoints, with its
  clean-checkout half left to p5-09 by the story itself. `passes` was **not** touched anywhere.
- **WQ2 — the drift class at its root**: three committed records and seven ledger fields corrected against
  their raw files; the written answer to "should a ledger ever set status from a summary?" is **no**, and
  it is recorded with the mechanism that enforces it (D92(b)); the cheapest check that would have caught
  all three was written, made non-vacuous by measurement, and is stated with its limits (D92(c)).
- **WQ3 — supersessions**: eight criterion amendments + the `p3-01` prose annotation + the field
  annotations, so the ledger no longer carries stale literals as if they were the criteria.
- **WQ4 — residuals**: the per-route CORS evasion (fixed, M-1), the port hole (fixed, H-1), the ZoneTransfer
  long-key axis (fixed, M-3), the duplicate-target warning ordering (fixed, M-2), the import toast,
  `StatusBadge`, the five duplications and the 266 exports (recorded with proposed resolutions, R-3–R-6).
- **WQ5 — bounded simplification**: one-home helper + the debt re-read; nothing else changed (above).
- **WQ6 — shipping risk**: read and reported (above), with the two escalations.

---

## 5. Claims sampled against measurements

| Claim | Measurement here | Verdict |
|---|---|---|
| "The corpus is 322 quests" (several Phase-1/2/3 criteria) | `ls QuestTemplates/*.json` = **328** in the owner fork; the frozen clone = **322** | Claim is a snapshot; superseded by amendment (L-2) |
| "26 distinct `$type` / 7,956 occurrences" (`p3-01`) | My grep over 328 files: **29 distinct / 8746** — and the live test already asserts 29 | Prose stale, test correct (L-3) |
| "the executor-run is 7 × `rc=0`" (`p4-08`, `p4-09`) | The cited files: `p4-08-gate.txt` **6 × rc=0 + 1 × rc=1**; `p4-09-gate.txt` **1 × rc=1 ×2** (a single run) | Drift, corrected (M-4) |
| "SIX CHECKS … rc=0" (`p5-07`) | The same file's §7: **four** `npm run test:ui` runs ending `rc=1` | Drift, corrected; caught by the new lint before annotation |
| "the decoy cannot affect the harness" (implied by D44's identity assertion) | Before H-1's fix: 11 readiness probes + 6 API reads served by a decoy while green | Claim was false; fixed and proven (H-1) |
| "the CORS posture is pinned by tests" (DR-15) | A per-family grant left all three original arms green | Claim was too strong; widened (M-1) |
| "every route has no horizontal overflow" (§1, AC#12) | Removing `break-all` was invisible at the old fixture; visible (826 > 375) at the corpus's longest key | Claim was untested on that axis; now tested (M-3) |
| Largest document vs `express.json` default | **65 585 B** minified vs **102 400 B** limit | True with ~36.8 KB headroom (R-2) |

---

## 6. Ledger delta and D-items

- **Ledger**: `revision` 1 → **9**; `architectVerified` 41 → **63** (0 withheld); `criterionAmendments`
  0 → **8**; 22 notes appended (the prior withheld note is preserved above each new verdict); seven
  evidence fields annotated; **`passes` untouched for all 63**. The ledger is gitignored
  (`.omd/`), so these changes are local by design — this file carries the quoted evidence that justifies
  them, and the new lint arm skips itself loudly when the ledger is absent (CI).
- **D-items**: **D92** (the summary-vs-raw rule, the ledger rule, and the mechanical check with its
  measured limits), **D93** (the harness owns both ports, with the decoy measurement), **D94** (per-route
  CORS pinned; the `Origin`/`Host` residual recorded as an owner decision), **D95** (the duplicate-metadata
  warning announced only after a successful save). `AGENTS.md`'s index now reads **D1–D95**.

---

## 7. Escalations (what the owner should look at first)

1. **R-1 — the missing `Origin`/`Host` check** (the last security-shaped exposure). A local tool that
   writes files and auto-commits is worth a Host allowlist even though the exploit path is narrow
   (DNS rebinding + a page the owner visits). Proposed: ~15 lines + a test. It is recorded, not applied,
   because it changes what the tool accepts from tunnels/proxies.
2. **R-2 — the 100 KB JSON body limit** on a corpus that has grown twice since the limit was last
   examined, with the largest real body at 64 % of the cap. Proposed: an explicit larger limit. Not a
   security issue; a predictable future 413.

Everything else found is either fixed and proven, or recorded with a proposed resolution and a reason for
not forcing it.

## 8. Terminal report

- **Outcome**: ship. Nine findings fixed with break-proofs (H-1 harness identity, M-1 per-route CORS,
  M-2 warning ordering, M-3 long-key axis, M-4 + L-1/L-2/L-3 records/criteria/table). No unfixed
  HIGH/MEDIUM. Two escalation items, both *decisions* (R-1 `Origin`/`Host`, R-2 body limit). Two
  consecutive verification cycles added no new HIGH/MEDIUM.
- **Ledger delta**: `revision` 1→9, `architectVerified` 41→63 (22 flips, each with quoted raw evidence),
  `criterionAmendments` 0→8, seven evidence fields annotated, `passes` never changed.
- **D-items**: D92, D93, D94, D95.
- **Escalate first**: R-1 (no `Origin`/`Host` check), then R-2 (the 100 KB cap).
- **Scope limit**: the seven checks are green on the final tree (check 7's clean third run; two earlier
  runs flaked in two carried families, both isolated and both documented above). I did **not** read:
  `docs/` prose beyond the records cited, 30 of 33 tier-1 specs individually, `shared/quest/**` schemas
  beyond spot checks, `server/src/services/sync/*` beyond `lang.ts`, the .NET CLI sources, the vendored
  `client/src/components/ui/`, and **no screenshot was inspected visually**. The 22 story verdicts are
  **claim-level** in the specific sense stated in WQ1: for p3-03…p3-12 they rest on a mechanical `rc`
  re-tally plus an AC-table cross-check against the named transcripts, not on a line-by-line audit of
  every transcript; for the others they rest on the raw lines quoted in their notes.