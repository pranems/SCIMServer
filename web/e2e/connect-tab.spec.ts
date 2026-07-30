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
  await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });
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

  test('W12: the ConnectionPanel is scoped to the shared-secret tab (no method selector)', async ({ page }) => {
    await openFirstEndpointConnect(page);
    const sharedTab = page.getByTestId('credentials-method-tab-shared_secret');
    test.skip((await sharedTab.count()) === 0, 'Endpoint has no shared-secret method.');
    await sharedTab.click();
    await expect(page.getByTestId('connect-tab-panel')).toBeVisible();
    await expect(page.getByTestId('connect-tab-panel-copy-json')).toBeVisible();
    // Export affordances are present.
    await expect(page.getByTestId('connect-tab-panel-copy-env')).toBeVisible();
    await expect(page.getByTestId('connect-tab-panel-download')).toBeVisible();
    // W11/W12 - the panel is scoped to the tab's method; no competing selector.
    await expect(page.getByTestId('connect-tab-panel-method-selector')).toHaveCount(0);
  });

  test('the Tenant URL field carries a copy button on the shared-secret panel', async ({ page }) => {
    await openFirstEndpointConnect(page);
    const sharedTab = page.getByTestId('credentials-method-tab-shared_secret');
    test.skip((await sharedTab.count()) === 0, 'Endpoint has no shared-secret method.');
    await sharedTab.click();
    // The shared-secret method surfaces a tenantUrl field with a copy button.
    const tenantValue = page.getByTestId('connect-tab-panel-value-tenantUrl');
    test.skip((await tenantValue.count()) === 0, 'Shared-secret panel has no tenantUrl field.');
    await expect(tenantValue).toBeVisible();
    await expect(page.getByTestId('connect-tab-panel-value-tenantUrl-copy-button')).toBeVisible();
    // The URL is the leading /scim/v2 form (WI-1).
    await expect(tenantValue).toContainText('/scim/v2/endpoints/');
  });

  test('W11: there is no "All" method tab', async ({ page }) => {
    await openFirstEndpointConnect(page);
    await expect(page.getByTestId('credentials-method-tabs')).toBeVisible();
    await expect(page.getByTestId('credentials-method-tab-all')).toHaveCount(0);
  });

  test('W3: the Connect header carries an endpoint-level export (copy + download all)', async ({ page }) => {
    await openFirstEndpointConnect(page);
    await expect(page.getByTestId('connect-endpoint-export')).toBeVisible();
    await expect(page.getByTestId('connect-endpoint-export-copy')).toBeVisible();
    await expect(page.getByTestId('connect-endpoint-export-download')).toBeVisible();
  });

  test('W4: selecting a method sub-tab reveals a per-method export', async ({ page }) => {
    await openFirstEndpointConnect(page);
    // Pick the first non-"All" method sub-tab present on this endpoint.
    const methodTab = page
      .locator('[data-testid^="credentials-method-tab-"]:not([data-testid="credentials-method-tab-all"])')
      .first();
    test.skip((await methodTab.count()) === 0, 'Endpoint has no per-method auth tabs enabled.');
    const tabTestId = (await methodTab.getAttribute('data-testid')) ?? '';
    const method = tabTestId.replace('credentials-method-tab-', '');
    await methodTab.click();
    await expect(page.getByTestId(`connect-method-export-${method}`)).toBeVisible();
    await expect(page.getByTestId(`connect-method-export-${method}-copy`)).toBeVisible();
    await expect(page.getByTestId(`connect-method-export-${method}-download`)).toBeVisible();
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
      // W11/W12 - enable the oauth_client method (so its tab + card render) and
      // carry the credential so its per-card Connect subpanel shows the secret.
      configFlags: { OAuthClientCredentialsAuthEnabled: true },
      credentials: [
        { id: 'cred-r3', credentialType: 'oauth_client', label: 'ISV client', active: true, createdAt: '2026-05-01T00:00:00Z', expiresAt: null, oauthClientId: `client-id-${ID}` },
      ],
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
    await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });
    // W8/W12 - the retained secret now shows in the per-card Connect subpanel
    // (the endpoint ConnectionPanel is shared-secret-only). The oauth_client tab
    // is the default (first per-endpoint method); open the card's Connect
    // subpanel - the auto-reveal returns the retained secret.
    await page.getByTestId('credential-connect-cred-r3').click();
    await expect(page.getByTestId('credential-connect-secret-cred-r3')).toContainText('retained-secret-r3');
    // W9/W10 - the subpanel header names the IdP (Entra as the example) and each
    // parameter carries an InfoLabel help affordance.
    await expect(page.getByTestId('credential-connect-panel-cred-r3')).toContainText(/Entra/i);
    await expect(page.getByTestId('credential-connect-clientid-info-cred-r3')).toBeVisible();
  });
});

/**
 * X2 - the per-endpoint BEARER credential's Connect subpanel shows its retained
 * Secret Token inline, exactly like the oauth_client client secret. The reveal
 * API returns a bearer secret in the `token` field (oauth_client uses
 * `clientSecret`); the regression this guards is the subpanel reading only
 * `clientSecret`, which left a retained bearer secret invisible. Route-mocked so
 * it is deterministic and never touches a real credential.
 */
const EP_X2 = 'ep-connect-x2';

test.describe('Connect tab - retained bearer secret (X2)', () => {
  test('shows the retained bearer Secret Token inline in the per-card Connect subpanel', async ({ page }) => {
    const ID = EP_X2;
    const base = `https://scim.example.com/scim/v2/endpoints/${ID}`;
    const overview = {
      endpoint: { id: ID, name: 'x2', displayName: 'X2 Connect', active: true },
      configFlags: { SecretTokenBearerAuthEnabled: true },
      credentials: [
        { id: 'cred-x2', credentialType: 'bearer', label: 'Bearer token', active: true, createdAt: '2026-05-01T00:00:00Z', expiresAt: null },
      ],
      connectionInfo: {
        endpointId: ID,
        displayName: 'X2 Connect',
        urls: {
          scimBaseUrl: base,
          scimBaseUrlBare: `https://scim.example.com/scim/endpoints/${ID}`,
          tokenEndpoint: `https://scim.example.com/scim/endpoints/${ID}/oauth/token`,
          serviceProviderConfig: `${base}/ServiceProviderConfig`,
          oauthMetadata: `https://scim.example.com/scim/endpoints/${ID}/.well-known/oauth-authorization-server`,
        },
        enabledMethods: [
          {
            method: 'bearer',
            label: 'Bearer token',
            entraAuthenticationMethod: 'Secret Token',
            entraFields: { tenantUrl: base, secretToken: null },
            clientSecretState: 'set-shown-once',
            credentialId: 'cred-x2',
            secretRetained: true,
          },
        ],
        disabledMethods: [],
      },
    };

    await page.route(`**/scim/admin/endpoints/${ID}`, async (route) => {
      if (route.request().method() !== 'GET' || !route.request().url().endsWith(`/${ID}`)) return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: ID,
          name: 'x2',
          displayName: 'X2 Connect',
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
    await page.route(`**/scim/admin/endpoints/${ID}/credentials/cred-x2/reveal`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'cred-x2', credentialType: 'bearer', token: 'retained-bearer-token-x2', retained: true }),
      });
    });

    await page.goto(`/endpoints/${ID}/connect`);
    await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });
    // The bearer tab is the default (first per-endpoint method); open the card's
    // Connect subpanel - the auto-reveal returns the retained Secret Token.
    await page.getByTestId('credential-connect-cred-x2').click();
    await expect(page.getByTestId('credential-connect-secret-cred-x2')).toContainText('retained-bearer-token-x2');
    // The secret is labelled as the bearer Secret Token, not a client secret.
    await expect(page.getByTestId('credential-connect-secret-info-cred-x2')).toContainText(/Secret token/i);
  });
});

/**
 * X3/X4 - the credential create dialog and the WIF trust form both carry a
 * Label + Description input. Route-mocked so it is deterministic and never
 * creates a real credential (the forms are only opened, never submitted).
 */
const EP_DESC = 'ep-connect-desc';

test.describe('Connect tab - label + description fields (X3/X4)', () => {
  test('the credential create dialog + WIF trust form expose Label + Description inputs', async ({ page }) => {
    const ID = EP_DESC;
    const base = `https://scim.example.com/scim/v2/endpoints/${ID}`;
    const overview = {
      endpoint: { id: ID, name: 'desc', displayName: 'Desc Connect', active: true },
      // Enable both bearer (per-endpoint create) and WIF (trust form).
      configFlags: { SecretTokenBearerAuthEnabled: true, PerEndpointCredentialsEnabled: true, WifCredentialsEnabled: true },
      credentials: [],
      connectionInfo: {
        endpointId: ID,
        displayName: 'Desc Connect',
        urls: {
          scimBaseUrl: base,
          scimBaseUrlBare: `https://scim.example.com/scim/endpoints/${ID}`,
          tokenEndpoint: `https://scim.example.com/scim/endpoints/${ID}/oauth/token`,
          serviceProviderConfig: `${base}/ServiceProviderConfig`,
          oauthMetadata: `https://scim.example.com/scim/endpoints/${ID}/.well-known/oauth-authorization-server`,
        },
        enabledMethods: [
          { method: 'bearer', label: 'Bearer token', entraAuthenticationMethod: 'Secret Token', entraFields: { tenantUrl: base, secretToken: null }, clientSecretState: 'none' },
          { method: 'wif', label: 'Federated identity (WIF)', entraAuthenticationMethod: 'OIDC federation', entraFields: { tenantUrl: base }, clientSecretState: 'none' },
        ],
        disabledMethods: [],
      },
    };

    await page.route(`**/scim/admin/endpoints/${ID}`, async (route) => {
      if (route.request().method() !== 'GET' || !route.request().url().endsWith(`/${ID}`)) return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: ID,
          name: 'desc',
          displayName: 'Desc Connect',
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

    await page.goto(`/endpoints/${ID}/connect`);
    await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });

    // X4 - the credential create dialog carries Label + Description.
    await page.getByTestId('credentials-create-button').click();
    await expect(page.getByTestId('credentials-create-dialog')).toBeVisible();
    await expect(page.getByTestId('credentials-label-input')).toBeVisible();
    await expect(page.getByTestId('credentials-description-input')).toBeVisible();
    // Close the dialog without submitting.
    await page.keyboard.press('Escape');

    // X3 - the WIF trust form carries Label + Description.
    await page.getByTestId('credentials-method-tab-wif').click();
    await page.getByTestId('wif-add-trust-button').click();
    await expect(page.getByTestId('wif-field-label')).toBeVisible();
    await expect(page.getByTestId('wif-field-description')).toBeVisible();
  });
});
