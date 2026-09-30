import { CATALOG_Q_PARAM, MISSING_ONLY_PARAM } from '@shared/quest/catalog';
import { describe, expect, it } from 'vitest';

import {
  CATALOG_EVIDENCE_ACTION,
  CATALOG_INFERRED_BADGE,
  CATALOG_MISSING_ONLY_LABEL,
  CATALOG_NO_MISSING,
  CATALOG_NO_TITLE,
  CATALOG_SCAFFOLD_ACTION,
  catalogCountText,
  catalogNoMatchText,
  catalogQuery,
  catalogRequestPath,
  catalogRowAction,
  catalogTitleIsInferred,
  catalogTitleText,
  coverageHeadline,
  coveragePercentLabel,
  definedCellText,
  groupDigits,
  questEvidencePath,
  type QuestCatalogRow,
  type QuestCoverage,
} from '../../client/src/lib/quest-catalog';
import { RAIL_TAB_EVIDENCE, RAIL_TAB_QUERY_PARAM } from '../../client/src/lib/quests';

/**
 * Task 6.10 / story **p6-11** — the catalog's pure half: the query builder ac2 asks for, the
 * header sentence ac1 asserts, and the row action that makes a row a work item.
 *
 * Everything here is a pure function over the wire values, so the assertions are exact strings.
 * The rendered page (the header's text node, the filter actually re-requesting, the link's `href`)
 * is the tier-1 spec's job (`tests/ui/quests-catalog.spec.ts`), not this file's.
 */

/** The coverage the API serves today on the scratch clone; deliberately the measured numbers. */
const COVERAGE: QuestCoverage = {
  nameable: 1717,
  id_space: 4823,
  defined: 322,
  missing: 1395,
  references: 2855,
  corpus: { spiraldb_path: '/tmp/p6-11/scratch-copy.db-root', quest_files: 322 },
};

/* ---------------------------------------------------------------- the header */

describe('coverageHeadline — the sentence the header renders', () => {
  it('is the spec sentence, with every number from the response and the corpus named', () => {
    expect(coverageHeadline(COVERAGE)).toBe(
      '322 defined of 1,717 nameable of ~4,823 quests the client holds text for' +
        ' — corpus: /tmp/p6-11/scratch-copy.db-root (322 quest files)',
    );
  });

  it('takes its numbers from its argument, so a changed view changes the sentence', () => {
    const headless = coverageHeadline({
      defined: 4,
      nameable: 11,
      id_space: 5,
      corpus: { spiraldb_path: '/x/test-spiraldb', quest_files: 4 },
    });
    expect(headless).toContain('4 defined');
    expect(headless).toContain('of 11 nameable');
    expect(headless).toContain('of ~5 quests');
    expect(headless).toContain('corpus: /x/test-spiraldb (4 quest files)');
    expect(headless).not.toContain('322');
    expect(headless).not.toContain('1,717');
  });

  it('names the corpus honestly when the setting is unset', () => {
    const headline = coverageHeadline({
      ...COVERAGE,
      corpus: { spiraldb_path: '  ', quest_files: 0 },
    });
    expect(headline).toContain('corpus: not configured (0 quest files)');
  });

  it('groups thousands separators without depending on the runtime locale', () => {
    expect(groupDigits(0)).toBe('0');
    expect(groupDigits(7)).toBe('7');
    expect(groupDigits(322)).toBe('322');
    expect(groupDigits(1717)).toBe('1,717');
    expect(groupDigits(1234567)).toBe('1,234,567');
    expect(groupDigits(-4823)).toBe('-4,823');
  });

  it('renders the progress label as text, and no percentage of an empty catalog', () => {
    // 322/1717 = 18.75…% → one decimal, the spec's own shape ("0.8%").
    expect(coveragePercentLabel(322, 1717)).toBe('18.8%');
    expect(coveragePercentLabel(0, 0)).toBe('—');
    expect(coveragePercentLabel(3, 0)).toBe('—');
  });
});

/* ---------------------------------------------------------------- the filter */

describe('the missing-only query builder', () => {
  it('emits no parameter at all when the filter is off', () => {
    expect(catalogQuery({ missingOnly: false })).toBe('');
    expect(catalogRequestPath({ missingOnly: false })).toBe('/api/quests/catalog');
  });

  it('emits the shared parameter when the filter is on', () => {
    expect(catalogQuery({ missingOnly: true })).toBe('?missing_only=1');
    expect(catalogRequestPath({ missingOnly: true })).toBe('/api/quests/catalog?missing_only=1');
  });

  it('spells the parameter from the one shared constant, not from a literal here', () => {
    expect(MISSING_ONLY_PARAM).toBe('missing_only');
    expect(catalogQuery({ missingOnly: true })).toContain(MISSING_ONLY_PARAM);
  });

  it('carries the search as ?q= (trimmed, encoded), alone or after missing_only (D186)', () => {
    expect(catalogQuery({ missingOnly: false, q: '  ' })).toBe('');
    expect(catalogQuery({ missingOnly: false, q: ' Wizard Tours ' })).toBe('?q=Wizard+Tours');
    expect(catalogRequestPath({ missingOnly: true, q: 'a&b' })).toBe(
      '/api/quests/catalog?missing_only=1&q=a%26b',
    );
    expect(catalogQuery({ missingOnly: true, q: 'x' })).toContain(`${CATALOG_Q_PARAM}=x`);
  });

  it('the count line says when a search narrows the rows, and the empty states stay distinct', () => {
    expect(catalogCountText(4, false, '')).toBe('4 catalog rows');
    expect(catalogCountText(2, true, '')).toBe('2 missing');
    expect(catalogCountText(3, false, 'tour')).toBe('Showing 3 matching “tour”');
    expect(catalogCountText(1, true, 'tour')).toBe('Showing 1 matching “tour”, missing only');
    expect(catalogNoMatchText('zzz', false)).toBe('No catalog quest matches “zzz”.');
    expect(catalogNoMatchText('zzz', true)).toBe('No missing catalog quest matches “zzz”.');
    expect(catalogNoMatchText('zzz', false)).not.toBe(CATALOG_NO_MISSING);
  });

  it('the filter label is the spec wording, and the filter is not a client-side predicate', () => {
    // The page sends the filter to the server (the query builder above) and renders rows as it
    // receives them; nothing in this module filters an array of rows.
    expect(CATALOG_MISSING_ONLY_LABEL).toBe('missing only');
  });
});

/* ------------------------------------------------------------- the row action */

const DEFINED: QuestCatalogRow = {
  quest_name: 'WC-CYCLOPS-MAIN-002',
  title: 'Sea of Sorrows',
  title_source: 'direct',
  has_definition: 1,
  reference_count: 6,
};

const MISSING: QuestCatalogRow = {
  quest_name: 'DM-GRAVE-MAIN-008',
  title: 'Stakes and Stones',
  title_source: 'direct',
  has_definition: 0,
  reference_count: 19,
};

describe('catalogRowAction — each row links into the evidence panel or the scaffold action', () => {
  it('a defined quest links into the evidence panel, through p6-10’s own parameter', () => {
    const action = catalogRowAction(DEFINED);
    expect(action).toEqual({
      kind: 'evidence',
      label: CATALOG_EVIDENCE_ACTION,
      to: '/quests/WC-CYCLOPS-MAIN-002?panel=evidence',
    });
    expect(questEvidencePath(DEFINED.quest_name)).toBe(
      `/quests/${DEFINED.quest_name}?${RAIL_TAB_QUERY_PARAM}=${RAIL_TAB_EVIDENCE}`,
    );
    expect(RAIL_TAB_QUERY_PARAM).toBe('panel');
    expect(RAIL_TAB_EVIDENCE).toBe('evidence');
  });

  it('encodes a name that needs it, so the link cannot break', () => {
    expect(questEvidencePath('A/B C')).toBe('/quests/A%2FB%20C?panel=evidence');
  });

  it('a missing quest offers the scaffold action and no link', () => {
    expect(catalogRowAction(MISSING)).toEqual({ kind: 'scaffold', label: CATALOG_SCAFFOLD_ACTION });
    expect(CATALOG_SCAFFOLD_ACTION).toBe('Scaffold');
  });

  it('the action follows has_definition, so a row cannot look actionable and do nothing', () => {
    expect(catalogRowAction({ ...DEFINED, has_definition: 0 }).kind).toBe('scaffold');
    expect(catalogRowAction({ ...MISSING, has_definition: 1 }).kind).toBe('evidence');
  });
});

/* ---------------------------------------------------------------- the cells */

describe('the row cells are words (D85)', () => {
  it('the Defined cell is text, not a bare glyph', () => {
    expect(definedCellText(DEFINED)).toBe('defined');
    expect(definedCellText(MISSING)).toBe('missing');
    // Both are non-empty words — the glyph the page renders beside them is decoration.
    for (const row of [DEFINED, MISSING]) {
      expect(definedCellText(row).trim()).not.toBe('');
    }
  });

  it('the Title cell falls back to an em dash rather than an empty cell', () => {
    expect(catalogTitleText(MISSING)).toBe('Stakes and Stones');
    expect(catalogTitleText({ title: '   ', quest_name: 'WC-UNICORN-MAIN-004' })).toBe(
      CATALOG_NO_TITLE,
    );
    expect(CATALOG_NO_TITLE).toBe('—');
  });

  it('the Title cell is the em dash when the title fell back to the name, not a repeated Name cell', () => {
    // An unlinked quest's `title` **is** its `quest_name` (the sync writes `title =
    // record.quest_name`; only 286 of 1,447 catalog rows carry a direct title), so without this the
    // Name and Title columns print one string twice and `CATALOG_NO_TITLE` is unreachable.
    const identity = { quest_name: 'WC-UNICORN-MAIN-004', title: 'WC-UNICORN-MAIN-004' };
    expect(catalogTitleText(identity)).toBe(CATALOG_NO_TITLE);
    expect(catalogTitleText(identity)).not.toBe(identity.quest_name);
    // The linked neighbour still prints its own title — the fallback is not swallowing real ones.
    expect(catalogTitleText({ ...identity, title: 'Unicorn Way' })).toBe('Unicorn Way');
  });

  it('an inferred title carries the labelled badge', () => {
    expect(catalogTitleIsInferred({ title_source: 'inferred' })).toBe(true);
    expect(catalogTitleIsInferred({ title_source: 'direct' })).toBe(false);
    expect(catalogTitleIsInferred({ title_source: 'none' })).toBe(false);
    expect(CATALOG_INFERRED_BADGE).toBe('inferred');
  });
});
