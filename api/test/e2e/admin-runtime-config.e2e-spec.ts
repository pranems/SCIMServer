import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { RUNTIME_CONFIG_SPECS } from '../../src/bootstrap/runtime-config';

/**
 * W1.7c - `GET /scim/admin/runtime-config` over the wire.
 *
 * Per the standing response-contract rule, asserting that a field EXISTS is not
 * asserting the response is CORRECT: these tests assert the full key allowlist
 * at both the envelope and the per-setting level, so a future field addition has
 * to be a deliberate contract change rather than an accidental leak.
 */
describe('Admin runtime-config API (E2E)', () => {
  let app: INestApplication;
  let token: string;

  const ENVELOPE_KEYS = ['schemas', 'groups', 'invariantWarnings'];
  const SETTING_KEYS = ['effective', 'source', 'default', 'min', 'max', 'clamped', 'requested'];
  /** Env vars that must NEVER be reachable through this surface. */
  const FORBIDDEN = [
    'DATABASE_URL',
    'OAUTH_CLIENT_SECRET',
    'SCIM_SHARED_SECRET',
    'JWT_SECRET',
    'JWKS_HOST_ALLOWLIST',
    'CREDENTIAL_KEK',
    'OAUTH_JWT_PRIVATE_KEY',
  ];

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/scim/admin/runtime-config').expect(401);
  });

  it('returns no-store so a live process snapshot is never cached', async () => {
    const res = await request(app.getHttpServer())
      .get('/scim/admin/runtime-config')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('returns ONLY the documented envelope keys', async () => {
    const res = await request(app.getHttpServer())
      .get('/scim/admin/runtime-config')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Object.keys(res.body as object).sort()).toEqual([...ENVELOPE_KEYS].sort());
  });

  it('reports every group and every setting with provenance and bounds', async () => {
    const res = await request(app.getHttpServer())
      .get('/scim/admin/runtime-config')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      groups: Record<string, Record<string, Record<string, unknown>>>;
      invariantWarnings: string[];
    };
    expect(Object.keys(body.groups).sort()).toEqual(Object.keys(RUNTIME_CONFIG_SPECS).sort());

    for (const [groupName, specs] of Object.entries(RUNTIME_CONFIG_SPECS)) {
      expect(Object.keys(body.groups[groupName]).sort()).toEqual(Object.keys(specs).sort());
      for (const setting of Object.values(body.groups[groupName])) {
        // Key ALLOWLIST, not a presence check - nothing undocumented may appear.
        for (const key of Object.keys(setting)) expect(SETTING_KEYS).toContain(key);
        expect(setting.effective).toBeDefined();
        expect(['env', 'legacy-env', 'default']).toContain(setting.source);
        expect(typeof setting.clamped).toBe('boolean');
      }
    }
  });

  it('advertises the runtime-config schema URN', async () => {
    const res = await request(app.getHttpServer())
      .get('/scim/admin/runtime-config')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((res.body as { schemas: string[] }).schemas).toEqual([
      'urn:scimserver:params:scim:schemas:admin:2.0:RuntimeConfig',
    ]);
  });

  it('leaks no secret-bearing env var name or value', async () => {
    const res = await request(app.getHttpServer())
      .get('/scim/admin/runtime-config')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const serialized = JSON.stringify(res.body);
    for (const name of FORBIDDEN) expect(serialized).not.toContain(name);
    // And no internal underscore-prefixed runtime field.
    expect(serialized).not.toMatch(/"_[a-zA-Z]/);
  });

  it('every advertised effective value sits inside its own published bounds', async () => {
    const res = await request(app.getHttpServer())
      .get('/scim/admin/runtime-config')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = res.body as { groups: Record<string, Record<string, Record<string, number>>> };
    for (const group of Object.values(body.groups)) {
      for (const setting of Object.values(group)) {
        if (typeof setting.effective !== 'number') continue;
        expect(setting.effective).toBeGreaterThanOrEqual(setting.min);
        expect(setting.effective).toBeLessThanOrEqual(setting.max);
      }
    }
  });

  it('reports a coherent default configuration with no invariant warnings', async () => {
    const res = await request(app.getHttpServer())
      .get('/scim/admin/runtime-config')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((res.body as { invariantWarnings: string[] }).invariantWarnings).toEqual([]);
  });
});
