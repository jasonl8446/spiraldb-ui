import { describe, expect, it } from 'vitest';

import { createObjectBody, updateObjectBody } from '@shared/objectSave';
import { objectTypeConfig } from '@shared/objectTypes';

/**
 * Story p4-09 (task 4.11) — the write envelope's unit half.
 *
 * The envelope's third field is the p4-08 defect (D76a): `ObjectDetailPage` did not send `key`, so
 * an unmodified save of an existing DropTable 400'd against its own name. Extracting the body to
 * one home only helps if the home's rules are pinned, which is what this file does:
 *
 * - an **update** of a keyed family carries the entry's own route key;
 * - a **create** never carries one (a name the corpus already holds must hit the duplicate rule);
 * - the **unkeyed** family never carries one (its POST rejects a supplied key — D75d);
 * - a blank `notes` is omitted rather than sent as `''`.
 */

describe('p4-09 — the update envelope carries the entry\u2019s own identity', () => {
  it('a keyed family sends { object, key }', () => {
    const document = { Name: 'DS-ACAD1-C01-001', RollChance: 1 };
    expect(updateObjectBody(objectTypeConfig('droptable'), 'DS-ACAD1-C01-001', document)).toEqual({
      object: document,
      key: 'DS-ACAD1-C01-001',
    });
  });

  it('the unkeyed family sends { object } — its POST rejects a supplied key', () => {
    const document = { GlobalRegistryValues: { Localization: 1 } };
    expect(
      updateObjectBody(objectTypeConfig('globalregistry'), 'globalregistry', document),
    ).toEqual({
      object: document,
    });
  });

  it('passes a real note through and omits a blank one', () => {
    const document = { TemplateID: 1025, Inventory: [] };
    expect(
      updateObjectBody(objectTypeConfig('npcinventory'), '1025', document, 'reviewed by hand'),
    ).toEqual({ object: document, key: '1025', notes: 'reviewed by hand' });
    expect(updateObjectBody(objectTypeConfig('npcinventory'), '1025', document, '')).toEqual({
      object: document,
      key: '1025',
    });
  });
});

describe('p4-09 — the create envelope never carries a key', () => {
  it('is the document alone', () => {
    const document = { TemplateID: 87112, DropTableNames: [] };
    expect(createObjectBody(document)).toEqual({ object: document });
    expect(createObjectBody(document)).not.toHaveProperty('key');
  });

  it('keeps a note and omits a blank one', () => {
    const document = { ZoneName: 'WizardCity/WC_Hub', Teleports: [] };
    expect(createObjectBody(document, 'first pass')).toEqual({
      object: document,
      notes: 'first pass',
    });
    expect(createObjectBody(document, '')).toEqual({ object: document });
  });

  it('never mutates the document it is given', () => {
    const document = { TemplateID: 1025, Inventory: [] };
    const envelope = updateObjectBody(objectTypeConfig('npcinventory'), '1025', document);
    expect(envelope.object).toBe(document);
    expect(Object.keys(document)).toEqual(['TemplateID', 'Inventory']);
  });
});
