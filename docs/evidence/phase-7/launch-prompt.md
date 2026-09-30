Paste into a **fresh Claude Code session** in `/home/jason/Documents/git-projects/spiraldb-ui`, after inhibiting suspend and checking quota:

---

/oh-my-claudecode:ralph Run **Phase 7 unattended** in this repo, following `docs/plan-phase-7-coverage-usability.md`.

**Ledger.** `.omc/prd.json` (21 stories, `p7-01` … `p7-17`, `gate-7`, `final-deslop`, `final-review`, `final-verify`) is already refined. Import it as the active PRD, and do not regenerate or re-scaffold it. `.omd/prd/spiraldb-ui.json` rev 12 is a read-only mirror (D125).

**Cross-round memory.** Append to `.omc/progress.txt` every iteration: what was implemented, files changed, learnings, and mistakes not to repeat. Read it first every iteration. Read `.omd/prd/progress.txt` from its "PHASE 6 RUN" line once at launch for inherited lessons.

**Authoritative documents**, read before the first story:
- `docs/plan-phase-7-coverage-usability.md`;
- `docs/plan-overview.md` D125–D137, plus every D-item a task cites;
- `AGENTS.md`;
- the four specs in AGENTS.md's order.

The phase doc wins over the PRD on divergence. Record the amendment through the OMC `criterionAmendments` ledger, which keeps the original verbatim and adds a reason, evidence, authority and timestamp. Never delete or weaken a criterion silently.

**Each iteration:**
1. Take the lowest-`priority` story with `passes:false`, and only that one.
2. Read the whole task section and every D-item it cites. Implement it, delegating to fresh `executor` subagents (use `model=opus` for p7-04…p7-08 and p7-10). Run independent work in parallel.
3. Run the story's verification commands. Put the **RAW** output into `docs/evidence/phase-7/<story-id>.md` plus sidecars. UI criteria need tier-1 Playwright specs and tier-2 playwright-mcp screenshots (D23).
4. Only then set `passes:true`, and commit on the phase branch.
5. Copy the pass (and any amendment) back into `.omc/prd.json` and the `.omd/prd/spiraldb-ui.json` mirror. The active PRD is session-scoped, so a relaunch re-imports `.omc/prd.json`. Both ledgers stay local and are never committed.
6. Append to `.omc/progress.txt`.

**Branches** (D29, unchanged):
- Run `git fetch origin`, then cut `phase-7-coverage-usability` from `origin/main` (`3451c88` when this plan was written; there is no usable local `main`).
- `gate-7` opens the PR with `gh` or the GitHub MCP (`jasonl8446/spiraldb-ui`), polls CI to green, self-merges and deletes the branch.
- Each `final-*` story runs on its own branch and PR, cut from the updated `main`.
- Commits end with **this runtime's own trailer**, `Co-Authored-By: Claude …` (D125). Never add the DeepSeek watermark.

**Environment rules** (D114/D122, unchanged unless noted):
- **Corpora.** All save/git acceptance runs against the D17 clone `data/test-spiraldb` (322, frozen). The owner fork is read-only. Every count names its corpus.
- **Dev database.** `data/spiraldb-ui.db` is disposable (D134). p7-02 rebuilds it and sets `settings.user_name = 'Jason'`. That dev server points at the owner fork and is for reading only. **Every save acceptance runs on a separate throwaway server whose `SPIRALDB_PATH` is the D17 clone.**
- **No `sqlite3` binary.** Query SQLite through `better-sqlite3` with `node -e`.
- **Read-only trees.** Imview, Imlight, Aurorium and Imcodec are read-only (D18/D126). All capture work goes in `tools/PacketReaderCli`, `tools/FixtureGen` and the new `tools/CaptureCensus`.
- **.NET.** Builds use only the D18 flags. .NET 10 for Imlight comes from `DOTNET_ROOT=/nix/store/fi5f9aa5jsb7f05k9q2pr0fhj6kxdmmf-dotnet-sdk-10.0.401/share/dotnet`. Verify that path exists before relying on it.
- **Services and ports.** Ownership follows the starter. Bind-check and own ports 12369, 12500, 12000, 12333 and 8080, plus 3001/5173 (D93). The Imlight copy pins `SpiralDBLocalPath` to the D17 clone, sets `SpiralDBDisableRemote=true`, and leaves `PlayerDatabaseUrl` empty. Aurorium runs from a workspace cwd with its patch host pointed at a refused endpoint.
- **CI.** CI has no .NET SDK (D55). C# behaviour reaches CI through committed golden JSON.
- **Staging.** Never `git add -A` while a worker is editing (D84/D85). Stage explicit paths.

**No-human contract.** Make zero `AskUserQuestion` calls and zero approval requests until verifier sign-off. Resolve ambiguity by the standing rule: follow the specs, record the next free D-item (D138+), and continue. A fundamental blocker stops the run with a report.

**Close.** When every story passes, spawn an independent `verifier` subagent. It re-runs the evidence commands against each criterion and rejects vague verdicts. Fix and re-verify on rejection. On approval, set `architectVerified:true` on every story, run the closing distillation (durable facts go to project memory and notepad), then run `/oh-my-claudecode:cancel` to clear ralph state.

**Stop conditions:**
- All stories pass and the verifier approves: complete.
- Fundamental blocker: stop and report the remaining stories with their evidence state.
