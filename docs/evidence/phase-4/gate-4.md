# gate-4 — Phase-boundary regression gate (Phases 1–4 suites re-passed; Phase 4 PR merged)

`docs/plan-phase-4-object-editors.md`'s **14 acceptance criteria** + `docs/plan-overview.md`'s regression gate:
**all Phase-1, Phase-2, Phase-3 and Phase-4 checkboxes re-run fresh** with raw outputs, then the phase PR
opened, CI polled to green, merged via the GitHub MCP, the branch deleted and the merge logged.

- **Head at the gate**: `f32623e` on `phase-4-object-editors` (23 commits ahead of `main` = `9e9c607`).
- **Raw re-run**: [`gate-4-acceptance.txt`](./gate-4-acceptance.txt).
- Every Phase-4 story's own evidence stays in this directory (`p4-01` … `p4-10`, `p4-79-*`, `p4-10-*`).

## 1. What was re-run fresh

| Group | Command | Result |
|---|---|---|
| A. Phase 1–4 unit suites | `npm test` | **57 files / 1,311 tests** passed |
| B. Phase 1–4 tier-1 UI suites | `npx playwright test --config tests/ui/p4-10-altport.config.ts` | **299 passed** (the alt-port config — see §4) |
| C. Corpus round-trip audit | `npm run audit:corpus` | **181/322** verified through the real reader, 0 failures — it measures the **deliberately frozen D17 clone** (D80(c)), not the owner's fork |
| D. Capture-chain verification | `npm run verify:captures` | 5 fixtures, **50/50** field checks, 0 mismatches |
| E1–E5 | lint · `typecheck:tests` · `tsc` server · `tsc` client · build | all clean |

Two configurations are named deliberately: the **official** `npm run test:ui` cannot boot on this host
because a sibling checkout (the owner's other project, `card-gatcha-1`) holds `[::1]:5173` and
`playwright.config.ts` sets `reuseExistingServer: false` — and **that project is not ours to kill**
(D78(b)). `tests/ui/p4-10-altport.config.ts` differs only in the client port and the matching `baseURL`
(same `testDir`, default `testMatch`, single chromium project, same throwaway DB), so it collects the
official set. CI is unaffected: it runs on a runner where 5173 is free.

## 2. The 14 Phase-4 acceptance criteria

| # | Criterion (abridged) | Evidence |
|---|---|---|
| 1 | List pages load real corpus counts (317/215/77/134/1/1207) and NpcDropTable's empty state | p4-09 (a hermetic arm per list page + an in-process rig-free `listObjects` authority). The two units are stated: **1,207 files / 1,205 list rows** for ZoneTransfer, because two `ZoneName` keys are shared and D19's index collapses each pair first-file-wins |
| 2 | Per tracked type: edit one field → the clone's diff shows **only that field**, the exact `update` subject, and the **original legacy path** | p4-09's live sweep — **6 families, 168 checks, 0 failures, commits 42 → 56 exactly +14**, on the original legacy paths (including the **unprefixed UUID** NpcSpellInventory file), with a falsification arm that reproduces the p4-08 defect class |
| 3 | Per type: **create via UI** → the convention name (incl. slash→underscore and singular `droptable_`), `create` action, `extracted` + a history note | p4-09 — all 7 keyed families created live with exact names (incl. the directory bootstrap), plus 2 tier-2 browser arms driving the built client |
| 4 | Round-trip corpus tests extended (317 DropTables, …) with per-type counts vs `ls \| wc -l` | p4-09's AC4 sweep — discovered == listing == round-tripped, 0 failures, **0 unclassified bytes**, two named normalisations, falsification arms |
| 5 | DropTable validation blocks (Name empty/duplicate, RollChance, NoneChance, MinGold ≤ MaxGold) → inline + disabled Save + **server 400** | p4-02 (12 in-process route tests + 16 tier-1 arms) **plus the lead's own live reproduction**: 400 with a per-field map, clone untouched |
| 6 | A DropTable item's requirement tree via the **inline** editor, reloading identically | p4-02 — the shared `RequirementTreeEditor` mounted per row; a pre-existing untyped wrapper stays untyped |
| 7 | The `ItemId` dropdown auto-fills the read-only `ItemName` | p4-02 — one canonicaliser; the measured 64/72 numeric vs 0/72 raw trap; 8 named misses stay raw |
| 8 | NpcDropTable: the first save creates the directory + the file | p4-04 — **proven live twice** (the executor's `5795700` and the lead's `8a2dc62`), with the directory absent again after restore |
| 9 | TemplateID round-trip: ulong keys as strings in `entry_status.object_key` resolve to the JSON number | p4-01 — one helper both directions, live per ulong-keyed family (215/77/0/1) and over HTTP with a padded route key |
| 10 | GlobalRegistry: the merged view equals the manual merge; one commit with the new file **and** the deletion | p4-07 — proven live (one commit 42→43, the same commit's tree is `A` + `D` under `--no-renames`), the delete list restricted to files the merge accounted for |
| 11 | TreasureCardInventory: an unknown `SpellName` → **warning, not blocking**; Save succeeds | p4-05 — the real file yields 71 warnings with `blocked: false`, the converse pinned, and the TC-suffix question exposed as an owner decision |
| 12 | Status flows: Mark Reviewed with notes on a DropTable → history endpoint + list dot + filter counts | p4-08 — asserted hermetically **and** driven live by the lead (history row with the note, the row's status, the recomputed summary) |
| 13 | Mobile (≤768px) pass with screenshots: card lists, usable forms, a full-overlay JSON panel | p4-10 — every visual claim is a DOM/geometry assertion; **three real 375px overflows found and fixed**; 22 screenshots each tied to an assertion; the lead's own viewport check confirms cards/no-table, no overflow, and the overlay at 375×800 |
| 14 | `tests/ui/object-editors.spec.ts` passes headless for ≥2 representative types | p4-10 — DropTable + NpcInventory chains, the badge claim proven by **zero status requests**, four falsification breaks (one of which proved a `toHaveCount(0)` line vacuous) |

## 3. Flagged in the PR, as the plan requires

1. **The owner's corpus moved under the run** (D79/D80): the fork is `f9a1055` with **328 quests** where the pins said 322, **two assembly-qualified `$type` strings** the table had never carried, an enriched dialog entry across six key shapes (two entries with **no `$type`**), a result type the corpus has but a create would not (`ResActorDialog`, `corpusOnly`), three **prose** `m_destinationLoc` values, and a **reformatted** corpus (JSON5 306→21). The constants and models were **extended** and every pin re-measured from a fresh sweep; the database was re-synced deliberately (only `quests` 322→328 moved); the D17 clone stays frozen at 322-era and sweeps count both corpora separately.
2. **D74 was amended by measurement**: the zone `m_destinationLoc` format rule is now a **warning** that cannot disable Save, because the three prose values falsify D74's premise that a zero-violation rule cannot trap a real file.
3. **CI cannot run the corpus sweeps** (D53): `data/` is gitignored and no runner has the sibling checkout, so every owner-run arm **skips** there — which is also why this drift was invisible to CI and visible only locally.
4. **`npm run audit:corpus` measures the frozen clone** (181/322), not the owner's fork, so its number is a fixture audit rather than a statement about the 328-quest corpus.
5. **Two flake classes, handled rather than hidden**: the unit suites' load-sensitive budget was raised to 30 s (D77(a)) with every assertion untouched, and p4-08's racing request-count assertion was **removed with its reason** (D78(c)) while its AC's end-state claim stays asserted. The remaining attributable intermittent is `extraction.spec.ts`'s toast family (D69(h)), carried by name.
6. **The official `test:ui` cannot run locally while the owner's other project holds 5173** (D78(b)); the authorized alt-port config is the substantive run, and CI is unaffected.
7. **A family whose server side makes no claim**: ZoneTransfer's format rule is client-only (p4-06), stated rather than equalised with DropTable's.
8. **GlobalRegistry is editor-only** (Q1): absent from `StatusObjectType`, from the routes and from the dashboard totals — asserted, including against a stray row.