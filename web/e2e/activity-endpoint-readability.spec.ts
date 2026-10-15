import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const endpointId = '00000000-0000-4000-8000-000000000014';
const endpointName = `Readability endpoint ${'with-a-long-provisioning-application-name-'.repeat(8)}`;
const longPath = `/scim/endpoints/${endpointId}/Users/${'long-resource-id-'.repeat(30)}`;
const token = process.env.E2E_TOKEN || 'changeme-scim';

async function retainBounds(testInfo: TestInfo, name: string, bounds: unknown): Promise<void> {
  const file = testInfo.outputPath(`${name}.json`);
  await writeFile(file, JSON.stringify(bounds, null, 2));
  await testInfo.attach(name, { path: file, contentType: 'application/json' });
}

async function seedDisplayFixtures(page: Page): Promise<void> {
  await page.addInitScript(value => localStorage.setItem('scimserver.authToken', value), token);
  await page.route('**/scim/admin/endpoints*', route => route.fulfill({
    json: { totalResults: 1, endpoints: [{
      id: endpointId, name: 'readability', displayName: endpointName, active: true,
      scimBasePath: `/scim/endpoints/${endpointId}`, createdAt: '2026-10-14T00:00:00Z',
      updatedAt: '2026-10-14T00:00:00Z',
    }] },
  }));
  await page.route('**/scim/admin/dashboard', route => route.fulfill({
    json: {
      health: { status: 'ok', uptime: 1, dbType: 'test' },
      stats: { totalEndpoints: 1, totalUsers: 1, totalGroups: 1 },
      endpoints: [], requestsLast24hSeries: Array.from({ length: 24 }, () => 0),
      version: { version: 'test', node: 'test', uptime: 1 },
      recentActivity: [
        { id: 'server', method: 'POST', path: '/scim/oauth/token', statusCode: 200, durationMs: 3,
          authOutcome: 'accept', authMethod: 'oauth_client' },
        { id: 'long', method: 'DELETE', path: longPath, endpointId, endpointName,
          statusCode: 403, durationMs: 12345, authOutcome: 'reject', authMethod: 'wif',
          authReason: 'WIF_ASSERTION_INVALID' },
        { id: 'short', method: 'GET', path: '/scim/Users', endpointId, endpointName: 'Short',
          statusCode: 200, durationMs: 1 },
      ],
    },
  }));
  await page.route('**/scim/admin/database/users?*', route => route.fulfill({
    json: { users: [{ id: 'readability-user', userName: 'readability@example.invalid',
      active: true, endpointId, createdAt: '2026-10-14T23:59:58.123Z' }],
    pagination: { page: 1, limit: 50, total: 1, pages: 1 } },
  }));
  await page.route('**/scim/admin/database/groups?*', route => route.fulfill({
    json: { groups: [{ id: 'readability-group', displayName: 'Readability group',
      memberCount: 1, endpointId, createdAt: '2026-10-15T04:05:06.789Z' }],
    pagination: { page: 1, limit: 50, total: 1, pages: 1 } },
  }));
}

for (const width of [1440, 900, 390]) {
  test(`Recent Activity retains aligned fields and bounded text at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await seedDisplayFixtures(page);
    await page.goto('/');
    const rows = page.locator('[data-testid^="dashboard-activity-row-"]');
    await expect(rows).toHaveCount(3);
    await rows.first().scrollIntoViewIfNeeded();
    const geometry = await rows.evaluateAll(elements => elements.map(row => ({
      right: row.getBoundingClientRect().right,
      fields: Array.from(row.children).map(field => {
        const rect = field.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      }),
    })));
    await retainBounds(testInfo, 'activity-field-bounds', { width, geometry });
    for (const row of geometry) {
      expect(row.fields, 'all rows reserve method, path, endpoint, status, auth and duration').toHaveLength(6);
      for (let index = 0; index < row.fields.length; index++) {
        expect(Math.abs(row.fields[index].left - geometry[0].fields[index].left)).toBeLessThanOrEqual(2);
        expect(row.fields[index].right).toBeLessThanOrEqual(row.right + 1);
        if (index > 0) expect(row.fields[index].left).toBeGreaterThanOrEqual(row.fields[index - 1].right - 1);
      }
    }
    await expect(page.getByTestId('dashboard-activity-row-server')).toContainText('Server-wide');
    if (width === 390) {
      const scrolling = await page.getByTestId('activity-list').evaluate(element => ({
        client: element.clientWidth, scroll: element.scrollWidth,
        viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth,
      }));
      expect(scrolling.scroll).toBeGreaterThan(scrolling.client);
      expect(scrolling.page).toBeLessThanOrEqual(scrolling.viewport + 1);
    }
    for (const kind of ['path', 'endpoint']) {
      const clipped = page.getByTestId(`dashboard-activity-${kind}-long`);
      await expect(clipped).toBeVisible();
      const bounds = await clipped.evaluate(element => ({
        scroll: element.scrollWidth, client: element.clientWidth,
      }));
      expect(bounds.client).toBeGreaterThan(30);
      expect(bounds.scroll).toBeGreaterThan(bounds.client);
    }
    await page.getByTestId('dashboard-activity-endpoint-open-long').click();
    await expect(page).toHaveURL(new RegExp(`/endpoints/${endpointId}`));
  });

  for (const section of ['users', 'groups'] as const) {
    test(`Operations ${section} endpoint identity stays inside its column at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await seedDisplayFixtures(page);
      await page.goto('/operations');
      await page.getByTestId(`operations-tab-${section}`).click();
      const kind = section === 'users' ? 'user' : 'group';
      const link = page.getByTestId(`operations-${kind}-row-readability-${kind}-endpoint-${endpointId}`);
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('title', `${endpointName} (readability, ${endpointId})`);
      await expect(link).toContainText(endpointName);
      await expect(link.locator('.fui-Badge')).toHaveCount(0);
      const identityId = await link.getAttribute('data-testid');
      const copy = page.getByTestId(`${identityId}-identity-copy-button`);
      await expect(copy).toBeVisible();
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
      await copy.click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(endpointName);
      await page.evaluate(() => navigator.clipboard.writeText('before-keyboard-copy'));
      await copy.press('Space');
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(endpointName);
      const created = page.getByTestId(`operations-${kind}-row-readability-${kind}`).locator('time');
      await expect(created).toHaveText(section === 'users'
        ? '2026-10-14 23:59:58.123 UTC' : '2026-10-15 04:05:06.789 UTC');
      await created.scrollIntoViewIfNeeded();
      const timestampBounds = await created.evaluate(element => {
        const range = document.createRange();
        range.selectNodeContents(element.firstElementChild!.firstElementChild!);
        return { cell: element.closest('td')!.getBoundingClientRect().toJSON(),
          text: Array.from(range.getClientRects(), rect => rect.toJSON()) };
      });
      expect(timestampBounds.text.length).toBeGreaterThan(0);
      for (const rect of timestampBounds.text) {
        expect(rect.left).toBeGreaterThanOrEqual(timestampBounds.cell.left - 1);
        expect(rect.right).toBeLessThanOrEqual(timestampBounds.cell.right + 1);
        expect(rect.top).toBeGreaterThanOrEqual(timestampBounds.cell.top - 1);
        expect(rect.bottom).toBeLessThanOrEqual(timestampBounds.cell.bottom + 1);
      }
      const popupPromise = page.waitForEvent('popup');
      await page.getByTestId(`${identityId}-open`).click();
      const popup = await popupPromise;
      await expect(popup).toHaveURL(new RegExp(`/endpoints/${endpointId}/${section}`));
      await popup.close();
      const bounds = await link.evaluate(element => {
        const cell = element.closest('td')!;
        const table = element.closest('table')!;
        const text = element.querySelector('span[data-testid$="-label"]') ?? element;
        return {
          cell: cell.getBoundingClientRect().toJSON(), link: element.getBoundingClientRect().toJSON(),
          table: table.getBoundingClientRect().toJSON(),
          headers: Array.from(table.querySelectorAll('th')).map(header => header.getBoundingClientRect().toJSON()),
          scroll: text.scrollWidth, client: text.clientWidth,
          containerClient: table.parentElement!.clientWidth, containerScroll: table.parentElement!.scrollWidth,
          viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth,
        };
      });
      await retainBounds(testInfo, 'endpoint-column-bounds', { width, section, bounds });
      expect(bounds.link.right).toBeLessThanOrEqual(bounds.cell.right + 1);
      expect(bounds.link.width).toBeGreaterThan(40);
      expect(bounds.client).toBeGreaterThan(30);
      expect(bounds.scroll).toBeGreaterThan(bounds.client);
      expect(bounds.cell.height).toBeLessThan(100);
      expect(bounds.page).toBeLessThanOrEqual(bounds.viewport + 1);
      if (width === 390) expect(bounds.containerScroll).toBeGreaterThan(bounds.containerClient);
      for (const header of bounds.headers) {
        expect(header.right).toBeLessThanOrEqual(bounds.table.right + 1);
      }
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/endpoints/${endpointId}/${section}`));
    });
  }
}
