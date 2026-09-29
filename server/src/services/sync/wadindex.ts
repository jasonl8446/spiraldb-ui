import { readSync } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * WAD entry-index reader and entry selection — task 6.1
 * ([plan-phase-6-quest-catalog.md](../../../../docs/plan-phase-6-quest-catalog.md) L200–210).
 *
 * Reads a `*.wad` archive's **entry index without decompressing a payload**, for both header
 * versions, and selects entries by glob. Three exports, one parser: {@link readWadIndex} is the
 * single-archive primitive, {@link readWadIndexTree} is the thin walk over it that aggregates the
 * counts p6-02-ac1 names (3,589 WADs / 550,616 entries / 0 parse errors in one call), and
 * {@link selectEntries} is the pure selection over already-parsed indexes. This is the surface
 * tasks 6.2/6.3 consume: the zone-data extraction needs the `{ wad, entry }` pair with the entry's
 * byte range, and nothing here inflates, hashes, or parses an entry.
 *
 * ## Format (mirrored from the reference implementation)
 *
 * Imcodec `ArchiveParser.cs` (`Parse` / `ReadFileEntry`) and
 * [scripts/wad-census.mjs](../../../../scripts/wad-census.mjs) `parseIndex` agree byte for byte:
 *
 * ```
 * KIWAD(5) + version(u32le) + fileCount(u32le) + [padding(1) when version >= 2]
 * per entry: offset(u32le) size(u32le) compressedSize(u32le) isCompressed(u8) crc32(u32le)
 *            nameLength(i32le) name(nameLength bytes, UTF-8)
 * ```
 *
 * `offset` is **absolute from the start of the file**. `size` is the uncompressed size and
 * `compressedSize` the stored size; `isCompressed` picks which of the two bounds the entry's bytes.
 * `nameLength` is signed in the .NET reader (`ReadInt32`), so it is read the same way here. It
 * **includes the terminating NUL** in every real entry (measured: 550,616 of 550,616 names carry a
 * NUL byte within their declared length), so the name is trimmed at the first NUL — exactly what
 * `parseIndex` does and the equivalent of Imcodec's `Replace("\0", "")` for real names.
 *
 * ## Measured against the real corpus (2026-09-28, `V_r806919.Wizard_1_610`)
 *
 * | Measurement | Result |
 * |---|---|
 * | WADs / entries / parse errors | **3,589 / 550,616 / 0** |
 * | Versions present | **v1 × 3,589 — the corpus holds zero v2 archives** |
 * | Zero-entry archives | 8 (`Housing_*_WorldData.wad`, 13 bytes, `fileCount = 0`) |
 * | Index bytes read | 40,363,799 B (40.36 MB) of a 19,643,185,859 B tree; not one payload byte |
 * | `gamedata.bin` + `triggers.xml` | **6,733** (3,356 + 3,377), 48,765,076 B raw |
 *
 * ## Reading strategy — index-only by construction
 *
 * Every read is a `readSync` at an explicit position with an explicit length covering **only** the
 * file header, the per-entry header, and the name bytes; the last read ends exactly at
 * `indexEnd`, the byte where the first payload begins. `wad-census.mjs` reads a 16 MiB window from
 * offset 0 (which is why its own comment's "index-first" claim is loose for archives smaller than
 * that window); this reader has no window and no size cap — Root.wad's index alone is 12,054,272
 * bytes, so a cap would be a latent truncation. `readSync` on the open descriptor rather than an
 * awaited `handle.read` is the reference's measured choice for 550,616 entries and is kept.
 *
 * ## Guards — each one measured, not defensive style
 *
 * A truncated or desynced archive must **throw**, never return a short count (p6-02-ac3).
 *
 * - **Version must be 1 or 2.** All 3,589 real archives report v1, so v2 support is parity with
 *   Imcodec's `version >= 2` branch and is exercised by a committed fixture only. The guard exists
 *   because a *mutated* version byte is a silent-short-count route with no truncation at all: with
 *   an unknown version the padding byte desyncs every field and the index can parse as a
 *   structurally valid **0-entry** archive. Measured: version `999999` on `Ahmarra-WorldData.wad`
 *   yielded `fileCount = 0` before the guard, and `unknown archive version 999999` after it.
 * - **`fileCount` must fit** in the bytes that remain (21 per entry minimum), which rejects the
 *   garbage counts a desynced header produces.
 * - **`nameLength` must fit** inside the file (`name overruns`), which is what catches a truncation
 *   in the middle of the index — the index has no length field of its own, so this bound is the
 *   only thing that can.
 * - **An entry's data range must fit** inside the file (`payload overruns`). Guards index-only
 *   reads against an archive truncated *after* a complete index: without it, the index would parse
 *   in full and every entry would point past EOF — a short count in every sense but the number.
 * - **A name must not be empty** (mirrors Imcodec's `Failed to read file name.`), which catches a
 *   v2 padding byte misread as the start of an entry header.
 *
 * The `crc32` field is **opaque**: it is copied verbatim and never validated. On the 54 entries of
 * `Aquila-AQ_Z00_Hub.wad` it is *not* a standard CRC-32 of the stored bytes or of the inflated
 * payload (0 of 54 match either), and on the same archive it matches neither the name nor the size
 * — so no reader may treat it as a payload checksum.
 */

/** The five bytes every KIWAD archive starts with. */
export const KIWAD_MAGIC = 'KIWAD';

/** Magic(5) + version(4) + fileCount(4), before the first entry header. */
export const FILE_HEADER_BYTES = 13;

/** `offset(4) + size(4) + compressedSize(4) + isCompressed(1) + crc32(4) + nameLength(4)`. */
export const ENTRY_HEADER_BYTES = 21;

/** The 1 padding byte versions >= 2 carry between the file header and the first entry. */
export const V2_PADDING_BYTES = 1;

/** Versions this reader accepts; anything else throws (see the guard note above). */
export const SUPPORTED_WAD_VERSIONS: readonly number[] = [1, 2];

/** One entry of a WAD index. Field names follow Imcodec's `FileEntry`, not `parseIndex`'s shorthand. */
export interface WadEntry {
  /** Entry name as stored, UTF-8, trimmed at its terminating NUL (e.g. `gamedata.bin`). */
  name: string;
  /** Absolute byte offset of the entry's data from the start of the file. */
  offset: number;
  /** Uncompressed size in bytes. */
  size: number;
  /** Stored size in bytes; bounds the entry when `isCompressed`. */
  compressedSize: number;
  /** Whether the stored bytes are zlib-compressed. */
  isCompressed: boolean;
  /** Index checksum, copied verbatim — opaque, not a CRC-32 of the payload (see above). */
  crc32: number;
}

/** A parsed archive index: header, every entry, and how much of the file the parse touched. */
export interface WadIndex {
  /** Path the index was read from. */
  path: string;
  /** Archive header version (1 or 2). */
  version: number;
  /** Every entry, in index order. Zero is a valid length (8 real archives are 13 bytes). */
  entries: WadEntry[];
  /** Offset where the entry data region begins — the last index byte + 1. */
  indexEnd: number;
  /** Bytes actually read from the file. Equals `indexEnd`: no payload byte is ever read. */
  bytesRead: number;
  /** Size of the archive on disk, used to bound the index and each entry's data range. */
  fileSize: number;
}

/** One selected entry with its provenance — the `{ wad, entry }` pair tasks 6.2/6.3 consume. */
export interface SelectedEntry {
  /** Path of the WAD the entry came from. */
  wad: string;
  /** The glob (as given) that selected it — the first match wins. */
  glob: string;
  /** The entry itself, including the byte range a payload read would need. */
  entry: WadEntry;
}

/** A failed archive in a tree walk. Reported, never thrown: one bad file must not hide the other 3,588. */
export interface WadIndexError {
  /** Path of the archive that could not be indexed. */
  path: string;
  /** The parse failure's message. */
  message: string;
}

/** A whole-tree walk: every archive's index plus the aggregates p6-02-ac1 and the sync both report. */
export interface WadTreeIndex {
  /** The directory walked. */
  rootDir: string;
  /** Successfully parsed archives, sorted by path. */
  wads: WadIndex[];
  /** Archives that threw, sorted by path; `errors.length` is the parse-error count. */
  errors: WadIndexError[];
  /** Σ `entries.length` over `wads` — 550,616 against the real tree. */
  entryCount: number;
  /** Σ `indexEnd` over `wads`: every byte the walk read, against a 19 GB tree. */
  indexBytes: number;
  /** Σ `fileSize` over `wads`. */
  fileBytes: number;
  /** How many archives reported each header version (measured: `{ 1: 3589 }`). */
  versionCounts: Map<number, number>;
}

/**
 * Reads `filePath`'s entry index. Touches no payload byte (see the module note) and throws on a
 * truncated, desynced, or unsupported archive rather than reporting a partial entry list.
 */
export async function readWadIndex(filePath: string): Promise<WadIndex> {
  const handle = await open(filePath, 'r');
  try {
    const { size: fileSize } = await handle.stat();
    const fail = (message: string): never => {
      throw new Error(`${filePath}: ${message}`);
    };

    /** Exact positional reads only: a 0-byte read is a truncation, and the byte count is the evidence. */
    let bytesRead = 0;
    const readAt = (length: number, position: number, what: string): Buffer => {
      const buffer = Buffer.allocUnsafe(length);
      let filled = 0;
      while (filled < length) {
        const bytes = readSync(handle.fd, buffer, filled, length - filled, position + filled);
        if (bytes === 0) {
          fail(
            `truncated: ${what} needs ${length} bytes at offset ${position}, ` +
              `the file ends after ${filled}`,
          );
        }
        filled += bytes;
      }
      bytesRead += length;
      return buffer;
    };

    if (fileSize < FILE_HEADER_BYTES) {
      fail(`not a KIWAD archive: ${fileSize} bytes, need at least ${FILE_HEADER_BYTES}`);
    }
    const header = readAt(FILE_HEADER_BYTES, 0, 'file header');
    if (header.subarray(0, KIWAD_MAGIC.length).toString('latin1') !== KIWAD_MAGIC) {
      fail('not a KIWAD archive: bad magic');
    }
    const version = header.readUInt32LE(5);
    const fileCount = header.readUInt32LE(9);
    if (!SUPPORTED_WAD_VERSIONS.includes(version)) {
      fail(`unknown archive version ${version} (expected 1 or 2)`);
    }

    let pos = FILE_HEADER_BYTES;
    if (version >= 2) {
      readAt(V2_PADDING_BYTES, pos, 'v2 padding byte');
      pos += V2_PADDING_BYTES;
    }

    // A desynced header yields an absurd fileCount; 21 bytes is the smallest an entry can be.
    if (pos + fileCount * ENTRY_HEADER_BYTES > fileSize) {
      fail(
        `claims ${fileCount} entries but only ${fileSize - pos} bytes remain after the header ` +
          `(needs ${fileCount * ENTRY_HEADER_BYTES})`,
      );
    }

    const entries: WadEntry[] = [];
    for (let i = 0; i < fileCount; i += 1) {
      const entryHeader = readAt(ENTRY_HEADER_BYTES, pos, `entry ${i} header`);
      const offset = entryHeader.readUInt32LE(0);
      const size = entryHeader.readUInt32LE(4);
      const compressedSize = entryHeader.readUInt32LE(8);
      const isCompressed = entryHeader.readUInt8(12) !== 0;
      const crc32 = entryHeader.readUInt32LE(13);
      const nameLength = entryHeader.readInt32LE(17);

      // The index carries no length of its own, so the name bound is the truncation detector.
      if (nameLength < 0 || pos + ENTRY_HEADER_BYTES + nameLength > fileSize) {
        fail(
          `name overruns the archive at entry ${i}: nameLength=${nameLength}, ` +
            `offset=${pos + ENTRY_HEADER_BYTES}, fileSize=${fileSize}`,
        );
      }
      if (nameLength === 0) {
        fail(`empty name at entry ${i}`);
      }
      // Trailing NUL is the real format (550,616/550,616 measured); trim at the first one.
      const name = readAt(nameLength, pos + ENTRY_HEADER_BYTES, `entry ${i} name`)
        .toString('utf8')
        .replace(/\0[\s\S]*$/, '');
      if (name === '') {
        fail(`empty name at entry ${i}`);
      }
      const storedBytes = isCompressed ? compressedSize : size;
      if (offset + storedBytes > fileSize) {
        fail(
          `payload overruns the archive at entry ${i} ("${name}"): ` +
            `offset=${offset} + ${storedBytes} > fileSize=${fileSize}`,
        );
      }

      entries.push({ name, offset, size, compressedSize, isCompressed, crc32 });
      pos += ENTRY_HEADER_BYTES + nameLength;
    }

    return { path: filePath, version, entries, indexEnd: pos, bytesRead, fileSize };
  } finally {
    await handle.close();
  }
}

/**
 * Walks `rootDir` for `*.wad` (recursively, extension case-sensitive like the census's `*.wad`
 * glob) and indexes every one of them — the call that answers p6-02-ac1 directly: against the real
 * `GameData` path it returns **3,589 `wads`, 550,616 `entryCount`, 0 `errors`**.
 *
 * It is a thin loop over {@link readWadIndex} and holds no second parser. A failed archive is
 * collected into `errors` rather than thrown, because a walk that aborts on the first bad file
 * cannot report a parse-error *count* — and silently dropping it would under-report the tree.
 * Paths are walked in sorted order, so a run is reproducible.
 *
 * The whole index of every archive is retained, measured at 316 MB resident for the real
 * 550,616-entry tree (0.82–0.88 s per walk, 40,363,799 bytes read of 19.6 GB of files); the callers
 * that only need selections should fold it in place (task 6.2 hands the 6,733 selected entries to
 * `wad-scan`), not hold two copies.
 */
export async function readWadIndexTree(rootDir: string): Promise<WadTreeIndex> {
  const paths: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const dirents = await readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      const child = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        await walk(child);
      } else if (dirent.isFile() && dirent.name.endsWith('.wad')) {
        paths.push(child);
      }
    }
  };
  await walk(rootDir);
  paths.sort();

  const wads: WadIndex[] = [];
  const errors: WadIndexError[] = [];
  const versionCounts = new Map<number, number>();
  let entryCount = 0;
  let indexBytes = 0;
  let fileBytes = 0;
  for (const filePath of paths) {
    try {
      const index = await readWadIndex(filePath);
      wads.push(index);
      entryCount += index.entries.length;
      indexBytes += index.indexEnd;
      fileBytes += index.fileSize;
      versionCounts.set(index.version, (versionCounts.get(index.version) ?? 0) + 1);
    } catch (error) {
      errors.push({
        path: filePath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { rootDir, wads, errors, entryCount, indexBytes, fileBytes, versionCounts };
}

/**
 * Compiles one glob to an anchored pattern: `*` and `?` stop at `/`, `**` crosses it, and every
 * other character is literal. A pattern with no metacharacter therefore matches a name exactly —
 * `gamedata.bin` selects entry names written exactly that way (measured: the 3,356 `gamedata.bin`
 * entries are stored flat, with no directory prefix).
 */
function globToRegExp(glob: string): RegExp {
  let source = '^';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        source += '.*';
        i += 1;
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`${source}$`);
}

/** Whether `name` (a full stored entry name) matches `glob`. Matching is case-sensitive. */
export function matchGlob(glob: string, name: string): boolean {
  return globToRegExp(glob).test(name);
}

/**
 * Selects every entry whose name matches one of `globs`, **in one pass** over the indexes and with
 * no filesystem access at all: it takes already-parsed indexes, so it cannot read a payload even if
 * it wanted to. Each entry is selected once, attributed to the first glob that matches it, in index
 * order — measured 6,733 selections (3,356 `gamedata.bin` + 3,377 `triggers.xml`, 48,765,076 bytes
 * raw) across the real tree.
 */
export function selectEntries(
  wads: readonly WadIndex[],
  globs: readonly string[],
): SelectedEntry[] {
  const matchers = globs.map((glob) => ({ glob, pattern: globToRegExp(glob) }));
  const selected: SelectedEntry[] = [];
  for (const wad of wads) {
    for (const entry of wad.entries) {
      for (const matcher of matchers) {
        if (matcher.pattern.test(entry.name)) {
          selected.push({ wad: wad.path, glob: matcher.glob, entry });
          break;
        }
      }
    }
  }
  return selected;
}
