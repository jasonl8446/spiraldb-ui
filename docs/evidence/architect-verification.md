# Close-out verification — Phase 6 (and the whole run), ralph Step 3

**This document supersedes the previous run's `architect-verification.md`**, which described Phases 1–5 on a
`main @ 1bac35c` tree. This run built **Phase 6** (12 stories), closed it with `gate-6`, and then ran the
three `final-*` gates; the same independent close-out requirement applies to all 76 stories, and the verdict
below is the one this run earned.

## The verdict

**`SIGN-OFF APPROVED`** — third of three attempts. The first two **refused**, and both refusals were
**scoped to the durable record, not the software**: every product/acceptance claim the verifier sampled
reproduced exactly, all seven gates behaved as recorded, and both pins held. What it would not accept was
where the run wrote its own history:

1. **Refusal 1** found that `p6-07` had **no committed evidence artifact** while its ledger row cited a
   report not in the repo (a **D92** violation), plus two harness gaps found later by the review gates.
   Fixed by committing the lead's own live captures as `p6-07.md`, each quote **pinned by sha256 + byte
   size**.
2. **Refusal 2** found the four merges **not tabulated** (my Phase-6 row had landed in the *2-column*
   milestone table instead of the 6-column phase log — where its extra cells would not even render), a
   **duplicated `D117–D123` tail** with a second `## Related Documentation`, and **my own "14 named
   deviations" against an artifact with 15 rows**. Fixed; the re-verification then showed the rows were
   *relocated* rather than fixed, and that my "142 classes" annotation had been **injected inside three
   quoted stdout lines**, breaking the transcripts' verbatim status (**D92** again).
3. **Refusal 3 → approval.** The two refused items were re-checked with the predecessor's own instruments,
   and the approval paragraph below is the verifier's own, quoted.

## The approval, recorded raw (the verifier's paragraph)

> I verified, with fresh instruments and their raw output, that the four merge rows now live in the
> 6-column phase-log table as 7 well-formed data rows with the milestone table back to five and the prose
> naming the right table; that every PR number, CI run id, merge sha, job id and job duration they claim
> reproduces exactly against `git log origin/main --merges` and the GitHub API, including that PR #9's
> first run was the pointer-drag failure fixed by `b53a57a`; that the deviations count reads 15 in the
> artifact, the ledger field and the run log's correction entry; that D117–D124 sit inside
> `## Cross-cutting decisions` contiguous with D116; that p6-03's quoted census stdout is byte-identical
> to its pre-injection state (proven against `46200cb` with the `9aa1e23` injection as the negative
> control); that a scratch-DB sync still reproduces the coverage view exactly; and that both pins are
> exact and untouched. My approval does **NOT** cover: the two immutable commit bodies (`46200cb`,
> `999392e`) which permanently say "14 named deviations"; the stale round-17 `ralph-state` note (still
> saying 14 — do not propagate it before `state_clear`) and the round-16 append-only log entry that the
> same log corrects; the two cosmetic record nits above (the unescaped pipe in `final-verify.md`'s P6-5
> row and PR #8's absence from the phase-log); and any product surface beyond the one cheap coverage
> re-sample — the tier-1/tier-2 suites and the live-loadability clause remain covered only by the
> predecessor's evidence, not by this verification.

## What the three verification rounds actually re-ran (so the approval has a footprint)

The close-out work spans three independent roles beyond the stories' own evidence: a **fresh-context code
review** (found and forced the fix of a *blocking* evidence gap and four harness defects), the **verification
pass** (re-ran every phase's Verification Steps — ~40 steps — and found two real defects no unit test could
see), and **two close-out verifications** that re-derived the load-bearing numbers themselves:

| claim | re-derived result |
|---|---|
| WAD index | 3,589 WADs / 550,616 entries / 0 parse errors / 6,733 selected / `indexEnd == bytesRead` |
| class census | 183,676 objects in **141 distinct classes** (142 shape-class rows); **`QuestTemplate` absent** |
| zone extract | 6,733 rows in 4.4–5.3 s, `{WizZoneData: 3356, WizZoneTriggers: 3377}`, 0 failures |
| coverage view | `{1717, 4823, 322, 1395, 2855}`, and the same sync **without** `NODE_ENV=test` reads the fork (328) — the number tracks its corpus |
| corpus key order | 320 files × 36 keys / 2 × 18 keys |
| the insert contract | the string-table **KEY** is written, exactly **one leaf** changes, the row's text appears nowhere |
| loadability | **live**: `SpiralDB loaded … 322 → 323 quest templates`, delta exactly 1, seven other families equal, clone restored on all seven axes |
| gates | `npm test` 90 files / **1,847 passed**; tier-1 **418 passed**; lint, both typechecks, both builds rc=0 |
| pins | live DB `a13f9aa8…` (never opened); clone `content/2026-09-27` / `18dc924` / `f3f8b5c` / 42 / porcelain 0 / **322** / three branches |

Its only reds were **carried rotating tier-1 arms** (`a11y-keyboard.spec.ts:221` passes 3/3 alone; the
pointer-drag arm the run had fixed at gate-6 did not reproduce at all), i.e. environmental, not Phase 6.

## Carried, for the owner (nothing here is hidden in a log)

1. **`data/spiraldb-ui.db` is pinned pre-migration-0002.** It has **no `coverage` view and no
   `quest_ids`/`quest_catalog_refs`** — the Phase 6 catalog tables — so any run of the app against it will
   migrate it and break the pin. The coverage numbers live in a **synced scratch** database. The pin's
   meaning stops at "the owner's file exactly as they left it"; the deliberate migration is an owner action.
2. **The loadability harness writes its raw logs into the committed evidence directory by default**, so
   re-running that gate **rewrites committed artifacts** — in tension with this run's "annotate, never
   rewrite" rule. The default path should move before the gate is ever re-run.
3. Two **immutable** commit bodies (`46200cb`, the merge `999392e`) permanently say "14 named deviations"
   where the artifact has 15; and `PR #8` (the previous run's closing work) is absent from the phase-log
   table, which lists phase and final-gate merges only.
4. `settings.user_name` was seeded (`DeepSeek Harness (phase-6 run)`) because the save pipeline rejects an
   empty author; and the owner's **dev server was stopped** during the p6-05 incident (a worker killed the
   watcher) — restarting it is the first item owed back to them.

## Evidence index

- Per-story: `docs/evidence/phase-6/p6-01.md` … `p6-12.md` (+ their raw `.txt`/`.json`/`.png` sidecars),
  and `docs/evidence/quest-catalog-findings.md`.
- Per-gate: `docs/evidence/final-deslop-d1-disposition.md` / `-d2-cleanups.md` / `-d3-proof.md`,
  `docs/evidence/final-review.md`, `docs/evidence/final-verify.md` (and its raw artifacts).
- Decisions: `docs/plan-overview.md` **D96–D124**, plus the phase-log table with all four merge rows.
