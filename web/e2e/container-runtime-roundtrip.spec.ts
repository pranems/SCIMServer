import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createFixtureEndpoint, seedAuthToken } from './endpoint-fixture';

const token = process.env.E2E_TOKEN || 'changeme-scim';
const headers = { Authorization: `Bearer ${token}` };

test('host browser reads persisted SCIM users and groups through the selected runtime', async ({ page, request }) => {
  await seedAuthToken(page);
  const endpoint = {
    id: await createFixtureEndpoint(page, { namePrefix: 'runtime-browser', profilePreset: 'rfc-standard' }),
  };

  try {
    const userName = `runtime-${randomUUID()}@example.test`;
    const userResponse = await request.post(`/scim/endpoints/${endpoint.id}/Users`, {
      headers,
      data: {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName,
        active: true,
      },
    });
    expect(userResponse.status()).toBe(201);
    const user: { id: string; userName: string; active: boolean } = await userResponse.json();
    expect(user).toMatchObject({ id: expect.any(String), userName, active: true });

    for (const visit of ['initial', 'reload']) {
      const usersLoaded = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/scim/admin/database/users' &&
          response.request().method() === 'GET',
      );
      if (visit === 'initial') {
        await page.goto('/operations');
      } else {
        await page.reload();
      }
      const response = await usersLoaded;
      expect(response.status()).toBe(200);
      const body: { users: Array<{ id: string; endpointId: string; userName: string; active: boolean }> } = await response.json();
      const inventoryUser = body.users.find((entry) => entry.endpointId === endpoint.id && entry.userName === userName);
      if (!inventoryUser) {
        throw new Error('The created SCIM user is missing from its endpoint in the cross-endpoint inventory.');
      }
      expect(inventoryUser).toMatchObject({
        id: expect.any(String),
        endpointId: endpoint.id,
        userName,
        active: true,
      });
      await expect(page.getByTestId(`operations-user-row-${inventoryUser.id}`)).toContainText(userName);
      const persisted = await request.get(`/scim/endpoints/${endpoint.id}/Users/${user.id}`, { headers });
      expect(persisted.status()).toBe(200);
      expect(await persisted.json()).toMatchObject({ id: user.id, userName, active: true });
    }
    const displayName = `runtime-group-${randomUUID()}`;
    const groupResponse = await request.post(`/scim/endpoints/${endpoint.id}/Groups`, {
      headers,
      data: { schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName },
    });
    expect(groupResponse.status()).toBe(201);
    const group: { id: string; displayName: string } = await groupResponse.json();
    expect(group).toMatchObject({ id: expect.any(String), displayName });

    for (const visit of ['initial', 'reload']) {
      const groupsLoaded = page.waitForResponse(
        (response) => new URL(response.url()).pathname === '/scim/admin/database/groups' &&
          response.request().method() === 'GET',
      );
      if (visit === 'initial') await page.goto('/operations?tab=groups');
      else await page.reload();
      const response = await groupsLoaded;
      expect(response.status()).toBe(200);
      const body: { groups: Array<{ id: string; endpointId: string; displayName: string; memberCount: number }> } = await response.json();
      const inventoryGroup = body.groups.find((entry) => entry.endpointId === endpoint.id && entry.displayName === displayName);
      if (!inventoryGroup) {
        throw new Error('The created SCIM group is missing from its endpoint in the cross-endpoint inventory.');
      }
      expect(inventoryGroup).toMatchObject({ endpointId: endpoint.id, displayName, memberCount: 0 });
      await expect(page.getByTestId(`operations-group-row-${inventoryGroup.id}`)).toContainText(displayName);
      const persisted = await request.get(`/scim/endpoints/${endpoint.id}/Groups/${group.id}`, { headers });
      expect(persisted.status()).toBe(200);
      expect(await persisted.json()).toMatchObject({ id: group.id, displayName });
    }
  } finally {
    const removed = await request.delete(`/scim/admin/endpoints/${endpoint.id}`, { headers });
    expect([200, 204]).toContain(removed.status());
    const missing = await request.get(`/scim/admin/endpoints/${endpoint.id}`, { headers });
    expect(missing.status()).toBe(404);
  }
});
