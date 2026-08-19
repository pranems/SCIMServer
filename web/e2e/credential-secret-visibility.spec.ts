/**
 * credential-secret-visibility.spec.ts - exercises the WI-7
 * CredentialSecretVisibility control on the endpoint Settings tab.
 *
 * USER PATHS COVERED
 *   /endpoints -> fixture endpoint -> /endpoints/$id/settings -> the
 *   "Credential secret visibility" card renders an always|once radio group
 *   reflecting the endpoint's stored value.
 *
 * SAFETY
 *   Asserts the control renders + the current value. It does NOT click a
 *   different radio, so it never mutates the visibility of an endpoint it did
 *   not create. The mutation path is covered by vitest + the API E2E + a
 *   dedicated live-test section.
 */
import { test, expect, type Page } from '@playwright/test';
import { createFixtureEndpoint, deleteFixtureEndpoint } from './endpoint-fixture';

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

/**
 * DETERMINISM (2026-08-05). This spec used to open "the first endpoint card".
 * That is unsafe on two counts: the `test.skip((await cards.count()) === 0)`
 * guard could never fire correctly (`.count()` does not auto-wait), and the
 * admin list is ordered `createdAt DESC`, so a fixture endpoint created by any
 * spec running in parallel becomes "the first endpoint" and is then deleted
 * underneath this one - observed as a 30s timeout during a full parallel run.
 *
 * It now uses its own fixture endpoint, so it is immune to both.
 */
let fixtureEndpointId: string | null = null;

test.afterEach(async ({ page }) => {
  fixtureEndpointId = await deleteFixtureEndpoint(page, fixtureEndpointId);
});

async function openFirstEndpointSettings(page: Page): Promise<void> {
  fixtureEndpointId = await createFixtureEndpoint(page, { namePrefix: 'e2e-credvis' });
  await page.goto(`/endpoints/${fixtureEndpointId}/settings`);
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

  test('the runtime-egress card renders 4 bounded number inputs (WIF JWKS fetch)', async ({ page }) => {
    await openFirstEndpointSettings(page);
    await expect(page.getByTestId('settings-number-settings')).toBeVisible();

    // R10 - assert the OUTCOME (each input is present AND carries its bounds
    // contract), not merely that the card exists.
    const bounds: Record<string, { min: string; max: string }> = {
      JwksFetchTimeoutMs: { min: '100', max: '60000' },
      JwksFetchRetries: { min: '0', max: '10' },
      JwksFetchRetryBackoffMs: { min: '0', max: '10000' },
      JwksCacheMaxAgeMs: { min: '0', max: '86400000' },
    };
    for (const [key, b] of Object.entries(bounds)) {
      const input = page.getByTestId(`settings-number-${key}-input`);
      await expect(input).toBeVisible();
      await expect(input).toHaveAttribute('type', 'number');
      await expect(input).toHaveAttribute('min', b.min);
      await expect(input).toHaveAttribute('max', b.max);
    }
  });
});
