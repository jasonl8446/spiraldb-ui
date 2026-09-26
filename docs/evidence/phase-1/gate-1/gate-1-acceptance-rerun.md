# Phase 1 — gate-1 acceptance re-run (all 19 checkboxes, fresh)

Story **gate-1** (`docs/plan-phase-1-foundation.md` L85–103, `docs/plan-overview.md`
"Regression gate"). Every checkbox below was re-run **fresh at the phase boundary**,
not cross-referenced from the story that originally proved it, and every claim is a
raw command output or a captured DOM assertion. Machine-readable artifacts live
next to this file; the durable tier-2 record for the UI halves is
[`../tier-2-ui-pass.md`](../tier-2-ui-pass.md).

- Branch `phase-1-foundation`, 34 commits ahead of `main` before this document.
- Host: NixOS, Node v24.21.0, npm 11.19.0; local date 2026-09-26.
- The run deliberately starts from **`rm -rf data`** — the database, the name
  tables and the first-startup import are all rebuilt from the real sibling repos.
  Pre-state (recorded before deleting): 2,271 `entry_status` rows, 7
  `status_history` rows, 15 `sync_history` rows, `user_name="Jason"`.

## Artifacts in this directory

| File | What it is |
|---|---|
| `spotcheck.txt` | full raw output of the fresh sync spot-check (L89) — 108 checks, 0 failures |
| `sync-run2.txt` | raw output of the second full `npm run sync` (L91) |
| `sync-run1-counts.json`, `sync-run2-counts.json` | name-table counts before/after run 2 — byte-identical for all 7 tables |
| `schema.txt` | fresh-DB `sqlite_master` dump (L86) — 11 tables, 3 indexes |
| `restart.txt` | server log of the restart (L93) — zero import lines |
| `entry-status-final.txt` | final per-type `entry_status` breakdown |
| `api-matrix.txt` | raw curl matrix (L92/L94/L95/L96/L97) |
| `tests.txt` | fresh `npm test` + `npm run test:ui` summaries (L100/L102) |
| `p1-gate-1-01-settings-fresh-db.png` | settings after the rebuild, identity persisted |
| `p1-gate-1-02-sync-toast-fresh.png` | the fresh UI sync's success toast |

## The 19 checkboxes

| # | Checkbox (plan line) | Fresh re-run: method and result |
|---|---|---|
| 1 | dev stack + proxy + no console errors (L85) | `npm run dev` on the rebuilt DB: Express `:3001` + Vite `:5173`. A **page-context** `fetch('/api/settings')` from `http://localhost:5173` returned the real payload — i.e. the Vite `/api` proxy → `:3001` path, not just a curl to the API. `browser_console_messages all:false` on fresh loads of `/`, `/settings` and `/drop-tables`: **0 errors, 0 warnings**. |
| 2 | fresh DB: 11 tables + 3 indexes (L86) | `schema.txt`: `tables (11): drop_tables, entry_status, items, npcs, quests, settings, spells, status_history, string_table, sync_history, zones`; `indexes (3): idx_entry_status_key/-status/-type on entry_status`. |
| 3 | spike 1.4a findings in the PR description (L87) | Recorded in this PR's body (output tree, template format, `.lang` location, timings) and in [`../spike-1.4a.md`](../spike-1.4a.md). |
| 4 | `npm run sync` reports non-zero counts, `sync_history` success (L88) | Fresh DB, fresh unpack: `status SUCCESS`, items 79,835 · spells 18,173 · npcs 23,033 · quests 322 · zones 1,241 · drop_tables 317 · string_table 216,991, `sync_history: success row written`, unpack/scan/write 16.6 s/3.4 s/440 ms, total 20.5 s. |
| 5 | spot-check vs unpacked source + a quest title through `string_table` (L89) | `spotcheck.txt` — **checks: 108 failures: 0** (seed 20260927, 5 rows/table, re-read from source): items/npcs ids equal the manifest `m_id` **and** the embedded `m_templateID`; spells resolved `template_id → m_filename → _deser.json`; corpus spell coverage with concrete triples; `drop_tables` Name/Description; zones vs `ZoneTransfer/*.json`; `string_table` compared **byte-for-byte** against the real `Locale/en-US` `.lang` files (5,132 parsed); and the required quest case — `m_questTitle="QuestTitle_992B"` → `lookupString` = **"Payback"**, `m_questLevel=17` matching (line 230ff), plus the hex/decimal collision quest `DS-ACAD-C01-001` / `QuestTitle_298DE` (line 262). |
| 6 | `.lang` parser tests incl. `QuestTitle_1ED8D → 126349` + sparse fixture (L90) | `npm test` green; `tests/unit/lang.test.ts:98` asserts `resolveLangKey('QuestTitle_1ED8D')` → `"Quest for Perfection"` (0x1ED8D = 126349) against the sparse-index fixture `lang_sparse_index.lang`. |
| 7 | re-running sync replaces, not duplicates (L91) | Second full sync: `sync-run1-counts.json` vs `sync-run2-counts.json` — items/spells/npcs/quests/zones/drop_tables/string_table **identical** (79,835 / 18,173 / 23,033 / 322 / 1,241 / 317 / 216,991); only the append-only `sync_history` grew 1 → 2. |
| 8 | names API shapes + unknown id → 404 (L92) | `api-matrix.txt`: `{"items":[{"gid":4808,"name":"Twice Stitched Boots"},…]}`; `GET /api/names/items/4808` → `{"gid":4808,"name":"Twice Stitched Boots"}`; `999999999` → `{"error":"Unknown items id \"999999999\""} [HTTP 404]`; zones → `{"zones":[{zone_path,display_name,world}]}`; spells/npcs → `{template_id,name}`. |
| 9 | first startup imports exactly once; restart does not change counts (L93) | Fresh boot: `Imported 2271 existing entries from SpiralDB`, `import detail: 3 skipped, 0 unparsable`, duplicate keys reported (`WizardCity/Tutorial_Exterior`, `WizardCity/Tutorial_Interior`); one single `extracted_at` value across all 2,271 rows (one transaction); **quest 322 / drop_table 317** exactly. Restart (`restart.txt`): **0 import lines**, `entry_status` still 2,271 with the same per-type breakdown and the reviewed row intact, and `GET /api/status/_import` → `{"ran":false,"imported":0,"imported_at":null}`. |
| 10 | `status/quests?status=extracted` = 322 + `summary.total=322` (L94) | `entries: 322 summary: {"total": 322, "extracted": 322, "reviewed": 0, "verified": 0}`. |
| 11 | PATCH + history + `reviewed_at`/`reviewed_by`; identity modal (L95) | Measured: 3 history rows with `old_status`/`new_status`/`notes`/`changed_by`/`changed_at`; a backwards `reviewed→extracted` is allowed and does **not** clear the existing `reviewed_at` (D15/D37); the final forward transition records `reviewed_by: "Jason"` after the identity was set through the Settings page. The pre-identity PATCH (with `user_name:""`) also returns 200 with `changed_by:""` — D38's documented server-side attribution path. **The "user-identity modal appeared first" clause is deferred — see D43 below.** |
| 12 | dashboard: per-type sums = overall; `percent_verified` matches (L96) | `overall: {"total":2271,…,"percent_verified":0}`; `sum(types) = 2271 = overall.total`; all **eight** singular keys present including `npc_drop_table: 0`; `0 == round(100·0/2271, 1)`. |
| 13 | settings PUT persists, GET reflects, invalid path → 400 (L97) | Through the UI: Save (disabled until dirty) → toast "Settings saved" → header shows the name → **after reload** `#user_name` = "Jason" and `GET /api/settings` → `user_name:"Jason"`. Invalid: `{"error":"aurorium_path \"/nope\" is not an existing directory"} [HTTP 400]`; unknown key → 400 listing the allowed keys in `SETTINGS_KEYS` order. |
| 14 | sidebar navigates every route, collapse, active highlight, Sync spinner → toast (L98) | `npm run test:ui` (L102) covers the 12-route sweep, collapse and one-active-item; this run additionally re-verified the **live** button on the rebuilt DB: spinner after **88 ms** (`Syncing…`, `lucide-loader-circle … animate-spin`, disabled) → success toast after **22.6 s** (the cold full-unpack path this time) `"Sync complete: 79,835 items · 18,173 spells · 23,033 NPCs · 322 quests · 1,241 zones"`, `data-type=success`, emerald accent `rgb(16,185,129)` with `borderTopWidth: 0px` — screenshot `p1-gate-1-02-sync-toast-fresh.png`. |
| 15 | `FriendlyNameDropdown` real names for items/spells/npcs, raw id stored (L99) | Fresh on the rebuilt tables: items "Twice Stitched Boots" → hidden `preview_items=4808`; spells "Firecat Alley" → `preview_spells=607923`; npcs "AZ-Parrot-Darkshaman-A_StandIn (1397242)" → `preview_npcs=1397242`; **each raw id cross-checked against `GET /api/names/<type>/<id>`** so a hardcoded table could not pass. Unfiltered opens report `showing 50 of 79,835`, `… of 18,173`, `… of 23,033` (D39 cap). |
| 16 | unit tests green (L100) | `tests.txt`: `Test Files 20 passed (20)`, `Tests 512 passed (512)`. |
| 17 | `ci.yml` runs on pull_request — **verified by this PR's own check run** (L101) | Recorded in the PR section below from the live check run (including the headless-chromium install step). |
| 18 | `npm run test:ui` green; browsers dir gitignored (L102) | `tests.txt`: `8 passed`; `git check-ignore -v tools/.playwright-browsers data/` → `.gitignore:23:tools/.playwright-browsers/` and `.gitignore:5:data/`. |
| 19 | UI criteria evidenced per D23 tier 2 (L103) | Committed: `../tier-2-ui-pass.md` + 5 screenshots (p1-14), plus this round's `p1-gate-1-01/02` screenshots and the JSON assertions above. |

## What did **not** fully hold (stated, not smoothed over)

**L95's modal clause — deferred as D43.** At the phase boundary the identity gate's
provider is mounted in `App.tsx` and `UserNameDialog` / `useUserNameGate` /
`lib/user-name.ts` all exist, but **nothing in the Phase-1 UI calls the gate or
`patchStatus`**: task 1.8 replaced the task-1.1 `App.tsx` diagnostic surface (quest
picker + "Mark reviewed") exactly as D38 anticipated, and every editor route ships
as a Phase-2..5 stub. So a status transition or save has no Phase-1 entry point and
the dialog is unreachable. The decision logic is covered by
`tests/unit/user-name-gate.test.ts`; the server attribution path and the reachable
persistence path (Settings → reload → attributed transition) are measured above.
D43 makes Phase 2's first editor/save action the mandatory first caller and requires
a tier-1 spec that drives it. This is a real gap with a home, not a checkbox quietly
ticked.

**Two probe mistakes I corrected rather than reporting as defects:**
`GET /api/status/:type/:key` → 404 `{"error":"Not found"}` is correct — that route is
not in `spec-api.md` L52–112 and not mounted (only `:type`, `:type/:key/history`,
`PATCH :type/:key`, `_import`, `all`, `dashboard` exist); and
`GET /api/sync/history?limit=1` returning the whole history is spec-conformant —
that endpoint defines no `limit` parameter.

**Environment facts worth carrying forward:** `rm -rf data` re-seeds
`git_branch` from the *local* date, so the rebuilt DB has
`content/2026-09-26` where the old one had `content/2026-09-25` (D3/D31c
behaviour) — which sharpens D42: the seeded branch advances on its own and the user
still has no UI field to change it. A cold UI sync (fresh unpack, no reusable tree)
took 22.6 s against 2.4 s warm; both paths succeed with identical counts.