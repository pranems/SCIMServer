/**
 * error-recovery.spec.ts - covers recoverable query failures as observed
 * through the real endpoint route.
 *
 * USER PATHS COVERED
 *   Navigating to a non-existent endpoint id triggers the
 *     EndpointDetailPage error branch (endpoint-detail-error
 *     testid) so the user sees a recoverable message rather than
 *     a blank page.
 *   The AppShell and sidebar remain usable while the endpoint page owns
 *     the query error.
 *   Navigation to Endpoints and Settings recovers without a reload.
 *   The upstream 4xx detail retains the invalid endpoint id.
 *
 * WHY THESE PATHS WERE NOT PREVIOUSLY COVERED
 *   - No existing spec drove a route query into its error state.
 *   - The vitest suite covered the pieces in isolation, but not the
 *     shell + page-owned error + recovery interaction.
 */
import { test, expect } from '@playwright/test';

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

test.describe('Endpoint query error recovery', () => {
  test('non-existent endpoint id keeps the shell and renders the page error', async ({ page }) => {
    const bogusId = 'this-endpoint-id-definitely-does-not-exist-xyz-12345';
    await page.goto(`/endpoints/${bogusId}`);

    await expect(page.getByTestId('app-shell')).toBeVisible();
    const error = page.getByTestId('endpoint-detail-error');
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error).toContainText(/failed to load endpoint/i);
    await expect(error).toContainText(/not found/i);
    await expect(page.getByTestId('route-boundary-error')).toHaveCount(0);
  });

  test('Endpoints navigation recovers from the page-owned error', async ({ page }) => {
    const bogusId = 'another-bogus-endpoint-id-xyz-67890';
    await page.goto(`/endpoints/${bogusId}`);
    await expect(page.getByTestId('endpoint-detail-error')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('nav-endpoints').click();
    await expect(page.getByTestId('endpoints-page')).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/endpoints\b(?!\/)/);
    await expect(page.getByTestId('endpoint-detail-error')).toHaveCount(0);
  });

  test('navigating away from an error route renders the next route cleanly', async ({ page }) => {
    const bogusId = 'recoverable-error-test-id-xyz-99999';
    await page.goto(`/endpoints/${bogusId}`);
    await expect(page.getByTestId('endpoint-detail-error')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('nav-settings').click();
    await expect(page.getByTestId('settings-page')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('endpoint-detail-error')).toHaveCount(0);
    await expect(page.getByTestId('route-boundary-error')).toHaveCount(0);
  });
});

test.describe('Endpoint error detail', () => {
  test('page-owned error surfaces the underlying SCIM 4xx detail', async ({ page }) => {
    const bogusId = 'scim-error-message-smoke-id-xyz-54321';
    await page.goto(`/endpoints/${bogusId}`);

    const error = page.getByTestId('endpoint-detail-error');
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error).toContainText(bogusId);
    await expect(error).toContainText(/not found/i);
  });
});
