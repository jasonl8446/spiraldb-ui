import { defineConfig, devices } from '@playwright/test';

/**
 * The **tier-2 live rig** config for story p4-09 (decision D23 tier 2).
 *
 * Deliberately separate from `playwright.config.ts`: that config boots the hermetic tier-1 stack
 * (its own throwaway database, route-mocked specs, no sibling repos). This one assumes the
 * operator has started a fresh-port rig against the D17 clone and asserts against the clone's git
 * history — so it starts **no** server and reuses nothing.
 *
 * ```
 * P4_09_LIVE_URL=http://localhost:3199 P4_09_CLONE=$PWD/data/test-spiraldb \
 *   npx playwright test --config tests/ui/p4-09-live.config.ts
 * ```
 *
 * `testMatch` names the `*.rig.ts` file explicitly (that suffix is what keeps the tier-1 run from
 * collecting it), and browsers come from `PLAYWRIGHT_BROWSERS_PATH` exactly as the npm scripts set
 * it for tier 1.
 */
const baseURL = process.env.P4_09_LIVE_URL;

if (baseURL === undefined || baseURL.trim() === '') {
  throw new Error(
    'The p4-09 live rig config needs a running rig: set P4_09_LIVE_URL (e.g. http://localhost:3199). ' +
      'It starts no server on purpose — an unconfigured run must fail loudly rather than probe ' +
      'whatever happens to be listening.',
  );
}

export default defineConfig({
  // `testDir` defaults to this config's own directory (tests/ui).
  testMatch: 'p4-09-live.rig.ts',
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: { baseURL, headless: true, trace: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
