/**
 * wif-trust-management.spec.ts - browser coverage for the WIF trust
 * MANAGEMENT surfaces added in the 2026-07 WIF UX overhaul:
 *   - item 5: the configured-trust display grid shows every public field VALUE
 *   - item 4: Edit loads a saved trust into the form (edit mode) with Save
 *     changes + Cancel edit
 *   - item 7: the JWKS host allowlist notice (list + host-not-allowed warning)
 *   - item 6/C: the "Verify issuer + JWKS reachability" checklist + the
 *     verify-on-save 422 -> checklist + "Save anyway" override
 *   - item E: the role-enforcement dropdown
 *
 * All server responses are route-mocked so the spec is deterministic and
 * touches nothing real (no credential is created/edited on the server). This
 * is the browser-level complement to the API E2E (admin-credential /
 * wif-discovery-resolver specs) + the vitest component tests.
 */
import { test, expect, type Page } from '@playwright/test';

const TOKEN_STORAGE_KEY = 'scimserver.authToken';
const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';

const EP = 'ep-wiftrust';

/** A configured WIF trust with its full public field set (item 5). */
const TRUST_A = {
  id: 'wt-a',
  credentialType: 'wif',
  label: 'Contoso Entra',
  active: true,
  createdAt: '2026-06-01T00:00:00Z',
  expiresAt: null,
  wif: {
    expectedIssuer: 'https://login.microsoftonline.com/contoso/v2.0',
    expectedSubject: 'sp-object-id-123',
    expectedAudience: 'api://scim-app',
    jwksUri: 'https://login.microsoftonline.com/contoso/discovery/v2.0/keys',
    allowedTenantId: 'contoso-tenant-guid',
    requiredRoles: ['Scim.Provision'],
    scope: 'scim.read scim.write',
    assertionProfile: 'jwt-bearer',
    issuedTokenTtlSec: null,
    roleEnforcement: 'off',
  },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: TOKEN_STORAGE_KEY, value: TOKEN },
  );
});

/** Route-mock the endpoint detail + overview + JWKS allowlist for the WIF endpoint. */
async function mockWifEndpoint(page: Page): Promise<void> {
  await page.route(`**/scim/admin/endpoints/${EP}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    if (!route.request().url().endsWith(`/${EP}`)) return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: EP,
        name: 'wif-trust',
        displayName: 'WIF Trust Mgmt',
        active: true,
        scimBasePath: `/scim/v2/endpoints/${EP}`,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        profile: {
          schemas: [],
          resourceTypes: [],
          serviceProviderConfig: { documentationUri: '', patch: { supported: true } },
          settings: {},
        },
      }),
    });
  });

  await page.route('**/scim/admin/endpoints/*/overview', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        endpoint: {
          id: EP,
          name: 'wif-trust',
          displayName: 'WIF Trust Mgmt',
          preset: 'entra-id',
          active: true,
          scimBasePath: `/scim/endpoints/${EP}/v2`,
          createdAt: '2026-01-01T00:00:00Z',
        },
        stats: { userCount: 0, activeUserCount: 0, groupCount: 0, activeGroupCount: 0, genericResourceCount: 0 },
        credentials: [TRUST_A],
        recentActivity: [],
        configFlags: { WifCredentialsEnabled: true },
        connectionInfo: {
          endpointId: EP,
          displayName: 'WIF Trust Mgmt',
          urls: {
            scimBaseUrl: `https://dev.example/scim/v2/endpoints/${EP}`,
            scimBaseUrlBare: `https://dev.example/scim/endpoints/${EP}`,
            tokenEndpoint: `https://dev.example/scim/endpoints/${EP}/oauth/token`,
            serviceProviderConfig: `https://dev.example/scim/v2/endpoints/${EP}/ServiceProviderConfig`,
            oauthMetadata: `https://dev.example/scim/endpoints/${EP}/.well-known/oauth-authorization-server`,
          },
          enabledMethods: [],
          disabledMethods: [],
        },
      }),
    });
  });

  // JWKS host allowlist (item 7) - seed hosts only.
  await page.route('**/scim/admin/settings/jwks-hosts', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        seed: ['login.microsoftonline.com'],
        env: [],
        persisted: [],
        effective: ['login.microsoftonline.com'],
      }),
    });
  });
}

async function openCredentials(page: Page): Promise<void> {
  await mockWifEndpoint(page);
  await page.goto(`/endpoints/${EP}/credentials`);
  await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('wif-section')).toBeVisible();
}

test.describe('WIF trust management (2026-07 overhaul)', () => {
  test('item 5: the configured-trust grid renders every public field VALUE', async ({ page }) => {
    await openCredentials(page);
    const details = page.getByTestId('wif-credential-details-wt-a');
    await expect(details).toBeVisible();
    // R10: assert the rendered VALUES, not just presence.
    await expect(page.getByTestId('wif-credential-wt-a-issuer')).toContainText(
      'https://login.microsoftonline.com/contoso/v2.0',
    );
    await expect(page.getByTestId('wif-credential-wt-a-subject')).toContainText('sp-object-id-123');
    await expect(page.getByTestId('wif-credential-wt-a-audience')).toContainText('api://scim-app');
    await expect(page.getByTestId('wif-credential-wt-a-jwks')).toContainText(
      'https://login.microsoftonline.com/contoso/discovery/v2.0/keys',
    );
    await expect(page.getByTestId('wif-credential-wt-a-tenant')).toContainText('contoso-tenant-guid');
    await expect(page.getByTestId('wif-credential-wt-a-roles')).toContainText('Scim.Provision');
  });

  test('item 4: Edit loads the saved trust into the form (edit mode)', async ({ page }) => {
    await openCredentials(page);
    await page.getByTestId('wif-credential-edit-wt-a').click();
    // The form populates with the saved values.
    await expect(page.getByTestId('wif-field-issuer').getByRole('textbox')).toHaveValue(
      'https://login.microsoftonline.com/contoso/v2.0',
    );
    await expect(page.getByTestId('wif-field-tenant').getByRole('textbox')).toHaveValue('contoso-tenant-guid');
    // Edit-mode affordances appear.
    await expect(page.getByTestId('wif-editing-banner')).toBeVisible();
    await expect(page.getByTestId('wif-save-button')).toContainText('Save changes');
    await expect(page.getByTestId('wif-cancel-edit-button')).toBeVisible();
    // Cancel returns to create mode.
    await page.getByTestId('wif-cancel-edit-button').click();
    await expect(page.getByTestId('wif-editing-banner')).toBeHidden();
    await expect(page.getByTestId('wif-save-button')).toContainText('Save WIF trust');
  });

  test('item 7: the JWKS allowlist notice lists hosts + warns on a non-allowed host with inline add', async ({ page }) => {
    await openCredentials(page);
    await expect(page.getByTestId('wif-jwks-allowlist-notice')).toBeVisible();
    await expect(page.getByTestId('wif-jwks-host-login.microsoftonline.com')).toBeVisible();
    // Type a JWKS host that is NOT on the allowlist -> warning + inline add.
    await page.getByTestId('wif-field-jwks').getByRole('textbox').fill('https://keys.okta.example/v1/keys');
    const warning = page.getByTestId('wif-jwks-host-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('keys.okta.example');
    await expect(page.getByTestId('wif-jwks-add-host')).toContainText('keys.okta.example');
  });

  test('item D: a non-https issuer URL surfaces an inline validation message', async ({ page }) => {
    await openCredentials(page);
    await page.getByTestId('wif-field-issuer').getByRole('textbox').fill('http://insecure/v2.0');
    await expect(page.getByText(/Must use https/i)).toBeVisible();
  });

  test('item E: the role-enforcement dropdown is present (advisory default)', async ({ page }) => {
    await openCredentials(page);
    await expect(page.getByTestId('wif-field-role-enforcement')).toBeVisible();
  });

  test('item 6: Verify renders the per-check reachability checklist', async ({ page }) => {
    await openCredentials(page);
    // Mock the verify endpoint -> a mixed pass/fail checklist.
    await page.route('**/scim/admin/endpoints/*/wif/verify', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          checks: [
            { id: 'issuerFormat', label: 'Issuer is a valid https URL', ok: true, detail: 'https://idp/v2.0' },
            { id: 'jwksReachable', label: 'JWKS URI reachable', ok: false, detail: 'GET returned HTTP 404.' },
            { id: 'jwksServesKeys', label: 'JWKS serves a non-empty key set', ok: false, detail: 'not a JWKS' },
          ],
        }),
      });
    });
    // Fill the fields then click Verify.
    await page.getByTestId('wif-field-issuer').getByRole('textbox').fill('https://idp.example/v2.0');
    await page.getByTestId('wif-field-jwks').getByRole('textbox').fill('https://idp.example/keys');
    await page.getByTestId('wif-verify-button').click();
    await expect(page.getByTestId('wif-verify-result')).toBeVisible();
    await expect(page.getByTestId('wif-verify-check-jwksReachable')).toContainText('404');
  });

  test('item C: a verify-gated create failure shows the checklist + a Save-anyway override', async ({ page }) => {
    await openCredentials(page);
    // The create POST returns 422 with the failed checks (verify gate).
    await page.route(`**/scim/admin/endpoints/${EP}/credentials`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const body = JSON.parse(route.request().postData() ?? '{}');
      if (body.verify === true) {
        await route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({
            scimType: 'invalidValue',
            detail: 'WIF trust verification failed',
            checks: [
              { id: 'jwksReachable', label: 'JWKS URI reachable', ok: false, detail: 'GET returned HTTP 404.' },
            ],
          }),
        });
      } else {
        // "Save anyway" (verify:false) -> success.
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ id: 'wt-new', endpointId: EP, credentialType: 'wif', active: true }),
        });
      }
    });

    await page.getByTestId('wif-field-issuer').getByRole('textbox').fill('https://idp.example/v2.0');
    await page.getByTestId('wif-field-subject').getByRole('textbox').fill('sub');
    await page.getByTestId('wif-field-audience').getByRole('textbox').fill('aud');
    await page.getByTestId('wif-field-jwks').getByRole('textbox').fill('https://idp.example/keys');
    await page.getByTestId('wif-field-tenant').getByRole('textbox').fill('tid');

    // First Save -> 422 -> checklist + Save-anyway.
    await page.getByTestId('wif-save-button').click();
    await expect(page.getByTestId('wif-verify-result')).toBeVisible();
    await expect(page.getByTestId('wif-verify-check-jwksReachable')).toContainText('404');
    const anyway = page.getByTestId('wif-save-anyway-button');
    await expect(anyway).toBeVisible();
    // Save anyway -> success -> return values render.
    await anyway.click();
    await expect(page.getByTestId('wif-return-values')).toBeVisible({ timeout: 15_000 });
  });
});
