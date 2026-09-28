# final-deslop D1 — the disposition list

Story: **final-deslop / Ultragoal final gate 1/3** (AC1, the `ai-slop-cleaner` pass).
Tree: `main` @ `1bac35c` (merge `1bac35c6`, PR #7), working tree clean at launch.
Nothing committed by this story — the lead commits (D84(a)).

## 0. SCOPE — stated first, because a disposition list whose scope is unstated is not one

The cumulative diff at launch is **141 commits, 723 files, +158,040 / −1,471**. Measured by
top-level directory (`git diff --numstat <root> HEAD`, 723 rows):

| top-level | files | +lines | in scope? |
|---|---|---|---|
| `docs/` | 361 | 42,466 | **No** — spec prose + per-story/phase evidence, not authored code |
| `client/` | 130 | 28,662 | **Yes, minus two exclusions** (below) |
| `tests/` | 108 | 52,238 | **Yes** — ui + unit + helpers |
| `server/` | 65 | 15,753 | **Yes** — `server/src` (39 f / 10,695) and `server/test` (24 f / 4,890) |
| `shared/` | 31 | 6,933 | **Yes** |
| `scripts/` | 9 | 2,153 | **Yes** |
| `tools/` | 4 | 1,067 | **Yes** (F1 lives here) |
| `package-lock.json` | 1 | 8,238 | **No** — generated |
| root configs (`playwright.config.ts`, `vitest.config.ts`, `package.json`, `.github/`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.npmrc`, `.gitignore`, `README.md`, `AGENTS.md`) | 11 | ~600 | **Yes** |

**Correcting the brief's premise, by measurement:** the volume is **not** dominated by
`data/` — `git ls-files data/` is **0 tracked files** (the corpus is untracked). It is
dominated by `tests/` (52,238), `docs/` (42,466) and `client/` (28,662). So the two real
exclusions are:

1. **`docs/`** — 361 files / 42,466 lines of spec prose and evidence transcripts. A code-slop
   pass over evidence prose would be theatre. Excluded, and D1/D2/D3 are written as evidence.
2. **Vendored primitives** — `client/src/components/ui/` (9 files: `badge, button, card,
   command, dialog, input, popover, skeleton, table`), deliberately vendored per **D39**, not
   ours to restyle. Excluded from every finding below. (Their unconsumed exports —
   `buttonVariants`, `DialogOverlay`, `TableFooter`, … — are inherent to a vendored primitive
   set and are **not** recorded as findings.)

Also excluded: `package-lock.json` (generated) and `tools/.artifacts` / `tools/.nuget`
(build output, gitignored).

**Authored-code surface actually swept: 311 files.** `client/src` 115 (60 outside
`components/` + 55 in `components/` outside `ui/`), `server/src` 39, `server/test` 24,
`shared/` 31, `scripts/` 9, `tests/` 108, root configs 11.

**Method** (all read-only; no file under `data/`, `Imview/` or `components/ui/` was touched):
repo-wide reference counting per exported symbol (boundary-aware, code files only —
`.ts/.tsx/.mjs/.cs`, excluding `docs/`, `.omd/`, JSON fixtures and generated `.artifacts`),
module reachability including dynamic `import()`, same-name declaration collisions, and
byte-comparison of duplicate helper bodies.

## 1. THE DISPOSITION LIST

`clean` = this story fixes it · `keep` = correct as it stands, with the reason ·
`debt` = a real finding, deliberately not fixed here, with its owner.

### 1a. The five items the run already recorded

| # | what | where | pattern | disposition |
|---|---|---|---|---|
| 1 | **F1 — location-dependent .NET build.** Both CLI projects hardcode the owner's sibling layout: `<ProjectReference Include="../../../Imview/src/Imview.PacketReader/Imview.PacketReader.csproj" />`. In any other checkout (the p5-09 clone at `/tmp/p5-09`) it is `MSB9008 … does not exist` + 3 × CS0246 → `build:cli rc=1`. | `tools/PacketReaderCli/PacketReaderCli.csproj:14`, `tools/FixtureGen/FixtureGen.csproj:15` | **boundary** — a build that only works in one checkout | **CLEAN** — the story's one mandated code fix; lead's ruling: an overridable MSBuild property defaulting to today's path |
| 2 | **F2 — module-level flag.** `let importToastShown = false;` guards the "Imported N existing entries" toast. A module-scope mutable stands in for state that belongs to the query layer; it also permanently swallows a *second* import in the same process. | `client/src/components/layout/AppLayout.tsx:36` | **slop** — module-level mutable | **CLEAN** (the shape) + **DEBT** (see 1d-1) — the guard moves into the query cache, keyed to the report |
| 3 | **`StatusBadge`'s prohibited `aria-label`.** `aria-label={\`Status: ${meta.label}\`}` on a role-less `<span>` — ARIA 1.2 prohibits naming the generic role. axe files it as **`aria-prohibited-attr`, an *incomplete*** (~1–50 nodes/arm), never a violation, because the badge's visible text is the real name. | `client/src/components/StatusBadge.tsx:49` | **slop / a11y** — prohibited ARIA, inert | **DEBT — confirmed still the right call**, and the coupling is *wider than the record states* (1c-1) |
| 4 | **Dead stubs and their mocks** (`StubPage`, `SharedComponentsPreview` + three mocks) — already deleted in p5-08, and `elementFor`'s unreachable `default:` now renders `NotFoundPage`. | — | dead code | **KEEP (already cleaned, verified)** — no orphan module survives (1b-1) |
| 5 | **Carried intermittent families** (to attribute and carry, never patch): `extraction.spec.ts` toast/pointer-overlap; `quests-goals-editor.spec.ts:511`; `a11y-keyboard.spec.ts:221`; a dev-stack-death run. | `tests/ui/` | missing tests / load-sensitive budgets | **KEEP (carried by name)** — except `:511`, which the story authorises raising (1b-6) |

### 1b. Found by this pass — cleaned

| # | what | where | pattern | disposition |
|---|---|---|---|---|
| 6 | **`joinKinds` duplicated byte-for-byte** (identical body *and* identical doc comment `A, B and C — an English list of the distinct kinds`). File-local in both. | `client/src/lib/drop-table-validation.ts:64`, `client/src/lib/quest-validation.ts:118` | **duplication** | **CLEAN** → one home in `client/src/lib/validation-message.ts`, the module whose own doc already declares itself the shared plumbing for exactly these two mappers |
| 7 | **`relativeTo` duplicated byte-for-byte** (`file` relative to `root`, or `file` when it is `''`), plus a third *inline* `path.relative(root, …)` in the same file. | `server/src/services/objects.ts:137`, `server/src/services/quests.ts:164` | **duplication** | **CLEAN** → one home in `server/src/services/spiraldbFiles.ts`, which **both** consumers already import and which already owns root-relative path building (`createTargetPath`) |
| 8 | **15 exported symbols referenced nowhere in any code file** (verified: 1 occurrence in the repo = the declaration; code-file reference count 1; docs/fixture mentions only). Two groups: (a) *unused behaviour* — `useFieldValidation`, `objectTypeConfigForUrlPath`, `severityLabel`, `resetDbForTests`, `SEARCH_QUERY_KEY`, `isEntryTypeKey`, `dialogEntryRequirementsPath`, `goalLogicEntryHasKey`, `UNREADABLE_RESULT_TEXT`; (b) *unused declarations* — `SPELL_NAMES_TYPE`, `SAVEABLE_COLLECTIONS`, `MagicSchool`, `ULongInput`, `ActorDialogBlock`, and the `$type` grammar group `assemblyQualifiedType` + `TYPE_CACHE_PREFIX` + `TYPE_ASSEMBLY_SUFFIX` (the function was the two constants' only consumer, so they go together or not at all). | `client/src/components/shared/FieldValidation.tsx`, `client/src/lib/{quest-dialog,quest-goal-logic,quest-results,api}.ts`, `server/src/{db.ts,services/import.ts,services/spiraldbFiles.ts}`, `shared/{objectTypes.ts,ulong.ts,quest/dialog.ts,quest/typeConstants.ts,simpleObjects/npcSpellInventory.ts}` | **dead code** + **needless abstraction** (speculative indirection) | **CLEAN** — deletion-first pass (skill Pass 1). Zero runtime risk; each deletion is independently proven by the four typecheck/unit gates |
| 9 | **`quests-goals-editor.spec.ts`'s drag poll is under-budget.** `expect: { timeout: 10_000 }` (global) governs `expect.poll(() => cardOrder(page))` in the pointer-drag test that starts at line 511, while the dnd-kit pointer drag measures **13.7 s**. | `tests/ui/quests-goals-editor.spec.ts:542` | **missing tests / load-sensitive** | **CLEAN** — D77(a)'s shape: raise *that poll's* budget with the measurement inline, rather than the global `expect.timeout` (which would hide real failures across all 33 specs). Explicitly authorised by the story |

### 1c. Found by this pass — kept, with the reason

| # | what | where | pattern | disposition |
|---|---|---|---|---|
| 10 | **`StatusBadge`'s label coupling is wider than the axe record says.** The record names *four* sites in *three* files (`object-editors.spec.ts:340,360`, `status-integration.spec.ts:408`, `extraction.spec.ts:1236`). Measured: **≥9 `getByLabel('Status: …')` locators across 7 spec files** — additionally `dashboard.spec.ts:856`, `object-mobile.spec.ts:580,630`, `quests-browse.spec.ts:164-165`, `quests-detail.spec.ts:78`, `quests-edit-mode.spec.ts:338,357`, plus `quests-status.spec.ts:41-43` (constants). | `tests/ui/` | **boundary** — specs locating through a prohibited attribute | **DEBT — keep, unchanged:** the disposition is *more* justified than recorded, not less. Flipping it here would edit ≥9 locators across 7 specs to satisfy an axe *incomplete* (never a violation) whose name is **inert** (the visible text is the real accessible name). `search-palette.spec.ts:397` already demonstrates the better long-term fix (`getByText('Status: Reviewed')`) |
| 11 | **`shortTypeName` has two homes and two meanings:** `shared/quest/typeConstants.ts` is a *table lookup* (`string → KnownTypeName \| undefined`, never guesses); `client/src/lib/extract.ts` is a *syntactic split* (`unknown → string \| null`, works for unknown types). Same name, different contract. | `shared/quest/typeConstants.ts:178`, `client/src/lib/extract.ts:268` | **duplication (name) / boundary** | **KEEP with reason** — not duplicated logic: the semantics genuinely differ. Both consumers already disambiguate at the import site (`import { shortTypeName as lenientShortTypeName }` in `quest-goals.ts:93` and `requirement-tree.ts:114`), so the collision is acknowledged in code. Renaming would touch two public-ish modules for a cosmetic gain |
| 12 | **`client/src/components/quest/QuestGoalLogicEditor.tsx` has no static importer** — flagged as a possible unreachable component. | `client/src/pages/QuestDetailPage.tsx:41` | **dead code (candidate)** | **KEEP — false positive, verified:** it is lazy-loaded (`const QuestGoalLogicEditor = lazy(() => import('../components/QuestGoalLogicEditor'))`, D61's measured lazy containment). A `from '…'`-only reachability check misses `import()`. **No orphan module exists** in the authored surface |
| 13 | **Unconsumed `export` surface: 266 exported symbols in `client/src` (excluding vendored `ui/`) referenced by no other file.** 76 `*Props`/type interfaces, 86 SCREAMING_CASE label/copy/data constants, 34 lowercase helpers, ~70 other types. Every one is *used inside its own file* (spot-checked: `OFFLINE_BANNER_TEXT`, `GOAL_LOGIC_CANVAS_LABEL`, `ZOOM_IN_LABEL`, `FIT_VIEW_DURATION_MS`, `toValidationMessage`, `hasError`, `findSpecByName`, `activityTypeLabel`, `toZoneTransferValidationMessage` — all ≥2 own-file occurrences). | `client/src/**` | **needless abstraction** (surface widened for nobody) | **DEBT — counted and named, not churned.** Deleting ~266 `export` keywords is a repo-wide rewrite of module surfaces, not a bounded cleanup, and parts of it are the run's deliberate "copy/labels as *data*" convention (D59). Recorded with its count and method so a later pass can act deliberately |
| 14 | **`server/test` corpus-coupled suites.** Checked for the D81 shape (a spec depending on the developer's corpus instead of mocking). | `server/test/`, `tests/unit/` | **missing tests** | **KEEP** — the corpus sweeps are explicitly *owner-run* and skip without a corpus (D68's collection-time rule), which is why they are green-able in CI. No new dependence introduced |
| 15 | **`isJsonFile` ×2** (`import.ts:162` takes `ImportDirectoryEntry`; `spiraldbIndex.ts:89` takes `fs.Dirent`) and the inline `path.relative` at `objects.ts:783` (no `''` fallback — a *different* rule from #7, so deliberately **not** folded in). | `server/src/services/` | **duplication (structural)** | **KEEP with reason** — same predicate text, different input types *by design* (one abstracts the dirent for testability). Consolidating means unifying the entry shapes: a restructure, not a source-form diff |

### 1d. Found by this pass — debt, named

| # | what | where | pattern | disposition |
|---|---|---|---|---|
| 16 | **F2's *user-visible* bug — the toast re-announces on every page load.** A module-level flag is **per-document**, so a full page load re-fires the "Imported N existing entries" toast for an import that happened hours ago. | `client/src/components/layout/AppLayout.tsx` | **slop** | **DEBT with owner (the lead / a later story).** Fixing it needs a *durable* "already announced for `imported_at` X" fact. **This app has no client-side persistence at all** — `grep localStorage\|sessionStorage client/src` → 0 hits; identity/settings live server-side (D38). Choosing where that fact lives is a design decision, not a deslop edit, so this story fixes the *shape* (#2) and records the remainder. **Smallest fix if taken:** mark the announcement in the settings record (one new API field) or add the app's first `sessionStorage` key behind a pure helper in `lib/` |
| 17 | **`describeError` duplicated byte-for-byte** — `error instanceof Error ? error.message : String(error)`, same 3 lines, two services. | `server/src/services/objects.ts:142`, `server/src/services/spiraldbFiles.ts:454` | **duplication** | **DEBT** — the one-home fix needs a new small server util module (a 3-line idiom), because the only shared import target (`spiraldbFiles.ts`) is the *file layer*, and putting a generic error-narrower there would be a misplaced responsibility — trading a duplication smell for a boundary smell |
| 18 | **`quoted` duplicated byte-for-byte** — the 14-line sentence renderer (`"X"` / `absent` / `null` / `String` / `JSON.stringify`), identical bodies. | `shared/dropTable/validation-messages.ts:40`, `shared/quest/validation-messages.ts:55` | **duplication** | **DEBT** — both are per-family copy tables that deliberately do not share vocabulary, and the shared sentence renderer has no designed home. `shared/document.ts` (which already hosts `formatDocPath` and a *different* internal `describeValue`) is the nearest candidate but would blur D58's "document model + single write-rule home" |
| 19 | **`describeValue` in three homes, two behaviours:** `shared/document.ts` (`'an array of length N'`, `'an object'`) and `tests/helpers/roundtrip-fidelity.ts` are byte-identical; `server/src/routes/settings.ts` is deliberately shorter (`'array'`, bare `typeof`) for 400 messages. Both shared copies are file-local (not exported), so the test helper cannot import one. | `shared/document.ts:62`, `server/src/routes/settings.ts:62`, `tests/helpers/roundtrip-fidelity.ts:38` | **duplication** | **DEBT** — the *settings* copy is a different rule (keep). The shared↔test pair could share one home, but that means exporting an internal solely for a test helper; recorded rather than forced |
| 20 | **Unreferenced declarations kept as the run's ledger** (from #8's group (b), which were *not* deleted): **`KNOWN_DIALOG_TAGS`** (doc carries the measured `m_dialogTag` census at `f9a1055`: 774 blocks, `Completion` 442 / `Prep` 322 / empty 5 / **`Hyperlink` 5**), **`GOAL_LOGIC_ENTRY_KEYS`** ("the five keys every corpus entry carries, **in the corpus's own order**"), **`IMPORT_SKIPPED_SUBDIRECTORY`** (documents the spec's L277 skip rule). | `shared/quest/typeConstants.ts`, `client/src/lib/quest-goal-logic.ts`, `server/src/services/import.ts` | **dead code** (unused) | **DEBT / KEEP with reason** — each is *zero-runtime-cost* and its doc comment **is** the artifact: a measured corpus fact, a corpus key order, or a cited spec line. D78's rule is that these constants are "extended deliberately while counts are re-measured"; deleting a measurement because no function currently reads it destroys the ledger. Named here so the choice is explicit, not silent |
| 21 | **`shortTypeName` alias pair** — see #11. | — | — | **DEBT (no action)** — listed under #11 for completeness |

## 2. Boundary check — every class named in the brief, measured

| boundary class | result | evidence |
|---|---|---|
| any `client/` import reaching into `server/` (or reverse) | **none** | `grep` for import statements across the trees returns **0**; every `server/src/…` string in `client/` and `shared/` is inside a **doc comment** (e.g. `client/src/lib/extract.ts:26` "the client cannot import server modules"), and every `client/src/…` string in `shared/`/`server/` likewise |
| `shared/` importing a client-only or server-only module | **none** | `shared/**` imports only `zod` + its own relative modules; no React, no `node:*`, no `express`, no `better-sqlite3` |
| json5 (or another node-only lib) entering the client bundle (**D58**) | **none** | `json5` appears in `server/src/services/sync/json.ts` (server), in doc comments in `shared/document.ts`, and in **tests** — never in `client/src`, and never in `shared/`'s import graph |
| a test importing internals rather than the seam | **none found** | `tests/ui/*.spec.ts` import **no** `client/src/lib/*` module; the 33 specs drive the app through HTTP mocks. `tests/unit/*` importing `../../client/src/lib/*` is the *unit* tier's seam by design (pure helpers) |
| a spec depending on the developer's corpus instead of mocking (**D81**) | **none new** | the corpus-coupled sweeps live in `tests/unit` + `server/test`, are owner-run, and skip without a corpus (D68) |

## 3. What this disposition list does **not** claim

- It is **not** a pass over the 42,466 lines of `docs/` prose, nor over `package-lock.json`,
  nor over the 9 vendored `components/ui/` primitives.
- `KNOWN_DIALOG_TAGS`-class symbols (#20) are **unused**, and this list says so explicitly
  rather than dressing "unused but documented" up as "used".
- The 266-symbol unconsumed-export count (#13) is from a **repo-wide reference count over
  code files only**; it is an upper bound on "exported for nobody" and a lower bound on
  nothing. Its method is stated so it can be re-run.