import { expect, test, type Page } from '@playwright/test';
import {
  ALL_ENDPOINT_SETTINGS,
  BOOLEAN_FLAGS,
  ENUM_SETTINGS,
  NUMBER_SETTINGS,
} from '../src/pages/endpoint-settings-definitions';
import {
  createFixtureEndpoint,
  deleteFixtureEndpoint,
  E2E_TOKEN,
  seedAuthToken,
} from './endpoint-fixture';

const headers = { Authorization: `Bearer ${E2E_TOKEN}`, Accept: 'application/json' };
let endpointId: string | null = null;

async function configuredNumber(page: Page, id: string, key: string): Promise<unknown> {
  const response = await page.request.get(`/scim/admin/endpoints/${id}`, { headers });
  expect(response.status(), 'numeric setting admin readback').toBe(200);
  const body: { profile?: { settings?: Record<string, unknown> } } = await response.json();
  return body.profile?.settings?.[key];
}

test.beforeEach(async ({ page }) => {
  await seedAuthToken(page);
  endpointId = await createFixtureEndpoint(page, { namePrefix: 'e2e-numeric-settings' });
});

test.afterEach(async ({ page }) => {
  if (!endpointId) return;
  const ownedId = endpointId;
  endpointId = await deleteFixtureEndpoint(page, endpointId);
  const response = await page.request.get('/scim/admin/endpoints', { headers });
  expect(response.status(), 'cleanup inventory must be readable').toBe(200);
  const body: { endpoints: Array<{ id: string }> } = await response.json();
  expect(Array.isArray(body.endpoints)).toBe(true);
  expect(body.endpoints.map((endpoint) => endpoint.id)).not.toContain(ownedId);
});

for (const setting of NUMBER_SETTINGS) {
  test(`${setting.key} persists a valid number and rejects values outside its bounds`, async ({ page }) => {
    const definitions = [...BOOLEAN_FLAGS, ...ENUM_SETTINGS, ...NUMBER_SETTINGS];
    expect(ALL_ENDPOINT_SETTINGS.size).toBe(definitions.length);
    await test.info().attach('registered-settings-inventory', {
      body: JSON.stringify({
        boolean: BOOLEAN_FLAGS.map(({ key }) => key),
        enum: ENUM_SETTINGS.map(({ key }) => key),
        number: NUMBER_SETTINGS.map(({ key, min, max }) => ({ key, min, max })),
        total: ALL_ENDPOINT_SETTINGS.size,
      }, null, 2),
      contentType: 'application/json',
    });

    const id = endpointId!;
    const value = setting.min + 1;
    expect(value).toBeLessThanOrEqual(setting.max);
    await page.goto(`/endpoints/${id}/settings`);
    const tokenLifetime = setting.key === 'OAuthClientTokenTtlSec' || setting.key === 'WifTokenTtlSec';
    const input = tokenLifetime
      ? page.getByTestId(`settings-number-${setting.key}`).locator('input')
      : page.getByTestId(`settings-number-${setting.key}-input`);
    await expect(input).toBeVisible();
    await input.fill(String(value));
    await input.blur();
    await expect(page.getByTestId('settings-feedback-success')).toBeVisible();
    await expect.poll(() => configuredNumber(page, id, setting.key)).toBe(value);
    await page.reload();
    await expect(input).toHaveValue(String(value));
    expect(await configuredNumber(page, id, setting.key)).toBe(value);

    let invalidUpdates = 0;
    page.on('request', (request) => {
      if (request.method() === 'PATCH' && request.url().endsWith(`/scim/admin/endpoints/${id}`)) {
        invalidUpdates++;
      }
    });
    for (const invalid of [setting.min - 1, setting.max + 1]) {
      await input.fill(String(invalid));
      await input.blur();
      if (tokenLifetime) {
        await expect(page.getByText('Enter a whole number of seconds between 60 and 604800.')).toBeVisible();
      } else {
        await expect(page.getByTestId('settings-feedback-error')).toContainText(
          `${setting.min} and ${setting.max}`,
        );
      }
      expect(await configuredNumber(page, id, setting.key)).toBe(value);
    }
    await page.reload();
    await expect(input).toHaveValue(String(value));
    expect(invalidUpdates, 'invalid drafts must not issue an endpoint update').toBe(0);
  });
}
