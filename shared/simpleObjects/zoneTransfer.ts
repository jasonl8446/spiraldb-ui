import type { DocEdit, DocPath } from '../document.js';
import { fileNameFor } from '../naming.js';
import type { SimpleFieldSpec } from './model.js';

/**
 * `WizardZoneData` (`ZoneTransfer/`) — plan task 4.8 (story p4-06, AC1 + AC2):
 * docs/spec-domain-reference.md **L281-309** (the schema), **L700-702** (the zone display
 * derivation), **L542-546** (the general validation section), docs/spec-data-model.md **L184**
 * (the filename), and `docs/plan-overview.md` **D5** (merge-not-replace), **D19** + **D26**
 * (naming/resolution), **D57** (validate, never normalise), **D65** (the severity model),
 * **D70(h)** (the rig rules) and **D71** + **D73** (the p4-03…p4-05 contracts).
 *
 * ```json
 * {
 *   "ZoneName": "Karamelle/Interiors/KM_Z10_GobblertonFactory",
 *   "Events": [],
 *   "Teleports": [
 *     {
 *       "TriggerName": "To_Gobblerton",
 *       "Teleport": {
 *         "m_exitTeleporter": 0,
 *         "m_teleporterTag": 0,
 *         "m_teleportType": "TELEPORT_STATIC",
 *         "m_transitionID": 0,
 *         "m_destinationLoc": "2824.861,-6404.079,201.9192,3.13484",
 *         "m_destinationZone": "Karamelle/KM_Z10_Gobblerton"
 *       }
 *     }
 *   ]
 * }
 * ```
 *
 * (That is the **first** real corpus file verbatim, key order and all — the two keys the spec
 * table prints are `ZoneName` and `Teleports`, and the third, `Events`, is the drift field AC2
 * is about.)
 *
 * ## The measured corpus, 2026-09-27 — **every** number below is re-measured by the live sweep
 *
 * | fact | measured |
 * |---|---|
 * | `ZoneTransfer/*.json` files | **1207** |
 * | unparseable files | **0** |
 * | distinct top-level key sets | **1**: `ZoneName` + `Teleports` + `Events` in **1207 / 1207** |
 * | top-level key *orders* | `ZoneName, Events, Teleports` in **1206**; `ZoneName, Teleports, Events` in **1** (`WizardZoneDatas_1-A.json`) |
 * | files whose bytes equal `JSON.stringify(doc, null, 2) + '\n'` | **1206** — a save that edits nothing is byte-identical |
 * | files `serializeDoc` normalises | **1** (`WizardZoneDatas_Tutorial_Interior-A.json` ends with two newlines; the phase AC allows the one-time whitespace-only diff) |
 * | files carrying `Events` | **1207 / 1207** |
 * | `Events` value | an **empty array `[]`** in **1207 / 1207** — the drift field is universal and never carries content |
 * | `Teleports` entries | **2368** across the corpus (was 2,365) |
 * | files with an empty `Teleports` array | **2** |
 * | entries whose keys are exactly `TriggerName` + `Teleport` | **2368 / 2368** |
 * | `TriggerName` values that are strings | **2368 / 2368** |
 * | nested `Teleport` objects carrying exactly the six spec fields | **2368 / 2368** — **no drift inside** the nested object |
 * | nested key *orders* | the serializer's `m_exitTeleporter, m_teleporterTag, m_teleportType, m_transitionID, m_destinationLoc, m_destinationZone` in **2353**; the spec table's `m_destinationLoc, m_destinationZone, m_exitTeleporter, m_teleporterTag, m_teleportType, m_transitionID` in **12** |
 * | `m_destinationLoc` values that are four comma-separated numeric components | **2365 / 2368** — the 3 rejects are the owner's prose (see below) |
 * | …of those, values using **scientific notation** | **135** (5.7%; every one has exactly one scientific component) |
 * | …values a **plain-float** regex rejects | **136** — 133 scientific + the 3 prose values; the trap this module's regex exists for |
 * | distinct `m_teleportType` values | **1**: `TELEPORT_STATIC` in **2368 / 2368** |
 * | distinct `ZoneName` values | **1205** of 1207 (two duplicate pairs — see below) |
 * | `entry_status` rows for `zone_transfer` | **1205**, all `extracted` — created by the first-startup corpus import (D21); the brief said 0 and task 4.10 owns the UI integration, not the rows |
 * | distinct `m_destinationZone` refs | **1072** (was 1069) |
 * | …refs resolving in the `zones` table | **1072 / 1072** — there is **no unknown-reference case** in this corpus |
 * | …refs with **no `ZoneTransfer` file of their own** | **36** — still valid zones, so a dropdown sourced from `zones` covers every reference |
 * | `zones` rows | **1241**, 0 duplicate `zone_path`, 0 blank `display_name` |
 * | `zones` rows whose synced `display_name` **equals** the existing `humanizeZone` | **1172**; differing: **69** |
 * | …restricted to the 1072 referenced zones | **1013** agree, **59** differ |
 *
 * Re-measured at the owner's `f9a1055` baseline (D79/D80): `Teleports` 2,365 → **2,368**,
 * distinct destination zones 1,069 → **1,072**, the nested objects in serializer order
 * 2,353 → **2,355** and in spec order 12 → **13**. All three new entries are real, and **all
 * three carry prose in `m_destinationLoc`** — see the validation decision below.
 *
 * ## The `m_destinationLoc` regex, and why the scientific-notation arm is not optional
 *
 * {@link DESTINATION_LOC_PATTERN} accepts four comma-separated numeric components, each of which
 * may be an integer, a decimal, or **scientific notation** with an optional exponent sign. The
 * scientific arm is load-bearing: **135 of the 2368 real values** carry one, e.g.
 * `1.545422,-1118.252,-1.671345E-05,-3.128352`, and a plain-float regex rejects **136** —
 * **2,365 accept / 3 reject** against the live corpus now (it was 2,365 / 0 before the merge), and
 * the same sweep asserts the plain-float arm would reject the 136, so the two arms are both pinned.
 *
 * The three rejects are the merge's own prose values, and they are **not** malformed data a user
 * typed: `WizardZoneDatas_1-A.json` `Teleports[12]` = `"Start"`, and
 * `WizardZoneDatas_323-A.json` `Teleports[5]`/`[6]` = `"Target location (Street5 Tower1
 * Entrance)"` / `"Target (Street5 FireTheatre Entrance)"`. The owner annotates a teleport's
 * purpose there instead of giving coordinates.
 *
 * The other arm matters just as much: the pattern is **anchored and exact** — no surrounding
 * whitespace, no trailing separator, exactly four components, each component a *number* — so it
 * rejects `1,2,3`, `1,2,3,4,5`, `1.5e-05,2,3,4,`, `1.5e-05, a, 3, 4` and `Infinity,1,2,3`.
 *
 * ## The validation decision: **the format check is the only rule, and it WARNS (D80a)**
 *
 * AC1 says `m_destinationLoc` is "**regex-validated** 4-float string". This module first shipped
 * the rule as **blocking** (D74), on a premise that was stated and measured at the time: a
 * blocking rule is safe *because it has zero corpus violations*, so it can only ever catch a
 * value a user malforms in the editor. **The owner's `f9a1055` merge falsified that premise** —
 * three real teleports carry prose — so the rule was downgraded to a **warning** and the premise
 * was replaced by the measurement that broke it (the lead's ruling, logged as D80a; it amends
 * D74 by measurement, which is D65(a)'s rule: severity follows what the data actually does):
 *
 * - {@link isDestinationLoc} is the regex gate, and {@link zoneTransferFindings} applies it to
 *   **every** `Teleport` of the document — an absent or `null` value produces no finding (an
 *   untouched absent control writes nothing, the p4-02 rule) while a present value that fails
 *   the pattern gets one inline message at `Teleports[i].Teleport.m_destinationLoc`.
 * - The finding is `severity: 'warning'`, it appears in `warnings`, `blocking` is empty and
 *   `blocked` is `false` for every document — so **Save stays enabled** on the three real files
 *   the owner ships (the D73(a) warn-not-block mechanism, and the same reason p4-08's spurious
 *   400 was a defect: the tool must not reject the owner's data). The inline message still says
 *   what the format is, so the warning remains visible rather than silent.
 * - **No reference rule at all** exists here, invented or otherwise. The spec's L542-546
 *   "Zone paths must match known zones" would fire zero times on this corpus (1,072 of 1,072
 *   references resolve), so a rule would be pure copy with no surface; {@link
 *   ZONE_TRANSFER_CORPUS.destinationZonesResolvingInZonesTable} records the measurement instead
 *   of a rule. The converse is pinned in the tests: an unknown `m_teleportType` and an
 *   unresolvable destination zone produce **no** finding, so nothing else became a warning by
 *   accident.
 *
 * ## The drift guard: `Events` is *known*, *unmodelled*, and preserved
 *
 * Three key sets, deliberately distinct, because collapsing them would lose the AC:
 *
 * | constant | contents | why |
 * |---|---|---|
 * | {@link ZONE_TRANSFER_KNOWN_TOP_LEVEL_KEYS} | `ZoneName`, `Teleports`, `Events` | the **measured** key set of all 1207 files — what the sweep asserts |
 * | {@link ZONE_TRANSFER_MODELLED_TOP_LEVEL_KEYS} | `ZoneName`, `Teleports` | the keys an edit may write; the schema's own two |
 * | the disclosure | every document key outside the modelled set | here `Events`, in document order |
 *
 * So `Events` is never written, never removed, never reordered and never hidden: the form renders
 * it read-only with the measured note ({@link rawFieldNote}), and D5's merge-not-replace carries
 * the value through every edit — proven byte-for-byte by the story's no-op-edit and edit arms.
 * A key outside the known three (none measured, ever) lands in the same disclosure, which is why
 * the disclosure is "everything the model does not edit" rather than "the `Events` key".
 *
 * Nothing here **invents** `Events` either: a document that does not carry it (a create) is left
 * without it. The editor cannot know whether an empty array is required, and D57's
 * "validate, never normalise" plus D5's "never rebuild a document from a partial schema" both
 * forbid adding structure the file did not have.
 *
 * ## The key is the `ZoneName`, and the two duplicate pairs are a real collapse
 *
 * 1207 files hold **1205** distinct `ZoneName`s: `WizardCity/Tutorial_Exterior` and
 * `WizardCity/Tutorial_Interior` each appear twice. The D19 content-keyed index collapses them
 * to one entry per key (which is why `/api/zone-transfers` already answers 1205 rows), so the
 * page's key is the route's own `ZoneName` string — `displayKeyFor` returns a text-family key
 * **verbatim** (`/` included; the client encodes it as `%2F` and Express decodes it back) — and
 * a save reaches the one file the index resolved. The second file behind a duplicated key is
 * *not* separately addressable from the list, and this module states that rather than inventing
 * a disambiguator (the p4-01/D69 collapse contract, unchanged here).
 *
 * ## The dropdown's label is the synced `display_name` — there is no second humanizer
 *
 * `client/src/lib/display.ts`'s `formatNameRow('zones', row)` already prefers
 * `zones.display_name` (`"Aquila / AQ Z00 Hub"` for `Aquila/AQ_Z00_Hub`) and falls back to its
 * existing `humanizeZone` only when the synced label is blank (0 of 1241 rows are blank). The
 * two are **not** identical: they agree on **1172** of 1241 rows and differ on **69**, every one
 * of them a digit/letter boundary. `DS_A1Z1_WizardTower` is the shape: the synced label keeps
 * `A1Z1` as one word (`DS A1Z1 Wizard Tower`) while the humanizer's `([a-z0-9])([A-Z])` rule
 * splits it (`DS A1 Z1 Wizard Tower`). So the two agree on the documented `WizardCity/WC_Hub`
 * case and part company only where a zone token mixes digits and capitals.
 *
 * Where they differ the **synced value wins**, because it is the data this project is told to
 * trust (AGENTS.md rule 2: friendly names are synced, not hardcoded) — and `formatNameRow`
 * already prefers it. This module therefore renders **no** humanizer of its own and re-derives
 * nothing: the page passes `type="zones"` and the names type's label is what the user sees. Both
 * counts are constants so the day the synced data changes the sweep says so.
 *
 * The create name is {@link zoneTransferCreateName}, which delegates to `shared/naming.ts`'s
 * `fileNameFor` — the single home of the `/` → `_` transform — and is asserted to produce
 * `zonetransfer_WizardCity_WC_Hub.json` (AC2). Nothing here hand-builds a filename.
 */

/** The measured facts above, as data — one home for every number (D73(h): the unit is in the name). */
export const ZONE_TRANSFER_CORPUS = {
  /** `ZoneTransfer/*.json` files in the fork. */
  files: 1207,
  /** Files that failed to parse. */
  unparseableFiles: 0,
  /** The three top-level keys every file carries, in the spec's own reading order. */
  topLevelKeys: ['ZoneName', 'Teleports', 'Events'],
  /** Files carrying the measured key set above. */
  filesWithKnownTopLevelKeySet: 1207,
  /** Files whose top-level key order is `ZoneName, Events, Teleports`. */
  filesWithOrderZoneNameEventsTeleports: 1206,
  /** Files whose top-level key order is `ZoneName, Teleports, Events`. */
  filesWithOrderZoneNameTeleportsEvents: 1,
  /**
   * The **one** file behind that second order — `WizardZoneDatas_1-A.json`, a legacy name the
   * D19 index resolves by content (nothing derives it).
   */
  orderOutlierFileName: 'WizardZoneDatas_1-A.json',
  /**
   * Files whose bytes equal `JSON.stringify(doc, null, 2) + '\n'` — i.e. a save that edits nothing
   * writes the file back **byte-identically** (D5's merge-not-replace, measured rather than
   * asserted).
   */
  filesByteIdenticalAfterSerialize: 1206,
  /**
   * The **one** file that `serializeDoc` normalises — `WizardZoneDatas_Tutorial_Interior-A.json`
   * ends with **two** newlines, so the first save of it produces a whitespace-only diff (which
   * the phase's AC explicitly allows: "plus one-time formatting normalization"). No file lacks a
   * trailing newline, so the normalisation is never the other direction.
   */
  filesNormalisedBySerialize: 1,
  /** The file with two trailing newlines. */
  doubleTrailingNewlineFileName: 'WizardZoneDatas_Tutorial_Interior-A.json',
  /** Files carrying the drift key `Events`. */
  filesWithEvents: 1207,
  /** Files whose `Events` value is an empty array. */
  filesWithEmptyEvents: 1207,
  /** `Teleports` entries across the corpus. */
  teleports: 2368,
  /** Files carrying an empty `Teleports` array. */
  filesWithEmptyTeleports: 2,
  /** Entries whose keys are exactly `TriggerName` + `Teleport`. */
  entriesWithTriggerAndTeleport: 2368,
  /** `TriggerName` values that are strings. */
  triggerNameStrings: 2368,
  /** Nested `Teleport` objects carrying exactly the six spec fields. */
  teleportObjectsWithSixKeys: 2368,
  /** Nested objects in the serializer's dominant key order (2355 now; 2353 before the merge). */
  teleportObjectsInSerializerOrder: 2355,
  /** Nested objects in the spec table's key order (13 now; 12 before). */
  teleportObjectsInSpecOrder: 13,
  /** `m_destinationLoc` values that are four comma-separated numeric components. */
  destinationLocValues: 2368,
  /**
   * `m_destinationLoc` values the format pattern **accepts**. 2,368 − 3 = 2,365, and the 3 are
   * the owner's prose annotations (see {@link destinationLocProseValues}) — this is the number
   * that replaced D74's "2,365 of 2,365 accepted, zero corpus violations".
   */
  destinationLocValuesAcceptedByFormatPattern: 2365,
  /** `m_destinationLoc` values the format pattern rejects: the 3 prose values, and only them. */
  destinationLocValuesRejectedByFormatPattern: 3,
  /**
   * The three real values that fail the format — the measurement that made the rule a warning
   * (D80a). Kept as data, with their addresses, so the claim is checkable without re-sweeping.
   */
  destinationLocProseValues: [
    { file: 'WizardZoneDatas_1-A.json', index: 12, value: 'Start' },
    {
      file: 'WizardZoneDatas_323-A.json',
      index: 5,
      value: 'Target location (Street5 Tower1 Entrance)',
    },
    {
      file: 'WizardZoneDatas_323-A.json',
      index: 6,
      value: 'Target (Street5 FireTheatre Entrance)',
    },
  ],
  /** `m_destinationLoc` values carrying scientific notation (one component each). */
  destinationLocScientificValues: 135,
  /** `m_destinationLoc` values a plain-float regex rejects: 136 (133 + the 3 prose values). */
  destinationLocValuesRejectedByPlainFloatRegex: 136,
  /** `m_teleportType` values that are `TELEPORT_STATIC`. */
  teleportTypeStaticValues: 2368,
  /** Distinct `m_teleportType` values in the corpus. */
  distinctTeleportTypes: 1,
  /** `ZoneName` values across the corpus (1207 files). */
  zoneNames: 1207,
  /** Distinct `ZoneName` values — 1205, the content-keyed index's own row count. */
  distinctZoneNames: 1205,
  /** The two duplicated keys, each carried by two files. */
  duplicateZoneNames: ['WizardCity/Tutorial_Exterior', 'WizardCity/Tutorial_Interior'],
  /** `entry_status` rows for `zone_transfer` — 0; status integration is task 4.10. */
  /**
   * `entry_status` rows for `zone_transfer` in the measured local database: **1205**, every one
   * `extracted`. (Corrected by this story: the brief said 0. The first-startup corpus import
   * creates them — `server/src/services/import.ts` lists `zone_transfer` in `IMPORT_TYPE_SPECS`,
   * and 1205 is exactly the distinct-key count because the two duplicate pairs are skipped with
   * first-file-wins. `GET /api/status/zone_transfers` answers those 1205 entries to match.
   * Task 4.10 still owns the *UI* integration — badges, filter tabs, transitions — but the rows
   * exist today.)
   */
  statusRows: 1205,
  /** Distinct `m_destinationZone` references (1,072 now; 1,069 before the merge). */
  distinctDestinationZones: 1072,
  /** References resolving in the `zones` table — all of them. */
  destinationZonesResolvingInZonesTable: 1072,
  /** References with no `ZoneTransfer` file of their own — still valid zones. */
  destinationZonesWithoutOwnFile: 36,
  /**
   * `zones` rows — the dropdown's source. **3,357** since the Phase 6 breadth sync (D120: 3,356
   * `WizardZoneData` rows plus the one corpus-only `Karamelle/KM_Z06_Mines`); it was 1,241 (the
   * distinct `ZoneName` + destination set of the 1,207 ZoneTransfer files) while the table was
   * derived from the corpus alone. Re-measured at p7-02 (D145) on a `npm run sync` rebuild.
   */
  zoneRows: 3357,
  /** `zones.zone_path` duplicates: 0 (it is the primary key). */
  duplicateZonePaths: 0,
  /** `zones.display_name` values that are NULL or blank: 1 (was 0 with the 1,241-row table). */
  blankZoneDisplayNames: 1,
  /** `zones` rows whose synced `display_name` equals `humanizeZone(zone_path)`: the 18 D120 fallbacks. */
  zoneDisplayNamesAgreeingWithHumanizer: 18,
  /** `zones` rows where the two differ: 3,339 — the real `WizardZone_*` labels (was 69, digit/letter boundaries). */
  zoneDisplayNamesDifferingFromHumanizer: 3339,
  /** Of the 1,072 referenced zones, rows where the synced label agrees (was 1,013). */
  referencedZoneDisplayNamesAgreeing: 1,
  /** Of the 1072 referenced zones, rows where the two differ (was 59). */
  referencedZoneDisplayNamesDiffering: 1071,
} as const;

/** The document key holding the family's key field (`ZoneName`). */
export const ZONE_TRANSFER_KEY_FIELD = 'ZoneName';

/** The document key holding the repeater (`Teleports`). */
export const ZONE_TRANSFER_LIST_KEY = 'Teleports';

/** The document key the spec schema does not model and every corpus file carries (`Events`). */
export const ZONE_TRANSFER_DRIFT_KEY = 'Events';

/** The **measured** top-level key set of all 1207 files, in the spec's reading order. */
export const ZONE_TRANSFER_KNOWN_TOP_LEVEL_KEYS = ['ZoneName', 'Teleports', 'Events'] as const;

/** The top-level keys an edit may write — the schema's own two. */
export const ZONE_TRANSFER_MODELLED_TOP_LEVEL_KEYS = ['ZoneName', 'Teleports'] as const;

/** One `Teleports` entry's two keys, in the file's dominant order (2368 / 2368 carry both). */
export const ZONE_TRANSFER_ENTRY_KEYS = ['TriggerName', 'Teleport'] as const;

/**
 * The nested object's six keys in the **corpus's dominant order** (2355 of 2368) — the order a
 * newly added entry is built in, so a new row looks like the files around it. The spec table's
 * own order (L281-309, and the 12 files that match it) is recorded in the corpus constant above;
 * nothing here rewrites an existing object's order (D5/D57).
 */
export const TELEPORT_KEYS = [
  'm_exitTeleporter',
  'm_teleporterTag',
  'm_teleportType',
  'm_transitionID',
  'm_destinationLoc',
  'm_destinationZone',
] as const;

/** Every nested key of the `Teleport` object. */
export type TeleportKey = (typeof TELEPORT_KEYS)[number];

/** The three nested keys that hold JSON numbers. */
export const TELEPORT_NUMBER_KEYS = [
  'm_exitTeleporter',
  'm_teleporterTag',
  'm_transitionID',
] as const;

/** One of the three numeric nested keys. */
export type TeleportNumberKey = (typeof TELEPORT_NUMBER_KEYS)[number];

/**
 * The **whole** measured vocabulary of `m_teleportType`: one member. The spec words the field
 * "enum, e.g. `TELEPORT_STATIC`" (L281-309), and the corpus has exactly this one value in
 * 2368 of 2368 entries — so the control offers this member and **invents no others**.
 */
export const TELEPORT_TYPE_KNOWN_MEMBERS = ['TELEPORT_STATIC'] as const;

/** The `m_teleportType` a newly added entry starts from — the corpus's one measured member. */
export const NEW_TELEPORT_TYPE: string = TELEPORT_TYPE_KNOWN_MEMBERS[0];

/** The `m_destinationLoc` a newly added entry starts from — a valid four-component string. */
export const NEW_TELEPORT_DESTINATION_LOC = '0,0,0,0';

/** The numeric nested keys' value in a newly added entry. */
export const NEW_TELEPORT_NUMBER = 0;

/**
 * One numeric component of `m_destinationLoc`: an optional sign, then an integer or a decimal
 * (with either side optional around the point), then an optional exponent with an optional sign.
 *
 * `1e5`, `1E+5`, `-1.5E-05`, `0`, `-0.0` and `.5` are components; `1e`, `--1`, `Infinity`,
 * `NaN`, `1.` and the empty string are not.
 */
export const DESTINATION_LOC_COMPONENT_PATTERN =
  '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?';

/**
 * The `m_destinationLoc` format: exactly four of
 * {@link DESTINATION_LOC_COMPONENT_PATTERN}, comma-separated, **anchored** — no surrounding
 * whitespace and no trailing separator.
 *
 * The scientific-notation arm is required by the measured corpus: 135 of 2368 real values carry
 * one and a plain-float pattern rejects every one of them.
 */
export const DESTINATION_LOC_PATTERN = new RegExp(
  `^${DESTINATION_LOC_COMPONENT_PATTERN}(?:,${DESTINATION_LOC_COMPONENT_PATTERN}){3}$`,
);

/**
 * The pattern a *plain float* check would be — kept so the sweep can prove the two arms of the
 * `m_destinationLoc` decision on the live corpus: this one rejects **136** real values and
 * {@link DESTINATION_LOC_PATTERN} rejects **0**.
 *
 * It is **not** used by the editor; it exists as the falsification arm (D66's discipline: a test
 * that cannot show what would have failed is not evidence).
 */
export const PLAIN_FLOAT_DESTINATION_LOC_PATTERN = /^-?\d+(?:\.\d+)?(?:,-?\d+(?:\.\d+)?){3}$/;

/**
 * The `m_destinationLoc` help line under every row's box — the format in the user's words, with
 * the measured scientific-notation fact that makes the pattern's width non-obvious. The spec
 * prints no meaning for the four components (the nested object is only in L281-309's example),
 * so none is invented here.
 */
export const DESTINATION_LOC_HINT =
  'Four comma-separated numbers. Scientific notation is valid and appears in 135 of the corpus’s 2,368 real values (e.g. -1.671345E-05).';

/** The disclosure's summary text — one home, so the form and the tier-1 spec cannot drift. */
export const RAW_FIELDS_LABEL = 'Raw fields';

/**
 * The note the disclosure prints for one unmodelled key. `Events` gets the measured sentence the
 * AC asks for — the field is real, universal and empty — and any other key gets the honest
 * generic one.
 */
export function rawFieldNote(key: string): string {
  if (key === ZONE_TRANSFER_DRIFT_KEY) {
    return (
      'Events is not in the spec schema (docs/spec-domain-reference.md L281-309) but every one ' +
      'of the 1,207 corpus files carries it, and in all 1,207 it is an empty array. The editor ' +
      'never edits it, never removes it and never rewrites it: it is written back byte-for-byte.'
    );
  }
  return (
    'This key is not modelled by this editor (the schema’s own keys are ZoneName and Teleports). ' +
    'It is shown read-only and is written back byte-for-byte.'
  );
}

/** The document's two fields, in the reading order of the form. */
export const ZONE_TRANSFER_FIELDS: readonly SimpleFieldSpec[] = [
  {
    key: ZONE_TRANSFER_KEY_FIELD,
    label: 'Zone name',
    kind: 'zone-select',
    namesType: 'zones',
    required: true,
    corpusPresence: 1207,
    help: 'The key of this file: the zone’s full path, e.g. WizardCity/WC_Hub. The dropdown shows the synced display name; a new file is named with the path’s slashes written as underscores.',
  },
  {
    key: ZONE_TRANSFER_LIST_KEY,
    label: 'Teleports',
    kind: 'zone-teleport-list',
    required: true,
    corpusPresence: 1207,
    help: 'Each entry is a TriggerName plus a nested Teleport object. The nested object’s six keys are preserved whole; 2,368 entries across the corpus carry no drift inside.',
  },
];

/* ------------------------------------------------------------------ the readers */

/** One repeater row: the entry object, its position, and its nested `Teleport` object. */
export interface TeleportTriggerView {
  /** The entry's position in the document array — every edit path is addressed by this. */
  readonly index: number;
  readonly entry: Record<string, unknown>;
  /** The entry's `TriggerName`, verbatim (`undefined` when the key is absent). */
  readonly triggerName: unknown;
  /** The entry's nested `Teleport`, when it is a plain object; `null` otherwise. */
  readonly teleport: Record<string, unknown> | null;
}

/** One top-level key the editor does not model, in the document's own order. */
export interface RawTopLevelFieldView {
  readonly key: string;
  readonly value: unknown;
}

/** `true` for a non-null, non-array object. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `true` when a value is the `m_destinationLoc` format: four comma-separated numbers, the
 * scientific-notation arm included (see {@link DESTINATION_LOC_PATTERN}).
 *
 * **Validates, never normalises**: a value that fails is returned to the caller byte-for-byte —
 * nothing here trims, rounds, re-serialises or rewrites it.
 */
export function isDestinationLoc(value: unknown): value is string {
  return typeof value === 'string' && DESTINATION_LOC_PATTERN.test(value);
}

/**
 * The `Teleports` array as renderable rows, in document order.
 *
 * `[]` for a key that is absent, `null` or not an array — the "no list here" shapes a form
 * renders as its empty state, which is also what an **empty array** renders (the corpus really
 * has two). An element that is not a plain object is skipped for the same reason the p4-05
 * reader documents: 2368 of 2368 entries are objects, and no row can be built from anything else.
 *
 * The nested `Teleport` comes back as the document's **own object reference** — the "preserved
 * whole" half of the AC. A row edit addresses one nested field path, so the other five keys, the
 * object's own key order and any key inside it the model does not know all survive.
 */
export function readTeleports(document: Record<string, unknown>): TeleportTriggerView[] {
  const raw = document[ZONE_TRANSFER_LIST_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }
  const rows: TeleportTriggerView[] = [];
  raw.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      return;
    }
    rows.push({
      index,
      entry,
      triggerName: entry.TriggerName,
      teleport: isPlainObject(entry.Teleport) ? entry.Teleport : null,
    });
  });
  return rows;
}

/**
 * Every top-level key the editor does **not** model, in the document's own order.
 *
 * On every corpus file this is exactly `['Events']` — the drift key AC2 is about. On a document
 * carrying something else it is that key too, which is the point: the disclosure is
 * "everything this editor does not edit", not a hard-coded `Events` arm.
 */
export function unmodelledTopLevelKeys(document: Record<string, unknown>): string[] {
  const modelled = new Set<string>(ZONE_TRANSFER_MODELLED_TOP_LEVEL_KEYS);
  return Object.keys(document).filter((key) => !modelled.has(key));
}

/** The same keys with their values, as one object in document order — what the disclosure prints. */
export function rawTopLevelFields(document: Record<string, unknown>): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const key of unmodelledTopLevelKeys(document)) {
    raw[key] = document[key];
  }
  return raw;
}

/** The same keys and values as a list of views (the form's own render shape). */
export function readRawTopLevelFields(document: Record<string, unknown>): RawTopLevelFieldView[] {
  return unmodelledTopLevelKeys(document).map((key) => ({ key, value: document[key] }));
}

/** One option of the `m_teleportType` control. */
export interface TeleportTypeOption {
  readonly value: string;
  readonly label: string;
  /** `true` only for a stored value the model does not know — kept, never rewritten. */
  readonly unrecognised: boolean;
}

/**
 * The `m_teleportType` control's options for one stored value.
 *
 * Always the measured member(s) ({@link TELEPORT_TYPE_KNOWN_MEMBERS}) first. A stored value the
 * model does **not** know is appended **verbatim** as an extra option marked unrecognised, so it
 * renders as the selected value and a save that never touches this control writes it back
 * unchanged — an editor that silently rewrote an unrecognised enum is the failure this function
 * exists to prevent. No member is ever invented.
 *
 * A stored value that is absent, `null` or blank yields the known members only; the control then
 * has no matching option and writes nothing until the user picks one (absence is preserved).
 */
export function teleportTypeOptions(stored: unknown): TeleportTypeOption[] {
  const options: TeleportTypeOption[] = TELEPORT_TYPE_KNOWN_MEMBERS.map((value) => ({
    value,
    label: value,
    unrecognised: false,
  }));
  if (typeof stored === 'string' && stored.trim() !== '') {
    const known: readonly string[] = TELEPORT_TYPE_KNOWN_MEMBERS;
    if (!known.includes(stored)) {
      options.push({
        value: stored,
        label: `${stored} (unrecognised — kept as stored)`,
        unrecognised: true,
      });
    }
  }
  return options;
}

/** `true` when a stored `m_teleportType` is a non-blank value the model does not know. */
export function teleportTypeIsUnrecognised(stored: unknown): boolean {
  return (
    typeof stored === 'string' &&
    stored.trim() !== '' &&
    !(TELEPORT_TYPE_KNOWN_MEMBERS as readonly string[]).includes(stored)
  );
}

/* ------------------------------------------------------------- the edit builders */

/** The repeater array's path: `['Teleports']`. */
export function teleportListPath(): DocPath {
  return [ZONE_TRANSFER_LIST_KEY];
}

/** One entry's path: `['Teleports', 2]`. */
export function teleportEntryPath(index: number): DocPath {
  return [ZONE_TRANSFER_LIST_KEY, index];
}

/** One entry's `TriggerName` path: `['Teleports', 2, 'TriggerName']`. */
export function teleportTriggerNamePath(index: number): DocPath {
  return [ZONE_TRANSFER_LIST_KEY, index, 'TriggerName'];
}

/** One nested field's path: `['Teleports', 2, 'Teleport', 'm_destinationLoc']`. */
export function teleportFieldPath(index: number, key: TeleportKey | string): DocPath {
  return [ZONE_TRANSFER_LIST_KEY, index, 'Teleport', key];
}

/**
 * A new entry in the corpus's dominant key orders: `{TriggerName, Teleport}` and the nested
 * object's serializer order (2355 of 2368).
 *
 * The six nested values are the schema's neutral ones — `0,0,0,0` for the location, the caller's
 * zone (or `''` when the document has no `ZoneName` yet), `0` for the three numbers and the one
 * measured teleport type. Nothing here invents a member or a zone path.
 */
export function newTeleportTriggerEntry(
  triggerName: string,
  destinationZone: string,
): Record<string, unknown> {
  return {
    TriggerName: triggerName,
    Teleport: {
      m_exitTeleporter: NEW_TELEPORT_NUMBER,
      m_teleporterTag: NEW_TELEPORT_NUMBER,
      m_teleportType: NEW_TELEPORT_TYPE,
      m_transitionID: NEW_TELEPORT_NUMBER,
      m_destinationLoc: NEW_TELEPORT_DESTINATION_LOC,
      m_destinationZone: destinationZone,
    },
  };
}

/**
 * The edit that appends `entry`. `Teleports` is present in every corpus file, but the edit is
 * still keyed on presence: an `insert` into a key that does not exist would throw
 * (`shared/document.ts` never invents structure), so a document without the key takes one `set`
 * of a one-element array — the p4-03/p4-05 rule.
 */
export function addTeleportEdit(
  hasTeleports: boolean,
  currentLength: number,
  entry: Record<string, unknown>,
): DocEdit {
  if (!hasTeleports) {
    return { op: 'set', path: teleportListPath(), value: [entry] };
  }
  return { op: 'insert', path: teleportListPath(), index: currentLength, value: entry };
}

/**
 * The edit that removes the entry at `index`. The path is the **element**, not one of its fields:
 * `delete` on an array index splices, while deleting `['Teleports', i, 'TriggerName']` would
 * leave a one-key entry behind — and would orphan the nested object.
 */
export function removeTeleportEdit(index: number): DocEdit {
  return { op: 'delete', path: teleportEntryPath(index) };
}

/**
 * The edit a row's `TriggerName` box produces: the typed string **verbatim** (D57 — no `trim`,
 * no case folding). A non-string (which a text input cannot produce) is a no-op.
 */
export function teleportTriggerNameEdit(index: number, raw: unknown): DocEdit | null {
  if (typeof raw !== 'string') {
    return null;
  }
  return { op: 'set', path: teleportTriggerNamePath(index), value: raw };
}

/**
 * The edit the `m_destinationLoc` box produces: the typed string **verbatim**, valid or not.
 *
 * Writing what the user typed is what makes the format check observable — {@link
 * zoneTransferFindings} reads the document, so a value that was silently dropped could never be
 * reported. The stored value is never trimmed, rounded or re-serialised.
 */
export function teleportDestinationLocEdit(index: number, raw: unknown): DocEdit | null {
  if (typeof raw !== 'string') {
    return null;
  }
  return { op: 'set', path: teleportFieldPath(index, 'm_destinationLoc'), value: raw };
}

/**
 * The edit the `m_destinationZone` control produces: the zone path the dropdown handed back,
 * **verbatim**. A blank value is refused (it is not a zone path) and produces no edit rather
 * than deleting a key the schema requires — the p4-05 `textIdFromRaw` rule, applied to a single
 * value rather than a list.
 */
export function teleportDestinationZoneEdit(index: number, raw: unknown): DocEdit | null {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null;
  }
  return { op: 'set', path: teleportFieldPath(index, 'm_destinationZone'), value: raw };
}

/**
 * The edit one of the three numeric nested boxes produces: a finite number written verbatim, `0`
 * for an emptied box.
 *
 * An emptied box writes `0` rather than deleting the key: all six nested keys are present in
 * 2368 of 2368 entries and the schema marks them required, so a deletion would write a shape the
 * schema forbids (the D71(c) rule). A value that is not a finite number (`1e`, `-` while typing)
 * produces **no** edit rather than a `NaN`.
 */
export function teleportNumberEdit(
  index: number,
  key: TeleportNumberKey,
  raw: string,
): DocEdit | null {
  if (raw.trim() === '') {
    return { op: 'set', path: teleportFieldPath(index, key), value: NEW_TELEPORT_NUMBER };
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  return { op: 'set', path: teleportFieldPath(index, key), value };
}

/**
 * The edit the `m_teleportType` control produces: the chosen member (or the unrecognised stored
 * value, re-chosen) written **verbatim** as a string.
 *
 * A blank or non-string value produces no edit — the nested object's six keys are present in
 * 2368 of 2368 entries, so an edit always writes a present string, and absence is preserved by
 * writing nothing.
 */
export function teleportTypeEdit(index: number, raw: unknown): DocEdit | null {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null;
  }
  return { op: 'set', path: teleportFieldPath(index, 'm_teleportType'), value: raw };
}

/**
 * A row's `m_teleportType` as the control's own value.
 *
 * The stored value comes back verbatim, **including one the model does not know** — that is the
 * whole point of {@link teleportTypeOptions}. Only an absent, `null` or non-string value falls
 * back to `''`, which selects no option and writes nothing.
 */
export function teleportTypeValue(stored: unknown): string {
  return typeof stored === 'string' ? stored : '';
}

/**
 * The create name of a new `ZoneTransfer` file for `zoneName`, through `shared/naming.ts` —
 * never a hand-built string.
 *
 * `fileNameFor('zonetransfer', 'WizardCity/WC_Hub')` → `'zonetransfer_WizardCity_WC_Hub.json'`
 * (docs/spec-data-model.md L184, AC2), and the `/` → `_` transform is lossy in the documented
 * direction only.
 *
 * @throws {NamingError} see `fileNameFor`: a blank key, a NUL, or a key already ending in `.json`.
 */
export function zoneTransferCreateName(zoneName: string): string {
  return fileNameFor('zonetransfer', zoneName);
}

/* -------------------------------------------------------------------- the engine */

/**
 * The severities this family emits. It was `'error'` alone until D80a; the one rule is a warning
 * now. Both members stay (rather than narrowing to `'warning'`) because `validateZoneTransfer`
 * partitions the findings on exactly this field, so a future blocking rule needs no type change.
 */
export type ZoneTransferValidationSeverity = 'error' | 'warning';

/** The family's single finding kind. */
export type ZoneTransferFindingKind = 'destination-loc-not-four-numbers';

/** One structured finding. Never a sentence, never a bare string. */
export interface ZoneTransferFinding {
  kind: ZoneTransferFindingKind;
  severity: ZoneTransferValidationSeverity;
  /** The offending field's exact path: `['Teleports', 3, 'Teleport', 'm_destinationLoc']`. */
  path: DocPath;
  /** The offending value, verbatim (never a normalised copy). */
  value: unknown;
  /** The row's position in the document array — what a form keys the row by. */
  index: number;
  /** A one-line machine-friendly detail (`"1,2,3" is not four comma-separated numbers`). */
  detail: string;
}

export interface ZoneTransferValidationResult {
  /** Every finding, in document order. */
  findings: ZoneTransferFinding[];
  /**
   * **Always empty at this baseline**: the family's one rule is a warning now (D80a, amending
   * D74 — 3 of the 2,368 real corpus values are prose, so a blocking rule would refuse to save
   * three real files). Kept as a named field so a caller reads the same result shape as every
   * other engine, and typed as an array so a future blocking rule has one obvious place to land.
   */
  blocking: ZoneTransferFinding[];
  /** The same findings as `findings` — this family's every finding is a warning. */
  warnings: ZoneTransferFinding[];
  /**
   * `true` exactly when the document has a **blocking** finding — a real computation over
   * `blocking`, so a future error-severity rule flips it. With the format rule a warning it is
   * `false` for every document, and the page's Save gate (`fieldHasError(messages)`) is
   * therefore never closed by this family.
   */
  blocked: boolean;
  /**
   * **Always `false`**: this engine consults no reference table at all (there is no zone-path
   * rule — 1,072 of 1,072 references resolve). Named so a caller reads one result shape.
   */
  referenceUsed: false;
}

/**
 * The document's `m_destinationLoc` findings — the AC1 format check, one **warning** per row
 * whose value is present and fails {@link isDestinationLoc}.
 *
 * An absent or `null` value produces no finding (an untouched absent control writes nothing; a
 * rule that complained about a key the document never had would be noise). An **empty string** is
 * present and fails the pattern, so it is reported — it is what an emptied box writes.
 *
 * Nothing else in the document is inspected: an unrecognised `m_teleportType` and a
 * `m_destinationZone` no synced zone carries both produce **no** finding, which the unit tests
 * pin so the warning set cannot grow by accident.
 */
export function zoneTransferFindings(document: Record<string, unknown>): ZoneTransferFinding[] {
  const findings: ZoneTransferFinding[] = [];
  for (const { index, teleport } of readTeleports(document)) {
    if (teleport === null) {
      continue;
    }
    const value = teleport.m_destinationLoc;
    if (value === undefined || value === null) {
      continue;
    }
    if (isDestinationLoc(value)) {
      continue;
    }
    findings.push({
      kind: 'destination-loc-not-four-numbers',
      severity: 'warning',
      path: teleportFieldPath(index, 'm_destinationLoc'),
      value,
      index,
      detail: `${JSON.stringify(value)} is not four comma-separated numbers`,
    });
  }
  return findings;
}

/**
 * The family's validation pass: one **warning** per malformed `m_destinationLoc`, and nothing
 * else (see the header for the decision, its amendment and the measurement behind it).
 *
 * It validates and never normalises (D57): it reads, it never writes, and the offending value is
 * kept verbatim in the finding.
 */
export function validateZoneTransfer(
  document: Record<string, unknown>,
): ZoneTransferValidationResult {
  const findings = zoneTransferFindings(document);
  const blocking = findings.filter((finding) => finding.severity === 'error');
  return {
    findings,
    blocking,
    warnings: findings.filter((finding) => finding.severity === 'warning'),
    blocked: blocking.length > 0,
    referenceUsed: false,
  };
}
