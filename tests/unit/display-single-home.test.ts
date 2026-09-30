import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * **The one display rule, asserted as an absence.** (D105/P6-16; the criterion's
 * "a test asserts no second formatter exists in the client bundle".)
 *
 * `client/src/lib/display.ts` owns `"Name (ID)"`. Every surface that shows a friendly
 * value beside its technical one renders through it — `formatNameRow` (the names API's
 * rows, the dropdowns, the quest editors' reference fields), `npcDisplayName`, and
 * `namePair` for the object list's server-resolved `friendly_name`. A second construction
 * anywhere in the client is what this file exists to fail on.
 *
 * ## Why a scan, and why a *negative control*
 *
 * A detector that never fires is not evidence (D90(c): an instrument's insensitivity must
 * be proven by a negative control before trusting its clean result). So this suite has
 * three arms:
 *
 * 1. **The real tree** — every `.ts`/`.tsx` under `client/src` (the build inputs of the
 *    client bundle; a superset of any one build's output, and it works without a build)
 *    is scanned, and every hit must be either `display.ts` itself or one of
 *    {@link ALLOWED_LABELS}, each carrying a written reason. A hit nobody accounted for
 *    fails the test.
 * 2. **The allowlist cannot rot** — every allowlisted site must still be found, so a line
 *    that moves or disappears forces a deliberate update instead of silently widening.
 * 3. **The negative control** — a scratch module containing two deliberately wrong
 *    formatters (a template literal and a `+ ' (' +` concatenation) is scanned and must
 *    be reported as unaccounted-for hits. If the detector could not see those, arm 1
 *    would prove nothing.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CLIENT_SRC = path.join(ROOT, 'client', 'src');

/** The one home of the pair. */
const DISPLAY_MODULE = path.join('client', 'src', 'lib', 'display.ts');

/** One source file to scan. */
interface Source {
  /** Path relative to the repository root, POSIX separators. */
  file: string;
  text: string;
}

/** One place a `friendly (technical)` construction was found. */
interface Hit {
  file: string;
  line: number;
  text: string;
}

/**
 * The two shapes a pair is written in: a template literal (`${name} (${id})`) and string
 * concatenation (`name + ' (' + id + ')'`). Both are kept deliberately narrow — a
 * formatting expression, not just any two parenthesised values — so the detector's hits
 * are reviewable by hand.
 */
const PAIR_PATTERNS: readonly RegExp[] = [/\$\{[^}]*\}\s*\(\$\{[^}]*\}\)/, /\+\s*(['"`])\s*\(/];

/** Every hit of either pair shape in one source text. */
function hitsIn(source: Source): Hit[] {
  const hits: Hit[] = [];
  const lines = source.text.split('\n');
  lines.forEach((text, index) => {
    if (PAIR_PATTERNS.some((pattern) => pattern.test(text))) {
      hits.push({ file: source.file, line: index + 1, text: text.trim() });
    }
  });
  return hits;
}

/** Every `.ts`/`.tsx` under one directory, recursively. */
function readClientSources(dir: string = CLIENT_SRC): Source[] {
  const sources: Source[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sources.push(...readClientSources(absolute));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      sources.push({
        file: path.relative(ROOT, absolute).split(path.sep).join('/'),
        text: fs.readFileSync(absolute, 'utf8'),
      });
    }
  }
  return sources;
}

/**
 * The **non-pair** labels that legitimately look like `X (Y)`, each with the reason it is
 * not a name pair. `match` is a literal from the line, so a *moved* or *rewritten* site
 * fails the test rather than being silently tolerated.
 */
const ALLOWED_LABELS: ReadonlyArray<{ file: string; match: string; reason: string }> = [
  {
    file: 'client/src/components/objects/ObjectIdMultiSelect.tsx',
    match: '`Remove ${label} (${index + 1})`',
    reason: 'A remove-action label: the value in parentheses is a list position, not an id.',
  },
  {
    file: 'client/src/components/dashboard/TypeProgressSection.tsx',
    match: '`${row.fraction} (${formatPercent(row.percent)})`',
    reason: 'A verification fraction and its percentage; neither operand is a name.',
  },
  {
    file: 'client/src/components/quest/QuestGoalsEditor.tsx',
    match: "`${key} (${complexFieldOwner(key) ?? 'no Phase-3 editor'})`",
    reason: 'A field path and the editor that owns it, for a discovery message.',
  },
  {
    file: 'client/src/lib/card-titles.ts',
    match: '`${meaning} (${noun})`',
    reason:
      'A card title: its meaning and the goal class noun the glossary label ends in, not a name pair.',
  },
  {
    file: 'client/src/pages/ObjectDetailPage.tsx',
    match: 'Saved ${result.key} (${result.outcome})',
    reason: 'A save toast: the key plus the outcome word, not a friendly/technical pair.',
  },
];

/** Hits nobody accounted for: not `display.ts`, and not an allowlisted exact line. */
function unaccounted(hits: readonly Hit[]): Hit[] {
  return hits.filter((hit) => {
    if (hit.file === DISPLAY_MODULE.split(path.sep).join('/')) {
      return false;
    }
    return !ALLOWED_LABELS.some(
      (allowed) => allowed.file === hit.file && hit.text.includes(allowed.match),
    );
  });
}

describe('the pair has exactly one home in the client', () => {
  it('builds `Name (ID)` in display.ts and nowhere else unaccounted for', () => {
    const sources = readClientSources();
    expect(sources.length, 'the client tree was actually read').toBeGreaterThan(50);

    const hits = sources.flatMap(hitsIn);
    // The rule itself is present — otherwise a clean scan would be vacuous.
    expect(
      hits.filter((hit) => hit.file === DISPLAY_MODULE.split(path.sep).join('/')).length,
      'display.ts constructs the pair',
    ).toBe(1);
    expect(unaccounted(hits)).toEqual([]);
  });

  it('keeps every allowlisted non-pair label real, so the list cannot rot', () => {
    const sources = readClientSources();
    for (const allowed of ALLOWED_LABELS) {
      const source = sources.find((candidate) => candidate.file === allowed.file);
      expect(source, `${allowed.file} exists`).toBeDefined();
      const found = hitsIn(source as Source).some((hit) => hit.text.includes(allowed.match));
      expect(found, `${allowed.file}: ${allowed.match} (${allowed.reason})`).toBe(true);
    }
  });

  it('sees a deliberate second formatter — both shapes — in a scratch module', () => {
    // The negative control (D90(c)). Two shapes, one per pattern: a template literal and
    // a concatenation, written the way a second formatter would actually be written.
    const scratch = path.join(ROOT, 'data', '__test-scratch__', 'second-formatter');
    fs.mkdirSync(scratch, { recursive: true });
    const files = {
      'SecondFormatter.tsx': [
        'export function formatFriendly(name: string, id: string): string {',
        '  return `${name} (${id})`;',
        '}',
      ].join('\n'),
      'ConcatFormatter.ts': [
        'export function otherPair(name: string, key: string): string {',
        "  return name + ' (' + key + ')';",
        '}',
      ].join('\n'),
    };
    try {
      for (const [name, text] of Object.entries(files)) {
        fs.writeFileSync(path.join(scratch, name), text);
      }
      const sources = Object.entries(files).map(([name, text]) => ({
        file: `data/__test-scratch__/second-formatter/${name}`,
        text,
      }));

      const hits = sources.flatMap(hitsIn);
      expect(hits.map((hit) => hit.file).sort()).toEqual([
        'data/__test-scratch__/second-formatter/ConcatFormatter.ts',
        'data/__test-scratch__/second-formatter/SecondFormatter.tsx',
      ]);
      // …and the detector's verdict on them is "unaccounted for", which is what makes
      // arm 1's clean result meaningful.
      expect(unaccounted(hits)).toHaveLength(2);
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
});
