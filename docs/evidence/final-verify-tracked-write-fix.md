# final-verify — the tracked-write fix, verified with the sensitive instrument

**Verdict: PASS, and the fix is proven by the instrument the defect hid from — not by `git status`.**

- `HEAD` throughout: `f7e7004f3b36a01f113fc3355c72ba4df1e96f02` (`main`).
- The fix under test: `tests/ui/a11y-reduced-motion.spec.ts` now writes its six screenshots to
  **`test-results/a11y-reduced-motion/`** (`git check-ignore -v` → `.gitignore:24:test-results/`)
  instead of the **tracked** `docs/evidence/phase-5/`.
- Raw output: [`final-verify-tracked-write-fix.txt`](./final-verify-tracked-write-fix.txt)
  (four transcripts: the experiment, the negative control, and the two restore passes).

## Why `git status` could not decide this

The previous executor measured it: an official run rewrote those six PNGs with **byte-identical
content**, so only **mtimes** moved. Git compares content, so a clean `git status` was consistent
with the defect and with its absence. A gate that accepted `git status` here would have accepted
the weak evidence for the strongest claim.

The instrument used instead is **mtime (nanosecond) + sha256 + path**, over **all 79 tracked files**
under `docs/evidence/phase-5/` (`git ls-files docs/evidence/phase-5/ | wc -l` → `79`), with
`find docs/evidence -newermt @<run-start>` as the independent "was anything under `docs/evidence/`
written at all" probe.

## 1. The fix holds — solo run

| step | result |
|---|---|
| before-snapshot of the 79 (mtime + sha256 + path) | 79 lines |
| the gitignored target cleared first (`rm -rf test-results/a11y-reduced-motion`) | absent (`rc=2`) |
| `npx playwright test tests/ui/a11y-reduced-motion.spec.ts` | **6 passed (11.7 s), rc=0** |
| the six PNGs | present in `test-results/a11y-reduced-motion/`, mtimes `02:02:01`–`02:02:06` |
| `find docs/evidence -newermt @1790575314` | **no lines** — nothing under `docs/evidence/` was written |
| after-snapshot vs before-snapshot | **IDENTICAL** (`diff rc=0`) — no mtime moved, no hash changed |
| all 79 hashes alone | **IDENTICAL** |
| `git status --porcelain docs/evidence/phase-5/` / `git diff --stat HEAD --` | both empty |

## 2. The fix holds — the **full official suite**

`npm run test:ui` (run A1, 392 passed / 1 failed — the carried extraction-toast family, see
[`final-verify-suites.md`](./final-verify-suites.md)) was wrapped in the same probe:

| step | result |
|---|---|
| `find docs/evidence -newermt @<run-start>` after the whole suite | **no lines** |
| 79-file snapshot before vs after | **IDENTICAL** |
| `git status --porcelain` after the suite | exactly the two authored files `M`, plus the known untracked evidence |

So "the suite writes committed evidence" is false now, on both the narrow and the full instrument.

## 3. The instrument is **sensitive** — the negative control

The one remaining audit objection — "you never showed the instrument would notice a write at all" —
is closed by re-creating the defect in a throwaway copy of the same spec: `tests/ui/zz-fv-mtime-negctl.spec.ts`
was the fixed spec with **only** the output path reverted (line 62 back to
`` `docs/evidence/phase-5/${name}` ``), run solo. Nothing else changed.

| file (of the six tracked PNGs) | mtime | content |
|---|---|---|
| `p5-05-reduced-motion-sidebar.png` | **MOVED** `01:07:32` → `02:02:27` | hash `88e89c33…` **equal** |
| `p5-05-reduced-motion-panel-mid-noreduce.png` | **MOVED** `01:07:34` → `02:02:29` | hash `563e66fb…` **equal** |
| `p5-05-reduced-motion-panel-mid-reduce.png` | **MOVED** `01:07:34` → `02:02:29` | hash `563e66fb…` **equal** |
| `p5-05-reduced-motion-panel-after-reduce.png` | **MOVED** `01:07:34` → `02:02:30` | hash `563e66fb…` **equal** |
| `p5-05-reduced-motion-flowchart-before.png` | **MOVED** `01:07:35` → `02:02:31` | hash `27bed5bb…` **equal** |
| `p5-05-reduced-motion-flowchart-after.png` | **MOVED** `01:07:36` → `02:02:31` | hash `a551f172…` **equal** |

and, on the very same event:

```
$ git status --porcelain docs/evidence/phase-5/     # EMPTY
$ git diff --stat HEAD -- docs/evidence/phase-5/    # EMPTY
```

That is the whole claim in one table: **the instrument sees the write, the hashes do not, and git
does not.** Six mtimes moving is a false negative `git status` cannot produce.

## 4. The control was cleaned up, and the tree re-verified

- the scratch spec deleted (`ls tests/ui/zz-fv-mtime-negctl.spec.ts` → no such file);
- the six mtimes restored to their recorded nanosecond values (`touch -m -d @<epoch.ns>`);
- **all 79 files then compared to the pre-experiment snapshot: IDENTICAL** (mtime + sha256 + path);
- `git status --porcelain docs/evidence/phase-5/` and `git diff --stat HEAD --` still empty.

Restoring mtimes is cosmetic — git does not track them — and it is recorded rather than silent: the
first restore pass used a wrong field split (`touch: invalid date format`) and was re-run from the
precise snapshot; both passes are in the raw transcript.

## What the fix is and is not

- **Is**: the six screenshots now land in a gitignored directory, so a run stays inspectable and
  cannot reach a commit.
- **Is not**: a `gitignore` of committed history. `docs/evidence/phase-5/` is **not** ignored
  (`git check-ignore` exits 1 for it), the six committed PNGs stay committed, and every one of the
  79 tracked files still matches its `HEAD` blob byte-for-byte.
- The fix is a **working-tree change**, not a commit (D84(a)); `git status` lists
  `M tests/ui/a11y-reduced-motion.spec.ts` alongside `M server/src/services/git.ts`.

## One honest limit

The negative control *did* rewrite the six tracked PNGs. Their content came out byte-identical
(that is the finding), and their mtimes were restored, so the directory is as found — but the
controlled rewrite happened, and only the recorded snapshots prove it left nothing behind. A
verifier who distrusts restored mtimes can re-run the control; the transcript contains both
snapshots.