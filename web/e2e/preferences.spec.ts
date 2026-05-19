/**
 * Phase N4 - Settings persistence
 *
 * Smoke spec exercising the SettingsPage PreferencesCard on the live UI.
 * Navigates to /settings and asserts the preferences card + its 4 controls
 * (page-size dropdown, dense-mode switch, sidebar-collapsed switch, reset)
 * render and are interactable.
 *
 * Why a smoke (not a full persistence assertion)?
 *  - The Zustand store + localStorage round-trip is locked at the Vitest
 *    layer (see web/src/store/preferences-store.test.ts +
 *    web/src/pages/SettingsPage.test.tsx).
 *  - This spec is the BROWSER-side lock that the wire (testid presence,
 *    PreferencesCard mount, controls visible) shipped to dev.
 *
 * Usage:
 *   cd web
 *   $env:E2E_BASE_URL = 'https://scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io'
 *   npx playwright test preferences.spec.ts
 */
import { test, expect } from '@playwright/test';

test.describe('Phase N4 - Settings persistence (smoke vs dev FQDN)', () => {
  test('SettingsPage exposes PreferencesCard with its 4 controls', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // PreferencesCard should mount at the bottom of the Settings page.
    const card = page.getByTestId('settings-preferences-card');
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Each of the 4 controls must be present and visible.
    await expect(page.getByTestId('settings-preferences-default-page-size')).toBeVisible();
    await expect(page.getByTestId('settings-preferences-dense-mode')).toBeVisible();
    await expect(page.getByTestId('settings-preferences-sidebar-collapsed-default')).toBeVisible();
    await expect(page.getByTestId('settings-preferences-reset')).toBeVisible();
  });
});
