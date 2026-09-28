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
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
