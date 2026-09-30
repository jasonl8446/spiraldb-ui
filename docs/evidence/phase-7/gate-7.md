# gate-7 — Phase 7 boundary gate, local half: every phase's Verification Steps re-run fresh, plus a CI simulation

**Criterion 1 (verbatim):** "Full Phase 1-6 acceptance suites re-run fresh together with the complete Phase 7 suite
(p7-01..p7-17): npm test, npm run lint, npm run test:ui and every phase doc Verification Steps; RAW outputs recorded, no
looks-done verdicts."

**Run:** 2026-09-30 04:12–04:55 (EDT). Branch `phase-7-coverage-usability`, HEAD `dc450f186f45e15d43efd0e172fc10dd8a829720`.
Working tree clean at the start, apart from gitignored files. Every step comes from its own plan's Verification steps
section (`docs/plan-phase-{1..7}-*.md`). Where final-verify (`docs/evidence/final-verify.md`) already had a command, this
run reuses it so the two sweeps can be compared. Raw output is in the sidecars named in each row. A `file:line` points at
the line that carries the reading. A step that could not run exactly as written runs as its closest honest equivalent and
is listed under [Deviations](#deviations).

**Result:** every step ran and passed, except the one owner-only step (replaying a real capture, GD15). The CI
simulation found that **CI at HEAD would have been red**: 12 tier-1 failures, all in Phase 7 specs that read the D17
clone. Three spec files were fixed (see [Fixes](#fixes-made-by-this-gate-ci-only)). After the fixes, the simulated CI run
is green, and so is the full local suite.

## Environment

| Fact | Reading |
|---|---|
| Node / npm | `v24.21.0` / `11.19.0` |
| D17 clone `data/test-spiraldb` | `content/2026-09-27` @ `18dc924`, main `f3f8b5c`, 42 commits, porcelain 0, 322 `QuestTemplates/*.json`, branches `content/2026-09-26 content/2026-09-27 main`. Restored to exactly this after every write arm and checked at the end ([Clone and ports](#clone-and-ports-at-the-end)) |
| Owner fork (read-only) | **330** `QuestTemplates/*.json` at `content/2026-09-28 864bd44`. final-verify recorded 328, so every count below names its corpus |
| Owner dev server | `:3001` (pid 3642061) and `:5173` (pid 2749133). Never touched; `data/spiraldb-ui.db` was read once, through an online `backup()`, for P7-4 |
| Sweep stack | the **built** server (`node server/dist/server/src/index.js`, which is `npm start`'s command) on **:3292**. It serves the API and `client/dist`, with `SPIRALDB_UI_DB=<scratch>/ui.db` and `SPIRALDB_PATH=data/test-spiraldb`. Settings: `user_name=Gate7 Sweep`, `git_branch=content/2026-09-27` (D76(b)/D119) |
| UI driver | the repo's pinned Playwright chromium (D40/D148; the playwright-mcp browser cannot launch on this host). Arms are in `gate-7-ui-sweep.mjs.txt`. The Phase 7 walkthroughs are the committed `p7-08`/`p7-14` tier-2 scripts |
| .NET | `dotnet --version` → `9.0.318` (builds, reader, census). The Imlight harness used `IMLIGHT_DOTNET_ROOT=/nix/store/fi5f9aa5jsb7f05k9q2pr0fhj6kxdmmf-dotnet-sdk-10.0.401/share/dotnet` |

## Summary table

| Step | Result | Evidence (file:line) | Deviation |
|---|---|---|---|
| **Gates, first run at dc450f1** | `npm test` 107 files / **2178 passed**; lint rc 0; typecheck:tests rc 0; typecheck:scripts rc 0; build rc 0; `npm run test:ui` **455 passed** (12 workers) | `gate-7-freeze-and-gates.txt:22,33,60` | — |
| **Gates, final run after the fixes** | `npm test` **2178/2178**; lint rc 0; both typechecks rc 0; build rc 0; `npm run test:ui` **455 passed**, 0 failed, 0 flaky, 0 skipped (the clone is present, so the 6 p7-drafts tests run) | `gate-7-freeze-and-gates.txt:74,80,91,118` | — |
| **CI simulation at dc450f1 (run 3)** | **RED**: 12 failed (p7-drafts 1 + 5 did not run, p7-label-scan 8, p7-overview 3), 1 flaky (object-create-and-counts:333), 437 passed | `gate-7-ci-sim.txt` "RUN 3" | GD16 |
| **CI simulation after the fixes (run 4)** | all six CI steps green: `npm test` 2076 passed / 102 skipped; `npm run test:ui` **449 passed, 6 skipped** (p7-drafts, with its reason), 0 failed, 0 flaky | `gate-7-ci-sim.txt` "RUN 4" | GD16 |
| P1-1 sync → counts | isolated sync SUCCESS, items 79,835 · spells 18,173 · npcs 23,033 · quests 322 · zones 3,357; table counts via better-sqlite3 | `gate-7-p1.txt:12` | GD1, GD2 |
| P1-2 names shape | `{"items":[{"gid":1740074,"name":" +100 Energy Elixir"},…` | `gate-7-p1.txt:87` | GD3 |
| P1-3 summary = file counts | `{total:2271, extracted:2271}`; quest 322 = the clone's 322 files; fork 330 printed too | `gate-7-p1.txt:92` | — |
| P1-4 PATCH + history | reviewed; `status_history` id 1 with notes + changed_by | `gate-7-p1.txt:109,116` | — |
| P1-5 npm test | 2178/2178 | gates row | — |
| P1-6 settings → sync → toast; dropdown | toast `Sync complete: 79,835 items · … · 322 quests · 3,357 zones`; `Gretta` → `Gretta Darkkettle (38098)`, hidden `TemplateID=38098` | `gate-7-p1.txt:122,126`; `gate-7-p1-06-settings-sync-toast.png` | GD3 |
| P1-7 test:ui | 455 passed | gates row | — |
| P2-1 dotnet + builds | 9.0.318; build:cli and build:fixturegen succeeded, 0 errors | `gate-7-p2.txt:4-17` | — |
| P2-2 fixturegen → reader | 12,697 B capture, self-checks pass; reader length 1, `DS-ACAD1-C01-001` | `gate-7-p2.txt:31-54` | GD4 |
| P2-3 extract route | `count 1 [WC-UNICORN-MAIN-004]`; `.md` → 400 envelope; health ok | `gate-7-p2.txt:60,65` | — |
| P2-4 upload → Save All (2) → confirm | 2 results; 2 × `saved and committed` | `gate-7-p2.txt:70-73`; `gate-7-p2-04-results.png` | — |
| P2-5 clone: branch, log, files | `update quest` × 2 from the UI, and the literal `spiraldb: extract quest DM-BLACK-MAIN-013 (Gate7 Sweep)` (a quest that exists only in the fork) with template + metadata in one commit | `gate-7-p2.txt:122,126` | GD5 |
| P2-6 strict JSON | 4 × `strict JSON OK`; the pre-save MB-YARD1 blob fails strict parsing | `gate-7-p2.txt:152,158` | — |
| P2-7 history note | `"Imported from packet capture gate-7-dm-black.json"`. **Reproduces as written** because the key was untracked (final-verify F1 needed a positive control) | `gate-7-p2.txt:165` | — |
| P2-8 browse → detail → mark reviewed | badge `Status: Reviewed`, toast | `gate-7-p2.txt:174` | — |
| P3-1 `$type` grep (fork) | 29 distinct / 8,748 / 330 files, which matches the constants audit test (`[p3-01 ac1] measured: 29 … 8748 … 330`) | `gate-7-p3.txt:36-37`, `:75` | — |
| P3-2 round-trip counts | clone `files discovered=322 round-tripped=322 failures=0`; fork 330/330 | `gate-7-p3.txt:47` | GD6 |
| P3-3 edit → save → diff | one line (`m_usePatron` false→true); metadata ModifiedAt/By only; **1 changed value path**, no key-order drift | `gate-7-p3.txt:92,112` | — |
| P3-4 load back | API `goal0_usePatron: true`; after a full reload the card shows `Use Patron … ✓` and the editor box is checked, `data-dirty=false` | `gate-7-p3.txt:121-124` | — |
| P3-5 validation negatives | curl 400 + `fields["m_startGoals[0]"]`, nothing written; UI `1 validation error blocks saving: Unknown start goal.`, Save `aria-disabled=true data-blocked=true`; Discard restores | `gate-7-p3.txt:130,144,146`; `gate-7-p3-05-validation-negative.png` | — |
| P3-6 flowchart / requirements / dialog | MB-YARD1 16 nodes / 15 edges; 4 requirement types + AND/OR; dialog DOM groups 7 = served 7 (CYCLOPS-002), 5 = 5 (UNICORN-007) | `gate-7-p3.txt:150-155`; `gate-7-p3-06-flowchart-MB-YARD1.png` | — |
| P4-1 per-family round-trip | 6 families × both corpora, `ls\|wc -l` = round-tripped, 0 failures | `gate-7-p3.txt:48-72` (the P4-1 lines) | — |
| P4-2 per-type edit loop | 6/6 present families: a real edit gives one commit and one path, then a restore; closing md5 IDENTICAL, porcelain 0. npcdroptable (family absent in the frozen clone) was edited after P4-3 created it: one commit, one path | `gate-7-p4.txt:79-87`, `:292-299` | GD7 |
| P4-3 create loop | 7/7 filenames match the spec-data-model table (npcdroptable created into an absent directory) | `gate-7-p4.txt:160-199`, `:282` | GD7 |
| P4-4 validation negatives | curl 400 for empty Name, both duplicate arms, RollChance 1.5, NoneChance −0.1, MinGold>MaxGold; a 200 control; UI blocks Save on the three reachable arms | `gate-7-p4.txt:224-264`, `:246-248` | GD7 |
| P4-5 GlobalRegistry | one commit, `R096` / `--no-renames` D+A; one file left; written == posted (23 flags, Krampus 1); status type 404 | `gate-7-p4.txt:376,389` | GD7, GD8 |
| P4-6 viewports | 69 cells (23 routes × 375/768/1440), **0 overflow**; rail 0/200/260; list routes are cards at 375 and tables at 768; tier-1 responsive specs green | `gate-7-p4.txt:402` | — |
| P5-1 npm test | 2178/2178 | gates row | — |
| P5-2 two sessions | B before refresh `Verified 0`, after refresh `Verified 1 · Quests 1/323 (0.3%)`, feed row `WC-CYCLOPS-MAIN-002 marked verified` | `gate-7-p5.txt:4,7`; `gate-7-p5-02-second-session-dashboard.png` | — |
| P5-3 build + start → SPA | `/quests` `200 text/html` 508 B = index.html; 6 other routes 200 text/html | `gate-7-p5.txt:22,50` | GD3 |
| P5-4 viewports | the same 69-cell sweep, plus `responsive.spec.ts` in the green tier-1 run | `gate-7-p5.txt:66` | — |
| P5-5 axe | axe 4.13.0: **0 violations** on the four named pages; negative control `image-alt/critical` appears, then 0 | `gate-7-p5.txt:70-75` | GD9 |
| P5-6 fresh-clone dry run | clone 0 s → `npm ci` 16 s → sync 30 s (0 quests: a fresh clone has no corpus) → build 12 s → prod `/quests` 200 text/html | `gate-7-p5.txt:104,175,184` | GD10 |
| P6-1 wad census | 3,589 wads; 176,943 A + 6,733 B = **183,676**; TutorialQuestTemplate 11; no QuestTemplate row; 32 s | `gate-7-p6.txt:5-22` | — |
| P6-2 wad-scan extract | **6,733 rows** (3,356 + 3,377), 0 failed, 97,660,625 B, 4.4 s | `gate-7-p6.txt:30-36` | GD11 |
| P6-3 sync + coverage | two full syncs identical in every count; coverage `{1717, 4823, 322, 1395, 2855}` | `gate-7-p6.txt:45,68-69,73` | — |
| P6-4 evidence | title "Run and Done"; 30 text rows (**22 used**); 27 dialogue rows, speaker "Cyrus Drake" (composed); gates `[]` | `gate-7-p6.txt:55-63` | O2 |
| P6-5 names per family | pairs in the API and the DOM; `87112` and `Ugo` find the same row; the palette reports `matched_on` key/name; `Gretta` gives **one** NPC row | `gate-7-p6.txt:79,132`, `:226,242` | — |
| P6-6 catalog → scaffold → dialogue row → save; loadability | 1717 rows / 1395 missing → scaffold `DM-GRAVE-MAIN-008` → Prep group, 66-key entry → save commits. **Live Imlight: 322 + 1 = 323, PASS**, clone restored | `gate-7-p6.txt:143,217`, `:453,479`; `gate-7-p6-06-scaffold-dialog-saved.png` | — |
| P6-7 no wad-scan → skipped | `status SUCCESS`, catalog + breadth `SKIPPED` naming `npm run build:wadscan`; the symlink is restored, and the next sync restores coverage | `gate-7-p6.txt:272`, `:297,304` | GD12 |
| P6-8 gates | npm test, lint, test:ui green | gates rows | — |
| **P7-1** capture-census over the p7 fixtures | 9/9 fixtures exit 0, byte-identical to the committed census goldens; **72 planted fields, 0 missing** from the census | `gate-7-p7-1-census.txt:2-10,22` | — |
| **P7-2** packet reader per p7 fixture | 9/9: stdout **and** suggestions sidecar byte-identical to the goldens; the word "suggestion" never appears in stdout; the p7-04 field-diff run over its own fixtures, plus the CI-bound vitest (176 passed) | `gate-7-p7-2-reader.txt:3-11,123,131` | GD13 |
| **P7-3** verify:captures then audit:corpus (not concurrent with anything) | `PASS: 5 fixture(s), 55 field check(s), 0 mismatch(es)`; **`PASS: 314/322 verified, 8 not covered …, 0 failure(s)`** on the D17 clone | `gate-7-p7-3-verify-captures.txt:83`; `gate-7-p7-3-audit-corpus.txt:37` | — |
| **P7-4** drafts × 2 on a dev-DB copy | run 1 inserted 5,458; run 2 **inserted 0 / unchanged 5,458**, identical counts; all 4 reconcile checks = 1; catalog ids without a draft = 0 | `gate-7-p7-4-drafts.txt:53-54,106,110` | GD14 |
| **P7-5** /drafts → named missing quest → accept 3 → save → live Imlight +1 | `NV-PUERT-MAIN-012`: accepted title/goals/requirements in the real UI, save 200 commits; **322 + 1 = 323 PASS**; every clone axis restored | `gate-7-p7-5-live-boot.txt:121-124,146-148,174`; `gate-7-p7-5-{queue,draft-editor,accepted,saved,name-dialog}.png` | GD17 |
| **P7-6** Overview → Goals → Dialog → popover → /glossary | lands on Overview; readable cards with pair labels; 15 Advanced accordions (collapsed and auto-opened shown); popover names technical `m_questLevel` + source; glossary finds 1 row for each half | `gate-7-p7-6-walkthrough.txt:1-10`; `gate-7-p7-6-*.png` (7) | GD17 |
| **P7-7** npm test, lint, test:ui | green (gates rows) | `gate-7-freeze-and-gates.txt` | — |
| owner step: replay a real capture | **not run: owner-only** (Phase 7 "Done when"), no real capture exists in the run | — | GD15 |

## Phase 7 steps in detail

### P7-1 — `tools/bin/capture-census --input server/test/fixtures/captures/p7/*.json`: every planted field listed

```console
$ for each p7 fixture: tools/bin/capture-census --input …/p7/<Q>.json > <scratch>/<Q>.census.json; cmp against the committed <Q>.census.json
DS-ACAD1-C04-001 … WC-UNICORN-MAIN-002: 9 × exit=0, vs-committed-golden=identical
$ node census-check.mjs   # every (message, field) planted by <Q>.inject.json must be a census row with count >= 1
DS-ACAD-C01-003      messages=11 rows=56 planted-fields=12 listed=12 unconsumed-planted=- missing=-
…
WC-UNICORN-MAIN-002  messages=12 rows=56 planted-fields=12 listed=12 unconsumed-planted=- missing=-
TOTAL planted fields 72, missing from census 0
```

### P7-2 — the packet reader over each p7 fixture: observed = plant, `suggestions` holds the inferred values

```console
$ tools/bin/imview-packet-reader --input …/p7/<Q>.json --suggestions <scratch>/<Q>.s.json   (9 fixtures)
DS-ACAD1-C04-001     exit=0 quests=1 stdout-vs-golden=identical sidecar-vs-golden=identical suggestions=3 sources=["capture-orderx1","capture-rewardsx2"]
DS-ACAD1-C04-003     exit=0 quests=1 stdout-vs-golden=identical sidecar-vs-golden=identical suggestions=0 sources=[]
…  (all 9 identical; 25 suggestions in total, all capture-order / capture-rewards)
stdout contains the word "suggestion": 0   (× 9)
```

The comparison instrument was the p7-04 field-diff script (`p7-04.md`, "Field-diff script"). It **crashed on its first,
unfiltered run**: `TypeError … at goalFor` on `DS-ACAD1-C04-003`, a p7-05 fixture whose plant is
`MSG_SENDGOAL.GoalType`, which the script has no mapping for. The script was then run on the five fixtures it was
written for. On four of them it reports 0 diffs. On `WC-TUT-C05-001` it reports **8 DIFF rows, which the script
itself causes**. p7-05 repaired a reader defect by adding back the four ACHIEVERANK goals that share GoalNameID 0, so the
script's rule "the first GoalID owns the GoalNameID" maps GoalIDs 2..5 to no goal. Reading the fresh stdout directly
shows the values are all there (`gate-7-p7-2-reader.txt:136-151`):

```console
  2_ … m_completeText= P7-PLANT-CompleteGoal-WC-TUT-C05-001-g1   …   5_ … m_completeText= …-g4
{"report":"observed-field", … "path":"m_goals[2_].m_personaName", … "reason":"AchieveRankGoalTemplate has no m_personaName …"}  (× 5)
```

The p7-05 plants are covered by what CI itself runs against the inject specs. The goldens are byte-identical (above), and
`npx vitest run tests/unit/p7-observed-fields.test.ts tests/unit/p7-capture-census.test.ts tests/unit/p7-suggestions.test.ts`
gives **176 passed**.

### P7-3 — `npm run verify:captures && npm run audit:corpus`: 0 failures on the D17 clone

Both ran strictly one after the other. Nothing else was running (the sweep stack was stopped and no tests were running),
and the clone was clean at `18dc924`:

```console
$ npm run verify:captures
PASS: 5 fixture(s), 55 field check(s), 0 mismatch(es), 0 known-reader-defect row(s).        rc=0
$ npm run audit:corpus
verified:  314/322 round-trip identically through the real reader (3454 field check(s), 0 mismatch(es), 0 known-defect row(s))
not covered: 8 refused by the generator … 4 quest-level dialog tag not Prep/Completion · 4 m_goalName != "{n}_{m_goalTitle}"
PASS: 314/322 verified, 8 not covered by the synthetic harness, 0 failure(s) (165.7s).      rc=0
```

### P7-4 — `npm run drafts` twice: identical counts; coverage reconciles

The run follows p7-07's recipe: an online `backup()` of `data/spiraldb-ui.db` into
`data/__test-scratch__/gate-7-drafts.db`, whose `spiraldb_path` is the owner fork (330 files, read only). The runs gave
`proposed 5458` both times; run 1 `inserted 5458`, run 2 `inserted 0, unchanged 5458, removed 0`; `by_source` and
`drafts` are identical. Coverage `{nameable 1717, id_space 4823, defined 330, missing 1387, references 2855}`, and
`named_missing = missing`, `named_defined = defined`, `unnamed = unlinked (4648)`,
`drafts = nameable + unlinked`, all `1`; no duplicate identities. The same builder against the **clone** (P7-5 prep)
gives `named_missing 1395 / named_defined 322 / unnamed 4648`, which matches the clone's coverage row.

### P7-5 — live, against the clone-backed server

```console
$ IMLIGHT_DOTNET_ROOT=…dotnet-sdk-10.0.401… npm run imlight:boot -- prove-count --name NV-PUERT-MAIN-012 \
    --save-cmd "PLAYWRIGHT_BROWSERS_PATH=… BASE=http://localhost:3292 UNNAMED_ID=39199 OUT=<scratch>/shots-p7-08 node docs/evidence/phase-7/p7-08-tier2-walkthrough.mjs" \
    --evidence-dir <scratch>/boot --prefix gate-7 --restore-clone
[p7-08 tier-2] accepted m_questTitle on the Info tab / m_goals on the Goals tab / m_requirements on the Requirements tab
[p7-08 tier-2] save: HTTP 200 {"quest_name":"NV-PUERT-MAIN-012",…,"branch":"content/2026-09-27","accepted_suggestions":[990,991,992]}
  baseline line : SpiralDB loaded 2274 files: … 322 quest templates, 1205 zone data entries.
  after line    : SpiralDB loaded 2275 files: … 323 quest templates, 1205 zone data entries.
  arithmetic    : 322 + 1 = 323        delta : 1 (expected 1)        verdict : PASS — rises by exactly one
  every axis matches — the clone is restored                                                                        exit 0
```

### P7-6 — `docs/evidence/phase-7/p7-14-tier2-walkthrough.mjs`, run against :3292

The script is read-only and never presses Save. Tabs `Overview Info Goals Goal Logic Requirements Results Dialog`,
landing tab Overview; goals card `Defeat 2 Lost_Soul in Unicorn Way (Bounty goal) … Bounty Type (m_bountyType): Kill mobs
(BT_MOB_KILL)`; 15 Advanced accordions; popover `Quest level … Technical name: m_questLevel Source:
docs/spec-domain-reference.md:259`; `/glossary` searched by `m_questLevel` and by `Quest level` → 1 row each,
`data-term=m_questLevel`. Clone porcelain afterwards: 0.

## CI simulation

CI (`.github/workflows/ci.yml`) runs on a runner that has **no `data/`** (no clone, no dev DB), no owner fork, no sibling
repos and no .NET. The simulation:

1. `git worktree add --detach <scratch>/ci-sim HEAD` (dc450f1), then `npm ci` and `npm run test:ui:install`.
2. The CI step order ran inside `unshare -rm`, followed by a nested `unshare -U --map-user=1000` so the steps run as a
   plain uid, not as namespace-root (`gate-7-ci-sim.sh.txt`). The **whole** `/home/jason/Documents/git-projects`
   directory was replaced with an empty tmpfs, and only the main tree's `.git` was bound back, because the worktree's
   `.git` file points into it. So the fork, the siblings, the main tree's `data/`, `tools/bin` and `.artifacts` do not
   *exist*. Every `dotnet-sdk*` store path was hidden (`dotnet: command not found`), and `CI=true` was set, which gives
   one retry, as on GitHub. Ports 3181/5181 were checked free before each run.
3. Steps, in CI's order: `npm test`, `npm run build`, `npm run lint`, `npm run typecheck:tests`,
   `npm run test:ui:install`, `npm run test:ui`.

| Run | What it was | Result |
|---|---|---|
| 1 | empty tmpfs mounted over each sibling directory | discarded as a simulation defect: the directories still existed, and 4 unit tests read an *empty* fork. No runner looks like that |
| 2 | all of git-projects hidden (step 2 above) | npm test/build/lint/typecheck green. test:ui: every browser launch failed with exit 127, because the freshly downloaded chromium is an unpatched FHS binary that NixOS cannot run (a host artefact). For run 3 the main tree's patched `tools/.playwright-browsers` was copied in |
| **3** | **HEAD dc450f1, unmodified** | **RED**: 12 failed, 1 flaky, 5 did not run, 437 passed |
| 3b | the three fixed spec files, focused | p7-overview 3 ✓, p7-label-scan 9 ✓, p7-drafts 6 skipped with its reason. The earlier per-test-skip attempt failed at the queue test's draft editor (`[data-draft="missing"]` never rendered; 12 passed, 1 failed, 5 did not run). That is why the file is skipped as a whole |
| **4** | **the full CI sequence with the fixes** | **all steps green**: npm test 2076 passed / 102 skipped; test:ui **449 passed, 6 skipped, 0 flaky** |

Path resolution: every clone path in the specs is repo-root-relative (`tests/helpers/clone-fixture.ts` resolves
`../../data/test-spiraldb/` from its own URL). The only absolute `spiraldb-ui/data/…` strings are mock values in
`responsive.spec.ts` and `imlight-harness.test.ts`. The worktree reported `data/ … No such file or directory`, and the
harness booted on `<ci-sim>/data/test-ui.db`.

### Fixes made by this gate (CI only)

| File | Change | Why |
|---|---|---|
| `tests/ui/p7-overview.spec.ts` | `open()` route-fulfils `GET /api/quests/WC-CYCLOPS-MAIN-003` from a committed fixture | run 3: all 3 tests timed out waiting for `[data-edit-mode]` because the harness server has no clone to read. The fixture keeps the spec hermetic, like the Phase 3-6 specs |
| `tests/ui/p7-label-scan.spec.ts` | `openQuest()` route-fulfils each quest's document: five from `tests/unit/fixtures/card-titles-quests.json`, WC-CYCLOPS-MAIN-003 from the new fixture | run 3: all 8 scan tests failed. The five fixture documents were measured **byte-equal** to the clone-backed server's bodies (`JSON.stringify` equality, 5/5), so the scan inputs are unchanged |
| `tests/unit/fixtures/clone-quest-WC-CYCLOPS-MAIN-003.json` (new) | `{provenance, quest}`: the body of `GET /api/quests/WC-CYCLOPS-MAIN-003` from the clone-backed server (36 keys, 7 goals, no unsafe integers), prettier-formatted | the one quest the two specs need that the 10-quest fixture lacks |
| `tests/ui/p7-drafts.spec.ts` | file-level `test.skip(!CLONE_READY, NO_CLONE)` with the reason in the title annotation and a header comment | inherently clone-bound: every test commits into the clone and asserts its porcelain. The reason is visible: the test is reported as skipped, not passed. The draft/accept contract reaches CI through `tests/unit/p7-*.test.ts` |

After the fixes, the affected suites were re-run fresh: focused in the CI namespace (3b), the full CI sequence (run 4), and
the full local gates (the "final" gates row). The last includes the three files with the clone present: 18 ✓ lines, and
the p7-drafts tests really run locally.

## Deviations

| # | Step | The plan says | What ran, and why |
|---|---|---|---|
| GD1 | P1-1 | `rm -rf data && npm run sync` | `NODE_ENV=test SPIRALDB_UI_DB=<scratch>/ui.db npm run sync`. `data/` holds the clone and the owner's dev DB, which must survive (final-verify D1) |
| GD2 | P1-1 | `sqlite3 … count(*)` | the same query through better-sqlite3, because there is no `sqlite3` binary on the host |
| GD3 | P1-2/3/6, P5-3, all UI | `localhost:3001`, `npm run dev`, playwright-mcp | :3001/:5173 belong to the owner. The sweep's stack is the **built** server on :3292, so `npm start`'s shape is also P5-3. UI arms use repo-chromium Playwright scripts (D148) |
| GD4 | P2-2 | bare `tools/bin/fixturegen` | `DOTNET_ROOT` exported (D45(3)); the apphosts exit 131 without it |
| GD5 | P2-5 | `git branch --show-current` → a new `content/2026-XX-XX` | saves are pinned to `content/2026-09-27` (D76(b)/D119), so no new branch was created. The `extract` verb comes from a quest that exists only in the fork (`DM-BLACK-MAIN-013`); both clone quests the UI saved already existed (`update`) |
| GD6 | P3-2 | "reports `322 passed`" | no suite prints that string. The per-family lines of the fresh `npm test` are quoted (clone 322/322) |
| GD7 | P4-2..P4-5 | per-type loops | (a) NpcDropTable is absent in the frozen clone, so its edit ran after P4-3 created `npcdroptable_900000004.json`. (b) final-verify's `p4-02-03-loop.mjs` first does a no-op pass that correctly commits nothing, and that is shown. (c) Its `p4-04-negatives.mjs` "Name duplicate" probe posts the document's own name (the legitimate update arm) and committed an update of DS-ACAD-C01-002, as final-verify also recorded. The two documented duplicate arms were then run and both returned 400. (d) **My own first P4-5 POST was wrong**: it sent the *list* response as the document. That commit was dropped with `reset --hard HEAD~1` and P4-5 re-ran with the entry's document (`gate-7-p4.txt:353`). The first POST exposed finding F-C. All of these were undone by the clone reset |
| GD8 | P4-5 | `git status` shows the add and the delete | `git show --name-status` (+ `--no-renames`), because the change is committed |
| GD9 | P5-5 | axe reports archived under `docs/evidence/phase-5/` | quoted in `gate-7-p5.txt`. This gate writes only into `phase-7/` |
| GD10 | P5-6 | full 5.8 recipe | clone → `npm ci` (with scripts this time) → sync → build → prod start → SPA route. `build:cli` and the walkthrough ran on the main stack (P2/P3/P6), not in the fresh tree. The fresh tree is the **committed** HEAD, so it excludes this gate's uncommitted spec fixes. The script's PID file held the subshell, and the listener (pid 3762576) was killed explicitly |
| GD11 | P6-2 | `wad-scan extract --select …` | plus the tool's required `--gamedata` and `--out` |
| GD12 | P6-7 | remove `tools/bin/wad-scan` | the gitignored symlink was moved aside and restored (same `readlink`) |
| GD13 | P7-2 | "observed fields equal the plant" | the p7-04 field-diff script covers its own five fixtures. Its WC-TUT-C05-001 join is stale after p7-05, and the values were read directly. The p7-05 fixtures are checked by golden identity plus the CI-bound vitest (see P7-2 above) |
| GD14 | P7-4 | `npm run drafts` twice + coverage | on a scratch copy of the dev DB, which points at the owner fork (330), exactly as p7-07. The clone-side counts come from the P7-5 prep rebuild |
| GD15 | owner step | "replay a real capture" | **not run.** It is the owner's post-run step: the run has no real capture. Every capture here is synthetic (fixturegen + inject specs) |
| GD16 | CI | a GitHub runner | a host-level emulation (namespaces, hidden paths, `CI=true`), not ubuntu-24.04. The chromium binary is the main tree's patched copy, because NixOS cannot run the downloaded one. Node is local v24.21.0, and CI's `setup-node` also uses 24 |
| GD17 | P7-5/6 | "screenshots into docs/evidence/phase-7/" | the committed scripts name their output `p7-08-tier2-*` / `p7-14-tier2-*`. They were written to scratch and copied as `gate-7-p7-5-*.png` / `gate-7-p7-6-*.png`, so the p7-08/p7-14 originals are untouched |

## Findings

- **F-A: CI was red at HEAD dc450f1 (fixed here).** Twelve tier-1 tests failed without the clone: p7-drafts, p7-overview
  and p7-label-scan. The p7 stories that added them ran tier-1 only with `data/` present. Fixed as described above.
- **F-B: `object-create-and-counts.spec.ts:333` "New NPC drop table" is flaky under CI load.** Run 3 used 12 workers and
  hit `expect(JSON.stringify(recorded.posts[0])).toBe(…)`: `Received: undefined`. It passed on CI's retry. Alone in the
  main tree it passed `--repeat-each=10` (170 passed), and it was green in run 4 and in both full local runs. Not fixed:
  outside this gate's CI-only scope. Recorded for the flake owner (the p7-16 family).
- **F-C: `POST /api/global-registry` accepts foreign top-level keys.** GD7(d)'s wrong POST sent
  `{duplicate_keys, missing_directory, objects, skipped, summary, GlobalRegistryValues:{Krampus:1}}`. It answered 200 and
  committed that document as `globalregistry.json`. Low severity: only a direct POST can do this, because the editor
  posts the right shape. It is the same class as final-verify's F3, which is now fixed (below).
- **F-D: a unit suite leaks temp git repos into `data/__test-scratch__/`.** `tests/unit/quest-scaffold.test.ts:933`
  (`routeHarness`) pushes `createTempGitRepo('p6-09-route-')` into the shared `repos` array. The only drain is the
  `afterAll` of the *earlier* describe (`:313`), which has already run by then. So every `npm test` leaves one repo
  behind: **80** in the main tree, dated 09-28 to 09-30, and the CI worktree got one too. Harmless to results; not fixed
  here (out of scope). The fix is an `afterAll` drain in the route describe.
- **Resolved since final-verify:** F2's grammar is fixed (the object banner now reads `1 validation error blocks
  saving`, `gate-7-p4.txt:246`). F3 is fixed (`DropTableNames:[null]` → 400 `Null list element`,
  `gate-7-p4.txt:306`). F1 no longer applies to this sweep: P2-7 reproduces as written on an untracked key.
- **O1:** the fork has grown to 330 quest files: `$type` 29 / 8,748 / 330, and p3-01's own audit test prints the same.
- **O2:** P6-4 now reports `used 22 of 30` text rows for WC-CYCLOPS-MAIN-002, where final-verify recorded `0 / 30`.
  This was measured, not investigated. The P3-3 edit in this sweep ran *before* P6-4, but it only flipped `m_usePatron`.
  Recorded so the lead can decide whether the change is intended (for example p7-15's `title_key` work).

## Clone and ports at the end

```console
$ git -C data/test-spiraldb (branch; HEAD; main; rev-list --count; porcelain; quests; branches)
content/2026-09-27  18dc92477d54b1e911796960407ce7710e703697  f3f8b5c0a48bc0f0b0cd9aca2d9d7d9d0122bd37  42  0  322
content/2026-09-26 content/2026-09-27 main ; GlobalRegistry/GlobalRegistryModels_1-A.json ; NpcDropTable absent
$ ss -ltn: 3181 5181 3292 3293 12369 12500 12000 12333 8080 → none listening ; 3001/5173 → the owner's, untouched
```

The worktree was removed with `git worktree remove --force <scratch>/ci-sim`, and the scratch DBs and
`data/__test-scratch__/gate-7-*` were deleted. The owner's `data/spiraldb-ui.db` was only read, through an online backup.
