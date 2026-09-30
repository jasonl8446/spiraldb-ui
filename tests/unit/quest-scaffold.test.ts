import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { MEMORY_DB, openDb, writeSettings, type Db } from '@server/db';
import { createQuestsRouter } from '@server/routes/quests';
import { createSavePipeline } from '@server/services/savePipeline';
import { readSpiraldbJson } from '@server/services/spiraldbFiles';
import { createSpiraldbIndex } from '@server/services/spiraldbIndex';
import { questEvidenceByName } from '@server/services/questEvidence';
import {
  assertQuestTemplateTarget,
  parseScaffoldRequest,
  QUEST_TEMPLATES_DIRECTORY,
  QuestScaffoldError,
  questTemplateTargetPath,
  resolveScaffoldBranch,
  scaffoldMetadataDescription,
  scaffoldQuest,
} from '@server/services/questScaffold';
import { NOT_COLLECTED_BREADTH } from '@server/services/sync/breadth';
import { NOT_COLLECTED } from '@server/services/sync/questCatalog';
import { runSync, type SyncDeps } from '@server/services/sync/execute';
import { serializeDoc } from '@shared/document';
import { QUEST_TEMPLATE_FIELDS, SaveQuestRequestSchema, TYPE_STRINGS } from '@shared/quest/index';
import { QuestTemplateSchema } from '@shared/quest/index';
import {
  buildQuestScaffold,
  QUEST_TEMPLATE_CORPUS_ORDER,
  type QuestScaffoldLinkKind,
} from '@shared/quest/scaffold';

import {
  CLONE,
  CLONE_QUEST_FILES,
  cloneAxes,
  cloneGit as git,
  resetClone,
  type CloneAxes,
} from '../helpers/clone-fixture';
import { createTempGitRepo, removeTempGitRepo, repoFileExists } from '../helpers/temp-git-repo';

/**
 * Story **p6-09** — scaffold-from-catalog (plan task 6.8; decisions D100/D101, criteria
 * p6-09-ac1…ac3).
 *
 * Three groups, and the third is the only one that touches the corpus:
 *
 * | group | what it proves | hermetic? |
 * |---|---|---|
 * | the document | the 36 keys in **corpus order** (not the schema's), the value profile, the direct-vs-inferred title, and validation by the **save pipeline's own schema** | yes |
 * | the writer | the target-path refusal with its **positive partner**, the metadata provenance, the create-vs-refuse rules, against a real `git init` repository | yes |
 * | the corpus | the emitter's order re-derived from the 322 frozen files, a real `runSync` flipping `has_definition` 0 → 1, the scaffolded **inferred** quest reaching the evidence service as `title_source: 'inferred'`, and the clone's restore on five axes | no — the D17 clone |
 *
 * ## ac1's split, stated where the test lives
 *
 * The **live Imlight boot** is task 6.11 / story p6-12's, and this file deliberately does
 * not attempt it: it owns the scaffold and its schema-validity (the file is validated by
 * `SaveQuestRequestSchema`, the same schema `POST /api/quests` validates with, and read
 * back through the same lenient reader the pipeline writes with), and it hands p6-12 the
 * reproduction — `npm run scaffold:quest -- --name <NAME>` against a named scratch
 * database and a clone. The measured reason the skeleton is shaped the way it is — what
 * the real `Imcodec.ObjectProperty` assembly does with a `m_dialogList` that has no
 * `$type`, and with a JSON `null` in a value-typed member — is in
 * `docs/evidence/phase-6/p6-09.md`'s probe (a throwaway project under
 * `data/__test-scratch__/p6-09-loadprobe`), not asserted here, because it needs the .NET
 * 10 store SDK and CI has no .NET at all (D55).
 *
 * ## D17 / the restore
 *
 * The only repository the third group writes to is the clone. The pipeline is handed the
 * clone path directly (never through a server, so `settings.spiraldb_path` — the D65(g)
 * hazard — cannot point at the owner's fork), and `settings.git_branch` is set to the
 * clone's **current** branch so the save commits *on* it rather than creating a session
 * branch from `main` (the D76(b) shape, where a `reset --hard` restores the commit but
 * leaves a branch behind). The restore is `git reset --hard <base>` in a `finally`, and
 * the five axes are compared before and after.
 */

/* ------------------------------------------------------------------ the document */

/** `Object.keys`, so an assertion compares the *emitted* order rather than the constant again. */
function documentKeys(link: { kind: QuestScaffoldLinkKind; titleKey?: string | null }): string[] {
  return Object.keys(buildQuestScaffold({ name: 'WC-TEST-MAIN-001', link }));
}

/**
 * The keys the scaffold writes as an explicit `null` — the corpus's own null set, measured
 * over the 320 canonical files (each of these is `null` in 320/320, except
 * `m_requirements`, which is `null` in the 8 files whose authored tree is absent and which
 * is therefore the skeleton's honest value).
 */
const NULL_KEYS = [
  'm_questInfo',
  'm_questPrep',
  'm_questUnderway',
  'm_questComplete',
  'm_requirements',
  'm_prepRequirements',
  'm_pruneRequirements',
  'm_clientTags',
  'm_missionDoors',
  'm_dynaMods',
  'm_defaultDialogAnimation',
  'm_questEffectInfoList',
  'm_behaviors',
] as const;

describe('p6-09 ac2 — the scaffold document', () => {
  it('emits 36 keys in the corpus order, which is not the schema’s declaration order', () => {
    const emitted = documentKeys({ kind: 'none' });
    expect(emitted).toEqual([...QUEST_TEMPLATE_CORPUS_ORDER]);
    expect(emitted).toHaveLength(36);

    // The independent definition of "36" is the schema's own field list: set-equal, so no
    // key is invented and (with the length) none is dropped.
    expect([...emitted].sort()).toEqual([...QUEST_TEMPLATE_FIELDS].sort());

    // The two orders genuinely differ, at these five positions — the assertion that makes
    // "corpus order" a claim rather than a synonym. `QUEST_TEMPLATE_FIELDS` (the spec field
    // table, which `client/src/lib/quest-info.ts`'s `QUEST_TOP_LEVEL_KEYS` also follows)
    // puts m_goalLogic/m_questLevel/… straight after m_pruneRequirements.
    expect(emitted.indexOf('m_prepAlways')).toBe(14);
    expect(emitted.indexOf('m_clientTags')).toBe(15);
    expect(emitted.indexOf('m_goalLogic')).toBe(16);
    expect(emitted[34]).toBe('m_activityType');
    expect(emitted[35]).toBe('m_behaviors');
    expect(isDeepStrictEqual(emitted, [...QUEST_TEMPLATE_FIELDS])).toBe(false);
    expect(QUEST_TEMPLATE_FIELDS.indexOf('m_goalLogic')).not.toBe(16);
    expect([...QUEST_TEMPLATE_FIELDS].indexOf('m_prepAlways')).toBeGreaterThan(16);
  });

  it('writes the skeleton values the corpus itself carries, with explicit nulls where it has them', () => {
    const quest = buildQuestScaffold({
      name: 'DM-GRAVE-MAIN-008',
      link: { kind: 'direct', titleKey: 'QuestTitle_1ED8D' },
    });

    // The name, the ticked title, and the id value the corpus is unanimous on.
    expect(quest.m_questName).toBe('DM-GRAVE-MAIN-008');
    expect(quest.m_questTitle).toBe('QuestTitle_1ED8D');
    expect(quest.m_questNameID).toBe(0);

    // Every null the corpus carries is present as an explicit null, and nothing else is.
    for (const key of NULL_KEYS) {
      expect(quest[key], key).toBeNull();
    }
    const nulls = Object.entries(quest)
      .filter(([, value]) => value === null)
      .map(([key]) => key);
    expect([...nulls].sort()).toEqual([...NULL_KEYS].sort());

    // Empty goals / results / dialog, in the corpus's own spellings.
    expect(quest.m_startGoals).toEqual([]);
    expect(quest.m_goals).toEqual([]);
    expect(quest.m_goalLogic).toEqual([]);
    expect(quest.m_startResults).toEqual({ m_results: [] });
    expect(quest.m_endResults).toEqual({ m_results: [] });
    expect(quest.m_dialogList).toEqual({
      $type: TYPE_STRINGS.ActorDialogList,
      m_dialogs: [],
    });

    // The value-typed keys the corpus never leaves null (322/322 and 320/320 measured)
    // carry the corpus's own scalar rather than a null: a null would still *load* — Imlight
    // deserializes with NullValueHandling.Ignore, so the CLR default is kept — but it would
    // be a byte shape no corpus file has. See the module header for the probe.
    expect(quest.m_prepAlways).toBe(false);
    expect(quest.m_isHidden).toBe(false);
    expect(quest.m_outdated).toBe(false);
    expect(quest.m_noQuestHelper).toBe(false);
    expect(quest.m_mainline).toBe(false);
    expect(quest.m_skipQHAutoSelect).toBe(false);
    expect(quest.m_forceInteraction).toBe(false);
    expect(quest.m_checkInventoryForCrafting).toBe(false);
    expect(quest.m_playAsYourPetNPC).toBe(false);
    expect(quest.m_questLevel).toBe(0);
    expect(quest.m_questRepeat).toBe(0);
    expect(quest.m_onStartQuestScript).toBe('');
    expect(quest.m_onEndQuestScript).toBe('');
    expect(quest.m_activityType).toBe('ACTIVITY_NotActivity');
  });

  it('has no top-level $type, and an annotated m_dialogList', () => {
    const quest = buildQuestScaffold({ name: 'WC-TEST-MAIN-001', link: { kind: 'none' } });
    expect(Object.prototype.hasOwnProperty.call(quest, '$type')).toBe(false);
    // The nested annotation is what carries m_dialogs: without it Json.NET binds the wrapper
    // to ActorDialogListBase, which has no m_dialogs member (measured on the real assembly).
    expect((quest.m_dialogList as Record<string, unknown>).$type).toBe(
      TYPE_STRINGS.ActorDialogList,
    );
  });

  it('writes m_questTitle only for a direct link that resolved exactly one key', () => {
    const cases: Array<[QuestScaffoldLinkKind, string | null, string | null]> = [
      // kind, the key the catalog resolved, the value the file must carry
      ['direct', 'QuestTitle_173223', 'QuestTitle_173223'],
      // a direct link the catalog could not pin to one key writes nothing (10 of the
      // clone's 285 direct links are like this: two QuestTitle keys share the text)
      ['direct', null, null],
      // an inferred link never writes a title, **even when a key was resolved** — which is
      // exactly the shape the real catalog hands the writer for LM-NIGHT-MAIN-009
      // (quest_ids.title_key = QuestTitle_173223, link_kind = inferred)
      ['inferred', 'QuestTitle_173223', null],
      ['none', 'QuestTitle_173223', null],
      ['none', null, null],
    ];
    for (const [kind, titleKey, expected] of cases) {
      const quest = buildQuestScaffold({ name: 'WC-TEST-MAIN-001', link: { kind, titleKey } });
      expect(quest.m_questTitle, `${kind}/${titleKey ?? 'null'}`).toBe(expected);
    }
  });

  it('validates against the corpus schema the save pipeline itself uses, and round-trips', () => {
    for (const link of [
      { kind: 'direct' as const, titleKey: 'QuestTitle_1ED8D' },
      { kind: 'inferred' as const, titleKey: null },
      { kind: 'none' as const, titleKey: null },
    ]) {
      const quest = buildQuestScaffold({ name: 'MB-YARD1-C01-001', link });
      // The quest document schema (task 3.1)…
      expect(QuestTemplateSchema.safeParse(quest).success, JSON.stringify(link)).toBe(true);
      // …and the POST /api/quests request schema the pipeline validates with — the criterion's
      // "validates against the corpus schema", not a hand-rolled check.
      expect(SaveQuestRequestSchema.safeParse({ quest }).success, JSON.stringify(link)).toBe(true);
      // The bytes the writer emits parse back to the same document, in the same key order.
      const written = serializeDoc(quest);
      const readBack = JSON.parse(written) as Record<string, unknown>;
      expect(isDeepStrictEqual(readBack, quest)).toBe(true);
      expect(Object.keys(readBack)).toEqual([...QUEST_TEMPLATE_CORPUS_ORDER]);
      expect(written.endsWith('\n')).toBe(true);
    }
  });

  it('refuses a nameless scaffold', () => {
    expect(() => buildQuestScaffold({ name: '', link: { kind: 'none' } })).toThrow(RangeError);
  });
});

/* -------------------------------------------------------------------- the writer */

describe('p6-09 ac3 — the target-path guard', () => {
  const root = '/tmp/spiraldb-ui-p6-09-root';
  const directory = path.join(root, QUEST_TEMPLATES_DIRECTORY);

  it('refuses any target path that is not directly inside QuestTemplates/', () => {
    // The resolved-target contract, on explicit paths: outside the family tree entirely,
    // in a sibling directory that merely shares the prefix, and in a nested subdirectory
    // the index would never scan.
    const refused = [
      path.join(root, 'evil.json'),
      path.join(root, '..', 'evil.json'),
      path.join(root, `${QUEST_TEMPLATES_DIRECTORY}Other`, 'questtemplates_x.json'),
      path.join(directory, 'questtemplates_a', 'questtemplates_b.json'),
    ];
    for (const target of refused) {
      expect(() => assertQuestTemplateTarget(root, 'x', target), target).toThrow(
        QuestScaffoldError,
      );
      try {
        assertQuestTemplateTarget(root, 'x', target);
      } catch (error) {
        expect((error as QuestScaffoldError).status).toBe(400);
        expect((error as Error).message).toContain('Refusing to scaffold');
        expect((error as Error).message).toContain(directory);
      }
    }
  });

  it('accepts the convention path — the positive partner of the refusal', () => {
    for (const name of ['DM-GRAVE-MAIN-008', 'WC-TUT-C03-002', 'LM-NIGHT-MAIN-009', 'a-b_c-001']) {
      const target = path.join(directory, `questtemplates_${name}.json`);
      expect(() => assertQuestTemplateTarget(root, name, target), name).not.toThrow();
    }
  });

  it('refuses every hostile name through the writer’s own path resolution', () => {
    // Both layers are composed here: `fileNameFor` refuses a key with a path separator, a
    // NUL, a `.json` suffix or a blank value, and the guard above checks the resolved
    // target. The writer converts a naming refusal into its own 400 so the route answers an
    // actionable message rather than a 500.
    const hostile = [
      'x/../../evil',
      './../evil',
      '../evil',
      'a/b',
      'a\\b',
      'evil.json',
      '',
      '  ',
      'a\0b',
    ];
    for (const name of hostile) {
      expect(() => questTemplateTargetPath(root, name), JSON.stringify(name)).toThrow(
        QuestScaffoldError,
      );
    }
    // Legitimate names resolve to the convention path, directly inside the directory.
    expect(questTemplateTargetPath(root, 'WC-TUT-C03-002')).toBe(
      path.join(directory, 'questtemplates_WC-TUT-C03-002.json'),
    );
  });
});

const repos: Array<ReturnType<typeof createTempGitRepo>> = [];

describe('p6-09 — the writer end to end', () => {
  afterAll(() => {
    while (repos.length > 0) {
      const repo = repos.pop();
      if (repo !== undefined) {
        removeTempGitRepo(repo);
      }
    }
  });

  /**
   * A throwaway repository with the settings a save needs, plus a catalog seeded with one
   * row. `link_kind`'s row and the `quest_ids`/`string_table` rows are the caller's.
   */
  function scaffoldRig(
    prefix: string,
    seed: (db: Db, root: string) => void,
  ): { repo: ReturnType<typeof createTempGitRepo>; db: Db } {
    const repo = createTempGitRepo(prefix);
    repos.push(repo);
    const db = openDb({ file: MEMORY_DB });
    writeSettings(db, { user_name: 'DeepSeek Harness (p6-09)', git_branch: 'main' });
    writeSettings(db, { spiraldb_path: repo.dir });
    seed(db, repo.dir);
    return { repo, db };
  }

  function runtime(db: Db, root: string) {
    const index = createSpiraldbIndex(root);
    index.rebuild();
    return { index, pipeline: createSavePipeline({ db, spiraldbPath: root, index }) };
  }

  it('writes the file + metadata + one commit for a direct link, and records the provenance', async () => {
    const { repo, db } = scaffoldRig('p6-09-direct-', (database) => {
      database
        .prepare(
          `INSERT INTO quests (quest_name, title, has_definition, link_kind, title_source)
           VALUES (?, ?, 0, 'direct', 'direct')`,
        )
        .run('DM-GRAVE-MAIN-008', 'Stakes and Stones');
      // The real catalog's own row for this name: the linked id carries the title key.
      database
        .prepare(
          `INSERT INTO quest_ids (quest_id, title_key, title, text_rows, matched_quest_name, link_kind)
           VALUES (?, ?, ?, ?, ?, 'direct')`,
        )
        .run(1520123, 'QuestTitle_1732E3', 'Stakes and Stones', 9, 'DM-GRAVE-MAIN-008');
    });

    const { index, pipeline } = runtime(db, repo.dir);
    const result = await scaffoldQuest({
      db,
      index,
      pipeline,
      name: 'DM-GRAVE-MAIN-008',
      notes: 'p6-09 test',
    });

    expect(result.link_kind).toBe('direct');
    expect(result.title_key).toBe('QuestTitle_1732E3');
    expect(result.file).toBe(`QuestTemplates/questtemplates_DM-GRAVE-MAIN-008.json`);
    expect(result.metadata).toBe('QuestMetadatas/questmetadata_DM-GRAVE-MAIN-008.json');
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    // The commit subject is the pipeline's own format; `notes` becomes its body.
    expect(result.commit_message.split('\n')[0]).toBe('spiraldb: create quest DM-GRAVE-MAIN-008');
    expect(result.commit_message).toContain('p6-09 test');
    // The writer does not touch the sync's column — it reports what it read.
    expect(result.has_definition_before).toBe(0);

    // The file on disk is the document, in corpus order, with the title key.
    const file = readSpiraldbJson(path.join(repo.dir, result.file)) as Record<string, unknown>;
    expect(Object.keys(file)).toEqual([...QUEST_TEMPLATE_CORPUS_ORDER]);
    expect(file.m_questTitle).toBe('QuestTitle_1732E3');
    expect(repoFileExists(repo, result.file)).toBe(true);

    // …and the companion metadata records the catalog provenance (ac2).
    const metadata = readSpiraldbJson(path.join(repo.dir, result.metadata as string)) as Record<
      string,
      unknown
    >;
    expect(metadata.Name).toBe('DM-GRAVE-MAIN-008');
    expect(metadata.Description).toBe(
      'Scaffolded from the quest catalog (link_kind: direct; title QuestTitle_1732E3).',
    );
    expect(metadata.CreatedBy).toBe('DeepSeek Harness (p6-09)');
    expect(repo.git(['log', '--format=%s', '-1']).trim()).toBe(
      'spiraldb: create quest DM-GRAVE-MAIN-008',
    );
  });

  it('writes no title for an inferred link even when the catalog holds a title key', async () => {
    const { repo, db } = scaffoldRig('p6-09-inferred-', (database) => {
      database
        .prepare(
          `INSERT INTO quests (quest_name, title, has_definition, link_kind, title_source)
           VALUES (?, ?, 0, 'inferred', 'inferred')`,
        )
        .run('LM-NIGHT-MAIN-009', 'Straight to The Wildlands');
      // The real catalog carries a title key for this inferred link — the writer must
      // ignore it (measured: quest_ids.title_key = QuestTitle_173223, link_kind = inferred).
      database
        .prepare(
          `INSERT INTO quest_ids (quest_id, title_key, title, text_rows, matched_quest_name, link_kind, inference_basis)
           VALUES (?, ?, ?, ?, ?, 'inferred', ?)`,
        )
        .run(
          1520163,
          'QuestTitle_173223',
          'Straight to The Wildlands',
          12,
          'LM-NIGHT-MAIN-009',
          '{"method":"neighbour-midpoint"}',
        );
    });

    const { index, pipeline } = runtime(db, repo.dir);
    const result = await scaffoldQuest({ db, index, pipeline, name: 'LM-NIGHT-MAIN-009' });

    expect(result.link_kind).toBe('inferred');
    expect(result.title_key).toBeNull();
    const file = readSpiraldbJson(path.join(repo.dir, result.file)) as Record<string, unknown>;
    expect(file.m_questTitle, 'an inferred title is never written (D106/P6-6)').toBeNull();
    // The key exists in the database and is deliberately not in the file.
    const stored = db
      .prepare('SELECT title_key FROM quest_ids WHERE matched_quest_name = ?')
      .get('LM-NIGHT-MAIN-009') as { title_key: string };
    expect(stored.title_key).toBe('QuestTitle_173223');

    const metadata = readSpiraldbJson(path.join(repo.dir, result.metadata as string)) as Record<
      string,
      unknown
    >;
    expect(metadata.Description).toBe(
      'Scaffolded from the quest catalog (link_kind: inferred; ' +
        'no title: only a direct link writes one, and this link is inferred).',
    );
  });

  it('recovers the title key from a unique reverse lookup when the id tier has no row', async () => {
    const { repo, db } = scaffoldRig('p6-09-reverse-', (database) => {
      database
        .prepare(
          `INSERT INTO quests (quest_name, title, has_definition, link_kind, title_source)
           VALUES (?, ?, 0, 'direct', 'direct')`,
        )
        .run('NV-NEWV-MAIN-013', 'Vive La Several Revolutions');
      database
        .prepare('INSERT INTO string_table (key, value, category) VALUES (?, ?, ?)')
        .run('QuestTitle_17D615', 'Vive La Several Revolutions', 'QuestTitle');
    });

    const { index, pipeline } = runtime(db, repo.dir);
    const result = await scaffoldQuest({ db, index, pipeline, name: 'NV-NEWV-MAIN-013' });
    expect(result.title_key).toBe('QuestTitle_17D615');
  });

  it('writes no title when two keys share the text (never a guess)', async () => {
    const { repo, db } = scaffoldRig('p6-09-ambiguous-', (database) => {
      database
        .prepare(
          `INSERT INTO quests (quest_name, title, has_definition, link_kind, title_source)
           VALUES (?, ?, 0, 'direct', 'direct')`,
        )
        .run('DM-BLACK-SIDE-002', 'The Great Esapery');
      const insert = database.prepare(
        'INSERT INTO string_table (key, value, category) VALUES (?, ?, ?)',
      );
      insert.run('QuestTitle_00002152', 'The Great Esapery', 'QuestTitle');
      insert.run('QuestTitle_00002208', 'The Great Esapery', 'QuestTitle');
    });

    const { index, pipeline } = runtime(db, repo.dir);
    const result = await scaffoldQuest({ db, index, pipeline, name: 'DM-BLACK-SIDE-002' });
    expect(result.title_key).toBeNull();
    const file = readSpiraldbJson(path.join(repo.dir, result.file)) as Record<string, unknown>;
    expect(file.m_questTitle).toBeNull();
  });

  it("writes the link's own key when two keys share the text, from quests.title_key (D182)", async () => {
    const { repo, db } = scaffoldRig('p7-15-title-key-', (database) => {
      database
        .prepare(
          `INSERT INTO quests (quest_name, title, has_definition, link_kind, title_source, title_key)
           VALUES (?, ?, 0, 'direct', 'direct', ?)`,
        )
        .run('DM-BLACK-SIDE-003', 'The Great Esapery', 'QuestTitle_00002208');
      const insert = database.prepare(
        'INSERT INTO string_table (key, value, category) VALUES (?, ?, ?)',
      );
      insert.run('QuestTitle_00002152', 'The Great Esapery', 'QuestTitle');
      insert.run('QuestTitle_00002208', 'The Great Esapery', 'QuestTitle');
    });

    const { index, pipeline } = runtime(db, repo.dir);
    const result = await scaffoldQuest({ db, index, pipeline, name: 'DM-BLACK-SIDE-003' });
    expect(result.title_key).toBe('QuestTitle_00002208');
    const file = readSpiraldbJson(path.join(repo.dir, result.file)) as Record<string, unknown>;
    expect(file.m_questTitle).toBe('QuestTitle_00002208');
  });

  it('refuses a path outside QuestTemplates/ before writing anything, and the same call succeeds with a legitimate name (the positive partner)', async () => {
    const { repo, db } = scaffoldRig('p6-09-guard-', (database) => {
      database
        .prepare(
          `INSERT INTO quests (quest_name, title, has_definition, link_kind, title_source)
           VALUES (?, ?, 0, 'none', 'none')`,
        )
        .run('HO-Maestro-C02-001', 'HO-Maestro-C02-001');
    });
    const { index, pipeline } = runtime(db, repo.dir);

    // 1. The refusal. A name carrying path segments normalises outside the family directory.
    const before = repo.git(['status', '--porcelain']);
    await expect(
      scaffoldQuest({ db, index, pipeline, name: 'x/../../evil' }),
    ).rejects.toMatchObject({ name: 'QuestScaffoldError', status: 400 });
    await scaffoldQuest({ db, index, pipeline, name: 'x/../../evil' }).catch((error: unknown) => {
      expect((error as Error).message).toContain('Refusing to scaffold "x/../../evil"');
      expect((error as Error).message).toContain('path separator');
    });

    // The refusal happened before any write: the tree is untouched and nothing appeared
    // outside QuestTemplates/.
    expect(repo.git(['status', '--porcelain'])).toBe(before);
    expect(existsSync(path.join(repo.dir, 'evil.json'))).toBe(false);
    expect(existsSync(path.join(repo.dir, '..', 'evil.json'))).toBe(false);
    expect(existsSync(path.join(repo.dir, QUEST_TEMPLATES_DIRECTORY))).toBe(false);

    // 2. The positive partner: the same call with a legitimate name writes the file. A guard
    //    that refused everything would pass step 1 and fail here.
    const ok = await scaffoldQuest({ db, index, pipeline, name: 'HO-Maestro-C02-001' });
    expect(ok.file).toBe('QuestTemplates/questtemplates_HO-Maestro-C02-001.json');
    expect(repoFileExists(repo, ok.file)).toBe(true);
    expect(Object.keys(readSpiraldbJson(path.join(repo.dir, ok.file)) as object)).toEqual([
      ...QUEST_TEMPLATE_CORPUS_ORDER,
    ]);
  });

  it('refuses an unknown catalog name (404) and a quest that already has a definition (409)', async () => {
    const { repo, db } = scaffoldRig('p6-09-refusals-', (database) => {
      database
        .prepare(
          `INSERT INTO quests (quest_name, title, has_definition, link_kind, title_source)
           VALUES (?, ?, 1, 'none', 'none')`,
        )
        .run('WC-TUT-C03-002', 'WC-TUT-C03-002');
    });
    const { index, pipeline } = runtime(db, repo.dir);

    await expect(scaffoldQuest({ db, index, pipeline, name: 'NOPE-001' })).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      scaffoldQuest({ db, index, pipeline, name: 'WC-TUT-C03-002' }),
    ).rejects.toMatchObject({ status: 409 });
    // Neither refusal wrote anything.
    expect(repo.git(['status', '--porcelain'])).toBe('');
  });

  it('validates the request body the way POST /api/quests validates its own', () => {
    // Task 7.7 (D141/D142) added three optional body fields; absent, they parse to "none".
    const none = { quest: undefined, catalogId: undefined, acceptedSuggestions: [] };
    expect(parseScaffoldRequest({ quest_name: ' DM-GRAVE-MAIN-008 ' })).toEqual({
      name: 'DM-GRAVE-MAIN-008',
      notes: undefined,
      ...none,
    });
    expect(parseScaffoldRequest({ quest_name: 'x', notes: 'body' })).toEqual({
      name: 'x',
      notes: 'body',
      ...none,
    });
    expect(parseScaffoldRequest({ quest_name: 'x', notes: null }).notes).toBeUndefined();
    for (const body of [null, [], 'x', {}, { quest_name: '' }, { quest_name: 7 }]) {
      expect(() => parseScaffoldRequest(body), JSON.stringify(body)).toThrow(QuestScaffoldError);
    }
    expect(() => parseScaffoldRequest({ quest_name: 'x', notes: 7 })).toThrow(/Invalid notes/);
  });

  it('describes the provenance for every link kind', () => {
    expect(scaffoldMetadataDescription({ kind: 'direct', titleKey: 'QuestTitle_1ED8D' })).toBe(
      'Scaffolded from the quest catalog (link_kind: direct; title QuestTitle_1ED8D).',
    );
    expect(scaffoldMetadataDescription({ kind: 'direct', titleKey: null })).toBe(
      'Scaffolded from the quest catalog (link_kind: direct; ' +
        'no title: the direct link resolved to no single title key).',
    );
    expect(scaffoldMetadataDescription({ kind: 'none', titleKey: null })).toContain(
      'link_kind: none',
    );
  });
});
/* -------------------------------------------------------------------- the corpus */

/**
 * The corpus half. The clone is the run's save corpus (D17) and the only repository this
 * test writes to; `settings.spiraldb_path` never enters the picture because the pipeline is
 * handed the clone path directly. `git` and `cloneAxes` come from
 * `tests/helpers/clone-fixture.ts`; the readiness check below stays here because the files *it*
 * needs are this suite's.
 */

function cloneReadiness(): { ok: boolean; reason: string } {
  if (!existsSync(path.join(CLONE, '.git'))) {
    return { ok: false, reason: `the D17 clone ${CLONE} is absent` };
  }
  if (!existsSync(path.join(CLONE, 'QuestTemplates'))) {
    return { ok: false, reason: `${CLONE}/QuestTemplates is absent` };
  }
  const porcelain = git(['status', '--porcelain']);
  if (porcelain.trim() !== '') {
    return { ok: false, reason: `${CLONE} has uncommitted changes (refusing to reset them)` };
  }
  return { ok: true, reason: '' };
}

const READINESS = ((): { ok: boolean; reason: string } => {
  try {
    return cloneReadiness();
  } catch (error) {
    return { ok: false, reason: String(error) };
  }
})();

if (!READINESS.ok) {
  console.warn(`[p6-09 corpus arms] skipping: ${READINESS.reason}`);
}

/** The axes captured before the write, for the restore. */
let axesBefore: CloneAxes | null = null;
let restorePoint: string | null = null;

afterAll(() => {
  resetClone(restorePoint);
});

/** The measured title the real catalog links to the inferred quest this test scaffolds. */
const INFERRED_QUEST = 'LM-NIGHT-MAIN-009';
const INFERRED_TITLE = 'Straight to The Wildlands';
const INFERRED_TITLE_KEY = 'QuestTitle_173223';

/** `QuestTitle.lang` carrying the one key the clone's sync needs (the real parser reads it). */
const QUEST_TITLE_LANG = Buffer.from(
  '\uFEFF' + '1:QuestTitle\r\n' + '173223\r\n\r\nStraight to The Wildlands\r\n',
  'utf16le',
);

/** The tree-side stages are fakes (CI has no .NET, D55); the corpus stage is the real one. */
function corpusSyncDeps(): Partial<SyncDeps> {
  return {
    resolveRevision: (() => ({
      revision: 'V_test',
      rootWadPath: '/fake/Root.wad',
      source: 'override',
    })) as unknown as SyncDeps['resolveRevision'],
    runUnpack: (async () => ({
      tempDir: '/fake/tree',
      reused: false,
      durationMs: 0,
      removed: false,
      kept: true,
      stdout: '',
    })) as unknown as SyncDeps['runUnpack'],
    loadTemplateManifest: (async () => ({
      byFile: new Map(),
      byId: new Map(),
      entries: 0,
    })) as unknown as SyncDeps['loadTemplateManifest'],
    scanLangDir: ((...args: Parameters<SyncDeps['scanLangDir']>) =>
      import('@server/services/sync/lang').then(({ scanLangDir }) =>
        scanLangDir(args[0], {
          deps: {
            readdir: async () => ['QuestTitle.lang'],
            readFile: async () => QUEST_TITLE_LANG,
          },
        }),
      )) as unknown as SyncDeps['scanLangDir'],
    scanTemplateTree: (async () => ({
      rows: [],
      items: [],
      spells: [],
      npcs: [],
      counts: {
        item: 0,
        spell: 0,
        npc: 0,
        pet: 0,
        mount: 0,
        scannedFiles: 0,
        skippedClasses: 0,
        parseErrors: 0,
        noName: 0,
        noNameByFamily: { item: 0, spell: 0, npc: 0, pet: 0, mount: 0 },
        noId: 0,
      },
      parseErrors: [],
      manifest: {
        entries: 0,
        assigned: 0,
        fallback: 0,
        mismatches: 0,
        missing: 0,
        mismatchSamples: [],
        missingSamples: [],
      },
    })) as unknown as SyncDeps['scanTemplateTree'],
    buildZoneRows: (async () => ({
      rows: [],
      files: 0,
      parseErrors: [],
    })) as unknown as SyncDeps['buildZoneRows'],
    buildDropTableRows: (async () => ({
      rows: [],
      files: 0,
      parseErrors: [],
    })) as unknown as SyncDeps['buildDropTableRows'],
    collectQuestCatalog: (async () => ({
      ...NOT_COLLECTED,
      message: 'p6-09 test: the catalog stage is skipped (no .NET in CI, D55)',
    })) as unknown as SyncDeps['collectQuestCatalog'],
    // Task 6.9's breadth stage is skipped for the same reason — and its absence must be
    // *harmless*: `zones` is then written from the corpus rows alone (the D21 behaviour), and
    // this arm's fake tree has no real `Data/GameData` to scope a WAD run to anyway.
    collectBreadth: (async () => ({
      ...NOT_COLLECTED_BREADTH,
      message: 'p6-09 test: the breadth stage is skipped (no .NET in CI, D55)',
    })) as unknown as SyncDeps['collectBreadth'],
  };
}

describe.skipIf(!READINESS.ok)('p6-09 — the corpus (the frozen D17 clone)', () => {
  it('re-derives the emitted key order from the 322 files: 320 canonical, 2 extractor-sparse', () => {
    const dir = path.join(CLONE, 'QuestTemplates');
    const names = execFileSync('bash', ['-c', `ls ${dir}/*.json`])
      .toString()
      .trim()
      .split('\n')
      .map((file) => path.basename(file));

    const orders = new Map<string, string[]>();
    const counts = new Map<string, number>();
    for (const name of names) {
      const text = readFileSync(path.join(dir, name), 'utf8');
      const parsed = JSON.parse(text.replace(/,\s*([}\]])/g, '$1')) as Record<string, unknown>;
      const keys = Object.keys(parsed as object);
      const order = keys.join(',');
      orders.set(order, keys);
      counts.set(order, (counts.get(order) ?? 0) + 1);
    }

    expect(names).toHaveLength(CLONE_QUEST_FILES);
    // Two distinct orders, and the dominant one is the constant the scaffold emits.
    expect([...counts.keys()]).toHaveLength(2);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    expect(ranked[0][1]).toBe(320);
    expect(orders.get(ranked[0][0])).toEqual([...QUEST_TEMPLATE_CORPUS_ORDER]);
    // The 2 deviants are the extractor's own sparse output, 18 keys each — the shapes ac2's
    // "all 36 keys ... with explicit nulls" is written against, not a scaffold target.
    expect(ranked[1][1]).toBe(2);
    expect(orders.get(ranked[1][0])).toHaveLength(18);
    const sparse = names.filter((name) => {
      const parsed = JSON.parse(
        readFileSync(path.join(dir, name), 'utf8').replace(/,\s*([}\]])/g, '$1'),
      ) as Record<string, unknown>;
      return Object.keys(parsed).length !== 36;
    });
    expect(sparse.sort()).toEqual([
      'questtemplates_WC-CYCLOPS-MAIN-002.json',
      'questtemplates_WC-UNICORN-MAIN-004.json',
    ]);
  });

  it('flips has_definition 0 → 1 on the next sync, on a real file the evidence service then reads as inferred', async () => {
    const base = git(['rev-parse', 'HEAD']).trim();
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    restorePoint = base;
    axesBefore = cloneAxes();
    expect(axesBefore.questFiles).toBe(CLONE_QUEST_FILES);

    const db = openDb({ file: MEMORY_DB });
    // D76(b): the save commits on the clone's **current** branch, so the reset has no
    // branch to leave behind. `spiraldb_path` is the clone (the pipeline is handed it
    // directly too, so the setting is only what the sync reads).
    writeSettings(db, {
      user_name: 'DeepSeek Harness (p6-09)',
      git_branch: branch,
      spiraldb_path: CLONE,
    });

    // The catalog row the real sync's catalog stage leaves for this name: an inferred link
    // with the key the id tier carries. Its values are measured from the run's real synced
    // catalog (docs/evidence/phase-6/p6-09.md).
    const seedCatalogRow = (): void => {
      db.prepare(
        `INSERT INTO quests (quest_name, title, has_definition, link_kind, title_source)
         VALUES (?, ?, 0, 'inferred', 'inferred')
         ON CONFLICT(quest_name) DO UPDATE SET
           link_kind = 'inferred', title_source = 'inferred'`,
      ).run(INFERRED_QUEST, INFERRED_TITLE);
    };
    seedCatalogRow();

    const before = db
      .prepare('SELECT has_definition FROM quests WHERE quest_name = ?')
      .get(INFERRED_QUEST) as { has_definition: number };
    expect(before.has_definition).toBe(0);
    expect(
      existsSync(path.join(CLONE, 'QuestTemplates', `questtemplates_${INFERRED_QUEST}.json`)),
    ).toBe(false);

    // 1. Scaffold the real file.
    const index = createSpiraldbIndex(CLONE);
    index.rebuild();
    const pipeline = createSavePipeline({ db, spiraldbPath: CLONE, index });
    const scaffolded = await scaffoldQuest({ db, index, pipeline, name: INFERRED_QUEST });
    expect(scaffolded.link_kind).toBe('inferred');
    expect(scaffolded.title_key).toBeNull();
    const onDisk = readSpiraldbJson(path.join(CLONE, scaffolded.file)) as Record<string, unknown>;
    expect(onDisk.m_questTitle).toBeNull();
    expect(Object.keys(onDisk)).toEqual([...QUEST_TEMPLATE_CORPUS_ORDER]);
    // The writer left the sync's column alone.
    const stillZero = db
      .prepare('SELECT has_definition FROM quests WHERE quest_name = ?')
      .get(INFERRED_QUEST) as { has_definition: number };
    expect(stillZero.has_definition).toBe(0);

    // 2. The next sync. A real `runSync` — the real corpus stage over the clone's files —
    //    with the .NET-dependent stages injected (weather CI has no .NET, D55). The catalog
    //    stage is `skipped`, so the row its merge would touch is re-seeded after the sync,
    //    and the file/corpus half is the real thing.
    const synced = await runSync({
      db,
      deps: corpusSyncDeps(),
      overrides: {
        spiraldbPath: CLONE,
        auroriumPath: '/fake/aurorium',
        imcodecPath: '/fake/imcodec',
      },
    });
    expect(synced.status).toBe('success');
    expect(synced.catalog.status).toBe('skipped');
    expect(synced.counts.quests).toBe(CLONE_QUEST_FILES + 1);
    seedCatalogRow();

    const after = db
      .prepare('SELECT has_definition, link_kind, title_source FROM quests WHERE quest_name = ?')
      .get(INFERRED_QUEST) as {
      has_definition: number;
      link_kind: string;
      title_source: string;
    };
    expect(after.has_definition, 'the file exists, so the next sync defines it').toBe(1);
    expect(after.link_kind).toBe('inferred');
    expect(after.title_source).toBe('inferred');

    const defined = db
      .prepare('SELECT count(*) AS value FROM quests WHERE has_definition = 1')
      .get() as { value: number };
    expect(defined.value).toBe(CLONE_QUEST_FILES + 1);

    // The sync's own string table (the real `scanLangDir` over a one-key QuestTitle.lang)
    // holds the title key — so "the key exists and is deliberately not in the file" is a
    // statement about two real tables, not about a fixture.
    expect(
      (
        db.prepare('SELECT value FROM string_table WHERE key = ?').get(INFERRED_TITLE_KEY) as
          { value: string } | undefined
      )?.value,
    ).toBe(INFERRED_TITLE);

    // 3. The carried question from p6-08: **no file-backed quest carried an inferred link**,
    //    so the inferred badge had no real editor surface. This one does now: a real
    //    QuestTemplates/ file with no m_questTitle, whose catalog row is inferred, read by
    //    the real evidence service the panel calls.
    const evidence = questEvidenceByName({ db, index }, INFERRED_QUEST);
    expect(evidence.kind).toBe('found');
    if (evidence.kind !== 'found') {
      return;
    }
    expect(evidence.evidence.quest).toMatchObject({
      quest_name: INFERRED_QUEST,
      has_definition: true,
      link_kind: 'inferred',
      title_source: 'inferred',
      // **The measured shape, and a consequence of D106 rather than a defect.**
      // The scaffolded file carries no `m_questTitle` (nothing inferred is ever written),
      // so the corpus scan cannot resolve a title and falls back to the name; the catalog
      // merge's `ON CONFLICT` deliberately updates only `link_kind`/`title_source`
      // (`sync/questCatalog.ts`), so the catalog's own resolved text does not come back.
      // The provenance survives, which is what the badge reads.
      title: INFERRED_QUEST,
    });
    // The same query for a corpus quest with no link is `none` — the badge is not on
    // everything.
    const plain = questEvidenceByName({ db, index }, 'WC-CYCLOPS-MAIN-002');
    expect(plain.kind).toBe('found');
    if (plain.kind === 'found') {
      expect(plain.evidence.quest.link_kind).toBe('none');
    }

    db.close();

    // 4. Restore, then prove all five axes plus the corpus shape and the ref list.
    resetClone(restorePoint);
    const axesAfter = cloneAxes();
    expect(axesAfter).toEqual(axesBefore);
    expect(axesAfter.questFiles).toBe(CLONE_QUEST_FILES);
    expect(axesAfter.porcelain).toBe('');
  });
});

/* --------------------------------------------------------------------- the route */

describe('p6-09 — POST /api/quests/scaffold (the surface task 6.10 calls)', () => {
  function routeHarness(): {
    app: import('express').Express;
    db: Db;
    root: string;
    repo: ReturnType<typeof createTempGitRepo>;
  } {
    const repo = createTempGitRepo('p6-09-route-');
    repos.push(repo);
    const db = openDb({ file: MEMORY_DB });
    writeSettings(db, { user_name: 'DeepSeek Harness (p6-09)', spiraldb_path: repo.dir });
    const app = express();
    app.use(express.json());
    app.use('/api/quests', createQuestsRouter({ db }));
    app.use('/api', (_req, res) => {
      res.status(404).json({ error: 'Not found' });
    });
    return { app, db, root: repo.dir, repo };
  }

  it('answers 200 with the scaffold result, 400/404/409 for the four refusals', async () => {
    const { app, db, repo } = routeHarness();
    db.prepare(
      `INSERT INTO quests (quest_name, title, has_definition, link_kind, title_source)
       VALUES ('HO-Maestro-C02-001', 'HO-Maestro-C02-001', 0, 'none', 'none'),
              ('WC-TUT-C03-002', 'WC-TUT-C03-002', 1, 'none', 'none')`,
    ).run();

    // 200 — the happy path, with the body the client's `scaffoldQuest` sends.
    const created = await request(app)
      .post('/api/quests/scaffold')
      .send({ quest_name: 'HO-Maestro-C02-001' });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      quest_name: 'HO-Maestro-C02-001',
      link_kind: 'none',
      title_key: null,
      has_definition_before: 0,
      file: 'QuestTemplates/questtemplates_HO-Maestro-C02-001.json',
      metadata: 'QuestMetadatas/questmetadata_HO-Maestro-C02-001.json',
    });
    expect(Object.keys(created.body.quest)).toEqual([...QUEST_TEMPLATE_CORPUS_ORDER]);
    expect(repoFileExists(repo, created.body.file)).toBe(true);

    // 400 — no name at all (the hand-written body check).
    const missing = await request(app).post('/api/quests/scaffold').send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error).toContain('Missing quest_name');

    // 404 — a name the catalog does not hold.
    const unknown = await request(app)
      .post('/api/quests/scaffold')
      .send({ quest_name: 'NOPE-001' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toContain('Unknown quest');

    // 409 — a quest that already has a definition.
    const defined = await request(app)
      .post('/api/quests/scaffold')
      .send({ quest_name: 'WC-TUT-C03-002' });
    expect(defined.status).toBe(409);
    expect(defined.body.error).toContain('already has a definition');

    // 400 — a name that would leave QuestTemplates/ (ac3 through the HTTP surface).
    const hostile = await request(app)
      .post('/api/quests/scaffold')
      .send({ quest_name: 'x/../../evil' });
    expect(hostile.status).toBe(400);
    expect(hostile.body.error).toContain('Refusing to scaffold');
  });
});

/* ---------------------------------------------------------------- the branch decision */

describe('p6-09 — which branch a scaffold commits to (the D76(b)-shaped trap)', () => {
  it('follows the checked-out branch when none is named, and moves the setting to it', () => {
    // The trap this story's own first CLI run hit: the scratch DB said content/2099-01-01 while
    // the tree sat on content/2026-09-27. Following the tree is the only choice that cannot
    // strand the branch's work, so the setting is moved and the caller is told.
    expect(
      resolveScaffoldBranch({
        settingsBranch: 'content/2099-01-01',
        currentBranch: 'content/2026-09-27',
      }),
    ).toEqual({ kind: 'use', branch: 'content/2026-09-27', updateSetting: true });

    // Already in agreement (or unset): nothing to write.
    expect(
      resolveScaffoldBranch({
        settingsBranch: 'content/2026-09-27',
        currentBranch: 'content/2026-09-27',
      }),
    ).toEqual({ kind: 'use', branch: 'content/2026-09-27', updateSetting: false });
    expect(resolveScaffoldBranch({ settingsBranch: '', currentBranch: 'main' })).toEqual({
      kind: 'use',
      branch: 'main',
      updateSetting: true,
    });
  });

  it('refuses a named branch that is not checked out, and says what to do instead', () => {
    const decision = resolveScaffoldBranch({
      settingsBranch: 'content/2026-09-27',
      currentBranch: 'content/2026-09-27',
      requested: 'main',
    });
    expect(decision.kind).toBe('refuse');
    if (decision.kind === 'refuse') {
      expect(decision.message).toContain('Refusing to scaffold on branch "main"');
      expect(decision.message).toContain('creates it from main');
      expect(decision.message).toContain('git -C <root> checkout main');
      expect(decision.message).toContain('drop --branch');
    }
    // Naming the checked-out branch is a no-op, and naming one with no repository context is
    // taken at face value (nothing can strand).
    expect(
      resolveScaffoldBranch({
        settingsBranch: 'main',
        currentBranch: 'main',
        requested: 'main',
      }),
    ).toEqual({ kind: 'use', branch: 'main', updateSetting: false });
    expect(
      resolveScaffoldBranch({ settingsBranch: '', currentBranch: '', requested: 'main' }),
    ).toEqual({ kind: 'use', branch: 'main', updateSetting: true });
  });

  it('names the setting as the remedy when the save pipeline is the caller (D182)', () => {
    const decision = resolveScaffoldBranch({
      settingsBranch: 'content/2099-01-01',
      currentBranch: 'content/2026-09-27',
      requested: 'content/2099-01-01',
      requestedFrom: 'setting',
    });
    expect(decision.kind).toBe('refuse');
    if (decision.kind === 'refuse') {
      expect(decision.message).toContain('Refusing to save on branch "content/2099-01-01"');
      expect(decision.message).toContain('the working tree is on "content/2026-09-27"');
      expect(decision.message).toContain('set git_branch to "content/2026-09-27" in Settings');
      expect(decision.message).not.toContain('--branch');
    }
  });

  it('allows a branch that is not checked out only while the tree is on main (D182)', () => {
    // From main the new branch starts with the contents the tree already has: nothing strands,
    // and the spec's session-branch creation keeps working.
    expect(
      resolveScaffoldBranch({
        settingsBranch: 'content/2099-01-01',
        currentBranch: 'main',
        requested: 'content/2099-01-01',
        requestedExists: false,
        requestedFrom: 'setting',
      }),
    ).toEqual({ kind: 'use', branch: 'content/2099-01-01', updateSetting: false });
  });

  it('exempts main only for a branch that does not exist yet (PR #14 review 2, D195)', () => {
    // An existing branch is *checked out*, not created from main: the tree becomes its content.
    for (const requestedFrom of ['setting', 'flag'] as const) {
      const decision = resolveScaffoldBranch({
        settingsBranch: 'content/2026-09-29',
        currentBranch: 'main',
        requested: 'content/2026-09-29',
        requestedExists: true,
        requestedFrom,
      });
      expect(decision.kind, requestedFrom).toBe('refuse');
      if (decision.kind === 'refuse') {
        expect(decision.message).toContain('the working tree is on "main"');
        expect(decision.message).toContain('"content/2026-09-29" already exists');
        expect(decision.message).toContain('replaces the tree with its contents');
        expect(decision.message).toContain('git -C <root> checkout content/2026-09-29');
      }
    }
    // Not knowing whether it exists is not an exemption: the caller must say (fail closed).
    expect(
      resolveScaffoldBranch({
        settingsBranch: '',
        currentBranch: 'main',
        requested: 'content/2026-09-29',
      }).kind,
    ).toBe('refuse');
  });

  it('has no opinion outside a git working tree', () => {
    expect(resolveScaffoldBranch({ settingsBranch: 'content/x', currentBranch: '' })).toEqual({
      kind: 'use',
      branch: 'content/x',
      updateSetting: false,
    });
  });
});
