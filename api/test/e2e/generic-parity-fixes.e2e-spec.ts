import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimPost,
  scimGet,
  scimPatch,
  scimPut,
  scimDelete,
  createEndpointWithConfig,
  scimBasePath,
} from './helpers/request.helper';
import { resetFixtureCounter, patchOp } from './helpers/fixtures';

/**
 * Generic Resource Parity Fixes — E2E tests.
 *
 * Tests for:
 *   Fix #1: RequireIfMatch 428 enforcement on generic resources (PUT/PATCH/DELETE)
 *   Fix #2: validateFilterAttributePaths wiring — 400 invalidFilter for unknown attrs
 *   Fix #3: Generic filter 400 for unsupported filter expressions
 */
describe('Generic Resource Parity Fixes (E2E)', () => {
  let app: INestApplication;
  let token: string;

  const deviceSchema = {
    name: 'Device',
    description: 'IoT devices for testing',
    schemaUri: 'urn:ietf:params:scim:schemas:core:2.0:Device',
    endpoint: '/Devices',
    schemaExtensions: [],
  };

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // ─────── Helper: Create endpoint with custom resource types + optional config ───────

  async function setupGenericEndpoint(extraConfig: Record<string, unknown> = {}): Promise<{ endpointId: string; basePath: string }> {
    resetFixtureCounter();
    const endpointId = await createEndpointWithConfig(app, token, {
      CustomResourceTypesEnabled: 'True',
      ...extraConfig,
    });
    const basePath = scimBasePath(endpointId);

    // Register Device resource type
    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/resource-types`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send(deviceSchema)
      .expect(201);

    return { endpointId, basePath };
  }

  async function createDevice(basePath: string, displayName = 'Test Device'): Promise<any> {
    const res = await request(app.getHttpServer())
      .post(`${basePath}/Devices`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/scim+json')
      .send({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
        displayName,
      })
      .expect(201);
    return res.body;
  }

  // ─── Fix #1: RequireIfMatch — 428 on Generic Resources ──────────────

  describe('Fix #1: RequireIfMatch 428 on generic resources', () => {
    it('should return 428 when RequireIfMatch=true and no If-Match on PUT (generic)', async () => {
      const { basePath } = await setupGenericEndpoint({ RequireIfMatch: true });
      const device = await createDevice(basePath);

      await request(app.getHttpServer())
        .put(`${basePath}/Devices/${device.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
          displayName: 'Updated',
        })
        .expect(428);
    });

    it('should return 428 when RequireIfMatch=true and no If-Match on PATCH (generic)', async () => {
      const { basePath } = await setupGenericEndpoint({ RequireIfMatch: true });
      const device = await createDevice(basePath);

      await request(app.getHttpServer())
        .patch(`${basePath}/Devices/${device.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send(patchOp([{ op: 'replace', path: 'displayName', value: 'No Header' }]))
        .expect(428);
    });

    it('should return 428 when RequireIfMatch=true and no If-Match on DELETE (generic)', async () => {
      const { basePath } = await setupGenericEndpoint({ RequireIfMatch: true });
      const device = await createDevice(basePath);

      await request(app.getHttpServer())
        .delete(`${basePath}/Devices/${device.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(428);
    });

    it('should succeed on PUT when RequireIfMatch=true and If-Match provided (generic)', async () => {
      const { basePath } = await setupGenericEndpoint({ RequireIfMatch: true });
      const device = await createDevice(basePath);

      await request(app.getHttpServer())
        .put(`${basePath}/Devices/${device.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .set('If-Match', 'W/"v1"')
        .send({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
          displayName: 'Updated with header',
        })
        .expect(200);
    });

    it('should succeed on PATCH when RequireIfMatch=true and If-Match provided (generic)', async () => {
      const { basePath } = await setupGenericEndpoint({ RequireIfMatch: true });
      const device = await createDevice(basePath);

      await request(app.getHttpServer())
        .patch(`${basePath}/Devices/${device.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .set('If-Match', 'W/"v1"')
        .send(patchOp([{ op: 'replace', path: 'displayName', value: 'With Header' }]))
        .expect(200);
    });
  });

  // ─── Fix #3: Generic filter — 400 for unsupported expressions ───────

  describe('Fix #3: Generic filter 400 for unsupported expressions', () => {
    it('should return 400 invalidFilter for unsupported filter operator on generic resource', async () => {
      const { basePath } = await setupGenericEndpoint();

      const res = await request(app.getHttpServer())
        .get(`${basePath}/Devices?filter=displayName co "test"`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/scim+json')
        .expect(400);

      expect(res.body.scimType).toBe('invalidFilter');
    });

    it('should return 400 invalidFilter for unsupported attribute in eq filter', async () => {
      const { basePath } = await setupGenericEndpoint();

      const res = await request(app.getHttpServer())
        .get(`${basePath}/Devices?filter=active eq true`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/scim+json')
        .expect(400);

      expect(res.body.scimType).toBe('invalidFilter');
    });

    it('should still accept displayName eq filter', async () => {
      const { basePath } = await setupGenericEndpoint();
      await createDevice(basePath, 'FilterTarget');

      const res = await request(app.getHttpServer())
        .get(`${basePath}/Devices?filter=displayName eq "FilterTarget"`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/scim+json')
        .expect(200);

      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
    });

    it('should still accept externalId eq filter', async () => {
      const { basePath } = await setupGenericEndpoint();

      const res = await request(app.getHttpServer())
        .get(`${basePath}/Devices?filter=externalId eq "nonexistent"`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/scim+json')
        .expect(200);

      expect(res.body.totalResults).toBe(0);
    });
  });

  // ─── Fix #2: Users filter — 400 for unknown attribute paths ─────────

  describe('Fix #2: Filter attribute path validation (Users)', () => {
    it('should return 400 invalidFilter for completely unknown attribute in Users filter', async () => {
      const { basePath } = await setupGenericEndpoint();

      const res = await request(app.getHttpServer())
        .get(`${basePath}/Users?filter=nonExistentAttr eq "test"`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/scim+json')
        .expect(400);

      expect(res.body.scimType).toBe('invalidFilter');
    });
  });

  // ─── Fix #2b: Groups filter — 400 for unknown attribute paths ──────

  describe('Fix #2b: Filter attribute path validation (Groups)', () => {
    it('should return 400 invalidFilter for unknown attribute in Groups filter', async () => {
      const { basePath } = await setupGenericEndpoint();

      const res = await request(app.getHttpServer())
        .get(`${basePath}/Groups?filter=nonExistentAttr eq "test"`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/scim+json')
        .expect(400);

      expect(res.body.scimType).toBe('invalidFilter');
    });
  });

  // ─── Groups RequireIfMatch 428 enforcement ─────────────────────────

  describe('Groups RequireIfMatch 428 enforcement', () => {
    it('should return 428 when RequireIfMatch=true and no If-Match on PUT (Groups)', async () => {
      const { basePath } = await setupGenericEndpoint({ RequireIfMatch: true });

      // Create a group
      const group = await request(app.getHttpServer())
        .post(`${basePath}/Groups`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: 'ETag Group' })
        .expect(201);

      await request(app.getHttpServer())
        .put(`${basePath}/Groups/${group.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: 'Updated' })
        .expect(428);
    });

    it('should return 428 when RequireIfMatch=true and no If-Match on PATCH (Groups)', async () => {
      const { basePath } = await setupGenericEndpoint({ RequireIfMatch: true });

      const group = await request(app.getHttpServer())
        .post(`${basePath}/Groups`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: 'ETag Group 2' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`${basePath}/Groups/${group.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send(patchOp([{ op: 'replace', path: 'displayName', value: 'No Header' }]))
        .expect(428);
    });

    it('should return 428 when RequireIfMatch=true and no If-Match on DELETE (Groups)', async () => {
      const { basePath } = await setupGenericEndpoint({ RequireIfMatch: true });

      const group = await request(app.getHttpServer())
        .post(`${basePath}/Groups`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: 'ETag Group 3' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`${basePath}/Groups/${group.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(428);
    });
  });

  // ─── DELETE success with If-Match header (generic) ──────────────────

  describe('DELETE with If-Match header (generic)', () => {
    it('should succeed when RequireIfMatch=true and If-Match is provided on DELETE (generic)', async () => {
      const { basePath } = await setupGenericEndpoint({ RequireIfMatch: true });
      const device = await createDevice(basePath);

      await request(app.getHttpServer())
        .delete(`${basePath}/Devices/${device.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('If-Match', 'W/"v1"')
        .expect(204);
    });
  });
});
