/**
 * OAuth discovery + bearer-error enrichment - E2E (Q0)
 *
 * Covers:
 *  - RFC 6750 section 3 - the `WWW-Authenticate` header on a 401 carries
 *    `error="invalid_token"` + `error_description` when an invalid token is
 *    presented, and only `realm` (no error code) when the token is absent.
 *  - RFC 8414 - `GET /.well-known/oauth-authorization-server` publishes the
 *    authorization-server metadata (issuer, token_endpoint, jwks_uri, ...),
 *    publicly, so clients can discover the token + key URLs.
 *
 * @see docs/auth/AUTHENTICATION_ARCHITECTURE.md section 13 (Q0)
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';

describe('OAuth discovery + bearer errors (Q0)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('WWW-Authenticate enrichment (RFC 6750 section 3)', () => {
    it('an invalid token yields 401 with error="invalid_token" + error_description', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/endpoints')
        .set('Authorization', 'Bearer definitely-not-a-valid-token')
        .expect(401);

      const header = res.headers['www-authenticate'];
      expect(header).toBeDefined();
      expect(header).toContain('Bearer');
      expect(header).toContain('realm="SCIM"');
      expect(header).toContain('error="invalid_token"');
      expect(header).toContain('error_description=');
    });

    it('a missing token yields 401 with realm but no error code (RFC 6750 section 3)', async () => {
      const res = await request(app.getHttpServer())
        .get('/scim/admin/endpoints')
        .expect(401);

      const header = res.headers['www-authenticate'];
      expect(header).toBeDefined();
      expect(header).toContain('Bearer');
      expect(header).toContain('realm="SCIM"');
      expect(header).not.toContain('error=');
    });
  });

  describe('RFC 8414 authorization-server metadata', () => {
    it('publishes metadata publicly at /.well-known/oauth-authorization-server', async () => {
      const res = await request(app.getHttpServer())
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      expect(typeof res.body.issuer).toBe('string');
      expect(res.body.issuer.length).toBeGreaterThan(0);
      expect(res.body.token_endpoint).toMatch(/\/scim\/oauth\/token$/);
      expect(res.body.jwks_uri).toMatch(/\/scim\/oauth\/jwks$/);
      expect(Array.isArray(res.body.grant_types_supported)).toBe(true);
      expect(res.body.grant_types_supported).toContain('client_credentials');
      expect(Array.isArray(res.body.token_endpoint_auth_methods_supported)).toBe(true);
      expect(Array.isArray(res.body.scopes_supported)).toBe(true);
    });

    it('sets a cacheable Cache-Control header on the metadata', async () => {
      const res = await request(app.getHttpServer())
        .get('/.well-known/oauth-authorization-server')
        .expect(200);
      expect(res.headers['cache-control']).toContain('max-age');
    });

    it('metadata issuer matches the iss claim of an issued token', async () => {
      const meta = await request(app.getHttpServer())
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      const tokenRes = await request(app.getHttpServer())
        .post('/scim/oauth/token')
        .send({
          grant_type: 'client_credentials',
          client_id: 'e2e-client',
          client_secret: 'e2e-client-secret',
        })
        .expect(201);

      const payload = JSON.parse(
        Buffer.from(tokenRes.body.access_token.split('.')[1], 'base64url').toString('utf-8'),
      );
      expect(payload.iss).toBe(meta.body.issuer);
    });
  });
});
