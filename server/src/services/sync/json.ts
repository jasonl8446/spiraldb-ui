import JSON5 from 'json5';

/**
 * Lenient JSON reader for SpiralDB + WAD documents (task 1.4d/1.4e support).
 *
 * [spec-data-model.md] L234-246 ("SpiralDB JSON Parsing") is explicit: most
 * existing SpiralDB files carry **trailing commas**, so `JSON.parse` rejects
 * them (measured: only 16 of 322 quest files are strict JSON) and every reader
 * of the corpus must go through `JSON5.parse`.
 *
 * `imcodec wad unpack --deser` output, by contrast, *is* strict JSON, and it is
 * 133,937 files of the 173,088-file tree — so parsing it with the full JSON5
 * grammar would be a needless slowdown on the hot path. This helper keeps both
 * worlds correct: strict `JSON.parse` first (fast, the common case), JSON5 only
 * as the recovery path.
 */
export function parseJsonLenient(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return JSON5.parse(text);
  }
}

/** `true` when `value` is a non-null, non-array object. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
