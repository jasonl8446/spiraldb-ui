/**
 * Types and constants shared by the Express server and the Vite client.
 *
 * Imported by the server through a relative path (`shared/index.js` in TypeScript
 * sources, resolved by tsc's NodeNext emit) and by the client through the
 * `@shared/*` path alias configured in `client/tsconfig.json` + `client/vite.config.ts`.
 */

/** Display name of the tool. */
export const APP_NAME = 'SpiralDB UI';

/**
 * Envelope every non-2xx JSON response uses (docs/spec-api.md L227).
 * Error middleware and the JSON 404 handler both emit this shape.
 */
export interface ApiError {
  error: string;
}

/** Body of the JSON 404 envelope for an unknown route. */
export const NOT_FOUND_MESSAGE = 'Not found';
