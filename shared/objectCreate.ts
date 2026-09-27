import { NamingError, fileNameFor, type ObjectFileType } from './naming.js';
import { objectTypeConfig, type ObjectTypeConfig } from './objectTypes.js';
import { ULong } from './ulong.js';

/**
 * The **create** contract of the seven tracked object families — plan task 4.11 / story p4-09's
 * AC3, and the single home for "what does a brand-new entry of this family contain?".
 *
 * ## Why this module exists
 *
 * Every Phase-4 editor edits a document that came from disk; none of them ever *built* one. A
 * create is the only place the tool chooses a document's keys, their order and their initial
 * values, so:
 *
 * - **the document's shape is data here**, next to the schema it quotes, rather than assembled in
 *   JSX. One widget (`client/src/components/objects/NewObjectControl.tsx`) renders every family's
 *   create form from these rows — D71(i)'s "one widget, not seven" applied to creates;
 * - **the file name is `fileNameFor`'s**, never a second `{prefix}_{key}.json` builder. That is
 *   the AC's own failure mode ("a create name built by hand"), and it is also what makes the
 *   D26 singular-`droptable_` choice and the zone `/`→`_` transform apply here for free;
 * - **the key's JSON representation is `ULong`'s**: a `TemplateID` family stores a JSON *number*
 *   while its `entry_status.object_key` and its route key are text (docs/spec-data-model.md L36,
 *   `shared/ulong.ts`) — the same one conversion as everywhere else.
 *
 * ## The defaults are the spec's defaults, with two measured exclusions
 *
 * `docs/spec-domain-reference.md` L77-91 gives every DropTable field a default, and a create must
 * write *something* for the fields its validator reads (`RollChance`, `NoneChance`, `MinGold`/
 * `MaxGold`, `Name`). The seven families' other documents are one key plus one list, so their
 * create document is the key plus `[]`.
 *
 * Measured against the 317-file corpus (2026-09-27) two spec-default fields are deliberately
 * **not** written on a create, and both are the D57/D69 rule rather than a shortcut:
 *
 * - **`GrantsPotionSlot: false` is not written.** The measured key orders are 282 files without it
 *   and 35 with it (31 after the audit quartet, 3 before `Items`, 1 mid-document), so "absent"
 *   is the majority shape and a created file should not carry a key 282 corpus files do not.
 * - **The audit quartet is not written.** `docs/spec-data-model.md` L189-191 says where the fields
 *   live, not who fills them, and `shared/objectTypes.ts` records the task-4.1 decision that the
 *   generic writer stamps nothing — a create that invented `CreatedAt`/`CreatedBy` would be an
 *   invisible second writer (the same reasoning D70(c) applies to an update).
 *
 * ## What is deliberately absent
 *
 * - **GlobalRegistry**: unkeyed and lifecycle-free (Q1/D75). Its editor adds a *row* to one merged
 *   dictionary; there is no `globalregistry_{key}.json` and so no create form. Asking for one here
 *   throws, naming the route instead.
 * - **Quests**: the eighth tracked family's create path is Phase 2's extraction/POST flow
 *   (`POST /api/quests` and the extraction UI), not this widget — an extracted quest is a
 *   different act from naming a new empty content object, and the AC's own wording keeps them
 *   apart (D72(b)).
 */

/** The key control's kind: a free-text name, or the digits-only `TemplateID` of the four ulong families. */
export type ObjectCreateKeyKind = 'text' | 'ulong';

/** One literal value a create writes after the key. */
export interface ObjectCreateDefault {
  /** The JSON key, verbatim. */
  readonly key: string;
  /** The literal value written (`[]`, `0`, `''`, …). */
  readonly value: string | number | readonly unknown[];
  /** Why this value — the spec line or the measurement it comes from. */
  readonly note: string;
}

/** One family's create contract. */
export interface ObjectCreateSpec {
  readonly fileType: ObjectFileType;
  /** The JSON key field the create writes first. */
  readonly keyField: string;
  /** The key control's visible label (`Drop table name`, `NPC TemplateID`). */
  readonly keyLabel: string;
  readonly keyKind: ObjectCreateKeyKind;
  /** An example in the family's real vocabulary, as `placeholder`. */
  readonly keyPlaceholder: string;
  /** One sentence under the key control (how the key becomes a file name). */
  readonly keyHelp: string;
  /** The values written after the key, in document order. */
  readonly defaults: readonly ObjectCreateDefault[];
  /** One sentence under the defaults disclosure. */
  readonly defaultsNote: string;
}

/** Raised when a create cannot be built — an unusable key, or a family with no create form. */
export class ObjectCreateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObjectCreateError';
  }
}

/** The family ids this module has a create contract for, in `OBJECT_TYPES` order. */
const CREATE_FILE_TYPES: readonly ObjectFileType[] = [
  'droptable',
  'npcinventory',
  'npcspellinventory',
  'creaturespellbook',
  'npcdroptable',
  'treasurecardinventory',
  'zonetransfer',
];

const SPECS: readonly ObjectCreateSpec[] = [
  {
    fileType: 'droptable',
    keyField: 'Name',
    keyLabel: 'Drop table name',
    keyKind: 'text',
    keyPlaceholder: 'WC-UNICORN-MAIN-007',
    keyHelp:
      'Unique across every DropTable — the server rejects a name the corpus already uses. It ' +
      'becomes the file name (docs/spec-data-model.md L178).',
    defaults: [
      { key: 'Description', value: '', note: 'spec default (L80)' },
      { key: 'RollChance', value: 1, note: 'spec default 1.0 (L81)' },
      { key: 'Weight', value: 100, note: 'spec default 100 (L82)' },
      { key: 'NoneChance', value: 0, note: 'spec default 0.0 (L83)' },
      { key: 'PityCounter', value: 0, note: 'spec default 0.0 (L84)' },
      { key: 'MinGold', value: 0, note: 'spec default 0 (L85)' },
      { key: 'MaxGold', value: 0, note: 'spec default 0 (L85)' },
      { key: 'ExperienceAmount', value: 0, note: 'spec default 0 (L86)' },
      { key: 'TrainingPoints', value: 0, note: 'spec default 0 (L87)' },
      { key: 'Items', value: [], note: 'spec default [] (L89)' },
    ],
    defaultsNote:
      'The spec’s defaults for the eleven core keys, in corpus key order. `GrantsPotionSlot` ' +
      'is left absent (282 of 317 corpus files omit it) and the audit quartet is never stamped ' +
      '(shared/objectTypes.ts).',
  },
  {
    fileType: 'npcinventory',
    keyField: 'TemplateID',
    keyLabel: 'NPC TemplateID',
    keyKind: 'ulong',
    keyPlaceholder: '87112',
    keyHelp:
      'Stored as a JSON number and tracked as text in entry_status.object_key ' +
      '(docs/spec-data-model.md L36).',
    defaults: [
      {
        key: 'Inventory',
        value: [],
        note: 'empty list — an empty Inventory is real (1 corpus file has [])',
      },
    ],
    defaultsNote: 'One empty list; items are added on the entry’s own form.',
  },
  {
    fileType: 'npcspellinventory',
    keyField: 'TemplateID',
    keyLabel: 'NPC TemplateID',
    keyKind: 'ulong',
    keyPlaceholder: '1452231',
    keyHelp: 'Stored as a JSON number; the route and entry_status hold it as text.',
    defaults: [{ key: 'Spells', value: [], note: 'empty list of NPCSpellEntry objects' }],
    defaultsNote: 'One empty list; spells are added on the entry’s own form.',
  },
  {
    fileType: 'creaturespellbook',
    keyField: 'DeckName',
    keyLabel: 'Deck name',
    keyKind: 'text',
    keyPlaceholder: 'Mdeck-L-BR-DS-SylviaDrake-A-50',
    keyHelp: 'The deck name is the key and becomes the file name (L181).',
    defaults: [{ key: 'SpellTemplateIds', value: [], note: 'empty spell list' }],
    defaultsNote: 'One empty list; spells are added on the entry’s own form.',
  },
  {
    fileType: 'npcdroptable',
    keyField: 'TemplateID',
    keyLabel: 'NPC TemplateID',
    keyKind: 'ulong',
    keyPlaceholder: '12345',
    keyHelp:
      'The directory does not exist in the fork yet — the first save creates it ' +
      '(shared/simpleObjects/npcDropTable.ts).',
    defaults: [
      { key: 'DropTableNames', value: [], note: 'empty list of DropTable names (not ids)' },
    ],
    defaultsNote: 'One empty list; DropTable names are picked on the entry’s own form.',
  },
  {
    fileType: 'treasurecardinventory',
    keyField: 'TemplateID',
    keyLabel: 'NPC TemplateID',
    keyKind: 'ulong',
    keyPlaceholder: '38214',
    keyHelp: 'Stored as a JSON number; the route and entry_status hold it as text.',
    defaults: [
      { key: 'TreasureCards', value: [], note: 'empty list of {SpellName, Price} objects' },
    ],
    defaultsNote: 'One empty list; treasure cards are added on the entry’s own form.',
  },
  {
    fileType: 'zonetransfer',
    keyField: 'ZoneName',
    keyLabel: 'Zone name',
    keyKind: 'text',
    keyPlaceholder: 'WizardCity/WC_Hub',
    keyHelp:
      'A ZoneName may contain slashes; the file name writes them as underscores ' +
      '(docs/spec-data-model.md L184) while the document keeps the real name.',
    defaults: [{ key: 'Teleports', value: [], note: 'empty teleport list' }],
    defaultsNote: 'One empty list; teleports are added on the entry’s own form.',
  },
];

const BY_FILE_TYPE = new Map<string, ObjectCreateSpec>(SPECS.map((spec) => [spec.fileType, spec]));

/** The family ids that have a create form — the seven tracked object families. */
export const OBJECT_CREATE_SPECS: readonly ObjectCreateSpec[] = SPECS;

/**
 * One family's create contract.
 *
 * @throws {ObjectCreateError} for GlobalRegistry (unkeyed, editor-only — its route adds a row to
 * the merged dictionary) and for anything outside the eight families.
 */
export function objectCreateSpec(fileType: ObjectFileType): ObjectCreateSpec {
  const spec = BY_FILE_TYPE.get(fileType);
  if (spec !== undefined) {
    return spec;
  }
  if (fileType === 'globalregistry') {
    throw new ObjectCreateError(
      'GlobalRegistry has no create form: it is one merged dictionary, not a collection ' +
        '(docs/spec-api.md L474). Add a row on /global-registry instead.',
    );
  }
  throw new ObjectCreateError(
    `No create form for "${String(fileType)}". The families with one are ${CREATE_FILE_TYPES.join(
      ', ',
    )}; quests are created by the Phase-2 extraction flow (POST /api/quests).`,
  );
}

/** What a create form submits: the document, its canonical key text, and the file name it lands on. */
export interface NewObjectDocument {
  /** The canonical key text (`ULong.toKey` for a `TemplateID` family, the trimmed name otherwise). */
  readonly key: string;
  /** The document a create posts — the key field first, then {@link ObjectCreateSpec.defaults}. */
  readonly document: Record<string, unknown>;
  /** The convention file name, from `fileNameFor` — never hand-built. */
  readonly fileName: string;
}

/**
 * Builds the document, the canonical key and the file name for a create.
 *
 * The key control's raw text becomes: a JSON **number** for a `'ulong'` family
 * (`ULong.toJson`, the one conversion) and a trimmed string otherwise; the **canonical text**
 * (`ULong.toKey`) is what the route and `entry_status.object_key` use, so a caller can navigate to
 * the new entry or assert the status row without a second conversion.
 *
 * @throws {ObjectCreateError} a blank/undigits-only key, a key `fileNameFor` refuses (a path
 * separator, a NUL, a trailing `.json`), or a family with no create form. The message is the one
 * the form shows inline, so it always names the field and what was wrong with it.
 */
export function buildCreateDocument(config: ObjectTypeConfig, rawKey: string): NewObjectDocument {
  const spec = objectCreateSpec(config.fileType);

  let key: string;
  let jsonKey: string | number;
  if (spec.keyKind === 'ulong') {
    // Trimmed at this boundary only (D75g's rule for a typed key): `ULong` itself rightly rejects
    // `" 1 "`, and a space pasted into a NumericID box is not a different id.
    const trimmed = rawKey.trim();
    const canonical = ULong.toKey(trimmed);
    const asNumber = ULong.toJson(trimmed);
    if (canonical === undefined || asNumber === undefined) {
      throw new ObjectCreateError(
        `${spec.keyLabel} must be an unsigned integer (digits only, no sign or decimal point) — ` +
          `received ${JSON.stringify(rawKey)}.`,
      );
    }
    key = canonical;
    jsonKey = asNumber;
  } else {
    const trimmed = rawKey.trim();
    if (trimmed === '') {
      throw new ObjectCreateError(`${spec.keyLabel} is required.`);
    }
    key = trimmed;
    jsonKey = trimmed;
  }

  let fileName: string;
  try {
    // The one naming home: the D26 singular `droptable_` and the zone slash→underscore transform
    // are decisions this call inherits rather than restates.
    fileName = fileNameFor(config.fileType, key);
  } catch (error) {
    if (error instanceof NamingError) {
      throw new ObjectCreateError(`${spec.keyLabel}: ${error.message}`);
    }
    throw error;
  }

  const document: Record<string, unknown> = { [spec.keyField]: jsonKey };
  for (const field of spec.defaults) {
    document[field.key] = typeof field.value === 'object' ? [...field.value] : field.value;
  }

  return { key, document, fileName };
}

/** The object config for a create spec — a convenience so callers do not re-derive it. */
export function configForCreateSpec(spec: ObjectCreateSpec): ObjectTypeConfig {
  return objectTypeConfig(spec.fileType);
}
