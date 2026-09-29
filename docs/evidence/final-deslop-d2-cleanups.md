# final-deslop D2 — the cleanups

Story: **final-deslop / Ultragoal final gate 1/3** (AC1, the `ai-slop-cleaner` pass), the writer half.
Tree: `final-gate`, cut from `origin/main` @ `0afb308` (the Phase 6 merge) + this pass's working-tree
edits. **Nothing is committed and nothing is staged** — the lead verifies and commits (D84(a)); no
git write was made. The specification is `docs/evidence/final-deslop-d1-disposition.md` (the lead's
triage of five read-only area scans) **plus** a sixth scan (`client/src`) the lead delivered mid-run
as rows **C1–C6**.

> **This file supersedes the previous pass's D2.** An earlier, smaller `final-deslop` pass (tree
> `main` @ `1bac35c`, findings F1/F2/the 15 dead exports) wrote this path; its record is preserved in
> git history at `1bbbda3`. This pass is over the Phase 6 diff (16 commits / 177 files / +33,212 /
> −257) and its disposition list is the current D1. The same pattern applies to `-d3-proof.md`.

Every item below uses a CLEAN row's own wording as its specification. No `docs/spec-*.md`,
`docs/plan-*.md`, `AGENTS.md`, `data/**`, `.omd/**`, sibling repository or
`client/src/components/ui/**` file was touched, and the only files written under `docs/evidence/` are
this one and `-d3-proof.md`.

## 1. The diff shape

**42 tracked files changed (30 source/test/doc-config, the rest the lead's own `docs/` edits), 5 new
files, `+755 / −622`.**

| area | files | rows |
|---|---|---|
| scripts | `imlight-boot.ts`, `quest-corpus-census.mjs`, `quest-refs-report.ts`, `wad-census.mjs`, package.json, **new** `scripts/tsconfig.json` | S1–S3, S5–S10 |
| server | `npcNames.ts`, `questEvidence.ts`, `questScaffold.ts`, `search.ts`, `sync/{execute,index,questCatalog,questRefs}.ts` | V2–V4, V7, V9–V12 |
| client | `lib/display.ts`, `lib/quest-catalog.ts`, `hooks/useObjectFriendlyName.ts`, `components/quest/{CoverageHeader,EvidencePanel,QuestJsonPanel}.tsx`, `pages/QuestDetailPage.tsx` | C1–C6 |
| tests | 13 unit files + 5 tier-1 specs + `tests/tsconfig.json`, **new** `tests/helpers/{clone-fixture,seed}.ts`, **new** `tests/unit/{object-friendly-name,scaffold-quest-cli-guard}.test.ts` | T1–T12 + the S8 arm + the C/T arms |

(The two `docs/` entries in that diffstat — `final-deslop-d1-disposition.md` and `plan-overview.md` —
are the **lead's** edits; I did not touch either.)

Worked in the skill's order: dead code first (V2/V4/V10/V11/V12, T8, T12, S8's dead surface), then
duplication (S5/S7/S9/S10, T1/T2/T6/T9/T10/T11, V3/V7/V9, C5/C6), then naming and error handling
(S2/S3/S6, C1/C2/C6), then test reinforcement (T3/T4/T5, S8, C3/C4).

## 2. Every CLEAN item

### scripts

- **S1 — `tools/.imlight-artifacts/` gitignored.** `.gitignore`: one block beside the D18 entries.
  `git check-ignore -v tools/.imlight-artifacts/x` now answers `.gitignore:24:tools/.imlight-artifacts/`
  (it answered nothing before). The path is **not** renamed — `p6-12-freshness.txt:42` and
  `p6-12.md:248` still quote it verbatim.
- **S2 — the missing `count` exit arm.** The header now documents `6` as *the count did not rise by
  exactly one* **or** *the clone did not restore*; `prove-count` gained
  `if (!run.proof.ok) { … process.exit(6) }` after the evidence file is written and after service
  cleanup. **Before:** a failed count proof printed `verdict FAIL` and exited **0**.
- **S3 — unknown flags refused.** `parseFlags` validates each parsed key against a new `KNOWN_FLAGS`
  list and calls `usage()` (rc=2), naming the flag. **Before:** any `--key` was stored, so a typo'd
  `--restore-clonee` skipped the clone restore **and exited 0**, leaving the D17 clone dirty.
- **S5 — the seven families re-listed.** `imlight-boot.ts` imports `NON_QUEST_FAMILIES` from
  `imlightHarness.ts` and drives the report from it; the `as unknown as Record<string, number>` cast
  is gone (both surfaces are typed off `SpiralDbLoadLine`).
- **S6 — two false comments + the valueless flag.** `quest-corpus-census.mjs`: the "same lenient read
  the app uses" claim is replaced by an explicit statement that this is a trailing-comma **regex**,
  not JSON5, and that `UNPARSABLE` therefore means "this regex could not read it"; "no dependencies
  beyond node's own" corrected (it imports `better-sqlite3`, optionally); `argValue()` now **refuses**
  (rc=2) a flag given without a value instead of silently measuring the default corpus.
- **S7 — the inline fork path.** `quest-refs-report.ts` imports `DEFAULT_SPIRALDB_PATH`
  (`server/src/db.ts`) as the `settings.spiraldb_path` fallback; the literal is gone. Identical value,
  zero behaviour change.
- **S8 — the "agree byte for byte" claim is now a test.** New arm in `tests/unit/wad-index.test.ts`
  comparing `wad-census.mjs`'s `parseIndex` against the app's `readWadIndex` on the committed v1 **and
  v2** fixtures, field by field (v2 is where a padding-byte divergence would show; the corpus holds
  zero v2 archives). The instrument is proven non-vacuous in the same arm: 4 and 2 entries, and the
  two projections asserted **unequal**. The file is **not** renamed. Enabling changes in §3.
- **S9 — two missing aliases.** `package.json`: `wad:census` (`node scripts/wad-census.mjs`) and
  `verify:wad-index` (`tsx scripts/wad-index-verify.ts`), additive.
- **S10 — `scripts/**/*.ts` type-checked.** New `scripts/tsconfig.json` (server's compiler options,
  `noEmit`) + a `typecheck:scripts` script. **Green on the first run**: the nine `scripts/*.ts` files
  are in the program (`tsc --listFiles`) and produce zero errors. Sensitivity was proven *before*
  trusting the clean result: a throwaway `scripts/__negcontrol.ts`
  (`const unusedLocal: number = "not a number"`) was reported as
  `scripts/__negcontrol.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.` and
  then deleted; the clean re-run is rc=0. It also caught a real leftover from my own V4 edit (an
  unused `target` binding) — the same class of dead binding the row says CI could not see.

### server

- **V1 — NOT DONE, deliberately.** Kept the field. See §4; the aggregate the caller consumes does not
  surface all three fall-through classes the doc-comment names, so the brief's pre-condition failed.
- **V2 — the private `isPlainObject`.** `questEvidence.ts` imports `isPlainObject` from
  `./sync/json.js` (byte-identical body) and its private copy is deleted.
- **V3 — `personaObjectName` one home.** `npcNames.ts` imports the exported one from
  `./sync/personaIndex.js` and its no-trim private copy is deleted; the `.trim()` is the widening the
  row names. The NPC view and persona-index suites stayed green.
- **V4 — the duplicate guard.** `scaffoldQuest` called `questTemplateTargetPath(...)` — which asserts
  the target it returns as its last act — and then asserted the same target again. The second call is
  deleted and the first stays the writer's first statement; the returned path was never read (the
  pipeline resolves it again from `(fileType, key)`), so the honest edit is the call kept as a
  statement. That unused binding was surfaced by the new `typecheck:scripts`/`build:server`.
- **V7 — the join columns derived.** `search.ts` builds each `*_NAME_JOIN` through one local
  `nameJoin(spec, keyIsInteger)` reading `spec.idColumn`/`spec.labelColumn` from
  `NAMES_TYPE_SPECS.quests` and `FRIENDLY_SOURCE_SPECS.{npcs,zones,decks}`; the hand-copied column
  names are gone, `keyIsInteger` stays local (a fact about the comparison, not the table). The search
  suite is the guard and is green.
- **V9 — the duplicate category list.** `NPC_KEY_CATEGORY_ORDER` (a literal copy of
  `NPC_ALIAS_CATEGORIES` eleven lines away) is deleted; the ranking reads `NPC_ALIAS_CATEGORIES`, and
  the vocabulary's doc-comment now states that its order **is** the priority. One cast is needed
  (`as readonly string[]`) because a tuple's `indexOf` wants the literal union. The **spelling swap**
  (adding the 5-row spaced spelling, dropping the 0-row one) is a DISPOSITION row and was not done.
- **V10 — the phase's barrel block deleted.** The 22-line `questCatalog.js` re-export block is gone
  (verified 0 importers — the barrel's only two consumers, `sync-dry-run.ts` and
  `lang-collision-survey.ts`, import pre-phase names), as is the single `formatCatalogSummary` line
  added to the `cli.js` block in the same hunk. The barrel's module doc-comment keeps the phase's
  accurate pipeline description.
- **V11 — two dead surfaces.** `extractQuestRefs` (the array-in wrapper, called only from tests) is
  deleted from `sync/questRefs.ts` with its `{@link}` references;
  `tests/unit/quest-refs.test.ts` gains a four-line **test-local** walk over the producer's own
  `add`/`finish` interface, so its 13 call sites still read as call sites and the producer keeps only
  the streaming API (the shape the 97.7 MB NDJSON needs). `EvidenceReference`'s `resolved.label` is
  deleted (no production reader; it also made `friendlyNameOf` run twice per reference) and its
  comment corrected — see §4 for the one test that *did* pin it.
- **V12 — three one-line deletions: two done, one not located.** (a) The duplicate
  `breadth = collectedBreadth` in `sync/execute.ts`: I deleted the **second**, because the catch block
  returns `breadth.report` and the first assignment is therefore live on the failure path (deleting
  the first would have changed the failed-sync report). (b) The `scalar` one-liner declared twice
  inside `writeQuestCatalog`: hoisted to one declaration at the top of the function; both returns use
  it. (c) The orphan doc-comment left by a removed property — **not located** (two mechanical scans,
  §4).

### tests

- **T1 — one home for the five coverage numbers.** `MOCK_COVERAGE` is imported by `a11y.spec.ts`,
  `extraction.spec.ts` and `shell.spec.ts` (the three character-identical copies are gone), and
  `responsive.spec.ts` uses `{ ...MOCK_COVERAGE, corpus: { ...MOCK_COVERAGE.corpus, spiraldb_path:
  '<the longest real path>' } }` — its single deliberate long-path override kept as a spread. A grep
  for `nameable: 1717` in `tests/ui/*.spec.ts` is now empty.
- **T2 — the shared clone plumbing (safe subset).** New `tests/helpers/clone-fixture.ts`: `CLONE`,
  `CLONE_QUEST_FILES = 322`, `cloneGit`, `CloneAxes`, `questFileCount`, `cloneAxes`,
  `resetClone(point)`. `quest-scaffold.test.ts`, `quest-edit-isolation.test.ts` and
  `quest-evidence-insert-isolation.test.ts` import it and their byte-identical bodies are deleted
  (including `restoreClone`'s identical copy, now `resetClone(restorePoint)` at each suite's own
  restore point). **The two readiness predicates stayed per-suite**, as the row requires: each names
  the files its own arms need, and it is the only guard standing between a run and somebody's work in
  progress. The now-unused `execFileSync`/`fileURLToPath` imports went with the bodies.
- **T3 — the real type guard.** `tests/unit/evidence-insert.test.ts`: the forward arm is kept and the
  reverse direction added — `@ts-expect-error` on
  `const listVocabulary: QuestEvidence['quest']['title_source'] = 'rawKey'`, followed by a runtime
  assertion that the wrong-vocabulary value yields no badge. Because an unused directive is itself an
  error, widening the field to `string` now fails `typecheck:tests`; **proven** by temporarily making
  the literal assignable (`= 'inferred'`) → `error TS2578: Unused '@ts-expect-error' directive`, then
  reverting.
- **T4 — the D119 guard locked.** New `tests/unit/scaffold-quest-cli-guard.test.ts`, spawn-only: with
  a minimal environment (no `SPIRALDB_UI_DB`/`SPIRALDB_SYNC_DB`/`SPIRALDB_PATH`/`NODE_ENV`) the CLI
  exits **2** with the refusal sentence, its two escape hatches and the reason; the **positive
  partner** names a scratch database and shows the same command proceeds past the guard (rc≠2, no
  refusal, its own 404 from the empty scratch catalog). Neither arm can open `data/spiraldb-ui.db`
  (the guard precedes `openDb`; both point the write at a scratch root).
- **T5 — `useObjectFriendlyName` covered.** New `tests/unit/object-friendly-name.test.ts`, plain-node
  `renderToStaticMarkup` with a **primed** query cache (no jsdom, no fake module, nothing over the
  network — `staleTime: Infinity` serves the primed row on the first render): the `npcs` and `zones`
  branches return the friendly half *and* assert the query key each asked for; `decks` returns `null`
  and asks for no `decks` key (D112's deliberate miss); a family with no friendly source returns
  `null`. Plus the tier-1 companion, C4 below.
- **T6 — the fixture imported where it is just the fixture.** `a11y.spec.ts` uses
  `MOCK_CATALOG_ROWS` (its rows were exactly the fixture's two, same spelling).
  **`shell.spec.ts` and `responsive.spec.ts` were left alone** as the row directs: both navigate to
  `/quests/DS-ACAD-C01-001` and `/quests/catalog`, so their rows carry the older placeholder ~40
  pre-existing arms address — unifying the spelling there would be the drift, not the fix. A new
  consumer exists, so the export is no longer dead.
- **T7 — the wrong citation.** Both `D89(c)` occurrences in `tests/unit/evidence-panel.test.ts` now
  read `D90(c)`. The evidence-file half is **not done** (§4).
- **T8 — the two dead exports.** `stripComments` and `panelWriteViolations` in
  `evidence-panel.test.ts` lost their `export` keyword (both are used locally; nothing imported
  either), with a note naming `tests/helpers/source-text.ts`'s `codeOf` as the repo's shared home and
  the regex difference that makes merging them a DISPOSITION row. The merge was not attempted.
- **T9 — the magic `322`.** `quest-evidence-insert-isolation.test.ts` asserts
  `toBe(CLONE_QUEST_FILES)` (the exported constant, whose doc-comment carries the D80(c)
  "re-measured knowingly" intent) and the redundant `toBeGreaterThan(0)` — which could never fail
  after a `toBe(322)` — is deleted.
- **T10 — `tests/helpers/seed.ts`.** `seedString(db, key, value, category)` and
  `seedNpc(db, templateId, name)`, imported by `quest-evidence.test.ts` and `npc-names.test.ts`; both
  byte-identical pairs are deleted. The **variant** signatures were left alone
  (`quests-api.test.ts`'s 3-arg `seedString` hard-codes its category; `search.test.ts` and
  `objects-api.test.ts` predate this phase).
- **T11 — the predicate import.** `quest-evidence-insert-isolation.test.ts` and
  `quest-edit-isolation.test.ts` import `isPlainObject` from `tests/helpers/roundtrip-fidelity.ts`
  and their byte-identical private copies are deleted. The **walker** unify is a DISPOSITION row and
  was not attempted.
- **T12 — five dead exports.** `tests/helpers/wad-fixture.ts`: `WadFixtureEntry`, `WadFixtureSpec`,
  `BuiltEntry`, `BuiltWad`, `storedZlibStream` lost `export` (the module has one consumer, which
  imports five other names). The module is kept, stored-block zlib note included.

### client (the sixth scan, C1–C6)

- **C1 — the `X (X)` pair on the names-API path.** `lib/display.ts`: `formatNameRow`'s `quests` case
  routes through `namePairDistinct` (one line), with the measured reason inline
  (`title = quest_name` is the common catalog shape, not an edge). Unit arm added to
  `tests/unit/ui-shell.test.ts`: identity → the name alone, `not.toContain(' (')`, and the
  non-identity neighbour still pairs.
- **C2 — the Catalog's repeated Title cell.** `catalogTitleText`'s `Pick` gained `quest_name` and
  collapses the identity case, so `CATALOG_NO_TITLE` (`—`) is reachable. Unit arms in
  `tests/unit/quest-catalog-view.test.ts` (identity → `—`; the linked neighbour still prints its own
  title) plus the tier-1 arm below. The one existing call in the same test gained `quest_name`.
- **C3 — the identity shape in fixtures, and the unreachable empty state.** Two tier-1 arms in
  `tests/ui/quests-catalog.spec.ts`: (a) `?missing_only=1` with `nameable > 0` and an empty row set
  renders `CATALOG_NO_MISSING` with **no** sync link — the first arm anywhere to render that state;
  (b) a **new explicit identity row** (declared in the arm, **not** added to the shared
  `MOCK_CATALOG_ROWS`) asserting the Name cell is the name and the Title cell is `—`.
- **C4 — the detail header's pair.** `ObjectDetailLayout`'s `namePair` is now asserted: the
  `object-list.spec.ts` mock grew a `singleNames` option (registered **after** the
  `**/api/names/npcs*` list route, which Playwright matches in reverse registration order), and a new
  arm navigates to `/npc-inventories/2001` with a real row and asserts `Merle Ambrose (2001)` in the
  header. `NewObjectControl`'s "Known as" line was left (see §3).
- **C5 — five section shells collapsed.** `EvidencePanel.tsx` gained one local
  `EvidenceSection({ heading, empty, isEmpty, refusal, children })`; the four later shells
  (`Dialogue`, `Gates`, `References`, `Warnings`) and `TextSection` now render through it, so the
  `<section aria-label>` + `── heading ──` + refusal-`p` (including the
  `evidence-refusal-${heading}` testid) exist once. `TextSection`'s prose and its grouped/ungrouped
  branches are kept. **The DOM is unchanged** — the tier-1 arms that locate the panel by role and
  text (including all of `quests-evidence-panel.spec.ts`) are green.
- **C6 — the four one-concept/two-spelling items.** (1) `useObjectFriendlyName.ts` uses
  `NAMES_TYPES` and its local `NAMES_API_TYPES` is deleted — the `decks` skip survives because
  `ObjectFriendlyNamesType` is the narrower type, and the new unit arm asserts `decks` asks for
  nothing. (2) `QuestDetailPage.tsx` no longer passes `title` to `QuestJsonPanel`; the panel derives
  the `aria-label` from `tab` exactly as before, so the bytes are unchanged (both now-unused
  constants were dropped from that import with it). (3) `coverageRatio(defined, nameable)` is
  exported from `lib/quest-catalog.ts` and `coveragePercentLabel` is built on it; `CoverageHeader`
  computes the ratio **once** for the bar and the label, so the `nameable > 0` guard has one home.
  (4) The rail tabs: `QuestJsonPanel`'s `RAIL_TABS` is built from `RAIL_TAB_EVIDENCE`/`RAIL_TAB_JSON`
  and all 16 literals in `QuestJsonPanel.tsx`/`QuestDetailPage.tsx` use the constants, so the pair has
  one spelling and `RAIL_TAB_JSON` has a reader.

## 3. Done differently (and why)

1. **S8 needed a 4-line enabling change.** `wad-census.mjs` called `main()` at module scope, so a
   test could not import `parseIndex`. It now runs `main()` only when
   `path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)`; verified both ways —
   `node scripts/wad-census.mjs --help` still prints the usage and exits 0, and
   `import('./scripts/wad-census.mjs')` resolves `parseIndex` without running the census.
2. **`tests/tsconfig.json` gained `allowJs: true`** (reason in a comment). Without it the `.mjs`
   import is `TS7016`-untyped and the comparison would be unchecked; `checkJs` stays off, so no JS
   file is type-checked, and `include` still names only `**/*.ts`.
3. **T4 lives in a new file** (`tests/unit/scaffold-quest-cli-guard.test.ts`) rather than inside
   `quest-scaffold.test.ts`: the row's complaint was `grep -rl scaffold-quest tests/` being empty, and
   a spawn-only CLI arm shares nothing with that suite's service-level `:memory:` arms.
4. **V12(a) deleted the second store, not the first** — the first is live on the catch path (§2).
5. **V4's edit keeps the guard call as a statement**, because the returned path was dead (§2).
6. **C4's "Known as" arm not added** — the row marked it optional ("worth one too if it is cheap").
   `NewObjectControl` renders it only after a key is typed into the new-object form, which needs its
   own route answers and a form interaction beyond the existing arms; reported as remaining rather
   than added thin.

## 4. Not done, with the reason — and where the lead should look

| row | status | reason |
|---|---|---|
| **V1** | **kept the field; comment untouched** | The brief's pre-condition failed. The comment names **three** fall-through classes ("an override key the string table does not hold", "a composition the persona's components cannot fill", "a persona absent from the manifest index"), but the aggregate the caller actually consumes (`fallbacks` → `warnings` in `buildNpcView`) is populated **only** when `resolution.missingPersona` — class 3, and only for a non-empty persona. A class-1 or class-2 fall-through that a later rung then answers (rung 3's template name) leaves `source: 'template'`, `warning: null`, no counter and no warning line. Deleting the field would therefore remove the only record of class 3's sentence while classes 1–2 stay silent either way. **This is a live finding, not only a cleanup miss**: the three classes are not uniformly visible in the response. The lead should decide between a per-class counter (a response change / D-item) and a corrected comment. |
| **V12(c)** | not located | Two mechanical scans over every `.ts`/`.tsx`/`.mjs` found no orphan doc-comment: (i) a `*/` followed only by blank lines and then `}` / `)` / `];`; (ii) a `*/` followed by another comment block. No changed server file carries prose about a removed property either. The two precise deletions in that row were made; this third one is reported rather than guessed. |
| **T7 (evidence half)** | not done | The row asks for the same wrong citation annotated in **two evidence files**. Only **one** exists — `docs/evidence/phase-6/p6-08-tier2.md:129` (`trusted (D89(c)).`) — a repo-wide grep for `D89(c)` (md/ts/tsx) returns exactly that line plus the two test arms, and `docs/evidence/**` is on my "do not touch" list, so the annotation is the lead's. The two test arms are fixed. |
| **T6 (second half)** | done differently | Imported in the one spec where the rows are just the fixture; `shell.spec.ts` and `responsive.spec.ts` deliberately keep their `DS-ACAD-C01-001` rows, as the row requires. |

### DISPOSITION rows left alone (the scope check)

Every row the lead marked `DISPOSITION` was left **untouched**, deliberately:

- **S4** — the seven hand-rolled arg parsers stay; only S6's valueless-flag edge was cleaned.
- **S11** — `quest-catalog-verify.ts`'s in-CLI assertions stay (no `planVerifySteps()` extraction).
- **S12**, **S13**, **S14** — `tools/` C# untouched: no `.NET` build, no NDJSON determinism re-run.
- **T8 (the stripper merge)**, **T11 (the walker unify)** — the third comment-stripper and the three
  document walkers stay; only the two dead exports and the `isPlainObject` import were cleaned.
- **V5** — `questEvidence.ts` still imports `client/src/lib/display.js`. I also did **not** add the
  guard arm the row pairs with the decision: that arm ("`display.ts` is dependency-free") is not in
  the CLEAN column, and inventing a partial deliverable for a recorded decision is exactly what the
  row's "recorded as a decision **plus** a new guard" wording defers to the lead.
- **V6**, **V8**, **V9's spelling swap**, **T2's readiness parameterisation**.

Also untouched, as the disposition's §2 lists: the 36-key corpus order, `fileParallelism: false`,
`memoryDb()`, the injection seams, the falsification arms, `client/src/lib/quest-info.ts`'s duplicate
list and `shared/objectTypes.ts`'s `friendlyNameNote` counts. The lead's C6 "Do NOT touch" list was
honoured too: the two inferred-badge spellings, the four `text-[10px]`/`text-[11px]` sizes, the
missing `/npcs/:npcId` page, and everything under "considered and left alone".

## 5. Contradictions with D1 or with the code I read

1. **V1's premise is the significant one** (§4): the aggregate does not surface the three classes the
   comment names. D1's row reads as a straight dead-code deletion.
2. **V11's "read nowhere (0 grep hits)" is true of production, not of the tree.**
   `resolved.label` **was** pinned by one unit assertion — `tests/unit/quest-evidence.test.ts` asserted
   the whole `resolved` object with `label` in it at three sites. The field had no production reader,
   so the row's substance holds, but the count under-reports and those three assertions had to be
   updated to the new shape. **No assertion was weakened:** `display` is still asserted exactly at all
   three sites.
3. **V4's "delete the line" leaves the *binding* dead, not the call.** `scaffoldQuest` never read the
   returned path (the pipeline resolves it again from `(fileType, key)`), so the honest edit is the
   call kept as a statement. This is the same class of dead binding S10's row says CI could not see —
   and the new `typecheck:scripts` is what surfaced it in my own edit.
4. **V12(c) is unreproducible** from the row's wording (§4).
5. **T7's "two evidence files" is one** (§4).
6. **T6's "three specs hand-roll the same four rows" is three specs hand-rolling *two* rows each**
   (a11y, shell, responsive), and one of those (a11y) agrees with the fixture's spelling while the
   other two deliberately do not. The copy-drift half of the row is real; the "four rows"/"three
   copies of the fixture" framing is not.