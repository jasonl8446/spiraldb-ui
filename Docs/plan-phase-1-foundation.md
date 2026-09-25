# Phase 1 — Foundation

**Status:** pending approval
**Depends on:** nothing (no .NET SDK needed — the prebuilt `imcodec` binary is verified working, see [plan-overview.md](./plan-overview.md) baseline)
**Spec reading order before starting:** [spec-domain-reference.md](./spec-domain-reference.md) → [spec-architecture.md](./spec-architecture.md) → [spec-data-model.md](./spec-data-model.md) → [spec-api.md](./spec-api.md) → [spec-ui-design.md](./spec-ui-design.md)

## Requirements Summary

Deliver a running full-stack skeleton (Vite :5173 + Express :3001), the complete SQLite schema, the friendly-name sync pipeline against real Aurorium data, the names/status/dashboard/settings APIs, first-startup import of existing SpiralDB entries, and the app shell (sidebar, header, toasts, stub routes) with the two shared components every later phase needs: `FriendlyNameDropdown` and `StatusBadge`.

Scope boundary from AGENTS.md Phase 1: scaffolding, sync script + schema, names API, sidebar shell, status tracking schema + API. The Settings **page** is included here because sync configuration is a Phase 1 feature; the Dashboard **page** is not (stub only — built in Phase 5).

## Tasks

### 1.1 Project scaffolding — M
- Root `package.json`: dependencies per [spec-architecture.md](./spec-architecture.md) L181–198 plus the approved additions (D25): `multer`, `@tanstack/react-query`, `concurrently`, `tsx`, `vitest`, `supertest`, ESLint + Prettier (deterministic agent style). Scripts: `dev` (concurrently: tsx-watch server + vite client), `build`, `start`, `sync`, `test`, `lint`.
- Layout per decision D1 ([plan-overview.md](./plan-overview.md)): `server/`, `client/`, `shared/`, `scripts/`, `data/` (gitignored), `tools/` placeholder.
- `client/vite.config.ts` per [spec-architecture.md](./spec-architecture.md) L132–143: port 5173, proxy `/api` → `http://localhost:3001`.
- Express bootstrap `server/src/index.ts`: port 3001, `cors`, JSON body parsing, route mounting, error-handling middleware returning `{ "error": "..." }` shapes.
- `.gitignore`: `data/`, `tools/bin/`, `tools/.obj/`, `tools/.nuget/` (D18), `node_modules/`, `client/dist/` (spec L150–154).
- TypeScript strict mode; path alias `@shared/*`.

### 1.2 SQLite layer — S
- `server/src/db.ts`: better-sqlite3 opening `data/spiraldb-ui.db`; create `data/` if missing ([spec-architecture.md](./spec-architecture.md) L146–154). Synchronous single connection, no pooling (L156–158).
- Migration `0001_init.sql` (idempotent `CREATE TABLE IF NOT EXISTS`) with **all** tables and indexes exactly as specified in [spec-data-model.md](./spec-data-model.md) L21–162: `entry_status` (+3 indexes), `status_history`, `items`, `spells`, `npcs`, `quests`, `zones`, `drop_tables`, `string_table`, `sync_history`, `settings`.
- Seed `settings` defaults on first run ([spec-data-model.md](./spec-data-model.md) L164–169): `aurorium_path=/home/jason/Documents/git-projects/Aurorium`, `imcodec_path=` prebuilt binary path (D3), `user_name=` empty, `spiraldb_path=/home/jason/Documents/git-projects/spiraldb` (**the owner's fork**, D17 — fully configurable via Settings), `git_branch=content/{YYYY-MM-DD}` generated per session. Test/dev configurations override `spiraldb_path` to the in-workspace clone (D17); the seed default stays the fork.

### 1.3 Settings API — S
- `GET /api/settings` / `PUT /api/settings` per [spec-api.md](./spec-api.md) L291–321. PUT accepts partial updates; validate paths exist on disk and return 400 with an actionable message when not.

### 1.4 Friendly-name sync pipeline — L
The core Phase 1 deliverable. Full re-sync strategy, no incrementals ([spec-data-model.md](./spec-data-model.md) L279–289).

- **1.4a Spike first — S (de-risks everything below).** Manually run the prebuilt CLI:
  `imcodec wad unpack --deser {Root.wad} /tmp/wad-spike` and document: output tree shape, where ItemTemplate/SpellTemplate/ActorTemplate/PetTemplate/MountTemplate files land and their deserialized format, where `.lang` files land (expected `Locale/en-US/*.lang`, ~5,132 files — [spec-domain-reference.md](./spec-domain-reference.md) L666–671), wall-clock time, temp disk usage. Copy 2–3 real files into `server/test/fixtures/` for unit tests. Record findings in the PR description. If `wad unpack --deser` cannot produce templates, fall back to raw unpack + per-file `imcodec op` deserialization (the CLI exposes `op` commands).
- **1.4b Revision resolver — S.** Auto-detect latest: sort directory names under `{aurorium_path}/data/` alphanumerically descending, first match for `V_r*` ([spec-domain-reference.md](./spec-domain-reference.md) L646). Currently resolves to `V_r806919.Wizard_1_610` (verified). Settings override supported.
- **1.4c Unpack runner — S.** `execFile(imcodec_path, ['wad','unpack','--deser', rootWad, tempDir])`; temp dir under `os.tmpdir()`; always clean up in `finally`.
- **1.4d Template parsers — M.** All template types use `m_name` as display name ([spec-domain-reference.md](./spec-domain-reference.md) L654–660). Populate: `items` (gid, name), `spells` (template_id, name), `npcs` (template_id, name — flat list, **no type classification**, L696–698; include Pet/Mount template names in the same table so ID lookups never miss), `drop_tables` (name from SpiralDB `DropTables/*.json`, [spec-data-model.md](./spec-data-model.md) L121–126). **Corpus-derived tables (D21, owner-approved):** `quests` = scan SpiralDB `QuestTemplates/*.json` for `m_questName`/`m_questLevel`/`m_mainline`, title = `string_table` lookup of `m_questTitle` (raw-key fallback); `zones` = all distinct `ZoneName` + `m_destinationZone` values across the `ZoneTransfer/` corpus (1,207 files), display_name = humanized path ([spec-domain-reference.md](./spec-domain-reference.md) L700–702). Use WAD-derived quests/zones instead only if spike 1.4a surfaces an authoritative list.
- **1.4e `.lang` parser — M.** UTF-16LE with BOM `\xFF\xFE`; record structure `{index}\r\n\r\n{value}\r\n` ([spec-domain-reference.md](./spec-domain-reference.md) L673–685). Key mapping `{Category}_{HexIndex}` → decimal index (`QuestTitle_1ED8D` → 126349, L687–691). Index space is sparse. Store into `string_table` (key, value, category). Unit-test against a real fixture from 1.4a.
- **1.4f Transactional replace + history — S.** Within one better-sqlite3 transaction: delete all rows from the seven friendly-name tables, insert fresh rows, insert `sync_history` row (counts, revision, status `success|partial|failed`, error_message) ([spec-data-model.md](./spec-data-model.md) L139–152, L283–287).
- **1.4g API + script — S.** `POST /api/sync`, `GET /api/sync/status`, `GET /api/sync/history` per [spec-api.md](./spec-api.md) L235–287. `npm run sync` = `tsx scripts/sync-names.ts` reusing the same service module. Sync is synchronous-blocking with response only on completion; UI shows spinner (spec L529).

### 1.5 Names API — S
- `GET /api/names/:type` and `GET /api/names/:type/:id` per [spec-api.md](./spec-api.md) L5–44. Types: `items`, `spells`, `npcs`, `quests`, `zones`, `drop_tables`, `strings`. Single lookup returns 404 `{ "error": ... }` when missing. Missing string-table keys display raw key client-side, never error ([spec-domain-reference.md](./spec-domain-reference.md) L693–694).

### 1.6 Status API + first-startup import — M
- Type mapping per D4 (plural route ↔ singular column).
- `GET /api/status/:type` with `?status=` filter and `summary` counts; `type=all` aggregates ([spec-api.md](./spec-api.md) L52–88).
- `PATCH /api/status/:type/:key` — body `{status, notes?, changed_by?}`; updates `entry_status` (status, reviewed_at/verified_at, reviewed_by/verified_by) and inserts `status_history` row with old_status/new_status/notes/changed_by ([spec-data-model.md](./spec-data-model.md) L60–75). Transition policy per D15 (any direction allowed, always logged). 404 on unknown key.
- `GET /api/status/:type/:key/history` per [spec-api.md](./spec-api.md) L106–142.
- `GET /api/dashboard` per [spec-api.md](./spec-api.md) L144–164: per-type totals + overall + `percent_verified`.
- **First-startup import** ([spec-data-model.md](./spec-data-model.md) L255–277): when `entry_status` is empty — scan the 8 directories per the mapping table (L266–275), JSON5-parse each file for the key field, insert `status='extracted'`. **Tolerate missing directories** (`NpcDropTable/` does not exist today — verified). Skip `QuestMetadatas/`, `GlobalRegistry/`, non-JSON files, and the `droptables/` subdirectory inside `QuestTemplates/` (L277). Emit count for the UI toast "Imported {n} existing entries from SpiralDB". Runs once; skipped whenever the table has rows.

### 1.7 User identity — S
- `settings.user_name`; on first status transition or save with empty name, the client shows a one-time modal asking for it, saves to settings, never asks again ([spec-data-model.md](./spec-data-model.md) L225–232). Used for `changed_by`, later for metadata `CreatedBy/ModifiedBy` and git author.

### 1.8 UI shell + shared components — M
- **Theme**: dark-only; palette/surfaces/typography/spacing tokens exactly per [spec-ui-design.md](./spec-ui-design.md) L18–43 (zinc-950 background, blue-600 accent, status colors amber/blue/emerald L21–24, Inter + JetBrains Mono). Tailwind + shadcn/ui init (button, card, badge, tabs, dialog, accordion, popover, command, table, input, select, checkbox, slider, dropdown-menu, skeleton, progress, sonner).
- **Layout**: 260px fixed sidebar + 56px sticky header per [spec-ui-design.md](./spec-ui-design.md) L47–109. Nav groups (collapsible) exactly per L73–93: OVERVIEW / QUESTS / DATA / SETTINGS with all listed items. Active item `blue-600/10` bg + `blue-400` text; hover `zinc-800`; Lucide icons 18px. Header: page title from route, Sync button (spinner during sync → checkmark on success, L108), user avatar/name. Mobile: sidebar → hamburger overlay (L97) — full responsive pass is Phase 5, but the hamburger must not block navigation now.
- **Toasts**: sonner, bottom-right, max 3, success/error/info styling and durations per [spec-ui-design.md](./spec-ui-design.md) L111–123.
- **Routing**: React Router v6 `BrowserRouter`, Layout wrapping all routes from [spec-api.md](./spec-api.md) L325–350. Pages not yet built render a stub ("Arrives in Phase N") — nav stays complete.
- **`FriendlyNameDropdown`** per D8: props `{ type, value, onChange, allowEmpty? }`; hidden raw-ID field; display formats per [spec-domain-reference.md](./spec-domain-reference.md) L696–702. Backed by `useNames(type)` TanStack Query hook (staleTime: infinity; invalidated after sync/save).
- **`StatusBadge`**: dot + text (color **and** label, per accessibility rule [spec-ui-design.md](./spec-ui-design.md) L545) using the three status colors.
- **Settings page** (full, not stub): paths, user name, Sync Now button, last-sync summary, sync history table per [spec-ui-design.md](./spec-ui-design.md) L488–512.

### 1.9 Minimal CI workflow — S
- `.github/workflows/ci.yml` (D24): on pull_request → `npm ci && npm test && npm run build`. Nothing else — no deploy, no matrix. Gives async PR review an objective signal.

## Acceptance Criteria

All checks run against the real sibling repos on this machine.

- [ ] `npm install && npm run dev` → client serves on :5173, `/api/*` proxies to :3001, no console errors on the shell pages.
- [ ] Fresh DB boot creates `data/spiraldb-ui.db` with all 11 tables and 3 indexes (verify via `sqlite3 .schema` or a db introspection test).
- [ ] Spike 1.4a findings recorded (output tree, template format, .lang location, timing) in the PR description.
- [ ] `npm run sync` against the real Root.wad completes successfully and reports non-zero counts for items, spells, npcs, quests, zones, and string_table into `sync_history` with `status='success'`.
- [ ] Sync spot-check: 5 random rows per name table match the unpacked source files; one real quest's `m_questTitle` key (taken from an actual SpiralDB quest file) resolves via `string_table` to a human-readable value (not the raw key).
- [ ] `.lang` parser unit tests pass, including the hex→decimal mapping case `QuestTitle_1ED8D → 126349` ([spec-domain-reference.md](./spec-domain-reference.md) L688–689) and a sparse-index fixture.
- [ ] Re-running sync replaces (not duplicates) rows: table counts stable across two runs.
- [ ] `GET /api/names/items` and `GET /api/names/items/{gid}` match the response shapes in [spec-api.md](./spec-api.md) L22–44; unknown id → 404.
- [ ] First startup with an empty DB imports existing entries exactly once: `entry_status` quest count = 322 and drop_table count = 317 (verified corpus baseline); restart does not change counts.
- [ ] `GET /api/status/quests?status=extracted` returns 322 entries + `summary.total=322` on the fresh import.
- [ ] `PATCH /api/status/quests/{name}` extracted→reviewed with notes → `GET .../history` shows old/new/notes/changed_by/changed_at; `reviewed_at`/`reviewed_by` set; user-identity modal appeared first when `user_name` was empty.
- [ ] `GET /api/dashboard`: per-type totals sum to `overall.total`; `percent_verified` matches computation.
- [ ] Settings: `PUT` persists, `GET` reflects; invalid path rejected with 400 + message.
- [ ] UI: sidebar navigates every route (stubs render), group collapse works, active highlighting correct; header Sync button triggers `POST /api/sync`, shows spinner, then success toast with counts ([spec-ui-design.md](./spec-ui-design.md) L121).
- [ ] `FriendlyNameDropdown` renders real synced names for at least `items`, `spells`, `npcs` types; stores raw ID.
- [ ] Unit tests green: lang parser (incl. hex→dec mapping `QuestTitle_1ED8D → 126349`, [spec-domain-reference.md](./spec-domain-reference.md) L688–689, on a real fixture from spike 1.4a), D4 type mapping, filename/key mapping table ([spec-data-model.md](./spec-data-model.md) L173–187) as a pure function, import scanner against a fixture directory tree.
- [ ] `.github/workflows/ci.yml` exists and runs `npm ci && npm test && npm run build` on pull_request (verified by the phase PR's own check run).
- [ ] UI criteria above evidenced per D23: Playwright MCP assertions + screenshots committed under `Docs/evidence/phase-1/`.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| `imcodec wad unpack --deser` output shape unknown until run | Sync parsers built blind | Task 1.4a spike before any parser code; fallback to raw unpack + `imcodec op` per file |
| Root.wad is 295 MB; unpack time/temp space | Slow or failed sync | Measure in spike; temp dir on a volume with ≥5 GB free; spec accepts seconds-to-minutes full re-sync ([spec-data-model.md](./spec-data-model.md) L281) |
| `.lang` UTF-16LE parsing edge cases (BOM, CRLF, blanks) | Missing/garbled names | Unit tests on real fixtures captured during spike; missing keys degrade gracefully to raw key display (spec L693–694) |
| 15k-row dropdown sluggishness | Poor UX | D8: measure cmdk first, virtualize only if needed |
| Quest titles require string-table lookup before `quests` table can be filled | Ordering dependency in sync | Parse `.lang` files **before** templates in the sync sequence |
| better-sqlite3 native build fails on Node 24 | Blocked scaffolding | Known-good pairing check in task 1.1; pin version or use Node LTS via `.nvmrc` if required |

## Verification Steps

1. `rm -rf data && npm run sync` → observe counts printed; `sqlite3 data/spiraldb-ui.db 'select count(*) from items;'` etc.
2. `curl -s localhost:3001/api/names/items | head -c 400` → shape check.
3. `curl -s localhost:3001/api/status/all | jq .summary` → totals match file counts (`ls /home/jason/Documents/git-projects/spiraldb/QuestTemplates/*.json | wc -l` → 322).
4. PATCH then history via curl; verify `status_history` row.
5. `npm test` → all unit tests green.
6. Browser walkthrough: shell → settings → sync → toast; dropdown smoke test on a stub page.

**Done when:** all acceptance criteria checked with evidence recorded in the PR; decisions/deviations appended to [plan-overview.md](./plan-overview.md).
