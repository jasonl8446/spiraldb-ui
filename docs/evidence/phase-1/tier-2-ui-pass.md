# Phase 1 — D23 tier-2 UI evidence pass (story p1-14, plan AC#19)

One consolidated acceptance run over the **real** app: live Vite dev stack on
`http://localhost:5173` (HTTP-served, never `file://` — D23), the owner's real
database and the real sibling repositories. Every claim below is a measured DOM
assertion returned as JSON by `browser_evaluate`, not a prose walkthrough (D23:
"manual browser walkthrough" is not valid unattended evidence). Screenshots were
written to `/home/jason/.cache/playwright-mcp/` and copied here.

Run against `phase-1-foundation` at the commit that adds this file's parent
history (after the `activeNavPath` fix `b57e89f`, so the shell evidence below is
post-fix).

| Step | Screenshot |
|---|---|
| Shell (`/`) | [`p1-14-01-shell-dashboard.png`](./p1-14-01-shell-dashboard.png) |
| Settings (`/settings`) | [`p1-14-02-settings.png`](./p1-14-02-settings.png) |
| Sync spinner | [`p1-14-03-sync-spinner.png`](./p1-14-03-sync-spinner.png) |
| Sync success toast | [`p1-14-04-sync-toast.png`](./p1-14-04-sync-toast.png) |
| Dropdown smoke (3 types selected) | [`p1-14-05-dropdowns-selected.png`](./p1-14-05-dropdowns-selected.png) |

Per-story detail remains in [`story-p1-09.md`](./story-p1-09.md) (identity modal,
status transitions), [`story-p1-10.md`](./story-p1-10.md) (shell, live sync,
dropdown, toast accents), [`story-p1-13.md`](./story-p1-13.md) (tier-1 harness,
one-active-nav fix) and [`story-p1-05.md`](./story-p1-05.md) / [`spike-1.4a.md`](./spike-1.4a.md)
(spike + parser).

## 1. Shell — layout, navigation, active highlighting

`docs/spec-ui-design.md` L20–60 (260 px sidebar, 56 px header), plan AC#14.

```json
{
  "url": "/",
  "asideWidth": 259.9999694824219,      // 260 px per spec
  "headerHeight": 55.992645263671875,   //  56 px per spec
  "navItemCount": 12,
  "navItemTexts": ["Dashboard","Extract Quests","Browse Quests","Drop Tables",
    "NPC Inventories","NPC Spell Inventories","Creature Spellbooks","NPC Drop Tables",
    "Treasure Card Inventory","Zone Transfers","Global Registry","Sync Friendly Names"],
  "groupCount": 4,
  "groupLabels": ["OVERVIEW","QUESTS","DATA","SETTINGS"],
  "activeCount": 1,
  "activeText": ["Dashboard"],
  "activeStyle": { "bg": "rgba(37, 99, 235, 0.1)", "color": "rgb(96, 165, 250)" },
  "pageTitle": "Dashboard",
  "hasSyncButton": true,
  "syncButtonLabel": "Sync friendly names",
  "bodyBg": "rgb(9, 9, 11)"
}
```

Exactly one active item (`blue-600/10` + `blue-400`), 12 reachable routes in 4
collapsible groups, zinc-950 body — the fix from `b57e89f` holds. The same
assertion now runs on every route in the tier-1 suite
(`tests/ui/shell.spec.ts` test 1 + test 3).

Stub pages render their title, the phase that brings them and their path:

```json
{ "heading": "Drop Tables", "text": "Arrives in Phase 4",
  "paragraphs": ["This route is wired into the shell; the page itself is built in Phase 4.", "/drop-tables"] }
```

## 2. Settings — real values from the real API

Plan AC#13/#14 ("Settings … `GET` reflects"), `docs/spec-api.md` L291–321.

```json
{
  "url": "/settings",
  "headings": ["Settings"],
  "labels": ["Aurorium Path","Imcodec Path","SpiralDB Path","User Name"],
  "inputCount": 4,
  "domValues": {
    "aurorium_path": "/home/jason/Documents/git-projects/Aurorium",
    "imcodec_path": "/home/jason/Documents/git-projects/Imview/submodule/Imcodec/src/Imcodec.Cli/bin/Debug/net9.0/linux-x64/imcodec",
    "spiraldb_path":  "/home/jason/Documents/git-projects/spiraldb",
    "user_name": "Jason"
  },
  "apiValues": { "...": "(identical 4 keys, plus git_branch=content/2026-09-25)" },
  "inputsMatchApi": true
}
```

Every editable field equals what `GET /api/settings` returns (asserted against the
live endpoint in the same probe, not against a hardcoded expectation). Labels are
bound with `htmlFor` → `id` (the probe reads values through the DOM `id`).

**Observed and recorded, not a defect:** `git_branch` has no input. The page edits
the three paths plus `user_name` (`SETTINGS_FIELDS` + the user-name field); the
spec's own settings mockup (`docs/spec-ui-design.md` L490–504) shows only the path
fields. Since the Phase 2 save path commits to `git_branch`, a later phase must
surface it — recorded as **D42** so it is not a silent omission.

## 3. Sync — spinner, then a success toast with real counts

`docs/spec-ui-design.md` L121 (spinner → success toast), plan AC#14.

Clicked the header's `aria-label="Sync friendly names"` button and sampled the same
button every 60 ms:

```json
{ "before": { "text": "Sync", "disabled": false },
  "spinner": { "afterMs": 61, "text": "Syncing…", "hasAnimateSpin": true,
               "svgClasses": "lucide lucide-loader-circle h-4 w-4 animate-spin",
               "svgColor": "rgb(228, 228, 231)", "disabled": true } }
```

Then polled for the toast (found after **2 402 ms**, the warm re-sync path):

```json
{ "toast": { "text": "Sync complete: 79,835 items · 18,173 spells · 23,033 NPCs · 322 quests · 1,241 zones",
             "dataType": "success",
             "borderLeftWidth": "3.52941px", "borderLeftColor": "rgb(16, 185, 129)",
             "borderTopWidth": "0px" },
  "buttonAfter": { "text": "Sync", "disabled": false,
                   "svgClass": "lucide lucide-check h-4 w-4 text-emerald-400" } }
```

- The counts in the toast are the **real** counts, and they match the server row the
  sync just wrote (`sync_history` id **15**, `2026-09-26T06:16:16Z`, status
  `success`, `items_count 79 835`, `spells_count 18 173`, `npcs_count 23 033`,
  `quests_count 322`, `zones_count 1 241`, revision `V_r806919.Wizard_1_610`) —
  read back with the `better-sqlite3` driver, so the toast is not asserting a
  fixture.
- The emerald accent (`rgb(16,185,129)` = emerald-500) with `borderTopWidth: 0px`
  is the D39/p1-10 cascade-tie fix holding on current HEAD.

`GET /api/sync/history` returns the full history; `?limit=` is **not** in its
spec (`docs/spec-api.md` L269–287) and is ignored — verified, not a defect.

## 4. Dropdown smoke — real synced names, raw id stored

Plan verification step 6 ("dropdown smoke test on a stub page") and AGENTS.md
architecture rule 5 (friendly name shown, raw ID stored). Driven on `/drop-tables`
via `SharedComponentsPreview`. For each type the probe read the rendered options,
selected one through the real cmdk option, then cross-checked the stored raw id
against the live names API — so a hardcoded name table could not pass:

| Type | Query | Rendered options (first) | Selected display | Hidden field | `GET /api/names/…` | Match |
|---|---|---|---|---|---|---|
| items | `Twice Stitched` | `Twice Stitched Boots`, `…Hat`, `…Robe` | `Twice Stitched Boots` | `preview_items=4808` | `{gid: 4808, name: "Twice Stitched Boots"}` | ✅ |
| spells | `Firecat` | `Firecat Alley`, `FirecatAlleyCam` | `Firecat Alley` | `preview_spells=607923` | `{template_id: 607923, name: "Firecat Alley"}` | ✅ |
| npcs | `Arrot` | `AZ-Parrot-Darkshaman-A_StandIn (1397242)`, … | `AZ-Parrot-Darkshaman-A_StandIn (1397242)` | `preview_npcs=1397242` | `{template_id: 1397242, name: "AZ-Parrot-Darkshaman-A_StandIn"}` | ✅ |

The items probe also confirms the dropdown reads the **bulk** table with the D39
truncation policy: opening it unfiltered reported `showing 50 of 79,835 matches —
keep typing` (50-option cap against the real 79,835 items).

The page also renders `StatusBadge` in all three lifecycle states
(`Extracted` / `Reviewed` / `Verified`).

## 5. Console cleanliness

`browser_console_messages` with `all: false` (messages since the last navigation)
returned **`Total messages: 3 (Errors: 0, Warnings: 0)`** for a fresh load of `/`
and of `/quests`. Note for the record: with `all: true` the tool reports ~185
accumulated `ERR_CONNECTION_REFUSED` entries for `http://localhost:5173/` — these
are the MCP browser's history from earlier rounds in this session when the dev
stack was deliberately shut down between stories, **not** from this pass. The
tier-1 suite additionally asserts zero console errors on all 12 routes
(`tests/ui/shell.spec.ts`, including a self-check that the guard itself fails when
it should).

## Reproduce

```bash
npm run dev                      # real stack: Express :3001 + Vite :5173
# then, per step: navigate http://localhost:5173 + browser_evaluate the JSON above
curl -s localhost:3001/api/settings | jq .
curl -s "localhost:3001/api/sync/history" | jq '.history[0]'
```