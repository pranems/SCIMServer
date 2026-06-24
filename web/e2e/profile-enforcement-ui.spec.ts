/**
 * profile-enforcement-ui.spec.ts - browser regression guard for the
 * v0.53.4 fix of the v0.53.3 profile-enforcement UI regression.
 *
 * THE BUG (reported on customer prod, 2026-06-24)
 *   v0.53.3 made the SCIM CRUD layer return 404 for a resource type the
 *   endpoint profile does not declare. The admin UI still rendered the
 *   Groups tab unconditionally on a user-only endpoint and its route
 *   loader did `ensureQueryData(GET /Groups)`, so clicking Groups - or
 *   refreshing on /groups - threw the 404 to the route error boundary
 *   and replaced the whole endpoint detail page with
 *   "Something went wrong / Resource type \"Group\" is not supported...".
 *
 * THE FIX (asserted here)
 *   1. EndpointDetailPage hides the Groups tab for a user-only endpoint
 *      (and the Users tab for a group-only endpoint) - fail-open mirror
 *      of the server resolver.
 *   2. The Users + Groups loaders are best-effort (swallow prefetch
 *      errors), so a stale deep-link / refresh onto an unsupported tab
 *      renders a contained empty state, NOT the fatal route boundary.
 *
 * STRATEGY
 *   Creates a throwaway user-only endpoint via the admin API, drives the
 *   real browser, asserts the regression is fixed, then deletes the
 *   endpoint. Runs against local dev (:4000), Docker compose (:8080),
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
      name: `e2e-useronly-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
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

test.describe('v0.53.4 - profile-enforcement UI does not fatally error', () => {
  test('user-only endpoint hides Groups tab and never shows the fatal boundary', async ({ page }) => {
    const endpointId = await createUserOnlyEndpoint(page);
    test.skip(!endpointId, 'Could not create a user-only endpoint (no user-only preset / admin denied).');

    try {
      // 1. Land on the Users tab - the exact URL from the prod report.
      await page.goto(`/endpoints/${endpointId}/users?page=1`);
      await expect(page.getByTestId('endpoint-detail-page')).toBeVisible({ timeout: 30_000 });

      // 2. The Users tab is present; the Groups tab is HIDDEN.
      await expect(page.getByTestId('endpoint-tab-users')).toBeVisible();
      await expect(page.getByTestId('endpoint-tab-groups')).toHaveCount(0);

      // 3. The fatal route-boundary error must NOT be on screen.
      await expect(page.getByText('Something went wrong')).toHaveCount(0);
      await expect(
        page.getByText(/is not supported by endpoint/i),
      ).toHaveCount(0);

      // 4. Deep-link / refresh directly onto the unsupported /groups URL
      //    must render the contained empty state, not the fatal boundary.
      await page.goto(`/endpoints/${endpointId}/groups?page=1`);
      await expect(page.getByTestId('endpoint-detail-page')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('groups-unsupported')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Something went wrong')).toHaveCount(0);
    } finally {
      await deleteEndpoint(page, endpointId!);
    }
  });
});
