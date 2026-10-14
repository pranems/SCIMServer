import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const token = process.env.E2E_TOKEN || 'changeme-scim';
const longName = `Inventory ${'long-provisioning-name-'.repeat(18)}`;
const inventory = Array.from({ length: 80 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  name: `tenant-${String(i).padStart(3, '0')}`,
  displayName: i === 0 ? longName : `Tenant ${i}`,
  active: i !== 79,
  scimBasePath: `/scim/endpoints/00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  profileSummary: {
    schemaCount: 1, schemas: [{ id: 'urn:test:Inventory', name: 'InventoryProfile', attributeCount: 1 }],
    resourceTypeCount: 1, resourceTypes: [{ name: 'User', schema: 'urn:test:Inventory', extensions: [], extensionCount: 0 }],
    serviceProviderConfig: {}, activeSettings: {},
  },
  users: { total: i + 1, active: i + 1, inactive: 0 },
  groups: { total: 2, active: 2, inactive: 0 },
  createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z',
}));

async function fixtures(page: Page, count = 80): Promise<void> {
  await page.addInitScript(value => localStorage.setItem('scimserver.authToken', value), token);
  await page.route('**/scim/admin/endpoints*', route => route.fulfill({
    json: { totalResults: count, endpoints: inventory.slice(0, count) },
  }));
  await page.route('**/scim/admin/dashboard', route => route.fulfill({ json: {
    health: { status: 'ok', uptime: 1, dbType: 'test' },
    stats: { totalEndpoints: count, totalUsers: count, totalGroups: count },
    endpoints: inventory.slice(0, count), requestsLast24hSeries: Array.from({ length: 24 }, () => 0),
    recentActivity: [], version: { version: 'test', node: 'test', uptime: 1 },
  } }));
  await page.route('**/scim/endpoints/*/Schemas', route => route.fulfill({ json: {
    Resources: [{ id: 'urn:test:Inventory', name: 'InventoryProfile', attributes: [] }], totalResults: 1,
  } }));
  await page.route('**/scim/endpoints/*/ResourceTypes', route => route.fulfill({ json: {
    Resources: [{ id: 'User', name: 'User', endpoint: '/Users', schema: 'urn:test:Inventory' }], totalResults: 1,
  } }));
  await page.route('**/scim/endpoints/*/ServiceProviderConfig', route => route.fulfill({ json: {
    patch: { supported: true }, filter: { supported: true, maxResults: 100 },
  } }));
}

async function receipt(info: TestInfo, name: string, data: unknown): Promise<void> {
  const file = info.outputPath(`${name}.json`);
  await writeFile(file, JSON.stringify(data, null, 2));
  await info.attach(name, { path: file, contentType: 'application/json' });
}

for (const width of [1440, 900, 390]) {
  test(`compact inventory preserves filters, geometry and navigation at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await fixtures(page);
    await page.goto('/endpoints');
    const results = page.getByTestId('endpoints-results');
    const table = page.getByTestId('endpoints-table');
    await expect(table.locator('tbody tr')).toHaveCount(80);
    const before = await page.getByTestId('endpoints-search').boundingBox();
    await results.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const after = await page.getByTestId('endpoints-search').boundingBox();
    expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
    expect(await results.evaluate(element => element.scrollTop)).toBeGreaterThan(500);
    const input = page.getByRole('searchbox', { name: 'Filter endpoints by name, ID, profile or status' });
    for (const [query, count] of [['Inactive', 1], [inventory[0].id, 1], ['InventoryProfile', 80], ['no-such-tenant', 0]] as const) {
      await input.fill(query);
      await expect(table.locator('tbody tr')).toHaveCount(count);
      await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(query)}`));
    }
    await page.getByTestId('endpoints-empty-filtered-action').click();
    await expect(table.locator('tbody tr')).toHaveCount(80);
    await input.fill('tenant-000');
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await page.goBack();
    await expect(table.locator('tbody tr')).toHaveCount(80);
    await page.goForward();
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await expect(input).toHaveValue('tenant-000');
    const bounds = await table.evaluate(element => ({
      table: element.getBoundingClientRect().toJSON(),
      headers: Array.from(element.querySelectorAll('th')).map(e => e.getBoundingClientRect().toJSON()),
      page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth,
      client: element.parentElement!.clientWidth, scroll: element.parentElement!.scrollWidth,
    }));
    await receipt(info, 'inventory-bounds', bounds);
    expect(bounds.page).toBeLessThanOrEqual(bounds.viewport + 1);
    expect(bounds.headers[0].width / bounds.table.width).toBeGreaterThan(0.3);
    expect(bounds.headers[0].width / bounds.table.width).toBeLessThan(0.6);
    for (const header of bounds.headers) expect(header.right).toBeLessThanOrEqual(bounds.table.right + 1);
    if (width === 390) expect(bounds.scroll).toBeGreaterThan(bounds.client);
    const label = page.getByTestId(`endpoint-${inventory[0].id}-label`);
    const clipping = await label.evaluate(e => ({ client: e.clientWidth, scroll: e.scrollWidth }));
    expect(clipping.scroll).toBeGreaterThan(clipping.client);
    const open = page.getByTestId(`endpoint-${inventory[0].id}-open`);
    await open.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/endpoints/${inventory[0].id}`));
  });

  test(`Discovery selection, contract order and history are unambiguous at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await fixtures(page);
    await page.goto('/discovery');
    const tabs = page.getByTestId('discovery-subtabs').getByRole('tab');
    await expect.poll(() => tabs.evaluateAll(elements => elements.map(e => e.getAttribute('data-testid'))))
      .toEqual(['discovery-tab-schemas', 'discovery-tab-resourceTypes', 'discovery-tab-serviceProviderConfig']);
    const primary = page.getByTestId('discovery-primary-selector').getByRole('combobox');
    await primary.fill('tenant-000');
    await page.getByRole('option').first().click();
    const selected = page.getByTestId('discovery-primary-selector-selected');
    await expect(selected).toContainText(inventory[0].id);
    await expect(selected.getByRole('button', { name: /Selected primary endpoint/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('discovery-schemas-single')).toContainText('InventoryProfile');
    await page.getByTestId('discovery-toggle-compare').click();
    const secondary = page.getByTestId('discovery-secondary-selector').getByRole('combobox');
    await secondary.fill('tenant-079');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('discovery-secondary-selector-selected')).toContainText(inventory[79].id);
    await expect(page).toHaveURL(new RegExp(`secondaryId=${inventory[79].id}`));
    await page.getByTestId('discovery-tab-resourceTypes').click();
    await expect(page.getByTestId('discovery-resourcetype-row-User')).toContainText('User');
    await page.goBack();
    await expect(page.getByTestId('discovery-tab-schemas')).toHaveAttribute('aria-selected', 'true');
    await page.goForward();
    await expect(page.getByTestId('discovery-tab-resourceTypes')).toHaveAttribute('aria-selected', 'true');
    const bounds = await selected.evaluate(e => ({
      height: e.getBoundingClientRect().height,
      page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth,
    }));
    await receipt(info, 'discovery-selection-bounds', bounds);
    expect(bounds.height).toBeLessThan(220);
    expect(bounds.page).toBeLessThanOrEqual(bounds.viewport + 1);
    await page.getByTestId('discovery-open-in-workbench').click();
    await expect(page).toHaveURL(/\/workbench/);
    const prefill = new URL(page.url()).searchParams.get('prefill')!;
    expect(JSON.parse(decodeURIComponent(prefill))).toEqual({ method: 'GET', path: `${inventory[0].scimBasePath}/ResourceTypes` });
  });

  for (const count of [0, 1, 80]) {
    test(`Dashboard bounds ${count} endpoint summary at ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await fixtures(page, count);
      await page.goto('/');
      const summary = page.getByTestId('dashboard-endpoint-summary');
      await expect(summary.getByTestId(/endpoint-card-/)).toHaveCount(Math.min(count, 5));
      if (count === 0) await expect(summary).toContainText('No endpoints configured');
      else await expect(summary.getByTestId(`endpoint-card-${inventory[0].id}`)).toContainText('1 users');
      const geometry = await summary.evaluate(e => ({
        height: e.getBoundingClientRect().height,
        page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth,
      }));
      await receipt(info, 'dashboard-summary-bounds', geometry);
      expect(geometry.height).toBeLessThan(600);
      expect(geometry.page).toBeLessThanOrEqual(geometry.viewport + 1);
      await page.getByTestId('dashboard-all-endpoints').click();
      await expect(page).toHaveURL(/\/endpoints$/);
    });
  }
}
