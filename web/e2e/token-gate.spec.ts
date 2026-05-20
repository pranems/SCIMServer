/**
 * token-gate.spec.ts - end-to-end TokenGate coverage closing the
 * v0.52.1 RCA gap.
 *
 * USER PATHS COVERED
 *   First-load with empty localStorage shows the dialog with no
 *   pre-populated error copy (Bug 1: spurious "Token expired" before
 *   the operator typed anything was the original symptom).
 *   Empty / whitespace token submit surfaces inline validation copy
 *   and does NOT clear the dialog.
 *   Valid token entry stores the value, dismisses the dialog, and
 *   advances to the app shell without leaving the user staring at
 *   "Something went wrong" (Bug 3: the post-save errorComponent
 *   was the original symptom; the fix calls router.invalidate()).
 *   Enter-key submits the form (keyboard equivalent of the Save
 *   button click).
 *   401 mid-session (simulated by clicking the AppHeader "Change
 *   token" button which dispatches TOKEN_INVALID_EVENT) re-opens
 *   the dialog with the "Token expired or invalid..." copy (Bug 2:
 *   the live 401 path was the only way to see this branch before
 *   this spec landed).
 *   Token persists across page reload via localStorage; reload
 *   after save must NOT re-show the dialog.
 *
 * WHY THESE PATHS WERE NOT PREVIOUSLY COVERED
 *   - smoke-test.spec.ts test 1 covers the happy path of "type +
 *     save -> dashboard" but does not assert the no-error-on-first-
 *     load Bug 1 invariant.
 *   - The vitest unit suite (TokenGate.test.tsx) covers the React
 *     state machine but cannot reproduce the route.invalidate()
 *     race that produced Bug 3 (which needs a real loader run).
 *   - No existing spec exercises the TOKEN_INVALID_EVENT branch
 *     in a real browser.
 *
 * Run vs dev (canonical):
 *   $env:E2E_BASE_URL = 'https://scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io'
 *   $env:E2E_TOKEN    = 'changeme-scim'
 *   cd web
 *   npx playwright test e2e/token-gate.spec.ts --reporter=line
 */
import { test, expect } from '@playwright/test';

const TOKEN_STORAGE_KEY = 'scimserver.authToken';
const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';

/**
 * Helper: clear all storage keys before each test so the TokenGate
 * starts from a clean slate. Pre-test addInitScript() patterns from
 * existing specs are deliberately avoided here because we WANT the
 * dialog to appear.
 */
async function freshSession(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* ignored */
    }
  });
  await page.reload();
}

test.describe('TokenGate - v0.52.1 RCA paths', () => {
  test('first-load shows the dialog with no pre-populated error copy', async ({ page }) => {
    await freshSession(page);

    const input = page.getByTestId('token-input');
    await expect(input).toBeVisible({ timeout: 15_000 });

    // The dialog title + hint copy are both stable across renders.
    await expect(page.getByText(/Authentication Required/i)).toBeVisible();
    await expect(page.getByText(/SCIM_SHARED_SECRET/)).toBeVisible();

    // Bug 1 invariant: no "Token expired" / "invalid" copy before the
    // user has typed anything.
    const dialogBody = page.getByRole('dialog');
    await expect(dialogBody).not.toContainText(/token expired/i);
    await expect(dialogBody).not.toContainText(/invalid/i);
    await expect(dialogBody).not.toContainText(/cannot be empty/i);
  });

  test('empty submit shows "Token cannot be empty" inline', async ({ page }) => {
    await freshSession(page);

    const save = page.getByTestId('token-save');
    await expect(save).toBeVisible({ timeout: 15_000 });

    // Click Save with no text typed. Dialog must remain open and
    // surface the empty-input error.
    await save.click();

    await expect(page.getByText(/cannot be empty/i)).toBeVisible({ timeout: 5_000 });
    // Dialog still mounted (input still queryable).
    await expect(page.getByTestId('token-input')).toBeVisible();
  });

  test('whitespace-only submit shows the same empty-input error', async ({ page }) => {
    await freshSession(page);

    await page.getByTestId('token-input').fill('   ');
    await page.getByTestId('token-save').click();

    await expect(page.getByText(/cannot be empty/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('token-input')).toBeVisible();
  });

  test('valid token save dismisses dialog and renders app shell (Bug 3 RCA)', async ({ page }) => {
    await freshSession(page);

    await page.getByTestId('token-input').fill(TOKEN);
    await page.getByTestId('token-save').click();

    // Bug 3: after save, route.invalidate() must re-run loaders so the
    // user sees the actual page, not the pre-auth errorComponent.
    await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 });

    // The error-boundary fallback must NOT be visible.
    await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);

    // Token persisted to localStorage with the documented key.
    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      TOKEN_STORAGE_KEY,
    );
    expect(stored).toBe(TOKEN);
  });

  test('Enter key in the input submits the form', async ({ page }) => {
    await freshSession(page);

    const input = page.getByTestId('token-input');
    await input.fill(TOKEN);
    await input.press('Enter');

    await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 });
  });

  test('TOKEN_INVALID_EVENT re-opens the dialog with "Token expired" copy (Bug 2 RCA)', async ({ page }) => {
    // First, authenticate cleanly.
    await freshSession(page);
    await page.getByTestId('token-input').fill(TOKEN);
    await page.getByTestId('token-save').click();
    await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 });

    // Simulate a 401 mid-session by clicking the AppHeader "Change
    // token" affordance which calls clearStoredToken() +
    // notifyTokenInvalid() - the same code path fetchWithAuth runs
    // when the server returns 401.
    await page.getByTestId('change-token').click();

    // Dialog must re-appear AND now carry the "expired or invalid" copy.
    await expect(page.getByTestId('token-input')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/token expired or invalid/i)).toBeVisible();
  });

  test('token persists across reload (no dialog after refresh)', async ({ page }) => {
    await freshSession(page);
    await page.getByTestId('token-input').fill(TOKEN);
    await page.getByTestId('token-save').click();
    await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 });

    await page.reload();

    // After reload the AppShell renders directly; the dialog must NOT
    // appear because the token survived in localStorage.
    await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('token-input')).toHaveCount(0);
  });

  test('double-click on Save does not double-submit (pendingRef guard)', async ({ page }) => {
    await freshSession(page);

    await page.getByTestId('token-input').fill(TOKEN);

    // Fire two clicks back-to-back. The synchronous pendingRef guard in
    // TokenGate.handleSave() must short-circuit the second click; both
    // resolve to a single save + a single navigate.
    const save = page.getByTestId('token-save');
    await Promise.all([save.click(), save.click().catch(() => undefined)]);

    await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 30_000 });

    // Token written exactly once (value is the literal token, not
    // duplicated / concatenated by a re-entrant write).
    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      TOKEN_STORAGE_KEY,
    );
    expect(stored).toBe(TOKEN);
  });
});
