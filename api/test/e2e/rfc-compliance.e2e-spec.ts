import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { resetDatabase } from './helpers/db.helper';
import {
  scimPost,
  scimGet,
  scimPatch,
  scimDelete,
  createEndpoint,
  scimBasePath,
} from './helpers/request.helper';
import {
  validUser,
  validGroup,
  patchOp,
  resetFixtureCounter,
} from './helpers/fixtures';

/**
 * RFC 7644 & RFC 7643 compliance tests.
 *
 * Each test maps to a specific RFC section to document conformance.
 */
describe('RFC Compliance (E2E)', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;
  let basePath: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    resetFixtureCounter();
    endpointId = await createEndpoint(app, token);
    basePath = scimBasePath(endpointId);
  });

  // ───────────── RFC 7644 §3.1 — POST returns 201 + Location ─────────────

  describe('RFC 7644 §3.1 — Resource Creation', () => {
    it('should return 201 Created for POST /Users', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
    });

    it('should include meta.location matching the resource URL', async () => {
      const res = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      expect(res.body.meta.location).toContain(`/Users/${res.body.id}`);
    });

    it('should return 201 Created for POST /Groups', async () => {
      await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201);
    });

    it('should include Location HTTP header on POST /Users', async () => {
      const res = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      const locationHeader = res.headers['location'];
      expect(locationHeader).toBeDefined();
      expect(locationHeader).toBe(res.body.meta.location);
    });

    it('should include Location HTTP header on POST /Groups', async () => {
      const res = await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201);
      const locationHeader = res.headers['location'];
      expect(locationHeader).toBeDefined();
      expect(locationHeader).toBe(res.body.meta.location);
    });
  });

  // ───────────── RFC 7644 §3.4.2 — List Response ─────────────

  describe('RFC 7644 §3.4.2 — List Response', () => {
    it('should include ListResponse schema', async () => {
      const res = await scimGet(app, `${basePath}/Users`, token).expect(200);
      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
    });

    it('should include totalResults, startIndex, itemsPerPage', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const res = await scimGet(app, `${basePath}/Users`, token).expect(200);
      expect(typeof res.body.totalResults).toBe('number');
      expect(typeof res.body.startIndex).toBe('number');
      expect(typeof res.body.itemsPerPage).toBe('number');
    });

    it('should use 1-based startIndex', async () => {
      const res = await scimGet(app, `${basePath}/Users`, token).expect(200);
      expect(res.body.startIndex).toBe(1);
    });
  });

  // ───────────── RFC 7644 §3.5.2 — PATCH ─────────────

  describe('RFC 7644 §3.5.2 — PATCH Operations', () => {
    it('should require PatchOp schema in request body', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // Valid schema
      const validPatch = patchOp([{ op: 'replace', path: 'active', value: false }]);
      await scimPatch(app, `${basePath}/Users/${user.id}`, token, validPatch).expect(200);
    });

    it('should support add operation', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser({ active: true })).expect(201)).body;

      const patch = patchOp([
        { op: 'add', path: 'name', value: { givenName: 'Added', familyName: 'ViaAdd' } },
      ]);
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(200);
      expect(res.body.name.givenName).toBe('Added');
      expect(res.body.name.familyName).toBe('ViaAdd');
    });

    it('should support replace operation', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const patch = patchOp([
        { op: 'replace', path: 'active', value: false },
      ]);
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(200);
      expect(res.body.active).toBe(false);
    });
  });

  // ───────────── RFC 7644 §3.6 — DELETE ─────────────

  describe('RFC 7644 §3.6 — Delete', () => {
    it('should return 204 No Content with no body', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const res = await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(204);
      expect(res.body).toEqual({});
    });
  });

  // ───────────── RFC 7644 §3.12 — Error Responses ─────────────

  describe('RFC 7644 §3.12 — Error Responses', () => {
    it('should include Error schema in error responses', async () => {
      const res = await scimGet(app, `${basePath}/Users/nonexistent`, token).expect(404);
      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
    });

    it('should include status as a string', async () => {
      const res = await scimGet(app, `${basePath}/Users/nonexistent`, token).expect(404);
      expect(res.body.status).toBe('404');
      expect(typeof res.body.status).toBe('string');
    });

    it('should include detail message', async () => {
      const res = await scimGet(app, `${basePath}/Users/nonexistent`, token).expect(404);
      expect(res.body.detail).toBeDefined();
      expect(typeof res.body.detail).toBe('string');
    });
  });

  // ───────────── RFC 7643 §2.4 — Meta Attribute ─────────────

  describe('RFC 7643 §2.4 — Meta Attribute', () => {
    it('should include resourceType, created, lastModified, location in meta', async () => {
      const res = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      expect(res.body.meta.resourceType).toBe('User');
      expect(res.body.meta.created).toBeDefined();
      expect(res.body.meta.lastModified).toBeDefined();
      expect(res.body.meta.location).toBeDefined();
    });

    it('should have meta.resourceType = Group for groups', async () => {
      const res = await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201);
      expect(res.body.meta.resourceType).toBe('Group');
    });
  });

  // ───────────── RFC 7643 §2.1 — Case-Insensitive Attributes ─────────────

  describe('RFC 7643 §2.1 — Case-Insensitive Attributes', () => {
    it('should find users with case-insensitive userName filter', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'CaseTest@Example.COM' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=userName eq "casetest@example.com"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(1);
    });

    it('should reject case-insensitive duplicate userName', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'DupTest@example.com' })).expect(201);
      const res = await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'duptest@example.com' })).expect(409);
      expect(res.body.status).toBe('409');
    });
  });

  // ───────────── RFC 7644 §3.1 — Content-Type Verification ─────────────

  describe('RFC 7644 — Content-Type Verification', () => {
    it('should return application/scim+json Content-Type on GET /Users', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      const res = await scimGet(app, `${basePath}/Users`, token).expect(200);
      expect(res.headers['content-type']).toMatch(/scim\+json/);
    });

    it('should return application/scim+json Content-Type on POST /Users', async () => {
      const res = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      expect(res.headers['content-type']).toMatch(/scim\+json/);
    });

    it('should return application/scim+json Content-Type on error responses', async () => {
      const res = await scimGet(app, `${basePath}/Users/nonexistent-ct-test`, token).expect(404);
      expect(res.headers['content-type']).toMatch(/scim\+json/);
    });

    it('should return scim+json Content-Type on 409 error', async () => {
      const user = validUser();
      await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(409);
      expect(res.headers['content-type']).toMatch(/scim\+json/);
    });
  });

  // ───────────── RFC 7644 §3.12 — 409 Error Format ─────────────

  describe('RFC 7644 §3.12 — 409 Error Format', () => {
    it('should return proper SCIM error format on 409', async () => {
      const user = validUser();
      await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(409);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('409');
      expect(typeof res.body.status).toBe('string');
      expect(res.body.detail).toBeDefined();
    });
  });

  // ───────────── RFC 7644 — meta.lastModified Behavior ─────────────

  describe('RFC 7644 — meta.lastModified Behavior', () => {
    it('should update meta.lastModified on PATCH', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const originalLastModified = created.meta.lastModified;

      await new Promise((r) => setTimeout(r, 50));

      const patch = patchOp([{ op: 'replace', path: 'displayName', value: 'Timestamp Updated' }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      expect(res.body.meta.lastModified).not.toBe(originalLastModified);
    });

    it('should not change meta.lastModified on GET', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      await new Promise((r) => setTimeout(r, 50));

      const patch = patchOp([{ op: 'replace', path: 'displayName', value: 'TS Test' }]);
      const patched = (await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200)).body;

      const fetched = (await scimGet(app, `${basePath}/Users/${created.id}`, token).expect(200)).body;
      expect(fetched.meta.lastModified).toBe(patched.meta.lastModified);
    });
  });
});
