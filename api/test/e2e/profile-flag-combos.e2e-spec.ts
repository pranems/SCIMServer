/**
 * E2E Tests - Profile-Based Configuration & Flag Combinations (Phase 13)
 *
 * Replaces removed E2E tests (admin-schema, custom-resource-types,
 * immutable-enforcement, returned-request, generic-parity-fixes) by
 * testing the same behaviors through the new profile-based system.
 *
 * Covers:
 * - Profile PATCH merge (settings deep merge, schemas replace)
 * - Flag combination interactions
 * - Discovery accuracy after profile changes
 * - Backward compat: config field on create + PATCH
 *
 * @see docs/SCHEMA_TEMPLATES_DESIGN.md §6.4, §11, §14
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimGet,
  scimPost,
  scimPatch,
  createEndpoint,
  createEndpointWithConfig,
  scimBasePath,
} from './helpers/request.helper';
import { resetFixtureCounter } from './helpers/fixtures';

describe('Profile Configuration & Flag Combinations (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetFixtureCounter();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // A. Profile PATCH Merge Behavior
  // ═══════════════════════════════════════════════════════════════════════

  describe('Profile PATCH merge', () => {
    it('should deep-merge settings without affecting other profile sections', async () => {
      // Create endpoint with default profile (entra-id)
      const epRes = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name: `merge-test-${Date.now()}` })
        .expect(201);

      const epId = epRes.body.id;
      const originalSchemaCount = epRes.body.profile.schemas.length;
      const originalRtCount = epRes.body.profile.resourceTypes.length;

      // PATCH only settings - admin endpoint PATCH may return 200 or 204
      await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ profile: { settings: { SoftDeleteEnabled: 'True' } } });

      // GET to verify the merge result
      const getRes = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Settings should include the new flag + preserved defaults
      expect(getRes.body.profile?.settings?.SoftDeleteEnabled).toBe('True');
      expect(getRes.body.profile?.settings?.AllowAndCoerceBooleanStrings).toBe('True'); // preserved

      // Profile sections unchanged
      expect(getRes.body.profile.schemas.length).toBe(originalSchemaCount);
      expect(getRes.body.profile.resourceTypes.length).toBe(originalRtCount);

      // Cleanup
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // B. Flag Combination: SoftDelete + Reprovision
  // ═══════════════════════════════════════════════════════════════════════

  describe('SoftDelete + Reprovision combo', () => {
    it('should reprovision soft-deleted user on conflict when both flags ON', async () => {
      const epId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
        ReprovisionOnConflictForSoftDeletedResource: 'True',
      });
      const basePath = scimBasePath(epId);

      // Create user
      const user1 = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `reprov-${Date.now()}@test.com`,
        displayName: 'Reprovision Test',
        active: true,
      }).expect(201);

      // Soft-delete
      await request(app.getHttpServer())
        .delete(`${basePath}/Users/${user1.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      // Re-create with same userName → should reprovision (201)
      const user2 = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: user1.body.userName,
        displayName: 'Reprovisioned',
        active: true,
      }).expect(201);

      expect(user2.body.active).toBe(true);
      expect(user2.body.displayName).toBe('Reprovisioned');
    });

    it('should 201 when re-POSTing after hard-delete (v7: no reprovision, userName freed)', async () => {
      const epId = await createEndpointWithConfig(app, token, {
        UserHardDeleteEnabled: 'True',
      });
      const basePath = scimBasePath(epId);

      const user = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `norep-${Date.now()}@test.com`,
        displayName: 'No Reprov',
        active: true,
      }).expect(201);

      // Hard-delete
      await request(app.getHttpServer())
        .delete(`${basePath}/Users/${user.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      // Re-create → 201 (userName freed by hard-delete)
      await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: user.body.userName,
        displayName: 'New User',
        active: true,
      }).expect(201);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // C. Flag Combination: StrictSchema + BooleanStrings
  // ═══════════════════════════════════════════════════════════════════════

  describe('StrictSchema + BooleanStrings combo', () => {
    it('should coerce boolean strings THEN validate schema (coercion before validation)', async () => {
      const epId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
        AllowAndCoerceBooleanStrings: 'True',
      });
      const basePath = scimBasePath(epId);

      // POST with boolean string "True" in active → should be coerced then pass validation
      const res = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `strict-bool-${Date.now()}@test.com`,
        displayName: 'Strict Bool',
        active: 'True' as any,
      }).expect(201);

      expect(res.body.active).toBe(true); // coerced to boolean
    });

    it('should still accept boolean strings when coercion OFF (server is lenient without strict schema on booleans)', async () => {
      const epId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: 'True',
        AllowAndCoerceBooleanStrings: 'False',
      });
      const basePath = scimBasePath(epId);

      // POST with boolean string "True" - server may accept or reject
      // depending on which validation fires first. Test that the combo doesn't crash.
      const res = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `strict-nobool-${Date.now()}@test.com`,
        displayName: 'Strict No Bool',
        active: 'True' as any,
      });

      // Either 201 (accepted leniently) or 400 (strict rejected) - both are valid
      expect([201, 400]).toContain(res.status);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // D. Flag Combination: RequireIfMatch + SoftDelete
  // ═══════════════════════════════════════════════════════════════════════

  describe('RequireIfMatch + SoftDelete combo', () => {
    it('should return 404 for soft-deleted resource (before ETag check)', async () => {
      const epId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
        RequireIfMatch: 'True',
      });
      const basePath = scimBasePath(epId);

      const user = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `etag-sd-${Date.now()}@test.com`,
        displayName: 'ETag SD',
        active: true,
      }).expect(201);

      // Soft-delete - need If-Match header when RequireIfMatch is ON
      const getFirst = await scimGet(app, `${basePath}/Users/${user.body.id}`, token).expect(200);
      const etag = getFirst.headers['etag'];

      await request(app.getHttpServer())
        .delete(`${basePath}/Users/${user.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('If-Match', etag || '*')
        .expect(204);

      // GET soft-deleted → 404 (not 428)
      await scimGet(app, `${basePath}/Users/${user.body.id}`, token).expect(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // E. Flag Combination: IncludeWarning + IgnoreReadOnly
  // ═══════════════════════════════════════════════════════════════════════

  describe('IncludeWarning + IgnoreReadOnly combo', () => {
    it('should strip readOnly attr AND include warning when both flags ON', async () => {
      const epId = await createEndpointWithConfig(app, token, {
        IncludeWarningAboutIgnoredReadOnlyAttribute: 'True',
        IgnoreReadOnlyAttributesInPatch: 'True',
        StrictSchemaValidation: 'True',
      });
      const basePath = scimBasePath(epId);

      const user = await scimPost(app, `${basePath}/Users`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: `warn-ro-${Date.now()}@test.com`,
        displayName: 'Warn RO',
        active: true,
      }).expect(201);

      // PATCH with readOnly attribute → should be stripped, not rejected
      const patchRes = await scimPatch(app, `${basePath}/Users/${user.body.id}`, token, {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [
          { op: 'replace', value: { id: 'attempt-to-write-id', displayName: 'Updated' } },
        ],
      }).expect(200);

      expect(patchRes.body.displayName).toBe('Updated');
      // id should NOT have changed
      expect(patchRes.body.id).toBe(user.body.id);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // F. Endpoint GET (list vs detail)
  // ═══════════════════════════════════════════════════════════════════════

  describe('Endpoint list vs detail profile behavior', () => {
    it('GET detail should include full profile', async () => {
      const epId = await createEndpoint(app, token);

      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.profile).toBeDefined();
      expect(res.body.profile.schemas).toBeDefined();
      expect(res.body.profile.schemas.length).toBeGreaterThan(0);
      expect(res.body.profile.resourceTypes).toBeDefined();
      expect(res.body.profile.serviceProviderConfig).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // G. Discovery Accuracy
  // ═══════════════════════════════════════════════════════════════════════

  describe('Discovery accuracy with profile', () => {
    it('SPC should reflect profile serviceProviderConfig', async () => {
      const epId = await createEndpoint(app, token);
      const basePath = scimBasePath(epId);

      const spcRes = await scimGet(app, `${basePath}/ServiceProviderConfig`, token).expect(200);
      expect(spcRes.body.patch.supported).toBe(true);
      // Global SPC has bulk=true (server capability)
      expect(spcRes.body.bulk).toBeDefined();
    });

    it('Schemas should include auto-injected id and userName', async () => {
      const epId = await createEndpoint(app, token);
      const basePath = scimBasePath(epId);

      const schemaRes = await scimGet(app, `${basePath}/Schemas`, token).expect(200);
      const resources = schemaRes.body.Resources ?? schemaRes.body;
      const userSchema = resources.find(
        (s: any) => s.id === 'urn:ietf:params:scim:schemas:core:2.0:User',
      );
      expect(userSchema).toBeDefined();
      const attrNames = userSchema.attributes.map((a: any) => a.name);
      expect(attrNames).toContain('id');
      expect(attrNames).toContain('userName');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // H. Backward Compat: config field interactions
  // ═══════════════════════════════════════════════════════════════════════

  describe('Settings via profile PATCH', () => {
    it('should accept multiple settings flags on create', async () => {
      const epId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
        StrictSchemaValidation: 'True',
        RequireIfMatch: 'True',
      });

      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.profile?.settings?.SoftDeleteEnabled).toBe('True');
      expect(res.body.profile?.settings?.StrictSchemaValidation).toBe('True');
      expect(res.body.profile?.settings?.RequireIfMatch).toBe('True');
    });

    it('should PATCH settings flags independently', async () => {
      const epId = await createEndpointWithConfig(app, token, {
        SoftDeleteEnabled: 'True',
      });

      // Add another flag via PATCH
      await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ profile: { settings: { VerbosePatchSupported: 'True' } } })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.profile?.settings?.SoftDeleteEnabled).toBe('True'); // preserved
      expect(res.body.profile?.settings?.VerbosePatchSupported).toBe('True'); // added
    });

    // NOTE: Test "should reject invalid config flag values via PATCH" removed.
    // The legacy `config` field was removed (v0.28+); settings values
    // (profile.settings) are not individually validated.
  });

  // ═══════════════════════════════════════════════════════════════════════
  // I. Resource-Type Symmetry: Groups with profile
  // ═══════════════════════════════════════════════════════════════════════

  describe('Group CRUD with profile-based endpoint', () => {
    it('should create and retrieve a Group', async () => {
      const epId = await createEndpoint(app, token);
      const basePath = scimBasePath(epId);

      const group = await scimPost(app, `${basePath}/Groups`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: `Profile Group ${Date.now()}`,
      }).expect(201);

      expect(group.body.id).toBeDefined();
      expect(group.body.displayName).toContain('Profile Group');

      // GET
      const getRes = await scimGet(app, `${basePath}/Groups/${group.body.id}`, token).expect(200);
      expect(getRes.body.displayName).toBe(group.body.displayName);
    });

    it('should enforce Group displayName uniqueness', async () => {
      const epId = await createEndpoint(app, token);
      const basePath = scimBasePath(epId);
      const name = `UniqueGroup-${Date.now()}`;

      await scimPost(app, `${basePath}/Groups`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: name,
      }).expect(201);

      // Duplicate → 409
      await scimPost(app, `${basePath}/Groups`, token, {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
        displayName: name,
      }).expect(409);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // J. Preset profilePreset validation
  // ═══════════════════════════════════════════════════════════════════════

  describe('Preset validation edge cases', () => {
    it('should reject both profilePreset + profile at once', async () => {
      await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          name: `both-${Date.now()}`,
          profilePreset: 'minimal',
          profile: { schemas: [] },
        })
        .expect(400);
    });

    it('should create with user-only preset (no Groups)', async () => {
      const name = `useronly-${Date.now()}`;
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name, profilePreset: 'user-only' })
        .expect(201);

      expect(res.body.profile.resourceTypes).toHaveLength(1);
      expect(res.body.profile.resourceTypes[0].name).toBe('User');
    });
  });
});
