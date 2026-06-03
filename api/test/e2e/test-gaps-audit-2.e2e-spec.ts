/**
 * E2E Tests - Test Gap Audit #2 (April 2026)
 *
 * Covers gaps identified by the addMissingTests prompt (round 3):
 *
 * 1. Groups uniqueness on PUT/PATCH (displayName + externalId)
 * 2. Case-insensitive uniqueness collision (userName caseExact:false → 409)
 * 3. Missing required field on PUT → 400
 * 4. Immutable field change on PUT → 400 (StrictSchema ON)
 * 5. returned:request behavior (absent by default, present when requested)
 * 6. Bulk + custom resource type path → 400 unsupported
 * 7. PerEndpointCredentials + RequireIfMatch combo
 * 8. readOnly field in PATCH → 400 (StrictSchema ON, IgnoreReadOnly OFF)
 * 9. Invalid ?attributes= value → gracefully handled
 *
 * @see .github/prompts/addMissingTests.prompt.md
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimPost,
  scimPut,
  scimPatch,
  scimGet,
  scimDelete,
  createEndpoint,
  createEndpointWithConfig,
  scimBasePath,
} from './helpers/request.helper';
import {
  validUser,
  validGroup,
  patchOp,
  resetFixtureCounter,
} from './helpers/fixtures';

describe('Test Gap Audit #2 (E2E)', () => {
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
  // 1. Groups uniqueness on PUT and PATCH → 409
  // ═══════════════════════════════════════════════════════════════════

  describe('Groups uniqueness on PUT/PATCH', () => {
    let endpointId: string;
    let basePath: string;
    let groupAId: string;
    let groupBId: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);

      // Create two groups
      const resA = await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201);
      groupAId = resA.body.id;
      const resB = await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201);
      groupBId = resB.body.id;
    });

    afterAll(async () => {
      await scimDelete(app, `${basePath}/Groups/${groupAId}`, token).expect(204);
      await scimDelete(app, `${basePath}/Groups/${groupBId}`, token).expect(204);
    });

    it('PUT should return 409 when changing displayName to existing one', async () => {
      const groupA = (await scimGet(app, `${basePath}/Groups/${groupAId}`, token).expect(200)).body;
      const groupB = (await scimGet(app, `${basePath}/Groups/${groupBId}`, token).expect(200)).body;

      const res = await scimPut(app, `${basePath}/Groups/${groupBId}`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: groupA.displayName, // duplicate
      }).expect(409);

      expect(res.body.scimType).toBe('uniqueness');
      expect(res.body.status).toBe('409');
    });

    it('PATCH should return 409 when changing displayName to existing one', async () => {
      const groupA = (await scimGet(app, `${basePath}/Groups/${groupAId}`, token).expect(200)).body;

      const res = await scimPatch(app, `${basePath}/Groups/${groupBId}`, token,
        patchOp([{ op: 'replace', path: 'displayName', value: groupA.displayName }]),
      ).expect(409);

      expect(res.body.scimType).toBe('uniqueness');
    });

    it('PUT should allow self-update with same displayName (no conflict)', async () => {
      const groupA = (await scimGet(app, `${basePath}/Groups/${groupAId}`, token).expect(200)).body;

      await scimPut(app, `${basePath}/Groups/${groupAId}`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: groupA.displayName, // same name, same resource
      }).expect(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. Case-insensitive uniqueness collision (caseExact:false)
  // ═══════════════════════════════════════════════════════════════════

  describe('Case-insensitive uniqueness collision', () => {
    let endpointId: string;
    let basePath: string;
    let userId: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);

      const res = await scimPost(app, `${basePath}/Users`, token,
        validUser({ userName: 'CaseTest@example.com' }),
      ).expect(201);
      userId = res.body.id;
    });

    afterAll(async () => {
      await scimDelete(app, `${basePath}/Users/${userId}`, token).expect(204);
    });

    it('POST should return 409 for case-different duplicate userName', async () => {
      const res = await scimPost(app, `${basePath}/Users`, token,
        validUser({ userName: 'casetest@EXAMPLE.COM' }),
      ).expect(409);

      expect(res.body.scimType).toBe('uniqueness');
      expect(res.body.status).toBe('409');
    });

    it('PUT should return 409 for case-different duplicate userName on another user', async () => {
      // Create a second user
      const user2 = await scimPost(app, `${basePath}/Users`, token,
        validUser({ userName: 'other-case-user@example.com' }),
      ).expect(201);

      const res = await scimPut(app, `${basePath}/Users/${user2.body.id}`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'CASETEST@example.com', // same as userId but different case
      }).expect(409);

      expect(res.body.scimType).toBe('uniqueness');

      // Cleanup
      await scimDelete(app, `${basePath}/Users/${user2.body.id}`, token).expect(204);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. Missing required field on PUT → 400
  // ═══════════════════════════════════════════════════════════════════

  describe('Missing required field on PUT', () => {
    let endpointId: string;
    let basePath: string;
    let userId: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);

      const res = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      userId = res.body.id;
    });

    afterAll(async () => {
      await scimDelete(app, `${basePath}/Users/${userId}`, token).expect(204);
    });

    it('PUT without userName should return 400', async () => {
      const res = await scimPut(app, `${basePath}/Users/${userId}`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        displayName: 'No Username Given',
        // userName intentionally omitted
      }).expect(400);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('400');
    });

    it('PUT without schemas should return 400', async () => {
      const res = await scimPut(app, `${basePath}/Users/${userId}`, token, {
        userName: 'valid@example.com',
        // schemas intentionally omitted
      }).expect(400);

      expect(res.body.status).toBe('400');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. Immutable field change on PUT → 400 (StrictSchema ON)
  // ═══════════════════════════════════════════════════════════════════

  describe('Immutable field enforcement on PUT', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      resetFixtureCounter();
      // Create an endpoint with inline profile that marks externalId as immutable
      const wk = process.env.JEST_WORKER_ID ?? '0';
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          name: `e2e-immutable-w${wk}-${Date.now()}`,
          profilePreset: 'rfc-standard',
        })
        .expect(201);
      endpointId = res.body.id;
      basePath = scimBasePath(endpointId);

      // Enable StrictSchemaValidation (required for immutability checks)
      await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          profile: {
            settings: { StrictSchemaValidation: 'True' },
            schemas: [
              {
                id: 'urn:ietf:params:scim:schemas:core:2.0:User',
                name: 'User',
                description: 'User Account',
                attributes: [
                  { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite', returned: 'default', uniqueness: 'server', caseExact: false },
                  { name: 'externalId', type: 'string', multiValued: false, required: false, mutability: 'immutable', returned: 'default', uniqueness: 'server', caseExact: true },
                  { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none', caseExact: false },
                  { name: 'active', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
                  { name: 'password', type: 'string', multiValued: false, required: false, mutability: 'writeOnly', returned: 'never', uniqueness: 'none' },
                ],
              },
            ],
            resourceTypes: [
              {
                name: 'User',
                endpoint: '/Users',
                schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
                schemaExtensions: [],
              },
            ],
          },
        })
        .expect(200);
    });

    it('PUT should return 400 when changing immutable externalId', async () => {
      // Create a user with externalId - use bare attrs matching the custom schema
      const user = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `immutable-change-${Date.now()}@example.com`,
        externalId: 'IMMUTABLE-EXT-001',
        displayName: 'Immutable Test User',
        active: true,
      }).expect(201);

      // Try to change externalId via PUT
      const res = await scimPut(app, `${basePath}/Users/${user.body.id}`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: user.body.userName,
        externalId: 'CHANGED-EXT-002', // different from original
        displayName: 'Updated Name',
      }).expect(400);

      expect(res.body.status).toBe('400');
      expect(res.body.scimType).toBe('mutability');

      // Cleanup
      await scimDelete(app, `${basePath}/Users/${user.body.id}`, token).expect(204);
    });

    it('PUT should allow keeping immutable externalId unchanged', async () => {
      const user = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `immutable-keep-${Date.now()}@example.com`,
        externalId: 'KEEP-SAME-001',
        displayName: 'Keep Same Test',
        active: true,
      }).expect(201);

      // PUT with same externalId → should succeed
      await scimPut(app, `${basePath}/Users/${user.body.id}`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: user.body.userName,
        externalId: 'KEEP-SAME-001',
        displayName: 'Updated OK',
      }).expect(200);

      await scimDelete(app, `${basePath}/Users/${user.body.id}`, token).expect(204);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. returned:request behavior
  // ═══════════════════════════════════════════════════════════════════

  describe('returned:request attribute behavior', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      // Create endpoint with inline profile containing returned:request attribute
      const wk = process.env.JEST_WORKER_ID ?? '0';
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          name: `e2e-ret-req-w${wk}-${Date.now()}`,
          profilePreset: 'rfc-standard',
        })
        .expect(201);
      endpointId = res.body.id;
      basePath = scimBasePath(endpointId);

      // Patch to add a custom extension with returned:request attribute
      await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          profile: {
            schemas: [
              {
                id: 'urn:ietf:params:scim:schemas:core:2.0:User',
                name: 'User',
                description: 'User Account',
                attributes: [
                  { name: 'userName', type: 'string', multiValued: false, required: true, mutability: 'readWrite', returned: 'default', uniqueness: 'server', caseExact: false },
                  { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none', caseExact: false },
                  { name: 'active', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none' },
                  { name: 'externalId', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'server', caseExact: true },
                  { name: 'password', type: 'string', multiValued: false, required: false, mutability: 'writeOnly', returned: 'never', uniqueness: 'none' },
                ],
              },
              {
                id: 'urn:test:extension:request',
                name: 'RequestExtension',
                description: 'Extension with returned:request attributes',
                attributes: [
                  { name: 'privateNotes', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'request', uniqueness: 'none', caseExact: true },
                  { name: 'department', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none', caseExact: false },
                ],
              },
            ],
            resourceTypes: [
              {
                name: 'User',
                endpoint: '/Users',
                schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
                schemaExtensions: [
                  { schema: 'urn:test:extension:request', required: false },
                ],
              },
            ],
          },
        })
        .expect(200);
    });

    it('GET should NOT include returned:request attribute by default', async () => {
      const user = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', 'urn:test:extension:request'],
        userName: `ret-req-${Date.now()}@example.com`,
        'urn:test:extension:request': {
          privateNotes: 'secret stuff',
          department: 'Engineering',
        },
      }).expect(201);

      const getRes = await scimGet(app, `${basePath}/Users/${user.body.id}`, token).expect(200);

      // department (returned:default) should be present
      const ext = getRes.body['urn:test:extension:request'];
      if (ext) {
        expect(ext.department).toBe('Engineering');
        // privateNotes (returned:request) should be ABSENT by default
        expect(ext.privateNotes).toBeUndefined();
      }

      await scimDelete(app, `${basePath}/Users/${user.body.id}`, token).expect(204);
    });

    it('GET with ?attributes= should include returned:request attribute when requested', async () => {
      const user = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', 'urn:test:extension:request'],
        userName: `ret-req2-${Date.now()}@example.com`,
        'urn:test:extension:request': {
          privateNotes: 'visible when requested',
          department: 'Sales',
        },
      }).expect(201);

      const getRes = await scimGet(
        app,
        `${basePath}/Users/${user.body.id}?attributes=urn:test:extension:request:privateNotes`,
        token,
      ).expect(200);

      const ext = getRes.body['urn:test:extension:request'];
      expect(ext).toBeDefined();
      expect(ext.privateNotes).toBe('visible when requested');

      await scimDelete(app, `${basePath}/Users/${user.body.id}`, token).expect(204);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 6. Bulk + custom resource type → 400 (unsupported)
  // ═══════════════════════════════════════════════════════════════════

  describe('Bulk with custom resource type path', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      endpointId = await createEndpointWithConfig(app, token, {
        BulkOperationsEnabled: 'True',
        CustomResourceTypesEnabled: 'True',
      });
      basePath = scimBasePath(endpointId);
    });

    it('should return per-op 400 for unsupported resource type in Bulk', async () => {
      const res = await scimPost(app, `${basePath}/Bulk`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
        failOnErrors: 0,
        Operations: [
          {
            method: 'POST',
            path: '/CustomWidgets',
            bulkId: 'cw1',
            data: {
              schemas: ['urn:example:CustomWidget'],
              displayName: 'Test Widget',
            },
          },
        ],
      }).expect(200);

      expect(res.body.Operations).toHaveLength(1);
      expect(res.body.Operations[0].status).toBe('400');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 7. PerEndpointCredentials + RequireIfMatch combo
  // ═══════════════════════════════════════════════════════════════════

  describe('PerEndpointCredentials + RequireIfMatch combo', () => {
    let endpointId: string;
    let basePath: string;
    let credentialSecret: string;

    beforeAll(async () => {
      endpointId = await createEndpointWithConfig(app, token, {
        PerEndpointCredentialsEnabled: 'True',
        RequireIfMatch: 'True',
      });
      basePath = scimBasePath(endpointId);

      // Create a per-endpoint credential
      const credRes = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ label: 'test-cred' })
        .expect(201);
      credentialSecret = credRes.body.token;
    });

    it('should authenticate via per-endpoint credential AND enforce If-Match', async () => {
      // Create a user using per-endpoint credential
      const createRes = await request(app.getHttpServer())
        .post(`${basePath}/Users`)
        .set('Authorization', `Bearer ${credentialSecret}`)
        .set('Content-Type', 'application/scim+json')
        .send(validUser())
        .expect(201);

      const userId = createRes.body.id;
      const etag = createRes.headers['etag'];

      // PUT without If-Match → 428 (RequireIfMatch enforced)
      await request(app.getHttpServer())
        .put(`${basePath}/Users/${userId}`)
        .set('Authorization', `Bearer ${credentialSecret}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: createRes.body.userName,
          displayName: 'No ETag Provided',
        })
        .expect(428);

      // PUT with correct If-Match → 200
      const putRes = await request(app.getHttpServer())
        .put(`${basePath}/Users/${userId}`)
        .set('Authorization', `Bearer ${credentialSecret}`)
        .set('Content-Type', 'application/scim+json')
        .set('If-Match', etag)
        .send({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: createRes.body.userName,
          displayName: 'With ETag Provided',
        })
        .expect(200);

      // Cleanup - DELETE requires If-Match too when RequireIfMatch=ON
      const updatedEtag = putRes.headers['etag'];
      await request(app.getHttpServer())
        .delete(`${basePath}/Users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('If-Match', updatedEtag)
        .expect(204);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 8. readOnly field in PATCH → 400 (StrictSchema ON, IgnoreReadOnly OFF)
  // ═══════════════════════════════════════════════════════════════════

  describe('readOnly field in PATCH body → 400', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
        IgnoreReadOnlyAttributesInPatch: 'False',
      });
      basePath = scimBasePath(endpointId);
    });

    it('PATCH to change readOnly id should return 400', async () => {
      const user = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const res = await scimPatch(app, `${basePath}/Users/${user.body.id}`, token,
        patchOp([{ op: 'replace', path: 'id', value: 'hacked-id' }]),
      ).expect(400);

      expect(res.body.status).toBe('400');

      await scimDelete(app, `${basePath}/Users/${user.body.id}`, token).expect(204);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 9. Invalid ?attributes= value → gracefully handled
  // ═══════════════════════════════════════════════════════════════════

  describe('Invalid ?attributes= edge cases', () => {
    let endpointId: string;
    let basePath: string;
    let userId: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);

      const res = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      userId = res.body.id;
    });

    afterAll(async () => {
      await scimDelete(app, `${basePath}/Users/${userId}`, token).expect(204);
    });

    it('should handle ?attributes=nonExistentField gracefully', async () => {
      const res = await scimGet(app, `${basePath}/Users/${userId}?attributes=nonExistentField`, token).expect(200);

      // id and schemas are always returned regardless
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('schemas');
    });

    it('should handle ?attributes= with special characters gracefully', async () => {
      const res = await scimGet(app, `${basePath}/Users/${userId}?attributes=!!!invalid`, token).expect(200);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('schemas');
    });

    it('should handle ?attributes= with commas only (,,) gracefully', async () => {
      const res = await scimGet(app, `${basePath}/Users/${userId}?attributes=,,`, token).expect(200);

      // Should return at least always-returned fields
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('schemas');
    });
  });
});
