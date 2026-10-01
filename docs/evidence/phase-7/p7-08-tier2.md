# p7-08 / plan task 7.7 — the draft queue and the accept flow (tier-2 evidence)

Tier-2 per D23, driven per **D148**: the playwright-mcp browser cannot launch on this host, so the walkthrough is a
script (`p7-08-tier2-walkthrough.mjs`, committed beside this file) driving the repo's own pinned Playwright chromium
(`PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers`, D40) against a live stack this story started and stopped.
The same walkthrough **is the write** the live Imlight boot proves (criterion 3): the harness ran it as its
`--save-cmd` between the two boots (`p7-08-live-boot.txt`).

## The stack (owned, started by this story, stopped by it)

| what | value |
|---|---|
| API | `PORT=3291 VITE_API_PORT=3291`, never 3001/3181 (the owner's and the tier-1 harness's) |
| client | `VITE_PORT=5291`, never 5173/5181 |
| database | `SPIRALDB_UI_DB=$PWD/data/__test-scratch__/p7-08.db`, a copy of p7-07's scratch copy of the synced dev DB (`coverage`: nameable 1,717 · id_space 4,823 · defined 330 · missing 1,387). Its `spiraldb_path` was rewritten to the clone **before** it was opened by anything (it pointed at the owner fork) |
| corpus | `SPIRALDB_PATH=$PWD/data/test-spiraldb`, the D17 clone: 322 `QuestTemplates/*.json`, `content/2026-09-27` at `18dc924` |
| drafts | rebuilt against the clone before the run: `npm run drafts -- --db data/__test-scratch__/p7-08.db --spiraldb data/test-spiraldb` (`p7-08-drafts-rebuild.txt`: inserted 20, removed 9, 6,365 drafts) |
| branch pin | `settings.git_branch = content/2026-09-27` (the clone's checked-out branch), so the save commits **on** it and never creates `content/<today>` from `main` (D76(b)/D119) |
| author | `settings.user_name = P7-08 Throwaway` |
| owned-port check | `npm run imlight:boot -- probe`: 12369/12500/12000/12333/8080 all free before the run; `ss -ltn` shows none of 3181/5181/3291/5291 or the five listening after it (`p7-08-clone-final.txt`) |

## The quest

`NV-PUERT-MAIN-012` ("Cheeky Monkeys"). It is a named catalog quest with no file in the clone or the fork. Its link is
**inferred**, so the D118 skeleton writes **no** title (`GET /api/quests/NV-PUERT-MAIN-012/scaffold` → `link_kind:
inferred, title_key: null, m_questTitle: null, m_goals: [], m_requirements: null`; `p7-08-pre-save-api.txt`). Its
draft carries exactly three pending suggestions:

| id | path | source | confidence | evidence_ref |
|---|---|---|---|---|
| 1005 | `m_questTitle` | evidence-title | 0.78 | `quest_ids:1562135 (inferred)` |
| 1006 | `m_goals` | evidence-goals | 0.109 | `goal_gates:NV-PUERT-MAIN-012 (Goal 3, Goal 4)` |
| 1007 | `m_requirements` | evidence-requirements | 0.579 | `name series: NV-PUERT-MAIN-011 precedes NV-PUERT-MAIN-012` |

So the saved file is built **only** from the skeleton and accepted suggestions: every non-skeleton value in it came
from an Accept.

## The screenshots (1680×1000, `docs/evidence/phase-7/`)

| file | what it shows |
|---|---|
| `p7-08-tier2-queue.png` | `/drafts` filtered to Named + No file: "1,002 drafts with evidence · 385 with none hidden", the zero-evidence toggle with its count, ranked rows with their name pairs, `Cheeky Monkeys (NV-PUERT-MAIN-012)` among them (Evidence 3, Pending 3, File none, Sources evidence-goals, evidence-requirements, evidence-title) |
| `p7-08-tier2-draft-editor.png` | `/drafts/quest/NV-PUERT-MAIN-012` on the skeleton in memory: the header's "Draft · no file yet", the accept-all bar above the form ("3 pending suggestions — nothing is written until Save", one "Accept all from <source> (1)" per source), and the Info tab's `m_questTitle  Suggested: QuestTitle_17D617 · evidence-title · confidence 0.78  [Accept] [Reject]` above the empty title field |
| `p7-08-tier2-accepted.png` | after three single Accepts (Info → Goals → Requirements): the Requirements tab shows `Suggested: requires quest NV-PUERT-MAIN-011 · … · Applied — saved with the next Save`, the ReqHasQuest node now in the tree (`Something Smells Fishy (NV-PUERT-MAIN-011)`), `Discard` in the header, all three accept-all buttons at `(0)`, and the validation banner "2 warnings: Unreachable goal. Warnings never block saving." — Save enabled |
| `p7-08-tier2-saved.png` | after Save: the editor continued at `/quests/NV-PUERT-MAIN-012` on the new file. The header reads `Cheeky Monkeys (NV-PUERT-MAIN-012)` with the Extracted badge and the transitions back, `m_questTitle` is `QuestTitle_17D617` resolving to "Cheeky Monkeys", no suggestion strip is left, and the toast says "Quest NV-PUERT-MAIN-012 saved and committed". The status-history row is "6 minutes ago" because the throwaway DB kept the first run's `entry_status` row; the clone restore does not touch the DB |
| `p7-08-tier2-name-dialog.png` | the D137 name dialog of unnamed id `#39199` ("Make Some Rubbings"): pre-filled `QuestTitle_991F` from its title key and selected, never submitted by the tool; the walkthrough pressed Cancel, and the DB shows `quest_ids 39199 matched_quest_name: null` and 0 `quests` rows named `QuestTitle_991F` afterwards (`p7-08-saved-quest.txt`) |

## What the save wrote (raw in `p7-08-saved-quest.txt`)

The proof ran twice. The first run (commit `40409fc`) passed 322 → 323, but its `saved` screenshot caught the editor
still loading. The walkthrough was given a proper wait (the file editor's heading and the save toast), ids 1005-1007
were reset to `pending` in the throwaway DB, and the whole proof re-ran. The screenshots are the second run's, and the
two runs wrote byte-identical templates (`cmp` in `p7-08-saved-quest.txt`).

Second run: `POST /api/quests/scaffold` → `HTTP 200`, `commit b432850`, `branch content/2026-09-27`,
`accepted_suggestions: [1005, 1006, 1007]`; one commit `spiraldb: create quest NV-PUERT-MAIN-012` on `18dc924` with exactly the template and
its metadata. The committed template's key order is the skeleton's, and it differs from the skeleton in exactly
`m_questTitle`, `m_goals` and `m_requirements`, each byte-identical to its suggestion's `value_json`. The whole file
equals `serializeDoc(skeleton + the three accepted values)`. All three rows are `accepted` with the same `decided_at`,
set after the commit. The harness then restored the clone on every axis (`p7-08-live-boot.txt`).
