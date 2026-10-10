import { expect, test } from '@playwright/test';

const TOKEN_STORAGE_KEY = 'scimserver.authToken';

test('renders application chrome and Dashboard loading state while analytics are pending', async ({
  page,
}) => {
  const token = process.env.E2E_TOKEN || 'local-secret';
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: TOKEN_STORAGE_KEY, value: token },
  );

  let releaseDashboard: (() => void) | undefined;
  const dashboardBlocked = new Promise<void>((resolve) => {
    releaseDashboard = resolve;
  });

  await page.route('**/scim/admin/dashboard', async (route) => {
    await dashboardBlocked;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        health: { status: 'ok', uptime: 1, dbType: 'test' },
        stats: { totalEndpoints: 0, totalUsers: 0, totalGroups: 0 },
        endpoints: [],
        recentActivity: [],
        requestsLast24hSeries: Array.from({ length: 24 }, () => 0),
        version: { version: 'test', node: 'test', uptime: 1 },
      }),
    });
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('dashboard-loading')).toBeVisible({ timeout: 5_000 });

  releaseDashboard?.();
  await expect(page.getByTestId('dashboard-page')).toBeVisible({ timeout: 30_000 });
});
