-- SpiralDB UI — quest suggestions and the draft view (task 7.6, Phase 7; D129, D130, D140)
--
-- Automatic quest data is staged here as suggestions. Only a field a human accepts
-- reaches SpiralDB, through the unchanged save pipeline (D129). Nothing in this
-- table is ever read by the save pipeline as file content.
--
-- Every statement is `CREATE ... IF NOT EXISTS`: `initSchema` execs every migration
-- file on every open, so this file must be a no-op on an already-migrated database.
--
-- The table is NOT in the sync's `REPLACED_TABLES`: a sync replaces the catalog,
-- and a suggestion's decision (accepted/rejected) must survive it. There is
-- therefore no foreign key to `quests` or `quest_ids`, whose rows a sync deletes
-- and re-inserts.

CREATE TABLE IF NOT EXISTS quest_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quest_name TEXT,               -- the catalog name; NULL for an unnamed-tier id until the user names it (D137)
  catalog_id INTEGER,            -- quest_ids.quest_id when the quest has one; NULL for a named quest with no id link
  path TEXT NOT NULL,            -- document path the value fills ('m_questTitle', 'm_goals[0].m_locationName', 'm_goalLogic')
  value_json TEXT NOT NULL,      -- the proposed value, JSON-encoded
  source TEXT NOT NULL,          -- evidence-title | evidence-dialogue | evidence-goals | evidence-location |
                                 -- evidence-requirements | capture-order | capture-rewards
  confidence REAL,               -- [0, 1]; NULL when the source states none
  evidence_ref TEXT,             -- where the value came from (a capture file name, a {wad, entry}, a string-table key)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  decided_at DATETIME,           -- set when status leaves 'pending'
  CHECK (quest_name IS NOT NULL OR catalog_id IS NOT NULL)
);

-- The rebuild's identity: one row per (draft, path, source, value) whatever its status.
-- An expression index, because SQLite treats NULLs in a plain UNIQUE as distinct, which
-- would let every rebuild duplicate the unnamed tier (D140). Writes are
-- `INSERT ... ON CONFLICT DO NOTHING`, so a rejected row is never resurrected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_quest_suggestions_identity
  ON quest_suggestions(coalesce(quest_name, ''), coalesce(catalog_id, -1), path, source, value_json);
CREATE INDEX IF NOT EXISTS idx_quest_suggestions_quest ON quest_suggestions(quest_name, status);
CREATE INDEX IF NOT EXISTS idx_quest_suggestions_catalog ON quest_suggestions(catalog_id, status);

-- One row per draft: every `quests` row (named, with or without a file) plus every
-- `quest_ids` row with no `matched_quest_name` (the unnamed tier, D130).
--
-- Written as two joined branches rather than the spec's reference form (one LEFT JOIN
-- whose ON holds an OR): SQLite cannot use an index for an OR-join, and the single
-- form scanned every suggestion once per draft. The column list is the contract and
-- is unchanged; `sources` lists the sources of the draft's PENDING rows, the rows
-- the queue ranks on.
CREATE VIEW IF NOT EXISTS quest_drafts AS
SELECT q.quest_name AS quest_name,
       (SELECT min(i.quest_id) FROM quest_ids i WHERE i.matched_quest_name = q.quest_name) AS catalog_id,
       q.title AS title,
       q.has_definition AS has_definition,
       q.reference_count AS reference_count,
       coalesce(sum(s.status = 'pending'), 0)                          AS pending,
       coalesce(sum(s.status = 'accepted'), 0)                         AS accepted,
       coalesce(sum(s.status = 'rejected'), 0)                         AS rejected,
       count(DISTINCT CASE WHEN s.status = 'pending' THEN s.path END)  AS evidence_richness,
       group_concat(DISTINCT CASE WHEN s.status = 'pending' THEN s.source END) AS sources
FROM quests q
LEFT JOIN quest_suggestions s ON s.quest_name = q.quest_name
GROUP BY q.quest_name
UNION ALL
SELECT NULL,
       i.quest_id,
       i.title,
       0,
       0,
       coalesce(sum(s.status = 'pending'), 0),
       coalesce(sum(s.status = 'accepted'), 0),
       coalesce(sum(s.status = 'rejected'), 0),
       count(DISTINCT CASE WHEN s.status = 'pending' THEN s.path END),
       group_concat(DISTINCT CASE WHEN s.status = 'pending' THEN s.source END)
FROM quest_ids i
LEFT JOIN quest_suggestions s ON s.quest_name IS NULL AND s.catalog_id = i.quest_id
WHERE i.matched_quest_name IS NULL
GROUP BY i.quest_id;
