import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { codeOf } from '../helpers/source-text';

/**
 * **`client/src/lib/display.ts` imports nothing.** The server's `questEvidence.ts` imports it
 * (the only server-to-client source import in the repo, final-deslop V5), so `build:server`
 * compiles and emits whatever `display.ts` pulls in. Today that is nothing; the first React or
 * DOM import in it would break the server build silently, so this fails first. The scanner is
 * proven able to fail (D90(c)) by running it over a module that does import.
 */
const DISPLAY = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'client',
  'src',
  'lib',
  'display.ts',
);

/** Runtime imports (`import x from`, `import 'x'`, `import(`, `require(`) — never `import type`. */
function runtimeImports(src: string): string[] {
  return codeOf(src).match(/^\s*import\s+(?!type\b)[^\n]*|\bimport\(|\brequire\(/gm) ?? [];
}

describe('display.ts stays dependency-free (V5)', () => {
  it('has no runtime import', () => {
    expect(runtimeImports(fs.readFileSync(DISPLAY, 'utf8'))).toEqual([]);
  });

  it('negative control: the scanner sees a React import and a dynamic import', () => {
    expect(runtimeImports("import { useState } from 'react';\nexport const a = 1;\n")).toHaveLength(
      1,
    );
    expect(runtimeImports("export const load = () => import('./x');\n")).toHaveLength(1);
    expect(runtimeImports("import type { Db } from './db';\n")).toEqual([]);
  });
});
