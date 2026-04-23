import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpointWithConfig, scimBasePath, scimPost } from './helpers/request.helper';
import { resetFixtureCounter } from './helpers/fixtures';

/**
 * Bulk Operations (Phase 9, RFC 7644 §3.7) - E2E tests.
 *
 * Tests the full lifecycle for:
 *   1. Config flag gating: BulkOperationsEnabled
 *   2. POST /Bulk with User operations (POST/PUT/PATCH/DELETE)
 *   3. POST /Bulk with Group operations
 *   4. bulkId cross-referencing between operations
 *   5. failOnErrors threshold
 *   6. Schema validation (BulkRequest schema required)
 *   7. Error handling (per-operation errors, mixed success/failure)
 *   8. ServiceProviderConfig reflects bulk.supported = true
 */
describe('Bulk Operations (Phase 9) E2E', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;

  const BULK_REQUEST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:BulkRequest';
  const BULK_RESPONSE_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:BulkResponse';
  const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
  const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    resetFixtureCounter();
    // Create endpoint with BulkOperationsEnabled
    endpointId = await createEndpointWithConfig(app, token, {
      BulkOperationsEnabled: 'True',
    });
  });

  // ─── Config flag gating ──────────────────────────────────────────────

  describe('Config flag gating', () => {
    it('should return 403 when BulkOperationsEnabled is False', async () => {
      const disabledEp = await createEndpointWithConfig(app, token, {
        BulkOperationsEnabled: 'False',
      });

      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(disabledEp)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            { method: 'POST', path: '/Users', bulkId: 'u1', data: { schemas: [USER_SCHEMA], userName: 'blocked@example.com' } },
          ],
        })
        .expect(403);

      expect(res.body.message || res.body.detail).toContain('Bulk operations are not enabled');
    });

    it('should return 403 when BulkOperationsEnabled is False', async () => {
      const disabledEp = await createEndpointWithConfig(app, token, {
        BulkOperationsEnabled: 'False',
      });

      await request(app.getHttpServer())
        .post(`${scimBasePath(disabledEp)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            { method: 'POST', path: '/Users', bulkId: 'u1', data: { schemas: [USER_SCHEMA], userName: 'blocked@example.com' } },
          ],
        })
        .expect(403);
    });

    it('should succeed when BulkOperationsEnabled is True', async () => {
      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            { method: 'POST', path: '/Users', bulkId: 'u1', data: { schemas: [USER_SCHEMA], userName: `bulk-test-${Date.now()}@example.com` } },
          ],
        })
        .expect(200);

      expect(res.body.schemas).toContain(BULK_RESPONSE_SCHEMA);
      expect(res.body.Operations).toHaveLength(1);
      expect(res.body.Operations[0].status).toBe('201');
    });
  });

  // ─── User CRUD via Bulk ──────────────────────────────────────────────

  describe('User CRUD via Bulk', () => {
    it('should POST a user via bulk', async () => {
      const userName = `bulk-user-${Date.now()}@example.com`;

      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            { method: 'POST', path: '/Users', bulkId: 'u1', data: { schemas: [USER_SCHEMA], userName } },
          ],
        })
        .expect(200);

      expect(res.body.Operations[0].status).toBe('201');
      expect(res.body.Operations[0].bulkId).toBe('u1');
      expect(res.body.Operations[0].location).toContain('/Users/');
    });

    it('should PUT (replace) a user via bulk', async () => {
      // First create a user
      const userName = `bulk-put-${Date.now()}@example.com`;
      const createRes = await scimPost(app, `${scimBasePath(endpointId)}/Users`, token, {
        schemas: [USER_SCHEMA],
        userName,
      }).expect(201);

      const userId = createRes.body.id;

      // Now replace via bulk
      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            {
              method: 'PUT',
              path: `/Users/${userId}`,
              data: { schemas: [USER_SCHEMA], userName, displayName: 'Replaced User' },
            },
          ],
        })
        .expect(200);

      expect(res.body.Operations[0].status).toBe('200');
    });

    it('should PATCH a user via bulk', async () => {
      const userName = `bulk-patch-${Date.now()}@example.com`;
      const createRes = await scimPost(app, `${scimBasePath(endpointId)}/Users`, token, {
        schemas: [USER_SCHEMA],
        userName,
      }).expect(201);

      const userId = createRes.body.id;

      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            {
              method: 'PATCH',
              path: `/Users/${userId}`,
              data: {
                schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
                Operations: [{ op: 'replace', path: 'active', value: false }],
              },
            },
          ],
        })
        .expect(200);

      expect(res.body.Operations[0].status).toBe('200');
    });

    it('should DELETE a user via bulk', async () => {
      const userName = `bulk-del-${Date.now()}@example.com`;
      const createRes = await scimPost(app, `${scimBasePath(endpointId)}/Users`, token, {
        schemas: [USER_SCHEMA],
        userName,
      }).expect(201);

      const userId = createRes.body.id;

      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            { method: 'DELETE', path: `/Users/${userId}` },
          ],
        })
        .expect(200);

      expect(res.body.Operations[0].status).toBe('204');
    });
  });

  // ─── Group CRUD via Bulk ─────────────────────────────────────────────

  describe('Group CRUD via Bulk', () => {
    it('should POST a group via bulk', async () => {
      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            { method: 'POST', path: '/Groups', bulkId: 'g1', data: { schemas: [GROUP_SCHEMA], displayName: `BulkGroup-${Date.now()}` } },
          ],
        })
        .expect(200);

      expect(res.body.Operations[0].status).toBe('201');
      expect(res.body.Operations[0].location).toContain('/Groups/');
    });

    it('should DELETE a group via bulk', async () => {
      const createRes = await scimPost(app, `${scimBasePath(endpointId)}/Groups`, token, {
        schemas: [GROUP_SCHEMA],
        displayName: `BulkGroupDel-${Date.now()}`,
      }).expect(201);

      const groupId = createRes.body.id;

      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            { method: 'DELETE', path: `/Groups/${groupId}` },
          ],
        })
        .expect(200);

      expect(res.body.Operations[0].status).toBe('204');
    });
  });

  // ─── bulkId cross-referencing ────────────────────────────────────────

  describe('bulkId cross-referencing', () => {
    it('should resolve bulkId from POST in subsequent PATCH path', async () => {
      const userName = `bulk-xref-${Date.now()}@example.com`;

      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            {
              method: 'POST',
              path: '/Users',
              bulkId: 'u1',
              data: { schemas: [USER_SCHEMA], userName },
            },
            {
              method: 'PATCH',
              path: '/Users/bulkId:u1',
              data: {
                schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
                Operations: [{ op: 'replace', path: 'displayName', value: 'Cross-ref Updated' }],
              },
            },
          ],
        })
        .expect(200);

      expect(res.body.Operations).toHaveLength(2);
      expect(res.body.Operations[0].status).toBe('201');
      expect(res.body.Operations[1].status).toBe('200');
    });

    it('should resolve bulkId in group member data', async () => {
      const userName = `bulk-member-${Date.now()}@example.com`;

      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            {
              method: 'POST',
              path: '/Users',
              bulkId: 'u1',
              data: { schemas: [USER_SCHEMA], userName },
            },
            {
              method: 'POST',
              path: '/Groups',
              bulkId: 'g1',
              data: {
                schemas: [GROUP_SCHEMA],
                displayName: `BulkGrp-${Date.now()}`,
                members: [{ value: 'bulkId:u1' }],
              },
            },
          ],
        })
        .expect(200);

      expect(res.body.Operations).toHaveLength(2);
      expect(res.body.Operations[0].status).toBe('201');
      expect(res.body.Operations[1].status).toBe('201');
    });

    it('should error on unresolved bulkId reference', async () => {
      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            {
              method: 'PATCH',
              path: '/Users/bulkId:unknown',
              data: {
                schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
                Operations: [{ op: 'replace', path: 'active', value: false }],
              },
            },
          ],
        })
        .expect(200);

      expect(res.body.Operations[0].status).toBe('400');
      expect(res.body.Operations[0].response.detail).toContain('Unresolved bulkId');
    });
  });

  // ─── failOnErrors ────────────────────────────────────────────────────

  describe('failOnErrors', () => {
    it('should stop after failOnErrors threshold', async () => {
      // Attempt to DELETE non-existent users - will produce 404 errors
      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          failOnErrors: 1,
          Operations: [
            { method: 'DELETE', path: '/Users/nonexistent-1' },
            { method: 'DELETE', path: '/Users/nonexistent-2' },
            { method: 'DELETE', path: '/Users/nonexistent-3' },
          ],
        })
        .expect(200);

      // Should have only 1 operation result (stopped after first error)
      expect(res.body.Operations).toHaveLength(1);
      expect(res.body.Operations[0].status).not.toBe('204');
    });

    it('should process all operations when failOnErrors is 0', async () => {
      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          failOnErrors: 0,
          Operations: [
            { method: 'DELETE', path: '/Users/nonexistent-1' },
            { method: 'DELETE', path: '/Users/nonexistent-2' },
            { method: 'POST', path: '/Users', bulkId: 'u1', data: { schemas: [USER_SCHEMA], userName: `bulk-foe0-${Date.now()}@example.com` } },
          ],
        })
        .expect(200);

      // All 3 operations should be processed
      expect(res.body.Operations).toHaveLength(3);
      // Last one should succeed
      expect(res.body.Operations[2].status).toBe('201');
    });
  });

  // ─── Validation ──────────────────────────────────────────────────────

  describe('Request validation', () => {
    it('should reject POST to resource path (path includes ID)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            { method: 'POST', path: '/Users/some-id', bulkId: 'u1', data: { schemas: [USER_SCHEMA], userName: 'bad@example.com' } },
          ],
        })
        .expect(200);

      expect(res.body.Operations[0].status).toBe('400');
      expect(res.body.Operations[0].response.detail).toContain('collection path');
    });

    it('should reject DELETE without resource ID', async () => {
      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            { method: 'DELETE', path: '/Users' },
          ],
        })
        .expect(200);

      expect(res.body.Operations[0].status).toBe('400');
      expect(res.body.Operations[0].response.detail).toContain('specific resource');
    });

    it('should reject unsupported resource type', async () => {
      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            { method: 'POST', path: '/Widgets', bulkId: 'w1', data: { name: 'x' } },
          ],
        })
        .expect(200);

      expect(res.body.Operations[0].status).toBe('400');
      expect(res.body.Operations[0].response.detail).toContain('Unsupported resource type');
    });
  });

  // ─── Mixed operations ────────────────────────────────────────────────

  describe('Mixed operations', () => {
    it('should process mixed user and group operations in a single bulk request', async () => {
      const ts = Date.now();

      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            { method: 'POST', path: '/Users', bulkId: 'u1', data: { schemas: [USER_SCHEMA], userName: `mix-user-${ts}@example.com` } },
            { method: 'POST', path: '/Groups', bulkId: 'g1', data: { schemas: [GROUP_SCHEMA], displayName: `MixGrp-${ts}` } },
            { method: 'PATCH', path: '/Users/bulkId:u1', data: { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', path: 'displayName', value: 'MixedUser' }] } },
          ],
        })
        .expect(200);

      expect(res.body.Operations).toHaveLength(3);
      expect(res.body.Operations[0].status).toBe('201'); // User created
      expect(res.body.Operations[1].status).toBe('201'); // Group created
      expect(res.body.Operations[2].status).toBe('200'); // User patched via bulkId
    });
  });

  // ─── ServiceProviderConfig ───────────────────────────────────────────

  describe('ServiceProviderConfig', () => {
    it('should advertise bulk.supported = true in SPC', async () => {
      const res = await request(app.getHttpServer())
        .get(`${scimBasePath(endpointId)}/ServiceProviderConfig`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.bulk).toBeDefined();
      expect(res.body.bulk.supported).toBe(true);
      expect(res.body.bulk.maxOperations).toBe(1000);
      expect(res.body.bulk.maxPayloadSize).toBe(1048576);
    });
  });

  // ─── Response format ─────────────────────────────────────────────────

  describe('Response format', () => {
    it('should include BulkResponse schema in response', async () => {
      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            { method: 'POST', path: '/Users', bulkId: 'u1', data: { schemas: [USER_SCHEMA], userName: `fmt-${Date.now()}@example.com` } },
          ],
        })
        .expect(200);

      expect(res.body.schemas).toEqual([BULK_RESPONSE_SCHEMA]);
    });

    it('should echo back bulkId for POST operations', async () => {
      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            { method: 'POST', path: '/Users', bulkId: 'my-unique-id', data: { schemas: [USER_SCHEMA], userName: `echo-${Date.now()}@example.com` } },
          ],
        })
        .expect(200);

      expect(res.body.Operations[0].bulkId).toBe('my-unique-id');
    });

    it('should include version (ETag) in successful operation results', async () => {
      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            { method: 'POST', path: '/Users', bulkId: 'u1', data: { schemas: [USER_SCHEMA], userName: `ver-${Date.now()}@example.com` } },
          ],
        })
        .expect(200);

      expect(res.body.Operations[0].version).toBeDefined();
    });

    it('should include SCIM error details in failed operation results', async () => {
      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            { method: 'DELETE', path: '/Users/nonexistent-id-12345' },
          ],
        })
        .expect(200);

      expect(res.body.Operations[0].status).not.toBe('204');
      expect(res.body.Operations[0].response).toBeDefined();
      expect(res.body.Operations[0].response.detail).toBeDefined();
    });
  });

  // ─── Uniqueness collision via Bulk ───────────────────────────────────

  describe('Uniqueness collision', () => {
    it('should return 409 for duplicate userName in bulk operations', async () => {
      const userName = `bulk-dup-${Date.now()}@example.com`;

      const res = await request(app.getHttpServer())
        .post(`${scimBasePath(endpointId)}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [BULK_REQUEST_SCHEMA],
          Operations: [
            { method: 'POST', path: '/Users', bulkId: 'u1', data: { schemas: [USER_SCHEMA], userName } },
            { method: 'POST', path: '/Users', bulkId: 'u2', data: { schemas: [USER_SCHEMA], userName } },
          ],
        })
        .expect(200);

      expect(res.body.Operations[0].status).toBe('201');
      expect(res.body.Operations[1].status).toBe('409');
    });
  });
});
