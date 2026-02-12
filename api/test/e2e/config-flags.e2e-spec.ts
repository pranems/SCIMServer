import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { resetDatabase } from './helpers/db.helper';
import {
  scimPost,
  scimGet,
  scimPatch,
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
    await resetDatabase(app);
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

    it('should reject multi-member ADD when flag is not set', async () => {
      const endpointId = await createEndpoint(app, token);
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

    it('should reject multi-member REMOVE when flag is not set', async () => {
      const endpointId = await createEndpoint(app, token);
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

    it('should allow blanket remove by default (flag not set)', async () => {
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      await scimPatch(app, `${basePath}/Groups/${group.id}`, token, addMemberPatch(user.id)).expect(200);

      // Blanket remove should succeed (default = allow)
      await scimPatch(
        app,
        `${basePath}/Groups/${group.id}`,
        token,
        removeAllMembersPatch(),
      ).expect(200);

      const groupRes = await scimGet(app, `${basePath}/Groups/${group.id}`, token).expect(200);
      expect(groupRes.body.members ?? []).toHaveLength(0);
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
});
