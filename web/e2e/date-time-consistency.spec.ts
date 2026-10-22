import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const id = '00000000-0000-4000-8000-000000000050';
const created = '2026-10-14T23:59:58.123Z';
const recorded = '2026-10-15T04:05:06.789Z';
const expiry = '2030-11-21T22:23:24.567Z';
const token = process.env.E2E_TOKEN || 'changeme-scim';
const display = (iso: string): string => iso.replace('T', ' ').replace('Z', ' UTC');

async function fixtures(page: Page): Promise<void> {
  // Keep the persisted fixture within the production notification retention window.
  await page.clock.setFixedTime(new Date('2026-10-15T12:00:00.000Z'));
  const flags = {
    SecretTokenBearerAuthEnabled: true,
    WifCredentialsEnabled: true,
    OAuthClientCredentialsAuthEnabled: false,
    SharedSecretAuthEnabled: true,
  };
  const endpoint = {
    id,
    name: 'timestamp-fixture',
    displayName: 'Timestamp fixture',
    active: true,
    createdAt: created,
    updatedAt: recorded,
    scimBasePath: `/scim/endpoints/${id}`,
    profile: {
      schemas: [],
      resourceTypes: [],
      settings: flags,
      serviceProviderConfig: {},
    },
  };
  const urls = {
    scimBaseUrl: `https://example.invalid/scim/v2/endpoints/${id}`,
    scimBaseUrlBare: `https://example.invalid/scim/endpoints/${id}`,
    tokenEndpoint: `https://example.invalid/scim/endpoints/${id}/oauth/token`,
    serviceProviderConfig: `https://example.invalid/scim/endpoints/${id}/ServiceProviderConfig`,
    oauthMetadata: `https://example.invalid/scim/endpoints/${id}/.well-known/oauth-authorization-server`,
  };
  const connectionInfo = {
    endpointId: id,
    displayName: endpoint.displayName,
    urls,
    enabledMethods: [
      {
        method: 'shared_secret',
        label: 'Global shared secret',
        entraAuthenticationMethod: 'Secret Token',
        entraFields: { tenantUrl: urls.scimBaseUrl, secretToken: null },
        clientSecretState: 'set-shown-once',
        authHealth: { lastOutcome: 'accept', lastAttemptAt: recorded },
      },
      {
        method: 'bearer',
        label: 'Per-endpoint bearer',
        entraAuthenticationMethod: 'Secret Token',
        entraFields: { tenantUrl: urls.scimBaseUrl, secretToken: null },
        clientSecretState: 'set-shown-once',
        authHealth: { lastOutcome: 'accept', lastAttemptAt: recorded },
      },
      {
        method: 'wif',
        label: 'Workload Identity Federation',
        entraAuthenticationMethod: 'Workload Identity based authentication',
        entraFields: {
          tenantUrl: urls.scimBaseUrl,
          tokenEndpoint: urls.tokenEndpoint,
          clientIdentifier: id,
        },
        clientSecretState: 'none',
      },
    ],
    disabledMethods: [
      {
        method: 'oauth_client',
        reason: 'Disabled in fixture',
        enableHint: 'Enable OAuth',
      },
    ],
  };
  const credentials = [
    {
      id: 'timestamp-bearer',
      credentialType: 'bearer',
      label: 'Timestamp bearer',
      active: true,
      createdAt: recorded,
      expiresAt: expiry,
      hashAlgo: 'hmac-sha256-v1',
    },
    {
      id: 'timestamp-invalid',
      credentialType: 'bearer',
      label: 'Ambiguous expiry',
      active: true,
      createdAt: recorded,
      expiresAt: '2030-11-21T22:23:24',
      hashAlgo: 'hmac-sha256-v1',
    },
    {
      id: 'timestamp-wif',
      credentialType: 'wif',
      label: 'Timestamp trust',
      active: true,
      createdAt: created,
      expiresAt: null,
      wif: {
        expectedIssuer: 'https://issuer.example.invalid',
        expectedSubject: 'timestamp-subject',
        expectedAudience: 'timestamp-audience',
        jwksUri: 'https://issuer.example.invalid/keys',
        lastVerifiedAt: recorded,
      },
    },
  ];
  const log = {
    id: 'timestamp-log',
    endpointId: id,
    endpointName: endpoint.displayName,
    method: 'GET',
    url: `/scim/endpoints/${id}/Users`,
    status: 200,
    durationMs: 12,
    createdAt: recorded,
  };
  const overview = {
    endpoint,
    configFlags: flags,
    connectionInfo,
    credentials,
    stats: {
      userCount: 1,
      activeUserCount: 1,
      groupCount: 1,
      activeGroupCount: 1,
      genericResourceCount: 0,
    },
    recentActivity: [
      {
        id: 'timestamp-overview',
        timestamp: recorded,
        method: 'GET',
        path: log.url,
        statusCode: 200,
        durationMs: 12,
      },
    ],
  };
  const decisions = {
    count: 1,
    records: [
      {
        id: 'timestamp-decision',
        recordedAt: created,
        plane: 'scim-request',
        method: 'bearer',
        outcome: 'accept',
        endpointId: id,
        correlationId: 'timestamp-request',
        checks: [],
      },
    ],
  };
  await page.addInitScript(
    ({ token, created, recorded }) => {
      localStorage.setItem('scimserver.authToken', token);
      localStorage.setItem(
        'scimserver.notifications.v1',
        JSON.stringify({
          unreadCount: 1,
          entries: [
            {
              id: 'timestamp-notification',
              timestamp: created,
              type: 'scim.user.created',
              severity: 'info',
              title: 'Timestamp notification',
              read: false,
            },
          ],
        }),
      );
      localStorage.setItem(
        'scimserver.workbench.history.v1',
        JSON.stringify([
          {
            id: 'timestamp-history',
            method: 'GET',
            path: '/scim/Users',
            status: 200,
            durationMs: 12,
            timestamp: recorded,
            responseBody: { totalResults: 1 },
          },
        ]),
      );
    },
    { token, created, recorded },
  );
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/scim/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === 'POST' && path.endsWith('/reveal')) {
      return route.fulfill({
        json: { secret: 'timestamp-display-fixture-only', available: true },
      });
    }
    expect(
      route.request().method(),
      `timestamp fixtures must never forward a mutation: ${path}`,
    ).toBe('GET');
    if (path === '/scim/admin/log-config/stream') {
      return route.fulfill({
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({
          timestamp: recorded,
          level: 'INFO',
          category: 'http',
          message: 'Timestamp stream fixture',
        })}\n\n`,
      });
    }
    const bodies: Record<string, unknown> = {
      '/scim/admin/endpoints': { endpoints: [endpoint], totalResults: 1 },
      [`/scim/admin/endpoints/${id}`]: endpoint,
      [`/scim/admin/endpoints/${id}/overview`]: overview,
      [`/scim/admin/endpoints/${id}/connection-info`]: connectionInfo,
      [`/scim/admin/endpoints/${id}/auth-decisions`]: decisions,
      '/scim/admin/auth-decisions': decisions,
      '/scim/admin/logs': { items: [log], total: 1, page: 1, pageSize: 20 },
      '/scim/admin/activity': {
        activities: [
          {
            id: 'timestamp-activity',
            type: 'user',
            severity: 'success',
            timestamp: recorded,
            icon: '',
            message: 'User created',
            details: 'Timestamp fixture',
          },
        ],
        pagination: { page: 1, limit: 20, total: 1, pages: 1 },
        filters: { types: ['user'], severities: ['success'] },
      },
      [`/scim/endpoints/${id}/Users`]: {
        Resources: [
          {
            id: 'timestamp-user',
            userName: 'timestamp@example.invalid',
            active: true,
            meta: { created: recorded },
          },
        ],
        totalResults: 1,
        startIndex: 1,
        itemsPerPage: 20,
      },
      [`/scim/endpoints/${id}/Groups`]: {
        Resources: [
          {
            id: 'timestamp-group',
            displayName: 'Timestamp group',
            members: [],
            meta: { created: recorded },
          },
        ],
        totalResults: 1,
        startIndex: 1,
        itemsPerPage: 20,
      },
      [`/scim/endpoints/${id}/Schemas`]: { Resources: [], totalResults: 0 },
      [`/scim/endpoints/${id}/ResourceTypes`]: {
        Resources: [],
        totalResults: 0,
      },
      [`/scim/endpoints/${id}/ServiceProviderConfig`]: {
        patch: { supported: true },
      },
    };
    if (Object.hasOwn(bodies, path)) return route.fulfill({ json: bodies[path] });
    return route.continue();
  });
}

async function expectInstant(scope: Locator, iso: string): Promise<void> {
  const instant = scope
    .locator('time')
    .filter({ hasText: display(iso) })
    .first();
  await expect(instant).toHaveText(display(iso));
  await expect(instant).toHaveAttribute('datetime', iso);
  await expect(instant.locator('xpath=ancestor::button')).toHaveCount(0);
  await instant.scrollIntoViewIfNeeded();
  const bounds = await instant.evaluate((element) => {
    const value = element.firstElementChild!.firstElementChild!;
    const range = document.createRange();
    range.selectNodeContents(value);
    const cell = element.closest('td') ?? element.parentElement!;
    const box = cell.getBoundingClientRect();
    return {
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
      container: {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      },
      text: Array.from(range.getClientRects(), (rect) => ({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      })),
    };
  });
  expect(bounds.text.length).toBeGreaterThan(0);
  expect(bounds.page, 'timestamp content must not expand the page').toBeLessThanOrEqual(
    bounds.viewport + 1,
  );
  for (const rect of bounds.text) {
    expect(rect.left).toBeGreaterThanOrEqual(bounds.container.left - 1);
    expect(rect.right).toBeLessThanOrEqual(bounds.container.right + 1);
    expect(rect.top).toBeGreaterThanOrEqual(bounds.container.top - 1);
    expect(rect.bottom).toBeLessThanOrEqual(bounds.container.bottom + 1);
  }
  const page = scope.page();
  const before = page.url();
  await instant.getByRole('button', { name: 'Copy timestamp' }).press('Enter');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(iso);
  expect(page.url(), 'copying a timestamp must not activate the containing row').toBe(before);
}

for (const width of [1440, 900, 390]) {
  test.describe(`${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await fixtures(page);
    });

    test(`Resource and request tables retain complete timestamps at ${width}px`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      for (const section of ['users', 'groups', 'logs']) {
        await page.goto(`/endpoints/${id}/${section}`);
        await expectInstant(page.getByTestId('endpoint-detail-page'), created);
        await expectInstant(page.locator('table tbody'), recorded);
      }
      await page.goto('/logs');
      await expectInstant(page.getByTestId('global-logs-page'), recorded);
    });

    test(`Activity, overview and workbench retain complete timestamps at ${width}px`, async ({
      page,
    }, info) => {
      test.setTimeout(90_000);
      for (const [section, row] of [
        ['activity', 'activity-row-timestamp-activity'],
        ['overview', 'overview-activity-row-timestamp-overview'],
      ]) {
        await page.goto(
          section === 'overview' ? `/endpoints/${id}` : `/endpoints/${id}/${section}`,
        );
        await expectInstant(page.getByTestId(row), recorded);
        if (section === 'overview') {
          await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
          await page
            .getByTestId(row)
            .getByRole('button', { name: 'Copy timestamp' })
            .press('Enter');
          expect(new URL(page.url()).pathname).toBe(`/endpoints/${id}`);
          await expect
            .poll(() => page.evaluate(() => navigator.clipboard.readText()))
            .toBe(recorded);
          await page.getByTestId('overview-activity-open-timestamp-overview').press('Enter');
          await expect.poll(() => new URL(page.url()).pathname).toBe('/logs');
          expect(new URL(page.url()).searchParams.get('detail')).toBe('timestamp-overview');
          expect(new URL(page.url()).searchParams.get('endpointId')).toBe(id);
        }
      }
      await page.goto('/workbench');
      await expectInstant(page.getByTestId('workbench-history-row-timestamp-history'), recorded);
      const metrics = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        page: document.documentElement.scrollWidth,
      }));
      expect(metrics.page).toBeLessThanOrEqual(metrics.viewport + 1);
      const directory = resolve(info.project.outputDir, '..', 'ui-date-time-evidence');
      await mkdir(directory, { recursive: true });
      await writeFile(
        resolve(directory, `workbench-${width}.json`),
        JSON.stringify(metrics, null, 2),
      );
    });

    test(`Connection and credential timestamps retain both date and time at ${width}px`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.goto(`/endpoints/${id}/connect?method=shared_secret`);
      await page.getByTestId('credentials-method-tab-shared_secret').click();
      await expectInstant(page.getByTestId('connect-tab-panel'), recorded);
      await expectInstant(page.getByTestId('connect-tab-auth-diagnostics'), created);
      await expect(
        page.locator('button button'),
        'timestamp copy actions must not nest inside accordion buttons',
      ).toHaveCount(0);
      await page.goto(`/endpoints/${id}/credentials?method=bearer`);
      await page.getByTestId('credentials-method-tab-bearer').click();
      const credential = page.getByTestId('credential-row-timestamp-bearer');
      await expectInstant(credential, recorded);
      await expect(credential).toContainText(`Valid until ${display(expiry)}`);
      await expect(page.getByTestId('credential-validity-timestamp-invalid')).toHaveText(
        'Invalid expiry: 2030-11-21T22:23:24',
      );
      await page.getByTestId('credentials-method-tab-wif').click();
      await expectInstant(page.getByTestId('wif-credential-timestamp-wif-validity'), recorded);
    });

    test(`Notification and live-log drawers retain absolute timestamps at ${width}px`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.goto('/logs');
      await page.getByTestId('notifications-button').click();
      await expectInstant(page.getByTestId('notifications-row-timestamp-notification'), created);
      await page.getByTestId('notifications-close').click();
      await page.getByTestId('log-stream-toggle').click();
      const row = page.getByTestId('log-stream-row-0');
      await expect(row).toContainText('Timestamp stream fixture');
      await expectInstant(row, recorded);
    });
  });
}
