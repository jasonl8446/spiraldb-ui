# Story p1-10 — UI shell + shared components (task 1.8)

Commits `81de694` (shell) and `b8e80c6` (toast accent fix) on `phase-1-foundation`.
Protocol: D23 tier 2 — the lead drove the real dev stack (`npm run dev`, Express
:3001 + Vite :5173) with playwright-mcp, against the real `data/spiraldb-ui.db`.
All UI automation uses `http://localhost:5173` (Vite binds `[::1]` only — D38).

Screenshots: [`p1-10-01-sync-spinner.png`](./p1-10-01-sync-spinner.png),
[`p1-10-03-error-toast.png`](./p1-10-03-error-toast.png),
[`p1-10-04-success-toast.png`](./p1-10-04-success-toast.png).

## ac1 — sidebar, collapse, active state, header Sync

Measured layout (spec-ui-design L18–43, L47–109):

```
sidebarBox "260x800"  sidebarBg rgb(24,24,27)   # 260px fixed, zinc-900
headerBox  "1020x56"  headerBg  rgb(24,24,27)   # 56px sticky, zinc-900
bodyBg     rgb(9,9,11)                          # zinc-950
pageTitle  "Dashboard"                          # header h2 follows the route
groups     ["OVERVIEW","QUESTS","DATA","SETTINGS"]   # all four, collapsible
navLinks   12 — Dashboard / Extract Quests / Browse Quests / Drop Tables /
           NPC Inventories / NPC Spell Inventories / Creature Spellbooks /
           NPC Drop Tables / Treasure Card Inventory / Zone Transfers /
           Global Registry / Sync Friendly Names
active     Dashboard: bg rgba(37,99,235,0.1) (= blue-600/10), color rgb(96,165,250) (= blue-400)
```

Group collapse (DATA): `visibleBefore true → afterCollapse false (aria-expanded=false) →
afterReexpand true`. Sidebar navigation to an unbuilt route:

```
/npc-spell-inventories → title "NPC Spell Inventories", stub "Arrives in Phase 4"
/zone-transfers        → title "Zone Transfers",        stub "Arrives in Phase 4"
```

Header Sync button — the whole cycle, measured on a real 22-second sync:

```
idle       text "Sync"      svg "lucide-refresh-cw h-4 w-4"
during     text "Syncing…"  disabled=true  svg "lucide-loader-circle h-4 w-4 animate-spin"
complete   toast success "Sync complete: 79,835 items · 18,173 spells · 23,033 NPCs · 322 quests · 1,241 zones"
after      text "Sync"      svg "lucide-check h-4 w-4 text-emerald-400"   # L108 spinner → checkmark
```

## ac2 — FriendlyNameDropdown against real synced names

The dropdowns open on a capped list of live rows:

```
items listbox: 50 options + "showing 50 of 79,835 matches — keep typing"
```

Searching `Twice Stitched` filters to exactly `["None","Twice Stitched Boots",
"Twice Stitched Hat","Twice Stitched Robe"]` (hint disappears below the cap).
Selecting an option writes the **raw id into a hidden input** while the button
shows the label — the spec's own example, verified both ways:

```
label "Twice Stitched Boots"          hidden input[type=hidden] name="preview_items" value="4808"
label "ArrotToMerles (161001)"        hidden name="preview_npcs"  value="161001"   # Name (TemplateID)
label "Firecat Alley"                 hidden name="preview_spells" value="607923"
```

Cross-checked against the real API — the labels are genuinely synced data, not
hardcoded: `GET /api/names/items/4808` → `{"gid":4808,"name":"Twice Stitched Boots"}`,
`/api/names/npcs/161001` → `{"template_id":161001,"name":"ArrotToMerles"}`,
`/api/names/spells/607923` → `{"template_id":607923,"name":"Firecat Alley"}`.
Zone humanization is consistent end to end: `/api/names/zones` returns
`{"zone_path":"Aquila/AQ_Z00_Hub","display_name":"Aquila / AQ Z00 Hub"}`.

Client-side filter cost over the full items list (D8's >5k-row risk):

```
items rows: 79835   toNameOptions: 22.3 ms (one-off, memoized)
query "ice" 1750 matches: 100 iterations = 297.8 ms  → 2.98 ms per keystroke filter
```

## ac3 — StatusBadge, tokens, toasts, mobile

Badges carry colour **and** text (`Status: Extracted` / `Reviewed` / `Verified`),
with the spec's dots: amber-500 `rgb(245,158,11)`, blue-500 `rgb(59,130,246)`,
emerald-500 `rgb(16,185,129)`.

Toast stack: five error toasts fired in a row → `{inDom: 5, visible: 3}` (max 3
respected, spec L113). Per-type accents, before and after `b8e80c6`:

```
BEFORE (b8e80c6^)  success: borderLeftWidth "0px"  borderLeftColor rgb(39,39,42)
                   error:   borderLeftWidth "0px"  borderLeftColor rgb(39,39,42)
AFTER              error:   class "border-l-4 border-l-red-500"     borderLeft rgb(239,68,68)  borderTopWidth 0px  alert icon
                   success: class "border-l-4 border-l-emerald-500" borderLeft rgb(16,185,129) borderTopWidth 0px  check icon
```

The computed `3.52941px` for `border-l-4` is this automation browser's scaling:
a plain control `<div class="border-l-4">` measured identically, so the declared
4px resolves as expected. Closing the error toast by its × removed it
(`closeButtonCount 1 → errorToastsAfterCloseClick 0`).

Mobile (390×844): `sidebarWidth 0`, `sidebarDisplay "none"`, hamburger visible →
overlay with **12** nav links → clicking `Drop Tables` (exact) navigated to
`/drop-tables` with title "Drop Tables" and `overlayStillOpen false` — the
overlay does not block navigation.

## ac4 — Settings page

Real values, all four fields editable, Save wired to `PUT /api/settings`:

```
Aurorium Path /home/jason/Documents/git-projects/Aurorium
Imcodec Path  …/Imcodec.Cli/bin/Debug/net9.0/linux-x64/imcodec
SpiralDB Path /home/jason/Documents/git-projects/spiraldb
User Name     Jason
buttons       Save, Sync Now
```

Error path — a real `PUT` that the server rejects, surfaced verbatim:

```
toast data-type=error "Could not save settings: aurorium_path \"/definitely/not/a/real/path\"
                       is not an existing directory"
```

Success path — restore + save → `"Settings saved"`, inputs re-read from the server.
Sync history table (headers `When | Status | Counts | Detail`, 12 rows), first row:

```
Sep 26, 2026 at 12:38 AMV_r806919.Wizard_1_610 | Success |
79,835 items · 18,173 spells · 23,033 NPCs · 322 quests · 1,241 zones | —
```

## Reproduce

```bash
npm run dev                      # :3001 + :5173
# open http://localhost:5173 (NOT 127.0.0.1)
# /settings → Save with a bogus Aurorium path → red-bordered error toast
# header Sync → spinner → checkmark → real-counts success toast (~22 s)
```
