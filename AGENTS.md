# AGENTS.md

Instructions for AI coding agents working on this repository.

## Project Overview

SpiralDB UI is a web tool for extracting, reviewing, editing, and verifying SpiralDB content entries for the Imlight game server. The primary workflow is quest extraction from packet captures; secondary is editing all other SpiralDB object types.

## Key Documentation

Read these before making changes:

- `Docs/spec-spiraldb-ui.md` — Full application specification (architecture, workflows, verification system, API endpoints, implementation phases)
- `Docs/spec-friendly-names.md` — Friendly name resolution subsystem (WAD parsing, sync script, SQLite schema)
- `Docs/spiraldb-reference.md` — SpiralDB JSON schemas and directory structure for all 9 object types

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
3. **Save = file write + metadata + git commit** — Every save operation must produce both the template JSON and its companion metadata JSON, then auto-commit.
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

All 9 types need editors and verification tracking:

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
| GlobalRegistry | GlobalRegistry/ | dictionary key | Low |

## Commit Messages

All agent-authored commits must end with the DeepSeek Harness watermark trailer. See the `commit-watermark` skill for exact format.

## Implementation Phases

See `Docs/spec-spiraldb-ui.md` § Implementation Phases for the ordered build plan:

1. Foundation (scaffolding, friendly names, status tracking)
2. Quest Extraction (packet import, review view, save)
3. Quest Editing (goal editors, flowchart, dialog)
4. Other Object Editors
5. Dashboard & Polish
