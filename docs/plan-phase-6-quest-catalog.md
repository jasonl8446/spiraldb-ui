# Phase 6 — Quest authoring: catalog, evidence, and names everywhere

**Status:** proposed (2026-09-28) — awaiting owner sign-off of the decision ledger below
**Depends on:** Phase 1 (sync pipeline, SQLite), Phase 2 (import + save pipeline), Phase 3 (quest editors). New external dependency: none (the .NET tool builds against the Imcodec submodule the repo already references).
**Spec reading order before starting:** [spec-domain-reference.md](./spec-domain-reference.md) → [spec-data-model.md](./spec-data-model.md) → [spec-api.md](./spec-api.md) → [spec-ui-design.md](./spec-ui-design.md)

> **The decisions are D-numbered.** D96–D115 are in [plan-overview.md](./plan-overview.md), and task 6.0's job is to
> update the three specs plus AGENTS.md's phase/D references to match them — not to invent them.

## Why this phase exists

**The purpose of this project is to build quest definitions, and the game files do not contain them.** That is
measured, not assumed: an exact class census over every entry of all 3,589 WADs finds **183,676 object-property
objects in 142 classes and zero `QuestTemplate`** — top-level or nested
([findings](./evidence/quest-catalog-findings.md), reproduction
[`scripts/wad-census.mjs`](../scripts/wad-census.mjs)). Quest documents are delivered over `QUEST_MESSAGES`
(ServiceID 52), which is why the owner fork's 328 quests came from hand-recorded captures and why captures alone will
never be enough.

What the game files **do** contain is almost everything needed to make building each quest quick: the quest names the
world gates on, their titles, their own text table (goal text *and* dialogue), the speakers of that dialogue, and
which world objects each quest gates. This phase turns that into a per-quest evidence surface, a worklist, and a
scaffold — so a quest can be built in the tool instead of from a blank file.

It also closes a gap that runs through every section of the app: **no list shows a friendly name beside its
technical one, and most search surfaces cannot match either.** [objects.ts](../client/src/lib/objects.ts) states the
current state in its own type comment — *"Display title: the key itself for all eight families today"* — and the
names API searches the label column only for six of its seven types.

## Measured baseline

| Measurement | Result |
|---|---|
| Game objects, exactly censused (2 container shapes) | 183,676 in 142 classes |
| `QuestTemplate` objects | **0** |
| `TutorialQuestTemplate` objects (loadable as-is) | 11 |
| Quest names the world references | **1,447** (owner fork: 328 — 4.4×; the run's D17 clone: 322) |
| … with a direct `m_entryName`/`m_displayName` link to a title key | 286 (20%) |
| … with goal names + required status | 873 (60%) |
| … with `m_destinationZone` / `m_locationName` **values** | **0** (present-but-null) |
| Quest id space: `QuestTitle_<id>` keys / `WizQst<id>_*` tables | 5,959 keys (4,780 non-empty) / **4,830 tables, 66,203 rows** |
| Corpus quests with a parseable id | 308/315; 2,602 text rows available, 1,303 used (**~50% unused material**) |
| Dialogue speaker personas resolving to a template id | 280/288 (97%) via the manifest the sync already loads |
| Files carrying a quest reference (`ReqHasQuest`/`ReqHasEntry`/`ReqIsQuest`) | 1,177 across 500 WADs |
| Hold-out accuracy of id interpolation from neighbours | **78%** (128/165) |
| Name types whose `?q=` can match the technical id | **1 of 7** (`strings` only) |
| Object families whose list row shows a friendly name | **0 of 8** |
| Object families whose global-search row can match a friendly name | **1 of 9** (quests) |
| Dialog entries whose speaker name is **composed, not stored** | **1,774 of 1,881** (94%) — `NPCFormats_First_Last` 1,449, `NPCFormats_First_Only` 325 |
| Dialog personas resolving to a real NPC name | **146 of 150** (none to an engine object) |
| NPC-name rows already imported but unused as names | `WC-NPCs` 2,641, `NPCs` 2,450, `WizardNPC` 1,237 |
| Corpus references to those tables | `WC-NPCs_*` **1,733**, `NPCs_*` 7, `WizardNPC_*` 2 |

Three consequences the phase follows from:

1. **Name is the operational key.** The world gates quests by name (`m_entryName: "DM-HOWL-MAIN-001_Complete"`), so a
   built quest named `DM-HOWL-MAIN-001` satisfies the gate. The numeric id is an attribute used to reach a quest's
   text, not its identity.
2. **The id space is the honest denominator.** ~4,830 quests have text in the client; only 1,447 are nameable from
   world data, and only nameable quests can become files. Coverage reports both numbers.
3. **A name pair is one rule in one place.** `formatNameRow` ([display.ts](../client/src/lib/display.ts)) already
   owns "how a row renders", consumed by the dropdown, the spell-name hook, the quest dialog/info readers and the
   zone-transfer shape. Every surface added or changed here renders through it — no second formatter.

## Decision ledger

Answers given by the owner on 2026-09-28. Each becomes a D-item in task 6.0.

| # | Decision | Answer |
|---|---|---|
| P6-1 | Where quest definitions come from | Captured traffic. The catalog + evidence surface is the deliverable; the acquisition harness is not on this phase's critical path. |
| P6-2 | Catalog population | Quests the world names (1,447 measured), enriched where the game links a title or goal. |
| P6-3 | The id space (~4,830) | Imported as a **second tier** (`quest_ids`), so coverage reports both denominators; the unnamed tier is never a work item. |
| P6-4 | Where a quest name lives | **`quests` absorbs the catalog** and gains `has_definition`; world evidence goes in a child table. **Amends D21.** |
| P6-5 | Creating a missing quest | The tool **scaffolds a real `QuestTemplate`** in `QuestTemplates/` (+ metadata + commit, status `extracted`) and opens it in the existing editor. No draft lifecycle. |
| P6-6 | Scaffold contents | **Minimal valid skeleton** — name, linked title when known, all 36 keys explicit with nulls, empty goals/results/dialog. Nothing inferred is ever written into a loadable file. |
| P6-7 | World evidence placement | Beside the editor, in the same view, not in a separate tool or report. |
| P6-8 | Per-quest text | **Every row of the quest's own table**, split "used by this file" / "available". |
| P6-9 | Panel action | **One-click insert** per row into the field it belongs to. Nothing is applied automatically. |
| P6-10 | Friendly names in the panel | Every field `REFERENCE_FIELDS` ([shared/quest/validation.ts](../shared/quest/validation.ts)) already declares as a reference, resolved through the synced tables. That table stays the single home for "which field references what"; no second list. |
| P6-11 | Inferred ids | Interpolate from anchored neighbours, **label the result inferred**, and accept only if the predicted id has both a `QuestTitle_*` key and a non-empty `WizQst` table; re-measure accuracy against the 321 known pairs at sync time. |
| P6-12 | Crawl + tooling | Crawl **all 6,733** zone-data files via a new batch tool; per-file CLI fallback over the 1,177 flagged files when the tool is absent. |
| P6-13 | Non-quest breadth | Zones **and** recipes stay in this phase. |
| P6-14 | Execution model | **Phase 6 under the existing D29 loop** — phase branch, one story per round, PR self-merge at CI-green, boundary gate story. |
| P6-15 | Definition of done | Evidence completeness and authoring reachable, **no throughput gate**: coverage reads "*n* defined of 1,447 nameable of ~4,830 that exist", with *n* taken from the `coverage` view and the corpus named (322 in-run, 328 in production). |
| P6-16 | Friendly + technical names | Shown **paired in every section** — every list, table, detail header, picker option, search-palette row and the quest editor's Info/Goals/Requirements/Results/Dialog sections — and **every search matches either** the friendly or the technical value. |
| P6-17 | NPC names | A **first-class searchable namespace plus an NPC view** — keyed on the NPC (template/persona), with the name strings as aliases, so "Gretta" and "Gretta Darkkettle" are one NPC rather than two. Delivered as a `SEARCH_GROUPS` entry plus a dedicated NPC view endpoint, **leaving the seven-type names contract frozen** (G7): the names API's row is single-id and an NPC's identity is dual (template id *and* persona name), while the NPC view is an aggregate, not a name list. |
| P6-20 | Final-gate mechanics | The three existing `final-*` stories are **reset to `passes:false`** and re-run over the cumulative tree after gate-6, with `final-verify`'s criterion amended through `prd_amend` to name P6 alongside P1–P5. One authoritative closing gate; the previous run's evidence files stay in `docs/evidence/`. |
| P6-18 | Loadability bar | **A live Imlight boot is part of the gate**, not a proxy: the full chain (Aurorium serves the revision, Imlight loads it), asserted from Imlight's own `SpiralDB loaded … {7} quest templates` log line showing the count rise by exactly one. "Appears in game" stays an owner post-run note. |
| P6-19 | Run rules for Phase 6 | **Ownership follows the starter**: use a sibling service already answering, otherwise start it and stop only what was started. Five owned ports (12369, 12500, 12000, 12333, 8080). The Imlight config copy sets `SpiralDBDisableRemote=true` and `SpiralDBLocalPath` → the D17 clone (D80(c) keeps the frozen corpus frozen), and Aurorium's `[patch] host` points at a refused port so no retail fetch happens. An Imlight-leg failure fails the phase and reports (D29). |

## Deliverables

1. A **quest catalog**: every nameable quest with its world evidence, plus the unnamed id tier.
2. A **per-quest evidence surface** in the editor: title, own text (used/available), dialogue with named speakers,
   world goal gates, and friendly names for every reference field.
3. **One-click insert** from evidence row into field.
4. **Scaffold-from-catalog**: create a real quest file for a missing quest, from the worklist.
5. **Coverage reporting** with both denominators.
6. **Names everywhere**: a friendly/technical pair on every section's rows and pickers, searchable either way.
7. **Breadth** through the same machinery: real zone data (`WizZoneData`, 3,377), recipes (12,402), decks (599).

## Prerequisites for an unattended run

Measured 2026-09-28 on this machine. The point of listing them is that D29's no-human contract means **anything
requiring a human must be done before launch**, and anything requiring new code must be a story rather than an
assumption.

### Corpus numbering — state which corpus, always

The run measures the **D17 clone (322 quest files**, `data/test-spiraldb`, HEAD `18dc924`**)**; production measures the
**owner's fork (328)**. D80(c) keeps the clone frozen on purpose, so both numbers are correct in their own context and
neither may be quoted for the other. Every corpus-derived expectation in this document is therefore written as
"the corpus under test", and any figure in a PR, an evidence file or a criterion names the corpus it came from. Two
recorded consequences: the sync's `has_definition` count reads **322** in-run and **328** in production, and the
coverage headline reads its number from the `coverage` view rather than a hard-coded constant.

### Owner actions — cannot be delegated

| # | Action | Why it cannot be the loop's |
|---|---|---|
| 1 | **Approve this plan and its ledger (P6-1…P6-19).** | The loop's ambiguity rule resolves *unknown* ambiguities and records them; it must never invent an owner decision. Today the ledger is written into this document only. |
| 2 | Inhibit suspend for the run duration (existing prereq 4). | An idle suspend parks the goal loop; resuming needs a keystroke. |
| 3 | Confirm quota headroom immediately before launch (existing prereq 5). | The loop cannot extend its own budget. |

Nothing else needs installing: the environment is already sufficient (below).

### Environment — verified present, no owner action

| Need | Measured |
|---|---|
| .NET 9 SDK for our builds | `9.0.318` on PATH (`dotnet --version`) |
| **.NET 10 for Imlight** | `10.0.401` **already in the nix store** (`…-dotnet-sdk-wrapped-10.0.401/bin/dotnet`, runtime `10.0.12`). Not on PATH; the harness sets `DOTNET_ROOT` to the store SDK's `share/dotnet`. Imlight targets `net10.0` and the default `dotnet` (9) cannot run it — measured: *"You must install .NET to run this application."* |
| Imlight's build inputs | present: `submodule/Imcodec/…/GeneratorInput/r806919_Wizard_1_610.json` (13.8 MB) + the `*Messages*.xml` set |
| A prebuilt Imlight | `src/Imlight.Director/bin/Debug/net10.0/` (866 MB, built 2026-09-27); **verify it is not stale** against the Imlight HEAD before trusting it, or rebuild with the D18 flags |
| A patch server for Root.wad | prebuilt `Aurorium/target/debug/aurorium` + `cargo` on PATH; its `data/` already holds the revision |
| Chromium for UI evidence | `tools/.playwright-browsers/chromium-1243` |
| GitHub MCP + git remote | `gh` authenticated as `jasonl8446`; `origin=git@github.com:jasonl8446/spiraldb-ui.git` |
| A free port budget | 12369 (Aurorium HTTP), 12500 (Imlight patch), 12000 (login), 12333 (game), 8080 (embedded RavenDB), plus the suite's 3001/5173 — all bind-checked and owned (D93) |

### Harness work that must be a story, not an assumption (task 6.11)

Measured blockers, each with the exact failure:

1. **Imlight will not boot without a patch server.** Booting the copied output aborts with
   `System.Exception: Patch server is not reachable. Cannot load Root.wad.` — its `LocalWadCache` (`./cache`) is an
   empty **LiteDB** database and it looks for a `FileDefinition { Filename, Size, Crc }` for `Root`. So the chain
   needs Aurorium serving, not a seeded cache.
2. **Paths are cwd-relative** (`LocalWadCachePath = ./cache`, `EmbeddedDatabaseDataDirectory = ../ImlightEmbeddedDatabase/`),
   which is what makes a workspace copy viable — and means the run directory and its parent must both be in the
   workspace.
3. **`SpiralDBLocalPath` is an absolute path to the owner's real fork** and `SpiralDBDisableRemote = false`. Both must
   be overridden in the copy, or the run reads the wrong corpus and can fetch over the frozen clone.
4. **Aurorium has no offline flag.** Its revision checker polls at boot and downloads into `save_directory`; the
   harness points `[patch] host` at a refused port so the poll fails soft, and runs it with a workspace cwd so its
   DB and logs land in the workspace.
5. **The assertion is Imlight's own log line** — `SpiralDB loaded {0} files: … {7} quest templates, {8} zone data
   entries.` — so the gate reads a count from the process under test rather than from a fixture of our own making.

### Changes required before launch

None of these are code; all of them are things the run cannot do for itself on day one, or would do wrongly.

| Change | Where | Why it is required (measured) |
|---|---|---|
| Regenerate the PRD: add `p6-*`, add **`gate-6`** (enumerating the P1–P5 suites *plus* P6's), reset the three `final-*` stories to `passes:false` and amend `final-verify`'s criterion to name P6 | `.omd/prd/spiraldb-ui.json` | `gate-4-ac1` enumerates *"Phase 1-4 acceptance suites (19 + 15 + 13 + 14 checkboxes)"*; `final-verify-ac1` enumerates *"P1 1-7, P2 1-8, P3 1-6, P4 1-6, P5 1-6"*; and all three `final-*` stories are already `passes:true`, so they will not re-run on their own |
| Fresh goal with `max_goal_rounds = 120`, branch `phase-6-quest-catalog` cut from `main` | launch | D29's execution model; the previous run used **117 of 120** rounds for five phases, and Phase 6 adds ~16 stories |
| Add the run directories to `.gitignore` (`tools/.imlight-run/`, the Aurorium run dir, the embedded-database dir) | `.gitignore` | the Imlight copy is **866 MB**. `tools/bin/`, `.obj/`, `.artifacts/`, `.nuget/` and `.playwright-browsers/` are ignored, a new run directory is not — and D83 records a falsification break that `git add -A` committed. eslint and prettier already skip `tools/**`, so git is the only exposed surface |
| Update `spec-api.md`: the evidence + coverage endpoints, the widened `?q=` contract, the NPC view endpoint. **L13's seven types stay put** (P6-17/G7) | `docs/spec-api.md` | `tests/unit/names.test.ts` re-types the seven from L13 and builds the unknown-type 404 message from them |
| Update `spec-ui-design.md`: the Catalog view **and its route** | `docs/spec-ui-design.md` | `tests/unit/ui-shell.test.ts` locks the nav/route tables *"against spec-ui-design L73-93 and spec-api L325-350"* — the route must exist in the spec before the code does |
| Update `spec-data-model.md`: the `quests` columns, `quest_catalog_refs`, `quest_ids`, the `coverage` view | `docs/spec-data-model.md` | migration `0002`; D31 means the code side needs the new file only |
| Update `plan-overview.md`: the Phase 6 row in the phase table + phase log, and P6-1…P6-20 as D-items | `docs/plan-overview.md` | it is authoritative and the PRD is generated from the phase docs |
| Update `AGENTS.md`: the phase list and the D-summary line | `AGENTS.md` | it currently enumerates five phases and D1–D95 |
| Create `docs/evidence/phase-6/` | `docs/evidence/` | D23's evidence protocol; `.omd/` is gitignored, so evidence has to live under `docs/` |
| Seed an author identity | `settings.user_name` | measured **empty**, and the save pipeline treats an empty author as an actionable failure |
| Assert the prebuilt Imlight's freshness, or rebuild it with the D18 flags | task 6.11 | its output is dated **2026-09-27 10:32** and HEAD `6e5966b2` is **12:56** — but the only commits since touch `docs/` and `src/**/AGENTS.md`, so it is code-current today. The harness asserts *"no commit after the DLL's mtime touched `src/**/*.cs` or `*.csproj`"* rather than trusting a date |

`scripts/wad-census.mjs` stays: it is the reproduction every number in this document cites.

### Identity and write rules

- `settings.user_name` is **empty** in the live database and the save pipeline treats an empty author as a failure
  (route comment: *"the pipeline's own actionable `SpiraldbFileError` (e.g. an empty `settings.user_name`)"*). The run
  therefore sets an explicit author before any save acceptance.
- Every write stays in the workspace: the repo, `data/`, `tools/.artifacts`, the run copies, and the D17 clone. The
  owner fork, Aurorium, Imlight and Imview stay read-only — the run executes Aurorium's binary and Imlight's copy but
  writes into neither tree.

## Tasks

### 6.0 Decision record — **S**
Append P6-1…P6-16 to [plan-overview.md](./plan-overview.md) as the next free D-numbers, update AGENTS.md's phase list
and decision summary, and add this phase's row to the overview's phase log. Update `spec-data-model.md` (the `quests`
change + new tables), `spec-api.md` (evidence, coverage, and the widened `?q=` contract) and `spec-ui-design.md` (the
evidence panel, the Catalog view, and the name-pairing rule). **No code before this lands**, because P6-4 amends a
numbered decision and P6-16 changes a display contract that 11 UI spec files already touch.

**Acceptance:** every P6-x appears as a D-item with its rationale; AGENTS.md references Phase 6; the three specs
describe the new shapes, routes and the pairing format.

### 6.1 WAD index reader + entry selection — **S**
Pure TypeScript, no .NET: `server/src/services/sync/wadindex.ts` reads a `*.wad` entry index without decompressing a
payload, for both header versions (v2 has a padding byte v1 lacks). Entry layout:
`offset, size, compressedSize, isCompressed, crc32, nameLength, name`; offsets absolute from file start. Plus
`selectEntries(wads, globs)`. Reference implementation and its measured numbers:
[scripts/wad-census.mjs](../scripts/wad-census.mjs).

**Acceptance:** enumerates 3,589 WADs / 550,616 entries with 0 parse errors in one pass; selects the 6,733
`gamedata.bin` + `triggers.xml` entries (48.7 MB) without reading a payload; unit-tested on committed v1 and v2
fixtures, and a truncation case that throws rather than under-reporting.

### 6.2 Batch extract + deserialize tool — **M**
`tools/WadScan/` (assembly `wad-scan`, `npm run build:wadscan`), modelled on `tools/FixtureGen`. It exists because
the shipped `imcodec` CLI has no batch mode: one process per file measured **78 s per 400 files** (~22 min for
6,733).
- `wad-scan census --gamedata <dir>` — the class census (both shapes).
- `wad-scan extract --gamedata <dir> --select <globs> --out <ndjson>` — deserialize selected entries with
  `Imcodec.ObjectProperty.BindSerializer` (the same call `imcodec op file` makes) and emit one compact NDJSON row per
  entry.
- Add `ProjectReference`s to `Imcodec.Wad` and `Imcodec.ObjectProperty` in this repo's csproj. The Imview submodule
  stays read-only.

**Acceptance:** `census` reproduces 183,676 objects / 142 classes; `extract` emits all 6,733 rows in < 60 s; a
missing binary yields a typed `skipped` result rather than a failed sync, and every unit test injects a fake (CI has
no .NET SDK — D55).

### 6.3 Quest reference + id-link extractor — **M**
Consume 6.2's NDJSON and build, per quest: the name, goal names + `m_requiredStatus`, the referencing
`{wad, entry, class}` provenance, and the id link — direct (`m_entryName` + `m_displayName`) or **inferred**
(P6-11), each carrying `link: 'direct' | 'inferred'` and the inference's basis.

**Acceptance:** against the real tree, 1,447 distinct names, 286 direct links, 873 with goal names, and 0 rows
without provenance; inferred links accepted only when the candidate id has a `QuestTitle_*` key and a non-empty
`WizQst` table; hold-out accuracy computed at sync time and recorded (**78%** today); `ReqHasEntry` rows with an empty
`m_questName` counted as registry checks, never as quest references.

### 6.4 Schema: `quests` absorbs the catalog — **M**
Migration `0002_quest_catalog.sql`:
- `quests` gains `has_definition`, `link_kind`, `title_source`, `reference_count` (existing `quest_name` PK unchanged).
- `quest_catalog_refs(quest_name, wad, entry, class, goal_name, required_status)` + indexes.
- `quest_ids(quest_id, title_key, title, text_rows, matched_quest_name, link_kind)` — the second tier (P6-3).
- A `coverage` view, so the UI's numbers have one definition.

The sync stage runs inside the **existing** transaction (P6-4 keeps transactional replace): corpus rows first, catalog
rows merged, refs and ids replaced. `has_definition` comes from the corpus scan the sync already performs.

**Acceptance:** after a real sync, `quests` holds ≥ 1,447 catalog rows and **every corpus row in the corpus under
test** carries `has_definition = 1`; both coverage denominators equal `count(*)` on their tables; two consecutive syncs produce
identical counts; the sync still succeeds with `wad-scan` absent, catalog stage `skipped` with a message.

### 6.5 Names everywhere: the pair, and search either — **M** *(cross-cutting; P6-16)*
One display rule and one search contract, applied in every section.

- **The pair** extends `formatNameRow` in [display.ts](../client/src/lib/display.ts) — the single home — following the
  convention already there (`Name (ID)`, [`npcDisplayName`](../client/src/lib/display.ts)). Per family:

  | Family | Technical | Friendly source | Pair |
  |---|---|---|---|
  | QuestTemplate | `m_questName` | `quests.title` (title key) | yes |
  | NpcInventory, NpcSpellInventory, NpcDropTable, TreasureCardInventory | `TemplateID` | `npcs.name` | yes, when the template is an NPC |
  | ZoneTransfer | `ZoneName` | `zones.display_name` / humanizer | yes |
  | CreatureSpellbook | `DeckName` | none today — needs a `decks` table from `DeckTemplate` (599 objects) | with 6.9 |
  | DropTable | `Name` | `description` is NULL in **316 of 317** rows — the key *is* the name | **no** |
  | GlobalRegistry | dictionary key | none | **no** |

  Families with no friendly source render the technical value alone and say why in the spec, rather than inventing a
  humaniser that would read as a name. The `ZoneTransfer` join is verified, not assumed: the corpus key
  `DragonSpire/DS_A2_Battle/DS_A2Z3_Detention` resolves in `zones` to
  `Dragon Spire / DS A2 Battle / DS A2Z3 Detention`.

  **`npcs` is not a roster.** Its 23,033 rows are client *object templates* with no type classification (D33): the low
  ids are engine objects (`Player Object`, `PetObject`, `GenericCinematicActor`, `AcousticsTemplate`) and the NPC ids
  hold real names (`Merle Ambrose`, `Zarek Pickmaster`). The four TemplateID families therefore pair only when the
  template is an NPC; a row whose template is an engine object renders the technical value alone.

- **NPC names (P6-17)** are their own namespace, because the corpus's dominant name reference is not `npcs` at all:
  `WC-NPCs_*` is referenced **1,733** times, and `m_nameOverride` stores a *key* (`WC-NPCs_00000027` ×28,
  `WC-NPCs_00000030` ×17), never literal text. The namespace is built from `WC-NPCs` (2,641), `NPCs` (2,450) and
  `WizardNPC` (1,237) — all already in `string_table` — plus the `Persona,First` (78) / `Persona,Last` (57) components
  the composition format consumes.

  It is **keyed on the NPC, not on the name string**: one NPC legitimately carries several strings at different
  granularities (`WC-NPCs_00000003 = "Gretta Darkkettle"`, `WC-NPCs_00000009 = "Gretta"`, `NPCFormats_First_Last` →
  "Merle Ambrose", `NPCFormats_First_Only` → "Merle"). Keying on the string would split one NPC into four. The name
  strings are aliases; the NPC's identity comes from the persona/template, which is also what makes the reverse view
  answerable.

  **The NPC view** — one NPC → its personas, dialogs, quests and NPC-keyed inventories — is the entry point the four
  TemplateID families cannot provide on their own.

- **Speaker names follow the client's own precedence**, not a single lookup. Per dialog entry:
  `m_nameOverride` (99 corpus entries; a string-table key in any category) → else `m_nameSTKey` (94%) resolved through
  `NPCFormats_First_Last` / `NPCFormats_First_Only` against the persona's first/last components → else the persona's
  template name via the manifest (146/150 personas). `m_cameraName` (56%, e.g. `Cinematic Camera - Cyrus Drake`)
  is a display hint only and never the name.
- **Search either**: `NAMES_TYPE_SPECS.searchColumns` ([names.ts](../server/src/services/names.ts)) widens from the
  label column to include the id column for items, spells, npcs, quests, zones and drop_tables (only `strings` does
  this today). `SEARCH_GROUPS` ([search.ts](../server/src/services/search.ts)) gains the missing `nameJoin`s so the
  seven generic families match a friendly name via their table (`npcs` for the four TemplateID families, `zones` for
  ZoneTransfer), reported through the existing `matched_on: 'key' | 'name'` field.
- **The object lists need data, not a formatter.** `ObjectListRow.title` is built server-side —
  [objects.ts](../server/src/services/objects.ts) L257 pushes `title: key` and its type comment records that this is
  true *"for all eight families today"*. So the row gains `friendly_name: string | null`, resolved per family from the
  synced tables (`npcs`, `zones`, `decks`), and the **client** pairs it with the key through the single display rule.
  The server emits data and never formats, which keeps one formatter rather than two.
- **Surfaces**: the key cell of `ObjectTable`, the detail headers, `FriendlyNameDropdown`'s trigger and options, the
  `SearchPalette` rows, `NewObjectControl`, and **every section of the quest editor** — Info, Goals, Requirements,
  Results, Dialog — wherever a value is a reference.

**Acceptance:** typing `12` finds the item whose gid is 12 and the item named "12…"; typing `Cyrus` finds both the NPC
and the four TemplateID-family rows keyed by him, each flagged `matched_on`; each list row's `friendly_name` is
resolved server-side and paired client-side by the one display rule (a test asserts no second formatter exists in
the client bundle); families with no friendly source render the technical value alone; the **11 UI spec files that touch today's display strings** — 6 contain the pair
pattern and 3 assert the NPC pair outright — are each updated deliberately, with the change stated in the PR.

Searching `Gretta` finds **one** NPC carrying both `Gretta` and `Gretta Darkkettle` as aliases, not two rows; the NPC
view's counts equal a direct query for that NPC; a speaker name resolves through the documented ladder
(override → composed → template name) and a composed entry shows the composition rather than a raw key; a
TemplateID family whose template is an engine object (`GenericCinematicActor`) renders technical-only.

### 6.6 Per-quest evidence API — **M**
`GET /api/quests/:name/evidence` and `GET /api/quest-ids/:id/evidence`, one shape: title (+
`title_source: 'direct' | 'inferred' | 'none'`), the quest's own text rows each marked `used_by_this_file: boolean`,
the goal gates (name, required status, referencing objects), dialogue lines with the resolved speaker name and
portrait/sound paths, and every reference field resolved through `REFERENCE_FIELDS` (P6-10) using the synced tables,
rendered through 6.5's rule. Resolution is a live join over indexed tables — no materialised evidence table.

**Acceptance:** for `WC-CYCLOPS-MAIN-002`, the response carries its title, its own rows split used/available, and the
dialogue lines the corpus records, with the speaker resolved by name; personas missing from the manifest (8/288) fall
back to the raw string and are counted, never dropped; an unknown quest 404s; an id-only quest returns the id tier
with `title_source` honest; shape covered by a unit test on committed fixtures, not the 19 GB tree.

### 6.7 Evidence panel + one-click insert — **L**
In the quest editor (view and edit modes) and reachable from a catalog entry: 6.6's surface grouped by field, each
"available" row carrying an insert action into the field it belongs to (P6-9) — dialogue into the focused `m_dialog`,
goal text into the focused goal, location name into `m_locationName`. Nothing inserts automatically; a warning that
cannot block Save applies exactly as elsewhere (D72).

**Acceptance:** inserting a dialogue row sets the field and the file's `git diff` shows only that field; an inferred
title is visibly marked inferred; the panel never writes to the file; covered by a tier-1 UI spec plus a unit test of
the insert reducer.

### 6.8 Scaffold-from-catalog — **M**
From a catalog entry with `has_definition = 0`: write `questtemplates_<quest_name>.json` via the existing save
pipeline (template + companion metadata + commit), containing the 36 keys in corpus order with explicit nulls, the
name, the linked title only when a direct link exists (P6-6), and empty goals/results/dialog. Then open the editor on
it with the evidence panel beside it. The requirement-tree dropdown already accepts the name because `quests` holds
every catalog row (P6-4).

**Acceptance:** a scaffolded file validates against the corpus schema and loads on Imlight unchanged; `m_questTitle`
is written **only** for a direct link; the metadata records the catalog provenance; a test asserts the writer refuses
any path outside `QuestTemplates/`; `has_definition` flips to 1 on the next sync.

### 6.9 Zone, recipe and deck breadth — **M**
Through the same 6.2 tool: `WizZoneData` (3,377) with real `m_zoneName` / `m_zoneDisplayName` into `zones`
(replacing D21's corpus fallback), `RecipeTemplate` (12,402) into `recipes`, and `DeckTemplate` (599) into `decks` —
which is also what gives CreatureSpellbook its friendly name (6.5). All three keyed with the D35 manifest-id
provenance. The zone-format rule stays a warning, not a block (D79).

**Acceptance:** `recipes` holds 12,402 rows with 0 dropped and `decks` 599; `zones` reconciled explicitly (old 1,241
vs new count both reported) and every corpus `m_destinationZone` still resolves; CreatureSpellbook rows show a paired
name once `decks` is populated; no editor dropdown regresses.

### 6.10 Coverage UI + unnamed-class investigation — **M**
Coverage header on the Quests page and the Catalog view, reading the `coverage` view: "*n* defined of 1,447 nameable
of ~4,830 quests the client holds text for", where *n* is read from the view and never hard-coded, with a missing-only filter and a link from each row into the evidence
panel or the scaffold action. Separately: **investigate the 14 unnamed class hashes** (10,274 objects, e.g.
`0x06daac43` ×3,377) that are neither classes nor properties in `ClientDump.json`; record what they are, or record
that they remain unknown, and confirm none is quest-shaped.

**Acceptance:** the header equals the API (asserted, not recomputed); the filter is covered by a tier-1 spec and a
query-builder unit test; the numbers are text, not colour-only (D85); the unnamed-class finding is recorded in
[the findings doc](./evidence/quest-catalog-findings.md) with its evidence either way.

### 6.11 Live-load harness: Aurorium serves, Imlight loads — **M** *(P6-18, P6-19)*
The story the loadability bar needs and the plan did not have.
- A workspace run directory holding a **copy** of Imlight's built output (866 MB) and a `Config/Imlight.ini` copy
  with `SpiralDBLocalPath` → the D17 clone, `SpiralDBDisableRemote=true`, and a free port set.
- An Aurorium launcher: prebuilt binary, workspace cwd, workspace-local `config.toml` whose `[patch] host` is a
  refused endpoint (no retail fetch) and whose `save_directory` points at the existing revision read-only; its DB and
  logs in the workspace.
- **Ownership follows the starter** (P6-19): probe 12369 first; use a live server and leave it alone, otherwise start
  one and stop only what was started. Same rule for Imlight.
- **Port ownership**: bind-check 12369 / 12500 / 12000 / 12333 / 8080 before starting and assert the answering process
  is ours — D93's lesson was a decoy on 3001 serving 11 readiness probes while the suite stayed green.
- **The assertion**: run the Director, tail its log for
  `SpiralDB loaded … {7} quest templates`, and prove the count rises by exactly one after 6.8 scaffolds a quest, with
  the baseline count taken from the same log before the scaffold. Evidence (log excerpt + counts) goes to
  `docs/evidence/phase-6/`.
- **Database settings the copy must pin.** `PlayerDatabaseUrl` stays **empty**: measured,
  `RavenDatabaseSingleton.Certificate` is `null` whenever `Url` is empty, so `../playerdb-dev-1yr.pfx` is never
  opened — and no `.pfx` exists anywhere in the Imlight tree. Setting a URL would instantly make that certificate a
  hard requirement of the run.
- **Freshness assertion.** Keep the prebuilt output only while no commit after its mtime has touched
  `src/**/*.cs` or `*.csproj`; otherwise rebuild with the D18 flags. Measured today: the two commits after the build
  are docs-only, so the 866 MB copy is code-current — but that is a check, not a property to assume.
- Shared by every later criterion that mentions "loads on Imlight"; `npm test` must not require it (it needs .NET 10,
  a Rust binary and five ports), so the unit suite injects a fake log.

**Acceptance:** the harness boots the chain from a clean run directory and reports the quest-template count from
Imlight's own log; the count rises by exactly one across a scaffold; a second run reuses a live Aurorium without
stopping it; the harness refuses to start when one of the five ports answers from a process it does not own, and says
which; `npm test` passes with the harness absent.

## Phase acceptance criteria

- [ ] `node scripts/wad-census.mjs …` reproduces every number in the baseline table.
- [ ] `npm run build:wadscan && tools/bin/wad-scan extract --select …` emits all 6,733 rows, timed and recorded.
- [ ] `npm run sync`: catalog rows ≥ 1,447, `has_definition` equal to the corpus-under-test count, both coverage
      denominators correct; a second run is identical in counts.
- [ ] Sync with `tools/bin/wad-scan` removed succeeds, catalog stage `skipped`.
- [ ] Every section shows the pair where a friendly source exists, and matches either way: verified per family in the
      table above, including the three that legitimately show the technical value alone.
- [ ] One NPC resolves to a single entry with all its name aliases, and the NPC view lists its personas, dialogs,
      quests and NPC-keyed inventories with counts that match a direct query.
- [ ] For one quest, the evidence panel shows title, used/available text split, dialogue with a named speaker, and
      world goal gates; one insert round-trips into the file with a single-field diff.
- [ ] One quest scaffolded from the catalog is **loaded by a live Imlight boot**, proven from its own
      `SpiralDB loaded … quest templates` line rising by exactly one (task 6.11); "appears in game" is recorded in the
      PR as an owner post-run step, not claimed by the run.
- [ ] `npm test` green including the injected-fake path and archive fixtures; `npm run lint` clean; tier-1 UI specs
      green (each touched spec named in the PR).
- [ ] P6-1…P6-16 present in plan-overview.md with D-numbers, and the three specs updated.

## Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| 19 GB of WADs read per sync | Slow sync | 6.1 reads indexes only; payload reads limited to the 48.7 MB / 6,733-file selection. Census measured at 25 s, budgeted at < 90 s. |
| Per-file CLI fallback is the only path without the tool | ~22 min sync | 6.2 ships the batch tool; both numbers recorded so a regression is visible. |
| CI has no .NET SDK (D55) | New tool unbuildable in CI | TS consumer injects a fake; a missing binary is a typed `skipped` result. Unit fixtures carry every shape. |
| Amending D21 breaks an assumption elsewhere | Silent change in names/search/validation | 6.0 records the amendment first; blast radius enumerated (names.ts, search.ts, status.ts, validation.ts) and each checked in 6.4. |
| Changing the display contract touches existing UI specs | Red CI, or specs relaxed to pass | 6.5 names the **11 spec files** that touch these strings (3 assert the NPC pair outright) and requires each change to be stated in the PR rather than loosened silently. |
| A humaniser invents a name where none exists | Users trust a fabricated label | Per-family table states which families have no friendly source; those render the technical value and say why. |
| One NPC carries several name strings at different granularities | The same NPC appears as two or more entities, and a search for "Gretta" returns duplicates | The namespace is keyed on the NPC (persona/template) with the strings as aliases (P6-17), asserted by a unit test using the measured `Gretta`/`Gretta Darkkettle` pair. |
| `npcs` mixes NPCs with engine templates | A list row pairs an id with `GenericCinematicActor`, reading as a name | The pair is rendered only for templates that appear as an NPC/persona; engine templates render technical-only, asserted by a unit test. |
| Id inference is wrong 22% of the time | Wrong title/text for a quest | Inferred links are labelled, verified against both a `QuestTitle_*` key and a non-empty table, never written into a file, and re-measured each sync. |
| The loadability bar depends on a Rust binary, five ports and a sibling service | A flaky leg fails the phase for environmental reasons | Ownership follows the starter (P6-19), every port bind-checked and owned (D93), the retail fetch neutered so the chain is offline-deterministic, and the baseline count read from the same log as the post-scaffold count so a stale service cannot pass |
| Scaffold writes a loadable file early | A half-built quest ships | Scaffolds are deliberate, validated against the corpus schema before write, and carry `status: extracted` until a live-server check. |

## Verification steps

1. `node scripts/wad-census.mjs --gamedata <dir> --classes <ClientDump.json>` → totals match the baseline.
2. `tools/bin/wad-scan extract --select gamedata.bin,triggers.xml` → **6,733 rows**, timed. (Amended by p6-03:
   this step previously listed `ObjectData/**,TutorialTips/**,Maps/**` and still expected 6,733 rows, which is
   **internally inconsistent** — measured against the real tree, that five-glob list selects **125,587** entries
   (`ObjectData/**` alone matches 117,677, `Maps/**` 613, `TutorialTips/**` 564), because entry names are matched
   case-sensitively against the **full stored name**. The 6,733 figure belongs to `gamedata.bin` + `triggers.xml`
   alone — 3,356 + 3,377, 48,765,076 B — which is what task 6.2's acceptance and the ledger's criterion both say.
   The wider families are **not** a broad glob: they are the per-file fallback tier over the 1,177 flagged files
   (P6-12/D107).)
3. `npm run sync` → `sync_history` counts; `GET /api/quests/coverage` → both denominators.
4. `GET /api/quests/WC-CYCLOPS-MAIN-002/evidence` → title, text split, dialogue with named speaker.
5. Names walkthrough per family: the list key cell shows the pair; typing an id and typing a friendly name both find
   the row; the global palette reports `matched_on` correctly.
6. UI walkthrough driven by playwright-mcp (D23 tier 2, HTTP-served): Catalog → a missing quest → scaffold → editor
   → insert a dialogue row → save; screenshots into `docs/evidence/phase-6/`.
7. Remove `tools/bin/wad-scan`, re-run sync → succeeds, `skipped`.
8. `npm test`, `npm run lint`, `npm run test:ui` → all green.

**Done when:** every acceptance criterion is checked with recorded evidence; P6-1…P6-16 are D-numbered in
[plan-overview.md](./plan-overview.md); and the baseline table has been re-measured against the corpus revision in
use.