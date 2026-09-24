import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpointWithConfig } from './helpers/request.helper';

const POLICY_KEYS = [
  'cacheMaxAgeMs',
  'maxCacheEntries',
  'maxKeys',
  'maxResponseBytes',
  'refreshIntervalMs',
  'retries',
  'retryBackoffMs',
  'staleIfErrorMs',
  'timeoutMs',
  'totalDeadlineMs',
  'unknownKidMinIntervalMs',
] as const;

describe('Endpoint effective egress policy (E2E)', () => {
  let app: INestApplication;
  let token: string;
  const priorTimeout = process.env.JWKS_FETCH_TIMEOUT_MS;

  beforeAll(async () => {
    process.env.JWKS_FETCH_TIMEOUT_MS = '75000';
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
    if (priorTimeout === undefined) delete process.env.JWKS_FETCH_TIMEOUT_MS;
    else process.env.JWKS_FETCH_TIMEOUT_MS = priorTimeout;
  });

  it('reports endpoint provenance, then reset-to-inherit exposes the clamped server value', async () => {
    const endpointId = await createEndpointWithConfig(app, token, {
      JwksFetchTimeoutMs: 1200,
      JwksFetchRetries: 4,
    });

    const configured = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/egress-policy`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  expect(Object.keys(configured.body).sort()).toEqual(POLICY_KEYS);
    expect(configured.body.timeoutMs).toEqual({
      effective: 1200,
      configured: 1200,
      source: 'endpoint',
      unit: 'ms',
      min: 100,
      max: 60000,
      clamped: false,
    });
    expect(Object.keys(configured.body.timeoutMs).sort()).toEqual([
      'clamped',
      'configured',
      'effective',
      'max',
      'min',
      'source',
      'unit',
    ]);

    await request(app.getHttpServer())
      .patch(`/scim/admin/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ profile: { settings: { JwksFetchTimeoutMs: null } } })
      .expect(200);

    const endpoint = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(endpoint.body.profile.settings).not.toHaveProperty('JwksFetchTimeoutMs');
    expect(endpoint.body.profile.settings.JwksFetchRetries).toBe(4);

    const inherited = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/egress-policy`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(inherited.body.timeoutMs).toEqual({
      effective: 60000,
      configured: null,
      source: 'server-env',
      unit: 'ms',
      min: 100,
      max: 60000,
      clamped: true,
      requested: 75000,
    });
    expect(JSON.stringify(inherited.body)).not.toMatch(/secret|databaseUrl|allowlist/i);
  });
});
