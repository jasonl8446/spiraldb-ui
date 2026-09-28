# p5-07 D2 — `tests/ui/a11y.spec.ts`, and the four real defects measuring it found

**Story:** p5-07 (plan task 5.7 + **P5 AC#13**), branch `phase-5-dashboard-polish`, HEAD `a22c86f`.
**Deliverable:** `tests/ui/a11y.spec.ts` (new, 17 arms). **Files this story also changed:**
`client/src/components/layout/Header.tsx`, `client/src/components/quest/QuestGoalLogicEditor.tsx`,
`client/src/components/quest/QuestJsonPanel.tsx`, `client/src/components/quest/QuestPreview.tsx`
— each one a defect the scan found, listed in §4 with its before/after measurement.

---

## 1. The arms, and which AC clause each one carries

`tests/ui/a11y.spec.ts` — 17 tests. Axe runs with its **default rule set** (every tag, including
`best-practice`), i.e. nothing was narrowed to make the numbers look better.

| § | arm | what it scans | AC clause |
|---|---|---|---|
| 1 | `dashboard` | `/` as loaded: 4 stat cards, 8 per-type bars, 3 feed rows | "the four key pages" |
| 1 | `quest-list` | `/quests` as loaded: filter tabs + the desktop table (50 of 322 rows) | " |
| 1 | `quest-detail:{Info,Goals,Goal Logic,Requirements,Results,Dialog}` | `/quests/DS-ACAD1-C01-001` **in edit mode as loaded**, one arm per tab | " |
| 1 | `quest-detail:json-panel` | the same page with the JSON side panel open | " |
| 1 | `drop-table:view` | `/drop-tables/DS-ACAD1-C01-001` **as loaded** | " |
| 1 | `drop-table:edit` | the same page after `Edit` | " |
| 2 | `{dashboard,quest-list,quest-detail,drop-table}@375` | the same four pages at 375×900 | extra coverage (§2 of D1) |
| 3 | the fixtures guard | four pages walked in one session, `unmocked` must be empty | hermeticity (D81) |
| 4 | the corpus condition | the harness's own server vs the corpus on disk | the CI proof (D81) |

`unmocked: 0` held on **every** scanned arm (the guard is per-arm, never only at the end).

## 2. The histogram — all 15 scanned arms, at every severity

From the normal local run (`/tmp/p507/a11y-run5-normal.txt`, `16 passed (22.5s)`, `rc=0` — taken
before the §4 corpus arm was added, so 16 tests then and 17 now; the 15 scanned arms are the same
set either way, and the same zero-at-every-severity result repeated in every full run afterwards):

| arm | critical | serious | moderate | minor | incomplete | console errors |
|---|---|---|---|---|---|---|
| dashboard | 0 | 0 | 0 | 0 | 0 | 0 |
| quest-list | 0 | 0 | 0 | 0 | 2 | 0 |
| quest-detail:Info | 0 | 0 | 0 | 0 | 1 | 2 |
| quest-detail:Goals | 0 | 0 | 0 | 0 | 2 | 2 |
| quest-detail:Goal Logic | 0 | 0 | 0 | 0 | 2 | 2 |
| quest-detail:Requirements | 0 | 0 | 0 | 0 | 1 | 2 |
| quest-detail:Results | 0 | 0 | 0 | 0 | 1 | 2 |
| quest-detail:Dialog | 0 | 0 | 0 | 0 | 1 | 2 |
| quest-detail:json-panel | 0 | 0 | 0 | 0 | 1 | 2 |
| drop-table:view | 0 | 0 | 0 | 0 | 1 | 3 |
| drop-table:edit | 0 | 0 | 0 | 0 | 1 | 3 |
| dashboard@375 | 0 | 0 | 0 | 0 | 0 | 0 |
| quest-list@375 | 0 | 0 | 0 | 0 | 0 | 0 |
| quest-detail@375 | 0 | 0 | 0 | 0 | 1 | 2 |
| drop-table@375 | 0 | 0 | 0 | 0 | 1 | 3 |

**Moderates and minors are 0, not filtered.** They are *counted and printed per arm*, so the
assertion (`critical + serious === 0`, the AC's wording) can never hide one: the four buckets are
built from `results.violations` before any filtering, and each arm logs the whole histogram.

### 2.1 The `incomplete` bucket, named with axe's own reason

An `incomplete` is axe's "needs a human" bucket — never a violation, and never silently dropped
here: each one prints its rule id, its node targets and axe's own message. Three families exist,
and one of them was a real defect (fixed, §4.4):

| rule | axe's message, verbatim | what it is | real? |
|---|---|---|---|
| `aria-prohibited-attr` (~1–50 nodes/arm) | *"aria-label attribute is not well supported on a span with no valid role attribute."* | `StatusBadge`'s `<span aria-label="Status: X">`. The same ARIA 1.2 prohibition as the Header div (§4.3) — axe cannot call it a *violation* because the badge also carries the visible status word, so the name is not lost. | **Yes, but inert.** The label is ignored by AT and the visible text is the real name. **Kept, by explicit ruling**: four committed specs locate the badge *through* that label (`object-editors.spec.ts:340,360`, `status-integration.spec.ts:408`, `extraction.spec.ts:1236`), so the lead ruled it known debt with the better long-term fix (locate the badge by its visible text) rather than an edit to four specs to satisfy an incomplete. Recorded, not re-designed (D85's precedent). |
| `color-contrast` (quest-list, quest-detail:Goals) | *"Element's background color could not be determined because element contains an image node"* / *"…overlapped by another element"* / *"Element content contains only non-text characters"* | the sortable `<th>`'s button, and the non-text glyphs (the 2px `aria-hidden` mainline dot, the dnd-kit drag handle). | **No claim either way** — axe could not compute a ratio here, which is exactly why it is reported rather than asserted. Nothing with text is left undecided. |
| `aria-valid-attr-value` (1 node, `Goal Logic` only) | *"ARIA attribute element ID does not exist on the page: `aria-labelledby=":rd:-tab-Goal Logic"`"* | **A real defect** — the two-word tab's DOM id contained a space, so `aria-labelledby` was two ids and the tabpanel had no accessible name. | **Yes** — fixed in §4.4; the incomplete is gone from every arm afterwards. |

### 2.2 The Chromium console errors are exactly the two designed 404s

Recorded, never asserted. The dispatcher logs every single-id name lookup, so they are named
rather than waved at:

- quest detail (2 errors): the string-table title lookup `QuestTitle_1ED8D` → 404 → the Info
  editor's **raw-key fallback** (`QuestTitleSource = 'rawKey'`), which is a feature
  (`client/src/lib/quest-info.ts:66`). One 404 is that lookup; the other is the same lookup
  re-issued by the Goals tab's title query.
- DropTable detail (3 errors): the single-id item lookup `1000` → 404 → the dropdown keeps the
  numeric form. `1000` is one of the **8 measured misses** `drop-table-mocks.ts` models (D70); the
  sibling `1001` resolves from the list, which is the pair that makes it a contract.

`consoleErrors: 0` on the dashboard and the quest list — the two pages with nothing unmapped.

## 3. Settle, measured

Every arm calls `settle(page, ready)`: the fingerprint (`readyState`, document scroll extents,
element count, the **running** animations' names, `<main>`'s rounded box) must read identically
twice in a row, via `expect.poll` — after a content assertion, so a page that rendered nothing
can never be "settled". Running animations are *counted*, not required to be zero, because React
Flow's `dashdraw 0.5s linear infinite` never ends.

That is the p5-06 defect this file is warned about (the ⌘K dialog measured at `x=697` mid-animation
and `x=384` settled). The `quest-detail:json-panel` arm is the direct case: the panel's own
`animate-in` (`ui/dialog.tsx`, `duration-200`) is running in read *n* and gone in read *n+1*.

## 4. The four defects the scan found — three of them axe **serious**

p5-05's lead-run tier-2 scan reported "critical/serious 0, other 0" on the four surfaces. That
scan read each page **as loaded, at desktop width, with the JSON panel closed**. Scanning the
same four pages in their other states found four real defects, none of them visible to that
configuration. All four are fixed in this story; each fix is the smallest change that removes the
cause, and each is pinned so it cannot silently return.

### 4.1 React Flow's goal-logic handles: `aria-label` on a role-less `div` — serious

```
serious aria-prohibited-attr (1 node): Elements must only use permitted ARIA attributes
  - .react-flow__node-goalLogic… > .\!bg-zinc-500.react-flow__handle-left.target
  - …[data-handleid="and"][aria-label="AND dependency (solid)"]
```

`QuestGoalLogicEditor`'s four `<Handle>`s (target/AND/OR) set `aria-label`; React Flow renders a
bare `<div>` with no role, and `aria-label` is **prohibited** on the generic role (ARIA 1.2). The
label was therefore inert for assistive tech while looking like a name. **Fix:** the four handles
now carry `title` only — the same words, legally (a tooltip for the pointer user, and a legal
accessible-name fallback on a generic element). Edge creation is drag-only either way, and the
keyboard-equivalent edit is the `EntryInspector`'s `m_goalsAND`/`m_goalsOR` lists beside the
canvas (p5-05's own §1 ruling). No committed spec locates a handle by that label (`grep` → 0).

### 4.2 The JSON panel's Solarized syntax colours on the app's own well — serious

```
serious color-contrast (1 rule, 2 nodes): Elements must meet minimum color contrast ratio thresholds
  - ._2bkNM[role="treeitem"] > ._Chy1W   (the string-value span, ×2)
```

`QuestJsonPanel` replaces `react-json-view-lite`'s container colour with the app's `zinc-950`
(`#09090b`) but keeps `darkStyles`' Solarized syntax palette, which is tuned for `rgb(0,43,54)`.
Computed (WCAG relative luminance, sRGB):

| syntax kind | library value | on `#09090b` | replacement (measured) | on `#09090b` |
|---|---|---|---|---|
| string value | `rgb(203,75,22)` | **4.32:1** ✗ | `text-orange-300` `#fdba74` | 11.79:1 ✓ |
| number value | `rgb(211,54,130)` | **4.38:1** ✗ | `text-pink-300` `#f9a8d4` | 10.97:1 ✓ |
| label / punctuation | `rgb(253,246,227)` | 18.44:1 ✓ | kept | — |
| null / undefined | `rgb(129,181,172)` | 8.66:1 ✓ | kept | — |
| boolean | `rgb(174,129,255)` | 7.00:1 ✓ | kept | — |
| other | `rgb(38,139,210)` | 5.41:1 ✓ | kept | — |

**Fix:** `QuestJsonPanel.tsx`'s `SYNTAX_OVERRIDES` **replaces** (never appends to) the two library
classes for those two kinds, so there is no stylesheet-order question about which colour wins.
The arm then pins the painted value — `toHaveCSS('color', 'rgb(253, 186, 116)')` and
`'rgb(249, 168, 212)'` — because a build that never emitted the two Tailwind utilities would leave
the values inheriting the light foreground, which *passes* the contrast rule and would silently
revert the fix. (axe flags only the string span, at 2 nodes; the number span measures 4.38:1 by the
same math and is fixed alongside it.)

### 4.3 The header's current-user block: `aria-label` on a `<div>` — serious **at mobile widths**

```
serious aria-prohibited-attr (1 node): aria-label attribute is not well supported on a div with no valid role attribute
  - div[aria-label="Current user"]
```

The same ARIA prohibition as §4.1, but it only *violates* below `sm` — which is why p5-05's
desktop scan saw nothing. The reason is exact: axe's `ariaProhibitedAttrEvaluate` returns
**incomplete** when the element has text content, and the block's name span is `hidden … sm:inline`.
At ≥640px the div has text (`incomplete`); at 375px it has none, so the rule fires.

**Fix: `role="group"` — one attribute.** A named `group` is the correct semantics for a distinct
identity region, and it makes the existing label legal at every width.

**A second half was tried and reverted, and the revert is itself the evidence.** Below `sm` the
user's *name* is display-hidden, so a screen-reader user at mobile width learns the region's name
("Current user") but not which user. Adding a second `sr-only sm:hidden` span carrying the same
words fixes that — and **breaks a committed spec**: `shell.spec.ts:865`'s
`getByText(user_name, { exact: true })` then resolves to **two** elements and fails strict mode
(observed in full-suite run A: `strict mode violation … resolved to 2 elements`). The alternative,
`sr-only sm:not-sr-only` on the one span, changes `truncate`'s `white-space` at ≥sm and so needs a
layout measurement this story did not budget. So the gap is **recorded in the component's own
comment** (with both candidate fixes and why neither was taken) and below — not silently left, and
not closed by editing a committed locator to suit it.

### 4.4 The Goal Logic tabpanel had no accessible name (an `aria-labelledby` split in two)

```
aria-valid-attr-value (incomplete): ARIA attribute element ID does not exist on the page:
  aria-labelledby=":rd:-tab-Goal Logic"
```

`QuestPreview` built the tab button's id from the tab's display name, so the two-word tab produced
`id=":rd:-tab-Goal Logic"`. An HTML `id` must not contain a space, and `aria-labelledby` is a
**space-separated list of ids** — the browser parsed it as `:rd:-tab-Goal` and `Logic`, neither of
which exists, so that pane was unlabelled (the other five tabs, all one word, were fine). **Fix:**
one `tabDomId()` helper (`name.replace(/\s+/g, '-')`) used by the `id`, by the tabpanel's
`aria-labelledby` and by the arrow-key focus lookup, so the three cannot drift. No committed spec
references those ids (`grep -rn -- "-tab-" tests/` → 0). The `aria-valid-attr-value` incomplete is
absent from every arm afterwards (compare the `Goal Logic` row: 3 incompletes before, 2 after).

## 5. Falsification (D67(d)) — the break, and *which* arm caught it

One deliberate break was introduced into `client/src/components/objects/DropTableForm.tsx`,
chosen so the failing arms are **page-specific**: the shared field renderer's `<label htmlFor={id}>`
(`:222`) was pointed at a non-existent id (`broken-${id}`), which axe reports as the **critical**
`label` rule (*"Form elements must have labels"*) **only where that form renders**.

| step | result |
|---|---|
| back up + md5 before | `cp … /tmp/p507/backup/`; `51864a70468f88cc344706c7ccae382b` |
| `npx playwright test tests/ui/a11y.spec.ts` | **rc=1, 3 failed / 14 passed (26.7s)** |
| which arms failed | **only** `drop-table:view`, `drop-table:edit`, `drop-table@375` |
| which rule | `critical label (9 node(s)): Form elements must have labels` — one node per DropTable field |
| restore | `cp /tmp/p507/backup/DropTableForm.tsx …` — **never `git checkout`** (p5-06's lesson) |
| md5 after | **`51864a70468f88cc344706c7ccae382b` — identical** |
| residue | `grep -c 'broken-'` → 0; `git status --porcelain <file>` → 0 lines |

**That is the whole point**: the break fires on the predicted page and on no other, so the four
page arms are four independent navigations to four different DOMs — the brief's named failure mode
("a scan of the whole app repeated four times rather than of the four pages' own states"),
falsified rather than asserted. The lead's own AC#9 tier-2 re-scan independently reproduced it on
the broken tree: **1 CRITICAL `label`, 9 nodes, DropTable detail only, no other page.**

## 6. Typecheck and lint

```
$ npx prettier --write tests/ui/a11y.spec.ts client/src/{components/layout/Header.tsx,…}
$ npx tsc -p tests/tsconfig.json --noEmit        → rc=0
$ npx tsc -p client/tsconfig.json --noEmit       → rc=0
$ npx eslint tests/ui/a11y.spec.ts client/src/…  → rc=0
```

All seven gate checks (including `npm test`, `lint`, `typecheck:tests`, the server tsconfig and
`npm run build`) are in [`p5-07-gate.txt`](./p5-07-gate.txt); the AC#13 runs are in
[`p5-07-d3-proof.md`](./p5-07-d3-proof.md).

## 7. Honest limits

- **The scan reads mocked pages, not the owner's data.** That is deliberate (D40/D81 — a tier-1
  spec must not depend on ambient data), and it means this suite cannot see a defect that only
  the real corpus triggers. p5-05's tier-2 scan is the complement, and it should be **re-run**
  now that four source files moved (§4).
- **The token/copy surfaces are not machine-checkable.** WCAG 1.4.1 (colour-only status) has no
  axe rule — p5-05's audit §4 already records the desktop table's status cell as the one real
  instance, with its owner-decision item. This suite cannot add or remove that finding.
- **`aria-prohibited-attr` on `StatusBadge` remains an incomplete, kept deliberately** (§2.1). It
  is real but inert (the visible status word is a real accessible name) and four committed specs
  locate the badge *through* that label; the lead ruled it known debt with the better long-term fix
  (locate the badge by its visible text) rather than a four-spec edit to satisfy an incomplete.
- **The header's mobile name gap is also recorded, not closed** (§4.3): below `sm` the user's name
  is not in the accessibility tree, because the one fix that closes it breaks a committed locator
  and the other needs a layout measurement this story did not budget.
- **17 arms is not "every state".** The dashboard's per-type bars, the quest list's four filter
  tabs, the status dialog and the error surfaces have their own specs (`dashboard.spec.ts`,
  `status-filter-url.spec.ts`, `p5-04-error-surfaces.spec.ts`) and are not re-scanned for a11y here.