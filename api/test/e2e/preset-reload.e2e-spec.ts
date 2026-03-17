/**
 * E2E Tests — Preset Reload API
 *
 * Tests the POST /admin/profile-presets/reload endpoint and verifies
 * that presets are loaded from JSON files, validated, and can be reloaded
 * at runtime without server restart.
 *
 * @see api/presets/*.json
 * @see api/src/modules/scim/endpoint-profile/preset.controller.ts
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';

describe('Preset Reload API (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── GET /admin/profile-presets ────────────────────────────────────

  describe('GET /admin/profile-presets', () => {
    it('should list at least 5 presets', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/profile-presets')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(5);
    });

    it('should include entra-id as default', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/profile-presets')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const entraId = res.body.find((p: any) => p.name === 'entra-id');
      expect(entraId).toBeDefined();
      expect(entraId.default).toBe(true);
      expect(entraId.description).toBeDefined();
    });

    it('should include all 5 built-in presets by name', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/profile-presets')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const names = res.body.map((p: any) => p.name);
      expect(names).toContain('entra-id');
      expect(names).toContain('entra-id-minimal');
      expect(names).toContain('rfc-standard');
      expect(names).toContain('minimal');
      expect(names).toContain('user-only');
    });
  });

  // ─── GET /admin/profile-presets/:name ──────────────────────────────

  describe('GET /admin/profile-presets/:name', () => {
    it('should return expanded entra-id preset with full profile', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/profile-presets/entra-id')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.name).toBe('entra-id');
      expect(res.body.profile).toBeDefined();
      expect(res.body.profile.schemas).toBeDefined();
      expect(res.body.profile.resourceTypes).toBeDefined();
      expect(res.body.profile.serviceProviderConfig).toBeDefined();
      expect(res.body.profile.settings).toBeDefined();
    });

    it('should return expanded rfc-standard preset with all User attributes', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/profile-presets/rfc-standard')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const userSchema = res.body.profile.schemas.find(
        (s: any) => s.id === 'urn:ietf:params:scim:schemas:core:2.0:User',
      );
      expect(userSchema).toBeDefined();
      // rfc-standard has 24 User attributes (full RFC 7643 §4.1)
      expect(userSchema.attributes.length).toBeGreaterThanOrEqual(24);
    });

    it('should return 404 for unknown preset', async () => {
      await request(app.getHttpServer())
        .get('/scim/admin/profile-presets/nonexistent')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  // ─── POST /admin/profile-presets/reload ────────────────────────────

  describe('POST /admin/profile-presets/reload', () => {
    it('should reload presets and return summary', async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/profile-presets/reload')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(res.body.message).toBeDefined();
      expect(res.body.dir).toBeDefined();
      expect(Array.isArray(res.body.loaded)).toBe(true);
      expect(Array.isArray(res.body.fallback)).toBe(true);
      expect(Array.isArray(res.body.custom)).toBe(true);
      expect(typeof res.body.totalPresets).toBe('number');
      expect(res.body.totalPresets).toBeGreaterThanOrEqual(5);
      expect(Array.isArray(res.body.validationErrors)).toBe(true);
    });

    it('should have zero validation errors for shipped JSON files', async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/admin/profile-presets/reload')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(res.body.validationErrors).toHaveLength(0);
      expect(res.body.message).toContain('successfully');
    });

    it('should still list all 5 presets after reload', async () => {
      // Reload
      await request(app.getHttpServer())
        .post('/scim/admin/profile-presets/reload')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      // Verify listing
      const res = await request(app.getHttpServer())
        .get('/scim/admin/profile-presets')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.length).toBeGreaterThanOrEqual(5);
      const names = res.body.map((p: any) => p.name);
      expect(names).toContain('entra-id');
      expect(names).toContain('rfc-standard');
    });

    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .post('/scim/admin/profile-presets/reload')
        .expect(401);
    });

    it('should create endpoint with reloaded preset successfully', async () => {
      // Reload first
      await request(app.getHttpServer())
        .post('/scim/admin/profile-presets/reload')
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      // Create endpoint with reloaded preset
      const epName = `reload-test-${Date.now()}`;
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name: epName, profilePreset: 'rfc-standard' })
        .expect(201);

      const epId = res.body.id;
      expect(epId).toBeDefined();

      // Cleanup
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${epId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);
    });
  });
});
