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

test.describe('Logs auth durability (V10/V11/V12)', () => {
  // The auth summary persisted ON the row must render the chip + drawer summary
  // EVEN WHEN the short-TTL auth-decision store has expired (no records). This
  // is the durable-fail guarantee (V12): a rejected request stays legible in
  // the logs list long after the ephemeral decision record is gone.
  const durableList = {
    total: 1,
    page: 1,
    pageSize: 50,
    items: [
      {
        id: 'log-v10-1',
        method: 'POST',
        url: '/scim/v2/endpoints/ep-x/Users',
        status: 401,
        durationMs: 4,
        createdAt: '2026-07-21T12:00:00.000Z',
        requestId: 'req-v10-1',
        authOutcome: 'reject',
        authMethod: 'wif',
        authReason: 'wif_issuer_mismatch',
        authCredentialId: 'trust-durable',
      },
    ],
  };
  const durableDetail = {
    ...durableList.items[0],
    requestHeaders: {},
    requestBody: {},
    responseHeaders: {},
    responseBody: {},
    // W1 - the FULL auth decision trace persisted on the row (never expires).
    authDecision: {
      plane: 'resource',
      method: 'bearer_jwt',
      outcome: 'reject',
      reasonCode: 'wif_issuer_mismatch',
      checks: [
        { id: 'issuer_match', status: 'fail', expected: 'https://expected', received: 'https://actual' },
      ],
    },
  };

  test.beforeEach(async ({ page }) => {
    // Empty auth-decisions store - the persisted row fields are the ONLY source.
    await page.route('**/scim/admin/auth-decisions**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0, records: [] }) });
    });
    await page.route('**/scim/admin/logs**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(durableList) });
    });
    await page.route('**/scim/admin/logs/log-v10-1', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(durableDetail) });
    });
  });

  test('V10/V12: the row chip renders from the persisted field with an empty decision store', async ({ page }) => {
    await page.goto('/logs');
    await expect(page.getByTestId('global-logs-page')).toBeVisible({ timeout: 30_000 });
    const chip = page.getByTestId('log-row-auth-log-v10-1');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('wif_issuer_mismatch');
  });

  test('V11: the drawer shows the durable "Authenticated via" summary from persisted fields', async ({ page }) => {
    await page.goto('/logs');
    await expect(page.getByTestId('global-logs-page')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('logs-row-log-v10-1').click();
    const summary = page.getByTestId('log-detail-auth-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('wif');
    await expect(summary).toContainText('trust-durable');
  });

  test('W1: the auth decision diff renders from the PERSISTED trace with an empty store', async ({ page }) => {
    await page.goto('/logs');
    await expect(page.getByTestId('global-logs-page')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('logs-row-log-v10-1').click();
    // The short-TTL store is empty; the persisted authDecision is the only
    // source, and the expected-vs-received diff must still render.
    await expect(page.getByTestId('log-detail-auth-section-record')).toBeVisible();
    const failed = page.getByTestId('auth-decision-check-issuer_match');
    await expect(failed).toContainText('https://expected');
    await expect(failed).toContainText('https://actual');
    await expect(page.getByTestId('log-detail-auth-section-empty')).toHaveCount(0);
  });
});

test.describe('Logs auth-method chip + endpoint name (X5/X6)', () => {
  const EP_ID = 'ep-x5';
  const x5List = {
    total: 2,
    page: 1,
    pageSize: 50,
    items: [
      {
        id: 'log-x5-crud',
        method: 'GET',
        url: `/scim/v2/endpoints/${EP_ID}/Users`,
        status: 200,
        durationMs: 6,
        createdAt: '2026-07-23T12:00:00.000Z',
        requestId: 'req-x5-crud',
        endpointId: EP_ID,
        authOutcome: 'accept',
        authMethod: 'bearer_jwt',
      },
      {
        id: 'log-x5-mint',
        method: 'POST',
        url: `/scim/endpoints/${EP_ID}/oauth/token`,
        status: 201,
        durationMs: 30,
        createdAt: '2026-07-23T12:01:00.000Z',
        requestId: 'req-x5-mint',
        endpointId: EP_ID,
        authOutcome: 'accept',
        authMethod: 'oauth_client',
      },
    ],
  };
  const endpointsList = {
    totalResults: 1,
    endpoints: [{ id: EP_ID, name: 'x5-endpoint', displayName: 'X5 Endpoint', active: true }],
  };

  test.beforeEach(async ({ page }) => {
    await page.route('**/scim/admin/auth-decisions**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0, records: [] }) });
    });
    await page.route('**/scim/admin/endpoints', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(endpointsList) });
    });
    await page.route('**/scim/admin/logs**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x5List) });
    });
  });

  test('X5: a resource-CRUD row names the auth method; a token-mint row names the minted JWT', async ({ page }) => {
    await page.goto('/logs');
    await expect(page.getByTestId('global-logs-page')).toBeVisible({ timeout: 30_000 });
    // Resource CRUD -> "auth ok - OAuth JWT".
    const crudChip = page.getByTestId('log-row-auth-log-x5-crud');
    await expect(crudChip).toContainText('auth ok');
    await expect(crudChip).toContainText('OAuth JWT');
    // Token-mint -> "JWT - OAuth client" (names the minted token + the method).
    const mintChip = page.getByTestId('log-row-auth-log-x5-mint');
    await expect(mintChip).toContainText('JWT');
    await expect(mintChip).toContainText('OAuth client');
  });

  test('X6: a log row shows the endpoint NAME + a quick-open button', async ({ page }) => {
    await page.goto('/logs');
    await expect(page.getByTestId('global-logs-page')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('log-row-endpoint-log-x5-crud')).toContainText('x5-endpoint');
    await expect(page.getByTestId('log-row-endpoint-open-log-x5-crud')).toBeVisible();
  });
});

