/**
 * SpiralDB **output-side** file naming — the `{type_prefix}_{key}.json` convention of
 * `docs/spec-data-model.md` L173-187, as a dependency-free spec table.
 *
 * This module describes the names *this tool writes* into the SpiralDB fork. It is
 * deliberately not the same problem as the manifest helpers in
 * `server/src/services/manifest.ts` (`normalizeManifestFilename`,
 * `manifestPathToDeserPath`, …): those resolve names that *already exist* in the fork,
 * including legacy ones that predate this convention (`droptables_…`,
 * `NPCInventories_…`, `WizardZoneDatas_…` — D19, `docs/plan-overview.md` L69), and
 * must stay on their own path. Nothing imports this module yet; it lives in `shared/`
 * because the server (Phase 2 save) and the client (Phase 4 editors) will read the
 * same table.
 *
 * The type id is the token file names are built from — for the nine keyed rows it is
 * the table's Prefix, so `fileNameFor('zonetransfer', …)` reads the way the file name
 * does. `prefix` is still its own field because the spec table has its own column and
 * the two are free to diverge later; `OBJECT_FILE_SPECS` is the single place to edit.
 *
 * ## The zone transform is lossy
 *
 * `zonetransfer` keys are `ZoneName`s, which contain `/`; the convention writes them
 * with `/` → `_` (L184). That replacement does not invert:
 *
 *     fileNameFor('zonetransfer', 'WizardCity/WC_Hub') === 'zonetransfer_WizardCity_WC_Hub.json'
 *     parseFileName('zonetransfer_WizardCity_WC_Hub.json').fileKey === 'WizardCity_WC_Hub'
 *
 * The parsed token is the **file key** — what the name actually contains — never a
 * guessed `ZoneName`. Rebuilding the *file name* round-trips
 * (`fileNameFor(parsed.type, parsed.fileKey) === fileName`); rebuilding the `ZoneName`
 * does not. A caller that needs the real `ZoneName` reads it from the file's
 * `ZoneName` field.
 */

/** Every object type this convention writes a file for (the nine rows + GlobalRegistry). */
export type ObjectFileType =
  | 'questtemplates'
  | 'droptable'
  | 'npcinventory'
  | 'npcspellinventory'
  | 'creaturespellbook'
  | 'npcdroptable'
  | 'treasurecardinventory'
  | 'zonetransfer'
  | 'questmetadata'
  | 'globalregistry';

/**
 * Where a type's key comes from, spelled as `docs/spec-data-model.md` L175-185 spells it
 * (the `questmetadata` source is the table's wording "quest name"; the metadata file
 * stores that same quest name in its `Name` field, L198). `dictionary key` is the
 * GlobalRegistry entry of the AGENTS.md type table and is informational only — the
 * registry file is unkeyed.
 */
export type KeySource =
  'm_questName' | 'Name' | 'TemplateID' | 'DeckName' | 'ZoneName' | 'quest name' | 'dictionary key';

/** One row of the naming table (`docs/spec-data-model.md` L175-187). */
export interface ObjectFileSpec {
  /** Type id used by every function here; equals `prefix` for the nine keyed rows. */
  readonly type: ObjectFileType;
  /** File-name token before the `_` (`docs/spec-data-model.md` L173). */
  readonly prefix: string;
  /** Field the key is read from (or the table's descriptive wording). */
  readonly keySource: KeySource;
  /** `false` only for GlobalRegistry, whose single file carries no key. */
  readonly keyed: boolean;
  /** `true` only for `zonetransfer`: `/` in the key is written as `_` (L184). */
  readonly slashToUnderscore: boolean;
}

/** The single file the convention writes without a key (L187). */
export const UNKEYED_FILE_NAME = 'globalregistry.json';

const GLOBAL_REGISTRY: ObjectFileSpec = {
  type: 'globalregistry',
  prefix: 'globalregistry',
  keySource: 'dictionary key',
  keyed: false,
  slashToUnderscore: false,
};

/** The naming table verbatim (`docs/spec-data-model.md` L175-187), one entry per row. */
export const OBJECT_FILE_SPECS: readonly ObjectFileSpec[] = [
  {
    type: 'questtemplates',
    prefix: 'questtemplates',
    keySource: 'm_questName',
    keyed: true,
    slashToUnderscore: false,
  },
  {
    type: 'droptable',
    prefix: 'droptable',
    keySource: 'Name',
    keyed: true,
    slashToUnderscore: false,
  },
  {
    type: 'npcinventory',
    prefix: 'npcinventory',
    keySource: 'TemplateID',
    keyed: true,
    slashToUnderscore: false,
  },
  {
    type: 'npcspellinventory',
    prefix: 'npcspellinventory',
    keySource: 'TemplateID',
    keyed: true,
    slashToUnderscore: false,
  },
  {
    type: 'creaturespellbook',
    prefix: 'creaturespellbook',
    keySource: 'DeckName',
    keyed: true,
    slashToUnderscore: false,
  },
  {
    type: 'npcdroptable',
    prefix: 'npcdroptable',
    keySource: 'TemplateID',
    keyed: true,
    slashToUnderscore: false,
  },
  {
    type: 'treasurecardinventory',
    prefix: 'treasurecardinventory',
    keySource: 'TemplateID',
    keyed: true,
    slashToUnderscore: false,
  },
  {
    type: 'zonetransfer',
    prefix: 'zonetransfer',
    keySource: 'ZoneName',
    keyed: true,
    slashToUnderscore: true,
  },
  {
    type: 'questmetadata',
    prefix: 'questmetadata',
    keySource: 'quest name',
    keyed: true,
    slashToUnderscore: false,
  },
  GLOBAL_REGISTRY,
];

/** Separator between prefix and key (L173). */
const SEPARATOR = '_';
/** The convention's only suffix (L173). */
const JSON_SUFFIX = '.json';

const SPEC_BY_TYPE = new Map<string, ObjectFileSpec>(
  OBJECT_FILE_SPECS.map((spec) => [spec.type, spec]),
);
const SPEC_BY_PREFIX = new Map<string, ObjectFileSpec>(
  OBJECT_FILE_SPECS.map((spec) => [spec.prefix, spec]),
);
const KNOWN_TYPES = OBJECT_FILE_SPECS.map((spec) => spec.type).join(', ');

/**
 * Raised by `fileNameFor` when a name cannot be built — an unknown type, or a key that
 * is blank, carries a path separator, carries a NUL, or already carries `.json`. The
 * message always names the offending type and key; the other functions here never throw.
 */
export class NamingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NamingError';
  }
}

/** True for the ten type ids `OBJECT_FILE_SPECS` describes. */
export function isObjectFileType(value: unknown): value is ObjectFileType {
  return typeof value === 'string' && SPEC_BY_TYPE.has(value);
}

/**
 * The file name for one object of `type` — `{prefix}_{key}.json`, with the zone
 * slash→underscore transform applied. The unkeyed type ignores `key` entirely and
 * always returns `globalregistry.json`.
 *
 * @throws {NamingError} unknown `type`, or a `key` that is blank, that still contains a
 * path separator (`/` or `\`) *after* the transform, that contains a NUL, or that
 * already ends with `.json`.
 */
export function fileNameFor(type: ObjectFileType, key: string): string {
  const spec = typeof type === 'string' ? SPEC_BY_TYPE.get(type) : undefined;
  if (spec === undefined) {
    throw new NamingError(
      `Unknown object file type ${JSON.stringify(type)}. Known types: ${KNOWN_TYPES}.`,
    );
  }

  if (!spec.keyed) {
    return UNKEYED_FILE_NAME;
  }

  if (typeof key !== 'string' || key.trim() === '') {
    throw new NamingError(
      `Cannot build a ${type} file name: the key is empty or blank ` +
        `(expected the ${spec.keySource} value).`,
    );
  }

  const fileKey = spec.slashToUnderscore ? key.split('/').join('_') : key;

  if (fileKey.includes('/') || fileKey.includes('\\')) {
    throw new NamingError(
      `Cannot build a ${type} file name from key ${JSON.stringify(key)}: it contains a path ` +
        `separator ("/" or "\\")${spec.slashToUnderscore ? ' after the slash→underscore transform' : ''}.`,
    );
  }
  if (fileKey.includes('\0')) {
    throw new NamingError(
      `Cannot build a ${type} file name from key ${JSON.stringify(key)}: it contains a NUL character.`,
    );
  }
  if (fileKey.endsWith(JSON_SUFFIX)) {
    throw new NamingError(
      `Cannot build a ${type} file name from key ${JSON.stringify(key)}: the key already ends ` +
        `with "${JSON_SUFFIX}" — pass the key, not a file name.`,
    );
  }

  return `${spec.prefix}${SEPARATOR}${fileKey}${JSON_SUFFIX}`;
}

/** The result of `parseFileName`: the type, plus the key as the name spells it. */
export interface ParsedFileName {
  readonly type: ObjectFileType;
  /** The token after the first `_`; `null` for the single unkeyed file. */
  readonly fileKey: string | null;
}

/**
 * The inverse of `fileNameFor` for the *file name*, never for a transformed key:
 * strips `.json`, matches the prefix, splits on the **first** `_` only (so keys that
 * contain `_` survive: `zonetransfer_WizardCity_WC_Hub.json` → `WizardCity_WC_Hub`),
 * and maps the prefix back to the type. Returns `null` — never throws — for anything
 * this convention could not have written: an unknown prefix, no separator, a missing
 * `.json`, an empty key, or a keyed name for the unkeyed file.
 */
export function parseFileName(fileName: string): ParsedFileName | null {
  if (typeof fileName !== 'string' || !fileName.endsWith(JSON_SUFFIX)) {
    return null;
  }

  const stem = fileName.slice(0, -JSON_SUFFIX.length);
  const separatorIndex = stem.indexOf(SEPARATOR);

  if (separatorIndex === -1) {
    // The unkeyed file has no separator; every other separator-less name is unrecognized.
    return stem === GLOBAL_REGISTRY.prefix ? { type: GLOBAL_REGISTRY.type, fileKey: null } : null;
  }

  const spec = SPEC_BY_PREFIX.get(stem.slice(0, separatorIndex));
  if (spec === undefined || !spec.keyed) {
    return null;
  }

  const fileKey = stem.slice(separatorIndex + 1);
  return fileKey === '' ? null : { type: spec.type, fileKey };
}
