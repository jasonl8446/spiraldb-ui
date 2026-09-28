# p5-06 D2 — the four fixes, and what each number became (story p5-06, plan task 5.6)

D1 (`p5-06-d1-checklist.md`) found **four** defects. This deliverable fixes them, smallest diff
first, and re-measures with the same instrument. **Desktop was not redesigned**: every number at
≥1280px is byte-identical to before, and the tablet tier is new rather than a shift of the
desktop one.

Diff scope: **7 files, +78/−22.**

| # | file:line | change | why the fix is *this* remedy |
|---|---|---|---|
| 1 | `client/src/components/objects/ObjectListPage.tsx:173` | the list header row gained **`md:flex-wrap`** | the overflowing element was a **header row**, not a table — so narrowing a child would have fixed nothing. The row goes `md:flex-row md:justify-between` at exactly the width where the sidebar also appears, forcing the tab strip and the search+create row side by side. `flex-wrap` lets the search row take its own line at tablet; from `lg` the column is wide enough for both, so the desktop row is unchanged. |
| 2 | `client/src/pages/QuestDetailPage.tsx:474` | the action group gained **`flex-wrap`** (plus the same reasoning p4-10 recorded) | identical shape to the fix p4-10 applied to `ObjectDetailLayout.tsx:147`; that story's scope was the *object* routes, so the *quest* detail page kept the un-wrapped group. |
| 3 | `client/src/components/layout/Sidebar.tsx:179` | `w-[260px]` → **`w-[200px] … xl:w-[260px]`** | the spec's tablet width is a breakpoint rule; this codebase expresses every breakpoint as Tailwind classes, and `xl` is exactly the spec's 1280px desktop line (the dashboard's stat-card grid already uses it for the same reason). |
| 4 | `client/src/components/layout/AppLayout.tsx:76` | `md:pl-[260px]` → **`md:pl-[200px] xl:pl-[260px]`** | the rail is `fixed`, so the content offset must mirror its width exactly; changing one without the other would leave a 60px gap or overlap. |
| 5 | `client/src/lib/quests.ts:328` | added `JSON_PANEL_TABLET_WIDTH_PX = 300`; `JSON_PANEL_WIDTH_PX = 400` stays as the **desktop** number | one home for each of the spec's two numbers. The existing unit pin `tests/unit/quests-browse.test.ts:415` asserts the desktop constant and is untouched. |
| 6 | `client/src/components/quest/QuestJsonPanel.tsx:168` | dropped the inline `style={{ width: JSON_PANEL_WIDTH_PX }}` (400 at every width above `md`) for **`w-[300px] … xl:w-[400px]`** | the width is a breakpoint rule, which an inline style cannot express. `tests/ui/responsive.spec.ts` measures the rendered `<aside>` against both constants, so the class and its constant cannot drift apart silently. |
| 7 | `tests/ui/object-mobile.spec.ts:642` | the arm that **pinned the defect** ("at 768 the panel is the 400px side pane") now asserts the spec's **300px**, with the correction stated in-file and in the file header | D40: a tier-1 spec must never pin a known defect as expected. The desktop 400px pane is now asserted at ≥1280 in the new spec. |

## Measured before → after (same instrument, same fixtures)

Instrument: the temporary `tests/ui/p5-06-audit.spec.ts`, **52 arms, all green, 0 unmocked
`/api/**` requests** — removed in D3; its raw output (after-values, and the pre-fix values for
comparison) is committed as
[`p5-06-d1-measurements.json`](./p5-06-d1-measurements.json).

### Defect A + B — horizontal overflow (the geometry)

| route | 375 | 639 | 640 | 767 | **768** | 1023 | 1024 | 1279 | 1280 | 1440 |
|---|---|---|---|---|---|---|---|---|---|---|
| `/quests/DS-ACAD-C01-001` | **524/375 → 375/375** | 639 | 640 | 767 | **784/768 → 768/768** | 1023 | 1024 | 1279 | 1280 | 1440 |
| `/drop-tables` | 375 | 639 | 640 | 767 | **838/768 → 768/768** | 1023 | 1024 | 1279 | 1280 | 1440 |
| `/npc-inventories` | 375 | 639 | 640 | 767 | **865/768 → 768/768** | 1023 | 1024 | 1279 | 1280 | 1440 |
| `/npc-spell-inventories` | 375 | 639 | 640 | 767 | **899/768 → 768/768** | 1023 | 1024 | 1279 | 1280 | 1440 |
| `/creature-spellbooks` | 375 | 639 | 640 | 767 | **893/768 → 768/768** | 1023 | 1024 | 1279 | 1280 | 1440 |
| `/npc-drop-tables` | 375 | 639 | 640 | 767 | **870/768 → 768/768** | 1023 | 1024 | 1279 | 1280 | 1440 |
| `/treasure-card-inventories` | 375 | 639 | 640 | 767 | **925/768 → 768/768** | 1023 | 1024 | 1279 | 1280 | 1440 |
| `/zone-transfers` | 375 | 639 | 640 | 767 | **858/768 → 768/768** | 1023 | 1024 | 1279 | 1280 | 1440 |

**8 routes with overflow → 0.** Across all 20 routes × 10 widths the offender list is now **empty**
(was: `<div class="ml-auto flex items-center gap-2">`, `<div class="flex flex-col gap-2
sm:flex-row sm:items-center">`, and their clipped descendants).

### Defects C + D — the two missing tablet tiers

| width | sidebar width before → after | `<main>` left before → after | JSON `<aside>` before → after |
|---|---|---|---|
| 375 | not mounted (same) | 0 (same) | overlay (same) |
| 640 | not mounted | 0 | overlay |
| 767 | not mounted | 0 | overlay |
| **768** | **260 → 200** | **260 → 200** | **400 → 300** |
| **1024** | **260 → 200** | **260 → 200** | **400 → 300** |
| **1279** | **260 → 200** | **260 → 200** | **400 → 300** |
| 1280 | 260 (same) | 260 (same) | 400 (same) |
| 1440 | 260 (same) | 260 (same) | 400 (same) |

### What did **not** change (the regression half)

| claim | measured after | verdict |
|---|---|---|
| mobile sidebar rail is hidden, not absent | 375/640/767: the rail is **mounted** (`hidden md:flex`) with `{visible:false, width:0}`; `toBeHidden()` holds | unchanged |
| hamburger at mobile | 375/640/767: `Open navigation` visible; 768+: hidden | unchanged |
| nav overlay box | 375/640/767: **260×900 at x=0** | unchanged |
| swipe-to-close | real `touchstart`(200,300)→`touchend`(20,320) → dialog count **0** at 375/639/640/767 | unchanged |
| JSON panel is a full overlay at mobile | 375/640/767: dialog **exactly the viewport, x=0**; no `<aside>` mounted | unchanged |
| tables → card lists | `table` count 0 at 375/640/767, 1 at 768+ on all 9 list routes | unchanged |
| tablet table scroll container | `wrapperOverflowX: "auto"`; the table's right edge ≤ viewport at every width | unchanged |
| stats cards | 1 column ≤767, 2 at 768/1024/1279, 4 at 1280/1440 | unchanged |
| ⌘K palette | settled box `min(viewport, 672)` wide and centred at all widths, 0 offenders | unchanged |

## Typecheck

```
$ npx tsc -p client/tsconfig.json --noEmit
[rc=0]
```

`npx prettier --write` on all seven touched files reported "unchanged" for the six client files and
reformatted the test files; `npm run lint`, `npm run typecheck:tests` and the rest of the gate are
in D3.

## Honest limits

1. The audit instrument was temporary and **has been removed**; the committed record of its
   output is `p5-06-d1-measurements.json`, and the durable assertions are
   `tests/ui/responsive.spec.ts` (whose §1 for the overflow and §2/§3 for the two numbers cover
   every claim in the tables above).
2. The tablet tier is verified at 768/1024/1279 and the desktop tier at 1280/1440; widths between
   those samples are covered by the same two Tailwind variants and are not separately measured.
3. `ObjectListPage`'s `md:flex-wrap` changes the tablet header from one row to two. That is the
   intended remedy (the alternative — shrinking the create control — would have hidden an
   affordance and is not what the spec asks for), but it is a **visual** change at 768–1023px that
   the numbers alone do not describe; no screenshot is offered as evidence for it beyond the
   geometry (`no overflow` + the row's own wrapping behaviour).