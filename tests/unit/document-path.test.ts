import { describe, expect, it } from 'vitest';

import {
  applyEdits,
  deleteAtPath,
  formatDocPath,
  parseDocPath,
  serializeDoc,
  type DocPath,
} from '@shared/document';

/**
 * `parseDocPath` — the inverse of `formatDocPath` (story p6-08).
 *
 * The pair exists because the evidence API hands a path as **text** (`text_rows[].field` is
 * `m_goals[0].m_goalText`) and the insert reducer must turn it back into the address an edit
 * writes. Two properties are load-bearing and neither is a formality:
 *
 * 1. **the round trip is exact for every path a real document produces** — so the test walks a
 *    real-shaped quest and asserts `parseDocPath(formatDocPath(p))` equals `p` for every scalar
 *    path in it, not for a hand-picked list;
 * 2. **anything the grammar does not cover returns `null`** — a path is an address, and a
 *    best-effort parse would write to the wrong place. The malformed cases below are the ones a
 *    plausible-but-wrong parser gets wrong (a leading index, a missing bracket, a leading zero,
 *    a bare key after an index, a trailing dot).
 */

/** A real-shaped corpus scalar set: the paths the walker hands out are exactly what is formatted. */
const DOCUMENT: Record<string, unknown> = {
  $type: 'Imcodec.ObjectProperty.TypeCache.QuestTemplate, Imcodec.ObjectProperty',
  m_questName: 'P6-PATH-001',
  m_goals: [
    {
      $type: 'Imcodec.ObjectProperty.TypeCache.PersonaGoalTemplate, Imcodec.ObjectProperty',
      m_goalName: 'Fix_Goal1',
      m_locationName: 'ZoneLocName_9140',
      m_dialogList: {
        m_dialogs: [
          {
            m_dialogTag: 'Prep',
            m_dialogEntries: [{ m_dialog: 'WizQst17318F_00000006', m_maxTimeSeconds: -1 }],
          },
        ],
      },
    },
    { m_goalName: 'Fix_Goal2', m_locationName: null },
  ],
  m_endResults: { m_results: [{ $type: 'ResDropTable', m_tableName: 'WC-UNICORN-MAIN-007' }] },
};

/** Every scalar path of a document, in walk order — `formatDocPath`'s own input domain. */
function scalarPaths(value: unknown, path: DocPath = []): DocPath[] {
  if (Array.isArray(value)) {
    return value.flatMap((element, index) => scalarPaths(element, [...path, index]));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, child]) => scalarPaths(child, [...path, key]));
  }
  return [path];
}

describe('parseDocPath — the exact inverse of formatDocPath', () => {
  it('round-trips every scalar path of a real-shaped quest document', () => {
    const paths = scalarPaths(DOCUMENT);
    // Not a token sample: the two corpus spellings (`$type` and a numeric index) and the two
    // `m_locationName` values (a key and an explicit null) are all in here.
    expect(paths.length).toBeGreaterThan(10);
    expect(paths).toContainEqual(['$type']);
    expect(paths).toContainEqual([
      'm_goals',
      0,
      'm_dialogList',
      'm_dialogs',
      0,
      'm_dialogEntries',
      0,
      'm_dialog',
    ]);
    for (const path of paths) {
      const formatted = formatDocPath(path);
      expect(parseDocPath(formatted), formatted).toEqual(path);
    }
  });

  it('round-trips the evidence API’s own measured spellings', () => {
    const measured: DocPath[] = [
      ['m_goalText'],
      ['m_goals', 0, 'm_goalText'],
      ['m_goals', 2, 'm_locationName'],
      ['m_dialog'],
      ['m_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 3, 'm_dialog'],
      ['m_goals', 0, 'm_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 0, 'm_dialog'],
      ['m_questTitle'],
      ['m_endResults', 'm_results', 10, 'm_templateID'],
    ];
    for (const path of measured) {
      expect(parseDocPath(formatDocPath(path))).toEqual(path);
    }
    // The two spellings the corpus contains that a naive `split('.')` gets wrong.
    expect(parseDocPath('m_goals[0].m_goalText')).toEqual(['m_goals', 0, 'm_goalText']);
    expect(parseDocPath('$type')).toEqual(['$type']);
  });

  it('returns null for every string the grammar does not produce', () => {
    for (const bad of [
      '',
      '.',
      '.m_goals',
      'm_goals.',
      'm_goals[',
      'm_goals[]',
      'm_goals[1',
      'm_goals[one]',
      'm_goals[-1]',
      'm_goals[01]',
      'm_goals[0]x',
      'm_goals[0][1]x',
      '[0]',
      'm_goals[0].m_goalText]',
    ]) {
      expect(parseDocPath(bad), bad).toBeNull();
    }
    // And the accepted shapes are still accepted, so `null` above is not a blanket refusal.
    expect(parseDocPath('m_goals[0][1]')).toEqual(['m_goals', 0, 1]);
    expect(parseDocPath('a[10].b')).toEqual(['a', 10, 'b']);
  });

  it('is the address the primitives write: a parsed path edits the node it names', () => {
    // The property that matters — a formatted path, parsed back, addresses the same node the
    // original path did. Asserted through the shipped primitive rather than by inspection.
    const target: DocPath = ['m_goals', 1, 'm_goalText'];
    const formatted = formatDocPath(target);
    const parsed = parseDocPath(formatted);
    expect(parsed).not.toBeNull();
    const edited = applyEdits(DOCUMENT, [
      { op: 'set', path: parsed as DocPath, value: 'WizQst_X' },
    ]);
    const removed = deleteAtPath(edited, target);
    expect(serializeDoc(removed)).toBe(serializeDoc(DOCUMENT));
  });
});
