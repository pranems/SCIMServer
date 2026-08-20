/**
 * C - concurrent-edit conflict on the resource-types tab, in a real browser.
 *
 * This tab sends the WHOLE resourceTypes + schemas arrays, merged from the
 * profile it read when the page loaded. Before this change a second editor's
 * work was erased with a 200 OK and nothing on screen said so.
 *
 * Run against any form factor:
 *   $env:E2E_BASE_URL = 'http://localhost:6000'   # local node
 *   $env:E2E_TOKEN    = 'changeme-scim'
 *   npx playwright test e2e/endpoint-write-conflict.spec.ts --reporter=line
 */
import { test, expect } from './fixtures';

const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';

test.describe('endpoint write conflict (C)', () => {
  let endpointId: string;

  test.beforeEach(async ({ request, baseURL, page }) => {
    // Seed the token before the app boots. The shared fixture drives the token
    // dialog, which is fine for a first-load test but leaves this one racing a
    // modal it does not care about.
    await page.addInitScript((t) => {
      window.localStorage.setItem('scimserver.authToken', t);
    }, TOKEN);

    const created = await request.post(`${baseURL}/scim/admin/endpoints`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: {
        name: `pw-conflict-${Date.now()}`,
        displayName: 'Conflict spec',
      },
    });
    expect(created.ok()).toBeTruthy();
    endpointId = (await created.json()).id;

    // A profile supplied at create must be complete, so the flag goes on after
    // create, where settings merge per key and the defaults are preserved.
    const enabled = await request.patch(`${baseURL}/scim/admin/endpoints/${endpointId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { profile: { settings: { CustomResourceTypesEnabled: 'True' } } },
    });
    expect(enabled.ok()).toBeTruthy();
  });

  test.afterEach(async ({ request, baseURL }) => {
    await request.delete(`${baseURL}/scim/admin/endpoints/${endpointId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
  });

  test('C-P1: a save built on a stale view raises the conflict dialog', async ({ page, request, baseURL }) => {
    await page.goto(`/endpoints/${endpointId}/resource-types`);
    await expect(page.getByTestId('resource-types-tab')).toBeVisible();

    // The other operator. The UI still holds the version it loaded with, which
    // is what makes the next save a genuine mid-air collision.
    const other = await request.patch(`${baseURL}/scim/admin/endpoints/${endpointId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { displayName: 'changed by someone else' },
    });
    expect(other.ok()).toBeTruthy();

    await page.getByTestId('resource-types-create-button').click();
    await page.getByTestId('resource-types-create-name').fill('Device');
    await page.getByTestId('resource-types-create-endpoint').fill('/Devices');
    await page.getByTestId('resource-types-create-schema').fill('urn:ietf:params:scim:schemas:custom:Device');
    await page.getByTestId('resource-types-create-dialog-submit').click();

    await expect(page.getByTestId('conflict-dialog')).toBeVisible();
    await expect(page.getByTestId('conflict-refresh')).toBeVisible();
  });

  test('C-P2: force-overwrite applies the operator edit and the type appears', async ({ page, request, baseURL }) => {
    await page.goto(`/endpoints/${endpointId}/resource-types`);
    await expect(page.getByTestId('resource-types-tab')).toBeVisible();

    await request.patch(`${baseURL}/scim/admin/endpoints/${endpointId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { displayName: 'changed by someone else' },
    });

    await page.getByTestId('resource-types-create-button').click();
    await page.getByTestId('resource-types-create-name').fill('Device');
    await page.getByTestId('resource-types-create-endpoint').fill('/Devices');
    await page.getByTestId('resource-types-create-schema').fill('urn:ietf:params:scim:schemas:custom:Device');
    await page.getByTestId('resource-types-create-dialog-submit').click();
    await expect(page.getByTestId('conflict-dialog')).toBeVisible();

    await page.getByTestId('conflict-force-overwrite').click();
    await expect(page.getByTestId('conflict-dialog')).toBeHidden();

    // The outcome, not the dialog: the operator's type must actually exist on
    // the server, or the conflict flow just lost their work more politely.
    // Polled because the retry is asynchronous - a single read races it.
    await expect(page.getByText('Device', { exact: false }).first()).toBeVisible();
    await expect.poll(async () => {
      const after = await request.get(`${baseURL}/scim/admin/endpoints/${endpointId}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      return (await after.json()).profile.resourceTypes.map((r: { name: string }) => r.name);
    }, { timeout: 15_000 }).toContain('Device');
  });

  test('C-P3: with no competing edit the save still succeeds', async ({ page, request, baseURL }) => {
    // The UI applies an optimistic cache update, so the new type appears on
    // screen before the server has answered. That made an earlier version of
    // this test report "Printer missing" with no clue why; capture the real
    // response so a failure names the status instead of implying it.
    const writes: string[] = [];
    page.on('response', async (r) => {
      if (r.request().method() === 'PATCH' && r.url().includes('/admin/endpoints/')) {
        writes.push(`${r.status()} ${await r.text().catch(() => '')}`.slice(0, 300));
      }
    });

    await page.goto(`/endpoints/${endpointId}/resource-types`);
    await expect(page.getByTestId('resource-types-tab')).toBeVisible();

    await page.getByTestId('resource-types-create-button').click();
    await page.getByTestId('resource-types-create-name').fill('Printer');
    await page.getByTestId('resource-types-create-endpoint').fill('/Printers');
    await page.getByTestId('resource-types-create-schema').fill('urn:ietf:params:scim:schemas:custom:Printer');
    await page.getByTestId('resource-types-create-dialog-submit').click();

    // Wait for the WRITE, not the optimistic paint.
    await expect.poll(() => writes.length, { timeout: 15_000 }).toBeGreaterThan(0);

    // The check must be invisible in the normal case; a version guard that
    // trips on ordinary edits would be worse than the bug it prevents.
    await expect(page.getByTestId('conflict-dialog')).toBeHidden();
    await expect.poll(async () => {
      const after = await request.get(`${baseURL}/scim/admin/endpoints/${endpointId}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      return (await after.json()).profile.resourceTypes.map((r: { name: string }) => r.name);
    }, { timeout: 15_000, message: () => `PATCH responses seen: ${JSON.stringify(writes)}` }).toContain('Printer');
  });
});
