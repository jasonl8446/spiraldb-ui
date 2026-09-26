# p2-09 — Status transition UI: Mark Reviewed/Verified + notes dialog + history panel (task 2.8)

Branch `phase-2-quest-extraction`, HEAD `e7e1854` at dispatch, left **uncommitted** for the lead. This
story also closes **D42's** forward gap (`git_branch` in Settings).

**New client code**: [`lib/status-transition.ts`](../../../client/src/lib/status-transition.ts) (the pure
half: labels, the patch body, timeline ordering/text, the panel's five states, the 404 mapping, the
optimistic cache write), [`hooks/useStatusTransition.ts`](../../../client/src/hooks/useStatusTransition.ts)
(gate → dialog → mutation → toast, shared by both surfaces),
`components/quest/{StatusMenu,StatusNotesDialog,StatusHistoryPanel}.tsx`.
**Changed**: [`lib/api.ts`](../../../client/src/lib/api.ts) (`getStatusHistory` + its query key),
[`QuestBrowseTable.tsx`](../../../client/src/components/quest/QuestBrowseTable.tsx) (the real status menu),
[`lib/quests.ts`](../../../client/src/lib/quests.ts) (the placeholder constants deleted),
[`QuestsPage.tsx`](../../../client/src/pages/QuestsPage.tsx),
[`QuestDetailPage.tsx`](../../../client/src/pages/QuestDetailPage.tsx) (header actions + the history panel),
[`SettingsPage.tsx`](../../../client/src/pages/SettingsPage.tsx) (the read-only `git_branch` row).
**No server change, no new dependency.**

| AC clause | Result | Evidence |
|---|---|---|
| "Mark Reviewed" with notes → the history endpoint shows the transition | **PASS** | One real `PATCH /api/status/quests/DS-ACAD-C01-001` with body `{"status":"reviewed","notes":"p2-09 tier-2: reviewed live by the lead"}`; `GET .../history` then returned `{old_status:"extracted", new_status:"reviewed", notes:"…", changed_by:"Lead Verify", changed_at:"…"}` (tier-2 §3–4) |
| StatusBadge flips to blue/reviewed | **PASS** | The dot was already `rgb(59,130,246)` **immediately** after confirming (optimistic, before any refetch) and the filter tabs had already moved to `322 / 321 / 1 / 0`; the badge reads "Reviewed" at `rgb(96,165,250)` (tier-2 §3, §5) |
| Identity-modal guard fires first when `user_name` is empty | **PASS** | With `user_name: ""` clicking Mark Reviewed opened the identity dialog with **0 PATCH requests recorded**; only after the name was entered did the notes dialog appear (still 0 PATCH) and the transition proceed — and that name became `changed_by: "Lead Verify"` in the DB (tier-2 §2, §4) |
| History panel renders the timeline (P2 AC#14) | **PASS** | On the detail page: 10px blue-500 dot, `font-mono` key, `"DS-ACAD-C01-001 marked reviewed | just now | by Lead Verify"`, notes in **italic `rgb(161,161,170)` = zinc-400** — exactly spec-ui-design L177's anatomy; loading/empty/untracked/error states covered by the tier-1 specs (tier-2 §5) |
| D42 forward gap — `git_branch` in Settings | **PASS** | A new **read-only** input valued `content/2026-09-26` alongside the four editable fields; it never joins the Save PUT body (tier-2 §6) |

## Decisions (full list in D52)

- **The transition surfaces** are the browse table's status menu and the detail page header. The plan's
  parenthetical "and extraction results" is deliberately **not** shipped: an unsaved extraction has no
  `entry_status` row, so a PATCH there is a 404 by construction (D51(f), measured last round).
- **The identity gate runs before the notes dialog** (strict reading of "fires first"), and the gate's name
  is what the server attributes the transition to — the server is never sent `changed_by`.
- **`git_branch` is read-only**: it is derived from the save session's `content/YYYY-MM-DD` branch
  (spec-data-model L206–214), so hand-editing it would break the branch strategy.
- Failures keep the dialog open with an inline `role="alert"` and the typed notes preserved; the D51(f)
  untracked-404 becomes an actionable message instead of a generic error. Blank notes are omitted.
- The menu is a labelled Radix popover ("Change verification status"), not an ARIA menu with roving focus —
  D39 has no dropdown-menu primitive; recorded rather than half-claimed.
- A defect the story's own tests caught: Radix portals the popover to `document.body` but React still
  bubbles the click through the React tree, so choosing a status also activated the row and navigated away.
  Both the trigger and the content now stop propagation.

## Lead verification

- Canonical gate, ports free ([`gate-p2-09-leadverify.txt`](./gate-p2-09-leadverify.txt)): **30 files /
  770 unit tests**, **64 UI specs**, eslint 0, prettier 0, `typecheck:tests` 0, server+client `tsc` 0,
  `npm run build` green.
- Tier-2 ([`story-p2-09-tier2.txt`](./story-p2-09-tier2.txt), 3 screenshots): a real blank `user_name`,
  the real identity dialog, one real PATCH, a real `status_history` row attributed to the entered name,
  and the real timeline.
- Three artifacts in **my own** queries are recorded rather than hidden (tier-2 §8): a popover probe that
  read Radix's popper wrapper, a history-panel probe that walked up to `<main>`, and a badge probe that
  wrongly required a leaf element.
- **Hygiene**: the owner's fork stayed at `c55ccab` on `main` with an empty status; the disposable clone
  was reset; the dev stack was stopped (ports 5173/3001 free); 0 changes under `Imview`.

## Not claimed / flagged (D52)

- The extraction results list has no transition action (see above) — a deliberate, documented exclusion.
- The menu is not a full ARIA menu (no roving focus).
- **Corpus scale** (measured this round, prompted by the owner's note that the wiki lists ~1,539 side +
  ~2,325 storyline quests): the local repo holds **322** quest files and `GET /api/quests` scans and
  JSON5-parses all of them **per request** — 71,328 bytes in 0.45–0.54 s. Nothing hardcodes the count, so a
  larger corpus updates the numbers automatically, but ~12× the corpus would be ~12× the bytes and roughly
  several seconds per request: D12's "322 files is fine locally" now has a measured boundary (D52(i)).
