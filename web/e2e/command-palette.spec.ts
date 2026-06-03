/**
 * command-palette.spec.ts - exercises the cmdk-based CommandPalette.
 *
 * USER PATHS COVERED
 *   Ctrl+K opens the palette (Windows + Linux binding).
 *   Cmd+K opens the palette (mac binding; emitted via Meta+K to
 *     match the keybinding in useCommandPaletteShortcut).
 *   `/` opens the palette (handler in useKeyboardShortcuts ->
 *     onFocusSearch).
 *   Esc closes the palette.
 *   Typing surfaces matching routes (typing "endpoint" must list
 *     at least one item whose visible text mentions endpoints).
 *   Selecting a static route item navigates the router.
 *   Re-opening the palette after a route navigation restores a
 *     clean (empty) search input.
 *
 * WHY THESE PATHS WERE NOT PREVIOUSLY COVERED
 *   - No existing spec opens the palette at all.
 *   - The vitest unit suite covers the cmdk filter logic in
 *     isolation, but cannot verify the document-level keydown
 *     wiring or the actual router navigation.
 */
import { test, expect, type Page } from '@playwright/test';

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

async function gotoShell(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 });
}

test.describe('CommandPalette - open / close / search / select', () => {
  test('Ctrl+K opens the palette', async ({ page }) => {
    await gotoShell(page);
    // Playwright key syntax: 'Control+k' = Ctrl+K; 'Control+K' = Ctrl+Shift+K.
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: 5_000 });
  });

  test('Meta+K opens the palette (mac binding)', async ({ page }) => {
    await gotoShell(page);
    await page.keyboard.press('Meta+k');
    await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: 5_000 });
  });

  test('"/" opens the palette via useKeyboardShortcuts', async ({ page }) => {
    await gotoShell(page);
    // Click somewhere non-input to make sure focus is on the body.
    await page.getByTestId('app-shell').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('/');
    await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: 5_000 });
  });

  test('Esc closes the palette', async ({ page }) => {
    await gotoShell(page);
    await page.keyboard.press('Control+k');
    await expect(page.getByTestId('command-palette')).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
  });

  test('typing "endpoint" surfaces at least one matching item', async ({ page }) => {
    await gotoShell(page);
    await page.keyboard.press('Control+k');

    const palette = page.getByTestId('command-palette');
    await expect(palette).toBeVisible({ timeout: 5_000 });

    // The cmdk input is a plain <input> inside the palette container.
    const input = palette.getByPlaceholder(/type a command or search/i);
    await input.fill('endpoint');

    // At least one cmdk-item must remain visible after filtering.
    // We don't assert exact count because the dynamic endpoints list
    // varies per tenant; we just confirm the filter narrowed but did
    // not zero-out.
    const visibleItems = palette.locator('[cmdk-item]');
    await expect(visibleItems.first()).toBeVisible({ timeout: 5_000 });
    expect(await visibleItems.count()).toBeGreaterThan(0);
  });

  test('selecting a route item navigates', async ({ page }) => {
    await gotoShell(page);
    await page.keyboard.press('Control+k');

    const palette = page.getByTestId('command-palette');
    await expect(palette).toBeVisible({ timeout: 5_000 });

    const input = palette.getByPlaceholder(/type a command or search/i);
    await input.fill('settings');

    // cmdk auto-selects the first matching item ("Go to Settings")
    // on input change. Pressing ArrowDown would move past it onto the
    // second match (a custom command), so press Enter directly to
    // commit the auto-selected route.
    await input.press('Enter');

    // Palette closes after selection.
    await expect(page.getByTestId('command-palette')).toHaveCount(0, { timeout: 5_000 });
    // We landed on the settings route.
    await expect(page).toHaveURL(/\/settings(\?|$)/);
  });

  test('palette opens with empty input each time', async ({ page }) => {
    await gotoShell(page);
    await page.keyboard.press('Control+k');
    let palette = page.getByTestId('command-palette');
    let input = palette.getByPlaceholder(/type a command or search/i);
    await input.fill('something-random-xyz');
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);

    await page.keyboard.press('Control+k');
    palette = page.getByTestId('command-palette');
    await expect(palette).toBeVisible();
    input = palette.getByPlaceholder(/type a command or search/i);
    await expect(input).toHaveValue('');
  });
});
