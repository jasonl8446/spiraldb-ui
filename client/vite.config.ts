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
    port: 5173,
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
