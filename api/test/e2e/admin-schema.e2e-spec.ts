import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpoint } from './helpers/request.helper';
import { resetFixtureCounter } from './helpers/fixtures';

/**
 * Admin Schema Extension API — E2E tests.
 *
 * Tests the full CRUD lifecycle for per-endpoint SCIM schema extensions:
 *   POST   /admin/endpoints/:endpointId/schemas
 *   GET    /admin/endpoints/:endpointId/schemas
 *   GET    /admin/endpoints/:endpointId/schemas/:urn
 *   DELETE /admin/endpoints/:endpointId/schemas/:urn
 *
 * Also verifies that registered extensions appear in SCIM discovery
 * responses for the corresponding endpoint.
 */
describe('Admin Schema Extensions API (E2E)', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;

  const sampleSchema = {
    schemaUrn: 'urn:ietf:params:scim:schemas:extension:custom:2.0:User',
    name: 'Custom User Extension',
    description: 'E2E test extension',
    resourceTypeId: 'User',
    required: false,
    attributes: [
      {
        name: 'badgeNumber',
        type: 'string',
        multiValued: false,
        required: false,
        description: 'Employee badge number',
      },
      {
        name: 'costCenter',
        type: 'string',
        multiValued: false,
        required: true,
        description: 'Cost center code',
      },
    ],
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
    endpointId = await createEndpoint(app, token);
  });

  // ─── Authentication ─────────────────────────────────────────────────

  describe('Authentication', () => {
    it('should require authentication for POST', async () => {
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/schemas`)
        .send(sampleSchema)
        .expect(401);
    });

    it('should require authentication for GET list', async () => {
      await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}/schemas`)
        .expect(401);
    });

    it('should require authentication for DELETE', async () => {
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${endpointId}/schemas/${encodeURIComponent(sampleSchema.schemaUrn)}`)
        .expect(401);
    });
  });

  // ─── POST /admin/endpoints/:endpointId/schemas ──────────────────────

  describe('POST /admin/endpoints/:endpointId/schemas', () => {
    it('should register a schema extension and return 201', async () => {
      const res = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/schemas`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(sampleSchema)
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.endpointId).toBe(endpointId);
      expect(res.body.schemaUrn).toBe(sampleSchema.schemaUrn);
      expect(res.body.name).toBe(sampleSchema.name);
      expect(res.body.description).toBe(sampleSchema.description);
      expect(res.body.resourceTypeId).toBe(sampleSchema.resourceTypeId);
      expect(res.body.required).toBe(false);
      expect(res.body.attributes).toHaveLength(2);
      expect(res.body.createdAt).toBeDefined();
    });

    it('should reject duplicate schema URN for same endpoint (409)', async () => {
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/schemas`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(sampleSchema)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/schemas`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(sampleSchema)
        .expect(409);
    });

    it('should return 404 for non-existent endpoint', async () => {
      await request(app.getHttpServer())
        .post('/scim/admin/endpoints/00000000-0000-4000-a000-000000000099/schemas')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(sampleSchema)
        .expect(404);
    });

    it('should allow same URN on different endpoints', async () => {
      const endpointId2 = await createEndpoint(app, token);

      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/schemas`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(sampleSchema)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId2}/schemas`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(sampleSchema)
        .expect(201);
    });

    it('should register a schema without optional fields', async () => {
      const minimal = {
        schemaUrn: 'urn:test:minimal:2.0',
        name: 'Minimal',
        attributes: [],
      };

      const res = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/schemas`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(minimal)
        .expect(201);

      expect(res.body.schemaUrn).toBe(minimal.schemaUrn);
      expect(res.body.resourceTypeId).toBeNull();
      expect(res.body.description).toBeNull();
    });
  });

  // ─── GET /admin/endpoints/:endpointId/schemas ───────────────────────

  describe('GET /admin/endpoints/:endpointId/schemas', () => {
    it('should return empty list when no schemas registered', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}/schemas`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.totalResults).toBe(0);
      expect(res.body.schemas).toEqual([]);
    });

    it('should list registered schemas', async () => {
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/schemas`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(sampleSchema)
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}/schemas`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.totalResults).toBe(1);
      expect(res.body.schemas[0].schemaUrn).toBe(sampleSchema.schemaUrn);
    });

    it('should not show schemas from other endpoints', async () => {
      const endpointId2 = await createEndpoint(app, token);

      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/schemas`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(sampleSchema)
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId2}/schemas`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.totalResults).toBe(0);
    });

    it('should return 404 for non-existent endpoint', async () => {
      await request(app.getHttpServer())
        .get('/scim/admin/endpoints/00000000-0000-4000-a000-000000000099/schemas')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  // ─── GET /admin/endpoints/:endpointId/schemas/:urn ──────────────────

  describe('GET /admin/endpoints/:endpointId/schemas/:urn', () => {
    it('should return a specific schema by URN', async () => {
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/schemas`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(sampleSchema)
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}/schemas/${encodeURIComponent(sampleSchema.schemaUrn)}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.schemaUrn).toBe(sampleSchema.schemaUrn);
      expect(res.body.name).toBe(sampleSchema.name);
      expect(res.body.attributes).toHaveLength(2);
    });

    it('should return 404 for non-existent URN', async () => {
      await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}/schemas/${encodeURIComponent('urn:not:found')}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  // ─── DELETE /admin/endpoints/:endpointId/schemas/:urn ───────────────

  describe('DELETE /admin/endpoints/:endpointId/schemas/:urn', () => {
    it('should delete a schema and return 204', async () => {
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/schemas`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(sampleSchema)
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${endpointId}/schemas/${encodeURIComponent(sampleSchema.schemaUrn)}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      // Verify it's gone
      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}/schemas`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.totalResults).toBe(0);
    });

    it('should return 404 when deleting non-existent URN', async () => {
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${endpointId}/schemas/${encodeURIComponent('urn:not:found')}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  // ─── Discovery integration ──────────────────────────────────────────

  describe('Discovery integration', () => {
    it('should show registered extension in /Schemas discovery', async () => {
      // Register extension
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/schemas`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(sampleSchema)
        .expect(201);

      // Verify it appears in SCIM /Schemas discovery
      const res = await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId}/Schemas`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/scim+json')
        .expect(200);

      const schemaIds = res.body.Resources.map((r: any) => r.id);
      expect(schemaIds).toContain(sampleSchema.schemaUrn);
    });

    it('should remove extension from /Schemas discovery after DELETE', async () => {
      // Register
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/schemas`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(sampleSchema)
        .expect(201);

      // Delete
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${endpointId}/schemas/${encodeURIComponent(sampleSchema.schemaUrn)}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      // Verify removed from /Schemas discovery
      const res = await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId}/Schemas`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/scim+json')
        .expect(200);

      const schemaIds = res.body.Resources.map((r: any) => r.id);
      expect(schemaIds).not.toContain(sampleSchema.schemaUrn);
    });

    it('should not show endpoint-specific extension in other endpoint discovery', async () => {
      const endpointId2 = await createEndpoint(app, token);

      // Register on endpoint 1 only
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/schemas`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(sampleSchema)
        .expect(201);

      // endpoint 2's /Schemas should NOT have it
      const res = await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId2}/Schemas`)
        .set('Authorization', `Bearer ${token}`)
        .set('Accept', 'application/scim+json')
        .expect(200);

      const schemaIds = res.body.Resources.map((r: any) => r.id);
      expect(schemaIds).not.toContain(sampleSchema.schemaUrn);
    });
  });
});
