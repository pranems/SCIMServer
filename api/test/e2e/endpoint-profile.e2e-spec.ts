/**
 * E2E Tests — Endpoint Profile & Preset API (Phase 13, Step 6)
 *
 * Tests the new profile-based endpoint creation, preset API, and
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

describe('Endpoint Profile & Preset API (E2E)', () => {
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
  // Preset API (GET /admin/profile-presets)
  // ═══════════════════════════════════════════════════════════════════════

  describe('GET /scim/admin/profile-presets', () => {
    it('should return 5 built-in presets', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/profile-presets')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveLength(5);
    });

    it('should return presets with name and description', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/profile-presets')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      for (const preset of res.body) {
        expect(preset.name).toBeDefined();
        expect(typeof preset.name).toBe('string');
        expect(preset.description).toBeDefined();
        expect(typeof preset.description).toBe('string');
      }
    });

    it('should mark entra-id as default', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/profile-presets')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const entraId = res.body.find((p: any) => p.name === 'entra-id');
      expect(entraId).toBeDefined();
      expect(entraId.default).toBe(true);
    });

    it('should include all 5 preset names in correct order', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/profile-presets')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const names = res.body.map((p: any) => p.name);
      expect(names).toEqual([
        'entra-id',
        'entra-id-minimal',
        'rfc-standard',
        'minimal',
        'user-only',
      ]);
    });
  });

  describe('GET /scim/admin/profile-presets/:name', () => {
    it('should return expanded profile for entra-id', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/profile-presets/entra-id')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.name).toBe('entra-id');
      expect(res.body.profile).toBeDefined();
      expect(res.body.profile.schemas).toBeDefined();
      expect(res.body.profile.schemas.length).toBeGreaterThan(0);
      expect(res.body.profile.resourceTypes).toBeDefined();
      expect(res.body.profile.serviceProviderConfig).toBeDefined();
      expect(res.body.profile.settings).toBeDefined();
    });

    it('should return fully expanded attributes (not "all" shorthand)', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/profile-presets/rfc-standard')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const userSchema = res.body.profile.schemas.find(
        (s: any) => s.id === 'urn:ietf:params:scim:schemas:core:2.0:User',
      );
      expect(userSchema).toBeDefined();
      expect(Array.isArray(userSchema.attributes)).toBe(true);
      expect(userSchema.attributes.length).toBeGreaterThan(10);

      // Verify attributes have full RFC characteristics
      const userName = userSchema.attributes.find((a: any) => a.name === 'userName');
      expect(userName).toBeDefined();
      expect(userName.type).toBe('string');
      expect(userName.required).toBe(true);
      expect(userName.mutability).toBe('readWrite');
    });

    it('should return 404 for unknown preset', async () => {
      await request(app.getHttpServer())
        .get('/scim/admin/profile-presets/nonexistent')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should return entra-id with 7 schemas (core + enterprise + 4 msfttest)', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/profile-presets/entra-id')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.profile.schemas).toHaveLength(7);
    });

    it('should return minimal with 2 schemas (no extensions)', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/profile-presets/minimal')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.profile.schemas).toHaveLength(2);
    });

    it('should return user-only with 1 resource type (no Group)', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/profile-presets/user-only')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.profile.resourceTypes).toHaveLength(1);
      expect(res.body.profile.resourceTypes[0].name).toBe('User');
    });
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
  // Backward Compatibility (config field)
  // ═══════════════════════════════════════════════════════════════════════

  describe('POST /scim/admin/endpoints (backward compat: config field)', () => {
    it('should accept old config field and map to profile.settings', async () => {
      const name = `e2e-compat-${Date.now()}`;
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name, config: { SoftDeleteEnabled: 'True' } })
        .expect(201);

      // config maps to profile.settings
      expect(res.body.config).toBeDefined();
      expect(res.body.config.SoftDeleteEnabled).toBe('True');
    });

    it('should reject invalid config flag values', async () => {
      const name = `e2e-badconfig-${Date.now()}`;
      await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name, config: { SoftDeleteEnabled: 'InvalidValue' } })
        .expect(400);
    });
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
});
