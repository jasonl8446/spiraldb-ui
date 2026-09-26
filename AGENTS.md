# AGENTS.md

Instructions for AI coding agents working on this repository.

## Project Overview

SpiralDB UI is a web tool for extracting, reviewing, editing, and verifying SpiralDB content entries for the Imlight game server. The primary workflow is quest extraction from packet captures; secondary is editing all other SpiralDB object types.

## Key Documentation

Read these before making changes, **in this order**:

1. `docs/spec-domain-reference.md` — ⚠️ **READ FIRST**. Complete SpiralDB domain reference: JSON schemas for all 9 object types, goal/requirement/result type enumerations, NPCDialogEntry fields, validation rules, CLI wrapper spec, WAD/string-table details. An autonomous agent MUST follow this exactly.
2. `docs/spec-architecture.md` — System architecture, tech stack, data flow diagrams, external dependencies, server configuration
3. `docs/spec-data-model.md` — SQLite schemas, verification lifecycle, file naming conventions, git branch strategy, JSON parsing rules, sync strategy
4. `docs/spec-api.md` — Complete REST API reference (all endpoints with request/response shapes), frontend URL routes
5. `docs/spec-ui-design.md` — Visual design spec (layout, components, color palette, responsive behavior, interaction patterns)
6. `docs/plan-overview.md` — **Before implementing any phase, read this.** The executable build plan: verified environment baseline, execution model (owner-fixed — currently **D29**: degraded-ralph PRD loop, one story per round; phase branches + PRs with agent self-merge at CI-green + gate-story evidence; regression gate-stories at every phase boundary; ultragoal 3-part final gate), and owner-approved decisions **D1–D63** that refine the specs (test-clone policy D17, sandbox-safe .NET builds D18, content-keyed file index D19, metadata pairing by content D20, corpus-derived quests/zones sync D21, GlobalRegistry consolidate-and-replace D22, Playwright evidence protocol D23, dependency pins D30/D31, settings API contract D32, measured WAD/string-table reality D33, lowercase `docs/` convention D34, authoritative template id space via `TemplateManifest` D35, names API contract D36, status/dashboard/import contract D37, user-identity gate D38, app shell + vendored primitives D39, tier-1 UI harness + hermetic specs D40, CI evidence-certification sequencing D41, API-only git_branch in the Phase 1 settings UI D42, the identity dialog's missing first caller D43, tier-1 harness database isolation D44, the CLI wrapper's JSON contract + capture gate + the .NET apphost `DOTNET_ROOT` on NixOS D45, task 2.1a's PropertyFlags-not-offsets blob contract + the reader defects the wrapper repairs D46, the extraction endpoint's abort signal (`res.on('close')`, not `req.on('close')`) + its spec-silent choices D47, the extraction output's enum representation (`StringEnumConverter`) + the save pipeline's measured corpus contract D48, the quests API's chosen shapes + two summary definitions + the legacy write-back's formatting-only diff D49, the extraction UI's spec-silent states + the overwrite confirmation + the capture note's real trigger D50, the browse/detail UI's spec-silent choices + two pinned deps + the statusAPI precondition for p2-09 D51, the status-transition UI's choices + the identity gate's real ordering + the measured corpus scale D52, the corpus-wide round-trip audit's 181-verified/141-outside-the-harness result D53, the AC#13 chain's tier-1/tier-2 meaning of "grows by N" + why N is 1 for committed captures D54, gate-2's boundary decisions (CI without a .NET SDK, the un-invoked D28 fallback tier, the flagged substitutions) D55, task 3.1's schema decisions (strict `$type` literals, a deliberately open `m_goalType`, `KNOWN ⊇ CORPUS` constants) D56, the document-preservation contract (schemas validate and never normalise; the writer must keep explicit nulls) D57, the document model's home + the single write-rule home + the dependency-free loader (`shared/document.ts`; json5 never enters the client bundle; the mutation primitives are the editors' contract) D58, story 3.3's editor contract (the Info tab as the first live editor, the field inventory as data, the empty string-table-key hazard, and the 3.3/3.10 split) D59, story 3.4's goal-editor contract (the two independent goal type axes, the 13 sparse extracted goals that must not be padded, the three miss-safe reference fields, the read-only fields other Phase-3 tasks own, the pinned dnd-kit pair, the `panels` map, the TypeName badge convention, and the tier-1 timing/locator corrections) D60, story 3.5's flowchart contract (the spec-named React Flow dependency that D25 omitted, its lazy containment with the measured bundle numbers, the corpus's 742 OR-free logic entries, the validator/findings split behind the banner sentence, and the goal-delete meaning of "disconnect") D61, story 3.6's requirement-tree contract (the four owner-labelled slots, the five preserved requirement key orders plus the untyped wrappers, ReqHasEntry's two undocumented keys, and the fixture-only OR/nesting) D62, story 3.7's results contract (the untagged `m_results` wrapper, the five owner-labelled containers incl. the tally slot that closes D60(d), the dual-source `ResDrawHand` id, and the per-type key orders) D63). Per-phase tasks and acceptance criteria: `docs/plan-phase-{1..5}-*.md`.

## External Dependencies

This project integrates with several sibling repositories. Do NOT modify these directly; treat them as read-only inputs:

| Repository | Local Path | Role |
|-----------|------------|------|
| SpiralDB | `/home/jason/Documents/git-projects/spiraldb/` | Output target — JSON files are saved here |
| Aurorium | `/home/jason/Documents/git-projects/Aurorium/` | Game asset WAD files for friendly name extraction |
| Imview | `/home/jason/Documents/git-projects/Imview/` | Packet reader (QuestBuilder.cs) and WAD parser reference |
| Imlight | `/home/jason/Documents/git-projects/Imlight/` | Server reference — SpiralDB.cs shows how data is loaded |
| Imcodec | `/home/jason/Documents/git-projects/Imview/submodule/Imcodec/` | WAD/ObjectProperty deserialization CLI |

## Tech Stack

- **Frontend**: React + TypeScript (Vite)
- **Backend**: Node.js + Express
- **Database**: SQLite via better-sqlite3 (local to this project, NOT in SpiralDB repo)
- **CLI Tools**: .NET 9 (Imview.PacketReader wrapper, Imcodec.Cli)
- **Git Automation**: simple-git for auto-commit on save

## Architecture Rules

1. **Verification status lives in local SQLite only** — Never add status/tracking fields to SpiralDB JSON files or metadata. The SpiralDB repo stays clean.
2. **Friendly names are synced, not hardcoded** — All ID-to-name mappings come from the sync script parsing WAD files. Never hardcode name lookups.
3. **Save = file write + metadata + git commit** — Every save writes the template JSON, updates its metadata (companion `QuestMetadatas/` file for quests — located by the `Name` field inside existing files, not by filename; embedded audit fields for all other types), then auto-commits.
4. **Packet parsing goes through CLI wrapper** — Node.js never parses packet captures directly. Always call the .NET CLI wrapper as a subprocess.
5. **Form editors use friendly name dropdowns** — All ID fields in editors must show human-readable names via the FriendlyNameDropdown component, storing the raw ID in a hidden field.

## Verification Status Lifecycle

```
extracted → reviewed → verified
```

- `extracted`: Just imported from packet capture or created
- `reviewed`: Human checked the JSON for correctness
- `verified`: Tested on a live Imlight server and confirmed working

Status transitions require optional notes. Full history is preserved in `status_history` table.

## SpiralDB Object Types

All 9 types need editors. The 8 types below **except GlobalRegistry** also carry verification tracking; GlobalRegistry is editor-only (a single merged dictionary of global flags has no meaningful per-entry lifecycle — owner decision Q1, see `docs/plan-overview.md`):

| Type | Directory | Key Field | Complexity |
|------|-----------|-----------|------------|
| QuestTemplate | QuestTemplates/ | m_questName | High (goals, logic, dialog, requirements) |
| DropTable | DropTables/ | Name | Medium (items, requirements) |
| NPCInventory | NpcInventory/ | TemplateID | Low |
| NPCSpellInventory | NpcSpellInventory/ | TemplateID | Low |
| CreatureSpellbook | CreatureSpellbook/ | DeckName | Low |
| NpcDropTable | NpcDropTable/ | TemplateID | Low |
| TreasureCardInventory | TreasureCardInventory/ | TemplateID | Low |
| WizardZoneData | ZoneTransfer/ | ZoneName | Medium |
| GlobalRegistry | GlobalRegistry/ | dictionary key | Low (editor-only, no status tracking) |

## Commit Messages

All agent-authored commits must end with the DeepSeek Harness watermark trailer. See the `commit-watermark` skill for exact format.

## Implementation Phases

The ordered build plan (detailed tasks, acceptance criteria, and risks per phase live in `docs/plan-phase-{n}-*.md`; execution model and binding decisions in `docs/plan-overview.md`):

1. **Foundation** — Project scaffolding (React + Express + SQLite), friendly name sync script + SQLite schema, basic API endpoints for names, sidebar navigation shell, status tracking schema + API
2. **Quest Extraction** — Imview.PacketReader CLI wrapper, quest import/upload UI, quest review view (read-only structured display), save to SpiralDB + auto-commit + metadata generation, status transitions with notes
3. **Quest Editing** — Goal editors (all 5 types), goal logic visual flowchart, requirement tree editor, result editors, full dialog editor (all NPCDialogEntry fields)
4. **Other Object Editors** — DropTable, NpcInventory, NpcSpellInventory, CreatureSpellbook, NpcDropTable, TreasureCardInventory, ZoneTransfer, GlobalRegistry editors
5. **Dashboard & Polish** — Verification dashboard with progress bars, status filtering on all list views, search across all object types, activity feed, error handling and validation
