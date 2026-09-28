/**
 * Source text with **comments removed** — the rule every source-reading assertion in `tests/unit`
 * follows.
 *
 * Not cosmetic, and measured twice:
 *
 * - `server/src/index.ts`'s docblock quotes the vulnerable form (`app.listen(PORT)`) while
 *   explaining why it was rejected, and the first version of the loopback assertion matched that
 *   mention instead of the real call.
 * - The first version of this helper stripped every `//` to end-of-line, which **mangles string
 *   literals that contain a URL**: `target: \`http://localhost:${…}\`` became `target: \`http:`,
 *   so the assertion that the proxy reads `VITE_API_PORT` failed on a file that does exactly that.
 *
 * So: block comments go, and a `//` only starts a comment at the start of a line or after
 * whitespace (never after `:` inside `http://`). A rule about what a file *does* must not be
 * decided by what it *says* about what it once did, nor by text a naive stripper damaged.
 */
export function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/gm, '$1');
}
