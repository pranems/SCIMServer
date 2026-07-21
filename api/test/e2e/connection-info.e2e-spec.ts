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
  const ENABLED_KEYS = ['method', 'label', 'entraAuthenticationMethod', 'entraFields', 'clientSecretState', 'expectedAudience', 'credentialId', 'secretRetained', 'secretRevealed', 'authHealth', 'lastVerifiedAt', 'lastUsedAt', 'validity'];
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

  it('surfaces a U7 validity of "unverified" on a fresh, never-used method', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      OAuthClientCredentialsAuthEnabled: true,
    });

    const res = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/connection-info`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const oauth = res.body.enabledMethods.find((m: { method: string }) => m.method === 'oauth_client');
    expect(oauth.validity).toBe('unverified');
    expect(oauth.lastVerifiedAt).toBeNull();
    expect(oauth.lastUsedAt).toBeNull();
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

  it('WITHHOLDS the secret when CredentialSecretVisibility is once (shown once at create only)', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      OAuthClientCredentialsAuthEnabled: true,
      CredentialSecretVisibility: 'once',
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
    expect(oc.entraFields.clientIdentifier).toBe(`client-id-${endpointId}`); // first oauth_client defaults to client-id-<endpointId>
    // visibility=once -> the secret is NOT inlined.
    expect(oc.entraFields.clientSecret).toBeNull();
    expect(oc.secretRevealed).toBe(false);
    // The whole response must not carry the plaintext secret anywhere.
    expect(JSON.stringify(res.body)).not.toContain(created.body.clientSecret);
  });

  it('INLINES the secret + sets secretRevealed when CredentialSecretVisibility is always (Entra one-stop)', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      OAuthClientCredentialsAuthEnabled: true,
      CredentialSecretVisibility: 'always',
    });

    const created = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialType: 'oauth_client', label: 'always-e2e' })
      .expect(201);
    const credentialId = created.body.id as string;
    const plaintextSecret = created.body.clientSecret as string;

    const res = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/connection-info`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const oc = res.body.enabledMethods.find((m: { method: string }) => m.method === 'oauth_client');
    expect(oc.credentialId).toBe(credentialId);
    expect(oc.secretRetained).toBe(true);
    // visibility=always -> the ACTUAL secret is inlined so it can be pasted into Entra.
    expect(oc.secretRevealed).toBe(true);
    expect(oc.entraFields.clientSecret).toBe(plaintextSecret);
  });

  it('returns 404 for an unknown endpoint', async () => {
    await request(app.getHttpServer())
      .get('/scim/admin/endpoints/00000000-0000-0000-0000-000000000000/connection-info')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  // WI-D8: a rejected oauth_client token attempt records an Auth Decision, which
  // connection-info surfaces as the oauth_client method's `authHealth` block.
  it('surfaces authHealth on the oauth_client method after a failed token attempt', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      OAuthClientCredentialsAuthEnabled: true,
    });
    // Create an oauth_client credential so the method is fully wired.
    const cred = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .send({ credentialType: 'oauth_client', label: 'authhealth-e2e' })
      .expect(201);
    const clientId = cred.body.clientId as string;

    // Make a DELIBERATELY-wrong token request -> rejected -> records a decision.
    await request(app.getHttpServer())
      .post(`/scim/endpoints/${endpointId}/oauth/token`)
      .type('form')
      .send({ grant_type: 'client_credentials', client_id: clientId, client_secret: 'wrong-secret' })
      .expect(401);

    const res = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/connection-info`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const oc = res.body.enabledMethods.find((m: { method: string }) => m.method === 'oauth_client');
    expect(oc.authHealth).toBeDefined();
    expect(oc.authHealth.lastOutcome).toBe('reject');
    expect(oc.authHealth.lastReasonCode).toBe('oauth_client_auth_failed');
    expect(typeof oc.authHealth.lastAttemptAt).toBe('string');
    // authHealth keys are documented + non-secret.
    const AUTH_HEALTH_KEYS = ['lastOutcome', 'lastReasonCode', 'lastAttemptAt', 'lastCorrelationId'];
    for (const key of Object.keys(oc.authHealth)) expect(AUTH_HEALTH_KEYS).toContain(key);
  });
});
