import { expect, test, type Page } from '@playwright/test';
import {
  E2E_TOKEN,
  createFixtureEndpoint,
  deleteFixtureEndpoint,
  seedAuthToken,
} from './endpoint-fixture';

const DEVICE_URN = 'urn:example:schemas:Device';
const USER_URN = 'urn:ietf:params:scim:schemas:core:2.0:User';
const PATCH_URN = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const GOOGLE_URN = 'urn:ietf:params:scim:schemas:extension:google:2.0:CloudIdentityUser';
const CONTOSO_URN = 'urn:ietf:params:scim:schemas:extension:contoso:2.0:ScalarMVUser';

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
        Authorization: ['Bearer', token].join(' '),
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

async function addTypedPatchFixture(page: Page, id: string): Promise<string> {
  const result = await page.evaluate(
    async ({ token, fixtureId, userUrn, googleUrn, contosoUrn }) => {
      const headers = {
        Authorization: ['Bearer', token].join(' '),
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
      schemas.push(
        {
          id: googleUrn,
          name: 'SyntheticGoogle',
          attributes: [
            {
              name: 'primaryOrganization',
              type: 'complex',
              subAttributes: [{ name: 'location', type: 'string' }],
            },
            {
              name: 'additionalOrganizations',
              type: 'complex',
              multiValued: true,
              subAttributes: [
                { name: 'type', type: 'string' },
                { name: 'symbol', type: 'string' },
              ],
            },
          ],
        },
        {
          id: contosoUrn,
          name: 'SyntheticContoso',
          attributes: [
            {
              name: 'contacts',
              type: 'complex',
              multiValued: true,
              subAttributes: [
                { name: 'primary', type: 'boolean' },
                { name: 'value', type: 'string' },
              ],
            },
          ],
        },
      );
      const userResourceType = resourceTypes.findIndex((resourceType) => resourceType.id === 'User');
      if (userResourceType < 0) return { error: 'User ResourceType was not found' };
      resourceTypes[userResourceType] = {
        ...resourceTypes[userResourceType],
        schemaExtensions: [
          { schema: googleUrn, required: false },
          { schema: contosoUrn, required: false },
        ],
      };
      const patched = await fetch(`/scim/admin/endpoints/${fixtureId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          profile: {
            schemas,
            resourceTypes,
            settings: { StrictSchemaValidation: true, VerbosePatchSupported: true },
          },
        }),
      });
      if (!patched.ok) return { error: `profile PATCH failed ${patched.status}: ${await patched.text()}` };
      const created = await fetch(`/scim/endpoints/${fixtureId}/Users`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/scim+json' },
        body: JSON.stringify({
          schemas: [userUrn, googleUrn, contosoUrn],
          userName: `typed-patch-${Date.now()}@example.test`,
          [googleUrn]: {
            primaryOrganization: { location: 'old' },
            additionalOrganizations: [
              { type: 'school', symbol: 'old' },
              { type: 'work', symbol: 'old' },
            ],
          },
          [contosoUrn]: {
            contacts: [{ primary: true, value: 'old' }],
          },
        }),
      });
      if (!created.ok) return { error: `User POST failed ${created.status}: ${await created.text()}` };
      const resource = await created.json() as { id?: string };
      return { error: null, id: resource.id };
    },
    {
      token: E2E_TOKEN,
      fixtureId: id,
      userUrn: USER_URN,
      googleUrn: GOOGLE_URN,
      contosoUrn: CONTOSO_URN,
    },
  );
  expect(result.error, `Typed PATCH fixture setup must succeed (${result.error ?? ''})`).toBeNull();
  expect(result.id).toBeTruthy();
  return result.id as string;
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
        headers: { Authorization: ['Bearer', token].join(' ') },
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

test('applies the exact typed PATCH incident and measures returned and persisted values', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/endpoints');
  endpointId = await createFixtureEndpoint(page, {
    namePrefix: 'e2e-workbench-typed-patch',
    profilePreset: 'rfc-standard',
  });
  const userId = await addTypedPatchFixture(page, endpointId);

  await page.goto('/workbench');
  await expect(page.getByTestId('workbench-toolbar-card')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('workbench-method').selectOption('PATCH');
  await page.getByTestId('workbench-path').fill(`/scim/endpoints/${endpointId}/Users/${userId}`);
  await page.getByTestId('workbench-body').fill(JSON.stringify({
    schemas: [PATCH_URN],
    Operations: [
      { op: 'replace', path: `${GOOGLE_URN}:primaryOrganization.location`, value: 'new' },
      { op: 'replace', path: `${GOOGLE_URN}:additionalOrganizations[type eq "school"].symbol`, value: 'new' },
      { op: 'replace', path: `${GOOGLE_URN}:additionalOrganizations[type eq "work"].symbol`, value: 'new' },
      { op: 'replace', path: `${CONTOSO_URN}:contacts[primary eq true].value`, value: 'new' },
    ],
  }, null, 2));
  await page.getByTestId('workbench-send').click();
  await expect(page.getByTestId('workbench-response-status')).toHaveText('200');

  const response = JSON.parse(
    await page.getByTestId('workbench-response-body-pre').textContent() ?? '{}',
  ) as Record<string, unknown>;
  expect(response[GOOGLE_URN]).toEqual({
    primaryOrganization: { location: 'new' },
    additionalOrganizations: [
      { type: 'school', symbol: 'new' },
      { type: 'work', symbol: 'new' },
    ],
  });
  expect(response[CONTOSO_URN]).toEqual({
    contacts: [{ primary: true, value: 'new' }],
  });
  expect(Object.keys(response).some((key) => key.includes('[') || key.includes('.location'))).toBe(false);

  const persisted = await page.evaluate(
    async ({ token, fixtureId, resourceId }) => {
      const persistedResponse = await fetch(`/scim/endpoints/${fixtureId}/Users/${resourceId}`, {
        headers: { Authorization: ['Bearer', token].join(' ') },
      });
      return {
        status: persistedResponse.status,
        body: await persistedResponse.json() as Record<string, unknown>,
      };
    },
    { token: E2E_TOKEN, fixtureId: endpointId, resourceId: userId },
  );
  expect(persisted.status).toBe(200);
  expect(persisted.body[GOOGLE_URN]).toEqual(response[GOOGLE_URN]);
  expect(persisted.body[CONTOSO_URN]).toEqual(response[CONTOSO_URN]);
  expect(Object.keys(persisted.body).some((key) => key.includes('[') || key.includes('.location'))).toBe(false);
});