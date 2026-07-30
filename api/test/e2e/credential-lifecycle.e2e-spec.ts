import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpointWithConfig } from './helpers/request.helper';

/**
 * Credential lifecycle (V2 + V3) E2E.
 *
 * V2 - deactivate (DELETE) then reactivate (POST .../activate) round-trips the
 * `active` flag. V3 - PATCH edits a credential label without rotating the secret.
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

  it('V2: deactivate then reactivate round-trips the active flag', async () => {
    const endpointId = await createEndpointWithConfig(app, token, { SecretTokenBearerAuthEnabled: true });
    const created = await createBearer(endpointId);
    const id = created.body.id as string;

    // Deactivate.
    await request(app.getHttpServer())
      .delete(`/scim/admin/endpoints/${endpointId}/credentials/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);
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

    list = await request(app.getHttpServer())
      .get(`/scim/admin/endpoints/${endpointId}/credentials`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(list.body.find((c: { id: string }) => c.id === id).active).toBe(true);
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
