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
    // Settings JSON export affordances (Copy + Download).
    await expect(page.getByTestId('security-settings-export-copy')).toBeVisible();
    await expect(page.getByTestId('security-settings-export-download')).toBeVisible();
    // R4b: the SCIMServer-level connection info card shows the global URLs.
    await expect(page.getByTestId('server-connection-info-card')).toBeVisible();
    await expect(page.getByTestId('server-conn-token-endpoint')).toContainText('/scim/oauth/token');
  });

  test('the KEK status line reports whether the KEK is the default', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByTestId('security-settings-card')).toBeVisible({ timeout: 30_000 });
    const kek = page.getByTestId('security-kek-status');
    // Either "default" or "configured" wording is present; the value is never shown.
    await expect(kek).toContainText(/default|configured/i);
  });

  test('the credentials tab renders (reveal is in the card overflow menu for retained credentials)', async ({ page }) => {
    await openFirstEndpointCredentials(page);
    // The tab renders; W7 - Reveal now lives in each card's overflow menu, shown
    // only for a retained-capable credential.
    await expect(page.getByTestId('tab-credentials')).toBeVisible();
    const moreButtons = page.locator('[data-testid^="credential-more-"]');
    if ((await moreButtons.count()) > 0) {
      await moreButtons.first().click();
      const revealButtons = page.locator('[data-testid^="credential-reveal-"]');
      if ((await revealButtons.count()) > 0) {
        await expect(revealButtons.first()).toBeEnabled();
      }
    }
  });

  test('a Rotate item accompanies each retained-capable credential in the overflow menu', async ({ page }) => {
    await openFirstEndpointCredentials(page);
    await expect(page.getByTestId('tab-credentials')).toBeVisible();
    const moreButtons = page.locator('[data-testid^="credential-more-"]');
    test.skip((await moreButtons.count()) === 0, 'No per-endpoint credential cards on the first endpoint.');
    await moreButtons.first().click();
    // W7 - Reveal + Rotate are shown together for the same credential (both
    // secret-bearing, active, non-wif), so their counts match in the open menu.
    const rotateButtons = page.locator('[data-testid^="credential-rotate-"]');
    const revealButtons = page.locator('[data-testid^="credential-reveal-"]');
    expect(await rotateButtons.count()).toBe(await revealButtons.count());
    if ((await rotateButtons.count()) > 0) {
      await expect(rotateButtons.first()).toBeEnabled();
    }
  });
});

/**
 * R7 - creating an OAuth2 client credential shows the readable
 * client-id-<endpointId> + client-secret-<uuid> pair, each copyable, plus a
 * copy-all-as-JSON blob. Route-mocked so it is deterministic and mints nothing
 * on the server.
 */
const EP_R7 = 'ep-r7-oauth';

test.describe('Credentials tab - OAuth2 client create (R7)', () => {
  test('shows client-id + client-secret + copy-as-JSON after an oauth_client create', async ({ page }) => {
    const ID = EP_R7;
    // Endpoint detail shell.
    await page.route(`**/scim/admin/endpoints/${ID}`, async (route) => {
      if (route.request().method() !== 'GET' || !route.request().url().endsWith(`/${ID}`)) return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: ID, name: 'r7', displayName: 'R7 OAuth', active: true,
          scimBasePath: `/scim/v2/endpoints/${ID}`, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
          profile: { schemas: [], resourceTypes: [], serviceProviderConfig: { documentationUri: '', patch: { supported: true } }, settings: { OAuthClientCredentialsAuthEnabled: 'True' } },
        }),
      });
    });
    await page.route('**/scim/admin/endpoints/*/overview', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          endpoint: { id: ID, name: 'r7', displayName: 'R7 OAuth', preset: 'rfc-standard', active: true, scimBasePath: `/scim/v2/endpoints/${ID}`, createdAt: '2026-01-01T00:00:00Z' },
          stats: { userCount: 0, activeUserCount: 0, groupCount: 0, activeGroupCount: 0, genericResourceCount: 0 },
          credentials: [],
          recentActivity: [],
          configFlags: { OAuthClientCredentialsAuthEnabled: true, PerEndpointCredentialsEnabled: true },
          connectionInfo: { endpointId: ID, displayName: 'R7 OAuth', urls: { scimBaseUrl: '', scimBaseUrlBare: '', tokenEndpoint: '', serviceProviderConfig: '', oauthMetadata: '' }, enabledMethods: [], disabledMethods: [] },
        }),
      });
    });
    // The create POST returns the R7-shaped oauth_client response.
    await page.route(`**/scim/admin/endpoints/${ID}/credentials`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'oauth-r7', endpointId: ID, credentialType: 'oauth_client', label: 'r7',
          active: true, createdAt: '2026-07-10T00:00:00Z', expiresAt: null,
          clientId: `client-id-${ID}`,
          clientSecret: 'client-secret-11111111-2222-3333-4444-555555555555',
        }),
      });
    });

    await page.goto(`/endpoints/${ID}/credentials`);
    await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('credentials-create-button').click();
    // Choose the OAuth2 client credentials type.
    const typeDropdown = page.getByTestId('credentials-type-dropdown');
    await typeDropdown.click();
    await page.getByRole('option', { name: /OAuth2 client credentials/i }).click();
    // Submit the create.
    await page.getByTestId('credentials-create-dialog').locator('button[type="submit"]').click();

    // R10: assert the RENDERED values + the JSON copy affordance.
    await expect(page.getByTestId('credentials-oauth-clientid')).toContainText(`client-id-${ID}`);
    await expect(page.getByTestId('credentials-oauth-clientsecret')).toContainText('client-secret-11111111-2222-3333-4444-555555555555');
    await expect(page.getByTestId('credentials-oauth-copy-json')).toBeVisible();
  });
});
