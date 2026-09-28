import { afterEach, describe, expect, it } from 'vitest';

import { MEMORY_DB, openDb, type Db } from '@server/db';
import {
  ENGINE_OBJECT_TEMPLATE_MAX_ID,
  NPC_ALIAS_CATEGORIES,
  npcEntityById,
  searchNpcEntities,
} from '@server/services/npcNames';

/**
 * The NPC name namespace (P6-17/D112, story p6-06's "the NPC namespace").
 *
 * The one thing this module exists to prevent is the failure the phase's own risk table
 * names: *"one NPC carries several name strings at different granularities → the same NPC
 * appears as two or more entities, and a search for 'Gretta' returns duplicates"*. So the
 * suite's spine is the **measured** pair from
 * `docs/evidence/quest-catalog-findings.md` Measurement 5 —
 * `WC-NPCs_00000003 = "Gretta Darkkettle"` and `WC-NPCs_00000009 = "Gretta"` are the same
 * NPC — asserted as one entity carrying both strings, not as two rows.
 *
 * Every database is `:memory:` (D17); the live `data/spiraldb-ui.db` is never opened.
 */

const OPEN: Db[] = [];

afterEach(() => {
  while (OPEN.length > 0) {
    OPEN.pop()?.close();
  }
});

/** A `:memory:` database with the schema applied. */
function memoryDb(): Db {
  const db = openDb({ file: MEMORY_DB });
  OPEN.push(db);
  return db;
}

function seedNpc(db: Db, templateId: number, name: string): void {
  db.prepare('INSERT INTO npcs (template_id, name) VALUES (?, ?)').run(templateId, name);
}

function seedString(db: Db, key: string, value: string, category: string): void {
  db.prepare('INSERT INTO string_table (key, value, category) VALUES (?, ?, ?)').run(
    key,
    value,
    category,
  );
}

/** The measured Gretta pair plus Merle and Zarek, as the live tables hold them. */
function grettaDb(): Db {
  const db = memoryDb();
  seedNpc(db, 38098, 'Gretta Darkkettle');
  seedNpc(db, 38168, 'Merle Ambrose');
  seedNpc(db, 126322, 'Zarek Pickmaster');
  // The measured rows (Measurement 5): the full name and the first-name granularity.
  seedString(db, 'WC-NPCs_00000003', 'Gretta Darkkettle', 'WC-NPCs');
  seedString(db, 'WC-NPCs_00000009', 'Gretta', 'WC-NPCs');
  seedString(db, 'Persona,First_00000019', 'Gretta', 'Persona,First');
  seedString(db, 'NPCs_01748741', 'Gretta Darkkettle', 'NPCs');
  // Merle carries the same two granularities under the composition format's key pair.
  seedString(db, 'WC-NPCs_00000013', 'Merle Ambrose', 'WC-NPCs');
  seedString(db, 'WC-NPCs_00000014', 'Merle', 'WC-NPCs');
  // A persona component with no template behind it: an alias-only entry.
  seedString(db, 'Persona,First_00000020', 'Zarina', 'Persona,First');
  return db;
}

describe('the alias vocabulary', () => {
  it('is the three name categories plus the persona components', () => {
    // Hand-typed from Measurement 5 (WC-NPCs 2,641 / NPCs 2,450 / WizardNPC 1,237 rows).
    expect([...NPC_ALIAS_CATEGORIES]).toEqual([
      'WC-NPCs',
      'NPCs',
      'WizardNPC',
      'Persona,First',
      'Persona, Last',
      'Persona,Last',
    ]);
  });
});

describe('searchNpcEntities — keyed on the NPC, never on the string', () => {
  it('returns ONE entity for Gretta, carrying both measured strings as aliases', () => {
    const entities = searchNpcEntities(grettaDb(), 'Gretta', 20);

    expect(entities).toHaveLength(1);
    expect(entities[0]?.display_name).toBe('Gretta Darkkettle');
    expect(entities[0]?.template_id).toBe(38098);
    expect(entities[0]?.aliases).toEqual(['Gretta', 'Gretta Darkkettle']);
    // The representative key is the WC-NPCs row whose value is the full name — the form
    // the corpus references 1,733 times (NPCs_* is 7), so the entity's key is stable.
    expect(entities[0]?.npc_key).toBe('WC-NPCs_00000003');
  });

  it('finds the same single entity from either granularity', () => {
    const db = grettaDb();
    for (const q of ['Gretta', 'Gretta Darkkettle', 'Darkkettle', 'gReTtA']) {
      const entities = searchNpcEntities(db, q, 20);
      expect(
        entities.map((entity) => entity.display_name),
        q,
      ).toEqual(['Gretta Darkkettle']);
    }
  });

  it('resolves a first-name alias only as a whole token', () => {
    const db = grettaDb();
    // A string that is a *prefix* of the name but not a whole first token stays its own
    // entity (`template_id: null`): folding on substrings would merge unrelated aliases.
    seedString(db, 'WC-NPCs_00000099', 'Grett', 'WC-NPCs');
    const entities = searchNpcEntities(db, 'Grett', 20);
    expect(entities.map((entity) => [entity.display_name, entity.template_id])).toEqual([
      // The exact-alias entity ranks first…
      ['Grett', null],
      // …and the entity it is merely a substring of is still a *separate* entity with a
      // real template — which is the property the whole-token rule guarantees.
      ['Gretta Darkkettle', 38098],
    ]);
  });

  it('matches a template name that has no alias row at all', () => {
    const db = grettaDb();
    const entities = searchNpcEntities(db, 'Zarek', 20);
    expect(entities).toHaveLength(1);
    expect(entities[0]?.display_name).toBe('Zarek Pickmaster');
    expect(entities[0]?.template_id).toBe(126322);
    // With no alias-vocabulary row, the entity is keyed by its template id.
    expect(entities[0]?.npc_key).toBe('126322');
    expect(entities[0]?.aliases).toEqual(['Zarek Pickmaster']);
  });

  it('ranks an exact alias before a prefix before a substring, then by name and key', () => {
    const db = grettaDb();
    // 'Merle' is an exact alias of Merle Ambrose and a substring of 'Merle Doodlefish'.
    seedNpc(db, 1359577, 'Merle Doodlefish');
    const entities = searchNpcEntities(db, 'Merle', 20);
    expect(entities.map((entity) => entity.display_name)).toEqual([
      'Merle Ambrose',
      'Merle Doodlefish',
    ]);
  });

  it('keeps an alias-only name as its own entity, with no template', () => {
    const db = grettaDb();
    const entities = searchNpcEntities(db, 'Zarina', 20);
    expect(entities).toEqual([
      {
        npc_key: 'Persona,First_00000020',
        template_id: null,
        display_name: 'Zarina',
        aliases: ['Zarina'],
        alias_rows: [{ key: 'Persona,First_00000020', value: 'Zarina', category: 'Persona,First' }],
      },
    ]);
  });

  it('answers nothing for a blank query (the palette’s just-opened state)', () => {
    expect(searchNpcEntities(grettaDb(), '', 20)).toEqual([]);
    expect(searchNpcEntities(grettaDb(), '   ', 20)).toEqual([]);
  });

  it('honours the cap, so the caller can observe an overflow rather than assume it', () => {
    const db = grettaDb();
    seedNpc(db, 1359577, 'Merle Doodlefish');
    expect(searchNpcEntities(db, 'Merle', 1)).toHaveLength(1);
    expect(searchNpcEntities(db, 'Merle', 2)).toHaveLength(2);
  });

  it('keeps the engine block out of the namespace, so an id cannot name a prop', () => {
    const db = memoryDb();
    // The measured low-id block: engine infrastructure, not characters.
    seedNpc(db, 600, 'GenericCinematicActor');
    seedNpc(db, ENGINE_OBJECT_TEMPLATE_MAX_ID, 'Basic Ambient');
    seedNpc(db, ENGINE_OBJECT_TEMPLATE_MAX_ID + 1, 'Lydia Greyrose');
    seedString(db, 'WC-NPCs_00000001', 'Lydia Greyrose', 'WC-NPCs');

    // The alias resolves through the *name*, which only exists above the floor.
    const entities = searchNpcEntities(db, 'Lydia', 20);
    expect(entities).toHaveLength(1);
    expect(entities[0]?.template_id).toBe(ENGINE_OBJECT_TEMPLATE_MAX_ID + 1);
    expect(entities[0]?.npc_key).toBe('WC-NPCs_00000001');
    // …and an engine-object name is reachable only as its own string, never as a
    // resolvable template: it can never be *an NPC*, which is what the floor says.
    expect(npcEntityById(db, String(ENGINE_OBJECT_TEMPLATE_MAX_ID))).toBeUndefined();
    expect(npcEntityById(db, '600')).toBeUndefined();
  });
});

describe('npcEntityById — the two key forms the view accepts', () => {
  it('answers the same entity for the alias key and the template id', () => {
    const db = grettaDb();
    const byAliasKey = npcEntityById(db, 'WC-NPCs_00000003');
    const byTemplateId = npcEntityById(db, '38098');

    expect(byAliasKey).toBeDefined();
    expect(byTemplateId).toEqual(byAliasKey);
    expect(byTemplateId?.aliases).toEqual(['Gretta', 'Gretta Darkkettle']);
    // The spec's own example shape (spec-api L515-529).
    expect(byTemplateId?.npc_key).toBe('WC-NPCs_00000003');
    expect(byTemplateId?.template_id).toBe(38098);
    expect(byTemplateId?.display_name).toBe('Gretta Darkkettle');
  });

  it('resolves a first-name alias key to the full entity too', () => {
    const entity = npcEntityById(grettaDb(), 'WC-NPCs_00000009');
    expect(entity?.display_name).toBe('Gretta Darkkettle');
    expect(entity?.template_id).toBe(38098);
    expect(entity?.aliases).toEqual(['Gretta', 'Gretta Darkkettle']);
  });

  it('answers undefined — the 404 — for every form that does not resolve', () => {
    const db = grettaDb();
    // An unknown template id, an unknown alias key, and a non-alias-vocabulary key.
    expect(npcEntityById(db, '999999999')).toBeUndefined();
    expect(npcEntityById(db, 'WC-NPCs_99999999')).toBeUndefined();
    expect(npcEntityById(db, 'Not_A_Category_00000001')).toBeUndefined();
    // A malformed id is not an alias key either.
    expect(npcEntityById(db, '38098x')).toBeUndefined();
    // …and the engine floor is not an entity even though the row exists.
    const db2 = memoryDb();
    seedNpc(db2, 600, 'GenericCinematicActor');
    expect(npcEntityById(db2, '600')).toBeUndefined();
  });

  it('answers an alias-only entity from its own key', () => {
    const entity = npcEntityById(grettaDb(), 'Persona,First_00000020');
    expect(entity?.display_name).toBe('Zarina');
    expect(entity?.template_id).toBeNull();
    expect(entity?.npc_key).toBe('Persona,First_00000020');
  });
});

describe('the entity’s alias rows', () => {
  it('names every string-table row that resolved to it, key order', () => {
    const entity = npcEntityById(grettaDb(), '38098');
    expect(entity?.alias_rows.map((row) => row.key)).toEqual([
      'NPCs_01748741',
      'Persona,First_00000019',
      'WC-NPCs_00000003',
      'WC-NPCs_00000009',
    ]);
    // The rows carry their category, which is what a persona listing reads.
    expect(entity?.alias_rows.map((row) => row.category)).toEqual([
      'NPCs',
      'Persona,First',
      'WC-NPCs',
      'WC-NPCs',
    ]);
  });
});
