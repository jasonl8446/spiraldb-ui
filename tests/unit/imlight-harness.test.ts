import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  auroriumIdentity,
  bootFailure,
  classifyPort,
  compareCloneAxes,
  describeDirtyClone,
  describeWriteRootDivergence,
  evaluateFreshness,
  forgetOwned,
  HarnessError,
  HARNESS_EXIT_CODES,
  harnessExitCode,
  HARNESS_PORTS,
  leftoverIsOwned,
  parseSpiralDbLoadLines,
  PORT_SERVICE,
  portDecisions,
  proveCountRisesByExactlyOne,
  proveCountRise,
  readBootLine,
  readOwnership,
  recordOwned,
  refusalMessage,
  restoreCommands,
  serviceOfCommandLine,
  type BootOutcome,
  type CloneSnapshot,
  type GitCommitRecord,
  type Listener,
  type OwnershipLedger,
  type OwnedProcess,
  type PortVerdict,
} from '@server/services/imlightHarness';
import { codeOf } from '../helpers/source-text';

/**
 * p6-12 — the live-load harness's decisions, with **the harness absent**.
 *
 * The boot itself needs .NET 10, a Rust binary, the 866 MB Imlight copy and five ports; CI has
 * none of them (D55). So the real boot's raw logs are a recorded artifact under
 * `docs/evidence/phase-6/` and this file tests what the harness *decides*, through the seam that
 * makes that possible: `proveCountRisesByExactlyOne()` takes its two boot logs as an injected
 * function, and the **fake log** below is what stands in for the Director's console. Nothing here
 * opens a socket, spawns a process or reads the copy — the cabling test at the bottom of the file
 * fails if that ever stops being true.
 */

// ---------------------------------------------------------------------------
// The fake log: the Director's own line, verbatim shape, three times per boot
// ---------------------------------------------------------------------------

const SERILOG_PREFIX = '2026-09-29 00:00:00.000 INF SpiralDB.Load@L149                       : ';

/**
 * One boot's console, in the shape the real one was measured in: the same `SpiralDB loaded` line
 * repeats **three times inside one process** (patch, login and game each touch the collection).
 * The counts are the ones the real 322-file clone produced on this host.
 */
function fakeBootLog(input: { questTemplates: number; files: number; zoneData?: number }): string {
  const zoneData = input.zoneData ?? 1205;
  const line =
    `SpiralDB loaded ${input.files} files: 134 spellbooks, 317 drop tables, 215 NPC inventories, ` +
    `77 NPC spell inventories, 0 NPC drop tables, 1 treasure card inventories, ` +
    `${input.questTemplates} quest templates, ${zoneData} zone data entries.`;
  return [
    ' _____           _ _       _     _    ______   ',
    `${SERILOG_PREFIX}Loading SpiralDB from /home/jason/Documents/git-projects/spiraldb-ui/data/test-spiraldb...`,
    `${SERILOG_PREFIX}${line}`,
    `${SERILOG_PREFIX}${line}`,
    `${SERILOG_PREFIX}${line}`,
    `${SERILOG_PREFIX}Imlight may now be connected to.`,
  ].join('\n');
}

const BASELINE_LOG = fakeBootLog({ files: 2274, questTemplates: 322 });
const AFTER_LOG = fakeBootLog({ files: 2275, questTemplates: 323 });

describe('p6-12 — the assertion is Imlight’s own log line', () => {
  it('reads the quest-template count out of the process under test’s line', () => {
    const lines = parseSpiralDbLoadLines(BASELINE_LOG);
    expect(lines).toHaveLength(3);
    expect(lines[0]?.questTemplates).toBe(322);
    expect(lines[0]?.zoneData).toBe(1205);
    expect(lines[0]?.files).toBe(2274);
    // The seven other families are read too, because the +1 proof has to show they did not move.
    expect(lines[0]?.spellbooks).toBe(134);
    expect(lines[0]?.npcDropTables).toBe(0);
  });

  it('strips the console sink’s ANSI colour so a redirected stream still parses', () => {
    const coloured = `\u001b[32m${SERILOG_PREFIX}SpiralDB loaded 3 files: 0 spellbooks, 0 drop tables, 0 NPC inventories, 0 NPC spell inventories, 0 NPC drop tables, 0 treasure card inventories, 7 quest templates, 0 zone data entries.\u001b[0m`;
    expect(parseSpiralDbLoadLines(coloured)[0]?.questTemplates).toBe(7);
  });

  it('refuses a boot whose three readings disagree — one process reads one corpus', () => {
    const text = `${fakeBootLog({ files: 2274, questTemplates: 322 })}\n${SERILOG_PREFIX}SpiralDB loaded 2275 files: 134 spellbooks, 317 drop tables, 215 NPC inventories, 77 NPC spell inventories, 0 NPC drop tables, 1 treasure card inventories, 323 quest templates, 1205 zone data entries.`;
    expect(() => readBootLine({ label: 'baseline', consoleText: text })).toThrow(
      /different counts/,
    );
  });

  it('reads nothing from a log that never printed the line', () => {
    expect(() =>
      readBootLine({ label: 'baseline', consoleText: 'Patch server is not reachable.\n' }),
    ).toThrow();
  });
});

describe('p6-12-ac2 — the count rises by exactly one across a scaffold', () => {
  it('proves +1 from the two lines, with the arithmetic spelled out', () => {
    const proof = proveCountRise({
      baseline: parseSpiralDbLoadLines(BASELINE_LOG)[0]!,
      after: parseSpiralDbLoadLines(AFTER_LOG)[0]!,
      questName: 'AQ-GARD-SIS-001',
    });
    expect(proof.delta).toBe(1);
    expect(proof.arithmetic).toBe('322 + 1 = 323');
    expect(proof.ok).toBe(true);
  });

  it('fails when a second family moved too — that is a different corpus, not a scaffold', () => {
    const proof = proveCountRise({
      baseline: parseSpiralDbLoadLines(BASELINE_LOG)[0]!,
      after: parseSpiralDbLoadLines(
        fakeBootLog({ files: 2275, questTemplates: 323, zoneData: 1206 }),
      )[0]!,
      questName: 'AQ-GARD-SIS-001',
    });
    expect(proof.ok).toBe(false);
    expect(proof.detail).toMatch(/zoneData moved 1205 -> 1206/);
  });

  it('fails when the file counter and the quest counter disagree', () => {
    const proof = proveCountRise({
      baseline: parseSpiralDbLoadLines(BASELINE_LOG)[0]!,
      // Two quest templates added but only one file: not the same process shape.
      after: parseSpiralDbLoadLines(fakeBootLog({ files: 2275, questTemplates: 324 }))[0]!,
      questName: 'AQ-GARD-SIS-001',
    });
    expect(proof.ok).toBe(false);
    expect(proof.detail).toMatch(/moved by 2, not 1/);
  });

  it('fails when nothing moved — the scaffold did not reach the corpus', () => {
    const proof = proveCountRise({
      baseline: parseSpiralDbLoadLines(BASELINE_LOG)[0]!,
      after: parseSpiralDbLoadLines(BASELINE_LOG)[0]!,
      questName: 'AQ-GARD-SIS-001',
    });
    expect(proof.ok).toBe(false);
    expect(proof.arithmetic).toBe('322 + 0 = 322');
  });
});

describe('p6-12-ac4 — the unit suite injects a fake log, so it needs no ports and no .NET', () => {
  it('drives the whole proof through the injected boot seam, calling the scaffold in between', async () => {
    const calls: string[] = [];
    const boots: string[] = [BASELINE_LOG, AFTER_LOG];
    const run = await proveCountRisesByExactlyOne({
      questName: 'AQ-GARD-SIS-001',
      boot: async ({ label }): Promise<BootOutcome> => {
        calls.push(`boot:${label}`);
        return { label, consoleText: boots.shift() ?? '', exitCode: 0 };
      },
      scaffold: async ({ name }) => {
        calls.push(`scaffold:${name}`);
        return { exitCode: 0, stdout: `[spiraldb-ui] scaffolded ${name}\n`, stderr: '' };
      },
    });

    expect(calls).toEqual(['boot:baseline', 'scaffold:AQ-GARD-SIS-001', 'boot:after']);
    expect(run.proof.delta).toBe(1);
    expect(run.proof.ok).toBe(true);
    expect(run.baselineLines).toHaveLength(3);
    expect(run.afterLines).toHaveLength(3);
  });

  it('stops before the second boot when the scaffold refuses', async () => {
    const boot = vi.fn(async ({ label }: { label: string }): Promise<BootOutcome> => ({
      label,
      consoleText: BASELINE_LOG,
    }));
    await expect(
      proveCountRisesByExactlyOne({
        questName: 'AQ-GARD-SIS-001',
        boot,
        scaffold: async () => ({ exitCode: 1, stdout: '', stderr: 'refused (404): unknown quest' }),
      }),
    ).rejects.toThrow(/failed with exit code 1[\s\S]*refused \(404\)/);
    expect(boot).toHaveBeenCalledTimes(1);
  });

  it('carries the Root.wad abort out of a real failure signature, not a timeout', async () => {
    const log =
      'ERR PatchServer.GetPatchServerStatus : Patch server at URL http://127.0.0.1:12369/V_x is not reachable\n' +
      'Unhandled exception. System.Exception: Patch server is not reachable. Cannot load Root.wad.\n' +
      '   at Imlight.CoreLib.Shared.Resources.RootArchiveLoader.ResourceWad()\n';
    expect(bootFailure(log)?.why).toMatch(/blocker 1 of task 6.11/);
    await expect(
      proveCountRisesByExactlyOne({
        questName: 'X',
        boot: async ({ label }) => ({ label, consoleText: log, timedOut: false }),
        scaffold: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      }),
    ).rejects.toThrow(/Cannot load Root\.wad/);
  });

  it('names the .NET-10-missing failure instead of waiting out the deadline', () => {
    expect(
      bootFailure('You must install .NET to run this application. Architecture: x64')?.why,
    ).toMatch(/DOTNET_ROOT/);
  });

  it('keeps the decisions in a module that cannot touch the machine', () => {
    const service = codeOf(
      readFileSync(
        fileURLToPath(new URL('../../server/src/services/imlightHarness.ts', import.meta.url)),
        'utf8',
      ),
    );
    // The seam only exists if the service stays pure: one `spawn`/`net`/`fs` call here and the unit
    // suite starts needing the environment the criteria exclude.
    expect(service, 'the service must import nothing from node').not.toMatch(/from 'node:/);
    expect(service).not.toMatch(/\b(child_process|execFileSync|spawn|createConnection)\b/);
    expect(service).not.toMatch(/\bfs\./);

    // The positive partner: the CLI is where those calls live, so this is a split and not an absence.
    const cli = codeOf(
      readFileSync(
        fileURLToPath(new URL('../../scripts/imlight-boot.ts', import.meta.url)),
        'utf8',
      ),
    );
    expect(cli).toMatch(/from 'node:child_process'/);
    expect(cli).toMatch(/from 'node:net'/);
  });
});

// ---------------------------------------------------------------------------
// Ownership follows the starter (ac3)
// ---------------------------------------------------------------------------

function process_(input: Partial<OwnedProcess> & { pid: number }): OwnedProcess {
  return {
    starttime: '1000',
    cmdline: '/home/jason/Documents/git-projects/Aurorium/target/debug/aurorium ',
    service: 'aurorium',
    role: 'patch source',
    runDir: 'tools/.aurorium-run',
    startedAt: '2026-09-29T00:00:00.000Z',
    ...input,
  };
}

function ledger(...processes: OwnedProcess[]): OwnershipLedger {
  return { version: 1, processes };
}

function listener(input: {
  pid: number;
  cmdline: string;
  ancestry?: Listener['ancestry'];
}): Listener {
  const self = { pid: input.pid, cmdline: input.cmdline, starttime: '1000' };
  return { ...self, ancestry: input.ancestry ?? [self] };
}

describe('p6-12-ac3 — ownership follows the starter', () => {
  it('reuses the Aurorium it started, and says so as owned', () => {
    const own = process_({ pid: 4242 });
    const verdict = classifyPort({
      port: 12369,
      listener: listener({ pid: 4242, cmdline: own.cmdline }),
      ledger: ledger(own),
    });
    expect(verdict.status).toBe('owned');
    expect(verdict.detail).toMatch(/reuse, do not stop/);
    expect(portDecisions([verdict]).reuse).toEqual([12369]);
    expect(portDecisions([verdict]).refused).toEqual([]);
  });

  it('reuses an Aurorium it did not start — a sibling, left alone', () => {
    const verdict = classifyPort({
      port: 12369,
      listener: listener({ pid: 99, cmdline: process_({ pid: 99 }).cmdline }),
      ledger: ledger(),
    });
    expect(verdict.status).toBe('sibling');
    expect(verdict.detail).toMatch(/leave it alone \(D114\)/);
  });

  it('refuses a decoy on 12369 and NAMES the port', () => {
    const verdict = classifyPort({
      port: 12369,
      listener: listener({
        pid: 777,
        cmdline: 'node -e const http=require("http");http.createServer(...).listen(12369)',
      }),
      ledger: ledger(process_({ pid: 4242 })),
    });
    expect(verdict.status).toBe('foreign');
    const message = refusalMessage([verdict]);
    expect(message).toMatch(/port 12369/);
    expect(message).toMatch(/not the aurorium this port must serve/);
    expect(message).toMatch(/does not own/);
  });

  it('refuses a decoy parked on any of the five, naming that port', () => {
    for (const port of HARNESS_PORTS) {
      const verdict = classifyPort({
        port,
        listener: listener({ pid: 500, cmdline: '/usr/bin/python3 -m http.server 5000' }),
        ledger: ledger(),
      });
      expect(verdict.status, `port ${port}`).toBe('foreign');
      expect(refusalMessage([verdict])).toContain(`port ${port}`);
    }
  });

  it('accepts the Director’s RavenDB child on 8080 by ancestry, not by its own command line', () => {
    const director = {
      pid: 900,
      cmdline: '/nix/store/xxx-dotnet-sdk-10.0.401/share/dotnet/dotnet Imlight.Director.dll ',
      starttime: '1000',
    };
    const raven = {
      pid: 901,
      cmdline:
        'dotnet --fx-version 10.0.12 /ws/tools/.imlight-run/RavenDBServer/Raven.Server.dll --Embedded.ParentProcessId=900 --ServerUrl=http://127.0.0.1:8080 ',
      starttime: '1001',
    };
    const verdict = classifyPort({
      port: 8080,
      listener: { ...raven, ancestry: [raven, director] },
      ledger: ledger(),
    });
    expect(verdict.status).toBe('sibling');
    expect(verdict.pid).toBe(901);
  });

  it('treats an unattributable listener as foreign — the port check fails closed', () => {
    const verdict = classifyPort({
      port: 12500,
      listener: listener({ pid: 0, cmdline: '(ss reported no owning pid)' }),
      ledger: ledger(),
    });
    expect(verdict.status).toBe('foreign');
    expect(verdict.detail).toMatch(/names neither sibling service/);
  });

  it('does not read the word "aurorium" in a command line as ownership', () => {
    expect(serviceOfCommandLine('node -e "// aurorium decoy"')).toBeUndefined();
    expect(serviceOfCommandLine('node /home/jason/decoy/aurorium.js')).toBeUndefined();
    expect(
      serviceOfCommandLine('/home/jason/Documents/git-projects/Aurorium/target/debug/aurorium '),
    ).toBe('aurorium');
    expect(serviceOfCommandLine('/nix/store/x/share/dotnet/dotnet Imlight.Director.dll ')).toBe(
      'imlight',
    );
  });

  it('classifies a free port as startable and says why', () => {
    const verdict = classifyPort({ port: 12000, listener: undefined, ledger: ledger() });
    expect(verdict.status).toBe('free');
    expect(PORT_SERVICE[12000]).toBe('imlight');
    expect(verdict.detail).toMatch(/may bind it/);
  });

  it('reads an absent or corrupt ledger as empty rather than as an error', () => {
    expect(readOwnership(undefined).processes).toEqual([]);
    expect(readOwnership('not json').processes).toEqual([]);
    expect(readOwnership('{"version":2,"processes":[{}]}').processes).toEqual([]);
    const recorded = recordOwned(readOwnership(undefined), process_({ pid: 1 }));
    expect(recordOwned(recorded, process_({ pid: 1, role: 'again' })).processes).toHaveLength(1);
    expect(forgetOwned(recorded, 1).processes).toHaveLength(0);
  });

  it('identifies Aurorium by its own /latest answer, not by "something is listening"', () => {
    expect(
      auroriumIdentity({
        reachable: true,
        latestBody: 'V_r806919.Wizard_1_610',
        expectedRevision: 'V_r806919.Wizard_1_610',
      }).ok,
    ).toBe(true);
    const decoy = auroriumIdentity({
      reachable: true,
      latestBody: '<html>hello</html>',
      expectedRevision: 'V_r806919.Wizard_1_610',
    });
    expect(decoy.ok).toBe(false);
    expect(decoy.detail).toMatch(/not serving this run's revision/);
    expect(
      auroriumIdentity({ reachable: true, latestBody: '{}', expectedRevision: 'V_x' }).ok,
    ).toBe(false);
    expect(auroriumIdentity({ reachable: false, latestBody: '', expectedRevision: 'V_x' }).ok).toBe(
      false,
    );
    expect(auroriumIdentity({ reachable: true, latestBody: '', expectedRevision: '' }).ok).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Freshness (ac4)
// ---------------------------------------------------------------------------

const COMMITS: GitCommitRecord[] = [
  {
    sha: '6e5966b2cc3e4b2242397419f80d6cd9e6ed5a79',
    dateIso: '2026-09-27T16:56:17+00:00',
    files: ['docs/commands.md'],
  },
  {
    sha: 'f8c54a8079b01825a95900902bcd86b3cc17cea5',
    dateIso: '2026-09-27T16:42:30+00:00',
    files: ['src/Imlight.Director/AGENTS.md', 'AGENTS.md'],
  },
  {
    sha: '480ff8c7e336c1d1a9d3eaac3ad1a4676cf2e28e',
    dateIso: '2026-09-27T06:03:20+00:00',
    files: ['src/Imlight.CoreLib/WizardData/SpiralDB.cs'],
  },
  {
    sha: 'aaaaaaaabbbbbbbbccccccccddddddddeeeeeeee',
    dateIso: '2026-09-20T06:03:20+00:00',
    files: ['src/Imlight.Director/Imlight.Director.csproj'],
  },
];

describe('p6-12-ac4 — the prebuilt output is trusted only while it is code-current', () => {
  it('reports code-current when the only commits after the mtime are docs', () => {
    const verdict = evaluateFreshness({
      dllMtimeIso: '2026-09-27T14:32:58.321Z',
      commits: COMMITS,
      rebuildCommand: 'dotnet build …',
    });
    expect(verdict.verdict).toBe('code-current');
    expect(verdict.commitsAfter.map((c) => c.sha.slice(0, 7))).toEqual(['6e5966b', 'f8c54a8']);
    expect(verdict.codeCommitsAfter).toEqual([]);
    expect(verdict.detail).toMatch(/0 touched src\/\*\*\/\*\.cs or \*\.csproj/);
  });

  it('a `.cs` commit after the mtime makes it stale — a doctored mtime is enough', () => {
    const verdict = evaluateFreshness({
      dllMtimeIso: '2026-09-01T00:00:00.000Z',
      commits: COMMITS,
      rebuildCommand: 'dotnet build …',
    });
    expect(verdict.verdict).toBe('stale');
    expect(verdict.codeCommitsAfter.map((c) => c.sha.slice(0, 7))).toEqual(['480ff8c', 'aaaaaaa']);
    expect(verdict.detail).toMatch(/predates the code/);
  });

  it('a `.csproj` commit counts, at any depth', () => {
    const verdict = evaluateFreshness({
      dllMtimeIso: '2026-09-19T00:00:00.000Z',
      commits: [COMMITS[3]!],
      rebuildCommand: 'dotnet build …',
    });
    expect(verdict.verdict).toBe('stale');
  });

  it('an touched-but-doc commit immediately before the mtime is not after it', () => {
    const verdict = evaluateFreshness({
      dllMtimeIso: '2026-09-27T16:56:17+00:00',
      commits: COMMITS,
      rebuildCommand: 'dotnet build …',
    });
    // `>` and not `>=`: the build that lands in the same second as its own commit is still its own.
    expect(verdict.commitsAfter.map((c) => c.sha.slice(0, 7))).toEqual([]);
  });

  it('refuses an unparseable mtime instead of guessing', () => {
    expect(() =>
      evaluateFreshness({ dllMtimeIso: 'last tuesday', commits: [], rebuildCommand: 'x' }),
    ).toThrow(/not a parseable mtime/);
  });
});

// ---------------------------------------------------------------------------
// The clone restore (the deferred half of p6-09-ac1)
// ---------------------------------------------------------------------------

const SNAPSHOT: CloneSnapshot = {
  branch: 'content/2026-09-27',
  head: '18dc92477d54b1e911796960407ce7710e703697',
  mainRef: 'f3f8b5c0a48bc0f0b0cd9aca2d9d7d9d0122bd37',
  count: 42,
  porcelain: [],
  questTemplates: 322,
  branches: ['content/2026-09-26', 'content/2026-09-27', 'main'],
  remotes: ['origin/HEAD', 'origin/main'],
};

describe('p6-12 — the clone restore plans the D76(b) case: a branch left behind is not a restore', () => {
  it('checks out, resets hard, and deletes every branch that appeared', () => {
    const { steps, extraBranches } = restoreCommands(SNAPSHOT, [
      'content/2026-09-26',
      'content/2026-09-27',
      'content/2026-09-28',
      'main',
    ]);
    expect(extraBranches).toEqual(['content/2026-09-28']);
    expect(steps).toEqual([
      ['checkout', '-f', 'content/2026-09-27'],
      ['reset', '--hard', '18dc92477d54b1e911796960407ce7710e703697'],
      ['branch', '-D', 'content/2026-09-28'],
    ]);
  });

  /**
   * The shape that actually broke the first real restore: the snapshot read `%(refname)` (full
   * refnames) while the restore read `%(refname:short)`. The unit suite passed because it handed
   * both sides the same spelling — the mock was not as demanding as reality (D89) — and the first
   * real run deleted `content/2026-09-26` before failing on the checked-out branch.
   */
  it('normalises full refnames against short ones, so a real snapshot cannot look "all extra"', () => {
    const fullNameSnapshot: CloneSnapshot = {
      ...SNAPSHOT,
      branches: [
        'refs/heads/content/2026-09-26',
        'refs/heads/content/2026-09-27',
        'refs/heads/main',
      ],
    };
    const { steps, extraBranches } = restoreCommands(fullNameSnapshot, [
      'content/2026-09-26',
      'content/2026-09-27',
      'main',
    ]);
    expect(extraBranches).toEqual([]);
    expect(steps).toEqual([
      ['checkout', '-f', 'content/2026-09-27'],
      ['reset', '--hard', '18dc92477d54b1e911796960407ce7710e703697'],
    ]);
  });

  it('never plans the deletion of the branch it just checked out', () => {
    const { steps, extraBranches, blockedBranches } = restoreCommands(
      { ...SNAPSHOT, branches: ['main'] },
      ['content/2026-09-27', 'main'],
    );
    expect(extraBranches).toEqual([]);
    expect(blockedBranches).toEqual(['content/2026-09-27']);
    expect(steps.map((step) => step.join(' '))).toEqual([
      'checkout -f content/2026-09-27',
      'reset --hard 18dc92477d54b1e911796960407ce7710e703697',
    ]);
  });

  it('deletes nothing when no branch appeared', () => {
    const { steps, extraBranches } = restoreCommands(SNAPSHOT, SNAPSHOT.branches);
    expect(extraBranches).toEqual([]);
    expect(steps).toHaveLength(2);
  });

  it('checks the five axes, the corpus shape and the branch set, and fails on any of them', () => {
    const good = compareCloneAxes(SNAPSHOT, {
      branch: SNAPSHOT.branch,
      head: SNAPSHOT.head,
      mainRef: SNAPSHOT.mainRef,
      count: SNAPSHOT.count,
      questTemplates: SNAPSHOT.questTemplates,
      branches: SNAPSHOT.branches,
    });
    expect(good.ok).toBe(true);
    expect(good.rows).toHaveLength(7);

    // D76(b): the commit is back where it belongs and a branch was left behind.
    const strayBranch = compareCloneAxes(
      { ...SNAPSHOT, branches: [...SNAPSHOT.branches, 'content/2026-09-28'] },
      {
        branch: SNAPSHOT.branch,
        head: SNAPSHOT.head,
        mainRef: SNAPSHOT.mainRef,
        count: SNAPSHOT.count,
        questTemplates: SNAPSHOT.questTemplates,
        branches: SNAPSHOT.branches,
      },
    );
    expect(strayBranch.ok).toBe(false);
    expect(strayBranch.rows.find((r) => r.axis === 'local branches (set)')?.actual).toContain(
      'content/2026-09-28',
    );

    const dirty = compareCloneAxes(
      { ...SNAPSHOT, porcelain: ['?? QuestTemplates/New.json'] },
      {
        branch: SNAPSHOT.branch,
        head: SNAPSHOT.head,
        mainRef: SNAPSHOT.mainRef,
        count: SNAPSHOT.count,
        questTemplates: SNAPSHOT.questTemplates,
      },
    );
    expect(dirty.ok).toBe(false);
    expect(dirty.rows.find((r) => r.axis === 'git status --porcelain')?.actual).toMatch(
      /New\.json/,
    );

    const short = compareCloneAxes(
      { ...SNAPSHOT, questTemplates: 323 },
      {
        branch: SNAPSHOT.branch,
        head: SNAPSHOT.head,
        mainRef: SNAPSHOT.mainRef,
        count: SNAPSHOT.count,
        questTemplates: SNAPSHOT.questTemplates,
      },
    );
    expect(short.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The port table the report prints
// ---------------------------------------------------------------------------

describe('p6-12 — the port table names every port, its service and its status', () => {
  it('covers the five owned ports in probe order', () => {
    const verdicts: PortVerdict[] = HARNESS_PORTS.map((port) =>
      classifyPort({ port, listener: undefined, ledger: ledger() }),
    );
    const decisions = portDecisions(verdicts);
    expect(decisions.start).toEqual([...HARNESS_PORTS]);
    expect(decisions.reuse).toEqual([]);
    expect(decisions.refused).toEqual([]);
  });

  it('keeps the probe order the criteria name', () => {
    expect([...HARNESS_PORTS]).toEqual([12369, 12500, 12000, 12333, 8080]);
  });

  it('exposes a role for every port, so a refusal can say what the port is for', () => {
    for (const port of HARNESS_PORTS) {
      expect(PORT_SERVICE[port]).toMatch(/aurorium|imlight/);
    }
  });
});

// ---------------------------------------------------------------------------
// The exit-code contract the header documents (the S2 defect of gate 1's deslop pass)
// ---------------------------------------------------------------------------

describe('p6-12 — the header’s exit codes have one home, and `6` is reachable', () => {
  it('maps every code, including the `count` arm the header promises as 6', () => {
    // The regression lock: before this arm existed a failed count proof fell through to the
    // generic `5` — the code reserved for "the Director did not produce its log line" — while the
    // header promised `6`. Both count failures (the scaffold refusal and the failed proof) throw
    // `HarnessError('count')`, so this map is the only place `6` can come from.
    expect(harnessExitCode('count')).toBe(6);
    expect(new HarnessError('the count proof failed: 0 not 1', 'count').code).toBe('count');
    expect(harnessExitCode(new HarnessError('x', 'count').code)).toBe(6);
  });

  it('keeps the whole documented table, so a new code cannot silently inherit 5', () => {
    expect(HARNESS_EXIT_CODES).toEqual({
      usage: 2,
      'port-foreign': 3,
      stale: 4,
      'boot-failed': 5,
      'log-line-missing': 5,
      count: 6,
    });
  });

  it('routes the CLI’s catch through that map, and keeps no second, unreachable guard', () => {
    const cli = codeOf(
      readFileSync(
        fileURLToPath(new URL('../../scripts/imlight-boot.ts', import.meta.url)),
        'utf8',
      ),
    );
    // The positive partner: the map is used, so it is not a second dead home for the contract.
    expect(cli).toMatch(/process\.exit\(harnessExitCode\(error\.code\)\)/);
    expect(cli, 'the mapping must not live inline in the CLI again').not.toMatch(
      /error\.code === 'port-foreign'/,
    );
    // The negative partner: the unreachable `!run.proof.ok` guard the harness makes dead must not
    // come back — a guard that cannot fire reads as the place `6` is produced and hides the throw.
    expect(cli).not.toMatch(/if \(!run\.proof\.ok\)/);
  });
});

// ---------------------------------------------------------------------------
// The scaffold's write root (the SHOULD-FIX of the Phase-6 independent review)
// ---------------------------------------------------------------------------

describe('p6-12 — the scaffold writes only into the clone the boot reads and the restore covers', () => {
  it('refuses a write root that is not the clone, naming both paths and which side each is', () => {
    const refusal = describeWriteRootDivergence('/owner/fork-with-328', '/clone-with-322');
    expect(refusal).not.toBeNull();
    expect(refusal).toContain('/owner/fork-with-328');
    expect(refusal).toContain('/clone-with-322');
    // D116's style: which one is written, and which one is read/restored.
    expect(refusal).toMatch(/scaffold would write into/);
    expect(refusal).toMatch(/boot reads and the snapshot\/restore cover/);
    expect(refusal).toMatch(/cannot raise the count proof/);
  });

  it('is silent when the write root is the clone — the default when --spiraldb is omitted', () => {
    expect(describeWriteRootDivergence('/clone-with-322', '/clone-with-322')).toBeNull();
  });

  it('is wired into prove-count as a refusal, before anything is started', () => {
    const cli = codeOf(
      readFileSync(
        fileURLToPath(new URL('../../scripts/imlight-boot.ts', import.meta.url)),
        'utf8',
      ),
    );
    expect(cli).toMatch(/describeWriteRootDivergence\(spiraldb, config\.clone\)/);
    expect(cli).toMatch(/throw new HarnessError\(`refusing: \$\{writeRootDivergence\}`, 'usage'\)/);
    // A refusal, not a warning printed past the point where the write happens.
    expect(cli).not.toMatch(/console\.warn\([^)]*writeRootDivergence/);
  });
});

// ---------------------------------------------------------------------------
// The leftover listener after the Director is stopped (the SHOULD-FIX of the review)
// ---------------------------------------------------------------------------

describe('p6-12 — a leftover listener is signalled only when this harness started it', () => {
  const director = {
    pid: 900,
    cmdline: '/nix/store/x/share/dotnet/dotnet Imlight.Director.dll ',
    starttime: '1000',
  };
  const raven = {
    pid: 901,
    cmdline:
      '/run/RavenDBServer/Raven.Server.dll --Embedded.ParentProcessId=900 --ServerUrl=http://127.0.0.1:8080 ',
    starttime: '1001',
  };
  const init = { pid: 1, cmdline: '/sbin/init', starttime: '1' };

  it('owns the Director itself — it survived the stop, and the pid matches', () => {
    expect(leftoverIsOwned({ listener: { ...director, ancestry: [director] }, director })).toBe(
      true,
    );
  });

  it('owns a descendant through the ancestry chain (the Director is still an ancestor)', () => {
    expect(leftoverIsOwned({ listener: { ...raven, ancestry: [raven, director] }, director })).toBe(
      true,
    );
  });

  it('owns a reparented RavenDB through its own marker — ancestry alone would not see it', () => {
    // The surviving-RavenDB case the leftover loop exists for: by the time the port is re-checked the
    // Director has been stopped, so the child's ancestry is [raven, init] and no longer holds him.
    const noMarker = {
      ...raven,
      cmdline: '/run/RavenDBServer/Raven.Server.dll --ServerUrl=http://127.0.0.1:8080 ',
    };
    expect(
      leftoverIsOwned({ listener: { ...noMarker, ancestry: [noMarker, init] }, director }),
    ).toBe(false); // reparented with nothing naming the Director: not ours
    expect(leftoverIsOwned({ listener: { ...raven, ancestry: [raven, init] }, director })).toBe(
      true,
    ); // the marker owns it
  });

  it('refuses a recycled pid: same number, different starttime is a stranger', () => {
    const recycled = { pid: 900, cmdline: '/usr/bin/something-else ', starttime: '9999' };
    expect(leftoverIsOwned({ listener: { ...recycled, ancestry: [recycled] }, director })).toBe(
      false,
    );
  });

  it('refuses a stranger with neither ancestry nor marker, whatever its pid', () => {
    const stranger = { pid: 4242, cmdline: '/usr/bin/caddy run ', starttime: '5000' };
    expect(
      leftoverIsOwned({ listener: { ...stranger, ancestry: [stranger, init] }, director }),
    ).toBe(false);
  });

  it('does not read a marker for a DIFFERENT director pid as ownership', () => {
    const otherRun = { ...raven, cmdline: raven.cmdline.replace('=900', '=1234') };
    expect(
      leftoverIsOwned({ listener: { ...otherRun, ancestry: [otherRun, init] }, director }),
    ).toBe(false);
  });

  it('is wired into the boot cleanup, before anything is signalled', () => {
    const cli = codeOf(
      readFileSync(
        fileURLToPath(new URL('../../scripts/imlight-boot.ts', import.meta.url)),
        'utf8',
      ),
    );
    expect(cli).toMatch(/leftoverIsOwned\(\{ listener, director: directorIdentity \}\)/);
    // The old form signalled `attr(port)` directly, with `isAlive` as its only guard.
    expect(cli, 'the unguarded leftover stop must not come back').not.toMatch(
      /stopProcessGroup\(leftover,/,
    );
    expect(cli).toMatch(
      /refusing to signal \$\{strangers\.length\} listener\(s\) this harness does not own/,
    );
    expect(cli).toMatch(
      /directorIdentity: ProcIdentity = identity \?\? \{ pid, cmdline: dll, starttime: '' \}/,
    );
  });
});

// ---------------------------------------------------------------------------
// A dirty clone refuses the run before the restore can erase it (the review's finding 5)
// ---------------------------------------------------------------------------

describe('p6-12 — a clone that is already dirty refuses the run before the restore', () => {
  it('names the files and says what the restore would do to them', () => {
    const refusal = describeDirtyClone([
      '?? QuestTemplates/SOMEONE-ELSES-WORK.json',
      ' M QuestTemplates/WC-CYCLOPS-MAIN-002.json',
    ]);
    expect(refusal).not.toBeNull();
    expect(refusal).toContain('QuestTemplates/SOMEONE-ELSES-WORK.json');
    expect(refusal).toContain('QuestTemplates/WC-CYCLOPS-MAIN-002.json');
    expect(refusal).toContain('2 uncommitted change(s)');
    expect(refusal).toMatch(/checkout -f \+ reset --hard/);
    expect(refusal).toMatch(/without a record/);
  });

  it('is silent on a clean clone — the state every recorded run measured', () => {
    expect(describeDirtyClone([])).toBeNull();
  });

  it('is checked before anything is started, and before the scaffold writes', () => {
    const cli = codeOf(
      readFileSync(
        fileURLToPath(new URL('../../scripts/imlight-boot.ts', import.meta.url)),
        'utf8',
      ),
    );
    expect(cli).toMatch(/describeDirtyClone\(snapshot\.porcelain\)/);
    expect(cli).toMatch(/throw new HarnessError\(`refusing: \$\{dirtyClone\}`, 'usage'\)/);
    // The order is the fix: the snapshot and its refusal must precede the first side effect
    // (`auroriumUp`) and, above all, the scaffold write the restore is meant to undo. Scoped to the
    // prove-count block, because `up` mode also calls `auroriumUp`.
    const block = cli.slice(cli.indexOf("if (mode === 'prove-count')"));
    const refusalAt = block.indexOf('describeDirtyClone(snapshot.porcelain)');
    const auroriumAt = block.indexOf('await auroriumUp(verdicts)');
    const proveAt = block.indexOf('proveCountRisesByExactlyOne({');
    expect(refusalAt).toBeGreaterThan(-1);
    expect(refusalAt).toBeLessThan(auroriumAt);
    expect(auroriumAt).toBeLessThan(proveAt);
  });
});
