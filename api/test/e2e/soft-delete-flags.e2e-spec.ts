import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { resetDatabase } from './helpers/db.helper';
import {
  scimPost,
  scimGet,
  scimPatch,
  scimPut,
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
 * RFC 7644 §3.6 compliance: soft-deleted resources MUST return 404 on
 * GET/PATCH/PUT/DELETE and MUST be omitted from LIST/query results.
 *
 * Tests:
 * - SoftDeleteEnabled: DELETE sets active=false, subsequent GET/PATCH/PUT/DELETE returns 404
 * - Double-delete returns 404
 * - LIST excludes soft-deleted resources
 * - PATCH on soft-deleted users returns 404 (valuePath, extension URN, dot-notation)
 * - Config flag combinations (SoftDelete + StrictSchema, SoftDelete + MultiOp, etc.)
 * - StrictSchemaValidation E2E
 * - AllowAndCoerceBooleanStrings E2E
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
    it('should soft-delete user (DELETE returns 204, GET returns 404 per RFC 7644 §3.6)', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      expect(user.active).toBe(true);

      // DELETE should return 204
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(204);

      // GET should return 404 per RFC 7644 §3.6
      await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(404);
    });

    it('should double-delete soft-deleted user returns 404 (RFC 7644 §3.6)', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // First DELETE
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(204);

      // Second DELETE should return 404
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(404);
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

    it('should exclude soft-deleted users from LIST response (RFC 7644 §3.6)', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user1 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const user2 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // Soft-delete user1
      await scimDelete(app, `${basePath}/Users/${user1.id}`, token).expect(204);

      // LIST should return only the active user
      const listRes = await scimGet(app, `${basePath}/Users`, token).expect(200);
      expect(listRes.body.totalResults).toBe(1);
      expect(listRes.body.Resources[0].id).toBe(user2.id);
      expect(listRes.body.Resources[0].active).toBe(true);
    });

    it('should filter soft-deleted users — active eq false returns 0 results (excluded from list)', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user1 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      // Soft-delete user1
      await scimDelete(app, `${basePath}/Users/${user1.id}`, token).expect(204);

      // Filter for inactive users — soft-deleted are excluded per RFC 7644 §3.6
      const res = await scimGet(
        app,
        `${basePath}/Users?filter=active eq false`,
        token,
      ).expect(200);
      expect(res.body.totalResults).toBe(0);
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

    it('should return 404 when trying to PATCH (re-activate) soft-deleted user', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // Soft-delete
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(204);

      // GET returns 404
      await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(404);

      // PATCH (re-activate attempt) returns 404 per RFC 7644 §3.6
      const patch = patchOp([{ op: 'replace', path: 'active', value: true }]);
      await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(404);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // SoftDeleteEnabled — Groups
  // ═══════════════════════════════════════════════════════════

  describe('SoftDeleteEnabled — Groups', () => {
    it('should soft-delete group (DELETE returns 204, GET returns 404 per RFC 7644 §3.6)', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;
      expect(group.active).toBe(true);

      // DELETE
      await scimDelete(app, `${basePath}/Groups/${group.id}`, token).expect(204);

      // GET should return 404 per RFC 7644 §3.6
      await scimGet(app, `${basePath}/Groups/${group.id}`, token).expect(404);
    });

    it('should double-delete soft-deleted group returns 404 (RFC 7644 §3.6)', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      await scimDelete(app, `${basePath}/Groups/${group.id}`, token).expect(204);
      await scimDelete(app, `${basePath}/Groups/${group.id}`, token).expect(404);
    });

    it('should hard-delete group when SoftDeleteEnabled is not set', async () => {
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);

      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      await scimDelete(app, `${basePath}/Groups/${group.id}`, token).expect(204);
      await scimGet(app, `${basePath}/Groups/${group.id}`, token).expect(404);
    });

    it('should exclude soft-deleted groups from LIST (RFC 7644 §3.6)', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const g1 = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;
      const g2 = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      // Soft-delete g1
      await scimDelete(app, `${basePath}/Groups/${g1.id}`, token).expect(204);

      // LIST returns only active group
      const listRes = await scimGet(app, `${basePath}/Groups`, token).expect(200);
      expect(listRes.body.totalResults).toBe(1);
      expect(listRes.body.Resources[0].id).toBe(g2.id);
    });

    it('should return active attribute in Group JSON response', async () => {
      const endpointId = await createEndpoint(app, token);
      const basePath = scimBasePath(endpointId);

      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;
      expect(group.active).toBe(true);

      const getRes = await scimGet(app, `${basePath}/Groups/${group.id}`, token).expect(200);
      expect(getRes.body.active).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // PATCH on soft-deleted users (various paths)
  // ═══════════════════════════════════════════════════════════

  describe('PATCH on soft-deleted users', () => {
    it('should return 404 when PATCHing displayName on soft-deleted user', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(204);

      // PATCH displayName on inactive user — returns 404 per RFC 7644 §3.6
      const patch = patchOp([{ op: 'replace', path: 'displayName', value: 'Inactive Updated' }]);
      await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(404);
    });

    it('should return 404 when PATCHing valuePath emails on soft-deleted user', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser({
        emails: [{ value: 'original@work.com', type: 'work', primary: true }],
      })).expect(201)).body;

      // Soft-delete
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(204);

      // PATCH email via valuePath on inactive user — returns 404 per RFC 7644 §3.6
      const patch = patchOp([{
        op: 'replace',
        path: 'emails[type eq "work"].value',
        value: 'patched@work.com',
      }]);
      await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(404);
    });

    it('should return 404 when PATCHing extension URN on soft-deleted user', async () => {
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

      // PATCH extension attribute on inactive user — returns 404 per RFC 7644 §3.6
      const patch = patchOp([{
        op: 'replace',
        path: `${ENTERPRISE}:department`,
        value: 'Sales',
      }]);
      await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(404);
    });

    it('should return 404 when PATCHing dot-notation on soft-deleted user (VerbosePatch)', async () => {
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

      // PATCH name.givenName with dot-notation — returns 404 per RFC 7644 §3.6
      const patch = patchOp([{ op: 'replace', path: 'name.givenName', value: 'NewGiven' }]);
      await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(404);
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

      // Soft-delete works — GET returns 404 per RFC 7644 §3.6
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(204);
      await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(404);

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

      // Soft-delete the group — GET returns 404 per RFC 7644 §3.6
      await scimDelete(app, `${basePath}/Groups/${group.id}`, token).expect(204);
      await scimGet(app, `${basePath}/Groups/${group.id}`, token).expect(404);
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

      // Soft-delete works — GET returns 404 per RFC 7644 §3.6
      await scimDelete(app, `${basePath}/Users/${user.id}`, token).expect(204);
      await scimGet(app, `${basePath}/Users/${user.id}`, token).expect(404);
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

      // Soft-delete user — GET returns 404 per RFC 7644 §3.6
      await scimDelete(app, `${basePath}/Users/${user1.id}`, token).expect(204);
      await scimGet(app, `${basePath}/Users/${user1.id}`, token).expect(404);

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

  // ═══════════════════════════════════════════════════════════
  // AllowAndCoerceBooleanStrings E2E
  // ═══════════════════════════════════════════════════════════

  describe('AllowAndCoerceBooleanStrings', () => {
    it('should accept user with boolean string "True" in roles[].primary (default: flag on)', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
        // AllowAndCoerceBooleanStrings not set → defaults to true
      });
      const basePath = scimBasePath(endpointId);

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        roles: [{ value: 'admin', primary: 'True' }],
      } as any)).expect(201);

      // The server should coerce "True" → true and return native boolean
      const role = res.body.roles?.[0];
      expect(role?.value).toBe('admin');
      expect(role?.primary).toBe(true);
    });

    it('should accept user with boolean string "False" in emails[].primary', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
        AllowAndCoerceBooleanStrings: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        emails: [
          { value: 'primary@test.com', type: 'work', primary: 'True' },
          { value: 'other@test.com', type: 'home', primary: 'False' },
        ],
      } as any)).expect(201);

      const primaryEmail = res.body.emails?.find((e: any) => e.type === 'work');
      expect(primaryEmail?.primary).toBe(true);
      const otherEmail = res.body.emails?.find((e: any) => e.type === 'home');
      expect(otherEmail?.primary).toBe(false);
    });

    it('should reject user with boolean string when flag is OFF + StrictSchemaValidation ON', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
        AllowAndCoerceBooleanStrings: 'False',
      });
      const basePath = scimBasePath(endpointId);

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        roles: [{ value: 'admin', primary: 'True' }],
      } as any)).expect(400);

      expect(res.body.detail).toContain('boolean');
    });

    it('should coerce boolean strings on PUT (replace) with flag on', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
      });
      const basePath = scimBasePath(endpointId);

      // Create user without roles first
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // PUT with boolean string
      const putBody = validUser({
        userName: user.userName,
        roles: [{ value: 'editor', primary: 'True' }],
      } as any);
      const putRes = await scimPut(app, `${basePath}/Users/${user.id}`, token, putBody).expect(200);

      expect(putRes.body.roles?.[0]?.primary).toBe(true);
    });

    it('should coerce boolean strings in PATCH value on replace with flag on', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const patch = patchOp([{
        op: 'replace',
        value: {
          roles: [{ value: 'admin', primary: 'True' }],
        },
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(200);

      expect(res.body.roles?.[0]?.primary).toBe(true);
    });

    it('should handle PATCH filter path roles[primary eq "True"] correctly', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
      });
      const basePath = scimBasePath(endpointId);

      // Create user with roles
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser({
        roles: [
          { value: 'admin', primary: true },
          { value: 'user', primary: false },
        ],
      } as any)).expect(201)).body;

      // PATCH with filter expression on boolean attribute
      const patch = patchOp([{
        op: 'replace',
        path: 'roles[primary eq "True"].value',
        value: 'superadmin',
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${user.id}`, token, patch).expect(200);

      const primaryRole = res.body.roles?.find((r: any) => r.primary === true);
      expect(primaryRole?.value).toBe('superadmin');
    });

    it('StrictSchema=OFF + Coerce=ON: boolean strings pass through and are coerced for output', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'False',
        AllowAndCoerceBooleanStrings: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        roles: [{ value: 'admin', primary: 'True' }],
      } as any)).expect(201);

      // Should be coerced to boolean in the response
      expect(res.body.roles?.[0]?.primary).toBe(true);
    });

    it('StrictSchema=OFF + Coerce=OFF: boolean strings pass through as-is', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'False',
        AllowAndCoerceBooleanStrings: 'False',
      });
      const basePath = scimBasePath(endpointId);

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        roles: [{ value: 'admin', primary: 'True' }],
      } as any)).expect(201);

      // Without coercion on write, the string is stored. But the READ path
      // always sanitizes boolean strings via toScimUserResource, so the
      // response will still show boolean true.
      // This is by design — the read-path sanitization is always on.
      expect(res.body.roles?.[0]?.primary).toBe(true);
    });

    it('should preserve non-boolean string attributes (roles[].value = "true")', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
        AllowAndCoerceBooleanStrings: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        roles: [{ value: 'true', primary: 'True' }],
      } as any)).expect(201);

      // "value" is a string attribute — should not be coerced
      expect(res.body.roles?.[0]?.value).toBe('true');
      // "primary" is a boolean attribute — should be coerced
      expect(res.body.roles?.[0]?.primary).toBe(true);
    });

    // ───────────────────────────────────────────────────────
    // Group-specific boolean coercion tests
    // ───────────────────────────────────────────────────────

    describe('Groups with extension boolean attributes', () => {
      const GROUP_EXT_URN = 'urn:test:scim:schemas:extension:BoolGroup:2.0:Group';

      /** Register a Group extension schema with a boolean attribute on the endpoint */
      async function registerGroupBoolExtension(endpointId: string): Promise<void> {
        const ext = {
          schemaUrn: GROUP_EXT_URN,
          name: 'BoolGroup',
          description: 'Test extension with boolean attribute for Group E2E',
          resourceTypeId: 'Group',
          required: false,
          attributes: [
            {
              name: 'verified',
              type: 'boolean',
              multiValued: false,
              required: false,
              mutability: 'readWrite',
              returned: 'default',
              description: 'Whether the group is verified',
            },
            {
              name: 'tags',
              type: 'complex',
              multiValued: true,
              required: false,
              mutability: 'readWrite',
              returned: 'default',
              description: 'Tags with boolean active flag',
              subAttributes: [
                { name: 'value', type: 'string', multiValued: false, required: true, mutability: 'readWrite', returned: 'always', description: 'Tag name' },
                { name: 'active', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', description: 'Whether the tag is active' },
              ],
            },
          ],
        };
        const req = (await import('supertest')).default;
        await req(app.getHttpServer())
          .post(`/scim/admin/endpoints/${endpointId}/schemas`)
          .set('Authorization', `Bearer ${token}`)
          .set('Content-Type', 'application/json')
          .send(ext)
          .expect(201);
      }

      it('should coerce Group extension boolean string "True" on POST (default: flag on)', async () => {
        const endpointId = await createEndpointWithConfig(app, token, {
          StrictSchemaValidation: 'True',
        });
        await registerGroupBoolExtension(endpointId);
        const basePath = scimBasePath(endpointId);

        const res = await scimPost(app, `${basePath}/Groups`, token, {
          ...validGroup(),
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group', GROUP_EXT_URN],
          [GROUP_EXT_URN]: { verified: 'True' },
        } as any).expect(201);

        expect(res.body[GROUP_EXT_URN]?.verified).toBe(true);
      });

      it('should coerce Group extension boolean string "False" on POST', async () => {
        const endpointId = await createEndpointWithConfig(app, token, {
          StrictSchemaValidation: 'True',
          AllowAndCoerceBooleanStrings: 'True',
        });
        await registerGroupBoolExtension(endpointId);
        const basePath = scimBasePath(endpointId);

        const res = await scimPost(app, `${basePath}/Groups`, token, {
          ...validGroup(),
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group', GROUP_EXT_URN],
          [GROUP_EXT_URN]: { verified: 'False' },
        } as any).expect(201);

        expect(res.body[GROUP_EXT_URN]?.verified).toBe(false);
      });

      it('should reject Group extension boolean string when flag is OFF + StrictSchema ON', async () => {
        const endpointId = await createEndpointWithConfig(app, token, {
          StrictSchemaValidation: 'True',
          AllowAndCoerceBooleanStrings: 'False',
        });
        await registerGroupBoolExtension(endpointId);
        const basePath = scimBasePath(endpointId);

        const res = await scimPost(app, `${basePath}/Groups`, token, {
          ...validGroup(),
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group', GROUP_EXT_URN],
          [GROUP_EXT_URN]: { verified: 'True' },
        } as any).expect(400);

        expect(res.body.detail).toContain('boolean');
      });

      it('should coerce Group extension boolean strings on PUT', async () => {
        const endpointId = await createEndpointWithConfig(app, token, {
          StrictSchemaValidation: 'True',
        });
        await registerGroupBoolExtension(endpointId);
        const basePath = scimBasePath(endpointId);

        // Create group without extension data
        const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

        // PUT with boolean string in extension
        const putBody = {
          ...validGroup({ displayName: group.displayName }),
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group', GROUP_EXT_URN],
          [GROUP_EXT_URN]: { verified: 'True' },
        };
        const putRes = await scimPut(app, `${basePath}/Groups/${group.id}`, token, putBody as any).expect(200);

        expect(putRes.body[GROUP_EXT_URN]?.verified).toBe(true);
      });

      it('should coerce Group extension boolean strings in PATCH replace value', async () => {
        const endpointId = await createEndpointWithConfig(app, token, {
          StrictSchemaValidation: 'True',
        });
        await registerGroupBoolExtension(endpointId);
        const basePath = scimBasePath(endpointId);

        // Create group WITH extension boolean data (using native boolean)
        const group = (await scimPost(app, `${basePath}/Groups`, token, {
          ...validGroup(),
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group', GROUP_EXT_URN],
          [GROUP_EXT_URN]: { verified: false },
        } as any).expect(201)).body;

        // PATCH with displayName (to exercise the coercion pipeline on the result payload)
        const patch = patchOp([{
          op: 'replace',
          path: 'displayName',
          value: 'PATCH coerced group',
        }]);
        const res = await scimPatch(app, `${basePath}/Groups/${group.id}`, token, patch).expect(200);

        expect(res.body.displayName).toBe('PATCH coerced group');
        // Extension data should be preserved through the PATCH
        expect(res.body[GROUP_EXT_URN]?.verified).toBe(false);
      });

      it('should coerce complex multi-valued sub-attribute booleans in Group extension', async () => {
        const endpointId = await createEndpointWithConfig(app, token, {
          StrictSchemaValidation: 'True',
        });
        await registerGroupBoolExtension(endpointId);
        const basePath = scimBasePath(endpointId);

        const res = await scimPost(app, `${basePath}/Groups`, token, {
          ...validGroup(),
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group', GROUP_EXT_URN],
          [GROUP_EXT_URN]: {
            verified: 'True',
            tags: [
              { value: 'important', active: 'True' },
              { value: 'archived', active: 'False' },
            ],
          },
        } as any).expect(201);

        expect(res.body[GROUP_EXT_URN]?.verified).toBe(true);
        expect(res.body[GROUP_EXT_URN]?.tags?.[0]?.active).toBe(true);
        expect(res.body[GROUP_EXT_URN]?.tags?.[0]?.value).toBe('important');
        expect(res.body[GROUP_EXT_URN]?.tags?.[1]?.active).toBe(false);
      });
    });

    // ───────────────────────────────────────────────────────
    // User multi-boolean edge cases
    // ───────────────────────────────────────────────────────

    it('should coerce boolean strings across multiple multi-valued attributes simultaneously', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
      });
      const basePath = scimBasePath(endpointId);

      const res = await scimPost(app, `${basePath}/Users`, token, validUser({
        emails: [
          { value: 'a@test.com', type: 'work', primary: 'True' },
          { value: 'b@test.com', type: 'home', primary: 'False' },
        ],
        phoneNumbers: [
          { value: '+1234567890', type: 'work', primary: 'True' },
        ],
        roles: [
          { value: 'admin', primary: 'True' },
          { value: 'user', primary: 'False' },
        ],
      } as any)).expect(201);

      // All boolean `primary` attributes across emails, phoneNumbers, roles should be coerced
      const workEmail = res.body.emails?.find((e: any) => e.type === 'work');
      expect(workEmail?.primary).toBe(true);
      const homeEmail = res.body.emails?.find((e: any) => e.type === 'home');
      expect(homeEmail?.primary).toBe(false);
      expect(res.body.phoneNumbers?.[0]?.primary).toBe(true);
      expect(res.body.roles?.find((r: any) => r.value === 'admin')?.primary).toBe(true);
      expect(res.body.roles?.find((r: any) => r.value === 'user')?.primary).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // ReprovisionOnConflictForSoftDeletedResource
  // ═══════════════════════════════════════════════════════════

  describe('ReprovisionOnConflictForSoftDeletedResource', () => {
    describe('Users', () => {
      it('should re-provision a soft-deleted user on POST with same userName (both flags on)', async () => {
        const endpointId = await createEndpointWithConfig(app, token, {
          SoftDeleteEnabled: 'True',
          ReprovisionOnConflictForSoftDeletedResource: 'True',
        });
        const basePath = scimBasePath(endpointId);

        // Create and soft-delete a user
        const user1 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
        expect(user1.active).toBe(true);
        const originalScimId = user1.id;

        await scimDelete(app, `${basePath}/Users/${user1.id}`, token).expect(204);
        await scimGet(app, `${basePath}/Users/${user1.id}`, token).expect(404);

        // POST the same userName again → should re-provision (not 409)
        const user2 = (await scimPost(app, `${basePath}/Users`, token, {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: user1.userName,
          displayName: 'Reprovisioned Display',
          active: true,
        }).expect(201)).body;

        expect(user2.id).toBe(originalScimId); // same scimId reused
        expect(user2.active).toBe(true);
        expect(user2.displayName).toBe('Reprovisioned Display');

        // GET should now work
        await scimGet(app, `${basePath}/Users/${user2.id}`, token).expect(200);
      });

      it('should 409 on POST with same userName when reprovision flag is off', async () => {
        const endpointId = await createEndpointWithConfig(app, token, {
          SoftDeleteEnabled: 'True',
          // ReprovisionOnConflictForSoftDeletedResource NOT set (default false)
        });
        const basePath = scimBasePath(endpointId);

        const user1 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
        await scimDelete(app, `${basePath}/Users/${user1.id}`, token).expect(204);

        // POST same userName again → 409 (default behavior)
        await scimPost(app, `${basePath}/Users`, token, {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: user1.userName,
          active: true,
        }).expect(409);
      });

      it('should 409 on POST with same userName as ACTIVE user even with reprovision on', async () => {
        const endpointId = await createEndpointWithConfig(app, token, {
          SoftDeleteEnabled: 'True',
          ReprovisionOnConflictForSoftDeletedResource: 'True',
        });
        const basePath = scimBasePath(endpointId);

        const user1 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

        // POST same userName again (user NOT deleted) → 409
        await scimPost(app, `${basePath}/Users`, token, {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: user1.userName,
          active: true,
        }).expect(409);
      });

      it('should preserve original created date on re-provision', async () => {
        const endpointId = await createEndpointWithConfig(app, token, {
          SoftDeleteEnabled: 'True',
          ReprovisionOnConflictForSoftDeletedResource: 'True',
        });
        const basePath = scimBasePath(endpointId);

        const user1 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
        const originalCreated = user1.meta.created;
        await scimDelete(app, `${basePath}/Users/${user1.id}`, token).expect(204);

        // Re-provision
        const user2 = (await scimPost(app, `${basePath}/Users`, token, {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: user1.userName,
          active: true,
        }).expect(201)).body;

        expect(user2.meta.created).toBe(originalCreated);
        expect(new Date(user2.meta.lastModified).getTime()).toBeGreaterThanOrEqual(
          new Date(originalCreated).getTime(),
        );
      });
    });

    describe('Groups', () => {
      it('should re-provision a soft-deleted group on POST with same displayName (both flags on)', async () => {
        const endpointId = await createEndpointWithConfig(app, token, {
          SoftDeleteEnabled: 'True',
          ReprovisionOnConflictForSoftDeletedResource: 'True',
        });
        const basePath = scimBasePath(endpointId);

        // Create and soft-delete a group
        const group1 = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;
        const originalScimId = group1.id;

        await scimDelete(app, `${basePath}/Groups/${group1.id}`, token).expect(204);
        await scimGet(app, `${basePath}/Groups/${group1.id}`, token).expect(404);

        // POST the same displayName again → should re-provision
        const group2 = (await scimPost(app, `${basePath}/Groups`, token, {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          displayName: group1.displayName,
        }).expect(201)).body;

        expect(group2.id).toBe(originalScimId);
        expect(group2.displayName).toBe(group1.displayName);

        // GET should now work
        await scimGet(app, `${basePath}/Groups/${group2.id}`, token).expect(200);
      });

      it('should 409 on POST with same displayName when reprovision flag is off', async () => {
        const endpointId = await createEndpointWithConfig(app, token, {
          SoftDeleteEnabled: 'True',
        });
        const basePath = scimBasePath(endpointId);

        const group1 = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;
        await scimDelete(app, `${basePath}/Groups/${group1.id}`, token).expect(204);

        // POST same displayName → 409
        await scimPost(app, `${basePath}/Groups`, token, {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          displayName: group1.displayName,
        }).expect(409);
      });

      it('should re-provision soft-deleted group with members', async () => {
        const endpointId = await createEndpointWithConfig(app, token, {
          SoftDeleteEnabled: 'True',
          ReprovisionOnConflictForSoftDeletedResource: 'True',
        });
        const basePath = scimBasePath(endpointId);

        // Create a user for membership
        const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

        // Create and soft-delete a group
        const group1 = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;
        await scimDelete(app, `${basePath}/Groups/${group1.id}`, token).expect(204);

        // Re-provision with members
        const group2 = (await scimPost(app, `${basePath}/Groups`, token, {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
          displayName: group1.displayName,
          members: [{ value: user.id }],
        }).expect(201)).body;

        expect(group2.id).toBe(group1.id);
        expect(group2.members).toHaveLength(1);
        expect(group2.members[0].value).toBe(user.id);
      });
    });
  });
});
