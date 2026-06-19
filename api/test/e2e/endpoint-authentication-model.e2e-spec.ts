/**
 * Endpoint authentication model - E2E (A0, inert)
 *
 * Verifies that `profile.authentication` (methods + schemaVersion + defaultMethodId)
 * persists and round-trips through endpoint create + GET in BOTH the create
 * response and the read response, that secret-looking config keys never appear
 * in any response (the no-secret contract), and that endpoints created without
 * an authentication block are unaffected (backward compatible).
 *
 * The model is INERT in A0: it is stored and returned but not yet consulted by
 * any auth resolver.
 *
 * @see docs/auth/AUTHENTICATION_ARCHITECTURE.md section 5.2 / 6.2 (A0)
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';

const USER_URN = 'urn:ietf:params:scim:schemas:core:2.0:User';

function profileWithAuth(secretInConfig = false): Record<string, unknown> {
  return {
    schemas: [{ id: USER_URN, name: 'User', attributes: [{ name: 'userName' }] }],
    resourceTypes: [
      { id: 'User', name: 'User', endpoint: '/Users', description: 'User', schema: USER_URN, schemaExtensions: [] },
    ],
    authentication: {
      schemaVersion: 1,
      methods: [
        {
          id: 'm-1',
          type: 'wif-7523',
          displayName: 'WIF (JWT Bearer Assertion)',
          plane: 'token',
          tokenEndpointAuthMethod: 'private_key_jwt',
          config: {
            issuer: 'https://login.microsoftonline.com/tid/v2.0',
            audience: 'appid-guid',
            jwksUri: 'https://login.microsoftonline.com/tid/discovery/v2.0/keys',
            ...(secretInConfig ? { clientSecret: 'LEAK-SECRET', privateKey: 'LEAK-PRIVATE-KEY' } : {}),
          },
          credentialRef: 'cred-1',
        },
      ],
      defaultMethodId: 'm-1',
    },
  };
}

describe('Endpoint authentication model (A0, inert)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  function createWith(body: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  it('persists + round-trips profile.authentication on create', async () => {
    const res = await createWith({
      name: `auth-model-create-${Date.now()}`,
      profile: profileWithAuth(),
    }).expect(201);

    const auth = res.body.profile.authentication;
    expect(auth).toBeDefined();
    expect(auth.schemaVersion).toBe(1);
    expect(auth.methods).toHaveLength(1);
    expect(auth.methods[0].id).toBe('m-1');
    expect(auth.methods[0].type).toBe('wif-7523');
    expect(auth.methods[0].plane).toBe('token');
    expect(auth.methods[0].config).toEqual({
      issuer: 'https://login.microsoftonline.com/tid/v2.0',
      audience: 'appid-guid',
      jwksUri: 'https://login.microsoftonline.com/tid/discovery/v2.0/keys',
    });
    expect(auth.methods[0].credentialRef).toBe('cred-1');
    expect(auth.defaultMethodId).toBe('m-1');
  });

  it('round-trips profile.authentication on GET /admin/endpoints/:id', async () => {
    const created = await createWith({
      name: `auth-model-get-${Date.now()}`,
      profile: profileWithAuth(),
    }).expect(201);
    const id = created.body.id;

    const got = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(got.body.profile.authentication.methods[0].id).toBe('m-1');
    expect(got.body.profile.authentication.defaultMethodId).toBe('m-1');
  });

  it('strips secret-looking config keys - no secret appears anywhere in the response', async () => {
    const res = await createWith({
      name: `auth-model-secret-${Date.now()}`,
      profile: profileWithAuth(true),
    }).expect(201);

    const cfg = res.body.profile.authentication.methods[0].config;
    expect(cfg.issuer).toBe('https://login.microsoftonline.com/tid/v2.0');
    expect(cfg.clientSecret).toBeUndefined();
    expect(cfg.privateKey).toBeUndefined();

    // The no-secret contract: the submitted secret values must not appear
    // anywhere in the serialized response body.
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('LEAK-SECRET');
    expect(serialized).not.toContain('LEAK-PRIVATE-KEY');
  });

  it('leaves profile.authentication undefined for endpoints created without it', async () => {
    const res = await createWith({
      name: `auth-model-none-${Date.now()}`,
      profilePreset: 'rfc-standard',
    }).expect(201);

    expect(res.body.profile.authentication).toBeUndefined();
  });

  it('preserves profile.authentication across an unrelated settings PATCH', async () => {
    const created = await createWith({
      name: `auth-model-patch-${Date.now()}`,
      profile: profileWithAuth(),
    }).expect(201);
    const id = created.body.id;

    await request(app.getHttpServer())
      .patch(`/scim/admin/endpoints/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ profile: { settings: { StrictSchemaValidation: false } } })
      .expect(200);

    const got = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(got.body.profile.authentication).toBeDefined();
    expect(got.body.profile.authentication.methods[0].id).toBe('m-1');
  });
});
