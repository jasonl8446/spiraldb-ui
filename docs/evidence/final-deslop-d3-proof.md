# final-deslop D3 — the proof and the gate

Story: **final-deslop / Ultragoal final gate 1/3**, AC1. Tree: `main` @ `1bac35c` + this story's
working-tree edits. **Nothing committed** (the lead commits — D84(a)); every git command below is
a read.

Raw transcripts, copied out of `/tmp` so they survive the scratch dir:

| file | what it is |
|---|---|
| `final-deslop-gate-npm-test.txt` | the full unit suite |
| `final-deslop-gate-lint.txt` | eslint + prettier |
| `final-deslop-gate-tsc-build.txt` | `typecheck:tests`, both tscs, `npm run build` |
| `final-deslop-gate-test-ui.txt` | the full tier-1 UI suite |
| `final-deslop-touched-unit-batch.txt` | the 35 unit suites covering the modules this story edited |
| `final-deslop-touched-quests-goals-editor.txt` | the one UI spec this story edited, in isolation |
| `final-deslop-f1-default-build.txt` | F1: the owner-layout default path |
| `final-deslop-f1-override-build.txt` | F1: the override against a real Imview copy elsewhere |
| `final-deslop-f1-negative-control.txt` | F1: the override pointed at a nonexistent root |

---

## 1. The six checks + `test:ui`, every `rc` captured on the command itself

Every `rc` below is `$?` of the command, written by the command, **never** read off a pipeline's
tail (the bug that once made a transcript read as seven zeros while a suite had failed). The
commands were run **sequentially** — this repo's suites are load-sensitive (D77(a)), so I did not
overlap them with each other or with the .NET builds.

| # | command | rc | result |
|---|---|---|---|
| 1 | `npm test` | **0** | **67 files / 1462 tests passed**, 9.23 s |
| 2 | `npm run lint` | **0** | `eslint .` clean; `prettier --check .` → *"All matched files use Prettier code style!"* |
| 3 | `npm run typecheck:tests` | **0** | 0 errors |
| 4 | `npx tsc -p server/tsconfig.json --noEmit` | **0** | 0 errors |
| 5 | `npx tsc -p client/tsconfig.json --noEmit` | **0** | 0 errors |
| 6 | `npm run build` | **0** | `✓ built in 4.88s`; `index-gkArYIre.js` **769,126 B** (gzip 226.69 kB), `QuestGoalLogicEditor-DCmGuEjo.js` 293.61 kB, `index-DBhfluGC.css` 36.09 kB, `QuestGoalLogicEditor-BnuhLJ6X.css` 15.87 kB, `dist/index.html` 0.51 kB |
| 7 | `npm run test:ui` — **no `--config`** | **0** | **393 passed** (2.6 m), 0 failed, 0 flaky, 0 skipped |

**No retries were configured locally** (`retries: process.env.CI ? 1 : 0`), so "393 passed" means
393 first-attempt passes. The webServer booted the isolated stack on **5181** (the D84(c) port we
own) — `reuseExistingServer: false`, readiness probe `/api/status/_import`. Ports 5181 and 3001 were
verified free before the run; the owner's sibling held `[::1]:5173` and **was not touched** (D77(b):
another project's process is not ours to kill, and the harness does not use that port).

**On the bundle number, without spin:** p5-08 recorded `index-NmSPrSJ5.js` at 769,166 B, so this
build is **40 B smaller**. That is noise-level on a 769 kB bundle — the deletions here are small
dead code, not a p5-08-sized stub removal. I am not claiming a material size win.

## 2. Every touched suite, named, with its `rc`

"Touched" is the operative word, so both directions are named: the suites this story **edited**,
and the suites that **cover the modules it edited**.

| suite | touched how | rc | result |
|---|---|---|---|
| `tests/unit/ui-shell.test.ts` | **edited** — the new F2 regression lock (5 arms on `shouldAnnounceImport`, incl. the arm the old module flag could not satisfy) | **0** | in the 35-file batch below, and in `npm test` |
| `tests/ui/quests-goals-editor.spec.ts` | **edited** — the pointer-drag poll's budget raised to 30 s (D77(a)) | **0** | **13 passed** (15.4 s), isolated |
| 35 unit suites covering every module edited (validation-message, drop-table/quest validation, spiraldbFiles, objects, quests, objectTypes, quest-dialog, quest-goal-logic, quest-results, npcSpellInventory, typeConstants, dialog, ulong, FieldValidation, api, routes, db, import) | **not edited** — re-run because their modules changed | **0** | **35 files / 873 tests passed** (7.82 s) |
| all 67 unit suites | superset of the above | **0** | **1462 tests passed** |

Because the strongest statement available is the superset, the headline is: **every unit suite in
the repository passes (`npm test` rc=0, 67/67 files), and the one UI spec this story edited passes
in isolation (`rc=0`, 13/13) and inside the full UI run (`rc=0`, 393/393).**

## 3. F1's proof — the default still builds, and the override is real

**(a) The owner layout still builds green** (`docs/evidence/final-deslop-f1-default-build.txt`):

```
> npm run build:cli
  Build succeeded.
    12 Warning(s)
    0 Error(s)
  Time Elapsed 00:00:06.87
build:cli rc=0
```

The 12 warnings are pre-existing `NU1900` vulnerability-data warnings caused by the **agent-sandbox
denying writes to `~/.local/share/NuGet/http-cache`** — they appear identically on the untouched
tree and on every historical transcript (p5-09's own logs), and they are not this change's.

**(b) The override genuinely works** (`final-deslop-f1-override-build.txt`) — Imview's sources were
copied to a completely different absolute path (`rsync -a --exclude=.git --exclude=bin --exclude=obj
… /tmp/final-deslop/Imview-copy/`, `copy rc=0`), and `PacketReaderCli` was built against it:

```
  Restored /tmp/final-deslop/Imview-copy/src/Imview.PacketReader/Imview.PacketReader.csproj (in 2.06 sec).
  Build succeeded.
    0 Error(s)
  Time Elapsed 00:00:20.22
override-build rc=0
```

The log names the **copy's** project path, so the build really read the override, not the sibling.

**(c) The negative control proves the property is consumed at all**
(`final-deslop-f1-negative-control.txt`) — pointing the override at a nonexistent root must break
the build, and it does, naming the **override** path:

```
warning MSB9008: The referenced project /tmp/final-deslop/no-such-imview/src/Imview.PacketReader/Imview.PacketReader.csproj does not exist.
… error CS0246: The type or namespace name 'Imcodec' could not be found …
Build FAILED.
negative-control rc=1
```

Together: (b) shows a real Imview elsewhere builds, (c) shows the reference is no longer a literal
(the hardcoded `../../../Imview` string is gone from both csproj files — the reference resolves to
whatever `$(ImviewRoot)` says). **Both `build:cli` shapes were run in full, twice** — 6.87 s
incremental for the default, 20.22 s for the override — so no "too slow to run twice" caveat is
needed. `p5-09`'s failure mode (`MSB9008` + 3 × `CS0246`, `build:cli rc=1` on a clone with no
sibling) cannot recur: the sibling is now an overridable input.

## 4. The PNG hard rule — verified, not trusted

p5-08 gave the mobile spec a gitignored output directory. **Verified after a full `npm run test:ui`
run on the settled tree:**

| check | result |
|---|---|
| `git status --porcelain docs/evidence/` | **only** `?? docs/evidence/final-deslop-d1-disposition.md` (this story's own file). Nothing else — no modified PNG. |
| `git diff --name-only -- docs/evidence/` | **0** |
| per-file `cmp <(git show HEAD:<path>) <path>` over **every** committed PNG (98 of them) | **identical-to-HEAD = 98, differs = 0, missing = 0** |
| whole-tree `git status --porcelain` | 25 paths = this story's 22 modified files + 1 modified spec + 2 new files. The run added **nothing**. |

The mechanism is confirmed rather than merely inferred: the run wrote **22 screenshots** into
`test-results/object-mobile/` (`p4-10-*.png`), and `test-results/` is gitignored
(`git check-ignore -v test-results/object-mobile` → `.gitignore:24`). So a full run regenerates them
where a commit cannot reach, **and** the committed `docs/evidence/**/*.png` are untouched. **The
churn is not back.**

## 5. The four carried intermittent families — attributed, not patched

| family | this round |
|---|---|
| `extraction.spec.ts`'s toast/pointer-overlap family | **did not fire** (the full run had 0 failures). **Carried**, unpatched, by name. |
| `quests-goals-editor.spec.ts:511` — a 10 s poll for a 13.7 s operation | **directly addressed** (D77(a)'s budget raise, the one cleanup the story authorises for this family): the poll now carries `{ timeout: 30_000 }`, assertion unchanged. Passed **1.1 s** in isolation and inside the full run. Note the honest reading: it needed the budget at peak load, not this round, so the fix rests on the recorded measurement. |
| `a11y-keyboard.spec.ts:221` — a 60 s filechooser wait | **did not fire**. **Carried**, unpatched. |
| a dev-stack-death run | **did not occur** — `test:ui rc=0` with no environmental red, so nothing was discarded and nothing had to be re-run. |

## 6. The claims I am *not* making

- **The pass is not over the whole diff.** It is over the **311 authored-code files** (scope and the
  two exclusions stated in D1 §0). It says nothing about the 42,466 lines of `docs/` prose,
  `package-lock.json`, or the 9 vendored `components/ui/` primitives.
- **F2 is not fully fixed.** The module-level flag is gone and a second import is no longer
  swallowed, but the toast still re-announces **on a page load** — that needs a durable fact this
  app has no mechanism for (no client persistence at all). Recorded as debt (D1 item 16) with the
  smallest fix named, **not** papered over.
- **`StatusBadge`'s `aria-label` is not fixed** and, on measurement, should not be here: the axe
  finding is an **incomplete** (never a violation), the name is **inert**, and the coupling is
  **wider** than the record states — ≥9 locators across 7 spec files, not 4 sites in 3.
- **The 266 unconsumed client exports are counted, not cleaned.** Deleting `export` keywords
  repo-wide is a rewrite of module surfaces, not a bounded cleanup; D1 item 13 names the count and
  the method so a later pass can act deliberately.
- **Real duplication is left as named debt** in four places where a one-home fix would need a new
  module or a misplaced home (`describeError` ×2, `quoted` ×2, `describeValue` in a test helper,
  `isJsonFile` ×2). D1 items 17–19.
- **No `git` write happened.** Nothing is staged, committed, or amended; the lead commits.
- **Load caveat, stated plainly:** peak-hour load made the tree slow (the .NET builds took 6.87 s and
  20.22 s incremental; the UI suite 2.6 m). The runs above are the **settled** tree — the last edit
  to any source file preceded the first gate, and nothing was edited between the gates and these
  logs (D85(a): a gate measured against a tree a worker is editing is not a measurement).

## 7. Where the story's AC lands

AC1 asks for a pass with **dead code, duplication, boundary violations and slop patterns cleaned or
explicitly dispositioned**, **every touched test suite green afterwards**, and the **disposition
list recorded raw in evidence**. All three:

- **Disposition list, raw, with its scope stated:** `docs/evidence/final-deslop-d1-disposition.md`
  (21 numbered items + the boundary-class table).
- **Cleaned or dispositioned:** 6 cleanups (F1, F2's shape, 2 duplications, 15 dead symbols in 18
  edits, 1 load-sensitive budget) and 21 explicit dispositions, 12 of them debt with an owner and a
  named smallest fix.
- **Every touched suite green:** `npm test` rc=0 (67 files / 1462 tests), the 35-suite batch rc=0
  (873 tests), `tests/ui/quests-goals-editor.spec.ts` rc=0 (13/13), `test:ui` rc=0 (393/393), and
  the six checks rc=0 — with F1's default path, its override, and its negative control all run.