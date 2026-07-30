/**
 * settings-jwks-hosts.spec.ts - exercises the JWKS host allowlist
 * manager on the global Settings page (WI-15).
 *
 * USER PATHS COVERED
 *   /settings -> the "JWKS host allowlist (WIF SSRF guard)" card renders
 *   with the add input, the add button, the built-in (seed + env) line,
 *   and one row per persisted host. A second test performs the full
 *   add-then-remove round-trip through the browser with a unique host
 *   name so no residue is left on the shared (server-global) allowlist.
 *
 * SAFETY
 *   The render test is READ-ONLY. The round-trip test mutates the
 *   server-global persisted layer but always removes the host it added
 *   (self-cleaning), and uses a collision-proof unique hostname so a
 *   concurrent run cannot clash. The exhaustive add/remove/reject matrix
 *   is covered by the API E2E (wif-assertion.e2e-spec.ts) and the
 *   live-test section 9z-AT7.
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

async function openSettings(page: Page): Promise<void> {
  await page.goto('/settings');
  await expect(page.getByTestId('settings-page')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('jwks-hosts-card')).toBeVisible({ timeout: 30_000 });
}

test.describe('SettingsPage - JWKS host allowlist (WI-15)', () => {
  test('the JWKS host card renders with the add form and built-in line', async ({ page }) => {
    await openSettings(page);
    await expect(page.getByTestId('jwks-hosts-input')).toBeVisible();
    await expect(page.getByTestId('jwks-hosts-add-button')).toBeVisible();
    // The seed + env union is always present and always allowed.
    await expect(page.getByTestId('jwks-hosts-builtin')).toBeVisible();
    // The Add button is gated until a host is typed.
    await expect(page.getByTestId('jwks-hosts-add-button')).toBeDisabled();
  });

  test('the built-in line names the well-known Entra seed host', async ({ page }) => {
    await openSettings(page);
    const builtin = page.getByTestId('jwks-hosts-builtin');
    await expect(builtin).toContainText('login.microsoftonline.com');
  });

  test('add-then-remove round-trip through the browser (self-cleaning)', async ({ page }) => {
    await openSettings(page);

    // Collision-proof unique host so concurrent runs never clash and the
    // shared allowlist is left pristine.
    const host = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jwks.example.com`;
    const rowTestId = `jwks-host-row-${host}`;
    const removeTestId = `jwks-host-remove-${host}`;

    try {
      await page.getByTestId('jwks-hosts-input').fill(host);
      await expect(page.getByTestId('jwks-hosts-add-button')).toBeEnabled();
      await page.getByTestId('jwks-hosts-add-button').click();

      // The persisted row appears after the mutation + refetch settle.
      await expect(page.getByTestId(rowTestId)).toBeVisible({ timeout: 15_000 });
    } finally {
      // Always clean up the host we added, even if an assertion above failed.
      const removeBtn = page.getByTestId(removeTestId);
      if (await removeBtn.count()) {
        await removeBtn.click();
        await expect(page.getByTestId(rowTestId)).toHaveCount(0, { timeout: 15_000 });
      }
    }
  });
});

/**
 * R1 - the JWKS host allowlist card offers full CRUD: the seed is prepopulated
 * as editable rows, each row has Edit + Remove, plus a PATCH-based selective
 * add/remove box. Route-mocked so it is deterministic and mutates nothing real.
 */
test.describe('SettingsPage - JWKS host allowlist full CRUD (R1)', () => {
  test('renders prepopulated rows with Edit + the PATCH selective add/remove box', async ({ page }) => {
    // The Settings page gates rendering on version + health; mock them so the
    // page leaves the loading skeleton (preview has no backend).
    await page.route('**/scim/admin/version', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '0.54.9', runtime: { node: 'v24', platform: 'linux', arch: 'x64' }, service: { uptimeSeconds: 60 }, storage: { persistenceBackend: 'inmemory', databaseProvider: 'inmemory' } }) });
    });
    await page.route('**/health', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', uptime: 60 }) });
    });
    await page.route('**/scim/admin/settings/jwks-hosts', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          seed: ['login.microsoftonline.com', 'accounts.google.com'],
          env: [],
          persisted: ['login.microsoftonline.com', 'acme.example.com'],
          persistedEntries: [
            { id: 's1', host: 'login.microsoftonline.com', label: 'well-known IdP (seed)' },
            { id: 'p1', host: 'acme.example.com', label: null },
          ],
          effective: ['login.microsoftonline.com', 'accounts.google.com', 'acme.example.com'],
        }),
      });
    });

    await page.goto('/settings');
    await expect(page.getByTestId('jwks-hosts-card')).toBeVisible({ timeout: 30_000 });

    // R10: assert the RENDERED CRUD affordances, not just card presence.
    // Seed host is a prepopulated, editable row.
    await expect(page.getByTestId('jwks-host-row-login.microsoftonline.com')).toBeVisible();
    await expect(page.getByTestId('jwks-host-edit-login.microsoftonline.com')).toBeVisible();
    await expect(page.getByTestId('jwks-host-row-acme.example.com')).toBeVisible();
    await expect(page.getByTestId('jwks-host-edit-acme.example.com')).toBeVisible();
    await expect(page.getByTestId('jwks-host-remove-acme.example.com')).toBeVisible();
    // The PATCH selective add/remove box is present.
    await expect(page.getByTestId('jwks-hosts-patch-add')).toBeVisible();
    await expect(page.getByTestId('jwks-hosts-patch-remove')).toBeVisible();
    await expect(page.getByTestId('jwks-hosts-patch-button')).toBeVisible();

    // Clicking Edit swaps the row into an inline input.
    await page.getByTestId('jwks-host-edit-acme.example.com').click();
    await expect(page.getByTestId('jwks-host-edit-input-acme.example.com')).toBeVisible();
    await expect(page.getByTestId('jwks-host-save-acme.example.com')).toBeVisible();
  });
});
