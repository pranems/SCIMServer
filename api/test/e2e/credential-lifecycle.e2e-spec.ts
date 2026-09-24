import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpointWithConfig } from './helpers/request.helper';

/**
 * Credential lifecycle (V2 + V3) E2E.
 *
 * V2 - explicit deactivate then reactivate round-trips the `active` flag while
 * legacy DELETE remains compatible. Permanent purge removes only inactive rows.
 * V3 - PATCH edits a credential label without rotating the secret.
 */
describe('Credential lifecycle (V2 + V3) (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createBearer(endpointId: string, label = 'lifecycle') {
    return request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ credentialType: 'bearer', label })
      .expect(201);
  }

  const scimGet = (endpointId: string, credential: string) =>
    request(app.getHttpServer())
      .get(`/scim/endpoints/${endpointId}/Users?count=1`)
      .set('Authorization', `Bearer ${credential}`);

  it('V2: explicit deactivate and reactivate control bearer authentication', async () => {
    const endpointId = await createEndpointWithConfig(app, token, { SecretTokenBearerAuthEnabled: true });
    const created = await createBearer(endpointId);
    const id = created.body.id as string;
    const bearer = created.body.token as string;

    await scimGet(endpointId, bearer).expect(200);

    const deactivated = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/${id}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(deactivated.body).toEqual(expect.objectContaining({ id, active: false }));
    expect(Object.keys(deactivated.body).sort()).toEqual([
      'active',
      'credentialType',
      'endpointId',
      'id',
      'label',
    ]);
    await scimGet(endpointId, bearer).expect(401);

    let list = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.find((c: { id: string }) => c.id === id).active).toBe(false);

    // Reactivate.
    const activated = await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/${id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(activated.body.active).toBe(true);
    expect(activated.body).not.toHaveProperty('credentialHash');
    await scimGet(endpointId, bearer).expect(200);

    list = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.find((c: { id: string }) => c.id === id).active).toBe(true);
  });

  it('V2: legacy DELETE still soft-deactivates for compatibility', async () => {
    const endpointId = await createEndpointWithConfig(app, token, { SecretTokenBearerAuthEnabled: true });
    const created = await createBearer(endpointId, 'legacy-delete');

    await request(app.getHttpServer())
      .delete(`/scim/admin/endpoints/${endpointId}/credentials/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const list = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.find((row: { id: string }) => row.id === created.body.id).active).toBe(false);
  });

  it('purges only inactive credentials and removes their audit row permanently', async () => {
    const endpointId = await createEndpointWithConfig(app, token, { SecretTokenBearerAuthEnabled: true });
    const created = await createBearer(endpointId, 'purge-me');
    const id = created.body.id as string;

    await request(app.getHttpServer())
      .delete(`/scim/admin/endpoints/${endpointId}/credentials/${id}/purge`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/${id}/deactivate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/scim/admin/endpoints/${endpointId}/credentials/${id}/purge`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const list = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id })]));
    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/${id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('V2: activate returns 404 for an unknown credential', async () => {
    const endpointId = await createEndpointWithConfig(app, token, { SecretTokenBearerAuthEnabled: true });
    await request(app.getHttpServer())
      .post(`/scim/admin/endpoints/${endpointId}/credentials/00000000-0000-0000-0000-000000000000/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('V3: PATCH edits a bearer credential label without rotating', async () => {
    const endpointId = await createEndpointWithConfig(app, token, { SecretTokenBearerAuthEnabled: true });
    const created = await createBearer(endpointId, 'before');
    const id = created.body.id as string;

    const edited = await request(app.getHttpServer())
      .patch(`/scim/admin/endpoints/${endpointId}/credentials/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ label: 'after' })
      .expect(200);
    expect(edited.body.label).toBe('after');
    expect(edited.body).not.toHaveProperty('credentialHash');
    expect(edited.body).not.toHaveProperty('token');

    const list = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.find((c: { id: string }) => c.id === id).label).toBe('after');
  });

  it('V3: PATCH with no label returns 400', async () => {
    const endpointId = await createEndpointWithConfig(app, token, { SecretTokenBearerAuthEnabled: true });
    const created = await createBearer(endpointId);
    await request(app.getHttpServer())
      .patch(`/scim/admin/endpoints/${endpointId}/credentials/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({})
      .expect(400);
  });
});
