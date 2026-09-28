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
    /**
     * One file at a time — **because the D17 clone (`data/test-spiraldb`) is shared mutable state**
     * and more than one suite now mutates it.
     *
     * The hazard is recorded, not discovered here: D66(g) ("a latent flake risk") noted that
     * `quest-edit-isolation` resets the clone while several corpus sweeps read it, and that the
     * fix is to serialise the clone-mutating tests (`fileParallelism: false`, a per-file sequence
     * setting, or a dedicated temp clone) or to accept the flake. Story p6-08 added the **second**
     * clone writer (`quest-evidence-insert-isolation`, whose save must land in the D17 clone
     * because that is the run's save corpus), and the flake stopped being latent: measured on this
     * host, the parallel run failed **both** suites — one saw the other's in-flight file write
     * (`DirtyRepoError`), and the other's `git diff` lost the quest file because a `reset --hard`
     * landed mid-flight. That is the same shape gate-3's first run hit.
     *
     * Measured cost of the fix on this host: the unit suite goes from 11 s wall to ~51 s (82 files,
     * 1,701 tests). The two clone-mutating suites each hold the clone for ~1.5 s, so the serial
     * run pays almost nothing for them; the rest is lost parallelism, which is the price of a
     * deterministic gate. A dedicated temp clone was the cheaper-looking alternative, but the save
     * corpus the criterion names is the D17 clone itself, and a proof against a copy would not be
     * the criterion's proof.
     */
    fileParallelism: false,
  },
});
