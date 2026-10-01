# final-deslop (Phase 7 final gate 1/3) — the ai-slop-cleaner pass over the cumulative Phase 7 diff

Branch `final-gate-7`, cut from `main` @ `7c2e987` (the PR #14 merge); nothing committed by this story. Method: the
`ai-slop-cleaner` skill in its standard (fixing) mode — behaviour locked by the existing suites first (baseline run
below), deletion first, one smell batch at a time, focused suites after each batch, full gates at the end.
Corpus for every clone-touching check: the D17 clone `data/test-spiraldb` (322 quests, `content/2026-09-27` at
`18dc924`, clean before and after).

## Scope

`git diff 3451c88..7c2e987` (main at Phase 7 launch → the merge): **430 files, +75,762 / −1,407** (measured;
the brief's 421 was an estimate). By top level: client 55, server 83 (61 of them capture fixtures/goldens),
shared 5, scripts 7, tools 9, tests 99, docs 169, root 3 (`AGENTS.md`, `.gitignore`, `package.json`).
Code in scope: the 193 `.ts/.tsx/.mjs/.cs/.sql` files under client/, server/, shared/, scripts/, tools/, tests/.
`docs/` is prose and raw evidence (not cleaned; evidence files are never rewritten). `package.json` gained two
scripts (`build:census`, `drafts`) and **no dependency** (`package-lock.json` unchanged in the range).

Not re-done, by instruction: PR #14 review items **9b / 9h / 9k / 9o** (deferred to Phase 8 in
`pr14-review-fixes.md`). Documented D-items D125–D195 were treated as intentional (e.g. D195(d)'s per-field
default rule in `advanced.ts` is not "a second empty check").

## Commands used to find candidates

Three read-only scanners (client; server+shared+scripts; tests+tools) worked from the added lines of the diff;
every finding they reported was re-checked by hand before it was fixed or kept. My own mechanical scans:

```
# scope list
git diff --name-only 3451c88..7c2e987 -- client server shared scripts tools tests | grep -E '\.(ts|tsx|mjs|cs|sql)$'   # 193
# boundary: client -> server / json5; shared imports; server -> client
grep -nE "from ['\"](\.\./)+server/|json5" <client files>            # 0 hits
grep -nE "^import|from ['\"]" <shared files>                          # only relative imports inside shared/
grep -nE "from ['\"](\.\./)+client/" <server+scripts files>          # 1: questEvidence.ts:8 (pre-existing, K15)
# debug leftovers in added lines
git diff 3451c88..7c2e987 -- <scope> | grep -nE '^\+.*(console\.(log|debug)|debugger;|page\.pause|test\.only|it\.only|describe\.only|TODO|FIXME|HACK|XXX)'
# unused locals / params, all four projects
for p in client server tests scripts; do npx tsc -p $p/tsconfig.json --noEmit --noUnusedLocals --noUnusedParameters; done | grep -c 'error TS'   # 0
# dead exports: every `+export` in the diff, files referencing the name outside its own file
#   (scratch script: grep -rlw <name> client/src server/src shared scripts | grep -v <own file>; tests counted apart)
```

Dead-export scan output (RAW; rows are the names with **0 production files outside their own**):

```
client/src/components/TermLabel.tsx	TermLabelProps	prod_other_files=0	tests=0	self_refs=2
client/src/components/dashboard/RebuildDraftsButton.tsx	draftsRebuiltMessage	prod_other_files=0	tests=0	self_refs=2
client/src/components/dashboard/RebuildDraftsButton.tsx	REBUILD_DRAFTS_LABEL	prod_other_files=0	tests=0	self_refs=2
client/src/components/quest/DraftNameDialog.tsx	DraftNameDialogProps	prod_other_files=0	tests=0	self_refs=2
client/src/components/quest/QuestOverview.tsx	firstPendingTab	prod_other_files=0	tests=1	self_refs=2
client/src/components/quest/QuestOverview.tsx	QuestOverviewView	prod_other_files=0	tests=1	self_refs=3
client/src/components/quest/QuestOverview.tsx	suggestionBadgeText	prod_other_files=0	tests=1	self_refs=2
client/src/components/quest/QuestPreview.tsx	PreviewTabSelectContext	prod_other_files=0	tests=0	self_refs=4
client/src/components/quest/QuestPreview.tsx	QuestTab	prod_other_files=0	tests=0	self_refs=9
client/src/components/quest/QuestRequirementsEditor.tsx	GOAL_REQUIREMENTS_SECTION_LABEL	prod_other_files=0	tests=0	self_refs=2
client/src/components/quest/QuestRequirementsEditor.tsx	PREP_REQUIREMENTS_TREE_LABEL	prod_other_files=0	tests=1	self_refs=2
client/src/components/quest/QuestRequirementsEditor.tsx	PRUNE_REQUIREMENTS_TREE_LABEL	prod_other_files=0	tests=0	self_refs=2
client/src/components/quest/QuestRequirementsEditor.tsx	REQUIREMENTS_TREE_LABEL	prod_other_files=0	tests=0	self_refs=2
client/src/components/quest/QuestResultsEditor.tsx	END_RESULTS_LABEL	prod_other_files=0	tests=0	self_refs=2
client/src/components/quest/QuestResultsEditor.tsx	START_RESULTS_LABEL	prod_other_files=0	tests=1	self_refs=2
client/src/components/quest/QuestSaveButton.tsx	SAVE_PENDING_TOOLTIP	prod_other_files=0	tests=0	self_refs=2
client/src/components/quest/QuestSuggestions.tsx	SuggestionsChannel	prod_other_files=0	tests=0	self_refs=4
client/src/lib/advanced.ts	fieldDefault	prod_other_files=0	tests=1	self_refs=2
client/src/lib/advanced.ts	FieldDefault	prod_other_files=0	tests=0	self_refs=2
client/src/lib/advanced.ts	isDefaultFieldValue	prod_other_files=0	tests=0	self_refs=3
client/src/lib/api.ts	EXTRACT_QUESTS_CENSUS_PATH	prod_other_files=0	tests=1	self_refs=2
client/src/lib/api.ts	QuestSkeleton	prod_other_files=0	tests=0	self_refs=3
client/src/lib/api.ts	ScaffoldDraftBody	prod_other_files=0	tests=0	self_refs=2
client/src/lib/api.ts	SuggestionDraftKey	prod_other_files=0	tests=0	self_refs=3
client/src/lib/glossary-rows.ts	GlossaryRow	prod_other_files=0	tests=0	self_refs=4
client/src/lib/quest-overview.ts	ORDER_AS_STORED	prod_other_files=0	tests=1	self_refs=4
client/src/lib/quest-overview.ts	ORDER_BY_LOGIC	prod_other_files=0	tests=1	self_refs=3
client/src/lib/quest-overview.ts	OverviewRequirementLine	prod_other_files=0	tests=0	self_refs=3
client/src/lib/quest-overview.ts	OverviewStep	prod_other_files=0	tests=0	self_refs=3
client/src/lib/suggestions.ts	REWARD_OBSERVATION_REASON	prod_other_files=0	tests=1	self_refs=2
client/src/lib/suggestions.ts	SuggestionAcceptPlan	prod_other_files=0	tests=0	self_refs=2
client/src/pages/QuestDetailPage.tsx	EditorDraft	prod_other_files=0	tests=0	self_refs=2
server/src/db.ts	applyQuestTitleKeyColumnAdds	prod_other_files=0	tests=1	self_refs=3
server/src/db.ts	QUEST_TITLE_KEY_COLUMN_ADDS	prod_other_files=0	tests=0	self_refs=3
server/src/routes/drafts.ts	DraftRebuilder	prod_other_files=0	tests=1	self_refs=3
server/src/routes/drafts.ts	DraftsRouterOptions	prod_other_files=0	tests=0	self_refs=2
server/src/routes/drafts.ts	parseDraftFilters	prod_other_files=0	tests=0	self_refs=2
server/src/routes/drafts.ts	rebuildFromSettings	prod_other_files=0	tests=0	self_refs=2
server/src/routes/drafts.ts	suggestionsBody	prod_other_files=0	tests=0	self_refs=7
server/src/services/census.ts	CENSUS_BUILD_HINT	prod_other_files=0	tests=1	self_refs=2
server/src/services/census.ts	CensusOutcome	prod_other_files=0	tests=0	self_refs=2
server/src/services/census.ts	CENSUS_RELATIVE_PATH	prod_other_files=0	tests=0	self_refs=2
server/src/services/census.ts	CensusResult	prod_other_files=0	tests=0	self_refs=3
server/src/services/census.ts	CensusServiceOptions	prod_other_files=0	tests=0	self_refs=2
server/src/services/census.ts	defaultCensusPath	prod_other_files=0	tests=0	self_refs=2
server/src/services/drafts.ts	DraftCounts	prod_other_files=0	tests=0	self_refs=5
server/src/services/drafts.ts	DraftProposals	prod_other_files=0	tests=0	self_refs=4
server/src/services/drafts.ts	EVIDENCE_SOURCES	prod_other_files=0	tests=0	self_refs=1
server/src/services/drafts.ts	INFERRED_LINK_CONFIDENCE	prod_other_files=0	tests=0	self_refs=3
server/src/services/drafts.ts	InsertResult	prod_other_files=0	tests=0	self_refs=3
server/src/services/drafts.ts	insertSuggestions	prod_other_files=0	tests=1	self_refs=3
server/src/services/drafts.ts	namePredecessor	prod_other_files=0	tests=1	self_refs=3
server/src/services/drafts.ts	proposeDrafts	prod_other_files=0	tests=1	self_refs=2
server/src/services/drafts.ts	readDraftCounts	prod_other_files=0	tests=0	self_refs=2
server/src/services/drafts.ts	SuggestionProposal	prod_other_files=0	tests=1	self_refs=5
server/src/services/drafts.ts	SuggestionStatus	prod_other_files=0	tests=0	self_refs=3
server/src/services/drafts.ts	zonePathOfWad	prod_other_files=0	tests=1	self_refs=2
server/src/services/extraction.ts	ObservedFieldReport	prod_other_files=0	tests=1	self_refs=4
server/src/services/extraction.ts	OBSERVED_GOAL_FIELDS	prod_other_files=0	tests=0	self_refs=2
server/src/services/extraction.ts	OBSERVED_QUEST_FIELDS	prod_other_files=0	tests=0	self_refs=2
server/src/services/extraction.ts	parseSuggestions	prod_other_files=0	tests=1	self_refs=2
server/src/services/extraction.ts	screenObservedFields	prod_other_files=0	tests=1	self_refs=4
server/src/services/extraction.ts	SUGGESTIONS_FILE	prod_other_files=0	tests=0	self_refs=2
server/src/services/questEvidence.ts	SpeakerFallThroughClass	prod_other_files=0	tests=0	self_refs=4
server/src/services/questEvidence.ts	SPEAKER_FALL_THROUGH_CLASSES	prod_other_files=0	tests=1	self_refs=2
server/src/services/questScaffold.ts	draftMetadataDescription	prod_other_files=0	tests=0	self_refs=2
server/src/services/sync/cli.ts	formatSpeakerLadderSummary	prod_other_files=0	tests=0	self_refs=2
shared/glossary.ts	fieldTerm	prod_other_files=0	tests=2	self_refs=4
shared/glossary.ts	fieldValueTerm	prod_other_files=0	tests=1	self_refs=1
shared/glossary.ts	GLOSSARY	prod_other_files=0	tests=2	self_refs=1
shared/glossary.ts	groupTerm	prod_other_files=0	tests=1	self_refs=3
shared/glossary.ts	shortClassName	prod_other_files=0	tests=1	self_refs=3
```

Of these only `EVIDENCE_SOURCES` (self_refs=1: the declaration alone) is dead code; every other row is used in its own
file (self_refs ≥ 2) or by a test (tests ≥ 1) — see K2/K3.

## Disposition table

| id | file:line (at `7c2e987`) | category | finding | fixed / kept + reason | test that covers it |
|---|---|---|---|---|---|
| F1 | `server/src/services/drafts.ts:63-66` | dead code | `EVIDENCE_SOURCES` declared, referenced nowhere (0 importers, 0 tests, 1 occurrence = its declaration); the rebuild actually filters with SQL `source LIKE 'evidence-%'` (`:1010`, `:1053`) | **FIXED** — deleted with its doc comment | `tests/unit/p7-drafts.test.ts` (rebuild arms), server `tsc` |
| F2 | `server/src/services/questScaffold.ts:228` | dead export | `type ScaffoldBranchDecision` re-exported from `./git.js` with 0 consumers (only `git.ts` uses it) | **FIXED** — the re-export keeps `resolveScaffoldBranch` (used by `scripts/scaffold-quest.ts:42`) only | `tests/unit/quest-scaffold.test.ts`, `typecheck:scripts`, server `tsc` |
| F3 | `server/src/services/extraction.ts:449` | duplication | new local `isRecord` byte-identical in body to the exported `isPlainObject` (`server/src/services/sync/json.ts:26`), which the new `drafts.ts` already imports | **FIXED** — local deleted, 4 call sites read `isPlainObject` | `tests/unit/p7-observed-fields.test.ts`, `p7-suggestions.test.ts`, `extraction-service.test.ts`, `extract-api.test.ts` |
| F4 | `client/src/lib/quest-overview.ts:90-108` | duplication | `namesOf` + `rulesOf` re-implement the `m_goalLogic` readers `quest-goal-logic.ts` already exports (`goalLogicEntries`, `goalLogicEntryNames`, `goalLogicEntryCompletes`, `goalLogicEntryRequiredORCount`) | **FIXED** — `rulesOf` reads through them; `namesOf` deleted. Equivalence: non-object entries still filtered; `requiredOr` is still the count when it is a number > 0, else 1 (the reader returns `null` for a non-finite number, which JSON cannot hold). Bundle: main chunk 992.31 kB → 992.11 kB (`quest-goal-logic` was already in it; no new chunk dependency) | `tests/unit/quest-overview.test.ts`, `tests/ui/p7-overview.spec.ts` |
| F5 | `client/src/lib/quest-overview.ts:227`, `client/src/components/quest/QuestOverview.tsx:127-129` | duplication | two hand-written `m_goals` reads (one with casts) beside the exported `goalsOf` | **FIXED** — both call `goalsOf(doc)` (same result for every input: a non-object or an array document gives `[]`) | `tests/unit/quest-overview.test.ts`, `tests/ui/p7-overview.spec.ts`, `p7-label-scan.spec.ts` |
| F6 | `client/src/pages/QuestDetailPage.tsx:683` | stale comment | cites spec-ui-design "L537" for "summary at top of form if multiple errors"; L537 is now another rule (the text is at `docs/spec-ui-design.md:977`) | **FIXED** — cites the rule by its wording, no line number | — (comment) |
| F7 | `client/src/lib/api.ts:804` | stale comment | cites "docs/spec-api.md L303-307" for the extract body; those lines are now `title_source` (the endpoint is at `:898`) | **FIXED** — names the endpoint's section | — (comment) |
| F8 | `tools/CaptureCensus/Program.cs:45-62` | stale comment | the consumed-fields table cites 10 drifted lines: `CLI:278/279/167` (now `307/308/196`) and `RR:232/233/234/321/325/333/358` (now `244/245/246/333/337/345/370`) after p7-05/p7-06/D195 edits; every `OF:` and `SG:` cite re-checked with `sed -n` and correct | **FIXED** — the 10 cites remapped (one `re.sub` over the table only). Comment-only C# change: `build:census` + `build:cli` + `build:fixturegen` green, `verify:captures` PASS, p7 golden vitest 177/177 | `tests/unit/p7-capture-census.test.ts` (byte-compare arm ran), `verify:captures` |
| F9 | `tests/unit/p7-observed-fields.test.ts:38-101`, `p7-suggestions.test.ts:49-88`, `p7-capture-census.test.ts:21-69` | duplicated test helpers | the same fixture preamble three times: `P7_DIR`, `Step`/`InjectSpec`/`Envelope`, the `quests` listing, `readJson`, and (two of them) `exactIds`/`specOf` | **FIXED** — one home `tests/helpers/p7-fixtures.ts` (`InjectSpec` is the superset the census copy already had); the files import it. Per-file test counts unchanged: 61 / 59 / 57, 0 skipped (before and after) | the three suites themselves |
| F10 | `tests/unit/p7-drafts.test.ts:652` | test slop | "answers 409 while a rebuild runs" ordered its two requests with `setTimeout(…, 50)` — a timing race | **FIXED** — the held rebuilder resolves an `entered` signal and the test awaits it; assertions untouched | that test |
| K1 | `server/src/services/drafts.ts:122` | dead export? | `export { isEmptyValue }` re-export looked consumer-less | **KEPT** — `tests/unit/p7-drafts.test.ts:23` imports it from this module | `p7-drafts.test.ts` "the empty rule" |
| K2 | client: `RebuildDraftsButton.tsx:10,16`, `TermLabel.tsx:18`, `DraftNameDialog.tsx:15`, `QuestPreview.tsx:52,73`, `QuestSaveButton.tsx:40`, `QuestSuggestions.tsx:33`, `advanced.ts:35,118`, `api.ts:1212,1226,1250`, `glossary-rows.ts:19`, `quest-overview.ts:41,52`, `suggestions.ts:160`, `QuestDetailPage.tsx:263`, `QuestRequirementsEditor.tsx:55,57,60`, `QuestResultsEditor.tsx:63`; server: `db.ts:123`, `routes/drafts.ts` (`suggestionsBody`, `parseDraftFilters`, `rebuildFromSettings`, `DraftsRouterOptions`), `census.ts` (5), `services/drafts.ts` (6), `extraction.ts` (3), `questEvidence.ts`, `questScaffold.ts:556`, `sync/cli.ts:210` | unneeded `export` | exported, 0 importers, but **used in their own file** | **KEPT** — not dead code (each is referenced in-file; the scan's self_refs ≥ 2); exporting labels, prop types and signature types is the codebase's convention (e.g. the `*_LABEL` constants the single-home test reads as source text), and dropping the keyword is zero-behaviour churn. Tier-1 specs hard-code user-visible strings (`'Rebuild drafts'`) by design | — |
| K3 | e.g. `drafts.ts` `insertSuggestions`/`proposeDrafts`/`zonePathOfWad`/`namePredecessor`, `extraction.ts` `screenObservedFields`/`parseSuggestions`, `db.ts` `applyQuestTitleKeyColumnAdds`, `census.ts` `CENSUS_BUILD_HINT`, `quest-overview.ts` `ORDER_*`, `QuestOverview.tsx` `QuestOverviewView` | test-only exports | used outside their file only by tests | **KEPT** — deliberate test seams (pure functions tested without the route/IO) | the importing tests |
| K4 | `client/src/lib/card-titles.ts:50`, `quest-overview.ts:82`, `suggestions.ts:163` | duplication | three new private `isRecord` copies | **KEPT** — the client has no exported plain-object predicate (≈12 private copies predate the phase); the only exported one, `server/src/services/sync/json.ts`, imports `json5` and must never reach the client bundle (D58(b)); a new shared one would touch out-of-scope files | — |
| K5 | `client/src/lib/card-titles.ts:55` | duplication | `text()` (non-empty trimmed string) equals the private `text()` at `client/src/lib/extract.ts:272` | **KEPT** — a one-liner; sharing it would couple the card-title module to the extraction module | `tests/unit/card-titles.test.ts` |
| K6 | `client/src/lib/quest-overview.ts:172` vs `client/src/lib/card-titles.ts:119` | suspected duplication | `tagSpeaker` vs `personaSpeaker` | **KEPT** — not the same algorithm: `tagSpeaker` reads one dialog tag's group and ends with an `NPC n` rung; `personaSpeaker` reads every group of a goal and has a goal-`m_personaName` rung. Merging changes output | `quest-overview.test.ts`, `card-titles.test.ts` |
| K7 | `client/src/lib/advanced.ts:151-154` | duplication (minor) | inline "object with a string `$type`" check, also inline in 3 pre-existing files | **KEPT** — a one-line pattern with no helper anywhere; consolidating touches out-of-scope files | `tests/unit/quest-tiers.test.ts` |
| K8 | `NpcPage.tsx:168,190`, `DraftEditorPage.tsx:54`, `QuestDetailPage.tsx:523,546`, `suggestions.ts:117` | duplication | `/quests/${encodeURIComponent(…)}` built inline (4 more pre-existing copies; no `questPath()` exists, unlike the new `npcPagePath`) | **KEPT** — introducing the helper rewrites 4 out-of-scope pre-existing files; recorded as a Phase 8 candidate | `tests/ui/p7-npc-page.spec.ts`, `p7-drafts.spec.ts` |
| K9 | `client/src/lib/card-titles.ts:49,54` | restating comment | one-line JSDoc on two one-line helpers | **KEPT** — the file documents every function in one line; nothing stale | — |
| K10 | `scripts/build-drafts.ts:49,76-83` | duplication | `parseArgs` near-copy of `scaffold-quest.ts:55`; the "Refusing to pick a database implicitly" guard repeated | **KEPT** — Phase 6's S4 disposition (arg parsers are staged as their own change, not folded into a gate). The guards differ on purpose: each names exactly the env vars its own resolver reads (`resolveDbFile` vs `resolveSyncDbFile`, which also reads `SPIRALDB_SYNC_DB`) | `typecheck:scripts` |
| K11 | `scripts/scaffold-quest.ts:160-173` | duplication | `git rev-parse --verify refs/heads/…` beside `GitService.branchExists` (`git.ts:447`) | **KEPT** — PR #14 finding 2 / D195(b) records exactly this split (the CLI asks git directly; it runs without a `GitService`) | `tests/unit/quest-scaffold.test.ts` "exempts main only for a branch that does not exist yet" |
| K12 | `server/src/services/sync/speakerLadder.ts:30-45` | duplication | reads `QuestTemplates/*.json` by hand instead of the drafts builder's `SpiraldbIndex` walk | **KEPT** — it counts `unreadable` files, which the index walk does not report; switching changes the reported numbers | `tests/unit/speaker-ladder-counts.test.ts` |
| K13 | `server/src/services/census.ts:63-130` | duplication | binary-path / build-hint / not-found plumbing parallels `extraction.ts` | **KEPT** — two different binaries with different hints; it already reuses `buildChildEnv`, `defaultExecFile`, `DEFAULT_MAX_BUFFER_BYTES` | `tests/unit/census-service.test.ts` |
| K14 | `server/src/routes/drafts.ts:118` | duplication | a fourth per-router `fail()` error mapper | **KEPT** — the existing per-router pattern (`quests.ts:156`, `objects.ts:90`) | `tests/unit/p7-drafts.test.ts` route arms |
| K15 | `server/src/services/questEvidence.ts:8` | boundary | server imports `client/src/lib/display.js` | **KEPT, out of scope** — the line is not in the diff's added lines; it is Phase 6's V5, already dispositioned (`docs/evidence/final-deslop-d1-disposition.md` V5) | `tests/unit/display-single-home.test.ts` |
| K16 | `tests/ui/p7-label-scan.spec.ts:276,313,314,344,417` | debug output? | `console.log` in a spec | **KEPT** — the scan's report is evidence: quoted RAW in `docs/evidence/phase-7/p7-10-scan.txt`, `p7-11-test-ui.txt`, `p7-14-test-ui.txt` | that spec |
| K17 | `questFile` (`p7-accept.test.ts:59`, `p7-drafts.spec.ts:180`, `p7-suggestions.test.ts:417`); `changedLines` (`p7-accept.test.ts:129`) / `lastCommitChangedLines` (`p7-drafts.spec.ts:183`); `openAdvanced` (`quests-goals-editor.spec.ts:327`, `quests-results-editor.spec.ts:400`); the `main_`/`saveButton` families | duplicated test helpers | small helpers repeated | **KEPT** — not identical: `questFile` copies resolve against different roots (temp repo / clone / fixture), the two `changedLines` run through different git helpers (`repo.git` vs `cloneGit`), the `openAdvanced` copies differ (an early return when no Advanced exists); `main_`/`saveButton` predate the phase (one copy each added) | the specs themselves |
| K18 | `tests/unit/p7-observed-fields.test.ts:51`, `p7-suggestions.test.ts:107` | duplication | `LISTED_GOAL_TYPES` twice | **KEPT** — one line each, each with its own QuestBuilder citation; outside F9's shared fixture surface | the two suites |
| K19 | `tools/PacketReaderCli/Program.cs:316-335` vs `ObservedFields.cs:294,317,330` | duplication | `Envelopes` and `ReadFieldString`/`ReadFieldInt` overlap ObservedFields' readers | **KEPT** — `Program.Envelopes` predates the phase; `ReadFieldInt` also accepts whole-number floats, which `ReadInteger` does not (merging changes behaviour and would need a golden re-run) | `verify:captures`, p7 goldens |
| K20 | `Describe(Exception)`, `TryParseArguments`/`TryTakeValue` in FixtureGen and PacketReaderCli | duplication | same helper names in two tools | **KEPT** — separate assemblies; sharing needs a new shared project | — |
| K21 | `shared/glossary.ts:1578` `fieldValueTerm`; `client/src/lib/term.ts:28` | dead in production + duplication | `fieldValueTerm` has no production caller (test-only, `glossary.test.ts:298-299`), and `valueTermOf` repeats its `ENUM_OF_FIELD` lookup | **KEPT** — deleting it deletes its test arm (a loosening by this pass's rules); the two return different things (an entry vs a `TermRef`). Phase 8 candidate: `valueTermOf` could resolve through one shared lookup | `tests/unit/glossary.test.ts`, `tests/unit/term.test.ts` |
| K22 | `client/src/components/shared/ReadOnlyEnumValue.tsx:22` | note | `ENUM_OF_FIELD[fieldKey]` without the `hasOwnProperty` guard `term.ts`/`glossary.ts` use | **KEPT** — a guard would change behaviour for a key like `constructor` (no caller passes one: every caller passes a document key); recorded, not "cleaned" | — |
| K23 | `tools/FixtureGen/Inject.cs:292` | compiler warning | CS8602: `decoded.m_loot` is dereferenced after `decoded?.m_goldInfo?.m_goldAmount != gold`, so a `null` decode with a `null` planted gold would throw instead of reporting a mismatch | **KEPT** — making it `decoded?.m_loot` turns a crash into a reported mismatch, which is a behaviour change (on a path no committed spec reaches: every Rewards spec plants gold or a decodable blob). Phase 8 candidate | `npm run build:fixturegen` (warning visible), `verify:captures` reproducibility arm |
| — | `scripts/*` `console.log` (build-drafts, glossary-spotcheck, audit-corpus-roundtrip, imlight-boot) | debug? | console output | **KEPT** — CLI output, the scripts' interface | — |

Clean categories (measured): unused locals/params **0** in all four tsconfigs; `debugger`/`.only`/`page.pause`/TODO/FIXME/HACK
in added lines **0**; client→server / json5-in-client imports **0** (and `JSON5` occurs in **0** built client chunks);
`shared/` imports only inside `shared/` (`glossary.ts` has zero imports, D171); 249/249 glossary citations valid
(`node scripts/glossary-spotcheck.mjs --quiet`, read-only). No spec file was edited, so no `--fix` run was needed.

## Changes made (working tree, uncommitted)

```
 client/src/components/quest/QuestOverview.tsx |  6 ++---
 client/src/lib/api.ts                         |  2 +-
 client/src/lib/quest-overview.ts              | 28 +++++++++++---------
 client/src/pages/QuestDetailPage.tsx          |  4 +--
 server/src/services/drafts.ts                 |  5 ----
 server/src/services/extraction.ts             | 12 ++++-----
 server/src/services/questScaffold.ts          |  2 +-
 tests/unit/p7-capture-census.test.ts          | 33 +++++++----------------
 tests/unit/p7-drafts.test.ts                  | 11 ++++++--
 tests/unit/p7-observed-fields.test.ts         | 37 +++++++-------------------
 tests/unit/p7-suggestions.test.ts             | 38 +++++++--------------------
 tools/CaptureCensus/Program.cs                | 12 ++++-----
 12 files changed, 68 insertions(+), 122 deletions(-)
```

Plus the new file `tests/helpers/p7-fixtures.ts`, and `docs/plan-overview.md` (Phase 7's phase-log row, below).

## Phase log row (gate-7 bookkeeping)

Facts from `gh pr view 14 --json number,title,headRefName,baseRefName,mergeCommit,mergedAt,state,mergedBy,statusCheckRollup --jq '{number,title,headRefName,baseRefName,state,mergedAt,merge:.mergeCommit.oid,mergedBy:.mergedBy.login,ci:[.statusCheckRollup[]|{name,conclusion,startedAt,completedAt,detailsUrl}]}'`
(read-only):

```
{"baseRefName":"main","ci":[{"completedAt":"2026-09-30T23:25:03Z","conclusion":"SUCCESS","detailsUrl":"https://github.com/jasonl8446/spiraldb-ui/actions/runs/36790154268/job/110140892550","name":"ci","startedAt":"2026-09-30T23:15:50Z"}],"headRefName":"phase-7-coverage-usability","merge":"7c2e9870c41cb675b270e43c6d13bc650a70f1e4","mergedAt":"2026-10-01T00:49:56Z","mergedBy":"jasonl8446","number":14,"state":"MERGED","title":"Phase 7: quest coverage and a friendlier editor"}
```

`ci` ran 23:15:50 → 23:25:03 = **9m13s**, job 110140892550 of run 36790154268; merged by the owner (`jasonl8446`),
not by the run. Row added to `docs/plan-overview.md` "## Phase log (merged milestones)" after the Phase 6 row.

## Gates (RAW tails, after the last edit)

Baseline before any edit: `npm test` → `Test Files  107 passed (107)` / `Tests  2201 passed (2201)`; lint and both
typechecks exit 0.

### C# (only `tools/CaptureCensus/Program.cs` changed, a comment)

`npm run build:census`
```
  CaptureCensus -> /home/jason/Documents/git-projects/spiraldb-ui/tools/.artifacts/bin/CaptureCensus/release/capture-census.dll
Build succeeded.
    0 Warning(s)
    0 Error(s)
```
`npm run build:cli` / `npm run build:fixturegen` (exit 0 each). The warnings, by code: NU1900 ×16 (the NuGet vulnerability feed, unreachable offline; on the Imview, PacketReaderCli and FixtureGen project files) and CS8602 ×2 at `tools/FixtureGen/Inject.cs(292,16)` (row K23)
```
  PacketReaderCli -> /home/jason/Documents/git-projects/spiraldb-ui/tools/.artifacts/bin/PacketReaderCli/release/imview-packet-reader.dll
    4 Warning(s)
    0 Error(s)
  FixtureGen -> /home/jason/Documents/git-projects/spiraldb-ui/tools/.artifacts/bin/FixtureGen/release/fixturegen.dll
    5 Warning(s)
    0 Error(s)
```
`npm run verify:captures` (run alone)
```
  dialog entries per container          {2_WizardQuestGoals_Kill/Completion(blocks=1, entries=2), 2_WizardQuestGoals_Kill/Prep(blocks=1, entries=1), 4_WizardQuestGoals_TalkNPC/Completion(blocks=1, entries=1), quest/Completion(blocks=1, entries=1), quest/Prep(blocks=1, entries=3)} {2_WizardQuestGoals_Kill/Completion(blocks=1, entries=2), 2_WizardQuestGoals_Kill/Prep(blocks=1, entries=1), 4_WizardQuestGoals_TalkNPC/Completion(blocks=1, entries=1), quest/Completion(blocks=1, entries=1), quest/Prep(blocks=1, entries=3)}  ok
  reproducibility: fixturegen reproduces the committed bytes  ok

PASS: 5 fixture(s), 55 field check(s), 0 mismatch(es), 0 known-reader-defect row(s).
```
p7 golden vitest (`npx vitest run tests/unit/p7-observed-fields.test.ts tests/unit/p7-suggestions.test.ts tests/unit/p7-capture-census.test.ts`)
```
 ✓ tests/unit/p7-suggestions.test.ts (59 tests) 3980ms
 ✓ tests/unit/p7-observed-fields.test.ts (61 tests) 4297ms
 ✓ tests/unit/p7-capture-census.test.ts (57 tests) 3325ms
 Test Files  3 passed (3)
      Tests  177 passed (177)
```

### npm test
```
 Test Files  107 passed (107)
      Tests  2201 passed (2201)
   Start at  21:00:26
   Duration  91.09s (transform 1.97s, setup 0ms, collect 8.31s, tests 65.58s, environment 14ms, prepare 4.51s)
```

### npm run lint

Re-run after this file and the phase-log row were written: exit 0, the same tail.
```
> eslint . && prettier --check .

Checking formatting...
All matched files use Prettier code style!
```

### npm run typecheck:tests
```
> spiraldb-ui@0.1.0 typecheck:tests
> tsc -p tests/tsconfig.json --noEmit
```
(exit 0)

### npm run typecheck:scripts
```
> spiraldb-ui@0.1.0 typecheck:scripts
> tsc -p scripts/tsconfig.json --noEmit
```
(exit 0)

### npm run build
```
dist/index.html                                  0.51 kB │ gzip:   0.33 kB
dist/assets/QuestGoalLogicEditor-BnuhLJ6X.css   15.87 kB │ gzip:   2.67 kB
dist/assets/index-X8bZiLvC.css                  37.25 kB │ gzip:   7.70 kB
dist/assets/QuestGoalLogicEditor-DCO5Shuc.js   198.48 kB │ gzip:  64.37 kB
dist/assets/index-_DNt1LD3.js                  992.11 kB │ gzip: 292.69 kB

(!) Some chunks are larger than 500 kB after minification. Consider:
- Using dynamic import() to code-split the application
- Use build.rollupOptions.output.manualChunks to improve chunking: https://rollupjs.org/configuration-options/#output-manualchunks
- Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
✓ built in 3.54s
```

### npm run test:ui (FULL tier-1)
```
  ✓  470 [chromium] › tests/ui/responsive.spec.ts:932:5 › §7 P5 additions: the ⌘K palette fits every breakpoint › 768px: the palette is centred and inside the viewport (938ms)
  ✓  471 [chromium] › tests/ui/responsive.spec.ts:932:5 › §7 P5 additions: the ⌘K palette fits every breakpoint › 1440px: the palette is centred and inside the viewport (870ms)

  471 passed (5.6m)
```
471 = the count PR #14's fix pass ended on (`pr14-review-fixes.md`). The D17 clone after every run: `git status --short`
empty, HEAD `18dc924`.

### Bundle and glossary checks
```
$ grep -l JSON5 client/dist/assets/*.js | wc -l
0
$ node scripts/glossary-spotcheck.mjs --quiet

249 entries, 249 cite a line that names the term, 0 do not.
```
