/**
 * discovery-explorer.spec.ts - exercises the Discovery Explorer page
 * (/discovery), which had vitest but no Playwright coverage.
 *
 * USER PATHS COVERED
 *   /discovery -> primary endpoint picker -> the three discovery sub-tabs
 *   (ServiceProviderConfig | Resource types | Schemas) render, switch, and
 *   expose the copy/refetch affordances. The single-vs-compare toggle reveals
 *   the secondary picker for side-by-side diffing.
 *
 * SAFETY
 *   READ-ONLY. Discovery is all GETs (ServiceProviderConfig / ResourceTypes /
 *   Schemas); the spec never mutates anything. It skips gracefully when the
 *   tenant has zero endpoints.
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

async function openDiscovery(page: Page): Promise<boolean> {
  await page.goto('/discovery');
  await expect(page.getByTestId('discovery-page')).toBeVisible({ timeout: 30_000 });
  // Empty-tenant guard: the page renders a no-endpoints notice instead of the picker.
  const noEndpoints = page.getByTestId('discovery-no-endpoints');
  if (await noEndpoints.count()) {
    return false;
  }
  await expect(page.getByTestId('discovery-primary-picker')).toBeVisible({ timeout: 30_000 });
  // The discovery surfaces only render once a PRIMARY endpoint is picked
  // (otherwise the page shows a "Pick an endpoint to begin" empty state).
  // The picker does NOT auto-select, so click the first option to make the
  // ServiceProviderConfig / ResourceTypes / Schemas sections mount.
  const firstOption = page.locator('[data-testid^="discovery-primary-option-"]').first();
  if ((await firstOption.count()) === 0) {
    return false;
  }
  await firstOption.click();
  return true;
}

test.describe('Discovery Explorer (/discovery)', () => {
  test('the page renders the primary picker + the three sub-tabs', async ({ page }) => {
    const ready = await openDiscovery(page);
    test.skip(!ready, 'Tenant has zero endpoints; discovery has nothing to show.');
    await expect(page.getByTestId('discovery-subtabs')).toBeVisible();
    await expect(page.getByTestId('discovery-tab-serviceProviderConfig')).toBeVisible();
    await expect(page.getByTestId('discovery-tab-resourceTypes')).toBeVisible();
    await expect(page.getByTestId('discovery-tab-schemas')).toBeVisible();
  });

  test('the ServiceProviderConfig tab renders its section + copy affordances', async ({ page }) => {
    const ready = await openDiscovery(page);
    test.skip(!ready, 'Tenant has zero endpoints.');
    await page.getByTestId('discovery-tab-serviceProviderConfig').click();
    await expect(page.getByTestId('discovery-spc-section')).toBeVisible({ timeout: 20_000 });
    // The copy-as-JSON + refetch controls are present for the current surface.
    await expect(page.getByTestId('discovery-copy-json')).toBeVisible();
    await expect(page.getByTestId('discovery-refetch')).toBeVisible();
  });

  test('switching to the Resource types tab renders its section', async ({ page }) => {
    const ready = await openDiscovery(page);
    test.skip(!ready, 'Tenant has zero endpoints.');
    await page.getByTestId('discovery-tab-resourceTypes').click();
    await expect(page.getByTestId('discovery-resourcetypes-section')).toBeVisible({ timeout: 20_000 });
  });

  test('the compare toggle reveals the secondary endpoint picker', async ({ page }) => {
    const ready = await openDiscovery(page);
    test.skip(!ready, 'Tenant has zero endpoints.');
    const toggle = page.getByTestId('discovery-toggle-compare');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.getByTestId('discovery-secondary-picker')).toBeVisible({ timeout: 10_000 });
  });
});
