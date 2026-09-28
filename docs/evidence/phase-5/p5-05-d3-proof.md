# p5-05 D3 — the proof + the gate (plan task 5.5)

**Story:** p5-05, branch `phase-5-dashboard-polish`.
**Companions:** `p5-05-d1-audit.md` (the audit), `p5-05-d2-code.md` (the code),
`p5-05-axe-scan.txt` (the lead's AC#9 scan — zero critical/serious on all four surfaces),
`p5-05-executor-gate.txt` (every command and rc, verbatim).

---

## (a) AC#10's automated query, and how it fails

**The query: `tests/unit/a11y-icon-labels.test.ts`** — a source sweep, chosen over a DOM
sweep because it covers every component including ones no spec mounts, and it runs inside
`npm test` (2 ms).

It walks every `.tsx` under `client/src`, extracts every JSX `button` / `Button` / `Link` /
`NavLink` / `a` / `summary` element depth-aware, and decides for each whether it renders a
name — an attribute (`aria-label` / `aria-labelledby` / `title`), `alt`, static text, or a
text-rendering expression child. An element fails when it is **icon-only** (`size="icon"`, or
an icon element with no text channel) and has **none** of those. It is a sweep, not a list:
a new `<Button size="icon"><Trash2 /></Button>` turns it red on the next run.

**Measured on this tree: 113 interactive elements, 14 icon-only, 0 offenders.** The positive
partner asserts `≥100` and `≥10` so a sweep that stopped detecting anything cannot pass
vacuously (D78(b)).

**Falsified, and the falsification found a real defect in the checker.** The first version cut
each opening tag at `src.indexOf('>')` — which lands inside `onClick={() => …}`'s arrow, so
the attrs were truncated (losing `size="icon"`) and the rest of the tag leaked into the
"children", where it counted as static text. It reported **0 offenders on a deliberately
broken file**. Fixed with a brace/quote-aware tag-end scanner; the same insertion then
reported:

```
components/objects/ObjectTable.tsx:219 <Button> — no aria-label/aria-labelledby/title/alt;
no text or text-rendering expression child
```

**The rendered cross-check (the complement, not a duplicate):** `tests/ui/a11y-keyboard.spec.ts`
sweeps the live `document` on four surfaces (quest list, quest detail in edit mode, DropTable
detail, dashboard) for buttons, links, `summary` and inputs, computing each name the way a
browser does — `aria-label` → `aria-labelledby` → `<label for>` / wrapping `<label>` → `title`
→ visible text → `alt` → placeholder — skipping anything invisible or `aria-hidden`, with a
per-surface positive floor (20/20/15/10 named controls). Its first version omitted the native
label association and reported **16 false positives** on the quest detail page's goal-editor
scalars (which are labelled `<label htmlFor={id}>`); fixed, and now green on all four.

## (b) AC#4's evidence — the numbers

`tests/ui/a11y-reduced-motion.spec.ts`, 6 arms, green. Every arm asserts the **counterfactual**
too, so each reduced number is a measurement rather than a constant. Figures from one
instrumented run of the same spec:

| Surface | `no-preference` | `reduce` |
|---|---|---|
| sidebar nav link (`transition-colors`) | `transition-duration: 0.15s`; `transition-property: color, background-color, border-color, text-decoration-color, fill, stroke` | `transition-duration: 0s`; `transition-property: none` |
| palette panel (Radix `animate-in`) | 21 frames sampled: `animation-name: enter`, **4 distinct opacities** ramping `0.926 → 0.969 → 0.993 → 1` | 20 frames: `animation-name: none`, **one** opacity `1` — settled at the first frame |
| React Flow `fitView({duration: 200})` | 20 frames, **13 distinct** viewport transforms (interpolated) | 20 frames, **2 distinct** transforms (the pre-click value and the fitted one, no interpolation); every frame from the second on is identical |
| React Flow `dashdraw` (`.react-flow__edge.animated path`) | `animation-name: dashdraw`, `0.5s` | `animation-name: none` (the static `stroke-dasharray: 5px` stays) |

**Whole-DOM invariant arm.** Under `reduce`, every element of the rendered flowchart surface
is checked: `transition-duration` must be `0s` and `animation-name` must be `none`, the
deliberate `.animate-spin` exception aside. Measured: >50 elements scanned, 0 transitions,
0 animations. That is the "coverage by construction" claim — a DOM property, not a list of
rules someone remembered.

**A stated limit:** React Flow's edges in *this* app are not `animated`
(`grep -n animated client/src/lib/quest-goal-logic.ts` → 0; OR edges are dashed with
`strokeDasharray`), so `dashdraw` is gated for a future `animated: true` edge rather than
being an animation this corpus plays. The proof for it is against React Flow's own markup
(the exact selector from its stylesheet), stated as a rule test.

**Screenshots (committed, `docs/evidence/phase-5/`):** `p5-05-reduced-motion-sidebar.png`,
`…-panel-mid-noreduce.png`, `…-panel-mid-reduce.png`, `…-panel-after-reduce.png`,
`…-flowchart-before.png`, `…-flowchart-after.png`.

## (c) The keyboard-only tier-1 spec

`tests/ui/a11y-keyboard.spec.ts`, **8 arms, green** — the four AC#8 flows with no
`locator.click()` anywhere (details per flow in `p5-05-d2-code.md`), plus:

- a 20-stop **tab-order walk** on the quest list and on the DropTable detail page, asserting
  for **every** stop that its computed `box-shadow` is the spec ring
  (`rgb(9, 9, 11) 0px 0px 0px 2px, rgb(59, 130, 246) 0px 0px 0px 4px`) — 15+ stops recorded
  per surface, 0 without the ring;
- the flowchart's focused **node** (`box-shadow` = the spec ring) and **edge** (stroke
  `rgb(59, 130, 246)`, width `2px → 3px`), both focused through the tab order;
- exactly **one non-empty `h1`** on each of the four surfaces (the lead's axe
  `page-has-heading-one` follow-up).

**Measured trap recorded in the spec:** a *programmatic* `element.focus()` on a React Flow
node does not match `:focus-visible` (computed `box-shadow: none`), while the same focus after
any keystroke does — so every ring assertion in this file takes its focus from the keyboard.

## (d) The gate — every rc

Full transcript: `docs/evidence/phase-5/p5-05-executor-gate.txt` (the settled tree).

| Check | Result |
|---|---|
| `npm test` | **rc 0** — 67 files, **1460 tests passed** |
| `npm run lint` | **rc 0** (eslint + `prettier --check .`) |
| `npm run typecheck:tests` | **rc 0** |
| `npx tsc -p server/tsconfig.json --noEmit` | **rc 0** |
| `npx tsc -p client/tsconfig.json --noEmit` | **rc 0** |
| `npm run build` | **rc 0** |
| **`npm run test:ui` with no `--config`** | **rc 0 — 335 passed, 0 failed** (58 s) |

`npx prettier --write` was run over everything touched **before** lint.

**The phase-4 PNG side effect, restored and verified two ways.** The full `test:ui` run
rewrote **22 of the 22** committed `docs/evidence/phase-4/*.png` files (`object-mobile.spec.ts`
writes its screenshots there). Restored with `git checkout -- docs/evidence/phase-4/`, then:

1. `git status --porcelain docs/evidence/phase-4/` → **0 lines**;
2. `md5sum -c` against a snapshot taken before the run → **22/22 OK**;
3. each file's md5 compared against `git show HEAD:<path>` → **22/22 equal**.

**One pre-existing tier-1 failure, classified by a pre-change run (D85(c)).**
`tests/ui/quests-goals-editor.spec.ts:511` (`reordering › a pointer drag with the mouse moves
a goal too`) failed in the first full run and again twice in isolation **after** my changes;
it also failed at the identical assertion in a `git worktree` at **`cc94bef`** (the tree
before this story's code), run in isolation on the same host. The failure is not the drag
itself — the order poll passes — but `copyPanelDocument`'s poll for the JSON panel's own
`[Copy]` text (`:224`), i.e. the D60(i)/D76(g) pointer/panel class, systematic on this host
rather than the load flake those decisions recorded. It passed in the final full run
(335 passed). Attribution is by measurement, not by hope. The worktree was removed with
`git worktree remove --force` and nothing is left listening.

**Rig hygiene.** No rig of my own was started: the only stack any of this ran against is the
tier-1 harness's own (`playwright.config.ts`'s `webServer`, Vite **5181** + Express 3001, its
own throwaway `data/test-ui.db`, `reuseExistingServer: false`). The owner's `[::1]:5173` was
never touched. The database is read-only here (the tier-1 DB is recreated by the harness
itself), so nothing needed restoring.