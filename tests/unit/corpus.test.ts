import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { parseLangBuffer, resolveLangKey } from '@server/services/sync/lang';
import {
  buildDropTableRows,
  buildQuestRows,
  buildZoneRows,
  humanizeZonePath,
  zoneWorld,
} from '@server/services/sync/corpus';
import { parseJsonLenient } from '@server/services/sync/json';

/**
 * Task 1.4d corpus-derived rows (p1-05-ac3, decision D21): `quests` from
 * `QuestTemplates/*.json`, `zones` from the `ZoneTransfer/` corpus, and
 * `drop_tables` from `DropTables/*.json`.
 *
 * Every real fixture keeps the shape the corpus actually has — including the
 * legacy **trailing commas** ([spec-data-model.md] L234-246) and the empty
 * `Events` array.
 */

const FIXTURES = fileURLToPath(new URL('../../server/test/fixtures/', import.meta.url));
const tempRoots: string[] = [];

function fixtureText(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf8');
}

function makeDir(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'spiraldb-corpus-'));
  tempRoots.push(root);
  for (const [relative, from] of Object.entries(files)) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(path.join(FIXTURES, from)));
  }
  return root;
}

afterAll(() => {
  for (const dir of tempRoots) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('lenient JSON reading (spec-data-model.md L234-246)', () => {
  it('recovers legacy files with trailing commas and still reads strict JSON', () => {
    expect(() => JSON.parse('{ "a": 1, }')).toThrow();
    expect(parseJsonLenient('{ "a": 1, }')).toEqual({ a: 1 });
    expect(parseJsonLenient('{"a":1}')).toEqual({ a: 1 });
  });

  it('reads the real quest fixture, which is not strict JSON', () => {
    const text = fixtureText('quest_DS-ACAD-C01-003.json');
    expect(() => JSON.parse(text)).toThrow();
    expect(parseJsonLenient(text)).toMatchObject({ m_questName: 'DS-ACAD-C01-003' });
  });
});

describe('zone display names (spec-domain-reference.md L700-702)', () => {
  it('humanizes a zone path', () => {
    expect(humanizeZonePath('WizardCity/WC_Hub')).toBe('Wizard City / WC Hub');
    // The spec's prose says "underscores and slashes to spaces", but its own
    // worked example also splits CamelCase (`WizardCity` → `Wizard City`) — the
    // example wins (reported as a doc inconsistency).
    expect(humanizeZonePath('WizardCity')).toBe('Wizard City');
    expect(humanizeZonePath('Krokotopia/KT_Chamber_Of_Fire')).toBe(
      'Krokotopia / KT Chamber Of Fire',
    );
  });

  it('derives the world from the first path segment', () => {
    expect(zoneWorld('WizardCity/WC_Hub')).toBe('WizardCity');
    expect(zoneWorld('WizardCity')).toBe('WizardCity');
  });
});

describe('buildQuestRows — corpus-derived quests (D21)', () => {
  it('resolves a hex title key, keeps a raw-key fallback and defaults a missing title', async () => {
    const dir = makeDir({
      'quest_hex.json': 'quest_hex_title_synthetic.json',
      'quest_trailing.json': 'quest_trailing_comma_synthetic.json',
      'quest_real.json': 'quest_DS-ACAD-C01-003.json',
    });

    const guide = parseLangBuffer(readFileSync(path.join(FIXTURES, 'en-US_QuestTitle.lang')));
    const result = await buildQuestRows({
      questTemplatesDir: dir,
      lookupTitle: (key) => resolveLangKey(key, guide.entries),
    });

    expect(result.files).toBe(3);
    expect(result.parseErrors).toEqual([]);
    expect(result.resolvedTitles).toBe(2);
    expect(result.rawKeyFallbacks).toBe(1);
    expect(result.missingTitles).toBe(0);

    const byName = new Map(result.rows.map((row) => [row.quest_name, row]));
    // Hex key 1ED8D → 126349 → "Quest for Perfection" (present in this revision).
    expect(byName.get('SYNTH-MAIN-001')).toMatchObject({
      title: 'Quest for Perfection',
      titleKey: 'QuestTitle_1ED8D',
      titleSource: 'resolved',
      level: 12,
      is_mainline: true,
    });
    // Real corpus file: hex key 1ED8A → 126346 → "Forged in Fire".
    expect(byName.get('DS-ACAD-C01-003')).toMatchObject({
      title: 'Forged in Fire',
      titleKey: 'QuestTitle_1ED8A',
      titleSource: 'resolved',
      level: 1,
      is_mainline: true,
    });
    // Legacy trailing comma is tolerated; unknown m_questLevel ⇒ null, no
    // m_mainline ⇒ false.
    expect(byName.get('SYNTH-SIDE-002')).toMatchObject({
      title: 'QuestTitle_MISSING_KEY',
      titleSource: 'rawKey',
      level: null,
      is_mainline: false,
    });
    expect(result.rawKeyFallbacks).toBe(1);
  });

  it('falls back to the raw key when the string table misses, and to m_questName when there is no title key', async () => {
    const dir = makeDir({
      'quest_hex.json': 'quest_hex_title_synthetic.json',
      'quest_no_title.json': 'item_skullriders_start_deser.json',
    });
    writeFileSync(
      path.join(dir, 'quest_no_title.json'),
      JSON.stringify({ m_questName: 'NO-TITLE-001', m_questLevel: 5, m_mainline: false }),
    );

    const result = await buildQuestRows({
      questTemplatesDir: dir,
      lookupTitle: () => undefined,
    });

    const byName = new Map(result.rows.map((row) => [row.quest_name, row]));
    expect(byName.get('SYNTH-MAIN-001')).toMatchObject({
      title: 'QuestTitle_1ED8D',
      titleSource: 'rawKey',
    });
    expect(byName.get('NO-TITLE-001')).toMatchObject({
      title: 'NO-TITLE-001',
      titleKey: null,
      titleSource: 'missing',
      level: 5,
    });
    expect(result.rawKeyFallbacks).toBe(1);
    expect(result.missingTitles).toBe(1);
  });

  it('deduplicates by m_questName and tolerates a missing directory', async () => {
    const dir = makeDir({
      'a.json': 'quest_hex_title_synthetic.json',
      'b.json': 'quest_hex_title_synthetic.json',
    });
    const result = await buildQuestRows({ questTemplatesDir: dir });
    expect(result.rows).toHaveLength(1);
    expect(result.files).toBe(2);

    const missing = await buildQuestRows({ questTemplatesDir: path.join(dir, 'nope') });
    expect(missing.rows).toEqual([]);
    expect(missing.parseErrors).toHaveLength(1);
  });
});

describe('buildZoneRows — corpus-derived zones (D21)', () => {
  it('collects ZoneName + every m_destinationZone, deduplicated and humanized', async () => {
    const dir = makeDir({
      'zonetransfer_10017-A.json': 'zonetransfer_10017-A.json',
      'zonetransfer_synthetic.json': 'zonetransfer_synthetic.json',
      // A duplicate of the first file under another name must not duplicate rows.
      'zonetransfer_10017-A-copy.json': 'zonetransfer_10017-A.json',
    });

    const result = await buildZoneRows({ zoneTransferDir: dir });

    expect(result.files).toBe(3);
    expect(result.parseErrors).toEqual([]);
    const paths = result.rows.map((row) => row.zone_path);
    expect(paths).toEqual([...paths].sort());
    expect(new Set(paths).size).toBe(paths.length);

    // 1 ZoneName + 7 distinct destinations from the real file, 2 from the
    // synthetic one (its Events entry carries no zone).
    expect(result.rows).toHaveLength(10);

    const byPath = new Map(result.rows.map((row) => [row.zone_path, row]));
    expect(byPath.get('DragonSpire/DS_A2_Battle/DS_A2Z3_Detention')).toEqual({
      zone_path: 'DragonSpire/DS_A2_Battle/DS_A2Z3_Detention',
      display_name: 'Dragon Spire / DS A2 Battle / DS A2Z3 Detention',
      world: 'DragonSpire',
    });
    expect(
      byPath.get('DragonSpire/DS_A2_Battle/Interiors/DS_Detention_Gauntlet_3Room01_Sub/3Room01_3')
        ?.display_name,
    ).toBe(
      'Dragon Spire / DS A2 Battle / Interiors / DS Detention Gauntlet 3Room01 Sub / 3Room01 3',
    );
    expect(byPath.get('WizardCity/WC_Synthetic_Hub')).toMatchObject({
      display_name: 'Wizard City / WC Synthetic Hub',
      world: 'WizardCity',
    });
    expect(byPath.get('WizardCity/WC_Synthetic_Interior')).toMatchObject({
      display_name: 'Wizard City / WC Synthetic Interior',
    });
  });

  it('finds a m_destinationZone nested inside Events', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'spiraldb-zones-'));
    tempRoots.push(dir);
    writeFileSync(
      path.join(dir, 'nested.json'),
      JSON.stringify({
        ZoneName: 'A/B',
        Events: [{ Event: { m_destinationZone: 'C/D_E' } }],
      }),
    );
    const result = await buildZoneRows({ zoneTransferDir: dir });
    expect(result.rows.map((row) => row.zone_path)).toEqual(['A/B', 'C/D_E']);
    expect(result.rows[1].display_name).toBe('C / D E');
  });
});

describe('buildDropTableRows — DropTables corpus (spec-data-model.md L121-126)', () => {
  it('reads Name and Description, and tolerates a missing Description', async () => {
    const dir = makeDir({
      'droptable_ds-acad1-c01-001.json': 'droptable_ds-acad1-c01-001.json',
      'droptable_synthetic.json': 'droptable_synthetic.json',
    });
    const result = await buildDropTableRows({ dropTablesDir: dir });

    expect(result.files).toBe(2);
    expect(result.parseErrors).toEqual([]);
    expect(result.rows).toEqual([
      { name: 'DS-ACAD1-C01-001', description: null },
      {
        name: 'SYNTHETIC-DROP-001',
        description: 'Synthetic drop table used by the 1.4d corpus tests',
      },
    ]);
  });
});
