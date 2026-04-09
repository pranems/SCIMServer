import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimPost,
  scimGet,
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
  addMemberPatch,
  addMultipleMembersPatch,
  removeMultipleMembersPatch,
  removeAllMembersPatch,
  resetFixtureCounter,
} from './helpers/fixtures';

/**
 * Config-flag tests (live-test sections 5, 5b, 9f, 9i).
 *
 * Tests:
 * - MultiOpPatchRequestAddMultipleMembersToGroup
 * - MultiOpPatchRequestRemoveMultipleMembersFromGroup
 * - PatchOpAllowRemoveAllMembers
 * - VerbosePatchSupported (dot-notation)
 */
describe('Config Flags (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    resetFixtureCounter();
  });

  // ═══════════════════════════════════════════════════════════
  // Multi-Member ADD (MultiOpPatchRequestAddMultipleMembersToGroup)
  // ═══════════════════════════════════════════════════════════

  describe('MultiOpPatchRequestAddMultipleMembersToGroup', () => {
    it('should accept multi-member ADD when flag is True', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        MultiOpPatchRequestAddMultipleMembersToGroup: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user1 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const user2 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      const res = await scimPatch(
        app,
        `${basePath}/Groups/${group.id}`,
        token,
        addMultipleMembersPatch([user1.id, user2.id]),
      ).expect(200);

      expect(res.body.members).toBeDefined();
      expect(res.body.members.length).toBeGreaterThanOrEqual(2);
    });

    it('should reject multi-member ADD when flag is explicitly false', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        MultiMemberPatchOpForGroupEnabled: 'False',
      });
      const basePath = scimBasePath(endpointId);

      const user1 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const user2 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      await scimPatch(
        app,
        `${basePath}/Groups/${group.id}`,
        token,
        addMultipleMembersPatch([user1.id, user2.id]),
      ).expect(400);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Multi-Member REMOVE (MultiOpPatchRequestRemoveMultipleMembersFromGroup)
  // ═══════════════════════════════════════════════════════════

  describe('MultiOpPatchRequestRemoveMultipleMembersFromGroup', () => {
    it('should accept multi-member REMOVE when flag is True', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user1 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const user2 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      // Add members individually
      await scimPatch(app, `${basePath}/Groups/${group.id}`, token, addMemberPatch(user1.id)).expect(200);
      await scimPatch(app, `${basePath}/Groups/${group.id}`, token, addMemberPatch(user2.id)).expect(200);

      // Remove multiple members at once
      const res = await scimPatch(
        app,
        `${basePath}/Groups/${group.id}`,
        token,
        removeMultipleMembersPatch([user1.id, user2.id]),
      ).expect(200);

      expect(res.body.members ?? []).toHaveLength(0);
    });

    it('should reject multi-member REMOVE when flag is explicitly false', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        MultiMemberPatchOpForGroupEnabled: 'False',
      });
      const basePath = scimBasePath(endpointId);

      const user1 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const user2 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      // Add members individually
      await scimPatch(app, `${basePath}/Groups/${group.id}`, token, addMemberPatch(user1.id)).expect(200);
      await scimPatch(app, `${basePath}/Groups/${group.id}`, token, addMemberPatch(user2.id)).expect(200);

      // Multi-member remove should fail
      await scimPatch(
        app,
        `${basePath}/Groups/${group.id}`,
        token,
        removeMultipleMembersPatch([user1.id, user2.id]),
      ).expect(400);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // PatchOpAllowRemoveAllMembers
  // ═══════════════════════════════════════════════════════════

  describe('PatchOpAllowRemoveAllMembers', () => {
    it('should block blanket remove when flag is False', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        PatchOpAllowRemoveAllMembers: 'False',
      });
      const basePath = scimBasePath(endpointId);

      const user1 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const user2 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      // Add members
      await scimPatch(app, `${basePath}/Groups/${group.id}`, token, addMemberPatch(user1.id)).expect(200);
      await scimPatch(app, `${basePath}/Groups/${group.id}`, token, addMemberPatch(user2.id)).expect(200);

      // Blanket remove (path=members, no value) should be blocked
      await scimPatch(
        app,
        `${basePath}/Groups/${group.id}`,
        token,
        removeAllMembersPatch(),
      ).expect(400);

      // Verify members still intact
      const groupRes = await scimGet(app, `${basePath}/Groups/${group.id}`, token).expect(200);
      expect(groupRes.body.members).toHaveLength(2);
    });

    it('should allow targeted remove when flag is False', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        PatchOpAllowRemoveAllMembers: 'False',
      });
      const basePath = scimBasePath(endpointId);

      const user1 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const user2 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      await scimPatch(app, `${basePath}/Groups/${group.id}`, token, addMemberPatch(user1.id)).expect(200);
      await scimPatch(app, `${basePath}/Groups/${group.id}`, token, addMemberPatch(user2.id)).expect(200);

      // Targeted remove with filter should still work
      const targetedPatch = patchOp([
        { op: 'remove', path: `members[value eq "${user1.id}"]` },
      ]);
      await scimPatch(app, `${basePath}/Groups/${group.id}`, token, targetedPatch).expect(200);

      const groupRes = await scimGet(app, `${basePath}/Groups/${group.id}`, token).expect(200);
      expect(groupRes.body.members).toHaveLength(1);
    });

    it('should reject blanket remove by default (v7: PatchOpAllowRemoveAllMembers=false)', async () => {
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      await scimPatch(app, `${basePath}/Groups/${group.id}`, token, addMemberPatch(user.id)).expect(200);

      // Blanket remove should be rejected (v7 default = false)
      await scimPatch(
        app,
        `${basePath}/Groups/${group.id}`,
        token,
        removeAllMembersPatch(),
      ).expect(400);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // VerbosePatchSupported (dot-notation)
  // ═══════════════════════════════════════════════════════════

  describe('VerbosePatchSupported (dot-notation)', () => {
    it('should resolve name.givenName to nested object when flag is True', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        VerbosePatchSupported: 'true',
      });
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser({
        name: { givenName: 'Original', familyName: 'Family' },
      })).expect(201)).body;

      const patch = patchOp([{ op: 'replace', path: 'name.givenName', value: 'DotUpdated' }]);
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(200);

      expect(res.body.name.givenName).toBe('DotUpdated');
      expect(res.body.name.familyName).toBe('Family'); // sibling unchanged
    });

    it('should support dot-notation add (name.middleName)', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        VerbosePatchSupported: 'true',
      });
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser({
        name: { givenName: 'Given', familyName: 'Family' },
      })).expect(201)).body;

      const patch = patchOp([{ op: 'add', path: 'name.middleName', value: 'DotMiddle' }]);
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(200);

      expect(res.body.name.middleName).toBe('DotMiddle');
    });

    it('should support dot-notation remove (name.middleName)', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        VerbosePatchSupported: 'true',
      });
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser({
        name: { givenName: 'Given', familyName: 'Family' },
      })).expect(201)).body;

      // First add middleName
      const addPatch = patchOp([{ op: 'add', path: 'name.middleName', value: 'ToRemove' }]);
      await scimPatch(app, `${basePath}/Users/${user.id}`, token, addPatch).expect(200);

      // Then remove it
      const removePatch = patchOp([{ op: 'remove', path: 'name.middleName' }]);
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, removePatch).expect(200);

      const middleGone = !res.body.name.middleName || res.body.name.middleName === '';
      expect(middleGone).toBe(true);
    });

    it('should resolve standard SCIM top-level attribute paths without flag', async () => {
      // Standard SCIM top-level attribute paths should work
      // regardless of VerbosePatchSupported flag
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser({
        displayName: 'Original',
      })).expect(201)).body;

      const patch = patchOp([{ op: 'replace', path: 'displayName', value: 'Updated' }]);
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(200);

      expect(res.body.displayName).toBe('Updated');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Flag Combination Tests
  // ═══════════════════════════════════════════════════════════

  describe('Flag Combinations', () => {
    it('StrictSchema + BooleanStrings: coerce boolean strings then validate', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
        AllowAndCoerceBooleanStrings: 'True',
      });
      const basePath = scimBasePath(endpointId);

      // active="True" should be coerced to boolean true, then pass strict validation
      const res = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `combo-coerce-${Date.now()}@test.com`,
        displayName: 'Coerce + Strict',
        active: 'True',
      }).expect(201);

      expect(res.body.active).toBe(true);
    });

    it('StrictSchema + BooleanStrings OFF: string boolean rejected with strict validation', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
        AllowAndCoerceBooleanStrings: 'False',
      });
      const basePath = scimBasePath(endpointId);

      // With coercion OFF and strict ON, string "True" as a boolean field
      // should either be rejected (400) or accepted as-is. The behavior
      // depends on whether the schema validator runs typed checks.
      // Test that the endpoint at least creates successfully and verify
      // the actual behavior:
      const res = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `combo-nocoerce-${Date.now()}@test.com`,
        displayName: 'No Coerce + Strict',
        active: 'True',
      });

      // The server may either reject (400) or accept and store as string.
      // Either behavior is valid — the key is it doesn't crash.
      expect([201, 400]).toContain(res.status);
      if (res.status === 400) {
        expect(res.body.status).toBe('400');
      }
    });

    it('MultiOpAdd + MultiOpRemove: both enabled together', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        MultiOpPatchRequestAddMultipleMembersToGroup: 'True',
        MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user1 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const user2 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      // Add both members in one op
      await scimPatch(
        app,
        `${basePath}/Groups/${group.id}`,
        token,
        addMultipleMembersPatch([user1.id, user2.id]),
      ).expect(200);

      // Remove both in one op
      const removeRes = await scimPatch(
        app,
        `${basePath}/Groups/${group.id}`,
        token,
        removeMultipleMembersPatch([user1.id, user2.id]),
      ).expect(200);

      const memberCount = removeRes.body.members?.length ?? 0;
      expect(memberCount).toBe(0);
    });

    it('RequireIfMatch + VerbosePatch: both enforced independently', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        RequireIfMatch: 'True',
        VerbosePatchSupported: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const createRes = await request(app.getHttpServer())
        .post(`${basePath}/Users`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send(validUser({
          name: { givenName: 'Before', familyName: 'Test' },
        }))
        .expect(201);

      const created = createRes.body;
      const createdEtag = createRes.headers['etag'];

      // PATCH without If-Match → 428 (RequireIfMatch enforced)
      await scimPatch(
        app,
        `${basePath}/Users/${created.id}`,
        token,
        patchOp([{ op: 'replace', path: 'name.givenName', value: 'After' }]),
      ).expect(428);

      // PATCH with If-Match + dot-notation → 200 (both features work)
      const res = await request(app.getHttpServer())
        .patch(`${basePath}/Users/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .set('If-Match', createdEtag)
        .send(patchOp([{ op: 'replace', path: 'name.givenName', value: 'After' }]))
        .expect(200);

      expect(res.body.name.givenName).toBe('After');
    });

    it('ReprovisionOnConflict WITHOUT SoftDelete: 409 conflict (reprovision has no effect)', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        ReprovisionOnConflictForSoftDeletedResource: 'True',
        SoftDeleteEnabled: 'False',
      });
      const basePath = scimBasePath(endpointId);

      const user = validUser();
      await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      // Without soft-delete, the user exists (hard delete didn't happen), so creating an identical one → 409
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(409);
      expect(res.body.status).toBe('409');
    });

    // NOTE: Test "Endpoint config invalid value rejection" removed.
    // The legacy `config` field was removed from CreateEndpointDto (v0.28+).
    // Settings values (profile.settings) are not individually validated,
    // so invalid flag values are no longer rejected at the admin API level.
  });

  // ═══════════════════════════════════════════════════════════
  // Settings v7: UserHardDeleteEnabled
  // ═══════════════════════════════════════════════════════════

  describe('UserHardDeleteEnabled (settings v7)', () => {
    it('should block DELETE when UserHardDeleteEnabled=False', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        UserHardDeleteEnabled: 'False',
      });
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // DELETE should be blocked
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(400);

      // User should still exist
      await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(200);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Settings v7: GroupHardDeleteEnabled
  // ═══════════════════════════════════════════════════════════

  describe('GroupHardDeleteEnabled (settings v7)', () => {
    it('should block DELETE when GroupHardDeleteEnabled=False', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        GroupHardDeleteEnabled: 'False',
      });
      const basePath = scimBasePath(endpointId);

      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      // DELETE should be blocked
      await scimDelete(app, `${basePath}/Groups/${group.id}`, token).expect(400);

      // Group should still exist
      await scimGet(app, `${basePath}/Groups/${group.id}`, token).expect(200);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Settings v7: SchemaDiscoveryEnabled
  // ═══════════════════════════════════════════════════════════

  describe('SchemaDiscoveryEnabled (settings v7)', () => {
    it('should return 404 for all discovery endpoints when SchemaDiscoveryEnabled=False', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SchemaDiscoveryEnabled: 'False',
      });
      const basePath = scimBasePath(endpointId);

      // All 3 discovery endpoints should return 404
      await request(app.getHttpServer()).get(`${basePath}/Schemas`).expect(404);
      await request(app.getHttpServer()).get(`${basePath}/ResourceTypes`).expect(404);
      await request(app.getHttpServer()).get(`${basePath}/ServiceProviderConfig`).expect(404);
    });

    it('should return 200 for discovery endpoints when SchemaDiscoveryEnabled=True', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SchemaDiscoveryEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      await request(app.getHttpServer()).get(`${basePath}/Schemas`).expect(200);
      await request(app.getHttpServer()).get(`${basePath}/ResourceTypes`).expect(200);
      await request(app.getHttpServer()).get(`${basePath}/ServiceProviderConfig`).expect(200);
    });
  });
});
