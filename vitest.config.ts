import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
      '@server': path.resolve(__dirname, 'server', 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    /**
     * A BUDGET, not a relaxed assertion. Several suites deliberately walk the real corpus —
     * `quest-dialog` parses 1,706 dialog entries, `quest-roundtrip` and `object-corpus-roundtrip`
     * parse every file of their families — and vitest's 5,000 ms default is a load-sensitive budget
     * for them: measured on this host, `quest-dialog`'s sweep passes in 1.9 s alone and times out in
     * a full parallel run under peak load, and two different sweeps failed in two such runs. Raising
     * the ceiling keeps every assertion exactly as strict (D67(d): make the waiter patient, never the
     * claim weaker) while still failing a genuinely hung test.
     */
    testTimeout: 30_000,
  },
});
