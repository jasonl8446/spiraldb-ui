import fs from 'node:fs';
import path from 'node:path';

/**
 * WAD `*.wad` fixture construction for the index-reader tests (task 6.1).
 *
 * The reader's contract lives in [wadindex.ts](../../server/src/services/sync/wadindex.ts); this
 * module produces the bytes it is tested against, both the **committed** fixtures under
 * `server/test/fixtures/` and the malformed variants the negative controls need.
 *
 * Two properties are deliberate:
 *
 * 1. **Names are NUL-terminated inside `nameLength`**, because that is the real format — measured
 *    over the whole corpus, 550,616 of 550,616 names carry a NUL byte within their declared length.
 *    `nulTerminated: false` builds the other form so the test can prove both parse to one name.
 * 2. **Compressed payloads are stored-block zlib streams built here**, not `zlib.deflateSync`
 *    output. `deflateSync` is deterministic only for a fixed zlib build, so a fixture byte-compared
 *    against a fresh `deflateSync` would be a cross-version flake; these bytes depend on nothing.
 *    `zlib.inflateSync` reads them back, which the test asserts, so a compressed entry is genuine
 *    compressed data rather than a placeholder length.
 */

/** One entry to build: name, payload, and the index fields the reader must copy back verbatim. */
export interface WadFixtureEntry {
  name: string;
  /** Uncompressed payload bytes; stored as-is or zlib-compressed per `isCompressed`. */
  payload: Buffer;
  isCompressed: boolean;
  /**
   * Written verbatim into the index. **Arbitrary on purpose**: the real field is not a standard
   * CRC-32 of the payload (measured 0 of 54 matches on a real archive), so the fixture must not
   * imply a convention the corpus does not have.
   */
  crc32: number;
  /** Default true (the real format). False writes the raw name bytes with no trailing NUL. */
  nulTerminated?: boolean;
}

/** An archive to build: header version, optional padding, and its entries. */
export interface WadFixtureSpec {
  version: number;
  /** Padding bytes between the file header and the first entry (default: 1 for v2, 0 for v1). */
  paddingBytes?: number;
  entries: WadFixtureEntry[];
}

/** Where each entry landed, so the test can assert exact offsets and slice the index precisely. */
export interface BuiltEntry {
  entry: WadFixtureEntry;
  /** Absolute offset of the entry's data. */
  offset: number;
  /** Stored length as written (`compressedSize`). */
  storedLength: number;
  /** `nameLength` as written into the index (name bytes + NUL when terminated). */
  nameLength: number;
}

/** A built archive plus its layout — `indexEnd` is where the first payload byte begins. */
export interface BuiltWad {
  bytes: Buffer;
  version: number;
  indexEnd: number;
  entries: BuiltEntry[];
}

const ZLIB_HEADER = Buffer.from([0x78, 0x01]);

/** Adler-32 (RFC 1950) — the checksum a zlib stream ends with. */
function adler32(data: Buffer): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** A zlib stream made of stored (uncompressed) deflate blocks: deterministic under any zlib build. */
export function storedZlibStream(payload: Buffer): Buffer {
  const parts: Buffer[] = [ZLIB_HEADER];
  let offset = 0;
  do {
    const length = Math.min(payload.length - offset, 0xffff);
    const final = offset + length >= payload.length ? 1 : 0;
    const blockHeader = Buffer.allocUnsafe(5);
    blockHeader.writeUInt8(final, 0);
    blockHeader.writeUInt16LE(length, 1);
    blockHeader.writeUInt16LE(~length & 0xffff, 3);
    parts.push(blockHeader, payload.subarray(offset, offset + length));
    offset += length;
  } while (offset < payload.length);
  const checksum = Buffer.allocUnsafe(4);
  checksum.writeUInt32BE(adler32(payload), 0);
  parts.push(checksum);
  return Buffer.concat(parts);
}

/**
 * Builds archive bytes: `KIWAD` + version + fileCount + [padding] + entries, each entry stored at the
 * offset recorded in its header, so the result is a structurally valid archive for this reader.
 */
export function buildWadArchive(spec: WadFixtureSpec): BuiltWad {
  const paddingBytes = spec.paddingBytes ?? (spec.version >= 2 ? 1 : 0);
  const names = spec.entries.map((entry) => {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    return entry.nulTerminated === false ? nameBytes : Buffer.concat([nameBytes, Buffer.from([0])]);
  });
  const stored = spec.entries.map((entry) =>
    entry.isCompressed ? storedZlibStream(entry.payload) : entry.payload,
  );

  const headerBytes = 13 + paddingBytes;
  let indexEnd = headerBytes;
  for (const name of names) {
    indexEnd += 21 + name.length;
  }

  const parts: Buffer[] = [Buffer.alloc(headerBytes)];
  parts[0].write('KIWAD', 0, 'latin1');
  parts[0].writeUInt32LE(spec.version, 5);
  parts[0].writeUInt32LE(spec.entries.length, 9);

  // The index is contiguous — every header and name, then all payloads — which is what makes an
  // entry's `offset` (absolute, >= indexEnd) point into the data region rather than into the index.
  const dataParts: Buffer[] = [];
  const entries: BuiltEntry[] = [];
  let dataOffset = indexEnd;
  spec.entries.forEach((entry, i) => {
    const name = names[i];
    const payload = stored[i];
    const entryHeader = Buffer.alloc(21);
    entryHeader.writeUInt32LE(dataOffset, 0);
    entryHeader.writeUInt32LE(entry.payload.length, 4);
    entryHeader.writeUInt32LE(payload.length, 8);
    entryHeader.writeUInt8(entry.isCompressed ? 1 : 0, 12);
    entryHeader.writeUInt32LE(entry.crc32 >>> 0, 13);
    entryHeader.writeInt32LE(name.length, 17);
    parts.push(entryHeader, name);
    dataParts.push(payload);
    entries.push({
      entry,
      offset: dataOffset,
      storedLength: payload.length,
      nameLength: name.length,
    });
    dataOffset += payload.length;
  });
  parts.push(...dataParts);

  return { bytes: Buffer.concat(parts), version: spec.version, indexEnd, entries };
}

/** Writes built archive bytes to `filePath`, creating the parent directory. */
export function writeWadFixture(filePath: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
}

/**
 * The committed v1 fixture: four entries covering both storage forms, a nested path, the flat
 * `gamedata.bin` shape the selection depends on, a zero `crc32`, and one name without the trailing
 * NUL so both written forms are proven to parse to the same string.
 */
export const WAD_V1_FIXTURE: WadFixtureSpec = {
  version: 1,
  entries: [
    {
      name: 'gamedata.bin',
      payload: Buffer.from('zone-data-payload-v1', 'utf8'),
      isCompressed: true,
      crc32: 0x1a2b3c4d,
    },
    {
      name: 'triggers.xml',
      payload: Buffer.from('<triggers/>', 'utf8'),
      isCompressed: true,
      crc32: 0xdeadbeef,
    },
    {
      name: 'ObjectData/Quest/DS-ACAD1-C01.xml',
      payload: Buffer.from('<Quest name="DS-ACAD1-C01"/>', 'utf8'),
      isCompressed: false,
      crc32: 0x00000000,
    },
    {
      name: 'Textures/Zone/quest_tile.dds',
      payload: Buffer.from('DDS-placeholder-bytes', 'utf8'),
      isCompressed: false,
      crc32: 0x7fffffff,
      nulTerminated: false,
    },
  ],
};

/** The committed v2 fixture: one entry, the v2 padding byte, a different name set from v1. */
export const WAD_V2_FIXTURE: WadFixtureSpec = {
  version: 2,
  entries: [
    {
      name: 'gamedata.bin',
      payload: Buffer.from('zone-data-payload-v2', 'utf8'),
      isCompressed: true,
      crc32: 0x0f0f0f0f,
    },
    {
      name: 'Maps/Aquila-AQ_Z00_Hub/triggers.xml',
      payload: Buffer.from('<triggers zone="AQ_Z00"/>', 'utf8'),
      isCompressed: false,
      crc32: 0x12345678,
    },
  ],
};

/** The committed zero-entry fixture — the 13-byte shape 8 real archives have. */
export const WAD_V1_EMPTY_FIXTURE: WadFixtureSpec = { version: 1, entries: [] };
