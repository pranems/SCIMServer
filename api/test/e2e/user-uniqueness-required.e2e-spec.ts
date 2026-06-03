import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimPost,
  scimPut,
  scimPatch,
  createEndpoint,
  scimBasePath,
} from './helpers/request.helper';
import { validUser, patchOp, resetFixtureCounter } from './helpers/fixtures';

/**
 * RFC 7643 §2.2 - uniqueness:server (409) and required:true (400) E2E tests.
 *
 * These tests cover gaps identified in the attribute-characteristics audit:
 * - User PUT 409 when userName conflicts with another user
 * - User PATCH 409 when userName conflicts with another user
 * - PUT 400 when required userName is missing
 * - User PUT allows self-update (same userName, no conflict)
 * - User PATCH allows same userName (no conflict)
 * - User PUT/PATCH allows duplicate externalId (uniqueness:none per RFC 7643)
 */
describe('User Uniqueness & Required Field Enforcement (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // ───────────── uniqueness:server on User PUT ─────────────

  describe('uniqueness:server - User PUT', () => {
    let endpointId: string;
    let basePath: string;
    let user1Id: string;
    let user2Id: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);

      // Create two users with distinct userNames and externalIds
      const res1 = await scimPost(app, `${basePath}/Users`, token, validUser({
        userName: 'uniq-put-user1@test.com',
        externalId: 'ext-put-1',
      })).expect(201);
      user1Id = res1.body.id;

      const res2 = await scimPost(app, `${basePath}/Users`, token, validUser({
        userName: 'uniq-put-user2@test.com',
        externalId: 'ext-put-2',
      })).expect(201);
      user2Id = res2.body.id;
    });

    it('PUT should return 409 when changing userName to existing one', async () => {
      const body = validUser({
        userName: 'uniq-put-user1@test.com', // collides with user1
        externalId: 'ext-put-2',
      });

      const res = await scimPut(app, `${basePath}/Users/${user2Id}`, token, body).expect(409);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('409');
      expect(res.body.scimType).toBe('uniqueness');
    });

    it('PUT should allow duplicate externalId (uniqueness:none per RFC 7643)', async () => {
      const body = validUser({
        userName: 'uniq-put-user2@test.com',
        externalId: 'ext-put-1', // same as user1 - allowed
      });

      const res = await scimPut(app, `${basePath}/Users/${user2Id}`, token, body).expect(200);

      expect(res.body.externalId).toBe('ext-put-1');
    });

    it('PUT should allow self-update with same userName (no conflict)', async () => {
      const body = validUser({
        userName: 'uniq-put-user2@test.com',
        externalId: 'ext-put-2',
        displayName: 'Updated User 2',
      });

      const res = await scimPut(app, `${basePath}/Users/${user2Id}`, token, body).expect(200);

      expect(res.body.displayName).toBe('Updated User 2');
    });

    it('PUT should return 409 case-insensitively (User caseExact:false)', async () => {
      const body = validUser({
        userName: 'UNIQ-PUT-USER1@TEST.COM', // case change still collides
        externalId: 'ext-put-2',
      });

      const res = await scimPut(app, `${basePath}/Users/${user2Id}`, token, body).expect(409);

      expect(res.body.scimType).toBe('uniqueness');
    });
  });

  // ───────────── uniqueness:server on User PATCH ─────────────

  describe('uniqueness:server - User PATCH', () => {
    let endpointId: string;
    let basePath: string;
    let user1Id: string;
    let user2Id: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);

      const res1 = await scimPost(app, `${basePath}/Users`, token, validUser({
        userName: 'uniq-patch-user1@test.com',
        externalId: 'ext-patch-1',
      })).expect(201);
      user1Id = res1.body.id;

      const res2 = await scimPost(app, `${basePath}/Users`, token, validUser({
        userName: 'uniq-patch-user2@test.com',
        externalId: 'ext-patch-2',
      })).expect(201);
      user2Id = res2.body.id;
    });

    it('PATCH should return 409 when changing userName to existing one', async () => {
      const patch = patchOp([
        { op: 'replace', path: 'userName', value: 'uniq-patch-user1@test.com' },
      ]);

      const res = await scimPatch(app, `${basePath}/Users/${user2Id}`, token, patch).expect(409);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('409');
      expect(res.body.scimType).toBe('uniqueness');
    });

    it('PATCH should allow duplicate externalId (uniqueness:none per RFC 7643)', async () => {
      const patch = patchOp([
        { op: 'replace', path: 'externalId', value: 'ext-patch-1' },
      ]);

      const res = await scimPatch(app, `${basePath}/Users/${user2Id}`, token, patch).expect(200);

      expect(res.body.externalId).toBe('ext-patch-1');
    });

    it('PATCH no-path should return 409 when userName collides', async () => {
      const patch = patchOp([
        { op: 'replace', value: { userName: 'uniq-patch-user1@test.com' } },
      ]);

      const res = await scimPatch(app, `${basePath}/Users/${user2Id}`, token, patch).expect(409);

      expect(res.body.scimType).toBe('uniqueness');
    });

    it('PATCH should allow changing mutable fields without uniqueness conflict', async () => {
      const patch = patchOp([
        { op: 'replace', path: 'displayName', value: 'Patched Display Name' },
      ]);

      const res = await scimPatch(app, `${basePath}/Users/${user2Id}`, token, patch).expect(200);

      expect(res.body.displayName).toBe('Patched Display Name');
    });
  });

  // ───────────── uniqueness:none - positive tests (v0.33.0) ─────────────

  describe('uniqueness:none - duplicates allowed (v0.33.0)', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);
    });

    it('POST two Users with same externalId should both succeed (201)', async () => {
      const user1 = validUser({ externalId: 'dup-post-ext' });
      const user2 = validUser({ externalId: 'dup-post-ext' });

      const res1 = await scimPost(app, `${basePath}/Users`, token, user1).expect(201);
      const res2 = await scimPost(app, `${basePath}/Users`, token, user2).expect(201);

      expect(res1.body.externalId).toBe('dup-post-ext');
      expect(res2.body.externalId).toBe('dup-post-ext');
      expect(res1.body.id).not.toBe(res2.body.id);
    });

    it('POST two Users with same displayName should both succeed (201)', async () => {
      const user1 = validUser({ displayName: 'Same Display Name' });
      const user2 = validUser({ displayName: 'Same Display Name' });

      const res1 = await scimPost(app, `${basePath}/Users`, token, user1).expect(201);
      const res2 = await scimPost(app, `${basePath}/Users`, token, user2).expect(201);

      expect(res1.body.displayName).toBe('Same Display Name');
      expect(res2.body.displayName).toBe('Same Display Name');
    });
  });

  // ───────────── Group externalId - duplicates allowed (v0.33.0) ─────────────

  describe('Group externalId - uniqueness:none (v0.33.0)', () => {
    let endpointId: string;
    let basePath: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);
    });

    it('POST two Groups with same externalId should both succeed (201)', async () => {
      const group1 = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: `uniq-grp-1-${Date.now()}`,
        externalId: 'dup-grp-ext',
      };
      const group2 = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: `uniq-grp-2-${Date.now()}`,
        externalId: 'dup-grp-ext',
      };

      const res1 = await scimPost(app, `${basePath}/Groups`, token, group1).expect(201);
      const res2 = await scimPost(app, `${basePath}/Groups`, token, group2).expect(201);

      expect(res1.body.externalId).toBe('dup-grp-ext');
      expect(res2.body.externalId).toBe('dup-grp-ext');
      expect(res1.body.id).not.toBe(res2.body.id);
    });
  });

  // ───────────── required:true on PUT ─────────────

  describe('required:true - PUT enforcement', () => {
    let endpointId: string;
    let basePath: string;
    let userId: string;

    beforeAll(async () => {
      resetFixtureCounter();
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        userName: 'required-put-user@test.com',
      })).expect(201);
      userId = res.body.id;
    });

    it('PUT should return 400 when required userName is missing', async () => {
      // userName is required:true per RFC 7643 §4.1
      const body = {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        displayName: 'No UserName',
        active: true,
      };

      const res = await scimPut(app, `${basePath}/Users/${userId}`, token, body).expect(400);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('400');
    });

    it('PUT should succeed when all required fields are present', async () => {
      const body = validUser({
        userName: 'required-put-user@test.com',
        displayName: 'Valid Full Replace',
      });

      const res = await scimPut(app, `${basePath}/Users/${userId}`, token, body).expect(200);

      expect(res.body.displayName).toBe('Valid Full Replace');
    });
  });
});
