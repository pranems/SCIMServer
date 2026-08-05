/**
 * discovery-explorer.spec.ts - exercises the Discovery Explorer page
 * (/discovery), which had vitest but no Playwright coverage.
 *
 * USER PATHS COVERED
 *   /discovery -> primary endpoint picker -> the three discovery sub-tabs
 *   (ServiceProviderConfig | Resource types | Schemas) render, switch, and
 *   expose the copy/refetch affordances. The single-vs-compare toggle reveals
 *   the secondary picker for side-by-side diffing.
 *
 * SAFETY
 *   READ-ONLY. Discovery is all GETs (ServiceProviderConfig / ResourceTypes /
 *   Schemas); the spec never mutates anything. It skips gracefully when the
 *   tenant has zero endpoints.
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

/**
 * DETERMINISM (2026-08-05). `openDiscovery` used to click the FIRST option in
 * the primary picker. The admin list is ordered `createdAt DESC`, so that
 * option was whichever endpoint a parallel spec had just created - and when
 * that spec deleted its fixture, the discovery fetch for it failed and the
 * section never mounted. Observed as `discovery-spc-section` not found.
 *
 * It now creates its own endpoint and selects that specific option by id.
 */
let fixtureEndpointId: string | null = null;

test.afterEach(async ({ page }) => {
  fixtureEndpointId = await deleteFixtureEndpoint(page, fixtureEndpointId);
});

async function openDiscovery(page: Page): Promise<void> {
  test.setTimeout(120_000);
  fixtureEndpointId = await createFixtureEndpoint(page, { namePrefix: 'e2e-discovery' });

  await page.goto('/discovery');
  await expect(page.getByTestId('discovery-page')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('discovery-primary-picker')).toBeVisible({ timeout: 30_000 });

  // The discovery surfaces only render once a PRIMARY endpoint is picked (the
  // picker does NOT auto-select). Select OUR endpoint by id so no other spec's
  // lifecycle can affect this one.
  const option = page.getByTestId(`discovery-primary-option-${fixtureEndpointId}`);
  await expect(option, 'the fixture endpoint must appear in the discovery picker').toBeVisible({
    timeout: 30_000,
  });
  await option.click();
}

test.describe('Discovery Explorer (/discovery)', () => {
  test('the page renders the primary picker + the three sub-tabs', async ({ page }) => {
    await openDiscovery(page);
    await expect(page.getByTestId('discovery-subtabs')).toBeVisible();
    await expect(page.getByTestId('discovery-tab-serviceProviderConfig')).toBeVisible();
    await expect(page.getByTestId('discovery-tab-resourceTypes')).toBeVisible();
    await expect(page.getByTestId('discovery-tab-schemas')).toBeVisible();
  });

  test('the ServiceProviderConfig tab renders its section + copy affordances', async ({ page }) => {
    await openDiscovery(page);
    await page.getByTestId('discovery-tab-serviceProviderConfig').click();
    await expect(page.getByTestId('discovery-spc-section')).toBeVisible({ timeout: 20_000 });
    // The copy-as-JSON + refetch controls are present for the current surface.
    await expect(page.getByTestId('discovery-copy-json')).toBeVisible();
    await expect(page.getByTestId('discovery-refetch')).toBeVisible();
  });

  test('switching to the Resource types tab renders its section', async ({ page }) => {
    await openDiscovery(page);
    await page.getByTestId('discovery-tab-resourceTypes').click();
    await expect(page.getByTestId('discovery-resourcetypes-section')).toBeVisible({ timeout: 20_000 });
  });

  test('the compare toggle reveals the secondary endpoint picker', async ({ page }) => {
    await openDiscovery(page);
    const toggle = page.getByTestId('discovery-toggle-compare');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.getByTestId('discovery-secondary-picker')).toBeVisible({ timeout: 10_000 });
  });
});
