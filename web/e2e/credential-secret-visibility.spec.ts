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
      window.localStorage.setItem('scimserver.onboarding.completedAt', '2026-09-24T00:00:00.000Z');
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

test.describe('SettingsTab - credential and request-log secret policy', () => {
  test('credential retention and request-log redaction are fixed safe policies', async ({ page }) => {
    await openFirstEndpointSettings(page);
    await expect(page.getByTestId('settings-credential-visibility')).toBeVisible();
    await expect(page.getByTestId('credential-visibility-always')).toContainText('retain encrypted');
    await expect(page.getByTestId('credential-visibility-once')).toHaveCount(0);
    await expect(page.getByTestId('settings-persist-request-secrets-redacted')).toContainText('always redacted');
    await expect(page.getByRole('switch', { name: /PersistRequestSecrets/i })).toHaveCount(0);
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

  test('the runtime-egress card displays all authoritative values, units, sources, and bounds', async ({ page }) => {
    await openFirstEndpointSettings(page);
    await expect(page.getByTestId('settings-number-settings')).toBeVisible();

    const response = await page.request.get(
      `/scim/admin/endpoints/${fixtureEndpointId}/egress-policy`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    expect(response.ok()).toBe(true);
    const effective = await response.json() as Record<string, {
      effective: number;
      source: 'endpoint' | 'server-env' | 'default';
      unit: 'ms' | 'bytes' | 'count';
      min: number;
      max: number;
    }>;

    const fields: Record<string, string> = {
      JwksFetchTimeoutMs: 'timeoutMs',
      JwksFetchRetries: 'retries',
      JwksFetchRetryBackoffMs: 'retryBackoffMs',
      JwksCacheMaxAgeMs: 'cacheMaxAgeMs',
      JwksTotalDeadlineMs: 'totalDeadlineMs',
      JwksMaxResponseBytes: 'maxResponseBytes',
      JwksMaxKeys: 'maxKeys',
      JwksMaxCacheEntries: 'maxCacheEntries',
      JwksRefreshIntervalMs: 'refreshIntervalMs',
      JwksUnknownKidMinIntervalMs: 'unknownKidMinIntervalMs',
      JwksStaleIfErrorMs: 'staleIfErrorMs',
    };
    const sourceLabel = { endpoint: 'Endpoint override', 'server-env': 'Server environment', default: 'Built-in default' };
    for (const [key, fieldName] of Object.entries(fields)) {
      const field = effective[fieldName];
      const input = page.getByTestId(`settings-number-${key}-input`);
      await expect(input).toBeVisible();
      await expect(input).toHaveValue(String(field.effective));
      await expect(input).toHaveAttribute('min', String(field.min));
      await expect(input).toHaveAttribute('max', String(field.max));
      await expect(page.getByTestId(`settings-number-${key}-effective`)).toContainText(
        `Effective: ${field.effective} ${field.unit}`,
      );
      await expect(page.getByTestId(`settings-number-${key}-source`)).toContainText(sourceLabel[field.source]);
    }
  });
});
