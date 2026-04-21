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
  scimBasePath,
} from './helpers/request.helper';
import {
  validUser,
  validGroup,
  searchRequest,
  resetFixtureCounter,
} from './helpers/fixtures';

/**
 * Test gaps audit #3 — Covers remaining E2E gaps identified in the comprehensive audit:
 *
 * 1. returned:request on LIST with ?attributes= (present when requested)
 * 2. returned:request on .search (absent by default, present when requested)
 * 3. returned:always enforcement on write-response ?excludedAttributes= for PUT/PATCH
 * 4. ETag header on LIST responses
 * 5. returned:request on write-response (POST/PUT/PATCH with ?attributes=)
 */
describe('Test Gaps Audit #3 — Remaining projection & characteristic gaps (E2E)', () => {
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
  // 1. returned:always enforcement on PUT/PATCH write-response
  // ═══════════════════════════════════════════════════════════════════

  describe('returned:always on PUT/PATCH write-response projection', () => {
    let endpointId: string;
    let basePath: string;
    let userId: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'always-ret-write@test.com' })).expect(201)).body;
      userId = user.id;
    });

    it('PUT with ?excludedAttributes=id,schemas,meta should NOT remove always-returned fields', async () => {
      const res = await scimPut(
        app,
        `${basePath}/Users/${userId}?excludedAttributes=id,schemas,meta`,
        token,
        validUser({ userName: 'always-ret-write@test.com', active: true }),
      ).expect(200);

      expect(res.body.id).toBeDefined();
      expect(res.body.schemas).toBeDefined();
      expect(res.body.meta).toBeDefined();
    });

    it('PATCH with ?excludedAttributes=id,schemas,meta should NOT remove always-returned fields', async () => {
      const res = await scimPatch(
        app,
        `${basePath}/Users/${userId}?excludedAttributes=id,schemas,meta`,
        token,
        {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'replace', value: { displayName: 'AlwaysRet PATCH' } }],
        },
      ).expect(200);

      expect(res.body.id).toBeDefined();
      expect(res.body.schemas).toBeDefined();
      expect(res.body.meta).toBeDefined();
    });

    it('PATCH with ?excludedAttributes=displayName should exclude displayName from response', async () => {
      const res = await scimPatch(
        app,
        `${basePath}/Users/${userId}?excludedAttributes=displayName`,
        token,
        {
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'replace', value: { title: 'Excluded Test' } }],
        },
      ).expect(200);

      // displayName should be excluded because it's returned:'default' and excluded by query
      expect(res.body).not.toHaveProperty('displayName');
      // always-returned fields should still be present
      expect(res.body.id).toBeDefined();
      expect(res.body.schemas).toBeDefined();
      expect(res.body.meta).toBeDefined();
      // userName should still be present (not excluded)
      expect(res.body.userName).toBeDefined();
    });

    it('PUT with ?attributes=displayName should include displayName, exclude others', async () => {
      const user = (await scimGet(app, `${basePath}/Users/${userId}`, token).expect(200)).body;
      const putBody = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: user.userName,
        displayName: 'PUT Projected',
        active: true,
      };
      const res = await scimPut(app, `${basePath}/Users/${userId}?attributes=displayName`, token, putBody).expect(200);

      // Requested attribute present
      expect(res.body.displayName).toBe('PUT Projected');
      // Always-returned fields present
      expect(res.body.id).toBeDefined();
      expect(res.body.schemas).toBeDefined();
      expect(res.body.meta).toBeDefined();
      // Non-requested default attributes absent
      expect(res.body).not.toHaveProperty('title');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. ETag headers on LIST and .search responses
  // ═══════════════════════════════════════════════════════════════════

  describe('ETag headers on collection responses', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
    });

    it('GET /Users (LIST) response should include per-resource meta.version', async () => {
      const res = await scimGet(app, `${basePath}/Users`, token).expect(200);

      expect(res.body.Resources).toBeDefined();
      expect(res.body.Resources.length).toBeGreaterThan(0);
      const first = res.body.Resources[0];
      expect(first.meta).toBeDefined();
      expect(first.meta.version).toBeDefined();
      expect(first.meta.version).toMatch(/^W\/"v\d+"/);
    });

    it('POST /.search response should include per-resource meta.version', async () => {
      const res = await scimPost(app, `${basePath}/Users/.search`, token, searchRequest()).expect(200);

      expect(res.body.Resources).toBeDefined();
      expect(res.body.Resources.length).toBeGreaterThan(0);
      const first = res.body.Resources[0];
      expect(first.meta).toBeDefined();
      expect(first.meta.version).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. .search with query-param style ?attributes= (in addition to body)
  // ═══════════════════════════════════════════════════════════════════

  describe('.search with ?attributes= query parameter', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'search-qp@test.com' })).expect(201);
    });

    it('should project with ?attributes= query param on .search URL', async () => {
      const res = await scimPost(
        app,
        `${basePath}/Users/.search?attributes=userName`,
        token,
        searchRequest({ filter: 'userName eq "search-qp@test.com"' }),
      ).expect(200);

      const resource = res.body.Resources[0];
      expect(resource).toBeDefined();
      expect(resource.userName).toBe('search-qp@test.com');
      expect(resource.id).toBeDefined(); // always-returned
      expect(resource.schemas).toBeDefined(); // always-returned
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. returned:request on LIST — present when ?attributes= requests it
  // ═══════════════════════════════════════════════════════════════════

  describe('returned:request on LIST with ?attributes=', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      resetFixtureCounter();
      const wk = process.env.JEST_WORKER_ID ?? '0';
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          name: `e2e-ret-req-list-w${wk}-${Date.now()}`,
          profilePreset: 'rfc-standard',
        })
        .expect(201);
      endpointId = res.body.id;
      basePath = scimBasePath(endpointId);

      // Add extension with returned:request attribute
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
                ],
              },
              {
                id: 'urn:test:returned:request:ext',
                name: 'RequestTest',
                description: 'returned:request test extension',
                attributes: [
                  { name: 'secretNote', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'request', uniqueness: 'none', caseExact: true },
                ],
              },
            ],
            resourceTypes: [
              {
                name: 'User',
                endpoint: '/Users',
                schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
                schemaExtensions: [
                  { schema: 'urn:test:returned:request:ext', required: false },
                ],
              },
            ],
          },
        })
        .expect(200);

      // Create a user with the returned:request extension attribute
      await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', 'urn:test:returned:request:ext'],
        userName: `ret-req-list-${Date.now()}@test.com`,
        'urn:test:returned:request:ext': {
          secretNote: 'my private data',
        },
      }).expect(201);
    });

    it('should NOT include returned:request attribute in default LIST', async () => {
      const res = await scimGet(app, `${basePath}/Users`, token).expect(200);
      expect(res.body.Resources.length).toBeGreaterThan(0);
      const user = res.body.Resources[0];
      const ext = user['urn:test:returned:request:ext'];
      if (ext) {
        expect(ext.secretNote).toBeUndefined();
      }
    });

    it('should include returned:request attribute when requested via ?attributes= on LIST', async () => {
      const res = await scimGet(
        app,
        `${basePath}/Users?attributes=userName,urn:test:returned:request:ext:secretNote`,
        token,
      ).expect(200);
      expect(res.body.Resources.length).toBeGreaterThan(0);
      const user = res.body.Resources[0];
      expect(user.userName).toBeDefined();
      // The extension attribute should now be present
      const ext = user['urn:test:returned:request:ext'];
      expect(ext).toBeDefined();
      expect(ext.secretNote).toBe('my private data');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. Miscellaneous edge cases
  // ═══════════════════════════════════════════════════════════════════

  describe('Edge case projections', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);
    });

    it('empty ?attributes= should return full response', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const res = await scimGet(app, `${basePath}/Users/${user.id}?attributes=`, token).expect(200);
      expect(res.body.userName).toBeDefined();
      expect(res.body.id).toBeDefined();
    });

    it('whitespace in ?attributes= should be trimmed', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const res = await scimGet(app, `${basePath}/Users/${user.id}?attributes=userName%20,%20displayName`, token).expect(200);
      expect(res.body.userName).toBeDefined();
      expect(res.body.id).toBeDefined(); // always-returned
    });
  });
});
