import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpointWithConfig } from './helpers/request.helper';

/**
 * Per-type active-credential caps (P2) - over HTTP.
 *
 * The controller unit tests prove the decision; these prove the CONTRACT a
 * caller actually sees: which status, which body, and that the limit is per
 * type and counts only active credentials.
 *
 * Why the caps exist at all: the resource plane compares a presented opaque
 * token against EVERY active credential with bcrypt, measured at ~293 ms per
 * comparison at cost factor 12. Three credentials already exceed the 800 ms
 * latency gate, and that loop is reachable by an unauthenticated caller sending
 * any non-JWT token. The cap bounds the amplification; it is not the fix.
 */
describe('Active credential caps per type (P2) (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const createCred = (endpointId: string, credentialType: string) =>
    request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialType, label: `cap-${credentialType}` });

  const deactivate = (endpointId: string, credentialId: string) =>
    request(app.getHttpServer())
      .delete(`/scim/admin/endpoints/${endpointId}/credentials/${credentialId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

  it('P2-E1: refuses the create that would exceed the bearer cap, with 400 naming the flag', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
      MaxActiveBearerCredentials: 2,
    });

    await createCred(endpointId, 'bearer').expect(201);
    await createCred(endpointId, 'bearer').expect(201);

    const refused = await createCred(endpointId, 'bearer').expect(400);
    expect(JSON.stringify(refused.body)).toContain('MaxActiveBearerCredentials');
  });

  it('P2-E2: NEGATIVE CONTROL - the same third create succeeds when the cap allows it', async () => {
    // Without this, P2-E1 would also pass if creation were broken for an
    // unrelated reason, proving nothing about the cap.
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
      MaxActiveBearerCredentials: 3,
    });

    await createCred(endpointId, 'bearer').expect(201);
    await createCred(endpointId, 'bearer').expect(201);
    await createCred(endpointId, 'bearer').expect(201);
  });

  it('P2-E3: the cap is per TYPE - oauth_client does not consume the bearer budget', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
      OAuthClientCredentialsAuthEnabled: true,
      MaxActiveBearerCredentials: 1,
      MaxActiveOAuthClientCredentials: 1,
    });

    await createCred(endpointId, 'bearer').expect(201);
    // The bearer budget is now full, but oauth_client has its own.
    await createCred(endpointId, 'oauth_client').expect(201);
    // ...and each is independently enforced.
    await createCred(endpointId, 'bearer').expect(400);
    await createCred(endpointId, 'oauth_client').expect(400);
  });

  it('P2-E4: only ACTIVE credentials count - deactivating one frees a slot', async () => {
    // The bcrypt loop iterates findActiveByEndpoint, so an inactive credential
    // costs nothing and must not occupy the budget.
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
      MaxActiveBearerCredentials: 1,
    });

    const first = await createCred(endpointId, 'bearer').expect(201);
    await createCred(endpointId, 'bearer').expect(400);

    await deactivate(endpointId, first.body.id as string);
    await createCred(endpointId, 'bearer').expect(201);
  });

  it('P2-E5: an endpoint that sets no cap still gets a bounded default, not unlimited', async () => {
    // Absence must resolve to the registry default. An absent limit and an
    // infinite limit must never be the same thing.
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
    });

    // Default is 5; the sixth must be refused without any cap being configured.
    for (let i = 0; i < 5; i++) await createCred(endpointId, 'bearer').expect(201);
    const refused = await createCred(endpointId, 'bearer').expect(400);
    expect(JSON.stringify(refused.body)).toContain('MaxActiveBearerCredentials');
  });

  it('P2-E6: an out-of-bounds cap is rejected when the endpoint is configured', async () => {
    // The bound is published in the registry, so it must be enforced on write
    // rather than silently clamped at read time.
    await request(app.getHttpServer())
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({
        name: `cap-bounds-${Date.now()}`,
        profile: { settings: { MaxActiveBearerCredentials: 999 } },
      })
      .expect(400);
  });
});
