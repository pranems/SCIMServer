import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken, getLegacyToken } from './helpers/auth.helper';
import {
  scimGet,
  scimPost,
  createEndpointWithConfig,
  scimBasePath,
} from './helpers/request.helper';
import { validUser, resetFixtureCounter } from './helpers/fixtures';

/**
 * Per-Endpoint Credentials E2E Tests (Phase 11 / G11)
 *
 * Tests the per-endpoint credential management admin API and
 * per-endpoint authentication with fallback chain:
 *   per-endpoint credential → OAuth JWT → global shared secret
 */
describe('Per-Endpoint Credentials (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetFixtureCounter();
  });

  // ───────── Admin Credential API ─────────

  describe('Admin Credential CRUD', () => {
    let endpointId: string;

    beforeAll(async () => {
      endpointId = await createEndpointWithConfig(app, token, {
        PerEndpointCredentialsEnabled: true,
      });
    });

    it('should create a credential and return plaintext token', async () => {
      const res = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialType: 'bearer', label: 'e2e-cred-1' })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.token).toBeDefined();
      expect(res.body.token.length).toBeGreaterThan(20);
      expect(res.body.credentialType).toBe('bearer');
      expect(res.body.label).toBe('e2e-cred-1');
      expect(res.body.active).toBe(true);
      // Hash must never be returned
      expect(res.body.credentialHash).toBeUndefined();
    });

    it('should list credentials without exposing hashes', async () => {
      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      for (const cred of res.body) {
        expect(cred.id).toBeDefined();
        expect(cred.credentialType).toBeDefined();
        expect(cred.credentialHash).toBeUndefined();
      }
    });

    it('should revoke (deactivate) a credential', async () => {
      // Create a credential to revoke
      const createRes = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialType: 'bearer', label: 'to-revoke' })
        .expect(201);

      const credId = createRes.body.id;

      // Revoke it
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${endpointId}/credentials/${credId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      // Verify it's deactivated in the list
      const listRes = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const revoked = listRes.body.find((c: any) => c.id === credId);
      if (revoked) {
        expect(revoked.active).toBe(false);
      }
    });

    it('should reject credential creation when flag is disabled', async () => {
      const disabledEndpoint = await createEndpointWithConfig(app, token, {
        PerEndpointCredentialsEnabled: false,
      });

      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${disabledEndpoint}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialType: 'bearer' })
        .expect(403);
    });

    it('should reject invalid credential type', async () => {
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialType: 'invalid_type' })
        .expect(400);
    });

    it('should return 404 for non-existent endpoint', async () => {
      await request(app.getHttpServer())
        .post('/scim/admin/endpoints/00000000-0000-0000-0000-000000000000/credentials')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialType: 'bearer' })
        .expect(404);
    });
  });

  // ───────── Per-Endpoint Auth Flow ─────────

  describe('Per-Endpoint Authentication', () => {
    let endpointId: string;
    let perEndpointToken: string;

    beforeAll(async () => {
      // Create endpoint with per-endpoint credentials enabled
      endpointId = await createEndpointWithConfig(app, token, {
        PerEndpointCredentialsEnabled: true,
      });

      // Create a per-endpoint credential
      const res = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialType: 'bearer', label: 'auth-test' })
        .expect(201);

      perEndpointToken = res.body.token;
    });

    it('should authenticate with per-endpoint credential', async () => {
      const basePath = scimBasePath(endpointId);

      const res = await request(app.getHttpServer())
        .get(`${basePath}/Users`)
        .set('Authorization', `Bearer ${perEndpointToken}`)
        .set('Accept', 'application/scim+json')
        .expect(200);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
    });

    it('should still allow OAuth token when per-endpoint creds are enabled', async () => {
      const basePath = scimBasePath(endpointId);

      const res = await scimGet(app, `${basePath}/Users`, token);

      expect(res.status).toBe(200);
      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
    });

    it('should still allow legacy token when per-endpoint creds are enabled', async () => {
      const basePath = scimBasePath(endpointId);
      const legacyToken = getLegacyToken();

      const res = await request(app.getHttpServer())
        .get(`${basePath}/Users`)
        .set('Authorization', `Bearer ${legacyToken}`)
        .set('Accept', 'application/scim+json')
        .expect(200);

      expect(res.body.schemas).toContain('urn:ietf:params:scim:api:messages:2.0:ListResponse');
    });

    it('should reject invalid per-endpoint credential', async () => {
      const basePath = scimBasePath(endpointId);

      // Use a fake token that's not a valid per-endpoint credential, OAuth, or legacy
      await request(app.getHttpServer())
        .get(`${basePath}/Users`)
        .set('Authorization', 'Bearer invalid-token-that-matches-nothing')
        .set('Accept', 'application/scim+json')
        .expect(401);
    });

    it('Phase 2: a rejected resource-plane auth records a decision trace with the method-selection cascade', async () => {
      const basePath = scimBasePath(endpointId);
      await request(app.getHttpServer())
        .get(`${basePath}/Users`)
        .set('Authorization', 'Bearer p2-resource-reject-probe')
        .set('Accept', 'application/scim+json')
        .expect(401);

      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}/auth-decisions?outcome=reject&limit=50`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const rec = (res.body.records as Array<Record<string, unknown>>).find(
        (r) => r.plane === 'resource',
      );
      expect(rec).toBeDefined();
      expect(rec!.outcome).toBe('reject');
      const checks = rec!.checks as Array<{ id: string; status: string; expected?: string; received?: string }>;
      const ids = checks.map((c) => c.id);
      // The cascade names each candidate + why it did not win.
      expect(ids).toEqual(expect.arrayContaining(['token_presented', 'endpoint_bearer', 'oauth_jwt', 'shared_secret']));
      for (const c of checks) expect(c.received).toBeDefined();
      // The raw token is never stored.
      expect(JSON.stringify(rec)).not.toContain('p2-resource-reject-probe');
    });

    it('Phase 2: a successful per-endpoint bearer auth records an accept trace (method=endpoint_bearer)', async () => {
      const basePath = scimBasePath(endpointId);
      await request(app.getHttpServer())
        .get(`${basePath}/Users`)
        .set('Authorization', `Bearer ${perEndpointToken}`)
        .set('Accept', 'application/scim+json')
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}/auth-decisions?outcome=accept&limit=50`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const rec = (res.body.records as Array<Record<string, unknown>>).find(
        (r) => r.plane === 'resource' && r.method === 'endpoint_bearer',
      );
      expect(rec).toBeDefined();
      const eb = (rec!.checks as Array<{ id: string; status: string }>).find((c) => c.id === 'endpoint_bearer');
      expect(eb?.status).toBe('pass');
    });

    it('should reject revoked per-endpoint credential', async () => {
      const basePath = scimBasePath(endpointId);

      // Create a credential
      const createRes = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialType: 'bearer', label: 'to-be-revoked' })
        .expect(201);

      const tempToken = createRes.body.token;
      const credId = createRes.body.id;

      // Confirm it works first
      await request(app.getHttpServer())
        .get(`${basePath}/Users`)
        .set('Authorization', `Bearer ${tempToken}`)
        .set('Accept', 'application/scim+json')
        .expect(200);

      // Revoke it
      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${endpointId}/credentials/${credId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      // The revoked token should no longer work via per-endpoint auth.
      // It will fall back to OAuth/legacy - which will also reject it → 401
      await request(app.getHttpServer())
        .get(`${basePath}/Users`)
        .set('Authorization', `Bearer ${tempToken}`)
        .set('Accept', 'application/scim+json')
        .expect(401);
    });

    it('should allow CRUD operations with per-endpoint credential', async () => {
      const basePath = scimBasePath(endpointId);
      const user = validUser();

      // Create a user
      const createRes = await request(app.getHttpServer())
        .post(`${basePath}/Users`)
        .set('Authorization', `Bearer ${perEndpointToken}`)
        .set('Content-Type', 'application/scim+json')
        .send(user)
        .expect(201);

      const userId = createRes.body.id;
      expect(userId).toBeDefined();

      // Read the user
      const getRes = await request(app.getHttpServer())
        .get(`${basePath}/Users/${userId}`)
        .set('Authorization', `Bearer ${perEndpointToken}`)
        .set('Accept', 'application/scim+json')
        .expect(200);

      expect(getRes.body.userName).toBe(user.userName);

      // Delete the user
      await request(app.getHttpServer())
        .delete(`${basePath}/Users/${userId}`)
        .set('Authorization', `Bearer ${perEndpointToken}`)
        .expect(204);
    });
  });

  // ───────── Fallback Behavior ─────────

  describe('Fallback when flag is disabled', () => {
    let disabledEndpointId: string;

    beforeAll(async () => {
      disabledEndpointId = await createEndpointWithConfig(app, token, {
        PerEndpointCredentialsEnabled: false,
      });
    });

    it('should still allow OAuth token when per-endpoint creds are disabled', async () => {
      const basePath = scimBasePath(disabledEndpointId);

      const res = await scimGet(app, `${basePath}/Users`, token);
      expect(res.status).toBe(200);
    });

    it('should still allow legacy token when per-endpoint creds are disabled', async () => {
      const basePath = scimBasePath(disabledEndpointId);
      const legacyToken = getLegacyToken();

      const res = await request(app.getHttpServer())
        .get(`${basePath}/Users`)
        .set('Authorization', `Bearer ${legacyToken}`)
        .set('Accept', 'application/scim+json')
        .expect(200);

      expect(res.body.totalResults).toBeDefined();
    });
  });

  // ───────── Credential with Expiry ─────────

  describe('Credential Expiry', () => {
    let endpointId: string;

    beforeAll(async () => {
      endpointId = await createEndpointWithConfig(app, token, {
        PerEndpointCredentialsEnabled: true,
      });
    });

    it('should create credential with future expiry', async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString(); // +1 day

      const res = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          credentialType: 'bearer',
          label: 'expiring-cred',
          expiresAt: futureDate,
        })
        .expect(201);

      expect(res.body.expiresAt).toBeDefined();
    });

    it('should reject credential with past expiry', async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString(); // -1 day

      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({
          credentialType: 'bearer',
          label: 'expired-cred',
          expiresAt: pastDate,
        })
        .expect(400);
    });
  });

  // ───────── WI-11 - per-method auth-enablement flag family ─────────
  describe('WI-11 - per-method auth-enablement flags', () => {
    const legacyToken = getLegacyToken();

    it('allows a bearer credential create when only SecretTokenBearerAuthEnabled is on', async () => {
      const ep = await createEndpointWithConfig(app, token, { SecretTokenBearerAuthEnabled: true });
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${ep}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialType: 'bearer', label: 'wi11-bearer' })
        .expect(201);
    });

    it('blocks an oauth_client create when OAuthClientCredentialsAuthEnabled is off (bearer only)', async () => {
      const ep = await createEndpointWithConfig(app, token, { SecretTokenBearerAuthEnabled: true, OAuthClientCredentialsAuthEnabled: false });
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${ep}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialType: 'oauth_client', label: 'wi11-oc' })
        .expect(403);
    });

    it('value-preserving: legacy PerEndpointCredentialsEnabled=true still allows bearer create', async () => {
      const ep = await createEndpointWithConfig(app, token, { PerEndpointCredentialsEnabled: true });
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${ep}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialType: 'bearer', label: 'wi11-legacy' })
        .expect(201);
    });

    it('an endpoint with SharedSecretBearerAuthEnabled=false REFUSES the global shared secret', async () => {
      const ep = await createEndpointWithConfig(app, token, { SharedSecretBearerAuthEnabled: false });
      // The global shared secret (legacyToken) is refused on this endpoint's routes.
      await request(app.getHttpServer())
        .get(`${scimBasePath(ep)}/Users`)
        .set('Authorization', `Bearer ${legacyToken}`)
        .expect(401);
    });

    it('an endpoint with SharedSecretBearerAuthEnabled=true (default) still accepts the global secret', async () => {
      const ep = await createEndpointWithConfig(app, token, { SharedSecretBearerAuthEnabled: true });
      await request(app.getHttpServer())
        .get(`${scimBasePath(ep)}/Users`)
        .set('Authorization', `Bearer ${legacyToken}`)
        .expect(200);
    });

    it('a default endpoint (no auth flags) still accepts the global secret (back-compat)', async () => {
      const ep = await createEndpointWithConfig(app, token, {});
      await request(app.getHttpServer())
        .get(`${scimBasePath(ep)}/Users`)
        .set('Authorization', `Bearer ${legacyToken}`)
        .expect(200);
    });
  });

  // ───────── W2.5 - per-method enablement co-location (profile.authentication.methods[]) ─────────
  describe('W2.5 - per-method enablement co-location', () => {
    it('resource-guard honors a bearer method enabled:false even though the flat flag enables it (disabled-with-credential)', async () => {
      // Flat flag ON -> bearer creds allowed + authenticate today.
      const ep = await createEndpointWithConfig(app, token, { PerEndpointCredentialsEnabled: true });
      const credRes = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${ep}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialType: 'bearer', label: 'w2.5-coloc' })
        .expect(201);
      const bearer = credRes.body.token;
      const basePath = scimBasePath(ep);

      // Baseline: the per-endpoint bearer authenticates (flat flag enables it).
      await request(app.getHttpServer())
        .get(`${basePath}/Users`)
        .set('Authorization', `Bearer ${bearer}`)
        .set('Accept', 'application/scim+json')
        .expect(200);

      // Co-locate an explicit DISABLE on the bearer method via the A1 API.
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${ep}/authentication/methods`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'bearer', enabled: false })
        .expect(201);

      // The SAME bearer is now REJECTED: methods[].enabled overrides the flat flag.
      await request(app.getHttpServer())
        .get(`${basePath}/Users`)
        .set('Authorization', `Bearer ${bearer}`)
        .set('Accept', 'application/scim+json')
        .expect(401);
    });

    it('value-preserving: an endpoint with NO method entries still authenticates via the flat flag', async () => {
      const ep = await createEndpointWithConfig(app, token, { PerEndpointCredentialsEnabled: true });
      const credRes = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${ep}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialType: 'bearer', label: 'w2.5-vp' })
        .expect(201);
      const bearer = credRes.body.token;

      await request(app.getHttpServer())
        .get(`${scimBasePath(ep)}/Users`)
        .set('Authorization', `Bearer ${bearer}`)
        .set('Accept', 'application/scim+json')
        .expect(200);
    });

    it('co-location enables a method the flat flag leaves off (bearer enabled:true with no flat flag)', async () => {
      // No flat per-endpoint flag -> bearer create is normally blocked; enable
      // the method explicitly first so the create-gate + guard both allow it.
      const ep = await createEndpointWithConfig(app, token, {});
      await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${ep}/authentication/methods`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type: 'bearer', enabled: true })
        .expect(201);
      // The create-gate now allows the bearer credential (co-located enable).
      const credRes = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${ep}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialType: 'bearer', label: 'w2.5-enable' })
        .expect(201);
      await request(app.getHttpServer())
        .get(`${scimBasePath(ep)}/Users`)
        .set('Authorization', `Bearer ${credRes.body.token}`)
        .set('Accept', 'application/scim+json')
        .expect(200);
    });
  });
});
