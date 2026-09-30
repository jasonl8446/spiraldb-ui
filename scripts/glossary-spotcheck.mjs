#!/usr/bin/env node
/**
 * Prints every `shared/glossary.ts` entry beside the source line it cites, and exits 1 when a
 * cited line does not mention the term (task 7.8 / p7-09). It covers what the unit test cannot:
 * sources in the sibling trees (`Imlight/...`), which exist only beside this checkout.
 *
 * Usage: node scripts/glossary-spotcheck.mjs [--quiet] [--fix]
 *
 * `--fix` re-resolves a drifted citation (an edit above it shifted the cited file's lines, D173):
 * the entry's `source` is re-pointed to the line nearest the old one that names the term, and only
 * that entry's source line in `glossary.ts` is rewritten. A term the file no longer names at all
 * stays a MISS for a human to judge.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PARENT = path.dirname(ROOT);
const quiet = process.argv.includes('--quiet');
const fix = process.argv.includes('--fix');

const text = fs.readFileSync(path.join(ROOT, 'shared', 'glossary.ts'), 'utf8').split('\n');
const entries = [];
let section = '';
let enumName = '';
for (let i = 0; i < text.length; i += 1) {
  const head = /^export const (fields|classes|groups|enums)\b/.exec(text[i]);
  if (head) {
    section = head[1];
    continue;
  }
  if (section === 'enums') {
    const en = /^ {2}(\w+): \{$/.exec(text[i]);
    if (en) enumName = en[1];
  }
  const one = /^ {2,6}(?:'([^']+)'|(\$?\w+)): e\(['"](.*?)['"], '\w+', '(.+?):(\d+)', /.exec(
    text[i],
  );
  const start = one ?? /^ {2,6}(?:'([^']+)'|(\$?\w+)): e\($/.exec(text[i]);
  if (!start) continue;
  const key = start[1] ?? start[2];
  const label = one ? one[3] : /^\s+(['"])(.*)\1,$/.exec(text[i + 1])?.[2];
  const source = one ? [null, one[4], one[5]] : /^\s+'(.+):(\d+)',$/.exec(text[i + 3]);
  if (!source) {
    console.error(`unparsed entry at glossary.ts:${i + 1} (${key})`);
    process.exitCode = 1;
    continue;
  }
  entries.push({
    sourceIndex: one ? i : i + 3,
    address: section === 'enums' ? `enums.${enumName}.${key}` : `${section}.${key}`,
    key,
    label,
    file: source[1],
    line: Number(source[2]),
  });
}

const SLASH = {
  m_cameraOffsetX: 'm_cameraOffsetX/Y/Z',
  m_cameraOffsetY: 'm_cameraOffsetX/Y/Z',
  m_cameraOffsetZ: 'm_cameraOffsetX/Y/Z',
  m_locX: 'm_locX/Y/Z',
  m_locY: 'm_locX/Y/Z',
  m_locZ: 'm_locX/Y/Z',
  m_pitch: 'm_pitch/yaw/roll',
  m_yaw: 'm_pitch/yaw/roll',
  m_roll: 'm_pitch/yaw/roll',
};
let bad = 0;
let fixed = 0;
const cache = new Map();

function names(line, key) {
  return line !== undefined && (line.includes(key) || (SLASH[key] && line.includes(SLASH[key])));
}

/**
 * An edit shifts every later line of a file by the same amount, so the offset that re-names the
 * most of a file's drifted terms is the edit's, and it wins over "nearest mention" (which can pick a
 * neighbouring mention of the same key).
 */
const shifts = new Map();
function commonShift(abs, lines) {
  if (shifts.has(abs)) return shifts.get(abs);
  const votes = new Map();
  for (const entry of entries) {
    const file = path.join(
      /^(Imlight|Imview|Aurorium)\//.test(entry.file) ? PARENT : ROOT,
      entry.file,
    );
    if (file !== abs || names(lines[entry.line - 1], entry.key)) continue;
    for (let d = -400; d <= 400; d += 1) {
      if (d !== 0 && names(lines[entry.line - 1 + d], entry.key))
        votes.set(d, (votes.get(d) ?? 0) + 1);
    }
  }
  let shift = 0;
  for (const [d, n] of votes) if (n > (votes.get(shift) ?? 0)) shift = d;
  shifts.set(abs, shift);
  return shift;
}
for (const entry of entries) {
  const sibling = /^(Imlight|Imview|Aurorium)\//.test(entry.file);
  const abs = path.join(sibling ? PARENT : ROOT, entry.file);
  if (!cache.has(abs))
    cache.set(abs, fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8').split('\n') : null);
  const lines = cache.get(abs);
  const cited = lines?.[entry.line - 1];
  const ok =
    cited !== undefined &&
    (cited.includes(entry.key) || (SLASH[entry.key] && cited.includes(SLASH[entry.key])));
  if (!ok && fix && lines) {
    const shift = commonShift(abs, lines);
    let best = -1;
    if (shift !== 0 && names(lines[entry.line - 1 + shift], entry.key))
      best = entry.line - 1 + shift;
    for (let n = 0; best < 0 && n < lines.length; n += 1) {
      if (!names(lines[n], entry.key)) continue;
      const nearer = Math.abs(n + 1 - entry.line) < Math.abs(best + 1 - entry.line);
      if (best < 0 || nearer) best = n;
    }
    if (best >= 0) {
      const from = `${entry.file}:${entry.line}'`;
      const to = `${entry.file}:${best + 1}'`;
      text[entry.sourceIndex] = text[entry.sourceIndex].replace(from, to);
      console.log(`fixed ${entry.address}: ${entry.file}:${entry.line} -> ${best + 1}`);
      entry.line = best + 1;
      fixed += 1;
      continue;
    }
  }
  if (!ok) bad += 1;
  if (!quiet || !ok) {
    console.log(
      `${ok ? 'ok  ' : 'MISS'} ${entry.address}  [${entry.label}]  ${entry.file}:${entry.line}\n       ${(cited ?? '(no such line or file)').trim().slice(0, 150)}`,
    );
  }
}
console.log(
  `\n${entries.length} entries, ${entries.length - bad} cite a line that names the term, ${bad} do not.`,
);
if (fixed > 0) {
  fs.writeFileSync(path.join(ROOT, 'shared', 'glossary.ts'), text.join('\n'));
  console.log(`re-resolved ${fixed} drifted citation(s) in shared/glossary.ts`);
}
process.exit(bad === 0 ? 0 : 1);
