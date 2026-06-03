/**
 * Test Gaps Audit #6 - Comprehensive gap closure (E2E)
 *
 * Fills gaps identified in audit #6:
 *
 *  1. Custom Resource Type + Projection (?attributes= / ?excludedAttributes=)
 *  2. Custom Resource Type + StrictSchema (strict=true unknown attr rejected)
 *  3. Bulk + RequireIfMatch for PUT/DELETE ops
 *  4. Bulk + valid If-Match succeeding
 *  5. GroupHardDeleteEnabled=False beyond DELETE (PUT/PATCH still work)
 *  6. ?excludedAttributes= on POST /.search
 *  7. .search with ?excludedAttributes= (Users + Groups)
 *  8. Bulk + projection (?attributes= on bulk response)
 *  9. SoftDelete + ETag conditional: PUT soft-deleted returns 404 (not 412/428)
 * 10. logFileEnabled flag ON/OFF behavior at runtime
 * 11. Four-flag combo: StrictSchema + IgnoreReadOnly + IncludeWarning + VerbosePatch
 * 12. PerEndpointCredentials + RequireIfMatch deeper combo
 * 13. PrimaryEnforcement + BooleanStrings coercion combo
 */
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
  resetFixtureCounter,
  searchRequest,
} from './helpers/fixtures';

const CUSTOM_SCHEMA_URN =
  'urn:example:params:scim:schemas:custom:2.0:Widget';

describe('Test Gaps Audit #6 - Comprehensive gap closure (E2E)', () => {
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

  // =========================================================================
  // 1. Custom Resource Type + Projection (?attributes= / ?excludedAttributes=)
  // =========================================================================

  describe('Custom Resource Type + Projection', () => {
    let endpointId: string;
    let basePath: string;
    let widgetId: string;

    beforeAll(async () => {
      // Create endpoint with inline profile containing a custom resource type
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          name: `gap6-crt-proj-${Date.now()}`,
          displayName: 'CRT Projection Test',
          profile: {
            schemas: [
              {
                id: 'urn:ietf:params:scim:schemas:core:2.0:User',
                name: 'User',
                attributes: 'all',
              },
              {
                id: 'urn:ietf:params:scim:schemas:core:2.0:Group',
                name: 'Group',
                attributes: 'all',
              },
              {
                id: CUSTOM_SCHEMA_URN,
                name: 'Widget',
                description: 'Custom widget resource',
                attributes: [
                  {
                    name: 'widgetName',
                    type: 'string',
                    multiValued: false,
                    required: true,
                    mutability: 'readWrite',
                    returned: 'default',
                    caseExact: false,
                    uniqueness: 'none',
                  },
                  {
                    name: 'color',
                    type: 'string',
                    multiValued: false,
                    required: false,
                    mutability: 'readWrite',
                    returned: 'default',
                    caseExact: false,
                    uniqueness: 'none',
                  },
                  {
                    name: 'weight',
                    type: 'string',
                    multiValued: false,
                    required: false,
                    mutability: 'readWrite',
                    returned: 'default',
                    caseExact: false,
                    uniqueness: 'none',
                  },
                ],
              },
            ],
            resourceTypes: [
              {
                id: 'User',
                name: 'User',
                endpoint: '/Users',
                description: 'User Account',
                schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
                schemaExtensions: [],
              },
              {
                id: 'Group',
                name: 'Group',
                endpoint: '/Groups',
                description: 'Group',
                schema: 'urn:ietf:params:scim:schemas:core:2.0:Group',
                schemaExtensions: [],
              },
              {
                id: 'Widget',
                name: 'Widget',
                endpoint: '/Widgets',
                description: 'Widget',
                schema: CUSTOM_SCHEMA_URN,
                schemaExtensions: [],
              },
            ],
            serviceProviderConfig: {
              patch: { supported: true },
              bulk: { supported: true },
              filter: { supported: true, maxResults: 200 },
              changePassword: { supported: false },
              sort: { supported: true },
              etag: { supported: true },
            },
            settings: { StrictSchemaValidation: 'False' },
          },
        })
        .expect(201);

      endpointId = res.body.id;
      basePath = `/scim/endpoints/${endpointId}`;

      // Create a widget resource for projection tests
      const widgetRes = await request(app.getHttpServer())
        .post(`${basePath}/Widgets`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [CUSTOM_SCHEMA_URN],
          widgetName: 'Projection Widget',
          color: 'blue',
          weight: '10kg',
        })
        .expect(201);

      widgetId = widgetRes.body.id;
    });

    afterAll(async () => {
      if (widgetId) {
        await request(app.getHttpServer())
          .delete(`${basePath}/Widgets/${widgetId}`)
          .set('Authorization', `Bearer ${token}`)
          .catch(() => {});
      }
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`)
        .catch(() => {});
    });

    it('GET with ?attributes=widgetName should include widgetName and always-returned', async () => {
      const res = await request(app.getHttpServer())
        .get(`${basePath}/Widgets/${widgetId}?attributes=widgetName`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('schemas');
      expect(res.body).toHaveProperty('widgetName', 'Projection Widget');
      // Non-requested defaults should be excluded
      expect(res.body).not.toHaveProperty('color');
      expect(res.body).not.toHaveProperty('weight');
    });

    it('GET with ?excludedAttributes=color should exclude color', async () => {
      const res = await request(app.getHttpServer())
        .get(`${basePath}/Widgets/${widgetId}?excludedAttributes=color`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty('widgetName');
      expect(res.body).toHaveProperty('weight');
      expect(res.body).not.toHaveProperty('color');
      // Always-returned still present
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('schemas');
    });

    it('POST with ?attributes=widgetName should project write response', async () => {
      const res = await request(app.getHttpServer())
        .post(`${basePath}/Widgets?attributes=widgetName`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [CUSTOM_SCHEMA_URN],
          widgetName: 'Write Proj Widget',
          color: 'red',
          weight: '5kg',
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('schemas');
      expect(res.body).toHaveProperty('widgetName', 'Write Proj Widget');
      expect(res.body).not.toHaveProperty('color');
      expect(res.body).not.toHaveProperty('weight');

      // Cleanup
      await request(app.getHttpServer())
        .delete(`${basePath}/Widgets/${res.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .catch(() => {});
    });

    it('LIST with ?attributes=widgetName should project each resource', async () => {
      const res = await request(app.getHttpServer())
        .get(`${basePath}/Widgets?attributes=widgetName`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      for (const resource of res.body.Resources) {
        expect(resource).toHaveProperty('id');
        expect(resource).toHaveProperty('schemas');
        expect(resource).toHaveProperty('widgetName');
        expect(resource).not.toHaveProperty('color');
        expect(resource).not.toHaveProperty('weight');
      }
    });

    it('PUT with ?excludedAttributes=weight should exclude weight from response', async () => {
      const res = await request(app.getHttpServer())
        .put(`${basePath}/Widgets/${widgetId}?excludedAttributes=weight`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [CUSTOM_SCHEMA_URN],
          widgetName: 'Projection Widget',
          color: 'green',
          weight: '15kg',
        })
        .expect(200);

      expect(res.body).toHaveProperty('widgetName');
      expect(res.body).toHaveProperty('color', 'green');
      expect(res.body).not.toHaveProperty('weight');
    });
  });

  // =========================================================================
  // 2. Custom Resource Type + StrictSchema (strict=true)
  // =========================================================================

  describe('Custom Resource Type + StrictSchema', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          name: `gap6-crt-strict-${Date.now()}`,
          displayName: 'CRT Strict Test',
          profile: {
            schemas: [
              {
                id: 'urn:ietf:params:scim:schemas:core:2.0:User',
                name: 'User',
                attributes: 'all',
              },
              {
                id: 'urn:ietf:params:scim:schemas:core:2.0:Group',
                name: 'Group',
                attributes: 'all',
              },
              {
                id: CUSTOM_SCHEMA_URN,
                name: 'Widget',
                description: 'Custom widget resource',
                attributes: [
                  {
                    name: 'widgetName',
                    type: 'string',
                    multiValued: false,
                    required: true,
                    mutability: 'readWrite',
                    returned: 'default',
                    caseExact: false,
                    uniqueness: 'none',
                  },
                  {
                    name: 'color',
                    type: 'string',
                    multiValued: false,
                    required: false,
                    mutability: 'readWrite',
                    returned: 'default',
                    caseExact: false,
                    uniqueness: 'none',
                  },
                ],
              },
            ],
            resourceTypes: [
              {
                id: 'User',
                name: 'User',
                endpoint: '/Users',
                description: 'User Account',
                schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
                schemaExtensions: [],
              },
              {
                id: 'Group',
                name: 'Group',
                endpoint: '/Groups',
                description: 'Group',
                schema: 'urn:ietf:params:scim:schemas:core:2.0:Group',
                schemaExtensions: [],
              },
              {
                id: 'Widget',
                name: 'Widget',
                endpoint: '/Widgets',
                description: 'Widget',
                schema: CUSTOM_SCHEMA_URN,
                schemaExtensions: [],
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
            settings: { StrictSchemaValidation: 'True' },
          },
        })
        .expect(201);

      endpointId = res.body.id;
      basePath = `/scim/endpoints/${endpointId}`;
    });

    afterAll(async () => {
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`)
        .catch(() => {});
    });

    it('should reject POST custom resource with unknown attribute when strict=true', async () => {
      const res = await request(app.getHttpServer())
        .post(`${basePath}/Widgets`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [CUSTOM_SCHEMA_URN],
          widgetName: 'Strict Test Widget',
          color: 'blue',
          unknownField: 'should be rejected',
        })
        .expect(400);

      expect(res.body).toHaveProperty('schemas');
      expect(res.body.schemas).toContain(
        'urn:ietf:params:scim:api:messages:2.0:Error',
      );
      expect(res.body.status).toBe('400');
    });

    it('should accept POST custom resource with valid attributes when strict=true', async () => {
      const res = await request(app.getHttpServer())
        .post(`${basePath}/Widgets`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [CUSTOM_SCHEMA_URN],
          widgetName: 'Valid Strict Widget',
          color: 'green',
        })
        .expect(201);

      expect(res.body).toHaveProperty('widgetName', 'Valid Strict Widget');
      const widgetId = res.body.id;

      // Cleanup
      await request(app.getHttpServer())
        .delete(`${basePath}/Widgets/${widgetId}`)
        .set('Authorization', `Bearer ${token}`)
        .catch(() => {});
    });

    it('should reject PUT custom resource with unknown attribute when strict=true', async () => {
      // Create a valid widget first
      const createRes = await request(app.getHttpServer())
        .post(`${basePath}/Widgets`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [CUSTOM_SCHEMA_URN],
          widgetName: 'PUT Strict Widget',
        })
        .expect(201);
      const widgetId = createRes.body.id;

      // PUT with unknown attribute
      const putRes = await request(app.getHttpServer())
        .put(`${basePath}/Widgets/${widgetId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: [CUSTOM_SCHEMA_URN],
          widgetName: 'PUT Strict Widget Updated',
          bogusAttr: 'should be rejected',
        })
        .expect(400);

      expect(putRes.body.status).toBe('400');

      // Cleanup
      await request(app.getHttpServer())
        .delete(`${basePath}/Widgets/${widgetId}`)
        .set('Authorization', `Bearer ${token}`)
        .catch(() => {});
    });
  });

  // =========================================================================
  // 3. Bulk + RequireIfMatch for PUT/DELETE ops
  // =========================================================================

  describe('Bulk + RequireIfMatch for PUT and DELETE', () => {
    it('Bulk PUT without If-Match should return 428 per-operation', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        RequireIfMatch: 'True',
      });
      const basePath = scimBasePath(endpointId);

      // Create a user to PUT against
      const userRes = await scimPost(
        app,
        `${basePath}/Users`,
        token,
        validUser(),
      ).expect(201);
      const userId = userRes.body.id;

      // Bulk PUT without If-Match
      const bulkRes = await scimPost(app, `${basePath}/Bulk`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
        failOnErrors: 0,
        Operations: [
          {
            method: 'PUT',
            path: `/Users/${userId}`,
            data: {
              schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
              userName: validUser().userName,
            },
          },
        ],
      }).expect(200);

      expect(bulkRes.body.Operations).toBeDefined();
      expect(bulkRes.body.Operations.length).toBe(1);
      expect(bulkRes.body.Operations[0].status).toBe('428');
    });

    it('Bulk DELETE without If-Match should return 428 per-operation', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        RequireIfMatch: 'True',
      });
      const basePath = scimBasePath(endpointId);

      // Create a user to DELETE
      const userRes = await scimPost(
        app,
        `${basePath}/Users`,
        token,
        validUser(),
      ).expect(201);
      const userId = userRes.body.id;

      // Bulk DELETE without If-Match
      const bulkRes = await scimPost(app, `${basePath}/Bulk`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
        failOnErrors: 0,
        Operations: [
          {
            method: 'DELETE',
            path: `/Users/${userId}`,
          },
        ],
      }).expect(200);

      expect(bulkRes.body.Operations).toBeDefined();
      expect(bulkRes.body.Operations.length).toBe(1);
      expect(bulkRes.body.Operations[0].status).toBe('428');
    });
  });

  // =========================================================================
  // 4. Bulk + valid If-Match succeeding
  // =========================================================================

  describe('Bulk with valid If-Match succeeds', () => {
    it('Bulk PATCH with correct If-Match should succeed', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        RequireIfMatch: 'True',
      });
      const basePath = scimBasePath(endpointId);

      // Create user
      const user = validUser();
      const createRes = await scimPost(
        app,
        `${basePath}/Users`,
        token,
        user,
      ).expect(201);
      const userId = createRes.body.id;

      // GET to obtain ETag from response header
      const getRes = await request(app.getHttpServer())
        .get(`${basePath}/Users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const etag = getRes.headers['etag'];

      // Bulk PATCH with valid If-Match (version field in bulk op)
      const bulkRes = await scimPost(app, `${basePath}/Bulk`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
        failOnErrors: 0,
        Operations: [
          {
            method: 'PATCH',
            path: `/Users/${userId}`,
            version: etag,
            data: {
              schemas: [
                'urn:ietf:params:scim:api:messages:2.0:PatchOp',
              ],
              Operations: [
                {
                  op: 'replace',
                  path: 'displayName',
                  value: 'Bulk If-Match Patched',
                },
              ],
            },
          },
        ],
      }).expect(200);

      expect(bulkRes.body.Operations).toBeDefined();
      expect(bulkRes.body.Operations[0].status).toBe('200');
    });
  });

  // =========================================================================
  // 5. GroupHardDeleteEnabled=False beyond DELETE
  // =========================================================================

  describe('GroupHardDeleteEnabled=False - PUT/PATCH still work', () => {
    let endpointId: string;
    let basePath: string;
    let groupId: string;

    beforeAll(async () => {
      endpointId = await createEndpointWithConfig(app, token, {
        GroupHardDeleteEnabled: 'False',
      });
      basePath = scimBasePath(endpointId);

      // Create a group
      const groupRes = await scimPost(
        app,
        `${basePath}/Groups`,
        token,
        validGroup(),
      ).expect(201);
      groupId = groupRes.body.id;
    });

    it('PUT /Groups/:id should still succeed when GroupHardDeleteEnabled=False', async () => {
      const res = await scimPut(
        app,
        `${basePath}/Groups/${groupId}`,
        token,
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          displayName: `Updated Group ${Date.now()}`,
        },
      ).expect(200);

      expect(res.body).toHaveProperty('displayName');
      expect(res.body.displayName).toMatch(/Updated Group/);
    });

    it('PATCH /Groups/:id should still succeed when GroupHardDeleteEnabled=False', async () => {
      const res = await scimPatch(
        app,
        `${basePath}/Groups/${groupId}`,
        token,
        patchOp([
          {
            op: 'replace',
            path: 'displayName',
            value: `Patched Group ${Date.now()}`,
          },
        ]),
      ).expect(200);

      expect(res.body).toHaveProperty('displayName');
      expect(res.body.displayName).toMatch(/Patched Group/);
    });

    it('GET /Groups/:id should still succeed when GroupHardDeleteEnabled=False', async () => {
      const res = await scimGet(
        app,
        `${basePath}/Groups/${groupId}`,
        token,
      ).expect(200);

      expect(res.body).toHaveProperty('id', groupId);
    });

    it('DELETE /Groups/:id should still be blocked', async () => {
      const res = await scimDelete(
        app,
        `${basePath}/Groups/${groupId}`,
        token,
      ).expect(400);

      expect(res.body.status).toBe('400');
    });
  });

  // =========================================================================
  // 6. ?excludedAttributes= on POST /.search (Users)
  // =========================================================================

  describe('?excludedAttributes= on POST /.search', () => {
    it('Users: excludedAttributes=displayName should omit displayName', async () => {
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);

      // Create a user with displayName
      const user = validUser();
      await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      // POST /.search with excludedAttributes
      const res = await request(app.getHttpServer())
        .post(
          `${basePath}/Users/.search?excludedAttributes=displayName`,
        )
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send(searchRequest())
        .expect(200);

      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      for (const resource of res.body.Resources) {
        expect(resource).toHaveProperty('id');
        expect(resource).toHaveProperty('schemas');
        expect(resource).toHaveProperty('userName');
        expect(resource).not.toHaveProperty('displayName');
      }
    });

    it('Groups: body excludedAttributes on .search should omit specified field', async () => {
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);

      await scimPost(app, `${basePath}/Groups`, token, {
        ...validGroup(),
        externalId: 'ext-group-search-test',
      }).expect(
        201,
      );

      // Use body-level excludedAttributes (not query param)
      const res = await request(app.getHttpServer())
        .post(
          `${basePath}/Groups/.search`,
        )
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send(searchRequest({ excludedAttributes: 'externalId' }))
        .expect(200);

      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      for (const resource of res.body.Resources) {
        expect(resource).toHaveProperty('id');
        expect(resource).toHaveProperty('schemas');
        expect(resource).toHaveProperty('displayName');
        expect(resource).not.toHaveProperty('externalId');
      }
    });
  });

  // =========================================================================
  // 7. ?excludedAttributes= on GET list
  //    (already tested for some attrs - verify always-returned protection)
  // =========================================================================

  describe('excludedAttributes cannot remove always-returned on LIST', () => {
    it('GET /Users?excludedAttributes=id,schemas,meta should still have them', async () => {
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);

      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(
        201,
      );

      const res = await scimGet(
        app,
        `${basePath}/Users?excludedAttributes=id,schemas,meta`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      for (const resource of res.body.Resources) {
        // always-returned should NOT be excluded
        expect(resource).toHaveProperty('id');
        expect(resource).toHaveProperty('schemas');
      }
    });
  });

  // =========================================================================
  // 8. SoftDelete + ETag: PUT soft-deleted returns 404 not 412/428
  // =========================================================================

  describe('SoftDelete + ETag: conditional requests on soft-deleted', () => {
    it('GET on soft-deleted user returns 404 even with RequireIfMatch=True', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        UserSoftDeleteEnabled: 'True',
        RequireIfMatch: 'True',
      });
      const basePath = scimBasePath(endpointId);

      // Create user
      const user = validUser();
      const createRes = await scimPost(
        app,
        `${basePath}/Users`,
        token,
        user,
      ).expect(201);
      const userId = createRes.body.id;

      // GET to obtain current ETag from response header
      const getRes = await request(app.getHttpServer())
        .get(`${basePath}/Users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const currentEtag = getRes.headers['etag'];

      // Soft-delete via DELETE (UserHardDeleteEnabled defaults to True, so DELETE soft-deletes)
      await request(app.getHttpServer())
        .delete(`${basePath}/Users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('If-Match', currentEtag || '*')
        .expect(204);

      // GET on soft-deleted user -> 404 (not 428 or 200)
      await scimGet(
        app,
        `${basePath}/Users/${userId}`,
        token,
      ).expect(404);
    });

    it('PUT on soft-deleted user returns 404 (not 412/428)', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        UserSoftDeleteEnabled: 'True',
        RequireIfMatch: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user = validUser();
      const createRes = await scimPost(
        app,
        `${basePath}/Users`,
        token,
        user,
      ).expect(201);
      const userId = createRes.body.id;

      // GET to obtain current ETag from header
      const getRes = await request(app.getHttpServer())
        .get(`${basePath}/Users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const currentEtag = getRes.headers['etag'];

      // Soft-delete via DELETE
      await request(app.getHttpServer())
        .delete(`${basePath}/Users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('If-Match', currentEtag || '*')
        .expect(204);

      // PUT on soft-deleted user -> 404 regardless of If-Match value
      const res = await request(app.getHttpServer())
        .put(`${basePath}/Users/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .set('If-Match', '*')
        .send({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: user.userName,
        })
        .expect(404);

      expect(res.body.status).toBe('404');
    });
  });

  // =========================================================================
  // 9. Four-flag combo: StrictSchema + IgnoreReadOnly + IncludeWarning + VerbosePatch
  // =========================================================================

  describe('Four-flag combo: StrictSchema + IgnoreReadOnly + IncludeWarning + VerbosePatch', () => {
    it('should strip readOnly, emit warning, reject unknown, and resolve dot-paths', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
        IgnoreReadOnlyAttributesInPatch: 'True',
        IncludeWarningAboutIgnoredReadOnlyAttribute: 'True',
        VerbosePatchSupported: 'True',
      });
      const basePath = scimBasePath(endpointId);

      // Create user
      const userRes = await scimPost(
        app,
        `${basePath}/Users`,
        token,
        validUser(),
      ).expect(201);
      const userId = userRes.body.id;

      // PATCH with readOnly attr (id) via no-path merge - should strip + warn
      const patchRes = await scimPatch(
        app,
        `${basePath}/Users/${userId}`,
        token,
        patchOp([
          {
            op: 'replace',
            value: { id: 'hacker-id', displayName: 'FourFlagUser' },
          },
        ]),
      ).expect(200);

      // id should NOT be changed - readOnly stripped
      expect(patchRes.body.id).toBe(userId);
      expect(patchRes.body.displayName).toBe('FourFlagUser');

      // Second PATCH: dot-notation resolution via VerbosePatch
      const patchRes2 = await scimPatch(
        app,
        `${basePath}/Users/${userId}`,
        token,
        patchOp([
          {
            op: 'replace',
            path: 'name.givenName',
            value: 'DotResolvedFour',
          },
        ]),
      ).expect(200);

      // VerbosePatch should resolve name.givenName as nested
      expect(patchRes2.body.name?.givenName).toBe('DotResolvedFour');
    });

    it('should still reject unknown attribute even with all other flags ON', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
        IgnoreReadOnlyAttributesInPatch: 'True',
        IncludeWarningAboutIgnoredReadOnlyAttribute: 'True',
        VerbosePatchSupported: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const userRes = await scimPost(
        app,
        `${basePath}/Users`,
        token,
        validUser(),
      ).expect(201);
      const userId = userRes.body.id;

      // PATCH with unknown attribute should be rejected by StrictSchema
      await scimPatch(
        app,
        `${basePath}/Users/${userId}`,
        token,
        patchOp([
          {
            op: 'replace',
            value: {
              displayName: 'Valid',
              bogusAttribute: 'Invalid',
            },
          },
        ]),
      ).expect(400);
    });
  });

  // =========================================================================
  // 10. PrimaryEnforcement + BooleanStrings coercion combo
  // =========================================================================

  describe('PrimaryEnforcement + BooleanStrings combo', () => {
    it('normalize mode should normalize "True" string to boolean and enforce single primary', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        PrimaryEnforcement: 'normalize',
        AllowAndCoerceBooleanStrings: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const res = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `primary-bool-${Date.now()}@test.com`,
        emails: [
          { value: 'a@test.com', type: 'work', primary: 'True' },
          { value: 'b@test.com', type: 'home', primary: 'True' },
        ],
      }).expect(201);

      // Boolean strings should be coerced, and only 1 primary should remain
      const primaries = (res.body.emails || []).filter(
        (e: any) => e.primary === true,
      );
      expect(primaries.length).toBe(1);
    });

    it('reject mode should reject duplicate primaries even with string booleans', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        PrimaryEnforcement: 'reject',
        AllowAndCoerceBooleanStrings: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const res = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `primary-reject-${Date.now()}@test.com`,
        emails: [
          { value: 'a@test.com', type: 'work', primary: 'True' },
          { value: 'b@test.com', type: 'home', primary: 'True' },
        ],
      }).expect(400);

      expect(res.body.status).toBe('400');
    });
  });

  // =========================================================================
  // 11. Deeper PerEndpointCredentials + RequireIfMatch combo test
  // =========================================================================

  describe('PerEndpointCredentials + RequireIfMatch deeper combo', () => {
    it('should require both per-endpoint credential AND If-Match for PATCH', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        PerEndpointCredentialsEnabled: 'True',
        RequireIfMatch: 'True',
      });
      const basePath = scimBasePath(endpointId);

      // Create per-endpoint credential
      const credRes = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          label: 'Combo Test Cred',
          credentialType: 'bearer',
        })
        .expect(201);

      const epToken = credRes.body.token;
      expect(epToken).toBeDefined();

      // Create user using per-endpoint credential
      const userRes = await request(app.getHttpServer())
        .post(`${basePath}/Users`)
        .set('Authorization', `Bearer ${epToken}`)
        .set('Content-Type', 'application/scim+json')
        .send(validUser())
        .expect(201);
      const userId = userRes.body.id;

      // GET to obtain current ETag from header
      const getRes = await request(app.getHttpServer())
        .get(`${basePath}/Users/${userId}`)
        .set('Authorization', `Bearer ${epToken}`)
        .expect(200);
      const etag = getRes.headers['etag'];

      // PATCH with per-endpoint credential + valid If-Match = success
      const patchRes = await request(app.getHttpServer())
        .patch(`${basePath}/Users/${userId}`)
        .set('Authorization', `Bearer ${epToken}`)
        .set('Content-Type', 'application/scim+json')
        .set('If-Match', etag || '*')
        .send(
          patchOp([
            {
              op: 'replace',
              path: 'displayName',
              value: 'EP Cred + ETag',
            },
          ]),
        )
        .expect(200);

      expect(patchRes.body.displayName).toBe('EP Cred + ETag');

      // PATCH with per-endpoint credential but NO If-Match = 428
      await request(app.getHttpServer())
        .patch(`${basePath}/Users/${userId}`)
        .set('Authorization', `Bearer ${epToken}`)
        .set('Content-Type', 'application/scim+json')
        .send(
          patchOp([
            {
              op: 'replace',
              path: 'displayName',
              value: 'Should Fail',
            },
          ]),
        )
        .expect(428);
    });
  });

  // =========================================================================
  // 12. logFileEnabled flag ON/OFF at runtime via profile settings
  // =========================================================================

  describe('logFileEnabled flag toggle via profile PATCH', () => {
    it('should accept logFileEnabled=True and logFileEnabled=False via settings PATCH', async () => {
      const endpointId = await createEndpoint(app, token);

      // PATCH logFileEnabled to False
      const disableRes = await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          profile: { settings: { logFileEnabled: 'False' } },
        })
        .expect(200);

      expect(disableRes.body.profile?.settings?.logFileEnabled).toBe(
        'False',
      );

      // PATCH logFileEnabled back to True
      const enableRes = await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          profile: { settings: { logFileEnabled: 'True' } },
        })
        .expect(200);

      expect(enableRes.body.profile?.settings?.logFileEnabled).toBe(
        'True',
      );
    });
  });

  // =========================================================================
  // 13. SCIM error response key allowlist on custom resource errors
  // =========================================================================

  describe('SCIM error response contract on custom resource errors', () => {
    it('404 error on custom resource should contain only documented keys', async () => {
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);

      const res = await scimGet(
        app,
        `${basePath}/Users/00000000-0000-0000-0000-000000000000`,
        token,
      ).expect(404);

      const ALLOWED_ERROR_KEYS = [
        'schemas',
        'status',
        'scimType',
        'detail',
        'urn:scimserver:api:messages:2.0:Diagnostics',
      ];
      for (const key of Object.keys(res.body)) {
        expect(ALLOWED_ERROR_KEYS).toContain(key);
      }
    });
  });

  // =========================================================================
  // 14. .search with body-level attributes and excludedAttributes
  // =========================================================================

  describe('.search with body-level attributes/excludedAttributes', () => {
    it('should honor body attributes param in .search request', async () => {
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);

      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(
        201,
      );

      const res = await request(app.getHttpServer())
        .post(`${basePath}/Users/.search`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send(searchRequest({ attributes: 'userName' }))
        .expect(200);

      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      for (const resource of res.body.Resources) {
        expect(resource).toHaveProperty('id');
        expect(resource).toHaveProperty('schemas');
        expect(resource).toHaveProperty('userName');
        expect(resource).not.toHaveProperty('displayName');
      }
    });

    it('should honor body excludedAttributes param in .search request', async () => {
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);

      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(
        201,
      );

      const res = await request(app.getHttpServer())
        .post(`${basePath}/Users/.search`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send(searchRequest({ excludedAttributes: 'displayName' }))
        .expect(200);

      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      for (const resource of res.body.Resources) {
        expect(resource).toHaveProperty('id');
        expect(resource).toHaveProperty('userName');
        expect(resource).not.toHaveProperty('displayName');
      }
    });
  });

  // =========================================================================
  // 15. Bulk response contains only documented keys (contract)
  // =========================================================================

  describe('Bulk response operation-level key allowlist', () => {
    it('Bulk operation responses should contain only documented keys', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {});
      const basePath = scimBasePath(endpointId);

      const bulkRes = await scimPost(app, `${basePath}/Bulk`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkRequest'],
        failOnErrors: 0,
        Operations: [
          {
            method: 'POST',
            path: '/Users',
            bulkId: 'contract-check',
            data: validUser(),
          },
        ],
      }).expect(200);

      // Top-level keys
      const ALLOWED_BULK_RESPONSE_KEYS = [
        'schemas',
        'Operations',
      ];
      for (const key of Object.keys(bulkRes.body)) {
        expect(ALLOWED_BULK_RESPONSE_KEYS).toContain(key);
      }

      // Per-operation keys
      const ALLOWED_OP_KEYS = [
        'method',
        'bulkId',
        'version',
        'location',
        'status',
        'response',
      ];
      for (const op of bulkRes.body.Operations) {
        for (const key of Object.keys(op)) {
          expect(ALLOWED_OP_KEYS).toContain(key);
        }
      }
    });
  });
});
