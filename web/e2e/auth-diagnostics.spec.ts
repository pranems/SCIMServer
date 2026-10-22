/**
 * auth-diagnostics.spec.ts (WI-D6) - exercises the Auth Diagnostics panel that
 * renders recent Auth Decision Records (WI-D5) on the Connect tab (per-endpoint
 * scope) with an expected-vs-received check diff + a reason-code remediation +
 * an R8 fix cross-link.
 *
 * USER PATHS COVERED
 *   /endpoints/$id/connect -> the Auth diagnostics panel lists a rejected
 *   decision; expanding it shows the failed check (expected vs received), the
 *   catalog reason code + remediation, and a "Fix in ..." link, plus the full
 *   non-secret record as a Copy-as-JSON block.
 *
 * SAFETY
 *   Original panel cases are route-mocked and read-only. The additional live
 *   credential-probe case requires E2E_ALLOW_MUTATIONS=1 and deletes its fixture.
 */
import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createFixtureEndpoint, deleteFixtureEndpoint } from './endpoint-fixture';

const TOKEN_STORAGE_KEY = 'scimserver.authToken';
const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';
const ID = 'ad000000-0000-4000-8000-00000000d6d6';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, value),
    { key: TOKEN_STORAGE_KEY, value: TOKEN },
  );
});

test('live global-secret decision explains the credential skip before disabled-method policy', async ({ page }) => {
  test.skip(process.env.E2E_ALLOW_MUTATIONS !== '1', 'Requires an explicitly mutation-enabled estate.');
  let endpointId: string | null = null;
  try {
    endpointId = await createFixtureEndpoint(page, {
      namePrefix: 'e2e-credential-probe',
      settings: {
        SecretTokenBearerAuthEnabled: false,
        OAuthClientCredentialsAuthEnabled: false,
        SharedSecretBearerAuthEnabled: true,
      },
    });
    const correlationId = randomUUID();
    const probe = await page.evaluate(async ({ id, token, correlation }) => {
      const response = await fetch(`/scim/endpoints/${id}/Groups`, {
        headers: { Authorization: `Bearer ${token}`, 'X-Request-Id': correlation },
      });
      return { status: response.status, body: await response.json() };
    }, { id: endpointId, token: TOKEN, correlation: correlationId });
    expect(probe.status).toBe(200);
    expect(probe.body).toMatchObject({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 0,
      Resources: [],
    });
    const response = await page.request.get(`/scim/admin/endpoints/${endpointId}/auth-decisions`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(response.status()).toBe(200);
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || !('records' in payload) || !Array.isArray(payload.records)) {
      throw new Error('Expected actual authentication decision records.');
    }
    const record: unknown = payload.records.find((candidate: unknown) =>
      candidate !== null && typeof candidate === 'object' &&
      'correlationId' in candidate && candidate.correlationId === correlationId,
    );
    if (!record || typeof record !== 'object' || !('id' in record) || typeof record.id !== 'string' ||
        !('recordedAt' in record) || typeof record.recordedAt !== 'string') {
      throw new Error('Missing actual decision for the fixture request.');
    }
    await page.goto(`/endpoints/${endpointId}/connect`);
    await page.getByTestId(`auth-decision-row-${record.id}`).click();
    const detail = page.getByTestId(`auth-decision-detail-${record.id}`);
    const check = detail.getByTestId('auth-decision-check-endpoint_bearer');
    await expect(check).toContainText('SKIP');
    await expect(check).toContainText('token is the global shared secret (handled by the legacy acceptor)');
    await expect(check).not.toContainText('per-endpoint credentials not enabled');
    const time = page.locator('time').filter({
      has: page.getByTestId(`auth-decision-timestamp-${record.id}`),
    });
    await expect(time).toHaveAttribute('datetime', record.recordedAt);
    await expect(time).toHaveText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} UTC$/);
  } finally {
    const ownedId = endpointId;
    await deleteFixtureEndpoint(page, endpointId);
    if (ownedId) {
      const missing = await page.request.get(`/scim/admin/endpoints/${ownedId}`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(missing.status(), 'fixture endpoint must actually be deleted').toBe(404);
    }
  }
});

const overview = {
  endpoint: { id: ID, name: 'diag', displayName: 'Diag Connect', active: true },
  connectionInfo: {
    endpointId: ID,
    displayName: 'Diag Connect',
    urls: {
      scimBaseUrl: `https://scim.example.com/scim/v2/endpoints/${ID}`,
      scimBaseUrlBare: `https://scim.example.com/scim/endpoints/${ID}`,
      tokenEndpoint: `https://scim.example.com/scim/endpoints/${ID}/oauth/token`,
      serviceProviderConfig: `https://scim.example.com/scim/v2/endpoints/${ID}/ServiceProviderConfig`,
      oauthMetadata: `https://scim.example.com/scim/endpoints/${ID}/.well-known/oauth-authorization-server`,
    },
    enabledMethods: [
      {
        method: 'oauth_client',
        label: 'OAuth2 client credentials',
        entraAuthenticationMethod: 'OAuth2 Client Credentials Grant',
        entraFields: {
          tenantUrl: `https://scim.example.com/scim/v2/endpoints/${ID}`,
          tokenEndpoint: `https://scim.example.com/scim/endpoints/${ID}/oauth/token`,
          clientIdentifier: `client-id-${ID}`,
          clientSecret: null,
        },
        clientSecretState: 'set-shown-once',
      },
    ],
    disabledMethods: [],
  },
};

const decisions = {
  count: 1,
  records: [
    {
      id: 'adr_e2e_1',
      recordedAt: '2026-07-13T12:00:00.000Z',
      plane: 'token-mint',
      method: 'wif',
      outcome: 'reject',
      reasonCode: 'wif_audience_mismatch',
      endpointId: ID,
      correlationId: 'req-e2e-1',
      checks: [
        { id: 'jwks_signature', status: 'pass' },
        { id: 'audience_match', status: 'fail', expected: 'api://expected', received: 'api://actual' },
      ],
      decodedClaims: { iss: 'https://issuer', aud: 'api://actual' },
    },
  ],
};

test.describe('Auth Diagnostics panel (WI-D6)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route(`**/scim/admin/endpoints/${ID}`, async (route) => {
      if (route.request().method() !== 'GET' || !route.request().url().endsWith(`/${ID}`)) return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: ID,
          name: 'diag',
          displayName: 'Diag Connect',
          active: true,
          scimBasePath: `/scim/v2/endpoints/${ID}`,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          profile: { schemas: [], resourceTypes: [], serviceProviderConfig: { documentationUri: '', patch: { supported: true } }, settings: {} },
        }),
      });
    });
    await page.route(`**/scim/admin/endpoints/${ID}/overview`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overview) });
    });
    await page.route(`**/scim/admin/endpoints/${ID}/auth-decisions**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(decisions) });
    });
  });

  test('the panel lists a recent rejected decision on the Connect tab', async ({ page }) => {
    await page.goto(`/endpoints/${ID}/connect`);
    await expect(page.getByTestId('connect-tab-auth-diagnostics')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('auth-decision-row-adr_e2e_1')).toBeVisible();
    await expect(page.getByTestId('auth-decision-outcome-adr_e2e_1')).toHaveText('reject');
  });

  test('expanding a decision shows the expected-vs-received check diff + remediation + fix link', async ({ page }) => {
    await page.goto(`/endpoints/${ID}/connect`);
    await expect(page.getByTestId('connect-tab-auth-diagnostics')).toBeVisible({ timeout: 30_000 });

    // Expand the decision (the accordion toggle is the header button).
    await page.getByTestId('auth-decision-row-adr_e2e_1').click();

    // R10: assert the RENDERED diff values, not just element presence.
    const failed = page.getByTestId('auth-decision-check-audience_match');
    await expect(failed).toBeVisible();
    await expect(failed).toContainText('api://expected');
    await expect(failed).toContainText('api://actual');

    // Reason code + remediation + fix link (R8 cross-link to Credentials).
    await expect(page.getByTestId('auth-decision-remediation-adr_e2e_1')).toContainText('wif_audience_mismatch');
    await expect(page.getByTestId('auth-decision-fix-adr_e2e_1')).toBeVisible();

    // Full non-secret record is copyable as JSON.
    await expect(page.getByTestId('auth-decision-json-adr_e2e_1')).toBeVisible();
  });

  test('the fix link navigates to the endpoint Connect tab', async ({ page }) => {
    await page.goto(`/endpoints/${ID}/connect`);
    await expect(page.getByTestId('connect-tab-auth-diagnostics')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('auth-decision-row-adr_e2e_1').click();
    await page.getByTestId('auth-decision-fix-adr_e2e_1').click();
    await expect(page).toHaveURL(new RegExp(`/endpoints/${ID}/connect`));
  });
});
