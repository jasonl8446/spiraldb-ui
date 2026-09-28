# p6-08 / plan task 6.7 — the evidence panel and its one-click insert (tier-2 evidence)

Story **p6-08** (`docs/plan-phase-6-quest-catalog.md` L333-341). Tier-2 evidence per **D23**: a real
stack this story started itself, driven in a real browser, with the raw save diff and the clone's
restore proof recorded beside it. The tier-1 half is the committed spec
`tests/ui/quests-evidence-panel.spec.ts`; the reducer's unit half is
`tests/unit/evidence-insert.test.ts`, and the panel's own "never writes" instruments are
`tests/unit/evidence-panel.test.ts`.

## The stack (owned, started by this story, stopped by it)

| what | value |
|---|---|
| API | `PORT=3191 VITE_API_PORT=3191` — never 3001/3181 (the developer's and the tier-1 harness's ports) |
| client | `VITE_PORT=5191` — never 5173/5181 |
| database | `SPIRALDB_UI_DB=/tmp/p608.db` — a scratch DB, so `data/spiraldb-ui.db` stays byte-identical |
| corpus | `SPIRALDB_PATH=$PWD/data/test-spiraldb` — the D17 clone, 322 `QuestTemplates/*.json` |
| session branch pin | `PUT /api/settings {"git_branch":"content/2026-09-27"}` before any save, so the save commits **on the clone's own branch** instead of creating `content/2026-09-28` from `main` (the D76(b) shape) |
| author | `PUT /api/settings {"user_name":"P6-08 Tier-2"}` — the metadata stamp the diff shows |

The DB was built by the story's own sync, and its counts match p6-05's recorded run exactly:

```
$ SPIRALDB_PATH=$PWD/data/test-spiraldb SPIRALDB_UI_DB=/tmp/p608.db npm run sync
  quests              : 322
  string_table        : 216,991
  persona_index       : 23,003 persona object names
  quests rows         : 1,717 (has_definition = 1: 322)
  catalog refs        : 2,855 rows kept
  quest ids           : 4,823 (linked 175; …)
  links extracted     : 286 direct, 6 inferred, 1,157 none
  hold-out            : 78.0% (neighbour-midpoint; 168 cases, 131 hits)
```

`data/spiraldb-ui.db` was never opened for writing: `sha256` before and after the whole story is
`a13f9aa8376411f6c6c0ea704098fcba6c4a226298eaba114230414af9e572ac`.

## The screenshots

All under `docs/evidence/phase-6/`, 1680×1000 chromium, `WC-CYCLOPS-MAIN-002` (the plan's own
example quest, and one of the two clone files this tool wrote itself, so its bytes round-trip).

| file | what it shows |
|---|---|
| `p6-08-tier2-panel-beside-editor.png` | **The panel beside the editor, in edit mode.** One 400px rail carrying the `Evidence │ JSON` tabs (Evidence selected) next to the Goals tab. `Title: Run and Done` with **no** badge (this quest's real `title_source` is `none`), `Insert into: m_goals[0].m_goalText`, then `── Used by this file ──` with the used rows **grouped under the field each already fills** and an `Insert` + `→ <field>` per row. The status bar warns "6 warnings: Unreachable goal. Warnings never block saving." — D72's warn-not-block, and `Save` is enabled. |
| `p6-08-tier2-inferred-badge.png` | **The inferred badge.** `Title: Run and Done` followed by the amber `Title inferred` badge — see the measurement below for why this one shot needs a scratch-DB row. |
| `p6-08-tier2-insert-target.png` | **The focused target before the click.** The Dialog tab's first goal-level entry is focused, so the panel's target line reads `m_goals[0].m_dialogList.m_dialogs[0].m_dialogEntries[0].m_dialog`, and the Dialogue section's row for the sibling key offers exactly one `Insert`. |
| `p6-08-tier2-inserted.png` | **The insert.** The entry's `m_dialog` input now reads `WizQst17318E_00000006` (it was `WizQst17318F_00000006`), and the resolved string-table text is rendered beneath it — the KEY landed and it resolves. Toast: "Inserted into the focused field — Save to write it to the file." The header shows `Discard` (the document is dirty). No file has been written. |
| `p6-08-tier2-saved.png` | **The save.** The second toast, `Quest WC-CYCLOPS-MAIN-002 saved and committed`, with the field still showing the inserted key and the document clean again (no `Discard`). |

## The live save's raw `git diff` and the restore

`p6-08-tier2-clone-restore.txt` records the live UI's own save: the diff of the one commit the
pipeline made, the changed file set, the five axes before and after, and the local ref list on both
sides. In short:

```
-                "m_dialog": "WizQst17318F_00000006",
+                "m_dialog": "WizQst17318E_00000006",
```

plus the two metadata stamps (`ModifiedAt`, `ModifiedBy`) in the companion file — the same
two-file change set the p3-10 isolation test pins. The restore is `git reset --hard 18dc924`, after
which branch, `HEAD`, the `main` ref, `git rev-list --count HEAD` (42), `git status --porcelain`
(empty) and the 322-file corpus shape all read as before, and the local ref list's md5 is
**identical to the pre-run value** (`45b4157b0132ecec1a6e6b6dc964c1c5`) — D76(b)'s "a branch left
behind" is absent because the session branch was pinned to the clone's own branch before the save.

The automated half is `p6-08-ac1-git-diff.txt` (`tests/unit/quest-evidence-insert-isolation.test.ts`):
the same claim driven through the pipeline with a dialogue row taken from task 6.6's service, plus
the byte-level statement — the serialized document differs on **exactly one line**, and putting the
old value back restores the bytes exactly.

## The inferred badge: what could and could not be shown from real data

The badge is a function of the API's `title_source` and `inference_basis`, and the panel renders it
for `inferred` only (`lib/evidence-insert.ts`'s `inferredTitleBadge`, D106). The measured problem is
**upstream of the panel**: in both corpora the 5 inferred catalog links belong to quests with **no
file**, so the editor cannot open them at all.

```
# the clone, from the story's own sync
inferred quests with a definition: DM-HOWL-MAIN-003, KT-WEAVE-ICE-002, LM-HEAP-MAIN-007,
                                   LM-NIGHT-MAIN-009, NV-PUERT-MAIN-012  → all has_definition = 0
# the owner's fork (a read-only sync into another scratch DB, same 5 names, same 0):
inferred + has_definition = 1: (none)
```

So the screenshot was taken with **one column of the scratch DB overridden** —
`UPDATE quests SET title_source='inferred', link_kind='inferred' WHERE quest_name='WC-CYCLOPS-MAIN-002'`
— and reverted afterwards. What is real: the API's `title_source` vocabulary, the badge's render
path, the quest, its file, its rows and its 22/8 split. What is synthesised: the join between an
inferred link and a file-backed quest, because no such join exists in either measured corpus. The
`inference_basis` line is consequently absent in that shot (its real value for this quest is
`null`); the basis line is asserted on screen by the tier-1 spec, which feeds
`?panel=evidence`'s mock an inferred link with its basis.

This is a finding for the story report: **the plan's "an inferred title is visibly marked inferred"
has no reachable editor surface in the frozen corpus today** — it needs either a scaffolded file for
a catalog-only quest (task 6.8) or the id-tier surface (task 6.10) to be exercised on real data.

## View mode vs edit mode

The spec says the panel appears in **both** modes, and insert actions only make sense where a
document is editable. Here is what that means in the shipped code:

- **Both modes** mount the same `EvidencePanel` in the same rail, with the same rows, the same
  22/8 split and the same friendly-name/reference sections. The tier-1 spec asserts the panel is
  present and populated in view mode.
- **Edit mode** is the only mode with insert actions, because the insert targets come from the
  **editors**: `QuestGoalsEditor`'s goal card and its `m_locationName` control, and
  `DialogListEditor`'s entry card report the focused field through `EvidenceFocusProvider`
  (`components/quest/EvidenceFocus.tsx`). View mode mounts the read-only bodies (`panels ===
  undefined`), so nothing reports, the target stays `null`, and every row renders **no button**
  with the sentence "View mode shows a read-only document — switch to Edit to insert." — the
  honest reason rather than "nothing is focused".
- The alternative — allowing inserts in view mode — would need a write path from a read-only
  screen, which is exactly what D66(a)'s "view mode = no panels" and the panel's never-writes rule
  exist to prevent.

## The panel never writes — the three instruments

1. **Source scan with a proven-sensitive scanner** (`tests/unit/evidence-panel.test.ts`): the
   panel's own source (comments stripped, so its prose about the write rule is not mistaken for
   code) is scanned for the write surface — `saveQuest`, `createSavePipeline`, `writeFile`,
   `simpleGit`, `applyEdits`, `setAtPath`, `fetch(`, … — and finds nothing; the same scanner over
   deliberately mutated copies reports `saveQuest`, `fetch(` and `applyEdits`, and over a comment
   naming a writer reports nothing. A scanner that could never fail is falsified there rather than
   trusted (D89(c)).
2. **Render** (`renderToStaticMarkup`, node, no jsdom): rendering the panel — the one moment a
   component could write without a click — calls the `onInsert` spy **zero** times.
3. **The runtime half** (tier-1): after every insert the mocked API has recorded **no**
   `POST /api/quests`, and the tier-2 run above proves the real ordering — the insert only dirties
   the in-memory document, and the file is written by Save through the existing pipeline.

## The key-not-text measurement

An evidence row is a `(key, text)` pair: the panel renders the text, the reducer writes the key.
Measured on the live stack for this quest: `m_dialog` holds `WizQst17318F_00000006` (27/27
non-empty dialog keys are keys), `m_locationName` holds `ZoneLocName_9140` (746 of 772 corpus
goals), and `string_table` is what turns either into prose. The insert therefore writes the key, and
both the unit suite and the clone test assert that the row's **text is nowhere in the document**.

`m_goalText` is the other measured fact the reducer had to respect: **0 of the 772 corpus goals
carry the key**, so "goal text into the focused goal" is an **add** — `setAtPath` appends it, the
serialized document gains exactly one line, and the goal's previous last key gains nothing but a
separator comma. The clone test proves that on the real file's bytes without saving a second commit.

## Reproducing all of it

```bash
# the unit half (44 tests, and the raw diff printed by the clone test)
npx vitest run tests/unit/document-path.test.ts tests/unit/evidence-insert.test.ts \
  tests/unit/evidence-panel.test.ts tests/unit/quest-evidence-insert-isolation.test.ts

# the tier-1 half
PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers \
  npx playwright test tests/ui/quests-evidence-panel.spec.ts

# the tier-2 stack (then drive it; the driver used here is /tmp/p608-tier2.mts, a rig script)
rm -f /tmp/p608.db
SPIRALDB_PATH=$PWD/data/test-spiraldb SPIRALDB_UI_DB=/tmp/p608.db npm run sync
PORT=3191 VITE_API_PORT=3191 VITE_PORT=5191 SPIRALDB_UI_DB=/tmp/p608.db \
  SPIRALDB_PATH=$PWD/data/test-spiraldb npm run dev
#   PUT /api/settings {"git_branch":"content/2026-09-27","user_name":"P6-08 Tier-2"} first
# restore afterwards
git -C data/test-spiraldb reset --hard 18dc924
```