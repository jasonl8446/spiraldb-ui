import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import {
  QuestRefsCollector,
  computeHoldoutAccuracy,
  createQuestIdLookups,
  extractQuestRefs,
  formatInferenceBasis,
  parseQuestTitleKey,
  questGroupKey,
  questRequirementClass,
  requirementKeys,
  summarizeQuestRefs,
  type QuestIdLookups,
  type QuestIdPair,
  type QuestRefSourceRow,
} from '@server/services/sync/questRefs';

/**
 * Task 6.3 acceptance (p6-04-ac1/ac2/ac3): the extractor's direct link, its inferred link and both
 * of that link's rejection arms, the registry check that is counted but never emitted as a
 * reference, and the provenance on every emitted row.
 *
 * **No test here reads the 19 GB tree, the live `data/spiraldb-ui.db`, or spawns .NET.** The rows
 * come from the committed fixture — four **real** rows copied verbatim out of task 6.2's NDJSON
 * (`sha256 29af4d0f92e3848049533b451e66c4a822d3e6872d57a6c67e16e6a1b995bdf9`), the smallest rows
 * carrying each shape — and every lookup is injected. The one database in this file is
 * `:memory:`, built here.
 */

const FIXTURE = fileURLToPath(
  new URL('../../server/test/fixtures/quest_refs_sample.ndjson', import.meta.url),
);

/** The fixture rows, parsed — read once, never written. */
const FIXTURE_ROWS: QuestRefSourceRow[] = fs
  .readFileSync(FIXTURE, 'utf8')
  .split('\n')
  .filter((line) => line !== '')
  .map((line) => JSON.parse(line) as QuestRefSourceRow);

/** What the fixture holds, measured from the rows themselves. */
const NV_DIRECT_KEY = 'QuestTitle_179840';
const NV_NAME = 'NV-NEWV-MAIN-012';
const EM_NAME = 'EM-REV-MAIN-003';

/** An injected lookup over two plain maps — the shape every arm below is pinned with. */
function fakeLookups(input: {
  titleKeys?: Iterable<[number, string]>;
  textRows?: Iterable<[number, number]>;
}): QuestIdLookups {
  const titleKeys = new Map(input.titleKeys ?? []);
  const textRows = new Map(input.textRows ?? []);
  return {
    hasTitleKey: (key) => {
      const questId = parseQuestTitleKey(key);
      return questId !== null && titleKeys.get(questId) === key;
    },
    titleKeyFor: (questId) => titleKeys.get(questId) ?? null,
    countQuestTextRows: (questId) => textRows.get(questId) ?? 0,
  };
}

/** The anchors that bracket `EM-REV-MAIN-003` (group `EM-REV-MAIN`), so it has a gap to fill. */
const EM_ANCHORS: QuestIdPair[] = [
  { quest_name: 'EM-REV-MAIN-002', quest_id: 0x100 },
  { quest_name: 'EM-REV-MAIN-004', quest_id: 0x102 },
];

const EM_MIDPOINT = 0x101;
const EM_TITLE_KEY = 'QuestTitle_00000101';

describe('the extraction (p6-04-ac1)', () => {
  it('extracts the catalog from the committed real fixture with injected lookups', () => {
    const result = extractQuestRefs(
      FIXTURE_ROWS,
      fakeLookups({ titleKeys: [[0x179840, NV_DIRECT_KEY]] }),
    );

    expect(result.nodes_scanned).toBe(5);
    expect(result.records.map((record) => record.quest_name)).toEqual([EM_NAME, NV_NAME]);
    expect(result.direct_candidates).toBe(1);
    expect(result.direct_pairs).toBe(1);
    expect(result.link_only_names).toBe(0);
  });

  it('gives a paired m_entryName + existing QuestTitle_* key a direct link and nothing else', () => {
    const result = extractQuestRefs(
      FIXTURE_ROWS,
      fakeLookups({ titleKeys: [[0x179840, NV_DIRECT_KEY]] }),
    );

    const nv = result.records.find((record) => record.quest_name === NV_NAME);
    expect(nv?.link).toEqual({
      kind: 'direct',
      quest_id: 0x179840,
      title_key: NV_DIRECT_KEY,
      basis: null,
    });
    // A direct link carries no inference basis: it is measured, not inferred.
    expect(nv?.link.basis).toBeNull();
  });

  it('emits {wad, entry, class} provenance on every reference row, and keeps the nested class too', () => {
    const result = extractQuestRefs(
      FIXTURE_ROWS,
      fakeLookups({ titleKeys: [[0x179840, NV_DIRECT_KEY]] }),
    );

    const references = result.records.flatMap((record) => record.references);
    expect(references).toHaveLength(2);

    for (const reference of references) {
      expect(reference.wad).not.toBe('');
      expect(reference.entry).not.toBe('');
      expect(reference.class).not.toBe('');
      expect(['WizZoneData', 'WizZoneTriggers']).toContain(reference.class);
      // The nested requirement object carries no `$type` (measured 0 of 5,282), so its class and
      // its key set are the provenance of *what* in the file referenced the quest.
      expect(['ReqHasQuest', 'ReqHasEntry']).toContain(reference.requirement_class);
      expect(reference.requirement_keys.length).toBeGreaterThan(0);
    }

    const nvReference = result.records
      .find((record) => record.quest_name === NV_NAME)
      ?.references.at(0);
    expect(nvReference).toMatchObject({
      wad: 'Novus-Interiors-NV_Z04_SkyCave.wad',
      entry: 'gamedata.bin',
      class: 'WizZoneData',
      requirement_class: 'ReqHasQuest',
      goal_name: 'Goal 2',
      required_status: 'Complete',
    });
  });

  it('summarises to one row without provenance, and counts a goal gate per name', () => {
    const lookups = fakeLookups({ titleKeys: [[0x179840, NV_DIRECT_KEY]] });
    const report = summarizeQuestRefs(extractQuestRefs(FIXTURE_ROWS, lookups));

    expect(report.distinct_quest_names).toBe(2);
    expect(report.catalog_rows).toBe(2);
    expect(report.direct_links).toBe(1);
    expect(report.references).toBe(2);
    expect(report.rows_without_provenance).toBe(0);
    // Both names carry a m_goalName + m_requiredStatus gate in the fixture.
    expect(report.with_goal_names).toBe(2);
  });

  it('streams through the collector: add() then finish() equals the array-in call', () => {
    const lookups = fakeLookups({ titleKeys: [[0x179840, NV_DIRECT_KEY]] });
    const collector = new QuestRefsCollector();
    for (const row of FIXTURE_ROWS) {
      collector.add(row);
    }
    expect(collector.finish(lookups)).toEqual(extractQuestRefs(FIXTURE_ROWS, lookups));
  });
});

describe('a ReqHasEntry row is a registry check, not a reference (p6-04-ac3)', () => {
  it('counts both empty and key-absent m_questName shapes and emits neither as a reference', () => {
    const result = extractQuestRefs(
      FIXTURE_ROWS,
      fakeLookups({ titleKeys: [[0x179840, NV_DIRECT_KEY]] }),
    );

    // Three entry-shaped nodes carry no quest name: the Novus direct-pair row (`m_questName: ""`,
    // which is also where the direct link is read from — ac3 counts it, ac1's link is not a
    // reference), plus GrizzleheimLite's `m_questName: ""` and key-absent shapes.
    expect(result.registry_checks).toEqual({
      total: 3,
      empty_quest_name: 2,
      absent_quest_name: 1,
      with_entry_name: 3,
    });

    const referenced = new Set(result.records.map((record) => record.quest_name));
    expect(referenced.has('Mysterious_Composer')).toBe(false);
    expect(result.records.some((record) => record.quest_name === '')).toBe(false);

    const report = summarizeQuestRefs(result);
    expect(report.registry_checks.total).toBe(3);
  });
});

describe('the inferred id link (p6-04-ac2)', () => {
  const accepted = fakeLookups({
    titleKeys: [
      [0x179840, NV_DIRECT_KEY],
      [EM_MIDPOINT, EM_TITLE_KEY],
    ],
    textRows: [[EM_MIDPOINT, 7]],
  });

  it('accepts the neighbour midpoint when the candidate has a key AND a non-empty table', () => {
    const result = extractQuestRefs(FIXTURE_ROWS, accepted, { anchors: EM_ANCHORS });
    const em = result.records.find((record) => record.quest_name === EM_NAME);

    expect(result.inference_gaps).toBe(1);
    expect(result.inference_rejected).toBe(0);
    expect(em?.link.kind).toBe('inferred');
    expect(em?.link.quest_id).toBe(EM_MIDPOINT);
    expect(em?.link.title_key).toBe(EM_TITLE_KEY);
  });

  it('records the basis: both anchors, the candidate, and the two conditions it passed', () => {
    const result = extractQuestRefs(FIXTURE_ROWS, accepted, { anchors: EM_ANCHORS });
    const em = result.records.find((record) => record.quest_name === EM_NAME);
    const basis = JSON.parse(em?.link.basis ?? '{}') as Record<string, unknown>;

    expect(basis).toEqual({
      method: 'neighbour-midpoint',
      group: 'EM-REV-MAIN',
      before: { quest_name: 'EM-REV-MAIN-002', quest_id: 0x100 },
      after: { quest_name: 'EM-REV-MAIN-004', quest_id: 0x102 },
      candidate_id: EM_MIDPOINT,
      conditions: { title_key: EM_TITLE_KEY, text_rows: 7 },
    });
    // Deterministic: the same input formats to the same string.
    expect(
      formatInferenceBasis({
        group: 'EM-REV-MAIN',
        before: { quest_name: 'EM-REV-MAIN-002', quest_id: 0x100 },
        after: { quest_name: 'EM-REV-MAIN-004', quest_id: 0x102 },
        candidate: EM_MIDPOINT,
        titleKey: EM_TITLE_KEY,
        textRows: 7,
      }),
    ).toBe(em?.link.basis);
  });

  it('rejects the candidate with no QuestTitle_* key — arm 1 of the two conditions', () => {
    const noKey = fakeLookups({
      titleKeys: [[0x179840, NV_DIRECT_KEY]],
      textRows: [[EM_MIDPOINT, 7]],
    });
    const result = extractQuestRefs(FIXTURE_ROWS, noKey, { anchors: EM_ANCHORS });
    const em = result.records.find((record) => record.quest_name === EM_NAME);

    expect(result.inference_gaps).toBe(1);
    expect(result.inference_rejected).toBe(1);
    expect(em?.link).toEqual({ kind: 'none', quest_id: null, title_key: null, basis: null });
    expect(em?.references).toHaveLength(1);
  });

  it('rejects the candidate whose WizQst table is empty — arm 2 of the two conditions', () => {
    const noText = fakeLookups({
      titleKeys: [
        [0x179840, NV_DIRECT_KEY],
        [EM_MIDPOINT, EM_TITLE_KEY],
      ],
    });
    const result = extractQuestRefs(FIXTURE_ROWS, noText, { anchors: EM_ANCHORS });
    const em = result.records.find((record) => record.quest_name === EM_NAME);

    expect(result.inference_gaps).toBe(1);
    expect(result.inference_rejected).toBe(1);
    expect(em?.link.kind).toBe('none');
    expect(em?.link.basis).toBeNull();
  });

  it('never extrapolates a name with a neighbour on only one side', () => {
    const result = extractQuestRefs(FIXTURE_ROWS, accepted, {
      anchors: [{ quest_name: 'EM-REV-MAIN-002', quest_id: 0x100 }],
    });
    const em = result.records.find((record) => record.quest_name === EM_NAME);

    expect(result.inference_gaps).toBe(0);
    expect(em?.link.kind).toBe('none');
  });

  it('does not take a literal m_displayName as a direct link, and counts no pair for it', () => {
    // The fixture has no literal-title row; this synthetic one carries the measured shape
    // ("To Tame a Tempest" ×20 in the real tree). The literal is not a QuestTitle_* key.
    const literal: QuestRefSourceRow = {
      wad: 'Karamelle-Interiors-KM_Z08_CinnamonTrollCave.wad',
      entry: 'gamedata.bin',
      class: 'WizZoneData',
      object: {
        m_objectList: [
          {
            m_requirements: {
              m_requirements: [
                {
                  m_entryName: 'WC-TRITON-MAIN-008_Complete',
                  m_displayName: 'To Tame a Tempest',
                  m_isQuestRegistry: false,
                  m_questName: '',
                },
              ],
            },
          },
        ],
      },
    };

    const result = extractQuestRefs(
      [literal],
      fakeLookups({ titleKeys: [[0x1627b9, 'QuestTitle_1627B9']] }),
    );

    expect(result.direct_candidates).toBe(1);
    expect(result.direct_pairs).toBe(0);
    expect(result.records).toEqual([]);
    expect(result.registry_checks.total).toBe(1);
  });
});

describe('the pure helpers', () => {
  it('groups a quest name by the prefix before its last -<digits> suffix', () => {
    expect(questGroupKey('AQ-GARD-C01-002')).toBe('AQ-GARD-C01');
    expect(questGroupKey('DS-ACAD2-C01-012')).toBe('DS-ACAD2-C01');
    // A name whose last segment is not a number has no numeric sibling group and stays alone —
    // the documented limit of the rule that reproduces the measured 59/51/38 groups.
    expect(questGroupKey('WC-COMMONS-MAIN-002-BALANCE')).toBe('WC-COMMONS-MAIN-002-BALANCE');
    expect(questGroupKey('NoSuffix')).toBe('NoSuffix');
  });

  it('parses a QuestTitle_* key to its numeric id, and refuses what it cannot parse', () => {
    expect(parseQuestTitleKey('QuestTitle_1ED8D')).toBe(0x1ed8d);
    expect(parseQuestTitleKey('QuestTitle_00002173')).toBe(0x2173);
    expect(parseQuestTitleKey('QuestTitle_nothex')).toBeNull();
    expect(parseQuestTitleKey('QuestTitle_')).toBeNull();
    expect(parseQuestTitleKey('WizQst1ED8D_00000001')).toBeNull();
    // Beyond Number.MAX_SAFE_INTEGER — refused rather than rounded into a collision.
    expect(parseQuestTitleKey('QuestTitle_FFFFFFFFFFFFFF')).toBeNull();
  });

  it('names a requirement node from its key set (the NDJSON never writes $type)', () => {
    expect(questRequirementClass({ m_questName: 'A', m_operator: 'ROP_OR' })).toBe('ReqHasQuest');
    expect(questRequirementClass({ m_questName: '', m_entryName: 'X' })).toBe('ReqHasEntry');
    expect(requirementKeys({ m_questName: 'A', m_goalName: 'G', m_operator: 'ROP_OR' })).toEqual([
      'm_goalName',
      'm_operator',
      'm_questName',
    ]);
  });
});

describe('the hold-out protocol', () => {
  it('holds out every element with both neighbours, and calls the midpoint a hit', () => {
    const pairs: QuestIdPair[] = [
      { quest_name: 'A-B-C01-001', quest_id: 10 },
      { quest_name: 'A-B-C01-002', quest_id: 11 },
      { quest_name: 'A-B-C01-003', quest_id: 12 },
      { quest_name: 'A-B-C01-004', quest_id: 13 },
      { quest_name: 'A-B-C01-005', quest_id: 14 },
    ];
    const report = computeHoldoutAccuracy(pairs);

    expect(report.method).toBe('neighbour-midpoint');
    expect(report.pairs).toBe(5);
    expect(report.groups).toBe(1);
    expect(report.groups_ascending).toBe(1);
    expect(report.groups_contiguous).toBe(1);
    expect(report.cases).toBe(3);
    expect(report.hits).toBe(3);
    expect(report.misses).toBe(0);
    expect(report.accuracy).toBe(1);
    // Without lookups the accepted subset is the whole case set, by construction.
    expect(report.accepted_cases).toBe(3);
  });

  it('counts a two-element group but holds nothing out of it, and records a miss', () => {
    const pairs: QuestIdPair[] = [
      { quest_name: 'B-C-C01-001', quest_id: 100 },
      { quest_name: 'B-C-C01-002', quest_id: 200 },
      // The group below descends and skips, so it is neither ascending nor contiguous.
      { quest_name: 'D-E-C01-001', quest_id: 9 },
      { quest_name: 'D-E-C01-002', quest_id: 40 },
      { quest_name: 'D-E-C01-003', quest_id: 5 },
    ];
    const report = computeHoldoutAccuracy(pairs, { corpus: '/tmp/fake-corpus' });

    expect(report.corpus).toBe('/tmp/fake-corpus');
    expect(report.groups).toBe(2);
    expect(report.groups_ascending).toBe(1);
    // The ascending group's ids are 100 and 200, so it is not contiguous either.
    expect(report.groups_contiguous).toBe(0);
    expect(report.cases).toBe(1);
    expect(report.hits).toBe(0);
    expect(report.misses).toBe(1);
    expect(report.accuracy).toBe(0);
  });

  it('reports the accepted subset through the injected accept rule', () => {
    const pairs: QuestIdPair[] = [
      { quest_name: 'E-F-C01-001', quest_id: 1 },
      { quest_name: 'E-F-C01-002', quest_id: 3 },
      { quest_name: 'E-F-C01-003', quest_id: 5 },
    ];
    // The candidate is the midpoint of 1 and 5 — id 3; give *id 3* the key and the table.
    const lookups = fakeLookups({
      titleKeys: [[3, 'QuestTitle_00000003']],
      textRows: [[3, 4]],
    });
    const report = computeHoldoutAccuracy(pairs, { lookups });

    // The midpoint of 1 and 5 is 3 — the held-out id, so it is a hit.
    expect(report.cases).toBe(1);
    expect(report.hits).toBe(1);
    expect(report.misses).toBe(0);
    expect(report.accepted_cases).toBe(1);
    expect(report.accepted_hits).toBe(1);
  });
});

describe('the string-table adapter (in-memory, never the live database)', () => {
  function memoryDb(): ReturnType<typeof createQuestIdLookups> {
    const db = new Database(':memory:');
    db.exec(
      'CREATE TABLE string_table (key TEXT PRIMARY KEY, value TEXT NOT NULL, category TEXT NOT NULL)',
    );
    const insert = db.prepare('INSERT INTO string_table (key, value, category) VALUES (?, ?, ?)');
    insert.run('QuestTitle_1ED8D', 'Forged in Fire', 'QuestTitle');
    insert.run('QuestTitle_00002173', 'A Padded Key', 'QuestTitle');
    insert.run('WizQst1ED8D_00000000', 'Get the ', 'WizQst1ED8D');
    insert.run('WizQst1ED8D_00000001', 'Find ', 'WizQst1ED8D');
    insert.run('WizQstFire_00000000', 'Not a numeric id', 'WizQstFire');
    insert.run('Items_00022716', 'Hat', 'Items');
    return createQuestIdLookups(db);
  }

  it('answers hasTitleKey with the exact stored spelling only', () => {
    const lookups = memoryDb();
    expect(lookups.hasTitleKey('QuestTitle_1ED8D')).toBe(true);
    expect(lookups.hasTitleKey('QuestTitle_1ed8d')).toBe(false);
    expect(lookups.hasTitleKey('QuestTitle_0001ED8D')).toBe(false);
    expect(lookups.hasTitleKey('QuestTitle_2173')).toBe(false);
  });

  it('resolves an id to its stored key and counts its own WizQst tables', () => {
    const lookups = memoryDb();
    expect(lookups.titleKeyFor(0x1ed8d)).toBe('QuestTitle_1ED8D');
    expect(lookups.titleKeyFor(0x2173)).toBe('QuestTitle_00002173');
    expect(lookups.titleKeyFor(0xdeadbeef)).toBeNull();
    expect(lookups.countQuestTextRows(0x1ed8d)).toBe(2);
    expect(lookups.countQuestTextRows(0x2173)).toBe(0);
    // `WizQstFire_*` has no numeric id and is not reachable by one.
    expect(lookups.countQuestTextRows(0)).toBe(0);
  });
});
