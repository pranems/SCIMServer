import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';

/**
 * W2 - the admin JWT decode endpoint. Decodes (never verifies) a JWT so an
 * operator can inspect a Bearer / client_assertion / access_token value.
 */
function makeJwt(header: object, payload: object, sig = 'sig'): string {
  const h = Buffer.from(JSON.stringify(header)).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${h}.${p}.${sig}`;
}

describe('POST /scim/admin/decode-jwt (W2)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires admin auth (401 without a bearer)', async () => {
    await request(app.getHttpServer())
      .post('/scim/admin/decode-jwt')
      .send({ token: makeJwt({ alg: 'RS256' }, { sub: 'u' }) })
      .expect(401);
  });

  it('decodes a JWT into header + payload (no verification)', async () => {
    const jwt = makeJwt({ alg: 'RS256', kid: 'k1', typ: 'JWT' }, { sub: 'user-1', aud: 'api://x', iat: 1 });
    const res = await request(app.getHttpServer())
      .post('/scim/admin/decode-jwt')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: jwt })
      .expect(200);
    expect(res.body.isJwt).toBe(true);
    expect(res.body.header).toMatchObject({ alg: 'RS256', kid: 'k1' });
    expect(res.body.payload).toMatchObject({ sub: 'user-1', aud: 'api://x' });
    expect(res.body.signaturePresent).toBe(true);
  });

  it('accepts a Bearer-prefixed value', async () => {
    const jwt = 'Bearer ' + makeJwt({ alg: 'RS256' }, { sub: 'user-2' });
    const res = await request(app.getHttpServer())
      .post('/scim/admin/decode-jwt')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: jwt })
      .expect(200);
    expect(res.body.isJwt).toBe(true);
    expect(res.body.payload).toMatchObject({ sub: 'user-2' });
  });

  it('returns isJwt=false with a reason for a non-JWT string', async () => {
    const res = await request(app.getHttpServer())
      .post('/scim/admin/decode-jwt')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: 'not-a-jwt' })
      .expect(200);
    expect(res.body.isJwt).toBe(false);
    expect(typeof res.body.reason).toBe('string');
    // The response is only the decode result - never the signature bytes.
    expect(res.body.signature).toBeUndefined();
  });
});
