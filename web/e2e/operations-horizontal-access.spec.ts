import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { createFixtureEndpointWithUsers, E2E_TOKEN, seedAuthToken } from './endpoint-fixture';

type Kind = 'users' | 'groups';

async function geometry(locator: Locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    let left = 0;
    let right = window.innerWidth;
    let top = 0;
    let bottom = window.innerHeight;
    const scrollers = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const bounds = parent.getBoundingClientRect();
      if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) {
        left = Math.max(left, bounds.left + parent.clientLeft);
        right = Math.min(right, bounds.left + parent.clientLeft + parent.clientWidth);
        if (parent.scrollWidth > parent.clientWidth) {
          scrollers.push({
            testId: parent.getAttribute('data-testid'), role: parent.getAttribute('role'),
            scrollLeft: parent.scrollLeft, clientWidth: parent.clientWidth, scrollWidth: parent.scrollWidth,
          });
        }
      }
      if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY)) {
        top = Math.max(top, bounds.top + parent.clientTop);
        bottom = Math.min(bottom, bounds.top + parent.clientTop + parent.clientHeight);
      }
    }
    const x = (rect.left + rect.right) / 2;
    const y = (rect.top + rect.bottom) / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      left: rect.left, right: rect.right, width: rect.width,
      top: rect.top, bottom: rect.bottom,
      visibleLeft: left, visibleRight: right, visibleTop: top, visibleBottom: bottom,
      scrollers,
      reachable: rect.width > 0 && rect.height > 0 &&
        rect.left >= left - 1 && rect.right <= right + 1 &&
        rect.top >= top - 1 && rect.bottom <= bottom + 1 &&
        !!hit && (element === hit || element.contains(hit)),
    };
  });
}

async function wheelTo(page: Page, locator: Locator) {
  const before = await geometry(locator);
  if (before.reachable) return;
  const content = await page.getByTestId('app-content').boundingBox();
  expect(content).not.toBeNull();
  await page.mouse.move(
    Math.min(content!.x + content!.width / 2, page.viewportSize()!.width - 20),
    (before.top + before.bottom) / 2,
  );
  await page.mouse.wheel(before.right > before.visibleRight ? 1200 : -1200, 0);
  await expect.poll(async () => (await geometry(locator)).reachable,
    { message: 'column/action is not reachable through natural horizontal wheel input' }).toBe(true);
}

async function proveAccess(page: Page, row: Locator, info: TestInfo) {
  const table = row.locator('xpath=ancestor::table');
  const headers = table.locator('thead th');
  const cells = row.locator('td');
  const tableBounds = await table.boundingBox();
  expect(tableBounds).not.toBeNull();
  const headerBounds = await headers.evaluateAll((elements) => elements.map((element) => {
    const r = element.getBoundingClientRect();
    return { text: element.textContent?.trim(), left: r.left, right: r.right, width: r.width };
  }));
  expect(headerBounds).toHaveLength(4);
  const isUser = (await row.getAttribute('data-testid'))?.startsWith('operations-user-');
  expect(headerBounds.map(({ text }) => text?.replace('Resize column', '').trim())).toEqual([
    isUser ? 'userName' : 'displayName', isUser ? 'active' : 'members', 'endpoint', 'created',
  ]);
  expect(await cells.count()).toBe(4);
  for (const header of headerBounds) {
    expect(header.width).toBeGreaterThan(0);
    expect(header.left).toBeGreaterThanOrEqual(tableBounds!.x - 1);
    expect(header.right).toBeLessThanOrEqual(tableBounds!.x + tableBounds!.width + 1);
  }
  expect(headerBounds[0].width / tableBounds!.width).toBeGreaterThanOrEqual(0.3);
  expect(headerBounds[0].width / tableBounds!.width).toBeLessThan(0.6);
  const truncation = await cells.first().locator('[data-testid$="-username"], [data-testid$="-displayname"]')
    .evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
  expect(truncation.scrollWidth).toBeGreaterThan(truncation.clientWidth);

  const access = [];
  for (let index = 0; index < 4; index++) {
    const before = await geometry(cells.nth(index));
    await wheelTo(page, headers.nth(index));
    await wheelTo(page, cells.nth(index));
    const header = await geometry(headers.nth(index));
    const cell = await geometry(cells.nth(index));
    expect(header.reachable, `header ${index} fits its actual visible clipped region`).toBe(true);
    expect(cell.reachable, `cell ${index} fits its actual visible clipped region`).toBe(true);
    access.push({ index, before, header, cell });
  }

  const buttons = row.getByRole('button');
  const actions = [];
  for (let index = 0; index < await buttons.count(); index++) {
    const button = buttons.nth(index);
    await wheelTo(page, button);
    const bounds = await geometry(button);
    expect(bounds.reachable, 'every row copy action is inside its visible clipped region').toBe(true);
    actions.push({ label: await button.getAttribute('aria-label'), bounds });
  }
  const links = row.getByRole('link');
  for (let index = 0; index < await links.count(); index++) {
    await wheelTo(page, links.nth(index));
    expect((await geometry(links.nth(index))).reachable, 'every endpoint navigation action is hit-testable').toBe(true);
  }
  expect(actions.length).toBeGreaterThanOrEqual(2);
  await info.attach('horizontal-access-measurements', {
    body: JSON.stringify({ viewport: page.viewportSize(), tableBounds, headerBounds, truncation, access, actions }, null, 2),
    contentType: 'application/json',
  });
}

async function withFixture(
  page: Page, kind: Kind, run: (row: Locator, id: string, name: string, scimId: string) => Promise<void>,
) {
  const fixture = await createFixtureEndpointWithUsers(page, { namePrefix: 'e2e-horizontal-access', users: 1 });
  try {
    let id = fixture.users[0].id;
    let name = fixture.users[0].userName;
    if (kind === 'groups') {
      name = `e2e-horizontal-access-${fixture.endpointId}-${'long-group-name-'.repeat(8)}`;
      const response = await page.request.post(`/scim/endpoints/${fixture.endpointId}/Groups`, {
        headers: { Authorization: `Bearer ${E2E_TOKEN}`, 'Content-Type': 'application/scim+json' },
        data: { schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'], displayName: name },
      });
      expect(response.status()).toBe(201);
      id = (await response.json() as { id: string }).id;
    }
    const scimId = id;
    const inventory = await page.request.get(`/scim/admin/database/${kind}?search=${encodeURIComponent(name)}`, {
      headers: { Authorization: `Bearer ${E2E_TOKEN}` },
    });
    expect(inventory.ok()).toBe(true);
    const data = await inventory.json() as Record<Kind, Array<{
      id: string; endpointId: string; userName?: string; displayName?: string;
    }>>;
    const owned = data[kind].filter((resource) => resource.endpointId === fixture.endpointId &&
      (kind === 'users' ? resource.userName : resource.displayName) === name);
    expect(owned, 'resolve the admin row ID from this exact owned resource, not its different SCIM ID').toHaveLength(1);
    id = owned[0].id;
    await page.goto('/operations');
    await page.getByTestId(`operations-tab-${kind}`).click();
    const singular = kind === 'users' ? 'user' : 'group';
    const row = page.getByTestId(`operations-${singular}-row-${id}`);
    await expect(row).toBeVisible();
    expect(await row.locator('td').first().textContent()).toContain(name);
    await expect(row.locator('td').nth(1)).toHaveText(kind === 'users' ? 'active' : '0');
    const link = row.locator('td').nth(2).getByRole('link').first();
    await expect(link).toHaveAttribute('href', `/endpoints/${fixture.endpointId}/${kind}`);
    await expect(row.locator('td').nth(3).locator('time')).toHaveAttribute('datetime', /.+/);
    await run(row, fixture.endpointId, name, scimId);
  } finally {
    const response = await page.request.delete(`/scim/admin/endpoints/${fixture.endpointId}`, {
      headers: { Authorization: `Bearer ${E2E_TOKEN}` },
    });
    expect(response.ok(), 'delete only this newly created fixture endpoint').toBe(true);
    const inventory = await page.request.get('/scim/admin/endpoints', {
      headers: { Authorization: `Bearer ${E2E_TOKEN}` },
    });
    expect(inventory.ok()).toBe(true);
    const remaining = await inventory.json() as { endpoints: Array<{ id: string }> };
    expect(remaining.endpoints.some(({ id }) => id === fixture.endpointId)).toBe(false);
  }
}

test.beforeEach(async ({ page, context }) => {
  await seedAuthToken(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

for (const kind of ['users', 'groups'] as const) {
  for (const width of [1440, 900]) {
    test(`${kind}: every column and action is user-accessible at ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      await withFixture(page, kind, async (row, endpointId, name, scimId) => {
        await proveAccess(page, row, info);
        const copyId = row.locator('td').first().getByRole('button');
        await wheelTo(page, copyId);
        await copyId.click();
        const resourceId = (await row.getAttribute('data-testid'))!.replace(/^operations-(user|group)-row-/, '');
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(resourceId);
        const time = row.locator('td').nth(3).locator('time');
        const iso = await time.getAttribute('datetime');
        const copyTime = time.getByRole('button');
        await wheelTo(page, copyTime);
        await copyTime.click();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(iso);
        const link = row.locator('td').nth(2).getByRole('link').first();
        const path = `/scim/endpoints/${endpointId}/${kind === 'users' ? 'Users' : 'Groups'}`;
        const loaded = page.waitForResponse((response) => new URL(response.url()).pathname === path &&
          response.request().method() === 'GET');
        await wheelTo(page, link);
        await link.click();
        await expect(page).toHaveURL((url) => url.pathname === `/endpoints/${endpointId}/${kind}`);
        const response = await loaded;
        expect(response.status()).toBe(200);
        const targetRow = page.getByTestId(`${kind === 'users' ? 'user' : 'group'}-row-${scimId}`);
        await expect(targetRow).toContainText(name);
        const requestId = response.headers()['x-request-id'];
        expect(requestId).toBeTruthy();
        await info.attach('browser-request-correlation', {
          body: JSON.stringify({ path, status: response.status(), requestId }, null, 2),
          contentType: 'application/json',
        });
      });
    });
  }

  test(`${kind}: inaccessible clipping negative control is rejected at 900px`, async ({ page }, info) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await withFixture(page, kind, async (row) => {
      await row.evaluate((element) => {
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (parent.scrollWidth > parent.clientWidth) {
            parent.style.overflowX = 'hidden';
          }
        }
      });
      const lastHeader = row.locator('xpath=ancestor::table').locator('thead th').last();
      expect((await geometry(lastHeader)).reachable, 'control must actually clip the trailing column').toBe(false);
      await expect(proveAccess(page, row, info)).rejects.toThrow('not reachable through natural horizontal wheel input');
      await info.attach('negative-control', {
        body: JSON.stringify({ outcome: 'rejected inaccessible clipped column', bounds: await geometry(lastHeader) }, null, 2),
        contentType: 'application/json',
      });
    });
  });
}
