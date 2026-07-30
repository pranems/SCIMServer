import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpointWithConfig } from './helpers/request.helper';

/**
 * Credential rotate (WI-9) E2E - the lost-secret recovery path.
 *
 * Rotate mints a fresh secret (shown once, retained if effective=always),
 * deactivates the old credential, and (for oauth_client) keeps the public
 * client_id so the IdP only updates the secret.
 */
describe('Credential rotate (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createOauthCred(endpointId: string, label = 'rotate-src') {
    return request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialType: 'oauth_client', label })
      .expect(201);
  }

  it('rotates an oauth_client: new secret, same client_id, old credential deactivated', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      OAuthClientCredentialsAuthEnabled: true,
      CredentialSecretVisibility: 'always',
    });
    const created = await createOauthCred(endpointId);
    const oldId = created.body.id as string;
    const oldSecret = created.body.clientSecret as string;
    const clientId = created.body.clientId as string;

    const rotated = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/${oldId}/rotate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    // A brand-new credential id + a fresh secret, same public client_id.
    expect(rotated.body.id).not.toBe(oldId);
    expect(rotated.body.rotatedFrom).toBe(oldId);
    expect(rotated.body.clientSecret).toBeDefined();
    expect(rotated.body.clientSecret).not.toBe(oldSecret);
    expect(rotated.body.clientId).toBe(clientId);
    expect(rotated.body.credentialType).toBe('oauth_client');
    // The stored envelope is never exposed.
    expect(rotated.body.secretEnvelope).toBeUndefined();

    // The list now shows the new credential active and the old inactive.
    const list = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const oldRow = list.body.find((c: { id: string }) => c.id === oldId);
    const newRow = list.body.find((c: { id: string }) => c.id === rotated.body.id);
    expect(oldRow.active).toBe(false);
    expect(newRow.active).toBe(true);
  });

  it('the rotated secret is revealable when the endpoint retains (always)', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      OAuthClientCredentialsAuthEnabled: true,
      CredentialSecretVisibility: 'always',
    });
    const created = await createOauthCred(endpointId, 'rotate-reveal');
    const rotated = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/${created.body.id}/rotate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const revealed = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/${rotated.body.id}/reveal`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(revealed.body.retained).toBe(true);
    expect(revealed.body.clientSecret).toBe(rotated.body.clientSecret);
  });

  it('rotate under once returns the one-time secret but does not retain it', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      OAuthClientCredentialsAuthEnabled: true,
      CredentialSecretVisibility: 'once',
    });
    const created = await createOauthCred(endpointId, 'rotate-once');
    const rotated = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/${created.body.id}/rotate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(rotated.body.clientSecret).toBeDefined();

    // Reveal on the rotated credential reports not-retained (once).
    const revealed = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/${rotated.body.id}/reveal`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(revealed.body.retained).toBe(false);
  });

  it('rejects rotating a wif credential (no secret)', async () => {
    const endpointId = await createEndpointWithConfig(app, token, { WifCredentialsEnabled: true });
    const wif = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({
        credentialType: 'wif',
        label: 'wif-no-rotate',
        wif: {
          expectedIssuer: 'https://login.microsoftonline.com/t/v2.0',
          expectedSubject: 'sp',
          expectedAudience: 'api://x',
          jwksUri: 'https://login.microsoftonline.com/t/discovery/v2.0/keys',
          allowedTenantId: 't',
        },
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/${wif.body.id}/rotate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('returns 404 rotating a credential that does not belong to the endpoint', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {});
    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/00000000-0000-0000-0000-000000000000/rotate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
