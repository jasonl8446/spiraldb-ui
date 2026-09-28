import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * **The contrast half of plan task 5.5** (`docs/spec-ui-design.md` L543: "Color contrast:
 * WCAG AA minimum (4.5:1 for text, 3:1 for large text)").
 *
 * The p5-05 audit measured this from the code and found a real, shipped violation: the app's
 * muted-text colour, `text-zinc-500`, is **4.12:1 on `zinc-950`, 3.67:1 on `zinc-900` and
 * 3.08:1 on `zinc-800`** — below the 4.5:1 floor for normal text — and it was used **133
 * times**; `text-zinc-600` (12 uses) was worse (2.57/2.29/1.93). Both owed to the fact that
 * the app has exactly three dark surfaces and every muted label sits on one of them. axe-core
 * reports this family as `color-contrast` at **serious** severity, so it is the violation the
 * lead's AC#2 scan would have found first.
 *
 * This file is the **durable** half of that finding, and it has two independent arms:
 *
 * 1. **The math**, over the app's real palette pairs — a named table, each entry measured.
 * 2. **The guard**: every `text-<colour>` utility used anywhere under `client/src` must be
 *    covered by that table. A new `text-zinc-500` (or any unknown token) fails the suite,
 *    which is what stops the defect from being reintroduced one label at a time. The palette
 *    is extended **deliberately**, exactly as D79 requires of a constant.
 *
 * ## Limits, stated
 *
 * - The ratio is computed for the **opaque** background tokens. The app has no light mode
 *   (`grep -rn "bg-white\|bg-zinc-50\|bg-zinc-100" client/src` → 0 matches), so "on a dark
 *   surface" is the whole space; a translucent surface (`bg-zinc-900/50`) can only move the
 *   ratio *towards* the text's own luminance, and every pair here passes with ≥1.3× headroom.
 * - It cannot see a colour that comes from an inline `style=` or from a CSS custom property —
 *   the source scan only reads Tailwind utility class names.
 * - The **rendered** confirmation is the lead's axe-core run (AC#2); this file is what makes
 *   the fix survive the next edit.
 */

/** Tailwind 3.4's own palette values, for the tokens this app uses (`node_modules/tailwindcss/colors.js`). */
const PALETTE: Record<string, string> = {
  'zinc-950': '#09090b',
  'zinc-900': '#18181b',
  'zinc-800': '#27272a',
  'zinc-700': '#3f3f46',
  'zinc-600': '#52525b',
  'zinc-500': '#71717a',
  'zinc-400': '#a1a1aa',
  'zinc-300': '#d4d4d8',
  'zinc-200': '#e4e4e7',
  'zinc-100': '#f4f4f5',
  'zinc-50': '#fafafa',
  white: '#ffffff',
  'amber-500': '#f59e0b',
  'amber-400': '#fbbf24',
  'amber-300': '#fcd34d',
  'amber-200': '#fde68a',
  'blue-600': '#2563eb',
  'blue-500': '#3b82f6',
  'blue-400': '#60a5fa',
  'blue-300': '#93c5fd',
  'blue-200': '#bfdbfe',
  'emerald-500': '#10b981',
  'emerald-400': '#34d399',
  'emerald-300': '#6ee7b7',
  'red-500': '#ef4444',
  'red-400': '#f87171',
  'red-300': '#fca5a5',
  'red-200': '#fecaca',
};

/** The three surfaces a label can sit on (`index.css`'s background / card / elevated tokens). */
const DARK_SURFACES = ['zinc-950', 'zinc-900', 'zinc-800'] as const;

/** Every foreground token the app uses as text on one of the dark surfaces. */
const DARK_SURFACE_TEXT = [
  'zinc-100',
  'zinc-200',
  'zinc-300',
  'zinc-400',
  'zinc-50',
  'white',
  'amber-200',
  'amber-300',
  'amber-400',
  'amber-500',
  'blue-200',
  'blue-300',
  'blue-400',
  'emerald-300',
  'emerald-400',
  'red-200',
  'red-300',
  'red-400',
] as const;

/** A foreground used on a **colour** background rather than on a dark surface, pair by pair. */
const ON_COLOUR_PAIRS: ReadonlyArray<readonly [string, string]> = [
  // `ui/badge.tsx`'s `warning` variant: amber-500 chip, zinc-950 label.
  ['zinc-950', 'amber-500'],
];

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colours (order-independent, 1..21). */
function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The AA floor for normal text (spec L543). */
const AA_TEXT = 4.5;
/** The AA floor for large text and UI boundaries. */
const AA_LARGE = 3;

const CLIENT_SRC = fileURLToPath(new URL('../../client/src', import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(tsx|ts|css)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out.sort();
}

/** Every `text-<colour>-<n>` / `text-white` class the sources use, token-normalised. */
function usedTextTokens(): Map<string, string[]> {
  const tokenToFiles = new Map<string, string[]>();
  const pattern =
    /(?<![\w-])(?:[a-z-]+:)?text-(white|black|(?:zinc|blue|amber|emerald|red|slate|gray|green)-\d{2,3})\b/g;
  for (const file of sourceFiles(CLIENT_SRC)) {
    const src = readFileSync(file, 'utf8');
    const relative = path.relative(CLIENT_SRC, file).split(path.sep).join('/');
    for (const match of src.matchAll(pattern)) {
      const token = match[1] as string;
      const files = tokenToFiles.get(token) ?? [];
      if (!files.includes(relative)) {
        files.push(relative);
      }
      tokenToFiles.set(token, files);
    }
  }
  return tokenToFiles;
}

describe('WCAG AA contrast — the app’s text palette', () => {
  it('the ratio function reproduces the audit’s measured numbers', () => {
    // The numbers the p5-05 audit quoted, so the finding cannot drift from its arithmetic.
    expect(contrastRatio(PALETTE['zinc-500'] as string, PALETTE['zinc-950'] as string)).toBeCloseTo(
      4.12,
      2,
    );
    expect(contrastRatio(PALETTE['zinc-500'] as string, PALETTE['zinc-900'] as string)).toBeCloseTo(
      3.67,
      2,
    );
    expect(contrastRatio(PALETTE['zinc-500'] as string, PALETTE['zinc-800'] as string)).toBeCloseTo(
      3.08,
      2,
    );
    expect(contrastRatio(PALETTE['zinc-600'] as string, PALETTE['zinc-950'] as string)).toBeCloseTo(
      2.57,
      2,
    );
    // …and that replacing them with `zinc-400` clears the floor on all three surfaces.
    for (const surface of DARK_SURFACES) {
      expect(
        contrastRatio(PALETTE['zinc-400'] as string, PALETTE[surface] as string),
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('every foreground token used on a dark surface clears 4.5:1', () => {
    for (const token of DARK_SURFACE_TEXT) {
      const foreground = PALETTE[token];
      expect(foreground, `unknown palette token "${token}"`).toBeDefined();
      for (const surface of DARK_SURFACES) {
        const ratio = contrastRatio(foreground as string, PALETTE[surface] as string);
        expect(
          ratio,
          `text-${token} on ${surface} is ${ratio.toFixed(2)}:1 — below the ${AA_TEXT}:1 AA floor`,
        ).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });

  it('a foreground on a colour background clears 4.5:1', () => {
    for (const [foreground, background] of ON_COLOUR_PAIRS) {
      const ratio = contrastRatio(PALETTE[foreground] as string, PALETTE[background] as string);
      expect(
        ratio,
        `text-${foreground} on ${background} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it('the palette covers every text colour the sources use', () => {
    const used = usedTextTokens();
    const known = new Set<string>([...DARK_SURFACE_TEXT, ...ON_COLOUR_PAIRS.map(([fg]) => fg)]);
    const unknown = [...used.keys()].filter((token) => !known.has(token)).sort();
    const report = unknown
      .map((token) => `text-${token} (${(used.get(token) ?? []).slice(0, 3).join(', ')})`)
      .join('\n');
    expect(
      unknown,
      `text colours with no measured contrast pair — add them to DARK_SURFACE_TEXT (with their ratio) or ON_COLOUR_PAIRS:\n${report}`,
    ).toHaveLength(0);
  });

  it('the status colours are ≥3:1 against the surfaces they mark', () => {
    // The dot in every `StatusBadge` is `aria-hidden` *colour*: it is not text, so the
    // non-text floor (3:1) is what applies — and it is what the badge's own text label
    // carries when the dot is the only mark left (spec L545's colour + text rule).
    for (const token of ['amber-500', 'blue-500', 'emerald-500']) {
      for (const surface of DARK_SURFACES) {
        const ratio = contrastRatio(PALETTE[token] as string, PALETTE[surface] as string);
        expect(ratio, `${token} on ${surface} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          AA_LARGE,
        );
      }
    }
  });
});
