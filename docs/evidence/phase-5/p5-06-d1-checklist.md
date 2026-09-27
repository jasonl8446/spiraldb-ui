# p5-06 D1 — the responsive checklist, walked (story p5-06, plan task 5.6)

One acceptance criterion, quoted (`docs/plan-phase-5-dashboard-polish.md` L60, P5 AC#12):

> **Responsive checklist complete at 375/768/1440px for all routes**: sidebar hamburger +
> swipe-close at 375px; tables→cards; JSON panel→overlay; tablet sidebar 200px.

The breakpoint table this is checked against is `docs/spec-ui-design.md` L516–522:

| breakpoint | width | behavior (spec's words) |
|---|---|---|
| Mobile | < 768px | Sidebar → hamburger. Tables → card lists. JSON panel → full overlay. Stats cards stack. |
| Tablet | 768–1279px | Sidebar visible but narrower (**200px**). Tables scroll horizontally. JSON panel **300px**. |
| Desktop | ≥ 1280px | Full layout. Sidebar **260px**. JSON panel **400px**. All features available. |

plus L97 ("Sidebar collapses to hamburger menu. Overlay on open. **Swipe-to-close gesture.**").

**This deliverable changes no code.** It reports what every route measures at every width.

## 0. Method, and why the widths are these

- **Routes:** all 20 in `client/src/lib/routes.ts` `APP_ROUTES` (the set `tests/ui/shell.spec.ts`
  pins "and nothing else"), each at a concrete value for its dynamic segment.
- **Widths:** the three the criterion names (375/768/1440) **plus every boundary the app's own
  rules flip at** — `sm` 640, `md` 768, `lg` 1024, `xl` 1280 — sampled on **both sides** (375,
  639, 640, 767, 768, 1023, 1024, 1279, 1280, 1440). A breakpoint rule fails at its boundary, not
  at its middle; sampling only the three named widths would have missed the single largest defect
  in this report (D78(d)'s technique: an exact comparison, not an impression).
- **Instrument:** `tests/ui/p5-06-audit.spec.ts` — a temporary measurement harness (52 arms, all
  green) whose one dispatcher mocked **every** `/api/**` read (D81; the harness has no corpus, and
  the mocked-path guard recorded **0** unmocked requests across all 200 route×width visits). For
  each visit it recorded `document.documentElement.scrollWidth` / `clientWidth`, the maximum right
  edge over every `body *` element, the offender list, `<main>`'s left/width, the sidebar's
  visibility and measured width, the hamburger's visibility, and the `table` count. **The harness
  was removed in D3** (its 52 arms assert nothing a reviewer could use as a durable spec), and its
  raw output is committed here as [`p5-06-d1-measurements.json`](./p5-06-d1-measurements.json) —
  the full per-route×width geometry, the shell/panel/card/table/palette arms, the pre-fix values
  for comparison, and the 768px ancestry probe. The durable assertions live in
  `tests/ui/responsive.spec.ts` (§4 below).
- **A settled tree only** (D85(a)): every arm waits for a route-specific "loaded" element, never
  a timeout; the dialogs' boxes are **polled to stability**, because the vendored primitive
  animates in (`zoom-in-95`, `duration-200`) and a single sample reads a mid-animation rect — the
  first raw pass measured the palette at `x=697 w=642` at 1440px, which was the animation, not the
  layout; settled it is `x=384 w=672` (centred).

## 1. Every route × every breakpoint — viewport width vs the widest element (`scrollWidth/clientWidth`)

Bold = **the document scrolls sideways**; `+N` = the overflow in pixels.

| route | 375 | 639 | 640 | 767 | 768 | 1023 | 1024 | 1279 | 1280 | 1440 |
|---|---|---|---|---|---|---|---|---|---|---|
| `/` | 375/375 | 639/639 | 640/640 | 767/767 | 768/768 | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |
| `/quests/extract` | 375/375 | 639/639 | 640/640 | 767/767 | 768/768 | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |
| `/quests` | 375/375 | 639/639 | 640/640 | 767/767 | 768/768 | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |
| `/quests/DS-ACAD-C01-001` | **524/375 (+149)** | 639/639 | 640/640 | 767/767 | **784/768 (+16)** | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |
| `/drop-tables` | 375/375 | 639/639 | 640/640 | 767/767 | **838/768 (+70)** | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |
| `/drop-tables/DROP-A` | 375/375 | 639/639 | 640/640 | 767/767 | 768/768 | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |
| `/npc-inventories` | 375/375 | 639/639 | 640/640 | 767/767 | **865/768 (+97)** | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |
| `/npc-inventories/1025` | 375/375 | 639/639 | 640/640 | 767/767 | 768/768 | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |
| `/npc-spell-inventories` | 375/375 | 639/639 | 640/640 | 767/767 | **899/768 (+131)** | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |
| `/npc-spell-inventories/1057` | 375/375 | 639/639 | 640/640 | 767/767 | 768/768 | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |
| `/creature-spellbooks` | 375/375 | 639/639 | 640/640 | 767/767 | **893/768 (+125)** | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |
| `/creature-spellbooks/deck-a` | 375/375 | 639/639 | 640/640 | 767/767 | 768/768 | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |
| `/npc-drop-tables` | 375/375 | 639/639 | 640/640 | 767/767 | **870/768 (+102)** | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |
| `/npc-drop-tables/12345` | 375/375 | 639/639 | 640/640 | 767/767 | 768/768 | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |
| `/treasure-card-inventories` | 375/375 | 639/639 | 640/640 | 767/767 | **925/768 (+157)** | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |
| `/treasure-card-inventories/2019` | 375/375 | 639/639 | 640/640 | 767/767 | 768/768 | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |
| `/zone-transfers` | 375/375 | 639/639 | 640/640 | 767/767 | **858/768 (+90)** | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |
| `/zone-transfers/WizardCity%2FWC_Hub` | 375/375 | 639/639 | 640/640 | 767/767 | 768/768 | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |
| `/global-registry` | 375/375 | 639/639 | 640/640 | 767/767 | 768/768 | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |
| `/settings` | 375/375 | 639/639 | 640/640 | 767/767 | 768/768 | 1023/1023 | 1024/1024 | 1279/1279 | 1280/1280 | 1440/1440 |

**12 of 20 routes are clean at all ten widths. 8 fail — in exactly two defect classes, and every
one of the 8 fails at 768px.**

### Failure 1 — the `md`-row header on seven object list pages: **+70 … +157px at 768px**

Offending element (identical on all seven): `div.flex.flex-col.gap-2.sm:flex-row.sm:items-center`
inside `div.flex.flex-col.gap-3.md:flex-row.md:items-end.md:justify-between`
(`client/src/components/objects/ObjectListPage.tsx:173` and `:218`).

| route | 768px `scrollWidth` | overflow |
|---|---|---|
| `/drop-tables` | 838 | +70 |
| `/zone-transfers` | 858 | +90 |
| `/npc-inventories` | 865 | +97 |
| `/npc-drop-tables` | 870 | +102 |
| `/creature-spellbooks` | 893 | +125 |
| `/npc-spell-inventories` | 899 | +131 |
| `/treasure-card-inventories` | 925 | +157 |

**Why it is a boundary defect and not a general one.** From `md` (768px) the outer row becomes a
`flex-row justify-between`, so the status-tab strip and the search+create row are forced
side-by-side. Measured at 768px (`/tmp/p5-06/probe.json`):

```
<div class="flex flex-col gap-2 sm:flex-row sm:items-center"        x=415 w=423>   ← search + create
  parent: <div class="... md:flex-row md:items-end md:justify-between" x=284 w=460>
          <main class="p-6" x=260 w=508>
```

415 + 423 = **838 of 768** on `/drop-tables`, and up to 925 on the longest button label. At 767px
the same row is `flex-col`, so nothing overflows (767/767 clean); at 1024px the content column has
grown to 716px and the two children fit again (1023/1024/1279 clean). The rule is broken **only**
at 768–~1000px, i.e. exactly where the sidebar appears at its widest relative to the viewport. The
seven routes differ by the width of their create button's label ("New treasure card inventory" is
the longest).

### Failure 2 — the quest detail header action group: **+149px at 375px, +16px at 768px**

`/quests/DS-ACAD-C01-001` is the only route that overflows at **375px**. Offending element:
`div.ml-auto.flex.items-center.gap-2` (`client/src/pages/QuestDetailPage.tsx:474`) — width **500**,
right edge **524 of 375** at 375px and **784 of 768** at 768px.

This is the same defect p4-10 found and fixed on the *object* detail routes (its fix #1:
`ObjectDetailLayout`'s group, right edge 461 of 375 → `flex-wrap`), but the **quest** detail page
was not in that story's scope, so it still carries the un-wrapped version. At 767px it is clean
(719px of content absorbs the 500px group), at 375px it is not.

## 2. The shell rules, per breakpoint — the numbers the spec states

| width | sidebar rail | hamburger | overlay dialog (settled box) | overlay closed by swipe |
|---|---|---|---|---|
| 375 | present, `display: none` (width 0) | visible | 260×900 at x=0 | **yes** (dialog count 0) |
| 639 | present, hidden (width 0) | visible | 260×900 at x=0 | yes |
| 640 | present, hidden (width 0) | visible | 260×900 at x=0 | yes |
| 767 | present, hidden (width 0) | visible | 260×900 at x=0 | yes |
| 768 | **visible, 260px** | not visible | — | — |
| 1023 | visible, **260px** | not visible | — | — |
| 1024 | visible, **260px** | not visible | — | — |
| 1279 | visible, **260px** | not visible | — | — |
| 1280 | visible, 260px | not visible | — | — |
| 1440 | visible, 260px | not visible | — | — |

- **Mobile ≤767px: correct.** The rail is **mounted but `display: none`** below `md`
  (`Sidebar.tsx`'s `hidden md:flex`) — measured `{visible: false, width: 0}` at 375/639/640/767,
  i.e. hidden, *not* absent. (This wording was corrected in D3: an earlier draft of this file said
  "unmounted", which the audit's own numbers never said, and a `toHaveCount(0)` assertion written
  from that wording failed on the committed spec's first run.) The hamburger
  (`aria-label="Open navigation"`) is visible, and opening it mounts a `role=dialog` named
  "Navigation" whose settled box is **260×900 at x=0** — left-anchored, full viewport height.
- **Swipe-close: wired and working.** A real `touchstart`(200,300) → `touchend`(20,320) sequence
  dispatched at the dialog closes it (dialog count 0) at every mobile width. The pure rule
  (`client/src/lib/swipe.ts`) was already unit-tested; this is the wiring half.
- **Tablet 768–1279px: FAILS the spec. Measured sidebar width is 260px at 768, 1023, 1024 and
  1279 — the spec says 200px.** There is no tablet tier in the shell at all: `Sidebar.tsx:179`
  and `AppLayout.tsx:76` use `md:` (768) for the 260px layout and never use `xl:` (1280), so the
  260px sidebar starts four hundred pixels early and is never narrowed. `/` to `/settings` — every
  route — is affected. Desktop ≥1280px is correct (260px).
- **Desktop ≥1280px: correct** (260px rail, no hamburger).

## 3. The JSON panel per breakpoint

| width | surface | measured | spec | verdict |
|---|---|---|---|---|
| 375 | `role=dialog` overlay | **375×900 at x=0** (the viewport) | full overlay | ✅ |
| 639 | overlay | 639×900 at x=0 | full overlay | ✅ |
| 640 | overlay | 640×900 at x=0 | full overlay | ✅ |
| 767 | overlay | 767×900 at x=0 | full overlay | ✅ |
| 768 | desktop `<aside>` | **400px** | **300px (tablet)** | ❌ |
| 1023 | `<aside>` | **400px** | **300px** | ❌ |
| 1024 | `<aside>` | **400px** | **300px** | ❌ |
| 1279 | `<aside>` | **400px** | **300px** | ❌ |
| 1280 | `<aside>` | 400px | 400px | ✅ |
| 1440 | `<aside>` | 400px | 400px | ✅ |

`QuestJsonPanel` (`client/src/components/quest/QuestJsonPanel.tsx:173`) writes
`style={{ width: JSON_PANEL_WIDTH_PX }}` with `JSON_PANEL_WIDTH_PX = 400`
(`client/src/lib/quests.ts:329`) — one number, no breakpoint. Note the existing tier-1 arm
`tests/ui/object-mobile.spec.ts` ("at 768 the panel is the 400px side pane again") **pins this
defect as expected**; D2 changes the behaviour and that arm with it (D40 forbids pinning a defect).
Worth recording: the panel does **not** currently cause a horizontal overflow at tablet, because
400 < the content column (460px at 768) — so the violation is the spec's number, not the geometry.

## 4. The rest of AC#12, measured

| clause | width | measured | verdict |
|---|---|---|---|
| **Tables → card lists** (mobile) | 375/639/640/767 | `table` count **0** on all 9 list routes (`/quests` + the 8 families); the table is genuinely **not mounted** there (`isMobile ? <ObjectCardList/> : <ObjectTable/>`), unlike the rail | ✅ |
| | 768/1023/1024/1279/1280/1440 | `table` count **1** on the same 9 routes | ✅ |
| **Tables scroll horizontally** (tablet) | 768+ | the shared `Table` primitive wraps every table in `overflow-x: auto` — measured `wrapperOverflowX: "auto"`, `wrapperScrollWidth == wrapperClientWidth` (460/460 at 768, 971/971 at 1279, 1132/1132 at 1440), table right edge 744 ≤ 768 | ✅ structurally; the tables compress to fit today, so the container's scroll is never exercised. **This is the correct remedy when a table is too wide — and it is why the fix for Failure 1 must not be "narrow the table".** |
| **Stats cards stack** (mobile) | 375/639/640/767 | 4 cards, **1 distinct x** → one column | ✅ |
| | 768–1279 | 2 columns | ✅ (spec states no tablet rule for the cards) |
| | 1280/1440 | 4 columns | ✅ (`xl` = 1280 = the spec's desktop boundary — the dashboard already uses the right tier) |
| **⌘K palette** (P5 addition) | all 10 | settled box `min(viewport, 672)` wide, **centred** (x=48 at 767, 176 at 1024, 384 at 1440), `scrollWidth == clientWidth`, 0 offenders | ✅ no overflow at any width |
| **`/` dashboard** (P5 addition) | all 10 | clean at every width | ✅ |
| **`/quests/extract`, `/settings`, `/global-registry`** (P5 surfaces) | all 10 | clean at every width | ✅ |

## 5. Summary — the four defects D1 found

| # | defect | routes | measured | spec's number |
|---|---|---|---|---|
| C | **no tablet sidebar tier** | all 20 | 260px at 768–1279 | 200px |
| D | **no tablet JSON panel tier** | 9 detail routes | 400px at 768–1279 | 300px |
| 1 | `md`-row header overflow | 7 object list routes | +70 … +157 at 768 | no horizontal overflow |
| 2 | quest detail action group | `/quests/:questName` | +149 at 375, +16 at 768 | no horizontal overflow |

Defects C and D are **spec-number violations that every route shares**; 1 and 2 are real
sideways-scrolling pages that the criterion's three named widths would have caught at 768 and 375
respectively — but only Failure 1's *magnitude* depends on the boundary, and 1279/1280 shows C/D
have no flip at all today.

## 6. Reproducing this

The numbers above are the committed record in
[`p5-06-d1-measurements.json`](./p5-06-d1-measurements.json) (every route × every width, plus the
pre-fix values). The **durable** form of them is the committed tier-1 spec:

```
PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers npx playwright test responsive --reporter=list
# → 41 passed (1.1m)
```

which asserts the same claims as assertions rather than as a report: §1 the 20 routes × 8 widths
with no horizontal overflow, §2 the three shell tiers (hidden/200px/260px) and the two boundaries,
§3 the JSON panel per tier, §4 tables→cards on the 9 list routes, §5 the tablet scroll container,
§6 the stat-card columns, §7 the ⌘K palette.

## 7. Honest limits

1. **No screenshot carries any claim here.** Every number is a DOM/geometry assertion read from a
   live headless Chromium; the raw JSON is the evidence.
2. **This is a viewport pass, not device emulation** (D23 tier 1): `isMobile`/DPR/touch are not
   emulated, so the swipe arm dispatches real `TouchEvent`s at the DOM rather than driving a
   pointer — it exercises the wiring, not a device's gesture recognizer.
3. **The mocked API is a miniature.** Every number above is a layout measurement, and layout at
   these widths is driven by counts and label widths, not by which quest is loaded — but the
   *magnitudes* in Failure 1 are label-driven (the longest create-button label gives +157), so a
   future config with a longer noun could push the 768px overflow wider or make another route fail
   where this one passes.
4. **`/npc-drop-tables` has no corpus directory in the fork**; its list is mocked here, and the
   measured overflow is identical in shape to the other six.
5. **Slider/zoom emulation was not used**; 375/639/640/767/768/1023/1024/1279/1280/1440 are exact
   viewport widths set via `page.setViewportSize`.