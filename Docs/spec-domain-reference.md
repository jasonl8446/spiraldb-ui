# SpiralDB UI — Domain Reference

SpiralDB JSON schemas, type enumerations (goals, requirements, results, dialog), validation rules, CLI wrapper specification, and friendly name sync internals. This is the authoritative reference for all domain-specific details an implementing agent must follow.

## SpiralDB Directory Layout

```
spiraldb/
  CreatureSpellbook/     # One JSON per spellbook deck
  DropTables/            # One JSON per loot table
  GlobalRegistry/        # One or more JSON files with global float values
  NpcInventory/          # One JSON per NPC vendor inventory
  NpcSpellInventory/     # One JSON per NPC spell trainer inventory
  NpcDropTable/          # One JSON per NPC-to-drop-table mapping
  TreasureCardInventory/ # One JSON per NPC treasure card vendor
  QuestTemplates/        # One JSON per quest definition
  QuestMetadatas/        # Optional metadata (not loaded by server, used by tooling)
  ZoneTransfer/          # One JSON per zone's teleport triggers
```

Each directory is optional. Missing directories are silently skipped by the server.

---

## JSON Schemas

### CreatureSpellbook

**Directory:** `CreatureSpellbook/`  
**Keyed by:** `DeckName` (case-insensitive string lookup)

```json
{
  "DeckName": "Mdeck-L-BR-DS-SylviaDrake-A-50",
  "SpellTemplateIds": [409737272, 1321504283, 603728324]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `DeckName` | string | yes | Unique identifier for this spellbook |
| `SpellTemplateIds` | uint[] | yes | Array of spell template IDs |

### DropTable

**Directory:** `DropTables/`  
**Keyed by:** `Name` (case-insensitive string lookup)

```json
{
  "Name": "WC-UNICORN-MAIN-007",
  "Description": "",
  "RollChance": 1.0,
  "Weight": 100,
  "NoneChance": 0.0,
  "PityCounter": 0.0,
  "MinGold": 10,
  "MaxGold": 10,
  "ExperienceAmount": 110,
  "TrainingPoints": 0,
  "GrantsPotionSlot": false,
  "Items": [
    {
      "ItemId": "4808",
      "ItemName": "Twice Stitched Boots",
      "Notes": "Balance Item",
      "Requirements": { ... }
    }
  ],
  "CreatedAt": "2025-10-21T17:49:13.5296616Z",
  "ModifiedAt": "2025-12-05T01:07:13.8203045Z",
  "CreatedBy": "jay",
  "ModifiedBy": "jay"
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `Name` | string | `""` | Unique name. Referenced by NpcDropTable and ResDropTable |
| `Description` | string | `""` | Human-readable description |
| `RollChance` | double | `1.0` | Probability (0.0–1.0) that this table is rolled |
| `Weight` | int | `100` | Relative weight when multiple tables compete |
| `NoneChance` | double | `0.0` | Probability that the roll produces nothing |
| `PityCounter` | double | `0.0` | Pity system counter |
| `MinGold` / `MaxGold` | int | `0` | Gold range (random value in `[MinGold, MaxGold]`) |
| `ExperienceAmount` | int | `0` | XP granted |
| `TrainingPoints` | int | `0` | Training points granted |
| `GrantsPotionSlot` | bool | `false` | Whether this roll grants a potion slot |
| `Items` | DropItem[] | `[]` | List of possible item drops |
| `CreatedAt` / `ModifiedAt` | DateTime | now | ISO 8601 timestamps |
| `CreatedBy` / `ModifiedBy` | string | system user | Authorship |

#### DropItem

| Field | Type | Default | Description |
|---|---|---|---|
| `ItemId` | string | `""` | Numeric item template ID as a string |
| `ItemName` | string | `""` | Human-readable item name (informational) |
| `Notes` | string | `""` | Free-form notes |
| `Requirements` | RequirementList? | `null` | Optional requirement gate (polymorphic `$type` format) |

### GlobalRegistry

**Directory:** `GlobalRegistry/`  
**Keyed by:** dictionary key (merged across all files)

```json
{
  "GlobalRegistryValues": {
    "Localization": 1,
    "Christmas": 0,
    "Halloween": 0
  }
}
```

| Field | Type | Description |
|---|---|---|
| `GlobalRegistryValues` | Dictionary\<string, float\> | Map of registry key to float value. Case-sensitive keys. Later files overwrite earlier. |

### NPCInventory

**Directory:** `NpcInventory/`  
**Keyed by:** `TemplateID` (ulong)

```json
{
  "TemplateID": 87112,
  "Inventory": [126913, 126914, 126915, 77614, 87237, 4873]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `TemplateID` | ulong | yes | NPC actor template ID |
| `Inventory` | GID[] | yes | Array of item GIDs available from this vendor |

### NPCSpellInventory

**Directory:** `NpcSpellInventory/`  
**Keyed by:** `TemplateID` (ulong)

```json
{
  "TemplateID": 1452231,
  "Spells": [
    { "TemplateID": 84361, "RequiredSpellID": 0, "Level": 1 },
    { "TemplateID": 2106466410, "RequiredSpellID": 84361, "Level": 5 }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `TemplateID` | ulong | yes | NPC actor template ID |
| `Spells` | NPCSpellEntry[] | yes | Spell entries offered by this trainer |

#### NPCSpellEntry

| Field | Type | Required | Description |
|---|---|---|---|
| `TemplateID` | ulong | yes | Spell template ID being offered |
| `RequiredSpellID` | ulong | yes | Prerequisite spell (`0` = none) |
| `Level` | int | yes | Minimum wizard level required |

### NpcDropTable

**Directory:** `NpcDropTable/`  
**Keyed by:** `TemplateID` (ulong)

```json
{
  "TemplateID": 12345,
  "DropTableNames": ["WC-UNICORN-MAIN-007", "WC-UNICORN-BONUS-001"]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `TemplateID` | ulong | yes | NPC actor template ID |
| `DropTableNames` | string[] | yes | Names of DropTable entries to roll |

### TreasureCardInventory

**Directory:** `TreasureCardInventory/`  
**Keyed by:** `TemplateID` (ulong)

```json
{
  "TemplateID": 38214,
  "TreasureCards": [
    { "SpellName": "Fire Shield TC", "Price": 100 },
    { "SpellName": "Fire Cat TC", "Price": 150 }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `TemplateID` | ulong | yes | NPC actor template ID |
| `TreasureCards` | TreasureCardEntry[] | yes | Treasure cards for sale |

#### TreasureCardEntry

| Field | Type | Required | Description |
|---|---|---|---|
| `SpellName` | string | yes | Spell name (must match SpellTemplate.m_name) |
| `Price` | int | yes | Gold price (`0` = use spell template's m_baseCost) |

### QuestTemplate

**Directory:** `QuestTemplates/`  
**Keyed by:** `m_questName` (case-insensitive string lookup)

Full quest definitions including goals, requirements, dialog, rewards, and goal progression logic. Complex polymorphic type serialized with `$type` annotations.

```json
{
  "m_questName": "DS-ACAD-C01-001",
  "m_questNameID": 0,
  "m_questTitle": "QuestTitle_298DE",
  "m_questInfo": null,
  "m_questPrep": null,
  "m_questUnderway": null,
  "m_questComplete": null,
  "m_startGoals": ["1_WizardQuestGoals_UseItem"],
  "m_goals": [ ... ],
  "m_startResults": { "m_results": [] },
  "m_endResults": { "m_results": [ ... ] },
  "m_requirements": { ... },
  "m_goalLogic": [ ... ],
  "m_questLevel": 1,
  "m_questRepeat": 0,
  "m_isHidden": false,
  "m_mainline": true,
  "m_activityType": "ACTIVITY_NotActivity"
}
```

#### Top-level Fields

| Field | Type | Description |
|---|---|---|
| `m_questName` | string | Unique quest identifier |
| `m_questNameID` | uint | Hashed quest name ID (can be `0`) |
| `m_questTitle` | string | String table key for quest title |
| `m_questInfo` | string? | String table key for quest info text |
| `m_questPrep` | string? | Pre-acceptance description |
| `m_questUnderway` | string? | In-progress description |
| `m_questComplete` | string? | Completion text |
| `m_startGoals` | string[] | Goal names activated on quest accept |
| `m_goals` | GoalTemplate[] | Polymorphic array of goal definitions |
| `m_startResults` | ResultList | Results applied on quest accept |
| `m_endResults` | ResultList | Results applied on quest complete |
| `m_requirements` | RequirementList? | Requirements to accept the quest |
| `m_prepRequirements` | RequirementList? | Requirements to see the quest offer |
| `m_pruneRequirements` | RequirementList? | Requirements that remove the quest |
| `m_goalLogic` | GoalLogicEntry[] | Goal progression rules |
| `m_questLevel` | int | Suggested level |
| `m_questRepeat` | int | Repeatability flag (`0` = not repeatable) |
| `m_onStartQuestScript` | string | Script on quest start |
| `m_onEndQuestScript` | string | Script on quest end |
| `m_dialogList` | ActorDialogList? | Dialog tree for quest giver |
| `m_isHidden` | bool | Hidden from quest log |
| `m_mainline` | bool | Mainline story quest |
| `m_noQuestHelper` | bool | Disables quest helper arrow |
| `m_clientTags` | string[]? | Tags for client UI filtering |
| `m_activityType` | string | Activity classification |
| `m_prepAlways` | bool | Always show prep dialog |
| `m_forceInteraction` | bool | Forces interaction prompt |
| `m_checkInventoryForCrafting` | bool | Checks inventory for crafting goals |
| `m_playAsYourPetNPC` | bool | Pet-play mode flag |
| `m_missionDoors` | object? | Mission door configuration |
| `m_dynaMods` | object? | Dynamic modifier configuration |
| `m_outdated` | bool | Marks quest as deprecated |
| `m_defaultDialogAnimation` | object? | Default dialog animation |
| `m_skipQHAutoSelect` | bool | Skips auto quest helper selection |
| `m_questEffectInfoList` | object? | Visual/audio effects |
| `m_behaviors` | object? | Server-side behaviors |

### WizardZoneData (ZoneTransfer)

**Directory:** `ZoneTransfer/`  
**Keyed by:** `ZoneName` (case-insensitive string lookup)

```json
{
  "ZoneName": "WizardCity/WC_Hub",
  "Teleports": [
    {
      "TriggerName": "TeleportToShoppingDistrict",
      "Teleport": {
        "m_destinationLoc": "-95.55735,-849.2842,-30.46902,-0.03700731",
        "m_destinationZone": "WizardCity/WC_Shop_Area",
        "m_exitTeleporter": 0,
        "m_teleporterTag": 0,
        "m_teleportType": "TELEPORT_STATIC",
        "m_transitionID": 0
      }
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `ZoneName` | string | yes | Full zone path (lookup key) |
| `Teleports` | WizardTeleportData[] | yes | Teleport trigger definitions |

---

## Goal Types — Complete Field Reference

Goals use the Imcodec type system. The `$type` field determines which subclass is deserialized.

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

### GoalLogicEntry

Controls quest progression:

| Field | Type | Description |
|---|---|---|
| `m_goalsAND` | string[] | Goal names that must ALL be complete |
| `m_goalsOR` | string[] | Goal names where ANY completion counts |
| `m_goalsToAdd` | string[] | Goal names to activate when conditions met |
| `m_completeQuest` | bool | When true, completing this entry finishes the quest |
| `m_requiredORCount` | int | Number of OR goals that must be completed |

---

## Result Types — Complete Enumeration

All 14 result types found in actual SpiralDB quest data:

### ResDropTable
Most common. Grants loot from a named drop table.  
Fields: `m_tableName` (string), `m_maxRolls` (int)

### ResModifyEntry
Modifies a quest registry entry value.  
Fields: `m_questName` (string), `m_entryName` (string), `m_isQuestRegistry` (bool), `m_value` (int)

### ResAddDynaMod
Adds/removes a dynamic modifier.  
Fields: `m_dynaModClientTag` (string), `m_dynaModRemove` (bool), `m_useQuestAsOriginator` (bool), `m_dynaModState` (string), `m_zoneName` (string)

### ResLearnSpell
Teaches the player a spell.  
Fields: `m_templateID` (ulong), `m_requirements` (RequirementList, optional)

### ResPostEvent
Posts a game event.  
Fields: `m_eventName` (string)

### ResAddHealth
Restores health. Fields: none (default full heal)

### ResAddMana
Restores mana. Fields: none (default full restore)

### ResAddSpell
Adds a spell to spellbook (without permanent learning).  
Fields: `m_templateID` (ulong, spell dropdown)

### ResDespawn
Despawns an NPC or object.  
Fields: `m_spawnID` (int), `m_despawnEffect` (bool), `m_templateID` (ulong, NPC dropdown)

### ResDrawHand
Draws/plays a hand animation on an NPC.  
Fields: `m_templateID` (ulong, NPC dropdown)

### ResGiveSpell
Gives a specific spell to an NPC.  
Fields: `m_templateID` (ulong, NPC dropdown), `m_spellID` (ulong, spell dropdown)

### ResPlaySound
Plays a sound effect with optional spatial routing.  
Fields: `m_router` (object: `m_locX/Y/Z` floats, `m_routingType` string, `m_useLocation` bool, `m_useTriggerLocation` bool), `m_soundName` (string), `m_blocking` (bool), `m_reinteractTime` (float)

### ResTeleport
Teleports the player.  
Fields: `m_destinationLoc` (string), `m_destinationZone` (string, zone dropdown), `m_exitTeleporter` (int), `m_teleporterTag` (int), `m_teleportType` (string enum), `m_transitionID` (int)

### ResWait
Pauses execution.  
Fields: `m_secondsToWait` (float)

All result types use `$type` annotation: `"Imcodec.ObjectProperty.TypeCache.{TypeName}, Imcodec.ObjectProperty"`. All fields with ID references use friendly name dropdowns in the UI.

---

## Requirement Types — Complete Enumeration

Exactly 4 requirement types appear in actual SpiralDB data:

### ReqHasQuest
Player must have (or not have) a specific quest.  
Fields: `m_questName` (string, quest dropdown), `m_applyNOT` (bool), `m_operator` (enum: ROP_AND/ROP_OR)

### ReqHasEntry
Player must have a specific quest registry entry.  
Fields: `m_questName` (string), `m_entryName` (string), `m_applyNOT` (bool), `m_operator` (enum)

### ReqSchoolOfFocus
Player must be a specific magic school (player's own school).  
Fields: `m_magicSchool` (enum: Fire/Ice/Storm/Balance/Life/Death/Myth), `m_applyNOT` (bool), `m_operator` (enum)

### ReqIsSchool
Checks if a target entity is a specific school.  
Fields: `m_magicSchoolName` (enum), `m_targetType` (string enum, e.g. "RT_Caster"), `m_applyNOT` (bool), `m_operator` (enum)

**Note**: `ReqHasGoal` and `ReqEntryValue` do NOT appear in actual SpiralDB data and should NOT be implemented.

All requirement types share base fields: `m_applyNOT` (bool), `m_operator` ("ROP_AND" | "ROP_OR").

The RequirementList wrapper adds: `m_requirements` (array of nested requirements), enabling recursive AND/OR trees.

---

## NPCDialogEntry — Complete Field List

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

---

## Validation Rules

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

---

## CLI Wrapper for Packet Reader

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

### Packet Capture File Format

Packet captures are **JSON files** (`.json`), NOT binary pcap files. The file is a JSON array of packet objects:

```json
[
  { "data": { "name": "MSG_QUESTOFFER", "...packet fields..." : "..." } },
  { "data": { "name": "MSG_SENDGOAL", "...packet fields..." : "..." } }
]
```

**UI upload zone must say**: "Supported format: JSON packet capture files (.json)"

### Extraction Progress UI

The CLI wrapper is a blocking subprocess with no streaming output. The extraction UI shows an **indeterminate spinner** with text "Extracting quests..." — no live count or progress bar.

### Upload Method

Quest extraction supports **drag-and-drop** and **file picker** only. No manual filesystem path input. Standard web file upload via `POST /api/extract/quests`.

---

## Friendly Name Sync

### WAD Source

All template instances live in **Root.wad** at:
```
{aurorium_path}/data/{revision}/Data/GameData/Root.wad
```

**Revision Selection**: Auto-detect the latest revision by sorting directory names under `{aurorium_path}/data/` alphanumerically descending and taking the first match for pattern `V_r*`. Allow override via settings.

### Extraction Process
```bash
# Unpack Root.wad with deserialization
imcodec wad unpack --deser {root_wad_path} {temp_output_dir}
```

### Name Field
All template types use `m_name` as the display name field:
- ItemTemplate → `m_name`
- SpellTemplate → `m_name`
- ActorTemplate → `m_name`
- PetTemplate → `m_name`
- MountTemplate → `m_name`

### String Table Resolution

String table keys (e.g., `QuestTitle_1ED8D`) are resolved during sync by parsing `.lang` files from Root.wad.

#### .lang File Location
After unpacking Root.wad with `--deser`, string tables are at:
```
{temp_output_dir}/Locale/en-US/*.lang
```
There are ~5,132 `.lang` files covering all string categories.

#### .lang File Format
Files are **UTF-16LE encoded** (with BOM `\xFF\xFE`). Structure:

```
{BOM}1:{CategoryName}\r\n    ← header line (e.g., "1:QuestTitle")
{8-digit index}\r\n           ← numeric index (zero-padded)
\r\n                          ← blank line
{text value}\r\n              ← the actual string
{8-digit index}\r\n           ← next index
\r\n
{text value}\r\n
...
```

#### Key-to-Index Mapping
String table keys use the format `{CategoryName}_{HexIndex}`:
- `QuestTitle_1ED8D` → look up decimal index `126349` (0x1ED8D) in `QuestTitle.lang`

The index space is **sparse** — not every index has a value.

#### Missing Keys
When a string table key has no matching entry, display the raw key as-is (e.g., `QuestTitle_1ED8D`). Do not block or warn — this is expected for deleted/unused content.

### NPC Classification

NPCs are stored as a **flat list** without type classification. The FriendlyNameDropdown shows `"Name (TemplateID)"` for all NPCs uniformly.

### Zone Display Names

Zone paths (e.g., `WizardCity/WC_Hub`) are used as both the key and display name. For presentation, derive a human-readable form by converting underscores and slashes to spaces: `WizardCity/WC_Hub` → `"Wizard City / WC Hub"`.

---

## Additional Design Decisions

### DropTable Item Requirements
DropTable items can have per-item `Requirements` (polymorphic requirement list). The DropTable editor reuses the same `RequirementTreeEditor` component inline within each item row.

### GlobalRegistry Editor
GlobalRegistry is edited as a **single merged view**. On load, read all JSON files from `GlobalRegistry/`, merge into one dictionary, display in a key-value table editor. On save, write back to a single `globalregistry.json` file.

### JSON Serialization Notes
- **TypeNameHandling.Auto**: Polymorphic types include a `$type` field with the fully qualified .NET type name
- **NullValueHandling.Ignore**: Null fields are omitted from serialized JSON
- **Case sensitivity**: Collection keys are stored in case-insensitive dictionaries. NPC keyed collections use exact ulong matching

---

## Imlight Configuration (Imlight.ini)

All settings live under the `[Database]` section of `Config/Imlight.ini`.

| Key | Type | Default | Description |
|---|---|---|---|
| `SpiralDBRemote` | string | `Revive101/spiraldb` | GitHub repository in `owner/repo` format |
| `SpiralDBBranch` | string | `main` | Branch or tag to track |
| `SpiralDBLocalPath` | string | *(none)* | Local clone path (must be set) |
| `SpiralDBAutoFetch` | bool | `false` | Auto-fetch on boot |
| `SpiralDBDisableRemote` | bool | `false` | Never contact remote |
| `SpiralDBFetchTimeout` | int | `30` | Git operation timeout (seconds) |
| `SpiralDBRollbackOnFailure` | bool | `true` | Keep previous data on failure |

## Related Documentation

- [Architecture](./spec-architecture.md) — System overview, tech stack, external dependencies
- [API Reference](./spec-api.md) — All REST endpoints
- [Data Model](./spec-data-model.md) — SQLite schemas, verification lifecycle, file naming
- [UI Design](./spec-ui-design.md) — Visual design, layout, component patterns
