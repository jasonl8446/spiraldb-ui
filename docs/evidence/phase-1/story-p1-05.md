# Story p1-05 — sync parsers (revision resolver, unpack runner, template parsers, `.lang` parser)

Evidence artifact for story **p1-05** (tasks **1.4b–1.4e**). Produced by an unattended agent round on branch
`phase-1-foundation`; the raw command output is reproduced in the story's final report.

Scope: `server/src/services/sync/{revision,unpack,lang,templates,corpus,json,index}.ts` + five unit suites +
`scripts/sync-dry-run.ts`. Task **1.4f** (transactional replace + `sync_history`) and **1.4g** (API +
`npm run sync`) are **not** implemented; `scripts/sync-names.ts` is still the untouched stub and no module opens
`data/spiraldb-ui.db`.

## 1. Fixtures (byte-exact copies, `sha256` verified against the source)

| Fixture | Source | sha256 |
| --- | --- | --- |
| `en-US_QuestTitle.lang` (313,632 B) | `/tmp/wad-spike/Locale/en-US/QuestTitle.lang` | `3627afd2…00ba9` |
| `npc_judge_eddie_deser.json` (2,053 B) | `/tmp/wad-spike/ObjectData/WL/WL-StandIn-JudgeEddie_deser.json` | `5e5fc498…306764` |
| `spell_pixie_deser.json` (2,631 B) | `/tmp/wad-spike/Spells/Pixie_deser.json` | `eb298cee…7d7caf` |
| `item_skullriders_start_deser.json` (1,916 B) | `/tmp/wad-spike/ObjectData/mg_skullriders_start_deser.json` | `068ef524…186814` |
| `pet_raid_accompany_deser.json` (4,154 B) | `/tmp/wad-spike/ObjectData/Raids/PL_Fortress/Raid-PL-Fortress-Accompany-001_deser.json` | `ed4ae0ad…a7e8dd` |
| `mount_object_deser.json` (1,881 B) | `/tmp/wad-spike/ObjectData/MountObject_deser.json` | `381f846f…b8dd99` |
| `quest_DS-ACAD-C01-003.json` (16,844 B) | `spiraldb/QuestTemplates/questtemplates_DS-ACAD-C01-003.json` | `dbcda73e…368bb1` |
| `droptable_ds-acad1-c01-001.json` (387 B) | `spiraldb/DropTables/droptables_ds-acad1-c01-001.json` | `96fe5d15…f88e3a` |
| `zonetransfer_10017-A.json` (2,765 B) | `spiraldb/ZoneTransfer/WizardZoneDatas_10017-A.json` | `c9dd9e26…c487b4b` |

Synthetic fixtures (not from the corpus, written by hand): `lang_sparse_index.lang` (sparse/unpadded/hex index
tokens + one three-line record), `template_mount_synthetic_deser.json` (string `m_templateID`),
`template_actor_synthetic_deser.json` (`ActorTemplate`, must be skipped), `droptable_synthetic.json`,
`zonetransfer_synthetic.json` (keeps the real empty-`Events` shape and adds a nested `m_destinationZone`),
`quest_hex_title_synthetic.json` (hex title key), `quest_trailing_comma_synthetic.json` (legacy trailing comma).
Total fixtures: 392 KB.

## 2. Measured real-data results (`scripts/sync-dry-run.ts`, `/tmp/wad-spike` + the spiraldb fork)

| Stage | Measured |
| --- | --- |
| Revision (auto) | `V_r806919.Wizard_1_610`; `Root.wad` 295,405,277 B |
| Unpack | reused `/tmp/wad-spike` (no process spawned) |
| `.lang` | 5,132 files, 25.9 MB, **206,625 numeric rows + 10,105 named rows**, 30 header-only files, 8,879 labelled records, 298 index collisions, 0 errors |
| Items | **79,835** parsed (= 79,836 template files − 1 nameless `WizItemTemplate`) |
| Spells | **17,435** parsed; 16,474 carry a numeric `template_id` |
| NPCs (flat) | **23,033** = 22,888 `WizGameObjectTemplate`/`GameObjectTemplate` + 143 pets + 2 mounts |
| Quests | 322 files → 322 rows; 315 resolved titles, 0 raw-key fallbacks, 7 without `m_questTitle` |
| Zones | 1,207 files → **1,241** distinct zone paths |
| Drop tables | 317 files → 317 rows |
| Wall clock | ≈ 3 s (tree pre-unpacked) |
| DB | `data/spiraldb-ui.db` fingerprint identical before/after — **no writes** |

Template class histogram matches D33(a) exactly (`WizItemTemplate` 76,678 + 1 nameless = 76,679,
`ItemBundleTemplate` 1,810, `ReagentItemTemplate` 867, `PetSnackItemTemplate` 478, `ItemTemplate` 2,
`SpellTemplate` 14,856, `TieredSpellTemplate` 2,579, `WizGameObjectTemplate` 15,190, `GameObjectTemplate` 7,698,
`WizPetTemplate` 143, `WizMountTemplate` 2). 2,738 files carry a class outside the friendly-name families
(largest: `WizPolymorphTemplate` 679, `SoundDefTemplate` 649, `BoosterPackTemplate` 301).

## 3. Where the measured data contradicts spike 1.4a / D33 — measured, implemented, and flagged

### 3.1 D33(e) is wrong: `QuestTitle_1ED8D` **is** present (needed D-item)

Spike 1.4a read only *all-digit* index tokens and skipped the 3,719 records whose index is written in hex, so it
saw 2,238 of the file's 5,959 records and concluded:

- `QuestTitle_1ED8D` (0x1ED8D = 126,349) does not exist → **it does**: `1ED8D` → `"Quest for Perfection"`;
- `QuestTitle_1ED8A` → "Letters of Light" → **the real value is `"Forged in Fire"`**; "Letters of Light" belongs to
  the token `126346`, i.e. index 0x126346 = 1,204,806 — the spike conflated the two.

Decimal-first lookup against a hex-keyed map also produces two **wrong** titles
(`QuestTitle_00001814` → "Billy Bones" instead of "Oh Me, Oh Minotaur"), which is why the file's index tokens and
the key suffix use the *same* D33(d) ladder. With that applied, **315 of 315** keyed corpus quests resolve (the
spike measured 48). Action: the D33(e) sentence "QuestTitle_1ED8D claimed absent; 7 no title / 18 hex / 30
decimal / 267 raw-key fallback" must be corrected to "5,959 records; 315/315 keys resolve; 7 quests carry no
`m_questTitle`".

### 3.2 A `.lang` record has **three** lines, and 79 tables are keyed by name (needed D-item)

The record shape is `{key}\r\n{middle}\r\n{value}\r\n`, not "index / blank / value":

- the middle line is empty in most tables, but is a real column elsewhere — `MobDescriptions.lang` is
  `{templateID}\r\n{mob name}\r\n{description}` with no blank lines at all (1,843 records);
- **79 tables are keyed by name, not number** (`Chat.lang` `ChannelChat`, `CharCreation.lang`
  `CLASS_ANSWER_1_A_1`, `ChooseFriendSWF.lang`, and `QuestFinder` inside `QuestTitle.lang`). A numeric-only key
  rule drops all 10,105 named rows; they are stored in their own map and `string_table.key` is TEXT, so
  `{Category}_{name}` is storable.
- 8,879 records corpus-wide carry a non-blank middle line and 298 overwrite a colliding index (e.g.
  `ZoneLocName.lang` opens with a 3-line head that repeats index 0). Both are counted, never hidden.

Layout proof (not an inference): a Wizard City tutorial quest
(`/tmp/wad-spike/Tutorials/WC-PreCel-MAIN-001_deser.json`) has goal 1 with
`m_zoneTag: "WizardCity/WC_Ravenwood"` and `m_locationName: "ZoneLocName_818957"`, and `ZoneLocName.lang` reads
`818957` → `Wizard City|Ravenwood` (the line *after* the key). Pairing the key with the preceding line would yield
a MooShu zone for a Wizard City goal. The same quest's other goal uses `ZoneLocName_595390` with the *Diego the
Duelmaster* portrait → `Wizard City|Unicorn Way`.

### 3.3 `SpellTemplate` has no numeric template id (needed D-item)

`SpellTemplate`/`TieredSpellTemplate` carry `m_name`, `m_displayName`, `m_spellBase`, `m_sMagicSchoolName` — but
**no `m_templateID` and no `m_objectName`**; `_hash` is a per-class constant, not an id. `spells.template_id`
therefore takes the string-table index inside `m_displayName` (`Spells_00000424` → 424) and each row records
`idSource: 'displayNameIndex'`. **961 spell rows (922 `SpellTemplate` + 39 `TieredSpellTemplate`) have an empty
`m_displayName` and so have no id at all** — task 1.4f must decide their key (the corpus's `m_spellID` values do
not match any WAD field, so they cannot be mapped to a template id).

### 3.4 Zone display names: the spec's prose and its example disagree (minor)

`spec-domain-reference.md` L700-702 says "converting underscores and slashes to spaces" but its example is
`WizardCity/WC_Hub` → `"Wizard City / WC Hub"`, which also requires splitting CamelCase. The example is
implemented (`humanizeZonePath`) and the prose mismatch is recorded here.

## 4. Reproduction

```bash
npm test                                  # 120 tests, 8 files
npm run lint                              # eslint + prettier --check
npx tsx scripts/sync-dry-run.ts --tree /tmp/wad-spike
```

`/tmp/wad-spike` is the spike-1.4a retained tree; when it is absent the script performs the real 17.2 s unpack and
removes the tree it created afterwards.