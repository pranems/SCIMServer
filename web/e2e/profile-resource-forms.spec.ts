import { expect, test, type Page } from '@playwright/test';
import {
  E2E_TOKEN,
  createFixtureEndpoint,
  deleteFixtureEndpoint,
  seedAuthToken,
} from './endpoint-fixture';

const ENTERPRISE_URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';
const DEVICE_URN = 'urn:example:schemas:Device';

let endpointId: string | null = null;

test.beforeEach(async ({ page }) => {
  await seedAuthToken(page);
});

test.afterEach(async ({ page }) => {
  endpointId = await deleteFixtureEndpoint(page, endpointId);
});

async function addProfileResources(page: Page, id: string): Promise<void> {
  const error = await page.evaluate(
    async ({ token, endpointId: fixtureId, enterpriseUrn, deviceUrn }) => {
      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      const response = await fetch(`/scim/admin/endpoints/${fixtureId}`, { headers });
      if (!response.ok) return `GET failed ${response.status}: ${await response.text()}`;
      const endpoint = await response.json() as {
        profile?: {
          schemas?: Array<Record<string, unknown>>;
          resourceTypes?: Array<Record<string, unknown>>;
        };
      };
      const schemas = [...(endpoint.profile?.schemas ?? [])];
      const resourceTypes = [...(endpoint.profile?.resourceTypes ?? [])];
      if (!schemas.some((schema) => schema.id === enterpriseUrn)) {
        schemas.push({
          id: enterpriseUrn,
          name: 'EnterpriseUser',
          attributes: [{ name: 'employeeNumber', type: 'string' }],
        });
      }
      if (!schemas.some((schema) => schema.id === deviceUrn)) {
        schemas.push({
          id: deviceUrn,
          name: 'Device',
          attributes: [
            { name: 'serialNumber', type: 'string', required: true },
            { name: 'compliant', type: 'boolean' },
          ],
        });
      }
      const userType = resourceTypes.find((resourceType) => resourceType.name === 'User');
      if (userType) {
        const extensions = Array.isArray(userType.schemaExtensions)
          ? [...userType.schemaExtensions as Array<Record<string, unknown>>]
          : [];
        if (!extensions.some((extension) => extension.schema === enterpriseUrn)) {
          extensions.push({ schema: enterpriseUrn, required: false });
        }
        userType.schemaExtensions = extensions;
      }
      if (!resourceTypes.some((resourceType) => resourceType.name === 'Device')) {
        resourceTypes.push({
          id: 'Device',
          name: 'Device',
          endpoint: '/Devices',
          schema: deviceUrn,
          schemaExtensions: [],
        });
      }
      const patched = await fetch(`/scim/admin/endpoints/${fixtureId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ profile: { schemas, resourceTypes } }),
      });
      return patched.ok ? null : `PATCH failed ${patched.status}: ${await patched.text()}`;
    },
    {
      token: E2E_TOKEN,
      endpointId: id,
      enterpriseUrn: ENTERPRISE_URN,
      deviceUrn: DEVICE_URN,
    },
  );
  expect(error, `fixture profile update must succeed (${error ?? ''})`).toBeNull();
}

test('creates and edits built-in extension and custom ResourceType fields', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/endpoints');
  endpointId = await createFixtureEndpoint(page, {
    namePrefix: 'e2e-profile-forms',
    profilePreset: 'rfc-standard',
  });
  await addProfileResources(page, endpointId);

  const userName = `profile-form-${Date.now()}@example.com`;
  await page.goto(`/endpoints/${endpointId}/users`);
  await expect(page.getByTestId('users-empty-action')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('users-empty-action').click();
  await page.getByTestId('create-resource-form-userName-input').fill(userName);
  await page.getByTestId('create-resource-form-employeeNumber-input').fill('EMP-100');
  const userRefresh = page.waitForResponse((response) =>
    response.request().method() === 'GET' &&
    response.url().includes(`/scim/endpoints/${endpointId}/Users?`) &&
    response.ok());
  await page.getByTestId('create-resource-dialog-submit').click();
  await userRefresh;

  const userRow = page.locator('[data-testid^="user-row-"]').filter({ hasText: userName });
  await expect(userRow).toBeVisible();
  await userRow.click();
  await expect(page.getByTestId('drawer-profile-form-employeeNumber-input')).toHaveValue('EMP-100');
  await page.getByTestId('drawer-profile-form-employeeNumber-input').fill('EMP-200');
  const updatedUserRefresh = page.waitForResponse((response) =>
    response.request().method() === 'GET' &&
    response.url().includes(`/scim/endpoints/${endpointId}/Users?`) &&
    response.ok());
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await updatedUserRefresh;
  await userRow.click();
  await expect(page.getByTestId('drawer-profile-form-employeeNumber-input')).toHaveValue('EMP-200');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.goto(`/endpoints/${endpointId}`);
  const deviceTab = page.getByTestId('endpoint-tab-resource-Device');
  await expect(deviceTab).toBeVisible();
  await deviceTab.click();
  await expect(page).toHaveURL(new RegExp(`/endpoints/${endpointId}/resources/Device$`));
  await page.getByTestId('custom-resources-create').click();
  await page.getByTestId('create-resource-form-serialNumber-input').fill('SN-100');
  const deviceRefresh = page.waitForResponse((response) =>
    response.request().method() === 'GET' &&
    response.url().includes(`/scim/endpoints/${endpointId}/Devices?`) &&
    response.ok());
  await page.getByTestId('create-resource-dialog-submit').click();
  await deviceRefresh;

  const deviceRow = page.locator('[data-testid^="custom-resource-row-"]').filter({ hasText: 'SN-100' });
  await expect(deviceRow).toBeVisible();
  await deviceRow.click();
  await page.getByTestId('drawer-profile-form-serialNumber-input').fill('SN-200');
  const updatedDeviceRefresh = page.waitForResponse((response) =>
    response.request().method() === 'GET' &&
    response.url().includes(`/scim/endpoints/${endpointId}/Devices?`) &&
    response.ok());
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await updatedDeviceRefresh;
  const updatedDeviceRow = page.locator('[data-testid^="custom-resource-row-"]').filter({ hasText: 'SN-200' });
  await expect(updatedDeviceRow).toBeVisible();
  await updatedDeviceRow.click();
  const drawerFooter = page.getByTestId('resource-detail-drawer-footer');
  await drawerFooter.getByRole('button', { name: 'Delete', exact: true }).click();
  const deletedDeviceRefresh = page.waitForResponse((response) =>
    response.request().method() === 'GET' &&
    response.url().includes(`/scim/endpoints/${endpointId}/Devices?`) &&
    response.ok());
  await drawerFooter.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await deletedDeviceRefresh;
  await expect(updatedDeviceRow).toHaveCount(0);
  await expect(page.getByTestId('custom-resources-empty')).toBeVisible();
});