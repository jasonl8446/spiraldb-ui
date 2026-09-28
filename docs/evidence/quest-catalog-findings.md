# Evidence — what the Wizard101 game files contain (and what they do not)

Measured 2026-09-28 against the Aurorium revision on this machine:

| Input | Path |
|---|---|
| Game files | `/home/jason/Documents/git-projects/Aurorium/data/V_r806919.Wizard_1_610/Data/GameData` (3,589 `*.wad`, 19 GB) |
| Class inventory + hashes | `/home/jason/Documents/git-projects/Imview/submodule/Imcodec/src/Imcodec.ObjectProperty/GeneratorInput/ClientDump.json` |
| Corpus | `/home/jason/Documents/git-projects/spiraldb` (328 quest templates, 317 drop tables) |
| Local database | `data/spiraldb-ui.db` (216,991 string-table rows) |

This document supports the one claim in [plan-phase-6-quest-catalog.md](../plan-phase-6-quest-catalog.md) that would
otherwise read as an excuse: **the client game files do not contain quest definitions.** If that were wrong the plan's
whole shape would be wrong, so it is measured three ways, each paired with what would falsify it.

It also records the measurements that *do* justify the phase — how much quest material the client actually ships.

## Reproduction

```bash
# 1. Exact class census (index-only). Add --hashes to scan whole payloads, and
#    --negative-control to prove the scan's false-positive floor rather than assume it.
node scripts/wad-census.mjs \
  --gamedata /home/jason/Documents/git-projects/Aurorium/data/V_r806919.Wizard_1_610/Data/GameData \
  --classes /home/jason/Documents/git-projects/Imview/submodule/Imcodec/src/Imcodec.ObjectProperty/GeneratorInput/ClientDump.json

# 2. Payload scan for the quest-reference classes, with per-hit provenance.
node scripts/wad-census.mjs --gamedata <dir> --classes <ClientDump.json> \
  --hashes 1110485234,37594247,858568024 --json /tmp/census.json

# 3. Recover the flagged entries for a follow-up extraction.
node -e "const d=require('/tmp/census.json'); console.log(d.hitsByEntry.ReqHasQuest.map(h=>h.wad+'\t'+h.entry).join('\n'))" > /tmp/flagged.tsv
#    Then deserialize each with `imcodec op file`. Measured: 78 s per 400 files at -P8,
#    i.e. ~22 min for the 6,733 zone-data files — the cost that motivates task 6.2.
```

Runtime (single-threaded): ~25 s for the census, ~27 s with the payload scan.

## Measurement 1 — exact class census

Every one of the 550,616 WAD entries is read, and every object-property payload is classified by the class hash at
its **fixed** header offset. There is no substring search, so there are no false positives.

Two header shapes exist, and a census must handle both:

| Shape | Layout | Example |
|---|---|---|
| A | `42 49 4e 64` ("BINd") + flags(4) + classHash(4) | `BansheeTemplate.xml`, `Tutorials/*.xml` |
| B | classHash(4) + … | every zone's `gamedata.bin` (`WizZoneData`) |

Handling only shape A undercounts `WizZoneData` **21 instead of 3,356** — a 160× error, and exactly the error that
would have hidden the zone data this phase depends on.

**Result: 183,676 object-property objects in 142 classes.**

```
wads: 3589
object entries: shape A (BINd) 176943 in 140 classes; shape B (bare) 6733 in 2 classes
```

Quest-relevant rows only: `TutorialQuestTemplate` 11, `DailyQuestData` 1, `DailyQuestRewardData` 1, `DailyPvPData`
1. **`QuestTemplate` appears zero times.**

The full 142-class table is reproduced by the command above. The families this phase depends on:

| Class | Objects | Note |
|---|---|---|
| `WizItemTemplate` | 76,679 | with `ItemBundleTemplate` 1,810, `ReagentItemTemplate` 867, `PetSnackItemTemplate` 478, `ItemTemplate` 2 → **79,836** item objects |
| `SpellTemplate` + 6 siblings | 18,173 | already synced |
| `RecipeTemplate` | 12,402 | not extracted today |
| `WizZoneData` | 3,377 | 3,356 shape B + 21 shape A |
| `TutorialQuestTemplate` | 11 | the only quest documents in the client |
| `CharacterRaceTable` | 3,065 | NPC/mob source |

**Falsified by:** any WAD entry whose class hash is `276946680`. One such file would overturn the conclusion.

**Known limit:** 14 of the 142 classes (10,274 objects) are not named by `ClientDump.json` — see *Unresolved
classes*. Classification is by hash, so this does not weaken the result: `QuestTemplate`'s hash is compared
numerically, not by name.

## Measurement 2 — payload hash scan

A container object could hold quests *nested* rather than as its own file. Nested objects do carry their class hash
inline — proven within this same corpus, not assumed: `ReqHasQuest` (`1110485234`) occurs 504 times inside zone
payloads, and those files deserialize into requirement objects carrying `m_questName`.

So the scan searches the whole decompressed payload of every object-property entry (`xml, bin, gui, ttip, lua, json,
dat, txt, npc, skel`). Media cannot hold an object-property hash, and `.bcd` is excluded deliberately: a `.bcd`
payload is Binary Collision Data (geometry, read by a different deserializer), so a hash match there is float noise,
not an object.

```
payload scan: 199382 data entries, 0.603 GB searched
  ReqHasEntry: 1014
  ReqHasQuest: 504
  ReqIsQuest: 23
  negative control (100 non-class hashes): 0 hits
```

`QuestTemplate`: **0**. So did `QuestCompilation`, `QuestData`, `WizQuestData`, `QuestEntry`,
`AvailableQuestEntry`, `WizItemQuestData` — the other classes that could carry definitions.

### The control, and two mistakes worth recording

A four-byte substring search can never be read without a control: a true occurrence and a coincidence are both "four
matching bytes". Getting the control right took two corrections — the first did not change the number but was needed
to interpret it, the second changed both:

1. **Unconstrained 20-hash control: 13 hits.** All 13 came from one hash, `0xfcfaadbf` (`4244286911`), which is
   neither a class nor a property in `ClientDump.json` — the control had landed on a value that genuinely occurs in
   the data.
2. **Non-zero-byte control (every real class hash has four non-zero bytes): still 13 hits.** All inside
   `collision.bcd` payloads, where any four bytes are plausible.
3. **Non-zero bytes *and* the object-property domain: 0 hits across 100 hashes.**

Against that floor, `ReqHasQuest` at 504 and `ReqHasEntry` at 1,014 are real, and `QuestTemplate` at 0 is absence
rather than a miss.

**Falsified by:** any nested `QuestTemplate` hash in an object-property payload, or a control set that still produces
hits once the domain is corrected.

## Measurement 3 — what the world says about quests

Objects carrying a quest reference name `m_questName` on two classes (`ReqHasQuest`, `ReqHasEntry`) — the same two
the repo's own validation engine declares ([validation.ts](../shared/quest/validation.ts) L452-457); `ReqIsQuest`
carries it too. The union of files bearing any of them:

| Location | Files |
|---|---|
| `triggers.xml` | 336 |
| `gamedata.bin` | 313 |
| `ObjectData/**/*.xml` | 288 |
| `TutorialTips/**` | 213 |
| `Maps/*.xml` | 14 |
| `Tutorials/*.xml` | 10 |
| `gamedata.xml`, `GameEffectData` | 3 |
| **Total** | **1,177** across **500** WADs |

All 6,733 zone-data documents (`gamedata.bin` 3,356 + `triggers.xml` 3,377; 48.7 MB raw, extracted in 0.74 s) were
then deserialized in full. Field inventory across them:

| Field | Non-null | Null/empty |
|---|---|---|
| `m_questName` | 2,380 | 1,445 |
| `m_goalName` | 1,605 | 0 |
| `m_requiredStatus` | 1,605 | 0 |
| `m_isQuestRegistry` | 1,451 | 0 |
| `m_quest` | 87 | 941 |
| `m_destinationZone` | **0** | 4,967 |
| `m_locationName` | 0 | 0 (absent) |

**1,447 distinct quest names** are referenced. Two corrections this measurement forced:

- **`m_destinationZone` and `m_locationName` carry no values.** An earlier count of "737 `m_destinationZone`" counted
  *key presence*; the keys are present and always null. Destination zones and location names are therefore **not**
  recoverable from world data, and earlier plan text that promised to pair them was wrong.
- **`ReqHasEntry` is not a quest reference on its own.** It doubles as the global-registry check (`m_entryName:
  "Halloween"`, `m_questName: ""`), so only rows with a non-empty `m_questName` count.

### How a name links to a quest id

`m_entryName` (`<QuestName>_Complete`) paired with `m_displayName` (`QuestTitle_<hex>`) is the **only** direct
name→id path found, covering **286 of 1,447 names (20%)**. Two alternative paths were tested and are dead ends:

- no object carries a quest name and a `WizQst<id>_*` value together (0 pairs);
- per-quest tables contain dialogue and goal text, never the quest's own name.

**Interpolation works instead.** Within a quest group, ids are frequently contiguous and ordered with the name:
51/59 groups ascend with name order, 38/59 are fully contiguous. A hold-out test on the 321 known `(name, id)` pairs
— hold out a middle quest, interpolate from its neighbours — scores **78% (128 hit / 37 miss)**. The misses are
outliers that also pollute their anchors, which is why the accept rule in the plan requires the candidate id to have
both a `QuestTitle_*` key and a non-empty `WizQst` table.

## Measurement 4 — the client's quest material

The client ships the quest text corpus, and the local database already imports it:

| Source | Size |
|---|---|
| `QuestTitle_*` keys | 5,959 (4,780 non-empty) |
| `WizQst<id>_*` per-quest tables | **4,830 tables, 66,203 rows** (median 10/quest; 2,447 with ≥10) |
| `WizardQuestGoals` / `WizardQuests` | 854 / 788 rows |
| `string_table` total | 216,991 rows across 5,102 categories |

**A quest's own table holds its dialogue too.** For `WC-CYCLOPS-MAIN-002`, an `NPCDialogEntry` carries
`m_dialog: "WizQst17318F_00000006"` — a key in that quest's own table. Measured: **308 of 315** corpus quests have
their `m_dialog` keys inside their own `WizQst` table.

Across those 308 quests: **2,602 text rows available, 1,303 used by the shipped definitions — 1,301 unused (~50%)**,
median 7 rows per quest, max 39. The unused half is the raw material an author draws on.

**Speakers resolve.** `m_personaName` (`WC-RAV-NPC02_Persona`) resolves to a template id by stripping `_Persona` and
looking the object name up in the Root.wad manifest — 280 of 288 corpus personas (**97%**), using the manifest the
sync already loads (D35). The 8 misses are zone-NPC personas whose objects live outside Root.wad.

## Measurement 5 — how an NPC name is actually stored

`npcs.name` looks like a roster and is not one. The table is a flat list of 23,033 **client object templates** with no
type classification (D33): the low ids are engine objects — `Player Object`, `PetObject`, `MountObject`,
`Summoned Creature`, `GenericCinematicActor`, `AcousticsTemplate`, `Basic Positional` — and the NPC ids hold real
names. For the corpus's dialog personas the distinction is clean: **146 of 150 personas resolve** through the Root.wad
manifest to a template id, and **none** of those resolves to an engine object.

| Persona | Template id | `npcs.name` |
|---|---|---|
| `WC-HUB-NPC01_Persona` | 38168 | Merle Ambrose |
| `DS-ACAD1-NPC01_Persona` | 126322 | Zarek Pickmaster |
| `DS-NEC1-NPC01_Persona` | 126312 | Castamir Silverdrake |
| `DS-ACAD2-NPC03_Persona` | 126334 | Father Drake |
| `DS-LIB-NPC01_Persona` | 126293 | Milos Bookwyrm |

But the name the corpus actually *references* is usually not that string at all:

| Source | Rows in `string_table` | Corpus references |
|---|---|---|
| `WC-NPCs` | 2,641 | **1,733** |
| `NPCs` | 2,450 | 7 |
| `WizardNPC` | 1,237 | 2 |
| `Persona,First` / `Persona,Last` | 78 / 57 | 22 each |

`m_nameOverride` stores a **key**, never literal text — 99 corpus entries across 20 distinct keys, e.g.
`WC-NPCs_00000027` (×28), `WC-NPCs_00000030` (×17).

And **a speaker's name is usually composed rather than stored**: of 1,881 corpus dialog entries, 1,774 (94%) carry
`m_nameSTKey` — `NPCFormats_First_Last` (1,449) or `NPCFormats_First_Only` (325) — whose formats are literal
composition templates:

```
NPCFormats_First_Last        = #1:$NPC_FIRSTNAME$ #2:$NPC_LASTNAME$
NPCFormats_First_Last_Title  = #1:$NPC_FIRSTNAME$ #2:$NPC_LASTNAME$ #3:$NPC_TITLE$
```

Only 99 entries set a name override, 1,054 (56%) carry a free-text `m_cameraName` (`Cinematic Camera - Cyrus Drake`,
a display hint, not a name), and 1,878 (99.8%) carry a portrait path.

**Consequence for the plan.** One NPC legitimately has several name strings at different granularities —
`WC-NPCs_00000003 = "Gretta Darkkettle"` and `WC-NPCs_00000009 = "Gretta"` are the same NPC, and a composed entry
yields "Merle Ambrose" where a first-only entry yields "Merle". Any name namespace must therefore be keyed on the
**NPC**, with those strings as aliases; keying on the string would turn one NPC into four entities and make a search
for "Gretta" return duplicates.

## Unresolved classes

14 class hashes (10,274 objects) are neither classes nor properties in `ClientDump.json` (6,754 classes):

| Hash | Objects |
|---|---|
| `0x06daac43`, `0x1b6ef770`, `0x3cdbe781` | 3,377 each |
| `0x525dfd8b` | 132 |
| `0x217d4c2e` | 2 |
| 9 others | 1 each |

Three at exactly 3,377 — the same count as `CompassSystem`, `PathManager::PathTemplateList` and
`PathManager::NodeTemplateList` — point at map/path infrastructure, but that is inference, not proof. The claim that
no quest class hides here rests on the hash comparison (`QuestTemplate`'s hash is known), not on these being named.
Task 6.9 resolves them or records explicitly that they remain unknown.

## Current database state

`data/spiraldb-ui.db`, read-only:

| Table | Rows | Source |
|---|---|---|
| `quests` | 328 | SpiralDB corpus |
| `drop_tables` | 317 | SpiralDB corpus |
| `items` | 79,835 | Root.wad, manifest-keyed (D35) |
| `spells` | 18,173 | Root.wad |
| `npcs` | 23,033 | Root.wad |
| `zones` | 1,241 | corpus-derived (D21) |
| `string_table` | 216,991 | Root.wad `Locale/en-US/*.lang` |

The 317 figure that prompted this work is the **`drop_tables`** count; `quests` is 328. Both are corpus-derived.

## What would change the plan

| If this were true | Then |
|---|---|
| A WAD holds `QuestTemplate` objects (any shape, nested or not) | The plan collapses to a bulk WAD extract. |
| `m_destinationZone` is populated in another revision or file family | Goal scaffolding gains a field it currently cannot fill. |
| A revision other than `V_r806919.Wizard_1_610` ships quest documents | Re-run the census against it first; the script takes a `--gamedata` path. |
| `ClientDump.json` is unavailable | The census still works (hashes compare numerically); class names degrade to numbers. |
| The `ReqHasQuest`/`ReqHasEntry` hits are coincidences | They are not: 504 and 1,014 occurrences against a measured control floor of **0 hits in 100 hashes**, and the files deserialize into objects with `m_questName`. |