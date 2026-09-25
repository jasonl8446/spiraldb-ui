# SpiralDB JSON Reference

SpiralDB is the static world data store for Imlight. It lives in a separate Git repository
(default: `Revive101/spiraldb`) and is loaded into memory at server boot. Each JSON file maps
to one entry in a named collection. This document describes every configuration option, the
expected directory layout, and the JSON schema for each data type.

## Configuration (Imlight.ini)

All settings live under the `[Database]` section of `Config/Imlight.ini`.

| Key | Type | Default | Description |
|---|---|---|---|
| `SpiralDBRemote` | string | `Revive101/spiraldb` | GitHub repository in `owner/repo` format. Used to build the clone URL `https://github.com/{value}.git`. |
| `SpiralDBBranch` | string | `main` | Branch or tag to track. Shallow-cloned with `--single-branch`. |
| `SpiralDBLocalPath` | string | *(none)* | Absolute or relative path where the repository is cloned/cached. Must be set. |
| `SpiralDBAutoFetch` | bool | `false` | When `true`, runs `git fetch` + `reset --hard` on every boot to pull latest data. When `false`, uses whatever is already on disk. |
| `SpiralDBDisableRemote` | bool | `false` | When `true`, the remote is never contacted. Only local data at `SpiralDBLocalPath` is used. Useful for offline development. |
| `SpiralDBFetchTimeout` | int | `30` | Maximum seconds to wait for any git operation (clone or fetch). The process is killed on expiry. |
| `SpiralDBRollbackOnFailure` | bool | `true` | When `true`, a failed fetch or parse keeps the previous in-memory data intact. When `false`, all collections are cleared on failure. |

### Boot behavior summary

1. If `SpiralDBDisableRemote` is `false`, attempt to clone or fetch the repository.
2. If the sync fails and `SpiralDBRollbackOnFailure` is `true` and local data exists, log a warning and continue with existing data.
3. If the sync fails and no local data exists, SpiralDB loads empty.
4. All `*.json` files under each subdirectory are deserialized. Individual file parse failures are logged as warnings and skipped; they do not prevent other files from loading.
5. Data is built into temporary containers and atomically swapped in only after all files are parsed successfully.

## Directory Layout

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

Each directory is optional. Missing directories are silently skipped.

## JSON Schemas

### CreatureSpellbook

**Directory:** `CreatureSpellbook/`
**Keyed by:** `DeckName` (case-insensitive string lookup)

Defines the spell deck available to a creature in combat.

```json
{
  "DeckName": "Mdeck-L-BR-DS-SylviaDrake-A-50",
  "SpellTemplateIds": [
    409737272,
    1321504283,
    603728324
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `DeckName` | string | yes | Unique identifier for this spellbook. Referenced by creature templates. |
| `SpellTemplateIds` | uint[] | yes | Array of spell template IDs that make up this deck. |

---

### DropTable

**Directory:** `DropTables/`
**Keyed by:** `Name` (case-insensitive string lookup)

Defines a loot table that can be rolled after combat or as a quest reward.

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
      "Requirements": {
        "m_requirements": [
          {
            "$type": "Imcodec.ObjectProperty.TypeCache.ReqSchoolOfFocus, Imcodec.ObjectProperty",
            "m_magicSchool": "Balance",
            "m_applyNOT": false,
            "m_operator": "ROP_AND"
          }
        ],
        "m_applyNOT": false,
        "m_operator": "ROP_AND"
      }
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
| `Id` | string | `""` | Optional identifier (informational; not used as a lookup key). |
| `Name` | string | `""` | Unique name for this drop table. Referenced by `NpcDropTable` and `ResDropTable` quest results. |
| `Description` | string | `""` | Human-readable description (informational only). |
| `RollChance` | double | `1.0` | Probability (0.0 to 1.0) that this table is rolled at all. |
| `Weight` | int | `100` | Relative weight when multiple tables compete. |
| `NoneChance` | double | `0.0` | Probability that the roll produces nothing. |
| `PityCounter` | double | `0.0` | Pity system counter for guaranteed drops after repeated misses. |
| `MinGold` | int | `0` | Minimum gold awarded (inclusive). |
| `MaxGold` | int | `0` | Maximum gold awarded (inclusive). A random value in `[MinGold, MaxGold]` is chosen. |
| `ExperienceAmount` | int | `0` | Experience points granted. |
| `TrainingPoints` | int | `0` | Training points granted. |
| `GrantsPotionSlot` | bool | `false` | Whether this roll grants a potion slot. |
| `Items` | DropItem[] | `[]` | List of possible item drops. |
| `CreatedAt` | DateTime | now | ISO 8601 timestamp of creation. |
| `ModifiedAt` | DateTime | now | ISO 8601 timestamp of last modification. |
| `CreatedBy` | string | system user | Author who created this entry. |
| `ModifiedBy` | string | system user | Author who last modified this entry. |

#### DropItem

| Field | Type | Default | Description |
|---|---|---|---|
| `ItemId` | string | `""` | Numeric item template ID as a string. |
| `ItemName` | string | `""` | Human-readable item name (informational). |
| `Notes` | string | `""` | Free-form notes (e.g. school affiliation). |
| `Requirements` | RequirementList? | `null` | Optional requirement gate. When present, the item only drops if the player meets these requirements. Uses the standard `$type`-tagged polymorphic format (see Requirements below). |

---

### GlobalRegistry

**Directory:** `GlobalRegistry/`
**Keyed by:** dictionary key (merged across all files)

Server-wide float values used for feature flags, event toggles, and localization versioning. Multiple files are merged into a single dictionary.

```json
{
  "GlobalRegistryValues": {
    "Localization": 1,
    "Christmas": 0,
    "Halloween": 0,
    "WizardDay": 0,
    "Easter": 0,
    "StPatricks": 0,
    "Vallentines": 0,
    "Thanksgiving": 0,
    "Revamp01": 0,
    "Revamp02": 0,
    "LoyaltyProgram": 0
  }
}
```

| Field | Type | Description |
|---|---|---|
| `GlobalRegistryValues` | Dictionary\<string, float\> | Map of registry key to float value. Keys are case-sensitive. Values from later-loaded files overwrite earlier ones. |

---

### NPCInventory

**Directory:** `NpcInventory/`
**Keyed by:** `TemplateID` (ulong)

Defines the items an NPC vendor has for sale.

```json
{
  "TemplateID": 87112,
  "Inventory": [
    126913,
    126914,
    126915,
    77614,
    87237,
    4873
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `TemplateID` | ulong | yes | The NPC actor template ID this inventory belongs to. |
| `Inventory` | GID[] | yes | Array of item GIDs (global IDs) available from this vendor. These are numeric item identifiers. |

---

### NPCSpellInventory

**Directory:** `NpcSpellInventory/`
**Keyed by:** `TemplateID` (ulong)

Defines the spells an NPC spell trainer offers, including level gating and prerequisite chains.

```json
{
  "TemplateID": 1452231,
  "Spells": [
    {
      "TemplateID": 84361,
      "RequiredSpellID": 0,
      "Level": 1
    },
    {
      "TemplateID": 2106466410,
      "RequiredSpellID": 84361,
      "Level": 5
    },
    {
      "TemplateID": 337707760,
      "RequiredSpellID": 2106466410,
      "Level": 8
    }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `TemplateID` | ulong | yes | The NPC actor template ID this spell inventory belongs to. |
| `Spells` | NPCSpellEntry[] | yes | List of spell entries offered by this trainer. |

#### NPCSpellEntry

| Field | Type | Required | Description |
|---|---|---|---|
| `TemplateID` | ulong | yes | Spell template ID being offered. |
| `RequiredSpellID` | ulong | yes | Spell that must be learned first. `0` means no prerequisite. |
| `Level` | int | yes | Minimum wizard level required to learn this spell. |

---

### NpcDropTable

**Directory:** `NpcDropTable/`
**Keyed by:** `TemplateID` (ulong)

Maps an NPC to the named drop tables it rolls after a combat win.

```json
{
  "TemplateID": 12345,
  "DropTableNames": [
    "WC-UNICORN-MAIN-007",
    "WC-UNICORN-BONUS-001"
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `TemplateID` | ulong | yes | The NPC actor template ID. |
| `DropTableNames` | string[] | yes | Names of `DropTable` entries to roll. Resolved at roll time through the loaded drop table collection. |

---

### TreasureCardInventory

**Directory:** `TreasureCardInventory/`
**Keyed by:** `TemplateID` (ulong)

Defines the treasure cards an NPC vendor sells, with optional per-card pricing.

```json
{
  "TemplateID": 38214,
  "TreasureCards": [
    { "SpellName": "Fire Shield TC", "Price": 100 },
    { "SpellName": "Fire Cat TC", "Price": 150 },
    { "SpellName": "Seraph TC", "Price": 250 }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `TemplateID` | ulong | yes | The NPC actor template ID. |
| `TreasureCards` | TreasureCardEntry[] | yes | List of treasure cards for sale. |

#### TreasureCardEntry

| Field | Type | Required | Description |
|---|---|---|---|
| `SpellName` | string | yes | Spell name of the treasure card. Must match the `m_name` field of a `SpellTemplate` in the WAD. |
| `Price` | int | yes | Gold price to buy this card. When `0`, falls back to the spell template's `m_baseCost`. |

---

### QuestTemplate

**Directory:** `QuestTemplates/`
**Keyed by:** `m_questName` (case-insensitive string lookup)

Full quest definitions including goals, requirements, dialog, rewards, and goal progression logic. This is a complex polymorphic type serialized from the Imcodec type cache with `$type` annotations.

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
  "m_endResults": {
    "m_results": [
      {
        "$type": "Imcodec.ObjectProperty.TypeCache.ResDropTable, Imcodec.ObjectProperty",
        "m_tableName": "DS-ACAD-C01-001",
        "m_maxRolls": 1
      }
    ]
  },
  "m_requirements": { ... },
  "m_goalLogic": [ ... ],
  "m_questLevel": 1,
  "m_questRepeat": 0,
  "m_isHidden": false,
  "m_mainline": true,
  "m_activityType": "ACTIVITY_NotActivity"
}
```

#### Top-level fields

| Field | Type | Description |
|---|---|---|
| `m_questName` | string | Unique quest identifier. Used for lookups and cross-references. |
| `m_questNameID` | uint | Hashed quest name ID (can be `0`; computed at runtime if needed). |
| `m_questTitle` | string | String table key for the quest title shown to players. |
| `m_questInfo` | string? | String table key for quest info text. |
| `m_questPrep` | string? | String table key for pre-acceptance description. |
| `m_questUnderway` | string? | String table key for in-progress description. |
| `m_questComplete` | string? | String table key for completion text. |
| `m_startGoals` | string[] | Goal names activated when the quest is accepted. |
| `m_goals` | GoalTemplate[] | Polymorphic array of goal definitions. Each entry uses `$type` to distinguish `WaypointGoalTemplate`, `PersonaGoalTemplate`, etc. |
| `m_startResults` | ResultList | Results applied when the quest is accepted. |
| `m_endResults` | ResultList | Results applied when the quest is completed (e.g. `ResDropTable`, `ResModifyEntry`). |
| `m_requirements` | RequirementList? | Requirements to accept the quest (e.g. `ReqHasQuest`). |
| `m_prepRequirements` | RequirementList? | Requirements to see the quest offer. |
| `m_pruneRequirements` | RequirementList? | Requirements that remove the quest. |
| `m_goalLogic` | GoalLogicEntry[] | Defines how completing one goal unlocks the next. |
| `m_questLevel` | int | Suggested level for this quest. |
| `m_questRepeat` | int | Repeatability flag (`0` = not repeatable). |
| `m_onStartQuestScript` | string | Script to run on quest start. |
| `m_onEndQuestScript` | string | Script to run on quest end. |
| `m_dialogList` | ActorDialogList? | Dialog tree for the quest giver. |
| `m_isHidden` | bool | Whether the quest is hidden from the quest log. |
| `m_mainline` | bool | Whether this is a mainline story quest. |
| `m_noQuestHelper` | bool | Disables the quest helper arrow. |
| `m_clientTags` | string[]? | Tags sent to the client for UI filtering. |
| `m_activityType` | string | Activity classification (e.g. `ACTIVITY_NotActivity`). |
| `m_prepAlways` | bool | When `true`, always show the prep dialog regardless of requirements. |
| `m_forceInteraction` | bool | Forces interaction prompt. |
| `m_checkInventoryForCrafting` | bool | Checks inventory for crafting goals. |
| `m_playAsYourPetNPC` | bool | Pet-play mode flag. |
| `m_missionDoors` | object? | Mission door configuration (instance dungeon entry). |
| `m_dynaMods` | object? | Dynamic modifier configuration applied by this quest. |
| `m_outdated` | bool | Marks the quest as outdated/deprecated. |
| `m_defaultDialogAnimation` | object? | Default animation played during quest dialogs. |
| `m_skipQHAutoSelect` | bool | Skips automatic quest helper selection. |
| `m_questEffectInfoList` | object? | Visual/audio effects associated with the quest. |
| `m_behaviors` | object? | Optional server-side behaviors. |

#### Goal types (polymorphic via `$type`)

Goals use the Imcodec type system. The `$type` field determines which subclass is deserialized. The following goal types appear in the data:

| Goal Type | Purpose | Type-specific Fields |
|---|---|---|
| `WaypointGoalTemplate` | Navigate to a location or trigger zone entry | `m_zoneEntry`, `m_zoneTag`, `m_proximityTag`, `m_zoneExit` |
| `PersonaGoalTemplate` | Talk to an NPC, includes dialog trees | `m_personaName`, `m_usePatron`, `m_dialogList` |
| `BountyGoalTemplate` | Kill a number of specific mobs | `m_npcAdjectives` (string[]), `m_bountyTotal` (int), `m_bountyType` (e.g. `BT_MOB_KILL`), `m_tallyCounter` |
| `ScavengeGoalTemplate` | Collect/scavenge specific items from the world | `m_itemAdjectives` (string[]), `m_itemTotal` (int), `m_tallyCounter` |
| `AchieveRankGoalTemplate` | Reach a specific rank/level milestone | `m_rank` (int) |

All goals share these base fields: `m_goalName`, `m_goalNameID`, `m_goalTitle`, `m_goalUnderway`, `m_hyperlink`, `m_completeText`, `m_completeResults`, `m_goalRequirements`, `m_tallyCounter`, `m_locationName`, `m_displayImage1`, `m_displayImage2`, `m_clientTags`, `m_genericEvents`, `m_autoQualify`, `m_autoComplete`, `m_destinationZone`, `m_dialogList`, `m_goalType`, `m_noQuestHelper`, `m_petOnlyQuest`, `m_activateResults`, `m_hideGoalFloatyText`, `m_behaviors`.

#### GoalLogicEntry

Controls quest progression by defining which goals unlock which subsequent goals.

| Field | Type | Description |
|---|---|---|
| `m_goalsAND` | string[] | Goal names that must ALL be complete. |
| `m_goalsOR` | string[] | Goal names where ANY completion counts. |
| `m_goalsToAdd` | string[] | Goal names to activate when conditions are met. |
| `m_completeQuest` | bool | When `true`, completing this logic entry finishes the quest. |
| `m_requiredORCount` | int | Number of OR goals that must be completed. |

---

### WizardZoneData (ZoneTransfer)

**Directory:** `ZoneTransfer/`
**Keyed by:** `ZoneName` (case-insensitive string lookup)

Defines teleport triggers within a zone, mapping trigger names to destination coordinates and zones.

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
| `ZoneName` | string | yes | Full zone path (e.g. `WizardCity/WC_Hub`). Used as the lookup key. |
| `Teleports` | WizardTeleportData[] | yes | List of teleport trigger definitions for this zone. |
| `Events` | array | no | Present in some data files but not loaded by the server. Reserved for future use or tooling. |

#### WizardTeleportData

| Field | Type | Description |
|---|---|---|
| `TriggerName` | string | Name of the trigger object in the zone file. |
| `Teleport` | ResTeleport | Teleport destination data. |

#### ResTeleport

| Field | Type | Description |
|---|---|---|
| `m_destinationLoc` | string | Comma-separated `x,y,z,facing` coordinates at the destination. |
| `m_destinationZone` | string | Full zone path of the destination. |
| `m_exitTeleporter` | int | Exit teleporter index. |
| `m_teleporterTag` | int | Teleporter tag identifier. |
| `m_teleportType` | string | Teleport type enum (e.g. `TELEPORT_STATIC`). |
| `m_transitionID` | int | Transition animation/effect ID. |

---

## Requirements Format

Requirements appear in drop items, quests, and goals. They use a polymorphic JSON format with `$type` annotations for deserialization.

A requirement list has this structure:

```json
{
  "m_applyNOT": false,
  "m_operator": "ROP_AND",
  "m_requirements": [
    {
      "$type": "Imcodec.ObjectProperty.TypeCache.ReqSchoolOfFocus, Imcodec.ObjectProperty",
      "m_magicSchool": "Fire",
      "m_applyNOT": false,
      "m_operator": "ROP_AND"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `m_applyNOT` | bool | Inverts the result of this requirement/list. |
| `m_operator` | string | Logical operator: `ROP_AND` or `ROP_OR`. |
| `m_requirements` | array | Nested requirements (recursive structure). |

Common requirement types (identified by `$type`):

| Type | Key Fields | Purpose |
|---|---|---|
| `ReqSchoolOfFocus` | `m_magicSchool` | Player must be a specific school |
| `ReqHasQuest` | `m_questName` | Player must have an active quest |
| `ReqHasGoal` | `m_questName`, goal name | Player must have a specific goal |
| `ReqHasEntry` | `m_questName`, entry name | Player must have a quest registry entry |
| `ReqEntryValue` | `m_questName`, entry name, value | Quest registry entry must match a value |

---

## JSON Serialization Notes

- **TypeNameHandling.Auto**: Polymorphic types include a `$type` field with the fully qualified .NET type name. This is required for goals, requirements, results, and dialog entries.
- **NullValueHandling.Ignore**: Null fields are omitted from serialized JSON. You can omit optional fields entirely.
- **Case sensitivity**: Collection keys (`DeckName`, `Name`, `ZoneName`, `m_questName`) are stored in case-insensitive dictionaries. NPC keyed collections (`TemplateID`) use exact ulong matching.
- **File naming**: No specific naming convention is enforced. All `*.json` files in each subdirectory are loaded. Descriptive names help with maintenance.

## Adding New Content

1. Create a new `.json` file in the appropriate subdirectory of the spiraldb repository.
2. Follow the schema above for the data type you are adding.
3. Commit and push to the tracked branch.
4. On next server boot (with `SpiralDBAutoFetch = true`), the new data is pulled and loaded automatically. For manual updates, either set `SpiralDBAutoFetch = true` or run `git pull` in the local path directory before starting the server.
