# p2-02 — PacketReaderCli .NET wrapper + `npm run build:cli` (task 2.1)

Branch `phase-2-quest-extraction`. The wrapper that turns a packet capture into the
quest JSON the rest of Phase 2 consumes — and task 2.1a's symmetry partner.

Raw outputs: [`story-p2-02-cli.txt`](./story-p2-02-cli.txt) (build, the full contract
matrix, the apphost finding, the D18 isolation proof). New source:
[`tools/PacketReaderCli/`](../../../tools/PacketReaderCli/) — the spec's `csproj` plus
`Program.cs`, and one npm script.

| AC | Result | Evidence |
|---|---|---|
| **ac1** `npm run build:cli` produces `tools/bin/imview-packet-reader` (symlink from `tools/.artifacts`) using D18 flags only — never `BaseIntermediateOutputPath`/`BaseOutputPath` | **PASS** | `npm run build:cli` → **exit 0**, `Build succeeded`, **0 Errors** / 12 warnings, 2.67 s (incremental). `ls -l tools/bin/imview-packet-reader` → `lrwxrwxrwx … -> ../.artifacts/bin/PacketReaderCli/release/imview-packet-reader` (a **relative** symlink), `readlink -f` → the in-workspace artifacts path, `test -x` → executable. The script carries exactly two `-p:` flags (`UseArtifactsOutput`, `ArtifactsPath`) and **0** occurrences of `BaseIntermediateOutputPath`/`BaseOutputPath`. The release directory holds a complete program: the apphost `imview-packet-reader`, `deps.json`, `runtimeconfig.json`, `Imview.PacketReader.dll`, the `Imcodec.*` DLLs and `Newtonsoft.Json.dll`. |
| **ac2** CLI contract per `spec-domain-reference.md` L553–595: `--input <path>`, optional `--output <path\|->` (default stdout), JSON array of `QuestTemplate`; corrupt/non-capture input → exit 1 with a message on stderr | **PASS** | Measured matrix, each probe recording stdout bytes / stderr bytes / exit: `--help` → 0, usage **524 B on stdout**, stderr empty; **not JSON** → **1**, stderr 173 B (`is not valid JSON: … is an invalid JSON literal`); **non-capture `{"foo":1}`** → **1**, stderr 179 B naming the expected envelope shape; **`[{"data":{"name":"MSG_X"}}]`** (envelope without `fields`) → **1**; **nonexistent input** → **1**; **missing `--input`** and **unknown flag** → **1** with usage on stderr; **`[]`** (valid capture, no quest packets) → **0** with stdout exactly `[]` (2 B) and empty stderr; **`--output <file>`** (parent directories absent) → 0, JSON in the file, stdout empty; **`--output -`** → stdout. The JSON payload is the only thing on stdout, so the Node caller can `JSON.parse(stdout)` directly. |

## What the work turned up: D45 (output format, capture gate, apphost env)

Three measured refinements, recorded as decision **D45** because later tasks inherit them.

**1 — the output format is Newtonsoft, not `System.Text.Json`.** The spec's `csproj`
snippet shows no package reference, but it also omits serialization detail, and the
corpus/review format is Newtonsoft JSON whose polymorphic members carry `$type`
(spec L314/L412, notes L714–717). The authoritative settings are the game server's own
(`Imlight/src/Imlight.CoreLib/WizardData/SpiralDB.cs:48`):
`TypeNameHandling.Auto` + `NullValueHandling.Ignore`. The wrapper adds
`Newtonsoft.Json` **13.0.3** — the version every Imcodec/Imlight project pins, and
none of it is transitive from `Imview.PacketReader` — and that setting reproduces the
corpus shape exactly: no root `$type`, and
`"Imcodec.ObjectProperty.TypeCache.{Type}, Imcodec.ObjectProperty"` on each derived
`m_goals` element. Flagged consequence: the committed corpus files carry **explicit
nulls** (`"m_questInfo": null`) while these settings omit them, so writing extracted
quests back drops nulls — semantically identical for Imlight's name-keyed loader, but
diff noise that the save story (**p2-05**) owns keeping minimal.

**2 — a capture-shape gate, because the builder cannot fail.** `QuestBuilder` returns
an empty list for anything it cannot match, so a non-capture would have looked like
success and ac2's "non-capture → exit 1" could not hold. The wrapper validates before
calling it: the file must exist, parse as JSON, and look like a capture — a top-level
array (or single object) of objects carrying a string `data.name` and an object
`data.fields`. A capture that parses and contains no quest packets stays a legitimate
empty result (exit 0, `[]`), stated in `--help`.

**3 — the apphost needs `DOTNET_ROOT` on NixOS, and that is the one thing that does
not work bare.** `tools/bin/imview-packet-reader --help` with no environment exits
**131** — *"You must install .NET to run this application… Failed to resolve
libhostfxr.so"* — because NixOS keeps dotnet at `/run/current-system/sw/share/dotnet`
with no `/etc/dotnet/install_location`, and `dotnet` on `PATH` is a wrapper script.
That is why `dotnet build` works while the apphost cannot find its runtime. With
`DOTNET_ROOT` supplied, **every probe above passes**; the build and the symlink are
correct exactly as specified, and only *running* needs the variable. Adopted fix: the
caller passes it portably —
`DOTNET_ROOT=$(dirname "$(readlink -f "$(command -v dotnet)")")`, which resolves to
the SDK's `share/dotnet` here and to the right root on a stock install — so **p2-04**
(the extraction service, whose spec `execFile` passes no `env`) must set it in the
child environment and test it; a stock CI runner (`ubuntu-24.04`) needs nothing. A
host-wide alternative for the owner is a root-owned `/etc/dotnet/install_location`
containing `/run/current-system/sw/share/dotnet` — a **suggestion, not a
requirement**, and no agent-side install was attempted (the run's owner-prerequisite
rule). Also recorded: `ci.yml` never runs the CLI today, so if a later story's test
invokes the real binary, CI must add `actions/setup-dotnet` first (home: p2-04 /
gate-2).

## Not yet proven — and deliberately not faked

No real extraction has run, because **no capture file exists yet**: task 2.1a (story
**p2-03**) generates them from real fork quests. This story therefore proves the
build, the artifact, the argument contract and the failure modes; the round-trip
`capture → quests` is p2-03's first milestone. The release build's own dependency
copy (`Imview.PacketReader.dll` + `Imcodec.*.dll` beside the apphost) is the evidence
that a real extraction has everything it needs loaded.

## D18 isolation (re-confirmed)

During this build: **0** files under `Imview` modified in the build window, `Imview`
git status clean, **0** files touched under `~/.nuget`, and the new package restored
into the workspace store (`tools/.nuget/newtonsoft.json/13.0.3`).

## Gate

The six standard checks (D40) are recorded in the round's run log: 514 unit tests, 8 UI
specs, lint, `typecheck:tests`, both `tsc` projects and the build — all green on this
story's commit.