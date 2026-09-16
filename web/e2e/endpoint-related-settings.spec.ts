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
      ['users', 'users-related-settings', /User soft delete/i],
      ['groups', 'groups-related-settings', /Group hard delete/i],
      ['schemas', 'schemas-related-settings', /Schema discovery/i],
      ['resource-types', 'resource-types-related-settings', /Enforce resource types/i],
      ['logs', 'logs-related-settings', /Persist request secrets/i],
    ] as const;

    for (const [route, panelId, settingLabel] of routes) {
      await page.goto(`/endpoints/${id}/${route}`);
      const panel = page.getByTestId(panelId);
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expect(panel.getByRole('switch', { name: settingLabel })).toBeChecked({ checked: true });
    }
  });

  test('a User setting changed in the Users tab persists after reload', async ({ page }) => {
    test.setTimeout(120_000);
    const id = await openFixture(page);
    await page.goto(`/endpoints/${id}/users`);

    const setting = page.getByTestId('users-related-settings-UserSoftDeleteEnabled');
    await expect(setting).toBeChecked({ checked: true });
    await setting.click();
    await expect(page.getByTestId('users-related-settings-feedback')).toContainText('saved');
    await page.reload();
    await expect(page.getByTestId('users-related-settings-UserSoftDeleteEnabled')).toBeChecked({ checked: false });
  });

  test('Connect follows the selected authentication method with its own limits', async ({ page }) => {
    test.setTimeout(120_000);
    const id = await openFixture(page);
    await page.goto(`/endpoints/${id}/connect`);

    await page.getByTestId('credentials-method-tab-bearer').click();
    await expect(page.getByTestId('connect-related-settings-bearer')).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByTestId('connect-related-settings-bearer-MaxActiveBearerCredentials'),
    ).toBeVisible();

    await page.getByTestId('credentials-method-tab-wif').click();
    await expect(page.getByTestId('connect-related-settings-wif')).toBeVisible();
    await expect(page.getByTestId('connect-related-settings-wif-MaxActiveWifTrusts')).toBeVisible();
    await expect(page.getByTestId('connect-related-settings-wif-JwksMaxKeys')).toBeVisible();
  });
});