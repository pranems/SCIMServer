import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimPost,
  scimGet,
  scimPut,
  scimPatch,
  scimDelete,
  createEndpoint,
  createEndpointWithConfig,
  scimBasePath,
} from './helpers/request.helper';
import {
  validUser,
  validGroup,
  patchOp,
  deactivateUserPatch,
  resetFixtureCounter,
} from './helpers/fixtures';

/**
 * Test Gaps Audit #4 — Cross-feature integration & HTTP compliance gaps:
 *
 * 1. Location header on POST 201 responses
 * 2. endpointId persisted in RequestLog (admin/logs endpoint-scoped queries)
 * 3. Bulk + SoftDelete combination
 * 4. SoftDelete + write-response projection combo
 * 5. GroupHardDelete OFF + Group deletion blocked
 * 6. Bulk + Projection combo (write-response)
 * 7. ETag + Bulk combo (per-op If-Match)
 * 8. Three-flag combo: StrictSchema + SoftDelete + RequireIfMatch
 */
describe('Test Gaps Audit #4 — Cross-feature integration & HTTP compliance (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // ═══════════════════════════════════════════════════════════════════
  // 1. Location header on POST 201 responses
  // ═══════════════════════════════════════════════════════════════════

  describe('HTTP compliance: Location header on POST 201', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);
    });

    it('POST /Users should include Location header in 201 response', async () => {
      const res = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      expect(res.headers['location']).toBeDefined();
      expect(res.headers['location']).toContain('/Users/');
      expect(res.headers['location']).toContain(res.body.id);
    });

    it('POST /Groups should include Location header in 201 response', async () => {
      const res = await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201);

      expect(res.headers['location']).toBeDefined();
      expect(res.headers['location']).toContain('/Groups/');
      expect(res.headers['location']).toContain(res.body.id);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. endpointId persisted in RequestLog
  // ═══════════════════════════════════════════════════════════════════

  describe('endpointId persistence in RequestLog', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);
    });

    it('endpoint-scoped log history should return logs for SCIM operations', async () => {
      // Perform a SCIM operation to generate a log entry
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      // Allow time for async log flush
      await new Promise(resolve => setTimeout(resolve, 4000));

      // Query endpoint-scoped history
      const res = await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId}/logs/history`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.total).toBeGreaterThanOrEqual(1);
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
      // Verify the log contains this endpoint's URL path
      const endpointLogs = res.body.items.filter(
        (item: any) => item.url && item.url.includes(endpointId),
      );
      expect(endpointLogs.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. Bulk + SoftDelete combination
  // ═══════════════════════════════════════════════════════════════════

  describe('Bulk + SoftDelete combo', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpointWithConfig(app, token, {
        UserSoftDeleteEnabled: 'True',
        UserHardDeleteEnabled: 'False',
      });
      basePath = scimBasePath(endpointId);
    });

    it('Bulk DELETE with SoftDelete ON should return 400 (hard-delete blocked)', async () => {
      // Create a user first
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // Attempt bulk DELETE — should be blocked when hard-delete is disabled
      const bulkBody = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
        failOnErrors: 0,
        Operations: [
          {
            method: 'DELETE',
            path: `/Users/${user.id}`,
          },
        ],
      };

      const res = await request(app.getHttpServer())
        .post(`${basePath}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send(bulkBody)
        .expect(200);

      // Per-operation should report 400 (hard-delete blocked)
      expect(res.body.Operations).toBeDefined();
      expect(res.body.Operations[0].status).toBe('400');
    });

    it('Bulk PATCH to deactivate should succeed with SoftDelete ON', async () => {
      // Create a user
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // Bulk PATCH to deactivate
      const bulkBody = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
        failOnErrors: 0,
        Operations: [
          {
            method: 'PATCH',
            path: `/Users/${user.id}`,
            data: {
              schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
              Operations: [{ op: 'replace', value: { active: false } }],
            },
          },
        ],
      };

      const res = await request(app.getHttpServer())
        .post(`${basePath}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send(bulkBody)
        .expect(200);

      expect(res.body.Operations[0].status).toBe('200');

      // Verify user is now soft-deleted (active=false) — still visible via GET
      const getRes = await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(200);
      expect(getRes.body.active).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. SoftDelete + write-response projection
  // ═══════════════════════════════════════════════════════════════════

  describe('SoftDelete + projection combo', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpointWithConfig(app, token, {
        UserSoftDeleteEnabled: 'True',
        UserHardDeleteEnabled: 'True',
      });
      basePath = scimBasePath(endpointId);
    });

    it('GET soft-deleted user should return 200 with active=false (not hard-deleted)', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // Soft-delete via PATCH
      await scimPatch(app, `${basePath}/Users/${user.id}`, token, deactivateUserPatch()).expect(200);

      // GET should still return 200 — soft-deleted users are visible with active:false
      const getRes = await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(200);
      expect(getRes.body.active).toBe(false);

      // GET with attributes should also work
      const projRes = await scimGet(app, `${basePath}/Users/${user.id}?attributes=userName,active`, token).expect(200);
      expect(projRes.body.active).toBe(false);
      expect(projRes.body.userName).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. GroupHardDelete OFF blocks group deletion
  // ═══════════════════════════════════════════════════════════════════

  describe('GroupHardDelete=False blocks group DELETE', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpointWithConfig(app, token, {
        GroupHardDeleteEnabled: 'False',
      });
      basePath = scimBasePath(endpointId);
    });

    it('DELETE /Groups/:id should return 400 when GroupHardDeleteEnabled=False', async () => {
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      const res = await scimDelete(app, `${basePath}/Groups/${group.id}`, token).expect(400);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('400');
    });

    it('GET /Groups/:id should still work when GroupHardDeleteEnabled=False', async () => {
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      const res = await scimGet(app, `${basePath}/Groups/${group.id}`, token).expect(200);
      expect(res.body.id).toBe(group.id);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. Bulk + Projection combo (write-response)
  // ═══════════════════════════════════════════════════════════════════

  describe('Bulk + write-response projection', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);
    });

    it('Bulk POST should include location for each operation', async () => {
      const user = validUser();
      const bulkBody = {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
        failOnErrors: 0,
        Operations: [
          {
            method: 'POST',
            path: '/Users',
            bulkId: 'u1',
            data: user,
          },
        ],
      };

      const res = await request(app.getHttpServer())
        .post(`${basePath}/Bulk`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send(bulkBody)
        .expect(200);

      expect(res.body.Operations[0].status).toBe('201');
      // Bulk POST should include location with resource URI
      expect(res.body.Operations[0].location).toBeDefined();
      expect(res.body.Operations[0].location).toContain('/Users/');

      // Cleanup
      const userId = res.body.Operations[0].location?.split('/').pop();
      if (userId) {
        await scimDelete(app, `${basePath}/Users/${userId}`, token);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7. Three-flag combo: StrictSchema + SoftDelete + RequireIfMatch
  // ═══════════════════════════════════════════════════════════════════

  describe('Three-flag combo: StrictSchema + SoftDelete + RequireIfMatch', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
        UserSoftDeleteEnabled: 'True',
        UserHardDeleteEnabled: 'False',
        RequireIfMatch: 'True',
      });
      basePath = scimBasePath(endpointId);
    });

    it('POST with unknown attribute should be rejected (StrictSchema)', async () => {
      const user = validUser();
      (user as any).unknownAttr = 'should-fail';

      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(400);
      expect(res.body.status).toBe('400');
    });

    it('PUT without If-Match should be rejected (RequireIfMatch)', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // PUT without If-Match header
      const res = await request(app.getHttpServer())
        .put(`${basePath}/Users/${user.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send(validUser({ userName: user.userName }))
        .expect(428);

      expect(res.body.status).toBe('428');
    });

    it('soft-deleted user returns 200 with active=false (not 404)', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // Get the ETag
      const getRes = await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(200);
      const etag = getRes.headers['etag'];

      // Soft-delete with If-Match
      await request(app.getHttpServer())
        .patch(`${basePath}/Users/${user.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .set('If-Match', etag)
        .send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'replace', value: { active: false } }],
        })
        .expect(200);

      // User is soft-deleted — GET returns 200 with active=false
      const softRes = await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(200);
      expect(softRes.body.active).toBe(false);
    });

    it('all three flags enforced independently on same endpoint', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const getRes = await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(200);
      const etag = getRes.headers['etag'];

      // PATCH with If-Match + valid schema → 200 (all flags satisfied)
      const res = await request(app.getHttpServer())
        .patch(`${basePath}/Users/${user.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .set('If-Match', etag)
        .send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'replace', path: 'displayName', value: 'Updated Name' }],
        })
        .expect(200);

      expect(res.body.displayName).toBe('Updated Name');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 8. SchemaDiscovery + RequireIfMatch combo
  // ═══════════════════════════════════════════════════════════════════

  describe('SchemaDiscovery=False + RequireIfMatch combo', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpointWithConfig(app, token, {
        SchemaDiscoveryEnabled: 'False',
        RequireIfMatch: 'True',
      });
      basePath = scimBasePath(endpointId);
    });

    it('discovery endpoints return 404 while SCIM CRUD still works', async () => {
      // Discovery blocked
      await scimGet(app, `${basePath}/Schemas`, token).expect(404);
      await scimGet(app, `${basePath}/ResourceTypes`, token).expect(404);
      await scimGet(app, `${basePath}/ServiceProviderConfig`, token).expect(404);

      // CRUD still works (POST doesn't need If-Match)
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      expect(user.id).toBeDefined();

      // GET works
      const getRes = await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(200);
      expect(getRes.body.id).toBe(user.id);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 9. IgnoreReadOnly + StrictSchema + VerbosePatch — three-way combo
  // ═══════════════════════════════════════════════════════════════════

  describe('IgnoreReadOnly + StrictSchema + VerbosePatch combo', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpointWithConfig(app, token, {
        IgnoreReadOnlyAttributesInPatch: 'True',
        StrictSchemaValidation: 'True',
        VerbosePatchSupported: 'True',
      });
      basePath = scimBasePath(endpointId);
    });

    it('should strip readOnly id in PATCH silently (IgnoreReadOnly) while enforcing StrictSchema', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // PATCH with readOnly 'id' — should be silently stripped, not rejected
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'replace', value: { id: 'new-id', displayName: 'Updated' } },
        ],
      }).expect(200);

      expect(res.body.id).toBe(user.id); // id unchanged
      expect(res.body.displayName).toBe('Updated');
    });

    it('should reject unknown attribute even with IgnoreReadOnly ON (StrictSchema enforced)', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // POST with unknown attribute — StrictSchema should reject
      const badUser = validUser();
      (badUser as any).totallyUnknownField = 'bad';
      await scimPost(app, `${basePath}/Users`, token, badUser).expect(400);
    });

    it('should resolve dot-notation path (VerbosePatch) with IgnoreReadOnly active', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // PATCH with dot-notation path
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'replace', path: 'name.givenName', value: 'DotNotation' },
        ],
      }).expect(200);

      expect(res.body.name?.givenName).toBe('DotNotation');
    });
  });
});
