import { afterEach, describe, expect, it } from 'vitest';

import { MEMORY_DB, openDb, type Db } from '@server/db';
import { formatSyncSummary, parseSyncArgs, runSyncCli } from '@server/services/sync/cli';
import type { RunSyncOptions, RunSyncResult } from '@server/services/sync/execute';
import {
  ZERO_QUEST_CATALOG_COUNTS,
  type QuestCatalogReport,
} from '@server/services/sync/questCatalog';

/**
 * `npm run sync` logic (task 1.4g) — flags, summary formatting and exit codes,
 * all exercised by injecting the orchestrator instead of spawning a process.
 */

const OPEN: Db[] = [];

afterEach(() => {
  while (OPEN.length > 0) {
    OPEN.pop()?.close();
  }
});

function memoryDb(): Db {
  const db = openDb({ file: MEMORY_DB });
  OPEN.push(db);
  return db;
}

/** The catalog stage's report, as the real one reads on the owner tree (task 6.4). */
const CATALOG_OK: QuestCatalogReport = {
  status: 'ok',
  reason: null,
  message: null,
  binary_path: '/repo/tools/bin/wad-scan',
  rows_read: 6733,
  extract_ms: 5310,
  collect_ms: 4200,
  write_ms: 900,
  counts: {
    ...ZERO_QUEST_CATALOG_COUNTS,
    corpus_rows: 328,
    catalog_rows: 1449,
    catalog_only_rows: 2,
    merged_rows: 1447,
    quests_rows: 1450,
    has_definition_rows: 328,
    reference_rows_raw: 3003,
    references: 2855,
    duplicate_references: 148,
    distinct_reference_keys: 2796,
    distinct_wad_entry_pairs: 2400,
    ids: 4823,
    ids_linked: 175,
    linked_ids_without_text: 115,
    id_collision_names: 2,
    id_collision_ids: 2,
    links_lost_direct: 1,
    links_lost_inferred: 1,
    id_collision_samples: [
      'NV-PostWL-MAIN-002 (direct) lost id 1608203 to LM-PostWL-MAIN-001',
      'LM-HEAP-MAIN-009 (inferred) lost id 1524782 to LM-HEAP-MAIN-007',
    ],
  },
  quests: {
    corpus: '/home/jason/Documents/git-projects/spiraldb',
    distinct_quest_names: 1447,
    catalog_rows: 1449,
    direct_links: 286,
    inferred_links: 6,
    no_link: 1157,
    with_goal_names: 873,
    references: 3003,
    reference_keys: 2796,
    duplicate_references: 207,
    rows_without_provenance: 0,
    registry_checks: {
      total: 2279,
      empty_quest_name: 1754,
      absent_quest_name: 525,
      with_entry_name: 2274,
    },
    nodes_scanned: 5282,
    direct_candidates: 423,
    direct_pairs: 313,
    link_only_names: 2,
    anchored_names: 602,
    inference_gaps: 24,
    inference_rejected: 18,
    link_conflicts: 0,
    holdout: null,
  },
  holdout: {
    corpus: '/home/jason/Documents/git-projects/spiraldb',
    method: 'neighbour-midpoint',
    pairs: 321,
    groups: 59,
    groups_with_gap: 51,
    groups_ascending: 51,
    groups_contiguous: 38,
    cases: 168,
    hits: 131,
    misses: 37,
    accuracy: 131 / 168,
    accepted_cases: 136,
    accepted_hits: 131,
  },
};

const SUCCESS: RunSyncResult = {
  status: 'success',
  revision: 'V_r806919.Wizard_1_610',
  counts: {
    items: 1234,
    spells: 2,
    npcs: 3,
    quests: 4,
    zones: 5,
    drop_tables: 6,
    string_table: 217394,
    persona_index: 9,
  },
  deduplicated: { items: 0, spells: 0, npcs: 0 },
  manifest: {
    entries: 137_423,
    assigned: 18_173,
    fallback: 0,
    mismatches: 0,
    missing: 0,
    mismatchSamples: [],
    missingSamples: [],
  },
  durationMs: 24_300,
  timestamp: '2026-09-25T15:30:00Z',
  reused: true,
  treeDir: '/tmp/wad-spike',
  timings: { unpackMs: 0, scanMs: 4100, writeMs: 3000 },
  catalog: CATALOG_OK,
};

interface Capture {
  lines: string[];
  errors: string[];
}

function capture(): { out: (line: string) => void; err: (line: string) => void } & Capture {
  const state: Capture = { lines: [], errors: [] };
  return {
    ...state,
    out: (line) => state.lines.push(line),
    err: (line) => state.errors.push(line),
  };
}

describe('parseSyncArgs', () => {
  it('accepts both --flag value and --flag=value', () => {
    expect(parseSyncArgs(['--tree', '/tmp/x'], {}).tree).toBe('/tmp/x');
    expect(parseSyncArgs(['--tree=/tmp/x'], {}).tree).toBe('/tmp/x');
  });

  it('falls back to the environment, with flags winning', () => {
    const env = { SPIRALDB_SYNC_TREE: '/tmp/env', SPIRALDB_SYNC_DB: '/tmp/db.sqlite' };
    expect(parseSyncArgs([], env).tree).toBe('/tmp/env');
    expect(parseSyncArgs([], env).dbFile).toBe('/tmp/db.sqlite');
    expect(parseSyncArgs(['--tree', '/tmp/flag'], env).tree).toBe('/tmp/flag');
    expect(parseSyncArgs([], { SPIRALDB_SYNC_TREE: '' }).tree).toBeUndefined();
  });

  it('rejects unknown flags and flags with a missing value', () => {
    expect(parseSyncArgs(['--nope'], {}).unknown).toEqual(['--nope']);
    expect(parseSyncArgs(['--tree'], {}).unknown).toEqual(['--tree']);
    expect(parseSyncArgs(['--tree', '--db', '/tmp/x'], {}).unknown).toEqual(['--tree']);
  });

  it('recognises --help', () => {
    expect(parseSyncArgs(['--help'], {}).help).toBe(true);
    expect(parseSyncArgs(['-h'], {}).help).toBe(true);
  });
});

describe('formatSyncSummary', () => {
  it('prints the revision, every table count, the timing split and the status', () => {
    const text = formatSyncSummary(SUCCESS).join('\n');

    expect(text).toContain('success');
    expect(text).toContain('V_r806919.Wizard_1_610');
    expect(text).toContain('reused /tmp/wad-spike');
    expect(text).toContain('items');
    expect(text).toContain('1,234');
    expect(text).toContain('217,394');
    expect(text).toContain('0 ms / 4.1 s / 3.0 s');
    expect(text).toContain('24.3 s');
  });

  it('prints the manifest provenance and the dropped (PK) line, zeroes included (D35)', () => {
    const text = formatSyncSummary(SUCCESS).join('\n');

    expect(text).toContain('manifest entries    : 137,423 ids');
    expect(text).toContain('manifest ids used   : 18,173 rows keyed by the manifest (fallback 0)');
    expect(text).toContain('id mismatches       : 0 rows');
    expect(text).toContain('missing manifest    : 0 rows');
    expect(text).toContain('dropped (PK)        : 0 rows (items 0, spells 0, npcs 0)');
  });

  it('reports a non-zero dropped (PK) count when the primary key forces rows out', () => {
    const text = formatSyncSummary({
      ...SUCCESS,
      deduplicated: { items: 1, spells: 13_003, npcs: 2 },
    }).join('\n');

    expect(text).toContain('dropped (PK)        : 13,006 rows (items 1, spells 13,003, npcs 2)');
  });

  it('prints the catalog stage, its counts and the sync-time hold-out (task 6.4)', () => {
    const text = formatSyncSummary(SUCCESS).join('\n');

    expect(text).toContain('catalog status      : OK');
    expect(text).toContain('catalog rows        : 1,449 (merged 1,447, new 2)');
    expect(text).toContain('quests rows         : 1,450 (has_definition = 1: 328)');
    expect(text).toContain(
      'catalog refs        : 2,855 rows kept (3,003 raw rows; 148 not inserted by the UNIQUE)',
    );
    expect(text).toContain(
      "reference keys      : 2,796 distinct (quest, wad, entry, class, goal) with a NULL goal_name read as '' — SQLite's UNIQUE keeps a NULL goal_name distinct, so the table holds 59 more rows",
    );
    expect(text).toContain(
      'quest ids           : 4,823 (linked 175; 115 links outside the text tier; 2 losing names on 2 ids)',
    );
    // The extracted-vs-recorded reconciliation: 286 − 1 = 285 direct, 6 − 1 = 5 inferred.
    expect(text).toContain(
      "links extracted     : 286 direct, 6 inferred, 1,157 none (the extractor's own count, catalog rows only)",
    );
    expect(text).toContain(
      'links lost          : 1 direct + 1 inferred name(s) claimed an id another name owns; a loser keeps link_kind = none',
    );
    // A collision is named and its unit is stated: the two tables must never disagree.
    expect(text).toContain(
      'id collisions       : NV-PostWL-MAIN-002 (direct) lost id 1608203 to LM-PostWL-MAIN-001; LM-HEAP-MAIN-009 (inferred) lost id 1524782 to LM-HEAP-MAIN-007',
    );
    expect(text).toContain(
      'hold-out            : 78.0% (neighbour-midpoint; 168 cases, 131 hits) on /home/jason/Documents/git-projects/spiraldb',
    );
    expect(text).toContain('catalog timing      : 5.3 s extract + 4.2 s read + 900 ms write');
  });

  it('prints the skipped catalog stage with its own message', () => {
    const text = formatSyncSummary({
      ...SUCCESS,
      catalog: {
        ...CATALOG_OK,
        status: 'skipped',
        reason: 'binary-missing',
        message:
          'WAD batch tool not found at /repo/tools/bin/wad-scan. Build it with: npm run build:wadscan',
        counts: { ...CATALOG_OK.counts, catalog_rows: 0, references: 0, ids: 0 },
        quests: null,
        holdout: null,
      },
    }).join('\n');

    expect(text).toContain('catalog status      : SKIPPED');
    expect(text).toContain(
      'binary-missing      : WAD batch tool not found at /repo/tools/bin/wad-scan',
    );
    expect(text).toContain('npm run build:wadscan');
    expect(text).not.toContain('hold-out');
  });

  it('prints the error and no counts for a failed run', () => {
    const text = formatSyncSummary({
      ...SUCCESS,
      status: 'failed',
      revision: null,
      reused: false,
      errorMessage: 'unpack exploded',
    }).join('\n');

    expect(text).toContain('FAILED');
    expect(text).toContain('unpack exploded');
    expect(text).toContain('failed row written');
    expect(text).not.toContain('string_table');
  });
});

describe('runSyncCli', () => {
  it('returns 0 and prints the summary on success', async () => {
    const io = capture();
    const seen: RunSyncOptions[] = [];

    const code = await runSyncCli({
      db: memoryDb(),
      argv: ['--tree', '/tmp/wad-spike'],
      env: {},
      stdout: io.out,
      stderr: io.err,
      run: async (options) => {
        seen.push(options);
        return SUCCESS;
      },
    });

    expect(code).toBe(0);
    expect(io.errors).toEqual([]);
    expect(io.lines.join('\n')).toContain('V_r806919.Wizard_1_610');
    expect(seen[0].treeDir).toBe('/tmp/wad-spike');
    expect(seen[0].overrides).toEqual({
      auroriumPath: undefined,
      imcodecPath: undefined,
      spiraldbPath: undefined,
    });
  });

  it('returns 1 and reports the error on the stderr stream when the sync fails', async () => {
    const io = capture();

    const code = await runSyncCli({
      db: memoryDb(),
      argv: [],
      env: {},
      stdout: io.out,
      stderr: io.err,
      run: async () => ({ ...SUCCESS, status: 'failed', errorMessage: 'no revision found' }),
    });

    expect(code).toBe(1);
    expect(io.errors.join('\n')).toContain('no revision found');
    expect(io.lines.join('\n')).toContain('FAILED');
  });

  it('returns 2 for an unknown flag, without running the orchestrator', async () => {
    const io = capture();
    let calls = 0;

    const code = await runSyncCli({
      db: memoryDb(),
      argv: ['--bogus'],
      env: {},
      stdout: io.out,
      stderr: io.err,
      run: async () => {
        calls += 1;
        return SUCCESS;
      },
    });

    expect(code).toBe(2);
    expect(calls).toBe(0);
    expect(io.errors.join('\n')).toContain('Unknown option: --bogus');
  });

  it('returns 0 and prints usage for --help, without running the orchestrator', async () => {
    const io = capture();
    let calls = 0;

    const code = await runSyncCli({
      db: memoryDb(),
      argv: ['--help'],
      env: {},
      stdout: io.out,
      stderr: io.err,
      run: async () => {
        calls += 1;
        return SUCCESS;
      },
    });

    expect(code).toBe(0);
    expect(calls).toBe(0);
    expect(io.lines.join('\n')).toContain('Usage: npm run sync');
  });
});
