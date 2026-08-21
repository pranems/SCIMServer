/**
 * resource-types-inventory.spec.ts - browser guard for the Resource Types tab.
 *
 * THE ORIGINAL GAP (reported on customer prod, 2026-06-24)
 *   The tab rendered ONLY a "Custom resource types are disabled" panel when
 *   the `CustomResourceTypesEnabled` flag was off - it never showed the
 *   endpoint's CURRENT valid resource types, so on a user-only endpoint the
 *   operator saw a dead end with no sign that User was still served.
 *
 * WHAT CHANGED SINCE (v0.55.13)
 *   That flag had already been retired in settings-v8; the server derives
 *   availability from `profile.resourceTypes[]` and never read it. The UI
 *   kept gating on it, which HID a capability that worked. Both the panel
 *   and the Settings toggle are gone.
 *
 * THE BEHAVIOUR ASSERTED HERE
 *   1. The tab ALWAYS renders an inventory of the endpoint's current
 *      resource types, tagged built-in / custom. A user-only endpoint shows
 *      the User row and no Group row.
 *   2. Create is offered regardless of any flag; built-ins are never
 *      deletable (that is about being built-in, not about a flag).
 *   3. The Settings tab does NOT offer a toggle for the retired flag.
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

test.describe('Resource Types tab shows the endpoint\'s current types and is not flag-gated', () => {
  test('user-only endpoint: Resource Types tab lists User and offers Create', async ({ page }) => {
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

      // 4. Custom resource types are NOT flag-gated (settings-v8 retired the
      //    flag; the server derives from profile.resourceTypes), so Create is
      //    offered. A built-in type is still never deletable.
      await expect(page.getByTestId('resource-types-disabled-panel')).toHaveCount(0);
      await expect(page.getByTestId('resource-types-create-button')).toBeVisible();
      await expect(page.getByTestId('resource-types-row-User-delete')).toHaveCount(0);

      // 5. No fatal route boundary.
      await expect(page.getByText('Something went wrong')).toHaveCount(0);
    } finally {
      await deleteEndpoint(page, endpointId!);
    }
  });

  test('Settings tab does NOT offer the retired CustomResourceTypesEnabled toggle', async ({ page }) => {
    const endpointId = await createUserOnlyEndpoint(page);
    test.skip(!endpointId, 'Could not create a user-only endpoint (no user-only preset / admin denied).');

    try {
      await page.goto(`/endpoints/${endpointId}/settings`);
      await expect(page.getByTestId('endpoint-detail-page')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('settings-tab')).toBeVisible({ timeout: 15_000 });

      // The server ignores this flag, so a toggle here would write a setting
      // nothing reads. Assert a live flag renders too, or this would pass on a
      // Settings tab that failed to render any switch at all.
      await expect(page.getByRole('switch', { name: /StrictSchemaValidation/i })).toBeVisible();
      await expect(page.getByRole('switch', { name: /CustomResourceTypesEnabled/i })).toHaveCount(0);
    } finally {
      await deleteEndpoint(page, endpointId!);
    }
  });
});
