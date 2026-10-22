import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';

interface Body extends Record<string, unknown> {
  id: string;
  Resources: Body[];
  totalResults: number;
}
type Response = Omit<request.Response, 'body'> & { body: Body };

describe('Shared schema-cache ResourceType bindings (E2E)', () => {
  let app: INestApplication;
  let token: string;
  const core = 'urn:example:schemas:core:Device';
  const extension = 'urn:example:schemas:extension:ProtectedDevice';

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => { await app.close(); });

  it.each([false, true])('preserves extension rules across requests, protected-first=%s', async protectedFirst => {
    const endpoint: Response = await request(app.getHttpServer() as Server)
      .post('/scim/admin/endpoints')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `binding-cache-${protectedFirst}-${Date.now()}`,
        profile: {
          schemas: [
            { id: core, name: 'Device', attributes: [
              { name: 'displayName', type: 'string', required: true },
            ] },
            { id: extension, name: 'ProtectedDevice', attributes: [
              { name: 'hidden', type: 'string', returned: 'never' },
              { name: 'password', type: 'string', mutability: 'writeOnly' },
              { name: 'serverValue', type: 'string', mutability: 'readOnly' },
              { name: 'visible', type: 'string' },
            ] },
          ],
          resourceTypes: [
            { id: 'PlainDevice', name: 'PlainDevice', endpoint: '/PlainDevices',
              description: 'Core only', schema: core, schemaExtensions: [] },
            { id: 'ProtectedDevice', name: 'ProtectedDevice', endpoint: '/ProtectedDevices',
              description: 'Protected extension', schema: core,
              schemaExtensions: [{ schema: extension, required: false }] },
          ],
          serviceProviderConfig: {
            patch: { supported: true }, bulk: { supported: false }, filter: { supported: true },
            changePassword: { supported: false }, sort: { supported: true }, etag: { supported: true },
          },
          settings: { IgnoreReadOnlyAttributesInPatch: true },
        },
      }).expect(201);
    const base = `/scim/endpoints/${endpoint.body.id}`;
    const ids = new Map<string, string>();
    const order = protectedFirst ? ['ProtectedDevices', 'PlainDevices'] : ['PlainDevices', 'ProtectedDevices'];
    const assertProtected = (body: Record<string, unknown>) => {
      expect(body[extension]).toEqual({ visible: 'public' });
      expect(body.schemas).toEqual([core, extension]);
      for (const key of Object.keys(body)) {
        expect(['schemas', 'id', 'displayName', 'meta', extension]).toContain(key);
      }
    };
    try {
      for (const path of order) {
        const protectedType = path === 'ProtectedDevices';
        const created: Response = await request(app.getHttpServer() as Server).post(`${base}/${path}`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            schemas: protectedType ? [core, extension] : [core],
            displayName: path,
            ...(protectedType ? { [extension]: {
              hidden: 'hidden on every read', password: 'write-only value',
              serverValue: 'client must not set', visible: 'public',
            } } : {}),
          }).expect(201);
        ids.set(path, created.body.id);
        if (protectedType) assertProtected(created.body);
      }
      for (const path of [...order, ...order]) {
        const read: Response = await request(app.getHttpServer() as Server).get(`${base}/${path}/${ids.get(path)}`)
          .set('Authorization', `Bearer ${token}`).expect(200);
        if (path === 'ProtectedDevices') assertProtected(read.body);
      }
      const protectedPath = `${base}/ProtectedDevices/${ids.get('ProtectedDevices')}`;
      const projected: Response = await request(app.getHttpServer() as Server).get(protectedPath)
        .query({ attributes: `displayName,${extension}:hidden,${extension}:password,${extension}:visible` })
        .set('Authorization', `Bearer ${token}`).expect(200);
      assertProtected(projected.body);
      const listed: Response = await request(app.getHttpServer() as Server).get(`${base}/ProtectedDevices`)
        .set('Authorization', `Bearer ${token}`).expect(200);
      expect(listed.body.totalResults).toBe(1);
      assertProtected(listed.body.Resources[0]);
      const replaced: Response = await request(app.getHttpServer() as Server).put(protectedPath)
        .set('Authorization', `Bearer ${token}`)
        .send({ schemas: [core, extension], displayName: 'ProtectedDevices',
          [extension]: { hidden: 'still hidden', password: 'still write only',
            serverValue: 'PUT must not set', visible: 'public' } }).expect(200);
      assertProtected(replaced.body);
      const patched: Response = await request(app.getHttpServer() as Server).patch(protectedPath)
        .set('Authorization', `Bearer ${token}`)
        .send({ schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
          Operations: [
            { op: 'replace', path: `${extension}:serverValue`, value: 'PATCH must not set' },
            { op: 'replace', path: `${extension}:visible`, value: 'public' },
          ] }).expect(200);
      assertProtected(patched.body);
      const final: Response = await request(app.getHttpServer() as Server).get(protectedPath)
        .set('Authorization', `Bearer ${token}`).expect(200);
      assertProtected(final.body);
    } finally {
      await request(app.getHttpServer() as Server).delete(`/scim/admin/endpoints/${endpoint.body.id}`)
        .set('Authorization', `Bearer ${token}`).expect(204);
    }
  });
});
