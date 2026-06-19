/**
 * WIF (RFC 7523 jwt-bearer) end-to-end - Q6.
 *
 * The full federated-identity vertical slice:
 *  - An admin enables WIF + persists a `wif` trust (all public values, no secret).
 *  - An ISV presents a signed Entra-style `client_assertion` at the per-endpoint
 *    token endpoint -> SCIMServer validates it against the trust's JWKS and mints
 *    the ISV's OWN short-lived, endpoint-scoped token.
 *  - That minted token authorizes the endpoint's SCIM routes.
 *  - A wrong issuer / tenant / missing role each -> `invalid_client`.
 *  - The `wif` credential response carries NO secret/hash.
 *
 * The remote JWKS fetch is overridden with a local in-memory key set so no
 * network is touched; the signature path is otherwise the real `jose` code.
 *
 * @see docs/auth/WIF_JWT_BEARER_ASSERTION_FOR_SCIM.md section 13 (Q6)
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as crypto from 'node:crypto';
import { exportJWK, importJWK, SignJWT } from 'jose';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpointWithConfig } from './helpers/request.helper';
import { JWKS_FETCH } from '@app/oauth/external-jwks-validator.service';

const JWT_BEARER = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
const KID = 'wif-e2e-kid';
const ISSUER = 'https://login.microsoftonline.com/tenant-e2e/v2.0';
const JWKS_URI = 'https://login.microsoftonline.com/tenant-e2e/discovery/v2.0/keys';
const SUBJECT = 'sp-object-id-e2e';
const AUDIENCE = 'api://scimserver-e2e';
const TENANT = 'tenant-e2e';

function decodePayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'));
}

describe('WIF jwt-bearer assertion (Q6)', () => {
  let app: INestApplication;
  let adminToken: string;
  let endpointId: string;
  let privateKey: crypto.KeyObject;

  /** Sign an RS256 assertion with the test key, overriding claims as needed. */
  async function signAssertion(overrides: Record<string, unknown> = {}): Promise<string> {
    const pj = await exportJWK(privateKey);
    const key = await importJWK({ ...pj, alg: 'RS256' }, 'RS256');
    return new SignJWT({
      iss: ISSUER,
      sub: SUBJECT,
      aud: AUDIENCE,
      tid: TENANT,
      roles: ['Scim.Provision'],
      ...overrides,
    })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(key);
  }

  beforeAll(async () => {
    // Allow the test issuer's JWKS host (anti-SSRF allowlist is read from env).
    process.env.JWKS_HOST_ALLOWLIST = 'login.microsoftonline.com';

    // Generate a local RSA key + JWKS; the fetch override returns this key set.
    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = pair.privateKey;
    const jwk = (await exportJWK(pair.publicKey)) as unknown as Record<string, unknown>;
    jwk.kid = KID;
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    const jwks = { keys: [jwk] };
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => jwks });

    app = await createTestApp((builder) => builder.overrideProvider(JWKS_FETCH).useValue(fetchMock));
    adminToken = await getAuthToken(app);
    endpointId = await createEndpointWithConfig(app, adminToken, {
      WifCredentialsEnabled: 'True',
    });

    // Persist the WIF trust (all public values matching the signed assertion).
    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        credentialType: 'wif',
        label: 'Entra WIF (E2E)',
        wif: {
          assertionProfile: 'jwt-bearer',
          expectedIssuer: ISSUER,
          expectedSubject: SUBJECT,
          expectedAudience: AUDIENCE,
          jwksUri: JWKS_URI,
          allowedTenantId: TENANT,
          requiredRoles: ['Scim.Provision'],
          scope: 'scim.read scim.write',
          issuedTokenTtlSec: 7200,
        },
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  function postAssertion(assertion: string) {
    return request(app.getHttpServer())
      .post(`/scim/endpoints/${endpointId}/oauth/token`)
      .type('form')
      .send({ grant_type: 'client_credentials', client_assertion: assertion, client_assertion_type: JWT_BEARER });
  }

  it('mints the endpoint token for a valid assertion (accept)', async () => {
    const assertion = await signAssertion();
    const res = await postAssertion(assertion).expect(201);

    expect(res.body.token_type).toBe('Bearer');
    expect(typeof res.body.access_token).toBe('string');
    expect(res.body.expires_in).toBe(7200);
    expect(res.body.scope).toBe('scim.read scim.write');

    const payload = decodePayload(res.body.access_token);
    expect(payload.endpoint_id).toBe(endpointId);
    expect(payload.sub).toBe(SUBJECT);
  });

  it('the minted token authorizes the endpoint SCIM routes', async () => {
    const assertion = await signAssertion();
    const tokenRes = await postAssertion(assertion).expect(201);
    const minted = tokenRes.body.access_token;

    await request(app.getHttpServer())
      .get(`/scim/endpoints/${endpointId}/Users`)
      .set('Authorization', `Bearer ${minted}`)
      .expect(200);
  });

  it('rejects a wrong issuer with invalid_client', async () => {
    const assertion = await signAssertion({ iss: 'https://evil.example/v2.0' });
    const res = await postAssertion(assertion).expect(401);
    expect(res.body.detail).toBe('invalid_client');
  });

  it('rejects a wrong tenant id with invalid_client (cross-tenant isolation)', async () => {
    const assertion = await signAssertion({ tid: 'tenant-other' });
    const res = await postAssertion(assertion).expect(401);
    expect(res.body.detail).toBe('invalid_client');
  });

  it('rejects an assertion missing the required role with invalid_client', async () => {
    const assertion = await signAssertion({ roles: ['Scim.Read'] });
    const res = await postAssertion(assertion).expect(401);
    expect(res.body.detail).toBe('invalid_client');
  });

  it('never returns a secret/hash on the wif credential (no-secret contract)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const wifRows = res.body.filter((c: { credentialType: string }) => c.credentialType === 'wif');
    expect(wifRows.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('credentialHash');
    expect(serialized).not.toContain('clientSecret');
    for (const row of wifRows) {
      expect(row).not.toHaveProperty('credentialHash');
      expect(row).not.toHaveProperty('token');
      expect(row).not.toHaveProperty('clientSecret');
    }
  });

  // ─── Q6.6 - discovery advertisement gated by WifCredentialsEnabled ──────────
  it('the WIF-enabled endpoint advertises the WIF scheme in /ServiceProviderConfig', async () => {
    const res = await request(app.getHttpServer())
      .get(`/scim/endpoints/${endpointId}/ServiceProviderConfig`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const names = (res.body.authenticationSchemes as Array<{ name: string }>).map((s) => s.name);
    expect(names).toContain('OAuth Bearer Token');
    expect(names).toContain('Workload Identity Federation');
  });

  it('a non-WIF endpoint advertises ONLY oauthbearertoken (no WIF scheme)', async () => {
    const plainEndpoint = await createEndpointWithConfig(app, adminToken, {});
    const res = await request(app.getHttpServer())
      .get(`/scim/endpoints/${plainEndpoint}/ServiceProviderConfig`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const names = (res.body.authenticationSchemes as Array<{ name: string }>).map((s) => s.name);
    expect(names).not.toContain('Workload Identity Federation');
    expect(names).toContain('OAuth Bearer Token');
  });
});
