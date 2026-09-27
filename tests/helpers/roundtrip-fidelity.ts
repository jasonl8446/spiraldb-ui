import { isDeepStrictEqual } from 'node:util';

import type { DocPath } from '@shared/document';

/**
 * The D5 fidelity walk — one home for "did a document survive untouched".
 *
 * Extracted verbatim from `tests/unit/quest-roundtrip.test.ts` (story p3-02) when story p4-09's
 * AC4 sweep needed the same walk over six more families: two copies of the comparison would be
 * two chances to compare differently, and the walk's whole value is that "the same" means one
 * thing everywhere.
 *
 * Behaviour is deliberately unchanged from p3-02, and the extraction is proven by that suite
 * still passing. Four functions:
 *
 * | function | question |
 * |---|---|
 * | {@link firstDiff} | are these two documents equal **including key order**? (or: where do they first differ, by path?) |
 * | {@link orderedKeyPaths} | every key path of a document, in document order |
 * | {@link collectNullPaths} | every path whose value is an explicit `null` |
 * | {@link describeValue} | a short description of a value, for a failure message |
 *
 * ## Why key order is its own comparison
 *
 * `isDeepStrictEqual` ignores property order, so a writer that sorted keys (or rebuilt a document
 * from a schema instead of merging into the original — D57b) would pass a value-only check while
 * rewriting every line of a file. {@link firstDiff} compares key **sets**, then their **order**,
 * then the values — so a failure can always name one concrete path. D58(e) records the
 * falsification that made this explicit.
 */

/** `true` for a JSON object (never an array, never `null`). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A short description of a value, for a failure message. */
export function describeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `an array of length ${value.length}`;
  }
  if (isPlainObject(value)) {
    return 'an object';
  }
  return `${typeof value} (${JSON.stringify(value)})`;
}

/**
 * The first difference between two documents, as a path and a reason — or `undefined` when they
 * are identical **including key order**.
 *
 * Deliberately not `isDeepStrictEqual` alone: property order is not part of deep equality, so a
 * serializer that reorders keys would pass a value-only comparison while rewriting every line of
 * a file. This walk compares key sets *and their order* at every level, then array lengths and
 * elements, and only then the scalars.
 */
export function firstDiff(left: unknown, right: unknown, at = '<root>'): string | undefined {
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    const missingRight = leftKeys.filter((key) => !rightKeys.includes(key));
    const missingLeft = rightKeys.filter((key) => !leftKeys.includes(key));
    if (missingRight.length > 0 || missingLeft.length > 0) {
      return `${at}: key sets differ (missing on the left: [${missingLeft.join(', ')}], missing on the right: [${missingRight.join(', ')}])`;
    }
    if (leftKeys.join('\u0000') !== rightKeys.join('\u0000')) {
      return `${at}: key order differs (left: [${leftKeys.join(', ')}] vs right: [${rightKeys.join(', ')}])`;
    }
    for (const key of leftKeys) {
      const nested = firstDiff(left[key], right[key], `${at}.${key}`);
      if (nested !== undefined) {
        return nested;
      }
    }
    return undefined;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return `${at}: array length differs (${left.length} vs ${right.length})`;
    }
    for (let index = 0; index < left.length; index += 1) {
      const nested = firstDiff(left[index], right[index], `${at}[${index}]`);
      if (nested !== undefined) {
        return nested;
      }
    }
    return undefined;
  }
  return isDeepStrictEqual(left, right)
    ? undefined
    : `${at}: ${describeValue(left)} !== ${describeValue(right)}`;
}

/** Every key path of a value, in document order (`<key>`, `<key>.m_goals[0]`, …). */
export function orderedKeyPaths(value: unknown, at = ''): string[] {
  const paths: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => paths.push(...orderedKeyPaths(item, `${at}[${index}]`)));
  } else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      const here = at === '' ? key : `${at}.${key}`;
      paths.push(here);
      paths.push(...orderedKeyPaths(item, here));
    }
  }
  return paths;
}

/** Every path in a document whose value is an explicit `null`. */
export function collectNullPaths(
  value: unknown,
  at: DocPath = [],
  paths: DocPath[] = [],
): DocPath[] {
  if (value === null) {
    if (at.length > 0) {
      paths.push(at);
    }
    return paths;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectNullPaths(item, [...at, index], paths));
  } else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      collectNullPaths(item, [...at, key], paths);
    }
  }
  return paths;
}
