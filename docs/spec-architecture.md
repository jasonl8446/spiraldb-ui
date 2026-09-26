# SpiralDB UI — Architecture

## Overview

SpiralDB UI is a web-based tool for extracting, reviewing, editing, and verifying SpiralDB content entries for the Imlight game server. Its primary workflow is **quest extraction from packet captures**; secondary is editing all other SpiralDB object types (DropTables, NpcInventories, CreatureSpellbooks, ZoneTransfers, etc.).

The tool bridges the gap between game client data (WAD files / packet captures) and the server-side SpiralDB JSON format that Imlight consumes.

## Problem Statement

SpiralDB entries are currently created via Imview's packet capture feature or manual JSON editing. Pain points:

1. **No verification tracking** — No way to know which entries have been tested on a live Imlight server
2. **Cryptic IDs** — Numeric IDs and string table keys make manual editing error-prone
3. **No review workflow** — Extracted entries go straight to SpiralDB without a review step
4. **Complex quest structure** — QuestTemplate JSON is 500–1000+ lines with polymorphic goals, nested requirements, dialog trees, and goal logic chains
5. **Disconnected tools** — Packet extraction (Imview), editing (manual/text editor), and testing (Imlight server) are separate workflows

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript (Vite) |
| Backend | Node.js + Express |
| Database | SQLite via better-sqlite3 (local to this project, NOT in SpiralDB repo) |
| Packet Parser | CLI wrapper around Imview.PacketReader (.NET 9) |
| WAD Parser | Imcodec.Cli (.NET 9) for friendly name extraction |
| Git Automation | simple-git for auto-commit on save |
| Component Library | shadcn/ui + Tailwind CSS |
| Forms | React Hook Form + Zod validation |
| Tables | TanStack Table |
| Flowchart | React Flow |
| Toast | sonner |
| Icons | Lucide React |
| JSON Parsing | json5 (for reading legacy SpiralDB files with trailing commas) |

## System Diagram

```
┌──────────────────────┐
│   Packet Capture     │ ← Primary input for quests
│   Files (.json)      │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Imview.PacketReader │ ← .NET CLI wrapper
│  (QuestBuilder.cs)   │   Outputs JSON QuestTemplates
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐     ┌──────────────────────┐
│   spiraldb-ui        │◄───►│   SQLite DB          │
│   (React + Express)  │     │  - verification      │
│                      │     │  - friendly names    │
│   Features:          │     │  - sync history      │
│  • Extract & review  │     └──────────────────────┘
│  • Edit with forms   │
│  • Friendly name     │     ┌──────────────────────┐
│    dropdowns         │◄───►│   Aurorium Repo      │
│  • Verification      │     │   (WAD files)        │
│    tracking          │     └──────────┬───────────┘
│  • Status dashboard  │                │
└──────────┬───────────┘                ▼
           │                   ┌──────────────────────┐
           ▼                   │   Imcodec.Cli        │
┌──────────────────────┐       │   (WAD → JSON)       │
│   SpiralDB Repo      │       └──────────────────────┘
│   /spiraldb/         │
│   ├─ QuestTemplates/ │
│   ├─ QuestMetadatas/ │
│   ├─ DropTables/     │
│   ├─ NpcInventory/   │
│   └─ ...             │
└──────────────────────┘
```

## Core Workflows

### 1. Quest Extraction (Primary)

```
Packet Capture File (.json)
        ↓
Import via UI (drag-and-drop or file picker)
        ↓
CLI calls Imview.PacketReader → JSON QuestTemplate[]
        ↓
Review extracted quests in UI
        ↓
Minor edits if needed (fix goal logic, add missing fields)
        ↓
Save to /spiraldb/QuestTemplates/{name}.json
Auto-generate /spiraldb/QuestMetadatas/questmetadata_{name}.json
Auto-commit to git
        ↓
Status set to "extracted"
```

### 2. Entry Review & Verification (All Object Types)

```
Extracted entry (status: "extracted")
        ↓
Human reviews JSON for correctness
        ↓
Mark as "reviewed" + optional notes
        ↓
Test on live Imlight server
        ↓
Mark as "verified" + optional notes
```

### 3. Friendly Name Sync

```
User clicks "Sync Names" button or runs `npm run sync`
        ↓
CLI calls Imcodec.Cli to unpack WAD files from Aurorium
        ↓
Deserialize ItemTemplate, SpellTemplate, ActorTemplate, etc.
        ↓
Extract ID → Name mappings into SQLite
        ↓
UI dropdowns now show friendly names
```

## Server Configuration

- **Express backend**: Port 3001
- **Vite dev server**: Port 5173
- **Proxy config** in `vite.config.ts`:
  ```typescript
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
  ```
- **Production**: Express serves built Vite static files on port 3001

## Database Location

SQLite database file: `data/spiraldb-ui.db` relative to project root.

Create `data/` directory on first run if missing. Add to `.gitignore`:
```
data/
tools/bin/
```

## Database Concurrency

Use **better-sqlite3** with its synchronous single-connection API. This is a local single-user tool; concurrent access is not a concern. The synchronous API naturally prevents race conditions. No connection pooling needed.

## External Repositories

These are read-only inputs. Do NOT modify them directly.

| Repository | Local Path | Role |
|-----------|------------|------|
| SpiralDB | `/home/jason/Documents/git-projects/spiraldb/` | Output target — JSON files are saved here |
| Aurorium | `/home/jason/Documents/git-projects/Aurorium/` | Game asset WAD files for friendly name extraction |
| Imview | `/home/jason/Documents/git-projects/Imview/` | Packet reader (QuestBuilder.cs) and WAD parser reference |
| Imlight | `/home/jason/Documents/git-projects/Imlight/` | Server reference — SpiralDB.cs shows how data is loaded |
| Imcodec | `/home/jason/Documents/git-projects/Imview/submodule/Imcodec/` | WAD/ObjectProperty deserialization CLI |

## Required Tools

- **.NET 9 SDK**: For Imview.PacketReader CLI wrapper and Imcodec.Cli
- **Node.js 18+**: Backend and sync script
- **SQLite3**: Local database
- **Git**: Auto-commit functionality

## NPM Packages

```json
{
  "dependencies": {
    "express": "^4.18.0",
    "better-sqlite3": "^9.0.0",
    "cors": "^2.8.5",
    "simple-git": "^3.20.0",
    "json5": "^2.2.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/better-sqlite3": "^7.6.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.0.0"
  }
}
```

## Related Documentation

- [API Reference](./spec-api.md) — All REST endpoints with request/response shapes
- [Data Model](./spec-data-model.md) — SQLite schemas, verification lifecycle, file naming, git strategy
- [Domain Reference](./spec-domain-reference.md) — SpiralDB JSON schemas, type enumerations, validation rules
- [UI Design](./spec-ui-design.md) — Visual design, layout, component patterns
