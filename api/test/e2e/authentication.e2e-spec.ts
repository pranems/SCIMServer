import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken, getLegacyToken } from './helpers/auth.helper';
import { EndpointService } from '../../src/modules/endpoint/services/endpoint.service';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import {
  scimGet,
  scimPost,
  createEndpoint,
  scimBasePath,
  scimPatch,
  scimDelete,
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
    resetFixtureCounter();
  });

  // ───────────── OAuth Token Flow ─────────────

  describe('POST /oauth/token', () => {
    it('should issue a token for valid client_credentials (RFC 6749 5.1: 200 + no-store)', async () => {
      const res = await request(app.getHttpServer())
        .post('/scim/oauth/token')
        .set('Content-Type', 'application/json')
        .send({
          grant_type: 'client_credentials',
          client_id: 'e2e-client',
          client_secret: 'e2e-client-secret',
        })
        .expect(200)
        .expect('Content-Type', /^application\/json\b/i)
        .expect('Cache-Control', 'no-store')
        .expect('Pragma', 'no-cache');

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

  describe('Inapplicable credential query fast path', () => {
    it('shares a fresh request snapshot without a credential-probe read and validates later lookups again', async () => {
      const oauthToken = await getAuthToken(app);
      const endpointId = await createEndpoint(app, oauthToken);
      const endpointService = app.get(EndpointService);
      const authorizationRead = jest.spyOn(endpointService, 'getEndpoint');
      const controllerSnapshot = jest.spyOn(endpointService, 'getEndpointForRequest');
      const rawRead = jest.spyOn(app.get(PrismaService), '$queryRaw');

      try {
        const response = await scimGet(
          app, `/scim/endpoints/${endpointId}/Groups`, getLegacyToken(),
        ).expect(200);

        expect(authorizationRead.mock.calls.filter(([id]) => id === endpointId)).toHaveLength(1);
        expect(controllerSnapshot).toHaveBeenCalledWith(endpointId);
        if (process.env.PERSISTENCE_BACKEND?.toLowerCase() !== 'inmemory') {
          const snapshots: unknown[] = [];
          for (const [index, call] of rawRead.mock.calls.entries()) {
            if (!Array.isArray(call[0]) || !call[0].join('').includes('WITH current_endpoint')) continue;
            const rows: unknown = await rawRead.mock.results[index].value;
            if (!Array.isArray(rows)) throw new Error('Endpoint snapshot query did not return rows');
            for (const row of rows) snapshots.push(row);
          }
          expect(snapshots).toHaveLength(1);
          rawRead.mockClear();
          await endpointService.getEndpoint(endpointId);
          expect(rawRead).toHaveBeenCalledTimes(1);
          const warmRows: unknown = await rawRead.mock.results[0].value;
          expect(warmRows).toMatchObject([{ endpoint: null }]);
          const stored = await app.get(PrismaService).endpoint.findUniqueOrThrow({ where: { id: endpointId } });
          const fetched = await scimGet(app, `/scim/admin/endpoints/${endpointId}`, oauthToken).expect(200);
          expect(fetched.body).toMatchObject({
            createdAt: stored.createdAt.toISOString(),
            updatedAt: stored.updatedAt.toISOString(),
          });
        }
        expect(response.body).toEqual({
          schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
          totalResults: 0,
          startIndex: 1,
          itemsPerPage: 0,
          Resources: [],
        });
      } finally {
        authorizationRead.mockRestore();
        controllerSnapshot.mockRestore();
        rawRead.mockRestore();
        await scimDelete(app, `/scim/admin/endpoints/${endpointId}`, oauthToken).expect(204);
      }
    });

    it('refuses the global secret after an endpoint disables it between requests', async () => {
      const oauthToken = await getAuthToken(app);
      const endpointId = await createEndpoint(app, oauthToken);
      const groupsPath = `/scim/endpoints/${endpointId}/Groups`;

      try {
        await scimGet(app, groupsPath, getLegacyToken()).expect(200);
        await scimPatch(app, `/scim/admin/endpoints/${endpointId}`, oauthToken, {
          profile: { settings: { SharedSecretBearerAuthEnabled: false } },
        }).expect(200);
        const refused = await scimGet(app, groupsPath, getLegacyToken()).expect(401);
        expect(refused.body).toMatchObject({ detail: 'This endpoint does not accept the global shared secret.' });
      } finally {
        await scimDelete(app, `/scim/admin/endpoints/${endpointId}`, oauthToken).expect(204);
      }
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
        .expect(200);
    });

    it('should allow /oauth/test without auth', async () => {
      await request(app.getHttpServer())
        .get('/scim/oauth/test')
        .expect(200);
    });
  });
});
