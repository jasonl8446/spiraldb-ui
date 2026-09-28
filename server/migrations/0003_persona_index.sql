-- SpiralDB UI — persona index (task 6.6, Phase 6)
--
-- Why this table exists
-- ---------------------
-- A dialog entry's speaker is resolved through the client's own precedence
-- (docs/spec-api.md L477-482): `m_nameOverride` → else `m_nameSTKey` composed
-- through `NPCFormats_*` against the persona's first/last components → else the
-- persona's template name via the manifest. Two of those three rungs need a
-- **request-time** fact that no synced table held:
--
--   * rung 2 needs the persona's first/last component strings, which live on the
--     persona struct (`m_persona.m_firstName` / `m_lastName`) — measured to occur
--     in 2 of the 133,937 `_deser.json` files of the Root.wad unpack, and in 0 of
--     the 6,733 NDJSON rows `wad-scan extract` emits;
--   * rung 3 needs `persona name → template id`, which only the `TemplateManifest_deser.json`
--     id space (D35) holds: the persona `WC-RAV-NPC02_Persona` is an *inline struct*, not a
--     template, so `npcs.name` cannot be reached from it by any join the database has.
--
-- This table is that missing **index** — not evidence, and not a materialised
-- evidence table (the spec forbids one: "resolved as a live join over the indexed
-- tables", L420-422). It stores only what the manifest and the tree already say,
-- and every row is rebuilt from scratch on each sync (it is in `REPLACED_TABLES`).
--
-- Columns
-- -------
-- `object_name` is the persona name with a trailing `_Persona` removed
-- (`WC-RAV-NPC02_Persona` → `WC-RAV-NPC02`). Two of the eight measured
-- manifest-missing personas are referenced *both* with and without that suffix
-- (`DS-LIB2-NPC05_Warrior5_Persona` and `DS-LIB2-NPC05_Warrior5`), so the stripped
-- form is the key that answers for both spellings — and a base name that is not in
-- the manifest stays absent, which is what makes the raw-string fallback observable
-- (p6-07-ac2).
--
-- Only object names whose template id is present in `npcs` are stored: rung 3 reads
-- `npcs.name`, so an id outside that table can answer nothing and keeping it would
-- be a row that can never fire.
--
-- Everything here is `CREATE ... IF NOT EXISTS`, so re-running this file (the
-- runner `db.exec`s every migration on every `openDb()`) is a no-op.

CREATE TABLE IF NOT EXISTS persona_index (
  object_name TEXT PRIMARY KEY,  -- persona name minus a trailing '_Persona' ('WC-RAV-NPC02')
  template_id INTEGER,           -- the manifest's id for ObjectData/**/<object_name>.xml, or NULL
  first_key TEXT,                -- the persona struct's m_firstName, as written (a string-table key)
  last_key TEXT,                 -- … m_lastName
  title_key TEXT                 -- … m_title
);

CREATE INDEX IF NOT EXISTS idx_persona_index_template ON persona_index(template_id);