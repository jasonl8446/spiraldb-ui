# SpiralDB UI - Technical Specification

## Overview

SpiralDB UI is a web-based tool for extracting, reviewing, editing, and verifying SpiralDB content entries. Its primary purpose is **quest extraction from packet captures**, with secondary support for all other SpiralDB object types (DropTables, NpcInventories, CreatureSpellbooks, ZoneTransfers, etc.).

The tool bridges the gap between game client data (WAD files / packet captures) and the server-side SpiralDB JSON format that Imlight consumes.

## Problem Statement

SpiralDB entries are currently created via Imview's packet capture feature or manual JSON editing. This process has several pain points:

1. **No verification tracking** — No way to know which entries have been tested on a live Imlight server
2. **Cryptic IDs** — Numeric IDs and string table keys make manual editing error-prone
3. **No review workflow** — Extracted entries go straight to SpiralDB without a review step
4. **Complex quest structure** — QuestTemplate JSON is 500-1000+ lines with polymorphic goals, nested requirements, dialog trees, and goal logic chains
5. **Disconnected tools** — Packet extraction (Imview), editing (manual/text editor), and testing (Imlight server) are separate workflows

## Architecture

### Tech Stack
- **Frontend**: React + TypeScript
- **Backend**: Node.js + Express API server
- **Database**: SQLite (local to spiraldb-ui project)
- **Packet Parser**: CLI wrapper around Imview.PacketReader (.NET 9)
- **WAD Parser**: Imcodec.Cli (.NET 9) for friendly name extraction
- **Game Assets**: Aurorium repository at `/home/jason/Documents/git-projects/Aurorium/`

### System Diagram

```
┌──────────────────────┐
│   Packet Capture     │ ← Primary input for quests
│   Files (.bin/.pcap) │
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
Packet Capture File
       ↓
Import via UI (file upload or path selection)
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
Mark as "verified" + optional notes (e.g., "Tested on r806919, all goals trigger correctly")
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

## Verification Tracking System

### Status Lifecycle

Every SpiralDB entry managed by the UI has a verification status stored in the local SQLite database (NOT in the SpiralDB repo):

```
extracted → reviewed → verified
```

| Status | Meaning | Set When |
|--------|---------|----------|
| `extracted` | Just imported from packet capture or created | Initial save to SpiralDB |
| `reviewed` | Human checked the JSON for correctness | User clicks "Mark Reviewed" |
| `verified` | Tested on a live Imlight server and confirmed working | User clicks "Mark Verified" |

### SQLite Schema for Verification

```sql
-- Tracks verification status for ALL SpiralDB object types
CREATE TABLE entry_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- Identifies the entry
  object_type TEXT NOT NULL,        -- 'quest', 'drop_table', 'npc_inventory', 
                                     -- 'creature_spellbook', 'npc_spell_inventory',
                                     -- 'npc_drop_table', 'treasure_card_inventory',
                                     -- 'zone_transfer'
  object_key TEXT NOT NULL,          -- Quest: m_questName, DropTable: Name, 
                                     -- NPC*: TemplateID (as string), Zone: ZoneName
  
  -- Current status
  status TEXT NOT NULL DEFAULT 'extracted',  -- 'extracted', 'reviewed', 'verified'
  
  -- Timestamps
  extracted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME,
  verified_at DATETIME,
  
  -- Who did it
  reviewed_by TEXT,
  verified_by TEXT,
  
  UNIQUE(object_type, object_key)
);

-- History of all status changes with notes
CREATE TABLE status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_status_id INTEGER NOT NULL REFERENCES entry_status(id),
  
  old_status TEXT,
  new_status TEXT NOT NULL,
  notes TEXT,                        -- Optional free-text notes
  changed_by TEXT,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast filtering
CREATE INDEX idx_entry_status_type ON entry_status(object_type);
CREATE INDEX idx_entry_status_status ON entry_status(status);
CREATE INDEX idx_entry_status_key ON entry_status(object_type, object_key);
```

### API Endpoints for Verification

#### GET /api/status/:type
List all entries of a type with their status. Supports filtering.

```http
GET /api/status/quests?status=extracted
GET /api/status/drop_tables
GET /api/status/all
```

**Response:**
```json
{
  "entries": [
    {
      "object_type": "quest",
      "object_key": "DS-ACAD1-C01-001",
      "status": "verified",
      "extracted_at": "2026-06-01T22:28:54Z",
      "reviewed_at": "2026-09-20T14:30:00Z",
      "verified_at": "2026-09-22T10:15:00Z",
      "latest_notes": "Tested on r806919, all goals trigger correctly"
    }
  ],
  "summary": {
    "total": 322,
    "extracted": 45,
    "reviewed": 120,
    "verified": 157
  }
}
```

#### PATCH /api/status/:type/:key
Update an entry's status.

```http
PATCH /api/status/quests/DS-ACAD1-C01-001
Content-Type: application/json

{
  "status": "verified",
  "notes": "Tested on Imlight r806919. Goal 3 waypoint triggers correctly. Reward drop table grants gold and item.",
  "changed_by": "jason"
}
```

#### GET /api/status/:type/:key/history
Get full status change history for an entry.

```http
GET /api/status/quests/DS-ACAD1-C01-001/history
```

**Response:**
```json
{
  "history": [
    {
      "old_status": null,
      "new_status": "extracted",
      "notes": "Imported from packet capture session_2026-06-01.pcap",
      "changed_by": "quest_builder",
      "changed_at": "2026-06-01T22:28:54Z"
    },
    {
      "old_status": "extracted",
      "new_status": "reviewed",
      "notes": "Goal logic chain looks correct. Dialog references match string table.",
      "changed_by": "jason",
      "changed_at": "2026-09-20T14:30:00Z"
    },
    {
      "old_status": "reviewed",
      "new_status": "verified",
      "notes": "Tested on Imlight r806919. All 7 goals complete in order. Drop table reward works.",
      "changed_by": "jason",
      "changed_at": "2026-09-22T10:15:00Z"
    }
  ]
}
```

#### GET /api/dashboard
Aggregated verification progress across all object types.

**Response:**
```json
{
  "types": {
    "quest": { "total": 322, "extracted": 45, "reviewed": 120, "verified": 157 },
    "drop_table": { "total": 180, "extracted": 30, "reviewed": 80, "verified": 70 },
    "npc_inventory": { "total": 95, "extracted": 10, "reviewed": 40, "verified": 45 }
  },
  "overall": {
    "total": 597,
    "extracted": 85,
    "reviewed": 240,
    "verified": 272,
    "percent_verified": 45.6
  }
}
```

### UI Components for Verification

#### StatusBadge
Color-coded badge component.

```tsx
<StatusBadge status="extracted" />  // Yellow/amber
<StatusBadge status="reviewed" />   // Blue
<StatusBadge status="verified" />   // Green
```

#### StatusTransitionButton
Button to advance status with optional notes dialog.

```tsx
<StatusTransitionButton 
  objectType="quest"
  objectKey="DS-ACAD1-C01-001"
  currentStatus="extracted"
  onTransition={(newStatus, notes) => api.updateStatus(...)}
/>
```

When clicked, opens a modal:
- Shows next available status transition
- Optional textarea for notes
- Confirm/cancel buttons
- On confirm: calls PATCH endpoint, refreshes badge

#### Dashboard View
Overview page showing:
- Progress bars per object type (extracted/reviewed/verified)
- Overall completion percentage
- Recent activity feed (last 20 status changes)
- Quick filters: "Show unverified quests", "Show unreviewed drop tables"

#### List View Filters
Every list/table view supports filtering by status:
- Tab bar or dropdown: All | Extracted | Reviewed | Verified
- Count badges on each tab
- Search within filtered results

## Quest Extraction Details

### Packet Capture Integration

The packet parsing logic lives in `Imview.PacketReader` (C# .NET 9). A thin CLI wrapper will be created to expose this to Node.js:

```bash
# Proposed CLI interface
imview-packet-reader --input /path/to/capture.pcap --output /tmp/quests.json
```

**Output format:** Array of QuestTemplate JSON objects, identical to what Imview's `QuestBuilder.BuildQuestsFromPacketCaptureAsync()` produces.

**Node.js integration:**
```typescript
async function extractQuestsFromCapture(capturePath: string): Promise<QuestTemplate[]> {
  const result = await execFile('imview-packet-reader', [
    '--input', capturePath,
    '--output', '-'  // stdout
  ]);
  return JSON.parse(result.stdout);
}
```

### Quest Review UI

After extraction, the review screen shows:

1. **Quest List Panel** (left sidebar)
   - All extracted quests with name and status badge
   - Click to select for review

2. **Quest Detail Panel** (main area)
   - Read-only view of the extracted JSON in structured form
   - Sections: Basic Info, Goals, Goal Logic, Requirements, Results, Dialog
   - Each section collapsible
   - Diff view if editing an existing quest (shows what changed)

3. **Action Bar** (top)
   - "Save to SpiralDB" button
   - "Mark Reviewed" button (with notes)
   - "Edit" toggle to switch to edit mode

### Quest Editing

When editing is needed, the form provides:

- **Basic Info**: Quest name, title (string table key lookup), level, mainline checkbox
- **Goals**: List with type-specific editors per goal type:
  - WaypointGoalTemplate: zone dropdown, zoneEntry/Exit toggles
  - PersonaGoalTemplate: NPC dropdown, dialog editor
  - BountyGoalTemplate: NPC adjective list, bounty count, bounty type
  - ScavengeGoalTemplate: item adjective list, item count
  - AchieveRankGoalTemplate: rank number
- **Goal Logic**: Visual flowchart showing goal dependencies
- **Requirements**: Tree editor for nested AND/OR requirement lists
- **Results**: Start/end result editors (ResDropTable, ResModifyEntry, etc.)
- **Dialog**: Full NPCDialogEntry editor with all 50+ fields

### Save Behavior

On save:
1. Write quest template JSON to `/spiraldb/QuestTemplates/questtemplates_{name}.json`
2. Auto-generate metadata to `/spiraldb/QuestMetadatas/questmetadata_{name}.json`:
   ```json
   {
     "QuestTemplateId": "questtemplates/{name}",
     "Name": "{name}",
     "Description": "Quest extracted from packet capture.",
     "CreatedAt": "{ISO timestamp}",
     "ModifiedAt": "{ISO timestamp}",
     "CreatedBy": "{current user}",
     "ModifiedBy": "{current user}"
   }
   ```
3. Git auto-commit with message: `spiraldb: extract quest {name} from packet capture`
4. Set entry status to "extracted" in local SQLite

## Non-Quest Object Editors

Simpler editors for other SpiralDB types, accessible via sidebar navigation:

| Object Type | Key Fields | Editor Complexity |
|-------------|-----------|-------------------|
| DropTable | Name, Items[], Gold, XP | Medium - item dropdowns, requirement tree |
| NpcInventory | TemplateID, Inventory[] | Low - NPC dropdown + item multi-select |
| NpcSpellInventory | TemplateID, Spells[] | Low - NPC dropdown + spell list with levels |
| CreatureSpellbook | DeckName, SpellTemplateIds[] | Low - deck name + spell multi-select |
| NpcDropTable | TemplateID, DropTableNames[] | Low - NPC dropdown + drop table multi-select |
| TreasureCardInventory | TemplateID, TreasureCards[] | Low - NPC dropdown + spell name + price |
| ZoneTransfer | ZoneName, Teleports[] | Medium - zone dropdowns + coordinate inputs |
| GlobalRegistry | Key-value pairs | Low - key/value table editor |

All editors share:
- Friendly name dropdowns (from synced SQLite)
- Status tracking (extracted/reviewed/verified)
- Save to correct SpiralDB subdirectory
- Auto-commit to git
- Metadata generation where applicable

## Implementation Phases

### Phase 1: Foundation
1. Project scaffolding (React + Express + SQLite)
2. Friendly name sync script + SQLite schema
3. Basic API endpoints for names
4. Sidebar navigation shell
5. Status tracking schema + API

### Phase 2: Quest Extraction
1. Imview.PacketReader CLI wrapper
2. Quest import/upload UI
3. Quest review view (read-only structured display)
4. Save to SpiralDB + auto-commit + metadata generation
5. Status transitions with notes

### Phase 3: Quest Editing
1. Goal editors (all 5 types)
2. Goal logic visual flowchart
3. Requirement tree editor
4. Result editors
5. Full dialog editor (all NPCDialogEntry fields)

### Phase 4: Other Object Editors
1. DropTable editor
2. NpcInventory / NpcSpellInventory editors
3. CreatureSpellbook / NpcDropTable editors
4. TreasureCardInventory / ZoneTransfer editors
5. GlobalRegistry editor

### Phase 5: Dashboard & Polish
1. Verification dashboard with progress bars
2. Status filtering on all list views
3. Search across all object types
4. Activity feed
5. Error handling and validation

## Dependencies

### Required Tools
- **.NET 9 SDK**: For Imview.PacketReader CLI wrapper and Imcodec.Cli
- **Node.js 18+**: Backend and sync script
- **SQLite3**: Local database
- **Git**: Auto-commit functionality

### NPM Packages
```json
{
  "dependencies": {
    "express": "^4.18.0",
    "better-sqlite3": "^9.0.0",
    "cors": "^2.8.5",
    "simple-git": "^3.20.0"
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

### External Repositories
| Repository | Path | Purpose |
|-----------|------|---------|
| Aurorium | `/home/jason/Documents/git-projects/Aurorium/` | Game asset WAD files |
| Imview | `/home/jason/Documents/git-projects/Imview/` | Packet reader + WAD parser |
| Imlight | `/home/jason/Documents/git-projects/Imlight/` | Server reference implementation |
| SpiralDB | `/home/jason/Documents/git-projects/spiraldb/` | Output target for JSON files |

## References

- [Friendly Name Resolution Spec](./spec-friendly-names.md) — Detailed friendly name sync design
- [SpiralDB Reference](./spiraldb-reference.md) — JSON schemas and directory structure
- [Imview QuestBuilder](../../Imview/src/Imview.PacketReader/QuestBuilder.cs) — Packet capture parsing logic
- [Imview QuestTemplateEditor](../../Imview/src/Imview.Core/Controls/Templates/QuestTemplateEditor.cs) — Reference quest editor implementation
- [Imlight SpiralDB.cs](../../Imlight/src/Imlight.CoreLib/WizardData/SpiralDB.cs) — Server-side loading logic
