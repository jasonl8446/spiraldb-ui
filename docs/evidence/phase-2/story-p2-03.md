# p2-03 — FixtureGen + closed-loop quest round-trip (task 2.1a, decision D28)

Branch `phase-2-quest-extraction`. A generator that manufactures Imview packet captures from real
corpus quests, five committed fixtures, a verifier that proves the whole loop (corpus quest →
capture → `imview-packet-reader` → quest′ matching the source on P2 AC#2's fields) — and two
repairs in our own CLI wrapper that the loop turned out to need.

Raw outputs: [`story-p2-03-build.txt`](./story-p2-03-build.txt) (build, D18/D45 isolation),
[`story-p2-03-diversity.txt`](./story-p2-03-diversity.txt) (corpus measurements, the 322-quest
generator sweep, fixture selection), [`story-p2-03-fixtures.txt`](./story-p2-03-fixtures.txt)
(per-fixture generation + CLI extraction + hashes + determinism),
[`story-p2-03-verify.txt`](./story-p2-03-verify.txt) (the pre-repair verifier table and both
reader-defect probes), [`story-p2-03-roundtrip.txt`](./story-p2-03-roundtrip.txt) (the final
50/50 verifier run after the repairs), [`story-p2-03-ac1-ac3.txt`](./story-p2-03-ac1-ac3.txt)
(ac1 symmetry, the stdout-integrity probe, ac3 pinning, isolation). New source:
[`tools/FixtureGen/`](../../../tools/FixtureGen/),
[`scripts/verify-captures.mjs`](../../../scripts/verify-captures.mjs),
[`server/test/fixtures/captures/`](../../../server/test/fixtures/captures/) (fixtures + README),
two npm scripts, plus the D46 edits to [`tools/PacketReaderCli/Program.cs`](../../../tools/PacketReaderCli/Program.cs).

| AC | Result | Evidence |
|---|---|---|
| **ac1** `npm run build:fixturegen` → `tools/bin/fixturegen`; symmetry milestone: `fixturegen --quest <corpus quest> --output cap.json` then `imview-packet-reader --input cap.json` returns ≥1 quest with the same `m_questName` | **PASS** | Build: exit 0, `Build succeeded`, **0 Errors** (12 NU1900 warnings — the sandbox denies a write to NuGet's *HTTP* cache; packages resolve from `tools/.nuget`), exactly the two D18 `-p:` flags and 0 `BaseIntermediateOutputPath`/`BaseOutputPath`; `tools/bin/fixturegen` is a **relative** symlink into `tools/.artifacts/bin/FixtureGen/release/`, executable. Symmetry re-run at the end of the round on the plan's own example quest: generator exit 0 → CLI exit 0 → `quests=1`, `m_questName=DS-ACAD1-C01-001` equal to the corpus, **7** goals with names identical in order, `m_startGoals` = the 6 compilation goals. The generator self-checks each blob by decoding it before writing (`GoalCompilation` 1507 B → 6 goals identical to the corpus; `ActorDialog` blocks decode with their trailing flags intact). |
| **ac2** closed-loop round-trip (D28) for ≥3 diverse committed fixtures — one multi-goal mainline, one dialog-heavy, one exercising the rarest corpus goal types — matching on quest name, title, level, mainline, goal count/names/types, dialog entry count (P2 AC#2) | **PASS** | `npm run verify:captures` → **exit 0**, `PASS: 5 fixture(s), 50 field check(s), 0 mismatch(es), 0 known-reader-defect row(s)` — every named field, `level` included (3 of the 5 fixtures are level 1, so the check has teeth), plus goal names in order, goal types and the per-container dialog map. Fixtures: `MB-YARD1-C01-001` (multi-goal mainline — 15 goals, the goal-heaviest of the accepted quests, 7 blocks/9 entries), `WC-CYCLOPS-MAIN-002` (dialog-heavy — 7 blocks/**27** entries, the entry-heaviest), `WC-UNICORN-MAIN-004` (`GOAL_TYPE_USAGE` ×4 = **all** USAGE goals in the corpus), `WC-UNICORN-MAIN-007` (`GOAL_TYPE_BOUNTY`, 4 corpus-wide), `WC-FIRECAT-MAIN-004` (`GOAL_TYPE_SCAVENGE`). Deep goal reconstruction **is** what shipped — real `GoalCompilation`/`ClientTagList`/`MadlibBlock`/`ActorDialog` blobs; the timeboxed minimal-envelope fallback was **not** invoked. |
| **ac3** fixtures committed under `server/test/fixtures/captures/` as reproducible generator artifacts, pinned for CI | **PASS** | 5 strict-JSON captures + `README.md` recording, per fixture, the exact `fixturegen` command, the corpus source path, the corpus pin and the sha256. Reproducibility is asserted, not claimed: the verifier regenerates every fixture and requires **byte equality** (5/5 identical), and the fixture ids are deterministic (FNV-1a-64 — no timestamps). `git check-ignore` confirms the directory is **not** ignored, so the artifacts are committable; `server/test/fixtures/captures/README.md` carries the one-line rebuild + verify sequence. |

## What the work turned up: D46 (blob contract + four upstream reader defects)

**The plan's "offset 1/16" are `PropertyFlags` masks, not byte offsets.** `ObjectSerializer.Deserialize<T>`
has a `uint propertyMask` overload (`ObjectSerializer.cs:216`), and `Prop_Save = 1`,
`Prop_AuthorityTransmit = 16`. There is **no padding byte** — and the write direction has a
canonical precedent inside Imview itself
(`src/Imview.Core/Services/TemplateSerializerService.cs:130-134`), using the same
`new ObjectSerializer(false)` construction the reader uses. So the generator re-serializes the
corpus objects with the matching mask: `GoalCompilation`/`ClientTagList`/`MadlibBlock` with mask 1,
`ActorDialog` with mask 16. That symmetry, not hand-written byte layouts, is why goal names, types
and dialogs come back intact; the generator still self-checks each blob by decoding it before
writing, and zero-pads the partial trailing byte that `BitWriter.GetData()` silently drops.

**`MSG_QUESTOFFER.Level` is unrecoverable through the reader — and that was not merely a failed
comparison.** The field carries no `ExtractMethod`, so `PacketReaderService.GetDefaultValue` does
`node["value"].GetValue<object>()` (a `System.Text.Json.JsonElement`) and `Convert.ChangeType`
throws, swallowed into `default(int)`. Reproduced with the level as a number, a string and a float.
Left alone, the extraction pipeline would have written **level 0 into the owner's corpus for
286/322 quests**. The capture's level is ours to read and Node must never parse captures
(architecture rule 4), so the CLI wrapper now restores it from the same capture it already
validates (`ReadOfferLevels`/`ApplyOfferLevels`, tolerating an int or a whole float) — a deliberate,
documented repair rather than a pure passthrough. This is why `level` left the verifier's
`KNOWN_READER_DEFECTS` map: with the repair in place a level mismatch means the repair broke, not
that the reader is excused.

**The reader's own logging could corrupt the payload.** A non-empty dialog `Persona` makes
`TemplateManifestService` `Console.WriteLine` a "Could not find template ID" warning, which broke
`JSON.parse(stdout)` on the real-capture path (the fixtures had worked around it by writing an empty
persona). The wrapper now keeps `Console.Out` redirected to stderr for the duration of the build
call. Proven on the failing path: a capture generated with `--persona DS-TEST_Persona` yields
**107 608 B of valid JSON on stdout** and the two warnings on stderr (7 stderr lines) — see
`story-p2-03-ac1-ac3.txt`.

**Two more upstream behaviours, recorded rather than papered over.** `AddCompletionDialogToQuestTemplate`
matches on `CompletionType == "Completion"` plus the quest id and **ignores `GoalID`**, so the
fixtures write `QuestID 0` on goal-scoped dialog packets; a real capture will show one bogus
quest-level dialog in the review UI (a product consequence for the extraction/review stories).
`MSG_QUESTOFFER.Rewards` is never read by the reader at all — and must stay empty in the fixtures,
because the corpus `m_endResults` references a result type absent from the type cache.

## Honest scope, and the one substitution that needs flagging

The generator **sweeps**: of the 322 corpus quests, **181 are generatable and 141 are refused
loudly**, each refusal naming its reason (130 goal-dialogs attached to compilation goals, 26 + 26
ACHIEVERANK, 11 with no goals, 5 with malformed quest tags, 3 duplicate ids). The corpus stores
enums as names (`"GOAL_TYPE_WAYPOINT"`, `"ACTIVITY_NotActivity"`), so any corpus reader needs
`StringEnumConverter` (D45's settings family).

**ACHIEVERANK cannot round-trip at all**: its 4 quests carry an empty `m_goalTitle` and
`m_goalNameID 0`, which breaks the reader's `{n}_{title}` naming invariant (it holds in 318/322
quests, and the 4 violators are exactly those quests). ac2 asks for "one exercising the rarest
corpus goal types", so the rarest **generatable** exact enum values stand in instead —
`GOAL_TYPE_USAGE` (×4) and `GOAL_TYPE_BOUNTY` (4 corpus-wide) — covering 6 of the 7 supported goal
types. **This substitution must be flagged in the Phase-2 PR** (gate-2) rather than quietly passed
off as a full reading of the criterion; the evidence for it is the sweep in
`story-p2-03-diversity.txt`.

## Isolation

D18/D45 checks re-run after build + generate + extract: **0** files modified under `Imview`
(fs-level, so an ignored `obj/` write would show), `Imview` git status empty, **0** files touched
under `~/.nuget`. Running any of these binaries still needs
`DOTNET_ROOT=$(dirname "$(readlink -f "$(command -v dotnet)")")` on this host — `verify:captures`
derives and exports it itself, but the permanent caller-side fix remains **p2-04**'s (D45(3)).

## Gate

The six standard checks (D40) are recorded in the round's run log: 514 unit tests, 8 UI specs,
lint, `typecheck:tests`, both `tsc` projects and the build — all green on this story's commit.
`verify:captures` is **not** part of that gate: it needs the corpus clone and the .NET binaries,
so it stays a documented, explicitly-run verification (and a future CI job would need
`actions/setup-dotnet` first — D45).