/**
 * SPA fallback E2E - verifies that deep-link URLs for the TanStack
 * Router-driven SPA paths (e.g. /endpoints, /logs, /settings, and any
 * nested children) all return the same index.html that the root URL
 * does. Without this fallback, hitting Refresh on /endpoints/abc/users
 * yields a NestJS 404 because no controller matches that path.
 *
 * Phase A5 surfaced this gap during Playwright e2e: the in-app sidebar
 * Link click worked (TanStack Router pushState), but a hard reload at
 * the deep URL hit the server, which had no fallback for the new SPA
 * routes. Only `/admin` had the SPA fallback (legacy admin tab UI).
 *
 * The fix in main.ts adds Express middleware for every top-level SPA
 * route so any GET request under those prefixes returns index.html.
 * This file locks in the contract.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';

// Paths the new TanStack Router serves. Every value here MUST resolve
// to index.html on a hard reload so deep links and browser back/forward
// across those URLs continue to work after an app crash recovery.
const SPA_PATHS = [
  '/',
  '/admin',
  '/admin/anything',
  '/endpoints',
  '/endpoints/abc-123',
  '/endpoints/abc-123/users',
  '/endpoints/abc-123/users?page=2',
  '/endpoints/abc-123/groups',
  '/endpoints/abc-123/logs?urlContains=Users',
  '/endpoints/abc-123/settings',
  '/logs',
  '/logs?endpointId=ep-1',
  '/settings',
];

describe('SPA fallback (E2E) - Phase A5', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(SPA_PATHS)('GET %s returns the SPA shell (200, text/html)', async (spaPath) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const res = await request(app.getHttpServer() as any).get(spaPath);
    expect(res.status).toBe(200);
    // Content-type should be HTML, not JSON. A NestJS 404 would be
    // application/json. A successful SPA fallback returns text/html.
    expect(res.headers['content-type']).toMatch(/text\/html/);
    // Whether the middleware found the real index.html or fell back to
    // the placeholder, both bodies start with `<!doctype html` (case
    // insensitive). The placeholder lives inline in spa-fallback.ts and
    // is served when api/dist/../public/index.html is missing (test
    // environments without a vite build). Production always has the real
    // file so this assertion is the same in both modes.
    expect(res.text.toLowerCase()).toMatch(/^<!doctype html/);
    // Acceptance/rejection of empty body - the contract is "any non
    // trivial HTML shell", not "specific markup".
    expect(res.text.length).toBeGreaterThan(50);
  });

  it('GET /scim/admin/version still returns API JSON (not SPA)', async () => {
    // Sanity check that the SPA fallback didn't shadow the API.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const res = await request(app.getHttpServer() as any).get('/scim/admin/version');
    // Either 200 (with token via env) or 401 (auth required) is fine -
    // the assertion is that the response is NOT html.
    expect([200, 401]).toContain(res.status);
    expect(res.headers['content-type']).toMatch(/application\/(scim\+)?json/);
  });

  it('GET /scim/health still returns API JSON (not SPA)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const res = await request(app.getHttpServer() as any).get('/scim/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/(scim\+)?json/);
  });
});
