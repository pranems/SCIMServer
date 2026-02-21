import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { resetDatabase } from './helpers/db.helper';
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
  patchOp,
  deactivateUserPatch,
  resetFixtureCounter,
} from './helpers/fixtures';

describe('User Lifecycle (E2E)', () => {
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

  // ───────────── CREATE ─────────────

  describe('POST /Users', () => {
    it('should create a user and return 201 with SCIM resource', async () => {
      const user = validUser();
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(res.body.id).toBeDefined();
      expect(res.body.userName).toBe(user.userName);
      expect(res.body.active).toBe(true);
      expect(res.body.name).toBeDefined();
      expect(res.body.name.givenName).toBe('Test');
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.resourceType).toBe('User');
      expect(res.body.meta.created).toBeDefined();
      expect(res.body.meta.lastModified).toBeDefined();
      expect(res.body.meta.location).toContain(`/Users/${res.body.id}`);
    });

    it('should return 409 when userName already exists', async () => {
      const user = validUser();
      await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(409);
      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('409');
    });

    it('should return 400 when schemas array is missing', async () => {
      const user = { userName: 'noschema@example.com' };
      await scimPost(app, `${basePath}/Users`, token, user).expect(400);
    });

    it('should store externalId when provided', async () => {
      const user = validUser({ externalId: 'ext-abc-123' });
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);
      expect(res.body.externalId).toBe('ext-abc-123');
    });

    it('should ignore client-supplied id and assign server-generated id (Issue 16)', async () => {
      const clientSuppliedId = 'a1b2c3d4-e5f6-7890-abcd-1234567890ab';
      const user = validUser({ id: clientSuppliedId });
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      // Server must assign its own id, ignoring the client-supplied value
      expect(res.body.id).toBeDefined();
      expect(res.body.id).not.toBe(clientSuppliedId);

      // meta.location must reference the server-assigned id
      expect(res.body.meta.location).toContain(`/Users/${res.body.id}`);
      expect(res.body.meta.location).not.toContain(clientSuppliedId);
    });

    it('should allow GET by server-assigned id when client supplied a different id', async () => {
      const clientSuppliedId = 'fake-client-id-00000000';
      const user = validUser({ id: clientSuppliedId });
      const created = (await scimPost(app, `${basePath}/Users`, token, user).expect(201)).body;

      // GET by the server-assigned id must succeed
      const res = await scimGet(app, `${basePath}/Users/${created.id}`, token).expect(200);
      expect(res.body.id).toBe(created.id);
      expect(res.body.userName).toBe(created.userName);

      // GET by the client-supplied id must return 404
      await scimGet(app, `${basePath}/Users/${clientSuppliedId}`, token).expect(404);
    });
  });

  // ───────────── READ ─────────────

  describe('GET /Users/:id', () => {
    it('should retrieve a user by id', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const res = await scimGet(app, `${basePath}/Users/${created.id}`, token).expect(200);
      expect(res.body.id).toBe(created.id);
      expect(res.body.userName).toBe(created.userName);
    });

    it('should return 404 for non-existent user', async () => {
      const res = await scimGet(app, `${basePath}/Users/does-not-exist`, token).expect(404);
      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('404');
    });
  });

  // ───────────── LIST ─────────────

  describe('GET /Users', () => {
    it('should return a list response with totalResults', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const res = await scimGet(app, `${basePath}/Users`, token).expect(200);
      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(res.body.totalResults).toBe(2);
      expect(res.body.Resources).toHaveLength(2);
      expect(res.body.startIndex).toBe(1);
      expect(res.body.itemsPerPage).toBeGreaterThanOrEqual(2);
    });

    it('should paginate with startIndex and count', async () => {
      // Create 5 users
      for (let i = 0; i < 5; i++) {
        await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      }

      const res = await scimGet(app, `${basePath}/Users?startIndex=2&count=2`, token).expect(200);
      expect(res.body.totalResults).toBe(5);
      expect(res.body.Resources).toHaveLength(2);
      expect(res.body.startIndex).toBe(2);
    });

    it('should filter by userName eq', async () => {
      const target = validUser({ userName: 'findme@example.com' });
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      await scimPost(app, `${basePath}/Users`, token, target).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=userName eq "findme@example.com"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources[0].userName).toBe('findme@example.com');
    });

    it('should return empty list when no users exist', async () => {
      const res = await scimGet(app, `${basePath}/Users`, token).expect(200);
      expect(res.body.totalResults).toBe(0);
      expect(res.body.Resources).toHaveLength(0);
    });
  });

  // ───────────── REPLACE ─────────────

  describe('PUT /Users/:id', () => {
    it('should replace a user preserving id', async () => {
      const user = validUser();
      const created = (await scimPost(app, `${basePath}/Users`, token, user).expect(201)).body;

      const replacement = validUser({
        userName: created.userName,
        active: false,
        name: { givenName: 'Updated', familyName: 'User' },
      });

      const res = await scimPut(app, `${basePath}/Users/${created.id}`, token, replacement).expect(200);
      expect(res.body.id).toBe(created.id);
      expect(res.body.userName).toBe(created.userName);
      expect(res.body.active).toBe(false);
      expect(res.body.name).toBeDefined();
      expect(res.body.name.givenName).toBe('Updated');
      expect(res.body.name.familyName).toBe('User');
    });

    it('should update lastModified on replace', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // Small delay to ensure timestamp difference
      await new Promise(r => setTimeout(r, 50));

      const replacement = validUser({ userName: created.userName });
      const res = await scimPut(app, `${basePath}/Users/${created.id}`, token, replacement).expect(200);
      expect(new Date(res.body.meta.lastModified).getTime())
        .toBeGreaterThanOrEqual(new Date(created.meta.lastModified).getTime());
    });

    it('should return 404 when replacing non-existent user', async () => {
      const replacement = validUser();
      await scimPut(app, `${basePath}/Users/does-not-exist`, token, replacement).expect(404);
    });

    it('should ignore client-supplied id in PUT body (Issue 16)', async () => {
      const user = validUser();
      const created = (await scimPost(app, `${basePath}/Users`, token, user).expect(201)).body;

      const replacement = validUser({
        userName: created.userName,
        id: 'put-override-attempt',
      });

      const res = await scimPut(app, `${basePath}/Users/${created.id}`, token, replacement).expect(200);

      // id must remain the server-assigned value
      expect(res.body.id).toBe(created.id);
      expect(res.body.id).not.toBe('put-override-attempt');
      expect(res.body.meta.location).toContain(`/Users/${created.id}`);
    });
  });

  // ───────────── PATCH ─────────────

  describe('PATCH /Users/:id', () => {
    it('should replace an attribute', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser({ active: true })).expect(201)).body;
      expect(created.active).toBe(true);

      const patch = patchOp([
        { op: 'replace', path: 'active', value: false },
      ]);

      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);
      expect(res.body.active).toBe(false);
    });

    it('should deactivate a user via PATCH', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      expect(created.active).toBe(true);

      const res = await scimPatch(
        app,
        `${basePath}/Users/${created.id}`,
        token,
        deactivateUserPatch(),
      ).expect(200);

      expect(res.body.active).toBe(false);
    });

    it('should return 404 when patching non-existent user', async () => {
      const patch = patchOp([{ op: 'replace', path: 'active', value: false }]);
      await scimPatch(app, `${basePath}/Users/does-not-exist`, token, patch).expect(404);
    });

    it('should not allow id override via no-path replace PATCH (Issue 16)', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const patch = patchOp([
        { op: 'replace', value: { displayName: 'Patched Name', id: 'attacker-id' } },
      ]);

      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      // id must remain the server-assigned value
      expect(res.body.id).toBe(created.id);
      expect(res.body.id).not.toBe('attacker-id');
      expect(res.body.displayName).toBe('Patched Name');
      expect(res.body.meta.location).toContain(`/Users/${created.id}`);
    });
  });

  // ───────────── DELETE ─────────────

  describe('DELETE /Users/:id', () => {
    it('should delete a user and return 204', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      await scimDelete(app, `${basePath}/Users/${created.id}`, token).expect(204);

      // Verify it's gone
      await scimGet(app, `${basePath}/Users/${created.id}`, token).expect(404);
    });

    it('should return 404 when deleting non-existent user', async () => {
      await scimDelete(app, `${basePath}/Users/does-not-exist`, token).expect(404);
    });

    it('should be idempotent — second delete returns 404', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      await scimDelete(app, `${basePath}/Users/${created.id}`, token).expect(204);
      await scimDelete(app, `${basePath}/Users/${created.id}`, token).expect(404);
    });
  });
});
