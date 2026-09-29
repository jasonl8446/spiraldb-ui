# final-deslop D3 — the proof and the gate

Story: **final-deslop / Ultragoal final gate 1/3** (AC1), the writer half. Tree: `final-gate` cut
from `origin/main` @ `0afb308` + this pass's working-tree edits. **Nothing is committed and nothing is
staged** — the lead verifies and commits (D84(a)); every git command below is a read. The cleanups
themselves are in `docs/evidence/final-deslop-d2-cleanups.md`.

> **This file supersedes the previous pass's D3** (tree `main` @ `1bac35c`, the F1/F2 pass); that
> record is preserved in git history at `1bbbda3`. Its table of committed raw transcripts
> (`final-deslop-gate-*.txt`) describes **that** pass's runs, not these.

## 1. The gate, every `rc` captured on the command itself

Each `rc` below is `$?` taken immediately after the command, **never** read off a pipeline's tail.
The commands were run **sequentially** — this repo's suites are load-sensitive (D77(a)/D117), so
nothing overlapped another run, and no source file was edited between the first gate and the last.

| # | command | `rc` | result |
|---|---|---|---|
| 1 | `npx vitest run` over the **13** new/changed unit files | **0** | **13 files / 243 tests passed**, 8.8 s |
| 2 | `npm test` | **0** | **89 files / 1816 tests passed**, 53.4 s (baseline: 87 / 1807 → **+2 files, +9 tests**) |
| 3 | `npm run lint` | **0** | `eslint .` clean; `prettier --check .` → *"All matched files use Prettier code style!"* |
| 4 | `npm run typecheck:tests` | **0** | 0 errors |
| 5 | `npm run typecheck:scripts` | **0** | 0 errors — **S10's new program**, green on its first full run |
| 6 | `npm run build:server` | **0** | `tsc -p server/tsconfig.json` + assets; `[build] copied 4 server asset(s) … 0001_init.sql, 0002_quest_catalog.sql, 0003_persona_index.sql, 0004_breadth_catalog.sql` |
| 7 | `npm run build:client` | **0** | `✓ built in 2.79s`; `dist/assets/index-DGWIYd6n.css` 36.34 kB, `dist/assets/index-BhWLwbZ4.js` **791.30 kB** (gzip 232.81 kB), `QuestGoalLogicEditor-BHIrbZkM.js` 293.61 kB |
| 8 | `npm run test:ui` (no `--config`; `retries: 0` locally) | **0** | **418 passed (1.8 m)**, 0 failed, 0 flaky, 0 skipped (baseline: 415 → **+3 arms**) |

Command 1, verbatim:

```
npx vitest run tests/unit/wad-index.test.ts tests/unit/evidence-insert.test.ts \
  tests/unit/evidence-panel.test.ts tests/unit/quest-refs.test.ts \
  tests/unit/quest-scaffold.test.ts tests/unit/quest-evidence.test.ts \
  tests/unit/quest-evidence-insert-isolation.test.ts tests/unit/quest-edit-isolation.test.ts \
  tests/unit/npc-names.test.ts tests/unit/quest-catalog-view.test.ts \
  tests/unit/ui-shell.test.ts tests/unit/object-friendly-name.test.ts \
  tests/unit/scaffold-quest-cli-guard.test.ts
→ Test Files  13 passed (13)     Tests  243 passed (243)
```

`418 passed` means 418 **first-attempt** passes: Playwright's `retries` is
`process.env.CI ? 1 : 0`, and this was a local run.

**On the two totals honestly:** `npm test` grew by two files and nine tests because **I added two
test files** (`object-friendly-name.test.ts`'s 4 arms, `scaffold-quest-cli-guard.test.ts`'s 2) and
three arms to existing files; `test:ui` grew by exactly the **three** tier-1 arms C3/C4 asked for
(`CATALOG_NO_MISSING`, the identity Title cell, the detail header's pair). Every pre-existing
assertion is still present and still passes — no count was made to grow by relaxing anything.

**No suite is red**, so neither the known deterministic drag arm
(`quests-goals-editor.spec.ts:519`, D85(c)/D67(d), *carried by name*) nor a rotating member of the
D69(h)/D77(d) family fired this round — nothing had to be re-run alone to attribute it.

## 2. Negative controls run this session (D90(c) — an instrument's sensitivity, proven)

A cleanup whose instrument is never falsified is not evidence, so each new or changed instrument was
made to fail on purpose before its clean result was trusted:

| instrument | control | observed |
|---|---|---|
| `typecheck:scripts` (S10) | throwaway `scripts/__negcontrol.ts` = `const unusedLocal: number = "not a number"` | `scripts/__negcontrol.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.` — deleted; clean re-run **rc=0** |
| the T3 `@ts-expect-error` guard | temporarily `= 'inferred'` (assignable) | `tests/unit/evidence-insert.test.ts(478,5): error TS2578: Unused '@ts-expect-error' directive.` — reverted; `typecheck:tests` **rc=0** |
| the S8 cross-reader parity arm | the two projections asserted non-empty (**4** and **2**) and **unequal** to each other | so a `toEqual` between two empty or accidentally identical lists cannot pass the arm |
| the T4 refusal arm | its **positive partner**: a scratch `--db`/`--spiraldb` | rc≠2, no refusal sentence, the CLI's own 404 from the empty scratch catalog — so arm 1's rc=2 is the guard firing, not "this CLI always exits 2" |
| the S8 module-entry guard | both call shapes | `node scripts/wad-census.mjs --help` → usage + rc=0; `import('./scripts/wad-census.mjs')` → `parseIndex` is a function, census **not** run |
| the S3 unknown-flag refusal | `npx tsx scripts/imlight-boot.ts help --restore-clonee` | `[harness] unknown flag: --restore-clonee` + usage, **rc=2** (before: accepted, restore skipped, rc=0) |
| the S6 valueless-flag refusal | `node scripts/quest-corpus-census.mjs --corpus` | `Refusing to run: --corpus was given without a value.` + usage, **rc=2** (before: silently measured the default corpus) |

## 3. The two pins (verified after the last gate)

**The D17 clone — five axes + the corpus shape + the ref list:**

| axis | value |
|---|---|
| branch | `content/2026-09-27` |
| `HEAD` | `18dc92477d54b1e911796960407ce7710e703697` |
| `main` ref | `f3f8b5c0a48bc0f0b0cd9aca2d9d7d9d0122bd37` |
| `rev-list --count HEAD` | `42` |
| `git status --porcelain` | **(empty)** |
| `QuestTemplates/*.json` | **322** (the D80(c) frozen count) |
| local refs | `content/2026-09-26` @ `18dc924`, `content/2026-09-27` @ `18dc924`, `main` @ `f3f8b5c` |

**The live database — byte-identical:**

```
sha256 a13f9aa8376411f6c6c0ea704098fcba6c4a226298eaba114230414af9e572ac  data/spiraldb-ui.db
```

Checked before the first gate and after the last one; the pin in the brief is that value. Every CLI
this pass touched that can write was exercised only against a **scratch** database
(`tests/unit/scaffold-quest-cli-guard.test.ts` points `--db` and `--spiraldb` at
`data/__test-scratch__/…` and its positive partner uses an empty scratch catalog), and
`git status --porcelain data/` is empty. The previous story's write-default incident was not
repeated.

## 4. Runs invalidated by an edit (reported, not hidden — D84's rule)

A gate measured against a tree being edited is not a measurement, so the intermediate runs that my
own edits invalidated are listed rather than quietly dropped:

1. **`npm test` #1 — 89 files, 1 failed / 1815 passed.** The failure was real and was mine:
   `tests/unit/quest-evidence.test.ts:275` asserted `resolved.label`, which V11 deletes. Fixed by
   updating three assertions to the new `{ display }` shape (every `display` value still asserted
   exactly), then re-run → §1 row 2.
2. **`npx tsc -p tests/tsconfig.json` #1 — `tests/unit/quest-scaffold.test.ts(43,3): error TS6133:
   'questFileCount' is declared but its value is never read.`** A mid-edit measurement (the import had
   been added before its use was removed). Fixed, then re-run → §1 row 4.
3. **`npx vitest run tests/unit/wad-index.test.ts` after the S8 arm — 37 tests passed at runtime,
   while `tsc` reported `TS7016`** for the `.mjs` import. The runtime result was correct but the
   program was not; the `allowJs` decision in §5 of D2 was made and the file re-verified.
4. **Two partial tier-1 runs before the full one** (`object-list.spec.ts` + `quests-catalog.spec.ts`
   → 21 passed; then `quests-evidence-panel.spec.ts` + `quests-catalog.spec.ts` + `a11y.spec.ts` →
   41 passed). Both were iteration runs, not the gate; §1 row 8 is the settled tree.
5. **`npm run lint` #1** named ten unformatted files (all mine, all under prettier's rules). They were
   formatted with `prettier --write`, then lint re-run → §1 row 3.

**Nothing was edited after the gate sequence except this file and D2** — two evidence documents that
no suite reads (`evidence-summary-drift.test.ts` explicitly excludes top-level `docs/evidence/*.md`
audits, and `tests/unit/ui-shell.test.ts` parses `docs/spec-*.md`, which I did not touch). Because
`npm run lint` covers markdown too, it was run **once more after both documents were written**:
`npm run lint` → **rc=0**, *"All matched files use Prettier code style!"*. That is the only command
re-run after the gate; no source file changed.

## 5. The claims I am *not* making

- **The pass is not over the whole tree.** It is over D1's stated authored-code surface (125 files of
  the Phase 6 diff: `server/`, `client/`, `tests/`, `scripts/`, `tools/`, `shared/`, root configs).
  `docs/` prose, the vendored `client/src/components/ui/**` primitives and `package-lock.json` are
  outside it, as D1 §0 states.
- **No new dependency.** `package.json` changed only by two script aliases and `typecheck:scripts`;
  `package-lock.json` is untouched.
- **V1 is not fixed** — the field was kept and the finding (three fall-through classes, only one
  visible) is reported for the lead's decision (D2 §4/§5).
- **V12(c), T7's evidence annotation and C4's "Known as" arm are not done**, each with its reason in
  D2 §3/§4.
- **No `git` write happened.** Nothing staged, committed, stashed, or checked out; the branch is still
  `final-gate` and the tree is dirty for the lead.
- **The `typecheck:scripts` program is new, not retroactive.** It type-checks `scripts/**/*.ts` plus
  the `server/src`/`shared` modules they import — it is not a repo-wide root tsconfig, and `scripts/`
  `.mjs` files are still not type-checked (S8's arm is what guards the one that matters).

## 6. Where AC1 lands

AC1 asks for a pass with dead code, duplication, boundary violations and slop cleaned **or explicitly
dispositioned**, every touched suite green afterwards, and the disposition list recorded raw.

- **Disposition list, raw, with its scope:** `docs/evidence/final-deslop-d1-disposition.md`.
- **Cleaned or dispositioned:** 32 CLEAN rows implemented (S1–S3, S5–S10, T1–T12, V2–V4, V7, V9–V12,
  C1–C6) and every DISPOSITION row left standing (S4, S11–S14, T8's merge, T11's unify, V5, V6, V8,
  V9's spelling swap, T2's readiness parameterisation) — enumerated in D2 §2/§4.
- **Every touched suite green:** §1's eight commands, all rc=0 — `npm test` 89/1816,
  the targeted batch 13/243, `test:ui` 418/418, lint, both typechecks and both builds.
- **The two pins hold:** the clone on all five axes + 322 files + three refs, and the live database
  byte-identical at `a13f9aa8…`.