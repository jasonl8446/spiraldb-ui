/**
 * The live-load harness — Aurorium serves the revision, Imlight loads it (task 6.11 / story
 * **p6-12**, decisions **D113** and **D114**).
 *
 * ## What this module is for
 *
 * Phase 6's loadability bar is not "the scaffold's schema validates" — p6-09 owns that — it is
 * "a live Imlight boot says it loaded the corpus, and the count rises by exactly one across a
 * scaffold" (D113). That sentence needs a machine, so this is its machine:
 *
 * 1. **Five owned ports** (D114): `12369` (Aurorium HTTP), `12500` (Imlight patch), `12000`
 *    (login), `12333` (game), `8080` (embedded RavenDB). Each is probed before anything starts,
 *    and the answering process is classified `owned` (this harness started it), `sibling` (the
 *    expected service, started by someone else — reused and left alone) or `foreign` (anything
 *    else, which is a refusal that names the port). D93's lesson is why "something is listening"
 *    is not the test: a decoy on `3001` served 11 readiness probes while the suite stayed green.
 * 2. **The freshness check**: the 866 MB prebuilt Imlight output is trusted only while no commit
 *    after its `Imlight.Director.dll` mtime touched `src/**\/*.cs` or `*.csproj` (task 6.11's last
 *    bullet). Computed, never assumed.
 * 3. **The assertion**: Imlight's own `SpiralDB loaded {0} files: … {7} quest templates, {8} zone
 *    data entries.` line, read from the process under test at two points with a scaffold between.
 *
 * ## The test seam
 *
 * Nothing here spawns a process, opens a socket or reads a file: the CLI
 * (`scripts/imlight-boot.ts`) owns every side effect and hands the results in. That is what lets
 * `npm test` stay green with the harness absent — it needs .NET 10, a Rust binary and five ports,
 * none of which CI has (D55) — because `proveCountRisesByExactlyOne()` takes its two boot logs as
 * an injected `boot` function. The unit suite passes a **fake log** through that seam and the real
 * CLI passes the Director's captured console.
 *
 * ## What is deliberately not here
 *
 * No "appears in game" claim: the boot proves the *server* loaded the corpus. Whether a client can
 * play it is an owner post-run note (D113).
 */

/** The five ports the run binds or reuses, in probe order (D114). */
export const HARNESS_PORTS = [12369, 12500, 12000, 12333, 8080] as const;

export type HarnessPort = (typeof HARNESS_PORTS)[number];

/** The service each port belongs to — what an answering process has to *be* to be usable. */
export type PortService = 'aurorium' | 'imlight';

export const PORT_SERVICE: Readonly<Record<HarnessPort, PortService>> = {
  12369: 'aurorium',
  12500: 'imlight',
  12000: 'imlight',
  12333: 'imlight',
  8080: 'imlight',
};

/** What each port is for, in the harness's own words — used in refusal messages and the report. */
export const PORT_ROLE: Readonly<Record<HarnessPort, string>> = {
  12369: 'Aurorium HTTP — the patch source Imlight downloads Root.wad from',
  12500: 'Imlight patch server (TCP)',
  12000: 'Imlight login server',
  12333: 'Imlight game server, realm 1',
  8080: 'Imlight embedded RavenDB (bound by a child of the Director)',
};

/** Every refusal the harness can hand to a caller. */
export type HarnessErrorCode =
  'port-foreign' | 'boot-failed' | 'log-line-missing' | 'count' | 'stale' | 'usage';

/** A harness refusal. `detail` is written for the log, not for a stack trace. */
export class HarnessError extends Error {
  constructor(
    message: string,
    readonly code: HarnessErrorCode,
  ) {
    super(message);
    this.name = 'HarnessError';
  }
}

/**
 * The exit-code contract `scripts/imlight-boot.ts` documents in its header, in **one home**: the
 * map is a `Record` over `HarnessErrorCode`, so adding a code without giving it an exit code is a
 * compile error rather than a silent fall-through to the generic `5`.
 *
 * `count` is the arm that mattered: the header promises `6` for *the count did not rise by exactly
 * one **or** the clone did not restore*, and both count failures **throw** (`HarnessError('count')`
 * at the scaffold refusal and at the failed proof), so they reach this map rather than the CLI's
 * own `run.proof.ok` check — which is unreachable by construction, because the proof is evaluated
 * inside the harness and a failed one never returns. Before this arm existed the header's `6` was
 * reachable only from the clone restore and a failed count proof exited `5`, the code reserved for
 * "the Director did not produce its log line".
 */
export const HARNESS_EXIT_CODES: Readonly<Record<HarnessErrorCode, number>> = {
  usage: 2,
  'port-foreign': 3,
  stale: 4,
  'boot-failed': 5,
  'log-line-missing': 5,
  count: 6,
};

export function harnessExitCode(code: HarnessErrorCode): number {
  return HARNESS_EXIT_CODES[code];
}

// ---------------------------------------------------------------------------
// Port ownership: owned | sibling | foreign
// ---------------------------------------------------------------------------

/**
 * A process identity, as `/proc` reports it.
 *
 * `starttime` is `/proc/<pid>/stat` field 22 (clock ticks since boot). It is carried because a
 * recorded pid alone is not ownership: pids are recycled, and a ledger that trusted the number
 * would happily call a stranger "ours".
 */
export interface ProcIdentity {
  pid: number;
  cmdline: string;
  starttime: string;
}

/**
 * A listening socket's owning process.
 *
 * `ancestry` is `[self, parent, grandparent, …]` up to init. It exists because port `8080` is
 * owned by RavenDB — a *child* of the Director (`dotnet … Raven.Server.dll
 * --Embedded.ParentProcessId=<director pid>`), so matching only the socket's own pid would classify
 * the run's own database as foreign.
 */
export interface Listener extends ProcIdentity {
  ancestry: readonly ProcIdentity[];
}

/** A process this harness started, persisted so a later run can recognise it. */
export interface OwnedProcess extends ProcIdentity {
  service: PortService;
  role: string;
  runDir: string;
  startedAt: string;
}

export interface OwnershipLedger {
  version: 1;
  processes: readonly OwnedProcess[];
}

/** An absent/undecodable ledger reads as empty rather than as an error: it is a cache, not state. */
export function readOwnership(json: string | undefined): OwnershipLedger {
  if (json === undefined || json.trim() === '') {
    return { version: 1, processes: [] };
  }
  try {
    const parsed = JSON.parse(json) as OwnershipLedger;
    if (parsed.version !== 1 || !Array.isArray(parsed.processes)) {
      return { version: 1, processes: [] };
    }
    return { version: 1, processes: parsed.processes };
  } catch {
    return { version: 1, processes: [] };
  }
}

export function recordOwned(ledger: OwnershipLedger, process: OwnedProcess): OwnershipLedger {
  return {
    version: 1,
    processes: [...ledger.processes.filter((entry) => entry.pid !== process.pid), process],
  };
}

export function forgetOwned(ledger: OwnershipLedger, pid: number): OwnershipLedger {
  return { version: 1, processes: ledger.processes.filter((entry) => entry.pid !== pid) };
}

/**
 * The service a command line belongs to, or `undefined`.
 *
 * Both patterns are path-anchored rather than "contains the word": `serviceOfCommandLine('node -e
 * "…aurorium…"')` must not be accepted as Aurorium, because that is exactly the shape of the decoy
 * this classification exists to catch.
 */
export function serviceOfCommandLine(cmdline: string): PortService | undefined {
  if (/(?:^|\s)\S*\/Aurorium\/target\/\S*\/aurorium(?:\s|$)/.test(cmdline)) {
    return 'aurorium';
  }
  if (/(?:^|\s)\S*Imlight\.Director(?:\.dll)?(?:\s|$)/.test(cmdline)) {
    return 'imlight';
  }
  return undefined;
}

/** The service of a listener or of any of its ancestors (the Director owns the RavenDB child). */
export function serviceOfProcess(listener: Listener): PortService | undefined {
  for (const proc of listener.ancestry) {
    const service = serviceOfCommandLine(proc.cmdline);
    if (service !== undefined) {
      return service;
    }
  }
  return undefined;
}

/** The ledger entry that accounts for this listener, if any ancestor pid was one we started. */
export function ownedBy(listener: Listener, ledger: OwnershipLedger): OwnedProcess | undefined {
  return ledger.processes.find((entry) => listener.ancestry.some((proc) => proc.pid === entry.pid));
}

/**
 * RavenDB's own way of naming the Director it belongs to: the Director passes
 * `--Embedded.ParentProcessId=<its own pid>` to the child it spawns. Used as the second half of
 * {@link leftoverIsOwned}'s descendant test, because the marker survives the **reparenting** that
 * happens when the Director dies — which is exactly the surviving-RavenDB case the leftover loop
 * exists for. The ancestry check alone would not see it there.
 */
function directorMarker(directorPid: number): RegExp {
  return new RegExp(`--Embedded\\.ParentProcessId=${directorPid}(?:\\s|$)`);
}

/**
 * May the harness signal the listener that outlived its own Director's stop?
 *
 * Ownership follows **the starter** (D114/D122), which is why a bare pid is not enough: pids are
 * recycled, and `stopProcessGroup`'s only guard is `isAlive`. A leftover is ours only when it **is**
 * the Director this harness started (same pid **and** the same `/proc` starttime) or is a
 * **descendant** of it — proved either through the ancestry chain or through RavenDB's
 * `--Embedded.ParentProcessId=<director pid>` marker. Everything else is a stranger: the caller
 * reports it and fails rather than signalling a process this harness did not start.
 */
export function leftoverIsOwned(input: { listener: Listener; director: ProcIdentity }): boolean {
  const isDirector = (proc: ProcIdentity): boolean =>
    proc.pid === input.director.pid && proc.starttime === input.director.starttime;
  if (isDirector(input.listener) || input.listener.ancestry.some(isDirector)) {
    return true;
  }
  return directorMarker(input.director.pid).test(input.listener.cmdline);
}

export type PortStatus = 'free' | 'owned' | 'sibling' | 'foreign';

export interface PortVerdict {
  port: HarnessPort;
  role: string;
  service: PortService;
  status: PortStatus;
  pid?: number;
  /** One line, naming the port and the evidence — the refusal's message is built from these. */
  detail: string;
}

/** A short, quotable form of a command line (the whole thing can be thousands of chars). */
export function shortenCmdline(cmdline: string, limit = 120): string {
  const trimmed = cmdline.trim();
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}…`;
}

/**
 * Classify one port.
 *
 * `free` is the only status that leads to starting something. `owned` and `sibling` are both reused
 * and never stopped — "ownership follows the starter" (D114): what this harness started it may stop,
 * and what it did not start it leaves alone. `foreign` is the only refusal.
 */
export function classifyPort(input: {
  port: HarnessPort;
  listener: Listener | undefined;
  ledger: OwnershipLedger;
}): PortVerdict {
  const { port, listener, ledger } = input;
  const service = PORT_SERVICE[port];
  const role = PORT_ROLE[port];

  if (listener === undefined) {
    return {
      port,
      role,
      service,
      status: 'free',
      detail: `port ${port} is free — the harness may bind it`,
    };
  }

  const owner = ownedBy(listener, ledger);
  if (owner !== undefined) {
    return {
      port,
      role,
      service,
      status: 'owned',
      pid: listener.pid,
      detail:
        `port ${port} answers from pid ${listener.pid} ` +
        `(${shortenCmdline(listener.cmdline)}), recorded as the ${owner.service} this harness ` +
        `started at ${owner.startedAt} in ${owner.runDir} — reuse, do not stop`,
    };
  }

  const found = serviceOfProcess(listener);
  if (found === service) {
    return {
      port,
      role,
      service,
      status: 'sibling',
      pid: listener.pid,
      detail:
        `port ${port} answers from pid ${listener.pid} ` +
        `(${shortenCmdline(listener.cmdline)}), a live ${service} this harness did not start — ` +
        `reuse and leave it alone (D114)`,
    };
  }

  return {
    port,
    role,
    service,
    status: 'foreign',
    pid: listener.pid,
    detail:
      `port ${port} answers from pid ${listener.pid} (${shortenCmdline(listener.cmdline)}), which ` +
      `is not the ${service} this port must serve (${role})` +
      (found === undefined
        ? ' — its command line names neither sibling service'
        : ` — it looks like ${found}`),
  };
}

export interface PortDecisions {
  /** Ports nothing is listening on: the harness may start its service. */
  start: HarnessPort[];
  /** Ports already served by the right service: reuse, never stop. */
  reuse: HarnessPort[];
  refused: PortVerdict[];
}

export function portDecisions(verdicts: readonly PortVerdict[]): PortDecisions {
  return {
    start: verdicts.filter((v) => v.status === 'free').map((v) => v.port),
    reuse: verdicts
      .filter((v) => v.status === 'owned' || v.status === 'sibling')
      .map((v) => v.port),
    refused: verdicts.filter((v) => v.status === 'foreign'),
  };
}

/** The refusal message. It names every offending port, which is the criterion's own wording. */
export function refusalMessage(refused: readonly PortVerdict[]): string {
  return (
    `refusing to start: ${refused.length} port(s) answer from a process this harness does not own — ` +
    refused.map((v) => `\n  - ${v.detail}`).join('') +
    `\nStop the offending process(es), or move the run to a free port, and try again.`
  );
}

// ---------------------------------------------------------------------------
// The Aurorium identity probe (a second gate behind the process check)
// ---------------------------------------------------------------------------

/**
 * Aurorium's own answer to "which revision do you serve?".
 *
 * The process check can be satisfied by any binary that happens to sit at the Aurorium path; the
 * `GET /latest` body cannot be faked without actually holding the workspace copy of the revision
 * index. Both gates must pass, because a decoy that *answers* is precisely the D93 failure mode —
 * this probe turns "something is listening" into "this is the revision the run needs".
 */
export function auroriumIdentity(input: {
  reachable: boolean;
  latestBody: string;
  expectedRevision: string;
}): { ok: boolean; detail: string } {
  if (input.expectedRevision.trim() === '') {
    return {
      ok: false,
      detail:
        'the workspace copy of Aurorium index holds no revision — nothing to serve, so the run ' +
        'would fail on Root.wad even with the port bound',
    };
  }
  if (!input.reachable) {
    return {
      ok: false,
      detail: 'the port answers TCP but GET /latest did not return a response — not Aurorium HTTP',
    };
  }
  const body = input.latestBody.trim();
  if (body !== input.expectedRevision) {
    return {
      ok: false,
      detail:
        `GET /latest said "${body}" but the workspace copy of Aurorium index names ` +
        `"${input.expectedRevision}" — the answering server is not serving this run's revision`,
    };
  }
  return { ok: true, detail: `GET /latest returned the expected revision ${body}` };
}

// ---------------------------------------------------------------------------
// Imlight's own log line
// ---------------------------------------------------------------------------

/** The line the gate reads: `SpiralDB loaded … {7} quest templates, {8} zone data entries.` */
export const SPIRALDB_LOADED_PATTERN =
  /SpiralDB loaded (\d+) files: (\d+) spellbooks, (\d+) drop tables, (\d+) NPC inventories, (\d+) NPC spell inventories, (\d+) NPC drop tables, (\d+) treasure card inventories, (\d+) quest templates, (\d+) zone data entries\./;

export interface SpiralDbLoadLine {
  /** The matched text, verbatim — what the evidence quotes. */
  raw: string;
  files: number;
  spellbooks: number;
  dropTables: number;
  npcInventories: number;
  npcSpellInventories: number;
  npcDropTables: number;
  treasureCardInventories: number;
  questTemplates: number;
  zoneData: number;
}

/** Serilog's console sink colours levels; a redirected stream keeps them, so they go first. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * Every `SpiralDB loaded` line in a captured boot log, in order.
 *
 * Measured on this host: the Director's boot logs the same line **three times** (one per server
 * that touches the collection — patch, login, game). All three carry the same counts, and three
 * agreeing readings of the same process are a *stronger* baseline than one; the caller asserts
 * they agree (`agreeOnCounts`) rather than picking a favourite.
 */
export function parseSpiralDbLoadLines(consoleText: string): SpiralDbLoadLine[] {
  const lines: SpiralDbLoadLine[] = [];
  for (const line of stripAnsi(consoleText).split('\n')) {
    const match = SPIRALDB_LOADED_PATTERN.exec(line);
    if (match === null) {
      continue;
    }
    const numbers = match.slice(1).map(Number);
    lines.push({
      raw: match[0],
      files: numbers[0] ?? 0,
      spellbooks: numbers[1] ?? 0,
      dropTables: numbers[2] ?? 0,
      npcInventories: numbers[3] ?? 0,
      npcSpellInventories: numbers[4] ?? 0,
      npcDropTables: numbers[5] ?? 0,
      treasureCardInventories: numbers[6] ?? 0,
      questTemplates: numbers[7] ?? 0,
      zoneData: numbers[8] ?? 0,
    });
  }
  return lines;
}

/**
 * The failure signatures a boot that will *never* print the line leaves behind.
 *
 * Recorded because the alternative is a harness that waits out its whole deadline and then reports
 * "timed out" — which is not a diagnosis. Each of these is an exact string this repository measured
 * in the sibling server: blocker 1's Root.wad abort, a SpiralDB parse failure, an unhandled
 * exception, and the .NET-10-missing message D-blocker (`You must install .NET to run this
 * application.`).
 */
export const BOOT_FAILURE_PATTERNS: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  {
    pattern: /Patch server is not reachable\. Cannot load Root\.wad\./,
    why: 'the patch server was not serving Root.wad — blocker 1 of task 6.11',
  },
  { pattern: /Failed to load SpiralDB:/, why: 'SpiralDB parsed but threw' },
  { pattern: /Unhandled exception/, why: 'the Director died before loading' },
  {
    pattern: /You must install \.NET to run this application/,
    why: 'the wrong runtime — Imlight is net10.0 and needs DOTNET_ROOT pointed at the .NET 10 store',
  },
];

export function bootFailure(consoleText: string): { line: string; why: string } | undefined {
  for (const line of stripAnsi(consoleText).split('\n')) {
    for (const { pattern, why } of BOOT_FAILURE_PATTERNS) {
      if (pattern.test(line)) {
        return { line: line.trim(), why };
      }
    }
  }
  return undefined;
}

/** The counts that a scaffold must not move. */
export const NON_QUEST_FAMILIES = [
  'spellbooks',
  'dropTables',
  'npcInventories',
  'npcSpellInventories',
  'npcDropTables',
  'treasureCardInventories',
  'zoneData',
] as const;

export interface CountProof {
  baseline: SpiralDbLoadLine;
  after: SpiralDbLoadLine;
  /** `after.questTemplates - baseline.questTemplates`. */
  delta: number;
  questName: string;
  /** The arithmetic, spelled out for the report: `322 + 1 = 323`. */
  arithmetic: string;
  /** Every other family equal, and both counters up by the expected delta. */
  ok: boolean;
  detail: string;
}

/**
 * The proof itself: one scaffold, one quest template, both counts read from Imlight's own line.
 *
 * Three guards make "rises by exactly one" mean something, and each one closes a way the naive
 * comparison would pass while proving nothing:
 *
 * - **The corpus must not have changed under us.** Every one of the seven non-quest families
 *   (spellbooks, drop tables, NPC inventories/spell inventories/drop tables, treasure cards, zone
 *   data) is asserted *equal* between the two lines. Two boots pointed at different corpora would
 *   otherwise produce a "+1 quests" reading that says nothing about the scaffold.
 * - **Both file counters must move by the same delta.** `files` and `quest templates` are separate
 *   fields of the same line; a scaffold adds exactly one file and exactly one template, so they
 *   rise together. A line pair where only one moved is a different process shape, not a scaffold.
 * - **The delta is the expected one** (default 1).
 */
export function proveCountRise(input: {
  baseline: SpiralDbLoadLine;
  after: SpiralDbLoadLine;
  questName: string;
  expectedDelta?: number;
}): CountProof {
  const expected = input.expectedDelta ?? 1;
  const delta = input.after.questTemplates - input.baseline.questTemplates;
  const arithmetic = `${input.baseline.questTemplates} + ${delta} = ${input.after.questTemplates}`;

  const moved = NON_QUEST_FAMILIES.filter(
    (family) => input.after[family] !== input.baseline[family],
  ).map((family) => `${family} moved ${input.baseline[family]} -> ${input.after[family]}`);

  const problems: string[] = [];
  if (moved.length > 0) {
    problems.push(
      `the corpus is not the same between the two boots: ${moved.join('; ')} ` +
        `(a scaffold adds a quest template and nothing else)`,
    );
  }
  if (delta !== expected) {
    problems.push(
      `quest templates moved by ${delta}, not ${expected}: ${arithmetic} for "${input.questName}"`,
    );
  }
  const filesDelta = input.after.files - input.baseline.files;
  if (filesDelta !== delta) {
    problems.push(
      `the file counter moved by ${filesDelta} while quest templates moved by ${delta} — the ` +
        `line's two counters disagree, so the two readings are not the same process shape`,
    );
  }

  return {
    baseline: input.baseline,
    after: input.after,
    delta,
    questName: input.questName,
    arithmetic,
    ok: problems.length === 0,
    detail:
      problems.length === 0
        ? `quest templates rose by exactly ${expected} across the scaffold of "${input.questName}": ` +
          `${arithmetic}; the other seven families are unchanged (${NON_QUEST_FAMILIES.join(', ')})`
        : problems.join(' | '),
  };
}

// ---------------------------------------------------------------------------
// Freshness: is the 866 MB prebuilt still code-current?
// ---------------------------------------------------------------------------

/**
 * The paths the criterion names: `src/**\/*.cs` or `*.csproj`.
 *
 * `src/**\/*.cs` is read as "a `.cs` file somewhere under `src/`" — the `**` is any depth and the
 * reading is deliberately the *inclusive* one (it also matches `src/A.cs`), because the cost of
 * being inclusive is a needless rebuild while the cost of being exclusive is trusting a stale
 * binary.
 */
export const IMLIGHT_CODE_PATH_PATTERNS: readonly RegExp[] = [/^src\/.*\.cs$/i, /\.csproj$/i];

export interface GitCommitRecord {
  sha: string;
  /** Committer date, ISO 8601 (`%cI`) — the same field `git log --since` filters on. */
  dateIso: string;
  /** Repo-relative paths the commit touched (`git log --name-only`). */
  files: readonly string[];
}

export interface FreshnessVerdict {
  verdict: 'code-current' | 'stale';
  dllMtimeIso: string;
  /** Commits *after* the mtime that touched a code path (empty when `code-current`). */
  codeCommitsAfter: GitCommitRecord[];
  /** Commits after the mtime, whatever they touched — so "docs-only" is visible, not asserted. */
  commitsAfter: GitCommitRecord[];
  detail: string;
  /** The D18 build command to run when the answer is `stale`. */
  rebuildCommand: string;
}

export function commitTouchesCode(commit: GitCommitRecord): boolean {
  return commit.files.some((file) => IMLIGHT_CODE_PATH_PATTERNS.some((re) => re.test(file)));
}

/**
 * Compute the verdict. The comparison is a **strict `>` on the committer date** and it happens
 * here, in JS, not in `git log --since`: git timestamps are whole seconds and the caller queries
 * with slack, so the precise decision has to be the one made from the parsed records.
 */
export function evaluateFreshness(input: {
  dllMtimeIso: string;
  commits: readonly GitCommitRecord[];
  rebuildCommand: string;
}): FreshnessVerdict {
  const mtime = Date.parse(input.dllMtimeIso);
  if (Number.isNaN(mtime)) {
    throw new HarnessError(`not a parseable mtime: ${input.dllMtimeIso}`, 'usage');
  }
  const after = input.commits.filter((commit) => {
    const when = Date.parse(commit.dateIso);
    return !Number.isNaN(when) && when > mtime;
  });
  const code = after.filter(commitTouchesCode);

  const detail =
    code.length === 0
      ? `code-current: Imlight.Director.dll mtime ${input.dllMtimeIso}; ${after.length} commit(s) ` +
        `after it (${after.map((c) => c.sha.slice(0, 7)).join(', ') || 'none'}), 0 touched ` +
        `src/**/*.cs or *.csproj — the prebuilt output may be reused`
      : `stale: Imlight.Director.dll mtime ${input.dllMtimeIso}; ${code.length} commit(s) after it ` +
        `touched src/**/*.cs or *.csproj (${code
          .map((c) => `${c.sha.slice(0, 7)} @ ${c.dateIso}`)
          .join(', ')}) — the prebuilt output predates the code`;

  return {
    verdict: code.length === 0 ? 'code-current' : 'stale',
    dllMtimeIso: input.dllMtimeIso,
    codeCommitsAfter: code,
    commitsAfter: after,
    detail,
    rebuildCommand: input.rebuildCommand,
  };
}

// ---------------------------------------------------------------------------
// The count proof, orchestrated through the injectable seam
// ---------------------------------------------------------------------------

export interface BootOutcome {
  label: string;
  /** The Director's own captured console text — the process under test's log, nothing else. */
  consoleText: string;
  pid?: number;
  exitCode?: number | null;
  /** True when the deadline passed without the line appearing. */
  timedOut?: boolean;
}

export type BootImlight = (context: { label: string }) => Promise<BootOutcome>;

export interface ScaffoldOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type RunScaffold = (context: { name: string }) => Promise<ScaffoldOutcome>;

export interface CountRiseRun {
  baseline: BootOutcome;
  after: BootOutcome;
  scaffold: ScaffoldOutcome;
  proof: CountProof;
  /** Every boot's `SpiralDB loaded` line, so three agreeing readings stay visible. */
  baselineLines: SpiralDbLoadLine[];
  afterLines: SpiralDbLoadLine[];
}

/** The one line a boot must produce, or a `HarnessError` that says which way it failed. */
export function readBootLine(outcome: BootOutcome): SpiralDbLoadLine {
  const failure = bootFailure(outcome.consoleText);
  if (failure !== undefined) {
    throw new HarnessError(
      `boot "${outcome.label}" cannot load the corpus: ${failure.why}\n  ${failure.line}`,
      'boot-failed',
    );
  }
  const lines = parseSpiralDbLoadLines(outcome.consoleText);
  if (lines.length === 0) {
    throw new HarnessError(
      `boot "${outcome.label}" produced no "SpiralDB loaded … quest templates" line` +
        (outcome.timedOut === true ? ' before the deadline' : '') +
        (outcome.exitCode === undefined || outcome.exitCode === null
          ? ''
          : ` (exit code ${outcome.exitCode})`),
      'log-line-missing',
    );
  }
  const first = lines[0];
  if (first === undefined) {
    throw new HarnessError(`boot "${outcome.label}" produced no readable line`, 'log-line-missing');
  }
  const disagreeing = lines.find((line) => line.raw !== first.raw);
  if (disagreeing !== undefined) {
    throw new HarnessError(
      `boot "${outcome.label}" logged the line with different counts inside one process:\n` +
        `  ${first.raw}\n  ${disagreeing.raw}\n` +
        `One boot reads one corpus; two readings mean the corpus changed mid-boot.`,
      'count',
    );
  }
  return first;
}

/**
 * Boot → read the baseline → scaffold → boot again → read the after-count → prove +1.
 *
 * The **same process shape** both times: the same run directory, the same config copy, the same
 * .NET root, only a restart in between (SpiralDB is loaded once per boot, so a restart is the only
 * honest way to re-read a corpus a scaffold has changed). The injected `boot` is the seam the unit
 * suite replaces with a canned log.
 */
export async function proveCountRisesByExactlyOne(deps: {
  boot: BootImlight;
  scaffold: RunScaffold;
  questName: string;
  expectedDelta?: number;
  onEvent?: (line: string) => void;
}): Promise<CountRiseRun> {
  const say = (line: string): void => deps.onEvent?.(line);

  say(`[harness] boot 1 of 2 — the baseline, before any scaffold`);
  const baseline = await deps.boot({ label: 'baseline' });
  const baselineLine = readBootLine(baseline);
  const baselineLines = parseSpiralDbLoadLines(baseline.consoleText);
  say(`[harness] baseline: ${baselineLine.raw}`);

  say(`[harness] scaffolding "${deps.questName}" (p6-09's own command)`);
  const scaffold = await deps.scaffold({ name: deps.questName });
  if (scaffold.exitCode !== 0) {
    throw new HarnessError(
      `the scaffold of "${deps.questName}" failed with exit code ${scaffold.exitCode}\n` +
        `--- stdout ---\n${scaffold.stdout}\n--- stderr ---\n${scaffold.stderr}`,
      'count',
    );
  }

  say(`[harness] boot 2 of 2 — the same run directory, after the scaffold`);
  const after = await deps.boot({ label: 'after' });
  const afterLine = readBootLine(after);
  const afterLines = parseSpiralDbLoadLines(after.consoleText);
  say(`[harness] after   : ${afterLine.raw}`);

  const proof = proveCountRise({
    baseline: baselineLine,
    after: afterLine,
    questName: deps.questName,
    ...(deps.expectedDelta === undefined ? {} : { expectedDelta: deps.expectedDelta }),
  });
  if (!proof.ok) {
    throw new HarnessError(`the count proof failed: ${proof.detail}`, 'count');
  }

  return { baseline, after, scaffold, proof, baselineLines, afterLines };
}

// ---------------------------------------------------------------------------
// The clone: snapshot, restore plan, and the axes the restore is proved on
// ---------------------------------------------------------------------------

/**
 * The scaffold's write root must be the clone the boot reads and the snapshot/restore covers.
 *
 * **D116's class, one level up**: a `--spiraldb` that differs from the clone leaves three halves
 * individually valid and the whole silently wrong. The boot pins Imlight's `SpiralDBLocalPath` to
 * `config.clone`; the snapshot and the restore cover `config.clone`; only the scaffold writes to the
 * `--spiraldb` root. A file written elsewhere therefore **cannot raise the count** the proof reads,
 * and the run leaves a written repository that was neither verified nor restored. Unlike the sync's
 * own override — where warning is right because the caller may mean it — here there is no useful
 * experiment to protect, so this is a **refusal**, and it names both paths and says which side each
 * one is. `null` when they agree, which is the default (`--spiraldb` omitted).
 */
export function describeWriteRootDivergence(writeRoot: string, clone: string): string | null {
  if (writeRoot === clone) {
    return null;
  }
  return (
    `the scaffold would write into ${writeRoot}, but the boot reads and the snapshot/restore cover ` +
    `${clone} — Imlight's SpiralDBLocalPath is pinned to the clone, so a file written into ` +
    `${writeRoot} cannot raise the count proof's number and would be left neither verified nor ` +
    `restored. Omit --spiraldb (it defaults to the clone) or pass ${clone}.`
  );
}

/**
 * The D17 clone's state on the five axes the restore is judged by, plus the corpus shape.
 *
 * `branches` and `remotes` are here because of D76(b): a reset that restores the commit but leaves
 * a branch behind restores the *files* and not the *clone*. Both are compared as sets.
 */
export interface CloneSnapshot {
  branch: string;
  head: string;
  mainRef: string;
  count: number;
  porcelain: readonly string[];
  questTemplates: number;
  branches: readonly string[];
  remotes: readonly string[];
}

/**
 * A branch name without its `refs/heads/` prefix.
 *
 * This exists because the two halves of the harness reported the same branch differently — the
 * snapshot read `%(refname)` (`refs/heads/content/2026-09-27`) while the restore read
 * `%(refname:short)` (`content/2026-09-27`). Measured on the first real run: every branch looked
 * "extra", and the restore tried to delete all three, including the one it had just checked out —
 * it took `content/2026-09-26` with it before failing on the checked-out branch. A restore that
 * deletes a branch is worse than one that leaves one, so both sides are normalised here.
 */
export function shortBranchName(ref: string): string {
  return ref.replace(/^refs\/heads\//, '');
}

/**
 * The git commands that put the clone back, in order — planned here, executed by the CLI.
 *
 * The branch that is checked out is never in the delete list: deleting the current branch cannot
 * work (`git branch -D` refuses it), and a plan that tries is a plan built from names that do not
 * describe reality.
 */
export function restoreCommands(
  snapshot: CloneSnapshot,
  presentBranches: readonly string[],
): { steps: string[][]; extraBranches: string[]; blockedBranches: string[] } {
  const known = new Set(snapshot.branches.map(shortBranchName));
  const current = shortBranchName(snapshot.branch);
  const extra = presentBranches
    .map(shortBranchName)
    .filter((branch) => !known.has(branch) && branch !== current);
  const blockedBranches = presentBranches
    .map(shortBranchName)
    .filter((branch) => !known.has(branch) && branch === current);
  const steps: string[][] = [
    ['checkout', '-f', current],
    ['reset', '--hard', snapshot.head],
    ...extra.map((branch) => ['branch', '-D', branch]),
  ];
  return { steps, extraBranches: extra, blockedBranches };
}

export interface CloneAxisRow {
  axis: string;
  expected: string;
  actual: string;
  ok: boolean;
}

/**
 * Refuse to run the destructive restore against a clone that was **already dirty**.
 *
 * `restoreClone` runs `git checkout -f` + `git reset --hard` unconditionally, and the axis
 * comparison that would complain about dirt pins `git status --porcelain` to **empty**
 * ({@link compareCloneAxes}) — so it can only ever report dirt **after** the restore has already
 * erased it, and the run looks green while somebody's uncommitted work is gone. The suites' own
 * readiness predicate refuses exactly this case ("has uncommitted changes (refusing to reset
 * them)"); the harness must refuse **before** the scaffold writes, not report after the fact.
 *
 * `null` when the clone is clean, which is the state every recorded run measured.
 */
export function describeDirtyClone(porcelain: readonly string[]): string | null {
  if (porcelain.length === 0) {
    return null;
  }
  return (
    `the D17 clone has ${porcelain.length} uncommitted change(s) and this run's restore would ` +
    `destroy them with checkout -f + reset --hard, without a record: ${porcelain.join(' | ')}. ` +
    `Commit or stash them, or point the run at a clean clone.`
  );
}

/**
 * The five axes plus the corpus shape, as a diffable table.
 *
 * `git status --porcelain` is pinned to **empty** rather than to a recorded value: the clone is a
 * frozen read-only corpus (D79), so any dirt at all is a failure, not a difference.
 *
 * The **local branch set** is a sixth row, and it is the row D76(b) exists for: a reset that
 * restores the commit but leaves a branch behind restores the files and not the clone. It is
 * compared as a sorted set so ref ordering cannot decide the verdict.
 */
export function compareCloneAxes(
  actual: CloneSnapshot,
  expected: {
    branch: string;
    head: string;
    mainRef: string;
    count: number;
    questTemplates: number;
    branches?: readonly string[];
  },
): { ok: boolean; rows: CloneAxisRow[] } {
  const rows: CloneAxisRow[] = [
    row('branch', expected.branch, actual.branch),
    row('HEAD', expected.head, actual.head),
    row('main ref', expected.mainRef, actual.mainRef),
    row('git rev-list --count HEAD', String(expected.count), String(actual.count)),
    row(
      'git status --porcelain',
      '(empty)',
      actual.porcelain.length === 0 ? '(empty)' : actual.porcelain.join(' | '),
    ),
    row('QuestTemplates/*.json', String(expected.questTemplates), String(actual.questTemplates)),
  ];
  if (expected.branches !== undefined) {
    rows.push(
      row(
        'local branches (set)',
        [...expected.branches].map(shortBranchName).sort().join(' '),
        actual.branches.map(shortBranchName).sort().join(' '),
      ),
    );
  }
  return { ok: rows.every((entry) => entry.ok), rows };
}

function row(axis: string, expected: string, actual: string): CloneAxisRow {
  return { axis, expected, actual, ok: expected === actual };
}

// ---------------------------------------------------------------------------
// Report rendering (shared by the CLI's stdout and the evidence file)
// ---------------------------------------------------------------------------

/** A fixed-width table, because every one of these reports is read as evidence by a human. */
export function renderTable(rows: ReadonlyArray<ReadonlyArray<string>>): string {
  const widths = rows.reduce<number[]>(
    (acc, cells) => cells.map((cell, index) => Math.max(acc[index] ?? 0, cell.length)),
    [],
  );
  return rows
    .map((cells) =>
      cells
        .map((cell, index) => cell.padEnd(widths[index] ?? 0))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

export function renderPortVerdicts(verdicts: readonly PortVerdict[]): string {
  return renderTable([
    ['port', 'role', 'status', 'pid', 'detail'],
    ...verdicts.map((v) => [
      String(v.port),
      v.service,
      v.status,
      v.pid === undefined ? '-' : String(v.pid),
      v.detail,
    ]),
  ]);
}
