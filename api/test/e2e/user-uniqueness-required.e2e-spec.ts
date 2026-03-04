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
 * RFC 7643 §2.2 — uniqueness:server (409) and required:true (400) E2E tests.
 *
 * These tests cover gaps identified in the attribute-characteristics audit:
 * - User PUT 409 when userName/externalId conflicts with another user
 * - User PATCH 409 when userName/externalId conflicts with another user
 * - PUT 400 when required userName is missing
 * - User PUT allows self-update (same userName, no conflict)
 * - User PATCH allows same userName (no conflict)
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

  describe('uniqueness:server — User PUT', () => {
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

    it('PUT should return 409 when changing externalId to existing one', async () => {
      const body = validUser({
        userName: 'uniq-put-user2@test.com',
        externalId: 'ext-put-1', // collides with user1
      });

      const res = await scimPut(app, `${basePath}/Users/${user2Id}`, token, body).expect(409);

      expect(res.body.scimType).toBe('uniqueness');
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

  describe('uniqueness:server — User PATCH', () => {
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

    it('PATCH should return 409 when changing externalId to existing one', async () => {
      const patch = patchOp([
        { op: 'replace', path: 'externalId', value: 'ext-patch-1' },
      ]);

      const res = await scimPatch(app, `${basePath}/Users/${user2Id}`, token, patch).expect(409);

      expect(res.body.scimType).toBe('uniqueness');
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

  // ───────────── required:true on PUT ─────────────

  describe('required:true — PUT enforcement', () => {
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
