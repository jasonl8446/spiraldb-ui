import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Express } from 'express';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { MEMORY_DB, openDb, writeSettings, type Db } from '@server/db';
import { buildNpcView } from '@server/services/npcNames';
import {
  composeSpeakerName,
  questEvidenceById,
  questEvidenceByName,
  type QuestEvidence,
} from '@server/services/questEvidence';
import { listQuests } from '@server/services/quests';
import { createSpiraldbIndex, type SpiraldbIndex } from '@server/services/spiraldbIndex';
import { createNpcsRouter } from '@server/routes/npcs';
import { createQuestIdsRouter } from '@server/routes/questIds';
import { createQuestsRouter } from '@server/routes/quests';

/**
 * Story p6-07 — the per-quest **evidence** surface and the **NPC view**
 * (plan task 6.6; docs/spec-api.md L420-550).
 *
 * The suite runs on the **committed fixture corpus**
 * (`server/test/fixtures/evidence-corpus/`) — never on the 19 GB game tree and never
 * on `data/spiraldb-ui.db` — which is ac2's requirement, and on `:memory:` databases
 * (D17).
 *
 * What it pins, in the order the acceptance criteria name them:
 *
 * 1. the response **shape** — every section, both `used_by_this_file` values, the
 *    references resolved through `REFERENCE_FIELDS` and rendered by the one display
 *    rule;
 * 2. the **speaker ladder**, rung by rung, including the two fall-throughs and the
 *    camera-name negative control (an implementation that scraped
 *    `m_cameraName` would pass rung 1's line and fail the four `'LOCATION'` lines);
 * 3. the offline/unknown arms — an unknown quest, an unknown id, and an id with no
 *    linked catalog name (an honest `title_source`);
 * 4. the **collision**: the evidence endpoint's `title_source` is the catalog
 *    column, while the quests list endpoint reports its own per-file value for the
 *    same quest — asserted together so the two can never be conflated silently;
 * 5. the NPC view's counts, each equal to a direct query over the same tables, plus
 *    the missing-family note.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(HERE, '..', '..', 'server', 'test', 'fixtures', 'evidence-corpus');

const OPEN: Db[] = [];

afterEach(() => {
  while (OPEN.length > 0) {
    OPEN.pop()?.close();
  }
});

function memoryDb(): Db {
  const db = openDb({ file: MEMORY_DB });
  OPEN.push(db);
  return db;
}

function seedString(db: Db, key: string, value: string, category: string): void {
  db.prepare('INSERT INTO string_table (key, value, category) VALUES (?, ?, ?)').run(
    key,
    value,
    category,
  );
}

function seedNpc(db: Db, templateId: number, name: string): void {
  db.prepare('INSERT INTO npcs (template_id, name) VALUES (?, ?)').run(templateId, name);
}

function seedPersona(
  db: Db,
  objectName: string,
  templateId: number | null,
  first: string | null,
  last: string | null,
): void {
  db.prepare(
    'INSERT INTO persona_index (object_name, template_id, first_key, last_key, title_key) VALUES (?, ?, ?, ?, ?)',
  ).run(objectName, templateId, first, last, null);
}

/** The measured `NPCFormats_*` strings and the component keys the struct carries. */
function seedFixtureTables(db: Db): void {
  // --- the string table: the quest's own rows plus every ladder input -----------
  seedString(db, 'QuestTitle_1A2B', 'Fixture Quest One', 'QuestTitle');
  seedString(db, 'QuestTitle_2C4D', 'Inferred Quest', 'QuestTitle');
  for (let index = 0; index <= 6; index += 1) {
    seedString(
      db,
      `WizQst1A2B_${String(index).padStart(8, '0')}`,
      `Fixture line ${index}`,
      'WizQst1A2B',
    );
  }
  // A **sibling** quest's own table (the measured `WizQst17318E_*` shape of the real corpus): the
  // 'Prep' entry points at it, so `own_table` must be false while its text still resolves.
  seedString(db, 'WizQst9999_00000000', 'Sibling quest prep line', 'WizQst9999');
  seedString(db, 'NPCFormats_First_Last', '#1:$NPC_FIRSTNAME$ #2:$NPC_LASTNAME$', 'NPCFormats');
  seedString(db, 'NPCFormats_First_Only', '#1:$NPC_FIRSTNAME$', 'NPCFormats');
  seedString(db, 'WC-NPCs_00000027', 'Ceren Nightchant', 'WC-NPCs');
  seedString(db, 'WC-NPCs_00000083', 'Cyrus', 'WC-NPCs');
  seedString(db, 'WC-NPCs_00000084', 'Drake', 'WC-NPCs');
  // The NPC view's alias vocabulary for fixture NPC 9001: the full name and the
  // first-name granularity — one entity carrying both strings (D112's whole point).
  seedString(db, 'WC-NPCs_00000901', 'Fixture Villain', 'WC-NPCs');
  seedString(db, 'WC-NPCs_00000902', 'Fixture', 'WC-NPCs');

  // --- the friendly-name tables -------------------------------------------------
  seedNpc(db, 9001, 'Fixture Villain');
  // The next two names exist precisely so the composition and the override can be proven to
  // have won: if either is returned, a rung was skipped.
  seedNpc(db, 9002, 'Template Name Must Not Win');
  seedNpc(db, 9003, 'Template Name Must Not Win Either');
  seedNpc(db, 9004, 'Gamma');
  db.prepare('INSERT INTO spells (template_id, name, school) VALUES (?, ?, ?)').run(
    5001,
    'Fixture Spell',
    null,
  );
  db.prepare('INSERT INTO zones (zone_path, display_name, world) VALUES (?, ?, ?)').run(
    'FixtureCity/Fix_Zone',
    'Fixture City / Fix Zone',
    'FixtureCity',
  );

  // --- the persona index --------------------------------------------------------
  seedPersona(db, 'FIXTURE-NPC01', 9002, 'WC-NPCs_00000083', 'WC-NPCs_00000084');
  seedPersona(db, 'FIXTURE-NPC02', 9003, null, null);
  seedPersona(db, 'FIXTURE-NPC03', 9004, null, null);
  seedPersona(db, 'FIXTURE-VILLAIN-NPC', 9001, null, null);

  // --- the catalog --------------------------------------------------------------
  db.prepare(
    `INSERT INTO quests (quest_name, title, level, is_mainline, has_definition, link_kind, title_source, reference_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('P6-EVIDENCE-001', 'Fixture Quest One', 5, 0, 1, 'direct', 'direct', 0);
  db.prepare(
    `INSERT INTO quests (quest_name, title, level, is_mainline, has_definition, link_kind, title_source, reference_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('P6-EVIDENCE-002', 'Inferred Quest', 1, 0, 0, 'inferred', 'inferred', 0);
  db.prepare(
    `INSERT INTO quest_ids (quest_id, title_key, title, text_rows, matched_quest_name, link_kind, inference_basis)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(6699, 'QuestTitle_1A2B', 'Fixture Quest One', 7, 'P6-EVIDENCE-001', 'direct', null);
  // The id-only tier: no linked catalog name, so `title_source` must be its own honest value.
  db.prepare(
    `INSERT INTO quest_ids (quest_id, title_key, title, text_rows, matched_quest_name, link_kind, inference_basis)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(7001, null, null, 3, null, 'none', null);
  db.prepare(
    `INSERT INTO quest_ids (quest_id, title_key, title, text_rows, matched_quest_name, link_kind, inference_basis)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    7003,
    'QuestTitle_2C4D',
    'Inferred Quest',
    4,
    'P6-EVIDENCE-002',
    'inferred',
    '{"method":"neighbour-midpoint"}',
  );

  // --- one goal gate plus one ungated reference --------------------------------
  db.prepare(
    `INSERT INTO quest_catalog_refs (quest_name, wad, entry, class, goal_name, required_status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    'P6-EVIDENCE-001',
    'FixtureZone.wad',
    'triggers.xml',
    'WizZoneTriggers',
    'Fix_Goal1',
    'Completed',
  );
  db.prepare(
    `INSERT INTO quest_catalog_refs (quest_name, wad, entry, class, goal_name, required_status)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run('P6-EVIDENCE-001', 'FixtureZone.wad', 'gamedata.bin', 'WizZoneData', null, null);
}

interface Harness {
  db: Db;
  app: Express;
  index: SpiraldbIndex;
}

function harness(): Harness {
  const db = memoryDb();
  seedFixtureTables(db);
  writeSettings(db, { spiraldb_path: FIXTURE_ROOT, user_name: 'p6-07-vitest', git_branch: '' });
  const index = createSpiraldbIndex(FIXTURE_ROOT);
  index.rebuild();

  const app = express();
  app.use(express.json());
  app.use('/api/quests', createQuestsRouter({ db }));
  app.use('/api/quest-ids', createQuestIdsRouter({ db }));
  app.use('/api/npcs', createNpcsRouter({ db }));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return { db, app, index };
}

function found(result: ReturnType<typeof questEvidenceByName>): QuestEvidence {
  expect(result.kind).toBe('found');
  if (result.kind !== 'found') {
    throw new Error('unreachable');
  }
  return result.evidence;
}

/* --------------------------------------------------------------- the shape */

describe('the evidence shape (ac1/ac2 — committed fixtures)', () => {
  it('answers every section for a corpus-shaped fixture quest', () => {
    const { db, index } = harness();
    const evidence = found(questEvidenceByName({ db, index }, 'P6-EVIDENCE-001'));

    expect(evidence.quest).toEqual({
      quest_name: 'P6-EVIDENCE-001',
      quest_id: 6699, // parsed from the file's own `m_questTitle`, since `quest_ids` names it too
      has_definition: true,
      link_kind: 'direct',
      title: 'Fixture Quest One',
      title_source: 'direct',
      inference_basis: null,
    });

    // text_rows: 7 rows in the quest's own table, 5 referenced by the file's own string values.
    expect(evidence.text_rows).toHaveLength(7);
    const used = evidence.text_rows.filter((row) => row.used_by_this_file);
    expect(used).toHaveLength(5);
    expect(used.every((row) => row.field?.endsWith('.m_dialog') === true)).toBe(true);
    // …and the rows nothing references carry `false` with no provenance — both values are present.
    const available = evidence.text_rows.filter((row) => !row.used_by_this_file);
    expect(available.map((row) => row.key)).toEqual(['WizQst1A2B_00000005', 'WizQst1A2B_00000006']);
    expect(available.every((row) => row.field === null)).toBe(true);
    expect(evidence.text_rows[0]).toEqual({
      key: 'WizQst1A2B_00000000',
      value: 'Fixture line 0',
      category: 'WizQst1A2B',
      used_by_this_file: true,
      field: 'm_goals[0].m_dialogList.m_dialogs[0].m_dialogEntries[0].m_dialog',
    });

    // goal_gates: one gated reference grouped by (name, status), and one ungated counted.
    expect(evidence.goal_gates).toEqual([
      {
        goal_name: 'Fix_Goal1',
        required_status: 'Completed',
        refs: [{ wad: 'FixtureZone.wad', entry: 'triggers.xml', class: 'WizZoneTriggers' }],
      },
    ]);
    expect(evidence.warnings).toContain(
      '1 referencing object carries no goal gate; it is counted here rather than shown as a gate',
    );
  });

  it('resolves every REFERENCE_FIELDS occurrence and renders it through the one display rule', () => {
    const { db, index } = harness();
    const evidence = found(questEvidenceByName({ db, index }, 'P6-EVIDENCE-001'));

    const byField = new Map(evidence.references.map((reference) => [reference.field, reference]));
    expect([...byField.keys()].sort()).toEqual([
      'm_goals[0].m_dialogList.m_dialogs[0].m_dialogEntries[5].m_actorTemplateID',
      'm_goals[1].m_destinationZone',
      'm_goals[1].m_zoneTag',
      'm_goals[2].m_destinationZone',
      'm_results[0].m_templateID',
      'm_results[1].m_spellID',
      'm_results[1].m_templateID',
    ]);

    // A zone path resolves and renders as the pair `display_name (zone_path)` — the display
    // rule, not a humanised guess.
    expect(byField.get('m_goals[1].m_destinationZone')).toEqual({
      field: 'm_goals[1].m_destinationZone',
      value: 'FixtureCity/Fix_Zone',
      key: 'm_destinationZone',
      sources: ['zones'],
      kind: 'zones',
      resolved: {
        label: 'Fixture City / Fix Zone',
        display: 'Fixture City / Fix Zone (FixtureCity/Fix_Zone)',
      },
    });
    // A spell id resolves as the friendly name alone: `formatNameRow('spells', …)` pairs nothing.
    expect(byField.get('m_results[0].m_templateID')?.resolved).toEqual({
      label: 'Fixture Spell',
      display: 'Fixture Spell',
    });
    // `m_templateID` is the same key on two owners with different sources: `ResLearnSpell` is a
    // spell, `ResGiveSpell` an NPC (REFERENCE_FIELDS' owner set, not one lookup for the key name).
    expect(byField.get('m_results[0].m_templateID')?.sources).toEqual(['spells']);
    expect(byField.get('m_results[1].m_templateID')).toMatchObject({
      sources: ['npcs'],
      kind: 'npcs',
      // `label` is the friendly half, `display` the one display rule's rendering of the pair.
      resolved: { label: 'Fixture Villain', display: 'Fixture Villain (9001)' },
    });
    // The miss is reported as a reference with no resolution *and* as a warning.
    expect(byField.get('m_goals[2].m_destinationZone')?.resolved).toBeNull();
    expect(evidence.warnings).toContain(
      'unresolved reference: m_destinationZone value "FixtureCity/Not_Synced" is not in the zones table',
    );
  });
});

/* --------------------------------------------------------------- the ladder */

describe('the speaker ladder (ac1 — override → composed → template → raw)', () => {
  it('answers each rung and records which one did, with the camera name never used', () => {
    const { db, index } = harness();
    const evidence = found(questEvidenceByName({ db, index }, 'P6-EVIDENCE-001'));
    // Seven entries: six under `m_goals` (the sixth names no persona) and the one `m_dialogList`
    // ('Prep') entry, which is in the file but points at a **sibling** quest's table.
    expect(evidence.dialogue).toHaveLength(7);

    // Rung 2 — `NPCFormats_First_Last` composed from the persona's own components.
    expect(evidence.dialogue[0]?.speaker).toEqual({
      name: 'Cyrus Drake',
      source: 'composed',
      persona: 'FIXTURE-NPC01_Persona',
      override_key: null,
      st_key: 'NPCFormats_First_Last',
    });
    // The rung won *over* the persona's template name, which is deliberately different.
    expect(evidence.dialogue[0]?.speaker.name).not.toBe('Template Name Must Not Win');

    // Rung 1 — the override key, resolved through the string table in any category.
    expect(evidence.dialogue[1]?.speaker).toEqual({
      name: 'Ceren Nightchant',
      source: 'override',
      persona: 'FIXTURE-NPC02_Persona',
      override_key: 'WC-NPCs_00000027',
      st_key: null,
    });

    // Rung 2 falls through (no components) → rung 3, the persona's template name.
    expect(evidence.dialogue[2]?.speaker).toMatchObject({ name: 'Gamma', source: 'template' });

    // Rung 3 falls through (the persona is not in the index) → the raw string, counted below.
    expect(evidence.dialogue[3]?.speaker).toEqual({
      name: 'FIXTURE-ABSENT_Persona',
      source: 'raw',
      persona: 'FIXTURE-ABSENT_Persona',
      override_key: null,
      st_key: 'NPCFormats_First_Last',
    });
    expect(evidence.warnings).toContain(
      '1 dialogue line resolve to the raw persona string: "FIXTURE-ABSENT_Persona" is absent from the manifest index (first at line 3)',
    );

    // **The camera-name negative control.** Four of the five lines carry `m_cameraName: 'LOCATION'`,
    // and the first carries a name — so an implementation that scraped the camera hint would pass
    // line 0 and report `LOCATION` for the rest. Every speaker name is a name, and the camera value
    // is echoed separately for a reader to see what was not used.
    expect(evidence.dialogue.map((line) => line.camera_name)).toEqual([
      'Cinematic Camera - Cyrus Drake',
      'LOCATION',
      'LOCATION',
      'LOCATION',
      'LOCATION',
      'LOCATION',
      null,
    ]);
    expect(evidence.dialogue.map((line) => line.speaker.name)).toEqual([
      'Cyrus Drake',
      'Ceren Nightchant',
      'Gamma',
      'FIXTURE-ABSENT_Persona',
      'Fixture Villain',
      '', // an entry that names no persona at all
      'Cyrus Drake',
    ]);
    expect(evidence.dialogue.map((line) => line.speaker.source)).toEqual([
      'composed',
      'override',
      'template',
      'raw',
      'template',
      'raw',
      'composed',
    ]);
    // `own_table`: the five goal entries reference this quest's own table; the 'Prep' entry does
    // not, and says so instead of being filtered out or passed off as this quest's material.
    expect(evidence.dialogue.map((line) => line.own_table)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false, // names no persona and no dialog key
      false, // the 'Prep' entry, whose key is a sibling table's
    ]);
    expect(evidence.dialogue[6]).toMatchObject({
      field: 'm_dialogList.m_dialogs[0].m_dialogEntries[0]',
      dialog_key: 'WizQst9999_00000000',
      text: 'Sibling quest prep line',
      own_table: false,
    });

    // **The `m_actorTemplateID` negative control.** The seventh line names no persona and carries
    // a positive actor template id (9001 → "Fixture Villain"). The spec's ladder has no "name the
    // speaker from the actor template" rung and this story did not invent one: the id is echoed as
    // data, the name stays the empty raw persona, and the miss is counted separately from the
    // manifest-missing count.
    expect(evidence.dialogue[5]?.actor_template_id).toBe(9001);
    expect(evidence.dialogue[5]?.speaker.name).toBe('');
    expect(evidence.dialogue[5]?.speaker.name).not.toBe('Fixture Villain');
    expect(evidence.warnings).toContain(
      '1 dialogue line names no persona (m_personaName is empty) and no override or composed name resolved, so no speaker name could be resolved',
    );
    // The manifest-missing count is exactly the one non-empty unplaced persona.
    expect(
      evidence.warnings.filter((warning) => warning.includes('absent from the manifest index')),
    ).toEqual([
      '1 dialogue line resolve to the raw persona string: "FIXTURE-ABSENT_Persona" is absent from the manifest index (first at line 3)',
    ]);
    expect(evidence.dialogue.some((line) => line.speaker.name === 'LOCATION')).toBe(false);

    // The other columns of a dialogue row.
    expect(evidence.dialogue[0]).toMatchObject({
      index: 0,
      field: 'm_goals[0].m_dialogList.m_dialogs[0].m_dialogEntries[0]',
      dialog_key: 'WizQst1A2B_00000000',
      text: 'Fixture line 0',
      portrait: 'GUI/NpcPortraits/Portrait_Fixture.dds',
      sound: '|Sound_Dialogue_005|WorldData|Sound/Dialogue/Fixture_005_01.mp3',
    });
  });

  it('composes the two measured NPCFormats spans and refuses a format it cannot fill', () => {
    // The measured strings (`docs/evidence/quest-catalog-findings.md` Measurement 5). The literal
    // text between the placeholders is preserved — the name is not rebuilt by joining tokens.
    expect(
      composeSpeakerName('#1:$NPC_FIRSTNAME$ #2:$NPC_LASTNAME$', {
        first: 'Cyrus',
        last: 'Drake',
        title: null,
      }),
    ).toBe('Cyrus Drake');
    expect(
      composeSpeakerName('#1:$NPC_FIRSTNAME$', { first: 'Gamma', last: null, title: null }),
    ).toBe('Gamma');
    // A placeholder with no component → the rung cannot answer (never a half-filled string).
    expect(
      composeSpeakerName('#1:$NPC_FIRSTNAME$ #2:$NPC_LASTNAME$', {
        first: 'Cyrus',
        last: null,
        title: null,
      }),
    ).toBeNull();
    expect(
      composeSpeakerName('not a format', { first: 'Cyrus', last: null, title: null }),
    ).toBeNull();
    // `NPCFormats_First_Last_Title` needs a third component the corpus rarely carries.
    expect(
      composeSpeakerName('#1:$NPC_FIRSTNAME$ #2:$NPC_LASTNAME$ #3:$NPC_TITLE$', {
        first: 'Merle',
        last: 'Ambrose',
        title: null,
      }),
    ).toBeNull();
    expect(
      composeSpeakerName('#1:$NPC_FIRSTNAME$ #2:$NPC_LASTNAME$ #3:$NPC_TITLE$', {
        first: 'Merle',
        last: 'Ambrose',
        title: 'Professor',
      }),
    ).toBe('Merle Ambrose Professor');
  });
});

/* ------------------------------------------------------------- unknown arms */

describe('the unknown arms (ac3)', () => {
  it('answers `unknown` for a name the catalog does not hold, and for an unknown id', () => {
    const { db, index } = harness();
    expect(questEvidenceByName({ db, index }, 'NO-SUCH-QUEST').kind).toBe('unknown');
    expect(questEvidenceById({ db, index }, 424242).kind).toBe('unknown');
  });

  it('reports an id-only row with an honest title_source and no borrowed name', () => {
    const { db, index } = harness();
    const evidence = found(questEvidenceById({ db, index }, 7001));
    expect(evidence.quest).toEqual({
      quest_name: null,
      quest_id: 7001,
      has_definition: false,
      link_kind: 'none',
      title: null,
      title_source: 'none',
      inference_basis: null,
    });
    // Nothing references the rows of a quest that does not exist, so every row is available —
    // and the arm is empty rather than pretended.
    expect(evidence.text_rows).toEqual([]);
    expect(evidence.dialogue).toEqual([]);
    expect(evidence.text_rows).toEqual([]);
    expect(evidence.warnings).toContain(
      'quest id 7001 has no WizQst table in the string table, so text_rows is empty',
    );
  });

  it('reads title_source from the catalog column, and surfaces the basis beside an inferred label', () => {
    const { db, index } = harness();
    expect(found(questEvidenceById({ db, index }, 6699)).quest.title_source).toBe('direct');

    const inferred = found(questEvidenceById({ db, index }, 7003));
    expect(inferred.quest).toMatchObject({
      quest_name: 'P6-EVIDENCE-002',
      title_source: 'inferred',
      inference_basis: '{"method":"neighbour-midpoint"}',
      has_definition: false,
    });
  });

  it('does not conflate the evidence title_source with the quests list endpoint’s per-file field', async () => {
    const { db, index } = harness();
    // The evidence endpoint reports the catalog link's provenance.
    expect(found(questEvidenceByName({ db, index }, 'P6-EVIDENCE-001')).quest.title_source).toBe(
      'direct',
    );
    // The list endpoint reports its own per-file resolution for the same quest — `resolved`, not
    // `direct` (spec-data-model L209-214 records the collision).
    const listed = await listQuests({ db, spiraldbPath: FIXTURE_ROOT });
    const row = listed.quests.find((quest) => quest.quest_name === 'P6-EVIDENCE-001');
    expect(row?.title_source).toBe('resolved');
    expect(row?.title).toBe('Fixture Quest One');
  });
});

/* ----------------------------------------------------------------- the routes */

describe('the routes (ac3 — the 404s, with the spec’s error text)', () => {
  it('404s an unknown quest name with `Unknown quest "…"`', async () => {
    const { app } = harness();
    const res = await request(app).get('/api/quests/NOPE/evidence').expect(404);
    expect(res.body).toEqual({ error: 'Unknown quest "NOPE"' });
  });

  it('404s an unknown id — and a non-numeric one — with the same text', async () => {
    const { app } = harness();
    expect((await request(app).get('/api/quest-ids/424242/evidence').expect(404)).body).toEqual({
      error: 'Unknown quest "424242"',
    });
    expect(
      (await request(app).get('/api/quest-ids/not-a-number/evidence').expect(404)).body,
    ).toEqual({ error: 'Unknown quest "not-a-number"' });
  });

  it('serves the id tier and the name tier through their routes', async () => {
    const { app } = harness();
    const byName = await request(app).get('/api/quests/P6-EVIDENCE-001/evidence').expect(200);
    expect(byName.body.quest).toMatchObject({ quest_name: 'P6-EVIDENCE-001', quest_id: 6699 });

    const byId = await request(app).get('/api/quest-ids/7001/evidence').expect(200);
    expect(byId.body.quest).toMatchObject({ quest_name: null, title_source: 'none' });
  });

  it('404s an unknown NPC with `Unknown NPC "…"`', async () => {
    const { app } = harness();
    const res = await request(app).get('/api/npcs/NOPE').expect(404);
    expect(res.body).toEqual({ error: 'Unknown NPC "NOPE"' });
  });
});

/* --------------------------------------------------------------- the NPC view */

describe('the NPC view (carried from p6-06 — counts equal a direct query)', () => {
  it('answers one NPC’s personas, dialogs, quests and inventories, with matching counts', () => {
    const { db, index } = harness();
    const view = buildNpcView(db, index, '9001');
    expect(view).toBeDefined();
    if (view === undefined) {
      return;
    }

    expect(view).toMatchObject({
      npc_key: 'WC-NPCs_00000901',
      template_id: 9001,
      display_name: 'Fixture Villain',
      aliases: ['Fixture', 'Fixture Villain'],
    });

    // The persona index is the reverse of the ladder: this NPC's persona, by template id.
    expect(view.personas).toEqual([
      {
        persona_key: 'FIXTURE-VILLAIN-NPC_Persona',
        first: null,
        last: null,
        template_id: 9001,
      },
    ]);
    // …and the corpus scan finds two lines for this NPC: one that names its persona, and the
    // empty-persona entry that names it by `m_actorTemplateID` (the direct arm).
    expect(view.dialogs).toEqual([
      { quest_name: 'P6-EVIDENCE-001', index: 4, text: 'Fixture line 4' },
      { quest_name: 'P6-EVIDENCE-001', index: 5, text: null },
    ]);
    expect(view.quests).toEqual(['P6-EVIDENCE-001']);

    // Every count equals a direct query over the same rows.
    const directPersonas = db
      .prepare<[number], { c: number }>(
        'SELECT count(*) AS c FROM persona_index WHERE template_id = ?',
      )
      .get(9001)?.c;
    expect(view.counts.personas).toBe(directPersonas);
    // The direct query for *this* NPC's aliases: the alias-vocabulary rows whose value is one of
    // the strings the entity carries.
    const directAliases = db
      .prepare<[string, string], { c: number }>(
        `SELECT count(*) AS c FROM string_table
          WHERE category IN ('WC-NPCs','NPCs','WizardNPC','Persona,First','Persona, Last','Persona,Last')
            AND value IN (?, ?)`,
      )
      .get('Fixture', 'Fixture Villain')?.c;
    expect(view.counts.aliases).toBe(directAliases);
    expect(view.counts.dialogs).toBe(view.dialogs.length);
    expect(view.counts.quests).toBe(view.quests.length);
    expect(view.counts).toEqual({ aliases: 2, personas: 1, dialogs: 2, quests: 1 });

    // Inventories: the corpus file whose key is this NPC's template id.
    expect(view.inventories.npc_inventories).toEqual([
      { key: '9001', file: path.join('NpcInventory', 'npcInventories_fixture_9001.json') },
    ]);
    expect(view.inventories.npc_spell_inventories).toEqual([]);
    expect(view.inventories.npc_drop_tables).toEqual([]);
    // An empty arm that exists is an answer; an arm that cannot exist says so instead.
    expect(view.notes).toEqual([
      'inventories.npc_spell_inventories is empty because NpcSpellInventory/ does not exist in this corpus, not because no row matched.',
      'inventories.npc_drop_tables is empty because NpcDropTable/ does not exist in this corpus, not because no row matched.',
    ]);
  });

  it('accepts both key forms and answers the same entity', () => {
    const { db, index } = harness();
    const numeric = buildNpcView(db, index, '9001');
    const alias = buildNpcView(db, index, 'WC-NPCs_00000901');
    expect(numeric?.npc_key).toBe(alias?.npc_key);
    expect(alias?.template_id).toBe(9001);
    expect(alias?.counts).toEqual(numeric?.counts);
  });

  it('serves the view through its route, wrapped in `npc`', async () => {
    const { app } = harness();
    const res = await request(app).get('/api/npcs/9001').expect(200);
    expect(res.body.npc.counts).toEqual({ aliases: 2, personas: 1, dialogs: 2, quests: 1 });
    expect(res.body.npc.npc_key).toBe('WC-NPCs_00000901');
  });

  it('says why an alias-only entity’s arms are empty instead of claiming it has none', () => {
    const { db, index } = harness();
    // A name that resolves to no NPC template: `npcEntityById` still answers (to keep search
    // honest) with `template_id: null`, and no arm may be fabricated from it.
    seedString(db, 'WizardNPC_00000042', 'Nameless Fixture', 'WizardNPC');
    const view = buildNpcView(db, index, 'WizardNPC_00000042');
    expect(view?.template_id).toBeNull();
    expect(view?.personas).toEqual([]);
    expect(view?.dialogs).toEqual([]);
    expect(view?.quests).toEqual([]);
    expect(view?.notes[0]).toContain('alias-only entity with no template id');
  });
});
