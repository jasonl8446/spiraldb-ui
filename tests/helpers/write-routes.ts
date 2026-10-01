import { createRequire } from 'node:module';

import type { Express, Router } from 'express';
import request from 'supertest';

/**
 * Every non-GET route the mounted app exposes, as `"<method> <full path>"` (e.g.
 * `post /api/suggestions/:id/reject`), sorted — the enumeration task 7.14's branch-guard suite
 * introduced, shared so the D196 cross-origin arm walks the same list.
 *
 * The routers are recorded as they serve a request: `Router.handle` is wrapped for the duration of
 * one probe per mount prefix (which also builds every lazily-mounted router), then restored. A new
 * write route therefore appears here the day it is mounted. The caller must have set
 * `SPIRALDB_UI_DB` so the lazy mounts open a throwaway database.
 */
const expressCjs = createRequire(import.meta.url)('express') as {
  Router: { handle: (req: unknown, res: unknown, next: unknown) => void };
};

interface LayerLike {
  route?: { path: string; methods: Record<string, boolean | undefined> };
  regexp?: RegExp;
}

export async function enumerateWriteRoutes(app: Express, apiRouter: Router): Promise<string[]> {
  const captured = new Map<string, unknown>();
  const originalHandle = expressCjs.Router.handle;
  expressCjs.Router.handle = function recordingHandle(
    this: unknown,
    req: unknown,
    res: unknown,
    next: unknown,
  ): void {
    const baseUrl = (req as { baseUrl?: unknown }).baseUrl;
    captured.set(typeof baseUrl === 'string' ? baseUrl : '', this);
    return originalHandle.call(this, req, res, next);
  };
  try {
    const prefixes = (apiRouter as unknown as { stack: LayerLike[] }).stack
      .filter((layer) => layer.route === undefined)
      .map((layer) => layer.regexp?.source ?? '')
      .map((source) =>
        source
          .slice(1)
          .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
          .replace(/\\\//g, '/'),
      );
    for (const prefix of [...prefixes, '']) {
      await request(app).get(`/api${prefix}/___guard_probe___`);
    }
  } finally {
    expressCjs.Router.handle = originalHandle;
  }

  const seen = new Set<string>();
  for (const [baseUrl, router] of captured) {
    if (baseUrl !== '/api' && !baseUrl.startsWith('/api/')) {
      continue;
    }
    for (const layer of (router as { stack: LayerLike[] }).stack) {
      if (layer.route === undefined) {
        continue;
      }
      const fullPath = `${baseUrl}${layer.route.path === '/' ? '' : layer.route.path}`;
      for (const [method, enabled] of Object.entries(layer.route.methods)) {
        if (enabled === true && method !== 'get') {
          seen.add(`${method} ${fullPath}`);
        }
      }
    }
  }
  return [...seen].sort();
}
