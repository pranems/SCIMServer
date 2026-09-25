import { test, expect } from '@playwright/test';

const TOKEN_STORAGE_KEY = 'scimserver.authToken';
const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: TOKEN_STORAGE_KEY, value: TOKEN },
  );
});

test('global Back and Forward restore Operations subtab state', async ({ page }) => {
  await page.route('**/scim/admin/database/users**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ users: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } }),
    });
  });
  await page.route('**/scim/admin/database/groups**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ groups: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 } }),
    });
  });
  await page.route('**/scim/admin/database/statistics', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        users: { total: 0, active: 0, inactive: 0 },
        groups: { total: 0 },
        activity: { totalRequests: 0, last24Hours: 0 },
        database: { type: 'test', persistenceBackend: 'inmemory' },
      }),
    });
  });
  await page.route('**/scim/admin/endpoints**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        totalResults: 1,
        endpoints: [{ id: 'ep-nav', name: 'navigation', displayName: 'Navigation', active: true }],
      }),
    });
  });
  await page.goto('/operations');
  await expect(page.getByTestId('operations-page')).toBeVisible({ timeout: 30_000 });

  const back = page.getByTestId('global-history-back');
  const forward = page.getByTestId('global-history-forward');
  await expect(back).toBeDisabled();
  await expect(forward).toBeDisabled();

  await page.getByTestId('operations-tab-groups').click();
  await expect(page).toHaveURL(/[?&]tab=groups(?:&|$)/);
  await expect(page.getByTestId('operations-tab-groups')).toHaveAttribute('aria-selected', 'true');
  await expect(back).toBeEnabled();

  await back.click();
  await expect(page.getByTestId('operations-tab-users')).toHaveAttribute('aria-selected', 'true');
  await expect(forward).toBeEnabled();

  await forward.click();
  await expect(page.getByTestId('operations-tab-groups')).toHaveAttribute('aria-selected', 'true');
  await expect(forward).toBeDisabled();
});

test('Logs Errors only writes a valid typed search value and filters the request', async ({ page }) => {
  const logRequests: string[] = [];
  await page.route('**/scim/admin/endpoints**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        totalResults: 1,
        endpoints: [{ id: 'ep-logs', name: 'logs', displayName: 'Logs', active: true }],
      }),
    });
  });
  await page.route('**/scim/admin/logs**', async (route) => {
    logRequests.push(route.request().url());
    const errorsOnly = new URL(route.request().url()).searchParams.get('hasError') === 'true';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(errorsOnly ? {
        total: 1,
        page: 1,
        pageSize: 50,
        items: [{
          id: 'error-visible',
          method: 'POST',
          url: '/scim/endpoints/ep-logs/Users',
          status: 400,
          durationMs: 12,
          createdAt: '2026-09-24T00:00:00.000Z',
          endpointId: 'ep-logs',
          errorMessage: 'invalid payload',
        }],
      } : { total: 0, page: 1, pageSize: 50, items: [] }),
    });
  });

  await page.goto('/logs');
  await expect(page.getByTestId('global-logs-page')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('logs-toolbar-errors').click();

  await expect(page).toHaveURL(/[?&]hasError=true(?:&|$)/);
  await expect(page.getByTestId('global-logs-page')).toBeVisible();
  await expect(page.getByText('Invalid input')).toHaveCount(0);
  await expect.poll(() => logRequests.some((url) => new URL(url).searchParams.get('hasError') === 'true')).toBe(true);
  await expect(page.getByTestId('logs-row-error-visible')).toBeVisible();
  await expect(page.getByTestId('logs-toolbar-reset')).toBeVisible();
});

test('My Profile preflights a shared-secret session without sending /Me', async ({ page }) => {
  let meRequests = 0;
  await page.route('**/scim/admin/endpoints**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        totalResults: 1,
        endpoints: [{
          id: 'ep-context',
          name: 'context-endpoint',
          displayName: 'Context endpoint',
          active: true,
          scimBasePath: '/scim/endpoints/ep-context/v2',
          createdAt: '2026-09-24T00:00:00.000Z',
          updatedAt: '2026-09-24T00:00:00.000Z',
          _links: { self: '', stats: '', credentials: '', scim: '' },
        }],
      }),
    });
  });
  await page.route('**/scim/endpoints/*/Me', async (route) => {
    meRequests += 1;
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/me');
  await expect(page.getByTestId('me-profile-page')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('combobox', { name: 'Profile endpoint' }).click();
  await expect(page.getByRole('option', { name: /context-endpoint.*Active/i })).toBeVisible();
  await page.getByRole('option', { name: /Context endpoint/i }).click();

  await expect(page).toHaveURL(/[?&]endpointId=ep-context(?:&|$)/);
  await expect(page.getByTestId('me-oauth-preflight')).toBeVisible();
  await expect(page.getByTestId('scim-error-message')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open OAuth setup' })).toBeVisible();
  expect(meRequests).toBe(0);

  await page.getByTestId('global-history-back').click();
  await expect(page.getByTestId('me-empty')).toBeVisible();
  await page.getByTestId('global-history-forward').click();
  await expect(page.getByTestId('me-oauth-preflight')).toBeVisible();
  expect(meRequests).toBe(0);
});

test('Manual Provision identifies the target and explains its cross-endpoint role', async ({ page }) => {
  await page.route('**/scim/admin/endpoints**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        totalResults: 1,
        endpoints: [{
          id: 'ep-context',
          name: 'context-endpoint',
          displayName: 'Context endpoint',
          active: true,
          scimBasePath: '/scim/endpoints/ep-context/v2',
          createdAt: '2026-09-24T00:00:00.000Z',
          updatedAt: '2026-09-24T00:00:00.000Z',
          _links: { self: '', stats: '', credentials: '', scim: '' },
        }],
      }),
    });
  });
  await page.route('**/scim/endpoints/ep-context/Schemas**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/scim+json',
      body: JSON.stringify({ Resources: [
        { id: 'urn:ietf:params:scim:schemas:core:2.0:User', attributes: [{ name: 'userName', type: 'string', required: true }] },
        { id: 'urn:ietf:params:scim:schemas:core:2.0:Group', attributes: [{ name: 'displayName', type: 'string', required: true }] },
      ] }),
    });
  });
  await page.route('**/scim/endpoints/ep-context/ResourceTypes**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/scim+json',
      body: JSON.stringify({ Resources: [
        { id: 'User', name: 'User', endpoint: '/Users', schema: 'urn:ietf:params:scim:schemas:core:2.0:User' },
        { id: 'Group', name: 'Group', endpoint: '/Groups', schema: 'urn:ietf:params:scim:schemas:core:2.0:Group' },
      ] }),
    });
  });

  await page.goto('/manual-provision');
  await expect(page.getByTestId('manual-provision-page')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Cross-endpoint creation workspace/i)).toBeVisible();
  await page.getByRole('combobox', { name: 'Target endpoint' }).click();
  await expect(page.getByRole('option', { name: /context-endpoint.*Active/i })).toBeVisible();
  await page.getByRole('option', { name: /Context endpoint/i }).click();
  await expect(page).toHaveURL(/[?&]endpointId=ep-context(?:&|$)/);
  await expect(page.getByTestId('endpoint-context-selected')).toContainText('Context endpoint');
  await expect(page.getByTestId('endpoint-context-selected')).toContainText('context-endpoint');
  await page.getByRole('tab', { name: 'Group' }).click();
  await expect(page).toHaveURL(/[?&]resourceTypeId=Group(?:&|$)/);
  await expect(page.getByRole('tab', { name: 'Group' })).toHaveAttribute('aria-selected', 'true');

  await page.getByTestId('global-history-back').click();
  await expect(page.getByRole('tab', { name: 'User' })).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('global-history-forward').click();
  await expect(page.getByRole('tab', { name: 'Group' })).toHaveAttribute('aria-selected', 'true');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const bodyLayout = await page.getByTestId('manual-provision-body').evaluate((body) => {
      const rect = body.getBoundingClientRect();
      const children = Array.from(body.children).map((child) => {
        const childRect = child.getBoundingClientRect();
        return { left: childRect.left, right: childRect.right, top: childRect.top, bottom: childRect.bottom };
      });
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        children,
        pageScrollWidth: document.documentElement.scrollWidth,
        pageClientWidth: document.documentElement.clientWidth,
      };
    });
    expect(bodyLayout.width).toBeGreaterThan(0);
    expect(bodyLayout.pageScrollWidth, `${width}px page must not overflow horizontally`).toBeLessThanOrEqual(bodyLayout.pageClientWidth);
    expect(bodyLayout.children).toHaveLength(2);
    for (const child of bodyLayout.children) {
      expect(child.left).toBeGreaterThanOrEqual(bodyLayout.left - 1);
      expect(child.right).toBeLessThanOrEqual(bodyLayout.right + 1);
    }
    expect(bodyLayout.children[1].top).toBeGreaterThanOrEqual(bodyLayout.children[0].bottom);
  }
});

test('global Back and Forward restore an endpoint Logs detail drawer', async ({ page }) => {
  const endpoint = {
    id: 'ep-drawer',
    name: 'drawer-endpoint',
    displayName: 'Drawer endpoint',
    active: true,
    scimBasePath: '/scim/endpoints/ep-drawer/v2',
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
    profile: {
      resourceTypes: [
        { id: 'User', name: 'User', endpoint: '/Users' },
        { id: 'Group', name: 'Group', endpoint: '/Groups' },
      ],
      settings: {},
    },
    _links: { self: '', stats: '', credentials: '', scim: '' },
  };
  const list = {
    total: 1,
    page: 1,
    pageSize: 20,
    items: [{
      id: 'log-drawer',
      method: 'GET',
      url: '/scim/endpoints/ep-drawer/Users',
      status: 200,
      durationMs: 5,
      createdAt: '2026-09-24T00:00:00.000Z',
    }],
  };
  const detail = {
    ...list.items[0],
    requestHeaders: {},
    requestBody: null,
    responseHeaders: {},
    responseBody: { totalResults: 0, Resources: [] },
  };

  await page.route('**/scim/admin/endpoints', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ totalResults: 1, endpoints: [endpoint] }) });
  });
  await page.route('**/scim/admin/endpoints/ep-drawer/overview', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ endpoint, configFlags: {}, credentials: [], recentActivity: [] }) });
  });
  await page.route('**/scim/admin/endpoints/ep-drawer', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(endpoint) });
  });
  await page.route('**/scim/admin/auth-decisions**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0, records: [] }) });
  });
  await page.route('**/scim/admin/logs**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(list) });
  });
  await page.route('**/scim/admin/logs/log-drawer', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) });
  });

  await page.goto('/endpoints/ep-drawer/logs');
  await expect(page.getByTestId('logs-tab-row-log-drawer')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('logs-tab-row-log-drawer').click();
  await expect(page).toHaveURL(/[?&]detail=log-drawer(?:&|$)/);
  await expect(page.getByTestId('logs-tab-detail-drawer')).toBeVisible();

  await page.getByTestId('global-history-back').click();
  await expect(page.getByTestId('logs-tab-detail-drawer')).toHaveCount(0);
  await page.getByTestId('global-history-forward').click();
  await expect(page.getByTestId('logs-tab-detail-drawer')).toBeVisible();
});

test('global history and header actions remain bounded without overlap at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/scim/admin/endpoints**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        totalResults: 1,
        endpoints: [{ id: 'ep-mobile', name: 'mobile', displayName: 'Mobile', active: true }],
      }),
    });
  });
  await page.route('**/scim/admin/logs**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ total: 0, page: 1, pageSize: 50, items: [] }),
    });
  });
  await page.goto('/logs');
  await expect(page.getByTestId('app-header')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('global-logs-page')).toBeVisible({ timeout: 30_000 });

  const geometry = await page.getByTestId('app-header').evaluate((header) => {
    const headerRect = header.getBoundingClientRect();
    const buttons = Array.from(header.querySelectorAll('button')).map((button) => {
      const rect = button.getBoundingClientRect();
      return { label: button.getAttribute('aria-label') ?? '', left: rect.left, right: rect.right };
    });
    return { left: headerRect.left, right: headerRect.right, buttons };
  });

  for (const button of geometry.buttons) {
    expect(button.left, `${button.label} starts outside the header`).toBeGreaterThanOrEqual(geometry.left);
    expect(button.right, `${button.label} ends outside the header`).toBeLessThanOrEqual(geometry.right);
  }
  const sorted = [...geometry.buttons].sort((left, right) => left.left - right.left);
  for (let index = 1; index < sorted.length; index += 1) {
    expect(
      sorted[index].left,
      `${sorted[index - 1].label} overlaps ${sorted[index].label}`,
    ).toBeGreaterThanOrEqual(sorted[index - 1].right);
  }

  const layout = await page.evaluate(() => {
    const sidebar = document.querySelector('[data-testid="app-sidebar"]')!.getBoundingClientRect();
    const content = document.querySelector('[data-testid="app-content"]')!.getBoundingClientRect();
    return { sidebarWidth: sidebar.width, contentLeft: content.left, contentWidth: content.width };
  });
  expect(layout.sidebarWidth, 'the narrow sidebar should be icon-only').toBeLessThanOrEqual(64);
  expect(layout.contentLeft, 'main content should begin beside the compact sidebar').toBeLessThanOrEqual(64);
  expect(layout.contentWidth, 'the workflow must retain usable mobile width').toBeGreaterThanOrEqual(320);

  await page.setViewportSize({ width: 320, height: 844 });
  const narrow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    headerRight: document.querySelector('[data-testid="app-header"]')!.getBoundingClientRect().right,
  }));
  expect(narrow.scrollWidth, 'the 320px page must not overflow horizontally').toBeLessThanOrEqual(narrow.clientWidth);
  expect(narrow.headerRight).toBeLessThanOrEqual(320);
});