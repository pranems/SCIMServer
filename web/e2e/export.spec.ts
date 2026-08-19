/**
 * Phase N3 - Export everywhere
 *
 * Smoke spec exercising the ExportSplitButton primitive on the live UI.
 * Navigates to /endpoints, picks the first endpoint card, opens UsersTab,
 * and asserts the export-button + all three menu items render.
 *
 * Why a smoke (not a full download assertion)?
 *  - Playwright download interception varies by browser/CI sandbox.
 *  - The CSV/JSON/NDJSON encoding contract is locked at the Vitest layer
 *    (see web/src/utils/csv-export.test.ts + ExportSplitButton.test.tsx).
 *  - This spec is the BROWSER-side lock that the wiring (testid presence,
 *    menu open path, three options visible) shipped to dev.
 *
 * DETERMINISM (2026-08-05). This spec previously navigated to /endpoints,
 * counted `[data-testid^="endpoint-"]` immediately after `networkidle`, and
 * skipped when the count was 0. `.count()` does NOT auto-wait, and on a SPA
 * `networkidle` settles before React has rendered the grid - so the spec
 * skipped with "No endpoints available on this environment" while dev was
 * serving 58 endpoints. It had been silently dead. It also depended on
 * whichever endpoint happened to be first having at least one user, which is
 * not a property any environment guarantees.
 *
 * It now creates its OWN endpoint and its OWN user, so the export button is
 * guaranteed to render and the test cannot skip. Both are cleaned up.
 *
 * Usage:
 *   cd web
 *   $env:E2E_BASE_URL = 'https://scimserver-dev.purplecliff-91e4026d.eastus.azurecontainerapps.io'
 *   npx playwright test export.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';

const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';
const TOKEN_STORAGE_KEY = 'scimserver.authToken';

// Seed the auth token BEFORE any script runs, otherwise the app renders its
// "Authentication Required" dialog and every locator below times out.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: TOKEN_STORAGE_KEY, value: TOKEN },
  );
});

/** Create a dedicated endpoint via the admin API from inside the page origin. */
async function createExportEndpoint(page: Page): Promise<string | null> {
  await page.goto('/endpoints');
  return page.evaluate(async (t: string) => {
    const res = await fetch('/scim/admin/endpoints', {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `e2e-export-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        profilePreset: 'rfc-standard',
      }),
    });
    if (!res.ok) return null;
    return (await res.json()).id as string;
  }, TOKEN);
}

/** Seed one user so the UsersTab renders rows (and therefore the toolbar). */
async function createExportUser(page: Page, endpointId: string): Promise<boolean> {
  return page.evaluate(
    async ({ t, epId }: { t: string; epId: string }) => {
      const res = await fetch(`/scim/endpoints/${epId}/Users`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/scim+json' },
        body: JSON.stringify({
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
          userName: `export-fixture-${Date.now()}@example.com`,
          active: true,
        }),
      });
      return res.ok;
    },
    { t: TOKEN, epId: endpointId },
  );
}

async function deleteExportEndpoint(page: Page, id: string | null): Promise<void> {
  if (!id) return;
  await page.evaluate(
    async ({ t, epId }: { t: string; epId: string }) => {
      await fetch(`/scim/admin/endpoints/${epId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${t}` },
      });
    },
    { t: TOKEN, epId: id },
  );
}

test.describe('Phase N3 - Export everywhere (smoke vs dev FQDN)', () => {
  test('UsersTab toolbar exposes Export split-button with CSV/JSON/NDJSON menu items', async ({ page }) => {
    // Creates an endpoint, seeds a user, navigates and cleans up - more than
    // the 30s default allows against a remote FQDN.
    test.setTimeout(120_000);

    const endpointId = await createExportEndpoint(page);
    // Deliberately an assertion, not a skip: admin create failing is a real
    // problem worth failing on, not a reason to silently pass.
    expect(endpointId, 'fixture endpoint must be creatable via the admin API').toBeTruthy();

    try {
      const seeded = await createExportUser(page, endpointId!);
      expect(seeded, 'fixture user must be creatable so the users table renders').toBe(true);

      await page.goto(`/endpoints/${endpointId}/users`);
      // Wait for the tab to actually render - `networkidle` alone settles
      // before React paints, which is what made this spec dead.
      await expect(page.getByTestId('endpoint-detail-page')).toBeVisible({ timeout: 30_000 });

      const exportBtn = page.getByTestId('export-button');
      await expect(exportBtn, 'export button renders once the table has rows').toBeVisible({
        timeout: 30_000,
      });
      await expect(exportBtn).toBeEnabled();

      // Open the split-button menu and assert all three format options render.
      await exportBtn.click();
      await expect(page.getByTestId('export-menu-csv')).toBeVisible();
      await expect(page.getByTestId('export-menu-json')).toBeVisible();
      await expect(page.getByTestId('export-menu-ndjson')).toBeVisible();
    } finally {
      await deleteExportEndpoint(page, endpointId);
    }
  });
});
