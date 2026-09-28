import { describe, expect, it } from 'vitest';

import {
  buildManifestPersonaRows,
  mergePersonaStructs,
  objectNameFromManifestFile,
  personaObjectName,
  personaStructsInDocument,
  scanPersonaStructs,
  type PersonaIndexRow,
  type PersonaStruct,
} from '@server/services/sync/personaIndex';
import { parseTemplateManifest } from '@server/services/sync/manifest';

/**
 * The **persona index** builders (task 6.6, story p6-07).
 *
 * The evidence endpoint's speaker ladder needs two facts no other table holds — the
 * manifest's `object name → template id` and the persona struct's first/last
 * components — and this suite pins how they are derived from what the sync reads, on
 * **synthetic** inputs (no tree, no 17 MB manifest, no database).
 *
 * The negative controls matter as much as the positives:
 *
 * - a bare `m_personaName` (an `NPCDialogEntry` *reference* to a persona) must **not**
 *   become a struct — otherwise every dialog entry would invent components;
 * - a manifest entry whose id is not in `npcs` must **not** enter the index — that id
 *   could never answer rung 3, so keeping it would be a row that can never fire.
 */

function manifestFrom(entries: Array<{ file: string; id: number }>) {
  return parseTemplateManifest({
    _object: {
      m_serializedTemplates: entries.map((entry) => ({
        m_filename: entry.file,
        m_id: entry.id,
      })),
    },
  });
}

describe('the persona object name', () => {
  it('strips exactly one trailing `_Persona`, and nothing else', () => {
    expect(personaObjectName('WC-RAV-NPC02_Persona')).toBe('WC-RAV-NPC02');
    // Four of the eight measured manifest-missing personas are referenced in this spelling too.
    expect(personaObjectName('DS-LIB2-NPC05_Warrior5')).toBe('DS-LIB2-NPC05_Warrior5');
    // A name that merely contains the word is untouched (`_Persona` is a suffix, not a substring).
    expect(personaObjectName('WC_Persona_Shop')).toBe('WC_Persona_Shop');
    expect(personaObjectName('Persona')).toBe('Persona');
  });

  it('reads the object name off a manifest filename', () => {
    expect(objectNameFromManifestFile('ObjectData/WC/WC-RAV-NPC02.xml')).toBe('WC-RAV-NPC02');
    expect(objectNameFromManifestFile('ObjectData/WC/WC-RAV-NPC02-B.xml')).toBe('WC-RAV-NPC02-B');
    expect(objectNameFromManifestFile('Top.xml')).toBe('Top');
  });
});

describe('the manifest half of the index', () => {
  it('keeps the entries `npcs` can name and drops the rest, deterministically', () => {
    const manifest = manifestFrom([
      { file: 'ObjectData/WC/WC-RAV-NPC02.xml', id: 38206 },
      { file: 'ObjectData/WC/WC-HUB-NPC01.xml', id: 38168 },
      // Not an NPC template: rung 3 reads `npcs.name`, so this id can answer nothing.
      { file: 'Spells/Stun Block.xml', id: 999 },
      // The same basename in a second directory: the first filename in ascending sort order wins
      // (`AA/` sorts before `WC/`), which is the manifest's own first-wins rule.
      { file: 'ObjectData/AA/WC-HUB-NPC01.xml', id: 4242 },
    ]);
    const rows = buildManifestPersonaRows(manifest, new Set([38206, 38168, 4242]));
    expect(rows).toEqual([
      {
        object_name: 'WC-HUB-NPC01',
        template_id: 4242,
        first_key: null,
        last_key: null,
        title_key: null,
      },
      {
        object_name: 'WC-RAV-NPC02',
        template_id: 38206,
        first_key: null,
        last_key: null,
        title_key: null,
      },
    ]);
  });

  it('builds nothing from an empty manifest', () => {
    expect(buildManifestPersonaRows(manifestFrom([]), new Set([1]))).toEqual([]);
  });
});

describe('the persona-struct half of the index', () => {
  it('finds a struct that carries components, and ignores a reference that does not', () => {
    // Both shapes occur in the tree: the first is the Cinematics persona struct, the second is
    // what every `NPCDialogEntry` in the corpus and in the NDJSON holds.
    const document = {
      _object: {
        m_cameras: [
          {
            m_persona: {
              m_personaName: 'WC-RAV-NPC02_Persona',
              m_firstName: 'WC-NPCs_00000083',
              m_lastName: 'WC-NPCs_00000084',
              m_title: 'WC-NPCs_00000085',
              m_nickname: '',
            },
          },
        ],
        m_dialogEntries: [
          {
            $type: 'Imcodec.ObjectProperty.TypeCache.NPCDialogEntry, Imcodec.ObjectProperty',
            m_personaName: 'WC-RAV-NPC02_Persona',
            m_nameSTKey: 'NPCFormats_First_Last',
          },
        ],
      },
    };
    expect(personaStructsInDocument(document)).toEqual([
      {
        persona_name: 'WC-RAV-NPC02_Persona',
        first_key: 'WC-NPCs_00000083',
        last_key: 'WC-NPCs_00000084',
        title_key: 'WC-NPCs_00000085',
      },
    ]);
  });

  it('merges structs into the manifest rows and keeps an unplaceable persona visible', () => {
    const rows: PersonaIndexRow[] = [
      {
        object_name: 'WC-RAV-NPC02',
        template_id: 38206,
        first_key: null,
        last_key: null,
        title_key: null,
      },
    ];
    const structs: PersonaStruct[] = [
      {
        persona_name: 'WC-RAV-NPC02_Persona',
        first_key: 'WC-NPCs_00000083',
        last_key: 'WC-NPCs_00000084',
        title_key: null,
      },
      // A persona the manifest cannot place: it must appear with a `null` id (the raw-string
      // fallback arm), not disappear.
      {
        persona_name: 'KT-PYMHub-NPC02_Persona',
        first_key: null,
        last_key: null,
        title_key: null,
      },
    ];
    expect(mergePersonaStructs(rows, structs)).toEqual([
      {
        object_name: 'KT-PYMHub-NPC02',
        template_id: null,
        first_key: null,
        last_key: null,
        title_key: null,
      },
      {
        object_name: 'WC-RAV-NPC02',
        template_id: 38206,
        first_key: 'WC-NPCs_00000083',
        last_key: 'WC-NPCs_00000084',
        title_key: null,
      },
    ]);
  });

  it('does not erase a complete component set with a later partial struct', () => {
    const rows: PersonaIndexRow[] = [
      { object_name: 'A', template_id: 1, first_key: 'F', last_key: 'L', title_key: null },
    ];
    const merged = mergePersonaStructs(rows, [
      { persona_name: 'A_Persona', first_key: null, last_key: 'L2', title_key: null },
    ]);
    expect(merged[0]).toEqual({
      object_name: 'A',
      template_id: 1,
      first_key: 'F',
      last_key: 'L2',
      title_key: null,
    });
  });
});

describe('the tree scan', () => {
  it('reads only the configured roots, sorts its files, and skips an unreadable one', async () => {
    const files: Record<string, string> = {
      '/tree/Cinematics/b_deser.json': JSON.stringify({
        _object: { m_persona: { m_personaName: 'B_Persona', m_firstName: 'F' } },
      }),
      '/tree/Cinematics/a_deser.json': JSON.stringify({
        _object: { m_persona: { m_personaName: 'A_Persona', m_firstName: 'F' } },
      }),
      // Never read: outside the configured roots.
      '/tree/ObjectData/c_deser.json': JSON.stringify({
        _object: { m_persona: { m_personaName: 'C_Persona', m_firstName: 'F' } },
      }),
    };
    const structs = await scanPersonaStructs('/tree', {
      roots: ['Cinematics'],
      readdir: async (dir) =>
        dir === '/tree/Cinematics'
          ? [
              { name: 'a_deser.json', isDirectory: false },
              { name: 'b_deser.json', isDirectory: false },
              { name: 'sub', isDirectory: true },
            ]
          : [],
      readFile: async (file) => {
        const text = files[file];
        if (text === undefined) {
          throw new Error(`ENOENT ${file}`);
        }
        return text;
      },
    });
    expect(structs.map((struct) => struct.persona_name)).toEqual(['A_Persona', 'B_Persona']);
  });

  it('returns nothing for a tree that is not there', async () => {
    const structs = await scanPersonaStructs('/nope', {
      roots: ['Cinematics'],
      readdir: async () => {
        throw new Error('ENOENT');
      },
      readFile: async () => {
        throw new Error('ENOENT');
      },
    });
    expect(structs).toEqual([]);
  });
});
