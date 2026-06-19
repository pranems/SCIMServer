/**
 * Per-endpoint OAuth client + per-endpoint token issuer - E2E (Q1)
 *
 * Full vertical slice:
 *  - Create an `oauth_client` credential -> returns clientId + clientSecret once.
 *  - Exchange them at the per-endpoint token endpoint -> a token carrying an
 *    `endpoint_id` claim.
 *  - That token authorizes its OWN endpoint's SCIM routes.
 *  - That token is REJECTED on a DIFFERENT endpoint (per-endpoint scoping).
 *  - The clientSecret never appears in a list response (no-secret contract).
 *
 * @see docs/auth/AUTHENTICATION_ARCHITECTURE.md section 13 (Q1)
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpointWithConfig } from './helpers/request.helper';

function decodePayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'));
}

describe('Per-endpoint OAuth client + token issuer (Q1)', () => {
  let app: INestApplication;
  let adminToken: string;
  let endpointA: string;
  let endpointB: string;

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    adminToken = await getAuthToken(app);
    endpointA = await createEndpointWithConfig(app, adminToken, {
      PerEndpointCredentialsEnabled: 'True',
    });
    endpointB = await createEndpointWithConfig(app, adminToken, {
      PerEndpointCredentialsEnabled: 'True',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function createOauthClient(endpointId: string) {
    const res = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ credentialType: 'oauth_client', label: 'q1-test' })
      .expect(201);
    return res.body as { clientId: string; clientSecret: string };
  }

  function mintEndpointToken(endpointId: string, clientId: string, clientSecret: string) {
    return request(app.getHttpServer())
      .post(`/scim/endpoints/${endpointId}/oauth/token`)
      .send({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
  }

  it('creates an oauth_client credential returning clientId + clientSecret once', async () => {
    const res = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointA}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ credentialType: 'oauth_client', label: 'q1-create' })
      .expect(201);

    expect(res.body.credentialType).toBe('oauth_client');
    expect(typeof res.body.clientId).toBe('string');
    expect(typeof res.body.clientSecret).toBe('string');
    expect(res.body.token).toBeUndefined();
  });

  it('mints a per-endpoint token carrying the endpoint_id claim', async () => {
    const { clientId, clientSecret } = await createOauthClient(endpointA);
    const res = await mintEndpointToken(endpointA, clientId, clientSecret).expect(201);

    expect(res.body.token_type).toBe('Bearer');
    expect(typeof res.body.access_token).toBe('string');
    const payload = decodePayload(res.body.access_token);
    expect(payload.endpoint_id).toBe(endpointA);
    expect(payload.client_id).toBe(clientId);
  });

  it('the per-endpoint token authorizes ITS OWN endpoint SCIM routes', async () => {
    const { clientId, clientSecret } = await createOauthClient(endpointA);
    const tokenRes = await mintEndpointToken(endpointA, clientId, clientSecret).expect(201);
    const epToken = tokenRes.body.access_token;

    await request(app.getHttpServer())
      .get(`/scim/endpoints/${endpointA}/Users`)
      .set('Authorization', `Bearer ${epToken}`)
      .expect(200);
  });

  it('the per-endpoint token is REJECTED on a DIFFERENT endpoint (Q1 scoping)', async () => {
    const { clientId, clientSecret } = await createOauthClient(endpointA);
    const tokenRes = await mintEndpointToken(endpointA, clientId, clientSecret).expect(201);
    const epToken = tokenRes.body.access_token;

    const res = await request(app.getHttpServer())
      .get(`/scim/endpoints/${endpointB}/Users`)
      .set('Authorization', `Bearer ${epToken}`)
      .expect(401);
    expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  it('rejects an invalid client_secret with invalid_client', async () => {
    const { clientId } = await createOauthClient(endpointA);
    const res = await mintEndpointToken(endpointA, clientId, 'wrong-secret').expect(401);
    // The token endpoint currently rides the SCIM exception filter, which wraps
    // the RFC 6749 5.2 `error` into the SCIM envelope `detail`. The raw OAuth
    // error format for the token endpoint is formalized in A3's error catalog.
    expect(res.body.detail).toBe('invalid_client');
  });

  it('rejects a wrong grant_type with unsupported_grant_type', async () => {
    const { clientId, clientSecret } = await createOauthClient(endpointA);
    const res = await request(app.getHttpServer())
      .post(`/scim/endpoints/${endpointA}/oauth/token`)
      .send({ grant_type: 'password', client_id: clientId, client_secret: clientSecret })
      .expect(400);
    expect(res.body.detail).toBe('unsupported_grant_type');
  });

  it('never returns the clientSecret in a credential list response', async () => {
    await createOauthClient(endpointA);
    const res = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointA}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('clientSecret');
    // The public clientId IS exposed for oauth_client rows.
    const oauthRows = res.body.filter((c: { credentialType: string }) => c.credentialType === 'oauth_client');
    expect(oauthRows.length).toBeGreaterThan(0);
    for (const row of oauthRows) {
      expect(typeof row.clientId).toBe('string');
      expect(row).not.toHaveProperty('clientSecret');
      expect(row).not.toHaveProperty('credentialHash');
    }
  });
});
