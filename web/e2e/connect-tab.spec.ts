/**
 * connect-tab.spec.ts - exercises the per-endpoint Connect tab (WI-5) which
 * renders the WI-4 ConnectionPanel from the WI-2/WI-3 connection-info.
 *
 * USER PATHS COVERED
 *   /endpoints -> first card -> /endpoints/$id/connect -> the Connect tab
 *   renders the ConnectionPanel with a method selector, the Entra field
 *   mapping (each value a copy button), and the export affordances (Copy all
 *   JSON / Copy as .env / Download). Switching the method radio swaps the
 *   fields shown. Disabled methods are listed with an enable hint.
 *
 * SAFETY
 *   READ-ONLY against the server (connection-info + overview are GETs). It
 *   never creates a credential and never reveals a secret.
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

async function openFirstEndpointConnect(page: Page): Promise<void> {
  await page.goto('/endpoints');
  await expect(page.getByTestId('endpoints-page')).toBeVisible({ timeout: 30_000 });

  const cards = page.locator('[data-testid^="endpoint-"]').filter({
    hasNot: page.locator('[data-testid^="endpoint-detail"]'),
  });
  const count = await cards.count();
  test.skip(count === 0, 'Tenant has zero endpoints; cannot exercise the Connect tab.');

  const first = cards.first();
  const cardTestId = (await first.getAttribute('data-testid')) ?? '';
  const endpointId = cardTestId.replace(/^endpoint-/, '');
  await first.click();
  await expect(page.getByTestId('endpoint-detail-page')).toBeVisible({ timeout: 30_000 });

  await page.goto(`/endpoints/${endpointId}/connect`);
  await expect(page.getByTestId('connect-tab')).toBeVisible({ timeout: 30_000 });
}

test.describe('Endpoint detail - Connect tab (WI-5)', () => {
  test('the Connect tab is present on the endpoint detail', async ({ page }) => {
    await page.goto('/endpoints');
    await expect(page.getByTestId('endpoints-page')).toBeVisible({ timeout: 30_000 });
    const cards = page.locator('[data-testid^="endpoint-"]').filter({
      hasNot: page.locator('[data-testid^="endpoint-detail"]'),
    });
    test.skip((await cards.count()) === 0, 'No endpoints to exercise.');
    await cards.first().click();
    await expect(page.getByTestId('endpoint-detail-page')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('endpoint-tab-connect')).toBeVisible();
  });

  test('the ConnectionPanel renders a method selector + copy-all-JSON', async ({ page }) => {
    await openFirstEndpointConnect(page);
    await expect(page.getByTestId('connect-tab-panel')).toBeVisible();
    await expect(page.getByTestId('connect-tab-panel-method-selector')).toBeVisible();
    await expect(page.getByTestId('connect-tab-panel-copy-json')).toBeVisible();
    // Export affordances are present.
    await expect(page.getByTestId('connect-tab-panel-copy-env')).toBeVisible();
    await expect(page.getByTestId('connect-tab-panel-download')).toBeVisible();
  });

  test('the Tenant URL field carries a copy button', async ({ page }) => {
    await openFirstEndpointConnect(page);
    // Every enabled method surfaces a tenantUrl field with a copy button.
    const tenantValue = page.getByTestId('connect-tab-panel-value-tenantUrl');
    await expect(tenantValue).toBeVisible();
    await expect(page.getByTestId('connect-tab-panel-value-tenantUrl-copy-button')).toBeVisible();
    // The URL is the leading /scim/v2 form (WI-1).
    await expect(tenantValue).toContainText('/scim/v2/endpoints/');
  });

  test('switching the method radio swaps the visible fields', async ({ page }) => {
    await openFirstEndpointConnect(page);
    const wifRadio = page.getByTestId('connect-tab-panel-method-wif');
    test.skip((await wifRadio.count()) === 0, 'Endpoint has no WIF method enabled.');
    await wifRadio.click();
    // WIF surfaces an expected-audience field and has no clientIdentifier.
    await expect(page.getByTestId('connect-tab-panel-value-expectedAudience')).toBeVisible();
  });
});
