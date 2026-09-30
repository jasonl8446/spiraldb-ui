import { ENUM_OF_FIELD } from '@shared/glossary';

import TermLabel from '../TermLabel';

/**
 * An enum with exactly one legal value, as read-only text (task 7.11, D132): its glossary pair
 * instead of a one-option select. `<output>` because it is a labelable element, so the field's own
 * `<label htmlFor>` still names it. `value` is the enum literal the document holds.
 */
export default function ReadOnlyEnumValue({
  id,
  fieldKey,
  value,
  describedBy,
}: {
  id: string;
  /** The document key, which names the enum through `ENUM_OF_FIELD`. */
  fieldKey: string;
  value: string;
  describedBy?: string;
}): JSX.Element {
  const enumName = ENUM_OF_FIELD[fieldKey];
  return (
    <output
      id={id}
      aria-live="off"
      aria-describedby={describedBy}
      data-readonly-enum={fieldKey}
      className="min-w-0 px-2 py-1 text-sm text-zinc-300"
    >
      {enumName === undefined ? value : <TermLabel term={{ enum: enumName, value }} />}
    </output>
  );
}
