import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Vite dev server + production build for the client (docs/spec-architecture.md L132-143).
 * `vite root` is this directory, so the dev server serves `client/index.html`
 * and resolves `/src/main.tsx`; when no `--config` cwd is set the config is always
 * loaded by Vite itself, which defines `__dirname` for the bundled config file.
 */
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '..', 'shared'),
    },
  },
  server: {
    // The port a HUMAN gets by default; the Playwright harness overrides it with VITE_PORT so a
    // sibling project holding 5173 cannot stop the tier-1 suite from booting (it did, repeatedly).
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': {
        // The API port **the harness owns** — 3001 is only the human default. `playwright.config.ts`
        // passes `PORT` (the Express bind, `server/src/index.ts`) and `VITE_API_PORT` (this target)
        // as the same value, so a sibling process sitting on 3001 can neither break the harness's
        // own server nor answer its readiness probe: before this pair existed the proxy was pinned to
        // 3001 while the stack under test tried to bind it too, so a foreign listener could satisfy
        // `url: 'http://localhost:5181/api/status/_import'` (architect-verification DR-12, closed by
        // the unattended review; the tier-1 harness-identity rule is D84(c)).
        target: `http://localhost:${process.env.VITE_API_PORT ?? 3001}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
