# p8 — quest title dropdown, catalog search, drop-table reward links

Branch `phase-8-quest-starting-data`. Corpus for the real-DB probe: `data/spiraldb-ui.db` (synced dev DB, read-only, 5,959 QuestTitle rows / 1,717 catalog rows). Tier-1 specs are hermetic (mocked, D40/D185); no clone or data dir is read. Proposed D186 (title picker + catalog search) and D187 (drop-table links) are recorded in docs/plan-overview.md.

## Real-database probe of the new query parameters (services called directly, read-only)
```
npx tsx scratchpad/real.ts
category=QuestTitle&limit=5 (first page, ms=14) [{"key":"QuestTitle_72ED4","value":" Wicked Deadly","category":"QuestTitle"},{"key":"QuestTitle_16434E","value":"'Till Wizard Voices Wake Us","category":"QuestTitle"},{"key":"QuestTitle_00000805","value":"'Tis A Magic Place","category":"QuestTitle"},{"key":"QuestTitle_00000752","value":"'Twas Brillig","category":"QuestTitle"},{"key":"QuestTitle_57744","value":"...A Serpent's Tooth","category":"QuestTitle"}]
category=QuestTitle&q=bear truth [{"key":"QuestTitle_00000000","value":"The Bear Truth","category":"QuestTitle"},{"key":"QuestTitle_282F9","value":"The Bear Truth","category":"QuestTitle"},{"key":"QuestTitle_2ABE9","value":"The Bear Truth","category":"QuestTitle"}]
category=QuestTitle&q=17318f [{"key":"QuestTitle_17318F","value":"Run and Done","category":"QuestTitle"}]
category=QuestTitle (all) rows= 5959 ms= 12
catalog {} total= 1717 q= "" first= HO-Maestro-C02-001
catalog {"q":"wizard"} total= 4 q= "wizard" first= DS-ACAD-C01-001
catalog {"q":"wizard","missingOnly":true} total= 2 q= "wizard" first= NV-PostWL-MAIN-004
catalog {"missingOnly":true} total= 1387 q= "" first= HO-Maestro-C02-001
```

## Focused unit tests (server params incl. 400s and SQL-level filtering)
```
npx vitest run tests/unit/names.test.ts tests/unit/quest-coverage.test.ts tests/unit/quest-catalog-view.test.ts tests/unit/quest-overview.test.ts tests/unit/quest-info.test.ts


 ✓ tests/unit/names.test.ts (83 tests) 905ms
   ✓ lazy mount (decision D32) > does not open the real database when the registry and app are merely imported  599ms
 ✓ tests/unit/quest-coverage.test.ts (17 tests) 96ms
 ✓ tests/unit/quest-overview.test.ts (27 tests) 26ms
 ✓ tests/unit/quest-catalog-view.test.ts (19 tests) 10ms
 ✓ tests/unit/quest-info.test.ts (17 tests) 5ms

 Test Files  5 passed (5)
      Tests  163 passed (163)
   Start at  17:12:46
   Duration  2.51s (transform 671ms, setup 0ms, collect 665ms, tests 1.04s, environment 1ms, prepare 214ms)

```

## Focused tier-1 specs
```
npx playwright test tests/ui/quests-info-editor.spec.ts tests/ui/quests-catalog.spec.ts tests/ui/quests-drop-table-link.spec.ts tests/ui/quests-edit-mode.spec.ts
  ✓   3 [chromium] › tests/ui/quests-drop-table-link.spec.ts:49:3 › a drop-table reward links to its editor (D187) › the Results card links a known table and leaves a missing one as text (2.4s)
  ✓   6 [chromium] › tests/ui/quests-drop-table-link.spec.ts:65:3 › a drop-table reward links to its editor (D187) › the link is not nested inside another interactive element (821ms)
  ✓  10 [chromium] › tests/ui/quests-drop-table-link.spec.ts:75:3 › a drop-table reward links to its editor (D187) › clicking it lands on that DropTable editor (822ms)
  ✓  14 [chromium] › tests/ui/quests-drop-table-link.spec.ts:91:3 › a drop-table reward links to its editor (D187) › a dirty quest editor asks before the link navigates away (920ms)
  ✓  18 [chromium] › tests/ui/quests-drop-table-link.spec.ts:103:3 › a drop-table reward links to its editor (D187) › the Overview rewards line links the same table (591ms)
  ✓  20 [chromium] › tests/ui/quests-info-editor.spec.ts:253:3 › the string-table title picker › a hit renders the resolved pair, from one lookup, without opening the list (543ms)
  ✓  21 [chromium] › tests/ui/quests-drop-table-link.spec.ts:115:3 › a drop-table reward links to its editor (D187) › the read-only view of the Results tab links it too (539ms)
  ✓  22 [chromium] › tests/ui/quests-edit-mode.spec.ts:245:3 › the unsaved-changes guard (AC3) › stays off on a clean document: the back link navigates straight away (610ms)
  ✓  23 [chromium] › tests/ui/quests-info-editor.spec.ts:268:3 › the string-table title picker › a miss renders the raw key verbatim, untouched and with no warning (901ms)
  ✓  25 [chromium] › tests/ui/quests-info-editor.spec.ts:293:3 › the string-table title picker › the empty key is never looked up, and shows a placeholder (411ms)
  ✓  17 [chromium] › tests/ui/quests-catalog.spec.ts:145:3 › the search box (D186) › narrows the rows by re-requesting ?q=, matching either half, debounced (2.6s)
  ✓  26 [chromium] › tests/ui/quests-info-editor.spec.ts:307:3 › the string-table title picker › typing searches either half, and choosing writes exactly that key (D186) (1.1s)
  ✓  27 [chromium] › tests/ui/quests-catalog.spec.ts:178:3 › the search box (D186) › fits a 375px viewport with no horizontal scroll (1.2s)
  ✓  29 [chromium] › tests/ui/quests-info-editor.spec.ts:353:3 › the string-table title picker › fits a 375px viewport with the list open and no horizontal scroll (513ms)
  ✓  31 [chromium] › tests/ui/quests-info-editor.spec.ts:372:3 › the string-table title picker › is operable from the keyboard alone (874ms)
  ✓  30 [chromium] › tests/ui/quests-catalog.spec.ts:191:3 › the search box (D186) › combines with missing only (one request carrying both) (1.7s)
  ✓  33 [chromium] › tests/ui/quests-info-editor.spec.ts:395:3 › the string-table title picker › a stored key missing from the table stays shown while other titles are searched (761ms)
  ✓  35 [chromium] › tests/ui/quests-catalog.spec.ts:213:3 › the search box (D186) › a search that matched nothing is its own empty state, not the tier-empty one (751ms)
  ✓  39 [chromium] › tests/ui/quests-catalog.spec.ts:247:3 › the numbers and states are text (D85) › an inferred title carries its labelled badge (403ms)
  ✓  41 [chromium] › tests/ui/quests-catalog.spec.ts:261:3 › each row links into the evidence panel or the scaffold action › a defined row links to the evidence panel and really opens it (516ms)
  ✓  44 [chromium] › tests/ui/quests-catalog.spec.ts:275:3 › each row links into the evidence panel or the scaffold action › a missing row carries the scaffold action, which posts the name and opens the editor (564ms)
  ✓  43 [chromium] › tests/ui/quests-edit-mode.spec.ts:392:3 › the save pipeline (AC4) › a failed save reports the server message and keeps the guard armed (942ms)
  ✓  50 [chromium] › tests/ui/quests-catalog.spec.ts:361:3 › the shell wiring › a row whose title fell back to its name shows the em dash in Title, not the name twice (332ms)
  53 passed (17.8s)
```

## Full suites (tails)
### `npm test`
```
 ✓ tests/unit/a11y-icon-labels.test.ts (2 tests) 4ms

 Test Files  107 passed (107)
      Tests  2197 passed (2197)
   Start at  17:08:38
   Duration  73.75s (transform 1.65s, setup 0ms, collect 6.39s, tests 52.34s, environment 10ms, prepare 3.56s)

```
### `npm run lint`
```

> spiraldb-ui@0.1.0 lint
> eslint . && prettier --check .

Checking formatting...
All matched files use Prettier code style!
```
### `npm run typecheck:tests`
```

> spiraldb-ui@0.1.0 typecheck:tests
> tsc -p tests/tsconfig.json --noEmit

```
### `npm run typecheck:scripts`
```

> spiraldb-ui@0.1.0 typecheck:scripts
> tsc -p scripts/tsconfig.json --noEmit

```
### `node scripts/glossary-spotcheck.mjs --quiet`
```

249 entries, 249 cite a line that names the term, 0 do not.
```
### `npm run test:ui`
```
  ✓  465 [chromium] › tests/ui/responsive.spec.ts:908:5 › §6 AC#12: the stats cards stack at mobile and only fill their columns from desktop › 1280px: the four stat cards occupy 4 column(s) (359ms)
  ✓  466 [chromium] › tests/ui/responsive.spec.ts:908:5 › §6 AC#12: the stats cards stack at mobile and only fill their columns from desktop › 1440px: the four stat cards occupy 4 column(s) (453ms)
  ✓  467 [chromium] › tests/ui/responsive.spec.ts:932:5 › §7 P5 additions: the ⌘K palette fits every breakpoint › 375px: the palette is centred and inside the viewport (676ms)
  ✓  468 [chromium] › tests/ui/responsive.spec.ts:932:5 › §7 P5 additions: the ⌘K palette fits every breakpoint › 768px: the palette is centred and inside the viewport (688ms)
  ✓  469 [chromium] › tests/ui/responsive.spec.ts:932:5 › §7 P5 additions: the ⌘K palette fits every breakpoint › 1440px: the palette is centred and inside the viewport (833ms)

  469 passed (2.4m)
```

## Tier-2 screenshots (repo chromium, mocked tier-1 style stack on :5181, never 3001/5173)
- docs/evidence/phase-8/p8-title-dropdown.png — Info tab, picker open, search "bear" matching the title half, options as pairs, None entry.
- docs/evidence/phase-8/p8-catalog-search.png — /quests/catalog, search "gr", count line "Showing 1 matching “gr”" under an unchanged coverage header.
- docs/evidence/phase-8/p8-drop-table-link.png — Results tab, known drop table linked, unknown one plain text.
375px no-overflow is asserted by two permanent tier-1 tests (catalog with a search applied; title picker open).
