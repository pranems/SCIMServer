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
    for (const flag of [
      'PerEndpointCredentialsEnabled',
      'SecretTokenBearerAuthEnabled',
      'OAuthClientCredentialsAuthEnabled',
      'SharedSecretBearerAuthEnabled',
      'WifCredentialsEnabled',
    ]) {
      await expect(page.getByTestId(`connect-auth-flag-${flag}`)).toBeVisible();
    }
  });

  test('toggling an auth method from the Connect tab PERSISTS across a reload', async ({ page }) => {
    await openConnect(page);
    const wif = page.getByTestId('connect-auth-flag-WifCredentialsEnabled');
    const before = await wif.isChecked();
    await wif.click();
    // Re-read from the server rather than trusting the control's own state:
    // an optimistic switch that never persisted looks identical in the DOM.
    await page.reload();
    await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('connect-auth-flag-WifCredentialsEnabled')).toBeChecked({
      checked: !before,
    });
  });

  test('a credential card shows its Connect params with no click, and has no Connect button', async ({ page }) => {
    await openConnect(page);
    // Ensure the bearer method is on, then create a credential to inspect.
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
