# architect-verification — the evidence-corpus audit of all 63 stories

**Role:** loop-level `omd-agent-verifier` (the sign-off clause of `final-verify`'s AC). **Tree audited:**
`main` at `c1dafc3e75001448d79ef011682504c90ba9dab9`, re-checked at `93e9129` (D88–D90 landed during this
audit, 02:43 local). **Working tree: clean** (`git status --porcelain` → 0 lines) before and after.

**The gap I was dispatched for**, in `final-verify`'s own words: *"I did NOT audit the 63 stories.
docs/evidence holds 400 files, 276 named story-\*/pN-\*. I read only six of them… so treat this as an audit
per step against re-executed raw output, NOT as an evidence-corpus audit."* This document is that
evidence-corpus audit.

**What I can and cannot claim.** I cannot re-run 63 stories' worth of work. What I verified is that **each
story's claim is supported by the evidence it cites** — and, where the claim was cheap to re-measure, I
re-measured it myself. Everything below is either (a) a raw output in the corpus that I read, (b) a command
I ran, or (c) explicitly marked as *not* verified.

**Write scope.** I wrote this file only. No git write (nothing staged, nothing committed), no edit to
`.omd/prd/spiraldb-ui.json` (the ledger is the lead's), no new dependency, scratch in `/tmp`. The
`omd-agent-verifier` card says read-only; the dispatch explicitly instructed this one artifact under
`docs/evidence/`, and I confined myself to that.

---

## 0. Commands I ran (each rc captured on the command itself)

| # | command | rc | raw result | what it verifies |
|---|---|---|---|---|
| 1 | `npm run test:ui` (own config: port 5181, own DB) | **0** | **393 passed (2.0m)** | `final-deslop`/`final-verify`'s 393 claim; p5-07's AC at HEAD; the D84 port fix |
| 2 | `npm test` | **0** | **67 files / 1472 tests passed** | the unit battery at HEAD |
| 3 | `npx vitest run tests/unit/quest-type-constants.test.ts` | **0** | 5 passed; **29 distinct `$type` / 8746 occurrences / 328 files** | p3-01-ac1 |
| 4 | `npx vitest run tests/unit/quest-roundtrip.test.ts` | **0** | **owner 328/328, clone 322/322, failures=0** | p3-02-ac1 (strengthened) |
| 5 | `npx vitest run` 12 phase-1 suites (`db settings names status import lang revision templates corpus manifest naming ui-shell`) | **0** | 12 files / **439 tests passed** | p1-02/03/05/06b/07/08/10/11 |
| 6 | `grep -oh '"$type" *: *"[^"]*"' $SP/QuestTemplates/*.json \| sort -u \| wc -l` | 0 | **29**; `grep -o ReqIsSchool` → **7**; `ROP_OR` → **7**; `ls *.json` → **328** | p3-01's pins, independently |
| 7 | `npm ls cors` | **0** | `cors@2.8.6 **extraneous**`; absent from `package.json` **and** `package-lock.json`; **0** imports in source | the HIGH fix (M1) |
| 8 | loopback rig: `PORT=5399 SPIRALDB_UI_DB=/tmp/…` `node server/dist/server/src/index.js` | — | boot log asserts the DB identity first; `ss` → **`127.0.0.1:5399`**; `curl` to **192.168.8.186:5399 → rc=7 (refused)**; foreign-`Origin` GET and `OPTIONS` preflight → **no `Access-Control-*` header at all** | the owed loopback/no-CORS posture |
| 9 | clone watcher (`git rev-parse HEAD` + `porcelain` every 0.25 s) wrapped around run #2 | — | **porcelain = 1** at `02:40:19.85`–`02:40:20.71`; reflog shows **a new commit `2f0e0ec` + a reset**; after: `18dc924`, porcelain 0, 322 quests, 0 diff | learning (b), reproduced with the mechanism |
| 10 | `git -C $SP merge-base --is-ancestor f9a1055 HEAD`; `git -C $SP diff --stat f9a1055..HEAD -- QuestTemplates` | 0 | **is an ancestor; the QuestTemplates diff is EMPTY** (12 files changed, all `docs/creating/*.md`) | the 328-quest baseline is still the pinned one |

`$SP` = `/home/jason/Documents/git-projects/spiraldb` (the owner's fork). Owner fork after everything:
`main`, porcelain **0**, 328 quest files — **untouched**. My ports (5181/5399/3001) all free at the end;
`[::1]:5173` is the sibling's and was not touched.

---

## 1. Depth ledger — what I actually did, so a scan never reads as an audit

| Depth | Meaning | Count | Stories |
|---|---|---|---|
| **D** — audited deeply | read the claim in full **and** its cited evidence, **and** re-measured or re-ran something specific to it | **25** | p1-01, p1-05, gate-1, p2-05, p2-06, p3-01, p3-02, p4-06, p4-08, p4-09, p4-10, p5-02, p5-03, p5-06, p5-07, p5-09, final-deslop, final-review, final-verify, plus p1-02, p1-03, p1-07, p1-08, p1-10, p1-11 (claim read + the covering suite re-run fresh + gate-1's raw file) |
| **S** — spot-checked | read the claim and its AC-verdict table (not every underlying raw file), plus the gate record's rc tally | **20** | p1-04, p1-06, p1-06b, p1-09, p1-12, p1-13, p1-14, p2-01, p2-02, p2-03, p2-04, p3-10, gate-3, p4-01, p4-02, p4-05, p4-07, gate-4, p5-01, p5-05 |
| **C** — scanned only | confirmed the evidence exists, is tracked, is non-empty, and that the gate file's rc tally matches the story's gate line — **nothing at AC level** | **18** | p2-07, p2-08, p2-09, p2-10, gate-2, p3-03…p3-09, p3-11, p3-12, p4-03, p4-04, p5-04, p5-08 |

25 + 20 + 18 = 63. **The 18 scanned-only stories do not get a sign-off** (§6 — the withheld list is 22,
because four *spot-checked* stories are also withheld for a contradiction I found: p1-01, p4-08, p4-09 and
p5-07's ledger line). That is the honest consequence of the ledger above: a 63-row table where a scan is
labelled verified would be worth less than a 41-row table that is true.

---

## 2. Per-story verdict table (all 63)

Verdicts: **verified** (claim supported by the evidence cited, and re-measured where cheap) ·
**partial** (support is indirect/stale, or the claim's own summary contradicts its cited raw file) ·
**unverified** (no supportable verdict at the depth I reached).
`archV` = should `architectVerified` be set.

| id | claim (from the PRD) | evidence I checked | depth | verdict | archV |
|---|---|---|---|---|---|
| p1-01 | D1 layout + `:5173`→`:3001` proxy, no console errors; **"Express bootstrap on :3001 with cors"** | PRD evidence text (raw `curl`, incl. `access-control-allow-origin: *`); direct disk/config check; `server/src/app.ts`, `index.ts` | D | **partial** — AC1/AC2 verified (5 dirs, `strict: true`, `@shared/*`, 6 scripts, gate-1 proxy + shell spec); **AC3 contradicted by the shipped code** (DR-01) | **no** |
| p1-02 | fresh DB: 11 tables + 3 indexes; settings seed | PRD evidence; `gate-1/schema.txt` (11 tables, 3 indexes); fresh `db.test.ts` 23 passed | D | verified | yes |
| p1-03 | settings PUT persists / 400 on bad path | PRD evidence; fresh `settings.test.ts` 27 passed; D32 | D | verified | yes |
| p1-04 | spike against real `Root.wad`; 2–3 real fixtures committed | PRD evidence (`exit=0`, `REAL=16.770` vs doc 17.235); `spike-1.4a.md` present; **24 tracked fixtures** | S | verified (spike doc not re-read in full) | yes |
| p1-05 | `.lang` BOM/hex (`1ED8D`→126349), revision resolver, template parsers, corpus quests/zones | `story-p1-05.md` **in full**; fresh `lang/revision/templates/corpus` 28/14/23/10 passed; AC1's stated record shape vs its own §3.2 | D | verified, with AC1's `{index}\r\n\r\n{value}` narrower than the measured 3-line shape (disclosed) | yes |
| p1-06 | `npm run sync` end-to-end, 5-row spot-check, re-run stability, sync endpoints | PRD evidence; `gate-1/sync-run{1,2}-counts.json`, `spotcheck.txt`, `sync-run2.txt`; fresh `import.test.ts` 33 passed | S | verified | yes |
| p1-06b | `TemplateManifest` is the id authority; spells ≥18k, 0 collisions | PRD evidence; fresh `manifest.test.ts` 12 passed; D35 | S | verified | yes |
| p1-07 | names API, 7 types, 404s | `gate-1/api-matrix.txt` **raw curls** (items, zones, spells, npcs, 404 body); fresh `names.test.ts` 66 passed | D | verified | yes |
| p1-08 | import once (322/317), status API + history, dashboard, D4 constant | `gate-1/api-matrix.txt` (322 total / 321 extracted, dashboard 2271, 8 keys), `entry-status-final.txt`; fresh `status`+`import` 83+33 passed | D | verified; the AC's `322` is a **stale corpus pin** (328 today) — the mechanism re-measured | yes |
| p1-09 | one-time `user_name` modal | PRD round text; `p1-09-0{1,2}.png` present; D38 | S | verified | yes |
| p1-10 | shell, dropdowns, StatusBadge, toasts, settings page | PRD evidence; `p1-10-0{1,3,4}.png` + `dropdown-truncation.txt`; fresh `ui-shell.test.ts` 66 passed | D | verified | yes |
| p1-11 | phase-1 unit battery green | PRD evidence (503 then); fresh `npm test` 67/1472; `gate-1/tests.txt` 512 | D | verified | yes |
| p1-12 | **the PR's own** `ci` run green | PRD evidence in full (run 36224267657, 14 steps); `gate-1/ci-check-run.txt` (40 lines) on disk | S | verified on the recorded runner log; I did not re-fetch the GitHub API | yes |
| p1-13 | tier-1 harness + `shell.spec.ts` green | PRD evidence; `gate-1/tests.txt` "8 passed"; `story-p1-13.md` (113 lines) + PNG present | S | verified | yes |
| p1-14 | tier-2 UI pass + screenshots committed | PRD evidence; `tier-2-ui-pass.md` (172 lines) + 5 PNGs, **38 tracked** phase-1 files | S | verified (pixels not inspected — no image input) | yes |
| **gate-1** | all 19 phase-1 checkboxes re-run fresh; PR/CI/merge | `gate-1/{tests,api-matrix,schema,spotcheck,sync-run*,ci-check-run,restart,entry-status-final}` read; PRD order vs `p2-01.passedAt` | D | verified | yes |
| p2-01 | dotnet ≥9, fresh D17 clone + reset script, D18 smoke build | `story-p2-01.md` AC table; `story-p2-01-{prereqs,build}.txt`; clone present today at 322 | S | verified | yes |
| p2-02 | `build:cli` relative symlink; CLI contract matrix; apphost env | `story-p2-02.md` AC table; `story-p2-02-cli.txt` | S | verified | yes |
| p2-03 | fixturegen symmetry; ≥3 diverse fixtures closed-loop; committed | PRD evidence **in full**, incl. the flagged ACHIEVERANK substitution; D46's 181/322 | S | verified, substitution disclosed | yes |
| p2-04 | extract endpoint; cancel kills the child; friendly failures + maxBuffer escape | `story-p2-04.md` AC table (ps-confirmed kill; 55 MB overflow → 200) | S | verified | yes |
| p2-05 | save pipeline: files + metadata + git + status + index | `story-p2-05.md` **AC-by-AC** (6 ACs, each a raw txt); `savePipeline.ts` read | D | verified | yes |
| p2-06 | quests API list / detail (JSON5) / POST | `story-p2-06.md` AC table + lead-verify; `quests.ts` (D89 resolver); AC2's `322/306` corpus numbers stale (328/21) | D | verified, one stale corpus pin | yes |
| p2-07 | extraction UI (dropzone, spinner, split, Save All) | PRD evidence; 8 `p207-*.png`; `story-p2-07*.txt`; **did not read the AC table** | C | **unverified** | **no** |
| p2-08 | quest browse + read-only detail | PRD evidence; 4 `p208-*.png`; `gate-p2-08-leadverify.txt` | C | **unverified** | **no** |
| p2-09 | status transition UI + notes + history | PRD evidence (D52 chain, 0 PATCH before identity); 3 `p209-*.png` | C | **unverified** | **no** |
| p2-10 | `extraction.spec.ts` | PRD evidence; `p210-0{1,2}.png`; `story-p2-10.md` | C | **unverified** | **no** |
| **gate-2** | P1+P2 suites re-run; PR opened/CI/merged | citation-level only: merge sha `a62734f` in committed `gate-2.md`, phase ordering vs `p3-01.passedAt`; **did not read `gate-2.md`** | C | **partial** | **no** |
| p3-01 | `$type` audit ⊆ constants; Zod schemas; server reuse | PRD evidence; **fresh test 5 passed, 29/8746/328**; `typeConstants.ts`; `p3-01-live-validation.txt`; recorded gate failure **and** its clean re-run (1b) | D | verified (stale `26`/`27` numbers, DR-04) | yes |
| p3-02 | 322/322 corpus round-trip + edit-simulation | **fresh run: owner 328/328, clone 322/322, failures=0**; `p3-02-independent-verify.txt` | D | verified — *stronger* than claimed (DR-05) | yes |
| p3-03 | Info tab editor + Advanced | `p3-03-gate.txt` 7×`rc=0`; gate line; PNGs; **no AC read** | C | partial | no |
| p3-04 | Goals tab: 5 forms, drag reorder, start toggle | `p3-04-gate.txt` 7×`rc=0`; `p3-04-independent-verify.txt` referenced; **no AC read** | C | partial | no |
| p3-05 | Goal-logic flowchart | `p3-05-gate.txt` 7×`rc=0`; D61 | C | partial | no |
| p3-06 | RequirementTreeEditor, 4 types | `p3-06-gate.txt` 7×`rc=0`; D62 | C | partial | no |
| p3-07 | Results editor, 14 types | `p3-07-gate.txt` 7×`rc=0`; D63 | C | partial | no |
| p3-08 | Dialog editor, 7 groups | `p3-08-gate.txt` 7×`rc=0`; D64 | C | partial | no |
| p3-09 | validation engine + 400 field map | `p3-09-gate.txt` 7×`rc=0`; D65 | C | partial | no |
| p3-10 | Edit/Save toggle, dirty guard, clone isolation | `p3-10-gate.txt` 7×`rc=0`; `quest-edit-isolation.test.ts` **read** (the D17 self-restore) | S | partial (the one file I read supports its AC1) | no |
| p3-11 | `quest-editor.spec.ts` | `p3-11-gate.txt` 7×`rc=0`; `p3-11-lead-verify.txt` | C | partial | no |
| p3-12 | tier-2 pass on diverse real quests | `p3-12-gate.txt` 7×`rc=0`; 5 PNGs; `p3-12-walkthrough.txt` | C | partial | no |
| **gate-3** | P1–3 suites re-run; PR merged | `gate-3-acceptance.txt`; merge sha `9e9c607` in committed `gate-3.md`; D68's CI run 36283558429; ordering | S | verified | yes |
| p4-01 | 8-type router, index resolution, ulong, list/detail | `p4-01.md` **in full**; `p4-01-gate.txt` 7×`rc=0` | S | verified | yes |
| p4-02 | DropTable sections, validation, inline tree, ItemName | `p4-02.md` head; `p4-02-gate.txt` 7×`rc=0` | S | verified | yes |
| p4-03 | three simple editors | `p4-03-gate.txt` 7×`rc=0`; gate line only | C | partial | no |
| p4-04 | NpcDropTable + directory bootstrap | `p4-04-gate.txt` 7×`rc=0`; `p4-04-live-bootstrap.txt` | C | partial | no |
| p4-05 | TreasureCardInventory warn-not-block | `p4-05.md` gate + §6 limits; `p4-05-gate.txt` 7×`rc=0`; `p4-05-live.txt` | S | verified | yes |
| p4-06 | ZoneTransfer editor + schema-drift guard | `p4-06.md`; `ZoneTransferForm.tsx` (**both `font-mono` spans**); `responsive.spec.ts` mock; D74 | D | verified (the overflow defect is F1 — fixed and **committed in `c1dafc3`**) | yes |
| p4-07 | GlobalRegistry merge + consolidate-and-replace | `p4-07.md` gate + §5; `p4-07-gate.txt` 7×`rc=0`; `p4-07-live.txt`; D75 | S | verified | yes |
| p4-08 | status integration for all types | `p4-08.md` **in full**; `p4-08-gate.txt` → **`--- rc=1` on check 2** vs the header's "7 × `rc=0`" (DR-06) | D | **partial** — body honest (§4 "green on 3 of 4"), header summary unsupported by its own cited file | **no** |
| p4-09 | per-type save/create sweep + extended round-trips | `p4-09.md` §6 + line ~235 vs `p4-09-gate.txt` (**one** run, 10:33:28→10:35:49, **two `rc=1`**) (DR-07) | D | **partial** — the rc/measurement attribution is false for the cited file | **no** |
| p4-10 | mobile pass + `object-editors.spec.ts` | `p4-10-gate.txt` **in full** (rc on every command, post-gate attributions, the `5173` collision); D83(d) PNG side effect; my own UI run left `git status` clean | D | verified | yes |
| **gate-4** | P1–4 suites re-run; PR merged | `gate-4-acceptance.txt`; D81 (the CI-only shell-spec defect + the empty-corpus reproduction); merge sha `9b5e685` in committed `gate-4.md`; `p4-79-*` | S | verified | yes |
| p5-01 | dashboard cards, bars, feed, empty states | `p5-01-d3-proof.md` §a + gate; D83(b)'s badge ruling; measured `entry_status` **2277** vs its "2,271 here" (DR-11) | S | verified, one stale row count | yes |
| p5-02 | search palette + `/api/search` + ⌘K | `p5-02-d3-proof.md`; D82's origin; measured DB (**328** quest rows now) and the **absent backfill** (DR-10) | D | verified for the palette; the coverage claim rests on the DB state, not the code | yes |
| p5-03 | status filtering consistency | `p5-03-d3-proof.md`; D83/D84; **port fix verified** (`VITE_PORT ?? 5173`, config 5181); `quests-status.spec.ts:95` **green in my run** | D | verified | yes |
| p5-04 | error handling + loading pass | `p5-04-d3-proof.md` §5/§7 headings; `p5-04-gate.txt` (8 `rc=0`, 2 `rc=1`) | C | partial | no |
| p5-05 | accessibility pass, keyboard, axe, ARIA, reduced motion | `p5-05-*`; D86; **`axe-core`/`@axe-core/playwright` exactly `4.13.0`** in devDeps (read); a11y arms green in my run (17) | S | verified | yes |
| p5-06 | responsive 375/768/1440 across routes | `p5-06-d1-checklist.md` fragments (its 375px conclusion, which final-verify falsified); `p5-06-d{1,2,3}-*`; D78(d) | D | verified for 768 (all 20 routes re-measured clean); its 375px claim is **known-false for real data** — disclosed, fixed downstream | yes |
| p5-07 | a11y + responsive specs **pass headless in CI** | `p5-07-gate.txt` + `p5-07-d3-proof.md` **in full**; **my own `npm run test:ui` → 393 passed rc=0** | D | verified at HEAD; the PRD evidence field's "SIX CHECKS … all rc=0" omits check 7's rc=1 (DR-08) | yes |
| p5-08 | production build + README + spec sync | `p5-08-d3-proof.md` exists; **no AC read** | C | partial | no |
| p5-09 | fresh-clone dry run + full regression | `p5-09-d1-{build-cli,clone,sync}.txt`, `d3-final-gate.txt` 6 `rc=0`; ROUND 109's own account; **PR #7 merged `1bac35c`, remote holds only `main`** | D | verified | yes |
| **final-deslop** | slop pass; every touched suite green; raw disposition | `final-deslop-d{1,2,3}` + gate transcripts (**393 UI rc=0**, 1462 units) + **negative control rc=1** | D | verified | yes |
| **final-review** | fresh-context review; findings resolved; approval raw | `final-review-codereview-gate2.md`, `-fix-d1.md`, `-rereview.md` (**APPROVE**; M1/S2 closed; M2 partial with NF2); **`cors` removal and loopback bind verified independently** | D | verified | yes |
| **final-verify** | every phase's steps re-run fresh; raw outputs | `final-verify-{report,findings,suites,p2,p3,p4,p5}` + findings **in full**; F3's fix present; F1's fix **committed in `c1dafc3`**; its scope limit declared | D | verified, at its declared scope | yes |

**Tally: 41 signable, 22 not** (1 p1-01 + 4 p2 + 1 gate-2 + 10 p3 band + 2 p4 + 2 p5 = 20 "no" from the table above, plus p3-10/p4-03/p4-04's partials counted there — see §6 for the exact list).

---

## 3. Claim-vs-evidence drift list

Every item is quoted from the source and followed by what I measured. The run's record is **mostly
reliable and specifically fallible** — these are the specifics.

### DR-01 — p1-01's AC3 pins a middleware the run deliberately removed (HIGH for a future reader)
> `p1-01-ac3`: "Express bootstrap on :3001 **with cors**, JSON body parsing, route mounting, error middleware
> returning `{ error: message }` shapes (task 1.1)."

Measured: `server/src/app.ts`'s own docblock says **"**No CORS, deliberately** (final-review gate 2, finding
M1)"**; `server/src/index.ts` binds `const HOST = '127.0.0.1'`; `npm ls cors` → `extraneous` and it is in
neither `package.json` nor `package-lock.json`; **0** imports anywhere. The story's own recorded evidence shows
the old behaviour (`access-control-allow-origin: *`). `criterionAmendments` for p1-01 is `[]`. So the ledger
still tells a reader to install the HIGH finding. **Action:** amend the criterion (or mark it superseded).

### DR-02 — "18-character key" is 17 characters (in three places, one of them a committed decision)
> `final-verify-findings.md`: "its route mock returned `{ ZoneName: key, Teleports: [] }` with the
> **18-character** key `WizardCity/WC_Hub`"
> `tests/ui/responsive.spec.ts` (comment): "used to assert … with an **18-character** key"
> `docs/plan-overview.md` **D90(a)** (committed in `93e9129`): "its mock returned an **18-character key**"

Measured: `len("WizardCity/WC_Hub") == 17`. This is the same class the run named for itself in D73(e)
("quoting a measurement with its unit and case-sensitivity") — in the decision that exists to state the lesson.

### DR-03 — "91-character destination path" is 93 characters
> `.omd/prd/progress.txt` ROUND 107 and 109: "**838 vs 360** for a **91-character** destination path"
> `docs/plan-overview.md` **D90(a)** (committed): "the owner's corpus has a **91-character** destination path
> … measured `scrollWidth` 469 against 360, and 839 for that path"

Measured: the mock's own `m_destinationZone`
(`DragonSpire/DS_A1_Knowledge/Interiors/DS_Chasm_Gauntlet_4Room2_Sub/DS_Chasm_Gauntlet_4Room2_2`) is **93**
characters; `final-verify-findings.md` and the spec comment both say 93. Two sources disagree and the committed
one carries the wrong number.

### DR-04 — p3-01's evidence pins the pre-merge type counts (superseded, never amended)
> p3-01 evidence: "returns **26 distinct `$type` strings / 7,956 occurrences** — all present in
> `shared/quest/typeConstants.ts`, whose `KNOWN_TYPE_STRINGS` holds **27** = the 26 corpus strings + the
> spec-only `ReqIsSchool` (**0 quest occurrences**)"

Measured now: **29** distinct / **8746** occurrences / **328** files; `ReqIsSchool` occurs **7×** in
`QuestTemplates/` so `SPEC_ONLY_TYPE_STRINGS` is empty (the code says so: `= {} as const`). The code and the
committed recording were correctly re-measured (D79/D80(d)); the **story's evidence text was not**, and
`criterionAmendments` is empty. Independent re-run of the audit's own assertion: **5 passed, 29 ⊆ constants**.

### DR-05 — p3-02's AC pins "322/322" against a path that now prints 328
> `p3-02-ac1`: "Corpus round-trip: **322/322** QuestTemplates pass …"; evidence: "`files discovered=322
> round-tripped=322` … (real checkout `/home/jason/Documents/git-projects/spiraldb/QuestTemplates`)"

Measured fresh: that same path prints **`files discovered=328 round-tripped=328 failures=0`**, and the clone
prints 322/322 — i.e. the harness is *robust* (it asserts count `=== discovered`, "never a hardcoded 322") and
the result is **stronger** than claimed. The number in the claim is stale; nothing is broken.

### DR-06 — p4-08's header summary contradicts the gate file it cites
> `p4-08.md` line 5: "**Gate**: `docs/evidence/phase-4/p4-08-gate.txt` (executor-run on the frozen tree:
> **7 × `rc=0`**)"

Measured: `p4-08-gate.txt` has exactly 7 checks and check 2 (`npm run test:ui`) ends **`--- rc=1`** with
`1 failed` / `261 passed`. The **body** is honest — §4 says "green on 3 of 4 lead runs — see §5" and §5 names
the arm. Only the summary line is wrong, and a summary line is what a reader trusts.

### DR-07 — p4-09 attributes a green gate to a file that records two failures
> `p4-09.md` §6: "| 1 | `npm test` | **57 files / 1309 tests passed** (`rc=0`) | 2 | `npm run test:ui` |
> **278 tests passed** in 49.0 s (`rc=0`) |"; and line ~235: "the recorded file is run 4 (`p4-09-gate.txt`,
> **overall `rc=0`**)"

Measured: `p4-09-gate.txt` is a **single** run (header `started 2026-09-27T10:33:28`, footer
`finished …10:35:49`) recording `Test Files 2 failed | 55 passed` → `--- rc=1` and `1 failed … 277 passed` →
`--- rc=1`. It is not "run 4", and it is not "overall rc=0". The flakes are discussed in §7 of the same file,
so the substance is disclosed; the numbers and the rc attribution are not.

### DR-08 — p5-07's evidence says "six checks … all rc=0"; the gate records a seventh at rc=1
> p5-07 evidence: "**SIX CHECKS, EACH rc CAPTURED ON ITS OWN COMMAND** … `npm test` **1,460 passed** rc=0,
> lint rc=0, typecheck:tests rc=0, tsc server rc=0, tsc client rc=0, build rc=0."
> `p5-07-d3-proof.md` §3 (same story): "| 7 | `npm run test:ui` (no `--config`) | **1** | see below |
> §6.1: "**`npm run test:ui` is red, rc=1, in every full run on the delivered tree**"

Measured: `p5-07-gate.txt` has the six green checks **plus** §7 with runs A/B/C/D at `rc=1` (and A/D
inadmissible). The story's own D3 proof is fully honest; the PRD's evidence field omits the red check
entirely. At HEAD the full suite is **393 passed rc=0** (my run), so the *criterion* is now met — the
*ledger entry* understates the check count.

### DR-09 — final-verify's stated reason for the remaining blind spot is not supported by the code
> `final-verify-findings.md` residual: "the mock's `ZoneName` is still the 18-character `WizardCity/WC_Hub`
> and its `detailPath` is unchanged (**changing it would ripple through the shell/responsive suites'
> fixtures**)."

Measured: in `tests/ui/responsive.spec.ts` the zone fixture is **local** — `FAMILIES` lines 136–145 carry
`detailPath: '/zone-transfers/WizardCity%2FWC_Hub'` and `keys: ['WizardCity/WC_Hub', …]`, and §1's route list
is **derived** from `FAMILIES` (line 166). Changing that one entry changes nothing outside this file. So the
long-**key** axis (the measured 397/360 zero-teleport case) is assertable here with no ripple, and the stated
reason for leaving it unasserted does not hold. (The *fix* does cover it — both `font-mono` spans carry
`break-all` — but nothing pins it.)

### DR-10 — D82's central number is stale **and** its decided fix is unimplemented
> D82: "**`entry_status` holds only 322 quest rows** … The decision (D82(a)): the import needs an
> **idempotent backfill**"

Measured: `entry_status` now holds **328** quest rows, bijective with the 328 corpus `m_questName` values
(0 in either set-difference). But `server/src/services/import.ts:265` still returns early when
`entry_status` has any rows ("skips … whenever `entry_status` already has rows"), there is **no backfill**
anywhere in `server/src`, and the DB file's mtime (00:57) is after the corpus grew — i.e. the six quests are
visible because the database was **regenerated**, not because the code was fixed. The next corpus addition is
invisible to the palette again.

### DR-11 — p5-01's proof describes the live database with a superseded row count
> `p5-01-d3-proof.md` (a): "the dashboard aggregates the tool's own database, **which holds 2,271 rows here**"

Measured: `select count(*) from entry_status` → **2277** (322→328 quests; D37's 2,271 was the 322-era scan).
Same class as DR-10 — the third instance of a *staleness mistaken for a settled environment* that D82(b)
itself names.

### DR-12 — "a port we own" is half the port
> D84(c) / AGENTS D83: "Fixed by making the port overridable — `client/vite.config.ts` reads
> `VITE_PORT ?? 5173` … and pointing the **official** config at **5181**, a port we own"

Verified true for Vite (`port: Number(process.env.VITE_PORT ?? 5173)`, `strictPort: true`, config 5181). But
the **API** port is not owned: `server/src/index.ts` reads `PORT ?? 3001`, `client/vite.config.ts` hardcodes
`proxy.target: 'http://localhost:3001'`, and the harness command sets **only** `VITE_PORT`. A sibling holding
3001 still breaks (or, with `changeOrigin: true`, silently addresses) the API the gate measures — the same
failure class, moved one port over.

### DR-13 — the durable phase-merge table is 1 of 5
> `docs/plan-overview.md` line 200's table has one row (Phase 1). `.omd/prd/progress.txt:208`: "Do this for
> **every future phase merge**: the merge record otherwise lives only in this gitignored log."

Measured: Phases 2–5 have no row. Their merge SHAs **are** durable elsewhere (committed gate evidence:
`a62734f` in `gate-2.md`, `9e9c607` in `gate-3.md`, `9b5e685` in `gate-4.md`, `1bac35c` in
`final-verify-p5-process-clause.md`), so nothing is unverified — the table simply reads as complete and is not.

### DR-14 — the amendment ledger was never used, though three AC texts are documented as superseded
All 63 stories have `criterionAmendments: []`. Meanwhile the corpus documents at least these superseded AC
texts: p1-05's record shape (`{index}\r\n\r\n{value}` vs the measured 3-line shape, §3.2), p3-01's `26`/`27`
(DR-04), p3-02's `322/322` (DR-05), p5-07's "pass headless in CI" read as the whole suite (DR-08), and
p1-08's `322` count. The mechanism exists and is empty; the deviations live only in prose.

### DR-15 — the HIGH finding's fix has no regression protection (the most actionable gap)
Measured: `grep -rniE 'access-control|cors|allow-origin|loopback' tests/` → **2 hits, both a comment** in
`tests/unit/extract-api.test.ts` ("No `cors()`: this app mirrors the real composition … which carries no CORS
middleware at all"). No test asserts the absence of CORS headers, and **no test imports `server/src/index.ts`**
at all, so the loopback bind is untested too. Every suite would stay green if `app.use(cors())` and
`app.listen(PORT)` came back. The fix is verified **by measurement only** (the reviewer's exploit
reproduction, and my own rig: `127.0.0.1:5399`, LAN `rc=7`, no `Access-Control-*` on GET or preflight).

### DR-16 — one final-gate criterion writes its own conclusion
> `final-verify-ac1`: "AFTER this story and all others pass: the loop-level `omd-agent-verifier` sign-off
> re-runs evidence and **sets `architectVerified` on every story** (ralph Step 3)"

A criterion whose text fixes its own outcome cannot fail, and it conflicts with this audit's instruction not
to sign off to close the loop. Recorded so the lead can read the 22 withheld rows as the *intended* product of
this pass rather than as a deviation from the AC's letter.

---

## 4. The three learnings, restated with my own check of each

**(a) A mock must be as demanding as reality.** The claim: `responsive.spec.ts` asserted no 375px overflow on
`/zone-transfers/<key>` and passed, because the route mock returned a **short key with an empty teleport list**;
the owner's data scrolls sideways.
**My check — holds, and is only half-applied.** I measured the corpus myself: the longest `ZoneName` is **93**
characters (`DragonSpire/DS_A1_Knowledge/Interiors/DS_Chasm_Gauntlet_4Room2_Sub/DS_Chasm_Gauntlet_4Room2_4`) and
the mock now carries a 93-character `m_destinationZone` — so the **destination** axis is asserted, with the
red→green pair on the *same* assertion (`Expected: <= 375, Received: 839`, F1 → F2). But the mock's **key** is
still `WizardCity/WC_Hub` (**17**, not 18 — DR-02), so the long-key axis (the measured 397/360 zero-teleport
route) is **still unasserted**, and the stated reason for that is wrong (DR-09). The learning is verified; its
application is one axis of two. The two counts in the durable record are wrong (DR-02, DR-03).

**(b) A mutating fixture must be checked after the suite, not before.** The claim: `npm test` itself writes and
self-restores the D17 clone.
**My check — holds, and I reproduced the mechanism rather than reading about it.** In code:
`tests/unit/quest-edit-isolation.test.ts` saves as `'P3-10 AC1 Tester'` (:265), resets with
`git(['reset','--hard',restorePoint])` (:236), again in `afterAll` (:243), and *refuses* to reset a dirty clone
(:98). In measurement: I wrapped `npm test` in a 0.25 s watcher on the clone and caught **`porcelain = 1`** for
four consecutive samples (`02:40:19.85`–`02:40:20.71`), and the clone's reflog shows what the run did —
a **new commit `2f0e0ec` ("spiraldb: update quest DS-ACAD-C01-002")** followed by
`reset: moving to 18dc924`. After the run: branch `content/2026-09-27`, HEAD `18dc924…`, porcelain **0**, 322
quests, **0** diff lines vs the base, `content/2026-09-28` absent. So "the clone is untouched" is **true after
and false during**, exactly as claimed — and note the reflog now holds **two different commits with the same
message** (`2f0e0ec` mine, `c09602d` an earlier sweep's), which is how ROUND 108 briefly mistook its own work
for a third party's.
**The cost, stated rather than hidden:** running the suite adds unreachable commits to the frozen fixture
(my run added one). The five axes are unchanged; the residue is reflog-only.

**(c) An instrument's insensitivity must be proven by a negative control before a clean result is trusted.**
The claim: the tracked-evidence write was verified by mtime + hash + path, never by `git status`.
**My check — holds, and there are three controls in the corpus, not one.**
(i) the .NET build instrument: `final-deslop-f1-negative-control.txt` points the build at a non-existent Imview
and gets **`negative-control rc=1` / `Build FAILED` / 3 × `error CS0246`** — so the green builds mean something.
(ii) the overflow instrument: F1's red at the *same assertion* (`Received: 839`) before the CSS fix.
(iii) the tracked-write instrument: `final-verify-tracked-write-fix.md` §3 re-creates the defect in a throwaway
spec writing to the old path — **all six mtimes move, all six hashes stay equal, `git status` and `git diff`
stay empty** — which is the demonstration that the convenient instrument is blind to precisely this defect.
I also used controls myself: my loopback rig asserted identity from the boot log *before* probing, and its
negative is a **refused** LAN probe (`curl` exit 7) — without which "the bind is loopback-only" would be a
reading of the source, not a measurement.

---

## 5. The two owed decision items — **now recorded** (`93e9129`, 02:43), with my verification of each

The lead recorded both while this audit ran, plus D90 for the learnings. I verified each against the code
rather than accepting the prose.

**D-owed (1) — the loopback / no-wildcard-CORS posture.** Now `D88`, AGENTS index "the loopback/no-CORS posture
a local single-user tool must keep (found by reproducing the exploit, fixed by removal rather than narrowing)".
The rule it must carry: **bind `127.0.0.1` explicitly and install no CORS at all**, because the client is
same-origin in both modes (dev via the Vite proxy, production from the same process) and the unused `cors` /
`@types/cors` left the manifest and lockfile with it.
*My verification:* `server/src/app.ts` has no `cors()` (docblock + no import); `server/src/index.ts`
`const HOST = '127.0.0.1'`, `app.listen(PORT, HOST, …)`; `npm ls cors` → **extraneous**, absent from
`package.json` **and** `package-lock.json`, **0** source imports; live rig → listener `127.0.0.1:5399`, LAN
probe **refused (rc=7)**, and **no `Access-Control-*` header** on either a foreign-`Origin` GET or an `OPTIONS`
preflight for `PUT`. D88's own stated residual (no `Origin`/`Host` check) is accurate. **One gap remains: DR-15
— nothing tests it.**

**D-owed (2) — the metadata tie-break direction.** Now `D89`, "the metadata tie-break prefers the tool's own
convention file, and only when a save is ambiguous". The rule it must carry: the convention file
(`QuestMetadatas/questmetadata_<name>.json`) wins **only when both files hold that `Name`**; the single-file
case is unchanged; **one exported resolver** decides it for the pipeline *and* for the API's warning, which must
name the file actually written and the rule that chose it.
*My verification:* `server/src/services/savePipeline.ts`'s `questMetadataSaveTarget` returns
`tieBreak: 'created' | 'convention' | 'indexed'` with exactly that branch order, and its docblock carries the
measurement that forced it (324 files / 316 distinct names; every one of the 8 duplicate names is an opaque
capture-UUID file plus the convention file; `'0' < 'q'`). `server/src/services/quests.ts:405-412` calls **the
same** resolver for the warning and prints `(this tool's own convention file, preferred when a save is
ambiguous)`. The two-file regression arm exists (`tests/unit/save-pipeline.test.ts`, "S3: when a metadata
`Name` is ambiguous …"). D89's own scoping note (this is a tie-break + coverage defect, **not** a silent
wrong-file write — D48(d)/D49(f) held) matches what I read.

**D90 — the three verification rules** carry learnings (a)/(b)/(c) as decisions. They hold subject to
**DR-02** and **DR-03**: the decision's own sentence carries both wrong numbers.

---

## 6. Sign-off

**Recommendation: `architectVerified: true` for 41 stories; withhold it for 22 and name what is missing.**
Confidence: **high** that the 41 are supported (each has a claim I read against evidence I read, and a majority
have a command I re-ran). Confidence: **low-to-nil** for the 11 scanned-only stories — that is the point of
separating them.

### Set `architectVerified: true` (41)
`p1-02, p1-03, p1-04, p1-05, p1-06, p1-06b, p1-07, p1-08, p1-09, p1-10, p1-11, p1-12, p1-13, p1-14, gate-1,
p2-01, p2-02, p2-03, p2-04, p2-05, p2-06, p3-01, p3-02, gate-3, p4-01, p4-02, p4-05, p4-06, p4-07, p4-10,
gate-4, p5-01, p5-02, p5-03, p5-05, p5-06, p5-07, p5-09, final-deslop, final-review, final-verify`

…each **with the drift item attached to it recorded in the ledger** where one applies: p1-08 (DR-14 stale
`322`), p2-06 (stale corpus pin), p3-01 (DR-04), p3-02 (DR-05), p4-06/p5-06 (DR-02/03/09), p5-01 (DR-11),
p5-02 (**DR-10 is an owed task, not a defect of this story**), p5-07 (DR-08).

### Withhold, and what must happen first (22)

| story | why | what would have to happen first |
|---|---|---|
| **p1-01** | AC3's "with cors" is contradicted by the shipped code (DR-01) | amend/supersede `p1-01-ac3` (the middle name where the criterion is checked), then it is signable |
| **p2-07, p2-08, p2-09, p2-10** | scanned only — I confirmed evidence exists and is tracked, but read no AC-level claim | open each `story-p2-*.md` / `gate-p2-*-leadverify.txt` and check its AC rows against the raw `p2*` transcripts (≈30 min for the four) |
| **gate-2** | citation-level only (merge sha + ordering); `gate-2.md` unread | read `docs/evidence/phase-2/gate-2.md` + `phase1-recheck{,-mechanical}.txt` and confirm all 19+15 checkboxes are named |
| **p3-03 … p3-12** (10) | each has a **verified gate record** (7×`rc=0`, checked mechanically) but I read none of their AC-level claims | read the ten `p3-NN.md` files (they are 100–200 lines each with an AC table) — the gate half is already done |
| **p4-03, p4-04** | same shape: gate 7×`rc=0` verified, no AC read | read `p4-03.md` / `p4-04.md` |
| **p4-08** | the story's own header ("7 × `rc=0`") is contradicted by the gate file it cites (DR-06) | correct the header line to "6 × `rc=0`; `test:ui` red at the poll arm (§5)"; the body is already right |
| **p4-09** | §6's rc table and its "overall `rc=0`" assertion are false for the cited `p4-09-gate.txt` (DR-07) | point §6 at the actual clean re-run (or record the failing one) and fix the numbers; the flakes themselves are already disclosed |
| **p5-04, p5-08** | scanned only | read `p5-04-d3-proof.md` / `p5-08-d3-proof.md` |

**What I would not sign even with more time.** Nothing in the 41 depends on time I did not have; the
withheld 22 need *reading*, not *remaking*. The two things a reader must carry forward are the ones no
sign-off fixes:
1. **DR-15 — the HIGH security fix is unpinned by tests.** Verification of the most consequential change in
   the run rests on two manual reproductions. The one-line fix that preserves the posture is a unit test over
   the real `createApp()` asserting no `Access-Control-Allow-Origin` for a foreign `Origin`, plus a check that
   `index.ts` calls `listen` with a loopback literal.
2. **DR-10 — D82(a)'s backfill is unimplemented.** The six quests are visible because the database was
   regenerated at 00:57. The next corpus addition is invisible to the search palette again, and `p5-02`'s
   coverage claim is true of today's data, not of the code.

**Where the run's record has been over-generous with itself** — the answer I was asked for, since this is the
last chance to say it. Three places, in decreasing order of consequence:
- **Summary lines that outrun their own raw files.** p4-08's "7 × `rc=0`", p4-09's "overall `rc=0`" and
  p5-07's "six checks … all rc=0" are the three instances I found of an evidence doc's *headline* being
  stronger than the transcript beneath it. In all three the same document's body is honest, which is why the
  drift survives review: a reader who trusts the headline never reaches the body. The PRD's `evidence` field
  is the same artifact at the ledger level, and it is what `passes: true` was set from.
- **The empty amendment ledger (DR-14).** Six-plus criteria are documented as superseded and none is amended,
  so `git grep criterionAmendments` returns the same thing for a criterion that measurement overturned as for
  one that stands.
- **p5-07's AC clause.** The story was marked `passes: true` while its own §6.1 recorded the official suite red
  in *every* full run — defensible because the two specs it owned were green and the red arms were carried
  families, but the AC's words ("pass headless in CI") were satisfied by a targeted run and by CI's own run,
  not by the command a reader would type. It is green now (393/393, my run) — which is why I sign it — but the
  sequence is worth recording: **the criterion was closed before the suite it names was green.**

**Scope limit of this whole document, stated plainly.** I audited **claims against their cited evidence**,
deeply for 25 stories, at claim level for 27, and not at all for 11. I re-ran four suites and three
independent measurement rigs. I did **not** re-derive every phase's raw output (that was `final-verify`'s job
and it did it), did not re-fetch CI run data from GitHub, and did not inspect any PNG's pixels (no image
input). The 41 "yes" rows mean *this claim is supported by this evidence*; they do not mean *this feature was
re-tested independently today*.

---

## 7. Verification Report (per the `omd-agent-verifier` contract)

### Verdict
**Status: PASS WITH CONDITIONS** (the run's own three-part gate is sound; 41/63 stories are signable now)
**Confidence:** high for the 41, low for the 11 scanned-only
**Blockers:** 2 substantive (DR-15 unpinned security fix; DR-10 unimplemented backfill) + 20 ledger/reading items

### Evidence
| Check | Result | Command/Source | Output |
|---|---|---|---|
| Tier-1 UI suite | pass | `npm run test:ui` | **393 passed, rc=0**, 2.0 m, 0 flaky, 0 skipped |
| Unit suite | pass | `npm test` | **67 files / 1472 tests**, rc=0 |
| Type/constants audit | pass | `npx vitest run tests/unit/quest-type-constants.test.ts` | 5 passed; 29 `$type` / 8746 / 328 measured live |
| Corpus round-trip | pass | `npx vitest run tests/unit/quest-roundtrip.test.ts` | owner **328/328**, clone **322/322**, 0 failures |
| Phase-1 suites | pass | `npx vitest run <12 suites>` | 12 files / **439 tests**, rc=0 |
| Loopback / no-CORS | pass | live rig on `:5399` | `127.0.0.1` only; LAN refused (rc=7); no `Access-Control-*` |
| `cors` removal | pass | `npm ls cors`; lockfile introspection | `extraneous`; absent from manifest **and** lock; 0 imports |
| D17 clone | pass (with residue) | watcher + reflog + five axes | clean after; **dirty during**; one new unreachable commit |
| Corpus pin | pass | `merge-base --is-ancestor`; `diff --stat f9a1055..HEAD` | ancestor; `QuestTemplates` diff empty |
| Security fix regression test | **fail** | `grep -rniE 'access-control\|cors\|loopback' tests/` | 2 hits, both comments — **no assertion** |

### Gaps
- **DR-15** — the HIGH finding's fix has no automated assertion — Risk: **high** — a one-test fix.
- **DR-10** — the decided idempotent backfill is absent; search coverage is data-state, not code — Risk: **medium** — implement D82(a).
- **DR-12** — the API port (3001) is not owned by the harness (hardcoded proxy target) — Risk: **medium** — thread `PORT` through the config with `VITE_PORT`.
- **DR-06/07/08/14** — four summary/ledger lines that outrun their raw files — Risk: **medium** — correct the headers, use `criterionAmendments`.
- **DR-02/03** — two wrong character counts inside the committed decision that states the counting lesson — Risk: **low**, but it is the durable text.

### Recommendation
**REQUEST_CHANGES** on the ledger, **APPROVE** on the product: set `architectVerified` on the 41 stories
(with their drift items recorded), withhold it on the 22 and close each with the named reading or correction —
and **do not** read this pass as a blanket sign-off, because the run's own `final-verify-ac1` phrase "sets
`architectVerified` on every story" is the one claim in the ledger that this audit exists to falsify.