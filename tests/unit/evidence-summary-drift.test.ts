import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The drift class, mechanically caught — "a summary claiming a greener result than the raw
 * transcript it cites".
 *
 * ## What the three known instances were
 *
 * The architect's verification (`docs/evidence/architect-verification.md`, DR-06/DR-07/DR-08) found
 * three records whose summary was stronger than the file it cites:
 *
 * 1. `docs/evidence/phase-4/p4-08.md` — "executor-run on the frozen tree: **7 × `rc=0`**" while
 *    `p4-08-gate.txt` ends check 2 with `--- rc=1`.
 * 2. `docs/evidence/phase-4/p4-09.md` — "the final run is 7 × `rc=0` … the recorded file is run 4
 *    (`p4-09-gate.txt`, overall `rc=0`)" while that file records two `--- rc=1`s.
 * 3. `.omd/prd/spiraldb-ui.json`'s `p5-07` evidence field — "SIX CHECKS, EACH rc CAPTURED ON ITS OWN
 *    COMMAND … rc=0 …" while `p5-07-gate.txt` carries four `rc=1` markers in its §7 runs (and the
 *    field never names that seventh run).
 *
 * Each passed review because checking it costs a full read of the cited transcript. This file makes
 * that check cost one `npm test`.
 *
 * ## The two rules (the cheapest pair that catches all three)
 *
 * **Rule A — a green tally in a story record.** On a **single line** of
 * `docs/evidence/phase-<n>/…/*.md`: a green claim (`7 × rc=0`, or `all/every/overall … rc=0`), citing
 * a `*.txt` transcript, where that transcript contains an `rc=1` marker and the claim line never
 * discloses a red result. Line-scoped on purpose: the drift is one assertive sentence, and widening
 * the window starts matching neighbouring honest paragraphs.
 *
 * **Rule B — a green tally in the ledger.** The same idea over a story's `evidence` field, which is
 * prose rather than a table row: it claims green if it contains any `rc=0`, it is disclosed if it
 * mentions a red result anywhere, and its transcript is the one it names — or, when it names none,
 * the file whose name carries the story id and `gate`. This is the rule that catches `p5-07`.
 *
 * ## What these rules deliberately do not do
 *
 * - **A claim that mentions red counts as disclosed** (`rc=1`, "failed", "flake", "red", or a "six of
 *   seven" tally). That is a heuristic for *disclosure*, not a proof of honesty — a summary could
 *   name one flake and hide another. Reading stays the authority; this is a tripwire for the
 *   "clean green tally over a red file" shape, which is the shape all three instances had.
 * - **Top-level `docs/evidence/*.md` audits are out of scope.** They *quote* drifted lines verbatim
 *   while reporting them (the architect's DR-06 section does exactly that), so scanning them would
 *   flag the report as the drift. The rule is about the records that set status, not the reviews
 *   that catch them.
 * - **The ledger arm skips, loudly, when `.omd/prd` is absent** (CI has no ledger: it is gitignored).
 *
 * ## Honest limits
 *
 * Rule B's fallback association is by filename, so a story whose transcript is named something
 * unrelated to its id *and* is not cited in the field is invisible to it; Rule A covers the same
 * shape where a citation exists. Neither rule can see a summary that cites no transcript at all —
 * for those, only reading works. And `rc=1`/`rc=0` are the conventions the transcripts in this repo
 * actually use (`--- rc=N`, `[rc=N]`, `rc_*=N`); a transcript that records a failure some other way
 * is invisible until it adopts one.
 */

/** How a green tally is claimed, on one line or in a field. */
const GREEN_TALLY = [
  /(\d+)\s*[×x]\s*[*`]{0,2}rc\s*=\s*0/i,
  /\b(?:all|every|overall)\b[^.\n]{0,40}rc\s*=\s*0/i,
];

/** A tally that names a partial result, e.g. "six of seven rc=0". */
const PARTIAL_TALLY = /\b\w+\s+of\s+(?:six|seven|eight|nine|ten|\d+)\b/i;

/** Words that disclose a red result in the same breath as the claim. */
const DISCLOSURE = /\brc\s*=\s*1\b|\bfail(?:ed|ure|s)?\b|\bflake(?:s|d|y)?\b|\bred\b/i;

/** Cited transcript filenames in a line or field. */
const CITED_TXT = /[A-Za-z0-9_./-]+\.txt/g;

export interface GreenClaim {
  /** 1-based line number (0 when the caller passes a single field). */
  readonly line: number;
  /** The raw line, trimmed. */
  readonly claim: string;
  /** The transcript filenames the line cites. */
  readonly cited: readonly string[];
}

/** Every line that claims a green tally and cites at least one transcript. */
export function greenClaims(text: string): GreenClaim[] {
  const claims: GreenClaim[] = [];
  text.split('\n').forEach((line, index) => {
    if (!GREEN_TALLY.some((pattern) => pattern.test(line))) {
      return;
    }
    const cited = line.match(CITED_TXT);
    if (cited === null) {
      return;
    }
    claims.push({ line: index + 1, claim: line.trim(), cited });
  });
  return claims;
}

/** True when a claim discloses that something red happened. */
export function isDisclosed(claim: string): boolean {
  return DISCLOSURE.test(claim) || PARTIAL_TALLY.test(claim);
}

/** The `rc=0` / `rc=1` marker counts in a transcript. */
export function rcTally(transcript: string): { rc0: number; rc1: number } {
  return {
    rc0: (transcript.match(/\brc\s*=\s*0\b/gi) ?? []).length,
    rc1: (transcript.match(/\brc\s*=\s*1\b/gi) ?? []).length,
  };
}

export interface DriftViolation {
  readonly line: number;
  readonly claim: string;
  readonly cited: string;
  readonly rc1: number;
}

/**
 * **Rule A.** `readTranscript` resolves a cited filename to its text, or `undefined` when the file is
 * not in this checkout (a citation outside the repo is skipped, never guessed at).
 */
export function driftViolations(
  text: string,
  readTranscript: (cited: string) => string | undefined,
): DriftViolation[] {
  const violations: DriftViolation[] = [];
  for (const claim of greenClaims(text)) {
    if (isDisclosed(claim.claim)) {
      continue;
    }
    for (const cited of claim.cited) {
      const transcript = readTranscript(cited);
      if (transcript === undefined) {
        continue;
      }
      const tally = rcTally(transcript);
      if (tally.rc1 > 0) {
        violations.push({ line: claim.line, claim: claim.claim, cited, rc1: tally.rc1 });
      }
    }
  }
  return violations;
}

/**
 * **Rule B.** A ledger evidence field, the transcript names to try for it, and a resolver.
 *
 * Separate from Rule A because a field is not a line: it has no "same line as the citation" rule,
 * and its green test is looser (`any rc=0` — an enumeration of six green checks is a green claim).
 *
 * Its **disclosure test is deliberately different, and this was measured rather than guessed**: a
 * word-based test (`failed`, `flake`, `red`) is *vacuous* on these fields — all of them are 5–10 KB
 * paragraphs that mention a failure somewhere (measured: p5-07 3 such words, p4-08 4, p5-03 3,
 * p4-10 9, p5-04 13), so every field would count as disclosed and the rule could never fire. What
 * the field must do instead is name the red **mark**: an `rc=1` of its own, or a partial tally
 * ("six of seven") that admits one. That is the honest, non-vacuous requirement, and it is what
 * catches p5-07's six green checks over a transcript carrying four `rc=1` markers.
 */
export function ledgerDisclosed(evidence: string): boolean {
  return /\brc\s*=\s*1\b/i.test(evidence) || PARTIAL_TALLY.test(evidence);
}

export function ledgerDrift(
  evidence: string,
  candidates: readonly string[],
  readTranscript: (cited: string) => string | undefined,
): DriftViolation[] {
  if (evidence.length === 0 || ledgerDisclosed(evidence)) {
    return [];
  }
  const claimsGreen =
    GREEN_TALLY.some((pattern) => pattern.test(evidence)) || /\brc\s*=\s*0\b/i.test(evidence);
  if (!claimsGreen) {
    return [];
  }
  const violations: DriftViolation[] = [];
  for (const cited of candidates) {
    const transcript = readTranscript(cited);
    if (transcript === undefined) {
      continue;
    }
    const tally = rcTally(transcript);
    if (tally.rc1 > 0) {
      violations.push({ line: 0, claim: evidence.slice(0, 120), cited, rc1: tally.rc1 });
    }
  }
  return violations;
}

/* ------------------------------------------------------------------- the three known instances */

/**
 * The three historical claims, **verbatim as they stood before this review corrected them**, each
 * with a transcript fixture that reproduces the marker it contradicted. These are the negative
 * controls: the rules must flag all three, or they cannot claim to have caught anything.
 */
const HISTORICAL_MARKDOWN = [
  {
    story: 'p4-08',
    claim:
      "- **Gate**: `docs/evidence/phase-4/p4-08-gate.txt` (executor-run on the frozen tree: **7 × `rc=0`**) plus the lead's own run recorded in §4.",
    transcript: 'check 2: npm run test:ui\n261 passed | 1 failed (261)\n--- rc=1\n',
  },
  {
    story: 'p4-09',
    claim:
      '   7 × `rc=0`.** The gate was run four times; the recorded file is run 4 (`p4-09-gate.txt`, overall',
    transcript: 'check 1: npm test\n2 failed | 1307 passed\n--- rc=1\ncheck 2\n--- rc=1\n',
  },
] as const;

const HISTORICAL_LEDGER = {
  story: 'p5-07',
  evidence:
    'GATE: SIX CHECKS, EACH rc CAPTURED ON ITS OWN COMMAND: npm test **1,460 passed** rc=0, npm run lint rc=0, npm run typecheck:tests rc=0, both tsc rc=0, npm run build rc=0. The story D3 evidence documents were never written; the lead gate output is the evidence.',
  transcript:
    'six checks\nrc_1=0\nrc_2=0\n§7 the four UI runs\n--- rc=1\n--- rc=1\n--- rc=1\n--- rc=1\n',
} as const;

const ALL_GREEN = 'check 1\nrc=0\ncheck 2\nrc=0\n';

describe('the rules catch the three known instances (negative controls)', () => {
  for (const fixture of HISTORICAL_MARKDOWN) {
    it(`Rule A flags ${fixture.story}'s drifted summary against its own transcript`, () => {
      const read = (cited: string): string | undefined =>
        cited.includes(fixture.story) ? fixture.transcript : undefined;
      const violations = driftViolations(fixture.claim, read);
      expect(
        violations.length,
        `${fixture.story}: the rule exists because of this claim, so it must flag it`,
      ).toBeGreaterThan(0);
      expect(violations[0].rc1).toBeGreaterThan(0);
    });
  }

  it("Rule B flags p5-07's six-check enumeration against its gate transcript", () => {
    const violations = ledgerDrift(
      HISTORICAL_LEDGER.evidence,
      ['p5-07-gate.txt'],
      () => HISTORICAL_LEDGER.transcript,
    );
    expect(
      violations.length,
      'the ledger rule exists because of this field, so it must flag it',
    ).toBeGreaterThan(0);
    expect(violations[0].cited).toBe('p5-07-gate.txt');
  });

  it('does not flag the same claims over transcripts that are genuinely all green', () => {
    for (const fixture of HISTORICAL_MARKDOWN) {
      expect(driftViolations(fixture.claim, () => ALL_GREEN)).toEqual([]);
    }
    expect(ledgerDrift(HISTORICAL_LEDGER.evidence, ['p5-07-gate.txt'], () => ALL_GREEN)).toEqual(
      [],
    );
  });

  it('treats a disclosed red result as disclosed, not as drift', () => {
    const [first] = HISTORICAL_MARKDOWN;
    expect(
      driftViolations(
        `${first.claim} [CORRECTED: the file records check 2 as rc=1]`,
        () => 'rc=1\n',
      ),
    ).toEqual([]);
    expect(driftViolations(`${first.claim} (flaked once, re-run green)`, () => 'rc=1\n')).toEqual(
      [],
    );
    expect(
      ledgerDrift(
        `${HISTORICAL_LEDGER.evidence} Runs A/B were red (rc=1) and re-run.`,
        ['p5-07-gate.txt'],
        () => 'rc=1\n',
      ),
    ).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------- corpus sweep */

const REPO = fileURLToPath(new URL('../../', import.meta.url));

/** Every file under a directory, keeping those whose name passes `keep`. */
function filesUnder(dir: string, keep: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return filesUnder(full, keep);
    }
    return keep(entry.name) ? [full] : [];
  });
}

/** The phase evidence trees' files — `docs/evidence/phase-<n>/**`, never the top-level audits. */
function phaseEvidenceFiles(keep: (name: string) => boolean): string[] {
  const root = path.join(REPO, 'docs/evidence');
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('phase-'))
    .flatMap((entry) => filesUnder(path.join(root, entry.name), keep));
}

/**
 * The story/gate **records** (markdown) — what Rule A sweeps.
 *
 * Distinct from the transcripts below, and the first version of this file conflated the two: the
 * Rule B fallback searched this list for a file "whose name carries the story id and `gate`", found
 * no `.txt` in it at all, and therefore reported p5-07 — the instance the rule exists for — as clean.
 * A rule that cannot see its own test case is worse than no rule.
 */
function storyRecords(): string[] {
  return phaseEvidenceFiles((name) => name.endsWith('.md'));
}

/** The raw **transcripts** (command output) that records and ledger fields cite. */
function transcripts(): string[] {
  return phaseEvidenceFiles((name) => name.endsWith('.txt'));
}

/** Walked once: 63 ledger stories each asking for transcripts would re-read the tree 63 times. */
const TRANSCRIPT_PATHS = transcripts();

/** Resolve a citation the way a reader would: as written from the repo root, then from the citer. */
function resolver(fromFile: string): (cited: string) => string | undefined {
  return (cited) => {
    for (const candidate of [path.join(REPO, cited), path.join(path.dirname(fromFile), cited)]) {
      if (existsSync(candidate)) {
        return readFileSync(candidate, 'utf8');
      }
    }
    return undefined;
  };
}

describe('every story record under docs/evidence/phase-*/ agrees with the transcript it cites', () => {
  const records = storyRecords();

  it('scans the story records (a broken walk must fail, not pass)', () => {
    expect(records.length, 'story records found').toBeGreaterThanOrEqual(40);
  });

  it('has no undisclosed green tally over a transcript carrying an rc=1 marker', () => {
    const found = records.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return driftViolations(text, resolver(file)).map(
        (violation) =>
          `${path.relative(REPO, file)}:${violation.line} claims "${violation.claim.slice(0, 90)}" — but ${violation.cited} has ${violation.rc1} rc=1 marker(s)`,
      );
    });
    expect(found, 'summary lines stronger than the transcript they cite').toEqual([]);
  });
});

/* --------------------------------------------------------------------------------- the ledger */

const LEDGER = path.join(REPO, '.omd/prd/spiraldb-ui.json');

interface LedgerStory {
  readonly id: string;
  readonly evidence?: unknown;
}

describe('the ledger never sets status from a summary (the p5-07 shape)', () => {
  const ledgerExists = existsSync(LEDGER);
  const stories: readonly LedgerStory[] = ledgerExists
    ? (JSON.parse(readFileSync(LEDGER, 'utf8')) as { stories: LedgerStory[] }).stories
    : [];

  /**
   * The transcripts to try for one story: the gate-shaped files it names, else the one named after
   * its own gate.
   *
   * The filter matters and was measured: a field that cites `.omd/prd/progress.txt` — the
   * project-wide ralph log, which carries 21 `rc=1` markers from every phase — is not claiming its
   * own checks against that log, so a cited file counts only when its name says `gate` or carries
   * the story id. Without this, `final-verify` was the sole hit of the first live run, as a false
   * positive.
   */
  function candidatesFor(story: LedgerStory, evidence: string): string[] {
    const cited = (evidence.match(CITED_TXT) ?? [])
      .map((name) => path.basename(name))
      .filter((name) => name.includes('gate') || name.includes(story.id));
    if (cited.length > 0) {
      return cited;
    }
    return TRANSCRIPT_PATHS.filter((file) => {
      const base = path.basename(file);
      return base.includes(story.id) && base.includes('gate');
    }).map((file) => path.basename(file));
  }

  /**
   * Resolve a candidate **basename** (a field cites `docs/evidence/…/p5-07-gate.txt`, and the
   * fallback produces bare names) to the transcript's text. The second version of this file resolved
   * basenames against the repo root and `.omd/prd/`, found nothing, skipped p5-07, and reported the
   * ledger clean — the rule's own test case, invisible twice.
   */
  function resolveByBasename(name: string): string | undefined {
    const wanted = path.basename(name);
    const hit = TRANSCRIPT_PATHS.find((file) => path.basename(file) === wanted);
    return hit === undefined ? undefined : readFileSync(hit, 'utf8');
  }

  it('reports honestly whether the ledger is in this checkout', () => {
    if (!ledgerExists) {
      // CI has no `.omd/prd` (gitignored), so this arm cannot run there; say so rather than
      // implying the ledger was checked.
      console.info('[evidence-drift] .omd/prd/spiraldb-ui.json absent — ledger arm skipped');
      return;
    }
    expect(stories.length, 'stories in the ledger').toBeGreaterThanOrEqual(60);
  });

  it('has no story whose evidence field claims green while its gate transcript is red', () => {
    if (!ledgerExists) {
      return;
    }
    const found = stories.flatMap((story) => {
      const evidence = typeof story.evidence === 'string' ? story.evidence : '';
      return ledgerDrift(evidence, candidatesFor(story, evidence), resolveByBasename).map(
        (violation) =>
          `${story.id}: evidence claims rc=0 — but ${violation.cited} has ${violation.rc1} rc=1 marker(s)`,
      );
    });
    expect(found, 'ledger evidence fields stronger than their gate transcripts').toEqual([]);
  });
});
