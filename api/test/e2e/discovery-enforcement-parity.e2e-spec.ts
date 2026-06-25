import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimPost, scimGet, scimBasePath } from './helpers/request.helper';
import { resetFixtureCounter } from './helpers/fixtures';

/**
 * Discovery-vs-enforcement parity harness - E2E (Phase 1 self-improvement).
 *
 * For every built-in preset, this suite asserts the invariant that closes the
 * whole advertise-but-don't-enforce bug class: what `/ResourceTypes` advertises
 * is exactly what built-in CRUD serves. Specifically, for each built-in resource
 * type (User, Group) NOT present in a preset's `/ResourceTypes`, the matching
 * collection endpoint MUST be rejected (404), not silently served.
 *
 * This single harness would have caught the reported user-only-endpoint Group
 * bug, and catches the next preset that narrows its resource types.
 *
 * @see docs/ENDPOINT_PROFILE_ENFORCEMENT_DESIGN.md §13.2
 */
const BUILT_IN_PRESETS = ['entra-id', 'entra-id-minimal', 'rfc-standard', 'minimal', 'user-only', 'user-only-with-custom-ext'];
const BUILT_IN_RESOURCE_TYPES: Array<{ name: string; collection: string }> = [
  { name: 'User', collection: 'Users' },
  { name: 'Group', collection: 'Groups' },
];

async function createEndpointFromPreset(app: INestApplication, token: string, preset: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/scim/admin/endpoints')
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/json')
    .send({ name: `parity-${preset}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, profilePreset: preset })
    .expect(201);
  return res.body.id as string;
}

describe('Discovery-vs-enforcement parity harness (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => resetFixtureCounter());

  it.each(BUILT_IN_PRESETS)('preset "%s": advertised resource types == enforced', async (preset) => {
    const endpointId = await createEndpointFromPreset(app, token, preset);
    const basePath = scimBasePath(endpointId);

    // Read what discovery advertises.
    const rtRes = await scimGet(app, `${basePath}/ResourceTypes`, token).expect(200);
    const advertised = new Set<string>((rtRes.body.Resources ?? []).map((r: { name: string }) => r.name));

    for (const rt of BUILT_IN_RESOURCE_TYPES) {
      if (advertised.has(rt.name)) {
        // Advertised -> the collection GET must NOT 404 for "type unsupported".
        const res = await scimGet(app, `${basePath}/${rt.collection}`, token);
        expect(res.status).not.toBe(404);
      } else {
        // NOT advertised -> the collection GET MUST be rejected with 404.
        const res = await scimGet(app, `${basePath}/${rt.collection}`, token);
        expect(res.status).toBe(404);
        // And a write must be rejected too.
        const writeBody = rt.name === 'User'
          ? { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: `x-${Date.now()}@x.io` }
          : { schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: `x-${Date.now()}` };
        const writeRes = await scimPost(app, `${basePath}/${rt.collection}`, token, writeBody);
        expect(writeRes.status).toBe(404);
      }
    }
  });

  it('user-only presets advertise no Group AND reject Group CRUD', async () => {
    for (const preset of ['user-only', 'user-only-with-custom-ext']) {
      const endpointId = await createEndpointFromPreset(app, token, preset);
      const basePath = scimBasePath(endpointId);

      const rtRes = await scimGet(app, `${basePath}/ResourceTypes`, token).expect(200);
      const names = (rtRes.body.Resources ?? []).map((r: { name: string }) => r.name);
      expect(names).not.toContain('Group');

      // Enforcement matches the advertisement.
      await scimGet(app, `${basePath}/Groups`, token).expect(404);
    }
  });
});
