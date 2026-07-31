/**
 * E2E contract lock: `GET /scim/admin/logs/:id` with a malformed id.
 *
 * Origin: 2026-07-30. `GET /scim/admin/logs/stream` returned HTTP 500 on every
 * Prisma estate. There is no `logs/stream` route, so the request fell through
 * to `@Get('logs/:id')`; `RequestLog.id` is `@db.Uuid`, so Prisma raised P2023
 * and it escaped as an unhandled 500 carrying "Internal server error".
 *
 * This spec asserts the OUTCOME (status code and SCIM error envelope) rather
 * than the presence of a route, and it is meaningful on BOTH backends:
 *   - inmemory: was already 404, so this pins the behaviour against regression
 *   - prisma  : was 500, so this is the regression test for the fix
 *
 * Run under both via `pwsh scripts/test-all-modes.ps1` (Stage 2.6).
 *
 * @see api/src/modules/logging/logging.service.ts getLog
 * @see api/src/modules/logging/logging-get-log-nonuuid.spec.ts
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';

/** Ids Postgres cannot cast to `uuid`. `stream` is the reported symptom. */
const MALFORMED_IDS = ['stream', 'not-a-uuid', '12345', 'undefined', 'null'];

const ABSENT_BUT_VALID_UUID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('GET /scim/admin/logs/:id - malformed id (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(MALFORMED_IDS)('returns 404, never 500, for the malformed id %p', async (id) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const res = await request(app.getHttpServer() as any)
      .get(`/scim/admin/logs/${encodeURIComponent(id)}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    // The status assertion alone would pass on a 404 produced for the wrong
    // reason, so pin the envelope too.
    expect(res.body).toHaveProperty('status', '404');
    expect(res.body).toHaveProperty('detail', 'Log not found');
  });

  it('returns 404 for a syntactically valid but absent uuid (same shape)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const res = await request(app.getHttpServer() as any)
      .get(`/scim/admin/logs/${ABSENT_BUT_VALID_UUID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('detail', 'Log not found');
  });

  it('never leaks a persistence-layer error string to the client', async () => {
    for (const id of MALFORMED_IDS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      const res = await request(app.getHttpServer() as any)
        .get(`/scim/admin/logs/${encodeURIComponent(id)}`)
        .set('Authorization', `Bearer ${token}`);

      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/Prisma/i);
      expect(body).not.toMatch(/P2023/);
      expect(body).not.toMatch(/Inconsistent column data/i);
      expect(body).not.toMatch(/Internal server error/i);
    }
  });

  it('still authenticates: a malformed id without a token is 401, not 404', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const res = await request(app.getHttpServer() as any).get('/scim/admin/logs/stream');
    expect(res.status).toBe(401);
  });
});
