# p7-14 / plan task 7.13 — Verification step 6, the tier-2 walkthrough

Tier-2 per D23, driven per **D148**: the playwright-mcp browser cannot launch on this host, so the walkthrough is a
script (`p7-14-tier2-walkthrough.mjs`, committed beside this file) driving the repo's own pinned Playwright chromium
(`PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers`, D40) against a throwaway stack this story started and
stopped. It is read-only: it never presses Save. Its raw log is `p7-14-tier2-run.txt`.

These screenshots are **also the tier-2 evidence for p7-11 (readable card titles, `p7-14-tier2-goals.png`) and for
p7-12 (Basic / Advanced, `p7-14-tier2-dialog-*.png`)**, which had tier-1 specs only. The popover and glossary shots
repeat p7-13's on the new landing flow.

## The stack (owned, started by this story, stopped by it)

| what | value |
|---|---|
| API | `PORT=3291 VITE_API_PORT=3291`, never 3001 (the owner's) or 3181 (the tier-1 harness's) |
| client | `VITE_PORT=5291`, never 5173/5181 |
| database | `SPIRALDB_UI_DB=$PWD/data/__test-scratch__/p7-14.db`, a `better-sqlite3` `backup()` of the synced dev DB (1,717 `quests` rows; friendly names for npcs, spells, zones, quests, strings), with `settings.spiraldb_path` rewritten to the clone **before** it was opened by the server. Deleted after the run |
| corpus | `SPIRALDB_PATH=$PWD/data/test-spiraldb`, the D17 clone: 322 `QuestTemplates/*.json`, `content/2026-09-27` at `18dc924`. `git status --porcelain` in the clone is empty after the run (nothing was written) |
| ports | `ss -ltn` shows none of 3291/5291 after the stack was killed; the owner's 3001/5173 were never touched |

## The quest and the screenshots (1680x1000)

`WC-UNICORN-MAIN-001` "Ghost Hunters": a Bounty goal and two Persona goals, a linear goal logic, a registry-entry
requirement, a drop-table reward, a Prep and a Completion dialog.

| file | what it shows |
|---|---|
| `p7-14-tier2-overview.png` | the landing tab, Overview selected: `Given by Private Connelly (the Prep dialog speaker)`, `Order follows the goal logic.`, three steps titled by meaning with "from the start / after step 1 / after step 2" and the goal id as secondary mono text, `Completes when: step 3 is complete.`, the completion dialog speaker, the requirement in words and the reward |
| `p7-14-tier2-goals.png` | Goals: `Defeat 2 Lost_Soul in Unicorn Way (Bounty goal)`, `Talk to Private Connelly (Persona goal)`; the goal id beside each title; label pairs such as `Bounty Total (m_bountyTotal)` (p7-11 and p7-10 in the browser) |
| `p7-14-tier2-dialog-collapsed.png` | Dialog, an entry whose `Advanced` accordion is collapsed (its Basic tier open, Camera open, Sound / Animation / Advanced collapsed) |
| `p7-14-tier2-dialog-auto-opened.png` | Dialog, an entry whose `Advanced` accordion opened by itself because an advanced field holds a value. The walkthrough logs all 15 accordions: `m_dialogEntries[3]` and `[4]` of the first tag are expanded, the rest are not (`p7-14-tier2-run.txt`) |
| `p7-14-tier2-popover.png` | Info tab, the "What does this mean? Quest level" popover opened by keyboard: help, `Technical name: m_questLevel`, `Source: docs/spec-domain-reference.md:259`, "See in glossary" |
| `p7-14-tier2-glossary-technical.png` | `/glossary` searched for `m_questLevel`: one row |
| `p7-14-tier2-glossary-friendly.png` | `/glossary` searched for `Quest level`: the same one row |

Note: the walkthrough's row-count wait was rewritten from `page.waitForFunction` to a polling loop after the run,
because `eslint` rejects `document` in a `.mjs`; the log and the screenshots are the run made before that edit.
