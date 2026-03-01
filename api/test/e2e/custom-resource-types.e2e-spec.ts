import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpointWithConfig } from './helpers/request.helper';
import { resetFixtureCounter } from './helpers/fixtures';

/**
 * Custom Resource Types (G8b) — E2E tests.
 *
 * Tests the full lifecycle for:
 *   1. Admin API: Register / List / Get / Delete custom resource types
 *   2. Generic SCIM CRUD: POST / GET / PUT / PATCH / DELETE custom resources
 *   3. Config flag gating: CustomResourceTypesEnabled
 *   4. Reserved names/paths protection
 *   5. SCIM discovery integration
 */
describe('Custom Resource Types (G8b) E2E', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;

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

  beforeEach(async () => {
    resetFixtureCounter();
    // Create endpoint with CustomResourceTypesEnabled = True
    endpointId = await createEndpointWithConfig(app, token, {
      CustomResourceTypesEnabled: 'True',
    });
  });

  // ─── Admin API: Config Flag Gating ──────────────────────────────────

  describe('Config flag gating', () => {
    it('should reject resource type registration when flag is disabled', async () => {
      const disabledEp = await createEndpointWithConfig(app, token, {});

      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${disabledEp}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(deviceSchema)
        .expect(403);
    });
  });

  // ─── Admin API: Registration ────────────────────────────────────────

  describe('Admin API: Register resource type', () => {
    it('should register a custom resource type and return 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(deviceSchema)
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.endpointId).toBe(endpointId);
      expect(res.body.name).toBe('Device');
      expect(res.body.schemaUri).toBe(deviceSchema.schemaUri);
      expect(res.body.endpoint).toBe('/Devices');
      expect(res.body.active).toBe(true);
    });

    it('should reject reserved name "User"', async () => {
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ ...deviceSchema, name: 'User', endpoint: '/CustomUsers' })
        .expect(400);
    });

    it('should reject reserved name "Group"', async () => {
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ ...deviceSchema, name: 'Group', endpoint: '/CustomGroups' })
        .expect(400);
    });

    it('should reject reserved endpoint path /Users', async () => {
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ ...deviceSchema, name: 'CustomType', endpoint: '/Users' })
        .expect(400);
    });

    it('should reject reserved endpoint path /Schemas', async () => {
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ ...deviceSchema, name: 'CustomType', endpoint: '/Schemas' })
        .expect(400);
    });

    it('should reject duplicate resource type name', async () => {
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(deviceSchema)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(deviceSchema)
        .expect(409);
    });

    it('should reject invalid name format', async () => {
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ ...deviceSchema, name: '123Invalid' })
        .expect(400);
    });

    it('should reject invalid endpoint path format', async () => {
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ ...deviceSchema, endpoint: 'NoSlash' })
        .expect(400);
    });

    it('should return 404 for non-existent endpoint', async () => {
      const fakeEndpointId = '00000000-0000-0000-0000-000000000000';
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${fakeEndpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(deviceSchema)
        .expect(404);
    });

    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Content-Type', 'application/json')
        .send(deviceSchema)
        .expect(401);
    });
  });

  // ─── Admin API: List & Get ──────────────────────────────────────────

  describe('Admin API: List and Get resource types', () => {
    beforeEach(async () => {
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(deviceSchema)
        .expect(201);
    });

    it('should list all custom resource types', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.totalResults).toBe(1);
      expect(res.body.resourceTypes).toHaveLength(1);
      expect(res.body.resourceTypes[0].name).toBe('Device');
    });

    it('should get a specific resource type by name', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}/resource-types/Device`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.name).toBe('Device');
      expect(res.body.schemaUri).toBe(deviceSchema.schemaUri);
    });

    it('should return 404 for non-existent resource type name', async () => {
      await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}/resource-types/NonExistent`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  // ─── Admin API: Delete ──────────────────────────────────────────────

  describe('Admin API: Delete resource type', () => {
    beforeEach(async () => {
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(deviceSchema)
        .expect(201);
    });

    it('should delete a custom resource type and return 204', async () => {
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${endpointId}/resource-types/Device`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      // Verify gone
      await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}/resource-types/Device`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should reject deletion of built-in type "User"', async () => {
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${endpointId}/resource-types/User`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('should return 404 for non-existent resource type', async () => {
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${endpointId}/resource-types/NonExistent`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  // ─── Generic SCIM CRUD ──────────────────────────────────────────────

  describe('Generic SCIM CRUD for custom resources', () => {
    let deviceId: string;

    beforeEach(async () => {
      // Register the Device resource type
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(deviceSchema)
        .expect(201);
    });

    it('should create a custom resource via POST', async () => {
      const res = await request(app.getHttpServer())
        .post(`/scim/endpoints/${endpointId}/Devices`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
          displayName: 'E2E Test Device',
          externalId: 'ext-e2e-001',
          serialNumber: 'SN-E2E-001',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:Device');
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.resourceType).toBe('Device');
      deviceId = res.body.id;
    });

    it('should retrieve a created resource via GET', async () => {
      // Create first
      const created = await request(app.getHttpServer())
        .post(`/scim/endpoints/${endpointId}/Devices`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
          displayName: 'Retrievable Device',
        })
        .expect(201);

      deviceId = created.body.id;

      // Get
      const res = await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId}/Devices/${deviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/scim+json')
        .expect(200);

      expect(res.body.id).toBe(deviceId);
      expect(res.body.meta.resourceType).toBe('Device');
    });

    it('should list custom resources via GET', async () => {
      // Create two
      await request(app.getHttpServer())
        .post(`/scim/endpoints/${endpointId}/Devices`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
          displayName: 'Device A',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/scim/endpoints/${endpointId}/Devices`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
          displayName: 'Device B',
        })
        .expect(201);

      // List
      const res = await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId}/Devices`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/scim+json')
        .expect(200);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(res.body.totalResults).toBeGreaterThanOrEqual(2);
    });

    it('should replace a resource via PUT', async () => {
      // Create first
      const created = await request(app.getHttpServer())
        .post(`/scim/endpoints/${endpointId}/Devices`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
          displayName: 'Original Device',
        })
        .expect(201);

      deviceId = created.body.id;

      // Replace
      const res = await request(app.getHttpServer())
        .put(`/scim/endpoints/${endpointId}/Devices/${deviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
          displayName: 'Replaced Device',
          serialNumber: 'SN-REPLACED',
        })
        .expect(200);

      expect(res.body.id).toBe(deviceId);
    });

    it('should patch a resource via PATCH', async () => {
      // Create first
      const created = await request(app.getHttpServer())
        .post(`/scim/endpoints/${endpointId}/Devices`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
          displayName: 'Patchable Device',
        })
        .expect(201);

      deviceId = created.body.id;

      // Patch
      const res = await request(app.getHttpServer())
        .patch(`/scim/endpoints/${endpointId}/Devices/${deviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            { op: 'replace', path: 'displayName', value: 'Patched Device' },
          ],
        })
        .expect(200);

      expect(res.body.id).toBe(deviceId);
    });

    it('should delete a resource via DELETE', async () => {
      // Create first
      const created = await request(app.getHttpServer())
        .post(`/scim/endpoints/${endpointId}/Devices`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
          displayName: 'Deletable Device',
        })
        .expect(201);

      deviceId = created.body.id;

      // Delete
      await request(app.getHttpServer())
        .delete(`/scim/endpoints/${endpointId}/Devices/${deviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      // Verify gone
      await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId}/Devices/${deviceId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/scim+json')
        .expect(404);
    });

    it('should return 404 for non-existent resource', async () => {
      await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId}/Devices/non-existent-id`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/scim+json')
        .expect(404);
    });

    it('should reject create with wrong schemas', async () => {
      await request(app.getHttpServer())
        .post(`/scim/endpoints/${endpointId}/Devices`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['wrong:schema'],
          displayName: 'Bad Device',
        })
        .expect(400);
    });
  });

  // ─── Endpoint isolation ─────────────────────────────────────────────

  describe('Endpoint isolation', () => {
    it('should isolate custom resource types between endpoints', async () => {
      // Register Device on endpoint 1
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(deviceSchema)
        .expect(201);

      // Create another endpoint with custom resource types enabled
      const endpoint2 = await createEndpointWithConfig(app, token, {
        CustomResourceTypesEnabled: 'True',
      });

      // Endpoint 2 should NOT have Device type
      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpoint2}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.totalResults).toBe(0);
    });
  });

  // ─── Built-in routes protection ─────────────────────────────────────

  describe('Built-in routes protection', () => {
    it('should still serve /Users via dedicated controller', async () => {
      // Register a custom type
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(deviceSchema)
        .expect(201);

      // /Users should still work via the dedicated User controller
      const res = await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId}/Users`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/scim+json')
        .expect(200);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
    });

    it('should still serve /Groups via dedicated controller', async () => {
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(deviceSchema)
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId}/Groups`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/scim+json')
        .expect(200);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
    });
  });

  // ─── Multiple resource types ────────────────────────────────────────

  describe('Multiple custom resource types', () => {
    it('should support registering and using multiple resource types on one endpoint', async () => {
      // Register Device
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(deviceSchema)
        .expect(201);

      // Register Application
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          name: 'Application',
          description: 'Enterprise applications',
          schemaUri: 'urn:example:schemas:core:2.0:Application',
          endpoint: '/Applications',
        })
        .expect(201);

      // Create resources for each type
      const device = await request(app.getHttpServer())
        .post(`/scim/endpoints/${endpointId}/Devices`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Device'],
          displayName: 'Test Device',
        })
        .expect(201);

      const appRes = await request(app.getHttpServer())
        .post(`/scim/endpoints/${endpointId}/Applications`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:example:schemas:core:2.0:Application'],
          displayName: 'Test App',
        })
        .expect(201);

      // Verify both exist
      expect(device.body.meta.resourceType).toBe('Device');
      expect(appRes.body.meta.resourceType).toBe('Application');

      // List types
      const types = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}/resource-types`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(types.body.totalResults).toBe(2);
    });
  });
});
