import { test, expect, type Page } from '@playwright/test';

/**
 * credential-token-format.spec.ts - P1 keyed credential lookup, in a real browser.
 *
 * WHY THIS EXISTS
 *   P1 changed the value an operator copies out of the UI: a bearer credential
 *   is now issued as `scim_<lookupKey>_<secret>` instead of a bare opaque
 *   string. That is the ONE part of P1 a human actually touches, and it had no
 *   browser coverage - the API E2E proves the server mints it, but nothing
 *   proved the dialog renders it, or that it survives the round trip through the
 *   React state into the copyable box.
 *
 *   It also guards a specific regression shape: if the token were ever truncated
 *   at the `_` separator by some display or copy helper, the operator would copy
 *   a value that authenticates against nothing, and every server-side test would
 *   still pass. (That exact truncation bug DID occur during implementation, in
 *   the parser, because base64url contains `_`.)
 *
 * SAFETY
 *   Creates its own throwaway endpoint and deletes it in a finally block, so it
 *   is safe against the shared dev estate. The secret it surfaces belongs to a
 *   credential on an endpoint that is destroyed moments later.
 *
 * Runs against local dev (:4000), Docker compose (:8080) and Azure dev.
 */
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

/** Create an endpoint with per-endpoint bearer auth enabled. */
async function createEndpoint(page: Page): Promise<string | null> {
  await page.goto('/endpoints');
  return page.evaluate(async (t: string) => {
    const authed = { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' };
    const res = await fetch('/scim/admin/endpoints', {
      method: 'POST',
      headers: authed,
      body: JSON.stringify({
        name: `e2e-p1-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        profilePreset: 'rfc-standard',
      }),
    });
    if (!res.ok) return null;
    const ep = await res.json();
    await fetch(`/scim/admin/endpoints/${ep.id}`, {
      method: 'PATCH',
      headers: authed,
      body: JSON.stringify({ profile: { settings: { SecretTokenBearerAuthEnabled: 'True' } } }),
    });
    return ep.id as string;
  }, TOKEN);
}

async function deleteEndpoint(page: Page, id: string): Promise<void> {
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

test.describe('P1 - the issued credential token in the browser', () => {
  test('creating a bearer credential through the UI shows a keyed scim_ token', async ({ page }) => {
    test.setTimeout(120_000);
    let id: string | null = null;
    try {
      id = await createEndpoint(page);
      test.skip(!id, 'Could not create the fixture endpoint.');

      await page.goto(`/endpoints/${id}/credentials`);
      await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('credentials-create-button').click();
      await expect(page.getByTestId('credentials-create-dialog')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('credentials-label-input').fill('p1-browser');
      await page.getByTestId('credentials-create-dialog-submit').click();

      // The one-time token box must render the issued value.
      const tokenEl = page.getByTestId('credentials-token-value');
      await expect(tokenEl).toBeVisible({ timeout: 30_000 });

      const shown = (await tokenEl.textContent())?.trim() ?? '';
      expect(shown.startsWith('scim_')).toBe(true);

      // Structure, not just the prefix: `scim_<hex key>_<secret>`. A value
      // truncated at the separator would still start with `scim_` and would
      // authenticate against nothing, so the prefix alone is not enough.
      expect(shown).toMatch(/^scim_[0-9a-f]{8,}_[A-Za-z0-9_-]{20,}$/);

      // R9: the operator must be able to copy it.
      await expect(page.getByTestId('credentials-copy-button')).toBeVisible();
    } finally {
      if (id) await deleteEndpoint(page, id);
    }
  });

  test('the token shown in the UI actually authenticates a SCIM request', async ({ page }) => {
    // The strongest available assertion: take the value a human would copy out
    // of the dialog and use it. If any display or state step mangled it, this
    // fails where a format regex might still pass.
    test.setTimeout(120_000);
    let id: string | null = null;
    try {
      id = await createEndpoint(page);
      test.skip(!id, 'Could not create the fixture endpoint.');

      await page.goto(`/endpoints/${id}/credentials`);
      await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('credentials-create-button').click();
      await page.getByTestId('credentials-label-input').fill('p1-roundtrip');
      await page.getByTestId('credentials-create-dialog-submit').click();

      const tokenEl = page.getByTestId('credentials-token-value');
      await expect(tokenEl).toBeVisible({ timeout: 30_000 });
      const shown = (await tokenEl.textContent())?.trim() ?? '';

      const status = await page.evaluate(
        async ({ epId, cred }: { epId: string; cred: string }) => {
          const res = await fetch(`/scim/endpoints/${epId}/Users?count=1`, {
            headers: { Authorization: `Bearer ${cred}` },
          });
          return res.status;
        },
        { epId: id!, cred: shown },
      );
      expect(status).toBe(200);
    } finally {
      if (id) await deleteEndpoint(page, id);
    }
  });
});
