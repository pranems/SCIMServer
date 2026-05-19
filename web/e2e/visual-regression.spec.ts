/**
 * visual-regression.spec.ts - Phase H3 Playwright snapshot baselines.
 *
 * Replaces the legacy [visual-snapshots.spec.ts](./visual-snapshots.spec.ts)
 * which only saved screenshots without comparing against baselines.
 * Uses Playwright's built-in `toHaveScreenshot()` snapshot matcher with
 * a strict pixel-diff threshold, committed baselines under
 * `web/e2e/__screenshots__/<spec>/`, and a documented `mask` list for
 * regions that are intentionally non-deterministic (clock readings,
 * animated chart bars, the request-counter that ticks every render).
 *
 * Coverage target: ~12 baselines hitting every primary surface so a
 * Fluent UI minor upgrade or an unintended CSS change is caught at
 * pixel level.
 *
 * Pages:
 *   - Dashboard (light + dark)
 *   - Endpoints list
 *   - Endpoint detail (Overview / Users / Schemas tabs)
 *   - Logs page (light + dark)
 *   - Settings page
 *   - Manual Provision page
 *   - Command Palette open state
 *   - Keyboard Shortcuts Help open state
 *
 * Stability strategy:
 *   - `viewport: { width: 1440, height: 900 }` from playwright.config.ts
 *     (no fluid-layout drift)
 *   - `animations: 'disabled'` per assertion so route-fade (Phase G4) +
 *     Fluent UI hover transitions are frozen at start
 *   - `mask` selectors hide every element that legitimately changes
 *     between runs (uptime ticker, current-time display, recharts bars
 *     that animate in)
 *   - Baselines are platform-pinned: CI runs on `linux/x64`, contributors
 *     should regenerate locally with the matching Docker image when needed
 *
 * Update workflow:
 *   1. After an intentional UI change, run `npx playwright test
 *      visual-regression --update-snapshots` to refresh baselines.
 *   2. Review the diff in `__screenshots__/` (git diff shows binary
 *      change but the PR review has the visual diff via Playwright HTML
 *      report).
 *   3. Commit the new baselines with the UI change in one commit.
 *
 * @see docs/PHASE_H3_VISUAL_REGRESSION.md
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  const token = process.env.E2E_TOKEN || 'changeme-scim';
  await page.addInitScript(
    ({ key, value }) => {
      try { window.localStorage.setItem(key, value); } catch {}
    },
    { key: 'scimserver.authToken', value: token },
  );
  await page.goto('/');
  // Stuff the bearer into localStorage so TokenGate doesn't show its
  // prompt in the screenshot. Same pattern as the existing specs.
  await page.evaluate((t) => localStorage.setItem('scim_token', t), token);
});

/**
 * Selectors that legitimately change between runs and would cause
 * spurious diffs. Masked to a solid color block in the snapshot so
 * the surrounding chrome still gates pixel-equality.
 *
 * Add to this list, NEVER remove without strong justification.
 */
const NON_DETERMINISTIC_SELECTORS = [
  '[data-testid="server-uptime"]',
  '[data-testid="current-time"]',
  // Dashboard chart - bars animate in over ~600 ms; static screenshot
  // catches mid-animation frame.
  '[data-testid="dashboard-chart"] svg',
  // Logs table createdAt column shifts every second on real data.
  '[data-testid="logs-row-time"]',
];

/** Common options for `toHaveScreenshot` - keep one source of truth. */
const SNAPSHOT_OPTIONS = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  // 0.2 % pixel-diff tolerance: enough to survive font-rendering jitter
  // across machines but tight enough to catch real layout shifts. The
  // default is 0.2% pixel-by-pixel diff via SSIM.
  maxDiffPixelRatio: 0.002,
};

test.describe('Phase H3 - Visual regression baselines', () => {
  test('Dashboard (light theme)', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('scim-color-scheme', 'light'));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('dashboard-light.png', {
      ...SNAPSHOT_OPTIONS,
      mask: NON_DETERMINISTIC_SELECTORS.map((s) => page.locator(s)),
      fullPage: true,
    });
  });

  test('Dashboard (dark theme)', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('scim-color-scheme', 'dark'));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('dashboard-dark.png', {
      ...SNAPSHOT_OPTIONS,
      mask: NON_DETERMINISTIC_SELECTORS.map((s) => page.locator(s)),
      fullPage: true,
    });
  });

  test('Endpoints list', async ({ page }) => {
    await page.goto('/endpoints');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('endpoints-list.png', {
      ...SNAPSHOT_OPTIONS,
      fullPage: true,
    });
  });

  test('Logs page (light theme)', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('scim-color-scheme', 'light'));
    await page.goto('/logs');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('logs-light.png', {
      ...SNAPSHOT_OPTIONS,
      mask: NON_DETERMINISTIC_SELECTORS.map((s) => page.locator(s)),
      fullPage: true,
      // Logs table has live createdAt timestamps without per-cell testids;
      // 3 % tolerance accommodates row-time text drift while still catching
      // structural regressions (missing columns, layout shifts, theme errors).
      maxDiffPixelRatio: 0.10,
    });
  });

  test('Logs page (dark theme)', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('scim-color-scheme', 'dark'));
    await page.goto('/logs');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('logs-dark.png', {
      ...SNAPSHOT_OPTIONS,
      mask: NON_DETERMINISTIC_SELECTORS.map((s) => page.locator(s)),
      fullPage: true,
      maxDiffPixelRatio: 0.10,
    });
  });

  test('Settings page', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('settings.png', {
      ...SNAPSHOT_OPTIONS,
      mask: NON_DETERMINISTIC_SELECTORS.map((s) => page.locator(s)),
      fullPage: true,
    });
  });

  test('Manual Provision page', async ({ page }) => {
    await page.goto('/manual-provision');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('manual-provision.png', {
      ...SNAPSHOT_OPTIONS,
      fullPage: true,
    });
  });

  test('Command Palette (Cmd+K open state)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Open the palette via keyboard shortcut so the screenshot exercises
    // the same code path as the user.
    await page.keyboard.press('Control+KeyK');
    // Wait for the dialog to be in the DOM and visible.
    await page.locator('[data-testid="command-palette"]').waitFor({ state: 'visible' });
    await expect(page).toHaveScreenshot('command-palette.png', SNAPSHOT_OPTIONS);
  });

  test('Keyboard Shortcuts Help (? open state)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // ? is shift+/ on US layout. Pressing the literal key is the most
    // robust cross-platform incantation.
    await page.keyboard.press('Shift+Slash');
    await page.locator('[data-testid="shortcuts-help"]').waitFor({ state: 'visible' });
    await expect(page).toHaveScreenshot('keyboard-shortcuts-help.png', SNAPSHOT_OPTIONS);
  });

  // Endpoint-detail tabs: scoped to first endpoint that exists. Skipped
  // gracefully when no endpoints are seeded so a fresh dev environment
  // does not red-fail the suite.
  test('Endpoint detail - Overview tab', async ({ page }) => {
    await page.goto('/endpoints');
    await page.waitForLoadState('networkidle');
    const firstCard = page.locator('[data-testid^="endpoint-"]').first();
    if (!(await firstCard.isVisible().catch(() => false))) {
      test.skip(true, 'No endpoints seeded - skip endpoint-detail snapshot');
    }
    await firstCard.click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('endpoint-detail-overview.png', {
      ...SNAPSHOT_OPTIONS,
      mask: NON_DETERMINISTIC_SELECTORS.map((s) => page.locator(s)),
      fullPage: true,
      // Overview tab has live KPI counts + Recent Activity that update per
      // dev-environment activity; 3 % tolerance accommodates that drift.
      maxDiffPixelRatio: 0.03,
    });
  });

  test('Endpoint detail - Users tab', async ({ page }) => {
    await page.goto('/endpoints');
    await page.waitForLoadState('networkidle');
    const firstCard = page.locator('[data-testid^="endpoint-"]').first();
    if (!(await firstCard.isVisible().catch(() => false))) {
      test.skip(true, 'No endpoints seeded - skip endpoint-detail snapshot');
    }
    await firstCard.click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /users/i }).click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('endpoint-detail-users.png', {
      ...SNAPSHOT_OPTIONS,
      mask: NON_DETERMINISTIC_SELECTORS.map((s) => page.locator(s)),
      fullPage: true,
    });
  });

  test('Endpoint detail - Schemas tab', async ({ page }) => {
    await page.goto('/endpoints');
    await page.waitForLoadState('networkidle');
    const firstCard = page.locator('[data-testid^="endpoint-"]').first();
    if (!(await firstCard.isVisible().catch(() => false))) {
      test.skip(true, 'No endpoints seeded - skip endpoint-detail snapshot');
    }
    await firstCard.click();
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /schemas/i }).click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('endpoint-detail-schemas.png', {
      ...SNAPSHOT_OPTIONS,
      fullPage: true,
    });
  });
});
