# p2-07 — Extraction UI: dropzone, spinner, results split layout, Save All confirm, cancel (task 2.6)

Branch `phase-2-quest-extraction`, HEAD `8f19f87` at dispatch (the whole story stayed **uncommitted** for
the lead). The first client-side story of Phase 2, and the first story whose acceptance is **browser**
evidence (D23 tier 2).

New client code: [`ExtractionPage.tsx`](../../../client/src/pages/ExtractionPage.tsx),
[`useExtraction.ts`](../../../client/src/hooks/useExtraction.ts) (phases + `AbortController` + epoch guard),
[`useIsMobile.ts`](../../../client/src/hooks/useIsMobile.ts),
[`lib/extract.ts`](../../../client/src/lib/extract.ts) (all spec copy + `formatFileSize` + untrusted-quest
readers), and `components/quest/{ExtractDropzone,ExtractingCard,QuestListPanel,QuestPreview,QuestPreviewDialog,SaveConfirmDialog}.tsx`.
Changed: [`App.tsx`](../../../client/src/App.tsx) + [`lib/routes.ts`](../../../client/src/lib/routes.ts)
(`/quests/extract` renders the real page), [`lib/api.ts`](../../../client/src/lib/api.ts)
(`extractQuests`/`saveQuest` + types; **and a real latent-bug fix** — `apiFetch` stamped
`Content-Type: application/json` on every body, which would have broken the multipart upload),
[`lib/toast.ts`](../../../client/src/lib/toast.ts) + [`lib/notify.ts`](../../../client/src/lib/notify.ts).

| AC clause | Result | Evidence |
|---|---|---|
| Dropzone copy includes **"Supported format: JSON packet capture files (.json)"**; spec geometry | **PASS** | Measured live: that string verbatim, dashed `zinc-700` (`rgb(63,63,70)`), `zinc-900/50` (`rgba(24,24,27,0.5)`), rounded-xl, 48px icon, `accept=".json"`, drag copy ([`story-p2-07-tier2.txt`](./story-p2-07-tier2.txt) §1, [`p207-01-upload-dropzone.png`](./p207-01-upload-dropzone.png)) |
| **Indeterminate** spinner reading "Extracting quests..." | **PASS** | A real 105 MB capture through the real .NET CLI (`ps` shows the child mid-run): the copy, the file card (`big-capture.json`, 100.6 MB), exactly 1 `animate-spin` and **0** progress indicators, destructive Cancel, dropzone gone (§2, [`p207-02-extracting-spinner.png`](./p207-02-extracting-spinner.png)) |
| Results split layout: left 320px list, right tabbed read-only preview | **PASS** | Left panel measured **320px** with `overflow-y-auto`; the row renders name/level/goal count/`new`; the six tabs; **0** editable controls in the preview; the selected row computes to `blue-600/10` (§4, [`p207-03-results-split.png`](./p207-03-results-split.png)) |
| Confirm dialog before Save All | **PASS** | Verbatim "Save 1 quests to SpiralDB? This will create files and auto-commit."; the clone was still at `c55ccab`/clean while the dialog was open; 0 POSTs before confirming (§5) |
| **Cancel aborts (D9)** | **PASS** | Clicking Cancel at pid mid-run: the real CLI child disappeared in **~100 ms**, the temp upload and `/tmp/spiraldb-extract-*` were cleaned up, and the UI returned to the drop zone with no error (§3) |
| Mobile shows the preview as an overlay (375px) | **PASS** | At 375×667 the row is 310px wide (full width), the desktop pane is `hidden` (0×0, `offsetParent` null), tapping opens a centered `role=dialog` with the same six tabs and 0 editable controls; Escape returns to the list (§6, [`p207-07-mobile-375-overlay.png`](./p207-07-mobile-375-overlay.png), [`p207-08-mobile-375-list.png`](./p207-08-mobile-375-list.png)) |
| **D43's identity gate — first real caller** | **PASS** | With `user_name` blank, pressing Save opened the identity dialog and the clone stayed untouched; entering a name persisted it (`user_name: "Lead Verify"`) and the pending save resumed with no second click, landing commits authored `Lead Verify <Lead-Verify@spiraldb-ui.local>` (§5, [`p207-05-identity-gate-first-caller.png`](./p207-05-identity-gate-first-caller.png)) |
| Success toast "Quest {name} saved and committed" | **PASS** | Captured live together with the D48(d) warning toast (§5, [`p207-06-save-success-toast.png`](./p207-06-save-success-toast.png)) |
| Save All writes for real (file + metadata + commit + status) | **PASS** | Two commits on a new `content/2026-09-26` branch (416/210-210 line formatting-only template diff + metadata), `entry_status` inserted as `extracted`, `status_history` attributed to the entered name (§5) |

## Plan §2.4 L48/L49 — found missing in the browser run, then implemented

The lead's first tier-2 pass measured two plan §2.4 requirements the tree did not satisfy, and both were
implementable once p2-06's list endpoint existed:

- **The capture note (L48)** was absent because `POST /api/quests` had no way to learn the capture's name.
  `source` was added to the body; the note is written **when the save inserts a new `entry_status` row**.
  The first live save proved the original *file-outcome* rule wrong (`notes: null` on the normal
  extract-an-existing-quest path); after the fix the same live path writes
  `Imported from packet capture WC-UNICORN-MAIN-004.json` (§9.2).
- **The overwrite confirmation (L49, the UI half of p2-05's ac5)** now ships: the page checks
  `GET /api/quests` lazily before saving, the AC's Save All sentence is preserved verbatim and the existing
  names are listed in the same dialog, Save Selected gets the small per-name confirm, no POST happens before
  confirmation, and the check **fails closed** if the list cannot be read (§9.1,
  [`p207-09-overwrite-confirm.png`](./p207-09-overwrite-confirm.png)).

## Lead verification

- Gate, canonical, ports free ([`gate-p2-07-leadverify.txt`](./gate-p2-07-leadverify.txt)): **28 files /
  721 unit tests**, **28 UI specs**, eslint 0, prettier 0, `typecheck:tests` 0, server+client `tsc` 0,
  `npm run build` 0. (The executor's own two intermediate runs are in [`gate-p2-07.txt`](./gate-p2-07.txt).)
- Tier-2: everything in the table above is a **real** stack — real HTTP, real `.NET` CLI child observed with
  `ps`, real git commits in the disposable clone, real SQLite rows. **8 screenshots** in this directory.
- Three artifacts in the lead's own queries are recorded rather than hidden (tier-2 §7): a double-counted
  row, a `className.match` that matched `hover:bg-zinc-800/50` before the real `bg-blue-600/10`, and one
  long MCP call that dropped the connection (the save it was watching had in fact succeeded).
- **Hygiene**: the owner's fork stayed at `c55ccab` on `main` with an empty status; 0 files changed under
  `Imview`/`~/.nuget`; the disposable clone was reset after every run; all dev stacks stopped (ports free).

## Not claimed / flagged (D50)

- The browse table (p2-08) and the status UI (p2-09) are untouched; the `new` badge persists after a save
  because an extraction result carries no per-row saved state (D50(e)).
- Discard, the error state, the 768px mobile breakpoint, one-toast-per-quest and fail-closed list checking
  are all spec-silent choices, recorded in D50(b)/(c)/(d)/(f)/(h).
- The `docs/spec-ui-design.md` L199 format line contradicted this AC; it now carries an additive pointer
  note (D50(a)).
- Unproven here: real 413/409/500 generation through the UI (those are p2-04's and p2-06's), a mobile
  device (only viewport emulation), and per-request list cost (still open from D49(g)).
