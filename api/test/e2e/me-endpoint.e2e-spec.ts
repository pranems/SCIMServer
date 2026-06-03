import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken, getLegacyToken } from './helpers/auth.helper';
import {
  scimPost,
  scimGet,
  scimPatch,
  scimPut,
  scimDelete,
  createEndpoint,
  scimBasePath,
} from './helpers/request.helper';
import { validUser, resetFixtureCounter } from './helpers/fixtures';

/**
 * /Me Endpoint E2E tests - RFC 7644 §3.11
 *
 * The /Me endpoint is a URI alias for the User resource associated with
 * the currently authenticated subject. The JWT `sub` claim is matched
 * to a User's `userName` to resolve identity.
 *
 * In E2E tests, the OAuth `client_id` = `sub` = 'e2e-client'.
 */
describe('/Me Endpoint (RFC 7644 §3.11) E2E', () => {
  let app: INestApplication;
  let oauthToken: string;
  let endpointId: string;
  let basePath: string;
  let meUserId: string; // SCIM id of the user that matches 'e2e-client'

  beforeAll(async () => {
    app = await createTestApp();
    oauthToken = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    resetFixtureCounter();
    endpointId = await createEndpoint(app, oauthToken);
    basePath = scimBasePath(endpointId);

    // Create a user with userName matching the OAuth sub claim ('e2e-client')
    const res = await scimPost(app, `${basePath}/Users`, oauthToken, {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: 'e2e-client', // Must match JWT sub claim
      displayName: 'Me User',
      active: true,
    }).expect(201);

    meUserId = res.body.id;
  });

  // ─── GET /Me ────────────────────────────────────────────────────

  describe('GET /Me', () => {
    it('should return the user matching the authenticated sub claim', async () => {
      const res = await scimGet(app, `${basePath}/Me`, oauthToken).expect(200);

      expect(res.body.id).toBe(meUserId);
      expect(res.body.userName).toBe('e2e-client');
      expect(res.body.displayName).toBe('Me User');
      expect(res.body.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.resourceType).toBe('User');
    });

    it('should support attributes query parameter', async () => {
      const res = await scimGet(
        app,
        `${basePath}/Me?attributes=userName,displayName`,
        oauthToken,
      ).expect(200);

      expect(res.body.id).toBe(meUserId);
      expect(res.body.userName).toBe('e2e-client');
      expect(res.body.displayName).toBe('Me User');
    });

    it('should return 404 when no user matches the sub claim', async () => {
      // Create a fresh endpoint without a matching user
      const freshEndpointId = await createEndpoint(app, oauthToken);
      const freshBasePath = scimBasePath(freshEndpointId);

      const res = await scimGet(app, `${freshBasePath}/Me`, oauthToken).expect(404);

      expect(res.body.detail).toContain('e2e-client');
    });

    it('should return 404 when using legacy shared-secret auth', async () => {
      const legacyToken = getLegacyToken();
      const res = await scimGet(app, `${basePath}/Me`, legacyToken).expect(404);

      expect(res.body.detail).toContain('OAuth authentication');
    });
  });

  // ─── PATCH /Me ──────────────────────────────────────────────────

  describe('PATCH /Me', () => {
    it('should update the authenticated user via PATCH', async () => {
      const res = await scimPatch(app, `${basePath}/Me`, oauthToken, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'replace', path: 'displayName', value: 'Me Updated' },
        ],
      }).expect(200);

      expect(res.body.id).toBe(meUserId);
      expect(res.body.displayName).toBe('Me Updated');
      expect(res.body.userName).toBe('e2e-client');
    });

    it('should verify PATCH changes persist via GET /Me', async () => {
      await scimPatch(app, `${basePath}/Me`, oauthToken, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'replace', path: 'displayName', value: 'Persistent Update' },
        ],
      }).expect(200);

      const getRes = await scimGet(app, `${basePath}/Me`, oauthToken).expect(200);
      expect(getRes.body.displayName).toBe('Persistent Update');
    });
  });

  // ─── PUT /Me ────────────────────────────────────────────────────

  describe('PUT /Me', () => {
    it('should replace the authenticated user via PUT', async () => {
      const res = await scimPut(app, `${basePath}/Me`, oauthToken, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'e2e-client',
        displayName: 'Replaced User',
        active: true,
      }).expect(200);

      expect(res.body.id).toBe(meUserId);
      expect(res.body.displayName).toBe('Replaced User');
    });
  });

  // ─── DELETE /Me ─────────────────────────────────────────────────

  describe('DELETE /Me', () => {
    it('should delete the authenticated user via DELETE', async () => {
      await scimDelete(app, `${basePath}/Me`, oauthToken).expect(204);

      // Verify the user is gone via direct Users endpoint
      await scimGet(app, `${basePath}/Users/${meUserId}`, oauthToken).expect(404);
    });

    it('should return 404 on subsequent GET /Me after DELETE', async () => {
      await scimDelete(app, `${basePath}/Me`, oauthToken).expect(204);

      // /Me should now return 404 since the user no longer exists
      await scimGet(app, `${basePath}/Me`, oauthToken).expect(404);
    });
  });

  // ─── Cross-validation ──────────────────────────────────────────

  describe('cross-validation with Users endpoint', () => {
    it('should return the same resource as GET /Users/{id}', async () => {
      const meRes = await scimGet(app, `${basePath}/Me`, oauthToken).expect(200);
      const usersRes = await scimGet(
        app,
        `${basePath}/Users/${meUserId}`,
        oauthToken,
      ).expect(200);

      expect(meRes.body.id).toBe(usersRes.body.id);
      expect(meRes.body.userName).toBe(usersRes.body.userName);
      expect(meRes.body.displayName).toBe(usersRes.body.displayName);
    });
  });
});
