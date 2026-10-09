import { expect, test } from '@playwright/test';
import { E2E_TOKEN, seedAuthToken } from './endpoint-fixture';

interface ShapeEndpoint {
  id: string;
  name: string;
  displayName?: string;
  profile: {
    settings?: Record<string, unknown>;
    schemas: Array<{ id: string }>;
    resourceTypes: Array<{ name: string; endpoint: string }>;
  };
}

const headers = { Authorization: ['Bearer', E2E_TOKEN].join(' ') };
const shapeNames = [
  'shape-rfc-strict',
  'shape-entra-lenient',
  'shape-custom-ext-user',
  'shape-soft-delete-only',
  'shape-per-endpoint-creds',
  'shape-custom-resource',
];

test.describe('seeded six-profile outcome matrix', () => {
  test.skip(
    process.env.E2E_SHAPE_COVERAGE !== '1',
    'Opt-in: run seed-shape-coverage on an owned estate, then set E2E_SHAPE_COVERAGE=1.',
  );

  test.beforeEach(async ({ page }) => {
    await seedAuthToken(page);
  });

  for (const name of shapeNames) {
    test(`${name}: persisted rows, resource support, schemas and settings`, async ({ page }) => {
      test.setTimeout(120_000);
      const inventory = await page.request.get('/scim/admin/endpoints', { headers });
      expect(inventory.status()).toBe(200);
      const { endpoints } = await inventory.json() as { endpoints: ShapeEndpoint[] };
      const shape = endpoints.find((endpoint) => endpoint.name === name);
      expect(shape, `Seeded endpoint ${name} must exist`).toBeDefined();
      if (!shape) throw new Error(`Missing seeded endpoint ${name}`);
      const detail = await page.request.get(`/scim/admin/endpoints/${shape.id}`, { headers });
      expect(detail.status()).toBe(200);
      const endpoint = await detail.json() as ShapeEndpoint;
      const base = `/scim/endpoints/${shape.id}`;

      const users = await page.request.get(`${base}/Users`, { headers });
      expect(users.status()).toBe(200);
      const userList = await users.json() as {
        Resources: Array<{ id: string; userName: string; active: boolean }>;
      };
      expect(userList.Resources.map((user) => user.userName).sort()).toEqual([
        'u1.minimal@shape.dev', 'u2.rich@shape.dev', 'u3.edge@shape.dev',
      ]);
      expect(userList.Resources.find((user) => user.userName === 'u3.edge@shape.dev')?.active)
        .toBe(false);

      await page.goto(`/endpoints/${shape.id}/users`);
      await expect(page.getByTestId('endpoint-detail-page'))
        .toContainText(endpoint.displayName ?? endpoint.name);
      for (const user of userList.Resources) {
        await expect(page.getByTestId(`user-row-${user.id}`)).toContainText(user.userName);
      }

      const supportsGroups = endpoint.profile.resourceTypes.some((type) => type.name === 'Group');
      if (supportsGroups) {
        const groups = await page.request.get(`${base}/Groups`, { headers });
        expect(groups.status()).toBe(200);
        const groupList = await groups.json() as {
          Resources: Array<{ id: string; displayName: string; members?: Array<{ value: string }> }>;
        };
        expect(groupList.Resources).toHaveLength(2);
        expect(groupList.Resources.reduce((count, group) => count + (group.members?.length ?? 0), 0))
          .toBe(3);
        await page.getByTestId('endpoint-tab-groups').click();
        for (const group of groupList.Resources) {
          await expect(page.getByTestId(`group-row-${group.id}`)).toContainText(group.displayName);
        }
      } else {
        await expect(page.getByTestId('endpoint-tab-groups')).toHaveCount(0);
        await page.goto(`/endpoints/${shape.id}/groups`);
        await expect(page).toHaveURL(new RegExp(`/endpoints/${shape.id}/resource-types$`));
      }

      await page.goto(`/endpoints/${shape.id}/schemas`);
      for (const schema of endpoint.profile.schemas) {
        await expect(page.getByTestId(`schema-row-${schema.id}`)).toContainText(schema.id);
      }

      await page.goto(`/endpoints/${shape.id}/settings`);
      for (const [key, value] of Object.entries(endpoint.profile.settings ?? {})) {
        if (typeof value === 'boolean') {
          await expect(page.getByTestId(`settings-flag-${key}`)).toBeChecked({ checked: value });
        }
      }
      await expect(page.getByText('Something went wrong')).toHaveCount(0);

      if (name === 'shape-per-endpoint-creds') {
        const credentialUsers = await page.request.get(`${base}/Users`, {
          headers: { Authorization: ['Bearer', 'shape-dev-secret'].join(' ') },
        });
        expect(credentialUsers.status()).toBe(200);
        const credentialList = await credentialUsers.json() as { totalResults: number };
        expect(credentialList.totalResults).toBe(3);
        const rejected = await page.request.get(`${base}/Users`, {
          headers: { Authorization: ['Bearer', 'invalid-shape-credential'].join(' ') },
        });
        expect(rejected.status()).toBe(401);
      }
    });
  }

  test('custom HR extension edits round-trip through the browser and independent GET', async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(process.env.E2E_ALLOW_MUTATIONS !== '1', 'Requires an explicitly mutation-enabled estate.');
    const inventory = await page.request.get('/scim/admin/endpoints', { headers });
    expect(inventory.status()).toBe(200);
    const { endpoints } = await inventory.json() as { endpoints: ShapeEndpoint[] };
    const shape = endpoints.find((endpoint) => endpoint.name === 'shape-custom-resource');
    expect(shape).toBeDefined();
    if (!shape) throw new Error('Missing seeded custom extension endpoint');
    const urn = 'urn:scimserver:devshapes:user:hr-extras:1.0';
    const users = await page.request.get(`/scim/endpoints/${shape.id}/Users`, { headers });
    expect(users.status()).toBe(200);
    const body = await users.json() as {
      Resources: Array<{ id: string; userName: string } & Record<string, unknown>>;
    };
    const richUser = body.Resources.find((user) => user.userName === 'u2.rich@shape.dev');
    expect(richUser).toBeDefined();
    if (!richUser) throw new Error('Missing rich extension user');
    const extension = richUser[urn];
    if (!extension || typeof extension !== 'object' || !('employeeNumber' in extension)) {
      throw new Error('Seeded HR employeeNumber must exist');
    }
    const original = extension.employeeNumber;
    expect(typeof original).toBe('string');
    const changed = `E-BROWSER-${Date.now()}`;
    try {
      await page.goto(`/endpoints/${shape.id}/users`);
      await page.getByTestId(`user-row-${richUser.id}`).click();
      const field = page.getByTestId('drawer-profile-form')
        .locator(`[data-profile-field-id="${urn}|employeeNumber"]`)
        .getByTestId('drawer-profile-form-employeeNumber-input');
      await expect(field).toHaveValue(String(original));
      await field.fill(changed);
      const updatedResponse = page.waitForResponse((response) =>
        ['PUT', 'PATCH'].includes(response.request().method()) &&
        response.url().endsWith(`/Users/${richUser.id}`));
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      expect((await updatedResponse).status()).toBe(200);
      await expect(page.getByTestId('resource-detail-drawer-footer')).toHaveCount(0);
      const persisted = await page.request.get(
        `/scim/endpoints/${shape.id}/Users/${richUser.id}`, { headers },
      );
      expect(persisted.status()).toBe(200);
      expect(await persisted.json()).toMatchObject({ [urn]: { employeeNumber: changed } });
      await page.getByTestId(`user-row-${richUser.id}`).click();
      await expect(field).toHaveValue(changed);
    } finally {
      const restored = await page.request.patch(
        `/scim/endpoints/${shape.id}/Users/${richUser.id}`,
        {
          headers: { ...headers, 'Content-Type': 'application/scim+json' },
          data: {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            Operations: [{ op: 'replace', path: `${urn}:employeeNumber`, value: original }],
          },
        },
      );
      expect(restored.status()).toBe(200);
      const verified = await page.request.get(
        `/scim/endpoints/${shape.id}/Users/${richUser.id}`, { headers },
      );
      expect(verified.status()).toBe(200);
      expect(await verified.json()).toMatchObject({ [urn]: { employeeNumber: original } });
    }
  });

  test('strict Group edits reopen with refreshed values and restore with a current ETag', async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(process.env.E2E_ALLOW_MUTATIONS !== '1', 'Requires an explicitly mutation-enabled estate.');
    const inventory = await page.request.get('/scim/admin/endpoints', { headers });
    expect(inventory.status()).toBe(200);
    const { endpoints } = await inventory.json() as { endpoints: ShapeEndpoint[] };
    const shape = endpoints.find((endpoint) => endpoint.name === 'shape-rfc-strict');
    if (!shape) throw new Error('Missing seeded strict endpoint');
    const groups = await page.request.get(`/scim/endpoints/${shape.id}/Groups`, { headers });
    expect(groups.status()).toBe(200);
    const body = await groups.json() as {
      Resources: Array<{ id: string; displayName: string; members?: Array<{ value: string }> }>;
    };
    const group = body.Resources.find((candidate) => candidate.members?.length === 2);
    if (!group) throw new Error('Missing seeded multi-member group');
    const changed = `Browser-group-${Date.now()}`;
    try {
      await page.goto(`/endpoints/${shape.id}/groups`);
      await page.getByTestId(`group-row-${group.id}`).click();
      const field = page.getByTestId('drawer-profile-form-displayName-input');
      await expect(field).toHaveValue(group.displayName);
      await field.fill(changed);
      const updatedResponse = page.waitForResponse((response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith(`/Groups/${group.id}`));
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      expect((await updatedResponse).status()).toBe(200);
      await expect(page.getByTestId('resource-detail-drawer-footer')).toHaveCount(0);
      const row = page.getByTestId(`group-row-${group.id}`);
      await expect(row).toContainText(changed);
      await row.click();
      await expect(field).toHaveValue(changed);
      const persisted = await page.request.get(
        `/scim/endpoints/${shape.id}/Groups/${group.id}`, { headers },
      );
      expect(persisted.status()).toBe(200);
      expect(await persisted.json()).toMatchObject({ displayName: changed });
    } finally {
      const current = await page.request.get(
        `/scim/endpoints/${shape.id}/Groups/${group.id}`, { headers },
      );
      expect(current.status()).toBe(200);
      const etag = current.headers().etag;
      if (!etag) throw new Error('Strict Group restore requires a current ETag');
      const restored = await page.request.patch(
        `/scim/endpoints/${shape.id}/Groups/${group.id}`,
        {
          headers: { ...headers, 'Content-Type': 'application/scim+json', 'If-Match': etag },
          data: {
            schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            Operations: [{ op: 'replace', path: 'displayName', value: group.displayName }],
          },
        },
      );
      expect(restored.status()).toBe(200);
      expect(await restored.json()).toMatchObject({ displayName: group.displayName });
    }
  });

  test('custom Device browser CRUD preserves immutable serial and persisted model', async ({ page }) => {
    test.setTimeout(120_000);
    test.skip(process.env.E2E_ALLOW_MUTATIONS !== '1', 'Requires an explicitly mutation-enabled estate.');
    const inventory = await page.request.get('/scim/admin/endpoints', { headers });
    expect(inventory.status()).toBe(200);
    const { endpoints } = await inventory.json() as { endpoints: ShapeEndpoint[] };
    const shape = endpoints.find((endpoint) => endpoint.name === 'shape-custom-resource');
    expect(shape).toBeDefined();
    if (!shape) throw new Error('Missing seeded custom resource endpoint');
    const serial = `SHAPE-BROWSER-${Date.now()}`;
    let resourceId: string | undefined;
    try {
      await page.goto(`/endpoints/${shape.id}/resources/Device`);
      await page.getByTestId('custom-resources-create').click();
      await page.getByTestId('create-resource-form-serialNumber-input').fill(serial);
      await page.getByTestId('create-resource-form-model-input').fill('Browser-created model');
      const createdResponse = page.waitForResponse((response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/scim/endpoints/${shape.id}/Devices`));
      await page.getByTestId('create-resource-dialog-submit').click();
      const created = await createdResponse;
      expect(created.status()).toBe(201);
      const resource = await created.json() as { id: string; serialNumber: string; model: string };
      resourceId = resource.id;
      expect(resource.serialNumber).toBe(serial);
      expect(resource.model).toBe('Browser-created model');
      const row = page.getByTestId(`custom-resource-row-${resourceId}`);
      await expect(row).toContainText(serial);
      await row.click();
      await expect(page.getByTestId('drawer-profile-form-serialNumber-input')).toHaveValue(serial);
      await page.getByTestId('drawer-profile-form-model-input').fill('Browser-updated model');
      const updatedResponse = page.waitForResponse((response) =>
        ['PATCH', 'PUT'].includes(response.request().method()) &&
        response.url().endsWith(`/Devices/${resourceId}`));
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      expect((await updatedResponse).status()).toBe(200);
      await expect(page.getByTestId('resource-detail-drawer-footer')).toHaveCount(0);
      const persisted = await page.request.get(
        `/scim/endpoints/${shape.id}/Devices/${resourceId}`, { headers },
      );
      expect(persisted.status()).toBe(200);
      expect(await persisted.json()).toMatchObject({
        serialNumber: serial, model: 'Browser-updated model',
      });
      await row.click();
      const footer = page.getByTestId('resource-detail-drawer-footer');
      await footer.getByRole('button', { name: 'Delete', exact: true }).click();
      await footer.getByRole('button', { name: 'Confirm delete', exact: true }).click();
      await expect(row).toHaveCount(0);
      const deleted = await page.request.get(
        `/scim/endpoints/${shape.id}/Devices/${resourceId}`, { headers },
      );
      expect(deleted.status()).toBe(404);
      resourceId = undefined;
    } finally {
      if (resourceId) {
        const cleanup = await page.request.delete(
          `/scim/endpoints/${shape.id}/Devices/${resourceId}`, { headers },
        );
        expect([204, 404]).toContain(cleanup.status());
      }
    }
  });
});
