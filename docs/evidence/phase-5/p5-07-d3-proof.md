# p5-07 D3 — the CI proof, the responsive validation, and the seven rc's

**Story:** p5-07 (plan task 5.7 + **P5 AC#13**), branch `phase-5-dashboard-polish`, HEAD `a22c86f`.
**Transcripts:** [`p5-07-gate.txt`](./p5-07-gate.txt) (every rc, on its own command),
[`p5-07-ci-condition.txt`](./p5-07-ci-condition.txt) (the CI condition, reproduced and measured),
[`p5-07-carry.txt`](./p5-07-carry.txt) (the three carried families, attributed).
**Executor note:** nothing was staged and nothing was committed (D84(a) — the worker's job is to
leave a settled tree, not to touch git).

---

## 1. (a) The CI condition — reproduced locally, and **measured** rather than assumed

The AC's decisive clause is "pass headless **in CI**", and CI is a different world: `data/` is
gitignored, so a runner has no `data/spiraldb-ui.db`, no `data/test-spiraldb` clone and no sibling
SpiralDB repo. The harness already boots an **empty `data/test-ui.db`** with
`SPIRALDB_UI_SKIP_IMPORT=1` (`playwright.config.ts`'s webServer command), so the one variable left
is the corpus path — and `SPIRALDB_PATH` overrides it per key (`server/src/db.ts:200-229`: an
explicit env var wins over the `NODE_ENV=test` clone default).

**How the condition was reproduced.** `mkdir -p /tmp/p507/empty-corpus` (verified empty: `ls -A`
→ 0 entries, no `QuestTemplates/` inside), then every run below was started as

```
rm -f data/test-ui.db && SPIRALDB_PATH=/tmp/p507/empty-corpus npx playwright test … --reporter=list
```

with each run's `rc` written into its own log by the same rule (`cmd …; echo "rc=$?"`).

| run | what | rc | result |
|---|---|---|---|
| **CI-condition, final tree** | `a11y.spec.ts` + `responsive.spec.ts`, corpus absent, fresh DB | **0** | **58 passed (1.4m)** — 17 a11y + 41 responsive |
| CI-condition, earlier tree | same env, before the final source state | 0 | 57 passed (1.0m) |
| **normal, for contrast** | `a11y.spec.ts -g 'corpus condition'` | 0 | 1 passed — the clone present |

**And the condition is asserted, not inferred.** The a11y spec's §4 arm asks the harness's **own
Express** — through Vite's proxy, via the `request` fixture, which `page.route` does not intercept
— what corpus it is reading, and asserts the invariant that ties the two readings together: *the
server's rows are exactly the corpus files at the path it reports.* Measured, both ways:

```
CI-condition:  {"envSpiraldbPath":"/tmp/p507/empty-corpus","servedSpiraldbPath":"/tmp/p507/empty-corpus",
                "templatesDirExists":false,"questFiles":0,"apiRows":0,"apiSkipped":1,
                "skipMessage":"ENOENT: no such file or directory, scandir '…/QuestTemplates'"}
normal:        {"envSpiraldbPath":null,"servedSpiraldbPath":"…/data/test-spiraldb",
                "templatesDirExists":true,"questFiles":322,"apiRows":322,"apiSkipped":0}
```

So the env override is *observed reaching the server* (same path on both sides), and the whole
suite above passed with **no corpus and no database file** — which is what a runner has. The
`apiSkipped: 1` on the empty side is the service's honest report of a corpus directory it could
not read (`readCorpusDir`'s error is pushed into `skipped[]`), not a swallowed failure.

**The mechanism, verified out of band.** A bare isolated server on a port I own (`PORT=5301`,
`SPIRALDB_UI_DB` pointed at a throwaway file, so the owner's database was never opened — the boot
line names the file it opened), probed only after `/api/health` answered:

| rig | `settings.spiraldb_path` | `GET /api/quests` |
|---|---|---|
| `SPIRALDB_PATH=/tmp/p507/empty-corpus` | `/tmp/p507/empty-corpus` | **0 rows**, 1 skip (`ENOENT … QuestTemplates`) |
| `SPIRALDB_PATH=data/test-spiraldb` | `…/data/test-spiraldb` | **322 rows**, 0 skipped |

Same binary, same DB variable, only `SPIRALDB_PATH` moved. Both rigs were killed by explicit PID
and `5301` was verified closed. Full transcript: [`p5-07-ci-condition.txt`](./p5-07-ci-condition.txt).

**What this does and does not prove, stated plainly.** It proves the suite passes under the exact
condition a runner is in (no corpus, fresh DB, import skipped) and that the condition was really
in effect (measured against the server's own report, not assumed from an env var). It does *not*
prove anything about CI's other differences — there is no `.NET` SDK, no sibling repo and a
different chromium build there — because those are D55's deliberate CI contract and are out of this
story's reach; the hermeticity that makes them irrelevant is what the per-arm `unmocked: 0` guard
asserts (15/15 scanned arms, every run).

## 2. (b) `responsive.spec.ts` validated against the AC — **nothing was rewritten**

`git status --porcelain tests/ui/responsive.spec.ts` → empty. The file p5-06 committed is the file
this story validates; not one arm was edited, weakened or added to fit a template.

**41 arms, counted by the runner** (`npx playwright test tests/ui/responsive.spec.ts --list` →
`Total: 41 tests in 1 file`), in seven describes:

| § | arms | what |
|---|---|---|
| 1 | 1 | 20 routes × 8 widths (375/640/767/768/1024/1279/1280/1440) — no horizontal overflow, and the offending element is named |
| 2 | 10 | 3 mobile + 3 tablet + 2 desktop + 2 boundary (767/768, 1279/1280): rail hidden/200px/260px, hamburger, overlay height, swipe-close |
| 3 | 8 | the JSON panel: full overlay below `md`, the spec's 300px `<aside>` at tablet, 400px at desktop |
| 4 | 9 | the nine list routes: cards below `md`, table from `md` |
| 5 | 2 | the tablet table's own horizontal scroll container |
| 6 | 8 | the four stat cards: 1 column → 2 → 4 |
| 7 | 3 | the ⌘K palette is centred and inside the viewport at 375/768/1440 |

**Every clause of the AC's second half, and where it is carried:**

| AC#13's words | arms that carry it |
|---|---|
| "375/768/1440 layout assertions **across all routes**" | §1's 1 arm (20 routes × all 8 widths, including the three named) + §4's 9 list routes at mobile/768 |
| "sidebar hamburger + swipe-close at **375px**" | §2's mobile arms at 375/640/767 — the swipe is a real `touchstart`→`touchend` sequence |
| "**tables→cards**" | §4 (9 arms: `role=table` count 0 and the named card list present at mobile; table visible and cards absent at 768) |
| "**JSON panel→overlay**" | §3's mobile arms at 375/640/767 (a `role=dialog` covering the viewport at `x=0`, and no desktop `<aside>` mounted) |
| "tablet sidebar **200px**" | §2's tablet arms at 768/1024/1279 (exactly 200; exactly 260 at 1280/1440) |

So the AC's "375/768/1440 across all routes" is the **375/768/1440 rows of a matrix that is
already wider than the criterion asks** (8 widths, both sides of every Tailwind flip the app uses),
and the file already carried its own `expect(unmocked).toEqual([])` guard. **What this story added
to that file: nothing** — and §7 of `p5-07-d2-a11y-spec.md` records what the pair still cannot see.

## 3. (c) The seven checks, every rc captured on its own command

| # | command | rc | result |
|---|---|---|---|
| 1 | `npm test` | **0** | 67 files, **1460 tests passed**, 13.25s |
| 2 | `npm run lint` | **0** | `eslint . && prettier --check .` — "All matched files use Prettier code style!" |
| 3 | `npm run typecheck:tests` | **0** | silent |
| 4 | `npx tsc -p server/tsconfig.json --noEmit` | **0** | silent |
| 5 | `npx tsc -p client/tsconfig.json --noEmit` | **0** | silent |
| 6 | `npm run build` | **0** | `✓ built in 3.09s` |
| 7 | `npm run test:ui` (**no `--config`**) | **1** | see below — the red arms are three **carried families** in files this story does not touch |

Each was captured as `npm test > f 2>&1; rc=$?` — the rule p5-06 had to add after a
`… | tail` reported `tail`'s rc. Transcript: [`p5-07-gate.txt`](./p5-07-gate.txt).

**Check 7 in full.** Four full-suite runs were started; two are inadmissible and are recorded as
such:

| run | rc | counts | why |
|---|---|---|---|
| A | 1 | 391 passed / 2 failed | **INVALID** — taken before the header fix, so it still held the executor's own `shell.spec.ts:865` strict-mode regression (since fixed and re-verified) |
| **B** | 1 | **392 passed / 1 failed** | delivered tree — the red arm is carried family 3 |
| **C** | 1 | **390 passed / 3 failed** | delivered tree — all three carried families |
| D | 1 | 374 passed / 19 failed | **DISCARDED** — the dev stack died mid-run (Vite exited 0, `tsx watch` force-killed the server): 17 arms are `ERR_CONNECTION_REFUSED`, so it measures nothing. Re-run immediately afterwards with no competing rig on 3001/5181: run B |

**In runs B, C and the CI-condition run, the two specs this story owns are green every time:**
`a11y.spec.ts` 17/17 (15 scanned arms, all with `critical/serious/moderate/minor = 0`) and
`responsive.spec.ts` 41/41 — **0 arms of either failed in any run whose stack stayed alive**, and
there were **0 `ERR_CONNECTION_REFUSED`** in B and C.

**The three red arms are the families the brief names, each attributed by measurement**
(full transcript: [`p5-07-carry.txt`](./p5-07-carry.txt)):

| family | mechanism | isolation on this tree |
|---|---|---|
| `extraction.spec.ts:828` | a sonner `<li data-sonner-toast>` subtree intercepts pointer events at the click target; the click retries for the whole 60 s budget (D69(h)/D77(d)) | **3/3 pass** (4.3 / 2.9 / 2.9 s) |
| `a11y-keyboard.spec.ts:221` | `waitForEvent('filechooser')` times out after 60 s | **3/3 pass** (3.0 / 3.1 / 4.0 s) — matching p5-06's 3/3 |
| `quests-goals-editor.spec.ts:511` | **not the drag**: the arm calls `copyPanelDocument`, whose `expect.poll` waits only **10 s** for the JSON panel's copied text to start with `{` (`quests-goals-editor.spec.ts:224`, called at `:549`) | **2 of 3 FAILED** (rc=1, rc=1, rc=0) — 13.7 s when it fails, 3.8 s when it passes |

The third one is this story's one addition to the carried ledger: it is not rare, and the exact
load-sensitive line is now named. The durable fix (raise that 10 s poll the way D77(a) raised the
unit suites' 5 s to 30 s, or assert on the document rather than the clipboard) belongs to that
spec's owner — **no arm was patched, no timeout relaxed, no arm skipped**, the treatment p5-06 set.

## 4. The PNG side effect, and the two-way verification (D83(d))

Snapshotted **before** the first full run, with the pre-condition that makes `git checkout --` safe
here explicitly verified:

```
git status --porcelain docs/evidence/phase-4/   → 0 lines        (nothing uncommitted to protect)
git ls-tree -r --name-only HEAD docs/evidence/phase-4/ | grep -c '\.png$'  → 22
on-disk md5 vs `git show HEAD:<path>` md5 (all 22)           → diff rc=0  (identical)
```

After each full run the directory was restored with `git checkout -- docs/evidence/phase-4/`
**only** because that verification holds, and then verified **two ways**: `git status --porcelain`
→ 0, **and** all 22 md5s read back through `git show HEAD:<path>` equal to the pre-run snapshot.
Both verifications passed after every restore (runs A, C and D each rewrote the directory; run B
did not leave a single changed byte — see below).

**What was measured:** a full `test:ui` run writes **all 22** committed phase-4 PNGs (D83(d)
recorded 15; the measurement here is 22, matching the count of committed files). In run B — a
healthy run — the rewritten bytes came out **identical to the committed ones** (porcelain 0 right
after it, with run D's 22 modified files still on disk beforehand, so run B must have rewritten
them back). In run A/C/D the bytes differed. The side effect is therefore real and
non-deterministic, and the restore discipline is required for anyone running the full suite before
a phase PR — D83(d)'s durable fix (a gitignored output directory for the mobile spec) is still
open and is *not* this story's.

**This story never wrote a source file back with `git checkout`** — the one deliberate break was
restored by copying the file from `/tmp` (see §5), the rule p5-06 learned the hard way.

## 5. Falsification, restored byte-identically (D67(d))

The break: `client/src/components/objects/DropTableForm.tsx:222`'s shared field renderer
`<label htmlFor={id}>` → `htmlFor={`broken-${id}`}`, i.e. every field's label pointing at a
non-existent id.

| step | command / check | result |
|---|---|---|
| back up | `cp …/DropTableForm.tsx /tmp/p507/backup/` | — |
| md5 before | `md5sum` | `51864a70468f88cc344706c7ccae382b` |
| run | `npx playwright test tests/ui/a11y.spec.ts` | **rc=1, 3 failed / 14 passed** |
| which arms | — | **only** `drop-table:view`, `drop-table:edit`, `drop-table@375` |
| which rule | — | `critical label (9 node(s)): Form elements must have labels` |
| restore | `cp /tmp/p507/backup/DropTableForm.tsx …` (never `git checkout`) | — |
| md5 after | `md5sum` | **`51864a70468f88cc344706c7ccae382b` — identical** |
| residue | `grep -c 'broken-'` → 0; `git status --porcelain <file>` → 0 lines | clean |

**That is the falsification of the brief's named failure mode** ("a scan of the whole app repeated
four times rather than of the four pages' own states"): the break fires on the predicted page and
on no other, so the four page arms are four independent DOM scans. The lead's own AC#9 tier-2
re-scan independently reproduced the same result on the broken tree — **1 CRITICAL `label`, 9
nodes, DropTable detail only, no other page**.

## 6. Honest limits

1. **`npm run test:ui` is red, rc=1, in every full run on the delivered tree** — by the three
   carried families named above, never by an arm of `a11y.spec.ts` or `responsive.spec.ts`. Under
   peak-hour load family 3 fires about half the time even in isolation, so an all-green full run is
   not something this story can promise; what it *can* promise is that both of its specs pass
   independently of that, in both the normal and the CI condition.
2. **One full run has to be discarded for a dead dev stack** (run D: Vite exited 0,
   `tsx watch` force-killed the server, 17 arms `ERR_CONNECTION_REFUSED`). The re-run with no
   competing rig on 3001/5181 was clean. Any red run should be read against that failure signature
   before it is believed.
3. **The four app fixes are code changes in files p5-05 certified** (details in
   `p5-07-d2-a11y-spec.md` §4). The AC#9 tier-2 scan and its four committed screenshots therefore
   describe a UI that has moved; both are the lead's to re-run and replace.
4. **The mobile arm's coverage is one viewport (375×900)**, not a device matrix: 375 is the width
   the AC and the sibling spec use, and it is where the hamburger, the card lists and the JSON
   overlay replace their desktop counterparts. A 320px or landscape pass is not here.
5. **`npm test` is green (1460 passed) but says nothing about the UI** — tiers are separate by
   design (D23/D40); the 1460 include no assertion about the four pages' accessibility.