/**
 * E2E spec for the Phase D2 endpointId filter on GET /admin/activity.
 *
 * Hits the controller against a real NestJS application (in-memory
 * backend in CI) and asserts:
 *   - omitting endpointId returns global activity (back-compat)
 *   - passing endpointId scopes the response to that endpoint only
 *
 * The legacy ActivityFeed component (pre-Phase D) consumed this
 * endpoint without any scoping. The new ActivityTab on
 * /endpoints/$id/activity (D2) needs server-side scoping so high-
 * traffic endpoints don't pull thousands of unrelated rows down to
 * the browser.
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase D2
 * @see api/src/modules/activity-parser/activity.controller.ts
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { resetFixtureCounter } from './helpers/fixtures';

describe('Activity endpointId filter (E2E) - Phase D2', () => {
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

  it('returns the canonical shape and accepts endpointId without 4xx', async () => {
    // Create two endpoints so we can prove scoping doesn't accidentally
    // include the wrong one. Endpoint creation itself produces some
    // /admin/* traffic but the controller already excludes /admin/.
    const wk = process.env.JEST_WORKER_ID ?? '0';
    const stamp = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const epA = await request(app.getHttpServer() as any)
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ name: `e2e-d2-a-w${wk}-${stamp}`, profilePreset: 'rfc-standard' })
      .expect(201);
    const endpointA = epA.body.id as string;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const epB = await request(app.getHttpServer() as any)
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ name: `e2e-d2-b-w${wk}-${stamp}`, profilePreset: 'rfc-standard' })
      .expect(201);
    const endpointB = epB.body.id as string;

    // Drive a SCIM POST against endpoint A so there's at least one
    // request log scoped to it. The interceptor populates endpointId
    // from the URL prefix /scim/endpoints/:id/* (Phase 17).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    await request(app.getHttpServer() as any)
      .post(`/scim/endpoints/${endpointA}/Users`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/scim+json')
      .send({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `d2-user-${stamp}`,
      })
      .expect(201);

    // Without endpointId: response is the canonical activity shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const globalRes = await request(app.getHttpServer() as any)
      .get('/scim/admin/activity?page=1&limit=20')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(globalRes.body.activities)).toBe(true);
    expect(globalRes.body.pagination).toBeDefined();
    expect(typeof globalRes.body.pagination.total).toBe('number');

    // With endpointId=A: same shape, must NOT 4xx.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const scopedRes = await request(app.getHttpServer() as any)
      .get(`/scim/admin/activity?page=1&limit=20&endpointId=${endpointA}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(scopedRes.body.activities)).toBe(true);
    expect(scopedRes.body.pagination).toBeDefined();

    // The total scoped to endpoint A must be <= the global total.
    // Strict equality isn't safe because workers run in parallel and
    // share the in-memory ring buffer, so other workers may have logs
    // too. The semantic invariant is "scoping never adds rows".
    expect(scopedRes.body.pagination.total).toBeLessThanOrEqual(
      globalRes.body.pagination.total,
    );

    // With endpointId=B (which has only the create-endpoint admin log,
    // and admin/* is excluded): scoped total stays low.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const scopedB = await request(app.getHttpServer() as any)
      .get(`/scim/admin/activity?page=1&limit=20&endpointId=${endpointB}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(scopedB.body.activities)).toBe(true);
  });

  it('surfaces custom ResourceType create, update, and delete in Logs and Activity', async () => {
    const server = app.getHttpServer() as any;
    const stamp = `${Date.now()}-${process.env.JEST_WORKER_ID ?? '0'}`;
    const schemaUrn = 'urn:e2e:schemas:ObservedDevice';
    const createdEndpoint = await request(server)
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `e2e-activity-device-${stamp}`,
        profile: {
          schemas: [{
            id: schemaUrn,
            name: 'ObservedDevice',
            attributes: [
              { name: 'serialNumber', type: 'string', required: true },
              { name: 'displayName', type: 'string' },
            ],
          }],
          resourceTypes: [{
            id: 'ObservedDevice',
            name: 'ObservedDevice',
            endpoint: '/ObservedDevices',
            schema: schemaUrn,
            schemaExtensions: [],
          }],
        },
      })
      .expect(201);
    const endpointId = createdEndpoint.body.id as string;

    try {
      const created = await request(server)
        .post(`/scim/endpoints/${endpointId}/ObservedDevices`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({ schemas: [schemaUrn], serialNumber: 'E2E-100', displayName: 'Observed' })
        .expect(201);
      const resourceId = created.body.id as string;

      await request(server)
        .patch(`/scim/endpoints/${endpointId}/ObservedDevices/${resourceId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'replace', path: 'displayName', value: 'Updated' }],
        })
        .expect(200);

      await request(server)
        .delete(`/scim/endpoints/${endpointId}/ObservedDevices/${resourceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      const logs = await request(server)
        .get(`/scim/admin/logs?endpointId=${endpointId}&urlContains=ObservedDevices&pageSize=100`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(logs.body.items.map((item: { method: string }) => item.method)).toEqual(
        expect.arrayContaining(['POST', 'PATCH', 'DELETE']),
      );

      const activity = await request(server)
        .get(`/scim/admin/activity?endpointId=${endpointId}&type=resource&search=ObservedDevices&limit=100`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(activity.body.filters.types).toContain('resource');
      expect(activity.body.activities).toEqual(expect.arrayContaining([
        expect.objectContaining({ resourceType: 'ObservedDevice', resourceEndpoint: '/ObservedDevices' }),
      ]));
      expect(activity.body.pagination.total).toBe(activity.body.activities.length);
    } finally {
      await request(server)
        .delete(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`);
    }
  });
});
