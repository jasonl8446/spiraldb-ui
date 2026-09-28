import { defineConfig, devices } from '@playwright/test';

/**
 * **The same tier-1 harness, on a spare port** — story p4-10's working config.
 *
 * `playwright.config.ts` hardcodes `baseURL http://localhost:5173` (D38) and
 * `client/vite.config.ts` hardcodes `port: 5173, strictPort: true`, so while an unrelated
 * project's dev server (`card-gatcha-1`, the owner's other project) holds 5173 there is no way to
 * boot the hermetic harness through the committed config: Playwright refuses to start its own
 * server because the sibling's Vite history-fallback answers `/api/status/_import` with 200.
 *
 * This file changes **only** the client port (5181, via Vite's CLI override — the sibling's
 * process is untouched). Everything else is the committed config's behaviour: the throwaway
 * database (`SPIRALDB_UI_DB`, D44), `SPIRALDB_UI_SKIP_IMPORT`, `reuseExistingServer: false`, and
 * the readiness probe on the app's own `/api/status/_import` — which is the identity assertion:
 * the harness never probes whatever happens to be listening on a port, it waits for *this* app's
 * API route.
 *
 * It is **opt-in and uncollected**: the official run's default `testMatch` only takes
 * `*.spec.ts`, so a `*.config.ts` here is never part of `npm run test:ui`.
 *
 * Both p4-10 uses went through this file (or its identically-behaved earlier revision, which
 * additionally narrowed `testMatch` to the two p4-10 specs):
 *
 * ```
 * PLAYWRIGHT_BROWSERS_PATH=$PWD/tools/.playwright-browsers \
 *   npx playwright test --config tests/ui/p4-10-altport.config.ts
 * ```
 *
 * - the **falsification pass** (three deliberate breaks, D67(d)), and
 * - the **full-suite run** recorded in `docs/evidence/phase-4/p4-10-gate.txt`, which is this
 *   config's equivalent of `npm run test:ui` (same `testDir`, same default `testMatch`, same
 *   projects) — the official command could not boot while 5173 was held.
 */
export default defineConfig({
  // `testDir` defaults to this config's own directory (`tests/ui`), so the collected set is
  // exactly the official run's.
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5181',
    headless: true,
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // The committed command, run from the **repo root** (a config-relative cwd would look for
    // `client/vite.config.ts` inside tests/ui) with Vite's port overridden.
    //
    // `PORT` + `VITE_API_PORT` (both 3181) were added by the unattended review when the official
    // config gained the same pair (DR-12): the rig must not fall back to `3001`/`3001` any more than
    // the official run may, or this file would keep the very hole the official run closed.
    cwd: '../..',
    command:
      'rm -f data/test-ui.db && NODE_ENV=test SPIRALDB_UI_DB=$PWD/data/test-ui.db SPIRALDB_UI_SKIP_IMPORT=1 PORT=3181 VITE_API_PORT=3181 npx concurrently -n server,client -c blue,magenta "npx tsx server/src/index.ts" "npx vite --config client/vite.config.ts --port 5181"',
    url: 'http://localhost:5181/api/status/_import',
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
