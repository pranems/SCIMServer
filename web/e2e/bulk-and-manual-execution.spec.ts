import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  createFixtureEndpoint,
  deleteFixtureEndpoint,
  E2E_TOKEN,
  seedAuthToken,
} from './endpoint-fixture';

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const headers = { Authorization: `Bearer ${E2E_TOKEN}`, Accept: 'application/scim+json' };
let endpointId: string | null = null;

test.beforeEach(async ({ page }) => {
  await seedAuthToken(page);
  endpointId = await createFixtureEndpoint(page, { namePrefix: 'e2e-execution' });
});

test.afterEach(async ({ page }) => {
  if (!endpointId) return;
  const ownedId = endpointId;
  endpointId = await deleteFixtureEndpoint(page, endpointId);
  const response = await page.request.get('/scim/admin/endpoints', { headers });
  expect(response.ok(), 'cleanup inventory must be readable').toBe(true);
  const body: { endpoints: Array<{ id: string }> } = await response.json();
  expect(Array.isArray(body.endpoints)).toBe(true);
  expect(body.endpoints.map((endpoint) => endpoint.id)).not.toContain(ownedId);
});

async function uploadCsv(page: Page, text: string) {
  await page.getByTestId('bulk-csv-input').setInputFiles({
    name: 'owned-execution.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(text),
  });
}

async function persistedUser(page: Page, id: string, userName: string) {
  const response = await page.request.get(`/scim/endpoints/${id}/Users`, { headers });
  expect(response.status()).toBe(200);
  const body: { Resources: Array<{ id: string; userName: string; displayName?: string }> } =
    await response.json();
  expect(Array.isArray(body.Resources)).toBe(true);
  const matches = body.Resources.filter((user) => user.userName === userName);
  expect(matches).toHaveLength(1);
  expect(matches[0].id).toMatch(/^[0-9a-f-]{36}$/i);
  return matches[0];
}

test('Bulk persists successful rows, reports a duplicate, and retries only the corrected row', async ({ page }) => {
  const id = endpointId!;
  const capability = await page.request.get(`/scim/endpoints/${id}/ServiceProviderConfig`, { headers });
  expect(capability.status()).toBe(200);
  expect((await capability.json()).bulk.supported).toBe(true);
  const first = `bulk-first-${randomUUID()}`;
  const second = `bulk-second-${randomUUID()}`;
  const corrected = `bulk-corrected-${randomUUID()}`;
  await page.goto(`/endpoints/${id}/bulk`);
  await uploadCsv(page, `userName,displayName\n${first},First\n${first},Duplicate\n${second},Second`);
  await expect(page.getByTestId('bulk-preview')).toContainText('3 total operations queued.');
  const reply = page.waitForResponse((response) =>
    response.url().endsWith(`/scim/endpoints/${id}/Bulk`) && response.request().method() === 'POST');
  await page.getByTestId('bulk-submit').click();
  const response = await reply;
  expect(response.status()).toBe(200);
  const body: { Operations: Array<{ bulkId: string; status: string; location?: string }> } =
    await response.json();
  expect(body.Operations.map((operation) => operation.bulkId)).toEqual(['row-1', 'row-2', 'row-3']);
  expect(body.Operations.map((operation) => operation.status)).toEqual(['201', '409', '201']);
  await expect(page.getByTestId('bulk-result-success-count')).toHaveText('2');
  await expect(page.getByTestId('bulk-result-failure-count')).toHaveText('1');
  await expect(page.getByTestId('bulk-result-row-row-2')).toContainText('409');
  await expect(page.getByTestId('bulk-result-row-row-1')).toContainText(body.Operations[0].location!);
  await persistedUser(page, id, first);
  await persistedUser(page, id, second);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('bulk-download-failures').click(),
  ]);
  expect(await download.failure()).toBeNull();
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Failure CSV download has no readable stream.');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const failuresCsv = Buffer.concat(chunks).toString('utf8');
  expect(failuresCsv).toContain('bulkId,method,status,scimType,detail');
  expect(failuresCsv).toContain('row-2,POST,409,uniqueness,');
  expect(failuresCsv).toContain(first);
  expect(failuresCsv).not.toContain('row-1');
  expect(failuresCsv).not.toContain('row-3');

  for (const width of [1440, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByTestId('bulk-result').scrollIntoViewIfNeeded();
    const bounds = await page.getByTestId('bulk-result').evaluate((element) => {
      const box = element.getBoundingClientRect();
      const rows = Array.from(element.querySelectorAll('[data-testid^="bulk-result-row-"]'));
      const cells = rows.flatMap((row) => Array.from(row.children));
      return {
        right: box.right,
        rows: rows.length,
        count: cells.length,
        overflowingCells: cells.filter((cell) => cell.getBoundingClientRect().right > box.right + 2).length,
      };
    });
    await test.info().attach(`bulk-result-layout-${width}`, {
      body: JSON.stringify(bounds, null, 2),
      contentType: 'application/json',
    });
    expect(bounds.right).toBeLessThanOrEqual(width + 2);
    expect(bounds.rows).toBe(3);
    expect(bounds.count).toBeGreaterThanOrEqual(9);
    expect(bounds.overflowingCells).toBe(0);
  }
  await uploadCsv(page, `userName,displayName\n${corrected},Corrected`);
  const retry = page.waitForResponse((r) =>
    r.url().endsWith(`/scim/endpoints/${id}/Bulk`) && r.request().method() === 'POST');
  await page.getByTestId('bulk-submit').click();
  expect((await retry).status()).toBe(200);
  await expect(page.getByTestId('bulk-result-success-count')).toHaveText('1');
  await expect(page.getByTestId('bulk-result-failure-count')).toHaveText('0');
  await expect(page.getByTestId('bulk-download-failures')).toHaveCount(0);
  await persistedUser(page, id, corrected);
  await persistedUser(page, id, first);
});

test('Bulk bounds long result values at wide and narrow viewports without losing their text', async ({ page }) => {
  const id = endpointId!;
  const location = `https://${'tenant'.repeat(20)}.example.invalid/Users/${randomUUID()}`;
  const detail = `A resource with userName '${'resource'.repeat(40)}' already exists.`;
  await page.route(`**/scim/endpoints/${id}/Bulk`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/scim+json',
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkResponse'],
        Operations: [
          { bulkId: 'row-1', method: 'POST', status: '201', location },
          { bulkId: 'row-2', method: 'POST', status: '409', response: { scimType: 'uniqueness', detail } },
        ],
      }),
    });
  });
  await page.goto(`/endpoints/${id}/bulk`);
  await uploadCsv(page, 'userName,displayName\nowned-one,One\nowned-two,Two');
  await page.getByTestId('bulk-submit').click();
  await expect(page.getByTestId('bulk-result-success-count')).toHaveText('1');
  await expect(page.getByTestId('bulk-result-failure-count')).toHaveText('1');
  await expect(page.getByTestId('bulk-result-row-row-1')).toContainText(location);
  await expect(page.getByTestId('bulk-result-row-row-2')).toContainText(detail);

  for (const width of [1440, 900]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await page.getByTestId('bulk-result').evaluate((element) => {
      const right = element.getBoundingClientRect().right;
      const rows = Array.from(element.querySelectorAll('[data-testid^="bulk-result-row-"]'));
      return {
        right,
        rows: rows.length,
        overflowingCells: rows.flatMap((row) => Array.from(row.children))
          .filter((cell) => cell.getBoundingClientRect().right > right + 2).length,
      };
    });
    await test.info().attach(`long-bulk-result-layout-${width}`, {
      body: JSON.stringify(bounds, null, 2),
      contentType: 'application/json',
    });
    expect(bounds.rows).toBe(2);
    expect(bounds.right).toBeLessThanOrEqual(width + 2);
    expect(bounds.overflowingCells).toBe(0);
    for (const field of ['bulk-result-location-row-1', 'bulk-result-detail-row-2']) {
      const truncation = await page.getByTestId(field).evaluate((element) =>
        Array.from(element.querySelectorAll('span'))
          .filter((span) => getComputedStyle(span).textOverflow === 'ellipsis')
          .map((span) => ({ clientWidth: span.clientWidth, scrollWidth: span.scrollWidth })),
      );
      expect(truncation).toHaveLength(1);
      expect(truncation[0].clientWidth).toBeGreaterThan(0);
      expect(truncation[0].scrollWidth).toBeGreaterThan(truncation[0].clientWidth);
    }
  }
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('bulk-result-location-row-1-copy-button').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(location);
  await page.getByTestId('bulk-result-detail-row-2-copy-button').click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(detail);
});

test('Bulk rejects malformed CSV without submitting a mutation', async ({ page }) => {
  const id = endpointId!;
  let submissions = 0;
  page.on('request', (request) => {
    if (request.url().endsWith(`/scim/endpoints/${id}/Bulk`) && request.method() === 'POST') submissions++;
  });
  await page.goto(`/endpoints/${id}/bulk`);
  await uploadCsv(page, 'userName,displayName\n"unterminated');
  await expect(page.getByTestId('bulk-csv-error')).toBeVisible();
  await expect(page.getByTestId('bulk-submit')).toBeDisabled();
  expect(submissions).toBe(0);
});

test('Manual Provision creates persisted resources, reports conflict, retries, and clears results on tab change', async ({ page }) => {
  const id = endpointId!;
  const userName = `manual-${randomUUID()}`;
  await page.goto(`/manual-provision?endpointId=${id}&resourceTypeId=User`);
  const editor = page.getByTestId('manual-resource-body-input');
  const payload = { schemas: [USER_SCHEMA], userName, displayName: 'Owned manual user', active: true };
  await editor.fill(JSON.stringify(payload, null, 2));
  const submit = page.getByRole('button', { name: 'Create User', exact: true });
  const created = page.waitForResponse((response) =>
    response.url().endsWith(`/scim/endpoints/${id}/Users`) && response.request().method() === 'POST');
  await submit.click();
  const createResponse = await created;
  expect(createResponse.status()).toBe(201);
  const resource: { id: string; userName: string } = await createResponse.json();
  expect(resource.userName).toBe(userName);
  await expect(page.getByTestId('provision-result-id')).toContainText(resource.id);
  await expect(page.getByTestId('provision-result-json')).toContainText(userName);
  expect((await persistedUser(page, id, userName)).id).toBe(resource.id);
  const duplicate = page.waitForResponse((response) =>
    response.url().endsWith(`/scim/endpoints/${id}/Users`) && response.request().method() === 'POST');
  await submit.click();
  const conflict = await duplicate;
  expect(conflict.status()).toBe(409);
  const failure: { detail: string } = await conflict.json();
  await expect(page.getByTestId('provision-result-error')).toContainText(failure.detail);
  await expect(page.getByTestId('provision-result-success')).toHaveCount(0);
  const retryName = `manual-retry-${randomUUID()}`;
  await editor.fill(JSON.stringify({ ...payload, userName: retryName }, null, 2));
  await submit.click();
  await expect(page.getByTestId('provision-result-success')).toBeVisible();
  await expect(page.getByTestId('provision-result-error')).toHaveCount(0);
  await persistedUser(page, id, retryName);
  await page.getByRole('tab', { name: 'Group', exact: true }).click();
  await expect(page.getByTestId('provision-result-empty')).toBeVisible();
  await expect(page.getByTestId('provision-result-success')).toHaveCount(0);
  const groupName = `manual-group-${randomUUID()}`;
  await editor.fill(JSON.stringify({ schemas: [GROUP_SCHEMA], displayName: groupName }, null, 2));
  const groupReply = page.waitForResponse((response) =>
    response.url().endsWith(`/scim/endpoints/${id}/Groups`) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create Group', exact: true }).click();
  const groupResponse = await groupReply;
  expect(groupResponse.status()).toBe(201);
  const group: { id: string; displayName: string } = await groupResponse.json();
  const stored = await page.request.get(`/scim/endpoints/${id}/Groups/${group.id}`, { headers });
  expect(stored.status()).toBe(200);
  expect((await stored.json()).displayName).toBe(groupName);
  await page.getByTestId('provision-open-resource').click();
  await expect(page).toHaveURL(new RegExp(`/endpoints/${id}/groups.*detail=${group.id}`));
});

test('Manual Provision cannot submit to an inactive owned endpoint', async ({ page }) => {
  const id = endpointId!;
  const deactivate = await page.request.patch(`/scim/admin/endpoints/${id}`, {
    headers,
    data: { active: false },
  });
  expect(deactivate.ok()).toBe(true);
  let submissions = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes(`/scim/endpoints/${id}/`)) submissions++;
  });
  await page.goto(`/manual-provision?endpointId=${id}`);
  await expect(page.getByTestId('manual-provision-inactive-endpoint')).toBeVisible();
  await expect(page.getByTestId('manual-resource-create-form')).toHaveCount(0);
  expect(submissions).toBe(0);
});
