# Phase 5 — Dashboard & Polish

**Status:** approved (2026-09-26, via plan-overview rev 3 / D29)
**Depends on:** Phases 1–4 (dashboard aggregates all tracked types; search spans all editors; polish audits every page)
**Spec reading order before starting:** [spec-ui-design.md](./spec-ui-design.md) L127–180 (dashboard), L516–546 (responsive, loading, error, a11y) → [spec-api.md](./spec-api.md) L144–164 (dashboard endpoint, built in Phase 1)

## Requirements Summary

Complete the verification dashboard (stats cards, per-type progress, activity feed), add cross-type search, and run the consistency passes AGENTS.md assigns to this phase: status filtering on all list views, error handling, loading states, accessibility, responsive behavior, and the production build. Finish with a fresh-clone dry run and corrected README.

## Tasks

### 5.1 Dashboard page — M
- `/` route per [spec-ui-design.md](./spec-ui-design.md) L127–180, consuming `GET /api/dashboard` (Phase 1).
- **Stats cards row**: Total / Extracted / Reviewed / Verified — grid-cols-4 desktop, 2 tablet, stacked mobile (L135); `zinc-900` card, `text-3xl font-bold` number, `text-sm text-zinc-400` label, status-colored progress bar, `text-xs text-zinc-500` percentage (L146).
- **Per-type progress**: "Verification Progress by Type" — one segmented bar per tracked type (amber/blue/emerald segments for extracted/reviewed/verified), 8px tall rounded-full, fraction + percentage right-aligned (L149–160). 8 tracked types; GlobalRegistry excluded (Q1).
- **Recent activity feed**: last 10 status changes as a timeline — colored dot, monospace object key, action text, relative timestamp, italic notes below; click navigates to the object (L162–177). Backed by a new `GET /api/activity?limit=10` (join `status_history` × `entry_status`, order by `changed_at desc`) — API extension recorded in [plan-overview.md](./plan-overview.md) decisions.
- **Empty state**: shield/checkmark illustration + "No activity yet. Extract some quests to get started." + "Extract Quests" button (L179).

### 5.2 Global search — M
- AGENTS.md Phase 5: "search across all object types". Implement as a header search palette (cmdk dialog, ⌘K/Ctrl+K): new `GET /api/search?q=&limit=20` matching `entry_status.object_key` (all types) plus friendly-name tables (items/spells/npcs/quests by name); results grouped by type with status dots; Enter/click navigates to the owning route. API extension recorded in the overview decisions.
- Per-list search inputs (Phase 2/4) remain as-is (client-side, D12).

### 5.3 Status filtering consistency pass — S
- Audit every list view (quests + 7 tracked types) against the same bar: filter tabs `[All][Extracted][Reviewed][Verified]` with live counts matching `GET /api/status/{type}` summary, URL-persisted filter state (query param), consistent empty states ([spec-ui-design.md](./spec-ui-design.md) L242–268).

### 5.4 Error handling & loading pass — M
- Apply [spec-ui-design.md](./spec-ui-design.md) L524–537 across all pages: skeleton screens on page load matching content layout; inline spinners in the affected area (never full-page blocking); API-error toast with retry action; persistent offline banner "Connection lost. Changes will be saved locally." on fetch failure storms; validation summary at top of forms with multiple errors.
- Server: consistent error envelope `{ "error": message }` + correct status codes everywhere (audit routes); no stack traces leaked to clients.

### 5.5 Accessibility pass — M
- Per [spec-ui-design.md](./spec-ui-design.md) L539–546: keyboard navigation for all interactive elements (including flowchart toolbar, tree editor, dialog accordions, dropdowns); focus rings `ring-2 ring-blue-500 ring-offset-2 ring-offset-zinc-950`; ARIA labels on icon-only buttons (sync, JSON toggle, drag handles, delete ×); WCAG AA contrast audit (4.5:1 text, 3:1 large); status conveyed by color **and** text/icon everywhere; `prefers-reduced-motion` respected for sidebar/panel transitions and React Flow animations.

### 5.6 Responsive pass — M
- Per breakpoint table ([spec-ui-design.md](./spec-ui-design.md) L516–522): mobile <768 (sidebar→hamburger overlay with swipe-to-close L97, tables→card lists, JSON panel→full overlay, stats cards stack), tablet 768–1279 (sidebar 200px, horizontal table scroll, JSON panel 300px), desktop ≥1280 (full layout). Walk every route at 375px / 768px / 1440px with a checklist.

### 5.7 Production build + docs — S
- `npm run build` → client bundle into `client/dist`; Express serves it statically on :3001 with SPA fallback ([spec-architecture.md](./spec-architecture.md) L144); `npm start` runs production mode; verify dev proxy and prod serving behave identically for every route.
- **README rewrite** (resolves Q4): fix stale doc links (current [README.md](../README.md) L61–63 points to pre-reorg filenames) → link the five specs + the six plan docs; prerequisites section gains the verified facts: .NET 9 SDK install (prerequisite 1), `npm run build:cli` with sandbox-safe flags (D18), prebuilt imcodec path default (D3), `npm run sync` before first use; Getting Started matches reality end-to-end.
- **Spec sync-up (D27 + Q1)**: append `GET /api/activity` and `GET /api/search` to [spec-api.md](./spec-api.md). (AGENTS.md's "all 9 types" wording and the README's stale links were already corrected on 2026-09-25 — re-audit both here against implemented reality: scripts, prerequisites, `npm run build:cli` flags.) Touch spec/AGENTS files only for these recorded resolutions — they remain authoritative for everything else.

### 5.8 Final verification sweep — M
- Re-run every phase's acceptance criteria as a regression checklist (Phases 1–4); fix fallout.
- Corpus round-trip suites green for all types (quests + Phase 4 types).
- **Fresh-clone dry run**: clone to a clean dir → `npm install` → configure settings → `npm run sync` → `npm run build:cli` → `npm run dev` → walkthrough (extract fixture quest → save → mark reviewed → edit a DropTable → dashboard reflects all) → `npm run build && npm start` → repeat key flows on :3001. Record the run as the release evidence.

## Acceptance Criteria

- [ ] Dashboard: the four stat cards' numbers equal `GET /api/dashboard` `overall`; each per-type bar's fraction equals that type's summary; percentages computed to one decimal.
- [ ] Activity feed shows the 10 most recent `status_history` rows with correct relative times and notes; clicking an entry navigates to that object's detail route; feed updates after a new status change without full reload.
- [ ] Dashboard empty state renders when `status_history` is empty (verified on a scratch DB).
- [ ] Global search: typing a substring of a known quest name and of a known DropTable name returns both, grouped by type, status dots correct; selecting a result lands on its detail page; `limit=20` respected; search over 15k+ name rows responds < 300ms locally.
- [ ] Every list view: four filter tabs with counts equal to the status API summary; filter survives reload via URL param; empty state per filter.
- [ ] Kill the Express server while the UI is open → offline banner appears within one failed request cycle; restart server → banner clears and data refreshes.
- [ ] Every API route returns the `{ "error": ... }` envelope with an appropriate status code on failure (audit test hits each route with malformed input).
- [ ] Keyboard-only pass: complete extract→save, mark reviewed, edit DropTable item, and dashboard navigation without a mouse; visible focus ring on every stop.
- [ ] axe-core scan **via Playwright MCP (D23)** on Dashboard, Quest list, Quest detail (edit mode), DropTable detail: zero critical/serious violations; reports + screenshots in `docs/evidence/phase-5/`.
- [ ] All icon-only buttons expose ARIA labels (automated query in a component test).
- [ ] With `prefers-reduced-motion: reduce` (Playwright `emulateMedia`, D23), no CSS transitions/React Flow animations play — evidenced by before/after screenshots mid-transition.
- [ ] Responsive checklist complete at 375/768/1440px for all routes: sidebar hamburger + swipe-close at 375px; tables→cards; JSON panel→overlay; tablet sidebar 200px.
- [ ] **UI test suite (D23 tier 1)**: committed `tests/ui/a11y.spec.ts` (`@axe-core/playwright`, zero critical/serious violations on the four key pages) and `tests/ui/responsive.spec.ts` (375/768/1440 layout assertions across all routes) pass headless in CI.
- [ ] `npm run build && npm start` → app fully functional on :3001 without Vite (all routes deep-linkable, refresh-safe via SPA fallback).
- [ ] Fresh-clone dry run (5.8) completed end-to-end; evidence (commands + outcomes) attached to the PR.
- [ ] README links resolve (`ls` check of every referenced path); Getting Started commands all work verbatim on a clean checkout.
- [ ] Full regression: Phase 1–4 acceptance criteria re-checked; corpus round-trip suites green.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Polish scope creep (endless UI tweaks) | Phase never ends | Acceptance criteria are the finish line; anything beyond them becomes a backlog note |
| Regression from shared-component refactors (ObjectListPage, layouts) | Breaks Phases 2–4 flows | 5.8 re-runs earlier phases' criteria; refactor behind tests, not alongside feature work |
| Search endpoint slow over large name tables | Sluggish palette | LIMIT 20 + SQLite indexes exist on name tables' PKs; measure in the criterion (<300ms) |
| axe scan noise (false positives on custom widgets) | Wasted effort | Triage only critical/serious; document waivered items with rationale |
| Prod-only bugs (SPA fallback, static asset paths) | Broken release build | 5.7 verifies every route in prod mode; dry run repeats it |

## Verification Steps

1. `npm test` → all suites (including regression + envelope audit) green.
2. Two-browser session: change status in one, observe feed/dashboard update in the other after refresh.
3. `npm run build && npm start` → curl `localhost:3001/quests` returns index.html (SPA fallback); UI walkthrough.
4. Playwright viewport passes at 375/768/1440 across the route checklist (`tests/ui/responsive.spec.ts` + MCP screenshots as evidence).
5. Playwright-driven axe scan on the four named pages (D23); reports archived under `docs/evidence/phase-5/`.
6. Fresh-clone dry run in `/tmp` per 5.8, timed and recorded.

**Done when:** all acceptance criteria checked with evidence; regression sweep green; README + docs accurate; project declared v1 in the PR summary.
