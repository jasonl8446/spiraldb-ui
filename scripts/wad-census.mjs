#!/usr/bin/env node
/**
 * WAD object census — the measurement behind the quest-catalog plan.
 *
 * Answers one question with evidence rather than assumption: **which object types
 * actually live in the game's WAD files, and how many of each?** It then optionally
 * searches the payloads of every data entry for a set of class hashes, so a claim
 * like "the client ships no QuestTemplate" can be falsified or confirmed.
 *
 * Three measurements, in order of increasing strength:
 *
 * 1. **Exact census (no substring search).** An object-property payload declares its
 *    class as a hash in one of two header shapes, so reading that hash at its fixed
 *    offset gives a class count with no false-positive risk. Shape A is
 *    `42 49 4e 64` ("BINd") + flags(4) + hash(4); shape B is a bare hash at offset 0
 *    (every zone's `gamedata.bin`). Handling only shape A undercounts badly — it
 *    reports 21 `WizZoneData` where there are 3,356
 *    (docs/plan-phase-6-quest-catalog.md, and the evidence doc's "Measurement 1").
 * 2. **Payload hash scan.** Nested objects (a `ReqHasQuest` inside a zone's object
 *    list) do carry their class hash inline, so a container holding quests would
 *    expose them. This searches the whole decompressed payload of every data entry.
 * 3. **Negative control.** The identical scan with n hashes that are provably not
 *    client classes. Without it a hit cannot be distinguished from coincidence: a
 *    true occurrence and a false positive are both four matching bytes.
 *
 * Reading is index-first: the census seeks per entry and inflates at most a
 * 8 KB compressed prefix, so it never carries a 1.2 GB payload. The payload scan
 * (measurement 2) does inflate whole data entries, which is why it is opt-in.
 *
 * Usage:
 *   node scripts/wad-census.mjs --gamedata <GameData dir> \
 *     [--classes <ClientDump.json>] [--hashes 276946680,1110485234] \
 *     [--negative-control 20] [--json <out.json>]
 */

import { readSync } from 'node:fs';
import { open, readFile, writeFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

/**
 * Extensions whose payloads can hold an object-property class hash.
 *
 * `bcd` is deliberately absent. A `.bcd` payload is Binary Collision Data —
 * geometry, deserialized by a different reader — so its bytes cannot be an
 * object-property class hash. Including it makes the scan's control measure float
 * noise instead of the detector: the 100-hash control's only match (13 occurrences)
 * was entirely inside `collision.bcd` payloads.
 */
const DATA_EXTENSIONS = new Set([
  'xml',
  'bin',
  'gui',
  'ttip',
  'lua',
  'json',
  'dat',
  'txt',
  'npc',
  'skel',
]);

const KIWAD_MAGIC = 'KIWAD';

/** Compressed bytes read for a header-only census pass. */
const HEADER_PROBE_BYTES = 8192;

/** Decompressed bytes that must be available before a header can be read. */
const HEADER_BYTES = 12;

/** Cap on the per-class entry list written to the JSON report, to bound its size. */
const MAX_ENTRIES_PER_CLASS = 5000;

/**
 * Read a KIWAD entry index without touching any payload.
 *
 * Layout (Imcodec `ArchiveParser.cs`): `KIWAD`(5) + version(u32) + fileCount(u32),
 * then one padding byte when version >= 2, then per entry offset(u32), size(u32),
 * compressedSize(u32), isCompressed(u8), crc32(u32), nameLength(i32), name.
 * Offsets are absolute from the start of the file.
 */
export function parseIndex(buffer) {
  if (buffer.subarray(0, 5).toString('latin1') !== KIWAD_MAGIC) {
    throw new Error('not a KIWAD archive');
  }
  let pos = 5;
  const version = buffer.readUInt32LE(pos);
  pos += 4;
  const fileCount = buffer.readUInt32LE(pos);
  pos += 4;
  if (version >= 2) pos += 1;

  const entries = new Array(fileCount);
  for (let i = 0; i < fileCount; i += 1) {
    const offset = buffer.readUInt32LE(pos);
    const size = buffer.readUInt32LE(pos + 4);
    const compressedSize = buffer.readUInt32LE(pos + 8);
    const compressed = buffer.readUInt8(pos + 12) !== 0;
    const nameLength = buffer.readInt32LE(pos + 17);
    const name = buffer
      .subarray(pos + 21, pos + 21 + nameLength)
      .toString('utf8')
      .replace(/\0[\s\S]*$/, '');
    pos += 21 + nameLength;
    entries[i] = { name, offset, size, compressedSize, compressed };
  }
  return { version, entries };
}

async function readIndex(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(16 * 1024 * 1024);
    const bytesRead = readSync(handle.fd, buffer, 0, buffer.length, 0);
    return parseIndex(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/**
 * Inflate up to `wantBytes` of a zlib stream whose tail may be missing.
 *
 * `finishFlush: Z_SYNC_FLUSH` is what makes this work: it tells zlib to treat the end
 * of the supplied input as a flush point and return what it has, instead of failing
 * the way a one-shot `inflateSync` does on a truncated stream. A `createInflate()`
 * stream also tolerates truncation, but allocating one per entry dominated this pass
 * (a 550,616-entry census), so the synchronous form is the one that ships.
 */
function inflateBounded(input, wantBytes) {
  try {
    // No `maxOutputLength`: zlib raises Z_BUF_ERROR the moment output exceeds it,
    // which silently drops every entry bigger than the limit (measured: 87 shape-A
    // entries and 7 classes lost with a 12-byte cap). The output is already bounded
    // by the capped *input*, so the guard would only trade correctness for speed.
    const inflated = zlib.inflateSync(input, { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    return inflated.length >= wantBytes ? inflated : null;
  } catch {
    return null;
  }
}

/**
 * Read one entry's payload. `limitBytes` caps the *compressed* bytes read, which is
 * what makes a header-only pass cheap; the returned buffer is decompressed output.
 */
async function readPayload(handle, entry, limitBytes = Infinity) {
  const available = entry.compressed ? entry.compressedSize : entry.size;
  const length = Math.min(available, limitBytes);
  const raw = Buffer.alloc(length);
  // `readSync` on the open descriptor rather than an awaited `handle.read`: this pass
  // issues one small positional read per entry (550,616 of them), so the per-call
  // promise overhead is paid 550,616 times. Full census measured 25 s.
  const bytesRead = readSync(handle.fd, raw, 0, length, entry.offset);
  const slice = raw.subarray(0, bytesRead);
  if (!entry.compressed) return slice;
  // Whole-entry inflation when the read covered the entry, bounded otherwise.
  if (length >= entry.compressedSize) {
    try {
      return zlib.inflateSync(slice, { maxOutputLength: 512 * 1024 * 1024 });
    } catch {
      return null;
    }
  }
  return inflateBounded(slice, HEADER_BYTES);
}

function extensionOf(name) {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Shape A: "BINd" + flags(4) + class hash(4). */
function classHashShapeA(payload) {
  if (payload.length < HEADER_BYTES) return null;
  if (payload.subarray(0, 4).toString('latin1') !== 'BINd') return null;
  return payload.readUInt32LE(8);
}

/** Shape B: bare class hash at offset 0 (zone `gamedata.bin`, path manager lists). */
function classHashShapeB(payload, knownHashes) {
  if (payload.length < 8) return null;
  const hash = payload.readUInt32LE(0);
  return knownHashes.has(hash) ? hash : null;
}

async function processWad(filePath, options) {
  const { entries } = await readIndex(filePath);
  const shapeA = new Map();
  const shapeB = new Map();
  const hits = [];
  let dataEntries = 0;
  let dataBytes = 0;

  const handle = await open(filePath, 'r');
  try {
    for (const entry of entries) {
      const isData = DATA_EXTENSIONS.has(extensionOf(entry.name));
      // A data entry needs its whole payload only when a scan was requested;
      // otherwise the same bounded header probe serves both measurements.
      const payload = await readPayload(
        handle,
        entry,
        options.scan && isData ? Infinity : HEADER_PROBE_BYTES,
      );
      if (!payload) continue;

      if (options.scan && isData) {
        dataEntries += 1;
        dataBytes += payload.length;
        for (const { label, bytes } of options.patterns) {
          if (payload.includes(bytes)) hits.push({ class: label, entry: entry.name });
        }
      }

      const a = classHashShapeA(payload);
      if (a !== null) {
        shapeA.set(a, (shapeA.get(a) ?? 0) + 1);
        continue;
      }
      const b = classHashShapeB(payload, options.knownHashes);
      if (b !== null) shapeB.set(b, (shapeB.get(b) ?? 0) + 1);
    }
  } finally {
    await handle.close();
  }
  return { shapeA, shapeB, hits, dataEntries, dataBytes };
}

function mergeInto(target, source) {
  for (const [key, value] of source) target.set(key, (target.get(key) ?? 0) + value);
}

function hashBytes(hash) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(hash >>> 0, 0);
  return buffer;
}

/**
 * Deterministic picks from the u32 space that are provably not client classes, so
 * the control is reproducible across runs and machines.
 *
 * The four bytes must all be non-zero. A control hash with a zero byte encodes to a
 * short run of zeros, which occurs constantly in binary payloads, and the control
 * then measures the payload's byte distribution rather than the detector's
 * false-positive floor: an unconstrained draw of 20 measured 13 "hits" here, while
 * every real class hash measured draws bytes from the full 1..255 range.
 */
function pickControlHashes(count, excluded) {
  const picked = [];
  let state = 0x9e3779b9;
  while (picked.length < count) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const bytes = [
      state & 0xff,
      (state >>> 8) & 0xff,
      (state >>> 16) & 0xff,
      (state >>> 24) & 0xff,
    ];
    if (bytes.every((b) => b !== 0) && !excluded.has(state)) picked.push(state);
  }
  return picked;
}

export function parseArgs(argv) {
  const options = { hashes: [], negativeControl: 0, json: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => argv[i + 1];
    if (flag === '--gamedata') options.gamedata = value();
    else if (flag === '--classes') options.classes = value();
    else if (flag === '--hashes') options.hashes = value().split(',').filter(Boolean).map(Number);
    else if (flag === '--negative-control') options.negativeControl = Number(value());
    else if (flag === '--json') options.json = value();
    else if (flag === '--help' || flag === '-h') options.help = true;
    else throw new Error(`unknown argument: ${flag}`);
    if (flag !== '--help' && flag !== '-h') i += 1;
  }
  return options;
}

const USAGE = `Usage: node scripts/wad-census.mjs --gamedata <GameData dir> [options]

  --gamedata <dir>        Directory holding the *.wad archives (required).
  --classes <path>        Imcodec ClientDump.json: resolves hashes to class names and
                          enables shape-B header recognition.
  --hashes <a,b,c>        Decimal class hashes to search for in every data entry's
                          decompressed payload. Omit to run the census only.
  --negative-control <n>  Also search n hashes that are NOT client classes, proving
                          the scan's false-positive floor.
  --json <path>           Write the full result as JSON.

Exit code 0 on success, 1 on a usage or parse error.`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.gamedata) {
    process.stdout.write(`${USAGE}\n`);
    return options.help ? 0 : 1;
  }

  const nameByHash = new Map();
  if (options.classes) {
    const dump = JSON.parse(await readFile(options.classes, 'utf8'));
    for (const entry of Object.values(dump.classes)) {
      nameByHash.set(entry.hash, entry.name.replace(/^class /, ''));
    }
  }

  const control = pickControlHashes(
    options.negativeControl,
    new Set([...nameByHash.keys(), ...options.hashes]),
  );
  const patterns = [
    ...options.hashes.map((h) => ({ label: nameByHash.get(h) ?? String(h), bytes: hashBytes(h) })),
    ...control.map((h) => ({ label: `control:${h}`, bytes: hashBytes(h) })),
  ];

  const wads = [];
  for await (const p of glob(path.join(options.gamedata, '*.wad'))) wads.push(p);
  wads.sort();

  const shapeATotal = new Map();
  const shapeBTotal = new Map();
  const hitCounts = new Map();
  const controlCounts = new Map();
  const hitsByEntry = new Map();
  let dataEntries = 0;
  let dataBytes = 0;

  for (const wad of wads) {
    const scanned = await processWad(wad, {
      patterns,
      scan: patterns.length > 0,
      knownHashes: nameByHash,
    });
    mergeInto(shapeATotal, scanned.shapeA);
    mergeInto(shapeBTotal, scanned.shapeB);
    dataEntries += scanned.dataEntries;
    dataBytes += scanned.dataBytes;
    for (const hit of scanned.hits) {
      const bucket = hit.class.startsWith('control:') ? controlCounts : hitCounts;
      bucket.set(hit.class, (bucket.get(hit.class) ?? 0) + 1);
      // Per-entry provenance: without it a count cannot be turned back into the file
      // list a follow-up extraction needs, which is what makes the count reviewable.
      if (!hitsByEntry.has(hit.class)) hitsByEntry.set(hit.class, []);
      const list = hitsByEntry.get(hit.class);
      if (list.length < MAX_ENTRIES_PER_CLASS) {
        list.push({ wad: path.basename(wad), entry: hit.entry });
      }
    }
  }

  const lines = [];
  const say = (line) => lines.push(line);

  const aEntries = [...shapeATotal.values()].reduce((s, n) => s + n, 0);
  const bEntries = [...shapeBTotal.values()].reduce((s, n) => s + n, 0);
  say(`wads: ${wads.length}`);
  say(
    `object entries: shape A (BINd) ${aEntries} in ${shapeATotal.size} classes; ` +
      `shape B (bare) ${bEntries} in ${shapeBTotal.size} classes`,
  );
  say('');
  say(`${'class'.padEnd(36)} ${'count'.padStart(6)}  shape`);
  const rows = [];
  for (const [hash, count] of shapeATotal)
    rows.push({ name: nameByHash.get(hash) ?? `<unresolved ${hash}>`, count, shape: 'A' });
  for (const [hash, count] of shapeBTotal)
    rows.push({ name: nameByHash.get(hash) ?? `<unresolved ${hash}>`, count, shape: 'B' });
  rows.sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
  for (const row of rows)
    say(`${row.name.padEnd(36)} ${String(row.count).padStart(6)}  ${row.shape}`);

  if (options.hashes.length > 0) {
    say('');
    say(`payload scan: ${dataEntries} data entries, ${(dataBytes / 1e9).toFixed(3)} GB searched`);
    for (const [label, count] of [...hitCounts].sort((x, y) => y[1] - x[1])) {
      say(`  ${label}: ${count}`);
    }
  }
  if (control.length > 0) {
    const total = [...controlCounts.values()].reduce((s, n) => s + n, 0);
    say(`  negative control (${control.length} non-class hashes): ${total} hits`);
  }

  process.stdout.write(`${lines.join('\n')}\n`);

  if (options.json) {
    await writeFile(
      options.json,
      `${JSON.stringify(
        {
          wads: wads.length,
          dataEntries,
          dataBytes,
          shapeA: Object.fromEntries(
            [...shapeATotal].map(([h, c]) => [nameByHash.get(h) ?? String(h), c]),
          ),
          shapeB: Object.fromEntries(
            [...shapeBTotal].map(([h, c]) => [nameByHash.get(h) ?? String(h), c]),
          ),
          hits: Object.fromEntries(hitCounts),
          hitsByEntry: Object.fromEntries(hitsByEntry),
          negativeControl: Object.fromEntries(controlCounts),
        },
        null,
        2,
      )}\n`,
    );
  }
  return 0;
}

/**
 * Run only when this file **is** the process entry point.
 *
 * The guard is what makes the module importable: `wad-index.test.ts` imports `parseIndex` to
 * compare it field-for-field against the app's `readWadIndex` (the "agree byte for byte" claim in
 * `wadindex.ts`'s header), and without the guard that import would run the whole census against
 * whatever `--gamedata` a test runner happens to have, or exit 1 when it has none.
 */
const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    },
  );
}
