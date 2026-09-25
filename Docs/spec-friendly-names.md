# Friendly Name Resolution System - Technical Specification

> **Note:** This spec covers the friendly name subsystem only. See [spec-spiraldb-ui.md](./spec-spiraldb-ui.md) for the full application specification including quest extraction, verification tracking, and all object editors.

## Overview

This document specifies the design for a friendly name resolution system that enables users to create and edit SpiralDB JSON files using human-readable names instead of cryptic numeric IDs and string keys.

## Problem Statement

SpiralDB uses numeric IDs (e.g., `4808`, `409737272`) and cryptic string keys (e.g., `DS-ACAD-C01-001`, `WC-UNICORN-MAIN-007`) to reference game objects. Content creators need a way to:
1. See human-readable names when browsing/editing SpiralDB data
2. Select objects by name from dropdowns when creating new JSON files
3. Maintain an up-to-date mapping between IDs and display names

## Architecture

### Tech Stack
- **Frontend**: React + TypeScript
- **Backend**: Node.js + Express API server
- **Database**: SQLite (stored in spiraldb-ui project)
- **WAD Parser**: Imcodec.Cli (C# .NET 9 tool)
- **Game Assets**: Aurorium repository at `/home/jason/Documents/git-projects/Aurorium/`

### Data Flow

```
┌─────────────────┐
│  Aurorium Repo  │ (WAD files from game client)
│  /data/V_r.../  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Imcodec.Cli    │ (subprocess call)
│  wad unpack     │
│  op file        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Sync Script    │ (Node.js)
│  npm run sync   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  SQLite DB      │ (friendly_names.db)
│  - items        │
│  - spells       │
│  - npcs         │
│  - quests       │
│  - zones        │
│  - drop_tables  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Express API    │ (REST endpoints)
│  GET /api/names │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  React UI       │ (dropdowns, forms)
│  spiraldb-ui    │
└─────────────────┘
```

## Object Types Requiring Friendly Names

All 7 SpiralDB object types need name resolution:

| Object Type | ID/Key Field | Example Value | Friendly Name Source |
|-------------|--------------|---------------|---------------------|
| Items | `ItemId` (GID) | `"4808"` | ItemTemplate.m_name |
| Spells | `SpellTemplateIds[]` | `409737272` | SpellTemplate.m_name |
| NPCs | `TemplateID` | `87112` | ActorTemplate.m_name |
| Quests | `m_questName` | `"DS-ACAD-C01-001"` | QuestTemplate.m_questTitle (string table lookup) |
| Zones | `ZoneName` | `"WizardCity/WC_Hub"` | Zone file metadata |
| Drop Tables | `Name` | `"WC-UNICORN-MAIN-007"` | Already human-readable (no mapping needed) |
| Treasure Cards | `SpellName` | `"Fire Shield TC"` | Already uses spell names (cross-reference with spells) |

## Sync Script Design

### Location
`scripts/sync-friendly-names.ts` (or `.js`)

### Invocation
```bash
npm run sync              # CLI command
# OR
POST /api/sync            # UI button triggers this endpoint
```

### Process Steps

1. **Locate Aurorium Data**
   - Find latest revision directory in `/home/jason/Documents/git-projects/Aurorium/data/`
   - Identify `Root.wad` or relevant template WAD files

2. **Unpack WAD Files**
   ```bash
   imcodec wad unpack /path/to/Root.wad /tmp/wad-extract
   ```

3. **Deserialize Templates**
   For each template type:
   ```bash
   imcodec op file /tmp/wad-extract/ItemTemplates.bin /tmp/items.json
   imcodec op file /tmp/wad-extract/SpellTemplates.bin /tmp/spells.json
   # ... etc
   ```

4. **Extract ID → Name Mappings**
   Parse deserialized JSON to extract:
   - Items: `{ gid: number, name: string }`
   - Spells: `{ templateId: number, name: string }`
   - NPCs: `{ templateId: number, name: string }`
   - Quests: `{ questName: string, title: string }` (requires string table lookup)
   - Zones: `{ zonePath: string, displayName: string }`

5. **Store in SQLite**
   ```sql
   CREATE TABLE IF NOT EXISTS items (
     gid INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
   );
   
   CREATE TABLE IF NOT EXISTS spells (
     template_id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
   );
   
   -- Similar tables for npcs, quests, zones
   ```

6. **Report Results**
   Log counts: "Synced 15,234 items, 8,456 spells, 3,210 NPCs..."

### Error Handling
- If Aurorium data not found: Error with helpful message
- If Imcodec.Cli fails: Capture stderr, report to user
- If WAD format changed: Log warning, continue with partial data
- Transaction-based DB updates: Rollback on failure

## SQLite Schema

```sql
-- Items (from ItemTemplate)
CREATE TABLE items (
  gid INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,           -- Optional: equipment, consumable, etc.
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Spells (from SpellTemplate)
CREATE TABLE spells (
  template_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  school TEXT,             -- Fire, Ice, Storm, etc.
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- NPCs (from ActorTemplate)
CREATE TABLE npcs (
  template_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  npc_type TEXT,           -- Vendor, Trainer, Quest Giver, etc.
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Quests (from QuestTemplate)
CREATE TABLE quests (
  quest_name TEXT PRIMARY KEY,  -- e.g., "DS-ACAD-C01-001"
  title TEXT NOT NULL,          -- Human-readable title from string table
  level INTEGER,
  is_mainline BOOLEAN,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Zones (from zone files)
CREATE TABLE zones (
  zone_path TEXT PRIMARY KEY,   -- e.g., "WizardCity/WC_Hub"
  display_name TEXT NOT NULL,
  world TEXT,                   -- WizardCity, Krokotopia, etc.
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Drop Tables (already human-readable, but track for validation)
CREATE TABLE drop_tables (
  name TEXT PRIMARY KEY,
  description TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sync metadata
CREATE TABLE sync_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sync_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  revision TEXT,                -- Aurorium revision used
  items_count INTEGER,
  spells_count INTEGER,
  npcs_count INTEGER,
  quests_count INTEGER,
  zones_count INTEGER,
  status TEXT,                  -- 'success', 'partial', 'failed'
  error_message TEXT
);
```

## API Endpoints

### GET /api/names/:type
Retrieve all names for a given object type.

**Request:**
```http
GET /api/names/items
GET /api/names/spells
GET /api/names/npcs
GET /api/names/quests
GET /api/names/zones
```

**Response:**
```json
{
  "items": [
    { "gid": 4808, "name": "Twice Stitched Boots" },
    { "gid": 126913, "name": "Fire Cat Robe" }
  ]
}
```

### GET /api/names/:type/:id
Lookup a specific name by ID.

**Request:**
```http
GET /api/names/items/4808
```

**Response:**
```json
{ "gid": 4808, "name": "Twice Stitched Boots" }
```

### POST /api/sync
Trigger a manual sync.

**Request:**
```http
POST /api/sync
```

**Response:**
```json
{
  "status": "success",
  "synced": {
    "items": 15234,
    "spells": 8456,
    "npcs": 3210,
    "quests": 1847,
    "zones": 432
  },
  "timestamp": "2026-09-25T15:30:00Z"
}
```

### GET /api/sync/status
Get last sync status.

**Response:**
```json
{
  "last_sync": "2026-09-25T15:30:00Z",
  "revision": "V_r806919.Wizard_1_610",
  "status": "success"
}
```

## UI Components

### FriendlyNameDropdown
Reusable component for selecting objects by name.

**Props:**
```typescript
interface FriendlyNameDropdownProps {
  type: 'items' | 'spells' | 'npcs' | 'quests' | 'zones';
  value?: number | string;        // Currently selected ID/key
  onChange: (value: number | string) => void;
  placeholder?: string;
  disabled?: boolean;
}
```

**Behavior:**
- Fetches names from `/api/names/:type` on mount
- Displays dropdown with format: `"Name (ID)"` (e.g., "Twice Stitched Boots (4808)")
- Supports search/filter by name or ID
- Returns ID/key on selection

### Integration with Forms

Example: DropTable Editor
```tsx
<DropItemForm>
  <label>Item:</label>
  <FriendlyNameDropdown 
    type="items"
    value={itemId}
    onChange={(gid) => setItemId(gid)}
  />
  
  {/* Hidden field stores actual ID */}
  <input type="hidden" name="ItemId" value={itemId} />
</DropItemForm>
```

## Implementation Phases

### Phase 1: Core Infrastructure (MVP)
1. Set up Node.js/Express backend with SQLite
2. Implement sync script with Imcodec.Cli integration
3. Create basic API endpoints
4. Build FriendlyNameDropdown component
5. Test with Items and Spells only

### Phase 2: Complete Object Coverage
1. Add NPC, Quest, Zone extraction
2. Handle string table lookups for quest titles
3. Add remaining API endpoints
4. Update all form editors to use dropdowns

### Phase 3: Polish & Optimization
1. Add caching layer for API responses
2. Implement incremental sync (only update changed templates)
3. Add search/autocomplete optimization
4. Error handling and user feedback
5. Documentation and onboarding

## Dependencies

### Required Tools
- **.NET 9 SDK**: For building/running Imcodec.Cli
- **Node.js 18+**: For backend and sync script
- **SQLite3**: Database engine

### NPM Packages
```json
{
  "dependencies": {
    "express": "^4.18.0",
    "better-sqlite3": "^9.0.0",
    "cors": "^2.8.5",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/better-sqlite3": "^7.6.0",
    "typescript": "^5.0.0",
    "ts-node": "^10.9.0"
  }
}
```

### External Repositories
- **Aurorium**: `/home/jason/Documents/git-projects/Aurorium/` (game assets)
- **Imcodec**: `/home/jason/Documents/git-projects/Imview/submodule/Imcodec/` (WAD parser)
- **SpiralDB**: `/home/jason/Documents/git-projects/spiraldb/` (output target)

## Security Considerations

1. **Read-only access to Aurorium**: Sync script should never modify game assets
2. **No credentials in codebase**: Database path and config via environment variables
3. **Input validation**: Sanitize all API inputs to prevent SQL injection
4. **File path validation**: Ensure sync script only accesses expected directories

## Future Enhancements

1. **Webhook Integration**: Auto-sync when Aurorium fetches new revision
2. **Diff Detection**: Show what changed between syncs
3. **Export Functionality**: Export name mappings as CSV/JSON for external tools
4. **Localization Support**: Multiple language name mappings
5. **Validation Rules**: Warn when referencing non-existent IDs

## Open Questions

1. **String Table Resolution**: Quest titles reference string table keys (e.g., `QuestTitle_298DE`). Need to determine how to resolve these to actual text. May require parsing string table WAD files.

2. **NPC Type Classification**: How to distinguish Vendors, Trainers, Quest Givers, Combat NPCs? May need to parse additional template fields or use heuristics.

3. **Zone Display Names**: Zone paths like `WizardCity/WC_Hub` may not have explicit display names. May need to derive from file metadata or maintain manual mapping.

4. **Incremental Sync Strategy**: Should we track file hashes/timestamps to avoid reprocessing unchanged WAD files?

5. **Concurrent Access**: SQLite supports concurrent reads but single-writer. Is this sufficient, or do we need connection pooling?

## References

- [SpiralDB Reference](./spiraldb-reference.md) - JSON schemas and directory structure
- [Imcodec Repository](https://github.com/Jooty/Imcodec) - WAD parsing library
- [Aurorium Documentation](../../Aurorium/README.md) - Game asset management
- [Imlight SpiralDB.cs](../../Imlight/src/Imlight.CoreLib/WizardData/SpiralDB.cs) - Server-side loading logic
