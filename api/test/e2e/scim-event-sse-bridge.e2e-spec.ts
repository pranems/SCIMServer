/**
 * Phase J (v0.48.1) - SCIM event SSE bridge E2E.
 *
 * Validates that mutations through the public admin API actually
 * surface as `{type: 'scim.x.y', ...}` payloads on the SCIM event
 * channel (the seam consumed by the SSE controller and forwarded to
 * the web `useSSE` hook).
 *
 * Why subscribe to ScimLogger.subscribeScimEvents directly instead of
 * curling the SSE response stream:
 *   - Supertest does not stream `text/event-stream` responses well
 *     (it buffers until close); we'd have to use `http.request` and
 *     a manual abort-controller.
 *   - The bridge spec already covers the EventEmitter2 -> bridge ->
 *     ScimLogger.emitScimEvent contract.
 *   - The log-config controller spec covers `subscribeScimEvents` ->
 *     SSE response chunk wiring through unit tests.
 *   - This E2E proves the OTHER missing seam: the public HTTP route
 *     (controller / service code) actually emits the event after a
 *     real DB write through the test stack.
 *
 * @see docs/PHASE_J_SSE_EVENT_BRIDGE.md S5
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { ScimLogger } from '@app/modules/logging/scim-logger.service';
import { SCIM_EVENTS } from '@app/modules/stats/scim-events';

interface CapturedScimEvent {
  type: string;
  endpointId?: string;
  scimId?: string;
  credentialId?: string;
  [k: string]: unknown;
}

describe('SCIM Event SSE Bridge (E2E - Phase J v0.48.1)', () => {
  let app: INestApplication;
  let token: string;
  let scimLogger: ScimLogger;
  let captured: CapturedScimEvent[];
  let unsubscribe: () => void;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
    scimLogger = app.get(ScimLogger);
  });

  beforeEach(() => {
    captured = [];
    unsubscribe = scimLogger.subscribeScimEvents((evt) =>
      captured.push(evt as CapturedScimEvent),
    );
  });

  afterEach(() => {
    unsubscribe();
  });

  afterAll(async () => {
    await app.close();
  });

  function findEvent(type: string): CapturedScimEvent | undefined {
    return captured.find((e) => e.type === type);
  }

  describe('endpoint admin CRUD events', () => {
    let createdEndpointId: string | undefined;

    afterEach(async () => {
      // Best-effort cleanup; ignore 404 if a previous test already deleted
      if (createdEndpointId) {
        await request(app.getHttpServer())
          .delete(`/scim/admin/endpoints/${createdEndpointId}`)
          .set('Authorization', `Bearer ${token}`);
        createdEndpointId = undefined;
      }
    });

    it('POST /admin/endpoints emits scim.endpoint.created on the SCIM event channel', async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `phase-j-ep-create-${Date.now()}` })
        .expect(201);

      createdEndpointId = res.body.id;

      const evt = findEvent(SCIM_EVENTS.ENDPOINT_CREATED);
      expect(evt).toBeDefined();
      expect(evt!.endpointId).toBe(createdEndpointId);
      expect(evt!.timestamp).toBeDefined();
    });

    it('PATCH /admin/endpoints/:id emits scim.endpoint.updated', async () => {
      const created = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `phase-j-ep-update-${Date.now()}` })
        .expect(201);
      createdEndpointId = created.body.id;
      // Reset capture so we only see the update event
      captured = [];

      await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${createdEndpointId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ description: 'Phase J update' })
        .expect(200);

      const evt = findEvent(SCIM_EVENTS.ENDPOINT_UPDATED);
      expect(evt).toBeDefined();
      expect(evt!.endpointId).toBe(createdEndpointId);
    });

    it('DELETE /admin/endpoints/:id emits scim.endpoint.deleted', async () => {
      const created = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `phase-j-ep-delete-${Date.now()}` })
        .expect(201);
      const localId = created.body.id;
      captured = [];

      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${localId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      const evt = findEvent(SCIM_EVENTS.ENDPOINT_DELETED);
      expect(evt).toBeDefined();
      expect(evt!.endpointId).toBe(localId);
      // No cleanup needed - DELETE already removed it
      createdEndpointId = undefined;
    });
  });

  describe('per-endpoint credential admin events', () => {
    let endpointId: string;

    beforeAll(async () => {
      // Create an endpoint with the rfc-standard preset, then PATCH
      // PerEndpointCredentialsEnabled=True. This mirrors the
      // dashboard-overview E2E pattern; the create-time `profile`
      // path requires a fully-formed schemas/resourceTypes block, the
      // PATCH path can do a settings-only delta.
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: `phase-j-cred-host-${Date.now()}`,
          profilePreset: 'rfc-standard',
        })
        .expect(201);
      endpointId = res.body.id;
      await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ profile: { settings: { PerEndpointCredentialsEnabled: 'True' } } })
        .expect(200);
    });

    afterAll(async () => {
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`);
    });

    it('POST /admin/endpoints/:id/credentials emits scim.credential.created (NEVER carries the token)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .send({ label: 'Phase J E2E test' })
        .expect(201);

      const evt = findEvent(SCIM_EVENTS.CREDENTIAL_CREATED);
      expect(evt).toBeDefined();
      expect(evt!.endpointId).toBe(endpointId);
      expect(evt!.credentialId).toBe(res.body.id);
      // PII boundary: the SSE payload must NEVER carry the plaintext token
      // or the bcrypt hash, even though the HTTP response carries the token.
      expect(evt).not.toHaveProperty('token');
      expect(evt).not.toHaveProperty('credentialHash');
      expect(evt).not.toHaveProperty('hash');
    });

    it('DELETE /admin/endpoints/:id/credentials/:credentialId emits scim.credential.revoked', async () => {
      const created = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .send({ label: 'to revoke' })
        .expect(201);
      captured = [];

      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${endpointId}/credentials/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      const evt = findEvent(SCIM_EVENTS.CREDENTIAL_REVOKED);
      expect(evt).toBeDefined();
      expect(evt!.endpointId).toBe(endpointId);
      expect(evt!.credentialId).toBe(created.body.id);
    });
  });

  describe('SCIM resource events flow through to the SSE channel (regression guard)', () => {
    // Locks in that user/group events that already existed pre-Phase-J
    // ALSO start flowing once the bridge is in place. Before Phase J
    // these emits never made it past the in-memory stats projection.
    let endpointId: string;
    let scimBase: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `phase-j-scim-host-${Date.now()}`, profilePreset: 'rfc-standard' })
        .expect(201);
      endpointId = res.body.id;
      scimBase = res.body.scimBasePath;
    });

    afterAll(async () => {
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`);
    });

    it('POST a User flows scim.user.created onto the SCIM event channel', async () => {
      await request(app.getHttpServer())
        .post(`${scimBase}/Users`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: `phase-j-user-${Date.now()}`,
        })
        .expect(201);

      const evt = findEvent(SCIM_EVENTS.USER_CREATED);
      expect(evt).toBeDefined();
      expect(evt!.endpointId).toBe(endpointId);
      expect(evt!.scimId).toBeDefined();
    });
  });
});
