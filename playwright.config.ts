import { defineConfig, devices } from '@playwright/test';

/**
 * Tier-1 UI test harness (plan task 1.10, decision D23 tier 1; lead decisions D40).
 *
 * These specs drive the real app in headless chromium against the real dev stack
 * (`npm run dev` = Express :3001 + Vite :5173) — they are the "does the shell work
 * in a browser" gate, not an integration test of the sync engine. Everything the
 * specs assert about data is route-mocked in `tests/ui/shell.spec.ts`, because CI
 * has no sibling repos, no `data/spiraldb-ui.db` and no WAD data (D23 tier 1).
 *
 * Why the pieces below are what they are:
 *
 * - **`SPIRALDB_UI_SKIP_IMPORT=1`** (D37's escape hatch): a fresh CI database would
 *   otherwise make the server attempt the first-startup import against a
 *   `spiraldb_path` that does not exist on the runner.
 * - **`localhost`, never `127.0.0.1`**: Vite 5 binds `[::1]` only (D38).
 * - **The readiness URL is an API route, not `/`**: polling `/api/status/_import`
 *   through the Vite proxy only answers 200 once Vite, the proxy *and* Express are
 *   all up, so the harness cannot start testing a half-booted stack. Measured on
 *   this machine: 0.9 s from `npm run dev` to ready.
 * - **Browsers come from `PLAYWRIGHT_BROWSERS_PATH`**, set by the npm scripts
 *   (`test:ui` / `test:ui:install`) — never the Nix store's or `~/.cache`'s copy,
 *   whose revision is coupled to a different playwright package (plan task 1.10).
 *   `npx playwright test` run directly therefore needs that variable set too; the
 *   scripts exist so the install and the run cannot disagree.
 * - **No retries locally** (`retries: process.env.CI ? 1 : 0`): a flaky tier-1
 *   spec is a bug to fix, not to paper over; CI keeps one retry for runner noise.
 */
export default defineConfig({
  testDir: 'tests/ui',

  // The shell is a single-page app with shared server state (one SQLite file):
  // parallel workers would only fight over it, and the tier-1 suite is seconds.
  fullyParallel: false,

  retries: process.env.CI ? 1 : 0,

  // Generous against CI's cold start; locally the stack is ready in under a second.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],

  use: {
    // Vite binds [::1] (D38) — `localhost` resolves there, `127.0.0.1` does not.
    baseURL: 'http://localhost:5173',
    headless: true,
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'SPIRALDB_UI_SKIP_IMPORT=1 npm run dev',
    url: 'http://localhost:5173/api/status/_import',
    // A developer's running stack is reused locally (fast iteration); CI always
    // boots its own, so the run can never depend on a machine's leftover server.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Surface the dev stack's own boot lines in the test output: they are the
    // proof that the server (not only Vite) came up and that the import was skipped.
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
