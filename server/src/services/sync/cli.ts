import type { Db } from '../../db.js';
import { runSync, type RunSyncResult, type SyncRunner } from './execute.js';

/**
 * `npm run sync` implementation — task 1.4g.
 *
 * The CLI is a thin shell around the orchestrator: it parses flags, hands the
 * connection to `runSync`, prints a readable summary and returns an exit code.
 * No pipeline logic lives here, so `POST /api/sync` and `npm run sync` cannot
 * drift apart.
 *
 * Reuse path: `--tree <dir>` (or `SPIRALDB_SYNC_TREE`) skips the unpack entirely
 * and reports the tree as reused — the evidence path for a re-run against the
 * spike-retained `/tmp/wad-spike`.
 */

export const SYNC_USAGE = `Usage: npm run sync [-- options]

  --tree <dir>       reuse an existing unpack tree (skip the ~17 s unpack)
  --aurorium <dir>   override the aurorium_path setting
  --spiraldb <dir>   override the spiraldb_path setting (quests/zones/drop_tables)
  --imcodec <file>   override the imcodec_path setting (the unpack CLI)
  --db <file>        use another SQLite file (default: data/spiraldb-ui.db)
  -h, --help         print this help

Environment: SPIRALDB_SYNC_TREE, SPIRALDB_SYNC_AURORIUM, SPIRALDB_SYNC_SPIRALDB,
SPIRALDB_SYNC_IMCODEC, SPIRALDB_SYNC_DB (flags win).`;

/** Parsed command line. Missing values fall back to environment then settings. */
export interface SyncCliArgs {
  tree?: string;
  auroriumPath?: string;
  spiraldbPath?: string;
  imcodecPath?: string;
  dbFile?: string;
  help: boolean;
  /** Flags that were not recognised (each causes a usage error). */
  unknown: string[];
}

const ENV_KEYS = {
  tree: 'SPIRALDB_SYNC_TREE',
  auroriumPath: 'SPIRALDB_SYNC_AURORIUM',
  spiraldbPath: 'SPIRALDB_SYNC_SPIRALDB',
  imcodecPath: 'SPIRALDB_SYNC_IMCODEC',
  dbFile: 'SPIRALDB_SYNC_DB',
} as const;

type ValueFlag = keyof typeof ENV_KEYS;

const FLAG_TO_KEY: Record<string, ValueFlag> = {
  '--tree': 'tree',
  '--aurorium': 'auroriumPath',
  '--spiraldb': 'spiraldbPath',
  '--imcodec': 'imcodecPath',
  '--db': 'dbFile',
};

/** `--flag value` and `--flag=value` are both accepted; env fills the gaps. */
export function parseSyncArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = process.env,
): SyncCliArgs {
  const args: SyncCliArgs = { help: false, unknown: [] };
  const values: Partial<Record<ValueFlag, string>> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      args.help = true;
      continue;
    }
    const equals = arg.indexOf('=');
    const name = equals === -1 ? arg : arg.slice(0, equals);
    const key = FLAG_TO_KEY[name];
    if (key === undefined) {
      args.unknown.push(arg);
      continue;
    }
    let value = equals === -1 ? undefined : arg.slice(equals + 1);
    if (value === undefined) {
      value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        args.unknown.push(arg);
        continue;
      }
      i += 1;
    }
    values[key] = value;
  }

  for (const [key, envKey] of Object.entries(ENV_KEYS) as Array<[ValueFlag, string]>) {
    const value = values[key] ?? env[envKey];
    if (value !== undefined && value !== '') {
      args[key] = value;
    }
  }

  return args;
}

function formatDuration(milliseconds: number): string {
  return milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(1)} s` : `${milliseconds} ms`;
}

function n(value: number): string {
  return value.toLocaleString('en-US');
}

/** Aligned `label : value` line. */
function field(label: string, value: string): string {
  return `  ${label.padEnd(20)}: ${value}`;
}

/**
 * The human-readable summary `npm run sync` prints. Pure, so the exit-code and
 * formatting contract is unit-tested without spawning a process.
 */
export function formatSyncSummary(result: RunSyncResult): string[] {
  const lines = [
    '=== SpiralDB UI — friendly-name sync ===',
    field('status', result.status.toUpperCase()),
    field('revision', result.revision ?? '(unresolved)'),
    field(
      'tree',
      result.treeDir === null
        ? '(none)'
        : `${result.reused ? 'reused' : 'unpacked'} ${result.treeDir}`,
    ),
  ];

  if (result.status === 'success') {
    lines.push(
      field('items', n(result.counts.items)),
      field('spells', n(result.counts.spells)),
      field('npcs', n(result.counts.npcs)),
      field('quests', n(result.counts.quests)),
      field('zones', n(result.counts.zones)),
      field('drop_tables', n(result.counts.drop_tables)),
      field('string_table', n(result.counts.string_table)),
    );
    const dropped =
      result.deduplicated.items + result.deduplicated.spells + result.deduplicated.npcs;
    if (dropped > 0) {
      // Measured reality: `spells.template_id` (the m_displayName index) is not
      // unique per spell template, so the primary key forces rows out. Reported,
      // never silent — see `SyncDedupe` in execute.ts.
      lines.push(
        field(
          'dropped (PK)',
          `${n(dropped)} rows (items ${n(result.deduplicated.items)}, ` +
            `spells ${n(result.deduplicated.spells)}, npcs ${n(result.deduplicated.npcs)})`,
        ),
      );
    }
    lines.push(
      field(
        'unpack / scan / write',
        `${formatDuration(result.timings.unpackMs)} / ${formatDuration(
          result.timings.scanMs,
        )} / ${formatDuration(result.timings.writeMs)}`,
      ),
      field('total', formatDuration(result.durationMs)),
      field('sync_history', `success row written at ${result.timestamp}`),
    );
  } else {
    lines.push(field('error', result.errorMessage ?? '(no message)'));
    lines.push(field('sync_history', `failed row written at ${result.timestamp}`));
  }

  return lines;
}

/** The orchestrator signature the CLI drives — injectable for tests. */
export type CliSyncRunner = SyncRunner;

export interface SyncCliOptions {
  /** Connection to sync into (the entry point opens `data/spiraldb-ui.db`). */
  db: Db;
  /** Arguments after the script name. */
  argv: readonly string[];
  /** Environment fallbacks; injectable so tests never read `process.env`. */
  env?: Record<string, string | undefined>;
  /** Orchestrator (tests inject a fake). */
  run?: CliSyncRunner;
  now?: () => Date;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

/**
 * Runs the CLI against an open connection and returns the process exit code:
 * `0` success, `1` failed sync, `2` usage error. Never throws — a failure is
 * reported on `stderr` with the orchestrator's own message.
 */
export async function runSyncCli(options: SyncCliOptions): Promise<number> {
  const stdout = options.stdout ?? ((line: string) => console.log(line));
  const stderr = options.stderr ?? ((line: string) => console.error(line));
  const args = parseSyncArgs(options.argv, options.env ?? process.env);

  if (args.help) {
    stdout(SYNC_USAGE);
    return 0;
  }
  if (args.unknown.length > 0) {
    stderr(`Unknown option${args.unknown.length === 1 ? '' : 's'}: ${args.unknown.join(', ')}`);
    stderr(SYNC_USAGE);
    return 2;
  }

  const run = options.run ?? runSync;
  const result = await run({
    db: options.db,
    now: options.now,
    treeDir: args.tree,
    overrides: {
      auroriumPath: args.auroriumPath,
      imcodecPath: args.imcodecPath,
      spiraldbPath: args.spiraldbPath,
    },
  });

  for (const line of formatSyncSummary(result)) {
    stdout(line);
  }
  if (result.status !== 'success') {
    stderr(`Sync failed: ${result.errorMessage ?? 'unknown error'}`);
    return 1;
  }
  return 0;
}
