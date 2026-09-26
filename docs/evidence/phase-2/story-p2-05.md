# p2-05 — Save pipeline: files + metadata (D20) + git (D13/D14) + status upserts + content-keyed index (D19) (task 2.4)

Branch `phase-2-quest-extraction`, HEAD `b9577d2` at dispatch (tree left **uncommitted** for the
lead). This is the shared save path every later object editor reuses, built server-side only — the
quests API is p2-06 and the Save All UI is p2-07.

New source: [`spiraldbFiles.ts`](../../../server/src/services/spiraldbFiles.ts) (collection table +
key resolution + JSON5 read + clean-JSON write + convention paths + the D45(1) merge + quest
metadata), [`spiraldbIndex.ts`](../../../server/src/services/spiraldbIndex.ts) (D19 content-keyed
index), [`git.ts`](../../../server/src/services/git.ts) (D14 guard, session branch, one commit per
object), [`savePipeline.ts`](../../../server/src/services/savePipeline.ts) (`saveObject`/`saveAll`);
[`db.ts`](../../../server/src/db.ts) gained the shared `writeSettings` helper and
[`routes/settings.ts`](../../../server/src/routes/settings.ts) now uses it (removing its route-local
upsert SQL). Tests: 4 new hermetic files + [`tests/helpers/temp-git-repo.ts`](../../../tests/helpers/temp-git-repo.ts)
— 555 → **639** unit tests in 22 → 26 files.

| AC | Result | Evidence |
|---|---|---|
| **p2-05-ac1** Save All of N quests → N convention-named clean-JSON files, N metadata files in the L193-204 shape, N commits on `content/{today}` from main HEAD, message `spiraldb: extract quest {name}`, author = `user_name`, `settings.git_branch` persisted | **PASS** | 3 real CLI extractions saved through `saveAll` into the disposable clone: three `QuestTemplates/questtemplates_DS-P205-AC1-00{1,2,3}.json` files, each `node -e JSON.parse` **exit 0**; three `questmetadata_DS-P205-AC1-00{1,2,3}.json` files with the exact 7 keys in spec order; `git log` = `spiraldb: extract quest DS-P205-AC1-003/002/001`, `%an` = the configured `user_name`, 3 commits, branch `content/2026-09-26`, `HEAD~3 == main`; `settings.git_branch` = `content/2026-09-26` ([`story-p2-05-ac1.txt`](./story-p2-05-ac1.txt)) |
| **p2-05-ac2** Metadata pairs by content (D20): an existing UUID-named file is updated in place, no `questmetadata_{name}.json` duplicate; a new quest creates the name-derived file | **PASS** | Target `WC-TUT-C05-001` → the corpus's UUID-named `QuestMetadatas/e1604f05-….json`: `ModifiedAt`/`ModifiedBy` refreshed, `CreatedAt`/`CreatedBy`/`Description` and key order preserved, metadata file count unchanged and **no** `questmetadata_WC-TUT-C05-001.json`; the brand-new quests of ac1 did create one ([`story-p2-05-ac2.txt`](./story-p2-05-ac2.txt)) |
| **p2-05-ac3** A dirty SpiralDB tree fails with the actionable error and writes nothing (D14) | **PASS** | `DirtyRepoError` with the actionable message; **no** file, no metadata, no commit, no status row; nothing auto-stashed; the same save succeeds once the tree is clean ([`story-p2-05-ac3.txt`](./story-p2-05-ac3.txt)) |
| **p2-05-ac4** Every saved quest gets an `entry_status` row (quest, extracted) + a history row naming the capture, reflected in dashboard counts | **PASS** | Rows present with `status='extracted'`; each has a history entry whose note names the capture file; `readDashboard` counts the additions ([`story-p2-05-ac4.txt`](./story-p2-05-ac4.txt)) |
| **p2-05-ac5** An existing name is updated, metadata `ModifiedAt`/`ModifiedBy` refreshed, committed with action `update` | **PASS (server half — see the split below)** | Part A (legacy corpus file `WC-TUT-C05-001`): outcome `updated`, action `update`, every *value* unchanged, key order preserved, **19/19 explicit nulls preserved**, the metadata refresh in the same commit. Part B (byte-identical corpus file `WC-TUT-C08-001`, 19 nulls): `git diff --unified=0` is **exactly one line** — the single deliberately edited value ([`story-p2-05-ac5.txt`](./story-p2-05-ac5.txt)) |
| **p2-05-ac6** Content-keyed index (D19) built by scanning + JSON5-parsing key fields; `GET /:key`/updates resolve through it, never filename-derived; updates write back to the original path | **PASS** | A temp tree whose file is deliberately named off-convention resolves by key; the update wrote back to that original path and created no name-derived file; rebuild stats scan the type directories and JSON5-parse the key field, tolerating missing dirs ([`story-p2-05-ac6.txt`](./story-p2-05-ac6.txt)) |

## D48 — the extraction output's enums, and the save pipeline's measured corpus contract

The executor's own survey found that the CLI's body and the corpus differed beyond the nulls D45(1)
predicted: `m_activityType` came back as `0` where the corpus holds `"ACTIVITY_NotActivity"`. The
lead measured the scope and fixed it at the source:

- The corpus writes **every** enum-valued field as its **name** — `m_goalType` ×772, `m_operator`
  ×673, `m_activityType` ×322, `m_bountyType` ×5, `m_teleportType`/`m_routingType` ×1 — while D45's
  settings (Imlight's own) serialise enums as integers. Unfixed, every quest this pipeline saved
  would have rewritten those fields: permanent representation churn in the owner's corpus.
- Fix: `StringEnumConverter` added to the CLI's `s_jsonSettings`. Imlight has no converter but
  Newtonsoft reads a name **or** a number into an enum, so names stay loadable; p2-03's
  `verify:captures` normalises both forms and stayed green.
- Proof: the real CLI's body vs `questtemplates_WC-UNICORN-MAIN-004.json` now shows **"NONE — every
  shared key serialises identically, enums included"**; the only residual divergences are the
  corpus's 75 explicit nulls and formatting — both handled or spec-blessed
  ([`story-p2-05-context-cli-vs-corpus.txt`](./story-p2-05-context-cli-vs-corpus.txt)).
- Also measured and recorded in D48: legacy normalisation (306/322 files carry a trailing comma,
  306 lack the final newline, 317 have integral floats — all independently re-verified by the lead),
  the missing `entry_status.extracted_by` column, the 8 quest names with **two** metadata files each
  (324 files / 316 names), and the `simple-git` `EDITOR=nano` commit hazard the git service works
  around with an allow-list environment.

## Lead verification (independent, this round)

- **The acceptance harness re-run after the CLI fix**: `npm run test:reset-clone && npx tsx
  data/__test-scratch__/p2-05-acceptance.ts` → **27/27 checks passed**, clone reset afterwards
  (`main` at `c55ccab`, clean, no `content/*` branch). Full stdout:
  [`story-p2-05-harness-rerun.txt`](./story-p2-05-harness-rerun.txt).
- **The CLI's own contract still holds** after the serializer change: an empty array → `[]` exit 0;
  a non-capture → exit 1 with the named `is not a packet capture` error; bad arguments → exit 1 with
  usage. `npm run build:cli` exit 0 and `npm run verify:captures` → **5 fixtures, 50 field checks,
  0 mismatches**.
- **Gate** ([`gate-p2-05.txt`](./gate-p2-05.txt)): **26 files / 639 tests**, 8 UI specs, eslint 0,
  prettier 0, `typecheck:tests` 0, server + client `tsc --noEmit` 0, `npm run build` 0.
- **Hygiene**: 0 files changed under `Imview` and `~/.nuget`; the owner's real fork
  (`spiraldb`) has an empty `git status`, no new branch and no new commit; the disposable clone is
  back to `main`.

## Not claimed / flagged

- **ac5's confirmation dialog is UI and belongs to the Save All flow (p2-07).** This story ships and
  tests the server half — existence detection, the `update` action, the metadata refresh, no
  duplicate metadata — and reports the split rather than implying the dialog shipped.
- The end-to-end harness lives under the gitignored `data/__test-scratch__/`, so it is a scratch
  reproduction aid, not a committed artifact; the durable proof is the 84 hermetic tests plus the
  committed evidence files. Reproduce with `npm run test:reset-clone && npx tsx
  data/__test-scratch__/p2-05-acceptance.ts` (it refuses a dirty clone so ac1 cannot silently
  degrade into an update) and reset the clone afterwards.
- `ZoneTransfer/` holds genuine duplicate keys and `NpcDropTable/` does not exist in the corpus; the
  index records these rather than failing (D48(f)).
- The D45(1) minimality proof feeds a null-stripped corpus copy for the legacy part because
  `NullValueHandling.Ignore` omits the corpus's explicit nulls; the merge preserves them on write, so
  the only real difference is the one-time textual normalisation (D48(b)).