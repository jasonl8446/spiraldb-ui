# Phase 2 — Quest Extraction

**Status:** pending approval
**Depends on:** Phase 1 complete; **owner prerequisite from [plan-overview.md](./plan-overview.md): .NET 9 SDK installed system-wide (verify `dotnet --version` ≥ 9 — if absent, STOP and report; this is the run's only hard block). Real packet captures are NOT required — task 2.1a manufactures them (D28).**
**Spec reading order before starting:** [spec-domain-reference.md](./spec-domain-reference.md) (CLI wrapper L551–633, metadata L189–204) → [spec-data-model.md](./spec-data-model.md) (file naming, git strategy) → [spec-api.md](./spec-api.md) (extraction + quest CRUD) → [spec-ui-design.md](./spec-ui-design.md) (extraction page L183–235, browse L238–271)

## Requirements Summary

The primary workflow end to end: upload a JSON packet capture → `imview-packet-reader` CLI wrapper reconstructs QuestTemplate JSON → review extracted quests in a read-only structured view → save to the SpiralDB repo (clean JSON file + companion metadata + git auto-commit on a `content/YYYY-MM-DD` branch) → `extracted` status with history. Also delivers the quest browse list, the read-only quest detail page, and the status-transition UI ("Mark Reviewed"/"Mark Verified" with notes).

## Tasks

### 2.0 Prerequisite checks + test-target setup — S
- **Verify the owner prerequisite** ([plan-overview.md](./plan-overview.md)): `dotnet --version` ≥ 9 — if missing, halt the run and report (D18: no agent-side install). No capture files are needed from the owner (D28 — task 2.1a generates them).
- **Create the test clone (D17)**: `git clone /home/jason/Documents/git-projects/spiraldb data/test-spiraldb` (disposable clone of the owner's fork; gitignored). Dev/test settings point `spiraldb_path` at it; all acceptance criteria below run against the clone. Provide an `npm run test:reset-clone` script to delete and re-clone fresh.
- **Smoke-build Imview.PacketReader** with sandbox-safe flags (D18) to surface dependency problems before the wrapper exists. Never write into the Imview tree; escalate to owner if the build fails (Imview is read-only for us per AGENTS.md).

### 2.1 PacketReaderCli wrapper (.NET) — M
- `tools/PacketReaderCli/PacketReaderCli.csproj` + `Program.cs` exactly per [spec-domain-reference.md](./spec-domain-reference.md) L553–595: `net9.0`, `AssemblyName=imview-packet-reader`, ProjectReference `../../../Imview/src/Imview.PacketReader/Imview.PacketReader.csproj` (path verified to exist from `tools/PacketReaderCli/`).
- Behavior: parse `--input <path>` and optional `--output <path|->`; call `QuestBuilder.BuildQuestsFromPacketCaptureAsync(inputPath)` (signature verified: `QuestBuilder.cs` L33, returns `Task<List<QuestTemplate>>`); serialize as a JSON array; write to output path or stdout; on error write to stderr and exit 1 (spec L576–588).
- `npm run build:cli` → `dotnet build tools/PacketReaderCli/PacketReaderCli.csproj -c Release -p:UseArtifactsOutput=true -p:ArtifactsPath=$PWD/tools/.artifacts` with env `NUGET_PACKAGES=$PWD/tools/.nuget` (**proven D18 flags — never `BaseIntermediateOutputPath/BaseOutputPath`, which break multi-project builds with CS0579**), then symlink `tools/.artifacts/bin/PacketReaderCli/release/imview-packet-reader` → `tools/bin/imview-packet-reader` so the spec's CLI path holds ([spec-domain-reference.md](./spec-domain-reference.md) L595–602). `tools/bin/`, `tools/.artifacts/`, `tools/.nuget/` gitignored (task 1.1).

### 2.1a Capture fixture generator (.NET, D28) — M
Manufactures valid packet-capture files from **real fork quests** — no recorded captures exist anywhere (verified), and none are needed.
- `tools/FixtureGen/` — .NET 9 console tool, same ProjectReference pattern as 2.1 (`Imview.PacketReader` + transitively `Imcodec.ObjectProperty`), same sandbox-safe build with a `tools/bin/fixturegen` symlink (`npm run build:fixturegen`).
- Pipeline: load a corpus quest (`data/test-spiraldb/QuestTemplates/questtemplates_*.json`) → deserialize into Imcodec TypeCache objects (the corpus `$type` format **is** Imcodec's ObjectProperty JSON) → serialize the structures QuestBuilder consumes back into hex blobs — `GoalCompilation` (QuestBuilder.cs L183–186, offset 1), `ActorDialog` (L245–253, offset 16), `ClientTagList` (L164, offset 1), `MadlibBlock` (L509, offset 1) → emit the envelope `[{"data":{"name":"MSG_QUESTOFFER","fields":{MobileID, QuestName, QuestTitle, QuestInfo, Level, Rewards, GoalData, Mainline}}}, …MSG_SENDQUEST, …MSG_SENDGOAL per goal, …MSG_ACTORDIALOG]` per `PacketReaderService.cs` L100–130 and `Packets.cs` field definitions.
- CLI: `fixturegen --quest <path-to-questtemplate.json> --output <capture.json>`; generates fixtures for a chosen acceptance set: **≥3 diverse corpus quests** (one multi-goal mainline, one dialog-heavy, one exercising the rarest goal types present in the corpus) into `server/test/fixtures/captures/` (committed — they are reproducible build artifacts of the generator, pinned for CI).
- **Fallback ladder** (timeboxed): if blob layouts resist exact regeneration, degrade to a minimal valid envelope (correct packet names/fields, thin or empty `GoalData`/`Rewards`) that still proves upload→CLI→review→save→commit end-to-end, and flag "deep goal reconstruction pending" prominently in the Phase 2 PR.
- Symmetry check: the generator's serializer and QuestBuilder's deserializer are the same Imcodec ObjectProperty serializer — what one writes, the other reads. First milestone of this task: generate → run CLI → get ≥1 quest back.

### 2.2 Extraction service — M
- `server/src/services/extraction.ts`: `execFile` wrapper per [spec-domain-reference.md](./spec-domain-reference.md) L597–612 — CLI path `tools/bin/imview-packet-reader`, `maxBuffer: 50 MB`, parse stdout as JSON array.
- Child-process registry + kill on client abort (decision D9); the Express route wires `req.on('close')` → kill.
- Friendly failure modes: CLI missing → error naming `npm run build:cli`; non-zero exit → stderr text mapped into `"Failed to parse packet capture: ..."` ([spec-api.md](./spec-api.md) L224–229); `ENOBUFSRANGE` → advise smaller capture (and support `--output` file mode internally as escape hatch).

### 2.3 Extract API — S
- `POST /api/extract/quests` per [spec-api.md](./spec-api.md) L208–231: multer disk storage (D2), field `file`, accept `.json` only, 512 MB cap; response `{ quests: [...], count: N }`; blocking subprocess, client shows indeterminate spinner ([spec-domain-reference.md](./spec-domain-reference.md) L627–629). Upload is drag-and-drop or file picker only — no filesystem path input (L631–633).

### 2.4 Save pipeline (files + metadata + git) — M
Shared by extraction saves **and** all later object saves; build it generically.
- `server/src/services/spiraldbFiles.ts`: JSON5 read helper (all reads of SpiralDB files — [spec-data-model.md](./spec-data-model.md) L234–245); clean-JSON writer `JSON.stringify(data, null, 2)` (L247–253); filename builder implementing the convention table (L171–187), including zone-name slash→underscore.
- **Content-keyed index (D19)**: key→filepath map per type built by scanning the directory and JSON5-parsing each file's key field (rebuilt on startup and after saves). `GET /:key` and update-saves resolve through the index — **never** by deriving the filename, because legacy files don't follow the convention. **Updates always write back to the file's original path**; convention filenames apply to new creates only.
- Quest metadata generation **pairs by content (D20)**: legacy metadata files are UUID-named (verified: `QuestMetadatas/069f430e-….json` contains `"Name": "WC-UNICORN-MAIN-004"`). On save, scan `QuestMetadatas/` for a file whose `Name` matches the quest → update it in place (refresh `ModifiedAt/ModifiedBy`); only when none exists create `questmetadata_{name}.json` with the exact shape in [spec-data-model.md](./spec-data-model.md) L193–204 — `QuestTemplateId: "questtemplates/{name}"`, Description `"Quest extracted from packet capture."` (for extraction saves), ISO timestamps, `CreatedBy/ModifiedBy` = `settings.user_name`. Quests are the **only** type with companion metadata files (L191).
- `server/src/services/git.ts` (simple-git against `settings.spiraldb_path`):
  - Dirty-repo guard first (D14): `git status --porcelain` non-empty → actionable error.
  - Branch strategy per [spec-data-model.md](./spec-data-model.md) L206–214: session branch `content/YYYY-MM-DD`; check existence; create from `main` HEAD if missing; persist to `settings.git_branch`.
  - Commit per object save (D13) with message `spiraldb: {action} {object_type} {object_key}` + optional notes body; actions `extract|update|create` (L216–223); author = `user_name` (L225–232). No watermark trailer (D11).
- Save sequence per [spec-api.md](./spec-api.md) L200–204: write JSON file → generate metadata (quests only) → git commit → upsert `entry_status` + `status_history`. Extraction saves set `status='extracted'` with history note `Imported from packet capture {filename}` ([spec-architecture.md](./spec-architecture.md) L97, [spec-api.md](./spec-api.md) L122).
- Existing file with same key → action `update` (overwrite), metadata `ModifiedAt/ModifiedBy` refreshed. UI confirms before overwriting an existing quest (small confirm dialog listing the name).

### 2.5 Quests API — M
- `GET /api/quests` — list from SpiralDB files (D12: directory scan + JSON5 parse per request; 322 files is fine locally), joined with `entry_status`: name, title (string-table resolved), level, goal count, mainline, modified time, status ([spec-api.md](./spec-api.md) L172–178; columns needed by [spec-ui-design.md](./spec-ui-design.md) L254–262).
- `GET /api/quests/:name` — full quest JSON, resolved via the content-keyed index (D19 — robust to off-convention filenames); JSON5-tolerant read of legacy files with trailing commas ([spec-data-model.md](./spec-data-model.md) L234–245).
- `POST /api/quests` — save pipeline (2.4) with body `{ quest, notes? }`.

### 2.6 Extraction UI — L
`/quests/extract` per [spec-ui-design.md](./spec-ui-design.md) L183–235.
- **Upload phase**: centered max-w-640px drop zone — dashed `zinc-700` border, `zinc-900/50` bg, rounded-xl; drag-over `blue-600/20` + `blue-500` border; 48px icon; text must include **"Supported format: JSON packet capture files (.json)"** ([spec-domain-reference.md](./spec-domain-reference.md) L625). After selection: file card (name + size), indeterminate spinner "Extracting quests..." (no progress bar/live count — L627–629), destructive Cancel button wired to abort (D9).
- **Results phase**: split layout — left 320px quest list (name, level badge, goal count, "new" status badge; selected row `blue-600/10`), right read-only tabbed preview (same tab structure as the Phase 3 edit view, non-editable). Bottom action bar: `[Save All to SpiralDB] [Save Selected] [Discard]`. Save All shows confirm first: "Save {N} quests to SpiralDB? This will create files and auto-commit." (L220–233). Mobile: list full width, preview as overlay/modal (L234).
- Toasts per L119–123: success "Quest {name} saved and committed", error surfacing CLI stderr.

### 2.7 Quest browse + read-only detail — M
- `/quests` per [spec-ui-design.md](./spec-ui-design.md) L238–271: filter tabs `[All][Extracted][Reviewed][Verified]` with count badges; right-aligned search input (client-side filter, D12); TanStack Table with the exact column spec (status dot 40px / name mono flex / level badge / goals count / mainline check / modified relative / actions); row hover + click → detail; striped rows; pagination "Showing 1-50 of 322"; per-filter empty states; mobile card list.
- `/quests/:questName` read-only detail per [spec-ui-design.md](./spec-ui-design.md) L274–340: header (back link, name in `text-xl font-mono font-semibold`, StatusBadge, Edit button disabled with "Editing arrives in Phase 3" tooltip), tabbed sections `[Info][Goals][Goal Logic][Requirements][Results][Dialog]` rendered read-only, JSON side panel toggle (`{ }` icon, 400px, syntax-highlighted — choose `react-json-view-lite` for lightness; spec allows either, L326). Goal Logic tab in this phase: read-only rendering or raw JSON fallback until Phase 3's flowchart exists.

### 2.8 Status transition UI — S
- On quest detail (and extraction results): "Mark Reviewed" / "Mark Verified" buttons → notes dialog (optional notes) → `PATCH /api/status/...`; user-identity modal guard from task 1.7; history panel rendering `GET .../history` timeline; StatusBadge updates optimistically with toast on success.

## Acceptance Criteria

- [ ] `npm run build:cli` produces `tools/bin/imview-packet-reader`; running it on a 2.1a-generated capture prints a JSON array of QuestTemplate objects to stdout; on a corrupt/non-capture file it exits 1 with a message on stderr.
- [ ] **Closed-loop round-trip (D28)**: for each of ≥3 diverse corpus quests — quest file → `fixturegen` → capture → CLI extraction → quest′; quest′ matches the source quest on quest name, title, level, mainline flag, goal count/names/types, and dialog entry count. (Fallback tier, if invoked: plumbing-level round-trip on the minimal envelope + prominent PR flag.)
- [ ] `POST /api/extract/quests` (multipart, generated capture) → `{ quests: [...], count: N }` matching [spec-api.md](./spec-api.md) L216–222; invalid file → `{ "error": "Failed to parse packet capture: ..." }`; server stays healthy after CLI failure.
- [ ] Cancel mid-extraction kills the CLI child process (verify with `ps` after aborting a large-capture request).
- [ ] "Save All" of N extracted quests produces, **in the test clone** (`data/test-spiraldb`, D17): N files `QuestTemplates/questtemplates_{m_questName}.json` written as **clean JSON** (`node -e "JSON.parse(...)"` succeeds — no trailing commas), N metadata files in `QuestMetadatas/` with the exact shape, N commits on branch `content/{today}` (created from `main` HEAD if it did not exist), each message matching `spiraldb: extract quest {name}`, author = configured user_name; `settings.git_branch` persisted.
- [ ] Metadata pairing (D20): saving a quest that already has a UUID-named metadata file updates **that file in place** (`ModifiedAt/ModifiedBy` refreshed) and creates no `questmetadata_{name}.json` duplicate; saving a brand-new quest creates `questmetadata_{name}.json`.
- [ ] Save with dirty SpiralDB working tree fails with the actionable error (D14) and writes nothing.
- [ ] Each saved quest has an `entry_status` row (`quest`, `extracted`) and a `status_history` row noting the capture filename; dashboard counts reflect the additions.
- [ ] Saving a quest whose name already exists updates the file, refreshes metadata `ModifiedAt/ModifiedBy`, and commits with action `update` after a UI confirmation.
- [ ] `GET /api/quests` lists the full corpus (322 baseline + newly saved) with correct status dots; filter-tab counts match `GET /api/status/quests` summary; search filters the table.
- [ ] `GET /api/quests/{name}` on a legacy quest file containing trailing commas returns fully parsed JSON (JSON5 tolerance proven on a real corpus file).
- [ ] Extraction UI matches spec states, evidenced per D23 (Playwright assertions + screenshots in `Docs/evidence/phase-2/`, including a ≤768px viewport check): drop zone copy includes the supported-format line; spinner is indeterminate with "Extracting quests..."; results split layout with confirm dialog before Save All; mobile shows preview as overlay.
- [ ] "Mark Reviewed" with notes → history endpoint shows the transition; StatusBadge flips to blue/reviewed.
- [ ] Round-trip safety: `GET /api/quests/{name}` → `POST /api/quests` **unmodified** for one legacy quest yields a git diff limited to formatting normalization (trailing commas removed) — no field loss (early proof of D5; full harness is task 3.2).

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| .NET SDK absent (verified 2026-09-25) | Phase blocked at 2.1 | Owner prerequisite 1 (pre-install once); task 2.0 verifies and halts-with-report if missing — no agent-side install, no mid-run approval |
| `Imview.PacketReader` fails to build standalone | Wrapper unusable | 2.0 smoke-build; escalate to owner — Imview is read-only for us (AGENTS.md) |
| Fixture generator can't reproduce QuestBuilder's exact blob layouts (offsets/versions) | Round-trip criterion degrades | Same-serializer symmetry (D28); timeboxed fallback to minimal-envelope plumbing proof + prominent PR flag; a real capture, if ever found, replays the full acceptance suite |
| CLI stdout > 50 MB on huge captures | Extraction crash | maxBuffer per spec + `--output` file-mode escape hatch (2.2) |
| Auto-commit pollutes SpiralDB history on bugs | Bad data in shared repo | D13/D14 + branch isolation (`content/*` never main) + acceptance test inspecting `git log` |
| Overwrite of hand-edited quest | Data loss | Confirm dialog on name collision; dirty-repo guard; git history is the undo mechanism |

## Verification Steps

1. `dotnet --version` → 9.x; `npm run build:cli && npm run build:fixturegen` → binaries exist.
2. `tools/bin/fixturegen --quest data/test-spiraldb/QuestTemplates/questtemplates_DS-ACAD1-C01-001.json --output /tmp/cap.json` → capture file; `tools/bin/imview-packet-reader --input /tmp/cap.json | jq 'length'` → ≥1 quest with the same `m_questName` (round-trip spot check).
3. `curl -F "file=@server/test/fixtures/captures/{capture}.json" localhost:3001/api/extract/quests | jq .count`.
4. UI: upload → results → Save All (2 quests) → confirm.
5. In `data/test-spiraldb` (the test clone, D17): `git branch --show-current` → `content/2026-XX-XX`; `git log --format='%s (%an)' -2` → `spiraldb: extract quest ...`; `ls QuestTemplates/questtemplates_{name}.json QuestMetadatas/`.
6. `node -e "JSON.parse(require('fs').readFileSync('QuestTemplates/questtemplates_{name}.json','utf8'))"` → no throw (clean JSON).
7. `curl localhost:3001/api/status/quests/{name}/history | jq` → extracted row with capture filename note.
8. `npm test` green; browser walkthrough of upload → browse → detail → mark reviewed.

**Done when:** all acceptance criteria checked with evidence in the PR (Playwright evidence per D23, clone-based git evidence per D17); SDK prerequisite confirmed; any D28 fallback-tier invocation prominently flagged.
