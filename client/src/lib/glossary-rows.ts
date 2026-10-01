import {
  classes,
  enums,
  fields,
  groups,
  type GlossaryEntry,
  type GlossaryTier,
} from '@shared/glossary';

/**
 * The `/glossary` page's rows (task 7.12, D144): every term of the four glossary maps, flattened.
 * `technical` is the document key, class name, enum literal or group name; it is unique across
 * the four maps (the glossary test pins that), so it is also the row's identity and the `?term=` value.
 */
export type GlossaryKind = 'field' | 'class' | 'enum' | 'group';

export const GLOSSARY_KINDS: readonly GlossaryKind[] = ['field', 'class', 'enum', 'group'];

export interface GlossaryRow {
  kind: GlossaryKind;
  technical: string;
  label: string;
  help: string;
  tier: GlossaryTier;
  source: string;
}

function rowsOf(kind: GlossaryKind, map: Readonly<Record<string, GlossaryEntry>>): GlossaryRow[] {
  return Object.entries(map).map(([technical, entry]) => ({ kind, technical, ...entry }));
}

export function glossaryRows(): GlossaryRow[] {
  return [
    ...rowsOf('field', fields),
    ...rowsOf('class', classes),
    ...Object.values(enums).flatMap((table) => rowsOf('enum', table)),
    ...rowsOf('group', groups),
  ];
}

/** A row matches when the query is a case-insensitive substring of its label or technical name. */
export function matchesGlossaryQuery(row: GlossaryRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return (
    needle === '' ||
    row.label.toLowerCase().includes(needle) ||
    row.technical.toLowerCase().includes(needle)
  );
}
