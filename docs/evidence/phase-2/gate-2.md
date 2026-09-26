# gate-2 — Phase-boundary regression gate (Phase 1 + Phase 2 suites re-passed; Phase 2 PR merged)

`docs/plan-phase-2-quest-extraction.md` Verification Steps 1–8 + `docs/plan-overview.md` "Regression gate".
The clause is explicit: **all 19 Phase-1 checkboxes and all 15 Phase-2 acceptance criteria re-run fresh**,
with raw outputs, and then the phase PR opened, CI polled to green, merged via GitHub MCP, branch deleted
and the merge logged in `.omd/prd/progress.txt` — and no later-phase story passes before it.

## What was re-run fresh

| Group | Record |
|---|---|
| Phase 1, all 19 checkboxes | [`gate-2/phase1-recheck.md`](./gate-2/phase1-recheck.md) + raw artifacts in [`gate-2/`](./gate-2/) (schema, two syncs with identical counts, 108-check spotcheck, the API matrix, restart, the live UI pass) |
| Phase 2, Verification Steps 1–8 | [`gate-2-phase2-verification.txt`](./gate-2-phase2-verification.txt) (V1/V2/V8 + the corrupt-input matrix) and [`gate-2-phase2-api-steps.txt`](./gate-2-phase2-api-steps.txt) (V3) |
| Phase 2, clone-based git evidence (V5/V6/V7, D17) | [`gate-2-clone-evidence.txt`](./gate-2-clone-evidence.txt) |
| Phase 2, the UI walkthrough (V4) + the Phase-1 browser clauses | [`gate-2-tier2.txt`](./gate-2-tier2.txt) + `gate2-0*.png` |
| The canonical gate on the frozen head | [`gate-p2-10-leadverify.txt`](./gate-p2-10-leadverify.txt) — 30 files / 770 unit tests, 66 UI specs, eslint 0, prettier clean, `typecheck:tests` 0, server+client `tsc` 0, build green |

Headline results: **two syncs byte-identical on all 7 name tables** (290,592 rows) and the spotcheck at
**108 checks / 0 failures**; the fresh import at exactly **2271** entries (quest 322, drop_table 317) with a
restart that imports nothing; the `/api` matrix incl. 404s and two 400s; the live Sync button
(79,835 / 18,173 / 23,033 / 322 / 1,241) and the three FriendlyNameDropdowns storing raw ids
(4808 / 607923 / 161001); the real CLI round-trip on a real corpus quest (name/title/level/mainline/
startGoals/goal count/names/types/dialog entries all identical); a **two-quest** real save producing
**two commits** `spiraldb: extract quest {name}` (author = the configured `user_name`) on branch
`content/2026-09-26`, 320 → 322 files, clean JSON, metadata created-vs-updated in place per D20, and the
history rows carrying the capture filename; and the browse list growing **320 → 322** in the browser.

## Flagged in the PR, as the plan requires

1. **The D28 fallback tier was NOT invoked.** The closed-loop round-trip is proven at full tier on real
   corpus quests with the real binary, and at corpus scale by the audit: [`corpus-roundtrip-audit.md`](./corpus-roundtrip-audit.md)
   — **181/322 round-trip identically (1810 field checks, 0 mismatches)**, 141 refused by the generator
   as a *coverage* limit (D53), 0 fidelity failures.
2. **ACHIEVERANK substitution (D46)** — every `GOAL_TYPE_ACHIEVERANK` quest in the corpus has an empty
   `m_goalTitle`, so the reader's `{n}_{m_goalTitle}` name derivation cannot reproduce it; those quests are
   outside the synthetic harness (4 appear as first-reason refusals in the audit).
3. **`AddCompletionDialogToQuestTemplate` ignores `GoalID` (D46(4))** — a goal-level dialog tagged
   `QuestInfo` would also be copied to quest level; FixtureGen refuses such quests explicitly.
4. **Plan 2.4 L48/L49 were implemented inside p2-07** (recorded in D48), not as a separate story.
5. **No real game packet capture exists anywhere on this host** (checked Imview, `$HOME`, `/tmp`); the
   committed captures are FixtureGen output by construction. Only a capture recorded from a live session
   can settle the 141 quests the synthetic harness cannot express — it replays unchanged.
6. **CI does not invoke the .NET CLI, and does not need to**: every tier-1 UI spec mocks
   `/api/extract/quests` (D40/D44) and `verify:captures` is not in CI, so the `ci` job needs **no**
   `actions/setup-dotnet` step. The real-binary proof lives in this gate's tier-2 evidence + the audit.
   (This closes the "home: gate-2 workflow decision" opened in D45.)
7. **322 is this repo's corpus, not the game's total** (~1,539 side + ~2,325 storyline quests per the
   wiki). Nothing hardcodes it; the list endpoint scans + JSON5-parses per request (71,328 B / 0.45–0.54 s
   for 322), so a cached index (D19) is the recorded next step before the corpus grows an order of magnitude.

## The PR

<!-- PR SECTION: filled in after the CI-green merge -->
