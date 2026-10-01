# final-verify — Phase 7 final gate 3/3: every phase's Verification Steps re-run fresh on the combined branch

**Criterion (amended, `.omc/prd.json` final-verify `criterionAmendments`):** "verify pass re-runs every phase
Verification Steps fresh (P1 1-7, P2 1-8, P3 1-6, P4 1-6, P5 1-6, P6 1-7, P7 1-7); RAW outputs recorded;
final-deslop, final-review and final-verify run on ONE combined branch (final-gate-7) cut from main 7c2e987 and ONE PR,
which waits for the owner's review and is merged only on the owner's word (no self-merge)."

**Run:** 2026-09-30 21:49–22:31 (EDT). Branch `final-gate-7`, HEAD `a70437cf5e8c14fcbc15eac8bd252e0afcb19895`
(merge-base with `main` = `7c2e987`; on top: `cad7281` final-deslop, `f30fd70` final-review round-1 fixes, `a70437c`
the round-2 APPROVE record). Working tree clean at the start. The recipe is gate-7's (`gate-7.md`), command for command:
the same throwaway clone-backed stack, the same UI sweep arms (`final-verify-ui-sweep.mjs.txt`, one line added, see
FV2), the same committed p7-08 / p7-14 walkthrough scripts, the same CI simulation. Raw output is in the sidecars named
in each row; a `file:line` points at the line that carries the reading. Nothing was committed or pushed.

**Result:** every step ran and passed. Two steps needed an honest equivalent, both caused by things that changed after
gate-7, not by this HEAD's code: P2-5's fork-only quest is gone from the 328-file fork (FV3), and the committed p7-14
walkthrough's default quest no longer has a collapsed Advanced accordion since D195 (FV5, finding F-E). The D196/D197
review fixes were exercised end to end: cross-origin writes are refused `403` while the UI on its own origin saves, a
second scaffold of a just-saved quest is refused `409`, and a two-quest Save All produces two commits that each hold
exactly their own files. The CI simulation of this HEAD is green.

## Environment

| Fact | Reading |
|---|---|
| Node / npm / .NET | `v24.21.0` / `11.19.0` / `9.0.318`; the Imlight harness used `IMLIGHT_DOTNET_ROOT=/nix/store/fi5f9aa5jsb7f05k9q2pr0fhj6kxdmmf-dotnet-sdk-10.0.401/share/dotnet` |
| D17 clone `data/test-spiraldb` | `content/2026-09-27` @ `18dc924`, main `f3f8b5c`, 42 commits, porcelain 0, **322** `QuestTemplates/*.json`, branches `content/2026-09-26 content/2026-09-27 main`. Restored to exactly this after every write arm and checked at the end |
| Owner fork (read-only) | **328** `QuestTemplates/*.json` at `content/2026-09-28 d57d891` (the scaffolds were removed, D145 note; gate-7 ran at 330). Every count below names its corpus |
| Owner dev server | `:3001` (pid 32844) and `:5173` (pid 3856526), the same pids at the start and the end. Never touched; `data/spiraldb-ui.db` was read once, through an online `backup()`, for P7-4 |
| Sweep stack | the **built** server (`node server/dist/server/src/index.js`, `npm start`'s command) on **:3292** with `PORT=3292`, `SPIRALDB_UI_DB=<scratch>/ui.db`, `SPIRALDB_PATH=data/test-spiraldb`. `PORT=3292` makes the stack's own origin (`http://localhost:3292`) one D196 allows, so the browser arms saved through the guard (measured: `final-verify-d196.txt:96`). Settings: `user_name=FinalVerify Sweep`, `git_branch=content/2026-09-27` |
| UI driver | the repo's pinned Playwright chromium (D148), arms in `final-verify-ui-sweep.mjs.txt`; the P7-5/P7-6 walkthroughs are the committed `p7-08` / `p7-14` tier-2 scripts, unchanged |

## Summary table

| Step | Result | Evidence (file:line) | Deviation |
|---|---|---|---|
| **Freeze** | tree clean, HEAD `a70437c` on `final-gate-7`, merge-base `7c2e987`; clone `18dc924` porcelain 0, 322 files; fork 328 | `final-verify-freeze-and-gates.txt:1-14` | — |
| **Gates at a70437c** | `npm test` **108 files / 2215 passed**; lint rc 0; typecheck:tests rc 0; typecheck:scripts rc 0; build rc 0; FULL `npm run test:ui` **471 passed** (12 workers), 0 failed / flaky / skipped | `final-verify-freeze-and-gates.txt:19-29,35-36,70-74` | — |
| **CI simulation at a70437c** | all six CI steps green: `npm test` **2112 passed / 103 skipped**; `npm run test:ui` **465 passed, 6 skipped** (p7-drafts, with its reason), 0 failed, 0 flaky | `final-verify-ci-sim.txt:26-37,83-84` | GD16 |
| P1-1 sync → counts | isolated sync SUCCESS: items 79,835 · spells 18,173 · npcs 23,033 · quests 322 (clone) · zones 3,357; table counts via better-sqlite3 | `final-verify-p1.txt:6-12,54-70` | GD1, GD2 |
| P1-2 names shape | `{"items":[{"gid":1740074,"name":" +100 Energy Elixir"},…` | `final-verify-p1.txt:87` | GD3 |
| P1-3 summary = file counts | `{total:2271, extracted:2271}`; quest 322 = the clone's 322 files; fork 328 printed too | `final-verify-p1.txt:92,100,104` | — |
| P1-4 PATCH + history | reviewed; `status_history` id 1 with notes + changed_by | `final-verify-p1.txt:113,116` | — |
| P1-5 npm test | 2215/2215 | gates row | — |
| P1-6 settings → sync → toast; dropdown | toast `Sync complete: 79,835 items · … · 322 quests · 3,357 zones`; `Gretta` → `Gretta Darkkettle (38098)`, hidden `TemplateID=38098` | `final-verify-p1.txt:122,128`; `final-verify-p1-06-settings-sync-toast.png` | GD3, FV2 |
| P1-7 test:ui | 471 passed | gates row | — |
| P2-1 dotnet + builds | 9.0.318; build:cli and build:fixturegen succeeded, 0 errors | `final-verify-p2.txt:4-18` | — |
| P2-2 fixturegen → reader | 12,697 B capture, self-checks pass; reader length 1, `DS-ACAD1-C01-001` | `final-verify-p2.txt:31-54` | GD4 |
| P2-3 extract route | `count 1 [WC-UNICORN-MAIN-004]`; `.md` → 400 envelope; health ok | `final-verify-p2.txt:60,65` | — |
| P2-4 upload → Save All (2) → confirm | 2 results; 2 × `saved and committed`; **each of the two commits holds exactly its own two files** (D197(b) through the real UI) | `final-verify-p2.txt:70-74,100-106`; `final-verify-p2-04-results.png` | — |
| P2-5 clone: branch, log, files | `update quest` × 2 from the UI, and the literal `spiraldb: extract quest DM-BLACK-MAIN-013 (FinalVerify Sweep)`, template + metadata in one commit | `final-verify-p2.txt:170,174,182-185` | GD5, **FV3** |
| P2-6 strict JSON | 4 × `strict JSON OK`; the pre-save MB-YARD1 blob fails strict parsing | `final-verify-p2.txt:200-203,207` | — |
| P2-7 history note | `"Imported from packet capture final-verify-dm-black.json"` | `final-verify-p2.txt:213` | — |
| P2-8 browse → detail → mark reviewed | badge `Status: Reviewed`, toast | `final-verify-p2.txt:219-222` | — |
| P3-1 `$type` grep (fork) | 29 distinct / **8,746** / **328** files; the constants audit test prints the same (`measured: 29 … 8746 … 328`) | `final-verify-p3.txt:36-37,75` | — |
| P3-2 round-trip counts | clone `files discovered=322 round-tripped=322 failures=0`; fork 328/328 | `final-verify-p3.txt:44,46` | GD6 |
| P3-3 edit → save → diff | one line (`m_usePatron` false→true); metadata ModifiedAt/By only; **1 changed value path**, no key-order drift | `final-verify-p3.txt:85-116` | — |
| P3-4 load back | API `goal0_usePatron: true`; after a full reload the editor box is checked, `data-dirty=false` | `final-verify-p3.txt:122,125` | — |
| P3-5 validation negatives | curl 400 + `fields["m_startGoals[0]"]`, nothing written; UI `1 validation error blocks saving: Unknown start goal.`, Save `aria-disabled=true data-blocked=true`; Discard restores | `final-verify-p3.txt:131-136,142-144`; `final-verify-p3-05-validation-negative.png` | — |
| P3-6 flowchart / requirements / dialog | MB-YARD1 16 nodes / 15 edges; 4 requirement types + AND/OR; dialog DOM groups 7 = served 7 (CYCLOPS-002), 5 = 5 (UNICORN-007) | `final-verify-p3.txt:148-153`; `final-verify-p3-06-flowchart-MB-YARD1.png` | — |
| P4-1 per-family round-trip | 6 families × both corpora, `ls\|wc -l` = round-tripped, 0 failures | `final-verify-p3.txt:47-72` | — |
| P4-2 per-type edit loop | 6/6 present families: a real edit = one commit, one path, then a restore; closing md5 IDENTICAL, porcelain 0. The no-op pass now answers `commit: ""` with no commit (D197(b) unchanged re-save). npcdroptable edited after P4-3 created it | `final-verify-p4.txt:80-87,95`, `:272-282` | GD7 |
| P4-3 create loop | 7/7 filenames match the spec-data-model table (npcdroptable into an absent directory) | `final-verify-p4.txt:156-201`, `:250-266` | GD7 |
| P4-4 validation negatives | curl 400 for empty Name, both duplicate arms, RollChance 1.5, NoneChance −0.1, MinGold>MaxGold; a 200 control; UI blocks Save on the three reachable arms | `final-verify-p4.txt:206-247` | GD7 |
| P4-5 GlobalRegistry | one commit, `R096` / `--no-renames` D+A; one file left; written == posted (23 flags, Krampus 1); status type 404 | `final-verify-p4.txt:313-331` | GD8 |
| P4-6 viewports | 69 cells (23 routes × 375/768/1440), **0 overflow**; rail 0/200/260; list routes are cards at 375 and tables at 768 | `final-verify-p4.txt:346-356` | — |
| P5-1 npm test | 2215/2215 | gates row | — |
| P5-2 two sessions | B before refresh `Verified 0`, after refresh `Verified 1 · Quests 1/323 (0.3%)` | `final-verify-p5.txt:4-7`; `final-verify-p5-02-second-session-dashboard.png` | — |
| P5-3 build + start → SPA | `/quests` `200 text/html` 508 B = index.html; 6 other routes 200 text/html | `final-verify-p5.txt:21-48` | GD3 |
| P5-4 viewports | the same 69-cell sweep (P4-6), plus `responsive.spec.ts` in the green tier-1 run | `final-verify-p4.txt:355` | — |
| P5-5 axe | axe 4.13.0: **0 violations** on the four pages; negative control `image-alt/critical` appears, then 0 | `final-verify-p5.txt:56-61` | GD9 |
| P5-6 fresh-clone dry run | clone 1 s → `npm ci` 14 s → sync 20 s (0 quests: a fresh clone has no corpus) → build 8 s → prod `/quests` 200 text/html; listener killed by its own pid, 3293 free | `final-verify-p5.txt:71-165` | GD10 |
| P6-1 wad census | 3,589 wads; 176,943 A + 6,733 B; TutorialQuestTemplate 11; no QuestTemplate row | `final-verify-p6.txt:8-22` | — |
| P6-2 wad-scan extract | **6,733 rows** (3,356 + 3,377), 0 failed, 97,660,625 B | `final-verify-p6.txt:28-36` | GD11 |
| P6-3 sync + coverage | two full syncs (CLI, then the UI's Sync Now) identical in every count; coverage `{1717, 4823, 322, 1395, 2855}` (clone) | `final-verify-p6.txt:45,293-294` | — |
| P6-4 evidence | title "Run and Done"; 30 text rows (22 used); 27 dialogue rows, speaker "Cyrus Drake" (composed); gates `[]` | `final-verify-p6.txt:51-63` | — |
| P6-5 names per family | pairs in the API and the DOM; `87112` and `Ugo` find the same row; the palette reports `matched_on` key/name; `Gretta` gives no NPC-inventory hit (only items) | `final-verify-p6.txt:68-124` | — |
| P6-6 catalog → scaffold → dialogue row → save; loadability | 1717 rows / 1395 missing → scaffold `DM-GRAVE-MAIN-008` → Prep group, 66-key entry → save commits; a **second scaffold of it is refused 409**, file and HEAD unchanged (D197(a)). **Live Imlight: 322 + 1 = 323, PASS**, clone restored | `final-verify-p6.txt:128-137,209,224`, `:490,516`; `final-verify-p6-06-scaffold-dialog-saved.png` | O-A |
| P6-7 no wad-scan → skipped | `status SUCCESS`, catalog + breadth `SKIPPED` naming `npm run build:wadscan`; symlink restored; the next sync restores coverage | `final-verify-p6.txt:297-341` | GD12 |
| **P7-1** capture-census over the p7 fixtures | 9/9 exit 0, byte-identical to the committed goldens; **72 planted fields, 0 missing** | `final-verify-p7-1-census.txt:2-10,22` | — |
| **P7-2** packet reader per p7 fixture | 9/9: stdout **and** suggestions sidecar byte-identical to the goldens; "suggestion" never in stdout; the CI-bound vitest **177 passed** | `final-verify-p7-2-reader.txt:3-22,144` | GD13 |
| **P7-3** verify:captures then audit:corpus (alone) | `PASS: 5 fixture(s), 55 field check(s), 0 mismatch(es)`; **`PASS: 314/322 verified, 8 not covered …, 0 failure(s)`** on the D17 clone | `final-verify-p7-3-verify-captures.txt:83`; `final-verify-p7-3-audit-corpus.txt:36` | — |
| **P7-4** drafts × 2 on a dev-DB copy | runs identical (`proposed 5458`, `unchanged 5458` both times); a second arm on the same copy with `quest_suggestions` emptied: run 1 **inserted 5458**, run 2 **inserted 0 / unchanged 5458**; all 4 reconcile checks = 1; catalog ids without a draft = 0; no duplicates | `final-verify-p7-4-drafts.txt:27-28,66-67,119,123`, `:138,142,152-153` | GD14, FV4 |
| **P7-5** /drafts → named missing quest → accept 3 → save → live Imlight +1 | `NV-PUERT-MAIN-012`: accepted title/goals/requirements in the real UI, save 200 commits; **322 + 1 = 323 PASS**; every clone axis restored | `final-verify-p7-5-live-boot.txt:127-130,149-154,180`; `final-verify-p7-5-{queue,draft-editor,accepted,saved,name-dialog}.png` | GD17 |
| **P7-6** Overview → Goals → Dialog → popover → /glossary | the committed script on its default quest **exits 1** (all 15 Advanced accordions open: D195); re-run unchanged with its `QUEST_NAME` input on `WC-UNICORN-MAIN-002`: lands on Overview, readable goal cards with pair labels, 20 accordions (8 collapsed, 12 auto-opened, = the app's own rule), popover names `m_questLevel` + source, glossary 1 row for each half, exit 0 | `final-verify-p7-6-walkthrough.txt:6,11,15`, `:22-23`, `:30-37`; `final-verify-p7-6-*.png` (7) | GD17, **FV5** |
| **P7-7** npm test, lint, test:ui | green (gates row) | `final-verify-freeze-and-gates.txt` | — |
| **Review fixes (D196)** cross-origin write refused, own origin saves | `https://evil.example` text/plain → **403** on reject, rebuild, sync, multipart extract, settings; the row stays `pending`, the setting unchanged; `localhost:8080`, `Origin: null`, `Sec-Fetch-Site: cross-site` → 403; own origin `http://localhost:3292` and no-Origin → 200; the real browser sends `Origin=http://localhost:3292 Sec-Fetch-Site=same-origin` and gets 200 | `final-verify-d196.txt:11-62`, `:64-84`, `:96` | — |
| owner step: replay a real capture | **not run: owner-only** (Phase 7 "Done when") | — | GD15 |

## Phase 7 steps and the review fixes in detail

### P7-6 — the committed walkthrough's default quest is stale since D195 (FV5 / F-E)

The committed `p7-14-tier2-walkthrough.mjs` needs one collapsed and one auto-opened Advanced accordion on the Dialog tab
of its default quest, `WC-UNICORN-MAIN-001`. Gate-7 (at `dc450f1`) saw 13 collapsed and 2 open. At this HEAD all 15 are
open, so the script throws before the popover and glossary arms:

```console
[p7-14 tier-2] dialog Advanced accordions (15): [{"entry":"m_dialogList.m_dialogs[0].m_dialogEntries[0]","expanded":"true"}, … (15 × "true")]
Error: the Dialog tab shows no collapsed/auto-opened pair to photograph
exit=1
```

The cause is D195(d), which landed in `509839c` (PR #14 review fixes) after gate-7 ran. Advanced now opens on any value
that differs from the field's own new-node default, not only on a non-empty value. A new dialog entry is built with
`m_spamTime 1`, `m_meetsRequirements true`, `m_playSoundIfSpamming true` and so on, while every entry of
`WC-UNICORN-MAIN-001` stores `0`/`false` there. The app's own functions (`dialogFieldsInAccordion` +
`isDefaultFieldValue`) were measured over the whole clone:

```console
WC-UNICORN-MAIN-001 Advanced opened by value: 15 of 15
clone (all 322 QuestTemplates, JSON5-parsed): entries 1706 Advanced opened by value 428
```

428 of 1,706 is D195's own recorded measurement (`pr14-review-fixes.md`: "Advanced 1,672 → 428"). So the app does what
D195 decided, and the script's fixed quest choice is what went stale. The script was re-run **unchanged**, setting its
own `QUEST_NAME` input to `WC-UNICORN-MAIN-002`, a clone quest the same measurement says has both states. The DOM shows
20 accordions, 12 open and 8 collapsed, which matches the computed 12. Every arm completed, `exit=0`, and the clone
porcelain was 0. The plan's step 6 names no quest, so this is the step as written; the script's default is listed as
finding F-E for the lead.

### D196 / D197 — the review fixes through the running app

| Fix | What ran | Reading |
|---|---|---|
| D196 (M3) | curl from `https://evil.example` with `Content-Type: text/plain` and no body on `POST /api/suggestions/1/reject`, `POST /api/drafts/rebuild`, `POST /api/sync`, multipart `POST /api/extract/quests`, `PUT /api/settings` | all **403** with the `{error}` envelope; suggestion 1 still `pending`, 5,448 rows, `user_name` unchanged (`final-verify-d196.txt:11-41`) |
| D196 | `Origin: http://localhost:8080`, `Origin: null`, `Sec-Fetch-Site: cross-site` | 403, 403, 403; row still pending; clone untouched (`:44-62`) |
| D196 partners | `Origin: http://localhost:3292` (`PUT /api/settings`, reject id 1); no Origin (reject id 2) | 200, 200 → `rejected`, 200 → `rejected` (`:64-84`) |
| D196 in the real browser | the quest page on :3292 presses Mark Verified | wire headers `Origin=http://localhost:3292 Sec-Fetch-Site=same-origin`, `200`, toast (`:96`). The UI save arms (P2-4, P3-3, P6-6, P7-5) all saved through the same guard |
| D197(a) (M1) | `POST /api/quests/scaffold {"quest_name":"DM-GRAVE-MAIN-008"}` right after the UI saved it, with no sync in between (`has_definition` still 0) | **409** "already has a definition…"; the md5 and HEAD are unchanged (`final-verify-p6.txt:215-229`) |
| D197(b) (M2) | P2-4 Save All of two quests in the real UI | two commits, each exactly its own template + metadata (`final-verify-p2.txt:100-106`); P4-2's no-op re-save answers `commit: ""` with no commit (`final-verify-p4.txt:95`) |

## CI simulation

The recipe is gate-7's run 4 (`final-verify-ci-sim.sh.txt` is the script). `git worktree add --detach <scratch>/ci-sim
HEAD` (`a70437c`) was followed by `npm ci`, and the main tree's patched chromium was copied in (GD16). The script then
ran inside `unshare -rm`, then `unshare -U --map-user=1000`. The whole `/home/jason/Documents/git-projects` was an empty
tmpfs, with only the main `.git` bound back. Every `dotnet-sdk*` store path was hidden, and `CI=true` was set. The
script printed `data/ … No such file or directory`, `owner fork … No such file or directory`, `dotnet: command not
found` and `ports 3181/5181 before: 0` (`final-verify-ci-sim.txt:26-31`). CI's steps ran in order: `npm test` (105
files passed, 3 skipped; **2112 passed, 103 skipped**), build, lint, typecheck:tests, test:ui:install, `npm run
test:ui` (**465 passed, 6 skipped**: the six p7-drafts tests behind their file-level clone skip; 0 `✘`, 0 flaky).
Result: `[ci-sim] all steps green`. The worktree was removed with `git worktree remove --force`.

## Deviations

Gate-7's GD list, re-checked on this run, followed by this run's own (FV).

| # | Step | Status now | What ran, and why |
|---|---|---|---|
| GD1 | P1-1 | **still applies** | `NODE_ENV=test SPIRALDB_UI_DB=<scratch>/ui.db npm run sync`, not `rm -rf data`: `data/` holds the clone and the owner's dev DB |
| GD2 | P1-1 | **still applies** | counts via better-sqlite3 (no `sqlite3` binary) |
| GD3 | P1-2/3/6, P5-3, all UI | **still applies** | :3001/:5173 are the owner's; the built server on :3292 (with `PORT=3292` so D196 allows its origin); repo-chromium Playwright scripts (D148) |
| GD4 | P2-2 | **still applies** | `DOTNET_ROOT` exported; the apphosts need it |
| GD5 | P2-5 | **still applies** | saves are pinned to `content/2026-09-27` (D76(b)/D119), so no new branch; the `extract` verb comes from a quest the clone does not hold |
| GD6 | P3-2 | **still applies** | no suite prints "322 passed"; the per-family round-trip lines of the fresh `npm test` are quoted |
| GD7 | P4-2..P4-5 | **still applies, (d) closed** | (a) NpcDropTable absent in the frozen clone, edited after P4-3 created it. (b) The no-op pass now commits nothing and answers `commit: ""` (D197(b)). (c) The script's "Name duplicate" probe is the legitimate update arm; the two real duplicate arms ran and gave 400. (d) Gate-7's wrong first P4-5 POST was not repeated: P4-5 ran its corrected arm directly |
| GD8 | P4-5 | **still applies** | `git show --name-status` (+ `--no-renames`), because the change is committed |
| GD9 | P5-5 | **still applies** | axe output quoted in `final-verify-p5.txt`, not archived under `phase-5/` |
| GD10 | P5-6 | **still applies, the kill fixed** | clone → `npm ci` → sync → build → prod start → SPA route; `build:cli` and the walkthroughs ran on the main stack. The listener is now killed by the pid `ss` reports, so 3293 was freed by the script |
| GD11 | P6-2 | **still applies** | plus the tool's required `--gamedata` and `--out` |
| GD12 | P6-7 | **still applies** | the gitignored symlink was moved aside and restored (same `readlink`, `git status -- tools` 0) |
| GD13 | P7-2 | **still applies** | the p7-04 field-diff script covers its own five fixtures and its WC-TUT-C05-001 join is stale (16 DIFF-count over 83, all on goals 2..5); the values were read straight from stdout; golden identity + the CI-bound vitest cover the p7-05 plants |
| GD14 | P7-4 | **still applies** | on a scratch copy of the dev DB (fork 328, read only), as p7-07; see FV4 |
| GD15 | owner step | **still applies** | "replay a real capture" is the owner's post-run step; every capture here is synthetic |
| GD16 | CI | **still applies** | a host emulation (namespaces, hidden paths, `CI=true`), not ubuntu-24.04; the main tree's patched chromium (NixOS cannot run the downloaded one) |
| GD17 | P7-5/6 | **still applies** | the committed scripts write `p7-08-tier2-*` / `p7-14-tier2-*` into scratch; copied here as `final-verify-p7-5-*.png` / `final-verify-p7-6-*.png`, the originals untouched |
| FV1 | all counts | new | the owner fork is **328** files now (gate-7: 330). Fork-side readings moved accordingly: `$type` 8,746 occurrences, round-trip 328/328, p3-08 797 real dialog lists, drafts `gate_precision 7/50` and `predecessor_precision 132/227` (gate-7: 7/64, 132/228). Clone-side readings are identical to gate-7's |
| FV2 | P1-6 | new | the sweep's `p1_6b` arm checked `Edit` with `isVisible()` before the page rendered, so it never entered edit mode and timed out on the combobox (twice; gate-7 hit the same). One line was added: `await edit.waitFor()` before the check. The third run passed. The arm is otherwise unchanged (`final-verify-ui-sweep.mjs.txt`) |
| FV3 | P2-5 | new | gate-7's fork-only quest `DM-BLACK-MAIN-013` is no longer in the 328-file fork (attempt 1, `final-verify-p2.txt:77-…`). The six fork-only files left (`WC-COMMONS-MAIN-002-<school>`) are refused by fixturegen: their goal names are `Goal n` (attempt 2). Run 3 read gate-7's exact file read-only from the fork commit gate-7 used (`git show 864bd44:…`) and ran the same pipeline. Both failed attempts wrote nothing (POST 400, clone unchanged) |
| FV4 | P7-4 | new | the dev DB already held 5,458 pending rows from an earlier drafts run, so on the plain copy both runs report `inserted 0 / unchanged 5458` (identical). For a real insert-then-idempotent pair, a second arm emptied `quest_suggestions` on the same copy: 5,458 inserted, then 0. The dev DB's coverage still says `defined 330`: its last sync (2026-09-30T00:46Z) predates the fork's scaffold removal (fork now 328). The reconcile compares DB to DB and holds |
| FV5 | P7-6 | new | see [the detail above](#p7-6--the-committed-walkthroughs-default-quest-is-stale-since-d195-fv5--f-e): the committed script's default quest has no collapsed accordion since D195; re-run unchanged with `QUEST_NAME=WC-UNICORN-MAIN-002` |

## Findings

- **F-E (new): the committed `p7-14-tier2-walkthrough.mjs` fails on its default quest at this HEAD.** It is not an app
  defect: D195(d) makes Advanced open on every `WC-UNICORN-MAIN-001` entry (15/15; 428/1,706 across the clone, =
  D195's own number). The script's precondition went stale when D195 landed, and gate-7 predates D195. Fix
  (lead's/owner's call, not made here): change the script's default `QUEST_NAME` to a quest with both states, such as
  `WC-UNICORN-MAIN-002`, or record the run with `QUEST_NAME`. The tier-1 `quests-advanced-disclosure.spec.ts` pins the
  rule itself and is green.
- **F-C (gate-7) still open:** `POST /api/global-registry` with a foreign top-level key (`Foreign: 1`) → **200** and a
  commit (`final-verify-p4.txt:333-342`; the clone was reset afterwards). Only a direct POST can do this; the editor
  posts the right shape.
- **F-D (gate-7) still open:** `npm test` still leaks one `p6-09-route-*` temp repo into `data/__test-scratch__/` per
  run (95 there at the end of this run). This run's own leak was deleted; the older ones were left alone.
- **F-B (gate-7) not reproduced:** `object-create-and-counts.spec.ts:333` passed in both full tier-1 runs (local 471,
  CI sim 465), with 0 flaky.
- **O-A:** the `p6_6b` arm's "page head" reads `DM-GRAVE-MAIN-008` where gate-7 read `Stakes and Stones
  (DM-GRAVE-MAIN-008)`. The arm reads the head as soon as `[data-edit-mode]` appears, and the title arrives a moment
  later. Measured on the same page: `DM-GRAVE-MAIN-008` at first, then `Stakes and Stones (DM-GRAVE-MAIN-008)` 2 s
  later; the API row has the title (`final-verify-p6.txt` "P6-6 note"). This is arm timing, not a defect.
- **O-B:** gate-7's O2 (`used 22 of 30` text rows for WC-CYCLOPS-MAIN-002) is stable: 22 of 30 again.
- **O-C:** the CI-bound p7 vitest trio is now **177** (gate-7: 176), and `npm test` is 108 files / 2215 tests (gate-7:
  107 / 2178); the new suites are D195/D196/D197's (`save-write-safety.test.ts` 10, `server-security-posture.test.ts`
  14, `write-route-branch-guard.test.ts` 16, all green, `final-verify-freeze-and-gates.txt:86-88`).

## Clone, ports and scratch at the end

```console
$ git -C data/test-spiraldb (HEAD; branch; porcelain; quests; rev-list --count; branches)
18dc92477d54b1e911796960407ce7710e703697  content/2026-09-27  0  322  42  content/2026-09-26 content/2026-09-27 main
$ ss -ltnp: 3292 3293 3181 5181 12369 12500 12000 12333 8080 → none listening ; 3001 (pid 32844) / 5173 (pid 3856526) → the owner's, untouched
$ git worktree list → the main tree + .omd/review-pr14 (pre-existing); the ci-sim worktree removed
```

The scratch DBs (`data/__test-scratch__/final-verify-drafts*.db`) and the helper scripts staged under
`data/__test-scratch__/fv-*` were deleted. The sweep DB and stack logs stayed in the session scratchpad. The owner's
`data/spiraldb-ui.db` was only read, through an online backup. A `playwright-mcp` chromium (pid 111430, parent 3951610,
started 21:59) was running during the sweep; it is not this run's (all arms used the repo's pinned chromium), and it was
left alone.

## F-E disposition (lead, after the run)

**Fixed in `2fecc38`.** The committed `docs/evidence/phase-7/p7-14-tier2-walkthrough.mjs` now defaults to
`QUEST_NAME=WC-UNICORN-MAIN-002`, the input FV5's passing re-run used. The old default `WC-UNICORN-MAIN-001` opens
Advanced on all 15 of its entries since D195(d), so the walkthrough's "one collapsed" arm cannot be shown on it. A
comment in the script records why the default moved. This was not an app defect: the tier-1 rule test is green.
