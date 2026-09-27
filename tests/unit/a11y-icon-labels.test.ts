import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * **AC#10's automated query** (plan task 5.5): "All icon-only buttons expose ARIA labels
 * (automated query in a component test)".
 *
 * ## How it can fail
 *
 * It is a **sweep**, not a list: it walks every `.tsx` file under `client/src`, extracts
 * every JSX `button` / `Button` / `Link` / `a` / `NavLink` / `summary` element (depth-aware,
 * so a nested element belongs to its own parent, not to the outer one), and decides for
 * each whether it renders a name. An element fails when **all** of these hold:
 *
 *  - it has no name *attribute* — `aria-label`, `aria-labelledby` or `title`;
 *  - its children contain no static text and no bare expression child (a `{label}`,
 *    `{cond ? 'Saving…' : 'Save'}` — anything without a `<` — can render text);
 *  - it has no `<img alt="…">` in its children;
 *  - and it *is* icon-only: `size="icon"`, or a self-closing element/svg child with nothing
 *    else to name it.
 *
 * Adding a new `<Button size="icon"><Trash2 /></Button>` anywhere in `client/src` therefore
 * turns this test red on the next run. (Falsified while writing it: see the story report.)
 *
 * ## The limitation, stated
 *
 * This is a **source** scan, so it sees what the JSX says and not what React renders:
 *
 *  - a name injected by a wrapper component (`<Shell {...props} />` spreading an
 *    `aria-label` from its own props) is invisible here — the sweep would call that element
 *    unnamed only if it is *also* icon-only in source, and it reports the file:line so a
 *    human can check;
 *  - an `aria-labelledby` pointing at an element rendered elsewhere is accepted as a name
 *    without resolving the reference;
 *  - a name that is only ever composed at runtime (a `<span>` whose text comes from a hook)
 *    counts as text only when the expression is visible in the JSX.
 *
 * The **rendered** cross-check — a real DOM sweep of the accessibility names on four live
 * surfaces, with a positive count so it cannot pass on an empty page — is
 * `tests/ui/a11y-keyboard.spec.ts`. It is the complement, not a duplicate: this file covers
 * every component including ones no spec mounts; that file covers what actually reaches the
 * accessibility tree.
 *
 * ## The positive partner
 *
 * `namedIconOnly` is asserted to stay at or above a measured floor. Without it, a refactor
 * that stopped detecting icon-only elements altogether (or a page that stopped rendering)
 * would make the offender list trivially empty — D78(b)'s "`toHaveCount(0)` needs a positive
 * partner".
 */

const CLIENT_SRC = fileURLToPath(new URL('../../client/src', import.meta.url));

/** Every `.tsx` file under `client/src`, recursively, with POSIX-separated relative paths. */
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...tsxFiles(full));
    } else if (entry.name.endsWith('.tsx')) {
      out.push(path.relative(CLIENT_SRC, full).split(path.sep).join('/'));
    }
  }
  return out.sort();
}

interface JsxElement {
  file: string;
  line: number;
  tag: string;
  attrs: string;
  body: string;
}

/**
 * The index of an opening tag's closing `>`.
 *
 * **Not `src.indexOf('>')`** — the first version of this scan used that and was unsound:
 * an attribute such as `onClick={() => undefined}` (or `onChange={(e) => …}`) contains a `>`
 * inside its expression, so the attrs were cut short (losing `size="icon"`) and the *rest of
 * the tag* leaked into the element's "children", where it counted as static text and named
 * an unnamed button. It reported "0 offenders" on a deliberately broken file, which is the
 * failure mode the sweep exists to prevent. This walks the tag tracking `{}` nesting and
 * quoted strings, so a `>` only ends the tag at brace depth 0 outside a string.
 *
 * Known approximation: a template literal containing `${ … }` is treated as one string when
 * its own backticks are balanced, so a `>` inside a `${}` interpolation of a template literal
 * could still end the tag early. No file under `client/src` has one.
 */
function findOpenTagEnd(src: string, start: number): number {
  let brace = 0;
  let quote: string | null = null;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i] as string;
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '{') {
      brace += 1;
    } else if (ch === '}') {
      brace -= 1;
    } else if (ch === '>' && brace === 0) {
      return i;
    }
  }
  return -1;
}

/** Depth-aware extraction of one tag's elements from a source file. */
function findElements(file: string, src: string, tag: string): JsxElement[] {
  const out: JsxElement[] = [];
  const openRe = new RegExp(`<${tag}(?=[\\s/>])`, 'g');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'g');
  let match: RegExpExecArray | null;
  while ((match = openRe.exec(src)) !== null) {
    const start = match.index;
    const gt = findOpenTagEnd(src, start);
    if (gt === -1) {
      break;
    }
    const line = src.slice(0, start).split('\n').length;
    if (src[gt - 1] === '/') {
      out.push({ file, line, tag, attrs: src.slice(start, gt + 1), body: '' });
      openRe.lastIndex = gt + 1;
      continue;
    }
    let depth = 1;
    let cursor = gt + 1;
    let end = -1;
    while (cursor < src.length && depth > 0) {
      openRe.lastIndex = cursor;
      closeRe.lastIndex = cursor;
      const nextOpen = openRe.exec(src);
      const nextClose = closeRe.exec(src);
      if (nextClose === null) {
        break;
      }
      if (nextOpen !== null && nextOpen.index < nextClose.index) {
        depth += 1;
        cursor = nextOpen.index + 1;
      } else {
        depth -= 1;
        cursor = nextClose.index + nextClose[0].length;
        end = nextClose.index;
      }
    }
    if (end === -1) {
      openRe.lastIndex = gt + 1;
      continue;
    }
    out.push({ file, line, tag, attrs: src.slice(start, gt + 1), body: src.slice(gt + 1, end) });
    openRe.lastIndex = end;
  }
  return out;
}

/** The tags a keyboard user can reach and name — every one of them needs an accessible name. */
const INTERACTIVE_TAGS = ['button', 'Button', 'Link', 'NavLink', 'a', 'summary'] as const;

/** Static text inside the element's children, or `''`. */
function staticText(body: string): string {
  return body
    .replace(/\{[^{}]*\}/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `true` when some child expression can render text (`{label}`, `{a ? 'x' : y}`). */
function hasTextExpression(body: string): boolean {
  const expressions = [...body.matchAll(/\{([^{}]*)\}/g)].map((m) => (m[1] ?? '').trim());
  return expressions.some(
    (expression) =>
      expression !== '' &&
      !expression.includes('<') &&
      expression !== 'null' &&
      expression !== 'undefined',
  );
}

interface Verdict {
  element: JsxElement;
  iconOnly: boolean;
  named: boolean;
  reasons: string[];
}

function judge(element: JsxElement): Verdict {
  const hasNameAttribute = /\baria-label(?:ledby)?=|\btitle=/.test(element.attrs);
  const hasAlt = /\balt=/.test(element.body);
  const text = staticText(element.body);
  const textExpression = hasTextExpression(element.body);
  const hasIcon =
    /<[A-Za-z][A-Za-z0-9]*\b[^>]*\/>/.test(element.body) || /<svg\b/.test(element.body);
  const iconSize = /\bsize="icon"/.test(element.attrs);
  const named = hasNameAttribute || hasAlt || text !== '' || textExpression;
  // Icon-only: an explicit `size="icon"`, or no text channel at all alongside an icon.
  const iconOnly = iconSize || (hasIcon && !textExpression && text === '');
  const reasons: string[] = [];
  if (!hasNameAttribute && !hasAlt && text === '')
    reasons.push('no aria-label/aria-labelledby/title/alt');
  if (!textExpression) reasons.push('no text or text-rendering expression child');
  return { element, iconOnly, named, reasons };
}

function sweep(): { all: Verdict[]; offenders: Verdict[]; iconOnlyNamed: Verdict[] } {
  const all: Verdict[] = [];
  for (const file of tsxFiles(CLIENT_SRC)) {
    const src = readFileSync(path.join(CLIENT_SRC, file), 'utf8');
    for (const tag of INTERACTIVE_TAGS) {
      for (const element of findElements(file, src, tag)) {
        all.push(judge(element));
      }
    }
  }
  const offenders = all.filter((verdict) => verdict.iconOnly && !verdict.named);
  const iconOnlyNamed = all.filter((verdict) => verdict.iconOnly && verdict.named);
  return { all, offenders, iconOnlyNamed };
}

describe('AC#10 — every icon-only control exposes an accessible name', () => {
  const { all, offenders, iconOnlyNamed } = sweep();

  it('finds the interactive elements it is supposed to sweep', () => {
    // The positive partner: a sweep that stopped detecting anything would report zero
    // offenders and pass vacuously. Measured on this tree with the brace-aware tag scanner:
    // **113** interactive elements, **14** of them icon-only, every one of those named. The
    // floors sit just below those measurements (D78(b): a zero-count assertion needs a
    // positive partner).
    expect(
      all.length,
      `all=${all.length} iconOnlyNamed=${iconOnlyNamed.length}`,
    ).toBeGreaterThanOrEqual(100);
    expect(iconOnlyNamed.length, `iconOnlyNamed=${iconOnlyNamed.length}`).toBeGreaterThanOrEqual(
      10,
    );
  });

  it('has no icon-only control without a name', () => {
    const report = offenders
      .map(
        ({ element, reasons }) =>
          `${element.file}:${element.line} <${element.tag}> — ${reasons.join('; ')}`,
      )
      .join('\n');
    expect(offenders, `unnamed icon-only controls:\n${report}`).toHaveLength(0);
  });
});
