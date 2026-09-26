# p2-08 — Quest browse list + read-only detail page (task 2.7)

Branch `phase-2-quest-extraction`, HEAD `4408eba` at dispatch, left **uncommitted** for the lead. The first
story that exercises the **real corpus** (322 quests) in a browser, and the first to add runtime
dependencies since the initial scaffold.

**New client code**: [`lib/quests.ts`](../../../client/src/lib/quests.ts) (the pure half: column table,
filter tabs, search, comparators, pagination, empty-state copy, status/404 helpers),
[`pages/QuestsPage.tsx`](../../../client/src/pages/QuestsPage.tsx),
[`pages/QuestDetailPage.tsx`](../../../client/src/pages/QuestDetailPage.tsx),
`components/quest/{QuestBrowseTable,QuestCardList,QuestJsonPanel}.tsx`.
**Changed**: [`App.tsx`](../../../client/src/App.tsx) (the two real routes),
[`lib/api.ts`](../../../client/src/lib/api.ts) (`getQuest`, the list-row mirror, detail query key),
[`lib/display.ts`](../../../client/src/lib/display.ts) (`relativeTime`),
[`tests/ui/shell.spec.ts`](../../../tests/ui/shell.spec.ts) (its `/quests` **stub** assertion became a
real-page assertion — no test was weakened), `tests/unit/api-client.test.ts` (+3).
**Dependencies added**: `@tanstack/react-table@8.21.3` (spec-ui-design L16) and
`react-json-view-lite@2.5.0` (plan L64; the spec's L326 "or" clause) — both exact-pinned.

| AC clause | Result | Evidence |
|---|---|---|
| Filter tabs with count badges | **PASS** | Real data: `All 322 / Extracted 317 / Reviewed 3 / Verified 2`, seeded through the real status API and the real startup import (tier-2 §1) |
| Client-side search | **PASS** | "unicorn" on the Reviewed filter → 1 row, "Showing 1-1 of 1", tabs unchanged, no requests (tier-2 §2) |
| Exact column spec | **PASS** | Measured 40 / 717-flex / 60 / 60 / 40 / 120 / 80 with the spec's labels; name cell `font-mono` + truncate + tooltip; status dot 10×10 (amber-500 extracted, blue-500 reviewed); stripes zinc-900 / zinc-900/50 (tier-2 §1) |
| Pagination "Showing 1-50 of 322" | **PASS** | The literal string on the real corpus; Previous disabled / Next enabled; filtered → "Showing 1-3 of 3" with both disabled (tier-2 §1–2) |
| Per-filter empty states | **PASS** | "No Reviewed quests found. / Try a different filter or search, or extract more quests from a packet capture." + "Showing 0-0 of 0"; all four filters pinned in the tier-1 specs (tier-2 §2) |
| Mobile card list | **PASS** | 375px: 50 cards 312px wide, each "name / Level n / status / relative modified", each a link; the table is not rendered at all (tier-2 §6) |
| Rows click through to detail | **PASS** | Clicked a row → `/quests/WC-UNICORN-MAIN-004` (tier-2 §4) |
| Detail header (back link, mono name, StatusBadge, disabled Edit + tooltip) | **PASS** | Back link → `/quests`; name `text-xl font-mono font-semibold` (20px/600, JetBrains Mono); badge "Reviewed"; Edit `aria-disabled` + `title="Editing arrives in Phase 3"` and **verified inert** (tier-2 §4) |
| Six read-only tabs via `QuestPreview` | **PASS** | Info/Goals/Goal Logic/Requirements/Results/Dialog, 0 editable controls, real Goals content rendered (tier-2 §4) |
| JSON side panel (react-json-view-lite, 400px, syntax-highlighted) | **PASS** | `aside` measured exactly **400px** with the slide-in transition, `{ }` toggle + `[Copy]`, real quest JSON, five distinct solarized token colours; at 375px it becomes a full-screen 375×667 dialog instead (tier-2 §5) |
| Unknown quest does not crash | **PASS** | "Quest not found / Unknown quest \"NO-SUCH-QUEST-XYZ\"" + back link, no page errors (tier-2 §7) |

## Decisions (full list in D51)

The spec leaves the status-menu content, the tooltip mechanism, the empty-state wording for the All tab,
and the detail page's status source open; D51 records each choice plus a **measured contract fact p2-09
needs**: `PATCH /api/status/:type/:key` only transitions entries that already have an `entry_status` row,
so a never-imported, never-saved quest 404s there even though the browse list shows it (D49(b) defaults
the row to `extracted`). Entries enter tracking through the startup import or a save.

## Lead verification

- Canonical gate, ports free ([`gate-p2-08-leadverify.txt`](./gate-p2-08-leadverify.txt)): **29 files /
  750 unit tests**, **49 UI specs**, eslint 0, prettier 0, `typecheck:tests` 0, server+client `tsc` 0,
  `npm run build` green (client 487 kB). `npm ci --dry-run` reports the lockfile in sync.
- Tier-2 ([`story-p2-08-tier2.txt`](./story-p2-08-tier2.txt), 4 screenshots): real 322-quest corpus,
  real startup import (2271 entries), real status transitions through the API, real JSON panel tokens.
- Three artifacts in **my own** queries are recorded rather than hidden (tier-2 §8): the first table query
  ran in a narrow viewport (it was correctly showing the mobile cards), a JSON-panel selector matched the
  nav `<aside>` first, and one compound selector threw on my own bad escaping.
- **Hygiene**: the owner's fork stayed at `c55ccab` on `main` with an empty status; the disposable clone
  was reset after the run; the dev stack was stopped (ports 5173/3001 free).

## Not claimed / flagged (D51)

- 768px exactly is not driven (375 and 1440 were; `useIsMobile` is `max-width: 767px`).
- The `skipped[]` array of the list endpoint is **not** surfaced: a corpus file that fails to parse
  silently reduces the row count with no hint in the UI (no AC asks for it — flagged for Phase 5's polish).
- No real `npm ci` was run on this host (its npm gates install scripts, so a clean install would skip
  better-sqlite3's rebuild and could break `node_modules`); the runner covers the real check.
- The status **menu** is a labelled disabled placeholder — transitions are p2-09's story, and the Actions
  column's Edit action is Phase 3's.
