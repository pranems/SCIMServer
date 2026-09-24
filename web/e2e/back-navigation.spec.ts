import { test, expect } from '@playwright/test';
import {
  createFixtureEndpointWithUsers,
  deleteFixtureEndpoint,
  seedAuthToken,
} from './endpoint-fixture';

let fixtureEndpointId: string | null = null;
let secondaryFixtureEndpointId: string | null = null;

test.beforeEach(async ({ page }) => {
  await seedAuthToken(page);
});

test.afterEach(async ({ page }) => {
  fixtureEndpointId = await deleteFixtureEndpoint(page, fixtureEndpointId);
  secondaryFixtureEndpointId = await deleteFixtureEndpoint(page, secondaryFixtureEndpointId);
});

test.describe('Context-preserving Back navigation', () => {
  test('endpoint Back restores the filtered endpoint list', async ({ page }) => {
    test.setTimeout(120_000);
    const prefix = `e2e-back-list-${Date.now()}`;
    const fixture = await createFixtureEndpointWithUsers(page, {
      namePrefix: prefix,
      users: 1,
    });
    fixtureEndpointId = fixture.endpointId;

    await page.goto(`/endpoints?q=${encodeURIComponent(prefix)}`);
    const search = page.getByPlaceholder('Filter endpoints...');
    await expect(search).toHaveValue(prefix);
    await page.getByTestId(`endpoint-${fixtureEndpointId}`).click();
    await expect(page.getByTestId('endpoint-detail-page')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('back-to-endpoints').click();

    await expect(page).toHaveURL(new RegExp(`/endpoints\\?q=${encodeURIComponent(prefix)}$`));
    await expect(search).toHaveValue(prefix);
    await expect(page.getByTestId(`endpoint-${fixtureEndpointId}`)).toBeVisible();
  });

  test('edit Cancel and Save restore the exact Users tab, filters, page, and drawer state', async ({ page }) => {
    test.setTimeout(120_000);
    const fixture = await createFixtureEndpointWithUsers(page, {
      namePrefix: 'e2e-back-edit',
      users: 1,
    });
    fixtureEndpointId = fixture.endpointId;
    const userId = fixture.users[0].id;
    const expectedPath = `/endpoints/${fixtureEndpointId}/users`;
    const expectedSearch = `page=1&pageSize=20&filter=active%20eq%20true&detail=${userId}`;
    const expectedUrl = `${expectedPath}?${expectedSearch}`;

    await page.goto(expectedUrl);
    await expect(page.getByTestId('resource-detail-drawer')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('endpoint-edit-button').dispatchEvent('click');
    await expect(page.getByTestId('edit-endpoint-page')).toBeVisible();

    await page.getByTestId('edit-endpoint-cancel-button').click();

    await expect(page).toHaveURL(expectedUrl);
    await expect(page.getByTestId('endpoint-tab-users')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('resource-detail-drawer')).toBeVisible();

    await page.getByTestId('endpoint-edit-button').dispatchEvent('click');
    const displayName = page.getByTestId('edit-endpoint-displayname-input');
    await displayName.fill(`Back restored ${Date.now()}`);
    await page.getByTestId('edit-endpoint-save-button').click();

    await expect(page).toHaveURL(expectedUrl);
    await expect(page.getByTestId('endpoint-tab-users')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('resource-detail-drawer')).toBeVisible();
  });

  test('Back restores Connect, Operations, and Discovery subtab and filter state', async ({ page }) => {
    test.setTimeout(120_000);
    const primary = await createFixtureEndpointWithUsers(page, {
      namePrefix: 'e2e-back-workflows-primary',
      settings: { WifCredentialsEnabled: true },
      users: 1,
    });
    fixtureEndpointId = primary.endpointId;
    const secondary = await createFixtureEndpointWithUsers(page, {
      namePrefix: 'e2e-back-workflows-secondary',
      users: 1,
    });
    secondaryFixtureEndpointId = secondary.endpointId;

    const connectUrl = `/endpoints/${fixtureEndpointId}/connect?method=wif`;
    await page.goto(connectUrl);
    await expect(page.getByTestId('credentials-method-tab-wif')).toHaveAttribute('aria-selected', 'true');

    const operationsUrl = '/operations?tab=groups&groupSearch=fixture&groupPage=1&userPage=1';
    await page.goto(operationsUrl);
    await expect(page.getByTestId('operations-tab-groups')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('operations-groups-search')).toHaveValue('fixture');

    const discoveryUrl = `/discovery?primaryId=${fixtureEndpointId}&compare=true&secondaryId=${secondaryFixtureEndpointId}&tab=schemas`;
    await page.goto(discoveryUrl);
    await expect(page.getByTestId('discovery-tab-schemas')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId(`discovery-primary-option-${fixtureEndpointId}`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId(`discovery-secondary-option-${secondaryFixtureEndpointId}`)).toHaveAttribute('aria-pressed', 'true');

    await page.goBack();
    await expect(page).toHaveURL(operationsUrl);
    await expect(page.getByTestId('operations-tab-groups')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('operations-groups-search')).toHaveValue('fixture');

    await page.goBack();
    await expect(page).toHaveURL(connectUrl);
    await expect(page.getByTestId('credentials-method-tab-wif')).toHaveAttribute('aria-selected', 'true');
  });
});
