# p5-09 D3 — the regression checklist (Phases 1–4) and the gate

Story p5-09 (plan task 5.8). Repo `phase-5-dashboard-polish` @ `750c31a` **plus this story's
uncommitted sync fix**; nothing committed, no git write in the repo (D84(a)). Every run below was on
a **settled tree** (D85): the only writer was me, `git status --short` was checked before the gate
and again after it, and the four modified source files were frozen before the first check ran.

## 0. The gate — seven checks, every rc captured on its own command

| # | Command | rc | Result |
|---|---|---|---|
| 1 | `npm test` | **0** | **67 files / 1,461 tests passed** (9.1 s vitest wall). One more than p5-08's 1,460 = this story's new `resolveSyncDbFile` test. Raw: `p5-09-d3-gate-npm-test.txt` |
| 2 | `npm run lint` | **0** | eslint clean + `All matched files use Prettier code style!` (all four touched source files `prettier --write`-ed first) |
| 3 | `npm run typecheck:tests` | **0** | no output |
| 4 | `npx tsc -p server/tsconfig.json --noEmit` | **0** | no output |
| 5 | `npx tsc -p client/tsconfig.json --noEmit` | **0** | no output |
| 6 | `npm run build` | **0** | `client/dist/assets/index-NmSPrSJ5.js 768.82 kB │ gzip 226.71 kB`, built in 3.46 s (the >500 kB Rollup notice is the recorded, expected one) |
| 7 | **`npm run test:ui`** (no `--config`) | **0** | **393 passed (2.1 m)** — `p5-08`'s exact count, and the phase's second fully-green **official** suite. The harness booted its own stack (Vite `5181`, Express `3001`, `SPIRALDB_UI_DB=$PWD/data/test-ui.db`, `reuseExistingServer:false`), so `5173` (the owner's sibling) was never touched |

Raw transcripts for §0 and §0.1 live next to this file: `p5-09-d3-gate-npm-test.txt`,
`p5-09-d3-gate-lint.txt`, `p5-09-d3-gate-typecheck-tests.txt`, `p5-09-d3-gate-tsc.txt`,
`p5-09-d3-gate-build.txt`, `p5-09-d3-gate-test-ui.txt`, `p5-09-d3-corpus-suites.txt` (captures +
audit + spot-check), `p5-09-d3-live-matrix.txt` (the four live API/reader matrices) and
`p5-09-d3-final-gate.txt` (the delivered-tree re-run).

**Checks 1–6 were run twice: once mid-story and once again on the settled, delivered tree** — after
the last evidence file was written — precisely so the gate is a measurement of what is handed over
and not of an earlier snapshot (D85):

```
$ git status --short | wc -l            # 4 modified sources + 23 new p5-09 evidence files, nothing else
$ npm test                 rc=0         # 67 files / 1461 tests
$ npm run lint             rc=0
$ npm run typecheck:tests  rc=0
$ npx tsc -p server/tsconfig.json --noEmit   rc=0
$ npx tsc -p client/tsconfig.json --noEmit   rc=0
$ npm run build            rc=0         # index-NmSPrSJ5.js 768.82 kB / gzip 226.71 kB, 2.99 s
```

`npm run test:ui` (check 7) was **not** re-run after the evidence files were added: they are
`docs/`-only markdown/PNG/`.txt` and the UI suite reads `tests/`, `client/` and `server/`, so their
addition cannot change what it measures — while a second run would put the four carried flake
families back in play for no additional information. The green run recorded in §0 is the one whose
tree contained every source change this story makes.

Corpus/reader-level instruments run alongside:

| Instrument | rc | Numbers |
|---|---|---|
| `npm run verify:captures` | **0** | **5 fixtures, 50 field checks, 0 mismatches, 0 known-defect rows** — and the reproducibility arm (fixturegen reproduces the committed bytes) for every fixture |
| `npm run audit:corpus` | **0** | **181/322 round-trip identically through the real reader, 1810 field checks, 0 mismatches**; 141 not covered by the synthetic harness (122 goal-level dialog on a compilation goal, 11 no goals, 4 non-Prep/Completion quest-level tag, 4 `m_goalName != "{n}_{m_goalTitle}"`) — the same 181/322 gate-4 recorded, measured here against the **frozen D17 clone** (D80(c)) |
| `npx tsx scripts/sync-spotcheck.ts --tree /tmp/wad-spike --db /tmp/p5-09/dryrun.db` | **0** | **108 checks, 0 failures** (5 rows per name table re-read from the unpacked source; `string_table` byte-for-byte; a real quest title through the DB's own table) |

**The four carried intermittent families did not fire in this run** — `extraction.spec.ts`'s
toast/pointer-overlap family, `quests-goals-editor.spec.ts:511`'s 10 s
`copyPanelDocument` poll (D77(a)), `a11y-keyboard.spec.ts:221`'s 60 s filechooser wait, and any
dev-stack-death run: `npm run test:ui` reported **393 passed, 0 failed, 0 flaky, 0 skipped**, so there
was nothing to attribute or discard. They stay carried by name, unpatched.

## 0.1 Instruments, named once

| Tag | Instrument (fresh in this story unless marked) |
|---|---|
| **U** | `npm test` (rc=0; 67 files / 1,461 tests) — unit, API-route, model, corpus-round-trip and pipeline suites |
| **UI** | `npm run test:ui` with **no `--config`** (rc=0; 393 passed) — the committed tier-1 Playwright suite |
| **A** | `npm run audit:corpus` (rc=0; 181/322, 0 failures) |
| **V** | `npm run verify:captures` (rc=0; 5 fixtures, 50/50) |
| **S** | `npx tsx scripts/sync-spotcheck.ts …` (rc=0; 108 checks, 0 failures) |
| **L** | the **live clone rig** — `/tmp/p5-09/spiraldb-ui` + the throwaway corpus + the isolated DB: sync ×3, first-startup import, restart, the API matrix (names/settings/status/quests/dashboard/activity/search), the D2 walkthrough, the live POST arms (validation 400s, the dirty guard, the NpcDropTable create), the live Sync button, and prod `:3001` |
| **6** | the seven checks in §0 |
| **R** | **earlier gate evidence, re-read** — `docs/evidence/phase-{1,2,3,4}/gate-*`; each such line below says whether the code it certifies has changed since |

## 1. Phase 1 — all 19 criteria

| # | Criterion (abridged) | Instrument | Fresh or re-read | Status |
|---|---|---|---|---|
| 1 | `npm install && npm run dev` → client on its port, `/api/*` proxies to `:3001`, no console errors | **L** | **fresh** — `npm install` rc=0 (527 packages, 30 s) in the clone; `npm run dev` up (Vite `5190` via `VITE_PORT`, Express `3001`); the proxy arm is real, not curl: every dashboard/quest assertion in D2 ran `fetch('/api/…')` **from the `:5190` page**; 0 console errors in dev and in prod | PASS |
| 2 | fresh DB boot → 11 tables + 3 indexes | **L** + U | **fresh** — `sqlite_master` of the clone's isolated DB: `tables (11): drop_tables, entry_status, items, npcs, quests, settings, spells, status_history, string_table, sync_history, zones`; `indexes (3): idx_entry_status_key/-status/-type` | PASS |
| 3 | spike 1.4a findings recorded (tree, format, `.lang`, timing) | **R** | re-read — `docs/evidence/phase-1/spike-1.4a.md` (34 KB) and gate-1's PR body; Phase-5 code cannot change a measurement document. The "PR description" half is gate-1's artifact | PASS (as recorded) |
| 4 | `npm run sync` non-zero counts + `sync_history` success row | **L** | **fresh** — run 1: `SUCCESS`, items 79,835 · spells 18,173 · npcs 23,033 · **quests 328** · zones 1,241 · drop_tables 317 · string_table 216,991, unpack/scan/write 18.2/3.3/0.45 s | PASS |
| 5 | spot-check: 5 rows/table vs the unpacked source; one quest title through `string_table` | **S** | **fresh** — 108 checks / 0 failures against the clone's DB and the real `/tmp/wad-spike` tree | PASS |
| 6 | `.lang` parser tests incl. `QuestTitle_1ED8D → 126349` + sparse fixture | **U** | **fresh** — `tests/unit/lang.test.ts` inside the 1,461 | PASS |
| 7 | re-running sync replaces, not duplicates | **L** | **fresh** — run 1 vs run 3 (both full, fresh unpack) byte-identical on all 7 tables; `sync_history` is append-only by design (3 rows after 3 runs, the middle one the deliberately failed `--tree` probe) | PASS |
| 8 | names API shapes; unknown id → 404 | **L** | **fresh** — `items/4808 → {"gid":4808,"name":"Twice Stitched Boots"}` (the spec's own example); `items/999999999 → 404 {"error":"Unknown items id …"}`; `spells/607923`, `npcs/1397242`, `zones/WizardCity%2FWC_Hub`, unknown type → 404 listing the valid types | PASS |
| 9 | first startup imports exactly once; restart does not change counts | **L** | **fresh** — first boot `Imported 2277 existing entries` (quest 328 · drop_table 317 · npc_inventory 215 · npc_spell_inventory 77 · creature_spellbook 134 · treasure_card_inventory 1 · zone_transfer 1205 · npc_drop_table 0 = 2277); a **second process** on the same DB logged `first-startup import skipped (entry_status already has rows)` and every count was identical. The AC's literal "322/317" is the 322-era pin (D80a/D83): re-measured here as **328/317** with 0 duplicate quest names | PASS (pin restated) |
| 10 | `?status=extracted` → the type's entries + `summary.total` = the whole type | **L** | **fresh** — `entries 327, summary {total:328, extracted:327, reviewed:0, verified:1}` (D37: the summary counts before the filter); `?status=bogus → 400`. The AC's "322" is the historical pin | PASS |
| 11 | `PATCH` transition + history (old/new/notes/by/time) + `reviewed_at`/`reviewed_by`; **identity modal first** | **L** + **UI** | **fresh** — D2's reviewed and verified transitions: history rows with old/new, the note, `changed_by`, `changed_at`, badge flips. The modal clause (deferred as D43 at gate-1) is now covered **fresh** by `tests/ui/extraction.spec.ts:1081/1105` and `quests-status.spec.ts:330` inside the 393, which drive `role=dialog` "What should we call you?" / "Save name" | PASS (D43 closed by Phase 2) |
| 12 | dashboard: `sum(types) == overall.total`; `percent_verified` correct | **L** + UI | **fresh** — `sum(types.total) = 2277 = overall.total`, **8** singular type keys incl. `npc_drop_table`, no `global_registry`; percentages one decimal (`99.9% / 0.1% / 0.0%`) | PASS |
| 13 | settings PUT persists, GET reflects, invalid path → 400 | **L** | **fresh** — full D32 ladder: invalid dir → 400 with the offending path; unknown key → 400 listing the allowed keys in order; non-string → 400; `{}` → **200 no-op with the full map**; a valid partial PUT → 200 and GET reflects it | PASS |
| 14 | sidebar navigates every route, collapse, one active item; header Sync → spinner → success toast | **UI** + **L** | **fresh** — `shell.spec.ts` (12-route sweep, collapse, exactly-one `aria-current`) in the 393; **and the live button re-pressed on `:3021`**: label `Syncing…` + `disabled` + exactly 1 `svg.animate-spin`, then the toast `Sync complete: 79,835 items · 18,173 spells · 23,033 NPCs · 328 quests · 1,241 zones`, and `sync_history` grew 3 → 4 with a success row carrying those counts | PASS |
| 15 | `FriendlyNameDropdown` renders real synced names for items/spells/npcs, stores the raw ID | **UI** + **L** | **fresh data arm**: the clone's names API returns the real values for all three types (in row 8). **Component arm: re-read** — gate-1/gate-2's tier-2 records (`p1-14-05-dropdowns-selected.png`, `gate2-03-friendly-dropdowns.png`) proved the rendered options and the hidden raw IDs; the Phase-5 stub preview that hosted that evidence was **deleted** in p5-08 (its mocks were dead code), so the durable instrument is now the editors' own dropdowns in the 393 plus those tier-2 records | PASS (component arm via R) |
| 16 | unit tests green (lang, D4 mapping, filename/key mapping, import scanner) | **U** | **fresh** — 1,461 tests; those four suites are in the set | PASS |
| 17 | `ci.yml` exists and runs the pipeline on `pull_request`, verified by the PR's own check run | **R** + **6** | **definition re-checked fresh by reading the file**: `npm ci` → `npm test` → `npm run build` → `npm run lint` → `npm run typecheck:tests` → `npm run test:ui:install` → `npm run test:ui`, job key `ci` (no job-level `name:`, as gate-1 requires). The **run** is gate-1/2/3/4's recorded check runs — no PR exists in this story, so it cannot be produced here. Code **has** changed since gate-1; the fresh equivalent of every workflow step ran in §0 (1,461 tests, build, lint, typecheck, 393 UI tests) | PASS (definition fresh, run re-read) |
| 18 | `npm run test:ui` green (`shell.spec.ts` headless); browsers dir gitignored | **UI** | **fresh** — 393 passed; `git check-ignore -v tools/.playwright-browsers data` → `.gitignore:23 tools/.playwright-browsers/`, `.gitignore:5 data/` | PASS |
| 19 | UI criteria evidenced per D23 tier 2 (MCP assertions + screenshots under `docs/evidence/phase-1/`) | **R** + **L** | Phase 1's own screenshots are re-read (they cannot be re-shot by a later story); this story's tier-2 evidence follows the same protocol freshly — 6 screenshots + DOM assertions in `p5-09-d2-*` | PASS |

## 2. Phase 2 — all 15 criteria

| # | Criterion (abridged) | Instrument | Fresh or re-read | Status |
|---|---|---|---|---|
| 1 | `npm run build:cli` → `tools/bin/imview-packet-reader`; on a capture prints a JSON array; on a corrupt file exits 1 with stderr | **L** (+ **F1**) | **fresh** — built cold in the clone (rc=0, 0 errors, 41.8 s); `--input <fixture>` → **rc=0** and a JSON array of **1** quest (`m_questName MB-YARD1-C01-001`, level 1, 15 goals); `--input {"foo":1}` → **rc=1** with `error: '…' is not a packet capture …` on stderr. (A bare-shell invocation needs `DOTNET_ROOT`; the app derives it portably itself, D45(3) — D2's extraction ran with no env set.) **The build step itself is broken for a clone that is not a sibling of `Imview` — finding F1 in D1** | PASS with **F1** |
| 2 | Closed-loop round-trip (D28) for ≥3 diverse corpus quests | **V** + **A** | **fresh** — 5 fixtures, 50/50 field checks + byte-identical regeneration; 181/322 corpus quests at 1,810 field checks, 0 mismatches | PASS |
| 3 | `POST /api/extract/quests` shapes; invalid → `{error: "Failed to parse packet capture: …"}`; server healthy after | **L** + U | **fresh** — the real extraction in D2 (`{quests, count}` → the review view); a non-capture via multipart → **400** with the CLI's own message; `GET /api/health` → 200 afterwards | PASS |
| 4 | Cancel mid-extraction kills the CLI child (checked with `ps`) | **R** + U | re-read — p2-04's live abort record (`curl --max-time 2` → exit 28 at 2.0016 s; a 50 ms `ps -C imview-packet-reader` watcher printed the child at t=0.08 s and nothing at t=2.02 s; 0 stray children; the `res.on('close')` signal, D47). The unit arm (`extraction-service`/`extract-api`, 41 tests) is in U. I did not re-run a 1,600-rep capture + abort; the code path has not changed since p5-08's clone-half pass | PASS (via R) |
| 5 | "Save All" of N quests **in the test clone**: N files, clean JSON, N metadata, N commits, message/author, `git_branch` persisted | **L** + U (+ R) | **fresh for the update arm**: D2's save produced **1 file + 1 metadata + 1 commit** on the newly created `content/2026-09-27` branch, author `Dry Run (p5-09) <Dry-Run-p5-09-@spiraldb-ui.local>`, subject `spiraldb: update quest MB-YARD1-C01-001`, clean JSON (0 trailing commas, final newline), `git_branch` persisted. **The create arm** (`spiraldb: extract quest {name}` for a *new* quest) is fresh in U (`save-pipeline.test.ts`) and re-read from gate-2's live two-quest save (320 → 322 files); it is not exercisable with the committed fixtures, all of which already exist in the corpus (**stated limit**, see D2) | PASS (create arm via U+R) |
| 6 | Metadata pairing (D20): existing → updated in place; new → `questmetadata_{name}.json` | **L** | **fresh, both arms** — MB-YARD1-C01-001 had one metadata file, refreshed in place (no duplicate) and its `ModifiedAt/ModifiedBy` updated; WC-COMMONS-MAIN-002-FIRE had none and the POST reported `metadata_outcome: "created"` with `QuestMetadatas/questmetadata_WC-COMMONS-MAIN-002-FIRE.json` in the same commit | PASS |
| 7 | Dirty SpiralDB tree → actionable error (D14), writes nothing | **L** + U | **fresh** — with `M README.md` in the corpus: **409** `SpiralDB repo at /tmp/p5-09/corpus has uncommitted changes — resolve them first… git status --porcelain (1): M README.md`; HEAD unchanged (`b200004… → b200004…`); corpus restored to clean afterwards | PASS |
| 8 | Each saved quest has an `entry_status` row (`extracted`) + a `status_history` row noting the capture filename; dashboard counts reflect | **L** + U (+ R) | **fresh, update arm measured**: the entry already existed from the first-startup import, so the save wrote **no** history row — the recorded D48(c)/D76(e) contract (the note is keyed on the `entry_status` **INSERT**); the dashboard's counts were unchanged by it. The insert arm (note = the capture filename) is fresh in U and re-read from p2-07's live record (`notes === "Imported from packet capture WC-UNICORN-MAIN-004.json"`). **Live create arm added for a sibling family**: the NpcDropTable create wrote `entry_status` (extracted) + exactly one history row `Created via UI` (D76e) | PASS (insert arm via U+R; the "capture filename" note not re-driven live) |
| 9 | Saving an existing quest name → update + metadata refresh + action `update` after a UI confirmation | **L** | **fresh** — the overwrite dialog verbatim (`These quests already exist in SpiralDB and will be overwritten`), `action: update`, `outcome: updated`, metadata refreshed, one commit | PASS |
| 10 | `GET /api/quests` lists the corpus with status dots; filter counts match the status summary; search filters | **L** + **UI** | **fresh** — `quests: 328` with `summary {total:328, extracted:327, reviewed:0, verified:1}` **identical** to `GET /api/status/quests`'s summary; `skipped: 0`. Dots/filters/search are in `quests-browse.spec.ts` (393). The AC's 322 is the historical pin | PASS |
| 11 | `GET /api/quests/{name}` on a legacy file with trailing commas returns fully parsed JSON | **L** | **fresh** — `WC-COMMONS-MAIN-002-FIRE` (28 trailing commas in 21 of 328 corpus files carry them since the owner's reformat, D80a): `JSON.parse` fails at position 482, the endpoint returns the quest (36 keys, 4 goals) | PASS |
| 12 | Extraction UI matches the spec states per D23 tier 2, incl. a 375 px viewport | **UI** + **L** | **fresh** — `extraction.spec.ts` (including its own overwrite-confirmation and mobile arms) in the 393; this story's own tier-2 screenshots of the dropzone → results → confirm dialog (D2); the 375 px arm is in the spec (`fullPage`/viewport assertions), and gate-2/phase-2 hold the historical screenshots | PASS |
| 13 | Tier-1 `extraction.spec.ts` headless in CI: upload → spinner → results → Save All + confirm → toast → list grows by N | **UI** | **fresh locally** (no `--config`, 393 passed). The "grows by N" arm mocks the corpus (D40) — the *live* growth is what the AC's own fixture measurement records (D54), and the CI *run* half is gate-2's check run (R) | PASS |
| 14 | "Mark Reviewed" with notes → history endpoint; StatusBadge flips blue | **L** + **UI** | **fresh** — D2 step 3: toast, badge `Reviewed`, history `extracted → reviewed` with the note and `changed_by`; `quests-status.spec.ts` in the 393 | PASS |
| 15 | Round-trip safety: `GET` → `POST` unmodified → the diff is formatting-only, no field loss | **L** | **fresh, strongest form** — same legacy file: `POST {quest}` → 200 `updated`, one commit touching the quest file + its new metadata; **`isDeepStrictEqual(before, after) = true`**, 2,226 leaves both sides, 0 only-before / 0 only-after / 0 value mismatches, **70 explicit nulls preserved** (D57), trailing commas gone, final newline added | PASS |

## 3. Phase 3 — all 13 criteria

| # | Criterion (abridged) | Instrument | Fresh or re-read | Status |
|---|---|---|---|---|
| 1 | `$type` audit: constants ⊇ the corpus grep, asserted by a unit test that re-greps the real path | **U** | **fresh** — `quest-type-constants.test.ts` in the 1,461 | PASS |
| 2 | Corpus round-trip **322/322** deep-equal | **U** | **fresh, both corpora** — `[p3-02 ac1] files discovered=328 round-tripped=328 failures=0` (the owner's corpus, all 328 files explicit-null) **and** `files discovered=322 round-tripped=322 failures=0 (320 explicit-null + 2 absent-key)` on the frozen clone. The AC's 322 is the clone pin; the claim holds at both, which is the point | PASS |
| 3 | Edit-simulation ≥1 mutation per goal/requirement/result type present | **U** | **fresh** — the sweep's own line: `covered=26/26 recorded $type strings (goals=5, results=14, requirements=3, dialog=3)` | PASS |
| 4 | Real-quest edit isolation: one goal field + one dialog field in the UI → the diff shows only those | **U** + **UI** (+ **L** mechanism) | **fresh** — `quest-edit-isolation.test.ts` (real clone, real git) inside the 1,461 and the editor chains in the 393. The live one-field-per-commit mechanism was also driven fresh on a sibling family (D2: the DropTable edit → exactly one changed value, legacy path kept); the *quest* family's live arm is p3-10's recorded browser proof (R) | PASS (live quest arm via R) |
| 5 | Goals tab: 5 types with correct `$type`/fields; drag reorder; Start badge | **UI** | **fresh** — `quests-goals-editor.spec.ts` in the 393 | PASS |
| 6 | Flowchart: solid AND / dashed OR / ✓ Complete; readable dagre layout | **UI** | **fresh** — `quests-goal-logic.spec.ts` in the 393 | PASS |
| 7 | Requirement tree: the AC's saved JSON shape; only the 4 allowed types offered | **UI** | **fresh** — `quests-requirements-editor.spec.ts` in the 393 | PASS |
| 8 | Results: all 14 types addable with exact field sets; friendly dropdowns; `$type` verbatim | **UI** | **fresh** — `quests-results-editor.spec.ts` in the 393 | PASS |
| 9 | Dialog: every entry renders; 7 groups via accordions; duplicate/delete; a legacy unmodelled field survives and is disclosed | **UI** | **fresh** — `quests-dialog-editor.spec.ts` in the 393 | PASS |
| 10 | Validation: dangling start goal → inline error + banner + Save disabled; **direct `curl POST` → 400 with a per-field map** | **L** + U | **fresh live** — `POST /api/quests {quest}` with `m_startGoals=["NO-SUCH-GOAL-EXISTS"]` → **400** `{"error":"Quest validation failed with 1 validation error (Unknown start goal).","fields":{"m_startGoals[0]":[…]}}` — the D64 field-map key shape verbatim. The inline/banner/disabled arms are in the 393 (`quests-validation.spec.ts`) | PASS |
| 11 | JSON side panel reflects a form edit without a refresh; toggle + mobile overlay | **UI** | **fresh** — `quests-edit-mode.spec.ts` / `quests-detail.spec.ts` in the 393 | PASS |
| 12 | Unsaved-changes guard fires on navigation; discarding restores exactly | **UI** + U | **fresh** — `quests-edit-mode.spec.ts` in the 393; the byte-exact reset sweep over the whole clone corpus is in U | PASS |
| 13 | `tests/ui/quest-editor.spec.ts` passes headless in CI (the four chains) | **UI** + **R** | **fresh locally** — the file runs inside the 393 (the four chains). The CI half is gate-3's check run (R): code has changed since, and the workflow's own UI step is exercised fresh by §0's check 7 | PASS (local fresh, CI re-read) |

## 4. Phase 4 — all 14 criteria

| # | Criterion (abridged) | Instrument | Fresh or re-read | Status |
|---|---|---|---|---|
| 1 | List pages load the real corpus counts (317/215/77/134/1/1207) and NpcDropTable's empty state | **L** + **U** | **fresh** — live: drop_table 317, npc_inventory 215, npc_spell_inventory 77, creature_spellbook 134, treasure_card_inventory 1, zone_transfer **1,205 rows**; NpcDropTable **0 with the directory absent**. U carries the file-level sweep (`discovered == ls\|wc -l == round-tripped` for 317/215/77/134/1/1207, failures 0) — the two units of the 1,207-vs-1,205 ruling, both kept | PASS |
| 2 | Per tracked type: edit one field → only that field's diff + the exact `update` subject + the **original legacy path** | **L** (DropTable) + **UI**/**U** (the rest) | **fresh for DropTable** — D2: `DropTables/droptables_ds-acad1-c01-001.json` (legacy plural name preserved), 5/5 lines of which 1 is the edited value and 4 the documented float respelling + final newline, subject `spiraldb: update drop_table DS-ACAD1-C01-001`, and **no audit-field stamping** (D69b). The other families' live sweep (6 families, 168 checks, commits +14) is p4-09's record (R) | PASS (7-family live sweep via R) |
| 3 | Per type: create via UI → the convention filename, `create` action, `extracted` + a history note | **L** + **UI** + **R** | **fresh live for one keyed family**: `POST /api/npc-drop-tables {object:{TemplateID:5150099,DropTableNames:["DS-ACAD1-C01-001"]}}` → `outcome: created`, `action: create`, `file: NpcDropTable/npcdroptable_5150099.json`, the **directory bootstrapped**, `status_created: true`, `entry_status` extracted, the commit `spiraldb: create npc_drop_table 5150099` (with the supplied note in the message body). The seven-family create sweep (incl. slash→underscore and singular `droptable_`) is p4-09's record (R); the UI create forms are in the 393 | PASS |
| 4 | Round-trip corpus tests extended per type | **U** | **fresh** — the suite's own lines: 317/317, 215/215, 77/77, 134/134, 1/1, 1,207/1,207, **failures 0** in each, plus the unprefixed UUID NpcSpellInventory file resolved by content not name | PASS |
| 5 | DropTable validation blocks (Name empty/duplicate, RollChance, NoneChance, MinGold≤MaxGold) → inline + disabled Save + a server 400 | **L** + **UI** | **fresh live, three of four rules** — `RollChance 1.5` → 400 `fields.RollChance`; empty `Name` → 400 `fields.Name` ("Missing name"); a duplicate `Name` (no `key`) → 400 `fields.Name` ("Duplicate name"). `MinGold > MaxGold` is unit-level in this run (U) — it was not re-driven live; the inline/disabled arms are in the 393 | PASS (one rule via U) |
| 6 | A DropTable item's requirement tree via the inline editor, reloading identically | **UI** + **U** | **fresh** — `drop-table-editor.spec.ts` in the 393 and `drop-table-model.test.ts` in U | PASS |
| 7 | `ItemId` dropdown auto-fills the read-only `ItemName` | **UI** + **U** | **fresh** — the dropdown chain in the 393; the one canonicaliser (64/72 numeric vs 0/72 raw, 8 named misses) in U | PASS |
| 8 | NpcDropTable: the first save creates the directory + the file | **L** | **fresh** — measured live: the directory did not exist, the POST created it and it then held exactly `npcdroptable_5150099.json`; `GET /api/npc-drop-tables/5150099` reads it back; `GET /api/status/npc_drop_tables` went 0 → 1 | PASS |
| 9 | TemplateID round-trip: ulong keys stored as strings resolve back to the JSON number | **L** + **U** | **fresh** — the same entry: route key `"5150099"` (string) → `entry_status.object_key = "5150099"` → the detail read-back is `{"TemplateID":5150099,"DropTableNames":["DS-ACAD1-C01-001"]}` with `typeof TemplateID === 'number'`; the unit arm (one helper both ways) is in U | PASS |
| 10 | GlobalRegistry: the merged view equals the manual merge; one commit with the new file **and** the deletion; exactly one file after; absent from dashboard/status | **UI** + **U** + **R** | **fresh for the exclusion + merged view**: the clone's live dashboard has **no** `global_registry` key (8 types) and a `global_registry` status route 404s. The destructive live save (consolidate + `git rm` the legacy file) is p4-07's two-sided recorded proof (R) — deliberately not re-run here, because it would rewrite the merged registry of the throwaway corpus; the merge/deletion assertions are in U and the editor chain in the 393 | PASS (live save via R) |
| 11 | TreasureCardInventory: an unknown `SpellName` → warning, not blocking; Save succeeds | **UI** + **U** | **fresh** — `treasure-card-inventory-editor.spec.ts` in the 393 (the converse pinned there too); the real file's 71 warnings with `blocked:false` is p4-05's record (R) | PASS |
| 12 | Status flows: "Mark Reviewed" on a DropTable → history endpoint + list dot + filter-tab counts | **L** + **UI** | **fresh** — D2: the DropTable review wrote the history row with the note, flipped the badge, moved the dashboard's drop_table bucket to `1/317`/`316 extracted` and added its feed row; `status-integration.spec.ts` in the 393 | PASS |
| 13 | Mobile pass with screenshots: cards not tables, usable forms, a full-overlay JSON panel | **UI** | **fresh** — `object-mobile.spec.ts` + `responsive.spec.ts` in the 393 (their sweeps are DOM/geometry assertions). The screenshots are re-read from `docs/evidence/phase-4/` — and the p5-08 fix holds: this run wrote **0** committed PNGs (see §6) | PASS |
| 14 | `tests/ui/object-editors.spec.ts` headless for ≥2 representative types | **UI** | **fresh** — in the 393 (DropTable + NpcInventory chains) | PASS |

## 5. Corpus round-trip suites, for all types (AC "green for all types")

| Family | Expected files | Round-tripped | Failures | Instrument |
|---|---|---|---|---|
| QuestTemplate (owner's corpus) | 328 | 328 | 0 | **U** (`[p3-02 ac1]`) |
| QuestTemplate (frozen D17 clone) | 322 | 322 | 0 | **U** (`[p3-02 ac1]`) |
| DropTable | 317 | 317 | 0 | **U** (`[p4-09 ac4]`) |
| NpcInventory | 215 | 215 | 0 | **U** |
| NpcSpellInventory | 77 | 77 | 0 | **U** (+ the unprefixed UUID file by content) |
| CreatureSpellbook | 134 | 134 | 0 | **U** |
| TreasureCardInventory | 1 | 1 | 0 | **U** |
| ZoneTransfer | 1,207 | 1,207 | 0 | **U** (+ the 1,205-row list unit, named) |
| Reader-level quest round-trip (corpus-wide) | 322 attempted | **181** verified identically (1,810 field checks, 0 mismatches), 141 not covered by the synthetic harness | 0 | **A** |
| Committed captures (reader + reproducibility) | 5 | 5 | 0 | **V** (50/50 field checks) |

## 6. Hygiene, and two rig lessons worth carrying

| Check | Result |
|---|---|
| Repo working tree after the whole story | `git status --short` = exactly the 4 modified source files + the new `p5-09-*` evidence files. **No committed PNG was rewritten** — the p5-08 screenshot-churn fix held (`object-mobile.spec.ts` writes `test-results/`), so the phase-4 gallery is byte-stable across this full UI run |
| The owner's fork `/home/jason/…/spiraldb` | HEAD `d57d891`, `main`, porcelain empty — read only (the throwaway corpus is a clone of it) |
| The D17 clone `data/test-spiraldb` (five axes, D76b) | before **and** after the UI suite: branch `content/2026-09-27`, HEAD `18dc924`, `main` `f3f8b5c`, 42 commits, porcelain 0, 322 quest `.json` files — **byte-identical**, so nothing in this story wrote to it. (Its checked-out branch is *not* `main`; that is pre-existing state from earlier rounds, recorded rather than "fixed" by me) |
| The developer's live DB `data/spiraldb-ui.db` | unchanged across the entire story: `sha256 84c1b7f6…ba25b`, `mtime 2026-09-27 21:19:10.251805384`, `38,268,928 B` — same three values as the baseline taken before the first command |
| Listeners at the end | only the owner's sibling on `[::1]:5173` (never signalled). Every rig I started — dev `3901303/3901304/3901273`, prod `:3001`, prod `:3021` — was killed **by explicit PID**; `3001`, `5181`, `5190`, `3021` are free |
| Repo git writes | none: no `add`, `commit`, `reset`, `checkout` or `stash` was run in the repo (D84a). The only git commands were reads, plus commits made **by the app** inside the throwaway corpus and `git checkout -- README.md` there to undo my own dirty-guard probe |

**Rig lesson 1 — the tier-1 harness owns `:3001`, and the identity check caught the clash.**
`playwright.config.ts` boots the dev stack for the UI suite, which puts **Express on `:3001`** — the
same port the app's prod mode uses. My first attempt to restart my own prod stack while `npm run
test:ui` was running failed with `EADDRINUSE` (caught in the log, not assumed), and a probe against
`:3001` at that moment answered `spiraldb_path = …/data/test-spiraldb`, `user_name = ""` — the
**harness's** database, not mine. Because D70(h) says to assert the running server's identity before
trusting a probe, the probe was discarded and the API matrix re-run on a port I own (`3021`), with the
boot line + `GET /api/settings` checked first. Any future gate that runs `test:ui` and a live rig at
the same time must separate the ports; the alternative is measuring the wrong process.

**Rig lesson 2 — a bare-shell apphost invocation needs `DOTNET_ROOT`; the app derives it.**
Running `tools/bin/imview-packet-reader` directly from my shell exited **131** with "You must install
.NET to run this application", because a .NET apphost needs `DOTNET_ROOT` to resolve its runtime.
With `DOTNET_ROOT=$(dirname "$(readlink -f "$(command -v dotnet)")")` the same binary ran correctly
(rc=0 on the fixture, rc=1 on a non-capture) — and the **server needed no env var at all**, because
`extraction.ts` derives `DOTNET_ROOT` portably (D45(3)). Not a defect: an environment fact, recorded
so the 131 is never mistaken for a broken build.

## 7. Findings to hand over (nothing else is claimed)

| Id | Finding | Where |
|---|---|---|
| **F1** | **`npm run build:cli` is location-dependent.** `tools/{PacketReaderCli,FixtureGen}/*.csproj` reference `../../../Imview/src/Imview.PacketReader/…`, i.e. *the parent of the checkout* must contain `Imview`. A verbatim run in a clone under `/tmp` fails: `MSB9008 … does not exist` + 3 × CS0246, rc=1 — so the README's "Getting Started commands all work verbatim on a clean checkout" is not true for this one command. Once the clone's parent has a real `Imview` tree, the **cold** D18 build is green (rc=0, 0 errors, 41.8 s, 287 MB restore, in-workspace artifacts). Fix belongs in a `.csproj` property (owner-facing), so it is reported, not made | D1 §5 |
| **F2** | The one-time "Imported N existing entries from SpiralDB" toast **re-announces an old import on every full page load**: `AppLayout` guards it with a module-level flag (per document). Measured: `imported_at 01:47:22`, the toast re-shown at 01:56 and again after a reload. Cosmetic; counts unaffected | D2 |
| **AC-wording nuance** | "the dashboard reflects all three" walkthrough actions is only partly true by construction on a real corpus: the save of an **existing** quest moves no aggregate (D48c: an update writes no transition, and all five committed fixtures already exist in the corpus, so no create path is reachable with them) and a **content edit** moves none (the dashboard aggregates `entry_status`, never content). Only the status changes move it. I labelled a supplementary status change instead of doctoring the DB | D2 §"What the dashboard can and cannot reflect" |
| **Count correction** | The corpus's own `QuestTemplates/` contains a legacy `droptables/` **subdirectory** (314 files), so `ls QuestTemplates \| wc -l` reads 329/323 while the real quest file counts are **328** (fork) and **322** (clone). Sync's 328 quest rows match 328 files **exactly, with 0 duplicate `m_questName`** — my first draft of D1 wrongly attributed the difference to a D19 key collapse and was corrected against a direct scan | D1 §4 |
| **Pin drift** | The owner's fork is `d57d891` with **328** quest files — D80(a)'s "328" still holds for the file count, so no owner-run constant needs re-pinning on this evidence; the D17 clone stays frozen at 322-era (D80c) and is counted separately everywhere above | D1 §2, §5 |

**Limits, stated plainly.** (i) Every corpus-level number above is a *local* measurement — CI has no
sibling repo and no WAD, so those arms skip there (D53); CI certifies the 1,461 tests, the build and
the 393 UI specs, which is what §0 ran. (ii) The lines marked *via R* are **earlier gates' evidence
re-read**, not fresh runs: the abort arm (P2 #4), the cordis-level tier-2 campaigns (P1 #15/#19,
P2 #12), the seven-family create sweep and the six-family edit sweep (P4 #2/#3), the GlobalRegistry
live consolidation (P4 #10), and the CI check runs (P1 #17, P3 #13). For each of those the code has
changed since the gate (Phase 5 landed), which is why the fresh comparable instruments are named
beside them — but a reader should treat them as **re-read, not re-run**. (iii) `npm run test:ui` ran
green once in this story; p5-08's double-green remains the phase's strongest flake evidence, and the
four carried families stay carried by name, unpatched.