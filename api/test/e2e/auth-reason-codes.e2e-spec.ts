import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpoint, scimBasePath } from './helpers/request.helper';

/**
 * Auth reason-code wire contract (gap-closure F2 + F4).
 *
 * F2 - the GLOBAL client-credentials token endpoint (`/scim/oauth/token`) now
 * carries a stable `reason_code` on every RFC-6749 error body (parity with the
 * per-endpoint token endpoint).
 *
 * F4 - the RESOURCE plane (bearer guard) now carries the specific `reason_code`
 * inside the SCIM Diagnostics extension URN (a documented member, so the SCIM
 * error contract stays intact), alongside the auto-enriched requestId.
 */
const DIAG = 'urn:scimserver:api:messages:2.0:Diagnostics';

describe('Auth reason codes on the wire (F2 + F4)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('F2 - global /scim/oauth/token reason_code', () => {
    it('unsupported grant_type -> 400 + reason_code grant_type_unsupported', async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/oauth/token')
        .send({ grant_type: 'authorization_code', client_id: 'x', client_secret: 'y' })
        .expect(400);
      expect(res.body.error).toBe('unsupported_grant_type');
      expect(res.body.reason_code).toBe('grant_type_unsupported');
    });

    it('missing credentials -> 400 + reason_code missing_credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/oauth/token')
        .send({ grant_type: 'client_credentials', client_id: 'x' })
        .expect(400);
      expect(res.body.reason_code).toBe('missing_credentials');
    });

    it('bad client credentials -> 401 + reason_code oauth_client_auth_failed', async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/oauth/token')
        .send({ grant_type: 'client_credentials', client_id: 'nope', client_secret: 'wrong' })
        .expect(401);
      expect(res.body.error).toBe('invalid_client');
      expect(res.body.reason_code).toBe('oauth_client_auth_failed');
    });
  });

  describe('F4 - resource-plane reason_code in the Diagnostics extension', () => {
    let basePath: string;
    beforeAll(async () => {
      const endpointId = await createEndpoint(app, token);
      basePath = scimBasePath(endpointId);
    });

    it('missing bearer -> 401 SCIM body + diagnostics.reason_code bearer_missing', async () => {
      const res = await request(app.getHttpServer())
        .get(`${basePath}/Users`)
        .expect(401);
      expect(res.body.scimType).toBe('invalidToken');
      expect(res.body[DIAG]?.reason_code).toBe('bearer_missing');
    });

    it('bogus bearer -> 401 + diagnostics.reason_code bearer_invalid (+ WWW-Authenticate)', async () => {
      const res = await request(app.getHttpServer())
        .get(`${basePath}/Users`)
        .set('Authorization', 'Bearer totally-bogus-token')
        .expect(401);
      expect(res.body[DIAG]?.reason_code).toBe('bearer_invalid');
      expect(res.headers['www-authenticate']).toMatch(/error="invalid_token"/);
    });

    it('a GUARD-rejected 401 also carries the requestId correlator (diagnostics + header)', async () => {
      const res = await request(app.getHttpServer())
        .get(`${basePath}/Users`)
        .set('Authorization', 'Bearer bogus')
        .expect(401);
      // The early correlation middleware establishes the requestId + context
      // BEFORE the guard runs, so a guard rejection is now fully traceable.
      expect(res.body[DIAG]?.reason_code).toBe('bearer_invalid');
      expect(typeof res.body[DIAG]?.requestId).toBe('string');
      expect(res.headers['x-request-id']).toBeDefined();
      expect(res.body[DIAG]?.requestId).toBe(res.headers['x-request-id']);
    });
  });
});
