/**
 * E2E Tests — Admin Endpoint API Improvements
 *
 * Tests the enhanced admin/endpoints API responses:
 * - Envelope response { totalResults, endpoints[] }
 * - ?view=summary|full query param
 * - scimBasePath (renamed from scimEndpoint)
 * - _links (HATEOAS)
 * - ISO 8601 timestamps
 * - GET /admin/endpoints/presets (list)
 * - GET /admin/endpoints/presets/:name (detail)
 * - Nested stats format
 * - ProfileSummary digest
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpoint, scimBasePath } from './helpers/request.helper';
import { resetFixtureCounter } from './helpers/fixtures';

describe('Admin Endpoint API (E2E)', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
    endpointId = await createEndpoint(app, token);
  });

  afterAll(async () => {
    // Cleanup: delete the test endpoint
    try {
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);
    } catch { /* ignore cleanup errors */ }
    await app.close();
  });

  beforeEach(() => {
    resetFixtureCounter();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Feature 1: Envelope Response
  // ═══════════════════════════════════════════════════════════════════════

  describe('GET /scim/admin/endpoints — envelope response', () => {
    it('should return { totalResults, endpoints[] } envelope', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty('totalResults');
      expect(res.body).toHaveProperty('endpoints');
      expect(typeof res.body.totalResults).toBe('number');
      expect(Array.isArray(res.body.endpoints)).toBe(true);
      expect(res.body.totalResults).toBeGreaterThanOrEqual(1);
      expect(res.body.endpoints.length).toBe(res.body.totalResults);
    });

    it('should return empty envelope when filtering with no matches', async () => {
      // Create active endpoint, then filter for inactive — should be empty or not match
      const res = await request(app.getHttpServer())
        .get('/scim/admin/endpoints?active=false')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty('totalResults');
      expect(res.body).toHaveProperty('endpoints');
      expect(typeof res.body.totalResults).toBe('number');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Feature 2: ?view=summary|full
  // ═══════════════════════════════════════════════════════════════════════

  describe('?view=summary|full query param', () => {
    it('list should default to summary view (profileSummary, no profile)', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const ep = res.body.endpoints[0];
      expect(ep).toHaveProperty('profileSummary');
      expect(ep).not.toHaveProperty('profile');
    });

    it('list with view=full should include profile, no profileSummary', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/endpoints?view=full')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const ep = res.body.endpoints[0];
      expect(ep).toHaveProperty('profile');
      expect(ep).not.toHaveProperty('profileSummary');
    });

    it('single-get should default to full view (profile, no profileSummary)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty('profile');
      expect(res.body).not.toHaveProperty('profileSummary');
    });

    it('single-get with view=summary should include profileSummary, no profile', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}?view=summary`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty('profileSummary');
      expect(res.body).not.toHaveProperty('profile');
    });

    it('by-name with view=summary should include profileSummary', async () => {
      // First get the endpoint name
      const epRes = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/by-name/${epRes.body.name}?view=summary`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty('profileSummary');
      expect(res.body).not.toHaveProperty('profile');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Feature 3: scimBasePath
  // ═══════════════════════════════════════════════════════════════════════

  describe('scimBasePath field', () => {
    it('should return scimBasePath (not scimEndpoint) on create', async () => {
      const name = `e2e-basepath-${Date.now()}`;
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name })
        .expect(201);

      expect(res.body).toHaveProperty('scimBasePath');
      expect(res.body).not.toHaveProperty('scimEndpoint');
      expect(res.body.scimBasePath).toContain(`/scim/endpoints/${res.body.id}`);

      // Cleanup
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${res.body.id}`)
        .set('Authorization', `Bearer ${token}`);
    });

    it('should return scimBasePath on single-get', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.scimBasePath).toContain(`/scim/endpoints/${endpointId}`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Feature 4: _links (HATEOAS)
  // ═══════════════════════════════════════════════════════════════════════

  describe('_links (HATEOAS)', () => {
    it('should include all four _links on single-get', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body._links).toBeDefined();
      expect(res.body._links.self).toBe(`/admin/endpoints/${endpointId}`);
      expect(res.body._links.stats).toBe(`/admin/endpoints/${endpointId}/stats`);
      expect(res.body._links.credentials).toBe(`/admin/endpoints/${endpointId}/credentials`);
      expect(res.body._links.scim).toBe(`/scim/endpoints/${endpointId}`);
    });

    it('should include _links on each endpoint in list response', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      for (const ep of res.body.endpoints) {
        expect(ep._links).toBeDefined();
        expect(ep._links.self).toContain('/admin/endpoints/');
        expect(ep._links.stats).toContain('/admin/endpoints/');
        expect(ep._links.credentials).toContain('/admin/endpoints/');
        expect(ep._links.scim).toContain('/scim/endpoints/');
      }
    });

    it('should include _links on create response', async () => {
      const name = `e2e-links-${Date.now()}`;
      const res = await request(app.getHttpServer())
        .post('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ name })
        .expect(201);

      expect(res.body._links).toBeDefined();
      expect(res.body._links.self).toBe(`/admin/endpoints/${res.body.id}`);

      // Cleanup
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${res.body.id}`)
        .set('Authorization', `Bearer ${token}`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Feature 5: ISO 8601 Timestamps
  // ═══════════════════════════════════════════════════════════════════════

  describe('ISO 8601 timestamps', () => {
    it('should return createdAt and updatedAt as ISO 8601 strings', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(typeof res.body.createdAt).toBe('string');
      expect(typeof res.body.updatedAt).toBe('string');

      // ISO 8601 format check
      const created = new Date(res.body.createdAt);
      const updated = new Date(res.body.updatedAt);
      expect(created.toISOString()).toBe(res.body.createdAt);
      expect(updated.toISOString()).toBe(res.body.updatedAt);
    });

    it('should return ISO timestamps in list response', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/endpoints')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      for (const ep of res.body.endpoints) {
        expect(typeof ep.createdAt).toBe('string');
        expect(typeof ep.updatedAt).toBe('string');
        expect(new Date(ep.createdAt).toISOString()).toBe(ep.createdAt);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Features 6-7: Presets API
  // ═══════════════════════════════════════════════════════════════════════

  describe('GET /scim/admin/endpoints/presets', () => {
    it('should list all built-in presets with summaries', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/endpoints/presets')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty('totalResults');
      expect(res.body).toHaveProperty('presets');
      expect(res.body.totalResults).toBeGreaterThanOrEqual(5);
      expect(res.body.presets.length).toBe(res.body.totalResults);

      const preset = res.body.presets[0];
      expect(preset).toHaveProperty('name');
      expect(preset).toHaveProperty('description');
      expect(preset).toHaveProperty('default');
      expect(preset).toHaveProperty('summary');
      expect(preset.summary).toHaveProperty('schemaCount');
      expect(preset.summary).toHaveProperty('schemas');
      expect(preset.summary).toHaveProperty('resourceTypeCount');
      expect(preset.summary).toHaveProperty('resourceTypes');
      expect(preset.summary).toHaveProperty('serviceProviderConfig');
      expect(preset.summary).toHaveProperty('activeSettings');
    });

    it('should mark exactly one preset as default (entra-id)', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/endpoints/presets')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const defaults = res.body.presets.filter((p: any) => p.default === true);
      expect(defaults).toHaveLength(1);
      expect(defaults[0].name).toBe('entra-id');
    });

    it('should include known preset names', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/endpoints/presets')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const names = res.body.presets.map((p: any) => p.name);
      expect(names).toContain('entra-id');
      expect(names).toContain('rfc-standard');
      expect(names).toContain('minimal');
      expect(names).toContain('user-only');
    });
  });

  describe('GET /scim/admin/endpoints/presets/:name', () => {
    it('should return full expanded profile for entra-id', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/endpoints/presets/entra-id')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.metadata).toBeDefined();
      expect(res.body.metadata.name).toBe('entra-id');
      expect(res.body.metadata.description).toBeDefined();
      expect(res.body.metadata.default).toBe(true);
      expect(res.body.profile).toBeDefined();
      expect(res.body.profile.schemas.length).toBeGreaterThan(0);
      expect(res.body.profile.resourceTypes.length).toBeGreaterThan(0);
      expect(res.body.profile.serviceProviderConfig).toBeDefined();
    });

    it('should return 404 for unknown preset', async () => {
      await request(app.getHttpServer())
        .get('/scim/admin/endpoints/presets/does-not-exist')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should return different profiles for different presets', async () => {
      const entraRes = await request(app.getHttpServer())
        .get('/scim/admin/endpoints/presets/entra-id')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const minimalRes = await request(app.getHttpServer())
        .get('/scim/admin/endpoints/presets/minimal')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(entraRes.body.profile.schemas.length).toBeGreaterThan(
        minimalRes.body.profile.schemas.length
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Feature 8: Nested Stats
  // ═══════════════════════════════════════════════════════════════════════

  describe('GET /scim/admin/endpoints/:id/stats — nested format', () => {
    it('should return nested stats with users, groups, groupMembers, requestLogs', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}/stats`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Top-level structure
      expect(res.body).toHaveProperty('users');
      expect(res.body).toHaveProperty('groups');
      expect(res.body).toHaveProperty('groupMembers');
      expect(res.body).toHaveProperty('requestLogs');

      // Nested structure
      expect(res.body.users).toHaveProperty('total');
      expect(res.body.users).toHaveProperty('active');
      expect(res.body.users).toHaveProperty('inactive');
      expect(res.body.groups).toHaveProperty('total');
      expect(res.body.groups).toHaveProperty('active');
      expect(res.body.groups).toHaveProperty('inactive');
      expect(res.body.groupMembers).toHaveProperty('total');
      expect(res.body.requestLogs).toHaveProperty('total');

      // Types
      expect(typeof res.body.users.total).toBe('number');
      expect(typeof res.body.users.active).toBe('number');
      expect(typeof res.body.groups.inactive).toBe('number');
    });

    it('should NOT have old flat stats format', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}/stats`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).not.toHaveProperty('totalUsers');
      expect(res.body).not.toHaveProperty('totalGroups');
      expect(res.body).not.toHaveProperty('totalGroupMembers');
      expect(res.body).not.toHaveProperty('requestLogCount');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Feature 9: ProfileSummary
  // ═══════════════════════════════════════════════════════════════════════

  describe('ProfileSummary digest', () => {
    it('should include schemaCount, schemas[], resourceTypeCount, resourceTypes[]', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}?view=summary`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const ps = res.body.profileSummary;
      expect(ps).toBeDefined();

      expect(typeof ps.schemaCount).toBe('number');
      expect(ps.schemaCount).toBeGreaterThan(0);
      expect(Array.isArray(ps.schemas)).toBe(true);
      expect(ps.schemas.length).toBe(ps.schemaCount);

      // Each schema summary
      for (const s of ps.schemas) {
        expect(s).toHaveProperty('id');
        expect(s).toHaveProperty('name');
        expect(s).toHaveProperty('attributeCount');
        expect(typeof s.attributeCount).toBe('number');
      }

      expect(typeof ps.resourceTypeCount).toBe('number');
      expect(Array.isArray(ps.resourceTypes)).toBe(true);
      expect(ps.resourceTypes.length).toBe(ps.resourceTypeCount);

      // Each resourceType summary
      for (const rt of ps.resourceTypes) {
        expect(rt).toHaveProperty('name');
        expect(rt).toHaveProperty('schema');
        expect(rt).toHaveProperty('extensions');
        expect(rt).toHaveProperty('extensionCount');
        expect(Array.isArray(rt.extensions)).toBe(true);
      }
    });

    it('should include serviceProviderConfig with boolean flags', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}?view=summary`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const spc = res.body.profileSummary.serviceProviderConfig;
      expect(spc).toBeDefined();
      expect(typeof spc.patch).toBe('boolean');
      expect(typeof spc.bulk).toBe('boolean');
      expect(typeof spc.filter).toBe('boolean');
      expect(typeof spc.changePassword).toBe('boolean');
      expect(typeof spc.sort).toBe('boolean');
      expect(typeof spc.etag).toBe('boolean');
    });

    it('should include activeSettings (non-default flags)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}?view=summary`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const ps = res.body.profileSummary;
      expect(ps).toHaveProperty('activeSettings');
      expect(typeof ps.activeSettings).toBe('object');
    });

    it('summary in list matches individual summary', async () => {
      const listRes = await request(app.getHttpServer())
        .get('/scim/admin/endpoints?view=summary')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const fromList = listRes.body.endpoints.find((ep: any) => ep.id === endpointId);
      expect(fromList).toBeDefined();

      const singleRes = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}?view=summary`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(fromList.profileSummary.schemaCount).toBe(singleRes.body.profileSummary.schemaCount);
      expect(fromList.profileSummary.resourceTypeCount).toBe(singleRes.body.profileSummary.resourceTypeCount);
    });
  });
});
