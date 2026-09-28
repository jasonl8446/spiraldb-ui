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

### GET /api/activity

The most recent verification-status changes, for the dashboard's activity feed.

**Query Parameters:**
- `limit` (optional): how many rows to return. Default `10`, ceiling `100`.

**Request:**
```http
GET /api/activity?limit=10
```

**Response:**
```json
{
  "activity": [
    {
      "id": 3,
      "object_type": "quest",
      "object_key": "DS-ACAD-C01-001",
      "old_status": "extracted",
      "new_status": "reviewed",
      "notes": "Gate-1 acceptance re-run: reviewed at the Phase 1 boundary",
      "changed_by": "Jason",
      "changed_at": "2026-09-26T06:26:25.798Z"
    }
  ],
  "unresolved": 0
}
```

One row per `status_history` row, newest first, ordered by `changed_at DESC, id DESC` — `id` is
the tiebreak because `changed_at` may repeat (two transitions inside one second, and SQLite's
`CURRENT_TIMESTAMP` is second-resolution), so "the 10 most recent" is a total order and two runs
over one database cannot disagree about it. `object_type`/`object_key` are the frontend route's
type and key ([spec-data-model.md](./spec-data-model.md) L32–37).

**The join from `status_history` to `entry_status` is a LEFT join, and an unresolvable row is
returned rather than dropped.** The endpoint answers "the N most recent `status_history` rows", so
a row whose parent entry is missing — or whose type is outside the eight in this section, or whose
key is blank — is still an element of `activity`; `object_type` and `object_key` are `null` for it
and `unresolved` counts it. An inner join would silently answer nine rows while claiming ten.
`unresolved` and the feed's "no link" rendering read the same predicate, so they cannot disagree
about a row. A history row can only become unresolvable through a writer that ignored the
`status_history.entry_status_id` foreign key (the app's own connection has `PRAGMA foreign_keys = ON`).

`notes` may be `null`, and `changed_by` is the `settings.user_name` resolved at the time of the
change — the column is nullable and may also be `""` (a change recorded before the identity gate
was answered); the feed renders either as no author.

**Errors:** a malformed `?limit=` is a `400`, never a silent clamp — `""`, `"0"`, `"abc"`, `"1.5"`,
a repeated parameter (`?limit=1&limit=2`) and a value above the ceiling all answer
`{"error": "Invalid limit \"<value>\": …"}`. This is the same ladder `?status=` follows. The route
has no `:param`, so no request reaches a `404`.

**Added by story p5-01** (plan task 5.1, endpoint decision D27): the dashboard feed's read, which
the original endpoint list did not name.

---

## Object CRUD

CRUD endpoints for each SpiralDB object type. All follow the same pattern.

### Quests

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/quests` | List all quests (from SpiralDB files) |
| GET | `/api/quests/:name` | Single quest JSON |
| POST | `/api/quests` | Save new/update quest (writes file + metadata + git commit) |

**Implemented response shapes** (task 2.5 / story p2-06). This table above is the
spec's complete contract — it fixes no shapes — so the shapes below are the
agent-chosen ones and are binding for the client from p2-07 onward. They follow
the house precedent of `GET /api/status/:type` (`{entries, summary}`) and are
served by `server/src/services/quests.ts`.

`GET /api/quests` — the browse list. One directory scan + JSON5 parse per request
(D12; 322 local files, no caching), joined with `entry_status`. Search and
status-filtering are **client-side** over this payload (p2-08).

```json
{
  "quests": [
    {
      "quest_name": "DS-ACAD1-C01-001",
      "title": "Quest for Perfection",
      "title_key": "QuestTitle_1ED8D",
      "title_source": "resolved",
      "level": 1,
      "goal_count": 7,
      "is_mainline": true,
      "modified_at": "2026-09-26T09:04:09.008Z",
      "status": "extracted"
    }
  ],
  "summary": { "total": 322, "extracted": 322, "reviewed": 0, "verified": 0 },
  "skipped": [{ "file": "QuestTemplates/broken.json", "message": "Could not parse …" }]
}
```

The values above are measured on the clone's fresh import (all 322 rows
`extracted`). `title_source: "resolved"` needs a populated `string_table`, which
only a names sync produces — against an unsynced database every present key
reports `rawKey` instead.

- `title_source` is `resolved` (string-table hit), `rawKey` (the raw
  `m_questTitle` value is shown) or `missing` (no `m_questTitle` — the title is
  `m_quest_name`). Measured on the corpus: 313 `rawKey`, 7 `missing`, 0 with a
  null `level`, 306 `is_mainline`, 11 with `goal_count` 0.
- `status` defaults to `extracted` for a quest with no `entry_status` row (the
  schema default and the first-startup import value).
- `summary` counts the rows in this response, so the filter tabs count exactly
  what the table holds; it equals `GET /api/status/quests`'s `summary` whenever
  the database is in sync with the corpus (the import and every save keep it so).
- `skipped` reports corpus files that could not be read or parsed. They never fail
  the request.

`GET /api/quests/:name` — **the parsed quest object itself**, not an envelope
(the spec's literal "Single quest JSON", and exactly what `POST` round-trips).
Resolved through the D19 content-keyed index, so an off-convention legacy filename
is found; read JSON5-tolerantly, so a legacy file with trailing commas parses.
Unknown name → `404 {"error": "Unknown quest \"…\""}`.

`POST /api/quests` — body `{ "quest": { … }, "notes": "optional commit body" }`.
The only required shape is a JSON object with a usable `m_questName`; the request
carries no enum conversion (the CLI already emits the corpus spelling, D48(a)).

```json
{
  "quest_name": "DS-ACAD1-C01-001",
  "outcome": "created",
  "action": "extract",
  "commit": "3f1c…",
  "branch": "content/2026-09-26",
  "commit_message": "spiraldb: extract quest DS-ACAD1-C01-001",
  "file": "QuestTemplates/questtemplates_DS-ACAD1-C01-001.json",
  "metadata": "QuestMetadatas/questmetadata_DS-ACAD1-C01-001.json",
  "metadata_outcome": "created",
  "status": { "object_type": "quest", "object_key": "DS-ACAD1-C01-001", "status": "extracted", "…": "…" },
  "warnings": []
}
```

- `action` is `extract` for a key that did not exist and `update` for one that
  did; `outcome` is `created`/`updated`; `commit` is this save's single commit sha
  (D13).
- No status change and no history note are recorded: the endpoint has no
  capture-file context. A new entry is inserted as `extracted`; an existing
  entry's status is left alone.
- `warnings` carries the D48(d) ambiguity report when `QuestMetadatas/` holds more
  than one file whose `Name` is this quest (8 of 316 names do). The save still
  proceeds deterministically on the first file in name order, and the same text is
  logged to the server console.
- Errors: body without a usable `quest`/`m_questName` → `400`; unset
  `settings.spiraldb_path` → `400`; dirty SpiralDB working tree (`DirtyRepoError`,
  D14) → `409` with the actionable message; any other pipeline failure → `500`.

**Added by story p3-09 — a 400 body may carry a per-field error map.** A body that
fails the shared quest schema (task 3.1) or the shared **rule** validation (task 3.9,
`shared/quest/validation.ts` — the same engine the client editor runs) answers
`{"error": "…", "fields": {"<path>": ["message", …]}}`. `fields` is keyed by the
document path the finding belongs to (`m_startGoals[1]`, `m_goals[0].m_goalName`),
with the request envelope's own `quest.` prefix stripped so the keys match the ones
the client's own validation produces; the client renders each message under the
control that owns it.

Only **blocking** findings are a 400. The general rules' **warnings** — a zone path
the `zones` table does not hold, an item/spell/NPC/quest reference no table holds,
and a goal unreachable from `m_startGoals` — never reject a save (measured: the
corpus itself carries 94 zone warnings and 5 reachability failures). The
hand-written Phase-2 checks keep the older `{"error"}`-only body.

**Added by story p2-07 (Gap B) — the request body also takes `source`.** The body
is therefore `{ "quest": { … }, "notes"?: "commit body", "source"?: "session_1.json" }`.
`source` is the capture file the quests were extracted from; the extraction page
knows it (the user picked the file), and this is the only way the endpoint can —
so it supersedes the "no history note" clause above **only when `source` is
present in the request**:

- It is sanitised before use: trimmed, reduced to its base name (every `\`/`/`
  directory component is dropped — `../../etc/passwd` is recorded as `passwd`,
  `/tmp/x/session_1.json` as `session_1.json`), control characters stripped and the
  result capped at 255 characters. An absent, `null`, blank or unsafe value means
  **no note at all** — a request without `source` behaves exactly as it did before
  the field existed (a new entry is inserted as `extracted` with a `null` note).
- When the save **creates** the `entry_status` row (`outcome: "created"`), one
  `status_history` row is written with
  `notes` = `Imported from packet capture {source}`, `old_status: null`,
  `new_status: "extracted"` and `changed_by` = the resolved `settings.user_name`.
- When the save **updates** an existing entry (`outcome: "updated"`) it adds **no**
  note and does **not** touch the status: D49(d) stands — an update carries no
  user-facing transition, so re-saving a `verified` quest keeps its history and its
  status.
- A `source` that is not a string → `400`, like a non-string `notes`.
- Response shape unchanged: `source` is not echoed.

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

## Search

### GET /api/search

Cross-type search for the ⌘K command palette: a **case-insensitive literal substring** (ASCII case
folding, `LIKE` metacharacters escaped so `?q=%` matches a percent sign rather than everything),
returned **grouped by type**.

**Query Parameters:**
- `q` (optional): the text to match, trimmed. Absent or blank is not an error — see below.
- `limit` (optional): the row cap **per group**. Default `20`, ceiling `50`.

**Request:**
```http
GET /api/search?q=DS-ACAD-C01-00&limit=20
```

**Response** (the corpus's quest drop tables are named after their quest, so one substring
legitimately matches two families):
```json
{
  "query": "DS-ACAD-C01-00",
  "limit": 20,
  "total": 10,
  "truncated": false,
  "unresolved": 0,
  "groups": [
    {
      "type": "quest",
      "label": "Quests",
      "results": [
        {
          "object_type": "quest",
          "object_key": "DS-ACAD-C01-001",
          "label": "DS-ACAD-C01-001",
          "name": "Wizard Tours",
          "source_id": null,
          "status": "reviewed",
          "matched_on": "key"
        }
        // … 4 more quests, same shape
      ]
    },
    {
      "type": "drop_table",
      "label": "Drop Tables",
      "results": [
        {
          "object_type": "drop_table",
          "object_key": "DS-ACAD-C01-001",
          "label": "DS-ACAD-C01-001",
          "name": null,
          "source_id": null,
          "status": "extracted",
          "matched_on": "key"
        }
        // … 4 more drop tables
      ]
    }
  ]
}
```

**The two arms of the search, and which of them can be linked:**

- **Object keys** — `entry_status.object_key`, across all eight types of [Verification
  Status](#verification-status). These rows carry `object_type`, `object_key` and `status`: exactly
  what the palette's status dot and its link need. The link is the existing per-type detail route in
  [URL Routes](#url-routes-frontend), not a second mapping.
- **Friendly names** — `items.name`, `spells.name`, `npcs.name`, and `quests.title` joined to its own
  route key. The first three have **no detail route in this application**, so a hit there is
  **informational and not navigable**: `object_type`, `object_key` and `status` are `null`, the row
  carries `source_id` (the friendly table's own primary key — a name is not unique, so the name
  alone cannot identify a row), and it is counted in `unresolved`. A quest title hit **is**
  navigable, because `quests.quest_name` is the `entry_status.object_key` the quest detail route
  already takes; it comes back as a normal quest row with `matched_on: "name"`.

`zones` and `drop_tables` are deliberately not searched by name: `drop_tables.name` repeats the
`drop_table` object key verbatim, so a name arm over it could only duplicate the key arm.

`label` is the row's primary text — the object key for a navigable row, the friendly name for an
informational one — and `name` is whichever friendly name is known for the row (a quest matched on
its key still reports its title, or `null` when the `quests` table has none). `matched_on` is
`"key"` or `"name"` and says which column matched.

**`limit` is a per-group cap, not a response-wide one.** No group carries more than `limit`
results; `total` is what the response actually carries (the sum over `groups`); and `truncated` is
`true` when at least one group matched more rows than the cap allowed — detected by reading each
group with `limit + 1` rows, so an overflow is observed rather than assumed. A single shared cap
would let the first group consume every row and hide a type that matched, which is exactly the case
this endpoint's criterion names. The informational arm makes the two counters visible:

```http
GET /api/search?q=necklace&limit=2
```
```json
{
  "query": "necklace",
  "limit": 2,
  "total": 2,
  "truncated": true,
  "unresolved": 2,
  "groups": [
    {
      "type": "item",
      "label": "Items",
      "results": [
        {
          "object_type": null,
          "object_key": null,
          "label": "Necklace of Eerem Palace",
          "name": "Necklace of Eerem Palace",
          "source_id": "1405388",
          "status": null,
          "matched_on": "name"
        },
        {
          "object_type": null,
          "object_key": null,
          "label": "Necklace of Lost Ancestors",
          "name": "Necklace of Lost Ancestors",
          "source_id": "730193",
          "status": null,
          "matched_on": "name"
        }
      ]
    }
  ]
}
```

**Ordering** is by match rank — exact match, then prefix, then substring, over the matched column
(case-folded) — and then by the row's own identity ascending: `object_key` for an object group
(unique within a type, so the order is total) and `name, id` for a name group (a name is not
unique). `limit` in the response echoes the cap that was applied, so a client never has to guess it.

**Groups** appear in this order — `quest`, the seven generic families in the order
[Verification Status](#verification-status) uses, then `item`, `spell`, `npc` — and only groups that
matched appear at all.

**A blank `q` is a `200` with an empty envelope and no database work.** It is the state the palette
is in the moment it opens, so it is not an error:

```http
GET /api/search?q=
```
```json
{ "query": "", "limit": 20, "total": 0, "truncated": false, "unresolved": 0, "groups": [] }
```

`query` echoes the **trimmed** string that was actually matched (`?q=%20acad%20` searches and
reports `acad`).

**Errors:** a repeated `?q=a&q=b` is a `400` (`Query parameter "q" must be a single string value`),
and a malformed `?limit=` is a `400` by the same ladder as `GET /api/activity`
(`Invalid limit "<value>": …`), never a silent clamp. The route has no `:param`, so no request
reaches a `404`.

**Added by story p5-02** (plan task 5.2, endpoint decision D27): the ⌘K palette's read, which the
original endpoint list did not name.

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
