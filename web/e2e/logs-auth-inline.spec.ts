/**
 * logs-auth-inline.spec.ts (U11 + U12) - the request-log surface now shows the
 * authentication decision for a request INSIDE the request's own DetailDrawer
 * (U11), joined by requestId === correlationId, plus a per-row auth-outcome
 * chip in the log list (U12). The standalone auth-diagnostics panel is removed
 * from the logs surface (re-scoped to Connect -> Health).
 *
 * Fully route-mocked (no live server dependency). READ-ONLY.
 */
import { test, expect } from '@playwright/test';

const TOKEN_STORAGE_KEY = 'scimserver.authToken';
const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';
const CORR = 'req-u11-1';

const logsList = {
  total: 1,
  page: 1,
  pageSize: 50,
  items: [
    {
      id: 'log-u11-1',
      method: 'POST',
      url: '/scim/v2/endpoints/ep-x/Users',
      status: 401,
      durationMs: 4,
      createdAt: '2026-07-21T12:00:00.000Z',
      requestId: CORR,
    },
  ],
};

const logDetail = {
  id: 'log-u11-1',
  method: 'POST',
  url: '/scim/v2/endpoints/ep-x/Users',
  status: 401,
  durationMs: 4,
  createdAt: '2026-07-21T12:00:00.000Z',
  requestId: CORR,
  requestHeaders: {},
  requestBody: {},
  responseHeaders: {},
  responseBody: {},
};

const decisions = {
  count: 1,
  records: [
    {
      id: 'adr_u11_1',
      recordedAt: '2026-07-21T12:00:00.000Z',
      plane: 'token-mint',
      method: 'wif',
      outcome: 'reject',
      reasonCode: 'wif_audience_mismatch',
      endpointId: 'ep-x',
      correlationId: CORR,
      checks: [
        { id: 'jwks_signature', status: 'pass' },
        { id: 'audience_match', status: 'fail', expected: 'api://expected', received: 'api://actual' },
      ],
      decodedClaims: { iss: 'https://issuer', aud: 'api://actual' },
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: TOKEN_STORAGE_KEY, value: TOKEN },
  );
  await page.route('**/scim/admin/auth-decisions**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(decisions) });
  });
  // The list route is registered BEFORE the detail route so that - because
  // Playwright checks handlers in reverse registration order - the more specific
  // detail route (registered last) wins for `/logs/log-u11-1`, while the list
  // route serves `/logs?...`. (An earlier version used route.continue() as a
  // guard, which sent the detail request to the live network instead of the
  // detail mock - the U11 dev-run failure.)
  await page.route('**/scim/admin/logs**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(logsList) });
  });
  await page.route('**/scim/admin/logs/log-u11-1', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(logDetail) });
  });
});

test.describe('Logs auth integration (U11 + U12)', () => {
  test('U12: the request-log row shows an auth-outcome chip', async ({ page }) => {
    await page.goto('/logs');
    await expect(page.getByTestId('global-logs-page')).toBeVisible({ timeout: 30_000 });
    const chip = page.getByTestId('log-row-auth-log-u11-1');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('wif_audience_mismatch');
  });

  test('U12: the standalone auth-diagnostics panel is no longer on the logs surface', async ({ page }) => {
    await page.goto('/logs');
    await expect(page.getByTestId('global-logs-page')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('global-logs-auth-diagnostics')).toHaveCount(0);
  });

  test('U11: opening a request shows its auth decision inline in the drawer', async ({ page }) => {
    await page.goto('/logs');
    await expect(page.getByTestId('global-logs-page')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('logs-row-log-u11-1').click();
    // The inline auth section renders the matched decision + the failed check.
    await expect(page.getByTestId('log-detail-auth-section')).toBeVisible();
    await expect(page.getByTestId('log-detail-auth-section-record')).toBeVisible();
    const failed = page.getByTestId('auth-decision-check-audience_match');
    await expect(failed).toContainText('api://expected');
    await expect(failed).toContainText('api://actual');
  });
});
