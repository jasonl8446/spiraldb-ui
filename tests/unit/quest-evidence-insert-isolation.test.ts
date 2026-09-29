import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

import { MEMORY_DB, openDb, writeSettings, type Db } from '@server/db';
import { createSavePipeline } from '@server/services/savePipeline';
import { readSpiraldbJson } from '@server/services/spiraldbFiles';
import { createSpiraldbIndex } from '@server/services/spiraldbIndex';
import { questEvidenceByName } from '@server/services/questEvidence';
import { saveQuest } from '@server/services/quests';
import { applyEdits, deleteAtPath, serializeDoc, type JsonDocument } from '@shared/document';
import {
  dialogueInsertRow,
  insertTargetAt,
  planEvidenceInsert,
  textInsertRow,
} from '../../client/src/lib/evidence-insert';

/**
 * Story p6-08, **ac1** — "inserting a dialogue row sets the field and the saved file's `git diff`
 * shows only that field" (plan task 6.7; decisions D17, D49, D58).
 *
 * The tier-1 harness is hermetic (D40), so it can prove the payload but never the file. This test
 * therefore drives the real path end to end in the **D17 clone** (`data/test-spiraldb`, the run's
 * save corpus):
 *
 * 1. the evidence rows come from **task 6.6's own service** (`questEvidenceByName`) over the clone's
 *    real quest file — not from a hand-written row — with a `:memory:` database seeded with the
 *    string-table slice the clone's sync produces (measured, quoted below), so the
 *    `used_by_this_file === false` that makes the row "available" is **computed** by the service;
 * 2. the insert is the reducer's own plan (`planEvidenceInsert`), applied with the D58 primitive
 *    the editors use — so the document is exactly what a browser click would have produced;
 * 3. `saveQuest` — the service behind `POST /api/quests` — runs the real Phase-2 pipeline against
 *    the clone: file write, D20 metadata refresh, `spiraldb: update quest {name}` commit;
 * 4. the proof is the **raw `git diff`** plus a leaf-level comparison of the parsed documents, plus
 *    the byte-level statement the unit suite makes on a fixture: the serialized document gained
 *    exactly one line and changed one more by nothing but a separator comma.
 *
 * ## Why `WC-CYCLOPS-MAIN-002`
 *
 * Measured on this clone: the file is one of the two the tool itself wrote (D49(c)), so
 * `readFileSync === serializeDoc(JSON.parse(...))` — **byte-identical**, unlike the 320 legacy files
 * whose trailing commas, integral floats and blank lines dominate any diff. A one-field save on this
 * file therefore produces the *minimal* raw diff the criterion asks to see, rather than a diff that
 * needs a normalization pass to be read. The test asserts the round-trip precondition instead of
 * assuming it.
 *
 * ## The two measured facts this test pins
 *
 * - **the key, not the text**: `m_dialog` and friends hold `WizQst…` string-table keys across the
 *   corpus, so the insert writes the row's key and the diff shows that key — a literal would look
 *   plausible and resolve to nothing;
 * - **`m_goalText` is an ADD**: 0 of the 772 corpus goals carry the key, so the insert appends it to
 *   the focused goal (`setAtPath`'s documented "an absent object key is appended").
 *
 * ## D17 / the restore
 *
 * The clone is the only repository this test touches: the pipeline is handed the clone path
 * directly, never through a server, and `settings.git_branch` is set to the clone's **current**
 * branch so the save commits *on* it — no session branch is created from `main`, which is exactly
 * the D76(b) incident's shape (`git reset --hard` restores the commit but leaves a branch behind).
 * The restore is `git reset --hard <base>` in a `finally` **and** in `afterAll`, and the test then
 * asserts **five axes** (branch, `HEAD`, the `main` ref, `rev-list --count HEAD`,
 * `git status --porcelain` empty) plus the corpus shape (322 `QuestTemplates/*.json`) and the
 * complete local ref list, before and after.
 */

const CLONE = path.resolve(fileURLToPath(new URL('../../data/test-spiraldb/', import.meta.url)));
const QUEST_NAME = 'WC-CYCLOPS-MAIN-002';
const QUEST_FILE = `QuestTemplates/questtemplates_${QUEST_NAME}.json`;
const META_FILE = `QuestMetadatas/questmetadata_${QUEST_NAME}.json`;

/** The quest's own text table, measured: the clone's sync builds `WizQst17318F` (30 rows). */
const OWN_CATEGORY = 'WizQst17318F';
/**
 * **ac1's subject: a dialogue row.** The quest-level `m_dialogList`'s first entry names the
 * **sibling** table's key (measured: `WC-ST03-NPC01_Persona`'s prep line), so inserting that line
 * elsewhere is a real authoring action — and the text below is the sibling row's own value, which
 * the panel renders and the document must **not** receive.
 */
const DIALOGUE_KEY = 'WizQst17318E_00000006';
const DIALOGUE_TEXT =
  "My fellow students and I came to confirm the successful thwarting of the Cyclops rebellion. But there's a problem: the thwarting was unsuccessful.";
/** The focused dialog entry the insert writes, and the key it holds before the insert. */
const FOCUSED_ENTRY_PATH = [
  'm_goals',
  0,
  'm_dialogList',
  'm_dialogs',
  0,
  'm_dialogEntries',
  0,
  'm_dialog',
] as const;
const FOCUSED_ENTRY_BEFORE = 'WizQst17318F_00000006';
/**
 * The **goal-text** subject: an available row of the quest's own table (measured below — the file
 * uses 22 of its own 30 rows, the corrected split D116 records as "the true 22 / 8"), inserted into
 * a goal that carries no `m_goalText` (measured: 0 of the 772 corpus goals carry the key).
 */
const ROW_KEY = 'WizQst17318F_00000029';
const ROW_TEXT =
  'You can get to Ravenwood and back quickly by pressing the Mark Button to set your location. Give it a try.';
/** The measured split of this quest's own table against its own file. */
const MEASURED_USED = 22;
const MEASURED_AVAILABLE = 8;

/** The goal the insert aims at, and the field — absent from every corpus goal (measured: 0/772). */
const GOAL_INDEX = 2;
const GOAL_FIELD = 'm_goalText';

/** Runs git inside the clone and returns stdout (throwaway repository — never the owner's fork). */
function git(args: readonly string[]): string {
  return execFileSync('git', ['-C', CLONE, ...args], { encoding: 'utf8' });
}

/** The five axes a restore has to move back, plus the corpus file count. */
interface CloneAxes {
  branch: string;
  head: string;
  main: string;
  commitCount: string;
  porcelain: string;
  questFiles: number;
  /** Every local branch, verbatim — the D76(b) check (`git reset --hard` can leave one behind). */
  refs: string;
}

function cloneAxes(): CloneAxes {
  return {
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']).trim(),
    head: git(['rev-parse', 'HEAD']).trim(),
    main: git(['rev-parse', 'main']).trim(),
    commitCount: git(['rev-list', '--count', 'HEAD']).trim(),
    porcelain: git(['status', '--porcelain']),
    questFiles: questFileCount(),
    refs: git(['show-ref', '--heads']),
  };
}

/** The corpus shape: the number of `QuestTemplates/*.json` files in the clone. */
function questFileCount(): number {
  return Number(
    execFileSync('bash', ['-c', `ls ${CLONE}/QuestTemplates/*.json | wc -l`])
      .toString()
      .trim(),
  );
}

function cloneReadiness(): { ok: boolean; reason: string } {
  if (!existsSync(path.join(CLONE, '.git'))) {
    return { ok: false, reason: 'the D17 clone data/test-spiraldb is absent' };
  }
  if (!existsSync(path.join(CLONE, QUEST_FILE)) || !existsSync(path.join(CLONE, META_FILE))) {
    return { ok: false, reason: `${QUEST_FILE} or its metadata is absent from the clone` };
  }
  const porcelain = git(['status', '--porcelain']);
  if (porcelain.trim() !== '') {
    return { ok: false, reason: `${CLONE} has uncommitted changes (refusing to reset them)` };
  }
  return { ok: true, reason: '' };
}

const READINESS: { ok: boolean; reason: string } = ((): { ok: boolean; reason: string } => {
  try {
    return cloneReadiness();
  } catch (error) {
    return { ok: false, reason: String(error) };
  }
})();

if (!READINESS.ok) {
  console.warn(`[p6-08 AC1] skipping the real-clone insert test: ${READINESS.reason}`);
}

/* ---------------------------------------------------------- leaf-level comparison */

interface LeafChange {
  path: string;
  kind: 'changed' | 'removed' | 'added';
  before: unknown;
  after: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every leaf that differs between two parsed documents — what *actually* changed. */
function leafChanges(before: JsonDocument, after: JsonDocument): LeafChange[] {
  const changes: LeafChange[] = [];
  function walk(a: unknown, b: unknown, at: string): void {
    if (isPlainObject(a) && isPlainObject(b)) {
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const child = at === '' ? key : `${at}.${key}`;
        if (!Object.prototype.hasOwnProperty.call(a, key)) {
          changes.push({ path: child, kind: 'added', before: undefined, after: b[key] });
        } else if (!Object.prototype.hasOwnProperty.call(b, key)) {
          changes.push({ path: child, kind: 'removed', before: a[key], after: undefined });
        } else {
          walk(a[key], b[key], child);
        }
      }
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        changes.push({ path: at, kind: 'changed', before: a.length, after: b.length });
      }
      for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        walk(a[index], b[index], `${at}[${index}]`);
      }
      return;
    }
    if (!isDeepStrictEqual(a, b)) {
      changes.push({ path: at === '' ? '<root>' : at, kind: 'changed', before: a, after: b });
    }
  }
  walk(before, after, '');
  return changes;
}

/** The `-`/`+` lines of a unified diff, without the `---`/`+++` headers. */
function diffLines(diff: string): { removed: string[]; added: string[] } {
  const removed: string[] = [];
  const added: string[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('---') || line.startsWith('+++')) {
      continue;
    }
    if (line.startsWith('-')) {
      removed.push(line.slice(1));
    } else if (line.startsWith('+')) {
      added.push(line.slice(1));
    }
  }
  return { removed, added };
}

/**
 * The string-table slice the clone's sync builds for this quest — **a fixture copy of measured
 * rows**, not a guess: `npm run sync` against this clone reports the quest's own table as
 * `WizQst17318F` (30 rows, category = `WizQst17318F`), and `docs/evidence/phase-6/p6-05.md` records
 * the run. Seeding them keeps this test independent of the 19 GB game tree and of a 27-second sync,
 * while the `used_by_this_file` answer is still **computed by the service** from the real file.
 */
function seedTables(db: Db): void {
  const seedString = (key: string, value: string, category: string): void => {
    db.prepare('INSERT INTO string_table (key, value, category) VALUES (?, ?, ?)').run(
      key,
      value,
      category,
    );
  };
  seedString('QuestTitle_17318F', 'Trouble on Cyclops Lane', 'QuestTitle');
  // The quest's own table, all 30 rows, exactly as the clone's sync builds them (task 6.5's
  // `string_table`; the texts are the measured values). Seeding the whole table is what lets the
  // split below be asserted against the recorded 22 / 8 rather than against one chosen row.
  seedString(
    'WizQst17318F_00000000',
    "I'm sure to make Best Boy after you tell Professor Drake all I've done. Best Boy Myth Wizard Nolan Stormgate, has a ring to it.",
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000001',
    'Never mind, never mind, this is no time for recriminations; that will come later. Now we must figure out how this happened. ',
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000002',
    "Myth Minions cannot just turn on their masters. It's against their code of honor or laws of physics or whatever. There's something strange afoot.",
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000004',
    'I think our best course of action is... to tell a grown-up. Report the situation to Professor Drake, while I remain and bravely hold the line.',
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000005',
    "Make sure to mention that I'm still here bravely holding the line while the other students are busy talking and getting captured.",
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000006',
    "Yes, yes, trouble on Cyclops Lane. Something, something students. *Sigh* You're one of those fast talkers, aren't you? Lovely.",
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000007',
    'Let me save you the trouble of breathlessly barking and dancing about like a dog reporting a mishap in a well - I already know everything.',
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000008',
    'And I need you - yes, you - to help me save Cyclops Lane! Are you up to it? Splendid. Then quickly, go to Victor Darkwood in the Shopping District. ',
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000009',
    'He will give you an item of great importance. Bring it back to me.',
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000010',
    "Welcome to Darkwood's Apparel Barrel, where shopping for apparel's more fun than Monquistans in a barrel.",
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000011',
    "Professor Drake sent you, eh? Which one? The mean one or the evil one? Cyrus? Oh, he's the mean one. ",
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000012',
    "The old Death Professor, Malistaire, oye, that's his brother. Always were a grumpy pair. Can't say I mind there being one less around these days.",
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000013',
    "Anyway, here's the old grump's package: all his laundry clean, pressed and folded correctly... no matter what he says.",
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000014',
    'That certainly took you long enough. No doubt Victor folded my robes improperly as well.',
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000015',
    'Why do you continue raving about Cyclops Lane? The situation is well in hand; I sent an army of trolls to ensure as much.',
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000016',
    'The trolls are revolting, you say? Yes, that is a problem and it must be dealt with harshly. Take this note to Headmaster Ambrose at once!',
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000018',
    "I will NOT expel you! I realize Professor Drake takes particular umbrage at the 'trolls are revolting' joke, but this is simply too far.",
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000019',
    'Hmm, you mean to say the trolls he sent to Cyclops Lane are revolting in the combative sense? Oh dear, he must remedy this at once!',
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000020',
    "Don't worry, young Wizard, Professor Drake may seem callous, but he is not his brother. Impress upon him the severity of the issue and he will help.",
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000021',
    "You're still here? The trolls are rebelling, hmm? Captured some students, you say? Nolan behaving bravely? I don't believe you.",
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000022',
    'Although... thinking about it, Wizard City is old and holds many ghosts with strange powers not commonly practiced today.',
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000023',
    "It's not impossible such a spirit may have a way to enthrall my minions. Though General Akilles would have neither means nor motive to summon one.",
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000024',
    "What's that? Yes, Malistaire would. I heard you met him. Well, he and Akilles are old comrades; who knows what dark powers he gave the Cyclops?",
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000025',
    'All I can do is guide you. Whatever my brother summoned to disrupt my magic will be with Akilles. Find it, destroy it and save the students. ',
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000026',
    "Also, make sure young Master Stormgate doesn't get swallowed by his own Humongofrog again.",
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000027',
    "Professor Drake said to tell me not to get eaten? I knew deep down he really cared. And he's trusted me to save Cyclops Lane!",
    OWN_CATEGORY,
  );
  seedString('WizQst17318F_00000028', 'Cyrus Drake', OWN_CATEGORY);
  seedString(
    'WizQst17318F_00000029',
    'You can get to Ravenwood and back quickly by pressing the Mark Button to set your location. Give it a try.',
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000030',
    'Use the Return to the Commons button to get back to the Commons and then head to Ravenwood. ',
    OWN_CATEGORY,
  );
  seedString(
    'WizQst17318F_00000032',
    'If you marked your location, click the Recall button to return to your mark.',
    OWN_CATEGORY,
  );
  // The sibling table row the file's quest-level dialog list references (its own measured text).
  seedString(DIALOGUE_KEY, DIALOGUE_TEXT, 'WizQst17318E');
  db.prepare(
    `INSERT INTO quests (quest_name, title, has_definition, link_kind, title_source)
     VALUES (?, ?, 1, 'none', 'none')`,
  ).run(QUEST_NAME, 'Trouble on Cyclops Lane');
}

/* ------------------------------------------------------------------- the restore */

let restorePoint: string | null = null;

function restoreClone(): void {
  if (restorePoint === null) {
    return;
  }
  git(['reset', '--hard', restorePoint]);
  const porcelain = git(['status', '--porcelain']);
  if (porcelain.trim() !== '') {
    throw new Error(`the D17 clone is still dirty after reset: ${porcelain}`);
  }
}

afterAll(() => {
  restoreClone();
});

describe.skipIf(!READINESS.ok)(
  'p6-08 AC1 — an insert through the real pipeline, in the D17 clone',
  () => {
    it('saves exactly the inserted field, and the restore moves every axis back', async () => {
      const before = cloneAxes();
      const beforeFileBytes = readFileSync(path.join(CLONE, QUEST_FILE), 'utf8');
      const beforeMeta = readSpiraldbJson(path.join(CLONE, META_FILE)) as Record<string, unknown>;
      restorePoint = before.head;

      const db: Db = openDb({ file: MEMORY_DB });
      try {
        // The session branch is the clone's **current** branch, so the save commits on it and no
        // session branch is created from `main` (the D76(b) shape this test then checks for).
        writeSettings(db, { user_name: 'P6-08 AC1 Tester', git_branch: before.branch });
        seedTables(db);

        const index = createSpiraldbIndex(CLONE);
        index.rebuild();
        const pipeline = createSavePipeline({ db, spiraldbPath: CLONE, index });

        /* ----------------------------- the row comes from task 6.6's own service ------- */
        const result = questEvidenceByName({ db, index }, QUEST_NAME);
        expect(result.kind).toBe('found');
        if (result.kind !== 'found') {
          return;
        }
        const evidence = result.evidence;
        expect(evidence.quest.title_source).toBe('none');
        // The split is the service's own computed predicate over the real file — and it equals the
        // measured 22 used / 8 available (D116's corrected figure for this quest).
        const usedRows = evidence.text_rows.filter((row) => row.used_by_this_file);
        const availableRows = evidence.text_rows.filter((row) => !row.used_by_this_file);
        expect(evidence.text_rows).toHaveLength(MEASURED_USED + MEASURED_AVAILABLE);
        expect(usedRows).toHaveLength(MEASURED_USED);
        expect(availableRows).toHaveLength(MEASURED_AVAILABLE);
        expect(availableRows.map((row) => row.key)).toContain(ROW_KEY);
        const availableRow = evidence.text_rows.find((row) => row.key === ROW_KEY);
        expect(availableRow).toBeDefined();
        expect(availableRow?.used_by_this_file).toBe(false);
        // An available row carries no provenance: `field` is the API's `null`, which is exactly why
        // the field it "belongs to" has to come from the focused field (see `lib/evidence-insert.ts`).
        expect(availableRow?.field).toBeNull();
        expect(availableRow?.value).toBe(ROW_TEXT);
        // The file's own dialogue entries point at the **sibling** table (measured), which is where
        // the 22 used rows come from — the goal-level dialog lists, not this table's dialogue.
        expect(evidence.dialogue.length).toBeGreaterThan(0);
        expect(evidence.dialogue.every((line) => line.own_table)).toBe(false);

        /* --------------------- the dialogue row ac1 names, and the field it belongs to ---- */
        const dialogueLine = evidence.dialogue.find((line) => line.dialog_key === DIALOGUE_KEY);
        expect(dialogueLine).toBeDefined();
        expect(dialogueLine?.own_table).toBe(false);
        expect(dialogueLine?.text).toBe(DIALOGUE_TEXT);
        const dialogueRow = dialogueInsertRow({
          index: dialogueLine?.index ?? 0,
          field: dialogueLine?.field ?? '',
          dialog_key: dialogueLine?.dialog_key ?? null,
        });
        // Its provenance is where the line already is (`dialogue[].field` + `.m_dialog`) — which the
        // reducer deliberately ignores, so the insert follows the **focused** entry instead.
        expect(dialogueRow.field?.slice(-1)).toEqual(['m_dialog']);
        expect(dialogueRow.key).toBe(DIALOGUE_KEY);

        const original = readSpiraldbJson(path.join(CLONE, QUEST_FILE)) as Record<string, unknown>;
        // The round-trip precondition that makes the raw diff minimal: this file is tool-written.
        expect(serializeDoc(original)).toBe(beforeFileBytes);

        /* --------------------------- the reducer's plan, applied with the D58 primitive - */
        const target = insertTargetAt([...FOCUSED_ENTRY_PATH]);
        expect(target).not.toBeNull();
        expect(target?.label).toBe(
          'm_goals[0].m_dialogList.m_dialogs[0].m_dialogEntries[0].m_dialog',
        );
        const plan = planEvidenceInsert(dialogueRow, target, original);
        expect(plan.ok).toBe(true);
        if (!plan.ok) {
          return;
        }
        expect(plan.source).toBe('focus');
        expect(plan.overwrites).toBe(true);
        expect(plan.edit).toEqual({
          op: 'set',
          path: [...FOCUSED_ENTRY_PATH],
          value: DIALOGUE_KEY,
        });
        // The KEY, not the text. The document stores string-table keys, and `string_table` is what
        // turns one into prose — a literal here would resolve to nothing in every reader.
        expect(JSON.stringify(plan.edit)).not.toContain('thwarting was unsuccessful');
        const goal0 = (original.m_goals as Record<string, unknown>[])[0] ?? {};
        expect(
          (
            (
              (goal0.m_dialogList as Record<string, unknown>).m_dialogs as Record<string, unknown>[]
            )[0]?.m_dialogEntries as Record<string, unknown>[]
          )[0]?.m_dialog,
        ).toBe(FOCUSED_ENTRY_BEFORE);

        const edited = applyEdits(original, [plan.edit]);

        /* ------------------------------ the goal-text ADD, in memory (the lead's fact 2) -- */
        // 0 of the 772 corpus goals carry `m_goalText`, so the plan's "goal text into the focused
        // goal" adds the key. Proved here on the real file's bytes, without saving a second commit.
        const goals = original.m_goals as Record<string, unknown>[];
        expect(Object.prototype.hasOwnProperty.call(goals[GOAL_INDEX] ?? {}, GOAL_FIELD)).toBe(
          false,
        );
        const goalTextRow = textInsertRow(availableRow as { key: string; field: string | null });
        const goalTextTarget = insertTargetAt(['m_goals', GOAL_INDEX, GOAL_FIELD]);
        const goalTextPlan = planEvidenceInsert(goalTextRow, goalTextTarget, original);
        expect(goalTextPlan.ok).toBe(true);
        if (!goalTextPlan.ok) {
          return;
        }
        const withGoalText = applyEdits(original, [goalTextPlan.edit]);
        const goalTextLines = serializeDoc(withGoalText).split('\n');
        const addedGoalText = goalTextLines.find((line) => line.includes(`"${GOAL_FIELD}"`));
        expect(addedGoalText?.trim()).toBe(`"${GOAL_FIELD}": "${ROW_KEY}"`);
        expect(goalTextLines.filter((line) => line.includes(`"${GOAL_FIELD}"`))).toHaveLength(1);
        // Deleting the added key gives the original *document* back (only a separator comma differs
        // in the serialization, because the key was appended after the goal's old last key).
        expect(deleteAtPath(withGoalText, goalTextPlan.path)).toEqual(original);
        const withGoalTextStripped = goalTextLines
          .slice(0, goalTextLines.indexOf(addedGoalText ?? ''))
          .concat(goalTextLines.slice(goalTextLines.indexOf(addedGoalText ?? '') + 1));
        const onlyComma = withGoalTextStripped.filter(
          (line, index) => line !== beforeFileBytes.split('\n')[index],
        );
        expect(onlyComma).toHaveLength(1);
        expect(onlyComma[0]).toBe(
          `${beforeFileBytes.split('\n').find((line) => line === onlyComma[0]?.slice(0, -1)) ?? ''},`,
        );

        /* --- the byte-level before/after, on the real document --------------------------- */
        // An existing field changes value, so the serialization differs on **exactly one line** —
        // no other line moves, and no comma changes (this is the strongest form of "only that
        // field": the file is byte-identical except for that one line).
        const beforeText = serializeDoc(original);
        const afterText = serializeDoc(edited);
        const beforeLines = beforeText.split('\n');
        const afterLines = afterText.split('\n');
        expect(afterLines).toHaveLength(beforeLines.length);
        const differing = afterLines
          .map((line, index) => ({ index, line, original: beforeLines[index] }))
          .filter((entry) => entry.line !== entry.original);
        expect(differing).toHaveLength(1);
        expect(differing[0]?.line.trim()).toBe(`"m_dialog": "${DIALOGUE_KEY}",`);
        expect(differing[0]?.original?.trim()).toBe(`"m_dialog": "${FOCUSED_ENTRY_BEFORE}",`);
        // Deleting nothing and setting the field back restores the bytes, exactly.
        const reverted = afterLines.slice();
        if (differing[0] !== undefined) {
          reverted[differing[0].index] = differing[0].original ?? '';
        }
        expect(reverted.join('\n')).toBe(beforeText);

        /* ------------------------------------------- the real save through the pipeline --- */
        const saved = await saveQuest({ db, index, pipeline, body: { quest: edited } });
        expect(saved.quest_name).toBe(QUEST_NAME);
        expect(saved.outcome).toBe('updated');
        expect(saved.action).toBe('update');
        expect(saved.commit_message).toBe(`spiraldb: update quest ${QUEST_NAME}`);
        expect(git(['log', '-1', '--pretty=%s']).trim()).toBe(
          `spiraldb: update quest ${QUEST_NAME}`,
        );
        expect(saved.file).toBe(QUEST_FILE);
        expect(saved.metadata).toBe(META_FILE);
        expect(saved.metadata_outcome).toBe('updated');

        /* ---- the changed file set is exactly {quest, metadata}: no third file moved ---- */
        const changedFiles = git(['diff', '--name-only', before.head, 'HEAD'])
          .trim()
          .split('\n')
          .filter((line) => line !== '')
          .sort();
        expect(changedFiles).toEqual([META_FILE, QUEST_FILE].sort());

        /* -------------------------- the raw diff, recorded and asserted ------------------ */
        const rawDiff = git(['diff', before.head, 'HEAD', '--', QUEST_FILE]);
        // Printed so the raw diff is part of the run's own output (the criterion asks for it raw).
        console.log(
          `\n===== p6-08 AC1 raw git diff (${QUEST_FILE}) =====\n${rawDiff}===== end raw diff =====`,
        );
        const { removed, added } = diffLines(rawDiff);
        // One line out, one line in — the field ac1 names, and nothing else.
        expect(removed).toHaveLength(1);
        expect(added).toHaveLength(1);
        expect(removed[0]?.trim()).toBe(`"m_dialog": "${FOCUSED_ENTRY_BEFORE}",`);
        expect(added[0]?.trim()).toBe(`"m_dialog": "${DIALOGUE_KEY}",`);
        // The diff's one value is the inserted key; the row's own TEXT is nowhere in it.
        expect(rawDiff).not.toContain('thwarting was unsuccessful');
        expect(rawDiff).not.toContain(GOAL_FIELD);
        expect(rawDiff).not.toContain('"m_locationName"');

        /* ------------------------------ the leaf-level statement ------------------------ */
        const after = readSpiraldbJson(path.join(CLONE, QUEST_FILE)) as Record<string, unknown>;
        const changes = leafChanges(original, after);
        expect(changes.map((change) => `${change.kind}:${change.path}`)).toEqual([
          `changed:m_goals[0].m_dialogList.m_dialogs[0].m_dialogEntries[0].m_dialog`,
        ]);
        expect(changes[0]?.before).toBe(FOCUSED_ENTRY_BEFORE);
        expect(changes[0]?.after).toBe(DIALOGUE_KEY);
        // The dialogue entry's siblings (the other four entries, the goal list, every other value)
        // are unchanged — asserted as values too, so the claim does not rest on one instrument.
        expect((after.m_goals as unknown[]).length).toBe((original.m_goals as unknown[]).length);
        const afterEntry0 = (
          (
            (
              ((after.m_goals as Record<string, unknown>[])[0] ?? {})['m_dialogList'] as Record<
                string,
                unknown
              >
            )['m_dialogs'] as Record<string, unknown>[]
          )[0]?.m_dialogEntries as Record<string, unknown>[]
        )[0];
        const beforeEntry0 = (
          (
            (
              ((original.m_goals as Record<string, unknown>[])[0] ?? {})['m_dialogList'] as Record<
                string,
                unknown
              >
            )['m_dialogs'] as Record<string, unknown>[]
          )[0]?.m_dialogEntries as Record<string, unknown>[]
        )[0];
        expect(afterEntry0?.['m_dialog']).toBe(DIALOGUE_KEY);
        for (const key of Object.keys(beforeEntry0 ?? {})) {
          if (key === 'm_dialog') {
            continue;
          }
          expect(isDeepStrictEqual(afterEntry0?.[key], beforeEntry0?.[key]), key).toBe(true);
        }

        /* ---------------------- the metadata: only the two stamps moved ----------------- */
        const afterMeta = readSpiraldbJson(path.join(CLONE, META_FILE)) as Record<string, unknown>;
        expect(
          leafChanges(beforeMeta, afterMeta)
            .map((change) => change.path)
            .sort(),
        ).toEqual(['ModifiedAt', 'ModifiedBy']);
        expect(afterMeta.ModifiedBy).toBe('P6-08 AC1 Tester');
        expect(afterMeta.Name).toBe(QUEST_NAME);
        expect(afterMeta.QuestTemplateId).toBe(beforeMeta.QuestTemplateId);
      } finally {
        db.close();
        restoreClone();
        restorePoint = null;
      }

      /* -------------------------------- the restore, on all five axes + the shape ------ */
      const after = cloneAxes();
      expect(after.porcelain).toBe('');
      expect(after.head).toBe(before.head);
      expect(after.branch).toBe(before.branch);
      expect(after.main).toBe(before.main);
      expect(after.commitCount).toBe(before.commitCount);
      // The complete local ref list too: D76(b)'s incident restored the commit and left a branch.
      expect(after.refs).toBe(before.refs);
      expect(questFileCount()).toBe(322);
      expect(questFileCount()).toBeGreaterThan(0);
      expect(before).toMatchObject({ branch: 'content/2026-09-27' });
      expect(readFileSync(path.join(CLONE, QUEST_FILE), 'utf8')).toBe(beforeFileBytes);
      console.log(
        `\n===== p6-08 AC1 clone restore (${
          before.head
        }) =====\nbranch=${after.branch} head=${after.head} main=${after.main} count=${after.commitCount} porcelain="${after.porcelain.trim()}" questFiles=${String(
          questFileCount(),
        )}\nmain ref unchanged: ${String(after.main === before.main)}; refs identical: ${String(
          after.refs === before.refs,
        )}\n===== end restore =====`,
      );
    });
  },
);
