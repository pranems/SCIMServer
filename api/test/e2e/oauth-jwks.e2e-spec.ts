/**
 * OAuth JWKS publication - E2E (Pre-Q.B, step B2)
 *
 * Verifies that the OAuth issuer publishes its public JWKS (RFC 7517) at
 * GET /scim/oauth/jwks, that the endpoint is public, that no private key
 * material leaks, and that the published `kid` matches the `kid` stamped into
 * the header of a freshly issued token (proving the published key is the
 * active signing key).
 *
 * @see docs/auth/WIF_JWT_BEARER_ASSERTION_FOR_SCIM.md section 13.3 (Pre-Q.B)
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';

function decodeJwtHeader(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString('utf-8'));
}

describe('OAuth JWKS publication (Pre-Q.B / B2)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the JWKS publicly (no Authorization header required)', async () => {
    const res = await request(app.getHttpServer()).get('/scim/oauth/jwks').expect(200);

    expect(Array.isArray(res.body.keys)).toBe(true);
    expect(res.body.keys.length).toBe(1);
  });

  it('publishes an active key with kid, kty, alg, use and public params only', async () => {
    const res = await request(app.getHttpServer()).get('/scim/oauth/jwks').expect(200);

    const jwk = res.body.keys[0];
    expect(typeof jwk.kid).toBe('string');
    expect(jwk.kid.length).toBeGreaterThan(0);
    expect(jwk.use).toBe('sig');
    expect(['RS256', 'ES256']).toContain(jwk.alg);
    // No private key material may ever be published.
    expect(jwk.d).toBeUndefined();
    expect(jwk.p).toBeUndefined();
    expect(jwk.q).toBeUndefined();
    expect(jwk.dp).toBeUndefined();
    expect(jwk.dq).toBeUndefined();
    expect(jwk.qi).toBeUndefined();
  });

  it('sets a cacheable Cache-Control header', async () => {
    const res = await request(app.getHttpServer()).get('/scim/oauth/jwks').expect(200);
    expect(res.headers['cache-control']).toContain('max-age');
  });

  it('published kid matches the kid in a freshly issued token header', async () => {
    const jwksRes = await request(app.getHttpServer()).get('/scim/oauth/jwks').expect(200);
    const publishedKid = jwksRes.body.keys[0].kid;

    const tokenRes = await request(app.getHttpServer())
      .post('/scim/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: 'e2e-client',
        client_secret: 'e2e-client-secret',
      })
      .expect(201);

    const header = decodeJwtHeader(tokenRes.body.access_token);
    expect(header.alg).toMatch(/^(RS256|ES256)$/);
    expect(header.kid).toBe(publishedKid);
  });
});
