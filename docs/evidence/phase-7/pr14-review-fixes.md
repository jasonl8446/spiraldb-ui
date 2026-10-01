# PR #14 review fixes (D195)

Branch `phase-7-coverage-usability` at `29b1bf9` plus the working tree of this fix pass. Corpus for every save/git
check: the D17 clone `data/test-spiraldb` (322 quests, `content/2026-09-27` at `18dc924`). The review is the
advisory "Independent review — PR #14" (findings 1-9). New decision: **D195** in `docs/plan-overview.md` (numbered
D195 because D186-D194 exist on the Phase 8 branch). The owner moved finding 4 from DEFER to FIX during the pass.

Every fix below got its test first, run against the pre-fix code; those RAW red runs are in
[`pr14-review-fixes-red.txt`](./pr14-review-fixes-red.txt) (one `=====` section per finding). The green side is the
final suites at the end of this file.

## Findings → fixes

| # | Finding | Fix / deferral | Files | Test (red → green) |
|---|---|---|---|---|
| 1 | An empty/unreadable-corpus rebuild deletes the pending evidence queue | `buildDrafts` throws `DraftCorpusError` before any write when the index holds no quest file while pending `evidence-*` rows exist; route `409` naming the directory and count; `npm run drafts` exits 1; toast shows `removed`; the corpus `409` is an error toast, the running `409` stays info | `server/src/services/drafts.ts`, `server/src/routes/drafts.ts`, `scripts/build-drafts.ts`, `client/src/components/dashboard/RebuildDraftsButton.tsx`, `docs/spec-api.md`, `docs/spec-ui-design.md` | `tests/unit/p7-drafts.test.ts` "refuses a rebuild whose quest-file read found no file…" (the reviewer's reproduction, in-memory DB), "rebuilds over an empty quest-file read when no evidence row is pending", "answers 409 naming the missing directory…" (route); `tests/ui/p7-rebuild-drafts.spec.ts` toast text + "a 409 refusing an unreadable corpus…" |
| 2 | D119's `main` exemption replaces the tree when the setting names an existing branch | `resolveScaffoldBranch({requestedExists})`: `main` is exempt only when the branch does not exist (`undefined` fails closed); pipeline asks `GitService.branchExists`; CLI asks `git rev-parse --verify refs/heads/…`; D195(b) records the narrowing of D182(b) | `server/src/services/git.ts`, `server/src/services/savePipeline.ts`, `scripts/scaffold-quest.ts`, `docs/spec-api.md`, `docs/plan-overview.md` | `tests/unit/write-route-branch-guard.test.ts` "the tree on main" (both arms: every guarded route refused with an existing branch, main's file kept, refs unmoved; a missing branch still created from main); `tests/unit/quest-scaffold.test.ts` "exempts main only for a branch that does not exist yet" (setting and flag arms, and `undefined`) |
| 3 | Double-click Save / stale accepted ids / draft first save whose file exists | Save `aria-disabled` + `aria-busy` while pending, plus a synchronous ref guard; on failure re-read pending suggestions and drop dead applied ids (`reconcileApplied`) with a warning; a draft 409 "already has a definition" offers **Open the saved quest** (`isDraftAlreadySaved`) | `client/src/components/quest/QuestSaveButton.tsx`, `client/src/pages/QuestDetailPage.tsx`, `client/src/lib/suggestions.ts`, `client/src/lib/notify.ts`, `client/src/lib/quest-edit.ts` | `tests/ui/p7-editor-review-fixes.spec.ts` "a double-click on Save sends exactly one POST…", "a failed save drops the accepted ids…", "a draft whose file now exists…"; `tests/unit/p7-draft-queue.test.ts` "PR #14 review 3" (reconcile + 409 recognition) |
| 4 | Advanced stays closed on an authored `false`/`0` whose field defaults to `true`/non-zero | **Fixed (owner-approved during the pass).** Per-field defaults derived from the new-node builders, by class `$type` (`fieldDefault`, `isDefaultFieldValue`); D195(d) amends D179/D132 | `client/src/lib/advanced.ts`, `docs/spec-ui-design.md` | `tests/unit/quest-tiers.test.ts` "the Advanced auto-open rule" (rewritten deliberately, see below); `tests/ui/quests-advanced-disclosure.spec.ts` three new arms + the updated fixture |
| 5 | A blank `git_branch` is refused with a branch the setting does not hold | Blank setting → `requested: undefined` (follow the tree, as the CLI); on `main` the session branch `content/{today}` is still cut from `main` | `server/src/services/savePipeline.ts` | `tests/unit/write-route-branch-guard.test.ts` "follows the checked-out branch when git_branch is blank…" |
| 6 | The commit subject / file name carries a caller key unsanitised | `fileNameFor` refuses U+0000-U+001F and U+007F (0 such keys in the clone and the owner fork, grep below); `NamingError` → `400` on the quest and object save routes | `shared/naming.ts`, `server/src/routes/quests.ts`, `server/src/routes/objects.ts` | `tests/unit/naming.test.ts` "rejects every control character…"; `tests/unit/quests-api.test.ts` "400s a quest name carrying control characters…" (the reviewer's payload through the mounted router: red shows the forged commit `spiraldb: extract quest A\n\nspiraldb: create quest PWNED…`) |
| 7 | `PREP_REQUIREMENTS_TREE_LABEL` drifted from the glossary | All six tree/section label constants read `fieldLabel(…)`; the single-home test gained shape 5 (a `*_LABEL` literal equal to a glossary label), which flagged the five identical copies | `client/src/components/quest/QuestRequirementsEditor.tsx`, `client/src/components/quest/QuestResultsEditor.tsx`, `tests/unit/glossary-single-home.test.ts`, `tests/ui/quests-requirements-editor.spec.ts` (region name now "Prep requirements") | `tests/unit/glossary-single-home.test.ts` (real tree + scratch control + benign control) |
| 8 | `m_startGoals` suggestions render on Goal Logic | `suggestionTab` reads the owner table `QUEST_OTHER_TAB_FIELDS` | `client/src/lib/suggestions.ts` | `tests/unit/p7-draft-queue.test.ts` "places each suggestion in the tab that holds its field" |
| 9a | A suggestion-store failure is a server warning only | Response `suggestions_store: {stored:false, reason}`; the upload page shows it | `server/src/routes/extract.ts`, `client/src/lib/api.ts`, `client/src/lib/extract.ts`, `client/src/hooks/useExtraction.ts`, `client/src/pages/ExtractionPage.tsx`, `docs/spec-api.md` | `tests/unit/p7-drafts.test.ts` "reports a store failure in the 200 body…"; `tests/unit/extract-ui.test.ts` "the suggestion store outcome" |
| 9b | Rebuild cost: two unindexed `string_table` scans | **Deferred.** Measured below: 6,251 ms for 5,469 proposals (clone root, dev-DB copy). An index is a migration, and replacing `resolveLink`'s reads with the builder's in-memory title map touches D182(a)'s link semantics; neither is a correctness defect | — | — |
| 9c | Census rows unvalidated; child never released | Each row must be `{message: string, field: string, count: number, consumed: boolean}` or the census is `{skipped}`; the child is released in `finally` | `server/src/services/census.ts`, `docs/spec-api.md` | `tests/unit/census-service.test.ts` (four drifted rows; registered while running, released after) |
| 9d | Capture suggestions for an uncatalogued quest are unreachable; store not awaited | The store is awaited; `storeCaptureSuggestions` returns `uncatalogued`, carried in `suggestions_store` and shown | `server/src/services/drafts.ts`, `server/src/routes/extract.ts`, client files of 9a | `tests/unit/p7-drafts.test.ts` "awaits the store and counts suggestions whose quest the catalog does not hold"; idempotency test now also pins `uncatalogued` |
| 9e | `/drafts` claims an empty catalog before coverage answers | `draftsEmptyState`: no-match / coverage-pending / coverage-error (with Try again) / no-catalog / no-suggestions | `client/src/lib/suggestions.ts`, `client/src/pages/DraftsPage.tsx`, `docs/spec-ui-design.md` | `tests/unit/p7-draft-queue.test.ts` "PR #14 review 9e" |
| 9f | A failed suggestions read is silent on the editor | An alert with **Try again** (a `404` is "no suggestions", not a failure) | `client/src/pages/QuestDetailPage.tsx`, `client/src/lib/quest-edit.ts` | `tests/ui/p7-editor-review-fixes.spec.ts` "a failed suggestions read is shown with a retry…" |
| 9g | Accept is clickable while that row's Reject is in flight | Accept `aria-disabled` and ignored while rejecting; accept-all skips that row | `client/src/components/quest/QuestSuggestions.tsx` | `tests/ui/p7-editor-review-fixes.spec.ts` "Accept waits while the same row's Reject is in flight" |
| 9h | `planSuggestionAccept` can plan a path `applyEdits` throws on | **Deferred.** Not reachable from the tool's own writers (the reviewer's note); a guard needs a decision on how a scalar parent is reported | — | — |
| 9i | `SUGGESTION_SOURCES` duplicated client-side | One home, `shared/suggestions.ts`; server and client re-export it | `shared/suggestions.ts`, `server/src/services/drafts.ts`, `client/src/lib/suggestions.ts` | `tests/unit/p7-draft-queue.test.ts` "PR #14 review 9i" (identity of the three exports) |
| 9j | `/glossary` shows "Basic Basic" | The technical span is omitted when the label is the technical name (D135) | `client/src/pages/GlossaryPage.tsx` | `tests/ui/p7-glossary-help.spec.ts` "a term whose label is its technical name shows it once…" |
| 9k | The Prep-dialog repair joins by `MobileID` | **Deferred.** Not trivially safe: the right repair is a `QuestID` join or a new report kind, and no committed capture has two offers from one NPC, so neither could be exercised | — | — |
| 9l | An orphan `MSG_ACTORDIALOG` is dropped silently | Reported like the encounter twin (`MSG_ACTORDIALOG.ActorDialog`, "no MSG_SENDGOAL of an extracted quest introduces GoalID n") | `tools/PacketReaderCli/ReaderRepairs.cs` | `tests/unit/p7-observed-fields.test.ts` local-only arm "reports an MSG_ACTORDIALOG whose GoalID…"; **no golden changed** (the byte-compare arm is green, below) |
| 9m | Phase 7's acceptance boxes unticked | Ticked with evidence links, each checked against its raw file; see the next section | `docs/plan-phase-7-coverage-usability.md`, `tests/ui/p7-label-scan.spec.ts` (Overview arm), `AGENTS.md` | — |
| 9n | The extract route's exemption reason is stale | Reason now names the `quest_suggestions` writes | `tests/unit/write-route-branch-guard.test.ts` | the route-classification test |
| 9o | `MSG_SENDGOAL.PersonaName` proof is circular | **Deferred.** Only a real capture can corroborate it: the owner's post-run real-capture replay (the plan's "Done when") | — | — |
| — | `zone-transfer-model.test.ts` opens the dev DB without its guard | `it.skipIf(!DB_PRESENT)` on the zones arm | `tests/unit/zone-transfer-model.test.ts` | red/green in a fresh worktree without `data/` (last two sections of the red file) |

### Tests changed deliberately (not loosened)

- `tests/unit/quest-tiers.test.ts` "the Advanced auto-open rule": the block pinned the old rule (`''`, `0`, `false`, `[]`
  never open). It now pins D195(d): null/absent and the field's own default stay closed; `''`/`false`/`[]` open a field
  that defaults to `0`; `false`/`0` open fields that default to `true`/non-zero; `m_isQuestRegistry` by class; a fresh
  `newDialogEntry()` stays closed; a field no builder writes keeps the empty rule.
- `tests/ui/quests-advanced-disclosure.spec.ts` `skeletonEntry`: five values moved from the generic empty set to the
  fields' own defaults (`m_nameSTKey`, `m_cameraHidePlayers`, `m_musicFadeTime`, `m_spamTime`, `m_meetsRequirements`).
- `tests/ui/quests-dialog-editor.spec.ts` "gives every card the 5 accordions…": Camera no longer opens for
  `m_cameraHidePlayers: 2` (the default); Advanced still opens, now asserted for its visible validation message.
- `tests/ui/quests-results-editor.spec.ts` "reloads a saved document…": opens a new ResTeleport's Advanced before
  typing (its `TELEPORT_STATIC` is its default, so it no longer opens by itself).
- `tests/ui/p7-rebuild-drafts.spec.ts`: the toast text gained `, 0 removed`.
- `tests/unit/census-service.test.ts`: "the child is in the registry" is now asserted while it runs, and released after.
- `tests/unit/p7-drafts.test.ts` idempotency: the store result also pins `uncatalogued`.

## Finding 4's measurements (D17 clone, 322 files, 1,706 dialog entries)

```
MEASURE D17 clone data/test-spiraldb: 322 quest files, 1706 dialog entries
MEASURE Camera: opens by value — D179 generic-empty rule 1689, D195 per-field rule 1612
MEASURE Sound: opens by value — D179 generic-empty rule 1677, D195 per-field rule 69
MEASURE Animation: opens by value — D179 generic-empty rule 540, D195 per-field rule 540
MEASURE Advanced: opens by value — D179 generic-empty rule 1672, D195 per-field rule 428
```

The reviewer's counts, re-measured with `grep -rhoE '"<key>"\s*:\s*(true|false)' data/test-spiraldb/QuestTemplates`:

```
m_bypassCameraOnReview false: 35  true: 1671
m_meetsRequirements false: 30  true: 1670
m_isQuestRegistry false: 2  true: 37
```

`WC-UNICORN-MAIN-002`'s `m_requirements.m_requirements[1]` is a `ReqHasEntry` with `m_isQuestRegistry: false`; its
served document is committed as `tests/unit/fixtures/clone-quest-WC-UNICORN-MAIN-002.json` for the tier-1 arm.

## Finding 1 and 9b: the rebuild on the real corpus

A copy of `data/spiraldb-ui.db` (made with better-sqlite3's online backup; the dev DB was only read) and the clone:

```
$ npm run drafts -- --db <scratch>/drafts-copy.db --spiraldb data/test-spiraldb
  "proposed": 5469,
  "inserted": 20,
  "unchanged": 5449,
  "removed": 9,
  "duration_ms": 6251
real	0m7.045s
$ npm run drafts -- --db <scratch>/drafts-copy.db --spiraldb data/test-spiraldb/QuestTemplates; echo "exit=$?"
[spiraldb-ui] SpiralDB root   at data/test-spiraldb/QuestTemplates (read only)
[spiraldb-ui] The rebuild read no quest file from /home/jason/Documents/git-projects/spiraldb-ui/data/test-spiraldb/QuestTemplates/QuestTemplates (missing or empty), and 5469 pending evidence suggestions would be deleted as "no longer proposed". Nothing was changed. Check spiraldb_path in Settings: it must be the SpiralDB repository root, the directory holding QuestTemplates/.
exit=1
```

## Finding 6: no corpus key carries a control character

```
$ grep -rlP '"(m_questName|Name|DeckName|ZoneName)"\s*:\s*"[^"]*\\(u00[01][0-9a-fA-F]|u007[fF]|[tnrbf])' data/test-spiraldb --include=*.json | head -3
$ grep -rlP '…same…' /home/jason/Documents/git-projects/spiraldb --include=*.json | head -3
(no output from either)
```

## Phase 7 acceptance boxes (9m)

Each box was checked against the raw file its link names (D92: never from a summary):

| Box | Raw line read | Result |
|---|---|---|
| 1 observed exact / inferred only suggested | `gate-7-p7-1-census.txt:22` `TOTAL planted fields 72, missing from census 0`; `gate-7-p7-2-reader.txt` 9 × `stdout-vs-golden=identical sidecar-vs-golden=identical` | ticked |
| 2 audit:corpus | `gate-7-p7-3-audit-corpus.txt:37` `PASS: 314/322 verified, 8 not covered by the synthetic harness, 0 failure(s)` | ticked |
| 3 drafts | `gate-7-p7-4-drafts.txt:106` `[{"named_missing_eq_missing":1,…}]` and `catalog_ids_without_draft` 0; run 2 `"inserted": 0` | ticked |
| 4 live Imlight boot | `gate-7-p7-5-live-boot.txt:146-148` `322 + 1 = 323` / `PASS — rises by exactly one` | ticked |
| 5 no bare label | `p7-10-negative-control.txt:40,94` (1 hit red → 0 hits green); the Overview tab, added after the scanner, is scanned by this pass's new `p7-10 label scan — the Overview tab` arm (final tier-1 run below) | ticked |
| 6 glossary | `p7-09.md` "Criterion 2" and "Criterion 3" with their negative-control sidecars | ticked |
| 7 Overview, Basic/Advanced, cards, popover | `p7-14.md`, `p7-12.md`, `p7-11.md`, `p7-13.md`, tier-2 `p7-14-tier2.md` and `gate-7-p7-6-walkthrough.txt` | ticked |
| 8 Phase 6 residuals | `p7-15.md`, `p7-16.md`, `p7-17.md` | ticked |
| 9 suites + flakes | `gate-7-freeze-and-gates.txt`; `p7-16-isolated.txt`, `p7-16-full-runs.txt` | ticked |
| 10 D125-D137, specs, AGENTS.md | `grep -c '^- \*\*D1(2[5-9]\|3[0-7])' docs/plan-overview.md` = 13; `p7-01.md` "Criterion 2"; AGENTS.md's stale "D1–D124" range corrected by this pass | ticked |

## Final suites (fresh, after every fix)

Run in this order, none concurrently with a clone check.

A first full tier-1 run after the fixes had 21 failures (20 in `extraction.spec.ts`, 1 in `a11y-keyboard.spec.ts`):
the new `suggestionsStoreNotice` call read `result.suggestions.length` and the older extraction mocks send no
`suggestions`. Fixed in `useExtraction.ts` (`(result.suggestions ?? []).length`); the two files then passed 33/33,
and the whole suite was re-run:

```
$ npm run lint; npm run typecheck:tests; npm run typecheck:scripts
All matched files use Prettier code style!
lint exit=0
typecheck:tests exit=0
typecheck:scripts exit=0

$ npm test
 Test Files  107 passed (107)
      Tests  2201 passed (2201)
exit=0

$ npm run test:ui
  471 passed (2.2m)
exit=0
```

The Overview arm of the label scan (box 5), from that run:

```
WC-CYCLOPS-MAIN-003: Overview 0 hit(s)
WC-TUT-C05-001: Overview 0 hit(s)
WC-COMMONS-MAIN-001: Overview 0 hit(s)
WC-COMMONS-MAIN-003: Overview 0 hit(s)
Tutorial_Intro: Overview 0 hit(s)
WC-UNICORN-MAIN-004: Overview 0 hit(s)
```

C# changed (finding 9l), so the CLI was rebuilt with the D18 flags (`npm run build:cli`, 0 errors) and then, alone:

```
$ npm run verify:captures
PASS: 5 fixture(s), 55 field check(s), 0 mismatch(es), 0 known-reader-defect row(s).
verify:captures exit=0

$ npx vitest run tests/unit/p7-observed-fields.test.ts tests/unit/p7-suggestions.test.ts tests/unit/p7-capture-census.test.ts
 Test Files  3 passed (3)
      Tests  177 passed (177)
p7 goldens exit=0
```

No golden file changed (`git status --short server/test/fixtures` is empty); the local-only arm of
`p7-observed-fields.test.ts` byte-compares every p7 golden against the rebuilt CLI.

### CI simulation (unit suite, fresh worktree at `29b1bf9` plus this pass's files, no `data/`, no `tools/bin`)

```
 FAIL  tests/unit/quest-dialog.test.ts > the real corpus of dialog lists > keeps every entry’s own shape, order and bytes across a benign re-set of every field
 Test Files  1 failed | 104 passed | 2 skipped (107)
      Tests  1 failed | 2139 passed | 61 skipped (2201)
exit=1
```

The one failure is pre-existing and outside this pass: the same test failed identically (`×`) when the worktree was reset to an untouched `29b1bf9` and the file run alone. It reads the sibling owner fork first (`DEFAULT_SPIRALDB_PATH`, 328 quests), which this worktree could still see; that the fork lacks a shape the D17 clone carries (`nullOmitted65`) is the likely cause, not measured here. gate-7's CI simulation hid the sibling trees, which this quick run did not. The zone-transfer DB guard's own red/green is in the red file's last two sections.

### Clone at the end

```
$ git -C data/test-spiraldb log --oneline -1; git -C data/test-spiraldb status --short | wc -l; git -C data/test-spiraldb branch --show-current
18dc924 spiraldb: extract quest WC-CYCLOPS-MAIN-002
0
content/2026-09-27
```
