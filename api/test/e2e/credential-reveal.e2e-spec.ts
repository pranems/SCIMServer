import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpointWithConfig } from './helpers/request.helper';

/**
 * Credential reveal + server security settings (WI-8) E2E.
 *
 * Covers: GET/PUT /admin/settings/security (server visibility + KEK status),
 * the reveal endpoint under `always` (returns the retained secret) vs `once`
 * / pre-feature (returns retained:false), and the server-once purge.
 */
describe('Credential reveal + security settings (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    // Reset the server visibility to always so other suites are unaffected.
    await request(app.getHttpServer())
      .put('/scim/admin/settings/security')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialSecretVisibility: 'always' })
      .catch(() => undefined);
    await app.close();
  });

  it('GET /admin/settings/security returns the server visibility + KEK status', async () => {
    const res = await request(app.getHttpServer())
      .get('/scim/admin/settings/security')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(['always', 'once']).toContain(res.body.credentialSecretVisibility);
    expect(res.body.kek).toEqual({ configured: true, isDefault: expect.any(Boolean) });
    // Key-allowlist: no secret KEK value ever leaks.
    expect(JSON.stringify(res.body)).not.toContain('changeme-credential-kek');
  });

  it('PUT /admin/settings/security validates the enum', async () => {
    await request(app.getHttpServer())
      .put('/scim/admin/settings/security')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialSecretVisibility: 'bogus' })
      .expect(400);
  });

  it('reveals a retained oauth_client secret when the effective visibility is always', async () => {
    // Ensure the server ceiling is always for this test.
    await request(app.getHttpServer())
      .put('/scim/admin/settings/security')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialSecretVisibility: 'always' })
      .expect(200);

    const endpointId = await createEndpointWithConfig(app, token, {
      OAuthClientCredentialsAuthEnabled: true,
      CredentialSecretVisibility: 'always',
    });
    const created = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialType: 'oauth_client', label: 'wi8-reveal' })
      .expect(201);
    const oneTimeSecret = created.body.clientSecret as string;

    const revealed = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/${created.body.id}/reveal`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(revealed.body.retained).toBe(true);
    // The revealed secret matches the one shown once at creation.
    expect(revealed.body.clientSecret).toBe(oneTimeSecret);
    expect(revealed.body.clientId).toBe(`client-id-${endpointId}`); // first oauth_client defaults to client-id-<endpointId>
    // The stored envelope is never exposed.
    expect(revealed.body.secretEnvelope).toBeUndefined();
  });

  it('returns retained:false for an endpoint whose effective visibility is once', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      OAuthClientCredentialsAuthEnabled: true,
      CredentialSecretVisibility: 'once',
    });
    const created = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialType: 'oauth_client', label: 'wi8-once' })
      .expect(201);

    const revealed = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/${created.body.id}/reveal`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(revealed.body.retained).toBe(false);
    expect(revealed.body.reason).toMatch(/rotate the credential/i);
    expect(revealed.body.clientSecret).toBeUndefined();
  });

  it('server flip to once forces reveal to retained:false even when the endpoint says always (server ceiling + purge)', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      OAuthClientCredentialsAuthEnabled: true,
      CredentialSecretVisibility: 'always',
    });
    const created = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialType: 'oauth_client', label: 'wi8-ceiling' })
      .expect(201);

    // Flip the SERVER setting to once - the ceiling forces once everywhere + purges.
    await request(app.getHttpServer())
      .put('/scim/admin/settings/security')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialSecretVisibility: 'once' })
      .expect(200);

    const revealed = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/${created.body.id}/reveal`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(revealed.body.retained).toBe(false);

    // Restore for other tests.
    await request(app.getHttpServer())
      .put('/scim/admin/settings/security')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialSecretVisibility: 'always' })
      .expect(200);
  });

  it('returns 404 revealing a credential that does not belong to the endpoint', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {});
    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/00000000-0000-0000-0000-000000000000/reveal`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  describe('GET /admin/settings/security/connection-secrets (server-level global secrets)', () => {
    it('returns the global shared secret + oauth client id/secret when server visibility is always', async () => {
      await request(app.getHttpServer())
        .put('/scim/admin/settings/security')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialSecretVisibility: 'always' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/scim/admin/settings/security/connection-secrets')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.revealed).toBe(true);
      expect(res.body.visibility).toBe('always');
      // The SCIM shared secret (Entra "Secret Token") + the global oauth client id.
      expect(typeof res.body.sharedSecret === 'string' || res.body.sharedSecret === null).toBe(true);
      expect(res.body).toHaveProperty('oauthClientId');
      expect(res.body).toHaveProperty('oauthClientSecret');
    });

    it('withholds the global secrets (revealed:false, all null) when server visibility is once', async () => {
      await request(app.getHttpServer())
        .put('/scim/admin/settings/security')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialSecretVisibility: 'once' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/scim/admin/settings/security/connection-secrets')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.revealed).toBe(false);
      expect(res.body.visibility).toBe('once');
      expect(res.body.sharedSecret).toBeNull();
      expect(res.body.oauthClientId).toBeNull();
      expect(res.body.oauthClientSecret).toBeNull();

      // Restore always so other suites are unaffected.
      await request(app.getHttpServer())
        .put('/scim/admin/settings/security')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialSecretVisibility: 'always' })
        .expect(200);
    });

    it('requires admin auth (401 without a bearer)', async () => {
      await request(app.getHttpServer())
        .get('/scim/admin/settings/security/connection-secrets')
        .expect(401);
    });
  });
});
