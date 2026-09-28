# final-verify — the suites, one run at a time

A single number hides exactly what this gate exists to see: which runs happened, on which tree,
and which carried family fired. Raw logs:
[`final-verify-ui-runs.txt`](./final-verify-ui-runs.txt) (A1 + A2 + the isolated arm),
[`final-verify-p5.txt`](./final-verify-p5.txt) (U1 + U2 + the per-step P5 transcripts),
[`final-verify-findings-raw.txt`](./final-verify-findings-raw.txt) (F1 red, F2 green).

The tree the runs measured is named per row, because the working tree changed mid-sweep
(four uncommitted fixes; `HEAD` is `f7e7004` in every row — nothing is committed, D84(a)).

| # | run | tree | command | result |
|---|---|---|---|---|
| **P-A** | predecessor, full UI suite (cited, not mine) | `HEAD` + the git.ts/a11y fixes | `npm run test:ui` | 393 passed (2.1 m), rc=0 |
| **P-B** | predecessor, full UI suite (cited) | same | `npm run test:ui` | **392 passed, 1 failed** (2.2 m), rc=1 — `extraction.spec.ts:828` (the D14 dirty-tree arm) |
| **P-B′** | predecessor, that arm alone (cited) | same | `-g` the arm | 1 passed |
| **U1** | unit | `HEAD` + git.ts/a11y fixes | `npm test` | **67 files / 1472 tests passed**, rc=0, 9.88 s |
| **A1** | **full UI suite** | `HEAD` + git.ts/a11y fixes | `npm run test:ui` | **392 passed, 1 failed** (1.9 m), rc=1 — `extraction.spec.ts:777` |
| **A1′** | A1's failing arm **alone** | same | `npx playwright test tests/ui/extraction.spec.ts -g 'one toast per quest'` | **1 passed (8.8 s)**, rc=0 |
| **T3** | the tracked-write probe, solo spec | same | `npx playwright test tests/ui/a11y-reduced-motion.spec.ts` | 6 passed (11.7 s), rc=0 |
| **T6** | the negative control (old output path, scratch spec) | same | same spec, path reverted | 6 passed (7.5 s), rc=0 — and the six tracked PNGs' mtimes **moved** while their hashes stayed equal |
| **F1** | the ZoneTransfer instrument, **red** | + real-shaped mock, **no** CSS fix | `npx playwright test tests/ui/responsive.spec.ts -g '20 routes'` | **✘ 1 failed (5.4 s)** — `Expected: <= 375, Received: 839` |
| **F2** | the ZoneTransfer instrument, **green** | + real-shaped mock **and** `break-all` | same | **✓ 1 passed (39.8 s)** — 20 routes × 8 widths |
| **R1** | tier-2 live rig (P4-2/P4-3) | rig server on `:3001` + the real D17 clone | `npx playwright test --config tests/ui/p4-09-live.config.ts` | **2 passed (2.3 s)**, rc=0 |
| **U2** | unit, on the **restored** 322-era clone | `HEAD` + all four fixes | `npm test` | **67 files / 1472 tests passed**, rc=0, 9.03 s; prints `328 real + 322 clone files` |
| **A2** | **full UI suite, final tree** | `HEAD` + all four fixes | `npm run test:ui` | **393 passed (2.0 m), rc=0** |

## The carried families, attributed

1. **The extraction toast/pointer overlap — fired once (A1), at `extraction.spec.ts:777`.** The
   mechanism is verbatim in the log: a sonner `li[data-sonner-toast][data-type="info"]`
   (`border-l-4 border-l-blue-500`) sits over the **Save All to SpiralDB** button, so the click
   retries (`112 × waiting for element to be visible, enabled and stable`) until the 60 s test
   timeout. **Run alone, the same arm passes in 8.8 s** — so it is order-dependent, not
   deterministic. The predecessor's run B hit the same family at `:828` (the D14 dirty-tree arm) and
   its isolated re-run also passed. **Not patched** (the brief's rule) and **not double-counted**.
2. **The drag/spec false red — did not fire** in any run of this sweep.
3. **The 60 s filechooser wait — did not fire.**
4. **A dev-stack death — did not fire.** One benign line appears in F1's log,
   `[vite] http proxy error: /api/status/_import … ECONNREFUSED`: that is the harness's readiness
   poll landing before Express bound, and the run proceeded normally. It is *not* a dev-stack death
   and was **not** discarded-and-re-run, because nothing failed.

## The two full-suite runs measure different trees, deliberately

- **A1** is the tree as inherited: the predecessor's two fixes (the tracked-write path and the
  code-point note cap). 392/393 with the carried family firing.
- **A2** adds this sweep's two ZoneTransfer fixes (the `break-all` CSS and the real-shaped
  responsive mock) and is **393/393, rc=0** — so the mock change that makes §1 bite, and the CSS
  that satisfies it, do not disturb any other spec.

## The tracked-write probe around both full runs

Both A1 and A2 were wrapped in the 79-file probe (mtime + sha256 + path) plus
`find docs/evidence -newermt @<run-start>`:

| run | `find docs/evidence` writes | 79-file snapshot |
|---|---|---|
| A1 | **none** | **IDENTICAL** |
| A2 | **none** | **IDENTICAL** |

That is the strongest form of the tracked-write claim: not "the solo spec is clean", but "the full
official suite leaves all 79 committed evidence files untouched, mtimes included". Detail:
[`final-verify-tracked-write-fix.md`](./final-verify-tracked-write-fix.md).

## What was **not** run, and why

- `npm run test:ui` in CI (the GitHub `ci` workflow). The gate-5 run of `ci` is a citation
  ([`final-verify-p5-process-clause.md`](./final-verify-p5-process-clause.md)); this sweep has no
  runner, so it re-ran the same command locally instead.
- The `p4-10-altport.config.ts` alt-port rig. Its `baseURL` is a second config over the same
  tier-1 mocks; the tier-1 suite and the tier-2 `p4-09` rig between them cover the same assertions,
  and neither needs an alt port here.
- The p5-09-authored full 5.8 fresh-clone walkthrough (see
  [`final-verify-report.md`](./final-verify-report.md) P5-6 for the bounded re-run that stands in
  for it).