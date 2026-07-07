/**
 * credential-reveal.spec.ts - exercises the WI-8 reveal affordance on the
 * CredentialsTab and the server security-settings card on the Settings page.
 *
 * USER PATHS COVERED
 *   /endpoints -> first card -> /endpoints/$id/credentials -> if the endpoint
 *   has a retained-secret-capable credential, a "Reveal" button is present.
 *   /settings -> the "Credential security (server)" card renders the server
 *   visibility radio group + the KEK status line.
 *
 * SAFETY
 *   READ-ONLY. The credentials test only asserts the Reveal button renders (it
 *   does not click it, so no secret is surfaced in CI logs). The settings test
 *   asserts the card + current value without mutating the server setting. The
 *   reveal round-trip is covered by the API E2E + live-test 9z-AT10.
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

async function openFirstEndpointCredentials(page: Page): Promise<void> {
  await page.goto('/endpoints');
  await expect(page.getByTestId('endpoints-page')).toBeVisible({ timeout: 30_000 });
  const cards = page.locator('[data-testid^="endpoint-"]').filter({
    hasNot: page.locator('[data-testid^="endpoint-detail"]'),
  });
  test.skip((await cards.count()) === 0, 'Tenant has zero endpoints.');
  const first = cards.first();
  const cardTestId = (await first.getAttribute('data-testid')) ?? '';
  const endpointId = cardTestId.replace(/^endpoint-/, '');
  await first.click();
  await expect(page.getByTestId('endpoint-detail-page')).toBeVisible({ timeout: 30_000 });
  await page.goto(`/endpoints/${endpointId}/credentials`);
  await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });
}

test.describe('WI-8 - credential reveal + server security settings', () => {
  test('the server security-settings card renders on the Settings page', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('settings-page')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('security-settings-card')).toBeVisible({ timeout: 30_000 });
    // The server visibility radio group + KEK status line render.
    await expect(page.getByTestId('security-visibility-always')).toBeVisible();
    await expect(page.getByTestId('security-visibility-once')).toBeVisible();
    await expect(page.getByTestId('security-kek-status')).toBeVisible();
  });

  test('the KEK status line reports whether the KEK is the default', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('security-settings-card')).toBeVisible({ timeout: 30_000 });
    const kek = page.getByTestId('security-kek-status');
    // Either "default" or "configured" wording is present; the value is never shown.
    await expect(kek).toContainText(/default|configured/i);
  });

  test('the credentials tab renders (reveal button appears for retained credentials)', async ({ page }) => {
    await openFirstEndpointCredentials(page);
    // The tab renders; a Reveal button is present only when a retained-capable
    // credential exists. We assert the tab loaded; the button is conditional.
    await expect(page.getByTestId('tab-credentials')).toBeVisible();
    const revealButtons = page.locator('[data-testid^="credential-reveal-"]');
    // If any exist, they must be enabled buttons (not asserting count > 0 since
    // a fresh endpoint may have none).
    const count = await revealButtons.count();
    if (count > 0) {
      await expect(revealButtons.first()).toBeEnabled();
    }
  });
});
