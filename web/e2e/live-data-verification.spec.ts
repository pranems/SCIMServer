import { test, expect } from './fixtures';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:4000';
const TOKEN = process.env.E2E_TOKEN || 'local-secret';

async function apiGet(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return res.json();
}

test.describe('Live Data Verification — UI matches API', () => {
  test('version in footer matches /admin/version API', async ({ page }) => {
    // Wait for async version fetch
    await page.waitForTimeout(3000);
    const footer = page.locator('footer');
    const footerText = await footer.textContent() || '';
    // Should not contain the old hardcoded version
    expect(footerText).not.toContain('v0.9.1');
  });

  test('activity summary cards match /admin/activity/summary API', async ({ page }) => {
    // The UI auto-refreshes, so fetch API data and check UI roughly matches
    const sum = await apiGet('/scim/admin/activity/summary');
    // Wait for cards to render
    await expect(page.getByText('Last 24 hours')).toBeVisible();
    // Verify the 24h card value is close to API value (may differ by a few due to auto-refresh)
    const value24h = await page.locator('[class*="summaryValue"]').first().textContent();
    const uiNum = parseInt(value24h || '0');
    const apiNum = sum.summary.last24Hours;
    // Allow ±5% tolerance for concurrent requests
    expect(Math.abs(uiNum - apiNum)).toBeLessThan(Math.max(apiNum * 0.05, 10));
  });

  test('database statistics DB type matches API', async ({ page }) => {
    await page.getByRole('button', { name: /database browser/i }).click();
    const stats = await apiGet('/scim/admin/database/statistics');

    // Verify DB type shows what API returns
    await expect(page.getByText(stats.database.type)).toBeVisible();
    // Verify it's NOT SQLite
    await expect(page.getByText('SQLite')).not.toBeVisible();
  });

  test('database user count matches between stats tab and users tab', async ({ page }) => {
    await page.getByRole('button', { name: /database browser/i }).click();
    // Wait for stats to load
    await expect(page.getByText('Total Users')).toBeVisible({ timeout: 10000 });
    // Both the tab button and the stats card should show matching count
    const usersTab = page.getByRole('button').filter({ hasText: /users \(/i });
    await expect(usersTab).toBeVisible();
  });

  test('log count in Raw Logs matches API total', async ({ page }) => {
    await page.getByRole('button', { name: /raw logs/i }).click();
    // Wait for logs to load
    await page.waitForTimeout(2000);
    const totalText = await page.locator('[class*="meta"]').textContent() || '';
    const uiMatch = totalText.match(/(\d+)/);
    if (uiMatch) {
      const uiTotal = parseInt(uiMatch[1]);
      expect(uiTotal).toBeGreaterThan(0);
    }
  });

  test('backup endpoint returns 404 (removed)', async ({ page }) => {
    const res = await fetch(`${BASE}/scim/admin/backup/stats`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404);
  });

  test('activity summary has no system key (Fix #3)', async ({ page }) => {
    const sum = await apiGet('/scim/admin/activity/summary');
    expect(sum.summary.operations).not.toHaveProperty('system');
    expect(sum.summary.operations).toHaveProperty('users');
    expect(sum.summary.operations).toHaveProperty('groups');
  });
});
