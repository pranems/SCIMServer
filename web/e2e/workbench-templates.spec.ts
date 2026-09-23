import { expect, test, type Page } from '@playwright/test';
import {
  E2E_TOKEN,
  createFixtureEndpoint,
  deleteFixtureEndpoint,
  seedAuthToken,
} from './endpoint-fixture';

const DEVICE_URN = 'urn:example:schemas:Device';

let endpointId: string | null = null;
let templateEndpointId: string | null = null;

test.beforeEach(async ({ page }) => {
  await seedAuthToken(page);
});

test.afterEach(async ({ page }) => {
  templateEndpointId = await deleteFixtureEndpoint(page, templateEndpointId);
  endpointId = await deleteFixtureEndpoint(page, endpointId);
});

async function addDeviceFixture(page: Page, id: string): Promise<{ id: string; version: string }> {
  const result = await page.evaluate(
    async ({ token, fixtureId, deviceUrn }) => {
      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      const endpointResponse = await fetch(`/scim/admin/endpoints/${fixtureId}`, { headers });
      if (!endpointResponse.ok) {
        return { error: `endpoint GET failed ${endpointResponse.status}: ${await endpointResponse.text()}` };
      }
      const endpoint = await endpointResponse.json() as {
        profile?: {
          schemas?: Array<Record<string, unknown>>;
          resourceTypes?: Array<Record<string, unknown>>;
        };
      };
      const schemas = [...(endpoint.profile?.schemas ?? [])];
      const resourceTypes = [...(endpoint.profile?.resourceTypes ?? [])];
      schemas.push({
        id: deviceUrn,
        name: 'Device',
        attributes: [
          { name: 'serialNumber', type: 'string', required: true },
          { name: 'compliant', type: 'boolean' },
        ],
      });
      resourceTypes.push({
        id: 'Device',
        name: 'Device',
        endpoint: '/Devices',
        schema: deviceUrn,
        schemaExtensions: [],
      });
      const patched = await fetch(`/scim/admin/endpoints/${fixtureId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ profile: { schemas, resourceTypes } }),
      });
      if (!patched.ok) return { error: `profile PATCH failed ${patched.status}: ${await patched.text()}` };
      const created = await fetch(`/scim/endpoints/${fixtureId}/Devices`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/scim+json' },
        body: JSON.stringify({ schemas: [deviceUrn], serialNumber: 'SN-100', compliant: true }),
      });
      if (!created.ok) return { error: `Device POST failed ${created.status}: ${await created.text()}` };
      const resource = await created.json() as { id?: string; meta?: { version?: string } };
      return {
        error: null,
        id: resource.id,
        version: resource.meta?.version,
      };
    },
    { token: E2E_TOKEN, fixtureId: id, deviceUrn: DEVICE_URN },
  );
  expect(result.error, `Device fixture setup must succeed (${result.error ?? ''})`).toBeNull();
  expect(result.id).toBeTruthy();
  expect(result.version).toMatch(/^W\/"v\d+"$/u);
  return { id: result.id as string, version: result.version as string };
}

test('applies and executes static, endpoint, and profile-aware examples', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/endpoints');
  endpointId = await createFixtureEndpoint(page, {
    namePrefix: 'e2e-workbench-templates',
    profilePreset: 'rfc-standard',
  });
  const device = await addDeviceFixture(page, endpointId);

  await page.goto('/workbench');
  await expect(page.getByTestId('workbench-examples-panel')).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('workbench-example-template').selectOption('server-health');
  await page.getByTestId('workbench-example-apply').click();
  await expect(page.getByTestId('workbench-path')).toHaveValue('/scim/health');
  await page.getByTestId('workbench-send').click();
  await expect(page.getByTestId('workbench-response-status')).toHaveText('200');

  await page.getByTestId('workbench-example-template').selectOption('admin-create-endpoint');
  await page.getByTestId('workbench-example-apply').click();
  await expect(page.getByTestId('workbench-method')).toHaveValue('POST');
  await expect(page.getByTestId('workbench-path')).toHaveValue('/scim/admin/endpoints');
  await expect(page.getByTestId('workbench-body')).toContainText('profilePreset');
  await page.getByTestId('workbench-send').click();
  await expect(page.getByTestId('workbench-response-status')).toHaveText('201');
  const templateEndpointBody = JSON.parse(
    await page.getByTestId('workbench-response-body-pre').textContent() ?? '{}',
  ) as { id?: string };
  expect(templateEndpointBody.id).toBeTruthy();
  templateEndpointId = templateEndpointBody.id as string;

  await page.getByTestId('workbench-endpoint-picker').selectOption(endpointId);
  await page.getByTestId('workbench-example-template').selectOption('endpoint-update-settings');
  await page.getByTestId('workbench-example-apply').click();
  await expect(page.getByTestId('workbench-path')).toHaveValue(`/scim/admin/endpoints/${endpointId}`);
  await page.getByTestId('workbench-send').click();
  await expect(page.getByTestId('workbench-response-status')).toHaveText('200');
  const endpointSettings = await page.evaluate(
    async ({ token, fixtureId }) => {
      const response = await fetch(`/scim/admin/endpoints/${fixtureId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const endpoint = await response.json() as { profile?: { settings?: Record<string, unknown> } };
      return endpoint.profile?.settings;
    },
    { token: E2E_TOKEN, fixtureId: endpointId },
  );
  expect(endpointSettings?.StrictSchemaValidation).toBe(true);

  await page.getByTestId('workbench-example-resource-type').selectOption('Device');
  await expect(page.getByTestId('workbench-example-template')).toContainText('SCIM resource - Update Device');
  await page.getByTestId('workbench-example-template').selectOption('resource-Device-patch');
  await page.getByTestId('workbench-example-apply').click();
  await expect(page.getByTestId('workbench-method')).toHaveValue('PATCH');
  await expect(page.getByTestId('workbench-path')).toHaveValue(
    `/scim/endpoints/${endpointId}/Devices/${device.id}`,
  );
  await expect(page.getByTestId('workbench-body')).toContainText('SN-100-updated');
  await page.getByTestId('workbench-headers-toggle').click();
  await expect(page.getByTestId('workbench-header-key-2')).toHaveValue('If-Match');
  await expect(page.getByTestId('workbench-header-value-2')).toHaveValue(device.version);

  await page.getByTestId('workbench-send').click();
  await expect(page.getByTestId('workbench-response-status')).toHaveText('200');

  const persisted = await page.evaluate(
    async ({ token, fixtureId, resourceId }) => {
      const response = await fetch(`/scim/endpoints/${fixtureId}/Devices/${resourceId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.json() as Promise<{ serialNumber?: string }>;
    },
    { token: E2E_TOKEN, fixtureId: endpointId, resourceId: device.id },
  );
  expect(persisted.serialNumber).toBe('SN-100-updated');

  await page.getByTestId('workbench-send').click();
  await expect(page.getByTestId('workbench-response-status')).toHaveText('412');
  const afterStale = await page.evaluate(
    async ({ token, fixtureId, resourceId }) => {
      const response = await fetch(`/scim/endpoints/${fixtureId}/Devices/${resourceId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.json() as Promise<{ serialNumber?: string }>;
    },
    { token: E2E_TOKEN, fixtureId: endpointId, resourceId: device.id },
  );
  expect(afterStale.serialNumber).toBe('SN-100-updated');
});