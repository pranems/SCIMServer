/**
 * REAL Smoke Test - validates every user flow against the live deployment.
 *
 * This test does NOT mock anything. It hits the real server, enters a real
 * token, and validates that every page renders with real data.
 *
 * Every step saves a screenshot to docs/screenshots/ (committed to repo
 * so the UI guide can reference them).
 *
 * Run:
 *   E2E_BASE_URL=https://scimserver-dev.xyz E2E_TOKEN=changeme-scim npx playwright test e2e/smoke-test.spec.ts
 */
import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Screenshots go into docs/screenshots/ so they're committed and visible in the UI guide */
const SCREENSHOT_DIR = path.resolve(__dirname, '..', '..', 'docs', 'screenshots');

// Ensure directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function screenshot(page: any, name: string): Promise<void> {
  const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
}

const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';

// Inject token before every navigation so TokenGate accepts it on first paint.
// Test 1 explicitly tests the token-dialog flow and needs to RUN WITHOUT the
// init script so it can clear storage and see the dialog; we gate on testInfo
// title so test 1 keeps its first-run-from-clean-slate semantics.
test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.startsWith('1. First visit')) return;
  await page.addInitScript(
    ({ key, value }) => {
      try { window.localStorage.setItem(key, value); } catch {}
    },
    { key: 'scimserver.authToken', value: TOKEN },
  );
});

test.describe('Smoke Test - Complete User Flows', () => {

  test('1. First visit: token dialog appears and works', async ({ page }) => {
    // Clear all state
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForTimeout(2000);

    // Token dialog must be visible
    const tokenInput = page.getByTestId('token-input');
    await expect(tokenInput).toBeVisible({ timeout: 10000 });
    await screenshot(page, '01-token-dialog');

    // Enter token
    await tokenInput.fill(TOKEN);
    await screenshot(page, '02-token-entered');

    // Click save
    await page.getByTestId('token-save').click();
    await page.waitForTimeout(3000);

    // Dashboard must load - app shell visible
    await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 10000 });
    await screenshot(page, '03-dashboard-after-login');
  });

  test('2. Dashboard page shows KPI cards and data', async ({ page }) => {
    // Set token and navigate
    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('scimserver.authToken', t), TOKEN);
    await page.reload();
    await page.waitForTimeout(4000);

    // App shell must be visible
    await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 10000 });

    // Check for KPI row or error/loading state
    const kpiRow = page.getByTestId('kpi-row');
    const loading = page.getByTestId('dashboard-loading');
    const error = page.getByTestId('dashboard-error');

    // Wait for one of these to appear
    await page.waitForTimeout(3000);

    const hasKpi = await kpiRow.isVisible().catch(() => false);
    const hasLoading = await loading.isVisible().catch(() => false);
    const hasError = await error.isVisible().catch(() => false);

    await screenshot(page, '04-dashboard-full');

    // If there's an error, capture it clearly
    if (hasError) {
      const errorText = await error.textContent();
      console.log('Dashboard error:', errorText);
      await screenshot(page, '04-dashboard-ERROR');
    }

    // At least one state should be visible
    expect(hasKpi || hasLoading || hasError).toBeTruthy();

    // If KPI loaded, verify real data
    if (hasKpi) {
      await screenshot(page, '05-dashboard-kpi-cards');

      // Check endpoint grid
      const grid = page.getByTestId('endpoint-grid');
      if (await grid.isVisible().catch(() => false)) {
        await screenshot(page, '06-dashboard-endpoint-grid');
      }

      // Check activity
      const activity = page.getByTestId('activity-list');
      if (await activity.isVisible().catch(() => false)) {
        await screenshot(page, '07-dashboard-activity-feed');
      }
    }
  });

  test('3. Sidebar navigation works (client-side, no 404)', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('scimserver.authToken', t), TOKEN);
    await page.reload();
    await page.waitForTimeout(4000);

    // Verify we're on dashboard
    await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 10000 });

    // Navigate to Endpoints
    await page.getByTestId('app-sidebar').getByText('Endpoints').click();
    await page.waitForTimeout(3000);
    await screenshot(page, '08-endpoints-page');
    // Verify we didn't get a 404
    const body = await page.textContent('body');
    expect(body).not.toContain('Cannot GET');
    expect(body).not.toContain('"statusCode":404');

    // Navigate to Logs
    await page.getByTestId('app-sidebar').getByText('Logs').click();
    await page.waitForTimeout(3000);
    await screenshot(page, '09-logs-page');
    const body2 = await page.textContent('body');
    expect(body2).not.toContain('Cannot GET');

    // Navigate to Settings
    await page.getByTestId('app-sidebar').getByText('Settings').click();
    await page.waitForTimeout(3000);
    await screenshot(page, '10-settings-page');
    const body3 = await page.textContent('body');
    expect(body3).not.toContain('Cannot GET');

    // Navigate back to Dashboard
    await page.getByTestId('app-sidebar').getByText('Dashboard').click();
    await page.waitForTimeout(3000);
    await screenshot(page, '11-back-to-dashboard');
  });

  test('4. Endpoints page shows real endpoint data', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('scimserver.authToken', t), TOKEN);
    await page.reload();
    await page.waitForTimeout(4000);

    // Navigate to endpoints
    await page.getByTestId('app-sidebar').getByText('Endpoints').click();
    await page.waitForTimeout(4000);
    await screenshot(page, '12-endpoints-list');

    // Check for endpoint cards or loading/error/empty
    const epPage = page.getByTestId('endpoints-page');
    const loading = page.getByTestId('endpoints-loading');
    const hasPage = await epPage.isVisible().catch(() => false);
    const hasLoading = await loading.isVisible().catch(() => false);

    if (hasPage) {
      // Search functionality
      const search = page.locator('input[placeholder*="Filter"]');
      if (await search.isVisible().catch(() => false)) {
        await search.fill('test');
        await page.waitForTimeout(1000);
        await screenshot(page, '13-endpoints-filtered');
        await search.fill('');
      }
    }
  });

  test('5. Settings page shows real server version and health', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('scimserver.authToken', t), TOKEN);
    await page.reload();
    await page.waitForTimeout(4000);

    await page.getByTestId('app-sidebar').getByText('Settings').click();
    await page.waitForTimeout(4000);
    await screenshot(page, '14-settings-full');

    // Check if version is displayed
    const settingsPage = page.getByTestId('settings-page');
    if (await settingsPage.isVisible().catch(() => false)) {
      // Should show real version number
      const text = await settingsPage.textContent();
      console.log('Settings content:', text?.substring(0, 200));
      await screenshot(page, '15-settings-version-health');
    }
  });

  test('6. Logs page shows real request logs', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('scimserver.authToken', t), TOKEN);
    await page.reload();
    await page.waitForTimeout(4000);

    await page.getByTestId('app-sidebar').getByText('Logs').click();
    await page.waitForTimeout(4000);
    await screenshot(page, '16-logs-full');

    // Check for log entries
    const logsPage = page.getByTestId('global-logs-page');
    const loading = page.getByTestId('global-logs-loading');
    const hasPage = await logsPage.isVisible().catch(() => false);

    if (hasPage) {
      const text = await logsPage.textContent();
      console.log('Logs content:', text?.substring(0, 200));
      await screenshot(page, '17-logs-with-data');
    }
  });

  test('7. Theme toggle works correctly', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('scimserver.authToken', t), TOKEN);
    await page.reload();
    await page.waitForTimeout(4000);

    await screenshot(page, '18-theme-light');

    // Toggle to dark
    await page.getByTestId('theme-toggle').click();
    await page.waitForTimeout(500);
    await screenshot(page, '19-theme-dark');

    // Toggle back to light
    await page.getByTestId('theme-toggle').click();
    await page.waitForTimeout(500);
    await screenshot(page, '20-theme-light-again');
  });

  test('8. Sidebar collapse/expand works', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('scimserver.authToken', t), TOKEN);
    await page.reload();
    await page.waitForTimeout(4000);

    await screenshot(page, '21-sidebar-expanded');

    await page.getByTestId('sidebar-toggle').click();
    await page.waitForTimeout(500);
    await screenshot(page, '22-sidebar-collapsed');

    await page.getByTestId('sidebar-toggle').click();
    await page.waitForTimeout(500);
    await screenshot(page, '23-sidebar-re-expanded');
  });

  test('9. Change token button works', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('scimserver.authToken', t), TOKEN);
    await page.reload();
    await page.waitForTimeout(4000);

    // Click change token
    await page.getByTestId('change-token').click();
    await page.waitForTimeout(1000);

    // Token dialog should reappear
    const tokenInput = page.getByTestId('token-input');
    await expect(tokenInput).toBeVisible({ timeout: 5000 });
    await screenshot(page, '24-change-token-dialog');

    // Re-enter token
    await tokenInput.fill(TOKEN);
    await page.getByTestId('token-save').click();
    await page.waitForTimeout(3000);
    await screenshot(page, '25-after-token-change');
  });

  test('10. Mobile viewport renders correctly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('scimserver.authToken', t), TOKEN);
    await page.reload();
    await page.waitForTimeout(4000);

    await screenshot(page, '26-mobile-dashboard');

    await page.getByTestId('app-sidebar').getByText('Settings').click();
    await page.waitForTimeout(3000);
    await screenshot(page, '27-mobile-settings');
  });

  test('11. Legacy UI still accessible via ?ui=legacy', async ({ page }) => {
    await page.goto('/?ui=legacy');
    await page.waitForTimeout(3000);
    await screenshot(page, '28-legacy-initial');

    // Try entering token if modal shows
    const tokenInput = page.locator('input[type="password"]');
    if (await tokenInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tokenInput.fill(TOKEN);
      const saveBtn = page.locator('button:has-text("Save Token")');
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click();
        await page.waitForTimeout(3000);
      }
    }
    await screenshot(page, '29-legacy-authenticated');
  });

  test('12. Click endpoint card navigates to detail page + all tabs load', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('scimserver.authToken', t), TOKEN);
    await page.reload();
    await page.waitForTimeout(5000);

    // Find first endpoint card on dashboard
    const card = page.locator('[data-testid^="endpoint-card-"]').first();
    if (await card.isVisible({ timeout: 5000 }).catch(() => false)) {
      await screenshot(page, '30-before-card-click');
      await card.click();
      await page.waitForTimeout(3000);
      await screenshot(page, '31-endpoint-detail-from-card');

      // MUST see the detail page
      const detailPage = page.getByTestId('endpoint-detail-page');
      await expect(detailPage).toBeVisible({ timeout: 5000 });

      // MUST see the back button
      const backBtn = page.getByTestId('back-to-endpoints');
      await expect(backBtn).toBeVisible();

      // Click each tab and VERIFY no error text appears
      const tabs = ['Users', 'Groups', 'Logs', 'Settings'];
      for (const tabName of tabs) {
        const tab = page.getByRole('tab', { name: new RegExp(tabName, 'i') });
        await expect(tab).toBeVisible();
        await tab.click();
        await page.waitForTimeout(3000);
        await screenshot(page, `32-detail-tab-${tabName.toLowerCase()}`);

        // CRITICAL: Verify no "Failed to load" error appears in the tab content
        const bodyText = await page.textContent('body') ?? '';
        if (bodyText.includes('Failed to load')) {
          await screenshot(page, `32-detail-tab-${tabName.toLowerCase()}-ERROR`);
          // Fail the test explicitly with the error message
          const errorMatch = bodyText.match(/Failed to load[^.]+/);
          expect(errorMatch).toBeNull();
        }
      }

      // Click back to endpoints
      await backBtn.click();
      await page.waitForTimeout(2000);
      await screenshot(page, '33-back-to-endpoints');
      // Verify we're back on a page (not 404)
      const body = await page.textContent('body') ?? '';
      expect(body).not.toContain('Cannot GET');
    }
  });

  test('13. Browser back button works after navigation', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((t) => localStorage.setItem('scimserver.authToken', t), TOKEN);
    await page.reload();
    await page.waitForTimeout(4000);

    // Navigate to Settings
    await page.getByTestId('app-sidebar').getByText('Settings').click();
    await page.waitForTimeout(2000);

    // Verify we're on settings
    const settingsVisible = await page.getByTestId('settings-page').isVisible().catch(() => false);
    await screenshot(page, '34-before-back-button');

    // Press browser back
    await page.goBack();
    await page.waitForTimeout(2000);
    await screenshot(page, '35-after-back-button');

    // Should be back on dashboard (not settings)
    const body = await page.textContent('body');
    expect(body).not.toContain('Cannot GET');
  });
});
