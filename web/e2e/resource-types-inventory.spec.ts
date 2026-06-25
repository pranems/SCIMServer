/**
 * resource-types-inventory.spec.ts - browser guard for the v0.53.5 UX fix.
 *
 * THE GAP (reported on customer prod, 2026-06-24)
 *   The per-endpoint Resource Types tab rendered ONLY a "Custom resource
 *   types are disabled" info panel when the `CustomResourceTypesEnabled`
 *   flag was off - it never showed the endpoint's CURRENT valid resource
 *   types. On a user-only endpoint the operator saw a dead-end panel with
 *   no indication that User was still served. Separately, the Settings tab
 *   did not expose `CustomResourceTypesEnabled`, so the operator could not
 *   turn the feature on from the UI.
 *
 * THE FIX (asserted here)
 *   1. Resource Types tab ALWAYS renders an inventory of the endpoint's
 *      current resource types (built-in User/Group + any custom), tagged
 *      built-in / custom, regardless of the flag. A user-only endpoint
 *      shows the User row (and no Group row).
 *   2. When the flag is off, the inventory is still shown plus a contained
 *      info panel; the Create affordance is hidden.
 *   3. The Settings tab exposes a CustomResourceTypesEnabled toggle.
 *
 * STRATEGY
 *   Creates a throwaway user-only endpoint via the admin API, drives the
 *   real browser, asserts the inventory + settings toggle, then deletes
 *   the endpoint. Runs against local dev (:4000), Docker compose (:8080),
 *   and Azure dev. Self-cleans; safe on shared prod-shaped tenants.
 */
import { test, expect, type Page } from '@playwright/test';

const TOKEN_STORAGE_KEY = 'scimserver.authToken';
const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';
const ADMIN_TOKEN = process.env.E2E_TOKEN || 'changeme-scim';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: TOKEN_STORAGE_KEY, value: TOKEN },
  );
});

/** Create a user-only endpoint via the admin API; returns its id. */
async function createUserOnlyEndpoint(page: Page): Promise<string | null> {
  await page.goto('/endpoints');
  await expect(page.getByTestId('endpoints-page')).toBeVisible({ timeout: 30_000 });

  return page.evaluate(async (token: string) => {
    const body = {
      name: `e2e-rt-inv-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      profilePreset: 'user-only',
    };
    const r = await fetch('/scim/admin/endpoints', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const data = await r.json();
    return (data.id ?? null) as string | null;
  }, ADMIN_TOKEN);
}

async function deleteEndpoint(page: Page, endpointId: string): Promise<void> {
  await page.evaluate(
    async ({ token, id }: { token: string; id: string }) => {
      await fetch(`/scim/admin/endpoints/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    },
    { token: ADMIN_TOKEN, id: endpointId },
  );
}

test.describe('v0.53.5 - Resource Types tab shows current types + Settings exposes the flag', () => {
  test('user-only endpoint: Resource Types tab lists User even with the flag off', async ({ page }) => {
    const endpointId = await createUserOnlyEndpoint(page);
    test.skip(!endpointId, 'Could not create a user-only endpoint (no user-only preset / admin denied).');

    try {
      // 1. Open the Resource Types tab directly.
      await page.goto(`/endpoints/${endpointId}/resource-types`);
      await expect(page.getByTestId('endpoint-detail-page')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('resource-types-tab')).toBeVisible({ timeout: 15_000 });

      // 2. The inventory is shown and lists the endpoint's CURRENT type (User).
      await expect(page.getByTestId('resource-types-inventory')).toBeVisible();
      await expect(page.getByTestId('resource-types-row-User')).toBeVisible();
      await expect(page.getByTestId('resource-types-row-User-kind')).toContainText('built-in');

      // 3. A user-only endpoint does NOT list a Group row.
      await expect(page.getByTestId('resource-types-row-Group')).toHaveCount(0);

      // 4. Flag is off (preset default) -> the disabled panel is shown, the
      //    Create button is hidden, and no User delete affordance exists.
      await expect(page.getByTestId('resource-types-disabled-panel')).toBeVisible();
      await expect(page.getByTestId('resource-types-create-button')).toHaveCount(0);
      await expect(page.getByTestId('resource-types-row-User-delete')).toHaveCount(0);

      // 5. No fatal route boundary.
      await expect(page.getByText('Something went wrong')).toHaveCount(0);
    } finally {
      await deleteEndpoint(page, endpointId!);
    }
  });

  test('Settings tab exposes the CustomResourceTypesEnabled toggle', async ({ page }) => {
    const endpointId = await createUserOnlyEndpoint(page);
    test.skip(!endpointId, 'Could not create a user-only endpoint (no user-only preset / admin denied).');

    try {
      await page.goto(`/endpoints/${endpointId}/settings`);
      await expect(page.getByTestId('endpoint-detail-page')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('settings-tab')).toBeVisible({ timeout: 15_000 });

      // The CustomResourceTypesEnabled Switch is present and reachable.
      const sw = page.getByRole('switch', { name: /CustomResourceTypesEnabled/i });
      await expect(sw).toBeVisible();
    } finally {
      await deleteEndpoint(page, endpointId!);
    }
  });
});
