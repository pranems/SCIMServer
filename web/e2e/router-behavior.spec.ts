/**
 * Phase A5 - TanStack Router behavior contract (Playwright e2e).
 *
 * These tests run a real browser against either a local dev server or a
 * deployed instance and lock in the contracts that earlier phases proved
 * in unit tests:
 *
 *   - A2: clicking a sidebar Link changes the URL via pushState (no full reload)
 *   - A2: browser back / forward navigates between previously visited routes
 *   - A3: pagination + filter inputs are URL-driven; refresh preserves them
 *   - A3: typing in the SearchBox updates the URL query string in real time
 *   - A4: hovering the cold Logs route fetches data before navigation and
 *         reuses the prefetched response on click.
 *
 * Run against dev:
 *   E2E_BASE_URL=<dev URL resolved from the estate registry> \
 *   E2E_TOKEN=changeme-scim \
 *   npx playwright test e2e/router-behavior.spec.ts
 *
 * Run against local:
 *   E2E_BASE_URL=http://localhost:4000 E2E_TOKEN=local-secret \
 *   npx playwright test e2e/router-behavior.spec.ts
 */
import { test, expect } from '@playwright/test';
import { saveScreenshot } from './fixtures';

const TOKEN_STORAGE_KEY = 'scimserver.authToken';

/**
 * Pre-authenticate by injecting the bearer token into localStorage
 * BEFORE the app boots. The TokenGate component reads `getStoredToken()`
 * during its initial render and short-circuits to the dialog when the
 * key is missing - that's why we cannot just set localStorage after
 * `page.goto('/')`. `addInitScript` runs on every navigation before any
 * page script executes, so the very first AppShell render sees the
 * token.
 */
test.beforeEach(async ({ page }) => {
  const token = process.env.E2E_TOKEN || 'local-secret';
  await page.addInitScript(
    ({ key, value }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // localStorage might be unavailable in some isolated contexts; ignore.
      }
    },
    { key: TOKEN_STORAGE_KEY, value: token },
  );
  await page.goto('/');
  // Container Apps dev can be cold-starting - allow generous startup time.
  await page.getByTestId('app-shell').waitFor({ state: 'visible', timeout: 30_000 });
});

// ─── A2 - URL changes drive view changes ─────────────────────────────

test.describe('Phase A2 router contract - URL is source of truth', () => {
  test('clicking sidebar Endpoints link updates URL to /endpoints (pushState, no reload)', async ({ page }) => {
    // Wire a sentinel into window so we can detect a full page reload.
    await page.evaluate(() => {
      (window as unknown as { __noReload: boolean }).__noReload = true;
    });

    const endpointsLink = page.getByTestId('app-sidebar').locator('a[href="/endpoints"]');
    await endpointsLink.click();

    await expect(page).toHaveURL(/\/endpoints(\?.*)?$/);

    // If the page reloaded the sentinel disappears - it should still be true.
    const sentinel = await page.evaluate(
      () => (window as unknown as { __noReload?: boolean }).__noReload,
    );
    expect(sentinel, 'sidebar nav must use pushState, not full reload').toBe(true);

    await saveScreenshot(page, 'a5-router-endpoints-via-link');
  });

  test('browser back / forward navigates between visited routes', async ({ page }) => {
    // Start: /
    await expect(page).toHaveURL(/\/(?:\?.*)?$/);

    // Forward to /endpoints
    await page.getByTestId('app-sidebar').locator('a[href="/endpoints"]').click();
    await expect(page).toHaveURL(/\/endpoints(\?.*)?$/);

    // Forward to /settings
    await page.getByTestId('app-sidebar').locator('a[href="/settings"]').click();
    await expect(page).toHaveURL(/\/settings(\?.*)?$/);

    // Back -> /endpoints
    await page.goBack();
    await expect(page).toHaveURL(/\/endpoints(\?.*)?$/);

    // Back -> /
    await page.goBack();
    await expect(page).toHaveURL(/\/(?:\?.*)?$/);

    // Forward -> /endpoints
    await page.goForward();
    await expect(page).toHaveURL(/\/endpoints(\?.*)?$/);
  });

  test('deep link to /endpoints loads endpoints page directly', async ({ page }) => {
    await page.goto('/endpoints');
    await page.getByTestId('app-shell').waitFor({ state: 'visible' });
    await expect(page).toHaveURL(/\/endpoints(\?.*)?$/);
    // Endpoints page renders the search box even when the list is empty.
    await expect(page.getByPlaceholder('Filter endpoints...')).toBeVisible({ timeout: 10_000 });
  });
});

// ─── A3 - URL search params drive filter / pagination state ──────────

test.describe('Phase A3 router contract - URL search params', () => {
  test('typing in the endpoints search box updates URL ?q=', async ({ page }) => {
    await page.goto('/endpoints');
    await page.getByTestId('app-shell').waitFor({ state: 'visible' });

    const searchBox = page.getByPlaceholder('Filter endpoints...');
    await searchBox.waitFor({ state: 'visible' });
    await searchBox.fill('shape');

    // The router debounces nothing - URL should reflect the value
    // within a beat.
    await expect(page).toHaveURL(/[?&]q=shape(\b|&)/, { timeout: 5_000 });

    // Clearing the box should normalize empty -> undefined and remove
    // the param entirely (URL cleanliness check).
    await searchBox.fill('');
    await expect(page).not.toHaveURL(/[?&]q=/, { timeout: 5_000 });
  });

  test('deep-link with ?q= preserves filter on refresh', async ({ page }) => {
    await page.goto('/endpoints?q=shape');
    await page.getByTestId('app-shell').waitFor({ state: 'visible' });
    await expect(page).toHaveURL(/[?&]q=shape(\b|&)/);

    const searchBox = page.getByPlaceholder('Filter endpoints...');
    // The input field should reflect the URL value after route mount.
    await expect(searchBox).toHaveValue('shape');

    // Hard reload - URL should still hold the filter value, input still
    // populated. This is the crux of "URL is the source of truth".
    await page.reload();
    await page.getByTestId('app-shell').waitFor({ state: 'visible' });
    await expect(page).toHaveURL(/[?&]q=shape(\b|&)/);
    await expect(page.getByPlaceholder('Filter endpoints...')).toHaveValue('shape');
  });

  test('logs page refresh preserves urlContains filter', async ({ page }) => {
    await page.goto('/logs?urlContains=Users');
    await page.getByTestId('app-shell').waitFor({ state: 'visible', timeout: 30_000 });
    await expect(page).toHaveURL(/[?&]urlContains=Users(\b|&)/);

    // Assert the accessible field contract rather than placeholder copy or
    // Fluent's internal DOM/test-id forwarding.
    const urlFilter = page.getByRole('searchbox', { name: 'URL contains' });
    await expect(urlFilter).toHaveValue('Users');

    await page.reload();
    await page.getByTestId('app-shell').waitFor({ state: 'visible', timeout: 30_000 });
    await expect(page).toHaveURL(/[?&]urlContains=Users(\b|&)/);
    await expect(page.getByRole('searchbox', { name: 'URL contains' })).toHaveValue('Users');
  });
});

// ─── A4 - Hover-triggered loader prefetch ────────────────────────────

test.describe('Phase A4 router contract - hover-prefetch', () => {
  test('hovering the cold Logs route fetches its data before click and reuses it on navigation', async ({ page }) => {
    // Onboarding warms Endpoints. Logs stays cold, so this observes prefetch
    // without changing product behavior or substituting a vacuous skeleton check.
    const requests: string[] = [];
    page.on('request', (req) => {
      if (new URL(req.url()).pathname === '/scim/admin/logs') {
        requests.push(req.url());
      }
    });

    await page.goto('/settings');
    await expect(page.getByTestId('settings-page')).toBeVisible();
    expect(requests).toHaveLength(0);
    const prefetched = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/scim/admin/logs' &&
      response.status() === 200, { timeout: 5_000 });

    const link = page.getByTestId('app-sidebar').locator('a[href="/logs"]');
    await link.hover();

    const body = await (await prefetched).json() as {
      items: Array<Record<string, unknown>>;
      page: number;
      pageSize: number;
      total: number;
    };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
    expect(body.total).toBeGreaterThanOrEqual(body.items.length);
    await expect(page).toHaveURL(/\/settings$/);
    expect(requests).toHaveLength(1);
    await link.click();
    await expect(page.getByTestId('global-logs-page')).toBeVisible();
    expect(requests).toHaveLength(1);
  });
});
