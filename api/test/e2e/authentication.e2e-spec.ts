import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken, getLegacyToken } from './helpers/auth.helper';
import { resetDatabase } from './helpers/db.helper';
import {
  scimGet,
  scimPost,
  createEndpoint,
  scimBasePath,
} from './helpers/request.helper';
import { validUser, resetFixtureCounter } from './helpers/fixtures';

describe('Authentication (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    resetFixtureCounter();
  });

  // ───────────── OAuth Token Flow ─────────────

  describe('POST /oauth/token', () => {
    it('should issue a token for valid client_credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/oauth/token')
        .set('Content-Type', 'application/json')
        .send({
          grant_type: 'client_credentials',
          client_id: 'e2e-client',
          client_secret: 'e2e-client-secret',
        })
        .expect(201);

      expect(res.body.access_token).toBeDefined();
      expect(res.body.token_type).toBe('Bearer');
      expect(res.body.expires_in).toBeGreaterThan(0);
    });

    it('should reject invalid client_secret', async () => {
      await request(app.getHttpServer())
        .post('/scim/oauth/token')
        .set('Content-Type', 'application/json')
        .send({
          grant_type: 'client_credentials',
          client_id: 'e2e-client',
          client_secret: 'wrong-secret',
        })
        .expect(401);
    });

    it('should reject unsupported grant_type', async () => {
      await request(app.getHttpServer())
        .post('/scim/oauth/token')
        .set('Content-Type', 'application/json')
        .send({
          grant_type: 'authorization_code',
          client_id: 'e2e-client',
          client_secret: 'e2e-client-secret',
        })
        .expect(400);
    });

    it('should reject missing client_id', async () => {
      await request(app.getHttpServer())
        .post('/scim/oauth/token')
        .set('Content-Type', 'application/json')
        .send({
          grant_type: 'client_credentials',
          client_secret: 'e2e-client-secret',
        })
        .expect(400);
    });
  });

  // ───────────── Auth Guard Enforcement ─────────────

  describe('Auth Guard', () => {
    it('should reject requests without Authorization header', async () => {
      const token = await getAuthToken(app);
      const endpointId = await createEndpoint(app, token);

      await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId}/Users`)
        .expect(401);
    });

    it('should reject requests with malformed Bearer token', async () => {
      const token = await getAuthToken(app);
      const endpointId = await createEndpoint(app, token);

      await request(app.getHttpServer())
        .get(`/scim/endpoints/${endpointId}/Users`)
        .set('Authorization', 'Bearer invalid-token-value')
        .expect(401);
    });

    it('should accept valid OAuth token', async () => {
      const token = await getAuthToken(app);
      const endpointId = await createEndpoint(app, token);

      await scimGet(app, `/scim/endpoints/${endpointId}/Users`, token).expect(200);
    });

    it('should accept valid legacy shared-secret token', async () => {
      const oauthToken = await getAuthToken(app);
      const endpointId = await createEndpoint(app, oauthToken);
      const legacyToken = getLegacyToken();

      await scimGet(app, `/scim/endpoints/${endpointId}/Users`, legacyToken).expect(200);
    });
  });

  // ───────────── Public Routes ─────────────

  describe('Public routes', () => {
    it('should allow /oauth/token without auth', async () => {
      await request(app.getHttpServer())
        .post('/scim/oauth/token')
        .set('Content-Type', 'application/json')
        .send({
          grant_type: 'client_credentials',
          client_id: 'e2e-client',
          client_secret: 'e2e-client-secret',
        })
        .expect(201);
    });

    it('should allow /oauth/test without auth', async () => {
      await request(app.getHttpServer())
        .get('/scim/oauth/test')
        .expect(200);
    });
  });
});
