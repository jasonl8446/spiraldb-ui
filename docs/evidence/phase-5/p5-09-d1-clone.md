# p5-09 D1 — the `sync` isolation fix + the fresh clone brought up

Story p5-09 (plan task 5.8) — `docs/plan-phase-5-dashboard-polish.md` §5.8. Branch
`phase-5-dashboard-polish`, repo HEAD `750c31a`. **Nothing was committed in the repo and no git
write of any kind was made there** (D84(a)); every command below that writes runs in the throwaway
clone under `/tmp` or against explicitly named throwaway files.

Host: NixOS, Node **v24.21.0**, npm **11.19.0**, dotnet **9.0.318**. Local date 2026-09-27.

---

## 1. The prerequisite: `npm run sync` ignored `SPIRALDB_UI_DB`

**The defect (found by p5-08's own dry-run attempt, ruled on by the lead).**
`scripts/sync-names.ts` opened the connection with

```ts
const db = openDb(args.dbFile ? { file: args.dbFile } : {});
```

so the file was chosen by `--db` / `SPIRALDB_SYNC_DB` **only**. The app-wide override
`SPIRALDB_UI_DB` (decision D44) is read by `resolveDbFile()`, which only `getDb()` — the server's
own connection — called. A caller who set `SPIRALDB_UI_DB` therefore got a sync against
`data/spiraldb-ui.db` while believing the run was isolated.

**Counterfactual, measured rather than asserted** (`/tmp/p5-09/old-resolution.ts` re-executes the
pre-fix expression against the repo's own `db.ts`):

```
$ npx tsx /tmp/p5-09/old-resolution.ts
pre-fix openDb file = /home/jason/Documents/git-projects/spiraldb-ui/data/spiraldb-ui.db
```

i.e. with no `--db` flag the pre-fix script resolves to the default file no matter what
`SPIRALDB_UI_DB` says. (In the *clone* that default is the clone's own database, so the copy of the
bug there would have been benign; its live consequence — one `sync_history` row and restamped
`updated_at` in the developer's database — was measured by p5-08 and is not re-run here.)

**The fix** — one resolution ladder, in one home (`server/src/db.ts`), used by the script:

```ts
export function resolveSyncDbFile(args, env = process.env, repoRoot = resolveRepoRoot()): string {
  return args.dbFile || resolveDbFile(env, repoRoot);
}
```

`args.dbFile` is what `parseSyncArgs` already produces from `--db` (flags win) or
`SPIRALDB_SYNC_DB`; `resolveDbFile` is `SPIRALDB_UI_DB` then `data/spiraldb-ui.db`. The full order
is therefore **`--db` > `SPIRALDB_SYNC_DB` > `SPIRALDB_UI_DB` > `data/spiraldb-ui.db`** — D44's
input is now honoured, and both documented sync inputs keep working. `SYNC_USAGE` names
`SPIRALDB_UI_DB`, and the script prints the file it actually opened:

```
console.log(`[spiraldb-ui] sync database at ${dbFile}`);
```

(the same lesson `server/src/index.ts` learned in D44, where the boot line named a different
database than the one opened — a run that says which database it wrote cannot repeat p5-08's
finding).

### The diff

Full patch: `/tmp/p5-09/p5-09-sync-fix.patch` (117 lines). `git diff --stat` in the repo:

```
 scripts/sync-names.ts           | 16 ++++++++++++++--
 server/src/db.ts                | 21 +++++++++++++++++++++
 server/src/services/sync/cli.ts |  4 +++-
 tests/unit/db.test.ts           | 15 +++++++++++++++
 4 files changed, 53 insertions(+), 3 deletions(-)
```

No new dependency. The four files are the whole change.

### The fix's own proof, before it went near the clone

```
$ SPIRALDB_UI_DB=/tmp/p5-09-fix/proof.db npm run sync -- --help
[spiraldb-ui] sync database at /tmp/p5-09-fix/proof.db        <- rc=0, and the file exists (98304 B)
```

and the developer's live database was **untouched** across that run — the baseline taken
immediately before it and the value after it are identical:

```
$ sha256sum data/spiraldb-ui.db ; stat -c '%y %s' data/spiraldb-ui.db
84c1b7f6d90769ce540456fee9803002e13c7858a1dc6a5634b4e53f550ba25b
2026-09-27 21:19:10.251805384 -0400 38268928        # before the probe AND after it
```

Unit pinning (the ladder can't silently reopen): `tests/unit/db.test.ts` gained
`resolveSyncDbFile honours --db/SPIRALDB_SYNC_DB, then SPIRALDB_UI_DB, then the default`, and
`tests/unit/sync-cli.test.ts` (which already pins the flag-over-env arm) still passes — 35 tests in
those two files, all green.

---

## 2. The clone

```
$ git clone --branch phase-5-dashboard-polish --single-branch \
      /home/jason/Documents/git-projects/spiraldb-ui /tmp/p5-09/spiraldb-ui
$ git -C /tmp/p5-09/spiraldb-ui log --oneline -1
750c31a p5-08: production serving verified, README rewritten, D27's endpoints documented
$ git -C /tmp/p5-09/spiraldb-ui apply --index /tmp/p5-09/p5-09-sync-fix.patch   # rc=0
$ ls -a /tmp/p5-09/spiraldb-ui | head -3 ; ls -d data
.git  .github  .gitignore      # data/ node_modules/ tools/ do not exist
ls: cannot access 'data': No such file or directory
```

**Stated plainly:** the clone is HEAD `750c31a` **plus this story's own sync fix as an uncommitted
staged change**, because p5-09 may not commit in the repo (D84(a)) and the dry run must exercise
the fixed code. `git status --short` in the clone lists exactly those four files.

No corpus and no database — which is the point of the exercise:

```
$ ls /tmp/p5-09/spiraldb-ui/data          -> does not exist
$ ls /tmp/p5-09/spiraldb-ui/tools         -> does not exist
```

### `npm install`

```
$ cd /tmp/p5-09/spiraldb-ui && time npm install
added 527 packages, and audited 528 packages in 30s
real 0m29.788s          rc=0                # /tmp/p5-09/d1-npm-install.txt
```

`.npmrc` is carried by the clone, so the npm cache landed in the workspace
(`/tmp/p5-09/spiraldb-ui/.npm-cache`, 64 MB) — nothing was written to `$HOME` (D30(b)).

### The throwaway corpus (never the owner's fork, never the D17 clone)

```
$ git clone --no-hardlinks /home/jason/Documents/git-projects/spiraldb /tmp/p5-09/corpus
$ git -C /tmp/p5-09/corpus log --oneline -1 ; git status --porcelain | wc -l
d57d891 docs: correct verification findings across the creation guide        0
```

Counted in that clone (the walkthrough's baseline):

| QuestTemplates | DropTables | NpcInventory | NpcSpellInventory | CreatureSpellbook | NpcDropTable | TreasureCardInventory | ZoneTransfer | GlobalRegistry | QuestMetadatas |
|---|---|---|---|---|---|---|---|---|---|
| **328** | 317 | 215 | 77 | 134 | 0 (dir absent) | 1 | 1207 | 1 | 324 |

That `328` is the count of **`.json` files**: `ls QuestTemplates | wc -l` prints **329**, because the
corpus also keeps a legacy **`QuestTemplates/droptables/` subdirectory** (314 `droptables_*.json`
files inside the quest folder — measured while reconciling this row against the sync's own
`quests 328`). Same quirk in the D17 clone: 323 entries, **322** `.json`.

**Two honesty notes.** (a) The owner's fork has moved **again** since D80(a) recorded 328 quests — it
is now `d57d891` with **328** quest `.json` files (D80(a)'s "328" is that same file count) and **zero
duplicate `m_questName` values**, so the sync's `quests 328` is an exact match, not a collapse. This
dry run measures *its own* clone; it does not re-pin any owner-run constant (that is the re-pin
task's business, and p5-09 is not it).
(b) The D17 clone `data/test-spiraldb` (frozen HEAD `18dc924`, **322** quest `.json` files, currently
checked out on `content/2026-09-27` with 42 commits, `main` = `f3f8b5c`, porcelain empty) and the
owner's fork itself were only ever **read** — see the five-axis check in D3.

---

## 3. First-time configuration (the seeded env vars, D31b)

A first-time user configures the tool before the first command. The README's own
first-run path is the five `settings` env vars, which `buildSeedSettings` honours on
first run only (D31b/D31c): `SPIRALDB_PATH` (the corpus this clone writes to) and
`USER_NAME` (the D38 identity gate — without it every save 500s, D70(h)) are the two
that matter here. The rest keep their seeded defaults (D3's prebuilt `imcodec`, the
owner's Aurorium WAD read-only via `AURORIUM_PATH`'s default, `git_branch` =
`content/{today}` D31c).

```
SPIRALDB_PATH=/tmp/p5-09/corpus      # the throwaway corpus — never the owner's fork
USER_NAME="Dry Run (p5-09)"          # D38: the name every save/transition is attributed to
SPIRALDB_UI_DB=/tmp/p5-09/dryrun.db  # D44 + this story's fix: the isolated database
```

Read back through the API on the running clone (identity asserted before any probe):

```
$ curl -s localhost:3001/api/settings
{ "aurorium_path": "/home/jason/Documents/git-projects/Aurorium",
  "git_branch":    "content/2026-09-27",
  "imcodec_path":  ".../Imcodec.Cli/bin/Debug/net9.0/linux-x64/imcodec",
  "spiraldb_path": "/tmp/p5-09/corpus",
  "user_name":     "Dry Run (p5-09)" }
```

`PUT /api/settings` was exercised too (D32's contract, and the Phase-1 AC line) — see the
regression checklist in D3, where the invalid-path 400 is re-checked live.

## 4. `npm run sync` — isolated, and provably not needing the SDK

```
$ SPIRALDB_UI_DB=/tmp/p5-09/dryrun.db SPIRALDB_PATH=/tmp/p5-09/corpus \
  USER_NAME="Dry Run (p5-09)" PATH=/tmp/p5-09/bin:$PATH npm run sync
[spiraldb-ui] sync database at /tmp/p5-09/dryrun.db
=== SpiralDB UI — friendly-name sync ===
  status              : SUCCESS
  revision            : V_r806919.Wizard_1_610
  tree                : unpacked /tmp/spiraldb-wad-oi3AWy
  items               : 79,835     spells: 18,173     npcs: 23,033
  quests              : 328        zones: 1,241       drop_tables: 317
  string_table        : 216,991
  manifest entries    : 137,423 ids   manifest ids used: 121,041 (fallback 0)
  id mismatches       : 0 rows       missing manifest: 0 rows   dropped (PK): 0
  unpack / scan / write: 18.2 s / 3.3 s / 450 ms      total: 22.0 s
  sync_history        : success row written
rc=0
```

**The isolation is proven on three axes, not assumed** (this is the fix's proof):

| Axis | Evidence |
|---|---|
| the script says which file it opened | `[spiraldb-ui] sync database at /tmp/p5-09/dryrun.db` (a line that did not exist before this story) |
| that file is the one written | `/tmp/p5-09/dryrun.db` exists, **37,699,584 B**, and holds the sync's own rows (`sync_history`, 79,835 items, 216,991 strings) |
| nothing else was written | `<clone>/data/` **does not exist** (the pre-fix code would have created it) **and** the developer's live database is byte-identical across the run: `sha256 84c1b7f6…ba25b`, `mtime 2026-09-27 21:19:10.251805384`, `38268928 B` — the same three values in `/tmp/p5-09/live-db-before.txt` and after |

A second full sync (identical counts) confirms the Phase-1 "re-running sync replaces,
does not duplicate" line: 79,835 / 18,173 / 23,033 / 328 / 1,241 / 317 / 216,991 both times.

**"Sync needs no .NET SDK (D3)" — verified by falsification, not restated.** A `dotnet`
shim that logs its invocation and exits 1 was placed first on `PATH`
(`/tmp/p5-09/bin/dotnet`), the log was emptied, and a full unpack-and-write sync ran:

```
$ rm -f /tmp/p5-09/dotnet-called.log
$ PATH=/tmp/p5-09/bin:$PATH npm run sync          # the run above
  status : SUCCESS  ...  total: 30.9 s           rc=0
$ cat /tmp/p5-09/dotnet-called.log
cat: /tmp/p5-09/dotnet-called.log: No such file or directory   # never invoked
```

So the prebuilt `imcodec` apphost does the unpack on its own (D3), and the SDK is only
needed by `npm run build:cli`.

**A count reconciled rather than assumed:** sync wrote **328** `quests` rows and the corpus holds
**328** quest `.json` files with **328** distinct `m_questName` values (**0 duplicates**, scanned
directly). My first read of the corpus said 329 because `ls` counted the legacy
`QuestTemplates/droptables/` subdirectory as an entry; the corrected count is stated here so the
number in this record is the one that can be reproduced. (ZoneTransfer is the family where a
collapse *does* happen: 1,207 files → 1,205 rows, gate-4 §2 line 1.)

## 5. `npm run build:cli` — a real finding: the build is location-dependent

**The first-time dry run's step 5 fails in a clone at an arbitrary path.** Run verbatim:

```
$ npm run build:cli                                                    rc=1
/tmp/p5-09/spiraldb-ui/tools/PacketReaderCli/PacketReaderCli.csproj : warning MSB9008:
  The referenced project ../../../Imview/src/Imview.PacketReader/Imview.PacketReader.csproj
  does not exist.
Program.cs(3,7): error CS0246: The type or namespace name 'Imcodec' could not be found
Program.cs(4,7): error CS0246: The type or namespace name 'Imview' could not be found
Program.cs(204,47): error CS0246: The type or namespace name 'QuestTemplate' could not be found
    3 Warning(s)    3 Error(s)      Time Elapsed 00:00:09.30
```

**F1 — `tools/PacketReaderCli/PacketReaderCli.csproj` (and `tools/FixtureGen/…`) reference
the Imview tree by a path relative to *the checkout's parent*:**

```xml
<ProjectReference Include="../../../Imview/src/Imview.PacketReader/Imview.PacketReader.csproj" />
```

`../../../` is measured from `<checkout>/tools/PacketReaderCli/`, so it means
`<parent of the checkout>/Imview/...`. That holds only when the checkout sits beside
`Imview` — true of the developer's own `~/Documents/git-projects/` layout (which is why
every gate story's `build:cli` is green), and false for a clone in `/tmp` (or anywhere
else). D18's flags govern *where the outputs land*, not *where the sources are found*, so
nothing in the recorded decisions covers this. The README's "Getting Started commands all
work verbatim on a clean checkout" is therefore **not** true for this one command unless
the clone is placed as a sibling of `Imview`. p5-08 deferred the clean-checkout half to
this story; this is what the clean checkout found. **Reported, not papered over** — the
fix is a property (e.g. an overridable `ImviewRoot`) rather than a path literal, and it is
a change to a `.csproj` the owner may care about, so it is not silently made here.

**What was done instead, named:** the clone's *parent* was given the layout the csproj
assumes — `/tmp/p5-09/Imview/` as a **real directory** (not a symlink: a symlinked tree
spells the same Imview/Imcodec projects under two paths, and MSBuild then builds them
twice and fails with `CS0234: 'IO' does not exist in the namespace 'Imcodec'` — a rig
artefact, *not* a repo defect, and recorded here so nobody re-diagnoses it). The directory
holds a 29 MB copy of `Imview/src` + `Imview/submodule/Imcodec/src` **without `bin/`/`obj/`**,
so the build below is a genuine **cold** build (the clone's `tools/.artifacts` was deleted
first and the clone's own `tools/.nuget` was populated by the restore):

```
$ rm -rf tools/.artifacts && npm run build:cli                          rc=0
    18 Warning(s)   0 Error(s)     Time Elapsed 00:00:41.41 (real 41.8 s)
  tools/bin/imview-packet-reader -> ../.artifacts/bin/PacketReaderCli/release/imview-packet-reader
  tools/.artifacts 152M   tools/.nuget 287M (a full cold package restore)
```

So the **D18 recipe itself is sound from scratch** (0 errors); what is not sound is the
*reference path* that finds the sources. Two secondary notes from the same run:

- `NU1900` × 18: the restore tried to write `$HOME/.local/share/NuGet/http-cache/…_api.nuget.org_v3_index.json/vuln_index.dat-new` and was denied by this session's sandbox. Warnings only — the build succeeded — but D18's "zero writes to `$HOME`" claim covers packages (`NUGET_PACKAGES`), not the NuGet **http-cache**, which is still `$HOME`-based.
- The Imview tree was read only: `git -C …/Imview status --porcelain` = 0 lines and 0 files
  modified in the build window.

## 6. `npm run dev` comes up

```
$ SPIRALDB_UI_DB=/tmp/p5-09/dryrun.db VITE_PORT=5190 npm run dev        (/tmp/p5-09/d1-dev.log)
[client]  VITE v5.4.21  ready in 235 ms   ➜  Local:   http://localhost:5190/
[server]  [spiraldb-ui] database ready at /tmp/p5-09/dryrun.db
[server]  Imported 2277 existing entries from SpiralDB
[server]  [spiraldb-ui] import detail: 3 skipped, 0 unparsable
[server]  [spiraldb-ui] import duplicate keys (first file wins): WizardCity/Tutorial_Exterior,
          WizardCity/Tutorial_Interior
[server]  [spiraldb-ui] API listening on http://localhost:3001
[server]  [spiraldb-ui] client/dist not built — API only (run `npm run build`)
```

- Express on **:3001** (the Vite proxy's fixed target) and Vite on **:5190** — `VITE_PORT`
  because the owner's other project (`card-gatcha-1`) holds `[::1]:5173` and is **not ours
  to kill** (D78(b)). `5173` was left alone; the only other listener afterwards is that
  sibling's.
- **Rig identity asserted before probing** (D70(h)): the boot log names
  `/tmp/p5-09/dryrun.db`, `GET /api/settings` returns `spiraldb_path=/tmp/p5-09/corpus`,
  and `GET /api/health` → `{"status":"ok"}`.
- The first-startup import ran **once** against the throwaway corpus: `imported 2277`
  (quest 328 · drop_table 317 · npc_inventory 215 · npc_spell_inventory 77 ·
  creature_spellbook 134 · treasure_card_inventory 1 · zone_transfer 1205 ·
  npc_drop_table 0) — D21/D37 live in a fresh clone, and the restart arm is in D3.

**D1 verdict: the fix works and is proven; the clone is up; one real release-rights finding
(F1) blocks the documented `build:cli` step for any checkout not placed beside `Imview`.**