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

**List extensions (implemented by p1-07; widened by P6-16 / story p6-05).** A bare URL is
byte-identical to the shape above. Two optional query parameters sit on top of it and change neither
the envelope nor the single-lookup body:

- `?q=<substring>` — case-insensitive substring filter (ASCII case folding, `LIKE` metacharacters
  escaped) over the type's **search columns**.
- `?limit=<n>` — row cap. Malformed `q`/`limit` → `400`; a value that cannot be valid for the type
  → `404`, by the same ladder as the single lookup.

**Phase 6 widens `searchColumns` from the label column to the id column as well** (D105/P6-16:
"every search matches either the friendly or the technical value"). Typing `12` therefore finds the
item whose `gid` is 12 *and* an item named "12…":

| type | id column | label column | search columns after Phase 6 |
|---|---|---|---|
| `items` | `gid` | `name` | `gid`, `name` |
| `spells` | `template_id` | `name` | `template_id`, `name` |
| `npcs` | `template_id` | `name` | `template_id`, `name` |
| `quests` | `quest_name` | `title` | `quest_name`, `title` |
| `zones` | `zone_path` | `display_name` | `zone_path`, `display_name` |
| `drop_tables` | `name` | `name` | `name` (the id *is* the label — no new column to add) |
| `strings` | `key` | `value` | `key`, `value` (already widened in Phase 1) |

**The seven types stay seven** (P6-17/G7). `tests/unit/names.test.ts` re-types them from the
`**Types:**` line above and builds the unknown-type `404` message from them, so Phase 6 adds no
eighth type here. An NPC's identity is **dual** (a template id *and* a persona name) while a
name-list row is single-id, so NPCs are served by the aggregate view in
[NPC View](#npc-view-phase-6--d112), not by an extra row type.

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
| POST | `/api/quests/scaffold` | Create the minimal skeleton for a catalog quest (Phase 6, P6-5/P6-6) |
| GET | `/api/quests/coverage` | Catalog coverage, both denominators (Phase 6, D110) |
| GET | `/api/quests/catalog` | Catalog worklist; `?missing_only=1` narrows to `has_definition = 0` (Phase 6, task 6.10) |
| GET | `/api/quests/:name/evidence` | Per-quest evidence (Phase 6, P6-8/P6-10) |
| GET | `/api/quest-ids/:id/evidence` | Evidence for the id tier (Phase 6, P6-3) |
| GET | `/api/quests/:name/suggestions` | A named quest's suggestions (Phase 7, D129; see [Suggestions and Drafts](#suggestions-and-drafts-phase-7--d129-d130-d137)) |
| GET | `/api/quest-ids/:id/suggestions` | An unnamed-tier id's suggestions (Phase 7, D130/D137) |

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
  D14) → `409` with the actionable message; `settings.git_branch` naming a branch the working tree is not
  on (`BranchMismatchError`, D119 as extended by task 7.14) → `409`, refused before anything is written or
  checked out; any other pipeline failure → `500`. **This last refusal applies to every route that writes a
  SpiralDB file and commits** (`POST /api/quests`, `POST /api/quests/scaffold` and the eight object families'
  `POST /`), because it sits in the save pipeline they all pass through; a tree on `main` is exempt **only when
  the named branch does not exist yet** (D195), since a session branch created from `main` strands nothing,
  while checking out an existing branch would replace main's tree with that branch's. A blank `git_branch`
  follows the checked-out branch, as the scaffold CLI does (D195), except on `main`, where `content/{today}` is
  still cut from `main`. A quest name or object key the naming convention refuses (a path separator, a NUL or
  any other control character, a `.json` suffix; `NamingError`, D195) → `400`, before anything is written.
  Routes that write only SQLite (`/api/sync`, `/api/settings`, `PATCH /api/status/…`, the drafts and
  suggestions routes, `/api/extract/quests`) are exempt.

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

**Added by Phase 6 (P6-5/P6-6, task 6.8): `POST /api/quests/scaffold`.** Creates the
`QuestTemplates/<name>.json` file for a **catalog row with `has_definition = 0`** through the
same save pipeline every other save uses — template + companion metadata + one commit, status
`extracted` — and returns the document it wrote, which is what the Catalog view's **Create
quest** action opens the editor on. There is **no draft lifecycle**: the file is real from the
moment it is written (D100), and it is a **minimal skeleton into which nothing inferred is ever
written** (D101).

Request: `{ "quest_name": "LM-NIGHT-MAIN-009", "notes": "optional commit body" }`.

```json
{
  "quest_name": "LM-NIGHT-MAIN-009",
  "link_kind": "inferred",
  "title_key": null,
  "has_definition_before": 0,
  "outcome": "created",
  "action": "create",
  "file": "QuestTemplates/questtemplates_LM-NIGHT-MAIN-009.json",
  "metadata": "QuestMetadatas/questmetadata_LM-NIGHT-MAIN-009.json",
  "commit": "daa4e7cca209e4fd2d5584ebc8d502008572f482",
  "branch": "content/2026-09-27",
  "commit_message": "spiraldb: create quest LM-NIGHT-MAIN-009",
  "quest": { "m_questName": "LM-NIGHT-MAIN-009", "…": "the 36 keys, corpus order" }
}
```

- The document is the **36 keys in the corpus's own order** (`shared/quest/scaffold.ts` is the
  single home of that order; it is *not* the schema's declaration order), the name, the linked
  title **only for a direct link**, `m_questNameID: 0` (the corpus's value in 322 of 322 files —
  the id lives in the `m_questTitle` key), and empty goals/results/dialog.
- `title_key` is non-null only when the link is `direct` **and** the catalog could resolve one
  `QuestTitle_*` key (`quest_ids.title_key`, else a unique reverse lookup of `quests.title`).
  When two keys share the title text the field is `null`: the scaffold never guesses identity,
  and it never writes inferred material.
- `has_definition_before` is the column **as read before the write**. The column belongs to the
  sync and flips to 1 on its next run, because the file now exists; the editor is opened from
  `quest`, never from a column this call would have to guess.
- The companion metadata's `Description` records the provenance
  ([data model](./spec-data-model.md#metadata-files)).
- **Status codes**: `404` when the catalog holds no such name, `409` when the quest already has a
  file (scaffolding over an authored quest would blank every field it does not carry, D45(1)),
  `400` for a body without a usable `quest_name` or a name that would write outside
  `QuestTemplates/`, `409` for a dirty SpiralDB tree (D14), `500` for any other pipeline failure.

**Added by Phase 6 (P6-15/D110): `GET /api/quests/coverage`.** Serves the `coverage` view
([data model](./spec-data-model.md)) so the Quests-page header and the Catalog view read **one
definition** instead of recomputing one. The route is registered **before** `/api/quests/:name`,
which would otherwise capture `coverage` as a quest name.

```json
{
  "nameable": 1717,          // count(*) on quests — NOT the 1,447 world-named sub-count; read it, never hard-code it
  "id_space": 4823,           // count(*) on quest_ids
  "defined": 322,             // has_definition = 1 (322 on the D17 clone, 328 on the owner fork)
  "missing": 1395,            // has_definition = 0 — the catalog worklist
  "references": 2855,         // count(*) on quest_catalog_refs: referencing OBJECTS, not D97's referencing FILES (1,177)
  "corpus": { "spiraldb_path": "/…/data/test-spiraldb", "quest_files": 322 }
}
```

- `nameable` (the catalog tier) and `id_space` (the id tier) are the **two honest denominators**
  (D97/D98); `defined` is `count(*)` of `quests` rows with `has_definition = 1`; `missing` is `has_definition = 0`; `references` is `count(*)` on `quest_catalog_refs` — referencing **objects**, where D97's 1,177 counts referencing **files**, and the two must never be conflated. The headline reads
  "*defined* defined of *nameable* nameable of *id_space* quests the client holds text for" — never a
  hard-coded 1,447.
- **The response names its corpus.** `defined` reads **322** against the D17 clone and **328** against
  the owner's fork, so `corpus` echoes the resolved `settings.spiraldb_path` and the quest-file count
  it just measured. Neither number may be quoted for the other (D80(c) keeps the clone frozen).

**Added by story p6-11 (plan task 6.10): `GET /api/quests/catalog` — the worklist the Catalog view
reads.** The view's rows are not in the coverage payload, so the read is named here (and its shape
recorded, under the same "the table fixes no shapes" rule as every other quest endpoint) instead of
living implicitly in the client. It is registered **before** `/api/quests/:name`, for the same reason as
`coverage` — and the same consequence the frontend table already accepts: a quest literally named
`catalog` is unreachable by its detail route (L1026-1030).

```json
{
  "quests": [
    { "quest_name": "DM-GRAVE-MAIN-008", "title": "Stakes and Stones",
      "title_source": "direct", "has_definition": 0, "reference_count": 19 }
  ],
  "total": 1395,
  "missing_only": true,
  "corpus": { "spiraldb_path": "/…/data/test-spiraldb", "quest_files": 322 }
}
```

- **The missing-only filter is this request's `?missing_only=`**, applied in SQL (`has_definition = 0`).
  `1`/`true` turns it on, `0`/`false`/absent leaves it off, and anything else is a **`400`** — a
  malformed query parameter is refused rather than clamped (the same ladder as `?limit=`). The client
  never re-derives "missing" from the coverage numbers: the filtered `total` **equals** the view's
  `missing`, reached two ways.
- Rows are ordered `reference_count DESC, quest_name ASC` — most-gated first, the order the Catalog
  view's ASCII draws — so a re-read cannot reorder the worklist.
- `has_definition` is `0 | 1`; the row's action follows it (evidence link when 1, scaffold when 0).

**Added by Phase 6 (P6-8/P6-10/D105): the evidence endpoints.** `GET /api/quests/:name/evidence` and
`GET /api/quest-ids/:id/evidence` return **one shape**, resolved as a live join over the indexed
tables — there is **no materialised evidence table**:

```json
{
  "quest": {
    "quest_name": "WC-CYCLOPS-MAIN-002",
    "quest_id": 126861,
    "has_definition": true,
    "link_kind": "direct",
    "title": "…",
    "title_source": "direct"
  },
  "text_rows": [
    {
      "key": "WizQst126861_Goal1Text",
      "value": "…",
      "category": "WizQst126861",
      "used_by_this_file": true,
      "field": "m_goals[0].m_goalText"
    }
  ],
  "goal_gates": [
    {
      "goal_name": "DM-HOWL-MAIN-001_Complete",
      "required_status": "Completed",
      "refs": [{ "wad": "…", "entry": "…", "class": "ReqHasQuest" }]
    }
  ],
  "dialogue": [
    {
      "index": 0,
      "text": "…",
      "speaker": { "name": "Cyrus Drake", "source": "composed", "persona": "…" },
      "portrait": "…",
      "sound": "…"
    }
  ],
  "references": [
    {
      "field": "m_goals[0].m_goalTarget",
      "value": 12,
      "kind": "item",
      "resolved": { "label": "Twice Stitched Boots", "display": "Twice Stitched Boots (12)" }
    }
  ],
  "warnings": []
}
```

- `text_rows` is **every row of the quest's own table**, each marked `used_by_this_file` (P6-8). The
  split is computed per row by testing the row's key against the keys this file's own string-valued
  fields reference — measured material: 2,602 rows available, 1,303 used (~50% unused).
- `goal_gates` carries the world gate name, its `m_requiredStatus` and the **referencing objects**, so
  a row can never be shown without provenance. A `ReqHasEntry` row with an empty `m_questName` is a
  registry check, counted as such and never as a quest reference.
- `dialogue[].speaker` follows the **client's own precedence**, not a single lookup: `m_nameOverride`
  (a string-table key in any category) → else `m_nameSTKey` composed through `NPCFormats_First_Last` /
  `NPCFormats_First_Only` against the persona's first/last components → else the persona's template
  name via the manifest. `m_cameraName` is a display hint and is never the name. A persona missing
  from the manifest (8/288 measured) falls back to the **raw string** and is counted in `warnings` —
  never dropped.
- `references` covers every field `REFERENCE_FIELDS` (`shared/quest/validation.ts`) declares as a
  reference (P6-10) — that table stays the single home for "which field references what" — resolved
  from the synced tables and rendered through the one display rule (`formatNameRow`).
- `title_source` here is the **catalog link's** provenance (`direct` | `inferred` | `none`, P6-11) —
  the `quests.title_source` column. It is **not** the list endpoint's per-file `title_source`
  (`resolved` | `rawKey` | `missing`); see the collision note in
  [spec-data-model.md](./spec-data-model.md).
- The id-tier endpoint answers for an id with no linked catalog name: `quest.quest_name` is `null`,
  `has_definition` is `false`, and `title_source` stays honest about it.
- Unknown quest or id → `404 {"error": "Unknown quest \"…\""}`.

**Shipped shape, as implemented by p6-07 (the fields the example above does not name).** The example fixes the
sections; these are the additions the implementation made and the response now guarantees, so a consumer can rely
on them rather than on a sample:

- `quest.inference_basis` — the basis travels **beside** the `title_source: 'inferred'` label (the
  `quest_ids.inference_basis` column), so a labelled guess always arrives with its reasoning.
- `text_rows[].field` — the document path that references the row **when it is used**, and `null` when it is
  available. `used_by_this_file` is a **per-row computed predicate**: the file's own string values are collected,
  and a row is used iff its **key is one of those whole strings** — no prefix test, no naming convention.
- `dialogue[].field`, `dialogue[].dialog_key`, `dialogue[].own_table`, `dialogue[].camera_name`,
  **`dialogue[].field` points at the dialog ENTRY, not at the `m_dialog` leaf that holds the key** —
  measured (`m_goals[0].m_dialogList.m_dialogs[0].m_dialogEntries[0]`), and the distinction matters to an
  insert: `text_rows[].field` names the value's own path, whereas a dialogue row's entry path must have
  `.m_dialog` appended (or the field focused) before anything can be written there. A row's `field` is
  `null` when nothing references it.
  `dialogue[].actor_template_id` — the entry's path, its `m_dialog` key, and **whether that key belongs to *this*
  quest's own table**. `own_table` is not decoration: a quest file legitimately carries a top-level `m_dialogList`
  whose entries point at a **sibling** quest's table (measured on `WC-CYCLOPS-MAIN-002`: 27 entries, 22 under
  `m_goals` pointing at `WizQst17318F_*` and 5 at `WizQst17318E_*`), and a consumer that cannot tell them apart
  will read another quest's text as this one's. `camera_name` is echoed as **data** and is never the speaker;
  `actor_template_id` is surfaced verbatim because the ladder below has no rung that uses it (see the note).
- `dialogue[].speaker.override_key` / `.st_key` — which string-table key the override or the composition keyed on.
- `dialogue[].speaker.template_id` — the manifest id the persona resolves to (`persona_index`), or `null` for a persona
  the index cannot place. It is the `/npcs/:npcId` page's route parameter (task 7.14).
- `warnings[]` carries the counted, never-dropped cases (the raw-persona fallback, and non-gate references).

**The speaker ladder, and what it cannot do.** The order is `m_nameOverride` → `m_nameSTKey` composed through
`NPCFormats_First_Last` / `NPCFormats_First_Only` → the persona's template name via the manifest; `m_cameraName` is
**never** the name. Two consequences measured in p6-07: (i) `m_cameraName` frequently *contains* a plausible
speaker name (`"Cinematic Camera - Cyrus Drake"`) while elsewhere it is `"LOCATION"`, so the ladder must be proven
on the entries where the shortcut is wrong, and the response does not read it; (ii) entries exist with an **empty
persona and a positive `m_actorTemplateID`** (1,377 corpus entries overall) that `npcs` *can* name — the ladder has
no rung for them, so the id is surfaced as data and the miss is counted rather than an invented rung being added.

**Request-time inputs the ladder needs are indexed, not materialised.** `persona_index` (migration `0003`) holds
the persona's `template_id` and its first/last component **keys**, built by the sync from the manifest it already
loads plus a scan of the unpack tree's `Cinematics/` root. It is an **index** — the thing the spec forbids is a
materialised *evidence* table, not an index over the client's own strings.

---

## NPC View (Phase 6 — D112)

### GET /api/npcs/:id

The **NPC view** (P6-17): one NPC → its personas, dialogs, quests and NPC-keyed inventories. It
exists because the corpus's dominant name reference is not `npcs` at all (`WC-NPCs_*` is referenced
1,733 times and `m_nameOverride` stores a *key*, never literal text), and because an NPC's identity is
**dual** — a template id *and* a persona name — which a single-id name row cannot express.

The namespace is keyed **on the NPC, not on the name string**: one NPC legitimately carries several
strings at different granularities (`WC-NPCs_00000003` = "Gretta Darkkettle", `WC-NPCs_00000009` =
"Gretta", `NPCFormats_First_Last` → "Merle Ambrose", `NPCFormats_First_Only` → "Merle"), so keying on
the string would split one NPC into four. **The strings are aliases; the persona/template is the
identity.**

`:id` is the NPC key in either of the two forms that resolve: the numeric **template id**, or an
**alias-vocabulary key** (`WC-NPCs_00000027`, `NPCs_…`, `WizardNPC_…`, `Persona,First`/`Persona,Last`
components) when no template id resolves. The response echoes which form answered.

```json
{
  "npc": {
    "npc_key": "WC-NPCs_00000003",
    "template_id": 1234,
    "display_name": "Gretta Darkkettle",
    "aliases": ["Gretta Darkkettle", "Gretta"],
    "personas": [{ "persona_key": "…", "first": "Gretta", "last": "Darkkettle" }],
    "dialogs": [{ "quest_name": "…", "index": 0, "text": "…" }],
    "quests": ["WC-CYCLOPS-MAIN-002"],
    "inventories": { "npc_inventories": [], "npc_spell_inventories": [], "npc_drop_tables": [] },
    "counts": { "aliases": 2, "personas": 1, "dialogs": 3, "quests": 1 }
  }
}
```

- The three source tables are `WC-NPCs` (2,641 rows), `NPCs` (2,450) and `WizardNPC` (1,237) — all
  already in `string_table` — plus the `Persona,First` (78) / `Persona,Last` (57) components the
  composition format consumes.
- `counts` are the same aggregates the lists carry, so a caller never re-derives them; an
  NPC-keyed inventory family with no rows answers with an empty array rather than omitting the key.
- Unknown NPC → `404 {"error": "Unknown NPC \"…\""}`.
- **Search entry**: `GET /api/search` gains an `npc` group whose rows match the NPC's aliases *or* its
  template name and report `matched_on`, so searching `Gretta` finds **one** NPC carrying both
  `Gretta` and `Gretta Darkkettle`, not two rows.
- The **seven-type names contract stays frozen** (G7): this is an aggregate endpoint, not a name-list
  row, so `GET /api/names/:type` is untouched.

**Scope note (added by p6-06, measured).** The **namespace** and the `npc` search group ship in task 6.5 (the
alias keying, the one-row-two-aliases result, and `npcEntityById` resolving both key forms are implemented and
unit-tested there). **This view endpoint does not ship with task 6.5**, and the reason is a real dependency, not
an omission: its `dialogs` and `quests` arms both need the **speaker ladder** (`m_nameOverride` → composed
`nameSTKey` → template name) that task 6.6's evidence API builds, and serving those arms as empty arrays today
would read as "this NPC has no dialogs" — a false claim. The view is therefore **carried to task 6.6**, which owns the ladder and the per-quest dialogue rows.

**The page (task 7.14, D144).** The client route `/npcs/:npcId` renders this response (aliases, personas, dialogs,
quests and inventories, each headed by its `counts` value) and adds no API. It is linked from an `npc` search row
(`source_id`) and from a resolved speaker name in the Evidence panel (`speaker.template_id`).

**Status: shipped by p6-07 (task 6.6).** With the speaker ladder and `persona_index` in place the view serves
`personas` / `dialogs` / `quests` / `inventories` with `counts`, and the counts were verified against direct
queries (`GET /api/npcs/44169` → `{aliases: 2, personas: 1, dialogs: 4, quests: 1}`, matching the SQL). An arm
that cannot be populated is **explained in `notes`** rather than returned as an empty array posing as an
answer — e.g. `inventories.npc_drop_tables is empty because NpcDropTable/ does not exist in this corpus, not
because no row matched` — and an alias-only entity says which arms could not be resolved and why.

---

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

**Each `GET /` row carries `friendly_name: string | null`** (story p6-06, D105/P6-16). The server
resolves the friendly **data** from the table the family's `friendlyNamesType` names — `npcs` for
NpcInventory / NpcSpellInventory / NpcDropTable / TreasureCardInventory, `zones` for ZoneTransfer —
and never formats it: `title` stays the key for all eight families, and the client builds the
`Name (ID)` pair through `display.ts`'s one rule. `null` has three distinct meanings and the UI
renders the technical value alone for all three: the family has no friendly source (DropTable,
GlobalRegistry, and CreatureSpellbook until task 6.9 populates `decks` — `friendlyNameNote` carries
the reason), the template is a client **engine object** (`Player Object`, `GenericCinematicActor`,
… — every `TemplateID` at or below 4117, measured), or the key simply has no row in the names table.

Save operations automatically:
1. Write the JSON file to the correct SpiralDB subdirectory
2. Generate companion metadata (quests only)
3. Git auto-commit with message: `spiraldb: {action} {object_type} {object_key}`
4. Set/update entry status in local SQLite

---

## Suggestions and Drafts (Phase 7 — D129, D130, D137)

Suggestions are staged in the local `quest_suggestions` table ([data model](./spec-data-model.md)). A draft is one
catalog id, named or unnamed, as the `quest_drafts` view lists it. **None of these routes writes to SpiralDB.** A
suggestion reaches a file only when the editor applies it to its in-memory document and the user saves through
`POST /api/quests` or `POST /api/quests/scaffold`. The D119 branch guard therefore applies through those two routes
and not here, because these routes touch only SQLite.

### GET /api/quests/:name/suggestions · GET /api/quest-ids/:id/suggestions

The two routes mirror the evidence pair: `:name` is a catalog name and `:id` an unnamed-tier `quest_ids.quest_id`.
Both return one shape (Phase 7, chosen at p7-01). They are registered before `/api/quests/:name`, as `coverage` and
`catalog` are.

```json
{
  "quest_name": "LM-NIGHT-MAIN-009",
  "catalog_id": 126861,
  "suggestions": [
    {
      "id": 4812,
      "path": "m_questTitle",
      "value": "QuestTitle_1ED8D",
      "source": "evidence-title",
      "confidence": 1,
      "evidence_ref": "quest_ids:126861",
      "status": "pending",
      "created_at": "2026-09-29T20:14:03Z",
      "decided_at": null
    }
  ]
}
```

- `?status=` takes `pending` (the default), `accepted`, `rejected` or `all`. Any other value is a `400`, the same
  ladder as `?missing_only=`.
- `value` is the parsed `value_json`, not the string.
- Rows are ordered by `path`, then `source`, then `id`, so a re-read never reorders the inline list.
- An unknown name or id is a `404 {"error": "Unknown quest \"…\""}`. A known draft with no rows answers
  `suggestions: []`. **As built (p7-07):** a name is known when it is a `quests` row **or** carries suggestion rows
  (an extracted quest whose capture suggestions were stored before it had a catalog row); an id is known when it is
  a `quest_ids` row, and the id route answers only the unnamed-tier rows (`quest_name IS NULL`) of that id. The
  envelope's `catalog_id` for a name is its lowest linked `quest_ids.quest_id`, else `null`.

### POST /api/suggestions/:id/reject

Marks one pending suggestion `rejected` and stamps `decided_at`. The row survives every rebuild (D129). It answers
the updated row in the shape above. An unknown id is a `404`. A row that is not `pending` is a `409`, because a
decision is never silently overwritten.

### Accepting: recorded by the save, not by a route of its own

**Accepting is a client-side edit.** It sets the field in the editor's in-memory document, and nothing is persisted
yet. The status flips to `accepted` **only after the save commits** (task 7.7). So there is no accept endpoint
(Phase 7, chosen at p7-01). Instead the two save routes take an optional `accepted_suggestions: number[]`:

- `POST /api/quests`: `{ "quest": { … }, "notes"?, "source"?, "accepted_suggestions"?: [4812, 4813] }`.
- `POST /api/quests/scaffold`: see "Saving a draft" below.

The ids are validated **before** any write. Each must exist, be `pending`, and belong to the quest being saved
(its `quest_name`, or its `catalog_id` for a draft being named). Otherwise the request is a `400` naming the bad id,
and nothing is written. After the pipeline's commit exists, the server sets them `accepted` with `decided_at` in
one transaction. The response echoes `accepted_suggestions`. A save that fails anywhere leaves every id `pending`.
Accept-all from a source is the same request carrying every id the client applied.

### Saving a draft: `POST /api/quests/scaffold` extended

A draft whose quest has no file starts in the editor from the D118 minimal skeleton **in memory**, and there is no
write until Save. Its first save goes through the scaffold route, which gains two optional body fields (Phase 7,
chosen at p7-01):

```json
{ "quest_name": "LM-NIGHT-MAIN-009", "catalog_id": 126861, "quest": { "…": "skeleton + accepted fields" }, "accepted_suggestions": [4812], "notes": "optional" }
```

- **`quest`** is the in-memory document. It is written in the scaffold's single commit instead of the bare
  skeleton, so the file's first diff is the skeleton plus the accepted fields. Its `m_questName` must equal
  `quest_name`, or the request is a `400`. Without `quest`, the route behaves exactly as it did in Phase 6.
- **Naming an unnamed draft (D137).** When `catalog_id` names a `quest_ids` row with no `matched_quest_name`, the
  `quest_name` is the user's choice. It is pre-filled from the id's evidence (its title key where one exists) and
  never auto-applied. It must not already exist in `quests` (otherwise `409`) and must pass the scaffold's path guard
  (otherwise `400`). In one transaction the server creates the `quests` row, links the `quest_ids` row, and sets
  `quest_name` on that id's suggestion rows. It then follows the scaffold path. **A refused name writes nothing.**
- A named draft keeps the Phase 6 status codes (`404` unknown name, `409` already has a file).
- **As built (p7-08).** `quest` is validated as `POST /api/quests` validates a save (the shared schema, then the
  blocking rules), so a refused document writes nothing. A `catalog_id` that is linked to a different name is a
  `400`; an unknown one is a `404`. A name is a duplicate when a `quests` row **or** a quest file already carries it.
  The response adds `catalog_id`, `named` (`true` when this save named an unnamed draft) and `accepted_suggestions`.
  The new `quests` row is written the way the next sync writes a corpus file's row (`has_definition = 1`), and both
  it and the `quest_ids` row get `link_kind = 'direct'`. The catalog writes and the accepted flips run in one
  transaction **after** the commit, so a failed save leaves no catalog row and no flipped id.
- **`GET /api/quests/:name/scaffold` (p7-08).** The unwritten D118 skeleton a named draft with no file opens on:
  `{ quest_name, link_kind, title_key, quest }`, the exact document `POST /api/quests/scaffold` would write for that
  catalog row, direct-link title included. `404` for a name the catalog does not hold, `409` when the quest already
  has a file (in the catalog or on disk). Nothing is written. An unnamed id's skeleton has no name and no link, so the
  client builds it from the shared builder with `#<id>` as a placeholder `m_questName`.

### GET /api/drafts

The draft queue's rows, read from `quest_drafts` (Phase 7, chosen at p7-01):

```json
{
  "drafts": [
    {
      "quest_name": null,
      "catalog_id": 128004,
      "title": "The Lost Lantern",
      "has_definition": 0,
      "reference_count": 0,
      "pending": 6,
      "accepted": 0,
      "rejected": 1,
      "evidence_richness": 5,
      "sources": ["evidence-dialogue", "evidence-title"]
    }
  ],
  "total": 1840,
  "hidden_zero_evidence": 4412,
  "filters": { "named": null, "has_file": null, "source": null, "all": false }
}
```

- Filters: `?named=1|0` (a catalog name vs the unnamed tier), `?has_file=1|0`, `?source=<source>`, and `?all=1`,
  which includes zero-evidence drafts. They are hidden by default, and `hidden_zero_evidence` is the count the toggle
  shows (D130). A malformed value is a `400`.
- `?limit=` (default 100, max 1000) and `?offset=` page the result. `total` counts the filtered rows before paging.
- Ordered `evidence_richness DESC, reference_count DESC`, then `quest_name`, then `catalog_id`, so the order is
  stable.

### POST /api/drafts/rebuild

Runs the draft builder, the same code as `npm run drafts`, over **every catalog id, named and unnamed** (D130). It is
synchronous, like `POST /api/sync`. A second request while one runs is a `409`.

```json
{
  "inserted": 2311,
  "unchanged": 18402,
  "by_source": { "evidence-title": 4102, "evidence-dialogue": 9120, "evidence-goals": 612, "evidence-location": 3380, "evidence-requirements": 1204, "capture-order": 0, "capture-rewards": 0 },
  "drafts": { "named_missing": 1395, "named_defined": 322, "unnamed": 3106 },
  "duration_ms": 41210
}
```

- `inserted` is the rows this run added, and `unchanged` is the rows the identity index already held, whatever their
  status. Two consecutive rebuilds therefore report `inserted: 0` the second time.
- `drafts` reconciles with `GET /api/quests/coverage`: `named_missing` = `missing`, `named_defined` = `defined`, and
  `unnamed` = the unlinked `quest_ids` rows.
- The numbers above are illustrative. Every count is read from the run, never hard-coded.
- **As built (p7-07, D163).** The body also carries `proposed` (the proposals this run made; `inserted +
  unchanged`), `removed` (pending `evidence-*` rows the run no longer proposes — their field was filled since),
  `drafts.zero_evidence` (the drafts the queue hides by default), and the two precisions the run re-measured on the
  corpus, `gate_precision {matched, gates}` and `predecessor_precision {matched, files}`, which are the confidences of
  `evidence-goals` and `evidence-requirements`. `by_source` counts the table's rows per source **after** the run,
  every status, all seven keys present. `unchanged` also counts a proposal a decided row blocks (the data model's
  idempotence rule). A missing `settings.spiraldb_path` is a `400`.
- **Unreadable corpus (D195).** When the run's quest-file read finds no file (`QuestTemplates/` missing or empty under
  the root — a typo, the parent directory, or `QuestTemplates/` itself as the root) while pending `evidence-*` rows
  exist, the rebuild is a `409` naming the directory it read and the pending count, and **nothing is written**:
  otherwise every pending evidence row would be deleted as "no longer proposed". `npm run drafts` exits 1 with the
  same message.
- `npm run drafts -- --db <file> [--spiraldb <dir>]` runs the same builder and prints this body as JSON. It **refuses
  to pick a database implicitly** (exit 2 without `--db` or `SPIRALDB_UI_DB`, D164), and it reads the SpiralDB root
  without writing to it.

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

**Phase 7 additions (tasks 7.2 and 7.5; the fields are chosen at p7-01).** The response gains two fields. Every field
above is unchanged.

```json
{
  "quests": [ ... ],
  "count": 14,
  "suggestions": [ { "questName": "…", "path": "m_goalLogic", "value": [ … ], "source": "capture-order", "confidence": 0.8, "note": "…" } ],
  "census": {
    "messages": 412,
    "rows": [ { "message": "MSG_SENDNPCOPTIONS", "field": "Options", "count": 3, "consumed": false } ]
  }
}
```

- `suggestions` is always present, as `[]` when the wrapper inferred nothing. It is the wrapper's sidecar array
  ([domain reference](./spec-domain-reference.md#phase-7-the-suggestions-sidecar-d127--task-75)), passed through
  verbatim. The server also stores each entry as a pending `quest_suggestions` row with `evidence_ref` =
  `capture:<file name>` (the base name, sanitised like `source`). The insert is idempotent through the identity
  index, so re-uploading the same capture adds nothing. Nothing is merged into `quests`.
- As built (p7-06): the response carries `suggestions` exactly as the sidecar holds them. As built (p7-07, D161):
  they are stored **when the extraction answers** (not on a later save), with `catalog_id = NULL` and `evidence_ref =
  capture:<file name>` sanitised by the save route's `sanitizeCaptureSource`. A store failure is reported as a
  process warning and never fails the extraction. A rebuild never deletes these rows.
- **`suggestions_store` (D195).** Present when the run inferred suggestions: `{ "stored": true, "inserted",
  "unchanged", "uncatalogued" }`, where `uncatalogued` counts the suggestions whose `questName` has no `quests` row
  (stored, but not listed in `/drafts` until a sync adds that quest), or `{ "stored": false, "reason": "…" }` when
  the store failed. The store is awaited; the upload page shows either case beside the results.
- `census` is present only when the request asks for it with `?census=1`. It holds the `capture-census` rows for
  the same file. If the census binary is absent, `census` is `{ "skipped": "…reason…" }`, and the extraction itself
  still succeeds, the same posture as the sync's missing `wad-scan` (D55). A tool output whose rows are not all
  `{message: string, field: string, count: number, consumed: boolean}` is also `{ "skipped" }` (D195), never served
  as a census.

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

`zones` and `drop_tables` were deliberately not searched by name in Phase 5: `drop_tables.name`
repeats the `drop_table` object key verbatim, so a name arm over it could only duplicate the key arm.
**Phase 6 widens this** (D105/P6-16 — "every search matches either the friendly or the technical
value"), and the widening is **selective, not blanket**:

- **`zones` gains a name arm** over `zones.display_name`, because a zone's friendly name
  (`Dragon Spire / DS A2 Battle / DS A2Z3 Detention`) is genuinely different text from its key
  (`DragonSpire/DS_A2_Battle/DS_A2Z3_Detention`).
- **The four TemplateID families gain a name join** (`npcs` for NpcInventory, NpcSpellInventory,
  NpcDropTable and TreasureCardInventory) and **ZoneTransfer gains one** (`zones`), so a quest-giver's
  name finds the rows keyed by his template id. Each such row is reported through the existing
  `matched_on: "key" | "name"` field, and — being a real object key — it stays **navigable**.
  A template that is an **engine object** (`Player Object`, `GenericCinematicActor`, …) has no NPC
  name, so the join yields nothing and the row renders its technical value alone.
- **`drop_tables` gains no name arm: the technical value *is* the name.** `description` is NULL in
  316 of 317 rows, and a humaniser over the key would read as a name that does not exist — the
  objection the per-family table in [spec-ui-design.md](./spec-ui-design.md) records.
- **`npc` becomes a new group** ([NPC View](#npc-view-phase-6--d112)): matched on the NPC's aliases or
  its template name, so an NPC carrying several name strings at different granularities is **one row**.

`label` is the row's primary text — the object key for a navigable row, the friendly name for an
informational one — and `name` is whichever friendly name is known for the row (a quest matched on
its key still reports its title, or `null` when the `quests` table has none). `matched_on` is
`"key"` or `"name"` and says which column matched.

**An `npc` row additionally carries `aliases: string[]`** (story p6-06). It is the only field the
group adds, and it is what makes "one row, several granularities" checkable from the wire rather
than inferred: searching `Gretta` answers **one** row whose `aliases` are
`["Gretta", "Gretta Darkkettle"]`, `label`/`name` are the full name, and `source_id` is the
namespace's representative alias key (`WC-NPCs_00000003`, the category the corpus references most);
a template with no alias row at all answers its template name alone with `source_id` = the template
id. The row's wire fields stay `object_type`/`object_key`/`status` = `null` and it stays counted in `unresolved`, but since
task 7.14 the palette opens `/npcs/<source_id>` for it and takes it back out of the "no page to open" notice.
The group matches aliases and template names — **not** the template id, which is the four
`TemplateID` families' join arm and `?q=` on the names API.

**A joined row's `label` stays the object key**, so its friendly name reaches the palette through
`name` and the pair is rendered client-side (`display.ts`'s one rule). The wire shape is unchanged
from Phase 5 for that reason — `label` + `name` + `matched_on` already carried everything a
`Wizard Tours (DS-ACAD-C01-001)` row needs.

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
matched appear at all. Phase 6 widens the `npc` group (D112): it matches the NPC's **aliases** as well
as its template name, matching on the NPC rather than on the string, so several name strings for one
NPC are one row. The group order does not change.

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
/quests/catalog             → Quest Catalog: coverage, worklist, scaffold (Phase 6, P6-15)
/quests/:questName          → Quest detail/edit
/drafts                     → Draft review queue (Phase 7, task 7.7 / p7-08)
/drafts/quest/:questName    → A named draft with no file, in the editor on its D118 skeleton (p7-08)
/drafts/id/:questId         → An unnamed-tier draft, in the editor; its first Save names it (p7-08, D137)
/glossary                   → Glossary: every field, class and enum label (Phase 7, task 7.12 / p7-13)
/npcs/:npcId                → NPC view: personas, dialogs, quests, inventories (API Phase 6, D112; page Phase 7, task 7.14 / p7-15)
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

**Order is part of the contract.** Static segments are listed before the dynamic patterns that could
shadow them — `/quests/extract` and `/quests/catalog` both precede `/quests/:questName`, which is what
`matchRoute` (`client/src/lib/routes.ts`) implements. A quest legitimately named `extract` or `catalog`
is therefore unreachable by its detail route, exactly as it was before Phase 6.

**As built (p7-08):** `/drafts` and its two file-less editors, `/drafts/quest/:questName` and `/drafts/id/:questId`,
are in `APP_ROUTES` and in `SPEC_ROUTES`. A draft with a file opens at `/quests/:questName`.

**Phase 7 routes land with their stories.** `/drafts`, `/glossary` and the `/npcs/:npcId` page are listed above ahead
of the code that serves them. `tests/unit/ui-shell.test.ts` re-types this table as its `SPEC_ROUTES` oracle ("every
route … and nothing else") rather than parsing it. The oracle therefore still omits all three today, and the test
stays green. Each implementing story adds its route to `APP_ROUTES` (`client/src/lib/routes.ts`) **and** to
`SPEC_ROUTES` in the same commit, as p6-11 did for `/quests/catalog`: `'/drafts'` with p7-08, `'/glossary'` with
p7-13 and `'/npcs/:npcId'` with p7-15. The nav oracle (`byGroup.QUESTS`) moves with the sidebar items
([UI design](./spec-ui-design.md#sidebar)). None of the three is shadowed by a dynamic pattern, so the order rule
above is unaffected.

**The NPC page (task 7.14)** reads the existing `GET /api/npcs/:id` and adds no API. `searchResultHref` links an
`npc` search row to `/npcs/:npcId` instead of returning `null`. **The glossary** is client-side data
(`shared/glossary.ts`, D131) and adds no API either.

## Related Documentation

- [Architecture](./spec-architecture.md) — System overview, tech stack, data flow
- [Data Model](./spec-data-model.md) — SQLite schemas, verification lifecycle, file naming
- [Domain Reference](./spec-domain-reference.md) — SpiralDB JSON schemas, type enumerations
- [UI Design](./spec-ui-design.md) — Visual design, layout, component patterns
