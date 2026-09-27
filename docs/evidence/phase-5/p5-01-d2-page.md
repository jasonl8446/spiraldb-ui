# p5-01 D2 — the Dashboard page (story p5-01, plan task 5.1; D27, D37, D51, D76(c), D81, Q1)

## What was built

The `/` route's "Arrives in Phase 5" stub is replaced by the real page — the phase transition
p4-01…p4-07 recorded, so `phase: 5` in `client/src/lib/routes.ts` still means the phase that
*owns* the page.

| file | lines |
|---|---|
| `client/src/lib/dashboard.ts` (new) | 362 |
| `client/src/pages/DashboardPage.tsx` (new) | 81 |
| `client/src/components/dashboard/StatCards.tsx` (new) | 70 |
| `client/src/components/dashboard/TypeProgressSection.tsx` (new) | 74 |
| `client/src/components/dashboard/ActivityFeed.tsx` (new) | 181 |
| `client/src/lib/api.ts` | +~110 (`getDashboard`, `DASHBOARD_QUERY_KEY`, `getActivity`, `activityQueryKey`, `ACTIVITY_QUERY_KEY`, wire types) |
| `client/src/App.tsx` | `case '/'` → `<DashboardPage />` + doc comments |
| `client/src/hooks/useStatusTransition.ts` | +5: the settle invalidation also invalidates `DASHBOARD_QUERY_KEY` + `ACTIVITY_QUERY_KEY` |
| `tests/unit/dashboard.test.ts` (new) | 367 / 21 tests |
| `tests/ui/dashboard.spec.ts` (new) | 960 / 7 arms |
| `tests/ui/shell.spec.ts` | the `/` branch is now the real page's literals + both endpoints mocked (D81); the dead stub branch and its `phase` field removed |

## Decisions

- **Total card has no bar or percentage** — the spec's own drawing (L146) gives it "all
  objects"; a bar there would be the Verified card's bar repeated. The three status cards carry
  the bar and the `d.d%` text.
- **The Verified card prints `overall.percent_verified`** (the API's pre-rounded value); the
  Extracted and Reviewed percentages use the client's `percentOf`. One rule, and the unit test
  pins `percentOf(272, 597) === 45.6` — the spec's worked example (L158) — so the two call sites
  cannot disagree.
- **All eight tracked types render**, zeros included, because that is why the endpoint carries
  the zero buckets (D37). GlobalRegistry has no row: the list is derived from
  `OBJECT_TYPES.filter(objectType !== null)`, so adding a card for it would take a deliberate
  edit, not an accident.
- **The four cards and the eight bars come from one response** (`GET /api/dashboard`), asserted
  as exactly one request in the tier-1 spec.
- **Numbers are raw integers** (never `toLocaleString`): the rendered text *is* the API's number,
  and no locale can change it on a CI runner.
- **The feed's empty state requires a successful read with zero rows.** `activityFeedState`
  returns `error` when `data === undefined`, so a failed request can never render
  "No activity yet…" (the AC's own named failure mode); pinned in a unit test and an arm.
- **Unlinkable rows are shown, marked `— not linked`, not clickable, and counted** by the
  `[data-unresolved]` notice. The first implementation of `activityHref` had a real defect the
  unit test caught: `OBJECT_TYPES.find(row => row.objectType === entry.object_type)` matched the
  **GlobalRegistry** row (`objectType === null`) for a row with `object_type: null`, answering
  `/global-registry/<key>` — a route that does not exist. The guard rejects a non-string type.
- **The click-through reuses the existing `objectDetailPath`** (list pages' own builder) rather
  than a second mapping, and the quest branch uses the expression the browse table/card
  list/detail page already use.

## The accessible-name vocabulary (what a spec can address)

| element | address |
|---|---|
| section headings | `getByRole('heading', { name: 'Verification Progress by Type' })`, `… 'Recent Activity'` (level 2) |
| card number | `[data-stat="total"｜"extracted"｜"reviewed"｜"verified"]` — the raw integer text |
| card percentage | `[data-stat-percent="…"]` — `d.d%` |
| per-type row | `[data-type="<D4 singular object_type>"]` |
| per-type fraction | `[data-type-summary="…"]` — `verified/total (d.d%)` in one text node |
| bar segments | `[data-segment="extracted"｜"reviewed"｜"verified"]`, `style="width: d.d%"`, `aria-hidden` on the bar |
| feed row | `[data-activity-id="<id>"]`; its link is named `<key> <action text> <relative time>` |
| unresolved notice | `[data-unresolved="<n>"]` |
| errors | `getByRole('alert')` + `Try again` |
| empty state | the sentence + `getByRole('link', { name: 'Extract Quests' })` → `/quests/extract` |

Bars are `aria-hidden`: the percentage text beside each carries the same information, which is
the spec's "status by colour **and** text" rule (L545).

## Evidence

```
$ npx tsc -p client/tsconfig.json --noEmit        # rc=0
$ npm run typecheck:tests                          # rc=0
$ npx vitest run tests/unit/dashboard.test.ts
 ✓ tests/unit/dashboard.test.ts (21 tests)

$ PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers \
  npx playwright test --config tests/ui/p4-10-altport.config.ts dashboard.spec.ts shell.spec.ts
 16 passed (10.6s)   # 7 dashboard arms + 9 shell arms
```

## A finding for the lead (not fixed here)

With `/` built, **no route renders a stub any more**: the shell spec's `else` branch became
type-unreachable (`item` narrows to `never`), and I removed the now-dead `phase` field from its
`NAV_ITEMS` table (the branch now asserts the absence of stub text instead).
`client/src/pages/StubPage.tsx` and `client/src/components/SharedComponentsPreview.tsx` are now
reachable only from `App.tsx`'s `default:` branch, and the shell spec's three
`/api/names/{items,spells,npcs}` mocks exist only for those stubs. Task 5.7/5.8 may want to
delete them.
