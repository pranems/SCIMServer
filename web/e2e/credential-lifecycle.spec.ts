import { test, expect, type Page } from '@playwright/test';
import {
  createFixtureEndpoint,
  deleteFixtureEndpoint,
  seedAuthToken,
  E2E_TOKEN,
} from './endpoint-fixture';

let fixtureEndpointId: string | null = null;

test.beforeEach(async ({ page }) => {
  await seedAuthToken(page);
});

test.afterEach(async ({ page }) => {
  fixtureEndpointId = await deleteFixtureEndpoint(page, fixtureEndpointId);
});

async function createCredential(
  page: Page,
  endpointId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await page.request.post(
    `/scim/admin/endpoints/${endpointId}/credentials`,
    { headers: { Authorization: `Bearer ${E2E_TOKEN}` }, data: body },
  );
  expect(response.status()).toBe(201);
  return response.json() as Promise<Record<string, unknown>>;
}

async function listCredentials(page: Page, endpointId: string): Promise<Array<Record<string, unknown>>> {
  const response = await page.request.get(
    `/scim/admin/endpoints/${endpointId}/credentials`,
    { headers: { Authorization: `Bearer ${E2E_TOKEN}` } },
  );
  expect(response.status()).toBe(200);
  return response.json() as Promise<Array<Record<string, unknown>>>;
}

test.describe('Connect credential lifecycle', () => {
  test('Rotate is atomic and the replacement supports deactivate, activate, and confirmed purge', async ({ page }) => {
    test.setTimeout(120_000);
    fixtureEndpointId = await createFixtureEndpoint(page, {
      namePrefix: 'e2e-credential-lifecycle',
      settings: { SecretTokenBearerAuthEnabled: true },
    });
    const original = await createCredential(page, fixtureEndpointId, {
      credentialType: 'bearer',
      label: 'browser lifecycle',
    });
    const originalId = original.id as string;

    await page.goto(`/endpoints/${fixtureEndpointId}/connect`);
    await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId(`credential-rotate-${originalId}`).click();
    await expect(page.getByTestId('credentials-rotate-dialog')).toBeVisible();
    await expect(page.getByTestId('credentials-rotate-value')).not.toHaveText('');
    await page.getByTestId('credentials-rotate-dialog-submit').click();

    const afterRotate = await listCredentials(page, fixtureEndpointId);
    const originalRow = afterRotate.find((row) => row.id === originalId);
    const replacement = afterRotate.find((row) => row.id !== originalId && row.active === true);
    expect(originalRow?.active).toBe(false);
    expect(replacement?.id).toBeTruthy();
    const replacementId = replacement!.id as string;

    await page.reload();
    await expect(page.getByTestId(`credential-row-${replacementId}`)).toBeVisible({ timeout: 30_000 });
    await page.getByTestId(`credential-more-${replacementId}`).click();
    await page.getByTestId(`credential-toggle-active-${replacementId}`).click();
    await expect(page.getByTestId(`credential-summary-${replacementId}`)).toContainText('Inactive');
    await expect(page.getByTestId(`credential-rotate-${replacementId}`)).toHaveCount(0);

    await page.getByTestId(`credential-more-${replacementId}`).click();
    await page.getByTestId(`credential-toggle-active-${replacementId}`).click();
    await expect(page.getByTestId(`credential-summary-${replacementId}`)).toContainText('Active');
    await expect(page.getByTestId(`credential-rotate-${replacementId}`)).toBeVisible();

    await page.getByTestId(`credential-more-${replacementId}`).click();
    await page.getByTestId(`credential-toggle-active-${replacementId}`).click();
    await expect(page.getByTestId(`credential-summary-${replacementId}`)).toContainText('Inactive');
    await page.getByTestId(`credential-more-${replacementId}`).click();
    await page.getByTestId(`credential-purge-${replacementId}`).click();
    const purgeDialog = page.getByTestId('credentials-purge-dialog');
    await expect(purgeDialog).toContainText('cannot be undone');
    await purgeDialog.getByRole('button', { name: 'Permanently delete' }).click();
    await expect(page.getByTestId(`credential-row-${replacementId}`)).toHaveCount(0);
  });

  test('an inactive WIF trust has the same confirmed permanent cleanup path', async ({ page }) => {
    test.setTimeout(120_000);
    fixtureEndpointId = await createFixtureEndpoint(page, {
      namePrefix: 'e2e-wif-lifecycle',
      settings: { WifCredentialsEnabled: true },
    });
    const trust = await createCredential(page, fixtureEndpointId, {
      credentialType: 'wif',
      label: 'browser WIF lifecycle',
      wif: {
        expectedIssuer: 'https://login.microsoftonline.com/browser-tenant/v2.0',
        expectedSubject: 'browser-service-principal',
        expectedAudience: 'api://browser-scim',
        jwksUri: 'https://login.microsoftonline.com/browser-tenant/discovery/v2.0/keys',
        allowedTenantId: 'browser-tenant',
      },
    });
    const trustId = trust.id as string;

    await page.goto(`/endpoints/${fixtureEndpointId}/connect`);
    await expect(page.getByTestId('wif-section')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId(`wif-credential-more-${trustId}`).click();
    await expect(page.getByTestId(`wif-credential-purge-${trustId}`)).toHaveCount(0);
    await page.getByTestId(`wif-credential-delete-${trustId}`).click();
    await expect(page.getByTestId(`wif-credential-summary-${trustId}`)).toContainText('Inactive');

    await page.getByTestId(`wif-credential-more-${trustId}`).click();
    await page.getByTestId(`wif-credential-purge-${trustId}`).click();
    const purgeDialog = page.getByTestId('credentials-purge-dialog');
    await expect(purgeDialog).toContainText('browser WIF lifecycle');
    await purgeDialog.getByRole('button', { name: 'Permanently delete' }).click();
    await expect(page.getByTestId(`wif-credential-row-${trustId}`)).toHaveCount(0);
  });
});
