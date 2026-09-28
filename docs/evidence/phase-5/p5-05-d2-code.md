# p5-05 D2 — the code (plan task 5.5)

**Story:** p5-05, branch `phase-5-dashboard-polish`.
**Preceded by:** `docs/evidence/phase-5/p5-05-d1-audit.md` (the audit; no code changed there).
**AC#9 (the axe scan) is the lead's** and its result is committed: `p5-05-axe-scan.txt` —
zero critical/serious on all four surfaces.

---

## (a) Keyboard reachability and behaviour

The four AC#8 flows are driven without a mouse in `tests/ui/a11y-keyboard.spec.ts`
(8 arms, green). What each one needed, measured:

| Flow | What was missing | What it needed |
|---|---|---|
| **extract → save** | Nothing structural — the dropzone is a real `<button>` wrapping the hidden file input. | A **reachability** walk, not a `.focus()`: `Tab` to the dropzone (asserted `toBeFocused()`), then `Enter` opens the real file chooser (`filechooser` event, asserted). One real trap found: `locator.focus()` does **not** wait for an element to become enabled the way `click()` does — the confirm dialog's `Save` is `disabled` until the overwrite check answers, and focusing it early silently no-ops so the `Enter` re-fired the page's `Save All` button instead. Fixed with an explicit `toBeEnabled()` first (the keyboard equivalent of `click()`'s actionability check). |
| **mark reviewed** | Nothing structural — the trigger and both menu actions are real buttons. | Scoping: the trigger **and** the Radix popover panel both carry `aria-label="Change status: …"`, and Radix portals the panel to the end of `<body>`, so the menu is the **last** match. Then `Enter` → `Tab` → `Enter` → dialog `Enter`. |
| **edit a DropTable item** | Nothing structural — the item id is a cmdk combobox behind a button, and the row's × is labelled. | `Enter` on `Edit`, `Enter` on the combobox, type, `ArrowDown`, `Enter` (the pick writes id + synced name), `Enter` on `Remove item 2`, `Enter` on `Save`. |
| **dashboard navigation** | Nothing structural — feed rows are `<Link>`s. | A real tab-order walk to the feed link (80 presses max, asserted found), then `Enter` → the object's route. |

**Tablist arrow keys (new).** `ObjectListPage`'s filter tabs and `QuestPreview`'s section
tabs both claim `role="tablist"` but implemented none of the keyboard model the role implies
(the audit's §7.4). `client/src/lib/tablist.ts` now owns the rule
(`nextTabIndex(key, index, count)`: ArrowLeft/Right wrap, Home/End jump, every other key
`null` so the caller only prevents the default it handled), and both call sites use it with
automatic activation — the same `setFilter`/`setTab` a click performs.

**Table rows stay non-focusable (deliberate, lead-ruled).** The row's `onClick` navigation
is duplicated by two keyboard-reachable links inside the row (the key link and the labelled
`Open <key>` link); giving the row a `tabIndex` would add a third stop per row across ~50
rows and make keyboard traversal worse. The other three mouse-only affordances the audit
found (mobile swipe-to-close, mobile drag-drop, flowchart edge-drawing) each have a working
keyboard equivalent, recorded in the audit's §1.

**Focus ring: the spec's exact classes, everywhere, twice over.**

1. **By construction** — `client/src/index.css` now carries a base rule
   `:focus-visible { @apply outline-none ring-2 ring-blue-500 ring-offset-2 ring-offset-zinc-950; }`,
   so a component cannot ship without the spec's ring.
2. **Locally spelled out** — all 40 sites that carried only `ring-2 blue-500` now carry the
   offset pair too (`focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950`); the 4
   sites using `:focus` instead of `:focus-visible` were converted; `ui/button.tsx`'s
   `ring-offset-background` was replaced by the literal token. They do not fight: identical
   declarations in the same property, utility layer last. Measured in the browser: a focused
   stop computes `box-shadow: rgb(9, 9, 11) 0px 0px 0px 2px, rgb(59, 130, 246) 0px 0px 0px 4px`
   — the offset layer and the ring layer, one ring, not two.
3. **`outline: none` with no replacement — fixed**: `ui/command.tsx`'s palette input (the
   ⌘K palette's only focus stop had no visible focus at all) and `ui/popover.tsx`'s panel.
4. **React Flow had stripped it entirely** — `@xyflow/react/dist/style.css:452` sets
   `.react-flow__node.selectable:focus-visible { outline: none }` and substitutes
   `--xy-node-boxshadow-selected` (default `#1a192b`, invisible on `zinc-950`). Restored:
   - **node** → the spec's exact ring (rule in `index.css`, specificity `(0,4,0)` beats
     xyflow's `(0,3,0)`).
   - **edge** → an SVG `<path>` cannot render a box-shadow, so the indicator is
     `stroke: #3b82f6 !important; stroke-width: 3 !important`. Three things make it
     legible without colour: the path goes **2px → 3px** (a shape change), it is drawn in
     `blue-500` at **5.41:1** against `zinc-950` (over the 3:1 non-text floor, where the
     app's own edge colours are `#3f3f46` at 2.3:1 and `#a1a1aa` at 6.9:1), and it is the
     only edge on screen that changes width. `!important` is load-bearing and measured:
     `toFlowEdges` puts the edge's own colour on the path as an **inline** `style`, and an
     inline declaration beats any normal stylesheet rule (the focused edge stayed
     `emerald-500` until the `!important` landed).
   - **Measured build trap:** inside `@layer base`, that `!important` rule was silently
     **dropped by the Tailwind build** — the built CSS contained the node rule and not the
     edge one, and the browser failed `path.matches('…:focus-visible …')` = `true` with the
     inline colour still winning. Moved out of the layer (unlayered `!important` is the
     highest-priority author declaration) and it emits.
   - `:focus-visible`, not `:focus`, is deliberate: a **programmatic** `element.focus()` on a
     `.react-flow__node` does not match `:focus-visible` (measured: `box-shadow: none`) while
     the same focus after any keystroke does — so the tier-1 arm takes the focus through the
     tab order, which is what a keyboard user does.

## (b) ARIA labels for icon-only controls

The audit found **no** unnamed icon-only control: all 8 `size="icon"` controls and all 15
further icon-only-in-render controls already carried names, reusing the existing vocabulary
(`Zoom in`, `Fit to view`, `Auto-layout`, `Change status: <quest>`, `Edit: <key>`,
`JSON panel`, `Close`, `Reorder goal <name>`, `Remove item <n>`, `Delete <address>`,
`Add Condition to <address>`, `Move spell <n> up`…). So this AC's work is the **guard**, not a
new label — see D3(a). The only naming change here is incidental: `ui/dialog.tsx`'s close ×
keeps both its `aria-label="Close"` and its `<span className="sr-only">Close</span>`.

## (c) `prefers-reduced-motion` — every transition and React Flow, by construction

The rule this story replaced covered `.animate-spin`, `.animate-in` and `.animate-out`
**only**; the audit measured what that missed. `client/src/index.css` now says:

| Surface | Rule that gates it |
|---|---|
| every CSS transition, app-wide (`transition-colors` ×32 sites, `transition-opacity`, `transition-transform`, bare `transition`) | `* , *::before, *::after { transition: none !important }` |
| every keyframe animation (Radix/sonner `animate-in`/`animate-out`, `animate-pulse`, and React Flow's `dashdraw`) | `* , *::before, *::after { animation: none !important }` |
| smooth scrolling | `scroll-behavior: auto !important` |
| **React Flow's `fitView({ duration: 200 })`** — a d3 transition, unreachable by any stylesheet rule | gated **in the component**: `client/src/lib/reduced-motion.ts`'s `motionDuration(prefersReducedMotion(), FIT_VIEW_DURATION_MS)` → duration `0` |
| **dnd-kit's inline transition** (`useSortable`'s `style={{ transition }}`) | gated in the component **and** by the `!important` above (the only way to beat an inline declaration) |
| loaders (`animate-spin`, 9 sites) | **deliberately kept**, slowed 1s → 2.4s, with its own `@keyframes p5-05-spinner` so a Tailwind rename cannot break it. The spinner is the one animation left, because it is the one thing that must still say "working" — every spinner in this app also has adjacent visible text (`Syncing…`, `Saving…`, `Loading…`) and a `role="status"` live region, so the state is never animation-only. |

`transitionend`/`animationend` are fired by no code in this client
(`grep -rn "transitionend\|animationend" client/src` → 0), so collapsing them to none breaks
no listener; and Radix's `Presence` unmounts immediately when the computed `animation-name`
is `none`, which is what makes dialogs close instantly rather than animating out.

## (d) Contrast and status conveyance (what the axe scan confirms)

**Contrast — a real, shipped AA violation, fixed.** `text-zinc-500` measured **4.12:1 on
`zinc-950`, 3.67:1 on `zinc-900`, 3.08:1 on `zinc-800`** and was used **133 times**;
`text-zinc-600` measured 2.57/2.29/1.93 in 12 more. Both are under the 4.5:1 floor for
normal text, and the app has no light mode — every muted label sits on one of those three
surfaces. Both were replaced by `text-zinc-400` (7.76/6.91/5.81). The palette is now:
270 × `zinc-400`, and nothing below the floor. The **lead's axe run came back with zero
critical/serious violations on all four surfaces**, which is the confirmation.

**Status → colour + text (lead-ruled, D86).** The desktop tables' Status cell was a 10px
colour dot with `sr-only` text (colour alone for a sighted user), while the **same row**
rendered a text `StatusBadge` on mobile. The same page disagreed with itself. Now both
tables render `StatusBadge` (colour **and** the status word) and the column widened
40px → 104px (`lib/quests.ts`'s `QUEST_COLUMNS` and `ObjectTable.tsx`'s
`STATUS_WIDTH_PX`). `StatusDot` survives for the search palette, whose rows carry the status
word in their own accessible name. Two tier-1 arms and one unit arm that read the cell's text
were updated to assert both channels (visible label **and** `aria-label`) — stronger than
before, not weaker. The spec's `L249-260` 40px "Color dot only" pin is the deliberate
deviation: WCAG 1.4.1 is a real requirement, **axe has no rule for it**, and the mobile view
had already superseded the pin.

**Page-level `h1` (from the lead's axe run: `page-has-heading-one`, moderate, on 3 of 4).**
One element promoted: `client/src/components/layout/Header.tsx`'s page title (`<h2>` → `<h1>`)
— the sticky shell header is on every route, so this fixes every route at once and it *is*
the level above the sections' `h2`s. `QuestDetailPage`'s two `<h1>`s (the quest name and the
not-found message) were demoted to `<h2>` so that route keeps exactly one too; five tier-1
arms that asserted the quest name at `level: 1` were moved to `level: 2`, and
`tests/ui/a11y-keyboard.spec.ts` now asserts exactly one non-empty `h1` on each of the four
surfaces.

## Files touched

**Product code:** `client/src/index.css`, `client/src/components/layout/Header.tsx`,
`client/src/components/ui/{button,badge,dialog,command,popover}.tsx`,
`client/src/components/UserNameDialog.tsx`, `client/src/lib/reduced-motion.ts` (new),
`client/src/lib/tablist.ts` (new), `client/src/pages/QuestDetailPage.tsx`,
`client/src/lib/quests.ts`, `client/src/components/objects/ObjectTable.tsx`,
`client/src/components/objects/ObjectListPage.tsx`,
`client/src/components/quest/QuestBrowseTable.tsx`,
`client/src/components/quest/QuestPreview.tsx`,
`client/src/components/quest/QuestGoalsEditor.tsx`,
`client/src/components/quest/QuestGoalLogicEditor.tsx`, plus the 40 focus-ring /
133 contrast class normalisations across 49 further files.

**Tests:** `tests/unit/a11y-icon-labels.test.ts`, `tests/unit/a11y-contrast.test.ts`,
`tests/unit/a11y-units.test.ts` (all new), `tests/ui/a11y-keyboard.spec.ts` (new),
`tests/ui/a11y-reduced-motion.spec.ts` (new), `tests/ui/drop-table-mocks.ts` (new — the
DropTable mocks **extracted** from `drop-table-editor.spec.ts` so both specs drive one
contract instead of forking a copy), `tests/ui/drop-table-editor.spec.ts` (now imports them),
`tests/ui/{quests-status,status-integration,quests-detail,quests-browse,shell}.spec.ts` and
`tests/unit/quests-browse.test.ts` (assertion updates forced by the two deliberate changes
above).

**Not touched:** `docs/spec-*.md`, `AGENTS.md`, `docs/plan-*.md` (the lead records the
decisions), and the owner's `[::1]:5173`.

## Type checks

```
npx tsc -p client/tsconfig.json --noEmit   → rc 0
npx tsc -p server/tsconfig.json --noEmit   → rc 0
```
(Full gate transcript: `docs/evidence/phase-5/p5-05-executor-gate.txt`.)