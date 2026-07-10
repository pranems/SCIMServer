/**
 * WIF (RFC 7523 jwt-bearer) end-to-end - Q6.
 *
 * The full federated-identity vertical slice:
 *  - An admin enables WIF + persists a `wif` trust (all public values, no secret).
 *  - An ISV presents a signed Entra-style `client_assertion` at the per-endpoint
 *    token endpoint -> SCIMServer validates it against the trust's JWKS and mints
 *    the ISV's OWN short-lived, endpoint-scoped token.
 *  - That minted token authorizes the endpoint's SCIM routes.
 *  - A wrong issuer / tenant -> `invalid_client`. A missing role is ADVISORY
 *    by default (allowed + logged); it rejects only when the trust opts into
 *    `roleEnforcement: 'enforce'`.
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
    // Content-aware mock: a discovery URL returns an OIDC discovery doc (for the
    // WI-14 resolver); anything else returns the JWKS key set (for verify).
    const discoveryDoc = {
      issuer: ISSUER,
      jwks_uri: JWKS_URI,
    };
    const fetchMock = jest.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: async () =>
          typeof url === 'string' && url.includes('.well-known/openid-configuration') ? discoveryDoc : jwks,
      }),
    );

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
    // WI-17: the minted token is source-stamped with the winning trust's issuer.
    expect(payload.src_iss).toBe(ISSUER);
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

  // ─── WI-16 - multiple WIF trusts on one endpoint (iterate, not first-only) ──
  it('WI-16: an endpoint with TWO wif trusts mints when the assertion matches the second', async () => {
    // A dedicated endpoint carrying two WIF trusts: the FIRST (issuer-A) does
    // NOT match the signed assertion; the SECOND is the real issuer. Proves the
    // provider iterates every trust instead of stopping at the first.
    const multiEndpoint = await createEndpointWithConfig(app, adminToken, {
      WifCredentialsEnabled: 'True',
    });

    // Trust 1 - a different issuer that the assertion will NOT satisfy.
    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${multiEndpoint}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        credentialType: 'wif',
        label: 'Trust A (non-matching issuer)',
        wif: {
          assertionProfile: 'jwt-bearer',
          expectedIssuer: 'https://login.microsoftonline.com/tenant-other/v2.0',
          expectedSubject: SUBJECT,
          expectedAudience: AUDIENCE,
          jwksUri: JWKS_URI,
          allowedTenantId: 'tenant-other',
          requiredRoles: ['Scim.Provision'],
          scope: 'scim.read',
          issuedTokenTtlSec: 3600,
        },
      })
      .expect(201);

    // Trust 2 - the real issuer the assertion is signed for.
    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${multiEndpoint}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        credentialType: 'wif',
        label: 'Trust B (matching issuer)',
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

    const assertion = await signAssertion();
    const res = await request(app.getHttpServer())
      .post(`/scim/endpoints/${multiEndpoint}/oauth/token`)
      .type('form')
      .send({ grant_type: 'client_credentials', client_assertion: assertion, client_assertion_type: JWT_BEARER })
      .expect(201);

    // Minted against the SECOND trust (its scope + ttl, not trust A's).
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBe(7200);
    expect(res.body.scope).toBe('scim.read scim.write');
    const payload = decodePayload(res.body.access_token);
    expect(payload.endpoint_id).toBe(multiEndpoint);
  });

  it('WI-16: an endpoint whose wif trusts ALL reject the assertion returns invalid_client', async () => {
    const multiEndpoint = await createEndpointWithConfig(app, adminToken, {
      WifCredentialsEnabled: 'True',
    });
    // Two trusts, neither matching the assertion's issuer/tenant.
    for (const tenant of ['tenant-x', 'tenant-y']) {
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${multiEndpoint}/credentials`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          credentialType: 'wif',
          label: `Trust ${tenant}`,
          wif: {
            assertionProfile: 'jwt-bearer',
            expectedIssuer: `https://login.microsoftonline.com/${tenant}/v2.0`,
            expectedSubject: SUBJECT,
            expectedAudience: AUDIENCE,
            jwksUri: JWKS_URI,
            allowedTenantId: tenant,
            requiredRoles: ['Scim.Provision'],
            issuedTokenTtlSec: 3600,
          },
        })
        .expect(201);
    }

    const assertion = await signAssertion(); // iss=ISSUER, tid=TENANT - matches neither
    const res = await request(app.getHttpServer())
      .post(`/scim/endpoints/${multiEndpoint}/oauth/token`)
      .type('form')
      .send({ grant_type: 'client_credentials', client_assertion: assertion, client_assertion_type: JWT_BEARER })
      .expect(401);
    expect(res.body.detail).toBe('invalid_client');
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

  it('ALLOWS an assertion missing the required role by default (advisory roles)', async () => {
    // The main endpoint's trust has requiredRoles:['Scim.Provision'] but no
    // roleEnforcement, so a missing role is advisory: the token still mints
    // and the provisioning flow continues to the next step.
    const assertion = await signAssertion({ roles: ['Scim.Read'] });
    const res = await postAssertion(assertion).expect(201);
    expect(res.body.access_token).toBeTruthy();
  });

  it('rejects a missing required role ONLY when the trust opts into roleEnforcement:enforce', async () => {
    // A dedicated endpoint whose trust enforces roles.
    const enforceEndpoint = await createEndpointWithConfig(app, adminToken, {
      WifCredentialsEnabled: 'True',
    });
    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${enforceEndpoint}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        credentialType: 'wif',
        label: 'Enforced-roles trust',
        wif: {
          expectedIssuer: ISSUER,
          expectedSubject: SUBJECT,
          expectedAudience: AUDIENCE,
          jwksUri: JWKS_URI,
          allowedTenantId: TENANT,
          requiredRoles: ['Scim.Provision'],
          roleEnforcement: 'enforce',
        },
      })
      .expect(201);

    // Missing the required role -> rejected with invalid_client.
    const missing = await signAssertion({ roles: ['Scim.Read'] });
    const rejected = await request(app.getHttpServer())
      .post(`/scim/endpoints/${enforceEndpoint}/oauth/token`)
      .type('form')
      .send({ grant_type: 'client_credentials', client_assertion: missing, client_assertion_type: JWT_BEARER })
      .expect(401);
    expect(rejected.body.detail).toBe('invalid_client');

    // With the required role present -> mints.
    const ok = await signAssertion({ roles: ['Scim.Provision'] });
    await request(app.getHttpServer())
      .post(`/scim/endpoints/${enforceEndpoint}/oauth/token`)
      .type('form')
      .send({ grant_type: 'client_credentials', client_assertion: ok, client_assertion_type: JWT_BEARER })
      .expect(201);
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

  // ─── WI-13 - claim-name input aliases + expectedTenantId ───────────────────
  it('WI-13: accepts bare claim-name aliases (iss/sub/aud/tid/roles) and mints', async () => {
    const aliasEndpoint = await createEndpointWithConfig(app, adminToken, {
      WifCredentialsEnabled: 'True',
    });

    // Create the trust using ONLY the bare claim-name aliases + expectedTenantId.
    const created = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${aliasEndpoint}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        credentialType: 'wif',
        label: 'Alias-shaped trust',
        wif: {
          iss: ISSUER,
          sub: SUBJECT,
          aud: AUDIENCE,
          jwksUri: JWKS_URI,
          expectedTenantId: TENANT,
          roles: ['Scim.Provision'],
          scope: 'scim.read scim.write',
          issuedTokenTtlSec: 7200,
        },
      })
      .expect(201);

    // The echoed public trust carries the CANONICAL keys, not the aliases.
    expect(created.body.wif).toMatchObject({
      expectedIssuer: ISSUER,
      expectedSubject: SUBJECT,
      expectedAudience: AUDIENCE,
      allowedTenantId: TENANT,
      requiredRoles: ['Scim.Provision'],
    });
    expect(created.body.wif).not.toHaveProperty('iss');
    expect(created.body.wif).not.toHaveProperty('tid');
    expect(created.body.wif).not.toHaveProperty('expectedTenantId');

    // And the alias-created trust actually works: a valid assertion mints.
    const assertion = await signAssertion();
    const res = await request(app.getHttpServer())
      .post(`/scim/endpoints/${aliasEndpoint}/oauth/token`)
      .type('form')
      .send({ grant_type: 'client_credentials', client_assertion: assertion, client_assertion_type: JWT_BEARER })
      .expect(201);
    expect(res.body.token_type).toBe('Bearer');
    const payload = decodePayload(res.body.access_token);
    expect(payload.endpoint_id).toBe(aliasEndpoint);
  });

  // ─── WI-12 - per-endpoint RFC 8414 OAuth AS metadata (append form) ─────────
  it('WI-12: serves per-endpoint OAuth AS metadata at the append-form well-known path', async () => {
    const res = await request(app.getHttpServer())
      .get(`/scim/endpoints/${endpointId}/.well-known/oauth-authorization-server`)
      .expect(200);

    // RFC 8414 section 3.3 - issuer MUST equal the identifier used to build the URL.
    expect(res.body.issuer).toMatch(new RegExp(`/scim/endpoints/${endpointId}$`));
    // token_endpoint must be the PER-ENDPOINT one.
    expect(res.body.token_endpoint).toMatch(
      new RegExp(`/scim/endpoints/${endpointId}/oauth/token$`),
    );
    // jwks_uri points at the SHARED global key set.
    expect(res.body.jwks_uri).toMatch(/\/scim\/oauth\/jwks$/);
    expect(res.body.grant_types_supported).toContain('client_credentials');
  });

  it('WI-12: per-endpoint metadata is public (no bearer required) and self-consistent', async () => {
    const res = await request(app.getHttpServer())
      .get(`/scim/endpoints/${endpointId}/.well-known/oauth-authorization-server`)
      .expect(200);
    // The token_endpoint URL must start with the issuer identifier (self-consistency).
    expect(res.body.token_endpoint.startsWith(res.body.issuer)).toBe(true);
  });

  // ─── WI-14 - config-time WIF discovery resolver ───────────────────────────
  it('WI-14: resolves the WIF signing-trust fields from a full discovery URL (Mode A)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/wif/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ discoveryUrl: `${ISSUER}/.well-known/openid-configuration` })
      .expect(201);

    expect(res.body.expectedIssuer).toBe(ISSUER);
    expect(res.body.jwksUri).toBe(JWKS_URI);
    // Audience defaults to the endpointId.
    expect(res.body.expectedAudience).toBe(endpointId);
  });

  it('WI-14: resolves from a preset + tenantId (Mode B)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/wif/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ preset: 'entra-commercial', tenantId: TENANT })
      .expect(201);
    expect(res.body.expectedIssuer).toBe(ISSUER);
  });

  it('WI-14: rejects a discovery host not on the JWKS allowlist (SSRF)', async () => {
    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/wif/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ discoveryUrl: 'https://evil.example/.well-known/openid-configuration' })
      .expect(400);
  });

  it('WI-14: the FIRST oauth_client on an endpoint defaults client_id to the endpointId', async () => {
    const ocEndpoint = await createEndpointWithConfig(app, adminToken, {
      OAuthClientCredentialsAuthEnabled: 'True',
    });
    const res = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${ocEndpoint}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ credentialType: 'oauth_client', label: 'wi14-default-id' })
      .expect(201);
    expect(res.body.clientId).toBe(ocEndpoint);
    expect(typeof res.body.clientSecret).toBe('string');
  });

  // ─── WI-15 - runtime-editable JWKS host allowlist ─────────────────────────
  it('WI-15: the allowlist view exposes the seed + env + effective union', async () => {
    const res = await request(app.getHttpServer())
      .get('/scim/admin/settings/jwks-hosts')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    // The well-known seed is present out of the box.
    expect(res.body.seed).toEqual(expect.arrayContaining(['login.microsoftonline.com']));
    // The env host set for this suite is present.
    expect(res.body.env).toContain('login.microsoftonline.com');
    expect(res.body.effective).toEqual(expect.arrayContaining(['login.microsoftonline.com']));
  });

  it('WI-15: adding a host at runtime makes discovery against it succeed (hot-reload)', async () => {
    const NEW_HOST = 'idp.contoso-runtime.example.com';
    // Before adding, a discovery against the host is SSRF-rejected.
    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/wif/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ discoveryUrl: `https://${NEW_HOST}/.well-known/openid-configuration` })
      .expect(400);

    // Add the host at runtime.
    const addRes = await request(app.getHttpServer())
      .post('/scim/admin/settings/jwks-hosts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ host: NEW_HOST, label: 'contoso runtime' })
      .expect(201);
    expect(addRes.body.persisted).toContain(NEW_HOST);

    // The discovery mock returns a doc whose issuer/jwks_uri hosts are the
    // Entra host (allowlisted), so the resolve now passes the discovery-host
    // SSRF check for NEW_HOST and proceeds.
    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/wif/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ discoveryUrl: `https://${NEW_HOST}/.well-known/openid-configuration` })
      .expect(201);

    // Remove it; discovery is rejected again.
    await request(app.getHttpServer())
      .delete(`/scim/admin/settings/jwks-hosts/${NEW_HOST}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/wif/resolve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ discoveryUrl: `https://${NEW_HOST}/.well-known/openid-configuration` })
      .expect(400);
  });

  it('WI-15: rejects a non-bare-hostname add (scheme/path/spaces)', async () => {
    await request(app.getHttpServer())
      .post('/scim/admin/settings/jwks-hosts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ host: 'https://evil.example/keys' })
      .expect(400);
  });
});
