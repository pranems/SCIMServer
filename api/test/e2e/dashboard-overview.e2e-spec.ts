/**
 * E2E spec for the Phase B1 endpoint overview BFF.
 *
 * Hits GET /admin/endpoints/:endpointId/overview against a real NestJS
 * application (in-memory backend in CI, Prisma locally) and asserts:
 *   - response shape locked to a key allowlist
 *   - 404 on unknown endpoint
 *   - empty credentials returned as []
 *   - new credential appears in subsequent overview without exposing hash
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase B1
 * @see api/src/modules/dashboard/dashboard.controller.ts
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpoint } from './helpers/request.helper';
import { resetFixtureCounter } from './helpers/fixtures';

describe('Endpoint Overview BFF (E2E) - Phase B1', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetFixtureCounter();
  });

  it('returns 404 for an unknown endpointId', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const res = await request(app.getHttpServer() as any)
      .get('/scim/admin/endpoints/00000000-0000-0000-0000-000000000000/overview')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
    expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:Error');
  });

  it('returns the canonical shape for a real endpoint', async () => {
    const endpointId = await createEndpoint(app, token);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const res = await request(app.getHttpServer() as any)
      .get(`/scim/admin/endpoints/${endpointId}/overview`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Top-level allowlist - prevents accidental field additions that
    // ship internal data to the client.
    expect(Object.keys(res.body).sort()).toEqual(
      ['configFlags', 'connectionInfo', 'credentials', 'endpoint', 'recentActivity', 'stats'].sort(),
    );

    // WI-3: the overview carries the assembled connection-info (absolute URLs
    // + per-method Entra field set) so the UI never hand-builds URLs.
    expect(res.body.connectionInfo.endpointId).toBe(endpointId);
    expect(res.body.connectionInfo.urls.scimBaseUrl).toContain(`/scim/v2/endpoints/${endpointId}`);
    expect(Array.isArray(res.body.connectionInfo.enabledMethods)).toBe(true);
    expect(Array.isArray(res.body.connectionInfo.disabledMethods)).toBe(true);
    // No secret ever leaks through the overview.
    expect(JSON.stringify(res.body.connectionInfo)).not.toContain('bcrypt$');

    // Endpoint summary contract.
    expect(res.body.endpoint.id).toBe(endpointId);
    expect(res.body.endpoint).toHaveProperty('name');
    expect(res.body.endpoint).toHaveProperty('active');
    expect(res.body.endpoint).toHaveProperty('preset');
    expect(res.body.endpoint).toHaveProperty('scimBasePath');
    expect(res.body.endpoint).toHaveProperty('createdAt');

    // Stats shape - all counters are numbers (zero is acceptable for
    // a freshly created endpoint).
    expect(typeof res.body.stats.userCount).toBe('number');
    expect(typeof res.body.stats.activeUserCount).toBe('number');
    expect(typeof res.body.stats.groupCount).toBe('number');
    expect(typeof res.body.stats.activeGroupCount).toBe('number');
    expect(typeof res.body.stats.genericResourceCount).toBe('number');

    // Credentials default to [] (no per-endpoint creds yet).
    expect(Array.isArray(res.body.credentials)).toBe(true);

    // configFlags is always an object (even if empty).
    expect(typeof res.body.configFlags).toBe('object');
    expect(res.body.configFlags).not.toBeNull();
  });

  it('exposes a created credential WITHOUT leaking the hash', async () => {
    // Create an endpoint with PerEndpointCredentialsEnabled=True so the
    // credentials POST is permitted.
    const wk = process.env.JEST_WORKER_ID ?? '0';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const endpointRes = await request(app.getHttpServer() as any)
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({
        name: `e2e-overview-cred-w${wk}-${Date.now()}`,
        profilePreset: 'rfc-standard',
      })
      .expect(201);
    const endpointId = endpointRes.body.id as string;

    // Enable per-endpoint credentials via PATCH.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    await request(app.getHttpServer() as any)
      .patch(`/scim/admin/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ profile: { settings: { PerEndpointCredentialsEnabled: 'True' } } })
      .expect(200);

    // Mint a new credential.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const credRes = await request(app.getHttpServer() as any)
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ label: 'B1 overview test' })
      .expect(201);
    const credentialId = credRes.body.id as string;

    // Now hit the overview - the new credential should appear.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
    const overviewRes = await request(app.getHttpServer() as any)
      .get(`/scim/admin/endpoints/${endpointId}/overview`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(overviewRes.body.credentials.length).toBeGreaterThanOrEqual(1);
    const cred = overviewRes.body.credentials.find((c: any) => c.id === credentialId);
    expect(cred).toBeDefined();
    expect(cred.credentialType).toBe('bearer');
    expect(cred.label).toBe('B1 overview test');
    expect(cred.active).toBe(true);
    // The bcrypt hash MUST NOT appear under any key. Walk the entire
    // credential object to catch stray fields.
    for (const value of Object.values(cred)) {
      if (typeof value === 'string') {
        expect(value).not.toContain('$2'); // bcrypt prefix sentinel
      }
    }
    // And explicitly assert the well-known internal field is absent.
    expect(cred).not.toHaveProperty('credentialHash');
  });

  it('U2: an oauth_client credential surfaces its public oauthClientId (no secret)', async () => {
    const endpointRes = await request(app.getHttpServer() as any)
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ name: `e2e-overview-oc-${Date.now()}`, profilePreset: 'rfc-standard' })
      .expect(201);
    const endpointId = endpointRes.body.id as string;

    await request(app.getHttpServer() as any)
      .patch(`/scim/admin/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ profile: { settings: { OAuthClientCredentialsAuthEnabled: 'True' } } })
      .expect(200);

    const credRes = await request(app.getHttpServer() as any)
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialType: 'oauth_client', label: 'ISV client' })
      .expect(201);
    const credentialId = credRes.body.id as string;
    const clientId = credRes.body.clientId as string;

    const overviewRes = await request(app.getHttpServer() as any)
      .get(`/scim/admin/endpoints/${endpointId}/overview`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const cred = overviewRes.body.credentials.find((c: any) => c.id === credentialId);
    expect(cred).toBeDefined();
    expect(cred.credentialType).toBe('oauth_client');
    // U2 - the public client id is surfaced for the per-credential Connect view.
    expect(cred.oauthClientId).toBe(clientId);
    // No secret material leaks alongside it.
    expect(cred).not.toHaveProperty('credentialHash');
    expect(cred).not.toHaveProperty('clientSecret');
    expect(cred).not.toHaveProperty('secretEnvelope');
  });

  it('P7: the overview reports hashAlgo so the UI can flag credentials still on the legacy verifier', async () => {
    const endpointRes = await request(app.getHttpServer() as any)
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ name: `e2e-overview-algo-${Date.now()}`, profilePreset: 'rfc-standard' })
      .expect(201);
    const endpointId = endpointRes.body.id as string;

    await request(app.getHttpServer() as any)
      .patch(`/scim/admin/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ profile: { settings: { SecretTokenBearerAuthEnabled: 'True' } } })
      .expect(200);

    const credRes = await request(app.getHttpServer() as any)
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialType: 'bearer', label: 'algo probe' })
      .expect(201);
    const credentialId = credRes.body.id as string;

    const overviewRes = await request(app.getHttpServer() as any)
      .get(`/scim/admin/endpoints/${endpointId}/overview`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const cred = overviewRes.body.credentials.find((c: any) => c.id === credentialId);
    expect(cred).toBeDefined();
    // A credential minted today is keyed. Asserting the VALUE (not merely that
    // the key exists) is what makes the UI's Legacy/Keyed badge trustworthy -
    // a present-but-wrong algo would render a green badge over a legacy row.
    expect(cred.hashAlgo).toBe('hmac-sha256-v1');
    // The algo name is public, but it must not drag any secret material with it.
    expect(cred).not.toHaveProperty('credentialHash');
    expect(cred).not.toHaveProperty('secretHash');
    expect(cred).not.toHaveProperty('lookupKey');
  });

  it('X3/X4: a credential description is persisted and surfaced in the overview (never a secret)', async () => {
    const endpointRes = await request(app.getHttpServer() as any)
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ name: `e2e-overview-desc-${Date.now()}`, profilePreset: 'rfc-standard' })
      .expect(201);
    const endpointId = endpointRes.body.id as string;

    // Enable per-endpoint bearer credentials so the create is authorized.
    await request(app.getHttpServer() as any)
      .patch(`/scim/admin/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ profile: { settings: { PerEndpointCredentialsEnabled: 'True' } } })
      .expect(200);

    // Create a bearer credential carrying an operator description.
    const credRes = await request(app.getHttpServer() as any)
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialType: 'bearer', label: 'Prod', description: 'Entra user provisioning' })
      .expect(201);
    const credentialId = credRes.body.id as string;
    // The create response echoes the description.
    expect(credRes.body.description).toBe('Entra user provisioning');

    const overviewRes = await request(app.getHttpServer() as any)
      .get(`/scim/admin/endpoints/${endpointId}/overview`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const cred = overviewRes.body.credentials.find((c: any) => c.id === credentialId);
    expect(cred).toBeDefined();
    expect(cred.description).toBe('Entra user provisioning');
    // A whitespace-only description is normalized to null (no description).
    const blankRes = await request(app.getHttpServer() as any)
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialType: 'bearer', label: 'NoDesc', description: '   ' })
      .expect(201);
    expect(blankRes.body.description).toBeNull();
  });
});
