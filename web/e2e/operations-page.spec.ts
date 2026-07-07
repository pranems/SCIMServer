/**
 * operations-page.spec.ts - exercises the cross-endpoint Operations page
 * (/operations), which had vitest but no Playwright coverage.
 *
 * USER PATHS COVERED
 *   /operations -> the three sub-tabs (All users | All groups | Statistics)
 *   render and switch. The All-users tab exposes a search box, an active-only
 *   switch, a CSV download, and pagination; the Statistics tab renders its
 *   database-statistics surface with a CSV export.
 *
 * SAFETY
 *   READ-ONLY. Operations aggregates cross-endpoint reads; the spec never
 *   mutates anything (it toggles the client-side active-only filter + switches
 *   tabs). It asserts controls exist without depending on specific data rows.
 */
import { test, expect, type Page } from '@playwright/test';

const TOKEN_STORAGE_KEY = 'scimserver.authToken';
const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: TOKEN_STORAGE_KEY, value: TOKEN },
  );
});

async function openOperations(page: Page): Promise<void> {
  await page.goto('/operations');
  await expect(page.getByTestId('operations-page')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('operations-subtabs')).toBeVisible({ timeout: 30_000 });
}

test.describe('Operations (/operations)', () => {
  test('the page renders the three sub-tabs', async ({ page }) => {
    await openOperations(page);
    await expect(page.getByTestId('operations-tab-users')).toBeVisible();
    await expect(page.getByTestId('operations-tab-groups')).toBeVisible();
    await expect(page.getByTestId('operations-tab-statistics')).toBeVisible();
  });

  test('the All-users tab exposes search, active-only, and CSV download', async ({ page }) => {
    await openOperations(page);
    await page.getByTestId('operations-tab-users').click();
    await expect(page.getByTestId('operations-users-search')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('operations-users-active-only')).toBeVisible();
    await expect(page.getByTestId('operations-users-download-csv')).toBeVisible();
  });

  test('toggling the active-only switch does not break the users list', async ({ page }) => {
    await openOperations(page);
    await page.getByTestId('operations-tab-users').click();
    const activeOnly = page.getByTestId('operations-users-active-only');
    await expect(activeOnly).toBeVisible({ timeout: 20_000 });
    await activeOnly.click();
    // The page stays healthy (root + subtabs still present) after the toggle.
    await expect(page.getByTestId('operations-page')).toBeVisible();
    await expect(page.getByTestId('operations-users-search')).toBeVisible();
  });

  test('the All-groups tab exposes search + CSV download', async ({ page }) => {
    await openOperations(page);
    await page.getByTestId('operations-tab-groups').click();
    await expect(page.getByTestId('operations-groups-search')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('operations-groups-download-csv')).toBeVisible();
  });

  test('the Statistics tab renders KPI tiles + a CSV export', async ({ page }) => {
    await openOperations(page);
    await page.getByTestId('operations-tab-statistics').click();
    // The users-total KPI tile is the primary content signal once stats load.
    await expect(page.getByTestId('operations-stat-users-total')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('operations-stats-download-csv')).toBeVisible();
  });
});
