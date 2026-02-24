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
  createEndpointWithConfig,
  scimBasePath,
} from './helpers/request.helper';
import {
  validUser,
  validGroup,
  patchOp,
  addMemberPatch,
  addMultipleMembersPatch,
  removeAllMembersPatch,
  resetFixtureCounter,
} from './helpers/fixtures';

/**
 * Soft Delete, Config Flag Combinations, and PATCH Path Patterns (E2E).
 *
 * Tests:
 * - SoftDeleteEnabled: DELETE sets active=false, GET/LIST returns soft-deleted
 * - Active filter after soft delete: active eq false, active eq true
 * - Re-activation via PATCH active=true after soft delete
 * - PATCH paths on soft-deleted users (valuePath, extension URN, dot-notation)
 * - Config flag combinations (SoftDelete + StrictSchema, SoftDelete + MultiOp, etc.)
 * - StrictSchemaValidation E2E
 */
describe('Soft Delete, Flag Combinations & PATCH Paths (E2E)', () => {
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
  // SoftDeleteEnabled — Users
  // ═══════════════════════════════════════════════════════════

  describe('SoftDeleteEnabled — Users', () => {
    it('should soft-delete user (DELETE returns 204, user still accessible)', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      expect(user.active).toBe(true);

      // DELETE should return 204
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(204);

      // GET should still return the user with active=false
      const getRes = await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(200);
      expect(getRes.body.active).toBe(false);
      expect(getRes.body.id).toBe(user.id);
    });

    it('should hard-delete user when SoftDeleteEnabled is not set (default)', async () => {
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // DELETE should return 204
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(204);

      // GET should return 404 (physically deleted)
      await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(404);
    });

    it('should include soft-deleted users in LIST response', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user1 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const user2 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // Soft-delete user1
      await scimDelete(app, `${basePath}/Users/${user1.id}`, token).expect(204);

      // LIST should return both users
      const listRes = await scimGet(app, `${basePath}/Users`, token).expect(200);
      expect(listRes.body.totalResults).toBe(2);

      const activeStates = listRes.body.Resources.map((r: any) => r.active);
      expect(activeStates).toContain(true);
      expect(activeStates).toContain(false);
    });

    it('should filter soft-deleted users with active eq false', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user1 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      // Soft-delete user1
      await scimDelete(app, `${basePath}/Users/${user1.id}`, token).expect(204);

      // Filter for inactive users
      const res = await scimGet(
        app,
        `${basePath}/Users?filter=active eq false`,
        token,
      ).expect(200);
      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources[0].active).toBe(false);
      expect(res.body.Resources[0].id).toBe(user1.id);
    });

    it('should filter active-only users with active eq true', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user1 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const user2 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // Soft-delete user1
      await scimDelete(app, `${basePath}/Users/${user1.id}`, token).expect(204);

      // Filter for active users only
      const res = await scimGet(
        app,
        `${basePath}/Users?filter=active eq true`,
        token,
      ).expect(200);
      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources[0].active).toBe(true);
      expect(res.body.Resources[0].id).toBe(user2.id);
    });

    it('should re-activate soft-deleted user via PATCH active=true', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // Soft-delete
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(204);
      const deleted = (await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(200)).body;
      expect(deleted.active).toBe(false);

      // Re-activate via PATCH
      const patch = patchOp([{ op: 'replace', path: 'active', value: true }]);
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(200);
      expect(res.body.active).toBe(true);

      // Verify via GET
      const reget = (await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(200)).body;
      expect(reget.active).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // SoftDeleteEnabled — Groups
  // ═══════════════════════════════════════════════════════════

  describe('SoftDeleteEnabled — Groups', () => {
    it('should soft-delete group (DELETE returns 204, group still accessible)', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      // DELETE
      await scimDelete(app, `${basePath}/Groups/${group.id}`, token).expect(204);

      // GET should still return the group
      const getRes = await scimGet(app, `${basePath}/Groups/${group.id}`, token).expect(200);
      expect(getRes.body.displayName).toBe(group.displayName);
    });

    it('should hard-delete group when SoftDeleteEnabled is not set', async () => {
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);

      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      await scimDelete(app, `${basePath}/Groups/${group.id}`, token).expect(204);
      await scimGet(app, `${basePath}/Groups/${group.id}`, token).expect(404);
    });

    it('should include soft-deleted groups in LIST', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const g1 = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;
      await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201);

      // Soft-delete g1
      await scimDelete(app, `${basePath}/Groups/${g1.id}`, token).expect(204);

      // LIST returns both
      const listRes = await scimGet(app, `${basePath}/Groups`, token).expect(200);
      expect(listRes.body.totalResults).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // PATCH on soft-deleted users (various paths)
  // ═══════════════════════════════════════════════════════════

  describe('PATCH on soft-deleted users', () => {
    it('should PATCH displayName on soft-deleted user', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(204);

      // PATCH displayName on inactive user
      const patch = patchOp([{ op: 'replace', path: 'displayName', value: 'Inactive Updated' }]);
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(200);
      expect(res.body.displayName).toBe('Inactive Updated');
      expect(res.body.active).toBe(false); // still inactive
    });

    it('should PATCH valuePath emails on soft-deleted user', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser({
        emails: [{ value: 'original@work.com', type: 'work', primary: true }],
      })).expect(201)).body;

      // Soft-delete
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(204);

      // PATCH email via valuePath on inactive user
      const patch = patchOp([{
        op: 'replace',
        path: 'emails[type eq "work"].value',
        value: 'patched@work.com',
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(200);
      expect(res.body.active).toBe(false);
      const workEmail = res.body.emails?.find((e: any) => e.type === 'work');
      expect(workEmail?.value).toBe('patched@work.com');
    });

    it('should PATCH extension URN on soft-deleted user', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);
      const ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE],
        [ENTERPRISE]: { department: 'Engineering' },
      })).expect(201)).body;

      // Soft-delete
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(204);

      // PATCH extension attribute on inactive user
      const patch = patchOp([{
        op: 'replace',
        path: `${ENTERPRISE}:department`,
        value: 'Sales',
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(200);
      expect(res.body.active).toBe(false);
      expect(res.body[ENTERPRISE]?.department).toBe('Sales');
    });

    it('should PATCH dot-notation on soft-deleted user (VerbosePatch)', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
        VerbosePatchSupported: 'true',
      });
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser({
        name: { givenName: 'OldGiven', familyName: 'Family' },
      })).expect(201)).body;

      // Soft-delete
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(204);

      // PATCH name.givenName with dot-notation
      const patch = patchOp([{ op: 'replace', path: 'name.givenName', value: 'NewGiven' }]);
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(200);
      expect(res.body.active).toBe(false);
      expect(res.body.name.givenName).toBe('NewGiven');
      expect(res.body.name.familyName).toBe('Family');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Config flag combinations
  // ═══════════════════════════════════════════════════════════

  describe('Config flag combinations', () => {
    it('SoftDeleteEnabled + StrictSchemaValidation: soft delete works, unknown extension rejected', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
        StrictSchemaValidation: 'True',
      });
      const basePath = scimBasePath(endpointId);

      // Create user with valid schema
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // Soft-delete works
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(204);
      const getRes = await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(200);
      expect(getRes.body.active).toBe(false);

      // Creating user with unknown extension should fail (strict schema)
      await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', 'urn:unknown:fake:1.0:User'],
        'urn:unknown:fake:1.0:User': { custom: 'data' },
      } as any)).expect(400);
    });

    it('SoftDeleteEnabled + MultiOpPatch: soft delete + multi-member add', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
        MultiOpPatchRequestAddMultipleMembersToGroup: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user1 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const user2 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      // Multi-member add works
      const res = await scimPatch(
        app,
        `${basePath}/Groups/${group.id}`,
        token,
        addMultipleMembersPatch([user1.id, user2.id]),
      ).expect(200);
      expect(res.body.members.length).toBeGreaterThanOrEqual(2);

      // Soft-delete the group
      await scimDelete(app, `${basePath}/Groups/${group.id}`, token).expect(204);
      const getG = (await scimGet(app, `${basePath}/Groups/${group.id}`, token).expect(200)).body;
      expect(getG.displayName).toBe(group.displayName);
    });

    it('SoftDeleteEnabled=False + StrictSchemaValidation=True: hard delete + strict schema', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'False',
        StrictSchemaValidation: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // Hard delete
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(204);
      await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(404);

      // Strict schema still enforced
      await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', 'urn:unknown:bad:1.0'],
        'urn:unknown:bad:1.0': { x: 1 },
      } as any)).expect(400);
    });

    it('SoftDeleteEnabled + VerbosePatch + RemoveAllMembers=False: all three flags', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
        VerbosePatchSupported: 'true',
        PatchOpAllowRemoveAllMembers: 'False',
      });
      const basePath = scimBasePath(endpointId);

      // Verbose patch works
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser({
        name: { givenName: 'Combo', familyName: 'Test' },
      })).expect(201)).body;
      const dotPatch = patchOp([{ op: 'replace', path: 'name.givenName', value: 'ComboUpdated' }]);
      const patchRes = await scimPatch(app, `${basePath}/Users/${user.id}`, token, dotPatch).expect(200);
      expect(patchRes.body.name.givenName).toBe('ComboUpdated');

      // Remove-all-members blocked
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;
      await scimPatch(app, `${basePath}/Groups/${group.id}`, token, addMemberPatch(user.id)).expect(200);
      await scimPatch(app, `${basePath}/Groups/${group.id}`, token, removeAllMembersPatch()).expect(400);

      // Soft-delete works
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(204);
      const getRes = await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(200);
      expect(getRes.body.active).toBe(false);
    });

    it('All flags enabled: SoftDelete + Strict + Verbose + MultiOp + RemoveAll', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
        StrictSchemaValidation: 'True',
        VerbosePatchSupported: 'true',
        MultiOpPatchRequestAddMultipleMembersToGroup: 'True',
        MultiOpPatchRequestRemoveMultipleMembersFromGroup: 'True',
        PatchOpAllowRemoveAllMembers: 'True',
      });
      const basePath = scimBasePath(endpointId);

      // Create users and group
      const user1 = (await scimPost(app, `${basePath}/Users`, token, validUser({
        name: { givenName: 'All', familyName: 'Flags' },
      })).expect(201)).body;
      const user2 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      // Multi-member add
      const addRes = await scimPatch(
        app,
        `${basePath}/Groups/${group.id}`,
        token,
        addMultipleMembersPatch([user1.id, user2.id]),
      ).expect(200);
      expect(addRes.body.members.length).toBeGreaterThanOrEqual(2);

      // Verbose PATCH
      const dotPatch = patchOp([{ op: 'replace', path: 'name.givenName', value: 'AllFlags' }]);
      const pRes = await scimPatch(app, `${basePath}/Users/${user1.id}`, token, dotPatch).expect(200);
      expect(pRes.body.name.givenName).toBe('AllFlags');

      // Remove-all members allowed
      await scimPatch(app, `${basePath}/Groups/${group.id}`, token, removeAllMembersPatch()).expect(200);

      // Soft-delete user
      await scimDelete(app, `${basePath}/Users/${user1.id}`, token).expect(204);
      const getUser = (await scimGet(app, `${basePath}/Users/${user1.id}`, token).expect(200)).body;
      expect(getUser.active).toBe(false);

      // Unknown extension rejected (strict schema)
      await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', 'urn:bogus:ext:1.0'],
        'urn:bogus:ext:1.0': { data: true },
      } as any)).expect(400);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // StrictSchemaValidation E2E
  // ═══════════════════════════════════════════════════════════

  describe('StrictSchemaValidation', () => {
    it('should reject user creation with unknown extension URN', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', 'urn:fake:schema:1.0:User'],
        'urn:fake:schema:1.0:User': { custom: 'data' },
      } as any)).expect(400);

      expect(res.body.detail).toBeDefined();
    });

    it('should allow user creation with known Enterprise extension (strict mode)', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
      });
      const basePath = scimBasePath(endpointId);
      const ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE],
        [ENTERPRISE]: { department: 'Engineering', employeeNumber: '12345' },
      })).expect(201);

      expect(res.body[ENTERPRISE]?.department).toBe('Engineering');
    });

    it('should allow user creation without strict schema (unknown extension accepted)', async () => {
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', 'urn:custom:anything:1.0'],
        'urn:custom:anything:1.0': { whatever: true },
      } as any)).expect(201);

      expect(res.body['urn:custom:anything:1.0']?.whatever).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Additional PATCH path patterns (valuePath, filter combos)
  // ═══════════════════════════════════════════════════════════

  describe('PATCH path patterns', () => {
    it('should replace phoneNumber via valuePath', async () => {
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser({
        phoneNumbers: [
          { type: 'work', value: '+1-555-0100' },
          { type: 'mobile', value: '+1-555-0200' },
        ],
      } as any)).expect(201)).body;

      const patch = patchOp([{
        op: 'replace',
        path: 'phoneNumbers[type eq "work"].value',
        value: '+1-555-9999',
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(200);

      const workPhone = res.body.phoneNumbers?.find((p: any) => p.type === 'work');
      expect(workPhone?.value).toBe('+1-555-9999');
      const mobilePhone = res.body.phoneNumbers?.find((p: any) => p.type === 'mobile');
      expect(mobilePhone?.value).toBe('+1-555-0200'); // unchanged
    });

    it('should add new phone type via valuePath', async () => {
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser({
        phoneNumbers: [{ type: 'work', value: '+1-555-0100' }],
      } as any)).expect(201)).body;

      const patch = patchOp([{
        op: 'add',
        path: 'phoneNumbers[type eq "mobile"].value',
        value: '+1-555-0299',
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(200);

      const phones = res.body.phoneNumbers as any[];
      expect(phones.some((p: any) => p.type === 'mobile' && p.value === '+1-555-0299')).toBe(true);
    });

    it('should remove address via valuePath', async () => {
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser({
        addresses: [
          { type: 'work', streetAddress: '100 Main St' },
          { type: 'home', streetAddress: '200 Elm St' },
        ],
      } as any)).expect(201)).body;

      const patch = patchOp([{
        op: 'remove',
        path: 'addresses[type eq "home"]',
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(200);

      const addr = res.body.addresses as any[];
      expect(addr.some((a: any) => a.type === 'home')).toBe(false);
      expect(addr.some((a: any) => a.type === 'work')).toBe(true);
    });

    it('should chain valuePath + extension URN + no-path merge in single PATCH', async () => {
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);
      const ENTERPRISE = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENTERPRISE],
        emails: [{ value: 'chain@work.com', type: 'work', primary: true }],
        [ENTERPRISE]: { department: 'OldDept' },
      })).expect(201)).body;

      const patch = patchOp([
        { op: 'replace', path: 'emails[type eq "work"].value', value: 'chain-updated@work.com' },
        { op: 'replace', path: `${ENTERPRISE}:department`, value: 'NewDept' },
        { op: 'replace', value: { displayName: 'ChainPatched' } },
      ]);
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(200);

      const workEmail = res.body.emails?.find((e: any) => e.type === 'work');
      expect(workEmail?.value).toBe('chain-updated@work.com');
      expect(res.body[ENTERPRISE]?.department).toBe('NewDept');
      expect(res.body.displayName).toBe('ChainPatched');
    });
  });
});
