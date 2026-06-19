/**
 * Computed authenticationSchemes in per-endpoint /ServiceProviderConfig - E2E (A2)
 *
 * The endpoint's /ServiceProviderConfig advertises authenticationSchemes
 * COMPUTED from its enabled authentication methods (A1 CRUD): baseline
 * oauthbearertoken always present; each enabled method adds its scheme;
 * primary on defaultMethodId. A method-less endpoint advertises baseline only.
 *
 * @see docs/auth/AUTHENTICATION_ARCHITECTURE.md section 13 (A2)
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpoint } from './helpers/request.helper';

describe('Computed authenticationSchemes (A2)', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    token = await getAuthToken(app);
    endpointId = await createEndpoint(app, token);
  });

  afterAll(async () => {
    await app.close();
  });

  function spc() {
    return request(app.getHttpServer())
      .get(`/scim/endpoints/${endpointId}/ServiceProviderConfig`)
      .set('Authorization', `Bearer ${token}`);
  }

  function addMethod(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/authentication/methods`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  it('a method-less endpoint advertises only the baseline oauthbearertoken scheme', async () => {
    const res = await spc().expect(200);
    expect(res.body.authenticationSchemes).toHaveLength(1);
    expect(res.body.authenticationSchemes[0].type).toBe('oauthbearertoken');
    expect(res.body.authenticationSchemes[0].primary).toBe(true);
  });

  it('an enabled method adds its scheme alongside the baseline', async () => {
    await addMethod({ type: 'wif-7523', displayName: 'WIF', specUri: 'https://www.rfc-editor.org/rfc/rfc7523' }).expect(201);

    const res = await spc().expect(200);
    expect(res.body.authenticationSchemes.length).toBeGreaterThanOrEqual(2);
    const names = res.body.authenticationSchemes.map((s: { name: string }) => s.name);
    expect(names).toContain('OAuth Bearer Token');
    expect(names).toContain('WIF');
    const wif = res.body.authenticationSchemes.find((s: { name: string }) => s.name === 'WIF');
    expect(wif.type).toBe('oauth2');
  });

  it('exactly one scheme is primary', async () => {
    const res = await spc().expect(200);
    const primaries = res.body.authenticationSchemes.filter((s: { primary?: boolean }) => s.primary);
    expect(primaries).toHaveLength(1);
  });

  it('setting defaultMethodId moves primary onto that method scheme', async () => {
    // Add a second method and make it the default via the methods list.
    const added = await addMethod({ type: 'oauth-client', displayName: 'OAuth Client' }).expect(201);
    const methodId = added.body.id;

    // Update the endpoint's authentication block to set defaultMethodId.
    // (Re-submit the full block via the endpoint profile PATCH.)
    const list = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/authentication/methods`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/scim/admin/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        profile: {
          authentication: { schemaVersion: 1, methods: list.body.methods, defaultMethodId: methodId },
        },
      })
      .expect(200);

    const res = await spc().expect(200);
    const primaries = res.body.authenticationSchemes.filter((s: { primary?: boolean }) => s.primary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].name).toBe('OAuth Client');
  });
});
