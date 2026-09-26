# p2-04 — Extraction service + `POST /api/extract/quests` + cancel (tasks 2.2 + 2.3)

Branch `phase-2-quest-extraction`, HEAD `93f08a8`, tree left **uncommitted** for the lead. The
extraction service (the CLI subprocess contract, D9 cancellation, the portable `DOTNET_ROOT`, the
`maxBuffer` escape hatch) and the multipart upload route, plus two hermetic test files. No process is
ever spawned by the suite and .NET is never needed by it.

Raw outputs: [`story-p2-04-ac1.txt`](./story-p2-04-ac1.txt) (end-to-end extraction through the real
CLI, failure envelopes, health after failure, shutdown), [`story-p2-04-ac2.txt`](./story-p2-04-ac2.txt)
(the mid-extraction abort proven with `ps`), [`story-p2-04-ac3.txt`](./story-p2-04-ac3.txt) (CLI
missing → `npm run build:cli`, the `--output` escape hatch exercised for real), and the six-check
gate in [`gate-p2-04.txt`](./gate-p2-04.txt).

New source: [`server/src/services/extraction.ts`](../../../server/src/services/extraction.ts),
[`server/src/routes/extract.ts`](../../../server/src/routes/extract.ts), mounted in
[`server/src/routes/index.ts`](../../../server/src/routes/index.ts); tests
[`tests/unit/extraction-service.test.ts`](../../../tests/unit/extraction-service.test.ts) (29) and
[`tests/unit/extract-api.test.ts`](../../../tests/unit/extract-api.test.ts) (12). Dependency added:
`@types/multer@^2.2.0` (devDependency).

| AC | Result | Evidence |
|---|---|---|
| **p2-04-ac1** `POST /api/extract/quests` (multipart, field `file`, `.json` only, 512 MB cap) with a D28 capture → `{quests, count}`; invalid file → `{error: "Failed to parse packet capture: ..."}`; server healthy after CLI failure (P2 AC#3) | **PASS** | Real CLI, real server (`node server/dist/server/src/index.js`, throwaway `SPIRALDB_UI_DB`, port 3137, booted **without** `DOTNET_ROOT` — 0 occurrences in `/proc/<pid>/environ`): `MB-YARD1-C01-001.json` → `HTTP 200`, body keys exactly `quests, count`, `count: 1`, quest name `MB-YARD1-C01-001`, level 1, 15 goals. `{"foo":1}` → `HTTP 400 {"error":"Failed to parse packet capture: error: '<path>' is not a packet capture. …"}`; truncated JSON → the same envelope with the CLI's JSON parser message; `.txt` → `HTTP 400` unsupported-extension envelope. `GET /api/health` → `{"status":"ok"}` after all of them, and a fourth extraction still returns 200. No leaked children (`ps -o pid,cmd -C imview-packet-reader` → exit 1). |
| **p2-04-ac2** Cancel mid-extraction kills the CLI child process (P2 AC#4, D9) | **PASS** | A 105 MB capture (the committed fixture's packet list repeated 3200×) whose full extraction takes **13.8 s** (control run, `--output`). `curl --max-time 3` against the running server: `curl exit=28` at 3.00 s. A `ps -C imview-packet-reader` watcher captured the child **pid 1330966** alive at `03:58:53.748` and last seen at `03:58:56.428` (≈ the abort); immediately after the abort `ps –C` is empty and 2 s of 0.1 s polling shows no process. The uploaded temp capture was deleted, the server answered `/api/health` 200, and the server was shut down. |
| **p2-04-ac3** Friendly failure modes: CLI missing → error naming `npm run build:cli`; maxBuffer 50 MB with the `--output` file-mode escape hatch wired internally (task 2.2) | **PASS** | Binary moved away → `HTTP 500 {"error":"Packet capture CLI not found at /…/tools/bin/imview-packet-reader. Build it with: npm run build:cli"}`; restored (`readlink` shown identical) → the same capture returns 200, so absence was the only difference. Escape hatch **for real**: the 3200-offer capture's CLI stdout is **55,177,495 B > 50 MB**, stdout mode necessarily overflows, and the API still answered `HTTP 200` with `count: 3200` — only the internal `--output` retry can produce that. The service announces it on stderr (`Warning: [extract] CLI stdout exceeded the 50 MB buffer for …; retrying with --output file mode`), and `ls -d /tmp/spiraldb-extract-*` shows **no leftover temp dir** (read → removed). |

## The one finding the lead should record: the abort signal belongs to `res`, not `req`

Decision D9 and the story brief both say "`req.on('close')` → kill". **Measured on Node 24, that
never fires for this route.** `IncomingMessage` emits `close` when the request *body* ends, and
multer has already consumed the whole body before our handler runs — so a listener registered in the
handler is dead code, and the first implementation silently did **not** kill the child (the api test
caught it; a bare-Node probe confirmed the event ordering). The abort signal is therefore
`res.on('close')`, which fires both on completion and on a prematurely terminated connection, with
the brief's own guard (`res.writableEnded` / `res.finished`) distinguishing them — measured: on a
normal response that event arrives with `writableEnded === true`, so the guard is load-bearing.
This is a one-line correction to D9's wording, not an interpretation: **"the response's `close`
event, guarded by `res.writableEnded`/`finished`"**.

## Decisions the lead may need to record (spec/plan silent)

1. **Error status codes** (spec shows the body only): `400` for a capture the CLI could not parse or
   an unsupported extension, `413` for an upload over the cap, `500` for a not-built CLI. Every
   response keeps the `{error}` envelope; `ExtractionError.status` is set so the shared middleware
   would render it identically if the route ever rethrows.
2. **Upload temp dir**: `<repo root>/data/uploads/` (under the gitignored `data/`), injectable.
   The uploaded capture is **deleted when the request settles**, success or failure — a 512 MB
   artifact per upload would otherwise accumulate forever. An upload aborted mid-transfer is cleaned
   by multer itself (`make-middleware.js` L223-228 handles `req.on('aborted')` → `removeUploadedFiles`).
3. **No execution timeout by default** (the spec's call is a blocking subprocess with no deadline):
   a capture may legitimately take minutes and a fired timeout is indistinguishable from a real
   failure. Cancellation is the client's (D9); `timeoutMs` stays injectable.
4. **`DOTNET_ROOT` derivation**: explicit `DOTNET_ROOT` wins (even blank-safe), else the first
   `dotnet` on `PATH` resolved through symlinks (`fs.realpathSync`) with its dirname taken; no
   `dotnet` → the variable is **not** set and the apphost's own stderr is surfaced. Pure and
   injectable (`deriveDotnetRoot`), so the unit tests need no .NET. On this host
   `/run/current-system/sw/bin/dotnet` → `…/dotnet-sdk-9.0.318/share/dotnet/.dotnet-wrapper` →
   `…/share/dotnet`, which is why the ac1 server runs without the variable.
5. **Response JSON is compact** while the CLI emits Newtonsoft-indented JSON (D45): the same 3200
   quests are 55.2 MB from the CLI and 38.5 MB in the API response. Semantically identical; the
   spec fixes no formatting.
6. **The error detail contains the server-side temp upload path** (e.g. `…/data/uploads/<uuid>.json`)
   because the CLI names the file it read. Fine for a local single-user tool, and the file is gone by
   then; flagging it in case a later story wants it scrubbed.
7. `data/uploads/` remains as an empty gitignored directory after a run (multiplier: zero bytes).
8. If a **later** story makes CI invoke the real binary, CI still needs `actions/setup-dotnet` —
   D45 already records this, and this story's suite spawns nothing (verified: the whole `npm test`
   run needs no .NET and no `DOTNET_ROOT`).

## Surprises worth knowing

- **multer `diskStorage` touches disk in its constructor** when `destination` is a *string*
  (`mkdirp.sync`). Mounting the router at import time would therefore create `data/uploads/` in
  every unit test and on every `import app` — the same class of problem the lazy mounts exist for.
  Passing `destination` as a callback removes it (dir creation becomes ours, as multer documents),
  so the router is mounted **directly** with zero import-time side effects. The ac1 evidence shows
  `ls -d data/uploads` failing *before* the first upload.
- **The 50 MB `maxBuffer` cap is reachable with a perfectly legal capture**, not just a pathological
  one: 3200 offers (a ~1 MB/message rate) overflow it, and the escape hatch turns a hard failure into
  a successful 3200-quest response. That is why the retry announces itself on stderr.
- `pgrep -C` does not exist on this host (only `ps -C`), and `comm` is truncated to 15 chars
  (`imview-packet-r`) — the ac2 watcher uses `ps -C`, which cannot self-match the way `pgrep -f` does.
- Node's `execFile` reports the overflow as `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` (the brief's
  `ENOBUFSRANGE` is the pre-Node-12 name); the service accepts all three spellings plus a message
  match, and kills the child on overflow before the retry (so the retry is a *second* spawn — both
  are registered in the run's registry and both are killed by an abort).

## Verification of the run's own rules

- **0 files changed** under `Imview` (`git status --porcelain` → empty) and 0 files changed under
  `~/.nuget` (`find ~/.nuget -newermt '3 hours ago'` → 0). `spiraldb` is clean too. The `Aurorium`
  and `Imlight` working trees carry pre-existing edits whose mtimes are 2026-09-24/25, i.e. before
  this session (2026-09-26 03:45+) — not touched here.
- **Node never parses a capture.** The only capture-shaped text Node handles is the fixture *read* to
  build the large test input, and that repeats the array's inner text textually (no `JSON.parse`).
  Every extraction goes through `tools/bin/imview-packet-reader`.
- **No real process is spawned by the suite**: the two new test files inject `ExecFileWithChild` and
  a fake CLI existence probe; the whole suite passes with no .NET present in the code path.
- Six-check gate: `npm test` 22 files / **555 tests passed**, `npm run test:ui` **8 passed**,
  `npm run lint` exit 0, `npm run typecheck:tests` exit 0, server + client `tsc --noEmit` exit 0,
  `npm run build` exit 0.
## Lead verification (independent, this round)

The lead re-ran the acceptance checks rather than accepting the executor's summary. Raw output:
[`story-p2-04-leadverify.txt`](./story-p2-04-leadverify.txt) (ac1 + ac3, real server on :3141,
`DOTNET_ROOT` **unset** in the server's own environment) and
[`story-p2-04-leadverify-abort.txt`](./story-p2-04-leadverify-abort.txt) (ac2, real abort).

- **ac1 reproduced**: `MB-YARD1-C01-001.json` → `HTTP 200`, `bytes=33262`, `time=0.26s`, keys exactly
  `quests,count`, `count=1`, level 1, 15 goals with names in order; `{"foo":1}` → `400` with the
  `Failed to parse packet capture:` envelope; `.txt` → `400`; no file → `400`; `/api/health` ok after
  all of them and a further extraction of `WC-UNICORN-MAIN-007` still returned 200.
- **ac3 reproduced**: binary moved away → `500 {"error":"Packet capture CLI not found at …Build it
  with: npm run build:cli"}`, and 200 again after restoring it. The escape hatch was exercised for
  real by the lead too: the 3200-rep capture → `HTTP 200 count=3200` with
  `(node:1333473) Warning: [extract] CLI stdout exceeded the 50 MB buffer for …/data/uploads/6245d391-….json; retrying with --output file mode`,
  no `/tmp/spiraldb-extract-*` and no uploads left behind.
- **ac2 re-verified after an inconclusive first attempt.** The lead's first probe (a 400-rep, 13 MB
  capture) finished in 1.73 s, so `curl --max-time 2` **completed instead of aborting** and the empty
  `ps` afterwards proved nothing. Redone with 1600 reps (53 MB): control run `http=200 time=5.22s
  count=1600`; then `curl --max-time 2` → `exit=28 wall=2.0016s`, with a 50 ms `ps -C
  imview-packet-reader` watcher showing child **pid 1333546 present at t=0.08 s and gone at t=2.02 s**
  (~20 ms after the abort), `ps` empty afterwards and no stray children. The executor's independent
  run (pid 1330966, 13.8 s control, `--max-time 3`) agrees.
- **Gate re-run by the lead** (`gate-p2-04.txt`): 22 files / **555** tests, 8 UI specs, eslint 0,
  prettier 0, `typecheck:tests` 0, server + client `tsc --noEmit` 0, `npm run build` 0.
- **Hygiene**: 0 files changed under `Imview` (fs-level), `Imview` git status empty, 0 files under
  `~/.nuget`, `spiraldb` clean, `data/uploads/` empty and no temp dirs left. The suite is hermetic —
  both new test files inject the runner, so **nothing spawns a process and .NET is never required**.
- Recorded as **D47** (abort signal belongs to `res`, not `req`; status codes; upload dir + temp
  lifetime; no default timeout; `DOTNET_ROOT` derivation; the escape hatch's real reachability;
  `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` naming; the temp-path detail in the error message).
