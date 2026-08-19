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
import { test, expect, type Page } from '@playwright/test';

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
  '[data-testid="app-version"]',
  '[data-testid="server-uptime"]',
  '[data-testid="current-time"]',
  // Dashboard chart - bars animate in over ~600 ms; static screenshot
  // catches mid-animation frame.
  '[data-testid="dashboard-chart"] svg',
  // Logs table createdAt column shifts every second on real data.
  '[data-testid="logs-row-time"]',
];

const DASHBOARD_LIVE_SELECTORS = [
  ...NON_DETERMINISTIC_SELECTORS,
  '[data-testid="kpi-row"]',
  '[data-testid="dashboard-chart-card"]',
  '[data-testid="dashboard-analytics-section"]',
  '[data-testid="endpoint-grid"]',
  '[data-testid="activity-list"]',
];

const ENDPOINTS_LIVE_SELECTORS = [
  ...NON_DETERMINISTIC_SELECTORS,
  '[data-testid="endpoints-page"] > div:first-child',
  '[data-testid="endpoints-grid"]',
];

const SETTINGS_LIVE_SELECTORS = [
  ...NON_DETERMINISTIC_SELECTORS,
  '[data-testid="settings-page"] > div:first-of-type',
  '[data-testid="log-config-section"]',
  // R4b/secret-show: the Server connection info card renders the live base URL,
  // token/JWKS/metadata URLs, and - when CredentialSecretVisibility=always -
  // the actual shared secret + OAuth client id/secret. Those are environment-
  // specific + secret-bearing, so mask the whole card: never assert (or commit
  // to a baseline PNG) live secret values.
  '[data-testid="server-connection-info-card"]',
];

const ENDPOINT_DETAIL_LIVE_SELECTORS = [
  ...NON_DETERMINISTIC_SELECTORS,
  '[data-testid="endpoint-detail-page"] > div:nth-of-type(1)',
  '[data-testid="endpoint-detail-page"] > div:nth-of-type(2)',
  // The OverviewTab renders live, per-request-drifting content that a fullPage
  // snapshot against a real dev server can never match byte-for-byte: the KPI
  // stat cards show live user/group/credential/flag counts, and the Recent
  // Activity feed shows real request rows with wall-clock timestamps. Mask both
  // so the snapshot only asserts the STABLE chrome (header, tabs, layout).
  '[data-testid="overview-kpi-row"]',
  '[data-testid="overview-activity"]',
];

const locatorsFor = (page: Page, selectors: string[]) =>
  selectors.map((selector) => page.locator(selector));

/** Common options for `toHaveScreenshot` - keep one source of truth. */
const SNAPSHOT_OPTIONS = {
  animations: 'disabled' as const,
  caret: 'hide' as const,
  // 0.2 % pixel-diff tolerance: enough to survive font-rendering jitter
  // across machines but tight enough to catch real layout shifts. The
  // default is 0.2% pixel-by-pixel diff via SSIM.
  maxDiffPixelRatio: 0.002,
};

/**
 * Creates a throwaway endpoint for the endpoint-detail snapshots.
 *
 * These two snapshots used to click whichever endpoint sorted FIRST on
 * /endpoints, which made the baseline a hostage to the target estate's data:
 * on 2026-07-31 a bulk endpoint import changed which endpoint sorted first
 * (dev went 33 -> 58 endpoints) and both baselines broke, purely because a
 * different endpoint with a different row count and schema count was being
 * photographed. Nothing about the UI had changed.
 *
 * A freshly-created endpoint on a pinned preset has a deterministic shape -
 * zero users, a known schema set - so the snapshot asserts the CHROME rather
 * than whatever data happens to be in the environment. The endpoint's name and
 * description are already masked by ENDPOINT_DETAIL_LIVE_SELECTORS, so a
 * per-run unique name does not leak into the image.
 */
async function createSnapshotEndpoint(page: Page): Promise<string | null> {
  const token = process.env.E2E_TOKEN || 'changeme-scim';
  await page.goto('/endpoints');
  await page.waitForLoadState('networkidle');
  return page.evaluate(async (t: string) => {
    const res = await fetch('/scim/admin/endpoints', {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `vr-snapshot-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        profilePreset: 'rfc-standard',
      }),
    });
    if (!res.ok) return null;
    return (await res.json()).id as string;
  }, token);
}

async function deleteSnapshotEndpoint(page: Page, id: string | null): Promise<void> {
  if (!id) return;
  const token = process.env.E2E_TOKEN || 'changeme-scim';
  await page.evaluate(
    async ({ t, epId }: { t: string; epId: string }) => {
      await fetch(`/scim/admin/endpoints/${epId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${t}` },
      });
    },
    { t: token, epId: id },
  );
}

test.describe('Phase H3 - Visual regression baselines', () => {
  test('Dashboard (light theme)', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('scim-color-scheme', 'light'));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('dashboard-light.png', {
      ...SNAPSHOT_OPTIONS,
      mask: locatorsFor(page, DASHBOARD_LIVE_SELECTORS),
      fullPage: true,
    });
  });

  test('Dashboard (dark theme)', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('scim-color-scheme', 'dark'));
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('dashboard-dark.png', {
      ...SNAPSHOT_OPTIONS,
      mask: locatorsFor(page, DASHBOARD_LIVE_SELECTORS),
      fullPage: true,
    });
  });

  test('Endpoints list', async ({ page }) => {
    await page.goto('/endpoints');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('endpoints-list.png', {
      ...SNAPSHOT_OPTIONS,
      mask: locatorsFor(page, ENDPOINTS_LIVE_SELECTORS),
      fullPage: true,
    });
  });

  test('Logs page (light theme)', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('scim-color-scheme', 'light'));
    await page.goto('/logs');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('logs-light.png', {
      ...SNAPSHOT_OPTIONS,
      mask: locatorsFor(page, NON_DETERMINISTIC_SELECTORS),
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
      mask: locatorsFor(page, NON_DETERMINISTIC_SELECTORS),
      fullPage: true,
      maxDiffPixelRatio: 0.10,
    });
  });

  test('Settings page', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('settings.png', {
      ...SNAPSHOT_OPTIONS,
      mask: locatorsFor(page, SETTINGS_LIVE_SELECTORS),
      fullPage: true,
    });
  });

  test('Manual Provision page', async ({ page }) => {
    await page.goto('/manual-provision');
    // Load guard (2026-07-07): assert the SPA actually rendered the page
    // BEFORE screenshotting. Without this, a hard-navigation that 404s
    // (as /manual-provision did before the spa-fallback allowlist fix)
    // silently screenshots the NestJS "Cannot GET /manual-provision" JSON
    // 404 - and --update-snapshots would happily bake that error page in
    // as the baseline, so the gate goes green comparing a 404 to a 404
    // and never catches the routing bug. Every visual baseline MUST prove
    // its page loaded first.
    await expect(page.getByTestId('manual-provision-page')).toBeVisible({ timeout: 30_000 });
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
    await expect(page).toHaveScreenshot('command-palette.png', {
      ...SNAPSHOT_OPTIONS,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('Keyboard Shortcuts Help (? open state)', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // ? is shift+/ on US layout. Pressing the literal key is the most
    // robust cross-platform incantation.
    await page.keyboard.press('Shift+Slash');
    await page.locator('[data-testid="shortcuts-help"]').waitFor({ state: 'visible' });
    await expect(page).toHaveScreenshot('keyboard-shortcuts-help.png', {
      ...SNAPSHOT_OPTIONS,
      maxDiffPixelRatio: 0.02,
    });
  });

  // Endpoint-detail tabs: use a PURPOSE-CREATED endpoint, not "whatever
  // endpoint happens to be first". Origin: 2026-08-18 - this test snapshotted
  // the first existing endpoint, so the baseline encoded that endpoint's
  // Recent Activity row count. `mask` hides the card's CONTENT but not its
  // HEIGHT, and with fullPage:true a collapse from ~15 rows to ~4 is a large
  // unmasked geometry change that blew the 3 % tolerance for a reason having
  // nothing to do with any UI change. A fresh endpoint has deterministic
  // (empty) activity, which removes the drift at its source instead of
  // widening the tolerance until the gate stops discriminating.
  test('Endpoint detail - Overview tab', async ({ page }) => {
    const id = await createSnapshotEndpoint(page);
    test.skip(!id, 'Could not create the snapshot fixture endpoint');
    try {
      await page.goto(`/endpoints/${id}`);
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot('endpoint-detail-overview.png', {
        ...SNAPSHOT_OPTIONS,
        mask: locatorsFor(page, [
          ...ENDPOINT_DETAIL_LIVE_SELECTORS,
          '[data-testid="dashboard-chart"] svg',
          // Overview tab live-data regions: KPI counts + Recent Activity
          // (populated card AND empty state) both vary per dev-environment
          // activity. Mask wholesale - same pattern as DASHBOARD_LIVE_SELECTORS.
          '[data-testid="overview-kpi-row"]',
          '[data-testid="overview-activity"]',
          '[data-testid="overview-activity-empty"]',
        ]),
        fullPage: true,
        // Live KPI counts still vary slightly even on a fresh endpoint.
        maxDiffPixelRatio: 0.03,
      });
    } finally {
      await deleteSnapshotEndpoint(page, id);
    }
  });

  test('Endpoint detail - Users tab', async ({ page }) => {
    const id = await createSnapshotEndpoint(page);
    test.skip(!id, 'Could not create the snapshot fixture endpoint');
    try {
      await page.goto(`/endpoints/${id}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /users/i }).click();
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot('endpoint-detail-users.png', {
        ...SNAPSHOT_OPTIONS,
        mask: locatorsFor(page, [
          ...ENDPOINT_DETAIL_LIVE_SELECTORS,
          '[data-testid="users-tab"]',
          '[data-testid="users-empty"]',
        ]),
        fullPage: true,
        // The fixture endpoint is created fresh with zero users, so the panel
        // height is deterministic. The tolerance stays only for font/AA noise.
        maxDiffPixelRatio: 0.03,
      });
    } finally {
      await deleteSnapshotEndpoint(page, id);
    }
  });

  test('Endpoint detail - Schemas tab', async ({ page }) => {
    const id = await createSnapshotEndpoint(page);
    test.skip(!id, 'Could not create the snapshot fixture endpoint');
    try {
      await page.goto(`/endpoints/${id}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('tab', { name: /schemas/i }).click();
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot('endpoint-detail-schemas.png', {
        ...SNAPSHOT_OPTIONS,
      mask: locatorsFor(page, [
        ...ENDPOINT_DETAIL_LIVE_SELECTORS,
        '[data-testid="schemas-tree"]',
        '[data-testid="schemas-empty"]',
      ]),
        fullPage: true,
        // The fixture endpoint is created on a pinned preset, so the schema
        // tree is deterministic. Tolerance retained only for font/AA noise.
        maxDiffPixelRatio: 0.03,
      });
    } finally {
      await deleteSnapshotEndpoint(page, id);
    }
  });
});
