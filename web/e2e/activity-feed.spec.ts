import { test, expect } from './fixtures';

test.describe('Activity Feed', () => {
  test.describe('Summary Cards', () => {
    test('shows 4 summary cards with numeric values', async ({ page }) => {
      await expect(page.getByText('Last 24 hours')).toBeVisible();
      await expect(page.getByText('Last 7 days')).toBeVisible();
      await expect(page.getByText('User operations')).toBeVisible();
      await expect(page.getByText('Group operations')).toBeVisible();
    });

    test('summary card values are numbers (from live DB)', async ({ page }) => {
      // Wait for summary to load
      await expect(page.getByText('Last 24 hours')).toBeVisible();
      // The summary values should be numeric strings loaded from the API
      const cards = page.locator('[class*="summaryValue"]');
      const count = await cards.count();
      expect(count).toBe(4);
      for (let i = 0; i < count; i++) {
        const text = await cards.nth(i).textContent();
        expect(text).toMatch(/^\d+$/);
      }
    });
  });

  test.describe('Controls', () => {
    test('has a search input', async ({ page }) => {
      await expect(page.getByPlaceholder('Search activities...')).toBeVisible();
    });

    test('has type filter dropdown with all options', async ({ page }) => {
      const select = page.getByTitle('Filter by activity type');
      await expect(select).toBeVisible();
      await expect(select.locator('option')).toHaveCount(4); // All + 3 types
    });

    test('has severity filter dropdown with all options', async ({ page }) => {
      const select = page.getByTitle('Filter by severity');
      await expect(select).toBeVisible();
      await expect(select.locator('option')).toHaveCount(5); // All + 4 severities
    });

    test('auto-refresh checkbox is checked by default', async ({ page }) => {
      const checkbox = page.getByRole('checkbox', { name: /auto-refresh/i });
      await expect(checkbox).toBeChecked();
    });

    test('hide keepalive checkbox is checked by default', async ({ page }) => {
      const checkbox = page.getByRole('checkbox', { name: /hide keepalive/i });
      await expect(checkbox).toBeChecked();
    });
  });

  test.describe('Activity List', () => {
    test('displays activity items OR empty state', async ({ page }) => {
      // Either we have activities or we see empty state
      const items = page.locator('[class*="activityItem"]');
      const emptyState = page.getByText('No activities found');
      // One of these must be visible
      await expect(items.first().or(emptyState)).toBeVisible();
    });

    test('activity items have icon, message, and timestamp', async ({ page }) => {
      const items = page.locator('[class*="activityItem"]');
      const count = await items.count();
      if (count > 0) {
        const first = items.first();
        await expect(first.locator('[class*="activityIcon"]')).toBeVisible();
        await expect(first.locator('[class*="activityMessage"]')).toBeVisible();
        await expect(first.locator('[class*="activityTime"]')).toBeVisible();
      }
    });

    test('activity items show type badge (user/group)', async ({ page }) => {
      const items = page.locator('[class*="activityItem"]');
      const count = await items.count();
      if (count > 0) {
        const typeBadge = items.first().locator('[class*="activityType"]');
        await expect(typeBadge).toBeVisible();
        const text = await typeBadge.textContent();
        expect(['user', 'group', 'system', 'error']).toContain(text?.trim());
      }
    });
  });

  test.describe('Pagination', () => {
    test('shows pagination info when activities exist', async ({ page }) => {
      const pagination = page.getByText(/showing \d+ to \d+ of \d+/i);
      const emptyState = page.getByText('No activities found');
      // Either pagination or empty state
      await expect(pagination.or(emptyState)).toBeVisible();
    });

    test('has Previous and Next buttons', async ({ page }) => {
      const items = page.locator('[class*="activityItem"]');
      if (await items.count() > 0) {
        await expect(page.getByRole('button', { name: 'Previous' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Next' })).toBeVisible();
      }
    });
  });

  test.describe('Type Filter', () => {
    test('filtering by Users shows only user activities', async ({ page }) => {
      const select = page.getByTitle('Filter by activity type');
      await select.selectOption('user');
      // Wait for re-render
      await page.waitForTimeout(500);
      // All visible type badges should say "user"
      const typeBadges = page.locator('[class*="activityType"]');
      const count = await typeBadges.count();
      for (let i = 0; i < count; i++) {
        await expect(typeBadges.nth(i)).toHaveText('user');
      }
    });
  });
});
