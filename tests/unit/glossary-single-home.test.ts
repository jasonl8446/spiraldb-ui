import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { GLOSSARY } from '@shared/glossary';

/**
 * **The glossary is the one label home, asserted as an absence.** (D131, task 7.8.)
 *
 * `shared/glossary.ts` owns every friendly label for a document key, a class, an enum literal
 * and a dialog section name. A second table that maps those to strings anywhere in `client/src`,
 * `shared` or `server/src` is what this file fails on. It is modelled on
 * `display-single-home.test.ts`: a scan of the real tree, and a negative control proving the
 * scan can see each shape of second table.
 *
 * Four shapes count as a label table, all measured against literals only (a call such as
 * `fieldLabel('m_x')` is a read, not a table):
 *
 * 1. **key → text**: a property named for a document key (`m_exitTeleporter: 'Exit teleporter'`).
 *    An empty string, an enum literal (`'ROP_AND'`) and another key (`'m_goalsOR'`) are values,
 *    not labels, so scaffolds and defaults do not match.
 * 2. **`label:` beside a key**: a `label: '…'` literal within four lines of a `key: 'm_…'`
 *    (the shape `quest-goals.ts` and `requirement-tree.ts` held before this story).
 * 3. **enum literal → text**: a property named for an enum literal with prose as its value
 *    (`ROP_AND: 'AND'`). Lower-case, hyphenated values are CSS classes and are not labels.
 * 4. **class → text**: a property named for a glossary class with a literal that is not the
 *    assembly-qualified `$type` or another class name (`ReqHasQuest: 'Requires quest'`; a ternary
 *    such as `x ? 'ReqHasEntry' : 'ReqHasQuest'` is a choice between names, not a label).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SCAN_ROOTS = ['client/src', 'shared', 'server/src'];
const GLOSSARY_FILE = 'shared/glossary.ts';

interface Source {
  file: string;
  text: string;
}

interface Hit {
  file: string;
  line: number;
  shape: string;
  text: string;
}

const CLASS_NAMES = Object.keys(GLOSSARY.classes);

const KEY_PROPERTY = /(?:^|[\s{,(])['"]?(m_[A-Za-z0-9]+)['"]?\s*:\s*(['"`])((?:(?!\2).)*)\2/;
const ENUM_PROPERTY =
  /(?:^|[\s{,(])['"]?((?:ACTIVITY|GOAL_TYPE|BT|ROP|ROUTING|TELEPORT|RT)_[A-Za-z]+)['"]?\s*:\s*(['"`])((?:(?!\2).)*)\2/;
const CLASS_PROPERTY = new RegExp(
  `(?:^|[\\s{,(])['"]?(${CLASS_NAMES.join('|')})['"]?\\s*:\\s*(['"\`])((?:(?!\\2).)*)\\2`,
);
const LABEL_LITERAL = /\blabel:\s*(['"`])/;
const KEY_LITERAL = /\bkey:\s*'m_/;
const ENUM_LITERAL_VALUE = /^[A-Z]+_[A-Za-z_]+$/;
const CSS_TOKENS = /^[a-z0-9\-\s/:.[\]]+$/;

/** Every hit of the four shapes in one source. */
function hitsIn(source: Source): Hit[] {
  const hits: Hit[] = [];
  const lines = source.text.split('\n');
  lines.forEach((text, index) => {
    const trimmed = text.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    const hit = (shape: string): void => {
      hits.push({ file: source.file, line: index + 1, shape, text: trimmed });
    };
    const key = KEY_PROPERTY.exec(text);
    if (key !== null) {
      const value = key[3];
      if (value !== '' && !ENUM_LITERAL_VALUE.test(value) && !value.startsWith('m_')) {
        hit('key → text');
      }
    }
    if (LABEL_LITERAL.test(text)) {
      const near = lines.slice(Math.max(0, index - 4), index + 1);
      if (near.some((line) => KEY_LITERAL.test(line))) hit('label beside key');
    }
    const enumProp = ENUM_PROPERTY.exec(text);
    if (
      enumProp !== null &&
      !CSS_TOKENS.test(enumProp[3]) &&
      !ENUM_LITERAL_VALUE.test(enumProp[3])
    ) {
      hit('enum literal → text');
    }
    const classProp = CLASS_PROPERTY.exec(text);
    if (
      classProp !== null &&
      !classProp[3].startsWith('Imcodec.') &&
      !CLASS_NAMES.includes(classProp[3])
    ) {
      hit('class → text');
    }
  });
  return hits;
}

function readSources(dir: string): Source[] {
  const sources: Source[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      sources.push(...readSources(absolute));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      sources.push({
        file: path.relative(ROOT, absolute).split(path.sep).join('/'),
        text: fs.readFileSync(absolute, 'utf8'),
      });
    }
  }
  return sources;
}

/** The tree the scan covers, minus the glossary itself. */
function realTree(): Source[] {
  return SCAN_ROOTS.flatMap((dir) => readSources(path.join(ROOT, dir))).filter(
    (source) => source.file !== GLOSSARY_FILE,
  );
}

describe('the glossary is the one label home', () => {
  it('finds no second label table in client/src, shared or server/src', () => {
    const sources = realTree();
    expect(sources.length, 'the trees were actually read').toBeGreaterThan(100);
    expect(
      hitsIn(sources.find((s) => s.file === 'client/src/lib/quest-goals.ts') as Source),
    ).toEqual([]);
    expect(sources.flatMap(hitsIn)).toEqual([]);
  });

  it('sees each shape of second table in a scratch source (negative control)', () => {
    const scratch: Source = {
      file: 'client/src/lib/__scratch__/second-table.ts',
      text: [
        'export const LABELS = {',
        "  m_questLevel: 'Level',",
        '};',
        'export const SPEC = [',
        '  {',
        "    key: 'm_rank',",
        "    label: 'Rank',",
        '  },',
        '];',
        'export const OPERATORS = {',
        "  ROP_AND: 'AND',",
        '};',
        'export const CLASS_NAMES = {',
        "  ReqHasQuest: 'Requires quest',",
        '};',
      ].join('\n'),
    };
    expect(hitsIn(scratch).map((hit) => hit.shape)).toEqual([
      'key → text',
      'label beside key',
      'enum literal → text',
      'class → text',
    ]);
  });

  it('does not mistake defaults, enum values, key names or CSS classes for labels', () => {
    const benign: Source = {
      file: 'client/src/lib/__scratch__/benign.ts',
      text: [
        "const a = { m_goalTitle: '', m_operator: 'ROP_AND', m_activityType: 'ACTIVITY_NotActivity' };",
        "const b = kind === 'and' ? 'm_goalsAND' : 'm_goalsOR';",
        "const c = { ROP_AND: 'border-l-blue-500', ROP_OR: 'border-l-purple-500' };",
        "const d = { label: fieldLabel('m_rank'), key: 'm_rank' };",
        "const e = { ReqHasQuest: 'Imcodec.ObjectProperty.TypeCache.ReqHasQuest, Imcodec.ObjectProperty' };",
        "const f = entryShaped ? 'ReqHasEntry' : 'ReqHasQuest';",
      ].join('\n'),
    };
    expect(hitsIn(benign)).toEqual([]);
  });
});
