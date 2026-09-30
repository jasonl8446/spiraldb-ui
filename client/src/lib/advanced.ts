import { isEmptyValue, type DocPath } from '@shared/document';
import { fieldTier } from '@shared/glossary';

/**
 * Basic vs Advanced (task 7.11, D132). The tier is the glossary's (`fieldTier`); nothing here
 * holds a second table. A form splits its field list with {@link splitByTier}, and its Advanced
 * disclosure opens on {@link hasAdvancedValue} or a validation error.
 */

/** The fields of a form in their own order, split by the glossary tier of each `key`. */
export function splitByTier<T extends { key: string }>(
  items: readonly T[],
): { basic: T[]; advanced: T[] } {
  return {
    basic: items.filter((item) => fieldTier(item.key) === 'basic'),
    advanced: items.filter((item) => fieldTier(item.key) === 'advanced'),
  };
}

/**
 * `true` when any of {@link paths} holds a value that differs from the skeleton default (`null`,
 * absent, `''`, `0`, `false`, `[]`, an object of only such members: the draft builder's own rule,
 * `isEmptyValue`). A camera value of `0` therefore does not open Advanced.
 */
export function hasAdvancedValue(
  state: { value: (path: DocPath) => unknown },
  paths: readonly DocPath[],
): boolean {
  return paths.some((path) => !isEmptyValue(state.value(path)));
}

/**
 * The value to show as read-only text when an enum admits exactly one literal and the document
 * already holds it, else `null`. A document that is missing the value, or holds another one,
 * keeps its select so the value can still be set and nothing unlisted is snapped (D57).
 */
export function singleLegalValue(options: readonly string[], current: unknown): string | null {
  return options.length === 1 && current === options[0] ? (options[0] as string) : null;
}
