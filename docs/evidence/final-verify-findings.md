# final-verify — findings, and the dispositions of the conditional one-liners

Raw output: [`final-verify-findings-raw.txt`](./final-verify-findings-raw.txt) (the git.ts astral
proof, the savePipeline proof, the F1 red) and
[`final-verify-findings/F2`](./final-verify-ui-runs.txt) for the green (the `zonefix-*` transcripts
are also appended in [`final-verify-p5.txt`](./final-verify-p5.txt) once the run closed).

---

## F1 (new, blocking a claim) — the ZoneTransfer detail scrolls the document sideways at 375px on real corpus data

**What was measured.** On a live stack (the built client served by the real server, `NODE_ENV=test`,
the D17 clone), at a 375px viewport:

| route | `documentElement.scrollWidth` / `clientWidth` | verdict |
|---|---|---|
| `/zone-transfers/WizardCity%2FWC_Hub` (the owner's real document, 13 teleports) | **469 / 360** | document scrolls sideways |
| `/zone-transfers/DragonSpire%2F…%2FDS_Chasm_Gauntlet_4Room2` (the corpus's longest destination, 93 chars) | **838 / 360** | document scrolls sideways |
| `/zone-transfers/Krokotopia%2FKT_Pyramid%2FInteriors%2FKT_Hall_T5` (a real zone with **zero** teleports) | **397 / 360** | document scrolls sideways |
| the other 19 routes × 375/768/1440 | `scrollWidth == clientWidth` | clean |

**Cause, named by element** (deepest overflowing box first):

```
DIV.flex.flex-col.gap-1              scrollW 412  clientW 246   ("Destination zone" cell)
  SPAN.font-mono.text-sm.text-zinc-100  scrollW 412  clientW 246   ("Housing_CastleToursApt/…")
ARTICLE.flex.flex-col.gap-3…          scrollW 424  clientW 270
UL.flex.flex-col.gap-3                scrollW 424  clientW 271
DIV.flex.flex-col.gap-4               scrollW 445  clientW 312
```

Two independent sources, both **`span.font-mono` in view mode with no wrap rule**
(`client/src/components/objects/ZoneTransferForm.tsx`): the read-only `ZoneName` header, and each
teleport's `Destination zone` value. A zone path is long and has no break opportunity the browser
will use, so the span cannot shrink and the overflow propagates to `documentElement`.

**Why every existing assertion passed.** `tests/ui/responsive.spec.ts`'s §1 asserts exactly this
(`scrollWidth <= clientWidth`, all 20 routes × 8 widths, 375 included) — but its route mock
returned `{ ZoneName: key, Teleports: [] }` with the 18-character key `WizardCity/WC_Hub`
(`tests/ui/responsive.spec.ts:400`). A mock **narrower than reality** cannot fail an overflow
assertion: the **D78(d)** class.

**And it qualifies a previous story's claim, precisely.** `docs/evidence/phase-5/p5-06-d1-checklist.md`
records the 375px sweep and concludes "`/quests/DS-ACAD-C01-001` is the only route that overflows at
**375px**" — with `/zone-transfers/WizardCity%2FWC_Hub` measured **375/375 clean**. That is **true for
the audit's mocked documents and false for the owner's**: the audit's detail routes carry the same
fabricated keys its sibling spec does (`/drop-tables/DROP-A`, `/npc-drop-tables/12345`,
`/treasure-card-inventories/2019`), i.e. empty lists and short keys. The 768px half of that audit
(8 routes, +70…+157) **is** fixed — my sweep measures all 20 routes clean at 768.

**Carried as two small fixes, and both were proven, not asserted:**

1. **The CSS (one property, two sites)** — `break-all` on both `font-mono` spans in
   `ZoneTransferForm.tsx`, with the rule documented in the component's own docblock (including why
   `break-all` rather than `truncate`: the zone path *is* the key the page is about, so hiding part
   of it is the wrong remedy).
2. **The instrument** — `tests/ui/responsive.spec.ts`'s `zone_transfer` route mock now returns a
   **real-shaped teleport carrying the corpus's longest `m_destinationZone`** (93 characters),
   keeping the 375px assertion.

**Red then green, on the same assertion** (`npx playwright test tests/ui/responsive.spec.ts -g '20 routes'`):

| run | tree | result |
|---|---|---|
| **F1** | real-shaped mock, **no** CSS fix | **✘ failed in 5.4 s** — `expect(scrollWidth).toBeLessThanOrEqual(clientWidth)` → `Expected: <= 375, Received: 839` |
| **F2** | real-shaped mock **+** `break-all` | **✓ 1 passed (39.8 s)** — 20 routes × 8 widths |

839 is the same number the live MCP probe measured for the 93-character path (838), so the red is
the real defect and not a rig artefact. A swept verification that leaves its own instrument blind
would be re-run by the verifier and pass for the wrong reason; this one cannot.

**Residual, stated rather than implied.** The long-*key* axis (a zone with no teleports, 397px) is
fixed by the same `break-all` but is **not asserted** — the mock's `ZoneName` is still the
18-character `WizardCity/WC_Hub` and its `detailPath` is unchanged (changing it would ripple through
the shell/responsive suites' fixtures). The destination axis, which is the dominant offender
(838px), is asserted. And the same `font-mono` pattern exists in five sibling forms
(`NpcInventoryForm`, `NpcSpellInventoryForm`, `CreatureSpellbookForm`, `NpcDropTableForm`,
`TreasureCardInventoryForm`) whose values are numeric ids and short deck names: **no overflow was
measured on any of those routes at 375**, so they are deliberately untouched.

---

## F2 — the save-ledger ordering (`server/src/services/savePipeline.ts`): **RECORD, not fix**

The `written` ledger is appended after a successful write, so an ENOSPC-class failure rethrows bare.
The naive fix — append before the write — is provably wrong, because **two different failures reach
the same catch with the file untouched** (measured against the real
`writeSpiraldbJson`, [`findings-raw`](./final-verify-findings-raw.txt)):

| case | outcome | file state |
|---|---|---|
| a **symlink** target (`save must never write through a link`) | throws `SpiraldbFileError` | target **untouched**, link still a symlink |
| a **circular structure** (serialization throws before the file is opened) | throws `SpiraldbFileError` | nothing written, **no file created** |
| control: a valid write | returns | file created, 24 bytes |

So "I appended to the ledger, therefore I wrote" misreports a refusal as a write. A correct fix
needs the writer to report what it actually did (a per-path result), which is a contract change, not
a one-liner. **Disposition: recorded.** Owner: a later story that owns `spiraldbFiles`'s error
contract.

## F3 — the commit-note cap (`server/src/services/git.ts`): **FIXED, and proven with an astral payload**

`slice(0, 255)` counts **UTF-16 code units**, so a boundary landing between the halves of a surrogate
pair emits a **lone surrogate** — a string that does not survive a UTF-8 round trip and reaches the
repository as U+FFFD. It also truncated strings that were *already* within 255 code points. The
applied change is 4 functional lines (`const points = [...cleaned]; return points.length <=
MAX_COMMIT_NOTES_LENGTH ? cleaned : points.slice(0, MAX_COMMIT_NOTES_LENGTH).join('');`).

Measured against the **real module** (`npx tsx`, importing `server/src/services/git.ts`):

| payload | code units / points | before fix | after fix |
|---|---|---|---|
| `'a'×254 + '😀'` | 256 / 255 | 255 units, **ends in lone surrogate `\ud83d`**, UTF-8 round trip **false** | 256 units / 255 points, round trip **true**, tail `a😀` |
| `'a'×254 + '😀' + 'b'` (the **truncation path**) | 257 / 256 | 255 units, **lone surrogate**, round trip **false** | 255 points, round trip **true**, drops only the trailing `b`, keeps `😀` |
| `'a'×253 + '😀' + 'bc'` | 257 / 256 | 254 points, round trip true | 255 points, round trip true |
| `'z'×300` (the pinned ASCII case) | 300 / 300 | 255 units | **255 units — unchanged** |

The pinned unit test still passes (`tests/unit/git-service.test.ts`, **20 passed**), which is what
the ASCII row predicts. **Disposition: fixed** (already a working-tree change when this sweep
started; this sweep proved it rather than assuming it).

---

## Observations (recorded, not defects)

- **A status row inserted by an *update* save carries the note `Created via UI`.** On this rig the
  database was built with `SPIRALDB_UI_SKIP_IMPORT=1`, so corpus files have **no** `entry_status`
  row; the first save inserts one and stamps the documented insertion note
  (`server/src/services/objects.ts:592`). With a normally-imported database the row already exists
  and no note is added, so this is a **rig artefact of the skipped import**, not a misreport — but
  the wording ("Created via UI") is what a row-insertion on an *edit* path produces.
- **The quest browse list reports a filesystem count with the schema's default status.** With the
  import skipped, `GET /api/quests` returned `Showing 1-50 of 321` and every row read `Extracted`
  while `entry_status` held 3 rows. That is the documented contract — a fresh directory scan per
  call (D12) and "no row ⇒ `extracted`" (`server/src/services/quests.ts:189-193`, the schema default
  and the import's value) — not a finding.
- **22 of the owner's 328 quest files are JSON5-only** (a trailing comma; strict `JSON.parse` and
  `jq` both refuse them). The loader tolerates it; this is D79's measured corpus reality, quoted
  because it is why a strict-parse instrument is the wrong choice for raw corpus reads.
- **The SPA fallback is breadth-first**: `/nope.js` also answers `200 text/html` with `index.html`,
  not a 404. The P5-3 step only requires `/quests` → `index.html`; recorded as an observation.

## Explicitly not this sweep's to fix (the ledger is complete)

- the **pre-existing** duplicate-target warning emitted *before* the save, so a failing save still
  claims it updated;
- the **S1 drag-arm residual** — a false red whose false-pass path is already closed; the remedy is
  recorded in the previous executor's `final-verify-plan.md` (wait on the panel's own success toast,
  assert the copied text contains the edit under test, **do not** raise the card-order poll). It did
  **not** fire in any of this sweep's runs.