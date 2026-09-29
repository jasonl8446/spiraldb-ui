import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import { afterAll, describe, expect, it } from 'vitest';

import {
  ENTRY_HEADER_BYTES,
  FILE_HEADER_BYTES,
  KIWAD_MAGIC,
  V2_PADDING_BYTES,
  matchGlob,
  readWadIndex,
  readWadIndexTree,
  selectEntries,
} from '@server/services/sync/wadindex';
import {
  WAD_V1_EMPTY_FIXTURE,
  WAD_V1_FIXTURE,
  WAD_V2_FIXTURE,
  buildWadArchive,
  writeWadFixture,
} from '../helpers/wad-fixture';

/**
 * Task 6.1 acceptance (p6-02-ac3): the WAD index reader against committed **v1** and **v2**
 * fixtures with their entry fields asserted explicitly, plus the truncation and malformation
 * controls that must throw rather than return a short count.
 *
 * The fixtures are read from disk — `server/test/fixtures/wad_v1_archive.wad` (287 B, 4 entries),
 * `wad_v2_archive.wad` (161 B, 2 entries) and `wad_v1_empty_archive.wad` (13 B, the zero-entry
 * shape 8 real `Housing_*_WorldData.wad` archives have). Each is also rebuilt in-process and
 * **byte-compared**, so the committed file is proven to be exactly the layout the helper describes
 * and cannot drift silently.
 *
 * **v2 is fixture-only.** The real corpus measured 3,589 of 3,589 archives at version 1 and zero at
 * version 2, so nothing but these fixtures exercises the `version >= 2` branch; that is what the
 * plan's "both header versions" requirement rests on until a revision ships a v2 archive.
 *
 * The malformed variants are written under `data/__test-scratch__/` (gitignored) because they are
 * derived bytes, not fixtures worth committing — every one of them is a slice or a single-field
 * mutation of the committed v1 bytes.
 */

const FIXTURES = fileURLToPath(new URL('../../server/test/fixtures/', import.meta.url));
const V1_PATH = path.join(FIXTURES, 'wad_v1_archive.wad');
const V2_PATH = path.join(FIXTURES, 'wad_v2_archive.wad');
const EMPTY_PATH = path.join(FIXTURES, 'wad_v1_empty_archive.wad');

const SCRATCH_PARENT = path.join(process.cwd(), 'data', '__test-scratch__');
fs.mkdirSync(SCRATCH_PARENT, { recursive: true });
const SCRATCH = fs.mkdtempSync(path.join(SCRATCH_PARENT, 'wad-index-'));
const V1_BYTES = buildWadArchive(WAD_V1_FIXTURE);
const V2_BYTES = buildWadArchive(WAD_V2_FIXTURE);

/**
 * The census script's own index parser, imported so its "agree byte for byte" claim can be
 * **tested** rather than asserted in prose (S8).
 *
 * The annotation is the module's shape, written here because `scripts/wad-census.mjs` is plain
 * `.mjs` with no declaration file: it names exactly the fields the comparison below depends on
 * (including the census's own `compressed` spelling, which is *not* the app's `isCompressed`).
 * `tests/tsconfig.json` sets `allowJs` for this import; `wad-census.mjs` runs `main()` only when it
 * is the process entry point, which is what makes it importable at all.
 */
const { parseIndex } = (await import('../../scripts/wad-census.mjs')) as {
  parseIndex: (buffer: Buffer) => {
    version: number;
    entries: Array<{
      name: string;
      offset: number;
      size: number;
      compressedSize: number;
      compressed: boolean;
    }>;
  };
};

afterAll(() => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
});

/** Writes derived archive bytes into the scratch dir and returns the path. */
function scratchArchives(cases: Record<string, Buffer>): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(cases)) {
    const file = path.join(SCRATCH, `${name}.wad`);
    fs.writeFileSync(file, bytes);
    paths[name] = file;
  }
  return paths;
}

/** Byte offset of entry `i`'s `nameLength` field in the v1 fixture, computed from the built layout. */
function v1NameLengthOffset(i: number): number {
  return (
    FILE_HEADER_BYTES +
    V1_BYTES.entries
      .slice(0, i)
      .reduce((sum, entry) => sum + ENTRY_HEADER_BYTES + entry.nameLength, 0) +
    17
  );
}

/** Byte range of entry `i`'s raw name inside the v1 fixture, computed from the built layout. */
function v1NameRange(i: number): { start: number; end: number } {
  const start = v1NameLengthOffset(i) + 4;
  return { start, end: start + (V1_BYTES.entries[i]?.nameLength ?? 0) };
}

describe('committed v1 fixture', () => {
  it('is the bytes the helper builds (no silent drift)', () => {
    expect(fs.readFileSync(V1_PATH).equals(V1_BYTES.bytes)).toBe(true);
    expect(V1_BYTES.indexEnd).toBe(185);
  });

  it('reports version 1 and every entry field exactly', async () => {
    const index = await readWadIndex(V1_PATH);
    expect(index.path).toBe(V1_PATH);
    expect(index.version).toBe(1);
    expect(index.entries).toEqual([
      {
        name: 'gamedata.bin',
        offset: 185,
        size: 20,
        compressedSize: 31,
        isCompressed: true,
        crc32: 0x1a2b3c4d,
      },
      {
        name: 'triggers.xml',
        offset: 216,
        size: 11,
        compressedSize: 22,
        isCompressed: true,
        crc32: 0xdeadbeef,
      },
      {
        name: 'ObjectData/Quest/DS-ACAD1-C01.xml',
        offset: 238,
        size: 28,
        compressedSize: 28,
        isCompressed: false,
        crc32: 0x00000000,
      },
      {
        name: 'Textures/Zone/quest_tile.dds',
        offset: 266,
        size: 21,
        compressedSize: 21,
        isCompressed: false,
        crc32: 0x7fffffff,
      },
    ]);
    expect(index.entries.map((entry) => entry.offset)).toEqual(
      V1_BYTES.entries.map((entry) => entry.offset),
    );
    expect(index.indexEnd).toBe(V1_BYTES.indexEnd);
  });

  it('read the index only — bytesRead stops where the first payload starts', async () => {
    const index = await readWadIndex(V1_PATH);
    expect(index.fileSize).toBe(287);
    expect(index.bytesRead).toBe(index.indexEnd);
    expect(index.bytesRead).toBeLessThan(index.fileSize);
    // Every read is a header or a name: 13 + Σ(21 + nameLength), nothing else.
    const indexBytes =
      FILE_HEADER_BYTES +
      V1_BYTES.entries.reduce((sum, entry) => sum + ENTRY_HEADER_BYTES + entry.nameLength, 0);
    expect(index.bytesRead).toBe(indexBytes);
  });

  it('names differ only by the NUL the real format appends', async () => {
    const bytes = fs.readFileSync(V1_PATH);
    const index = await readWadIndex(V1_PATH);
    // The real format terminates the name inside `nameLength` (550,616/550,616 measured)…
    const terminated = v1NameRange(0);
    expect(bytes.subarray(terminated.start, terminated.end).toString('utf8')).toBe(
      'gamedata.bin\0',
    );
    // …and the reader trims at that NUL rather than carrying it, for both written forms.
    expect(index.entries[0].name).toBe('gamedata.bin');
    const bare = v1NameRange(3);
    expect(bytes.subarray(bare.start, bare.end).toString('utf8')).toBe(
      'Textures/Zone/quest_tile.dds',
    );
    expect(index.entries[3].name).toBe('Textures/Zone/quest_tile.dds');
    for (const [i, entry] of index.entries.entries()) {
      const range = v1NameRange(i);
      const raw = bytes.subarray(range.start, range.end).toString('utf8');
      expect(raw.replace(/\0[\s\S]*$/, '')).toBe(entry.name);
    }
  });

  it('compressed entries are real zlib streams at the offsets the index gives', async () => {
    const bytes = fs.readFileSync(V1_PATH);
    const index = await readWadIndex(V1_PATH);
    for (const entry of index.entries) {
      const stored = bytes.subarray(entry.offset, entry.offset + entry.compressedSize);
      expect(stored.length).toBe(entry.compressedSize);
      if (entry.isCompressed) {
        const inflated = zlib.inflateSync(stored);
        expect(inflated.length).toBe(entry.size);
      }
    }
    expect(zlib.inflateSync(bytes.subarray(index.entries[0].offset, 216)).toString('utf8')).toBe(
      'zone-data-payload-v1',
    );
  });
});

describe('committed v2 fixture (fixture-only — the corpus holds zero v2 archives)', () => {
  it('is the bytes the helper builds and starts its first entry after the padding byte', () => {
    const bytes = fs.readFileSync(V2_PATH);
    expect(bytes.equals(V2_BYTES.bytes)).toBe(true);
    expect(V2_BYTES.indexEnd).toBe(105);
    // The v2 branch is one byte: the entry index starts at 14, not 13.
    expect(bytes.subarray(0, KIWAD_MAGIC.length).toString('latin1')).toBe(KIWAD_MAGIC);
    expect(bytes.readUInt32LE(5)).toBe(2);
    expect(bytes.readUInt32LE(9)).toBe(2);
    expect(bytes.readUInt32LE(FILE_HEADER_BYTES + V2_PADDING_BYTES)).toBe(
      V2_BYTES.entries[0].offset,
    );
  });

  it('reports version 2 and every entry field exactly', async () => {
    const index = await readWadIndex(V2_PATH);
    expect(index.version).toBe(2);
    expect(index.entries).toEqual([
      {
        name: 'gamedata.bin',
        offset: 105,
        size: 20,
        compressedSize: 31,
        isCompressed: true,
        crc32: 0x0f0f0f0f,
      },
      {
        name: 'Maps/Aquila-AQ_Z00_Hub/triggers.xml',
        offset: 136,
        size: 25,
        compressedSize: 25,
        isCompressed: false,
        crc32: 0x12345678,
      },
    ]);
    expect(index.fileSize).toBe(161);
    expect(index.bytesRead).toBe(index.indexEnd);
    expect(index.bytesRead).toBe(
      FILE_HEADER_BYTES +
        V2_PADDING_BYTES +
        V2_BYTES.entries.reduce((sum, entry) => sum + ENTRY_HEADER_BYTES + entry.nameLength, 0),
    );
  });
});

/**
 * The cross-reader parity arm (final-deslop S8).
 *
 * `wadindex.ts`'s header claims it and `scripts/wad-census.mjs`'s `parseIndex` "agree byte for
 * byte" — a claim that was prose-only, with the census's parser exported and imported by nothing.
 * This is the arm that makes it a test: the **same bytes** through both readers, both header
 * versions, compared field by field. v2 is the version that matters, because its one padding byte
 * is exactly where a divergent field layout would show up, and the corpus holds zero v2 archives
 * for a real mismatch to be noticed in.
 *
 * The comparison is proven **sensitive** before its clean result is trusted (D90(c)): the two
 * versions' projections are asserted non-empty and unequal to each other, so a `toEqual` between
 * two empty or accidentally-identical lists cannot pass this arm.
 */
describe('the census reader agrees with the app reader (S8)', () => {
  it('yields the same version and entry fields for both header versions', async () => {
    const projections: Array<Array<Record<string, unknown>>> = [];
    for (const file of [V1_PATH, V2_PATH]) {
      const bytes = fs.readFileSync(file);
      const census = parseIndex(bytes);
      const app = await readWadIndex(file);
      // Field names differ on purpose (`isCompressed` on the app side, `compressed` in the census),
      // so the projection maps them onto one shape rather than assuming the spellings agree.
      const projected = census.entries.map((entry) => ({
        name: entry.name,
        offset: entry.offset,
        size: entry.size,
        compressedSize: entry.compressedSize,
        isCompressed: entry.compressed,
      }));
      expect(census.version).toBe(app.version);
      expect(projected).toEqual(
        app.entries.map((entry) => ({
          name: entry.name,
          offset: entry.offset,
          size: entry.size,
          compressedSize: entry.compressedSize,
          isCompressed: entry.isCompressed,
        })),
      );
      projections.push(projected);
    }
    // The negative control for the instrument: real, distinct, non-empty inputs.
    expect(projections[0]).toHaveLength(4);
    expect(projections[1]).toHaveLength(2);
    expect(projections[0]).not.toEqual(projections[1]);
  });
});

describe('zero-entry archives — the 8 real 13-byte archives', () => {
  it('accepts a v1 archive with fileCount 0', async () => {
    const bytes = fs.readFileSync(EMPTY_PATH);
    expect(bytes.equals(buildWadArchive(WAD_V1_EMPTY_FIXTURE).bytes)).toBe(true);
    expect(bytes.length).toBe(FILE_HEADER_BYTES);
    const index = await readWadIndex(EMPTY_PATH);
    expect(index.version).toBe(1);
    expect(index.entries).toEqual([]);
    expect(index.indexEnd).toBe(FILE_HEADER_BYTES);
    expect(index.bytesRead).toBe(FILE_HEADER_BYTES);
    expect(index.fileSize).toBe(FILE_HEADER_BYTES);
  });

  it('rejects a header cut below 13 bytes', async () => {
    const paths = scratchArchives({ 'empty-cut': fs.readFileSync(EMPTY_PATH).subarray(0, 10) });
    await expect(readWadIndex(paths['empty-cut'])).rejects.toThrow(
      /not a KIWAD archive: 10 bytes, need at least 13/,
    );
  });

  it('rejects a v2 header whose padding byte is missing', async () => {
    const bytes = Buffer.alloc(FILE_HEADER_BYTES);
    bytes.write(KIWAD_MAGIC, 0, 'latin1');
    bytes.writeUInt32LE(2, 5);
    bytes.writeUInt32LE(0, 9);
    const paths = scratchArchives({ 'v2-no-padding-byte': bytes });
    await expect(readWadIndex(paths['v2-no-padding-byte'])).rejects.toThrow(
      /truncated: v2 padding byte needs 1 bytes at offset 13/,
    );
  });
});

describe('truncated or malformed archives throw rather than under-report', () => {
  const paths = scratchArchives({
    // fileCount 4 cannot fit in the bytes that remain.
    'v1-index-cut-short': V1_BYTES.bytes.subarray(0, 30),
    // Cut inside the index: the last name is gone.
    'v1-index-cut-mid': V1_BYTES.bytes.subarray(0, V1_BYTES.indexEnd - 4),
    // Index complete, payloads gone — the case that would otherwise be a "full" index pointing past EOF.
    'v1-payloads-cut': V1_BYTES.bytes.subarray(0, V1_BYTES.indexEnd),
    // A name length that overruns the file.
    'v1-namelength-overruns': (() => {
      const bytes = Buffer.from(V1_BYTES.bytes);
      bytes.writeInt32LE(200, v1NameLengthOffset(3));
      return bytes;
    })(),
    // A zero name length.
    'v1-empty-name': (() => {
      const bytes = Buffer.from(V1_BYTES.bytes);
      bytes.writeInt32LE(0, v1NameLengthOffset(0));
      return bytes;
    })(),
    'v1-bad-magic': (() => {
      const bytes = Buffer.from(V1_BYTES.bytes);
      bytes[0] = 0x58;
      return bytes;
    })(),
    // The lead's control: no truncation at all, just a version byte that desyncs the parse. Without
    // the version guard this parses as a structurally valid 0-entry archive.
    'v1-unknown-version': (() => {
      const bytes = Buffer.from(V1_BYTES.bytes);
      bytes.writeUInt32LE(999999, 5);
      return bytes;
    })(),
    // A v2 archive that claims the version without writing the padding byte.
    'v2-padding-missing': buildWadArchive({ ...WAD_V2_FIXTURE, paddingBytes: 0 }).bytes,
  });

  it.each<[string, RegExp]>([
    ['v1-index-cut-short', /claims 4 entries but only 17 bytes remain/],
    ['v1-index-cut-mid', /overruns the archive/],
    ['v1-payloads-cut', /payload overruns the archive at entry 0 \("gamedata.bin"\)/],
    ['v1-namelength-overruns', /name overruns the archive at entry 3: nameLength=200/],
    ['v1-empty-name', /empty name at entry 0/],
    ['v1-bad-magic', /not a KIWAD archive: bad magic/],
    ['v1-unknown-version', /unknown archive version 999999 \(expected 1 or 2\)/],
    ['v2-padding-missing', /name overruns the archive at entry 0/],
  ])('%s rejects', async (name, message) => {
    await expect(readWadIndex(paths[name])).rejects.toThrow(message);
  });

  it('still parses the untouched fixture, so the controls fail for their own reason', async () => {
    const index = await readWadIndex(V1_PATH);
    expect(index.entries).toHaveLength(4);
  });
});

describe('readWadIndexTree', () => {
  const TREE = path.join(SCRATCH, 'tree');

  it('walks recursively, aggregates the counts, and collects one bad archive without losing the rest', async () => {
    writeWadFixture(path.join(TREE, 'wad_v1_archive.wad'), V1_BYTES.bytes);
    writeWadFixture(path.join(TREE, 'nested', 'wad_v2_archive.wad'), V2_BYTES.bytes);
    writeWadFixture(
      path.join(TREE, 'nested', 'empty.wad'),
      buildWadArchive(WAD_V1_EMPTY_FIXTURE).bytes,
    );
    writeWadFixture(path.join(TREE, 'broken.wad'), V1_BYTES.bytes.subarray(0, 30));
    fs.writeFileSync(path.join(TREE, 'not-an-archive.txt'), 'ignored: not a .wad');

    const tree = await readWadIndexTree(TREE);
    expect(tree.rootDir).toBe(TREE);
    expect(tree.wads.map((wad) => path.relative(TREE, wad.path))).toEqual([
      path.join('nested', 'empty.wad'),
      path.join('nested', 'wad_v2_archive.wad'),
      'wad_v1_archive.wad',
    ]);
    expect(tree.entryCount).toBe(0 + 2 + 4);
    expect([...tree.versionCounts]).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(tree.indexBytes).toBe(FILE_HEADER_BYTES + V2_BYTES.indexEnd + V1_BYTES.indexEnd);
    expect(tree.fileBytes).toBe(FILE_HEADER_BYTES + 161 + 287);
    expect(tree.errors).toHaveLength(1);
    expect(tree.errors[0].path).toBe(path.join(TREE, 'broken.wad'));
    expect(tree.errors[0].message).toMatch(/claims 4 entries/);
  });

  it('returns zero WADs for a directory with no archives', async () => {
    const emptyDir = path.join(SCRATCH, 'no-archives');
    fs.mkdirSync(emptyDir, { recursive: true });
    const tree = await readWadIndexTree(emptyDir);
    expect(tree.wads).toEqual([]);
    expect(tree.entryCount).toBe(0);
    expect(tree.errors).toEqual([]);
  });
});

describe('selectEntries', () => {
  it('selects the v1 and flat v2 entries in index order, attributed to their glob', async () => {
    const v1 = await readWadIndex(V1_PATH);
    const v2 = await readWadIndex(V2_PATH);
    const selected = selectEntries([v1, v2], ['gamedata.bin', 'triggers.xml']);
    expect(
      selected.map((chosen) => `${path.basename(chosen.wad)}|${chosen.glob}|${chosen.entry.name}`),
    ).toEqual([
      'wad_v1_archive.wad|gamedata.bin|gamedata.bin',
      'wad_v1_archive.wad|triggers.xml|triggers.xml',
      'wad_v2_archive.wad|gamedata.bin|gamedata.bin',
    ]);
  });

  it('selects each entry once, for the first glob that matches it', async () => {
    const v1 = await readWadIndex(V1_PATH);
    const selected = selectEntries([v1], ['*.bin', 'gamedata.bin', '**/*.xml']);
    expect(selected.map((chosen) => `${chosen.glob}|${chosen.entry.name}`)).toEqual([
      '*.bin|gamedata.bin',
      '**/*.xml|ObjectData/Quest/DS-ACAD1-C01.xml',
    ]);
  });

  it('reads no file: an index whose path does not exist still selects', () => {
    const synthetic = {
      path: '/nonexistent/tree/not-on-disk.wad',
      version: 1,
      entries: [
        {
          name: 'gamedata.bin',
          offset: 13,
          size: 4,
          compressedSize: 4,
          isCompressed: false,
          crc32: 0,
        },
      ],
      indexEnd: 47,
      bytesRead: 47,
      fileSize: 51,
    };
    const selected = selectEntries([synthetic], ['gamedata.bin']);
    expect(selected).toEqual([
      { wad: synthetic.path, glob: 'gamedata.bin', entry: synthetic.entries[0] },
    ]);
  });

  it('selects nothing when no glob matches, and nothing at all without globs', async () => {
    const v1 = await readWadIndex(V1_PATH);
    expect(selectEntries([v1], ['*.nif'])).toEqual([]);
    expect(selectEntries([v1], [])).toEqual([]);
  });
});

describe('matchGlob', () => {
  it.each<[string, string, boolean]>([
    ['gamedata.bin', 'gamedata.bin', true],
    ['gamedata.bin', 'Maps/gamedata.bin', false],
    ['*.bin', 'gamedata.bin', true],
    ['*.bin', 'ObjectData/gamedata.bin', false],
    ['?amedata.bin', 'gamedata.bin', true],
    ['**/*.xml', 'ObjectData/Quest/DS-ACAD1-C01.xml', true],
    ['**/*.xml', 'triggers.xml', false],
    ['triggers.xml', 'triggers.xml', true],
    ['triggers.xml', 'Triggers.xml', false],
    ['*.dds', 'Textures/Zone/quest_tile.dds', false],
    ['**', 'any/nested/name.txt', true],
  ])('%s vs %s -> %s', (glob, name, expected) => {
    expect(matchGlob(glob, name)).toBe(expected);
  });
});
