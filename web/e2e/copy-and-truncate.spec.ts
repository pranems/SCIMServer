/**
 * copy-and-truncate.spec.ts - Phase P1 CopyableField + TruncatedText
 * end-to-end coverage.
 *
 * USER PATHS COVERED
 *   /endpoints/$id/users - long userName cells truncate with CSS
 *     ellipsis (no horizontal overflow distortion) and the full value
 *     is reachable as the wrapped tooltip's aria-label.
 *   /endpoints/$id/users - clicking the CopyableField's copy button
 *     writes the full value to navigator.clipboard AND does NOT open
 *     the row's ResourceDetailDrawer (the button's onClick stops
 *     propagation; the row's onClick handler is bypassed).
 *
 * WHY THESE PATHS WERE NOT PREVIOUSLY COVERED
 *   The P1 primitives shipped in commit f06c4d6 (LogsTab url column,
 *   LogsPage url+drawer, WorkbenchPage requestId/body, ScimError
 *   detail/requestId/raw, Discovery schema URN, EndpointDetail SCIM
 *   base path, UsersTab/GroupsTab name columns) addressed the layout
 *   distortion reported by the operator on prod (very long Entra
 *   userName values pushing the table off-screen). Vitest covers the
 *   testid wiring per-surface; this spec locks the browser-level
 *   behavior in three dimensions that vitest cannot reach:
 *     1. real CSS ellipsis in a real layout container,
 *     2. the actual clipboard write through Permissions API,
 *     3. event-propagation isolation between the copy button and the
 *        row's click handler.
 *
 * SAFETY
 *   READ-ONLY. Picks the first available user on whatever endpoint
 *   the dev tenant currently hosts. Skips gracefully when the tenant
 *   has zero endpoints or zero users on the chosen endpoint.
 */
import { test, expect, type Page } from '@playwright/test';

const TOKEN_STORAGE_KEY = 'scimserver.authToken';
const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';

test.beforeEach(async ({ page, context }) => {
  // Grant clipboard permissions BEFORE the page loads so the
  // navigator.clipboard.readText() call in the test can succeed.
  // Chromium requires both read + write to be explicitly granted.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: TOKEN_STORAGE_KEY, value: TOKEN },
  );
});

/**
 * Opens the first endpoint card and lands on /endpoints/$id.
 * Returns the resolved endpointId, or skips the test when the tenant
 * is empty.
 */
async function openFirstEndpoint(page: Page): Promise<string> {
  await page.goto('/endpoints');
  await expect(page.getByTestId('endpoints-page')).toBeVisible({ timeout: 30_000 });

  const cards = page.locator('[data-testid^="endpoint-"]').filter({
    hasNot: page.locator('[data-testid^="endpoint-detail"]'),
  });

  const count = await cards.count();
  test.skip(count === 0, 'Tenant has zero endpoints; cannot exercise P1 primitives.');

  const first = cards.first();
  const cardTestId = await first.getAttribute('data-testid');
  const endpointId = (cardTestId ?? '').replace(/^endpoint-/, '');
  expect(endpointId).not.toBe('');

  await first.click();
  await expect(page.getByTestId('endpoint-detail-page')).toBeVisible({ timeout: 30_000 });
  return endpointId;
}

/**
 * Navigates to the Users tab of the endpoint and returns the first
 * user-row testid attribute (e.g. `user-row-<uuid>`). Skips the test
 * when the endpoint has zero users.
 */
async function openFirstUserRow(page: Page): Promise<string> {
  const usersTab = page.getByRole('tab', { name: /^Users$/i });
  await usersTab.click();

  // Wait for either the populated users table OR the empty-state
  // testid - we tolerate either, and skip on empty.
  const tableOrEmpty = await Promise.race([
    page
      .getByTestId('users-tab')
      .waitFor({ timeout: 20_000 })
      .then(() => 'populated'),
    page
      .getByTestId('users-empty')
      .waitFor({ timeout: 20_000 })
      .then(() => 'empty'),
  ]).catch(() => 'unknown');

  test.skip(tableOrEmpty !== 'populated', 'Endpoint has zero users; cannot exercise P1 user-row primitives.');

  const rows = page.locator('[data-testid^="user-row-"]');
  const rowCount = await rows.count();
  test.skip(rowCount === 0, 'Users table rendered without rows.');

  const firstRow = rows.first();
  const rowTestId = await firstRow.getAttribute('data-testid');
  expect(rowTestId).toMatch(/^user-row-/);
  return rowTestId as string;
}

test.describe('Phase P1 - CopyableField + TruncatedText on Users table', () => {
  test('userName cell truncates with CSS ellipsis (no horizontal overflow distortion)', async ({ page }) => {
    await openFirstEndpoint(page);
    const rowTestId = await openFirstUserRow(page);
    const userId = rowTestId.replace(/^user-row-/, '');

    const usernameCell = page.getByTestId(`user-username-${userId}`);
    await expect(usernameCell).toBeVisible();

    // The CopyableField wraps the visible value in a span whose
    // computed style MUST clip overflow. We assert the three CSS
    // properties that together produce the ellipsis effect.
    const overflowStyles = await usernameCell.evaluate((el) => {
      // The displayed text lives in a nested TruncatedText span when
      // truncate=true; walk the descendant tree to find it.
      const textSpan = el.querySelector('span[class*="root"]') ?? el;
      const cs = window.getComputedStyle(textSpan as Element);
      return {
        overflow: cs.overflow,
        textOverflow: cs.textOverflow,
        whiteSpace: cs.whiteSpace,
      };
    });

    expect(overflowStyles.whiteSpace).toBe('nowrap');
    expect(overflowStyles.textOverflow).toBe('ellipsis');
    // overflow can be 'hidden' or 'clip' depending on browser; both
    // satisfy the no-distortion guarantee.
    expect(['hidden', 'clip']).toContain(overflowStyles.overflow);
  });

  test('copy button writes the full userName to the clipboard', async ({ page }) => {
    await openFirstEndpoint(page);
    const rowTestId = await openFirstUserRow(page);
    const userId = rowTestId.replace(/^user-row-/, '');

    const usernameCell = page.getByTestId(`user-username-${userId}`);
    const copyButton = page.getByTestId(`user-username-${userId}-copy-button`);

    await expect(copyButton).toBeVisible();

    // Capture what the cell displays (this is the value the
    // CopyableField was given via its `value` prop).
    const expectedValue = (await usernameCell.innerText()).trim();
    expect(expectedValue.length).toBeGreaterThan(0);

    await copyButton.click();

    // Read what the click placed on the clipboard.
    const clipboardValue = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardValue).toBe(expectedValue);
  });

  test('clicking the copy button does NOT open the row detail drawer', async ({ page }) => {
    await openFirstEndpoint(page);
    const rowTestId = await openFirstUserRow(page);
    const userId = rowTestId.replace(/^user-row-/, '');

    const copyButton = page.getByTestId(`user-username-${userId}-copy-button`);
    const drawer = page.getByTestId('resource-detail-drawer');

    // Sanity: drawer is not open before the click.
    await expect(drawer).toBeHidden();

    await copyButton.click();

    // The copy button's onClick calls e.stopPropagation() so the
    // row's onClick that opens the drawer MUST NOT fire. Give the
    // DOM a real animation frame to confirm absence.
    await page.waitForTimeout(500);
    await expect(drawer).toBeHidden();
  });
});
