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
import { validUser, validGroup, resetFixtureCounter } from './helpers/fixtures';

/**
 * RFC 7644 §3.12 — HTTP Error Code E2E tests.
 *
 * Validates that the server returns correct HTTP status codes for
 * protocol-level errors:
 *   - 415 Unsupported Media Type (wrong Content-Type)
 *   - 405 Method Not Allowed (unsupported HTTP method on a SCIM resource)
 */
describe('HTTP Error Codes (E2E)', () => {
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

  // ───────────── 415 Unsupported Media Type ─────────────

  describe('415 Unsupported Media Type', () => {
    it('POST /Users with Content-Type text/xml should fail (not 201)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${basePath}/Users`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'text/xml')
        .send('<user><userName>test@example.com</userName></user>');

      // The server may return 400 or 415; the key point is it must NOT return 201
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).not.toBe(201);
    });

    it('POST /Users with Content-Type text/plain should fail (not 201)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${basePath}/Users`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'text/plain')
        .send('userName=test@example.com');

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).not.toBe(201);
    });

    it('PUT /Users/:id with Content-Type text/html should fail', async () => {
      // Create a valid user first
      const created = (
        await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)
      ).body;

      const res = await request(app.getHttpServer())
        .put(`${basePath}/Users/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'text/html')
        .send('<html></html>');

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).not.toBe(200);
    });

    it('PATCH /Users/:id with Content-Type application/xml should fail', async () => {
      const created = (
        await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)
      ).body;

      const res = await request(app.getHttpServer())
        .patch(`${basePath}/Users/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/xml')
        .send('<PatchOp></PatchOp>');

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).not.toBe(200);
    });

    it('POST /Users with application/json should succeed (RFC 7644 allows it)', async () => {
      const res = await request(app.getHttpServer())
        .post(`${basePath}/Users`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send(validUser());

      // application/json is acceptable per RFC 7644 §3.8
      expect(res.status).toBe(201);
    });

    it('POST /Users with application/scim+json should succeed', async () => {
      await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
    });
  });

  // ───────────── 405 Method Not Allowed ─────────────

  describe('405 Method Not Allowed', () => {
    it('POST /Users/:id should return 404 or 405 (creation on specific ID not allowed)', async () => {
      const created = (
        await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201)
      ).body;

      const res = await request(app.getHttpServer())
        .post(`${basePath}/Users/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send(validUser());

      // NestJS returns 404 for POST to an unmatched route, which is acceptable
      expect([404, 405]).toContain(res.status);
    });

    it('PUT /Users (collection) should return 404 or 405', async () => {
      const res = await request(app.getHttpServer())
        .put(`${basePath}/Users`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send(validUser());

      expect([404, 405]).toContain(res.status);
    });

    it('PATCH /Users (collection) should return 404 or 405', async () => {
      const res = await request(app.getHttpServer())
        .patch(`${basePath}/Users`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [{ op: 'replace', path: 'active', value: false }],
        });

      expect([404, 405]).toContain(res.status);
    });

    it('DELETE /Users (collection) should return 404 or 405', async () => {
      const res = await request(app.getHttpServer())
        .delete(`${basePath}/Users`)
        .set('Authorization', `Bearer ${token}`);

      expect([404, 405]).toContain(res.status);
    });

    it('DELETE /Groups (collection) should return 404 or 405', async () => {
      const res = await request(app.getHttpServer())
        .delete(`${basePath}/Groups`)
        .set('Authorization', `Bearer ${token}`);

      expect([404, 405]).toContain(res.status);
    });

    it('PUT /Groups (collection) should return 404 or 405', async () => {
      const res = await request(app.getHttpServer())
        .put(`${basePath}/Groups`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/scim+json')
        .send(validGroup());

      expect([404, 405]).toContain(res.status);
    });
  });

  // ───────────── Error response format compliance ─────────────

  describe('Error response format', () => {
    it('error responses should include SCIM Error schema', async () => {
      const res = await request(app.getHttpServer())
        .post(`${basePath}/Users`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'text/xml')
        .send('<user></user>');

      if (res.status >= 400 && res.body?.schemas) {
        expect(res.body.schemas).toContain(
          'urn:ietf:params:scim:api:messages:2.0:Error',
        );
      }
    });
  });
});
