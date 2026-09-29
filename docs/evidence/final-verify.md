# final-verify — every phase's Verification Steps, re-run fresh (ultragoal final gate 3/3)

**Run:** 2026-09-29, branch `final-review`, workspace HEAD `37d7ca050c6a770f15de1ddc791b634a20806cd6`
(the repo was **read-only** for this sweep: nothing was staged, committed, stashed or branched; the
only file written is this one, plus scratch under `/tmp/fv4/`).

**Method.** Each step was read from its own plan's **Verification Steps** section
(`docs/plan-phase-{1..6}-*.md`) and executed. Raw output is quoted, trimmed only where a line is
enormous — every such trim is marked `[…trimmed]`. Nothing is inferred from a test name, a comment
or another story's evidence. A step that could not be run as written is executed as the closest
honest equivalent **and named in [Deviations](#deviations)**; a silently skipped step is a failed
verification, so there are none.

**Two things are deliberately not re-run, and are stated as facts instead:**

1. **The Phase 5 PR clause** in the criterion (*Phase 5 PR opened, CI green, merged, branch deleted,
   merge logged*) refers to **PR #7**, merged by the run that built Phase 5. `docs/plan-overview.md`'s
   phase-log table (line 241) records it verbatim:
   `5 — Dashboard & Polish | phase-5-dashboard-polish, PR #7 | 36369599921 (ci green first run, 5m14s) | 1bac35c | (no gate-5 story — the phase's boundary sweep is the ultragoal final-verify)`.
   The process clause was verified by that run in
   [`final-verify-p5-process-clause.md`](./final-verify-p5-process-clause.md) (parents = the PR's
   base/head; the remote holds only `main`). Re-doing a merge that already happened would verify
   nothing.
2. **The scaffolded-quest loadability clause** (Phase 6 AC): it was **run live, not substituted** —
   see [P6-6](#phase-6--quest-authoring-catalog-evidence-names-everywhere-8-steps).

## Environment (re-checked this run, not assumed)

| Fact | Reading |
|---|---|
| Node / npm | `v24.21.0` / `11.19.0` |
| The D17 clone pending restore | branch `content/2026-09-27`, HEAD `18dc924`, main `f3f8b5c`, rev-count **42**, porcelain **0**, `QuestTemplates/*.json` **322**, branches `content/2026-09-26 content/2026-09-27 main` |
| The owner fork `/home/jason/Documents/git-projects/spiraldb` | **328** `QuestTemplates/*.json` — a different corpus from the clone (D80(c)/D97); every count below names its corpus |
| Live database `data/spiraldb-ui.db` | `sha256 a13f9aa8376411f6c6c0ea704098fcba6c4a226298eaba114230414af9e572ac` (the pin), 38,277,120 B, mtime Sep 28 20:33 — **never opened by this sweep** |
| Scratch database | `/tmp/fv4/ui.db` — created by `NODE_ENV=test SPIRALDB_UI_DB=… npm run sync`, whose seeding (D17/D31c) points `spiraldb_path` at the clone |
| `tools/bin/` | `wad-scan`, `fixturegen`, `imview-packet-reader` (symlinks into `tools/.artifacts/`) |
| .NET | `dotnet --version` → `9.0.318`; the Imlight leg needed the Imlight apphost only |
| Owned ports | `3001`/`5173` (the dev stack this sweep booted), the tier-1 harness's `3181`/`5181`, the Imlight harness's `12369/12500/12000/12333/8080`. Nothing was left listening (see [Stopped](#stopped)) |

## Phase 1 — Foundation (7 steps)

| # | verdict | one-line result |
|---|---|---|
| P1-1 | **PASS (substituted)** | isolated `npm run sync` into a scratch DB; table counts via `better-sqlite3` (no `sqlite3` CLI on this host) — items 79,835, quests 1,717 rows / 322 with a definition |
| P1-2 | **PASS** | `{"items":[{"gid":1740074,"name":" +100 Energy Elixir"},…` |
| P1-3 | **PASS** | `summary {total:2271, extracted:2271}`; per-type: quest **322** = the clone's file count |
| P1-4 | **PASS** | PATCH → `reviewed`; `status_history` row id 1 written with notes + `reviewed_by` |
| P1-5 | **PASS** | `npm test` → 89 files / **1832 tests passed**, rc=0 |
| P1-6 | **PASS (substituted)** | shell → settings → sync → toast; the "stub page" dropdown is the real `FriendlyNameDropdown`, which stored the raw id `38098` |
| P1-7 | **PASS** | `npm run test:ui` → **418 passed**, `rc=0`, 0 failed / 0 flaky (the phase's own `shell.spec.ts` included) — see [Gate totals](#gate-totals) |

### P1-1 — `rm -rf data && npm run sync` → counts; `sqlite3 … select count(*)`

The literal `rm -rf data` would delete the owner's live database, which this sweep must keep
byte-identical, so the sync ran with the D44 override (see [Deviation D1](#deviations)):

```console
$ NODE_ENV=test SPIRALDB_UI_DB=/tmp/fv4/ui.db npm run sync
[spiraldb-ui] sync database at /tmp/fv4/ui.db
=== SpiralDB UI — friendly-name sync ===
  status              : SUCCESS
  revision            : V_r806919.Wizard_1_610
  items               : 79,835
  spells              : 18,173
  npcs                : 23,033
  quests              : 322
  zones               : 3,357
  drop_tables         : 317
  string_table        : 216,991
  persona_index       : 23,003 persona object names
  recipes             : 12,402
  decks               : 599
  manifest entries    : 137,423 ids
  dropped (PK)        : 0 rows (items 0, spells 0, npcs 0)
  unpack / scan / write: 15.1 s / 9.1 s / 558 ms
  total               : 30.3 s
  sync_history        : success row written at 2026-09-29T08:32:00Z
  catalog status      : OK
  catalog rows        : 1,449 (merged 54, new 1,395)
  quests rows         : 1,717 (has_definition = 1: 322)
```

`sqlite3` is not installed on this host (`which sqlite3` → nothing), so the `select count(*)` arm ran
through the app's own driver ([Deviation D2](#deviations)):

```console
$ node -e "…better-sqlite3('/tmp/fv4/ui.db')… select count(*) per table"
decks                    599
drop_tables              317
entry_status             2271
items                    79835
npcs                     23033
persona_index            23003
quest_catalog_refs       2855
quest_ids                4823
quests                   1717
recipes                  12402
settings                 5
spells                   18173
string_table             216991
sync_history             1
zones                    3357
```

### P1-2 — `curl -s localhost:3001/api/names/items | head -c 400`

```console
$ curl -s localhost:3001/api/names/items | head -c 400
{"items":[{"gid":1740074,"name":" +100 Energy Elixir"},{"gid":1374633,"name":" Lounging Pigswick Student"},{"gid":1374437,"name":" Placeholder"},{"gid":1664694,"name":"'Porters of the Spiral Bundle"},…
rc=0
```

### P1-3 — `curl -s localhost:3001/api/status/all | jq .summary` → totals match file counts

```console
$ curl -s localhost:3001/api/status/all | jq .summary
{ "total": 2271, "extracted": 2271, "reviewed": 0, "verified": 0 }

$ curl -s localhost:3001/api/status/all | jq '.entries | group_by(.object_type) | map({object_type: .[0].object_type, n: length})'
[ creature_spellbook 134, drop_table 317, npc_inventory 215, npc_spell_inventory 77,
  quest 322, treasure_card_inventory 1, zone_transfer 1205 ]

$ ls data/test-spiraldb/QuestTemplates/*.json | wc -l     → 322
$ ls /home/jason/Documents/git-projects/spiraldb/QuestTemplates/*.json | wc -l  → 328
```

Verdict: **PASS** — `quests` 322 equals the clone's file count exactly, and every other type matches
its directory (`NpcDropTable` absent → 0 rows). The plan's own literal path (`…/spiraldb/…`) now
holds 328; the plan's own expected number (322) is the clone's, so both are printed, each named.
`zone_transfer` reads 1205 rows against 1207 files — the documented duplicate-key collapse
(`WizardCity/Tutorial_Exterior`, `…_Interior`; D39/D76), visible in the import's own line
`import duplicate keys (first file wins): WizardCity/Tutorial_Exterior, WizardCity/Tutorial_Interior`.

### P1-4 — PATCH then history via curl; verify the `status_history` row

```console
$ curl -s -X PATCH localhost:3001/api/status/quests/DS-ACAD1-C01-001 \
    -d '{"status":"reviewed","notes":"final-verify gate-3 fresh run","changed_by":"fv-gate3"}'
{"object_type":"quest","object_key":"DS-ACAD1-C01-001","status":"reviewed",
 "extracted_at":"2026-09-29T08:32:52.682Z","reviewed_at":"2026-09-29T08:34:15.776Z",
 "verified_at":null,"latest_notes":"final-verify gate-3 fresh run"}

$ curl -s localhost:3001/api/status/quests/DS-ACAD1-C01-001/history
{"history":[{"old_status":"extracted","new_status":"reviewed",
  "notes":"final-verify gate-3 fresh run","changed_by":"fv-gate3",
  "changed_at":"2026-09-29T08:34:15.776Z"}]}

$ node -e "…SELECT * FROM status_history ORDER BY id DESC LIMIT 3"
[{"id":1,"entry_status_id":6,"old_status":"extracted","new_status":"reviewed",
  "notes":"final-verify gate-3 fresh run","changed_by":"fv-gate3","changed_at":"2026-09-29T08:34:15.776Z"}]
entry_status: [{"id":6,"object_type":"quest","object_key":"DS-ACAD1-C01-001","status":"reviewed",
  "extracted_at":"…","reviewed_at":"…","verified_at":null,"reviewed_by":"fv-gate3","verified_by":null}, …]
```

### P1-5 — `npm test`

89 test files, 1832 tests, all green (`rc=0`, 55.3 s) — the same single run read for P1-5, P2-8's
test arm, P3-2, P4-1 and P5-1. Full output quoted in [Gate totals](#gate-totals); the per-family
round-trip lines it printed are quoted at P3-2/P4-1.

### P1-6 — UI walkthrough via playwright-mcp: shell → settings → sync → toast; dropdown smoke

Shell: `/` renders `heading "Dashboard"` with the sidebar's 21-route navigation. Settings: `/settings`
renders "Friendly Name Sync", the four paths, User Name, the read-only Git Branch, Last Sync
(`79,835 items · 18,173 spells · 23,033 NPCs · 322 quests · 3,357 zones`) and the Sync History table.
Sync: clicking **Sync Now** produced the verbatim toast and a second history row:

```console
toast        : "Sync complete: 79,835 items · 18,173 spells · 23,033 NPCs · 322 quests · 3,357 zones"
history rows : 2
```

Dropdown smoke: the plan's "stub page" no longer exists (the last stub fell in p5-01/p5-08, and
`tests/ui/shell.spec.ts` asserts its text is absent on every page), so the smoke test ran against the
real `FriendlyNameDropdown` on `/npc-inventories/87112` ([Deviation D3](#deviations)):

```console
combo aria-label      : "NPC TemplateID"     hidden input name=TemplateID value=87112
opened list (excerpt) : "- not used - Life Professor (1381321) / Coralchord (4506) / … "
typed "Gretta"        : ["Gretta Darkkettle (38098)","Gretta Darkkettle (1365085)","Gretta Darkkettle (1402234)", …]
selected first item   : hidden input value → 38098 ; trigger text → "Gretta Darkkettle (38098)"
```

Screenshots: `fv-p1-06-settings-sync-toast` (settings + Sync Now), `fv-p1-06-dropdown-selected`
(the pair "+ raw id in the hidden field"). The plan says to copy them into `docs/evidence/phase-1/`;
this sweep may not write new tracked evidence there ([Deviation D4](#deviations)), so they live in the
MCP output dir (`/home/jason/.cache/playwright-mcp/`) and are listed by name.

### P1-7 — `npm run test:ui` → shell spec green headless

Run as written: **418 passed**, `rc=0`, 1.8 m, 0 failed / 0 flaky / 0 skipped — the whole collected
set, `tests/ui/shell.spec.ts` among them. See [Gate totals](#gate-totals).

## Phase 2 — Quest Extraction (8 steps)

| # | verdict | one-line result |
|---|---|---|
| P2-1 | **PASS** | `dotnet --version` → 9.0.318; both builds `rc=0`; three `tools/bin/` symlinks resolve |
| P2-2 | **PASS** | fixturegen `rc=0` (12,639 B + its own self-checks); reader `rc=0`; `jq length` → 1; name matches |
| P2-3 | **PASS** | `200 {count:1, quests:[…]}`; a non-capture → `400` with the D47 envelope; health ok after |
| P2-4 | **PASS** | real UI: 2-quest capture → results (2 rows) → confirm → identity gate → two "saved and committed" toasts |
| P2-5 | **PASS** | clone on `content/2026-09-29`; `update quest …` ×2 **and** the literal `extract quest WC-UNICORN-MAIN-004` (a create) with template+metadata in one commit |
| P2-6 | **PASS** | strict `JSON.parse` on every saved template + a metadata companion; the **pre-save** blob fails strict JSON (trailing comma) — the write is what made it strict |
| P2-7 | **PASS (conditional, measured)** | the capture note **is** written, but only when the save *inserts* the tracking row (D49(d)); demonstrated by positive control — the plan's arm assumes an untracked key |
| P2-8 | **PASS** | `npm test` green; browse → detail → Mark Reviewed → badge `Reviewed`, toast, history row with author + note |

### P2-1 — `dotnet --version`; `npm run build:cli && npm run build:fixturegen`

```console
$ dotnet --version
9.0.318
$ npm run build:cli         → Build succeeded. 10 Warning(s) 0 Error(s)   rc=0  (23.2 s)
$ npm run build:fixturegen  → Build succeeded.  4 Warning(s) 0 Error(s)   rc=0  ( 1.6 s)
$ ls -la tools/bin/
fixturegen           -> ../.artifacts/bin/FixtureGen/release/fixturegen
imview-packet-reader -> ../.artifacts/bin/PacketReaderCli/release/imview-packet-reader
wad-scan             -> ../.artifacts/bin/WadScan/release/wad-scan
```
The warnings are the sibling projects' own (NU1900 cache-permission, CS8602/CS8618 in
`Imview`/`Imcodec`); none is in this repo's code.

### P2-2 — fixturegen → reader → same `m_questName`

The binaries are .NET apphosts: on NixOS they need `DOTNET_ROOT` (D45(3)), so it was exported for
this step ([Deviation D5](#deviations) — the plan's command line omits it).

```console
$ export DOTNET_ROOT=$(dirname "$(readlink -f "$(command -v dotnet)")")
$ tools/bin/fixturegen --quest data/test-spiraldb/QuestTemplates/questtemplates_DS-ACAD1-C01-001.json \
    --output /tmp/fv4/cap.json                                   rc=0   12,639 B
  quest            DS-ACAD1-C01-001  title=QuestTitle_1ED8D  level=1  mainline=True
  goals            7 total = 6 in GoalCompilation (m_startGoals) + 1 via MSG_SENDGOAL
  dialogs          2 block(s) / 7 dialog entry(ies); 1 quest-level, 1 goal-level
  self-check       GoalCompilation blob (1507 bytes) decodes to 6 goal(s) identical to the corpus goals
  self-check       ActorDialog 'Prep' blob (2114 bytes) decodes to 5 entry(ies), trailing flags intact
  self-check       ActorDialog 'Completion' blob (964 bytes) decodes to 2 entry(ies), trailing flags intact

$ tools/bin/imview-packet-reader --input /tmp/fv4/cap.json > /tmp/fv4/cap.out.json   rc=0  32,206 B
$ jq 'length' /tmp/fv4/cap.out.json      → 1
$ jq -r '.[0].m_questName' /tmp/fv4/cap.out.json → DS-ACAD1-C01-001
```
The round-trip spot check holds: **≥1 quest, same `m_questName`**. (The plan writes `/tmp/cap.json`;
this sweep used `/tmp/fv4/` — [Deviation D6](#deviations).)

### P2-3 — `curl -F "file=@…/{capture}.json" localhost:3001/api/extract/quests | jq .count`

```console
$ curl -s -F "file=@server/test/fixtures/captures/WC-UNICORN-MAIN-004.json" localhost:3001/api/extract/quests
keys: ["count","quests"]
{ "count": 1, "names": ["WC-UNICORN-MAIN-004"] }

$ curl -s -F "file=@server/test/fixtures/captures/README.md" localhost:3001/api/extract/quests
http=400
{"error":"Unsupported file type \".md\" — only .json packet captures are accepted. Supported format: JSON packet capture files (.json)"}
$ curl -s localhost:3001/api/health   → {"status":"ok"}
```

### P2-4 — UI: upload → results → Save All (2 quests) → confirm

Driven live through playwright-mcp against the stack this sweep booted (`:5173` UI, `:3001` API, the
scratch DB). The capture was two committed fixtures concatenated (`jq -s add`, 52,789 B; the reader
returns 2 quests from it — the plan's step needs a two-quest save).

```console
input[type=file] ← /tmp/fv4/two-quests.json
results (raw list text): "MB-YARD1-C01-001 / Level 1 / 15 goals / new"  and  "WC-FIRECAT-MAIN-004 / Level 1 / 5 goals / new"
review panel tabs       : Info, Goals, Goal Logic, Requirements, Results, Dialog
confirm dialog          : "Save to SpiralDB — Save 2 quests to SpiralDB? This will create files and
                           auto-commit. These quests already exist in SpiralDB and will be overwritten:
                           MB-YARD1-C01-001, WC-FIRECAT-MAIN-004  [Cancel] [Save]"
after clicking Save     : dialog "What should we call you? … Stored locally … used to attribute
                           status changes, metadata and commits. We only ask once. [Your name]"
                           (the D38/D43 identity gate — it fires before the write, as designed)
after "Save name"       : toasts ["Imported 2,271 existing entries from SpiralDB",
                                 "Quest WC-FIRECAT-MAIN-004 saved and committed",
                                 "Quest MB-YARD1-C01-001 saved and committed"]
```
Screenshot `fv-p2-04-results`. The **extract** verb is deliberately obtained by a second save of a
quest that has no file at all — see P2-5.

### P2-5 — clone: branch, `git log --format='%s (%an)'`, `ls` the template and its metadata

```console
$ git -C data/test-spiraldb branch --show-current
content/2026-09-29                       # matches the plan's content/2026-XX-XX; created from `main`
$ git -C data/test-spiraldb log --format='%s (%an)' -4
spiraldb: extract quest WC-UNICORN-MAIN-004 (FV Gate3)
spiraldb: update quest WC-FIRECAT-MAIN-004 (FV Gate3)
spiraldb: update quest MB-YARD1-C01-001 (FV Gate3)
test-setup: make two quests not-yet-extracted (gate-2 fixture) (Jason)

$ git -C data/test-spiraldb show --stat --format='%s' HEAD | head -6
spiraldb: extract quest WC-UNICORN-MAIN-004
 .../questmetadata_WC-UNICORN-MAIN-004.json  |   6 +-
 .../questtemplates_WC-UNICORN-MAIN-004.json | 795 ++++++++++++++++++
 2 files changed, 798 insertions(+), 3 deletions(-)

$ ls -la QuestTemplates/questtemplates_MB-YARD1-C01-001.json QuestMetadatas/*MB-YARD1-C01-001* …
-rw-r--r-- 1 jason users   292 QuestMetadatas/questmetadata_MB-YARD1-C01-001.json
-rw-r--r-- 1 jason users   298 QuestMetadatas/questmetadata_WC-FIRECAT-MAIN-004.json
-rw-r--r-- 1 jason users 63886 QuestTemplates/questtemplates_MB-YARD1-C01-001.json
-rw-r--r-- 1 jason users 52519 QuestTemplates/questtemplates_WC-FIRECAT-MAIN-004.json
$ git -C data/test-spiraldb branch --list
  content/2026-09-26   content/2026-09-27   * content/2026-09-29   main
```
Verdict: **PASS**. The two re-saves are `update quest …` (those quests have files at `main`), so the
plan's literal `extract quest …` was obtained honestly by saving a quest the branch does **not**
hold (`WC-UNICORN-MAIN-004` — `main` is `test-setup: make two quests not-yet-extracted`, which deleted
it and `WC-CYCLOPS-MAIN-002`). That create produced the verb **and** the template+metadata pair in one
commit. The clone was restored to the frozen axes immediately afterwards (before the gates): the
branch **this run created** — `content/2026-09-29` — was deleted and the clone re-read as the
three-branch set, with the five-axis proof in [Pins](#pins) and the correction recorded as
[Deviation D15](#deviations).

### P2-6 — `node -e "JSON.parse(…)"` → no throw

```console
$ for f in QuestTemplates/questtemplates_WC-UNICORN-MAIN-004.json \
           QuestTemplates/questtemplates_MB-YARD1-C01-001.json \
           QuestTemplates/questtemplates_WC-FIRECAT-MAIN-004.json \
           QuestMetadatas/questmetadata_WC-UNICORN-MAIN-004.json; do node -e "JSON.parse(…)"
strict JSON OK: QuestTemplates/questtemplates_WC-UNICORN-MAIN-004.json
strict JSON OK: QuestTemplates/questtemplates_MB-YARD1-C01-001.json
strict JSON OK: QuestTemplates/questtemplates_WC-FIRECAT-MAIN-004.json
strict JSON OK: QuestMetadatas/questmetadata_WC-UNICORN-MAIN-004.json

$ git show HEAD~3:QuestTemplates/questtemplates_MB-YARD1-C01-001.json > /tmp/fv4/pre-MB.json   # pre-save blob
pre-save MB-YARD1: STRICT JSON FAILS -> Expected double-quoted property name in JSON at position 5649 (line 148 column 15)
   pre-save tail bytes : … "m_behaviors": null\n }        (no trailing comma at the end; the comma is at L148)
   post-save tail bytes: … "m_behaviors": null\n } \n     (newline added, JSON5 commas removed)
metadata companion keys: CreatedAt,CreatedBy,Description,ModifiedAt,ModifiedBy,Name,QuestTemplateId
```

### P2-7 — `curl …/api/status/quests/{name}/history | jq` → extracted row with the capture note

> **Annotation (final-review).** The plan's literal expectation is conditional on **first appearance**, and that is documented behaviour rather than a gap: the capture note is written only when the save **inserts** the `entry_status` row (D49(d)), so a database whose startup import (D91) has already adopted the corpus legitimately answers `{"history":[]}` — the positive control below (untrack → re-save → the documented note appears) is the proof of the note's own path, not a substitute for it.

**This step does not reproduce as written, and the reason is measured.** The first reading is empty:

```console
$ curl -s localhost:3001/api/status/quests/WC-UNICORN-MAIN-004/history   → {"history":[]}
$ node -e "SELECT * FROM entry_status …"
  WC-UNICORN-MAIN-004 {"id":318,"status":"extracted","extracted_at":"2026-09-29T08:32:52.682Z", …}
  (the same 08:32:52 timestamp as all 2,271 rows — the startup import, D91)
$ node -e "SELECT * FROM status_history"   → 1 row (the P1-4 PATCH, not the save)
```
The cause is the code's own contract, not a defect: `server/src/services/quests.ts` L303-307 and
`savePipeline.ts`'s `historyNotesOnCreate` write the note **when the save inserts the `entry_status`
row**; "An update of an already-tracked entry records nothing at all — no note, no status change, no
history row (D49(d))". The startup import had already adopted all 322 corpus quests (including this
one), so the save inserted nothing.

**Positive control** (the note's own path, exercised by deleting the tracking row first and re-saving
with `source`):

```console
$ node -e "DELETE FROM entry_status WHERE object_type='quest' AND object_key='WC-FIRECAT-MAIN-004'"  → 1 row
$ curl -s -X POST localhost:3001/api/quests -d '{"quest":…, "source":"final-verify-two-quests.json", …}'
http=200 {"outcome":"updated","action":"update","commit":"f8eac057…","branch":"content/2026-09-27",
          "commit_message":"spiraldb: update quest WC-FIRECAT-MAIN-004\n\nfv gate3 P2-7 source-note control"}
$ curl -s localhost:3001/api/status/quests/WC-FIRECAT-MAIN-004/history
{"history":[{"old_status":null,"new_status":"extracted",
  "notes":"Imported from packet capture final-verify-two-quests.json",
  "changed_by":"FV Gate3","changed_at":"2026-09-29T08:51:55.833Z"}]}
```
Verdict: **PASS for the note's contract** (byte-for-byte the row the plan describes), **conditional on
first appearance**. A plan-fresh database (untracked corpus) sees the row on the save; a database
whose startup import already adopted the corpus does not. Recorded as [Finding F1](#findings).

### P2-8 — `npm test` green; browser walkthrough upload → browse → detail → mark reviewed

`npm test` → 89 files / 1832 tests passed (`rc=0`). The browse arm, live:

```console
/quests  → search "MB-YARD1" → 1 row: "Extracted | Stop that Cat! (MB-YARD1-C01-001) | 1 | 15 | ✓ | Mainline"
         → row link /quests/MB-YARD1-C01-001 → detail header badge "Extracted"
         → [Mark Reviewed] → dialog "Mark MB-YARD1-C01-001 as reviewed? Notes (optional)"
         → note "final-verify gate-3 browse walkthrough" → [Mark Reviewed]
badge after : "Reviewed"
toast       : "MB-YARD1-C01-001 marked reviewed"
history     : "MB-YARD1-C01-001 marked reviewed / just now / by FV Gate3 / final-verify gate-3 browse walkthrough"
```
Verdict: **PASS**. (The list's key cell reads `Title (m_questName)` — the Phase-6 pair — which is why
the row text is `Stop that Cat! (MB-YARD1-C01-001)`.)

## Phase 3 — Quest Editing (6 steps)

| # | verdict | one-line result |
|---|---|---|
| P3-1 | **PASS** | 29 distinct strings / 8,746 occurrences / 328 files — and the constants' own audit test asserts exactly that (`[p3-01 ac1] measured: 29 distinct $type strings, 8746 occurrences over 328 quest files (the recorded baseline)`) |
| P3-2 | **PASS, re-measured** | the literal "322 passed" is the clone's file count, not a printed string: the round-trip suite prints `files discovered=322 round-tripped=322 failures=0` for the clone and `328 …` for the fork |
| P3-3 | **PASS** | one UI edit (`m_usePatron` false→true) → the template diff is **one line**; metadata diff is `ModifiedAt`+`ModifiedBy`; the data-level walk reports **1 changed value path, zero key-order drift** |
| P3-4 | **PASS** | `GET /api/quests/WC-CYCLOPS-MAIN-002` → `m_usePatron: true`; after a full reload the goal card reads `Use Patron: ✓` and the editor's checkbox is checked |
| P3-5 | **PASS** | curl: `400` + `fields["m_startGoals[0]"]`; UI: banner `1 validation error blocks saving: Unknown start goal.`, Save `aria-disabled=true data-blocked=true`, warnings intact; *Discard* restored 6 goals |
| P3-6 | **PASS (one caveat)** | flowchart 16 nodes/15 edges; requirements 4 type options + the four owner slots + a friendly reference; dialog 7/7 and 5/5 groups — group counts are DOM-verified, entry counts read from the served documents |

### P3-1 — `grep -rho '"$type": *"[^"]*"' …/spiraldb/QuestTemplates/ | sort | uniq -c | sort -rn`

```console
$ grep -rho '"$type": *"[^"]*"' /home/jason/Documents/git-projects/spiraldb/QuestTemplates/ | sort | uniq -c | sort -rn
   4175 "$type": "Imcodec.ObjectProperty.TypeCache.MadlibArgT_ByteString, Imcodec.ObjectProperty"
   1882 "$type": "Imcodec.ObjectProperty.TypeCache.NPCDialogEntry, Imcodec.ObjectProperty"
    797 "$type": "Imcodec.ObjectProperty.TypeCache.ActorDialogList, Imcodec.ObjectProperty"
    429 "$type": "Imcodec.ObjectProperty.TypeCache.PersonaGoalTemplate, Imcodec.ObjectProperty"
    323 "$type": "Imcodec.ObjectProperty.TypeCache.ResDropTable, Imcodec.ObjectProperty"
    313 "$type": "Imcodec.ObjectProperty.TypeCache.RequirementList, Imcodec.ObjectProperty"
    277 "$type": "Imcodec.ObjectProperty.TypeCache.ReqHasQuest, Imcodec.ObjectProperty"
    198 "$type": "Imcodec.ObjectProperty.TypeCache.WaypointGoalTemplate, Imcodec.ObjectProperty"
    107 "$type": "Imcodec.ObjectProperty.TypeCache.BountyGoalTemplate, Imcodec.ObjectProperty"
     52 "$type": "Imcodec.ObjectProperty.TypeCache.ReqHasEntry, Imcodec.ObjectProperty"
     36 "$type": "Imcodec.ObjectProperty.TypeCache.ScavengeGoalTemplate, Imcodec.ObjectProperty"
     34 "$type": "Imcodec.ObjectProperty.TypeCache.ResAddDynaMod, Imcodec.ObjectProperty"
     26 "$type": "Imcodec.ObjectProperty.TypeCache.AchieveRankGoalTemplate, Imcodec.ObjectProperty"
     21 "$type": "Imcodec.ObjectProperty.TypeCache.ResLearnSpell, Imcodec.ObjectProperty"
     21 "$type": "Imcodec.ObjectProperty.TypeCache.ReqSchoolOfFocus, Imcodec.ObjectProperty"
     10 "$type": "Imcodec.ObjectProperty.TypeCache.ResGiveSpell, Imcodec.ObjectProperty"
      8 "$type": "Imcodec.ObjectProperty.TypeCache.ResTeleport, Imcodec.ObjectProperty"
      8 "$type": "Imcodec.ObjectProperty.TypeCache.ResDrawHand, Imcodec.ObjectProperty"
      7 "$type": "Imcodec.ObjectProperty.TypeCache.ReqIsSchool, Imcodec.ObjectProperty"
      5 "$type": "Imcodec.ObjectProperty.TypeCache.ResActorDialog, Imcodec.ObjectProperty"
      5 "$type": "Imcodec.ObjectProperty.TypeCache.ActorDialog, Imcodec.ObjectProperty"
      3 "$type": "Imcodec.ObjectProperty.TypeCache.ResPostEvent, Imcodec.ObjectProperty"
      2 "$type": "Imcodec.ObjectProperty.TypeCache.ResPlaySound, Imcodec.ObjectProperty"
      2 "$type": "Imcodec.ObjectProperty.TypeCache.ResAddSpell, Imcodec.ObjectProperty"
      1 … ResWait / ResModifyEntry / ResDespawn / ResAddMana / ResAddHealth
files: 328   total occurrences: 8746   distinct: 29   rc=0
```
Comparison against `shared/quest/typeConstants.ts`: the file's own header records exactly
`8,746 occurrences in the real SpiralDB QuestTemplates/ (328 quest files; was 26 / 7,956 / 322)`, and
its audit test re-runs the grep and asserts the table (`[p3-01 ac1] measured: 29 distinct $type
strings, 8746 occurrences over 328 quest files (the recorded baseline)`, green in the P1-5 run).
`[p3-01 schemas] corpus 328: accepted=328, rejected=0, parse-output-changed=0`.

### P3-2 — `npm test` → the round-trip suite's counts vs `ls | wc -l`

No suite prints the string `322 passed`; the claim it encodes is printed as per-family counts. Raw
lines from the P1-5 run:

```console
[p3-02 ac1] committed fixtures: 4 files round-tripped (explicit-null fixtures=1, absent-key fixtures=3)
[p3-02 ac1] files discovered=328 round-tripped=328 failures=0 files with explicit nulls=328        (the owner fork)
[p3-02 ac1] files discovered=322 round-tripped=322 failures=0 files with explicit nulls=320        (the D17 clone)
[p3-02 ac2 real] corpus /home/jason/Documents/git-projects/spiraldb/QuestTemplates: scanned 317 of 328 files
                to locate all 29 recorded $type strings; every mutation is in memory (no write path)
[p3-08 corpus] 328 real + 322 clone files, 797 real dialog lists / 1558 total (769 real tag groups / 1508 total),
               1876 real entries in five corpus shapes (full 1860 / no-m_dialogEvent 65-key 7 / 60-key 1 / 45-key 6 /
               no-$type 58-key 2), plus the clone's 65-key null-omitted shape (35); … 1286 string-list elements
               round-tripped, byte-identical in both corpora
```
Verdict: **PASS, re-measured** — the clone's `322` equals `ls data/test-spiraldb/QuestTemplates/*.json | wc -l`
= 322 at that moment, and no field is lost (order, explicit nulls and absences asserted).

### P3-3 — edit → save → `git -C data/test-spiraldb diff HEAD~1 -- QuestTemplates/{file}`

Driven live in the browser on `WC-CYCLOPS-MAIN-002` (a file already tool-normalised on this branch, so
no formatting noise): `data-edit-mode=true`, the goal card's `m_usePatron` checkbox false→true,
`data-dirty` true, Save → toast `Quest WC-CYCLOPS-MAIN-002 saved and committed`, `data-dirty` false.

```console
$ git -C data/test-spiraldb diff HEAD~1 -- QuestTemplates/questtemplates_WC-CYCLOPS-MAIN-002.json
@@ -6,7 +6,7 @@
   "m_goals": [
     {
       "$type": "Imcodec.ObjectProperty.TypeCache.PersonaGoalTemplate, Imcodec.ObjectProperty",
-      "m_usePatron": false,
+      "m_usePatron": true,
       "m_goalName": "1_WizardQuestGoals_TalkNPC",
$ git -C data/test-spiraldb diff --no-renames --name-only HEAD~1
QuestMetadatas/questmetadata_WC-CYCLOPS-MAIN-002.json
QuestTemplates/questtemplates_WC-CYCLOPS-MAIN-002.json
$ git -C data/test-spiraldb diff HEAD~1 -- QuestMetadatas/questmetadata_WC-CYCLOPS-MAIN-002.json
-  "ModifiedAt": "2026-09-26T12:42:36.380Z",     +  "ModifiedAt": "2026-09-29T08:45:25.924Z",
-  "ModifiedBy": "Lead Verify"                    +  "ModifiedBy": "FV Gate3"
$ node -e "…flatten both documents and compare…"
changed value paths: 1 [".m_goals[0].m_usePatron"]
key-order drift: none
total value paths before/after: 2076 2076
```

### P3-4 — load the saved quest back

```console
$ curl -s localhost:3001/api/quests/WC-CYCLOPS-MAIN-002 | jq '{m_questName, goal0_usePatron, goal0_name, goals}'
{ "m_questName": "WC-CYCLOPS-MAIN-002", "goal0_usePatron": true,
  "goal0_name": "1_WizardQuestGoals_TalkNPC", "goals": 6 }
$ (full page reload of /quests/WC-CYCLOPS-MAIN-002, Goals tab)
goal 1 card  : "…Use Patron: ✓ Client Tags: WC_Ravenwood_S02, Ddl_WC_RW_CyrusDrake…"
goal 1 editor: checkbox checked=true ; data-dirty=false
```
Verdict: **PASS** — the form state after a reload is identical to the pre-save editing state.

### P3-5 — validation negatives via UI and curl

```console
$ curl -s -X POST localhost:3001/api/quests -d '{"quest": <WC-CYCLOPS-MAIN-002 with m_startGoals[0]="9_NoSuchGoal">}'
http=400
{"error":"Quest validation failed with 1 validation error (Unknown start goal).",
 "fields":{"m_startGoals[0]":["The start goal \"9_NoSuchGoal\" is not defined in m_goals. Set another start goal or restore the deleted goal."]}}
$ git -C data/test-spiraldb rev-parse --short HEAD → 812aaee ; porcelain: 0    (the 400 wrote nothing)
```
UI arm: **Set as Start Goal** on goal 1, then **Delete 1_WizardQuestGoals_TalkNPC**:

```console
role=alert : "1 validation error blocks saving: Unknown start goal."
             "5 warnings: Unreachable goal. Warnings never block saving."
Save       : aria-disabled="true" data-blocked="true" aria-describedby="quest-validation-banner"
strips     : [{field:"m_startGoals[0]", sev:"error",   text:"The start goal \"1_WizardQuestGoals_TalkNPC\" is not defined in m_goals. …"},
              {field:"m_goals[0]",      sev:"warning", text:"The goal \"2_WizardQuestGoals_TalkNPC\" cannot be reached from m_startGoals …"}, … 5 warning rows]
[Discard]  → banner "6 warnings: Unreachable goal. Warnings never block saving."
             6 goals restored, Save aria-disabled="false", data-dirty="false"
```
Screenshot `fv-p3-05-validation-negative`. Verdict: **PASS** — the blocking channel, the warn-not-block
channel and the discard-restores contract all hold.

### P3-6 — flowchart / requirements / dialog walkthrough on real quests

**Flowchart** (`MB-YARD1-C01-001`, mainline, 15 goals):

```console
.react-flow__node  : 16      (15 goals + the "✓ Complete" node)
.react-flow__edge  : 15
.react-flow svg    : 17      AND labels rendered
node labels        : 1_WizardQuestGoals_Explore / … / 15_WizardQuestGoals_TalkNPC / ✓ Complete
```
Screenshot `fv-p3-06-flowchart-MB-YARD1` (at fitView scale the nodes are small; the DOM counts are
the assertion).

**Requirements** (`MB-YARD1-C01-001`, Requirements tab):

```console
type <select> options : ["ReqHasQuest","ReqHasEntry","ReqSchoolOfFocus","ReqIsSchool"]   (exactly 4)
operator <select>     : ["ROP_AND","ROP_OR"] ; a Group with AND / OR / × ; "+ Add Condition", "+ Add Group"
slots rendered        : m_requirements (1 condition), m_prepRequirements ("null in all 322 corpus quests"),
                        m_pruneRequirements ("null in 320 of the 322"), m_goalRequirements ("null in all 772 corpus goals")
reference row         : button aria-label "Quest m_requirements[0]" → "Bad News... (MB-MUSEHub-C03-002)"
```

**Dialog** — two diverse quests, DOM group count vs the served document:

```console
WC-CYCLOPS-MAIN-002 : DOM "Group fields (0 unmodelled)" × 7
                      served: quest-level [Prep 5], goal-level [Completion 4,4,3,3,7,1]  → 7 groups / 27 entries
WC-UNICORN-MAIN-007 : DOM "Group fields (0 unmodelled)" × 5
                      served: quest-level [Prep 3, Completion 1], goal-level [Prep 1, Completion 2, Completion 1]
                      → 5 groups / 8 entries
console error on WC-CYCLOPS-MAIN-002: 404 /api/names/npcs/0 — the recorded D64(f) sentinel-0 miss path, carried, not new
```
Screenshot `fv-p3-06-dialog-WC-UNICORN-007`. **Caveat, stated rather than smoothed:** the group counts
are DOM-verified; the entry counts come from the served documents, because the per-block entry
selector undercounts nested goal-level headers (the same caveat the previous sweep recorded).

## Phase 4 — Other Object Editors (6 steps)

| # | verdict | one-line result |
|---|---|---|
| P4-1 | **PASS** | per family, both corpora: `droptable 317/317`, `npcinventory 215/215`, `npcspellinventory 77/77`, `creaturespellbook 134/134`, `treasurecardinventory 1/1`, `zonetransfer 1207/1207`, each `files discovered=N ls\|wc -l=N round-tripped=N failures=0` |
| P4-2 | **PASS** | a **real** edit per family through the live API: 7/7 committed, each `git diff --name-only HEAD~1` = exactly one path, then each restored (doc md5 identical, porcelain 0). Plus the committed tier-2 live rig AC2 (DropTable edit → one commit on the original legacy path) |
| P4-3 | **PASS** | 7/7 families created; every filename equals `spec-data-model.md`'s table (incl. `zonetransfer_WizardCity_WC_Hub`-style underscore and singular `droptable_`); each one path, action `create`; plus the rig's AC3 (`npcdroptable_87113.json`, the absent directory bootstrapped, `Created via UI`) |
| P4-4 | **PASS** + one finding | curl 400s for Name empty, both documented duplicate arms, RollChance 1.5, NoneChance −0.1, MinGold>MaxGold **and** a 200 control; UI inline errors + disabled Save for the three reachable arms. The banner reads `1 validation error block saving` — [Finding F2](#findings) |
| P4-5 | **PASS** | one commit `spiraldb: update global_registry globalregistry` writes `globalregistry.json` and deletes the legacy file (git reports it as `R096`; `--no-renames` shows `A`+`D`); the directory holds exactly one file; the written dict is deep-equal to what the editor posted; `/api/status/global_registry` → 404 |
| P4-6 | **PASS** | 375/768/1440 pass over all 21 routes: 0 horizontal overflow anywhere, rail 0 → **exactly 200** at 768 → **exactly 260** at 1440, 9 list routes cards→table, hamburger at 375; `npm run test:ui` green (incl. `responsive.spec.ts`) |

### P4-1 — `npm test` → per-type counts vs `ls | wc -l`

Raw lines from the P1-5 run (`object-corpus-roundtrip.test.ts`, both corpora in one suite):

```console
[p4-09 ac4] NpcSpellInventory unprefixed file 7cd0cf23-3bba-4eb1-b7fb-1b0e9bd1e11f.json (TemplateID=38226)
            round-tripped and is key-resolved by content, not name
[p4-09 ac4]   files discovered=317  ls|wc -l=317  round-tripped=317  failures=0     (DropTable)
[p4-09 ac4]   files discovered=215  ls|wc -l=215  round-tripped=215  failures=0     (NpcInventory)
[p4-09 ac4]   files discovered=77   ls|wc -l=77   round-tripped=77   failures=0     (NpcSpellInventory)
[p4-09 ac4]   files discovered=134  ls|wc -l=134  round-tripped=134  failures=0     (CreatureSpellbook)
[p4-09 ac4]   files discovered=1    ls|wc -l=1    round-tripped=1    failures=0     (TreasureCardInventory)
[p4-09 ac4]   files discovered=1207 ls|wc -l=1207 round-tripped=1207 failures=0     (ZoneTransfer)
              … the same six lines again for the other corpus (the owner fork)
[p4-09 ac4] committed fixtures swept=4 failures=0
```
`NpcDropTable` is the absent family (0 files, no directory) and is handled as such.

### P4-2 — per-type smoke loop (list → open → edit → save → `git log -1` / `diff HEAD~1 --stat`)

**The first pass was wrong and is reported because it is instructive:** re-saving the fetched document
unchanged produced `commit: ""` for six of seven families — the pipeline correctly declines to commit
a byte-identical write, so `git log -1` never moves. That is not an "edit", so the loop was re-run
with one real edit per type (the two saved scripts are `/tmp/fv4/p4-02-03-loop.mjs` and
`/tmp/fv4/p4-02b-smoke.mjs`). Raw output, one excerpt per family plus the closing check:

```console
--- droptable (/drop-tables/DS-ACAD-C01-001) ---
edit: Description ("p4-09 live rig edit" -> "p4-09 live rig edit+FV")
save http=200 {"outcome":"updated","action":"update","file":"DropTables/droptables_ds-acad-c01-001.json",
               "commit":"abb070b9273d67453daa5f96eba7bd0b5e971cde", "warnings":[]}
git log -1 --format=%s        -> spiraldb: update drop_table DS-ACAD-C01-001
git diff --name-only HEAD~1   -> DropTables/droptables_ds-acad-c01-001.json
git diff HEAD~1 --stat        -> 1 file changed, 1 insertion(+), 1 deletion(-)
restore http=200 {"outcome":"updated","commit":"3e0be2f8…"}

--- npcinventory (/npc-inventories/87112) ---   edit: Inventory 10 → 11 items (append a copy of the last)
save commit c00db071… / diff --name-only NpcInventory/NPCInventories_1-A.json / 1 insertion
--- npcspellinventory (/npc-spell-inventories/38226) ---  Spells 4 → 5 entries ; commit 2a27f703… ; 5 insertions
--- creaturespellbook (/creature-spellbooks/Mdeck-L-BR-DS-SylviaDrake-A-50) --- SpellTemplateIds 11 → 12 ; commit 0e967720… ; 1 insertion
--- npcdroptable (/npc-drop-tables/87113) ---   DropTableNames [] -> [null] ; commit 7362019f… ; 3 insertions/1 deletion
--- treasurecardinventory (/treasure-card-inventories/38214) --- TreasureCards 8 → 9 ; commit f7765798… ; 4 insertions
--- zonetransfer (/zone-transfers/WizardCity/WC_Hub) ---  Teleports 4 → 5 ; commit 8dd48960… ; 11 insertions

### closing check: every family back to its starting bytes?
droptable   doc-before=a62fb0da… doc-after=a62fb0da… IDENTICAL     npcinventory … IDENTICAL
npcspellinventory … IDENTICAL   creaturespellbook … IDENTICAL      npcdroptable … IDENTICAL
treasurecardinventory … IDENTICAL   zonetransfer … IDENTICAL
clone porcelain lines: 0
```
Verdict: **PASS** — 7/7 families list → open → **edit** → save → one commit → one path, and every
family restored. Two honest notes: (a) `npcdroptable`'s synthetic append wrote `[null]` because the
array was empty — the type's validator accepted a `null` element ([Finding F3](#findings), low); (b)
the committed **tier-2 live rig** (`p4-09-live.config.ts` against the stack this sweep booted, with
`user_name=p4-09 rig` and `git_branch=content/2026-09-27` as D76(b) requires) passed as its own arms:

```console
$ P4_09_LIVE_URL=http://localhost:5173 P4_09_CLONE=$PWD/data/test-spiraldb \
    npx playwright test --config tests/ui/p4-09-live.config.ts
  ✓  1 AC2: Edit → one field → Save commits the ORIGINAL legacy path on the settings branch (734ms)
  ✓  2 AC3: `New NPC drop table` creates the convention file, the directory and the status row (833ms)
  2 passed (2.0s)
```

### P4-3 — create-one-new-entry loop; filenames vs `spec-data-model.md` L173–187

```console
--- droptable new key="FV-NEW-DROPTABLE-001" ---           create http=200 action=create commit=d4d7a11d…
   expected (the spec table): DropTables/droptable_FV-NEW-DROPTABLE-001.json
   committed HEAD path      : DropTables/droptable_FV-NEW-DROPTABLE-001.json      file exists: yes
--- npcinventory new key=900000001 ---        NpcInventory/npcinventory_900000001.json                 yes
--- npcspellinventory new key=900000002 ---   NpcSpellInventory/npcspellinventory_900000002.json       yes
--- creaturespellbook new key="FV-NEW-DECK-001" --- CreatureSpellbook/creaturespellbook_FV-NEW-DECK-001.json yes
--- npcdroptable new key=900000004 ---        NpcDropTable/npcdroptable_900000004.json                 yes
--- treasurecardinventory new key=900000003 --- TreasureCardInventory/treasurecardinventory_900000003.json yes
--- zonetransfer new key="FV_New_Zone_Verify" --- ZoneTransfer/zonetransfer_FV_New_Zone_Verify.json     yes
      each: git log -1 -> spiraldb: create {object_type} {key}   ; warnings=[]
```
7/7 filenames match the naming table exactly (the zone key's `/` became `_`; `droptable_` is singular
per D26). The rig's AC3 additionally proves the **absent directory** case end to end:
`expect(existsSync(CLONE/NpcDropTable)).toBe(false)` → create → `NpcDropTable/npcdroptable_87113.json`
holding exactly `{TemplateID: 87113, DropTableNames: []}`, an `extracted` status row with the
`Created via UI` note. (Both loops' probe artifacts — `droptable_Z.json`, the seven created files and
the `[null]` edit — were discarded by the clone reset; see [Pins](#pins).)

### P4-4 — validation negatives (curl 400s + UI inline errors)

```console
$ POST /api/drop-tables …
--- Name empty ---                     http=400
{"error":"DropTable validation failed with 1 validation error (Missing name).",
 "fields":{"Name":["A drop table needs a non-empty Name before it can be saved. The Name is also the file’s key and what NpcDropTable and ResDropTable reference."]}}
--- Name duplicate: edit of X renamed onto Y (key=DS-ACAD-C01-001, Name=DS-ACAD-C01-002) ---  http=400
{"error":"… (Duplicate name).","fields":{"Name":["The name \"DS-ACAD-C01-002\" is already used by another drop table. …"]}}
--- Name duplicate: direct POST with no key ---                                              http=400
{"error":"… (Duplicate name).","fields":{"Name":["The name \"DS-ACAD-C01-001\" is already used by another drop table. …"]}}
--- control: no key + a new name Z ---  http=200 {"outcome":"created","action":"create","file":"DropTables/droptable_Z.json"}
--- RollChance 1.5 ---                  http=400 fields.RollChance "Roll chance 1.5 must be a number between 0 and 1."
--- NoneChance -0.1 ---                 http=400 fields.NoneChance "None chance -0.1 must be a number between 0 and 1."
--- MinGold 100 + MaxGold 10 ---        http=400 fields.MaxGold    "Minimum gold (100) must not be greater than maximum gold (10)."
```
The **first** duplicate probe was invalid (it posted `key` = the document's own `Name`, which is the
legitimate update arm) and overwrote `droptables_ds-acad-c01-002.json`; it was repaired in place
(value-identical to the frozen blob, formatting normalised) and the two arms the code documents
(`server/src/services/dropTables.ts` L27-31) were then run, above. UI arm — the three reachable cases:

```console
Roll chance value "1.5" → Save aria-disabled="true"
  banner: "1 validation error block saving: Roll chance out of range. Fix them and Save enables again."
  field : {field:"RollChance", sev:"error", text:"Roll chance 1.5 must be a number between 0 and 1."}
Name ""                 → Save aria-disabled="true"
  banner: "1 validation error block saving: Missing name. Fix them and Save enables again."
  field : {field:"Name", sev:"error", text:"A drop table needs a non-empty Name before it can be saved. …"}
MinGold 100 / MaxGold 10 → Save aria-disabled="true"
  banner: "1 validation error block saving: Inverted gold range. …"
  field : {field:"MaxGold", sev:"error", text:"Minimum gold (100) must not be greater than maximum gold (10)."}
[Discard] → Name back to DS-ACAD-C01-001, nothing written
```
Note the wording: the **quest** banner says `1 validation error blocks saving` (correct), the
**object** banner says `1 validation error block saving` — [Finding F2](#findings).

### P4-5 — GlobalRegistry: `cat` the merged output vs the editor table; the consolidation commit

```console
before: GlobalRegistry/ holds one legacy file; keys=1 ({"GlobalRegistryValues": {23 flags}})
        GET /api/global-registry/GlobalRegistryModels_1-A  deep-equal to the raw file: true
        manual merge of the files on disk → 1 key / 23 flags
$ POST /api/global-registry {"object": <merged + Krampus 0→1>}      (no `key`: the type is unkeyed)
http=200 {"outcome":"created","action":"update","file":"GlobalRegistry/globalregistry.json",
          "commit":"e2709f16be9c25992f166f3e8720884798367d82",
          "commit_message":"spiraldb: update global_registry globalregistry\n\nfinal-verify gate-3 P4-05 registry consolidation"}
$ git -C data/test-spiraldb show --name-status --format='%h %s' HEAD
e2709f1 spiraldb: update global_registry globalregistry
R096    GlobalRegistry/GlobalRegistryModels_1-A.json -> GlobalRegistry/globalregistry.json
$ git -C data/test-spiraldb show --no-renames --name-status HEAD
D       GlobalRegistry/GlobalRegistryModels_1-A.json
A       GlobalRegistry/globalregistry.json
$ ls GlobalRegistry/          → globalregistry.json            (exactly one file)
$ globalregistry.json deep-equal to what the editor posted: true   (23 flags, Krampus = 1)
$ curl -s localhost:3001/api/status/global_registry
http=404 {"error":"Unknown status type \"global_registry\". Valid types: quests, drop_tables, npc_inventories,
          npc_spell_inventories, creature_spellbooks, npc_drop_tables, treasure_card_inventories, zone_transfers, all"}
```
The plan's `git status` arm is shown as `git show --name-status` instead, because the change is
**committed** and a post-commit `git status` is empty by construction ([Deviation D7](#deviations)).
The `R096` line is git's rename detection pairing the delete with the add; `--no-renames` shows the
commit's real shape (`D` + `A`), which is the D74(f) point.

### P4-6 — viewport passes at 375/768 (MCP) + `npm run test:ui` green

A 63-cell sweep (21 `APP_ROUTES` × 375/768/1440) on the live stack:

```console
total route×width cells: 63      overflow violations (>1px): none      (max reading: -15px)
375px: every list route → table count 0, named <ul aria-label> present
       ("Quests", "drop tables", "NPC inventories", …, "zone transfers", "Registry values"),
       rail width 0, hamburger [aria-label="Open navigation"] present
768px: 8 of 9 list routes → table present, no card list; rail width = exactly 200
1440px: the same, rail width = exactly 260
/global-registry stays a value <ul> at every width (it is not a table — the spec's own shape)
```
Screenshots `fv-p4-06-mobile-quests-375`, `fv-p4-06-tablet-droptable-768`. `npm run test:ui` was run
as written and is green — [Gate totals](#gate-totals).

## Phase 5 — Dashboard & Polish (6 steps)

| # | verdict | one-line result |
|---|---|---|
| P5-1 | **PASS** | `npm test` → 89 files / 1832 tests, rc=0 |
| P5-2 | **PASS** | session A marked `WC-CYCLOPS-MAIN-002` verified; session B read `Verified 0` before its refresh and `Verified 1`, `Quests 1/322 (0.3%)` and the new feed row after it |
| P5-3 | **PASS** | `npm run build` rc=0; `npm start` on **3001**; `GET /quests` → `200 text/html` 508 B = `index.html`; `/`, `/drop-tables`, `/npc-inventories/87112`, `/settings` all 200 `text/html`; `/api/health` ok |
| P5-4 | **PASS** | the 63-cell viewport sweep above (375/768/1440 across all 21 routes) + `responsive.spec.ts` in the green `test:ui` run |
| P5-5 | **PASS** | axe-core **4.13.0** on the four named pages: **0 violations** each, with a proven-sensitive negative control (`image-alt`/critical appears, then returns to 0) |
| P5-6 | **PASS (substituted, disclosed)** | fresh clone `/tmp/fv4/fresh` at HEAD `37d7ca0`: clone 1 s, `npm ci --ignore-scripts` 14 s (+`npm rebuild better-sqlite3` 1.2 s), sync 20 s, build 7 s, prod start on `:3210` → `/quests` `200 text/html`; no corpus in a fresh clone (quests/zones/drop_tables 0) |

### P5-1 — `npm test` → all suites (including regression + envelope audit) green

```console
$ npm test
 Test Files  89 passed (89)
      Tests  1832 passed (1832)
   Duration  55.34s
npm test rc=0
```
The same single run is read for P1-5, P2-8's test arm, P3-2, P4-1 and this step — one instrument, five
readings, not five runs. The envelope audit (`object-save-body`, `validation-summary`,
`harness-port-ownership`, …) and the corpus sweeps are all in that 1832.

### P5-2 — two-browser session: change status in one, observe the other after refresh

Two real pages in one browser context. Session B held `/` open while session A changed the status:

```console
A: /quests/WC-CYCLOPS-MAIN-002 → [Mark Verified] → note "final-verify P5-02 two-session" → confirm
A   badge "Verified" ; toast "WC-CYCLOPS-MAIN-002 marked verified"
B   before refresh : Total 2280 / Extracted 2278 / Reviewed 2 / Verified 0 / Quests 0/322 (0.0%)
B   after refresh  : Total 2280 / Extracted 2277 / Reviewed 2 / Verified 1 / Quests 1/322 (0.3%)
    Recent Activity: "WC-CYCLOPS-MAIN-002 marked verified / just now / by p4-09 rig /
                     final-verify P5-02 two-session"   (newest row)
```
Screenshot `fv-p5-02-second-session-dashboard`. Verdict: **PASS** — the feed and the dashboard update
in the second session after a refresh, with the author, the note and the relative time.

### P5-3 — `npm run build && npm start` → `curl localhost:3001/quests` returns index.html

```console
$ npm run build   → build:server rc=0 (copied 4 migrations) ; build:client rc=0 (✓ built in 2.65s)
$ PORT=3001 SPIRALDB_UI_DB=/tmp/fv4/ui.db NODE_ENV=test npm start &
[spiraldb-ui] database ready at /tmp/fv4/ui.db
[spiraldb-ui] corpus already tracked (entry_status covers every corpus key)
[spiraldb-ui] API listening on http://127.0.0.1:3001 (loopback only)
[spiraldb-ui] serving built client from …/client/dist
$ curl -s -o … -w 'http=%{http_code} bytes=%{size_download} type=%{content_type}' localhost:3001/quests
http=200 bytes=508 type=text/html; charset=UTF-8
<!doctype html><html lang="en" class="dark"><head><meta charset="UTF-8" />… <script type="module" crossorigin src="/assets/index-BhWLwbZ4.js"></script>
$ /  → 200 text/html ; /drop-tables → 200 text/html ; /npc-inventories/87112 → 200 text/html ; /settings → 200 text/html
$ curl -s localhost:3001/api/health → {"status":"ok"}
$ kill <the PID of the process I started>   → 3001 free again
```

### P5-4 — viewport passes at 375/768/1440 across the route checklist

Same 63-cell sweep as P4-6 (the two steps share one instrument; the run is the same run, not two).
`tests/ui/responsive.spec.ts` is part of the green `npm run test:ui` run: 8 widths × 21 routes, plus
the boundary arms (`the 767/768 boundary: the rail mounts at exactly 768, not at 767`; `the
1279/1280 boundary: the rail widens to 260px at exactly 1280, not at 1279`), the JSON-panel overlay
arms and the nine list-route card/table arms — all ✓ at `418 passed`.

### P5-5 — axe scan on the four named pages

The four pages the AC names — Dashboard, Quest list, Quest detail (edit mode), DropTable detail —
scanned with the exactly-pinned `axe-core@4.13.0`, injected into the live page:

```console
Dashboard                  total: 0 violations   byImpact: {}
Quest list                 total: 0 violations   byImpact: {}
Quest detail (edit mode)   total: 0 violations   byImpact: {}
DropTable detail           total: 0 violations   byImpact: {}
```
**Negative control** (D90(c): a clean instrument result is worthless unless the instrument can fail):

```console
injected an <img> with no alt into <main> → violations: [{id:"image-alt", impact:"critical"}]
after removing it                        → violations: 0
```
The plan says the reports are archived under `docs/evidence/phase-5/`; this sweep may not write new
tracked evidence there, so the JSON above is recorded here and the screenshots are named in the MCP
output dir ([Deviation D4](#deviations)). The committed tier-1 arm (`tests/ui/a11y.spec.ts`) is part
of the green `npm run test:ui` run.

### P5-6 — fresh-clone dry run in /tmp, timed and recorded

```console
===== P5-6 fresh-clone dry run =====
the /tmp contamination check: /tmp/node_modules -> /home/…/spiraldb-ui/node_modules   (PRESENT — an earlier
    story's rig; a /tmp checkout is therefore not dependency-clean, so this run used npm ci into the clone's
    OWN node_modules and every reading below comes from that tree)
1. git clone file:///home/jason/Documents/git-projects/spiraldb-ui /tmp/fv4/fresh
   clone rc=0 elapsed=1s ; HEAD 37d7ca0 branch final-review ; node_modules present? no
2. npm ci --ignore-scripts      rc=0 elapsed=14s ; 379 entries
   → the first attempt to run anything failed: better-sqlite3 had no native binding
     (bindings.js: Could not locate the bindings file … node-v137-linux-x64/better_sqlite3.node)
2b. npm rebuild better-sqlite3  rc=0 elapsed=1.2s ; "better-sqlite3 loads OK"
3. NODE_ENV=test SPIRALDB_UI_DB=/tmp/fv4/fresh/data/fresh.db npm run sync
   sync rc=0 elapsed=20s
     status SUCCESS · revision V_r806919.Wizard_1_610 · items 79,835 · spells 18,173 · npcs 23,033
     string_table 216,991 · **quests 0 · zones 0 · drop_tables 0** · total 18.1 s
     (a fresh clone has no `data/test-spiraldb` — the D17 clone is itself a clone of the owner fork —
      so the corpus-derived families are legitimately empty; coverage echoes it: quest_files 0)
4. npm run build                rc=0 elapsed=7s
5. PORT=3210 SPIRALDB_UI_DB=… node server/dist/server/src/index.js
   GET :3210/quests           -> http=200 bytes=508 type=text/html; charset=UTF-8   (index.html; SPA fallback)
   GET :3210/api/health       -> {"status":"ok"}
   GET :3210/drop-tables      -> http=200 type=text/html; charset=UTF-8
   GET :3210/api/quests/coverage -> {"nameable":0,"id_space":0,"defined":0,"missing":0,"references":0,
                                     "corpus":{"spiraldb_path":"/tmp/fv4/fresh/data/test-spiraldb","quest_files":0}}
6. teardown: the PID file held a wrapper (2012874); the server itself was 2012875 (cwd /tmp/fv4/fresh,
   started 05:34:52) and was killed explicitly → :3210 free
```
**Substitutions, all disclosed:** the plan's 5.8 recipe also lists `npm run build:cli` (needs .NET and
an `.artifacts` tree the fresh clone has none of), the full UI walkthrough (extract → save → mark
reviewed → edit a DropTable → dashboard) and the `npm run dev` leg. Those flows were driven live on
the main stack earlier in this same sweep (P2-4, P2-8, P3-3, P4-2, P5-2, P6-6) rather than repeated in
the fresh tree; the fresh tree's own evidence is the clone → install → sync → build → prod-serve →
SPA-route chain above. `npm ci --ignore-scripts` was used because the sandbox has no network beyond
the npm cache; its one consequence (the missing native binding) is shown rather than hidden.

## Phase 6 — Quest authoring: catalog, evidence, names everywhere (8 steps)

**Step-count note:** the story enumerates *P1 1-7, P2 1-8, P3 1-6, P4 1-6, P5 1-6, P6 1-7*, but
`docs/plan-phase-6-quest-catalog.md`'s own Verification steps section lists **eight** (step 8 is
`npm test`, `npm run lint`, `npm run test:ui`). All eight were run; step 8 is folded into
[Gate totals](#gate-totals) — [Deviation D8](#deviations).

| # | verdict | one-line result |
|---|---|---|
| P6-1 | **PASS** | census reproduces the baseline exactly: 3,589 wads, **183,676** objects in **142** shape-class rows (140 A + 2 B), `WizZoneData` in both shapes, `TutorialQuestTemplate` **11**, `QuestTemplate` **0** |
| P6-2 | **PASS** | `wad-scan extract --select gamedata.bin,triggers.xml` → **6,733 rows** (3,356 + 3,377), 0 failures, 97,660,625 B NDJSON, **5.3 s** |
| P6-3 | **PASS** | `sync_history` 4 rows; two full syncs identical in every count; `/api/quests/coverage` → `{nameable 1717, id_space 4823, defined 322, missing 1395, references 2855}` = the recorded row |
| P6-4 | **PASS** | `GET /api/quests/WC-CYCLOPS-MAIN-002/evidence` → title "Run and Done", 30 text rows (0 used / 30 available), 27 dialogue rows with the composed speaker "Cyrus Drake", world gates `[]` |
| P6-5 | **PASS** | pairs render (`Ugo Kalahad (87112)`, `Garden Of Hesperides (Aquila/AQ_Z00_Hub)`), technical-only families render alone; id **and** friendly name both find the row; the palette reports `matched_on: key|name`; `Gretta` → **one** NPC row |
| P6-6 | **PASS** | Catalog (1,395 missing) → scaffold `DM-GRAVE-MAIN-008` → editor → insert a dialogue row (66-key corpus shape) → save = 2 commits; **and the AC's loadability clause ran LIVE**: `323 → 324 quest templates`, delta 1 |
| P6-7 | **PASS** | with `tools/bin/wad-scan` absent: sync `rc=0`, `status SUCCESS`, `catalog status: SKIPPED` + `breadth status: SKIPPED`, each naming the binary and `npm run build:wadscan` |
| P6-8 | **PASS** | `npm test`, `npm run lint`, `npm run test:ui` — all green ([Gate totals](#gate-totals)) |

### P6-1 — `node scripts/wad-census.mjs --gamedata … --classes …` → totals match the baseline

```console
$ node scripts/wad-census.mjs --gamedata /home/…/Aurorium/data/V_r806919.Wizard_1_610/Data/GameData \
    --classes /home/…/Imview/submodule/Imcodec/src/Imcodec.ObjectProperty/GeneratorInput/ClientDump.json
wads: 3589
object entries: shape A (BINd) 176943 in 140 classes; shape B (bare) 6733 in 2 classes

class                                 count  shape
WizItemTemplate                       76679  A
WizGameObjectTemplate                 15255  A
SpellTemplate                         14856  A
RecipeTemplate                        12402  A
GameObjectTemplate                     8012  A
SpawnManager                           6753  A
HousingNodeList                        5135  A
CinematicTemplate                      3985  A
<unresolved 1021044609>                3377  A
…
PathManager::NodeTemplateList          3377  B
WizZoneData                            3356  B
…
TutorialQuestTemplate                    11  A
…
[no QuestTemplate row; the table ends at ZoneData 1]
real 0m40.9s
```
Against the plan's measured-baseline table: `183,676 in 142 shape-class rows (141 distinct classes —
WizZoneData is in both shapes)` → **176,943 + 6,733 = 183,676 ✓**, 140 + 2 = 142 rows ✓ and the
duplicate class explains 141 distinct ✓; `QuestTemplate objects: 0` ✓ (absent from the table);
`TutorialQuestTemplate 11` ✓. The plan budgets < 90 s; this run took 40.9 s.

### P6-2 — `tools/bin/wad-scan extract --select gamedata.bin,triggers.xml` → 6,733 rows, timed

The plan's step omits the tool's two required flags (`--gamedata`, `--out`), so the full form was
used ([Deviation D9](#deviations)); the *select list* is the one p6-03's amendment records:

```console
$ DOTNET_ROOT=… tools/bin/wad-scan extract --gamedata …/Data/GameData \
    --select gamedata.bin,triggers.xml --out /tmp/fv4/extract.ndjson
wad-scan extract: 6733 row(s) in 5312 ms (gamedata.bin 3356, triggers.xml 3377);
                  deserialized 6733, failed 0; unreadable archives 0; out /tmp/fv4/extract.ndjson
rc=0   rows: 6733   bytes: 97,660,625   rows carrying "error": 0
class histogram: 3377 WizZoneTriggers, 3356 WizZoneData
real 0m5.4s
```
Verdict: **PASS** — exactly **6,733 rows**, 3,356 + 3,377, zero deserialization failures. (The plan's
`48,765,076 B` figure is the *compressed* entry payload; the NDJSON this step emits is 97.7 MB — two
different quantities, both stated. The five-glob list the step originally named selects 125,587
entries, which is the internal inconsistency p6-03 already amended.)

### P6-3 — `npm run sync` → `sync_history` counts; `GET /api/quests/coverage` → both denominators

```console
$ NODE_ENV=test SPIRALDB_UI_DB=/tmp/fv4/ui.db npm run sync        (run 1, 30.3 s)
  catalog status      : OK
  catalog rows        : 1,449 (merged 54, new 1,395)
  quests rows         : 1,717 (has_definition = 1: 322)
  catalog refs        : 2,855 rows kept (3,003 raw rows; 148 not inserted by the UNIQUE)
  quest ids           : 4,823 (linked 175; 115 links outside the text tier; 2 losing names on 2 ids)
  hold-out            : 78.0% (neighbour-midpoint; 168 cases, 131 hits) on …/data/test-spiraldb
  catalog timing      : 5.0 s extract + 334 ms read + 81 ms write
  breadth status      : OK ; zones old 1,241 (corpus ZoneTransfer) -> new 3,357

$ (the UI's Sync Now, run 2)   toast: "Sync complete: 79,835 items · 18,173 spells · 23,033 NPCs · 322 quests · 3,357 zones"
$ node -e "SELECT id,sync_timestamp,items_count,spells_count,npcs_count,quests_count,zones_count,status FROM sync_history"
{"id":1,"sync_timestamp":"2026-09-29T08:32:00Z","items_count":79835,"spells_count":18173,"npcs_count":23033,"quests_count":322,"zones_count":3357,"status":"success"}
{"id":2,"sync_timestamp":"2026-09-29T08:37:09Z","items_count":79835,"spells_count":18173,"npcs_count":23033,"quests_count":322,"zones_count":3357,"status":"success"}
$ curl -s localhost:3001/api/quests/coverage | jq .
{ "nameable": 1717, "id_space": 4823, "defined": 322, "missing": 1395, "references": 2855,
  "corpus": { "spiraldb_path": "…/data/test-spiraldb", "quest_files": 322 } }
```
Verdict: **PASS** — both denominators are present, `defined` equals the corpus-under-test count
(322 = the clone's file count), and the row is character-for-character the recorded
`(nameable 1717, id_space 4823, defined 322, missing 1395, references 2855)`. **Two full syncs are
identical in every count** (rows 1 and 2). `catalog rows 1,449 ≥ 1,447` ✓. Rows 3 and 4 of
`sync_history` come from P6-7 and its repair — see there.

### P6-4 — `GET /api/quests/WC-CYCLOPS-MAIN-002/evidence` → title, text split, named speaker

```console
$ curl -s localhost:3001/api/quests/WC-CYCLOPS-MAIN-002/evidence | jq 'keys'
["dialogue","goal_gates","quest","references","text_rows","warnings"]
$ .quest
{ "quest_name":"WC-CYCLOPS-MAIN-002", "quest_id":1520015, "has_definition":true,
  "link_kind":"none", "title":"Run and Done", "title_source":"none", "inference_basis":null }
$ .text_rows | {rows: length, used, available, first}
{ "rows":30, "used":0, "available":30,
  "first":{"key":"WizQst17318F_00000000","value":"I'm sure to make Best Boy after you tell Professor Drake all I've done. …",
           "category":"WizQst17318F","used_by_this_file":false,"field":null} }
$ .dialogue | length   → 27
$ .dialogue[0]
{ "index":0, "field":"m_goals[0].m_dialogList.m_dialogs[0].m_dialogEntries[0]",
  "dialog_key":"WizQst17318F_00000006", "own_table":true,
  "text":"Yes, yes, trouble on Cyclops Lane. Something, something students. *Sigh* You're one of those fast talkers, aren't you? Lovely.",
  "speaker":{ "persona":"WC-RAV-NPC02_Persona", "override_key":null, "st_key":"NPCFormats_First_Last",
              "name":"Cyrus Drake", "source":"composed" },
  "portrait":"GUI/NpcPortraits/Portrait_Human_Drake_A_NPC.dds", "camera_name":"Cinematic Camera - Cyrus Drake", … }
$ .goal_gates → []      .warnings → []
```
Verdict: **PASS** — title, the used/available split, and dialogue with a **named speaker** (composed
through `NPCFormats_First_Last`, D64(f)/D113's ladder) are all present. This quest has no world gates
(`[]`), which is a data fact for this name, not a missing surface — P6-6's scaffolded quest showed the
same panel with six populated gates.

### P6-5 — names walkthrough per family

**The pair, server-side data first** (`GET /api/<family>` row → `friendly_name`):

```console
npc-inventories          87112                        → "Ugo Kalahad"            (216 rows, 211 with a friendly name)
npc-spell-inventories    38226                        → "Diego the Duelmaster"
treasure-card-inventories 38214                       → "Harold Argleston"
zone-transfers           WizardCity/WC_Hub            → "The Commons"            (1206 rows, 1204 with a friendly name)
drop-tables              (first row)                  → null   (the key IS the name — the plan's "no" row)
creature-spellbooks      (all 135 rows)               → null   (0 of 135; the server's own header records why)
```
Then the DOM (all at 1440px):

```console
/npc-inventories         "Extracted  Free Pet Vendor (100364)  …" / "Rebekah WhiteFlash (1206079)"
/npc-spell-inventories   "Dworgyn (1206770)" / "Dworgyn (1206795)"
/treasure-card-inventories "Harold Argleston (38214)" / "900000003"   (the second is my P4-3 probe: 900000003
                            is in no npcs table, so it renders technical-only — the documented engine/miss case)
/zone-transfers          "Garden Of Hesperides (Aquila/AQ_Z00_Hub)" / "Mount Olympus (Aquila/AQ_Z01_MountOlympus)"
/drop-tables             "DS-ACAD-C01-001"          (technical only, no pair)
/creature-spellbooks     "Boss-B-KT-Ra"              (technical only, no pair)
```
**Search by id and by friendly name** (the list's own box, `/npc-inventories`):

```console
search "87112"  → 1 row  "Extracted  Ugo Kalahad (87112)  …"
search "Ugo"    → 1 row  "Extracted  Ugo Kalahad (87112)  …"     (the same row, either way)
```
**The global palette's `matched_on`** (`GET /api/search`, raw):

```console
q=87112        npc_inventory  {key:"87112", label:"87112", name:"Ugo Kalahad", matched_on:"key"}
q=Ugo          npc_inventory  {key:"87112", label:"87112", name:"Ugo Kalahad", matched_on:"name"}
               npc            {label:"Ugo Kalahad", name:"Ugo Kalahad", matched_on:"name"} (+ Ugor, Hugo Battlemist)
q=Cyrus        npc_spell_inventory {key:"126291", label:"126291", name:"Cyrus Drake", matched_on:"name"}
                                  {key:"38206",  label:"38206",  name:"Cyrus Drake", matched_on:"name"}
               npc / item / spell rows too
q=DS-ACAD-C01-001  quest {key:"DS-ACAD-C01-001", matched_on:"key"} ; drop_table {…, matched_on:"key"}
q=Gretta       npc  total: 1  {label:"Gretta Darkkettle", name:"Gretta Darkkettle", matched_on:"name"}
               (the P6-17 claim: two aliases, ONE row)
```
Verdict: **PASS**, with the honest qualification that CreatureSpellbook's pair exists but intersects
nothing in this corpus: the server's own header says `decks` (599 rows, built in 6.9) holds
`DeckTemplate` deck names (`Mdeck-BI-WV-…`, "Weaving Decks") while the corpus's 134 `DeckName` values
(`Mdeck-L-BR-DS-SylviaDrake-A-50`, `Mdeck-D-R2`, …) are a different population, so the measured
intersection is 0 — the plan's "with 6.9" row is implemented and empty here.

### P6-6 — UI walkthrough: Catalog → a missing quest → scaffold → editor → insert a dialogue row → save

```console
/quests/catalog → the "missing only" checkbox OFF: "1717 catalog rows" (1717 <tbody> rows)
                → checked ON:  "1395 missing"        (1395 rows) — the API's own `?missing_only=1` total is 1395
                → [Scaffold DM-GRAVE-MAIN-008]  → navigates straight to /quests/DM-GRAVE-MAIN-008?panel=evidence
```
The scaffold's own commit and file (from the clone):

```console
$ git log --format='%h %s%n%b' -2
2c61e9c spiraldb: create quest DM-GRAVE-MAIN-008
$ git show --name-status HEAD
A  QuestMetadatas/questmetadata_DM-GRAVE-MAIN-008.json
A  QuestTemplates/questtemplates_DM-GRAVE-MAIN-008.json
$ cat QuestTemplates/questtemplates_DM-GRAVE-MAIN-008.json      (the minimal skeleton — nothing inferred)
{ "m_questName":"DM-GRAVE-MAIN-008", "m_questNameID":0, "m_questTitle":"QuestTitle_00002165", "m_questInfo":null, …,
  "m_startGoals":[], "m_goals":[], "m_startResults":{"m_results":[]}, "m_endResults":{"m_results":[]},
  "m_goalLogic":[], "m_dialogList":{"$type":"…ActorDialogList, Imcodec.ObjectProperty","m_dialogs":[]} , … 36 keys }
$ cat QuestMetadatas/questmetadata_DM-GRAVE-MAIN-008.json
{ "QuestTemplateId":"questtemplates/DM-GRAVE-MAIN-008", "Name":"DM-GRAVE-MAIN-008",
  "Description":"Scaffolded from the quest catalog (link_kind: direct; title QuestTitle_00002165).",
  "CreatedAt":"…","ModifiedAt":"…","CreatedBy":"p4-09 rig","ModifiedBy":"p4-09 rig" }
$ curl -s …/api/status/quests/DM-GRAVE-MAIN-008/history
[{"old_status":null,"new_status":"extracted","notes":null,"changed_by":"p4-09 rig","changed_at":"2026-09-29T09:14:53.068Z"}]
```
The editor + the evidence panel (the panel is the D102-D104 surface):

```console
header          : "Stakes and Stones (DM-GRAVE-MAIN-008)"   badge "Extracted"
Info tab        : m_questName = DM-GRAVE-MAIN-008 ; m_questTitle shows "Stakes and Stones"
                  (the file keeps the key "QuestTitle_00002165" — the UI resolves it for display, D105)
Evidence panel  : "Title: Stakes and Stones" ; "DM-GRAVE-MAIN-008 · no definition in the corpus"
                  "── Used by this file ──"   "No row of this quest’s own table is referenced by this file yet."
                  "── Available ──"           "Every row of this quest’s own table is already used."
                  "── Dialogue ──"            "This file records no dialog entry."
                  "── World gates ──"         Correct_Defeat_01 (Incomplete · 2), Correct_GoTo_01 (Incomplete · 2),
                                              Goal 3 / Goal 4 (Incomplete · 1), Goal 8 (Complete · 1), Wrong_Defeat_01 …
Dialog tab      : [Add Dialog Tag] → group 1 "Prep" + 1 entry, data-dirty=true
                  the new entry has exactly 66 keys, m_nameSTKey="NPCFormats_First_Last", m_maxTimeSeconds=-1
                  m_personaName filled with "WC-RAV-NPC02_Persona"
Save            : toast "Quest DM-GRAVE-MAIN-008 saved and committed" ; data-dirty=false
$ git log --format='%h %s' -1  → 1a27081 spiraldb: update quest DM-GRAVE-MAIN-008
$ git diff HEAD~1 --stat
 .../questmetadata_DM-GRAVE-MAIN-008.json     |  2 +-
 .../questtemplates_DM-GRAVE-MAIN-008.json    | 80 +++++++++++++++++++++-
$ node … the saved group: keys ["m_dialogTag","m_dialogEntries","m_madlibs","m_dialogEvents","m_noAggroWhileDialogIsUp","m_noAggroNoDelay"], tag "Prep", 1 entry
```
Screenshots `fv-p6-06-scaffold-dialog`, `fv-p6-06-scaffold-dialog-saved`.

**The AC's loadability clause was run LIVE — no substitution was needed.** The read-only probes first
established that the chain was reachable (all five ports free; `Imlight.Director.dll` code-current):

```console
$ npm run imlight:boot -- probe
12369 aurorium free · 12500 imlight free · 12000 imlight free · 12333 imlight free · 8080 imlight free
start: 12369,12500,12000,12333,8080   reuse: (none)   refused: (none)
$ npm run imlight:boot -- freshness
verdict  code-current: Imlight.Director.dll mtime 2026-09-27T14:32:58.321Z; 2 commit(s) after it, 0 touched src/**/*.cs or *.csproj
$ npm run imlight:boot -- prove-count --name AQ-GARD-SIS-001 --db /tmp/fv4/ui.db \
    --evidence-dir /tmp/fv4/imlight-evidence --restore-clone
  baseline line : SpiralDB loaded 2284 files: 135 spellbooks, 319 drop tables, 216 NPC inventories, 78 NPC spell
                  inventories, 2 NPC drop tables, 2 treasure card inventories, **323 quest templates**, 1206 zone data entries.
  scaffold      : AQ-GARD-SIS-001 — exit 0, one file into …/data/test-spiraldb
  after line    : SpiralDB loaded 2285 files: … **324 quest templates**, 1206 zone data entries.
  arithmetic    : 323 + 1 = 324        delta: 1 (expected 1)
  verdict       : PASS — rises by exactly one
  detail        : …. the other seven families are unchanged
  baseline readings inside the one process: 3, all identical ; after readings: 3, all identical
  files counter : baseline 2284 -> after 2285 (delta 1)
```
Baseline 323 rather than the recorded 322 because this sweep's own scaffold (`DM-GRAVE-MAIN-008`) was
still in the clone at that moment — the **delta of exactly one** is the claim, and it holds. The
harness then reported its own five-axis check as MISMATCH against the *frozen* axes (HEAD 18dc924 /
count 42 / 322 files / the branch set) because it correctly restored the clone to *this sweep's*
pre-scaffold HEAD (`1a27081`) and my run's extra branch was still present; that is expected, not a
count failure — the same check is all-`ok` after the reset at [Pins](#pins). Aurorium was stopped by
the harness's own `down` afterwards:

```console
$ npm run imlight:boot -- down
[harness] stopped Aurorium pid 1992737
12369/12500/12000/12333/8080 all free
[harness] stopped what it had started; nothing else was touched
```

### P6-7 — remove `tools/bin/wad-scan`, re-run sync → succeeds, `skipped`

> **Annotation (final-review).** A `SKIPPED` tier is **not neutral** for a reader of the coverage header: the skipped run is a success (`rc=0`, `status SUCCESS`) whose catalog and breadth tables were replaced with the corpus-only state, so `coverage` reads `{323,0,323,0,0}` instead of the full sweep's row — read a `SKIPPED` stage as "these numbers are the truncated ones", not as "this stage changed nothing".

`tools/bin/` is gitignored, so the step's "remove" was done as a move-aside and a restore of the same
symlink target ([Deviation D10](#deviations)):

```console
$ readlink tools/bin/wad-scan → ../.artifacts/bin/WadScan/release/wad-scan
$ mv tools/bin/wad-scan /tmp/fv4/wad-scan.symlink.bak
$ NODE_ENV=test SPIRALDB_UI_DB=/tmp/fv4/ui.db npm run sync
  status              : SUCCESS
  sync_history        : success row written at 2026-09-29T09:21:38Z
  catalog status      : SKIPPED
  binary-missing      : WAD batch tool not found at …/tools/bin/wad-scan. Build it with: npm run build:wadscan
  breadth status      : SKIPPED
  binary-missing      : WAD batch tool not found at …/tools/bin/wad-scan. Build it with: npm run build:wadscan
sync rc=0
$ mv /tmp/fv4/wad-scan.symlink.bak tools/bin/wad-scan ; readlink → ../.artifacts/bin/WadScan/release/wad-scan
$ git status --porcelain | wc -l → 0        (no tracked content touched)
```
**What that skipped run does to the data, stated plainly** (measured, then repaired): the catalog and
breadth stages replace their tables wholesale, so the skipped run left
`coverage {nameable:323, id_space:0, defined:323, missing:0, references:0}` and `zones_count 1242`
against the full run's `1,717 / 4,823 / 322 / 1,395 / 2,855` and `3,357` — i.e. the Catalog page's
worklist is gone until a full sync runs again. The code documents the truncation as deliberate
(`questCatalog.ts` L554-566: "a skipped stage must not leave rows pointing at quests that the
transaction is about to delete"), so this is a **design consequence of the criterion's own
"catalog stage `skipped`" arm, not a defect** — and it is reversible: the next full sync restored
every count (row 4 of `sync_history`, `{"quests_count":322,"zones_count":3357,"status":"success"}`,
and `coverage` back to the recorded row). Recorded as [Observation O1](#findings).

### P6-8 — `npm test`, `npm run lint`, `npm run test:ui` → all green

See [Gate totals](#gate-totals): `npm test` 89 files / 1832 tests rc=0; `npm run lint` rc=0; and
`npm run test:ui` **418 passed** rc=0 (including `tests/ui/quests-catalog.spec.ts`,
`tests/ui/quests-evidence-panel.spec.ts` and `tests/ui/a11y.spec.ts`).

## Deviations

Every step that could not be run exactly as written, with the honest substitute and why.

| # | step | what the plan says | what ran, and why |
|---|---|---|---|
| **D1** | P1-1 | `rm -rf data && npm run sync` | `NODE_ENV=test SPIRALDB_UI_DB=/tmp/fv4/ui.db npm run sync`. `data/` holds the **owner's live database** (`data/spiraldb-ui.db`), which this sweep must leave byte-identical; the D44 override isolates the run and seeds `spiraldb_path` at the D17 clone (D17/D31c). The axis the step carries — a first sync creating the schema and printing its counts — is unchanged. |
| **D2** | P1-1 | `sqlite3 data/spiraldb-ui.db 'select count(*) from items;'` | the same query through the app's own driver (`node -e "require('better-sqlite3')…"`): `sqlite3` is not installed on this host (`which sqlite3` → nothing). Every count is read from `/tmp/fv4/ui.db`, never the live file. |
| **D3** | P1-6 | "dropdown smoke test on a stub page" | the smoke test ran on the **real** `FriendlyNameDropdown` at `/npc-inventories/87112`. The stub page no longer exists — the last one fell in p5-01 and p5-08 deleted the leftover preview panel, with `tests/ui/shell.spec.ts` asserting its text is absent on every page. The property under test (options carry friendly names, the selection stores the raw id) is identical. |
| **D4** | P1-6, P5-5, P6-6 | "screenshots copied into `docs/evidence/phase-N/`"; "reports archived under `docs/evidence/phase-5/`" | screenshots stay in the MCP output dir (`/home/jason/.cache/playwright-mcp/`) and the axe JSON is quoted here. The run's rails make **this file** the only writable path in the repo, so no new tracked evidence was added to the phase dirs; each artifact is named where it is used. |
| **D5** | P2-2 | `tools/bin/fixturegen …` bare | prefixed with `export DOTNET_ROOT=$(dirname "$(readlink -f "$(command -v dotnet)")")`. Both binaries are .NET apphosts and exit 131 without it (D45(3), the sibling `p6-11` runs the same export). |
| **D6** | P2-2 | `/tmp/cap.json` | `/tmp/fv4/cap.json` — this sweep's scratch subdirectory, so its artifacts cannot be confused with another run's. |
| **D7** | P4-5 | "`git … status` shows only `globalregistry.json` added and the legacy file deleted" | `git show --name-status HEAD` (and `--no-renames`). The change is **committed** by the save, and a post-commit `git status` is empty by construction; the commit's name-status is the same fact. |
| **D8** | P6 steps | the story enumerates P6 1–7 | the phase document lists **8** steps; all eight ran, step 8 folded into the gate totals. |
| **D9** | P6-2 | `tools/bin/wad-scan extract --select gamedata.bin,triggers.xml` | the same command plus `--gamedata …/Data/GameData --out /tmp/fv4/extract.ndjson`, both of which the tool requires (`wad-scan --help`), and with `DOTNET_ROOT` exported. The select list, the expected row count and the timing are as written (p6-03's own amendment). |
| **D10** | P6-7 | "Remove `tools/bin/wad-scan`" | the gitignored symlink was **moved aside and restored** (`readlink` identical before and after; `git status --porcelain` = 0). Deleting a file in the workspace is outside this run's read-only rail; the property the step needs (the derived `tools/bin/wad-scan` path not resolving) is identical. |
| **D11** | P5-6 | the full 5.8 recipe (clone → install → configure → sync → `build:cli` → `dev` → walkthrough → `build && start`) | the clone → install → sync → build → prod-serve → SPA-route chain ran in `/tmp/fv4/fresh`; `build:cli` (needs .NET and an `.artifacts` tree) and the UI walkthrough were **not** repeated there — those flows were driven live on the main stack in this same sweep (P2-4, P2-8, P3-3, P4-2, P5-2, P6-6). `npm ci --ignore-scripts` was used (no network beyond the npm cache); the resulting missing native binding is shown, and `npm rebuild better-sqlite3` fixed it in 1.2 s. |
| **D12** | P3-6 | "DOM assertions" for the dialog editor | group counts are DOM-verified; entry counts are read from the served documents, because the per-block entry selector undercounts nested goal-level headers. The same caveat the previous sweep recorded. |
| **D13** | P2-7 | the history row "with capture filename note" | the note's own path was exercised as a **positive control** (untrack + re-save with `source`), because the plan's arm presumes an untracked key while the startup import (D91) has already adopted the corpus. Both readings are given. |
| **D14** | P4-2 | "edit → save" per type | the first pass re-saved unchanged documents (six of seven wrote nothing — correctly). The loop was re-run with one real edit per type, then each family restored. Both passes are shown. |
| **D15** | P2-5, P2-7 | P2-5's clone step ("branch", `git log --format='%s (%an)'`, `ls` the template and its metadata); the run's own rail: the clone's frozen axes are the fixture | **the one correction this sweep owed itself: it created a clone branch and then deleted it.** The P2 saves ran on `content/2026-09-29` (the session's `content/YYYY-MM-DD` branch — the plan's own `content/2026-XX-XX`), so the clone briefly held a **fourth** branch and commits `main` does not have. It was restored to the three-branch set before the gates — `git checkout -f content/2026-09-27` → `git reset --hard 18dc924` → `git branch -D content/2026-09-29` (`Deleted branch content/2026-09-29 (was 2d451ac)`) — and re-read at [Pins](#pins); the residue commits stay reachable only through the reflog. This is the **D76(b) class** (a branch a run creates belongs to the run, not to the fixture, and what gets re-read is the clone's axes), and it is stated here because the earlier P2-5 wording read as if the clone had never left its three branches. |

## Findings

Rated by what a user would see. Nothing here was smoothed over.

**F1 — the extraction-history note is written only on a key's first appearance, so the plan's own
P2-7 arm is not reproducible on a database whose startup import already adopted the corpus (documented
behaviour, not a defect).** `savePipeline.ts`'s `historyNotesOnCreate` fires on the `entry_status`
**insert**; "an update of an already-tracked entry records nothing at all — no note, no status change,
no history row (D49(d))". Measured both ways at P2-7: a save of an imported quest →
`{"history":[]}`; a save after deleting the tracking row → the documented
`"Imported from packet capture final-verify-two-quests.json"` row. Worth keeping in mind when reading
Phase 2's acceptance evidence: on a *fresh* database the note appears, on this one it does not, and
neither reading is "the save failed".

**F2 — the object-editor validation banner's singular verb is wrong (cosmetic, user-visible, real).**
`client/src/lib/drop-table-validation.ts:84` builds
`` `${errors.length} ${noun} block saving: …` `` where `noun` is already singularised
(`validation error` / `validation errors`) but the **verb is not**:

```
client/src/lib/drop-table-validation.ts:84   `${errors.length} ${noun} block saving: …`
client/src/lib/quest-validation.ts:149       `${errors.length} validation ${errors.length === 1 ? 'error blocks' : 'errors block'} saving: …`
```
Measured live on `/drop-tables/DS-ACAD-C01-001` (all three blocking arms):

```
"1 validation error block saving: Roll chance out of range. Fix them and Save enables again."
"1 validation error block saving: Missing name. Fix them and Save enables again."
"1 validation error block saving: Inverted gold range. Fix them and Save enables again."
```
while the quest editor correctly reads `1 validation error blocks saving: Unknown start goal.` Two
copy paths, one grammar. Severity: low (no behaviour), but it is the sentence a user reads when a save
is blocked, and it is inconsistent with the same sentence one page over.

**F3 — `NpcDropTable.DropTableNames` accepts a `null` element (validation gap, low, not UI-reachable).**
Posting `{TemplateID: 87113, DropTableNames: [null]}` returned **200** and committed
`spiraldb: update npc_drop_table 87113` (`3 insertions/1 deletion`). The array is a list of drop-table
names, so a `null` element is meaningless. The UI cannot produce it (its pick-to-append control only
inserts a chosen table name), so this is a direct-POST-only gap; the element was removed again in the
same loop and the file restored.

**O1 — a sync without the batch tool succeeds but rewrites the catalog and breadth tiers to the
corpus-only state (design consequence of the criterion's own `skipped` arm; reversible).**
Measured at P6-7: `catalog status: SKIPPED`, `breadth status: SKIPPED`, `rc=0`, `status SUCCESS` — and
afterwards `coverage {nameable:323, id_space:0, defined:323, missing:0, references:0}` with
`sync_history.quests_count 323, zones_count 1242` against the full run's `1,717 / 4,823 / 322 / 1,395
/ 2,855` and `3,357`. `questCatalog.ts` L554-566 documents the unconditional
`DELETE FROM quest_catalog_refs / quest_ids` as deliberate ("a skipped stage must not leave rows
pointing at quests that the transaction is about to delete"), so this is the designed meaning of
`skipped` — but the **Catalog page's worklist disappears** until a full sync runs again, which is a
consequence worth knowing when reading the criterion. The very next full sync restored every count.

**Stale carried condition (attributed, not a finding against the tree).** The brief carried
`tests/ui/quests-goals-editor.spec.ts:519` as "a deterministic pre-existing failure — it fails alone
too". It **passed** in this run both in the full tier-1 suite (`✓ 215 … 2.1s`, 418/418) and **alone**:

```console
$ PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers npx playwright test tests/ui/quests-goals-editor.spec.ts:519
  ✓  1 [chromium] › … › reordering › a pointer drag with the mouse moves a goal too (2.1s)
  1 passed (3.3s)
```
Nor did any member of the `D69(h)/D77(d)` load-flake family appear: the tier-1 run was **418 passed,
0 failed, 0 flaky**. (A first attempt to run the arm alone failed only because `npx playwright test`
by itself lacks `PLAYWRIGHT_BROWSERS_PATH` — the repo's own config documents that the npm scripts set
it; the failure text was `Looks like Playwright was just installed or updated … npx playwright install`.)

## Pins (re-read at the end of the sweep, after the clone reset)

```console
$ git -C . status --porcelain            → ?? docs/evidence/final-verify.md          (this file only)
$ git rev-parse --abbrev-ref HEAD        → final-review ;  git rev-parse HEAD → 37d7ca050c6a770f15de1ddc791b634a20806cd6
$ git diff --cached --stat               → (empty: nothing staged, nothing committed)

$ sha256sum data/spiraldb-ui.db
a13f9aa8376411f6c6c0ea704098fcba6c4a226298eaba114230414af9e572ac  data/spiraldb-ui.db
-rw-r--r-- 1 jason users 38277120 Sep 28 20:33 data/spiraldb-ui.db      (mtime unchanged — never opened by this sweep)

$ cd data/test-spiraldb
branch            : content/2026-09-27            ✓ (the run's axis)
HEAD              : 18dc92477d54b1e911796960407ce7710e703697   ✓
main              : f3f8b5c0a48bc0f0b0cd9aca2d9d7d9d0122bd37   ✓
git rev-list --count HEAD : 42                    ✓
git status --porcelain    : 0 lines (clean)       ✓
QuestTemplates/*.json     : 322                   ✓
local branches (set)      : content/2026-09-26  content/2026-09-27  main   ✓ (the branch this run created, content/2026-09-29, deleted)
GlobalRegistry/           : GlobalRegistryModels_1-A.json                 ✓
NpcDropTable/             : absent                                        ✓
```
The restore (after the gates' own first `npm test` run showed the clone's 323 files) was:
`git checkout -f content/2026-09-27` → `git reset --hard 18dc924` → `git branch -D content/2026-09-29`
("Deleted branch content/2026-09-29 (was 2d451ac)"); the residue commits stay reachable only through
the reflog, exactly as the previous sweep recorded.

## Gate totals

| Gate | Command | Result |
|---|---|---|
| unit | `npm test` | **89 files / 1832 tests passed**, `rc=0`, 55.3 s (Real 55.8 s) |
| tier-1 UI | `npm run test:ui` | **418 passed**, `rc=0`, 1.8 m — 0 failed / 0 flaky / 0 skipped |
| lint | `npm run lint` | `npx eslint .` `rc=0` (no output) · `npx prettier --check .` `rc=0` ("All matched files use Prettier code style!") — `*.md` is in `.prettierignore`, so this file is not linted |
| types (tests) | `npm run typecheck:tests` | `tsc -p tests/tsconfig.json --noEmit` `rc=0` |
| types (scripts) | `npm run typecheck:scripts` | `tsc -p scripts/tsconfig.json --noEmit` `rc=0` |
| build (server) | `npm run build:server` | `rc=0` — "copied 4 server asset(s) to server/dist/server/migrations" |
| build (client) | `npm run build:client` | `rc=0` — `✓ built in 2.65s`; `index-BhWLwbZ4.js` 791.30 kB (gzip 232.81) + `QuestGoalLogicEditor-BHIrbZkM.js` 293.61 kB (the lazy chunk); the >500 kB warning is the pre-existing one |

```console
$ npm test
 Test Files  89 passed (89)
      Tests  1832 passed (1832)
   Duration  55.34s
npm test rc=0

$ npm run test:ui
  418 passed (1.8m)
test:ui rc=0

$ npm run lint
$ npx eslint .          → rc=0
$ npx prettier --check . → "Checking formatting… All matched files use Prettier code style!"  rc=0

$ npm run typecheck:tests    → rc=0
$ npm run typecheck:scripts  → rc=0
$ npm run build:server       → rc=0
$ npm run build:client       → rc=0
```

**One gate reading needs its cause stated** (it is the only non-green reading in this sweep): the
**first** `npm test` of the run ended

```console
 Test Files  3 failed | 86 passed (89)
      Tests  4 failed | 1828 passed (1832)
npm test rc=1
```
and the raw tail shows the **same** diff on every failure line it prints — `- 322 / + 323` against the
clone's quest-file count — on `tests/unit/quest-evidence-insert-isolation.test.ts:650`
(`expect(questFileCount()).toBe(CLONE_QUEST_FILES)`), `tests/unit/quest-scaffold.test.ts:737`
(`expect(names).toHaveLength(CLONE_QUEST_FILES)`) and `tests/unit/quest-scaffold.test.ts:764`
(`expect(axesBefore.questFiles).toBe(CLONE_QUEST_FILES)`). The cause is **this sweep's own scaffold**
(`DM-GRAVE-MAIN-008`) still being in the clone at that moment. After the clone reset the identical
command is 1832/1832 green. That is also why the clone was reset *before* the gates rather than after.

## Stopped (nothing of this sweep is left running)

| What | Started by | Stopped by | Verified |
|---|---|---|---|
| the dev stack (`:3001` + `:5173`, scratch DB) | this sweep, for the curl/UI steps | the background job was killed; the terminal ports checked | `3001`/`5173` free |
| the prod server (`:3001`, `npm start`) | P5-3 | `kill <the exact PID>` | `3001` free |
| Aurorium (`:12369`, started by the Imlight harness) | P6-6's `prove-count` | `npm run imlight:boot -- down` → `[harness] stopped Aurorium pid 1992737` | all five harness ports free |
| the fresh-clone prod server (`:3210`) | P5-6 | explicit `kill` of pid 2012875 (the pid file held the wrapper 2012874) | `3210` free |
| the tier-1 harness stack (`:3181`/`:5181`) | `npm run test:ui` / the alone-run | Playwright's own webServer teardown | not listening |

No sibling repository was modified; the only sibling reads were the census/extract inputs (Aurorium's
`Data/GameData`), the Imcodec `ClientDump.json`, the owner fork's `QuestTemplates/` (a read-only grep)
and the Imlight live boot the AC asked for.