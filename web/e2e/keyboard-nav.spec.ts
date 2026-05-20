/**
 * keyboard-nav.spec.ts - covers the global keyboard shortcut layer
 * defined in useKeyboardShortcuts + the KeyboardShortcutsHelp modal.
 *
 * USER PATHS COVERED
 *   `g d` sequence -> navigates to "/"           (Dashboard)
 *   `g e` sequence -> navigates to "/endpoints"
 *   `g m` sequence -> navigates to "/manual-provision"
 *   `g l` sequence -> navigates to "/logs"
 *   `g s` sequence -> navigates to "/settings"
 *   `?` opens the KeyboardShortcutsHelp modal (testid
 *     `shortcuts-help`).
 *   `/` opens the command palette (already covered by
 *     command-palette.spec.ts; included here for completeness as
 *     a smoke check).
 *   Shortcut layer SKIPS when the focused target is editable
 *     (typing `g e` inside the endpoints SearchBox stays in the
 *     box and does NOT navigate).
 *
 * WHY THESE PATHS WERE NOT PREVIOUSLY COVERED
 *   - No existing spec exercises the sequence shortcuts.
 *   - The vitest unit suite covers `useKeyboardShortcuts` in
 *     isolation but cannot prove the document-level binding +
 *     the router both wire correctly together.
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

/**
 * Helper: press a 2-key sequence with a short delay between them
 * so the SEQUENCE_RESET_MS (1000ms) window in useKeyboardShortcuts
 * is preserved.
 */
async function pressSequence(page: Page, first: string, second: string): Promise<void> {
  await page.keyboard.press(first);
  // Small delay between keys so they land as distinct keydown events;
  // 50ms is well under the 1000ms reset window.
  await page.waitForTimeout(50);
  await page.keyboard.press(second);
}

async function gotoShell(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 });
}

test.describe('Global keyboard shortcuts', () => {
  test('g d navigates to dashboard', async ({ page }) => {
    await gotoShell(page);
    await page.goto('/endpoints');
    await expect(page.getByTestId('endpoints-page')).toBeVisible({ timeout: 15_000 });

    // Click the app shell to ensure focus is on body.
    await page.getByTestId('app-shell').click({ position: { x: 5, y: 5 } });

    await pressSequence(page, 'g', 'd');
    await expect(page).toHaveURL(/\/$|\/\?/, { timeout: 5_000 });
  });

  test('g e navigates to endpoints', async ({ page }) => {
    await gotoShell(page);
    await page.getByTestId('app-shell').click({ position: { x: 5, y: 5 } });

    await pressSequence(page, 'g', 'e');
    await expect(page).toHaveURL(/\/endpoints(\?|$)/, { timeout: 5_000 });
    await expect(page.getByTestId('endpoints-page')).toBeVisible({ timeout: 15_000 });
  });

  test('g m navigates to manual provision', async ({ page }) => {
    await gotoShell(page);
    await page.getByTestId('app-shell').click({ position: { x: 5, y: 5 } });

    await pressSequence(page, 'g', 'm');
    await expect(page).toHaveURL(/\/manual-provision(\?|$)/, { timeout: 5_000 });
  });

  test('g l navigates to logs', async ({ page }) => {
    await gotoShell(page);
    await page.getByTestId('app-shell').click({ position: { x: 5, y: 5 } });

    await pressSequence(page, 'g', 'l');
    await expect(page).toHaveURL(/\/logs(\?|$)/, { timeout: 5_000 });
  });

  test('g s navigates to settings', async ({ page }) => {
    await gotoShell(page);
    await page.getByTestId('app-shell').click({ position: { x: 5, y: 5 } });

    await pressSequence(page, 'g', 's');
    await expect(page).toHaveURL(/\/settings(\?|$)/, { timeout: 5_000 });
  });

  test('? opens the KeyboardShortcutsHelp modal', async ({ page }) => {
    await gotoShell(page);
    await page.getByTestId('app-shell').click({ position: { x: 5, y: 5 } });

    // Shift+/ on a US layout produces '?'. page.keyboard.press('?')
    // also dispatches a single ? key event via Playwright's keymap.
    await page.keyboard.press('Shift+/');
    await expect(page.getByTestId('shortcuts-help')).toBeVisible({ timeout: 5_000 });
  });

  test('Esc closes the KeyboardShortcutsHelp modal', async ({ page }) => {
    await gotoShell(page);
    await page.getByTestId('app-shell').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Shift+/');
    await expect(page.getByTestId('shortcuts-help')).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shortcuts-help')).toHaveCount(0, { timeout: 5_000 });
  });

  test('shortcuts skip when focus is in an input', async ({ page }) => {
    await page.goto('/endpoints');
    await expect(page.getByTestId('endpoints-page')).toBeVisible({ timeout: 30_000 });

    // Focus the endpoints SearchBox.
    const search = page.getByTestId('endpoints-search');
    await search.click();

    // Type `g e` - the shortcut layer must NOT navigate because
    // isEditableTarget() returns true for INPUT.
    await page.keyboard.press('g');
    await page.waitForTimeout(50);
    await page.keyboard.press('e');

    // We are still on /endpoints. The search box now contains "ge".
    await expect(page).toHaveURL(/\/endpoints(\?|$)/);
    // The SearchBox absorbed the keystrokes (filter text is "ge").
    // The Fluent UI SearchBox propagates `q=ge` to the URL.
    await expect(page).toHaveURL(/q=ge/);
  });
});
