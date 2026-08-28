import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpointWithConfig } from './helpers/request.helper';

/**
 * N8 - the server must not advertise an authentication scheme it cannot enforce.
 *
 * `mtls`, `dpop` and `oauth-authcode` are declarable on an endpoint but no
 * authenticator implements any of them. They used to appear in
 * `ServiceProviderConfig.authenticationSchemes`, which is the document a client
 * reads to decide HOW to authenticate. Advertising them was worse than not
 * offering them: an integrator configures `mtls`, sees it advertised, and only
 * discovers it was decorative when requests behave in ways the document does not
 * explain.
 *
 * These run over HTTP rather than only as unit tests because discovery is a
 * published contract, and the thing that matters is what a client actually
 * receives on the wire.
 */
describe('N8 - discovery advertises only enforceable auth schemes (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const addMethod = (endpointId: string, type: string, displayName: string) =>
    request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/authentication/methods`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ type, displayName, enabled: true });

  const spc = (endpointId: string) =>
    request(app.getHttpServer())
      .get(`/scim/endpoints/${endpointId}/ServiceProviderConfig`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

  it('N8-E1: an enabled mtls/dpop/oauth-authcode method is NOT advertised', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {});

    for (const type of ['mtls', 'dpop', 'oauth-authcode']) {
      await addMethod(endpointId, type, `unenforced-${type}`).expect(201);
    }

    const res = await spc(endpointId);
    const schemes = res.body.authenticationSchemes as Array<Record<string, unknown>>;
    const names = schemes.map((s) => String(s.name));

    for (const type of ['mtls', 'dpop', 'oauth-authcode']) {
      expect(names).not.toContain(`unenforced-${type}`);
    }
    // Only the always-true baseline remains.
    expect(schemes).toHaveLength(1);
    expect(schemes[0].type).toBe('oauthbearertoken');
  });

  it('N8-E2: NEGATIVE CONTROL - an enforceable method IS still advertised', async () => {
    // Without this, N8-E1 would also pass if the endpoint simply advertised
    // nothing, or if adding methods were broken.
    const endpointId = await createEndpointWithConfig(app, token, {});
    await addMethod(endpointId, 'oauth-client', 'advertised-oauth-client').expect(201);

    const res = await spc(endpointId);
    const names = (res.body.authenticationSchemes as Array<Record<string, unknown>>)
      .map((s) => String(s.name));
    expect(names).toContain('advertised-oauth-client');
  });

  it('N8-E3: the unenforceable method is still DECLARABLE and readable via the admin API', async () => {
    // Dropping it from discovery must not delete it from the profile - existing
    // endpoints that already name it keep loading, and the operator can still
    // see what they configured.
    const endpointId = await createEndpointWithConfig(app, token, {});
    await addMethod(endpointId, 'mtls', 'still-declared').expect(201);

    const listed = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/authentication/methods`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = JSON.stringify(listed.body);
    expect(body).toContain('still-declared');
    expect(body).toContain('mtls');
  });

  it('N8-E4: exactly one advertised scheme is primary even when the default is unenforceable', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {});
    const created = await addMethod(endpointId, 'dpop', 'default-but-unenforced').expect(201);
    const methodId = (created.body as Record<string, unknown>).id as string;

    await request(app.getHttpServer())
      .patch(`/scim/admin/endpoints/${endpointId}/authentication/methods/${methodId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ enabled: true });

    const res = await spc(endpointId);
    const schemes = res.body.authenticationSchemes as Array<Record<string, unknown>>;
    // `primary` must not be orphaned onto a scheme that was never emitted.
    expect(schemes.filter((s) => s.primary === true)).toHaveLength(1);
  });
});
