# Spike 1.4a — `imcodec wad unpack --deser` against the real Root.wad

Evidence artifact for task **1.4a** (see [plan-phase-1-foundation.md](../../plan-phase-1-foundation.md) §1.4a).
Tasks **1.4b–1.4e** read this instead of re-running the spike. Produced by an unattended agent round on branch
`phase-1-foundation`.

**Bottom line:** `--deser` works and produces usable JSON for **all five** template families — no fallback needed
for the sync pipeline. But three spec assumptions are wrong in the real data and would have silently broken the
parsers:

1. **Template files are named after their content, not their type.** `ItemTemplate`/`SpellTemplate`/`ActorTemplate`
   never appear in a path. The type is the JSON field `_className`.
2. **`m_name` is not universal.** Only `SpellTemplate` has it. Every object-derived template
   (`WizItemTemplate`, `WizGameObjectTemplate`, `GameObjectTemplate`, `WizPetTemplate`, `WizMountTemplate`) instead
   carries `m_objectName` + `m_templateID` + `m_displayName`.
3. **The real friendly-name path is `m_displayName` → `Locale/en-US/{Category}.lang`**, not `m_name`. This resolves
   at ~100% for items/NPCs/pets and ~90% for spells (measured below). The spec's `m_name` field list
   ([spec-domain-reference.md](../../spec-domain-reference.md) L654–660) describes only the spell family.

Additionally, the spec's worked example `QuestTitle_1ED8D → 126349`
([spec-domain-reference.md](../../spec-domain-reference.md) L687–691) **does not resolve in this revision** — that
index does not exist in any `.lang` file here. The *mechanism* is sound and was verified with real in-range keys;
the raw-key fallback is the common path for quest titles.

---

## 1. Command + environment

```bash
# Prebuilt CLI (decision D3 — no .NET build)
CLI=/home/jason/Documents/git-projects/Imview/submodule/Imcodec/src/Imcodec.Cli/bin/Debug/net9.0/linux-x64/imcodec
WAD=/home/jason/Documents/git-projects/Aurorium/data/V_r806919.Wizard_1_610/Data/GameData/Root.wad

mkdir -p /tmp/wad-spike
{ time "$CLI" wad unpack --deser "$WAD" /tmp/wad-spike ; echo "EXIT_STATUS=$?" ; } > /tmp/wad-spike-unpack.log 2>&1
```

| Item | Value |
|---|---|
| CLI | `imcodec` (Imcodec.Cli `1.0.0.0`, `bin/Debug/net9.0/linux-x64`) |
| WAD | `/home/jason/Documents/git-projects/Aurorium/data/V_r806919.Wizard_1_610/Data/GameData/Root.wad` |
| WAD size | `295,405,277` bytes (282 MB) |
| Output dir | `/tmp/wad-spike` (kept for later rounds) |
| Host | NixOS, 24 vCPU, 62 GB RAM, 2.8 TB free on `/` |

Raw log (complete file — 4 lines):

```
Successfully extracted 'Root.wad' to '/tmp/wad-spike'.
REAL=17.233 USER=14.717 SYS=4.295
EXIT_STATUS=0
WALL_MS=17235
```

> `/usr/bin/time -v` is **not installed** on this host; bash's `time` with
> `TIMEFORMAT='REAL=%3R USER=%3U SYS=%3S'` was used instead. Note bash reports `REAL` as
> `3` significant digits here, so wall-clock is also cross-checked with `date +%s%3N`:
> `WALL_MS=17235` → **17.235 s**.

---

## 2. Wall-clock time

**17.2 s** for `--deser` (exit status `0`).

This confirms [spec-data-model.md](../../spec-data-model.md) L281 ("seconds, not minutes") and means a full
re-sync can safely unpack from scratch every run — no need to cache the unpack tree across syncs (though 1.4c
should still unpack to `os.tmpdir()` and clean up in `finally`).

For comparison, a **raw** unpack (no `--deser`) of the same WAD took **9.554 s** (`REAL=9.554`,
`EXIT_STATUS=0`) — deserialization roughly doubles the time.

---

## 3. Output tree shape

`du -sh /tmp/wad-spike` → **`1.5G`** (block usage); `du -sb` → `1,154,640,030` bytes apparent.

| Metric | Value |
|---|---|
| Files | **173,088** |
| Directories | 1,837 |
| Top-level entries | 44 dirs + 3,160 files |
| `*_deser.json` files | **133,937** |

Extension histogram (top 25; `find -type f -printf '%f\n' | awk`):

```
  133937  json
   33932  lang
    2865  dds
     564  ttip
     483  kf
     478  xml
     304  nif
     158  lua
     136  mp3
      93  wav
      42  gui
      39  kfm
      17  tga
      13  ogg
      10  png
       8  txt
       5  cur
       2  bmp
       1  nav
       1  dat
```

Top-level directory shape (`find -maxdepth 3 -type d`, first 50) — the tree is **deep but mixed**: templates are
nested under `ObjectData/`, `Spells/`, `Sigils/`, `Wands/`, etc., while locales are under `Locale/`:

```
/tmp/wad-spike
/tmp/wad-spike/Sigils
/tmp/wad-spike/Sigils/Mirage
/tmp/wad-spike/Sigils/Empyrea
/tmp/wad-spike/Wands
/tmp/wad-spike/AnimationData
/tmp/wad-spike/SpellFusions
/tmp/wad-spike/Messages
/tmp/wad-spike/Skyboxes
/tmp/wad-spike/Sound
/tmp/wad-spike/Sound/GUI
/tmp/wad-spike/Sound/Combat
/tmp/wad-spike/Sound/Ambient
/tmp/wad-spike/StateData
/tmp/wad-spike/StateData/AQ
/tmp/wad-spike/StateData/Gauntlet_Library
...
```

The **original WAD path is preserved inside the JSON** as `_fileName` (e.g.
`"ObjectData/WL/WL-StandIn-JudgeEddie.xml"`), which is more reliable than the on-disk path for provenance.

### Deserialized file envelope

Every successfully deserialized file is `{original-basename-without-ext}_deser.json` and has this shape
(`_object` is the payload):

```json
{
  "_fileName": "ObjectData/WL/WL-StandIn-JudgeEddie.xml",
  "_flags": 7,
  "_className": "WizGameObjectTemplate",
  "_hash": 701229577,
  "_deserializedOn": "2026-09-25 21:55:43",
  "_imcodecVersion": "1.0.0.0",
  "_object": { "m_objectName": "...", "m_templateID": 1608380, ... }
}
```

Confirmed in `Imcodec.Cli/Deserialization.cs` (`DeserializedObjectInfo`, suffix `_deser.json`) and
`ArchiveCommands.cs` (`s_deserExtIncludeList = ["xml", "bin", "bcd"]`). **Consequence: `.lang` files are never
deserialized** — they are written verbatim, which is what the 1.4e parser needs.

---

## 4. Template families — locations, counts, formats

**Method.** `_className` is the only reliable type discriminator. A single pass over the tree
(`grep -rh -m1 --include='*_deser.json' '"_className"'`) yields an on-disk-path → class map; 112 distinct classes
were found. Family counts below are exact.

### Mapping from the plan's family names to real `_className` values

| Plan family ([plan §1.4d](../../plan-phase-1-foundation.md)) | Real `_className` (count) | On-disk location |
|---|---|---|
| **ItemTemplate** | `WizItemTemplate` (**76,679**), `ItemBundleTemplate` (1,810), `ReagentItemTemplate` (867), `PetSnackItemTemplate` (478), `ItemTemplate` (2) | `ObjectData/**/*_deser.json` |
| **SpellTemplate** | `SpellTemplate` (**14,856**), `TieredSpellTemplate` (2,579) | `Spells/**/*_deser.json` |
| **ActorTemplate** | ⚠️ **no class named `ActorTemplate` exists.** The actor/NPC analogue is `WizGameObjectTemplate` (**15,190**) + `GameObjectTemplate` (7,698); the only literal "actor" classes are `WizCinematicActorTemplate` (85) and `CinematicActorTemplate` (1), which are cut-scene actors, not NPCs | `ObjectData/**/*_deser.json` |
| **PetTemplate** | `WizPetTemplate` (**143**) | `ObjectData/**/*_deser.json` (incl. `ObjectData/Raids/**`) |
| **MountTemplate** | `WizMountTemplate` (**2**) | `ObjectData/MountObject_deser.json`, `ObjectData/MountObjectFloating_deser.json` |

Full `_className` histogram (top 40 of 112) is reproduced in §9; the extension of this list matters because
`items` is a family of subclasses, not one class.

### Name fields actually present (the key correction)

| Class | Friendly-name field | Numeric ID field | Internal-name field |
|---|---|---|---|
| `SpellTemplate` | **`m_name`** (present) + `m_displayName` | — (no `m_templateID`) | `m_spellBase` |
| `WizItemTemplate` | `m_displayName` | `m_templateID` | `m_objectName` |
| `WizGameObjectTemplate` | `m_displayName` | `m_templateID` | `m_objectName` |
| `GameObjectTemplate` | `m_displayName` | `m_templateID` | `m_objectName` |
| `WizPetTemplate` | `m_displayName` | `m_templateID` | `m_objectName` |
| `WizMountTemplate` | `m_displayName` | `m_templateID` | `m_objectName` |

Grepped directly — `SpellTemplate` is the **only** family with a `m_name` line:

```
=== WizItemTemplate : ObjectData/mg_skullriders_start_deser.json
   (no m_name line)
=== SpellTemplate : Spells/NA KM-Prawn-Cabalist-C-01_deser.json
    "m_name": "NA KM-Prawn-Cabalist-C-01",
=== WizGameObjectTemplate : ObjectData/Minion-Balance-Gorgon-01_deser.json
   (no m_name line)
=== GameObjectTemplate : ObjectData/LMHouse-LadderDOWN_deser.json
   (no m_name line)
=== WizPetTemplate : ObjectData/Raids/PL_Fortress/Raid-PL-Fortress-Accompany-001_deser.json
   (no m_name line)
=== WizMountTemplate : ObjectData/MountObject_deser.json
   (no m_name line)
```

### `head -c 600` per family

`WizItemTemplate` (`ObjectData/mg_skullriders_start_deser.json`):

```json
{
  "_fileName": "ObjectData/mg_skullriders_start.xml",
  "_flags": 7,
  "_className": "WizItemTemplate",
  "_hash": 991922385,
  "_deserializedOn": "2026-09-25 21:55:44",
  "_imcodecVersion": "1.0.0.0",
  "_object": {
    "m_numPrimaryColors": 0,
    "m_numSecondaryColors": 0,
    "m_numPatterns": 0,
    "m_school": "",
    "m_arenaPointCost": 0,
    ...
    "m_objectName": "mg_skullriders_start",
    "m_templateID": 107071,
```

`SpellTemplate` (`Spells/NA KM-Prawn-Cabalist-C-01_deser.json`):

```json
{
  "_fileName": "Spells/NA KM-Prawn-Cabalist-C-01.xml",
  "_flags": 7,
  "_className": "SpellTemplate",
  ...
  "_object": {
    "m_name": "NA KM-Prawn-Cabalist-C-01",
    "m_description": "Spell_MOB Natural Attacks",
    "m_advancedDescription": "",
    "m_displayName": "Spells_00000347",
    "m_spellBase": "NA KM-Prawn-Cabalist-C-01",
```

`WizGameObjectTemplate` (`ObjectData/Minion-Balance-Gorgon-01_deser.json`) — the NPC family:

```json
{
  "_fileName": "ObjectData/Minion-Balance-Gorgon-01.xml",
  "_className": "WizGameObjectTemplate",
  ...
  "_object": {
    "m_deathSound": "|Mob|WorldData|Sound/MOB_OphidianHunter_Death.mp3",
    "m_primarySchoolName": "Balance",
    "m_objectName": "Mi...
```

…whose name fields are:

```
    "m_objectName": "Minion-Balance-Gorgon-01",
    "m_templateID": 1528571,
    "m_displayName": "Mobs_00000129",
```

`WizPetTemplate` (`ObjectData/Raids/PL_Fortress/Raid-PL-Fortress-Accompany-001_deser.json`):

```json
{
  "_fileName": "ObjectData/Raids/PL_Fortress/Raid-PL-Fortress-Accompany-001.xml",
  "_className": "WizPetTemplate",
  ...
  "_object": {
    ...
    "m_objectName": "Raid-PL-Fortress-Accompany-001",
    "m_templateID": 1624035,
    "m_displayName": "WizardMobs_00004586",
```

`WizMountTemplate` (`ObjectData/MountObject_deser.json`):

```json
{
  "_fileName": "ObjectData/MountObject.xml",
  "_className": "WizMountTemplate",
  "_hash": 1259413685,
  "_object": {
    "m_lootTable": [],
    ...
    "m_objectName": "MountObject",
    "m_templateID": 3,
    "m_visualID": 0,
```

### Empty-name rate (drives the fallback path in 1.4d)

Counted with `grep -rl '^    "m_displayName": ""'` intersected with the class map:

| Class | Total | Empty `m_displayName` | Resolvable |
|---|---|---|---|
| `WizItemTemplate` | 76,679 | 6,489 (**8.5 %**) | 70,190 |
| `WizGameObjectTemplate` | 15,190 | 1,891 (**12.4 %**) | 13,299 |
| `GameObjectTemplate` | 7,698 | 4,876 (**63.3 %**) | 2,822 |
| `SpellTemplate` | 14,856 | 146 (**1.0 %**) | 14,710 |
| `WizPetTemplate` | 143 | 16 (**11.2 %**) | 127 |

`GameObjectTemplate` being mostly nameless is expected — it is scenery/props (ladders, pedestals), not named
entities. For those, 1.4d should fall back to `m_objectName`.

---

## 5. `.lang` files

### Location and count (spec discrepancy)

Spec ([L666–671](../../spec-domain-reference.md)) says "~5,132 `.lang` files". **Measured: 33,932 total across 8
locale directories, of which exactly 5,132 are in `Locale/en-US/`.** So the spec's number is right for `en-US`
only; the parser must scope to `Locale/en-US` (not glob all `*.lang`).

```
$ find /tmp/wad-spike -name '*.lang' | wc -l
33932
$ for d in Locale/*/; do printf "%8d  %s\n" "$(find "$d" -name '*.lang' | wc -l)" "$d"; done
    5098  Locale/de/
    4417  Locale/el/
    5132  Locale/en-US/
    5098  Locale/es/
    5097  Locale/fr/
       3  Locale/gr/
    4529  Locale/it/
    4558  Locale/pl/
```

Sizes: `Locale/en-US` = **25.9 MB** (27,195,796 bytes) across 5,132 files; all locales = 185.5 MB.

File naming varies: most categories are one file per category (`Items.lang`, `QuestTitle.lang`, `Mobs.lang`), but
4,849 of the 5,132 are per-key `WizQst*.lang` files, most of which are header-only. Only **22** en-US files are
≤30 bytes (header-only); 4,306 are 1 KB–100 KB and 28 are ≥100 KB. Largest: `Items.lang` (2,260,058 bytes).

### Byte-level format

`xxd` head of `Locale/en-US/QuestTitle.lang` (the committed fixture):

```
00000000: fffe 3100 3a00 5100 7500 6500 7300 7400  ..1.:Q.u.e.s.t.
00000010: 5400 6900 7400 6c00 6500 0d00 0a00 3000  T.i.t.l.e.....0.
00000020: 3000 3000 3000 3000 3000 3000 3000 0d00  0.0.0.0.0.0.0...
00000030: 0a00 0d00 0a00 5400 6800 6500 2000 4200  ......T.h.e. .B.
00000040: 6500 6100 7200 2000 5400 7200 7500 7400  e.a.r. .T.r.u.t.
00000050: 6800 0d00 0a00 3000 3000 3000 3000 3000  h.....0.0.0.0.0.
```

- **UTF-16LE with BOM `\xFF\xFE` — confirmed** (`d[:2] == b'\xff\xfe'`).
- CRLF (`0d 00 0a 00`) line endings.
- Header line: `{BOM}1:{CategoryName}` — the category equals the file's basename (`QuestTitle.lang` →
  `1:QuestTitle`; `Spells.lang` → `1:Spells`; `Items.lang` → `1:Items`).

Decoded structure (spec's stated layout is confirmed for this file):

```
1:QuestTitle

00000000
<blank>
The Bear Truth
00000001
<blank>
All is Revealed
00000002
<blank>
Recover the Goods
```

**Record layout is `{index}\r\n\r\n{value}\r\n`** — index **before** value, 8-digit zero-padded, and the index is
**decimal** (not hex).

### Caveat for the 1.4e parser: indices are not always zero-padded

`Locale/en-US/Mobs.lang` begins:

```
     1  1:Mobs
     2  0            <- bare, unpadded index
     3  (blank)
     4  Soup Dragon
     5  00000000
     6  (blank)
     7  Guard
     8  00000001
```

A survey of the second line across a random sample of 300 en-US `.lang` files found **294** with the expected
`00000000`, and 6 anomalies (bare `1`, blank, or a bare value). So the parser must accept **unpadded** indices and
must not assume the first data line is 8 characters. A robust rule: split on blank lines; alternating tokens are
index/value; skip any leading token that is not numeric.

### Hex→decimal verification (the spec's example does not resolve)

`0x1ED8D = 126349` (zero-padded `00126349`) — arithmetic verified. But:

- `QuestTitle.lang` in this revision has max index **`00002236`** (1,473 parsed entries).
- The literal UTF-16 byte sequence `00126349` appears in **0** of the 5,132 en-US `.lang` files.
- Of the 316 distinct `m_questTitle` keys in the SpiralDB corpus, 287 contain `A–F` (hex form), and **none** of
  those has a decimal value ≤ 2236.

⇒ The mechanism is real, but **`QuestTitle_1ED8D` specifically cannot resolve in this revision** and must use the
raw-key fallback ([spec L694–695](../../spec-domain-reference.md)). 1.4e and the quest UI will show raw keys for
most quests unless a newer revision's `QuestTitle.lang` is larger — this is worth flagging to the owner.

The mechanism **was** verified end-to-end with real in-range keys. `QuestTitle.lang` + the SpiralDB corpus:

| Corpus key | Decimal index | `QuestTitle.lang` value |
|---|---|---|
| `QuestTitle_00001717` | 1717 | **Grim Tales** |
| `QuestTitle_00001718` | 1718 | **To Ravenwood!** |
| `QuestTitle_00001813` | 1813 | **The Cure** |
| `QuestTitle_00001814` | 1814 | **Oh Me, Oh Minotaur** |

`QuestTitle_00001717` is used by `questtemplates_WC-UNICORN-MAIN-008.json` (level 0, Wizard City mainline) — a
plausible match for "Grim Tales", and the four keys form a contiguous block mapping to a contiguous title block,
which confirms the index-before-value record order.

### The dominant key form is decimal, not hex (important)

The field the sync should actually read for names — `m_displayName` — uses
`{Category}_{decimal index, zero-padded}`, **not** the hex form:

```
Items_00022716       -> 'Consultant Thermal Ring'
Items_00031281       -> 'Notorious Scholomari Dagger'
Gardening_00000144   -> 'Saw Palmetto'
NPCs_01748984        -> 'Zasha EmberForge'
WizardMobs_00003433  -> 'Sanitation Engineer'
WC-NPCs_00002429     -> 'Léon'
Spells_00000812      -> 'Natural Attack'
```

Empirical resolution rate (60 random templates per family with a non-empty `m_displayName`):

| Family | Sampled | Resolved | Index missing | Non-numeric suffix |
|---|---|---|---|---|
| `WizItemTemplate` | 60 | **60** | 0 | 0 |
| `WizGameObjectTemplate` | 60 | **60** | 0 | 0 |
| `WizPetTemplate` | 60 | **60** | 0 | 0 |
| `SpellTemplate` | 60 | 54 | 0 | 6 (e.g. `Spells_Pixie`) |

⇒ **Rule for 1.4e:** for key `{Category}_{suffix}`, treat an all-digits suffix as **decimal** first, and only
interpret `A–F`-containing suffixes as hex. The `.lang` file is `Locale/en-US/{Category}.lang`; if that file does
not exist, or the suffix is non-numeric, or the index is absent (sparse space), fall back to the raw key — then to
`m_objectName` for display.

Two independent end-to-end confirmations:

- `WL-StandIn-JudgeEddie` → `m_displayName: "NPCs_01749407"` → `NPCs.lang` idx 1749407 → **"Judge Eddie"**.
- `Minion-Balance-Gorgon-01` → `m_displayName: "Mobs_00000129"` → `Mobs.lang` idx 129 → "Vicious Viper"
  (the two keys are real and parse cleanly; the name/key pairing itself is a game-data quirk, not a parser bug).

---

## 6. Temp disk usage

| Tree | `du -sh` | `du -sb` (apparent) | Files | Wall clock |
|---|---|---|---|---|
| `--deser` (`/tmp/wad-spike`) | **1.5 G** | 1,154,640,030 B (1.15 GB) | 173,088 | 17.235 s |
| raw unpack (`/tmp/wad-raw`) | **1.2 G** | 792,998,399 B (793 MB) | 173,088 | 9.554 s |
| WAD input | 282 MB | 295,405,277 B | 1 | — |

Peak temp footprint for a sync is therefore **~1.2 GB** (the unpack tree plus the raw WAD). `/tmp` has 2.8 TB
free, so this is not a constraint, but 1.4c should still clean up in `finally` — 1.15 GB per sync would
accumulate otherwise. Both trees are **kept** at `/tmp/wad-spike` and `/tmp/wad-raw` for later rounds.

---

## 7. Fallback assessment

**`--deser` sufficed for all five families — no per-file `imcodec op` fallback is required in the sync pipeline.**

Every template family above lands as valid JSON with a populated `_className` and `_object`. The 478 files that
remained as raw `.xml` are **not templates** — they are plain configuration XML that correctly fails BiND
deserialization:

```
$ find /tmp/wad-spike -name '*.xml' -printf '%h\n' | sort | uniq -c | sort -rn | head
    283 ./AnimationData
    132 ./SpellFusions
     37 .
     16 ./Messages
      6 ./Fonts
      3 ./Capabilities
      1 ./CharacterCreation
```

(`GameMessages2.xml`, `Races.xml`, `AnimationData/*.xml`, …). `--deser` writes the original bytes when
deserialization fails (verified in `ArchiveCommands.cs` L116–135), so nothing is lost.

The fallback was nevertheless **proven working**, since 1.4c may want it for future revisions:

```bash
$ CLI=/home/jason/Documents/git-projects/Imview/submodule/Imcodec/src/Imcodec.Cli/bin/Debug/net9.0/linux-x64/imcodec
$ $CLI op file /tmp/wad-raw/ObjectData/WL/WL-StandIn-JudgeEddie.xml /tmp/op-fallback.json
Successfully deserialized the buffer to '/tmp/op-fallback_deser.json'.
```

Two behaviours to encode in 1.4c if the fallback is ever used:

1. **`op file` appends `_deser.json` to the given output path** — it wrote `/tmp/op-fallback_deser.json`, not
   `/tmp/op-fallback.json` (the requested path is not created). (`ObjectPropertyCommands.cs` L48.)
2. **`op file` records only the basename in `_fileName`** (`"WL-StandIn-JudgeEddie.xml"`), whereas `--deser`
   records the full internal WAD path (`"ObjectData/WL/WL-StandIn-JudgeEddie.xml"`).

`_object` is **byte-identical** between the two paths — the only differences are the volatile `_deserializedOn`
timestamp and `_fileName`:

```
DIFF _deserializedOn:
   op-file : '2026-09-25 22:00:24'
   --deser : '2026-09-25 21:55:43'
DIFF _fileName:
   op-file : 'WL-StandIn-JudgeEddie.xml'
   --deser : 'ObjectData/WL/WL-StandIn-JudgeEddie.xml'
--- _object identical: True
```

A negative probe also behaves sanely — on a non-BiND file it reports `Failed to deserialize the buffer.` and
writes no output:

```
$ $CLI op file /tmp/wad-spike/GameMessages2.xml /tmp/op-probe.json
Failed to deserialize the buffer.
$ ls -l /tmp/op-probe.json
ls: cannot access '/tmp/op-probe.json': No such file or directory
```

---

## 8. Fixtures committed

Three genuine files, copied **byte-for-byte** (`cmp` verified identical to source) into
`server/test/fixtures/`. Total **318,316 bytes (311 KB)** — well under the 2 MB budget.

```
$ ls -l server/test/fixtures/
total 316
-rw-r--r-- 1 jason users 313632 Sep 25 22:03 en-US_QuestTitle.lang
-rw-r--r-- 1 jason users   2053 Sep 25 22:03 npc_judge_eddie_deser.json
-rw-r--r-- 1 jason users   2631 Sep 25 22:03 spell_pixie_deser.json

$ sha256sum server/test/fixtures/*
3627afd217419adf879c4bd0ab004eadb2d12cd01d933e979c97afbf9bf00ba9  server/test/fixtures/en-US_QuestTitle.lang
5e5fc498e3c1b4038c3eb9f5adacb864761a1cb1408dd7f654456e0aa8306764  server/test/fixtures/npc_judge_eddie_deser.json
eb298ceef067623c94d77c25e0c441e7f80d6fa80a63cd7cd095f5ff27fd7caf  server/test/fixtures/spell_pixie_deser.json
```

| Fixture | Source (in `/tmp/wad-spike`) | Bytes | Why this one |
|---|---|---|---|
| `spell_pixie_deser.json` | `Spells/Pixie_deser.json` | 2,631 | `SpellTemplate` — the `m_name` family. `m_name="Pixie"`, `m_displayName="Spells_00000424"` → `Spells.lang` idx 424 = **"Pixie"** (self-consistent, so a parser test can assert the round-trip) |
| `npc_judge_eddie_deser.json` | `ObjectData/WL/WL-StandIn-JudgeEddie_deser.json` | 2,053 | `WizGameObjectTemplate` — the NPC family and the `m_templateID`/`m_objectName`/`m_displayName` shape. `m_templateID=1608380`, `m_displayName="NPCs_01749407"` → **"Judge Eddie"** (matches the file's own name) |
| `en-US_QuestTitle.lang` | `Locale/en-US/QuestTitle.lang` | 313,632 | Real `.lang`: UTF-16LE+BOM, 5,132-file locale, 1,473 entries, index range 0–2236. Contains all four corpus-resolvable keys from §5 (`00001717`→"Grim Tales", `00001718`→"To Ravenwood!", `00001813`→"The Cure", `00001814`→"Oh Me, Oh Minotaur") **and** demonstrates that `00126349` is absent — so 1.4e can unit-test both the hit and the raw-key-fallback paths against genuine data |

Only one `.lang` is needed: a single real file exercises BOM handling, CRLF, the header line, sparse indices and
the decimal key mapping. `Items.lang` (2.26 MB) was rejected as it alone would exceed the size budget.

`server/test/fixtures` was added to `.prettierignore` because Prettier otherwise flags the two verbatim JSON files
(`npm run lint` exited 1 before this); reformatting them would destroy the byte-exactness the parsers are tested
against.

---

## 9. Implications for tasks 1.4b–1.4e

### 1.4b — Revision resolver

- Target directory: `/home/jason/Documents/git-projects/Aurorium/data/`, sort names descending, first match `V_r*`
  → `V_r806919.Wizard_1_610` (verified present).
- WAD path to build: `{aurorium_path}/data/{revision}/Data/GameData/Root.wad`.

### 1.4c — Unpack runner

- `execFile(imcodecPath, ['wad', 'unpack', '--deser', rootWad, tempDir])`.
- **Budget: ~17 s wall clock, ~173,088 files, ~1,150 MB apparent / 1.5 GB on disk.** Do not set a short timeout;
  give it ≥120 s headroom for slower disks.
- The CLI prints exactly one line to stdout on success (`Successfully extracted '<wad>' to '<dir>'.`) unless
  `--verbose` is passed. **Never pass `--verbose`** — the source warns it "can tremendously decrease performance"
  for large archives.
- Temp dir under `os.tmpdir()`; clean up in `finally`. Raw mode (no `--deser`) is ~9.5 s / 793 MB if ever needed.
- Scan pattern for later stages: `{tempDir}/**/*_deser.json`.

### 1.4d — Template parsers

- **Discriminate by `_className`, never by filename or path.** Globbing `*ItemTemplate*` matches **zero** files.
- Suggested scan roots (both cheap to walk together):
  - `{tempDir}/ObjectData/**/*_deser.json` → items, NPCs, pets, mounts
  - `{tempDir}/Spells/**/*_deser.json` → spells
- Class → table mapping (counts are exact for this revision):
  - `items`: `WizItemTemplate` (76,679) + `ItemBundleTemplate` (1,810) + `ReagentItemTemplate` (867) +
    `PetSnackItemTemplate` (478) + `ItemTemplate` (2). Read `_object.m_templateID` (gid), and
    `_object.m_displayName` → friendly name.
  - `npcs` (flat, no type classification): `WizGameObjectTemplate` (15,190) + `GameObjectTemplate` (7,698).
    `template_id = _object.m_templateID`, name = `m_displayName` resolved.
  - `spells`: `SpellTemplate` (14,856) + `TieredSpellTemplate` (2,579). Name = `_object.m_name` (present here,
    and the only family where it is); `m_displayName` is a secondary, better-looking name (`"Spells_00000812"` →
    "Natural Attack").
  - pets/mounts: `WizPetTemplate` (143), `WizMountTemplate` (2). The plan's "include Pet/Mount names in the NPC
    table" is cheap given these counts.
  - **There is no `ActorTemplate` class.** If the plan's `ActorTemplate` family meant NPCs, it is
    `WizGameObjectTemplate`/`GameObjectTemplate`; if it meant cut-scene actors, it is `WizCinematicActorTemplate`
    (85) + `CinematicActorTemplate` (1). The owner/spec should clarify, but for friendly names the NPC reading is
    the useful one.
- Per-family expected string-table resolution: items/NPCs/pets **~100 %**; spells ~90 % (6/60 sampled had a
  non-numeric key suffix such as `Spells_Pixie`).
- **Name fallback ladder:** `m_displayName` → resolved string-table value → else raw key → else `m_objectName`.
  Expect empty `m_displayName` on 8.5 % of `WizItemTemplate`, 12.4 % of `WizGameObjectTemplate`, 63.3 % of
  `GameObjectTemplate`, 1.0 % of `SpellTemplate`, 11.2 % of `WizPetTemplate` (use `m_objectName`).
- Provenance: `_fileName` holds the original WAD path (e.g. `ObjectData/WL/WL-StandIn-JudgeEddie.xml`); prefer it
  over the on-disk path for dedup keys (D19/D20).
- Numeric ranges observed: `m_templateID` in the hundreds of thousands to millions (e.g. 107,071 / 1,528,571 /
  1,608,380 / 1,624,035; mounts = 3).
  `m_templateID` is a number in JSON — **render it as a string** per
  [spec-data-model.md](../../spec-data-model.md) L270–274.

### 1.4e — `.lang` parser

- Scope the glob to **`{tempDir}/Locale/en-US/*.lang`** → exactly **5,132 files, 25.9 MB**. Globbing all
  `*.lang` would pull in 33,932 files across 8 locales (185 MB) — 6.6× the work for unused data.
- Decode UTF-16LE, strip the leading BOM `\xFF\xFE`, split on `\r\n`.
- Line 1 = `1:{CategoryName}`; the category equals the basename.
- Then repeating records: **index, blank, value** (index *before* value). Indices are normally 8-digit
  zero-padded **decimal**, but must be parsed leniently (bare `0`/`1` occur — see `Mobs.lang`). The index space is
  sparse; a trailing lone index with no value is possible.
- Key mapping for `{Category}_{suffix}`:
  1. all-digits suffix → **decimal** index (this is the `m_displayName` form — the common case, ~100 % hit);
  2. `A–F`-containing suffix → **hex** → decimal (the `m_questTitle` form, mostly misses in this revision);
  3. `Locale/en-US/{Category}.lang` missing, non-numeric suffix, or index absent → **raw-key fallback**.
- Store `(key, value, category)` into `string_table`.
- **Flag for the owner:** 287 of 316 corpus `m_questTitle` keys are hex-form and resolve to indices well beyond
  `QuestTitle.lang`'s 0–2236 range, so nearly all quest titles will display as raw keys in this revision. The
  parser must not treat this as an error ([spec L694–695](../../spec-domain-reference.md)).
- Unit-test against `server/test/fixtures/en-US_QuestTitle.lang`: assert the header parses to `QuestTitle`,
  assert `00001717` → `"Grim Tales"`, and assert `00126349` is **absent** (documents the fallback).

### Reproducing this spike

```bash
bash scripts/spike-wad-characterize.sh /tmp/wad-spike
```

prints the bounded summaries from §3–§4 (bounded by design — safe against the 173k-file tree).

---

## Appendix — full `_className` histogram (top 40 of 112)

```
  76679 WizItemTemplate          599 DeckTemplate
  15190 WizGameObjectTemplate    478 PetSnackItemTemplate
  14856 SpellTemplate            301 BoosterPackTemplate
   7698 GameObjectTemplate       290 CastleMagicSpellTemplate
   3985 CinematicTemplate        188 DynamicTriggerTemplate
   3065 CharacterRaceTable       171 ClassProjectTemplate
   2579 TieredSpellTemplate      162 CantripsSpellTemplate
   1824 ObjStateSet              143 WizPetTemplate
   1810 ItemBundleTemplate       143 GardenSpellTemplate
    867 ReagentItemTemplate      134 WizardStatTable
    679 WizPolymorphTemplate     108 PetDerbyTalentTemplate
    649 SoundDefTemplate          94 WhirlyBurlySpellTemplate
    632 PetTalentTemplate         85 WizCinematicActorTemplate
                                   84 BattlegroundTemplate
                                   69 PvPSeasonTemplate
                                   49 FishingSpellTemplate
                                   42 ItemSetBonusTemplate
                                   37 DuelModifierTemplate
                                   24 CinematicDefTemplate
                                   22 MatchTemplate
                                   17 TournamentTemplate
                                   16 MagicSchoolTemplate
                                   15 GoldAmountTemplate
                                   13 GameEffectTemplateList
                                   11 TutorialQuestTemplate
                                   10 CombatSigilTemplate
                                    8 PvPLeagueTemplate
```