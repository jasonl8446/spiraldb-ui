import { describe, expect, it } from 'vitest';

import { applyEdits, deleteAtPath, serializeDoc, type DocPath } from '@shared/document';

import { SaveQuestRequestSchema } from '@shared/quest/request';
import { goalTextFieldEdit } from '../../client/src/lib/quest-goals';
import type { QuestEvidence } from '../../client/src/lib/api';
import {
  EVIDENCE_INSERT_FIELD_KINDS,
  EVIDENCE_INSERT_REFUSAL_MESSAGES,
  EVIDENCE_INSERT_VIEW_MODE_MESSAGE,
  INFERRED_TITLE_BADGE_LABEL,
  dialogueInsertRow,
  inferredTitleBadge,
  insertFieldKindOf,
  insertTargetAt,
  planEvidenceInsert,
  sectionRefusalMessage,
  textInsertRow,
  type EvidenceInsertRow,
  type EvidenceInsertTarget,
} from '../../client/src/lib/evidence-insert';

/**
 * Story p6-08 — the **insert reducer** (plan task 6.7; docs/spec-ui-design.md L437-444).
 *
 * The reducer is the contract the panel's one-click insert rests on, so it is tested with no DOM,
 * no network and no document: `(row, target) → the mutation`, or the reason there is none. What
 * this file pins, in the order the acceptance criteria and the lead's two measured facts name them:
 *
 * 1. **the key lands, never the text** — a row whose text differs from its key inserts the key
 *    (measured: the document stores string-table keys, so a literal there resolves to nothing);
 * 2. **"only that field" is byte-level** — the plan applied to a real-shaped document changes the
 *    serialized bytes by **exactly one line**, and deleting the added key restores the original
 *    bytes exactly (the same comparison `tests/unit/quest-evidence-insert-isolation.test.ts` makes
 *    against a real corpus file and a real `git diff`);
 * 3. **`m_goalText` is an *add*** — measured: no corpus goal carries the key, so the insert appends
 *    it, and the result must have exactly one more key and nothing else different;
 * 4. **which field a row belongs to** — a *used* row writes its own provenance; an *available* row
 *    (`field: null`) writes the focused field; a row with no focus at all inserts nothing and says
 *    why; a dialogue row only fills a dialog entry's `m_dialog`;
 * 5. **the inferred badge, and the collision it must not fall into** — `title_source: 'inferred'`
 *    renders the badge, `direct`/`none` do not, and neither does the quests **list** endpoint's
 *    same-looking `resolved | rawKey | missing` vocabulary.
 */

/* --------------------------------------------------------------------- fixtures */

/** The row's key and its text are deliberately different: the document stores the key. */
const ROW_KEY = 'WizQst17318F_00000006';
const ROW_TEXT = 'Yes, yes, trouble on Cyclops Lane. Something, something students.';

/** A real-shaped quest: two goals (the second with no `m_goalText`), a goal dialog list. */
function questDocument(): Record<string, unknown> {
  return {
    $type: 'Imcodec.ObjectProperty.TypeCache.QuestTemplate, Imcodec.ObjectProperty',
    m_questName: 'P6-INSERT-001',
    m_questTitle: 'QuestTitle_17318F',
    m_goals: [
      {
        $type: 'Imcodec.ObjectProperty.TypeCache.PersonaGoalTemplate, Imcodec.ObjectProperty',
        m_goalName: 'Fix_Goal1',
        m_goalNameID: 111,
        m_locationName: 'ZoneLocName_9140',
        // The corpus's own wrapper (322/322 quests carry it): the save schema pins the
        // `ActorDialogList` literal, so a fixture without it would fail for the wrong reason.
        m_dialogList: {
          $type: 'Imcodec.ObjectProperty.TypeCache.ActorDialogList, Imcodec.ObjectProperty',
          m_dialogs: [
            {
              m_dialogTag: 'Prep',
              m_dialogEntries: [{ m_dialog: 'WizQst17318E_00000006', m_maxTimeSeconds: -1 }],
            },
          ],
        },
      },
      {
        $type: 'Imcodec.ObjectProperty.TypeCache.PersonaGoalTemplate, Imcodec.ObjectProperty',
        m_goalName: 'Fix_Goal2',
        m_goalNameID: 222,
        m_locationName: null,
      },
    ],
  };
}

function goalTextTarget(index: number): EvidenceInsertTarget {
  return {
    kind: 'm_goalText',
    path: ['m_goals', index, 'm_goalText'],
    label: `m_goals[${String(index)}].m_goalText`,
  };
}

function locationTarget(index: number): EvidenceInsertTarget {
  return {
    kind: 'm_locationName',
    path: ['m_goals', index, 'm_locationName'],
    label: `m_goals[${String(index)}].m_locationName`,
  };
}

function dialogTarget(): EvidenceInsertTarget {
  return {
    kind: 'm_dialog',
    path: ['m_goals', 0, 'm_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 0, 'm_dialog'],
    label: 'm_dialog',
  };
}

/** The fields of a value, as `path → value`, for an exact "nothing else moved" comparison. */
function leafMap(value: unknown, path: DocPath = []): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (Array.isArray(value)) {
    out.set(path.join('.'), `array(${String(value.length)})`);
    value.forEach((element, index) => {
      for (const [key, leaf] of leafMap(element, [...path, index])) {
        out.set(key, leaf);
      }
    });
    return out;
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      for (const [childKey, leaf] of leafMap(child, [...path, key])) {
        out.set(childKey, leaf);
      }
    }
    return out;
  }
  out.set(path.join('.'), value);
  return out;
}

/* ----------------------------------------------------------------- the reducer */

describe('planEvidenceInsert — the key lands, never the text', () => {
  it('writes the row’s string-table key into the focused goal’s m_goalText', () => {
    const row = textInsertRow({ key: ROW_KEY, field: null });
    const plan = planEvidenceInsert(row, goalTextTarget(1));
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.source).toBe('focus');
    expect(plan.kind).toBe('m_goalText');
    expect(plan.label).toBe('m_goals[1].m_goalText');
    // The value is the KEY. Inserting ROW_TEXT would look plausible and resolve to nothing.
    expect(plan.edit).toEqual({ op: 'set', path: ['m_goals', 1, 'm_goalText'], value: ROW_KEY });
    expect(JSON.stringify(plan.edit)).not.toContain(ROW_TEXT);
    expect(ROW_KEY).not.toBe(ROW_TEXT);
  });

  it('emits exactly the edit the Goals editor’s own builder emits for that path', () => {
    // One writer per path (D58): the reducer must not invent a second spelling of
    // "set m_goals[i].m_goalText" — and an ABSENT key is the case here (no corpus goal carries one).
    const inside = { m_goalName: 'Fix_Goal2' };
    const plan = planEvidenceInsert(
      textInsertRow({ key: ROW_KEY, field: null }),
      goalTextTarget(1),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.edit).toEqual(goalTextFieldEdit(1, 'm_goalText', false, ROW_KEY));
    expect(inside).toEqual({ m_goalName: 'Fix_Goal2' });
  });
});

describe('planEvidenceInsert — “only that field”, at the byte level', () => {
  it('changes exactly one line of the serialized document, and deleting that key restores the bytes', () => {
    const before = questDocument();
    const beforeText = serializeDoc(before);
    const plan = planEvidenceInsert(
      textInsertRow({ key: ROW_KEY, field: null }),
      goalTextTarget(1),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    const after = applyEdits(before, [plan.edit]) as Record<string, unknown>;
    const afterText = serializeDoc(after);

    // Exactly one line gained, carrying the key — and because `setAtPath` **appends** an absent
    // key, the line that used to be the goal's last also loses nothing but gains a separator
    // comma. Both facts are asserted rather than smoothed over: the diff has two changed lines and
    // one real change (the second line's only difference is `,`).
    const beforeLines = beforeText.split('\n');
    const afterLines = afterText.split('\n');
    expect(afterLines.length).toBe(beforeLines.length + 1);
    const addedIndex = afterLines.findIndex((line) => line.includes('"m_goalText"'));
    const addedLine = afterLines[addedIndex];
    expect(addedLine?.trim()).toBe(`"m_goalText": "${ROW_KEY}"`);
    expect(afterLines.filter((line) => line.includes('"m_goalText"'))).toHaveLength(1);

    const stripped = [...afterLines.slice(0, addedIndex), ...afterLines.slice(addedIndex + 1)];
    const differing = stripped
      .map((line, index) => ({ index, line, original: beforeLines[index] }) as const)
      .filter((entry) => entry.line !== entry.original);
    expect(differing).toHaveLength(1);
    const [only] = differing;
    expect(only?.line).toBe(`${only?.original ?? ''},`);
    // Removing the one added key and the one separator comma restores the original bytes exactly.
    const restored = stripped.slice();
    if (only !== undefined) {
      restored[only.index] = only.original;
    }
    expect(restored.join('\n')).toBe(beforeText);

    // The inversion through the primitives: delete the inserted key and the *document* is
    // identical again (the comma lives in the serialization, not in a value).
    expect(deleteAtPath(after, plan.path)).toEqual(before);

    // The semantic reading of the same fact: one key added, no other value moved.
    const beforeLeaves = leafMap(before);
    const afterLeaves = leafMap(after);
    const added = [...afterLeaves.keys()].filter((key) => !beforeLeaves.has(key));
    const removed = [...beforeLeaves.keys()].filter((key) => !afterLeaves.has(key));
    expect(added).toEqual(['m_goals.1.m_goalText']);
    expect(removed).toEqual([]);
    const moved = [...beforeLeaves.entries()].filter(
      ([key, value]) => afterLeaves.get(key) !== value,
    );
    expect(moved).toEqual([]);
    expect((after.m_goals as unknown[]).length).toBe(2);
    expect(Object.keys((after.m_goals as Record<string, unknown>[])[1] ?? {})).toEqual([
      '$type',
      'm_goalName',
      'm_goalNameID',
      'm_locationName',
      'm_goalText',
    ]);
  });

  it('reports an add-versus-overwrite label from the document without changing the edit', () => {
    const doc = questDocument();
    const row = textInsertRow({ key: ROW_KEY, field: null });
    const added = planEvidenceInsert(row, goalTextTarget(1), doc);
    const overwritten = planEvidenceInsert(row, locationTarget(0), doc);
    expect(added.ok && added.overwrites).toBe(false);
    expect(overwritten.ok && overwritten.overwrites).toBe(true);
    // Without a document the edit is identical — the flag is a label, not a decision.
    expect(planEvidenceInsert(row, goalTextTarget(1))).toEqual(added);
  });
});

describe('the insert the panel offers is not a dead end at the save gate', () => {
  it('a document carrying the added m_goalText passes POST /api/quests’ own schema', () => {
    // Measured: no corpus goal carries `m_goalText`, so the goal-text insert ADDS a key the goal
    // schema does not list. That is legal input (D57a: an extra key is kept, not stripped) — but
    // "legal input" is the claim, so the schema is what asserts it, not the reducer's author.
    const before = questDocument();
    const plan = planEvidenceInsert(
      textInsertRow({ key: ROW_KEY, field: null }),
      goalTextTarget(1),
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    const after = applyEdits(before, [plan.edit]) as Record<string, unknown>;
    const parsed = SaveQuestRequestSchema.safeParse({ quest: after });
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    // And the save pipeline writes the ORIGINAL object (D57b), so the added key is what lands:
    // the schema only had to accept it.
    expect(((after.m_goals as Record<string, unknown>[])[1] ?? {})['m_goalText']).toBe(ROW_KEY);
  });
});

describe('planEvidenceInsert — which field a row belongs to', () => {
  it('a used row writes its own provenance, even when another field is focused', () => {
    const row = textInsertRow({ key: ROW_KEY, field: 'm_goals[0].m_goalText' });
    const plan = planEvidenceInsert(row, locationTarget(1));
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.source).toBe('row');
    expect(plan.path).toEqual(['m_goals', 0, 'm_goalText']);
    expect(plan.kind).toBe('m_goalText');
  });

  it('a provenance outside the three insert targets falls through to the focused field', () => {
    // A used row whose field is `m_questTitle` is this file's title material; the plan gives the
    // panel no title insert (the Info tab owns that field), so the focus decides — never a write
    // to a field this story does not own.
    const row = textInsertRow({ key: ROW_KEY, field: 'm_questTitle' });
    const focused = planEvidenceInsert(row, goalTextTarget(0));
    expect(focused.ok && focused.source).toBe('focus');
    expect(focused.ok && focused.path).toEqual(['m_goals', 0, 'm_goalText']);
    const unfocused = planEvidenceInsert(row, null);
    expect(unfocused.ok).toBe(false);
    expect(unfocused.ok ? '' : unfocused.reason).toBe('no-target');
  });

  it('an unparsable provenance is treated as none rather than as a guess', () => {
    const row = textInsertRow({ key: ROW_KEY, field: 'not a path[' });
    expect(row.field).toBeNull();
    expect(planEvidenceInsert(row, null).ok).toBe(false);
  });

  it('an available row with nothing focused inserts nothing and says why', () => {
    const plan = planEvidenceInsert(textInsertRow({ key: ROW_KEY, field: null }), null);
    expect(plan.ok).toBe(false);
    if (plan.ok) {
      return;
    }
    expect(plan.reason).toBe('no-target');
    expect(plan.message).toBe(EVIDENCE_INSERT_REFUSAL_MESSAGES['no-target']);
    // The refusal carries no edit at all — there is no silent no-op path to fall back to.
    expect('edit' in plan).toBe(false);
  });

  it('a dialogue row only fills a dialog entry’s m_dialog', () => {
    const row = dialogueInsertRow({
      index: 3,
      field: 'm_dialogList.m_dialogs[0].m_dialogEntries[3]',
      dialog_key: ROW_KEY,
    });
    // The row knows where the line already is, but an insert there would be a no-op, so the
    // focused entry decides (the spec's own "dialogue into the focused m_dialog").
    expect(row.field).toEqual(['m_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 3, 'm_dialog']);
    const accepted = planEvidenceInsert(row, dialogTarget());
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    expect(accepted.source).toBe('focus');
    expect(accepted.edit).toEqual({
      op: 'set',
      path: ['m_goals', 0, 'm_dialogList', 'm_dialogs', 0, 'm_dialogEntries', 0, 'm_dialog'],
      value: ROW_KEY,
    });
    const refused = planEvidenceInsert(row, goalTextTarget(0));
    expect(refused.ok).toBe(false);
    if (refused.ok) {
      return;
    }
    expect(refused.reason).toBe('incompatible');
    expect(refused.message).toBe(EVIDENCE_INSERT_REFUSAL_MESSAGES.incompatible);
    const locationRefused = planEvidenceInsert(row, locationTarget(0));
    expect(locationRefused.ok ? '' : locationRefused.reason).toBe('incompatible');
  });

  it('a dialogue row with no key inserts nothing and says why', () => {
    const row = dialogueInsertRow({
      index: 0,
      field: 'm_dialogList.m_dialogs[0].m_dialogEntries[0]',
      dialog_key: null,
    });
    expect(row.key).toBe('');
    const plan = planEvidenceInsert(row, dialogTarget());
    expect(plan.ok).toBe(false);
    expect(plan.ok ? '' : plan.reason).toBe('no-key');
    expect(plan.ok ? '' : plan.message).toBe(EVIDENCE_INSERT_REFUSAL_MESSAGES['no-key']);
  });

  it('a location name row writes the focused goal’s m_locationName', () => {
    const row = textInsertRow({ key: 'ZoneLocName_9140', field: null });
    const plan = planEvidenceInsert(row, locationTarget(1));
    expect(plan.ok).toBe(true);
    expect(plan.ok && plan.edit).toEqual({
      op: 'set',
      path: ['m_goals', 1, 'm_locationName'],
      value: 'ZoneLocName_9140',
    });
  });
});

describe('insertTargetAt / insertFieldKindOf', () => {
  it('names only the three fields the plan owns', () => {
    expect(EVIDENCE_INSERT_FIELD_KINDS).toEqual(['m_dialog', 'm_goalText', 'm_locationName']);
    expect(insertTargetAt(['m_goals', 2, 'm_goalText'])?.kind).toBe('m_goalText');
    expect(insertTargetAt(['m_goals', 2, 'm_locationName'])?.label).toBe(
      'm_goals[2].m_locationName',
    );
    expect(insertTargetAt(['m_dialogList', 'm_dialogs', 0, 'm_dialog'])?.kind).toBe('m_dialog');
    // A field the panel does not own is not a target, however string-valued it is.
    expect(insertTargetAt(['m_questTitle'])).toBeNull();
    expect(insertFieldKindOf(['m_goals', 2, 'm_goalText'])).toBe('m_goalText');
    expect(insertFieldKindOf(['m_goals', 2])).toBeNull();
    expect(insertFieldKindOf(['m_goals', 2, 0])).toBeNull();
  });
});

describe('sectionRefusalMessage', () => {
  const refused = (target: EvidenceInsertTarget | null, key = ROW_KEY) =>
    planEvidenceInsert(textInsertRow({ key, field: null }), target);

  it('prints one sentence when a whole section refuses for one reason', () => {
    const plans = [refused(null), refused(null)];
    expect(sectionRefusalMessage(plans, { editable: true })).toBe(
      EVIDENCE_INSERT_REFUSAL_MESSAGES['no-target'],
    );
    // View mode is the honest reason there, not "nothing is focused".
    expect(sectionRefusalMessage(plans, { editable: false })).toBe(
      EVIDENCE_INSERT_VIEW_MODE_MESSAGE,
    );
  });

  it('prints nothing when a row accepts, or when the refusals differ', () => {
    expect(sectionRefusalMessage([refused(null), refused(goalTextTarget(0))])).toBeNull();
    const mixed: ReturnType<typeof refused>[] = [
      refused(null),
      refused(goalTextTarget(0), ''),
      refused(dialogTarget() as EvidenceInsertTarget),
    ];
    expect(sectionRefusalMessage(mixed)).toBeNull();
    expect(sectionRefusalMessage([])).toBeNull();
  });

  it('a per-row refusal is not swallowed by the section sentence', () => {
    // Every row refuses `no-key`, so the section still prints it — but a mixed section leaves the
    // per-row message to the row, which is what the panel renders.
    const plans = [refused(goalTextTarget(0), ''), refused(goalTextTarget(0))];
    expect(sectionRefusalMessage(plans)).toBeNull();
  });

  it('does not offer the view-mode sentence for a refusal view mode did not cause', () => {
    const plans = [
      planEvidenceInsert(
        dialogueInsertRow({
          index: 0,
          field: 'm_dialogList.m_dialogs[0].m_dialogEntries[0]',
          dialog_key: ROW_KEY,
        }),
        goalTextTarget(0),
      ),
    ];
    expect(sectionRefusalMessage(plans, { editable: false })).toBe(
      EVIDENCE_INSERT_REFUSAL_MESSAGES.incompatible,
    );
  });
});

describe('the inferred badge, and the collision it must not fall into', () => {
  it('marks an inferred title and nothing else', () => {
    expect(inferredTitleBadge('inferred')).toBe(INFERRED_TITLE_BADGE_LABEL);
    expect(inferredTitleBadge('direct')).toBeNull();
    expect(inferredTitleBadge('none')).toBeNull();
    expect(inferredTitleBadge(null)).toBeNull();
    expect(inferredTitleBadge(undefined)).toBeNull();
  });

  it('does not fire for the quests LIST endpoint’s different title_source vocabulary', () => {
    // spec-data-model L209-214: the list endpoint answers `resolved | rawKey | missing` for the
    // same-named field, and the two must never be conflated. A value from the wrong enum yields
    // no badge — not a guess, and not a badge reading "rawKey".
    for (const listValue of ['resolved', 'rawKey', 'missing']) {
      expect(inferredTitleBadge(listValue), listValue).toBeNull();
    }
    expect(INFERRED_TITLE_BADGE_LABEL).toBe('Title inferred');
    expect(INFERRED_TITLE_BADGE_LABEL).not.toContain('rawKey');
    expect(INFERRED_TITLE_BADGE_LABEL).not.toContain('resolved');
  });

  it('keeps the two enums structurally distinct in the wire types', () => {
    // A type-level guard the compiler checks: the evidence header's title_source is the catalog
    // enum, so the list vocabulary is not assignable to it.
    const header: QuestEvidence['quest'] = {
      quest_name: 'X',
      quest_id: 1,
      has_definition: true,
      link_kind: 'inferred',
      title: 'T',
      title_source: 'inferred',
      inference_basis: 'midpoint of the two anchored neighbours',
    };
    expect(inferredTitleBadge(header.title_source)).toBe(INFERRED_TITLE_BADGE_LABEL);

    // …and the direction the assertion above cannot see. `title_source: 'inferred'` is assignable
    // while the field is the catalog enum **and** while it is `string`, so a widening of the field
    // would leave that check green; this half fails in exactly that case. The directive carries the
    // negative control with it: `@ts-expect-error` is itself an error (`TS2578`) when the next line
    // compiles, so `typecheck:tests` goes red the moment 'rawKey' becomes assignable.
    // @ts-expect-error — `rawKey` is the quests LIST endpoint's vocabulary, not the catalog enum.
    const listVocabulary: QuestEvidence['quest']['title_source'] = 'rawKey';
    // The runtime half of the same claim: the wrong-vocabulary value reaching the badge function
    // yields no badge, exactly as the arm above asserts for the other two list values.
    expect(inferredTitleBadge(listVocabulary)).toBeNull();
  });
});

describe('the row builders', () => {
  it('builds a text row from the API’s shape, parsing the provenance path', () => {
    const row = textInsertRow({ key: ROW_KEY, field: 'm_goals[0].m_dialogList' });
    expect(row).toEqual({
      id: `text:${ROW_KEY}`,
      kind: 'text',
      key: ROW_KEY,
      field: ['m_goals', 0, 'm_dialogList'],
    });
    expect(textInsertRow({ key: ROW_KEY, field: null }).field).toBeNull();
  });

  it('builds a dialogue row whose provenance is its own m_dialog', () => {
    const row = dialogueInsertRow({
      index: 5,
      field: 'm_goals[1].m_dialogList.m_dialogs[0].m_dialogEntries[2]',
      dialog_key: 'WizQst17318E_00000006',
    });
    expect(row.kind).toBe('dialogue');
    expect(row.id).toBe('dialogue:5');
    expect(row.field).toEqual([
      'm_goals',
      1,
      'm_dialogList',
      'm_dialogs',
      0,
      'm_dialogEntries',
      2,
      'm_dialog',
    ]);
    const unparsable = dialogueInsertRow({ index: 6, field: 'broken[', dialog_key: 'K' });
    expect(unparsable.field).toBeNull();
    // The key still lands — an entry path this module cannot parse does not lose the insert.
    const plan = planEvidenceInsert(unparsable as EvidenceInsertRow, dialogTarget());
    expect(plan.ok && plan.edit).toEqual({
      op: 'set',
      path: dialogTarget().path,
      value: 'K',
    });
  });
});
