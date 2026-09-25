# SpiralDB UI — Data Model

SQLite schemas, verification lifecycle, file naming conventions, git strategy, and data handling rules. The database lives at `data/spiraldb-ui.db` relative to project root.

## Verification Status Lifecycle

Every SpiralDB entry managed by the UI has a verification status stored in the local SQLite database (NOT in the SpiralDB repo):

```
extracted → reviewed → verified
```

| Status | Meaning | Set When |
|--------|---------|----------|
| `extracted` | Just imported from packet capture or created | Initial save to SpiralDB |
| `reviewed` | Human checked the JSON for correctness | User clicks "Mark Reviewed" |
| `verified` | Tested on a live Imlight server and confirmed working | User clicks "Mark Verified" |

Status transitions require optional notes. Full history is preserved in `status_history` table.

## SQLite Schema

### entry_status

Tracks verification status for ALL SpiralDB object types.

```sql
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

-- Index for fast filtering
CREATE INDEX idx_entry_status_type ON entry_status(object_type);
CREATE INDEX idx_entry_status_status ON entry_status(status);
CREATE INDEX idx_entry_status_key ON entry_status(object_type, object_key);
```

### status_history

History of all status changes with notes.

```sql
CREATE TABLE status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_status_id INTEGER NOT NULL REFERENCES entry_status(id),
  
  old_status TEXT,
  new_status TEXT NOT NULL,
  notes TEXT,                        -- Optional free-text notes
  changed_by TEXT,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Friendly Name Tables

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

-- String table entries (from .lang files)
CREATE TABLE string_table (
  key TEXT PRIMARY KEY,       -- e.g., "QuestTitle_0001ED8D"
  value TEXT NOT NULL,        -- e.g., "The Bear Truth"
  category TEXT NOT NULL,     -- e.g., "QuestTitle"
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Sync Metadata

```sql
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

### Settings

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Keys: aurorium_path, imcodec_path, user_name, spiraldb_path, git_branch
```

Default values on first run:
- `aurorium_path`: `/home/jason/Documents/git-projects/Aurorium`
- `imcodec_path`: auto-detect from `which imcodec` or known Imview submodule path
- `user_name`: empty (prompt on first use)
- `spiraldb_path`: `/home/jason/Documents/git-projects/spiraldb`
- `git_branch`: `content/{YYYY-MM-DD}` (auto-generated per session)

## File Naming Conventions

All new files follow `{type_prefix}_{key}.json`:

| Object Type | Prefix | Key Source | Example |
|-------------|--------|-----------|---------|
| QuestTemplate | `questtemplates` | m_questName | `questtemplates_DS-ACAD1-C01-001.json` |
| DropTable | `droptable` | Name | `droptable_WC-UNICORN-MAIN-007.json` |
| NPCInventory | `npcinventory` | TemplateID | `npcinventory_87112.json` |
| NPCSpellInventory | `npcspellinventory` | TemplateID | `npcspellinventory_1452231.json` |
| CreatureSpellbook | `creaturespellbook` | DeckName | `creaturespellbook_Mdeck-L-BR-DS-SylviaDrake-A-50.json` |
| NpcDropTable | `npcdroptable` | TemplateID | `npcdroptable_12345.json` |
| TreasureCardInventory | `treasurecardinventory` | TemplateID | `treasurecardinventory_38214.json` |
| WizardZoneData | `zonetransfer` | ZoneName (slash→underscore) | `zonetransfer_WizardCity_WC_Hub.json` |
| QuestMetadata | `questmetadata` | quest name | `questmetadata_DS-ACAD1-C01-001.json` |

GlobalRegistry is special: single file `globalregistry.json` containing the merged dictionary.

## Metadata Files

Only **quests** get companion metadata files in `QuestMetadatas/`. Other object types that need audit fields (CreatedBy, ModifiedAt, etc.) embed them directly in their main JSON (as DropTable already does). No separate metadata directories for non-quest types.

Quest metadata format:
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

## Git Branch Strategy

On first save in a session:
1. Generate branch name: `content/YYYY-MM-DD` (e.g., `content/2026-09-25`)
2. Check if branch exists in SpiralDB repo
3. If not, create from current HEAD of main
4. All subsequent saves in that session commit to this branch
5. Store branch name in SQLite `settings` table as `git_branch`
6. User can change branch in Settings page

Commit message format:
```
spiraldb: {action} {object_type} {object_key}

{optional notes}
```

Actions: `extract`, `update`, `create`

## User Identity

Stored in SQLite `settings` table as `user_name`. On first status transition or save, if `user_name` is empty, show a one-time prompt/modal asking for the user's name. Save to settings. Never ask again.

Used for:
- `changed_by` in status_history
- `CreatedBy` / `ModifiedBy` in metadata JSON files
- Git commit author (via `simple-git` configuration)

## SpiralDB JSON Parsing

**Critical**: Most existing SpiralDB JSON files contain **trailing commas** before closing braces/brackets. Standard `JSON.parse()` rejects these. All 322 quest files, all DropTables, NpcInventories, and CreatureSpellbooks are affected.

### Reading SpiralDB Files
Use the `json5` npm package for reading/parsing any JSON file from the SpiralDB repository:
```typescript
import JSON5 from 'json5';

const content = fs.readFileSync(filePath, 'utf-8');
const data = JSON5.parse(content);
```

### Writing SpiralDB Files
Write **clean JSON** (no trailing commas) using standard `JSON.stringify()`:
```typescript
fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
```

This means newly created/updated files will be valid JSON, while the reader tolerates legacy files with trailing commas.

## Existing Data Import

On first startup (when `entry_status` table is empty):
1. Scan all SpiralDB subdirectories for `.json` files
2. For each file, parse the JSON to extract the key field
3. Insert into `entry_status` with `status='extracted'`, `extracted_at=CURRENT_TIMESTAMP`
4. Show toast: "Imported {n} existing entries from SpiralDB"
5. This runs once only; subsequent startups skip if table has rows

Scan mapping:

| Directory | object_type | Key extraction |
|-----------|------------|----------------|
| QuestTemplates/ | quest | Parse JSON → m_questName |
| DropTables/ | drop_table | Parse JSON → Name |
| NpcInventory/ | npc_inventory | Parse JSON → TemplateID (as string) |
| NpcSpellInventory/ | npc_spell_inventory | Parse JSON → TemplateID (as string) |
| CreatureSpellbook/ | creature_spellbook | Parse JSON → DeckName |
| NpcDropTable/ | npc_drop_table | Parse JSON → TemplateID (as string) |
| TreasureCardInventory/ | treasure_card_inventory | Parse JSON → TemplateID (as string) |
| ZoneTransfer/ | zone_transfer | Parse JSON → ZoneName |

Skip: QuestMetadatas/, GlobalRegistry/ (not individually tracked), any non-JSON files, droptables/ subdirectory inside QuestTemplates/.

## Friendly Name Sync Strategy

Friendly name sync always performs a **full re-sync** — no incremental tracking. Root.wad unpack + parse takes seconds, not minutes. Incremental sync adds complexity with negligible benefit for a local single-user tool.

Each sync:
1. Unpacks Root.wad fresh to a temp directory
2. Parses all template files and `.lang` files
3. Replaces all rows in the friendly name tables within a transaction
4. Cleans up temp directory

See [Domain Reference](./spec-domain-reference.md#friendly-name-sync) for WAD source details and string table resolution.

## Related Documentation

- [Architecture](./spec-architecture.md) — System overview, tech stack, external dependencies
- [API Reference](./spec-api.md) — All REST endpoints
- [Domain Reference](./spec-domain-reference.md) — SpiralDB JSON schemas, type enumerations
- [UI Design](./spec-ui-design.md) — Visual design, layout, component patterns
