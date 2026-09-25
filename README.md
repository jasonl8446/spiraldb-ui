# SpiralDB UI

A web-based tool for extracting, reviewing, editing, and verifying [SpiralDB](https://github.com/Revive101/spiraldb) content entries for the [Imlight](https://github.com/Revive101/Imlight) game server.

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

- [Full Application Spec](Docs/spec-spiraldb-ui.md) — Architecture, workflows, verification system, API design
- [Friendly Name Resolution](Docs/spec-friendly-names.md) — WAD parsing, SQLite schema, sync script design
- [SpiralDB Reference](Docs/spiraldb-reference.md) — JSON schemas and directory structure for all object types

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
