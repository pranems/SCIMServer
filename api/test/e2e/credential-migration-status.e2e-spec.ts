import type { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpointWithConfig } from './helpers/request.helper';
import { ENDPOINT_CREDENTIAL_REPOSITORY } from '../../src/domain/repositories/repository.tokens';
import type { IEndpointCredentialRepository } from '../../src/domain/repositories/endpoint-credential.repository.interface';
import { HASH_ALGO_BCRYPT, HASH_ALGO_HMAC_V1 } from '../../src/security/credential-token';

/**
 * P1 phase 4 - the legacy tail, over HTTP.
 *
 * Phase 5 deletes the bcrypt verifier and cannot be undone, so it is gated on
 * this report reading zero. These tests prove the report actually MOVES when the
 * population changes - a status endpoint that always says "ready" would be worse
 * than none at all.
 */
describe('P1 phase 4 - credential migration status (E2E)', () => {
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

  const status = () =>
    request(app.getHttpServer())
      .get('/scim/admin/credentials/migration-status')
      .set('Authorization', `Bearer ${token}`);

  /** Plant a pre-P1 row: bcrypt hash, no lookupKey, exactly like a legacy credential. */
  const plantLegacy = async (endpointId: string, active = true) =>
    repo.create({
      endpointId,
      credentialType: 'bearer',
      credentialHash: await bcrypt.hash('legacy-secret', 4),
      label: 'planted-legacy',
      hashAlgo: HASH_ALGO_BCRYPT,
    });

  it('P4-X1: the route is reachable and reports the documented shape', async () => {
    const res = await status().expect(200);

    const ALLOWED_KEYS = [
      'generatedAt',
      'total',
      'legacy',
      'keyed',
      'secretless',
      'byAlgo',
      'readyToRetireLegacyPath',
      'endpoints',
    ];
    for (const key of Object.keys(res.body)) {
      expect(ALLOWED_KEYS).toContain(key);
    }
    expect(typeof res.body.readyToRetireLegacyPath).toBe('boolean');
    expect(Array.isArray(res.body.endpoints)).toBe(true);
  });

  it('P4-X2: a newly minted credential is counted as KEYED, not legacy', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
    });
    const before = (await status().expect(200)).body;

    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .send({ credentialType: 'bearer', label: 'p4' })
      .expect(201);

    const after = (await status().expect(200)).body;
    expect(after.keyed.total).toBe(before.keyed.total + 1);
    expect(after.legacy.total).toBe(before.legacy.total);
  });

  it('P4-X3: a planted legacy row appears in the tail and closes the phase-5 gate', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
    });
    const before = (await status().expect(200)).body;

    await plantLegacy(endpointId);

    const after = (await status().expect(200)).body;
    expect(after.legacy.total).toBe(before.legacy.total + 1);
    expect(after.readyToRetireLegacyPath).toBe(false);
    expect(after.byAlgo[HASH_ALGO_BCRYPT]).toBeGreaterThan(0);

    const row = after.endpoints.find((e: { endpointId: string }) => e.endpointId === endpointId);
    expect(row).toBeDefined();
    expect(row.legacyTotal).toBe(1);
    expect(row.endpointName).toBeTruthy();
  });

  it('P4-X4: DEACTIVATING a legacy credential clears it from the ACTIVE tail but keeps it visible', async () => {
    // The gate is legacy.active, because nothing can ever remove an inactive
    // row - but the row stays counted in legacy.total so the reactivation
    // hazard remains visible, and phase 5 must ship a guard for it.
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
    });
    const planted = await plantLegacy(endpointId);
    const before = (await status().expect(200)).body;

    await request(app.getHttpServer())
      .delete(`/scim/admin/endpoints/${endpointId}/credentials/${planted.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const after = (await status().expect(200)).body;
    expect(after.legacy.total).toBe(before.legacy.total);
    expect(after.legacy.inactive).toBe(before.legacy.inactive + 1);
    expect(after.legacy.active).toBe(before.legacy.active - 1);
  });

  it('P4-X5: rotating a legacy credential moves it OUT of the tail - rotation is the migration path', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
    });
    const planted = await plantLegacy(endpointId);
    const before = (await status().expect(200)).body;

    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/${planted.id}/rotate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    const after = (await status().expect(200)).body;
    // The rotated-away row is deactivated but still bcrypt, so the legacy TOTAL
    // is unchanged - what moves is that a keyed row now exists in its place.
    expect(after.keyed.total).toBe(before.keyed.total + 1);
    expect(after.legacy.active).toBe(before.legacy.active - 1);
  });

  it('P4-X6: the counts reconcile - total equals legacy plus keyed, and byAlgo sums to it', async () => {
    const res = await status().expect(200);
    const body = res.body;

    expect(body.total).toBe(body.legacy.total + body.keyed.total + body.secretless.total);
    expect(body.legacy.total).toBe(body.legacy.active + body.legacy.inactive);
    expect(body.keyed.total).toBe(body.keyed.active + body.keyed.inactive);

    const algoSum = Object.values(body.byAlgo as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(algoSum).toBe(body.total);
  });

  it('P4-X7: the report requires admin auth', async () => {
    await request(app.getHttpServer())
      .get('/scim/admin/credentials/migration-status')
      .expect(401);
  });

  it('P4-X8: keyed rows are attributed to hmac-sha256-v1', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
    });
    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .send({ credentialType: 'bearer', label: 'p4-algo' })
      .expect(201);

    const body = (await status().expect(200)).body;
    expect(body.byAlgo[HASH_ALGO_HMAC_V1]).toBeGreaterThan(0);
  });

  it('P4-X9: a WIF trust counts as SECRETLESS and does not hold the phase-5 gate shut', async () => {
    // Regression test for a defect the live run exposed: WIF rows store no
    // secret, so they are created with an empty hash and inherit the `bcrypt`
    // column default. Counted naively they are legacy rows that can never be
    // migrated, which would mean the gate never opens.
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
    });
    const before = (await status().expect(200)).body;

    await repo.create({
      endpointId,
      credentialType: 'wif',
      credentialHash: '',
      label: 'planted-wif',
      metadata: { expectedIssuer: 'https://example.test', jwksUri: 'https://example.test/jwks' },
    });

    const after = (await status().expect(200)).body;
    expect(after.secretless.total).toBe(before.secretless.total + 1);
    expect(after.legacy.total).toBe(before.legacy.total);

    const row = after.endpoints.find((e: { endpointId: string }) => e.endpointId === endpointId);
    expect(row).toBeUndefined();
  });

  it('P4-X10: the credential list reports hashAlgo, so the report can be ACTED on', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
    });
    const planted = await plantLegacy(endpointId);
    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .send({ credentialType: 'bearer', label: 'keyed-one' })
      .expect(201);

    const list = (
      await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body as Array<{ id: string; hashAlgo: string }>;

    expect(list.find((c) => c.id === planted.id)?.hashAlgo).toBe(HASH_ALGO_BCRYPT);
    expect(list.some((c) => c.hashAlgo === HASH_ALGO_HMAC_V1)).toBe(true);

    for (const c of list) {
      expect(c).not.toHaveProperty('credentialHash');
      expect(c).not.toHaveProperty('secretHash');
      expect(c).not.toHaveProperty('lookupKey');
    }
  });

  it('P4-X11: the report and the credential list AGREE on the legacy count for an endpoint', async () => {
    // Two independent code paths compute this - a grouped DB count and a
    // per-row projection. If they ever disagree, the number the one-way gate
    // depends on is not trustworthy, and neither is the work queue.
    const endpointId = await createEndpointWithConfig(app, token, {
      SecretTokenBearerAuthEnabled: true,
    });
    await plantLegacy(endpointId);
    await plantLegacy(endpointId);
    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .send({ credentialType: 'bearer', label: 'keyed-agree' })
      .expect(201);

    const list = (
      await request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${endpointId}/credentials`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body as Array<{ credentialType: string; hashAlgo: string }>;

    const listLegacy = list.filter(
      (c) => c.credentialType !== 'wif' && c.hashAlgo !== HASH_ALGO_HMAC_V1,
    ).length;

    const report = (await status().expect(200)).body;
    const row = report.endpoints.find((e: { endpointId: string }) => e.endpointId === endpointId);

    expect(row).toBeDefined();
    expect(row.legacyTotal).toBe(listLegacy);
  });
});
