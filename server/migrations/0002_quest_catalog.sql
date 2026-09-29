-- SpiralDB UI — quest catalog schema (task 6.4, Phase 6)
--
-- Source of truth: docs/spec-data-model.md L137-220 ("Quest Catalog"). Table,
-- column, index and view definitions are copied verbatim from that section;
-- nothing here is invented.
--
-- What this file holds, and what it deliberately does not
-- -------------------------------------------------------
-- `quests` gains four columns (has_definition, link_kind, title_source,
-- reference_count). Those four `ALTER TABLE` statements are NOT in this file:
--
--   * SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; a bare
--     `ADD COLUMN` throws `duplicate column name` the second time it runs.
--   * This runner `db.exec`s every migration file on **every** `openDb()`
--     (server/src/db.ts `initSchema`), so the second open of any database would
--     throw.
--
-- So the four column adds are applied by a PRAGMA-guarded step in
-- `server/src/db.ts` (`applyQuestCatalogColumnAdds`), which reads
-- `PRAGMA table_info(quests)` and issues only the ALTERs whose column is
-- missing. It runs **before** this file, so the `coverage` view is created
-- against a complete `quests` table. The guarded step is a data-driven check,
-- not error-swallowing: a real duplicate-column error anywhere else still
-- throws loudly.
--
-- Everything below is `CREATE ... IF NOT EXISTS`, so re-running this file (which
-- the runner does on every open) is a no-op — the same idempotency rule
-- 0001_init.sql follows.
--
-- OPERATOR NOTE (p6-05's own incident, recorded so the next story does not repeat it):
-- `npm run dev` runs `tsx watch server/src/index.ts`, which watches the **source tree**.
-- Editing `server/src/db.ts` therefore restarts the app, its boot calls `openDb`, and that
-- boot applies this migration to whatever database the dev server points at — the live
-- `data/spiraldb-ui.db` when `SPIRALDB_UI_DB` is unset. A worker whose brief freezes that
-- file must either stop that watcher or accept the migration; "leave a sibling service
-- alone" is not the same as "be unaffected by it".
--
-- `quest_catalog_refs.quest_name` carries a foreign key to `quests(quest_name)`
-- with no ON DELETE clause, which is why the sync deletes the refs before it
-- replaces `quests` (see REPLACED_TABLES in server/src/services/sync/execute.ts).

-- ---------------------------------------------------------------------------
-- World evidence per quest: what referenced it, where, and the goal gate it carries.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quest_catalog_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quest_name TEXT NOT NULL REFERENCES quests(quest_name),
  wad TEXT NOT NULL,             -- WAD file path (repo-relative)
  entry TEXT NOT NULL,           -- entry name inside the WAD
  class TEXT NOT NULL,           -- the referencing object's class (e.g. 'ReqHasQuest', 'ReqHasEntry')
  goal_name TEXT,                -- the goal gate's name, when the reference carries one
  required_status TEXT,          -- that gate's m_requiredStatus, when present
  UNIQUE(quest_name, wad, entry, class, goal_name)
);

CREATE INDEX IF NOT EXISTS idx_quest_catalog_refs_quest ON quest_catalog_refs(quest_name);
CREATE INDEX IF NOT EXISTS idx_quest_catalog_refs_wad ON quest_catalog_refs(wad, entry);

-- ---------------------------------------------------------------------------
-- The second tier (P6-3): the ~4,830-quest id space the client holds text for. Never a work item.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- One definition of "how much of the catalog is built", so the UI never hard-codes a number.
--
-- `references` is a SQLite keyword (`REFERENCES`): written bare, exactly as the
-- spec block shows it, this view does not parse ("near \"references\": syntax
-- error"). It is quoted below, which keeps every column name — and therefore
-- the view's contract — byte-identical to the spec. That is the only deviation
-- from the spec's DDL text in this file.
-- ---------------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS coverage AS
SELECT
  (SELECT count(*) FROM quests)                          AS nameable,   -- catalog tier (>= 1,447 world-named)
  (SELECT count(*) FROM quest_ids)                       AS id_space,   -- second tier (~4,830 ids with text)
  (SELECT count(*) FROM quests WHERE has_definition = 1) AS defined,    -- corpus rows in the corpus under test
  (SELECT count(*) FROM quests WHERE has_definition = 0) AS missing,
  (SELECT count(*) FROM quest_catalog_refs)              AS "references";