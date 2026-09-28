import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { codeOf } from '../helpers/source-text';

/**
 * DR-12 — the tier-1 harness owns **both** ports it needs, and nothing it boots can be answered
 * by a process that was already listening.
 *
 * ## The hole this pins shut
 *
 * D83/D84(c) gave the harness its own **client** port (`VITE_PORT=5181`, because a sibling project
 * holding 5173 kept stopping the suite) and recorded that the API half was left behind: the client
 * proxy target was hardcoded to `http://localhost:3001` while the stack under test also tried to
 * bind `3001`. So a process already listening there could either
 *
 * - kill the harness's own Express (`EADDRINUSE`, the dev script's server half dies), or
 * - worse, because it is silent: answer `url: 'http://localhost:5181/api/status/_import'` — the
 *   readiness probe that D44 relies on as the *identity assertion* ("never probes whatever happens
 *   to be listening on a port, it waits for *this* app's API route") — and let the run measure a
 *   stack whose API was never ours.
 *
 * The architect's verification filed this as **DR-12** ("pass `PORT` alongside `VITE_PORT` through
 * the config"), and the unattended review closed it: `playwright.config.ts` now sets
 * `PORT=3181 VITE_API_PORT=3181`, `client/vite.config.ts` proxies to `VITE_API_PORT`, and
 * `tests/ui/p4-10-altport.config.ts` (the opt-in spare-port rig) carries the same pair rather than
 * keeping the hole in the file that exists precisely because a sibling held a port.
 *
 * ## What is asserted here, and what is not
 *
 * This is a **wiring** pin: it reads the three configs as text and checks that the two variables
 * exist, agree, and are not the human default — plus that `server/src/index.ts` still reads
 * `process.env.PORT`, so the pair cannot become decorative. It cannot observe a socket.
 *
 * The **behavioural** proof is the decoy run recorded in the review artifact
 * (`docs/evidence/review-unattended.md`, WQ4): an HTTP server was parked on `3001` answering 200 to
 * everything, and `npm run test:ui` was run with it in place. Before the pair existed the decoy
 * answered the readiness probe (the harness's own Express never bound); after it, the decoy received
 * **zero** requests while the suite ran green against `3181`.
 */

/** A file's UTF-8 text, addressed from this test file. */
function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

/** The value of `NAME=…` in a shell command string (a bare `export`-less env assignment). */
function envValue(command: string, name: string): string | undefined {
  return new RegExp(`(?:^|\\s)${name}=([^\\s'"]+)`).exec(command)?.[1];
}

/** The `command: '…'` string of a Playwright config (the webServer's shell command). */
function webServerCommand(src: string): string {
  const command = /command:\s*'([^']+)'/.exec(src)?.[1];
  expect(command, 'the webServer command in the config').toBeDefined();
  return command ?? '';
}

/** The port of a Playwright `url: 'http://localhost:PORT/…'` readiness probe. */
function urlPort(src: string): string | undefined {
  return /url:\s*'https?:\/\/[^/]*:(\d+)\//.exec(src)?.[1];
}

const VITE_CONFIG = codeOf(read('../../client/vite.config.ts'));
const INDEX_SRC = codeOf(read('../../server/src/index.ts'));
const PLAYWRIGHT_CONFIG = read('../../playwright.config.ts');
const ALTPORT_CONFIG = read('../../tests/ui/p4-10-altport.config.ts');

describe('DR-12 — the API port is the harness own, not the human default', () => {
  it('proxies /api to VITE_API_PORT, keeping 3001 only as the human default', () => {
    expect(
      VITE_CONFIG,
      'the /api proxy target must be derived from VITE_API_PORT with the 3001 human default',
    ).toMatch(/target:\s*`http:\/\/localhost:\$\{process\.env\.VITE_API_PORT \?\? 3001\}`/);
    // Fail closed on a regression to the pinned literal this fix removed.
    expect(VITE_CONFIG, 'a hardcoded proxy target re-appeared').not.toMatch(
      /'http:\/\/localhost:3001'/,
    );
  });

  it('still binds process.env.PORT in the entrypoint, so the pair cannot go decorative', () => {
    expect(INDEX_SRC, 'the Express bind must read PORT').toMatch(
      /const PORT = Number\(process\.env\.PORT \?\? 3001\)/,
    );
  });

  it('sets PORT and VITE_API_PORT to one identical, non-default value in the official config', () => {
    const command = webServerCommand(PLAYWRIGHT_CONFIG);
    const port = envValue(command, 'PORT');
    const apiPort = envValue(command, 'VITE_API_PORT');

    expect(port, 'PORT=… in the webServer command').toBeDefined();
    expect(
      apiPort,
      'VITE_API_PORT=… in the webServer command (a missing one leaves the proxy on 3001)',
    ).toBeDefined();
    expect(apiPort, 'the bind and the proxy target must be the same port').toBe(port);
    expect(port, 'the harness must not use the human default 3001').not.toBe('3001');
  });

  it('keeps the readiness probe on the client port the same command passes', () => {
    const command = webServerCommand(PLAYWRIGHT_CONFIG);
    const clientPort = envValue(command, 'VITE_PORT');
    expect(clientPort, 'VITE_PORT=… in the webServer command').toBeDefined();
    expect(urlPort(PLAYWRIGHT_CONFIG), 'the readiness url port').toBe(clientPort);
    expect(
      envValue(command, 'PORT'),
      'client and API ports must differ, or strictPort would make the stack fight itself',
    ).not.toBe(clientPort);
  });

  it('carries the same PORT/VITE_API_PORT agreement in the opt-in spare-port rig', () => {
    const command = webServerCommand(ALTPORT_CONFIG);
    const port = envValue(command, 'PORT');
    const apiPort = envValue(command, 'VITE_API_PORT');
    expect(port, 'PORT=… in tests/ui/p4-10-altport.config.ts').toBeDefined();
    expect(
      apiPort,
      'VITE_API_PORT=… in tests/ui/p4-10-altport.config.ts (the file that exists because a port was held)',
    ).toBe(port);
    // This rig overrides the client port with Vite's own CLI flag rather than VITE_PORT, so its
    // readiness url is pinned to that flag's value (the same number the official config gets
    // through the environment).
    const flagPort = /--port\s+(\d+)/.exec(command)?.[1];
    expect(flagPort, '--port in the altport command').toBeDefined();
    expect(urlPort(ALTPORT_CONFIG), 'its readiness url port').toBe(flagPort);
  });
});
