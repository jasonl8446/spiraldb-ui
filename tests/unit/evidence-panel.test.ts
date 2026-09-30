import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import EvidencePanel from '../../client/src/components/quest/EvidencePanel';
import {
  EVIDENCE_INSERT_REFUSAL_MESSAGES,
  EVIDENCE_INSERT_VIEW_MODE_MESSAGE,
} from '../../client/src/lib/evidence-insert';
import type { QuestEvidence } from '../../client/src/lib/api';
import {
  EVIDENCE_AVAILABLE_EMPTY,
  EVIDENCE_AVAILABLE_HEADING,
  EVIDENCE_DIALOGUE_EMPTY,
  EVIDENCE_DIALOGUE_HEADING,
  EVIDENCE_GATES_HEADING,
  EVIDENCE_REFERENCES_HEADING,
  EVIDENCE_USED_HEADING,
  EVIDENCE_WARNINGS_HEADING,
} from '../../client/src/lib/quests';

/**
 * Story p6-08 — **"the panel itself never writes to the file"**, asserted three ways, plus the
 * visible inferred badge and the used/available split (plan task 6.7; docs/spec-ui-design.md
 * L444-450).
 *
 * The claim is a *negative*, so one instrument cannot carry it (D90(c): an instrument's
 * insensitivity must be proven before its clean result is trusted). This file therefore runs three
 * independent ones and proves the strongest is sensitive:
 *
 * 1. **render** — the panel is rendered with `renderToStaticMarkup` (node, no jsdom) and the
 *    `onInsert` spy is asserted to have been called **zero** times: rendering the panel — the one
 *    moment a component could write without a click — causes no mutation. The same render proves
 *    the visible facts (badge, split, headings, refusal sentences).
 * 2. **source scan** — the panel's own source is read and scanned for any use of the write surface,
 *    and the scanner is then run over a **deliberately mutated copy** of that source, so a scanner
 *    that could never fail is falsified here rather than trusted.
 * 3. **module graph** — the panel's value imports are asserted to reach no API client and no
 *    server module; `lib/evidence-insert.ts` is asserted to import `@shared/document` and nothing
 *    else, which is what keeps the reducer pure.
 *
 * The tier-1 spec (`tests/ui/quests-evidence-panel.spec.ts`) adds the runtime half: with the panel
 * open and an insert performed, the mocked API records **no** `POST /api/quests`.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL_PATH = path.join(
  HERE,
  '..',
  '..',
  'client',
  'src',
  'components',
  'quest',
  'EvidencePanel.tsx',
);
const INSERT_PATH = path.join(HERE, '..', '..', 'client', 'src', 'lib', 'evidence-insert.ts');

const PANEL_SOURCE = readFileSync(PANEL_PATH, 'utf8');

/* -------------------------------------------------------------- the write surface */

/**
 * What "the panel never writes" means, mechanically: the names a module would need to write a file
 * or commit one. `@shared/document`'s primitives are on the list too — they are the editors' shared
 * mutation contract, and a panel that called them directly would be bypassing the page's document
 * state (D58), i.e. a second writer.
 */
const WRITE_SURFACE: readonly string[] = [
  'saveQuest',
  'saveObject',
  'objectSave',
  'createSavePipeline',
  'writeFile',
  'writeFileSync',
  'simpleGit',
  'applyEdits',
  'setAtPath',
  'deleteAtPath',
  'editQuestDocument',
  'fetch(',
  'XMLHttpRequest',
];

/**
 * Removes block and line comments before scanning.
 *
 * Deliberately part of the instrument: these modules **document** the write rule in prose (the
 * panel's header names `applyEdits`, the reducer's names `setAtPath`), and a scanner that fired on
 * a comment could only be silenced by deleting the documentation — the wrong trade. The
 * `//` rule ignores a `://` so a URL in a string is not mistaken for a comment start, and the
 * control test below asserts both directions: a comment naming a writer is **not** a violation
 * while code naming one **is**.
 *
 * Local to this file (it was exported, and nothing imported it): the repo's shared home for this
 * rule is `tests/helpers/source-text.ts`'s `codeOf`, whose `//` rule and negative control differ
 * from this one's, so merging the two is a recorded disposition rather than a cleanup.
 */
function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutBlocks
    .split('\n')
    .map((line) => {
      const index = line.search(/(^|[^:])\/\//);
      return index === -1 ? line : line.slice(0, index);
    })
    .join('\n');
}

/** Every write-surface name the source's **code** mentions. Pure, so the controls can call it. */
function panelWriteViolations(source: string): string[] {
  const code = stripComments(source);
  return WRITE_SURFACE.filter((name) => code.includes(name));
}

/* --------------------------------------------------------------------- fixtures */

function evidence(overrides: Partial<QuestEvidence> = {}): QuestEvidence {
  return {
    quest: {
      quest_name: 'P6-EVIDENCE-001',
      quest_id: 95119,
      has_definition: true,
      link_kind: 'direct',
      title: 'Cyclops Lane',
      title_source: 'direct',
      inference_basis: null,
    },
    text_rows: [
      {
        key: 'WizQst17318F_00000006',
        value: 'Yes, yes, trouble on Cyclops Lane.',
        category: 'WizQst17318F',
        used_by_this_file: false,
        field: null,
      },
      {
        key: 'WizQst17318F_00000007',
        value: 'Let me save you the trouble.',
        category: 'WizQst17318F',
        used_by_this_file: false,
        field: null,
      },
      {
        key: 'WizQst17318E_00000006',
        value: 'A sibling quest’s line.',
        category: 'WizQst17318E',
        used_by_this_file: true,
        field: 'm_dialogList.m_dialogs[0].m_dialogEntries[0].m_dialog',
      },
    ],
    goal_gates: [
      {
        goal_name: 'DM-HOWL-MAIN-001_Complete',
        required_status: 'Completed',
        refs: [{ wad: 'WizardCity.wad', entry: 'Gate_1', class: 'ReqHasQuest' }],
      },
    ],
    dialogue: [
      {
        index: 0,
        field: 'm_dialogList.m_dialogs[0].m_dialogEntries[1]',
        dialog_key: 'WizQst17318E_00000006',
        own_table: false,
        text: 'A sibling quest’s line.',
        speaker: {
          name: 'Cyrus Drake',
          source: 'composed',
          persona: 'WC-RAV-NPC02_Persona',
          override_key: null,
          st_key: 'NPCFormats_First_Last',
        },
        portrait: 'GUI/NpcPortraits/Cyrus.dds',
        sound: null,
        camera_name: 'LOCATION',
        actor_template_id: 9002,
      },
      {
        index: 1,
        field: 'm_dialogList.m_dialogs[0].m_dialogEntries[2]',
        dialog_key: null,
        own_table: false,
        text: null,
        speaker: {
          name: 'FIXTURE-ABSENT_Persona',
          source: 'raw',
          persona: 'FIXTURE-ABSENT_Persona',
          override_key: null,
          st_key: 'NPCFormats_First_Last',
        },
        portrait: null,
        sound: null,
        camera_name: null,
        actor_template_id: null,
      },
    ],
    references: [
      {
        field: 'm_goals[0].m_goalTarget',
        value: 12,
        key: 'm_goalTarget',
        sources: ['items'],
        kind: 'item',
        resolved: { label: 'Twice Stitched Boots', display: 'Twice Stitched Boots (12)' },
      },
    ],
    warnings: ['8 dialogue lines resolve to the raw persona string'],
    ...overrides,
  };
}

const GOAL_TARGET = {
  kind: 'm_goalText' as const,
  path: ['m_goals', 2, 'm_goalText'],
  label: 'm_goals[2].m_goalText',
};

/** Renders the panel and returns both the markup and the spy. */
function render(
  options: {
    evidence?: QuestEvidence;
    target?: typeof GOAL_TARGET | null;
    editable?: boolean;
    isLoading?: boolean;
    isError?: boolean;
  } = {},
): { html: string; onInsert: ReturnType<typeof vi.fn> } {
  const onInsert = vi.fn();
  // `createElement`, not JSX: the render must stay in a `.ts` file so the node-environment vitest
  // run and `npm run typecheck:tests` (which includes only `**/*.ts`) both cover it.
  const html = renderToStaticMarkup(
    createElement(EvidencePanel, {
      evidence: options.evidence ?? evidence(),
      isLoading: options.isLoading ?? false,
      isError: options.isError ?? false,
      target: options.target === undefined ? GOAL_TARGET : options.target,
      editable: options.editable ?? true,
      doc: { m_goals: [{}, {}, {}] },
      onInsert,
    }),
  );
  return { html, onInsert };
}

/* -------------------------------------------------------------- 1. the render half */

describe('EvidencePanel — rendering writes nothing', () => {
  it('never calls the insert action during a render', () => {
    const { html, onInsert } = render();
    expect(html.length).toBeGreaterThan(100);
    expect(onInsert).not.toHaveBeenCalled();
  });

  it('never calls the insert action when it renders the loading or error state', () => {
    expect(render({ isLoading: true }).onInsert).not.toHaveBeenCalled();
    expect(render({ isError: true, evidence: undefined }).onInsert).not.toHaveBeenCalled();
  });
});

/* --------------------------------------------------- the visible facts the AC names */

describe('EvidencePanel — the visible surfaces', () => {
  it('splits the quest’s own text into used and available with the API’s own predicate', () => {
    const { html } = render();
    expect(html).toContain(`── ${EVIDENCE_USED_HEADING} ──`);
    expect(html).toContain(`── ${EVIDENCE_AVAILABLE_HEADING} ──`);
    // The used row is grouped under the field it already fills — the grouping the spec asks for.
    expect(html).toContain('m_dialogList.m_dialogs[0].m_dialogEntries[0].m_dialog');
    expect(html.indexOf(EVIDENCE_USED_HEADING)).toBeLessThan(html.indexOf('WizQst17318E_00000006'));
    // Every section the spec's ASCII draws, plus 6.6's two extra surfaces.
    for (const heading of [
      EVIDENCE_DIALOGUE_HEADING,
      EVIDENCE_GATES_HEADING,
      EVIDENCE_REFERENCES_HEADING,
      EVIDENCE_WARNINGS_HEADING,
    ]) {
      expect(html).toContain(`── ${heading} ──`);
    }
    expect(html).toContain('Cyrus Drake');
    expect(html).toContain('Twice Stitched Boots (12)');
    expect(html).toContain('DM-HOWL-MAIN-001_Complete');
    expect(html).toContain('8 dialogue lines resolve to the raw persona string');
  });

  it('offers one insert action per accepted row, naming the field it will write', () => {
    const { html } = render();
    // The available row writes the focused field…
    expect(html).toContain('aria-label="Insert WizQst17318F_00000006"');
    // The target is named by its glossary pair and its place in words (task 7.9); the path itself
    // survives only in `data-path`.
    expect(html).toMatch(
      /→ <span data-path="m_goals\[2\]\.m_goalText"><span data-term="m_goalText">Goal text \(<span[^>]*>m_goalText<\/span>\)<\/span> in Goals 3<\/span>/,
    );
    expect(html).toContain('Insert into');
    // …while the used row writes the field it already fills (its own provenance), even though a
    // different field is focused: the row's label is its own path, not the focus.
    expect(html).toContain('aria-label="Insert WizQst17318E_00000006"');
    expect(html).toMatch(
      /→ <span data-path="m_dialogList\.m_dialogs\[0\]\.m_dialogEntries\[0\]\.m_dialog"><span data-term="m_dialog">Dialog text \(<span[^>]*>m_dialog<\/span>\)<\/span> in Dialog list › Dialog blocks 1 › Dialog entries 1<\/span>/,
    );
  });

  it('renders no button and states the reason when nothing is focused', () => {
    const { html } = render({ target: null });
    expect(html).not.toContain('aria-label="Insert WizQst17318F_00000006"');
    expect(html).toContain(EVIDENCE_INSERT_REFUSAL_MESSAGES['no-target']);
    expect(html).toContain('nothing focused');
  });

  it('states the edit-mode reason in view mode, where no editor can focus a field', () => {
    const { html } = render({ target: null, editable: false });
    expect(html).not.toContain('aria-label="Insert WizQst17318F_00000006"');
    expect(html).toContain(EVIDENCE_INSERT_VIEW_MODE_MESSAGE);
  });

  it('refuses a dialogue row into a goal field with the row-level reason', () => {
    // Mixed section: the text rows accept at the focused goal field, the dialogue rows cannot —
    // so the dialogue section carries no button at all and states the reason per row.
    const { html } = render();
    expect(html).toContain(EVIDENCE_INSERT_REFUSAL_MESSAGES.incompatible);
    const dialogueSection = html.slice(
      html.indexOf(`── ${EVIDENCE_DIALOGUE_HEADING} ──`),
      html.indexOf(`── ${EVIDENCE_GATES_HEADING} ──`),
    );
    expect(dialogueSection.length).toBeGreaterThan(50);
    expect(dialogueSection).not.toContain('<button');
    expect(dialogueSection).toContain(EVIDENCE_INSERT_REFUSAL_MESSAGES.incompatible);
    expect(dialogueSection).toContain(EVIDENCE_INSERT_REFUSAL_MESSAGES['no-key']);
  });

  it('says an empty section is empty instead of dropping it', () => {
    const empty = evidence({
      text_rows: [],
      goal_gates: [],
      dialogue: [],
      references: [],
      warnings: [],
    });
    const { html } = render({ evidence: empty });
    expect(html).toContain(EVIDENCE_AVAILABLE_EMPTY);
    expect(html).toContain(EVIDENCE_DIALOGUE_EMPTY);
    expect(html).toContain(`── ${EVIDENCE_USED_HEADING} ──`);
    expect(html).toContain(`── ${EVIDENCE_DIALOGUE_HEADING} ──`);
  });
});

describe('EvidencePanel — the inferred badge', () => {
  it('renders the badge for an inferred title and not for direct or none', () => {
    const inferred = render({
      evidence: evidence({
        quest: {
          ...evidence().quest,
          title_source: 'inferred',
          link_kind: 'inferred',
          inference_basis: 'midpoint between DM-HOWL-MAIN-001 and DM-HOWL-MAIN-005',
        },
      }),
    });
    expect(inferred.html).toContain('Title inferred');
    // An inferred link never travels alone: its basis is on screen.
    expect(inferred.html).toContain('midpoint between DM-HOWL-MAIN-001 and DM-HOWL-MAIN-005');

    for (const source of ['direct', 'none'] as const) {
      const { html } = render({
        evidence: evidence({ quest: { ...evidence().quest, title_source: source } }),
      });
      expect(html, source).not.toContain('Title inferred');
    }
  });
});

/* ------------------------------------------- 2. the source scan, and its negative control */

describe('“the panel never writes” — the source-level assertion, with its sensitivity proven', () => {
  it('finds no write-surface name in the shipped panel source', () => {
    expect(panelWriteViolations(PANEL_SOURCE)).toEqual([]);
  });

  it('is not oversensitive: a comment naming a writer is not a violation', () => {
    expect(
      panelWriteViolations('// the page calls saveQuest; this module must not.\nconst a = 1;'),
    ).toEqual([]);
    expect(
      panelWriteViolations('/** Prose about applyEdits and setAtPath. */\nconst b = 2;'),
    ).toEqual([]);
    // …while the stripper leaves real code alone, so the clean result above is not strip-everything.
    expect(stripComments('const url = "https://x/api";\nconst c = 3;')).toBe(
      'const url = "https://x/api";\nconst c = 3;',
    );
  });

  it('reports a violation in a deliberately mutated copy of the same source', () => {
    // The negative control: the same scanner, the same file, one injected writer. Without this,
    // the empty result above could mean the scanner never fires (D90(c)).
    const imported = `${PANEL_SOURCE}\nimport { saveQuest } from '../../lib/api';\nvoid saveQuest;\n`;
    expect(panelWriteViolations(imported)).toEqual(['saveQuest']);
    const called = PANEL_SOURCE.replace(
      'onClick={() => onInsert(plan)}',
      'onClick={() => { void fetch("/api/quests"); onInsert(plan); }}',
    );
    expect(called).not.toBe(PANEL_SOURCE);
    expect(panelWriteViolations(called)).toContain('fetch(');
    const primitive = `${PANEL_SOURCE}\nimport { applyEdits } from '@shared/document';\nvoid applyEdits;\n`;
    expect(panelWriteViolations(primitive)).toEqual(['applyEdits']);
  });

  it('keeps the reducer’s own imports to the document primitives, so it has no writer to call', () => {
    const source = readFileSync(INSERT_PATH, 'utf8');
    expect(panelWriteViolations(source)).toEqual([]);
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    expect([...new Set(imports)]).toEqual(['@shared/document']);
  });
});

/* ------------------------------------------------------- 3. the module graph */

describe('EvidencePanel — its value imports reach no write path', () => {
  it('names only presentational, pure and type-only modules', () => {
    const imports = [...PANEL_SOURCE.matchAll(/^import(?: type)?\s[^;]*?from '([^']+)';/gm)].map(
      (match) => ({ specifier: match[1], typeOnly: match[0].startsWith('import type') }),
    );
    // `lib/api` is imported for its wire **types** only — the payload the API answers, which the
    // panel renders. A value import of that module is what the write-surface scan forbids, and the
    // IC/TYPE split is the reason a reader might otherwise think this assertion was toothless.
    expect(imports.some((entry) => entry.specifier === '../../lib/api' && entry.typeOnly)).toBe(
      true,
    );
    expect(imports.some((entry) => entry.specifier === '../../lib/api' && !entry.typeOnly)).toBe(
      false,
    );
    for (const entry of imports) {
      expect(entry.specifier).not.toMatch(/server|node:|simple-git|better-sqlite3/);
    }
  });
});
