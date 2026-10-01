import { describe, expect, it } from 'vitest';

import {
  countSpeakerFallThroughs,
  SPEAKER_FALL_THROUGH_CLASSES,
  type EvidenceTables,
} from '@server/services/questEvidence';

/**
 * Task 7.14 / D124 — the speaker ladder's three fall-through classes are each counted, and the
 * sync prints them. Before this, only the third (a persona the manifest index cannot place) was
 * visible; a missing override key and an unfillable composition silently used the next rung.
 */

const DIALOG = 'Imcodec.ObjectProperty.TypeCache.NPCDialogEntry, Imcodec.ObjectProperty';

const TABLES: EvidenceTables = {
  strings: new Map([
    ['NPCFormats_First_Only', '#1:$NPC_FIRSTNAME$'],
    ['NPCOverride_Real', 'Overridden Name'],
    ['WC-NPCs_00000001', 'Ada'],
  ]),
  personae: new Map([
    // A persona with a first name: composition can fill.
    [
      'FILLED',
      {
        object_name: 'FILLED',
        template_id: 10,
        first_key: 'WC-NPCs_00000001',
        last_key: null,
        title_key: null,
      },
    ],
    // A persona with no components: composition cannot fill, the template name answers.
    [
      'BARE',
      { object_name: 'BARE', template_id: 11, first_key: null, last_key: null, title_key: null },
    ],
  ]),
  npcNames: new Map([[11, 'Bare Template Name']]),
  textTables: new Map(),
};

function entry(fields: Record<string, unknown>): Record<string, unknown> {
  return { $type: DIALOG, ...fields };
}

describe('countSpeakerFallThroughs (D124)', () => {
  it('names the three classes, in rung order', () => {
    expect([...SPEAKER_FALL_THROUGH_CLASSES]).toEqual([
      'override-key-missing',
      'composition-unfilled',
      'persona-not-indexed',
    ]);
  });

  it('counts each class, and a row that falls through two rungs counts in both', () => {
    const documents = [
      {
        m_dialogList: {
          m_dialogs: [
            // Falls through nowhere: the composition fills.
            entry({ m_personaName: 'FILLED_Persona', m_nameSTKey: 'NPCFormats_First_Only' }),
            // Override answers: falls through nowhere.
            entry({ m_personaName: 'FILLED_Persona', m_nameOverride: 'NPCOverride_Real' }),
            // Class 1: the override key names nothing; the composition then answers.
            entry({
              m_personaName: 'FILLED_Persona',
              m_nameOverride: 'NPCOverride_Missing',
              m_nameSTKey: 'NPCFormats_First_Only',
            }),
            // Class 2: the persona has no first name; the template name answers.
            entry({ m_personaName: 'BARE_Persona', m_nameSTKey: 'NPCFormats_First_Only' }),
            // Class 2 (no format at all) and class 3 (a persona the index does not hold).
            entry({ m_personaName: 'GONE_Persona', m_nameSTKey: 'NPCFormats_Unknown' }),
            // Class 3 alone: no override, no composition, an unknown persona.
            entry({ m_personaName: 'GONE_Persona' }),
            // No persona at all is a different fact and is not any class.
            entry({ m_personaName: '' }),
          ],
        },
      },
      // A document with no dialogue contributes nothing.
      { m_questName: 'NO-DIALOGUE' },
    ];

    expect(countSpeakerFallThroughs(documents, TABLES)).toEqual({
      lines: 7,
      classes: {
        'override-key-missing': 1,
        'composition-unfilled': 2,
        'persona-not-indexed': 2,
      },
    });
  });
});
