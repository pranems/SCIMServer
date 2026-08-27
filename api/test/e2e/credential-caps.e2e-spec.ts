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

  it('P2-E7: REACTIVATION cannot be used to exceed the cap', async () => {
    // Found by the Stage 3b.4 security audit, not by the original spec. Because
    // deactivating frees a slot, the reverse operation must consume one -
    // otherwise: fill to the cap, deactivate all, fill again, then reactivate
    // the first batch = twice the cap, repeatable without limit. A cap that can
    // be walked around is decorative, and this one exists to bound an
    // unauthenticated bcrypt amplification.
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
      MaxActiveBearerCredentials: 2,
    });

    const a = await createCred(endpointId, 'bearer').expect(201);
    const b = await createCred(endpointId, 'bearer').expect(201);

    await deactivate(endpointId, a.body.id as string);
    await deactivate(endpointId, b.body.id as string);

    // Budget is free again, so two fresh credentials are legitimate.
    await createCred(endpointId, 'bearer').expect(201);
    await createCred(endpointId, 'bearer').expect(201);

    // Reviving either of the originals would make four active against a cap of two.
    const revived = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/${a.body.id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    expect(JSON.stringify(revived.body)).toContain('MaxActiveBearerCredentials');
  });

  it('P2-E8: NEGATIVE CONTROL - reactivation still works when there is room', async () => {
    // Without this, E7 would also pass if reactivation were simply broken.
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
      MaxActiveBearerCredentials: 2,
    });

    const a = await createCred(endpointId, 'bearer').expect(201);
    await deactivate(endpointId, a.body.id as string);

    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/${a.body.id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  it('P2-E9: ROTATION is exempt - a compromised secret can always be replaced at the cap', async () => {
    // Rotation is net-neutral (new minted, old deactivated). Refusing it at the
    // cap would block the one operation you most want available during an
    // incident, so the exemption is deliberate rather than an oversight.
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
      MaxActiveBearerCredentials: 1,
    });

    const a = await createCred(endpointId, 'bearer').expect(201);
    await createCred(endpointId, 'bearer').expect(400); // cap is genuinely reached

    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/${a.body.id}/rotate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
  });
});
