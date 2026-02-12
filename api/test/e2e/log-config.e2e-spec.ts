import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';

/**
 * E2E tests for the Admin Log Configuration API.
 *
 * Endpoints under test:
 *   GET    /scim/admin/log-config
 *   PUT    /scim/admin/log-config
 *   PUT    /scim/admin/log-config/level/:level
 *   PUT    /scim/admin/log-config/category/:category/:level
 *   PUT    /scim/admin/log-config/endpoint/:endpointId/:level
 *   DELETE /scim/admin/log-config/endpoint/:endpointId
 *   GET    /scim/admin/log-config/recent
 *   DELETE /scim/admin/log-config/recent
 */
describe('Log Configuration API (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── GET /scim/admin/log-config ───────────────────────────────────

  describe('GET /scim/admin/log-config', () => {
    it('should return 200 with current log configuration', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/log-config')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty('globalLevel');
      expect(res.body).toHaveProperty('categoryLevels');
      expect(res.body).toHaveProperty('endpointLevels');
      expect(res.body).toHaveProperty('includePayloads');
      expect(res.body).toHaveProperty('includeStackTraces');
      expect(res.body).toHaveProperty('maxPayloadSizeBytes');
      expect(res.body).toHaveProperty('format');
      expect(res.body).toHaveProperty('availableLevels');
      expect(res.body).toHaveProperty('availableCategories');
    });

    it('should return string level names', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/log-config')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(typeof res.body.globalLevel).toBe('string');
    });

    it('should include all 7 available levels', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/log-config')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.availableLevels).toEqual(
        expect.arrayContaining(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', 'OFF']),
      );
    });

    it('should include all 12 available categories', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/log-config')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.availableCategories).toHaveLength(12);
      expect(res.body.availableCategories).toContain('http');
      expect(res.body.availableCategories).toContain('scim.user');
      expect(res.body.availableCategories).toContain('scim.patch');
    });

    it('should require authentication', async () => {
      await request(app.getHttpServer())
        .get('/scim/admin/log-config')
        .expect(401);
    });
  });

  // ─── PUT /scim/admin/log-config ───────────────────────────────────

  describe('PUT /scim/admin/log-config', () => {
    it('should update global level', async () => {
      const res = await request(app.getHttpServer())
        .put('/scim/admin/log-config')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ globalLevel: 'WARN' })
        .expect(200);

      expect(res.body.message).toBe('Log configuration updated');
      expect(res.body.config.globalLevel).toBe('WARN');
    });

    it('should update multiple fields at once', async () => {
      const res = await request(app.getHttpServer())
        .put('/scim/admin/log-config')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          globalLevel: 'INFO',
          includePayloads: false,
          format: 'json',
          categoryLevels: { 'scim.patch': 'TRACE' },
        })
        .expect(200);

      expect(res.body.config.globalLevel).toBe('INFO');
      expect(res.body.config.includePayloads).toBe(false);
      expect(res.body.config.format).toBe('json');
      expect(res.body.config.categoryLevels['scim.patch']).toBe('TRACE');
    });

    it('should persist changes across GET calls', async () => {
      await request(app.getHttpServer())
        .put('/scim/admin/log-config')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ globalLevel: 'ERROR' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/scim/admin/log-config')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.globalLevel).toBe('ERROR');
    });
  });

  // ─── PUT /scim/admin/log-config/level/:level ─────────────────────

  describe('PUT /scim/admin/log-config/level/:level', () => {
    it('should set the global log level via shortcut', async () => {
      const res = await request(app.getHttpServer())
        .put('/scim/admin/log-config/level/TRACE')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.globalLevel).toBe('TRACE');
    });

    it('should accept case-insensitive level names', async () => {
      const res = await request(app.getHttpServer())
        .put('/scim/admin/log-config/level/debug')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.globalLevel).toBe('DEBUG');
    });
  });

  // ─── PUT /scim/admin/log-config/category/:cat/:level ──────────────

  describe('PUT /scim/admin/log-config/category/:category/:level', () => {
    it('should set a category log level', async () => {
      const res = await request(app.getHttpServer())
        .put('/scim/admin/log-config/category/scim.patch/TRACE')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.message).toContain('scim.patch');
      expect(res.body.message).toContain('TRACE');
    });

    it('should return error for unknown category', async () => {
      const res = await request(app.getHttpServer())
        .put('/scim/admin/log-config/category/badcategory/DEBUG')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.error).toContain("Unknown category 'badcategory'");
      expect(res.body.availableCategories).toHaveLength(12);
    });

    it('should reflect the change in GET /admin/log-config', async () => {
      await request(app.getHttpServer())
        .put('/scim/admin/log-config/category/auth/WARN')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/scim/admin/log-config')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.categoryLevels['auth']).toBe('WARN');
    });
  });

  // ─── Endpoint Level Override ──────────────────────────────────────

  describe('PUT /scim/admin/log-config/endpoint/:endpointId/:level', () => {
    it('should set an endpoint level override', async () => {
      const res = await request(app.getHttpServer())
        .put('/scim/admin/log-config/endpoint/ep-test/TRACE')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.message).toContain('ep-test');
      expect(res.body.message).toContain('TRACE');
    });

    it('should reflect in config GET', async () => {
      await request(app.getHttpServer())
        .put('/scim/admin/log-config/endpoint/ep-debug/DEBUG')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/scim/admin/log-config')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.endpointLevels['ep-debug']).toBe('DEBUG');
    });
  });

  describe('DELETE /scim/admin/log-config/endpoint/:endpointId', () => {
    it('should remove an endpoint override and return 204', async () => {
      // Set an override first
      await request(app.getHttpServer())
        .put('/scim/admin/log-config/endpoint/ep-remove/TRACE')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Delete it
      await request(app.getHttpServer())
        .delete('/scim/admin/log-config/endpoint/ep-remove')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      // Verify it's gone
      const res = await request(app.getHttpServer())
        .get('/scim/admin/log-config')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.endpointLevels['ep-remove']).toBeUndefined();
    });
  });

  // ─── Ring Buffer / Recent Logs ────────────────────────────────────

  describe('GET /scim/admin/log-config/recent', () => {
    it('should return recent log entries', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/log-config/recent')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveProperty('count');
      expect(res.body).toHaveProperty('entries');
      expect(Array.isArray(res.body.entries)).toBe(true);
    });

    it('should respect limit query parameter', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/log-config/recent?limit=5')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.entries.length).toBeLessThanOrEqual(5);
    });

    it('should filter by level query parameter', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/log-config/recent?level=ERROR')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // All returned entries should be ERROR or above
      for (const entry of res.body.entries) {
        expect(['ERROR', 'FATAL']).toContain(entry.level);
      }
    });

    it('should filter by category query parameter', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/log-config/recent?category=http')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      for (const entry of res.body.entries) {
        expect(entry.category).toBe('http');
      }
    });
  });

  describe('DELETE /scim/admin/log-config/recent', () => {
    it('should clear the ring buffer and return 204', async () => {
      await request(app.getHttpServer())
        .delete('/scim/admin/log-config/recent')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      // Verify buffer is empty
      const res = await request(app.getHttpServer())
        .get('/scim/admin/log-config/recent')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // After clearing, requesting recent should return a small number of entries
      // (only the current GET request's own log entries: auth, oauth, http ≈ 3–4)
      expect(res.body.count).toBeLessThanOrEqual(5);
    });
  });

  // ─── X-Request-Id Correlation ─────────────────────────────────────

  describe('X-Request-Id correlation', () => {
    it('should echo back X-Request-Id in response when provided', async () => {
      const customId = 'e2e-custom-request-id-12345';
      const res = await request(app.getHttpServer())
        .get('/scim/admin/log-config')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Request-Id', customId)
        .expect(200);

      expect(res.headers['x-request-id']).toBe(customId);
    });

    it('should generate X-Request-Id when none is provided', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/log-config')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.headers['x-request-id']).toBeDefined();
      // UUID format check (very loose)
      expect(res.headers['x-request-id'].length).toBeGreaterThan(10);
    });
  });
});
