import type { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpointWithConfig } from './helpers/request.helper';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../src/domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../../src/domain/repositories/endpoint-credential.repository.interface';
import {
  CREDENTIAL_TOKEN_PREFIX,
  HASH_ALGO_HMAC_V1,
  P1_KEYED_HASH_PLACEHOLDER,
  mintOAuthClientSecret,
} from '../../src/security/credential-token';

/**
 * P1 - keyed credential lookup, over HTTP.
 *
 * See docs/auth/P1_KEYED_CREDENTIAL_LOOKUP_DESIGN.md. The unit tests prove WHICH
 * repository method runs; these prove the two things a unit test cannot:
 * that a real SCIM request authenticates end to end, and that the amplification
 * is actually gone when measured on the wire.
 */
describe('P1 keyed credential lookup (E2E)', () => {
  let app: INestApplication;
  let token: string;
  let repo: IEndpointCredentialRepository;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
    repo = app.get<IEndpointCredentialRepository>(ENDPOINT_CREDENTIAL_REPOSITORY);
  });

  afterAll(async () => {
    await app.close();
  });

  const newBearer = (endpointId: string, label = 'p1') =>
    request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialType: 'bearer', label })
      .expect(201);

  /** Authenticate a SCIM read on the endpoint using the given credential. */
  const scimGet = (endpointId: string, cred: string) =>
    request(app.getHttpServer())
      .get(`/scim/endpoints/${endpointId}/Users?count=1`)
      .set('Authorization', `Bearer ${cred}`);

  it('P1-X1: a newly minted bearer credential is in the keyed format and authenticates', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
    });
    const created = await newBearer(endpointId);
    const issued = created.body.token as string;

    expect(issued.startsWith(`${CREDENTIAL_TOKEN_PREFIX}_`)).toBe(true);
    await scimGet(endpointId, issued).expect(200);
  });

  it('P1-X2: the persisted row carries lookupKey + secretHash and NOT the secret', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
    });
    const created = await newBearer(endpointId);
    const issued = created.body.token as string;

    const row = await repo.findById(created.body.id as string);
    expect(row!.hashAlgo).toBe(HASH_ALGO_HMAC_V1);
    expect(row!.lookupKey).toBeTruthy();
    expect(row!.secretHash).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
    // The secret must not be recoverable from the row.
    expect(JSON.stringify(row)).not.toContain(issued.split('_').pop());
  });

  it('P1-X3: a wrong secret under a REAL lookupKey is refused', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
    });
    const created = await newBearer(endpointId);
    const row = await repo.findById(created.body.id as string);

    const forged = `${CREDENTIAL_TOKEN_PREFIX}_${row!.lookupKey}_not-the-real-secret`;
    await scimGet(endpointId, forged).expect(401);
  });

  it('P1-X4: a credential does NOT authenticate against a different endpoint', async () => {
    // lookupKey is globally unique, so the row must be re-bound to the endpoint
    // being addressed.
    const epA = await createEndpointWithConfig(app, token, { SecretTokenBearerAuthEnabled: true });
    const epB = await createEndpointWithConfig(app, token, { SecretTokenBearerAuthEnabled: true });
    const created = await newBearer(epA);
    const issued = created.body.token as string;

    await scimGet(epA, issued).expect(200);
    await scimGet(epB, issued).expect(401);
  });

  it('P1-X5: a LEGACY bcrypt credential still authenticates - the migration promise', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
    });
    const legacySecret = 'legacy-opaque-secret-value-0001';
    await repo.create({
      endpointId,
      credentialType: 'bearer',
      credentialHash: await bcrypt.hash(legacySecret, 10),
      label: 'legacy',
    });

    await scimGet(endpointId, legacySecret).expect(200);
  });

  it('P1-X6: ROTATION upgrades a legacy credential to the keyed format', async () => {
    // Rotation is the migration path - the existing operator workflow, not a
    // new concept to learn.
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
    });
    const legacy = await repo.create({
      endpointId,
      credentialType: 'bearer',
      credentialHash: await bcrypt.hash('legacy-to-rotate-0002', 10),
      label: 'legacy-rotate',
    });
    expect(legacy.hashAlgo ?? 'bcrypt').toBe('bcrypt');

    const rotated = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/${legacy.id}/rotate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const issued = (rotated.body.token ?? rotated.body.clientSecret) as string;
    expect(issued.startsWith(`${CREDENTIAL_TOKEN_PREFIX}_`)).toBe(true);
    await scimGet(endpointId, issued).expect(200);
  });

  /**
   * The assertion that actually proves the item. Before P1 this request cost
   * N x 287 ms of bcrypt - 25 credentials was ~7.2 s - and it is reachable by an
   * UNAUTHENTICATED caller.
   */
  describe('P1-X7: the amplification is measurably gone', () => {    it('25 keyed credentials + a wrong token stays fast, and 3 LEGACY rows do not', async () => {
      const keyedEp = await createEndpointWithConfig(app, token, {
        SecretTokenBearerAuthEnabled: true,
        MaxActiveBearerCredentials: 25,
      });
      for (let i = 0; i < 25; i++) await newBearer(keyedEp, `perf-${i}`);

      const wrong = 'definitely-not-a-valid-credential-value';
      const t0 = Date.now();
      await scimGet(keyedEp, wrong).expect(401);
      const keyedMs = Date.now() - t0;

      // NEGATIVE CONTROL: the same wrong token against only THREE legacy bcrypt
      // rows. If this is not dramatically slower, the fast path is not what made
      // the first measurement fast and this test proves nothing.
      const legacyEp = await createEndpointWithConfig(app, token, {
        SecretTokenBearerAuthEnabled: true,
      });
      for (let i = 0; i < 3; i++) {
        await repo.create({
          endpointId: legacyEp,
          credentialType: 'bearer',
          // Real production cost factor - the number the design doc measured.
          credentialHash: await bcrypt.hash(`legacy-perf-${i}`, 12),
          label: `legacy-perf-${i}`,
        });
      }
      const t1 = Date.now();
      await scimGet(legacyEp, wrong).expect(401);
      const legacyMs = Date.now() - t1;

      // 25 keyed rows must cost less than 3 legacy ones, by a wide margin.
      expect(keyedMs).toBeLessThan(legacyMs);
      expect(keyedMs).toBeLessThan(250);
    }, 120_000);
  });

  /**
   * P1 HYBRID - oauth_client keeps its readable prefix and gains a lookup key.
   * The token endpoint must accept both the new and the legacy shape.
   */
  describe('P1-X8: hybrid oauth_client secret', () => {
    const mintToken = (endpointId: string, clientId: string, clientSecret: string) =>
      request(app.getHttpServer())
        .post(`/scim/endpoints/${endpointId}/oauth/token`)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(`grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`);

    it('P1-X8a: a new oauth_client secret keeps the readable prefix AND is keyed', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        OAuthClientCredentialsAuthEnabled: true,
      });
      const created = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialType: 'oauth_client', label: 'hybrid' })
        .expect(201);

      const secret = created.body.clientSecret as string;
      // Readable prefix preserved - this was an explicit operator requirement.
      expect(secret.startsWith('client-secret-')).toBe(true);
      // ...and now keyed: prefix + 24 hex + '-' + base64url secret.
      expect(secret).toMatch(/^client-secret-[0-9a-f]{24}-[A-Za-z0-9_-]{20,}$/);

      const row = await repo.findById(created.body.id as string);
      expect(row!.hashAlgo).toBe(HASH_ALGO_HMAC_V1);
      expect(row!.lookupKey).toBeTruthy();
    });

    it('P1-X8b: the hybrid secret mints a token at the token endpoint', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        OAuthClientCredentialsAuthEnabled: true,
      });
      const created = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialType: 'oauth_client', label: 'hybrid-mint' })
        .expect(201);

      const res = await mintToken(endpointId, created.body.clientId as string, created.body.clientSecret as string);
      expect(res.status).toBe(200);
      expect(res.body.access_token).toBeTruthy();
    });

    it('P1-X8c: a wrong secret under a real clientId is refused', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        OAuthClientCredentialsAuthEnabled: true,
      });
      const created = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send({ credentialType: 'oauth_client', label: 'hybrid-wrong' })
        .expect(201);

      const forged = `client-secret-${'a'.repeat(24)}-not-the-real-secret`;
      const res = await mintToken(endpointId, created.body.clientId as string, forged);
      expect(res.status).toBe(401);
    });

    it('P1-X8d: a LEGACY client-secret-<uuid> still mints - the migration promise', async () => {
      // The whole hybrid rests on this: existing oauth_client secrets keep
      // working until their owner chooses to rotate.
      const endpointId = await createEndpointWithConfig(app, token, {
        OAuthClientCredentialsAuthEnabled: true,
      });
      const legacySecret = `client-secret-${randomUUID()}`;
      const clientId = `legacy-client-${Date.now()}`;
      await repo.create({
        endpointId,
        credentialType: 'oauth_client',
        credentialHash: await bcrypt.hash(legacySecret, 10),
        label: 'legacy-oauth',
        metadata: { clientId },
      });

      const res = await mintToken(endpointId, clientId, legacySecret);
      expect(res.status).toBe(200);
      expect(res.body.access_token).toBeTruthy();
    });

    it('P1-X8e: rotating a LEGACY oauth_client yields the hybrid format', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        OAuthClientCredentialsAuthEnabled: true,
      });
      const legacy = await repo.create({
        endpointId,
        credentialType: 'oauth_client',
        credentialHash: await bcrypt.hash(`client-secret-${randomUUID()}`, 10),
        label: 'legacy-rotate-oauth',
        metadata: { clientId: `legacy-rot-${Date.now()}` },
      });

      const rotated = await request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${endpointId}/credentials/${legacy.id}/rotate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const secret = (rotated.body.clientSecret ?? rotated.body.token) as string;
      expect(secret).toMatch(/^client-secret-[0-9a-f]{24}-/);
      // The public clientId must survive rotation - only the secret changes.
      const res = await mintToken(endpointId, rotated.body.clientId as string, secret);
      expect(res.status).toBe(200);
    });
  });

  // ── P6: the zero-downtime migration path ───────────────────────────────────
  //
  // Rotation is destructive: it invalidates the owner's secret the moment it
  // runs. For an integration we do not control (a live Entra provisioning job),
  // the only humane path is to issue the NEW secret alongside the old, let the
  // owner switch when convenient, and retire the old afterwards.
  //
  // That was impossible before v0.55.20: every oauth_client credential on an
  // endpoint shares one clientId, and the token endpoint selected the candidate
  // with `.find()` - so a second credential could SHADOW the working one, and
  // `findActiveByEndpoint` has no `orderBy`, leaving which one wins unspecified.
  describe('P6: a new secret can run alongside the old one', () => {
    const mintToken = (endpointId: string, clientId: string, clientSecret: string) =>
      request(app.getHttpServer())
        .post(`/scim/endpoints/${endpointId}/oauth/token`)
        .type('form')
        .send({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret });

    it('P6-X1: the legacy secret still mints AFTER a keyed one is added under the same clientId', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        OAuthClientCredentialsAuthEnabled: true,
      });
      const legacySecret = `client-secret-${randomUUID()}`;
      const clientId = `parallel-client-${Date.now()}`;

      await repo.create({
        endpointId,
        credentialType: 'oauth_client',
        credentialHash: await bcrypt.hash(legacySecret, 10),
        label: 'legacy-still-in-use',
        metadata: { clientId },
      });

      const minted = mintOAuthClientSecret();
      await repo.create({
        endpointId,
        credentialType: 'oauth_client',
        credentialHash: P1_KEYED_HASH_PLACEHOLDER,
        label: 'new-keyed-alongside',
        metadata: { clientId },
        lookupKey: minted.lookupKey,
        secretHash: minted.secretHash,
        hashAlgo: minted.hashAlgo,
      });

      // BOTH must work - that overlap IS the grace period.
      expect((await mintToken(endpointId, clientId, legacySecret)).status).toBe(200);
      expect((await mintToken(endpointId, clientId, minted.token)).status).toBe(200);
    });

    it('P6-X2: retiring the legacy row leaves the keyed one working', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        OAuthClientCredentialsAuthEnabled: true,
      });
      const legacySecret = `client-secret-${randomUUID()}`;
      const clientId = `cutover-client-${Date.now()}`;

      const legacy = await repo.create({
        endpointId,
        credentialType: 'oauth_client',
        credentialHash: await bcrypt.hash(legacySecret, 10),
        label: 'legacy-to-retire',
        metadata: { clientId },
      });
      const minted = mintOAuthClientSecret();
      await repo.create({
        endpointId,
        credentialType: 'oauth_client',
        credentialHash: P1_KEYED_HASH_PLACEHOLDER,
        label: 'keyed-survivor',
        metadata: { clientId },
        lookupKey: minted.lookupKey,
        secretHash: minted.secretHash,
        hashAlgo: minted.hashAlgo,
      });

      await request(app.getHttpServer())
        .delete(`/scim/admin/endpoints/${endpointId}/credentials/${legacy.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      expect((await mintToken(endpointId, clientId, minted.token)).status).toBe(200);
      expect((await mintToken(endpointId, clientId, legacySecret)).status).toBe(401);
    });

    it('P6-X3: NEGATIVE CONTROL - a wrong secret is refused even with several credentials present', async () => {
      const endpointId = await createEndpointWithConfig(app, token, {
        OAuthClientCredentialsAuthEnabled: true,
      });
      const clientId = `neg-client-${Date.now()}`;
      for (const label of ['one', 'two']) {
        await repo.create({
          endpointId,
          credentialType: 'oauth_client',
          credentialHash: await bcrypt.hash(`client-secret-${randomUUID()}`, 10),
          label,
          metadata: { clientId },
        });
      }
      const minted = mintOAuthClientSecret();
      await repo.create({
        endpointId,
        credentialType: 'oauth_client',
        credentialHash: P1_KEYED_HASH_PLACEHOLDER,
        label: 'three',
        metadata: { clientId },
        lookupKey: minted.lookupKey,
        secretHash: minted.secretHash,
        hashAlgo: minted.hashAlgo,
      });

      expect((await mintToken(endpointId, clientId, 'client-secret-not-any-of-them')).status).toBe(401);
    });
  });
});
