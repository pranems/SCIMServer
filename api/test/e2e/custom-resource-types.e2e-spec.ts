import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { resetFixtureCounter } from './helpers/fixtures';

/**
 * Custom Resource Type CRUD - E2E
 *
 * Tests the generic controller (EndpointScimGenericController) for custom resource types
 * registered via the endpoint profile system.
 *
 * Covers:
 *   POST   /endpoints/{eid}/{resourceType}
 *   GET    /endpoints/{eid}/{resourceType}
 *   GET    /endpoints/{eid}/{resourceType}/:id
 *   POST   /endpoints/{eid}/{resourceType}/.search
 *   PUT    /endpoints/{eid}/{resourceType}/:id
 *   PATCH  /endpoints/{eid}/{resourceType}/:id
 *   DELETE /endpoints/{eid}/{resourceType}/:id
 */
describe('Custom Resource Type CRUD (E2E)', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;
  let basePath: string;

  const CUSTOM_SCHEMA_URN = 'urn:example:params:scim:schemas:custom:2.0:Device';
  const CUSTOM_RESOURCE_TYPE = 'Devices';

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
    resetFixtureCounter();

    // Create endpoint with inline profile that includes a custom resource type
    const res = await request(app.getHttpServer())
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({
        name: `custom-rt-test-${Date.now()}`,
        displayName: 'Custom Resource Type Test',
        profile: {
          schemas: [
            { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User', attributes: 'all' },
            { id: 'urn:ietf:params:scim:schemas:core:2.0:Group', name: 'Group', attributes: 'all' },
            {
              id: CUSTOM_SCHEMA_URN,
              name: 'Device',
              description: 'Custom device resource',
              attributes: [
                { name: 'deviceName', type: 'string', multiValued: false, required: true, mutability: 'readWrite', returned: 'default', caseExact: false, uniqueness: 'none' },
                { name: 'serialNumber', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', caseExact: true, uniqueness: 'none' },
                { name: 'status', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', caseExact: false, uniqueness: 'none' },
              ],
            },
          ],
          resourceTypes: [
            {
              id: 'User', name: 'User', endpoint: '/Users', description: 'User Account',
              schema: 'urn:ietf:params:scim:schemas:core:2.0:User', schemaExtensions: [],
            },
            {
              id: 'Group', name: 'Group', endpoint: '/Groups', description: 'Group',
              schema: 'urn:ietf:params:scim:schemas:core:2.0:Group', schemaExtensions: [],
            },
            {
              id: 'Device', name: 'Device', endpoint: `/${CUSTOM_RESOURCE_TYPE}`, description: 'Device',
              schema: CUSTOM_SCHEMA_URN, schemaExtensions: [],
            },
          ],
          serviceProviderConfig: {
            patch: { supported: true },
            bulk: { supported: false },
            filter: { supported: true, maxResults: 200 },
            changePassword: { supported: false },
            sort: { supported: true },
            etag: { supported: true },
          },
          settings: {},
        },
      })
      .expect(201);

    endpointId = res.body.id;
    basePath = `/scim/endpoints/${endpointId}`;
  });

  afterAll(async () => {
    // Cleanup endpoint
    await request(app.getHttpServer())
      .delete(`/scim/admin/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
    await app.close();
  });

  describe('POST - Create custom resource', () => {
    let deviceId: string;

    it('should create a custom Device resource', async () => {
      const res = await request(app.getHttpServer())
        .post(`${basePath}/${CUSTOM_RESOURCE_TYPE}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [CUSTOM_SCHEMA_URN],
          deviceName: 'Test Laptop',
          serialNumber: 'SN-001',
          status: 'active',
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('schemas');
      expect(res.body.schemas).toContain(CUSTOM_SCHEMA_URN);
      expect(res.body).toHaveProperty('deviceName', 'Test Laptop');
      expect(res.body).toHaveProperty('serialNumber', 'SN-001');
      expect(res.body).toHaveProperty('meta');
      expect(res.body.meta).toHaveProperty('resourceType');
      deviceId = res.body.id;
    });

    afterAll(async () => {
      if (deviceId) {
        await request(app.getHttpServer())
          .delete(`${basePath}/${CUSTOM_RESOURCE_TYPE}/${deviceId}`)
          .set('Authorization', `Bearer ${token}`);
      }
    });
  });

  describe('Full CRUD lifecycle', () => {
    let resourceId: string;

    it('POST - should create', async () => {
      const res = await request(app.getHttpServer())
        .post(`${basePath}/${CUSTOM_RESOURCE_TYPE}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [CUSTOM_SCHEMA_URN],
          deviceName: `CRUD Device ${Date.now()}`,
          serialNumber: 'SN-CRUD-001',
          status: 'provisioned',
        })
        .expect(201);

      resourceId = res.body.id;
      expect(resourceId).toBeDefined();
    });

    it('GET by ID - should retrieve', async () => {
      const res = await request(app.getHttpServer())
        .get(`${basePath}/${CUSTOM_RESOURCE_TYPE}/${resourceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', resourceId);
      expect(res.body).toHaveProperty('serialNumber', 'SN-CRUD-001');
    });

    it('GET list - should list resources', async () => {
      const res = await request(app.getHttpServer())
        .get(`${basePath}/${CUSTOM_RESOURCE_TYPE}?startIndex=1&count=10`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty('schemas');
      expect(res.body.schemas).toContain(
        'urn:ietf:params:scim:api:messages:2.0:ListResponse',
      );
      expect(res.body).toHaveProperty('totalResults');
      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      expect(res.body).toHaveProperty('Resources');
    });

    it('POST /.search - should search', async () => {
      const res = await request(app.getHttpServer())
        .post(`${basePath}/${CUSTOM_RESOURCE_TYPE}/.search`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [
            'urn:ietf:params:scim:api:messages:2.0:SearchRequest',
          ],
          startIndex: 1,
          count: 10,
        })
        .expect(200);

      expect(res.body).toHaveProperty('totalResults');
      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
    });

    it('PUT - should replace', async () => {
      const res = await request(app.getHttpServer())
        .put(`${basePath}/${CUSTOM_RESOURCE_TYPE}/${resourceId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [CUSTOM_SCHEMA_URN],
          deviceName: 'CRUD Device Updated',
          serialNumber: 'SN-CRUD-002',
          status: 'active',
        })
        .expect(200);

      expect(res.body).toHaveProperty('deviceName', 'CRUD Device Updated');
      expect(res.body).toHaveProperty('serialNumber', 'SN-CRUD-002');
    });

    it('PATCH - should modify', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${basePath}/${CUSTOM_RESOURCE_TYPE}/${resourceId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            { op: 'replace', path: 'status', value: 'retired' },
          ],
        })
        .expect(200);

      expect(res.body).toHaveProperty('status', 'retired');
    });

    it('DELETE - should remove', async () => {
      await request(app.getHttpServer())
        .delete(`${basePath}/${CUSTOM_RESOURCE_TYPE}/${resourceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      // Confirm gone
      await request(app.getHttpServer())
        .get(`${basePath}/${CUSTOM_RESOURCE_TYPE}/${resourceId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      resourceId = undefined as any; // prevent double-delete in afterAll
    });
  });

  describe('Error cases', () => {
    it('should return 404 for non-existent resource', async () => {
      await request(app.getHttpServer())
        .get(
          `${basePath}/${CUSTOM_RESOURCE_TYPE}/00000000-0000-0000-0000-000000000000`,
        )
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should return 401 without auth', async () => {
      await request(app.getHttpServer())
        .get(`${basePath}/${CUSTOM_RESOURCE_TYPE}`)
        .expect(401);
    });

    it('should return 404 for unregistered resource type', async () => {
      await request(app.getHttpServer())
        .get(`${basePath}/NonExistentType`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('Discovery for custom resource type', () => {
    it('should include custom resource type in ResourceTypes', async () => {
      const res = await request(app.getHttpServer())
        .get(`${basePath}/ResourceTypes`)
        .expect(200);

      const deviceType = res.body.Resources
        ? res.body.Resources.find((rt: any) => rt.name === 'Device')
        : Array.isArray(res.body)
          ? res.body.find((rt: any) => rt.name === 'Device')
          : null;

      expect(deviceType).toBeDefined();
      expect(deviceType.schema).toBe(CUSTOM_SCHEMA_URN);
    });

    it('should include custom schema in Schemas', async () => {
      const res = await request(app.getHttpServer())
        .get(`${basePath}/Schemas`)
        .expect(200);

      const schemas = res.body.Resources || res.body;
      const deviceSchema = Array.isArray(schemas)
        ? schemas.find((s: any) => s.id === CUSTOM_SCHEMA_URN)
        : null;

      expect(deviceSchema).toBeDefined();
      expect(deviceSchema.name).toBe('Device');
    });
  });
});
