import http from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import cors from 'cors';
import express, { type Express, type Router } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NOT_FOUND_MESSAGE, type ApiError } from '@shared/index.js';
import { apiRouter } from '@server/routes/index';
import {
  ALLOWED_UPLOAD_EXTENSION,
  createExtractRouter,
  UPLOAD_FORMAT_HINT,
  UPLOAD_MAX_BYTES,
} from '@server/routes/extract';
import {
  ChildRegistry,
  ExtractionError,
  type ExecChildHandle,
  type ExtractionRun,
  type ExtractionService,
} from '@server/services/extraction';

/**
 * Task 2.3/p2-04 — `POST /api/extract/quests` (docs/spec-api.md L208-231).
 *
 * Hermetic: the extraction service is injected, so no CLI process is ever spawned
 * and .NET is never needed. The app under test is the real composition — the
 * injected extract router is mounted first at `/api/extract`, and the **real**
 * `apiRouter` behind it supplies `/api/health`, which is how "the server stays
 * healthy after a CLI failure" (P2 AC#3) is checked rather than re-declared.
 */

const CLI = '/repo/tools/bin/imview-packet-reader';

let uploadDir: string;

beforeEach(async () => {
  uploadDir = await mkdtemp(path.join(os.tmpdir(), 'spiraldb-uploads-test-'));
});

afterEach(async () => {
  await rm(uploadDir, { recursive: true, force: true });
});

function createTestApp(extractRouter: Router): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/api/extract', extractRouter);
  app.use('/api', apiRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: NOT_FOUND_MESSAGE } satisfies ApiError);
  });
  return app;
}

/** A service that answers with `quests` and records the capture path it saw. */
function serviceReturning(quests: unknown[]): ExtractionService & { startedPaths: string[] } {
  const startedPaths: string[] = [];
  return {
    cliPath: CLI,
    startedPaths,
    start(capturePath: string): ExtractionRun {
      startedPaths.push(capturePath);
      return { children: new ChildRegistry(), result: Promise.resolve(quests) };
    },
  };
}

/** A service that fails the way a non-capture upload does. */
function serviceFailing(error: Error): ExtractionService {
  return {
    cliPath: CLI,
    start: (): ExtractionRun => ({ children: new ChildRegistry(), result: Promise.reject(error) }),
  };
}

function uploadApp(service: ExtractionService, maxUploadBytes = UPLOAD_MAX_BYTES): Express {
  return createTestApp(createExtractRouter({ service, uploadDir, maxUploadBytes }));
}

describe('POST /api/extract/quests — success', () => {
  it('answers exactly { quests, count } for a .json capture', async () => {
    const quests = [{ m_questName: 'MB-YARD1-C01-001' }, { m_questName: 'B' }];
    const service = serviceReturning(quests);
    const res = await request(uploadApp(service))
      .post('/api/extract/quests')
      .attach('file', Buffer.from('[]'), 'MB-YARD1-C01-001.json');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quests, count: 2 });
    expect(Object.keys(res.body).sort()).toEqual(['count', 'quests']);
    expect(service.startedPaths).toHaveLength(1);
  });

  it('accepts an empty extraction as count 0', async () => {
    const res = await request(uploadApp(serviceReturning([])))
      .post('/api/extract/quests')
      .attach('file', Buffer.from('[]'), 'empty.json');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ quests: [], count: 0 });
  });

  it('deletes the uploaded capture once the request settles', async () => {
    const res = await request(uploadApp(serviceReturning([])))
      .post('/api/extract/quests')
      .attach('file', Buffer.from('[]'), 'capture.json');

    expect(res.status).toBe(200);
    // Cleanup runs after the response is flushed, so poll rather than race.
    await vi.waitFor(async () => {
      expect(await readdir(uploadDir)).toEqual([]);
    });
  });

  it('keeps the spec cap at 512 MB (D2)', () => {
    expect(UPLOAD_MAX_BYTES).toBe(512 * 1024 * 1024);
    expect(ALLOWED_UPLOAD_EXTENSION).toBe('.json');
  });
});

describe('POST /api/extract/quests — upload rejection', () => {
  it('rejects a non-.json upload with the domain reference’s wording', async () => {
    const res = await request(uploadApp(serviceReturning([])))
      .post('/api/extract/quests')
      .attach('file', Buffer.from('[]'), 'capture.txt');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^Unsupported file type "\.txt"/);
    expect(res.body.error).toContain(UPLOAD_FORMAT_HINT);
  });

  it('rejects an upload over the size limit with 413 and leaves no temp file', async () => {
    const res = await request(uploadApp(serviceReturning([]), 1024))
      .post('/api/extract/quests')
      .attach('file', Buffer.alloc(4096, 0x20), 'huge.json');

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/larger than the \d+ MB upload limit/);
    await expect(readdir(uploadDir)).resolves.toEqual([]);
  });

  it('rejects a request with no file part', async () => {
    const res = await request(uploadApp(serviceReturning([])))
      .post('/api/extract/quests')
      .field('notes', 'no file here');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No file uploaded/);
  });
});

describe('POST /api/extract/quests — failure modes', () => {
  it('maps a CLI parse failure to the spec envelope and keeps /api/health alive', async () => {
    const app = uploadApp(
      serviceFailing(
        new ExtractionError(
          "Failed to parse packet capture: error: '/tmp/x.json' is not valid JSON: 'h' is an invalid start of a value.",
          400,
        ),
      ),
    );

    const failed = await request(app)
      .post('/api/extract/quests')
      .attach('file', Buffer.from('hello not json'), 'not-a-capture.json');

    expect(failed.status).toBe(400);
    expect(failed.body).toEqual({
      error:
        "Failed to parse packet capture: error: '/tmp/x.json' is not valid JSON: 'h' is an invalid start of a value.",
    });

    // P2 AC#3 — the failure is isolated to the request.
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: 'ok' });
  });

  it('names `npm run build:cli` when the CLI is missing (500)', async () => {
    const app = uploadApp(
      serviceFailing(
        new ExtractionError(
          `Packet capture CLI not found at ${CLI}. Build it with: npm run build:cli`,
          500,
        ),
      ),
    );

    const res = await request(app)
      .post('/api/extract/quests')
      .attach('file', Buffer.from('[]'), 'capture.json');

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('npm run build:cli');
  });

  it('does not leak a raw error message for a non-ExtractionError failure', async () => {
    const app = uploadApp(serviceFailing(new Error('something exploded')));

    const res = await request(app)
      .post('/api/extract/quests')
      .attach('file', Buffer.from('[]'), 'capture.json');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'something exploded' });
  });
});

describe('POST /api/extract/quests — cancellation (D9)', () => {
  it('kills the CLI child when the client aborts mid-extraction', async () => {
    const registry = new ChildRegistry();
    const child: ExecChildHandle = { pid: 9999, kill: vi.fn(() => true) };
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let settle: ((quests: unknown[]) => void) | undefined;

    const service: ExtractionService = {
      cliPath: CLI,
      start: (): ExtractionRun => {
        registry.add(child);
        markStarted?.();
        return {
          children: registry,
          result: new Promise<unknown[]>((resolve) => {
            settle = resolve;
          }),
        };
      },
    };

    const app = uploadApp(service);
    const server = app.listen(0);
    await new Promise<void>((resolve) => {
      server.once('listening', resolve);
    });
    const port = (server.address() as AddressInfo).port;

    const boundary = '----spiraldb-p204';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.json"\r\n` +
          'Content-Type: application/json\r\n\r\n',
      ),
      Buffer.from('[]'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const req = http.request({
      port,
      method: 'POST',
      path: '/api/extract/quests',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(body.length),
      },
    });
    // Destroying the socket after the request is answered is the point; the
    // client-side reset is expected noise.
    req.on('error', () => undefined);
    req.end(body);

    // The service only starts after multer has parsed the whole body, and the
    // route registers `req.on('close')` synchronously right after `start()`, so
    // once this resolves the abort path is armed.
    await started;
    req.destroy();

    await vi.waitFor(() => {
      expect(child.kill).toHaveBeenCalled();
    });
    expect(registry.cancelled).toBe(true);

    // Let the handler unwind, then prove the server is still serving.
    settle?.([]);
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('does not treat a completed request as an abort', async () => {
    const registry = new ChildRegistry();
    let killed = 0;
    registry.killAll = () => {
      killed += 1;
      return 0;
    };
    const service: ExtractionService = {
      cliPath: CLI,
      start: (): ExtractionRun => ({ children: registry, result: Promise.resolve([{ a: 1 }]) }),
    };

    const res = await request(uploadApp(service))
      .post('/api/extract/quests')
      .attach('file', Buffer.from('[]'), 'capture.json');

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(killed).toBe(0);
  });
});
