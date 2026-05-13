/**
 * E2E Tests - Phase L1 Admin Endpoints Create + Delete contract.
 *
 * The CRUD HTTP surface (POST / PATCH / DELETE /admin/endpoints +
 * GET /admin/endpoints/presets) shipped in v0.30.0; until L1 the
 * redesigned UI never wired POST or DELETE. L1 adds two new
 * regression-locks at the E2E layer:
 *
 *   1. POST /admin/endpoints response key allowlist - the wizard
 *      navigates straight to /endpoints/{id} on success, so the
 *      response shape MUST contain `id` + `name` + `active` +
 *      `scimBasePath`. Backward-compatible fields (`displayName`,
 *      `description`, `profileSummary`, `profile`, `_links`,
 *      `createdAt`, `updatedAt`) are allowed but not required.
 *
 *   2. Duplicate-name rejection - asserts the documented behavior
 *      (currently 400 BadRequest from the service layer; future
 *      RFC-aligned tightening to 409 Conflict would still flow
 *      through the same UI path because ScimApiError carries the
 *      status verbatim and the K3 error catalog has both 400 and
 *      409 entries).
 *
 * @see docs/PHASE_L1_ENDPOINT_CRUD.md
 * @see api/src/modules/endpoint/controllers/endpoint.controller.ts
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { resetFixtureCounter } from './helpers/fixtures';

// Allowed response keys the UI is contracted to consume. The wizard
// uses { id, name, active, scimBasePath } minimum; the rest are
// observable through the EndpointDetail view but not strictly
// required at create time.
const ALLOWED_KEYS = new Set([
  'id',
  'name',
  'displayName',
  'description',
  'active',
  'scimBasePath',
  'profileSummary',
  'profile',
  '_links',
  'createdAt',
  'updatedAt',
]);

describe('Admin Endpoints Create (Phase L1, E2E)', () => {
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

  it('POST /admin/endpoints with profilePreset returns the created endpoint with the documented key allowlist', async () => {
    const name = `l1-create-key-${Date.now()}`;
    const res = await request(app.getHttpServer())
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, profilePreset: 'rfc-standard' })
      .expect(201);

    // Required UI-contract fields.
    expect(res.body.id).toBeDefined();
    expect(res.body.name).toBe(name);
    expect(typeof res.body.active).toBe('boolean');
    expect(typeof res.body.scimBasePath).toBe('string');

    // Every returned key must be in the allowlist - prevents silent
    // drift like accidentally returning a credentialHash or an
    // internal _ prefixed field.
    for (const key of Object.keys(res.body)) {
      expect(ALLOWED_KEYS).toContain(key);
    }

    // Cleanup.
    await request(app.getHttpServer())
      .delete(`/scim/admin/endpoints/${res.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });

  it('POST /admin/endpoints with a duplicate name is rejected with 400 (or 409 if a future tightening lands)', async () => {
    const name = `l1-dup-${Date.now()}`;
    const first = await request(app.getHttpServer())
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, profilePreset: 'minimal' })
      .expect(201);

    // Second create with the same name. Per current backend semantics
    // this is 400 (BadRequest from service layer); a future
    // RFC-aligned tightening to 409 Conflict would still flow through
    // the same UI surface because both 400 and 409 trigger the K3
    // ScimErrorMessage with appropriate plain-English copy.
    const res = await request(app.getHttpServer())
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, profilePreset: 'rfc-standard' });

    expect([400, 409]).toContain(res.status);

    // Cleanup the legitimately-created endpoint.
    await request(app.getHttpServer())
      .delete(`/scim/admin/endpoints/${first.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
  });
});
