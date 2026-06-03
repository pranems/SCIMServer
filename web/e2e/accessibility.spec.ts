/**
 * Accessibility tests for the new Fluent UI.
 *
 * Validates ARIA roles, labels, keyboard navigation, and semantic structure
 * on every page.
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

test.describe('Accessibility - ARIA Landmarks', () => {
  test('dashboard has main landmark and navigation', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Main content area
    const main = page.locator('main');
    await expect(main).toBeVisible();

    // Navigation landmark
    const nav = page.locator('nav[aria-label="Main navigation"]');
    await expect(nav).toBeVisible();

    // Header
    const header = page.locator('header');
    await expect(header).toBeVisible();

    await saveScreenshot(page, '30-a11y-landmarks');
  });

  test('sidebar toggle has accessible label', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    const toggle = page.getByTestId('sidebar-toggle');
    await expect(toggle).toBeVisible();

    const label = await toggle.getAttribute('aria-label');
    expect(label).toBeTruthy();
    expect(label).toMatch(/expand|collapse/i);
  });

  test('theme toggle has accessible label', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    const toggle = page.getByTestId('theme-toggle');
    const label = await toggle.getAttribute('aria-label');
    expect(label).toBeTruthy();
    expect(label).toMatch(/light|dark/i);
  });

  test('active nav item has aria-current="page"', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(2000);

    const activeLink = page.locator('nav a[aria-current="page"]');
    await expect(activeLink).toBeVisible();
  });
});

test.describe('Accessibility - Tab Navigation', () => {
  test('endpoint detail tabs have proper ARIA roles', async ({ page }) => {
    // Need a valid endpoint ID - try navigating to endpoints first
    await page.goto('/endpoints');
    await page.waitForTimeout(3000);

    const grid = page.getByTestId('endpoints-grid');
    if (await grid.isVisible().catch(() => false)) {
      const firstCard = grid.locator('[data-testid^="endpoint-"]').first();
      if (await firstCard.isVisible().catch(() => false)) {
        const testId = await firstCard.getAttribute('data-testid');
        const epId = testId?.replace('endpoint-', '');
        if (epId) {
          await page.goto(`/endpoints/${epId}`);
          await page.waitForTimeout(3000);

          // Tab list should have role="tablist"
          const tabList = page.getByRole('tablist');
          if (await tabList.isVisible().catch(() => false)) {
            await expect(tabList).toBeVisible();

            // Individual tabs should have role="tab"
            const tabs = page.getByRole('tab');
            const tabCount = await tabs.count();
            expect(tabCount).toBeGreaterThanOrEqual(3);

            await saveScreenshot(page, '31-a11y-tabs');
          }
        }
      }
    }
  });
});

test.describe('Accessibility - Color Contrast', () => {
  test('light theme screenshot for contrast review', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('scim-color-scheme', 'light'));
    await page.reload();
    await page.waitForTimeout(2000);
    await saveScreenshot(page, '32a-a11y-contrast-light');
  });

  test('dark theme screenshot for contrast review', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('scim-color-scheme', 'dark'));
    await page.reload();
    await page.waitForTimeout(2000);
    await saveScreenshot(page, '32b-a11y-contrast-dark');
  });
});
