import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  E2E_TOKEN,
  createFixtureEndpoint,
  deleteFixtureEndpoint,
  seedAuthToken,
} from './endpoint-fixture';

interface LogItem {
  id: string;
  endpointId?: string;
  endpointName?: string;
}

let endpointId: string | null = null;
const authorization = ['Bearer', E2E_TOKEN].join(' ');

test.beforeEach(async ({ page }) => {
  await seedAuthToken(page);
});

test.afterEach(async ({ page }) => {
  endpointId = await deleteFixtureEndpoint(page, endpointId);
});

async function expectTableBounds(
  page: Page,
  table: Locator,
  expectedHeaders: string[],
  viewportWidth: number,
): Promise<void> {
  await page.setViewportSize({ width: viewportWidth, height: 900 });
  await expect(table).toBeVisible();
  await expect(table.locator('thead th')).toHaveText(expectedHeaders);

  const metrics = await table.evaluate((element) => {
    const tableElement = element as HTMLTableElement;
    const parent = tableElement.parentElement as HTMLElement;
    const tableRect = tableElement.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const headerRects = [...tableElement.querySelectorAll('thead th')].map((header) => {
      const rect = header.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    });
    return {
      table: { left: tableRect.left, right: tableRect.right, width: tableRect.width },
      parent: {
        left: parentRect.left,
        right: parentRect.right,
        clientWidth: parent.clientWidth,
        scrollWidth: parent.scrollWidth,
        overflowX: getComputedStyle(parent).overflowX,
      },
      headerRects,
    };
  });

  expect(metrics.headerRects.every((header) => header.width > 40)).toBe(true);
  expect(metrics.headerRects.at(-1)?.right ?? 0).toBeLessThanOrEqual(metrics.table.right + 1);
  expect(metrics.parent.left).toBeGreaterThanOrEqual(0);
  expect(metrics.parent.right).toBeLessThanOrEqual(viewportWidth + 1);
  if (metrics.table.width > metrics.parent.clientWidth) {
    expect(metrics.parent.scrollWidth).toBeGreaterThan(metrics.parent.clientWidth);
    expect(metrics.parent.overflowX).toBe('auto');
  }
}

test('request tables retain endpoint names and stay bounded across endpoint deletion', async ({ page }) => {
  test.setTimeout(180_000);
  endpointId = await createFixtureEndpoint(page, {
    namePrefix: 'e2e-log-table',
    users: 1,
  });

  const endpointResponse = await page.request.get(`/scim/admin/endpoints/${endpointId}`, {
    headers: { Authorization: authorization },
  });
  expect(endpointResponse.status()).toBe(200);
  const endpoint = await endpointResponse.json() as { name: string; displayName?: string };
  const endpointLabel = endpoint.displayName ?? endpoint.name;

  let logItem: LogItem | undefined;
  await expect.poll(async () => {
    const response = await page.request.get(
      `/scim/admin/logs?endpointId=${endpointId}&pageSize=50`,
      { headers: { Authorization: authorization } },
    );
    if (!response.ok()) return 0;
    const body = await response.json() as { items?: LogItem[] };
    logItem = body.items?.find((item) => item.endpointId === endpointId);
    return logItem ? 1 : 0;
  }, { timeout: 30_000 }).toBe(1);
  expect(logItem).toBeDefined();

  await page.goto(`/logs?endpointId=${endpointId}&page=1`);
  await expect(page.getByTestId('global-logs-page')).toBeVisible({ timeout: 30_000 });
  const globalTable = page.getByTestId('global-logs-page').locator('table');
  await expectTableBounds(
    page,
    globalTable,
    ['Method', 'URL', 'Endpoint', 'Status', 'Auth', 'Duration', 'Time'],
    1440,
  );
  await expectTableBounds(
    page,
    globalTable,
    ['Method', 'URL', 'Endpoint', 'Status', 'Auth', 'Duration', 'Time'],
    900,
  );

  const endpointCell = page.getByTestId(`log-row-endpoint-${logItem!.id}`);
  await expect(endpointCell).toContainText(endpointLabel);
  await expect(page.getByTestId(`log-row-endpoint-open-${logItem!.id}`)).toBeVisible();

  await page.goto(`/endpoints/${endpointId}/logs`);
  await expect(page.getByTestId('logs-tab')).toBeVisible({ timeout: 30_000 });
  await expectTableBounds(
    page,
    page.getByTestId('logs-tab').locator('table'),
    ['Method', 'URL', 'Status', 'Auth', 'Duration', 'Time'],
    900,
  );
  await expect(page.getByTestId('endpoint-detail-page')).toContainText(endpointLabel);

  await page.goto(`/endpoints/${endpointId}/activity`);
  const activityList = page.getByTestId('activity-list');
  await expect(activityList).toBeVisible({ timeout: 30_000 });
  const activityRows = activityList.locator(
    '[data-testid^="activity-row-"]:not([data-testid$="-copy-json"])',
  );
  await expect(activityRows.first()).toBeVisible();
  const activityBounds = await activityRows.evaluateAll((rows) =>
    rows.map((row) => {
      const rect = row.getBoundingClientRect();
      const main = row.closest('main')!.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        mainLeft: main.left,
        mainRight: main.right,
      };
    }),
  );
  expect(activityBounds.every((row) =>
    row.left >= row.mainLeft - 1 && row.right <= row.mainRight + 1)).toBe(true);
  await expect(page.getByTestId('endpoint-detail-page')).toContainText(endpointLabel);

  const deletedEndpointId = endpointId;
  endpointId = await deleteFixtureEndpoint(page, endpointId);
  expect(endpointId).toBeNull();

  let historicalLog: LogItem | undefined;
  await expect.poll(async () => {
    const response = await page.request.get(
      `/scim/admin/logs?endpointId=${deletedEndpointId}&pageSize=50`,
      { headers: { Authorization: authorization } },
    );
    if (!response.ok()) return 0;
    const body = await response.json() as { items?: LogItem[] };
    historicalLog = body.items?.find((item) => item.endpointName === endpointLabel);
    return historicalLog ? 1 : 0;
  }, { timeout: 30_000 }).toBe(1);

  await page.goto(`/logs?endpointId=${deletedEndpointId}&page=1`);
  await expect(page.getByTestId('global-logs-page')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`log-row-endpoint-${historicalLog!.id}`)).toContainText(endpointLabel);
  await expect(page.getByTestId(`log-row-endpoint-open-${historicalLog!.id}`)).toHaveCount(0);
});

test('token-mint rows distinguish endpoint snapshots from server-wide activity', async ({ page }) => {
  test.setTimeout(180_000);
  endpointId = await createFixtureEndpoint(page, {
    namePrefix: 'e2e-token-log',
    settings: {
      OAuthClientCredentialsAuthEnabled: 'True',
    },
  });

  const endpointResponse = await page.request.get(`/scim/admin/endpoints/${endpointId}`, {
    headers: { Authorization: authorization },
  });
  expect(endpointResponse.status()).toBe(200);
  const endpoint = await endpointResponse.json() as { name: string; displayName?: string };
  const endpointLabel = endpoint.displayName ?? endpoint.name;

  const credentialResponse = await page.request.post(
    `/scim/admin/endpoints/${endpointId}/credentials`,
    {
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      data: {
        credentialType: 'oauth_client',
        label: 'token-log-identity',
      },
    },
  );
  expect(credentialResponse.status()).toBe(201);
  const credential = await credentialResponse.json() as {
    clientId: string;
    clientSecret: string;
  };

  const endpointTokenResponse = await page.request.post(
    `/scim/endpoints/${endpointId}/oauth/token`,
    {
      form: {
        grant_type: 'client_credentials',
        client_id: credential.clientId,
        client_secret: credential.clientSecret,
      },
    },
  );
  expect(endpointTokenResponse.status()).toBe(200);
  const endpointRequestId = endpointTokenResponse.headers()['x-request-id'];
  expect(endpointRequestId).toBeTruthy();

  const globalTokenResponse = await page.request.post('/scim/oauth/token', {
    headers: { 'Content-Type': 'application/json' },
    data: {
      grant_type: 'client_credentials',
      client_id: 'scimserver-client',
      client_secret: process.env.E2E_OAUTH_CLIENT_SECRET || 'changeme-oauth',
    },
  });
  expect(globalTokenResponse.status()).toBe(200);
  const globalRequestId = globalTokenResponse.headers()['x-request-id'];
  expect(globalRequestId).toBeTruthy();

  let endpointLog: LogItem | undefined;
  let globalLog: LogItem | undefined;
  await expect.poll(async () => {
    const [flush, endpointLogs, globalLogs] = await Promise.all([
      page.request.post('/scim/admin/logs/flush', {
        headers: { Authorization: authorization },
      }),
      page.request.get(
        `/scim/admin/logs?requestId=${encodeURIComponent(endpointRequestId)}&includeAdmin=true&pageSize=10`,
        { headers: { Authorization: authorization } },
      ),
      page.request.get(
        `/scim/admin/logs?requestId=${encodeURIComponent(globalRequestId)}&includeAdmin=true&pageSize=10`,
        { headers: { Authorization: authorization } },
      ),
    ]);
    if (!flush.ok() || !endpointLogs.ok() || !globalLogs.ok()) return 0;
    endpointLog = ((await endpointLogs.json()) as { items?: LogItem[] }).items?.[0];
    globalLog = ((await globalLogs.json()) as { items?: LogItem[] }).items?.[0];
    return endpointLog && globalLog ? 2 : 0;
  }, { timeout: 30_000 }).toBe(2);

  expect(endpointLog).toMatchObject({
    endpointId,
    endpointName: endpointLabel,
  });
  expect(globalLog?.endpointId).toBeUndefined();
  expect(globalLog?.endpointName).toBeUndefined();

  const endpointDetailRequests: string[] = [];
  page.on('request', (browserRequest) => {
    const url = new URL(browserRequest.url());
    if (/\/scim\/admin\/endpoints\/[^/]+$/.test(url.pathname)) {
      endpointDetailRequests.push(url.pathname);
    }
  });
  await page.goto('/logs?page=1');
  await expect(page.getByTestId('global-logs-page')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`log-row-endpoint-${endpointLog!.id}`)).toHaveText(endpointLabel);
  await expect(page.getByTestId(`log-row-endpoint-${globalLog!.id}`)).toHaveText('Server-wide');
  await expect(page.getByTestId(`log-row-endpoint-open-${globalLog!.id}`)).toHaveCount(0);
  expect(endpointDetailRequests).toEqual([]);
});
