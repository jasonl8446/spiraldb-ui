# p5-05 D1 — accessibility audit (plan task 5.5, ACs #8–#11)

**Story:** p5-05, branch `phase-5-dashboard-polish`, HEAD `f1bbf3b`.
**Scope of this file:** the audit only. No code was changed to produce it.
**AC2 (axe-core via Playwright MCP) is the lead's**, not this story's — this file lists
the four surfaces so the scan can be targeted.

Every claim below is a measurement with the command or file:line that produced it.

---

## 1. Interactive elements reachable only by mouse

| Element | Where | Why it is mouse-only | Blocker? |
|---|---|---|---|
| Table **row** click → detail route | `client/src/components/objects/ObjectTable.tsx:249-254` (`<TableRow onClick>`), `client/src/components/quest/QuestBrowseTable.tsx:246-253` | `<tr>` has no `tabIndex` and no `onKeyDown`; only the click navigates. | **No** — the same row already contains two keyboard-reachable controls to the identical destination: the key `<Link>` (`ObjectTable.tsx:138-146`) and the labelled `Open <key>` link (`ObjectTable.tsx:168-176`). Making the row focusable would add a *third* stop per row (50 rows/page), so the row stays a redundant pointer affordance. Recorded, not "fixed". |
| Flowchart **edge creation** (drag from a goal's `AND`/`OR` handle) | `client/src/components/quest/QuestGoalLogicEditor.tsx:332-345` (`onConnect`, handles from `lib/quest-goal-logic.ts`) | React Flow has no keyboard connect; the connection is a pointer drag. | **No** — the `EntryInspector` beside the canvas (the `m_goalsAND` / `m_goalsOR` name lists, `EntryInspector` + `ObjectIdMultiSelect`) performs the same edit by keyboard. The canvas itself is keyboard-reachable (`nodesFocusable`/`edgesFocusable`, `Shift+F10`/`ContextMenu` opens the node menu, `Delete`/`Backspace` disconnects) — `QuestGoalLogicEditor.tsx:174-190, 298-320`. |
| Mobile sidebar **swipe-to-close** | `client/src/components/layout/Sidebar.tsx:190-204` | Touch gesture only. | **No** — Escape, outer-click and the nav links all close it (Radix dialog). |
| **Mobile file drop** (drag a capture onto the dropzone) | `client/src/components/quest/ExtractDropzone.tsx:42-57` | HTML drag-and-drop. | **No** — the whole zone is a real `<button>` (`:58-66`) that opens the hidden `<input type="file">` on Enter/Space. |

No other mouse-only handler exists: `grep -rn "onPointerDown\|onMouseDown\|onDoubleClick\|onContextMenu\|draggable=" client/src --include=*.tsx`
returns **0** hits outside the table rows; `<a ` (bare, no `href`) returns **0** hits.

## 2. Icon-only controls and their accessible names

Scanner: a source sweep over every JSX `<button>`/`<Button>` element
(`/tmp/p505/scan-icon-buttons.mjs`, 79 `.tsx` files): **100 button-like elements**, of which
**23 render no text child** and **8 carry `size="icon"`**.

| Icon-only control | Accessible name (source) |
|---|---|
| Hamburger (`Header.tsx:52`) | `aria-label="Open navigation"` |
| Flowchart zoom in / out / fit / auto-layout (`QuestGoalLogicEditor.tsx:351,361,371,381`) | `aria-label` + `title` (`Zoom in`, `Zoom out`, `Fit to view`, `Auto-layout`) |
| Status menu trigger (`StatusMenu.tsx:64`) | `aria-label={`Status menu: ${questName}`}` + `title` |
| Browse-table row "Edit" (`QuestBrowseTable.tsx:300`) | `aria-label={`Edit: ${quest_name}`}` + `title` |
| Quest detail JSON toggle (`QuestDetailPage.tsx:535`) | `aria-label={JSON_PANEL_LABEL} title={JSON_PANEL_LABEL}` |
| Dialog close × (`ui/dialog.tsx:52-58`) | `aria-label="Close"` **and** `<span className="sr-only">Close</span>` |
| Detail-layout JSON toggle (`ObjectDetailLayout.tsx:163-174`) | `aria-label={JSON_PANEL_LABEL}` |
| Goal drag handle (`QuestGoalsEditor.tsx:268-277`) | `aria-label={`Reorder goal ${name}`}` (+ dnd-kit `attributes`) |

Also named but not `size="icon"`: badge remove × (`ObjectIdMultiSelect.tsx:282`),
goal delete (`QuestGoalsEditor.tsx:292`), tree delete (`RequirementTreeEditor.tsx:563`),
registry row delete (`GlobalRegistryForm.tsx:275`), DropTable item remove
(`DropTableForm.tsx:551`), spell move up/down/remove (`CreatureSpellbookForm.tsx:155,165,174`),
teleport/treasure/spell remove (`ZoneTransferForm.tsx:452`, `TreasureCardInventoryForm.tsx:305`,
`NpcSpellInventoryForm.tsx:198`), favourite-star rows (`FriendlyNameDropdown.tsx:142`),
pagination/previous/next (text).

**Finding: no icon-only control is missing a name today.** The risk is *regression*, not a
current gap — which is exactly what AC#10's "automated query" must guard (D3(a)).

Two primitive-level naming facts worth carrying (D83(c)):

- `ui/command.tsx:42` — the palette's `CommandInput` is `outline-none` with **no replacement**:
  it has no focus ring at all. (Name is fine: the palette sets cmdk's own `label`.)
- `ui/dialog.tsx:54` and `ui/badge.tsx:15` and `UserNameDialog.tsx:36,119` use `focus:` where
  every other site uses `focus-visible:` — the ring shows for *any* focus, including Radix's
  programmatic autofocus on dialog open.

## 3. Focus-ring treatment

Spec (`docs/spec-ui-design.md:542`): `ring-2 ring-blue-500 ring-offset-2 ring-offset-zinc-950`.

| Variant | Count | Verdict vs the spec's exact classes |
|---|---|---|
| `focus-visible:ring-2 focus-visible:ring-blue-500` (**no** `ring-offset-2 ring-offset-zinc-950`) | **40 sites** | Not the spec's exact classes (the offset pair is the missing half). Visible, but the ring is drawn flush against the element. |
| full spec classes (`… ring-offset-2 … ring-offset-zinc-950`) | 7 sites | Exact. |
| `focus:ring-2 …` (not `focus-visible`) | 4 sites | Exact colours, wrong trigger. |
| `outline-none` with no ring | 2 sites: `ui/command.tsx:42` (palette input), `ui/popover.tsx:28` (popover panel) | **`outline: none` with no replacement** — the failure mode named in the brief. |
| React Flow nodes/edges | `@xyflow/react/dist/style.css:452,176,136` | `:focus-visible { outline: none }`, replaced by `--xy-node-boxshadow-selected` whose default (`#1a192b`) is near-invisible on `zinc-950`; edges only swap `stroke` (colour alone). **The flowchart's focusable nodes/edges therefore have no spec ring.** |

Commands: `grep -rn "focus-visible:ring-2" client/src | wc -l` → 47;
`… | grep -c "focus-visible:ring-offset-2"` → 7.

**Every focusable stop shows *a* ring today except the two `outline-none` sites and the
flowchart's nodes/edges** — so the spec's *exact* treatment is the gap, plus those three.

## 4. Status conveyance per surface (colour vs colour + text/icon)

| Surface | Mark | Colour-only? |
|---|---|---|
| `StatusBadge` (detail headers, mobile cards, search palette, history) | dot + the status word | **No** — colour + text (`StatusBadge.tsx:40-54`), `aria-label="Status: X"`. |
| Dashboard activity feed dot (`ActivityFeed.tsx:159-165`) | coloured dot | **No** — the adjacent action text ("marked reviewed") and the heading carry it; dot is `aria-hidden`. |
| Dashboard per-type progress bar (`TypeProgressSection.tsx:55-67`) | amber/blue/emerald segments | **No** — bar is `aria-hidden` and the fraction + percentage text beside it carries the same information. |
| Quest/objects **desktop table Status cell** (`ObjectTable.tsx:45-53`, `QuestBrowseTable.tsx:77-85`) | 10px dot, `title`, `sr-only` | **Yes for sighted users, with a caveat.** The dot is colour alone on screen; the `title` tooltip is text *on hover* and the `sr-only` text only reaches assistive tech. |
| Native `<details>` disclosures (accordions, raw-fields) | `<summary>` text + chevron | **No**. |

**Demonstrable gap with a spec contradiction behind it.** `docs/spec-ui-design.md:249-260`
pins that column at **40px, "Color dot only"**, while `:545` requires "Status conveyed by both
color AND text/icon (not color alone)" — and the same page's **mobile card list renders
`StatusBadge` (colour + text) for the identical row** (`ObjectListPage.tsx:277`);
`QuestCardList.tsx:44`). So one row's status is text on a phone and colour-only on a desktop.

**Resolution taken: report, do not silently re-design a pinned column.** The one-line fix
(`StatusDot` → `StatusBadge` + `widthPx: 40 → 104` in `lib/quests.ts:60` and
`ObjectTable.tsx:80`) is offered to the lead as an owner-decision item, because it changes a
width the spec pins. axe-core has no rule for this (WCAG 1.4.1 is not machine-checkable), so
the axe scan will **not** flag it either way.

## 5. What the existing reduced-motion CSS actually covers

`client/src/index.css:64-73` (verbatim, before this story):

```css
@media (prefers-reduced-motion: reduce) {
  .animate-spin { animation-duration: 2.4s; }
  .animate-in, .animate-out { animation-duration: 0.001s; }
}
```

| Animated thing | Covered? |
|---|---|
| Spinners (9 `animate-spin` sites) | **Yes**, slowed 1s → 2.4s (deliberate: a spinner must still say "working"; documented in the rule's own comment). |
| Radix/sonner enter/exit (`animate-in`/`animate-out`, 9 sites) | **Yes**, collapsed to 0.001s. |
| **Every `transition-*` utility** (65 sites: `transition` 43, `transition-colors` 21, `transition-transform` 1, `transition-opacity` 1) | **No.** Hover/focus/sidebar-group colour transitions still play in full. The rule's comment says it is deliberately scoped to "the two utilities the app animates so it can never mask an unexpected animation" — i.e. transitions were left out on purpose. |
| **React Flow `dashdraw`** on animated edges/connection line (`@xyflow/react/dist/style.css:164,204,326`) | **No.** `animation: dashdraw 0.5s linear infinite` keeps running; nothing in `index.css` mentions React Flow. |
| **React Flow `fitView({ duration: 200 })`** (`QuestGoalLogicEditor.tsx:377`) | **No.** It is a JS/d3 transition, not CSS — no CSS rule can gate it. |
| **dnd-kit drag transition** (`QuestGoalsEditor.tsx:255-258`, inline `style={{ transition }}`) | **No.** An inline style from `useSortable`; not reachable by any stylesheet rule short of `!important`. |
| `animate-pulse` (1 site, `ui/skeleton.tsx`) | **No.** |

So the AC#11 claim would have been false for four of the seven rows above. That is the
code-side work of D2(c).

## 6. The four surfaces AC2 (axe-core) will scan

| # | Surface | Route / how to reach it | Notes for the scan |
|---|---|---|---|
| 1 | **Dashboard** | `/` | stats cards, per-type progress, activity feed (or its empty state). |
| 2 | **Quest list** | `/quests` | filter tabs + search + TanStack table (desktop) — the row-click rows and the colour-only Status cell are here. |
| 3 | **Quest detail (edit mode)** | `/quests/<quest_name>` then click **Edit** (edit mode is local state, *not* a URL — `QuestDetailPage.tsx:235,504-507`); `[data-edit-mode="true"]` is the hook | the accordions (`<details>`/`<summary>`), the tree editor, the flowchart toolbar + canvas, the tab strip, the JSON panel. |
| 4 | **DropTable detail** | `/drop-tables/<Name>` (edit mode by default on load, D66) | item rows' `FriendlyNameDropdown` comboboxes, remove ×, Save. |

The tier-1 suite's own fixtures are the cheapest source of data for the scan
(`tests/ui/quests-mocks.ts`, and the object mocks in `tests/ui/object-list.spec.ts`).
For a *live* scan with real data, `npm run dev` (Express :3001 + Vite :5173) is the owner's
stack — **do not use :5173** (D78(b)); boot an isolated copy on a port we own.

## 7. Audit → D2 work list

1. Focus rings: normalise all 40 sites to the exact spec classes; add a global
   `:focus-visible` base rule so a *new* component cannot ship without one; restore the ring
   on React Flow nodes (and give edges a non-colour-only indicator); fix the two
   `outline-none`-with-no-replacement sites (`ui/command.tsx`, `ui/popover.tsx`); move the 4
   `focus:` sites to `focus-visible:`.
2. Reduced motion: cover transitions, React Flow's `dashdraw`, `fitView`'s JS animation and
   dnd-kit's inline transition — one named rule per surface.
3. Contrast: `text-zinc-500` = **4.12:1 on `zinc-950`, 3.67:1 on `zinc-900`, 3.08:1 on
   `zinc-800`** and `text-zinc-600` = 2.57/2.29/1.93 — both **below the 4.5:1 AA floor for
   normal text**, at 133 and 12 occurrences. `text-zinc-400` is 7.76/6.91/5.81. (Full table:
   `/tmp/p505/contrast.mjs`; numbers reproduced in D2.) This is the finding axe-core *will*
   report as `color-contrast` (serious).
4. Tablists (`ObjectListPage.tsx:173-199`, `QuestPreview.tsx:80-106`) are Tab-reachable but
   have no Arrow/Home/End roving focus — the APG behaviour for `role="tablist"`.
---

## Post-audit corrections (annotated rather than rewritten — D83(b)'s rule)

The audit above is the *finding*; three of its statements were corrected by later measurement
in this same story. Annotated here so no reader acts on the stale version.

1. **§2's scanner was unsound, and its counts were wrong.** The ad-hoc scanner used for §2 cut
   each opening tag at `src.indexOf('>')`, which lands inside `onClick={() => …}`'s arrow: the
   attrs were truncated (losing `size="icon"`) and the leaked tag text counted as an accessible
   name. Corrected numbers from the committed, brace-aware sweep
   (`tests/unit/a11y-icon-labels.test.ts`, measured): **113** interactive elements, **14**
   icon-only, **0** unnamed. **The conclusion does not change** — no icon-only control is
   missing a name today — but it is now backed by a checker that was *falsified* (a deliberate
   unnamed `<Button size="icon">` was caught, `ObjectTable.tsx:219`) instead of one that passed
   a broken file.
2. **§4's resolution was overruled by the lead (recorded as D86).** The desktop table Status
   cell *does* get text: `StatusBadge` (colour **and** the status word) with the column widened
   40 → 104px in `lib/quests.ts` and `ObjectTable.tsx`. Reasoning on the record: WCAG 1.4.1 is
   a real requirement, axe has **no** rule for it, and the same row already rendered a text
   badge in the mobile card list. The spec's L249-260 40px "Color dot only" pin is the
   deliberate deviation.
3. **§7 item 4 is done, not deferred.** The two `role="tablist"`s now implement the APG
   keyboard model through `client/src/lib/tablist.ts` (Arrow/Home/End, automatic activation),
   wired in `ObjectListPage` and `QuestPreview`.
4. **§7 items 1–3 are done and proven** in `p5-05-d2-code.md` / `p5-05-d3-proof.md`; §5's
   coverage table is what the new reduced-motion block in `index.css` names rule-by-rule.
