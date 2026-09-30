import type { DocPath } from '@shared/document';
import { ENUM_OF_FIELD, fieldLabel, resolveTerm, type TermRef } from '@shared/glossary';

import { namePairDistinct } from './display';

/**
 * The glossary pair as **text** (D131, task 7.9) — for the places a `<TermLabel />` cannot go.
 *
 * A native `<option>` holds text only, and an `aria-label` is a string, so both take the pair from
 * here. The rule is `<TermLabel />`'s own: the friendly half from `shared/glossary.ts`, the
 * technical half after it in parentheses, one value when the halves are identical (D135) and the
 * technical half alone when the glossary has no entry (never a guess).
 */
export function termText(term: TermRef): string {
  const { entry, technical } = resolveTerm(term);
  return namePairDistinct(entry?.label, technical);
}

/**
 * The term a field's **value** names, when it names one: a `$type` value is a class, and a value
 * of a field whose values are an enum (`m_goalType` → `GoalType`) is an enum literal. `null` for
 * any other field, whose value is data rather than a term.
 */
export function valueTermOf(fieldKey: string, value: string): TermRef | null {
  if (fieldKey === '$type') {
    return { type: value };
  }
  const enumName = Object.prototype.hasOwnProperty.call(ENUM_OF_FIELD, fieldKey)
    ? ENUM_OF_FIELD[fieldKey]
    : undefined;
  return enumName === undefined ? null : { enum: enumName, value };
}

/**
 * The option text of a value of `fieldKey`: the pair of the value's enum entry when the field's
 * values are an enum (`m_goalType` → `Persona (GOAL_TYPE_PERSONA)`), the value itself otherwise.
 */
export function fieldValueText(fieldKey: string, value: string): string {
  const term = valueTermOf(fieldKey, value);
  return term === null ? value : termText(term);
}

/**
 * A document path **in words**, for an accessible name (task 7.9): each key by its glossary
 * label and each index 1-based, so `['m_startResults', 'm_results', 0]` reads `Start results ›
 * Results 1`. The path itself (`m_startResults.m_results[0]`) stays out of every label and lives in
 * the element's `data-path` attribute.
 *
 * A key whose label repeats the previous key's is dropped, because a requirement tree nests its
 * wrapper (`m_requirements.m_requirements[1].m_requirements[0]` reads `Requirements 2 › 1`, and a
 * drop table's `Items[0].Requirements.m_requirements[0]` reads `Items 1 › Requirements 1`), and an
 * index that follows another index opens a new step.
 */
export function docPathWords(path: DocPath): string {
  const steps: string[] = [];
  let lastLabel: string | null = null;
  let lastWasIndex = false;
  for (const segment of path) {
    if (typeof segment === 'number') {
      const ordinal = String(segment + 1);
      if (steps.length === 0 || lastWasIndex) {
        steps.push(ordinal);
      } else {
        steps[steps.length - 1] = `${steps[steps.length - 1]} ${ordinal}`;
      }
      lastWasIndex = true;
      continue;
    }
    const label = fieldLabel(segment);
    if (label === lastLabel) {
      continue;
    }
    lastWasIndex = false;
    lastLabel = label;
    steps.push(label);
  }
  return steps.join(' › ');
}

/**
 * A field's address as text, for a `title` or an accessible name: the field's glossary pair, then
 * where it sits (`Goal text (m_goalText) in Goals 3`). A path that does not end in a key reads as
 * {@link docPathWords} alone.
 */
export function fieldAddressText(path: DocPath): string {
  const key = path[path.length - 1];
  if (typeof key !== 'string') {
    return docPathWords(path);
  }
  const where = docPathWords(path.slice(0, -1));
  const term = termText({ field: key });
  return where === '' ? term : `${term} in ${where}`;
}
