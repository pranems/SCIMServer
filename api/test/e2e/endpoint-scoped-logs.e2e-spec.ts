import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimPost,
  scimGet,
  createEndpoint,
  scimBasePath,
} from './helpers/request.helper';
import { validUser, resetFixtureCounter } from './helpers/fixtures';

/**
 * Endpoint-Scoped Log Access E2E tests.
 *
 * Phase D Step 11: Validates the per-endpoint log endpoints:
 *   GET /scim/endpoints/:id/logs/recent
 *   GET /scim/endpoints/:id/logs/download
 *
 * These endpoints auto-filter by endpointId from the URL path,
 * ensuring per-endpoint credential holders only see their own logs.
 */
describe('Endpoint-Scoped Logs (E2E)', () => {
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

  // ─── GET /endpoints/:id/logs/recent ───────────────────────────────

  describe('GET /endpoints/:id/logs/recent', () => {
    it('should return logs scoped to the endpoint', async () => {
      // Generate some SCIM activity on this endpoint
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId}/logs/recent`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.endpointId).toBe(endpointId);
      expect(res.body.count).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(res.body.entries)).toBe(true);

      // All entries should be for this endpoint (if any)
      for (const entry of res.body.entries) {
        if (entry.endpointId) {
          expect(entry.endpointId).toBe(endpointId);
        }
      }
    });

    it('should support level filter', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId}/logs/recent?level=WARN`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // All entries should be WARN or above
      for (const entry of res.body.entries) {
        expect(['WARN', 'ERROR', 'FATAL']).toContain(entry.level);
      }
    });

    it('should support category filter', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId}/logs/recent?category=scim.user`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      for (const entry of res.body.entries) {
        expect(entry.category).toBe('scim.user');
      }
    });

    it('should support limit parameter', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId}/logs/recent?limit=1`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.count).toBeLessThanOrEqual(1);
    });

    it('should not include entries from other endpoints', async () => {
      // Create a second endpoint and generate activity there
      const otherEndpointId = await createEndpoint(app, token);
      const otherBasePath = scimBasePath(otherEndpointId);
      await scimPost(app, `${otherBasePath}/Users`, token, validUser()).expect(201);

      // Query first endpoint's logs
      const res = await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId}/logs/recent`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Should not contain entries from the other endpoint
      for (const entry of res.body.entries) {
        if (entry.endpointId) {
          expect(entry.endpointId).not.toBe(otherEndpointId);
        }
      }
    });
  });

  // ─── GET /endpoints/:id/logs/download ─────────────────────────────

  describe('GET /endpoints/:id/logs/download', () => {
    it('should download logs as NDJSON by default', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId}/logs/download`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('application/x-ndjson');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['content-disposition']).toContain(endpointId.slice(0, 8));
    });

    it('should download logs as JSON when format=json', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId}/logs/download?format=json`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('application/json');
    });
  });
});
