import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { saveScreenshot } from './fixtures';

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
  await page.route(`**/scim/admin/endpoints/${inventory[0].id}`, route => route.fulfill({
    json: inventory[0],
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
  // A subsequent focused Playwright run cleans outputDir, not these receipts.
  const directory = resolve(info.project.outputDir, '..', 'ui-inventory-evidence');
  await mkdir(directory, { recursive: true });
  const file = resolve(directory, `${info.title.replace(/[^a-z0-9]+/gi, '-')}-${name}.json`);
  await writeFile(file, JSON.stringify(data, null, 2));
  await info.attach(name, { path: file, contentType: 'application/json' });
}

for (const width of [1440, 900, 390]) {
  test(`inventory fills available window height and left-aligns names at ${width}`, async ({ page }, info) => {
    await fixtures(page);
    const heights: number[] = [];
    for (const height of [540, 1100]) {
      await page.setViewportSize({ width, height });
      await page.goto('/endpoints');
      const results = page.getByTestId('endpoints-results');
      await expect(results.locator('tbody tr')).toHaveCount(80);
      const geometry = await results.evaluate(element => {
        const main = document.querySelector('[data-testid="app-content"]')!;
        const rect = element.getBoundingClientRect();
        const ancestors = [];
        for (let parent: Element | null = element; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          ancestors.push({
            tag: parent.tagName, testId: parent.getAttribute('data-testid'),
            height: style.height, minHeight: style.minHeight, display: style.display,
            flex: style.flex, overflow: style.overflow,
          });
        }
        return {
          top: rect.top, bottom: rect.bottom, height: rect.height,
          availableBottom: main.getBoundingClientRect().bottom - parseFloat(getComputedStyle(main).paddingBottom),
          page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth,
          scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
          ancestors,
        };
      });
      await receipt(info, `inventory-height-${height}`, geometry);
      expect(geometry.bottom).toBeLessThanOrEqual(height);
      expect(Math.abs(geometry.bottom - geometry.availableBottom)).toBeLessThanOrEqual(2);
      expect(geometry.height).toBeGreaterThan(180);
      expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
      expect(geometry.page).toBeLessThanOrEqual(geometry.viewport + 1);
      heights.push(geometry.height);
      await saveScreenshot(page, `inventory-layout-${width}-${height}`);
      const button = page.getByTestId(`endpoint-${inventory[1].id}-open`);
      const alignment = await button.evaluate(element => ({
        text: element.firstElementChild!.getBoundingClientRect().left,
        content: element.getBoundingClientRect().left
          + parseFloat(getComputedStyle(element).paddingLeft)
          + parseFloat(getComputedStyle(element).borderLeftWidth),
      }));
      expect(Math.abs(alignment.text - alignment.content)).toBeLessThanOrEqual(2);
      const filter = page.getByTestId('endpoints-search');
      const before = await filter.boundingBox();
      await results.evaluate(element => { element.scrollTop = element.scrollHeight; });
      expect((await filter.boundingBox())!.y).toBeCloseTo(before!.y, 0);
    }
    expect(heights[1] - heights[0]).toBeGreaterThan(500);
  });

  for (const section of ['users', 'groups'] as const) {
    test(`Operations ${section} filters retain owned scrolling and purpose at ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await fixtures(page);
      await page.route(`**/scim/admin/database/${section}?*`, route => {
        const search = new URL(route.request().url()).searchParams.get('search') ?? '';
        const rows = Array.from({ length: 50 }, (_, i) => ({
          id: `resource-${i}`, userName: `user-${i}@example.invalid`, displayName: `group-${i}`,
          endpointId: inventory[0].id, active: true, memberCount: i,
          createdAt: '2026-10-14T00:00:00Z',
        })).filter(row => (section === 'users' ? row.userName : row.displayName).includes(search));
        return route.fulfill({ json: { [section]: rows, pagination: { page: 1, limit: 50, total: rows.length, pages: 1 } } });
      });
      await page.goto(`/operations?tab=${section}`);
      await expect(page.getByText(/Operations answers what exists now/)).toBeVisible();
      const results = page.getByTestId(`operations-${section}-results`);
      await expect(results.locator('tbody tr')).toHaveCount(50);
      const search = page.getByTestId(`operations-${section}-search`);
      const before = await search.boundingBox();
      await results.evaluate(e => { e.scrollTop = e.scrollHeight; });
      const after = await search.boundingBox();
      expect(Math.abs(before!.y - after!.y)).toBeLessThanOrEqual(1);
      const bounds = await results.evaluate(e => ({
        height: e.clientHeight, scrollTop: e.scrollTop,
        page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth,
      }));
      await receipt(info, `operations-${section}-scroll-bounds`, bounds);
      expect(bounds.scrollTop).toBeGreaterThan(500);
      expect(bounds.height).toBeLessThanOrEqual(420);
      expect(bounds.page).toBeLessThanOrEqual(bounds.viewport + 1);
      await search.fill(section === 'users' ? 'user-49@' : 'group-49');
      await expect(results.locator('tbody tr')).toHaveCount(1);
      await expect(results.locator('tbody tr').first()).toContainText(section === 'users' ? 'user-49@example.invalid' : 'group-49');
      await page.goBack();
      await expect(results.locator('tbody tr')).toHaveCount(50);
      await page.goForward();
      await expect(results.locator('tbody tr')).toHaveCount(1);
      await page.getByTestId('operations-open-logs').click();
      await expect.poll(() => new URL(page.url()).pathname).toBe('/logs');
      expect(new URL(page.url()).searchParams.get('page')).toBe('1');
    });
  }

  test(`/Me explains OAuth subject intent without replacing administration at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixtures(page);
    await page.goto(`/me?endpointId=${inventory[0].id}`);
    await expect(page.getByText(/Self-service view of the SCIM User identified by this OAuth token/)).toBeVisible();
    await expect(page.getByText(/This is not the SCIMServer admin/)).toBeVisible();
    await page.getByRole('button', { name: 'Open OAuth setup' }).click();
    await expect(page).toHaveURL(new RegExp(`/endpoints/${inventory[0].id}/connect`));
  });

  test(`Manual Provision retains active-only target selection at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixtures(page);
    await page.goto('/manual-provision');
    const target = page.getByTestId('manual-endpoint-context').getByRole('combobox');
    await target.fill('tenant-079');
    await expect(page.getByTestId(`manual-endpoint-context-option-${inventory[79].id}`)).toHaveAttribute('aria-disabled', 'true');
    await target.fill('tenant-000');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('endpoint-context-selected')).toContainText(inventory[0].id);
    await expect(page.getByTestId('endpoint-context-selected')).toContainText(longName);
    expect(new URL(page.url()).searchParams.get('endpointId')).toBe(inventory[0].id);
    await expect(page.getByTestId('manual-resource-create-form')).toContainText('User');
  });

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
    for (const [query, count] of [['Active', 79], ['Inactive', 1], [inventory[0].id, 1], ['InventoryProfile', 80], ['no-such-tenant', 0]] as const) {
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
    await expect(page.getByTestId('endpoint-detail-page')).toContainText(longName);
    await expect(page.getByTestId('endpoint-scim-base-path')).toContainText(inventory[0].scimBasePath);
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
    await page.goBack();
    expect(new URL(page.url()).searchParams.has('secondaryId')).toBe(false);
    await expect(page.getByTestId('discovery-primary-selector-selected')).toContainText(inventory[0].id);
    await page.goForward();
    await expect(page.getByTestId('discovery-secondary-selector-selected')).toContainText(inventory[79].id);
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

  for (const count of [0, 1]) {
    test(`Discovery handles ${count} endpoints without ambiguous selection at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await fixtures(page, count);
      await page.goto('/discovery');
      if (count === 0) {
        await expect(page.getByTestId('discovery-no-endpoints')).toContainText('No endpoints');
      } else {
        const primary = page.getByTestId('discovery-primary-selector').getByRole('combobox');
        await primary.fill('not-a-match');
        await expect(page.getByRole('option')).toHaveText('No matching endpoints');
        await primary.fill(inventory[0].id);
        await expect(page.getByRole('option')).toHaveCount(1);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(page.getByTestId('discovery-primary-selector-selected')).toContainText(inventory[0].id);
        await page.getByTestId('discovery-toggle-compare').click();
        await expect(page.getByTestId('discovery-secondary-selector').getByRole('combobox')).toBeDisabled();
        expect(new URL(page.url()).searchParams.has('secondaryId')).toBe(false);
      }
      await page.goto('/endpoints');
      await expect(page.getByTestId('endpoints-table').locator('tbody tr')).toHaveCount(count);
      if (count === 0) await expect(page.getByTestId('endpoints-empty')).toContainText('No endpoints yet');
      else await expect(page.getByTestId(`endpoint-${inventory[0].id}`)).toContainText(longName);
    });
  }

  for (const count of [0, 1, 80]) {
    test(`Dashboard bounds ${count} endpoint summary at ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await fixtures(page, count);
      await page.goto('/');
      const summary = page.getByTestId('dashboard-endpoint-summary');
      await expect(summary.getByTestId(/endpoint-card-/)).toHaveCount(Math.min(count, 5));
      if (count === 0) await expect(summary).toContainText('No endpoints configured');
      else await expect(summary.getByTestId(`endpoint-card-${inventory[0].id}`)).toContainText('1 users');
      if (count > 0) {
        const card = summary.getByTestId(`endpoint-card-${inventory[count > 1 ? 1 : 0].id}`);
        await expect(card).toContainText(`${count > 1 ? 2 : 1} users`);
        await expect(card).toContainText('2 groups');
        const row = await card.evaluate(element => {
          const button = element.querySelector('button')!;
          const name = button.getBoundingClientRect();
          const stats = element.lastElementChild!.getBoundingClientRect();
          const bounds = element.getBoundingClientRect();
          return {
            height: bounds.height, right: bounds.right,
            statsRight: stats.right,
            centerDifference: Math.abs((name.top + name.bottom) / 2 - (stats.top + stats.bottom) / 2),
            nameLeft: button.firstElementChild!.getBoundingClientRect().left,
            contentLeft: name.left + parseFloat(getComputedStyle(button).paddingLeft)
              + parseFloat(getComputedStyle(button).borderLeftWidth),
          };
        });
        await receipt(info, 'dashboard-row-bounds', row);
        expect(row.statsRight).toBeLessThanOrEqual(row.right);
        expect(row.height).toBeLessThanOrEqual(width === 390 ? 90 : 64);
        expect(Math.abs(row.nameLeft - row.contentLeft)).toBeLessThanOrEqual(2);
        if (width !== 390) expect(row.centerDifference).toBeLessThanOrEqual(2);
      }
      const geometry = await summary.evaluate(e => ({
        height: e.getBoundingClientRect().height,
        page: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth,
      }));
      await receipt(info, 'dashboard-summary-bounds', geometry);
      expect(geometry.height).toBeLessThan(600);
      expect(geometry.page).toBeLessThanOrEqual(geometry.viewport + 1);
      await summary.scrollIntoViewIfNeeded();
      if (count === 80) await saveScreenshot(page, `dashboard-summary-layout-${width}`);
      await page.getByTestId('dashboard-all-endpoints').click();
      await expect(page).toHaveURL(/\/endpoints$/);
    });
  }
}
