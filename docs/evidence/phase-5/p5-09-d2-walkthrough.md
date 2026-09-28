# p5-09 D2 — the walkthrough, both modes

Story p5-09 (plan task 5.8). Everything below ran in the throwaway clone
`/tmp/p5-09/spiraldb-ui` (HEAD `750c31a` + this story's sync fix), against the throwaway corpus
`/tmp/p5-09/corpus` (a fresh clone of the fork at `d57d891`, 328 quest `.json` files / 317
DropTables) and the
isolated database `/tmp/p5-09/dryrun.db`. The repo was never written to and no git write happened in
it; the D17 clone `data/test-spiraldb` and the owner's fork were read only.

**Rig, and how identity was asserted before any probe (D70(h)):** dev stack = Express `:3001` +
Vite `:5190` (`VITE_PORT`; the owner's other project holds `[::1]:5173` and was left alone, D78(b));
prod stack = `npm start` on `:3001` after `npm run build`. Identity came from the boot line
(`[spiraldb-ui] database ready at /tmp/p5-09/dryrun.db`) and from `GET /api/settings`
(`spiraldb_path=/tmp/p5-09/corpus`, `user_name="Dry Run (p5-09)"`) — both checked before the first
write, and shared with D1. All rigs were killed **by explicit PID**; the only remaining listener is
the sibling's `5173`.

## The five walkthrough steps (dev mode, `http://localhost:5190`)

| # | Step | Action (real UI, or command) | Observed result |
|---|---|---|---|
| 1 | **Extract a fixture quest** | `Extract Quests` → the dropzone's own `<input type=file>` in the browser; the file is Phase 2's committed capture fixture `server/test/fixtures/captures/MB-YARD1-C01-001.json` (32,958 B, D28/D54) | Results split renders: `MB-YARD1-C01-001 · Level 1 · 15 goals · new`, the six tabs, and the Info tab reads real values (`m_questTitle QuestTitle_9B62`, `m_startGoals 1_WizardQuestGoals_Explore`, `m_mainline true`, `m_goals (count) 15`). The extraction went through the **real** `tools/bin/imview-packet-reader` built in D1. Screenshot `p5-09-d2-01-extract-results.png` |
| 2 | **Save** | `Save All to SpiralDB` → the confirm dialog → `Save` | Dialog text verbatim: *"Save 1 quests to SpiralDB? This will create files and auto-commit."* + *"These quests already exist in SpiralDB and will be overwritten: MB-YARD1-C01-001"* (plan 2.4 L49 / D50) — screenshot `p5-09-d2-02-save-confirm-overwrite.png`. After `Save`: toast **"Quest MB-YARD1-C01-001 saved and committed"**. In the corpus: **one** commit `8fa0614` on the new branch `content/2026-09-27`, author `Dry Run (p5-09) <Dry-Run-p5-09-@spiraldb-ui.local>`, subject `spiraldb: update quest MB-YARD1-C01-001`, touching exactly the quest file + its metadata file; `git status --porcelain` empty. The written file is **clean JSON** (0 trailing commas, final newline) — Phase 2's AC. Metadata pairing (D20) held: exactly **one** `QuestMetadatas/` file carries that quest's `Name` and its `ModifiedAt`/`ModifiedBy` were refreshed in place (no duplicate created) |
| 3 | **Mark reviewed** | Quest detail → `Mark Reviewed` → notes `p5-09 dry run: reviewed in the throwaway clone` → `Mark Reviewed` | Toast **"MB-YARD1-C01-001 marked reviewed"**; StatusBadge `Extracted` → `Reviewed`; the page's Status History panel shows *"MB-YARD1-C01-001 marked reviewed · just now · by Dry Run (p5-09)"*; `GET /api/status/quests/MB-YARD1-C01-001/history` → `[{old_status:"extracted", new_status:"reviewed", notes:"p5-09 dry run: reviewed in the throwaway clone", changed_by:"Dry Run (p5-09)"}]`. Screenshot `p5-09-d2-03-quest-reviewed.png` |
| 4 | **Edit a DropTable** | `Drop Tables` → `DS-ACAD1-C01-001` (a **legacy-named** file, `droptables_ds-acad1-c01-001.json`) → `Edit` → `Description` `""` → `"p5-09 dry-run edit: one field only"` → `Save` | Toast **"Saved DS-ACAD1-C01-001 (updated) — spiraldb: update drop_table DS-ACAD1-C01-001"**. Commit `b97c7dd`, **one file, 5 insertions/5 deletions**: the `Description` line is the only *value* change; the other four lines are the documented one-time formatting normalisation (`1.0`→`1`, `0.0`→`0`, missing final newline added, D49c) — and the file kept its **original legacy path** (D19). The audit quartet was **not** stamped (`ModifiedAt/ModifiedBy` still `quest_builder`, D69(b)). Reloading the page reads the new value back, readonly in view mode (D66). Screenshot `p5-09-d2-04-droptable-edited.png` |
| 5 | **The dashboard reflects it** | `/` in the same browser session; DOM text compared against `GET /api/dashboard` + `GET /api/activity` read from the page | Cards **Total 2277 / Extracted 2275 / Reviewed 2 / Verified 0** — equal to `overall` `{total:2277, extracted:2275, reviewed:2, verified:0}`; percent strings `99.9% / 0.1% / 0.0% / 0.0%` (one decimal); 8 per-type bars including `NPC Drop Tables 0/0 (0.0%)` and **no GlobalRegistry row** (Q1); Recent Activity lists **both** actions newest-first with relative times, italic notes, the `by Dry Run (p5-09)` line and links `/drop-tables/DS-ACAD1-C01-001` and `/quests/MB-YARD1-C01-001`. Screenshot `p5-09-d2-05-dashboard-dev.png` |

### What the dashboard can and cannot reflect — measured, not glossed

The criterion's sentence is "dashboard reflects all three". On a fresh clone with a **real** corpus,
exactly one of the three actions moves a dashboard datum, and the reason is structural:

| Action | Dashboard effect | Why |
|---|---|---|
| extract → save | **none** — total stayed 2277, no feed row | every committed fixture quest is already in the corpus, so the save is an *update* of an entry the first-startup import already created as `extracted`; D48(c)/D76(e): an update writes **no** status transition, so `status_history` and every aggregate are unchanged. The save's evidence is the commit, the rewritten file and the refreshed metadata (all above) |
| mark reviewed | **yes** — extracted 2276→2275, reviewed 0→1, quest bucket moved, **+1 feed row**, and the feed's row links to the quest | a status transition is exactly what the dashboard aggregates |
| edit a DropTable | **none** — 317/317 unchanged, no feed row | the dashboard aggregates *status*, never content (`GET /api/dashboard` reads `entry_status` only), so a content edit has no dashboard surface by construction |

To make the third action visible on the dashboard rather than leave the claim untested, I took **one
supplementary UI step, labelled as such**: `DS-ACAD1-C01-001` was marked reviewed (notes
`p5-09 dry run: edited then reviewed (supplementary so the dashboard can show it)`), which moved the
Drop Tables family to `1/317` and added its feed row — the second Recent Activity entry in the
screenshot. The two feed rows are the two *status* facts; the save and the edit are evidenced by
their commits and files.

**The create path (which *would* move the total, D54's "grows by N") is not exercisable with the
committed fixtures**: all five (`MB-YARD1-C01-001`, `WC-CYCLOPS-MAIN-002`, `WC-FIRECAT-MAIN-004`,
`WC-UNICORN-MAIN-004`, `WC-UNICORN-MAIN-007`) already exist in the 328-file corpus, so every
fixture save is an overwrite. That is a real limit of the AC's wording for a *real* corpus — the
tier-1 spec's "grows by N" arm mocks the corpus, and `verify:captures` pins the fixtures to the
**322-era** clone where they were generated. Named here rather than faked with a doctored database.

### A fidelity measurement worth having (and its explanation)

The save is an extract-then-save, so the written quest is what the **CLI reconstructed from the
capture**, not the file it replaces. Value-level comparison of `HEAD~1` vs `HEAD` (JSON5-parsed,
leaf-by-leaf):

```
leaves before 1204   leaves after 1209   deepEqual false
only-before 1 (m_goals/0/m_tallyCounter: null)   only-after 6 (a materialised m_tallyCounter
object with m_percentChance/m_descriptor/m_descriptor2/m_count; m_bountyType "BT_MOB_KILL" on
goals 9 and 13)   value-mismatches 7 — all m_goals/{0,2,4,6,8,10,12}/m_zoneEntry: true -> false
```

**This is not a reader defect and not field loss in the save pipeline.** The fixtures README pins
the capture to the corpus at **`c55ccab`** (the frozen 322-era D17 clone, D80(c)) and says plainly
that "a corpus refresh changes the bytes and `verify:captures` fails until the fixtures are
regenerated". My corpus is `d57d891` with 328 quest files, i.e. the corpus moved under the fixture — the
`m_zoneEntry` booleans and the tally-slot shape are exactly the "which keys nodes omit" family D80(e)
measured. The clean-room version of this claim (GET → POST **unmodified**, which is the AC that
actually owns "no field loss") is re-checked live in D3's checklist.

## The production repeat, `:3001`, no Vite

```
$ npm run build         rc=0  (real 9.8 s; client/dist/assets/index-NmSPrSJ5.js 768.82 kB / gzip 226.71 kB)
$ SPIRALDB_UI_DB=/tmp/p5-09/dryrun.db npm start        # default PORT -> :3001
[spiraldb-ui] database ready at /tmp/p5-09/dryrun.db
[spiraldb-ui] first-startup import skipped (entry_status already has rows)
[spiraldb-ui] API listening on http://localhost:3001
[spiraldb-ui] serving built client from /tmp/p5-09/spiraldb-ui/client/dist
```

The boot line re-checks Phase 1's "restart does not import again / counts unchanged" line live: a
**second process** on the same database skips the import and the counts are identical (2277).

| Key flow repeated on `:3001` | Observed |
|---|---|
| Dashboard numbers | cards `2277 / 2275 / 2 / 0` — equal to `overall`; feed 2 rows (`drop_table:DS-ACAD1-C01-001`, `quest:MB-YARD1-C01-001`); **`/@vite/client` absent from the DOM** (`hasViteClient: false`) — "without Vite" asserted, not assumed. 0 console errors, 0 warnings |
| Deep link `/quests/MB-YARD1-C01-001` | renders `Quest Detail` with the `Reviewed` badge (a full document load, so this is the SPA fallback too) |
| **A real action in prod**: `Mark Verified` + notes | toast **"MB-YARD1-C01-001 marked verified"**; badge → `Verified`; the same fix-path through the identity-attributed transition (`by Dry Run (p5-09)`) |
| Dashboard after it | cards `2277 / 2275 / 1 / 1` == `overall` `{extracted:2275, reviewed:1, verified:1}`; the Quests bar reads **`1/328 (0.3%)`** (the bar's fraction is *verified/total*, which is why it reads 0 for the other families); feed top = `quest MB-YARD1-C01-001 reviewed→verified` with the note. Screenshot `p5-09-d2-06-dashboard-prod-3001.png` |
| SPA fallback (curl, 7 paths) | `/`, `/quests`, `/quests/MB-YARD1-C01-001`, `/drop-tables/DS-ACAD1-C01-001`, `/settings`, `/zone-transfers/WizardCity%2FWC_Hub`, `/nope-not-a-route` → all **200 `text/html; charset=UTF-8`** and **byte-identical to `client/dist/index.html`**; `/api/unknown-nope` → **404 `application/json` `{"error":"Not found"}`** (the API never leaks the shell). Raw: `p5-09-d2-prod-http.txt` |

## F2 — found by this walkthrough: the first-startup import toast re-announces an old import

`client/src/components/layout/AppLayout.tsx` guards the one-time "Imported N existing entries from
SpiralDB" toast with a **module-level** flag (`let importToastShown = false`), which is per
*document*, not per *import*. Measured on the running clone:

```
$ curl -s localhost:3001/api/status/_import
{"ran":true,"imported":2277,"imported_at":"2026-09-28T01:47:22.910Z"}

browser, 01:56 (≈9 minutes after the import):  toast "Imported 2,277 existing entries from SpiralDB"
reload the page:                              toast "Imported 2,277 existing entries from SpiralDB"   (again)
```

So every full page load re-announces an import that happened once — the same announcement a
first-time user should see exactly once (D37 recorded it as a one-time toast). It is cosmetic and
does not affect any count (`entry_status` stayed 2277; the server logged the skip). **Reported, not
fixed here**: the fix (a `sessionStorage` flag, or comparing `imported_at` with the document's start)
lives in a Phase-1 shell component and would need its own tier-1 falsification arm, which is outside
this story's brief.

## Also observed while walking (no defect claimed)

- The DropTable detail page opens in **view mode** (the `Description` textarea is `readonly` until
  `Edit`) while the quest detail page opens editable — D66's "view mode as 'no panels', edit mode on
  load" was recorded for the Phase-3 editor; this Phase-4 family's view/edit toggle is a deliberate
  difference, measured here, not an inconsistency to file.
- The quest Info tab shows the **resolved** title (`QuestTitle_9B62` → "Stop that Cat!") next to the
  raw key, i.e. D36/D33(e)'s string-table resolution live in the clone.

## Rig hygiene

| Check | Result |
|---|---|
| dev stack | killed by explicit PID (3901303 / 3901304 / 3901273); `:3001` and `:5190` free |
| prod stack | killed by explicit PID (`/tmp/p5-09/d2-prod.pid`); `:3001` free, health refuses the connection |
| the owner's sibling on `[::1]:5173` | never signalled — the only listener left, exactly as found |
| the owner's fork `/home/jason/…/spiraldb` | only read (the throwaway corpus is a clone of it) |
| the D17 clone `data/test-spiraldb` | not written (D3 states its five-axis check) |
| the repo `/home/jason/…/spiraldb-ui` | no file written outside `docs/evidence/phase-5/`; **no git command that writes** was run (D84(a)) |