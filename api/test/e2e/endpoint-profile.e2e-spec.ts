/**
 * E2E Tests - Endpoint Profile (Phase 13, Step 6)
 *
 * Tests the profile-based endpoint creation and
 * profile PATCH merge behavior introduced by Phase 13.
 *
 * @see docs/SCHEMA_TEMPLATES_DESIGN.md §6, §8, §12
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimGet,
  createEndpoint,
  scimBasePath,
} from './helpers/request.helper';
import { resetFixtureCounter } from './helpers/fixtures';

describe('Endpoint Profile (E2E)', () => {
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
  // Endpoint Creation with Default Profile
  // ═══════════════════════════════════════════════════════════════════════

  describe('POST /scim/admin/endpoints (default profile)', () => {
    it('should create endpoint with default entra-id profile when no preset/profile given', async () => {
      const name = `e2e-default-${Date.now()}`;
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe(name);
      expect(res.body.profile).toBeDefined();
      expect(res.body.profile.schemas.length).toBeGreaterThan(0);
      expect(res.body.profile.resourceTypes.length).toBeGreaterThan(0);
      expect(res.body.profile.serviceProviderConfig).toBeDefined();
    });

    it('should include AllowAndCoerceBooleanStrings in default profile settings', async () => {
      const name = `e2e-default-abc-${Date.now()}`;
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name })
        .expect(201);

      expect(res.body.profile.settings.AllowAndCoerceBooleanStrings).toBe('True');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Endpoint Creation with Named Preset
  // ═══════════════════════════════════════════════════════════════════════

  describe('POST /scim/admin/endpoints (profilePreset)', () => {
    it('should create endpoint with rfc-standard preset', async () => {
      const name = `e2e-preset-${Date.now()}`;
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name, profilePreset: 'rfc-standard' })
        .expect(201);

      expect(res.body.profile).toBeDefined();
      // rfc-standard has bulk=true, sort=true
      expect(res.body.profile.serviceProviderConfig.bulk.supported).toBe(true);
      expect(res.body.profile.serviceProviderConfig.sort.supported).toBe(true);
    });

    it('should create endpoint with minimal preset', async () => {
      const name = `e2e-minimal-${Date.now()}`;
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name, profilePreset: 'minimal' })
        .expect(201);

      // minimal has 2 schemas, bulk=false, etag=false
      expect(res.body.profile.schemas).toHaveLength(2);
      expect(res.body.profile.serviceProviderConfig.bulk.supported).toBe(false);
      expect(res.body.profile.serviceProviderConfig.etag.supported).toBe(false);
    });

    it('should reject unknown preset name', async () => {
      const name = `e2e-badpreset-${Date.now()}`;
      await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name, profilePreset: 'nonexistent' })
        .expect(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Profile settings on create
  // ═══════════════════════════════════════════════════════════════════════

  describe('POST /scim/admin/endpoints (profile.settings on create)', () => {
    it('should accept profile.settings and persist them', async () => {
      const name = `e2e-settings-${Date.now()}`;
      // Create with preset first (profile alone requires schemas+RTs)
      const createRes = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name, profilePreset: 'rfc-standard' })
        .expect(201);

      const epId = createRes.body.id;

      // PATCH settings onto the endpoint
      const res = await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ profile: { settings: { UserSoftDeleteEnabled: 'True' } } })
        .expect(200);

      // settings are stored in profile.settings
      expect(res.body.profile?.settings).toBeDefined();
      expect(res.body.profile.settings.UserSoftDeleteEnabled).toBe('True');
    });

    it('should migrate deprecated SoftDeleteEnabled to UserSoftDeleteEnabled', async () => {
      const name = `compat-${Date.now()}`;
      const createRes = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name, profilePreset: 'rfc-standard' })
        .expect(201);

      const epId = createRes.body.id;

      // Send the DEPRECATED key name
      const res = await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ profile: { settings: { SoftDeleteEnabled: 'True' } } })
        .expect(200);

      // Should be migrated to the current key
      expect(res.body.profile.settings.UserSoftDeleteEnabled).toBe('True');
      // Deprecated key should NOT appear in response
      expect(res.body.profile.settings.SoftDeleteEnabled).toBeUndefined();
    });

    // NOTE: Test "should reject invalid config flag values" removed.
    // The legacy `config` field was removed from CreateEndpointDto (v0.28+).
    // Settings values (profile.settings) are not individually validated.
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Discovery Endpoints Serve Profile Data
  // ═══════════════════════════════════════════════════════════════════════

  describe('Discovery endpoints serve profile data', () => {
    let endpointId: string;
    let basePath: string;

    beforeEach(async () => {
      endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);
    });

    it('GET /ServiceProviderConfig should return SPC from profile', async () => {
      const res = await scimGet(app, `${basePath}/ServiceProviderConfig`, token).expect(200);
      expect(res.body.patch).toBeDefined();
      expect(res.body.patch.supported).toBe(true);
    });

    it('GET /Schemas should return schema definitions', async () => {
      const res = await scimGet(app, `${basePath}/Schemas`, token).expect(200);
      const schemas = res.body.Resources ?? res.body;
      expect(Array.isArray(schemas)).toBe(true);
      expect(schemas.length).toBeGreaterThan(0);
    });

    it('GET /ResourceTypes should return resource type definitions', async () => {
      const res = await scimGet(app, `${basePath}/ResourceTypes`, token).expect(200);
      const types = res.body.Resources ?? res.body;
      expect(Array.isArray(types)).toBe(true);
      expect(types.length).toBeGreaterThan(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // logFileEnabled default=true flag behavior
  // ═══════════════════════════════════════════════════════════════════════

  describe('logFileEnabled default=true', () => {
    it('should validate logFileEnabled=true on endpoint profile settings', async () => {
      const name = `e2e-logfile-true-${Date.now()}`;
      const createRes = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name, profilePreset: 'rfc-standard' })
        .expect(201);

      const epId = createRes.body.id;

      // PATCH logFileEnabled=true explicitly
      const patchRes = await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ profile: { settings: { logFileEnabled: true } } })
        .expect(200);

      expect(patchRes.body.profile?.settings?.logFileEnabled).toBe(true);
    });

    it('should validate logFileEnabled="False" explicitly disables file logging', async () => {
      const name = `e2e-logfile-false-${Date.now()}`;
      const createRes = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name, profilePreset: 'rfc-standard' })
        .expect(201);

      const epId = createRes.body.id;

      const patchRes = await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ profile: { settings: { logFileEnabled: 'False' } } })
        .expect(200);

      expect(patchRes.body.profile?.settings?.logFileEnabled).toBe('False');
    });

    it('should reject invalid logFileEnabled value', async () => {
      const name = `e2e-logfile-invalid-${Date.now()}`;
      const createRes = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name, profilePreset: 'rfc-standard' })
        .expect(201);

      const epId = createRes.body.id;

      await request(app.getHttpServer())
        .patch(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ profile: { settings: { logFileEnabled: 'Yes' } } })
        .expect(400);
    });
  });
});
