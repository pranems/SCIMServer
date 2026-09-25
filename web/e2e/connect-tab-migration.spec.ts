/**
 * connect-tab-migration.spec.ts - the bcrypt -> keyed migration surface on the
 * Connect tab (P7), driven through a real browser.
 *
 * USER PATHS COVERED
 *   /endpoints/$id/connect ->
 *     - the auth-method switches are ON the Connect tab (no trip to Settings)
 *     - toggling one PERSISTS (verified by reload, not by the switch's own state)
 *     - a credential card shows its Connect params with NO click
 *     - the Connect toggle button is gone
 *     - Rotate is a first-class card action
 *     - a freshly created credential is badged Keyed, not Legacy
 *
 * SAFETY
 *   Uses a self-cleaning fixture endpoint and only ever creates/rotates
 *   credentials on THAT endpoint. It never touches a pre-existing credential,
 *   because rotating one would break whatever integration owns it.
 */
import { test, expect, type Page } from '@playwright/test';
import { createFixtureEndpoint, deleteFixtureEndpoint } from './endpoint-fixture';

const TOKEN_STORAGE_KEY = 'scimserver.authToken';
const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
      window.localStorage.setItem('scimserver.onboarding.completedAt', 'e2e-complete');
    },
    { key: TOKEN_STORAGE_KEY, value: TOKEN },
  );
});

let fixtureEndpointId: string | null = null;

test.afterEach(async ({ page }) => {
  fixtureEndpointId = await deleteFixtureEndpoint(page, fixtureEndpointId);
});

async function openConnect(page: Page): Promise<void> {
  test.setTimeout(120_000);
  fixtureEndpointId = await createFixtureEndpoint(page, { namePrefix: 'e2e-p7' });
  await page.goto(`/endpoints/${fixtureEndpointId}/connect`);
  await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });
}

test.describe('Connect tab - migration surface (P7)', () => {
  test('the auth-method switches render on the Connect tab itself', async ({ page }) => {
    await openConnect(page);
    const panel = page.getByTestId('connect-auth-methods');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
    await panel.getByRole('button').click();
    for (const flag of [
      'OAuthClientCredentialsAuthEnabled',
      'WifCredentialsEnabled',
      'SharedSecretBearerAuthEnabled',
      'SecretTokenBearerAuthEnabled',
    ]) {
      await expect(page.getByTestId(`connect-auth-flag-${flag}`)).toBeVisible();
    }
    await expect(page.getByTestId('connect-auth-flag-PerEndpointCredentialsEnabled')).toHaveCount(0);
  });

  test('toggling an auth method from the Connect tab PERSISTS across a reload', async ({ page }) => {
    await openConnect(page);
    await page.getByTestId('connect-auth-methods').getByRole('button').click();
    const wif = page.getByTestId('connect-auth-flag-WifCredentialsEnabled');
    const before = await wif.isChecked();
    await wif.click();
    // Wait for SERVER truth before reloading. Reloading immediately after the
    // click can abort the in-flight PATCH and make this persistence test cause
    // the very failure it is intended to detect.
    await expect.poll(async () => {
      const response = await page.request.get(`/scim/admin/endpoints/${fixtureEndpointId}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (!response.ok()) return before;
      const body = await response.json();
      const stored = body.profile?.settings?.WifCredentialsEnabled;
      return stored === true || String(stored).toLowerCase() === 'true';
    }, { timeout: 20_000 }).toBe(!before);

    // Re-read through the UI after a reload rather than trusting the
    // optimistic control state.
    await page.reload();
    await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('connect-auth-methods').getByRole('button').click();
    await expect(page.getByTestId('connect-auth-flag-WifCredentialsEnabled')).toBeChecked({
      checked: !before,
    });
  });

  test('enabling bearer shows its method tab before the PATCH response returns', async ({ page }) => {
    await openConnect(page);
    await page.getByTestId('connect-auth-methods').getByRole('button').click();
    const bearer = page.getByTestId('connect-auth-flag-SecretTokenBearerAuthEnabled');
    await expect(bearer).not.toBeChecked();
    await expect(page.getByTestId('credentials-method-tab-bearer')).toHaveCount(0);

    let releasePatch = (): void => undefined;
    const patchGate = new Promise<void>((resolve) => {
      releasePatch = resolve;
    });
    await page.route(`**/scim/admin/endpoints/${fixtureEndpointId}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        await patchGate;
      }
      await route.continue();
    });

    await bearer.click();
    try {
      await expect(page.getByTestId('credentials-method-tab-bearer')).toBeVisible();
    } finally {
      releasePatch();
    }
    await expect(bearer).toBeChecked();
  });

  test('Settings shows method-managed effective state instead of the writable shadow flag', async ({ page }) => {
    fixtureEndpointId = await createFixtureEndpoint(page, {
      namePrefix: 'e2e-authoritative-settings',
      settings: { SecretTokenBearerAuthEnabled: true },
    });
    const addMethod = await page.request.post(
      `/scim/admin/endpoints/${fixtureEndpointId}/authentication/methods`,
      {
        headers: { Authorization: `Bearer ${TOKEN}` },
        data: { type: 'bearer', enabled: false },
      },
    );
    expect(addMethod.status()).toBe(201);

    await page.goto(`/endpoints/${fixtureEndpointId}/settings`);
    await expect(page.getByTestId('settings-tab')).toBeVisible({ timeout: 30_000 });

    const bearer = page.getByTestId('settings-flag-SecretTokenBearerAuthEnabled');
    await expect(bearer).not.toBeChecked();
    await expect(bearer).toBeDisabled();
    await expect(page.getByTestId('settings-flag-source-SecretTokenBearerAuthEnabled')).toContainText(
      'Managed by Authentication methods',
    );

    const endpoint = await page.request.get(`/scim/admin/endpoints/${fixtureEndpointId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(endpoint.status()).toBe(200);
    const body = await endpoint.json();
    expect(body.profile.settings.SecretTokenBearerAuthEnabled).toBe(true);
  });

  test('a credential card shows its Connect params with no click, and has no Connect button', async ({ page }) => {
    await openConnect(page);
    // Ensure the bearer method is on, then create a credential to inspect.
    await page.getByTestId('connect-auth-methods').getByRole('button').click();
    const bearerFlag = page.getByTestId('connect-auth-flag-SecretTokenBearerAuthEnabled');
    if (!(await bearerFlag.isChecked())) {
      await bearerFlag.click();
      await page.reload();
      await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });
    }
    await page.getByTestId('credentials-create-button').click();
    await page.getByTestId('credentials-create-dialog-submit').click();
    // Dismiss the one-time-secret view to get back to the card list.
    const done = page.getByTestId('credentials-create-dialog-submit');
    if (await done.isVisible().catch(() => false)) await done.click();
    await page.reload();
    await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });

    const panel = page.locator('[data-testid^="credential-connect-panel-"]').first();
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Connect this endpoint to IdP like Entra ID');
    // The Application API URL is readable immediately - the point of the change.
    await expect(page.locator('[data-testid^="credential-connect-appurl-"]').first()).toBeVisible();
    // The Connect toggle button no longer exists anywhere on the tab.
    await expect(page.locator('button[data-testid^="credential-connect-"][data-testid$="-1"]')).toHaveCount(0);
  });

  test('Rotate is on the card, and a newly minted credential is badged Keyed', async ({ page }) => {
    await openConnect(page);
    await page.getByTestId('connect-auth-methods').getByRole('button').click();
    const bearerFlag = page.getByTestId('connect-auth-flag-SecretTokenBearerAuthEnabled');
    if (!(await bearerFlag.isChecked())) {
      await bearerFlag.click();
      await page.reload();
      await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });
    }
    await page.getByTestId('credentials-create-button').click();
    await page.getByTestId('credentials-create-dialog-submit').click();
    const done = page.getByTestId('credentials-create-dialog-submit');
    if (await done.isVisible().catch(() => false)) await done.click();
    await page.reload();
    await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });

    // Rotate is reachable without opening the overflow menu.
    await expect(page.locator('[data-testid^="credential-rotate-"]').first()).toBeVisible();
    // A credential minted today is keyed, so the badge must say so and the
    // legacy banner must NOT be showing for this endpoint.
    await expect(page.locator('[data-testid^="credential-hashalgo-"]').first()).toContainText('Keyed');
    await expect(page.getByTestId('connect-legacy-banner')).toHaveCount(0);
  });
});
