-- SpiralDB UI — initial schema (task 1.2)
--
-- Source of truth: docs/spec-data-model.md L21-162 (SQLite Schema).
-- Column names, types, defaults and the UNIQUE constraint are copied verbatim
-- from the spec; nothing here is invented.
--
-- Idempotent by requirement: every statement is IF NOT EXISTS, so re-running
-- this file against an existing database is a no-op (no duplicate tables, no
-- duplicate indexes). Seeding of `settings` is NOT done here — `seedSettings()`
-- in server/src/db.ts writes the defaults only when the table is empty.

-- ---------------------------------------------------------------------------
-- Verification status (all SpiralDB object types)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entry_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Identifies the entry
  object_type TEXT NOT NULL,        -- 'quest', 'drop_table', 'npc_inventory',
                                    -- 'creature_spellbook', 'npc_spell_inventory',
                                    -- 'npc_drop_table', 'treasure_card_inventory',
                                    -- 'zone_transfer'
  object_key TEXT NOT NULL,         -- Quest: m_questName, DropTable: Name,
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
CREATE INDEX IF NOT EXISTS idx_entry_status_type ON entry_status(object_type);
CREATE INDEX IF NOT EXISTS idx_entry_status_status ON entry_status(status);
CREATE INDEX IF NOT EXISTS idx_entry_status_key ON entry_status(object_type, object_key);

-- ---------------------------------------------------------------------------
-- Status change history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_status_id INTEGER NOT NULL REFERENCES entry_status(id),

  old_status TEXT,
  new_status TEXT NOT NULL,
  notes TEXT,                        -- Optional free-text notes
  changed_by TEXT,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- Friendly name tables
-- ---------------------------------------------------------------------------
-- Items (from ItemTemplate)
CREATE TABLE IF NOT EXISTS items (
  gid INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,           -- Optional: equipment, consumable, etc.
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Spells (from SpellTemplate)
CREATE TABLE IF NOT EXISTS spells (
  template_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  school TEXT,             -- Fire, Ice, Storm, etc.
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- NPCs (from ActorTemplate)
CREATE TABLE IF NOT EXISTS npcs (
  template_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  npc_type TEXT,           -- Vendor, Trainer, Quest Giver, etc.
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Quests (from QuestTemplate)
CREATE TABLE IF NOT EXISTS quests (
  quest_name TEXT PRIMARY KEY,  -- e.g., "DS-ACAD-C01-001"
  title TEXT NOT NULL,          -- Human-readable title from string table
  level INTEGER,
  is_mainline BOOLEAN,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Zones (from zone files)
CREATE TABLE IF NOT EXISTS zones (
  zone_path TEXT PRIMARY KEY,   -- e.g., "WizardCity/WC_Hub"
  display_name TEXT NOT NULL,
  world TEXT,                   -- WizardCity, Krokotopia, etc.
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Drop Tables (already human-readable, but track for validation)
CREATE TABLE IF NOT EXISTS drop_tables (
  name TEXT PRIMARY KEY,
  description TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- String table entries (from .lang files)
CREATE TABLE IF NOT EXISTS string_table (
  key TEXT PRIMARY KEY,       -- e.g., "QuestTitle_0001ED8D"
  value TEXT NOT NULL,        -- e.g., "The Bear Truth"
  category TEXT NOT NULL,     -- e.g., "QuestTitle"
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- Sync metadata
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_history (
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

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Keys: aurorium_path, imcodec_path, user_name, spiraldb_path, git_branch