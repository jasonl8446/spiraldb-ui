import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app } from '@server/app';

/**
 * Task 1.1 acceptance: the Express bootstrap answers with the `{ "error": ... }`
 * envelope (docs/spec-api.md L227) instead of the SPA HTML for unknown routes,
 * and the error middleware preserves the error status.
 */
describe('Express bootstrap', () => {
  it('answers an unknown /api route with exactly {"error":"Not found"} as JSON', async () => {
    const res = await request(app).get('/api/definitely-not-a-route');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.text).toBe('{"error":"Not found"}');
    expect(res.body).toEqual({ error: 'Not found' });
    expect(res.text).not.toMatch(/<html/i);
  });

  it('answers an unknown non-api route with JSON, not HTML', async () => {
    const res = await request(app).get('/definitely-not-a-route');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(res.text).not.toMatch(/<html/i);
  });

  it('serves the liveness probe', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('routes thrown errors through the middleware as { error: message }', async () => {
    const res = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"malformed": ');

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.text).not.toMatch(/<html/i);
  });
});
