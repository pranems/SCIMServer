import { test, expect, type Page } from '@playwright/test';

const token = process.env.E2E_TOKEN || 'changeme-scim';
const headers = { Authorization: `Bearer ${token}` };

async function expandRelatedSettings(page: Page, method: 'oauth_client' | 'wif'): Promise<void> {
  const toggle = page.getByTestId(`connect-related-settings-${method}-toggle`).getByRole('button');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

test('endpoint token lifetimes persist across Connect and Settings and control real OAuth issuance', async ({ page, request }) => {
  test.setTimeout(90_000);
  const created = await request.post('/scim/admin/endpoints', {
    headers,
    data: {
      name: `token-ttl-${Date.now()}`,
      profilePreset: 'rfc-standard',
    },
  });
  expect(created.status()).toBe(201);
  const endpoint = await created.json();
  try {
    const enabled = await request.patch(`/scim/admin/endpoints/${endpoint.id}`, {
      headers,
      data: { profile: { settings: { OAuthClientCredentialsAuthEnabled: true, WifCredentialsEnabled: true } } },
    });
    expect(enabled.status()).toBe(200);
    await page.addInitScript((value) => {
      localStorage.setItem('scimserver.authToken', value);
      localStorage.setItem('scimserver.onboarding.completedAt', '2026-10-20T00:00:00Z');
    }, token);
    await page.goto(`/endpoints/${endpoint.id}/connect`);
    await page.getByTestId('credentials-method-tab-oauth_client').click();
    await expandRelatedSettings(page, 'oauth_client');
    const oauth = page.getByTestId('connect-related-settings-oauth_client-OAuthClientTokenTtlSec-input');
    await expect(oauth).toHaveValue('');
    await expect(oauth).toHaveAttribute('placeholder', 'server default: 3600');
    await page.getByTestId('connect-related-settings-oauth_client-OAuthClientTokenTtlSec-presets').click();
    const saved = page.waitForResponse((response) =>
      response.url().endsWith(`/scim/admin/endpoints/${endpoint.id}`) &&
      response.request().method() === 'PATCH');
    await page.getByRole('option', { name: '1 week (604800 seconds)', exact: true }).click();
    expect((await saved).status()).toBe(200);
    await page.reload();
    await page.getByTestId('credentials-method-tab-oauth_client').click();
    await expandRelatedSettings(page, 'oauth_client');
    await expect(oauth).toHaveValue('604800');
    for (const width of [1440, 900]) {
      await page.setViewportSize({ width, height: 900 });
      for (const suffix of ['-input', '-presets']) {
        const bounds = await page.getByTestId(`connect-related-settings-oauth_client-OAuthClientTokenTtlSec${suffix}`)
          .evaluate((element) => {
            const box = element.getBoundingClientRect();
            return { left: box.left, right: box.right, width: box.width, viewport: window.innerWidth };
          });
        expect(bounds.width).toBeGreaterThan(40);
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    const credentialResponse = await request.post(`/scim/admin/endpoints/${endpoint.id}/credentials`, {
      headers, data: { credentialType: 'oauth_client' },
    });
    expect(credentialResponse.status()).toBe(201);
    const credential = await credentialResponse.json();
    const minted = await request.post(`/scim/endpoints/${endpoint.id}/oauth/token`, {
      form: {
        grant_type: 'client_credentials',
        client_id: credential.clientId,
        client_secret: credential.clientSecret,
      },
    });
    expect(minted.status()).toBe(200);
    const result = await minted.json();
    expect(result.expires_in).toBe(604800);
    const payload = JSON.parse(Buffer.from(result.access_token.split('.')[1], 'base64url').toString());
    expect(payload.exp - payload.iat).toBe(604800);

    await oauth.fill('61');
    await page.getByTestId('connect-related-settings-oauth_client-OAuthClientTokenTtlSec-undo-button').click();
    await expect(oauth).toHaveValue('604800');
    await page.getByTestId('connect-related-settings-oauth_client-OAuthClientTokenTtlSec-redo-button').click();
    await expect(oauth).toHaveValue('61');
    const customSaved = page.waitForResponse((response) =>
      response.url().endsWith(`/scim/admin/endpoints/${endpoint.id}`) &&
      response.request().method() === 'PATCH');
    await oauth.focus();
    await oauth.blur();
    expect((await customSaved).status()).toBe(200);
    const customMint = await request.post(`/scim/endpoints/${endpoint.id}/oauth/token`, {
      form: { grant_type: 'client_credentials', client_id: credential.clientId, client_secret: credential.clientSecret },
    });
    expect((await customMint.json()).expires_in).toBe(61);

    await page.getByTestId('credentials-method-tab-wif').click();
    await expandRelatedSettings(page, 'wif');
    const wif = page.getByTestId('connect-related-settings-wif-WifTokenTtlSec-input');
    await expect(wif).toHaveValue('');
    await expect(wif).toHaveAttribute('placeholder', 'server default: 3600');
    await wif.fill('10800');
    await expect(wif).toHaveValue('10800');
    await expect(wif).toBeFocused();
    const wifSaved = page.waitForResponse((response) =>
      response.url().endsWith(`/scim/admin/endpoints/${endpoint.id}`) &&
      response.request().method() === 'PATCH');
    await wif.blur();
    expect((await wifSaved).status()).toBe(200);
    await page.goto(`/endpoints/${endpoint.id}/settings`);
    await expect(page.getByTestId('settings-number-OAuthClientTokenTtlSec')).toHaveCount(1);
    await expect(page.getByTestId('settings-number-WifTokenTtlSec')).toHaveCount(1);
    await expect(page.getByTestId('settings-number-OAuthClientTokenTtlSec-input')).toHaveValue('61');
    await expect(page.getByTestId('settings-number-WifTokenTtlSec-input')).toHaveValue('10800');

    await page.getByTestId('settings-number-WifTokenTtlSec-presets').click();
    const settingsSaved = page.waitForResponse((response) =>
      response.url().endsWith(`/scim/admin/endpoints/${endpoint.id}`) &&
      response.request().method() === 'PATCH');
    await page.getByRole('option', { name: '1 minute (60 seconds)', exact: true }).click();
    expect((await settingsSaved).status()).toBe(200);
    await page.goto(`/endpoints/${endpoint.id}/connect`);
    await page.getByTestId('credentials-method-tab-wif').click();
    await expandRelatedSettings(page, 'wif');
    await expect(wif).toHaveValue('60');
    for (const invalid of ['59', '604801', '60.5', 'invalid']) {
      await wif.fill(invalid);
      await wif.blur();
      await expect(page.getByText('Enter a whole number of seconds between 60 and 604800.')).toBeVisible();
    }
    const stored = await request.get(`/scim/admin/endpoints/${endpoint.id}`, { headers });
    expect((await stored.json()).profile.settings.WifTokenTtlSec).toBe(60);
  } finally {
    const removed = await request.delete(`/scim/admin/endpoints/${endpoint.id}`, { headers });
    expect(removed.ok()).toBeTruthy();
  }
});
