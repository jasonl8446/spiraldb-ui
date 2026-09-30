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

### Quest Catalog (Phase 6 — D96–D99, D103, D106, D107)

Migration `0002_quest_catalog.sql`. The game files hold **no quest definitions** (D96: 183,676
objects censused, zero `QuestTemplate`), so the quest *catalog* is a derived table set: which quests
the world names, which ids the client holds text for, and what references each one. It is derived
from the WADs by the sync and is **never hand-maintained**.

`quests` gains four columns; its `quest_name` primary key is unchanged, and the table now holds
**two row kinds** — corpus rows (a `QuestTemplates/` file exists → `has_definition = 1`) and
catalog-only rows (the world names it, no file yet → `has_definition = 0`). **This amends D21**
(P6-4): the `quests` table is no longer a corpus mirror; it is the catalog, and the corpus is the
subset of it that has definitions.

```sql
-- quests: the catalog. `quest_name` is the operational key (the world gates quests by name).
ALTER TABLE quests ADD COLUMN has_definition INTEGER NOT NULL DEFAULT 0;  -- 1 = a QuestTemplates/ file exists
ALTER TABLE quests ADD COLUMN link_kind TEXT;      -- 'direct' | 'inferred' | 'none' (how the title/id link was established)
ALTER TABLE quests ADD COLUMN title_source TEXT;   -- 'direct' | 'inferred' | 'none' (P6-11 provenance of that link)
ALTER TABLE quests ADD COLUMN reference_count INTEGER NOT NULL DEFAULT 0;  -- referencing {wad, entry} pairs

-- World evidence per quest: what referenced it, where, and the goal gate it carries.
CREATE TABLE IF NOT EXISTS quest_catalog_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quest_name TEXT NOT NULL REFERENCES quests(quest_name),
  wad TEXT NOT NULL,             -- WAD file path (repo-relative)
  entry TEXT NOT NULL,           -- entry name inside the WAD
  class TEXT NOT NULL,           -- the NDJSON row's class ('WizZoneData' | 'WizZoneTriggers'); the nested
                                 -- requirement nodes carry no `$type` (measured: 0 of 5,282), so the
                                 -- requirement class is recorded per-row separately by the extractor
  goal_name TEXT,                -- the goal gate's name, when the reference carries one
  required_status TEXT,          -- that gate's m_requiredStatus, when present
  UNIQUE(quest_name, wad, entry, class, goal_name)
);
CREATE INDEX IF NOT EXISTS idx_quest_catalog_refs_quest ON quest_catalog_refs(quest_name);
CREATE INDEX IF NOT EXISTS idx_quest_catalog_refs_wad ON quest_catalog_refs(wad, entry);

-- The second tier (P6-3): the ~4,830-quest id space the client holds text for. Never a work item.
CREATE TABLE IF NOT EXISTS quest_ids (
  quest_id INTEGER PRIMARY KEY,  -- the numeric id in QuestTitle_<id> / WizQst<id>_*
  title_key TEXT,                -- 'QuestTitle_1ED8D' when a key exists
  title TEXT,                    -- resolved title text
  text_rows INTEGER NOT NULL DEFAULT 0,  -- rows in the quest's own WizQst<id>_* tables
  matched_quest_name TEXT,       -- the catalog name this id belongs to, when linked
  link_kind TEXT,                -- 'direct' | 'inferred' | 'none'
  inference_basis TEXT           -- why an 'inferred' link was accepted (P6-11) — never a bare claim
);
CREATE INDEX IF NOT EXISTS idx_quest_ids_matched ON quest_ids(matched_quest_name);

-- One definition of "how much of the catalog is built", so the UI never hard-codes a number.
CREATE VIEW IF NOT EXISTS coverage AS
SELECT
  (SELECT count(*) FROM quests)                          AS nameable,   -- catalog tier (>= 1,447 world-named)
  (SELECT count(*) FROM quest_ids)                       AS id_space,   -- second tier (~4,830 ids with text)
  (SELECT count(*) FROM quests WHERE has_definition = 1) AS defined,    -- corpus rows in the corpus under test
  (SELECT count(*) FROM quests WHERE has_definition = 0) AS missing,
  (SELECT count(*) FROM quest_catalog_refs)              AS "references";  -- quoted: REFERENCES is a SQLite keyword
```

**Note (added by p6-05): `references` is a SQLite keyword and must be quoted as `"references"`.** Written bare — as this
block first did — the view does not parse (`near "references": syntax error`, reproduced independently). Quoting keeps
every column name, and therefore the view's contract, identical to what the API and UI read. The four `quests` column
adds are *also* not expressible as idempotent DDL: SQLite has no `ADD COLUMN IF NOT EXISTS` and the runner re-executes
every migration file on each open, so they are applied by a `PRAGMA table_info`-guarded step in `server/src/db.ts` that
issues only the missing ALTERs — a data-driven check, not error-swallowing, so a real duplicate-column failure still
throws loudly.

**Reading the `coverage` view.** `nameable` and `id_space` are the two honest denominators (P6-15/
D110): "`defined` of `nameable` nameable of `id_space` quests the client holds text for". `defined`
reads **322** against the D17 clone and **328** against the owner's fork — the corpus is always named
with its number, never one quoted for the other. `nameable` is `count(*)` on `quests`, so it is
**≥ 1,447** (a corpus quest the world does not name is still a row); the UI reads it from the view.

**Name collision, stated so no reader conflates them.** The `quests.title_source` *column* is the
catalog link's provenance (`direct` | `inferred` | `none`, P6-11). The quests **list** endpoint's
`title_source` *field* (see [spec-api.md](./spec-api.md)) is the per-file title resolution
(`resolved` | `rawKey` | `missing`) and is unchanged by Phase 6; the evidence endpoint's
`title_source` is the column. Same name, two meanings, two homes — a reader who assumes one will
mis-read the other.

**An inferred link never travels alone.** `quest_ids.inference_basis` records what the interpolation
rested on — the anchored neighbours either side of the gap — **and** the two conditions the candidate
had to pass: a `QuestTitle_*` key exists *and* its `WizQst` table is non-empty (P6-11). That is the
column p6-04-ac2 means by "the row carries `link=inferred` **plus its basis**": labelling a guess
without recording its basis would make an inferred title indistinguishable from a verified one, and
the run's own rule is that inferred material is shown, labelled, and **never written** into a
loadable file (P6-6). The evidence endpoint surfaces the basis beside the label.

**Sync staging (inside the existing transaction, P6-4 keeps the transactional replace).** Corpus
rows are written first (the D19 scan the sync already performs), then catalog rows are merged, then
`quest_catalog_refs` and `quest_ids` are replaced, then `has_definition`/`link_kind`/`title_source`/
`reference_count` are recomputed from what was merged. The stage is **additive** and idempotent:
after the first sync, later syncs merge the same rows. If `tools/bin/wad-scan` is absent the stage is
recorded as `skipped` with a message and the sync still succeeds (D55's CI has no .NET SDK), leaving
the corpus rows' `has_definition` correct.

### Breadth Tables (Phase 6, migration `0004_breadth_catalog.sql`)

The breadth stage (task 6.9) fills two families the client ships but the corpus never names, plus the real
zone data that replaces D21's corpus-derived fallback. **All three carry the D35 manifest id.**

```sql
CREATE TABLE IF NOT EXISTS recipes (
  template_id INTEGER PRIMARY KEY,  -- from TemplateManifest_deser.json, joined via source_path
  name TEXT NOT NULL,
  source_path TEXT NOT NULL         -- the manifest's own path key, e.g. '|Recipes|WorldData|ObjectData/…'
);
CREATE TABLE IF NOT EXISTS decks (
  template_id INTEGER PRIMARY KEY,
  deck_name TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  source_path TEXT NOT NULL
);
```

- **`recipes` (12,402)** comes from **`RecipeTemplate`** objects, which live in **`Recipes-WorldData.wad`** —
  a wad the sync's `runUnpack` never unpacks — so the stage extracts them with the 6.2 tool over a scoped
  archive list rather than from the unpack tree. Measured: 12,402 rows, 12,402 distinct `template_id`, 0
  empty `source_path`.
- **`decks` (599)** comes from **`DeckTemplate`**, which *is* in Root.wad's tree. Measured: 599 rows, 599
  distinct `template_id`, 599 distinct `deck_name`. **A `DeckTemplate`'s only name is its own key** (586 of
  599), so a row of a family paired against `decks` would render the degenerate `X (X)` — see the note on
  CreatureSpellbook in [spec-ui-design.md](./spec-ui-design.md).
- **Neither family carries an `m_templateID`** (0 of 12,402 and 0 of 599), so the manifest is their
  **identity**, not a cross-check. The manifest keys world-wad templates under a `|WadStem|` prefix
  (`|Recipes|WorldData|ObjectData/…`), and 36 recipe entries need a repair: their manifest keys carry two
  leading NUL bytes and an `.xml` truncated to `.x`.
- **`zones` is reconciled, not replaced.** The stage unions the real `WizZoneData` names (3,356) with the
  corpus-derived rows, keeping a corpus path the new source does not cover (`Karamelle/KM_Z06_Mines`) so no
  dropdown regresses: measured **1,241 → 3,357**, and all **149** distinct corpus `m_destinationZone` values
  resolve afterwards (112 before). `sync_history.zones_count` records the reconciled table's count.
- **`m_zoneDisplayName` is a `string_table` KEY**, not display text (`WizardZone_00000485` → "Garden Of
  Hesperides"; all 1,108 distinct values are keys — 1,099 `WizardZone_*` plus 9 `Zone_*`/`Housing_*`), so the
  stage resolves it through a ladder inside the transaction: **resolved value → the humanised path (what
  every row showed before this story) → the raw key**. Measured: 3,339 of 3,357 labels are real game labels,
  **0 are bare keys**, 18 fall back to the humanised path. Storing the key verbatim would have replaced
  `Aquila / AQ Z00 Hub` with `WizardZone_00000485`.

### Persona Index (Phase 6, migration `0003_persona_index.sql`)

The speaker ladder an evidence response needs (`m_nameOverride` → composed `m_nameSTKey` → the persona's template
name) cannot be a pure request-time join: `m_persona` structs are **inline structs, not templates**, so they are
absent from the manifest's id space, and `loadTemplateManifest` deliberately does not retain its 17 MB document.
The sync therefore persists the two facts the ladder needs, and the request path joins against them.

```sql
-- One row per persona object name; an INDEX over the client's own strings, not a materialised evidence table.
CREATE TABLE IF NOT EXISTS persona_index (
  object_name TEXT PRIMARY KEY,  -- 'WC-RAV-NPC02' (the persona name minus a trailing '_Persona')
  template_id INTEGER,           -- from the manifest's basename→id map, kept only when `npcs` can name it
  first_key TEXT,                -- the persona struct's `m_firstName` string-table KEY ('WC-NPCs_00000083')
  last_key TEXT,                 -- its `m_lastName` key ('WC-NPCs_00000084')
  title_key TEXT
);
```

**Built by the sync**, inside the existing run: `buildManifestPersonaRows` filters the manifest it already loads to
the ids `npcs` can name, and `scanPersonaStructs` walks the unpack tree's **`Cinematics/`** root for the
`m_firstName`/`m_lastName` components. Measured on `V_r806919.Wizard_1_610`: **23,003** persona object names, of
which **3** carry components — the components are rare because most speakers resolve by template name or override.
`WC-RAV-NPC02` carries `WC-NPCs_00000083` = "Cyrus" / `WC-NPCs_00000084` = "Drake", which is what composes "Cyrus
Drake" for `WC-CYCLOPS-MAIN-002`.

**Two rules for readers.** (a) The **adjacent-key heuristic must not be used**: `WC-NPCs_00000082` = "Cyrus Drake"
sits next to `_83` = "Cyrus" and `_84` = "Drake", but of 1,149 multi-word `WC-NPCs` rows whose neighbours both
exist only **167 (15%)** follow that convention — a coincidence, not a rule. (b) `Persona,First` / `Persona,Last`
(78 / 57 rows) are an **unrelated roster** and do not hold these components; do not compose from them.

### Quest Suggestions (Phase 7, migration `0005_quest_suggestions.sql` — D129, D130)

Automatic quest data is **staged locally as suggestions**. Only a field a human accepts reaches SpiralDB, through the
unchanged save pipeline (D129, which amends D100/D101 for where inferred content may live; the rule that nothing
inferred is ever written into a *file* stands). The file is appended to `MIGRATION_FILES` (`server/src/db.ts`), and
`db.test.ts`'s table/view/index counts move with it.

```sql
CREATE TABLE IF NOT EXISTS quest_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quest_name TEXT,               -- the catalog name; NULL for an unnamed-tier id until the user names it (D137)
  catalog_id INTEGER,            -- quest_ids.quest_id when the quest has one; NULL for a named quest with no id link
  path TEXT NOT NULL,            -- document path the value fills ('m_questTitle', 'm_goals[0].m_personaName', 'm_goalLogic')
  value_json TEXT NOT NULL,      -- the proposed value, JSON-encoded
  source TEXT NOT NULL,          -- see "Sources" below
  confidence REAL,               -- [0, 1]; NULL when the source states none
  evidence_ref TEXT,             -- where the value came from (a capture file name, a {wad, entry}, a string-table key)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME,           -- set when status leaves 'pending'
  CHECK (quest_name IS NOT NULL OR catalog_id IS NOT NULL)
);
-- The rebuild's identity: one row per (draft, path, source, value) whatever its status.
-- Expression index (Phase 7, chosen at p7-01): SQLite treats NULLs in a plain UNIQUE as distinct,
-- which would let a rebuild duplicate every unnamed-tier row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_quest_suggestions_identity
  ON quest_suggestions(coalesce(quest_name, ''), coalesce(catalog_id, -1), path, source, value_json);
CREATE INDEX IF NOT EXISTS idx_quest_suggestions_quest ON quest_suggestions(quest_name, status);
CREATE INDEX IF NOT EXISTS idx_quest_suggestions_catalog ON quest_suggestions(catalog_id, status);
```

**The draft set is every catalog id, named and unnamed (D130).** A draft is either a `quests` row (named, with or
without a file) or a `quest_ids` row with no `matched_quest_name` (the unnamed tier). The `quest_drafts` view gives
one row per draft with its evidence richness, and the draft queue ranks on it. The column list is the contract; the
SQL below is its reference form (Phase 7, chosen at p7-01).

```sql
CREATE VIEW IF NOT EXISTS quest_drafts AS
WITH drafts AS (
  SELECT q.quest_name,
         (SELECT min(i.quest_id) FROM quest_ids i WHERE i.matched_quest_name = q.quest_name) AS catalog_id,
         q.title,
         q.has_definition,
         q.reference_count
  FROM quests q
  UNION ALL
  SELECT NULL, i.quest_id, i.title, 0, 0
  FROM quest_ids i
  WHERE i.matched_quest_name IS NULL
)
SELECT d.quest_name,
       d.catalog_id,
       d.title,
       d.has_definition,
       d.reference_count,
       coalesce(sum(s.status = 'pending'), 0)                          AS pending,
       coalesce(sum(s.status = 'accepted'), 0)                         AS accepted,
       coalesce(sum(s.status = 'rejected'), 0)                         AS rejected,
       count(DISTINCT CASE WHEN s.status = 'pending' THEN s.path END)  AS evidence_richness,
       group_concat(DISTINCT s.source)                                 AS sources
FROM drafts d
LEFT JOIN quest_suggestions s
  ON (d.quest_name IS NOT NULL AND s.quest_name = d.quest_name)
  OR (d.quest_name IS NULL AND s.quest_name IS NULL AND s.catalog_id = d.catalog_id)
GROUP BY d.quest_name, d.catalog_id;
```

**As built (p7-07).** Migration `0005` writes the view as **two branches joined by `UNION ALL`** — named drafts
joined on `quest_name`, unnamed drafts joined on `quest_name IS NULL AND catalog_id` — instead of the single `LEFT
JOIN … ON (…) OR (…)` above, because SQLite cannot use an index for an OR-join and the single form scanned every
suggestion once per draft. The column list is unchanged. **`sources` lists the sources of the draft's `pending`
rows only**, the rows the queue ranks and filters on (the reference form above lists every status).

- **`evidence_richness`** is the number of distinct document paths with a pending suggestion (Phase 7, chosen at
  p7-01). A draft with richness 0 is a **zero-evidence draft**: hidden from the queue by default, behind a visible
  toggle and count (D130).
- **The view reconciles with `coverage`.** Named drafts with `has_definition = 0` equal `coverage.missing`; named
  drafts with `has_definition = 1` equal `coverage.defined`; unnamed drafts equal the `quest_ids` rows with no
  `matched_quest_name`.

**Sources (Phase 7, chosen at p7-01).** `capture-order` and `capture-rewards` arrive from the wrapper's `suggestions`
sidecar ([domain reference](./spec-domain-reference.md#phase-7-the-suggestions-sidecar-d127--task-75)). The builder
(`npm run drafts`, `POST /api/drafts/rebuild`) writes the Phase 6 evidence sources: `evidence-title` (the title key),
`evidence-dialogue` (dialogue rows with their resolved speakers), `evidence-goals` (goals from `goal_gates`),
`evidence-location` (location keys) and `evidence-requirements` (reference-derived requirements such as
`ReqHasQuest`).

**As built (p7-07; the per-source rules are D162).** Each source proposes into one path, and only when that path is
empty in the draft's base document (its file, or the D118 skeleton for a quest with no file):

| source | path | value | confidence |
|---|---|---|---|
| `evidence-title` | `m_questTitle` | a linked id's `quest_ids.title_key`; for a direct link with no id row, each `QuestTitle_*` key carrying `quests.title` | `1` direct, `0.78` inferred (D106), `1/n` for `n` keys sharing the text |
| `evidence-dialogue` | `m_dialogList` | an `ActorDialogList` of the dialog blocks **other** corpus files record from this quest's own `WizQst` table, narrowed to those entries; the speakers the evidence ladder resolves are named in `evidence_ref` | `NULL` |
| `evidence-goals` | `m_goals` | one `PersonaGoalTemplate` per `goal_gates` name, in the gate's zone when the WAD's zone path is a `zones` row | gates matching a file's goal name / all gates on defined quests, re-measured each run |
| `evidence-location` | `m_goals[i].m_locationName` | the `ZoneLocName_*` key corpus goals use most in that goal's `m_destinationZone` (also for the goals `evidence-goals` proposes) | that key's share of the zone's goals |
| `evidence-requirements` | `m_requirements` | a `RequirementList` holding one `ReqHasQuest` on the quest's **name-series predecessor** (`…-002` → `…-001`) when that name is a catalog row | files whose `ReqHasQuest` names their predecessor / files with one, re-measured each run |

**Empty** (D162) means `null`, absent, `''`, `0`, `false`, `[]`, or an object whose every member except `$type` and
`m_operator` is empty, so the skeleton's `{$type, m_dialogs: []}`, `{m_results: []}` and an empty `RequirementList`
are empty while a requirement naming a quest is not. Capture rows are stored with `catalog_id = NULL` (the wrapper
names the quest, never its id).

**Lifecycle rules.**

- **Idempotent.** Every write is an `INSERT … ON CONFLICT DO NOTHING` against the identity index, so a rebuild never
  duplicates a row, never resurrects a `rejected` row and never re-proposes an `accepted` value. **As built (p7-07,
  D163)** the insert is also skipped when a decided row covers the proposal under a different identity: the same
  draft (its `quest_name`, else its `catalog_id`), path and value **accepted from any source**, or **rejected from
  the same source** — so a rejection survives a sync that links a named quest to a different id. A rebuild then
  **deletes the `pending` `evidence-*` rows it did not propose** (their field was filled since, so they would break
  the empty-field rule); it never touches an `accepted`/`rejected` row or a `capture-*` row.
- **Existing files get suggestions only for fields that are empty in the file.**
- **`pending → accepted` happens only after the save commits** (task 7.7). The save request names the suggestion ids
  it applied, and the server flips them in the same request once the pipeline's commit exists. A failed save leaves
  them pending. **`pending → rejected`** is immediate and survives a reload and every rebuild.
- **Naming an unnamed draft (D137)** sets `quest_name` on every row of that `catalog_id` in the same transaction that
  creates the catalog row.
- Nothing in this table is ever read by the save pipeline as file content. The saved document is what the editor
  sends.

### `quests.title_key` (Phase 7, migration `0006` — D136, task 7.14)

```sql
ALTER TABLE quests ADD COLUMN title_key TEXT;  -- the QuestTitle_* key the catalog title was resolved from
```

- Applied by a `PRAGMA table_info`-guarded step like `applyQuestCatalogColumnAdds` (`server/src/db.ts`), for the
  same reason as the 0002 column adds: SQLite has no `ADD COLUMN IF NOT EXISTS`, and the runner re-executes every
  migration file on each open. `0006_quest_title_key.sql` is appended to `MIGRATION_FILES` and holds only what is
  idempotent DDL (Phase 7, chosen at p7-01: the file name).
- **Why.** The sync records the key it resolved a title from, so an inferred title survives the next sync instead of
  falling back to the quest name. Phase 6 measured 10 of 285 direct links that wrote no title
  (`docs/evidence/phase-6/p6-09.md`); task 7.14 re-measures them.
- The scaffold's title-key lookup (`quest_ids.title_key`, else a unique reverse lookup of `quests.title`) may read
  this column first once it exists. Its "never guess identity" rule is unchanged.

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

**`Description` carries the tool's own provenance** (added by p6-09, plan task 6.8). It is the only
free-text field of this fixed seven-key shape, so it is where a *creating* flow states how the
object came to exist — the extraction save already does (`Quest extracted from packet capture.`),
and a scaffold-from-catalog save writes
`Scaffolded from the quest catalog (link_kind: {direct|inferred|none}; title {key} | no title …)`,
naming the link kind and whether an `m_questTitle` key was written. No eighth key is added: a
new key would break the shape every reader and `QUEST_METADATA_KEYS` pin.

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
5. This runs once only; subsequent startups skip if table has rows **[AMENDED BY D82(a), docs/plan-overview.md L158 — the table is never skipped: a startup whose table has rows _reconciles_ instead. For every corpus key with no `entry_status` row it inserts the same `status='extracted'` row **plus one `status_history` row recording the file it came from**, and it never deletes, re-statuses, re-stamps or re-writes a row that already exists (an existing row's status, notes, timestamps and history survive a backfill untouched). The first startup's bulk adoption writes no history row — the whole table appears at once, which is an origin rather than a transition; a file that arrives later is a change to a dataset that already existed, and it gets the provenance row. A family whose directory is absent (`NpcDropTable/` today) contributes zero work and is never an error.]**

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
