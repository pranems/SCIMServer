import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimBasePath, scimDelete, scimGet, scimPost } from './helpers/request.helper';
import { validGroup, validUser } from './helpers/fixtures';

interface InventoryResponse {
  pagination: { total: number };
  [key: string]: unknown;
}

describe('Cross-endpoint database inventory', () => {
  let app: INestApplication;
  let token: string;
  const endpointIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
    const original = await scimGet(app, '/scim/admin/endpoints', token).expect(200);
    const originalBody = original.body as { totalResults: number; endpoints: Array<{ id: string }> };
    expect(Array.isArray(originalBody.endpoints)).toBe(true);
    expect(originalBody.totalResults).toBe(originalBody.endpoints.length);
    const originalIds = new Set<string>(
      originalBody.endpoints.map((endpoint) => endpoint.id),
    );
    for (let index = 0; index < 2; index++) {
      const created = await scimPost(app, '/scim/admin/endpoints', token, {
        name: `inventory-runtime-${randomUUID()}`,
        profilePreset: 'rfc-standard',
      }).expect(201);
      const createdBody = created.body as { id: string };
      expect(createdBody.id).toEqual(expect.any(String));
      expect(originalIds.has(createdBody.id)).toBe(false);
      expect(endpointIds).not.toContain(createdBody.id);
      endpointIds.push(createdBody.id);
    }
  });

  afterAll(async () => {
    for (const id of endpointIds) {
      await scimDelete(app, `/scim/admin/endpoints/${id}`, token).expect(204);
      await scimGet(app, `/scim/admin/endpoints/${id}`, token).expect(404);
    }
    await app.close();
  });

  it('returns created users with their endpoint and original public ID', async () => {
    const endpointId = endpointIds[0];
    const fixture = validUser({ userName: `inventory-${randomUUID()}@example.com` });
    const base = scimBasePath(endpointId);
    const created = await scimPost(app, `${base}/Users`, token, fixture).expect(201);
    const inventory = await scimGet(app,
      `/scim/admin/database/users?search=${encodeURIComponent(fixture.userName)}`, token).expect(200);
    const body = inventory.body as InventoryResponse;
    expect(Object.keys(body).sort()).toEqual(['pagination', 'users']);
    expect(body.pagination.total).toBe(1);
    expect(body.users).toEqual([
      expect.objectContaining({ userName: fixture.userName, endpointId }),
    ]);
    const createdBody = created.body as { id: string };
    const readback = await scimGet(app, `${base}/Users/${createdBody.id}`, token).expect(200);
    const readbackBody = readback.body as Record<string, unknown>;
    expect(readbackBody.id).toBe(createdBody.id);
    expect(readbackBody.userName).toBe(fixture.userName);
  });

  it('returns created groups with their endpoint and original public ID', async () => {
    const endpointId = endpointIds[0];
    const fixture = validGroup({ displayName: `inventory-${randomUUID()}` });
    const base = scimBasePath(endpointId);
    const created = await scimPost(app, `${base}/Groups`, token, fixture).expect(201);
    const inventory = await scimGet(app,
      `/scim/admin/database/groups?search=${encodeURIComponent(fixture.displayName)}`, token).expect(200);
    const body = inventory.body as InventoryResponse;
    expect(Object.keys(body).sort()).toEqual(['groups', 'pagination']);
    expect(body.pagination.total).toBe(1);
    expect(body.groups).toEqual([
      expect.objectContaining({ displayName: fixture.displayName, endpointId }),
    ]);
    const createdBody = created.body as { id: string };
    const readback = await scimGet(app, `${base}/Groups/${createdBody.id}`, token).expect(200);
    const readbackBody = readback.body as Record<string, unknown>;
    expect(readbackBody.id).toBe(createdBody.id);
    expect(readbackBody.displayName).toBe(fixture.displayName);
  });

  it.each([
    { resource: 'Users', key: 'users', attribute: 'userName' },
    { resource: 'Groups', key: 'groups', attribute: 'displayName' },
  ])('returns matching $resource from both endpoints without narrowing global search', async ({
    resource, key, attribute,
  }) => {
    const value = `inventory-shared-${randomUUID()}@example.com`;
    const fixture = resource === 'Users'
      ? validUser({ userName: value })
      : validGroup({ displayName: value });
    for (const id of endpointIds) {
      await scimPost(app, `${scimBasePath(id)}/${resource}`, token, fixture).expect(201);
    }
    const inventory = await scimGet(app,
      `/scim/admin/database/${key}?search=${encodeURIComponent(value)}`, token).expect(200);
    const body = inventory.body as InventoryResponse;
    expect(Object.keys(body).sort()).toEqual([key, 'pagination'].sort());
    expect(body.pagination.total).toBe(2);
    expect(body[key]).toHaveLength(2);
    for (const id of endpointIds) {
      expect(body[key]).toContainEqual(expect.objectContaining({ [attribute]: value, endpointId: id }));
    }
  });
});
