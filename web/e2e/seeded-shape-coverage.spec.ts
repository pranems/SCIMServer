import { expect, test, type Page } from '@playwright/test';
import { E2E_TOKEN, seedAuthToken } from './endpoint-fixture';

interface ShapeEndpoint {
  id: string;
  name: string;
  displayName?: string;
  profile: {
    settings?: Record<string, unknown>;
    schemas: Array<{ id: string; attributes: Array<{ name: string }> }>;
    resourceTypes: Array<{
      name: string;
      endpoint: string;
      schemaExtensions?: Array<{ schema: string; required?: boolean }>;
    }>;
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
let ownedShape: ShapeEndpoint | undefined;
let sourceShape: ShapeEndpoint | undefined;
let sourceState: Record<string, unknown> | undefined;
let originalEndpointIds: string[] = [];
let ownedBearerToken: string | undefined;

async function readShapeState(page: Page, endpoint: ShapeEndpoint): Promise<Record<string, unknown>> {
  const state: Record<string, unknown> = {};
  for (const path of [
    `/scim/admin/endpoints/${endpoint.id}`,
    ...endpoint.profile.resourceTypes.map((type) => `/scim/endpoints/${endpoint.id}${type.endpoint}`),
  ]) {
    const response = await page.request.get(path, { headers });
    expect(response.status(), `Original fixture read ${path}`).toBe(200);
    state[path] = await response.json();
  }
  return state;
}

test.describe('seeded six-profile outcome matrix', () => {
  test.skip(
    process.env.E2E_SHAPE_COVERAGE !== '1',
    'Opt-in: set E2E_SHAPE_COVERAGE=1 to test owned copies of the six seeded profiles.',
  );

  test.beforeEach(async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await seedAuthToken(page);
    ownedShape = undefined;
    sourceShape = undefined;
    sourceState = undefined;
    ownedBearerToken = undefined;
    const name = shapeNames.find((candidate) => testInfo.title.startsWith(`${candidate}:`))
      ?? (testInfo.title.startsWith('strict Group') ? 'shape-rfc-strict' : 'shape-custom-resource');
    const inventory = await page.request.get('/scim/admin/endpoints', { headers });
    expect(inventory.status()).toBe(200);
    const { endpoints } = await inventory.json() as { endpoints: ShapeEndpoint[] };
    originalEndpointIds = endpoints.map((endpoint) => endpoint.id);
    const template = endpoints.find((endpoint) => endpoint.name === name);
    if (!template) throw new Error(`Missing seeded profile template ${name}`);
    const detail = await page.request.get(`/scim/admin/endpoints/${template.id}`, { headers });
    expect(detail.status()).toBe(200);
    sourceShape = await detail.json() as ShapeEndpoint;
    sourceState = await readShapeState(page, sourceShape);
    const created = await page.request.post('/scim/admin/endpoints', {
      headers,
      data: {
        name: `e2e-owned-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        profile: sourceShape.profile,
      },
    });
    expect(created.status()).toBe(201);
    ownedShape = await created.json() as ShapeEndpoint;
    expect(originalEndpointIds, 'Every test must use a newly owned endpoint').not.toContain(ownedShape.id);
    expect(ownedShape.profile).toEqual(sourceShape.profile);

    const coreUser = 'urn:ietf:params:scim:schemas:core:2.0:User';
    const hrExtension = 'urn:scimserver:devshapes:user:hr-extras:1.0';
    const userType = sourceShape.profile.resourceTypes.find((type) => type.name === 'User');
    const coreSchema = sourceShape.profile.schemas.find(({ id }) => id === coreUser);
    if (!coreSchema) throw new Error('Owned shape must publish a core User schema');
    const attributes = new Set(coreSchema.attributes.map(({ name }) => name));
    const users: Array<{ id: string }> = [];
    for (const [index, userName] of [
      'u1.minimal@shape.dev', 'u2.rich@shape.dev', 'u3.edge@shape.dev',
    ].entries()) {
      const extensions = (userType?.schemaExtensions ?? []).filter(({ schema, required }) =>
        (required ?? false) || (index === 1 && schema === hrExtension));
      const extensionBodies: Record<string, unknown> = {};
      for (const { schema } of extensions) {
        const definition = sourceShape.profile.schemas.find(({ id }) => id === schema);
        if (!definition) throw new Error(`Owned shape extension ${schema} must be published`);
        const values: Record<string, string> = {
          employeeNumber: `E-OWNED-${index}`, costCenter: 'CC-DEV', department: 'E2E',
        };
        const body = Object.fromEntries(definition.attributes
          .filter(({ name }) => name in values).map(({ name }) => [name, values[name]]));
        if (Object.keys(body).length === 0) throw new Error(`No supported fixture attributes for extension ${schema}`);
        extensionBodies[schema] = body;
      }
      const values: Record<string, unknown> = {
        userName, displayName: userName,
        emails: [{ value: userName, type: 'work', primary: true }], active: index !== 2,
      };
      const response = await page.request.post(`/scim/endpoints/${ownedShape.id}/Users`, {
        headers: { ...headers, 'Content-Type': 'application/scim+json' },
        data: {
          schemas: [coreUser, ...extensions.map(({ schema }) => schema)],
          ...Object.fromEntries(Object.entries(values).filter(([key]) => attributes.has(key))),
          ...extensionBodies,
        },
      });
      expect(response.status(), `Owned user ${userName} must be created: ${await response.text()}`).toBe(201);
      users.push(await response.json() as { id: string });
    }
    if (sourceShape.profile.resourceTypes.some((type) => type.name === 'Group')) {
      for (const [displayName, members] of [
        ['g1.multi', users.slice(0, 2)], ['g2.solo', users.slice(2)],
      ] as const) {
        const response = await page.request.post(`/scim/endpoints/${ownedShape.id}/Groups`, {
          headers: { ...headers, 'Content-Type': 'application/scim+json' },
          data: {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
            displayName,
            members: members.map(({ id }) => ({ value: id })),
          },
        });
        expect(response.status(), `Owned group ${displayName} must be created`).toBe(201);
      }
    }
    if (name === 'shape-per-endpoint-creds') {
      const response = await page.request.post(`/scim/admin/endpoints/${ownedShape.id}/credentials`, {
        headers, data: { credentialType: 'bearer', label: 'owned shape credential' },
      });
      expect(response.status()).toBe(201);
      const credential = await response.json() as { token: string };
      expect(typeof credential.token).toBe('string');
      ownedBearerToken = credential.token;
    }
  });

  test.afterEach(async ({ page }) => {
    try {
      if (ownedShape) {
        const cleanup = await page.request.delete(`/scim/admin/endpoints/${ownedShape.id}`, { headers });
        expect([204, 404], 'Owned endpoint cleanup must succeed even before browser navigation')
          .toContain(cleanup.status());
        const inventory = await page.request.get('/scim/admin/endpoints', { headers });
        expect(inventory.status()).toBe(200);
        const { endpoints } = await inventory.json() as { endpoints: ShapeEndpoint[] };
        expect(endpoints.map(({ id }) => id), 'Owned endpoint must be absent after cleanup')
          .not.toContain(ownedShape.id);
      }
    } finally {
      if (sourceShape && sourceState) {
        expect(await readShapeState(page, sourceShape),
          'Original profile, resources, versions and membership output must remain unchanged').toEqual(sourceState);
      }
      ownedShape = undefined;
      ownedBearerToken = undefined;
    }
  });

  test('owned fixture cleanup works before initial browser navigation', async ({ page }) => {
    expect(page.url()).toBe('about:blank');
    expect(ownedShape).toBeDefined();
    expect(originalEndpointIds).not.toContain(ownedShape?.id);
  });

  for (const name of shapeNames) {
    test(`${name}: persisted rows, resource support, schemas and settings`, async ({ page }) => {
      test.setTimeout(120_000);
      const shape = ownedShape;
      if (!shape) throw new Error(`Missing owned endpoint ${name}`);
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
          headers: { Authorization: ['Bearer', ownedBearerToken].join(' ') },
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
    const shape = ownedShape;
    if (!shape) throw new Error('Missing owned custom extension endpoint');
    expect(originalEndpointIds, 'Mutating tests must use a newly owned endpoint')
      .not.toContain(shape.id);
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
    const shape = ownedShape;
    if (!shape) throw new Error('Missing owned strict endpoint');
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
    const shape = ownedShape;
    if (!shape) throw new Error('Missing owned custom resource endpoint');
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
