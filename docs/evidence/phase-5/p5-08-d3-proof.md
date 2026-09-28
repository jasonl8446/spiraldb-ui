# p5-08 D3 — the proof and the gate

The repeatable checks, every rc captured **on the command itself** (never on a pipeline's tail),
run on the tree that carries this story's changes: `npm test`, `npm run lint`,
`npm run typecheck:tests`, `npx tsc -p server/tsconfig.json --noEmit`,
`npx tsc -p client/tsconfig.json --noEmit`, `npm run build`, and `npm run test:ui` **with no
`--config`**. Everything touched was `npx prettier --write`-formatted first (the four `.ts`/`.tsx`
files reported `unchanged`, i.e. already conformant; `*.md` is in `.prettierignore`, and
`npx prettier --check` on all eight touched files is green).

## (a) The repeatable link check, and the Getting Started commands

The link check is a command, not a claim. Its full output and both classes are in
`p5-08-d2-docs.md` §1; re-run on the final state of the document:

```
$ /tmp/p5-08/link-check.sh README.md          # reads the references out of the file
class A: 17 resolve, 0 missing
class B: 5 tracked and resolving, 1 globs expanding, 0 missing, 7 runtime-created or gitignored
rc=0
```

The script and the two field-check scripts live in `/tmp/p5-08/` (scratch, per this story's
constraints) and their bodies are quoted in `p5-08-d2-docs.md`, so the check is reproducible from
the evidence alone.

**Getting Started commands, and which could not be run verbatim** (the table is in
`p5-08-d2-docs.md` §1): `npm run build`, `npm start`, `npm run dev`, `npm run build:cli`,
`npm run sync:dry-run` ran verbatim (all rc=0); `npm run sync` ran as the documented command but
its `SPIRALDB_UI_DB` isolation silently did not apply — measured and reported in §6 of that file
(the command's effect was one `sync_history` row and the `updated_at` restamp, with
`entry_status`/`status_history`/`settings` byte-identical). **Not run here: `git clone` into a fresh
directory and `npm install`** — the clean-checkout half of AC#16 is plan §5.8's fresh-clone dry run,
owned by **p5-09**; saying so is the honest statement, and running it here would be faking it.

## (b) The six checks

**Measured on the final tree.** The rc set below was taken with the source in this state (sha256 of
each changed/new source, test and evidence file; the two deleted files are absent by design):

```
 M AGENTS.md                        3c3a44df…   M client/src/App.tsx      3c636fb8…
 M README.md                        cdf124ea…   M client/src/lib/routes.ts f73a8b9a…
 M docs/spec-api.md                 853551e2…   M tests/ui/object-mobile.spec.ts 327edaa0…
 M tests/ui/shell.spec.ts           0f1163b8…   ? docs/evidence/phase-5/p5-08-*.md
```

```
[01-test]            rc=0   cmd: npm test
[02-lint]            rc=0   cmd: npm run lint
[03-typecheck-tests] rc=0   cmd: npm run typecheck:tests
[04-tsc-server]      rc=0   cmd: npx tsc -p server/tsconfig.json --noEmit
[05-tsc-client]      rc=0   cmd: npx tsc -p client/tsconfig.json --noEmit
[06-build]           rc=0   cmd: npm run build
```

- **`npm test`** — `Test Files 67 passed (67)`, **`Tests 1460 passed (1460)`**, 9.00 s.
- **`npm run lint`** — ESLint clean and `All matched files use Prettier code style!` (which is the
  check that covers the four `.ts`/`.tsx` files this story touched).
- **`npm run typecheck:tests`** — the third tsconfig, i.e. the one that compiles
  `tests/ui/shell.spec.ts` and `tests/ui/object-mobile.spec.ts` after their edits.
- **the two explicit `tsc --noEmit` runs** — server and client, both rc=0 (the client one is the
  same invocation `build:client` makes, run separately as the AC asks).
- **`npm run build`** — client + server emitted; 2.88 s.

Each log is at `/tmp/p5-08/d3-0N-*.log`; the rc file is `/tmp/p5-08/d3-six-rcs.txt`. The rc set was
re-taken after the last source edit so it belongs to the exact tree the fingerprint names; the only
edits made afterwards are to `docs/evidence/phase-5/p5-08-*.md`, which **no** check reads
(`*.md` is in `.prettierignore`, ESLint lints only JS/TS, and Vitest/`tsc` never see them).

## (c) `npm run test:ui`, no `--config`

```
$ npm run test:ui                 # the official script; no --config was passed
  393 passed (2.1m)
RC=0
```

**393 passed, 0 failed, rc=0 — twice**, and the second run is the one that belongs to the
fingerprinted final tree above:

```
$ npm run test:ui                    # the official script; no --config was passed
  393 passed (2.1m)      RC=0        # before the final comment-only App.tsx edit
$ npm run test:ui                    # re-run on the fingerprinted tree
  393 passed (1.9m)      RC=0
```

The suite includes the two specs this story edited (`shell.spec.ts`, whose three removed mocks are
the change under test, and `object-mobile.spec.ts`, whose screenshot directory moved). Ports were
asserted free (`3001` and `5181`) immediately before each run, so the harness booted its own
isolated stack rather than reusing or colliding with anything. The second run exists because the
first preceded a **comment-only** edit to `client/src/App.tsx` and the README's screenshot bullet —
neither can change what a browser does, but "measure only a settled tree" (D85) is cheaper to obey
than to argue with, and the re-run also produced a second sample of the flake families below: 786
specs across two runs, zero failures.

**The three carried flake families did not fire in this run**, and they are carried, not patched —
each is named with its classification so the ledger keeps the attribution:

| family | classification | this run |
|---|---|---|
| `extraction.spec.ts` toast/pointer-overlap | pre-existing load family (D69(h), D77) | green |
| `quests-goals-editor.spec.ts:511` pointer-drag | pre-existing, classified by measurement (p5-07's repeats: passes in isolation, fails under load) | green |
| `a11y-keyboard.spec.ts:221` file chooser | a 60 s `waitForEvent('filechooser')` timeout under load (D85's gate captured it) | green |

A green run is the expected outcome on an unloaded machine; one run is not evidence that the
families are fixed, and nothing in this story touched them.

## (d) The PNG verification — the churn is gone, two ways

Snapshot taken **before** any suite run: the md5 of every committed PNG in the worktree and of the
same path in `HEAD` (90 files: 22 in `docs/evidence/phase-4/`, 14 in `docs/evidence/phase-5/`, the
rest in phases 1–3), with **no** differences — i.e. the starting tree was clean.

After the full `npm run test:ui` — and again after the second full run, so this holds across two
consecutive suite runs plus the sibling worker's run earlier today:

```
$ git status --porcelain docs/evidence/
?? docs/evidence/phase-5/p5-08-d1-twomode.md
?? docs/evidence/phase-5/p5-08-d2-docs.md
?? docs/evidence/phase-5/p5-08-d3-proof.md
# (the only entries are this story's new evidence files; no committed PNG is modified)

$ for f in $(git ls-files 'docs/evidence/**/*.png'); do
    h=$(git show "HEAD:$f" | md5sum | cut -d' ' -f1); w=$(md5sum < "$f" | cut -d' ' -f1)
    [ "$h" != "$w" ] && echo "CHANGED $f"
  done
<no output>
changed: 0 of 90

$ diff /tmp/p5-08/png-md5-before.txt /tmp/p5-08/png-md5-after.txt   # pre-run snapshot vs after run 1
<no output>
90/90 committed PNGs: worktree md5 == HEAD md5 (and identical to the pre-run snapshot)

$ ls test-results/object-mobile/ | wc -l
22
$ git check-ignore -v test-results/object-mobile/
.gitignore:24:test-results/	test-results/object-mobile/
```

Both halves of D83(d)'s protocol are therefore satisfied **by measurement on this story's own
runs**: `git status --porcelain` is empty for the evidence trees, and all 90 PNGs' md5s equal
`git show HEAD:<path>` after each of two full runs. The 22 screenshots the mobile spec produced
landed in a path git ignores, and the 6 `p5-05-reduced-motion-*` PNGs that the *other*
screenshot-writing spec overwrites are among the 90 that did not change — the reduced-motion
spec's writes are byte-stable across all three runs observed today, which is why it was left alone
(`p5-08-d2-docs.md` §5).

The whole-tree porcelain is exactly this story's intended change set — nothing else moved:

```
 M AGENTS.md
 M README.md
 M client/src/App.tsx
 D client/src/components/SharedComponentsPreview.tsx
 M client/src/lib/routes.ts
 D client/src/pages/StubPage.tsx
 M docs/spec-api.md
 M package-lock.json          <- pre-existing, D87's axe-core pin (not this story's)
 M package.json               <- pre-existing, D87's axe-core pin (not this story's)
 M tests/ui/object-mobile.spec.ts
 M tests/ui/shell.spec.ts
?? docs/evidence/phase-5/p5-08-d1-twomode.md
?? docs/evidence/phase-5/p5-08-d2-docs.md
?? docs/evidence/phase-5/p5-08-d3-proof.md
```

The two deleted files are **unstaged worktree deletions** (` D`), not staged: this story's brief
forbids touching git beyond reading it, so the lead stages deliberately. No commit was made.

*A note for anyone re-checking these numbers:* compare the columns with the loop above, not with
`cut -d' '` on the saved snapshot — those lines are double-spaced, so `cut` fields do not line up
and a careless one-liner reports "90 of 90 changed" on an unchanged tree. That mistake was made and
caught here; the loop and `git status` are the two authorities.

## (e) Honest limits of this story's evidence

1. **The clean-checkout half of AC#16 is not this story's** — `git clone`/`npm install` from a fresh
   directory and the subsequent walkthrough are p5-09's (plan §5.8). Every command that could run
   from the working tree was run; the two that could not are named in `p5-08-d2-docs.md` §1.
2. **The `npm run sync` isolation defect** (`SPIRALDB_UI_DB` is not honoured by that script) is
   reported with its measured effect and the `--db <path>` workaround, not fixed — it is a
   D32/D44-contract question, not a docs story's.
3. **One `test:ui` run is one sample.** The three carried flake families are load-sensitive, and
   three green samples were never the goal; the attribution above is what the ledger needs.
4. **The prod-mode sweep is a GET-only walkthrough.** No save/mutation was exercised in production
   mode (the write paths are covered by the phase's own stories and their rigs), so "fully
   functional" here means every route renders, deep-links and refreshes, and the API answers
   identically through both modes — which is what P5 AC#14 asks for.
5. **`PUT /api/settings`'s response body is still undocumented in `spec-api.md`** (D32's resolution,
   outside AC3's two endpoints) — recorded as a gap rather than filled silently.