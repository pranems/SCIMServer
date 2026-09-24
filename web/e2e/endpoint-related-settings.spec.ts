/**
 * The endpoint tabs surface the settings that control their own behavior.
 * Settings remains the complete inventory; these panels remove the round trip
 * for the settings an operator needs while working in a specific tab.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  createFixtureEndpoint,
  deleteFixtureEndpoint,
  seedAuthToken,
} from './endpoint-fixture';

let endpointId: string | null = null;

test.beforeEach(async ({ page }) => {
  await seedAuthToken(page);
});

test.afterEach(async ({ page }) => {
  endpointId = await deleteFixtureEndpoint(page, endpointId);
});

async function openFixture(page: Page): Promise<string> {
  endpointId = await createFixtureEndpoint(page, {
    namePrefix: 'e2e-related-settings',
    settings: {
      SecretTokenBearerAuthEnabled: true,
      WifCredentialsEnabled: true,
      UserSoftDeleteEnabled: true,
    },
  });
  return endpointId;
}

test.describe('Endpoint contextual settings', () => {
  test('each operational tab exposes the settings that govern that surface', async ({ page }) => {
    test.setTimeout(120_000);
    const id = await openFixture(page);

    const routes = [
      ['users', 'users-related-settings', ['User soft delete', 'User hard delete']],
      ['groups', 'groups-related-settings', ['Group hard delete', 'Multi-member Group PATCH', 'Allow removing all Group members']],
      ['schemas', 'schemas-related-settings', ['Schema discovery', 'Strict schema validation', 'RFC-compliant sub-attributes']],
      ['resource-types', 'resource-types-related-settings', ['Schema discovery', 'Enforce resource types']],
      ['logs', 'logs-related-settings', ['Persist request secrets', 'Write endpoint log file', 'Log level']],
    ] as const;

    for (const [route, panelId, settingLabels] of routes) {
      await page.goto(`/endpoints/${id}/${route}`);
      const panel = page.getByTestId(panelId);
      await expect(panel).toBeVisible({ timeout: 30_000 });
      const disclosure = panel.getByRole('button');
      await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
      await expect(disclosure).toContainText(`${settingLabels.length} settings`);
      if (route === 'users') {
        await disclosure.focus();
        await page.keyboard.press('Enter');
      } else {
        await disclosure.click();
      }
      const renderedLabels = await panel.locator('label').allTextContents();
      expect(renderedLabels.map((label) => label.trim()).filter(Boolean).sort()).toEqual(
        [...settingLabels].sort(),
      );
      if (route === 'users') {
        await expect(panel.getByRole('switch')).toHaveCount(2);
      }
      if (route === 'groups') {
        await expect(panel.getByRole('switch')).toHaveCount(3);
      }
    }
  });

  test('a User setting changed in the Users tab persists after reload', async ({ page }) => {
    test.setTimeout(120_000);
    const id = await openFixture(page);
    await page.goto(`/endpoints/${id}/users`);

    await page.getByTestId('users-related-settings').getByRole('button').click();
    const setting = page.getByTestId('users-related-settings-UserSoftDeleteEnabled');
    await expect(setting).toBeChecked({ checked: true });
    await setting.click();
    await expect(page.getByTestId('users-related-settings-feedback')).toContainText('saved');
    await page.reload();
    await page.getByTestId('users-related-settings').getByRole('button').click();
    await expect(page.getByTestId('users-related-settings-UserSoftDeleteEnabled')).toBeChecked({ checked: false });
  });

  test('Connect follows the selected authentication method with its own limits', async ({ page }) => {
    test.setTimeout(120_000);
    const id = await openFixture(page);
    await page.goto(`/endpoints/${id}/connect`);

    await page.getByTestId('credentials-method-tab-bearer').click();
    await expect(page.getByTestId('connect-related-settings-bearer')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('connect-related-settings-bearer').getByRole('button').click();
    await expect(
      page.getByTestId('connect-related-settings-bearer-MaxActiveBearerCredentials'),
    ).toBeVisible();

    await page.getByTestId('credentials-method-tab-wif').click();
    await expect(page.getByTestId('connect-related-settings-wif')).toBeVisible();
    await page
      .getByTestId('connect-related-settings-wif')
      .getByRole('button', { name: /WIF trust and JWKS settings/i })
      .click();
    await expect(page.getByTestId('connect-related-settings-wif-MaxActiveWifTrusts')).toBeVisible();
    await expect(
      page.getByTestId('connect-related-settings-wif-effective-JwksMaxKeys'),
    ).toContainText('Effective:');
  });

  test('Connect follows an authoritative authentication-method entry and disables the flat switch', async ({ page }) => {
    test.setTimeout(120_000);
    endpointId = await createFixtureEndpoint(page, {
      namePrefix: 'e2e-managed-auth-method',
      settings: { SecretTokenBearerAuthEnabled: false },
    });
    const id = endpointId;

    const added = await page.evaluate(
      async ({ endpoint, token }) => {
        const response = await fetch(`/scim/admin/endpoints/${endpoint}/authentication/methods`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'bearer', enabled: true }),
        });
        return response.status;
      },
      { endpoint: id, token: process.env.E2E_TOKEN || 'changeme-scim' },
    );
    expect(added).toBe(201);

    await page.goto(`/endpoints/${id}/connect`);
    await page.getByTestId('connect-auth-methods').getByRole('button').click();
    const bearer = page.getByTestId('connect-auth-flag-SecretTokenBearerAuthEnabled');
    await expect(bearer).toBeChecked();
    await expect(bearer).toBeDisabled();
    await expect(page.getByTestId('connect-auth-managed-SecretTokenBearerAuthEnabled')).toContainText(
      'authentication method entry',
    );
    await expect(page.getByTestId('credentials-method-tab-bearer')).toBeVisible();
  });
});