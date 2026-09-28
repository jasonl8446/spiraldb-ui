# p5-07 D1 — the a11y spec's design, measured before it is written

**Story:** p5-07 (plan task 5.7 + **P5 AC#13**), branch `phase-5-dashboard-polish`, HEAD `a22c86f`.
**Deliverables this file designs:** D2 `tests/ui/a11y.spec.ts`; D3 validates the existing
`tests/ui/responsive.spec.ts`.

Every claim below carries the command or `file:line` that produced it. Nothing here is an
assertion about the spec's behaviour — the spec does not exist yet (D2 writes it).

---

## 1. Prerequisite, re-measured rather than assumed

```
$ node -e "console.log(require('./node_modules/@axe-core/playwright/package.json').version,
                        require('./node_modules/axe-core/package.json').version)"
4.13.0 4.13.0
$ git diff --stat package.json package-lock.json
 package.json      | 1 +        (+ "@axe-core/playwright": "4.13.0" under devDependencies)
 package-lock.json | 14 ++++++++++++++
```

D87 installed `axe-core@4.13.0` exactly; it also pinned `@axe-core/playwright@4.13.0`, whose
engine peer is that same version. **Nothing is installed, re-pinned or upgraded by this story** —
the AC's engine is already in the tree at the exact version D87's argument requires.

## 2. The four pages, their own states, their mocks and their settled markers

The AC's four names, read from `docs/plan-phase-5-dashboard-polish.md` AC#9 and the plan's §5.5.
"A scan of the whole app repeated four times" is the named failure mode, so each page is a
separate arm with its own state, its own fixture and its own ready marker.

| # | Page | Route | What it is in that state | Endpoints the page actually reads | Content marker (data really arrived) | Settled marker |
|---|---|---|---|---|---|---|
| 1 | **Dashboard** | `/` | 4 stat cards + 8 per-type bars + the activity feed (D37/p5-01) | `/api/dashboard`, `/api/activity` | `[data-stat="total"]`, `[data-activity-id="11"]` | fingerprint poll (§3) |
| 2 | **Quest list** | `/quests` | 4 filter tabs with count badges + the TanStack table + pagination | `/api/quests` only (`QuestsPage.tsx:87-89`; no status call) | `getByText(/^Showing /)`, rows present | fingerprint poll |
| 3 | **Quest detail, edit mode** | `/quests/DS-ACAD1-C01-001` | `EDIT_MODE_ON_LOAD = true` (`client/src/lib/quest-edit.ts:141`), so the six editors render; hook `[data-edit-mode="true"]` (`QuestDetailPage.tsx:331`) | `/api/quests`, `/api/quests/:name`, `/api/status/quests`, `/api/names/strings/:key`, `/api/names/:type` | `[data-edit-mode="true"]` **and** the Info editor's field | fingerprint poll |
| 4 | **DropTable detail** | `/drop-tables/DS-ACAD1-C01-001` | **as loaded** and **edit mode** — see §5 | `/api/drop-tables`, `/api/drop-tables/:name`, `/api/status/drop_tables`, `/api/names/items`, `/api/names/quests` | `getByRole('link', { name: 'Back to Drop Tables' })`, item rows | fingerprint poll |

**On the quest detail page's mode — do not click anything.** The page is already in edit mode on
load (D66(b)), and clicking `Edit` would *turn it off*, i.e. scan the read-only bodies instead.
The arm asserts `[data-edit-mode="true"]` rather than inferring the mode from the editors'
presence; that is the hook the lead's own scan used and the one `p5-05-d1-audit.md` §6 records.

**Hermeticity (D40/D81).** One dispatcher answers every `/api/**` request the four pages make,
from fixtures in the spec; a server-rendered empty state is never what gets scanned, so the run
cannot read the developer's corpus and the CI condition cannot change what is on screen. The
dispatcher records every path it did **not** know, and a guard arm asserts that list is empty
(the p5-06 pattern, `responsive.spec.ts:525-538`) — so "the fixtures are complete" is a checked
claim, not a hope.

**One dispatcher, not a layer of two shared mocks.** `mockQuestsApi` (`tests/ui/quests-mocks.ts`)
and `mockDropTableApi` (`tests/ui/drop-table-mocks.ts`) each register `**/api/settings` and the
sync routes, so composing them makes *which* registration wins an accident of call order rather
than a stated contract; and neither covers `/api/dashboard` or `/api/activity`. The four pages
are scanned in one file, so the fixtures live in one place with one guard arm. (The shared mocks
are still reused where they are a clean fit — the a11y-keyboard spec keeps them.)

## 3. "Settled" is a measurement, not a `waitForTimeout`

p5-06 measured the vendored ⌘K dialog **mid-animation** at `x=697` and settled at `x=384`
(`responsive.spec.ts`'s `stableBox` docblock). An axe scan fired then reads a half-laid-out
tree — a false result in *both* directions, which is the failure mode this story is warned about.

The settle used here is a **fingerprint that must read identically twice in a row**, polled
through `expect.poll`:

```
document.readyState
document.documentElement.scrollWidth / scrollHeight
document.querySelectorAll('*').length                      // lazy mounts (React Flow) still landing
document.getAnimations().filter(a => a.playState === 'running') → sorted [animationName|propertyName]
the page anchor's rounded bounding box
```

Why each part is load-bearing:

- **two consecutive equal reads**, not one: a finite `animate-in` (`ui/dialog.tsx`,
  `duration-200`) is present in read *n* and absent in read *n+1*, so the poll keeps going until
  the animation is over *and* the layout has stopped moving.
- **running animations are counted, not required to be zero**: the Goal Logic canvas runs React
  Flow's `dashdraw 0.5s linear infinite` (`@xyflow/react/dist/style.css:164`), which never ends.
  A "no running animations" gate would hang on that tab; a *stable count* is the right
  invariant.
- **element count and scroll extents** catch a lazily-mounted panel (the flowchart is
  `Suspense`-gated, `QuestDetailPage.tsx:317-326`) whose DOM is still growing.

The fingerprint poll runs **after** a content assertion, so it can never be satisfied by a page
that rendered nothing: `[data-stat="total"]` for the dashboard, `/^Showing /` plus a row count for
the quest list, `[data-edit-mode="true"]` for the quest detail, the `Back to Drop Tables` link
plus the item rows for the DropTable page.

## 4. Known axe findings, and the console noise that is *not* one

The lead's tier-2 scan (`docs/evidence/phase-5/p5-05-axe-scan.txt`, on a copy of the live
database, after p5-05's fixes) read:

```
Dashboard (/)                              critical/serious: 0, other: 0, consoleErrors: 0
Quest list (/quests)                       critical/serious: 0, other: 0, consoleErrors: 0
Quest detail (edit mode) (/quests/DS-ACAD-C01-001)  critical/serious: 0, other: 0, consoleErrors: 0
DropTable detail (/drop-tables/DS-ACAD-C01-001)     critical/serious: 0, other: 0, consoleErrors: 0
```

So the expected shape is **zero violations at every impact**, and the spec asserts the AC's
clause (`critical/serious === 0`) while **recording the full severity histogram** so a moderate or
minor finding can never be silently filtered away by the assertion's wording. If the automated
run differs from the lead's scan, the difference is the story's output, not something to hide.

Two **designed** console errors are expected and are **not** violations:

1. **The string-table title lookup's 404.** `m_questTitle` is a string-table key
   (`client/src/lib/quest-info.ts:66`); a key the fixture's `names` map does not carry answers
   `404` and the Info editor falls back to the raw key — the raw-key path is a *feature*
   (`QuestTitleSource = 'rawKey'`), and the 404 is that path's honest wire trace. The fixture will
   deliberately exercise it (it is the state the developer's own DB shows for unmapped keys).
2. **One measured item-id miss on the DropTable page.** `drop-table-mocks.ts` records 8 measured
   misses in the corpus and models `ItemId: '1000'` as one of them; the single-id label lookup
   answers 404 and the dropdown keeps the numeric form (D70's sentinel rule). Again designed.

Chromium logs both as failed XHRs. A console-error count is therefore **recorded for information
only** and is never an assertion — the AC is about axe violations, and D81's lesson is that the
spec must not depend on ambient data, not that the console is silent.

## 5. Two design decisions taken from measurement, not from the brief's wording

**(a) The DropTable detail page does *not* load in edit mode.** `p5-05-d1-audit.md` §6 says
"(edit mode by default on load, D66)", but D66(b)'s `EDIT_MODE_ON_LOAD = true` is the **quest**
page's contract (`client/src/pages/QuestDetailPage.tsx:236`); every Phase-4 family goes through
`ObjectDetailPage`, which starts at `useState<'view' | 'edit'>('view')`
(`client/src/pages/ObjectDetailPage.tsx:315`) and reaches `data-edit-mode="edit"` only after
`Edit` (`DropTableForm.tsx:130`). The AC#9 name is just "DropTable detail", so **both the as-loaded
state and the post-`Edit` state are scanned**, each labelled for what it is. That covers either
reading and reports the discrepancy instead of silently picking one.

**(b) The quest detail's six tabs are the page's own states.** `QuestPreview` starts on `Info`
(`QuestPreview.tsx:69`) and the tab strip holds `Info / Goals / Goal Logic / Requirements /
Results / Dialog` — each a different set of custom widgets (accordions, dnd-kit list, React Flow
canvas, requirement tree, result repeaters, dialog accordions). The primary arm is the **as-loaded
`Info` state** (what AC#9 names); the other five tabs are scanned as **sub-surfaces of the same
page arm** and reported per tab, so a violation names the tab it lives on rather than reading as
"the quest page is broken".

## 6. Viewports

The scan runs at the runner's default project viewport (Desktop Chrome, 1280×720), which is the
configuration the AC's engine runs in by default. p5-05's own audit records one real
desktop/mobile disagreement — the status **cell** is a colour dot on desktop while the mobile card
list renders `StatusBadge` (colour + text) for the identical row (`p5-05-d1-audit.md` §4) — and
axe-core has **no rule** for WCAG 1.4.1, so neither viewport's scan can see it either way. A mobile
pass over the four pages is added as a second, labelled set of arms at **375px** (the width p5-06
and p5-07's sibling spec already use, and the width at which the hamburger, the card lists and the
JSON overlay replace their desktop counterparts) purely as extra coverage. If the measurement makes
that pass redundant or slow, D3 says so with numbers.

## 7. What D2 will prove, and how

- **It bites (D67(d)).** One deliberate break, chosen so the failing arm is *page-specific*: the
  `label htmlFor={id}` association in `client/src/components/objects/DropTableForm.tsx:222` is
  pointed at a non-existent id, which axe reports as the **critical** `label` rule **only on the
  DropTable page**. Three arms passing and the DropTable arm failing is the evidence that the four
  arms scan four different pages rather than the same page four times — the brief's named failure
  mode, falsified rather than asserted. Restore is byte-identical, verified by md5.
- **The AC's clause verbatim**: `critical === 0 && serious === 0`, with the histogram recorded.
- **Hermeticity as a checked claim**: the unmocked-path guard arm.
- **`npx tsc -p tests/tsconfig.json --noEmit`** on the new file.

## 8. The responsive spec: validated, not rewritten

`tests/ui/responsive.spec.ts` (p5-06) already carries **41 arms** over **20 routes × 8 widths**
(375, 640, 767, 768, 1024, 1279, 1280, 1440 — the AC's three plus every Tailwind flip the app
uses, both sides), the shell tiers, the JSON panel against the shared constants, the card-then-no-
table ordering, the tablet scroll container, the stat-card columns and the ⌘K palette, and it
already has a guard arm asserting its own unmocked list is empty. The AC's "375/768/1440 across all
routes" is therefore already satisfied by the **375/768/1440 rows of that matrix**; D3 validates
that mapping against the AC's words with a per-clause table and reports what was already there
versus anything added. **No arm is rewritten and no arm is weakened to fit a template.**