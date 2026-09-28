# final-verify — the closing report (gate 3/3 of the ultragoal final gate)

`HEAD` `f7e7004f3b36a01f113fc3355c72ba4df1e96f02` on `main`, throughout. **Nothing is committed and
no git write beyond reading was made** (D84(a)); every change this sweep carries is a working-tree
edit, listed at the bottom. This continuation **did not redo Phase 1**: those seven steps are cited
from the brief and [`final-verify-plan.md`](./final-verify-plan.md), and one of them has a named
evidence gap (§P1).

Method per [`final-verify-plan.md`](./final-verify-plan.md): every step is read from **each plan's
own Verification Steps section** (`docs/plan-phase-{2,3,4,5}-*.md`), re-run, and reported with a
verdict and the raw output file behind it. An `rc` is captured **on the command**, never on a
pipeline's tail. A step that could not be run is **not ticked**.

| evidence file | what it holds |
|---|---|
| [`final-verify-p2.txt`](./final-verify-p2.txt) | P2-1…P2-7 transcripts (build, round trip, extract, clone, create path, JSON, history) |
| [`final-verify-p3.txt`](./final-verify-p3.txt) | P3-1, P3-3, P3-4, P3-5 transcripts |
| [`final-verify-p4.txt`](./final-verify-p4.txt) | P4-1…P4-5 transcripts (counts, rig, live loop, create loop, negatives, registry) |
| [`final-verify-p5.txt`](./final-verify-p5.txt) | P5-2, P5-3, U1, U2, the fresh-clone run, lint/typecheck |
| [`final-verify-ui-runs.txt`](./final-verify-ui-runs.txt) | A1, A2 and the isolated failing arm, verbatim |
| [`final-verify-tracked-write-fix.md`](./final-verify-tracked-write-fix.md) + `.txt` | the fix, the sensitive instrument, the negative control |
| [`final-verify-findings.md`](./final-verify-findings.md) + [`-raw.txt`](./final-verify-findings-raw.txt) | the ZoneTransfer finding, both fixes, the two conditional one-liners |
| [`final-verify-suites.md`](./final-verify-suites.md) | the suites run by run, and the carried families |
| [`final-verify-clone-restore.txt`](./final-verify-clone-restore.txt) | the D17 clone, before and after restore |
| [`final-verify-p5-process-clause.md`](./final-verify-p5-process-clause.md) | the AC's process clause (the previous executor's, cited) |
| [`final-verify-shots/`](./final-verify-shots/) | the 14 MCP walkthrough screenshots (one home, kept out of the tracked-evidence dirs) |

---

## Phase 2 — Quest Extraction (8 steps)

| # | verdict | evidence |
|---|---|---|
| P2-1 | **PASS** | `dotnet --version` → `9.0.318`; `npm run build:cli` rc=0; `npm run build:fixturegen` rc=0; both `tools/bin/` symlinks resolve into `tools/.artifacts/…` |
| P2-2 | **PASS** | `fixturegen --quest …/questtemplates_DS-ACAD1-C01-001.json --output /tmp/fv3/cap.json` rc=0 (12,639 B, with its own self-checks); `imview-packet-reader --input cap.json` rc=0; `jq length` → **1**; `m_questName` → `DS-ACAD1-C01-001`. **Requires `DOTNET_ROOT`** (D45(3)); bare, both binaries exit **131** with `Failed to resolve libhostfxr.so` — reproduced verbatim in the transcript |
| P2-3 | **PASS** | `curl -F file=@…/MB-YARD1-C01-001.json localhost:3001/api/extract/quests` → **200**, body keys exactly `[count, quests]`, `count=1`, `m_questName=MB-YARD1-C01-001`; non-capture → **400** with the D47 envelope; `GET /api/health` → `{"status":"ok"}` after the failure |
| P2-4 | **PASS** | real UI, MCP-driven, on a stack I booted: a two-quest capture (`jq -s add` of two committed fixtures → reader returns 2) dropped on the dropzone → results with **both** quests (`MB-YARD1-C01-001 · Level 1 · 15 goals · new`, `WC-FIRECAT-MAIN-004 · Level 1 · 5 goals · new`, six tabs) → *Save All to SpiralDB* → confirm dialog ("Save 2 quests…", then the overwrite list naming both) → the **identity gate** fired (`What should we call you?`, D38/D43) → **two success toasts** ("Quest … saved and committed"). Screenshots `final-verify-shots/fv-p2-04-*` |
| P2-5 | **PASS** | in `data/test-spiraldb`: `git branch --show-current` → **`content/2026-09-28`** (`content/2026-XX-XX`); `git log --format='%s (%an)'` → `spiraldb: update quest WC-FIRECAT-MAIN-004 (FV Gate3)`, `spiraldb: update quest MB-YARD1-C01-001 (FV Gate3)`, and — for the plan's literal `extract` wording — `spiraldb: extract quest WC-UNICORN-MAIN-004 (FV Gate3)` with `git show --stat` = the template **and** its metadata companion; `ls` shows both files; clone clean. **How the `extract` verb was obtained** is recorded below (it needs a *create*, not an update) |
| P2-6 | **PASS** | `node -e JSON.parse(…)` → no throw on both saved templates (15 and 5 goals) **and** both metadata companions (keys `QuestTemplateId,Name,Description,CreatedAt,ModifiedAt,CreatedBy,ModifiedBy`); `jq` also parses both. Both source files were **JSON5-only** (trailing comma) before the save — the write is what made them strict |
| P2-7 | **PASS** | `GET /api/status/quests/MB-YARD1-C01-001/history` → 200, one row `{old_status: null, new_status: "extracted", notes: "Imported from packet capture two-quests.json", changed_by: "FV Gate3"}` (same for WC-FIRECAT-MAIN-004) |
| P2-8 | **PASS** | `npm test` → **67 files / 1472 tests passed, rc=0** (run U1; the same instrument is read for P3-2/P4-1/P5-1 — **one run, four readings, not four runs**); the browser walkthrough upload → browse → detail → *Mark Reviewed* succeeded: badge `Reviewed`, toast `MB-YARD1-C01-001 marked reviewed`, Status History carrying both rows with author and note. Screenshots `fv-p2-08-*` |

## Phase 3 — Quest Editing (6 steps)

| # | verdict | evidence |
|---|---|---|
| P3-1 | **PASS** | `grep -rho '"$type": *"[^"]*"' /home/jason/Documents/git-projects/spiraldb/QuestTemplates/ \| sort \| uniq -c \| sort -rn` → **29 distinct strings, 8,746 occurrences, 328 files** — character-for-character the baseline `shared/quest/typeConstants.ts` records (`MadlibArgT_ByteString` 4,175 is #1; `ReqIsSchool` 7; `ResActorDialog`/`ActorDialog` 5 each). The table's own audit test re-runs that grep (`quest-type-constants.test.ts`, green in U1/U2), and `[p3-01 schemas] corpus 328: accepted=328, rejected=0, parse-output-changed=0` |
| P3-2 | **PASS, re-measured** | The plan's literal `322 passed` is the **322-file clone**. On the restored clone U2 prints **`328 real + 322 clone files`**, `quest-roundtrip` reports `committed fixtures: 4 files round-tripped (explicit-null 1, absent-key 3)`, and every family's round trip prints `discovered=N ls\|wc -l=N round-tripped=N failures=0`. **No suite prints the string "322 passed"** — the claim it encodes (count == `ls \| wc -l`, no field loss) is what is asserted. Note: run U1, taken before I restored the clone, printed **321** — the count tracked the tree, which is itself evidence the assertion is live |
| P3-3 | **PASS** | UI edit → save on `WC-CYCLOPS-MAIN-002` (a file already tool-normalised on this branch, so no formatting noise): `git diff HEAD~1` — **exactly two changed lines**, `.m_goals[0].m_usePatron false→true` and `.m_dialogList.m_dialogs[0].m_dialogEntries[0].m_dialog`, with a data-level walk over the flattened documents reporting **2 changed leaf paths and no others**; the metadata diff is `ModifiedAt` + `ModifiedBy` only; clone clean |
| P3-4 | **PASS** | `GET /api/quests/WC-CYCLOPS-MAIN-002` → 200 with `m_usePatron=true` and `m_dialog="WizQst17318E_00000006_FV"`; after a **full page reload** the Goals tab reads `Use Patron: ✓` and the Dialog tab's field reads the edited value |
| P3-5 | **PASS** | curl: a dangling `m_startGoals` → **400** with `fields["m_startGoals[0]"]` and an actionable sentence, clone untouched (HEAD unchanged, porcelain empty). UI: *Set as Start Goal* then delete that goal → banner **"1 validation error blocks saving: Unknown start goal."**, Save **disabled**, and the warn-not-block channel intact ("5 warnings: Unreachable goal. Warnings never block saving."); *Discard* restored the document exactly (6 goals, no error) — which also covers the AC's discard clause. Screenshot `fv-p3-05-ui-negative` |
| P3-6 | **PASS**, with one measured caveat | three diverse real quests walked via MCP. **Flowchart** (`MB-YARD1-C01-001`, mainline, 15 goals): 16 nodes = 15 goals + the `✓ Complete` node, 15 edges, `AND` labels, React Flow SVG present, auto-layout `fitView` at scale **0.2** (readable after zoom → 0.597, screenshotted both). **Requirements** (`MB-YARD1-C01-001`): the type selector offers **exactly 4** options (`ReqHasQuest`, `ReqHasEntry`, `ReqSchoolOfFocus`, `ReqIsSchool`) — **`ReqHasGoal`/`ReqEntryValue` absent** — operator `ROP_AND`/`ROP_OR`, a Group with AND/OR plus `NOT`, the four owner-labelled slots, the reference rendering as the friendly name `MB-MUSEHub-C03-002`. **Dialog**: `WC-CYCLOPS-MAIN-002` renders **7/7** tag groups and `WC-UNICORN-MAIN-007` **5/5**, matching the served documents' **7 blocks / 27 entries** and **5 blocks / 8 entries** (including `WC-UNICORN-MAIN-007`'s goal-level `Prep`, which the capture fixture's README names). **Caveat**: my per-block "N entries" DOM selector **undercounted** (the goal-level headers are nested), so the entry counts above are from the **served documents**, not from DOM text; only the block counts are DOM-verified. Screenshots `fv-p3-06-*` |

## Phase 4 — Other Object Editors (6 steps)

| # | verdict | evidence |
|---|---|---|
| P4-1 | **PASS** | per-family, both corpora: `droptable 317/317`, `npcinventory 215/215`, `npcspellinventory 77/77`, `creaturespellbook 134/134`, `treasurecardinventory 1/1`, `zonetransfer 1207/1207` — each line `files discovered=N ls\|wc -l=N round-tripped=N failures=0`, plus the AC summary line; `NpcDropTable` is the absent family (0 files) and is handled as such |
| P4-2 | **PASS** | the **tier-2 live rig** (`tests/ui/p4-09-live.config.ts`, run against a rig I booted + the real clone + the documented D76(b) seeded settings) → **2 passed (2.3 s)**: AC2 commits the **original legacy path** in one commit with only the edited `Description` plus the named one-time normalisation (`1.0→1`, trailing newline); **plus** a scripted live loop saving one entry per family — **5 families SAVED**, each one commit, one path, HEAD advanced, clone clean (`npc_inventory 87112`, `npc_spell_inventory 38226`, `creature_spellbook Mdeck-L-…`, `treasure_card_inventory 38214`, `zone_transfer WizardCity/WC_Hub`), and **2 SKIPPED** because their target lists are empty (`DropTable.Items`, `NpcDropTable.DropTableNames`) — those two families are exactly the rig's two save arms, so all seven keyed families carry live clone evidence |
| P4-3 | **PASS** | create-one-new-entry loop, six families, each verified against `spec-data-model.md` L173–187: `droptable_FV-NEW-DROPTABLE-001.json`, `npcinventory_900000001.json`, `npcspellinventory_900000002.json`, `creaturespellbook_FV-NEW-DECK-001.json`, `treasurecardinventory_900000003.json`, `zonetransfer_FV_New_Zone_Verify.json` (the slash→underscore rule) — **every filename matched the convention exactly**, each a `create` commit of one path, the file present in the clone; `npcdroptable_87113.json` came from the rig's AC3 with its intended content `{TemplateID, DropTableNames: []}` |
| P4-4 | **PASS** (one arm by curl only) | all five named DropTable negatives → **400** with the per-field map and the right message (Name empty; duplicate; `RollChance 1.5`; `NoneChance -0.1`; `MinGold 100 > MaxGold 10`), and **none created a file**; positive control 200. UI: inline errors "1 validation error block saving: **Missing name**./**Duplicate name**." with Save **disabled** (screenshot `fv-p4-04-inline-error`). **Not exercised in the UI**: the `RollChance` out-of-range arm — it is a slider with no labelled fillable control (`getByLabel('RollChance')` count **0**), so it rests on the curl arm |
| P4-5 | **PASS** | one commit `e6ab835`, `git show --name-status` = **`R090 GlobalRegistry/GlobalRegistryModels_1-A.json → GlobalRegistry/globalregistry.json`** (the D22 add-and-delete), the directory then holding **only** `globalregistry.json`, clone clean, the merged file carrying **24** entries (23 original + the probe's) with their values; the **editor's own page** lists all 24 names and states "Saving writes globalregistry.json — the directory already holds exactly that one file" |
| P4-6 | **PASS for the tier-1 half; the viewport half carries P5-4's defect** | `npm run test:ui` green in A2 (393/393); `object-mobile`/`responsive` cover 375/768/1440 in the suite. My own MCP sweep (20 routes × 375/768/1440) found **19 clean and one overflowing at 375** — the ZoneTransfer detail, i.e. the **P5-4 FAIL** below. So "viewport passes at 375 and 768 for list/detail" is **false for the zone-transfer detail on real data** and true for the other 19 |

## Phase 5 — Dashboard & Polish (6 steps + the process clause)

| # | verdict | evidence |
|---|---|---|
| P5-1 | **PASS** | U1 and U2: **67 test files / 1472 tests passed, rc=0** — including the regression suites and the envelope audit (`api-error-envelope.test.ts`, 7 tests, AC2/D37) |
| P5-2 | **PASS** | two tabs: *Mark Reviewed* on `WC-CYCLOPS-MAIN-002` in one → toast `WC-CYCLOPS-MAIN-002 marked reviewed`, badge `Reviewed`; in the other, after refresh, the dashboard's **Reviewed 1 → 2** and the activity feed gained `WC-CYCLOPS-MAIN-002 marked reviewed` above `… extracted`. Corroborated from the API (`/api/status/all` 18/17/1 → and `/api/activity`). **Recorded**: my first attempt used an **untracked** quest and was a silent no-op (404 on its history) — the quest must already carry a status row |
| P5-3 | **PASS** | `npm run build` rc=0; `npm start` → `curl localhost:3001/quests` → **200, `index.html`, 508 B**; the deep route `/quests/WC-CYCLOPS-MAIN-002` also 200 html; UI walkthrough served by the built client (all of Phase 2/3/4's MCP work ran against **this** stack). **Observation**: `/nope.js` also answers 200 html (the fallback is not asset-scoped) |
| P5-4 | **FAIL** | 19 of 20 routes clean at 375/768/1440; **`/zone-transfers/<long zone path>` scrolls the document sideways at 375px** — `documentElement.scrollWidth` **469 / 360** on the owner's `WizardCity/WC_Hub`, **838 / 360** on the corpus's 93-character destination, **397 / 360** on a real zero-teleport zone. Cause named element-by-element: unbreakable `span.font-mono` zone paths in view mode. The committed §1 assertion passes only because its route mock returns `{ZoneName: key, Teleports: []}` with an 18-character key — **the D78(d) class**. Reproduced a second time through the fixed instrument (**F1**: `Expected: <= 375, Received: 839`). Full detail in [`final-verify-findings.md`](./final-verify-findings.md) F1 |
| P5-5 | **PASS** | Playwright-MCP-driven axe scan, `axe-core@4.13.0` injected from the repo's own devDependency, on the four named pages plus the DropTable **after-Edit** arm: **0 violations at every severity — 0 critical, 0 serious, 0 moderate, 0 minor** (dashboard `/`, quest list, quest detail in edit-mode-on-load, DropTable detail view *and* edit). Independently, the same four pages are asserted by `a11y.spec.ts` in A1/A2 |
| P5-6 | **RE-READ + partially re-run** | 5.8's fresh-clone dry run is owned by **p5-09**, whose committed evidence (`docs/evidence/phase-5/p5-09-d1-clone.md`, `p5-09-d2-walkthrough.md`) records the full flow in `/tmp/p5-09/spiraldb-ui` against a throwaway corpus and DB, dev **and** prod modes. I re-ran the bounded half myself in `/tmp/fv6`: clone of `HEAD` → **clean checkout, 0 modified paths**, rc=0; **`npm ci --offline` FAILS** (`ENOTCACHED: zustand/-/zustand-4.5.7.tgz`); **`npm run build:cli` FAILS** with `CS0246: 'Imcodec'/'Imview'/'QuestTemplate' could not be found` — reproducing p5-09's own recorded finding that **the CLI build is location-dependent** (its csproj reaches the sibling repos by relative path); **`npm run sync` with an isolated `SPIRALDB_UI_DB` rc=0** in 22.2 s (328 quests / 1,241 zones / 317 drop_tables / 216,991 string_table rows / 137,423 manifest ids / 0 id mismatches / `sync_history: success row`), which also exercises p5-09's `SPIRALDB_UI_DB` fix; **`npm run build` rc=0**; prod `npm start` on `:3210` → `/quests` **200 index.html 508 B**, health ok, killed by explicit process group, port free. **The unit suite in that clone is contaminated**: `/tmp/node_modules` is a **symlink to this checkout's `node_modules`** (dated 2026-09-27 13:23, an earlier story's rig), so `require.resolve('vitest')` from the fresh clone resolves into the host repo; its 2 failed / 1455 passed / 15 skipped is therefore **indicative only**, not a clean-checkout certification. The UI walkthrough half of 5.8 was **not** re-run in the clone |
| process clause | **PASS** (cited) | [`final-verify-p5-process-clause.md`](./final-verify-p5-process-clause.md): PR #7 merged as `1bac35c6`, parents equal the PR's base/head, the remote holds only `main`, `ci` green **first run** in **5m14s** (run 36369599921), merge logged at round 90 — plus the honest limit that *which client* opened the PR rests on the round-90 log |

---

## What is **not reproducible** in this sweep (the explicit list)

1. **P1-6's raw command transcript.** The six screenshots exist
   (`docs/evidence/phase-1/final-verify-p1-06-*.png`) and the brief cites the dropdown contract, but
   no `final-verify-p1-ui.md` transcript is on disk. I did not re-run Phase 1 by instruction, so
   P1-6's *text* evidence is **missing, not verified**.
2. **P3-2's literal `322 passed` string.** No suite prints it; the plan's phrasing describes the
   count, and the count is now printed as `328 real + 322 clone files` (U2) / `321` (U1, pre-restore).
3. **P2-5's `extract quest` message from the two quests already extracted.** The two commits that
   exist for them are `update` (the files were present). To produce a genuine `extract` I used a
   committed capture whose quest was absent from the checked-out branch (`WC-UNICORN-MAIN-004`), and
   the commit is real: `b316b8b spiraldb: extract quest WC-UNICORN-MAIN-004 (FV Gate3)`.
4. **A capture for the six owner-corpus quests that the frozen clone lacks.** `fixturegen` refuses
   all six (`WC-COMMONS-MAIN-002-*`) with measured reasons (`m_goalName 'Goal 1' is not
   '1_WizardQuestGoals_TalkNPC'`; a dialog on a compilation goal). Raw output in
   `final-verify-p2.txt`. So the "create path with a *new* corpus quest" probe cannot exist.
5. **P4-2's two empty-list families** (`DropTable.Items`, `NpcDropTable.DropTableNames`) — the
   append-a-copy edit has nothing to copy; both families are covered by the rig's own save arms
   instead.
6. **P4-4's `RollChance` UI arm** — no labelled fillable control; curl only.
7. **P5-5's "reports archived under `docs/evidence/phase-5/`".** I deliberately did **not** add
   report files to that directory: it is the 79-file tracked-evidence set this sweep's strongest
   claim is about, and the scan's numbers live in `final-verify-p5.txt` instead. The *scan* was run;
   only the archive location differs from the plan's wording.
8. **The GitHub `ci` workflow on a runner.** No runner here; the same command was re-run locally and
   the CI run itself is cited.
9. **The `p4-10-altport.config.ts` rig** (second baseURL over the same mocks) — not run; named in
   [`final-verify-suites.md`](./final-verify-suites.md) with what covers its assertions.
10. **A genuine clean-room fresh clone.** `npm ci` needs the registry and `/tmp/node_modules`
    contaminates every `/tmp` checkout; a clean-room run must happen outside `/tmp` with network.

## Item 7 — the story evidence I did **not** read

**I did not audit the 63 stories' evidence.** `docs/evidence/` holds **400 files**
(`find docs/evidence -type f | wc -l`, measured after this sweep's own 21 `final-verify-*` files and
14 screenshots were added; it was 398 when the sweep measured it mid-run), distributed over the five
`phase-*` directories plus the top-level `final-*` audits — and **276** of them match the
per-story/`pN-*` naming patterns (`find … \( -name 'story-*' -o -name 'p[0-9]-*' \)`). What I
actually opened, this sweep:

- `docs/plan-phase-{1,2,3,4,5}-*.md` — each plan's **Verification Steps** section (and, for phase 3/4,
  the Acceptance Criteria lists), in full;
- `docs/evidence/phase-5/p5-06-d1-checklist.md` — **§1 only** (the route × breakpoint table and its
  method), which is what let me qualify its 375px conclusion precisely;
- `docs/evidence/phase-5/p5-09-d1-clone.md` — the head and section list (the 5.8 clone evidence);
- `docs/evidence/phase-5/p5-09-d2-walkthrough.md` — the head and its rig paragraph;
- `docs/evidence/phase-5/p5-08-d3-proof.md` — the paragraph that **defers** the clean-checkout half
  to p5-09;
- `.omd/prd/spiraldb-ui.json` — two story-evidence records (p2-02, p2-04) that surfaced
  incidentally while grepping the repo for `DOTNET_ROOT`, not a systematic read.

**Everything else — the per-story `.md`/`.txt` evidence for the other ~60 stories — I did not read.**
Where a step's only support was such a story's claim I have said so in the table above (P5-6, the
process clause's "opened through the MCP") rather than implying I verified it. The loop-level
`omd-agent-verifier` sign-off should treat this report as **audited per step against raw
re-executed output**, and **not** as an audit of the story-level evidence corpus.

## The working-tree changes this sweep leaves (four files, uncommitted, D84(a))

| file | what | proven by |
|---|---|---|
| `tests/ui/a11y-reduced-motion.spec.ts` | six screenshots move to the gitignored `test-results/a11y-reduced-motion/` (inherited from the previous executor) | mtime + hash + path over 79 files, solo **and** full suite, plus a negative control that makes the instrument fire — [`final-verify-tracked-write-fix.md`](./final-verify-tracked-write-fix.md) |
| `server/src/services/git.ts` | the commit-note cap is applied in **code points** (inherited) | astral payloads against the real module: lone surrogate before, intact after; ASCII unchanged; pinned test green — [`final-verify-findings.md`](./final-verify-findings.md) F3 |
| `client/src/components/objects/ZoneTransferForm.tsx` | `break-all` on the two view-mode zone-path spans, with the rule documented in the component docblock | F1 red (839 vs 375) → F2 green, on the §1 assertion |
| `tests/ui/responsive.spec.ts` | the `zone_transfer` route mock carries a **real-shaped** 93-character destination, so §1 can bite | same F1/F2 pair |

Green on the final tree: `npm run lint` rc=0, `npm run typecheck:tests` rc=0, client and server `tsc
--noEmit` rc=0, `npm test` 67/1472 rc=0, `npm run test:ui` **393 passed rc=0**.

## Rig hygiene

Every rig was killed **by explicit PID or process group** (`kill -TERM -- -<pgid>`; never
`pgrep -f` with a pattern on my own command line). At the end, the only listener on this host is the
**owner's** `[::1]:5173`, which was never touched; `:3001`, `:3210`, `:5181` are free and no stray
`node` remains. The owner's SpiralDB fork is **untouched**: `git -C …/spiraldb status --porcelain`
→ 0 lines, HEAD `d57d891` on `main`. `/tmp/fv6` is this sweep's own scratch and is left in `/tmp`
only.

## The D17 clone: restored, and re-verified at the end

`data/test-spiraldb` was mutated by this sweep's P2/P3/P4/P5 experiments (a legitimate way to prove
the chain, an illegitimate way to leave it) and restored: `git reset --hard 18dc924` on
`content/2026-09-27` + `git branch -D content/2026-09-28` (the branch my P2 save created). Final
check — **branch `content/2026-09-27`; HEAD `18dc92477d54b1e911796960407ce7710e703697`; `main`
`f3f8b5c0a48bc0f0b0cd9aca2d9d7d9d0122bd37` (unchanged); `rev-list --count HEAD` 42; porcelain empty;
0 diff lines against `18dc924`; 322 QuestTemplates; the legacy `GlobalRegistryModels_1-A.json` back;
`NpcDropTable/` absent.** Two notes a verifier needs: (a) `npm test` itself **writes and self-restores**
the clone (`tests/unit/quest-edit-isolation.test.ts` saves as `P3-10 AC1 Tester` and resets in a
`finally`+`afterAll`), so a frozen-clone check must run **after** the suite, not before; (b) the
residual branch `content/2026-09-26 @ 18dc924` is an earlier gate's, not this sweep's.

## Honest limits, collected

- **One step FAILS**: P5-4, on real data, for one route. Fixed by this sweep's two changes (proven
  F1→F2), but the FAIL stands for the tree as inherited, and the fix is **uncommitted**.
- **One step is re-read, not re-run**: P5-6's UI-walkthrough half (p5-09's claim); my own re-run is
  bounded and its unit half is contaminated by `/tmp/node_modules`.
- **One step's evidence is missing**: P1-6's transcript (screenshots only).
- **Two steps rest partly on curl rather than the UI**: P4-4's slider arm; P2-5's `extract` verb needs
  a create that the frozen clone cannot supply for a new corpus quest.
- **The suites were run locally, never in CI**, and the suite's one A1 failure is a carried flake
  whose isolated re-run is green — reported as a family, not as a pass.
- **The four working-tree fixes are uncommitted** by instruction; the next gate decides whether they
  land.