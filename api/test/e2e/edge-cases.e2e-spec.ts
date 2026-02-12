import type { INestApplication } from '@nestjs/common';
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
import request from 'supertest';

/**
 * Edge-case and negative tests for robustness verification.
 */
describe('Edge Cases (E2E)', () => {
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

  // ───────────── Malformed Input ─────────────

  describe('Malformed input', () => {
    it('should reject request with missing schemas array', async () => {
      await scimPost(app, `${basePath}/Users`, token, {
        userName: 'noschema@test.com',
      }).expect(400);
    });

    it('should reject request with empty body', async () => {
      await request(app.getHttpServer())
        .post(`${basePath}/Users`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({})
        .expect(400);
    });

    it('should reject user creation without userName', async () => {
      await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      }).expect(400);
    });

    it('should reject group creation without displayName', async () => {
      await scimPost(app, `${basePath}/Groups`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
      }).expect(400);
    });
  });

  // ───────────── Boundary Values ─────────────

  describe('Boundary values', () => {
    it('should handle count=0 gracefully', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const res = await scimGet(app, `${basePath}/Users?count=0`, token).expect(200);
      expect(res.body.totalResults).toBe(1);
      // count=0 should return 0 or few resources but still include totalResults
      expect(res.body.Resources.length).toBeLessThanOrEqual(1);
    });

    it('should handle very large startIndex', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const res = await scimGet(app, `${basePath}/Users?startIndex=99999`, token).expect(200);
      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources).toHaveLength(0);
    });
  });

  // ───────────── Special Characters ─────────────

  describe('Special characters', () => {
    it('should handle unicode in userName', async () => {
      const user = validUser({ userName: 'ünïcödé-üser@example.com' });
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      expect(res.body.userName).toBe('ünïcödé-üser@example.com');
    });

    it('should handle unicode in group displayName', async () => {
      const group = validGroup({ displayName: '日本語グループ 🎉' });
      const res = await scimPost(app, `${basePath}/Groups`, token, group).expect(201);
      expect(res.body.displayName).toBe('日本語グループ 🎉');
    });

    it('should handle special chars in userName', async () => {
      const user = validUser({ userName: "o'brien-st.clair@example.com", name: { givenName: "O'Brien", familyName: 'St. Clair' } });
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      expect(res.body.userName).toBe("o'brien-st.clair@example.com");
      expect(res.body.name.givenName).toBe("O'Brien");
      expect(res.body.name.familyName).toBe('St. Clair');
    });
  });

  // ───────────── Idempotency ─────────────

  describe('Idempotency', () => {
    it('should return 204 on first delete and 404 on second', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(204);
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(404);
    });
  });

  // ───────────── Inactive Endpoint ─────────────

  describe('Inactive endpoint', () => {
    it('should reject SCIM operations on an inactive endpoint', async () => {
      // Create endpoint, then deactivate it via the admin API
      const endpoint2 = await createEndpoint(app, token, 'inactive-ep');

      // Deactivate the endpoint via admin API (PATCH /scim/admin/endpoints/:id)
      await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${endpoint2}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ active: false })
        .expect(200);

      // SCIM operations should now be rejected
      await scimGet(app, `${scimBasePath(endpoint2)}/Users`, token).expect(403);
    });
  });

  // ───────────── Concurrent Uniqueness ─────────────

  describe('Uniqueness enforcement', () => {
    it('should reject duplicate externalId within same endpoint', async () => {
      const user1 = validUser({ externalId: 'dup-ext-id' });
      const user2 = validUser({ externalId: 'dup-ext-id' });

      await scimPost(app, `${basePath}/Users`, token, user1).expect(201);
      await scimPost(app, `${basePath}/Users`, token, user2).expect(409);
    });

    it('should reject case-insensitive duplicate userName', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'DupUser@test.com' })).expect(201);
      await scimPost(app, `${basePath}/Users`, token, validUser({ userName: 'dupuser@test.com' })).expect(409);
    });
  });

  // ───────────── Large Payload ─────────────

  describe('Large payloads', () => {
    it('should handle user with many email addresses', async () => {
      const emails = Array.from({ length: 20 }, (_, i) => ({
        value: `email${i}@example.com`,
        type: i === 0 ? 'work' : 'other',
        primary: i === 0,
      }));

      const user = validUser({ emails });
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      expect(res.body.emails).toHaveLength(20);
    });
  });

  // ───────────── Empty / No-op PATCH ─────────────

  describe('Empty and no-op PATCH operations', () => {
    it('should handle PATCH with empty Operations array', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [],
      });

      // Either 200 (no-op) or 400 (strict) — should not crash
      expect([200, 400]).toContain(res.status);
    });

    it('should succeed silently when removing non-existent attribute', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const patch = patchOp([{ op: 'remove', path: 'nickName' }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);
      expect(res.body.id).toBe(created.id);
    });

    it('should merge with PATCH add and no path (Entra-style)', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const patch = patchOp([
        { op: 'add', value: { displayName: 'Add-No-Path Merged', title: 'Tester' } },
      ]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);
      expect(res.body.displayName).toBe('Add-No-Path Merged');
      expect(res.body.title).toBe('Tester');
    });
  });

  // ───────────── Filter Edge Cases ─────────────

  describe('Filter edge cases', () => {
    it('should return 0 results for filter on non-existent attribute value', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=nickName eq "nonexistent"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(0);
    });
  });

  // ───────────── PascalCase PATCH ops ─────────────

  describe('PascalCase PATCH op values (Entra compatibility)', () => {
    it('should accept Replace (PascalCase) as PATCH op', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const patch = patchOp([{ op: 'Replace', path: 'displayName', value: 'PascalReplaced' }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);
      expect(res.body.displayName).toBe('PascalReplaced');
    });

    it('should accept Add (PascalCase) as PATCH op', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const patch = patchOp([{ op: 'Add', path: 'displayName', value: 'PascalAdded' }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);
      expect(res.body.displayName).toBe('PascalAdded');
    });
  });
});
