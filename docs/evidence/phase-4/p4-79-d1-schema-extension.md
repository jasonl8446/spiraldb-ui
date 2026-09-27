# p4-79 D1 — absorbing the owner's baseline: the constants + the model

Task: the owner merged upstream into their SpiralDB fork (`main` at `f9a1055`), which moved the
authoritative corpus under the run and failed 13 arms across 7 files. Recorded as **D79**.
This file is D1 of three staged deliverables; D2 re-measures the count pins, D3 is the gate.

Everything below is a command and its output. Nothing here is asserted without a measurement.

## The measured delta (all from the 328-file corpus at `f9a1055`)

| fact | before (322 files) | now (328 files) | how it was measured |
|---|---|---|---|
| `QuestTemplates/*.json` | 322 | **328** | `find QuestTemplates -maxdepth 1 -name '*.json' \| wc -l` (the recursive count is 642 because `QuestTemplates/droptables/` holds 314 drop-table files) |
| distinct `$type` strings | 26 | **29** | `grep -rho '"$type": *"[^"]*"' QuestTemplates \| sort -u \| wc -l` |
| `$type` occurrences | 7,956 | **8,746** | same grep, `\| wc -l` |
| dialog entries | 1,706 | **1,884** | direct children of every `m_dialogEntries` array |
| dialog entry key shapes | 3 | **5** | ordered key lists of those entries |
| dialog blocks | 739 | **774** | nodes with `m_dialogTag` + a `m_dialogEntries` array |
| `ActorDialogList` wrappers | 767 | **797** | `$type` occurrences (328 quest-level + 469 goal-level) |
| ZoneTransfer teleports | 2,365 | **2,368** | `ZoneTransfer/*.json` sweep |
| distinct destination zones | 1,069 | **1,072** | same sweep |
| nested `Teleport` objects, serializer order | 2,353 | **2,355** | same sweep |
| nested `Teleport` objects, spec order | 12 | **13** | same sweep |

The 3 new `m_destinationLoc` values are **not** four-float strings:
`WizardZoneDatas_1-A.json` `Teleports[12]` = `"Start"`, and `WizardZoneDatas_323-A.json`
`Teleports[5]` / `[6]` = `"Target location (Street5 Tower1 Entrance)"` /
`"Target (Street5 FireTheatre Entrance)"`. That is a **behavioural** finding, not a count: the
zone format rule is blocking and its "zero corpus violations" premise is now false. It is
reported to the lead as a decision rather than flipped unilaterally (D3 section).

## D1a — the constants (`shared/quest/typeConstants.ts`)

The three new strings were **transcribed from the same grep**, never composed, and the grep was
re-run before and after:

```
$ grep -rho '"$type": *"[^"]*"' /home/jason/Documents/git-projects/spiraldb/QuestTemplates | sort | uniq -c | sort -rn
   4175 "Imcodec.ObjectProperty.TypeCache.MadlibArgT_ByteString, Imcodec.ObjectProperty"
   1882 "Imcodec.ObjectProperty.TypeCache.NPCDialogEntry, Imcodec.ObjectProperty"
    797 "Imcodec.ObjectProperty.TypeCache.ActorDialogList, Imcodec.ObjectProperty"
    429 "Imcodec.ObjectProperty.TypeCache.PersonaGoalTemplate, Imcodec.ObjectProperty"
    323 "Imcodec.ObjectProperty.TypeCache.ResDropTable, Imcodec.ObjectProperty"
    313 "Imcodec.ObjectProperty.TypeCache.RequirementList, Imcodec.ObjectProperty"
    277 "Imcodec.ObjectProperty.TypeCache.ReqHasQuest, Imcodec.ObjectProperty"
    198 "Imcodec.ObjectProperty.TypeCache.WaypointGoalTemplate, Imcodec.ObjectProperty"
    107 "Imcodec.ObjectProperty.TypeCache.BountyGoalTemplate, Imcodec.ObjectProperty"
     52 "Imcodec.ObjectProperty.TypeCache.ReqHasEntry, Imcodec.ObjectProperty"
     36 "Imcodec.ObjectProperty.TypeCache.ScavengeGoalTemplate, Imcodec.ObjectProperty"
     34 "Imcodec.ObjectProperty.TypeCache.ResAddDynaMod, Imcodec.ObjectProperty"
     26 "Imcodec.ObjectProperty.TypeCache.AchieveRankGoalTemplate, Imcodec.ObjectProperty"
     21 "Imcodec.ObjectProperty.TypeCache.ReqSchoolOfFocus, Imcodec.ObjectProperty"
     21 "Imcodec.ObjectProperty.TypeCache.ResLearnSpell, Imcodec.ObjectProperty"
     10 "Imcodec.ObjectProperty.TypeCache.ResGiveSpell, Imcodec.ObjectProperty"
      8 "Imcodec.ObjectProperty.TypeCache.ResTeleport, Imcodec.ObjectProperty"
      8 "Imcodec.ObjectProperty.TypeCache.ResDrawHand, Imcodec.ObjectProperty"
      7 "Imcodec.ObjectProperty.TypeCache.ReqIsSchool, Imcodec.ObjectProperty"      <-- moved in
      5 "Imcodec.ObjectProperty.TypeCache.ResActorDialog, Imcodec.ObjectProperty"   <-- new
      5 "Imcodec.ObjectProperty.TypeCache.ActorDialog, Imcodec.ObjectProperty"      <-- new
      3 "Imcodec.ObjectProperty.TypeCache.ResPostEvent, Imcodec.ObjectProperty"
      2 "Imcodec.ObjectProperty.TypeCache.ResAddSpell, Imcodec.ObjectProperty"
      2 "Imcodec.ObjectProperty.TypeCache.ResPlaySound, Imcodec.ObjectProperty"
      1 "Imcodec.ObjectProperty.TypeCache.ResModifyEntry, Imcodec.ObjectProperty"
      1 "Imcodec.ObjectProperty.TypeCache.ResAddHealth, Imcodec.ObjectProperty"
      1 "Imcodec.ObjectProperty.TypeCache.ResAddMana, Imcodec.ObjectProperty"
      1 "Imcodec.ObjectProperty.TypeCache.ResDespawn, Imcodec.ObjectProperty"
      1 "Imcodec.ObjectProperty.TypeCache.ResWait, Imcodec.ObjectProperty"
```

**One correction to the brief's table, measured:** the two string shapes the brief names are the
only **unknown** ones, but there are **three** additions to the corpus table — `ReqIsSchool`
(7 occurrences, one per `WC-COMMONS-MAIN-002-*` quest, each
`{$type, m_magicSchoolName, m_applyNOT, m_operator}`) was the table's **spec-only** entry: the
322-file corpus did not contain it. It is now corpus-measured, so it moved into
`CORPUS_TYPE_STRINGS` and `SPEC_ONLY_TYPE_STRINGS` is **empty** at this baseline. The `grep ⊆
constants` assertion is unchanged in kind; the recorded corpus table is now exactly the 29
measured strings.

Also re-measured while in the file: `m_goalType` counts (7 values, 796 goals — was 772),
`ROP_OR` now occurs **7 times** (the old claim "ROP_OR never occurs" is false), magic schools
21 × `m_magicSchool` + 7 × `m_magicSchoolName`, and `KNOWN_DIALOG_TAGS` gains the measured
`"Hyperlink"` (5).

## D1b — the model (`shared/quest/{dialog,results}.ts`, `client/src/lib/{quest-dialog,quest-results}.ts`)

* `ResActorDialogSchema` (new): `{$type, m_dialog}` — `m_dialog: ActorDialogSchema`. 15-member
  result union (the spec's 14 + this corpus-only class).
* `ActorDialogSchema` (new): the **typed** dialog block — `$type` + the same six value keys the
  untagged `m_dialogs[]` blocks carry. Built with `ActorDialogBlockSchema.extend(...)`, which
  keeps the passthrough policy.
* `NPCDialogEntrySchema.$type` is now `.nullish()`: **2 of the 1,884** corpus entries carry no
  `$type` at all (`WC-TRITON-MAIN-004` `[4]`, `WC-TRITON-MAIN-007` `[5]`). A **wrong** `$type`
  still fails loudly; nothing invents one.
* `client/src/lib/quest-results.ts`: `ResActorDialog` gets a spec with **`fields: []`**, so its
  `m_dialog` is not owned by any control and is surfaced by the existing **raw-fields
  disclosure** (`rawResultFields`) — visible and read-only, never written. Claiming it as a text
  field would invite overwriting an object with a string; building a real control is editor
  work, not a baseline re-measure.
* `client/src/lib/quest-dialog.ts`: the measured entry shapes are now **data** —
  `DIALOG_ENTRY_KEY_ORDER` and `DIALOG_ENTRY_KEY_SHAPES` (one home for each key list, count and
  provenance address), including the two shapes the merge introduced. Every quoted corpus count
  in that module's doc comments and user-visible notes was re-measured (1,884 entries, 774
  groups, 797 lists, `m_nameSTKey` 1449/325/null 92/`""` 15, `m_maxTimeSeconds` −1 × 1789).

### Byte-exactness evidence (the D5/D57 discipline)

`tests/unit/p4-79-d1-check.test.ts` (interim; deleted when the shipped sweeps own it) loads each
real file with `loadDoc`, applies a **benign re-set of every key to its own value** at the entry
and at the nested `ActorDialog`, and asserts `firstDiff(before, after)` is `undefined` (key
**sets and order**) and `serializeDoc(after) === serializeDoc(before)` (bytes):

```
$ npx vitest run tests/unit/p4-79-d1-check.test.ts
[d1] entry questtemplates_WC-COMMONS-MAIN-002-BALANCE.json m_goals.[0].m_dialogList.m_dialogs.[0].m_dialogEntries.[11] keys=65 byte-identical=yes
[d1] entry questtemplates_WC-COMMONS-MAIN-002-DEATH.json   ... keys=65 byte-identical=yes
[d1] entry questtemplates_WC-COMMONS-MAIN-002-FIRE.json    ... keys=65 byte-identical=yes
[d1] entry questtemplates_WC-COMMONS-MAIN-002-ICE.json     ... keys=65 byte-identical=yes
[d1] entry questtemplates_WC-COMMONS-MAIN-002-LIFE.json    ... keys=65 byte-identical=yes
[d1] entry questtemplates_WC-COMMONS-MAIN-002-MYTH.json    ... keys=65 byte-identical=yes
[d1] entry questtemplates_WC-COMMONS-MAIN-002-STORM.json   ... keys=65 byte-identical=yes
[d1] entry questtemplates_WC-TRITON-MAIN-004.json m_dialogList.m_dialogs.[0].m_dialogEntries.[4] keys=58 byte-identical=yes
[d1] entry questtemplates_WC-TRITON-MAIN-007.json m_dialogList.m_dialogs.[0].m_dialogEntries.[5] keys=58 byte-identical=yes
[d1] result questtemplates_WC-TRITON-MAIN-005.json m_goals.[3].m_completeResults.m_results.[0] nested-keys=7 byte-identical=yes
[d1] result questtemplates_WC-TRITON-MAIN-005.json m_goals.[4].m_completeResults.m_results.[1] nested-keys=7 byte-identical=yes
[d1] result questtemplates_WC-TRITON-MAIN-007.json m_goals.[0].m_completeResults.m_results.[0] nested-keys=7 byte-identical=yes
[d1] result questtemplates_WC-TRITON-MAIN-007.json m_goals.[1].m_completeResults.m_results.[0] nested-keys=7 byte-identical=yes
[d1] result questtemplates_WC-UNICORN-MAIN-007.json m_goals.[2].m_completeResults.m_results.[0] nested-keys=7 byte-identical=yes

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

The three arms are: (1) the extended schema accepts the three quests that carry the new `$type`
strings; (2) all nine enriched entries keep their own key list — including the 65-key shape that
**drops** `m_dialogEvent`, which a re-set must not add back — and their bytes; (3) all five
`ResActorDialog` nodes keep `{$type, m_dialog}` and their nested 7-key `ActorDialog` whole.

Separately, the whole corpus was parsed once with the extended schema — **328 files, 0
rejections**:

```
$ npx vitest run tests/unit/p4-79-d1-check.test.ts  # earlier variant, corpus-wide arm
[d1] files=328 rejected=0
```

## What is deliberately NOT done here

* No `$type` grep was weakened, skipped, or narrowed: the table was extended, and the live grep
  arm still asserts `measured ⊆ constants`.
* No count was hand-tuned: D2's pins come from re-measurements (see `p4-79-d2-pins.md`).
* The owner's fork was read only (`grep`, `git log`, `git archive` of the pre-merge tree into
  `/tmp`); nothing there was written.
* The database was **not** re-synced and the D17 test clone was **not** re-cloned: the clone
  still holds the 322-file era (26 strings / 7,911 occurrences), which is why the sweeps that
  cover both corpora count them separately.