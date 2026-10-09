import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  E2E_TOKEN,
  createFixtureEndpoint,
  deleteFixtureEndpoint,
  seedAuthToken,
} from './endpoint-fixture';

async function authenticatedPage(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  await seedAuthToken(page);
  const connected = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/scim/admin/log-config/stream' &&
    response.status() === 200);
  await page.goto(path);
  await expect(page.getByTestId('app-shell')).toBeVisible();
  const stream = await connected;
  expect(stream.headers()['content-type']).toContain('text/event-stream');
  return page;
}

test('Tab A creates a User; authenticated SSE refreshes Tab B without reloading', async ({ browser }) => {
  test.setTimeout(60_000);
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  let endpointId: string | null = null;
  let tabA: Page | undefined;

  try {
    tabA = await authenticatedPage(contextA, '/endpoints');
    endpointId = await createFixtureEndpoint(tabA, { namePrefix: 'e2e-cross-tab-sse' });
    const path = `/scim/endpoints/${endpointId}/Users`;
    const tabB = await authenticatedPage(contextB, `/endpoints/${endpointId}/users`);
    await expect(tabB.getByTestId('users-empty-action')).toBeVisible();
    await tabA.goto(`/endpoints/${endpointId}/users`);
    await tabA.getByTestId('users-empty-action').click();
    const userName = `cross-tab-${Date.now()}@example.test`;
    await tabA.getByTestId('create-resource-form-userName-input').fill(userName);

    // Register before the write; Tab B is never navigated, focused or reloaded.
    const refreshed = tabB.waitForResponse((response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === path &&
      response.status() === 200, { timeout: 5_000 });
    const created = tabA.waitForResponse((response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === path);
    await tabA.getByTestId('create-resource-dialog-submit').click();
    const response = await created;
    expect(response.status()).toBe(201);
    const user = await response.json() as { id: string; userName: string };
    expect(user.userName).toBe(userName);
    expect(user.id).toBeTruthy();

    const refreshedBody = await (await refreshed).json() as {
      Resources: Array<{ id: string; userName: string }>;
    };
    expect(refreshedBody.Resources).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: user.id, userName })]),
    );
    await expect(tabB.getByTestId(`user-row-${user.id}`)).toContainText(userName);
    const persisted = await tabB.request.get(`${path}/${user.id}`, {
      headers: { Authorization: ['Bearer', E2E_TOKEN].join(' ') },
    });
    expect(persisted.status()).toBe(200);
    expect(await persisted.json()).toMatchObject({ id: user.id, userName });
  } finally {
    try {
      if (tabA) endpointId = await deleteFixtureEndpoint(tabA, endpointId);
    } finally {
      await contextA.close();
      await contextB.close();
    }
  }
});
