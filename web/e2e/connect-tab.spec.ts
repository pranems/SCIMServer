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

/**
 * R3 - the Connect tab ALWAYS displays a retained secret when the effective
 * credential secret visibility is `always`. Route-mocked so it is deterministic
 * and never touches a real credential: the overview returns an oauth_client
 * method carrying `secretRetained:true` + a `credentialId`, and the reveal
 * endpoint returns the retained secret.
 */
const EP_R3 = 'ep-connect-r3';

test.describe('Connect tab - retained secret reveal (R3)', () => {
  test('shows the retained oauth_client secret with the re-viewable note', async ({ page }) => {
    const ID = EP_R3;
    const base = `https://scim.example.com/scim/v2/endpoints/${ID}`;
    const overview = {
      endpoint: { id: ID, name: 'r3', displayName: 'R3 Connect', active: true },
      connectionInfo: {
        endpointId: ID,
        displayName: 'R3 Connect',
        urls: {
          scimBaseUrl: base,
          scimBaseUrlBare: `https://scim.example.com/scim/endpoints/${ID}`,
          tokenEndpoint: `https://scim.example.com/scim/endpoints/${ID}/oauth/token`,
          serviceProviderConfig: `${base}/ServiceProviderConfig`,
          oauthMetadata: `https://scim.example.com/scim/endpoints/${ID}/.well-known/oauth-authorization-server`,
        },
        enabledMethods: [
          {
            method: 'oauth_client',
            label: 'OAuth2 client credentials',
            entraAuthenticationMethod: 'OAuth2 Client Credentials Grant',
            entraFields: {
              tenantUrl: base,
              tokenEndpoint: `https://scim.example.com/scim/endpoints/${ID}/oauth/token`,
              clientIdentifier: `client-id-${ID}`,
              clientSecret: null,
            },
            clientSecretState: 'set-shown-once',
            credentialId: 'cred-r3',
            secretRetained: true,
          },
        ],
        disabledMethods: [],
      },
    };

    // The endpoint-detail shell fetches the endpoint GET before rendering the tab.
    await page.route(`**/scim/admin/endpoints/${ID}`, async (route) => {
      if (route.request().method() !== 'GET' || !route.request().url().endsWith(`/${ID}`)) return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: ID,
          name: 'r3',
          displayName: 'R3 Connect',
          active: true,
          scimBasePath: `/scim/v2/endpoints/${ID}`,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          profile: { schemas: [], resourceTypes: [], serviceProviderConfig: { documentationUri: '', patch: { supported: true } }, settings: {} },
        }),
      });
    });
    await page.route(`**/scim/admin/endpoints/${ID}/overview`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overview) });
    });
    await page.route(`**/scim/admin/endpoints/${ID}/credentials/cred-r3/reveal`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'cred-r3', credentialType: 'oauth_client', clientId: `client-id-${ID}`, clientSecret: 'retained-secret-r3', retained: true }),
      });
    });

    await page.goto(`/endpoints/${ID}/connect`);
    await expect(page.getByTestId('connect-tab')).toBeVisible({ timeout: 30_000 });
    // R10: assert the RENDERED secret value + the re-viewable note, not just presence.
    await expect(page.getByTestId('connect-tab-panel-value-clientSecret')).toContainText('retained-secret-r3');
    await expect(page.getByTestId('connect-tab-panel-secret-retained-note')).toBeVisible();
    // The one-time "copy now" warning must NOT show for a persistent reveal.
    await expect(page.getByTestId('connect-tab-panel-secret-warning')).toHaveCount(0);
    // R4: Entra-accurate labels + generic-IDP helper descriptions are present.
    await expect(page.getByTestId('connect-tab-panel-intro')).toContainText(/Entra/i);
    await expect(page.getByTestId('connect-tab-panel-desc-clientIdentifier')).toContainText(/Client ID/i);
  });
});
