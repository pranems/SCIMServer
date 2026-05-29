/**
 * Phase N5 - Frontend telemetry
 *
 * Smoke spec exercising the SettingsPage TelemetryCard on the live UI.
 * Navigates to /settings and asserts the telemetry card + its 4
 * primary controls (opt-in switch, clear button, empty state OR
 * first event row) render and are interactable.
 *
 * Why a smoke (not a full record/clear assertion)?
 *  - The ring + TTL + opt-in gating is locked at the Vitest layer
 *    (see web/src/store/telemetry-store.test.ts +
 *    web/src/store/telemetry-collectors.test.ts +
 *    web/src/pages/SettingsPage.test.tsx).
 *  - This spec is the BROWSER-side lock that the wire (testid
 *    presence, TelemetryCard mount, controls visible) shipped to dev.
 *
 * Usage:
 *   cd web
 *   $env:E2E_BASE_URL = 'https://scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io'
 *   npx playwright test telemetry.spec.ts
 */
import { test, expect } from '@playwright/test';

const TOKEN_STORAGE_KEY = 'scimserver.authToken';
const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Best-effort seed for hosted e2e runs.
      }
    },
    { key: TOKEN_STORAGE_KEY, value: TOKEN },
  );
});

test.describe('Phase N5 - Frontend telemetry (smoke vs dev FQDN)', () => {
  test('SettingsPage exposes TelemetryCard with opt-in switch + clear button', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    const card = page.getByTestId('settings-telemetry-card');
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Opt-in switch + clear button must render. The empty-state caption
    // OR the first event row will be present depending on whether the
    // SPA emitted a navigation event before the smoke loaded.
    await expect(page.getByTestId('settings-telemetry-opt-in')).toBeVisible();
    await expect(page.getByTestId('settings-telemetry-clear')).toBeVisible();

    const emptyState = page.getByTestId('settings-telemetry-empty');
    const firstRow = page.getByTestId('settings-telemetry-row-0');
    const eitherVisible = (await emptyState.isVisible()) || (await firstRow.isVisible());
    expect(eitherVisible).toBe(true);
  });
});
