/**
 * Admin authentication-methods CRUD - E2E (A1)
 *
 * Manage `profile.authentication.methods[]` over HTTP:
 *  - POST   /admin/endpoints/:id/authentication/methods   add a method
 *  - GET    /admin/endpoints/:id/authentication/methods   list methods
 *  - DELETE /admin/endpoints/:id/authentication/methods/:methodId  remove
 *
 * The model is the A0 inert backbone; A1 adds the management surface. No secret
 * is ever stored or returned (secret-looking config keys are stripped on save).
 *
 * @see docs/auth/AUTHENTICATION_ARCHITECTURE.md section 13 (A1)
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpoint } from './helpers/request.helper';

describe('Admin authentication-methods CRUD (A1)', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    token = await getAuthToken(app);
    endpointId = await createEndpoint(app, token);
  });

  afterAll(async () => {
    await app.close();
  });

  function base() {
    return `/scim/admin/endpoints/${endpointId}/authentication/methods`;
  }

  it('starts with an empty method list', async () => {
    const res = await request(app.getHttpServer())
      .get(base())
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(res.body.methods)).toBe(true);
    expect(res.body.methods).toHaveLength(0);
  });

  it('adds a method and returns it with a server-assigned id', async () => {
    const res = await request(app.getHttpServer())
      .post(base())
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'wif-7523',
        displayName: 'WIF',
        plane: 'token',
        config: { issuer: 'https://idp/v2.0', clientSecret: 'LEAK' },
      })
      .expect(201);

    expect(typeof res.body.id).toBe('string');
    expect(res.body.id.length).toBeGreaterThan(0);
    expect(res.body.type).toBe('wif-7523');
    // No-secret invariant: the secret-looking config key is stripped.
    expect(res.body.config.issuer).toBe('https://idp/v2.0');
    expect(res.body.config.clientSecret).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('LEAK');
  });

  it('lists the added method', async () => {
    const res = await request(app.getHttpServer())
      .get(base())
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.methods.length).toBeGreaterThanOrEqual(1);
    expect(res.body.methods.some((m: { type: string }) => m.type === 'wif-7523')).toBe(true);
  });

  it('rejects a method with an unknown type', async () => {
    await request(app.getHttpServer())
      .post(base())
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'not-a-real-type' })
      .expect(400);
  });

  it('deletes a method by id', async () => {
    const created = await request(app.getHttpServer())
      .post(base())
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'bearer', displayName: 'to-delete' })
      .expect(201);
    const methodId = created.body.id;

    await request(app.getHttpServer())
      .delete(`${base()}/${methodId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const after = await request(app.getHttpServer())
      .get(base())
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(after.body.methods.some((m: { id: string }) => m.id === methodId)).toBe(false);
  });

  it('returns 404 deleting a non-existent method', async () => {
    await request(app.getHttpServer())
      .delete(`${base()}/does-not-exist`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('persists methods on the endpoint profile (visible via GET endpoint)', async () => {
    const ep = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(ep.body.profile.authentication).toBeDefined();
    expect(Array.isArray(ep.body.profile.authentication.methods)).toBe(true);
  });
});
