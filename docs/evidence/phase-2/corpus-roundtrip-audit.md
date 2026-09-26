# Corpus-wide round-trip fidelity audit (D28; Phase 2 AC#2)

Prompted by the owner asking to validate that the code really extracts quests from the game data. This
is the strongest fidelity evidence available **without a recorded live capture**, over the **whole real
corpus** rather than the 5 committed fixtures.

## What is being proven

For every real quest file in the corpus:

```
QuestTemplates/*.json  ->  tools/bin/fixturegen  ->  tools/bin/imview-packet-reader  ->  quest'
```

and `quest'` is compared against the source on quest name, title, level, mainline, goal count, goal names
(in order), goal types, ActorDialog block count, NPCDialogEntry count and the per-container dialog entry
map. FixtureGen encodes the blobs with the **game's own Imcodec serializer** and the reader is **Imview's
`QuestBuilder`** (the owner's real-game parser), so this exercises the real serialization layer end to end.

## Result — `npm run audit:corpus` (full output: `corpus-roundtrip-audit.txt`)

```
quests:    322 real corpus quest(s) attempted
verified:  181/322 round-trip identically through the real reader (1810 field check(s), 0 mismatch(es))
not covered: 141 refused by the generator (a synthetic-harness coverage limit)
   122  goal-level dialog on a compilation goal
    11  quest has no goals
     4  quest-level dialog tag not Prep/Completion
     4  m_goalName != "{n}_{m_goalTitle}" (ACHIEVERANK/empty title)
PASS: 181/322 verified, 141 not covered by the synthetic harness, 0 failure(s) (106.8s).
```

**The new measurement is the 181.** p2-03's corpus sweep had already established the 181/141 split
(`docs/evidence/phase-2/story-p2-03-diversity.txt` §6) — but it only checked which quests FixtureGen
*accepts*, and round-tripped just 5 of them through the reader. All 181 generator-accepted quests have now
been run through the real reader and compared: **1810 field checks, 0 mismatches**. So for every quest the
synthetic harness can express, the extraction is field-exact.

## Reconciliation with p2-03's refusal histogram

p2-03 counted **every** problem per quest (130 / 26 / 26 / 11 / 5 / 2 / 1 across 141 quests — 201 reasons,
most quests carrying more than one). This audit reports the **first** problem per quest, so its per-class
counts are smaller (122 / 11 / 4 / 4). Same 141 quests, different counting; neither contradicts the other.

## Why 141 cannot be covered here, and what would

FixtureGen **refuses to emit a lossy capture** (it exits 1 with the reason) for shapes Imview's
`QuestBuilder` cannot reconstruct from a synthetic capture — chiefly a goal that carries dialogs while
being delivered from the `GoalCompilation` blob (the reader only attaches dialogs to packet-delivered
goals). Those refusals are a **coverage limit of the synthetic harness, not a fidelity defect**: the
synthetic capture models one delivery path, so it cannot express what the real game does for those quests.

Consequently, for those 141 **only a capture recorded from a live game session can settle it**. Such a
capture replays the whole suite unchanged (`tools/bin/imview-packet-reader --input <capture>` or the UI
upload), and `npm run audit:corpus --corpus <dir>` re-measures the corpus at any time.

Availability checked on 2026-09-26: no real capture exists anywhere on this host (searched `Imview`,
`$HOME` and `/tmp`), and Imview ships no sample capture — `QuestBuilder.cs` is the only real-game artifact.
The committed fixtures are synthetic by construction (their README states it).

## Tooling added by this audit

- `scripts/lib/quest-roundtrip.mjs` — the comparison (field list + GOAL_TYPE enum + snapshots) extracted
  from `verify-captures.mjs` so both callers share one definition. `npm run verify:captures` was re-run
  after the refactor: **PASS, 5 fixtures, 50 field checks, 0 mismatches** (unchanged).
- `scripts/audit-corpus-roundtrip.mjs` / `npm run audit:corpus` — the corpus sweep, with `--limit`,
  `--corpus`, `--quiet` and `--strict` (refusals count as failures under `--strict`), a per-field mismatch
  histogram for systematic defects, and refusals classified separately from fidelity failures so a
  coverage limit can never be mistaken for a pass.
