# Phase 4 — Other Object Editors

**Status:** pending approval
**Depends on:** Phase 1 (names/status APIs, FriendlyNameDropdown, save-pipeline primitives); Phase 3 task 3.6 (RequirementTreeEditor — reused by DropTable items, [spec-domain-reference.md](./spec-domain-reference.md) L708–709) and the D5 fidelity pattern
**Spec reading order before starting:** [spec-domain-reference.md](./spec-domain-reference.md) L27–309 (all non-quest schemas) → [spec-data-model.md](./spec-data-model.md) L171–204 (naming + embedded audit fields) → [spec-ui-design.md](./spec-ui-design.md) L458–486 → [spec-api.md](./spec-api.md) L180–204

## Requirements Summary

List/detail/create/edit/save+commit flows for the remaining 8 object types: DropTable, NpcInventory, NpcSpellInventory, CreatureSpellbook, NpcDropTable, TreasureCardInventory, ZoneTransfer (WizardZoneData), GlobalRegistry. All share one scaffolding pattern; per-type work is the form + validation + key/filename rules. Verification status applies to all types **except GlobalRegistry** (open question Q1 resolution: editor only, no status tracking — matches [spec-data-model.md](./spec-data-model.md) L32–37 and L277).

## Tasks

### 4.1 Generic object scaffolding — M
- **Server**: router factory `createObjectRouter(config)` where config = `{ dir, urlType, objectType (D4 mapping), keyField, keyType: 'string'|'ulong', newFilename(key), audit: 'embedded'|'none' }` implementing `GET /` (list: scan dir + JSON5 parse + join `entry_status`), `GET /:key`, `POST /` (save pipeline from task 2.4: clean-JSON write, embedded audit fields for non-quest types per [spec-data-model.md](./spec-data-model.md) L189–191, git commit `spiraldb: {create|update} {object_type} {key}`, status upsert on create). Mount per [spec-api.md](./spec-api.md) L182–193 base paths. Reads tolerate missing directories (`NpcDropTable/` absent today — verified); first save creates the directory.
- **Resolution is index-based, never filename-derived (D19)**: legacy files don't follow the convention (verified: `NPCInventories_1025-A.json`, `droptables_…json` plural prefix, `WizardZoneDatas_10017-A.json`, `NpcTreasureCards_2019-A.json`). Reuse the Phase 2 content-keyed index (scan + parse key field, rebuild on save): `GET /:key` and updates resolve key→original path; **updates write back to the original file**; `newFilename(key)` is used for creates only. New files follow the spec convention table exactly — including singular `droptable_{Name}.json` even though legacy uses `droptables_` (D26, owner-approved).
- **Filename rules** exactly per [spec-data-model.md](./spec-data-model.md) L173–187: `droptable_{Name}.json`, `npcinventory_{TemplateID}.json`, `npcspellinventory_{TemplateID}.json`, `creaturespellbook_{DeckName}.json`, `npcdroptable_{TemplateID}.json`, `treasurecardinventory_{TemplateID}.json`, `zonetransfer_{ZoneName with / → _}.json`, and single `globalregistry.json`.
- **Key encoding**: ulong TemplateIDs stored as strings in `entry_status.object_key` ([spec-data-model.md](./spec-data-model.md) L36) but as numbers in JSON — one conversion helper, unit-tested both directions.
- **Client**: refactor the Phase 2 quest browse into a generic `ObjectListPage` (filter tabs with counts, search, TanStack table, pagination, mobile cards, empty states — [spec-ui-design.md](./spec-ui-design.md) L238–271) and `ObjectDetailLayout` (header ← Back / type / key / StatusBadge / Edit / Save + JSON side-panel toggle — L462–469). Quests keep their tabbed page; simple types render a single form (L466).

### 4.2 DropTable editor — M
- Form sections per [spec-ui-design.md](./spec-ui-design.md) L471–477: **Basic** (Name, Description textarea, RollChance slider 0–1, Weight number, NoneChance slider 0–1, plus PityCounter), **Rewards** (MinGold/MaxGold range, ExperienceAmount, TrainingPoints, GrantsPotionSlot checkbox), **Items** repeater (ItemId via FriendlyNameDropdown `items`, ItemName auto-filled read-only, Notes, per-item `Requirements` → **inline RequirementTreeEditor** per [spec-domain-reference.md](./spec-domain-reference.md) L708–709), **Audit** (CreatedAt/ModifiedAt/CreatedBy/ModifiedBy — embedded in main JSON, [spec-data-model.md](./spec-data-model.md) L189–191).
- Field defaults per [spec-domain-reference.md](./spec-domain-reference.md) L77–91 (RollChance 1.0, Weight 100, etc.).
- Validation ([spec-domain-reference.md](./spec-domain-reference.md) L536–540): Name non-empty + unique across all drop tables (server-checked against corpus); RollChance and NoneChance within 0.0–1.0; MinGold ≤ MaxGold.

### 4.3 NpcInventory editor — S
- TemplateID (NPC FriendlyNameDropdown) + Inventory: searchable multi-select over `items` names rendered as removable chips ([spec-ui-design.md](./spec-ui-design.md) L479–482; schema [spec-domain-reference.md](./spec-domain-reference.md) L121–136).

### 4.4 NpcSpellInventory editor — S
- TemplateID (NPC dropdown) + Spells repeater: `{ TemplateID spell dropdown, RequiredSpellID spell dropdown with explicit "none (0)" option, Level number }` ([spec-domain-reference.md](./spec-domain-reference.md) L138–164).

### 4.5 CreatureSpellbook editor — S
- DeckName (text, key) + SpellTemplateIds list editor with spell dropdowns, reorderable ([spec-domain-reference.md](./spec-domain-reference.md) L27–42).

### 4.6 NpcDropTable editor — S
- TemplateID (NPC dropdown) + DropTableNames multi-select sourced from `drop_tables` names ([spec-domain-reference.md](./spec-domain-reference.md) L166–181).
- **Directory bootstrap**: `NpcDropTable/` does not exist in the SpiralDB repo today (verified) — first save creates it; first-startup import already tolerates its absence (Phase 1).

### 4.7 TreasureCardInventory editor — S
- TemplateID (NPC dropdown) + TreasureCards repeater `{ SpellName text, Price number }`; Price 0 = use spell template's `m_baseCost` (hint text); warn-not-block when SpellName matches no synced `spells.name` ([spec-domain-reference.md](./spec-domain-reference.md) L183–208; warn rule L542–546).

### 4.8 ZoneTransfer (WizardZoneData) editor — M
- ZoneName key (zone dropdown with humanized display, [spec-domain-reference.md](./spec-domain-reference.md) L700–702) + Teleports repeater: `TriggerName` text + nested `Teleport` object fields — `m_destinationLoc` (4-float string, format-validated), `m_destinationZone` (zone dropdown), `m_exitTeleporter`, `m_teleporterTag`, `m_transitionID` (numbers), `m_teleportType` (enum, e.g. TELEPORT_STATIC) ([spec-domain-reference.md](./spec-domain-reference.md) L281–309).
- **Schema drift guard**: real corpus files contain an `Events` field absent from the spec schema (verified). D5 merge-not-replace preserves it; the editor surfaces unrecognized top-level fields in a read-only "raw fields" disclosure so nothing is silently hidden or dropped.
- Filename: slash→underscore ([spec-data-model.md](./spec-data-model.md) L184).

### 4.9 GlobalRegistry editor — M
- Load: read **all** `GlobalRegistry/*.json`, merge dictionaries (case-sensitive keys, later files overwrite earlier — [spec-domain-reference.md](./spec-domain-reference.md) L102–119) into a single key→float table editor; add/edit/remove rows ([spec-domain-reference.md](./spec-domain-reference.md) L711–712).
- Save: write one `globalregistry.json`; commit `spiraldb: update global_registry globalregistry`.
- **Consolidate & replace (D22, owner-approved)**: save writes the merged dictionary to `globalregistry.json` **and `git rm`s every other `GlobalRegistry/*.json` in the same commit**. Rationale (verified): Imlight enumerates `GlobalRegistry/*.json` unsorted with later-wins merging (`Imlight/src/Imlight.CoreLib/WizardData/SpiralDB.cs` L341–347) — multiple files make effective values filesystem-order-dependent. The fork currently holds one legacy file (`GlobalRegistryModels_1-A.json`, 23 keys); after the first save the directory deterministically contains only `globalregistry.json`. Git history is the undo; the PR diff makes the consolidation reviewable before merge.
- No status tracking, not in dashboard totals (Q1 resolution).

### 4.10 Status integration for all types — S
- Every detail page: StatusBadge + Mark Reviewed / Mark Verified with notes dialog + history panel (components from task 2.8, driven by the Phase 1 status API which already covers all 8 types).
- Every list page: status dot column + filter tabs with counts (from `ObjectListPage`).
- Creates via POST set `extracted` + history note (e.g., `Created via UI`); edits do not change status.

## Acceptance Criteria

- [ ] List pages load real corpus data with verified counts: DropTables **317**, NpcInventory **215**, NpcSpellInventory **77**, CreatureSpellbook **134**, TreasureCardInventory **1**, ZoneTransfer **1207**; NpcDropTable shows its empty state gracefully (directory absent).
- [ ] For each of the 8 tracked types: open an existing entry → edit one field → save → in the test clone (`data/test-spiraldb`, D17) `git diff HEAD~1` shows only that field (plus one-time formatting normalization); commit message matches `spiraldb: update {object_type} {key}`; **the file keeps its original legacy name/path (D19)**.
- [ ] For each type: create a new entry via UI → file appears with the exact convention name from [spec-data-model.md](./spec-data-model.md) L173–187 (including `zonetransfer_WizardCity_WC_Hub.json` slash→underscore and singular `droptable_{Name}.json` per D26); commit action `create`; `entry_status` row = `extracted` with history note.
- [ ] Round-trip corpus tests extended (D5 pattern): every existing DropTable (317), NpcInventory, NpcSpellInventory, CreatureSpellbook, TreasureCardInventory, ZoneTransfer file passes parse → serialize(unedited) → re-parse deep-equal.
- [ ] DropTable validation blocks: Name empty / duplicate; RollChance 1.5; NoneChance -0.1; MinGold 100 + MaxGold 10 — each yields inline error + disabled Save + server 400 on direct POST.
- [ ] DropTable item with a requirement tree: add `ReqHasQuest{NOT}` on an item row via the inline RequirementTreeEditor → saved JSON matches the polymorphic shape; reload renders the same tree.
- [ ] ItemId dropdown selection auto-fills read-only ItemName from the synced names DB.
- [ ] NpcDropTable first save creates the `NpcDropTable/` directory in the test clone and the file inside it.
- [ ] TemplateID round-trip: ulong keys stored as strings in `entry_status.object_key` resolve back to the correct JSON number on detail load (unit test + one live check per ulong-keyed type).
- [ ] GlobalRegistry (D22): merged view equals the manual merge of all registry files; save produces a commit containing the new `globalregistry.json` **and the deletion of `GlobalRegistryModels_1-A.json`**; afterwards the directory holds exactly one file; type absent from dashboard and status routes (Q1 resolved: no tracking).
- [ ] TreasureCardInventory: SpellName not present in synced spells → warning (not blocking); Save succeeds.
- [ ] Status flows: Mark Reviewed with notes on a DropTable → history endpoint + list-page dot + filter-tab counts all update.
- [ ] Mobile (≤768px) pass evidenced via Playwright viewport (D23, screenshots in `Docs/evidence/phase-4/`): every list page renders as card list; detail forms usable; JSON panel is a full overlay.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| ulong key string/number mismatch | Wrong status joins, orphaned rows | Single conversion helper + dedicated unit tests (4.1) |
| GlobalRegistry merge-order semantics (Q5) | Saved values silently overridden by legacy files at runtime | **Resolved (D22):** consolidate & replace — single `globalregistry.json`, legacy files `git rm`ed in the same commit; git history is the undo |
| Per-type schema drift from real files (fields not in spec tables) | Field loss on save | D5 merge-not-replace applies to all types; corpus round-trip tests per type |
| DropTable duplicate-name check across 317 files | Slow saves | Check against the in-memory list scan already performed for `GET /`; negligible at this scale (D12) |
| Eight near-identical editors → copy-paste divergence | Maintenance rot | 4.1 scaffolding first; per-type code limited to form schema + validation config; reviewer checks for factory reuse |
| `m_destinationLoc` free-text format errors | Broken teleports in game | Regex validation `^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$` with inline hint |

## Verification Steps

1. `npm test` → extended round-trip suites green per type (counts printed vs `ls | wc -l` per directory).
2. Per-type smoke loop (scripted checklist): list → open first entry → edit → save → `git -C data/test-spiraldb log -1 --format=%s` → `git -C data/test-spiraldb diff HEAD~1 --stat`.
3. Create-one-new-entry loop per type; verify filenames against [spec-data-model.md](./spec-data-model.md) L173–187.
4. Validation negatives (curl 400s + UI inline errors) for DropTable cases above.
5. GlobalRegistry: `cat` merged output vs editor table; `git status` in SpiralDB shows only `globalregistry.json` changed.
6. Browser at 375px and 768px widths for list/detail passes.

**Done when:** all acceptance criteria checked with evidence in the PR; the owner-confirmed Q1/Q5 resolutions (recorded as D19/D22/D26 + Q1 in [plan-overview.md](./plan-overview.md)) are honored verbatim.
