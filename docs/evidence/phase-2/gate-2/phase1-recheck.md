# gate-2 — Phase 1 (19 checkboxes) re-run FRESH at the Phase-2 boundary

Story **gate-2** (`docs/plan-phase-2-quest-extraction.md` Verification Steps 1–8 +
`docs/plan-overview.md` "Regression gate"). Every Phase-1 checkbox was re-run **fresh now**, not
cross-referenced from gate-1 — the point of a boundary regression gate is to catch what later work broke.

- Branch `phase-2-quest-extraction`, head `09ace95` (the gate commit adds only evidence/docs).
- Host: NixOS, Node v24.21.0, `.NET SDK 9.0.318`; the stack ran on a **throwaway DB** via the documented
  `SPIRALDB_UI_DB` / `npm run sync -- --db <path>` overrides (D44) — the owner's live
  `data/spiraldb-ui.db` was never the target of a destructive operation.
- Raw artifacts in this directory: `phase1-recheck-mechanical.txt` (schema, two syncs, spotcheck,
  the sync-count JSONs), `phase1-recheck-api.txt` (#8–#13, #16, #18), `spotcheck.txt`,
  `sync-run1-counts.json`, `sync-run2-counts.json`, and 4 screenshots (`gate2-0*.png`).

| # | Checkbox | Fresh re-run at the Phase-2 boundary |
|---|---|---|
| 1 | dev stack + proxy + no console errors | `npm run dev` → :5173 + :3001. A **page-context** `fetch('/api/settings')` from :5173 returned **HTTP 200** with the 5 real keys `aurorium_path,git_branch,imcodec_path,spiraldb_path,user_name` (the Vite proxy path, not just curl). A per-page `console` listener captured **0 errors** across `/`, `/settings`, `/drop-tables`. |
| 2 | fresh DB: 11 tables + 3 indexes | `phase1-recheck-mechanical.txt`: `tables (11): drop_tables, entry_status, items, npcs, quests, settings, spells, status_history, string_table, sync_history, zones`; `indexes (3): idx_entry_status_key, idx_entry_status_status, idx_entry_status_type`. |
| 3 | spike 1.4a findings recorded | [`../../phase-1/spike-1.4a.md`](../../phase-1/spike-1.4a.md) (output tree, template format, `.lang` location, timings). Carried into the gate-2 PR body; unwritten by Phase-2 work. |
| 4 | `npm run sync` non-zero counts + `sync_history` success | Fresh throwaway DB: **SUCCESS** — items **79,835** · spells **18,173** · npcs **23,033** · quests **322** · zones **1,241** · drop_tables **317** · string_table **216,991**; unpack/scan/write 15.5 s/3.4 s/432 ms, total 19.3 s; `sync_history: success row written`. |
| 5 | spot-check vs the unpacked source | `spotcheck.txt`: **checks 108, failures 0** (seed 20260926) against the fresh throwaway DB. |
| 6 | `.lang` parser tests incl. the hex→dec case | `npm test` — the lang-parser suite is part of the **770 tests in 30 files**, all passing (gate-1 originally proved `QuestTitle_1ED8D → 126349`; re-run green now). |
| 7 | re-running sync replaces, does not duplicate | `sync-run1-counts.json` vs `sync-run2-counts.json`: **byte-identical on all 7 tables** after a second full 20.0 s run. `sync_history` is append-only (a row per run) — that is the table's design, not duplication. |
| 8 | names API shapes + unknown id → 404 | `items`: `{"items":[{"gid":1740074,"name":" +100 Energy Elixir"},…]}`; `items/4808` → `{"gid":4808,"name":"Twice Stitched Boots"}`; `items/999999999` → **HTTP 404** `{"error":"Unknown items id \"999999999\""}`; `zones?q=Hub`, `spells/607923` → `{"template_id":607923,"name":"Firecat Alley"}`, `npcs/1397242` → `{"template_id":1397242,"name":"AZ-Parrot-Darkshaman-A_StandIn"}`. |
| 9 | first startup imports exactly once; restart does not change counts | First boot: `Imported 2271 existing entries from SpiralDB`, `import detail: 3 skipped, 0 unparsable`, duplicate-key report; `entry_status` = creature_spellbook 134 · drop_table 317 · npc_inventory 215 · npc_spell_inventory 77 · **quest 322** · treasure_card_inventory 1 · zone_transfer 1205. Restart: **0 import lines**, log says `first-startup import skipped (entry_status already has rows)`, `/api/status/_import` → `{"ran":false,"imported":0,"imported_at":null}`, counts unchanged 2271. |
| 10 | `?status=extracted` → 322 + `summary.total=322` | `entries: 322  summary: {"total":322,"extracted":322,"reviewed":0,"verified":0}`. |
| 11 | PATCH extracted→reviewed with notes; history + `reviewed_at`/`reviewed_by` | `PATCH` → the bare row with `status:"reviewed"`, `reviewed_at` set, `latest_notes:"gate-2 phase-1 recheck"`; history `extracted -> reviewed \| by Gate-2 Recheck`; DB row shows `reviewed_at_set=1`, `reviewed_by="Gate-2 Recheck"`. **The identity modal is still deferred as D43** (nothing in the Phase-1/2 UI calls the gate on *these* stub routes) — stated in gate-1's record and still true; the real gate ordering was proven in p2-07/p2-09 where the extraction and status flows call it. |
| 12 | dashboard: per-type sums == overall; `percent_verified` | `overall {"total":2271,"extracted":2270,"reviewed":1,"verified":0,"percent_verified":0}`; **8 type keys** including `npc_drop_table`; `sum(type totals) == 2271 == overall.total` → **true**; `percent_verified` matches the computation. |
| 13 | settings PUT persists, GET reflects, invalid rejected | `PUT {"aurorium_path":"/nope"}` → **HTTP 400** `{"error":"aurorium_path \"/nope\" is not an existing directory"}`; `PUT {"nonsense":1}` → **HTTP 400** `{"error":"Unknown settings key: nonsense. Allowed keys: aurorium_path, imcodec_path, user_name, spiraldb_path, git_branch"}`; `GET` reflects a persisted `user_name`. |
| 14 | sidebar navigates every route, collapse, active highlight; Sync button spinner → toast | **12/12 nav hrefs resolve** (asserted against the nav's own `href` list, not a guessed one) with exactly **one** `aria-current="page"` per route; headings all render. Live **Sync**: button `Sync` → `Syncing…` (disabled, ~22 s) → `Sync` + toast **"Sync complete: 79,835 items · 18,173 spells · 23,033 NPCs · 322 quests · 1,241 zones"** (`gate2-04-sync-toast-fresh.png`). |
| 15 | `FriendlyNameDropdown` shows real synced names, stores the raw id | Live on the stub preview (`gate2-03-friendly-dropdowns.png`): items — option **"Twice Stitched Boots"** → hidden `preview_items=4808`; spells — **"Firecat Alley"** → `preview_spells=607923`; npcs — **"ArrotToMerles (161001)"** → `preview_npcs=161001` (the same value gate-1 recorded). |
| 16 | unit tests green | `npm test`: **30 files / 770 tests passed** (Phase 1 closed at 20 files; the Phase-2 suites are additive). |
| 17 | `ci.yml` runs on pull_request, verified by the PR's own check run | Proven by **this gate's own PR run** — the `ci` job on the Phase-2 PR head (id/log recorded in `../../phase-1/gate-1/ci-check-run.txt` for Phase 1 and in the PR section of [`../gate-2.md`](../gate-2.md) for this gate). |
| 18 | `npm run test:ui` green; browsers dir gitignored | **66 passed** (the Phase-2 additions take it from 8 to 66); `git check-ignore -v tools/.playwright-browsers data/` → `.gitignore:23:tools/.playwright-browsers/`, `.gitignore:5:data/`. |
| 19 | UI criteria evidenced per D23 tier 2 | Re-driven this round: the shell/proxy/console/sidebar/sync/dropdown pass above + `gate2-0*.png`; the extraction-chain pass is [`../story-p2-10-tier2.txt`](../story-p2-10-tier2.txt) with `p210-0*.png`. Phase-1's durable record stays [`../../phase-1/tier-2-ui-pass.md`](../../phase-1/tier-2-ui-pass.md). |

## Probe artifacts I hit and resolved (recorded, not smoothed over)

- **`--db-file` is not a flag** — the sync CLI's flag is `--db` (`server/src/services/sync/cli.ts`
  L51–57) and it *does* warn about unknown options (L212). My first attempt therefore ran against the
  default DB path; the live DB was verified intact afterwards and all counts are recorded above.
- **Two of my own selectors were wrong, not the app**: a singular `/treasure-card-inventory` (the real
  route is `/treasure-card-inventories`) returned "Not found" with no active link, and
  `[data-testid=preview-*]` does not exist — `SharedComponentsPreview` labels its dropdowns
  `Preview <type> friendly name dropdown`.
- **The extraction spinner**: `document.querySelector('[role=status]')` returned an empty string because
  there are **two** status regions and the first is an empty `sr-only` live region; the second carries
  "Extracting quests..." (`["", "Extracting quests..."]`, `svg.animate-spin`, 0 `[role=progressbar]`).
