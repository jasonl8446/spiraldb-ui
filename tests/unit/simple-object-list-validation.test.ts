import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import json5 from 'json5';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OBJECT_TYPES, objectTypeConfig } from '@shared/objectTypes';
import {
  CREATURE_SPELLBOOK_FIELDS,
  CREATURE_SPELLBOOK_LIST_KEY,
  NPC_DROP_TABLE_FIELDS,
  NPC_DROP_TABLE_LIST_KEY,
  NPC_INVENTORY_FIELDS,
  NPC_INVENTORY_LIST_KEY,
  NPC_SPELL_INVENTORY_FIELDS,
  NPC_SPELL_INVENTORY_LIST_KEY,
  TREASURE_CARD_INVENTORY_FIELDS,
  TREASURE_CARD_INVENTORY_LIST_KEY,
  ZONE_TRANSFER_FIELDS,
  ZONE_TRANSFER_LIST_KEY,
  LIST_ELEMENT_NULL_LABEL,
  nullListElementFindings,
  simpleListElementFieldErrorMap,
  simpleListElementMessage,
  simpleListElementSummary,
  type SimpleListElementFinding,
} from '@shared/simpleObjects';
import { DEFAULT_SPIRALDB_PATH } from '@server/db';
import { SIMPLE_OBJECT_FIELDS } from '@server/services/simpleObjectLists';

import {
  createTempGitRepo,
  removeTempGitRepo,
  repoFileExists,
  type TempRepo,
} from '../helpers/temp-git-repo';

/**
 * Final-review **F3** — the null/absent list-element guard.
 *
 * The verify pass measured the hole on `NpcDropTable.DropTableNames`:
 * `POST {TemplateID, DropTableNames: [null]}` answered **200** and committed
 * `"DropTableNames": [ null ]`. The sibling sweep measured the same shape in the other five
 * "one key + one list" families, so the rule is one implementation
 * (`shared/simpleObjects/listValidation.ts`) and one wiring
 * (`server/src/services/simpleObjectLists.ts`).
 *
 * Three arms, in the order the rule is built:
 *
 * 1. **The pure rule** — findings for `[null]` / a hole / several, and *nothing* for every shape
 *    it deliberately does not own (an absent or non-array field, a null nested inside an entry).
 * 2. **The real app** — `@server/app` (so the wiring in `server/src/routes/index.ts` is what is
 *    under test) against a throwaway git repo: a valid list is written, `[null]` is a 400 with
 *    the family's normal field map, and the refusal writes **nothing** (same HEAD, same bytes).
 * 3. **The corpus** — the measured claim the guard rests on: 0 null/absent elements and 0
 *    elements of the wrong kind across every present family, re-run whenever the checkout is on
 *    disk (D68: the guard is an `existsSync` boolean; nothing is read at collection time).
 */

const CORPUS_ROOT = process.env.SPIRALDB_SIMPLE_OBJECTS_ROOT ?? DEFAULT_SPIRALDB_PATH;

/** One family of the vocabulary: its route, its own list key, and a body for each arm. */
const FAMILIES = [
  {
    config: objectTypeConfig('npcdroptable'),
    fields: NPC_DROP_TABLE_FIELDS,
    listKey: NPC_DROP_TABLE_LIST_KEY,
    valid: { TemplateID: 87113, DropTableNames: ['DS-ACAD-C01-001'] },
    nulled: { TemplateID: 87113, DropTableNames: [null] },
    corpusDir: 'NpcDropTable',
    corpusKind: 'string',
  },
  {
    config: objectTypeConfig('npcinventory'),
    fields: NPC_INVENTORY_FIELDS,
    listKey: NPC_INVENTORY_LIST_KEY,
    valid: { TemplateID: 87112, Inventory: [126913] },
    nulled: { TemplateID: 87112, Inventory: [null] },
    corpusDir: 'NpcInventory',
    corpusKind: 'number',
  },
  {
    config: objectTypeConfig('npcspellinventory'),
    fields: NPC_SPELL_INVENTORY_FIELDS,
    listKey: NPC_SPELL_INVENTORY_LIST_KEY,
    valid: {
      TemplateID: 87112,
      Spells: [{ SpellTemplateID: 1001, RequiredSpellID: 0, SpellName: 'Fire' }],
    },
    nulled: { TemplateID: 87112, Spells: [null] },
    corpusDir: 'NpcSpellInventory',
    corpusKind: 'object',
  },
  {
    config: objectTypeConfig('creaturespellbook'),
    fields: CREATURE_SPELLBOOK_FIELDS,
    listKey: CREATURE_SPELLBOOK_LIST_KEY,
    valid: { DeckName: 'FV5-DECK', SpellTemplateIds: [1001] },
    nulled: { DeckName: 'FV5-DECK', SpellTemplateIds: [null] },
    corpusDir: 'CreatureSpellbook',
    corpusKind: 'number',
  },
  {
    config: objectTypeConfig('treasurecardinventory'),
    fields: TREASURE_CARD_INVENTORY_FIELDS,
    listKey: TREASURE_CARD_INVENTORY_LIST_KEY,
    valid: { TemplateID: 87112, TreasureCards: [{ SpellName: 'Fire', Price: 100 }] },
    nulled: { TemplateID: 87112, TreasureCards: [null] },
    corpusDir: 'TreasureCardInventory',
    corpusKind: 'object',
  },
  {
    config: objectTypeConfig('zonetransfer'),
    fields: ZONE_TRANSFER_FIELDS,
    listKey: ZONE_TRANSFER_LIST_KEY,
    valid: {
      ZoneName: 'FV5-Zone',
      Teleports: [
        {
          TriggerName: 'T',
          Teleport: {
            m_destinationZone: 'Z',
            m_destinationLoc: 'Target location Landing',
            m_exitTeleporter: 0,
            m_teleporterTag: 0,
            m_teleportType: 'TELEPORT_STATIC',
            m_transitionID: 0,
          },
        },
      ],
    },
    nulled: { ZoneName: 'FV5-Zone', Teleports: [null] },
    corpusDir: 'ZoneTransfer',
    corpusKind: 'object',
  },
] as const;

const REPOS: TempRepo[] = [];
let app: Express;
let repo: TempRepo;

/* --------------------------------------------------------------- 1. the pure rule */

describe('nullListElementFindings: the presence rule', () => {
  const FIELDS = NPC_DROP_TABLE_FIELDS;
  const KEY = NPC_DROP_TABLE_LIST_KEY;

  it('finds every null and absent element, in element order, with its own path', () => {
    const findings = nullListElementFindings(FIELDS, {
      TemplateID: 1,
      [KEY]: ['A', null, 'B', undefined],
    });
    expect(findings.map((finding) => finding.path)).toEqual([
      [KEY, 1],
      [KEY, 3],
    ]);
    expect(findings.map((finding) => finding.index)).toEqual([1, 3]);
    expect(findings.every((finding) => finding.severity === 'error')).toBe(true);
    expect(findings.every((finding) => finding.kind === 'list-element-null')).toBe(true);
    expect(findings[0]?.key).toBe(KEY);
    expect(findings[0]?.value).toBeNull();
    expect(findings[1]?.value).toBeUndefined();
  });

  it('reports nothing for a list with no null element — including a real name-like value', () => {
    expect(
      nullListElementFindings(FIELDS, { TemplateID: 1, [KEY]: ['A', '', ' WC-A ', 'A'] }),
    ).toEqual([]);
    expect(nullListElementFindings(FIELDS, { TemplateID: 1, [KEY]: [] })).toEqual([]);
  });

  it('leaves the shapes it does not own alone (absent field, null field, non-array, nested null)', () => {
    // The whole field being absent/null/not an array is the readers' "no list here" shape, and
    // D57 keeps it as the file wrote it (the rule module's doc-comment).
    expect(nullListElementFindings(FIELDS, { TemplateID: 1 })).toEqual([]);
    expect(nullListElementFindings(FIELDS, { TemplateID: 1, [KEY]: null })).toEqual([]);
    expect(nullListElementFindings(FIELDS, { TemplateID: 1, [KEY]: 'A,B' })).toEqual([]);
    // A null nested *inside* an entry is that entry's field — the family's own rules' business.
    expect(
      nullListElementFindings(ZONE_TRANSFER_FIELDS, {
        ZoneName: 'Z',
        [ZONE_TRANSFER_LIST_KEY]: [{ TriggerName: null, Teleport: { m_destinationZone: null } }],
      }),
    ).toEqual([]);
  });

  it('reads the list fields of the family inventory and skips the scalar ones', () => {
    // The key field itself is a select, not a list: a null `TemplateID` is the generic key
    // check's business, never this rule's.
    expect(nullListElementFindings(NPC_INVENTORY_FIELDS, { TemplateID: null })).toEqual([]);
    // And every family's inventory names its own list — the routing table pin below relies on it.
    for (const family of FAMILIES) {
      expect(family.fields.map((field) => field.key)).toContain(family.listKey);
    }
  });

  it('keys the 400 field map by the rendered path and words the summary with its count', () => {
    const findings = nullListElementFindings(FIELDS, { TemplateID: 1, [KEY]: [null, null] });
    const map = simpleListElementFieldErrorMap(findings);
    expect(Object.keys(map)).toEqual([`${KEY}[0]`, `${KEY}[1]`]);
    expect(map[`${KEY}[0]`]).toHaveLength(1);
    expect(map[`${KEY}[0]`]?.[0]).toContain('Every element must be present');
    expect(map[`${KEY}[0]`]?.[0]).not.toContain(KEY);

    const one: readonly SimpleListElementFinding[] = findings.slice(0, 1);
    expect(simpleListElementSummary(one, 'NPC Drop Tables')).toContain(
      'NPC Drop Tables validation failed with 1 validation error',
    );
    expect(simpleListElementSummary(findings, 'NPC Drop Tables')).toContain(
      'validation failed with 2 validation errors',
    );
    expect(simpleListElementSummary(findings, 'NPC Drop Tables')).toContain(
      `(${LIST_ELEMENT_NULL_LABEL})`,
    );
  });

  it('says `null` for a null and `absent` for a hole, naming the value not the path', () => {
    const nullFindings = nullListElementFindings(FIELDS, { TemplateID: 1, [KEY]: [null] });
    const absentFindings = nullListElementFindings(FIELDS, { TemplateID: 1, [KEY]: [undefined] });
    expect(simpleListElementMessage(nullFindings[0] as SimpleListElementFinding)).toContain(
      'element is null',
    );
    expect(simpleListElementMessage(absentFindings[0] as SimpleListElementFinding)).toContain(
      'element is absent',
    );
  });
});

/* ------------------------------------------------------------ 2. the routing table */

describe('the routing table names the six families and the right inventory for each', () => {
  it('covers exactly the six "one key + one list" families, and not the two that have their own paths', () => {
    expect(Object.keys(SIMPLE_OBJECT_FIELDS).sort()).toEqual(
      [
        'creaturespellbook',
        'npcdroptable',
        'npcinventory',
        'npcspellinventory',
        'treasurecardinventory',
        'zonetransfer',
      ].sort(),
    );
    // DropTable has its own four-rule validator and GlobalRegistry no list at all, so neither
    // may be in this table (routes/index.ts gives DropTable its own validator first).
    expect(SIMPLE_OBJECT_FIELDS.droptable).toBeUndefined();
    expect(SIMPLE_OBJECT_FIELDS.globalregistry).toBeUndefined();
  });

  it('points each family at its own inventory — the list key every arm below posts through', () => {
    for (const family of FAMILIES) {
      const fields = SIMPLE_OBJECT_FIELDS[family.config.fileType];
      expect(fields?.map((field) => field.key)).toEqual(family.fields.map((field) => field.key));
      expect(fields?.map((field) => field.key)).toContain(family.listKey);
      // And the row the router mounts is one of the eight spec families (a typo cannot mount a
      // guard on nothing).
      expect(OBJECT_TYPES.some((row) => row.fileType === family.config.fileType)).toBe(true);
    }
  });
});

/* ---------------------------------------------------------------- 3. the real app */

beforeAll(async () => {
  repo = createTempGitRepo('fv5-list-guard-');
  REPOS.push(repo);
  // Hermetic: an in-memory database and a throwaway repository, both read at the first request
  // (never at import time), so no arm here can reach the owner's database or fork (D17/D32).
  process.env.SPIRALDB_UI_DB = ':memory:';
  process.env.SPIRALDB_PATH = repo.dir;
  process.env.USER_NAME = 'FV5 List Guard';
  const { app: created } = await import('@server/app');
  app = created;
});

afterAll(() => {
  while (REPOS.length > 0) {
    const finished = REPOS.pop();
    if (finished !== undefined) {
      removeTempGitRepo(finished);
    }
  }
});

describe('POST through the real app: a valid list writes, a null element is refused', () => {
  it('the measured before/after arm, on the family the finding names', async () => {
    const npcdroptable = FAMILIES[0];
    const file = 'NpcDropTable/npcdroptable_87113.json';

    const valid = await request(app)
      .post(npcdroptable.config.urlPath)
      .send({ object: npcdroptable.valid })
      .expect(200);
    expect(valid.body.outcome).toBe('created');
    expect(repoFileExists(repo, file)).toBe(true);

    const headBefore = repo.git(['log', '--format=%H', '-1']).trim();
    const bytesBefore = readFileSync(path.join(repo.dir, file), 'utf8');

    const refused = await request(app)
      .post(npcdroptable.config.urlPath)
      .send({ object: npcdroptable.nulled })
      .expect(400);
    expect(refused.body.error).toBe(
      `${npcdroptable.config.label} validation failed with 1 validation error (${LIST_ELEMENT_NULL_LABEL}).`,
    );
    expect(refused.body.fields).toEqual({
      [`${npcdroptable.listKey}[0]`]: [
        simpleListElementMessage(
          nullListElementFindings(npcdroptable.fields, npcdroptable.nulled)[0],
        ),
      ],
    });

    // The refusal happened before the pipeline: no commit, no byte changed, no status row.
    expect(repo.git(['log', '--format=%H', '-1']).trim()).toBe(headBefore);
    expect(readFileSync(path.join(repo.dir, file), 'utf8')).toBe(bytesBefore);
    expect(repo.git(['status', '--porcelain']).trim()).toBe('');
  });

  it('refuses a null element in every one of the six families, and writes nothing', async () => {
    for (const family of FAMILIES) {
      const valid = await request(app)
        .post(family.config.urlPath)
        .send({ object: family.valid })
        .expect(200);
      // `NpcDropTable`'s valid save already ran in the arm above, so this sweep asserts the
      // write itself rather than repeating the create/update distinction.
      expect(repoFileExists(repo, valid.body.file)).toBe(true);

      const headBefore = repo.git(['log', '--format=%H', '-1']).trim();
      const refused = await request(app)
        .post(family.config.urlPath)
        .send({ object: family.nulled })
        .expect(400);
      expect(refused.body.error).toContain(
        `${family.config.label} validation failed with 1 validation error`,
      );
      expect(Object.keys(refused.body.fields)).toEqual([`${family.listKey}[0]`]);

      expect(repo.git(['log', '--format=%H', '-1']).trim()).toBe(headBefore);
      expect(repo.git(['status', '--porcelain']).trim()).toBe('');
    }
  });
});

/* ---------------------------------------------------------------- 4. the corpus */

describe.runIf(existsSync(CORPUS_ROOT))('the corpus the guard cannot refuse (re-measured)', () => {
  it('has 0 null/absent elements and 0 elements of the wrong kind in every present family', () => {
    let values = 0;
    for (const family of FAMILIES) {
      const dir = path.join(CORPUS_ROOT, family.corpusDir);
      if (!existsSync(dir)) {
        continue;
      }
      const files = readdirSync(dir).filter((file) => file.endsWith('.json'));
      for (const file of files) {
        const doc = json5.parse(readFileSync(path.join(dir, file), 'utf8')) as Record<
          string,
          unknown
        >;
        const raw = doc[family.listKey];
        expect(Array.isArray(raw)).toBe(true);
        for (const value of raw as unknown[]) {
          values += 1;
          expect(value === null || value === undefined).toBe(false);
          if (family.corpusKind === 'object') {
            expect(typeof value).toBe('object');
            expect(Array.isArray(value)).toBe(false);
          } else {
            expect(typeof value).toBe(family.corpusKind);
          }
        }
      }
    }
    console.log(`[final-review F3 corpus] list values measured=${values} non-conforming=0`);
    expect(values).toBeGreaterThan(7000);
  });
});
