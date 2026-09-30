import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { MEMORY_DB, openDb, writeSettings, type Db } from '@server/db';
import {
  createDraftsRouter,
  createSuggestionsRouter,
  type DraftRebuilder,
} from '@server/routes/drafts';
import { createExtractRouter } from '@server/routes/extract';
import { createQuestIdsRouter } from '@server/routes/questIds';
import { createQuestsRouter } from '@server/routes/quests';
import {
  acceptSuggestions,
  buildDrafts,
  DraftCorpusError,
  isEmptyValue,
  listSuggestions,
  namePredecessor,
  proposeDrafts,
  rejectSuggestion,
  storeCaptureSuggestions,
  zonePathOfWad,
  type DraftBuildResult,
  type SuggestionProposal,
} from '@server/services/drafts';
import {
  ChildRegistry,
  type CaptureSuggestion,
  type ExtractionService,
} from '@server/services/extraction';
import { createSpiraldbIndex, type SpiraldbIndex } from '@server/services/spiraldbIndex';
import { parseDocPath, setAtPath } from '@shared/document';
import { buildQuestScaffold } from '@shared/quest/scaffold';
import { QuestTemplateSchema } from '@shared/quest/questTemplate';
import { TYPE_STRINGS } from '@shared/quest/typeConstants';

import { seedString } from '../helpers/seed';

/**
 * Story p7-07 (plan task 7.6; D129, D130, D140, D143) — the suggestion store and the draft builder,
 * run on a **fixture catalog**: a `:memory:` database seeded with a handful of catalog, id, gate,
 * zone and string rows, and a temp SpiralDB root holding three quest files. Nothing here needs the
 * owner fork, the D17 clone or a game install, so CI runs the builder exactly as `npm run drafts`
 * does.
 *
 * The fixture's drafts, and what each must receive:
 *
 * | draft | tier | evidence |
 * |---|---|---|
 * | `FX-SERIES-C01-001` | named, no file | goals from its gate, a location for that goal |
 * | `FX-SERIES-C01-002` | named, file with an empty title/requirements/location | title, requirement, location |
 * | `FX-SERIES-C01-003` | named, a fully authored file | nothing (every field is filled) |
 * | id `0xAB` | unnamed | title, and the dialogue `-002`'s Prep block records from its table |
 * | id `0xAD` | unnamed | nothing — a zero-evidence draft |
 */

const OPEN: Db[] = [];
const TEMP: string[] = [];

afterEach(() => {
  while (OPEN.length > 0) {
    OPEN.pop()?.close();
  }
  while (TEMP.length > 0) {
    fs.rmSync(TEMP.pop() as string, { recursive: true, force: true });
  }
});

const ZONE = 'FixtureCity/Fix_Zone';

function dialogEntry(key: string, persona: string): Record<string, unknown> {
  return {
    $type: TYPE_STRINGS.NPCDialogEntry,
    m_personaName: persona,
    m_nameOverride: '',
    m_nameSTKey: '',
    m_dialog: key,
  };
}

function goal(name: string, location: string): Record<string, unknown> {
  return {
    $type: TYPE_STRINGS.PersonaGoalTemplate,
    m_goalName: name,
    m_goalType: 'GOAL_TYPE_PERSONA',
    m_destinationZone: ZONE,
    m_locationName: location,
    m_dialogList: null,
    m_goalRequirements: null,
  };
}

/** `-002`: a file whose title, requirements and one goal's location are empty. */
function questTwo(title = ''): Record<string, unknown> {
  return {
    ...buildQuestScaffold({ name: 'FX-SERIES-C01-002', link: { kind: 'none' } }),
    m_questTitle: title,
    m_goals: [goal('1_Goal', '')],
    // The Prep block records two lines of the **unnamed** id 0xAB's table: foreign dialogue.
    m_dialogList: {
      $type: TYPE_STRINGS.ActorDialogList,
      m_dialogs: [
        {
          m_dialogTag: 'Prep',
          m_dialogEntries: [
            dialogEntry('WizQstAB_00000001', 'FX-NPC01_Persona'),
            dialogEntry('WizQstAB_00000002', 'FX-NPC01_Persona'),
          ],
        },
      ],
    },
  };
}

/** `-003`: every field the builder proposes is already authored. */
function questThree(): Record<string, unknown> {
  return {
    ...buildQuestScaffold({ name: 'FX-SERIES-C01-003', link: { kind: 'none' } }),
    m_questTitle: 'QuestTitle_AC',
    m_goals: [goal('1_Goal', 'ZoneLocName_1')],
    m_requirements: {
      $type: TYPE_STRINGS.RequirementList,
      m_applyNOT: false,
      m_operator: 'ROP_AND',
      m_requirements: [
        {
          $type: TYPE_STRINGS.ReqHasQuest,
          m_applyNOT: false,
          m_operator: 'ROP_AND',
          m_questName: 'FX-SERIES-C01-002',
        },
      ],
    },
    m_dialogList: {
      $type: TYPE_STRINGS.ActorDialogList,
      m_dialogs: [
        { m_dialogTag: 'Prep', m_dialogEntries: [dialogEntry('WizQstAC_00000001', 'FX-NPC01')] },
      ],
    },
  };
}

interface Fixture {
  db: Db;
  root: string;
  index: SpiraldbIndex;
  writeQuest: (document: Record<string, unknown>) => void;
}

function fixture(): Fixture {
  const db = openDb({ file: MEMORY_DB });
  OPEN.push(db);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'p7-drafts-'));
  TEMP.push(root);
  fs.mkdirSync(path.join(root, 'QuestTemplates'));
  const writeQuest = (document: Record<string, unknown>): void => {
    fs.writeFileSync(
      path.join(root, 'QuestTemplates', `questtemplates_${String(document.m_questName)}.json`),
      JSON.stringify(document, null, 2),
    );
  };
  writeQuest(questTwo());
  writeQuest(questThree());
  writeSettings(db, { spiraldb_path: root });

  const quest = db.prepare(
    'INSERT INTO quests (quest_name, title, has_definition, link_kind, title_source, reference_count) VALUES (?, ?, ?, ?, ?, ?)',
  );
  quest.run('FX-SERIES-C01-001', 'Series One', 0, 'direct', 'direct', 2);
  quest.run('FX-SERIES-C01-002', '', 1, 'none', 'none', 0);
  quest.run('FX-SERIES-C01-003', '', 1, 'none', 'none', 0);

  const id = db.prepare(
    'INSERT INTO quest_ids (quest_id, title_key, title, text_rows, matched_quest_name, link_kind) VALUES (?, ?, ?, ?, ?, ?)',
  );
  id.run(0xaa, 'QuestTitle_AA', 'Series One', 0, 'FX-SERIES-C01-001', 'direct');
  id.run(0xab, 'QuestTitle_AB', 'The Unnamed One', 2, null, 'none');
  id.run(0xac, 'QuestTitle_AC', 'Series Three', 1, 'FX-SERIES-C01-003', 'direct');
  id.run(0xad, null, null, 0, null, 'none');
  id.run(0xae, 'QuestTitle_AE', 'Series Two', 0, 'FX-SERIES-C01-002', 'inferred');

  seedString(db, 'QuestTitle_AA', 'Series One', 'QuestTitle');
  seedString(db, 'QuestTitle_AB', 'The Unnamed One', 'QuestTitle');
  seedString(db, 'QuestTitle_AC', 'Series Three', 'QuestTitle');
  seedString(db, 'QuestTitle_AE', 'Series Two', 'QuestTitle');
  seedString(db, 'WizQstAB_00000001', 'A line of the unnamed quest', 'WizQstAB');
  seedString(db, 'WizQstAB_00000002', 'Another line', 'WizQstAB');
  seedString(db, 'WizQstAC_00000001', 'Series three prep', 'WizQstAC');
  seedString(db, 'ZoneLocName_1', 'Fixture City|Fix Zone', 'ZoneLocName');

  db.prepare('INSERT INTO zones (zone_path, display_name, world) VALUES (?, ?, ?)').run(
    ZONE,
    'Fix Zone',
    'FixtureCity',
  );
  const ref = db.prepare(
    'INSERT INTO quest_catalog_refs (quest_name, wad, entry, class, goal_name, required_status) VALUES (?, ?, ?, ?, ?, ?)',
  );
  ref.run(
    'FX-SERIES-C01-001',
    'FixtureCity-Fix_Zone.wad',
    'triggers.xml',
    'WizZoneTriggers',
    'Goal 1',
    'Incomplete',
  );
  ref.run(
    'FX-SERIES-C01-001',
    'FixtureCity-Fix_Zone.wad',
    'gamedata.bin',
    'WizZoneData',
    null,
    null,
  );

  const index = createSpiraldbIndex(root);
  index.rebuildType('questtemplates');
  return { db, root, index, writeQuest };
}

const draftKey = (proposal: Pick<SuggestionProposal, 'quest_name' | 'catalog_id'>): string =>
  proposal.quest_name ?? `#${proposal.catalog_id}`;

const summary = (proposals: readonly SuggestionProposal[]): string[] =>
  proposals.map((p) => `${draftKey(p)} ${p.source} ${p.path}`).sort();

/** The counts a rebuild reports, minus the clock. */
const counts = (result: DraftBuildResult): Omit<DraftBuildResult, 'duration_ms'> => {
  const { duration_ms: _duration, ...rest } = result;
  return rest;
};

describe('the empty rule (D162)', () => {
  it('treats the skeleton values as empty and authored content as not', () => {
    for (const empty of [null, undefined, '', 0, false, [], { m_results: [] }]) {
      expect(isEmptyValue(empty), JSON.stringify(empty)).toBe(true);
    }
    expect(isEmptyValue({ $type: TYPE_STRINGS.ActorDialogList, m_dialogs: [] })).toBe(true);
    expect(
      isEmptyValue({
        $type: TYPE_STRINGS.RequirementList,
        m_applyNOT: false,
        m_operator: 'ROP_AND',
        m_requirements: [],
      }),
    ).toBe(true);
    expect(isEmptyValue('QuestTitle_AA')).toBe(false);
    expect(isEmptyValue([{}])).toBe(false);
    expect(isEmptyValue(questThree().m_requirements)).toBe(false);
  });

  it('reads the two rules the evidence sources rest on', () => {
    expect(zonePathOfWad('Aquila-Interiors-AQ_Z03_CavOfNyx.wad')).toBe(
      'Aquila/Interiors/AQ_Z03_CavOfNyx',
    );
    expect(namePredecessor('DS-LIB2-C03-002')).toBe('DS-LIB2-C03-001');
    expect(namePredecessor('DS-LIB2-C03-001')).toBeNull();
    expect(namePredecessor('NO-SERIES')).toBeNull();
  });
});

describe('the builder on the fixture catalog (CI)', () => {
  it('proposes exactly the evidence each draft lacks, named and unnamed', () => {
    const { db, index } = fixture();
    const { proposals } = proposeDrafts(db, index);

    expect(summary(proposals)).toEqual(
      [
        '#171 evidence-dialogue m_dialogList',
        '#171 evidence-title m_questTitle',
        'FX-SERIES-C01-001 evidence-goals m_goals',
        'FX-SERIES-C01-001 evidence-location m_goals[0].m_locationName',
        'FX-SERIES-C01-002 evidence-location m_goals[0].m_locationName',
        'FX-SERIES-C01-002 evidence-requirements m_requirements',
        'FX-SERIES-C01-002 evidence-title m_questTitle',
      ].sort(),
    );
    // Unnamed ids carry no name and their own id (D137); named drafts carry the linked id.
    for (const p of proposals.filter((p) => p.quest_name === null)) {
      expect(p.catalog_id).toBe(0xab);
    }
    expect(proposals.find((p) => p.quest_name === 'FX-SERIES-C01-001')?.catalog_id).toBe(0xaa);

    const title = proposals.find(
      (p) => p.quest_name === 'FX-SERIES-C01-002' && p.source === 'evidence-title',
    );
    expect(title).toMatchObject({ value: 'QuestTitle_AE', confidence: 0.78 });
    const requirement = proposals.find((p) => p.source === 'evidence-requirements');
    expect(JSON.stringify(requirement?.value)).toContain('"m_questName":"FX-SERIES-C01-001"');
    const goals = proposals.find((p) => p.source === 'evidence-goals')?.value as Array<
      Record<string, unknown>
    >;
    expect(goals.map((g) => [g.m_goalName, g.m_destinationZone])).toEqual([['Goal 1', ZONE]]);
    const dialogue = proposals.find((p) => p.source === 'evidence-dialogue');
    expect(dialogue?.evidence_ref).toBe(
      'questtemplates:FX-SERIES-C01-002#m_dialogList.m_dialogs[0] (speakers: FX-NPC01_Persona)',
    );
  });

  it('gives an existing file suggestions only for the fields empty in it', () => {
    const { db, index } = fixture();
    const { proposals } = proposeDrafts(db, index);

    // -003 is fully authored: its linked title, its predecessor, its location — none proposed.
    expect(proposals.filter((p) => p.quest_name === 'FX-SERIES-C01-003')).toEqual([]);
    // -002's dialog list is non-empty, so the foreign-dialogue rule never proposes into it.
    expect(
      proposals.filter((p) => p.quest_name === 'FX-SERIES-C01-002' && p.path === 'm_dialogList'),
    ).toEqual([]);
    // -001 has no file: its direct title is already in the D118 skeleton, so it is not proposed.
    expect(
      proposals.filter((p) => p.quest_name === 'FX-SERIES-C01-001' && p.path === 'm_questTitle'),
    ).toEqual([]);
  });

  it('proposes only values the shared schema accepts once applied at their path', () => {
    const { db, index } = fixture();
    const { proposals } = proposeDrafts(db, index);
    const bases: Record<string, Record<string, unknown>> = {
      'FX-SERIES-C01-001': buildQuestScaffold({
        name: 'FX-SERIES-C01-001',
        link: { kind: 'direct', titleKey: 'QuestTitle_AA' },
      }),
      'FX-SERIES-C01-002': questTwo(),
      '#171': buildQuestScaffold({ name: 'UNNAMED-171', link: { kind: 'none' } }),
    };
    for (const [key, base] of Object.entries(bases)) {
      // Applied in path order, the order every read lists them in: `m_goals` before `m_goals[0]…`.
      const applied = proposals
        .filter((p) => draftKey(p) === key)
        .sort((a, b) => (a.path < b.path ? -1 : 1))
        .reduce<unknown>((doc, p) => setAtPath(doc, parseDocPath(p.path) ?? [], p.value), base);
      expect(QuestTemplateSchema.safeParse(applied).success, key).toBe(true);
    }
  });

  it('reconciles with coverage and gives identical counts on two consecutive rebuilds', () => {
    const { db, index } = fixture();
    const first = buildDrafts({ db, index });
    const second = buildDrafts({ db, index });

    expect(first.inserted).toBe(7);
    expect(second).toMatchObject({ inserted: 0, unchanged: 7, removed: 0 });
    expect(counts({ ...second, inserted: first.inserted, unchanged: first.unchanged })).toEqual(
      counts(first),
    );

    const coverage = db.prepare('SELECT * FROM coverage').get() as Record<string, number>;
    const unlinked = (
      db.prepare('SELECT count(*) AS c FROM quest_ids WHERE matched_quest_name IS NULL').get() as {
        c: number;
      }
    ).c;
    expect(second.drafts).toEqual({
      named_missing: coverage.missing,
      named_defined: coverage.defined,
      unnamed: unlinked,
      zero_evidence: 2, // -003 and id 0xAD
    });
    expect(second.by_source).toEqual({
      'evidence-title': 2,
      'evidence-dialogue': 1,
      'evidence-goals': 1,
      'evidence-location': 2,
      'evidence-requirements': 1,
      'capture-order': 0,
      'capture-rewards': 0,
    });
  });

  it('keeps a rejected suggestion rejected across a rebuild, and never resurrects it', () => {
    const { db, index } = fixture();
    buildDrafts({ db, index });
    const [title] = listSuggestions(db, { catalog_id: 0xab }, 'pending').filter(
      (row) => row.source === 'evidence-title',
    );
    rejectSuggestion(db, title!.id);

    const rebuilt = buildDrafts({ db, index });

    expect(rebuilt.inserted).toBe(0);
    const rows = listSuggestions(db, { catalog_id: 0xab }, 'all').filter(
      (row) => row.path === 'm_questTitle',
    );
    expect(rows.map((row) => [row.id, row.status])).toEqual([[title!.id, 'rejected']]);
    expect(rows[0]?.decided_at).not.toBeNull();
  });

  it('keeps a rejection when a sync links the named quest to a different id', () => {
    const { db, index } = fixture();
    buildDrafts({ db, index });
    const requirement = listSuggestions(db, { quest_name: 'FX-SERIES-C01-002' }, 'pending').find(
      (row) => row.source === 'evidence-requirements',
    );
    rejectSuggestion(db, requirement!.id);
    // A later sync links -002 to a lower id: the draft's catalog_id changes, its identity with it.
    db.prepare(
      'INSERT INTO quest_ids (quest_id, title_key, matched_quest_name, link_kind) VALUES (?, ?, ?, ?)',
    ).run(0x10, null, 'FX-SERIES-C01-002', 'direct');

    buildDrafts({ db, index });

    const rows = listSuggestions(db, { quest_name: 'FX-SERIES-C01-002' }, 'all').filter(
      (row) => row.source === 'evidence-requirements',
    );
    expect(rows.map((row) => row.status)).toEqual(['rejected']);
  });

  it('does not re-propose a value already accepted, from any source', () => {
    const { db, index } = fixture();
    buildDrafts({ db, index });
    const location = listSuggestions(db, { quest_name: 'FX-SERIES-C01-002' }, 'pending').find(
      (row) => row.source === 'evidence-location',
    );
    acceptSuggestions(db, [location!.id], { quest_name: 'FX-SERIES-C01-002', catalog_id: null });
    // The same value accepted under another source blocks the evidence source's proposal too.
    storeCaptureSuggestions(
      db,
      [
        {
          questName: 'FX-SERIES-C01-002',
          path: 'm_requirements',
          value: proposeDrafts(db, index).proposals.find(
            (p) => p.source === 'evidence-requirements',
          )?.value,
          source: 'capture-order',
          confidence: 0.8,
          note: 'test',
        },
      ],
      'fixture.json',
    );
    const captured = listSuggestions(db, { quest_name: 'FX-SERIES-C01-002' }, 'pending').find(
      (row) => row.source === 'capture-order',
    );
    acceptSuggestions(db, [captured!.id], { quest_name: 'FX-SERIES-C01-002', catalog_id: null });
    db.prepare("DELETE FROM quest_suggestions WHERE source = 'evidence-requirements'").run();

    const rebuilt = buildDrafts({ db, index });

    const rows = listSuggestions(db, { quest_name: 'FX-SERIES-C01-002' }, 'all');
    expect(
      rows.filter((row) => row.path === 'm_goals[0].m_locationName').map((row) => row.status),
    ).toEqual(['accepted']);
    expect(rows.filter((row) => row.path === 'm_requirements').map((row) => row.source)).toEqual([
      'capture-order',
    ]);
    expect(rebuilt.inserted).toBe(0);
  });

  it('removes a pending evidence row once the file fills its field, and never touches decided or capture rows', () => {
    const { db, index, writeQuest } = fixture();
    buildDrafts({ db, index });
    storeCaptureSuggestions(
      db,
      [
        {
          questName: 'FX-SERIES-C01-002',
          path: 'm_goalLogic',
          value: [],
          source: 'capture-order',
          confidence: 0.6,
          note: 'n',
        },
      ],
      'fixture.json',
    );
    writeQuest(questTwo('QuestTitle_AE'));
    index.rebuildType('questtemplates');

    const rebuilt = buildDrafts({ db, index });

    expect(rebuilt.removed).toBe(1);
    const rows = listSuggestions(db, { quest_name: 'FX-SERIES-C01-002' }, 'all');
    expect(rows.some((row) => row.path === 'm_questTitle')).toBe(false);
    expect(rows.some((row) => row.source === 'capture-order')).toBe(true);
  });

  it('refuses a rebuild whose quest-file read found no file while evidence rows are pending, writing nothing (PR #14 review 1)', () => {
    // The review's reproduction: a root that is an existing directory but not the SpiralDB root
    // (here: the right root with its QuestTemplates/ gone) reads 0 quest files, proposes nothing
    // for the files, and used to delete every pending evidence row as "no longer proposed".
    const { db, root, index } = fixture();
    buildDrafts({ db, index });
    storeCaptureSuggestions(
      db,
      [
        {
          questName: 'FX-SERIES-C01-002',
          path: 'm_goalLogic',
          value: [],
          source: 'capture-order',
          confidence: 0.6,
          note: 'n',
        },
      ],
      'fixture.json',
    );
    const snapshot = (): unknown => db.prepare('SELECT * FROM quest_suggestions ORDER BY id').all();
    const before = snapshot();

    fs.rmSync(path.join(root, 'QuestTemplates'), { recursive: true, force: true });
    const unreadable = createSpiraldbIndex(root);
    const stats = unreadable.rebuildType('questtemplates');
    expect(stats).toMatchObject({ indexed: 0, missingDirectories: ['QuestTemplates'] });

    expect(() => buildDrafts({ db, index: unreadable })).toThrow(DraftCorpusError);
    expect(() => buildDrafts({ db, index: unreadable })).toThrow(
      /read no quest file from .*QuestTemplates.*pending evidence suggestions/s,
    );
    expect(snapshot()).toEqual(before);
  });

  it('rebuilds over an empty quest-file read when no evidence row is pending (nothing to lose)', () => {
    const { db, root } = fixture();
    fs.rmSync(path.join(root, 'QuestTemplates'), { recursive: true, force: true });
    const empty = createSpiraldbIndex(root);
    empty.rebuildType('questtemplates');
    expect(buildDrafts({ db, index: empty }).removed).toBe(0);
  });

  it('stores capture suggestions idempotently, and a rebuild keeps them', () => {
    const { db, index } = fixture();
    const golden = JSON.parse(
      fs.readFileSync(
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          '..',
          '..',
          'server',
          'test',
          'fixtures',
          'captures',
          'p7',
          'WC-HAUNTED-MAIN-001.suggestions.json',
        ),
        'utf8',
      ),
    ) as { suggestions: CaptureSuggestion[] };

    const first = storeCaptureSuggestions(db, golden.suggestions, 'WC-HAUNTED-MAIN-001.json');
    const again = storeCaptureSuggestions(db, golden.suggestions, 'WC-HAUNTED-MAIN-001.json');
    buildDrafts({ db, index });

    expect(first.inserted).toBe(golden.suggestions.length);
    // `uncatalogued` (PR #14 review 9d): the fixture catalog holds no WC-HAUNTED-MAIN-001 row.
    expect(again).toEqual({
      inserted: 0,
      unchanged: golden.suggestions.length,
      uncatalogued: golden.suggestions.length,
    });
    const stored = listSuggestions(db, { quest_name: 'WC-HAUNTED-MAIN-001' }, 'pending');
    expect(stored).toHaveLength(golden.suggestions.length);
    expect(stored.every((row) => row.evidence_ref === 'capture:WC-HAUNTED-MAIN-001.json')).toBe(
      true,
    );
    expect(stored.map((row) => row.value)).toEqual(
      expect.arrayContaining(golden.suggestions.map((s) => s.value)),
    );
  });
});

describe('the drafts and suggestions API (D141, D143)', () => {
  function app(db: Db, rebuild?: DraftRebuilder): Express {
    const server = express();
    server.use(express.json());
    server.use(
      '/api/drafts',
      createDraftsRouter({ db, ...(rebuild === undefined ? {} : { rebuild }) }),
    );
    server.use('/api/suggestions', createSuggestionsRouter({ db }));
    server.use('/api/quests', createQuestsRouter({ db }));
    server.use('/api/quest-ids', createQuestIdsRouter({ db }));
    return server;
  }

  it('rebuilds from the settings root and lists the ranked queue with the D130 toggle count', async () => {
    const { db } = fixture();
    const server = app(db);

    const rebuilt = await request(server).post('/api/drafts/rebuild');
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.body).toMatchObject({ inserted: 7, unchanged: 0, drafts: { unnamed: 2 } });
    expect(typeof rebuilt.body.duration_ms).toBe('number');

    const queue = await request(server).get('/api/drafts');
    expect(queue.status).toBe(200);
    expect(queue.body.total).toBe(3);
    expect(queue.body.hidden_zero_evidence).toBe(2);
    expect(
      queue.body.drafts.map(
        (d: { quest_name: string | null; catalog_id: number }) => d.quest_name ?? d.catalog_id,
      ),
    ).toEqual(['FX-SERIES-C01-002', 'FX-SERIES-C01-001', 0xab]);
    expect(queue.body.drafts[0].sources).toEqual([
      'evidence-location',
      'evidence-requirements',
      'evidence-title',
    ]);

    const unnamed = await request(server).get('/api/drafts?named=0&all=1');
    expect(unnamed.body.total).toBe(2);
    const bySource = await request(server).get('/api/drafts?source=evidence-dialogue');
    expect(bySource.body.drafts.map((d: { catalog_id: number }) => d.catalog_id)).toEqual([0xab]);
    for (const bad of ['named=2', 'source=nope', 'limit=5000', 'all=yes']) {
      expect((await request(server).get(`/api/drafts?${bad}`)).status, bad).toBe(400);
    }
  });

  it('answers 409 naming the missing directory when the settings root reads no quest file, and deletes nothing (PR #14 review 1)', async () => {
    const { db, root, index } = fixture();
    buildDrafts({ db, index });
    const pending = (): number =>
      (
        db
          .prepare(
            "SELECT count(*) AS c FROM quest_suggestions WHERE status = 'pending' AND source LIKE 'evidence-%'",
          )
          .get() as { c: number }
      ).c;
    const before = pending();
    expect(before).toBeGreaterThan(0);
    // `spiraldb_path` pointed one level too deep — an existing directory, so Settings accepts it.
    writeSettings(db, { spiraldb_path: path.join(root, 'QuestTemplates') });

    const res = await request(app(db)).post('/api/drafts/rebuild');

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('QuestTemplates');
    expect(res.body.error).toContain(`${before} pending evidence suggestions`);
    expect(pending()).toBe(before);
  });

  it('answers 409 while a rebuild runs', async () => {
    const { db } = fixture();
    let release: (value: DraftBuildResult) => void = () => undefined;
    const held = new Promise<DraftBuildResult>((resolve) => {
      release = resolve;
    });
    const server = app(db, () => held);

    const first = request(server)
      .post('/api/drafts/rebuild')
      .then((res) => res);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await request(server).post('/api/drafts/rebuild');
    expect(second.status).toBe(409);
    release({ inserted: 0 } as DraftBuildResult);
    expect((await first).status).toBe(200);
  });

  it('reads a draft’s suggestions by name or id, and rejects once', async () => {
    const { db, index } = fixture();
    buildDrafts({ db, index });
    const server = app(db);

    const named = await request(server).get('/api/quests/FX-SERIES-C01-002/suggestions');
    expect(named.status).toBe(200);
    expect(named.body.quest_name).toBe('FX-SERIES-C01-002');
    expect(named.body.catalog_id).toBe(0xae);
    expect(named.body.suggestions.map((s: { path: string }) => s.path)).toEqual([
      'm_goals[0].m_locationName',
      'm_questTitle',
      'm_requirements',
    ]);

    const byId = await request(server).get(`/api/quest-ids/${0xab}/suggestions`);
    expect(byId.body).toMatchObject({ quest_name: null, catalog_id: 0xab });
    expect(byId.body.suggestions).toHaveLength(2);
    const target = byId.body.suggestions.find(
      (s: { source: string }) => s.source === 'evidence-title',
    );
    expect(target.value).toBe('QuestTitle_AB');

    const rejected = await request(server).post(`/api/suggestions/${target.id}/reject`);
    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({ id: target.id, status: 'rejected' });
    expect((await request(server).post(`/api/suggestions/${target.id}/reject`)).status).toBe(409);
    expect((await request(server).post('/api/suggestions/999999/reject')).status).toBe(404);

    const after = await request(server).get(`/api/quest-ids/${0xab}/suggestions?status=rejected`);
    expect(after.body.suggestions.map((s: { id: number }) => s.id)).toEqual([target.id]);
    expect((await request(server).get('/api/quests/NOPE/suggestions')).status).toBe(404);
    expect((await request(server).get('/api/quest-ids/1/suggestions')).status).toBe(404);
    expect(
      (await request(server).get('/api/quests/FX-SERIES-C01-002/suggestions?status=maybe')).status,
    ).toBe(400);
  });

  it("stores an extraction's capture suggestions when it answers (D161), keyed by the capture name", async () => {
    const { db } = fixture();
    const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7-drafts-upload-'));
    TEMP.push(uploadDir);
    const suggestion: CaptureSuggestion = {
      questName: 'WC-HAUNTED-MAIN-001',
      path: 'm_startGoals',
      value: ['1_WizardQuestGoals_Explore'],
      source: 'capture-order',
      confidence: 0.8,
      note: 'first MSG_SENDGOAL',
    };
    const service: ExtractionService = {
      cliPath: 'fake',
      start: () => ({
        children: new ChildRegistry(),
        result: Promise.resolve([{ m_questName: 'WC-HAUNTED-MAIN-001' }]),
        suggestions: Promise.resolve([suggestion]),
      }),
    };
    const server = express();
    server.use(
      '/api/extract',
      createExtractRouter({
        service,
        uploadDir,
        storeSuggestions: (suggestions, name) => storeCaptureSuggestions(db, suggestions, name),
      }),
    );

    for (let upload = 0; upload < 2; upload += 1) {
      const res = await request(server)
        .post('/api/extract/quests')
        .attach('file', Buffer.from('[]'), 'session_1.json');
      expect(res.status).toBe(200);
      expect(res.body.suggestions).toEqual([suggestion]);
    }

    // Stored once, although uploaded twice; the value is never merged into the quest.
    const rows = listSuggestions(db, { quest_name: 'WC-HAUNTED-MAIN-001' }, 'all');
    expect(rows.map((row) => [row.path, row.value, row.source, row.evidence_ref])).toEqual([
      ['m_startGoals', ['1_WizardQuestGoals_Explore'], 'capture-order', 'capture:session_1.json'],
    ]);
  });

  describe('the store outcome is part of the answer (PR #14 review 9a, 9d)', () => {
    const suggestion = (questName: string): CaptureSuggestion => ({
      questName,
      path: 'm_startGoals',
      value: ['1_Goal'],
      source: 'capture-order',
      confidence: 0.8,
      note: 'n',
    });
    function extractApp(
      suggestions: CaptureSuggestion[],
      store: (s: CaptureSuggestion[], name: string) => unknown,
    ): Express {
      const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p7-drafts-upload-'));
      TEMP.push(uploadDir);
      const service: ExtractionService = {
        cliPath: 'fake',
        start: () => ({
          children: new ChildRegistry(),
          result: Promise.resolve([{ m_questName: suggestions[0]?.questName ?? 'X' }]),
          suggestions: Promise.resolve(suggestions),
        }),
      };
      const server = express();
      server.use(
        '/api/extract',
        createExtractRouter({ service, uploadDir, storeSuggestions: store as never }),
      );
      return server;
    }

    it('reports a store failure in the 200 body instead of only a server warning', async () => {
      const res = await request(
        extractApp([suggestion('FX-SERIES-C01-002')], () => {
          throw new Error('database is locked');
        }),
      )
        .post('/api/extract/quests')
        .attach('file', Buffer.from('[]'), 'session_2.json');
      expect(res.status).toBe(200);
      expect(res.body.suggestions_store).toEqual({ stored: false, reason: 'database is locked' });
    });

    it('awaits the store and counts suggestions whose quest the catalog does not hold', async () => {
      const { db } = fixture();
      const res = await request(
        extractApp(
          [suggestion('FX-SERIES-C01-002'), suggestion('FX-NOT-IN-CATALOG-001')],
          async (s, name) => storeCaptureSuggestions(db, s, name),
        ),
      )
        .post('/api/extract/quests')
        .attach('file', Buffer.from('[]'), 'session_3.json');
      expect(res.status).toBe(200);
      expect(res.body.suggestions_store).toEqual({
        stored: true,
        inserted: 2,
        unchanged: 0,
        uncatalogued: 1,
      });
    });
  });
});
