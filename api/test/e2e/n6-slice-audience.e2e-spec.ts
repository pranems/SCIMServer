/**
 * N6 - slice-dependent assertion audience (E2E).
 *
 * SyncFabric composes the requested scope differently depending on which
 * acquisition chain is active, so Entra mints a different `aud`:
 *
 *   CustomerApplication (legacy)   -> api://<appId>
 *   FirstPartyApplication (new)    -> api://<appId>/<normalizedDnsHost>
 *
 * The chain is selected by `workloadIdentityFirstPartyApplicationIsDefault`,
 * which is enabled on slices A and B and disabled globally - so the shape
 * SCIMServer receives depends on which slice serves the job, and no change on
 * our side is involved.
 *
 * The documented remedy (see docs/auth/N6_SLICE_DEPENDENT_AUDIENCE_RUNBOOK.md)
 * is to register BOTH forms as two trusts. This spec is what stops that runbook
 * becoming an unverified claim: it proves the remedy end-to-end, over real HTTP,
 * with real RS256 assertions.
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
const KID = 'n6-e2e-kid';
const TENANT = 'tenant-n6';
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const JWKS_URI = `https://login.microsoftonline.com/${TENANT}/discovery/v2.0/keys`;
const SUBJECT = 'sp-object-id-n6';
const APP_ID = '11111111-2222-3333-4444-555555555555';

/** What the legacy CustomerApplication chain produces. */
const AUD_CUSTOMER = `api://${APP_ID}`;
/** What the FirstPartyApplication chain produces on slice A or B. */
const AUD_FIRSTPARTY = `api://${APP_ID}/scim.example.com`;

describe('N6 - slice-dependent audience, two trusts on one endpoint (E2E)', () => {
  let app: INestApplication;
  let adminToken: string;
  let endpointId: string;
  let privateKey: crypto.KeyObject;

  async function signAssertion(aud: string): Promise<string> {
    const pj = await exportJWK(privateKey);
    const key = await importJWK({ ...pj, alg: 'RS256' }, 'RS256');
    return new SignJWT({ iss: ISSUER, sub: SUBJECT, aud, tid: TENANT, roles: ['Scim.Provision'] })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(key);
  }

  async function addTrust(expectedAudience: string, label: string) {
    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        credentialType: 'wif',
        label,
        wif: {
          assertionProfile: 'jwt-bearer',
          expectedIssuer: ISSUER,
          expectedSubject: SUBJECT,
          expectedAudience,
          jwksUri: JWKS_URI,
          allowedTenantId: TENANT,
          requiredRoles: ['Scim.Provision'],
          scope: 'scim.read scim.write',
          issuedTokenTtlSec: 7200,
        },
      })
      .expect(201);
  }

  function postAssertion(assertion: string) {
    return request(app.getHttpServer())
      .post(`/scim/endpoints/${endpointId}/oauth/token`)
      .type('form')
      .send({ grant_type: 'client_credentials', client_assertion: assertion, client_assertion_type: JWT_BEARER });
  }

  beforeAll(async () => {
    process.env.JWKS_HOST_ALLOWLIST = 'login.microsoftonline.com';

    const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    privateKey = pair.privateKey;
    const jwk = (await exportJWK(pair.publicKey)) as unknown as Record<string, unknown>;
    jwk.kid = KID;
    jwk.alg = 'RS256';
    jwk.use = 'sig';
    const jwks = { keys: [jwk] };
    const fetchMock = jest.fn().mockImplementation(() => Promise.resolve({ ok: true, json: async () => jwks }));

    app = await createTestApp((builder) => builder.overrideProvider(JWKS_FETCH).useValue(fetchMock));
    adminToken = await getAuthToken(app);
    endpointId = await createEndpointWithConfig(app, adminToken, { WifCredentialsEnabled: 'True' });

    // The runbook: register BOTH audience shapes. Same issuer, same subject,
    // same tenant - they differ only in `expectedAudience`.
    await addTrust(AUD_CUSTOMER, 'Entra WIF (CustomerApplication chain)');
    await addTrust(AUD_FIRSTPARTY, 'Entra WIF (FirstPartyApplication chain)');
  });

  afterAll(async () => {
    await app.close();
  });

  it('N6-E1: a legacy CustomerApplication assertion mints', async () => {
    const res = await postAssertion(await signAssertion(AUD_CUSTOMER)).expect(200);
    expect(res.body.access_token).toBeDefined();
    expect(res.body.token_type).toBe('Bearer');
  });

  it('N6-E2: a FirstPartyApplication assertion mints against the SAME endpoint', async () => {
    const res = await postAssertion(await signAssertion(AUD_FIRSTPARTY)).expect(200);
    expect(res.body.access_token).toBeDefined();
  });

  it('N6-E3: the two trusts are not a blanket widening - an unrelated audience is still rejected', async () => {
    const res = await postAssertion(await signAssertion('api://some-other-app')).expect(401);
    expect(res.body.error).toBeDefined();
  });

  it('N6-E4: a token minted via the first-party trust actually authorizes a SCIM call', async () => {
    const mint = await postAssertion(await signAssertion(AUD_FIRSTPARTY)).expect(200);

    // The mint is only half the story; the runbook promises a working integration.
    await request(app.getHttpServer())
      .get(`/scim/endpoints/${endpointId}/Users`)
      .set('Authorization', `Bearer ${mint.body.access_token}`)
      .expect(200);
  });
});
