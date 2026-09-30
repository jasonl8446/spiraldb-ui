# Quest capture fixtures (task 2.1a / decision D28)

Synthetic Imview **packet captures** — the input `imview-packet-reader` consumes — generated from
real SpiralDB corpus quests by `tools/FixtureGen`, so the Phase 2 extraction pipeline can be tested
end to end without recorded captures. Committed here because the corpus clone (`data/test-spiraldb`)
is disposable (D17).

Verify the whole set with:

```bash
npm run build:cli && npm run build:fixturegen && npm run test:reset-clone
npm run verify:captures        # exit 0 = every committed fixture round-trips
```

`verify:captures` (`scripts/verify-captures.mjs`) runs every fixture through
`tools/bin/imview-packet-reader`, compares the reconstructed quest against the corpus source on
quest name, title, level, mainline, goal count, goal names (in order), goal types, dialog block
count, dialog entry count and the per-container dialog map, then regenerates each fixture with
`tools/bin/fixturegen` and asserts the bytes are identical to the committed file (the reproducibility
pin below). It needs the corpus clone; pass `--corpus <QuestTemplates dir>` to point it elsewhere.

## Fixtures

Generated with, per fixture (paths relative to the repo root):

```bash
tools/bin/fixturegen \
  --quest data/test-spiraldb/QuestTemplates/questtemplates_<QUEST>.json \
  --output server/test/fixtures/captures/<QUEST>.json
```

Corpus pin: the `data/test-spiraldb` clone at commit `c55ccab175440c5f676b8d5315575ccd6d550332`.
A corpus refresh changes the bytes below and `verify:captures` fails until the fixtures are
regenerated and these hashes updated.

| Fixture (= quest name) | Corpus source | sha256 | Goals (k in GoalCompilation) | Goal types | Dialog blocks / entries | Level | Why it is in the set |
|---|---|---|---|---|---|---|---|
| `MB-YARD1-C01-001.json` | `QuestTemplates/questtemplates_MB-YARD1-C01-001.json` | `339bd29245af25a041e99592028c73c3eed320d23da90d03925cd1628c04ca87` | 15 (1) | WAYPOINT ×7, PERSONA ×6, BOUNTYCOLLECT ×2 | 7 / 9 | 1 | Multi-goal mainline — the goal-heaviest quest the generator accepts (rank 1/181) |
| `WC-CYCLOPS-MAIN-002.json` | `QuestTemplates/questtemplates_WC-CYCLOPS-MAIN-002.json` | `e2c9137b20abd621a2520104e71cc6ce2402efb31a78be30e0bf56c77bee4941` | 6 (0) | PERSONA ×6 | 7 / 27 | 1 | Dialog-heavy — the entry-heaviest quest the generator accepts (rank 1/181; next: 20, 19, 14, 13) |
| `WC-UNICORN-MAIN-004.json` | `QuestTemplates/questtemplates_WC-UNICORN-MAIN-004.json` | `a2eae4202bc9ee0a67fe00138066c5fac2c03a387882d98f8ffa0ce8b15fd047` | 7 (5) | USAGE ×4, BOUNTYCOLLECT, WAYPOINT, PERSONA | 3 / 8 | 0 | Rarest goal type: `GOAL_TYPE_USAGE` occurs 4 times in the whole corpus and all 4 are here; also a tally-madlib blob |
| `WC-UNICORN-MAIN-007.json` | `QuestTemplates/questtemplates_WC-UNICORN-MAIN-007.json` | `69af8326966595ba96abd6b097cd4efdf6319979f32cc72b08d137a11ef75b9e` | 4 (1) | WAYPOINT ×2, BOUNTY, PERSONA | 5 / 8 | 0 | Rarest goal type: `GOAL_TYPE_BOUNTY` (4 corpus-wide); a goal-level `Prep` dialog; 2 tally-madlib blobs |
| `WC-FIRECAT-MAIN-004.json` | `QuestTemplates/questtemplates_WC-FIRECAT-MAIN-004.json` | `efaf06ab46504ea482e3e5d7b0e9978287cc1d52f78746649f00ff1d43c48d4b` | 5 (1) | SCAVENGE, PERSONA ×2, WAYPOINT, BOUNTYCOLLECT | 3 / 13 | 1 | `SCAVENGE` (43 corpus-wide) inside a multi-type quest |

Together they cover 6 of the 7 goal types present in the corpus. The 7th, `GOAL_TYPE_ACHIEVERANK`,
**cannot** round-trip through this reader: its corpus goals carry an empty `m_goalTitle` and
`m_goalNameID 0`, while `QuestBuilder` numbers goals `"{n}_{m_goalTitle}"` and skips a packet whose
`GoalNameID` it has already seen (all 4 ACHIEVERANK quests; 26 goals). The generator refuses them
explicitly instead of emitting a capture that would silently mangle goal names.

## Dialog counts: two different definitions

Both are reported by `verify:captures`; they differ whenever a dialog carries more than one entry:

- **dialog block count** = number of `ActorDialog` objects (`m_dialogList.m_dialogs` entries) on the
  quest plus on each goal. `MB-YARD1-C01-001` = **7**.
- **dialog entry count** = number of `NPCDialogEntry` objects inside those blocks'
  `m_dialogEntries`. `MB-YARD1-C01-001` = **9**, because its 8th goal carries a 3-entry dialog.

## Known reader defects (found while building this task — not fixable from a fixture)

1. **`m_questLevel` is always 0.** `MSG_QUESTOFFER.Level` has no `ExtractMethod`, so
   `PacketReaderService.GetDefaultValue` evaluates
   `Convert.ChangeType(node["value"].GetValue<object>(), int)` — and `GetValue<object>()` returns a
   `System.Text.Json.JsonElement`, which throws `InvalidCastException: Object must implement
   IConvertible`; the method swallows it into `default(int)`. Reproduced with the field as a number,
   a string and a float (all reconstruct 0), and isolated with a standalone System.Text.Json probe.
   Consequence: the level field of P2 AC#2 can only match for corpus quests whose level is 0
   (15/322; 4 of them generatable). `verify:captures` reports the row as a *known reader defect*
   rather than a fixture failure, and prints the corpus value next to the 0 — 3 of the 5 fixtures
   above are affected. Fixing it means `GetDefaultValue` should use `value.Deserialize<T>()` or
   `GetValue<int>()` (Imview repo — read-only for this project). The three fixtures at level 1
   (`MB-YARD1-C01-001`, `WC-CYCLOPS-MAIN-002`, `WC-FIRECAT-MAIN-004`) are kept for their structural
   diversity; `WC-UNICORN-MAIN-004`/`-007` verify the level row exactly.
2. **A goal-level `Completion` dialog is also copied onto the quest.**
   `QuestBuilder.AddCompletionDialogToQuestTemplate` matches on
   `CompletionType == "Completion" && QuestID == quest.ID` and **ignores `GoalID`**, so with
   `MSG_SENDQUEST` present the first goal-level `Completion` dialog becomes an extra quest-level
   `Completion` dialog (and its entries) whenever the quest has no quest-level completion dialog.
   FixtureGen works around it by writing `QuestID 0` on goal-scoped `MSG_ACTORDIALOG` packets
   (`AddDialogToGoals` matches by `GoalID` alone, so nothing is lost), and refuses a goal dialog
   tagged `QuestInfo` for the same reason on the prep path (which matches by `MobileID` +
   `CompletionType`). A real capture that carries the quest id on goal dialogs will show the extra
   quest-level dialog in the product.
3. **`Console.WriteLine` on the CLI's stdout.** With a non-empty `Persona` field,
   `TemplateManifestService` prints `Warning: Could not find template ID for persona: …` to
   **stdout**, which corrupts the CLI's JSON stream (the `--output` file path stays clean).
   FixtureGen therefore defaults `--persona` to `""` and says so in `--help`; any caller that
   feeds a persona-bearing capture to `imview-packet-reader` without `--output` cannot `JSON.parse`
   stdout.

## What the generator will refuse (by design)

`fixturegen` writes nothing and exits 1, listing every problem, when a capture could not be
reconstructed faithfully. Over the 322 corpus quests: **181 generate, 141 are refused** — 130
because a goal that carries dialogs is delivered by the `GoalCompilation` (the reader cannot attach
a dialog to a compilation goal), 26 goal-name/26 goal-id problems in the 4 ACHIEVERANK quests, 11
quests with no goals, 5 unrepresentable quest-level dialog tags, 2 duplicate `m_goalNameID`s and 1
duplicate quest-level dialog tag.

## p7: planted-value fixtures (task 7.2 / D128)

`p7/` holds five captures generated with `tools/FixtureGen --inject`, each beside the spec that produced it and
the census golden that `tools/CaptureCensus` prints for it. They plant values that cannot occur by accident
(`P7-PLANT-…`, `QuestNameID 77000nn`, …) so stories 7.3-7.5 can diff extraction output against them exactly.
The Phase 2 fixtures above are untouched: without `--inject`, `fixturegen` output stays byte-identical
(`verify:captures` regenerates them without it).

```bash
npm run build:fixturegen && npm run build:census
tools/bin/fixturegen --quest data/test-spiraldb/QuestTemplates/questtemplates_<QUEST>.json \
  --inject server/test/fixtures/captures/p7/<QUEST>.inject.json \
  --output server/test/fixtures/captures/p7/<QUEST>.json
tools/bin/capture-census --input server/test/fixtures/captures/p7/<QUEST>.json \
  --output server/test/fixtures/captures/p7/<QUEST>.census.json
```

Corpus pin: the `data/test-spiraldb` clone at `18dc92477d54b1e911796960407ce7710e703697`.

| Fixture (= quest) | Goal class | Goals | sha256 (capture) |
|---|---|---|---|
| `WC-MAIN-C01-013` | Waypoint; **single goal** (7.5: no chain) | 1 | `2873f5ef831841ab6c254b53abec74a403ec8994e0f0ac4120007c8212372a09` |
| `DS-ACAD-C01-003` | Persona (goal 1; goal 0 is a Waypoint) | 2 | `7b9791740d0231986cb34820a00c953068f9b3daceb1e3c58e2f65131094300e` |
| `WC-UNICORN-MAIN-002` | Bounty (goal 0) then Persona | 2 | `98bc790ee2f884ef542a0772f262d5eeb308b834d978daf74d549da2cc9b0e3b` |
| `DS-ACAD1-C04-001` | Scavenge (goal 0) then Persona | 2 | `5fbf0d11af4d909dca98dbea9dc40cac6ad72f3401b3ad8d8473939e7d88f06c` |
| `WC-TUT-C05-001` | AchieveRank x5 (opt-in, see below) | 5 | `d5979a4ff98a9d01734cfc5ce7600dd1f68bda435836b6ea5749f732c25ff7b3` |

### The inject spec

Strict JSON: `{ description, allowAchieveRank?, sendQuestFields, sequence[] }`.

- `sendQuestFields` are extra envelope fields planted on `MSG_SENDQUEST` (`QuestNameID`, `QuestInfo`,
  `NoQuestHelper`, `SkipQHAutoSelect`, `ActivityType` (2 = `ACTIVITY_Crafting`), `ClientTags`, `PetOnlyQuest`,
  `Rewards`). Field names are Imlight's `QuestMessages.xml`; a planted field is written whether or not Imview's
  message definition declares it (that is what the census then reports as ignored).
- `sequence` is the deliberate message order after `MSG_QUESTOFFER`, `MSG_SENDQUEST` and the quest-level dialogs.
  Each step is `{ message, goal?, fields? }`, `message` one of `MSG_SENDGOAL`, `MSG_PERSONAINFO`,
  `MSG_COMPLETEGOAL`, `MSG_REMOVEGOAL`, `MSG_COMPLETEQUEST`; `goal` indexes the corpus `m_goals`; `fields` are
  planted on that envelope (ids are filled in; `MSG_SENDGOAL` carries the whole corpus goal). Under `--inject`
  `MSG_SENDGOAL` is emitted only from the sequence (a goal's own dialogs follow its first send); every goal the
  `GoalCompilation` does not carry must be sent. A compilation goal may be sent too; the reader skips it as a
  duplicate by `GoalNameID`.
- A field value `{"$blob":"ClientTagList","tags":[…]}` (mask 1) or `{"$blob":"LootInfoList","gold":n,"magicXp":n}`
  (mask 31, the mask of Imcodec's `LootTableTest`) is serialised with `ObjectSerializer` to the hex string on the
  wire; the LootInfoList is decode-checked before it is written. Both classes exist in Imview's net9 Imcodec build.
- Order used by all five: per goal `MSG_SENDGOAL`, `MSG_PERSONAINFO` (persona goals), `MSG_COMPLETEGOAL`, then
  `MSG_REMOVEGOAL` unless it is the last goal; `MSG_COMPLETEQUEST` closes the quest. So goal A completes and is
  removed, follow-on goal B is sent on the same `QuestID`, and the goal completed right before
  `MSG_COMPLETEQUEST` (no remove) is the terminal one. The single-goal quest has no remove and no follow-on.

### GOAL_TYPE_ACHIEVERANK under `--inject`

The default refusal stays (see above). A spec with `"allowAchieveRank": true` plants the corpus goals as they are
(empty `m_goalTitle`, `m_goalNameID 0`). What the reader does with `WC-TUT-C05-001` today: 5 goals in the
capture, **1** goal out, named `1_` (`m_goalNameID 0`, `GOAL_TYPE_ACHIEVERANK`): the first goal takes the empty
title, and the other four are skipped because their `GoalNameID` 0 is already present. Story 7.4 repairs this.

### Census goldens

`<QUEST>.census.json` is `capture-census` output (`{input, messages, rows:[{message, field, count, consumed}]}`,
sorted by message then field). The consumed table is data inside `tools/CaptureCensus/Program.cs`; 7.3/7.4 flip
entries and regenerate the goldens. `tests/unit/p7-capture-census.test.ts` checks every golden against its spec in
CI (every planted field present with the planted count) and, where `tools/bin/capture-census`,
`tools/bin/fixturegen` and the clone exist, regenerates and byte-compares both goldens and fixtures.
