-- SpiralDB UI — breadth catalog: recipes, decks (task 6.9, Phase 6)
--
-- Zone, recipe and deck breadth
-- -----------------------------
-- Task 6.9 fills three families the phase needs and the friendly-name set never had:
--
--   * `recipes` <- `RecipeTemplate` (12,402 objects). They live in **`Recipes-WorldData.wad`**,
--     which the Root.wad unpack never touches, so they cannot come from the tree scanner; the
--     sync reads them with the same 6.2 tool under a one-wad scope.
--   * `decks`   <- `DeckTemplate` (599 objects, all of `Decks/**` in Root.wad). This is the table
--     `shared/objectTypes.ts` names as CreatureSpellbook's friendly source.
--   * `zones`   is **not altered here** — it is reconciled row-wise by the sync (the WizZoneData
--     `m_zoneName`/`m_zoneDisplayName` values replace the D21 humanised corpus fallback, while a
--     corpus path the new source does not cover is kept). `zone_path` stays the primary key.
--
-- ## Id provenance (D35) is a column, not the key's spelling
--
-- Both new tables are keyed by the **manifest id** (`TemplateManifest_deser.json`'s `m_id` for
-- the object's source file), exactly as `items`/`spells`/`npcs` are. Neither `RecipeTemplate` nor
-- `DeckTemplate` carries an `m_templateID` — measured 0 of 12,402 and 0 of 599 — so without the
-- manifest a row has no id at all and the manifest lookup is not a nicety, it is the identity.
-- `source_path` keeps the manifest spelling of the file the row came from, so an id can always be
-- traced back to a file.
--
-- `decks.deck_name` is the object's `m_name`: the technical value `CreatureSpellbook.DeckName`
-- holds (`DeckName` is a string, not a number, which is why this table has a second key column
-- that `items`/`spells`/`npcs` do not need), and `decks.name` is the label the list row pairs it
-- with.
--
-- ## Idempotency
--
-- Everything here is `CREATE ... IF NOT EXISTS`, so re-running this file (the runner
-- `db.exec`s every migration file on **every** `openDb()` — see 0002_quest_catalog.sql's note)
-- is a no-op. No `ALTER TABLE` is needed, so no `PRAGMA`-guarded step is required either.
--
-- OPERATOR NOTE (p6-05's incident, unchanged here): `npm run dev` runs `tsx watch`, so editing
-- `server/src/db.ts` restarts the app and its boot applies this migration to whatever database
-- that process points at — the live `data/spiraldb-ui.db` when `SPIRALDB_UI_DB` is unset. Stop
-- the watcher first if the database is frozen for a story.

-- ---------------------------------------------------------------------------
-- Recipes: `RecipeTemplate` objects, keyed by the D35 manifest id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recipes (
  template_id INTEGER PRIMARY KEY,  -- TemplateManifest m_id for source_path
  name TEXT NOT NULL,               -- resolved m_displayKey, else the raw key, else m_recipeName
  source_path TEXT NOT NULL         -- manifest spelling, e.g. '|Recipes|WorldData|ObjectData/…xml'
);

-- ---------------------------------------------------------------------------
-- Decks: `DeckTemplate` objects, keyed by the D35 manifest id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS decks (
  template_id INTEGER PRIMARY KEY,  -- TemplateManifest m_id for source_path
  deck_name TEXT NOT NULL UNIQUE,   -- the object's m_name — the technical value DeckName holds
  name TEXT NOT NULL,               -- the label paired with deck_name
  source_path TEXT NOT NULL         -- manifest spelling, e.g. 'Decks/Battlegrounds/…xml'
);

-- The lookup the object list and the search arm perform is by `deck_name`, not by the primary key.
CREATE INDEX IF NOT EXISTS idx_decks_deck_name ON decks(deck_name);