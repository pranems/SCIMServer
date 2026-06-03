/**
 * Visual regression screenshots for all UI states.
 *
 * Captures every page in both themes at desktop viewport.
 * Screenshots stored in test-results/ui-screenshots/ for visual diff review.
 */
import { test as base, expect } from '@playwright/test';
import { saveScreenshot } from './fixtures';

const test = base.extend<{}>({});

test.beforeEach(async ({ page }) => {
  const token = process.env.E2E_TOKEN || 'changeme-scim';
  await page.addInitScript(
    ({ key, value }) => {
      try { window.localStorage.setItem(key, value); } catch {}
    },
    { key: 'scimserver.authToken', value: token },
  );
  await page.goto('/');
  await page.evaluate((t) => localStorage.setItem('scim_token', t), token);
});

const PAGES = [
  { name: 'dashboard', path: '/' },
  { name: 'endpoints', path: '/endpoints' },
  { name: 'logs', path: '/logs' },
  { name: 'settings', path: '/settings' },
];

test.describe('Visual Snapshots - Light Theme', () => {
  for (const { name, path } of PAGES) {
    test(`captures ${name} page in light theme`, async ({ page }) => {
      await page.evaluate(() => localStorage.setItem('scim-color-scheme', 'light'));
      await page.goto(path);
      await page.waitForTimeout(3000);
      await saveScreenshot(page, `40-visual-light-${name}`);
    });
  }
});

test.describe('Visual Snapshots - Dark Theme', () => {
  for (const { name, path } of PAGES) {
    test(`captures ${name} page in dark theme`, async ({ page }) => {
      await page.evaluate(() => localStorage.setItem('scim-color-scheme', 'dark'));
      await page.goto(path);
      await page.waitForTimeout(3000);
      await saveScreenshot(page, `41-visual-dark-${name}`);
    });
  }
});

test.describe('Visual Snapshots - Sidebar States', () => {
  test('sidebar expanded vs collapsed comparison', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);
    await saveScreenshot(page, '42a-visual-sidebar-expanded');

    await page.getByTestId('sidebar-toggle').click();
    await page.waitForTimeout(500);
    await saveScreenshot(page, '42b-visual-sidebar-collapsed');
  });
});

test.describe('Visual Snapshots - Error States', () => {
  test('captures dashboard with no auth (error state)', async ({ page }) => {
    await page.evaluate(() => localStorage.removeItem('scim_token'));
    await page.goto('/');
    await page.waitForTimeout(3000);
    await saveScreenshot(page, '43-visual-error-no-auth');
  });
});

test.describe('Visual Snapshots - Legacy UI', () => {
  test('captures legacy UI for comparison', async ({ page }) => {
    const token = process.env.E2E_TOKEN || 'local-secret';
    await page.goto('/?ui=legacy');
    const tokenInput = page.getByRole('textbox', { name: /S3cret/i });
    if (await tokenInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await tokenInput.fill(token);
      await page.getByRole('button', { name: 'Save Token' }).click();
      await page.waitForTimeout(2000);
    }
    await saveScreenshot(page, '44-visual-legacy-default');

    // Capture each legacy tab
    const tabs = ['database', 'logs', 'manual'];
    for (const tabName of tabs) {
      const tab = page.getByRole('button', { name: new RegExp(tabName, 'i') });
      if (await tab.isVisible().catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(2000);
        await saveScreenshot(page, `44-visual-legacy-${tabName}`);
      }
    }
  });
});
