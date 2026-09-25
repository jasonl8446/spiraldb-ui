# SpiralDB UI — Implementation Plan: Overview

**Status:** pending approval — no implementation has started
**Date:** 2026-09-25 (rev 2 — decision interview complete: Q1–Q5 resolved, execution model fixed, survey gaps D16–D26 folded in)
**Sources:** the five spec documents in `Docs/`, `AGENTS.md` (Implementation Phases), a same-day environment probe of this machine, and a read-only survey of the live SpiralDB fork / Imlight loader (results below).

## Execution model (fixed by owner decision, 2026-09-25)

- **Harness:** `autopilot` (goal-driven, unattended). QA loop ≤5 per phase; same-error 3× → stop.
- **Branches/PRs:** one branch per phase (`phase-1-foundation`, …); phase N branches from phase N−1's branch HEAD **immediately after N's PR opens — no merge wait** (chaining). PR per phase via GitHub MCP (`jasonl8446/spiraldb-ui`). A change-request on an open PR is folded forward by a follow-up task on that branch.
- **Regression gate:** at every phase boundary, re-run the full acceptance suite of all previous phases before starting new work.
- **Ambiguity auto-resolution rule (standing instruction):** any ambiguity not covered by specs/plan/this decision list is resolved by following the detailed specs (`spec-domain-reference.md` wins on domain shape, `spec-data-model.md` on storage/naming, `spec-api.md` on endpoints), recording the decision as a new D-item in this file, and continuing. Never silently improvise; never stall waiting for a human.
- **UI evidence protocol:** UI acceptance criteria are proven with Playwright MCP — DOM assertions plus screenshots committed as evidence artifacts under `Docs/evidence/phase-{n}/`. "Manual browser walkthrough" is not valid unattended evidence.

### Owner prerequisites (before autopilot starts — the only human actions in the whole run)

1. **Install the .NET 9 SDK** so `dotnet --version` ≥ 9 succeeds in the agent's shell (e.g. `nix profile install nixpkgs#dotnet-sdk_9` or NixOS config). Verified absent on 2026-09-25.
2. **Provide 1–2 real packet-capture `.json` files** in `server/test/fixtures/captures/` (or name a path). Fallback if absent at Phase 2 start: agent builds a synthetic fixture from `Packets.cs`/`QuestBuilder.cs` and flags it prominently in the Phase 2 PR.
3. **Approve this plan** (status line above flips to `approved`).

This document is the entry point for the phased build plan. One document per phase:

| Phase | Document | Depends on |
|---|---|---|
| 1 — Foundation | [plan-phase-1-foundation.md](./plan-phase-1-foundation.md) | — |
| 2 — Quest Extraction | [plan-phase-2-quest-extraction.md](./plan-phase-2-quest-extraction.md) | Phase 1 + .NET SDK (Q2) |
| 3 — Quest Editing | [plan-phase-3-quest-editing.md](./plan-phase-3-quest-editing.md) | Phase 2 |
| 4 — Other Object Editors | [plan-phase-4-object-editors.md](./plan-phase-4-object-editors.md) | Phase 1; reuses Phase 3's RequirementTreeEditor |
| 5 — Dashboard & Polish | [plan-phase-5-dashboard-polish.md](./plan-phase-5-dashboard-polish.md) | Phases 1–4 |

```
[1 Foundation] ──► [2 Quest Extraction] ──► [3 Quest Editing] ──┐
       │                                                          ├──► [5 Dashboard & Polish]
       └────────────────► [4 Object Editors] ─────────────────────┘
                          (reuses 3's RequirementTreeEditor)
```

Phases 3 and 4 may overlap once the RequirementTreeEditor (task 3.6) exists.

## How to use this plan

- Each phase document contains: Requirements Summary, Tasks (numbered `P.T`), Acceptance Criteria (testable checkboxes), Risks & Mitigations, and Verification Steps.
- Work one phase per branch/PR. A phase is **Done** only when every acceptance criterion passes with recorded evidence (command + observed output).
- Task IDs are stable references — cite them in commits (`plan: task 2.4 save pipeline`) and PR descriptions.
- When implementation reveals a spec gap, record the resolution in **Cross-Cutting Decisions** below (or the phase doc's Decisions section) rather than silently diverging.

## Verified environment baseline (probed 2026-09-25)

Facts confirmed on this machine; plans and acceptance criteria rely on them.

| Fact | Value | Consequence |
|---|---|---|
| Node / npm | v24.21.0 / 11.19.0 | ✅ Meets Node 18+ requirement |
| git | 2.54.0 | ✅ |
| .NET SDK | ❌ **not on PATH** (only nix-store shell completions/hooks present) | Blocks building `tools/PacketReaderCli` → Phase 2 hard prerequisite (Q2) |
| `imcodec` CLI | ✅ prebuilt binary runs: `/home/jason/Documents/git-projects/Imview/submodule/Imcodec/src/Imcodec.Cli/bin/Debug/net9.0/linux-x64/imcodec` (commands: `wad`, `op`, `bcd`) | Phase 1 sync does **not** need the .NET SDK → decision D3 |
| Root.wad | ✅ `/home/jason/Documents/git-projects/Aurorium/data/V_r806919.Wizard_1_610/Data/GameData/Root.wad` (295,405,277 bytes) | Matches the path pattern in [spec-domain-reference.md](./spec-domain-reference.md) L641–644; revision matches the spec's example |
| Imview.PacketReader | ✅ `/home/jason/Documents/git-projects/Imview/src/Imview.PacketReader/`, `net9.0`; `QuestBuilder.cs` L33: `public static async Task<List<QuestTemplate>> BuildQuestsFromPacketCaptureAsync(string packetCapturePath)` | Exactly the API assumed by [spec-domain-reference.md](./spec-domain-reference.md) L585 |
| SpiralDB repo | ✅ `/home/jason/Documents/git-projects/spiraldb/`, branch `main`, clean; **322** QuestTemplates, **317** DropTables; **no `NpcDropTable/` directory** | Baseline counts for acceptance criteria; import scan must tolerate missing directories ([spec-domain-reference.md](./spec-domain-reference.md) L21) |
| Sample packet captures | ❌ none found in the Imview repo | Owner provides real captures (prerequisite 2); synthetic fallback defined |
| SpiralDB remote | ✅ the local clone **is the owner's fork**: `origin=git@github.com:jasonl8446/spiraldb.git`, `upstream=Revive101/spiraldb` | Default `spiraldb_path` = this fork (D17) |
| Legacy filenames | ❌ do **not** follow the new-file convention: `droptables_ds-acad1-c01-001.json` (plural prefix), `NPCInventories_1025-A.json`, `WizardZoneDatas_10017-A.json`, `NpcTreasureCards_2019-A.json`; QuestTemplates **do** match (`questtemplates_{name}.json`) | Detail lookup + updates must use a content-keyed index and write back to the original path (D19) |
| QuestMetadatas | 324 files, **UUID-named** (e.g. `069f430e-….json`), paired to quests by the `Name`/`QuestTemplateId` field **inside** the file | Metadata updates must locate by content, not filename (D20) |
| GlobalRegistry | exactly one legacy file `GlobalRegistryModels_1-A.json` (23 keys); Imlight merges `Directory.EnumerateFiles` **unsorted, later wins** (`Imlight/src/Imlight.CoreLib/WizardData/SpiralDB.cs` L341–347) | Consolidate & replace on save (D22) |
| Full corpus counts | QuestTemplates 322, DropTables 317, NpcInventory 215, NpcSpellInventory 77, CreatureSpellbook 134, TreasureCardInventory 1, ZoneTransfer 1207, NpcDropTable **0 (dir absent)** | Acceptance baselines for Phases 1/4 |
| ZoneTransfer schema drift | real files contain an `Events` field absent from the spec schema | Merge-not-replace (D5) preserves it; editor shows it in raw-fields disclosure (task 4.8) |
| This repo | Docs only (`AGENTS.md`, `README.md`, `Docs/` × 5); HEAD `21596d5`; remote `jasonl8446/spiraldb-ui`, branch `main` | Greenfield; PR-per-phase workflow available |

## Cross-cutting decisions

Decisions the specs leave open, resolved here. Amend this list when reality disagrees.

- **D1 — Repository layout.** Single npm package (no workspaces) with:
  ```
  server/            # Express + TypeScript (tsx in dev, tsc for build)
    src/{index.ts, db.ts, routes/, services/}
  client/            # Vite + React app (vite root = client/)
    src/{components/, features/, hooks/, lib/}
  shared/            # Types + Zod schemas imported by both server and client
  scripts/           # sync-names.ts (npm run sync)
  tools/PacketReaderCli/   # .NET 9 wrapper (Phase 2)
  data/              # SQLite db (gitignored, per spec-architecture L146–154)
  ```
  Rationale: local single-user tool; one lockfile and one `npm run dev` (concurrently) beat workspace ceremony.
- **D2 — Add `multer`.** `POST /api/extract/quests` is multipart ([spec-api.md](./spec-api.md) L210–214) but no upload library appears in the spec's package list ([spec-architecture.md](./spec-architecture.md) L181–198). Use multer with disk storage, 512 MB cap.
- **D3 — Default `imcodec_path`.** The verified prebuilt binary path from the baseline table (spec allows "known Imview submodule path", [spec-data-model.md](./spec-data-model.md) L166). Override stays possible via Settings.
- **D4 — Status type-name mapping.** API routes use plural types (`quests`, `drop_tables`, … [spec-api.md](./spec-api.md) L56) while `entry_status.object_type` stores singular values (`quest`, `drop_table`, … [spec-data-model.md](./spec-data-model.md) L32–37). One mapping constant in `server/src/routes/status.ts`; unit-tested both directions.
- **D5 — Merge-not-replace serialization (fidelity rule).** Editors never rebuild a document from a partial schema. Load: `JSON5.parse` the original; keep it. Edits mutate/merge into the parsed original; unknown fields survive untouched. Save: `JSON.stringify(doc, null, 2)` ([spec-data-model.md](./spec-data-model.md) L238–253). Enforced by the corpus round-trip tests (tasks 3.2, 4 acceptance).
- **D6 — No DELETE endpoints in v1.** [spec-api.md](./spec-api.md) L174–204 defines only GET/GET-by-key/POST. Deletion remains a manual file+git operation. Revisit via Q3.
- **D7 — Add `@tanstack/react-query`.** Not in the spec stack table, but 15k-row name lists need caching + invalidation after sync/save; it is the least-code option consistent with the TanStack Table choice.
- **D8 — FriendlyNameDropdown implementation.** shadcn/ui Combobox (cmdk) over the cached `/api/names/:type` list, client-side filtering; raw ID in a hidden field (AGENTS.md rule 5). NPCs render `"Name (TemplateID)"` uniformly ([spec-domain-reference.md](./spec-domain-reference.md) L696–698); zones render the humanized form (L700–702). If >5k rows proves sluggish, add virtualization — measure first.
- **D9 — Extraction cancel.** Server tracks the extraction child process; client uses `AbortController`; on request abort the server kills the child. Cancel button per [spec-ui-design.md](./spec-ui-design.md) L216.
- **D10 — Test stack.** Vitest + Supertest (server); no e2e framework in v1 — each phase has a manual verification checklist instead. The corpus round-trip test is the primary safety net for Phases 3–4.
- **D11 — Commit conventions.** Agent-authored commits *in this repo* carry the DeepSeek Harness watermark trailer (AGENTS.md → `commit-watermark` skill). The app's *runtime* auto-commits to the SpiralDB repo use `spiraldb: {action} {object_type} {object_key}` authored by `settings.user_name` ([spec-data-model.md](./spec-data-model.md) L216–232) — no watermark there.
- **D12 — List endpoints read on demand.** `GET /api/quests` scans the directory and JSON5-parses files per request (322 local files is trivial); join with `entry_status` for status. Add caching only if measured slow. Quest list search/filter is client-side over the loaded list.
- **D13 — One commit per object save.** "Save All" of N extracted quests produces N sequential commits (message format is per-object, [spec-data-model.md](./spec-data-model.md) L216–223).
- **D14 — Dirty-repo guard.** Before any save, check `git status --porcelain` in the SpiralDB repo. If dirty, fail with an actionable error toast ("SpiralDB repo has uncommitted changes — resolve them first"). Never auto-stash user work.
- **D15 — Status transitions.** Any transition is allowed (including backwards, e.g. verified→reviewed after a regression); every change is logged to `status_history` with old/new/notes/changed_by. UI primarily surfaces forward actions ("Mark Reviewed", "Mark Verified"). Spec requires history preservation but forbids no direction ([spec-data-model.md](./spec-data-model.md) L9–19).
- **D16 — Execution harness & chaining.** Autopilot; phase branches + PRs; phase N+1 starts from phase N's branch HEAD without waiting for merge; full-regression gate at every phase boundary; ambiguity auto-resolution rule (see Execution model above). Owner-approved 2026-09-25.
- **D17 — SpiralDB target = owner's fork, configurable.** Default `settings.spiraldb_path` = `/home/jason/Documents/git-projects/spiraldb` (verified: `origin=jasonl8446/spiraldb`). Fully configurable via Settings/API. **Automated tests never touch it**: dev/test configuration points at `data/test-spiraldb/`, a disposable in-workspace `git clone` of the fork (gitignored, created by task 2.0, refreshed by re-clone). The real fork is written only by the app in owner-driven production use.
- **D18 — .NET builds are sandbox-safe.** Owner pre-installs the SDK once (prerequisite 1). All `dotnet build`/`restore` invocations keep artifacts inside this workspace: `-p:BaseIntermediateOutputPath=$PWD/tools/.obj -p:BaseOutputPath=$PWD/tools/bin` and `NUGET_PACKAGES=$PWD/tools/.nuget` — no writes into the Imview tree or `$HOME`. `tools/.obj/` and `tools/.nuget/` added to `.gitignore`.
- **D19 — Content-keyed index, original-path updates.** Because legacy filenames don't follow the convention (baseline table), `GET /:key` and update-saves resolve files through an in-memory index built by scanning each type's directory and JSON5-parsing the key field (rebuilt on save/startup; ~2,300 files total — trivial locally). **Updates always write back to the file's original path**; the `{prefix}_{key}.json` convention applies only to newly created entries.
- **D20 — Quest metadata pairs by content.** Existing metadata files are UUID-named; pairing is via the `Name` field ([spec-data-model.md](./spec-data-model.md) metadata shape). On quest save: scan `QuestMetadatas/` for a file whose `Name` matches → update it in place (refresh `ModifiedAt/ModifiedBy`); only when none exists create `questmetadata_{name}.json`.
- **D21 — Corpus-derived quests & zones tables.** Sync builds `quests` from the SpiralDB `QuestTemplates/` corpus (`m_questName`, `m_questLevel`, `m_mainline`, title via `string_table` lookup of `m_questTitle`) and `zones` from all distinct `ZoneName` + `m_destinationZone` values in the `ZoneTransfer/` corpus (1,207 files). WAD-derived sources are used only if spike 1.4a finds an authoritative list in the unpack. Owner-approved.
- **D22 — GlobalRegistry consolidate & replace.** Save writes the merged dictionary to `globalregistry.json` **and `git rm`s every other `GlobalRegistry/*.json` in the same commit** (`spiraldb: update global_registry globalregistry`). Rationale: Imlight's unsorted later-wins merge makes multiple files order-dependent; one file is deterministic; git history is the undo; the PR diff shows the consolidation before merge. Supersedes the Q5 warning-only approach.
- **D23 — Playwright UI evidence.** UI acceptance = Playwright MCP DOM assertions + screenshots under `Docs/evidence/phase-{n}/`, referenced from the PR. Applies to every phase's UI criteria, including a11y scans (axe-core via Playwright) in Phase 5.
- **D24 — Minimal CI.** `.github/workflows/ci.yml` created in Phase 1: on PR → `npm ci && npm test && npm run build`. Objective signal for async PR review.
- **D25 — Approved dependency additions.** `multer` (D2), `@tanstack/react-query` (D7), `@dnd-kit/sortable` (goal reordering, task 3.4), `dagre` + `@types/dagre` (flowchart auto-layout, task 3.5), `react-json-view-lite` (JSON side panel, task 2.7), ESLint + Prettier (scaffold, task 1.1). Owner-approved.
- **D26 — New files use the spec prefix even where legacy differs.** New DropTables are `droptable_{Name}.json` (singular, per [spec-data-model.md](./spec-data-model.md) L173–187) although legacy files use `droptables_`. Imlight loads by directory; the mixed prefixes are cosmetic. Owner-approved.
- **D27 — Phase 5 API extensions.** Two endpoints beyond [spec-api.md](./spec-api.md): `GET /api/activity?limit=10` (status_history × entry_status join for the dashboard feed) and `GET /api/search?q=&limit=20` (cross-type key + friendly-name search for the ⌘K palette). Task 5.7 appends both to `spec-api.md` so the spec stays authoritative.

## Spec gaps & open questions — ALL RESOLVED (2026-09-25)

- **Q1 — GlobalRegistry verification tracking → RESOLVED: no tracking.** 8 types carry the extracted→reviewed→verified lifecycle; GlobalRegistry gets an editor only. Follows the detailed specs ([spec-data-model.md](./spec-data-model.md) L32–37, L277; [spec-api.md](./spec-api.md) L56) over AGENTS.md's "all 9 types" wording. Owner-confirmed. AGENTS.md wording to be corrected in task 5.7.
- **Q2 — .NET SDK provisioning → RESOLVED: owner pre-installs once** (prerequisite 1) + sandbox-safe build flags (D18). No mid-run approvals needed.
- **Q3 — Delete support → RESOLVED: none in v1** (D6 stands). Deletion remains a manual git operation. Owner-confirmed.
- **Q4 — Stale README links → RESOLVED 2026-09-25 (pre-Phase-1):** README rewritten to link the five specs + six plan docs, with a project-status note; AGENTS.md Q1 wording corrected in the same pass. Task 5.7 still re-audits both against implemented reality (prerequisites, scripts, `npm run build:cli` flags).
- **Q5 — GlobalRegistry multi-file semantics → RESOLVED: consolidate & replace (D22)**, based on verified Imlight loader behavior (`SpiralDB.cs` L341–347). Owner-confirmed.

## Quality bar (applies to every phase)

1. **Fidelity first.** D5 + corpus round-trip tests gate Phases 3–4: parse → serialize → re-parse must deep-equal for every existing SpiralDB file of each touched type.
2. **Validation per spec.** Quest rules ([spec-domain-reference.md](./spec-domain-reference.md) L528–534), DropTable rules (L536–540), general rules (L542–546): inline field errors, form-level banner, Save disabled while errors exist (L547). Server re-validates on every POST.
3. **Acceptance criteria are commands.** ≥90% must be checkable by running something (curl/npm/git/vitest/Playwright) and observing output — no "looks right".
4. **Spec deviations get recorded.** Any divergence from `Docs/spec-*.md` lands in this overview's decisions list in the same PR.
5. **External repos are read-only** except: the test clone `data/test-spiraldb/` (written freely by tests), and the owner's fork in production use only (D17). Imview/Aurorium/Imlight/Imcodec trees are never written (D18).
6. **Unattended-evidence rule (D23).** Every UI criterion ships Playwright assertions + screenshots; every data criterion ships command output. Evidence paths are linked in the phase PR.
7. **Regression gate (D16).** No phase starts before all previous phases' acceptance suites re-pass.

## Milestone exit criteria (summary)

| Milestone | Exit criterion (one line) |
|---|---|
| M1 (Phase 1) | `npm run sync` populates friendly names from the real Root.wad; names/status/dashboard/settings APIs live against real data (322 quests imported); app shell navigates all routes |
| M2 (Phase 2) | A packet capture uploaded through the UI becomes committed quest files + metadata on a `content/YYYY-MM-DD` branch with `extracted` status |
| M3 (Phase 3) | Any of the 322 real quests can be fully edited (goals, logic, requirements, results, dialog) with validation and zero field loss (round-trip proven) |
| M4 (Phase 4) | All 8 remaining object types + GlobalRegistry have working list/detail/create/edit/save+commit flows |
| M5 (Phase 5) | Dashboard, global search, error/a11y/responsive passes done; `npm run build && npm start` serves the production app on :3001 |

## Related Documentation

- [spec-architecture.md](./spec-architecture.md) — system overview, tech stack, server config
- [spec-data-model.md](./spec-data-model.md) — SQLite schemas, lifecycle, file naming, git strategy
- [spec-api.md](./spec-api.md) — REST endpoints and frontend routes
- [spec-domain-reference.md](./spec-domain-reference.md) — JSON schemas, enumerations, validation, CLI wrapper, sync internals
- [spec-ui-design.md](./spec-ui-design.md) — layout, components, interaction patterns
