import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimPost, scimGet, scimPatch, scimDelete, scimBasePath } from './helpers/request.helper';
import { resetFixtureCounter } from './helpers/fixtures';

/**
 * Profile-enforcement gaps - E2E (Phase 1, v0.53.3).
 *
 * Verifies that the runtime honors what discovery advertises:
 *  - Gap 1: a user-only endpoint rejects all Group CRUD with 404 noTarget.
 *  - Gaps 2-5: filter/sort/patch/changePassword disabled in SPC are enforced.
 *  - Gap 6: per-endpoint filter.maxResults clamps the page size.
 *  - Gap 10: etag.supported=false omits the ETag header.
 *
 * @see docs/ENDPOINT_PROFILE_ENFORCEMENT_DESIGN.md
 */
const DIAG = 'urn:scimserver:api:messages:2.0:Diagnostics';

async function createUserOnlyEndpoint(app: INestApplication, token: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/scim/admin/endpoints')
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send({ name: `phase1-useronly-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, profilePreset: 'user-only' })
    .expect(201);
  return res.body.id as string;
}

async function patchSpc(app: INestApplication, token: string, endpointId: string, spc: Record<string, unknown>): Promise<void> {
  await request(app.getHttpServer())
    .patch(`/scim/admin/endpoints/${endpointId}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send({ profile: { serviceProviderConfig: spc } })
    .expect(200);
}

describe('Profile-enforcement gaps (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => resetFixtureCounter());

  // ─── Gap 1: resource-type gating on a user-only endpoint ──────────────────

  describe('Gap 1: user-only endpoint rejects Group CRUD', () => {
    let basePath: string;

    beforeAll(async () => {
      const endpointId = await createUserOnlyEndpoint(app, token);
      basePath = scimBasePath(endpointId);
    });

    it('POST /Groups -> 404 noTarget', async () => {
      const res = await scimPost(app, `${basePath}/Groups`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: 'x',
      }).expect(404);
      expect(res.body.scimType).toBe('noTarget');
      expect(res.body[DIAG]?.errorCode).toBe('RESOURCE_TYPE_NOT_SUPPORTED');
    });

    it('GET /Groups -> 404', async () => {
      await scimGet(app, `${basePath}/Groups`, token).expect(404);
    });

    it('GET /Groups/:id -> 404', async () => {
      await scimGet(app, `${basePath}/Groups/nope`, token).expect(404);
    });

    it('PATCH /Groups/:id -> 404', async () => {
      await scimPatch(app, `${basePath}/Groups/nope`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'displayName', value: 'y' }],
      }).expect(404);
    });

    it('DELETE /Groups/:id -> 404', async () => {
      await scimDelete(app, `${basePath}/Groups/nope`, token).expect(404);
    });

    it('User CRUD still works on the same endpoint', async () => {
      const res = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: `u-${Date.now()}@x.io`,
      }).expect(201);
      expect(res.body.id).toBeDefined();
    });
  });

  // ─── EnforceResourceTypes=false: LIST/query relaxes to 200 empty + warning ──

  describe('EnforceResourceTypes=false relaxes Group LIST to 200 empty + warning', () => {
    const WARN = 'urn:scimserver:api:messages:2.0:Warning';
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      endpointId = await createUserOnlyEndpoint(app, token);
      basePath = scimBasePath(endpointId);
      // Flip the endpoint flag off.
      await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ profile: { settings: { EnforceResourceTypes: false } } })
        .expect(200);
    });

    it('GET /Groups -> 200 empty ListResponse + Warning body + X-SCIM-Warning header', async () => {
      const res = await scimGet(app, `${basePath}/Groups`, token).expect(200);
      expect(res.body.totalResults).toBe(0);
      expect(res.body.Resources).toEqual([]);
      expect(res.body.schemas).toContain(WARN);
      expect(res.body[WARN]?.warnings?.[0]?.code).toBe('RESOURCE_TYPE_NOT_SERVED');
      expect(res.body[WARN]?.warnings?.[0]?.resourceType).toBe('Group');
      expect(res.headers['x-scim-warning']).toContain('RESOURCE_TYPE_NOT_SERVED');
    });

    it('GET /Groups?filter=... (Entra Test Connection probe) -> 200 empty', async () => {
      const res = await scimGet(app, `${basePath}/Groups?filter=${encodeURIComponent('displayName eq "nope"')}`, token).expect(200);
      expect(res.body.totalResults).toBe(0);
    });

    it('POST /Groups/.search -> 200 empty ListResponse + warning', async () => {
      const res = await scimPost(app, `${basePath}/Groups/.search`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:SearchRequest'],
      }).expect(200);
      expect(res.body.totalResults).toBe(0);
      expect(res.body[WARN]?.warnings?.[0]?.code).toBe('RESOURCE_TYPE_NOT_SERVED');
    });

    it('GET /Groups/:id (item read) still -> 404 (only LIST/query is relaxed)', async () => {
      const res = await scimGet(app, `${basePath}/Groups/nope`, token).expect(404);
      expect(res.body[DIAG]?.errorCode).toBe('RESOURCE_TYPE_NOT_SUPPORTED');
    });

    it('POST /Groups (create) still -> 404 (writes never relaxed)', async () => {
      await scimPost(app, `${basePath}/Groups`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: 'x',
      }).expect(404);
    });
  });

  // ─── Gaps 2-4: capability gating ──────────────────────────────────────────

  describe('Gaps 2-4: capability gating', () => {
    it('Gap 2: filter.supported=false -> 403 on ?filter=', async () => {
      const endpointId = await createUserOnlyEndpoint(app, token);
      await patchSpc(app, token, endpointId, { filter: { supported: false } });
      const basePath = scimBasePath(endpointId);
      const res = await scimGet(app, `${basePath}/Users?filter=${encodeURIComponent('userName eq "x"')}`, token).expect(403);
      expect(res.body[DIAG]?.errorCode).toBe('CAPABILITY_NOT_SUPPORTED');
    });

    it('Gap 3: sort.supported=false -> 403 on sortBy', async () => {
      const endpointId = await createUserOnlyEndpoint(app, token);
      await patchSpc(app, token, endpointId, { sort: { supported: false } });
      const basePath = scimBasePath(endpointId);
      await scimGet(app, `${basePath}/Users?sortBy=userName`, token).expect(403);
    });

    it('Gap 4: patch.supported=false -> 501 on PATCH', async () => {
      const endpointId = await createUserOnlyEndpoint(app, token);
      const basePath = scimBasePath(endpointId);
      const user = (await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: `p-${Date.now()}@x.io`,
      }).expect(201)).body;
      await patchSpc(app, token, endpointId, { patch: { supported: false } });
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'displayName', value: 'y' }],
      }).expect(501);
      expect(res.body.scimType).toBe('notImplemented');
    });

    it('Gap 5 (not enforced): changePassword.supported=false still allows a PATCH password change', async () => {
      // changePassword.supported is advertised metadata only; password is a
      // writeOnly attribute whose writability is governed by its mutability,
      // not by this flag. Enforcing it would break Entra/Okta password flows.
      const endpointId = await createUserOnlyEndpoint(app, token);
      const basePath = scimBasePath(endpointId);
      const user = (await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: `pw-${Date.now()}@x.io`, password: 'Initial123!',
      }).expect(201)).body;
      await patchSpc(app, token, endpointId, { changePassword: { supported: false } });
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'password', value: 'Changed456!' }],
      }).expect(200);
      // password is stripped from the response (writeOnly)
      expect(res.body.password).toBeUndefined();
    });
  });

  // ─── Gap 6: per-endpoint filter.maxResults ────────────────────────────────

  describe('Gap 6: per-endpoint filter.maxResults clamps page size', () => {
    it('returns at most maxResults items even when count is larger', async () => {
      const endpointId = await createUserOnlyEndpoint(app, token);
      await patchSpc(app, token, endpointId, { filter: { supported: true, maxResults: 2 } });
      const basePath = scimBasePath(endpointId);
      for (let i = 0; i < 4; i++) {
        await scimPost(app, `${basePath}/Users`, token, {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: `mr-${i}-${Date.now()}@x.io`,
        }).expect(201);
      }
      const res = await scimGet(app, `${basePath}/Users?count=100`, token).expect(200);
      expect(res.body.Resources.length).toBeLessThanOrEqual(2);
      expect(res.body.totalResults).toBeGreaterThanOrEqual(4);
    });
  });

  // ─── Gap 10: etag.supported ───────────────────────────────────────────────

  describe('Gap 10: etag.supported=false omits the ETag header', () => {
    it('GET single user has no ETag header when etag.supported=false', async () => {
      const endpointId = await createUserOnlyEndpoint(app, token);
      const basePath = scimBasePath(endpointId);
      const user = (await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: `et-${Date.now()}@x.io`,
      }).expect(201)).body;
      await patchSpc(app, token, endpointId, { etag: { supported: false } });
      const res = await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(200);
      expect(res.headers['etag']).toBeUndefined();
    });

    it('GET single user HAS an ETag header when etag.supported=true (default)', async () => {
      const endpointId = await createUserOnlyEndpoint(app, token);
      const basePath = scimBasePath(endpointId);
      const user = (await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: `et2-${Date.now()}@x.io`,
      }).expect(201)).body;
      const res = await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(200);
      expect(res.headers['etag']).toBeDefined();
    });
  });
});
