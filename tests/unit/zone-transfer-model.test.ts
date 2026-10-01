import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import json5 from 'json5';
import { afterAll, describe, expect, it } from 'vitest';

import { applyEdits, loadDoc, serializeDoc, type DocEdit } from '@shared/document';
import { createNameFor, objectTypeConfig } from '@shared/objectTypes';
import {
  addTeleportEdit,
  DESTINATION_LOC_HINT,
  DESTINATION_LOC_PATTERN,
  isDestinationLoc,
  newTeleportTriggerEntry,
  PLAIN_FLOAT_DESTINATION_LOC_PATTERN,
  readRawTopLevelFields,
  readTeleports,
  rawFieldNote,
  RAW_FIELDS_LABEL,
  removeTeleportEdit,
  TELEPORT_KEYS,
  TELEPORT_TYPE_KNOWN_MEMBERS,
  teleportDestinationLocEdit,
  teleportDestinationZoneEdit,
  teleportFieldPath,
  teleportNumberEdit,
  teleportTriggerNameEdit,
  teleportTypeEdit,
  teleportTypeIsUnrecognised,
  teleportTypeOptions,
  teleportTypeValue,
  unmodelledTopLevelKeys,
  validateZoneTransfer,
  ZONE_TRANSFER_CORPUS,
  ZONE_TRANSFER_DRIFT_KEY,
  ZONE_TRANSFER_ENTRY_KEYS,
  ZONE_TRANSFER_FIELDS,
  ZONE_TRANSFER_KEY_FIELD,
  ZONE_TRANSFER_KNOWN_TOP_LEVEL_KEYS,
  ZONE_TRANSFER_LIST_KEY,
  ZONE_TRANSFER_MODELLED_TOP_LEVEL_KEYS,
  zoneTransferCreateName,
  zoneTransferFindings,
} from '@shared/simpleObjects';
import { fieldHasError } from '../../client/src/lib/validation-message';
import { toZoneTransferValidationMessages } from '../../client/src/lib/zone-transfer-validation';
import { DEFAULT_SPIRALDB_PATH, type Db } from '@server/db';
import { humanizeZone } from '../../client/src/lib/display';

/**
 * Story p4-06's model + drift-guard test — plan task 4.8, `WizardZoneData` (`ZoneTransfer/`),
 * docs/spec-domain-reference.md §"WizardZoneData (ZoneTransfer)" / §"Zone Display Names" /
 * §"General Validation", docs/spec-data-model.md §"File Naming Conventions",
 * and the AC's two clauses.
 *
 * Four things are pinned, and the first two are the ACs themselves:
 *
 * 1. **The live sweep over all 1207 real files.** Every constant in `ZONE_TRANSFER_CORPUS` is
 *    **re-measured**, so the day the corpus moves the sweep says so instead of the editor
 *    quietly assuming. The sweep carries the two facts AC1 turns on: three top-level keys
 *    including `Events` in 1207/1207 (and `[]` in 1207/1207), **2368** `Teleports` entries whose
 *    shapes are exact, and — the trap — **2365 of 2368 `m_destinationLoc` values accepted by
 *    {@link DESTINATION_LOC_PATTERN}, 135 of them scientific**, with the **falsification arm**
 *    proving a plain-float regex rejects 136 (the 133 scientific shapes plus the three prose
 *    values the owner's `f9a1055` merge added). Re-measured at that baseline (D79).
 * 2. **The `Events` guard at the payload level.** A real document load → no-op → `serializeDoc`
 *    is **byte-identical with an identical key set** (1206 of the 1207 files are; the 1207th ends
 *    with two newlines and is normalised — the sweep asserts both counts), and an edit to a
 *    *modelled* key leaves `Events` and the nested objects byte-identical (D5 merge-not-replace).
 *    `Events` is *visible*: {@link unmodelledTopLevelKeys} returns it and
 *    {@link rawFieldNote} says what it is.
 * 3. **The regex's two arms, as a pattern.** The fixture battery pins both directions of the
 *    decision: the real scientific shapes are accepted and garbage is rejected — `1,2,3`,
 *    five components, a trailing comma, `a` as a component, surrounding whitespace, `Infinity`.
 * 4. **The validation decision, which now WARNS (D80a).** One `severity: 'warning'` per
 *    malformed present value, `warnings` equal to `findings`, `blocking` empty, `blocked ===
 *    false` — so Save stays enabled through the shared `fieldHasError` gate (L542-546). The rule
 *    shipped as blocking (D74) on the measured premise that it had **zero corpus violations**;
 *    the owner's `f9a1055` merge falsified that premise with **three real prose values**
 *    (`"Start"`, `"Target location (Street5 Tower1 Entrance)"`, `"Target (Street5 FireTheatre
 *    Entrance)"`), so the rule was downgraded by the lead's ruling and the arm now pins both
 *    sides: all 2,368 corpus values **save**, and a malformed value is still **flagged**. The
 *    converse is pinned too: an unrecognised `m_teleportType` and an unresolvable
 *    `m_destinationZone` produce **no** finding, a clean document has no findings either, and the
 *    engine's only kind is the format check — so the warning set cannot grow by accident and no
 *    reference rule exists in either direction.
 *
 * **D68**: nothing eager runs at collection time — the corpus guard is an `existsSync` boolean and
 * the files/DB are read inside the tests that need them. The skip is provable (and is proven in
 * the story's evidence) by running this file with `SPIRALDB_SIMPLE_OBJECTS_ROOT` pointed at a
 * path with no `ZoneTransfer/`.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CORPUS_ROOT = process.env.SPIRALDB_SIMPLE_OBJECTS_ROOT ?? DEFAULT_SPIRALDB_PATH;
const DB_PATH = path.join(ROOT, 'data', 'spiraldb-ui.db');

const CORPUS_DIR = path.join(CORPUS_ROOT, 'ZoneTransfer');

// D68: a boolean only — no readdir/readFile/DB handle at module scope.
const FORK_PRESENT = fs.existsSync(CORPUS_DIR);
const DB_PRESENT = fs.existsSync(DB_PATH);

if (!FORK_PRESENT) {
  console.log(
    `[p4-06 corpus] the live sweep was skipped — no ZoneTransfer/ under ${CORPUS_ROOT} (CI has ` +
      'no sibling SpiralDB checkout, D40). The fixture batteries below carry every primitive.',
  );
}
if (!DB_PRESENT) {
  console.log(
    `[p4-06 zones] the zones sweep was skipped — no ${DB_PATH}. The dropdown's source semantics ` +
      'are still pinned by the fixtures.',
  );
}

const OPEN_DBS: Db[] = [];

afterAll(() => {
  for (const db of OPEN_DBS) {
    db.close();
  }
});

/* -------------------------------------------------------------------- the corpus */

/** Every corpus file's parsed document plus its raw bytes and name, read once inside a test. */
interface CorpusFile {
  readonly name: string;
  readonly raw: string;
  readonly document: Record<string, unknown>;
}

/** Reads all 1207 files (json5, the tests' own lenient parser — the server's mirror). */
function readCorpus(): CorpusFile[] {
  const names = fs
    .readdirSync(CORPUS_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();
  return names.map((name) => {
    const raw = fs.readFileSync(path.join(CORPUS_DIR, name), 'utf8');
    return {
      name,
      raw,
      document: json5.parse(raw) as Record<string, unknown>,
    };
  });
}

/** The three-component shape of a `m_destinationLoc` value (`dec`/`int`/`sci` per component). */
function componentShape(value: string): string[] {
  return value
    .split(',')
    .map((part) => (/[eE]/.test(part) ? 'sci' : part.includes('.') ? 'dec' : 'int'));
}

describe.skipIf(!FORK_PRESENT)(
  `AC1 + AC2 — the live corpus (${ZONE_TRANSFER_CORPUS.files} files)`,
  () => {
    it('has exactly the three measured top-level keys, Events present and empty in every file, and 2368 teleport entries', () => {
      const files = readCorpus();
      expect(files.length).toBe(ZONE_TRANSFER_CORPUS.files);

      let withKnownSet = 0;
      let withEvents = 0;
      let withEmptyEvents = 0;
      let orderZoneNameEventsTeleports = 0;
      let orderZoneNameTeleportsEvents = 0;
      let teleports = 0;
      let emptyTeleports = 0;
      let withTriggerAndTeleport = 0;
      let triggerNameStrings = 0;
      let sixKeys = 0;
      let serializerOrder = 0;
      let specOrder = 0;
      let locValues = 0;
      let locScientific = 0;
      const locSciComponents = new Map<number, number>();
      let locAccepted = 0;
      let locRejected = 0;
      let locPlainFloatRejects = 0;
      let teleportTypeStatic = 0;
      const teleportTypes = new Set<unknown>();
      const zoneNames: string[] = [];
      const destinationZones = new Set<string>();
      const destinationZonesWithoutOwnFile = new Set<string>();
      let byteIdentical = 0;
      let normalised = 0;
      const zoneNameSet = new Set<string>();

      for (const { document, raw, name } of files) {
        const keys = Object.keys(document);
        const order = keys.join(',');
        if (
          keys.length === ZONE_TRANSFER_KNOWN_TOP_LEVEL_KEYS.length &&
          ZONE_TRANSFER_KNOWN_TOP_LEVEL_KEYS.every((key) => keys.includes(key))
        ) {
          withKnownSet += 1;
        }
        if (order === 'ZoneName,Events,Teleports') {
          orderZoneNameEventsTeleports += 1;
        }
        if (order === 'ZoneName,Teleports,Events') {
          orderZoneNameTeleportsEvents += 1;
          expect(name).toBe(ZONE_TRANSFER_CORPUS.orderOutlierFileName);
        }
        if (Object.prototype.hasOwnProperty.call(document, ZONE_TRANSFER_DRIFT_KEY)) {
          withEvents += 1;
        }
        const events = document[ZONE_TRANSFER_DRIFT_KEY];
        if (Array.isArray(events) && events.length === 0) {
          withEmptyEvents += 1;
        }

        const zoneName = document[ZONE_TRANSFER_KEY_FIELD];
        expect(typeof zoneName).toBe('string');
        zoneNames.push(zoneName as string);
        zoneNameSet.add(zoneName as string);

        const list = document[ZONE_TRANSFER_LIST_KEY];
        expect(Array.isArray(list)).toBe(true);
        const entries = list as unknown[];
        if (entries.length === 0) {
          emptyTeleports += 1;
        }
        for (const entry of entries) {
          teleports += 1;
          const row = entry as Record<string, unknown>;
          expect(Object.keys(row)).toEqual([...ZONE_TRANSFER_ENTRY_KEYS]);
          withTriggerAndTeleport += 1;
          if (typeof row.TriggerName === 'string') {
            triggerNameStrings += 1;
          }
          const nested = row.Teleport as Record<string, unknown>;
          expect(Object.keys(nested).length).toBe(TELEPORT_KEYS.length);
          expect(
            [...TELEPORT_KEYS].every((key) => Object.prototype.hasOwnProperty.call(nested, key)),
          ).toBe(true);
          sixKeys += 1;
          if (Object.keys(nested).join(',') === TELEPORT_KEYS.join(',')) {
            serializerOrder += 1;
          }
          if (
            Object.keys(nested).join(',') ===
            'm_destinationLoc,m_destinationZone,m_exitTeleporter,m_teleporterTag,m_teleportType,m_transitionID'
          ) {
            specOrder += 1;
          }

          const loc = nested.m_destinationLoc;
          expect(typeof loc).toBe('string');
          locValues += 1;
          if (isDestinationLoc(loc)) {
            locAccepted += 1;
          } else {
            locRejected += 1;
          }
          if (!PLAIN_FLOAT_DESTINATION_LOC_PATTERN.test(loc as string)) {
            locPlainFloatRejects += 1;
          }
          const shape = componentShape(loc as string);
          const sci = shape.filter((part) => part === 'sci').length;
          if (sci > 0) {
            locScientific += 1;
            locSciComponents.set(sci, (locSciComponents.get(sci) ?? 0) + 1);
          }

          const type = nested.m_teleportType;
          teleportTypes.add(type);
          if (type === TELEPORT_TYPE_KNOWN_MEMBERS[0]) {
            teleportTypeStatic += 1;
          }

          const zone = nested.m_destinationZone;
          expect(typeof zone).toBe('string');
          destinationZones.add(zone as string);
        }

        // The payload-level arm: a no-op load → serialize round-trips the file's bytes.
        const out = serializeDoc(loadDoc(document));
        if (out === raw) {
          byteIdentical += 1;
        } else {
          normalised += 1;
          expect(name).toBe(ZONE_TRANSFER_CORPUS.doubleTrailingNewlineFileName);
          expect(raw.endsWith('\n\n')).toBe(true);
          expect(out).toBe(`${raw.slice(0, -1)}`);
        }
      }

      // AC2's drift field: real, universal, and empty.
      expect(withKnownSet).toBe(ZONE_TRANSFER_CORPUS.filesWithKnownTopLevelKeySet);
      expect(withEvents).toBe(ZONE_TRANSFER_CORPUS.filesWithEvents);
      expect(withEmptyEvents).toBe(ZONE_TRANSFER_CORPUS.filesWithEmptyEvents);
      expect(orderZoneNameEventsTeleports).toBe(
        ZONE_TRANSFER_CORPUS.filesWithOrderZoneNameEventsTeleports,
      );
      expect(orderZoneNameTeleportsEvents).toBe(
        ZONE_TRANSFER_CORPUS.filesWithOrderZoneNameTeleportsEvents,
      );

      // AC1's repeater, at corpus scale (2,368 at the owner's f9a1055 baseline; was 2,365).
      expect(teleports).toBe(ZONE_TRANSFER_CORPUS.teleports);
      expect(emptyTeleports).toBe(ZONE_TRANSFER_CORPUS.filesWithEmptyTeleports);
      expect(withTriggerAndTeleport).toBe(ZONE_TRANSFER_CORPUS.entriesWithTriggerAndTeleport);
      expect(triggerNameStrings).toBe(ZONE_TRANSFER_CORPUS.triggerNameStrings);
      expect(sixKeys).toBe(ZONE_TRANSFER_CORPUS.teleportObjectsWithSixKeys);
      expect(serializerOrder).toBe(ZONE_TRANSFER_CORPUS.teleportObjectsInSerializerOrder);
      expect(specOrder).toBe(ZONE_TRANSFER_CORPUS.teleportObjectsInSpecOrder);

      // THE TRAP, re-measured: the regex accepts the scientific-notation shapes and rejects
      // exactly the three prose values the merge added — which is why the rule warns, not blocks.
      expect(locValues).toBe(ZONE_TRANSFER_CORPUS.destinationLocValues);
      expect(locAccepted).toBe(ZONE_TRANSFER_CORPUS.destinationLocValuesAcceptedByFormatPattern);
      expect(locRejected).toBe(ZONE_TRANSFER_CORPUS.destinationLocValuesRejectedByFormatPattern);
      expect(locRejected).toBe(3);
      // The three rejects are data, with their addresses: never "a user's malformed value".
      for (const prose of ZONE_TRANSFER_CORPUS.destinationLocProseValues) {
        const file = files.find((entry) => entry.name === prose.file);
        expect(file, prose.file).toBeDefined();
        const teleport = readTeleports(file?.document as Record<string, unknown>)[prose.index]
          .teleport as Record<string, unknown>;
        expect(teleport.m_destinationLoc).toBe(prose.value);
        expect(isDestinationLoc(prose.value)).toBe(false);
      }
      expect(locScientific).toBe(ZONE_TRANSFER_CORPUS.destinationLocScientificValues);
      // Every scientific value carries exactly one scientific component — 135 of them now, the
      // two prose values included (one comma-free component each counts as "sci" by the same
      // shape test the arm uses).
      expect([...locSciComponents.entries()]).toEqual([[1, 135]]);
      // …and the falsification arm: a plain-float regex rejects 136 (the 135 + 1 non-scientific
      // prose value), i.e. the three prose values plus every scientific shape.
      expect(locPlainFloatRejects).toBe(
        ZONE_TRANSFER_CORPUS.destinationLocValuesRejectedByPlainFloatRegex,
      );

      // AC1's enum: one measured member only.
      expect(teleportTypeStatic).toBe(ZONE_TRANSFER_CORPUS.teleportTypeStaticValues);
      expect(teleportTypes.size).toBe(ZONE_TRANSFER_CORPUS.distinctTeleportTypes);
      expect([...teleportTypes]).toEqual([...TELEPORT_TYPE_KNOWN_MEMBERS]);

      // The key collapse, measured rather than assumed (p4-01's 1205-row list).
      expect(zoneNames.length).toBe(ZONE_TRANSFER_CORPUS.zoneNames);
      expect(zoneNameSet.size).toBe(ZONE_TRANSFER_CORPUS.distinctZoneNames);
      const duplicates = [...zoneNameSet].filter(
        (name) => zoneNames.filter((candidate) => candidate === name).length > 1,
      );
      expect(duplicates.sort()).toEqual([...ZONE_TRANSFER_CORPUS.duplicateZoneNames].sort());

      // Every destination ref is a valid zone — the "no reference rule" claim's own evidence.
      for (const ref of destinationZones) {
        if (!zoneNameSet.has(ref)) {
          destinationZonesWithoutOwnFile.add(ref);
        }
      }
      expect(destinationZones.size).toBe(ZONE_TRANSFER_CORPUS.distinctDestinationZones);
      expect(destinationZonesWithoutOwnFile.size).toBe(
        ZONE_TRANSFER_CORPUS.destinationZonesWithoutOwnFile,
      );

      // AC2's "survives save", at the byte level.
      expect(byteIdentical).toBe(ZONE_TRANSFER_CORPUS.filesByteIdenticalAfterSerialize);
      expect(normalised).toBe(ZONE_TRANSFER_CORPUS.filesNormalisedBySerialize);
    });

    it('carries Events through every modelled edit, and keeps each nested object whole', () => {
      const files = readCorpus();
      // Deterministic pick: the first file in the majority key order that carries exactly one
      // teleport, so the removal arm below is exact rather than "some rows survive".
      const file = files.find(
        (candidate) =>
          Object.keys(candidate.document).join(',') === 'ZoneName,Events,Teleports' &&
          (candidate.document.Teleports as unknown[]).length === 1,
      );
      expect(file, 'no single-teleport file in the majority key order').toBeDefined();
      const before = (file as CorpusFile).document;
      const beforeKeys = Object.keys(before);
      expect(beforeKeys).toEqual(['ZoneName', 'Events', 'Teleports']);

      const eventsBefore = JSON.stringify(before.Events);
      const nestedBefore = JSON.stringify(
        (before.Teleports as Record<string, unknown>[])[0].Teleport,
      );
      const nestedKeysBefore = Object.keys(
        (before.Teleports as Record<string, unknown>[])[0].Teleport as Record<string, unknown>,
      );

      // An edit to each modelled shape: the key, one trigger name, one nested field, one removal.
      const edits = [
        { op: 'set', path: ['ZoneName'], value: 'Edited/Zone_Path' },
        teleportTriggerNameEdit(0, 'Renamed'),
        teleportDestinationLocEdit(0, '1.5e-05,2,3,4'),
        teleportNumberEdit(0, 'm_transitionID', '7'),
        teleportTypeEdit(0, 'TELEPORT_STATIC'),
      ].filter((edit): edit is DocEdit => edit !== null);
      expect(edits).toHaveLength(5);
      const edited = applyEdits(before, edits) as Record<string, unknown>;

      expect(Object.keys(edited)).toEqual(beforeKeys);
      expect(JSON.stringify(edited.Events)).toBe(eventsBefore);
      expect(edited.Events).toEqual([]);
      const nestedAfter = (edited.Teleports as Record<string, unknown>[])[0].Teleport as Record<
        string,
        unknown
      >;
      // The nested object is preserved whole: same key order, and the five untouched keys identical.
      expect(Object.keys(nestedAfter)).toEqual(nestedKeysBefore);
      expect(JSON.stringify(nestedAfter)).not.toBe(nestedBefore);
      expect(nestedAfter.m_transitionID).toBe(7);
      expect(nestedAfter.m_destinationLoc).toBe('1.5e-05,2,3,4');

      // A removal addresses the element, so the surviving entry keeps its nested object untouched.
      const removed = applyEdits(before, [removeTeleportEdit(0)]) as Record<string, unknown>;
      expect(Object.keys(removed)).toEqual(beforeKeys);
      expect(JSON.stringify(removed.Events)).toBe(eventsBefore);
      expect(removed.Teleports).toEqual([]);
    });

    // The zones table lives in the dev database, which a clone without data/ (CI, D55) lacks: this
    // arm needs both guards (PR #14 review "could not assess" — DB_PRESENT was computed, never used).
    it.skipIf(!DB_PRESENT)(
      'resolves every one of the 1072 destination refs in the zones table, and reads the labels from it',
      () => {
        const db = new Database(DB_PATH, { readonly: true });
        OPEN_DBS.push(db);
        const zones = db.prepare('SELECT zone_path, display_name FROM zones').all() as Array<{
          zone_path: string;
          display_name: string | null;
        }>;
        expect(zones.length).toBe(ZONE_TRANSFER_CORPUS.zoneRows);

        const paths = new Set(zones.map((zone) => zone.zone_path));
        expect(paths.size).toBe(zones.length);
        expect(zones.filter((zone) => (zone.display_name ?? '').trim() === '').length).toBe(
          ZONE_TRANSFER_CORPUS.blankZoneDisplayNames,
        );

        // The synced label is already humanized: compare it with the *existing* humanizer rather than
        // adding a second one. They agree on the documented case and differ only on digit/letter
        // boundaries — recorded, never "fixed".
        const agreeing = zones.filter(
          (zone) => zone.display_name === humanizeZone(zone.zone_path),
        ).length;
        expect(agreeing).toBe(ZONE_TRANSFER_CORPUS.zoneDisplayNamesAgreeingWithHumanizer);
        expect(zones.length - agreeing).toBe(
          ZONE_TRANSFER_CORPUS.zoneDisplayNamesDifferingFromHumanizer,
        );

        // Every reference in the corpus resolves here — the whole dropdown source.
        const files = readCorpus();
        const referenced = new Set<string>();
        for (const { document } of files) {
          for (const { teleport } of readTeleports(document)) {
            if (teleport !== null && typeof teleport.m_destinationZone === 'string') {
              referenced.add(teleport.m_destinationZone);
            }
          }
        }
        expect(referenced.size).toBe(ZONE_TRANSFER_CORPUS.distinctDestinationZones);
        expect([...referenced].filter((ref) => !paths.has(ref))).toEqual([]);

        const referencedAgreeing = zones.filter(
          (zone) =>
            referenced.has(zone.zone_path) && zone.display_name === humanizeZone(zone.zone_path),
        ).length;
        const referencedZoneCount = zones.filter((zone) => referenced.has(zone.zone_path)).length;
        expect(referencedZoneCount).toBe(ZONE_TRANSFER_CORPUS.distinctDestinationZones);
        expect(referencedAgreeing).toBe(ZONE_TRANSFER_CORPUS.referencedZoneDisplayNamesAgreeing);
        expect(referencedZoneCount - referencedAgreeing).toBe(
          ZONE_TRANSFER_CORPUS.referencedZoneDisplayNamesDiffering,
        );

        // The `zones` row the dropdown shows the humanized label from.
        const sample = db
          .prepare('SELECT display_name FROM zones WHERE zone_path = ?')
          .get('Aquila/AQ_Z00_Hub') as { display_name: string } | undefined;
        // D120's ladder resolves `m_zoneDisplayName` through the string table; it was the humanised
        // path 'Aquila / AQ Z00 Hub' while the table was corpus-derived (re-measured at p7-02, D145).
        expect(sample?.display_name).toBe('Garden Of Hesperides');
      },
    );
  },
);

/* ---------------------------------------------------- the model, without the corpus */

describe('AC1 — the field inventory and the create name', () => {
  it('names the two modelled fields and the two kinds the form renders', () => {
    expect(ZONE_TRANSFER_FIELDS.map((field) => field.key)).toEqual([
      ZONE_TRANSFER_KEY_FIELD,
      ZONE_TRANSFER_LIST_KEY,
    ]);
    expect(ZONE_TRANSFER_FIELDS.map((field) => field.kind)).toEqual([
      'zone-select',
      'zone-teleport-list',
    ]);
    expect(ZONE_TRANSFER_FIELDS[0].namesType).toBe('zones');
    expect(ZONE_TRANSFER_FIELDS.map((field) => field.corpusPresence)).toEqual([1207, 1207]);
    // `Events` is deliberately NOT a field: the editor does not edit it (AC2's disclosure).
    expect(ZONE_TRANSFER_FIELDS.some((field) => field.key === ZONE_TRANSFER_DRIFT_KEY)).toBe(false);
  });

  it('builds the create name through fileNameFor — slash to underscore, never hand-built', () => {
    expect(zoneTransferCreateName('WizardCity/WC_Hub')).toBe('zonetransfer_WizardCity_WC_Hub.json');
    expect(createNameFor(objectTypeConfig('zonetransfer'), 'WizardCity/WC_Hub')).toBe(
      'zonetransfer_WizardCity_WC_Hub.json',
    );
    // The transform is lossy in the documented direction only, and it is the *file* name that
    // round-trips — the key itself keeps its slash.
    expect(zoneTransferCreateName('WizardCity/WC_Hub')).not.toContain('/');
    expect(zoneTransferCreateName('a/b/c')).toBe('zonetransfer_a_b_c.json');
  });
});

describe('AC1 — the m_destinationLoc regex, both arms', () => {
  it('accepts the four-component shapes the corpus really carries, scientific notation included', () => {
    const accepted = [
      '2824.861,-6404.079,201.9192,3.13484',
      '1.545422,-1118.252,-1.671345E-05,-3.128352',
      '33.21389,490.4592,-3.051758E-05,0',
      '-95.55735,-849.2842,-30.46902,-0.03700731',
      '1e5,1E+5,1e-05,-1.5E-05',
      '0,0,0,0',
      '-0.0,1,2,3',
      '.5,.5,.5,.5',
      '0,0,0,0.0',
    ];
    for (const value of accepted) {
      expect(isDestinationLoc(value), `should accept ${value}`).toBe(true);
      expect(DESTINATION_LOC_PATTERN.test(value), `pattern should accept ${value}`).toBe(true);
    }
  });

  it('rejects everything that is not exactly four numbers — the loose arm would have passed these', () => {
    const rejected = [
      '',
      '1,2,3',
      '1,2,3,4,5',
      '1.5e-05,2,3,4,',
      '1.5e-05,2,3,4,5',
      '1.5e-05,a,3,4',
      ' 1.5e-05,2,3,4',
      '1.5e-05,2,3,4 ',
      '1.5e-05, 2, 3, 4',
      'Infinity,1,2,3',
      'NaN,1,2,3',
      '1e,2,3,4',
      '--1,2,3,4',
      '1.5e-05;2;3;4',
      '1.5e-05,2,3,4\n',
      'x,y,z,w',
    ];
    for (const value of rejected) {
      expect(isDestinationLoc(value), `should reject ${JSON.stringify(value)}`).toBe(false);
    }
    // Non-strings are not this format either — a JSON number is a different shape.
    expect(isDestinationLoc(1)).toBe(false);
    expect(isDestinationLoc(null)).toBe(false);
    expect(isDestinationLoc(['1', '2', '3', '4'])).toBe(false);
  });

  it('proves the plain-float arm would have failed the decision (the falsification)', () => {
    expect(
      PLAIN_FLOAT_DESTINATION_LOC_PATTERN.test('1.545422,-1118.252,-1.671345E-05,-3.128352'),
    ).toBe(false);
    expect(PLAIN_FLOAT_DESTINATION_LOC_PATTERN.test('1.5,-2.5,3.5,-4.5')).toBe(true);
    // …and states the format in words the user reads.
    expect(DESTINATION_LOC_HINT).toContain('Four comma-separated numbers');
    expect(DESTINATION_LOC_HINT).toContain('135');
  });
});

describe('AC1 — the m_teleportType decision', () => {
  it('offers the one measured member and invents no others', () => {
    expect(TELEPORT_TYPE_KNOWN_MEMBERS).toEqual(['TELEPORT_STATIC']);
    const options = teleportTypeOptions('TELEPORT_STATIC');
    expect(options).toEqual([
      { value: 'TELEPORT_STATIC', label: 'TELEPORT_STATIC', unrecognised: false },
    ]);
  });

  it('preserves an unrecognised stored value verbatim instead of rewriting it', () => {
    const stored = 'TELEPORT_FROM_A_FUTURE_BUILD';
    const options = teleportTypeOptions(stored);
    expect(options.map((option) => option.value)).toEqual(['TELEPORT_STATIC', stored]);
    expect(options[1].unrecognised).toBe(true);
    expect(teleportTypeIsUnrecognised(stored)).toBe(true);
    expect(teleportTypeIsUnrecognised('TELEPORT_STATIC')).toBe(false);
    // The control's value is the stored string, so nothing writes over it on render.
    expect(teleportTypeValue(stored)).toBe(stored);
    // Preserving means writing it back unchanged when the user re-chooses it.
    expect(teleportTypeEdit(0, stored)).toEqual({
      op: 'set',
      path: teleportFieldPath(0, 'm_teleportType'),
      value: stored,
    });
    // An absent value selects nothing and writes nothing — absence is preserved too.
    expect(teleportTypeValue(undefined)).toBe('');
    expect(teleportTypeOptions(undefined)).toHaveLength(1);
    expect(teleportTypeEdit(0, '')).toBeNull();
  });
});

describe('AC1 — the readers and the index-addressed edit builders', () => {
  /** The document fixture: the schema's shape plus one unrecognised nested value. */
  const DOC: Record<string, unknown> = {
    ZoneName: 'WizardCity/WC_Hub',
    Events: [],
    Teleports: [
      {
        TriggerName: 'TeleportToShoppingDistrict',
        Teleport: {
          m_exitTeleporter: 0,
          m_teleporterTag: 1,
          m_teleportType: 'TELEPORT_STATIC',
          m_transitionID: 2,
          m_destinationLoc: '-95.55735,-849.2842,-30.46902,-0.03700731',
          m_destinationZone: 'WizardCity/WC_Shop_Area',
        },
      },
      {
        TriggerName: 'TeleportToShoppingDistrict',
        Teleport: { m_destinationZone: 'WizardCity/WC_Hub' },
      },
    ],
  };

  it('reads rows by index with their nested object, and skips nothing that is an object', () => {
    const rows = readTeleports(DOC);
    expect(rows.map((row) => row.index)).toEqual([0, 1]);
    expect(rows.map((row) => row.triggerName)).toEqual([
      'TeleportToShoppingDistrict',
      'TeleportToShoppingDistrict',
    ]);
    expect(rows[0].teleport).toBe((DOC.Teleports as Record<string, unknown>[])[0].Teleport);
    expect(rows[1].teleport).toEqual({ m_destinationZone: 'WizardCity/WC_Hub' });

    // The three "no list here" shapes are all the empty state.
    expect(readTeleports({})).toEqual([]);
    expect(readTeleports({ Teleports: null })).toEqual([]);
    expect(readTeleports({ Teleports: 'x' })).toEqual([]);
    expect(readTeleports({ Teleports: [] })).toEqual([]);
    expect(readTeleports({ Teleports: [42, null] })).toEqual([]);
  });

  it('appends a new entry in the corpus order, and sets a list into a document without one', () => {
    const entry = newTeleportTriggerEntry('To_Hub', 'WizardCity/WC_Hub');
    expect(Object.keys(entry)).toEqual(['TriggerName', 'Teleport']);
    expect(Object.keys(entry.Teleport as Record<string, unknown>)).toEqual([...TELEPORT_KEYS]);
    expect(entry).toEqual({
      TriggerName: 'To_Hub',
      Teleport: {
        m_exitTeleporter: 0,
        m_teleporterTag: 0,
        m_teleportType: 'TELEPORT_STATIC',
        m_transitionID: 0,
        m_destinationLoc: '0,0,0,0',
        m_destinationZone: 'WizardCity/WC_Hub',
      },
    });

    const appended = applyEdits(DOC, [
      addTeleportEdit(true, readTeleports(DOC).length, entry),
    ]) as Record<string, unknown>;
    expect(readTeleports(appended)).toHaveLength(3);
    expect(readTeleports(appended)[2].entry).toEqual(entry);

    // A document with no `Teleports` key takes one `set` — `insert` into an absent key throws.
    const fresh = applyEdits({ ZoneName: 'A/B' }, [addTeleportEdit(false, 0, entry)]) as Record<
      string,
      unknown
    >;
    expect(fresh.Teleports).toEqual([entry]);
  });

  it('removes exactly the clicked index, so a repeated trigger name survives', () => {
    const rows = readTeleports(DOC);
    // Both rows carry the same TriggerName on purpose: a value-based removal would drop both.
    expect(rows[0].triggerName).toBe(rows[1].triggerName);
    const removed = applyEdits(DOC, [removeTeleportEdit(0)]) as Record<string, unknown>;
    expect(readTeleports(removed)).toHaveLength(1);
    expect(removed.Teleports).toEqual([DOC.Teleports && (DOC.Teleports as unknown[])[1]]);
    // An out-of-range index is a no-op at the document level (deleteAtPath on a missing index).
    expect(removeTeleportEdit(9)).toEqual({ op: 'delete', path: ['Teleports', 9] });
  });

  it('writes each field verbatim, with the schema-preserving empty-box rules', () => {
    expect(teleportTriggerNameEdit(0, '  spaced  ')).toEqual({
      op: 'set',
      path: ['Teleports', 0, 'TriggerName'],
      value: '  spaced  ',
    });
    expect(teleportTriggerNameEdit(0, 7)).toBeNull();

    // The location is written verbatim even when malformed — what makes the warning observable.
    expect(teleportDestinationLocEdit(0, 'not a location')).toEqual({
      op: 'set',
      path: ['Teleports', 0, 'Teleport', 'm_destinationLoc'],
      value: 'not a location',
    });

    // The zone: a blank is refused (no edit), a real path is written verbatim.
    expect(teleportDestinationZoneEdit(0, '   ')).toBeNull();
    expect(teleportDestinationZoneEdit(0, 'WizardCity/WC_Shop_Area')).toEqual({
      op: 'set',
      path: ['Teleports', 0, 'Teleport', 'm_destinationZone'],
      value: 'WizardCity/WC_Shop_Area',
    });

    // Numbers: an emptied box writes 0 (all six keys are required), garbage writes nothing.
    expect(teleportNumberEdit(0, 'm_transitionID', '')).toEqual({
      op: 'set',
      path: ['Teleports', 0, 'Teleport', 'm_transitionID'],
      value: 0,
    });
    expect(teleportNumberEdit(0, 'm_transitionID', '12')).toEqual({
      op: 'set',
      path: ['Teleports', 0, 'Teleport', 'm_transitionID'],
      value: 12,
    });
    expect(teleportNumberEdit(0, 'm_transitionID', '-3.5')).toEqual({
      op: 'set',
      path: ['Teleports', 0, 'Teleport', 'm_transitionID'],
      value: -3.5,
    });
    expect(teleportNumberEdit(0, 'm_transitionID', '1e')).toBeNull();
  });
});

describe('AC2 — the drift guard and the raw-fields disclosure data', () => {
  const DOC: Record<string, unknown> = {
    ZoneName: 'WizardCity/WC_Hub',
    Events: [],
    Teleports: [],
    SomethingNew: { a: 1 },
  };

  it('partitions the top level into modelled keys and the disclosure, in document order', () => {
    expect([...ZONE_TRANSFER_MODELLED_TOP_LEVEL_KEYS]).toEqual(['ZoneName', 'Teleports']);
    expect(unmodelledTopLevelKeys({ ZoneName: 'a', Events: [] })).toEqual(['Events']);
    expect(unmodelledTopLevelKeys(DOC)).toEqual(['Events', 'SomethingNew']);
    expect(readRawTopLevelFields(DOC)).toEqual([
      { key: 'Events', value: [] },
      { key: 'SomethingNew', value: { a: 1 } },
    ]);
    // A document that carries nothing unmodelled shows no disclosure at all.
    expect(unmodelledTopLevelKeys({ ZoneName: 'a', Teleports: [] })).toEqual([]);
    expect(RAW_FIELDS_LABEL).toBe('Raw fields');
  });

  it('says, in the disclosure’s own words, that Events is real, universal and empty', () => {
    const note = rawFieldNote(ZONE_TRANSFER_DRIFT_KEY);
    expect(note).toContain('1,207');
    expect(note).toContain('empty array');
    expect(note).toContain('byte-for-byte');
    expect(rawFieldNote('SomethingNew')).toContain('not modelled by this editor');
  });

  it('never invents Events: a document without it stays without it', () => {
    const fresh = applyEdits({ ZoneName: 'A/B' }, [
      addTeleportEdit(false, 0, newTeleportTriggerEntry('T', 'A/B')),
    ]) as Record<string, unknown>;
    expect(Object.keys(fresh)).toEqual(['ZoneName', 'Teleports']);
    expect(unmodelledTopLevelKeys(fresh)).toEqual([]);
  });
});

describe('AC1 — the validation engine: one warning, and nothing else (D80a: warn, never block)', () => {
  const DOC: Record<string, unknown> = {
    ZoneName: 'WizardCity/WC_Hub',
    Events: [],
    Teleports: [
      {
        TriggerName: 'Good',
        Teleport: {
          m_exitTeleporter: 0,
          m_teleporterTag: 0,
          m_teleportType: 'TELEPORT_STATIC',
          m_transitionID: 0,
          m_destinationLoc: '1.5e-05,2,3,4',
          m_destinationZone: 'WizardCity/WC_Hub',
        },
      },
      {
        // An unrecognised teleport type and a zone no synced table carries: BOTH must stay
        // finding-free, so the blocking set cannot grow by accident (the converse pin).
        TriggerName: 'Bad',
        Teleport: {
          m_exitTeleporter: 0,
          m_teleporterTag: 0,
          m_teleportType: 'TELEPORT_FROM_A_FUTURE_BUILD',
          m_transitionID: 0,
          m_destinationLoc: '1,2,3',
          m_destinationZone: 'NoSuchWorld/No_Such_Zone',
        },
      },
      {
        // Absent: an untouched absent control writes nothing, so nothing is reported.
        TriggerName: 'Absent',
        Teleport: { m_destinationZone: 'WizardCity/WC_Hub' },
      },
    ],
  };

  it('reports one warning per malformed present value, at the nested field path', () => {
    const result = validateZoneTransfer(DOC);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].kind).toBe('destination-loc-not-four-numbers');
    expect(result.findings[0].severity).toBe('warning');
    expect(result.findings[0].index).toBe(1);
    expect(result.findings[0].path).toEqual(['Teleports', 1, 'Teleport', 'm_destinationLoc']);
    expect(result.findings[0].value).toBe('1,2,3');
    expect(zoneTransferFindings({ Teleports: [] })).toEqual([]);
    // A null value is "no value here", not a malformed one.
    expect(zoneTransferFindings({ Teleports: [{ Teleport: { m_destinationLoc: null } }] })).toEqual(
      [],
    );
    // …but an emptied box's '' is present and reported.
    expect(
      zoneTransferFindings({ Teleports: [{ Teleport: { m_destinationLoc: '' } }] }),
    ).toHaveLength(1);
  });

  it('warns while a malformed value is present, blocks never — the two-sided D80a arm', () => {
    const result = validateZoneTransfer(DOC);
    // Every finding is a warning, `blocking` is empty and Save is therefore never disabled.
    expect(result.blocking).toEqual([]);
    expect(result.warnings).toEqual(result.findings);
    expect(result.blocked).toBe(false);
    expect(result.referenceUsed).toBe(false);

    // The document with every location valid — including the corpus's scientific-notation shape —
    // is not blocked, and produces nothing at all.
    const clean = validateZoneTransfer({
      ZoneName: 'WizardCity/WC_Hub',
      Teleports: [DOC.Teleports && (DOC.Teleports as Record<string, unknown>[])[0]],
    });
    expect(clean.findings).toEqual([]);
    expect(clean.blocking).toEqual([]);
    expect(clean.blocked).toBe(false);

    // The engine's only finding kind is the format check: an unrecognised `m_teleportType` and an
    // unresolvable `m_destinationZone` (row 1 above) contribute nothing, and no reference rule
    // exists in either direction.
    const kinds = new Set(validateZoneTransfer(DOC).findings.map((finding) => finding.kind));
    expect([...kinds]).toEqual(['destination-loc-not-four-numbers']);

    // The UI message is visible, but the Save gate does not see it as an error.
    const messages = toZoneTransferValidationMessages(result);
    expect(messages).toHaveLength(1);
    expect(messages[0].severity).toBe('warning');
    expect(messages[0].field).toBe('Teleports[1].Teleport.m_destinationLoc');
    expect(messages[0].text).toContain('Save stays enabled');
    expect(fieldHasError(messages)).toBe(false);

    // The falsification that made this a warning rather than an error: the three real prose
    // values the owner's corpus carries are reported, and **none** of them closes the gate.
    for (const prose of ZONE_TRANSFER_CORPUS.destinationLocProseValues) {
      const real = validateZoneTransfer({
        ZoneName: 'WizardCity/WC_Hub',
        Teleports: [{ TriggerName: 'T', Teleport: { m_destinationLoc: prose.value } }],
      });
      expect(real.findings).toHaveLength(1);
      expect(real.findings[0].severity).toBe('warning');
      expect(real.blocked).toBe(false);
      expect(fieldHasError(toZoneTransferValidationMessages(real))).toBe(false);
    }

    // The converse, pinned: the shared gate still returns `false` for a clean list, and the
    // corpus-scientific shape stays finding-free.
    expect(fieldHasError([])).toBe(false);
    expect(toZoneTransferValidationMessages(clean)).toEqual([]);
  });
});
