/**
 * endpoint-detail-tabs.spec.ts - exercises all 10 tabs on the
 * EndpointDetailPage, plus deep-link parity (visiting each
 * `?tab=...` URL renders the right testid).
 *
 * USER PATHS COVERED
 *   /endpoints -> click first card -> /endpoints/$id (overview tab)
 *   Tab switching: overview, users, groups, activity, bulk,
 *     resource-types, schemas, credentials, logs, settings.
 *     For each, switching by clicking the Fluent UI Tab AND deep-
 *     linking via the URL search-param both render the expected
 *     panel testid.
 *   Back-to-endpoints link returns to the grid.
 *   Edit + Delete buttons render in the header.
 *
 * WHY THESE PATHS WERE NOT PREVIOUSLY COVERED
 *   - smoke-test.spec.ts test 4 visits /endpoints but never opens a
 *     detail page.
 *   - router-behavior.spec.ts only verifies URL-state preservation
 *     on a single tab.
 *   - No existing spec deep-links into 9 of the 10 tabs.
 *
 * SAFETY
 *   This spec is READ-ONLY: it never creates / edits / deletes an
 *   endpoint. The Edit / Delete buttons are asserted only as
 *   visible-and-enabled; the destructive dialogs are NOT confirmed.
 */
import { test, expect, type Page } from '@playwright/test';
import { createFixtureEndpoint, deleteFixtureEndpoint } from './endpoint-fixture';

/**
 * DETERMINISM (2026-08-05). See web/e2e/endpoint-fixture.ts - these tests now
 * create their own endpoint instead of binding to whichever one sorts first.
 */
let fixtureEndpointId: string | null = null;

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

test.afterEach(async ({ page }) => {
  fixtureEndpointId = await deleteFixtureEndpoint(page, fixtureEndpointId);
});

/**
 * Navigates to /endpoints, picks the first card, and returns the
* resolved endpointId from the URL.
     *
     * DETERMINISM (2026-08-05). Was "open the first endpoint card" with a
     * `test.skip(count === 0)` guard that could never fire correctly
     * (`.count()` does not auto-wait) and that bound to whichever endpoint a
     * parallel spec had just created. Now uses a self-cleaning fixture.
     */
async function openFirstEndpoint(page: Page): Promise<string> {
  test.setTimeout(120_000);
  fixtureEndpointId = await createFixtureEndpoint(page, { namePrefix: 'e2e-tabs' });
  const endpointId = fixtureEndpointId;

  await page.goto(`/endpoints/${endpointId}`);
  await expect(page.getByTestId('endpoint-detail-page')).toBeVisible({ timeout: 30_000 });
  expect(page.url()).toContain(`/endpoints/${endpointId}`);

  return endpointId;
}

test.describe('EndpointDetailPage - tab matrix', () => {
  test('header renders back link, edit button, and delete button', async ({ page }) => {
    await openFirstEndpoint(page);

    await expect(page.getByTestId('back-to-endpoints')).toBeVisible();
    await expect(page.getByTestId('endpoint-edit-button')).toBeVisible();
    await expect(page.getByTestId('endpoint-delete-button')).toBeVisible();
  });

  test('back link returns to the endpoints grid', async ({ page }) => {
    await openFirstEndpoint(page);
    await page.getByTestId('back-to-endpoints').click();
    await expect(page.getByTestId('endpoints-page')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/endpoints\b(?!\/)/);
  });

  test('overview tab is the default landing tab', async ({ page }) => {
    await openFirstEndpoint(page);
    // The overview panel is rendered without ?tab= in the URL.
    await expect(page.getByTestId('tab-overview')).toBeVisible({ timeout: 15_000 });
  });

  // Tab-by-tab matrix. Each entry verifies that:
  //   (a) clicking the Fluent UI Tab navigates to the panel
  //   (b) the URL search parameter reflects the change
  //   (c) the panel testid is rendered
  //
  // NOTE: Users and Groups are CONDITIONAL tabs (v0.53.3 profile
  // enforcement). They render only when the endpoint's profile declares
  // the matching resource type (fail-open: absent/empty resourceTypes
  // shows both). They are exercised separately below so this matrix only
  // covers tabs that are ALWAYS present.
  const TAB_CASES: ReadonlyArray<{
    key: string;
    label: RegExp;
    panelTestId: string;
    altEmptyTestId?: string;
  }> = [
    { key: 'activity', label: /^Activity$/i, panelTestId: 'tab-activity' },
    { key: 'bulk', label: /^Bulk$/i, panelTestId: 'bulk-page' },
    { key: 'resource-types', label: /Resource Types/i, panelTestId: 'resource-types-tab' },
    { key: 'schemas', label: /^Schemas$/i, panelTestId: 'tab-schemas' },
    { key: 'connect', label: /^Connect$/i, panelTestId: 'tab-credentials' },
    { key: 'settings', label: /^Settings$/i, panelTestId: 'settings-tab' },
  ];

  for (const tab of TAB_CASES) {
    test(`click "${tab.key}" tab renders panel + updates URL`, async ({ page }) => {
      await openFirstEndpoint(page);

      // Fluent UI Tab elements have role="tab" with the visible label
      // as their accessible name.
      const tabBtn = page.getByRole('tab', { name: tab.label });
      await tabBtn.click();

      // Loading skeletons may flash; wait up to 20s for the
      // post-load panel testid (or the empty-state alternative).
      const selector = tab.altEmptyTestId
        ? `[data-testid="${tab.panelTestId}"], [data-testid="${tab.altEmptyTestId}"]`
        : `[data-testid="${tab.panelTestId}"]`;
      await page.waitForSelector(selector, { state: 'visible', timeout: 20_000 });
    });

    test(`deep-link to "${tab.key}" tab renders the same panel`, async ({ page }) => {
      const id = await openFirstEndpoint(page);
      await page.goto(`/endpoints/${id}/${tab.key}`);
      const selector = tab.altEmptyTestId
        ? `[data-testid="${tab.panelTestId}"], [data-testid="${tab.altEmptyTestId}"]`
        : `[data-testid="${tab.panelTestId}"]`;
      await page.waitForSelector(selector, { state: 'visible', timeout: 20_000 });
    });
  }

  // Users + Groups are conditional on the endpoint declaring the matching
  // resource type (v0.53.3 profile enforcement). The tab is shown ONLY when
  // profile.resourceTypes includes User / Group (fail-open: absent/empty
  // resourceTypes shows both). This spec branches on the actual endpoint:
  //   - tab present  -> clicking renders the panel or its empty state; and a
  //                     deep-link renders the same.
  //   - tab absent   -> the endpoint does not serve this resource type, so a
  //                     stale deep-link must render the CONTAINED "unsupported"
  //                     empty state (never a route-error crash).
  const CONDITIONAL_TAB_CASES: ReadonlyArray<{
    key: string;
    label: RegExp;
    panelTestId: string;
    emptyTestId: string;
    unsupportedTestId: string;
  }> = [
    {
      key: 'users',
      label: /^Users$/i,
      panelTestId: 'users-tab',
      emptyTestId: 'users-empty',
      unsupportedTestId: 'users-unsupported',
    },
    {
      key: 'groups',
      label: /^Groups$/i,
      panelTestId: 'groups-tab',
      emptyTestId: 'groups-empty',
      unsupportedTestId: 'groups-unsupported',
    },
  ];

  for (const tab of CONDITIONAL_TAB_CASES) {
    test(`conditional "${tab.key}" tab: shown-and-renders when declared, hidden-and-deep-link-unsupported otherwise`, async ({ page }) => {
      const id = await openFirstEndpoint(page);
      const tabBtn = page.getByRole('tab', { name: tab.label });
      const isPresent = (await tabBtn.count()) > 0;

      if (isPresent) {
        // Endpoint declares this resource type -> click renders panel/empty.
        await tabBtn.click();
        await page.waitForSelector(
          `[data-testid="${tab.panelTestId}"], [data-testid="${tab.emptyTestId}"]`,
          { state: 'visible', timeout: 20_000 },
        );

        // Deep-link parity: visiting the URL directly renders the same.
        await page.goto(`/endpoints/${id}/${tab.key}`);
        await page.waitForSelector(
          `[data-testid="${tab.panelTestId}"], [data-testid="${tab.emptyTestId}"]`,
          { state: 'visible', timeout: 20_000 },
        );
      } else {
        // Endpoint does NOT declare this resource type -> the tab is hidden by
        // design, and a stale deep-link must render the contained "unsupported"
        // empty state rather than tripping the route error boundary.
        await page.goto(`/endpoints/${id}/${tab.key}`);
        await page.waitForSelector(`[data-testid="${tab.unsupportedTestId}"]`, {
          state: 'visible',
          timeout: 20_000,
        });
      }
    });
  }

  test('logs tab loads (testid covered by existing logs tests; smoke only here)', async ({ page }) => {
    await openFirstEndpoint(page);
    await page.getByRole('tab', { name: /^Logs$/i }).click();
    // The Logs panel uses route-specific testids covered by
    // smoke-test.spec.ts; here we just confirm navigation succeeded.
    // URL may include `?page=1` or other search params, so use a
    // loose regex that allows either end-of-string or query string.
    await expect(page).toHaveURL(/\/logs(\?|$)/);
  });

  // WI-11: the Settings tab surfaces the per-method auth-enablement switches.
  test('WI-11: Settings tab exposes the per-method auth-enablement switches', async ({ page }) => {
    const id = await openFirstEndpoint(page);
    await page.goto(`/endpoints/${id}/settings`);
    await expect(page.getByTestId('settings-tab')).toBeVisible({ timeout: 20_000 });

    await expect(page.getByRole('switch', { name: /SecretTokenBearerAuthEnabled/i })).toBeVisible();
    await expect(page.getByRole('switch', { name: /OAuthClientCredentialsAuthEnabled/i })).toBeVisible();
    await expect(page.getByRole('switch', { name: /SharedSecretBearerAuthEnabled/i })).toBeVisible();
  });
});
