# p4-79 D3 — the gate

Six checks plus the tier-2 suite. Every `rc` is the command's own exit code (captured without a
pipe). Transcripts: `p4-79-gate-unit.txt`, `p4-79-gate-lint.txt`, `p4-79-gate-build.txt`,
`p4-79-gate-ui-altport.txt`.

| # | command | rc | result |
|---|---|---|---|
| 1 | `npm test` | **0** | **57 files passed · 1,311 tests passed** (1,309 before this task; +5 arms −3 fixture-driven arms) · 17.0 s |
| 2 | `npm run lint` | **0** | `eslint . && prettier --check .` — "All matched files use Prettier code style!" |
| 3 | `npm run typecheck:tests` | **0** | `tsc -p tests/tsconfig.json --noEmit` — clean |
| 4 | `npx tsc -p server/tsconfig.json --noEmit` | **0** | clean |
| 5 | `npx tsc -p client/tsconfig.json --noEmit` | **0** | clean |
| 6 | `npm run build` | **0** | server build + client `tsc --noEmit` + `vite build`; 2,322 modules; `✓ built in 2.98s` |
| 7 | `PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers npx playwright test --config tests/ui/p4-10-altport.config.ts` | **0** | **299 passed (1.1 m)** |

**Which config produced which run (D78b):** check 7 is the **alt-port** config
(`tests/ui/p4-10-altport.config.ts`, port **5181**), not the official `playwright.config.ts`. The
sibling checkout `card-gatcha-1` holds `[::1]:5173` and is not ours to kill, so the committed
config cannot boot its own server (D78b). The alt-port config differs from it **only** in the
client port; it keeps the same `testDir`, default `testMatch` and single chromium project, so the
collected set is exactly the official run's (all 34 `tests/ui/*.spec.ts`). Nothing was killed, no
other server was started, and the harness's own readiness probe
(`/api/status/_import` on 5181) is what proved the app under test was ours.

Two runs, in order, honestly:

1. The first tier-2 run was **298 passed / 1 failed**: `quests-dialog-editor.spec.ts:925` asserted
   the *old* user-visible sentence `null on all 1706 corpus entries`, which D1 re-measured to
   "null on all 1882 corpus entries that carry the key (of 1884)". The spec was updated (and its
   two other stale counts), and then
2. the second run is the **299 passed / rc=0** recorded above, with nothing skipped and no retry.

**Flakes:** none appeared in either run. The known load-sensitive arm
(`status-integration.spec.ts`'s AC1 refetch) is carried by name and remains gate-4's
(D77d/D78c) — it did not fire here, so nothing needed attributing.

**One side effect, stated:** the tier-2 specs write their mobile-pass screenshots into
`docs/evidence/phase-4/`, so the run rewrote six committed PNGs
(`p4-10-*-375.png`) with byte-different renders of the same screens. They are p4-10's evidence, not
this task's, so the binary churn was reverted (`git checkout --` on the six files) and the run's
transcript above is the record. The final change surface is 20 modified files (code, the recorded
fixture, and the two tier-2 specs) plus the seven `p4-79-*` evidence files; no temporary test or
scratch file is left in the tree, and the owner's fork is clean at `f9a1055`.

**What the gate is certifying:** the owner's `f9a1055` baseline is absorbed as a schema extension
(D1) plus re-measured pins (D2); `m_destinationLoc`'s format rule now warns instead of blocking
(D80a) with both sides still pinned; the tool's database was re-synced deliberately (D80b) and the
D17 clone was deliberately left at 322 files (D80c). No `$type` grep was weakened, no count was
hand-tuned, no corpus key was dropped to make a shape pass, and the owner's fork, the database
sync's blast radius, and the sibling project's port were all treated as the constraints they are.