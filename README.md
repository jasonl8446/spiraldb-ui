# SpiralDB UI

A web-based tool for extracting, reviewing, editing, and verifying [SpiralDB](https://github.com/Revive101/spiraldb) content entries for the [Imlight](https://github.com/Revive101/Imlight) game server.

> ⚠️ **Unofficial project:** SpiralDB UI is not an official [Revive101](https://github.com/Revive101) project. It is an independent tool, not endorsed by or affiliated with Revive101. All referenced projects and game data belong to their respective owners.

> **Project status (2026-09-25):** specifications and the phased implementation plan are complete; no code has been written yet. The build plan of record is [docs/plan-overview.md](docs/plan-overview.md) (execution model + owner-approved decisions D1–D27) with per-phase tasks in `docs/plan-phase-{1..5}-*.md`.

## Purpose

SpiralDB is the static world data store for Imlight. It contains JSON files defining quests, drop tables, NPC inventories, spellbooks, zone transfers, and more. This tool provides a friendly interface for working with that data.

**Primary workflow:** Extract quest templates from packet captures → review → verify on a live Imlight server.

**Secondary workflow:** Edit and create all other SpiralDB object types with human-readable name dropdowns instead of cryptic numeric IDs.

## Features

- **Quest Extraction** — Import packet captures and reconstruct QuestTemplate JSON via [Imview.PacketReader](https://github.com/Revive101/Imview)
- **Friendly Names** — Resolve numeric IDs to human-readable names from game WAD files via [Imcodec](https://github.com/Jooty/Imcodec)
- **Verification Tracking** — Three-state lifecycle (extracted → reviewed → verified) with notes and history
- **Form-Based Editors** — Visual editors for all 9 SpiralDB object types with dropdowns and validation
- **Goal Logic Flowchart** — Visual editor for quest goal dependency chains
- **Dialog Editor** — Full NPCDialogEntry editing with camera, sound, and madlib support
- **Auto-Commit** — Saves directly to the SpiralDB repository with git auto-commit and metadata generation
- **Dashboard** — Verification progress tracking across all object types

## Architecture

```
React + TypeScript frontend
Node.js + Express backend
SQLite local database (verification status + friendly names)
.NET CLI tools (Imview.PacketReader + Imcodec.Cli)
```

## Prerequisites

- **Node.js 18+**
- **.NET 9 SDK** — for Imview.PacketReader and Imcodec.Cli
- **Git** — for auto-commit functionality
- **[Aurorium](https://github.com/Revive101/Aurorium)** — game asset WAD files
- **[Imview](https://github.com/Revive101/Imview)** — packet reader and WAD parser
- **[SpiralDB](https://github.com/Revive101/spiraldb)** — output target

## Getting Started

> These commands become functional as Phase 1 (Foundation) lands; the repository currently contains specs and the plan only.

```bash
# Clone with dependencies available locally
git clone git@github.com:jasonl8446/spiraldb-ui.git
cd spiraldb-ui

# Install dependencies
npm install

# Sync friendly names from WAD files
npm run sync

# Start development server
npm run dev
```

## Documentation

**Specifications** (authoritative):

- [Domain Reference](docs/spec-domain-reference.md) — SpiralDB JSON schemas, type enumerations, validation rules, CLI wrapper spec, WAD/string-table details
- [Architecture](docs/spec-architecture.md) — System design, tech stack, data flow, external dependencies
- [Data Model](docs/spec-data-model.md) — SQLite schemas, verification lifecycle, file naming, git branch strategy
- [API Reference](docs/spec-api.md) — REST endpoints and frontend URL routes
- [UI Design](docs/spec-ui-design.md) — Layout, components, color palette, interaction patterns

**Implementation plan** (how the specs get built):

- [Plan Overview](docs/plan-overview.md) — Roadmap, environment baseline, execution model, decisions D1–D27
- [Phase 1 — Foundation](docs/plan-phase-1-foundation.md) · [Phase 2 — Quest Extraction](docs/plan-phase-2-quest-extraction.md) · [Phase 3 — Quest Editing](docs/plan-phase-3-quest-editing.md) · [Phase 4 — Object Editors](docs/plan-phase-4-object-editors.md) · [Phase 5 — Dashboard & Polish](docs/plan-phase-5-dashboard-polish.md)

Agent instructions: [AGENTS.md](AGENTS.md).

## Related Projects

| Project | Description |
|---------|-------------|
| [SpiralDB](https://github.com/Revive101/spiraldb) | Static world data store (JSON files) |
| [Imlight](https://github.com/Revive101/Imlight) | Game server that loads SpiralDB |
| [Imview](https://github.com/Revive101/Imview) | Desktop GUI for inspecting/editing game content |
| [Aurorium](https://github.com/Revive101/Aurorium) | Game asset fetcher and file server |
| [Imcodec](https://github.com/Jooty/Imcodec) | WAD archive parser and ObjectProperty serializer |

## License

TBD
