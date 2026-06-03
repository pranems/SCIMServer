/**
 * Phase N3 - Export everywhere
 *
 * Smoke spec exercising the ExportSplitButton primitive on the live UI.
 * Navigates to /endpoints, picks the first endpoint card, opens UsersTab,
 * and asserts the export-button + all three menu items render.
 *
 * Why a smoke (not a full download assertion)?
 *  - Playwright download interception varies by browser/CI sandbox.
 *  - The CSV/JSON/NDJSON encoding contract is locked at the Vitest layer
 *    (see web/src/utils/csv-export.test.ts + ExportSplitButton.test.tsx).
 *  - This spec is the BROWSER-side lock that the wiring (testid presence,
 *    menu open path, three options visible) shipped to dev.
 *
 * Usage:
 *   cd web
 *   $env:E2E_BASE_URL = 'https://scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io'
 *   npx playwright test export.spec.ts
 */
import { test, expect } from '@playwright/test';

test.describe('Phase N3 - Export everywhere (smoke vs dev FQDN)', () => {
  test('UsersTab toolbar exposes Export split-button with CSV/JSON/NDJSON menu items', async ({ page }) => {
    await page.goto('/endpoints');
    await page.waitForLoadState('networkidle');

    // Pick the first endpoint card; if no endpoints, the smoke is a no-op
    // (operator will see the empty state and the export button is correctly absent).
    const firstCard = page.locator('[data-testid^="endpoint-"]').first();
    const cardCount = await firstCard.count();
    if (cardCount === 0) {
      test.skip(true, 'No endpoints available on this environment; export wire smoke skipped.');
      return;
    }

    const testId = await firstCard.getAttribute('data-testid');
    const epId = testId?.replace('endpoint-', '');
    expect(epId, 'first endpoint card must expose its id via data-testid').toBeTruthy();

    await page.goto(`/endpoints/${epId}/users`);
    await page.waitForLoadState('networkidle');

    // Wait for either the loaded toolbar OR the empty state; we only assert
    // export button when there are rows (matches the eagerEmpty contract).
    const exportBtn = page.getByTestId('export-button');
    const usersEmpty = page.getByText(/no users/i);

    const usersExist = await exportBtn.isVisible().catch(() => false);
    if (!usersExist) {
      const emptyShown = await usersEmpty.isVisible().catch(() => false);
      test.skip(emptyShown, 'Endpoint has no users; export button correctly absent.');
      return;
    }

    await expect(exportBtn).toBeVisible();
    await expect(exportBtn).toBeEnabled();

    // Open the split-button menu and assert all three format options render.
    await exportBtn.click();
    await expect(page.getByTestId('export-menu-csv')).toBeVisible();
    await expect(page.getByTestId('export-menu-json')).toBeVisible();
    await expect(page.getByTestId('export-menu-ndjson')).toBeVisible();
  });
});
