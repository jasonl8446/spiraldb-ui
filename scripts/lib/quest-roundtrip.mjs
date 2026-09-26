// The quest round-trip comparison, shared by two callers:
//   * scripts/verify-captures.mjs      — the committed fixtures (deterministic, CI-friendly, 5 quests)
//   * scripts/audit-corpus-roundtrip.mjs — every quest in the corpus (the real-data fidelity audit)
// Both feed quest -> fixturegen -> imview-packet-reader -> quest' and compare the same fields, so the
// field list and the goal-type enum live here once (D28; Phase 2 AC#2).

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Mirrors the generated GOAL_TYPE enum (Imcodec.ObjectProperty TypeCache / GOAL_TYPE.g.cs): the
// CLI serialises m_goalType as a number, the corpus stores the enum name.
export const GOAL_TYPES = [
  'GOAL_TYPE_UNKNOWN',
  'GOAL_TYPE_BOUNTY',
  'GOAL_TYPE_BOUNTYCOLLECT',
  'GOAL_TYPE_SCAVENGE',
  'GOAL_TYPE_PERSONA',
  'GOAL_TYPE_WAYPOINT',
  'GOAL_TYPE_SCAVENGEFAKE',
  'GOAL_TYPE_ACHIEVERANK',
  'GOAL_TYPE_USAGE',
  'GOAL_TYPE_COMPLETEQUEST',
  'GOAL_TYPE_SOCIARANK',
  'GOAL_TYPE_SOCIACURRENCY',
  'GOAL_TYPE_SOCIAMINIGAME',
  'GOAL_TYPE_SOCIAGIVEITEM',
  'GOAL_TYPE_SOCIAGETITEM',
  'GOAL_TYPE_COLLECTAFTERBOUNTY',
  'GOAL_TYPE_ENCOUNTER_WAYPOINT_FOREACH',
];

// The generated apphost needs DOTNET_ROOT on NixOS (D45(3)); derive it so callers stay portable.
export function deriveDotnetRoot() {
  try {
    const resolved = execFileSync('bash', ['-c', 'readlink -f "$(command -v dotnet)"'], {
      encoding: 'utf8',
    }).trim();
    return resolved ? path.dirname(resolved) : undefined;
  } catch {
    return undefined;
  }
}

export function dotnetEnv() {
  const root = fs.existsSync('/usr/bin/dotnet') ? '/usr/bin' : deriveDotnetRoot();
  return { ...process.env, ...(root ? { DOTNET_ROOT: root } : {}) };
}

function dialogsOf(owner) {
  return owner?.m_dialogList?.m_dialogs ?? [];
}

function containerMap(quest) {
  const containers = new Map();

  const add = (key, entries) => {
    const seen = containers.get(key) ?? { blocks: 0, entries: 0 };
    containers.set(key, { blocks: seen.blocks + 1, entries: seen.entries + entries });
  };

  for (const dialog of dialogsOf(quest)) {
    add(`quest/${dialog.m_dialogTag ?? ''}`, dialog.m_dialogEntries?.length ?? 0);
  }

  for (const goal of quest.m_goals ?? []) {
    for (const dialog of dialogsOf(goal)) {
      add(`${goal.m_goalName}/${dialog.m_dialogTag ?? ''}`, dialog.m_dialogEntries?.length ?? 0);
    }
  }

  return containers;
}

function snapshot(quest, normalizeType) {
  const goals = quest.m_goals ?? [];
  const blocks = dialogsOf(quest).length + goals.reduce((n, g) => n + dialogsOf(g).length, 0);
  const entries =
    dialogsOf(quest).reduce((n, d) => n + (d.m_dialogEntries?.length ?? 0), 0) +
    goals.reduce(
      (n, g) => n + dialogsOf(g).reduce((m, d) => m + (d.m_dialogEntries?.length ?? 0), 0),
      0,
    );

  return {
    name: quest.m_questName,
    title: quest.m_questTitle,
    level: quest.m_questLevel,
    mainline: quest.m_mainline === true,
    goalCount: goals.length,
    goalNames: goals.map((g) => g.m_goalName),
    goalTypes: goals.map((g) => normalizeType(g.m_goalType)),
    dialogBlocks: blocks,
    dialogEntries: entries,
    containers: containerMap(quest),
  };
}

export const corpusSnapshot = (quest) =>
  snapshot(quest, (t) => (typeof t === 'string' ? t : `unexpected:${JSON.stringify(t)}`));

export const readerSnapshot = (quest) =>
  snapshot(quest, (t) => (typeof t === 'number' ? (GOAL_TYPES[t] ?? `#${t}`) : String(t)));

export function formatList(items) {
  return `[${items.join(', ')}]`;
}

export function formatTypes(types) {
  const runs = [];

  for (const type of types) {
    const last = runs.at(-1);

    if (last && last.type === type) {
      last.count++;
    } else {
      runs.push({ type, count: 1 });
    }
  }

  return formatList(runs.map((r) => (r.count > 1 ? `${r.type} x${r.count}` : r.type)));
}

export function formatContainers(map) {
  // Sorted so the row is order-independent (the reader and the corpus do not necessarily list the
  // same containers in the same order) and stable across runs.
  return `{${[...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, c]) => `${key}(blocks=${c.blocks}, entries=${c.entries})`)
    .join(', ')}}`;
}

/**
 * The compared field list, in the order both callers print it. `knownDefects` maps a label to the
 * explanation of why a mismatch there is a known reader limitation rather than a regression — such a
 * row is reported and counted, never silently ignored.
 */
export function compareSnapshots(wanted, got, knownDefects = {}) {
  const rows = [
    ['quest name', wanted.name, got.name],
    ['title', wanted.title, got.title],
    ['level', wanted.level, got.level],
    ['mainline', wanted.mainline, got.mainline],
    ['goal count', wanted.goalCount, got.goalCount],
    ['goal names (in order)', formatList(wanted.goalNames), formatList(got.goalNames)],
    ['goal types', formatTypes(wanted.goalTypes), formatTypes(got.goalTypes)],
    ['dialog blocks (ActorDialog count)', wanted.dialogBlocks, got.dialogBlocks],
    ['dialog entries (NPCDialogEntry count)', wanted.dialogEntries, got.dialogEntries],
    [
      'dialog entries per container',
      formatContainers(wanted.containers),
      formatContainers(got.containers),
    ],
  ];

  const compared = rows.map(([label, expected, actual]) => {
    const same =
      typeof expected === 'boolean' || typeof expected === 'number'
        ? expected === actual
        : String(expected) === String(actual);

    return {
      label,
      expected,
      actual,
      same,
      knownDefect: same ? undefined : knownDefects[label],
    };
  });

  return {
    compared,
    checks: compared.length,
    mismatches: compared.filter((r) => !r.same && !r.knownDefect).length,
    defectRows: compared.filter((r) => !r.same && r.knownDefect).length,
  };
}
