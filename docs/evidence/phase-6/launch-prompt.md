Run **Phase 6 unattended** as a degraded ralph loop in this repo (`/home/jason/Documents/git-projects/spiraldb-ui`).

**Execution ledger:** `.omd/prd/spiraldb-ui.json` (revision 10, 76 stories). **Cross-round memory:** `.omd/prd/progress.txt`. Read both at the start of every round — you have no conversation memory between rounds.

**Launch.** This deployment exposes no `ralph` tool, so announce that degradation once, visibly, then ride the native goal mechanism: `create_goal` with `max_goal_rounds: 120`, and advance exactly **one story per round**. Write ralph mode state via `mcp__omd-state__state_write` (`mode: "ralph"`, `current_phase: "execution"`, `max_rounds: 120`, `prd_path`).

**Story order is dependency order, and the PRD array is already in it:** `p6-01` … `p6-12`, then the boundary gate `gate-6`, then the three reset `final-*` stories. Pick the **first** story with `passes: false`.

**Each round:**
1. Read the PRD + `progress.txt`; take the next unpassed story.
2. Implement it. Delegate to `omd-agent-executor` via `subagent` where useful; run independent work in parallel.
3. **Evidence contract:** run the story's verification commands and put the **RAW** output in the round report. Never set `passes: true` without having run the checks — `prd_check` without evidence is rejected.
4. Mark completion with `mcp__omd-state__prd_check`. If measurement proves a criterion empirically false, amend it with `mcp__omd-state__prd_amend` (original verbatim + `reason` + `evidence`); never delete or weaken a criterion silently.
5. Append to `.omd/prd/progress.txt`: what was implemented, files changed, learnings, and mistakes not to repeat.

**No-human contract:** zero `ask_user_question` calls and zero approval requests between now and verifier sign-off. A fundamental blocker **stops the run with a report** — do not stall.

**Authoritative documents.** `docs/plan-phase-6-quest-catalog.md` (the phase plan, ledger, prerequisites, change list), `docs/plan-overview.md` **D96–D115** (the decisions), and `docs/evidence/quest-catalog-findings.md` (every measurement, with its falsifier). Read the findings doc before writing any code that touches the catalog.

**Environment rules for this phase (D114):**
- Branch `phase-6-quest-catalog` cut from `main`. Commits carry the DeepSeek Harness watermark trailer (`commit-watermark` skill).
- **Set `settings.user_name` before any save acceptance** — it is currently empty and the save pipeline treats an empty author as a failure.
- All save/git acceptance runs against the **D17 clone** `data/test-spiraldb` (**322** quest files). The owner's fork (**328**) is read-only. **Every count names its corpus**; in-run expectations are 322, never 328.
- .NET builds only with the D18 flags (`UseArtifactsOutput` + `ArtifactsPath=$PWD/tools/.artifacts` + `NUGET_PACKAGES=$PWD/tools/.nuget`). **.NET 10** for the Imlight leg comes from the nix store, not PATH: `DOTNET_ROOT=/nix/store/fi5f9aa5jsb7f05k9q2pr0fhj6kxdmmf-dotnet-sdk-10.0.401/share/dotnet`. Leave `dotnet` (9.x) as it is for our own projects.
- **Ownership follows the starter:** use an already-answering sibling service and leave it alone; otherwise start it and stop only what you started. Bind-check and own ports **12369, 12500, 12000, 12333, 8080** (plus the suite's 3001/5173) and assert the answering process is ours.
- Imlight run copy: `SpiralDBLocalPath` → the D17 clone, `SpiralDBDisableRemote=true`, `PlayerDatabaseUrl` empty. Aurorium: workspace cwd, `[patch] host` → a refused endpoint so no retail fetch happens.
- The Phase 6 run directories are already in `.gitignore` — verify before creating them (the Imlight copy is ~866 MB).
- UI evidence per D23 tier 1 + tier 2 (playwright-mcp screenshots into `docs/evidence/phase-6/`).

**The pre-launch docs are uncommitted on purpose and are your input:** `docs/plan-phase-6-quest-catalog.md`, `docs/evidence/quest-catalog-findings.md`, `scripts/wad-census.mjs`, plus modified `AGENTS.md`, `docs/plan-overview.md`, `.gitignore`. `p6-01` commits them and finishes its remaining work (the three spec updates: `spec-data-model.md`, `spec-api.md`, `spec-ui-design.md`).

**Close.** When every story has `passes: true`, spawn an independent `omd-agent-verifier` subagent to re-run the evidence commands and check each criterion — reject vague "looks done" verdicts; on rejection, fix and re-verify. On approval set `architectVerified: true` on every story, then run the closing distillation (durable facts → `omd_memory_set`; compounding knowledge → wiki/notepad priority), then clear the ralph state with `state_clear`.

**Stop conditions:** all stories passed + verifier approved → complete; `max_goal_rounds` reached → stop and report the remaining stories with their evidence state; a fundamental blocker → stop and report.
