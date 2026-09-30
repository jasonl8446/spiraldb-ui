#!/usr/bin/env node
/**
 * Prints every `shared/glossary.ts` entry beside the source line it cites, and exits 1 when a
 * cited line does not mention the term (task 7.8 / p7-09). It covers what the unit test cannot:
 * sources in the sibling trees (`Imlight/...`), which exist only beside this checkout.
 *
 * Usage: node scripts/glossary-spotcheck.mjs [--quiet]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PARENT = path.dirname(ROOT);
const quiet = process.argv.includes('--quiet');

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
const cache = new Map();
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
process.exit(bad === 0 ? 0 : 1);
