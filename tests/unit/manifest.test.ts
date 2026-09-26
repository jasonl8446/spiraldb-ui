import { describe, expect, it } from 'vitest';

import {
  MANIFEST_SAMPLE_LIMIT,
  TemplateManifestError,
  deserPathToManifestPath,
  loadTemplateManifest,
  manifestPathToDeserPath,
  normalizeManifestFilename,
  parseTemplateManifest,
} from '@server/services/sync/manifest';

/**
 * Task 1.4h / D35 — `TemplateManifest_deser.json` is the authoritative id source.
 *
 * The real file is 17 MB / 137,423 entries and is **never committed**, so every
 * test here drives either a synthetic document or an injected file reader.
 */

/** A small synthetic manifest document in the real file's shape. */
function syntheticDoc(templates: unknown[]): Record<string, unknown> {
  return {
    _fileName: 'TemplateManifest.xml',
    _className: 'TemplateManifest',
    _object: { m_serializedTemplates: templates },
  };
}

describe('manifest path helpers', () => {
  it('normalises backslashes, a leading ./ and surrounding whitespace', () => {
    expect(normalizeManifestFilename('Spells/Stun Block.xml')).toBe('Spells/Stun Block.xml');
    expect(normalizeManifestFilename('Spells\\Stun Block.xml')).toBe('Spells/Stun Block.xml');
    expect(normalizeManifestFilename('./Spells/Stun Block.xml')).toBe('Spells/Stun Block.xml');
    expect(normalizeManifestFilename('.\\ObjectData\\x.xml')).toBe('ObjectData/x.xml');
    expect(normalizeManifestFilename('  Spells/A.xml  ')).toBe('Spells/A.xml');
    expect(normalizeManifestFilename(undefined)).toBe('');
    expect(normalizeManifestFilename(42)).toBe('');
    expect(normalizeManifestFilename('')).toBe('');
  });

  it('maps <name>.xml ↔ <name>_deser.json both ways', () => {
    expect(manifestPathToDeserPath('Spells/Stun Block.xml')).toBe('Spells/Stun Block_deser.json');
    expect(deserPathToManifestPath('Spells/Stun Block_deser.json')).toBe('Spells/Stun Block.xml');
    // A path that already carries the other suffix is left alone.
    expect(manifestPathToDeserPath('Spells/x_deser.json')).toBe('Spells/x_deser.json_deser.json');
    expect(deserPathToManifestPath('Spells/x.xml')).toBe('Spells/x.xml');
  });
});

describe('parseTemplateManifest', () => {
  it('builds both maps and reports the entry/ids/files counts', () => {
    const manifest = parseTemplateManifest(
      syntheticDoc([
        { m_filename: 'Spells/Stun Block.xml', m_id: 1143963608 },
        { m_filename: 'ObjectData/PlayerObject.xml', m_id: 1 },
        { m_filename: 'Spells\\Conviction.xml', m_id: 2102149986 },
        { m_filename: './Spells/Death Shield.xml', m_id: 409737272 },
      ]),
    );

    expect(manifest.counts).toEqual({
      entries: 4,
      accepted: 4,
      rejected: 0,
      files: 4,
      ids: 4,
      duplicateFiles: 0,
      duplicateIds: 0,
    });
    expect(manifest.byFile.get('Spells/Stun Block.xml')).toBe(1143963608);
    expect(manifest.byFile.get('ObjectData/PlayerObject.xml')).toBe(1);
    expect(manifest.byFile.get('Spells/Conviction.xml')).toBe(2102149986);
    expect(manifest.byFile.get('Spells/Death Shield.xml')).toBe(409737272);
    expect(manifest.byId.get(1143963608)).toBe('Spells/Stun Block.xml');
    expect(manifest.rejectedSamples).toEqual([]);
    expect(manifest.duplicateSamples).toEqual([]);
  });

  it('is stable across two parses of the same document', () => {
    const doc = syntheticDoc([
      { m_filename: 'Spells/A.xml', m_id: 10 },
      { m_filename: 'Spells/B.xml', m_id: 20 },
      { m_filename: 'ObjectData/C.xml', m_id: 30 },
    ]);

    const first = parseTemplateManifest(doc);
    const second = parseTemplateManifest(JSON.parse(JSON.stringify(doc)));

    expect([...first.byFile.entries()]).toEqual([...second.byFile.entries()]);
    expect([...first.byId.entries()]).toEqual([...second.byId.entries()]);
    expect(first.counts).toEqual(second.counts);
  });

  it('keeps the first entry for a duplicate id or filename and counts both', () => {
    const manifest = parseTemplateManifest(
      syntheticDoc([
        { m_filename: 'Spells/A.xml', m_id: 10 },
        // Duplicate id, different file — first wins.
        { m_filename: 'Spells/A-copy.xml', m_id: 10 },
        // Duplicate filename, different id — first wins.
        { m_filename: 'Spells/A.xml', m_id: 99 },
      ]),
    );

    expect(manifest.counts).toMatchObject({
      entries: 3,
      accepted: 1,
      duplicateIds: 1,
      duplicateFiles: 1,
      ids: 1,
      files: 1,
    });
    expect(manifest.byFile.get('Spells/A.xml')).toBe(10);
    expect(manifest.byFile.has('Spells/A-copy.xml')).toBe(false);
    expect(manifest.byId.get(99)).toBeUndefined();
    expect(manifest.duplicateSamples.map((sample) => sample.reason).sort()).toEqual([
      'duplicateFile',
      'duplicateId',
    ]);
    expect(manifest.duplicateSamples[0].kept).toEqual({ m_filename: 'Spells/A.xml', m_id: 10 });
  });

  it('rejects malformed entries (bad id, blank/absent filename, non-objects) and samples them', () => {
    const manifest = parseTemplateManifest(
      syntheticDoc([
        { m_filename: 'Spells/ok.xml', m_id: 7 },
        { m_filename: 'Spells/zero.xml', m_id: 0 },
        { m_filename: 'Spells/negative.xml', m_id: -3 },
        { m_filename: 'Spells/fraction.xml', m_id: 1.5 },
        { m_filename: 'Spells/stringbad.xml', m_id: 'many' },
        { m_filename: '', m_id: 12 },
        { m_filename: '   ', m_id: 13 },
        { m_id: 14 },
        { m_filename: 'Spells/noid.xml' },
        null,
        'nope',
        123,
      ]),
    );

    expect(manifest.counts).toEqual({
      entries: 12,
      accepted: 1,
      rejected: 11,
      files: 1,
      ids: 1,
      duplicateFiles: 0,
      duplicateIds: 0,
    });
    expect(manifest.byFile.get('Spells/ok.xml')).toBe(7);
    expect(manifest.rejectedSamples).toHaveLength(MANIFEST_SAMPLE_LIMIT);
    expect(manifest.rejectedSamples[0]).toMatchObject({ index: 1 });
    expect(manifest.rejectedSamples[0].reason).toMatch(/positive integer/);
    expect(manifest.rejectedSamples[0].raw).toContain('Spells/zero.xml');
  });

  it('accepts a decimal-string id and rejects non-canonical ones', () => {
    const manifest = parseTemplateManifest(
      syntheticDoc([
        { m_filename: 'Spells/str.xml', m_id: '1143963608' },
        { m_filename: 'Spells/plus.xml', m_id: '+5' },
        { m_filename: 'Spells/pad.xml', m_id: '0007' },
        { m_filename: 'Spells/bool.xml', m_id: true },
        { m_filename: 'Spells/null.xml', m_id: null },
      ]),
    );

    expect(manifest.byFile.get('Spells/str.xml')).toBe(1143963608);
    // `0007` is a canonical decimal token → 7; `+5` is not matched by /^\d+$/.
    expect(manifest.byFile.get('Spells/pad.xml')).toBe(7);
    expect(manifest.byFile.has('Spells/plus.xml')).toBe(false);
    expect(manifest.byFile.has('Spells/bool.xml')).toBe(false);
    expect(manifest.byFile.has('Spells/null.xml')).toBe(false);
    expect(manifest.counts.accepted).toBe(2);
  });

  it('throws an explicit error when the document is not a manifest at all', () => {
    expect(() => parseTemplateManifest(null)).toThrow(TemplateManifestError);
    expect(() => parseTemplateManifest([])).toThrow(/not a JSON object/);
    expect(() => parseTemplateManifest({})).toThrow(/no `_object`/);
    expect(() => parseTemplateManifest({ _object: {} })).toThrow(/m_serializedTemplates/);
    expect(() => parseTemplateManifest({ _object: { m_serializedTemplates: {} } })).toThrow(
      TemplateManifestError,
    );
  });

  it('accepts an empty template array (a valid but empty manifest)', () => {
    const manifest = parseTemplateManifest(syntheticDoc([]));
    expect(manifest.counts.entries).toBe(0);
    expect(manifest.byFile.size).toBe(0);
    expect(manifest.byId.size).toBe(0);
  });
});

describe('loadTemplateManifest', () => {
  it('reads through an injected reader and never touches the real 17 MB file', async () => {
    const seen: string[] = [];
    const manifest = await loadTemplateManifest('/virtual/tree/TemplateManifest_deser.json', {
      readFile: async (file) => {
        seen.push(file);
        return JSON.stringify(
          syntheticDoc([
            { m_filename: 'Spells/Stun Block.xml', m_id: 1143963608 },
            { m_filename: 'Spells/Conviction.xml', m_id: 2102149986 },
          ]),
        );
      },
    });

    expect(seen).toEqual(['/virtual/tree/TemplateManifest_deser.json']);
    expect(manifest.counts.entries).toBe(2);
    expect(manifest.byId.get(2102149986)).toBe('Spells/Conviction.xml');
  });

  it('surfaces a read failure to the caller (the orchestrator turns it loud)', async () => {
    await expect(
      loadTemplateManifest('/virtual/missing.json', {
        readFile: async () => {
          throw new Error('ENOENT: no such file');
        },
      }),
    ).rejects.toThrow(/ENOENT/);
  });

  it('parses a JSON5-recoverable document through the lenient path', async () => {
    const manifest = await loadTemplateManifest('/virtual/trailing-comma.json', {
      readFile: async () =>
        '{ _object: { m_serializedTemplates: [ { m_filename: "Spells/A.xml", m_id: 5 }, ], }, }',
    });
    expect(manifest.byFile.get('Spells/A.xml')).toBe(5);
  });
});
