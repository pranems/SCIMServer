/**
 * Per-endpoint OAuth client + per-endpoint token issuer - E2E (Q1)
 *
 * Full vertical slice:
 *  - Create an `oauth_client` credential -> returns clientId + clientSecret once.
 *  - Exchange them at the per-endpoint token endpoint -> a token carrying an
 *    `endpoint_id` claim.
 *  - That token authorizes its OWN endpoint's SCIM routes.
 *  - That token is REJECTED on a DIFFERENT endpoint (per-endpoint scoping).
 *  - The clientSecret never appears in a list response (no-secret contract).
 *
 * @see docs/auth/AUTHENTICATION_ARCHITECTURE.md section 13 (Q1)
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpointWithConfig } from './helpers/request.helper';

function decodePayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'));
}

describe('Per-endpoint OAuth client + token issuer (Q1)', () => {
  let app: INestApplication;
  let adminToken: string;
  let endpointA: string;
  let endpointB: string;

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    adminToken = await getAuthToken(app);
    endpointA = await createEndpointWithConfig(app, adminToken, {
      PerEndpointCredentialsEnabled: 'True',
    });
    endpointB = await createEndpointWithConfig(app, adminToken, {
      PerEndpointCredentialsEnabled: 'True',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function createOauthClient(endpointId: string) {
    const res = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ credentialType: 'oauth_client', label: 'q1-test' })
      .expect(201);
    return res.body as { clientId: string; clientSecret: string };
  }

  function mintEndpointToken(endpointId: string, clientId: string, clientSecret: string) {
    return request(app.getHttpServer())
      .post(`/scim/endpoints/${endpointId}/oauth/token`)
      .send({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });
  }

  it('creates an oauth_client credential returning clientId + clientSecret once', async () => {
    const res = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointA}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ credentialType: 'oauth_client', label: 'q1-create' })
      .expect(201);

    expect(res.body.credentialType).toBe('oauth_client');
    expect(typeof res.body.clientId).toBe('string');
    expect(typeof res.body.clientSecret).toBe('string');
    expect(res.body.token).toBeUndefined();
  });

  it('mints a per-endpoint token carrying the endpoint_id claim', async () => {
    const { clientId, clientSecret } = await createOauthClient(endpointA);
    const res = await mintEndpointToken(endpointA, clientId, clientSecret).expect(201);

    expect(res.body.token_type).toBe('Bearer');
    expect(typeof res.body.access_token).toBe('string');
    const payload = decodePayload(res.body.access_token);
    expect(payload.endpoint_id).toBe(endpointA);
    expect(payload.client_id).toBe(clientId);
  });

  it('mints a per-endpoint token when credentials arrive via Authorization: Basic (client_secret_basic)', async () => {
    // RFC 6749 section 2.3.1 - Entra's newer provisioning experience sends the
    // client credentials in the Basic header rather than the body.
    const { clientId, clientSecret } = await createOauthClient(endpointA);
    const basic = Buffer.from(
      `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`,
    ).toString('base64');
    const res = await request(app.getHttpServer())
      .post(`/scim/endpoints/${endpointA}/oauth/token`)
      .set('Authorization', `Basic ${basic}`)
      .send({ grant_type: 'client_credentials' })
      .expect(201);

    expect(res.body.token_type).toBe('Bearer');
    const payload = decodePayload(res.body.access_token);
    expect(payload.endpoint_id).toBe(endpointA);
    expect(payload.client_id).toBe(clientId);
  });

  it('the per-endpoint token authorizes ITS OWN endpoint SCIM routes', async () => {
    const { clientId, clientSecret } = await createOauthClient(endpointA);
    const tokenRes = await mintEndpointToken(endpointA, clientId, clientSecret).expect(201);
    const epToken = tokenRes.body.access_token;

    await request(app.getHttpServer())
      .get(`/scim/endpoints/${endpointA}/Users`)
      .set('Authorization', `Bearer ${epToken}`)
      .expect(200);
  });

  it('the per-endpoint token is REJECTED on a DIFFERENT endpoint (Q1 scoping)', async () => {
    const { clientId, clientSecret } = await createOauthClient(endpointA);
    const tokenRes = await mintEndpointToken(endpointA, clientId, clientSecret).expect(201);
    const epToken = tokenRes.body.access_token;

    const res = await request(app.getHttpServer())
      .get(`/scim/endpoints/${endpointB}/Users`)
      .set('Authorization', `Bearer ${epToken}`)
      .expect(401);
    expect(res.headers['www-authenticate']).toContain('error="invalid_token"');
  });

  it('rejects an invalid client_secret with invalid_client', async () => {
    const { clientId } = await createOauthClient(endpointA);
    const res = await mintEndpointToken(endpointA, clientId, 'wrong-secret').expect(401);
    // WI-D1: the token endpoint returns the native RFC-6749 error as
    // application/json (NOT the SCIM envelope), enriched with a correlation_id.
    expect(res.body.error).toBe('invalid_client');
    expect(res.body.schemas).toBeUndefined();
    expect(typeof res.body.correlation_id).toBe('string');
    expect(typeof res.body.timestamp).toBe('string');
    // WI-D3: the merged (T3) oauth_client reason code - never distinguishes
    // secret-not-found from secret-mismatch on the wire (P2).
    expect(res.body.reason_code).toBe('oauth_client_auth_failed');
    expect(res.body.error_description).toBe('Client authentication failed.');
  });

  it('WI-D4: a rejected oauth_client attempt emits an AUTH decision event in the ring buffer', async () => {
    const { clientId } = await createOauthClient(endpointA);
    await mintEndpointToken(endpointA, clientId, 'wrong-secret').expect(401);

    const recent = await request(app.getHttpServer())
      .get('/scim/admin/log-config/recent?category=auth&limit=200')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const decisionEvents = (recent.body.entries as Array<Record<string, unknown>>).filter(
      (e) => e.message === 'Auth decision',
    );
    expect(decisionEvents.length).toBeGreaterThan(0);
    const rejectEvent = decisionEvents.find(
      (e) => (e.data as Record<string, unknown>)?.reasonCode === 'oauth_client_auth_failed',
    );
    expect(rejectEvent).toBeDefined();
    expect((rejectEvent!.data as Record<string, unknown>).outcome).toBe('reject');
    expect((rejectEvent!.data as Record<string, unknown>).method).toBe('oauth_client');
  });

  it('WI-D5: a rejected oauth_client attempt is queryable at both auth-decisions scopes', async () => {
    const { clientId } = await createOauthClient(endpointA);
    await mintEndpointToken(endpointA, clientId, 'wrong-secret').expect(401);

    // Global scope - the reject appears across all endpoints.
    const global = await request(app.getHttpServer())
      .get('/scim/admin/auth-decisions?outcome=reject&limit=100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(global.body.count).toBeGreaterThan(0);
    const globalHit = (global.body.records as Array<Record<string, unknown>>).find(
      (r) => r.endpointId === endpointA && r.reasonCode === 'oauth_client_auth_failed',
    );
    expect(globalHit).toBeDefined();
    expect(globalHit!.outcome).toBe('reject');
    expect(globalHit!.method).toBe('oauth_client');

    // Per-endpoint scope - the same record scoped to endpointA.
    const scoped = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointA}/auth-decisions?limit=100`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(scoped.body.count).toBeGreaterThan(0);
    expect(
      (scoped.body.records as Array<Record<string, unknown>>).every((r) => r.endpointId === endpointA),
    ).toBe(true);

    // Per-endpoint scope for a DIFFERENT endpoint does NOT include endpointA's record.
    const other = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointB}/auth-decisions?limit=100`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      (other.body.records as Array<Record<string, unknown>>).some((r) => r.endpointId === endpointA),
    ).toBe(false);

    // WI-D5 - the record never carries a raw secret/assertion.
    expect(JSON.stringify(scoped.body)).not.toContain('wrong-secret');
  });

  it('WI-D5: the auth-decisions endpoints require admin auth (401 without a bearer)', async () => {
    await request(app.getHttpServer()).get('/scim/admin/auth-decisions').expect(401);
    await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointA}/auth-decisions`)
      .expect(401);
  });

  it('rejects a wrong grant_type with unsupported_grant_type', async () => {
    const { clientId, clientSecret } = await createOauthClient(endpointA);
    const res = await request(app.getHttpServer())
      .post(`/scim/endpoints/${endpointA}/oauth/token`)
      .send({ grant_type: 'password', client_id: clientId, client_secret: clientSecret })
      .expect(400);
    expect(res.body.error).toBe('unsupported_grant_type');
    // WI-D1: error_description survives (was dropped by the old flattener).
    expect(typeof res.body.error_description).toBe('string');
  });

  it('accepts an application/x-www-form-urlencoded body on the per-endpoint token endpoint (RFC 6749 3.2)', async () => {
    // Entra's client-credentials grant sends the token request as
    // application/x-www-form-urlencoded. The per-endpoint token URL lives under
    // endpoints/*, so the SCIM content-type middleware used to 415 it with
    // "Supported CredentialLocationInRequest is required". The */oauth/token
    // exemption must let the form body through and mint a token.
    const { clientId, clientSecret } = await createOauthClient(endpointA);
    const res = await request(app.getHttpServer())
      .post(`/scim/endpoints/${endpointA}/oauth/token`)
      .type('form')
      .send({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
      .expect(201);

    expect(res.body.token_type).toBe('Bearer');
    expect(typeof res.body.access_token).toBe('string');
  });

  it('accepts form-urlencoded + Authorization: Basic on the per-endpoint token endpoint (exact Entra flow)', async () => {
    const { clientId, clientSecret } = await createOauthClient(endpointA);
    const basic = Buffer.from(
      `${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`,
    ).toString('base64');
    const res = await request(app.getHttpServer())
      .post(`/scim/endpoints/${endpointA}/oauth/token`)
      .set('Authorization', `Basic ${basic}`)
      .type('form')
      .send({ grant_type: 'client_credentials' })
      .expect(201);

    expect(res.body.token_type).toBe('Bearer');
    const payload = decodePayload(res.body.access_token);
    expect(payload.endpoint_id).toBe(endpointA);
  });

  it('never returns the clientSecret in a credential list response', async () => {
    await createOauthClient(endpointA);
    const res = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointA}/credentials`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('clientSecret');
    // The public clientId IS exposed for oauth_client rows.
    const oauthRows = res.body.filter((c: { credentialType: string }) => c.credentialType === 'oauth_client');
    expect(oauthRows.length).toBeGreaterThan(0);
    for (const row of oauthRows) {
      expect(typeof row.clientId).toBe('string');
      expect(row).not.toHaveProperty('clientSecret');
      expect(row).not.toHaveProperty('credentialHash');
    }
  });

  // ─── A3: form-urlencoded intake + routing cascade ──────────────────────────
  describe('A3 routing cascade + form-urlencoded intake', () => {
    const JWT_BEARER = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

    it('accepts a form-urlencoded token request (RFC 6749 section 3.2)', async () => {
      const { clientId, clientSecret } = await createOauthClient(endpointA);
      const res = await request(app.getHttpServer())
        .post(`/scim/endpoints/${endpointA}/oauth/token`)
        .type('form')
        .send({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret })
        .expect(201);
      expect(res.body.token_type).toBe('Bearer');
      expect(typeof res.body.access_token).toBe('string');
    });

    it('rejects a body carrying BOTH client_assertion and client_secret (invalid_request)', async () => {
      const { clientId, clientSecret } = await createOauthClient(endpointA);
      const res = await request(app.getHttpServer())
        .post(`/scim/endpoints/${endpointA}/oauth/token`)
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          client_assertion: 'a.b.c',
          client_assertion_type: JWT_BEARER,
        })
        .expect(400);
      // WI-D1: RFC-6749 error shape on the token endpoint.
      expect(res.body.error).toBe('invalid_request');
    });

    it('rejects a client_assertion with an unsupported assertion type (invalid_request)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/scim/endpoints/${endpointA}/oauth/token`)
        .type('form')
        .send({ grant_type: 'client_credentials', client_assertion: 'a.b.c', client_assertion_type: 'urn:bogus' })
        .expect(400);
      expect(res.body.error).toBe('invalid_request');
    });

    it('a client_assertion is routed to the WIF path (invalid_client until Q6 wires the validator)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/scim/endpoints/${endpointA}/oauth/token`)
        .type('form')
        .send({ grant_type: 'client_credentials', client_assertion: 'a.b.c', client_assertion_type: JWT_BEARER })
        .expect(401);
      // Routed to the assertion path (invalid_client), NOT the secret path
      // (which would be invalid_request for missing client_id/secret).
      expect(res.body.error).toBe('invalid_client');
    });
  });
});
