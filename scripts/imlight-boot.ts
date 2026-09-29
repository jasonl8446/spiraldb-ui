/**
 * `npm run imlight:boot -- <mode>` — the live-load harness CLI (task 6.11 / story p6-12).
 *
 * This file owns every side effect (sockets, `/proc`, `git`, subprocesses, SQLite copies) and hands
 * the results to `server/src/services/imlightHarness.ts`, which owns every decision. That split is
 * why the decisions are unit-tested while `npm test` never needs .NET 10, a Rust binary or five
 * ports.
 *
 * ```
 * npm run imlight:boot -- probe                       # classify the five ports; refuse on a foreign one
 * npm run imlight:boot -- freshness                   # is the prebuilt Imlight still code-current?
 * npm run imlight:boot -- boot --clean                # one Director boot; prints its own log line
 * npm run imlight:boot -- up                          # ensure Aurorium is serving (start or reuse)
 * npm run imlight:boot -- down                        # stop only what this harness started
 * npm run imlight:boot -- prove-count --name AQ-GARD-SIS-001 \
 *   --db tools/.imlight-run/harness.db --restore-clone
 * ```
 *
 * Exit codes: `0` ok · `2` usage · `3` a port answers from a process this harness cannot use ·
 * `4` the prebuilt Imlight output is stale · `5` the Director did not produce its log line ·
 * `6` the count did not rise by exactly one.
 *
 * The run directories (`tools/.imlight-run/`, `tools/.aurorium-run/`, `tools/ImlightEmbeddedDatabase/`)
 * are inside the workspace on purpose: Imlight's `LocalWadCachePath = ./cache` and
 * `EmbeddedDatabaseDataDirectory = ../ImlightEmbeddedDatabase/` are cwd-relative, so the run
 * directory **and its parent** have to be in the workspace for the copy to be viable (blocker 2).
 * All three are gitignored (D114).
 */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { DEFAULT_AURORIUM_PATH, resolveRepoRoot, testSpiraldbPath } from '../server/src/db.js';
import {
  auroriumIdentity,
  bootFailure,
  classifyPort,
  compareCloneAxes,
  evaluateFreshness,
  forgetOwned,
  HarnessError,
  HARNESS_PORTS,
  parseSpiralDbLoadLines,
  PORT_SERVICE,
  portDecisions,
  proveCountRisesByExactlyOne,
  readBootLine,
  readOwnership,
  recordOwned,
  refusalMessage,
  renderPortVerdicts,
  renderTable,
  restoreCommands,
  type BootOutcome,
  type CloneSnapshot,
  type GitCommitRecord,
  type HarnessPort,
  type Listener,
  type OwnedProcess,
  type PortVerdict,
  type ProcIdentity,
  type SpiralDbLoadLine,
} from '../server/src/services/imlightHarness.js';

const repoRoot = resolveRepoRoot(fileURLToPath(new URL('..', import.meta.url)));

// ---------------------------------------------------------------------------
// Wiring: where everything lives. Every path is overridable by environment so the harness is not
// hard-wired to one host, but the defaults are the ones this repository measured.
// ---------------------------------------------------------------------------

/**
 * The .NET 10 runtime root (D-blocker: `DOTNET_ROOT`, because the default `dotnet` is 9 and Imlight
 * targets `net10.0`). Auto-detected from the nix store rather than pinned to a store hash, which
 * would break on the next `nixos-rebuild`.
 *
 * The candidate must actually contain `share/dotnet/dotnet`: measured, a plain name filter picks
 * `…-dotnet-sdk-10.0.401-man` (a store path holding only man pages) or a `.drv` derivation, and the
 * spawn then fails with `the Director did not report a pid` — a diagnosis that points nowhere near
 * the cause.
 */
function resolveDotnetRoot(): string {
  const override = process.env.IMLIGHT_DOTNET_ROOT;
  if (override !== undefined && override !== '') {
    if (!fs.existsSync(path.join(override, 'dotnet'))) {
      throw new HarnessError(`IMLIGHT_DOTNET_ROOT=${override} holds no dotnet binary`, 'usage');
    }
    return override;
  }
  const store = '/nix/store';
  const candidates = fs
    .readdirSync(store)
    .filter((entry) => /^[a-z0-9]+-dotnet-sdk-10\./.test(entry))
    .filter((entry) => fs.existsSync(path.join(store, entry, 'share', 'dotnet', 'dotnet')))
    .sort();
  const newest = candidates.at(-1);
  if (newest === undefined) {
    throw new HarnessError(
      `no .NET 10 SDK found in ${store} and IMLIGHT_DOTNET_ROOT is unset — Imlight cannot be run ` +
        `with the default dotnet (it targets net10.0)`,
      'usage',
    );
  }
  return path.join(store, newest, 'share', 'dotnet');
}

/**
 * The .NET 10 root, resolved **lazily**.
 *
 * Resolved on first use rather than while the module is evaluated: measured, an eager call made a
 * missing SDK a raw stack trace from module scope, thrown before `main()`'s handler could render the
 * one-line refusal this CLI formats for every other failure.
 */
let cachedDotnetRoot: string | undefined;
function dotnetRoot(): string {
  cachedDotnetRoot ??= resolveDotnetRoot();
  return cachedDotnetRoot;
}

const config = {
  repoRoot,
  /** The Imlight checkout — read-only: the harness copies its build output and never writes here. */
  imlightRepo: process.env.IMLIGHT_REPO ?? '/home/jason/Documents/git-projects/Imlight',
  /** The 866 MB prebuilt Director output. */
  imlightBuild:
    process.env.IMLIGHT_BUILD ??
    '/home/jason/Documents/git-projects/Imlight/src/Imlight.Director/bin/Debug/net10.0',
  auroriumBin:
    process.env.AURORIUM_BIN ?? path.join(DEFAULT_AURORIUM_PATH, 'target', 'debug', 'aurorium'),
  /** Aurorium's revision tree (19 GB). Read through `save_directory` only; never copied. */
  auroriumData: process.env.AURORIUM_DATA ?? path.join(DEFAULT_AURORIUM_PATH, 'data'),
  /** The D17 clone: the corpus the boot reads and the scaffold writes one file into. */
  clone: process.env.SPIRALDB_PATH ?? testSpiraldbPath(repoRoot),
  imlightRunDir: path.join(repoRoot, 'tools', '.imlight-run'),
  auroriumRunDir: path.join(repoRoot, 'tools', '.aurorium-run'),
  ownershipFile: path.join(repoRoot, 'tools', '.aurorium-run', 'ownership.json'),
  evidenceDir: path.join(repoRoot, 'docs', 'evidence', 'phase-6'),
};

/**
 * The clone's expected axes, as recorded by p6-09/p6-10 (D79's deliberately frozen 322-era clone).
 * Kept here as the *verification* expectation: the restore itself is driven by the snapshot taken
 * before the scaffold, and these numbers are what says the snapshot was the right one.
 */
const CLONE_EXPECTATION = {
  branch: 'content/2026-09-27',
  head: '18dc92477d54b1e911796960407ce7710e703697',
  mainRef: 'f3f8b5c0a48bc0f0b0cd9aca2d9d7d9d0122bd37',
  count: 42,
  questTemplates: 322,
  /**
   * The three local branches p6-08/p6-09 recorded (`content/2026-09-26` and `content/2026-09-27`
   * both at the frozen `18dc924`, `main` at `f3f8b5c`). This is the row D76(b) is about, and it is
   * an *independent* expectation rather than the snapshot read back.
   */
  branches: ['content/2026-09-26', 'content/2026-09-27', 'main'],
};

// ---------------------------------------------------------------------------
// Small process/tooling helpers
// ---------------------------------------------------------------------------

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function readProcIdentity(pid: number): ProcIdentity | undefined {
  try {
    const cmdline = fs
      .readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      .split(String.fromCharCode(0))
      .join(' ')
      .trim();
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // Fields after the comm field. `comm` (field 2) is parenthesised and may contain spaces, so the
    // split happens after the **last** ')' — the standard way to parse /proc/<pid>/stat.
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { pid, cmdline, starttime: rest[19] ?? '' };
  } catch {
    return undefined;
  }
}

function readProcPpid(pid: number): number {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return Number(rest[1] ?? '0');
  } catch {
    return 0;
  }
}

/** `[self, parent, …]`, up to 12 levels — enough to reach the Director from the RavenDB child. */
function readAncestry(pid: number): ProcIdentity[] {
  const chain: ProcIdentity[] = [];
  let current = pid;
  for (let depth = 0; depth < 12 && current > 1; depth += 1) {
    const identity = readProcIdentity(current);
    if (identity === undefined) {
      break;
    }
    chain.push(identity);
    current = readProcPpid(current);
  }
  return chain;
}

function tcpAnswers(port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (answer: boolean): void => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** The listening pid for a port, from `ss`. Absent/unattributable reads as a zero-pid stranger. */
function attr(port: number): number | undefined {
  try {
    const out = execFileSync('ss', ['-lptnH', `sport = :${port}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const line of out.split('\n')) {
      const match = /pid=(\d+)/.exec(line);
      if (match !== null) {
        return Number(match[1]);
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Probe one port. "Answers" is a TCP connect (the criterion's own wording); attribution is `ss` +
 * `/proc`, and a port that answers without an attributable pid is reported as a zero-pid stranger
 * rather than as free — failing closed is the only safe direction for a port check.
 */
async function probePort(
  port: HarnessPort,
  ledger: ReturnType<typeof readOwnership>,
): Promise<PortVerdict> {
  const answers = await tcpAnswers(port);
  if (!answers) {
    return classifyPort({ port, listener: undefined, ledger });
  }
  const pid = attr(port);
  if (pid === undefined) {
    return classifyPort({
      port,
      listener: { pid: 0, cmdline: '(ss reported no owning pid)', starttime: '', ancestry: [] },
      ledger,
    });
  }
  const ancestry = readAncestry(pid);
  const self = ancestry[0] ?? { pid, cmdline: '(unreadable)', starttime: '' };
  const listener: Listener = { ...self, ancestry };
  return classifyPort({ port, listener, ledger });
}

async function probeAll(): Promise<PortVerdict[]> {
  const ledger = readOwnership(readFileOrUndefined(config.ownershipFile));
  const verdicts: PortVerdict[] = [];
  for (const port of HARNESS_PORTS) {
    verdicts.push(await probePort(port, ledger));
  }
  return verdicts;
}

function readFileOrUndefined(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function writeLedger(ledger: ReturnType<typeof readOwnership>): void {
  fs.mkdirSync(path.dirname(config.ownershipFile), { recursive: true });
  fs.writeFileSync(config.ownershipFile, `${JSON.stringify(ledger, null, 2)}\n`);
}

function rememberOwned(process_: OwnedProcess): void {
  writeLedger(recordOwned(readOwnership(readFileOrUndefined(config.ownershipFile)), process_));
}

function forgetPid(pid: number): void {
  writeLedger(forgetOwned(readOwnership(readFileOrUndefined(config.ownershipFile)), pid));
}

function httpGet(port: number, pathname: string, timeoutMs = 3000): Promise<string | undefined> {
  return new Promise((resolve) => {
    const request = net.connect({ host: '127.0.0.1', port }, () => {
      request.write(
        `GET ${pathname} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
      );
    });
    let raw = '';
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (raw === '') {
        resolve(undefined);
        return;
      }
      const split = raw.indexOf('\r\n\r\n');
      resolve(split === -1 ? '' : raw.slice(split + 4));
    };
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      finish();
    });
    request.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    request.on('error', () => {
      request.destroy();
      finish();
    });
    request.on('close', () => finish());
  });
}

// ---------------------------------------------------------------------------
// Process control
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * SIGTERM the whole process group, then SIGKILL it if it survives.
 *
 * The *group* rather than the pid, because the Director spawns RavenDB as a child (`dotnet …
 * Raven.Server.dll --Embedded.ParentProcessId=<pid>`): signalling only the Director leaves port
 * 8080 bound and the next boot fails to start, which would look like a flaky harness instead of a
 * cleanup bug.
 */
async function stopProcessGroup(pid: number, label: string): Promise<boolean> {
  if (!isAlive(pid)) {
    console.log(`[harness] ${label} pid ${pid} is already gone`);
    return false;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* raced with the process exiting */
    }
  }
  for (let waited = 0; waited < 15_000 && isAlive(pid); waited += 250) {
    await sleep(250);
  }
  if (isAlive(pid)) {
    console.log(`[harness] ${label} pid ${pid} ignored SIGTERM after 15 s — SIGKILL`);
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* gone between the check and the signal */
      }
    }
    await sleep(500);
  }
  console.log(`[harness] stopped ${label} pid ${pid}`);
  return true;
}

async function waitForFreePorts(ports: readonly number[], budgetMs: number): Promise<number[]> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const still: number[] = [];
    for (const port of ports) {
      if (await tcpAnswers(port)) {
        still.push(port);
      }
    }
    if (still.length === 0 || Date.now() >= deadline) {
      return still;
    }
    await sleep(300);
  }
}

// ---------------------------------------------------------------------------
// Aurorium: start, reuse, stop
// ---------------------------------------------------------------------------

const AURORIUM_CONFIG = `# Written by scripts/imlight-boot.ts (p6-12 / D114). Workspace-local on purpose:
# Aurorium has no offline flag, so the [patch] host points at a refused endpoint and the poll
# fails soft instead of downloading the retail revision.

[server]
endpoint = "127.0.0.1:12369"

[fetcher]
concurrent_downloads = 2
# The existing 19 GB revision tree, read in place. Never copied; the refused [patch] host keeps
# the fetcher off its write path entirely.
save_directory = "{data}"
fetch_interval = 28800

[patch]
# A refused endpoint: 127.0.0.1:1 accepts nothing, so check_revision fails immediately and the one
# warning is the whole cost. Verified refused before the boot, not assumed.
host = "127.0.0.1"
port = "1"

[database]
path = "aurorium.db"

[debug]
level = "info"
file_logging = true
`;

/** The revision the workspace DB holds — also what `GET /latest` must answer. */
function expectedRevision(): string {
  const db = new Database(path.join(config.auroriumRunDir, 'aurorium.db'), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const row = db
      .prepare('SELECT revision_name FROM revisions ORDER BY number DESC LIMIT 1')
      .get() as { revision_name: string } | undefined;
    return row?.revision_name ?? '';
  } finally {
    db.close();
  }
}

/**
 * Prepare the Aurorium run directory: the config pins and a **consistent workspace copy** of the
 * revision index.
 *
 * The index has to be copied because it is what tells the file route which revision an asset
 * belongs to (`get_revision_for_asset`); a fresh empty DB would leave the server listening and
 * answering `{}` for `/latest` — a listener that passes a naive readiness probe and serves nothing.
 *
 * The **three files are `cp`-ed into the run directory first and SQLite only ever opens that copy.**
 * Measured, the earlier version — `VACUUM INTO` straight from the sibling's live database — bumped
 * the mtime of `Aurorium/aurorium.db-shm`, i.e. it wrote into a repository this run must not write
 * into, however transient the file is. The copy is taken with `cp` (no SQLite), the copy's WAL is
 * recovered by SQLite on first open, and `VACUUM INTO` then produces the single consistent file the
 * server will use.
 */
function prepareAuroriumRunDir(): { dbCopy: string; configFile: string } {
  fs.mkdirSync(config.auroriumRunDir, { recursive: true });
  const dbCopy = path.join(config.auroriumRunDir, 'aurorium.db');
  for (const suffix of ['', '-wal', '-shm']) {
    const stale = `${dbCopy}${suffix}`;
    if (fs.existsSync(stale)) {
      fs.rmSync(stale);
    }
  }

  const source = path.join(DEFAULT_AURORIUM_PATH, 'aurorium.db');
  const staging = path.join(config.auroriumRunDir, '.index-source');
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const from = `${source}${suffix}`;
    if (fs.existsSync(from)) {
      fs.copyFileSync(from, path.join(staging, `aurorium.db${suffix}`));
    }
  }

  const src = new Database(path.join(staging, 'aurorium.db'), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    src.exec(`VACUUM INTO '${dbCopy.replaceAll("'", "''")}'`);
  } finally {
    src.close();
    fs.rmSync(staging, { recursive: true, force: true });
  }

  const configFile = path.join(config.auroriumRunDir, 'config.toml');
  fs.writeFileSync(configFile, AURORIUM_CONFIG.replace('{data}', config.auroriumData));
  return { dbCopy, configFile };
}

async function startAurorium(): Promise<{ logFile: string; pid: number }> {
  // The refused endpoint is *checked*, not assumed: the whole "no retail fetch" posture rests on
  // it, and a host that started answering 127.0.0.1:1 would silently turn the run into a download.
  if (await tcpAnswers(1)) {
    throw new HarnessError(
      'the [patch] endpoint 127.0.0.1:1 answers — the run would fetch the retail revision instead ' +
        'of failing soft. Pick a refused port before booting.',
      'usage',
    );
  }
  console.log('[harness] [patch] endpoint 127.0.0.1:1 verified refused (nothing to fetch from)');
  prepareAuroriumRunDir();
  const logFile = path.join(config.auroriumRunDir, 'boot.txt');
  const out = fs.openSync(logFile, 'w');
  const child = spawn(config.auroriumBin, [], {
    cwd: config.auroriumRunDir,
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  const pid = child.pid;
  if (pid === undefined) {
    throw new HarnessError(
      `could not spawn Aurorium at ${config.auroriumBin} (log: ${logFile})`,
      'usage',
    );
  }

  const expected = expectedRevision();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await tcpAnswers(12369)) {
      const body = await httpGet(12369, '/latest');
      const identity = auroriumIdentity({
        reachable: body !== undefined,
        latestBody: body ?? '',
        expectedRevision: expected,
      });
      console.log(`[harness] Aurorium identity: ${identity.detail}`);
      if (identity.ok) {
        return { logFile, pid };
      }
      throw new HarnessError(
        `the Aurorium this harness started failed its identity probe: ${identity.detail}`,
        'port-foreign',
      );
    }
    await sleep(250);
  }
  throw new HarnessError(`Aurorium did not answer on 12369 within 60 s (log: ${logFile})`, 'usage');
}

/** Stop Aurorium only when the ledger accounts for the pid **and** the pid is the same process. */
async function stopOwnedAurorium(): Promise<boolean> {
  const ledger = readOwnership(readFileOrUndefined(config.ownershipFile));
  const entry = ledger.processes.find((process_) => process_.service === 'aurorium');
  if (entry === undefined) {
    console.log('[harness] Aurorium: the ledger holds no entry — nothing to stop');
    return false;
  }
  const live = readProcIdentity(entry.pid);
  if (live === undefined) {
    console.log(`[harness] Aurorium pid ${entry.pid} is gone — clearing the ledger entry`);
    forgetPid(entry.pid);
    return false;
  }
  if (live.starttime !== entry.starttime || live.cmdline !== entry.cmdline) {
    console.log(
      `[harness] pid ${entry.pid} was recycled (starttime/cmdline differ) — NOT stopping it; ` +
        `clearing the ledger entry instead`,
    );
    forgetPid(entry.pid);
    return false;
  }
  const killed = await stopProcessGroup(entry.pid, 'Aurorium');
  forgetPid(entry.pid);
  return killed;
}

// ---------------------------------------------------------------------------
// The Imlight run directory: the prebuilt copy, the config pins, the freshness gate
// ---------------------------------------------------------------------------

function rebuildCommand(): string {
  return (
    `DOTNET_ROOT=${dotnetRoot()} NUGET_PACKAGES=${path.join(repoRoot, 'tools', '.nuget')} ` +
    `${path.join(dotnetRoot(), 'dotnet')} build ` +
    `${path.join(config.imlightRepo, 'src', 'Imlight.Director', 'Imlight.Director.csproj')} ` +
    `-c Debug -p:UseArtifactsOutput=true ` +
    `-p:ArtifactsPath=${path.join(repoRoot, 'tools', '.imlight-artifacts')}`
  );
}

/** Parse `git log --name-only --format='@@%H|%cI'` into records. */
function parseCommitLog(text: string): GitCommitRecord[] {
  const commits: GitCommitRecord[] = [];
  let current: { sha: string; dateIso: string; files: string[] } | undefined;
  for (const line of text.split('\n')) {
    if (line.startsWith('@@')) {
      const [sha, dateIso] = line.slice(2).split('|');
      if (sha !== undefined && dateIso !== undefined) {
        current = { sha, dateIso, files: [] };
        commits.push(current);
      }
      continue;
    }
    const file = line.trim();
    if (file !== '' && current !== undefined) {
      current.files.push(file);
    }
  }
  return commits;
}

/**
 * The freshness computation.
 *
 * `git log --since` is queried with 14 days of slack so the *records* are present, and the precise
 * decision is made in JS against each parsed committer date (`evaluateFreshness`). `--since` alone
 * would let a one-second rounding difference decide whether a commit exists at all.
 */
function checkFreshness(buildDir: string): {
  dllMtimeIso: string;
  commits: GitCommitRecord[];
  verdict: ReturnType<typeof evaluateFreshness>;
} {
  const dll = path.join(buildDir, 'Imlight.Director.dll');
  if (!fs.existsSync(dll)) {
    throw new HarnessError(`no Imlight.Director.dll under ${buildDir}`, 'usage');
  }
  const mtime = fs.statSync(dll).mtime;
  const since = new Date(mtime.getTime() - 14 * 86_400_000).toISOString();
  const log = git(
    ['log', `--since=${since}`, '--name-only', '--format=@@%H|%cI'],
    config.imlightRepo,
  );
  const commits = parseCommitLog(log);
  return {
    dllMtimeIso: mtime.toISOString(),
    commits,
    verdict: evaluateFreshness({
      dllMtimeIso: mtime.toISOString(),
      commits,
      rebuildCommand: rebuildCommand(),
    }),
  };
}

/**
 * Assert the copy's mtime equals the source's — the freshness verdict is computed from the
 * *prebuilt source* and the run executes the *copy*, so the two have to agree or the verdict
 * describes a build that is not the one running.
 */
function dllMtimesAgree(buildDir: string): void {
  const source = fs.statSync(path.join(buildDir, 'Imlight.Director.dll')).mtime.toISOString();
  const copy = fs
    .statSync(path.join(config.imlightRunDir, 'Imlight.Director.dll'))
    .mtime.toISOString();
  if (source !== copy) {
    throw new HarnessError(
      `the run copy's Imlight.Director.dll mtime (${copy}) differs from the prebuilt source's ` +
        `(${source}) — the freshness verdict would describe a different build than the one running`,
      'stale',
    );
  }
}

/**
 * Apply the three config pins + the free port set to the copy's `Config/Imlight.ini`.
 *
 * Rewritten by regex, never appended: an ini with the key twice would be resolved by whatever the
 * parser does, which is not a decision this harness should delegate.
 */
function pinConfig(): void {
  const file = path.join(config.imlightRunDir, 'Config', 'Imlight.ini');
  let text = fs.readFileSync(file, 'utf8');
  const pin = (key: string, value: string): void => {
    const escaped = key.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^${escaped}\\s*=.*$`, 'm');
    if (!re.test(text)) {
      throw new HarnessError(`Config/Imlight.ini has no "${key}" to pin`, 'usage');
    }
    text = text.replace(re, `${key} = ${value}`);
  };
  pin('SpiralDBLocalPath', config.clone);
  pin('SpiralDBDisableRemote', 'true');
  pin('PlayerDatabaseUrl', '');
  pin('PatchServerPort', '12500');
  pin('LoginServerPort', '12000');
  pin('GameServerPort', '12333');
  pin('EmbeddedDatabasePort', '8080');
  fs.writeFileSync(file, text);
}

/**
 * Build the run directory: the freshness gate first, then a copy of the prebuilt output, then the
 * pins. `--clean` removes the directory first — that is what "boots from a clean run directory"
 * means; without it an existing copy is re-pinned in place.
 */
function prepareImlightRunDir(options: { clean: boolean }): void {
  const { verdict, dllMtimeIso, commits } = checkFreshness(config.imlightBuild);
  console.log(`[harness] freshness: ${verdict.detail}`);
  if (verdict.verdict === 'stale') {
    throw new HarnessError(
      `${verdict.detail}\n  Rebuild with the D18 flags, then re-run:\n  ${verdict.rebuildCommand}\n` +
        `  (the harness does not build a sibling checkout itself: writing ` +
        `${path.join(config.imlightRepo, 'obj')} would modify a repository this run must leave ` +
        `alone)`,
      'stale',
    );
  }
  console.log(
    `[harness] freshness inputs: dll ${dllMtimeIso}, ${commits.length} commit(s) in the 14-day window`,
  );

  if (options.clean && fs.existsSync(config.imlightRunDir)) {
    console.log(`[harness] --clean: removing ${config.imlightRunDir}`);
    fs.rmSync(config.imlightRunDir, { recursive: true, force: true });
  }
  fs.mkdirSync(config.imlightRunDir, { recursive: true });
  if (!fs.existsSync(path.join(config.imlightRunDir, 'Imlight.Director.dll'))) {
    console.log(
      `[harness] copying the prebuilt output ${config.imlightBuild} -> ${config.imlightRunDir}`,
    );
    execFileSync('cp', ['-a', `${config.imlightBuild}/.`, config.imlightRunDir], {
      stdio: 'inherit',
    });
  }
  const size = execFileSync('du', ['-sh', config.imlightRunDir], { encoding: 'utf8' }).trim();
  console.log(`[harness] run directory ${config.imlightRunDir} (${size})`);
  dllMtimesAgree(config.imlightBuild);
  pinConfig();
  console.log(
    `[harness] config pins: SpiralDBLocalPath=${config.clone} SpiralDBDisableRemote=true ` +
      `PlayerDatabaseUrl=(empty) ports 12500/12000/12333/8080`,
  );
}

// ---------------------------------------------------------------------------
// Booting the Director
// ---------------------------------------------------------------------------

/**
 * One Director boot.
 *
 * The Director runs forever (`while (true) Thread.Sleep(300000)`), so a boot is a *watch*: spawn,
 * accumulate the console, resolve as soon as the gate's line appears, then stop the process group.
 * The console is the process under test's own log — `Logging.LogPath = ./logs/log.txt` is a Serilog
 * rolling file (`log<date>.txt`) and the console sink carries the same lines, so the console is the
 * stream the harness can follow live without guessing the rolled filename.
 */
async function bootImlightOnce(options: {
  label: string;
  timeoutMs: number;
  logFile: string;
}): Promise<BootOutcome> {
  const dll = path.join(config.imlightRunDir, 'Imlight.Director.dll');
  const child = spawn(path.join(dotnetRoot(), 'dotnet'), [dll], {
    cwd: config.imlightRunDir,
    detached: true,
    env: {
      ...process.env,
      DOTNET_ROOT: dotnetRoot(),
      DOTNET_CLI_TELEMETRY_OPTOUT: '1',
      DOTNET_NOLOGO: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // A failed spawn sets `pid` to undefined *and* emits 'error'; without a handler the harness would
  // report "no pid" and leave the real cause (a bad DOTNET_ROOT, a missing dll) unread.
  let spawnError: Error | undefined;
  child.on('error', (error) => {
    spawnError = error;
  });
  const pid = child.pid;
  if (pid === undefined) {
    await sleep(200);
    throw new HarnessError(
      `could not spawn the Director: ${spawnError?.message ?? 'no pid returned'} ` +
        `(binary ${path.join(dotnetRoot(), 'dotnet')}, cwd ${config.imlightRunDir})`,
      'boot-failed',
    );
  }
  const identity = readProcIdentity(pid);
  rememberOwned({
    pid,
    starttime: identity?.starttime ?? '',
    cmdline: identity?.cmdline ?? dll,
    service: 'imlight',
    role: `Director boot (${options.label})`,
    runDir: config.imlightRunDir,
    startedAt: new Date().toISOString(),
  });
  console.log(`[harness] boot "${options.label}": pid ${pid}, cwd ${config.imlightRunDir}`);

  let consoleText = '';
  let timedOut = false;
  child.stdout?.on('data', (chunk: Buffer) => {
    consoleText += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    consoleText += chunk.toString('utf8');
  });

  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    if (parseSpiralDbLoadLines(consoleText).length > 0) {
      break;
    }
    if (bootFailure(consoleText) !== undefined) {
      break;
    }
    if (child.exitCode !== null) {
      break;
    }
    if (Date.now() >= deadline) {
      timedOut = true;
      break;
    }
    await sleep(500);
  }

  // Let the file sink catch up with the console before the process goes away, so the two streams in
  // the evidence agree — the *console* stays the authority the assertion reads.
  await sleep(500);
  fs.writeFileSync(options.logFile, consoleText);
  console.log(
    `[harness] boot "${options.label}" console -> ${options.logFile} (${consoleText.length} bytes)`,
  );

  await stopProcessGroup(pid, `Director (${options.label})`);
  forgetPid(pid);
  const stillBound = await waitForFreePorts([12500, 12000, 12333, 8080], 20_000);
  for (const port of stillBound) {
    // A listener that outlived the group kill is stopped and *reported*: tolerating it would make
    // the next boot fail to bind, which reads as a flaky harness instead of a cleanup bug.
    const leftover = attr(port);
    if (leftover !== undefined) {
      console.log(`[harness] port ${port} still bound by pid ${leftover} — stopping it too`);
      await stopProcessGroup(leftover, `leftover on ${port}`);
    }
  }
  if (stillBound.length > 0) {
    const stubborn = await waitForFreePorts(stillBound, 10_000);
    if (stubborn.length > 0) {
      throw new HarnessError(
        `ports ${stubborn.join(', ')} are still bound after the boot was stopped — the next boot ` +
          `could not bind them`,
        'boot-failed',
      );
    }
  }

  return {
    label: options.label,
    consoleText,
    pid,
    exitCode: child.exitCode,
    timedOut,
  };
}

function printBootLine(line: SpiralDbLoadLine, title: string): void {
  console.log('');
  console.log(`=== ${title} ===`);
  console.log(`  ${line.raw}`);
  console.log('');
  console.log(
    renderTable([
      ['field', 'value'],
      ['files loaded', String(line.files)],
      ['spellbooks', String(line.spellbooks)],
      ['drop tables', String(line.dropTables)],
      ['NPC inventories', String(line.npcInventories)],
      ['NPC spell inventories', String(line.npcSpellInventories)],
      ['NPC drop tables', String(line.npcDropTables)],
      ['treasure card inventories', String(line.treasureCardInventories)],
      ['quest templates', String(line.questTemplates)],
      ['zone data entries', String(line.zoneData)],
    ]),
  );
}

// ---------------------------------------------------------------------------
// The clone: snapshot and restore
// ---------------------------------------------------------------------------

function snapshotClone(): CloneSnapshot {
  const dir = config.clone;
  return {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], dir).trim(),
    head: git(['rev-parse', 'HEAD'], dir).trim(),
    mainRef: git(['rev-parse', 'main'], dir).trim(),
    count: Number(git(['rev-list', '--count', 'HEAD'], dir).trim()),
    porcelain: git(['status', '--porcelain'], dir)
      .split('\n')
      .filter((line) => line !== ''),
    questTemplates: fs
      .readdirSync(path.join(dir, 'QuestTemplates'))
      .filter((name) => name.endsWith('.json')).length,
    // Short names (`content/2026-09-27`), the same form the restore reads, so the two halves of
    // the branch comparison cannot disagree on spelling. Measured on the first real restore: they
    // did, and every branch then looked "extra".
    branches: git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], dir)
      .split('\n')
      .filter((line) => line !== ''),
    remotes: git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes'], dir)
      .split('\n')
      .filter((line) => line !== ''),
  };
}

/**
 * Put the clone back.
 *
 * No step aborts the restore: a failure is collected and printed, and the caller's axis comparison
 * then reports the real state and exits non-zero. Measured reason for the change: the first version
 * threw on the first failing `git branch -D`, which skipped the verification entirely and left a
 * half-restored clone with no report of what had happened.
 */
function restoreClone(snapshot: CloneSnapshot): void {
  const present = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads'], config.clone)
    .split('\n')
    .filter((line) => line !== '');
  const { steps, extraBranches, blockedBranches } = restoreCommands(snapshot, present);
  console.log('');
  console.log(
    '=== the clone restore plan (D76(b): a reset that leaves a branch behind is not a restore) ===',
  );
  for (const step of steps) {
    console.log(`  git -C ${config.clone} ${step.join(' ')}`);
  }
  if (extraBranches.length === 0) {
    console.log('  (no branch appeared during the run, so no branch is deleted)');
  }
  for (const branch of blockedBranches) {
    console.log(`  ! ${branch} is not in the snapshot but is checked out — left in place`);
  }
  const failures: string[] = [];
  for (const step of steps) {
    console.log(`[harness] git ${step.join(' ')}`);
    try {
      git(step, config.clone);
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
      failures.push(`git ${step.join(' ')}: ${message}`);
      console.error(`[harness] FAILED: ${message}`);
    }
  }
  if (failures.length > 0) {
    console.error(
      `[harness] ${failures.length} restore step(s) failed — the axes below say what is`,
    );
  }
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

type Flags = Record<string, string | boolean | undefined>;

function parseFlags(argv: readonly string[]): { mode: string; flags: Flags } {
  const mode = argv[0] ?? '';
  const flags: Flags = {};
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (!arg.startsWith('--')) {
      continue;
    }
    const equals = arg.indexOf('=');
    const key = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    if (equals !== -1) {
      flags[key] = arg.slice(equals + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return { mode, flags };
}

function flagString(flags: Flags, key: string): string | undefined {
  const value = flags[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function usage(): never {
  console.log(
    `Usage: npm run imlight:boot -- <mode> [flags]\n\n` +
      `Modes:\n` +
      `  probe                 classify the five owned ports; exit 3 when one is foreign\n` +
      `  freshness             compute the prebuilt-Imlight freshness verdict\n` +
      `  up                    ensure Aurorium serves 12369 (start or reuse) and print the port table\n` +
      `  down                  stop only the processes this harness recorded as its own\n` +
      `  boot                  one Director boot; prints its own SpiralDB log line\n` +
      `  prove-count           boot, scaffold with p6-09's command, boot again, prove +1\n\n` +
      `Flags:\n` +
      `  --clean               (boot, prove-count) rebuild the run directory from the prebuilt copy\n` +
      `  --build <dir>         (freshness) the prebuilt Imlight output to date-check\n` +
      `  --name <QUEST_NAME>   (prove-count) the catalog quest to scaffold; required\n` +
      `  --db <file>           (prove-count) the catalog database; required (never guessed)\n` +
      `  --spiraldb <dir>      (prove-count) the SpiralDB root; defaults to the D17 clone\n` +
      `  --timeout <seconds>   (boot, prove-count) per-boot deadline; default 900\n` +
      `  --evidence-dir <dir>  (prove-count) where the raw logs and the report are written\n` +
      `  --prefix <name>       (prove-count) evidence filename prefix; default p6-12\n` +
      `  --restore-clone       (prove-count) restore the D17 clone to its pre-scaffold snapshot\n` +
      `  --keep-services       (prove-count) leave a started Aurorium running (for the reuse arm)\n`,
  );
  process.exit(2);
}

/** The refusal the CLI actually enforces, in one place, so every mode refuses identically. */
function assertStartable(verdicts: readonly PortVerdict[], mode: string): void {
  const decisions = portDecisions(verdicts);
  if (decisions.refused.length > 0) {
    console.error(`[harness] ${refusalMessage(decisions.refused)}`);
    process.exit(3);
  }
  // A second Director cannot bind 12500/12000/12333/8080, and reading another process's log is not
  // something this harness can do — it only holds the stdout of a process it started. So an Imlight
  // that is already running is a refusal (naming the port), while a live Aurorium is reused: its
  // HTTP port is shareable, and D114 says an already-answering service is left alone.
  const held = verdicts.filter((v) => PORT_SERVICE[v.port] === 'imlight' && v.status !== 'free');
  if (held.length > 0) {
    console.error(
      `[harness] refusing to start Imlight: ${held.length} of its port(s) already answer —\n` +
        held.map((v) => `  - ${v.detail}`).join('\n') +
        `\nThis harness reads the log of a Director it started itself, so an Imlight it did not ` +
        `start cannot serve the assertion. Stop it and re-run (mode "${mode}").`,
    );
    process.exit(3);
  }
}

async function auroriumUp(verdicts: readonly PortVerdict[]): Promise<void> {
  const verdict = verdicts.find((v) => v.port === 12369);
  if (verdict === undefined) {
    throw new HarnessError('no verdict for 12369', 'usage');
  }
  if (verdict.status === 'owned' || verdict.status === 'sibling') {
    const body = await httpGet(12369, '/latest');
    const identity = auroriumIdentity({
      reachable: body !== undefined,
      latestBody: body ?? '',
      expectedRevision: expectedRevision(),
    });
    console.log(`[harness] Aurorium on 12369: REUSED without stopping it — ${verdict.detail}`);
    console.log(`[harness] Aurorium identity: ${identity.detail}`);
    if (!identity.ok) {
      console.error(
        `[harness] refusing to reuse the listener on 12369: ${identity.detail}\n` +
          `  port 12369 answers from a process this harness cannot use`,
      );
      process.exit(3);
    }
    return;
  }

  console.log('[harness] 12369 is free — starting the workspace Aurorium');
  const { logFile, pid } = await startAurorium();
  const identity = readProcIdentity(pid);
  rememberOwned({
    pid,
    starttime: identity?.starttime ?? '',
    cmdline: identity?.cmdline ?? config.auroriumBin,
    service: 'aurorium',
    role: 'patch source for the Imlight run',
    runDir: config.auroriumRunDir,
    startedAt: new Date().toISOString(),
  });
  console.log(`[harness] Aurorium pid ${pid} recorded as OWNED (log -> ${logFile})`);
}

async function main(): Promise<void> {
  const { mode, flags } = parseFlags(process.argv.slice(2));
  if (mode === '' || mode === 'help' || flags['help'] === true) {
    usage();
  }

  if (mode === 'probe') {
    const verdicts = await probeAll();
    console.log(renderPortVerdicts(verdicts));
    const decisions = portDecisions(verdicts);
    console.log('');
    console.log(`start  : ${decisions.start.join(', ') || '(none)'}`);
    console.log(`reuse  : ${decisions.reuse.join(', ') || '(none)'}`);
    console.log(`refused: ${decisions.refused.map((v) => v.port).join(', ') || '(none)'}`);
    if (decisions.refused.length > 0) {
      console.error(`[harness] ${refusalMessage(decisions.refused)}`);
      process.exit(3);
    }
    return;
  }

  if (mode === 'freshness') {
    const buildDir = flagString(flags, 'build') ?? config.imlightBuild;
    const { dllMtimeIso, commits, verdict } = checkFreshness(buildDir);
    console.log(
      renderTable([
        ['input', 'value'],
        ['build directory', buildDir],
        ['Imlight.Director.dll', path.join(buildDir, 'Imlight.Director.dll')],
        ['its mtime (ISO)', dllMtimeIso],
        ['Imlight repo', config.imlightRepo],
        ['commit window queried', `${commits.length} commit(s), --since = mtime - 14 days`],
        [
          'commits after the mtime',
          verdict.commitsAfter.map((c) => c.sha.slice(0, 7)).join(', ') || '(none)',
        ],
        [
          'code commits after it',
          verdict.codeCommitsAfter.map((c) => c.sha.slice(0, 7)).join(', ') || '(none)',
        ],
        ['verdict', verdict.verdict],
      ]),
    );
    console.log('');
    console.log(`[harness] ${verdict.detail}`);
    if (verdict.verdict === 'stale') {
      console.error(
        `[harness] refusing to reuse the prebuilt output.\n  Rebuild with the D18 flags:\n  ${verdict.rebuildCommand}`,
      );
      process.exit(4);
    }
    return;
  }

  if (mode === 'down') {
    const stopped = await stopOwnedAurorium();
    const before = await probeAll();
    for (const verdict of before) {
      if (
        PORT_SERVICE[verdict.port] === 'imlight' &&
        verdict.status === 'owned' &&
        verdict.pid !== undefined
      ) {
        await stopProcessGroup(verdict.pid, `recorded Imlight on port ${verdict.port}`);
        forgetPid(verdict.pid);
      }
    }
    const after = await probeAll();
    console.log('');
    console.log(renderPortVerdicts(after));
    console.log(
      stopped
        ? '[harness] stopped what it had started; nothing else was touched'
        : '[harness] nothing of ours was recorded as running; nothing was touched',
    );
    return;
  }

  if (mode === 'up') {
    const verdicts = await probeAll();
    console.log(renderPortVerdicts(verdicts));
    assertStartable(verdicts, mode);
    await auroriumUp(verdicts);
    console.log('');
    console.log(renderPortVerdicts(await probeAll()));
    return;
  }

  if (mode === 'boot') {
    const verdicts = await probeAll();
    assertStartable(verdicts, mode);
    await auroriumUp(verdicts);
    prepareImlightRunDir({ clean: flags['clean'] === true });
    const timeoutMs = Number(flagString(flags, 'timeout') ?? '900') * 1000;
    const logFile = path.join(config.imlightRunDir, 'boot.txt');
    const outcome = await bootImlightOnce({ label: 'single', timeoutMs, logFile });
    const failure = bootFailure(outcome.consoleText);
    if (failure !== undefined) {
      console.error(`[harness] the boot failed: ${failure.why}\n  ${failure.line}`);
      console.error(`[harness] raw console: ${logFile}`);
      process.exit(5);
    }
    const lines = parseSpiralDbLoadLines(outcome.consoleText);
    if (lines.length === 0) {
      console.error(
        `[harness] no "SpiralDB loaded … quest templates" line (timed out: ${outcome.timedOut})`,
      );
      console.error(`[harness] raw console: ${logFile}`);
      process.exit(5);
    }
    printBootLine(lines[0] as SpiralDbLoadLine, "Imlight's own log line (the process under test)");
    console.log(`[harness] raw console: ${logFile}`);
    if (flags['keep-services'] === true) {
      console.log('[harness] --keep-services: leaving the Aurorium it started running');
    } else {
      await stopOwnedAurorium();
    }
    return;
  }

  if (mode === 'prove-count') {
    const name = flagString(flags, 'name');
    const db = flagString(flags, 'db');
    const spiraldb = flagString(flags, 'spiraldb') ?? config.clone;
    if (name === undefined || db === undefined) {
      console.error('[harness] prove-count needs --name <QUEST_NAME> and --db <file>');
      usage();
    }
    const evidenceDir = flagString(flags, 'evidence-dir') ?? config.evidenceDir;
    const prefix = flagString(flags, 'prefix') ?? 'p6-12';
    const timeoutMs = Number(flagString(flags, 'timeout') ?? '900') * 1000;
    fs.mkdirSync(evidenceDir, { recursive: true });

    const verdicts = await probeAll();
    console.log('=== the five owned ports, before anything starts ===');
    console.log(renderPortVerdicts(verdicts));
    assertStartable(verdicts, mode);

    await auroriumUp(verdicts);
    prepareImlightRunDir({ clean: flags['clean'] === true });

    // The scaffold writes one file into the clone, so the clone is snapshotted first — and that
    // snapshot, not a constant, is what the restore is driven by.
    const snapshot = snapshotClone();
    console.log('');
    console.log('=== the D17 clone, before the scaffold (the restore snapshot) ===');
    console.log(
      renderTable([
        ['axis', 'value'],
        ['branch', snapshot.branch],
        ['HEAD', snapshot.head],
        ['main ref', snapshot.mainRef],
        ['rev-list --count HEAD', String(snapshot.count)],
        [
          'status --porcelain',
          snapshot.porcelain.length === 0 ? '(empty)' : snapshot.porcelain.join(' | '),
        ],
        ['QuestTemplates/*.json', String(snapshot.questTemplates)],
        ['branches', snapshot.branches.join(' ')],
      ]),
    );

    const run = await proveCountRisesByExactlyOne({
      questName: name,
      boot: async ({ label }) =>
        bootImlightOnce({
          label,
          timeoutMs,
          logFile: path.join(evidenceDir, `${prefix}-imlight-boot-${label}.txt`),
        }),
      scaffold: async ({ name: questName }) => {
        const args = [
          'run',
          'scaffold:quest',
          '--',
          '--name',
          questName,
          '--db',
          db,
          '--spiraldb',
          spiraldb,
        ];
        try {
          const stdout = execFileSync('npm', args, {
            cwd: repoRoot,
            env: {
              ...process.env,
              NODE_ENV: 'test',
              SPIRALDB_UI_DB: db,
              USER_NAME: 'p6-12-harness',
            },
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          });
          return { exitCode: 0, stdout, stderr: '' };
        } catch (error) {
          const failure = error as { status?: number; stdout?: string; stderr?: string };
          return {
            exitCode: failure.status ?? 1,
            stdout: failure.stdout ?? '',
            stderr: failure.stderr ?? (error instanceof Error ? error.message : String(error)),
          };
        }
      },
      onEvent: (line) => console.log(line),
    });

    const baselineLine = readBootLine(run.baseline);
    const afterLine = readBootLine(run.after);
    printBootLine(baselineLine, "BASELINE — Imlight's own log line, before the scaffold");
    console.log('');
    console.log("=== the scaffold (p6-09's own command, verbatim) ===");
    console.log(
      `  NODE_ENV=test SPIRALDB_UI_DB=${db} npm run scaffold:quest -- --name ${name} --spiraldb ${spiraldb}`,
    );
    console.log('');
    console.log(run.scaffold.stdout.trimEnd());
    printBootLine(afterLine, "AFTER — Imlight's own log line, after the scaffold");

    const identical = (lines: readonly SpiralDbLoadLine[]): string =>
      `${lines.length} reading(s), ${new Set(lines.map((l) => l.raw)).size === 1 ? 'all identical' : 'THEY DISAGREE'}`;
    const report = [
      '=== the count proof (p6-12-ac2) ===',
      `  baseline line : ${baselineLine.raw}`,
      `  scaffold      : ${name} — exit ${run.scaffold.exitCode}, one file into ${spiraldb}`,
      `  after line    : ${afterLine.raw}`,
      `  arithmetic    : ${run.proof.arithmetic}`,
      `  delta         : ${run.proof.delta} (expected 1)`,
      `  verdict       : ${run.proof.ok ? 'PASS — rises by exactly one' : 'FAIL'}`,
      `  detail        : ${run.proof.detail}`,
      `  baseline readings inside the one process: ${identical(run.baselineLines)}`,
      `  after readings inside the one process   : ${identical(run.afterLines)}`,
      `  files counter : baseline ${baselineLine.files} -> after ${afterLine.files} (delta ${afterLine.files - baselineLine.files})`,
      `  seven non-quest families: ${[
        'spellbooks',
        'dropTables',
        'npcInventories',
        'npcSpellInventories',
        'npcDropTables',
        'treasureCardInventories',
        'zoneData',
      ]
        .map(
          (family) =>
            `${family} ${String((afterLine as unknown as Record<string, number>)[family])}`,
        )
        .join(', ')}`,
    ].join('\n');
    console.log('');
    console.log(report);

    if (flags['restore-clone'] === true) {
      restoreClone(snapshot);
      const restored = snapshotClone();
      const comparison = compareCloneAxes(restored, CLONE_EXPECTATION);
      console.log('');
      console.log('=== the clone after the restore (five axes + the corpus shape) ===');
      console.log(
        renderTable([
          ['axis', 'expected', 'actual', 'ok'],
          ...comparison.rows.map((r) => [r.axis, r.expected, r.actual, r.ok ? 'ok' : 'MISMATCH']),
        ]),
      );
      console.log('');
      console.log(`  branches now: ${restored.branches.join(' ')}`);
      console.log(`  remotes now : ${restored.remotes.join(' ')}`);
      console.log(
        comparison.ok
          ? '  every axis matches — the clone is restored'
          : '  THE CLONE DID NOT RESTORE',
      );
      fs.writeFileSync(
        path.join(evidenceDir, `${prefix}-clone-restore.txt`),
        [
          '=== the D17 clone after the restore (five axes + the corpus shape) ===',
          renderTable([
            ['axis', 'expected', 'actual', 'ok'],
            ...comparison.rows.map((r) => [r.axis, r.expected, r.actual, r.ok ? 'ok' : 'MISMATCH']),
          ]),
          '',
          `  branches now: ${restored.branches.join(' ')}`,
          `  remotes now : ${restored.remotes.join(' ')}`,
          `  verdict     : ${comparison.ok ? 'restored' : 'NOT RESTORED'}`,
        ].join('\n') + '\n',
      );
      if (!comparison.ok) {
        process.exit(6);
      }
    }

    fs.writeFileSync(path.join(evidenceDir, `${prefix}-count.txt`), `${report}\n`);
    console.log(
      `[harness] evidence: ${path.join(evidenceDir, `${prefix}-imlight-boot-baseline.txt`)}, ` +
        `${path.join(evidenceDir, `${prefix}-imlight-boot-after.txt`)}, ` +
        `${path.join(evidenceDir, `${prefix}-count.txt`)}`,
    );

    if (flags['keep-services'] === true) {
      console.log(
        '[harness] --keep-services: leaving the Aurorium it started running (the reuse arm)',
      );
    } else {
      await stopOwnedAurorium();
    }
    return;
  }

  console.error(`[harness] unknown mode: ${mode}`);
  usage();
}

main().catch((error: unknown) => {
  if (error instanceof HarnessError) {
    console.error(`[harness] ${error.code}: ${error.message}`);
    process.exit(
      error.code === 'stale'
        ? 4
        : error.code === 'port-foreign'
          ? 3
          : error.code === 'usage'
            ? 2
            : 5,
    );
  }
  console.error(error);
  process.exit(1);
});
