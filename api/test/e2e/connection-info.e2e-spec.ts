import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpointWithConfig } from './helpers/request.helper';

/**
 * Connection-info API E2E (WI-2).
 *
 * Verifies GET /scim/admin/endpoints/:id/connection-info assembles the Part 6
 * shape: absolute URLs, per-method enable/disable driven by the effective auth
 * flags, and the hard contract that NO secret value and NO internal `_`-prefixed
 * key is ever present (key-allowlist assertion).
 */
describe('Connection-info API (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const TOP_KEYS = ['endpointId', 'displayName', 'urls', 'enabledMethods', 'disabledMethods'];
  const URL_KEYS = ['scimBaseUrl', 'scimBaseUrlBare', 'tokenEndpoint', 'serviceProviderConfig', 'oauthMetadata'];
  const ENABLED_KEYS = ['method', 'label', 'entraAuthenticationMethod', 'entraFields', 'clientSecretState', 'expectedAudience', 'credentialId', 'secretRetained'];
  const DISABLED_KEYS = ['method', 'reason', 'enableHint'];

  it('assembles the connection-info shape with only documented top-level keys', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      OAuthClientCredentialsAuthEnabled: true,
      WifCredentialsEnabled: true,
    });

    const res = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/connection-info`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Key-allowlist: every top-level key is documented; no internal `_` keys.
    for (const key of Object.keys(res.body)) {
      expect(TOP_KEYS).toContain(key);
      expect(key.startsWith('_')).toBe(false);
    }
    expect(res.body.endpointId).toBe(endpointId);

    for (const key of Object.keys(res.body.urls)) {
      expect(URL_KEYS).toContain(key);
    }
    for (const m of res.body.enabledMethods) {
      for (const key of Object.keys(m)) expect(ENABLED_KEYS).toContain(key);
    }
    for (const m of res.body.disabledMethods) {
      for (const key of Object.keys(m)) expect(DISABLED_KEYS).toContain(key);
    }
  });

  it('builds absolute URLs honoring X-Forwarded-Proto / X-Forwarded-Host', async () => {
    const endpointId = await createEndpointWithConfig(app, token, { WifCredentialsEnabled: true });

    const res = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/connection-info`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Forwarded-Proto', 'https')
      .set('X-Forwarded-Host', 'scim.example.com')
      .expect(200);

    expect(res.body.urls.scimBaseUrl).toBe(`https://scim.example.com/scim/v2/endpoints/${endpointId}`);
    expect(res.body.urls.tokenEndpoint).toBe(`https://scim.example.com/scim/endpoints/${endpointId}/oauth/token`);
    expect(res.body.urls.oauthMetadata).toBe(`https://scim.example.com/scim/endpoints/${endpointId}/.well-known/oauth-authorization-server`);
  });

  it('reflects the enabled/disabled methods from the endpoint config', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      OAuthClientCredentialsAuthEnabled: true,
      WifCredentialsEnabled: false,
      SharedSecretBearerAuthEnabled: false,
    });

    const res = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/connection-info`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const enabled: string[] = res.body.enabledMethods.map((m: { method: string }) => m.method);
    const disabled: string[] = res.body.disabledMethods.map((m: { method: string }) => m.method);
    expect(enabled).toContain('oauth_client');
    expect(disabled).toContain('wif');
    expect(disabled).toContain('shared_secret');

    const oc = res.body.enabledMethods.find((m: { method: string }) => m.method === 'oauth_client');
    expect(oc.clientSecretState).toBe('create-required');
    expect(oc.entraFields.clientSecret).toBeNull();
  });

  it('never returns a secret value; clientSecretState flips to set-shown-once after a create', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      OAuthClientCredentialsAuthEnabled: true,
    });

    // Create an oauth_client credential (the secret is shown once here, not in connection-info).
    const created = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialType: 'oauth_client', label: 'wi2-e2e' })
      .expect(201);
    expect(created.body.clientSecret).toBeDefined();

    const res = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/connection-info`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const oc = res.body.enabledMethods.find((m: { method: string }) => m.method === 'oauth_client');
    expect(oc.clientSecretState).toBe('set-shown-once');
    expect(oc.entraFields.clientIdentifier).toBe(endpointId); // first oauth_client defaults to endpointId
    expect(oc.entraFields.clientSecret).toBeNull();
    // The whole response must not carry the plaintext secret anywhere.
    expect(JSON.stringify(res.body)).not.toContain(created.body.clientSecret);
  });

  it('surfaces credentialId + secretRetained on the oauth_client method after a create (R3)', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      OAuthClientCredentialsAuthEnabled: true,
      CredentialSecretVisibility: 'always',
    });

    const created = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialType: 'oauth_client', label: 'r3-e2e' })
      .expect(201);
    const credentialId = created.body.id as string;

    const res = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/connection-info`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const oc = res.body.enabledMethods.find((m: { method: string }) => m.method === 'oauth_client');
    // The Connect tab uses these to call the reveal endpoint + always-show the secret.
    expect(oc.credentialId).toBe(credentialId);
    expect(oc.secretRetained).toBe(true);
    // Still never the secret value itself.
    expect(JSON.stringify(res.body)).not.toContain(created.body.clientSecret);
  });

  it('returns 404 for an unknown endpoint', async () => {
    await request(app.getHttpServer())
      .get('/scim/admin/endpoints/00000000-0000-0000-0000-000000000000/connection-info')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
