# SpiralDB UI — Implementation Plan: Overview

**Status:** approved — 2026-09-26, by owner decision in the execution-model interview (D29); no implementation has started
**Date:** 2026-09-26 (rev 3 — execution model re-fixed for the unattended degraded-ralph run: D16 superseded by D29, D24 amended, CI skeleton pulled forward into the preflight PR)
**Sources:** the five spec documents in `Docs/`, `AGENTS.md` (Implementation Phases), a same-day environment probe of this machine, and a read-only survey of the live SpiralDB fork / Imlight loader (results below).

## Execution model (re-fixed by owner decision, 2026-09-26 — D29; supersedes the 2026-09-25 autopilot model)

- **Harness:** `ralph` in its goal-driven form ("degraded ralph" — this deployment exposes no `ralph` tool, so the loop rides native dsh goal continuation: `create_goal` + one story per round; the skill announces the degradation at launch). Single launch from a fresh session; unattended until verifier sign-off; circuit breaker `max_goal_rounds = 120`. Execution ledger: the structured PRD `.omd/prd/spiraldb-ui.json` (gitignored), generated from the five phase docs — **the phase docs + this overview remain authoritative**; divergence resolves toward them and is recorded via `prd_amend` (fail-closed amendment ledger). Completion is tool-enforced: `prd_check` rejects any `passes:true` claim without raw command evidence.
- **Branches/PRs + self-merge:** one branch per phase (`phase-1-foundation`, …), cut from `main`; a PR per phase via GitHub MCP (`jasonl8446/spiraldb-ui`), description linking the phase's `Docs/evidence/phase-{n}/` artifacts. **The agent merges its own PR via GitHub MCP once (a) CI is green and (b) the phase-boundary gate story has `passes:true` with evidence**; the next phase branches from the updated `main`. Merges are logged in `.omd/prd/progress.txt`. (The former "no merge wait / change-request folded forward" chaining existed because autopilot could not merge for itself; D29 replaces it.)
- **Regression gate:** at every phase boundary a PRD gate story (`gate-1`…`gate-4`) re-runs the full acceptance suite of all previous phases before any later-phase story may pass; `final-verify` is the last full sweep.
- **Final gate (ultragoal 3-part; PRD stories `final-deslop` / `final-review` / `final-verify`):** ai-slop-cleaner pass over the cumulative diff → independent `omd-agent-code-reviewer` review (fresh subagent context; findings become fix work, never self-approved where authored) → `verify` pass re-running every phase's Verification Steps. Afterwards the loop-level `omd-agent-verifier` sign-off sets `architectVerified` on every story.
- **Ambiguity auto-resolution rule (standing instruction):** any ambiguity not covered by specs/plan/this decision list is resolved by following the detailed specs (`spec-domain-reference.md` wins on domain shape, `spec-data-model.md` on storage/naming, `spec-api.md` on endpoints), recording the decision as a new D-item in this file, and continuing. Never silently improvise; never stall waiting for a human. PRD-side twin: an empirically false criterion is amended through `prd_amend` (evidence + reason mandatory), never deleted or weakened silently.
- **UI evidence protocol:** UI acceptance criteria are proven with Playwright MCP — DOM assertions plus screenshots committed as evidence artifacts under `Docs/evidence/phase-{n}/`. "Manual browser walkthrough" is not valid unattended evidence.
- **No-human contract:** between launch and verifier sign-off the loop performs zero `ask_user_question` calls and requests zero approvals; a fundamental blocker stops the run with a report instead (ralph stop condition). The human surface is exactly: preflight (✅ done — this revision's PR was the write-path smoke), the launch paste, suspend inhibition + quota check (prerequisites 4–5 below), +1 relaunch only after an abnormal exit, and post-hoc review of merged `main`.

### Owner prerequisites (the only human actions around the run)

1. ✅ **DONE (2026-09-25): .NET 9 SDK installed system-wide** via NixOS config — `dotnet --version` → **9.0.318** (`/run/current-system/sw/bin/dotnet`); sandbox-safe smoke build of `Imview.PacketReader` succeeded (0 errors, Imview tree untouched — see D18 for the proven flags).
2. ✅ **DONE (2026-09-26): plan approved** by the owner's execution-model interview decisions (D29); the status line above is flipped.
3. ✅ **DONE (2026-09-26): preflight write-path smoke** — this revision landed as the PR `preflight-ralph-execution-model`: branch push → PR opened → Actions green → GitHub-MCP merge → branch deleted, proving every unattended operation class (push, PR, CI poll, self-merge) before launch.
4. **Inhibit suspend for the run duration** (this machine is s2idle-capable; `sleep/suspend/hibernate` targets are linked): keep `systemd-inhibit --what=sleep --why="spiraldb-ui ralph run" --mode=block sleep infinity` alive in a background shell. An idle suspend parks the goal loop, and resuming costs a human keystroke.
5. **Confirm quota headroom immediately before launch** — `token_plan_quota` errored on read during preflight (2026-09-26, "not lossless JSON"); retry it and confirm ~120 rounds × executor subagents fit the budget.

Real packet captures are **no longer required** — decision D28 manufactures them from real fork quests (owner decision 2026-09-25). If a real capture ever surfaces (e.g. from the Oct 2025 "jay" imports), it is optional post-hoc validation, replayable against the Phase 2 acceptance suite.

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
- The ralph PRD (`.omd/prd/spiraldb-ui.json`, gitignored) is the execution ledger generated from these docs: story ids `p{phase}-{nn}` (tasks), `gate-{n}` (phase-boundary regressions), `final-*` (ultragoal gate). The phase docs stay the single home of the acceptance criteria — regenerate the PRD if they change.
- Work one phase per branch/PR. A phase is **Done** only when every acceptance criterion passes with recorded evidence (command + observed output).
- Task IDs are stable references — cite them in commits (`plan: task 2.4 save pipeline`) and PR descriptions.
- When implementation reveals a spec gap, record the resolution in **Cross-Cutting Decisions** below (or the phase doc's Decisions section) rather than silently diverging.

## Verified environment baseline (probed 2026-09-25)

Facts confirmed on this machine; plans and acceptance criteria rely on them.

| Fact | Value | Consequence |
|---|---|---|
| Node / npm | v24.21.0 / 11.19.0 | ✅ Meets Node 18+ requirement |
| git | 2.54.0 | ✅ |
| .NET SDK | ✅ **installed system-wide 2026-09-25**: dotnet 9.0.318 at `/run/current-system/sw/bin/dotnet`; `Imview.PacketReader` smoke build passes with D18 artifacts-layout flags (0 errors, 64s, Imview tree untouched) | Phase 2 gate **cleared**; D18 build recipe proven |
| `imcodec` CLI | ✅ prebuilt binary runs: `/home/jason/Documents/git-projects/Imview/submodule/Imcodec/src/Imcodec.Cli/bin/Debug/net9.0/linux-x64/imcodec` (commands: `wad`, `op`, `bcd`) | Phase 1 sync does **not** need the .NET SDK → decision D3 |
| Root.wad | ✅ `/home/jason/Documents/git-projects/Aurorium/data/V_r806919.Wizard_1_610/Data/GameData/Root.wad` (295,405,277 bytes) | Matches the path pattern in [spec-domain-reference.md](./spec-domain-reference.md) L641–644; revision matches the spec's example |
| Imview.PacketReader | ✅ `/home/jason/Documents/git-projects/Imview/src/Imview.PacketReader/`, `net9.0`; `QuestBuilder.cs` L33: `public static async Task<List<QuestTemplate>> BuildQuestsFromPacketCaptureAsync(string packetCapturePath)` | Exactly the API assumed by [spec-domain-reference.md](./spec-domain-reference.md) L585 |
| SpiralDB repo | ✅ `/home/jason/Documents/git-projects/spiraldb/`, branch `main`, clean; **322** QuestTemplates, **317** DropTables; **no `NpcDropTable/` directory** | Baseline counts for acceptance criteria; import scan must tolerate missing directories ([spec-domain-reference.md](./spec-domain-reference.md) L21) |
| Sample packet captures | ❌ none anywhere on this machine (full-disk search 2026-09-25); Imview has **no live-capture feature** — "Get Quests From Packet Capture" is a file picker feeding `QuestBuilder` (`QuestPacketReaderService.cs` L59) | Not a blocker: D28 fixture generator synthesizes captures from real fork quests |
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
- **D16 — Execution harness & chaining.** Autopilot; phase branches + PRs; phase N+1 starts from phase N's branch HEAD without waiting for merge; full-regression gate at every phase boundary; ambiguity auto-resolution rule (see Execution model above). Owner-approved 2026-09-25. **SUPERSEDED by D29 (2026-09-26)** — vehicle changed to degraded ralph; no-merge-wait chaining replaced by agent self-merge at green gates. The regression gate and the ambiguity rule carry over unchanged.
- **D17 — SpiralDB target = owner's fork, configurable.** Default `settings.spiraldb_path` = `/home/jason/Documents/git-projects/spiraldb` (verified: `origin=jasonl8446/spiraldb`). Fully configurable via Settings/API. **Automated tests never touch it**: dev/test configuration points at `data/test-spiraldb/`, a disposable in-workspace `git clone` of the fork (gitignored, created by task 2.0, refreshed by re-clone). The real fork is written only by the app in owner-driven production use.
- **D18 — .NET builds are sandbox-safe (flags proven 2026-09-25).** Owner installed the SDK system-wide (prerequisite 1 ✅: dotnet 9.0.318). All `dotnet build`/`restore` invocations use the **artifacts output layout**: `-p:UseArtifactsOutput=true -p:ArtifactsPath=$PWD/tools/.artifacts` plus env `NUGET_PACKAGES=$PWD/tools/.nuget` — per-project obj/bin isolation under one in-workspace root, zero writes into the Imview tree or `$HOME` (both verified: smoke build of `Imview.PacketReader` = 0 errors in 64s, Imview tree untouched, `~/.nuget` untouched, 287 MB of packages landed in `tools/.nuget`). ⚠️ **Never** use `-p:BaseIntermediateOutputPath`/`-p:BaseOutputPath` for these builds — they are global properties, so every referenced Imcodec project shares one obj directory and the build dies with CS0579 duplicate-attribute errors (empirically proven 2026-09-25). `tools/.artifacts/`, `tools/bin/`, `tools/.nuget/` are gitignored; build scripts symlink final executables into `tools/bin/` so the spec's `tools/bin/imview-packet-reader` path holds ([spec-domain-reference.md](./spec-domain-reference.md) L595–602). Note: `Imview.PacketReader` is a class library — the runnable exes are our wrapper (2.1) and fixture generator (2.1a).
- **D19 — Content-keyed index, original-path updates.** Because legacy filenames don't follow the convention (baseline table), `GET /:key` and update-saves resolve files through an in-memory index built by scanning each type's directory and JSON5-parsing the key field (rebuilt on save/startup; ~2,300 files total — trivial locally). **Updates always write back to the file's original path**; the `{prefix}_{key}.json` convention applies only to newly created entries.
- **D20 — Quest metadata pairs by content.** Existing metadata files are UUID-named; pairing is via the `Name` field ([spec-data-model.md](./spec-data-model.md) metadata shape). On quest save: scan `QuestMetadatas/` for a file whose `Name` matches → update it in place (refresh `ModifiedAt/ModifiedBy`); only when none exists create `questmetadata_{name}.json`.
- **D21 — Corpus-derived quests & zones tables.** Sync builds `quests` from the SpiralDB `QuestTemplates/` corpus (`m_questName`, `m_questLevel`, `m_mainline`, title via `string_table` lookup of `m_questTitle`) and `zones` from all distinct `ZoneName` + `m_destinationZone` values in the `ZoneTransfer/` corpus (1,207 files). WAD-derived sources are used only if spike 1.4a finds an authoritative list in the unpack. Owner-approved.
- **D22 — GlobalRegistry consolidate & replace.** Save writes the merged dictionary to `globalregistry.json` **and `git rm`s every other `GlobalRegistry/*.json` in the same commit** (`spiraldb: update global_registry globalregistry`). Rationale: Imlight's unsorted later-wins merge makes multiple files order-dependent; one file is deterministic; git history is the undo; the PR diff shows the consolidation before merge. Supersedes the Q5 warning-only approach.
- **D23 — Two-tier UI testing (Playwright validated end-to-end 2026-09-25).** **Tier 1 — in-repo Playwright suite (durable, CI-runnable):** `@playwright/test` (pinned version) specs in `tests/ui/`, headless via `npm run test:ui`; browsers isolated workspace-local (`PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers`, gitignored — same isolation philosophy as D18; do not rely on the Nix store browsers, whose revision is coupled to the system playwright package). Every phase ships specs for its flows: P1 shell navigation, P2 extraction (driven by D28-generated captures), P3 editor interactions, P4 list/detail per type, P5 a11y (`@axe-core/playwright`) + responsive viewports (375/768/1440). **Tier 2 — agent-side playwright-mcp evidence for acceptance runs:** validated workflow — serve the app over HTTP (`file://` is **blocked** by the MCP server), assert via `browser_snapshot`/`browser_evaluate` (returns JSON), screenshot with an **absolute path under `/home/jason/.cache/playwright-mcp/`** (the only writable allowed root; relative filenames resolve against the server cwd and fail — pinned via `--output-dir` in `~/.dsh/cordis.patch.yml` after the root-owned-cwd EACCES was diagnosed), then `cp` into `Docs/evidence/phase-{n}/` and commit. Smoke proof: `Docs/evidence/playwright-mcp-smoke-validated.png` (912×930) and `playwright-mcp-smoke-mobile-375.png` (exact 375×667 viewport emulation). "Manual browser walkthrough" is not valid unattended evidence.
- **D24 — Minimal CI.** `.github/workflows/ci.yml`: on PR → `npm ci && npm test && npm run build && npm run test:ui` (headless chromium; workflow runs `npx playwright install chromium` first). Objective signal for the self-merge gate (D29). **Amended 2026-09-26:** the workflow file was pulled forward into the preflight PR with its npm/playwright steps gated on `package.json` existing, so Actions is proven live before Phase 1; task 1.9 makes the full pipeline run for real on the Phase 1 PR (its acceptance criterion is unchanged: verified by that PR's own check run).
- **D25 — Approved dependency additions.** `multer` (D2), `@tanstack/react-query` (D7), `@dnd-kit/sortable` (goal reordering, task 3.4), `dagre` + `@types/dagre` (flowchart auto-layout, task 3.5), `react-json-view-lite` (JSON side panel, task 2.7), ESLint + Prettier (scaffold, task 1.1). Owner-approved.
- **D26 — New files use the spec prefix even where legacy differs.** New DropTables are `droptable_{Name}.json` (singular, per [spec-data-model.md](./spec-data-model.md) L173–187) although legacy files use `droptables_`. Imlight loads by directory; the mixed prefixes are cosmetic. Owner-approved.
- **D27 — Phase 5 API extensions.** Two endpoints beyond [spec-api.md](./spec-api.md): `GET /api/activity?limit=10` (status_history × entry_status join for the dashboard feed) and `GET /api/search?q=&limit=20` (cross-type key + friendly-name search for the ⌘K palette). Task 5.7 appends both to `spec-api.md` so the spec stays authoritative.
- **D28 — Synthetic capture fixture generator (no real captures needed).** A small .NET tool `tools/FixtureGen/` (same pattern as the CLI wrapper, sandbox-safe builds per D18) manufactures packet-capture files from **real fork quests**: deserialize a corpus `questtemplates_*.json` via Imcodec ObjectProperty (the corpus `$type` format is Imcodec's own), serialize its goal/dialog structures into the hex blobs QuestBuilder consumes (`GoalCompilation` offset 1, `ActorDialog` offset 16, `ClientTagList` offset 1, `MadlibBlock` offset 1 — verified in `QuestBuilder.cs` L164–509), and wrap them in `MSG_QUESTOFFER`/`MSG_SENDQUEST`/`MSG_SENDGOAL`/`MSG_ACTORDIALOG` envelopes (`{"data":{"name":…,"fields":{…}}}` — verified in `PacketReaderService.cs` L100–130). Phase 2 acceptance becomes a **closed-loop round-trip**: quest → capture → extract → quest′ ≈ quest, reproducible in every test run. Fallback ladder if blob layouts resist: minimal valid envelope with thin blobs (proves upload→CLI→review→save→commit plumbing), with deep reconstruction flagged in the PR. Owner-approved 2026-09-25.
- **D29 — Execution vehicle: degraded ralph + ultragoal final gate; agent self-merge (owner decisions, 2026-09-26 execution-model interview).** Supersedes D16. One human launch from a fresh session; the loop is ralph's documented degradation path (goal-driven, one story per round — no `ralph` tool exists in this deployment) over a single structured PRD `.omd/prd/spiraldb-ui.json` (62 stories: 55 task stories from the 53 numbered tasks + 4 phase-boundary gate stories + 3 ultragoal final-gate stories), `max_goal_rounds = 120` (sized ≈1.5× the happy-path story count; re-derive as stories × 1.5 + 10 if the PRD diverges). Evidence is tool-enforced (`prd_check` rejects evidence-less claims; `prd_amend` keeps a fail-closed ledger). Implementation delegates per story to fresh `omd-agent-executor` subagents, keeping the orchestrator context thin. Per-phase branch + PR remains the review artifact; **the agent merges each PR via GitHub MCP when CI is green AND the gate story passed with evidence**; the next phase branches from updated `main`; merges are logged in `progress.txt`. Rejected alternatives: **autopilot** (Phase-0 `ask_user_question` seams fail closed unattended; QA + dual validation end-loaded instead of per-phase; phase-granular resume; its ralplan/deep-interview linkage clauses don't recognize this repo's plan artifacts); **per-phase goal/ralph chaining** (ralph refuses to start under an active goal continuation; `create_goal` is not authorized during continuation rounds — a chain stalls after phase 1); **five separate runs** (five human launches). Known residual human touch: one relaunch after an abnormal exit (neither ralph nor goal auto-resumes; stale state is reported, never continued). **Branch protection on `main` (added post-preflight, 2026-09-26):** require a pull request before merging (required approvals = **0**, deliberately — GitHub forbids approving your own PR with the same account, so any review requirement would put a human back in the loop) + required status check **`ci`** + `enforce_admins` — the CI-green half of the self-merge gate is platform-enforced rather than agent discipline; the gate-story-evidence half stays a PRD contract.

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
7. **Regression gate (D16→D29).** No phase starts before all previous phases' acceptance suites re-pass — enforced as PRD gate stories under the same evidence contract as every other story.

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
