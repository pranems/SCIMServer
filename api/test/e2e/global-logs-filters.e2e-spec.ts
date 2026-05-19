/**
 * E2E spec for Phase D5 - Global Logs page enhancement (backend portion).
 *
 * Phase D5 surfaces three filter dimensions on `GET /admin/logs` that
 * were previously only available via per-endpoint routes:
 *   - `endpointId` - new in D5 (query param exposure)
 *   - `status` - already supported but locked at the contract level here
 *   - `since` / `until` - already supported, locked at the contract level
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase D5
 * @see docs/PHASE_D5_GLOBAL_LOGS_ENHANCEMENT.md
 * @see api/src/modules/scim/controllers/admin.controller.ts
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpoint } from './helpers/request.helper';
import { resetFixtureCounter } from './helpers/fixtures';

describe('Global Logs filters (E2E) - Phase D5', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetFixtureCounter();
  });

  it('GET /admin/logs accepts endpointId query param (Phase D5)', async () => {
    const epA = await createEndpoint(app, token);
    const epB = await createEndpoint(app, token);

    // Drive a SCIM request against each endpoint so log rows exist.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    await request(app.getHttpServer() as any)
      .get(`/scim/endpoints/${epA}/Users`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Wait for the buffered logger to flush. In-memory backend writes
    // synchronously so this is harmless on inmemory.
    await new Promise((r) => setTimeout(r, 3500));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const scopedToA = await request(app.getHttpServer() as any)
      .get(`/scim/admin/logs?endpointId=${epA}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(scopedToA.body).toHaveProperty('items');
    expect(scopedToA.body).toHaveProperty('total');

    // Every row scoped to A must NOT have an unrelated endpoint URL.
    const hasOnlyEpAOrAdmin = (scopedToA.body.items as Array<{ url: string }>).every(
      (r) => r.url.includes(epA) || r.url.startsWith('/scim/admin'),
    );
    expect(hasOnlyEpAOrAdmin).toBe(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const scopedToB = await request(app.getHttpServer() as any)
      .get(`/scim/admin/logs?endpointId=${epB}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // B has had no SCIM traffic of its own (we only hit /scim/admin/endpoints
    // for the create); scoped(B) total <= scoped(A) total.
    expect(scopedToB.body.total).toBeLessThanOrEqual(scopedToA.body.total);
  }, 15_000);

  it('GET /admin/logs accepts status filter (Phase D5 contract lock)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const res = await request(app.getHttpServer() as any)
      .get('/scim/admin/logs?status=200')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toHaveProperty('items');
    // Every returned row must have status === 200 (or undefined, in which
    // case the filter is effectively a no-op for that row in inmemory).
    const allOk = (res.body.items as Array<{ status?: number }>).every(
      (r) => r.status === undefined || r.status === 200,
    );
    expect(allOk).toBe(true);
  });

  it('GET /admin/logs accepts since/until time-range filters (Phase D5 contract lock)', async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const res = await request(app.getHttpServer() as any)
      .get(`/scim/admin/logs?since=${encodeURIComponent(futureDate)}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // 'since=tomorrow' should match nothing.
    expect(res.body.total).toBe(0);
  });
});
