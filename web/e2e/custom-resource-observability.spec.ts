import { expect, test, type Page } from '@playwright/test';
import {
  E2E_TOKEN,
  createFixtureEndpoint,
  deleteFixtureEndpoint,
  seedAuthToken,
} from './endpoint-fixture';

const DEVICE_URN = 'urn:example:schemas:Device';
let endpointId: string | null = null;

test.beforeEach(async ({ page }) => {
  await seedAuthToken(page);
});

test.afterEach(async ({ page }) => {
  endpointId = await deleteFixtureEndpoint(page, endpointId);
});

async function createDeviceLifecycle(page: Page, fixtureId: string): Promise<void> {
  const error = await page.evaluate(async ({ token, id, urn }) => {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const endpointResponse = await fetch(`/scim/admin/endpoints/${id}`, { headers });
    if (!endpointResponse.ok) return `endpoint GET ${endpointResponse.status}`;
    const endpoint = await endpointResponse.json() as {
      profile?: { schemas?: Array<Record<string, unknown>>; resourceTypes?: Array<Record<string, unknown>> };
    };
    const schemas = [...(endpoint.profile?.schemas ?? []), {
      id: urn,
      name: 'Device',
      attributes: [
        { name: 'serialNumber', type: 'string', required: true },
        { name: 'displayName', type: 'string' },
      ],
    }];
    const resourceTypes = [...(endpoint.profile?.resourceTypes ?? []), {
      id: 'Device', name: 'Device', endpoint: '/Devices', schema: urn, schemaExtensions: [],
    }];
    const profileResponse = await fetch(`/scim/admin/endpoints/${id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ profile: { schemas, resourceTypes } }),
    });
    if (!profileResponse.ok) return `profile PATCH ${profileResponse.status}: ${await profileResponse.text()}`;

    const created = await fetch(`/scim/endpoints/${id}/Devices`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/scim+json' },
      body: JSON.stringify({ schemas: [urn], serialNumber: 'OBS-100', displayName: 'Observed Device' }),
    });
    if (!created.ok) return `Device POST ${created.status}: ${await created.text()}`;
    const resource = await created.json() as { id?: string; meta?: { version?: string } };
    if (!resource.id) return 'Device POST returned no id';

    const patched = await fetch(`/scim/endpoints/${id}/Devices/${resource.id}`, {
      method: 'PATCH',
      headers: {
        ...headers,
        'Content-Type': 'application/scim+json',
        ...(resource.meta?.version ? { 'If-Match': resource.meta.version } : {}),
      },
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'displayName', value: 'Updated Device' }],
      }),
    });
    if (!patched.ok) return `Device PATCH ${patched.status}: ${await patched.text()}`;
    const updated = await patched.json() as { meta?: { version?: string } };

    const deleted = await fetch(`/scim/endpoints/${id}/Devices/${resource.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(updated.meta?.version ? { 'If-Match': updated.meta.version } : {}),
      },
    });
    return deleted.ok ? null : `Device DELETE ${deleted.status}: ${await deleted.text()}`;
  }, { token: E2E_TOKEN, id: fixtureId, urn: DEVICE_URN });
  expect(error).toBeNull();
}

test('custom ResourceType lifecycle appears in Activity and shared Logs filters', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/endpoints');
  endpointId = await createFixtureEndpoint(page, {
    namePrefix: 'e2e-resource-observability',
    profilePreset: 'rfc-standard',
  });
  await createDeviceLifecycle(page, endpointId);

  await expect.poll(async () => page.evaluate(async ({ token, id }) => {
    const response = await fetch(`/scim/admin/activity?endpointId=${id}&type=resource&search=Devices&limit=100`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return [];
    const body = await response.json() as { activities?: Array<{ resourceType?: string }> };
    return body.activities?.map((activity) => activity.resourceType) ?? [];
  }, { token: E2E_TOKEN, id: endpointId }), { timeout: 30_000 }).toContain('Device');

  await expect.poll(async () => page.evaluate(async ({ token, id }) => {
    const headers = { Authorization: `Bearer ${token}` };
    await fetch('/scim/admin/logs/flush', { method: 'POST', headers });
    const response = await fetch(
      `/scim/admin/logs?endpointId=${id}&urlContains=Devices&method=PATCH&status=200&pageSize=100`,
      { headers },
    );
    if (!response.ok) return false;
    const body = await response.json() as { items?: Array<{ method?: string; url?: string; status?: number }> };
    return (body.items ?? []).some((row) =>
      row.method === 'PATCH' && row.status === 200 && row.url?.includes('/Devices/'),
    );
  }, { token: E2E_TOKEN, id: endpointId }), { timeout: 30_000 }).toBe(true);

  await page.goto(`/endpoints/${endpointId}/activity?type=resource&search=Devices&page=1`);
  await expect(page.getByTestId('activity-list')).toContainText('Device');
  await expect(page.getByTestId('activity-filter-type')).toContainText('resource');

  await page.goto(`/endpoints/${endpointId}/logs?urlContains=Devices&method=PATCH&status=200&page=1`);
  await expect(page.getByTestId('logs-tab')).toContainText('/Devices/');
  await expect(page.getByTestId('logs-tab-filters-method')).toHaveValue('PATCH');

  await page.goto(`/logs?endpointId=${endpointId}&urlContains=Devices&method=PATCH&status=200&page=1`);
  await expect(page.getByTestId('global-logs-page')).toContainText('/Devices/');
  await expect(page.getByTestId('logs-toolbar-method')).toHaveValue('PATCH');
  await expect(page.getByRole('button', { name: 'Reset filters' })).toHaveCount(1);
  const authChipFits = await page.locator('[data-testid^="log-row-auth-"]').first().evaluate((chip) => {
    const cell = chip.closest('td');
    const chipBounds = chip.getBoundingClientRect();
    const cellBounds = cell?.getBoundingClientRect();
    return chip.scrollHeight <= chip.clientHeight &&
      (!cellBounds || chipBounds.right <= cellBounds.right);
  });
  expect(authChipFits).toBe(true);
});
