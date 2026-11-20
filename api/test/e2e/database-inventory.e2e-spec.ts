import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpoint, scimBasePath, scimDelete, scimGet, scimPost } from './helpers/request.helper';
import { validGroup, validUser } from './helpers/fixtures';

describe('Cross-endpoint database inventory', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string | undefined;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
    endpointId = await createEndpoint(app, token, `inventory-runtime-${Date.now()}`);
  });

  afterAll(async () => {
    if (endpointId) await scimDelete(app, `/scim/admin/endpoints/${endpointId}`, token).expect(204);
    await app.close();
  });

  it('returns created users with their endpoint and original public ID', async () => {
    const fixture = validUser();
    const base = scimBasePath(endpointId!);
    const created = await scimPost(app, `${base}/Users`, token, fixture).expect(201);
    const inventory = await scimGet(app,
      `/scim/admin/database/users?search=${encodeURIComponent(fixture.userName)}`, token).expect(200);
    expect(Object.keys(inventory.body).sort()).toEqual(['pagination', 'users']);
    expect(inventory.body.pagination.total).toBe(1);
    expect(inventory.body.users).toEqual([
      expect.objectContaining({ userName: fixture.userName, endpointId }),
    ]);
    const readback = await scimGet(app, `${base}/Users/${created.body.id}`, token).expect(200);
    expect(readback.body.id).toBe(created.body.id);
    expect(readback.body.userName).toBe(fixture.userName);
  });

  it('returns created groups with their endpoint and original public ID', async () => {
    const fixture = validGroup();
    const base = scimBasePath(endpointId!);
    const created = await scimPost(app, `${base}/Groups`, token, fixture).expect(201);
    const inventory = await scimGet(app,
      `/scim/admin/database/groups?search=${encodeURIComponent(fixture.displayName)}`, token).expect(200);
    expect(Object.keys(inventory.body).sort()).toEqual(['groups', 'pagination']);
    expect(inventory.body.pagination.total).toBe(1);
    expect(inventory.body.groups).toEqual([
      expect.objectContaining({ displayName: fixture.displayName, endpointId }),
    ]);
    const readback = await scimGet(app, `${base}/Groups/${created.body.id}`, token).expect(200);
    expect(readback.body.id).toBe(created.body.id);
    expect(readback.body.displayName).toBe(fixture.displayName);
  });
});
