# Phase 8 — Quest starting data for every quest

**Status:** approved (2026-09-30) after the owner's grill-me interview (answers G1–G9 below); to run unattended under ralph
**Depends on:** Phase 7 (PR #14, under owner review; review fixes at `509839c`, D195 — **rebase this branch onto it before 8.2; the 8.1 commit conflicts with the review fixes and needs a manual resolution**; branch `phase-7-coverage-usability`, gate-7 local half done at `25ed810`; its PR is pending
the owner). Phase 8 is stacked on it as `phase-8-quest-starting-data` until Phase 7 merges.
**New external dependency:** the owner's Imlight fork `jasonl8446/Imlight` as a git submodule (8.7, AGPL-3.0 stays in
the fork). Nothing else.

> Decisions are D-numbered in [plan-overview.md](./plan-overview.md). D186–D187 are taken by the UI requests (8.1). The items
> proposed below are D188–D194; task 8.0 writes them. The next free id after them is **D195**.

## Why this phase exists

The owner's words: *"I understand that the game files do not contain everything, but I at least need the quest titles
and the dialog. Everything that the game files have as a starting point."* And: *"There should be 4823 quests. There
could be more."*

Phase 7's draft builder proposes almost nothing per missing quest. On the dev DB (owner fork, 2026-09-30), 385 of the
1,387 named file-less quests get no suggestion at all, and most others get only a placeholder goal (gate precision
7/64) or a guessed prerequisite. Meanwhile the string tables already on this host hold the text the owner is asking for.
It is unused: the builder turns 62 of about 55,000 dialogue lines into suggestions.

## Measured baseline (read-only survey, 2026-09-30; scripts in the session scratchpad, re-measured by 8.0)

| Measurement | Corpus | Result |
|---|---|---|
| Hex quest ids with a `WizQst<id>` text table | synced dev DB | 4,823 (65,496 rows) |
| Hex ids with a title only (`QuestTitle_<id>`, no table) | synced dev DB | 311 |
| Hex-id universe | synced dev DB | **5,134**; 3,337 with a non-empty title, 3,147 with title and text |
| Decimal-numbered `QuestTitle_000NNNNN` keys (a second scheme, not id-keyed) | synced dev DB | 1,473 (1,440 non-empty) |
| Catalog names linked to no id | synced dev DB | 1,217 of 1,717 (106 direct links resolve only to decimal keys) |
| Distinct quests (estimate) | — | about 5,100 to 7,700 |
| Dialogue-like vs name-like rows | hex tables | 54,963 / 10,466; rule ≤4 words and no terminal punctuation = name, 101/101 on hold-out |
| Prep rows numbered before Completion rows | owner fork, 130 labelled tables | 90% |
| "Completion = last dialogue run" | hold-out | precision 0.98, recall 0.19 |
| "Prep = first dialogue run" | hold-out | precision 0.48 |
| Speaker in a zone-code NPC candidate set | owner fork | 58.5% (median 3 candidates) |
| Quests with a single Prep speaker | owner fork | 94.1% |
| Upstream SpiralDB quest files absent from the fork | PR #329 `fix/arc1-quests` (open) | 12; plus merged PRs #330 (prerequisites, 59 files) and #331 (rewards, 314 files) not in the fork |

**Defects found by the survey (fixed in 8.2):**
- The builder drafts ids that a corpus file already owns: 307 unnamed title suggestions and 57 of the 62 dialogue
  suggestions. The cause is that `quest_ids.matched_quest_name` is filled only from catalog links, never from
  `m_questTitle`.
- `QuestTitle_00000000`/`…42` are parsed as hex ids 0 and 0x42.
- `quests.title_key` is NULL on every dev-DB row. The last sync probably predates migration 0006; confirm and re-sync.

**What cannot be automated (research, 2026-09-30).** Imlight loads quests only from SpiralDB and emits packets only for
quests it holds, and no headless client exists anywhere. A live capture needs the official client, a human, and a
key-stealing proxy (ban and terms-of-service risk). **D128's rejection of live discovery stands.** Speakers,
goal targets and rewards come only from captures or a human.

## Decision ledger (owner answers, 2026-09-30)

| # | Answer | D-item |
|---|---|---|
| Q1 | Build all four: draft from quest text, catalog lists every quest, capture ingestion, and (later, by a human in the UI) other sources | D188–D191 |
| Q2 | "Researching other sources is the point of the UI": no external-source import is built; the upstream SpiralDB repo is not an outside source, so it is imported | D191 |
| Q3 | The quest title field is a dropdown; the catalog gets a search; a reward drop table links to its editor | D186 |
| Q4 | Imlight comes into this repo as a submodule of the owner's fork, for automated play-testing (not discovery) | D192 |

## Launch interview (owner answers, 2026-09-30)

| # | Question | Answer |
|---|---|---|
| G1 | GitHub operations in an unattended run | The owner adds allow rules for `gh pr create/checks/view/merge` and `git push` to `jasonl8446/spiraldb-ui` and `jasonl8446/Imlight` before launch |
| G2 | Phase 7's unfinished gate | Finish Phase 7 first: gate-7 PR, CI, merge, then its three `final-*` stories; Phase 8 rebases onto the new `main` |
| G3 | 8.7's risk | Split: 8.7a (submodule, packet logging, GM commands) must pass; 8.7b (virtual session, play-test harness) may record its blocker with evidence and carry to Phase 9 by a ledger amendment instead of stalling gate-8 |
| G4 | Upstream refs | `Revive101/spiraldb` `main` and `refs/pull/329/head`, fetched at run time into a bare mirror under `data/`; imported commits are recorded; a setting lists more PR numbers |
| G5 | The two harness-written scaffolds in the owner fork | Removed by the lead before launch at the owner's request: kept on the backup branch `harness-scaffolds-2026-09-29`, `content/2026-09-28` reset to `d57d891`, pins returned 330 → 328 (D145) |
| G6 | Dev DB and dev server | Re-sync `data/spiraldb-ui.db` and rebuild drafts at launch and after the last story; stop the owner's dev server during the run and restart it fresh at the end, PID recorded |
| G7 | A text-drafted dialogue block with no speaker | Accept is allowed; the block is written with an empty speaker and flagged "needs speaker" (validation warning + a draft-queue filter) |
| G8 | Launch shape | One launch, one `.omc/prd.json`: Phase 7's four remaining stories first, then `p8-00`…`p8-08` (8.1b as `p8-01b`), `gate-8` and Phase 8's three `final-*` |
| G9 | Upstream vs non-empty fields | Upstream may propose changes to filled fields, shown as "yours vs upstream (commit, PR)" and never auto-applied; this extends D162's empty-field rule for the `upstream-*` sources only |

## Tasks

### 8.0 Decision record + specs — **S**
Write D188–D194 in plan-overview.md. Update spec-data-model (the catalog universe, text-draft sources),
spec-api (catalog `?q=`, the strings `?category=`, the capture inbox) and spec-ui-design (the catalog columns, the text
draft review). Re-measure the baseline table with raw output. Run `node scripts/glossary-spotcheck.mjs --fix` after spec
edits.

### 8.1 Owner UI requests — **M** *(D186, D187)*
The `m_questTitle` dropdown over the `QuestTitle` category shows `Title (key)`. Search matches either half, and an
unknown value is kept (D57). `/quests/catalog` gets a search with `?q=` in SQL. A `ResDropTable` reward links to its
DropTable editor, and a missing table renders as text. Done at `0bf3c5f`.

### 8.1b Search on `/drafts` — **S** *(owner request, 2026-09-30)*
`/drafts` gets a search box. It matches the quest name, the title text, the title key or the catalog id (either half of
the name pair), case-insensitively. It filters in the `GET /api/drafts` SQL (`?q=`, validated, ANDed with the named,
has-file, source and zero-evidence filters), like the catalog search (D186). The count line says when a search narrows
the queue, and a no-match state names the search text.

**Acceptance:**
- Server unit tests for `?q=`: each matched half, the AND with every filter, and the 400s.
- A tier-1 spec for narrowing, combining and debounce.
- No overflow at 375 px.

### 8.2 Builder correctness — **S**
- A corpus file's `m_questTitle` claims its id: `quest_ids.matched_quest_name` is filled from it, and no unnamed draft is
  made for a corpus-owned id.
- Decimal title keys are never parsed as hex ids.
- `title_key` is verified after a fresh sync.

**Acceptance:** after a rebuild, 0 suggestions target a corpus-owned id (the 307 + 57 measured before), and ids 0 and
0x42 are gone.

**Also (PR #14 review 9b, deferred to here):** add an index on `string_table(category)`, and have the builder resolve
title links from the title map it already holds in memory instead of the unindexed `LIKE 'QuestTitle\_%' AND value = ?`
scan. Measured: 6,251 ms for 5,469 proposals, most of it in those two scans. Record the before/after time.

### 8.3 Every quest in the catalog — **M** *(D188)*
The catalog lists the union: named quests, hex ids (with or without a title), and decimal-key titles. Each row shows its
tier, has-file, has-title, has-text and has-draft, plus text-row counts. An unnamed row shows `Title (id)`. Filters cover
tier and each has-* flag. The coverage header reports the measured denominators honestly, per D97.

**Acceptance:** the row count equals the measured union with its parts named; the filters are tier-1 tested.

### 8.4 Draft every quest from its own text — **L** *(D189, D190)*
New builder source `evidence-text`:
- the title key (hex or decimal) for every quest that has one;
- every row of the quest's own `WizQst` table, in row order, typed `dialogue` or `name` by the measured rule;
- a suggested segmentation from the measured ordering facts: rows before the first run are Underway candidates, the
  first run is Prep, later runs are Completion by goal order. Each segment is labelled with its measured precision and
  never applied silently;
- a speaker pick list per contiguous block: zone-code NPC candidates plus NPCs named in the table's own name rows.

Name-like rows become `m_locationName` or tally-descriptor candidates. Dialogue suggestions are grouped so one accept
creates one `ActorDialog` block with its entries keyed to the real `WizQst` keys; the text is never copied into the file
(the corpus stores keys, D64). The review UI shows the lines in order with the split and speaker as editable choices.

**Acceptance:**
- Every hex id with a table gets a text draft.
- Rebuilds are idempotent (D163).
- On the owner-fork corpus quests, the proposed Prep/Completion segments reproduce the measured precision within
  ±0.02 (hold-out).
- Accepting a block and saving writes schema-valid `m_dialogList` entries whose `m_dialog` keys exist in `string_table`.
- One quest built from text drafts loads in a live Imlight boot (+1, D113).

**Also (PR #14 review 9h):** `planSuggestionAccept` checks the parent's type. A path whose parent exists but is a
scalar returns "can't accept here" with the reason, never an accept that `applyEdits` then throws on. Text drafts create
many nested dialogue paths.

### 8.5 Import upstream SpiralDB as suggestions — **M** *(D191)*
A read-only upstream reader diffs the configured upstream refs against the corpus. It reads
`git ls-remote`/`git fetch` into a **separate bare mirror** under `data/`, never the fork's working tree. The refs cover
`upstream/main` and open PR heads the owner lists, with #329 by default. It stages:
- new quest files as `upstream-file` drafts (accept = create the file through the scaffold path);
- field changes to existing quests (#330 prerequisites, #331 rewards) as `upstream-field` suggestions.

Each suggestion names its commit and PR. The CC BY-NC-SA notice is shown on the source, and nothing is merged
automatically.

**Acceptance:**
- The 12 PR #329 quests appear as drafts, and #331's reward fields appear on their 314 quests.
- A second import is idempotent.
- The fork's working tree and branches are untouched (porcelain and refs identical before and after).

### 8.6 Capture inbox — **M** *(D193)*
A watched inbox directory (`data/captures/inbox/`, configurable in settings) plus a drop zone on the extraction page.
Each new Imview/Moonlight-format JSON capture is automatically:
1. extracted (the Phase 7 wrapper);
2. run through the census;
3. stored as capture suggestions (D161);
4. moved to `processed/` or `failed/` with a report.

An upload is idempotent by content hash. The dashboard shows the inbox's last runs.

**Acceptance:** dropping the 10 committed p7 fixtures into the inbox yields exactly their golden suggestions, and a
second drop adds nothing. A malformed file lands in `failed/` with a reason. Producing real captures stays the owner's
step, never claimed by the run.

**Also (PR #14 review 9k):** when two extracted quests share one offer `MobileID` (the Prep-dialog repair joins
through it), the wrapper reports it instead of silently sharing the first `QuestInfo`. Real multi-offer captures will
reach the inbox.

### 8.7 Imlight fork as a submodule, and an automated play-test harness — **L** *(D192, D194; split 8.7a/8.7b per G3)*
Add `jasonl8446/Imlight` as a submodule at `vendor/imlight`, pinned to a new fork branch `spiraldb-ui-harness`. This
amends D18 **for the fork only**: the sibling checkout stays read-only. Exclude it from eslint, prettier and vitest.

In the fork, add:
- a headless **virtual session** that takes a quest name, offers it, accepts it, completes each goal in goal-logic order
  and completes the quest;
- **outgoing-packet logging** that writes an Imview-format capture;
- GM commands to force-start, advance and complete a quest.

`npm run imlight:playtest -- --quest <name>` builds the fork with the D18 flags and .NET 10, runs the virtual session
against the D17 clone, and feeds the log through our wrapper. It then diffs the round-tripped quest against the file:
goal order, dialogue attached per step, completion reached.

**Acceptance:**
- A corpus quest play-tests clean.
- A deliberately broken draft (an unreachable goal) fails with a named reason.
- The fork's changes are pushed to the fork branch (the owner's repo). This repo pins a commit.
- CI stays .NET-free (D55): goldens are committed.

### 8.8 Gate — `gate-8`, then the final gate
The same model as Phase 7: every phase's verification steps re-run, the CI simulation without `data/` (D185), the PR,
then `final-deslop`, `final-review` and `final-verify`.

## Proposed decisions (written into plan-overview by 8.0)

- **D188:** The catalog universe is the union of named quests, hex ids and decimal-key titles. Each tier is reported
  with its own denominator; nothing is merged by guesswork.
- **D189:** Text drafts store keys, never copied text. Every row is proposed in row order with its measured type; the
  segmentation and speaker are suggestions with their measured precision, confirmed by a human.
- **D190:** Decimal-key titles are titles without a known text table. The link to the 648 WizQst-only tables is
  unproven and is never inferred silently.
- **D191:** Upstream SpiralDB is imported as suggestions from a separate bare mirror, crediting commit and PR, under
  CC BY-NC-SA. Community wikis and other outside sources are the human's job in the UI, not an import.
- **D192:** The Imlight fork is a submodule pinned to `spiraldb-ui-harness`. D18's read-only rule still covers the sibling
  checkout. The fork is for play-testing and validation, never discovery (D128 stands).
- **D193:** The capture inbox is automatic ingestion of human-made captures. The run never produces a live capture.
- **D194:** The play-test harness round-trips a quest through the fork's virtual session and our wrapper. It is proof
  that a quest plays, and it complements D113's load proof.

## Risks

| Risk | Mitigation |
|---|---|
| Text drafts flood the queue with ~55k lines | Grouped per quest and per segment; ranked by evidence richness (D130) |
| Wrong segmentation or speaker gets accepted | Each is a suggestion labelled with its measured precision, confirmed per block |
| Upstream PR #329 keeps changing | Import records the head commit; re-import shows only new or changed suggestions |
| AGPL code in a public repo | Submodule only: the code stays in the fork repo with its licence |
| The virtual session is harder than it looks (Imlight's quest senders are session-bound) | 8.7 is last and may be split; its failure never blocks 8.1–8.6 |
| Pushing to GitHub (fork branch, PRs) needs owner permission in this environment | Local work proceeds; each push or PR waits for the owner's go-ahead |
