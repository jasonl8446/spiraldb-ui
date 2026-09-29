# final-deslop D1 — the disposition list

Story: **final-deslop / Ultragoal final gate 1/3** (AC1, the `ai-slop-cleaner` skill pass). Tree: branch
`final-gate` cut from `origin/main` @ `0afb308` (the Phase 6 merge). Five **read-only** area scanners
(`server/src`, `client/src`, `tests`, `scripts`+`tools`, `shared`+`docs`) produced the candidate list;
**the lead triaged every finding**, so nothing below is an executor's opinion taken on faith. Nothing is
committed by this story until the pass is verified (D84(a)).

## 0. SCOPE — stated first, because a disposition list whose scope is unstated is not one

The cumulative diff at launch is **16 commits / 177 files / +33,212 / −257** (`cd33c85..HEAD`, i.e. main-at-launch → the merge). By top level:

| top level | files | +lines | in scope? |
|---|---|---|---|
| `docs/` | 52 | 7,111 | **No** — spec prose + raw evidence transcripts; a code-slop pass over evidence prose would be theatre (the previous run excluded `docs/` for the same reason). It is still *reviewed*: findings D1–D11 below are doc drift and are fixed or annotated |
| `tests/` | 42 | 11,116 | **Yes** |
| `server/` | 32 | 8,173 | **Yes** |
| `client/` | 29 | 2,616 | **Yes** |
| `scripts/` | 7 | 2,900 | **Yes** |
| `shared/` | 6 | 407 | **Yes** |
| `tools/` | 5 | 853 | **Yes** |
| root configs (`vitest.config.ts`, `package.json`, `.gitignore`, `AGENTS.md`) | 4 | 36 | **Yes** |

**Authored-code surface = 125 files.** Also excluded, and stated: **0 files under `client/src/components/ui/`**
(the vendored primitives, D39) and **no `package-lock.json` change** — the phase added **no dependency**, which
is itself a deslop-relevant fact.

**Method** (all read-only): repo-wide reference counting per exported symbol, byte comparison of duplicate
bodies, module reachability, `git check-ignore` per path, and read-only SQL against the live database for two
claims. `pages.json`-style generated files and `docs/evidence/**` were never edited — a wrong artifact is
**annotated**, never rewritten.

## 1. THE DISPOSITION LIST

| # | area | finding (with the measurement that establishes it) | class | action |
|---|---|---|---|---|
| **S1** | scripts | `tools/.imlight-artifacts/` is **not gitignored** although `rebuildCommand()` *prints* a remedy that builds Imlight's 866 MB output there (`git check-ignore` proves it; the path is a one-off deviation from D18 and no D-item records it) | boundary (D83 `git add -A` class) | **CLEAN** — one `.gitignore` line. Do **not** rename the path: `p6-12-freshness.txt:42` and `p6-12.md:248` quote the string verbatim |
| **S2** | scripts | `imlight-boot`'s header documents exit 6 (`the count did not rise by exactly one`) but the mapping has no `count` arm — a failed count proof exits **5** — while 6 is produced by a **clone-restore** failure the header never mentions | slop (exit codes) | **CLEAN** — add the `count` arm and document 6's second meaning. 0 evidence files or criteria reference these codes |
| **S3** | scripts | Unknown flags are silently accepted: `parseFlags` stores any `--key` and nothing validates them, so a typo'd `--restore-clonee` **skips the clone restore and exits 0**, leaving the D17 clone dirty | slop + data safety (D119's class, one level up) | **CLEAN** — refuse unknown keys with `usage()`; every quoted invocation in the phase's evidence uses only valid flags (enumerated) |
| **S4** | scripts | **Seven** hand-rolled arg parsers with **five** behaviours in one directory (unknown flag: throw/ignore/exit 2; `--help`: exit 0/1/none; valueless flag: silently default/throw) — two of the phase's TS CLIs dump a raw stack trace on a usage error | duplication | **DISPOSITION** — recorded with the measured table. The scan itself recommends *staging* this one rather than folding it into a gate commit; the existing `scripts/lib/quest-roundtrip.mjs` is the natural home. One sharp edge is cleaned anyway: `quest-corpus-census.mjs` silently measures the **default** corpus when its flag is valueless (S6) |
| **S5** | scripts | The seven non-quest families are re-listed twice in `imlight-boot.ts` although `imlightHarness.ts` exports `NON_QUEST_FAMILIES`; the second copy needs an `as unknown as` cast, and D110's report reads from this list so a drift changes a published number's shape | duplication + needless abstraction | **CLEAN** — import the exported list and drive both surfaces from typed pairs |
| **S6** | scripts | `quest-corpus-census.mjs`'s comment claims *"the same lenient read the app uses"* — the app reads through **JSON5** (`sync/json.ts`), while the script strips trailing commas with a regex, so a file that parses under JSON5 can be reported UNPARSABLE. Its header also claims *"no dependencies beyond node's own"* while the file imports `better-sqlite3` | false claim in a comment | **CLEAN** — correct both comments (+ the valueless-flag default) |
| **S7** | scripts | The owner's fork path is hardcoded inline though `DEFAULT_SPIRALDB_PATH` is exported one import away — and it is the one unguarded corpus default in the phase's scripts (D116's class) | duplication (magic constant) | **CLEAN** — import the constant (identical value, zero behaviour change) |
| **S8** | scripts | `wad-census.mjs`'s `parseIndex` is exported and imported by nothing, while its *"agree byte for byte"* claim about `wadindex.ts` is prose-only — and it is the negative control D90(c) requires to have been proven sensitive | dead surface + missing test | **CLEAN** — add the comparison arm (turns the claim into a test). Do not rename the file: three evidence files and `wadindex.ts` quote its path |
| **S9** | scripts | Two of the phase's CLIs have no npm alias, against the convention 4 of 5 `.mjs` and 6 of 8 `.ts` siblings follow | dead interface | **CLEAN** — add `wad:census` and `verify:wad-index` aliases (additive) |
| **S10** | scripts | **`scripts/**/*.ts` is in no tsconfig**: there is no root tsconfig, `server`/`tests`/`client` cover only their own trees, and `build:server`/`typecheck:tests` are the only `tsc` runs — so the phase's ~2,200 lines of new TS CLI are never type-checked, which is also why a dead field (S15a) was invisible to CI | missing coverage | **CLEAN** — add `scripts/tsconfig.json` + a `typecheck:scripts` step, then fix whatever it surfaces (that is the point); framed honestly as a **pre-existing repo-wide gap** the phase aggravated |
| **S11** | scripts | `quest-catalog-verify.ts` keeps its assertions, the `-1`-means-absent semantics and the exit decision inside the CLI, against the phase's own *pure service + thin CLI* convention that its two siblings follow | missing tests | **DISPOSITION** — extracting `planVerifySteps()` is a refactor of merged tooling whose criteria quote its output; recorded with the proposed split |
| **S12** | tools | `WadScan/Program.cs` parses every flag for every command, so `census --select` and `census --out` are silently ignored while the `Usage` text scopes them correctly — the documentation is right and only the enforcement is missing | dead options | **DISPOSITION** — no CI has a .NET SDK (D55), so any C# change needs a local rebuild **and** the NDJSON determinism re-run; recorded with the cost |
| **S13** | tools | The glob semantics are implemented twice (`Glob.ToRegex` in C# and `globToRegExp` in TS) with a prose-only equivalence claim; a divergence would silently change what the batch extractor selects versus what the sync believes it selected (D107's own premise) | duplication across languages | **DISPOSITION** — the durable fix is one committed `(glob, name, expected)` table consumed by both sides; recorded as the cheapest pin |
| **S14** | tools | `Extract.cs` computes `HeaderHash(payload)` for every row and uses it only on the failure paths — on the measured success path (6,733/6,733, `failed 0`) it is computed and discarded per row | dead work on the hot path | **DISPOSITION** — output-identical, but the NDJSON sha256 `29af4d0f…` is a recorded determinism proof that must be re-run; recorded |
| **T1** | tests | `MOCK_COVERAGE` is exported but re-typed inline in **four** specs (three character-identical), while `FORBIDDEN_DIGITS` exists precisely so these five numbers have **one measured home** — they now have five | duplication | **CLEAN** — import the fixture; keep `responsive.spec.ts`'s single deliberate long-path override as a spread |
| **T2** | tests | ~80 lines of clone-fixture plumbing (`git()`, `CloneAxes`, `cloneAxes`, `questFileCount`, `restoreClone`) duplicated across two clone suites, with a third pre-existing sibling — `restoreClone` is byte-identical | duplication | **CLEAN (safe subset)** — one helper for the identical bodies plus the frozen-corpus constant; the two **readiness predicates stay per-suite** (parameterising them is where a careless merge weakens the only guard against touching the owner's clone) |
| **T3** | tests | An arm named *"keeps the two enums structurally distinct in the wire types"* only checks that a literal is a member — widening the field to `string` leaves it green; there is no `@ts-expect-error` anywhere in the suite | weak verification (D90) | **CLEAN** — add the real `@ts-expect-error` guard (do not delete: the forward direction is real coverage) |
| **T4** | tests | **The D119 guard has no lock**: the *refuse to pick a database implicitly* rule — which exists because a write command already migrated the owner's live database once — lives only in the CLI's top level, and `grep -rl scaffold-quest tests/` is empty | missing test | **CLEAN** — a spawn-only arm: empty env, assert rc=2 + the refusal sentence (no DB, no corpus needed) |
| **T5** | tests | `useObjectFriendlyName` (new in this phase, consumed by two pages) has **zero** test references, and it carries the load-bearing D121 `decks` skip; the object-detail header's `namePair` is asserted nowhere — only its miss path is | missing test | **CLEAN** — one unit arm (the two allowlist branches + the miss) and one tier-1 row where the single-name route answers a real row |
| **T6** | tests | `MOCK_CATALOG_ROWS` has no consumer while three specs hand-roll the same four rows — and **disagree** on one name (`DS-ACAD1-C01-001` vs the older placeholder `DS-ACAD-C01-001`) | dead export + copy drift | **CLEAN** — import the fixture where it is just the fixture; do **not** unify the placeholder spelling (≈40 pre-existing arms use it) |
| **T7** | tests | Two arms cite **`D89(c)`** for the negative-control rule; D89 is the metadata tie-break with **no sub-parts** — the rule is **D90(c)**, as six sibling citations write it | wrong citation | **CLEAN** — fix both, plus the same class in two evidence files (annotate, never rewrite) |
| **T8** | tests | Two `export`s from a `.test.ts` have no importer, and a **third** comment-stripper has appeared beside `helpers/source-text.ts` | dead + duplication | **CLEAN** the exports; **DISPOSITION** the stripper merge — the two regexes are not equivalent and both files' negative controls must re-run |
| **T9** | tests | A bare `322` where the sibling clone suite names `CLONE_QUEST_FILES = 322` *with the D80(c) 'must be re-measured knowingly' intent*; a redundant `toBeGreaterThan(0)` follows it | magic number | **CLEAN** — use the exported constant |
| **T10** | tests | `seedString`/`seedNpc` are byte-identical in two new files (5 `seedString` homes repo-wide) | duplication | **CLEAN** — `tests/helpers/seed.ts`; leave the *variant* signatures alone (their differing shapes are what those arms depend on) |
| **T11** | tests | Three new document walkers coexist with the pre-existing `orderedKeyPaths`, and `isPlainObject` is re-declared despite being exported | duplication | **CLEAN** the predicate import; **DISPOSITION** the walker unify — the three differ in how they treat arrays/nulls, which is exactly what the byte-level *exactly one leaf changed* claims rest on |
| **T12** | tests | Five exports in `tests/helpers/wad-fixture.ts` are imported by nobody (the module has one consumer) | dead | **CLEAN** — drop the `export` keywords; keep the module (the stored-block zlib note is a real cross-version-flake guard) |
| **V1** | server | `SpeakerResolution.warning` is assigned in three places and **read nowhere** (0 grep hits), while the doc-comment one screen above claims *"each fall-through is recorded rather than hidden"* — the aggregate `fallbacks` is what is actually consumed | dead code + a false comment | **CLEAN** — delete the field and its arms, correct the comment **after** verifying the aggregate covers the three fall-through classes the comment names |
| **V2** | server | A private `isPlainObject` beside the byte-identical exported one, which 8 sibling services import — the only re-implementation among them (D58's single-home rule, inside the phase's own new file) | duplication | **CLEAN** — import it |
| **V3** | server | `personaObjectName` implemented **three** times (one exported and unused, two private copies) and they differ by a `.trim()` | duplication | **CLEAN** — one home; the trim is a widening on real corpus spellings |
| **V4** | server | A duplicate guard call: `questTemplateTargetPath` already asserts the target it returns, so the following `assertQuestTemplateTarget` can never throw where the first did not | dead | **CLEAN** — delete the line; the guard still runs before any read or write |
| **V5** | server | **The only server→client source import in the repo** (`questEvidence.ts` importing `client/src/lib/display.js`): the server build compiles and emits a `client/` tree (`server/dist/client/src/lib/display.js` exists), and `shared/` — the both-sides home — is bypassed | boundary violation | **DISPOSITION** — D111 already decided *which* module is the rule's home, so the open question is the **layer direction**, and moving `display.ts` now (with re-export shims and a spec assertion) is a phase-sized blast radius. Recorded as a decision **plus a new guard**: `display.ts` is dependency-free today, so a unit arm asserts that (the first React/DOM import in it would otherwise break `build:server` silently) |
| **V6** | server | Four byte-identical `spiraldbRoot(res)` closures (two added by this phase, message string included) and `indexFor`/`runtimeFor` duplicates; consequence: one root now yields **three** independent index instances | duplication | **DISPOSITION** — medium (4 routers, 3 mount points, all route bodies asserted); recorded with the third-instance observation and the note that unifying the per-router cache would be a behaviour change |
| **V7** | server | The friendly *source → (table, key, label)* mapping exists twice (`FRIENDLY_SOURCE_SPECS` vs the hand-copied `*_NAME_JOIN` columns) while the comment claims the join is *derived*; a rename in one silently leaves the search arm joining the old column | duplication | **CLEAN** — derive each join from the specs (`keyColumn ← spec.idColumn`, `nameColumn ← spec.labelColumn`), keeping only `keyIsInteger` local; the search suite is the guard |
| **V8** | server | The deck and recipe collectors are structural copies (~55 lines each) differing only in identifiers and constants | duplication | **DISPOSITION** — the largest consolidation, and the least rehearsed: CI never runs the extraction (D107's `skipped` arm is what CI exercises), so a 110→55 line collapse needs a real scoped extraction as its proof; recorded as the follow-up with that requirement |
| **V9** | server | `NPC_KEY_CATEGORY_ORDER` duplicates `NPC_ALIAS_CATEGORIES` eleven lines apart, and the vocabulary carries a category with **0 rows** while omitting the real spaced spelling that has **5** (measured on the live DB: alias rows 6,463 → 6,468; `npcEntityById('Persona, First_00000056')` is a 404 for a key that exists) | duplication + a measured gap | **CLEAN** the duplicate list; **DISPOSITION** the spelling swap — it changes the alias set and therefore search/view output, so it belongs in a D-item or a follow-up, not a cleanup pass |
| **V10** | server | The 21-line sync barrel re-export block added by this phase has **0** importers (every consumer imports the concrete module); one exported factory has none anywhere; the block is also asymmetric (it re-exports one summary builder but not its sibling) | dead | **CLEAN** — delete the added block (grep-provable) rather than inventing a consumer |
| **V11** | server | `extractQuestRefs` (an array-in convenience wrapper called only from tests) and `resolved.label` (built per reference, read nowhere; it also makes `friendlyNameOf` run twice per reference) | dead | **CLEAN** — delete both (the tests already build a collector explicitly at one site) |
| **V12** | server | A dead store (`breadth = collectedBreadth` twice with no intervening write and no read before the return), a `scalar` one-liner declared twice in one function, and an orphan doc-comment left by a removed property | dead | **CLEAN** — three one-line deletions |
| **V13** | server | `renderTable`/`renderPortVerdicts` (the table the gate's evidence file is rendered through) have no test, and two silent `catch { continue }` in `buildNpcView` skip an unreadable/unparseable quest file with no counter and no `notes` entry, while the same object's contract says a bare `[]` would read as a claim about the corpus | missing tests | **DISPOSITION** — formatting-only value for the renderers (the harness's *decisions* are covered), and a counter for the catches would be a response change; recorded, with the note that D122's own lesson argues for locking the evidence surface |

## 2. WHAT THE PASS DID NOT TOUCH, AND WHY (the scanners' own 'considered and left alone')

- **Deliberate separation mistaken for duplication**: the 36-key corpus order in `shared/quest/scaffold.ts` is
  kept apart from the schema's field list **by decision (D118)** and pinned by two assertions (equality with
  the emitted document, *inequality* with `QUEST_TEMPLATE_FIELDS`) — so it is evidence, not slop.
- **Load-sensitive configuration that is irreducible**: `vitest.config.ts`'s `fileParallelism: false` (D117) —
  the race *is* concurrent access to one fixture, both suites failed in a parallel run, and the 11 s → 51 s
  cost is stated in the file.
- **Established repo conventions**: `memoryDb()` appears in 25 test files (17 predating this phase) and the
  three `SyncDeps` fake bags each carry *this file's* subject matter as defaults; consolidating the new five
  would leave two conventions and consolidating all 25 is a repo-wide refactor.
- **Injection seams and wire-shape choices**: `wadscan.ts`'s test-only timeouts mirror `unpack.ts`/`extraction.ts`;
  `binaryPath` ↔ `binary_path` is the documented internal↔wire translation.
- **The phase's verification surface itself**: the falsification arms, the negative controls, the raw-evidence
  insert arm and the view-vs-constant arms are the strongest part of the diff — each already proves its own
  instrument's sensitivity, so nothing there is a finding.
- **Long, measurement-dense doc-comments** are the phase's house rule (a measurement carries its unit and
  population); the sweep found exactly **one** orphan comment (V12) and **one** doc/behaviour mismatch (V1).
- **`client/src/lib/quest-info.ts`'s duplicated 36-key list** (the client array is byte-identical to the schema's
  `QUEST_TEMPLATE_FIELDS` and *unequal* to the corpus order): a genuine duplication, but it is **outside this
  phase's diff**, and the skill's own rule is not to expand a changed-file scope silently — recorded as the
  first follow-up, with the two comments that mis-name it named as well.
- **`shared/objectTypes.ts`'s `friendlyNameNote`** bakes corpus counts (`134`, `599`, `316 of 317`) into UI copy
  pinned verbatim by a test. Both corpora measure the same today (verified on the fork **and** the clone), so
  nothing is wrong now; the risk is the fork's next corpus plus the test pin — recorded, not changed.

## 3. THE FIFTH SCAN (`client/src`) LANDED AFTER THE FIRST FOUR — ITS ROWS, AND WHY THEY MATTER

It found the pass's **only behavioural defect**, which is exactly what a read-only scan is for:

| # | finding | class | action |
|---|---|---|---|
| **C1** | `formatNameRow('quests')` used `namePair` where `namePairDistinct` exists for the case in hand, so the names-API path rendered the **forbidden degenerate pair `X (X)`** for every quest whose title fell back to its own name — and that is **the common catalog shape** (the sync writes `title = record.quest_name`; only **286 of 1,447** have a direct title, D97). Measured on the live DB: 7 of 328 corpus rows already, `formatNameRow(...)` → `"Tutorial_Intro (Tutorial_Intro)"`. Reached through the requirement tree's quest dropdown. Every list/header surface already used the distinct form; only this path missed it | duplication (two rules for one concept) | **CLEAN** — one line + a unit arm |
| **C2** | The Catalog's `Title` cell repeats the `Name` cell for the same reason, so `CATALOG_NO_TITLE` (`—`) was **unreachable** — the constant exists for exactly the case that could not fire | duplication + dead branch | **CLEAN** — collapse the identity so `—` means "no linked title", + a unit arm |
| **C3** | **The identity shape existed in no fixture at any tier**, and `CATALOG_NO_MISSING` (the branch the page's second coverage query exists for) had **0 test references** — which is *why* C1/C2 survived | missing tests (D89: a mock must be as demanding as reality) | **CLEAN** — two test-only arms (do **not** edit the shared fixture other specs pin) |
| **C4** | `useObjectFriendlyName` had zero test references, and the object-detail header's pair plus the create dialog's "Known as" line were asserted nowhere (`object-list.spec.ts:151` answers every single-name route with the list envelope, so the header always fell back to the key) | missing tests | **CLEAN** — the detail-header pair arm done; the "Known as" arm reported as skipped rather than added thin |
| **C5** | Five copy-pasted `<section>` + `── X ──` shells in a 493-line component | duplication | **CLEAN** — one local `EvidenceSection` (DOM byte-identical) |
| **C6** | Four one-concept/two-spellings items: a second list of the names-endpoint types (`NAMES_API_TYPES` beside `NAMES_TYPES`), a redundant `title` prop duplicating the panel's own derivation, the coverage ratio derived twice with two empty-state guards, and the rail-tab constants bypassed by literals while being documented as "so they cannot spell the same tab two ways" | needless abstraction / duplication / inconsistent spelling | **CLEAN** — all four |

**Dispositioned from the same scan** (recorded, not changed): the two inferred-badge spellings (changing rendered text + two byte-pinning assertions is an owner call); the four `text-[10px]`/`text-[11px]` sizes below the spec's fixed Tailwind scale (4 of the repo's 6 sites are this phase's, all in one file — a visual decision); and the `/npcs/:npcId` section, which the spec promised while the client never had the page (the lead amended the spec — see the doc half below).

**The client scan's clean areas, kept verbatim because they bound the finding**: no debug leftovers (`console.`/`TODO`/`@ts-ignore` → 0); **no layering violations** (client imports only `@shared/*` and client-relative); every fetched route is spec-named; **no coverage/missing number re-derived client-side**; and the one display rule is single-homed and guarded by `display-single-home.test.ts` with a negative control — **C1/C2 are the semantic identity case that guard cannot see, which is precisely why C3's fixtures are the durable half of the fix.**

## 4. OUTCOME — 32 of the 36 CLEAN rows, and the four that were not done (with reasons)

Implemented: **S1, S2, S3, S5, S6, S7, S8, S9, S10 · V2, V3, V4, V7, V9(list), V10, V11, V12(a,b) · T1–T12 (T6 in the one spec where the rows are just the fixture; T7's test arms) · C1–C6.**

| not done | reason |
|---|---|
| **V1** (delete the dead field) | **The pre-condition the row set failed** — the aggregate surfaces only 1 of the 3 fall-through classes. Keeping the field and correcting the comment is the honest repair; the per-class counter is now **D124** |
| **V12(c)** (an orphan doc-comment) | not located by two mechanical repo-wide scans — recorded as unconfirmed rather than guessed at |
| **T7's evidence half** | only **one** evidence file carries the wrong citation (not two), and `docs/evidence/**` belongs to the lead |
| **C4's "Known as" arm** | the row marked it optional; reported as skipped rather than added thin |

**Contradictions the writer raised against this list, all recorded because they narrow claims rather than weaken them**: V11's "0 grep hits" under-reported (three assertions pinned `resolved.label` — updated, none weakened); V4's "delete the line" leaves the *binding* dead rather than the call (the call is now a statement, and the new `typecheck:scripts` caught it); V12(c) unreproducible; T7 is one file; T6 is two rows across three specs. **Three enabling decisions it flagged**: `wad-census.mjs` gained the standard entry guard so S8's parity arm can import `parseIndex` (verified both ways); `tests/tsconfig.json` gained `allowJs: true` for that one `.mjs` import (with `checkJs` still off); and T4/T5 are homed in new files (`scaffold-quest-cli-guard.test.ts`, `object-friendly-name.test.ts`).

## 5. THE DOC HALF (the lead's, done after the writer stopped)

Sequenced deliberately **after** the writer: `tests/unit/ui-shell.test.ts` **parses `docs/spec-ui-design.md` and `docs/spec-api.md`** to lock the nav and route tables, so editing specs while a worker runs `npm test` is the D84 hazard in a new place.

- **D117–D123 were appended *outside* the decisions list** (past the `## Related Documentation` heading) — a structural error by the lead. They are now inside `## Cross-cutting decisions`, where the file's own rule ("amend this list") expects them.
- The phase-log table gained **Phase 6's row** (branch, PR #9, the CI run, the merge sha, `gate-6`) and the section's "in flight" narration became the past tense.
- `AGENTS.md`'s index extended to **D124**.
- `spec-api`'s coverage **worked example contradicted its own measurement** (1,447/4,830/1,125/1,177 — the last being D97's *files* count) and `missing`/`references` were **undefined**: the example now carries the measured `(1717, 4823, 322, 1395, 2855)` with each column's definition inline, and the prose states that `references` counts referencing **objects**, not files.
- The **"1,447 nameable"** wording in its three homes now reads "read from the view (1,717 measured; 1,447 is the world-named sub-count)".
- The plan's **falsified figures** are annotated: the `128/165` hold-out → `78.0% (168 cases, 131 hits)`, and its `Status: proposed — awaiting owner sign-off` → merged.
- The **`/npcs/:npcId`** section: the spec promised a route, three entry points and a page that never existed — now **API-only**, with the reason and the `searchResultHref` evidence.
- The one wrong decision citation in an evidence file (`p6-08-tier2.md`'s `D89(c)` → `D90(c)`) is corrected; the artifact is annotated, not rewritten.

**Still recorded, not fixed** (a claimed defect with its measurement, for a follow-up rather than a silent edit): the **rotted line-number citations** — the phase inserted 78 lines, so `spec-ui-design.md`'s `L73-93` (cited in `tests/ui/shell.spec.ts`, `tests/unit/ui-shell.test.ts`, `client/src/lib/routes.ts`) now points at the §Names prose and `spec-api.md`'s `L325-350` at `POST /api/quests`; the route table is `L1028-1054`. The durable fix is to cite **section names**, which the next pass should do.
