import crypto from 'node:crypto';
import fs from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { Router, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';

import { resolveRepoRoot } from '../db.js';
import type { ApiError } from '../../../shared/index.js';
import {
  createExtractionService,
  ExtractionCancelledError,
  ExtractionError,
  type ExecFileWithChild,
  type ExtractionService,
} from '../services/extraction.js';

/**
 * Extraction API — `POST /api/extract/quests` (task 2.3, story p2-04,
 * docs/spec-api.md L208-231).
 *
 * Contract: `multipart/form-data` with a single field **`file`**, a `.json`
 * packet capture, ≤ 512 MB (decision D2 — multer **disk** storage), answered with
 * exactly `{ quests: [...], count: N }`. The extraction is a blocking subprocess
 * (no job queue, no polling): the response is sent when the CLI is done, and the
 * UI shows an indeterminate spinner meanwhile.
 *
 * Three decisions the spec/plan leave open, all reported to the lead:
 *
 *  - **Upload directory** — `<repo root>/data/uploads/` (under the gitignored
 *    `data/`), injectable so tests use a throwaway dir. The directory is created
 *    *at upload time*, never when this module is imported: multer's `diskStorage`
 *    `mkdirp`s a string destination synchronously in its constructor, which would
 *    make importing `app.ts` touch disk. Passing `destination` as a callback
 *    removes that side effect (and leaves dir creation to us, as multer documents).
 *  - **Error status codes** — the spec shows only the body. 400 for a capture the
 *    CLI could not parse or an unsupported extension, 413 for an upload over the
 *    cap, 500 for a CLI that is not built.
 *  - **Uploaded-file lifetime** — the temp capture is deleted once the request
 *    settles (success or failure). Keeping 512 MB uploads forever in `data/uploads/`
 *    would grow without bound, and nothing in the spec reads them again.
 *
 * Cancellation is decision D9: the run's child registry is killed when the client
 * disconnects. The abort signal is **`res.on('close')`**, not `req.on('close')` —
 * measured on Node 24: `IncomingMessage` emits `close` when the request *body*
 * ends (which multer has already consumed by the time the handler runs), so a
 * later listener never fires and a mid-extraction abort would go unnoticed. The
 * response's `close` fires both on completion and on a prematurely terminated
 * connection, so the handler only treats it as an abort while the response is
 * unfinished (`res.writableEnded` / `res.finished`) — measured: on a normal
 * response that event arrives with `writableEnded === true`.
 */

/** The multipart field name (docs/spec-api.md L212). */
export const UPLOAD_FIELD = 'file';

/** The plan's cap (D2): 512 MB. */
export const UPLOAD_MAX_BYTES = 512 * 1024 * 1024;

/** Upload destination relative to the project root (gitignored via `data/`). */
export const UPLOAD_DIR_RELATIVE = path.join('data', 'uploads');

/** Only `.json` captures are accepted (docs/spec-domain-reference.md L624). */
export const ALLOWED_UPLOAD_EXTENSION = '.json';

/** The upload-zone wording the domain reference mandates (L625). */
export const UPLOAD_FORMAT_HINT = 'Supported format: JSON packet capture files (.json)';

/** Rejection raised by the multer `fileFilter` — carries the HTTP status. */
export class UploadRejectionError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'UploadRejectionError';
  }
}

/** Default upload dir — resolved lazily so importing this module never touches disk. */
export function defaultUploadDir(): string {
  return path.join(resolveRepoRoot(), UPLOAD_DIR_RELATIVE);
}

export interface ExtractRouterOptions {
  /** Injected extraction service (tests pass a fake `exec`). */
  service?: ExtractionService;
  /** CLI path handed to the default service. */
  cliPath?: string;
  /** Injected process runner handed to the default service. */
  exec?: ExecFileWithChild;
  /** Base child environment handed to the default service. */
  env?: NodeJS.ProcessEnv;
  /** stdout cap handed to the default service (tests force the overflow path). */
  maxBufferBytes?: number;
  /** Upload destination; defaults to `<repo root>/data/uploads`. */
  uploadDir?: string;
  /** Upload cap; defaults to 512 MB (tests pin a tiny value). */
  maxUploadBytes?: number;
  /** Injected post-request cleanup of the temp capture; default deletes it. */
  cleanupUpload?: (filePath: string) => Promise<void>;
}

/** HTTP status for a thrown value — multer codes first, then our own errors. */
function statusOf(error: unknown): number {
  if (error instanceof UploadRejectionError || error instanceof ExtractionError) {
    return error.status;
  }
  if (error instanceof multer.MulterError) {
    // 413 is the status the web platform uses for an over-limit body.
    return error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  }
  if (error instanceof ExtractionCancelledError) {
    // Never actually sent: an aborted request has no one to answer. 499 is the
    // conventional "client closed request" code (nginx) if it ever leaks.
    return 499;
  }
  if (typeof error === 'object' && error !== null) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number') {
      return status;
    }
  }
  return 500;
}

/** Human message for a thrown value; multer errors get the actionable rewording. */
function messageOf(error: unknown, maxUploadBytes: number): string {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      const mb = Math.round(maxUploadBytes / (1024 * 1024));
      return `Packet capture is larger than the ${mb} MB upload limit`;
    }
    return `Upload rejected: ${error.message}`;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return error ? String(error) : 'Extraction failed';
}

export function createExtractRouter(options: ExtractRouterOptions = {}): Router {
  const maxUploadBytes = options.maxUploadBytes ?? UPLOAD_MAX_BYTES;

  // The service and the upload dir are both resolved lazily: importing this
  // module (and therefore `app.ts`) must remain free of filesystem side effects.
  let service = options.service;
  const getService = (): ExtractionService =>
    (service ??= createExtractionService({
      cliPath: options.cliPath,
      exec: options.exec,
      env: options.env,
      maxBufferBytes: options.maxBufferBytes,
    }));

  let resolvedUploadDir = options.uploadDir;
  const getUploadDir = (): string => (resolvedUploadDir ??= defaultUploadDir());

  const cleanupUpload =
    options.cleanupUpload ?? ((filePath: string) => rm(filePath, { force: true }));

  const storage = multer.diskStorage({
    // A callback (not a string) destination — see the header comment on why.
    destination: (_req, _file, cb) => {
      const dir = getUploadDir();
      try {
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (error) {
        cb(error as Error, dir);
      }
    },
    // The CLI only needs a path; a random name avoids clobbering concurrent uploads.
    filename: (_req, _file, cb) => {
      cb(null, `${crypto.randomUUID()}${ALLOWED_UPLOAD_EXTENSION}`);
    },
  });

  const upload = multer({
    storage,
    limits: { fileSize: maxUploadBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      const extension = path.extname(file.originalname).toLowerCase();
      if (extension !== ALLOWED_UPLOAD_EXTENSION) {
        cb(
          new UploadRejectionError(
            `Unsupported file type "${extension || file.originalname}" — only .json packet ` +
              `captures are accepted. ${UPLOAD_FORMAT_HINT}`,
          ),
        );
        return;
      }
      cb(null, true);
    },
  }).single(UPLOAD_FIELD);

  /** Multer errors must become the JSON envelope here, not the 500 middleware. */
  const receiveUpload: RequestHandler = (req, res, next) => {
    upload(req, res, (error: unknown) => {
      if (!error) {
        next();
        return;
      }
      res
        .status(statusOf(error))
        .json({ error: messageOf(error, maxUploadBytes) } satisfies ApiError);
    });
  };

  const router = Router();

  router.post('/quests', receiveUpload, async (req: Request, res: Response) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({
        error: `No file uploaded — attach a .json packet capture in the "${UPLOAD_FIELD}" field`,
      } satisfies ApiError);
      return;
    }

    // Arm the D9 abort path *before* awaiting: `start()` spawns the CLI
    // synchronously, and the registry kills a child that arrives after the abort.
    const run = getService().start(file.path);
    let aborted = false;
    const onClose = (): void => {
      // A normally-completed response also emits `close` (header comment): only an
      // unfinished response means the client went away.
      if (res.writableEnded || res.finished) {
        return;
      }
      aborted = true;
      run.children.killAll();
    };
    res.on('close', onClose);

    try {
      const quests = await run.result;
      if (!aborted) {
        res.json({ quests, count: quests.length });
      }
    } catch (error) {
      if (aborted || error instanceof ExtractionCancelledError) {
        // The client is gone; there is nothing to answer (and no socket to write to).
        return;
      }
      if (!res.headersSent) {
        res
          .status(statusOf(error))
          .json({ error: messageOf(error, maxUploadBytes) } satisfies ApiError);
      }
    } finally {
      res.off('close', onClose);
      await cleanupUpload(file.path).catch((cleanupError: unknown) => {
        process.emitWarning(
          `[extract] could not remove the uploaded capture ${file.path}: ${
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          }`,
        );
      });
    }
  });

  return router;
}
