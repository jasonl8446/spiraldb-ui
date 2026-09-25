# SpiralDB UI — API Reference

Complete REST API reference for the Express backend. All endpoints are prefixed with `/api` and proxied from the Vite dev server during development.

## Names

Friendly name lookups for dropdown components.

### GET /api/names/:type

List all names for a given object type.

**Types:** `items`, `spells`, `npcs`, `quests`, `zones`, `drop_tables`, `strings`

**Request:**
```http
GET /api/names/items
GET /api/names/spells
GET /api/names/npcs
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

Single name lookup by ID.

**Request:**
```http
GET /api/names/items/4808
```

**Response:**
```json
{ "gid": 4808, "name": "Twice Stitched Boots" }
```

---

## Verification Status

Track verification progress for all SpiralDB object types. See [Data Model](./spec-data-model.md) for schema details.

### GET /api/status/:type

List all entries of a type with their status. Supports filtering.

**Types:** `quests`, `drop_tables`, `npc_inventories`, `npc_spell_inventories`, `creature_spellbooks`, `npc_drop_tables`, `treasure_card_inventories`, `zone_transfers`, `all`

**Query Parameters:**
- `status` (optional): Filter by `extracted`, `reviewed`, or `verified`

**Request:**
```http
GET /api/status/quests?status=extracted
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

### PATCH /api/status/:type/:key

Update an entry's verification status.

**Request:**
```http
PATCH /api/status/quests/DS-ACAD1-C01-001
Content-Type: application/json

{
  "status": "verified",
  "notes": "Tested on Imlight r806919. Goal 3 waypoint triggers correctly.",
  "changed_by": "jason"
}
```

### GET /api/status/:type/:key/history

Get full status change history for an entry.

**Request:**
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
      "notes": "Imported from packet capture session_2026-06-01.json",
      "changed_by": "quest_builder",
      "changed_at": "2026-06-01T22:28:54Z"
    },
    {
      "old_status": "extracted",
      "new_status": "reviewed",
      "notes": "Goal logic chain looks correct.",
      "changed_by": "jason",
      "changed_at": "2026-09-20T14:30:00Z"
    },
    {
      "old_status": "reviewed",
      "new_status": "verified",
      "notes": "Tested on Imlight r806919. All 7 goals complete in order.",
      "changed_by": "jason",
      "changed_at": "2026-09-22T10:15:00Z"
    }
  ]
}
```

### GET /api/dashboard

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

---

## Object CRUD

CRUD endpoints for each SpiralDB object type. All follow the same pattern.

### Quests

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/quests` | List all quests (from SpiralDB files) |
| GET | `/api/quests/:name` | Single quest JSON |
| POST | `/api/quests` | Save new/update quest (writes file + metadata + git commit) |

### Other Object Types

Same pattern for each type:

| Type | Base Path |
|------|-----------|
| DropTable | `/api/drop-tables` |
| NpcInventory | `/api/npc-inventories` |
| NpcSpellInventory | `/api/npc-spell-inventories` |
| CreatureSpellbook | `/api/creature-spellbooks` |
| NpcDropTable | `/api/npc-drop-tables` |
| TreasureCardInventory | `/api/treasure-card-inventories` |
| ZoneTransfer | `/api/zone-transfers` |
| GlobalRegistry | `/api/global-registry` |

Each supports:
- `GET /` — List all entries
- `GET /:key` — Single entry JSON
- `POST /` — Save new/update (writes file + git commit)

Save operations automatically:
1. Write the JSON file to the correct SpiralDB subdirectory
2. Generate companion metadata (quests only)
3. Git auto-commit with message: `spiraldb: {action} {object_type} {object_key}`
4. Set/update entry status in local SQLite

---

## Extraction

### POST /api/extract/quests

Upload a packet capture JSON file and extract quests.

**Request:** `multipart/form-data` with field `file` containing the `.json` packet capture.

**Response:**
```json
{
  "quests": [ ... ],  // Array of QuestTemplate objects
  "count": 14
}
```

**Error Response:**
```json
{
  "error": "Failed to parse packet capture: invalid file format"
}
```

The extraction is performed by calling the `imview-packet-reader` CLI wrapper as a blocking subprocess. The UI shows an indeterminate spinner during processing. See [Domain Reference](./spec-domain-reference.md#cli-wrapper-for-packet-reader) for CLI details.

---

## Sync

### POST /api/sync

Trigger a friendly name sync from Aurorium WAD files.

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

### GET /api/sync/history

Get sync history.

**Response:**
```json
{
  "history": [
    {
      "sync_timestamp": "2026-09-25T15:30:00Z",
      "revision": "V_r806919.Wizard_1_610",
      "items_count": 15234,
      "spells_count": 8456,
      "npcs_count": 3210,
      "status": "success"
    }
  ]
}
```

---

## Settings

### GET /api/settings

Get all settings.

**Response:**
```json
{
  "aurorium_path": "/home/jason/Documents/git-projects/Aurorium",
  "imcodec_path": "/run/current-system/sw/bin/imcodec",
  "user_name": "jason",
  "spiraldb_path": "/home/jason/Documents/git-projects/spiraldb",
  "git_branch": "content/2026-09-25"
}
```

### PUT /api/settings

Update settings.

**Request:**
```http
PUT /api/settings
Content-Type: application/json

{
  "aurorium_path": "/home/jason/Documents/git-projects/Aurorium",
  "user_name": "jason"
}
```

---

## URL Routes (Frontend)

React Router v6 with `<BrowserRouter>`. Layout component wraps all routes with sidebar + header.

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

## Related Documentation

- [Architecture](./spec-architecture.md) — System overview, tech stack, data flow
- [Data Model](./spec-data-model.md) — SQLite schemas, verification lifecycle, file naming
- [Domain Reference](./spec-domain-reference.md) — SpiralDB JSON schemas, type enumerations
- [UI Design](./spec-ui-design.md) — Visual design, layout, component patterns
