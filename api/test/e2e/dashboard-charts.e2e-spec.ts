/**
 * E2E spec for Phase D4 - Dashboard charts.
 *
 * Hits GET /admin/dashboard against a real NestJS application
 * (in-memory backend in CI, Prisma locally) and asserts:
 *   - response shape lock includes `requestsLast24hSeries`
 *   - the series is exactly 24 numbers
 *   - oldest first / current hour last bucket placement is observable
 *     after a known SCIM request, including an hour rollover
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase D4
 * @see docs/PHASE_D4_DASHBOARD_CHARTS.md
 * @see api/src/modules/dashboard/dashboard.controller.ts
 * @see api/src/modules/logging/logging.service.ts (getRequestSeries)
 */
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpoint } from './helpers/request.helper';
import { resetFixtureCounter } from './helpers/fixtures';
import type { DashboardResponse } from '../../src/shared/types/dashboard.types';

describe('Dashboard charts (E2E) - Phase D4', () => {
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

  afterEach(() => {
    jest.useRealTimers();
  });

  it('includes requestsLast24hSeries in the dashboard response shape', async () => {
    const res = await request(app.getHttpServer() as Server)
      .get('/scim/admin/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as DashboardResponse;
    // Top-level shape allowlist - adds the D4 key.
    expect(Object.keys(body).sort()).toEqual(
      [
        'endpoints',
        'health',
        'recentActivity',
        'requestsLast24hSeries',
        'stats',
        'version',
      ].sort(),
    );

    expect(Array.isArray(body.requestsLast24hSeries)).toBe(true);
    expect(body.requestsLast24hSeries).toHaveLength(24);
    expect(
      body.requestsLast24hSeries.every((n) => typeof n === 'number'),
    ).toBe(true);
  });

  it.each([false, true])('counts a SCIM call after flush (hour rollover=%s)', async (rollover) => {
    const hourMs = 3_600_000;
    const baseHour = Math.floor(Date.now() / hourMs) * hourMs - hourMs;
    jest.useFakeTimers({
      now: baseHour + hourMs - 60_000,
      doNotFake: [
        'hrtime', 'nextTick', 'performance', 'queueMicrotask',
        'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval',
        'setTimeout', 'clearTimeout',
      ],
    });
    const endpointId = await createEndpoint(app, token, `dashboard-${randomUUID()}`);
    await request(app.getHttpServer() as Server)
      .get(`/scim/endpoints/${endpointId}/Users`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await new Promise((resolve) => setTimeout(resolve, 3500));

    // Baseline read.
    const baseline = await request(app.getHttpServer() as Server)
      .get('/scim/admin/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const baseSeries = (baseline.body as DashboardResponse).requestsLast24hSeries;
    const baseCurrent = baseSeries[baseSeries.length - 1];
    expect(baseCurrent).toBeGreaterThanOrEqual(1);

    // Make a SCIM call against a fresh endpoint - this is the only kind of
    // request the series counts (admin/health/keepalive are excluded).
    await request(app.getHttpServer() as Server)
      .get(`/scim/endpoints/${endpointId}/Users`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // The Prisma-backed logger buffers writes in 3s windows for connection
    // pool relief. Wait a hair longer than the flush interval. (In-memory
    // backend writes synchronously, so this is harmless.)
    await new Promise((r) => setTimeout(r, 3500));
    // Expire the real dashboard's 30-second cache without mocking its data.
    jest.setSystemTime(baseHour + hourMs + (rollover ? 1000 : -29_000));

    const after = await request(app.getHttpServer() as Server)
      .get('/scim/admin/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const afterSeries = (after.body as DashboardResponse).requestsLast24hSeries;
    expect(afterSeries).toHaveLength(24);
    // Compare the same UTC hours. Rollover drops the oldest bucket and
    // moves the request's hour from index 23 to 22.
    const shift = rollover ? 1 : 0;
    for (let index = shift; index < baseSeries.length; index++) {
      expect(afterSeries[index - shift]).toBeGreaterThanOrEqual(baseSeries[index]);
    }
    expect(afterSeries[23 - shift]).toBeGreaterThanOrEqual(baseCurrent + 1);
  }, 15_000);

  it('serves a stable series shape after admin traffic', async () => {
    // Hit /admin/dashboard a few times. The exact /scim/admin/* exclusion
    // predicate is unit-locked in logging-request-series.spec.ts. At E2E
    // scope the series is global, so parallel SCIM tests can legitimately
    // change the current-hour bucket while this spec is running.
    const before = await request(app.getHttpServer() as Server)
      .get('/scim/admin/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((before.body as DashboardResponse).requestsLast24hSeries).toHaveLength(24);

    // 3 admin calls.
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer() as Server)
        .get('/scim/admin/version')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }
    await new Promise((r) => setTimeout(r, 100));

    const after = await request(app.getHttpServer() as Server)
      .get('/scim/admin/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const afterSeries = (after.body as DashboardResponse).requestsLast24hSeries;
    expect(afterSeries).toHaveLength(24);
    expect(
      afterSeries.every((n) => typeof n === 'number'),
    ).toBe(true);
  });
});
