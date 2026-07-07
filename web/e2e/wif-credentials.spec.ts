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
    // The endpoint may hold several wif rows (each repeats the heading text), so
    // scope to the first match to avoid a strict-mode violation.
    await expect(page.getByText('Federated Identity (WIF)').first()).toBeVisible();
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

  // WI-13 regression: the claim-name alias hint is shown when the WIF form is
  // enabled, guiding operators that pasted decoded-token keys are accepted.
  test('WI-13: the claim-name alias hint renders when WIF is enabled', async ({ page }) => {
    await openFirstEndpointCredentials(page);

    const issuer = page.getByTestId('wif-field-issuer');
    const formVisible = await issuer.isVisible().catch(() => false);
    test.skip(!formVisible, 'WifCredentialsEnabled is off on this endpoint; the form is not rendered.');

    const hint = page.getByTestId('wif-field-alias-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('expectedTenantId');
  });

  // WI-14 regression: the discovery resolver row is present when WIF is enabled.
  test('WI-14: the WIF discovery resolver row renders when WIF is enabled', async ({ page }) => {
    await openFirstEndpointCredentials(page);

    const issuer = page.getByTestId('wif-field-issuer');
    const formVisible = await issuer.isVisible().catch(() => false);
    test.skip(!formVisible, 'WifCredentialsEnabled is off on this endpoint; the form is not rendered.');

    await expect(page.getByTestId('wif-resolve-row')).toBeVisible();
    await expect(page.getByTestId('wif-resolve-button')).toBeVisible();
  });

  // WI-1 regression: the WIF return-values box must present the SCIM base URL
  // in the spec form `/scim/v2/endpoints/{id}` (the `/scim/v2` version segment
  // is a LEADING prefix the server rewrites), NOT the buggy tail form
  // `/scim/endpoints/{id}/v2` which is not a route the server serves.
  //
  // SAFETY: the create POST is intercepted client-side and fulfilled with a
  // mock success, so the return box renders WITHOUT creating any real `wif`
  // credential on the server. No cleanup is required.
  test('WI-1: the return-values SCIM URL uses the /scim/v2/endpoints/{id} spec form', async ({
    page,
  }) => {
    await page.goto('/endpoints');
    await expect(page.getByTestId('endpoints-page')).toBeVisible({ timeout: 30_000 });

    const cards = page.locator('[data-testid^="endpoint-"]').filter({
      hasNot: page.locator('[data-testid^="endpoint-detail"]'),
    });
    const count = await cards.count();
    test.skip(count === 0, 'Tenant has zero endpoints; cannot exercise the WIF return box.');

    const first = cards.first();
    const cardTestId = (await first.getAttribute('data-testid')) ?? '';
    const endpointId = cardTestId.replace(/^endpoint-/, '');
    await first.click();
    await expect(page.getByTestId('endpoint-detail-page')).toBeVisible({ timeout: 30_000 });
    await page.goto(`/endpoints/${endpointId}/credentials`);
    await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });

    const issuer = page.getByTestId('wif-field-issuer');
    const formVisible = await issuer.isVisible().catch(() => false);
    test.skip(!formVisible, 'WifCredentialsEnabled is off on this endpoint; the form is not rendered.');

    // Intercept the credential-create POST and fulfill it with a mock success
    // so the return box renders but NO server-side credential is created.
    await page.route('**/scim/admin/endpoints/*/credentials', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'wi1-mock-credential-id',
          endpointId,
          credentialType: 'wif',
          active: true,
        }),
      });
    });

    // Fill the four required Entra trust fields, then Save.
    await issuer.getByRole('textbox').fill('https://login.microsoftonline.com/t/v2.0');
    await page.getByTestId('wif-field-subject').getByRole('textbox').fill('sp-obj-id');
    await page.getByTestId('wif-field-audience').getByRole('textbox').fill('api://app');
    await page
      .getByTestId('wif-field-jwks')
      .getByRole('textbox')
      .fill('https://login.microsoftonline.com/t/discovery/v2.0/keys');
    await page.getByTestId('wif-field-tenant').getByRole('textbox').fill('tenant-guid');

    const save = page.getByTestId('wif-save-button');
    await expect(save).toBeEnabled();
    await save.click();

    // The return box renders on the mocked success. Assert the SCIM URL shape
    // via the copy button's aria-label (CopyableField sets `Copy ${value}`).
    const scimCopy = page.getByTestId('wif-return-scimurl-copy-button');
    await expect(scimCopy).toBeVisible({ timeout: 15_000 });
    const label = (await scimCopy.getAttribute('aria-label')) ?? '';
    expect(label).toContain(`/scim/v2/endpoints/${endpointId}`);
    expect(label).not.toContain(`/scim/endpoints/${endpointId}/v2`);

    // WI-12: the per-endpoint RFC 8414 OAuth metadata URL is surfaced too.
    const metaCopy = page.getByTestId('wif-return-metadataurl-copy-button');
    await expect(metaCopy).toBeVisible();
    const metaLabel = (await metaCopy.getAttribute('aria-label')) ?? '';
    expect(metaLabel).toContain(
      `/scim/endpoints/${endpointId}/.well-known/oauth-authorization-server`,
    );
  });

  // WI-16 regression: when an endpoint has SEVERAL wif trusts, the credentials
  // tab shows a multi-trust header + guidance and lists every trust. The
  // endpoint overview is intercepted so two `wif` credentials render without
  // touching the server.
  test('WI-16: multiple wif trusts render a multi-trust header + all rows', async ({ page }) => {
    // The endpoint-detail layout route loader fetches the endpoint detail
    // (GET /scim/admin/endpoints/ep-multi) BEFORE the credentials child
    // renders; EndpointDetailPage shows an error panel (not the tabs) if
    // that 404s. ep-multi is a synthetic id, so mock the detail too - not
    // just the overview - or `tab-credentials` never mounts. (Root cause of
    // the 2026-07-07 dev-deploy Stage 5.3 failure: only overview was mocked.)
    await page.route('**/scim/admin/endpoints/ep-multi', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      // Guard against accidentally swallowing a suffixed URL (e.g. /stats).
      if (!route.request().url().endsWith('/ep-multi')) return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'ep-multi',
          name: 'wi16-multi',
          displayName: 'WI-16 Multi-trust',
          active: true,
          scimBasePath: '/scim/v2/endpoints/ep-multi',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          // Empty profile.resourceTypes -> fail-open -> all tabs render.
          profile: {
            schemas: [],
            resourceTypes: [],
            serviceProviderConfig: { documentationUri: '', patch: { supported: true } },
            settings: {},
          },
        }),
      });
    });

    // Intercept the overview BFF response BEFORE navigating, injecting two
    // active wif credentials + the WifCredentialsEnabled flag.
    await page.route('**/scim/admin/endpoints/*/overview', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const url = route.request().url();
      const idMatch = url.match(/endpoints\/([^/]+)\/overview/);
      const endpointId = idMatch ? idMatch[1] : 'ep-multi';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          endpoint: {
            id: endpointId,
            name: 'wi16-multi',
            displayName: 'WI-16 Multi-trust',
            preset: 'entra-id',
            active: true,
            scimBasePath: `/scim/endpoints/${endpointId}/v2`,
            createdAt: '2026-01-01T00:00:00Z',
          },
          stats: {
            userCount: 0,
            activeUserCount: 0,
            groupCount: 0,
            activeGroupCount: 0,
            genericResourceCount: 0,
          },
          credentials: [
            { id: 'wif-a', credentialType: 'wif', label: 'Contoso Entra', active: true, createdAt: '2026-06-01T00:00:00Z', expiresAt: null },
            { id: 'wif-b', credentialType: 'wif', label: 'Acme Okta', active: true, createdAt: '2026-06-02T00:00:00Z', expiresAt: null },
          ],
          recentActivity: [],
          configFlags: { WifCredentialsEnabled: true },
          // WI-3: connectionInfo is a required field on the overview BFF shape.
          // Without it the CredentialsTab connection consumers throw and the
          // tab never renders (PA shared-shape ripple).
          connectionInfo: {
            endpointId,
            displayName: 'WI-16 Multi-trust',
            urls: {
              scimBaseUrl: `https://dev.example/scim/v2/endpoints/${endpointId}`,
              scimBaseUrlBare: `https://dev.example/scim/endpoints/${endpointId}`,
              tokenEndpoint: `https://dev.example/scim/endpoints/${endpointId}/oauth/token`,
              serviceProviderConfig: `https://dev.example/scim/v2/endpoints/${endpointId}/ServiceProviderConfig`,
              oauthMetadata: `https://dev.example/scim/endpoints/${endpointId}/.well-known/oauth-authorization-server`,
            },
            enabledMethods: [],
            disabledMethods: [],
          },
        }),
      });
    });

    await page.goto('/endpoints/ep-multi/credentials');
    await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });

    // Both trust rows render.
    await expect(page.getByTestId('wif-credential-row-wif-a')).toBeVisible();
    await expect(page.getByTestId('wif-credential-row-wif-b')).toBeVisible();

    // The multi-trust header shows the count + simultaneous-auth guidance.
    const header = page.getByTestId('wif-credentials-list-header');
    await expect(header).toBeVisible();
    await expect(header).toContainText('Configured federated trusts (2)');
    await expect(header).toContainText(/authenticates at the same time/i);
  });
});
