/**
 * WI-D2: auth-failure reason-code catalog reference endpoint - E2E.
 *
 * `GET /scim/docs/auth-errors` publishes the machine-readable catalog publicly,
 * so a client or operator can resolve any `reason_code` seen in a token error,
 * an AUTH log event, or the admin diagnostics UI to its wire error + human
 * description + remediation + visibility tier.
 *
 * @see docs/auth/AUTH_ERROR_DIAGNOSTICS_AND_OBSERVABILITY.md Part 7
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';

const REASON_KEYS = ['reasonCode', 'wireError', 'plane', 'tier', 'actorDescription', 'remediation'];
const TOP_KEYS = ['description', 'docsUrl', 'count', 'reasons'];

describe('WI-D2 auth-errors catalog endpoint', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('is public (no auth) and returns the catalog', async () => {
    const res = await request(app.getHttpServer()).get('/scim/docs/auth-errors');
    expect(res.status).toBe(200);
    expect(typeof res.body.count).toBe('number');
    expect(res.body.count).toBeGreaterThan(0);
    expect(Array.isArray(res.body.reasons)).toBe(true);
    expect(res.body.reasons.length).toBe(res.body.count);
  });

  it('response has ONLY the documented top-level keys', async () => {
    const res = await request(app.getHttpServer()).get('/scim/docs/auth-errors');
    for (const key of Object.keys(res.body)) {
      expect(TOP_KEYS).toContain(key);
    }
  });

  it('every reason has ONLY the documented keys and a known wire error', async () => {
    const res = await request(app.getHttpServer()).get('/scim/docs/auth-errors');
    const validWire = ['invalid_client', 'invalid_request', 'unsupported_grant_type', 'invalid_token'];
    for (const reason of res.body.reasons) {
      for (const key of Object.keys(reason)) {
        expect(REASON_KEYS).toContain(key);
      }
      expect(validWire).toContain(reason.wireError);
      expect(['T1', 'T2', 'T3', 'T4']).toContain(reason.tier);
    }
  });

  it('includes the WIF and oauth_client and bearer planes', async () => {
    const res = await request(app.getHttpServer()).get('/scim/docs/auth-errors');
    const planes = new Set(res.body.reasons.map((r: { plane: string }) => r.plane));
    expect(planes.has('wif')).toBe(true);
    expect(planes.has('oauth_client')).toBe(true);
    expect(planes.has('bearer')).toBe(true);
  });

  it('filters by plane', async () => {
    const res = await request(app.getHttpServer()).get('/scim/docs/auth-errors?plane=wif');
    expect(res.status).toBe(200);
    expect(res.body.reasons.every((r: { plane: string }) => r.plane === 'wif')).toBe(true);
  });

  it('oauth_client_auth_failed is merged (does not distinguish secret existence vs correctness)', async () => {
    const res = await request(app.getHttpServer()).get('/scim/docs/auth-errors');
    const entry = res.body.reasons.find(
      (r: { reasonCode: string }) => r.reasonCode === 'oauth_client_auth_failed',
    );
    expect(entry).toBeDefined();
    expect(entry.tier).toBe('T3');
    expect(entry.actorDescription).toBe('Client authentication failed.');
  });
});
