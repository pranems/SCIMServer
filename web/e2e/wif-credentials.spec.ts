/**
 * wif-credentials.spec.ts - exercises the Federated Identity (WIF)
 * section on the CredentialsTab (Q6.5).
 *
 * USER PATHS COVERED
 *   /endpoints -> first card -> /endpoints/$id/credentials -> the WIF
 *   section renders. Two branches by the endpoint's WifCredentialsEnabled flag:
 *     - flag OFF: the disabled banner shows and the inputs are hidden.
 *     - flag ON : the 4 Entra EditableFields + Save + Test Connection +
 *       Copy-as-JSON render; Test Connection produces a per-step result;
 *       the required-field gating disables Save until filled.
 *
 * SAFETY
 *   READ-ONLY against the server. It never clicks Save (which would
 *   create a `wif` credential); it only asserts the form renders and
 *   that the CLIENT-SIDE Test Connection dry-run works. Creating a WIF
 *   trust end-to-end is covered by the API E2E (wif-assertion.e2e-spec.ts)
 *   and the live-test section 9z-AT.
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
  const count = await cards.count();
  test.skip(count === 0, 'Tenant has zero endpoints; cannot exercise the WIF section.');

  const first = cards.first();
  const cardTestId = (await first.getAttribute('data-testid')) ?? '';
  const endpointId = cardTestId.replace(/^endpoint-/, '');
  await first.click();
  await expect(page.getByTestId('endpoint-detail-page')).toBeVisible({ timeout: 30_000 });

  // Deep-link straight to the credentials tab. The EndpointDetailPage uses
  // PATH-based child routes (`/endpoints/$id/credentials`), not a `?tab=`
  // search param - matching the proven pattern in endpoint-detail-tabs.spec.ts.
  await page.goto(`/endpoints/${endpointId}/credentials`);
  await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });
}

test.describe('CredentialsTab - Federated Identity (WIF) section', () => {
  test('the WIF section is always present on the credentials tab', async ({ page }) => {
    await openFirstEndpointCredentials(page);
    await expect(page.getByTestId('wif-section')).toBeVisible();
    await expect(page.getByText('Federated Identity (WIF)')).toBeVisible();
  });

  test('WIF section shows either the disabled banner or the input form', async ({ page }) => {
    await openFirstEndpointCredentials(page);

    const banner = page.getByTestId('wif-flag-disabled-banner');
    const issuer = page.getByTestId('wif-field-issuer');

    // Exactly one branch renders depending on the endpoint flag.
    const bannerVisible = await banner.isVisible().catch(() => false);
    if (bannerVisible) {
      await expect(banner).toBeVisible();
      await expect(issuer).toHaveCount(0);
    } else {
      // Flag is on: the form + actions render.
      await expect(issuer).toBeVisible();
      await expect(page.getByTestId('wif-field-subject')).toBeVisible();
      await expect(page.getByTestId('wif-field-audience')).toBeVisible();
      await expect(page.getByTestId('wif-field-jwks')).toBeVisible();
      await expect(page.getByTestId('wif-field-tenant')).toBeVisible();
      await expect(page.getByTestId('wif-save-button')).toBeVisible();
      await expect(page.getByTestId('wif-test-button')).toBeVisible();
      await expect(page.getByTestId('wif-copy-json')).toBeVisible();
    }
  });

  test('Test Connection renders a per-step readiness result when WIF is enabled', async ({ page }) => {
    await openFirstEndpointCredentials(page);

    const issuer = page.getByTestId('wif-field-issuer');
    const formVisible = await issuer.isVisible().catch(() => false);
    test.skip(!formVisible, 'WifCredentialsEnabled is off on this endpoint; the form is not rendered.');

    // Save is gated until the required fields are present.
    await expect(page.getByTestId('wif-save-button')).toBeDisabled();

    // Client-side Test Connection always renders a result block.
    await page.getByTestId('wif-test-button').click();
    await expect(page.getByTestId('wif-test-result')).toBeVisible();
    await expect(page.getByText('JWKS URI is https')).toBeVisible();
  });
});
