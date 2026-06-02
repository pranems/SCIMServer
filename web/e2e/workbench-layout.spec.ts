/**
 * Phase Q4b - Workbench layout toggle.
 *
 * Browser-side regression coverage for the operator request to switch
 * request and response boxes between stacked and side-by-side layouts.
 *
 * This intentionally measures rendered bounds because visual layout must
 * be asserted in Playwright, not by CSS property checks alone.
 *
 * Run vs dev:
 *   $env:E2E_BASE_URL = 'https://scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io'
 *   $env:E2E_TOKEN    = 'changeme-scim'
 *   cd web
 *   npx playwright test e2e/workbench-layout.spec.ts --reporter=line
 */
import { test, expect } from '@playwright/test';

const TOKEN_STORAGE_KEY = 'scimserver.authToken';
const LAYOUT_STORAGE_KEY = 'scimserver:workbench:layout';
const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';

async function authenticate(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(
    ({ tokenKey, token }) => {
      window.localStorage.setItem(tokenKey, token);
    },
    { tokenKey: TOKEN_STORAGE_KEY, token: TOKEN },
  );
}

test.describe('Workbench layout toggle', () => {
  test('switches request and response cards between stacked and side-by-side layouts', async ({ page }) => {
    await authenticate(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.evaluate((layoutKey) => window.localStorage.removeItem(layoutKey), LAYOUT_STORAGE_KEY);
    await page.getByRole('link', { name: /workbench/i }).click();

    const wrapper = page.getByTestId('workbench-body-response-wrapper');
    const toggle = page.getByTestId('workbench-layout-toggle');
    const requestCard = page.getByTestId('workbench-body-card');
    const responseCard = page.getByTestId('workbench-response-card');

    await expect(wrapper).toHaveAttribute('data-layout', 'vertical');
    await expect(toggle).toHaveText(/side-by-side/i);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    const verticalRequest = await requestCard.boundingBox();
    const verticalResponse = await responseCard.boundingBox();
    expect(verticalRequest, 'request card must render in stacked mode').toBeTruthy();
    expect(verticalResponse, 'response card must render in stacked mode').toBeTruthy();
    expect((verticalResponse?.y ?? 0) > (verticalRequest?.y ?? 0)).toBe(true);
    expect(Math.abs((verticalResponse?.x ?? 0) - (verticalRequest?.x ?? 0))).toBeLessThanOrEqual(2);

    await toggle.click();

    await expect(wrapper).toHaveAttribute('data-layout', 'horizontal');
    await expect(toggle).toHaveText(/stacked/i);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    const horizontalRequest = await requestCard.boundingBox();
    const horizontalResponse = await responseCard.boundingBox();
    expect(horizontalRequest, 'request card must render in side-by-side mode').toBeTruthy();
    expect(horizontalResponse, 'response card must render in side-by-side mode').toBeTruthy();
    expect(Math.abs((horizontalResponse?.y ?? 0) - (horizontalRequest?.y ?? 0))).toBeLessThanOrEqual(5);
    expect((horizontalResponse?.x ?? 0) > (horizontalRequest?.x ?? 0)).toBe(true);
    expect(horizontalRequest?.width ?? 0).toBeGreaterThan(300);
    expect(horizontalResponse?.width ?? 0).toBeGreaterThan(300);

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: /workbench/i }).click();
    await expect(wrapper).toHaveAttribute('data-layout', 'horizontal');
  });
});
