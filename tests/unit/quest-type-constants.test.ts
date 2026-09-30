import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEFAULT_SPIRALDB_PATH } from '@server/db';
import {
  CORPUS_TYPE_STRINGS,
  KNOWN_TYPE_STRINGS,
  SPEC_ONLY_TYPE_STRINGS,
  TYPE_STRINGS,
  isKnownTypeString,
  shortTypeName,
} from '@shared/quest';

/**
 * Task 3.1's acceptance criterion #1 — the `$type` audit.
 *
 * The plan's verification step is
 * `grep -rho '"$type": *"[^"]*"' /home/jason/Documents/git-projects/spiraldb/QuestTemplates/ | sort | uniq -c | sort -rn`
 * compared against `shared/quest/typeConstants.ts`. This test **re-runs the real grep**
 * against the real SpiralDB corpus whenever that sibling repository is present (the owner's
 * local run), and always asserts against the committed recording of the first measurement
 * (`server/test/fixtures/quest_corpus_type_strings.json`) so the constant table cannot drift
 * in CI, where no sibling repo exists (the `manifest.test.ts` / `corpus.test.ts` pattern:
 * synthetic or recorded fixtures are committed, real files never are).
 *
 * The assertion is `grep output ⊆ constants`, never equality: the table is allowed to carry
 * more than the corpus does. **At the owner's `f9a1055` baseline it carries exactly what the
 * corpus measures** — 29 strings, no spec-only entry — because `ReqIsSchool`, the one spec-listed
 * type the 322-file corpus did not contain, now occurs **7 times** (one per
 * `WC-COMMONS-MAIN-002-*` quest) and moved into the corpus table (D79/D80). The recording was
 * re-measured with it; the earlier 322-file recording is quoted in the fixture's own comment.
 */

interface RecordedCorpus {
  measuredOn: string;
  corpusPath: string;
  corpusFiles: number;
  strictJsonFiles: number;
  grepCommand: string;
  typeStringCounts: Record<string, number>;
  distinctTypeStrings: number;
  totalTypeOccurrences: number;
}

const FIXTURES = fileURLToPath(new URL('../../server/test/fixtures/', import.meta.url));
const RECORDED = JSON.parse(
  readFileSync(path.join(FIXTURES, 'quest_corpus_type_strings.json'), 'utf8'),
) as RecordedCorpus;

/**
 * The real corpus, overridable for a different checkout. The default is the repository's own
 * default SpiralDB path (`server/src/db.ts`'s `DEFAULT_SPIRALDB_PATH`), so this test needs no
 * configuration on the owner's machine.
 *
 * The file count comes from the **recording** (`RECORDED.corpusFiles`) rather than a fresh
 * `readdir`: that is the p3-01 style (the recording is the measurement of record, and the live
 * grep above it asserts the strings). It is 330 at the owner fork's `864bd44` (the Phase 7 baseline, D145(b)): 328 at `d57d891` plus the two
 * harness-authored scaffolds `7e34bed`/`864bd44` (an owner post-run review item; if the owner drops them
 * the recording returns to 328 files / 8,746 occurrences / ActorDialogList 797).
 */
const CORPUS_DIR =
  process.env.SPIRALDB_QUEST_CORPUS ?? path.join(DEFAULT_SPIRALDB_PATH, 'QuestTemplates');
const CORPUS_PRESENT = existsSync(CORPUS_DIR);

if (!CORPUS_PRESENT) {
  console.log(
    `[p3-01 ac1] real corpus not present at ${CORPUS_DIR} — the live grep is skipped and the ` +
      'committed recording of the measurement is asserted instead (CI has no sibling repo).',
  );
}

/** One `"$type": "…"` token as `grep -o` prints it. */
const TYPE_FIELD = /^"\$type":\s*"(.*)"$/;

/**
 * The real grep, counted in process — the equivalent of the plan's
 * `| sort | uniq -c | sort -rn` (which only orders the same counts).
 */
function measureTypeStrings(dir: string): Map<string, number> {
  const result = spawnSync('grep', ['-rho', '"$type": *"[^"]*"', dir], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  expect(result.status).toBe(0);
  const counts = new Map<string, number>();
  for (const line of result.stdout.split('\n')) {
    if (line === '') {
      continue;
    }
    const match = TYPE_FIELD.exec(line);
    if (match !== null) {
      counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    }
  }
  return counts;
}

/** The measured counts rendered the way the plan's pipeline prints them. */
function formatCounts(counts: Map<string, number>): string {
  return [...counts.entries()]
    .sort(([aValue, aCount], [bValue, bCount]) => bCount - aCount || aValue.localeCompare(bValue))
    .map(([value, count]) => `${String(count).padStart(6)} "${value}"`)
    .join('\n');
}

describe('the recorded corpus measurement (committed fixture)', () => {
  it('records exactly the 29 measured $type strings, all present in the constant table', () => {
    const measured = Object.keys(RECORDED.typeStringCounts);
    expect(measured).toHaveLength(29);
    expect(RECORDED.distinctTypeStrings).toBe(29);
    expect(RECORDED.corpusFiles).toBe(330);
    expect(RECORDED.totalTypeOccurrences).toBe(8748);
    expect(measured.every((value) => isKnownTypeString(value))).toBe(true);

    // The corpus table's values are exactly the 29 recorded strings — nothing extra is
    // presented as corpus-measured, nothing measured is missing.
    expect(Object.values(CORPUS_TYPE_STRINGS).sort()).toEqual([...measured].sort());
  });

  it('has no spec-only type at this baseline: ReqIsSchool is corpus-measured now', () => {
    // The 322-file corpus did not carry `ReqIsSchool` (it lived in SPEC_ONLY_TYPE_STRINGS,
    // 0 occurrences). The owner's 328-file baseline carries it 7 times, so it is a corpus
    // string and the spec-only table is empty — both halves stated, so the claim is checkable.
    const reqIsSchool = 'Imcodec.ObjectProperty.TypeCache.ReqIsSchool, Imcodec.ObjectProperty';
    expect(Object.keys(SPEC_ONLY_TYPE_STRINGS)).toEqual([]);
    expect(Object.values(CORPUS_TYPE_STRINGS)).toContain(reqIsSchool);
    expect(KNOWN_TYPE_STRINGS).toContain(reqIsSchool);
    expect(RECORDED.typeStringCounts[reqIsSchool]).toBe(7);
    expect(Object.keys(TYPE_STRINGS)).toHaveLength(29);
    // The three baseline additions, each with its measured count.
    expect(RECORDED.typeStringCounts[reqIsSchool]).toBe(7);
    expect(
      RECORDED.typeStringCounts[
        'Imcodec.ObjectProperty.TypeCache.ResActorDialog, Imcodec.ObjectProperty'
      ],
    ).toBe(5);
    expect(
      RECORDED.typeStringCounts[
        'Imcodec.ObjectProperty.TypeCache.ActorDialog, Imcodec.ObjectProperty'
      ],
    ).toBe(5);
    // The audit assertion holds for the recording: measured ⊆ known.
    expect(Object.keys(RECORDED.typeStringCounts).filter((v) => !isKnownTypeString(v))).toEqual([]);
  });

  it('names each constant from its own assembly-qualified string', () => {
    for (const value of KNOWN_TYPE_STRINGS) {
      expect(shortTypeName(value)).toBeDefined();
      expect(value).toMatch(
        /^Imcodec\.ObjectProperty\.TypeCache\.[A-Za-z0-9_]+, Imcodec\.ObjectProperty$/,
      );
    }
    expect(shortTypeName('Imcodec.ObjectProperty.TypeCache.Nope, Imcodec.ObjectProperty')).toBe(
      undefined,
    );
    // The plan's list never mentions the corpus's commonest $type; the table does.
    expect(shortTypeName(Object.keys(RECORDED.typeStringCounts)[0])).toBeDefined();
    expect(
      isKnownTypeString(
        'Imcodec.ObjectProperty.TypeCache.MadlibArgT_ByteString, Imcodec.ObjectProperty',
      ),
    ).toBe(true);
  });

  it('does not claim the test-only GoalCompilation label as a corpus type', () => {
    // `tests/unit/save-pipeline.test.ts` and `spiraldb-files.test.ts` use this string as a
    // synthetic goal `$type`; it occurs 0 times in the corpus (and a real CLI run emits the 5
    // goal classes, verified through `tools/bin/imview-packet-reader`), so it is deliberately
    // not in the table — the goal union rejects it loudly.
    expect(
      isKnownTypeString('Imcodec.ObjectProperty.TypeCache.GoalCompilation, Imcodec.ObjectProperty'),
    ).toBe(false);
  });
});

describe.skipIf(!CORPUS_PRESENT)('the live corpus (owner run, real SpiralDB checkout)', () => {
  it("re-runs the plan's grep and asserts the measured $type set ⊆ the constant table", () => {
    const counts = measureTypeStrings(CORPUS_DIR);
    const measured = [...counts.keys()];

    console.log(
      `[p3-01 ac1] grep -rho '"$type": *"[^"]*"' ${CORPUS_DIR}\n` +
        `[p3-01 ac1] measured: ${measured.length} distinct $type strings, ` +
        `${[...counts.values()].reduce((a, b) => a + b, 0)} occurrences over ` +
        `${RECORDED.corpusFiles} quest files (the recorded baseline)\n${formatCounts(counts)}`,
    );

    const unknown = measured.filter((value) => !isKnownTypeString(value));
    expect(unknown, `measured $type strings missing from shared/quest/typeConstants.ts`).toEqual(
      [],
    );
    expect(measured).toHaveLength(Object.keys(CORPUS_TYPE_STRINGS).length);

    // Drift detection: counts equal the recording **only** when this run measured the same
    // checkout the recording came from. The D17 test clone legitimately differs (7,911
    // occurrences vs the real corpus's 7,956 — this tool's own pipeline rewrote two files
    // there), so a different checkout asserts the subset and the distinct count only.
    if (path.resolve(CORPUS_DIR) === path.resolve(RECORDED.corpusPath)) {
      expect(Object.fromEntries([...counts.entries()].sort())).toEqual(
        Object.fromEntries(Object.entries(RECORDED.typeStringCounts).sort()),
      );
    } else {
      console.log(
        `[p3-01 ac1] measured ${CORPUS_DIR}, which is not the recorded checkout ` +
          `(${RECORDED.corpusPath}) — count equality is not asserted for it.`,
      );
    }
  });
});
