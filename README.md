# SpiralDB UI

A web-based tool for extracting, reviewing, editing, and verifying [SpiralDB](https://github.com/Revive101/spiraldb) content entries for the [Imlight](https://github.com/Revive101/Imlight) game server.

> ⚠️ **Unofficial project:** SpiralDB UI is not an official [Revive101](https://github.com/Revive101) project. It is an independent tool, not endorsed by or affiliated with Revive101. All referenced projects and game data belong to their respective owners.

> **Project status:** all five implementation phases are implemented in-tree — foundation, quest extraction, quest editing, the eight other object editors, and dashboard & polish (search, activity feed, status filters, accessibility, responsive behaviour). The specifications and the phased plan stay authoritative: the build plan of record is [docs/plan-overview.md](docs/plan-overview.md) (execution model + owner-approved decisions D1–D87), with per-phase tasks and acceptance criteria in the five phase plans listed under [Documentation](#documentation).

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
- **Dashboard** — Verification progress across all object types, plus the recent-status activity feed
- **Global Search** — ⌘K / Ctrl+K palette over object keys and friendly names, grouped by type
- **Accessible & responsive** — keyboard-only flows, axe-clean key pages, and 375/768/1440px layouts

## Architecture

```
React + TypeScript frontend (Vite)
Node.js + Express backend
SQLite local database (verification status + friendly names)
.NET CLI tools (Imview.PacketReader wrapper + Imcodec.Cli)
```

**Two ways to run it.** Development serves the client from Vite and proxies `/api` to Express; production serves the built client *from* Express. Both run the same Express API and the same client code, and both answer every route with the SPA shell, so a deep link or a hard refresh on any route works in either mode:

| | dev | production |
|---|---|---|
| start with | `npm run dev` | `npm run build && npm start` |
| client served by | Vite (`:5173`; `VITE_PORT` overrides) | Express static, from `client/dist` |
| API | Express `:3001` (loopback only), reached through Vite's `/api` proxy | Express `:3001` (loopback only), directly |
| open | `http://localhost:5173` | `http://localhost:3001` |
| SPA fallback | Vite's history fallback | `app.get('*')` → `index.html` (`server/src/app.ts`) |

The frontend routes live in one place, [`client/src/lib/routes.ts`](client/src/lib/routes.ts) (20 routes). All 20 are deep-linkable and refresh-safe in both modes — measured route by route, with the two modes compared against each other, in [docs/evidence/phase-5/p5-08-d1-twomode.md](docs/evidence/phase-5/p5-08-d1-twomode.md).

`data/spiraldb-ui.db` (gitignored) holds verification status and the synced name tables. It is local to this project: no status or tracking field is ever written into the SpiralDB JSON files.

## Prerequisites

- **Node.js 20+** — [package.json](package.json) pins `engines.node` to `>=20`; verified here on v24.21.0 / npm 11.19.0.
- **Git** — for auto-commit on save.
- **A local SpiralDB clone** — the output target the JSON files are saved into. The default is the owner's fork at `/home/jason/Documents/git-projects/spiraldb`; point it elsewhere with `SPIRALDB_PATH` or on the Settings page.
- **[Aurorium](https://github.com/Revive101/Aurorium)** — the game asset WAD files friendly names are extracted from. Default `/home/jason/Documents/git-projects/Aurorium`; override with `AURORIUM_PATH`.
- **[Imview](https://github.com/Revive101/Imview)** — packet reader; **[Imcodec](https://github.com/Jooty/Imcodec)** is its submodule, and its CLI is what resolves friendly names.
- **.NET 9 SDK** — required **only** to build the packet-reader wrapper (`npm run build:cli`), i.e. only for quest extraction. Verified: `dotnet --version` → **9.0.318**. Syncing friendly names needs no SDK at all (see the prebuilt `imcodec` note below).

Settings are seeded **once**, when the database is first created, so set the environment variables before the first `npm run sync` / `npm run dev` / `npm start` if your clones are not at the defaults. The variables are `SPIRALDB_PATH`, `AURORIUM_PATH`, `IMCODEC_PATH`, `USER_NAME` and `GIT_BRANCH`; a non-empty value wins over the default, and an empty value counts as unset. Once the database exists, both the environment and the [Settings page](client/src/pages/SettingsPage.tsx) are yours to change.

### `npm run sync` runs before first use

Friendly names are **derived, never hardcoded**: the sync reads Aurorium's WAD files and rebuilds the name tables (`items`, `spells`, `npcs`, `quests`, `zones`, `drop_tables`, `strings`). Until it has run once, every name dropdown and the search palette's name arm are empty. It takes roughly 22 s and rewrites only those tables.

### `.NET` builds are sandbox-safe (decision D18)

`npm run build:cli` writes nothing into the Imview tree or `$HOME`. It sets `NUGET_PACKAGES=$PWD/tools/.nuget` and passes the artifacts-output layout to `dotnet build`:

```
-p:UseArtifactsOutput=true -p:ArtifactsPath=$PWD/tools/.artifacts
```

That keeps every project's `obj`/`bin` isolation under one in-workspace root; the script then symlinks the result to `tools/bin/imview-packet-reader`. `tools/.artifacts/`, `tools/bin/` and `tools/.nuget/` are gitignored. **Do not** substitute `-p:BaseIntermediateOutputPath` / `-p:BaseOutputPath` for them: those are global properties, so every referenced Imcodec project shares one `obj` directory and the build dies with `CS0579` duplicate-attribute errors.

### `imcodec` is a prebuilt binary, so syncing needs no SDK (decision D3)

`imcodec_path` defaults to the verified prebuilt CLI binary:

```
/home/jason/Documents/git-projects/Imview/submodule/Imcodec/src/Imcodec.Cli/bin/Debug/net9.0/linux-x64/imcodec
```

Override it with `IMCODEC_PATH` or on the Settings page.

## Getting Started

The commands a first run needs, in order:

```bash
# Clone this repository and enter it
git clone git@github.com:jasonl8446/spiraldb-ui.git
cd spiraldb-ui

# Install dependencies (the repo's .npmrc keeps npm's cache workspace-local)
npm install

# Point the tool at your own clones, if they are not at the defaults.
# Read when the database is first created, so export before the first run.
export SPIRALDB_PATH="$PWD/../spiraldb"
export AURORIUM_PATH="$PWD/../Aurorium"
export USER_NAME="Your Name"

# Rebuild the friendly-name tables from Aurorium's WAD files (~22 s).
# Required before first use: dropdowns and name search are empty without it.
npm run sync

# Optional, and the only step that needs the .NET 9 SDK: quest extraction.
npm run build:cli

# Development: Express :3001 (loopback only) + Vite :5173 → open http://localhost:5173
npm run dev
```

Production, which is what a release run looks like:

```bash
npm run build     # typechecks server + client, emits server/dist and client/dist
npm start         # Express on :3001 (loopback only) serves the built client — no Vite involved
```

### Everyday scripts

| command | what it does |
|---|---|
| `npm run dev` · `npm run build` + `npm start` | the two run modes above |
| `npm run sync` | rebuild the friendly-name tables from the WAD files (`npm run sync:dry-run` reports without writing) |
| `npm run build:cli` | build the packet-reader wrapper (needs the .NET 9 SDK; D18 flags) |
| `npm test` | unit + API suites (Vitest) |
| `npm run test:ui` | tier-1 browser suite (Playwright — see [UI tests](#ui-tests)) |
| `npm run lint` | ESLint + Prettier check (`npm run format` writes instead) |
| `npm run typecheck:tests` | the third tsconfig: `tests/**` + `playwright.config.ts` |

The rest (`build:server`, `build:client`, `dev:server`, `dev:client`, `sync:spotcheck`, `verify:captures`, `audit:corpus`, `build:fixturegen`, `test:reset-clone`) are defined in [package.json](package.json) with their flags rather than repeated here.

## UI tests

Tier-1 UI tests (plan task 1.10, decision D23) drive the real app in headless chromium against the dev stack — `playwright.config.ts` auto-starts `npm run dev` (Express :3001 + Vite on the harness's own port, `VITE_PORT=5181`) with `SPIRALDB_UI_SKIP_IMPORT=1`, so no data import is attempted on a fresh database.

```bash
# one-off: download chromium into the workspace (gitignored)
npm run test:ui:install

# run tests/ui/*.spec.ts headless
npm run test:ui
```

- **Both scripts pin the browser directory**, so the install and the run cannot disagree: they are `PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers playwright install chromium` and `PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers playwright test`. If you run `npx playwright install chromium` by hand you must set that variable yourself; browsers never come from `~/.cache/ms-playwright` or the Nix store (whose revision is coupled to a different playwright package).
- **The harness never uses port 5173.** `client/vite.config.ts` reads `VITE_PORT ?? 5173` and `playwright.config.ts` boots on **5181**, a port this project owns, so a sibling checkout squatting 5173 cannot stop the suite (it did, repeatedly). It also never reuses a running stack — a developer's own server holds the live database, and reusing it would drop the harness's throwaway-database isolation (`SPIRALDB_UI_DB`, decision D44).
- Artifacts, all gitignored: browsers in `tools/.playwright-browsers/`, traces and failure artifacts in `test-results/`, the HTML report in `playwright-report/` (`npx playwright show-report`). Screenshots a spec takes for its own evidence are written under `test-results/` too (the mobile pass's 22), so a full run cannot rewrite a committed PNG: the phase evidence under `docs/evidence/` is committed once, by the story that produced it. One exception, named rather than implied: the reduced-motion spec re-captures its own six `docs/evidence/phase-5/p5-05-reduced-motion-*.png` on every run, and those captures have been byte-identical on every run measured so far.
- The specs are **hermetic and deliberately mocked**: `tests/ui/shell.spec.ts` route-mocks `/api/settings`, `/api/sync`, `/api/sync/status`, `/api/sync/history` and the name tables, because CI has no sibling repositories, no `data/spiraldb-ui.db` and no WAD data. They test the UI — routing, highlighting, collapse, spinner/toast — not the sync engine: the real sync is covered by the unit tests and the tier-2 browser evidence in [docs/evidence/phase-1/story-p1-10.md](docs/evidence/phase-1/story-p1-10.md).
- Host note (NixOS): the downloaded generic-Linux build cannot resolve its system libraries there (`libglib-2.0.so.0`, `libnss3.so`, … — `nix-ld` does not ship them). Supply the library directories a Nix-built browser uses, either once with `patchelf --set-rpath …` on the downloaded binaries or per run via `LD_LIBRARY_PATH=… npm run test:ui`. CI (`ubuntu-24.04`) ships the libraries and needs neither.

## Documentation

**Specifications** (authoritative):

- [Domain Reference](docs/spec-domain-reference.md) — SpiralDB JSON schemas, type enumerations, validation rules, CLI wrapper spec, WAD/string-table details
- [Architecture](docs/spec-architecture.md) — System design, tech stack, data flow, external dependencies
- [Data Model](docs/spec-data-model.md) — SQLite schemas, verification lifecycle, file naming, git branch strategy
- [API Reference](docs/spec-api.md) — REST endpoints and frontend URL routes
- [UI Design](docs/spec-ui-design.md) — Layout, components, color palette, interaction patterns

**Implementation plan** (how the specs get built):

- [Plan Overview](docs/plan-overview.md) — Roadmap, environment baseline, execution model, decisions D1–D87
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