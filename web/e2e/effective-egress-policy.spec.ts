import { test, expect } from '@playwright/test';
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

test('WIF/JWKS effective values support Edit, Save, Cancel, and Reset to inherit', async ({ page }) => {
  test.setTimeout(120_000);
  fixtureEndpointId = await createFixtureEndpoint(page, {
    namePrefix: 'e2e-effective-egress',
    settings: {
      WifCredentialsEnabled: true,
      JwksFetchTimeoutMs: 1200,
      JwksFetchRetries: 4,
    },
  });

  await page.goto(`/endpoints/${fixtureEndpointId}/connect?method=wif`);
  await expect(page.getByTestId('connect-related-settings-wif')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('connect-related-settings-wif-toggle').click();

  await expect(page.getByTestId('connect-related-settings-wif-effective-JwksFetchTimeoutMs')).toContainText('1200 ms');
  await expect(page.getByTestId('connect-related-settings-wif-source-JwksFetchTimeoutMs')).toContainText('Endpoint override');
  await expect(page.getByTestId('connect-related-settings-wif-bounds-JwksFetchTimeoutMs')).toContainText('100 - 60000 ms');

  await page.getByTestId('connect-related-settings-wif-egress-edit').click();
  const timeoutDraft = page.getByTestId('connect-related-settings-wif-JwksFetchTimeoutMs-draft');
  await timeoutDraft.fill('1400');
  const retriesDraft = page.getByTestId('connect-related-settings-wif-JwksFetchRetries-draft');
  await retriesDraft.fill('6');
  await page.getByTestId('connect-related-settings-wif-egress-cancel').click();
  await page.getByTestId('connect-related-settings-wif-egress-edit').click();
  await expect(timeoutDraft).toHaveValue('1200');
  await expect(retriesDraft).toHaveValue('4');
  await timeoutDraft.fill('1400');
  await page.getByTestId('connect-related-settings-wif-egress-save').click();

  await expect.poll(async () => {
    const response = await page.request.get(
      `/scim/admin/endpoints/${fixtureEndpointId}/egress-policy`,
      { headers: { Authorization: `Bearer ${E2E_TOKEN}` } },
    );
    const body = await response.json();
    return body.timeoutMs;
  }).toEqual(expect.objectContaining({ effective: 1400, configured: 1400, source: 'endpoint' }));
  await expect(page.getByTestId('connect-related-settings-wif-effective-JwksFetchTimeoutMs')).toContainText('1400 ms');

  await page.getByTestId('connect-related-settings-wif-egress-edit').click();
  await page.getByTestId('connect-related-settings-wif-JwksFetchTimeoutMs-reset').click();
  await page.getByTestId('connect-related-settings-wif-egress-save').click();

  await expect.poll(async () => {
    const response = await page.request.get(
      `/scim/admin/endpoints/${fixtureEndpointId}/egress-policy`,
      { headers: { Authorization: `Bearer ${E2E_TOKEN}` } },
    );
    const body = await response.json();
    return body.timeoutMs;
  }).toEqual(expect.objectContaining({ configured: null }));
  await expect(page.getByTestId('connect-related-settings-wif-source-JwksFetchTimeoutMs')).not.toContainText('Endpoint override');

  await page.setViewportSize({ width: 900, height: 900 });
  const bounds = await page.getByTestId('connect-related-settings-wif-egress-policy').evaluate((element) => {
    const panel = element.getBoundingClientRect();
    return {
      panelRight: panel.right,
      viewportWidth: document.documentElement.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(bounds.panelRight).toBeLessThanOrEqual(bounds.viewportWidth + 1);
  expect(bounds.pageOverflow).toBeLessThanOrEqual(1);
});
