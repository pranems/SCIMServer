import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpointWithConfig } from './helpers/request.helper';

/**
 * U8 (E2E) - WIF `allowedTenantId` gleaning from the issuer / JWKS URI.
 *
 * When an operator creates a WIF trust without an explicit `allowedTenantId`,
 * the server infers it from the Entra tenant GUID embedded in the issuer (or,
 * failing that, the JWKS URI) and records which input it came from. A trust
 * with no inferable GUID and no explicit tenant is rejected.
 */
describe('WIF tenant gleaning (U8) (E2E)', () => {
  let app: INestApplication;
  let token: string;
  const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  function createWif(endpointId: string, wif: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialType: 'wif', label: 'glean', wif });
  }

  it('gleans allowedTenantId from the issuer and records the source', async () => {
    const endpointId = await createEndpointWithConfig(app, token, { WifCredentialsEnabled: true });
    const res = await createWif(endpointId, {
      expectedIssuer: `https://login.microsoftonline.com/${TENANT}/v2.0`,
      expectedSubject: 'sp-obj-id',
      expectedAudience: 'api://appid',
      jwksUri: `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`,
    }).expect(201);
    expect(res.body.wif.allowedTenantId).toBe(TENANT);
    expect(res.body.wif.allowedTenantIdSource).toBe('issuer');
  });

  it('falls back to the JWKS URI when the issuer carries no tenant GUID', async () => {
    const endpointId = await createEndpointWithConfig(app, token, { WifCredentialsEnabled: true });
    const res = await createWif(endpointId, {
      expectedIssuer: 'https://accounts.google.com',
      expectedSubject: 'sub',
      expectedAudience: 'appid',
      jwksUri: `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`,
    }).expect(201);
    expect(res.body.wif.allowedTenantId).toBe(TENANT);
    expect(res.body.wif.allowedTenantIdSource).toBe('jwksUri');
  });

  it('does not override an explicit allowedTenantId and adds no source marker', async () => {
    const endpointId = await createEndpointWithConfig(app, token, { WifCredentialsEnabled: true });
    const res = await createWif(endpointId, {
      expectedIssuer: `https://login.microsoftonline.com/${TENANT}/v2.0`,
      expectedSubject: 'sub',
      expectedAudience: 'appid',
      jwksUri: `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`,
      allowedTenantId: 'explicit-tenant',
    }).expect(201);
    expect(res.body.wif.allowedTenantId).toBe('explicit-tenant');
    expect(res.body.wif.allowedTenantIdSource).toBeUndefined();
  });

  it('rejects a non-inferable trust with no explicit tenant (400)', async () => {
    const endpointId = await createEndpointWithConfig(app, token, { WifCredentialsEnabled: true });
    await createWif(endpointId, {
      expectedIssuer: 'https://accounts.google.com',
      expectedSubject: 'sub',
      expectedAudience: 'appid',
      jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
    }).expect(400);
  });
});
