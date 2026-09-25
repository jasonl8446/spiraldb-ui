# Implementation Details - Resolved Gaps

This document resolves every ambiguity discovered during spec audit. An autonomous implementing agent MUST follow these specifications exactly. Nothing here is optional.

## 1. Packet Capture File Format

**Spec correction**: Packet captures are **JSON files** (`.json`), NOT binary pcap files.

The `PacketReaderService.ExtractPacketsAsync()` method calls `File.ReadAllTextAsync()` + `JsonNode.Parse()`. The file is a JSON array of packet objects with structure:

```json
[
  {
    "data": {
      "name": "MSG_QUESTOFFER",
      ...packet fields...
    }
  },
  {
    "data": {
      "name": "MSG_SENDGOAL",
      ...packet fields...
    }
  }
]
```

**UI upload zone must say**: "Supported format: JSON packet capture files (.json)"

## 2. CLI Wrapper for Packet Reader

There is NO existing `imview-packet-reader` binary. A new .NET 9 console project must be created.

### Location
```
spiraldb-ui/tools/PacketReaderCli/
├── PacketReaderCli.csproj
└── Program.cs
```

### Project File
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net9.0</TargetFramework>
    <AssemblyName>imview-packet-reader</AssemblyName>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="../../../Imview/src/Imview.PacketReader/Imview.PacketReader.csproj" />
  </ItemGroup>
</Project>
```

### Program.cs Interface
```csharp
// Usage: imview-packet-reader --input <path> [--output <path|->]
// Output: JSON array of QuestTemplate objects to stdout or file
// Exit codes: 0=success, 1=error (message on stderr)
```

The program should:
1. Parse `--input` and optional `--output` arguments
2. Call `QuestBuilder.BuildQuestsFromPacketCaptureAsync(inputPath)`
3. Serialize result as JSON array
4. Write to `--output` path, or stdout if `-` or omitted
5. On error, write message to stderr and exit 1

### Build Command
```bash
dotnet build tools/PacketReaderCli/PacketReaderCli.csproj -c Release -o tools/bin/
```

The built binary lands at `tools/bin/imview-packet-reader`.

### Node.js Integration
```typescript
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';

const CLI_PATH = resolve(__dirname, '../../tools/bin/imview-packet-reader');

async function extractQuestsFromCapture(capturePath: string): Promise<QuestTemplate[]> {
  return new Promise((resolve, reject) => {
    execFile(CLI_PATH, ['--input', capturePath], { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(JSON.parse(stdout));
    });
  });
}
```

## 3. Friendly Name Sync - WAD Source

All template instances live in **Root.wad** at:
```
{aurorium_path}/data/{revision}/Data/GameData/Root.wad
```

### Revision Selection
Auto-detect the latest revision by sorting directory names under `{aurorium_path}/data/` alphanumerically descending and taking the first match for pattern `V_r*`. Allow override via settings.

### Extraction Process
```bash
# Step 1: Unpack Root.wad with deserialization
imcodec wad unpack --deser {root_wad_path} {temp_output_dir}

# Step 2: Parse deserialized JSON files for template instances
# Each file in the output directory corresponds to a template type
```

### Name Field
All template types use `m_name` as the display name field:
- ItemTemplate → `m_name`
- SpellTemplate → `m_name`  
- ActorTemplate → `m_name`
- PetTemplate → `m_name`
- MountTemplate → `m_name`

### String Table Resolution
String table keys (e.g., `QuestTitle_1ED8D`) are resolved during sync:
1. Root.wad contains string table files (look for files containing string key→value mappings after `imcodec wad unpack --deser`)
2. Extract all key→text pairs into SQLite `string_table` table:
   ```sql
   CREATE TABLE string_table (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
   );
   ```
3. UI displays resolved text with raw key as tooltip: `"Collect Crystals" (QuestTitle_1ED8D)`

### Sync Script Configuration
Paths stored in SQLite `settings` table:
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

## 4. Database Location

SQLite database file: `data/spiraldb-ui.db` relative to project root.

Create `data/` directory on first run if missing. Add to `.gitignore`:
```
data/
tools/bin/
```

## 5. Server Configuration

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

## 6. URL Routes

```
/                           → Dashboard
/quests                     → Quest list/browse
/quests/extract             → Quest extraction (upload + review)
/quests/:questName          → Quest detail/edit
/drop-tables                → DropTable list
/drop-tables/:name          → DropTable detail/edit
/npc-inventories            → NpcInventory list
/npc-inventories/:id        → NpcInventory detail/edit
/npc-spell-inventories      → NpcSpellInventory list
/npc-spell-inventories/:id  → NpcSpellInventory detail/edit
/creature-spellbooks        → CreatureSpellbook list
/creature-spellbooks/:name  → CreatureSpellbook detail/edit
/npc-drop-tables            → NpcDropTable list
/npc-drop-tables/:id        → NpcDropTable detail/edit
/treasure-card-inventories  → TreasureCardInventory list
/treasure-card-inventories/:id → TreasureCardInventory detail/edit
/zone-transfers             → ZoneTransfer list
/zone-transfers/:name       → ZoneTransfer detail/edit
/global-registry            → GlobalRegistry editor
/settings                   → Settings page (paths, user name, sync)
```

React Router v6 with `<BrowserRouter>`. Layout component wraps all routes with sidebar + header.

## 7. Git Branch Strategy

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

## 8. User Identity

Stored in SQLite `settings` table as `user_name`. On first status transition or save, if `user_name` is empty, show a one-time prompt/modal asking for the user's name. Save to settings. Never ask again.

Used for:
- `changed_by` in status_history
- `CreatedBy` / `ModifiedBy` in metadata JSON files
- Git commit author (via `simple-git` configuration)

## 9. File Naming Conventions

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

## 10. Existing Data Import

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

## 11. Result Types - Complete Enumeration

These are ALL result types found in actual SpiralDB quest data, with their fields:

### ResDropTable
Most common. Grants loot from a named drop table.
```json
{
  "$type": "Imcodec.ObjectProperty.TypeCache.ResDropTable, Imcodec.ObjectProperty",
  "m_tableName": "DS-ACAD1-C01-001",
  "m_maxRolls": 1
}
```
Fields: `m_tableName` (string), `m_maxRolls` (int)

### ResModifyEntry
Modifies a quest registry entry value.
```json
{
  "$type": "Imcodec.ObjectProperty.TypeCache.ResModifyEntry, Imcodec.ObjectProperty",
  "m_questName": "...",
  "m_entryName": "...",
  "m_isQuestRegistry": true,
  "m_value": 1
}
```
Fields: `m_questName` (string), `m_entryName` (string), `m_isQuestRegistry` (bool), `m_value` (int)

### ResAddDynaMod
Adds/removes a dynamic modifier.
```json
{
  "$type": "Imcodec.ObjectProperty.TypeCache.ResAddDynaMod, Imcodec.ObjectProperty",
  "m_dynaModClientTag": "WC-FairyCage02 instance",
  "m_dynaModRemove": false,
  "m_useQuestAsOriginator": true,
  "m_dynaModState": "",
  "m_zoneName": ""
}
```
Fields: `m_dynaModClientTag` (string), `m_dynaModRemove` (bool), `m_useQuestAsOriginator` (bool), `m_dynaModState` (string), `m_zoneName` (string)

### ResLearnSpell
Teaches the player a spell.
```json
{
  "$type": "Imcodec.ObjectProperty.TypeCache.ResLearnSpell, Imcodec.ObjectProperty",
  "m_templateID": 2062265892,
  "m_requirements": { ... }
}
```
Fields: `m_templateID` (ulong), `m_requirements` (RequirementList, optional)

### ResPostEvent
Posts a game event.
```json
{
  "$type": "Imcodec.ObjectProperty.TypeCache.ResPostEvent, Imcodec.ObjectProperty",
  "m_eventName": "SomeEvent"
}
```
Fields: `m_eventName` (string)

### Result Editor UI
The result type selector dropdown shows these 5 types. When a type is selected, the form dynamically shows the appropriate fields. All fields use friendly name dropdowns where applicable (m_tableName → drop table dropdown, m_templateID → spell dropdown).

## 12. Requirement Types - Complete Enumeration

Only 3 requirement types appear in actual SpiralDB quest data:

### ReqHasQuest
Player must have (or not have) a specific quest.
Fields: `m_questName` (string, quest dropdown), `m_applyNOT` (bool), `m_operator` (enum: ROP_AND/ROP_OR)

### ReqHasEntry  
Player must have a specific quest registry entry.
Fields: `m_questName` (string), `m_entryName` (string), `m_applyNOT` (bool), `m_operator` (enum)

### ReqSchoolOfFocus
Player must be a specific magic school.
Fields: `m_magicSchool` (enum: Fire/Ice/Storm/Balance/Life/Death/Myth), `m_applyNOT` (bool), `m_operator` (enum)

All requirement types share base fields: `m_applyNOT` (bool), `m_operator` ("ROP_AND" | "ROP_OR").

The RequirementList wrapper adds: `m_requirements` (array of nested requirements), enabling recursive AND/OR trees.

## 13. Goal Types - Complete Field Reference

### WaypointGoalTemplate
Navigate to a zone/trigger.
Type-specific fields: `m_zoneEntry` (bool), `m_zoneTag` (string, zone dropdown), `m_proximityTag` (string), `m_zoneExit` (bool)

### PersonaGoalTemplate  
Talk to an NPC.
Type-specific fields: `m_personaName` (string, NPC dropdown), `m_usePatron` (bool), `m_dialogList` (ActorDialogList)

### BountyGoalTemplate
Kill mobs.
Type-specific fields: `m_npcAdjectives` (string[]), `m_bountyTotal` (int), `m_bountyType` (string, e.g. "BT_MOB_KILL"), `m_tallyCounter` (object)

### ScavengeGoalTemplate
Collect items from world.
Type-specific fields: `m_itemAdjectives` (string[]), `m_itemTotal` (int), `m_tallyCounter` (object)

### AchieveRankGoalTemplate
Reach a rank/level.
Type-specific fields: `m_rank` (int)

### Shared Base Fields (all goal types)
`m_goalName`, `m_goalNameID`, `m_goalTitle`, `m_goalUnderway`, `m_hyperlink`, `m_completeText`, `m_completeResults`, `m_goalRequirements`, `m_tallyCounter`, `m_locationName`, `m_displayImage1`, `m_displayImage2`, `m_clientTags`, `m_genericEvents`, `m_autoQualify`, `m_autoComplete`, `m_destinationZone`, `m_dialogList`, `m_goalType`, `m_noQuestHelper`, `m_petOnlyQuest`, `m_activateResults`, `m_hideGoalFloatyText`, `m_behaviors`

## 14. API Endpoint Completeness

All API endpoints must be implemented. Complete list:

### Names
- `GET /api/names/:type` — List all names for type (items, spells, npcs, quests, zones, drop_tables, strings)
- `GET /api/names/:type/:id` — Single name lookup

### Status
- `GET /api/status/:type` — List entries with status, supports `?status=` filter
- `GET /api/status/all` — All entries across types
- `PATCH /api/status/:type/:key` — Update status + notes
- `GET /api/status/:type/:key/history` — Status change history
- `GET /api/dashboard` — Aggregated stats

### Objects (CRUD for each type)
- `GET /api/quests` — List all quests (from SpiralDB files)
- `GET /api/quests/:name` — Single quest JSON
- `POST /api/quests` — Save new/update quest (writes file + metadata + git commit)
- Same pattern for: drop-tables, npc-inventories, npc-spell-inventories, creature-spellbooks, npc-drop-tables, treasure-card-inventories, zone-transfers, global-registry

### Extraction
- `POST /api/extract/quests` — Upload packet capture JSON, returns extracted quests

### Sync
- `POST /api/sync` — Trigger friendly name sync
- `GET /api/sync/status` — Last sync info
- `GET /api/sync/history` — Sync history

### Settings
- `GET /api/settings` — All settings
- `PUT /api/settings` — Update settings

## 15. NPCDialogEntry - Complete Field List

All 50+ fields organized by sub-section for the dialog editor:

### Basic
- `m_personaName` (string) — NPC persona identifier
- `m_nameOverride` (string) — Override display name
- `m_nameSTKey` (string) — String table key for name format
- `m_guiDisplay` (string) — GUI display override
- `m_maxTimeSeconds` (int) — Max dialog display time (-1 = unlimited)
- `m_invisible` (bool) — Hide dialog UI
- `m_requirements` (RequirementList?) — Conditions to show this entry
- `m_dialog` (string) — String table key for dialog text
- `m_picture` (string) — Portrait image path
- `m_soundFile` (string) — Voice-over audio path
- `m_action` (string) — Action trigger
- `m_dialogEvent` (string) — Event to fire
- `m_actorTemplateID` (ulong) — NPC actor template (friendly name dropdown)

### Camera
- `m_cameraName` (string) — Camera position name or "LOCATION"
- `m_interpolationDuration` (float) — Camera transition time
- `m_cameraOffsetX/Y/Z` (float) — Camera position offset
- `m_pitch/yaw/roll` (float) — Camera rotation
- `m_cameraShakeType` (string) — Shake effect type
- `m_cameraShakeDuration` (float) — Shake duration
- `m_cameraShakeAmplitude` (float) — Shake intensity
- `m_bypassCameraOnReview` (bool) — Skip camera on dialog review
- `m_cameraZoneName` (string) — Zone for camera position
- `m_cameraHidePlayers` (int) — Hide players during dialog (0=no, 2=yes)
- `m_cameraFadeType` (string) — Fade effect type
- `m_cameraFadeTime` (float) — Fade duration
- `m_secondaryCameraName` (string) — Secondary camera
- `m_secondaryInterpolationDuration` (float)
- `m_secondaryCameraInitalDelay` (float)
- `m_dontReleaseCameraAtExit` (bool)
- `m_fadeOutCamera` (bool)
- `m_snapCameraToPlayerAtExit` (bool)

### Duration & Timing
- `m_duration` (float) — Dialog duration
- `m_delay` (float) — Delay before showing
- `m_spamTime` (float) — Spam prevention interval
- `m_playSoundIfSpamming` (bool)
- `m_playMusicIfSpamming` (bool)
- `m_displayButtonsOnTimedDialog` (bool)

### Walk-Away
- `m_walkAwayNpcTemplateID` (ulong) — NPC that walks away
- `m_walkAwayExitDirectionInDegrees` (float)
- `m_walkAwayFadeTime` (float)
- `m_walkAwayUseCurrentFacing` (bool)
- `m_standInPlayerTag` (string)

### Audio
- `m_soundEffectFile` (string) — Sound effect path
- `m_musicFile` (string) — Music track path
- `m_nonStackableMusic` (bool)
- `m_nonRepeatableMusic` (bool)
- `m_playMusicAtSFXVolume` (bool)
- `m_soundEffectDelay` (float)
- `m_musicDelay` (float)
- `m_musicFadeTime` (float)
- `m_stopMusicFadeTime` (float)
- `m_restartMusicFadeTime` (float)

### Animation & NPC
- `m_idleAnimation` (string)
- `m_npcStandInList` (array)
- `m_dialogAnimationList` (array)
- `m_dialogTurningList` (array)
- `m_npcYawOffsetInDegrees` (float)
- `m_allowPlayerToMove` (bool)
- `m_defaultDialogAnimation` (object?)

### UI Controls
- `m_disableBackButton` (bool)
- `m_enableExitButton` (bool)
- `m_meetsRequirements` (bool) — Internal flag, usually true

## 16. Validation Rules

### Quest Validation (before save)
- `m_questName` must be non-empty
- `m_startGoals` must reference valid goal names in `m_goals`
- Every goal in `m_goals` must have a unique `m_goalName`
- Goal logic chain must be reachable from start goals (no disconnected nodes)
- Final goal logic entry must have `m_completeQuest: true`
- All `$type` annotations must be valid fully-qualified type names

### DropTable Validation
- `Name` must be non-empty and unique across all drop tables
- `RollChance` must be 0.0–1.0
- `NoneChance` must be 0.0–1.0
- `MinGold` ≤ `MaxGold`

### General Validation
- All TemplateID fields must be positive integers
- Zone paths must match known zones (from synced zone names)
- Item/Spell/NPC references should warn (not block) if ID not found in friendly names DB

Validation errors shown inline per field (red border + message below). Form-level errors shown as banner at top of form. Save button disabled while validation errors exist.
