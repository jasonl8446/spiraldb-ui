# Phase 7 — Quest coverage and a friendlier editor

**Status:** proposed (2026-09-29), owner-approved story list in the grill-me interview of the same date; not started
**Depends on:** Phases 1–6 merged (`main` at `3451c88`). New external dependency: none.
**Runtime:** Claude Code, oh-my-claudecode `ralph` (D125). The story ledger is `.omc/prd.json`, with a mirror in `.omd/prd/spiraldb-ui.json` rev 12 kept for continuity.
**Spec reading order before starting:** [spec-domain-reference.md](./spec-domain-reference.md) → [spec-data-model.md](./spec-data-model.md) → [spec-api.md](./spec-api.md) → [spec-ui-design.md](./spec-ui-design.md), then [plan-overview.md](./plan-overview.md) **D125–D137**.

> **The decisions are D-numbered.** D125–D137 are in [plan-overview.md](./plan-overview.md). Task 7.0 updates the
> specs and AGENTS.md to match them. It does not invent new decisions. Anything the plan leaves unsettled is resolved
> by the standing ambiguity rule: follow the specs, record a new D-item (the next free id was **D138**; p7-01 took D138–D144), and continue.

## Why this phase exists

Three owner goals, each with evidence from a read-only survey taken on 2026-09-29:

1. **Captures miss most of a quest.** The reader (`Imview/src/Imview.PacketReader/QuestBuilder.cs:43-58`) consumes
   4 of about 20 quest-related message types. Some fields it parses and then drops: `QuestOffer.QuestInfo` and
   `Rewards` (`Packets.cs:39,45`), and `SendGoal.NoQuestHelper` and `PetOnlyQuest` (`Packets.cs:101,104`). Other
   fields are on the wire but never declared, such as `MSG_SENDGOAL.PersonaName`
   (`Imcodec.MessageLayer/GeneratorInput/QuestMessages.xml:50`). Persona goals are 429 of 796 goals, and
   `m_personaName` comes from nothing. Packet order is never used, although it is the only thing that reveals goal
   sequencing and completion text. `m_completeText` is empty on 796/796 goals.
2. **The goal is data for every quest, gathered automatically.** The game files contain zero quest definitions (D96).
   The catalog knows 1,447 named quests plus an unnamed id tier of about 4,830 (D97/D98). About 1,100 named quests
   have no file. The only automatic source that can produce new data is the Phase 6 game-file evidence.
   Live Imlight only serves what SpiralDB already holds, so it can't discover anything, and no real captures exist
   on this host (D53(d), re-checked 2026-09-29). This phase therefore drafts every catalog quest from evidence, as
   **suggestions** that a human accepts (D129/D130).
3. **The quest editor speaks in document keys.** About 165 field keys (`m_questLevel`), 24 class names
   (`ReqHasQuest`, `ResDropTable`) and about 19 enum values (`GOAL_TYPE_PERSONA`) are the visible labels.
   Friendly labels exist for goal fields (`client/src/lib/quest-goals.ts:168-382`), but the form prints
   `field.key` anyway (`QuestGoalsEditor.tsx:446`, also :471, :483 aria, :512, :632). Goal cards are titled `1_WizardQuestGoals_00000058`. Goal
   Logic has no help text at all. There is no shared label home.

It also absorbs everything Phase 6 carried forward (task 7.14–7.16; list in the ledger below).

## Measured baseline (name the corpus every time — D114)

| Measurement | Corpus | Result |
|---|---|---|
| Quest files | owner fork (2026-09-29) | 330 |
| Quest files | D17 clone `data/test-spiraldb` (frozen) | 322 |
| Files whose goal names carry the extractor's `{n}_` pattern | owner fork | 306 / 330 |
| `m_questInfo`, `m_questPrep`, `m_questUnderway`, `m_questComplete` empty | owner fork | 330 / 330 |
| `m_questNameID` = 0, `m_activityType` default | owner fork | 330 / 330 |
| Goals, by class | owner fork | 796: Persona 429, Waypoint 198, Bounty 107, Scavenge 36, AchieveRank 26 |
| Goal `m_completeText` / `m_hyperlink` / `m_goalRequirements` empty | owner fork | 796 / 796 each |
| `m_endResults` empty | owner fork | 8 / 330 (the rest are hand-authored: `ResDropTable` ×323, `ResLearnSpell` ×14) |
| Quest-related message types the reader consumes | Imcodec GeneratorInput | 4 (`QUESTOFFER`, `SENDQUEST`, `SENDGOAL`, `ACTORDIALOG`) |
| Real captures on this host | filesystem search | 0 (fixtures are FixtureGen output, D28) |
| Technical strings visible in the quest editor | client source | ≈ 208 (165 keys + 24 classes + 19 enums) |

Task 7.0 re-measures each row against the corpus under test and records the raw output. A row that no longer
matches is amended, never quoted.

## Decision ledger (owner answers, 2026-09-29)

| # | Decision | D-item |
|---|---|---|
| Q1 | Capture decoding lives in **our wrapper as a post-pass** over the raw capture. Imview is never modified. | D126 |
| Q2 | "The code should get data for all quests automatically, however it is done." Decoder proof uses **auto-generated captures with planted values**. Live Imlight capture is rejected: no headless client exists, and its data would only echo our own. | D128 |
| Q3 | Automatic data is **staged as suggestions in SQLite**. Only accepted fields are written to SpiralDB. This amends D100/D101. | D129 |
| Q4 | Labels are **always both**: `Friendly (technical)`, with no toggle. This mirrors the Phase 6 `Name (ID)` pair. | D131 |
| Q5 | Also in scope: readable card titles, Basic vs Advanced fields, a quest overview tab, and help everywhere including Goal Logic. | D132, D133 |
| Q6 | Every Phase 6 leftover group comes in: code follow-ups, the owner environment, flake hardening, record hygiene. | D136 |
| Q7/Q8 | Claude Code runs the phase. Commits carry **the running runtime's own trailer**, which amends AGENTS.md. | D125 |
| Q9 | Drafts cover **every catalog id, including the unnamed tier**. This reverses D98. | D130 |
| Q10 | The dev database is not production. The run may delete and rebuild it. | D134 |
| Q12 | An unnamed-tier draft is saved only after **the user names it** on its first save, with the name pre-filled from its evidence. Nothing is auto-named. | D137 |
| Q11 | The story list and order below, approved as listed. | — |

Two rules followed from those answers and were stated in the interview without objection:

- **Observed vs inferred (D127).** A value copied verbatim from a packet is written into the extraction output.
  Any value that required inference is emitted as a suggestion and never written into the template. Examples of
  inference: goal logic from packet order, rewards mapped to result types, anything drafted from game files.
- **D121's degenerate pair collapses (D135).** When the friendly half equals the technical half, only one is shown,
  never `X (X)`. This is the existing collapse rule in `client/src/lib/display.ts:117-122`.

## Deliverables

- An enriched capture pipeline: new observed fields, the reader's recorded defects repaired in the post-pass, and a
  `suggestions` sidecar for inferred structure.
- FixtureGen `--inject` plus a **packet census** tool that reports every message type and field in a capture as
  consumed or ignored, so the next gap is found from data.
- A SQLite suggestion store and a draft builder covering every catalog id. It is idempotent and runs from an npm
  script and from a dashboard button.
- A draft review queue plus per-field and accept-all review inside the editor. Accepting creates or updates a real
  file through the existing save/scaffold pipeline.
- `shared/glossary.ts`, the single home of every field, class and enum label with its help text and tier
  (basic/advanced), plus a rendering component. The label is applied to every quest tab, the Evidence panel and
  aria labels.
- Readable card titles, a Basic/Advanced split, a read-only quest **Overview** landing tab, a glossary popover.
- Every Phase 6 residual resolved or explicitly dispositioned.

## Prerequisites for an unattended run

### Owner actions — cannot be delegated

| # | Action | Why |
|---|---|---|
| 1 | Approve this plan (done in the interview; flip the status line at launch). | The loop never invents an owner decision. |
| 2 | Inhibit suspend for the run's duration. | An idle suspend parks the loop. |
| 3 | Confirm quota headroom before launch. | The loop cannot extend its own budget. |
| 4 | Launch from a fresh Claude Code session with [`docs/evidence/phase-7/launch-prompt.md`](./evidence/phase-7/launch-prompt.md). | — |

### Environment (inherited, re-verified by task 7.0)

Everything in Phase 6's environment table still applies (D114, D122): .NET 9 on PATH for our tools with the D18
flags, .NET 10 for Imlight via `DOTNET_ROOT` from the nix store, the Aurorium/Imlight run copies, the port budget
12369/12500/12000/12333/8080 plus 3001/5173 (bind-checked and owned, D93), Chromium for playwright-mcp, and `gh`
authenticated as `jasonl8446`.

### Changes made before launch (this revision, uncommitted on purpose — p7-01 commits them)

- this file;
- `plan-overview.md`: D125–D137 and a note under the execution model;
- `AGENTS.md`: phase list, D-summary, commit-trailer rule;
- `.omc/prd.json` (primary ledger) and `.omd/prd/spiraldb-ui.json` rev 12, both local and uncommitted, (mirror: `p7-*` + `gate-7` appended, the
  three `final-*` stories reset to `passes:false`, `final-verify` naming P7);
- `docs/evidence/phase-7/launch-prompt.md`.

### Identity and write rules

- `settings.user_name` is set to `Jason` (D134) before any save acceptance.
- All save/git acceptance runs against the **D17 clone**. The owner fork, Imview, Imlight, Aurorium and Imcodec are
  read-only. The run executes Imlight's and Aurorium's copies but writes into neither tree.
- `data/spiraldb-ui.db` is disposable (D134). Every other file under `data/` is not, the clone included.

## Tasks

Sizes: **S** ≤ half a round's work, **M** one round, **L** may need a follow-up round.

### 7.0 Decision record + spec updates — **S**
Commit the pre-launch docs. Update `spec-domain-reference.md` (the wrapper's new fields, the `suggestions` sidecar,
the census output), `spec-data-model.md` (the suggestion tables, `quests.title_key`), `spec-api.md` (suggestions,
drafts, the census and the NPC page route) and `spec-ui-design.md` (the label pair for keys/classes/enums, the
Basic/Advanced rule, the Overview tab, the draft queue route, and the refreshed pair-contract spec list at
L84-117). Re-measure the baseline table with raw output into `docs/evidence/phase-7/p7-01-baseline.txt`. Add `.omc/`
to `.gitignore` (measured untracked on 2026-09-29). The ledgers stay local and are never committed.

**Acceptance:** D125–D137 present; four specs updated with each change named in the evidence; baseline re-measured
with its corpus named on each row; `tests/unit/ui-shell.test.ts` and `names.test.ts` still green after the spec
edits.

### 7.1 Dev environment reset — **S** *(D134, Phase 6 owner residuals)*
Delete and rebuild `data/spiraldb-ui.db` from all migrations, run `npm run sync` against the configured corpus, set
`settings.user_name = 'Jason'`. Move the loadability harness's default raw-log path out of the committed evidence
directory (architect-verification.md:87-89) and into a gitignored run dir. Start the dev server and leave it running
(the owner is owed a restart). That dev server's `spiraldb_path` is the **owner fork**, which `seedSettings`
defaults to (`server/src/db.ts:37,303`). It is for reading only. **Every save acceptance in this phase, tier 1 and
tier 2 alike, runs on a separate server** whose `SPIRALDB_PATH` is the D17 clone and whose database is a throwaway
(the p6-12 harness pattern). The owner's dev server never receives a save from the run.

**Acceptance:** `node -e "console.log(new (require('better-sqlite3'))('data/spiraldb-ui.db').prepare(\"select name,type from sqlite_master where type in ('table','view')\").all())"`
(there is no `sqlite3` binary on this host) lists `quest_ids`, `quest_catalog_refs` and the `coverage` view; `GET /api/quests/coverage` answers; `settings.user_name` reads `Jason`; re-running the harness leaves
`git status --short docs/evidence` empty.

### 7.2 FixtureGen `--inject` + packet census — **M** *(D128)*
`tools/FixtureGen` gains `--inject <spec.json>`. It plants known values into the packets it emits: `PersonaName` on
`MSG_SENDGOAL`, the `MSG_SENDQUEST` extras (`QuestNameID`, `QuestInfo`, `NoQuestHelper`, `SkipQHAutoSelect`,
`ActivityType`, `ClientTags`, `PetOnlyQuest`), `Rewards` as a real `LootInfoList`, a `MSG_COMPLETEGOAL` with
`CompleteText`, `MSG_REMOVEGOAL`, a follow-on `MSG_SENDGOAL`, `MSG_COMPLETEQUEST`, and `MSG_PERSONAINFO.GoalHyperlink`,
in a deliberate order. A new `tools/CaptureCensus` (assembly `capture-census`, the same D18 build pattern, `npm run
build:census`) reads any capture and prints one row per message type and field with count, and whether the wrapper
consumes it. The census is also an option on the extraction endpoint's result, so the upload UI shows what was
ignored.

**Acceptance:** an injected fixture set of at least 5 quests (one per goal class) is committed under
`server/test/fixtures/captures/p7/`; the census over it lists every planted field. Negative control: the census run
on a Phase 2 fixture shows those fields absent. CI has no .NET SDK (D55), so a golden can't be regenerated there. The CI-bound vitest therefore
checks each committed census golden **against its `--inject` spec**: every planted field must be present with the
planted count. A local-only arm regenerates the goldens and byte-compares them against the committed files, with
the RAW output recorded. Build against `$(ImviewRoot)/submodule/Imcodec` (net9, like WadScan), never against
Imlight's net10 copy.

### 7.3 Wrapper post-pass: observed fields — **M** *(D126, D127)*
In `tools/PacketReaderCli`, after QuestBuilder returns, re-read the raw capture (the same pattern as
`ApplyOfferLevels`, D46). Copy verbatim: `m_personaName` (from `MSG_SENDGOAL.PersonaName`), `m_questInfo`,
`m_questNameID`, `m_noQuestHelper`, `m_skipQHAutoSelect`, `m_activityType`, `m_clientTags`, goal `m_noQuestHelper`,
`m_petOnlyQuest` where the schema has it, goal `m_completeText` (from `MSG_COMPLETEGOAL`), and `m_hyperlink` (from
`MSG_PERSONAINFO.GoalHyperlink`). Every field is matched by `QuestID`/`GoalID`, never by position. A message without a `QuestID` (for example
`MSG_QUESTOFFER`) joins through the quest title to `MSG_SENDQUEST.QuestID`, as QuestBuilder does
(`QuestBuilder.cs:105-114`). `MSG_COMPLETEQUEST.CompleteText` maps to the quest's completion text if the schema has
a field for it; otherwise it is reported. A **lossless** decode through Imcodec's own enum table or serializer
counts as observed (D127): byte→`ACTIVITY_*` literal, blob→`m_clientTags` array. A byte with no enum mapping is
reported and not written. Each written value must be one the corpus schema accepts (`shared/` zod schemas); a value
the schema rejects is reported and not written.

**Acceptance:** extraction of the 7.2 fixtures recovers every planted observed value exactly (field-level diff = 0).
The Phase 2 round-trip (`npm run verify:captures`) and `npm run audit:corpus` report the same 181 verified with 0
failures on the D17 clone. The CLI's JSON contract (D45) is unchanged for fields not listed. The committed golden
outputs are checked in CI against their inject specs, as in 7.2. `compareSnapshots` in
`scripts/lib/quest-roundtrip.mjs` gains `m_personaName`, which is already non-empty on 405 goals in the D17 clone *(amended at p7-04 by measurement, D153: non-empty on **14** goals; 405 is the `GOAL_TYPE_PERSONA` goal count)*,
so the corpus round-trip gets a free extra check.

### 7.4 Wrapper post-pass: reader defect repairs + more dialog — **M**
Repair the recorded defects in the post-pass, without editing Imview:
- the completion dialog is attached by `GoalID` (story-p2-03.md:27-80);
- an ACHIEVERANK goal with an empty title gets a stable name instead of breaking the `{n}_{title}` derivation;
- an unlisted goal type falls back instead of aborting. The CLI catches QuestBuilder's throw, re-runs with that goal
  excluded, and reports it.

Add `MSG_ENCOUNTERDIALOG` and underway dialogs, plus the `ActorDialog` `IsYesNo`/`DefaultDialogAnimation` fields.

**Acceptance:** each defect has a fixture that failed before the change (raw output recorded) and passes after it.
Re-run `npm run audit:corpus` and record the new refused count. It may only fall below 141, never rise, and every
remaining refusal is classified.

### 7.5 Wrapper inferences → `suggestions` sidecar — **M** *(D127)*
The wrapper's JSON output gains a top-level `suggestions` array beside the templates (D45 contract extended, not
changed). Each entry holds `{questName, path, value, source: "capture-order"|"capture-rewards", confidence, note}`.
Packet order yields `m_goalLogic` chains and `m_startGoals`: complete, then remove, then send a new goal on the same
`QuestID`. `MSG_COMPLETEQUEST` marks the terminal goal. `Rewards`, `MSG_QUESTREWARDS` and `MSG_LOOT` decode through
Imcodec's `LootInfo` classes into proposed `m_endResults` entries, each labelled as a rolled observation
(gold/XP/item/spell), not a drop-table name. Nothing in `suggestions` is ever merged into a template by the wrapper
or the server.

**Acceptance:** for each ordered fixture the suggested goal-logic chain equals the planted order; a single-goal
capture yields no chain; the reward suggestions list every planted loot entry with its type. A test proves the saved
template contains none of the suggested values until they are accepted.

### 7.6 Suggestion store + draft builder — **L** *(D129, D130)*
Migration `0005_quest_suggestions.sql`, appended to `MIGRATION_FILES` (`server/src/db.ts:221`) with
`db.test.ts`'s table/view/index counts updated: a `quest_suggestions` table
`(id, quest_name NULL for an unnamed id, catalog_id, path, value_json, source, confidence, evidence_ref, status: pending|accepted|rejected,
created_at, decided_at)` plus a `quest_drafts` view that aggregates each quest's evidence richness. The builder
(`npm run drafts`, and `POST /api/drafts/rebuild` behind a dashboard button) runs over **every catalog id, named and
unnamed** (D130). From the Phase 6 evidence it proposes the title, dialogue rows with their resolved speakers, goals
from `goal_gates`, location keys and reference-derived requirements such as `ReqHasQuest`. It also stores capture
suggestions arriving from 7.5. The builder is idempotent: a rebuild never duplicates a row and never resurrects a
rejected one. An already-accepted value is not re-proposed. Existing files get suggestions only for fields that are
empty in the file.

**Acceptance:**
- Two consecutive rebuilds give identical counts.
- Draft counts reconcile with the `coverage` view: named with no file, named with a file, unnamed.
- Per-source counts are recorded raw.
- The build time is recorded with a budget of under 5 minutes.
- A unit test proves rejected rows survive a rebuild.
- CI runs the builder on a fixture catalog.

### 7.7 Draft review queue + accept flow — **L**
New route `/drafts` in the nav. It is a table of quests ranked by evidence richness, filterable by named/unnamed,
has-file, and source, and shows each quest's name pair. The default filter hides drafts with zero evidence; a toggle
shows all of them (D130).

Opening a draft goes to the quest editor. For a missing file, the editor starts from the D118 minimal skeleton in
memory, with no write yet. Pending suggestions render inline beside their field as `Suggested: … [Accept] [Reject]`,
with an "Accept all from this source" action.

Accepting sets the field in the in-memory document. Save goes through the existing pipeline: file, metadata, commit,
and the D119 branch guard. Saving a new quest follows the scaffold path. **An unnamed-tier draft (D137)** asks for a quest name on its first
save. The name is pre-filled from its evidence (the title key where one exists), must be unique and path-safe (the
scaffold's own guard), creates the catalog row, and then follows the scaffold path. Nothing is auto-named.
Suggestion status updates only after the save commits.

**Acceptance:**
- Tier-1 specs: accept one field on an existing file, save, and the diff is exactly that field. On a new file the
  diff is the D118 skeleton plus that field. Naming an unnamed draft creates exactly one catalog row and one file,
  and a duplicate or path-escaping name is refused. Reject survives a reload. Accept-all then
  save validates.
- One quest built entirely from a draft is **loaded by a live Imlight boot**: the `SpiralDB loaded … quest templates`
  count rises by exactly one (D113, reusing p6-12's harness).
- Tier-2 playwright-mcp screenshots are committed to `docs/evidence/phase-7/`.

### 7.8 Glossary: the one label home — **M** *(D131)*
Add `shared/glossary.ts`. Like `shared/document.ts` (D58) it has no dependencies and is safe to use from both client
and server. It holds three maps: fields keyed by document key, classes keyed by `$type`, and enum values keyed by
enum and literal. Each entry is `{label, help, tier: 'basic'|'advanced', source}`. `source` cites where the meaning
comes from, as `file:line` in `spec-domain-reference.md`, Imlight or Imcodec.

Existing labels move here: the goal `label`s in `quest-goals.ts`, the requirement labels, and the dialog group names.
They are not duplicated. A `<TermLabel term=… />` component renders `Friendly (technical)`, collapses identical pairs
(D135), and makes the technical half selectable in mono.

**Acceptance:** a unit test fails if any key in the six quest spec tables (`quest-info`, `quest-goals`,
`quest-goal-logic`, `requirement-tree`, `quest-results`, `quest-dialog`), any `KNOWN_TYPE_STRINGS` entry, or any
enum literal the editor renders lacks a glossary entry. Negative control: delete one entry and show the test failing.
A single-home test like `display-single-home` forbids a second label table.

### 7.9 Apply the pair across the quest editor — **L**
Every quest tab (Info, Goals, Goal Logic, Requirements, Results, Dialog), the Evidence panel's "Insert into" line,
select options, and aria labels render through `TermLabel`. Document-path addresses such as `m_requirements[0]` stay
out of visible labels and survive only in `data-path` attributes. Tier-1 specs that locate by a technical label are
updated to locate by the pair or by role. Every change is listed in the PR, and no assertion is loosened silently
(the Phase 6 6.5 precedent).

**Acceptance:** a Playwright scan of each tab looks at visible text **outside `[data-term]` elements**, the
TermLabel wrapper that legitimately shows the technical half. It must find no **exact** match against the glossary's
keys, `KNOWN_TYPE_STRINGS` and enum literals. Exact matching avoids false hits on words like "Results" or
"Required". Terms collapsed under D135 are allowlisted from the glossary. The scanner's negative control is
recorded: a label rendered bare must fail the scan. The
JSON tab is exempt by design. All tier-1 specs are green. Mobile 375 px has no new overflow.

### 7.10 Readable cards and summaries — **M**
Goal, result and requirement cards are titled by meaning, for example "Talk to Olivia Dawnwillow (Persona goal)",
"Reward: drop table Pesky Pirates", "Requires quest: …". Each title is generated from the document plus resolved
names, and falls back to the glossary class label, never to a generated goal id. Aria labels follow.

**Acceptance:** unit tests over one real quest per goal class (D17 clone) pin the titles. No card title matches
`/^\d+_WizardQuestGoals_/`.

### 7.11 Basic vs Advanced + single-value enums — **M** *(D132)*
Each form renders the glossary's `basic` fields first and the `advanced` ones under a collapsed "Advanced"
disclosure. The disclosure opens automatically if any advanced field is non-empty or has a validation error.
An enum with one legal value renders as read-only text. The tier assignment is data in the glossary, and a unit test
pins the basic set for each tab.

**Acceptance:**
- A tier-1 spec shows **one dialog entry** of the D118 skeleton's shape with at most 12 visible fields by default.
  "Non-empty" in D132 means different from the schema/skeleton default (`null`, `''`, `0`, `false`, `[]`), so a
  camera value of 0 does not open Advanced.
- Advanced opens automatically on a quest with an advanced value.
- No validation error is ever hidden, proven by a spec that injects an error into an advanced field.

### 7.12 Help everywhere + glossary popover — **S**
Every glossary entry has non-empty `help`, which fills Goal Logic's gap. A "What does this mean?" popover on each
label shows the help, the technical name and the source. A `/glossary` page lists every term, and it is searchable by
either half.

**Acceptance:** a unit test requires `help` on every entry. A tier-1 spec opens the popover by keyboard. The
glossary page search matches `m_questLevel` and "Quest level" to the same row.

### 7.13 Quest Overview tab — **M** *(D133)*
It is a new first tab and the landing tab in both view and edit mode. It is a read-only, plain-language story of the
quest:
- who gives it (the Prep dialog speaker);
- each step in goal-logic order with its friendly card title;
- what completes it;
- requirements in words;
- rewards with resolved names.

Pending suggestion counts show as a badge.

**Acceptance:** a unit test renders the Overview for one real quest per goal class and pins its text. Where
goal-logic is absent, the step order falls back to array order and says so.

### 7.14 Phase 6 code follow-ups — **L** *(D136)*
- The NPC page `/npcs/:npcId` over the existing `GET /api/npcs/:id`: aliases, personas, dialogs, quests and
  inventories, with counts matching a direct query.
- A `quests.title_key` column, added in migration `0006` via a guarded column add like
  `applyQuestCatalogColumnAdds` (`server/src/db.ts:67-90`), so that an inferred title does not fall back to the quest name after a sync. The 10
  of 285 direct links that write no title are re-measured and fixed or classified
  (`docs/evidence/phase-6/p6-09.md:125-136,391-395`).
- The speaker ladder's per-class fall-through counter (D124): all 3 classes counted and surfaced in sync output.
- The D119 `git_branch` guard on every write path, not just the CLI (final-review.md:35), with a test per write
  route.
- The 7 unnamed classes left unresolved (`docs/evidence/phase-6/p6-11.md:43`, which already records each class
  and its site): make one fresh resolution attempt per class, and record the result or the reason it can't be
  resolved.
- After `title_key` lands, re-run `npm run drafts` and record the before/after title-suggestion counts. The builder
  (7.6) predates this column.

**Acceptance:** one criterion per item, each with raw evidence. The NPC page has tier-1 coverage.

### 7.15 Flake hardening — **M**
- The rotating D69(h)/D77(d) load-flake family (`a11y-keyboard.spec.ts:221`, `extraction.spec.ts:927` and `:979` as cited in `docs/evidence/phase-6/p6-08.md:85` and `p6-09.md:381`, `shell`):
  find the mechanism and fix it. A retry is not a fix (D123).
- The S1 drag/clipboard arm waits on the panel's success toast (final-review-rereview.md:533).
- Line-number citations in tests (e.g. `spec-ui-design L73-93`) are replaced by heading citations that cannot rot.
  The check is `grep -rnE '(spec|plan)-[a-z-]+(\.md)?[ :]*L?[0-9]+' tests/`, which found 90 hits on
  2026-09-29.

**Acceptance:** each named spec passes 10 of 10 isolated repeats and 3 of 3 full-suite runs, with raw output. The grep
above returns 0 hits.

### 7.16 Record hygiene — **S**
- Tick Phase 6's acceptance checkboxes (`plan-phase-6-quest-catalog.md:423-440`), each with an evidence link.
- Add PR #8 to the phase-log table.
- Note the "14 vs 15 deviations" wording in the two immutable commit bodies (46200cb, 999392e) as an erratum.
- Record D135 as closing D121's open question.
- Disposition the remaining deslop rows (V12(c), T7, C4, S4, S11–14, T8, T11, V5, V6, V8, V9, T2): each one fixed or
  kept-with-reason.

**Acceptance:** `grep -c '\- \[ \]' docs/plan-phase-6-quest-catalog.md` = 0; every row appears with a disposition in
`docs/evidence/phase-7/p7-17.md`.

## Story order (PRD)

`p7-01` 7.0 → `p7-02` 7.1 → `p7-03` 7.2 → `p7-04` 7.3 → `p7-05` 7.4 → `p7-06` 7.5 → `p7-07` 7.6 → `p7-08` 7.7 →
`p7-09` 7.8 → `p7-10` 7.9 → `p7-11` 7.10 → `p7-12` 7.11 → `p7-13` 7.12 → `p7-14` 7.13 → `p7-15` 7.14 → `p7-16` 7.15 →
`p7-17` 7.16 → `gate-7` → `final-deslop` → `final-review` → `final-verify`.

## Phase acceptance criteria

- [ ] The injected capture set's every observed value is recovered exactly, and every inferred value appears only as a
      suggestion (7.2–7.5).
- [ ] `npm run audit:corpus` on the D17 clone: 181+ verified, 0 failures, refusals ≤ 141 and classified.
- [ ] `npm run drafts` covers every catalog id; two runs are identical; counts reconcile with `coverage`.
- [ ] One quest built only from accepted suggestions is loaded by a live Imlight boot (count +1).
- [ ] No bare technical label is visible in any quest tab except JSON (scanner + negative control).
- [ ] Every glossary term has a label, help, tier and source; one label home, enforced by test.
- [ ] Overview tab, Basic/Advanced, readable cards, and the popover shipped with tier-1 + tier-2 evidence.
- [ ] Every Phase 6 residual listed in 7.14–7.16 is closed or dispositioned with a reason.
- [ ] `npm test`, `npm run lint`, `npm run test:ui` green; flake specs 10/10.
- [ ] D125–D137 present, the four specs updated, and AGENTS.md updated.

## Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Synthetic captures only prove what we plant | A real capture has a shape we didn't model | The census makes every unconsumed field visible on the first real upload. Real-capture replay is the owner's post-run step, recorded in the PR and not claimed by the run. |
| A LootInfo decode is wrong | Bad reward suggestions | They are suggestions only (D127), labelled as rolled observations, and never merged automatically. |
| ~6,000 drafts bury the useful ones | The queue is unusable | Ranked by evidence richness; zero-evidence drafts hidden by default (D130). |
| The glossary invents a meaning | Users trust a wrong label | Every entry cites a source; the technical half is always visible (D131); one file for the owner to review. |
| Relabelling breaks tier-1 locators | Red CI, or specs loosened | Locators move to the pair or to role; every change named in the PR (the 6.5 precedent). |
| Advanced disclosure hides an error | Silent invalid saves | It opens automatically on error, proven by a spec (7.11). |
| CI has no .NET SDK (D55) | C# changes unproven in CI | Golden JSON outputs committed and asserted by CI-bound vitest; C# proven locally with raw output. |
| OMC ralph differs from the Phase 6 harness | Lost ledger semantics | `.omc/prd.json` carries the same criteria, the amendment ledger rules match, and the `.omd` mirror is kept. |
| Ralph's active PRD is session-scoped (`.omc/state/sessions/{id}/prd.json`) | A relaunch re-imports all stories as `passes:false` | Every pass is copied back into `.omc/prd.json` and the `.omd` mirror in the same iteration. Both ledgers stay local and uncommitted; `docs/evidence/phase-7/*.md` is the durable record. A relaunch re-imports `.omc/prd.json`. |
| A tier-2 save hits the owner's dev server | Commits into the owner fork | Every save acceptance runs on a clone-backed throwaway server (7.1). |

## Verification steps

1. `tools/bin/capture-census --input server/test/fixtures/captures/p7/*.json`: every planted field listed.
2. `tools/bin/imview-packet-reader --input <each p7 fixture>`: observed fields equal the plant; the `suggestions`
   array holds the inferred ones.
3. `npm run verify:captures && npm run audit:corpus`: 0 failures on the D17 clone.
4. `npm run drafts`, run twice: identical counts; `GET /api/quests/coverage` reconciles.
5. playwright-mcp walkthrough **against the clone-backed server**: `/drafts` → a named missing quest → accept 3 suggestions → save → live Imlight boot
   count +1; screenshots into `docs/evidence/phase-7/`.
6. playwright-mcp walkthrough: Overview → Goals (readable cards, pair labels) → Dialog (Basic vs Advanced) → popover
   → `/glossary` search both halves.
7. `npm test`, `npm run lint`, `npm run test:ui`: all green.

**Done when:** every acceptance criterion is checked with recorded evidence, D125–D137 are in
[plan-overview.md](./plan-overview.md), and the owner's post-run steps are listed in the Phase 7 PR: replay a real
capture, and review `shared/glossary.ts` wording.
