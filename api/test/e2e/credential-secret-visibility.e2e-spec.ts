import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpointWithConfig } from './helpers/request.helper';

/**
 * CredentialSecretVisibility (WI-7) E2E.
 *
 * The reveal + server-settings HTTP surfaces land in WI-8; this spec verifies
 * the WI-7 half: the endpoint-scope `CredentialSecretVisibility` config flag is
 * accepted (always/once) and validated, and creating a credential under either
 * value succeeds (retention is transparent - the create response is unchanged
 * and never leaks the stored envelope).
 */
describe('CredentialSecretVisibility endpoint flag (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts CredentialSecretVisibility=always on the endpoint config', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      OAuthClientCredentialsAuthEnabled: true,
      CredentialSecretVisibility: 'always',
    });
    // The flag round-trips on the endpoint detail.
    const res = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.profile.settings.CredentialSecretVisibility).toBe('always');
  });

  it('accepts CredentialSecretVisibility=once', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      CredentialSecretVisibility: 'once',
    });
    const res = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.profile.settings.CredentialSecretVisibility).toBe('once');
  });

  it('rejects an invalid CredentialSecretVisibility value', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {});
    await request(app.getHttpServer())
      .patch(`/scim/admin/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ profile: { settings: { CredentialSecretVisibility: 'sometimes' } } })
      .expect(400);
  });

  it('creating an oauth_client under always succeeds and the response never leaks the envelope', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      OAuthClientCredentialsAuthEnabled: true,
      CredentialSecretVisibility: 'always',
    });
    const res = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialType: 'oauth_client', label: 'wi7-retain' })
      .expect(201);
    // The one-time secret is present; the stored envelope is never exposed.
    expect(res.body.clientSecret).toBeDefined();
    expect(res.body.secretEnvelope).toBeUndefined();
    // The list view also never exposes the envelope.
    const list = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    for (const c of list.body) {
      expect(c.secretEnvelope).toBeUndefined();
      expect(c.credentialHash).toBeUndefined();
    }
  });
});
