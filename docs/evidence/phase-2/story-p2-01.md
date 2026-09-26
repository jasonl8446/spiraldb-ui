# p2-01 — Phase-2 prerequisites (task 2.0)

Branch `phase-2-quest-extraction`. Task 2.0 of
[`docs/plan-phase-2-quest-extraction.md`](../../plan-phase-2-quest-extraction.md):
the owner-prerequisite check, the D17 disposable test clone, and the D18 smoke build
of `Imview.PacketReader` — the three things every later Phase-2 story leans on.

Raw outputs: [`story-p2-01-prereqs.txt`](./story-p2-01-prereqs.txt) (dotnet, clone,
reset script, settings resolution, harness isolation) and
[`story-p2-01-build.txt`](./story-p2-01-build.txt) (the cold smoke build and the
post-build isolation proof).

| AC | Result | Evidence |
|---|---|---|
| **ac1** `dotnet --version` ≥ 9, else halt (no agent-side install) | **PASS** | `9.0.318` at `/run/current-system/sw/bin/dotnet`. No install attempted, no halt needed. |
| **ac2** `data/test-spiraldb` = fresh clone of the owner fork (gitignored), dev/test settings point `spiraldb_path` at it, `npm run test:reset-clone` deletes and re-clones (D17) | **PASS** | `git clone /home/jason/Documents/git-projects/spiraldb data/test-spiraldb` from the *local* path (no network/auth): `origin = /home/jason/…/spiraldb`, HEAD `c55ccab`, `status` clean, 22 MB, and `git check-ignore -v data/test-spiraldb` → `.gitignore:5:data/`. The new script is one line — `rm -rf $PWD/data/test-spiraldb && git clone …` — run fresh for this record: npm exit **0**, HEAD `c55ccab`, clone clean; run twice by the executor, exit 0 both times (idempotent), and a bogus source exits 128 (fail-loud). `NODE_ENV=test npx tsx -e "buildSeedSettings({env:process.env}).spiraldb_path"` → `<repo>/data/test-spiraldb`, while the default stays the owner fork. |
| **ac3** `Imview.PacketReader` smoke build succeeds with the D18 artifacts flags only; Imview tree untouched | **PASS** | Cold build (`tools/.artifacts` + `tools/.nuget` deleted first): `NUGET_PACKAGES=$PWD/tools/.nuget dotnet build src/Imview.PacketReader/Imview.PacketReader.csproj -p:UseArtifactsOutput=true -p:ArtifactsPath=$PWD/tools/.artifacts` → **Build succeeded, 0 Errors, 16 Warnings**, 40.63 s, exit **0**. Outputs landed in-workspace: `tools/.artifacts` 140 MB (`…/bin/Imview.PacketReader/debug/Imview.PacketReader.dll` + Imcodec deps) and `tools/.nuget` 287 MB. Isolation: Imview `git status` unchanged, **0 files** under the Imview tree modified in the build window (fs-level `find -newermt`, so ignored `obj/` would have shown), `~/.nuget` still 5,044 files with **0** touched, and no `-p:BaseIntermediateOutputPath`/`-p:BaseOutputPath` anywhere (the D18 CS0579 trap). |

## What the check turned up: D44 (harness database isolation)

The three acceptance criteria passed, but verifying ac2's "dev/test settings point
`spiraldb_path` at it" exposed a gap the story's own text assumes away:
`playwright.config.ts` booted the dev stack **with no database isolation** and with
`reuseExistingServer: !process.env.CI`, against `data/spiraldb-ui.db` — whose
`spiraldb_path` is the owner's real fork. Phase 1 only read, so nothing was at risk;
the first spec driving a Phase-2 extraction or save would have written into the
owner's repository, which D17 forbids. Local runs were worse than CI: a developer's
running stack would be *reused* and receive the spec's writes.

Fixed as part of this prerequisite story (recorded as decision **D44**):

- The harness boots `rm -f data/test-ui.db && NODE_ENV=test SPIRALDB_UI_DB=$PWD/data/test-ui.db SPIRALDB_UI_SKIP_IMPORT=1 npm run dev` with `reuseExistingServer: false`.
- `resolveDbFile(env, repoRoot)` (`server/src/db.ts`) returns `SPIRALDB_UI_DB` when set and non-empty, else `defaultDbFile()` — pure, and honoured **only** by the app's own connection `getDb()`, so `openDb()` callers, scripts and unit tests keep passing a path explicitly.
- `server/src/index.ts` logged `defaultDbFile()`, so the boot line named the developer's database while the server had opened a different one; it now logs `resolveDbFile()`. Caught by reading the harness's own stdout — the first run printed the *wrong* database name while the isolation had actually worked (the throwaway file existed and the live one was byte-identical).

Measured after the change: a full `npm run test:ui` with the boot line
`[spiraldb-ui] database ready at …/data/test-ui.db`; **8 passed**; the live database
byte-identical across the run (sha256 prefix `03e37e43ca9f8692`, mtime unchanged);
`data/test-ui.db` seeded `spiraldb_path = <repo>/data/test-spiraldb` with 12 tables
and **0** `entry_status` rows (import skipped); the owner fork clean at `c55ccab`.
Two new tests in `tests/unit/db.test.ts` cover the resolution and the seeded
isolation (suite 512 → **514**).

**Reading of ac2** (recorded so it cannot be re-litigated silently): "dev/test
settings point `spiraldb_path` at it" means *automated-test configuration*. The human
dev/production server keeps the owner fork — D17 reserves the real fork for
owner-driven production use, and because seeding is first-run-only (D31c) an env var
can never rewrite an existing database anyway.

## Gate

The six-check gate (unit, UI, lint, typecheck:tests, server+client `tsc`, build) is
recorded in the round's run log; the counts here are 514 unit tests and 8 UI specs.