import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
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
  multiOpPatch,
  addMemberPatch,
  removeMemberPatch,
  resetFixtureCounter,
} from './helpers/fixtures';

/**
 * SCIM Validator Compliance Tests (E2E)
 *
 * This suite mirrors every scenario tested by the Microsoft Entra ID
 * SCIM compliance validator (scim-results JSON). Each describe block
 * maps to a validator test category, and each `it` maps to one validator
 * test assertion.
 *
 * Covers:
 *   Category 0 - Required (25 tests)
 *   Category 1 - Preview  (7 tests)
 *
 * References: SCIM RFC 7644 §3   (SCIM Protocol)
 *             SCIM RFC 7643 §8.7 (Patch Operations)
 */
describe('SCIM Validator Compliance (E2E)', () => {
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
    resetFixtureCounter();
    endpointId = await createEndpoint(app, token);
    basePath = scimBasePath(endpointId);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 0 - REQUIRED TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  // ───────────── User CRUD ─────────────

  describe('Required: User CRUD', () => {
    it('should create a new User (POST /Users → 201)', async () => {
      const user = validUser();
      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(res.body.id).toBeDefined();
      expect(res.body.userName).toBe(user.userName);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.resourceType).toBe('User');
      expect(res.body.meta.location).toContain(`/Users/${res.body.id}`);
    });

    it('should return 409 for duplicate User (POST /Users → 409)', async () => {
      const user = validUser();
      await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      const res = await scimPost(app, `${basePath}/Users`, token, user).expect(409);
      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('409');
      expect(res.body.scimType).toBe('uniqueness');
    });

    it('should delete a User and return 404 on re-GET (DELETE /Users)', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      await scimDelete(app, `${basePath}/Users/${created.id}`, token).expect(204);
      await scimGet(app, `${basePath}/Users/${created.id}`, token).expect(404);
    });
  });

  // ───────────── User Filter ─────────────

  describe('Required: User Filter', () => {
    it('should filter for an existing user by userName (eq)', async () => {
      const user = validUser({ userName: 'filteruser@test.com' });
      await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=userName eq "filteruser@test.com"`,
        token,
      ).expect(200);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources).toHaveLength(1);
      expect(res.body.Resources[0].userName).toBe('filteruser@test.com');
      expect(res.body.Resources[0].id).toBeDefined();
      expect(res.body.Resources[0].schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(res.body.Resources[0].meta).toBeDefined();
      expect(res.body.Resources[0].meta.resourceType).toBe('User');
    });

    it('should filter for a non-existing user (returns totalResults 0)', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=userName eq "nonexistent@test.com"`,
        token,
      ).expect(200);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(res.body.totalResults).toBe(0);
      expect(res.body.Resources).toHaveLength(0);
    });

    it('should filter for an existing user with different case (case-insensitive)', async () => {
      const user = validUser({ userName: 'CaseFilter@Test.COM' });
      await scimPost(app, `${basePath}/Users`, token, user).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=userName eq "CASEFILTER@TEST.COM"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources).toHaveLength(1);
      expect(res.body.Resources[0].userName).toBe('CaseFilter@Test.COM');
      expect(res.body.Resources[0].id).toBeDefined();
      expect(res.body.Resources[0].schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
      expect(res.body.Resources[0].meta).toBeDefined();
      expect(res.body.Resources[0].meta.resourceType).toBe('User');
    });
  });

  // ───────────── User PATCH Operations ─────────────

  describe('Required: User PATCH', () => {
    it('should replace multiple attributes in verbose request', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser({
        displayName: 'Original',
        title: 'Old Title',
        active: true,
      })).expect(201)).body;

      const patch = multiOpPatch([
        { op: 'replace', path: 'displayName', value: 'Updated Display' },
        { op: 'replace', path: 'title', value: 'New Title' },
        { op: 'replace', path: 'active', value: false },
      ]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      expect(res.body.displayName).toBe('Updated Display');
      expect(res.body.title).toBe('New Title');
      expect(res.body.active).toBe(false);
    });

    it('should update userName via no-path replace (Entra-style)', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser({
        userName: 'original@test.com',
      })).expect(201)).body;

      const patch = patchOp([{
        op: 'replace',
        value: { userName: 'updated@test.com' },
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      expect(res.body.userName).toBe('updated@test.com');
    });

    it('should disable a user via PATCH (active=false)', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser({ active: true })).expect(201)).body;

      const patch = patchOp([{ op: 'replace', path: 'active', value: false }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      expect(res.body.active).toBe(false);
    });

    it('should add attributes in verbose request', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const patch = multiOpPatch([
        { op: 'add', path: 'displayName', value: 'Added Display' },
        { op: 'add', path: 'title', value: 'Added Title' },
        { op: 'add', path: 'nickName', value: 'AddedNick' },
      ]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      expect(res.body.displayName).toBe('Added Display');
      expect(res.body.title).toBe('Added Title');
      expect(res.body.nickName).toBe('AddedNick');
    });

    it('should add manager via extension URN path', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      const patch = patchOp([{
        op: 'add',
        path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager',
        value: { value: 'mgr-ref-123' },
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      const ext = res.body['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'];
      expect(ext).toBeDefined();
      expect(ext.manager).toBeDefined();
      expect(ext.manager.value).toBe('mgr-ref-123');
    });

    it('should replace manager with a different reference', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // Add manager first
      await scimPatch(app, `${basePath}/Users/${created.id}`, token, patchOp([{
        op: 'add',
        path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager',
        value: { value: 'old-mgr' },
      }])).expect(200);

      // Replace manager
      const patch = patchOp([{
        op: 'replace',
        path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager',
        value: { value: 'new-mgr' },
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      const ext = res.body['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'];
      expect(ext.manager.value).toBe('new-mgr');
    });

    it('should remove manager via empty-string value', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      // Add manager first
      await scimPatch(app, `${basePath}/Users/${created.id}`, token, patchOp([{
        op: 'add',
        path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager',
        value: { value: 'mgr-to-remove' },
      }])).expect(200);

      // Remove manager with empty value
      const patch = patchOp([{
        op: 'replace',
        path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:manager',
        value: { value: '' },
      }]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      const ext = res.body['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'];
      const managerGone = !ext || !ext.manager;
      expect(managerGone).toBe(true);
    });
  });

  // ───────────── Group CRUD ─────────────

  describe('Required: Group CRUD', () => {
    it('should create a new Group (POST /Groups → 201)', async () => {
      const group = validGroup({ externalId: 'grp-ext-new' });
      const res = await scimPost(app, `${basePath}/Groups`, token, group).expect(201);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:Group');
      expect(res.body.id).toBeDefined();
      expect(res.body.displayName).toBe(group.displayName);
      expect(res.body.externalId).toBe('grp-ext-new');
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.resourceType).toBe('Group');
      expect(res.body.meta.location).toContain(`/Groups/${res.body.id}`);
    });

    it('should return 409 for duplicate Group (POST /Groups → 409)', async () => {
      const group = validGroup();
      await scimPost(app, `${basePath}/Groups`, token, group).expect(201);

      const res = await scimPost(app, `${basePath}/Groups`, token, group).expect(409);
      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('409');
      expect(res.body.scimType).toBe('uniqueness');
    });

    it('should get group by ID excluding members (?excludedAttributes=members)', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      // Add member
      await scimPatch(app, `${basePath}/Groups/${group.id}`, token, addMemberPatch(user.id)).expect(200);

      // GET excluding members
      const res = await scimGet(
        app,
        `${basePath}/Groups/${group.id}?excludedAttributes=members`,
        token,
      ).expect(200);

      expect(res.body.id).toBe(group.id);
      expect(res.body.displayName).toBeDefined();
      // members should be excluded
      expect(res.body.members).toBeUndefined();
    });

    it('should delete a Group and return 404 on re-GET (DELETE /Groups)', async () => {
      const created = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      await scimDelete(app, `${basePath}/Groups/${created.id}`, token).expect(204);
      await scimGet(app, `${basePath}/Groups/${created.id}`, token).expect(404);
    });
  });

  // ───────────── Group Filter ─────────────

  describe('Required: Group Filter', () => {
    it('should filter for an existing group by externalId excluding members', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup({ externalId: 'grp-filter-ext' })).expect(201)).body;
      await scimPatch(app, `${basePath}/Groups/${group.id}`, token, addMemberPatch(user.id)).expect(200);

      const res = await scimGet(
        app,
        `${basePath}/Groups?filter=externalId eq "grp-filter-ext"&excludedAttributes=members`,
        token,
      ).expect(200);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources).toHaveLength(1);
      expect(res.body.Resources[0].externalId).toBe('grp-filter-ext');
      expect(res.body.Resources[0].displayName).toBeDefined();
      expect(res.body.Resources[0].members).toBeUndefined();
    });

    it('should filter for an existing group by externalId (full response)', async () => {
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ externalId: 'grp-full-ext' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Groups?filter=externalId eq "grp-full-ext"`,
        token,
      ).expect(200);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources[0].externalId).toBe('grp-full-ext');
      expect(res.body.Resources[0].schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:Group');
    });

    it('should filter for a non-existing group (returns totalResults 0)', async () => {
      await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Groups?filter=externalId eq "nonexistent-ext-id"`,
        token,
      ).expect(200);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
      expect(res.body.totalResults).toBe(0);
      expect(res.body.Resources).toHaveLength(0);
    });

    it('should filter for an existing group with externalId using exact case (case-sensitive per RFC 7643)', async () => {
      // externalId has caseExact=true - TEXT column does case-sensitive eq
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ externalId: 'abc-def-1234' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Groups?filter=externalId eq "abc-def-1234"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources).toHaveLength(1);
      expect(res.body.Resources[0].externalId).toBe('abc-def-1234');
    });

    it('should NOT match group externalId when filter case differs (caseExact=true)', async () => {
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ externalId: 'MiXeD-CaSe-GrOuP' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Groups?filter=externalId eq "mixed-case-group"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(0);
    });

    it('should NOT match user externalId when filter case differs (caseExact=true)', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ externalId: 'ext-USER-abc' })).expect(201);

      const res = await scimGet(
        app,
        `${basePath}/Users?filter=externalId eq "EXT-USER-ABC"`,
        token,
      ).expect(200);

      expect(res.body.totalResults).toBe(0);
    });
  });

  // ───────────── Group PATCH Operations ─────────────

  describe('Required: Group PATCH', () => {
    it('should replace displayName on a Group', async () => {
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup({ displayName: 'Original Name' })).expect(201)).body;

      const patch = patchOp([{ op: 'replace', value: { displayName: 'Updated Name' } }]);
      const res = await scimPatch(app, `${basePath}/Groups/${group.id}`, token, patch).expect(200);

      expect(res.body.displayName).toBe('Updated Name');
    });

    it('should update externalId on a Group via PATCH', async () => {
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup({ externalId: 'old-ext' })).expect(201)).body;

      const patch = patchOp([{ op: 'replace', value: { externalId: 'new-ext' } }]);
      const res = await scimPatch(app, `${basePath}/Groups/${group.id}`, token, patch).expect(200);

      expect(res.body.externalId).toBe('new-ext');
    });

    it('should add a member to a Group via PATCH', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      const patch = patchOp([{
        op: 'replace',
        path: 'members',
        value: [{ value: user.id }],
      }]);
      const res = await scimPatch(app, `${basePath}/Groups/${group.id}`, token, patch).expect(200);

      expect(res.body.members).toBeDefined();
      expect(res.body.members).toHaveLength(1);
      expect(res.body.members[0].value).toBe(user.id);
    });

    it('should remove a specific member from a Group via PATCH', async () => {
      const user1 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const user2 = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      // Add two members
      await scimPatch(app, `${basePath}/Groups/${group.id}`, token, patchOp([{
        op: 'replace', path: 'members', value: [{ value: user1.id }, { value: user2.id }],
      }])).expect(200);

      // Remove one member using path filter
      const removePatch = removeMemberPatch(user1.id);
      const res = await scimPatch(app, `${basePath}/Groups/${group.id}`, token, removePatch).expect(200);

      expect(res.body.members).toHaveLength(1);
      expect(res.body.members[0].value).toBe(user2.id);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 1 - PREVIEW TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Preview: User PATCH - Multiple Ops on Different Attributes', () => {
    it('should apply add, replace, and remove in a single PATCH', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser({
        displayName: 'OriginalDisplayName',
        title: 'OriginalTitle',
        preferredLanguage: 'en-US',
      })).expect(201)).body;

      const patch = multiOpPatch([
        { op: 'add', path: 'displayName', value: 'NewDisplayName' },
        { op: 'replace', path: 'title', value: 'NewTitle' },
        { op: 'remove', path: 'preferredLanguage' },
      ]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      expect(res.body.displayName).toBe('NewDisplayName');
      expect(res.body.title).toBe('NewTitle');
      // preferredLanguage should be removed
      expect(res.body.preferredLanguage).toBeFalsy();
    });
  });

  describe('Preview: User PATCH - Multiple Ops on Same Attribute', () => {
    it('should apply remove→add→replace on displayName sequentially', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser({
        displayName: 'InitialDisplay',
      })).expect(201)).body;

      const patch = multiOpPatch([
        { op: 'remove', path: 'displayName' },
        { op: 'add', path: 'displayName', value: 'IntermediateDisplay' },
        { op: 'replace', path: 'displayName', value: 'FinalDisplay' },
      ]);
      const res = await scimPatch(app, `${basePath}/Users/${created.id}`, token, patch).expect(200);

      // The final value should be the last operation's result
      expect(res.body.displayName).toBe('FinalDisplay');
    });
  });

  describe('Preview: DELETE non-existent User', () => {
    it('should return 404 when deleting a non-existent User', async () => {
      const res = await scimDelete(
        app,
        `${basePath}/Users/00000000-0000-0000-0000-000000000000`,
        token,
      ).expect(404);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('404');
    });
  });

  describe('Preview: DELETE the same User twice', () => {
    it('should return 204 on first delete and 404 on second', async () => {
      const created = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;

      await scimDelete(app, `${basePath}/Users/${created.id}`, token).expect(204);
      const res = await scimDelete(app, `${basePath}/Users/${created.id}`, token).expect(404);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('404');
    });
  });

  describe('Preview: Group PATCH - Multiple Ops on Same Attribute (add+remove member)', () => {
    it('should add then remove a member in a single PATCH request', async () => {
      const user = (await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)).body;
      const group = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      const patch = multiOpPatch([
        { op: 'add', path: 'members', value: [{ value: user.id }] },
        { op: 'remove', path: `members[value eq "${user.id}"]` },
      ]);
      const res = await scimPatch(app, `${basePath}/Groups/${group.id}`, token, patch).expect(200);

      // After add then remove, members should be empty
      const memberCount = res.body.members ? res.body.members.length : 0;
      expect(memberCount).toBe(0);
    });
  });

  describe('Preview: DELETE non-existent Group', () => {
    it('should return 404 when deleting a non-existent Group', async () => {
      const res = await scimDelete(
        app,
        `${basePath}/Groups/00000000-0000-0000-0000-000000000000`,
        token,
      ).expect(404);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('404');
    });
  });

  describe('Preview: DELETE the same Group twice', () => {
    it('should return 204 on first delete and 404 on second', async () => {
      const created = (await scimPost(app, `${basePath}/Groups`, token, validGroup()).expect(201)).body;

      await scimDelete(app, `${basePath}/Groups/${created.id}`, token).expect(204);
      const res = await scimDelete(app, `${basePath}/Groups/${created.id}`, token).expect(404);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
      expect(res.body.status).toBe('404');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ADDITIONAL: externalId uniqueness is case-SENSITIVE (TEXT column, caseExact=true)
  // RFC 7643 §3.1: externalId uniqueness="none" - server may enforce but must respect case
  // ═════════════════════════════════════════════════════════════════════════

  describe('Case-sensitive externalId uniqueness (caseExact=true)', () => {
    it('should allow User with same externalId in different case (case-sensitive)', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser({ externalId: 'ext-CaSe-Test' })).expect(201);
      await scimPost(app, `${basePath}/Users`, token, validUser({ externalId: 'EXT-CASE-TEST' })).expect(201);
    });

    it('should allow Group with same externalId in different case (case-sensitive)', async () => {
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ externalId: 'grp-CaSe-Id' })).expect(201);
      await scimPost(app, `${basePath}/Groups`, token, validGroup({ externalId: 'GRP-CASE-ID' })).expect(201);
    });
  });
});
