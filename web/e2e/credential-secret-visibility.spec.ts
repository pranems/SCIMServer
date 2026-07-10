/**
 * credential-secret-visibility.spec.ts - exercises the WI-7
 * CredentialSecretVisibility control on the endpoint Settings tab.
 *
 * USER PATHS COVERED
 *   /endpoints -> first card -> /endpoints/$id/settings -> the
 *   "Credential secret visibility" card renders an always|once radio group
 *   reflecting the endpoint's stored value.
 *
 * SAFETY
 *   READ-ONLY by default (asserts the control renders + the current value). It
 *   does NOT click a different radio, so it never mutates the endpoint's stored
 *   visibility. The mutation path is covered by vitest + the API E2E + a
 *   dedicated live-test section.
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

async function openFirstEndpointSettings(page: Page): Promise<void> {
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

  await page.goto(`/endpoints/${endpointId}/settings`);
  await expect(page.getByTestId('settings-tab')).toBeVisible({ timeout: 30_000 });
}

test.describe('SettingsTab - CredentialSecretVisibility (WI-7)', () => {
  test('the credential-visibility card renders an always|once radio group', async ({ page }) => {
    await openFirstEndpointSettings(page);
    await expect(page.getByTestId('settings-credential-visibility')).toBeVisible();
    await expect(page.getByTestId('credential-visibility-always')).toBeVisible();
    await expect(page.getByTestId('credential-visibility-once')).toBeVisible();
  });

  test('exactly one visibility value is selected (defaults to always)', async ({ page }) => {
    await openFirstEndpointSettings(page);
    const always = page.getByTestId('credential-visibility-always');
    const once = page.getByTestId('credential-visibility-once');
    const alwaysChecked = await always.isChecked();
    const onceChecked = await once.isChecked();
    // Exactly one is checked.
    expect(alwaysChecked !== onceChecked).toBe(true);
  });

  test('settings are grouped into category cards + enum settings render as Dropdowns', async ({ page }) => {
    await openFirstEndpointSettings(page);
    // Related-category cards render.
    await expect(page.getByTestId('settings-category-authentication-methods')).toBeVisible();
    await expect(page.getByTestId('settings-category-validation-schema')).toBeVisible();
    // Multi-option settings render as Dropdowns (not read-only badges).
    await expect(page.getByTestId('settings-enum-PrimaryEnforcement-dropdown')).toBeVisible();
    await expect(page.getByTestId('settings-enum-logLevel-dropdown')).toBeVisible();
    // Settings JSON export affordances present.
    await expect(page.getByTestId('settings-tab-export-copy')).toBeVisible();
    await expect(page.getByTestId('settings-tab-export-download')).toBeVisible();
  });
});
